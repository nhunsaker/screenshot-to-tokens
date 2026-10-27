// Text contrast (WCAG 2.x AA, SC 1.4.3), the fourth verify check (L12). Text color comes from the DOM (computed
// style, times the opacity of the element and its ancestors); the BACKGROUND is measured on the rendered pixels
// under the letters, so text over gradients, images and overlays gets a real number instead of "needs review".
//
// Per text element: take the pixels inside its own text runs, find the glyphs (pixels at the text color, plus
// anti-aliased blends of text and background), drop them and a 1 px band around them, and cluster what is left
// within a few px of the glyphs. The background is the worst-contrast cluster that covers at least 5% of that ring
// (the "best" cluster is kept too: the W3C ACT rule scores the highest possible contrast).
// Pure functions on decoded PNG data ({width, height, data: RGBA}); the pipeline and the benchmarks share them.
import { parseColor, contrastRatio, composite, toHex, isLargeText, requiredRatio, round2, tokensForColor } from '../preview-client/contrast.js'

// Tunables. GLYPH_DE: a pixel this close (CIE76 ΔE) to the painted text color is ink. CLUSTER_DE: background colors
// this close are one cluster. MIN_SHARE: a cluster must cover this much of the ring to count (stray pixels from a
// child icon or a neighbour's border don't decide the verdict). RING: how far from the glyphs we look, in px.
export const GLYPH_DE = 6
const CLUSTER_DE = 5
export const MIN_SHARE = 0.05
const RING = 4
const MAX_GRID = 600000

// ---------------------------------------------------------------------------
// color math
// ---------------------------------------------------------------------------

const labCache = new Map()
/** sRGB (0..255) to CIE Lab (D65), cached by packed color. */
export function lab(r, g, b) {
  const key = (r << 16) | (g << 8) | b
  let v = labCache.get(key)
  if (v) return v
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const R = lin(r), G = lin(g), B = lin(b)
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  v = [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  if (labCache.size > 200000) labCache.clear()
  labCache.set(key, v)
  return v
}

/** CIE76 ΔE between two Lab triples. */
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const labOf = (c) => lab(Math.round(c.r), Math.round(c.g), Math.round(c.b))

/** Greedy color clusters: bins (5 bits per channel) by count, each joins the first cluster within CLUSTER_DE. */
function clusterPixels(list) {
  const bins = new Map()
  for (const [r, g, b] of list) {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const e = bins.get(k)
    if (e) { e.n++; e.r += r; e.g += g; e.b += b } else bins.set(k, { n: 1, r, g, b })
  }
  const clusters = []
  for (const e of Array.from(bins.values()).sort((a, b) => b.n - a.n)) {
    const c = { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }
    const L = labOf(c)
    const hit = clusters.find((k) => dE(k.lab, L) <= CLUSTER_DE)
    if (hit) { hit.r += e.r; hit.g += e.g; hit.b += e.b; hit.n += e.n } else clusters.push({ r: e.r, g: e.g, b: e.b, n: e.n, lab: L })
  }
  const total = list.length || 1
  return clusters.map((k) => ({ color: { r: k.r / k.n, g: k.g / k.n, b: k.b / k.n, a: 1 }, n: k.n, share: k.n / total })).sort((a, b) => b.n - a.n)
}

// ---------------------------------------------------------------------------
// the pixel background sampler
// ---------------------------------------------------------------------------

/**
 * Measure one text sample's contrast against the pixels under it.
 * @param {{width:number, height:number, data:Uint8Array|Buffer}} img decoded screenshot (RGBA)
 * @param {{rects:number[][], color:string, opacity?:number}} s text sample: text-run boxes in page px, painted color
 * @returns {{status:'measured'|'offscreen'|'no-glyphs'|'invisible', fg?:string, worst?:{ratio:number, bg:string, share:number},
 *   best?:{ratio:number, bg:string, share:number}, clusters?:Array<{bg:string, share:number, ratio:number}>, glyphPx?:number, ringPx?:number}}
 */
export function sampleBackground(img, s) {
  const fg0 = parseColor(s.color)
  if (!fg0) return { status: 'no-glyphs' }
  const fg = { ...fg0, a: fg0.a * (s.opacity == null ? 1 : s.opacity) }
  // Grid over the union of the text runs, clipped to the image; only pixels inside a run are used.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const rects = []
  for (const r of s.rects || []) {
    const a = Math.max(0, Math.floor(r[0])), b = Math.max(0, Math.floor(r[1]))
    const c = Math.min(img.width, Math.ceil(r[0] + r[2])), d = Math.min(img.height, Math.ceil(r[1] + r[3]))
    if (c - a < 1 || d - b < 1) continue
    rects.push([a, b, c, d])
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d)
  }
  if (!rects.length) return { status: 'offscreen' }
  // Very large text blocks are subsampled so one paragraph can't stall the check.
  const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_GRID)))
  const W = Math.ceil((x1 - x0) / step), H = Math.ceil((y1 - y0) / step)
  const inside = new Uint8Array(W * H)
  for (const [a, b, c, d] of rects) {
    for (let y = Math.floor((b - y0) / step); y < Math.ceil((d - y0) / step); y++) for (let x = Math.floor((a - x0) / step); x < Math.ceil((c - x0) / step); x++) inside[y * W + x] = 1
  }
  const rgb = new Uint8Array(W * H * 3)
  const cells = []
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
    const i = gy * W + gx
    if (!inside[i]) continue
    const px = ((y0 + gy * step) * img.width + (x0 + gx * step)) * 4
    rgb[i * 3] = img.data[px]; rgb[i * 3 + 1] = img.data[px + 1]; rgb[i * 3 + 2] = img.data[px + 2]
    cells.push(i)
  }
  const at = (i) => [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]
  const L = (i) => lab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])

  // Background seeds: the main colors that are clearly not ink. Translucent text paints a different ink color on
  // each background, so its ink is the text composited over each seed.
  const ink0 = fg.a < 1 ? composite(fg, clusterPixels(cells.map(at))[0].color) : fg
  const far = cells.filter((i) => dE(L(i), labOf(ink0)) > GLYPH_DE)
  if (far.length < cells.length * 0.02) {
    // Text and background are the same color: not visible text (the ACT rule treats 1:1 as not text at all).
    const m = clusterPixels(cells.map(at))[0].color
    return { status: 'invisible', fg: toHex(composite(fg, m)), worst: { ratio: round2(contrastRatio(fg, m)), bg: toHex(m), share: 1 } }
  }
  const seeds = clusterPixels(far.map(at)).filter((k, j) => j === 0 || k.share >= 0.1).slice(0, 3).map((k) => k.color)
  const inks = seeds.map((c) => ({ ink: fg.a < 1 ? composite(fg, c) : fg, bg: c }))

  // Glyph mask: ink pixels, plus blends lying on the ink-to-background line at 40%+ coverage (thin stems at small
  // sizes often have no fully covered pixel). If that claims most of the box, the "blends" are really a background
  // (a gradient running toward the text color), so only exact ink counts.
  const glyph = new Uint8Array(W * H)
  const core = new Uint8Array(W * H)
  let nCore = 0, nGlyph = 0
  for (const i of cells) {
    const p = at(i), Lp = L(i)
    for (const { ink } of inks) {
      if (dE(Lp, labOf(ink)) <= GLYPH_DE) { core[i] = 1; break }
    }
    if (core[i]) { nCore++; glyph[i] = 1; nGlyph++; continue }
    for (const { ink, bg } of inks) {
      const vx = bg.r - ink.r, vy = bg.g - ink.g, vz = bg.b - ink.b
      const len2 = vx * vx + vy * vy + vz * vz
      if (len2 < 400) continue
      const t = ((p[0] - ink.r) * vx + (p[1] - ink.g) * vy + (p[2] - ink.b) * vz) / len2
      if (t < 0 || t > 0.6) continue
      const d = Math.hypot(p[0] - ink.r - t * vx, p[1] - ink.g - t * vy, p[2] - ink.b - t * vz)
      if (d <= 12) { glyph[i] = 1; nGlyph++; break }
    }
  }
  if (nGlyph > cells.length * 0.55) { glyph.set(core); nGlyph = nCore }
  if (!nCore && nGlyph < 3) return { status: 'no-glyphs', fg: toHex(inks[0].ink) }

  // Chessboard distance from the glyphs (two passes). The 1 px band is anti-aliasing; the ring (2..RING px) is the
  // background the letters are read against, which is where a text-shadow halo or a gradient under the words shows.
  const dist = new Uint16Array(W * H).fill(65535)
  for (let i = 0; i < W * H; i++) if (glyph[i]) dist[i] = 0
  const relax = (i, j) => { if (dist[j] + 1 < dist[i]) dist[i] = dist[j] + 1 }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (x > 0) relax(i, i - 1)
    if (y > 0) { relax(i, i - W); if (x > 0) relax(i, i - W - 1); if (x < W - 1) relax(i, i - W + 1) }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x
    if (x < W - 1) relax(i, i + 1)
    if (y < H - 1) { relax(i, i + W); if (x < W - 1) relax(i, i + W + 1); if (x > 0) relax(i, i + W - 1) }
  }
  const band = Math.max(1, Math.round(RING / step))
  let ring = cells.filter((i) => !glyph[i] && dist[i] >= 2 && dist[i] <= band + 1)
  if (!ring.length) ring = cells.filter((i) => !glyph[i] && dist[i] >= 2)
  if (!ring.length) ring = far
  const all = clusterPixels(ring.map(at))
  let sig = all.filter((k) => k.share >= MIN_SHARE && k.n >= 3)
  if (!sig.length) sig = all.slice(0, 1)
  const scored = sig.map((k) => ({ bg: toHex(k.color), share: round2(k.share), ratio: round2(contrastRatio(fg, k.color)), c: k.color }))
  const worst = scored.reduce((a, b) => (b.ratio < a.ratio ? b : a))
  const best = scored.reduce((a, b) => (b.ratio > a.ratio ? b : a))
  const pick = (k) => ({ ratio: k.ratio, bg: k.bg, share: k.share })
  return {
    status: 'measured',
    fg: fg.a < 1 ? toHex(composite(fg, worst.c)) : toHex(fg),
    worst: pick(worst), best: pick(best),
    clusters: scored.slice(0, 5).map(pick).map((k) => ({ bg: k.bg, share: k.share, ratio: k.ratio })),
    glyphPx: nGlyph, ringPx: ring.length,
  }
}

// ---------------------------------------------------------------------------
// pairs, verdicts, the gate
// ---------------------------------------------------------------------------

/** Text that says nothing in a human language (only symbols / punctuation) is exempt from SC 1.4.3 (ACT afw4f7). */
export const isDecorative = (text) => !/[\p{L}\p{N}]/u.test(String(text || ''))

/**
 * Evaluate every text sample of one render against its screenshot.
 * @param {{width:number,height:number,data:any}} img
 * @param {Array<import('../types.js').TextSample>} samples
 * @param {{mode?:'worst'|'best'}} [o] worst (default): the gate's conservative reading. best: ACT's "highest possible contrast".
 * @returns {Array<import('../types.js').ContrastPair>}
 */
export function evaluateTexts(img, samples, o = {}) {
  const mode = o.mode || 'worst'
  const seen = {}
  return samples.map((s) => {
    const k = s.path + '|' + s.text
    const nth = seen[k] = seen[k] === undefined ? 0 : seen[k] + 1
    const large = isLargeText(s.fontSize, s.fontWeight)
    const base = { key: k + '|' + nth, path: s.path, text: s.text, color: s.color, large, required: requiredRatio(large), bbox: s.bbox }
    if (s.disabled) return { ...base, status: 'disabled' }
    if (isDecorative(s.text)) return { ...base, status: 'decorative' }
    const m = sampleBackground(img, s)
    if (m.status !== 'measured') return { ...base, status: m.status, ...(m.worst ? { ratio: m.worst.ratio, bg: m.worst.bg } : {}) }
    const use = mode === 'best' ? m.best : m.worst
    return {
      ...base, fg: m.fg, bg: use.bg, ratio: use.ratio, bestRatio: m.best.ratio, worstRatio: m.worst.ratio,
      clusters: m.clusters.length, status: use.ratio + 1e-9 >= base.required ? 'pass' : 'fail',
    }
  })
}

/**
 * Color tokens to look a value up in: every token's resolved value, plus each member value of the clusters it covers
 * (the original color before a ΔE-3 merge). Tokens whose cluster is used as a text `color` sort first.
 * @param {{tokens:Array<{name:string,tier:string,value?:string,alias?:string,clusters?:string[]}>}} tokens
 * @param {Array<{id:string, members?:Array<{value:string}>, props?:Record<string,number>}>} clusters
 */
export function tokenIndex(tokens, clusters = []) {
  const byName = new Map(tokens.tokens.map((t) => [t.name, t]))
  const resolve = (t, n = 0) => (t && t.value) || (t && t.alias && n < 8 ? resolve(byName.get(t.alias), n + 1) : null)
  const byId = new Map(clusters.map((c) => [c.id, c]))
  const values = [], textUse = new Set()
  for (const t of tokens.tokens) {
    if (t.review === 'rejected') continue
    const v = resolve(t)
    if (v) values.push({ name: t.name, tier: t.tier, value: v })
    for (const id of t.clusters || []) {
      const c = byId.get(id)
      if (!c) continue
      if (c.props && c.props.color) textUse.add(t.name)
      for (const m of c.members || []) values.push({ name: t.name, tier: t.tier, value: m.value })
    }
  }
  return { values, textUse }
}

/** Tokens controlling a text color: tokens whose value (or merged original) equals it, text-color tokens first. */
export function textTokens(color, index) {
  if (!index || !color) return []
  const names = Array.from(new Set(tokensForColor(color, index.values)))
  return names.map((n, i) => [n, i]).sort((a, b) => (index.textUse.has(b[0]) - index.textUse.has(a[0])) || a[1] - b[1]).map((x) => x[0]).slice(0, 3)
}

/**
 * The gate. Pairs match across renders by path + text + occurrence. A regression is a pair that met its minimum
 * before and does not after (in any after-render; `renders` lists which, `ratio` is the lowest); existing failures
 * are reported, not blocking. Improved: failed before, passes in every after-render it was measured in.
 * @param {Array<import('../types.js').ContrastPair>} before
 * @param {Record<string, Array<import('../types.js').ContrastPair>>} afters  e.g. {colors: [...], all: [...]}
 */
export function contrastGate(before, afters) {
  const fails = (list) => list.filter((p) => p.status === 'fail')
  const idx = {}
  for (const [name, list] of Object.entries(afters)) idx[name] = new Map(list.map((p) => [p.key, p]))
  const regressions = [], improved = []
  for (const b of before) {
    if (b.status !== 'pass' && b.status !== 'fail') continue
    const seen = Object.keys(afters).map((name) => [name, idx[name].get(b.key)]).filter(([, a]) => a && (a.status === 'pass' || a.status === 'fail'))
    if (!seen.length) continue
    const failed = seen.filter(([, a]) => a.status === 'fail')
    if (b.status === 'pass' && failed.length) {
      const worst = failed.reduce((x, y) => (y[1].ratio < x[1].ratio ? y : x))[1]
      regressions.push({ ...worst, renders: failed.map(([n]) => n), before: b.ratio })
    }
    if (b.status === 'fail' && !failed.length) improved.push({ ...seen[0][1], renders: seen.map(([n]) => n), before: b.ratio })
  }
  const failingAfter = {}
  for (const [name, list] of Object.entries(afters)) failingAfter[name] = fails(list).length
  const counts = {}
  for (const p of before) counts[p.status] = (counts[p.status] || 0) + 1
  return { pairs: before.filter((p) => p.status === 'pass' || p.status === 'fail').length, failingBefore: fails(before).length, failingAfter, regressions, improved, counts }
}

/**
 * The fourth verify check end to end, from decoded screenshots and the text samples read from the same renders.
 * @param {{before:{img:any, texts:any[]}, afters:Record<string,{img:any, texts:any[]}>, tokens?:any, clusters?:any[]}} o
 * @returns {import('../types.js').ContrastResult}
 */
export function runContrastCheck(o) {
  const before = evaluateTexts(o.before.img, o.before.texts)
  const afters = {}
  for (const [k, v] of Object.entries(o.afters)) afters[k] = evaluateTexts(v.img, v.texts)
  const g = contrastGate(before, afters)
  const index = o.tokens ? tokenIndex(o.tokens, o.clusters || []) : null
  // The controlling token is read from the color-tokens render (there the text color IS the token's value), falling
  // back to the original color (a merged cluster member).
  const colorsBy = new Map((afters.colors || []).map((p) => [p.key, p]))
  const tokensOf = (p) => {
    const a = colorsBy.get(p.key)
    const t = textTokens(a && a.color, index)
    return t.length ? t : textTokens(p.color, index)
  }
  const slim = (p) => ({
    key: p.key, text: p.text, path: p.path, fg: p.fg, bg: p.bg, ratio: p.ratio, required: p.required, large: p.large, bbox: p.bbox,
    ...(p.bestRatio !== undefined && p.bestRatio !== p.ratio ? { bestRatio: p.bestRatio } : {}),
    tokens: tokensOf(p),
  })
  const failing = before.filter((p) => p.status === 'fail').sort((a, b) => a.ratio - b.ratio).map(slim)
  const failingAfterList = {}
  for (const [k, list] of Object.entries(afters)) failingAfterList[k] = list.filter((p) => p.status === 'fail').map((p) => p.key)
  return {
    check: 'text contrast (WCAG 2.x AA, SC 1.4.3)',
    method: 'text color from computed style; background measured on the rendered pixels around the glyphs (worst cluster covering 5%+)',
    pairs: g.pairs,
    failingBefore: g.failingBefore,
    failingAfter: g.failingAfter,
    regressions: g.regressions.map((r) => ({ ...slim(r), renders: r.renders, before: r.before })),
    improved: g.improved.map((r) => ({ ...slim(r), renders: r.renders, before: r.before })),
    skipped: Object.fromEntries(Object.entries(g.counts).filter(([k]) => k !== 'pass' && k !== 'fail')),
    pass: g.regressions.length === 0,
    failing,
    failingAfterKeys: failingAfterList,
  }
}

/**
 * Fallback text samples from an older capture.json (no text-run boxes): the element box stands in for the runs.
 * Used only when the original page could not be re-rendered for the check.
 * @param {import('../types.js').Capture} capture
 * @returns {Array<import('../types.js').TextSample>}
 */
export function textsFromCapture(capture) {
  return ((capture && capture.elements) || []).filter((e) => (e.text || '').trim() && e.styles && e.styles.color && !/^(svg|img|text|tspan)$/.test(e.tag)).map((e) => ({
    path: e.path, tag: e.tag, text: e.text.trim(), bbox: e.bbox, rects: [e.bbox], color: e.styles.color, opacity: 1,
    fontSize: e.styles['font-size'], fontWeight: e.styles['font-weight'], disabled: false,
  }))
}
