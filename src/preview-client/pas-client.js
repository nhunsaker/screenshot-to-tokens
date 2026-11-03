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

/**
 * Overlay boxes for a point() response (contract v2): the outline (primary; `kind` "control" when the server drew the
 * control's DOM box, `outline.source: "dom-control"`), the element that paints the fill/border (`element.control`)
 * when it differs from the outline, and the twins (secondary). Boxes are capture-space page px; `scroll` (the
 * iframe's scroll offset, capture px) is subtracted so the overlay stays on the element while the app scrolls.
 */
export function overlayBoxesFor(point, iframeSize, captureViewport, scroll) {
  const sx = scroll && scroll.x ? scroll.x : 0, sy = scroll && scroll.y ? scroll.y : 0
  const box = (bbox, kind) => ({ ...captureBoxToOverlay([bbox[0] - sx, bbox[1] - sy, bbox[2], bbox[3]], iframeSize, captureViewport), kind })
  const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 2)
  const out = []
  const el = point.element || null
  // The control box only when the click was on a control (outline from SAM or the control's DOM box). For text, the
  // element that paints the background is the surrounding card, which is not what the person pointed at.
  const onControl = !point.outline || point.outline.source !== 'dom'
  const ctl = onControl && el && el.control && el.control.bbox ? el.control.bbox : null
  let main = null
  if (point.outline && point.outline.bbox) { main = point.outline.bbox; out.push(box(main, point.outline.source === 'dom-control' ? 'control' : 'outline')) }
  else if (ctl) { main = ctl; out.push(box(ctl, 'control')) }
  else if (el && el.bbox) { main = el.bbox; out.push(box(el.bbox, 'element')) }
  if (ctl && !same(ctl, main)) out.push(box(ctl, 'control'))
  for (const t of point.twins || []) if (t && t.bbox) out.push(box(t.bbox, 'twin'))
  return out
}

/**
 * The note beside one change item on the proposal card (contract v2 fields): `noop` -> "already that value";
 * `retargetedFrom` -> "moved to the semantic token" (the model aimed at a primitive in the chain); `aliasPreferred`
 * -> the model's own target was swapped for the semantic token with the same value. '' when none apply. Pure.
 */
export function changeNote(c) {
  if (!c) return ''
  if (c.noop) return 'already that value'
  const notes = []
  if (c.retargetedFrom) notes.push(`moved to the semantic token (the model named ${c.retargetedFrom})`)
  if (c.roleRetargetedFrom) notes.push(`moved off ${c.roleRetargetedFrom} (wrong role for this token)`)
  if (c.aliasPreferred && c.alias && c.aliasPreferred !== c.alias) notes.push(`pointed at the semantic token ${c.alias} (the model said ${c.aliasPreferred})`)
  return notes.join('; ')
}

/** True when every change in a proposal is already in place (nothing to apply). Pure. */
export function allNoop(changes) {
  return !!(changes && changes.length) && changes.every((c) => c && c.noop)
}

const HUE_WORDS = ['red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'violet', 'pink', 'gray', 'grey', 'black', 'white']

/**
 * When the focus ring used the nearest hue (`ring.nearest`, e.g. Light Bootstrap has no blue token): "nearest blue in
 * your tokens is teal (color.teal.300)". '' otherwise. The family is the hue word in the token name, else the name.
 */
export function ringNote(ring) {
  if (!ring || !ring.nearest || !ring.hue) return ''
  const tok = (ring.color && (ring.color.token || ring.color.value)) || ''
  const fam = String(tok).split('.').find((p) => HUE_WORDS.includes(p))
  return fam ? `nearest ${ring.hue} in your tokens is ${fam} (${tok})` : `nearest ${ring.hue} in your tokens is ${tok}`
}

/**
 * The blocked line from the server's prediction (`predicted.blocked/reason`), else null. Same wording rule: names the
 * check and the element ("BLOCKED: text contrast: "Month" 4.2 -> 3.77 (needs 4.5) and 2 more.").
 */
export function predictedBlock(predicted) {
  if (!predicted || !predicted.blocked) return null
  if (predicted.reason) return `BLOCKED: ${String(predicted.reason).replace(/^blocked:\s*/i, '')}`
  return blockedMessage('text contrast', (predicted.regressions || []).map((r) => ({ text: r.text, from: r.from, to: r.to })))
}

/** "whole page: 41 → 20 failing of 87 text pairs checked" from two auditLive() result arrays. Pure. */
export function pageAuditLine(before, after) {
  const f = (a) => (a || []).filter((r) => r.status === 'fail').length
  const n = (a) => (a || []).filter((r) => r.status === 'pass' || r.status === 'fail').length
  return `whole page: ${f(before)} → ${f(after)} failing of ${n(after)} text pairs checked`
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

// ---- live demo (public mode): the shared budget ------------------------------------------------------------------

/** Units per action, mirrored from src/stages/pas/ledger.js COSTS (the page only words them; the server charges). */
export const BUDGET_COSTS = { point: 1, transcribe: 1, deterministic: 0, muse: 2, focusCheck: 3 }

/** "Demo budget 742 of 1,000" (units left of the shared total). */
export function budgetLine(b) {
  const n = (v) => Math.max(0, Math.round(Number(v) || 0)).toLocaleString('en-US')
  return `Demo budget ${n(b && b.left)} of ${n(b && b.total)}`
}

/** Share of the demo budget left, 0..1, for the budget bar. */
export function budgetFraction(b) {
  const total = Number(b && b.total) || 0
  return total > 0 ? Math.max(0, Math.min(1, (Number(b.left) || 0) / total)) : 0
}

/** "You can use 37 more on this visit." when the per-visit (session/IP/day) share is smaller than the shared counter. */
export function mineLine(b) {
  if (!b || b.mine == null || b.mine >= b.left) return ''
  return `You can use ${Math.max(0, b.mine).toLocaleString('en-US')} more on this visit.`
}

/** Hover text for the controls: what each action costs. */
export const COST_TITLES = {
  app: 'A click on the app costs 1 unit (SAM 3.1 outlines what you clicked).',
  mic: 'Speech costs 1 unit (Meta speech model), plus the change.',
  text: 'Typed requests: contrast and focus fixes cost 0 (no model); other changes cost 2 (Muse Spark), the focus check 3.',
}

/** One line under the counter. */
export const COST_NOTE = 'A click costs 1, speech 1, a change Muse Spark maps 2, the keyboard focus check 3. Contrast and focus fixes need no model.'

/** The note beside the recorded clip when a cap is hit (any cap: total, today, this visit, this network). */
export function capMessage() {
  return 'The demo budget is used up for now; here’s the recording.'
}

/** The "what this is" box for the live page. */
export const WHAT_THIS_IS = [
  'Click a control in the app, then say or type the fix. It’s applied here and checked on the whole page; a change that makes any text harder to read is blocked.',
  'Requests go to Meta’s hosted models with store: false. Nothing is saved.',
]

// ---- microphone detection (pure) ----------------------------------------------------------------------------------
const VIRTUAL_MIC = /virtual|teams audio|loom|zoom|blackhole|soundflower|loopback|krisp|obs|aggregate|multi-output/i

/** True when an input device label names a virtual (app-provided) device rather than a real microphone. Pure. */
export function isVirtualMic(label) { return VIRTUAL_MIC.test(String(label || '')) }

/** Order audio inputs for the picker: real mics first (the OS default among them first), virtual ones last. Pure. */
export function orderMics(devices) {
  const ins = (devices || []).filter((d) => d && d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications')
  const rank = (d) => (isVirtualMic(d.label) ? 2 : 0) + (d.deviceId === 'default' ? 0 : 1)
  return ins.slice().sort((a, b) => rank(a) - rank(b)).map((d) => ({ id: d.deviceId, label: d.label || 'Microphone', virtual: isVirtualMic(d.label) }))
}

/** The id to record from: the first real mic, else the first input. Pure. */
export function defaultMicId(mics) {
  const real = (mics || []).find((m) => !m.virtual)
  return real ? real.id : ((mics || [])[0] || {}).id || null
}

/** Below this RMS a recording is silence (a virtual device with no app feeding it, or a muted mic). */
export const SILENT_RMS = 0.002

/** What went wrong with the mic, as a short headline for the help box; null when the recording looks fine. Pure. */
export function micProblem({ label, rms, error } = {}) {
  const why = String(error || '')
  if (/Permission|NotAllowed|denied/i.test(why)) return 'The browser is not allowed to use the microphone on this page.'
  if (/NotFound|Requested device not found/i.test(why)) return 'No microphone was found.'
  if (/NotReadable|Could not start|audio source|in use/i.test(why)) return 'The microphone could not start.'
  if (why) return 'The microphone failed: ' + why
  if (isVirtualMic(label)) return `It recorded from “${label}”, an app's virtual device, not a microphone.`
  if (typeof rms === 'number' && rms < SILENT_RMS) return `It heard only silence from “${label || 'the microphone'}”.`
  return null
}

/** Steps to get a real microphone working (macOS-first, then the browser). */
export const MIC_HELP = [
  'Pick a real microphone in the menu below the button, if one is listed.',
  'On a Mac laptop with the lid closed, the built-in mic is off: open the lid, or plug in a headset or AirPods.',
  'Mac: System Settings → Sound → Input → choose the real mic (not Teams, Loom or Zoom), and watch the level move.',
  'Mac: System Settings → Privacy & Security → Microphone → allow your browser, then quit and reopen it.',
  'Browser: the icon left of the address → Site settings → Microphone → Allow, then reload this page.',
  'Another app in a call (Zoom, Teams, Loom) can hold the mic; close it and try again. Typing always works.',
]


// ---- panel wording (the redesigned side panel) -------------------------------------------------------------------

const PROVIDER_NAMES = { baseten: 'Muse Spark Open', meta: 'Muse Spark', fireworks: 'Muse Spark Open (Fireworks)' }

/**
 * Human name for a provider id or a namer string ("baseten:meta-models/muse-spark-open-1026" -> "Muse Spark Open").
 * Never returns the raw model id. Pure.
 */
export function providerName(idOrNamer) {
  const id = String(idOrNamer || '').split(':')[0].trim().toLowerCase()
  if (PROVIDER_NAMES[id]) return PROVIDER_NAMES[id]
  if (/muse/i.test(String(idOrNamer || ''))) return 'Muse Spark'
  return id === 'ollama' ? 'a local model' : 'a model'
}

/** The one meta line under the panel title: "Argon Dashboard · 44 tokens · named by Muse Spark Open". Pure. */
export function metaLine({ title, tokens, namer } = {}) {
  const n = Number(tokens) || 0
  return [title, `${n} token${n === 1 ? '' : 's'}`, `named by ${providerName(namer)}`].filter(Boolean).join(' · ')
}

/**
 * Which of the three steps is current (1 click, 2 say or type, 3 keep or undo; 4 = all done) from the page state.
 * @param {{phase?:string, hasPoint?:boolean, resultKind?:string|null, kept?:boolean, recording?:boolean}} s
 */
export function stepIndex(s = {}) {
  if (s.kept) return 4
  if (s.phase === 'done' && (s.resultKind === 'applied' || s.resultKind === 'focus')) return 3
  if (s.recording) return 2
  if (['transcribing', 'intent', 'focus-check'].includes(s.phase)) return 2
  return s.hasPoint ? 2 : 1
}

/**
 * The target box after a click: the clicked label, the token that controls it, and how widely that token is used.
 * {label:"Since last month", token:"color.text.muted", line:"color.text.muted · used by 21 labels"}. Pure.
 */
export function targetInfo(point) {
  const el = (point && point.element) || null
  const raw = el ? String(el.text || '').replace(/\s+/g, ' ').trim() : ''
  const label = el ? (raw.length > 60 ? raw.slice(0, 57).trimEnd() + '…' : raw) || `<${el.tag}>` : ''
  const ctl = (point && point.controls) || {}
  const color = ctl.color && ctl.color.token
  const paint = (ctl['background-color'] && ctl['background-color'].token) || (ctl['border-color'] && ctl['border-color'].token)
  let token = null, line = 'no token controls it'
  const pairs = point && point.pairs && point.pairs.count
  if (color) {
    token = color
    line = pairs ? `${color} · used by ${pairs} label${pairs === 1 ? '' : 's'}` : color
  } else if (paint) {
    token = paint
    const n = ((point && point.twins) || []).length + 1
    line = `${paint} · used by ${n} element${n === 1 ? '' : 's'}`
  }
  return { label, token, line }
}

const ROLE_SEG = /^(bg|background|text|fg|border|color|surface|fill|ring|outline)$/
const cap = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)
const plural = (w) => (/s$/.test(w) ? w : /(ch|sh|x)$/.test(w) ? w + 'es' : w + 's')

/** "color.text.muted" -> "Muted labels", "button.bg" -> "Buttons", "color.surface.card" -> "Card surfaces". Pure. */
export function tokenSubject(name) {
  const seg = String(name || '').split('.')
  if (seg[0] === 'color' && seg[1] === 'text') {
    const v = seg[2] || ''
    if (/^(default|body|primary|base)$/.test(v)) return 'Body text'
    if (/^(muted|secondary|subtle|light)$/.test(v)) return 'Muted labels'
    if (/^heading/.test(v)) return 'Headings'
    if (/^link/.test(v)) return 'Links'
    return v ? `${cap(v)} text` : 'Text'
  }
  if (seg[0] === 'color' && seg[1] === 'surface') return seg[2] ? `${cap(seg[2])} surfaces` : 'Surfaces'
  if (seg[0] === 'color' && seg[1] === 'action') return seg[2] ? `${cap(seg[2])} actions` : 'Actions'
  if (seg[0] === 'color' && seg[1] === 'border') return 'Borders'
  if (seg[0] === 'color' || seg[0] === 'radius') return seg.slice(1).join(' ').replace(/^./, (c) => c.toUpperCase()) || name
  const parts = seg.filter((x) => !ROLE_SEG.test(x))
  return parts.length ? cap(parts.map((x, i) => (i === parts.length - 1 ? plural(x) : x)).join(' ').replace(/-/g, ' ')) : cap(name)
}

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }

/** A plain hue word for a hex colour: gray for low saturation, else red/orange/yellow/green/teal/blue/purple/pink. */
export function hueWord(hex) {
  const c = hexRgb(hex); if (!c) return 'colour'
  const [r, g, b] = c.map((x) => x / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  const l = (mx + mn) / 2
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (sat < 0.25 || d < 0.08) return l < 0.12 ? 'black' : l > 0.94 ? 'white' : 'gray'
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return h < 15 ? 'red' : h < 40 ? 'orange' : h < 65 ? 'yellow' : h < 160 ? 'green' : h < 195 ? 'teal' : h < 255 ? 'blue' : h < 290 ? 'purple' : h < 340 ? 'pink' : 'red'
}

/**
 * The bold plain-words headline of a proposal card: "Muted labels: a darker gray", "Buttons: a new background",
 * "A focus ring on every control". `proposal` = {route, changes:[{token, from, to|value, noop?}]} (`to` = the resolved
 * new colour). Pure.
 */
export function describeChange(proposal) {
  const p = proposal || {}
  if (p.route === 'focus') return 'A focus ring on every control'
  const live = (p.changes || []).filter((c) => c && !c.noop)
  if (!live.length) return (p.changes || []).length ? 'Already that way: nothing to change' : 'No change'
  const subject = tokenSubject(live[0].token)
  const whats = []
  for (const c of live.filter((x) => tokenSubject(x.token) === subject)) { const w = changeWhat(c); if (!whats.includes(w)) whats.push(w) }
  const others = new Set(live.map((x) => tokenSubject(x.token)).filter((x) => x !== subject)).size
  const what = whats.length > 1 && whats.every((w) => /^a new /.test(w)) ? `a new ${whats.map((w) => w.slice(6)).slice(0, 2).join(' and ')}` : whats[0]
  return `${subject}: ${what}${others ? ` (+${others} more)` : ''}`
}

/** What one change does, in a few words: "a darker gray", "a new background", "rounder corners". Pure. */
function changeWhat(c) {
  const to = c.to || c.value
  const seg = String(c.token).split('.')
  if (/^radius/.test(c.token) || /radius/.test(seg[seg.length - 1])) {
    return parseFloat(to) > parseFloat(c.from) ? 'rounder corners' : parseFloat(to) < parseFloat(c.from) ? 'squarer corners' : 'new corners'
  }
  if (seg.some((x) => /^(bg|background|surface|fill)$/.test(x))) return 'a new background'
  if (seg.some((x) => /^(border|outline|ring)$/.test(x))) return 'a new border'
  const a = hexRgb(c.from), b = hexRgb(to)
  if (!b) return 'a new colour'
  const dir = a ? (lum(b) < lum(a) - 0.005 ? 'a darker ' : lum(b) > lum(a) + 0.005 ? 'a lighter ' : 'a new ') : 'a new '
  return dir + hueWord(to)
}

/**
 * The pass row: "21 labels now pass text contrast: 2.95:1 → 4.53:1" (all fixed), "3 of 21 labels now pass …" (some),
 * "21 labels changed; text contrast 2.95:1 → 4.53:1" (none newly pass). `ok` says whether it reads as a pass. Pure.
 */
export function passLine({ n, fixed = 0, before, after }) {
  const nums = `${fmtRatio(before)} → ${fmtRatio(after)}`
  const lab = (k) => `${k} label${k === 1 ? '' : 's'}`
  if (n && fixed >= n) return { ok: true, text: `${lab(n)} now pass text contrast: ${nums}` }
  if (n && fixed > 0) return { ok: true, text: `${fixed} of ${lab(n)} now pass text contrast: ${nums}` }
  return { ok: false, text: `${lab(n || 0)} changed; text contrast ${nums}` }
}

/** "Checked on the whole page: 41 → 20 text pairs failing, 0 got worse" from two auditLive() arrays. Pure. */
export function pageCheckLine(before, after, worse = 0) {
  const f = (a) => (a || []).filter((r) => r.status === 'fail').length
  return `Checked on the whole page: ${f(before)} → ${f(after)} text pairs failing, ${worse} got worse`
}

/** Focus pass row: "25 of 25 controls now show a visible focus ring (was 0)". Pure. */
export function focusPassLine(before, after, total) {
  return `${after} of ${total} control${total === 1 ? '' : 's'} now show a visible focus ring (was ${before})`
}

/** Focus page-check row: "Checked by tabbing through the whole page: 25 controls, 0 got worse". Pure. */
export function focusCheckLine(total, worse = 0) {
  return `Checked by tabbing through the whole page: ${total} control${total === 1 ? '' : 's'}, ${worse} got worse`
}
