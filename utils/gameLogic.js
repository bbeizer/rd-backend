/**
 * Game Logic Utilities for Razzle Dazzle
 * Handles all game rules: piece movement, ball passing, win conditions
 */

// ============================================
// COORDINATE CONVERSION
// ============================================

/**
 * Convert cell key (e.g., "e4") to array indices
 * @param {string} cellKey - Cell in algebraic notation
 * @returns {{ row: number, col: number }}
 */
function getKeyCoordinates(cellKey) {
  const col = cellKey.charCodeAt(0) - 'a'.charCodeAt(0); // 'a' -> 0, 'h' -> 7
  const row = 8 - parseInt(cellKey.slice(1), 10);         // '8' -> 0, '1' -> 7
  return { row, col };
}

/**
 * Convert array indices to cell key
 * @param {number} row - Row index (0-7)
 * @param {number} col - Column index (0-7)
 * @returns {string} Cell key in algebraic notation
 */
function toCellKey(row, col) {
  const letter = String.fromCharCode(97 + col); // 0 -> 'a', 7 -> 'h'
  const number = 8 - row;                        // 0 -> 8, 7 -> 1
  return `${letter}${number}`;
}

// ============================================
// MOVEMENT CALCULATION
// ============================================

/**
 * Calculate valid knight-like moves for a piece
 * @param {string} cellKey - Current position of the piece
 * @param {Object} board - Current board state
 * @param {boolean} hasMoved - Has a piece already moved this turn?
 * @param {string|null} originalSquare - Original position if piece moved
 * @returns {string[]} Array of valid move targets
 */
function getPieceMoves(cellKey, board, hasMoved, originalSquare) {
  // If piece already moved this turn, can only return to original square
  if (hasMoved && originalSquare) {
    return [originalSquare];
  }

  const { row, col } = getKeyCoordinates(cellKey);
  const moves = [];

  // Knight move offsets (L-shape)
  const offsets = [
    { row: -2, col: 1 },  { row: -1, col: 2 },
    { row: 1, col: 2 },   { row: 2, col: 1 },
    { row: 2, col: -1 },  { row: 1, col: -2 },
    { row: -1, col: -2 }, { row: -2, col: -1 },
  ];

  for (const offset of offsets) {
    const newRow = row + offset.row;
    const newCol = col + offset.col;

    // Check bounds
    if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
      const targetKey = toCellKey(newRow, newCol);
      // Only empty squares are valid
      if (getBoardCell(board, targetKey) === null) {
        moves.push(targetKey);
      }
    }
  }

  return moves;
}

/**
 * Calculate valid ball pass targets
 * @param {string} cellKey - Current position of piece with ball
 * @param {string} pieceColor - Color of the piece ('white' or 'black')
 * @param {Object} board - Current board state
 * @returns {string[]} Array of valid pass targets
 */
function getValidPasses(cellKey, pieceColor, board) {
  const { row, col } = getKeyCoordinates(cellKey);
  const validPasses = [];

  // 8 directions: horizontal, vertical, diagonal
  const directions = [
    { dx: 1, dy: 0 },   { dx: -1, dy: 0 },   // Right, Left
    { dx: 0, dy: 1 },   { dx: 0, dy: -1 },   // Down, Up
    { dx: 1, dy: 1 },   { dx: 1, dy: -1 },   // Diagonals
    { dx: -1, dy: 1 },  { dx: -1, dy: -1 },
  ];

  for (const { dx, dy } of directions) {
    let currentRow = row + dy;
    let currentCol = col + dx;

    // Extend in this direction until hitting a piece or edge
    while (currentRow >= 0 && currentRow < 8 && currentCol >= 0 && currentCol < 8) {
      const targetKey = toCellKey(currentRow, currentCol);
      const targetPiece = getBoardCell(board, targetKey);

      if (targetPiece) {
        // Found a piece - check if valid pass target
        if (targetPiece.color === pieceColor && !targetPiece.hasBall) {
          validPasses.push(targetKey);
        }
        break; // Stop looking in this direction
      }

      currentRow += dy;
      currentCol += dx;
    }
  }

  return validPasses;
}

// ============================================
// WIN CONDITION
// ============================================

/**
 * Check if either player has won
 * @param {Object} board - Current board state
 * @returns {'white'|'black'|null} Winner color or null
 */
function didWin(board) {
  // Check if black won (black piece with ball on row 1)
  const row1 = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'];
  for (const cell of row1) {
    const piece = getBoardCell(board, cell);
    if (piece && piece.color === 'black' && piece.hasBall) {
      return 'black';
    }
  }

  // Check if white won (white piece with ball on row 8)
  const row8 = ['a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8'];
  for (const cell of row8) {
    const piece = getBoardCell(board, cell);
    if (piece && piece.color === 'white' && piece.hasBall) {
      return 'white';
    }
  }

  return null;
}

// ============================================
// BOARD OPERATIONS
// ============================================

/**
 * Get a cell from the board (handles both Map and Object)
 * @param {Object|Map} board - Board state
 * @param {string} cellKey - Cell key
 * @returns {Object|null} Piece or null
 */
function getBoardCell(board, cellKey) {
  if (board instanceof Map) {
    return board.get(cellKey) || null;
  }
  return board[cellKey] || null;
}

/**
 * Set a cell on the board (handles both Map and Object)
 * @param {Object|Map} board - Board state
 * @param {string} cellKey - Cell key
 * @param {Object|null} value - Piece or null
 */
function setBoardCell(board, cellKey, value) {
  if (board instanceof Map) {
    board.set(cellKey, value);
  } else {
    board[cellKey] = value;
  }
}

/**
 * Clone board state to plain object
 * @param {Object|Map} board - Board state
 * @returns {Object} Plain object board
 */
function cloneBoard(board) {
  if (board instanceof Map) {
    const obj = {};
    board.forEach((value, key) => {
      obj[key] = value ? { ...value } : null;
    });
    return obj;
  }
  const cloned = {};
  for (const key of Object.keys(board)) {
    cloned[key] = board[key] ? { ...board[key] } : null;
  }
  return cloned;
}

/**
 * Move a piece from source to target
 * @param {string} sourceKey - Source cell key
 * @param {string} targetKey - Target cell key
 * @param {Object} board - Current board state
 * @returns {Object} New board state
 */
function movePiece(sourceKey, targetKey, board) {
  const newBoard = cloneBoard(board);
  const piece = newBoard[sourceKey];

  if (piece) {
    newBoard[targetKey] = { ...piece, position: targetKey };
    newBoard[sourceKey] = null;
  }

  return newBoard;
}

/**
 * Pass the ball from source to target
 * @param {string} sourceKey - Source cell key (current ball holder)
 * @param {string} targetKey - Target cell key (receiver)
 * @param {Object} board - Current board state
 * @returns {Object} New board state
 */
function passBall(sourceKey, targetKey, board) {
  const newBoard = cloneBoard(board);
  const sourcePiece = newBoard[sourceKey];
  const targetPiece = newBoard[targetKey];

  if (sourcePiece && targetPiece) {
    newBoard[sourceKey] = { ...sourcePiece, hasBall: false };
    newBoard[targetKey] = { ...targetPiece, hasBall: true };
  }

  return newBoard;
}

// ============================================
// GAME STATE HELPERS
// ============================================

/**
 * Clear active piece selection
 * @param {Object} game - Game state
 * @returns {Object} Updated game state
 */
function clearSelection(game) {
  return {
    ...game,
    activePiece: null,
    possibleMoves: [],
    possiblePasses: [],
  };
}

/**
 * Get player color from player ID
 * @param {Object} game - Game state
 * @param {string} playerId - Player ID
 * @returns {'white'|'black'|null}
 */
function getPlayerColor(game, playerId) {
  if (game.whitePlayerId === playerId) return 'white';
  if (game.blackPlayerId === playerId) return 'black';
  return null;
}

// ============================================
// MAIN ACTION HANDLER
// ============================================

/**
 * Handle CELL_CLICK action - the core game state machine
 * @param {Object} game - Current game state (Mongoose document or plain object)
 * @param {string} cellKey - Clicked cell
 * @param {string} playerId - Acting player's ID
 * @returns {{ success: boolean, game?: Object, error?: { code: string, message: string } }}
 */
function handleCellClick(game, cellKey, playerId) {
  // 1. Validate it's this player's turn
  const playerColor = getPlayerColor(game, playerId);

  if (!playerColor || game.currentPlayerTurn !== playerColor) {
    return {
      success: false,
      error: { code: 'NOT_YOUR_TURN', message: "It's not your turn" }
    };
  }

  if (game.status === 'completed') {
    return {
      success: false,
      error: { code: 'GAME_OVER', message: 'Game is already over' }
    };
  }

  // Clone game state for modifications
  const board = cloneBoard(game.currentBoardStatus);
  const clickedPiece = board[cellKey];
  const activePiece = game.activePiece;

  // 3. CLICKED ON A PIECE
  if (clickedPiece) {
    // Can't click opponent's pieces
    if (clickedPiece.color !== playerColor) {
      return {
        success: false,
        error: { code: 'INVALID_ACTION', message: "Cannot interact with opponent's pieces" }
      };
    }

    // Restriction: if a piece has moved and active piece doesn't have ball,
    // can only interact with movedPiece or piece with ball
    if (game.movedPiece && game.movedPiece.position && (!activePiece || !activePiece.hasBall)) {
      const isMovedPiece = clickedPiece.position === game.movedPiece.position;
      const hasBall = clickedPiece.hasBall;
      const isActivePiece = activePiece && activePiece.position === clickedPiece.position;

      if (!isMovedPiece && !hasBall && !isActivePiece) {
        return {
          success: false,
          error: { code: 'INVALID_ACTION', message: 'After moving, can only interact with moved piece or ball holder' }
        };
      }
    }

    // PIECE HAS BALL - show pass options or deselect
    if (clickedPiece.hasBall) {
      if (activePiece && activePiece.position === cellKey) {
        // Clicking same piece = deselect
        return {
          success: true,
          game: clearSelection(game)
        };
      } else {
        // Select piece with ball, show pass targets
        const possiblePasses = getValidPasses(cellKey, clickedPiece.color, board);
        return {
          success: true,
          game: {
            ...game,
            activePiece: { position: cellKey, color: clickedPiece.color, hasBall: true },
            possibleMoves: [],
            possiblePasses: possiblePasses,
          }
        };
      }
    }

    // PIECE WITHOUT BALL
    else {
      // If active piece has ball and this piece can receive
      if (activePiece && activePiece.hasBall && game.possiblePasses && game.possiblePasses.includes(cellKey)) {
        // Execute ball pass
        const newBoard = passBall(activePiece.position, cellKey, board);

        // Check win condition
        const winner = didWin(newBoard);
        const newPossiblePasses = getValidPasses(cellKey, clickedPiece.color, newBoard);

        const newGame = {
          ...game,
          currentBoardStatus: newBoard,
          activePiece: { position: cellKey, color: clickedPiece.color, hasBall: true },
          possiblePasses: newPossiblePasses,
          possibleMoves: [],
        };

        if (winner) {
          newGame.status = 'completed';
          newGame.winner = winner === 'white' ? game.whitePlayerName : game.blackPlayerName;
        }

        return { success: true, game: newGame };
      }

      // Otherwise, select this piece (show moves or deselect)
      if (activePiece && activePiece.position === cellKey) {
        // Deselect
        return { success: true, game: clearSelection(game) };
      } else {
        // Select and show moves
        let possibleMoves;

        // If this is the moved piece, can only return to original
        if (game.movedPiece && game.movedPiece.position === cellKey) {
          possibleMoves = game.originalSquare ? [game.originalSquare] : [];
        } else {
          possibleMoves = getPieceMoves(
            cellKey,
            board,
            game.hasMoved || false,
            game.originalSquare || null
          );
        }

        return {
          success: true,
          game: {
            ...game,
            activePiece: { position: cellKey, color: clickedPiece.color, hasBall: false },
            possibleMoves: possibleMoves,
            possiblePasses: [],
          }
        };
      }
    }
  }

  // 4. CLICKED ON EMPTY CELL
  else {
    if (!activePiece || !activePiece.position) {
      // Nothing selected, clicking empty = no-op
      return { success: true, game: clearSelection(game) };
    }

    // Active piece has ball - can't move, deselect
    if (activePiece.hasBall) {
      return { success: true, game: clearSelection(game) };
    }

    // Check if this is a valid move
    if (game.possibleMoves && game.possibleMoves.includes(cellKey)) {
      // CASE: No piece has moved yet - execute move
      if (!game.movedPiece || !game.movedPiece.position) {
        const newBoard = movePiece(activePiece.position, cellKey, board);
        const movedPiece = newBoard[cellKey];

        return {
          success: true,
          game: {
            ...game,
            currentBoardStatus: newBoard,
            activePiece: { position: cellKey, color: movedPiece.color, hasBall: movedPiece.hasBall },
            movedPiece: { position: cellKey },
            originalSquare: activePiece.position,
            hasMoved: true,
            possibleMoves: [activePiece.position], // Can only return
            possiblePasses: [],
          }
        };
      }

      // CASE: Returning to original square (undo move)
      if (cellKey === game.originalSquare) {
        const newBoard = movePiece(activePiece.position, cellKey, board);

        return {
          success: true,
          game: {
            ...game,
            currentBoardStatus: newBoard,
            activePiece: null,
            movedPiece: { position: null },
            originalSquare: null,
            hasMoved: false,
            possibleMoves: [],
            possiblePasses: [],
          }
        };
      }
    }

    // Invalid move - if piece already moved, show "return to original" hint
    if (game.movedPiece && game.movedPiece.position) {
      const movedPieceData = board[game.movedPiece.position];
      return {
        success: true,
        game: {
          ...game,
          activePiece: movedPieceData ? { position: game.movedPiece.position, color: movedPieceData.color, hasBall: movedPieceData.hasBall } : null,
          possibleMoves: game.originalSquare ? [game.originalSquare] : [],
          possiblePasses: [],
        }
      };
    }

    // Otherwise just deselect
    return { success: true, game: clearSelection(game) };
  }
}

/**
 * Handle PASS_TURN action
 * @param {Object} game - Current game state
 * @param {string} playerId - Acting player's ID
 * @returns {{ success: boolean, game?: Object, error?: { code: string, message: string } }}
 */
function handlePassTurn(game, playerId) {
  const playerColor = getPlayerColor(game, playerId);

  if (!playerColor || game.currentPlayerTurn !== playerColor) {
    return {
      success: false,
      error: { code: 'NOT_YOUR_TURN', message: "It's not your turn" }
    };
  }

  if (game.status === 'completed') {
    return {
      success: false,
      error: { code: 'GAME_OVER', message: 'Game is already over' }
    };
  }

  // Switch turn
  const nextTurn = playerColor === 'white' ? 'black' : 'white';

  const newGame = {
    ...game,
    currentPlayerTurn: nextTurn,
    activePiece: null,
    movedPiece: { position: null },
    originalSquare: null,
    hasMoved: false,
    possibleMoves: [],
    possiblePasses: [],
    turnNumber: (game.turnNumber || 0) + 1,
  };

  return { success: true, game: newGame };
}

/**
 * Handle SEND_MESSAGE action
 * @param {Object} game - Current game state
 * @param {string} playerId - Acting player's ID
 * @param {Object} payload - Message payload { author, text }
 * @returns {{ success: boolean, game?: Object, error?: { code: string, message: string } }}
 */
function handleSendMessage(game, playerId, payload) {
  const playerColor = getPlayerColor(game, playerId);

  if (!playerColor) {
    return {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'You are not a player in this game' }
    };
  }

  if (!payload || !payload.text) {
    return {
      success: false,
      error: { code: 'INVALID_ACTION', message: 'Message text is required' }
    };
  }

  const newMessage = {
    author: payload.author || (playerColor === 'white' ? game.whitePlayerName : game.blackPlayerName),
    text: payload.text,
    timestamp: new Date(),
  };

  const conversation = [...(game.conversation || []), newMessage];

  return {
    success: true,
    game: {
      ...game,
      conversation,
    },
    isMessageOnly: true, // Flag to indicate only conversation changed
  };
}

// ============================================
// AI MOVE GENERATION (Simple Random AI)
// ============================================

/**
 * Make a random AI move
 * @param {Object} game - Current game state
 * @returns {Object} Updated game state after AI move
 */
function makeAIMove(game) {
  const aiColor = game.aiColor;
  if (!aiColor) return game;

  const board = cloneBoard(game.currentBoardStatus);

  // Find all AI pieces
  const aiPieces = [];
  for (const cellKey of Object.keys(board)) {
    const piece = board[cellKey];
    if (piece && piece.color === aiColor) {
      aiPieces.push({ cellKey, piece });
    }
  }

  if (aiPieces.length === 0) return game;

  // Shuffle pieces for randomness
  shuffleArray(aiPieces);

  let newBoard = board;
  let moved = false;

  // Try to move a piece without the ball
  for (const { cellKey, piece } of aiPieces) {
    if (!piece.hasBall) {
      const moves = getPieceMoves(cellKey, newBoard, false, null);
      if (moves.length > 0) {
        // Pick a random valid move
        const targetKey = moves[Math.floor(Math.random() * moves.length)];
        newBoard = movePiece(cellKey, targetKey, newBoard);
        moved = true;
        break;
      }
    }
  }

  // Try to pass the ball (find the ball holder)
  const ballHolder = aiPieces.find(p => p.piece.hasBall);
  if (ballHolder) {
    // Refresh ball holder position after potential move
    let currentBallPos = ballHolder.cellKey;
    for (const key of Object.keys(newBoard)) {
      const p = newBoard[key];
      if (p && p.color === aiColor && p.hasBall) {
        currentBallPos = key;
        break;
      }
    }

    const passes = getValidPasses(currentBallPos, aiColor, newBoard);
    if (passes.length > 0) {
      // Prefer passing towards goal, otherwise random
      const goalRow = aiColor === 'black' ? '1' : '8';
      const goalPasses = passes.filter(p => p.endsWith(goalRow));
      const targetPass = goalPasses.length > 0
        ? goalPasses[Math.floor(Math.random() * goalPasses.length)]
        : passes[Math.floor(Math.random() * passes.length)];

      newBoard = passBall(currentBallPos, targetPass, newBoard);
    }
  }

  // Check win condition
  const winner = didWin(newBoard);

  const newGame = {
    ...game,
    currentBoardStatus: newBoard,
    activePiece: null,
    movedPiece: { position: null },
    originalSquare: null,
    hasMoved: false,
    possibleMoves: [],
    possiblePasses: [],
  };

  if (winner) {
    newGame.status = 'completed';
    newGame.winner = winner === 'white' ? game.whitePlayerName : game.blackPlayerName;
  }

  return newGame;
}

/**
 * Shuffle array in place (Fisher-Yates)
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

module.exports = {
  getKeyCoordinates,
  toCellKey,
  getPieceMoves,
  getValidPasses,
  didWin,
  getBoardCell,
  setBoardCell,
  cloneBoard,
  movePiece,
  passBall,
  clearSelection,
  getPlayerColor,
  handleCellClick,
  handlePassTurn,
  handleSendMessage,
  makeAIMove,
};
