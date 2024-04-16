const Game = require('../models/Game');
const { initializeBoardStatus } = require('../utils/gameInitialization');

exports.createGame = async (req, res) => {
    try {
        const newGame = new Game(initializeBoardStatus());
        await newGame.save();
        res.status(201).json(newGame);
    } catch (error) {
        res.status(500).json({ message: 'Error creating the game', error: error.toString() });
    }
};

exports.getGameById = async (req, res) => {
    try {
      const game = await Game.findById(req.params.id);
      if (!game) {
        return res.status(404).json({ message: 'Game not found' });
      }
      res.json(game);
    } catch (error) {
      res.status(500).json({ message: 'Error fetching game', error: error.message });
    }
  };

exports.updateGameState = async (req, res) => {
    //logic
};

exports.getGameState = async (req, res) => {
  // Logic to retrieve and send the game state to the client
};

exports.makeMove = async (req, res) => {
  // Logic to update the game state with a new move
};