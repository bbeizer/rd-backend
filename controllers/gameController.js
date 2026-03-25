const Game = require('../models/Game');
const queueManager = require('../utils/queueManager');
const { initializeBoardStatus } = require('../utils/gameInitialization');
const { emitGameUpdate, emitGameStarted, emitGameEnd } = require('../utils/socketManager');
const {
    handleCellClick,
    handlePassTurn,
    handleSendMessage,
} = require('../utils/gameLogic');
const { makeAIMove } = require('../utils/aiLogic');


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

            // 🔌 Emit WebSocket event when game is full and ready to start
            const io = req.app.get('io');
            emitGameStarted(io, updatedGame._id.toString(), updatedGame);
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
        newGame.gameType = 'singleplayer'; // Explicitly set for single player
        newGame.aiColor = playerColor === 'white' ? 'black' : 'white';
        newGame.playerColor = playerColor; // <-- Add this line for consistency
        let { game: createdGame } = await addPlayerToGame(
            newGame, playerId, playerName, playerColor, true
        );

        // If AI is white, it moves first
        if (createdGame.aiColor === 'white') {
            const gameState = createdGame.toObject();
            const updatedState = makeAIMove(gameState);

            // Update game with AI's first move
            createdGame.currentBoardStatus = updatedState.currentBoardStatus;
            createdGame.currentPlayerTurn = updatedState.currentPlayerTurn;
            createdGame.turnNumber = updatedState.turnNumber;

            // Check for win (unlikely on first move but be consistent)
            if (updatedState.status === 'completed') {
                createdGame.status = updatedState.status;
                createdGame.winner = updatedState.winner;
            }

            await createdGame.save();
        }

        // 🔌 Emit WebSocket event for single player game creation
        const io = req.app.get('io');
        emitGameStarted(io, createdGame._id.toString(), createdGame);

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
        const existingGame = await Game.findById(id);
        if (!existingGame) {
            return res.status(404).json({ message: "Game not found" });
        }

        // ✅ Safely merge board updates
        let sanitizedBoardStatus = JSON.parse(JSON.stringify(existingGame.currentBoardStatus));
        if (updates.currentBoardStatus) {
            sanitizedBoardStatus = {
                ...sanitizedBoardStatus,
                ...updates.currentBoardStatus,
            };
        }

        // ✅ Append new message if provided
        if (updates.newMessage) {
            existingGame.conversation.push(updates.newMessage);
            delete updates.newMessage; // Prevent it from going into the $set below
        }

        // ✅ Apply remaining updates
        const sanitizedUpdates = { ...updates, currentBoardStatus: sanitizedBoardStatus };
        delete sanitizedUpdates._id;
        delete sanitizedUpdates.__v;
        delete sanitizedUpdates.createdAt;
        delete sanitizedUpdates.updatedAt;

        Object.assign(existingGame, sanitizedUpdates);

        const updatedGame = await existingGame.save();

        // 🔌 Emit WebSocket event to all clients in the game room
        const io = req.app.get('io');
        emitGameUpdate(io, id, updatedGame);

        console.log("✅ Successfully updated game:", updatedGame);
        return res.json(updatedGame);
    } catch (error) {
        console.error("❌ Error updating game:", error);
        return res.status(500).json({ message: "Error updating game state", error: error.toString() });
    }
};

exports.deleteAll = async (req, res) => {
    const game = await Game.deleteMany({})
    return res.status(202).json({ message: 'success' })
};

/**
 * Handle game actions (CELL_CLICK, PASS_TURN, SEND_MESSAGE)
 * POST /api/games/:id/action
 */
exports.handleGameAction = async (req, res) => {
    const { id } = req.params;
    const { playerId, action } = req.body;

    try {
        // Validate request structure
        if (!playerId || !action || !action.type) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_ACTION',
                    message: 'Missing playerId or action',
                },
            });
        }

        // Fetch the game
        const game = await Game.findById(id);
        if (!game) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'INVALID_ACTION',
                    message: 'Game not found',
                },
            });
        }

        // Convert Mongoose document to plain object for processing
        const gameState = game.toObject();

        // Convert Map to plain object if needed
        if (gameState.currentBoardStatus instanceof Map) {
            const boardObj = {};
            gameState.currentBoardStatus.forEach((value, key) => {
                boardObj[key] = value;
            });
            gameState.currentBoardStatus = boardObj;
        }

        let result;

        // Route to appropriate handler
        switch (action.type) {
            case 'CELL_CLICK':
                if (!action.payload || !action.payload.cellKey) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_ACTION',
                            message: 'CELL_CLICK requires payload.cellKey',
                        },
                    });
                }
                result = handleCellClick(gameState, action.payload.cellKey, playerId);
                break;

            case 'PASS_TURN':
                result = handlePassTurn(gameState, playerId);
                console.log('🎯 PASS_TURN - After handlePassTurn:', {
                    currentPlayerTurn: result.game.currentPlayerTurn,
                    gameType: game.gameType,
                    aiColor: game.aiColor
                });

                // Handle AI turn in singleplayer
                if (result.success && game.gameType === 'singleplayer' && game.aiColor) {
                    const nextTurn = result.game.currentPlayerTurn;
                    console.log('🤖 AI check:', { nextTurn, aiColor: game.aiColor, willMakeAIMove: nextTurn === game.aiColor });
                    if (nextTurn === game.aiColor) {
                        // Make AI move (also switches turn back to player and increments turn number)
                        result.game = makeAIMove(result.game);
                        console.log('🤖 After makeAIMove:', { currentPlayerTurn: result.game.currentPlayerTurn });
                    }
                }
                break;

            case 'SEND_MESSAGE':
                result = handleSendMessage(gameState, playerId, action.payload);
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_ACTION',
                        message: `Unknown action type: ${action.type}`,
                    },
                });
        }

        // Handle errors from game logic
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        // Apply updates to the game document
        const updatedGameState = result.game;

        // Update board status
        if (updatedGameState.currentBoardStatus) {
            game.currentBoardStatus = updatedGameState.currentBoardStatus;
        }

        // Update other fields
        if (updatedGameState.activePiece !== undefined) {
            game.activePiece = updatedGameState.activePiece || { position: null, color: undefined, hasBall: false };
        }
        if (updatedGameState.possibleMoves !== undefined) {
            game.possibleMoves = updatedGameState.possibleMoves;
        }
        if (updatedGameState.possiblePasses !== undefined) {
            game.possiblePasses = updatedGameState.possiblePasses;
        }
        if (updatedGameState.movedPiece !== undefined) {
            game.movedPiece = updatedGameState.movedPiece;
        }
        if (updatedGameState.originalSquare !== undefined) {
            game.originalSquare = updatedGameState.originalSquare;
        }
        if (updatedGameState.hasMoved !== undefined) {
            game.hasMoved = updatedGameState.hasMoved;
        }
        if (updatedGameState.currentPlayerTurn !== undefined) {
            console.log('📝 Setting currentPlayerTurn:', updatedGameState.currentPlayerTurn);
            game.currentPlayerTurn = updatedGameState.currentPlayerTurn;
        }
        if (updatedGameState.turnNumber !== undefined) {
            game.turnNumber = updatedGameState.turnNumber;
        }
        console.log('💾 About to save game with currentPlayerTurn:', game.currentPlayerTurn);
        if (updatedGameState.status !== undefined) {
            game.status = updatedGameState.status;
        }
        if (updatedGameState.winner !== undefined) {
            game.winner = updatedGameState.winner;
        }
        if (updatedGameState.conversation !== undefined) {
            game.conversation = updatedGameState.conversation;
        }

        // Save the updated game
        const savedGame = await game.save();

        // Emit WebSocket events
        const io = req.app.get('io');
        emitGameUpdate(io, id, savedGame);

        // Emit game end if completed
        if (savedGame.status === 'completed') {
            emitGameEnd(io, id, savedGame);
        }

        // Convert to plain object with Maps flattened for JSON serialization
        const gameStateResponse = savedGame.toObject({ flattenMaps: true });

        // Ensure _id is a string (some frontends expect this)
        if (gameStateResponse._id) {
            gameStateResponse._id = gameStateResponse._id.toString();
        }

        return res.json({
            success: true,
            gameState: gameStateResponse,
        });

    } catch (error) {
        console.error('❌ Error processing game action:', error);
        return res.status(500).json({
            success: false,
            error: {
                code: 'INVALID_ACTION',
                message: 'Error processing game action',
            },
        });
    }
};