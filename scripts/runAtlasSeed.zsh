#!/bin/zsh
# Atlas seeding run 1 (2026-08-31) — program step 4 with the upgraded engine
# (persistent atlas + bound-flagged TT + killer ordering).
#
# Launch DETACHED so it survives session kills (see PROOF_SEARCH_NOTES):
#   nohup caffeinate -dimsu zsh scripts/runAtlasSeed.zsh > /dev/null 2>&1 & disown
#   echo $! > data/selfplay/atlas_seed.pid
#
# REQUIRES AC POWER. caffeinate does not survive lid-close on battery.
#
# Phase 1: walk-backs for all 5 real games, late->early so each proof seeds
#          the atlas for the earlier (harder) snapshots. Stop a game's walk
#          after 3 consecutive undecided (dead-zone boundary passed).
# Phase 2: the 5 real-win fixtures at d12, 1h each.
# Phase 3: BEN_blackPenult_d4e2 at d9, 4h — the strongest known defense.

set -u
cd "$(dirname "$0")/.."
LOG=data/selfplay/atlas_seed_run1.log

echo "=== ATLAS SEED RUN 1 start $(date) ===" >> $LOG

for g in 77e1f2 ce0f5f a822c5 b33b02 b36806; do
  echo "--- walkback $g $(date) ---" >> $LOG
  node --max-old-space-size=10240 scripts/proofSearch.js \
    --fixtures data/selfplay/walkback_$g.json \
    --timeLimitMs 900000 --stopAfterUndecided 3 >> $LOG 2>&1
  echo "walkback $g exit=$? $(date)" >> $LOG
done

echo "--- winFixtures d12 $(date) ---" >> $LOG
node --max-old-space-size=10240 scripts/proofSearch.js \
  --fixtures scripts/winFixtures.json \
  --maxDepth 12 --timeLimitMs 3600000 >> $LOG 2>&1
echo "winFixtures exit=$? $(date)" >> $LOG

echo "--- ben_hypothesis d9 $(date) ---" >> $LOG
node --max-old-space-size=10240 scripts/proofSearch.js \
  --fixtures data/selfplay/ben_hypothesis_d9.json \
  --timeLimitMs 14400000 >> $LOG 2>&1
echo "ben exit=$? $(date)" >> $LOG

echo "=== ATLAS SEED RUN 1 done $(date) ===" >> $LOG
