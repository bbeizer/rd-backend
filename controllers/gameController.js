const Game = require('../models/Game');
const queueManager = require('../utils/queueManager');
const { initializeBoardStatus } = require('../utils/gameInitialization');


exports.startOrJoinGame = async (req, res) => {
    try {
        const existingGame = await findOrCreateGame();
        if (isGameFull(existingGame)) {
            return res.status(400).json({ message: 'Game is already full.' });
        }

        const { game: updatedGame, playerColor } = await addPlayerToGame(existingGame, req.body.playerId, req.body.playerName);
        if (isGameFull(updatedGame)){
            updatedGame.status = "playing";
            await updatedGame.save();
            queueManager.removeFromQueue(updatedGame.whitePlayerId);
            queueManager.removeFromQueue(updatedGame.blackPlayerId);
        }
        res.status(200).json({ game: updatedGame, playerColor, message: 'Player added to existing game.' });
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

async function addPlayerToGame(game, playerId, playerName) {
    let playerColor = null;
    if (!game.whitePlayerId) {
        game.whitePlayerId = playerId;
        game.whitePlayerName = playerName;  // Make sure playerName is correctly captured and passed here
        playerColor = 'white';
      } else if (!game.blackPlayerId) {
        game.blackPlayerId = playerId;
        game.blackPlayerName = playerName;  // Make sure playerName is correctly captured and passed here
        playerColor = 'black';
      }
      await game.save();  // Saving the changes
    await game.save();
    return { game, playerColor };  // Return both the game object and the player color
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