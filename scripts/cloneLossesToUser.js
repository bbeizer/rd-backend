/**
 * Clone selected mined-loss games and assign the human-side player id to a
 * target user so they show up in that account's game history. Originals are
 * untouched.
 *
 *   node scripts/cloneLossesToUser.js --email bhb987@gmail.com \
 *        --games 5,6,8,10,11,12,13,14,15 \
 *        [--file data/selfplay/ai_losses_alltime.jsonl] [--apply]
 *
 * Without --apply, runs in dry-run mode (no writes).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Game = require('../models/Game');
const User = require('../models/User');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    email: get('--email', null),
    games: (get('--games', '') || '').split(',').map(s => parseInt(s, 10)).filter(Number.isFinite),
    file: get('--file', 'data/selfplay/ai_losses_alltime.jsonl'),
    apply: args.includes('--apply'),
  };
}

async function main() {
  const opts = parseArgs();
  if (!opts.email) throw new Error('--email required');
  if (!opts.games.length) throw new Error('--games required');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI not set');

  // Read JSONL → map gameId (synthetic) → gameMongoId + aiColor.
  const lines = fs.readFileSync(path.resolve(opts.file), 'utf8').split('\n').filter(Boolean);
  const want = new Set(opts.games);
  const found = new Map(); // syntheticId -> { mongoId, aiColor }
  for (const line of lines) {
    const row = JSON.parse(line);
    if (!want.has(row.game)) continue;
    if (row.terminal) {
      found.set(row.game, { mongoId: row.gameMongoId, aiColor: row.aiColor });
    }
  }

  for (const gid of opts.games) {
    if (!found.has(gid)) console.warn(`  WARN: game ${gid} not found in JSONL terminal rows`);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`mongo connected (db=${mongoose.connection.name})`);

  const user = await User.findOne({ email: opts.email }).lean();
  if (!user) throw new Error(`no user with email ${opts.email}`);
  console.log(`target user: ${user._id} (${user.username || user.email})`);
  const userIdStr = String(user._id);

  let cloned = 0;
  for (const [gid, { mongoId, aiColor }] of found) {
    const orig = await Game.findById(mongoId).lean();
    if (!orig) { console.warn(`  game ${gid} (${mongoId}): not found in DB, skipping`); continue; }

    const humanSide = aiColor === 'white' ? 'black' : 'white';
    const clone = { ...orig };
    delete clone._id;
    delete clone.createdAt;
    delete clone.updatedAt;
    if (humanSide === 'white') {
      clone.whitePlayerId = userIdStr;
      clone.whitePlayerName = user.username || 'allen chiverson';
    } else {
      clone.blackPlayerId = userIdStr;
      clone.blackPlayerName = user.username || 'allen chiverson';
    }

    if (opts.apply) {
      const inserted = await Game.create(clone);
      console.log(`  game ${gid} (orig ${mongoId}) → cloned as ${inserted._id} (human=${humanSide})`);
    } else {
      console.log(`  [dry-run] game ${gid} (orig ${mongoId}) would clone, human=${humanSide}, ai=${aiColor}, turns=${(orig.moveHistory||[]).length}`);
    }
    cloned++;
  }

  console.log(`\n${opts.apply ? 'cloned' : 'would clone'} ${cloned} games`);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
