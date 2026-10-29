// Point and say: "twins" of a clicked control = other controls that look like it (same kind, own colour within
// ΔE 6, comparable size), from the run's hybrid regions. SAM segments only what was clicked (a point prompt never
// returns look-alikes; checked 2026-10-26), so this match is ours. Twins are highlights, not the change: the token's
// own reach is what applies, and the re-audit reports every element it affected.
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { outlineFromDetection, sampleRing, colorClusters, CONTROL_LABELS } from '../nontext.js'
import { toHex, round2, parseColor } from '../../preview-client/contrast.js'

export const TWIN_DE = 6 // CIE76 ΔE on CIELAB (D65)
export const SIZE_RATIO = 2 // width and height each within 2x (Argon: Month 76x37 and "See all" 56x28 are twins)
export const OWN_MIN_SHARE = 0.05 // an inside colour needs at least 5% of the mask to count as the control's own
export const RING_DE = 20 // stroke colours (anti-aliased, often white at an opacity) only compare on similar surroundings

/** sRGB 0..255 -> CIELAB (D65). */
export function rgbToLab({ r, g, b }) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const R = lin(r), G = lin(g), B = lin(b)
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const fx = f(X), fy = f(Y), fz = f(Z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** CIE76 colour difference between two sRGB colours. */
export function deltaE(c1, c2) {
  const a = rgbToLab(c1), b = rgbToLab(c2)
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)
}

/**
 * A control's own colour from sampleRing() samples: the largest inside colour cluster (≥ 5% of the mask) that differs
 * from what surrounds it (ΔE > 10); else the largest inside cluster. A white card icon's mask often covers its white
 * gaps too, so "most common inside colour" alone would make every icon on a white card a twin of every other.
 */
export function ownColor(samples) {
  const ring = colorClusters(samples.ring)[0]
  const inside = colorClusters(samples.inside, { limit: 6 })
  if (!inside.length) return null
  const own = ring ? inside.find((c) => c.share >= OWN_MIN_SHARE && deltaE(c.color, ring.color) > 10) : null
  if (own || !ring) {
    const pick = own || inside[0]
    return { color: pick.color, hex: toHex(pick.color), share: pick.share, ring: ring ? toHex(ring.color) : null, basis: own ? 'fill' : 'largest' }
  }
  // Thin strokes (a line icon on a photo, link text in a padded box) are under 5% of the mask and anti-aliased over
  // many shades: of the inside pixels that differ from the surroundings (ΔE > 10), take the one at the 75th percentile
  // of that difference (the stroke's core colour, not its anti-aliased edge; independent of how much padding the box has).
  const scored = samples.inside.map((p) => ({ c: { r: p[0], g: p[1], b: p[2] }, d: deltaE({ r: p[0], g: p[1], b: p[2] }, ring.color) })).filter((x) => x.d > 10).sort((a, b) => a.d - b.d)
  const mid = scored[Math.min(scored.length - 1, Math.floor(scored.length * 0.75))]
  if (!mid) return { color: inside[0].color, hex: toHex(inside[0].color), share: inside[0].share, ring: toHex(ring.color), basis: 'largest' }
  return { color: mid.c, hex: toHex(mid.c), share: round2(scored.length / samples.inside.length), ring: toHex(ring.color), basis: 'strokes' }
}

/** Kind for matching: a control label, or null for anything else (cards, text, layout). */
export const kindOf = (label) => (CONTROL_LABELS.includes(label) ? label : label === 'link' ? 'link' : null)

/** Width and height each within `SIZE_RATIO` of the other's. */
export function sizeCompatible(a, b, ratio = SIZE_RATIO) {
  const r = (x, y) => Math.max(x, y) / Math.max(1, Math.min(x, y))
  return r(a[2], b[2]) <= ratio && r(a[3], b[3]) <= ratio
}

/** A region's outline in page px: its saved concept mask when there is one, else its box. */
export function regionOutline(runDir, region, full) {
  const det = { box: { x1: region.bbox[0], y1: region.bbox[1], x2: region.bbox[0] + region.bbox[2] - 1, y2: region.bbox[1] + region.bbox[3] - 1, w: full.width, h: full.height } }
  if (region.mask && existsSync(join(runDir, region.mask))) det.maskData = readFileSync(join(runDir, region.mask), 'utf-8')
  return outlineFromDetection(det, { x: 0, y: 0 }, { width: full.width, height: full.height })
}

/** Own colour of every control region (cached per run in the caller). */
export function regionColors(runDir, regions, full) {
  const out = []
  for (const r of regions) {
    const kind = kindOf(r.label)
    if (!kind || r.source === 'layout') continue
    try {
      const own = ownColor(sampleRing(full, regionOutline(runDir, r, full)))
      if (own) out.push({ id: r.id, label: r.label, kind, bbox: r.bbox, source: r.source, ...own })
    } catch (e) { /* a region we cannot sample is never a twin */ }
  }
  return out
}

/** Overlap share of the smaller box (to drop the clicked control's own region and anything nested in it). */
function overlapShare(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inter / Math.max(1, Math.min(a[2] * a[3], b[2] * b[3]))
}

/**
 * Twins of a clicked control. `clicked` = {kind, bbox, color:{r,g,b}, basis?, ring?}; `colors` = regionColors(). Pure.
 * @returns {{twins:Array<object>, near:Array<object>}} twins sorted by ΔE; `near` = same kind and size but ΔE 6..15
 *   (reported so a run can show it excluded look-alikes of another colour).
 */
export function findTwins(clicked, colors, o = {}) {
  const maxDe = o.maxDe ?? TWIN_DE
  const twins = [], near = []
  for (const c of colors) {
    if (overlapShare(c.bbox, clicked.bbox) > 0.5) continue
    if (c.kind !== clicked.kind && !(o.anyKind)) continue
    if (!sizeCompatible(c.bbox, clicked.bbox)) continue
    const de = deltaE(c.color, clicked.color)
    const row = { id: c.id, label: c.label, bbox: c.bbox, hex: c.hex, deltaE: round2(de) }
    // A thin stroke's sampled colour depends on what it is drawn over (a light-grey sidebar icon on a dark photo
    // samples like a mid-grey footer icon on white), so stroke-based matches also need similar surroundings.
    if ((c.basis === 'strokes' || clicked.basis === 'strokes') && c.ring && clicked.ring && deltaE(parseColor(c.ring), parseColor(clicked.ring)) >= RING_DE) {
      if (de < 15) near.push({ ...row, why: 'different surroundings' })
      continue
    }
    if (de < maxDe) twins.push(row)
    else if (de < 15) near.push(row)
  }
  twins.sort((a, b) => a.deltaE - b.deltaE)
  return { twins, near }
}
