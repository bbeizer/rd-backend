/**
 * Generate perturbation-probe fixtures from a proven-win seed position.
 *
 * For each piece of the defending side (the side rootColor beats), create one
 * variant per empty square: that piece alone teleported there, everything else
 * unchanged. Running proofSearch over the variants partitions defender
 * placements into "still dead" (PROVEN WIN again) vs "survives" (undecided) —
 * the empirical boundary of the win region around the seed.
 *
 *   node scripts/generatePerturbations.js \
 *     --fixtures scripts/winFixtures.json --name REAL_77e1f2_T9of15 \
 *     [--maxDepth 7] [--out data/selfplay/perturb_<name>.json]
 *
 * --maxDepth should be the seed's proven depth + 1: variants that don't prove
 * by then count as "survives at least one ply longer than the seed's proof".
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
  return {
    fixturesPath: get('--fixtures', 'scripts/winFixtures.json'),
    name: get('--name', null),
    maxDepth: parseInt(get('--maxDepth', '7'), 10),
    out: get('--out', null),
  };
}

const opts = parseArgs();
if (!opts.name) {
  console.error('usage: node scripts/generatePerturbations.js --fixtures <json> --name <fixtureName>');
  process.exit(1);
}
const fixtures = JSON.parse(fs.readFileSync(opts.fixturesPath, 'utf8'));
const seed = fixtures.find(f => f.name === opts.name);
if (!seed) {
  console.error(`fixture "${opts.name}" not found in ${opts.fixturesPath}`);
  process.exit(1);
}

const defColor = seed.rootColor === 'white' ? 'black' : 'white';
const cells = [];
for (let r = 1; r <= 8; r++) {
  for (let f = 0; f < 8; f++) cells.push(String.fromCharCode(97 + f) + r);
}
const defenders = cells.filter(c => seed.board[c] && seed.board[c].color === defColor);
const empties = cells.filter(c => !seed.board[c]);
console.log(`seed ${seed.name}: defending side ${defColor}, pieces at ${defenders.join(', ')}, ${empties.length} empty squares`);

const variants = [{
  ...seed,
  name: 'PERT_control',
  desc: `Unperturbed seed ${seed.name} — must re-prove as a sanity control.`,
  maxDepth: opts.maxDepth,
}];

for (const from of defenders) {
  const piece = seed.board[from];
  const label = piece.hasBall ? `BALL@${from}` : from;
  for (const to of empties) {
    const board = {};
    for (const c of cells) board[c] = seed.board[c] ? { ...seed.board[c] } : null;
    board[to] = { ...board[from], position: to };
    board[from] = null;
    variants.push({
      name: `PERT_${label}_to_${to}`,
      desc: `${seed.name} with ${defColor} ${piece.hasBall ? 'ball carrier' : 'piece'} ${from} moved to ${to}.`,
      board,
      sideToMove: seed.sideToMove,
      rootColor: seed.rootColor,
      maxDepth: opts.maxDepth,
      seedName: seed.name,
      perturbedFrom: from,
      perturbedTo: to,
      movedBallCarrier: !!piece.hasBall,
    });
  }
}

const outPath = path.resolve(opts.out || `data/selfplay/perturb_${seed.name}.json`);
fs.writeFileSync(outPath, JSON.stringify(variants, null, 2));
console.log(`wrote ${variants.length} fixtures (1 control + ${variants.length - 1} variants) to ${outPath}`);
