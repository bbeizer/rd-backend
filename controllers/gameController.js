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

exports.updateGame = async (gameId, gameData) => {
  try {
    const response = await fetch(`${baseUrl}/games/${gameId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        // Include other headers as needed, e.g., authorization tokens
      },
      body: JSON.stringify(gameData),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Could not update the game:', error);
    throw error;
  }
};

exports.makeMove = async (req, res) => {
  // Logic to update the game state with a new move
};

exports.deleteAll = async(req, res) =>{
  const game = await Game.deleteMany({})
    return res.status(202).json({message: 'success'})
};