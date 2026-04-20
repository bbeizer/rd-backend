/**
 * AI Tuner — Phase B self-play weight optimizer
 *
 * Evolves the impossible-mode eval weights via tournament-style selection.
 * Starting from B-Rabbit's hand-tuned weights, generates random perturbations,
 * plays them against each other, and keeps the winners.
 *
 * Usage:
 *   node utils/aiTuner.js                   # full run (default config)
 *   node utils/aiTuner.js --quick           # quick sanity-check run
 *   node utils/aiTuner.js --validate        # validate tuner-results.json vs hard/legacy
 *   node utils/aiTuner.js --generations 30  # custom generation count
 *   node utils/aiTuner.js --population 6    # custom population size
 */

const fs = require('fs');
const path = require('path');
const { playGameWithWeights } = require('./aiDojo');
const { DEFAULT_IMPOSSIBLE_WEIGHTS, DIFFICULTY_CONFIGS, makeAIMove } = require('./aiLogic');
const { initializeBoardStatus } = require('./gameInitialization');

// ============================================
// CONFIGURATION
// ============================================

const DEFAULTS = {
  populationSize: 8,
  survivors: 2,
  gamesPerPair: 4,       // 2 as white, 2 as black
  generations: 20,
  searchDepth: 5,
  timeLimitMs: 2000,
  topN: 2,               // variance via random selection among top 2
  baseSigma: 0.15,
  sigmaDecay: 0.85,
  minSigma: 0.03,
};

const QUICK_OVERRIDES = {
  populationSize: 4,
  survivors: 2,
  gamesPerPair: 2,
  generations: 5,
};

const CHECKPOINT_FILE = path.join(__dirname, '..', 'tuner-checkpoint.json');
const RESULTS_FILE = path.join(__dirname, '..', 'tuner-results.json');

// ============================================
// WEIGHT PERTURBATION
// ============================================

/** Gaussian random (Box-Muller transform) */
function gaussianRandom() {
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/**
 * Create a new weight object by perturbing each non-zero weight.
 * Percentage-based: newWeight = weight * (1 + N(0, sigma)).
 * Preserves sign and clamps to [1, base*3] for positive, [base*3, -1] for negative.
 * Zero weights (B-Rabbit cuts) stay frozen.
 */
function perturbWeights(baseWeights, sigma) {
  const perturbed = {};
  for (const [key, value] of Object.entries(baseWeights)) {
    if (value === 0) {
      perturbed[key] = 0;
      continue;
    }
    const noise = gaussianRandom() * sigma;
    let newVal = value * (1 + noise);
    if (value > 0) {
      newVal = Math.max(1, Math.min(Math.abs(value) * 3, newVal));
    } else {
      newVal = Math.min(-1, Math.max(value * 3, newVal));
    }
    perturbed[key] = Math.round(newVal);
  }
  return perturbed;
}

// ============================================
// TOURNAMENT
// ============================================

/**
 * Play a matchup between two weight configs. Returns number of wins for each.
 * Alternates colors across games for fairness.
 */
function playMatchup(weightsA, weightsB, gamesPerPair, searchConfig) {
  let winsA = 0, winsB = 0, draws = 0;

  for (let i = 0; i < gamesPerPair; i++) {
    const aIsWhite = i % 2 === 0;
    const whiteW = aIsWhite ? weightsA : weightsB;
    const blackW = aIsWhite ? weightsB : weightsA;

    const result = playGameWithWeights(whiteW, blackW, searchConfig);

    if (result.winner === 'draw') {
      draws++;
    } else if ((result.winner === 'white' && aIsWhite) || (result.winner === 'black' && !aIsWhite)) {
      winsA++;
    } else {
      winsB++;
    }
  }

  return { winsA, winsB, draws };
}

/**
 * Round-robin tournament. Returns array of { index, wins, draws } sorted by wins desc.
 */
function runTournament(population, gamesPerPair, searchConfig, verbose = true) {
  const n = population.length;
  const scores = population.map((_, i) => ({ index: i, wins: 0, draws: 0 }));
  const totalGames = (n * (n - 1) / 2) * gamesPerPair;
  let gameNum = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const start = performance.now();
      const result = playMatchup(population[i].weights, population[j].weights, gamesPerPair, searchConfig);
      const elapsed = ((performance.now() - start) / 1000).toFixed(0);

      scores[i].wins += result.winsA;
      scores[j].wins += result.winsB;
      scores[i].draws += result.draws;
      scores[j].draws += result.draws;
      gameNum += gamesPerPair;

      if (verbose) {
        console.log(`  [${gameNum}/${totalGames}] ${population[i].id} vs ${population[j].id}: ${result.winsA}-${result.winsB} (${result.draws}D) (${elapsed}s)`);
      }
    }
  }

  scores.sort((a, b) => b.wins - a.wins || b.draws - a.draws);
  return scores;
}

// ============================================
// SELECTION & BREEDING
// ============================================

function selectAndBreed(population, scores, survivorCount, sigma) {
  const survivors = scores.slice(0, survivorCount).map(s => population[s.index]);
  const offspringCount = population.length - survivorCount;
  const offspring = [];

  for (let i = 0; i < offspringCount; i++) {
    const parent = survivors[i % survivorCount];
    offspring.push({
      id: `offspring-${i}`,
      weights: perturbWeights(parent.weights, sigma),
      parent: parent.id,
    });
  }

  return [...survivors, ...offspring];
}

// ============================================
// CHECKPOINT I/O
// ============================================

function saveCheckpoint(state) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2));
}

function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  }
  return null;
}

function saveResults(weights, history) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ bestWeights: weights, history }, null, 2));
}

// ============================================
// WEIGHT DIFF REPORTING
// ============================================

function reportWeightDiffs(baseWeights, currentWeights) {
  const diffs = [];
  for (const [key, baseVal] of Object.entries(baseWeights)) {
    if (baseVal === 0) continue;
    const curVal = currentWeights[key] || 0;
    const pctChange = ((curVal - baseVal) / Math.abs(baseVal) * 100).toFixed(0);
    if (Math.abs(curVal - baseVal) > 0) {
      diffs.push({ key, base: baseVal, current: curVal, pct: pctChange });
    }
  }
  diffs.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return diffs.slice(0, 8);
}

// ============================================
// VALIDATION
// ============================================

function runValidation() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.log('No tuner-results.json found. Run the tuner first.');
    process.exit(1);
  }
  const { bestWeights } = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
  console.log('=== VALIDATION: tuned weights at full depth ===\n');

  // Full depth, full time budget, deterministic
  const fullConfig = { difficulty: 'impossible' };

  console.log('--- Tuned vs B-Rabbit (current production) ---');
  for (let i = 0; i < 2; i++) {
    const tunedIsWhite = i % 2 === 0;
    const wW = tunedIsWhite ? bestWeights : DEFAULT_IMPOSSIBLE_WEIGHTS;
    const bW = tunedIsWhite ? DEFAULT_IMPOSSIBLE_WEIGHTS : bestWeights;
    const start = performance.now();
    const result = playGameWithWeights(wW, bW, fullConfig);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    const tunedColor = tunedIsWhite ? 'white' : 'black';
    const label = result.winner === 'draw' ? 'DRAW' : result.winner === tunedColor ? 'TUNED wins' : 'B-RABBIT wins';
    console.log(`  Game ${i + 1}: Tuned(${tunedColor[0].toUpperCase()}) → ${label} in ${result.turns} turns (${elapsed}s)`);
  }

  console.log('\n--- Tuned vs Hard ---');
  for (let i = 0; i < 2; i++) {
    const tunedIsWhite = i % 2 === 0;
    let game = {
      currentBoardStatus: initializeBoardStatus(),
      currentPlayerTurn: 'white',
      turnNumber: 0,
      moveHistory: [],
      whitePlayerName: tunedIsWhite ? 'tuned' : 'hard',
      blackPlayerName: tunedIsWhite ? 'hard' : 'tuned',
      status: 'active',
    };
    const start = performance.now();
    while (game.status !== 'completed' && game.turnNumber < 100) {
      const isWhite = game.currentPlayerTurn === 'white';
      game.aiColor = game.currentPlayerTurn;
      if (isWhite === tunedIsWhite) {
        game = makeAIMove(game, 'impossible', { weights: bestWeights });
      } else {
        game = makeAIMove(game, 'hard');
      }
    }
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    const tunedName = tunedIsWhite ? game.whitePlayerName : game.blackPlayerName;
    const label = game.status !== 'completed' ? 'DRAW' : game.winner === tunedName ? 'TUNED wins' : 'HARD wins';
    console.log(`  Game ${i + 1}: Tuned(${tunedIsWhite ? 'W' : 'B'}) → ${label} in ${game.turnNumber} turns (${elapsed}s)`);
  }
}

// ============================================
// MAIN
// ============================================

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--validate')) {
    runValidation();
    return;
  }

  const isQuick = args.includes('--quick');
  const config = { ...DEFAULTS, ...(isQuick ? QUICK_OVERRIDES : {}) };

  // Parse CLI overrides
  const genIdx = args.indexOf('--generations');
  if (genIdx !== -1) config.generations = parseInt(args[genIdx + 1], 10);
  const popIdx = args.indexOf('--population');
  if (popIdx !== -1) config.populationSize = parseInt(args[popIdx + 1], 10);

  const searchConfig = { difficulty: 'impossible' };
  // Override the impossible config for training speed
  const origConfig = { ...DIFFICULTY_CONFIGS.impossible };
  DIFFICULTY_CONFIGS.impossible = {
    ...origConfig,
    depth: config.searchDepth,
    timeLimitMs: config.timeLimitMs,
    topN: config.topN,
  };

  console.log('=== AI TUNER — Phase B ===');
  console.log(`Config: pop=${config.populationSize}, survivors=${config.survivors}, games/pair=${config.gamesPerPair}, gens=${config.generations}`);
  console.log(`Search: depth=${config.searchDepth}, time=${config.timeLimitMs}ms, topN=${config.topN}`);
  console.log(`Sigma: ${config.baseSigma} → ${config.minSigma} (decay ${config.sigmaDecay})\n`);

  // Resume or initialize
  let checkpoint = loadCheckpoint();
  let startGen = 0;
  let population;
  const history = [];
  const baseWeights = { ...DEFAULT_IMPOSSIBLE_WEIGHTS };

  if (checkpoint) {
    console.log(`Resuming from generation ${checkpoint.generation + 1}\n`);
    startGen = checkpoint.generation + 1;
    population = checkpoint.population;
    history.push(...(checkpoint.history || []));
  } else {
    // Initialize: seed population with B-Rabbit + perturbed variants
    population = [{ id: 'brabbit', weights: { ...baseWeights }, parent: null }];
    const sigma = config.baseSigma;
    for (let i = 1; i < config.populationSize; i++) {
      population.push({
        id: `init-${i}`,
        weights: perturbWeights(baseWeights, sigma),
        parent: 'brabbit',
      });
    }
  }

  for (let gen = startGen; gen < config.generations; gen++) {
    const sigma = Math.max(config.minSigma, config.baseSigma * Math.pow(config.sigmaDecay, gen));
    console.log(`\n--- Generation ${gen} (sigma=${sigma.toFixed(3)}) ---`);

    // Assign IDs for this generation
    population.forEach((ind, i) => { ind.id = `gen${gen}-${i}`; });

    // Run tournament
    const genStart = performance.now();
    const scores = runTournament(population, config.gamesPerPair, searchConfig);
    const genElapsed = ((performance.now() - genStart) / 1000).toFixed(0);

    // Leaderboard
    console.log(`\n  Leaderboard (${genElapsed}s):`);
    for (const s of scores) {
      const ind = population[s.index];
      const marker = s === scores[0] ? ' ★' : '';
      console.log(`    ${ind.id}: ${s.wins}W ${s.draws}D${marker}`);
    }

    // Track best
    const bestInd = population[scores[0].index];
    const diffs = reportWeightDiffs(baseWeights, bestInd.weights);
    if (diffs.length > 0) {
      console.log(`\n  Top weight changes vs B-Rabbit:`);
      for (const d of diffs) {
        console.log(`    ${d.key}: ${d.base} → ${d.current} (${d.pct > 0 ? '+' : ''}${d.pct}%)`);
      }
    }

    history.push({
      gen,
      sigma: parseFloat(sigma.toFixed(3)),
      bestId: bestInd.id,
      bestScore: scores[0].wins,
      bestWeights: { ...bestInd.weights },
    });

    // Save checkpoint
    saveCheckpoint({ generation: gen, population, history, config });

    // Select survivors and breed next generation
    population = selectAndBreed(population, scores, config.survivors, sigma);

    const remaining = config.generations - gen - 1;
    if (remaining > 0) {
      const eta = (remaining * parseInt(genElapsed, 10) / 60).toFixed(0);
      console.log(`\n  ETA: ~${eta} min (${remaining} generations remaining)`);
    }
  }

  // Save final results
  const finalBest = history[history.length - 1].bestWeights;
  saveResults(finalBest, history);
  console.log(`\n=== TUNING COMPLETE ===`);
  console.log(`Best weights saved to ${RESULTS_FILE}`);
  console.log(`Run 'node utils/aiTuner.js --validate' to test at full depth.\n`);

  // Restore original config
  DIFFICULTY_CONFIGS.impossible = origConfig;
}

main();
