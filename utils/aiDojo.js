/**
 * AI Dojo — pit different difficulty levels against each other
 * Run: node utils/aiDojo.js [section]
 *
 * Sections: `tiers`, `topdogs`, `triangle`, `ablation` (see below). Omit section to run all default blocks.
 *
 * Ablation / evidence workflow (Phase B prep):
 * - `node utils/aiDojo.js triangle` — B-Rabbit vs Tortuga vs Legacy (2 games per pairing).
 * - `node utils/aiDojo.js topdogs` — Hard vs each impossible variant.
 * - `node utils/aiDojo.js ablation` — Hard vs lean / Tortuga / Legacy in one short pass (same as topdogs slice).
 * - Per-feature cuts: run `playGameWithWeights(whiteW, blackW)` from this module with weight objects
 *   cloned from `DEFAULT_IMPOSSIBLE_WEIGHTS` (`utils/aiImpossibleEval.js`) and single keys zeroed;
 *   `aiTuner.js` leaves zero weights frozen when perturbing.
 */

const { initializeBoardStatus } = require('./gameInitialization');
const { makeAIMove } = require('./aiLogic');

const MAX_TURNS = 100; // prevent infinite games

function playGame(whiteDifficulty, blackDifficulty) {
  let game = {
    aiColor: 'white',
    currentBoardStatus: initializeBoardStatus(),
    currentPlayerTurn: 'white',
    turnNumber: 0,
    moveHistory: [],
    whitePlayerName: `White(${whiteDifficulty})`,
    blackPlayerName: `Black(${blackDifficulty})`,
    status: 'active',
  };

  while (game.status !== 'completed' && game.turnNumber < MAX_TURNS) {
    const isWhiteTurn = game.currentPlayerTurn === 'white';
    const difficulty = isWhiteTurn ? whiteDifficulty : blackDifficulty;

    // Set aiColor to whoever's turn it is
    game.aiColor = game.currentPlayerTurn;
    game = makeAIMove(game, difficulty);
  }

  if (game.status === 'completed') {
    const winnerDifficulty = game.winner === game.whitePlayerName ? whiteDifficulty : blackDifficulty;
    const winnerColor = game.winner === game.whitePlayerName ? 'white' : 'black';
    return { winner: winnerDifficulty, winnerColor, turns: game.turnNumber };
  }

  return { winner: 'draw', winnerColor: null, turns: game.turnNumber };
}

/**
 * Play a game with custom weight objects injected into the impossible eval.
 * Used by the Phase B tuner to test weight variants without registering
 * difficulty configs.
 *
 * @param {Object} whiteWeights - Weight object for white's eval
 * @param {Object} blackWeights - Weight object for black's eval
 * @param {Object} [config] - Search config overrides
 * @returns {{ winner: 'white'|'black'|'draw', turns: number }}
 */
function playGameWithWeights(whiteWeights, blackWeights, config = {}) {
  const difficulty = 'impossible';  // base config (depth, pvs, lmr, etc.)
  let game = {
    aiColor: 'white',
    currentBoardStatus: initializeBoardStatus(),
    currentPlayerTurn: 'white',
    turnNumber: 0,
    moveHistory: [],
    whitePlayerName: 'white',
    blackPlayerName: 'black',
    status: 'active',
  };

  while (game.status !== 'completed' && game.turnNumber < MAX_TURNS) {
    const isWhite = game.currentPlayerTurn === 'white';
    const weights = isWhite ? whiteWeights : blackWeights;
    game.aiColor = game.currentPlayerTurn;
    game = makeAIMove(game, config.difficulty || difficulty, { weights });
  }

  if (game.status === 'completed') {
    const winnerColor = game.winner === game.whitePlayerName ? 'white' : 'black';
    return { winner: winnerColor, turns: game.turnNumber };
  }
  return { winner: 'draw', turns: game.turnNumber };
}

function runMatchup(diff1, diff2, numGames = 10) {
  const results = { [diff1]: 0, [diff2]: 0, draw: 0, totalTurns: 0 };

  for (let i = 0; i < numGames; i++) {
    // Alternate who plays white
    const whiteD = i % 2 === 0 ? diff1 : diff2;
    const blackD = i % 2 === 0 ? diff2 : diff1;

    const start = performance.now();
    const result = playGame(whiteD, blackD);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    results[result.winner]++;
    results.totalTurns += result.turns;

    const label = result.winner === 'draw' ? 'DRAW' : `${result.winner} wins`;
    console.log(`  Game ${i + 1}: ${whiteD}(W) vs ${blackD}(B) → ${label} in ${result.turns} turns (${elapsed}s)`);
  }

  const avgTurns = (results.totalTurns / numGames).toFixed(1);
  console.log(`\n  Result: ${diff1} ${results[diff1]}-${results[diff2]} ${diff2} (${results.draw} draws, avg ${avgTurns} turns)\n`);
  return results;
}

// Export for use by aiTuner.js
module.exports = { playGame, playGameWithWeights, runMatchup };

// --- CLI mode (only runs when executed directly) ---
if (require.main === module) {

console.log('=== AI DOJO ===\n');

// Allow filtering to a specific section via CLI arg, e.g.:
//   node utils/aiDojo.js topdogs
//   node utils/aiDojo.js ablation
const section = process.argv[2];

if (!section || section === 'tiers') {
  console.log('--- Easy vs Medium ---');
  runMatchup('easy', 'medium', 10);

  console.log('--- Medium vs Hard ---');
  runMatchup('medium', 'hard', 10);

  console.log('--- Easy vs Hard ---');
  runMatchup('easy', 'hard', 10);
}

if (!section || section === 'topdogs') {
  // All deterministic (topN: 1). 2 games (alternating colors) = full info set.
  console.log('--- Hard vs B-Rabbit (lean) ---');
  runMatchup('hard', 'impossible', 2);

  console.log('--- Hard vs Tortuga (full) ---');
  runMatchup('hard', 'impossible_tortuga', 2);

  console.log('--- Hard vs Legacy ---');
  runMatchup('hard', 'impossible_legacy', 2);
}

if (!section || section === 'triangle') {
  // Round-robin between the three impossible variants.
  console.log('--- B-Rabbit vs Tortuga ---');
  runMatchup('impossible', 'impossible_tortuga', 2);

  console.log('--- B-Rabbit vs Legacy ---');
  runMatchup('impossible', 'impossible_legacy', 2);

  console.log('--- Tortuga vs Legacy ---');
  runMatchup('impossible_tortuga', 'impossible_legacy', 2);
}

if (section === 'ablation') {
  console.log('=== ABLATION PRESET (Hard vs impossible variants, 2 games each) ===\n');
  console.log('--- Hard vs B-Rabbit (lean) ---');
  runMatchup('hard', 'impossible', 2);
  console.log('--- Hard vs Tortuga (full) ---');
  runMatchup('hard', 'impossible_tortuga', 2);
  console.log('--- Hard vs Legacy ---');
  runMatchup('hard', 'impossible_legacy', 2);
}

} // end CLI mode
