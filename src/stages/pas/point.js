// Point and say: what did the person click? SAM 3.1 point prompt on the run's screenshot (the same tiling as the
// non-text checks) -> outline; the captured DOM element under the point; the colour tokens whose value equals its
// colours (the live page confirms which one actually controls it); and its twins from the run's hybrid regions.
// Data: public demo-app screenshots only; `store: false`; never a "-contributor" model id.
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'
import { pointPrompt, parseDetections, outlineFromDetection, callSamPoint, windowFor, sampleRing, tokenValues } from '../nontext.js'
import { extractOutputText } from '../../providers/segment/meta-sam.js'
import { tokensForColor, parseColor, toHex } from '../../preview-client/contrast.js'
import { regionColors, findTwins, ownColor, kindOf, regionOutline } from './twins.js'

/** Load a run once: screenshot, capture, regions, tokens, and every control region's own colour (for twins). */
export function loadPointContext(runDir) {
  const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
  const capture = rd('capture')
  const regions = rd('regions')
  const tokens = existsSync(join(runDir, 'tokens.json')) ? rd('tokens') : { tokens: [] }
  const full = PNG.sync.read(readFileSync(join(runDir, capture.screenshot)))
  return { runDir, capture, regions, tokens, values: tokenValues(tokens), full, colors: regionColors(runDir, regions, full), cache: new Map() }
}

/** Pick the outline for a click: the smallest detection that contains the point, else the nearest one. Pure. */
export function pickForPoint(outlines, point) {
  if (!outlines.length) return null
  const inside = (o) => point[0] >= o.bbox[0] && point[0] < o.bbox[0] + o.bbox[2] && point[1] >= o.bbox[1] && point[1] < o.bbox[1] + o.bbox[3]
  const hits = outlines.filter(inside).sort((a, b) => a.bbox[2] * a.bbox[3] - b.bbox[2] * b.bbox[3])
  if (hits.length) return hits[0]
  const d = (o) => Math.hypot(o.bbox[0] + o.bbox[2] / 2 - point[0], o.bbox[1] + o.bbox[3] / 2 - point[1])
  return outlines.slice().sort((a, b) => d(a) - d(b))[0]
}

/** The captured element under a point: smallest box containing it, elements with their own text first. Pure. */
export function elementAt(elements, x, y) {
  const hits = (elements || []).filter((e) => x >= e.bbox[0] && x < e.bbox[0] + e.bbox[2] && y >= e.bbox[1] && y < e.bbox[1] + e.bbox[3])
  hits.sort((a, b) => (!!(b.text || '').trim() - !!(a.text || '').trim()) || a.bbox[2] * a.bbox[3] - b.bbox[2] * b.bbox[3])
  return hits[0] || null
}

/** Colour tokens per property for a captured element (value match, semantic first). Pure. */
export function tokensForElement(el, values) {
  const out = {}
  for (const prop of ['color', 'background-color', 'border-top-color']) {
    const v = el && el.styles && el.styles[prop]
    const c = parseColor(v)
    if (!c || c.a === 0) continue
    out[prop] = { value: toHex(c), tokens: tokensForColor(v, values) }
  }
  return out
}

/** The hybrid control region under a point (smallest), if any. */
function regionAt(regions, x, y) {
  const hits = regions.filter((r) => kindOf(r.label) && r.source !== 'layout' && x >= r.bbox[0] && x < r.bbox[0] + r.bbox[2] && y >= r.bbox[1] && y < r.bbox[1] + r.bbox[3])
  return hits.sort((a, b) => a.bbox[2] * a.bbox[3] - b.bbox[2] * b.bbox[3])[0] || null
}

/**
 * Resolve a click at page px (x, y). Returns {outline, sam:{ms, source}, element, tokens, own, twins, near}.
 * @param {ReturnType<typeof loadPointContext>} ctx
 */
export async function pointAt(ctx, x, y, o = {}) {
  const key = `${Math.round(x)},${Math.round(y)}`
  if (ctx.cache.has(key)) return { ...ctx.cache.get(key), cachedClick: true }
  const { full } = ctx
  const apiKey = process.env.META_API_KEY
  const baseURL = process.env.META_API_BASE_URL || 'https://api.meta.ai/v1'
  const model = process.env.META_SAM_MODEL || 'sam-3.1'
  if (/-contributor$/.test(model)) throw new Error('refusing a "-contributor" SAM model id')
  let outline = null, source = 'none', ms = 0, note
  if (apiKey && o.sam !== false) {
    const win = windowFor(full, [x, y, 1, 1])
    const imageDataUrl = `data:image/png;base64,${PNG.sync.write(win.png).toString('base64')}`
    const stats = []
    const t0 = Date.now()
    try {
      const json = await callSamPoint({ baseURL, apiKey, model, imageDataUrl, prompt: pointPrompt(x, y - win.y, win.png.width, win.png.height) }, stats)
      const dets = parseDetections(extractOutputText(json)).map((d) => outlineFromDetection(d, { x: 0, y: win.y }, { width: win.png.width, height: win.png.height }))
      outline = pickForPoint(dets, [x, y])
      source = outline ? (outline.fromMask ? 'sam-point-mask' : 'sam-point-box') : 'none'
    } catch (e) { note = `SAM point call failed: ${String(e.message).slice(0, 120)}` }
    ms = Date.now() - t0
    if (stats[0] && stats[0].cached) source += ' (cached)'
  }
  const element = elementAt(ctx.capture.elements, x, y)
  const region = regionAt(ctx.regions, x, y)
  // Twins need a control: the hybrid region under the click (its kind), coloured from the SAM outline when we have one.
  let own = null, twins = [], near = []
  // Colour the click the same way the candidates are coloured (the hybrid region's outline) so the two samples are
  // comparable; SAM's outline is for display, and the basis when no region is under the click.
  const basis = region ? regionOutline(ctx.runDir, region, full) : outline
  if (basis) own = ownColor(sampleRing(full, basis))
  const kind = region ? kindOf(region.label) : null
  if (own && kind) ({ twins, near } = findTwins({ kind, bbox: basis.bbox, color: own.color, basis: own.basis, ring: own.ring }, ctx.colors))
  const result = {
    point: [Math.round(x), Math.round(y)],
    outline: outline ? { bbox: outline.bbox, fromMask: outline.fromMask, fill: Math.round(outline.bits.reduce((n, b) => n + b, 0) / outline.bits.length * 100) / 100 } : null,
    sam: { ms, source, note },
    region: region ? { id: region.id, label: region.label, bbox: region.bbox } : null,
    element: element ? { i: element.i, tag: element.tag, path: element.path, classes: element.classes, text: element.text, bbox: element.bbox, color: element.styles.color, background: element.styles['background-color'] } : null,
    tokens: tokensForElement(element, ctx.values),
    own: own ? { hex: own.hex, ring: own.ring, basis: own.basis } : null,
    twins, near,
  }
  ctx.cache.set(key, result)
  return result
}
