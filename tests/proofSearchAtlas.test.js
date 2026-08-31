/**
 * Proof-atlas persistence for scripts/proofSearch.js.
 *
 * Covers the two things that must never silently break:
 *  1. POV/distance conversion between root-relative proof scores and the
 *     side-to-move-relative store records (shared with the live engine).
 *  2. Soundness gating — only certified verdicts persist. Cutoff bounds in the
 *     wrong direction (lower-bound "loss", upper-bound "win") are NOT proofs.
 * Plus an end-to-end check that a run persists proofs and a rerun reuses them.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const {
  WIN_SCORE,
  isProvenScore,
  atlasRecToScore,
  provenPersistEntry,
} = require('../scripts/proofSearch');
const { openStore } = require('../utils/aiPositionStore');

const REPO_ROOT = path.join(__dirname, '..');

describe('proof atlas conversions', () => {
  it('round-trips a root-win through the store POV and back', () => {
    // Node 3 plies from root, black to move, white (root) forces a win 4 plies out.
    const score = WIN_SCORE - 7;
    const entry = provenPersistEntry(score, 'exact', 'black', 'white', 3);
    assert.deepStrictEqual(entry, { result: 'LOSS', distance: 4 });
    assert.strictEqual(atlasRecToScore(entry, 'black', 'white', 3), score);
  });

  it('round-trips a root-loss where the side to move is the winner', () => {
    // Node 2 plies from root, black to move, black beats the white root in 5.
    const score = -WIN_SCORE + 7;
    const entry = provenPersistEntry(score, 'exact', 'black', 'white', 2);
    assert.deepStrictEqual(entry, { result: 'WIN', distance: 5 });
    assert.strictEqual(atlasRecToScore(entry, 'black', 'white', 2), score);
  });

  it('store records are root-independent: same record read from the other POV', () => {
    // White wins in 4 with black to move. Stored as LOSS for black.
    const entry = { result: 'LOSS', distance: 4 };
    // Searcher rooted as white at distance 3: win score.
    assert.strictEqual(atlasRecToScore(entry, 'black', 'white', 3), WIN_SCORE - 7);
    // Searcher rooted as black at distance 2: the mirrored loss score.
    assert.strictEqual(atlasRecToScore(entry, 'black', 'black', 2), -WIN_SCORE + 6);
  });

  it('clamps distance to at least 1', () => {
    const entry = provenPersistEntry(WIN_SCORE - 3, 'exact', 'white', 'white', 3);
    assert.deepStrictEqual(entry, { result: 'WIN', distance: 1 });
  });
});

describe('proof atlas soundness gating', () => {
  it('persists a win from an exact or lower-bound score', () => {
    assert.ok(provenPersistEntry(WIN_SCORE - 5, 'exact', 'white', 'white', 0));
    assert.ok(provenPersistEntry(WIN_SCORE - 5, 'lower', 'white', 'white', 0));
  });

  it('persists a loss from an exact or upper-bound score', () => {
    assert.ok(provenPersistEntry(-WIN_SCORE + 5, 'exact', 'white', 'white', 0));
    assert.ok(provenPersistEntry(-WIN_SCORE + 5, 'upper', 'white', 'white', 0));
  });

  it('rejects wrong-direction bounds (cutoff artifacts, not proofs)', () => {
    // "At least a loss" proves nothing; "at most a win" proves nothing.
    assert.strictEqual(provenPersistEntry(-WIN_SCORE + 5, 'lower', 'white', 'white', 0), null);
    assert.strictEqual(provenPersistEntry(WIN_SCORE - 5, 'upper', 'white', 'white', 0), null);
  });

  it('rejects undecided scores regardless of flag', () => {
    for (const flag of ['exact', 'lower', 'upper']) {
      assert.strictEqual(provenPersistEntry(0, flag, 'white', 'white', 0), null);
    }
    assert.ok(!isProvenScore(0));
  });
});

describe('proof atlas end-to-end', () => {
  it('persists proofs on run 1 and chains onto them on run 2', () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proofatlas-')), 'atlas.db');
    const args = [
      'scripts/proofSearch.js',
      '--only', 'SANITY_immediate_win',
      '--maxDepth', '3',
      '--db', dbPath,
    ];

    const run1 = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.strictEqual(run1.status, 0, run1.stderr);
    assert.match(run1.stdout, /atlas: 0 proven positions loaded/);
    assert.match(run1.stdout, /PROVEN WIN/);

    const store = openStore(dbPath);
    const persistedCount = store.size();
    const rows = store.all();
    store.close();
    assert.ok(persistedCount > 0, 'run 1 should persist at least one proof');
    for (const row of rows) {
      assert.ok(['WIN', 'LOSS'].includes(row.result));
      assert.ok(row.distance >= 1);
    }

    const run2 = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.strictEqual(run2.status, 0, run2.stderr);
    assert.match(run2.stdout, /atlas: [1-9][\d,]* proven positions loaded/);
    assert.match(run2.stdout, /atlas hits [1-9]/);
    assert.match(run2.stdout, /PROVEN WIN/);
  });
});
