/**
 * Extract proof-search fixtures from real human wins vs impossible AI in prodDB.
 *
 * For each win, pulls the board snapshot from N turns before the end (default 6)
 * and writes a fixtures JSON the proof search can load.
 *
 *   MONGO_URI="...prodDB..." node scripts/extractWinFixtures.js
 *     [--turnsFromEnd 6] [--out scripts/winFixtures.json]
 *
 * sideToMove is inferred from moveHistory[i].player — after player P moves,
 * the opposite color is to move.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Game = require('../models/Game');

const AI_WINNER_LABELS = new Set([
  'AI', 'easy', 'medium', 'hard', 'impossible',
  'Tortuga', 'Legacy', 'B-Rabbit', 'combo_big',
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    turnsFromEnd: parseInt(get('--turnsFromEnd', '6'), 10),
    out: get('--out', 'scripts/winFixtures.json'),
  };
}

function normalizeBoard(snap) {
  // boardSnapshot is a plain object with cell positions -> piece or null.
  // Strip any mongoose metadata, keep only known cell keys.
  const out = {};
  for (let r = 1; r <= 8; r++) {
    for (let f = 0; f < 8; f++) {
      const k = String.fromCharCode(97 + f) + r;
      const v = snap && snap[k];
      if (v && typeof v === 'object' && v.color) {
        out[k] = {
          color: v.color,
          hasBall: !!v.hasBall,
          position: k,
          id: v.id || `${v.color[0]}_${k}`,
        };
      } else {
        out[k] = null;
      }
    }
  }
  return out;
}

(async () => {
  const opts = parseArgs();
  await mongoose.connect(process.env.MONGO_URI);

  const games = await Game.find({
    status: 'completed',
    difficulty: 'impossible',
    aiColor: { $ne: null },
    winner: { $ne: null },
  })
    .select('aiColor winner moveHistory createdAt whitePlayerName blackPlayerName difficulty')
    .lean();

  const humanWins = games.filter(g => g.winner && !AI_WINNER_LABELS.has(g.winner));
  console.log(`found ${humanWins.length} human wins vs impossible`);

  const fixtures = [];
  for (const g of humanWins) {
    const mh = g.moveHistory || [];
    if (mh.length < opts.turnsFromEnd + 1) {
      console.log(`  skip ${g._id} — only ${mh.length} turns, need at least ${opts.turnsFromEnd + 1}`);
      continue;
    }
    const idx = mh.length - opts.turnsFromEnd - 1;
    const entry = mh[idx];
    if (!entry.boardSnapshot || Object.keys(entry.boardSnapshot).length === 0) {
      console.log(`  skip ${g._id} — no boardSnapshot at idx ${idx}`);
      continue;
    }
    const humanColor = g.aiColor === 'white' ? 'black' : 'white';
    // After moveHistory[idx].player moves, opposite color is to move.
    const sideToMove = entry.player === 'white' ? 'black' : 'white';
    const board = normalizeBoard(entry.boardSnapshot);

    fixtures.push({
      name: `REAL_${String(g._id).slice(-6)}_T${idx + 1}of${mh.length}`,
      desc: `From ${humanColor} (human) win vs impossible AI on ${g.createdAt.toISOString().slice(0,10)}. ` +
            `Board after turn ${idx + 1}/${mh.length}. ${humanColor} won ${opts.turnsFromEnd} turns later.`,
      board,
      sideToMove,
      rootColor: humanColor,  // prove from the winner's POV
      gameId: String(g._id),
      humanColor,
      aiColor: g.aiColor,
      totalTurns: mh.length,
      snapshotTurn: idx + 1,
    });
  }

  console.log(`\nextracted ${fixtures.length} fixtures`);
  for (const fx of fixtures) {
    console.log(`  ${fx.name}  sideToMove=${fx.sideToMove}  rootColor=${fx.rootColor}`);
  }

  const outPath = path.resolve(opts.out);
  fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  console.log(`\nwrote ${outPath}`);

  await mongoose.disconnect();
})();
