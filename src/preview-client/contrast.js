// WCAG 2.x contrast for the token playground. Pure functions (Node tests import them) plus one DOM sampler the page
// runs against the live iframe, so the check always uses the CURRENT token values, not the captured ones.
// ES module with no imports: the playground loads it with import('./contrast.js'); the server reuses the validators.

// Same fail-safe rule as sorb-preview.js (and @sorb/leaf sanitize): anything that could break out of a declaration.
// test/contrast.test.js checks the two copies stay identical.
export const UNSAFE = /[;{}<>\\]|url\(|expression\(|@import|javascript:/i

const WHITE = { r: 255, g: 255, b: 255, a: 1 }

/** Parse #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba() (comma or space syntax) and `transparent`. Null if unknown. */
export function parseColor(s) {
  s = String(s == null ? '' : s).trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (m) {
    let h = m[1]
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
    const n = (i) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 }
  }
  m = s.match(/^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/)
  if (m) {
    let a = m[4] === undefined ? 1 : Number(m[4])
    if (m[5] === '%') a /= 100
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Math.max(0, Math.min(1, a)) }
  }
  return null
}

/** #rrggbb for an opaque color (alpha dropped). */
export function toHex(c) {
  return '#' + [c.r, c.g, c.b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')
}

/** Paint `top` (possibly translucent) over an opaque `bottom`. */
export function composite(top, bottom) {
  const a = top.a
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 }
}

/** WCAG 2.x relative luminance. */
export function luminance(c) {
  const ch = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}

/** Contrast ratio of a (possibly translucent) foreground over an opaque background, 1..21. */
export function contrastRatio(fg, bg) {
  const f = fg.a < 1 ? composite(fg, bg) : fg
  const l1 = luminance(f), l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** WCAG large text: at least 18pt (24px), or 14pt (18.66px) and bold (700+). */
export function isLargeText(fontSizePx, fontWeight) {
  const px = parseFloat(fontSizePx) || 0
  const w = fontWeight === 'bold' ? 700 : parseFloat(fontWeight) || 400
  return px >= 24 || (px >= 18.66 && w >= 700)
}

/** AA minimum: 4.5 for body text, 3.0 for large text. */
export const requiredRatio = (large) => (large ? 3 : 4.5)

/** Colors listed in a computed background-image gradient (rgb()/rgba()/hex stops). */
export function gradientColors(img) {
  if (!img || img === 'none' || !/gradient\(/i.test(img)) return []
  const out = []
  const re = /rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi
  let m
  while ((m = re.exec(img))) { const c = parseColor(m[0]); if (c) out.push(c) }
  return out
}

/**
 * Flatten background layers (closest first; a gradient layer lists several colors) onto the white canvas.
 * Returns every opaque color the text could sit on (a gradient gives one per stop), capped at 16.
 */
export function flattenLayers(layers) {
  let below = [WHITE]
  for (let i = layers.length - 1; i >= 0; i--) {
    const next = []
    for (const top of layers[i]) for (const b of below) next.push(top.a >= 1 ? { ...top, a: 1 } : composite(top, b))
    below = next.slice(0, 16)
  }
  return below
}

/** Worst (lowest) contrast of a foreground over any of the candidate backgrounds. */
export function worstRatio(fg, bgs) {
  let worst = Infinity, at = bgs[0]
  for (const b of bgs) { const r = contrastRatio(fg, b); if (r < worst) { worst = r; at = b } }
  return { ratio: worst, bg: at }
}

/**
 * Text elements from a run's capture.json: one entry per element with its own text and a color.
 * The background is resolved from the capture itself (nearest earlier element whose box contains this one and has
 * an opaque or translucent background; elements are in document order), which is the static baseline. The page
 * re-resolves both colors live from the iframe.
 * @param {{elements:Array<{i:number,tag:string,path:string,text:string,bbox:number[],styles:Record<string,string>}>}} capture
 */
export function pairsFromCapture(capture) {
  const els = (capture && capture.elements) || []
  const contains = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[0] + a[2] >= b[0] + b[2] && a[1] + a[3] >= b[1] + b[3]
  const seen = {}
  const out = []
  els.forEach((e, idx) => {
    const text = (e.text || '').trim()
    const fg = parseColor(e.styles && e.styles.color)
    if (!text || !fg || e.tag === 'svg' || e.tag === 'img') return
    const layers = []
    const own = parseColor(e.styles['background-color'])
    if (own && own.a > 0) layers.push([own])
    for (let j = idx - 1; j >= 0 && !(layers.length && layers[layers.length - 1].every((c) => c.a >= 1)); j--) {
      const p = els[j]
      if (!contains(p.bbox, e.bbox)) continue
      const c = parseColor(p.styles && p.styles['background-color'])
      if (c && c.a > 0) layers.push([c])
    }
    const bgs = flattenLayers(layers)
    const key = e.path + '|' + text
    const nth = seen[key] = (seen[key] === undefined ? 0 : seen[key] + 1)
    const large = isLargeText(e.styles['font-size'], e.styles['font-weight'])
    const w = worstRatio(fg, bgs)
    out.push({
      id: 'p' + e.i, path: e.path, text, nth, large, required: requiredRatio(large),
      fontSize: e.styles['font-size'], fontWeight: e.styles['font-weight'],
      captured: { fg: e.styles.color, bg: toHex(w.bg), ratio: round2(w.ratio) },
    })
  })
  return out
}

export const round2 = (n) => Math.round(n * 100) / 100

/** Text an element owns directly (the same rule capture.js uses). */
export function ownText(el) {
  let s = ''
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent
  return s.trim().replace(/\s+/g, ' ').slice(0, 40)
}

/** Background layers (closest first) painted by elements listed top to bottom; null when one is an image. */
function layersOf(view, els) {
  const layers = []
  for (const n of els) {
    const s = view.getComputedStyle(n)
    if (s.backgroundImage && s.backgroundImage !== 'none') {
      if (/url\(/i.test(s.backgroundImage)) return null
      const stops = gradientColors(s.backgroundImage)
      if (stops.length) layers.push(stops)
    }
    const c = parseColor(s.backgroundColor)
    if (c && c.a > 0) layers.push([c])
    if (layers.length && layers[layers.length - 1].every((x) => x.a >= 1)) break
  }
  return layers
}

/**
 * Evaluate captured pairs against the live document (the iframe): find each element again by its path + own text,
 * read its computed color, and find what is painted under the start of its text. Hit-testing (elementsFromPoint)
 * catches backgrounds that are not ancestors, like Argon's absolutely positioned gradient header; the element is
 * scrolled into view for that and the scroll position restored. If hit-testing cannot reach it (a clipped scroller),
 * its ancestors are walked instead. Gradients count every stop (worst case); an image background cannot be checked.
 * @returns {Array<object>} one result per pair: {..pair, status:'pass'|'fail'|'missing'|'hidden'|'image', fg, bg, ratio}
 */
export function auditLive(doc, pairs) {
  const view = doc.defaultView
  const cache = {}
  const sx = view.scrollX, sy = view.scrollY
  const thaw = freezeTransitions(doc)
  try {
    return pairs.map((p) => {
      let list = cache[p.path]
      if (!list) {
        try { list = Array.prototype.slice.call(doc.querySelectorAll(p.path)) } catch (e) { list = [] }
        cache[p.path] = list
      }
      const el = list.filter((n) => ownText(n) === p.text)[p.nth]
      if (!el) return { ...p, status: 'missing' }
      const cs = view.getComputedStyle(el)
      let r = el.getBoundingClientRect()
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || r.width < 1 || r.height < 1) return { ...p, status: 'hidden' }
      let cy = r.top + r.height / 2
      if (cy < 0 || cy >= view.innerHeight) {
        view.scrollTo(sx, Math.max(0, view.scrollY + cy - view.innerHeight / 2))
        r = el.getBoundingClientRect()
        cy = r.top + r.height / 2
      }
      const cx = Math.min(Math.max(r.left + Math.min(r.width / 2, 12), 0), view.innerWidth - 1)
      let stack = cy >= 0 && cy < view.innerHeight && doc.elementsFromPoint ? doc.elementsFromPoint(cx, cy) : []
      const at = stack.indexOf(el)
      // Not hit-testable itself (pointer-events: none): use what is under it, minus its own children.
      stack = at >= 0 ? stack.slice(at) : stack.length ? [el].concat(stack.filter((n) => !el.contains(n))) : []
      if (!stack.length) for (let n = el; n && n.nodeType === 1; n = n.parentElement) stack.push(n)
      const layers = layersOf(view, stack)
      if (!layers) return { ...p, status: 'image' }
      const fg = parseColor(cs.color)
      if (!fg) return { ...p, status: 'missing' }
      const w = worstRatio(fg, flattenLayers(layers))
      const ratio = round2(w.ratio)
      // A gradient's colors are not tokens (the run tokenizes background-color only), so it is flagged, not matched.
      const gradient = layers.some((l) => l.length > 1)
      return { ...p, status: ratio + 1e-9 >= p.required ? 'pass' : 'fail', fg: fg.a < 1 ? cs.color : toHex(fg), fgSolid: toHex(composite(fg, w.bg)), bg: toHex(w.bg), gradient, ratio }
    })
  } finally {
    if (view.scrollX !== sx || view.scrollY !== sy) view.scrollTo(sx, sy)
    thaw()
  }
}

/**
 * Turn CSS transitions off in a document until the returned function is called. getComputedStyle mid-transition
 * reports the in-between color (Argon's links fade over .15 s), so every check reads end values with this on.
 * Nested calls are counted; only the outermost thaw removes the style.
 */
export function freezeTransitions(doc) {
  const id = 's2t-freeze-transitions'
  let el = doc.getElementById(id)
  if (!el) {
    el = doc.createElement('style')
    el.id = id
    el.textContent = '*,*::before,*::after{transition:none!important;animation-play-state:paused!important}'
    ;(doc.head || doc.documentElement).appendChild(el)
  }
  el.dataset.depth = String((Number(el.dataset.depth) || 0) + 1)
  return () => {
    const d = (Number(el.dataset.depth) || 1) - 1
    el.dataset.depth = String(d)
    if (d <= 0) el.remove()
  }
}

/**
 * The background most checked text sits on, and whether it is dark (relative luminance at most 0.12, about #616161).
 * A "dark theme" that keeps this light is not one, whatever its contrast score.
 */
export function dominantBackground(results) {
  const n = {}
  for (const r of results) if (r.status === 'pass' || r.status === 'fail') n[r.bg] = (n[r.bg] || 0) + 1
  const keys = Object.keys(n).sort((a, b) => n[b] - n[a])
  if (!keys.length) return null
  const total = keys.reduce((s, k) => s + n[k], 0)
  const lum = luminance(parseColor(keys[0]))
  return { bg: keys[0], share: round2(n[keys[0]] / total), luminance: round2(lum), dark: lum <= 0.12 }
}

/** Split failures into ones tokens can fix and ones on a gradient (the run does not tokenize background-image). */
export function splitFailures(results) {
  const fails = results.filter((r) => r.status === 'fail')
  return { fixable: fails.filter((r) => !r.gradient), gradient: fails.filter((r) => r.gradient) }
}

/** Group failing results by (fg, bg, required) so one bad pairing shows once with its examples. */
export function groupFailures(results) {
  const groups = {}
  for (const r of results) {
    if (r.status !== 'fail') continue
    const k = r.fg + '|' + r.bg + '|' + r.required
    const g = groups[k] || (groups[k] = { fg: r.fg, fgSolid: r.fgSolid, bg: r.bg, gradient: !!r.gradient, ratio: r.ratio, required: r.required, large: r.large, count: 0, examples: [], ids: [] })
    g.count++
    g.ids.push(r.id)
    if (g.examples.length < 3 && g.examples.indexOf(r.text) < 0) g.examples.push(r.text)
  }
  return Object.keys(groups).map((k) => groups[k]).sort((a, b) => a.ratio - b.ratio)
}

/**
 * Tokens whose current value equals a color, semantic first (the decision a person would change), then component,
 * then primitive. `tokenValues` = [{name, cssVar, tier, value}] with values resolved from the live root.
 */
export function tokensForColor(color, tokenValues) {
  const c = parseColor(color)
  if (!c) return []
  const same = (v) => { const x = parseColor(v); return x && x.r === c.r && x.g === c.g && x.b === c.b && Math.abs(x.a - c.a) < 0.01 }
  const rank = { semantic: 0, component: 1, primitive: 2 }
  return tokenValues.filter((t) => same(t.value)).sort((a, b) => (rank[a.tier] ?? 3) - (rank[b.tier] ?? 3)).map((t) => t.name)
}

/** Token name -> CSS custom property without "--" (color.text.muted -> color-text-muted); same rule as props.cssVarOf. */
export const cssVarName = (name) => String(name).trim().replace(/[.\s/]+/g, '-').toLowerCase()

/**
 * Validate a model's proposal. Accepts {changes:[{token, value, reason}]} or {token: {value, reason}} / {token: value}.
 * Keeps a change only when the token is known (or, with allowNew, a new primitive color.*) and the value is a plain
 * color, or (with allowAlias) a reference to a known token. Never passes through anything matching UNSAFE.
 * @param {any} raw parsed model JSON
 * @param {{known:string[], allowNew?:boolean, allowAlias?:boolean}} o
 * @returns {{changes:Array<{token:string, cssVar:string, value:string, css:string, reason:string, isNew:boolean}>, rejected:Array<{token:string, value:string, why:string}>, summary:string}}
 */
export function sanitizeProposal(raw, o) {
  const known = new Set(o.known || [])
  const out = { changes: [], rejected: [], summary: '' }
  if (!raw || typeof raw !== 'object') return out
  if (typeof raw.summary === 'string') out.summary = raw.summary.replace(/[<>]/g, '').slice(0, 600)
  let items = []
  if (Array.isArray(raw.changes)) items = raw.changes
  else {
    const src = raw.changes && typeof raw.changes === 'object' ? raw.changes : raw
    items = Object.keys(src).filter((k) => k !== 'summary').map((k) => {
      const v = src[k]
      return v && typeof v === 'object' ? { token: k, value: v.value, reason: v.reason } : { token: k, value: v }
    })
  }
  const seen = {}
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const token = String(it.token || it.name || '').trim()
    const value = String(it.value == null ? '' : it.value).trim()
    const reason = String(it.reason || '').replace(/[<>]/g, '').slice(0, 300)
    const reject = (why) => out.rejected.push({ token: token.slice(0, 80), value: value.slice(0, 80), why })
    if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(token)) { reject('not a token name'); continue }
    const isKnown = known.has(token)
    const isNew = !isKnown && !!o.allowNew && /^color\./.test(token)
    if (!isKnown && !isNew) { reject('unknown token'); continue }
    if (UNSAFE.test(value) || value.length > 64) { reject('unsafe value'); continue }
    let css = null
    const c = parseColor(value)
    if (c) css = c.a < 1 ? value : toHex(c)
    else if (o.allowAlias) {
      // "color.gray.900", "{color.gray.900}" or "var(--color-gray-900)" pointing at a known (or newly added) token.
      const ref = value.replace(/^\{|\}$/g, '').replace(/^var\(--([a-z0-9-]+)\)$/i, '$1')
      const target = known.has(ref) ? ref : Array.from(known).concat(items.map((x) => x && String(x.token || ''))).find((n) => cssVarName(n) === cssVarName(ref))
      if (target && target !== token) css = 'var(--' + cssVarName(target) + ')'
    }
    if (!css) { reject('not a color'); continue }
    if (seen[token]) continue
    seen[token] = 1
    out.changes.push({ token, cssVar: cssVarName(token), value, css, reason, isNew })
  }
  return out
}
