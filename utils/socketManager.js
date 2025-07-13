/**
 * WebSocket utility functions for game management
 */

/**
 * Emit game update to all players in a game room
 * @param {Object} io - Socket.IO instance
 * @param {string} gameId - Game ID
 * @param {Object} gameData - Updated game data
 */
const emitGameUpdate = (io, gameId, gameData) => {
    if (io) {
        io.to(gameId).emit('gameUpdated', gameData);
        console.log(`📡 Game update emitted for game: ${gameId}`);
    }
};

/**
 * Emit game start event to all players in a game room
 * @param {Object} io - Socket.IO instance
 * @param {string} gameId - Game ID
 * @param {Object} gameData - Game data
 */
const emitGameStarted = (io, gameId, gameData) => {
    if (io) {
        io.to(gameId).emit('gameStarted', gameData);
        console.log(`📡 Game started event emitted for game: ${gameId}`);
    }
};

/**
 * Emit turn change event to all players in a game room
 * @param {Object} io - Socket.IO instance
 * @param {string} gameId - Game ID
 * @param {string} currentPlayerTurn - Current player's turn
 */
const emitTurnChange = (io, gameId, currentPlayerTurn) => {
    if (io) {
        io.to(gameId).emit('turnChanged', { currentPlayerTurn });
        console.log(`📡 Turn change emitted for game: ${gameId}, turn: ${currentPlayerTurn}`);
    }
};

/**
 * Emit game end event to all players in a game room
 * @param {Object} io - Socket.IO instance
 * @param {string} gameId - Game ID
 * @param {Object} gameData - Final game data with winner
 */
const emitGameEnd = (io, gameId, gameData) => {
    if (io) {
        io.to(gameId).emit('gameEnded', gameData);
        console.log(`📡 Game ended event emitted for game: ${gameId}`);
    }
};

/**
 * Emit move validation result to specific player
 * @param {Object} io - Socket.IO instance
 * @param {string} gameId - Game ID
 * @param {string} playerId - Player ID
 * @param {Object} result - Validation result
 */
const emitMoveValidation = (io, gameId, playerId, result) => {
    if (io) {
        io.to(gameId).emit('moveValidated', { playerId, ...result });
        console.log(`📡 Move validation emitted for player: ${playerId}`);
    }
};

module.exports = {
    emitGameUpdate,
    emitGameStarted,
    emitTurnChange,
    emitGameEnd,
    emitMoveValidation
}; 