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


exports.updateGame = async (req, res) => {
  const { id } = req.params; // Get game ID from URL
  const updates = req.body; // Get updates from request body

  try {
      const game = await Game.findByIdAndUpdate(id, updates, { new: true });
      if (!game) {
          return res.status(404).send({ message: 'Game not found' });
      }
      res.json(game);
  } catch (error) {
      res.status(500).json({ message: 'Error updating game state', error: error.toString() });
  }
};

exports.deleteAll = async(req, res) =>{
  const game = await Game.deleteMany({})
    return res.status(202).json({message: 'success'})
};