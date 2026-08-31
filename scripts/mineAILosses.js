/**
 * Mine AI-loss games from MongoDB into a selfplay-format JSONL.
 *
 * Queries games where the AI played and lost (status=completed,
 * aiColor set, winner !== aiColor) within a recent time window, walks each
 * game's moveHistory, and emits one row per ply plus a terminal row in the
 * exact shape that scripts/retroLabel.js expects. Feed the labeled output to
 * the Flask trainer as an adversarial "hard cases" corpus.
 *
 * Usage:
 *   node scripts/mineAILosses.js [--days 2] [--difficulty impossible]
 *                                [--out data/selfplay/ai_losses.jsonl]
 *
 * Then label:
 *   node scripts/retroLabel.js data/selfplay/ai_losses.jsonl
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Game = require('../models/Game');
const { initializeBoardStatus } = require('../utils/gameInitialization');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    days: parseFloat(get('--days', '2')),
    difficulty: get('--difficulty', null),
    out: get('--out', null),
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

async function main() {
  const opts = parseArgs();
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI not set in .env');
    process.exit(2);
  }

  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  const query = {
    status: 'completed',
    aiColor: { $ne: null },
    winner: { $nin: [null, 'AI'] },
    createdAt: { $gte: since },
  };
  if (opts.difficulty) query.difficulty = opts.difficulty;

  await mongoose.connect(process.env.MONGO_URI);

  const games = await Game.find(query)
    .select('aiColor winner difficulty createdAt moveHistory')
    .lean();

  const losses = games;

  const outDir = path.resolve(process.cwd(), 'data/selfplay');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = opts.out
    ? path.resolve(process.cwd(), opts.out)
    : path.join(outDir, `ai_losses_${Date.now()}.jsonl`);

  const fd = fs.openSync(outPath, 'w');
  let plies = 0;
  let kept = 0;

  for (let i = 0; i < losses.length; i++) {
    const g = losses[i];
    const gameId = i + 1;
    const initial = initializeBoardStatus();
    let prevBoard = initial;
    let turns = 0;

    for (const mv of g.moveHistory || []) {
      const post = boardSnapshotToPlain(mv.boardSnapshot);
      if (!post) { prevBoard = prevBoard; continue; }
      const row = {
        game: gameId,
        turnNumber: mv.turnNumber ?? turns,
        sideToMove: mv.player,
        difficulty: g.difficulty,
        preMoveBoard: prevBoard,
        postMoveBoard: post,
        moves: [],
        searchScore: null,
        augment: 'orig',
        source: 'db_mined',
        gameMongoId: String(g._id),
      };
      fs.writeSync(fd, JSON.stringify(row) + '\n');
      prevBoard = post;
      turns++;
      plies++;
    }

    fs.writeSync(fd, JSON.stringify({
      game: gameId,
      terminal: true,
      winnerColor: g.winner,
      turns,
      aiColor: g.aiColor,
      difficulty: g.difficulty,
      gameMongoId: String(g._id),
    }) + '\n');
    kept++;
  }

  fs.closeSync(fd);
  await mongoose.disconnect();

  console.log(`scanned ${games.length} completed AI games, kept ${kept} losses`);
  console.log(`wrote ${plies} plies → ${outPath}`);
  console.log(`next: node scripts/retroLabel.js ${path.relative(process.cwd(), outPath)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
