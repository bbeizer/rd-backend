const express = require('express');
const gameController = require('../controllers/gameController');
const router = express.Router();

// Route to add a player to the queue and join a multiplayer game
router.post('/joinMultiplayerGame', gameController.startOrJoinMultiPlayerGame);

// Route to add a player to a single player game
router.post('/startSinglePlayerGame', gameController.startAndJoinSinglePlayerGame);

// Route to create a new game
router.post('/', gameController.createGame);

// Routes to get and update the game state by ID
router.route('/:id')
  .get(gameController.getGameById) // Get a specific game by ID
  .patch(gameController.updateGame); // Update game state

// Route to delete all games (for testing or administrative purposes)
router.delete('/', gameController.deleteAll);

module.exports = router;
