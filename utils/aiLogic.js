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
  easy:       { depth: 1, evalFn: 'simple',     topN: 3 },
  medium:     { depth: 3, evalFn: 'standard',   topN: 2 },
  hard:       { depth: 4, evalFn: 'advanced',   topN: 1 },
  impossible: { depth: 8, evalFn: 'impossible', topN: 1, timeLimitMs: 4000, pvs: true, lmr: true, quiescence: true },
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
// IMPOSSIBLE-MODE FEATURE HELPERS
// ============================================
// These return raw values per color (no pre-multiplication).
// evaluateImpossible combines them with tunable weights so Phase B
// can replace hand-tuned weights with empirically-tuned values from self-play.

/**
 * Build the passing chain (set of cellKeys reachable from the ball holder
 * via friendly pass relays). Used by several impossible-mode heuristics.
 */
function buildPassingChainSet(board, color) {
  const ballHolder = findBallHolder(board, color);
  if (!ballHolder) return new Set();

  const chain = new Set([ballHolder.cellKey]);
  let queue = [ballHolder.cellKey];
  while (queue.length > 0) {
    const next = [];
    for (const ck of queue) {
      for (const target of getValidPasses(ck, color, board)) {
        if (!chain.has(target)) {
          chain.add(target);
          next.push(target);
        }
      }
    }
    queue = next;
  }
  return chain;
}

/**
 * Chain fragility: count chain pieces with only 1 in-chain neighbor.
 * These are single points of failure — capturing/blocking them severs the chain.
 * Higher value = more fragile = bad for the chain owner.
 */
function chainFragility(board, color) {
  const chain = buildPassingChainSet(board, color);
  if (chain.size <= 1) return 0;

  let fragile = 0;
  for (const ck of chain) {
    let neighbors = 0;
    for (const target of getValidPasses(ck, color, board)) {
      if (chain.has(target)) {
        neighbors++;
        if (neighbors >= 2) break;
      }
    }
    if (neighbors === 1) fragile++;
  }
  return fragile;
}

/**
 * Network connectivity: total pass-link count across all friendly pieces.
 * Counts each piece's outgoing pass options (so each link counted twice).
 * Higher = more flexible passing network = more options to escape pressure.
 */
function networkConnectivity(board, color) {
  const pieces = findPieces(board, color);
  let total = 0;
  for (const { cellKey } of pieces) {
    total += getValidPasses(cellKey, color, board).length;
  }
  return total;
}

/**
 * Goal row defense: count friendly pieces sitting on the row where the
 * opponent scores. Each piece on that row blocks scoring lanes that
 * pass through its square.
 *
 * White defends row 7 (opponent scores there). Black defends row 0.
 */
function goalRowDefense(board, color) {
  const defenseRow = color === 'white' ? 7 : 0;
  let count = 0;
  for (const { cellKey } of findPieces(board, color)) {
    if (getKeyCoordinates(cellKey).row === defenseRow) count++;
  }
  return count;
}

/**
 * Opponent isolation: count enemy pieces with zero valid pass targets.
 * Isolated pieces can't relay the ball — they're effectively dead weight
 * for the opponent's passing chain.
 */
function opponentIsolation(board, color) {
  const oppColor = color === 'white' ? 'black' : 'white';
  let isolated = 0;
  for (const { cellKey } of findPieces(board, oppColor)) {
    if (getValidPasses(cellKey, oppColor, board).length === 0) isolated++;
  }
  return isolated;
}

/**
 * Chokepoint control: count friendly pieces on central squares (d4, d5, e4, e5)
 * that connect to 2+ teammates via passing lanes. Central pieces with multiple
 * connections control the most strategically important squares.
 */
const CHOKEPOINT_KEYS = ['d4', 'd5', 'e4', 'e5'];
function chokepointControl(board, color) {
  let count = 0;
  for (const key of CHOKEPOINT_KEYS) {
    const piece = board[key];
    if (piece && piece.color === color) {
      const passes = getValidPasses(key, color, board);
      if (passes.length >= 2) count++;
    }
  }
  return count;
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
 * Default weights for evaluateImpossible. These are educated initial guesses;
 * Phase B (self-play tuning) will replace them with empirically-derived values.
 *
 * Each weight is the multiplier applied to a feature's (us - opponent) delta.
 * Defensive features (chainFragility, opponentIsolation) are inverted in the
 * eval body so positive weights always mean "more of this is good for us".
 */
const DEFAULT_IMPOSSIBLE_WEIGHTS = {
  // Existing-style features (carried forward from advanced eval)
  ballAdvancement: 100,
  pieceAdvancement: 8,
  pieceAdvancementUnderThreat: 3,
  forwardPass: 25,
  lateralPass: 10,
  backwardPass: 5,
  ballIsolation0: -80,   // applied as bonus when total passes == 0
  ballIsolation1: -25,   // applied as bonus when total passes == 1
  chainFurthest: 60,
  chainReachesGoal: 150,
  relayPieces: 20,
  knightMobility: 3,
  blockedLanes: 12,
  deliveryThreat0: 500,
  deliveryThreat1: 300,
  deliveryThreat2: 150,
  deliveryThreat3: 60,
  // New impossible-mode features
  chainFragility: 25,         // their fragility - our fragility
  networkConnectivity: 5,     // our connectivity - theirs (small per-link weight)
  goalRowDefense: 40,         // our defenders - theirs
  opponentIsolation: 35,      // their isolated pieces - ours
  chokepointControl: 25,      // our chokepoint pieces - theirs
};

/**
 * Impossible eval - all features from advanced plus 5 new strategic heuristics,
 * with every weight extracted into a tunable config object.
 *
 * Phase B will run self-play with perturbed weights to find the empirically
 * optimal configuration. The eval *features* (heuristics) are hand-designed;
 * the *weights* will be data-tuned. This is the pre-NNUE Stockfish approach.
 */
function evaluateImpossible(board, color, weights = DEFAULT_IMPOSSIBLE_WEIGHTS) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  const winner = didWin(board);
  if (winner === color) return AI_CONFIG.INFINITY;
  if (winner === opponentColor) return -AI_CONFIG.INFINITY;

  let score = 0;

  // --- Ball position and pass quality (us) ---
  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * weights.ballAdvancement;

    const passes = classifyPasses(board, color);
    score += passes.forward * weights.forwardPass;
    score += passes.lateral * weights.lateralPass;
    score += passes.backward * weights.backwardPass;

    const totalPasses = passes.forward + passes.lateral + passes.backward;
    if (totalPasses === 0) score += weights.ballIsolation0;
    else if (totalPasses === 1) score += weights.ballIsolation1;
  }

  // --- Ball position and pass quality (them) ---
  const opponentBallHolder = findBallHolder(board, opponentColor);
  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    score -= getAdvancement(row, opponentColor) * weights.ballAdvancement;

    const oppPasses = classifyPasses(board, opponentColor);
    score -= oppPasses.forward * weights.forwardPass;
    score -= oppPasses.lateral * weights.lateralPass;
    score -= oppPasses.backward * weights.backwardPass;

    const oppTotal = oppPasses.forward + oppPasses.lateral + oppPasses.backward;
    if (oppTotal === 0) score -= weights.ballIsolation0;
    else if (oppTotal === 1) score -= weights.ballIsolation1;
  }

  // --- Passing chain reach (us vs them) ---
  const ourChain = computePassingChain(board, color);
  score += ourChain.furthestAdvancement * weights.chainFurthest;
  if (ourChain.reachesGoal) score += weights.chainReachesGoal;

  const oppChain = computePassingChain(board, opponentColor);
  score -= oppChain.furthestAdvancement * weights.chainFurthest;
  if (oppChain.reachesGoal) score -= weights.chainReachesGoal;

  // --- Relay pieces, mobility, blocked lanes ---
  score += (countRelayPieces(board, color) - countRelayPieces(board, opponentColor)) * weights.relayPieces;
  score += (countKnightMobility(board, color) - countKnightMobility(board, opponentColor)) * weights.knightMobility;
  score += countBlockedLanes(board, color) * weights.blockedLanes;
  score -= countBlockedLanes(board, opponentColor) * weights.blockedLanes;

  // --- Piece advancement (scaled down when opponent ball is advanced) ---
  const oppBallAdv = opponentBallHolder
    ? getAdvancement(getKeyCoordinates(opponentBallHolder.cellKey).row, opponentColor)
    : 0;
  const advWeight = oppBallAdv >= 4 ? weights.pieceAdvancementUnderThreat : weights.pieceAdvancement;
  for (const { cellKey } of findPieces(board, color)) {
    score += getAdvancement(getKeyCoordinates(cellKey).row, color) * advWeight;
  }
  for (const { cellKey } of findPieces(board, opponentColor)) {
    score -= getAdvancement(getKeyCoordinates(cellKey).row, opponentColor) * advWeight;
  }

  // --- Delivery threat (symmetric) ---
  const oppThreat = opponentDeliveryThreat(board, color);
  if (oppThreat === 0) score -= weights.deliveryThreat0;
  else if (oppThreat === 1) score -= weights.deliveryThreat1;
  else if (oppThreat === 2) score -= weights.deliveryThreat2;
  else if (oppThreat === 3) score -= weights.deliveryThreat3;

  const ourThreat = opponentDeliveryThreat(board, opponentColor);
  if (ourThreat === 0) score += weights.deliveryThreat0 * 0.9;
  else if (ourThreat === 1) score += weights.deliveryThreat1 * 0.83;
  else if (ourThreat === 2) score += weights.deliveryThreat2 * 0.8;
  else if (ourThreat === 3) score += weights.deliveryThreat3 * 0.83;

  // --- New impossible-mode heuristics (us - them) ---
  // Chain fragility: more fragile = worse, so subtract ours, add theirs
  score += (chainFragility(board, opponentColor) - chainFragility(board, color)) * weights.chainFragility;
  score += (networkConnectivity(board, color) - networkConnectivity(board, opponentColor)) * weights.networkConnectivity;
  score += (goalRowDefense(board, color) - goalRowDefense(board, opponentColor)) * weights.goalRowDefense;
  // opponentIsolation already returns enemy-isolated count from our perspective
  score += (opponentIsolation(board, color) - opponentIsolation(board, opponentColor)) * weights.opponentIsolation;
  score += (chokepointControl(board, color) - chokepointControl(board, opponentColor)) * weights.chokepointControl;

  return score;
}

/**
 * Dispatch to appropriate eval function based on type
 */
function evaluatePosition(board, color, evalType = 'standard') {
  switch (evalType) {
    case 'simple': return evaluateSimple(board, color);
    case 'advanced': return evaluateAdvanced(board, color);
    case 'impossible': return evaluateImpossible(board, color);
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
        score: minimax(
          outcome.board, lastCompletedDepth - 1, -Infinity, Infinity,
          false, aiColor, nextTurn, config.evalFn, ttable, null
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
