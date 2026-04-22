/**
 * Self-play driver for Phase C Stage 1.
 *
 * Runs N games between two difficulties, writing one JSONL row per ply plus a
 * terminal row. Output feeds the Python TD-Leaf trainer in the Flask repo.
 *
 * Usage:
 *   node scripts/selfplay.js --games 100 --white impossible --black impossible
 *   node scripts/selfplay.js --games 50  --out data/selfplay/custom.jsonl
 *
 * Output row shape:
 *   { game, turnNumber, sideToMove, difficulty, preMoveBoard, moves, searchScore }
 *   { game, terminal: true, winnerColor, turns }
 */

const fs = require('fs');
const path = require('path');
const { playGame } = require('../utils/aiDojo');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    games: parseInt(get('--games', '10'), 10),
    white: get('--white', 'impossible'),
    black: get('--black', 'impossible'),
    out: get('--out', null),
  };
}

function main() {
  const opts = parseArgs();
  const outDir = path.resolve(process.cwd(), 'data/selfplay');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = opts.out
    ? path.resolve(process.cwd(), opts.out)
    : path.join(outDir, `${Date.now()}.jsonl`);

  const stream = fs.createWriteStream(outPath, { flags: 'a' });
  const writeRow = (row) => stream.write(JSON.stringify(row) + '\n');

  console.log(`=== selfplay ===`);
  console.log(`games: ${opts.games}  matchup: ${opts.white}(W) vs ${opts.black}(B)`);
  console.log(`output: ${outPath}\n`);

  const startedAt = Date.now();
  for (let g = 1; g <= opts.games; g++) {
    const gameStart = Date.now();
    const result = playGame(opts.white, opts.black, {
      onPly: (ply) => writeRow({ game: g, ...ply }),
    });
    const elapsed = ((Date.now() - gameStart) / 1000).toFixed(1);
    const label = result.winner === 'draw' ? 'DRAW' : `${result.winner} wins`;
    console.log(`  game ${g}/${opts.games}: ${label} in ${result.turns} turns (${elapsed}s)`);
  }

  stream.end();
  const totalMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\ndone in ${totalMin}min → ${outPath}`);
}

main();
