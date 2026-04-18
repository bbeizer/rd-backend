const { describe, it } = require('node:test');
const assert = require('node:assert');
const { openStore } = require('../utils/aiPositionStore');

function freshStore() {
  return openStore(':memory:');
}

describe('aiPositionStore', () => {
  describe('put / get roundtrip', () => {
    it('stores and retrieves a proven win', () => {
      const store = freshStore();
      store.put({
        hash: 'W*d7Bc6|WHITE',
        result: 'WIN',
        distance: 5,
        bestMove: { from: 'd7', to: 'd8' },
        source: 'search',
      });
      const got = store.get('W*d7Bc6|WHITE');
      assert.strictEqual(got.result, 'WIN');
      assert.strictEqual(got.distance, 5);
      assert.deepStrictEqual(got.bestMove, { from: 'd7', to: 'd8' });
      assert.strictEqual(got.source, 'search');
      store.close();
    });

    it('returns null for missing hash', () => {
      const store = freshStore();
      assert.strictEqual(store.get('nonexistent'), null);
      store.close();
    });
  });

  describe('shorter-distance conflict policy', () => {
    it('overwrites when new distance is shorter', () => {
      const store = freshStore();
      store.put({ hash: 'h1', result: 'WIN', distance: 10, source: 'search' });
      store.put({ hash: 'h1', result: 'WIN', distance: 3, bestMove: { from: 'a', to: 'b' }, source: 'retrograde' });
      const got = store.get('h1');
      assert.strictEqual(got.distance, 3);
      assert.strictEqual(got.source, 'retrograde');
      assert.deepStrictEqual(got.bestMove, { from: 'a', to: 'b' });
      store.close();
    });

    it('preserves existing when new distance is longer', () => {
      const store = freshStore();
      store.put({ hash: 'h2', result: 'WIN', distance: 4, source: 'search' });
      store.put({ hash: 'h2', result: 'WIN', distance: 9, source: 'retrograde' });
      const got = store.get('h2');
      assert.strictEqual(got.distance, 4);
      assert.strictEqual(got.source, 'search');
      store.close();
    });

    it('preserves existing when new distance is equal (no-op)', () => {
      const store = freshStore();
      store.put({ hash: 'h3', result: 'WIN', distance: 5, source: 'first' });
      store.put({ hash: 'h3', result: 'LOSS', distance: 5, source: 'second' });
      const got = store.get('h3');
      assert.strictEqual(got.distance, 5);
      assert.strictEqual(got.source, 'first');
      assert.strictEqual(got.result, 'WIN');
      store.close();
    });
  });

  describe('putMany (transactional batch)', () => {
    it('inserts all entries atomically', () => {
      const store = freshStore();
      store.putMany([
        { hash: 'a', result: 'WIN', distance: 1, source: 'seed' },
        { hash: 'b', result: 'LOSS', distance: 2, source: 'seed' },
        { hash: 'c', result: 'WIN', distance: 3, source: 'seed' },
      ]);
      assert.strictEqual(store.size(), 3);
      assert.strictEqual(store.get('a').result, 'WIN');
      assert.strictEqual(store.get('b').result, 'LOSS');
      assert.strictEqual(store.get('c').distance, 3);
      store.close();
    });
  });

  describe('size()', () => {
    it('returns zero on empty store', () => {
      const store = freshStore();
      assert.strictEqual(store.size(), 0);
      store.close();
    });

    it('counts distinct hashes, not writes', () => {
      const store = freshStore();
      store.put({ hash: 'x', result: 'WIN', distance: 10, source: 's' });
      store.put({ hash: 'x', result: 'WIN', distance: 2,  source: 's' });
      store.put({ hash: 'y', result: 'LOSS', distance: 5, source: 's' });
      assert.strictEqual(store.size(), 2);
      store.close();
    });
  });

  describe('schema constraints', () => {
    it('rejects invalid result values', () => {
      const store = freshStore();
      assert.throws(() => {
        store.put({ hash: 'z', result: 'DRAW', distance: 1, source: 's' });
      }, /CHECK constraint failed/);
      store.close();
    });
  });
});
