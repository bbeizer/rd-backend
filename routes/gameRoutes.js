const express = require('express');
const cors = require('cors');
const gameController = require('../controllers/gameController');
const router = express.Router();

router.options('/:id', cors()); // <- THIS is the important bit

router.post('/joinMultiplayerGame', gameController.startOrJoinMultiPlayerGame);
router.post('/startSinglePlayerGame', gameController.startAndJoinSinglePlayerGame);
router.post('/', gameController.createGame);

router.route('/:id')
  .get(gameController.getGameById)
  .patch(gameController.updateGame);

router.delete('/', gameController.deleteAll);

module.exports = router;
