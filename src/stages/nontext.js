// L16: non-text checks on the controls SAM found. For every icon, button and input region in a hybrid run:
//   1. ask SAM 3.1 for a precise outline with a point prompt at the region's center (one call per control, cached);
//   2. WCAG 1.4.11 non-text contrast (3:1): the control's own colors against the pixels just outside its mask;
//   3. WCAG 2.5.8 target size (24x24 CSS px minimum) for every clickable control;
//   4. map a failing color to the token that controls it.
// Output: <run>/nontext.json + <run>/nontext/<id>.png crops. Pixel math is pure and exported for tests.
// Data policy: same as meta-sam.js (public screenshots only, standard model id, never a "-contributor" variant).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { PNG } from 'pngjs'
import { cached } from '../lib/cache.js'
import { recordCall } from '../lib/metrics.js'
import { decodeMaskData } from '../lib/sam-mask.js'
import { extractOutputText, responsesUrl, mapLimit, TILE_H } from '../providers/segment/meta-sam.js'
import { contrastRatio, toHex, parseColor, tokensForColor, round2 } from '../preview-client/contrast.js'

export const CONTROL_LABELS = ['icon', 'button', 'input']
export const NONTEXT_MIN = 3 // WCAG 1.4.11
export const TARGET_MIN = 24 // WCAG 2.5.8 (AA), CSS px; the screenshot is captured at device scale 1
export const STRONGEST_SHARE = 0.1 // an icon's color = its strongest 10% of pixels (see nontextContrast)

// ---------------------------------------------------------------------------------------------------------------
// SAM point prompt
// ---------------------------------------------------------------------------------------------------------------

/** `<0f>1<|point;x=..;y=..;w=W;h=H|>`: one positive point in a W x H frame (format checked live 2026-10-26). */
export const pointPrompt = (x, y, w, h) => `<0f>1<|point;x=${Math.round(x)};y=${Math.round(y)};w=${w};h=${h}|>`

// Records are `id<|box;...|><|mask;...|>`, comma-separated; parse box + mask fields by name.
const REC_RE = /<\|box;([^|]*)\|>\s*(?:<\|mask;([^|]*)\|>)?/g
const fields = (s) => Object.fromEntries(String(s).split(';').map((kv) => kv.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]))

/** output_text -> [{box:{x1,y1,x2,y2,w,h}, maskData?}] (x2/y2 inclusive, as on the wire). Pure. */
export function parseDetections(text) {
  const out = []
  let m
  const re = new RegExp(REC_RE)
  while ((m = re.exec(String(text || '')))) {
    const b = fields(m[1])
    const box = { x1: Number(b.x1), y1: Number(b.y1), x2: Number(b.x2), y2: Number(b.y2), w: Number(b.w), h: Number(b.h) }
    if (![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)) continue
    const mk = m[2] ? fields(m[2]) : null
    out.push({ box, maskData: mk && mk.data ? mk.data : undefined })
  }
  return out
}

/** IoU of two [x,y,w,h] boxes. */
export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const u = a[2] * a[3] + b[2] * b[3] - inter
  return u > 0 ? inter / u : 0
}

/**
 * A detection (request-frame coords) -> an outline in page px: {bbox, width, height, bits}. The mask raster covers the
 * inclusive box; when the API's frame differs from the image we sent, it is resampled (nearest) to page px.
 * @param {{box:any, maskData?:string}} det
 * @param {{x:number,y:number}} origin  page px of the sent image's top-left
 * @param {{width:number,height:number}} sent size of the image we sent
 */
export function outlineFromDetection(det, origin, sent) {
  const { x1, y1, x2, y2, w, h } = det.box
  const sx = w ? sent.width / w : 1, sy = h ? sent.height / h : 1
  const bbox = [Math.round(x1 * sx) + origin.x, Math.round(y1 * sy) + origin.y, Math.max(1, Math.round((x2 - x1 + 1) * sx)), Math.max(1, Math.round((y2 - y1 + 1) * sy))]
  let bits = null
  if (det.maskData) {
    try {
      const m = decodeMaskData(det.maskData)
      if (m.width === bbox[2] && m.height === bbox[3]) bits = m.bits
      else {
        bits = new Uint8Array(bbox[2] * bbox[3])
        for (let y = 0; y < bbox[3]; y++) for (let x = 0; x < bbox[2]; x++) {
          bits[y * bbox[2] + x] = m.bits[Math.min(m.height - 1, Math.floor((y * m.height) / bbox[3])) * m.width + Math.min(m.width - 1, Math.floor((x * m.width) / bbox[2]))]
        }
      }
    } catch (e) { bits = null }
  }
  if (!bits) bits = new Uint8Array(bbox[2] * bbox[3]).fill(1) // no mask: the box itself
  return { bbox, width: bbox[2], height: bbox[3], bits, fromMask: !!det.maskData }
}

/** Pick the detection that best matches the region we asked about (highest IoU, else the one containing the point). */
export function pickDetection(outlines, regionBbox, point) {
  if (!outlines.length) return null
  const scored = outlines.map((o) => ({ o, s: iou(o.bbox, regionBbox), inside: point[0] >= o.bbox[0] && point[0] < o.bbox[0] + o.bbox[2] && point[1] >= o.bbox[1] && point[1] < o.bbox[1] + o.bbox[3] }))
  scored.sort((a, b) => b.s - a.s || (b.inside - a.inside))
  return { outline: scored[0].o, iou: scored[0].s }
}

export async function callSamPoint({ baseURL, apiKey, model, imageDataUrl, prompt }, stats) {
  const req = { kind: 'point', baseURL, model, prompt, image: createHash('sha256').update(imageDataUrl).digest('hex') }
  const t0 = Date.now()
  const { cached: hit, ...json } = await cached('sam', req, async () => {
    const res = await fetch(responsesUrl(baseURL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl }] }],
        metadata: { mask_encoding: 'one_bit' },
        store: false,
      }),
    })
    if (!res.ok) throw new Error(`SAM 3.1 ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res.json()
  })
  const ms = Date.now() - t0
  recordCall({ kind: 'sam', model, ms, cached: !!hit })
  stats.push({ ms, cached: !!hit })
  return json
}

// ---------------------------------------------------------------------------------------------------------------
// Pixel math (pure)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Chessboard distance from every pixel of a padded grid to the mask (0 inside), up to `max`.
 * Grid = mask box grown by `pad` on every side. Returns {dist, gw, gh}.
 */
export function distanceField(bits, w, h, pad, max = pad) {
  const gw = w + 2 * pad, gh = h + 2 * pad
  const INF = 255
  const dist = new Uint8Array(gw * gh).fill(INF)
  let frontier = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bits[y * w + x]) { const i = (y + pad) * gw + x + pad; dist[i] = 0; frontier.push(i) }
  for (let d = 1; d <= max && frontier.length; d++) {
    const next = []
    for (const i of frontier) {
      const x = i % gw, y = (i - x) / gw
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const j = ny * gw + nx
        if (dist[j] === INF) { dist[j] = d; next.push(j) }
      }
    }
    frontier = next
  }
  return { dist, gw, gh }
}

/** Erode a mask by r px (chessboard): a pixel stays if every pixel within r is in the mask (edges count as outside). */
export function erode(bits, w, h, r) {
  if (r <= 0) return bits
  // Distance from each mask pixel to the nearest non-mask pixel, via the complement's distance field.
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) inv[i] = bits[i] ? 0 : 1
  const pad = 1
  const gw = w + 2, gh = h + 2
  const comp = new Uint8Array(gw * gh).fill(1) // the 1 px frame outside the box counts as outside
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) comp[(y + pad) * gw + x + pad] = inv[y * w + x]
  const { dist } = distanceField(comp, gw, gh, 0, r)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = bits[y * w + x] && dist[(y + pad) * gw + x + pad] > r ? 1 : 0
  return out
}

/**
 * Sample screenshot pixels for one outline: `inside` = mask pixels eroded by `inset` (drops the anti-aliased edge),
 * `edge` = mask pixels within `edgeW` of the mask's edge, `ring` = pixels `gap` < d <= `gap + ringW` outside it.
 * @param {{width:number,height:number,data:Uint8Array|Buffer}} img RGBA
 * @param {{bbox:number[], width:number, height:number, bits:Uint8Array}} outline
 */
export function sampleRing(img, outline, o = {}) {
  const { gap = 1, ringW = 3, inset = 1, edgeW = 2 } = o
  const [bx, by] = outline.bbox
  const w = outline.width, h = outline.height
  const pad = gap + ringW
  const { dist, gw } = distanceField(outline.bits, w, h, pad)
  const px = (X, Y) => {
    if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) return null
    const k = (Y * img.width + X) * 4
    return [img.data[k], img.data[k + 1], img.data[k + 2]]
  }
  const ring = []
  for (let y = 0; y < h + 2 * pad; y++) for (let x = 0; x < gw; x++) {
    const d = dist[y * gw + x]
    if (d > gap && d <= gap + ringW) { const p = px(bx + x - pad, by + y - pad); if (p) ring.push(p) }
  }
  const core = erode(outline.bits, w, h, inset)
  const deep = erode(outline.bits, w, h, edgeW)
  const inside = [], edge = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (!outline.bits[i]) continue
    const p = px(bx + x, by + y)
    if (!p) continue
    if (core[i]) inside.push(p)
    if (!deep[i]) edge.push(p)
  }
  return { inside: inside.length ? inside : edge, edge, ring }
}

/**
 * Color clusters by 4-bit-per-channel bins: [{color:{r,g,b,a}, share}] largest first, each the mean of its bin.
 * Merges a bin into an earlier one when their means are within `merge` (RGB distance) so gradients don't split.
 */
export function colorClusters(pixels, o = {}) {
  const { merge = 24, limit = 4 } = o
  if (!pixels.length) return []
  const bins = new Map()
  for (const [r, g, b] of pixels) {
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const e = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += r; e.g += g; e.b += b
    bins.set(k, e)
  }
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n)
  const groups = []
  for (const e of sorted) {
    const c = [e.r / e.n, e.g / e.n, e.b / e.n]
    const g = groups.find((x) => Math.hypot(x.c[0] - c[0], x.c[1] - c[1], x.c[2] - c[2]) <= merge)
    if (g) { g.n += e.n; g.r += e.r; g.g += e.g; g.b += e.b } else groups.push({ c, n: e.n, r: e.r, g: e.g, b: e.b })
  }
  return groups.sort((a, b) => b.n - a.n).slice(0, limit).map((g) => ({
    color: { r: Math.round(g.r / g.n), g: Math.round(g.g / g.n), b: Math.round(g.b / g.n), a: 1 },
    share: Math.round((g.n / pixels.length) * 1000) / 1000,
  }))
}

/**
 * Non-text contrast from samples. Icons: the best of (icon fill vs ring) and (second color inside vs the fill, e.g. a
 * glyph on a colored circle, or line strokes inside a mask that also covers the gaps). Buttons/inputs: the best of
 * (edge/border color vs ring) and (fill vs ring): the control's boundary against what surrounds it.
 * @returns {{ratio:number, fg:string, bg:string, basis:string, fill:string, ring:string}|null}
 */
export function nontextContrast(label, s) {
  const ringC = colorClusters(s.ring)[0]
  const inC = colorClusters(s.inside)
  if (!ringC || !inC.length) return null
  const ring = ringC.color
  const cands = []
  const fill = inC[0].color
  cands.push({ fg: fill, bg: ring, basis: label === 'icon' ? 'icon vs surroundings' : 'fill vs surroundings' })
  if (label === 'icon') {
    // Thin strokes are a minority of an icon's mask and anti-aliasing spreads them over many shades, so instead of a
    // second color cluster take the strongest tenth of the inside pixels: against the ring (a line icon on the page)
    // and against the icon's own fill (a glyph on a colored circle). Under 10% of the mask, this underestimates.
    const strongest = (ref) => {
      const scored = s.inside.map((p) => ({ p, r: contrastRatio({ r: p[0], g: p[1], b: p[2], a: 1 }, ref) })).sort((a, b) => a.r - b.r)
      const q = scored[Math.min(scored.length - 1, Math.floor(scored.length * (1 - STRONGEST_SHARE)))]
      return { r: q.p[0], g: q.p[1], b: q.p[2], a: 1 }
    }
    cands.push({ fg: strongest(ring), bg: ring, basis: 'glyph vs surroundings' })
    cands.push({ fg: strongest(fill), bg: fill, basis: 'glyph vs its shape' })
  } else {
    // A 1 px border is a minority of the edge band; every edge color with a real share is a candidate.
    for (const e of colorClusters(s.edge)) if (e.share >= 0.1) cands.push({ fg: e.color, bg: ring, basis: 'border vs surroundings' })
  }
  let best = null
  for (const c of cands) {
    const r = contrastRatio(c.fg, c.bg)
    if (!best || r > best.ratio) best = { ratio: r, fg: toHex(c.fg), bg: toHex(c.bg), basis: c.basis }
  }
  return { ...best, ratio: round2(best.ratio), fill: toHex(fill), ring: toHex(ring) }
}

/** Target size verdict for a hit area [x,y,w,h]. */
export const targetSize = (bbox) => ({ w: bbox[2], h: bbox[3], pass: bbox[2] >= TARGET_MIN && bbox[3] >= TARGET_MIN })

/**
 * WCAG 2.5.8 spacing exception, simplified to the targets we found: an undersized target passes if a 24 px circle on
 * its center does not intersect another target, nor the circle of another undersized target.
 * @param {{bbox:number[], undersized:boolean}} t
 * @param {{bbox:number[], undersized:boolean}[]} others
 */
export function spacingOk(t, others) {
  const c = [t.bbox[0] + t.bbox[2] / 2, t.bbox[1] + t.bbox[3] / 2]
  const R = TARGET_MIN / 2
  for (const o of others) {
    if (o === t) continue
    const dx = Math.max(o.bbox[0] - c[0], 0, c[0] - (o.bbox[0] + o.bbox[2]))
    const dy = Math.max(o.bbox[1] - c[1], 0, c[1] - (o.bbox[1] + o.bbox[3]))
    if (Math.hypot(dx, dy) < R) return false
    if (o.undersized) {
      const oc = [o.bbox[0] + o.bbox[2] / 2, o.bbox[1] + o.bbox[3] / 2]
      if (Math.hypot(oc[0] - c[0], oc[1] - c[1]) < 2 * R) return false
    }
  }
  return true
}

const INTERACTIVE = /^(a|button|input|select|textarea|summary|label)$/i
/**
 * The clickable DOM element under a point, or null (capture.json `clickable`; older captures lack it). `clickable` is
 * inherited (a pointer cursor, a link ancestor), so a child icon is "clickable" too: prefer the smallest real control
 * (a, button, input, ... or a role), else the outermost clickable element (div soup: the div with the pointer cursor).
 */
export function clickableAt(elements, x, y) {
  const hits = (elements || []).filter((e) => {
    if (!e.clickable || !e.bbox) return false
    const [ex, ey, ew, eh] = e.bbox
    return ew > 0 && eh > 0 && x >= ex && x < ex + ew && y >= ey && y < ey + eh
  })
  if (!hits.length) return null
  const area = (e) => e.bbox[2] * e.bbox[3]
  const real = hits.filter((e) => INTERACTIVE.test(e.tag || '') || /^(button|link|tab|menuitem|checkbox|radio|switch)$/.test(e.role || ''))
  if (real.length) return real.sort((a, b) => area(a) - area(b))[0]
  return hits.sort((a, b) => area(b) - area(a))[0]
}

/**
 * Visible text inside a control: the smallest captured element with text that contains the control's center and
 * fits within the control's box (4 px slack), so a header's text never labels the icon button inside it. Or null.
 */
export function textAt(elements, bbox) {
  const [x, y, w, h] = bbox
  const cx = x + w / 2, cy = y + h / 2, s = 4
  let best = null
  for (const e of elements || []) {
    if (!e.bbox || !e.text || !String(e.text).trim()) continue
    const [ex, ey, ew, eh] = e.bbox
    const contains = cx >= ex && cx < ex + ew && cy >= ey && cy < ey + eh
    const fits = ex >= x - s && ey >= y - s && ex + ew <= x + w + s && ey + eh <= y + h + s
    if (contains && fits && (!best || ew * eh < best.bbox[2] * best.bbox[3])) best = e
  }
  return best ? String(best.text).trim().slice(0, 40) : null
}

/** Resolved [{name, tier, value}] from tokens.json (aliases followed). */
export function tokenValues(tokens) {
  const list = (tokens && tokens.tokens) || []
  const by = new Map(list.map((t) => [t.name, t]))
  const resolve = (t, seen = new Set()) => (!t || seen.has(t.name) ? null : t.value != null ? t.value : (seen.add(t.name), resolve(by.get(t.alias), seen)))
  return list.map((t) => ({ name: t.name, tier: t.tier, value: resolve(t) })).filter((t) => t.value && parseColor(t.value))
}

/** Tokens for a sampled pixel color: exact value match first (semantic first), else the nearest color token within `tol`. */
export function tokenForPixel(hex, values, tol = 10) {
  const exact = tokensForColor(hex, values.filter((t) => parseColor(t.value).a === 1))
  if (exact.length) return { tokens: exact, exact: true }
  const c = parseColor(hex)
  let best = null
  for (const t of values) {
    const v = parseColor(t.value)
    if (v.a < 1) continue
    const d = Math.hypot(v.r - c.r, v.g - c.g, v.b - c.b)
    if (d <= tol && (!best || d < best.d)) best = { d, value: t.value }
  }
  // Every token with the nearest value, semantic first (the decision a person would change).
  return best ? { tokens: tokensForColor(best.value, values), exact: false } : { tokens: [], exact: false }
}

/** Crop around the outline, scaled 3x, mask edge drawn in magenta. Returns a PNG. */
export function cropPng(img, outline, o = {}) {
  const { pad = 8 } = o
  const [bx, by, bw, bh] = outline.bbox
  const x0 = Math.max(0, bx - pad), y0 = Math.max(0, by - pad)
  const x1 = Math.min(img.width, bx + bw + pad), y1 = Math.min(img.height, by + bh + pad)
  const cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0)
  // Small icons get blown up more (about 120 px on the long side), wide inputs stay near 1:1.
  const scale = o.scale || Math.max(1, Math.min(6, Math.round(120 / Math.max(cw, ch))))
  const png = new PNG({ width: cw * scale, height: ch * scale })
  const inMask = (X, Y) => { const x = X - bx, y = Y - by; return x >= 0 && y >= 0 && x < bw && y < bh && !!outline.bits[y * bw + x] }
  for (let Y = 0; Y < ch * scale; Y++) for (let X = 0; X < cw * scale; X++) {
    const sx = x0 + Math.floor(X / scale), sy = y0 + Math.floor(Y / scale)
    const k = (sy * img.width + sx) * 4, d = (Y * cw * scale + X) * 4
    png.data[d] = img.data[k]; png.data[d + 1] = img.data[k + 1]; png.data[d + 2] = img.data[k + 2]; png.data[d + 3] = 255
    // Outline: a mask pixel with a 4-neighbour outside, drawn on the outer sub-pixel row/column only.
    if (inMask(sx, sy)) {
      const fx = X % scale, fy = Y % scale
      const edge = (fx === 0 && !inMask(sx - 1, sy)) || (fx === scale - 1 && !inMask(sx + 1, sy)) || (fy === 0 && !inMask(sx, sy - 1)) || (fy === scale - 1 && !inMask(sx, sy + 1))
      if (edge) { png.data[d] = 255; png.data[d + 1] = 0; png.data[d + 2] = 255 }
    }
  }
  return PNG.sync.write(png)
}

// ---------------------------------------------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------------------------------------------

/** The image to send for a region: its 1600 px tile, or a 1600 px window centered on it if it straddles a tile edge. */
export function windowFor(full, bbox, tileH = TILE_H) {
  if (full.height <= tileH) return { y: 0, png: full }
  let y = Math.floor(bbox[1] / tileH) * tileH
  if (bbox[1] + bbox[3] > y + tileH) y = Math.max(0, Math.min(full.height - tileH, Math.round(bbox[1] + bbox[3] / 2 - tileH / 2)))
  const h = Math.min(tileH, full.height - y)
  const t = new PNG({ width: full.width, height: h })
  PNG.bitblt(full, t, 0, y, full.width, h, 0, 0)
  return { y, png: t }
}

/** A point on the region to prompt with: its center, or (if a concept mask exists and misses the center) the nearest mask pixel. */
function promptPoint(region, runDir) {
  const [x, y, w, h] = region.bbox
  const c = [x + w / 2, y + h / 2]
  if (!region.mask || !existsSync(join(runDir, region.mask))) return c
  try {
    const m = decodeMaskData(readFileSync(join(runDir, region.mask), 'utf-8'))
    const mx = Math.min(m.width - 1, Math.floor((c[0] - x) * m.width / w)), my = Math.min(m.height - 1, Math.floor((c[1] - y) * m.height / h))
    if (m.bits[my * m.width + mx]) return c
    let best = null
    for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) {
      if (!m.bits[j * m.width + i]) continue
      const d = (i - mx) ** 2 + (j - my) ** 2
      if (!best || d < best.d) best = { d, i, j }
    }
    return best ? [x + (best.i + 0.5) * w / m.width, y + (best.j + 0.5) * h / m.height] : c
  } catch (e) { return c }
}

/**
 * Run the non-text checks on a run folder that has capture.json, regions.json and the screenshot.
 * @param {string} runDir
 * @param {{log?:(m:string)=>void, max?:number, concurrency?:number}} [o]
 */
export async function runNontext(runDir, o = {}) {
  const log = o.log || (() => {})
  const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
  const capture = rd('capture')
  const regions = rd('regions')
  const tokens = existsSync(join(runDir, 'tokens.json')) ? rd('tokens') : null
  const values = tokenValues(tokens)
  const full = PNG.sync.read(readFileSync(join(runDir, capture.screenshot)))
  const max = o.max || Number(process.env.S2T_NONTEXT_MAX || 150)
  const controls = regions.filter((r) => CONTROL_LABELS.includes(r.label)).slice(0, max)

  const apiKey = process.env.META_API_KEY
  const baseURL = process.env.META_API_BASE_URL || 'https://api.meta.ai/v1'
  const model = process.env.META_SAM_MODEL || 'sam-3.1'
  if (/-contributor$/.test(model)) throw new Error('refusing a "-contributor" SAM model id (that tier trains on submitted data)')
  const useSam = !!apiKey && process.env.S2T_NONTEXT_SAM !== '0'
  if (!useSam) log('nontext   no META_API_KEY (or S2T_NONTEXT_SAM=0): using the hybrid run\'s own masks/boxes')

  const stats = []
  const t0 = Date.now()
  const outlines = await mapLimit(controls, o.concurrency || Number(process.env.S2T_SAM_CONCURRENCY || 4), async (r) => {
    const point = promptPoint(r, runDir)
    const fallback = () => {
      let det = { box: { x1: r.bbox[0], y1: r.bbox[1], x2: r.bbox[0] + r.bbox[2] - 1, y2: r.bbox[1] + r.bbox[3] - 1, w: full.width, h: full.height } }
      if (r.mask && existsSync(join(runDir, r.mask))) det = { ...det, maskData: readFileSync(join(runDir, r.mask), 'utf-8') }
      return outlineFromDetection(det, { x: 0, y: 0 }, { width: full.width, height: full.height })
    }
    if (!useSam) return { outline: fallback(), source: r.mask ? 'concept-mask' : 'box', point }
    const win = windowFor(full, r.bbox)
    const imageDataUrl = `data:image/png;base64,${PNG.sync.write(win.png).toString('base64')}`
    try {
      const json = await callSamPoint({ baseURL, apiKey, model, imageDataUrl, prompt: pointPrompt(point[0], point[1] - win.y, win.png.width, win.png.height) }, stats)
      const dets = parseDetections(extractOutputText(json)).map((d) => outlineFromDetection(d, { x: 0, y: win.y }, { width: win.png.width, height: win.png.height }))
      const pick = pickDetection(dets, r.bbox, point)
      // A point that lands on the page behind a control returns the page: keep the hybrid outline instead.
      if (!pick || pick.iou < 0.3) return { outline: fallback(), source: r.mask ? 'concept-mask' : 'box', point, note: pick ? `point outline IoU ${round2(pick.iou)} with the region; kept the region's outline` : 'point prompt returned nothing' }
      return { outline: pick.outline, source: pick.outline.fromMask ? 'sam-point-mask' : 'sam-point-box', point, iou: round2(pick.iou) }
    } catch (e) {
      return { outline: fallback(), source: r.mask ? 'concept-mask' : 'box', point, note: `SAM point call failed: ${e.message.slice(0, 120)}` }
    }
  })
  const samMs = Date.now() - t0

  mkdirSync(join(runDir, 'nontext'), { recursive: true })
  const items = controls.map((r, i) => {
    const { outline, source, point, iou: ov, note } = outlines[i]
    const s = sampleRing(full, outline)
    const c = nontextContrast(r.label, s)
    const cx = outline.bbox[0] + outline.bbox[2] / 2, cy = outline.bbox[1] + outline.bbox[3] / 2
    const el = clickableAt(capture.elements, cx, cy)
    const knowsClick = (capture.elements || []).some((e) => e.clickable !== undefined)
    // Buttons and inputs are targets by definition; icons only when something clickable sits under them.
    const clickable = r.label === 'icon' ? (knowsClick ? !!el : null) : true
    // Hit area: the clickable element under the control when the DOM has one (padding counts), else what SAM outlined.
    const hit = el && r.label !== 'icon' ? (el.bbox[2] * el.bbox[3] >= outline.bbox[2] * outline.bbox[3] ? el.bbox : outline.bbox) : el ? el.bbox : outline.bbox
    const size = clickable ? targetSize(hit) : null
    const contrastPass = c ? c.ratio >= NONTEXT_MIN : null
    // A button whose visible text names it needs no boundary under 1.4.11; a low ratio there is for review.
    const textLabel = r.label === 'button' ? textAt(capture.elements, outline.bbox) : null
    let token = null
    if (c && !contrastPass) {
      const fgT = tokenForPixel(c.fg, values), bgT = tokenForPixel(c.bg, values)
      token = { fg: fgT.tokens[0] || null, bg: bgT.tokens[0] || null, exact: fgT.exact && bgT.exact, fgAll: fgT.tokens.slice(0, 3), bgAll: bgT.tokens.slice(0, 3) }
    }
    const crop = `nontext/${r.id}.png`
    try { writeFileSync(join(runDir, crop), cropPng(full, outline)) } catch (e) { /* a crop failure never fails the stage */ }
    const fill = outline.bits.reduce((n, b) => n + b, 0) / outline.bits.length
    return {
      id: r.id, label: r.label, regionSource: r.source, outlineSource: source, iou: ov ?? null, note: note || undefined,
      point: point.map((v) => Math.round(v)), bbox: outline.bbox, maskFill: round2(fill),
      contrast: c ? { ...c, pass: contrastPass, required: NONTEXT_MIN, ...(textLabel ? { textLabel, boundaryRequired: false } : {}) } : null,
      clickable, hitArea: clickable ? hit : null, hitFrom: clickable ? (el ? 'dom' : 'sam') : null,
      size, token, crop,
    }
  })
  // Spacing exception for undersized targets (simplified; see spacingOk).
  const targets = items.filter((t) => t.size).map((t) => ({ bbox: t.hitArea, undersized: !t.size.pass, t }))
  for (const tg of targets) if (tg.undersized) tg.t.size.spacingException = spacingOk(tg, targets)

  const uncached = stats.filter((s) => !s.cached).map((s) => s.ms).sort((a, b) => a - b)
  const out = {
    checks: { nontextContrast: 'WCAG 1.4.11 (3:1)', targetSize: 'WCAG 2.5.8 (24x24 CSS px)' },
    controls: items.length,
    byLabel: CONTROL_LABELS.reduce((m, l) => ({ ...m, [l]: items.filter((x) => x.label === l).length }), {}),
    contrastFailing: items.filter((x) => x.contrast && !x.contrast.pass).length,
    contrastMeasured: items.filter((x) => x.contrast).length,
    // Of those below 3:1: icons, inputs, and buttons with no visible text (where the boundary is what identifies them).
    contrastFailingNeedsBoundary: items.filter((x) => x.contrast && !x.contrast.pass && !x.contrast.textLabel).length,
    targets: targets.length,
    undersized: items.filter((x) => x.size && !x.size.pass).length,
    undersizedNoSpacing: items.filter((x) => x.size && !x.size.pass && !x.size.spacingException).length,
    tokenMapped: items.filter((x) => x.token && (x.token.fg || x.token.bg)).length,
    sam: {
      model: useSam ? model : null, calls: stats.length, cached: stats.filter((s) => s.cached).length,
      uncachedMedianMs: uncached.length ? uncached[Math.floor(uncached.length / 2)] : null,
      uncachedMaxMs: uncached.length ? uncached[uncached.length - 1] : null,
      wallMs: samMs, outlines: items.reduce((m, x) => ({ ...m, [x.outlineSource]: (m[x.outlineSource] || 0) + 1 }), {}),
    },
    items,
  }
  writeFileSync(join(runDir, 'nontext.json'), JSON.stringify(out, null, 2))
  log(`nontext   ${out.controls} controls (${Object.entries(out.byLabel).map(([k, v]) => `${v} ${k}`).join(', ')}); contrast below 3:1: ${out.contrastFailing} (${out.contrastFailingNeedsBoundary} without a text label); targets under 24x24: ${out.undersized} (${out.undersizedNoSpacing} without the spacing exception); SAM ${out.sam.calls} calls (${out.sam.cached} cached), ${(samMs / 1000).toFixed(1)} s`)
  return out
}

/** One line per control, for the CLI and the demo. */
export function formatNontext(out) {
  const lines = out.items.map((x) => {
    const c = x.contrast ? `${x.contrast.ratio.toFixed(2)}:1 ${x.contrast.pass ? 'ok    ' : x.contrast.textLabel ? 'review' : 'LOW   '}` : 'n/a         '
    const s = x.size ? `${x.size.w}x${x.size.h} ${x.size.pass ? 'ok' : x.size.spacingException ? 'small (spacing ok)' : 'SMALL'}` : 'not a target'
    const t = x.token ? `  token: ${x.token.fg || x.token.bg ? `${x.token.fg || '(none)'} on ${x.token.bg || '(none)'}` : 'none matched'}` : ''
    return `  ${x.id.padEnd(4)} ${x.label.padEnd(6)} [${x.bbox.join(',')}]  contrast ${c}  size ${s}${t}`
  })
  return lines.join('\n')
}
