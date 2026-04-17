/**
 * Static evaluation for easy / medium / hard (non-parameterized tiers).
 * Depends only on gameLogic (rules geometry) and aiEvalCore (shared eval helpers).
 */

const {
  getKeyCoordinates,
  toCellKey,
  getValidPasses,
} = require('./gameLogic');

const {
  EVAL_INFINITY,
  didWin,
  findPieces,
  findBallHolder,
  getAdvancement,
  computePassingChain,
  classifyPasses,
  countBlockedLanes,
  countRelayPieces,
  countKnightMobility,
  opponentDeliveryThreat,
} = require('./aiEvalCore');

/**
 * Simple eval (Easy mode) - just ball proximity + random noise
 */
function evaluateSimple(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  const winner = didWin(board);
  if (winner === color) return EVAL_INFINITY;
  if (winner === opponentColor) return -EVAL_INFINITY;

  let score = 0;

  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * 80;
  }

  const opponentBallHolder = findBallHolder(board, opponentColor);
  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    score -= getAdvancement(row, opponentColor) * 60;
  }

  return score;
}

/**
 * Standard eval (Medium mode) - improved version of original with directional passes
 */
function evaluateStandard(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  const winner = didWin(board);
  if (winner === color) return EVAL_INFINITY;
  if (winner === opponentColor) return -EVAL_INFINITY;

  let score = 0;

  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * 100;

    const passes = classifyPasses(board, color);
    score += passes.forward * 25;
    score += passes.lateral * 10;
    score += passes.backward * 5;
  }

  const opponentBallHolder = findBallHolder(board, opponentColor);
  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    score -= getAdvancement(row, opponentColor) * 90;

    const oppPasses = classifyPasses(board, opponentColor);
    score -= oppPasses.forward * 20;
    score -= oppPasses.lateral * 8;
    score -= oppPasses.backward * 4;
  }

  const myPieces = findPieces(board, color);
  for (const { cellKey } of myPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score += getAdvancement(row, color) * 8;
  }

  const opponentPieces = findPieces(board, opponentColor);
  for (const { cellKey } of opponentPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score -= getAdvancement(row, opponentColor) * 6;
  }

  return score;
}

/**
 * Advanced eval (Hard mode) - full strategic analysis with passing chains
 */
function evaluateAdvanced(board, color) {
  const opponentColor = color === 'white' ? 'black' : 'white';

  const winner = didWin(board);
  if (winner === color) return EVAL_INFINITY;
  if (winner === opponentColor) return -EVAL_INFINITY;

  let score = 0;

  const ballHolder = findBallHolder(board, color);
  if (ballHolder) {
    const { row } = getKeyCoordinates(ballHolder.cellKey);
    score += getAdvancement(row, color) * 100;

    const passes = classifyPasses(board, color);
    score += passes.forward * 25;
    score += passes.lateral * 10;
    score += passes.backward * 5;

    const totalPasses = passes.forward + passes.lateral + passes.backward;

    if (totalPasses === 0) score -= 80;
    else if (totalPasses === 1) score -= 25;
  }

  const chain = computePassingChain(board, color);
  score += chain.furthestAdvancement * 60;
  if (chain.reachesGoal) score += 150;

  score += countRelayPieces(board, color) * 20;

  score += countKnightMobility(board, color) * 3;

  const myPieces = findPieces(board, color);
  const opponentBallHolder = findBallHolder(board, opponentColor);
  const oppBallAdv = opponentBallHolder
    ? getAdvancement(getKeyCoordinates(opponentBallHolder.cellKey).row, opponentColor)
    : 0;
  const advWeight = oppBallAdv >= 4 ? 3 : 8;
  for (const { cellKey } of myPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score += getAdvancement(row, color) * advWeight;
  }

  if (opponentBallHolder) {
    const { row } = getKeyCoordinates(opponentBallHolder.cellKey);
    score -= getAdvancement(row, opponentColor) * 90;

    const oppPasses = classifyPasses(board, opponentColor);
    score -= oppPasses.forward * 22;
    score -= oppPasses.lateral * 9;
    score -= oppPasses.backward * 4;
  }

  const oppChain = computePassingChain(board, opponentColor);
  score -= oppChain.furthestAdvancement * 55;
  if (oppChain.reachesGoal) score -= 135;

  score += countBlockedLanes(board, color) * 12;

  const opponentPieces = findPieces(board, opponentColor);
  for (const { cellKey } of opponentPieces) {
    const { row } = getKeyCoordinates(cellKey);
    score -= getAdvancement(row, opponentColor) * 7;
  }

  const oppThreat = opponentDeliveryThreat(board, color);
  if (oppThreat === 0) score -= 500;
  else if (oppThreat === 1) score -= 300;
  else if (oppThreat === 2) score -= 150;
  else if (oppThreat === 3) score -= 60;

  const ourThreat = opponentDeliveryThreat(board, opponentColor);
  if (ourThreat === 0) score += 450;
  else if (ourThreat === 1) score += 250;
  else if (ourThreat === 2) score += 120;
  else if (ourThreat === 3) score += 50;

  if (opponentBallHolder) {
    const oppGoalRow = opponentColor === 'white' ? 0 : 7;

    const chainPieces = new Set([opponentBallHolder.cellKey]);
    let chainQueue = [opponentBallHolder.cellKey];
    while (chainQueue.length > 0) {
      const nextQueue = [];
      for (const ck of chainQueue) {
        const passes = getValidPasses(ck, opponentColor, board);
        for (const pt of passes) {
          if (!chainPieces.has(pt)) {
            chainPieces.add(pt);
            nextQueue.push(pt);
          }
        }
      }
      chainQueue = nextQueue;
    }

    for (const chainKey of chainPieces) {
      const { row: pRow, col: pCol } = getKeyCoordinates(chainKey);
      const goalDir = oppGoalRow > pRow ? 1 : (oppGoalRow < pRow ? -1 : 0);
      if (goalDir === 0) continue;

      const directions = [
        { dx: 0, dy: goalDir },
        { dx: 1, dy: goalDir }, { dx: -1, dy: goalDir },
      ];

      for (const { dx, dy } of directions) {
        let r = pRow + dy;
        let c = pCol + dx;
        while (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const target = board[toCellKey(r, c)];
          if (target) {
            if (target.color === color) {
              const pAdv = getAdvancement(pRow, opponentColor);
              score += 20 + pAdv * pAdv * 5;
            }
            break;
          }
          r += dy;
          c += dx;
        }
      }
    }
  }

  return score;
}

module.exports = {
  evaluateSimple,
  evaluateStandard,
  evaluateAdvanced,
};
