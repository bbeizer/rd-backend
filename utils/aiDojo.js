/**
 * AI Dojo — pit different players against each other
 * Run: node utils/aiDojo.js
 */

const { initializeBoardStatus } = require('./gameInitialization');
const { toPlayer } = require('./aiPlayer');

const MAX_TURNS = 100; // prevent infinite games

/**
 * Play one dojo game between two players.
 *
 * @param {string|Player} whitePlayerArg - Difficulty string or Player object.
 * @param {string|Player} blackPlayerArg - Difficulty string or Player object.
 * @param {object} [opts]
 * @param {(ply: object) => void} [opts.onPly] - Called after each move with a
 *   plain object snapshot (pre-move board, side, chosen moves, search score).
 *   Used by scripts/selfplay.js for training-data capture.
 * @param {object} [opts.aiOpts] - Forwarded to makeAIMove when a string
 *   difficulty is coerced into a Player. Ignored if Player objects are passed
 *   directly (they carry their own opts). Useful for selfplay variance.
 */
function playGame(whitePlayerArg, blackPlayerArg, opts = {}) {
  const aiOpts = opts.aiOpts || {};
  const white = toPlayer(whitePlayerArg, aiOpts);
  const black = toPlayer(blackPlayerArg, aiOpts);

  let game = {
    aiColor: 'white',
    currentBoardStatus: initializeBoardStatus(),
    currentPlayerTurn: 'white',
    turnNumber: 0,
    moveHistory: [],
    whitePlayerName: `White(${white.name})`,
    blackPlayerName: `Black(${black.name})`,
    status: 'active',
  };

  const onPly = typeof opts.onPly === 'function' ? opts.onPly : null;

  while (game.status !== 'completed' && game.turnNumber < MAX_TURNS) {
    const isWhiteTurn = game.currentPlayerTurn === 'white';
    const player = isWhiteTurn ? white : black;
    const sideToMove = game.currentPlayerTurn;
    const preMoveBoard = game.currentBoardStatus;

    game.aiColor = sideToMove;
    game = player.takeTurn(game);

    if (onPly) {
      const last = game.moveHistory[game.moveHistory.length - 1] || {};
      onPly({
        turnNumber: game.turnNumber - 1,
        sideToMove,
        difficulty: player.name,
        preMoveBoard,
        postMoveBoard: game.currentBoardStatus,
        moves: [
          ...(last.pieceMove ? [{ type: 'move', ...last.pieceMove }] : []),
          ...(last.ballPasses || []).map(p => ({ type: 'pass', ...p })),
        ],
        searchScore: game._aiMeta ? game._aiMeta.rootScore : null,
      });
    }
  }

  let result;
  if (game.status === 'completed') {
    const winnerName = game.winner === game.whitePlayerName ? white.name : black.name;
    const winnerColor = game.winner === game.whitePlayerName ? 'white' : 'black';
    result = { winner: winnerName, winnerColor, turns: game.turnNumber };
  } else {
    result = { winner: 'draw', winnerColor: null, turns: game.turnNumber };
  }

  if (onPly) onPly({ terminal: true, ...result });
  return result;
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

module.exports = { playGame, runMatchup };

if (require.main !== module) return;

console.log('=== AI DOJO ===\n');

// Allow filtering to a specific section via CLI arg, e.g.:
//   node utils/aiDojo.js winpoints
//   node utils/aiDojo.js topdogs
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

if (!section || section === 'nn') {
  console.log('--- NN vs B-Rabbit ---');
  runMatchup('impossible_nn', 'impossible', 2);

  console.log('--- NN vs Hard ---');
  runMatchup('impossible_nn', 'hard', 2);
}

if (section === 'nn_ab') {
  // Head-to-head A/B between two NNs. impossible_nn loads mlp_weights.json
  // (canonical/candidate); impossible_nn_b loads AI_NN_CHALLENGER_PATH (default
  // mlp_weights_combo_big.json). Override with env var, e.g.:
  //   AI_NN_CHALLENGER_PATH=mlp_weights_round4_big.json node utils/aiDojo.js nn_ab
  console.log('--- NN (canonical) vs NN_b (challenger) ---');
  const games = parseInt(process.env.AI_DOJO_GAMES || '8', 10);
  runMatchup('impossible_nn', 'impossible_nn_b', games);
}

if (!section || section === 'atomic') {
  console.log('--- Atomic vs B-Rabbit ---');
  runMatchup('impossible_atomic', 'impossible', 2);

  console.log('--- Atomic vs Hard ---');
  runMatchup('impossible_atomic', 'hard', 2);
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
