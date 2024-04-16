const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  // Assuming id is automatically added by MongoDB as _id
  status: {
    type: String,
    enum: ['playing', 'not started', 'completed'],
    default: 'not started'
  },
  players: [{
    id: { type: String, required: true }, // or mongoose.Schema.Types.ObjectId if you're referencing user IDs
    color: { type: String, enum: ['black', 'white'], required: true }
  }],
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
    }, { _id: false }), // _id: false since we don't need separate ids for nested paths
    required: true
  }
}, { timestamps: true }); // Adds createdAt and updatedAt timestamps

const Game = mongoose.model('Game', gameSchema);

module.exports = Game;
