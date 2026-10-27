#!/bin/zsh
# L3: the recorded demo runs. Muse Spark Open on Baseten names the tokens (3 to 4 s instead of 15 to 25 s hosted;
# same eval, docs/f17-hosted-vs-open.md). Warms the endpoint first, then runs the three demo apps end to end, uncached,
# and prints the timing table. Hosted Muse Spark stays one switch away: S2T_NAMER=meta zsh scripts/demo-runs.sh
#   zsh scripts/demo-runs.sh [argon build] [lightbootstrap build] [agency dist]
set -u
cd "$(dirname "$0")/.."
export S2T_SEGMENTER=hybrid S2T_NAMER=${S2T_NAMER:-baseten} S2T_CACHE=0
APPS=/Volumes/SanDisk/s2t-demo-apps
ARGON=${1:-$APPS/argon/build} LIGHT=${2:-$APPS/lightbootstrap/build} AGENCY=${3:-$APPS/agency/dist}
node scripts/warm-namer.mjs || exit 1
node src/cli.js run --serve "$ARGON" --target "$ARGON/static/css" --run out/demo-argon-$S2T_NAMER
node src/cli.js run --serve "$LIGHT" --target "$LIGHT/static/css" --run out/demo-lightbootstrap-$S2T_NAMER
node src/cli.js run --serve "$AGENCY" --target "$AGENCY/css" --run out/demo-agency-$S2T_NAMER
node scripts/latency-stats.mjs out/demo-*-$S2T_NAMER
