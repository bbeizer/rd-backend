/**
 * Resolve atomic-eval weights for the impossible_atomic difficulty.
 *
 * Order of precedence:
 *   1. AI_ATOMIC_WEIGHTS_PATH env → JSON file on disk (loaded once at require).
 *   2. DEFAULT_ATOMIC_WEIGHTS (all zeros) — useful for unit tests and as the
 *      "untrained" baseline.
 *
 * Loaded weights are shape-checked against DEFAULT_ATOMIC_WEIGHTS: any key in
 * the file that isn't in defaults is ignored (forward-compat), and any default
 * key missing from the file gets 0. This keeps the eval robust to mid-training
 * shape drift.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_ATOMIC_WEIGHTS } = require('./aiAtomicEval');

function loadWeightsFromPath(p) {
  const absolute = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  const raw = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(raw);
  const merged = { ...DEFAULT_ATOMIC_WEIGHTS };
  let applied = 0;
  for (const key of Object.keys(merged)) {
    if (typeof parsed[key] === 'number') {
      merged[key] = parsed[key];
      applied++;
    }
  }
  console.log(`[aiAtomicWeights] loaded ${applied}/${Object.keys(merged).length} weights from ${absolute}`);
  return merged;
}

let cached = null;
function getAtomicWeights() {
  if (cached) return cached;
  const p = process.env.AI_ATOMIC_WEIGHTS_PATH;
  cached = p ? loadWeightsFromPath(p) : DEFAULT_ATOMIC_WEIGHTS;
  return cached;
}

module.exports = { getAtomicWeights, loadWeightsFromPath };
