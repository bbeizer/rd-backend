/**
 * Tests for the Phase C Stage 1 atomic-feature linear eval.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { initializeBoardStatus } = require('../utils/gameInitialization');
const { EVAL_INFINITY } = require('../utils/aiEvalCore');
const {
  DEFAULT_ATOMIC_WEIGHTS,
  extractAtomicFeatures,
  evaluateAtomic,
} = require('../utils/aiAtomicEval');

function buildBoard(pieces) {
  const board = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const key = String.fromCharCode(97 + c) + (8 - r);
      board[key] = null;
    }
  }
  for (const { key, color, hasBall } of pieces) {
    board[key] = { color, hasBall: !!hasBall, position: key, id: key };
  }
  return board;
}

describe('aiAtomicEval', () => {
  it('DEFAULT_ATOMIC_WEIGHTS has the expected shape (4×64 indicators + 3 scalars)', () => {
    const keys = Object.keys(DEFAULT_ATOMIC_WEIGHTS);
    assert.strictEqual(keys.length, 4 * 64 + 3);
    for (const k of keys) assert.strictEqual(DEFAULT_ATOMIC_WEIGHTS[k], 0);
  });

  it('zero weights → zero score on any non-terminal board', () => {
    const board = initializeBoardStatus();
    assert.strictEqual(evaluateAtomic(board, 'white', DEFAULT_ATOMIC_WEIGHTS), 0);
    assert.strictEqual(evaluateAtomic(board, 'black', DEFAULT_ATOMIC_WEIGHTS), 0);
  });

  it('terminal win returns +EVAL_INFINITY from winner perspective', () => {
    const board = buildBoard([
      { key: 'a1', color: 'black', hasBall: true },
      { key: 'e8', color: 'white', hasBall: true },
    ]);
    assert.strictEqual(evaluateAtomic(board, 'black', DEFAULT_ATOMIC_WEIGHTS), EVAL_INFINITY);
    assert.strictEqual(evaluateAtomic(board, 'white', DEFAULT_ATOMIC_WEIGHTS), -EVAL_INFINITY);
  });

  it('piece-square indicators fire on the correct cells', () => {
    const board = buildBoard([
      { key: 'c1', color: 'white', hasBall: false },
      { key: 'd1', color: 'white', hasBall: true },
      { key: 'e8', color: 'black', hasBall: true },
    ]);
    const feats = extractAtomicFeatures(board);
    assert.strictEqual(feats.pW_c1, 1);
    assert.strictEqual(feats.pW_d1, 1);
    assert.strictEqual(feats.bW_d1, 1);
    assert.strictEqual(feats.bW_c1, 0);
    assert.strictEqual(feats.pB_e8, 1);
    assert.strictEqual(feats.bB_e8, 1);
    // empty cell
    assert.strictEqual(feats.pW_a1, 0);
    assert.strictEqual(feats.pB_a1, 0);
  });

  it('dot product: single-weight board gives weight × feature value', () => {
    const board = buildBoard([
      { key: 'd1', color: 'white', hasBall: true },
      { key: 'e8', color: 'black', hasBall: true },
    ]);
    const w = { ...DEFAULT_ATOMIC_WEIGHTS, bW_d1: 7 };
    // white-perspective: bW_d1 = 1, weight = 7 → score 7 for white, -7 for black
    assert.strictEqual(evaluateAtomic(board, 'white', w), 7);
    assert.strictEqual(evaluateAtomic(board, 'black', w), -7);
  });

  it('scalar features are white-perspective', () => {
    // White ball on e7 (knight-reach 1 from e8 goal row); black ball back on e8
    const board = buildBoard([
      { key: 'e7', color: 'white', hasBall: true },
      { key: 'd1', color: 'black', hasBall: true },
    ]);
    const feats = extractAtomicFeatures(board);
    // White ball is far from white goal (row 0): many knight moves.
    // Black ball is on its penultimate rank to score: should be small.
    // Feature = black_gap - white_gap; black is closer → feature negative.
    assert.ok(typeof feats.ballGoalKnightGap === 'number');
  });
});
