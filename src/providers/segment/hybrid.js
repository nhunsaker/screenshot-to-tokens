// Hybrid segmenter: SAM 3.1 for what it sees well, page structure for what it doesn't.
//
// Measured on 2026-10-26 (see the build plan): SAM 3.1 finds buttons, search bars and icons from pixels alone,
// including on pages with no semantic markup (div-soup: 8/8 buttons where the DOM finds 0/8). It returns nothing for
// layout containers (card, header, nav, badge). So:
//   1. SAM regions come first and win any overlap.
//   2. Layout rules, anchored on SAM's detections, find headers (a wide top row holding 2+ SAM regions) and side navs
//      (a tall, narrow, filled column at the left edge), with no tags or roles needed.
//   3. DOM-style rules (the old mock: roles, fills, radii, shadows) fill in cards, badges, images, links, footers.
// Every region keeps its `source`, so the report and segeval can show who found what.
import metaSam from './meta-sam.js'
import { regionsFromCapture } from './mock.js'
import { iou, postprocessRegions } from '../../stages/segeval.js'
import { containment } from '../../stages/join.js'

const transparent = (c) => !c || /rgba\(0, 0, 0, 0\)|transparent/.test(c)

/**
 * Layout rules anchored on SAM detections. Pure; exported for tests.
 * @param {import('../../types.js').Capture} capture
 * @param {import('../../types.js').Region[]} anchors  SAM regions (buttons, inputs, icons)
 */
export function layoutRegions(capture, anchors) {
  const vw = capture.viewport?.width || 1440
  const vh = capture.viewport?.height || 900
  const out = []
  // Header / toolbar: near the top, wide, not tall, and holding at least two SAM detections.
  // Pick the tightest element that qualifies (the toolbar row, not the whole page wrapper).
  let header = null
  for (const e of capture.elements) {
    const [x, y, w, h] = e.bbox
    if (y > 40 || w < 0.6 * vw || h > 120 || h < 20) continue
    const held = anchors.filter((a) => containment(a.bbox, e.bbox) >= 0.9).length
    if (held < 2) continue
    if (!header || w * h < header.bbox[2] * header.bbox[3]) header = { bbox: e.bbox, held }
  }
  if (header) out.push({ id: 'h', bbox: header.bbox, label: 'header', score: 0.8, source: 'layout' })
  // Side nav: a filled column at the left edge, tall and narrow.
  for (const e of capture.elements) {
    const [x, y, w, h] = e.bbox
    if (x > 4 || y > 4 || h < 0.6 * vh || w > 0.3 * vw || w < 120) continue
    if (transparent(e.styles?.['background-color'])) continue
    out.push({ id: 'n', bbox: e.bbox, label: 'nav', score: 0.8, source: 'layout' })
    break
  }
  return out
}

/**
 * SAM calls anything pill-shaped a "button", including status pills that do nothing (div-soup: every "Healthy"
 * and "Failed" in the deploys table). When the capture shows the element under a small SAM button is not
 * clickable (no link, button, onclick, tabindex or pointer cursor, itself or via an ancestor), call it a badge.
 * Boxes with no matching element (a button painted inside a canvas) and older captures without the
 * `clickable` field are left alone. Pure; exported for tests.
 * @param {import('../../types.js').Region[]} sam
 * @param {import('../../types.js').Capture} capture
 */
export function relabelInertButtons(sam, capture) {
  return sam.map((r) => {
    if (r.label !== 'button' || r.bbox[3] > 32 || r.bbox[2] > 160) return r
    const under = capture.elements.filter((e) => e.clickable !== undefined && iou(e.bbox, r.bbox) > 0.6)
    if (!under.length || under.some((e) => e.clickable)) return r
    return { ...r, label: 'badge', source: `${r.source || 'sam3.1'}+inert` }
  })
}

/**
 * Merge SAM, layout and DOM regions. Pure; exported for tests.
 * - Layout regions are containers (a header holds the search bar), so they only clash with the same label.
 * - DOM regions clash with anything already kept at IoU > 0.5, so SAM's label wins when both saw the same box
 *   (e.g. a div the style rules call a "badge" that SAM recognizes as a button).
 */
export function mergeRegions(sam, layout, dom) {
  const kept = [...sam]
  for (const r of layout) if (!kept.some((k) => k.label === r.label && iou(k.bbox, r.bbox) > 0.5)) kept.push(r)
  for (const r of dom) if (!kept.some((k) => iou(k.bbox, r.bbox) > 0.5 && !(k.source === 'layout' && k.label !== r.label))) kept.push(r)
  return postprocessRegions(kept)
}

/** @returns {import('../../types.js').SegmentProvider} */
export default function hybridSegmenter() {
  const sam = metaSam()
  return {
    id: 'hybrid:sam3.1+layout+dom',
    async segment(capture, runDir) {
      const samRegions = relabelInertButtons(await sam.segment(capture, runDir), capture)
      const layout = layoutRegions(capture, samRegions)
      const dom = regionsFromCapture(capture)
      return mergeRegions(samRegions, layout, dom)
    },
  }
}
