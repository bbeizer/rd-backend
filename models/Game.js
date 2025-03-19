const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['playing', 'not started', 'completed'],
    default: 'not started'
  },

  gameType: { type: String, required: true, enum: ['single', 'multiplayer'], default: 'multiplayer' },

  currentBoardStatus: {
    type: Map,
    of: new mongoose.Schema({
      color: String,
      hasBall: Boolean,
      position: String
    }, { _id: false }), // 🔹 Disables Mongoose from adding `_id` to each piece
    default: {
      a1: null, b1: null, 
      c1: { color: "white", hasBall: false, position: "c1" },
      d1: { color: "white", hasBall: true, position: "d1" },
      e1: { color: "white", hasBall: false, position: "e1" },
      f1: { color: "white", hasBall: false, position: "f1" },
      g1: null, h1: null,
  
      a8: null, b8: null, 
      c8: { color: "black", hasBall: false, position: "c8" },
      d8: { color: "black", hasBall: false, position: "d8" },
      e8: { color: "black", hasBall: true, position: "e8" },
      f8: { color: "black", hasBall: false, position: "f8" },
      g8: null, h8: null,
  
      a7: null, b7: null, c7: null, d7: null, e7: null, f7: null, g7: null, h7: null,
      a6: null, b6: null, c6: null, d6: null, e6: null, f6: null, g6: null, h6: null,
      a5: null, b5: null, c5: null, d5: null, e5: null, f5: null, g5: null, h5: null,
      a4: null, b4: null, c4: null, d4: null, e4: null, f4: null, g4: null, h4: null,
      a3: null, b3: null, c3: null, d3: null, e3: null, f3: null, g3: null, h3: null,
      a2: null, b2: null, c2: null, d2: null, e2: null, f2: null, g2: null, h2: null,
    }
  },

  possibleMoves: { type: Array, default: [] },
  possiblePasses: { type: Array, default: [] },

  winner: { type: String, default: null },

  activePiece: {
    position: { type: String, default: null },
    color: { type: String, enum: ['black', 'white'] },
    hasBall: { type: Boolean, default: false }
  },

  movedPiece: {
    position: 
    { type: String
    }
  },

  hasMoved: { type: Boolean, default: false },
  originalSquare: { type: String, default: null },

  whitePlayerId: { type: String, ref: 'User' },
  blackPlayerId: { type: String, ref: 'User' },
  whitePlayerName: { type: String },  
  blackPlayerName: { type: String },
  aiColor: { type: String, enum: ["white", "black", null], default: null },  

  turnNumber: { type: Number, default: 0 },

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
