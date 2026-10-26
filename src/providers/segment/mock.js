// Offline stand-in for SAM 3.1: derives UI regions from the captured DOM boxes.
// It is an "oracle" (it can see the DOM, SAM only sees pixels), so scores from it
// overstate segmentation quality. Use it to build and test the rest of the pipeline.

const LABEL_BY_ROLE = {
  button: 'button', link: 'link', textbox: 'input', navigation: 'nav', banner: 'header',
  contentinfo: 'footer', img: 'image', heading: 'text',
}

/** @param {import('../../types.js').ElementSample} e */
export function labelFor(e) {
  const s = e.styles || {}
  const hasBg = s['background-color'] && !/rgba\(0, 0, 0, 0\)|transparent/.test(s['background-color'])
  // A link drawn as a button (fill or border, plus padding) is a button to a person, and to SAM.
  if (e.role === 'link') {
    const padded = parseFloat(s['padding-left'] || '0') >= 8 && parseFloat(s['padding-top'] || '0') >= 4
    if (padded && (hasBg || s['border-top-color'])) return 'button'
  }
  if (e.role && LABEL_BY_ROLE[e.role]) return LABEL_BY_ROLE[e.role]
  const hasShadow = s['box-shadow'] && s['box-shadow'] !== 'none'
  const hasRadius = parseFloat(s['border-top-left-radius'] || '0') > 0
  const [, , w, h] = e.bbox
  if ((hasShadow || (hasBg && hasRadius)) && w > 120 && h > 80) return 'card'
  if (hasBg && hasRadius && w <= 120 && h <= 40) return 'badge'
  return null
}

/** Pure: capture → regions. Exported for tests. */
export function regionsFromCapture(capture) {
  /** @type {import('../../types.js').Region[]} */
  const regions = []
  for (const e of capture.elements) {
    const label = labelFor(e)
    if (!label) continue
    regions.push({ id: `r${regions.length}`, bbox: e.bbox, label, score: 1, source: 'mock-dom' })
  }
  return regions
}

/** @returns {import('../../types.js').SegmentProvider} */
export default function mockSegmenter() {
  return { id: 'mock-dom', segment: async (capture) => regionsFromCapture(capture) }
}
