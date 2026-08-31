/**
 * Turn-grammar completeness audit: replay every recorded real game and assert
 * that every turn actually played (human AND ai) is expressible by
 * generateTurnOutcomes. Humans are the fuzzer — if the generator can produce
 * every board transition real players have ever made, hidden grammar gaps
 * (like the July pass-then-move hole, Step 0) become far less likely.
 *
 * For each game: start from the canonical initial board, then for each
 * moveHistory entry check that hashBoard(entry.boardSnapshot) appears among
 * hashBoard(o.board) for o in generateTurnOutcomes(prevBoard, entry.player).
 *
 *   MONGO_URI="..." node scripts/auditTurnGrammar.js [--verbose]
 *
 * Exit code 0 = every turn of every game reproduced; 1 = gaps found.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Game = require('../models/Game');
const { generateTurnOutcomes } = require('../utils/aiLogic');
const { hashBoard } = require('../utils/aiSparseBoard');
const { initializeBoardStatus } = require('../utils/gameInitialization');

const verbose = process.argv.includes('--verbose');

function normalizeBoard(snap) {
  const out = {};
  for (let r = 1; r <= 8; r++) {
    for (let f = 0; f < 8; f++) {
      const k = String.fromCharCode(97 + f) + r;
      const v = snap && snap[k];
      out[k] = v && typeof v === 'object' && v.color
        ? { color: v.color, hasBall: !!v.hasBall, position: k, id: v.id || `${v.color[0]}_${k}` }
        : null;
    }
  }
  return out;
}

function render(board) {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  let out = '     ' + files.join(' ') + '\n';
  for (let r = 8; r >= 1; r--) {
    let row = '  ' + r + '  ';
    for (const f of files) {
      const c = board[f + r];
      row += (!c ? '.' : c.color === 'white' ? (c.hasBall ? 'W' : 'w') : (c.hasBall ? 'B' : 'b')) + ' ';
    }
    out += row + '\n';
  }
  return out;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const games = await Game.find({ status: 'completed' })
    .select('aiColor winner difficulty createdAt moveHistory')
    .lean();
  console.log(`auditing ${games.length} completed games...`);

  let turnsChecked = 0;
  let turnsSkipped = 0;
  const gaps = [];

  for (const g of games) {
    const mh = g.moveHistory || [];
    if (mh.length === 0) { continue; }
    const id6 = String(g._id).slice(-6);
    let prev = normalizeBoard(initializeBoardStatus());
    let chainOk = true;

    for (let idx = 0; idx < mh.length; idx++) {
      const entry = mh[idx];
      const hasSnap = entry.boardSnapshot && Object.keys(entry.boardSnapshot).length > 0;
      if (!hasSnap) {
        // Can't verify this link; chain is broken until the next snapshot.
        turnsSkipped++;
        chainOk = false;
        continue;
      }
      const target = normalizeBoard(entry.boardSnapshot);
      const targetHash = hashBoard(target);
      if (!chainOk) {
        // Resume the chain from this snapshot without checking the gap turn.
        prev = target;
        chainOk = true;
        turnsSkipped++;
        continue;
      }
      const player = entry.player;
      const outcomes = generateTurnOutcomes(prev, player);
      const found = outcomes.some(o => hashBoard(o.board) === targetHash);
      turnsChecked++;
      if (!found) {
        gaps.push({ game: id6, turn: idx + 1, of: mh.length, player, difficulty: g.difficulty });
        console.log(`\nGAP: game ${id6} turn ${idx + 1}/${mh.length} (${player}, difficulty=${g.difficulty})`);
        console.log('before:\n' + render(prev));
        console.log('after (unreachable by generator):\n' + render(target));
        console.log(`generator produced ${outcomes.length} outcomes, none match`);
      }
      prev = target;
    }
    if (verbose) console.log(`  game ${id6}: ok (${mh.length} turns)`);
  }

  console.log(`\n=== AUDIT SUMMARY ===`);
  console.log(`games: ${games.length}`);
  console.log(`turns verified: ${turnsChecked}`);
  console.log(`turns skipped (missing snapshots): ${turnsSkipped}`);
  console.log(`grammar gaps: ${gaps.length}`);
  if (gaps.length === 0) {
    console.log('every recorded real turn is expressible by generateTurnOutcomes ✓');
  } else {
    for (const gap of gaps) {
      console.log(`  game ${gap.game} turn ${gap.turn}/${gap.of} (${gap.player})`);
    }
  }
  await mongoose.disconnect();
  process.exit(gaps.length === 0 ? 0 : 1);
})();
