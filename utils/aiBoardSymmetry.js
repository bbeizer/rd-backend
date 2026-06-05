/**
 * Board symmetry transforms — shared by the eval sanity harness and selfplay
 * data augmentation.
 *
 * The Razzle Dazzle board has two symmetries that any sound eval must respect:
 *   - Horizontal mirror (file a↔h, b↔g, …): the game is L↔R invariant.
 *   - Color flip (rank n ↔ 9−n, swap piece colors): the game is rotationally
 *     symmetric — "the same position viewed from the other side."
 *
 * Composing both gives a fourth variant. Together: orbit size 4 per position.
 * Augmenting selfplay with these variants gives the NN 4× the data and forces
 * it to learn evals that are equivariant under the same symmetries.
 *
 * Search scores survive intact under all three transforms:
 *   - Mirror is a board automorphism → score unchanged.
 *   - Color flip also flips whose turn it is → score unchanged (still "from
 *     side-to-move's POV"). Caller is responsible for flipping sideToMove
 *     alongside the board.
 */

const FILES = 'abcdefgh';

function emptyBoard() {
  const b = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) b[FILES[c] + (8 - r)] = null;
  }
  return b;
}

/** Mirror board left↔right: file 'a' ↔ 'h', 'b' ↔ 'g', etc. */
function mirrorLR(board) {
  const out = emptyBoard();
  for (const key of Object.keys(board)) {
    const p = board[key];
    if (!p) continue;
    const file = key[0], rank = key[1];
    const newKey = FILES[7 - FILES.indexOf(file)] + rank;
    out[newKey] = { ...p, position: newKey, id: newKey };
  }
  return out;
}

/** Flip board top↔bottom AND swap piece colors. */
function flipAndSwapColors(board) {
  const out = emptyBoard();
  for (const key of Object.keys(board)) {
    const p = board[key];
    if (!p) continue;
    const file = key[0], rank = parseInt(key[1], 10);
    const newKey = file + (9 - rank);
    out[newKey] = {
      ...p,
      color: p.color === 'white' ? 'black' : 'white',
      position: newKey,
      id: newKey,
    };
  }
  return out;
}

const otherColor = (c) => (c === 'white' ? 'black' : 'white');

module.exports = { mirrorLR, flipAndSwapColors, otherColor };
