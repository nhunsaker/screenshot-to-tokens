#!/bin/zsh
# Local Llama namer test: pull llama3.2:3b (about 2 GB), run the fixture with S2T_NAMER=ollama, score it,
# stop Ollama. Heavy for this Mac (GPU + a 2 GB download), so it only runs in the heavy window
# (00:00-06:00 CDT) unless you pass --granted.
set -euo pipefail
cd "$(dirname "$0")/.."
hour=$(date +%H)
if [[ "${1:-}" != "--granted" && "$hour" -ge 6 ]]; then
  echo "Outside the 00:00-06:00 heavy window (now $(date +%H:%M)). Re-run with --granted if you have a window." >&2
  exit 2
fi
# Large model files live on the SanDisk, never the internal disk (18 GB free). Refuse if it isn't mounted.
models_dir=${S2T_MODELS_DIR:-/Volumes/SanDisk/models}
if [[ ! -d "$models_dir" ]]; then echo "Model storage $models_dir not mounted; not downloading to the internal disk." >&2; exit 3; fi
export OLLAMA_MODELS="$models_dir/ollama"
model=${OLLAMA_MODEL:-llama3.2:3b}
started=0
if curl -s -m 2 localhost:11434/api/tags >/dev/null; then
  echo "An Ollama server is already running and may store models on the internal disk. Stop it first so this run uses $OLLAMA_MODELS." >&2; exit 4
fi
ollama serve >"${TMPDIR:-/tmp}/s2t-ollama.log" 2>&1 &
started=1
for i in {1..30}; do curl -s -m 1 localhost:11434/api/tags >/dev/null && break; sleep 1; done
ollama pull "$model"
run=out/acme-shop-ollama
S2T_NAMER=ollama OLLAMA_MODEL="$model" node src/cli.js run --fixture acme-shop --run "$run"
node src/cli.js eval --fixture acme-shop --run "$run" | tee "$run/eval.txt"
if grep -q '"namer": "mock-heuristic"' "$run/tokens.json"; then
  echo "WARNING: the Ollama namer failed; the heuristic fallback produced these tokens (see warnings in tokens.json)"
fi
if [[ $started -eq 1 ]]; then pkill -f "ollama serve" || true; fi
