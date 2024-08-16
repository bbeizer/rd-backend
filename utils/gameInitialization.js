// utils/gameInitialization.js

const uuidv4 = require('uuid').v4; 
const initialSetup = (rowIndex, colIndex) => {
    let pieceColor = null;
    let hasBall = false;
    let id = null;  // Default to no ID unless a piece is created

    if (rowIndex === 0 && [2, 3, 4, 5].includes(colIndex)) {
        pieceColor = 'black';
        hasBall = colIndex === 4;
        id = uuidv4();  // Assign a unique ID
    } else if (rowIndex === 7 && [2, 3, 4, 5].includes(colIndex)) {
        pieceColor = 'white';
        hasBall = colIndex === 3;
        id = uuidv4();  // Assign a unique ID
    }

    return { pieceColor, hasBall };
};

const initializeBoardStatus = () => {
    const initialBoardStatus = {};

    for (let rowIndex = 0; rowIndex < 8; rowIndex++) {
        for (let colIndex = 0; colIndex < 8; colIndex++) {
            const cellKey = `${String.fromCharCode(97 + colIndex)}${rowIndex + 1}`;
            const { pieceColor, hasBall, position } = initialSetup(rowIndex, colIndex);
            if (pieceColor) {
                initialBoardStatus[cellKey] = { color: pieceColor, hasBall, position: cellKey};
            } else {
                initialBoardStatus[cellKey] = null;
            }
        }
    }

    return {
        // Assuming you'd assign a unique ID upon saving to the database
        status: 'not started',
        turnPlayer: 'white',
        moveHistory: [],
        currentBoardStatus: initialBoardStatus,
    };
};

module.exports = { initializeBoardStatus };
