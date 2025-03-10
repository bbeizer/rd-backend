const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['playing', 'not started', 'completed'],
    default: 'not started'
  },

  gameType: { type: String, required: true, enum: ['single', 'multiplayer'], default: 'multiplayer' },
  gameData: { type: Object, currentBoardStatus: {
    a1: null, a2: null, a3: null, a4: null, a5: null, a6: null, a7: null, a8: null,
    b1: null, b2: null, b3: { color: "white", hasBall: false, position: "b3" }, b4: null, b5: null, b6: null, b7: null, b8: null,
    c1: null, c2: null, c3: null, c4: null, c5: null, c6: null, c7: null, c8: { color: "black", hasBall: false, position: "c8" },
    d1: { color: "white", hasBall: true, position: "d1" }, d2: null, d3: null, d4: null, d5: null, d6: null, d7: null, d8: { color: "black", hasBall: false, position: "d8" },
    e1: { color: "white", hasBall: false, position: "e1" }, e2: null, e3: null, e4: null, e5: null, e6: null, e7: null, e8: { color: "black", hasBall: true, position: "e8" },
    f1: { color: "white", hasBall: false, position: "f1" }, f2: null, f3: null, f4: null, f5: null, f6: null, f7: null, f8: { color: "black", hasBall: false, position: "f8" },
    g1: null, g2: null, g3: null, g4: null, g5: null, g6: null, g7: null, g8: null,
    h1: null, h2: null, h3: null, h4: null, h5: null, h6: null, h7: null, h8: null,
  }, },

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
}, { timestamps: true });

gameSchema.index({ whitePlayerId: 1, blackPlayerId: 1 });

const Game = mongoose.model('Game', gameSchema);

module.exports = Game;
