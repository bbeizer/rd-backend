/**
 * Atomic-feature evaluation (Phase C Stage 1).
 *
 * Linear eval over ~260 atomic binary/scalar features. No hand-designed
 * game theory — weights are learned from self-play outcomes via TD-Leaf.
 * Runs alongside the hand-tuned impossible eval ("B-Rabbit") as a separate
 * difficulty tier (`impossible_atomic`) so training never risks the shipping AI.
 *
 * Feature shape (DEFAULT_ATOMIC_WEIGHTS keys):
 *   pW_<cell>   — 64 binaries: white piece occupies <cell>
 *   pB_<cell>   — 64 binaries: black piece occupies <cell>
 *   bW_<cell>   — 64 binaries: white's ball is at <cell>
 *   bB_<cell>   — 64 binaries: black's ball is at <cell>
 *   ballGoalKnightGap    — white-perspective: (black gap − white gap); positive = white closer
 *   allyBallKnightGap    — white-perspective: (black gap − white gap)
 *   centerOccupancy      — white-perspective: (white center pieces − black center pieces)
 *
 * Score is computed white-perspective, then negated for black. Terminal
 * positions return ±EVAL_INFINITY, same as every other eval.
 */

const { toCellKey } = require('./gameLogic');
const {
  EVAL_INFINITY,
  findPieces,
  findBallHolder,
  didWin,
  cellKeyToSqIndex,
  KNIGHT_DIST,
} = require('./aiEvalCore');

const ALL_CELLS = (() => {
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) cells.push(toCellKey(r, c));
  }
  return cells;
})();

const ATOMIC_SCALAR_KEYS = [
  'ballGoalKnightGap',
  'allyBallKnightGap',
  'centerOccupancy',
];

function buildDefaultWeights() {
  const w = {};
  for (const cell of ALL_CELLS) {
    w[`pW_${cell}`] = 0;
    w[`pB_${cell}`] = 0;
    w[`bW_${cell}`] = 0;
    w[`bB_${cell}`] = 0;
  }
  for (const key of ATOMIC_SCALAR_KEYS) w[key] = 0;
  return w;
}

const DEFAULT_ATOMIC_WEIGHTS = Object.freeze(buildDefaultWeights());

// ============================================
// Scalar feature helpers (moved from aiImpossibleEval.js)
// ============================================

/** Min knight moves from `color`'s ball to any square on `color`'s scoring goal row. */
function minKnightBallToGoalRow(board, color) {
  const bh = findBallHolder(board, color);
  if (!bh) return 99;
  const goalRow = color === 'white' ? 0 : 7;
  const ballSq = cellKeyToSqIndex(bh.cellKey);
  let minD = 99;
  for (let col = 0; col < 8; col++) {
    const d = KNIGHT_DIST[ballSq][goalRow * 8 + col];
    if (d < minD) minD = d;
  }
  return minD;
}

/** Min knight moves from any non-ball friendly piece to friendly ball. */
function minKnightAllyToBall(board, color) {
  const bh = findBallHolder(board, color);
  if (!bh) return 99;
  const ballSq = cellKeyToSqIndex(bh.cellKey);
  let minD = 99;
  for (const { cellKey, piece } of findPieces(board, color)) {
    if (piece.hasBall) continue;
    const d = KNIGHT_DIST[cellKeyToSqIndex(cellKey)][ballSq];
    if (d < minD) minD = d;
  }
  return minD;
}

/** Pieces in the central 4×4 (rows/cols 2–5 ≡ ranks 3–6, files c–f). */
function countCenterRegionPieces(board, color) {
  let n = 0;
  for (const { cellKey } of findPieces(board, color)) {
    const row = 8 - parseInt(cellKey[1], 10);
    const col = cellKey.charCodeAt(0) - 97;
    if (row >= 2 && row <= 5 && col >= 2 && col <= 5) n++;
  }
  return n;
}

// ============================================
// Feature extraction
// ============================================

/**
 * Returns the raw atomic features of `board` (white-perspective).
 * Binary piece-square / ball-on-square indicators keyed by cell; three scalar
 * features at the end. Caller computes Σ weight[k] × features[k].
 */
function extractAtomicFeatures(board) {
  const feats = {};
  for (const cell of ALL_CELLS) {
    const p = board[cell];
    feats[`pW_${cell}`] = p && p.color === 'white' ? 1 : 0;
    feats[`pB_${cell}`] = p && p.color === 'black' ? 1 : 0;
    feats[`bW_${cell}`] = p && p.color === 'white' && p.hasBall ? 1 : 0;
    feats[`bB_${cell}`] = p && p.color === 'black' && p.hasBall ? 1 : 0;
  }
  feats.ballGoalKnightGap = minKnightBallToGoalRow(board, 'black') - minKnightBallToGoalRow(board, 'white');
  feats.allyBallKnightGap = minKnightAllyToBall(board, 'black') - minKnightAllyToBall(board, 'white');
  feats.centerOccupancy = countCenterRegionPieces(board, 'white') - countCenterRegionPieces(board, 'black');
  return feats;
}

function dot(features, weights) {
  let score = 0;
  for (const [key, w] of Object.entries(weights)) {
    if (!w) continue;
    const v = features[key];
    if (v) score += w * v;
  }
  return score;
}

/**
 * Atomic eval — terminal wins short-circuit to ±EVAL_INFINITY, otherwise the
 * linear combination of atomic features with `weights`.
 */
function evaluateAtomic(board, color, weights = DEFAULT_ATOMIC_WEIGHTS) {
  const opponentColor = color === 'white' ? 'black' : 'white';
  const winner = didWin(board);
  if (winner === color) return EVAL_INFINITY;
  if (winner === opponentColor) return -EVAL_INFINITY;

  const feats = extractAtomicFeatures(board);
  const whiteScore = dot(feats, weights);
  return color === 'white' ? whiteScore : -whiteScore;
}

module.exports = {
  DEFAULT_ATOMIC_WEIGHTS,
  ATOMIC_SCALAR_KEYS,
  ALL_CELLS,
  extractAtomicFeatures,
  evaluateAtomic,
  // Exported for tests / reuse:
  minKnightBallToGoalRow,
  minKnightAllyToBall,
  countCenterRegionPieces,
};
