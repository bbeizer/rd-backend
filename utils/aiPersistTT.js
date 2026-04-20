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

// Flags are read at call time (not at require time) so tests can toggle them
// with process.env.PERSIST_TT_* mid-run, and so a deploy can flip writes off
// via a simple env change + process signal.
function readEnabled() { return process.env.PERSIST_TT_READ === '1'; }
function writeEnabled() { return process.env.PERSIST_TT_WRITE === '1'; }

let storeInstance = null;
let storeInstancePath = null;

function getStore() {
  if (!readEnabled() && !writeEnabled()) return null;
  // Allow tests to point at a different DB (e.g. a tmp file) via env.
  const desiredPath = process.env.PERSIST_TT_DB || null;
  if (storeInstance && desiredPath !== storeInstancePath) {
    storeInstance.close();
    storeInstance = null;
  }
  if (!storeInstance) {
    storeInstance = desiredPath ? openStore(desiredPath) : openStore();
    storeInstancePath = desiredPath;
  }
  return storeInstance;
}

/** Canonical key for the persisted store: hash + side whose turn it is. */
function persistKey(boardHash, sideToMove) {
  return boardHash + '|' + sideToMove;
}

function persistLookup(boardHash, sideToMove) {
  if (!readEnabled()) return null;
  const store = getStore();
  if (!store) return null;
  return store.get(persistKey(boardHash, sideToMove));
}

function persistWrite(entry) {
  if (!writeEnabled()) return;
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
    storeInstancePath = null;
  }
}

module.exports = {
  persistLookup,
  persistWrite,
  persistKey,
  closeStore,
  readEnabled,
  writeEnabled,
};
