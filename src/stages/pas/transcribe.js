// Point and say: speech -> text with Meta's muse-voice-transcribe-1.0 (POST /v1/asr/transcribe, multipart: a JSON
// `request` part + an `audio` part). Format checked live 2026-10-26; `store: false` in the request part is accepted
// (200, checked 2026-10-28). The key stays in the server process. Data: scripted/synthetic or the founder's own speech.
import { readWavHeader, ASR_RATE } from './wav.js'
import { externalSignal } from '../../lib/timeout.js'

export const ASR_MODEL = 'muse-voice-transcribe-1.0'
export const MAX_WAV_BYTES = 44 + ASR_RATE * 2 * 12 // 12 s of 16 kHz mono 16-bit (the page caps at 10 s)

/** The JSON `request` part. Uppercase "WAV" (lowercase is rejected as malformed). */
export function asrRequest(o = {}) {
  const model = o.model || process.env.META_ASR_MODEL || ASR_MODEL
  if (/-contributor$/i.test(model)) throw new Error('refusing a "-contributor" ASR model id')
  return { model, audioEncoding: 'WAV', sampleRateHertz: o.sampleRateHertz || ASR_RATE, store: false }
}

/** Check a WAV body before forwarding: PCM, mono, 16-bit, 16 kHz, not too long. Returns an error string or null. */
export function checkWav(bytes) {
  if (!bytes || !bytes.length) return 'empty audio'
  if (bytes.length > MAX_WAV_BYTES) return 'audio too long (max 12 s)'
  const h = readWavHeader(bytes)
  if (!h) return 'not a WAV file'
  if (h.format !== 1 || h.channels !== 1 || h.bits !== 16 || h.sampleRate !== ASR_RATE) return `need 16 kHz mono 16-bit PCM WAV (got ${h.sampleRate} Hz, ${h.channels} ch, ${h.bits} bit)`
  return null
}

/** Clean transcript text: trims, collapses whitespace and the doubled trailing period the API sometimes returns. */
export function cleanTranscript(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/\.{2,}$/, '.').slice(0, 400)
}

/**
 * Forward a WAV to the ASR endpoint. Returns {transcript, ms, audioMs}.
 * @param {Uint8Array} wav
 * @param {{apiKey?:string, baseURL?:string, fetchFn?:typeof fetch, model?:string}} [o]
 */
export async function transcribe(wav, o = {}) {
  const err = checkWav(wav)
  if (err) throw new Error(err)
  const apiKey = o.apiKey || process.env.META_API_KEY
  if (!apiKey) throw new Error('no META_API_KEY (Keychain "meta-hackathon-api")')
  const baseURL = (o.baseURL || process.env.META_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '')
  const f = new FormData()
  f.append('request', new Blob([JSON.stringify(asrRequest(o))], { type: 'application/json' }))
  f.append('audio', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
  const t0 = Date.now()
  const res = await (o.fetchFn || fetch)(`${baseURL}/asr/transcribe`, { method: 'POST', signal: externalSignal(60000), headers: { authorization: `Bearer ${apiKey}` }, body: f })
  const text = await res.text()
  if (!res.ok) throw new Error(`ASR ${res.status}: ${text.slice(0, 200)}`)
  let json
  try { json = JSON.parse(text) } catch (e) { throw new Error('ASR reply is not JSON') }
  return { transcript: cleanTranscript(json.transcript), ms: Date.now() - t0, audioMs: json.audioDurationMs ?? null }
}
