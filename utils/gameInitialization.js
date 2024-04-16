// utils/gameInitialization.js

const initialSetup = (rowIndex, colIndex) => {
    let pieceColor = null;
    let hasBall = false;

    if (rowIndex === 0 && [2, 3, 4, 5].includes(colIndex)) {
        pieceColor = 'black';
        hasBall = colIndex === 4;
    } else if (rowIndex === 7 && [2, 3, 4, 5].includes(colIndex)) {
        pieceColor = 'white';
        hasBall = colIndex === 3;
    }

    return { pieceColor, hasBall };
};

const initializeBoardStatus = () => {
    const initialBoardStatus = {};

    for (let rowIndex = 0; rowIndex < 8; rowIndex++) {
        for (let colIndex = 0; colIndex < 8; colIndex++) {
            const cellKey = `${String.fromCharCode(97 + colIndex)}${rowIndex + 1}`;
            const { pieceColor, hasBall } = initialSetup(rowIndex, colIndex);
            if (pieceColor) {
                initialBoardStatus[cellKey] = { color: pieceColor, hasBall };
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
