/**
 * AI Logic for Razzle Dazzle
 * Minimax algorithm with alpha-beta pruning and difficulty-based evaluation
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
  INFINITY: 10000,
};

const DIFFICULTY_CONFIGS = {
  easy:   { depth: 1, evalFn: 'simple',   topN: 3 },
  medium: { depth: 3, evalFn: 'standard', topN: 1 },
  hard:   { depth: 4, evalFn: 'advanced', topN: 1 },
};

// ============================================
// ZOBRIST HASHING
// ============================================

// Generate deterministic pseudo-random 32-bit integers for Zobrist keys.
// Using a simple seeded PRNG so hashes are consistent across runs.
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0);
  };
}

const _rng = mulberry32(0xDEADBEEF);

// Piece types: white, white+ball, black, black+ball = 4 types
// Squares: 64 (a1-h8)
// zobristTable[squareIndex][pieceType] = random 32-bit int
const ZOBRIST_TABLE = [];
for (let sq = 0; sq < 64; sq++) {
  ZOBRIST_TABLE[sq] = [_rng(), _rng(), _rng(), _rng()];
}

function pieceTypeIndex(piece) {
  // 0=white, 1=white+ball, 2=black, 3=black+ball
  return (piece.color === 'white' ? 0 : 2) + (piece.hasBall ? 1 : 0);
}

function squareIndex(cellKey) {
  const col = cellKey.charCodeAt(0) - 97; // a=0
  const row = 8 - parseInt(cellKey.slice(1), 10); // 8->0, 1->7
  return row * 8 + col;
}

function hashBoard(board) {
  let h = 0;
  for (const cellKey of Object.keys(board)) {
    const piece = board[cellKey];
    if (piece) {
      h ^= ZOBRIST_TABLE[squareIndex(cellKey)][pieceTypeIndex(piece)];
    }
  }
  return h;
}

// ============================================
// BOARD HELPERS
// ============================================

/**
 * Find all pieces of a given color on the board
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

/**
 * Get advancement value for a row (how far toward goal)
 * White advances toward row 0 (row 8), black toward row 7 (row 1)
 */
function getAdvancement(row, color) {
  return color === 'white' ? (7 - row) : row;
}


// ============================================
// MOVE GENERATION
// ============================================

/**
 * Generate all possible turn outcomes for a color
 * A turn can include: pass only, move only, or move + pass
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

  // Option 4: No action (always valid fallback)
  outcomes.push({
    board: cloneBoard(board),
    moves: [],
  });

  return outcomes;
}

// ============================================
// PASSING CHAIN ANALYSIS
// ============================================

/**
 * BFS from ball holder through valid passes to find how far the ball
 * can travel via a chain of passes. This is the core strategic metric.
 *
 * Returns:
 *   furthestAdvancement - max rows toward goal reachable via chain (0-7)
 *   reachesGoal - whether any chain path reaches the goal row
 *   chainSize - number of pieces reachable in the passing network
 */
function computePassingChain(board, color) {
  const ballHolder = findBallHolder(board, color);
  if (!ballHolder) return { furthestAdvancement: 0, reachesGoal: false, chainSize: 0 };

  const visited = new Set([ballHolder.cellKey]);
  let queue = [ballHolder.cellKey];
  let furthestAdvancement = getAdvancement(getKeyCoordinates(ballHolder.cellKey).row, color);

  while (queue.length > 0) {
    const nextQueue = [];
    for (const cellKey of queue) {
      const passes = getValidPasses(cellKey, color, board);
      for (const passTarget of passes) {
        if (!visited.has(passTarget)) {
          visited.add(passTarget);
          nextQueue.push(passTarget);

          const { row } = getKeyCoordinates(passTarget);
          const advancement = getAdvancement(row, color);
          if (advancement > furthestAdvancement) {
            furthestAdvancement = advancement;
          }
        }
      }
    }
    queue = nextQueue;
  }

  const reachesGoal = furthestAdvancement === 7;
  return { furthestAdvancement, reachesGoal, chainSize: visited.size };
}

/**
 * Classify passes from ball holder into forward, lateral, backward
 */
function classifyPasses(board, color) {
  const ballHolder = findBallHolder(board, color);
  if (!ballHolder) return { forward: 0, lateral: 0, backward: 0 };

  const passes = getValidPasses(ballHolder.cellKey, color, board);
  const holderRow = getKeyCoordinates(ballHolder.cellKey).row;
  const holderAdv = getAdvancement(holderRow, color);

  let forward = 0, lateral = 0, backward = 0;

  for (const passTarget of passes) {
    const { row } = getKeyCoordinates(passTarget);
    const targetAdv = getAdvancement(row, color);

    if (targetAdv > holderAdv) forward++;
    else if (targetAdv === holderAdv) lateral++;
    else backward++;
  }

  return { forward, lateral, backward };
}

/**
 * Count how many of the opponent's passing lanes we block.
 * For each opponent piece, cast rays in 8 directions.
 * If the first piece encountered is ours, that's a blocked lane.
 */
function countBlockedLanes(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';
  const opponentPieces = findPieces(board, opponentColor);
  let blocked = 0;

  const directions = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];

  for (const { cellKey } of opponentPieces) {
    const { row, col } = getKeyCoordinates(cellKey);

    for (const { dx, dy } of directions) {
      let r = row + dy;
      let c = col + dx;

      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = board[toCellKey(r, c)];
        if (target) {
          if (target.color === color) blocked++;
          break; // stop at first piece regardless
        }
        r += dy;
        c += dx;
      }
    }
  }

  return blocked;
}

/**
 * Count pieces that can both receive the ball AND pass it forward.
 * These "relay" pieces form the backbone of a passing chain.
 * Checks pass lines directly without cloning the board.
 */
function countRelayPieces(board, color) {
  const pieces = findPieces(board, color);
  let relays = 0;

  const directions = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];

  for (const { cellKey, piece } of pieces) {
    if (piece.hasBall) continue;

    const pieceRow = getKeyCoordinates(cellKey).row;
    const pieceCol = getKeyCoordinates(cellKey).col;
    const pieceAdv = getAdvancement(pieceRow, color);

    // Check if any direction has a friendly piece further toward goal
    let hasForwardTarget = false;
    for (const { dx, dy } of directions) {
      let r = pieceRow + dy;
      let c = pieceCol + dx;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = board[toCellKey(r, c)];
        if (target) {
          if (target.color === color && getAdvancement(r, color) > pieceAdv) {
            hasForwardTarget = true;
          }
          break;
        }
        r += dy;
        c += dx;
      }
      if (hasForwardTarget) break;
    }

    if (hasForwardTarget) relays++;
  }

  return relays;
}

/**
 * Sum knight mobility for all non-ball pieces
 */
function countKnightMobility(board, color) {
  const pieces = findPieces(board, color);
  let mobility = 0;

  for (const { cellKey, piece } of pieces) {
    if (!piece.hasBall) {
      mobility += getPieceMoves(cellKey, board, false, null).length;
    }
  }

  return mobility;
}

// ============================================
// EVALUATION FUNCTIONS
// ============================================

/**
 * Simple eval (Easy mode) - just ball proximity + random noise
 */
function evaluateSimple(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  const winner = didWin(board);
  if (winner === color) return AI_CONFIG.INFINITY;
  if (winner === opponentColor) return -AI_CONFIG.INFINITY;

  let score = 0;

  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * 80;
  }

  const opponentBallHolder = findBallHolder(board, opponentColor);
  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    score -= getAdvancement(row, opponentColor) * 60;
  }

  // Random noise makes easy AI unpredictable and beatable
  score += Math.random() * 300 - 150;

  return score;
}

/**
 * Standard eval (Medium mode) - improved version of original with directional passes
 */
function evaluateStandard(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  const winner = didWin(board);
  if (winner === color) return AI_CONFIG.INFINITY;
  if (winner === opponentColor) return -AI_CONFIG.INFINITY;

  let score = 0;

  // Ball proximity to goal
  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * 100;

    // Directional pass quality
    const passes = classifyPasses(board, color);
    score += passes.forward * 25;
    score += passes.lateral * 10;
    score += passes.backward * 5;
  }

  // Opponent ball proximity penalty
  const opponentBallHolder = findBallHolder(board, opponentColor);
  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    score -= getAdvancement(row, opponentColor) * 90;

    // Opponent directional passes (at 80% weight)
    const oppPasses = classifyPasses(board, opponentColor);
    score -= oppPasses.forward * 20;
    score -= oppPasses.lateral * 8;
    score -= oppPasses.backward * 4;
  }

  // Piece advancement
  const myPieces = findPieces(board, color);
  for (const { cellKey } of myPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score += getAdvancement(row, color) * 8;
  }

  const opponentPieces = findPieces(board, opponentColor);
  for (const { cellKey } of opponentPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score -= getAdvancement(row, opponentColor) * 6;
  }

  return score;
}

/**
 * Advanced eval (Hard mode) - full strategic analysis with passing chains
 */
function evaluateAdvanced(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  const winner = didWin(board);
  if (winner === color) return AI_CONFIG.INFINITY;
  if (winner === opponentColor) return -AI_CONFIG.INFINITY;

  let score = 0;

  // --- Offensive evaluation ---

  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * 100;

    // Directional passes
    const passes = classifyPasses(board, color);
    score += passes.forward * 25;
    score += passes.lateral * 10;
    score += passes.backward * 5;

    const totalPasses = passes.forward + passes.lateral + passes.backward;

    // Ball isolation penalty
    if (totalPasses === 0) score -= 80;
    else if (totalPasses === 1) score -= 25;
  }

  // Passing chain analysis - THE key strategic metric
  const chain = computePassingChain(board, color);
  score += chain.furthestAdvancement * 60;
  if (chain.reachesGoal) score += 150;

  // Relay-capable pieces (can receive and forward the ball)
  score += countRelayPieces(board, color) * 20;

  // Knight mobility
  score += countKnightMobility(board, color) * 3;

  // Piece advancement
  const myPieces = findPieces(board, color);
  for (const { cellKey } of myPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score += getAdvancement(row, color) * 8;
  }

  // --- Defensive evaluation (at ~90% weight) ---

  const opponentBallHolder = findBallHolder(board, opponentColor);
  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    score -= getAdvancement(row, opponentColor) * 90;

    const oppPasses = classifyPasses(board, opponentColor);
    score -= oppPasses.forward * 22;
    score -= oppPasses.lateral * 9;
    score -= oppPasses.backward * 4;
  }

  // Opponent passing chain - penalize their progress
  const oppChain = computePassingChain(board, opponentColor);
  score -= oppChain.furthestAdvancement * 55;
  if (oppChain.reachesGoal) score -= 135;

  // Lane blocking bonus
  score += countBlockedLanes(board, color) * 12;

  // Opponent piece advancement penalty
  const opponentPieces = findPieces(board, opponentColor);
  for (const { cellKey } of opponentPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score -= getAdvancement(row, opponentColor) * 7;
  }

  return score;
}

/**
 * Dispatch to appropriate eval function based on type
 */
function evaluatePosition(board, color, evalType = 'standard') {
  switch (evalType) {
    case 'simple': return evaluateSimple(board, color);
    case 'advanced': return evaluateAdvanced(board, color);
    default: return evaluateStandard(board, color);
  }
}

// ============================================
// MOVE ORDERING
// ============================================

/**
 * Quick static score for move ordering. Cheap heuristic that estimates
 * how good an outcome looks so we search the best-looking moves first.
 * Better ordering = more alpha-beta cutoffs = exponentially faster search.
 */
function quickScore(board, color) {
  let score = 0;
  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * 100;
    // Bonus if ball holder has any forward pass
    const passes = getValidPasses(ballHolder.cellKey, color, board);
    score += passes.length * 10;
  }
  // Check for instant win
  const winner = didWin(board);
  if (winner === color) return AI_CONFIG.INFINITY;
  if (winner) return -AI_CONFIG.INFINITY;
  return score;
}

/**
 * Sort outcomes so the most promising are searched first.
 * For maximizing player: highest score first.
 * For minimizing player: lowest score first.
 */
function orderOutcomes(outcomes, color, isMaximizing) {
  // Attach quick scores
  for (const outcome of outcomes) {
    outcome._qs = quickScore(outcome.board, color);
  }
  if (isMaximizing) {
    outcomes.sort((a, b) => b._qs - a._qs);
  } else {
    outcomes.sort((a, b) => a._qs - b._qs);
  }
}

// ============================================
// MINIMAX ALGORITHM
// ============================================

/**
 * Minimax with alpha-beta pruning, move ordering, and transposition table
 */
function minimax(board, depth, alpha, beta, isMaximizing, aiColor, currentTurn, evalType, ttable) {
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
      score: evaluatePosition(board, aiColor, evalType),
      moves: [],
    };
  }

  // Transposition table lookup
  const boardHash = hashBoard(board);
  // Encode turn info into the key to distinguish same board with different turn
  const ttKey = boardHash ^ (isMaximizing ? 0x12345678 : 0);
  const cached = ttable.get(ttKey);
  if (cached && cached.depth >= depth) {
    return { score: cached.score, moves: cached.moves };
  }

  const outcomes = generateTurnOutcomes(board, currentTurn);
  const nextTurn = currentTurn === 'white' ? 'black' : 'white';

  // Sort outcomes for better pruning
  orderOutcomes(outcomes, aiColor, isMaximizing);

  if (isMaximizing) {
    let bestScore = -Infinity;
    let bestMoves = [];

    for (const outcome of outcomes) {
      const result = minimax(
        outcome.board, depth - 1, alpha, beta,
        false, aiColor, nextTurn, evalType, ttable
      );

      if (result.score > bestScore) {
        bestScore = result.score;
        bestMoves = outcome.moves;
      }

      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    }

    ttable.set(ttKey, { score: bestScore, depth, moves: bestMoves });
    return { score: bestScore, moves: bestMoves };
  } else {
    let bestScore = Infinity;
    let bestMoves = [];

    for (const outcome of outcomes) {
      const result = minimax(
        outcome.board, depth - 1, alpha, beta,
        true, aiColor, nextTurn, evalType, ttable
      );

      if (result.score < bestScore) {
        bestScore = result.score;
        bestMoves = outcome.moves;
      }

      beta = Math.min(beta, bestScore);
      if (beta <= alpha) break;
    }

    ttable.set(ttKey, { score: bestScore, depth, moves: bestMoves });
    return { score: bestScore, moves: bestMoves };
  }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

/**
 * Make the best AI move using minimax with difficulty-based configuration
 * @param {Object} game - Current game state
 * @param {string} [difficulty='medium'] - 'easy', 'medium', or 'hard'
 * @returns {Object} Updated game state after AI move
 */
function makeAIMove(game, difficulty = 'medium') {
  const aiColor = game.aiColor;
  if (!aiColor) return game;

  const config = DIFFICULTY_CONFIGS[difficulty] || DIFFICULTY_CONFIGS.medium;
  const board = cloneBoard(game.currentBoardStatus);

  let bestMoves;

  // Fresh transposition table per move
  const ttable = new Map();

  if (config.topN > 1) {
    // Easy mode: score all root outcomes, pick randomly from top N
    const outcomes = generateTurnOutcomes(board, aiColor);

    const scored = outcomes.map(outcome => ({
      moves: outcome.moves,
      score: outcome.moves.length === 0
        ? -AI_CONFIG.INFINITY // heavily penalize doing nothing
        : (config.depth > 0
          ? minimax(
              outcome.board, config.depth - 1, -Infinity, Infinity,
              false, aiColor,
              aiColor === 'white' ? 'black' : 'white',
              config.evalFn, ttable
            ).score
          : evaluatePosition(outcome.board, aiColor, config.evalFn)),
    }));

    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, Math.min(config.topN, scored.length));
    bestMoves = candidates[Math.floor(Math.random() * candidates.length)].moves;
  } else {
    // Medium/Hard: standard minimax
    const result = minimax(
      board, config.depth, -Infinity, Infinity,
      true, aiColor, aiColor, config.evalFn, ttable
    );
    bestMoves = result.moves;
  }

  // Apply the best moves to the board
  let newBoard = board;
  let pieceMove = null;
  let ballPass = null;

  for (const move of bestMoves) {
    if (move.type === 'move') {
      newBoard = movePiece(move.from, move.to, newBoard);
      pieceMove = { from: move.from, to: move.to };
    } else if (move.type === 'pass') {
      newBoard = passBall(move.from, move.to, newBoard);
      ballPass = { from: move.from, to: move.to };
    }
  }

  // Build AI move history entry
  const historyEntry = {
    turnNumber: game.turnNumber || 0,
    player: aiColor,
  };
  if (pieceMove) historyEntry.pieceMove = pieceMove;
  if (ballPass) historyEntry.ballPass = ballPass;

  const moveHistory = [...(game.moveHistory || []), historyEntry];

  // Check win condition
  const winner = didWin(newBoard);
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
    moveHistory,
    ballPassFrom: null,
    ballPassTo: null,
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
  DIFFICULTY_CONFIGS,
  // Export for testing
  computePassingChain,
  classifyPasses,
  countBlockedLanes,
  countRelayPieces,
};
