const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['playing', 'not started', 'completed'],
    default: 'not started'
  },
  whitePlayerId: { type: String, ref: 'User' },
  blackPlayerId: { type: String, ref: 'User' },
  whitePlayerName: String, // Added field to store the name of the white player
  blackPlayerName: String, // Added field to store the name of the black player
  turnNumber: {
    type: Number,
    default: 0
  },
  currentPlayerTurn: {
    type: String,
    enum: ['black', 'white'],
    default: 'white',
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
