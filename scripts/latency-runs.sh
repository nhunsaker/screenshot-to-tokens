#!/bin/zsh
# F19 statistics: 5 uncached runs of each real demo app, then a median / p90 table (out/latency-table.md).
# Costs about $0.03 per run with the default low-effort naming (about $0.50 total). Run from the repo root:
#   zsh scripts/latency-runs.sh <argon build dir> <lightbootstrap build dir> <agency dist dir>
set -u
cd "$(dirname "$0")/.."
export S2T_SEGMENTER=hybrid S2T_NAMER=meta S2T_CACHE=0
ARGON=$1 LIGHT=$2 AGENCY=$3
for n in 1 2 3 4 5; do
  node src/cli.js run --serve "$ARGON" --target "$ARGON/static/css" --run out/lat-argon-$n > /dev/null 2>&1
  node src/cli.js run --serve "$LIGHT" --target "$LIGHT/static/css" --run out/lat-lightbootstrap-$n > /dev/null 2>&1
  node src/cli.js run --serve "$AGENCY" --target "$AGENCY/css" --run out/lat-agency-$n > /dev/null 2>&1
  echo "round $n done $(date +%H:%M:%S)"
done
node scripts/latency-stats.mjs out/lat-* > out/latency-table.md
echo DONE
