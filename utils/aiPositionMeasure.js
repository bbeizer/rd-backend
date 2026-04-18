/**
 * Measurement script — runs N self-play games at a chosen difficulty and reports
 * how often the root search score is ±INFINITY (a proven win or loss).
 *
 * Purpose: answer "is a persisted ground-truth TT worth building?" before we wire
 * it into minimax. If the root-proven rate is very low, the cache grows slowly and
 * the ROI is small; phase-B tuning may be the better next investment.
 *
 * Usage:
 *   node utils/aiPositionMeasure.js                        # 10 games at 'hard'
 *   node utils/aiPositionMeasure.js --games 20             # 20 games
 *   node utils/aiPositionMeasure.js --difficulty hard      # 'easy'|'medium'|'hard'|'impossible'
 *   node utils/aiPositionMeasure.js --games 5 --difficulty hard
 */

const { makeAIMove, AI_CONFIG, DIFFICULTY_CONFIGS } = require('./aiLogic');
const { initializeBoardStatus } = require('./gameInitialization');

const INF_THRESHOLD = AI_CONFIG.INFINITY - 100; // absorb mate-distance adjustment

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { games: 10, difficulty: 'hard', turnCap: 120 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--games') out.games = parseInt(args[++i], 10);
    else if (args[i] === '--difficulty') out.difficulty = args[++i];
    else if (args[i] === '--turn-cap') out.turnCap = parseInt(args[++i], 10);
  }
  if (!DIFFICULTY_CONFIGS[out.difficulty]) {
    console.error(`Unknown difficulty: ${out.difficulty}`);
    console.error(`Available: ${Object.keys(DIFFICULTY_CONFIGS).join(', ')}`);
    process.exit(1);
  }
  return out;
}

function playSelfPlayGame(difficulty, turnCap) {
  let game = {
    aiColor: 'white',
    currentBoardStatus: initializeBoardStatus(),
    currentPlayerTurn: 'white',
    turnNumber: 0,
    moveHistory: [],
    whitePlayerName: 'W',
    blackPlayerName: 'B',
    status: 'active',
  };

  const scores = []; // root search scores per move
  const startMs = Date.now();

  while (game.status !== 'completed' && game.turnNumber < turnCap) {
    game.aiColor = game.currentPlayerTurn;
    game = makeAIMove(game, difficulty);
    scores.push(game._aiMeta ? game._aiMeta.rootScore : 0);
  }

  return {
    scores,
    winner: game.winner || null,
    turns: game.turnNumber,
    durationMs: Date.now() - startMs,
  };
}

function classify(score) {
  if (score >= INF_THRESHOLD) return 'PROVEN_WIN';
  if (score <= -INF_THRESHOLD) return 'PROVEN_LOSS';
  return 'HEURISTIC';
}

function summarize(games) {
  const totals = { PROVEN_WIN: 0, PROVEN_LOSS: 0, HEURISTIC: 0 };
  let totalMoves = 0;
  let firstProvenTurns = []; // per game: turn index of first ±INF score (win or loss)

  for (const g of games) {
    let firstProven = null;
    for (let i = 0; i < g.scores.length; i++) {
      const c = classify(g.scores[i]);
      totals[c]++;
      totalMoves++;
      if (c !== 'HEURISTIC' && firstProven === null) firstProven = i;
    }
    firstProvenTurns.push(firstProven);
  }

  const provenCount = totals.PROVEN_WIN + totals.PROVEN_LOSS;
  const provenRate = totalMoves > 0 ? provenCount / totalMoves : 0;

  return { totals, totalMoves, provenRate, firstProvenTurns };
}

function main() {
  const opts = parseArgs();
  console.log(`=== aiPositionMeasure ===`);
  console.log(`difficulty: ${opts.difficulty}  games: ${opts.games}  turn cap: ${opts.turnCap}\n`);

  const games = [];
  for (let i = 0; i < opts.games; i++) {
    const start = Date.now();
    const g = playSelfPlayGame(opts.difficulty, opts.turnCap);
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    const winner = g.winner || 'draw/cap';
    const provenInGame = g.scores.filter(s => Math.abs(s) >= INF_THRESHOLD).length;
    console.log(`  game ${i + 1}/${opts.games}: ${g.turns} turns, winner=${winner}, proven=${provenInGame}/${g.scores.length} (${secs}s)`);
    games.push(g);
  }

  const sum = summarize(games);
  console.log(`\n--- Summary ---`);
  console.log(`Total moves:         ${sum.totalMoves}`);
  console.log(`Heuristic scores:    ${sum.totals.HEURISTIC}`);
  console.log(`Proven wins (+INF):  ${sum.totals.PROVEN_WIN}`);
  console.log(`Proven losses (-INF):${sum.totals.PROVEN_LOSS}`);
  console.log(`Proven rate:         ${(sum.provenRate * 100).toFixed(1)}%`);

  const firstProvenDelays = sum.firstProvenTurns
    .filter(t => t !== null)
    .map(t => t);
  if (firstProvenDelays.length > 0) {
    const avg = firstProvenDelays.reduce((a, b) => a + b, 0) / firstProvenDelays.length;
    console.log(`First proven score:  turn ${Math.min(...firstProvenDelays)} (min), turn ${Math.max(...firstProvenDelays)} (max), turn ${avg.toFixed(1)} (avg)`);
  } else {
    console.log(`First proven score:  never (depth may be too shallow for this difficulty)`);
  }

  console.log(`\nInterpretation:`);
  console.log(`  >10% proven rate → persistent TT likely pays off (many cacheable positions).`);
  console.log(`  1-10%            → worth building, moderate ROI.`);
  console.log(`  <1%              → probably skip; prioritize eval tuning instead.`);
}

if (require.main === module) main();

module.exports = { playSelfPlayGame, classify, summarize, INF_THRESHOLD };
