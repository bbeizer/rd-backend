/**
 * Test whether positions with a white piece + ball on rank 7 are
 * geometrically forced wins for white.
 *
 * For each fixture position (black to move, defending), runs the impossible-tier
 * AI as black at full search budget. Reports the best move and its score. If
 * every fixture's best score is near -INF (forced loss), the geometric
 * conjecture holds. If any fixture finds a saving move (small negative or
 * positive score), study that move — it's the defensive principle.
 *
 *   node scripts/testRank7Forced.js [--topN 3] [--difficulty impossible]
 */

const {
  DIFFICULTY_CONFIGS,
  AI_CONFIG,
  generateTurnOutcomes,
  minimax,
} = require('../utils/aiLogic');
const { cloneBoardFast } = require('../utils/aiSparseBoard');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    topN: parseInt(get('--topN', '3'), 10),
    difficulty: get('--difficulty', 'impossible'),
    onlyName: get('--only', null),
  };
}

// Build an empty 8x8 board.
function emptyBoard() {
  const b = {};
  for (let r = 1; r <= 8; r++) {
    for (let f = 0; f < 8; f++) {
      b[String.fromCharCode(97 + f) + r] = null;
    }
  }
  return b;
}

// Place a piece. `code` like 'w', 'W' (white with ball), 'b', 'B'.
function place(board, pos, code) {
  const color = code.toLowerCase() === 'w' ? 'white' : 'black';
  const hasBall = code === code.toUpperCase();
  board[pos] = { color, hasBall, position: pos, id: `${code}_${pos}` };
}

function pos(spec) {
  const board = emptyBoard();
  for (const [p, code] of spec) place(board, p, code);
  return board;
}

function render(board) {
  const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  let out = '     ' + files.join(' ') + '\n';
  for (const r of ranks) {
    let row = '  ' + r + '  ';
    for (const f of files) {
      const c = board[f + r];
      if (!c) row += '. ';
      else row += (c.color === 'white' ? (c.hasBall ? 'W' : 'w') : (c.hasBall ? 'B' : 'b')) + ' ';
    }
    out += row + '\n';
  }
  return out;
}

function describeMoves(moves) {
  return moves.map(m => {
    if (m.type === 'move') return `move ${m.from}→${m.to}`;
    if (m.type === 'pass') return `pass ${m.from}→${m.to}`;
    return JSON.stringify(m);
  }).join(' + ');
}

// Each fixture: black to move, defending. White already has piece+ball on rank 7.
const FIXTURES = [
  {
    name: 'P1_naked_f7',
    desc: 'White ball on f7 (penultimate). Black has all 4 back-rank defenders, ball still on e8. The "earliest possible" attack.',
    spec: [
      ['c8','b'], ['d8','b'], ['e8','B'], ['f8','b'],
      ['f7','W'],
      ['c1','w'], ['d1','w'], ['e1','w'],
    ],
  },
  {
    name: 'P2_central_e7',
    desc: 'White ball on e7 (most central rank-7 square). Black full back rank.',
    spec: [
      ['c8','b'], ['d8','b'], ['e8','B'], ['f8','b'],
      ['e7','W'],
      ['c1','w'], ['d1','w'], ['f1','w'],
    ],
  },
  {
    name: 'P3_supported_f7',
    desc: 'White ball on f7 with a second white piece at e6 (relay support). Black full back rank.',
    spec: [
      ['c8','b'], ['d8','b'], ['e8','B'], ['f8','b'],
      ['f7','W'], ['e6','w'],
      ['c1','w'], ['d1','w'],
    ],
  },
  {
    name: 'P4_corner_b7',
    desc: 'White ball on b7 (corner penultimate). Black full back rank — does corner reduce attacker options enough to save?',
    spec: [
      ['c8','b'], ['d8','b'], ['e8','B'], ['f8','b'],
      ['b7','W'],
      ['c1','w'], ['d1','w'], ['e1','w'],
    ],
  },
  {
    name: 'P5_active_defense',
    desc: 'White ball on f7. Black has moved a defender forward to e7 and another to g7, trying to crowd attacker.',
    spec: [
      ['c8','b'], ['d8','b'],
      ['e7','b'], ['g7','b'],
      ['f7','W'],
      ['c1','w'], ['d1','w'], ['e1','w'],
      ['e8','B'],
    ],
  },
];

function runFixture(fixture, opts) {
  const board = pos(fixture.spec);
  console.log(`\n=== ${fixture.name} ===`);
  console.log(fixture.desc);
  console.log(render(board));

  const config = DIFFICULTY_CONFIGS[opts.difficulty];
  const aiColor = 'black';
  const searchBoard = cloneBoardFast(board);
  const ttable = new Map();
  const searchState = {
    deadline: config.timeLimitMs ? Date.now() + config.timeLimitMs : Infinity,
    nodesSearched: 0,
    timeUp: false,
    pvs: !!config.pvs,
    lmr: !!config.lmr,
    quiescence: !!config.quiescence,
    weights: undefined,
  };

  const t0 = Date.now();
  let lastCompletedDepth = 0;
  for (let d = 1; d <= config.depth; d++) {
    const r = minimax(searchBoard, d, -Infinity, Infinity, true, aiColor, aiColor, config.evalFn, ttable, searchState);
    if (r.aborted) break;
    lastCompletedDepth = d;
  }

  const nextTurn = 'white';
  const outcomes = generateTurnOutcomes(searchBoard, aiColor);
  const rescoreDepth = Math.min(lastCompletedDepth - 1, 3);
  const scored = outcomes
    .filter(o => o.moves.length > 0)
    .map(outcome => ({
      moves: outcome.moves,
      score: minimax(outcome.board, rescoreDepth, -Infinity, Infinity, false, aiColor, nextTurn, config.evalFn, ttable, null).score,
    }))
    .sort((a, b) => b.score - a.score);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const INF = AI_CONFIG.INFINITY - 100;
  const best = scored[0];
  const verdict = best.score <= -INF
    ? 'FORCED LOSS'
    : best.score < -1000
      ? 'losing badly'
      : best.score < -100
        ? 'losing'
        : best.score < 100
          ? 'unclear / drawish'
          : 'WINNING';

  console.log(`searched ${outcomes.length} root outcomes in ${elapsed}s (full depth ${lastCompletedDepth}, rescore ${rescoreDepth})`);
  console.log(`VERDICT: ${verdict}  (best score: ${best.score.toFixed(2)})`);
  for (let i = 0; i < Math.min(opts.topN, scored.length); i++) {
    const s = scored[i];
    console.log(`  ${String(i+1).padStart(2)}. ${s.score.toFixed(2).padStart(10)}  ${describeMoves(s.moves)}`);
  }
  return { name: fixture.name, bestScore: best.score, verdict };
}

function main() {
  const opts = parseArgs();
  const results = [];
  for (const fx of FIXTURES) {
    if (opts.onlyName && fx.name !== opts.onlyName) continue;
    results.push(runFixture(fx, opts));
  }
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(24)}  best=${r.bestScore.toFixed(2).padStart(10)}  ${r.verdict}`);
  }
}

main();
