#!/bin/zsh
# Experiment chain: wait for the running 77e1f2 walk-back, then walk back the
# other 4 human wins, then run the perturbation sweep on the fixture-1 seed.
# Keeps at most one experiment process alive at a time (the verification run
# is a separate process). Launch detached:
#   nohup caffeinate -dimsu zsh scripts/runExperimentChain.zsh >> data/selfplay/experiment_chain.log 2>&1 & disown

cd "$(dirname "$0")/.."

echo "[chain] started at $(date)"

# 1. Wait for the in-flight 77e1f2 walk-back (if any)
if [[ -f data/selfplay/walkback.pid ]]; then
  WPID=$(cat data/selfplay/walkback.pid)
  while kill -0 "$WPID" 2>/dev/null; do sleep 60; done
  echo "[chain] 77e1f2 walk-back done at $(date)"
fi

# 2. Walk-backs for the remaining 4 games, sequentially
for id in ce0f5f a822c5 b33b02 b36806; do
  echo "[chain] walk-back $id starting at $(date)"
  node --max-old-space-size=6144 scripts/proofSearch.js \
    --fixtures data/selfplay/walkback_${id}.json \
    --timeLimitMs 1800000 --stopAfterUndecided 2 \
    >> data/selfplay/proof_walkback_${id}.log 2>&1
  echo "[chain] walk-back $id exited $? at $(date)"
done

# 3. Perturbation sweep on the fixture-1 proven seed
echo "[chain] perturbation sweep starting at $(date)"
node --max-old-space-size=6144 scripts/proofSearch.js \
  --fixtures data/selfplay/perturb_REAL_77e1f2_T9of15.json \
  --timeLimitMs 300000 \
  >> data/selfplay/perturb_77e1f2_T9.log 2>&1
echo "[chain] perturbation sweep exited $? at $(date)"

echo "[chain] all experiments done at $(date)"
