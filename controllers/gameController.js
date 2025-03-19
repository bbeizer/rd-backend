const Game = require('../models/Game');
const queueManager = require('../utils/queueManager');
const { initializeBoardStatus } = require('../utils/gameInitialization');


exports.startOrJoinMultiPlayerGame = async (req, res) => {
  try {
      const existingGame = await findOrCreateGame();
      if (isGameFull(existingGame)) {
          return res.status(400).json({ message: 'Game is already full.' });
      }

      const { game: updatedGame, playerColor } = await addPlayerToGame(
          existingGame, req.body.playerId, req.body.playerName, null, false
      );

      if (isGameFull(updatedGame)) {
          queueManager.removeFromQueue(updatedGame.whitePlayerId);
          queueManager.removeFromQueue(updatedGame.blackPlayerId);
      }

      res.status(200).json({ game: updatedGame, playerColor, message: 'Player added to existing game.' });
  } catch (error) {
      console.error("Error processing startOrJoinGame:", error);
      res.status(500).json({ error: 'Error processing your request', details: error.message });
  }
};


exports.startAndJoinSinglePlayerGame = async (req, res) => {
  try {
      const { playerId, playerName, playerColor } = req.body;
      const newGame = new Game(initializeBoardStatus());
      newGame.gameType = 'single'; // Explicitly set for single player
      newGame.aiColor = playerColor === 'white' ? 'black' : 'white'
      const { game: createdGame } = await addPlayerToGame(
          newGame, playerId, playerName, playerColor, true
      );

      res.status(201).json({ game: createdGame, message: `Game created successfully for player ${playerName}` });
  } catch (error) {
      console.error('Failed to create single-player game:', error);
      res.status(500).json({ error: 'Failed to create single-player game' });
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

async function addPlayerToGame(game, playerId, playerName, preferredColor = null, isSinglePlayer = false) {
  let playerColor = null;

  if (isSinglePlayer) {
      // Assign player their preferred color in single-player mode
      if (preferredColor === 'white') {
          game.whitePlayerId = playerId;
          game.whitePlayerName = playerName;
          game.blackPlayerName = 'AI';
      } else {
          game.blackPlayerId = playerId;
          game.blackPlayerName = playerName;
          game.whitePlayerName = 'AI';
      }
      game.status = 'playing'; // Auto-start the game
      playerColor = preferredColor;
  } else {
      // Multiplayer: Random assignment if both slots are empty
      if (!game.whitePlayerId && !game.blackPlayerId) {
          if (Math.random() < 0.5) {
              game.whitePlayerId = playerId;
              game.whitePlayerName = playerName;
              playerColor = 'white';
          } else {
              game.blackPlayerId = playerId;
              game.blackPlayerName = playerName;
              playerColor = 'black';
          }
      } else if (!game.whitePlayerId) {
          game.whitePlayerId = playerId;
          game.whitePlayerName = playerName;
          playerColor = 'white';
      } else if (!game.blackPlayerId) {
          game.blackPlayerId = playerId;
          game.blackPlayerName = playerName;
          playerColor = 'black';
      }
      
      if (isGameFull(game)) {
          game.status = "playing";
      }
  }

  await game.save();
  return { game, playerColor };
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
    const { id } = req.params;
    let updates = req.body;

    console.log("🛠 UPDATING GAME with:", updates);

    try {
        // ✅ Fetch existing game to merge `currentBoardStatus` safely
        const existingGame = await Game.findById(id);
        if (!existingGame) {
            return res.status(404).json({ message: "Game not found" });
        }

        // ✅ Deep clone the existing `currentBoardStatus` to remove Mongoose internals
        let sanitizedBoardStatus = JSON.parse(JSON.stringify(existingGame.currentBoardStatus));

        if (updates.currentBoardStatus) {
            sanitizedBoardStatus = {
                ...sanitizedBoardStatus,  // Preserve existing board state
                ...updates.currentBoardStatus // Apply new updates
            };
        }

        // ✅ Prepare sanitized updates object (avoids circular refs)
        const sanitizedUpdates = { ...updates, currentBoardStatus: sanitizedBoardStatus };

        // Remove any potential Mongoose metadata
        delete sanitizedUpdates._id;
        delete sanitizedUpdates.__v;
        delete sanitizedUpdates.createdAt;
        delete sanitizedUpdates.updatedAt;

        // ✅ Use `findByIdAndUpdate` to update without circular refs
        const updatedGame = await Game.findByIdAndUpdate(
            id,
            { $set: sanitizedUpdates }, // ✅ Use `$set` to update only the necessary fields
            { new: true, runValidators: true } // ✅ Returns updated document, applies schema validation
        );

        if (!updatedGame) {
            return res.status(404).json({ message: "Game not found" });
        }

        console.log("✅ Successfully updated game:", updatedGame);
        return res.json(updatedGame);
    } catch (error) {
        console.error("❌ Error updating game:", error);
        return res.status(500).json({ message: "Error updating game state", error: error.toString() });
    }
};



  
exports.deleteAll = async(req, res) =>{
  const game = await Game.deleteMany({})
    return res.status(202).json({message: 'success'})
};