/**
 * Backfill the persisted TT with proven-win positions from historical games.
 *
 * For each completed game whose terminal board actually satisfies didWin() for
 * the recorded winner, takes the position *just before* the winning move and
 * writes it as a WIN for the side that was about to deliver.
 *
 * Correctness: didWin() is a pure function of piece positions on the goal rank.
 * If it returns the recorded winner's color on moveHistory[last].boardSnapshot,
 * then the winner really did deliver — so moveHistory[last-1].boardSnapshot is
 * a position where winner-to-move can force a win in one ply. That fact is
 * independent of any search bug or eval version.
 *
 * Only one entry per game: going further back (N-3, N-4, ...) would require
 * assuming both sides played optimally, which we can't verify from the record.
 *
 * Usage:
 *   node scripts/backfill-persisted-tt.js --count          # count only, no writes
 *   node scripts/backfill-persisted-tt.js --dry-run        # simulate, log only
 *   node scripts/backfill-persisted-tt.js                  # execute (needs PERSIST_TT_WRITE=1)
 *
 * CLI filters (all optional):
 *   --difficulty impossible|hard|medium|easy|any         (default: impossible)
 *   --since 2026-04-01                                   (createdAt >= date)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Game = require('../models/Game');
const { hashBoard, cloneBoardFast } = require('../utils/aiSparseBoard');
const { didWin } = require('../utils/aiEvalCore');
const { openStore } = require('../utils/aiPositionStore');
const { persistKey } = require('../utils/aiPersistTT');

const BACKFILL_SOURCE = 'backfill';

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = (k) => args.indexOf(k);
  const get = (k, d) => { const i = idx(k); return i === -1 ? d : args[i + 1]; };
  return {
    countOnly: args.includes('--count'),
    dryRun: args.includes('--dry-run'),
    difficulty: get('--difficulty', 'impossible'),
    since: get('--since', null),
  };
}

function toPlainBoard(snapshot) {
  if (!snapshot) return null;
  return snapshot instanceof Map ? Object.fromEntries(snapshot) : snapshot;
}

/**
 * Returns a cache entry for a single game, or null if the game can't be safely
 * cached. Safety requires: 2+ moves, a pre-winning snapshot, and a terminal
 * snapshot where didWin() actually returns the recorded winner's color.
 */
function extractEntry(game) {
  if (!Array.isArray(game.moveHistory) || game.moveHistory.length < 2) return null;

  const last = game.moveHistory[game.moveHistory.length - 1];
  const prev = game.moveHistory[game.moveHistory.length - 2];
  if (!last || !prev || !last.boardSnapshot || !prev.boardSnapshot || !last.player) return null;

  const terminalBoard = cloneBoardFast(toPlainBoard(last.boardSnapshot));
  const winnerColor = didWin(terminalBoard);
  if (!winnerColor) return null;           // game ended without a real delivery
  if (winnerColor !== last.player) return null; // recorded winner ≠ actual winner

  const preWinBoard = cloneBoardFast(toPlainBoard(prev.boardSnapshot));
  return {
    hash: persistKey(hashBoard(preWinBoard), winnerColor),
    result: 'WIN',
    distance: 1,
    bestMove: null,
    source: BACKFILL_SOURCE,
  };
}

async function main() {
  const opts = parseArgs();
  const writeEnabled = process.env.PERSIST_TT_WRITE === '1';

  if (!opts.countOnly && !opts.dryRun && !writeEnabled) {
    console.error('Refusing to write without PERSIST_TT_WRITE=1. Use --count or --dry-run to preview.');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI not set in env.');
    process.exit(1);
  }

  const filter = { status: 'completed', winner: { $ne: null } };
  if (opts.difficulty !== 'any') filter.difficulty = opts.difficulty;
  if (opts.since) filter.createdAt = { $gte: new Date(opts.since) };

  console.log(`=== backfill-persisted-tt (${opts.countOnly ? 'count' : opts.dryRun ? 'dry-run' : 'live'}) ===`);
  console.log(`Filter: ${JSON.stringify(filter)}`);

  await mongoose.connect(process.env.MONGO_URI);
  const total = await Game.countDocuments(filter);
  console.log(`Qualifying games: ${total}\n`);

  if (opts.countOnly) {
    await mongoose.disconnect();
    return;
  }

  const store = !opts.dryRun ? openStore() : null;
  if (store) console.log(`Store path: ${store.dbPath}`);

  let processed = 0, written = 0, skippedShort = 0, skippedNoWin = 0;
  const cursor = Game.find(filter).cursor();
  for await (const game of cursor) {
    processed++;
    if (!game.moveHistory || game.moveHistory.length < 2) { skippedShort++; continue; }
    const entry = extractEntry(game);
    if (!entry) { skippedNoWin++; continue; }
    if (opts.dryRun) {
      if (written < 5) console.log(`  [dry] ${entry.hash.slice(0, 60)}… → ${entry.result}`);
    } else {
      store.put(entry);
    }
    written++;
  }

  console.log(`\nProcessed: ${processed}`);
  console.log(`${opts.dryRun ? 'Would write' : 'Wrote'}: ${written}`);
  console.log(`Skipped (too short): ${skippedShort}`);
  console.log(`Skipped (terminal didWin mismatch): ${skippedNoWin}`);
  if (store) {
    console.log(`DB size after: ${store.size()}`);
    store.close();
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
