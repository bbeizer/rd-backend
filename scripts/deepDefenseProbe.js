/**
 * Deep-search exploration of whether black has any defense to the
 * white-rank-7 strategy. Runs B-Rabbit (with the new presence feature, so it
 * understands rank-7 is critical) at a much larger time budget than normal play
 * to see if extra depth uncovers a defensive resource.
 *
 *   node scripts/deepDefenseProbe.js [--timeLimitMs 60000] [--maxDepth 12]
 *
 * Test stations:
 *   T0  — black to move from the standard opening (response to white move 1)
 *   T2  — black to move after a typical white rank-7 buildup start
 *   T4  — black to move when white has committed knight to e5/d5 (about to strike)
 */

const {
  DIFFICULTY_CONFIGS,
  AI_CONFIG,
  generateTurnOutcomes,
  minimax,
} = require('../utils/aiLogic');
const { cloneBoardFast } = require('../utils/aiSparseBoard');
const { initializeBoardStatus } = require('../utils/gameInitialization');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    timeLimitMs: parseInt(get('--timeLimitMs', '60000'), 10),
    maxDepth: parseInt(get('--maxDepth', '12'), 10),
    topN: parseInt(get('--topN', '5'), 10),
    onlyStation: get('--only', null),
  };
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

// Mutate a board in-place: move piece from src→dst (keeping its id, hasBall).
function movePiece(board, src, dst) {
  const p = board[src];
  if (!p) throw new Error(`no piece at ${src}`);
  board[src] = null;
  board[dst] = { ...p, position: dst };
}

// Stations built by playing N plies of a typical "white pushes for rank 7"
// sequence (mirrors the user's winning game roughly): cN→dN+2, eN→cN+2, etc.
function buildStations() {
  const stations = [];

  // Station S0: standard opening, black to move on turn 1 (response to a quiet
  // white move c1→d3 like in the user's game).
  {
    const b = initializeBoardStatus();
    movePiece(b, 'c1', 'd3');
    stations.push({
      name: 'S0_after_W_c1d3',
      desc: 'Standard opening. White made a quiet developing move c1→d3. Black to respond.',
      board: b,
      sideToMove: 'black',
    });
  }

  // Station S2: white has developed to e5 (one step from rank 7). Black has
  // played one defensive move blocking f7.
  {
    const b = initializeBoardStatus();
    movePiece(b, 'c1', 'd3');
    movePiece(b, 'd8', 'f7'); // black defends rank 7 by occupying f7
    movePiece(b, 'd3', 'e5'); // white now threatens to land on f7/d7 next
    stations.push({
      name: 'S2_W_at_e5_B_defends_f7',
      desc: 'White knight on e5 (one step from rank 7). Black has wisely planted on f7. Black to find next defensive move.',
      board: b,
      sideToMove: 'black',
    });
  }

  // Station S3: white has 2 knights advanced (e5 + d3 again). Black defends
  // both f7 and d7 with rank-7 pieces. Is black surviving?
  {
    const b = initializeBoardStatus();
    movePiece(b, 'c1', 'd3');
    movePiece(b, 'd8', 'f7');
    movePiece(b, 'd3', 'e5');
    movePiece(b, 'c8', 'd6'); // black slightly off-center
    movePiece(b, 'e1', 'd3');
    stations.push({
      name: 'S3_W_2_advanced_B_partial_defense',
      desc: 'White has knights at e5 and d3, threatening multiple rank-7 squares. Black has f7 covered but other rank-7 squares are open.',
      board: b,
      sideToMove: 'black',
    });
  }

  return stations;
}

function runStation(station, opts) {
  console.log(`\n=== ${station.name} ===`);
  console.log(station.desc);
  console.log(render(station.board));

  const baseConfig = DIFFICULTY_CONFIGS.impossible_brabbit;
  const config = {
    ...baseConfig,
    timeLimitMs: opts.timeLimitMs,
    depth: opts.maxDepth,
  };

  const aiColor = station.sideToMove;
  const searchBoard = cloneBoardFast(station.board);
  const ttable = new Map();
  const searchState = {
    deadline: Date.now() + config.timeLimitMs,
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

  const nextTurn = aiColor === 'white' ? 'black' : 'white';
  const outcomes = generateTurnOutcomes(searchBoard, aiColor);
  const rescoreDepth = Math.min(lastCompletedDepth - 1, 4);
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
    : best.score < -500
      ? 'losing badly'
      : best.score < -50
        ? 'slightly losing'
        : best.score < 50
          ? 'EQUAL'
          : best.score < 500
            ? 'slightly winning'
            : 'winning';

  console.log(`searched ${outcomes.length} root outcomes in ${elapsed}s (full depth reached: ${lastCompletedDepth}, rescore at ${rescoreDepth})`);
  console.log(`VERDICT for ${aiColor}: ${verdict}  (best score: ${best.score.toFixed(2)})`);
  for (let i = 0; i < Math.min(opts.topN, scored.length); i++) {
    const s = scored[i];
    console.log(`  ${String(i+1).padStart(2)}. ${s.score.toFixed(2).padStart(10)}  ${describeMoves(s.moves)}`);
  }
  return { name: station.name, bestScore: best.score, verdict, depth: lastCompletedDepth };
}

function main() {
  const opts = parseArgs();
  console.log(`deep defense probe — time budget ${opts.timeLimitMs}ms per station, max depth ${opts.maxDepth}`);
  console.log(`(eval: B-Rabbit with penultimateRankPresence=200)`);
  const stations = buildStations().filter(s => !opts.onlyStation || s.name === opts.onlyStation);
  const results = stations.map(s => runStation(s, opts));
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(32)}  d${r.depth}  best=${r.bestScore.toFixed(2).padStart(10)}  ${r.verdict}`);
  }
}

main();
