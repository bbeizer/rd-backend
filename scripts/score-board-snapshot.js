/**
 * Score a full 64-cell board through minimax (same path as production AI).
 *
 *   node scripts/score-board-snapshot.js
 *   node scripts/score-board-snapshot.js --full   # depths 1–8 + PV (slow)
 *
 * Edit BOARD_PIECES, CURRENT_TURN, and PERSPECTIVE_COLOR below.
 */

const { minimax, AI_CONFIG } = require('../utils/aiLogic');
const { cloneBoard, toCellKey } = require('../utils/gameLogic');
const { cloneBoardFast } = require('../utils/aiSparseBoard');
const { didWin } = require('../utils/aiEvalCore');
const { DEFAULT_IMPOSSIBLE_WEIGHTS } = require('../utils/aiImpossibleEval');

// After Ryan’s move 8 — black to play next (adjust if your history differs).
const CURRENT_TURN = 'black';
const PERSPECTIVE_COLOR = 'white';

// One ball per side — exactly as in your snapshot.
const BOARD_PIECES = {
  d4: { color: 'black', hasBall: false, position: 'd4' },
  d7: { color: 'white', hasBall: true, position: 'd7' },
  d8: { color: 'black', hasBall: false, position: 'd8' },
  e1: { color: 'white', hasBall: false, position: 'e1' },
  e4: { color: 'black', hasBall: false, position: 'e4' },
  e8: { color: 'black', hasBall: true, position: 'e8' },
  f1: { color: 'white', hasBall: false, position: 'f1' },
  f5: { color: 'white', hasBall: false, position: 'f5' },
};

function buildFullBoard(pieces) {
  const board = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      board[toCellKey(r, c)] = null;
    }
  }
  for (const [key, p] of Object.entries(pieces)) {
    board[key] = { ...p, id: p.id || key };
  }
  return board;
}

function makeSearchState() {
  return {
    deadline: Infinity,
    nodesSearched: 0,
    timeUp: false,
    pvs: false,
    lmr: false,
    quiescence: false,
    weights: DEFAULT_IMPOSSIBLE_WEIGHTS,
  };
}

function main() {
  const fullBoard = buildFullBoard(BOARD_PIECES);
  const sparse = cloneBoardFast(cloneBoard(fullBoard));

  console.log('didWin:', didWin(sparse));
  console.log('currentTurn:', CURRENT_TURN, '| root score perspective:', PERSPECTIVE_COLOR);
  console.log('±INF sentinel:', AI_CONFIG.INFINITY);

  const rootMax = CURRENT_TURN === PERSPECTIVE_COLOR;
  const runDeep = process.argv.includes('--full');
  // Default stops at 5 (depth 4 already shows a proved win here); --full runs 8 + PV (minutes).
  const depths = runDeep ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5];
  const tt = new Map();
  let movesAtDepth8 = null;

  for (const d of depths) {
    const t0 = Date.now();
    tt.clear();
    const r = minimax(
      sparse,
      d,
      -Infinity,
      Infinity,
      rootMax,
      PERSPECTIVE_COLOR,
      CURRENT_TURN,
      'impossible',
      tt,
      makeSearchState()
    );
    const ms = Date.now() - t0;
    const nearInf = Math.abs(r.score) >= AI_CONFIG.INFINITY * 0.99;
    console.log(
      `depth ${String(d).padStart(2)}  score ${String(Math.round(r.score)).padStart(8)}  ${
        nearInf ? '≈±∞ ' : ''
      }  ${ms}ms`
    );
    if (d === 8) movesAtDepth8 = r.moves;
  }

  if (runDeep && movesAtDepth8) {
    console.log('\nBest principal variation (depth 8, impossible):');
    console.log(JSON.stringify(movesAtDepth8, null, 2));
  }
}

main();
