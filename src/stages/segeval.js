// Segmentation eval: score a segmenter's regions (SAM 3.1, Muse Spark grounding, ...) against the
// DOM-derived oracle boxes from the mock segmenter. The oracle isn't perfect ground truth (it labels by
// role/style heuristics), but it's the same page, so it's a fair day-1 yardstick: did SAM find the buttons?
import { regionsFromCapture } from '../providers/segment/mock.js'

/** Intersection over union of two [x, y, w, h] boxes. */
export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a[2] * a[3] + b[2] * b[3] - inter
  return union > 0 ? inter / union : 0
}

/** Greedy one-to-one matching by IoU (best pairs first). Returns matched index pairs. */
function match(pred, gold, thr) {
  const pairs = []
  for (let i = 0; i < pred.length; i++) for (let j = 0; j < gold.length; j++) {
    const v = iou(pred[i].bbox, gold[j].bbox)
    if (v >= thr) pairs.push([v, i, j])
  }
  pairs.sort((a, b) => b[0] - a[0])
  const usedP = new Set(), usedG = new Set(), out = []
  for (const [v, i, j] of pairs) {
    if (usedP.has(i) || usedG.has(j)) continue
    usedP.add(i); usedG.add(j); out.push({ i, j, iou: v })
  }
  return out
}

const ratio = (a, b) => (b ? a / b : null)

/**
 * @param {import('../types.js').Region[]} pred
 * @param {import('../types.js').Region[]} oracle
 * @param {{iou?:number}} [o]
 */
export function scoreSegmentation(pred, oracle, o = {}) {
  const thr = o.iou ?? 0.5
  const labels = [...new Set([...oracle.map((r) => r.label), ...pred.map((r) => r.label)])].sort()
  const perLabel = {}
  for (const label of labels) {
    const p = pred.filter((r) => r.label === label), g = oracle.filter((r) => r.label === label)
    const m = match(p, g, thr)
    perLabel[label] = {
      oracle: g.length, predicted: p.length, matched: m.length,
      precision: ratio(m.length, p.length), recall: ratio(m.length, g.length),
      meanIou: m.length ? m.reduce((s, x) => s + x.iou, 0) / m.length : null,
    }
  }
  // Label-agnostic: did SAM find the box at all, whatever it called it?
  const any = match(pred, oracle, thr)
  return { iou: thr, perLabel, anyLabel: { matched: any.length, recall: ratio(any.length, oracle.length), precision: ratio(any.length, pred.length) } }
}

/**
 * Day-1 go/no-go: SAM is "good enough for the demo" when it finds most of the regions that drive
 * semantic naming (buttons, inputs, cards). Thresholds are a starting point, tune after the first run.
 */
// icon / badge / link are known-weak for any vision model (docs/sam-ui-risk.md) and stay non-blocking.
export const GO_RULE = { labels: ['button', 'input', 'card', 'nav', 'header'], minRecall: 0.6, minAnyRecall: 0.5 }

export function goNoGo(score, rule = GO_RULE) {
  const reasons = []
  for (const l of rule.labels) {
    const s = score.perLabel[l]
    if (!s || !s.oracle) continue
    if ((s.recall ?? 0) < rule.minRecall) reasons.push(`${l} recall ${((s.recall ?? 0) * 100).toFixed(0)}% < ${rule.minRecall * 100}%`)
  }
  if ((score.anyLabel.recall ?? 0) < rule.minAnyRecall) reasons.push(`any-label recall ${((score.anyLabel.recall ?? 0) * 100).toFixed(0)}% < ${rule.minAnyRecall * 100}%`)
  return { go: reasons.length === 0, reasons }
}

export const oracleFor = (capture) => regionsFromCapture(capture)

/**
 * Clip regions to the first screen (y < maxY) and drop the ones left outside it. Hand-labeled truth for real
 * sites covers only the first screen, while captures are full-page, so predictions below the fold must not
 * count as false positives (and a full-height sidebar is scored by its visible part).
 * @param {import('../types.js').Region[]} regions
 * @param {number} maxY
 */
export function clipToScreen(regions, maxY) {
  const out = []
  for (const r of regions) {
    const [x, y, w, h] = r.bbox
    const bottom = Math.min(y + h, maxY)
    if (y >= maxY || bottom - y < 4) continue
    out.push({ ...r, bbox: [x, y, w, bottom - y] })
  }
  return out
}

/**
 * Pick the gold regions to score against: a hand-labeled truth file when given (e.g. for a
 * fixture like div-soup where the DOM can't describe the UI, so the DOM oracle is useless),
 * else fall back to the DOM-derived oracle (the default, existing behaviour).
 * @param {import('../types.js').Capture} capture
 * @param {import('../types.js').Region[]|null|undefined} truth
 */
export function resolveOracle(capture, truth) {
  return truth && truth.length ? truth : oracleFor(capture)
}

export function formatSegScore(score, verdict) {
  const pct = (v) => (v == null ? '  -' : `${(v * 100).toFixed(0).padStart(3)}%`)
  const lines = [`segeval @ IoU ${score.iou}: any-label recall ${pct(score.anyLabel.recall)}, precision ${pct(score.anyLabel.precision)}`,
    '  label     oracle  pred  match  recall  precision  meanIoU']
  for (const [l, s] of Object.entries(score.perLabel)) {
    lines.push(`  ${l.padEnd(9)} ${String(s.oracle).padStart(6)} ${String(s.predicted).padStart(5)} ${String(s.matched).padStart(6)}  ${pct(s.recall)}    ${pct(s.precision)}     ${s.meanIou == null ? '  -' : s.meanIou.toFixed(2)}`)
  }
  if (verdict) lines.push(verdict.go ? '  GO: segmentation is good enough for the demo' : `  NO-GO: ${verdict.reasons.join('; ')}`)
  return lines.join('\n')
}

/**
 * Clean up model regions before the join: drop degenerate boxes (tile seams, specks) and run per-label
 * non-max suppression. Never suppress across labels: an icon inside a button is a real nested pair.
 * @param {import('../types.js').Region[]} regions
 * @param {{minSide?:number, iou?:number}} [o]
 */
export function postprocessRegions(regions, o = {}) {
  const minSide = o.minSide ?? 8, thr = o.iou ?? 0.7
  const kept = []
  const sorted = regions.filter((r) => r.bbox[2] >= minSide && r.bbox[3] >= minSide).sort((a, b) => (b.score ?? 1) - (a.score ?? 1))
  for (const r of sorted) {
    if (kept.some((k) => k.label === r.label && iou(k.bbox, r.bbox) > thr)) continue
    kept.push(r)
  }
  return kept.map((r, i) => ({ ...r, id: `r${i}` }))
}
