#!/usr/bin/env node
// Transcribe the founder's VO recordings (16 kHz mono WAVs in out/video/founder/wav16/) with Meta's speech model
// (muse-voice-transcribe-1.0, store:false, src/stages/pas/transcribe.js). The endpoint takes at most 12 s per call, so
// each file is cut into chunks of up to 11 s at its pauses (silencedetect -35 dB, 0.25 s). Writes
// out/video/founder/transcripts.json {file: {dur, text, chunks:[{start,end,text}]}}. The narration is public-class
// data (published on YouTube); the key comes from the Keychain via loadDotEnv and is never printed.
//   node scripts/founder-transcribe.mjs [names...]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { execFileSync, spawnSync } from 'child_process'
import { join } from 'path'
import { loadDotEnv } from '../src/config.js'
import { transcribe } from '../src/stages/pas/transcribe.js'

loadDotEnv()
const DIR = 'out/video/founder/wav16', OUT = 'out/video/founder/transcripts.json', TMP = 'out/video/founder/chunk.wav'
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()
function silences(f) {
  const e = spawnSync('ffmpeg', ['-i', f, '-af', 'silencedetect=n=-35dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf-8' }).stderr
  const s = [...e.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]), t = [...e.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1])
  return s.map((a, i) => [a, t[i] ?? dur(f)])
}
function cuts(f, D) {
  const mids = silences(f).map(([a, b]) => (a + b) / 2)
  const out = []; let at = 0
  while (D - at > 11) {
    const c = mids.filter((m) => m > at + 1 && m <= at + 11).pop() ?? at + 11
    out.push([at, c]); at = c
  }
  out.push([at, D]); return out
}
const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(DIR).filter((f) => f.endsWith('.wav')).map((f) => f.replace(/\.wav$/, ''))
for (const n of names) {
  const f = join(DIR, `${n}.wav`), D = dur(f), chunks = []
  for (const [a, b] of cuts(f, D)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(a), '-t', String(b - a), '-i', f, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', TMP])
    const wav = readFileSync(TMP)
    let text = ''
    try { text = (await transcribe(new Uint8Array(wav))).transcript } catch (e) { text = `[error: ${String(e.message).slice(0, 80)}]` }
    chunks.push({ start: +a.toFixed(2), end: +b.toFixed(2), text })
  }
  done[n] = { dur: D, text: chunks.map((c) => c.text).join(' ').trim(), chunks }
  console.log(`${n} (${D.toFixed(1)} s): ${done[n].text}`)
  writeFileSync(OUT, JSON.stringify(done, null, 1))
}
