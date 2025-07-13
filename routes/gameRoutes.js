const express = require('express');
const cors = require('cors');
const gameController = require('../controllers/gameController');
const router = express.Router();
const { body, validationResult } = require('express-validator');

router.options('/:id', cors()); // <- THIS is the important bit

router.post('/joinMultiplayerGame', gameController.startOrJoinMultiPlayerGame);
router.post('/startSinglePlayerGame', gameController.startAndJoinSinglePlayerGame);
router.post('/', gameController.createGame);

router.route('/:id')
  .get(gameController.getGameById)
  .patch([
    // Validation middleware
    body('currentBoardStatus').optional().isObject().withMessage('currentBoardStatus must be an object'),
    body('playerColor').optional().isIn(['white', 'black']).withMessage('playerColor must be "white" or "black"'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const err = new Error('Validation failed');
        err.status = 400;
        err.details = errors.array();
        return next(err);
      }
      next();
    },
    gameController.updateGame
  ]);

router.delete('/', gameController.deleteAll);

module.exports = router;
