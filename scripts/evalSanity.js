/**
 * Eval sanity harness.
 *
 * Runs a fixed battery of property tests against a chosen eval function.
 * These properties are *ground truth* (provable from the game's rules and
 * symmetries), independent of any hand-tuned heuristic — so any eval that
 * fails one of these is broken on first principles, regardless of dojo
 * win rate.
 *
 * Properties tested:
 *   1. Terminal recognition  — ball on goal rank → ±EVAL_INFINITY
 *   2. POV antisymmetry      — eval(b, white) === -eval(b, black)   [stateless only]
 *   3. Horizontal mirror     — game is L↔R symmetric; eval invariant
 *   4. Color-flip symmetry   — flip board ↑↓ AND swap colors; eval(b, white) === eval(b', black)
 *   5. Initial position      — symmetric start → eval ≈ 0            [stateless only]
 *   6. Scale sanity          — non-terminal |score| ≪ EVAL_INFINITY
 *
 * Properties 2 and 5 are skipped for tempo-aware evals (e.g. the canonicalized
 * NN), which legitimately encode side-to-move into the position value.
 *
 * Usage:
 *   node scripts/evalSanity.js                  # defaults to "impossible" (B-Rabbit)
 *   node scripts/evalSanity.js --eval nn
 *   node scripts/evalSanity.js --eval atomic
 *   node scripts/evalSanity.js --all            # run every eval, print comparison table
 *
 * Exit code is nonzero if any property fails.
 */

const { initializeBoardStatus } = require('../utils/gameInitialization');
const { EVAL_INFINITY } = require('../utils/aiEvalCore');
const {
  evaluateImpossible,
  DEFAULT_IMPOSSIBLE_WEIGHTS,
  TORTUGA_IMPOSSIBLE_WEIGHTS,
  LEGACY_IMPOSSIBLE_WEIGHTS,
} = require('../utils/aiImpossibleEval');
const { evaluateAtomic } = require('../utils/aiAtomicEval');
const { evaluateNN } = require('../utils/aiNNEval');
const { mirrorLR, flipAndSwapColors } = require('../utils/aiBoardSymmetry');

// ============================================================
// EVAL REGISTRY
// ============================================================
// `stateless: true`  — eval depends only on the static board, not on whose turn
//                      it is. POV antisymmetry holds: eval(b, w) === -eval(b, b).
//                      Initial position has no tempo signal → score ≈ 0.
// `stateless: false` — eval is tempo-aware (e.g. canonicalized NN: same physical
//                      board with different sides-to-move are genuinely different
//                      positions). POV antisymmetry and initial-zero are then
//                      not expected and are skipped; color-flip symmetry is
//                      still required (it's a board-level invariant).
const EVALS = {
  impossible: { fn: (b, c) => evaluateImpossible(b, c, DEFAULT_IMPOSSIBLE_WEIGHTS), stateless: true },
  tortuga:    { fn: (b, c) => evaluateImpossible(b, c, TORTUGA_IMPOSSIBLE_WEIGHTS), stateless: true },
  legacy:     { fn: (b, c) => evaluateImpossible(b, c, LEGACY_IMPOSSIBLE_WEIGHTS), stateless: true },
  atomic:     { fn: (b, c) => evaluateAtomic(b, c), stateless: true },
  nn:         { fn: (b, c) => evaluateNN(b, c), stateless: false },
};

// ============================================================
// BOARD HELPERS
// ============================================================
const FILES = 'abcdefgh';

function emptyBoard() {
  const b = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) b[FILES[c] + (8 - r)] = null;
  }
  return b;
}

function buildBoard(pieces) {
  const b = emptyBoard();
  for (const { key, color, hasBall } of pieces) {
    b[key] = { color, hasBall: !!hasBall, position: key, id: key };
  }
  return b;
}

// (mirrorLR / flipAndSwapColors live in utils/aiBoardSymmetry.js)

// ============================================================
// TEST POSITIONS
// ============================================================
function makeTerminalWhiteWin() {
  // White piece holds the ball on row 8 = white's goal row → white has won.
  return buildBoard([
    { key: 'd8', color: 'white', hasBall: true },
    { key: 'a1', color: 'white' },
    { key: 'a8', color: 'black' },
    { key: 'h1', color: 'black', hasBall: true }, // give black its ball somewhere
  ]);
}

function makeMidgamePosition() {
  // Asymmetric, non-terminal: white slightly advanced.
  return buildBoard([
    { key: 'd5', color: 'white', hasBall: true },
    { key: 'e5', color: 'white' },
    { key: 'c4', color: 'white' },
    { key: 'f3', color: 'white' },
    { key: 'd6', color: 'black', hasBall: true },
    { key: 'e6', color: 'black' },
    { key: 'c7', color: 'black' },
    { key: 'b3', color: 'black' },
  ]);
}

// ============================================================
// TESTS
// ============================================================
function approxEq(a, b, tol = 1e-6) {
  if (a === b) return true;
  const m = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / m < tol;
}

function runBattery(evalName, evalFn, stateless) {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });
  const skip = (name, reason) => results.push({ name, skip: true, detail: reason });

  // 1. Terminal recognition
  {
    const b = makeTerminalWhiteWin();
    const wScore = evalFn(b, 'white');
    const bScore = evalFn(b, 'black');
    const pass = wScore >= EVAL_INFINITY * 0.99 && bScore <= -EVAL_INFINITY * 0.99;
    record('terminal_recognition', pass, `white=${wScore.toFixed(2)} black=${bScore.toFixed(2)}`);
  }

  // 2. POV antisymmetry on midgame position — only stateless evals
  if (stateless) {
    const b = makeMidgamePosition();
    const w = evalFn(b, 'white');
    const k = evalFn(b, 'black');
    const pass = approxEq(w, -k);
    record('pov_antisymmetry', pass, `white=${w.toFixed(3)} black=${k.toFixed(3)} sum=${(w + k).toFixed(3)}`);
  } else {
    skip('pov_antisymmetry', 'tempo-aware eval — side-to-move changes position value');
  }

  // 3. Horizontal mirror invariance (holds for both — mirror doesn't change tempo)
  {
    const b = makeMidgamePosition();
    const m = mirrorLR(b);
    const orig = evalFn(b, 'white');
    const mir = evalFn(m, 'white');
    const pass = approxEq(orig, mir, 1e-3);
    record('horizontal_mirror', pass, `orig=${orig.toFixed(3)} mirrored=${mir.toFixed(3)} diff=${(orig - mir).toFixed(3)}`);
  }

  // 4. Color-flip symmetry: board-level invariant — required for both stateless
  //    and tempo-aware evals. Color flip also swaps sideToMove, so the
  //    canonicalized position is identical from "us-to-move" POV.
  {
    const b = makeMidgamePosition();
    const flipped = flipAndSwapColors(b);
    const a = evalFn(b, 'white');
    const c = evalFn(flipped, 'black');
    const pass = approxEq(a, c, 1e-3);
    record('color_flip_symmetry', pass, `orig(white)=${a.toFixed(3)} flipped(black)=${c.toFixed(3)} diff=${(a - c).toFixed(3)}`);
  }

  // 5. Initial position symmetry — only stateless evals. Tempo-aware evals are
  //    allowed (and expected) to encode a first-move advantage here.
  if (stateless) {
    const b = initializeBoardStatus();
    const s = evalFn(b, 'white');
    const tol = EVAL_INFINITY * 0.001;
    const pass = Math.abs(s) < tol;
    record('initial_position_zero', pass, `score=${s.toFixed(3)} (tol=±${tol.toFixed(2)})`);
  } else {
    skip('initial_position_zero', 'tempo-aware eval — first-move advantage is expected');
  }

  // 6. Scale sanity on midgame
  {
    const b = makeMidgamePosition();
    const s = Math.abs(evalFn(b, 'white'));
    const pass = s < EVAL_INFINITY * 0.5;
    record('scale_sanity', pass, `|score|=${s.toFixed(2)} INF=${EVAL_INFINITY}`);
  }

  return { evalName, results };
}

// ============================================================
// CLI
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return { eval: get('--eval', 'impossible'), all: args.includes('--all') };
}

function printReport({ evalName, results }) {
  console.log(`\n=== ${evalName} ===`);
  let failed = 0, ran = 0;
  for (const r of results) {
    const tag = r.skip ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${r.name.padEnd(28)} ${r.detail}`);
    if (r.skip) continue;
    ran++;
    if (!r.pass) failed++;
  }
  console.log(`  -> ${ran - failed}/${ran} pass`);
  return failed;
}

function main() {
  const opts = parseArgs();
  const targets = opts.all ? Object.keys(EVALS) : [opts.eval];
  let totalFailed = 0;
  for (const name of targets) {
    const entry = EVALS[name];
    if (!entry) {
      console.error(`unknown eval: ${name}. options: ${Object.keys(EVALS).join(', ')}`);
      process.exit(2);
    }
    totalFailed += printReport(runBattery(name, entry.fn, entry.stateless));
  }
  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
