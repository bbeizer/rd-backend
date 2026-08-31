/**
 * Persisted position store — ground-truth TT for proven wins/losses.
 *
 * Only stores positions where search has proven the outcome (|score| ≈ ±INFINITY).
 * Heuristic scores live in the per-move in-process TT and are not persisted.
 *
 * Key = hashBoard(board) + '|' + sideToMove. Uniqueness is by construction;
 * hashBoard is a canonical serialization, not a compressed hash.
 *
 * Conflict policy: keep the entry with the shortest distance-to-terminal, so
 * subsequent lookups pick the fastest proven win and avoid the fastest proven loss.
 *
 * Game versioning: a "proof" is only immortal relative to the rules it was
 * searched under. game_version 1 = the reduced turn grammar (no pass-then-move
 * turns — see Step 0, fixed 2026-07-08); those verdicts are unsound under real
 * rules and are excluded from all reads. game_version 2 = full
 * pass→move→pass grammar. Bump CURRENT_GAME_VERSION whenever the move
 * generator's turn grammar changes; stale-version rows become invisible and
 * are replaced on the next write to the same position.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'positions.db');
const CURRENT_GAME_VERSION = 2;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS positions (
    hash         TEXT    PRIMARY KEY,
    result       TEXT    NOT NULL CHECK (result IN ('WIN', 'LOSS')),
    distance     INTEGER NOT NULL,
    best_move    TEXT,
    source       TEXT    NOT NULL,
    game_version INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_positions_source ON positions(source);
  CREATE INDEX IF NOT EXISTS idx_positions_distance ON positions(distance);
`;

function openStore(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA_SQL);

  // Reads only see current-rules proofs; stale-version rows are dead weight
  // kept solely so their replacement is observable (and purgeable).
  const getStmt = db.prepare(`SELECT hash, result, distance, best_move, source, game_version, created_at FROM positions WHERE hash = ? AND game_version = ${CURRENT_GAME_VERSION}`);

  // Upsert that only overwrites when the new entry has a strictly shorter distance.
  // This encodes "shortest proven path wins" for both wins (faster mate) and losses
  // (earliest-loss awareness). Behavior when result flips for the same hash at the
  // same distance is intentionally "first write wins" — that case shouldn't happen
  // for a correct search and would indicate a hashing/collision bug.
  // A version bump always overwrites: an old-rules row must never block a
  // current-rules proof, whatever its distance claims.
  const putStmt = db.prepare(`
    INSERT INTO positions (hash, result, distance, best_move, source, game_version, created_at)
    VALUES (@hash, @result, @distance, @best_move, @source, @game_version, @created_at)
    ON CONFLICT(hash) DO UPDATE SET
      result       = excluded.result,
      distance     = excluded.distance,
      best_move    = excluded.best_move,
      source       = excluded.source,
      game_version = excluded.game_version,
      created_at   = excluded.created_at
    WHERE excluded.game_version != positions.game_version
       OR excluded.distance < positions.distance
  `);

  const sizeStmt = db.prepare(`SELECT COUNT(*) AS c FROM positions WHERE game_version = ${CURRENT_GAME_VERSION}`);
  // Lean row shape on purpose: this is the bulk-load path for in-memory atlases
  // (proof search loads every row at startup); bestMove/source/etc. stay on get().
  const allStmt = db.prepare(`SELECT hash, result, distance FROM positions WHERE game_version = ${CURRENT_GAME_VERSION}`);

  const putMany = db.transaction((entries) => {
    for (const e of entries) putOne(e);
  });

  function putOne(entry) {
    putStmt.run({
      hash: entry.hash,
      result: entry.result,
      distance: entry.distance,
      best_move: entry.bestMove ? JSON.stringify(entry.bestMove) : null,
      source: entry.source || 'search',
      game_version: entry.gameVersion || CURRENT_GAME_VERSION,
      created_at: entry.createdAt || Date.now(),
    });
  }

  return {
    db,
    dbPath,
    get(hash) {
      const row = getStmt.get(hash);
      if (!row) return null;
      return {
        hash: row.hash,
        result: row.result,
        distance: row.distance,
        bestMove: row.best_move ? JSON.parse(row.best_move) : null,
        source: row.source,
        gameVersion: row.game_version,
        createdAt: row.created_at,
      };
    },
    put(entry) { putOne(entry); },
    putMany(entries) { putMany(entries); },
    all() { return allStmt.all(); },
    size() { return sizeStmt.get().c; },
    close() { db.close(); },
  };
}

module.exports = {
  openStore,
  DEFAULT_DB_PATH,
  SCHEMA_SQL,
  CURRENT_GAME_VERSION,
};
