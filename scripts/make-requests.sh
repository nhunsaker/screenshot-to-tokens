#!/bin/sh
# The v3 cut's two spoken Point and say requests (ElevenLabs Michael, made by
# `node scripts/gen-vo.mjs out/video/req/lines.json out/video/req EK4IAYGwCrQUchP03Yjp`) as 16 kHz mono WAVs for
# Chromium's fake mic: 0.6 s of lead-in and 1.5 s of trailing silence so the fake device's loop boundary is quiet.
#   sh scripts/make-requests.sh [out/video/req]
set -e
D=${1:-out/video/req}
for i in 1 2; do
  ffmpeg -loglevel error -y -i "$D/vo-$i.mp3" -af "adelay=600,apad=pad_dur=1.5" -ar 16000 -ac 1 -c:a pcm_s16le "$D/req-$i.wav"
done
for f in "$D"/req-*.wav; do printf '%s ' "$f"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done
