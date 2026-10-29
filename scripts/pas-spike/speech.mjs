// Spike test 1: scripted voices through the BROWSER path. For each phrase WAV, Chromium's fake mic plays it; the page
// records with an AudioContext, encodes 16 kHz mono WAV in the page (src/stages/pas/wav.js), POSTs it to the local
// /__pas/api/transcribe, which forwards to muse-voice-transcribe-1.0. Then the transcript is routed.
// Usage: node scripts/pas-spike/speech.mjs [phrasesDir] [appDir]
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { chromium } from 'playwright'
import { loadDotEnv } from '../../src/config.js'
import { startPasServer } from '../../src/stages/pas/server.js'
import { routeIntent } from '../../src/stages/pas/route.js'

loadDotEnv()
const dir = resolve(process.argv[2] || 'out/pas-spike/phrases')
const appDir = process.argv[3] || 'out/pas-spike/lb/site'
const PHRASES = {
  a: { text: 'This label is too light. Make it readable, keep our gray.', voice: 'Samantha 180', route: 'contrast', keys: [/light|readab/i] },
  b: { text: 'Give every control a visible focus ring in our blue.', voice: 'Daniel 200', route: 'focus', keys: [/focus/i, /blue/i] },
  c: { text: "Make this text darker so it's easier to read.", voice: 'Karen 220', route: 'contrast', keys: [/darker|read/i] },
  d: { text: "I can't see where the keyboard focus is.", voice: 'Moira 170', route: 'focus', keys: [/keyboard|focus/i] },
  e: { text: 'Make these buttons our brand blue.', voice: 'Fred 210', route: 'muse', keys: [/button/i, /blue/i] },
  f: { text: 'This label is too light. Make it readable, keep our gray. (+ pink noise, -20 dBFS)', voice: 'Samantha 180 + noise', route: 'contrast', keys: [/light|readab/i] },
}
const wavMs = (f) => { const b = readFileSync(f); return Math.round(((b.length - 44) / b.readUInt32LE(28)) * 1000) } // ffmpeg adds a LIST chunk; close enough

const server = await startPasServer({ appDir, log: (s) => console.log('  server', s) })
const rows = []
for (const [id, ph] of Object.entries(PHRASES)) {
  const file = `${dir}/${id}.wav`
  const ms = wavMs(file)
  const browser = await chromium.launch({ channel: process.env.PAS_CHANNEL || 'chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  await page.goto(server.url, { waitUntil: 'domcontentloaded' })
  const r = await page.evaluate(async (recMs) => {
    const m = await import('/__pas/wav.js')
    const t0 = performance.now()
    const rec = await m.recordWav({ maxMs: recMs })
    const out = await rec.result
    const t1 = performance.now()
    const res = await fetch('/__pas/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: out.wav })
    const body = await res.json()
    return { status: res.status, ...body, recordMs: Math.round(t1 - t0), roundTripMs: Math.round(performance.now() - t1), wavBytes: out.wav.length, captureRate: out.rate, rms: out.rms, chunks: out.wav.length }
  }, ms)
  await browser.close()
  const route = routeIntent(r.transcript)
  const ok = r.status === 200 && route.route === ph.route && ph.keys.every((k) => k.test(r.transcript || ''))
  rows.push({ id, voice: ph.voice, said: ph.text, transcript: r.transcript || r.error, route: route.route, expected: ph.route, intentOk: ok, asrMs: r.ms, roundTripMs: r.roundTripMs, recordMs: r.recordMs, captureRate: r.captureRate, wavBytes: r.wavBytes })
  console.log(`${id} ${ok ? 'OK ' : 'BAD'} [${route.route}] asr ${r.ms} ms, round trip ${r.roundTripMs} ms, captured at ${r.captureRate} Hz rms ${r.rms && r.rms.toFixed(4)} bytes ${r.wavBytes}: ${r.transcript || r.error}`)
}
await server.close()
const pass = rows.filter((r) => r.intentOk).length
console.log(`intent survived: ${pass} of ${rows.length} (pass = 5)`)
writeFileSync('out/pas-spike/speech.json', JSON.stringify({ pass, of: rows.length, rows }, null, 2))
