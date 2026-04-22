/**
 * Impossible-mode evaluation: tunable weights + hand-designed features.
 * Shared primitives live in aiEvalCore.js.
 *
 * Layout (top → bottom):
 *   1. Weight configs (B-Rabbit / Tortuga / Legacy)
 *   2. Weight-gating predicates  (skip work when all related weights are 0)
 *   3. Feature helpers           (per-feature primitives, several exported)
 *   4. Eval context              (cached facts shared across feature groups)
 *   5. Feature groups            (one function per cluster of related features)
 *   6. Orchestration             (computeImpossibleFeatureContributions / evaluateImpossible)
 *
 * Note: Phase C-lite atomic features were moved to utils/aiAtomicEval.js
 * (Stage 1 of Phase C) to consolidate atomic-feature work in one module.
 */

const {
  getKeyCoordinates,
  toCellKey,
  getValidPasses,
} = require('./gameLogic');

const {
  EVAL_INFINITY,
  findPieces,
  findBallHolder,
  getAdvancement,
  didWin,
  computePassingChain,
  classifyPasses,
  countBlockedLanes,
  countRelayPieces,
  countKnightMobility,
  getDeliverySquares,
  opponentDeliveryThreat,
  cellKeyToSqIndex,
  KNIGHT_DIST,
} = require('./aiEvalCore');

// ============================================
// 1. WEIGHT CONFIGS
// ============================================

/**
 * Default weights for evaluateImpossible ("B-Rabbit").
 * Phase B (self-play tuning) will replace these with empirically-derived values.
 *
 * Each weight is the multiplier applied to a feature's (us − opponent) delta.
 * Defensive features (chainFragility, opponentIsolation, defendedWinPoints) are
 * inverted in their feature group so positive weights always mean "good for us".
 *
 * Inline tags note compute class — useful when deciding what to gate on / off.
 */
const DEFAULT_IMPOSSIBLE_WEIGHTS = {
  ballAdvancement: 30,                 // O(1)
  pieceAdvancement: 8,                 // O(pieces)
  pieceAdvancementUnderThreat: 3,      // O(pieces) — shares with pieceAdvancement
  forwardPass: 25,                     // O(8) — shared pass list
  lateralPass: 10,                     // O(8) — shares
  backwardPass: 5,                     // O(8) — shares
  ballIsolation0: -80,                 // O(8) — shares
  ballIsolation1: -25,                 // O(8) — shares
  chainFurthest: 60,                   // O(BFS over passing edges)
  chainReachesGoal: 150,               // O(BFS) — shares
  relayPieces: 0,                      // O(pieces × 8 ray-cast)
  knightMobility: 0,                   // O(pieces × ~8)
  blockedLanes: 0,                     // O(pieces × 8 ray-cast) — heavy
  deliveryThreat0: 500,                // O(delivery × pieces) knight-dist
  deliveryThreat1: 300,                // O(delivery × pieces) — shares
  deliveryThreat2: 150,                // O(delivery × pieces) — shares
  deliveryThreat3: 60,                 // O(delivery × pieces) — shares
  ourDeliveryThreat0: 450,             // O(delivery × pieces) — shares
  ourDeliveryThreat1: 250,             // O(delivery × pieces) — shares
  ourDeliveryThreat2: 120,             // O(delivery × pieces) — shares
  ourDeliveryThreat3: 50,              // O(delivery × pieces) — shares
  chainFragility: 25,                  // O(BFS + chain × 8)
  networkConnectivity: 0,              // O(pieces × 8)
  goalRowDefense: 0,                   // O(pieces)
  opponentIsolation: 35,               // O(pieces × 8)
  chokepointControl: 0,                // O(4 × 8)
  winPointCount: 80,                   // O(1) — uses delivery cache
  reachableWinPoints: 150,             // O(delivery × pieces) knight-dist
  defendedWinPoints: 50,               // O(delivery × pieces) knight-dist
  pieceCoordination: 15,               // O(pieces × 64) knight-1 scan
  defensiveCoverOfGoalFiles: 30,       // O(pieces × 8 goal squares)
  penultimateRankForcedWin: 400,       // O(pieces × 3)
};

/** Full-featured eval — all 22 features active (benchmarking). */
const TORTUGA_IMPOSSIBLE_WEIGHTS = {
  ...DEFAULT_IMPOSSIBLE_WEIGHTS,
  relayPieces: 20,
  knightMobility: 3,
  blockedLanes: 12,
  networkConnectivity: 5,
  goalRowDefense: 40,
  chokepointControl: 25,
};

/** Pre-win-points eval (benchmarking). */
const LEGACY_IMPOSSIBLE_WEIGHTS = {
  ...DEFAULT_IMPOSSIBLE_WEIGHTS,
  ballAdvancement: 100,
  pieceAdvancement: 8,
  relayPieces: 20,
  knightMobility: 3,
  blockedLanes: 12,
  networkConnectivity: 5,
  goalRowDefense: 40,
  chokepointControl: 25,
  winPointCount: 0,
  reachableWinPoints: 0,
  defendedWinPoints: 0,
  pieceCoordination: 0,
  defensiveCoverOfGoalFiles: 0,
  penultimateRankForcedWin: 0,
};

// ============================================
// 2. WEIGHT-GATING PREDICATES
// ============================================

function needsDeliveryCache(weights) {
  return !!(weights.winPointCount || weights.reachableWinPoints
    || weights.defendedWinPoints || weights.pieceCoordination);
}

function needsPassBreakdown(weights) {
  return !!(weights.forwardPass || weights.lateralPass || weights.backwardPass
    || weights.ballIsolation0 || weights.ballIsolation1);
}

function needsChain(weights) {
  return !!(weights.chainFurthest || weights.chainReachesGoal);
}

function needsDeliveryThreat(weights) {
  return !!(weights.deliveryThreat0 || weights.deliveryThreat1
    || weights.deliveryThreat2 || weights.deliveryThreat3
    || weights.ourDeliveryThreat0 || weights.ourDeliveryThreat1
    || weights.ourDeliveryThreat2 || weights.ourDeliveryThreat3);
}

function needsPieceAdvancement(weights) {
  return !!(weights.pieceAdvancement || weights.pieceAdvancementUnderThreat);
}

// ============================================
// 3. FEATURE HELPERS
// ============================================

/** BFS over passing edges from `color`'s ball holder; returns set of reachable cells. */
function buildPassingChainSet(board, color) {
  const ballHolder = findBallHolder(board, color);
  if (!ballHolder) return new Set();

  const chain = new Set([ballHolder.cellKey]);
  let queue = [ballHolder.cellKey];
  while (queue.length > 0) {
    const next = [];
    for (const ck of queue) {
      for (const target of getValidPasses(ck, color, board)) {
        if (!chain.has(target)) {
          chain.add(target);
          next.push(target);
        }
      }
    }
    queue = next;
  }
  return chain;
}

/** Count chain pieces that have only one in-chain neighbor (single point of failure). */
function chainFragility(board, color) {
  const chain = buildPassingChainSet(board, color);
  if (chain.size <= 1) return 0;

  let fragile = 0;
  for (const ck of chain) {
    let neighbors = 0;
    for (const target of getValidPasses(ck, color, board)) {
      if (chain.has(target)) {
        neighbors++;
        if (neighbors >= 2) break;
      }
    }
    if (neighbors === 1) fragile++;
  }
  return fragile;
}

function networkConnectivity(board, color) {
  const pieces = findPieces(board, color);
  let total = 0;
  for (const { cellKey } of pieces) {
    total += getValidPasses(cellKey, color, board).length;
  }
  return total;
}

function goalRowDefense(board, color) {
  const defenseRow = color === 'white' ? 7 : 0;
  let count = 0;
  for (const { cellKey } of findPieces(board, color)) {
    if (getKeyCoordinates(cellKey).row === defenseRow) count++;
  }
  return count;
}

function opponentIsolation(board, color) {
  const oppColor = color === 'white' ? 'black' : 'white';
  let isolated = 0;
  for (const { cellKey } of findPieces(board, oppColor)) {
    if (getValidPasses(cellKey, oppColor, board).length === 0) isolated++;
  }
  return isolated;
}

const CHOKEPOINT_KEYS = ['d4', 'd5', 'e4', 'e5'];
function chokepointControl(board, color) {
  let count = 0;
  for (const key of CHOKEPOINT_KEYS) {
    const piece = board[key];
    if (piece && piece.color === color) {
      const passes = getValidPasses(key, color, board);
      if (passes.length >= 2) count++;
    }
  }
  return count;
}

function winPointCount(board, color, delivery) {
  return (delivery || getDeliverySquares(board, color)).squares.length;
}

function reachableWinPoints(board, color, maxKnightMoves = 2, delivery) {
  const { squares } = delivery || getDeliverySquares(board, color);
  if (squares.length === 0) return 0;

  const ourPieceSqs = [];
  for (const { cellKey, piece } of findPieces(board, color)) {
    if (!piece.hasBall) ourPieceSqs.push(cellKeyToSqIndex(cellKey));
  }
  if (ourPieceSqs.length === 0) return 0;

  let reachable = 0;
  for (const dSq of squares) {
    for (const pSq of ourPieceSqs) {
      if (KNIGHT_DIST[pSq][dSq] <= maxKnightMoves) { reachable++; break; }
    }
  }
  return reachable;
}

function defendedWinPoints(board, color, maxKnightMoves = 1, delivery) {
  const { squares } = delivery || getDeliverySquares(board, color);
  if (squares.length === 0) return 0;

  const opponentColor = color === 'white' ? 'black' : 'white';
  const oppPieceSqs = [];
  for (const { cellKey, piece } of findPieces(board, opponentColor)) {
    if (!piece.hasBall) oppPieceSqs.push(cellKeyToSqIndex(cellKey));
  }
  if (oppPieceSqs.length === 0) return 0;

  let threatened = 0;
  for (const dSq of squares) {
    for (const pSq of oppPieceSqs) {
      if (KNIGHT_DIST[pSq][dSq] <= maxKnightMoves) { threatened++; break; }
    }
  }
  return threatened;
}

function pieceCoordination(board, color, offWeight = 2, defWeight = 2, ourDeliveryRaw, oppDeliveryRaw) {
  const ourDelivery = new Set((ourDeliveryRaw || getDeliverySquares(board, color)).squares);
  const oppColor = color === 'white' ? 'black' : 'white';
  const oppDelivery = new Set((oppDeliveryRaw || getDeliverySquares(board, oppColor)).squares);
  if (ourDelivery.size === 0 && oppDelivery.size === 0) return 0;

  let score = 0;
  for (const { cellKey, piece } of findPieces(board, color)) {
    if (piece.hasBall) continue;
    const pSq = cellKeyToSqIndex(cellKey);
    for (let sq = 0; sq < 64; sq++) {
      if (KNIGHT_DIST[pSq][sq] !== 1) continue;
      if (ourDelivery.has(sq)) score += offWeight;
      if (oppDelivery.has(sq)) score += defWeight;
    }
  }
  return score;
}

function defensiveCoverOfGoalFiles(board, color, maxKnightMoves = 2) {
  const ourGoalRow = color === 'white' ? 7 : 0;
  const goalSqs = [];
  for (let c = 0; c < 8; c++) goalSqs.push(ourGoalRow * 8 + c);

  let cover = 0;
  for (const { cellKey, piece } of findPieces(board, color)) {
    if (piece.hasBall) continue;
    const pSq = cellKeyToSqIndex(cellKey);
    for (const gSq of goalSqs) {
      if (KNIGHT_DIST[pSq][gSq] <= maxKnightMoves) { cover++; break; }
    }
  }
  return cover;
}

/** Penultimate-rank forced-win motif: ball on rank 7/2, ≥1 reachable, undefended adjacent goal-rank file. */
function penultimateRankForcedWin(board, color) {
  const ball = findBallHolder(board, color);
  if (!ball) return 0;
  const penultRow = color === 'white' ? 1 : 6;
  const { row, col } = getKeyCoordinates(ball.cellKey);
  if (row !== penultRow) return 0;

  const goalRow = color === 'white' ? 0 : 7;
  const threatSqs = [];
  for (const dc of [-1, 0, 1]) {
    const c = col + dc;
    if (c < 0 || c > 7) continue;
    const cell = board[toCellKey(goalRow, c)];
    if (cell === null || cell === undefined) threatSqs.push(goalRow * 8 + c);
  }
  if (threatSqs.length === 0) return 0;

  const oppColor = color === 'white' ? 'black' : 'white';
  const oppCovers = new Set();
  for (const { cellKey, piece } of findPieces(board, oppColor)) {
    if (piece.hasBall) continue;
    const pSq = cellKeyToSqIndex(cellKey);
    for (const tSq of threatSqs) {
      if (KNIGHT_DIST[pSq][tSq] <= 1) oppCovers.add(tSq);
    }
  }
  const uncovered = threatSqs.length - oppCovers.size;
  if (uncovered <= 0) return 0;

  const ourUncoveredSqs = threatSqs.filter(tSq => !oppCovers.has(tSq));
  let reachable = false;
  for (const { cellKey, piece } of findPieces(board, color)) {
    if (piece.hasBall) continue;
    const pSq = cellKeyToSqIndex(cellKey);
    for (const tSq of ourUncoveredSqs) {
      if (KNIGHT_DIST[pSq][tSq] <= 1) { reachable = true; break; }
    }
    if (reachable) break;
  }
  if (!reachable) return 0;

  return uncovered;
}

// ============================================
// 4. EVAL CONTEXT
// ============================================

/**
 * Cached facts for one impossible eval call — avoids redundant ball-holder
 * lookups and delivery-square BFS where weights gate the downstream features.
 */
function buildImpossibleEvalContext(board, color, weights) {
  const opponentColor = color === 'white' ? 'black' : 'white';
  const ballHolder = findBallHolder(board, color);
  const opponentBallHolder = findBallHolder(board, opponentColor);
  const needsDelivery = needsDeliveryCache(weights);
  const ourDelivery = needsDelivery ? getDeliverySquares(board, color) : null;
  const oppDelivery = needsDelivery ? getDeliverySquares(board, opponentColor) : null;
  return {
    color,
    opponentColor,
    ballHolder,
    opponentBallHolder,
    ourDelivery,
    oppDelivery,
  };
}

// ============================================
// 5. FEATURE GROUPS
// ============================================
// Each group returns a partial contribution dict: only the keys whose weight
// is non-zero appear in the output. `computeImpossibleFeatureContributions`
// composes them by spreading into a fresh object.

function evalBallProgress(weights, ctx) {
  if (!weights.ballAdvancement) return {};
  const { ballHolder, opponentBallHolder, color, opponentColor } = ctx;
  const ours = ballHolder
    ? getAdvancement(getKeyCoordinates(ballHolder.cellKey).row, color)
    : 0;
  const theirs = opponentBallHolder
    ? getAdvancement(getKeyCoordinates(opponentBallHolder.cellKey).row, opponentColor)
    : 0;
  return { ballAdvancement: ours - theirs };
}

function evalPassNetwork(board, weights, ctx) {
  if (!needsPassBreakdown(weights)) return {};
  const { ballHolder, opponentBallHolder, color, opponentColor } = ctx;
  const empty = { forward: 0, lateral: 0, backward: 0 };
  const ours = ballHolder ? classifyPasses(board, color) : empty;
  const theirs = opponentBallHolder ? classifyPasses(board, opponentColor) : empty;

  const out = {};
  if (weights.forwardPass)  out.forwardPass  = ours.forward  - theirs.forward;
  if (weights.lateralPass)  out.lateralPass  = ours.lateral  - theirs.lateral;
  if (weights.backwardPass) out.backwardPass = ours.backward - theirs.backward;

  if (weights.ballIsolation0 || weights.ballIsolation1) {
    // total === -1 sentinel when the side has no ball holder (so isolation features
    // don't fire for an absent piece — distinct from 0 passes available).
    const ourTotal = ballHolder
      ? ours.forward + ours.lateral + ours.backward : -1;
    const oppTotal = opponentBallHolder
      ? theirs.forward + theirs.lateral + theirs.backward : -1;
    if (weights.ballIsolation0) {
      out.ballIsolation0 = (ourTotal === 0 ? 1 : 0) - (oppTotal === 0 ? 1 : 0);
    }
    if (weights.ballIsolation1) {
      out.ballIsolation1 = (ourTotal === 1 ? 1 : 0) - (oppTotal === 1 ? 1 : 0);
    }
  }
  return out;
}

function evalChainReach(board, weights, ctx) {
  if (!needsChain(weights)) return {};
  const { color, opponentColor } = ctx;
  const ours = computePassingChain(board, color);
  const theirs = computePassingChain(board, opponentColor);
  const out = {};
  if (weights.chainFurthest) {
    out.chainFurthest = ours.furthestAdvancement - theirs.furthestAdvancement;
  }
  if (weights.chainReachesGoal) {
    out.chainReachesGoal = (ours.reachesGoal ? 1 : 0) - (theirs.reachesGoal ? 1 : 0);
  }
  return out;
}

function evalLaneControl(board, weights, ctx) {
  const { color, opponentColor } = ctx;
  const out = {};
  if (weights.relayPieces) {
    out.relayPieces = countRelayPieces(board, color) - countRelayPieces(board, opponentColor);
  }
  if (weights.knightMobility) {
    out.knightMobility = countKnightMobility(board, color) - countKnightMobility(board, opponentColor);
  }
  if (weights.blockedLanes) {
    out.blockedLanes = countBlockedLanes(board, color) - countBlockedLanes(board, opponentColor);
  }
  return out;
}

function evalPieceAdvancement(board, weights, ctx) {
  if (!needsPieceAdvancement(weights)) return {};
  const { color, opponentColor, opponentBallHolder } = ctx;
  const oppBallAdv = opponentBallHolder
    ? getAdvancement(getKeyCoordinates(opponentBallHolder.cellKey).row, opponentColor)
    : 0;

  // Concave: pieces past rank 7 (advancement > 6) cap at 4. Encourages spreading
  // forward without over-investing in one piece sitting on the goal row.
  let sumUs = 0, sumThem = 0;
  for (const { cellKey } of findPieces(board, color)) {
    const p = getAdvancement(getKeyCoordinates(cellKey).row, color);
    sumUs += p <= 6 ? p : 4;
  }
  for (const { cellKey } of findPieces(board, opponentColor)) {
    const p = getAdvancement(getKeyCoordinates(cellKey).row, opponentColor);
    sumThem += p <= 6 ? p : 4;
  }
  const mass = sumUs - sumThem;

  const out = {};
  // Split mass-advance reward between safe (opp ball back) and pressured (opp ball forward).
  if (weights.pieceAdvancement) {
    out.pieceAdvancement = oppBallAdv < 4 ? mass : 0;
  }
  if (weights.pieceAdvancementUnderThreat) {
    out.pieceAdvancementUnderThreat = oppBallAdv >= 4 ? mass : 0;
  }
  return out;
}

function evalDeliveryThreats(board, weights, ctx) {
  if (!needsDeliveryThreat(weights)) return {};
  const { color, opponentColor } = ctx;
  // opponentDeliveryThreat(b, X) = how close X's *opponent* is to delivering on X's goal.
  // So `oppThreat` measures the danger we face; `ourThreat` measures danger we pose.
  const oppThreat = opponentDeliveryThreat(board, color);
  const ourThreat = opponentDeliveryThreat(board, opponentColor);
  const out = {};
  if (weights.deliveryThreat0) out.deliveryThreat0 = oppThreat === 0 ? -1 : 0;
  if (weights.deliveryThreat1) out.deliveryThreat1 = oppThreat === 1 ? -1 : 0;
  if (weights.deliveryThreat2) out.deliveryThreat2 = oppThreat === 2 ? -1 : 0;
  if (weights.deliveryThreat3) out.deliveryThreat3 = oppThreat === 3 ? -1 : 0;
  if (weights.ourDeliveryThreat0) out.ourDeliveryThreat0 = ourThreat === 0 ? 1 : 0;
  if (weights.ourDeliveryThreat1) out.ourDeliveryThreat1 = ourThreat === 1 ? 1 : 0;
  if (weights.ourDeliveryThreat2) out.ourDeliveryThreat2 = ourThreat === 2 ? 1 : 0;
  if (weights.ourDeliveryThreat3) out.ourDeliveryThreat3 = ourThreat === 3 ? 1 : 0;
  return out;
}

function evalDefensiveStructure(board, weights, ctx) {
  const { color, opponentColor } = ctx;
  const out = {};
  // chainFragility & opponentIsolation are *defensive*: positive weight → reward when *they* are fragile/isolated.
  if (weights.chainFragility) {
    out.chainFragility = chainFragility(board, opponentColor) - chainFragility(board, color);
  }
  if (weights.networkConnectivity) {
    out.networkConnectivity = networkConnectivity(board, color) - networkConnectivity(board, opponentColor);
  }
  if (weights.goalRowDefense) {
    out.goalRowDefense = goalRowDefense(board, color) - goalRowDefense(board, opponentColor);
  }
  if (weights.opponentIsolation) {
    out.opponentIsolation = opponentIsolation(board, color) - opponentIsolation(board, opponentColor);
  }
  if (weights.chokepointControl) {
    out.chokepointControl = chokepointControl(board, color) - chokepointControl(board, opponentColor);
  }
  return out;
}

function evalWinPoints(board, weights, ctx) {
  const { color, opponentColor, ourDelivery, oppDelivery } = ctx;
  const out = {};
  if (weights.winPointCount) {
    out.winPointCount = winPointCount(board, color, ourDelivery)
      - winPointCount(board, opponentColor, oppDelivery);
  }
  if (weights.reachableWinPoints) {
    out.reachableWinPoints = reachableWinPoints(board, color, 2, ourDelivery)
      - reachableWinPoints(board, opponentColor, 2, oppDelivery);
  }
  if (weights.defendedWinPoints) {
    // Defensive: reward when *we* threaten *their* delivery squares.
    out.defendedWinPoints = defendedWinPoints(board, opponentColor, 1, oppDelivery)
      - defendedWinPoints(board, color, 1, ourDelivery);
  }
  return out;
}

function evalCoordinationAndForcedWin(board, weights, ctx) {
  const { color, opponentColor, ourDelivery, oppDelivery } = ctx;
  const out = {};
  if (weights.pieceCoordination) {
    out.pieceCoordination = pieceCoordination(board, color, 2, 2, ourDelivery, oppDelivery)
      - pieceCoordination(board, opponentColor, 2, 2, oppDelivery, ourDelivery);
  }
  if (weights.defensiveCoverOfGoalFiles) {
    out.defensiveCoverOfGoalFiles = defensiveCoverOfGoalFiles(board, color)
      - defensiveCoverOfGoalFiles(board, opponentColor);
  }
  if (weights.penultimateRankForcedWin) {
    out.penultimateRankForcedWin = penultimateRankForcedWin(board, color)
      - penultimateRankForcedWin(board, opponentColor);
  }
  return out;
}

// ============================================
// 6. ORCHESTRATION
// ============================================

/**
 * Raw feature contributions: one scalar per weight key such that
 *   Σ_k weights[k] × contributions[k]   ≡   evaluateImpossible(board, color, weights)
 * (excluding terminal ±EVAL_INFINITY wins).
 *
 * Per-key gating: only keys whose weight is non-zero appear in the output.
 */
function computeImpossibleFeatureContributions(board, color, weights = DEFAULT_IMPOSSIBLE_WEIGHTS) {
  const ctx = buildImpossibleEvalContext(board, color, weights);
  return Object.assign({},
    evalBallProgress(weights, ctx),
    evalPassNetwork(board, weights, ctx),
    evalChainReach(board, weights, ctx),
    evalLaneControl(board, weights, ctx),
    evalPieceAdvancement(board, weights, ctx),
    evalDeliveryThreats(board, weights, ctx),
    evalDefensiveStructure(board, weights, ctx),
    evalWinPoints(board, weights, ctx),
    evalCoordinationAndForcedWin(board, weights, ctx),
  );
}

function scoreFromImpossibleContributions(weights, contributions) {
  let score = 0;
  for (const [key, w] of Object.entries(weights)) {
    if (!w) continue;
    const v = contributions[key];
    if (v !== undefined && v !== 0) score += w * v;
  }
  return score;
}

/** Impossible eval — terminal wins, then Σ weight[k] × contribution[k]. */
function evaluateImpossible(board, color, weights = DEFAULT_IMPOSSIBLE_WEIGHTS) {
  const opponentColor = color === 'white' ? 'black' : 'white';
  const winner = didWin(board);
  if (winner === color) return EVAL_INFINITY;
  if (winner === opponentColor) return -EVAL_INFINITY;

  const contributions = computeImpossibleFeatureContributions(board, color, weights);
  return scoreFromImpossibleContributions(weights, contributions);
}

module.exports = {
  DEFAULT_IMPOSSIBLE_WEIGHTS,
  TORTUGA_IMPOSSIBLE_WEIGHTS,
  LEGACY_IMPOSSIBLE_WEIGHTS,
  evaluateImpossible,
  computeImpossibleFeatureContributions,
  scoreFromImpossibleContributions,
  buildImpossibleEvalContext,
  winPointCount,
  reachableWinPoints,
  defendedWinPoints,
  pieceCoordination,
  defensiveCoverOfGoalFiles,
  penultimateRankForcedWin,
};
