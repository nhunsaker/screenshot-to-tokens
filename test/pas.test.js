// Point and say (spike): WAV encoder, ASR request, OKLCH contrast fix, routing, twins, Muse proposal restriction.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav, readWavHeader, resample, floatTo16, toMono, rms, ASR_RATE } from '../src/stages/pas/wav.js'
import { asrRequest, checkWav, cleanTranscript, transcribe } from '../src/stages/pas/transcribe.js'
import { rgbToOklab, rgbToOklch, oklchToRgb, oklabToRgb, minimalLightnessFix, contrastFix, checkPairs } from '../src/stages/pas/contrast-fix.js'
import { routeIntent } from '../src/stages/pas/route.js'
import { deltaE, rgbToLab, sizeCompatible, findTwins, ownColor } from '../src/stages/pas/twins.js'
import { restrictProposal } from '../src/stages/pas/intent.js'
import { pickForPoint, elementAt, tokensForElement } from '../src/stages/pas/point.js'
import { parseColor, contrastRatio } from '../src/preview-client/contrast.js'

// ---- WAV ----------------------------------------------------------------------------------------------------------

test('encodeWav: 48 kHz float -> 16 kHz mono 16-bit RIFF with a correct header', () => {
  const s = new Float32Array(48000).map((_, i) => Math.sin(i / 10) * 0.5)
  const wav = encodeWav(s, 48000)
  const h = readWavHeader(wav)
  assert.deepEqual(h, { format: 1, channels: 1, sampleRate: 16000, bits: 16, dataBytes: 32000 })
  assert.equal(wav.length, 44 + 32000)
  assert.equal(checkWav(wav), null)
})

test('resample: box-filter downsampling keeps a DC level; floatTo16 clips', () => {
  const r = resample(new Float32Array(4800).fill(0.25), 48000, ASR_RATE)
  assert.equal(r.length, 1600)
  assert.ok(Math.abs(r[100] - 0.25) < 1e-6)
  assert.deepEqual(Array.from(floatTo16(new Float32Array([2, -2, 0]))), [32767, -32768, 0])
  assert.equal(resample(new Float32Array([1, 2]), 16000, 16000).length, 2)
})

test('toMono and rms', () => {
  const m = toMono([new Float32Array([1, 0]), new Float32Array([0, 1])])
  assert.deepEqual(Array.from(m), [0.5, 0.5])
  assert.equal(rms(new Float32Array([1, -1])), 1)
  assert.equal(rms(new Float32Array(0)), 0)
})

test('checkWav rejects wrong rate, non-WAV and over-long audio', () => {
  assert.match(checkWav(encodeWav(new Float32Array(100), 8000, 8000)), /16 kHz/)
  assert.equal(checkWav(new Uint8Array(100)), 'not a WAV file')
  assert.match(checkWav(new Uint8Array(44 + 16000 * 2 * 13)), /too long/)
})

// ---- ASR ----------------------------------------------------------------------------------------------------------

test('asrRequest: uppercase WAV, 16 kHz, store:false; refuses a -contributor model', () => {
  assert.deepEqual(asrRequest({ model: 'muse-voice-transcribe-1.0' }), { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', sampleRateHertz: 16000, store: false })
  assert.throws(() => asrRequest({ model: 'muse-voice-transcribe-1.0-contributor' }), /contributor/)
})

test('transcribe: multipart request + audio parts, cleans the doubled period', async () => {
  let seen = null
  const fetchFn = async (url, init) => {
    seen = { url, init }
    return { ok: true, text: async () => JSON.stringify({ transcript: ' make this  our brand blue.. ', audioDurationMs: 2960 }) }
  }
  const r = await transcribe(encodeWav(new Float32Array(1600), 16000), { apiKey: 'k', fetchFn, baseURL: 'https://x/v1/' })
  assert.equal(r.transcript, 'make this our brand blue.')
  assert.equal(r.audioMs, 2960)
  assert.equal(seen.url, 'https://x/v1/asr/transcribe')
  assert.equal(seen.init.headers.authorization, 'Bearer k')
  const req = JSON.parse(await seen.init.body.get('request').text())
  assert.equal(req.store, false)
  assert.ok(seen.init.body.get('audio'))
  assert.equal(cleanTranscript('a\n b'), 'a b')
})

// ---- OKLCH contrast fix -------------------------------------------------------------------------------------------

test('OKLab: white L=1, black L=0, round trip within 1/255', () => {
  assert.ok(Math.abs(rgbToOklab({ r: 255, g: 255, b: 255 }).L - 1) < 1e-4)
  assert.ok(Math.abs(rgbToOklab({ r: 0, g: 0, b: 0 }).L) < 1e-6)
  for (const hex of ['#8898aa', '#5e72e4', '#f5365c', '#2dce89']) {
    const c = parseColor(hex)
    const back = oklabToRgb(rgbToOklab(c))
    assert.ok(Math.abs(back.r - c.r) <= 1 && Math.abs(back.g - c.g) <= 1 && Math.abs(back.b - c.b) <= 1, hex)
  }
  const lch = rgbToOklch(parseColor('#8898aa'))
  assert.ok(Math.abs(lch.L - 0.673) < 0.002 && lch.h > 245 && lch.h < 255)
})

test('oklchToRgb: an out-of-gamut chroma is reduced, hue and lightness kept', () => {
  const rgb = oklchToRgb({ L: 0.6, C: 0.5, h: 250 })
  for (const v of [rgb.r, rgb.g, rgb.b]) assert.ok(v >= 0 && v <= 255)
  const back = rgbToOklch(rgb)
  assert.ok(Math.abs(back.L - 0.6) < 0.01)
  assert.ok(Math.abs(back.h - 250) < 3)
})

test('minimalLightnessFix: Argon muted grey on white -> darker, same hue, just past 4.5:1', () => {
  const pairs = [{ bg: '#ffffff', required: 4.5 }, { bg: '#f8f9fe', required: 4.5 }, { bg: '#ffffff', required: 3 }]
  const r = minimalLightnessFix('#8898aa', pairs)
  assert.equal(r.direction, 'darker')
  assert.ok(r.after.allPass)
  assert.ok(r.after.worst >= 4.5 && r.after.worst < 4.7, String(r.after.worst))
  assert.ok(Math.abs(r.oklch.to.h - r.oklch.from.h) < 3)
  // Minimal: one more step back towards the original fails.
  const back = oklchToRgb({ L: r.oklch.to.L + 0.005, C: r.oklch.from.C, h: r.oklch.from.h })
  assert.equal(checkPairs({ ...back, a: 1 }, pairs).allPass, false)
})

test('minimalLightnessFix: light text on dark goes lighter; impossible demands are an error, not a guess', () => {
  const up = minimalLightnessFix('#525f7f', [{ bg: '#172b4d', required: 4.5 }])
  assert.equal(up.direction, 'lighter')
  assert.ok(contrastRatio(parseColor(up.value), parseColor('#172b4d')) >= 4.5)
  const no = minimalLightnessFix('#777777', [{ bg: '#ffffff', required: 7 }, { bg: '#000000', required: 7 }])
  assert.match(no.error, /no lightness/)
  assert.equal(minimalLightnessFix('#000000', [{ bg: '#ffffff', required: 4.5 }]).direction, 'none')
})

test('contrastFix: follows aliases, writes the value on the named token, keeps alpha', () => {
  const tokens = [{ name: 'color.blue.400', value: '#8898aaff' }, { name: 'color.text.muted', alias: 'color.blue.400' }, { name: 'color.hint', value: '#888888cc' }]
  const r = contrastFix('color.text.muted', [{ bg: '#ffffff', required: 4.5 }], tokens)
  assert.equal(r.token, 'color.text.muted')
  assert.equal(r.aliasOf, 'color.blue.400')
  assert.match(r.value, /^#[0-9a-f]{6}$/)
  const a = contrastFix('color.hint', [{ bg: '#ffffff', required: 4.5 }], tokens)
  assert.ok(a.value.endsWith('cc'), JSON.stringify(a))
  assert.equal(contrastFix('nope', [], tokens).error, 'unknown token')
})

// ---- routing ------------------------------------------------------------------------------------------------------

test('routeIntent: contrast, focus and Muse requests (incl. the spike transcripts)', () => {
  const cases = {
    'This label is too light, make it readable. Keep our gray.': 'contrast',
    "Make this text darker so it's easier to read.": 'contrast',
    'Give everyGive every control a visible focus ring in our blue.': 'focus',
    "I can't see where the keyboard focuses.": 'focus',
    'Make these buttons our brand blue.': 'muse',
    'round it like the cards': 'muse',
  }
  for (const [t, want] of Object.entries(cases)) assert.equal(routeIntent(t).route, want, t)
})

// ---- twins --------------------------------------------------------------------------------------------------------

test('deltaE / Lab basics and size compatibility', () => {
  assert.ok(Math.abs(rgbToLab({ r: 255, g: 255, b: 255 }).L - 100) < 0.01)
  assert.ok(deltaE({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) > 99)
  assert.equal(deltaE({ r: 94, g: 114, b: 228 }, { r: 94, g: 114, b: 228 }), 0)
  assert.ok(sizeCompatible([0, 0, 76, 37], [0, 0, 56, 28]))
  assert.ok(!sizeCompatible([0, 0, 76, 37], [0, 0, 30, 37]))
})

test('ownColor: a fill wins over the white around it; thin strokes fall back to the stroke colour', () => {
  const white = [255, 255, 255], blue = [94, 114, 228], dark = [70, 70, 70], stroke = [190, 190, 190]
  const fill = ownColor({ inside: Array(90).fill(blue).concat(Array(10).fill(white)), ring: Array(50).fill(white), edge: [] })
  assert.equal(fill.hex, '#5e72e4')
  assert.equal(fill.basis, 'fill')
  const s = ownColor({ inside: Array(97).fill(dark).concat(Array(3).fill(stroke)), ring: Array(50).fill(dark), edge: [] })
  assert.equal(s.basis, 'strokes')
  assert.equal(s.hex, '#bebebe')
})

test('findTwins: same kind, ΔE < 6 and size; other colours and stroke look-alikes on other surroundings excluded', () => {
  const blue = { r: 94, g: 114, b: 228 }
  const colors = [
    { id: 'self', kind: 'button', bbox: [0, 0, 76, 37], color: blue, hex: '#5e72e4' },
    { id: 'seeAll', kind: 'button', bbox: [200, 0, 56, 28], color: blue, hex: '#5e72e4' },
    { id: 'green', kind: 'button', bbox: [300, 0, 70, 36], color: { r: 45, g: 206, b: 137 }, hex: '#2dce89' },
    { id: 'icon', kind: 'icon', bbox: [400, 0, 70, 36], color: blue, hex: '#5e72e4' },
    { id: 'big', kind: 'button', bbox: [500, 0, 300, 37], color: blue, hex: '#5e72e4' },
  ]
  const { twins } = findTwins({ kind: 'button', bbox: [0, 0, 76, 37], color: blue }, colors)
  assert.deepEqual(twins.map((t) => t.id), ['seeAll'])
  const grey = { r: 189, g: 189, b: 189 }
  const strokes = [{ id: 'footer', kind: 'icon', bbox: [0, 100, 15, 14], color: { r: 173, g: 173, b: 173 }, hex: '#adadad', basis: 'fill', ring: '#ffffff' },
    { id: 'side', kind: 'icon', bbox: [0, 200, 28, 27], color: { r: 190, g: 190, b: 190 }, hex: '#bebebe', basis: 'strokes', ring: '#464646' }]
  const r = findTwins({ kind: 'icon', bbox: [0, 300, 28, 27], color: grey, basis: 'strokes', ring: '#474747' }, strokes)
  assert.deepEqual(r.twins.map((t) => t.id), ['side'])
  assert.equal(r.near[0].why, 'different surroundings')
})

// ---- point helpers ------------------------------------------------------------------------------------------------

test('pickForPoint, elementAt, tokensForElement', () => {
  const o = (bbox) => ({ bbox })
  assert.deepEqual(pickForPoint([o([0, 0, 100, 100]), o([40, 40, 20, 20]), o([300, 300, 5, 5])], [50, 50]).bbox, [40, 40, 20, 20])
  assert.deepEqual(pickForPoint([o([300, 300, 5, 5]), o([90, 90, 5, 5])], [50, 50]).bbox, [90, 90, 5, 5])
  const els = [{ i: 1, bbox: [0, 0, 500, 500], text: '', styles: {} }, { i: 2, bbox: [10, 10, 200, 30], text: 'Since last month', styles: { color: 'rgb(136, 152, 170)', 'background-color': 'rgba(0, 0, 0, 0)' } }]
  assert.equal(elementAt(els, 20, 20).i, 2)
  const t = tokensForElement(els[1], [{ name: 'color.blue.400', tier: 'primitive', value: '#8898aaff' }, { name: 'color.text.muted', tier: 'semantic', value: '#8898aaff' }])
  assert.deepEqual(t.color.tokens, ['color.text.muted', 'color.blue.400'])
  assert.equal(t['background-color'], undefined)
})

// ---- Muse proposal restriction ------------------------------------------------------------------------------------

test('restrictProposal: aliases to known tokens only, changeable tokens only, raw CSS never passes', () => {
  const raw = { changes: [
    { token: 'button.bg', alias: 'color.action.primary', why: 'brand blue' },
    { token: 'card.bg', alias: 'color.action.primary', why: 'unrelated' },
    { token: 'button.text', value: 'red; background:url(x)', why: 'css' },
    { token: 'made.up', value: '#fff' },
  ], affects: 'Month <b>and</b> See all' }
  const r = restrictProposal(raw, { known: ['button.bg', 'card.bg', 'button.text', 'color.action.primary'], changeable: ['button.bg', 'button.text'] })
  assert.deepEqual(r.changes.map((c) => [c.token, c.css]), [['button.bg', 'var(--color-action-primary)']])
  assert.deepEqual(r.rejected.map((x) => x.why).sort(), ['does not touch the clicked element or its twins', 'unknown token', 'unsafe value'])
  assert.ok(!/[<>]/.test(r.affects))
})
