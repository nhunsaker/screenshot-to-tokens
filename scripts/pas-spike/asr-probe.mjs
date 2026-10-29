// Spike probe: ASR response shape, and whether the ASR endpoint accepts `store: false` in its request part.
import { readFileSync } from 'fs'
import { loadDotEnv } from '../../src/config.js'
loadDotEnv()
const wav = readFileSync(process.argv[2] || '/Users/nobrien/workspace/metatoy/screenshot-to-tokens/out/testA/say.wav')
for (const extra of [{ store: false }, {}]) {
  const req = { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', sampleRateHertz: 16000, ...extra }
  const f = new FormData()
  f.append('request', new Blob([JSON.stringify(req)], { type: 'application/json' }))
  f.append('audio', new Blob([wav], { type: 'audio/wav' }), 'say.wav')
  const t0 = Date.now()
  const res = await fetch('https://api.meta.ai/v1/asr/transcribe', { method: 'POST', headers: { authorization: `Bearer ${process.env.META_API_KEY}` }, body: f })
  console.log(JSON.stringify(extra), res.status, Date.now() - t0, 'ms', (await res.text()).slice(0, 500))
}
