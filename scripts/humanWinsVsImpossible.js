require('dotenv').config();
const mongoose = require('mongoose');
const Game = require('../models/Game');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const games = await Game.find({
    status: 'completed',
    aiColor: { $ne: null },
    winner: { $ne: null },
  })
    .select('aiColor winner moveHistory difficulty createdAt whitePlayerName blackPlayerName')
    .lean();

  console.log(`total completed AI games: ${games.length}`);

  // distribution of winner values
  const winnerCounts = {};
  for (const g of games) winnerCounts[g.winner] = (winnerCounts[g.winner] || 0) + 1;
  console.log('\nwinner value distribution:');
  for (const [k, v] of Object.entries(winnerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  const AI_WINNER_LABELS = new Set([
    'AI', 'easy', 'medium', 'hard', 'impossible',
    'Tortuga', 'Legacy', 'B-Rabbit', 'combo_big',
  ]);
  const humanWins = games.filter(g => g.winner && !AI_WINNER_LABELS.has(g.winner));

  console.log(`\nlikely human wins: ${humanWins.length}`);
  if (humanWins.length === 0) {
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- human wins ---');
  const byDiff = {};
  for (const g of humanWins) {
    const moves = g.moveHistory?.length || 0;
    byDiff[g.difficulty] = byDiff[g.difficulty] || [];
    byDiff[g.difficulty].push(moves);
    console.log({
      _id: String(g._id),
      date: g.createdAt?.toISOString().slice(0, 10),
      diff: g.difficulty,
      aiColor: g.aiColor,
      humanColor: g.aiColor === 'white' ? 'black' : 'white',
      winner: g.winner,
      moves,
    });
  }

  console.log('\nstats by difficulty (turns in moveHistory):');
  for (const [d, arr] of Object.entries(byDiff)) {
    arr.sort((a, b) => a - b);
    const min = arr[0], max = arr[arr.length - 1];
    const median = arr[Math.floor(arr.length / 2)];
    const mean = (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
    console.log(`  ${d.padEnd(12)}  n=${arr.length}  min=${min}  median=${median}  mean=${mean}  max=${max}`);
  }

  await mongoose.disconnect();
})();
