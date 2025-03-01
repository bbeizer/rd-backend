const Game = require('../models/Game');
const queueManager = require('../utils/queueManager');
const { initializeBoardStatus } = require('../utils/gameInitialization');


exports.startOrJoinGameMultiPlayerGame = async (req, res) => {
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

exports.startAndJoinSinglePlayerGame = async (req, res) => {
    try {
        const { playerId, playerName } = req.body;
        const newGame = new Game(initializeBoardStatus());
        newGame.whitePlayerName = playerName;
        newGame.whitePlayerId = playerId;
        newGame.blackPlayerName = 'AI';
        newGame.gameType = 'single';  // Explicitly set for single player
        newGame.status = 'playing';
        await newGame.save();
        res.status(201).json({ game: newGame, message: `Game created successfully for player ${playerName}` });
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

async function addPlayerToGame(game, playerId, playerName) {
    let playerColor = null;

    if (!game.whitePlayerId && !game.blackPlayerId) {
        // Randomly decide if the first player should be white or black
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
  
    console.log("🛠 Incoming req body:", JSON.stringify(updates, null, 2));
  
    try {
      const game = await Game.findById(id);
  
      if (!game) {
        return res.status(404).send({ message: "Game not found" });
      }
  
      // 🔥 Fix: Use `$set` to update the nested `currentBoardStatus`
      const updatedGame = await Game.findByIdAndUpdate(
        id,
        { 
          $set: { 
            "currentBoardStatus": updates.gameData.currentBoardStatus, // 🔥 Update only the board
            "currentPlayerTurn": updates.gameData.currentPlayerTurn, // 🔥 Ensure turn updates
            "moveHistory": updates.gameData.moveHistory, // 🔥 Preserve move history
            "winner": updates.gameData.winner, // 🔥 Ensure game state updates
            "updatedAt": new Date() // 🔥 Ensure timestamp updates
          } 
        },
        { new: true, runValidators: true }
      );
  
      console.log("✅ Updated game state:", JSON.stringify(updatedGame, null, 2));
      res.json(updatedGame);
    } catch (error) {
      console.error("❗ Error updating game:", error);
      res.status(500).json({ message: "Error updating game state", error: error.toString() });
    }
  };
  
exports.deleteAll = async(req, res) =>{
  const game = await Game.deleteMany({})
    return res.status(202).json({message: 'success'})
};