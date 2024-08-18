const uuidv4 = require('uuid').v4; 

const initialSetup = (rowIndex, colIndex) => {
    let pieceColor = null;
    let hasBall = false;
    let id = null;

    if (rowIndex === 1 && [2, 3, 4, 5].includes(colIndex)) {
        pieceColor = 'black';
        hasBall = colIndex === 4;
        id = uuidv4(); 
    } else if (rowIndex === 6 && [2, 3, 4, 5].includes(colIndex)) {
        pieceColor = 'white';
        hasBall = colIndex === 3;
        id = uuidv4();
    }

    return { pieceColor, hasBall, id };
};

const initializeBoardStatus = () => {
    const initialBoardStatus = {};

    for (let rowIndex = 0; rowIndex < 8; rowIndex++) {
        for (let colIndex = 0; colIndex < 8; colIndex++) {
            const cellKey = `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}`;
            const { pieceColor, hasBall, id } = initialSetup(rowIndex, colIndex);
            if (pieceColor) {
                initialBoardStatus[cellKey] = { color: pieceColor, hasBall, position: cellKey, id };
            } else {
                initialBoardStatus[cellKey] = null;
            }
        }
    }

    return {
        status: 'not started',
        turnPlayer: 'white',
        moveHistory: [],
        currentBoardStatus: initialBoardStatus,
    };
};

module.exports = { initializeBoardStatus };
