const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['playing', 'not started', 'completed'],
    default: 'not started'
  },
  winner: {
    type: String,
    default: null
  },
  activePiece: {
    position: {
      type: String,
    },
  movedPiece: {
    position: {
      type: String,
    }
  },
    color: {
      type: String,
      enum: ['black', 'white'],
    },
    hasBall: {
      type: Boolean,
      default: false // Reflects whether the piece currently has the ball
    }
  },
  hasMoved: {
    type: Boolean,
    default: false  // Set the default value to false
  },
  originalSquare: {
    type: String,
    default: null
  },
  whitePlayerId: { type: String, ref: 'User' },
  blackPlayerId: { type: String, ref: 'User' },
  whitePlayerName: { type: String },  // Adding white player name
  blackPlayerName: { type: String },  // Adding black player name
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
      hasBall: Boolean,
      position: String
    }, { _id: false })
  }
}, { timestamps: true });

gameSchema.index({ whitePlayerId: 1, blackPlayerId: 1 });

const Game = mongoose.model('Game', gameSchema);

module.exports = Game;
