/**
 * Self-play driver for Phase C Stage 1.
 *
 * Runs N games between two difficulties, writing one JSONL row per ply plus a
 * terminal row. Output feeds the Python TD-Leaf trainer in the Flask repo.
 *
 * Usage:
 *   node scripts/selfplay.js --games 100 --white impossible --black impossible
 *   node scripts/selfplay.js --games 50 --topN 3 --topNEpsilon 1.0 --topNGap 3.0
 *   node scripts/selfplay.js --games 20 --out data/selfplay/custom.jsonl
 *
 * Variance flags (override the difficulty's built-in topN):
 *   --topN N          Sample randomly among the top-N candidate moves.
 *   --topNEpsilon E   Moves within E score of the best are interchangeable (default 1.0).
 *   --topNGap G       If best leads second-best by ≥G, take best alone (default 3.0).
 * Forced wins (≥ INF threshold) ignore both knobs and always pick a winning move.
 *
 * Output row shape:
 *   { game, turnNumber, sideToMove, difficulty, preMoveBoard, moves, searchScore }
 *   { game, terminal: true, winnerColor, turns }
 */

const fs = require('fs');
const path = require('path');
const { playGame } = require('../utils/aiDojo');
const { mirrorLR, flipAndSwapColors, otherColor } = require('../utils/aiBoardSymmetry');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    games: parseInt(get('--games', '10'), 10),
    white: get('--white', 'impossible'),
    black: get('--black', 'impossible'),
    out: get('--out', null),
    topN: get('--topN', null),
    topNEpsilon: get('--topNEpsilon', null),
    topNGap: get('--topNGap', null),
    augment: args.includes('--augment'),
  };
}

/**
 * Emit the 4 symmetry variants of a ply: original, mirror (L↔R), color-flip
 * (↑↓ + swap colors), and mirror+flip. All variants share the same searchScore
 * (mirror is a board automorphism; color-flip also flips sideToMove, so the
 * score is still "from side-to-move's POV"). Augmenter only touches
 * preMoveBoard + sideToMove — moves/postMoveBoard are dropped because the
 * trainer doesn't need them and transforming move keys is fragile.
 */
function augmentPly(ply) {
  const { preMoveBoard, sideToMove, searchScore, ...rest } = ply;
  const variants = [
    { tag: 'orig',          board: preMoveBoard, side: sideToMove },
    { tag: 'mirror',        board: mirrorLR(preMoveBoard), side: sideToMove },
    { tag: 'colorflip',     board: flipAndSwapColors(preMoveBoard), side: otherColor(sideToMove) },
    { tag: 'mirrorflip',    board: flipAndSwapColors(mirrorLR(preMoveBoard)), side: otherColor(sideToMove) },
  ];
  return variants.map(v => ({
    ...rest,
    sideToMove: v.side,
    preMoveBoard: v.board,
    searchScore,
    augment: v.tag,
  }));
}

function main() {
  const opts = parseArgs();
  const outDir = path.resolve(process.cwd(), 'data/selfplay');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = opts.out
    ? path.resolve(process.cwd(), opts.out)
    : path.join(outDir, `${Date.now()}.jsonl`);

  const aiOpts = {};
  if (opts.topN != null) aiOpts.topN = parseInt(opts.topN, 10);
  if (opts.topNEpsilon != null) aiOpts.topNEpsilon = parseFloat(opts.topNEpsilon);
  if (opts.topNGap != null) aiOpts.topNGap = parseFloat(opts.topNGap);

  // Sync writes: playGame is heavy-CPU and never yields, so the async
  // WriteStream's lazy open() never fires and buffered writes are lost on kill.
  // openSync + writeSync flushes per row — fine for ~1000 lines/game.
  const fd = fs.openSync(outPath, 'a');
  const writeRow = (row) => fs.writeSync(fd, JSON.stringify(row) + '\n');

  console.log(`=== selfplay ===`);
  console.log(`games: ${opts.games}  matchup: ${opts.white}(W) vs ${opts.black}(B)`);
  if (Object.keys(aiOpts).length > 0) {
    console.log(`aiOpts: ${JSON.stringify(aiOpts)}`);
  }
  if (opts.augment) console.log(`augment: ON (4× rows per ply: orig + mirror + colorflip + mirrorflip)`);
  console.log(`output: ${outPath}\n`);

  const startedAt = Date.now();
  for (let g = 1; g <= opts.games; g++) {
    const gameStart = Date.now();
    const result = playGame(opts.white, opts.black, {
      onPly: (ply) => {
        // Terminal-row plies carry no preMoveBoard; emit them as-is so the
        // game-outcome record survives.
        if (opts.augment && ply.preMoveBoard) {
          for (const v of augmentPly(ply)) writeRow({ game: g, ...v });
        } else {
          writeRow({ game: g, ...ply });
        }
      },
      aiOpts,
    });
    const elapsed = ((Date.now() - gameStart) / 1000).toFixed(1);
    const label = result.winner === 'draw' ? 'DRAW' : `${result.winner} wins`;
    console.log(`  game ${g}/${opts.games}: ${label} in ${result.turns} turns (${elapsed}s)`);
  }

  fs.closeSync(fd);
  const totalMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\ndone in ${totalMin}min → ${outPath}`);
}

main();
