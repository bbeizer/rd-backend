/**
 * AI Logic for Razzle Dazzle
 * Minimax algorithm with alpha-beta pruning and difficulty-based evaluation
 */

const {
  getKeyCoordinates,
  getPieceMoves,
  getValidPasses,
  cloneBoard,
} = require('./gameLogic');

const {
  cloneBoardFast,
  movePiece,
  passBall,
  expandBoard,
  hashBoard,
} = require('./aiSparseBoard');

const {
  EVAL_INFINITY,
  didWin,
  findPieces,
  findBallHolder,
  getAdvancement,
  computePassingChain,
  classifyPasses,
  countBlockedLanes,
  countRelayPieces,
  countKnightMobility,
  getDeliverySquares,
  opponentDeliveryThreat,
  cellKeyToSqIndex,
} = require('./aiEvalCore');

const {
  DEFAULT_IMPOSSIBLE_WEIGHTS,
  TORTUGA_IMPOSSIBLE_WEIGHTS,
  LEGACY_IMPOSSIBLE_WEIGHTS,
  evaluateImpossible,
  computeImpossibleFeatureContributions,
  scoreFromImpossibleContributions,
  winPointCount,
  reachableWinPoints,
  defendedWinPoints,
  pieceCoordination,
  defensiveCoverOfGoalFiles,
  penultimateRankForcedWin,
} = require('./aiImpossibleEval');

const {
  evaluateSimple,
  evaluateStandard,
  evaluateAdvanced,
} = require('./aiEvalTiers');

// Sparse board I/O: utils/aiSparseBoard.js

// ============================================
// CONFIGURATION
// ============================================

const AI_CONFIG = {
  INFINITY: EVAL_INFINITY,
};

const DIFFICULTY_CONFIGS = {
  easy:       { depth: 1, evalFn: 'simple',     topN: 3 },
  medium:     { depth: 3, evalFn: 'standard',   topN: 2 },
  hard:       { depth: 4, evalFn: 'advanced',   topN: 1 },
  // "B-Rabbit" — lean eval, 6 low-value features zeroed for speed.
  impossible: { depth: 8, evalFn: 'impossible', topN: 1, timeLimitMs: 6000, pvs: true, lmr: true, quiescence: true },
  // "Tortuga" — full-featured eval, all features active. Benchmarking only.
  impossible_tortuga: { depth: 8, evalFn: 'impossible', topN: 1, timeLimitMs: 6000, pvs: true, lmr: true, quiescence: true, weightsKey: 'tortuga' },
  // "Legacy" — pre-win-points weights. Benchmarking only.
  impossible_legacy: { depth: 8, evalFn: 'impossible', topN: 1, timeLimitMs: 4000, pvs: true, lmr: true, quiescence: true, weightsKey: 'legacy' },
};

// ============================================
// MOVE GENERATION
// ============================================

/**
 * Generate all possible turn outcomes for a color
 * A turn can include: pass only, move only, or move + pass
 */
/**
 * BFS through all reachable pass chains from the current ball holder on the given board.
 * The ball can be passed unlimited times per turn through friendly pieces in straight lines.
 * Returns one outcome per reachable ball destination (deduplicated by final ball position).
 */
function generatePassChains(board, color) {
  const ballHolder = findBallHolder(board, color);
  if (!ballHolder) return [];

  const results = [];
  const reachedTargets = new Set(); // deduplicate by final ball position
  // BFS queue entries: { board, ballHolderKey, passMoves, visited }
  const queue = [{ board, ballHolderKey: ballHolder.cellKey, passMoves: [], visited: new Set([ballHolder.cellKey]) }];

  while (queue.length > 0) {
    const { board: curBoard, ballHolderKey, passMoves, visited } = queue.shift();
    const passes = getValidPasses(ballHolderKey, color, curBoard);

    for (const passTarget of passes) {
      if (visited.has(passTarget)) continue;
      const newBoard = passBall(ballHolderKey, passTarget, curBoard);
      const newMoves = [...passMoves, { type: 'pass', from: ballHolderKey, to: passTarget }];

      // Only keep the first path to each final ball position
      if (!reachedTargets.has(passTarget)) {
        reachedTargets.add(passTarget);
        results.push({ board: newBoard, passMoves: newMoves });
      }

      const newVisited = new Set(visited);
      newVisited.add(passTarget);
      queue.push({ board: newBoard, ballHolderKey: passTarget, passMoves: newMoves, visited: newVisited });
    }
  }

  return results;
}

function generateTurnOutcomes(board, color) {
  const outcomes = [];
  const pieces = findPieces(board, color);

  // Option 1: Pass chain only (no piece move, just pass the ball through the network)
  for (const { board: passedBoard, passMoves } of generatePassChains(board, color)) {
    outcomes.push({ board: passedBoard, moves: passMoves });
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

  // Option 3: Move + Pass chain (move a piece, then pass ball through network)
  for (const { cellKey, piece } of pieces) {
    if (!piece.hasBall) {
      const moves = getPieceMoves(cellKey, board, false, null);
      for (const moveTarget of moves) {
        const boardAfterMove = movePiece(cellKey, moveTarget, board);

        for (const { board: finalBoard, passMoves } of generatePassChains(boardAfterMove, color)) {
          outcomes.push({
            board: finalBoard,
            moves: [{ type: 'move', from: cellKey, to: moveTarget }, ...passMoves],
          });
        }
      }
    }
  }

  // Option 4: No action (always valid fallback)
  outcomes.push({
    board: cloneBoardFast(board),
    moves: [],
  });

  return outcomes;
}

// ============================================
// EVALUATION FUNCTIONS
// ============================================

/**
 * Dispatch to appropriate eval function based on type.
 * `weights` only applies to the impossible eval (others are not parameterized).
 */
function evaluatePosition(board, color, evalType = 'standard', weights) {
  switch (evalType) {
    case 'simple': return evaluateSimple(board, color);
    case 'advanced': return evaluateAdvanced(board, color);
    case 'impossible': return evaluateImpossible(board, color, weights);
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
 * If a TT hint is available from a shallower search, prioritize that move.
 */
function orderOutcomes(outcomes, color, isMaximizing, ttHintMoves) {
  for (const outcome of outcomes) {
    outcome._qs = quickScore(outcome.board, color);
  }

  // Boost TT best move from shallower search to ensure it's searched first
  if (ttHintMoves && ttHintMoves.length > 0) {
    const hint = ttHintMoves[0];
    for (const outcome of outcomes) {
      if (outcome.moves.length > 0 &&
          outcome.moves[0].from === hint.from &&
          outcome.moves[0].to === hint.to) {
        outcome._qs = isMaximizing ? AI_CONFIG.INFINITY + 1 : -AI_CONFIG.INFINITY - 1;
        break;
      }
    }
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
 * Minimax with alpha-beta pruning, move ordering, and transposition table.
 *
 * Optional `searchState` object enables time-budgeted search:
 *   { deadline, nodesSearched, timeUp } — when Date.now() >= deadline,
 *   sets timeUp and returns aborted results that callers must discard.
 *
 * Without searchState (existing call sites), behavior is unchanged.
 */
function minimax(board, depth, alpha, beta, isMaximizing, aiColor, currentTurn, evalType, ttable, searchState, noExtend) {
  // Time budget check (impossible mode only). Check every 4096 nodes via bitwise AND.
  if (searchState) {
    if ((searchState.nodesSearched++ & 4095) === 0 && Date.now() >= searchState.deadline) {
      searchState.timeUp = true;
    }
    if (searchState.timeUp) {
      return { score: 0, moves: [], aborted: true };
    }
  }

  // Terminal conditions
  // Add depth so closer wins are preferred (win now > win later)
  const winner = didWin(board);
  if (winner) {
    return {
      score: winner === aiColor ? AI_CONFIG.INFINITY + depth : -AI_CONFIG.INFINITY - depth,
      moves: [],
    };
  }

  if (depth === 0) {
    // Quiescence extension: if opponent has an immediate scoring threat,
    // extend by 1 ply to see if it materializes. Only extend once per branch
    // (noExtend=true is propagated down to prevent runaway extension chains).
    if (searchState && searchState.quiescence && !noExtend) {
      const oppThreat = opponentDeliveryThreat(board, aiColor);
      if (oppThreat <= 1) {
        return minimax(
          board, 1, alpha, beta,
          isMaximizing, aiColor, currentTurn, evalType, ttable, searchState, true
        );
      }
    }
    return {
      score: evaluatePosition(board, aiColor, evalType, searchState && searchState.weights),
      moves: [],
    };
  }

  // Transposition table lookup
  const boardHash = hashBoard(board);
  // Encode turn info into the key to distinguish same board with different turn
  const ttKey = boardHash + (isMaximizing ? '|MAX' : '|MIN');
  const cached = ttable.get(ttKey);
  if (cached && cached.depth >= depth) {
    // Respect bound flag: 'exact' is always usable, 'lower' (fail-high) only
    // produces a cutoff if score >= beta, 'upper' (fail-low) only if score <= alpha.
    // Without flags, PVS null-window scout scores would be cached as exact and
    // corrupt subsequent full-window searches.
    if (cached.flag === 'exact') {
      return { score: cached.score, moves: cached.moves };
    }
    if (cached.flag === 'lower' && cached.score >= beta) {
      return { score: cached.score, moves: cached.moves };
    }
    if (cached.flag === 'upper' && cached.score <= alpha) {
      return { score: cached.score, moves: cached.moves };
    }
    // Otherwise the bound is too loose for this window — fall through and search,
    // but still use cached.moves as an ordering hint below.
  }

  const outcomes = generateTurnOutcomes(board, currentTurn);
  const nextTurn = currentTurn === 'white' ? 'black' : 'white';

  // Sort outcomes for better pruning, using TT hint from shallower search if available
  const ttHintMoves = (cached && cached.moves) ? cached.moves : null;
  orderOutcomes(outcomes, aiColor, isMaximizing, ttHintMoves);

  const pvs = searchState && searchState.pvs;
  const lmr = searchState && searchState.lmr;

  if (isMaximizing) {
    const alphaOrig = alpha;
    let bestScore = -Infinity;
    let bestMoves = [];

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      let result;

      if ((pvs || lmr) && i > 0) {
        // Late Move Reduction: search later moves at reduced depth first.
        // If they fail high, re-search at full depth.
        let scoutDepth = depth - 1;
        let reduced = false;
        if (lmr && i >= 3 && depth >= 3) {
          scoutDepth = depth - 2;
          reduced = true;
        }
        // Null-window scout (PVS): assume first move was best
        result = minimax(
          outcome.board, scoutDepth, alpha, alpha + 1,
          false, aiColor, nextTurn, evalType, ttable, searchState, noExtend
        );
        // Reduced search succeeded — re-search at full depth, still null window
        if (!result.aborted && reduced && result.score > alpha) {
          result = minimax(
            outcome.board, depth - 1, alpha, alpha + 1,
            false, aiColor, nextTurn, evalType, ttable, searchState
          );
        }
        // Null window failed high — re-search at full window
        if (!result.aborted && result.score > alpha && result.score < beta) {
          result = minimax(
            outcome.board, depth - 1, alpha, beta,
            false, aiColor, nextTurn, evalType, ttable, searchState
          );
        }
      } else {
        result = minimax(
          outcome.board, depth - 1, alpha, beta,
          false, aiColor, nextTurn, evalType, ttable, searchState, noExtend
        );
      }

      // Propagate abort up the stack without polluting TT
      if (result.aborted) return { score: 0, moves: [], aborted: true };

      if (result.score > bestScore) {
        bestScore = result.score;
        bestMoves = outcome.moves;
      }

      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    }

    // Classify the result relative to the entry window:
    //   bestScore <= alphaOrig → fail-low → 'upper' bound (true value ≤ bestScore)
    //   bestScore >= beta      → fail-high (cutoff) → 'lower' bound (true ≥ bestScore)
    //   otherwise              → 'exact'
    let flag;
    if (bestScore <= alphaOrig) flag = 'upper';
    else if (bestScore >= beta) flag = 'lower';
    else flag = 'exact';
    ttable.set(ttKey, { score: bestScore, depth, moves: bestMoves, flag });
    return { score: bestScore, moves: bestMoves };
  } else {
    const betaOrig = beta;
    let bestScore = Infinity;
    let bestMoves = [];

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      let result;

      if ((pvs || lmr) && i > 0) {
        let scoutDepth = depth - 1;
        let reduced = false;
        if (lmr && i >= 3 && depth >= 3) {
          scoutDepth = depth - 2;
          reduced = true;
        }
        // Null-window scout for minimizing player
        result = minimax(
          outcome.board, scoutDepth, beta - 1, beta,
          true, aiColor, nextTurn, evalType, ttable, searchState, noExtend
        );
        if (!result.aborted && reduced && result.score < beta) {
          result = minimax(
            outcome.board, depth - 1, beta - 1, beta,
            true, aiColor, nextTurn, evalType, ttable, searchState
          );
        }
        if (!result.aborted && result.score < beta && result.score > alpha) {
          result = minimax(
            outcome.board, depth - 1, alpha, beta,
            true, aiColor, nextTurn, evalType, ttable, searchState
          );
        }
      } else {
        result = minimax(
          outcome.board, depth - 1, alpha, beta,
          true, aiColor, nextTurn, evalType, ttable, searchState, noExtend
        );
      }

      if (result.aborted) return { score: 0, moves: [], aborted: true };

      if (result.score < bestScore) {
        bestScore = result.score;
        bestMoves = outcome.moves;
      }

      beta = Math.min(beta, bestScore);
      if (beta <= alpha) break;
    }

    // Mirror of maximizing branch:
    //   bestScore >= betaOrig → fail-high → 'lower' bound (true value ≥ bestScore)
    //   bestScore <= alpha    → fail-low (cutoff) → 'upper' bound (true ≤ bestScore)
    //   otherwise             → 'exact'
    let flag;
    if (bestScore >= betaOrig) flag = 'lower';
    else if (bestScore <= alpha) flag = 'upper';
    else flag = 'exact';
    ttable.set(ttKey, { score: bestScore, depth, moves: bestMoves, flag });
    return { score: bestScore, moves: bestMoves };
  }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

/**
 * Make the best AI move using minimax with difficulty-based configuration
 * @param {Object} game - Current game state
 * @param {string} [difficulty='medium'] - 'easy', 'medium', 'hard', or 'impossible'
 * @returns {Object} Updated game state after AI move
 */
function makeAIMove(game, difficulty = 'medium', opts = {}) {
  const aiColor = game.aiColor;
  if (!aiColor) return game;

  const config = DIFFICULTY_CONFIGS[difficulty] || DIFFICULTY_CONFIGS.medium;
  const board = cloneBoardFast(cloneBoard(game.currentBoardStatus));

  let bestMoves;

  // Fresh transposition table per move
  const ttable = new Map();

  // Resolve weights: opts.weights (tuner injection) > config.weightsKey > default.
  const WEIGHTS_MAP = { legacy: LEGACY_IMPOSSIBLE_WEIGHTS, tortuga: TORTUGA_IMPOSSIBLE_WEIGHTS };
  const weights = opts.weights || WEIGHTS_MAP[config.weightsKey] || undefined;

  // Time-budgeted iterative deepening + search enhancements (impossible mode only).
  // For other modes, searchState is undefined and there's zero overhead.
  const useEnhancements = config.timeLimitMs || config.pvs || config.lmr || config.quiescence;
  const searchState = useEnhancements ? {
    deadline: config.timeLimitMs ? Date.now() + config.timeLimitMs : Infinity,
    nodesSearched: 0,
    timeUp: false,
    pvs: !!config.pvs,
    lmr: !!config.lmr,
    quiescence: !!config.quiescence,
    weights,
  } : null;

  // Iterative deepening minimax for all difficulty levels.
  // Search depth 1, 2, ..., N. Shallower results fill the transposition table,
  // giving better move ordering at deeper levels → more alpha-beta cutoffs.
  // When time-budgeted, break on timeout and use the last fully-completed depth.
  let result;
  let lastCompletedDepth = 0;
  for (let d = 1; d <= config.depth; d++) {
    const r = minimax(
      board, d, -Infinity, Infinity,
      true, aiColor, aiColor, config.evalFn, ttable, searchState
    );
    if (r.aborted) break;
    result = r;
    lastCompletedDepth = d;
  }

  // Safety net: if even depth 1 timed out (shouldn't happen with reasonable budget),
  // fall back to a depth-1 search without time budget so we always return a move.
  if (!result) {
    result = minimax(
      board, 1, -Infinity, Infinity,
      true, aiColor, aiColor, config.evalFn, ttable, null
    );
    lastCompletedDepth = 1;
  }

  if (config.topN > 1) {
    // Score all root outcomes at full depth, pick randomly from top N.
    // The TT is already warmed from iterative deepening so this is fast.
    const outcomes = generateTurnOutcomes(board, aiColor);
    const nextTurn = aiColor === 'white' ? 'black' : 'white';

    const scored = outcomes
      .filter(o => o.moves.length > 0)
      .map(outcome => ({
        moves: outcome.moves,
        // Pass weights via a minimal searchState (no time budget) so custom
        // weights propagate through the topN evaluation. Without this, injected
        // weights (e.g. from the tuner) would be silently dropped.
        score: minimax(
          outcome.board, lastCompletedDepth - 1, -Infinity, Infinity,
          false, aiColor, nextTurn, config.evalFn, ttable,
          weights ? { deadline: Infinity, nodesSearched: 0, timeUp: false, pvs: false, lmr: false, quiescence: false, weights } : null
        ).score,
      }));

    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, Math.min(config.topN, scored.length));
    bestMoves = candidates[Math.floor(Math.random() * candidates.length)].moves;
  } else {
    bestMoves = result.moves;
  }

  // Apply the best moves to the board
  let newBoard = board;
  let pieceMove = null;
  const ballPasses = [];
  const actionStates = [];

  for (const move of bestMoves) {
    if (move.type === 'move') {
      newBoard = movePiece(move.from, move.to, newBoard);
      pieceMove = { from: move.from, to: move.to };
      actionStates.push({
        actionType: 'pieceMove',
        pieceMove: { from: move.from, to: move.to },
        boardSnapshot: expandBoard(newBoard),
      });
    } else if (move.type === 'pass') {
      newBoard = passBall(move.from, move.to, newBoard);
      ballPasses.push({ from: move.from, to: move.to });
      actionStates.push({
        actionType: 'ballPass',
        ballPass: { from: move.from, to: move.to },
        boardSnapshot: expandBoard(newBoard),
      });
    }
  }

  // Build AI move history entry
  const historyEntry = {
    turnNumber: game.turnNumber || 0,
    player: aiColor,
  };
  if (pieceMove) historyEntry.pieceMove = pieceMove;
  if (ballPasses.length > 0) {
    historyEntry.ballPasses = ballPasses;
    if (ballPasses.length === 1) {
      historyEntry.ballPass = ballPasses[0];
    }
  }
  historyEntry.actionStates = actionStates;
  historyEntry.boardSnapshot = expandBoard(newBoard);

  const moveHistory = [...(game.moveHistory || []), historyEntry];

  // Check win condition
  const winner = didWin(newBoard);
  const playerColor = aiColor === 'white' ? 'black' : 'white';

  const newGame = {
    ...game,
    currentBoardStatus: expandBoard(newBoard),
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
    ballPassChain: [],
    turnActionStates: [],
    _aiMeta: { rootScore: result.score, depth: config.depth, difficulty },
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
  getDeliverySquares,
  winPointCount,
  reachableWinPoints,
  defendedWinPoints,
  pieceCoordination,
  defensiveCoverOfGoalFiles,
  penultimateRankForcedWin,
  DEFAULT_IMPOSSIBLE_WEIGHTS,
  TORTUGA_IMPOSSIBLE_WEIGHTS,
  LEGACY_IMPOSSIBLE_WEIGHTS,
  cellKeyToSqIndex,
  computeImpossibleFeatureContributions,
  scoreFromImpossibleContributions,
};
