import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sampleBackground, evaluateTexts, contrastGate, runContrastCheck, tokenIndex, textTokens, isDecorative, textsFromCapture,
} from '../src/stages/text-contrast.js'
import { prBody, contrastSection } from '../src/stages/pr.js'
import { buildReportHtml } from '../src/stages/report.js'

// Synthetic screenshots: an RGBA buffer, a background painter and "glyphs" (vertical 2 px stems every 6 px with
// half-covered anti-aliased edges), which is enough structure for the sampler without a browser.
function makeImg(w, h, bg) {
  const data = new Uint8Array(w * h * 4)
  const img = { width: w, height: h, data }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(img, x, y, typeof bg === 'function' ? bg(x, y) : bg)
  return img
}
function put(img, x, y, [r, g, b]) {
  const i = (y * img.width + x) * 4
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
}
function get(img, x, y) {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t))
/** Paint stems of `ink` inside [x0,y0,w,h], blending edges 50% with whatever is underneath. */
function glyphs(img, [x0, y0, w, h], ink, o = {}) {
  for (let x = x0 + 3; x < x0 + w - 3; x += 6) {
    for (let y = y0 + 4; y < y0 + h - 4; y++) {
      put(img, x, y, ink); put(img, x + 1, y, ink)
      if (o.aa !== false) { put(img, x - 1, y, mix(get(img, x - 1, y), ink, 0.5)); put(img, x + 2, y, mix(get(img, x + 2, y), ink, 0.5)) }
      if (o.halo) for (const dx of [-3, -2, 3, 4]) put(img, x + dx, y, o.halo)
    }
  }
}
const WHITE = [255, 255, 255], BLACK = [0, 0, 0]

test('sampleBackground: black text on white measures 21:1 and ignores the anti-aliased edges', () => {
  const img = makeImg(120, 40, WHITE)
  glyphs(img, [10, 10, 90, 20], BLACK)
  const m = sampleBackground(img, { rects: [[10, 10, 90, 20]], color: 'rgb(0, 0, 0)' })
  assert.equal(m.status, 'measured')
  assert.equal(m.worst.bg, '#ffffff')
  assert.equal(m.worst.ratio, 21)
  // The 50% gray edge pixels never form a background cluster.
  assert.ok(m.clusters.every((c) => c.bg === '#ffffff'))
})

test('sampleBackground: a gradient under the words gives worst and best clusters (the DOM sees one "image")', () => {
  // White to blue, left to right: #333 text reads well on the white end and badly on the blue end.
  const img = makeImg(300, 30, (x) => mix(WHITE, [0, 0, 255], x / 299))
  glyphs(img, [0, 5, 300, 20], [0x33, 0x33, 0x33])
  const m = sampleBackground(img, { rects: [[0, 5, 300, 20]], color: '#333333' })
  assert.equal(m.status, 'measured')
  assert.ok(m.worst.ratio < 2.5, `worst ${m.worst.ratio}`)
  assert.ok(m.best.ratio > 11, `best ${m.best.ratio}`)
  // Only the part under the text counts: the same gradient, text over its first quarter only, is fine.
  const short = sampleBackground(img, { rects: [[0, 5, 70, 20]], color: '#333333' })
  assert.ok(short.worst.ratio > 6, `short worst ${short.worst.ratio}`)
})

test('sampleBackground: a text-shadow halo next to the glyphs is the background they are read against', () => {
  const img = makeImg(120, 40, [0x73, 0x73, 0x73])
  glyphs(img, [10, 10, 90, 20], BLACK, { halo: WHITE, aa: false })
  const m = sampleBackground(img, { rects: [[10, 10, 90, 20]], color: '#000' })
  assert.equal(m.best.bg, '#ffffff')
  assert.equal(m.best.ratio, 21)
})

test('sampleBackground: translucent text and opacity are composited before the ratio', () => {
  // Black at opacity .3 on white paints #b3b3b3.
  const img = makeImg(120, 40, WHITE)
  glyphs(img, [10, 10, 90, 20], [0xb3, 0xb3, 0xb3])
  const m = sampleBackground(img, { rects: [[10, 10, 90, 20]], color: 'rgb(0, 0, 0)', opacity: 0.3 })
  assert.equal(m.status, 'measured')
  assert.ok(Math.abs(m.worst.ratio - 2.11) < 0.05, `ratio ${m.worst.ratio}`)
  assert.equal(m.fg, '#b3b3b3')
})

test('sampleBackground: same-color text is invisible, unpainted color is no-glyphs, off-page is offscreen', () => {
  const img = makeImg(60, 30, WHITE)
  assert.equal(sampleBackground(img, { rects: [[5, 5, 50, 20]], color: '#fff' }).status, 'invisible')
  // The DOM says red, but nothing red (or red-ish) is painted there.
  assert.equal(sampleBackground(img, { rects: [[5, 5, 50, 20]], color: '#ff0000' }).status, 'no-glyphs')
  assert.equal(sampleBackground(img, { rects: [[5, -500, 50, 20]], color: '#000' }).status, 'offscreen')
})

test('sampleBackground: a small foreign patch under 5% of the ring does not decide the verdict', () => {
  const img = makeImg(200, 40, WHITE)
  glyphs(img, [10, 10, 180, 20], BLACK)
  // A 2x2 gray dot (a stray icon pixel, 7:1 against black) inside the text box.
  for (let y = 12; y < 14; y++) for (let x = 13; x < 15; x++) put(img, x, y, [150, 150, 150])
  const m = sampleBackground(img, { rects: [[10, 10, 180, 20]], color: '#000' })
  assert.equal(m.worst.bg, '#ffffff')
})

test('evaluateTexts: statuses, occurrence keys, large text minimum', () => {
  const img = makeImg(200, 120, WHITE)
  glyphs(img, [0, 0, 100, 30], [0xaa, 0xaa, 0xaa])
  glyphs(img, [0, 40, 100, 30], [0xaa, 0xaa, 0xaa])
  glyphs(img, [0, 80, 100, 30], [0x66, 0x66, 0x66])
  const base = { path: 'p', rects: [[0, 0, 100, 30]], color: '#aaaaaa', fontSize: '16px', fontWeight: '400' }
  const out = evaluateTexts(img, [
    { ...base, text: 'Hello' },
    { ...base, text: 'Hello', rects: [[0, 40, 100, 30]] },
    { ...base, text: '•••' },
    { ...base, text: 'Off', disabled: true },
    { ...base, text: 'Big', rects: [[0, 80, 100, 30]], color: '#666', fontSize: '24px' },
  ])
  assert.deepEqual(out.map((p) => p.status), ['fail', 'fail', 'decorative', 'disabled', 'pass'])
  assert.deepEqual(out.slice(0, 2).map((p) => p.key), ['p|Hello|0', 'p|Hello|1'])
  assert.equal(out[4].required, 3)
  assert.ok(isDecorative('— | +') && !isDecorative('12%') && !isDecorative('Été'))
})

const pair = (key, status, ratio, extra = {}) => ({ key, text: key, path: 'p', status, ratio, required: 4.5, ...extra })

test('contrastGate: only a pair that passed and now fails is a regression; old failures are reported, not blocking', () => {
  const before = [pair('a', 'pass', 7), pair('b', 'fail', 3), pair('c', 'pass', 5), pair('d', 'decorative')]
  const g = contrastGate(before, {
    colors: [pair('a', 'pass', 7), pair('b', 'fail', 3), pair('c', 'fail', 4.4)],
    all: [pair('a', 'pass', 7), pair('b', 'pass', 4.6)],
  })
  assert.equal(g.pairs, 3)
  assert.equal(g.failingBefore, 1)
  assert.deepEqual(g.failingAfter, { colors: 2, all: 0 })
  assert.deepEqual(g.regressions.map((r) => [r.key, r.renders, r.before, r.ratio]), [['c', ['colors'], 5, 4.4]])
  // b still fails with color tokens only, so it has not improved.
  assert.deepEqual(g.improved, [])
  const one = contrastGate([pair('e', 'pass', 9), pair('f', 'fail', 3)], {
    colors: [pair('e', 'fail', 4), pair('f', 'pass', 5)],
    all: [pair('e', 'fail', 3.5), pair('f', 'pass', 5)],
  })
  // One entry per pair however many renders it fails in, with the lowest ratio.
  assert.deepEqual(one.regressions.map((r) => [r.key, r.renders, r.ratio]), [['e', ['colors', 'all'], 3.5]])
  assert.deepEqual(one.improved.map((r) => [r.key, r.renders]), [['f', ['colors', 'all']]])
  // A pair that is missing (or unmeasurable) after the change is not counted either way.
  assert.equal(contrastGate([pair('x', 'pass', 9)], { colors: [pair('x', 'no-glyphs')] }).regressions.length, 0)
})

test('runContrastCheck: a proposal that darkens the background under muted text fails the gate and names the token', () => {
  const text = { path: 'p.muted', text: 'Since last month', rects: [[0, 0, 100, 30]], color: 'rgb(136, 152, 170)', fontSize: '14px', fontWeight: '400', bbox: [0, 0, 100, 30] }
  const shot = (bg) => { const img = makeImg(100, 30, bg); glyphs(img, [0, 0, 100, 30], [136, 152, 170]); return img }
  const ok = (img) => ({ img, texts: [text] })
  const tokens = { tokens: [
    { name: 'color.gray.500', tier: 'primitive', value: '#8898aa', clusters: ['color-01'] },
    { name: 'color.text.muted', tier: 'semantic', alias: 'color.gray.500', clusters: ['color-01'] },
  ] }
  const clusters = [{ id: 'color-01', kind: 'color', members: [{ value: '#8898aaff' }], props: { color: 9 } }]
  const same = runContrastCheck({ before: ok(shot(WHITE)), afters: { colors: ok(shot(WHITE)), all: ok(shot(WHITE)) }, tokens, clusters })
  assert.equal(same.pass, true)
  assert.equal(same.failingBefore, 1)
  assert.deepEqual(same.failing[0].tokens, ['color.text.muted', 'color.gray.500'])
  // Black text on white before, then a proposal turns the surface mid-gray: newly failing.
  const blackText = { ...text, color: '#000' }
  const blackShot = (bg) => { const img = makeImg(100, 30, bg); glyphs(img, [0, 0, 100, 30], BLACK); return img }
  const worse = runContrastCheck({
    before: { img: blackShot(WHITE), texts: [blackText] },
    afters: { colors: { img: blackShot([0x55, 0x55, 0x55]), texts: [blackText] }, all: { img: blackShot(WHITE), texts: [blackText] } },
  })
  assert.equal(worse.pass, false)
  assert.equal(worse.regressions.length, 1)
  assert.deepEqual(worse.regressions[0].renders, ['colors'])
  // A page with no text at all (an image-only or canvas page) passes with zero pairs instead of crashing.
  const none = runContrastCheck({ before: { img: makeImg(10, 10, WHITE), texts: [] }, afters: { colors: { img: makeImg(10, 10, WHITE), texts: [] } } })
  assert.deepEqual([none.pass, none.pairs, none.failingBefore], [true, 0, 0])
})

test('tokenIndex / textTokens: matches merged originals and puts text-color tokens first', () => {
  const tokens = { tokens: [
    { name: 'color.surface.default', tier: 'semantic', alias: 'color.white', clusters: ['color-02'] },
    { name: 'color.white', tier: 'primitive', value: '#ffffff', clusters: ['color-02'] },
    { name: 'color.text.inverse', tier: 'semantic', alias: 'color.white', clusters: ['color-03'] },
  ] }
  const clusters = [
    { id: 'color-02', members: [{ value: '#ffffffff' }], props: { 'background-color': 20 } },
    { id: 'color-03', members: [{ value: '#fefefeff' }], props: { color: 4 } },
  ]
  const ix = tokenIndex(tokens, clusters)
  assert.equal(textTokens('#ffffff', ix)[0], 'color.text.inverse')
  // #fefefe was merged into white: still found through the cluster member.
  assert.deepEqual(textTokens('rgb(254, 254, 254)', ix), ['color.text.inverse'])
})

test('textsFromCapture: element boxes stand in for text runs; svg text and images are left out', () => {
  const cap = { elements: [
    { tag: 'p', path: 'p', text: 'Hi', bbox: [0, 0, 10, 10], styles: { color: '#000', 'font-size': '16px', 'font-weight': '400' } },
    { tag: 'text', path: 'svg>text', text: 'SVG', bbox: [0, 0, 10, 10], styles: { color: '#000' } },
    { tag: 'div', path: 'div', text: '', bbox: [0, 0, 10, 10], styles: { color: '#000' } },
  ] }
  const t = textsFromCapture(cap)
  assert.equal(t.length, 1)
  assert.deepEqual(t[0].rects, [[0, 0, 10, 10]])
})

const contrast = {
  pairs: 3, failingBefore: 1, failingAfter: { colors: 1, all: 1 }, pass: true, improved: [], regressions: [],
  failing: [{ key: 'k', text: 'Since last month', fg: '#8898aa', bg: '#ffffff', ratio: 2.95, required: 4.5, large: false, tokens: ['color.text.muted'] }],
}

test('PR body: "Text contrast (WCAG 2.x AA)" lists failing pairs with the controlling token, never a compliance verdict', () => {
  const body = prBody({ tokens: { tokens: [], namer: 'mock' }, rewrite: { files: [], edits: [] }, verify: { ratio: 0, fallback: { diffPixels: 0, pass: true }, colors: { ratio: 0, pass: true }, contrast }, tokensCssRel: 'tokens.css' })
  assert.match(body, /## Text contrast \(WCAG 2\.x AA\)/)
  assert.match(body, /\| `#8898aa` \| `#ffffff` \| 2\.95:1 \| 4\.5:1 \| 1 \| "Since last month" \| `--color-text-muted` \|/)
  assert.match(body, /1 of 3 pairs below AA before, 0 regressions, pass/)
  assert.doesNotMatch(body, /\baccessible\b|\bcompliant\b|compliance/i)
  const failing = contrastSection({ ...contrast, pass: false, regressions: [{ ...contrast.failing[0], key: 'r', text: 'Week', renders: ['colors'], before: 4.6 }] }).join('\n')
  assert.match(failing, /1 pair newly below the minimum: verify fails/)
  assert.match(failing, /### Newly below the minimum/)
})

test('report: fourth verify row with counts and the failing-pairs table', () => {
  const html = buildReportHtml({ verify: { ratio: 0, diffPixels: 0, totalPixels: 1, threshold: 0.001, pass: true, fallback: { diffPixels: 0, totalPixels: 1, ratio: 0, pass: true, threshold: 0 }, colors: { diffPixels: 0, totalPixels: 1, ratio: 0, pass: true, threshold: 0.001 }, contrast } })
  assert.match(html, /Text contrast \(WCAG 2\.x AA, SC 1\.4\.3\)/)
  assert.match(html, /3 text pairs measured; 1 below the AA minimum on the original page/)
  assert.match(html, /Since last month/)
  assert.match(html, /--color-text-muted/)
  assert.doesNotMatch(html, /\bcompliant\b/i)
})
