// Point and say: which tokens ACTUALLY control a clicked element? The sentinel probe: in a headless copy of the served
// app (tokens.css loaded), set each candidate token's custom property on :root to a value no design uses (#ff00fe for
// colours, 37px for radii), read the element's computed style, put the property back. A token that moves the element
// controls it, through however many aliases. Value matching cannot tell `color.text.muted` from `color.blue.400` or
// `footer.text` when they share a value; the sentinel can. The in-page functions are self-contained (Playwright
// serializes them); the chain ordering is pure.

export const SENTINEL_COLOR = '#ff00fe'
export const SENTINEL_RGB = 'rgb(255, 0, 254)'
export const SENTINEL_RADIUS = '37px'

/** Properties we probe, the token kind that can control each, and the computed-style keys read for it. */
export const PROBE_PROPS = [
  { prop: 'color', kind: 'color', keys: ['color'] },
  { prop: 'background-color', kind: 'color', keys: ['background-color'] },
  { prop: 'border-color', kind: 'color', keys: ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'] },
  { prop: 'border-radius', kind: 'radius', keys: ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] },
]

/**
 * In page: the element under page px (x, y) and, per property, every token whose sentinel moves it.
 * Scrolls so the point is in the viewport, then back. Self-contained.
 * @param {{x:number, y:number, tokens:{name:string, cssVar:string, kind:string}[], props:typeof PROBE_PROPS, color:string, radius:string}} a
 */
export function probeAtPoint(a) {
  const doc = document, view = doc.defaultView || window
  const sx = view.scrollX, sy = view.scrollY
  const vh = view.innerHeight
  const top = Math.max(0, a.y - vh / 2)
  view.scrollTo(0, top)
  const el = doc.elementFromPoint(a.x - view.scrollX, a.y - view.scrollY)
  if (!el) { view.scrollTo(sx, sy); return null }
  const root = doc.documentElement.style
  const styleOf = (n) => view.getComputedStyle(n)
  // A border colour only matters when there is a border (it defaults to currentColor, so it follows the text).
  const hasBorder = (n) => { const c = styleOf(n); return ['top', 'right', 'bottom', 'left'].some((k) => parseFloat(c.getPropertyValue('border-' + k + '-width')) > 0 && c.getPropertyValue('border-' + k + '-style') !== 'none') }
  const painted = (n) => { const c = styleOf(n).backgroundColor; return !!c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c) }
  const rounded = (n) => parseFloat(styleOf(n).borderTopLeftRadius) > 0
  // Text colour is the clicked element's own. Fill, border and corners belong to the control around it (the label
  // span inside a button paints none of its own), so walk up at most 4 levels to the first element that paints one.
  const owner = (test) => {
    let n = el
    for (let i = 0; n && n.nodeType === 1 && i < 5; i++, n = n.parentElement) {
      if (n === doc.body || n === doc.documentElement) return null
      if (test(n)) return n
    }
    return null
  }
  const targets = { color: el, 'background-color': owner(painted), 'border-color': owner(hasBorder), 'border-radius': owner(rounded) }
  const out = {}
  for (const p of a.props) {
    const target = targets[p.prop]
    if (!target) { out[p.prop] = []; continue }
    const read = () => { const cs = styleOf(target); return p.keys.map((k) => cs.getPropertyValue(k)).join('|') }
    const base = read()
    const hits = []
    for (const t of a.tokens) {
      if (t.kind !== p.kind) continue
      const v = '--' + t.cssVar
      const old = root.getPropertyValue(v)
      root.setProperty(v, p.kind === 'radius' ? a.radius : a.color)
      const moved = read() !== base
      if (old) root.setProperty(v, old); else root.removeProperty(v)
      if (moved) hits.push(t.name)
    }
    out[p.prop] = hits
  }
  const r = el.getBoundingClientRect()
  const cs = styleOf(el)
  const own = Array.prototype.filter.call(el.childNodes, (n) => n.nodeType === 3).map((n) => n.textContent).join('').trim().replace(/\s+/g, ' ').slice(0, 60)
  const box = (n) => { const q = n.getBoundingClientRect(); return [Math.round(q.left + view.scrollX), Math.round(q.top + view.scrollY), Math.round(q.width), Math.round(q.height)] }
  const ctl = targets['background-color'] || targets['border-color']
  const bg = targets['background-color'], bd = targets['border-color'], rd = targets['border-radius']
  const info = {
    tag: el.tagName.toLowerCase(),
    classes: el.classList ? Array.prototype.slice.call(el.classList, 0, 6) : [],
    text: own || String(el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    bbox: [Math.round(r.left + view.scrollX), Math.round(r.top + view.scrollY), Math.round(r.width), Math.round(r.height)],
    color: cs.color,
    background: bg ? styleOf(bg).backgroundColor : cs.backgroundColor,
    border: bd ? styleOf(bd).borderTopColor : null,
    radius: rd ? styleOf(rd).borderTopLeftRadius : null,
    control: ctl && ctl !== el ? { tag: ctl.tagName.toLowerCase(), classes: Array.prototype.slice.call(ctl.classList, 0, 6), bbox: box(ctl) } : null,
    fontSize: cs.fontSize, fontWeight: cs.fontWeight,
  }
  view.scrollTo(sx, sy)
  return { element: info, controls: out }
}

/**
 * In page: audit every pair with token `cssVar` set to the sentinel; the ids whose text colour is the sentinel use it.
 * Needs window.__c = contrast.js. Self-contained.
 */
export function pairsUsingToken(a) {
  const root = document.documentElement.style
  const v = '--' + a.cssVar
  const old = root.getPropertyValue(v)
  root.setProperty(v, a.color)
  let used
  try { used = window.__c.auditLive(document, a.pairs).filter((r) => r.fg === a.color).map((r) => r.id) } finally {
    if (old) root.setProperty(v, old); else root.removeProperty(v)
  }
  return used
}

/** In page: audit every pair with `changes` ({cssVar, css}) applied, then restore. Self-contained. */
export function auditWith(a) {
  const root = document.documentElement.style
  const prev = a.changes.map((c) => [c.cssVar, root.getPropertyValue('--' + c.cssVar)])
  for (const c of a.changes) root.setProperty('--' + c.cssVar, c.css)
  try {
    return window.__c.auditLive(document, a.pairs).map((r) => ({ id: r.id, text: r.text, status: r.status, ratio: r.ratio == null ? null : r.ratio, bg: r.bg || null, fg: r.fg || null, required: r.required, large: r.large }))
  } finally {
    for (const [k, old] of prev) { if (old) root.setProperty('--' + k, old); else root.removeProperty('--' + k) }
  }
}

/** Alias chain of a token, itself first: [name, alias, alias of alias, ...]. Pure. */
export function aliasChain(name, byName) {
  const out = []
  const seen = new Set()
  for (let cur = name; cur && !seen.has(cur) && byName.has(cur); cur = byName.get(cur).alias) { seen.add(cur); out.push(cur) }
  return out
}

/**
 * Order the tokens that moved one property, nearest first: the nearest is the one no other member aliases (directly
 * or through a chain). A literal-valued token that several unrelated tokens alias still sorts after them. Pure.
 * @param {string[]} hits
 * @param {{name:string, alias?:string|null}[]} tokens
 * @returns {{token:string|null, chain:string[]}}
 */
export function orderChain(hits, tokens) {
  if (!hits || !hits.length) return { token: null, chain: [] }
  const byName = new Map(tokens.map((t) => [t.name, t]))
  const set = new Set(hits)
  // depth = how many other hits alias this one (it is further from the element the more tokens point at it).
  const depth = new Map(hits.map((h) => [h, 0]))
  for (const h of hits) for (const up of aliasChain(h, byName).slice(1)) if (set.has(up)) depth.set(up, depth.get(up) + 1)
  const chain = hits.slice().sort((a, b) => depth.get(a) - depth.get(b) || aliasChain(b, byName).length - aliasChain(a, byName).length || a.localeCompare(b))
  return { token: chain[0], chain }
}

/** Summary of a list of audit rows for the pairs that use a token. Pure. */
export function pairStats(rows) {
  const r = rows.filter((x) => x.ratio != null)
  return {
    count: rows.length,
    pass: rows.filter((x) => x.status === 'pass').length,
    fail: rows.filter((x) => x.status === 'fail').length,
    minRatio: r.length ? Math.min(...r.map((x) => x.ratio)) : null,
    maxRatio: r.length ? Math.max(...r.map((x) => x.ratio)) : null,
  }
}

/**
 * Before/after over every pair: affected (ratio moved), regressions (passed then failed, or failing and got worse),
 * whole-page counts, and the blocked verdict with the first regressed element named. Pure.
 */
export function comparePairs(before, after) {
  const by = new Map(after.map((r) => [r.id, r]))
  const affected = [], regressions = []
  for (const r0 of before) {
    const r1 = by.get(r0.id)
    if (!r1 || r0.ratio == null || r1.ratio == null) continue
    if (Math.abs(r1.ratio - r0.ratio) > 0.005) affected.push({ id: r0.id, text: r0.text, from: r0.ratio, to: r1.ratio, required: r0.required, before: r0.status, after: r1.status })
    if ((r0.status === 'pass' && r1.status === 'fail') || (r1.status === 'fail' && r1.ratio < r0.ratio - 0.005)) regressions.push({ id: r0.id, text: r0.text, from: r0.ratio, to: r1.ratio, required: r0.required })
  }
  const counts = (rs) => ({ pass: rs.filter((x) => x.status === 'pass').length, fail: rs.filter((x) => x.status === 'fail').length })
  const range = (xs) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: null, max: null })
  const blocked = regressions.length > 0
  const reg = regressions[0]
  return {
    affected: affected.length,
    before: { ...range(affected.map((x) => x.from)), pass: affected.filter((x) => x.before === 'pass').length, fail: affected.filter((x) => x.before === 'fail').length },
    after: { ...range(affected.map((x) => x.to)), pass: affected.filter((x) => x.after === 'pass').length, fail: affected.filter((x) => x.after === 'fail').length },
    page: { before: counts(before), after: counts(after) },
    regressions,
    blocked,
    reason: blocked ? `text contrast: "${reg.text}" ${reg.from} → ${reg.to} (needs ${reg.required})${regressions.length > 1 ? ` and ${regressions.length - 1} more` : ''}` : null,
    items: affected,
  }
}
