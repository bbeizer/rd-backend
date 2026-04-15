/**
 * AI Performance Benchmark
 * Run: node utils/aiBenchmark.js
 */

const { initializeBoardStatus } = require('./gameInitialization');
const { makeAIMove } = require('./aiLogic');

function createMockGame(aiColor = 'white') {
  return {
    aiColor,
    currentBoardStatus: initializeBoardStatus(),
    turnNumber: 0,
    moveHistory: [],
    whitePlayerName: 'AI',
    blackPlayerName: 'Human',
  };
}

function benchmark(label, fn, iterations = 5) {
  // Warmup
  fn();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`${label}: avg=${avg.toFixed(1)}ms  min=${min.toFixed(1)}ms  max=${max.toFixed(1)}ms`);
}

console.log('AI Benchmark - Starting position\n');

benchmark('Easy   (depth 1)', () => makeAIMove(createMockGame(), 'easy'));
benchmark('Medium (depth 3)', () => makeAIMove(createMockGame(), 'medium'));
benchmark('Hard   (depth 4)', () => makeAIMove(createMockGame(), 'hard'));

// Also benchmark a mid-game position (after a few moves)
function createMidGameBoard() {
  const game = createMockGame();
  // Simulate a few moves by moving pieces around
  const board = game.currentBoardStatus;
  // Move white piece from d1 to e3
  board['e3'] = { ...board['d1'], position: 'e3' };
  board['d1'] = null;
  // Move black piece from e8 to d6
  board['d6'] = { ...board['e8'], position: 'd6' };
  board['e8'] = null;
  // Move white piece from f1 to g3
  board['g3'] = { ...board['f1'], position: 'f1' };
  board['f1'] = null;
  return game;
}

console.log('\nAI Benchmark - Mid-game position\n');

benchmark('Easy   (depth 1)', () => makeAIMove(createMidGameBoard(), 'easy'));
benchmark('Medium (depth 3)', () => makeAIMove(createMidGameBoard(), 'medium'));
benchmark('Hard   (depth 4)', () => makeAIMove(createMidGameBoard(), 'hard'));
