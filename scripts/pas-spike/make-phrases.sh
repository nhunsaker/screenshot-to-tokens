#!/bin/sh
# Spike: six scripted phrases with macOS `say` (varied voices + rates), as 48 kHz mono WAV for Chromium's fake mic.
# 0.6 s of lead-in and 1.2 s of trailing silence so the fake device's loop boundary is quiet.
# (f) = phrase (a) mixed with pink noise at about -20 dBFS RMS (speech is about -18 dBFS mean).
set -e
OUT=${1:-out/pas-spike/phrases}
mkdir -p "$OUT"
gen() { # id voice rate text
  say -v "$2" -r "$3" -o "$OUT/$1.aiff" "$4"
  ffmpeg -loglevel error -y -i "$OUT/$1.aiff" -af "adelay=600,apad=pad_dur=1.2" -ar 48000 -ac 1 -c:a pcm_s16le "$OUT/$1.wav"
  rm "$OUT/$1.aiff"
}
gen a Samantha 180 "This label is too light. Make it readable, keep our gray."
gen b Daniel 200 "Give every control a visible focus ring in our blue."
gen c Karen 220 "Make this text darker so it's easier to read."
gen d Moira 170 "I can't see where the keyboard focus is."
gen e Fred 210 "Make these buttons our brand blue."
ffmpeg -loglevel error -y -i "$OUT/a.wav" -f lavfi -i "anoisesrc=color=pink:amplitude=0.5:sample_rate=48000" \
  -filter_complex "[1:a]volume=1[n];[0:a][n]amix=inputs=2:duration=first:normalize=0" -ar 48000 -ac 1 -c:a pcm_s16le "$OUT/f.wav"
for f in "$OUT"/*.wav; do printf '%s ' "$f"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done
