/**
 * AI Logic for Razzle Dazzle
 * Minimax algorithm with alpha-beta pruning and difficulty-based evaluation
 */

const {
  getKeyCoordinates,
  toCellKey,
  getPieceMoves,
  getValidPasses,
  didWin: didWinBase,
  cloneBoard,
  movePiece: movePieceBase,
  passBall: passBallBase,
} = require('./gameLogic');

// ============================================
// AI-OPTIMIZED BOARD OPERATIONS
// ============================================
// These skip Mongoose document handling and use sparse boards
// (only occupied cells stored) for faster iteration in the search tree.

/**
 * Fast board clone — plain objects only, sparse (skips null cells).
 * With 8 pieces this copies ~8 entries instead of 64.
 */
function cloneBoardFast(board) {
  const cloned = {};
  for (const key of Object.keys(board)) {
    const p = board[key];
    if (p) cloned[key] = { color: p.color, hasBall: p.hasBall, position: p.position, id: p.id };
  }
  return cloned;
}

/** Move piece using fast sparse clone */
function movePiece(sourceKey, targetKey, board) {
  const newBoard = cloneBoardFast(board);
  const piece = newBoard[sourceKey];
  if (piece) {
    newBoard[targetKey] = { color: piece.color, hasBall: piece.hasBall, position: targetKey, id: piece.id };
    delete newBoard[sourceKey];
  }
  return newBoard;
}

/** Pass ball using fast sparse clone */
function passBall(sourceKey, targetKey, board) {
  const newBoard = cloneBoardFast(board);
  const src = newBoard[sourceKey];
  const tgt = newBoard[targetKey];
  if (src && tgt) {
    newBoard[sourceKey] = { color: src.color, hasBall: false, position: src.position, id: src.id };
    newBoard[targetKey] = { color: tgt.color, hasBall: true, position: tgt.position, id: tgt.id };
  }
  return newBoard;
}

/** Expand sparse board back to full 64-cell format for the frontend */
function expandBoard(board) {
  const full = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const key = toCellKey(r, c);
      const p = board[key];
      full[key] = p ? { color: p.color, hasBall: p.hasBall, position: p.position, id: p.id } : null;
    }
  }
  return full;
}

/** Fast win check — iterates only occupied cells (~8) instead of checking 16 goal-row cells */
function didWin(board) {
  for (const key of Object.keys(board)) {
    const piece = board[key];
    if (piece && piece.hasBall) {
      const { row } = getKeyCoordinates(key);
      if (piece.color === 'white' && row === 0) return 'white';
      if (piece.color === 'black' && row === 7) return 'black';
    }
  }
  return null;
}

// ============================================
// CONFIGURATION
// ============================================

const AI_CONFIG = {
  INFINITY: 10000,
};

const DIFFICULTY_CONFIGS = {
  easy:   { depth: 1, evalFn: 'simple',   topN: 3 },
  medium: { depth: 3, evalFn: 'standard', topN: 2 },
  hard:   { depth: 4, evalFn: 'advanced', topN: 1 },
};

// ============================================
// BOARD HASHING (for transposition table)
// ============================================

// Collision-free string hash: sorted list of piece descriptors.
// e.g. "B*e8Bc8Bd8Bf8W*d1Wc1We1Wf1"
// With only 8 pieces this is fast and gives a perfect 1:1 mapping.
function hashBoard(board) {
  const parts = [];
  for (const cellKey of Object.keys(board)) {
    const piece = board[cellKey];
    if (piece) {
      parts.push((piece.color === 'white' ? 'W' : 'B') + (piece.hasBall ? '*' : '') + cellKey);
    }
  }
  parts.sort();
  return parts.join('');
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

// Precomputed minimum knight moves between any two squares on 8x8 board.
// KNIGHT_DIST[from_sq][to_sq] = minimum moves (0-6).
const KNIGHT_DIST = (() => {
  const dist = Array.from({ length: 64 }, () => new Uint8Array(64).fill(255));
  const offsets = [[-2,1],[-1,2],[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1]];

  for (let start = 0; start < 64; start++) {
    dist[start][start] = 0;
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const sq = queue[head++];
      const r = sq >> 3, c = sq & 7;
      const d = dist[start][sq] + 1;
      for (const [dr, dc] of offsets) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          const nsq = nr * 8 + nc;
          if (dist[start][nsq] === 255) {
            dist[start][nsq] = d;
            queue.push(nsq);
          }
        }
      }
    }
  }
  return dist;
})();

/**
 * Estimate how close the opponent is to delivering the ball to our goal row.
 * Finds delivery squares (empty goal-row squares in the passing chain's lanes),
 * then uses precomputed knight distances to find the closest opponent piece.
 *
 * Returns minimum knight-move distance (0 = can score now, 99 = no path).
 */
function opponentDeliveryThreat(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';
  const oppBallHolder = findBallHolder(board, opponentColor);
  if (!oppBallHolder) return 99;

  const goalRow = color === 'white' ? 7 : 0;

  const directions = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];

  // Get passing chain
  const chainPieces = new Set([oppBallHolder.cellKey]);
  let queue = [oppBallHolder.cellKey];
  while (queue.length > 0) {
    const nextQueue = [];
    for (const cellKey of queue) {
      const passes = getValidPasses(cellKey, opponentColor, board);
      for (const pt of passes) {
        if (!chainPieces.has(pt)) {
          chainPieces.add(pt);
          nextQueue.push(pt);
        }
      }
    }
    queue = nextQueue;
  }

  // Find delivery squares: empty goal-row squares in chain pieces' passing lanes
  const deliverySquareIndices = [];
  for (const cellKey of chainPieces) {
    const { row, col } = getKeyCoordinates(cellKey);
    for (const { dx, dy } of directions) {
      let r = row + dy;
      let c = col + dx;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = board[toCellKey(r, c)];
        if (target) break;
        if (r === goalRow) {
          deliverySquareIndices.push(r * 8 + c);
        }
        r += dy;
        c += dx;
      }
    }
  }

  if (deliverySquareIndices.length === 0) return 99;

  // Use precomputed knight distances — O(pieces * deliverySquares) lookups, no BFS
  const oppPieces = findPieces(board, opponentColor).filter(p => !p.piece.hasBall);
  let minDist = 99;

  for (const { cellKey } of oppPieces) {
    const col = cellKey.charCodeAt(0) - 97;
    const sqRow = 8 - parseInt(cellKey.slice(1), 10);
    const pieceSq = sqRow * 8 + col;

    // Check if piece is already on goal row in the chain
    const { row } = getKeyCoordinates(cellKey);
    if (row === goalRow && chainPieces.has(cellKey)) return 0;

    for (const dSq of deliverySquareIndices) {
      const d = KNIGHT_DIST[pieceSq][dSq];
      if (d < minDist) minDist = d;
      if (minDist <= 1) return minDist; // can't get better than 0 or 1
    }
  }

  return minDist;
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

  // Piece advancement — scaled down when opponent ball is advanced
  // When they're close to scoring, defense matters more than pushing pieces forward
  const myPieces = findPieces(board, color);
  const opponentBallHolder = findBallHolder(board, opponentColor);
  const oppBallAdv = opponentBallHolder
    ? getAdvancement(getKeyCoordinates(opponentBallHolder.cellKey).row, opponentColor)
    : 0;
  const advWeight = oppBallAdv >= 4 ? 3 : 8;
  for (const { cellKey } of myPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score += getAdvancement(row, color) * advWeight;
  }

  // --- Defensive evaluation (at ~90% weight) ---

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

  // --- Delivery threat detection ---
  // How close is the opponent to delivering the ball to our goal row?
  // This is the "oh crap they're about to score" detector.
  const oppThreat = opponentDeliveryThreat(board, color);
  if (oppThreat === 0) score -= 500;       // They can score NOW
  else if (oppThreat === 1) score -= 300;   // One knight move away from scoring
  else if (oppThreat === 2) score -= 150;   // Two knight moves away
  else if (oppThreat === 3) score -= 60;    // Three moves — still dangerous

  // How close are WE to delivering? (flip perspective)
  const ourThreat = opponentDeliveryThreat(board, opponentColor);
  if (ourThreat === 0) score += 450;
  else if (ourThreat === 1) score += 250;
  else if (ourThreat === 2) score += 120;
  else if (ourThreat === 3) score += 50;

  // --- Goal lane blocking ---
  // Reward our pieces that block scoring lanes from ANY piece in the opponent's
  // passing chain, not just the ball holder. The threat comes from the whole chain.
  if (opponentBallHolder) {
    const oppGoalRow = opponentColor === 'white' ? 0 : 7;

    // BFS to find all pieces in opponent's passing chain
    const chainPieces = new Set([opponentBallHolder.cellKey]);
    let chainQueue = [opponentBallHolder.cellKey];
    while (chainQueue.length > 0) {
      const nextQueue = [];
      for (const ck of chainQueue) {
        const passes = getValidPasses(ck, opponentColor, board);
        for (const pt of passes) {
          if (!chainPieces.has(pt)) {
            chainPieces.add(pt);
            nextQueue.push(pt);
          }
        }
      }
      chainQueue = nextQueue;
    }

    // Check scoring lanes from every piece in the chain
    for (const chainKey of chainPieces) {
      const { row: pRow, col: pCol } = getKeyCoordinates(chainKey);
      const goalDir = oppGoalRow > pRow ? 1 : (oppGoalRow < pRow ? -1 : 0);
      if (goalDir === 0) continue; // already on goal row

      const directions = [
        { dx: 0, dy: goalDir },
        { dx: 1, dy: goalDir }, { dx: -1, dy: goalDir },
      ];

      for (const { dx, dy } of directions) {
        let r = pRow + dy;
        let c = pCol + dx;
        while (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const target = board[toCellKey(r, c)];
          if (target) {
            if (target.color === color) {
              const pAdv = getAdvancement(pRow, opponentColor);
              score += 20 + pAdv * pAdv * 5;
            }
            break;
          }
          r += dy;
          c += dx;
        }
      }
    }
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
 * Minimax with alpha-beta pruning, move ordering, and transposition table
 */
function minimax(board, depth, alpha, beta, isMaximizing, aiColor, currentTurn, evalType, ttable) {
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
    return {
      score: evaluatePosition(board, aiColor, evalType),
      moves: [],
    };
  }

  // Transposition table lookup
  const boardHash = hashBoard(board);
  // Encode turn info into the key to distinguish same board with different turn
  const ttKey = boardHash + (isMaximizing ? '|MAX' : '|MIN');
  const cached = ttable.get(ttKey);
  if (cached && cached.depth >= depth) {
    return { score: cached.score, moves: cached.moves };
  }

  const outcomes = generateTurnOutcomes(board, currentTurn);
  const nextTurn = currentTurn === 'white' ? 'black' : 'white';

  // Sort outcomes for better pruning, using TT hint from shallower search if available
  const ttHintMoves = (cached && cached.moves) ? cached.moves : null;
  orderOutcomes(outcomes, aiColor, isMaximizing, ttHintMoves);

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
  const board = cloneBoardFast(cloneBoard(game.currentBoardStatus));

  let bestMoves;

  // Fresh transposition table per move
  const ttable = new Map();

  // Iterative deepening minimax for all difficulty levels.
  // Search depth 1, 2, ..., N. Shallower results fill the transposition table,
  // giving better move ordering at deeper levels → more alpha-beta cutoffs.
  let result;
  for (let d = 1; d <= config.depth; d++) {
    result = minimax(
      board, d, -Infinity, Infinity,
      true, aiColor, aiColor, config.evalFn, ttable
    );
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
        score: minimax(
          outcome.board, config.depth - 1, -Infinity, Infinity,
          false, aiColor, nextTurn, config.evalFn, ttable
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
};
