// Join: attach every sampled style value to the smallest region that contains its element.
// This is what lets the namer say "this blue is the primary button background".
import { STYLE_PROPS, normalizeFor } from '../lib/props.js'

const TEXT_PROPS = new Set(['color', 'font-size', 'font-weight', 'font-family', 'line-height'])

/** Fraction of box a inside box b. Boxes are [x, y, w, h]. */
export function containment(a, b) {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[0] + a[2], b[0] + b[2])
  const y2 = Math.min(a[1] + a[3], b[1] + b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const area = a[2] * a[3]
  return area > 0 ? inter / area : 0
}

/**
 * Smallest region containing ≥ 90% of the element box, or null.
 * @param {[number,number,number,number]} bbox
 * @param {import('../types.js').Region[]} regions
 */
export function regionFor(bbox, regions) {
  let best = null
  let bestArea = Infinity
  for (const r of regions) {
    if (containment(bbox, r.bbox) < 0.9) continue
    const area = r.bbox[2] * r.bbox[3]
    if (area < bestArea) { best = r; bestArea = area }
  }
  return best
}

/**
 * @param {import('../types.js').Capture} capture
 * @param {import('../types.js').Region[]} regions
 * @returns {(import('../types.js').ValueUse & {kind:string, value:string})[]}
 */
export function collectUses(capture, regions) {
  const uses = []
  for (const e of capture.elements) {
    const r = regionFor(e.bbox, regions)
    for (const [prop, raw] of Object.entries(e.styles || {})) {
      const kind = STYLE_PROPS[prop]
      if (!kind) continue
      // Text props inherit down the tree; only count them where text is actually drawn.
      if (TEXT_PROPS.has(prop) && !e.text) continue
      const value = normalizeFor(kind, raw)
      if (!value) continue
      uses.push({ raw, prop, element: e.i, region: r ? r.id : null, regionLabel: r ? r.label : null, kind, value })
    }
  }
  return uses
}
