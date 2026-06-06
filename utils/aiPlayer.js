/**
 * Player abstraction for dojo / selfplay.
 *
 * A Player is anything with:
 *   - name:  string used in winner labels and onPly rows
 *   - takeTurn(game): returns the updated game object after one move
 *
 * Today every player is a difficulty-driven AI wrapping makeAIMove. The
 * indirection exists so future non-difficulty players (NN-direct, scripted
 * openings, human-in-the-loop) can drop into the same game loop.
 */

const { makeAIMove } = require('./aiLogic');

function createDifficultyPlayer(difficulty, aiOpts = {}) {
  return {
    name: difficulty,
    difficulty,
    aiOpts,
    takeTurn(game) {
      return makeAIMove(game, difficulty, aiOpts);
    },
  };
}

/**
 * Coerce a string difficulty to a Player. Pass-through if already a Player.
 * Used by dojo/selfplay so callers can still pass `'hard'` instead of a Player.
 */
function toPlayer(p, aiOpts = {}) {
  if (p && typeof p === 'object' && typeof p.takeTurn === 'function') return p;
  if (typeof p === 'string') return createDifficultyPlayer(p, aiOpts);
  throw new Error(`Invalid player: ${p}`);
}

module.exports = { createDifficultyPlayer, toPlayer };
