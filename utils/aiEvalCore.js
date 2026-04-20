/**
 * Shared static evaluation helpers (standard / advanced / impossible).
 * Pure functions over sparse or full board objects; depends only on gameLogic.
 */

const {
  getKeyCoordinates,
  toCellKey,
  getPieceMoves,
  getValidPasses,
} = require('./gameLogic');

/** Same numeric sentinel as legacy AI_CONFIG.INFINITY in aiLogic.js */
const EVAL_INFINITY = 10000;

// ============================================
// BOARD HELPERS
// ============================================

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

function findBallHolder(board, color) {
  for (const cellKey of Object.keys(board)) {
    const piece = board[cellKey];
    if (piece && piece.color === color && piece.hasBall) {
      return { cellKey, piece };
    }
  }
  return null;
}

function getAdvancement(row, color) {
  return color === 'white' ? (7 - row) : row;
}

/** Fast win check — iterates only occupied cells */
function didWin(board) {
  for (const cellKey of Object.keys(board)) {
    const piece = board[cellKey];
    if (piece && piece.hasBall) {
      const { row } = getKeyCoordinates(cellKey);
      if (piece.color === 'white' && row === 0) return 'white';
      if (piece.color === 'black' && row === 7) return 'black';
    }
  }
  return null;
}

// ============================================
// PASSING CHAIN ANALYSIS
// ============================================

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
          break;
        }
        r += dy;
        c += dx;
      }
    }
  }

  return blocked;
}

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

const KNIGHT_DIST = (() => {
  const dist = Array.from({ length: 64 }, () => new Uint8Array(64).fill(255));
  const offsets = [[-2, 1], [-1, 2], [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1]];

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

const ALL_DIRECTIONS = [
  { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
  { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
  { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
];

function cellKeyToSqIndex(cellKey) {
  const { row, col } = getKeyCoordinates(cellKey);
  return row * 8 + col;
}

function getDeliverySquares(board, color) {
  const ballHolder = findBallHolder(board, color);
  if (!ballHolder) return { squares: [], chainPieces: new Set() };

  const goalRow = color === 'white' ? 0 : 7;

  const chainPieces = new Set([ballHolder.cellKey]);
  let queue = [ballHolder.cellKey];
  while (queue.length > 0) {
    const nextQueue = [];
    for (const cellKey of queue) {
      for (const pt of getValidPasses(cellKey, color, board)) {
        if (!chainPieces.has(pt)) {
          chainPieces.add(pt);
          nextQueue.push(pt);
        }
      }
    }
    queue = nextQueue;
  }

  const seen = new Set();
  const squares = [];
  for (const cellKey of chainPieces) {
    const { row, col } = getKeyCoordinates(cellKey);
    for (const { dx, dy } of ALL_DIRECTIONS) {
      let r = row + dy;
      let c = col + dx;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        if (board[toCellKey(r, c)]) break;
        if (r === goalRow) {
          const sq = r * 8 + c;
          if (!seen.has(sq)) { seen.add(sq); squares.push(sq); }
        }
        r += dy;
        c += dx;
      }
    }
  }
  return { squares, chainPieces };
}

function opponentDeliveryThreat(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';
  const { squares: deliverySquareIndices, chainPieces } = getDeliverySquares(board, opponentColor);
  if (deliverySquareIndices.length === 0) return 99;

  const oppGoalRow = opponentColor === 'white' ? 0 : 7;
  const oppPieces = findPieces(board, opponentColor).filter(p => !p.piece.hasBall);
  let minDist = 99;

  for (const { cellKey } of oppPieces) {
    const pieceSq = cellKeyToSqIndex(cellKey);
    const { row } = getKeyCoordinates(cellKey);
    if (row === oppGoalRow && chainPieces.has(cellKey)) return 0;

    for (const dSq of deliverySquareIndices) {
      const d = KNIGHT_DIST[pieceSq][dSq];
      if (d < minDist) minDist = d;
      if (minDist <= 1) return minDist;
    }
  }
  return minDist;
}

module.exports = {
  EVAL_INFINITY,
  findPieces,
  findBallHolder,
  getAdvancement,
  didWin,
  computePassingChain,
  classifyPasses,
  countBlockedLanes,
  countRelayPieces,
  countKnightMobility,
  getDeliverySquares,
  opponentDeliveryThreat,
  cellKeyToSqIndex,
  KNIGHT_DIST,
  ALL_DIRECTIONS,
};
