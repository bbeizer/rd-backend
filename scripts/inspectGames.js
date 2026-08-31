require('dotenv').config();
const mongoose = require('mongoose');
const Game = require('../models/Game');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const total = await Game.countDocuments({});
  const completed = await Game.countDocuments({ status: 'completed' });
  const sp = await Game.countDocuments({ gameType: 'singleplayer' });
  const withAi = await Game.countDocuments({ aiColor: { $ne: null } });
  const recent = await Game.countDocuments({
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });

  console.log({ total, completed, singleplayer: sp, withAiColor: withAi, last7days: recent });

  const latest = await Game.find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .select('status gameType aiColor difficulty winner createdAt moveHistory')
    .lean();
  console.log('\n--- latest 5 games ---');
  for (const g of latest) {
    console.log({
      _id: String(g._id),
      createdAt: g.createdAt,
      status: g.status,
      gameType: g.gameType,
      aiColor: g.aiColor,
      difficulty: g.difficulty,
      winner: g.winner,
      moves: g.moveHistory?.length || 0,
    });
  }

  await mongoose.disconnect();
})();
