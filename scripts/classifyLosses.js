/**
 * Triage mined AI losses: how many involve the opponent reaching rank 7/2
 * (the penultimate-rank trap) vs. losing some other way?
 *
 * Reads data/selfplay/ai_losses_alltime.jsonl and groups losses by:
 *   - did opponent's BALL ever reach the AI's penultimate rank before terminal?
 *   - if yes: at what turn did it land there?
 *   - did AI have a piece on that penultimate rank when it happened?
 *
 * Usage: node scripts/classifyLosses.js
 */

const fs = require('fs');
const path = require('path');

const file = process.argv[2] || 'data/selfplay/ai_losses_alltime.jsonl';
const lines = fs.readFileSync(path.resolve(file), 'utf8').split('\n').filter(Boolean);

const games = new Map();
for (const line of lines) {
  const row = JSON.parse(line);
  if (!games.has(row.game)) games.set(row.game, { plies: [], terminal: null });
  if (row.terminal) games.get(row.game).terminal = row;
  else games.get(row.game).plies.push(row);
}

function findBall(board) {
  for (const k of Object.keys(board || {})) {
    const p = board[k];
    if (p && p.hasBall) return { color: p.color, pos: k, row: parseInt(k[1], 10) };
  }
  return null;
}

function piecesOnRank(board, color, rank) {
  let n = 0;
  for (const k of Object.keys(board || {})) {
    const p = board[k];
    if (p && p.color === color && parseInt(k[1], 10) === rank) n++;
  }
  return n;
}

let trap = 0, nonTrap = 0, empty = 0;
const summary = [];

for (const [gid, g] of games) {
  if (!g.plies.length || !g.terminal) { empty++; continue; }
  const aiColor = g.terminal.aiColor;
  if (!aiColor) { empty++; continue; }
  const diff = g.terminal.difficulty;
  if (process.env.DIFF_FILTER && diff !== process.env.DIFF_FILTER) continue;
  const oppColor = aiColor === 'white' ? 'black' : 'white';
  // Opponent's "penultimate rank" (i.e., one before opp's goal) is where
  // their ball threatens to score. For opp=white, that's rank 7. For opp=black, rank 2.
  const trapRank = oppColor === 'white' ? 7 : 2;

  // Broader trap detection: opponent has ≥1 piece on AI's penultimate rank
  // at any point during the game. Pre-ball setup counts — that's the threat.
  let trapTurn = null;
  let aiCoverAtTrap = null;
  for (const ply of g.plies) {
    const board = ply.postMoveBoard;
    const oppOnRank = piecesOnRank(board, oppColor, trapRank);
    if (oppOnRank >= 1) {
      trapTurn = ply.turnNumber;
      aiCoverAtTrap = piecesOnRank(board, aiColor, trapRank);
      break;
    }
  }

  if (trapTurn !== null) {
    trap++;
    summary.push({ gid, aiColor, oppColor, trapTurn, aiCoverAtTrap, totalTurns: g.plies.length, diff });
  } else {
    nonTrap++;
    summary.push({ gid, aiColor, oppColor, trapTurn: null, totalTurns: g.plies.length, diff });
  }
}

console.log(`games loaded: ${games.size}`);
console.log(`  trap losses (opp ball reached rank ${"7/2"}): ${trap}`);
console.log(`  non-trap losses:                            ${nonTrap}`);
console.log(`  empty/skipped:                              ${empty}`);
console.log('');
console.log('per-game:');
for (const s of summary) {
  const tag = s.trapTurn !== null
    ? `TRAP @ turn ${s.trapTurn} (AI had ${s.aiCoverAtTrap} pieces on rank, total ${s.totalTurns})`
    : `non-trap (${s.totalTurns} plies)`;
  console.log(`  game ${s.gid} [${s.diff}] ai=${s.aiColor}: ${tag}`);
}
