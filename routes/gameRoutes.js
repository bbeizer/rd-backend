const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');

router.post('/createGame', gameController.createGame);
router.get('/:id', gameController.getGameById);
router.get('/games/:id', gameController.getGameState);
router.put('/games/:id/move', gameController.makeMove);

module.exports = router;
