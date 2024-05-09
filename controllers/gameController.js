const Game = require('../models/Game');
const queueManager = require('../utils/queueManager');
const { initializeBoardStatus } = require('../utils/gameInitialization');


exports.startOrJoinGame = async (req, res) => {
    console.log("controller hit")
    try {
        const existingGame = await findOrCreateGame();
        if (isGameFull(existingGame)) {
            return res.status(400).json({ message: 'Game is already full.' });
        }

        const updatedGame = await addPlayerToGame(existingGame, req.body.playerId);
        if (isGameFull(updatedGame)){
            updatedGame.status = "playing";
            await updatedGame.save()
        }
        res.status(200).json({ game: updatedGame, message: 'Player added to existing game.' });
    } catch (error) {
        console.error("Error processing startOrJoinGame:", error);
        res.status(500).json({ error: 'Error processing your request', details: error.message });
    }
};

async function findOrCreateGame() {
    let game = await Game.findOne({ status: 'not started' });
    if (!game) {
        game = new Game(initializeBoardStatus());
        if (Math.random() < 0.5) {
            game.whitePlayerId = null; // indicate white is open
        } else {
            game.blackPlayerId = null; // indicate black is open
        }
        await game.save();
    }
    return game;
}

function isGameFull(game) {
    return game.whitePlayerId && game.blackPlayerId;
}

async function addPlayerToGame(game, playerId) {
    if (!game.whitePlayerId) {
        game.whitePlayerId = playerId;
    } else if (!game.blackPlayerId) {
        game.blackPlayerId = playerId;
    }
    await game.save();
    return game;
}

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