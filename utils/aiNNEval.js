/**
 * Neural-net static evaluation.
 *
 * Loads mlp_weights.json (3-layer MLP: 259 → 64 → 32 → 1, ReLU on hidden layers,
 * linear output) once at module load. Output is a heuristic score in roughly the
 * same units as the search score (~ -1800 .. +1400), from the eval-target color's
 * perspective.
 *
 * Feature order is dictated by mlp_weights.json#feature_keys: 4 planes × 64 cells
 * in a8→h1 order (pW, pB, bW, bB) followed by 3 scalar features.
 *
 * Exports a default `evaluateNN` (canonical mlp_weights.json) and a factory
 * `createNNEvaluator(weightsPath)` for loading alternate weights — used by the
 * dojo for A/B comparisons between trained NNs (e.g. round-N vs combo_big).
 * Each evaluator has its own scratch buffers and weight matrices; do not call
 * concurrently.
 */

const path = require('path');
const fs = require('fs');
const { toCellKey } = require('./gameLogic');
const { EVAL_INFINITY, didWin } = require('./aiEvalCore');
const {
  minKnightBallToGoalRow,
  minKnightAllyToBall,
  countCenterRegionPieces,
} = require('./aiAtomicEval');
const { flipAndSwapColors } = require('./aiBoardSymmetry');

function createNNEvaluator(weightsPath) {
  const raw = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));

  const FEATURE_KEYS = raw.feature_keys;
  const N_IN = FEATURE_KEYS.length;
  const N_H1 = raw.b1.length;
  const N_H2 = raw.b2.length;

  // Sanity: feature_keys order must match the cell iteration we use below.
  // Build the cell list in a8→h1 order (row 0..7, col 0..7).
  const ALL_CELLS = (() => {
    const cells = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) cells.push(toCellKey(r, c));
    }
    return cells;
  })();
  for (let i = 0; i < 64; i++) {
    if (FEATURE_KEYS[i] !== `pW_${ALL_CELLS[i]}`) {
      throw new Error(`${weightsPath} feature order mismatch at ${i}: ${FEATURE_KEYS[i]}`);
    }
  }

  function flatten(mat, rows, cols) {
    const a = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) {
      const row = mat[i];
      for (let j = 0; j < cols; j++) a[i * cols + j] = row[j];
    }
    return a;
  }
  const W1 = flatten(raw.W1, N_H1, N_IN);
  const b1 = Float64Array.from(raw.b1);
  const W2 = flatten(raw.W2, N_H2, N_H1);
  const b2 = Float64Array.from(raw.b2);
  const W3 = Float64Array.from(raw.W3[0]);
  const b3 = raw.b3[0];

  // Per-evaluator scratch buffers — eval is single-threaded, so this is safe
  // and avoids allocating ~3KB per leaf evaluation in the search.
  const x = new Float64Array(N_IN);
  const h1 = new Float64Array(N_H1);
  const h2 = new Float64Array(N_H2);

  function buildInputVector(board) {
    x.fill(0);
    // 4 planes × 64 cells. Indices: pW [0..63], pB [64..127], bW [128..191], bB [192..255].
    for (let i = 0; i < 64; i++) {
      const p = board[ALL_CELLS[i]];
      if (!p) continue;
      if (p.color === 'white') {
        x[i] = 1;
        if (p.hasBall) x[128 + i] = 1;
      } else {
        x[64 + i] = 1;
        if (p.hasBall) x[192 + i] = 1;
      }
    }
    // 3 scalar features (white-perspective deltas).
    x[256] = minKnightBallToGoalRow(board, 'black') - minKnightBallToGoalRow(board, 'white');
    x[257] = minKnightAllyToBall(board, 'black') - minKnightAllyToBall(board, 'white');
    x[258] = countCenterRegionPieces(board, 'white') - countCenterRegionPieces(board, 'black');
  }

  function forward() {
    for (let i = 0; i < N_H1; i++) {
      let s = b1[i];
      const off = i * N_IN;
      for (let j = 0; j < N_IN; j++) s += W1[off + j] * x[j];
      h1[i] = s > 0 ? s : 0;
    }
    for (let i = 0; i < N_H2; i++) {
      let s = b2[i];
      const off = i * N_H1;
      for (let j = 0; j < N_H1; j++) s += W2[off + j] * h1[j];
      h2[i] = s > 0 ? s : 0;
    }
    let y = b3;
    for (let i = 0; i < N_H2; i++) y += W3[i] * h2[i];
    return y;
  }

  function evaluateNN(board, color) {
    const winner = didWin(board);
    if (winner === color) return EVAL_INFINITY;
    if (winner) return -EVAL_INFINITY;
    // Canonicalize to "us-to-move": when evaluating from black's perspective,
    // flip the board so the eval-target color appears as white. The NN was
    // trained with matching canonicalization, so output is already from the
    // requested color's POV — no post-hoc negation. Enforces color-flip
    // symmetry architecturally.
    const canon = color === 'white' ? board : flipAndSwapColors(board);
    buildInputVector(canon);
    return forward();
  }

  return { evaluateNN, FEATURE_KEYS };
}

const DEFAULT_WEIGHTS_PATH = path.resolve(__dirname, '..', 'mlp_weights.json');
const defaultEvaluator = createNNEvaluator(DEFAULT_WEIGHTS_PATH);

module.exports = {
  evaluateNN: defaultEvaluator.evaluateNN,
  FEATURE_KEYS: defaultEvaluator.FEATURE_KEYS,
  createNNEvaluator,
};
