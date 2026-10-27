import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeMaskData, decodeOneBit, encodeOneBit, unpack85, pack85 } from '../src/lib/sam-mask.js'
import {
  pointPrompt, parseDetections, outlineFromDetection, pickDetection, iou, distanceField, erode, sampleRing, colorClusters,
  nontextContrast, targetSize, spacingOk, clickableAt, textAt, tokenValues, tokenForPixel, cropPng,
} from '../src/stages/nontext.js'
import { extractOutputText } from '../src/providers/segment/meta-sam.js'
import { appendNontextSection } from '../src/stages/report.js'

// A real SAM 3.1 response (2026-10-27): point prompt at div-soup's "New project" button, mask_encoding one_bit.
const REAL = {
  object: 'response', model: 'sam-3.1', status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '<0f>1<|box;x1=1302;y1=24;x2=1412;y2=58;w=1440;h=935|><|mask;x=0;y=0;data=35,111,!!!!!NH2FzWG![-Wwf/SzS+wy2TLP1=b#?MKL!E3:6:GfPr3?`eA#1m/|>\n' }] }],
}

const near = (a, b, d = 0.05) => assert.ok(Math.abs(a - b) <= d, `${a} ≈ ${b}`)
const count = (bits) => bits.reduce((n, b) => n + b, 0)

// ---- mask decoding ----------------------------------------------------------------------------------------------

test('decodeMaskData: a real one_bit mask is H x W, a rounded rectangle, and re-encodes to the exact payload', () => {
  const [det] = parseDetections(extractOutputText(REAL))
  const m = decodeMaskData(det.maskData)
  assert.equal(m.height, 35)
  assert.equal(m.width, 111)
  assert.equal(m.width, det.box.x2 - det.box.x1 + 1) // the raster covers the inclusive box
  assert.equal(m.height, det.box.y2 - det.box.y1 + 1)
  const fill = count(m.bits) / m.bits.length
  assert.ok(fill > 0.9 && fill < 1, `fill ${fill}`)
  assert.equal(m.bits[0], 0) // rounded corners are outside the mask
  assert.equal(m.bits[m.width - 1], 0)
  assert.equal(m.bits[17 * m.width + 55], 1) // the middle is inside
  assert.equal(encodeOneBit(m.bits, m.width, m.height), det.maskData.split(',')[2]) // canonical round trip
})

test('decodeOneBit: the 5x5 example from the published format, and synthetic round trips', () => {
  assert.equal([...decodeOneBit('!!!!!(QO(0lu8?', 5, 5)].join(''), '1001000110000001011110001')
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
  for (const [w, h] of [[1, 1], [3, 7], [40, 12], [64, 64]]) {
    const bits = Uint8Array.from({ length: w * h }, (_, i) => (i % w > w / 3 && rnd() > 0.2 ? 1 : 0))
    const payload = encodeOneBit(bits, w, h)
    assert.deepEqual(decodeOneBit(payload, w, h), bits)
  }
})

test('unpack85/pack85 round trip; bad input throws', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 9]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)
    assert.deepEqual(unpack85(pack85(bytes)), bytes)
  }
  assert.throws(() => decodeMaskData('3,3,~abc'), /lossless/)
  assert.throws(() => decodeOneBit('!!!!', 2, 2))
  assert.throws(() => unpack85('!!!!"'), /invalid/)
})

// ---- detections -------------------------------------------------------------------------------------------------

test('pointPrompt and parseDetections: wire format, inclusive boxes, multiple records', () => {
  assert.equal(pointPrompt(873.4, 328.6, 1440, 1303), '<0f>1<|point;x=873;y=329;w=1440;h=1303|>')
  const dets = parseDetections('<0f>1<|box;x1=1;y1=2;x2=10;y2=20;w=100;h=50|><|mask;x=0;y=0;data=19,10,!abc|>,2<|box;x1=5;y1=5;x2=6;y2=6;w=100;h=50|>')
  assert.equal(dets.length, 2)
  assert.deepEqual(dets[0].box, { x1: 1, y1: 2, x2: 10, y2: 20, w: 100, h: 50 })
  assert.equal(dets[0].maskData, '19,10,!abc')
  assert.equal(dets[1].maskData, undefined)
})

test('outlineFromDetection: page px with the tile offset; box-only detections fill the box', () => {
  const [det] = parseDetections(extractOutputText(REAL))
  const o = outlineFromDetection(det, { x: 0, y: 1600 }, { width: 1440, height: 935 })
  assert.deepEqual(o.bbox, [1302, 1624, 111, 35])
  assert.equal(o.bits.length, 111 * 35)
  assert.ok(o.fromMask)
  const half = outlineFromDetection({ box: { x1: 10, y1: 10, x2: 19, y2: 19, w: 720, h: 400 } }, { x: 0, y: 0 }, { width: 1440, height: 800 })
  assert.deepEqual(half.bbox, [20, 20, 20, 20]) // the API frame was half size: scaled back to the image we sent
  assert.equal(count(half.bits), 400)
})

test('pickDetection: highest IoU with the region wins', () => {
  const a = { bbox: [0, 0, 10, 10] }, b = { bbox: [100, 100, 20, 20] }
  assert.equal(pickDetection([a, b], [101, 101, 20, 20], [110, 110]).outline, b)
  near(iou([0, 0, 10, 10], [5, 0, 10, 10]), 50 / 150, 0.001)
  assert.equal(pickDetection([], [0, 0, 1, 1], [0, 0]), null)
})

// ---- ring sampling and contrast -------------------------------------------------------------------------------

/** RGBA image filled with `bg`, plus painter callbacks. */
function image(w, h, bg) {
  const data = new Uint8Array(w * h * 4)
  const set = (x, y, c) => { const k = (y * w + x) * 4; data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255 }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, bg)
  return { width: w, height: h, data, set }
}
const rect = (img, x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.set(x, y, c) }
const fullMask = (bbox) => ({ bbox, width: bbox[2], height: bbox[3], bits: new Uint8Array(bbox[2] * bbox[3]).fill(1) })

test('distanceField and erode: chessboard distances, edges count as outside', () => {
  const bits = new Uint8Array(9).fill(0); bits[4] = 1 // a single pixel in a 3x3 box
  const { dist, gw } = distanceField(bits, 3, 3, 2)
  assert.equal(gw, 7)
  assert.equal(dist[(1 + 2) * gw + 1 + 2], 0)
  assert.equal(dist[(1 + 2) * gw + 1 + 3], 1)
  assert.equal(dist[(1 + 2 + 2) * gw + 1 + 2 + 2], 2) // diagonal
  const sq = new Uint8Array(25).fill(1)
  assert.equal(count(erode(sq, 5, 5, 1)), 9)
  assert.equal(count(erode(sq, 5, 5, 2)), 1)
})

test('sampleRing: inside is the shape, the ring is the page around it (gap + width), nothing leaks', () => {
  const img = image(40, 40, [255, 255, 255])
  rect(img, 10, 10, 12, 12, [100, 100, 100])
  const s = sampleRing(img, fullMask([10, 10, 12, 12]), { gap: 1, ringW: 3, inset: 1 })
  assert.equal(s.inside.length, 100) // 12x12 eroded by 1
  assert.ok(s.inside.every((p) => p[0] === 100))
  assert.ok(s.ring.length > 0 && s.ring.every((p) => p[0] === 255))
  // ring: d in (1, 4] around a 12x12 square -> (12+8)^2 - (12+2)^2
  assert.equal(s.ring.length, 20 * 20 - 14 * 14)
})

test('sampleRing: clips at the image edge', () => {
  const img = image(20, 20, [0, 0, 0])
  const s = sampleRing(img, fullMask([0, 0, 5, 5]))
  assert.ok(s.ring.length > 0)
})

test('nontextContrast: a gray icon on white, a white glyph on a light circle, a bordered button', () => {
  const img = image(80, 40, [255, 255, 255])
  rect(img, 10, 10, 12, 12, [118, 118, 118]) // #767676 on white is 4.54:1
  const icon = nontextContrast('icon', sampleRing(img, fullMask([10, 10, 12, 12])))
  near(icon.ratio, 4.54)
  assert.equal(icon.pass, undefined) // the verdict is the stage's, not the math's

  const g = image(40, 40, [255, 255, 255])
  rect(g, 8, 8, 20, 20, [17, 205, 239]) // Argon's info cyan circle
  rect(g, 15, 15, 6, 6, [255, 255, 255]) // white glyph inside it
  const glyph = nontextContrast('icon', sampleRing(g, fullMask([8, 8, 20, 20])))
  near(glyph.ratio, 1.91) // white on #11cdef either way: low
  assert.equal(glyph.fill, '#11cdef')

  const b = image(80, 40, [244, 245, 247])
  rect(b, 10, 10, 40, 20, [80, 80, 80]) // a dark 1-2 px border...
  rect(b, 12, 12, 36, 16, [255, 255, 255]) // ...around a white fill
  const btn = nontextContrast('button', sampleRing(b, fullMask([10, 10, 40, 20])))
  assert.equal(btn.basis, 'border vs surroundings')
  assert.ok(btn.ratio > 7, String(btn.ratio))
})

test('colorClusters: shares sum to 1 and near shades merge', () => {
  const px = [...Array(70).fill([250, 250, 250]), ...Array(10).fill([240, 240, 240]), ...Array(20).fill([0, 0, 255])]
  const c = colorClusters(px)
  assert.equal(c.length, 2)
  near(c[0].share, 0.8, 0.001)
  assert.deepEqual(colorClusters([]), [])
})

// ---- target size --------------------------------------------------------------------------------------------------

test('targetSize: 24x24 is the minimum on both axes', () => {
  assert.equal(targetSize([0, 0, 24, 24]).pass, true)
  assert.equal(targetSize([0, 0, 23, 40]).pass, false)
  assert.equal(targetSize([0, 0, 40, 23]).pass, false)
  assert.deepEqual(targetSize([5, 5, 30, 20]), { w: 30, h: 20, pass: false })
})

test('spacingOk: an undersized target passes only when its 24 px circle is clear', () => {
  const t = { bbox: [100, 100, 16, 16], undersized: true }
  assert.equal(spacingOk(t, [t, { bbox: [200, 100, 30, 30], undersized: false }]), true)
  assert.equal(spacingOk(t, [t, { bbox: [118, 100, 30, 30], undersized: false }]), false) // 10 px from the center
  assert.equal(spacingOk(t, [t, { bbox: [122, 100, 16, 16], undersized: true }]), false) // circles overlap (22 < 24)
  assert.equal(spacingOk(t, [t, { bbox: [126, 100, 16, 16], undersized: true }]), true)
})

test('clickableAt: the real control over an inherited-clickable child; the outermost pointer div in div soup', () => {
  const els = [
    { tag: 'a', clickable: true, bbox: [0, 0, 250, 45] },
    { tag: 'i', clickable: true, bbox: [20, 15, 16, 16] },
    { tag: 'div', clickable: false, bbox: [0, 0, 1440, 900] },
  ]
  assert.equal(clickableAt(els, 25, 20).tag, 'a')
  const soup = [{ tag: 'div', clickable: true, bbox: [0, 54, 220, 35] }, { tag: 'span', clickable: true, bbox: [20, 60, 60, 20] }]
  assert.deepEqual(clickableAt(soup, 30, 65).bbox, [0, 54, 220, 35])
  assert.equal(clickableAt(soup, 500, 500), null)
  assert.equal(textAt([{ bbox: [2, 2, 46, 16], text: ' View ' }], [0, 0, 50, 20]), 'View')
  assert.equal(textAt([{ bbox: [0, 0, 1440, 60], text: 'Site header' }], [1300, 20, 22, 20]), null) // an ancestor's text

})

// ---- tokens, crops, report ------------------------------------------------------------------------------------------

test('tokenForPixel: exact (semantic first), then nearest within tolerance, else none', () => {
  const values = tokenValues({ tokens: [
    { name: 'color.gray.300', tier: 'primitive', value: '#dee2e6' },
    { name: 'color.border.default', tier: 'semantic', alias: 'color.gray.300' },
    { name: 'color.info', tier: 'semantic', value: '#11cdef' },
    { name: 'space.2', tier: 'primitive', value: '8px' },
  ] })
  assert.equal(values.length, 3)
  assert.deepEqual(tokenForPixel('#dee2e6', values), { tokens: ['color.border.default', 'color.gray.300'], exact: true })
  assert.deepEqual(tokenForPixel('#12ccee', values), { tokens: ['color.info'], exact: false })
  assert.deepEqual(tokenForPixel('#000000', values), { tokens: [], exact: false })
})

test('cropPng draws the outline; appendNontextSection inserts once and replaces on re-run', () => {
  const img = image(30, 30, [255, 255, 255])
  const png = cropPng(img, fullMask([10, 10, 5, 5]))
  assert.equal(png.slice(1, 4).toString(), 'PNG')
  const dir = mkdtempSync(join(tmpdir(), 's2t-nontext-'))
  writeFileSync(join(dir, 'report.html'), '<html><body><div class="wrap"><section class="card">x</section>\n</div>\n<div class="review-toolbar"></div></body></html>')
  const nt = { controls: 1, byLabel: { icon: 1 }, contrastFailing: 1, contrastMeasured: 1, contrastFailingNeedsBoundary: 1, targets: 0, undersized: 0, undersizedNoSpacing: 0, sam: { calls: 1 },
    items: [{ id: 'r1', label: 'icon', outlineSource: 'sam-point-mask', crop: 'nontext/r1.png', contrast: { ratio: 1.84, pass: false, fg: '#ffffff', bg: '#11cdef', basis: 'glyph vs its shape' }, size: null, token: { fg: 'color.white', bg: null } }] }
  writeFileSync(join(dir, 'nontext.json'), JSON.stringify(nt))
  appendNontextSection(dir)
  appendNontextSection(dir)
  const html = readFileSync(join(dir, 'report.html'), 'utf-8')
  assert.equal(html.split('<!-- nontext:start -->').length, 2)
  assert.ok(html.indexOf('nontext:end') < html.indexOf('review-toolbar'))
  assert.match(html, /1\.84:1/)
  assert.doesNotMatch(html, /\baccessible\b|compliant/i)
})
