// Spike debug: what does Chromium's fake mic deliver? Usage: node scripts/pas-spike/mic-debug.mjs <wav> [channel]
import { chromium } from 'playwright'
import { serveDir } from '../../src/lib/serve.js'
const srv = await serveDir('out/pas-spike/lb/site')
const file = process.argv[2]
const browser = await chromium.launch({ channel: process.argv[3] || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.goto(srv.url + 'manifest.json')
const r = await page.evaluate(async () => {
  const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const t = s.getAudioTracks()[0]
  const rec = new MediaRecorder(s)
  const parts = []
  const blobs = []
  rec.ondataavailable = (e) => { parts.push(e.data.size); blobs.push(e.data) }
  rec.start(250)
  const ctx = new AudioContext()
  const an = ctx.createAnalyser()
  ctx.createMediaStreamSource(s).connect(an)
  await new Promise((ok) => setTimeout(ok, 4000))
  const buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf)
  let e = 0; for (const v of buf) e += v * v
  rec.stop(); await new Promise((ok) => setTimeout(ok, 300))
  let decoded = null
  try {
    const ab = await new Blob(blobs, { type: rec.mimeType }).arrayBuffer()
    const a = await new AudioContext().decodeAudioData(ab)
    const d = a.getChannelData(0); let q = 0, mx = 0; for (const v of d) { q += v * v; mx = Math.max(mx, Math.abs(v)) }
    decoded = { dur: a.duration, rate: a.sampleRate, rms: Math.sqrt(q / d.length), max: mx }
  } catch (err) { decoded = String(err) }
  return { decoded, label: t.label, state: t.readyState, muted: t.muted, settings: t.getSettings(), ctxState: ctx.state, rate: ctx.sampleRate, analyserRms: Math.sqrt(e / buf.length), mime: rec.mimeType, parts, secure: isSecureContext }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
await srv.close()
