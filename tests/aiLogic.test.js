const { describe, it } = require('node:test');
const assert = require('node:assert');
const { initializeBoardStatus } = require('../utils/gameInitialization');
const {
  makeAIMove, minimax, generateTurnOutcomes, AI_CONFIG, DIFFICULTY_CONFIGS,
  getDeliverySquares, winPointCount, reachableWinPoints, defendedWinPoints,
} = require('../utils/aiLogic');
const { passBall, movePiece, cloneBoard } = require('../utils/gameLogic');

// ============================================
// HELPERS
// ============================================

function createMockGame(overrides = {}) {
  return {
    aiColor: 'white',
    currentBoardStatus: initializeBoardStatus(),
    turnNumber: 0,
    moveHistory: [],
    whitePlayerName: 'AI',
    blackPlayerName: 'Human',
    ...overrides,
  };
}

/** Build a sparse board from a piece list: [{ key, color, hasBall }] */
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

// ============================================
// TESTS
// ============================================

describe('AI takes immediate wins', () => {
  it('should pass the ball to the goal row when a winning pass is available', () => {
    // White piece with ball on d7, white piece on d8 (goal row)
    // Passing to d8 wins instantly
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

    const game = createMockGame({ currentBoardStatus: board, aiColor: 'white' });

    for (const difficulty of ['easy', 'medium', 'hard']) {
      const result = makeAIMove(game, difficulty);
      assert.strictEqual(result.status, 'completed', `${difficulty}: should win immediately`);
      assert.strictEqual(result.winner, 'AI', `${difficulty}: AI should be the winner`);
    }
  });

  it('should move a piece to enable a winning pass rather than delaying', () => {
    // White ball on e6, white piece on c5 can move to d7,
    // then pass e6 -> d7 doesn't work (not goal row).
    // Actually set up: white ball holder can pass to a piece on goal row after a move
    const board = buildBoard([
      { key: 'e6', color: 'white', hasBall: true },
      { key: 'c5', color: 'white', hasBall: false },
      { key: 'f1', color: 'white', hasBall: false },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'b6', color: 'black', hasBall: false },
      { key: 'g8', color: 'black', hasBall: false },
      { key: 'h1', color: 'black', hasBall: false },
    ]);

    // c5 can move to d7. Then ball at e6 can pass diagonally? No — passes are straight lines.
    // e6 pass straight up = e7, e8. If we put a piece that can reach e8...
    // Let's simplify: piece at f6 can move to e8 (knight move), then pass e6 -> e8 wins.
    const board2 = buildBoard([
      { key: 'e6', color: 'white', hasBall: true },
      { key: 'f6', color: 'white', hasBall: false },
      { key: 'f1', color: 'white', hasBall: false },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'b6', color: 'black', hasBall: false },
      { key: 'g8', color: 'black', hasBall: false },
      { key: 'h1', color: 'black', hasBall: false },
    ]);

    // f6 -> e8 (knight: -1, +2) then pass e6 -> e8 (straight up)
    // But e7 is empty so pass goes e6 -> e8 only if nothing blocks. e7 is empty, e8 has our piece. Yes!
    const game = createMockGame({ currentBoardStatus: board2, aiColor: 'white' });
    const result = makeAIMove(game, 'hard');
    assert.strictEqual(result.status, 'completed', 'should find the move+pass win');
    assert.strictEqual(result.winner, 'AI');
  });

  it('should prefer winning in 1 turn over winning in 2 turns', () => {
    // Set up a position where the AI can win immediately via pass,
    // OR make a "fancier" move that also leads to a win next turn.
    // The AI must choose the immediate win.
    const board = buildBoard([
      { key: 'e7', color: 'white', hasBall: true },
      { key: 'e8', color: 'white', hasBall: false }, // pass here = instant win
      { key: 'a2', color: 'white', hasBall: false },
      { key: 'h2', color: 'white', hasBall: false },
      { key: 'a7', color: 'black', hasBall: true },
      { key: 'b5', color: 'black', hasBall: false },
      { key: 'c3', color: 'black', hasBall: false },
      { key: 'h8', color: 'black', hasBall: false },
    ]);

    const game = createMockGame({ currentBoardStatus: board, aiColor: 'white' });
    const result = makeAIMove(game, 'hard');

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.winner, 'AI');

    // Verify it was done in this turn (turn 1), not delayed
    assert.strictEqual(result.moveHistory.length, 1);
  });
});

describe('makeAIMove basics', () => {
  it('should return a valid game state from starting position', () => {
    const game = createMockGame();
    const result = makeAIMove(game, 'medium');

    assert.ok(result.currentBoardStatus, 'should have a board');
    assert.strictEqual(result.currentPlayerTurn, 'black', 'should switch turns');
    assert.strictEqual(result.turnNumber, 1);
    assert.ok(result.moveHistory.length > 0, 'should record move history');
  });

  it('should produce a full 64-cell board (not sparse)', () => {
    const game = createMockGame();
    const result = makeAIMove(game, 'medium');

    const keys = Object.keys(result.currentBoardStatus);
    assert.strictEqual(keys.length, 64, 'board should have all 64 cells');

    // Check some empty cells are explicitly null
    const emptyCells = keys.filter(k => result.currentBoardStatus[k] === null);
    assert.ok(emptyCells.length > 50, 'most cells should be null');
  });

  it('should work for all difficulty levels', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const game = createMockGame();
      const result = makeAIMove(game, difficulty);
      assert.ok(result.currentBoardStatus, `${difficulty} should produce a board`);
      assert.strictEqual(result.turnNumber, 1, `${difficulty} should advance turn`);
    }
  });

  it('should work when AI plays black', () => {
    const game = createMockGame({ aiColor: 'black' });
    const result = makeAIMove(game, 'medium');

    assert.strictEqual(result.currentPlayerTurn, 'white');
    assert.strictEqual(result.turnNumber, 1);
  });
});

describe('Board snapshot integrity', () => {
  it('boardSnapshot in history should have 64 cells', () => {
    const game = createMockGame();
    const result = makeAIMove(game, 'medium');

    const entry = result.moveHistory[0];
    assert.ok(entry.boardSnapshot, 'should have boardSnapshot');
    assert.strictEqual(Object.keys(entry.boardSnapshot).length, 64);
  });

  it('actionStates snapshots should have 64 cells', () => {
    const game = createMockGame();
    const result = makeAIMove(game, 'medium');

    const entry = result.moveHistory[0];
    if (entry.actionStates) {
      for (const action of entry.actionStates) {
        assert.strictEqual(
          Object.keys(action.boardSnapshot).length,
          64,
          `${action.actionType} snapshot should have 64 cells`
        );
      }
    }
  });
});

describe('Impossible mode', () => {
  it('should produce a valid move from starting position within time budget', () => {
    const game = createMockGame();
    const start = Date.now();
    const result = makeAIMove(game, 'impossible');
    const elapsed = Date.now() - start;

    assert.ok(result.currentBoardStatus, 'should have a board');
    assert.strictEqual(result.turnNumber, 1);
    assert.ok(result.moveHistory.length > 0, 'should record move history');
    // Budget is 6000ms; allow 2s of slack for the time check granularity
    assert.ok(elapsed < 8000, `should respect time budget (took ${elapsed}ms)`);
  });

  it('should produce a 64-cell board (not sparse)', () => {
    const game = createMockGame();
    const result = makeAIMove(game, 'impossible');
    assert.strictEqual(Object.keys(result.currentBoardStatus).length, 64);
  });

  it('should take an immediate winning pass', () => {
    const board = buildBoard([
      { key: 'd7', color: 'white', hasBall: true },
      { key: 'd8', color: 'white', hasBall: false },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'h1', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'b8', color: 'black', hasBall: false },
      { key: 'c6', color: 'black', hasBall: false },
      { key: 'g1', color: 'black', hasBall: false },
    ]);

    const game = createMockGame({ currentBoardStatus: board, aiColor: 'white' });
    const result = makeAIMove(game, 'impossible');
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.winner, 'AI');
  });

  it('should be configured with depth 8, time budget, and search enhancements', () => {
    const cfg = DIFFICULTY_CONFIGS.impossible;
    assert.strictEqual(cfg.depth, 8);
    assert.strictEqual(cfg.evalFn, 'impossible');
    assert.strictEqual(cfg.topN, 1);
    assert.ok(cfg.timeLimitMs > 0, 'should have time budget');
    assert.ok(cfg.pvs, 'should enable PVS');
    assert.ok(cfg.lmr, 'should enable LMR');
    assert.ok(cfg.quiescence, 'should enable quiescence');
  });

  // Regression test for the TT bound-flag correctness fix.
  // Without exact/lower/upper flags, PVS null-window scout scores get cached
  // as exact values and corrupt subsequent full-window searches — so a PVS
  // run at depth N would produce a *different* score than plain alpha-beta
  // at the same depth. With correct flags, both must return the same score.
  it('PVS yields same minimax score as plain alpha-beta (TT bound-flag regression)', () => {
    const board = buildBoard([
      { key: 'd5', color: 'white', hasBall: true },
      { key: 'c4', color: 'white', hasBall: false },
      { key: 'e4', color: 'white', hasBall: false },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'd4', color: 'black', hasBall: true },
      { key: 'c5', color: 'black', hasBall: false },
      { key: 'e5', color: 'black', hasBall: false },
      { key: 'h8', color: 'black', hasBall: false },
    ]);

    const plainResult = minimax(
      board, 3, -Infinity, Infinity, true, 'white', 'white', 'impossible', new Map()
    );

    const pvsSearchState = {
      deadline: Infinity, nodesSearched: 0, timeUp: false,
      pvs: true, lmr: false, quiescence: false,
    };
    const pvsResult = minimax(
      board, 3, -Infinity, Infinity, true, 'white', 'white', 'impossible', new Map(), pvsSearchState
    );

    assert.strictEqual(
      pvsResult.score, plainResult.score,
      'PVS and plain alpha-beta should agree on the minimax score at the same depth'
    );
  });
});

describe('Win-points features', () => {
  it('getDeliverySquares: ball holder with one clear lane to goal row gives one delivery square', () => {
    // White ball on e6, e7 and e8 are empty → e6's straight-up lane reaches goal row e8.
    // No teammates so chain is just e6.
    const board = buildBoard([
      { key: 'e6', color: 'white', hasBall: true },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'h1', color: 'white', hasBall: false },
      { key: 'b2', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'h8', color: 'black', hasBall: false },
      { key: 'b8', color: 'black', hasBall: false },
      { key: 'g8', color: 'black', hasBall: false },
    ]);

    const { squares } = getDeliverySquares(board, 'white');
    // White's goal row is row 0 (rank 8). e8 = row 0, col 4 → sq index 4.
    assert.ok(squares.includes(4), 'should include e8 as a delivery square');
    assert.strictEqual(winPointCount(board, 'white'), squares.length);
  });

  it('winPointCount: chain extends delivery reach to remote files', () => {
    // White ball on b2. b2 can pass east along rank 2 to ... no friendly there.
    // But a1 (white) is reachable diagonally from b2; from a1 we can reach h1
    // via the empty rank-1 lane. h1's straight-up lane is clear all the way to
    // h8, opening h8 as a delivery square that b2 alone could never reach.
    // This is the whole point of the win-points feature — chain reach matters,
    // not just the ball holder's local lanes.
    const board = buildBoard([
      { key: 'b2', color: 'white', hasBall: true },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'h1', color: 'white', hasBall: false },
      { key: 'd4', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'd5', color: 'black', hasBall: false },
      { key: 'e5', color: 'black', hasBall: false },
      { key: 'c5', color: 'black', hasBall: false },
    ]);
    const { squares } = getDeliverySquares(board, 'white');
    // h8 = row 0, col 7 → sq index 7. Reached via b2 → a1 → h1 → h8 lane.
    assert.ok(squares.includes(7), `chain should expose h8 as a delivery square; got squares=${squares}`);
    assert.ok(winPointCount(board, 'white') >= 2, 'chain should expose multiple win points');
  });

  it('reachableWinPoints: counts squares with own non-ball piece within 2 knight moves', () => {
    // White ball on e6 with clear lane to e8 (delivery square sq=4).
    // White piece at f6 → knight distance from f6 to e8 = 1 (f6 → e8 is a -2,+1 knight jump? let's check)
    // f6 = row 2, col 5. e8 = row 0, col 4. Δrow = -2, Δcol = -1 → valid knight move, dist=1. ✓
    const board = buildBoard([
      { key: 'e6', color: 'white', hasBall: true },
      { key: 'f6', color: 'white', hasBall: false },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'h1', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'b8', color: 'black', hasBall: false },
      { key: 'g8', color: 'black', hasBall: false },
      { key: 'h7', color: 'black', hasBall: false },
    ]);

    const total = winPointCount(board, 'white');
    const reachable = reachableWinPoints(board, 'white', 2);
    assert.ok(total > 0, 'should have at least one win point');
    assert.ok(reachable >= 1, 'f6 should be within 2 knight moves of at least one delivery square');
    assert.ok(reachable <= total, 'reachable cannot exceed total');
  });

  it('defendedWinPoints: counts win points an opponent piece can reach in 1 knight move', () => {
    // White ball on e6 → e8 is a delivery square.
    // Black piece at f6 = 1 knight move from e8 → e8 is "defended"/threatened by black.
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

    const defended = defendedWinPoints(board, 'white', 1);
    assert.ok(defended >= 1, 'black piece at f6 should threaten e8 delivery square');
  });
});

describe('Win detection', () => {
  it('should detect white win (ball on row 8)', () => {
    const board = buildBoard([
      { key: 'e8', color: 'white', hasBall: true },
      { key: 'a1', color: 'white', hasBall: false },
      { key: 'b1', color: 'white', hasBall: false },
      { key: 'c1', color: 'white', hasBall: false },
      { key: 'a8', color: 'black', hasBall: true },
      { key: 'b8', color: 'black', hasBall: false },
      { key: 'c8', color: 'black', hasBall: false },
      { key: 'd8', color: 'black', hasBall: false },
    ]);

    const { didWin } = require('../utils/gameLogic');
    assert.strictEqual(didWin(board), 'white');
  });

  it('should detect black win (ball on row 1)', () => {
    const board = buildBoard([
      { key: 'a8', color: 'white', hasBall: true },
      { key: 'b8', color: 'white', hasBall: false },
      { key: 'c8', color: 'white', hasBall: false },
      { key: 'd8', color: 'white', hasBall: false },
      { key: 'e1', color: 'black', hasBall: true },
      { key: 'a8', color: 'black', hasBall: false },
      { key: 'b7', color: 'black', hasBall: false },
      { key: 'c7', color: 'black', hasBall: false },
    ]);

    const { didWin } = require('../utils/gameLogic');
    assert.strictEqual(didWin(board), 'black');
  });

  it('should return null when no winner', () => {
    const board = initializeBoardStatus();
    const { didWin } = require('../utils/gameLogic');
    assert.strictEqual(didWin(board), null);
  });
});
