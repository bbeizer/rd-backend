/**
 * Glue between minimax and the persisted position store.
 *
 * Controlled by two env flags so behavior is opt-in:
 *   PERSIST_TT_READ=1   — minimax consults the store for proven results
 *   PERSIST_TT_WRITE=1  — makeAIMove writes root-level proofs back
 *
 * Both default off: tests, dev, and the current prod engine are unchanged until
 * the flags are set. Flip either off to instantly disable that direction.
 *
 * Only proven positions (|score| ≈ ±INFINITY) are persisted. Heuristic scores
 * live in the per-move in-process TT and do not leak into the DB.
 */

const { openStore } = require('./aiPositionStore');

const READ_ENABLED = process.env.PERSIST_TT_READ === '1';
const WRITE_ENABLED = process.env.PERSIST_TT_WRITE === '1';

let storeInstance = null;

function getStore() {
  if (!READ_ENABLED && !WRITE_ENABLED) return null;
  if (!storeInstance) storeInstance = openStore();
  return storeInstance;
}

/** Canonical key for the persisted store: hash + side whose turn it is. */
function persistKey(boardHash, sideToMove) {
  return boardHash + '|' + sideToMove;
}

function persistLookup(boardHash, sideToMove) {
  if (!READ_ENABLED) return null;
  const store = getStore();
  if (!store) return null;
  return store.get(persistKey(boardHash, sideToMove));
}

function persistWrite(entry) {
  if (!WRITE_ENABLED) return;
  const store = getStore();
  if (!store) return;
  try {
    store.put(entry);
  } catch (e) {
    // A persist failure must never kill an in-flight game.
    console.warn('[persistTT] write failed:', e.message);
  }
}

function closeStore() {
  if (storeInstance) {
    storeInstance.close();
    storeInstance = null;
  }
}

module.exports = {
  persistLookup,
  persistWrite,
  persistKey,
  closeStore,
  READ_ENABLED,
  WRITE_ENABLED,
};
