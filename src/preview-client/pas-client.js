// Point and say: pure client-side helpers for playground.html's "Point and say" mode (overlay geometry over the
// same-origin iframe, proposal wording, regression detection). ES module with no imports (the page loads it with
// import('./pas-client.js'), same pattern as contrast.js), so Node tests can import it too. Nothing here touches the
// DOM directly — playground.html wires these to the iframe, the mic button and /__pas/api/*.
//
// Wording rule (point-and-say-plan.md): "more accessible" only ever appears beside the named check and its numbers
// (e.g. "text contrast: 21 elements, 2.95:1 -> 4.53:1"); never "accessible"/"compliant" as a bare verdict. Every
// string this file builds for the UI follows that rule — see test/pas-client.test.js for the check.

/** 2 decimal places + ":1", e.g. 4.5 -> "4.50:1". */
export function fmtRatio(r) {
  return (Math.round(Number(r) * 100) / 100).toFixed(2) + ':1'
}

/**
 * The one line that may say "more accessible" (always right beside this): "text contrast: 21 elements,
 * 2.95:1 -> 4.53:1". `n` = elements affected, `before`/`after` = the worst ratio among them.
 */
export function contrastLine(n, before, after) {
  const count = `${n} element${n === 1 ? '' : 's'}`
  return `text contrast: ${count}, ${fmtRatio(before)} → ${fmtRatio(after)}`
}

/** "visible focus: 0 of 25 -> 25 of 25 controls". */
export function focusLine(beforePass, afterPass, total) {
  return `visible focus: ${beforePass} of ${total} → ${afterPass} of ${total} control${total === 1 ? '' : 's'}`
}

/** "color.text.muted: #8898aa -> #687889" (or an alias target, e.g. "var(--color-blue-500)"). */
export function changeLine(c) {
  const from = c.from || c.value || ''
  const to = c.css || c.value || ''
  return `${c.token}: ${from} → ${to}`
}

/**
 * "BLOCKED: text contrast would regress on "Since last month" (4.53:1 -> 2.95:1)[, and 2 more]." Names the check and
 * the worst-hit element, per the wording rule ("blocked" states which check and which element).
 */
export function blockedMessage(check, regressions) {
  if (!regressions || !regressions.length) return `BLOCKED: ${check} would regress.`
  const worst = regressions.slice().sort((a, b) => (a.to ?? 0) - (b.to ?? 0))[0]
  const where = worst.text ? `“${worst.text}”` : 'an element'
  const nums = worst.from != null && worst.to != null ? ` (${fmtRatio(worst.from)} → ${fmtRatio(worst.to)})` : ''
  const more = regressions.length > 1 ? `, and ${regressions.length - 1} more` : ''
  return `BLOCKED: ${check} would regress on ${where}${nums}${more}.`
}

/**
 * Compare two auditLive() result arrays (same `pairs`, before and after a proposed change is applied). Same
 * regression rule as the pipeline's verify: a pair that passed before and fails after, or still fails but got a
 * worse ratio, is a regression. Pure; no DOM.
 * @param {Array<{id:string,status:string,ratio?:number,text?:string,required?:number}>} before
 * @param {Array<{id:string,status:string,ratio?:number,text?:string,required?:number}>} after
 * @returns {{affected:Array<object>, regressions:Array<object>, fixed:number, stillFail:number, allPass:boolean}}
 */
export function compareAudits(before, after) {
  const byId = new Map((after || []).map((r) => [r.id, r]))
  const affected = [], regressions = []
  for (const b of before || []) {
    const a = byId.get(b.id)
    if (!a || b.ratio == null || a.ratio == null) continue
    const changed = Math.abs(a.ratio - b.ratio) > 0.005
    if (changed) affected.push({ id: b.id, text: b.text, required: b.required, from: b.ratio, to: a.ratio, status: `${b.status}->${a.status}` })
    const worse = a.ratio < b.ratio - 0.005
    if ((b.status === 'pass' && a.status === 'fail') || (a.status === 'fail' && worse)) {
      regressions.push({ id: b.id, text: b.text, required: b.required, from: b.ratio, to: a.ratio })
    }
  }
  return {
    affected,
    regressions,
    fixed: affected.filter((x) => x.status === 'fail->pass').length,
    stillFail: affected.filter((x) => x.status === 'fail->fail').length,
    allPass: regressions.length === 0,
  }
}

/**
 * Map a click inside the iframe (iframe-local page px: clientX/Y + the iframe document's own scrollX/Y) to the run's
 * capture-viewport coordinate space, which is what /__pas/api/point indexes against (SAM's screenshot, capture.json
 * element boxes). Scales by the iframe's rendered size vs the capture viewport, so a click stays correctly placed
 * even when the iframe is shown at a different size than it was captured at. Pure (sizes passed in; no DOM read).
 * @param {{x:number,y:number}} pt
 * @param {{width:number,height:number}} iframeSize current rendered size of the iframe's content area (CSS px)
 * @param {{width:number,height:number}} captureViewport the run's capture viewport
 */
export function toCaptureXY(pt, iframeSize, captureViewport) {
  const sx = captureViewport && iframeSize.width ? captureViewport.width / iframeSize.width : 1
  const sy = captureViewport && iframeSize.height ? captureViewport.height / iframeSize.height : 1
  return { x: pt.x * sx, y: pt.y * sy }
}

/** Inverse of toCaptureXY, for drawing a server-returned box (capture space) into the overlay (iframe CSS px). */
export function captureBoxToOverlay(bbox, iframeSize, captureViewport) {
  const sx = captureViewport && captureViewport.width ? iframeSize.width / captureViewport.width : 1
  const sy = captureViewport && captureViewport.height ? iframeSize.height / captureViewport.height : 1
  const [x, y, w, h] = bbox
  return { left: x * sx, top: y * sy, width: w * sx, height: h * sy }
}

/** Overlay boxes for a point() response: the clicked element/outline (primary) + its twins (secondary), in iframe px. */
export function overlayBoxesFor(point, iframeSize, captureViewport) {
  const box = (bbox, kind) => ({ ...captureBoxToOverlay(bbox, iframeSize, captureViewport), kind })
  const out = []
  if (point.outline && point.outline.bbox) out.push(box(point.outline.bbox, 'outline'))
  else if (point.element && point.element.bbox) out.push(box(point.element.bbox, 'element'))
  for (const t of point.twins || []) out.push(box(t.bbox, 'twin'))
  return out
}

/** Clamp a hold-to-talk duration to the mic's max (10 s default). Pure. */
export function clampRecordMs(ms, max = 10000) {
  return Math.max(0, Math.min(max, Math.round(ms)))
}

/** HTML-escape text for insertion into the proposal card (same rule as playground.html's esc()). */
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** The PR command text shown (never run) once a proposal is kept. Text only. */
export function prCommandText(runDir) {
  const dir = runDir || '<run dir>'
  return `s2t review --run ${dir}\ns2t pr --run ${dir} --repo <app git root>`
}

/**
 * One-line "why" for the proposal card, from a contrast-fix/focus/muse result. Falls back to a generic line when the
 * model (muse) gave no reason, rather than inventing a verdict.
 */
export function whyLine(reason, fallback) {
  const r = String(reason || '').trim()
  return r || fallback || 'Matched to the nearest token; no further reason given.'
}

/**
 * Plain-language proposal summary for the card header, built from the route. Never says "accessible"/"compliant" on
 * its own — the check name and its numbers are always attached by contrastLine/focusLine, added separately.
 */
export function proposalTitle(route) {
  if (route === 'contrast') return 'Contrast fix'
  if (route === 'focus') return 'Focus ring'
  return 'Token change'
}
