#!/bin/zsh
# BEN_blackPenult_d4e2 dedicated d9+ probe (2026-09-01) — post-seed-run follow-up.
# Same engine config as atlas seed run 1; atlas now holds ~5.3M v2 proofs.
# Fixture pins maxDepth 11; the 12h time budget is the binding constraint.
#
# Launch DETACHED so it survives session kills:
#   nohup caffeinate -dimsu zsh scripts/runBenD11.zsh > /dev/null 2>&1 & disown
#   echo $! > data/selfplay/ben_d11.pid
#
# REQUIRES AC POWER. caffeinate does not survive lid-close on battery.

set -u
cd "$(dirname "$0")/.."
LOG=data/selfplay/ben_d11_run.log

echo "=== BEN d11 run start $(date) ===" >> $LOG
node --max-old-space-size=10240 scripts/proofSearch.js \
  --fixtures data/selfplay/ben_hypothesis_d11.json \
  --timeLimitMs 43200000 >> $LOG 2>&1
echo "ben d11 exit=$? $(date)" >> $LOG
echo "=== BEN d11 run done $(date) ===" >> $LOG
