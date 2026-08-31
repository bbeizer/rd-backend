/**
 * Extract walk-back fixtures: one proof-search fixture per turn of a single
 * game, ordered latest -> earliest. Running proofSearch over them walks
 * backward from the end of the game until positions stop being proven wins.
 * The first flip from PROVEN to undecided marks the "blunder boundary" —
 * the move that crossed it is where a defense stopped existing.
 *
 *   MONGO_URI="...prodDB..." node scripts/extractWalkbackFixtures.js \
 *     --gameId 77e1f2 [--out data/selfplay/walkback_77e1f2.json] [--depthHeadroom 4]
 *
 * --gameId matches on the last characters of the Mongo _id (same suffix used
 * in REAL_* fixture names). Each fixture gets maxDepth = plies-remaining +
 * headroom, so late snapshots stay cheap and early ones get room to prove.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Game = require('../models/Game');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    gameId: get('--gameId', null),
    out: get('--out', null),
    depthHeadroom: parseInt(get('--depthHeadroom', '4'), 10),
  };
}

function normalizeBoard(snap) {
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
  if (!opts.gameId) {
    console.error('usage: node scripts/extractWalkbackFixtures.js --gameId <idSuffix>');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  const games = await Game.find({ status: 'completed' })
    .select('aiColor winner moveHistory createdAt difficulty')
    .lean();
  const matches = games.filter(g => String(g._id).endsWith(opts.gameId));
  if (matches.length !== 1) {
    console.error(`gameId suffix "${opts.gameId}" matched ${matches.length} games — need exactly 1`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const g = matches[0];
  const mh = g.moveHistory || [];
  const humanColor = g.aiColor === 'white' ? 'black' : 'white';
  const id6 = String(g._id).slice(-6);
  console.log(`game ${g._id} — ${mh.length} turns, winner ${g.winner}, human=${humanColor}, ai=${g.aiColor} (${g.difficulty})`);

  const fixtures = [];
  // idx mh.length-1 is the winning move itself (terminal board) — skip it.
  // Walk from one turn before the end back to the start of the game.
  for (let idx = mh.length - 2; idx >= 0; idx--) {
    const entry = mh[idx];
    if (!entry.boardSnapshot || Object.keys(entry.boardSnapshot).length === 0) {
      console.log(`  skip idx ${idx} — no boardSnapshot`);
      continue;
    }
    const pliesRemaining = mh.length - (idx + 1);
    fixtures.push({
      name: `WALK_${id6}_T${idx + 1}of${mh.length}`,
      desc: `Walk-back: board after turn ${idx + 1}/${mh.length} (${entry.player} moved). ` +
            `${humanColor} (human) won ${pliesRemaining} plies later.`,
      board: normalizeBoard(entry.boardSnapshot),
      sideToMove: entry.player === 'white' ? 'black' : 'white',
      rootColor: humanColor,
      maxDepth: pliesRemaining + opts.depthHeadroom,
      gameId: String(g._id),
      totalTurns: mh.length,
      snapshotTurn: idx + 1,
    });
  }

  console.log(`extracted ${fixtures.length} fixtures (latest -> earliest):`);
  for (const fx of fixtures) {
    console.log(`  ${fx.name}  sideToMove=${fx.sideToMove}  maxDepth=${fx.maxDepth}`);
  }

  const outPath = path.resolve(opts.out || `data/selfplay/walkback_${id6}.json`);
  fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  console.log(`\nwrote ${outPath}`);

  await mongoose.disconnect();
})();
