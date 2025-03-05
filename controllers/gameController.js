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
      console.log("logging new game")
      console.log(newGame)
      console.log("logging color:")
      console.log(playerColor)

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
    const updates = req.body;
  
    console.log("🛠 Incoming request body:", JSON.stringify(updates, null, 2));
  
    try {
      // ✅ Fetch game first
      const game = await Game.findById(id);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }
  
      // ✅ Only update fields that exist in `updates` (prevent overwriting with undefined)
      const updateFields = {};
      const allowedFields = [
        "currentBoardStatus",
        "currentPlayerTurn",
        "movedPiece",
        "isUserTurn",
        "possibleMoves",
        "possiblePasses",
        "moveHistory",
        "hasMoved",
        "winner",
        "movedPieceOriginalPosition"
      ];
  
      allowedFields.forEach((field) => {
        if (updates[field] !== undefined) {
          updateFields[field] = updates[field];
        }
      });
  
      // ✅ Ensure `possiblePasses` is correctly updated
      if (updates.possiblePasses !== undefined) {
        updateFields.possiblePasses = updates.possiblePasses;
      }
  
      updateFields.updatedAt = new Date(); // ✅ Always update timestamp
  
      // ✅ Update only fields that exist in `updates`
      const updatedGame = await Game.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
      );
  
      console.log("✅ Updated game state:", JSON.stringify(updatedGame, null, 2));
      res.json(updatedGame);
    } catch (error) {
      console.error("❌ Error updating game:", error);
      res.status(500).json({ message: "Error updating game state", error: error.toString() });
    }
  };  
  
exports.deleteAll = async(req, res) =>{
  const game = await Game.deleteMany({})
    return res.status(202).json({message: 'success'})
};