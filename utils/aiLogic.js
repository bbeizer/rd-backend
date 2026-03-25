/**
 * AI Logic for Razzle Dazzle
 * Minimax algorithm with alpha-beta pruning for intelligent AI moves
 */

const {
  getKeyCoordinates,
  toCellKey,
  getPieceMoves,
  getValidPasses,
  didWin,
  cloneBoard,
  movePiece,
  passBall,
} = require('./gameLogic');

// ============================================
// CONFIGURATION
// ============================================

const AI_CONFIG = {
  DEFAULT_DEPTH: 3,
  INFINITY: 10000,
};

// ============================================
// BOARD HELPERS
// ============================================

/**
 * Find all pieces of a given color on the board
 * @param {Object} board - Current board state
 * @param {string} color - 'white' or 'black'
 * @returns {Array<{cellKey: string, piece: Object}>}
 */
function findPieces(board, color) {
  const pieces = [];
  for (const cellKey of Object.keys(board)) {
    const piece = board[cellKey];
    if (piece && piece.color === color) {
      pieces.push({ cellKey, piece });
    }
  }
  return pieces;
}

/**
 * Find the ball holder for a given color
 * @param {Object} board - Current board state
 * @param {string} color - 'white' or 'black'
 * @returns {{cellKey: string, piece: Object}|null}
 */
function findBallHolder(board, color) {
  for (const cellKey of Object.keys(board)) {
    const piece = board[cellKey];
    if (piece && piece.color === color && piece.hasBall) {
      return { cellKey, piece };
    }
  }
  return null;
}

// ============================================
// MOVE GENERATION
// ============================================

/**
 * Generate all possible turn outcomes for a color
 * A turn can include: pass only, move only, or move + pass
 * @param {Object} board - Current board state
 * @param {string} color - 'white' or 'black'
 * @returns {Array<{board: Object, moves: Array}>}
 */
function generateTurnOutcomes(board, color) {
  const outcomes = [];
  const pieces = findPieces(board, color);
  const ballHolder = findBallHolder(board, color);

  // Option 1: Pass only (if ball holder has valid passes)
  if (ballHolder) {
    const passes = getValidPasses(ballHolder.cellKey, color, board);
    for (const passTarget of passes) {
      const newBoard = passBall(ballHolder.cellKey, passTarget, board);
      outcomes.push({
        board: newBoard,
        moves: [{ type: 'pass', from: ballHolder.cellKey, to: passTarget }],
      });
    }
  }

  // Option 2: Move only (any piece without the ball)
  for (const { cellKey, piece } of pieces) {
    if (!piece.hasBall) {
      const moves = getPieceMoves(cellKey, board, false, null);
      for (const moveTarget of moves) {
        const newBoard = movePiece(cellKey, moveTarget, board);
        outcomes.push({
          board: newBoard,
          moves: [{ type: 'move', from: cellKey, to: moveTarget }],
        });
      }
    }
  }

  // Option 3: Move + Pass (move a piece, then pass the ball)
  for (const { cellKey, piece } of pieces) {
    if (!piece.hasBall) {
      const moves = getPieceMoves(cellKey, board, false, null);
      for (const moveTarget of moves) {
        const boardAfterMove = movePiece(cellKey, moveTarget, board);

        // Find ball holder in new board state
        const newBallHolder = findBallHolder(boardAfterMove, color);
        if (newBallHolder) {
          const passes = getValidPasses(newBallHolder.cellKey, color, boardAfterMove);
          for (const passTarget of passes) {
            const finalBoard = passBall(newBallHolder.cellKey, passTarget, boardAfterMove);
            outcomes.push({
              board: finalBoard,
              moves: [
                { type: 'move', from: cellKey, to: moveTarget },
                { type: 'pass', from: newBallHolder.cellKey, to: passTarget },
              ],
            });
          }
        }
      }
    }
  }

  // Option 4: No action (do nothing) - always valid, but lowest priority
  outcomes.push({
    board: cloneBoard(board),
    moves: [],
  });

  return outcomes;
}

// ============================================
// POSITION EVALUATION
// ============================================

/**
 * Evaluate board position from a color's perspective
 * @param {Object} board - Current board state
 * @param {string} color - Color to evaluate for ('white' or 'black')
 * @returns {number} Score (positive = good for color, negative = bad)
 */
function evaluatePosition(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  // Check terminal states first
  const winner = didWin(board);
  if (winner === color) {
    return AI_CONFIG.INFINITY;
  }
  if (winner === opponentColor) {
    return -AI_CONFIG.INFINITY;
  }

  let score = 0;

  // Goal row for each color
  const goalRow = color === 'white' ? 0 : 7; // Row index: white wants row 8 (index 0), black wants row 1 (index 7)
  const opponentGoalRow = color === 'white' ? 7 : 0;

  // Find ball holder for scoring
  const ballHolder = findBallHolder(board, color);
  const opponentBallHolder = findBallHolder(board, opponentColor);

  // Ball proximity to goal (weight: 100 per row closer)
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    const distanceToGoal = Math.abs(row - goalRow);
    score += (7 - distanceToGoal) * 100;

    // Bonus for passing options (weight: 15 per option)
    const passes = getValidPasses(ballHolder.cellKey, color, board);
    score += passes.length * 15;
  }

  // Opponent ball proximity penalty
  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    const distanceToGoal = Math.abs(row - opponentGoalRow);
    score -= (7 - distanceToGoal) * 80; // Slightly less weight for opponent
  }

  // Piece advancement (weight: 10 per row advanced)
  const myPieces = findPieces(board, color);
  const opponentPieces = findPieces(board, opponentColor);

  for (const { cellKey } of myPieces) {
    const { row } = getKeyCoordinates(cellKey);
    const advancement = color === 'white' ? (7 - row) : row;
    score += advancement * 10;
  }

  // Opponent advancement penalty (weight: -8 per row)
  for (const { cellKey } of opponentPieces) {
    const { row } = getKeyCoordinates(cellKey);
    const advancement = opponentColor === 'white' ? (7 - row) : row;
    score -= advancement * 8;
  }

  return score;
}

// ============================================
// MINIMAX ALGORITHM
// ============================================

/**
 * Minimax with alpha-beta pruning
 * @param {Object} board - Current board state
 * @param {number} depth - Remaining search depth
 * @param {number} alpha - Alpha value for pruning
 * @param {number} beta - Beta value for pruning
 * @param {boolean} isMaximizing - True if maximizing player's turn
 * @param {string} aiColor - AI's color
 * @param {string} currentTurn - Whose turn it is ('white' or 'black')
 * @returns {{score: number, moves: Array}}
 */
function minimax(board, depth, alpha, beta, isMaximizing, aiColor, currentTurn) {
  // Terminal conditions
  const winner = didWin(board);
  if (winner) {
    return {
      score: winner === aiColor ? AI_CONFIG.INFINITY : -AI_CONFIG.INFINITY,
      moves: [],
    };
  }

  if (depth === 0) {
    return {
      score: evaluatePosition(board, aiColor),
      moves: [],
    };
  }

  const outcomes = generateTurnOutcomes(board, currentTurn);
  const nextTurn = currentTurn === 'white' ? 'black' : 'white';

  if (isMaximizing) {
    let bestScore = -Infinity;
    let bestMoves = [];

    for (const outcome of outcomes) {
      const result = minimax(
        outcome.board,
        depth - 1,
        alpha,
        beta,
        false,
        aiColor,
        nextTurn
      );

      if (result.score > bestScore) {
        bestScore = result.score;
        bestMoves = outcome.moves;
      }

      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) {
        break; // Beta cutoff
      }
    }

    return { score: bestScore, moves: bestMoves };
  } else {
    let bestScore = Infinity;
    let bestMoves = [];

    for (const outcome of outcomes) {
      const result = minimax(
        outcome.board,
        depth - 1,
        alpha,
        beta,
        true,
        aiColor,
        nextTurn
      );

      if (result.score < bestScore) {
        bestScore = result.score;
        bestMoves = outcome.moves;
      }

      beta = Math.min(beta, bestScore);
      if (beta <= alpha) {
        break; // Alpha cutoff
      }
    }

    return { score: bestScore, moves: bestMoves };
  }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

/**
 * Make the best AI move using minimax
 * @param {Object} game - Current game state
 * @param {number} [depth] - Search depth (default: AI_CONFIG.DEFAULT_DEPTH)
 * @returns {Object} Updated game state after AI move (turn switched back to player)
 */
function makeAIMove(game, depth = AI_CONFIG.DEFAULT_DEPTH) {
  const aiColor = game.aiColor;
  if (!aiColor) return game;

  const board = cloneBoard(game.currentBoardStatus);

  // Run minimax to find best moves
  const result = minimax(
    board,
    depth,
    -Infinity,
    Infinity,
    true,
    aiColor,
    aiColor
  );

  // Apply the best moves to the board
  let newBoard = board;
  for (const move of result.moves) {
    if (move.type === 'move') {
      newBoard = movePiece(move.from, move.to, newBoard);
    } else if (move.type === 'pass') {
      newBoard = passBall(move.from, move.to, newBoard);
    }
  }

  // Check win condition
  const winner = didWin(newBoard);

  // Switch turn back to the player after AI move
  const playerColor = aiColor === 'white' ? 'black' : 'white';

  const newGame = {
    ...game,
    currentBoardStatus: newBoard,
    currentPlayerTurn: playerColor,
    turnNumber: (game.turnNumber || 0) + 1,
    activePiece: null,
    movedPiece: { position: null },
    originalSquare: null,
    hasMoved: false,
    possibleMoves: [],
    possiblePasses: [],
  };

  if (winner) {
    newGame.status = 'completed';
    newGame.winner = winner === 'white' ? game.whitePlayerName : game.blackPlayerName;
  }

  return newGame;
}

module.exports = {
  makeAIMove,
  evaluatePosition,
  generateTurnOutcomes,
  minimax,
  AI_CONFIG,
};
