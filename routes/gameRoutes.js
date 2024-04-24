const express = require('express');
const gameController = require('../controllers/gameController');
const router = express.Router();

// Route to create a new game
router.post('/', gameController.createGame);

// Routes to get and update the game state by ID
router.route('/:id')
  .get(gameController.getGameById) // Get a specific game by ID
  .patch(gameController.updateGame); // Update game state

// Route for game moves could potentially be part of the same '/:id' route group if it updates the game state
router.put('/:id/move', gameController.makeMove);

router.delete('/', gameController.deleteAll)

module.exports = router;
