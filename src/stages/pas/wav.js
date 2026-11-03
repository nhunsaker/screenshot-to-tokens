// Point and say: PCM -> 16 kHz mono 16-bit WAV, in the page (no ffmpeg at run time). ES module with no imports, so the
// playground can load it in the browser and Node tests can import it. muse-voice-transcribe-1.0 takes
// {audioEncoding:"WAV", sampleRateHertz:16000}.

export const ASR_RATE = 16000

/** Mix channels (arrays of Float32Array, same length) to one mono Float32Array. */
export function toMono(channels) {
  if (!channels || !channels.length) return new Float32Array(0)
  if (channels.length === 1) return channels[0]
  const n = channels[0].length, out = new Float32Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length
  return out
}

/**
 * Resample mono float samples from `inRate` to `outRate`. Downsampling averages each output sample's input window
 * (a box filter: cheap anti-aliasing, good enough for speech); upsampling interpolates linearly.
 */
export function resample(samples, inRate, outRate = ASR_RATE) {
  if (inRate === outRate) return samples
  const ratio = inRate / outRate
  const n = Math.floor(samples.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (ratio > 1) {
      const a = Math.floor(i * ratio), b = Math.min(samples.length, Math.floor((i + 1) * ratio))
      let s = 0
      for (let j = a; j < b; j++) s += samples[j]
      out[i] = b > a ? s / (b - a) : samples[a] || 0
    } else {
      const x = i * ratio, j = Math.floor(x), f = x - j
      out[i] = (samples[j] || 0) * (1 - f) + (samples[Math.min(samples.length - 1, j + 1)] || 0) * f
    }
  }
  return out
}

/** Root-mean-square level of float samples (0 = silence); the page warns on a silent recording. */
export function rms(samples) {
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return samples.length ? Math.sqrt(s / samples.length) : 0
}

/** Float [-1, 1] -> little-endian signed 16-bit, clipped. */
export function floatTo16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/**
 * A complete RIFF/WAVE file (PCM, mono, 16-bit) for `samples` (Float32Array at `inRate`), resampled to `outRate`.
 * @returns {Uint8Array}
 */
export function encodeWav(samples, inRate, outRate = ASR_RATE) {
  const pcm = floatTo16(resample(samples, inRate, outRate))
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true)
  return new Uint8Array(buf)
}

/** Parse the header of a PCM WAV we wrote (tests and the server's sanity check). Null if it is not one. */
export function readWavHeader(bytes) {
  if (!bytes || bytes.length < 44) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null
  return { format: v.getUint16(20, true), channels: v.getUint16(22, true), sampleRate: v.getUint32(24, true), bits: v.getUint16(34, true), dataBytes: v.getUint32(40, true) }
}

/**
 * Browser only: record from the mic with MediaRecorder until `stop()` is called or `maxMs` passes, then decode the
 * recording (decodeAudioData) and encode it as 16 kHz
 * mono WAV. Resolves {wav: Uint8Array, ms, rate, rms}. Hold-to-talk calls this on press and stop() on release.
 * (An AudioContext + ScriptProcessor capture produced no samples in headless Chromium: no render clock there.)
 */
export async function recordWav({ maxMs = 10000, getUserMedia, deviceId } = {}) {
  const gum = getUserMedia || ((c) => navigator.mediaDevices.getUserMedia(c))
  const constraints = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  if (deviceId) constraints.deviceId = { exact: deviceId }
  const stream = await gum({ audio: constraints })
  const track = stream.getAudioTracks()[0]
  const label = (track && track.label) || ''
  const rec = new MediaRecorder(stream)
  const parts = []
  rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data) }
  const stopped = new Promise((ok) => { rec.onstop = ok })
  const t0 = Date.now()
  rec.start(250) // timesliced: without it, a short recording stopped by the timer came back undecodable
  const timer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop() }, maxMs)
  const stop = () => { clearTimeout(timer); if (rec.state !== 'inactive') rec.stop() }
  const result = stopped.then(async () => {
    stream.getTracks().forEach((t) => t.stop())
    const ms = Date.now() - t0
    const bytes = await new Blob(parts, { type: rec.mimeType }).arrayBuffer()
    const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)()
    let audio
    try { audio = await ctx.decodeAudioData(bytes) } finally { ctx.close() }
    const ch = []
    for (let i = 0; i < audio.numberOfChannels; i++) ch.push(audio.getChannelData(i))
    const mono = toMono(ch)
    return { wav: encodeWav(mono, audio.sampleRate), ms, rate: audio.sampleRate, rms: rms(mono), mime: rec.mimeType, label }
  })
  return { stop, result, label }
}
