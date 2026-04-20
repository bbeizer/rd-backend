/**
 * Regression tests for impossible-mode static eval (extracted module).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { initializeBoardStatus } = require('../utils/gameInitialization');
const { EVAL_INFINITY } = require('../utils/aiEvalCore');
const {
  evaluateImpossible,
  DEFAULT_IMPOSSIBLE_WEIGHTS,
  buildImpossibleEvalContext,
  computeImpossibleFeatureContributions,
  scoreFromImpossibleContributions,
  defendedWinPoints,
  penultimateRankForcedWin,
} = require('../utils/aiImpossibleEval');

/** Sparse board from piece list (same layout as aiLogic.test.js). */
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
  const sparse = {};
  for (const [k, v] of Object.entries(board)) {
    if (v) sparse[k] = v;
  }
  return sparse;
}

function toSparseBoard(fullBoard) {
  const sparse = {};
  for (const [k, v] of Object.entries(fullBoard)) {
    if (v) sparse[k] = v;
  }
  return sparse;
}

describe('Impossible eval module', () => {
  it('starting position is symmetric (score 0 from white perspective)', () => {
    const full = initializeBoardStatus();
    const sparse = toSparseBoard(full);
    assert.strictEqual(
      evaluateImpossible(sparse, 'white', DEFAULT_IMPOSSIBLE_WEIGHTS),
      0,
    );
    assert.strictEqual(
      evaluateImpossible(full, 'white', DEFAULT_IMPOSSIBLE_WEIGHTS),
      0,
    );
    assert.strictEqual(
      evaluateImpossible(sparse, 'black', DEFAULT_IMPOSSIBLE_WEIGHTS),
      0,
    );
  });

  it('buildImpossibleEvalContext exposes both ball holders', () => {
    const sparse = toSparseBoard(initializeBoardStatus());
    const ctx = buildImpossibleEvalContext(sparse, 'white', DEFAULT_IMPOSSIBLE_WEIGHTS);
    assert.equal(ctx.opponentColor, 'black');
    assert.ok(ctx.ballHolder);
    assert.ok(ctx.opponentBallHolder);
    assert.equal(ctx.ballHolder.piece.color, 'white');
    assert.equal(ctx.opponentBallHolder.piece.color, 'black');
  });

  it('terminal win returns ±EVAL_INFINITY', () => {
    const won = buildBoard([
      { key: 'd8', color: 'white', hasBall: true },
      { key: 'c8', color: 'white', hasBall: false },
    ]);
    assert.strictEqual(evaluateImpossible(won, 'white', DEFAULT_IMPOSSIBLE_WEIGHTS), EVAL_INFINITY);
    assert.strictEqual(evaluateImpossible(won, 'black', DEFAULT_IMPOSSIBLE_WEIGHTS), -EVAL_INFINITY);
  });

  it('golden sparse scores (regression anchors)', () => {
    const nearWinWhite = buildBoard([
      { key: 'd7', color: 'white', hasBall: true },
      { key: 'f1', color: 'white', hasBall: false },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'd8', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'b8', color: 'black', hasBall: false },
      { key: 'c6', color: 'black', hasBall: false },
      { key: 'h1', color: 'black', hasBall: false },
    ]);
    assert.strictEqual(evaluateImpossible(nearWinWhite, 'white', DEFAULT_IMPOSSIBLE_WEIGHTS), 612);
    assert.strictEqual(evaluateImpossible(nearWinWhite, 'black', DEFAULT_IMPOSSIBLE_WEIGHTS), -692);

    const minimal = buildBoard([
      { key: 'e4', color: 'white', hasBall: true },
      { key: 'e5', color: 'white', hasBall: false },
      { key: 'd4', color: 'black', hasBall: true },
      { key: 'd5', color: 'black', hasBall: false },
    ]);
    assert.strictEqual(evaluateImpossible(minimal, 'white', DEFAULT_IMPOSSIBLE_WEIGHTS), 110);
  });

  it('weighted sum of contributions matches evaluateImpossible (non-terminal)', () => {
    const board = buildBoard([
      { key: 'd7', color: 'white', hasBall: true },
      { key: 'f1', color: 'white', hasBall: false },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'd8', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'b8', color: 'black', hasBall: false },
      { key: 'c6', color: 'black', hasBall: false },
      { key: 'h1', color: 'black', hasBall: false },
    ]);
    const w = DEFAULT_IMPOSSIBLE_WEIGHTS;
    const contrib = computeImpossibleFeatureContributions(board, 'white', w);
    assert.strictEqual(scoreFromImpossibleContributions(w, contrib), evaluateImpossible(board, 'white', w));
  });

  it('defendedWinPoints motif: opponent can threaten a delivery square in 1 knight move', () => {
    const board = buildBoard([
      { key: 'e6', color: 'white', hasBall: true },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'h1', color: 'white', hasBall: false },
      { key: 'b2', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'f6', color: 'black', hasBall: false },
      { key: 'h8', color: 'black', hasBall: false },
      { key: 'h7', color: 'black', hasBall: false },
    ]);
    assert.ok(defendedWinPoints(board, 'white', 1) >= 1);
  });

  it('penultimateRankForcedWin motif: returns positive on constructed forced-pressure', () => {
    const board = buildBoard([
      { key: 'd7', color: 'white', hasBall: true },
      { key: 'f7', color: 'white', hasBall: false },
      { key: 'c8', color: 'white', hasBall: false },
      { key: 'e8', color: 'white', hasBall: false },
      { key: 'h1', color: 'black', hasBall: false },
    ]);
    assert.ok(penultimateRankForcedWin(board, 'white') >= 1);
  });

  it('Phase C-lite atomics: computed only when that weight is non-zero', () => {
    const board = buildBoard([
      { key: 'e4', color: 'white', hasBall: true },
      { key: 'e5', color: 'white', hasBall: false },
      { key: 'd4', color: 'black', hasBall: true },
      { key: 'd5', color: 'black', hasBall: false },
    ]);
    const c0 = computeImpossibleFeatureContributions(board, 'white', DEFAULT_IMPOSSIBLE_WEIGHTS);
    assert.strictEqual(c0.atomicBallGoalKnightGap, undefined);

    const zeroAll = { ...DEFAULT_IMPOSSIBLE_WEIGHTS };
    for (const k of Object.keys(zeroAll)) zeroAll[k] = 0;
    zeroAll.atomicBallGoalKnightGap = 1;
    const c1 = computeImpossibleFeatureContributions(board, 'white', zeroAll);
    assert.ok(typeof c1.atomicBallGoalKnightGap === 'number');
    assert.strictEqual(c1.ballAdvancement, undefined);
  });
});
