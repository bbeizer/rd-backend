/**
 * Drop the AI into a specific historical position and inspect what it picks.
 *
 *   node scripts/probePosition.js <mongoGameId> <turnNumber> [--difficulty impossible] [--topN 5]
 *
 * --turnNumber refers to moveHistory[turnNumber].boardSnapshot — i.e. the
 * board AFTER turnNumber moves have been played. The script then asks the AI
 * (playing whichever color is to move next) to score all root candidates at
 * full search depth and prints them in order, so we can see whether the
 * defensive move is even in the candidate list and how it ranks.
 *
 * Requires prod MONGO_URI inline (script will fail loudly if not).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Game = require('../models/Game');
const { initializeBoardStatus } = require('../utils/gameInitialization');
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
    gameId: args[0],
    turnNumber: parseInt(args[1], 10),
    difficulty: get('--difficulty', 'impossible'),
    topN: parseInt(get('--topN', '5'), 10),
    timeLimitMs: get('--timeLimitMs', null),
    maxDepth: get('--maxDepth', null),
  };
}

function boardSnapshotToPlain(snapshot) {
  if (!snapshot) return null;
  if (snapshot instanceof Map) {
    const obj = {};
    for (const [k, v] of snapshot.entries()) obj[k] = v ?? null;
    return obj;
  }
  return snapshot;
}

function describeMoves(moves) {
  return moves.map(m => {
    if (m.type === 'move') return `move ${m.from}→${m.to}`;
    if (m.type === 'pass') return `pass ${m.from}→${m.to}`;
    return JSON.stringify(m);
  }).join(' + ');
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

async function main() {
  const opts = parseArgs();
  if (!opts.gameId || isNaN(opts.turnNumber)) {
    console.error('usage: node scripts/probePosition.js <mongoGameId> <turnNumber> [--difficulty impossible] [--topN 5]');
    process.exit(2);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI not set');
    process.exit(2);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const g = await Game.findById(opts.gameId).lean();
  await mongoose.disconnect();
  if (!g) {
    console.error('game not found:', opts.gameId);
    process.exit(1);
  }

  let board;
  let sideToMove;
  if (opts.turnNumber === 0) {
    board = initializeBoardStatus();
    sideToMove = 'white';
  } else {
    const idx = opts.turnNumber - 1;
    const mh = g.moveHistory[idx];
    if (!mh) {
      console.error(`turn ${opts.turnNumber} out of range (game has ${g.moveHistory.length} turns)`);
      process.exit(1);
    }
    board = boardSnapshotToPlain(mh.boardSnapshot);
    sideToMove = mh.player === 'white' ? 'black' : 'white';
  }

  console.log(`game ${opts.gameId} — turn ${opts.turnNumber}, ${sideToMove} to move`);
  console.log(`aiColor=${g.aiColor}, winner=${g.winner}, difficulty=${g.difficulty}`);
  console.log(render(board));

  const baseConfig = DIFFICULTY_CONFIGS[opts.difficulty];
  if (!baseConfig) {
    console.error('unknown difficulty:', opts.difficulty);
    process.exit(1);
  }
  const config = {
    ...baseConfig,
    timeLimitMs: opts.timeLimitMs != null ? parseInt(opts.timeLimitMs, 10) : baseConfig.timeLimitMs,
    depth: opts.maxDepth != null ? parseInt(opts.maxDepth, 10) : baseConfig.depth,
  };

  const aiColor = sideToMove;
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

  console.log(`searching with ${opts.difficulty} (depth ${config.depth}, time ${config.timeLimitMs}ms, eval ${config.evalFn})...`);
  const t0 = Date.now();

  let lastCompletedDepth = 0;
  for (let d = 1; d <= config.depth; d++) {
    const r = minimax(searchBoard, d, -Infinity, Infinity, true, aiColor, aiColor, config.evalFn, ttable, searchState);
    if (r.aborted) break;
    lastCompletedDepth = d;
  }

  const nextTurn = aiColor === 'white' ? 'black' : 'white';
  const outcomes = generateTurnOutcomes(searchBoard, aiColor);
  const rescoreDepth = Math.min(lastCompletedDepth - 1, 3);

  const scored = outcomes
    .filter(o => o.moves.length > 0)
    .map(outcome => ({
      moves: outcome.moves,
      score: minimax(
        outcome.board, rescoreDepth, -Infinity, Infinity,
        false, aiColor, nextTurn, config.evalFn, ttable, null
      ).score,
    }));

  scored.sort((a, b) => b.score - a.score);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`searched ${outcomes.length} root outcomes in ${elapsed}s (rescored at depth ${rescoreDepth}, full search reached depth ${lastCompletedDepth})\n`);

  console.log(`top ${opts.topN} candidates for ${aiColor}:`);
  const INF = AI_CONFIG.INFINITY - 100;
  for (let i = 0; i < Math.min(opts.topN, scored.length); i++) {
    const s = scored[i];
    let tag = '';
    if (s.score >= INF) tag = ' [FORCED WIN]';
    else if (s.score <= -INF) tag = ' [FORCED LOSS]';
    console.log(`  ${String(i + 1).padStart(2)}. ${s.score.toFixed(3).padStart(10)}${tag}  ${describeMoves(s.moves)}`);
  }
  if (scored.length > opts.topN) {
    const last = scored[scored.length - 1];
    console.log(`  ... ${scored.length - opts.topN} more, worst: ${last.score.toFixed(3)}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
