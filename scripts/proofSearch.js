/**
 * Pure-terminal-eval proof search. Eval is +∞ if I won, -∞ if opponent won,
 * 0 otherwise — no heuristic features. At depth N, this either proves a
 * forced win/loss exists within N plies or returns 0 (undecided).
 *
 *   node scripts/proofSearch.js [--maxDepth 10] [--timeLimitMs 600000]
 *                                [--only P1_naked_f7]
 *                                [--db data/positions.db] [--persist 1]
 *
 * Output per fixture:
 *   - deepest depth fully completed
 *   - verdict at that depth: PROVEN WIN / PROVEN LOSS / UNDECIDED
 *   - best move and its proof score
 *
 * This is the engine's "ground truth" check on whether the rank-7 fixtures
 * are mathematically forced for white, independent of any heuristic.
 *
 * PERSISTENT PROOF ATLAS (program step 2, wired 2026-08-31):
 * Proven verdicts are immortal — a forced win/loss never invalidates — so they
 * are persisted to the shared position store (utils/aiPositionStore.js, same DB
 * the live engine reads via aiPersistTT). On startup every stored proof is
 * loaded into an in-memory Map and probed at every node INCLUDING leaves: a
 * leaf hit chains this search onto an earlier proof, extending the effective
 * horizon (the compositional-proof mechanism). Store convention matches the
 * live engine: key = hashBoard|sideToMove, result is from the side-to-move's
 * POV, distance = plies to terminal (shortest-distance-wins upsert).
 *
 * Soundness: only certified verdicts are persisted. The in-memory TT carries
 * exact/lower/upper bound flags (alpha-beta cutoffs yield bounds, not exact
 * values — same gotcha as the live engine's PVS TT). A lower bound >= WIN
 * still proves a win and an upper bound <= -WIN still proves a loss, so those
 * persist; everything else (undecided scores, wrong-direction bounds) never
 * touches the DB. Distances persisted from bounds are upper bounds on the true
 * ply count — safe under the store's shortest-distance conflict policy.
 */

const { didWin } = require('../utils/aiEvalCore');
const { generateTurnOutcomes } = require('../utils/aiLogic');
const { cloneBoardFast, hashBoard } = require('../utils/aiSparseBoard');
const { openStore, DEFAULT_DB_PATH } = require('../utils/aiPositionStore');

const WIN_SCORE = 1_000_000;
// |score| within this margin of WIN_SCORE means "proven, N plies out".
// Generous vs. any plausible proof depth; scores are otherwise exactly 0.
const PROOF_MARGIN = 1000;
const FLUSH_THRESHOLD = 5000;

function isProvenScore(s) { return Math.abs(s) >= WIN_SCORE - PROOF_MARGIN; }
function oppColor(c) { return c === 'white' ? 'black' : 'white'; }

/** Convert a stored atlas record (side-to-move POV) to a root-POV proof score. */
function atlasRecToScore(rec, sideToMove, rootColor, distFromRoot) {
  const winner = rec.result === 'WIN' ? sideToMove : oppColor(sideToMove);
  const total = distFromRoot + rec.distance;
  return winner === rootColor ? WIN_SCORE - total : -WIN_SCORE + total;
}

/**
 * Decide whether a node result is a persistable certified verdict.
 * Returns { result, distance } (side-to-move POV) or null.
 * A 'lower' bound >= WIN proves the win exists (some searched line delivers it);
 * an 'upper' bound <= -WIN proves the loss. The opposite pairings are mere
 * bounds from cutoffs and must NOT be treated as verdicts.
 */
function provenPersistEntry(score, flag, sideToMove, rootColor, distFromRoot) {
  const provenWin = score >= WIN_SCORE - PROOF_MARGIN && (flag === 'exact' || flag === 'lower');
  const provenLoss = score <= -WIN_SCORE + PROOF_MARGIN && (flag === 'exact' || flag === 'upper');
  if (!provenWin && !provenLoss) return null;
  const winner = provenWin ? rootColor : oppColor(rootColor);
  const distance = Math.max(1, WIN_SCORE - Math.abs(score) - distFromRoot);
  return { result: winner === sideToMove ? 'WIN' : 'LOSS', distance };
}

function flushAtlasWrites(ctx) {
  if (!ctx.store || ctx.writeBuf.length === 0) return;
  ctx.store.putMany(ctx.writeBuf);
  ctx.writeBuf = [];
}

function recordProof(ctx, hash, sideToMove, entry, bestMove) {
  const key = hash + '|' + sideToMove;
  const prev = ctx.atlas.get(key);
  if (prev && prev.distance <= entry.distance) return; // mirror the store's conflict policy
  ctx.atlas.set(key, entry);
  ctx.persisted++;
  if (ctx.store) {
    ctx.writeBuf.push({
      hash: key,
      result: entry.result,
      distance: entry.distance,
      bestMove: bestMove || null,
      source: 'proofSearch',
    });
    if (ctx.writeBuf.length >= FLUSH_THRESHOLD) flushAtlasWrites(ctx);
  }
}
const TT_SHARDS = 8;
const TT_SHARD_CAP = 3_000_000;

function makeTT() {
  const t = new Array(TT_SHARDS);
  for (let i = 0; i < TT_SHARDS; i++) t[i] = new Map();
  return t;
}
function ttShardIdx(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h * 31) + key.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) % TT_SHARDS;
}
function ttGet(tt, key) { return tt[ttShardIdx(key)].get(key); }
function ttSet(tt, key, val) {
  const m = tt[ttShardIdx(key)];
  if (m.size >= TT_SHARD_CAP) m.clear();
  m.set(key, val);
}
function ttSize(tt) { let s = 0; for (let i = 0; i < TT_SHARDS; i++) s += tt[i].size; return s; }

// Find ball-holder's position and color. Returns {color, row, col} or null.
function findBall(board) {
  for (const k of Object.keys(board)) {
    const p = board[k];
    if (p && p.hasBall) {
      return { color: p.color, row: parseInt(k[1], 10), col: k.charCodeAt(0) - 97 };
    }
  }
  return null;
}

/**
 * Order outcomes so alpha-beta cutoffs fire fast.
 * At isMax nodes (rootColor about to gain): try outcomes where rootColor's
 * ball is closest to its goal rank first.
 * At isMin nodes (opponent about to gain): try outcomes where opponent's
 * ball is closest to opponent's goal rank first.
 */
function orderOutcomes(outcomes, rootColor, isMax) {
  // The side that just moved is the side whose turn it WAS — i.e., for a child
  // node, the parent's sideToMove. In our recursion, when we recurse from a
  // node with sideToMove=S, children represent S having moved. So in the
  // CHILD, isMax flips. We just sort by "is rootColor's ball closer to its
  // goal rank?" — that's a generic proxy.
  const rootGoal = rootColor === 'white' ? 8 : 1;
  const oppColor = rootColor === 'white' ? 'black' : 'white';
  const oppGoal = oppColor === 'white' ? 8 : 1;

  const scored = outcomes.map(o => {
    const ball = findBall(o.board);
    let score = 0;
    if (ball) {
      if (ball.color === rootColor) {
        score = -Math.abs(ball.row - rootGoal); // bigger = closer to goal
      } else {
        score = Math.abs(ball.row - oppGoal); // bigger = opp ball farther from opp goal
      }
    }
    return { outcome: o, score };
  });
  // isMax wants rootColor's ball closer to its goal => high score first
  // isMin wants opp's ball closer to opp's goal  => low score first
  scored.sort((a, b) => isMax ? b.score - a.score : a.score - b.score);
  return scored.map(s => s.outcome);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    maxDepth: parseInt(get('--maxDepth', '10'), 10),
    timeLimitMs: parseInt(get('--timeLimitMs', '600000'), 10),
    onlyName: get('--only', null),
    fixturesPath: get('--fixtures', null),
    stopAfterUndecided: parseInt(get('--stopAfterUndecided', '0'), 10),
    dbPath: get('--db', DEFAULT_DB_PATH),
    persist: get('--persist', '1') !== '0',
  };
}

function emptyBoard() {
  const b = {};
  for (let r = 1; r <= 8; r++) {
    for (let f = 0; f < 8; f++) {
      b[String.fromCharCode(97 + f) + r] = null;
    }
  }
  return b;
}

function place(board, pos, code) {
  const color = code.toLowerCase() === 'w' ? 'white' : 'black';
  const hasBall = code === code.toUpperCase();
  board[pos] = { color, hasBall, position: pos, id: `${code}_${pos}` };
}

function pos(spec) {
  const board = emptyBoard();
  for (const [p, code] of spec) place(board, p, code);
  return board;
}

function render(board) {
  const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  let out = '     ' + files.join(' ') + '\n';
  for (const r of ranks) {
    let row = '  ' + r + '  ';
    for (const f of files) {
      const c = board[f + r];
      if (!c) row += '. ';
      else row += (c.color === 'white' ? (c.hasBall ? 'W' : 'w') : (c.hasBall ? 'B' : 'b')) + ' ';
    }
    out += row + '\n';
  }
  return out;
}

function describeMoves(moves) {
  return moves.map(m => {
    if (m.type === 'move') return `move ${m.from}→${m.to}`;
    if (m.type === 'pass') return `pass ${m.from}→${m.to}`;
    return JSON.stringify(m);
  }).join(' + ');
}

/**
 * Pure-terminal minimax with alpha-beta and TT. Returns score from rootColor's POV.
 *   +WIN_SCORE - distanceFromRoot   ⇒ proven win in N plies
 *   -WIN_SCORE + distanceFromRoot   ⇒ proven loss in N plies
 *   0                               ⇒ undecided within depth budget
 */
function proofSearch(board, depth, alpha, beta, isMax, rootColor, sideToMove, ttable, state) {
  if (Date.now() > state.deadline) {
    state.timeUp = true;
    return { score: 0, aborted: true };
  }
  state.nodes++;

  const winner = didWin(board);
  if (winner === rootColor) return { score: WIN_SCORE - (state.rootDepth - depth) };
  if (winner && winner !== rootColor) return { score: -WIN_SCORE + (state.rootDepth - depth) };

  const distFromRoot = state.rootDepth - depth;
  const ctx = state.ctx;
  let hash = null;

  // Atlas probe — certified ground truth from prior runs (and the live engine).
  // Probed even at depth 0: a leaf hit chains onto an earlier proof, seeing
  // past the nominal horizon.
  if (ctx && ctx.atlas.size > 0) {
    hash = hashBoard(board);
    const rec = ctx.atlas.get(hash + '|' + sideToMove);
    if (rec) {
      ctx.atlasHits++;
      return { score: atlasRecToScore(rec, sideToMove, rootColor, distFromRoot) };
    }
  }

  if (depth === 0) return { score: 0 };

  if (hash === null) hash = hashBoard(board);
  const ttKey = `${hash}|${depth}|${sideToMove}`;
  const hit = ttGet(ttable, ttKey);
  if (hit !== undefined) {
    if (hit.flag === 'exact') return { score: hit.score };
    if (hit.flag === 'lower' && hit.score >= beta) return { score: hit.score };
    if (hit.flag === 'upper' && hit.score <= alpha) return { score: hit.score };
  }

  const outcomes = generateTurnOutcomes(board, sideToMove);
  const validOutcomes = outcomes.filter(o => o.moves.length > 0);
  if (validOutcomes.length === 0) return { score: 0 };

  const ordered = orderOutcomes(validOutcomes, rootColor, isMax);
  const nextSide = sideToMove === 'white' ? 'black' : 'white';
  const alphaOrig = alpha;
  const betaOrig = beta;
  let best = isMax ? -Infinity : Infinity;

  for (const outcome of ordered) {
    const r = proofSearch(outcome.board, depth - 1, alpha, beta, !isMax, rootColor, nextSide, ttable, state);
    if (r.aborted) return r;
    if (isMax) {
      if (r.score > best) best = r.score;
      if (best > alpha) alpha = best;
    } else {
      if (r.score < best) best = r.score;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }

  // Classify vs. the ORIGINAL window: a cutoff means `best` is only a bound.
  const flag = best <= alphaOrig ? 'upper' : best >= betaOrig ? 'lower' : 'exact';
  ttSet(ttable, ttKey, { score: best, flag });
  if (ctx) {
    const entry = provenPersistEntry(best, flag, sideToMove, rootColor, distFromRoot);
    if (entry) recordProof(ctx, hash, sideToMove, entry);
  }
  return { score: best };
}

const FIXTURES = [
  {
    name: 'SANITY_immediate_win',
    desc: 'White ball on f7, white piece already on e8. Black far away. White wins by f7→e8 pass next turn — should prove at depth 2.',
    spec: [
      ['e8','w'],
      ['f7','W'],
      ['a1','b'], ['h1','b'],
    ],
    sideToMove: 'black',
    rootColor: 'white',
  },
  {
    name: 'SANITY_two_turn_win',
    desc: 'White ball on f6, white piece on e7. Black two pieces far back rank. Should be forced win in 2-3 turns.',
    spec: [
      ['e7','w'],
      ['f6','W'],
      ['a8','b'], ['h8','b'],
    ],
    sideToMove: 'white',
    rootColor: 'white',
  },
  {
    name: 'P1_naked_f7',
    desc: 'White ball on f7. Black full back rank, ball on e8. Black to defend.',
    spec: [
      ['c8','b'], ['d8','b'], ['e8','B'], ['f8','b'],
      ['f7','W'],
      ['c1','w'], ['d1','w'], ['e1','w'],
    ],
    sideToMove: 'black',
    rootColor: 'black',
  },
  {
    name: 'P2_central_e7',
    desc: 'White ball on e7. Black to defend.',
    spec: [
      ['c8','b'], ['d8','b'], ['e8','B'], ['f8','b'],
      ['e7','W'],
      ['c1','w'], ['d1','w'], ['f1','w'],
    ],
    sideToMove: 'black',
    rootColor: 'black',
  },
  {
    name: 'P4_corner_b7',
    desc: 'White ball on b7 (corner). Black to defend — does corner save anything?',
    spec: [
      ['c8','b'], ['d8','b'], ['e8','B'], ['f8','b'],
      ['b7','W'],
      ['c1','w'], ['d1','w'], ['e1','w'],
    ],
    sideToMove: 'black',
    rootColor: 'black',
  },
];

function fixtureBoard(fixture) {
  return fixture.board ? fixture.board : pos(fixture.spec);
}

function runFixture(fixture, opts, ctx) {
  console.log(`\n=== ${fixture.name} ===`);
  console.log(fixture.desc);
  console.log(render(fixtureBoard(fixture)));

  const state = {
    deadline: Date.now() + opts.timeLimitMs,
    nodes: 0,
    timeUp: false,
    rootDepth: 0,
    ctx,
  };
  const ttable = makeTT();
  const atlasHitsBefore = ctx ? ctx.atlasHits : 0;
  const persistedBefore = ctx ? ctx.persisted : 0;

  let lastResult = null;
  let lastCompletedDepth = 0;
  let bestMoveAtLast = null;

  const maxDepth = fixture.maxDepth || opts.maxDepth;
  for (let d = 1; d <= maxDepth; d++) {
    state.rootDepth = d;
    const board = cloneBoardFast(fixtureBoard(fixture));
    const outcomes = generateTurnOutcomes(board, fixture.sideToMove).filter(o => o.moves.length > 0);
    const nextSide = fixture.sideToMove === 'white' ? 'black' : 'white';
    const isMax = fixture.sideToMove === fixture.rootColor;
    const orderedRoot = orderOutcomes(outcomes, fixture.rootColor, isMax);

    let best = isMax ? -Infinity : Infinity;
    let bestMove = null;
    let aborted = false;
    for (const outcome of orderedRoot) {
      const r = proofSearch(outcome.board, d - 1, -Infinity, Infinity, !isMax, fixture.rootColor, nextSide, ttable, state);
      if (r.aborted) { aborted = true; break; }
      if (isMax ? r.score > best : r.score < best) { best = r.score; bestMove = outcome.moves; }
    }
    if (aborted) {
      console.log(`  depth ${d}: aborted (time up at ${state.nodes.toLocaleString()} nodes)`);
      break;
    }
    lastResult = best;
    lastCompletedDepth = d;
    bestMoveAtLast = bestMove;
    const nodes = state.nodes.toLocaleString();
    const ttSz = ttSize(ttable).toLocaleString();
    let tag = 'undecided';
    if (best >= WIN_SCORE - PROOF_MARGIN) tag = `PROVEN WIN (in ${WIN_SCORE - best} plies)`;
    else if (best <= -WIN_SCORE + PROOF_MARGIN) tag = `PROVEN LOSS (in ${best + WIN_SCORE} plies)`;
    const atlasNote = ctx ? `, atlas hits ${(ctx.atlasHits - atlasHitsBefore).toLocaleString()}, +${(ctx.persisted - persistedBefore).toLocaleString()} proofs` : '';
    console.log(`  depth ${d}: ${tag}  (${nodes} nodes, TT ${ttSz}${atlasNote})`);
    if (ctx) flushAtlasWrites(ctx); // depth boundary = durable checkpoint
    // A proof is terminal — deeper iterations can only re-derive it at higher cost
    if (isProvenScore(best)) break;
  }

  // Persist the root verdict itself. The root loop is full-window with no
  // cutoffs, so a completed iteration's verdict is exact. Recursion has already
  // persisted the subtree's interior proofs; this adds the root + best move.
  if (ctx && lastResult !== null && isProvenScore(lastResult)) {
    const entry = provenPersistEntry(lastResult, 'exact', fixture.sideToMove, fixture.rootColor, 0);
    if (entry) {
      const rootHash = hashBoard(cloneBoardFast(fixtureBoard(fixture)));
      // Store a single move object (not the full turn) — matches the live
      // engine's bestMove convention in aiLogic's persistWrite/persistLookup.
      const firstMove = bestMoveAtLast && bestMoveAtLast.length > 0 ? bestMoveAtLast[0] : null;
      recordProof(ctx, rootHash, fixture.sideToMove, entry, firstMove);
    }
    flushAtlasWrites(ctx);
  }

  console.log(`final: depth ${lastCompletedDepth}, score ${lastResult}`);
  if (bestMoveAtLast) console.log(`best move: ${describeMoves(bestMoveAtLast)}`);
  return { name: fixture.name, depth: lastCompletedDepth, score: lastResult };
}

function openAtlas(opts) {
  if (!opts.persist) return null;
  const store = openStore(opts.dbPath);
  const atlas = new Map();
  for (const row of store.all()) {
    atlas.set(row.hash, { result: row.result, distance: row.distance });
  }
  const ctx = { store, atlas, writeBuf: [], atlasHits: 0, persisted: 0 };
  console.log(`atlas: ${atlas.size.toLocaleString()} proven positions loaded from ${store.dbPath}`);
  return ctx;
}

function closeAtlas(ctx) {
  if (!ctx || !ctx.store) return;
  flushAtlasWrites(ctx);
  ctx.store.close();
  ctx.store = null;
}

function main() {
  const opts = parseArgs();
  const fixtures = opts.fixturesPath
    ? JSON.parse(require('fs').readFileSync(opts.fixturesPath, 'utf8'))
    : FIXTURES;
  console.log(`proof search — max depth ${opts.maxDepth}, time budget ${opts.timeLimitMs / 1000}s per fixture`);
  console.log(`fixtures: ${opts.fixturesPath || 'built-in'} (${fixtures.length} total)`);
  const ctx = openAtlas(opts);
  if (!ctx) console.log('atlas: persistence disabled (--persist 0)');
  console.log('');

  // Long runs die to sleep/session kills — make sure buffered proofs survive.
  const bail = (signal) => {
    console.log(`\n[${signal}] flushing ${ctx ? ctx.writeBuf.length : 0} buffered proofs...`);
    closeAtlas(ctx);
    process.exit(130);
  };
  if (ctx) {
    process.on('SIGINT', () => bail('SIGINT'));
    process.on('SIGTERM', () => bail('SIGTERM'));
  }

  const results = [];
  let consecutiveUndecided = 0;
  for (const fx of fixtures) {
    if (opts.onlyName && fx.name !== opts.onlyName) continue;
    const r = runFixture(fx, opts, ctx);
    results.push(r);
    const proven = r.score !== null && isProvenScore(r.score);
    consecutiveUndecided = proven ? 0 : consecutiveUndecided + 1;
    if (opts.stopAfterUndecided && consecutiveUndecided >= opts.stopAfterUndecided) {
      console.log(`\nstopping: ${consecutiveUndecided} consecutive undecided fixtures (--stopAfterUndecided ${opts.stopAfterUndecided})`);
      break;
    }
  }
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    let tag = 'undecided';
    if (r.score >= WIN_SCORE - PROOF_MARGIN) tag = `PROVEN WIN in ${WIN_SCORE - r.score} plies`;
    else if (r.score <= -WIN_SCORE + PROOF_MARGIN) tag = `PROVEN LOSS in ${r.score + WIN_SCORE} plies`;
    console.log(`  ${r.name.padEnd(20)}  depth ${r.depth}  ${tag}`);
  }
  if (ctx) {
    console.log(`atlas: ${ctx.atlasHits.toLocaleString()} hits, ${ctx.persisted.toLocaleString()} new proofs persisted (${ctx.atlas.size.toLocaleString()} total)`);
    closeAtlas(ctx);
  }
}

if (require.main === module) main();

module.exports = {
  WIN_SCORE,
  PROOF_MARGIN,
  isProvenScore,
  atlasRecToScore,
  provenPersistEntry,
};
