// L18: keyboard focus. Tab through a page and, for every stop, compare the focused and unfocused pixels in a padded box
// around the control (WCAG 2.4.13-style "focus appearance" numbers, measured on rendered pixels):
//   pass  = the pixels that change on focus cover at least a 2 CSS px perimeter of the control, at >= 3:1 luminance
//           contrast between their focused and unfocused colors;
//   faint = a visible change (at least half that area changes) that is under the bar;
//   none  = less than half that area changes (usually nothing at all).
// Reachability: controls SAM saw that the page treats as clickable, that no Tab stop reaches, and whose element is not
// a native focusable element (those are reached or deliberately disabled; see unreachableControls).
// Fix as tokens: component-tier --focus-ring-* custom properties in tokens.css plus one :focus-visible rule (focus.css),
// the ring color picked from the run's color tokens by measured contrast against what surrounds each control.
// Output: <run>/focus.json (+ focus.css and a marked block in tokens.css with --fix). Pixel math is pure and exported.
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { PNG } from 'pngjs'
import { cssVarOf } from '../lib/props.js'
import { serveDir } from '../lib/serve.js'
import { colorClusters, tokenValues, iou } from './nontext.js'
import { contrastRatio, parseColor, toHex, luminance, round2 } from '../preview-client/contrast.js'

export const FOCUS_MIN_RATIO = 3 // WCAG 2.4.13: the focus indicator's change of color is at least 3:1
export const PERIMETER_PX = 2 // ...over an area at least as large as a 2 CSS px thick perimeter of the control
export const VISIBLE_SHARE = 0.5 // under half that area changing reads as no visible focus
export const PAD = 8 // CSS px around the control that we compare (an outline at offset 2 + width 3 ends at 5)
export const DEFAULT_CAP = 400 // Tab presses per page
export const DIFF_MIN = 30 // summed |dR|+|dG|+|dB| for a pixel to count as changed (antialiasing noise is lower)
export const RING = { width: '3px', offset: '2px' }

/** Native focusable elements, the reachability exemption and the fix's target list (input type=hidden can't focus). */
export const NATIVE_FOCUSABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
/** What exempts a SAM control from the reachability flag: native focusables, any [tabindex], any `a`, and disabled controls. */
export const REACH_EXEMPT = 'a, button, input, select, textarea, summary, [tabindex], [disabled], [aria-disabled="true"]'

// ---------------------------------------------------------------------------------------------------------------
// Pixel math (pure)
// ---------------------------------------------------------------------------------------------------------------

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** Pixel area of a solid 2 CSS px perimeter around a w x h control (the 2.4.13 minimum area). */
export const perimeterArea = (w, h) => Math.round(2 * (w + h) * PERIMETER_PX)

/** Verdict from the counts: pass / faint / none. */
export function verdictOf({ changed, strong, perimeter2px }) {
  if (strong >= perimeter2px) return 'pass'
  if (changed >= perimeter2px * VISIBLE_SHARE) return 'faint'
  return 'none'
}

/**
 * Compare a focused and an unfocused shot of the same clip (RGBA, same size).
 * @param {{width:number,height:number,data:Uint8Array|Buffer}} focused
 * @param {{width:number,height:number,data:Uint8Array|Buffer}} blurred
 * @param {{w:number,h:number}} box the control's size in CSS px
 * @returns {{changed:number, strong:number, perimeter2px:number, verdict:'pass'|'faint'|'none'}}
 */
export function measureStop(focused, blurred, box) {
  if (focused.width !== blurred.width || focused.height !== blurred.height) throw new Error('focused and unfocused clips differ in size')
  const a = focused.data, b = blurred.data
  let changed = 0, strong = 0
  for (let k = 0; k < a.length; k += 4) {
    const d = Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2])
    if (d <= DIFF_MIN) continue
    changed++
    if (ratio(lum(a[k], a[k + 1], a[k + 2]), lum(b[k], b[k + 1], b[k + 2])) >= FOCUS_MIN_RATIO) strong++
  }
  const perimeter2px = perimeterArea(box.w, box.h)
  return { changed, strong, perimeter2px, verdict: verdictOf({ changed, strong, perimeter2px }) }
}

/**
 * The color around a control in its unfocused state: the dominant color of the clip's pixels outside the control's
 * box (where an outline would be drawn). `inner` = the control's box inside the clip, [x, y, w, h].
 * @returns {string|null} #rrggbb
 */
export function surroundings(img, inner) {
  const [ix, iy, iw, ih] = inner
  const px = []
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (x >= ix && x < ix + iw && y >= iy && y < iy + ih) continue
    const k = (y * img.width + x) * 4
    px.push([img.data[k], img.data[k + 1], img.data[k + 2]])
  }
  const c = colorClusters(px)[0]
  return c ? toHex(c.color) : null
}

/** Counts over a list of stops: {stops, measured, pass, faint, none, noChange, skipped}. */
export function summarizeStops(stops) {
  const m = stops.filter((s) => s.verdict)
  return {
    stops: stops.length,
    measured: m.length,
    pass: m.filter((s) => s.verdict === 'pass').length,
    faint: m.filter((s) => s.verdict === 'faint').length,
    none: m.filter((s) => s.verdict === 'none').length,
    noChange: m.filter((s) => s.changed === 0).length,
    skipped: stops.length - m.length,
  }
}

/**
 * Match after-stops to before-stops (same tag and text, nth occurrence: the after render loads every token, so spacing
 * merges can move boxes a few px) and list the ones that got worse (pass > faint > none). A fix can make a stop worse when its outline replaces the site's own indicator and cannot be drawn: clipped by
 * an overflow container, or on an inline link that wraps block content.
 */
export function compareStops(before, after) {
  const rank = { pass: 2, faint: 1, none: 0 }
  const keyed = (list) => {
    const seen = new Map()
    return list.map((s) => { const k = `${s.tag}|${s.text}`; const n = seen.get(k) || 0; seen.set(k, n + 1); return [`${k}|${n}`, s] })
  }
  const by = new Map(keyed(before).filter(([, s]) => s.verdict))
  let matched = 0, better = 0, same = 0
  const worse = []
  for (const [k, a] of keyed(after)) {
    if (!a.verdict) continue
    const b = by.get(k)
    if (!b) continue
    matched++
    if (rank[a.verdict] > rank[b.verdict]) better++
    else if (rank[a.verdict] < rank[b.verdict]) worse.push({ tag: a.tag, text: a.text, page: a.page, before: b.verdict, after: a.verdict, ...(a.clippedBy ? { clippedBy: a.clippedBy } : {}), ...(a.inlineWrapsBlock ? { inlineWrapsBlock: true } : {}) })
    else same++
  }
  return { matched, better, same, worse }
}

// ---------------------------------------------------------------------------------------------------------------
// Ring color (pure)
// ---------------------------------------------------------------------------------------------------------------

/** Preference among equally good candidates: the action color, then other semantic tokens, component, primitive. */
const rankOf = (t) => (t.name === 'color.action.primary' ? 0 : /^color\.action\./.test(t.name) ? 1 : t.tier === 'semantic' ? 2 : t.tier === 'component' ? 3 : 4)

/**
 * Pick the focus ring color from the run's color tokens. Each stop's unfocused surroundings (`bg`) is what an outline
 * sits on; a candidate covers a stop when its contrast with that color is >= 3:1. The token covering the most stops
 * wins (ties: action.primary, then semantic, then the higher worst-case ratio). If none covers every stop, the ring is
 * two-tone: the darkest and the lightest token (a dark outline between two light bands), so one of them contrasts
 * with any background.
 * @param {{bg?:string|null}[]} stops
 * @param {{name:string, tier:string, value:string}[]} values resolved color tokens (tokenValues)
 */
export function pickRingColor(stops, values) {
  const bgs = stops.map((s) => s.bg && parseColor(s.bg)).filter(Boolean)
  const opaque = values.filter((t) => { const c = parseColor(t.value); return c && c.a === 1 })
  const total = bgs.length
  const scored = opaque.map((t) => {
    const c = parseColor(t.value)
    const rs = bgs.map((b) => contrastRatio(c, b))
    return { token: t.name, tier: t.tier, value: toHex(c), covered: rs.filter((r) => r >= FOCUS_MIN_RATIO).length, worst: rs.length ? round2(Math.min(...rs)) : null, rank: rankOf(t) }
  }).sort((a, b) => b.covered - a.covered || a.rank - b.rank || (b.worst ?? 0) - (a.worst ?? 0))
  const best = scored[0] || null
  const strip = ({ rank, ...x }) => x
  if (best && best.covered === total) return { mode: 'single', color: strip(best), covered: best.covered, total, candidates: scored.slice(0, 5).map(strip) }
  // Two-tone: the darkest and lightest tokens, else black/white.
  // Same luminance (one value, several names): the preferred name, as for the single color.
  const byLum = opaque.map((t) => ({ t, l: luminance(parseColor(t.value)) }))
  const darkest = [...byLum].sort((a, b) => a.l - b.l || rankOf(a.t) - rankOf(b.t))[0]
  const lightest = [...byLum].sort((a, b) => b.l - a.l || rankOf(a.t) - rankOf(b.t))[0]
  const pick = (e, fallback) => (e ? { token: e.t.name, tier: e.t.tier, value: toHex(parseColor(e.t.value)) } : { token: null, tier: null, value: fallback })
  let dark = pick(darkest, '#000000'), light = pick(lightest, '#ffffff')
  // The two tones must contrast with each other, or the pair covers nothing the single color didn't.
  if (contrastRatio(parseColor(dark.value), parseColor(light.value)) < 4.5) { dark = { token: null, tier: null, value: '#000000' }; light = { token: null, tier: null, value: '#ffffff' } }
  const covered = bgs.filter((b) => Math.max(contrastRatio(parseColor(dark.value), b), contrastRatio(parseColor(light.value), b)) >= FOCUS_MIN_RATIO).length
  return { mode: 'two-tone', color: dark, inner: light, covered, total, bestSingle: best && strip(best), candidates: scored.slice(0, 5).map(strip) }
}

// ---------------------------------------------------------------------------------------------------------------
// CSS (pure)
// ---------------------------------------------------------------------------------------------------------------

const varOrValue = (c) => (c.token ? `var(${cssVarOf(c.token)}, ${c.value})` : c.value)

/** The component-tier focus tokens as a marked :root block (replaced on a re-run). */
export function focusTokensCss(choice) {
  const lines = [
    '/* s2t focus:start (component tier: keyboard focus ring; see focus.css) */',
    ':root {',
    `  --focus-ring-color: ${varOrValue(choice.color)};`,
    ...(choice.mode === 'two-tone' ? [`  --focus-ring-inner-color: ${varOrValue(choice.inner)};`] : []),
    `  --focus-ring-width: ${RING.width};`,
    `  --focus-ring-offset: ${RING.offset};`,
    '}',
    '/* s2t focus:end */',
  ]
  return lines.join('\n') + '\n'
}

/** Put the focus block into tokens.css text, replacing an earlier one. */
export function withFocusTokens(tokensCss, block) {
  const clean = String(tokensCss).replace(/\/\* s2t focus:start[\s\S]*?\/\* s2t focus:end \*\/\n?/, '').replace(/\n*$/, '\n')
  return `${clean}\n${block}`
}

/**
 * The one focus rule. `:is()` takes the specificity of its strongest argument (0,1,1) plus :focus-visible (0,1,0), and
 * the declarations are !important: theme rules like `.btn:focus { outline: 0; box-shadow: none }` are not important,
 * so they lose, and an important `*:focus { outline: none !important }` (0,1,0) loses on specificity. It applies only
 * to :focus-visible, so no unfocused pixel changes (verify checks this). Load it after the theme's CSS.
 */
export function focusRuleCss(choice) {
  const fallback = choice.color.value
  const decl = [
    `  outline: var(--focus-ring-width, ${RING.width}) solid var(--focus-ring-color, ${fallback}) !important;`,
    `  outline-offset: var(--focus-ring-offset, ${RING.offset}) !important;`,
  ]
  if (choice.mode === 'two-tone') {
    // Light band in the offset gap and a light halo outside the outline; the dark outline paints over the middle.
    const inner = `var(--focus-ring-inner-color, ${choice.inner.value})`
    decl.push(`  box-shadow: 0 0 0 var(--focus-ring-offset, ${RING.offset}) ${inner}, 0 0 0 calc(var(--focus-ring-offset, ${RING.offset}) + var(--focus-ring-width, ${RING.width}) + 2px) ${inner} !important;`)
  }
  return [
    '/* Generated by screenshot-to-tokens (s2t focus --fix): a visible keyboard focus ring. Load after the theme CSS. */',
    // `*` also catches elements the browser makes focusable on its own (scrollable containers, e.g. Argon's
    // referral table); listing the natives keeps :is() at their specificity, which beats `*:focus{outline:none!important}`.
    `:is(${NATIVE_FOCUSABLE}, *):focus-visible {`,
    ...decl,
    '}',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------------------------
// Reachability (pure)
// ---------------------------------------------------------------------------------------------------------------

/** Share of `inner`'s area inside `outer` ([x,y,w,h]). */
export function containment(inner, outer) {
  const [x, y, w, h] = inner, [X, Y, W, H] = outer
  const ix = Math.max(0, Math.min(x + w, X + W) - Math.max(x, X)), iy = Math.max(0, Math.min(y + h, Y + H) - Math.max(y, Y))
  return w * h ? (ix * iy) / (w * h) : 0
}

/**
 * SAM controls (button, input, icon) that the page treats as clickable (capture.json `clickable`), that no Tab stop
 * reaches, split into flagged (element is not a native focusable: a div with a click handler) and exempt (a native
 * control or link, a [tabindex], or disabled: reached in another way, or inactive by design).
 * @param {{regions:any[], elements:any[], stops:{page?:number[]}[], native:Record<string,{exempt:boolean, tag?:string, why?:string}>}} o
 */
export function unreachableControls({ regions, elements, stops, native }) {
  const sam = (regions || []).filter((r) => /^sam/.test(String(r.source)) && ['button', 'input', 'icon'].includes(r.label))
  const clickable = (b) => (elements || []).some((e) => e.clickable && e.bbox && (iou(e.bbox, b) > 0.5 || (containment(b, e.bbox) > 0.8 && e.bbox[2] * e.bbox[3] < b[2] * b[3] * 6)))
  const placed = (stops || []).filter((s) => s.page)
  const reached = (b) => placed.some((s) => iou(s.page, b) > 0.3 || containment(b, s.page) > 0.6)
  const click = sam.filter((r) => clickable(r.bbox))
  const unreached = click.filter((r) => !reached(r.bbox))
  const item = (r) => ({ id: r.id, label: r.label, bbox: r.bbox, ...(native[r.id] || {}) })
  const flagged = unreached.filter((r) => !(native[r.id] && native[r.id].exempt)).map(item)
  const exempt = unreached.filter((r) => native[r.id] && native[r.id].exempt).map(item)
  return { samControls: sam.length, clickable: click.length, unreached: unreached.length, flagged, exempt }
}

// ---------------------------------------------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------------------------------------------

/**
 * Tab through an open page. Per stop: scroll it into view, shoot the padded box focused, blur, shoot again, refocus.
 * Wrap detection: a data attribute marks visited elements; reaching one again ends the walk. Off-screen and zero-size
 * stops are recorded as skipped, and a screenshot that throws skips the stop instead of failing the page.
 * @param {import('playwright').Page} page
 * @param {{cap?:number, pad?:number, viewport:{width:number,height:number}}} o
 */
export async function probeFocus(page, o) {
  const cap = o.cap || DEFAULT_CAP, pad = o.pad ?? PAD
  const { width: VW, height: VH } = o.viewport
  const stops = []
  for (let i = 0; i < cap; i++) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(60)
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body || el === document.documentElement) return null
      if (el.dataset && el.dataset.s2tFocusSeen) return { wrapped: true }
      if (el.dataset) el.dataset.s2tFocusSeen = '1'
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      const r = el.getBoundingClientRect()
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      // Not visible at all (opacity 0 up the tree, e.g. an entrance animation we switched off): nothing to measure.
      let opacity = 1
      for (let p = el; p && p.nodeType === 1; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity)
      const hidden = opacity < 0.05 || getComputedStyle(el).visibility === 'hidden'
      // The nearest ancestor that clips its overflow within 5 px of the control: an outline there is cut off.
      let clippedBy = null
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const c = getComputedStyle(p)
        if (c.overflowX === 'visible' && c.overflowY === 'visible') continue
        const q = p.getBoundingClientRect()
        if (r.left - 5 < q.left || r.top - 5 < q.top || r.right + 5 > q.right || r.bottom + 5 > q.bottom) { clippedBy = p.tagName.toLowerCase() + (p.classList.length ? `.${Array.from(p.classList).slice(0, 2).join('.')}` : ''); break }
      }
      // An inline element whose children are blocks (a link around a card): a solid outline only follows its own
      // (empty) line boxes, where the browser's default 'auto' ring follows the children.
      const inlineWrapsBlock = getComputedStyle(el).display === 'inline' && Array.from(el.children).some((c) => !/^inline/.test(getComputedStyle(c).display) && getComputedStyle(c).display !== 'none')
      return { tag: el.tagName.toLowerCase(), text, x: r.left, y: r.top, w: r.width, h: r.height, page: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)], fv: el.matches(':focus-visible'), hidden, clippedBy, inlineWrapsBlock }
    })
    if (!info) continue
    if (info.wrapped) break
    const base = { tag: info.tag, text: info.text, page: info.page, fv: info.fv, ...(info.clippedBy ? { clippedBy: info.clippedBy } : {}), ...(info.inlineWrapsBlock ? { inlineWrapsBlock: true } : {}) }
    if (info.w < 2 || info.h < 2) { stops.push({ ...base, skipped: 'zero size' }); continue }
    if (info.hidden) { stops.push({ ...base, skipped: 'not visible (opacity 0 or visibility hidden)' }); continue }
    await page.waitForTimeout(80)
    const x = Math.max(0, Math.floor(info.x - pad)), y = Math.max(0, Math.floor(info.y - pad))
    const clip = { x, y, width: Math.min(Math.ceil(info.w + 2 * pad), VW - x), height: Math.min(Math.ceil(info.h + 2 * pad), VH - y) }
    if (x >= VW || y >= VH || clip.width < 4 || clip.height < 4 || info.y + info.h < 0 || info.x + info.w < 0) { stops.push({ ...base, skipped: 'offscreen' }); continue }
    let focused, blurred
    try {
      focused = PNG.sync.read(await page.screenshot({ clip }))
      await page.evaluate(() => { window.__s2tLast = document.activeElement; document.activeElement.blur() })
      await page.waitForTimeout(80)
      blurred = PNG.sync.read(await page.screenshot({ clip }))
    } catch (e) {
      stops.push({ ...base, skipped: `screenshot failed: ${String(e.message || e).slice(0, 80)}` })
      await page.evaluate(() => { const el = window.__s2tLast; if (el && el.focus) el.focus({ preventScroll: true }) }).catch(() => {})
      continue
    }
    await page.evaluate(() => { const el = window.__s2tLast; if (el && el.focus) el.focus({ preventScroll: true }) })
    const m = measureStop(focused, blurred, { w: info.w, h: info.h })
    const inner = [Math.round(info.x - x), Math.round(info.y - y), Math.round(info.w), Math.round(info.h)]
    stops.push({ ...base, ...m, bg: surroundings(blurred, inner) })
  }
  return stops
}

/**
 * For each region, the element under its center on the live page, and whether it is exempt from the reachability
 * flag (REACH_EXEMPT on it or an ancestor). Scrolls to each region; leaves the page scrolled to the top.
 */
export async function nativeAt(page, regions) {
  const out = await page.evaluate(({ list, exempt }) => {
    const res = {}
    for (const r of list) {
      const cx = r.bbox[0] + r.bbox[2] / 2, cy = r.bbox[1] + r.bbox[3] / 2
      window.scrollTo({ left: 0, top: Math.max(0, cy - window.innerHeight / 2), behavior: 'instant' })
      const el = document.elementFromPoint(cx - window.scrollX, cy - window.scrollY)
      if (!el) { res[r.id] = { exempt: false, tag: null, why: 'no element at the center' }; continue }
      const desc = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + (e.classList && e.classList.length ? `.${Array.from(e.classList).slice(0, 2).join('.')}` : '')
      let n = el.closest(exempt), under = false
      if (!n) {
        // elementFromPoint skips pointer-events:none (Bootstrap's .disabled buttons): the smallest exempt element whose
        // box contains the point.
        const x = cx - window.scrollX, y = cy - window.scrollY
        let best = null
        for (const c of document.querySelectorAll(exempt)) {
          const q = c.getBoundingClientRect()
          if (q.width && q.height && x >= q.left && x < q.right && y >= q.top && y < q.bottom && (!best || q.width * q.height < best.a)) best = { c, a: q.width * q.height }
        }
        if (best) { n = best.c; under = true }
      }
      if (!n) { res[r.id] = { exempt: false, tag: desc(el) }; continue }
      const why = n.matches('[disabled], [aria-disabled="true"], .disabled') ? 'disabled' : n.matches('a:not([href])') ? 'a without href (not focusable; needs a check)' : n.matches('[tabindex]') && !n.matches('a, button, input, select, textarea, summary') ? 'has tabindex' : 'native control or link'
      res[r.id] = { exempt: true, tag: desc(n), why: under ? `${why} (pointer-events: none)` : why }
    }
    window.scrollTo(0, 0)
    return res
  }, { list: regions.map((r) => ({ id: r.id, bbox: r.bbox })), exempt: REACH_EXEMPT })
  return out
}

/**
 * Open a URL the way verify does (seeded random, animations off, images loaded, settled) with optional extra CSS,
 * probe its focus stops, and (given regions) look up the element under each region.
 * @param {string} url
 * @param {{viewport:{width:number,height:number}, extraCss?:string, cap?:number, regions?:any[]}} o
 */
export async function measureUrl(url, o) {
  const { chromium } = await import('playwright')
  const { LAUNCH, openSettled } = await import('./capture.js')
  const browser = await chromium.launch(LAUNCH)
  try {
    const page = await openSettled(browser, url, o.viewport, o.extraCss || '')
    const native = o.regions && o.regions.length ? await nativeAt(page, o.regions) : {}
    await page.evaluate(() => window.scrollTo(0, 0))
    const stops = await probeFocus(page, { cap: o.cap, viewport: o.viewport })
    return { stops, native }
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------------------------------------------

/**
 * `s2t focus --run <dir> [--fix]`. Measures the original page; with fix, writes focus.css + the tokens.css block,
 * re-measures the tokenized page with both loaded, and re-runs the fallback/colors pixel checks with focus.css loaded.
 * @param {string} runDir
 * @param {{fix?:boolean, cap?:number, log?:(m:string)=>void}} [o]
 */
export async function runFocus(runDir, o = {}) {
  runDir = resolve(runDir)
  const log = o.log || (() => {})
  const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
  const run = rd('run')
  const capture = rd('capture')
  const regions = existsSync(join(runDir, 'regions.json')) ? rd('regions') : []
  const tokens = existsSync(join(runDir, 'tokens.json')) ? rd('tokens') : null
  const viewport = capture.viewport || { width: 1440, height: 900 }
  const cap = o.cap || Number(process.env.S2T_FOCUS_CAP || DEFAULT_CAP)
  if (!run.serve && !run.url) throw new Error('focus needs a run with a served folder or a url (run.json)')
  const servers = []
  const serve = async (dir) => { const s = await serveDir(dir); servers.push(s); return s.url }
  try {
    const origUrl = run.serve ? await serve(run.serve) : run.url
    const samRegions = regions.filter((r) => /^sam/.test(String(r.source)) && ['button', 'input', 'icon'].includes(r.label))
    const t0 = Date.now()
    const before = await measureUrl(origUrl, { viewport, cap, regions: samRegions })
    const beforeSum = summarizeStops(before.stops)
    log(`focus     before: ${beforeSum.stops} Tab stops, ${beforeSum.measured} measured: ${beforeSum.pass} pass / ${beforeSum.faint} faint / ${beforeSum.none} none (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    const reach = unreachableControls({ regions, elements: capture.elements, stops: before.stops, native: before.native })
    log(`focus     reachability: ${reach.samControls} SAM controls, ${reach.clickable} clickable, ${reach.unreached} with no Tab stop; flagged (not a native focusable) ${reach.flagged.length}, exempt ${reach.exempt.length}`)
    const values = tokenValues(tokens)
    const choice = pickRingColor(before.stops.filter((s) => s.verdict), values)
    const out = {
      check: 'Visible focus (WCAG 2.4.13 style: changed area >= a 2 CSS px perimeter at >= 3:1)',
      cap, url: run.serve ? `serve:${run.serve}` : run.url,
      before: beforeSum,
      reachability: reach,
      ring: choice,
      fix: null,
      stops: before.stops,
    }
    if (o.fix) {
      const block = focusTokensCss(choice)
      const rule = focusRuleCss(choice)
      writeFileSync(join(runDir, 'focus.css'), rule)
      const tokensPath = join(runDir, 'tokens.css')
      const tokensCss = withFocusTokens(existsSync(tokensPath) ? readFileSync(tokensPath, 'utf-8') : '', block)
      writeFileSync(tokensPath, tokensCss)
      // After: the tokenized site (rewritten CSS) with tokens.css + focus.css loaded last, as the PR would ship them.
      const { siteDirOf } = await import('./dark.js')
      const rewrite = existsSync(join(runDir, 'rewrite.json')) ? rd('rewrite') : null
      const siteDir = rewrite ? siteDirOf(runDir, run, rewrite) : run.serve
      const siteUrl = siteDir && existsSync(siteDir) ? await serve(siteDir) : origUrl
      const t1 = Date.now()
      const after = await measureUrl(siteUrl, { viewport, cap, extraCss: `${tokensCss}\n${rule}` })
      const afterSum = summarizeStops(after.stops)
      log(`focus     after (${choice.mode} ring ${choice.color.token || choice.color.value}${choice.inner ? ` + ${choice.inner.token || choice.inner.value}` : ''}): ${afterSum.measured} measured: ${afterSum.pass} pass / ${afterSum.faint} faint / ${afterSum.none} none (${((Date.now() - t1) / 1000).toFixed(1)} s)`)
      const unchanged = await verifyUnfocused(runDir, { capture, tokens, siteUrl, rule, block, viewport })
      log(`focus     unfocused pixels with focus.css loaded: fallback ${unchangedText(unchanged.fallback)}; colors ${unchangedText(unchanged.colors)}; elements matching :focus-visible at load: ${unchanged.atLoad.focusVisible}`)
      const cmp = compareStops(before.stops, after.stops)
      if (cmp.worse.length) log(`focus     ${cmp.worse.length} stop${cmp.worse.length === 1 ? '' : 's'} worse with the fix (${cmp.worse.filter((w) => w.clippedBy).length} clipped by an overflow container, ${cmp.worse.filter((w) => w.inlineWrapsBlock).length} inline links around blocks)`)
      out.fix = { applied: true, files: ['focus.css', 'tokens.css (marked block)'], tokensBlock: block, rule, after: afterSum, compare: cmp, afterSite: siteDir, unchanged, stops: after.stops }
    }
    writeFileSync(join(runDir, 'focus.json'), JSON.stringify(out, null, 2))
    return out
  } finally {
    for (const s of servers) await s.close()
  }
}

/**
 * Measure a static folder with no run (the breadth baseline): Tab stops and counts only. `s2t focus --serve <dir>`.
 * @param {string} dir
 * @param {{cap?:number, viewport?:{width:number,height:number}}} [o]
 */
export async function measureFolder(dir, o = {}) {
  const s = await serveDir(dir)
  try {
    const { stops } = await measureUrl(s.url, { viewport: o.viewport || { width: 1440, height: 900 }, cap: o.cap })
    return { check: 'Visible focus (WCAG 2.4.13 style)', url: `serve:${dir}`, cap: o.cap || DEFAULT_CAP, before: summarizeStops(stops), stops }
  } finally {
    await s.close()
  }
}

/**
 * The fallback-only and colors checks again, with focus.css (and the focus token block) loaded: the rule must change
 * no unfocused pixel. Same comparison as the verify stage (vs the captured screenshot, noise.png excluded).
 */
async function verifyUnfocused(runDir, { capture, tokens, siteUrl, rule, block, viewport }) {
  const { screenshotUrl } = await import('./capture.js')
  const { compareScreenshots } = await import('./verify.js')
  const { toCss } = await import('./emit.js')
  const { usableTokens } = await import('./review.js')
  const noise = existsSync(join(runDir, 'noise.png')) ? join(runDir, 'noise.png') : undefined
  const shot = join(runDir, capture.screenshot)
  const res = {}
  // A shot that differs is taken once more and both counts are kept: text antialiasing on a busy machine has been seen
  // to differ between loads of the same page (Argon, once: 498 px of glyph edges; 0 px on five more loads). If it still
  // differs, the same render WITHOUT focus.css is shot too, and the two are compared directly: `ruleOnly` is what the
  // rule itself changed (a page that differs from its capture on every load, e.g. Mavrikant, differs without it too).
  const shoot = async (name, css, cssWithout, threshold) => {
    const p = join(runDir, `after-${name}-focus.png`), d = join(runDir, `diff-${name}-focus.png`)
    await screenshotUrl(siteUrl, p, viewport, css)
    let v = compareScreenshots(shot, p, d, threshold, noise)
    if (v.diffPixels > 0) {
      const first = v.diffPixels
      await screenshotUrl(siteUrl, p, viewport, css)
      v = { ...compareScreenshots(shot, p, d, threshold, noise), firstShotDiffPixels: first }
    }
    if (v.diffPixels > 0) {
      const p0 = join(runDir, `after-${name}-nofocus.png`)
      await screenshotUrl(siteUrl, p0, viewport, cssWithout)
      const without = compareScreenshots(shot, p0, join(runDir, `diff-${name}-nofocus.png`), threshold, noise)
      const ruleOnly = compareScreenshots(p0, p, join(runDir, `diff-${name}-ruleonly.png`), 0, noise)
      v = { ...v, withoutRuleDiffPixels: without.diffPixels, ruleOnlyDiffPixels: ruleOnly.diffPixels }
    }
    return rel(runDir, v)
  }
  // Logical check behind the pixel one: with the rule loaded and nothing touched, no element matches :focus-visible, so
  // the rule cannot paint anything. (On a page that differs between loads, this is the stronger evidence.)
  res.atLoad = await focusAtLoad(siteUrl, viewport, rule)
  res.fallback = await shoot('fallback', rule, '', 0)
  if (tokens && existsSync(join(runDir, 'clusters.json'))) {
    const clusters = JSON.parse(readFileSync(join(runDir, 'clusters.json'), 'utf-8'))
    const kindOf = new Map(clusters.map((c) => [c.id, c.kind]))
    const usable = usableTokens(tokens)
    const colorSet = { ...usable, tokens: usable.tokens.filter((t) => kindOf.get(t.clusters[0]) === 'color') }
    let threshold = 0.001
    try { threshold = JSON.parse(readFileSync(join(runDir, 'verify.json'), 'utf-8')).colors.threshold } catch (e) { /* default */ }
    res.colors = await shoot('colors', `${toCss(colorSet)}\n${block}\n${rule}`, toCss(colorSet), threshold)
  }
  return res
}

/** Elements matching :focus-visible (and the focused element) on a freshly loaded page with `css` added. */
async function focusAtLoad(url, viewport, css) {
  const { chromium } = await import('playwright')
  const { LAUNCH, openSettled } = await import('./capture.js')
  const browser = await chromium.launch(LAUNCH)
  try {
    const page = await openSettled(browser, url, viewport, css)
    return await page.evaluate(() => {
      const a = document.activeElement
      return { focusVisible: document.querySelectorAll(':focus-visible').length, active: a && a !== document.body ? a.tagName.toLowerCase() : null }
    })
  } finally {
    await browser.close()
  }
}

const rel = (runDir, v) => ({ ...v, before: v.before.replace(runDir + '/', ''), after: v.after.replace(runDir + '/', ''), diff: v.diff.replace(runDir + '/', '') })

// ---------------------------------------------------------------------------------------------------------------
// Text out
// ---------------------------------------------------------------------------------------------------------------

/** "0 px (0.000%)", plus the re-shot and the with/without-rule comparison when the page differed. */
export function unchangedText(v) {
  if (!v) return 'not measured'
  let t = `${v.diffPixels} px (${(Number(v.ratio) * 100).toFixed(3)}%)`
  if (v.firstShotDiffPixels) t += `, first shot ${v.firstShotDiffPixels} px`
  if (v.withoutRuleDiffPixels != null) t += `; ${v.withoutRuleDiffPixels} px without focus.css, ${v.ruleOnlyDiffPixels} px between the renders with and without it`
  return t
}

const counts = (s) => `${s.pass} pass / ${s.faint} faint / ${s.none} none of ${s.measured} measured`

/** One sentence on the stops a fix made worse, with the two known causes counted. */
export function worseText(worse) {
  const clipped = worse.filter((x) => x.clippedBy).length, inline = worse.filter((x) => x.inlineWrapsBlock).length
  const why = [clipped && `${clipped} inside a container that clips overflow, so the ring is cut off`, inline && `${inline} inline link${inline === 1 ? '' : 's'} wrapping block content, where a solid outline has no box to follow (the browser's default ring does)`].filter(Boolean)
  return `${worse.length} stop${worse.length === 1 ? ' is' : 's are'} worse with the fix${why.length ? `: ${why.join('; ')}` : ''}.`
}

/** CLI summary lines. */
export function formatFocus(out) {
  const lines = [`focus: before ${counts(out.before)} (${out.before.stops} Tab stops${out.before.skipped ? `, ${out.before.skipped} skipped` : ''})`]
  if (out.fix) lines.push(`focus: after  ${counts(out.fix.after)}; ring ${ringText(out.ring)}`)
  if (out.fix && out.fix.compare && out.fix.compare.worse.length) lines.push(`focus: ${worseText(out.fix.compare.worse)}`)
  const r = out.reachability
  lines.push(`focus: reachability: ${r.clickable} clickable SAM controls, ${r.flagged.length} with no Tab stop and no native focusable element${r.exempt.length ? ` (${r.exempt.length} more exempt: ${summarizeWhy(r.exempt)})` : ''}`)
  for (const f of r.flagged.slice(0, 10)) lines.push(`  unreachable ${f.id} ${f.label} [${f.bbox.join(',')}] ${f.tag || ''}`)
  return lines.join('\n')
}

const summarizeWhy = (list) => Object.entries(list.reduce((m, x) => ({ ...m, [x.why || 'exempt']: (m[x.why || 'exempt'] || 0) + 1 }), {})).map(([k, v]) => `${v} ${k}`).join(', ')

/** "single, color.action.primary #5e72e4 (covers 25 of 25)" / two-tone text. */
export function ringText(ring) {
  const t = (c) => `${c.token ? `${c.token} ` : ''}${c.value}`
  if (!ring) return 'none'
  if (ring.mode === 'single') return `${t(ring.color)}, at least 3:1 against the surroundings of all ${ring.total} measured controls`
  return `two-tone: ${t(ring.color)} outline between ${t(ring.inner)} bands (no single token reaches 3:1 against every control's surroundings${ring.bestSingle ? `; best single, ${ring.bestSingle.token}, covers ${ring.bestSingle.covered} of ${ring.total}` : ''}); one of the two tones reaches 3:1 on ${ring.covered} of ${ring.total}`
}

/** The PR-body section: before (and after) counts, reachability, the fix if applied. Lines (markdown). */
export function focusPrSection(f, focusCssRel = 'focus.css') {
  if (!f) return []
  const lines = [
    '## Visible keyboard focus (WCAG 2.4.13 style)',
    `Tabbed through the page (${f.before.stops} stops, cap ${f.cap}) and compared each control focused vs unfocused on the rendered pixels. **Pass**: the change covers at least a 2 CSS px perimeter of the control at 3:1 or more; **faint**: visible but under that; **none**: no visible change.`,
    '',
    '| | Pass | Faint | None | Measured |',
    '|---|---|---|---|---|',
    `| Before | ${f.before.pass} | ${f.before.faint} | ${f.before.none} | ${f.before.measured} |`,
    ...(f.fix ? [`| After this PR | ${f.fix.after.pass} | ${f.fix.after.faint} | ${f.fix.after.none} | ${f.fix.after.measured} |`] : []),
    '',
  ]
  if (f.fix) {
    lines.push(
      `The fix is tokens: \`--focus-ring-color\`, \`--focus-ring-width\` (${RING.width}), \`--focus-ring-offset\` (${RING.offset})${f.ring.mode === 'two-tone' ? ', `--focus-ring-inner-color`' : ''} in the tokens file, and one \`:focus-visible\` rule in \`${focusCssRel}\` (load it after the theme CSS). Ring: ${ringText(f.ring)}.`,
      '',
      `The rule only applies while a control has keyboard focus. With it loaded, unfocused pixels changed: fallback-only render ${unchangedText(f.fix.unchanged?.fallback)}; colors render ${unchangedText(f.fix.unchanged?.colors)}${f.fix.unchanged?.atLoad ? `; elements matching \`:focus-visible\` after load: ${f.fix.unchanged.atLoad.focusVisible}` : ''}.`,
      '',
    )
    const w = f.fix.compare && f.fix.compare.worse
    if (w && w.length) lines.push(`${worseText(w)} Review these before merging.`, '')
  }
  const r = f.reachability
  if (r && r.clickable) lines.push(`Reachability: SAM found ${r.clickable} clickable controls; ${r.flagged.length} ${r.flagged.length === 1 ? 'has' : 'have'} no Tab stop and no native focusable element (a \`div\` with a click handler, for example)${r.flagged.length ? `: ${r.flagged.slice(0, 8).map((x) => `${x.label} at ${x.bbox.slice(0, 2).join(',')}`).join('; ')}` : ''}.`, '')
  lines.push('Default state of the captured route only; focus styles set by scripts and controls inside closed menus are not measured.', '')
  return lines
}
