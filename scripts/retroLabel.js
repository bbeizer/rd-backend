/**
 * Retrofill outcome labels (z) onto a selfplay JSONL.
 *
 * For each ply row, stamps z ∈ {-1, 0, +1} from the perspective of sideToMove,
 * based on the game's terminal row:
 *   winnerColor === sideToMove → +1
 *   winnerColor === other      → -1
 *   draw / missing             →  0
 *
 * Augmented rows already carry the correct (post-transform) sideToMove, so the
 * same rule applies uniformly — color-flip variants get their sign flipped
 * automatically.
 *
 * Usage:
 *   node scripts/retroLabel.js <in.jsonl> [out.jsonl]
 *   (default out: <in>.labeled.jsonl)
 */

const fs = require('fs');
const path = require('path');

function main() {
  const [, , inPath, outArg] = process.argv;
  if (!inPath) {
    console.error('usage: node scripts/retroLabel.js <in.jsonl> [out.jsonl]');
    process.exit(2);
  }
  const outPath = outArg || inPath.replace(/\.jsonl$/, '.labeled.jsonl');

  const rows = fs.readFileSync(inPath, 'utf8').trim().split('\n').map(JSON.parse);

  const winnerByGame = {};
  for (const r of rows) {
    if (r.terminal) winnerByGame[r.game] = r.winnerColor || null;
  }

  let labeled = 0, missing = 0;
  const fd = fs.openSync(outPath, 'w');
  for (const r of rows) {
    if (r.terminal) {
      fs.writeSync(fd, JSON.stringify(r) + '\n');
      continue;
    }
    const w = winnerByGame[r.game];
    let z;
    if (w == null || w === 'draw') z = 0;
    else if (w === r.sideToMove) z = 1;
    else z = -1;
    if (w == null) missing++;
    fs.writeSync(fd, JSON.stringify({ ...r, z }) + '\n');
    labeled++;
  }
  fs.closeSync(fd);

  console.log(`labeled ${labeled} plies across ${Object.keys(winnerByGame).length} games`);
  if (missing) console.log(`WARN: ${missing} plies had no terminal row (z=0)`);
  console.log(`→ ${outPath}`);
}

main();
