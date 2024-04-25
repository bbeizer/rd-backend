const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['playing', 'not started', 'completed'],
    default: 'not started'
  },
  whitePlayerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  blackPlayerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  turnNumber: {
    type: Number,
    default: 0
  },
  turnPlayer: {
    type: String,
    enum: ['black', 'white'],
    required: true
  },
  moveHistory: [{
    turnNumber: Number,
    black: String,
    white: String
  }],
  currentBoardStatus: {
    type: Map,
    of: new mongoose.Schema({
      color: String,
      hasBall: Boolean
    }, { _id: false })
  }
}, { timestamps: true });

gameSchema.index({ whitePlayerId: 1, blackPlayerId: 1 });

const Game = mongoose.model('Game', gameSchema);

module.exports = Game;
