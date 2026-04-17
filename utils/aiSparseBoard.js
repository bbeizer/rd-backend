/**
 * Sparse-board representation for AI search: plain objects, occupied cells only.
 * Faster cloning and hashing than full 64-cell boards during minimax.
 */

const { toCellKey } = require('./gameLogic');

function cloneBoardFast(board) {
  const cloned = {};
  for (const key of Object.keys(board)) {
    const p = board[key];
    if (p) cloned[key] = { color: p.color, hasBall: p.hasBall, position: p.position, id: p.id };
  }
  return cloned;
}

function movePiece(sourceKey, targetKey, board) {
  const newBoard = cloneBoardFast(board);
  const piece = newBoard[sourceKey];
  if (piece) {
    newBoard[targetKey] = { color: piece.color, hasBall: piece.hasBall, position: targetKey, id: piece.id };
    delete newBoard[sourceKey];
  }
  return newBoard;
}

function passBall(sourceKey, targetKey, board) {
  const newBoard = cloneBoardFast(board);
  const src = newBoard[sourceKey];
  const tgt = newBoard[targetKey];
  if (src && tgt) {
    newBoard[sourceKey] = { color: src.color, hasBall: false, position: src.position, id: src.id };
    newBoard[targetKey] = { color: tgt.color, hasBall: true, position: targetKey, id: tgt.id };
  }
  return newBoard;
}

/** Expand sparse board to full 64-cell map (null for empty) — e.g. API / history snapshots. */
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

/** Collision-free position key for transposition table (sorted piece descriptors). */
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

module.exports = {
  cloneBoardFast,
  movePiece,
  passBall,
  expandBoard,
  hashBoard,
};
