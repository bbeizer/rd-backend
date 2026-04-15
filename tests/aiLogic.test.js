const { describe, it } = require('node:test');
const assert = require('node:assert');
const { initializeBoardStatus } = require('../utils/gameInitialization');
const { makeAIMove, minimax, generateTurnOutcomes, AI_CONFIG, DIFFICULTY_CONFIGS } = require('../utils/aiLogic');
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
