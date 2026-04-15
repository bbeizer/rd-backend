/**
 * AI Dojo — pit different difficulty levels against each other
 * Run: node utils/aiDojo.js
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

console.log('=== AI DOJO ===\n');

console.log('--- Easy vs Medium ---');
runMatchup('easy', 'medium', 10);

console.log('--- Medium vs Hard ---');
runMatchup('medium', 'hard', 10);

console.log('--- Easy vs Hard ---');
runMatchup('easy', 'hard', 10);
