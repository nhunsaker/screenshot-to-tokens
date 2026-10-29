// Point and say: the server API on the local playground (contract: docs/pas-api.md). Routes under /__pas/:
//   GET  api/health, tokens.css, wav.js, contrast.js
//   POST api/point {x,y}, api/transcribe (WAV), api/intent {transcript, point}, api/focus-check {changes}
// A warm headless Chromium holds a copy of the served app (tokens.css loaded) for the sentinel probe and the whole-
// page re-audit, and Tabs through it once at startup (the focus baseline). Deterministic first: contrast and focus
// requests never reach a model; Muse Spark Open maps the rest, restricted to the tokens that control what was clicked.
// Local only (Host 127.0.0.1/localhost, same Origin); keys stay in this process; `store: false` on Meta calls.
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { transcribe as transcribeWav, MAX_WAV_BYTES } from './transcribe.js'
import { loadPointContext, pointAt } from './point.js'
import { routeIntent } from './route.js'
import { contrastFix } from './contrast-fix.js'
import { museIntent, intentProviders } from './intent.js'
import { focusProposal, choiceFromChanges } from './focus-intent.js'
import { probeAtPoint, pairsUsingToken, auditWith, orderChain, pairStats, comparePairs, PROBE_PROPS, SENTINEL_COLOR, SENTINEL_RADIUS } from './sentinel.js'
import { localOnly } from './server.js'
import { focusRuleCss, summarizeStops, compareStops, probeFocus } from '../focus.js'
import { tokenValues } from '../nontext.js'
import { parseColor, toHex, isLargeText, cssVarName, UNSAFE, round2 } from '../../preview-client/contrast.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILES = { 'wav.js': join(HERE, 'wav.js'), 'contrast.js': join(HERE, '../../preview-client/contrast.js') }
const NO_MOTION = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}'
const FOCUS_TOKENS = /^focus\.ring\.(color|inner-color|width|offset)$/

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const bad = (m) => new ApiError(400, 'bad_request', m)

/** One job at a time on a shared resource (the probe page, the focus pages). */
export function serial() {
  let tail = Promise.resolve()
  return (fn) => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run }
}

const hex = (v) => { const c = parseColor(v); return c ? (c.a < 1 ? v : toHex(c)) : v ?? null }

// ---- core (pure of HTTP; the browser parts come in as `probe` and `focus`) -----------------------------------------

/**
 * Resolve a click: SAM outline + twins (point.js), the live element and its controlling tokens (sentinel), the pairs
 * using its text-colour token, and each twin's tokens. Cached by rounded position.
 * @param {PasCore} core
 */
export async function resolvePoint(core, x, y) {
  x = Number(x); y = Number(y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw bad('x, y (page px) required')
  const { width, height } = core.page
  if (x < 0 || y < 0 || x >= width || y >= height) throw bad(`click outside the captured page (${width}x${height})`)
  const key = `${Math.round(x)},${Math.round(y)}`
  if (core.cache.has(key)) return { ...core.cache.get(key), cachedClick: true }
  const t0 = Date.now()
  const timings = {}
  const time = async (k, fn) => { const s = Date.now(); try { return await fn() } finally { timings[k] = Date.now() - s } }
  const [pt, live] = await Promise.all([
    time('sam', () => core.pointFn(x, y)),
    time('sentinel', () => core.probe.at(x, y)),
  ])
  if (!live) throw bad('nothing under that point in the app')
  const controls = {}
  for (const p of PROBE_PROPS) {
    const o = orderChain(live.controls[p.prop] || [], core.tokens)
    controls[p.prop] = o.token ? { value: hex(propValue(live.element, p.prop)), token: o.token, chain: o.chain } : null
  }
  const tokens = Array.from(new Set(Object.values(controls).filter(Boolean).flatMap((c) => c.chain)))
  let pairs = null
  if (controls.color) {
    const ids = new Set(await time('pairs', () => core.probe.pairsUsing(cssVarName(controls.color.token))))
    const items = core.baseline.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, text: r.text, bg: r.bg, ratio: r.ratio, required: r.required, large: !!r.large, status: r.status }))
    pairs = { token: controls.color.token, ...pairStats(items), items }
  }
  const twins = []
  await time('twins', async () => {
    for (const tw of (pt && pt.twins) || []) {
      const cx = tw.bbox[0] + tw.bbox[2] / 2, cy = tw.bbox[1] + tw.bbox[3] / 2
      const r = await core.probe.at(cx, cy)
      const chains = r ? PROBE_PROPS.map((p) => orderChain(r.controls[p.prop] || [], core.tokens)).filter((o) => o.token) : []
      twins.push({ ...tw, element: r ? { tag: r.element.tag, text: r.element.text, bbox: r.element.bbox } : null, tokens: Array.from(new Set(chains.flatMap((o) => o.chain))), chains: chains.map((o) => o.chain) })
    }
  })
  const el = live.element
  const cap = pt && pt.element
  const region = pt && pt.region
  const isControl = region && ['button', 'icon', 'input', 'badge'].includes(region.label)
  const samBox = pt && pt.outline
  const outline = isControl && samBox
    ? { bbox: samBox.bbox, source: 'sam', sam: samBox }
    : isControl && el.control ? { bbox: el.control.bbox, source: 'dom-control', sam: samBox || null } : { bbox: el.bbox, source: 'dom', sam: samBox || null }
  const warnings = []
  if (pt && pt.sam && pt.sam.note) warnings.push(pt.sam.note)
  if (!controls.color && !controls['background-color'] && !controls['border-color'] && !controls['border-radius']) warnings.push('no token controls this element (literal values)')
  const result = {
    point: [Math.round(x), Math.round(y)],
    element: {
      tag: el.tag, text: el.text, path: cap ? cap.path : null, classes: el.classes, bbox: el.bbox,
      color: hex(el.color), background: el.background, control: el.control || null, large: isLargeText(el.fontSize, el.fontWeight),
    },
    outline, sam: pt ? pt.sam : { ms: 0, source: 'none' }, region: region || null,
    controls, tokens, pairs, twins, warnings, timings, ms: Date.now() - t0,
  }
  core.cache.set(key, result)
  return result
}

function propValue(el, prop) {
  if (prop === 'color') return el.color
  if (prop === 'background-color') return el.background
  if (prop === 'border-color') return el.border
  return el.radius
}

/** Contract change item for a contrast fix. Pure. */
export function contrastChange(fix, users) {
  const o = fix.oklch
  return {
    token: fix.token, cssVar: cssVarName(fix.token), value: fix.value, alias: null, css: fix.value, from: fix.from,
    why: `${fix.direction === 'darker' ? 'Darker' : 'Lighter'} in the same hue (OKLCH L ${o.from.L} → ${o.to.L}, hue ${o.from.h}° → ${o.to.h}°) so all ${users.length} text pairs using it reach ${Math.min(...users.map((u) => u.required))}:1`,
  }
}

/** The tokens the model may change: controlling tokens of the clicked element and its twins, nearest marked. Pure. */
export function changeableFrom(point, tokens) {
  const byName = new Map(tokens.map((t) => [t.name, t]))
  const out = new Map()
  const add = (name, prop, nearest) => {
    const t = byName.get(name)
    if (!t) return
    const cur = out.get(name)
    if (cur) { if (!cur.props.includes(prop)) cur.props.push(prop); cur.nearest = cur.nearest || nearest; return }
    out.set(name, { name, tier: t.tier, kind: t.kind, props: [prop], nearest, alias: t.alias || null, value: t.value || null })
  }
  for (const [prop, c] of Object.entries(point.controls || {})) if (c) c.chain.forEach((n, i) => add(n, prop, i === 0))
  for (const tw of point.twins || []) for (const ch of tw.chains || []) ch.forEach((n, i) => add(n, 'twin', i === 0))
  return Array.from(out.values())
}

const none = (transcript, matched, summary, extra = {}) => ({ route: 'none', matched, transcript, changes: [], rule: null, summary, predicted: null, model: null, rejected: [], ...extra })

/**
 * /api/intent. Deterministic first (contrast, focus), Muse for the rest; every proposal re-audited in the probe page.
 * @param {PasCore} core
 */
export async function decideIntent(core, body) {
  const t0 = Date.now()
  const transcript = String((body && body.transcript) || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  if (!transcript) throw bad('transcript required')
  const timings = {}
  const time = async (k, fn) => { const s = Date.now(); try { return await fn() } finally { timings[k] = Date.now() - s } }
  const { route, matched } = routeIntent(transcript)
  const pt = body && body.point
  const done = (r) => ({ ...r, timings, ms: Date.now() - t0 })

  if (route === 'focus') {
    const stops = await time('baseline', () => core.focus.baseline())
    const p = await time('decide', async () => focusProposal(transcript, stops, core.values))
    return done({ route, matched, transcript, changes: p.changes, rule: p.rule, summary: p.summary, predicted: p.predicted, ring: p.ring, model: null, rejected: [] })
  }
  if (!pt) return done(none(transcript, matched, `Click the element first: a ${route === 'contrast' ? 'contrast' : 'token'} change needs to know what to change.`))
  const point = await time('point', () => resolvePoint(core, pt.x, pt.y))

  if (route === 'contrast') {
    const ctl = point.controls.color
    if (!ctl) return done(none(transcript, matched, `No token controls the colour of "${point.element.text || point.element.tag}" (it is a literal in the CSS), so there is nothing to change safely.`, { route: 'none' }))
    const users = (point.pairs && point.pairs.items) || []
    if (!users.length) return done(none(transcript, matched, `${ctl.token} colours "${point.element.text || point.element.tag}" but no checked text pair uses it, so the contrast check has nothing to measure.`))
    const fix = await time('decide', async () => contrastFix(ctl.token, users.map((u) => ({ id: u.id, text: u.text, bg: u.bg, required: u.required })), core.tokens))
    if (fix.error) return done(none(transcript, matched, `${ctl.token}: ${fix.error}.`, { route: 'contrast', blocked: true }))
    if (fix.direction === 'none') return done({ route, matched, transcript, changes: [], rule: null, summary: `All ${users.length} text pairs using ${ctl.token} already reach their minimum (worst ${fix.before.worst}:1).`, predicted: null, model: null, rejected: [] })
    const changes = [contrastChange(fix, users)]
    const predicted = await time('check', () => check(core, changes))
    const summary = `${users.length} element${users.length === 1 ? '' : 's'}, ${round2(fix.before.worst)}:1 → ${round2(fix.after.worst)}:1, text contrast (${ctl.token}, hue kept).` + (predicted.blocked ? ` Blocked: ${predicted.reason}.` : '')
    return done({ route, matched, transcript, changes, rule: null, summary, predicted, model: null, rejected: [] })
  }

  // muse
  const changeable = changeableFrom(point, core.tokens)
  if (!changeable.length) return done(none(transcript, matched, `No token controls "${point.element.text || point.element.tag}", so a token change cannot reach it.`))
  const clicked = { text: point.element.text, tag: point.element.tag, classes: point.element.classes, color: point.element.color, background: point.element.background, twins: point.twins.length, region: point.region && point.region.label }
  const chains = Object.values(point.controls).filter(Boolean).map((c) => c.chain).concat(point.twins.flatMap((t) => t.chains || []))
  let m
  try {
    m = await time('model', () => core.museFn({ transcript, clicked, changeable, tokens: core.tokens, chains }))
  } catch (e) { throw new ApiError(502, 'upstream', `Muse: ${String(e.message || e).slice(0, 240)}`) }
  const model = { provider: m.provider, model: m.model, ms: m.ms, cached: !!m.cached }
  if (!m.changes.length) return done(none(transcript, matched, `Couldn't map that to a token${m.affects ? ` (${m.affects})` : ''}.`, { model, rejected: m.rejected }))
  const live = m.changes.filter((c) => !c.noop)
  const predicted = live.length ? await time('check', () => check(core, live)) : { affected: 0, before: null, after: null, page: null, regressions: [], blocked: false, reason: null }
  const names = m.changes.map((c) => `${c.token} → ${c.alias || c.value}${c.noop ? ' (already)' : ''}`).join(', ')
  const summary = (live.length ? `${names}.` : `Already in place: ${names}; nothing changes.`) + (m.affects ? ` ${m.affects}` : '') + (predicted.blocked ? ` Blocked: ${predicted.reason}.` : '')
  return done({ route: 'muse', matched, transcript, changes: m.changes, rule: null, summary, predicted, model, rejected: m.rejected })
}

/** Apply changes in the probe page and compare every pair with the baseline. */
async function check(core, changes) {
  const after = await core.probe.audit(changes.map((c) => ({ cssVar: c.cssVar, css: c.css })))
  const { items, ...rest } = comparePairs(core.baseline, after)
  return rest
}

const PX = /^\d{1,2}(\.\d+)?px$/

/** Re-sanitize focus-check change items: known or focus.ring.* tokens; colour, px or var(--known[, #hex]). Pure. */
export function sanitizeFocusChanges(changes, known) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 20) throw bad('changes: 1 to 20 items')
  const vars = new Set(Array.from(known).map(cssVarName))
  const out = []
  for (const c of changes) {
    const token = String((c && c.token) || '')
    const css = String((c && c.css) || '').trim()
    if (!(known.has(token) || FOCUS_TOKENS.test(token))) throw bad(`unknown token: ${token.slice(0, 60)}`)
    if (UNSAFE.test(css) || css.length > 80) throw bad(`unsafe value for ${token}`)
    const ref = css.match(/^var\(--([a-z0-9-]+)(?:,\s*(#[0-9a-f]{3,8}))?\)$/i)
    const ok = (parseColor(css) && !/^var/i.test(css)) || PX.test(css) || (ref && vars.has(ref[1]))
    if (!ok) throw bad(`not a colour, length or token reference: ${token}`)
    out.push({ token, cssVar: cssVarName(token), css })
  }
  return out
}

/** /api/focus-check: Tab through the served app with the proposal applied; before = the startup baseline. */
export async function focusCheck(core, body) {
  const t0 = Date.now()
  const changes = sanitizeFocusChanges(body && body.changes, core.known)
  const choice = choiceFromChanges(changes)
  const css = `:root{${changes.map((c) => `--${c.cssVar}: ${c.css};`).join(' ')}}\n${choice ? focusRuleCss(choice) : ''}`
  const before = await core.focus.baseline()
  const r = await core.focus.check(css)
  return {
    before: summarizeStops(before), after: summarizeStops(r.stops), compare: compareStops(before, r.stops),
    ring: choice ? { mode: choice.mode, color: changes.find((c) => c.cssVar === 'focus-ring-color').css, inner: choice.inner ? changes.find((c) => c.cssVar === 'focus-ring-inner-color').css : null } : null,
    timings: r.timings, ms: Date.now() - t0,
  }
}

// ---- browser parts -------------------------------------------------------------------------------------------------

/** The probe page: the served app with tokens.css (injected by the server), motion off, contrast.js loaded. */
async function openProbe(browser, appUrl, viewport, tokens, pairs) {
  const { newPage, loadImages } = await import('../capture.js')
  const page = await newPage(browser, viewport)
  await page.goto(appUrl, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: NO_MOTION })
  await loadImages(page)
  await page.evaluate(async () => { window.__c = await import('/__pas/contrast.js') })
  const q = serial()
  const probeTokens = tokens.filter((t) => t.kind === 'color' || t.kind === 'radius').map((t) => ({ name: t.name, cssVar: t.cssVar, kind: t.kind }))
  return {
    page,
    at: (x, y) => q(() => page.evaluate(probeAtPoint, { x, y, tokens: probeTokens, props: PROBE_PROPS, color: SENTINEL_COLOR, radius: SENTINEL_RADIUS })),
    pairsUsing: (cssVar) => q(() => page.evaluate(pairsUsingToken, { cssVar, pairs, color: SENTINEL_COLOR })),
    audit: (changes) => q(() => page.evaluate(auditWith, { changes, pairs })),
  }
}

/** Focus runner on the warm browser: a fresh settled page per measurement (the same opening as focus.js). */
function focusRunner(browser, appUrl, viewport, log) {
  const q = serial()
  const measure = (css) => q(async () => {
    const { openSettled } = await import('../capture.js')
    const t0 = Date.now()
    const page = await openSettled(browser, appUrl, viewport, css)
    const t1 = Date.now()
    try {
      await page.evaluate(() => window.scrollTo(0, 0))
      const stops = await probeFocus(page, { viewport })
      return { stops, timings: { load: t1 - t0, tab: Date.now() - t1 } }
    } finally { await page.close().catch(() => {}) }
  })
  let base = null
  return {
    start() { if (!base) { const t0 = Date.now(); base = measure('').then((r) => { log(`focus baseline: ${summarizeStops(r.stops).measured} stops measured in ${Date.now() - t0} ms`); return { ...r, ms: Date.now() - t0 } }); base.catch((e) => log(`focus baseline failed: ${e.message}`)) } return base },
    baseline: async function () { return (await this.start()).stops },
    check: (css) => measure(css),
    state: () => base,
  }
}

/**
 * @typedef {object} PasCore
 * @property {{width:number, height:number}} page captured page size (px)
 * @property {object[]} tokens playground tokens (color + radius): {name, tier, kind, cssVar, value, alias}
 * @property {Set<string>} known token names
 * @property {object[]} values resolved colour tokens (tokenValues)
 * @property {object[]} baseline audit of every pair in the probe page as served
 * @property {{at:Function, pairsUsing:Function, audit:Function}} probe
 * @property {{baseline:Function, check:Function}} focus
 * @property {(x:number, y:number)=>Promise<any>} pointFn
 * @property {(req:object)=>Promise<any>} museFn
 * @property {Map<string, any>} cache
 */

/**
 * Create the API for a run. `handle(req, res, url)` returns true when it answered; `warm(baseUrl)` launches the probe
 * browser once the server listens; `injectHtml(html)` adds the tokens.css link to the app's HTML.
 * @param {{runDir:string, data:{tokens:object[], pairs:object[]}, log?:(s:string)=>void, provider?:string,
 *   transcribeFn?:Function, museFn?:Function, pointFn?:Function, probe?:object, focus?:object}} o
 */
export function createPasApi(o) {
  const log = o.log || (() => {})
  const pctx = loadPointContext(o.runDir)
  const tokens = o.data.tokens
  const viewport = pctx.capture.viewport || { width: 1440, height: 900 }
  const core = /** @type {PasCore} */ ({
    page: { width: pctx.full.width, height: pctx.full.height },
    tokens, known: new Set(tokens.map((t) => t.name)), values: tokenValues(pctx.tokens), baseline: [],
    probe: o.probe || null, focus: o.focus || null,
    pointFn: o.pointFn || ((x, y) => pointAt(pctx, x, y)),
    museFn: o.museFn || ((req) => museIntent(req, { provider: o.provider || 'baseten' })),
    cache: new Map(),
    pctx,
  })
  const state = { ready: !!o.probe, warmMs: null, error: null, browser: null, warming: null }
  let tokensCss = null

  async function warm(baseUrl) {
    if (state.warming) return state.warming
    state.warming = (async () => {
      const t0 = Date.now()
      const appUrl = new URL('app/', baseUrl).href
      try {
        if (!core.probe || !core.focus) {
          const { chromium } = await import('playwright')
          const { LAUNCH } = await import('../capture.js')
          state.browser = await chromium.launch(LAUNCH)
          if (!core.probe) core.probe = await openProbe(state.browser, appUrl, viewport, tokens, o.data.pairs)
          if (!core.focus) core.focus = focusRunner(state.browser, appUrl, viewport, log)
        }
        core.baseline = await core.probe.audit([])
        state.ready = true
        state.warmMs = Date.now() - t0
        log(`pas: probe page warm in ${state.warmMs} ms; ${core.baseline.filter((r) => r.status === 'fail').length} of ${core.baseline.length} pairs failing`)
        if (core.focus.start) core.focus.start()
      } catch (e) { state.error = String(e.message || e).slice(0, 200); log(`pas: warm failed: ${state.error}`) }
    })()
    return state.warming
  }

  const needReady = () => { if (!state.ready) throw new ApiError(503, 'warming', state.error ? `probe browser failed: ${state.error}` : 'probe browser is warming up') }

  async function health() {
    const muse = intentProviders(o.provider || 'baseten').map((p) => ({ id: p.id, model: p.model }))
    const meta = !!process.env.META_API_KEY
    const fb = core.focus && core.focus.state ? core.focus.state() : null
    let focusBaseline = { ready: false }
    if (fb) {
      const v = await Promise.race([fb.then((r) => r, () => null), new Promise((r) => setTimeout(() => r(undefined), 0))])
      if (v) focusBaseline = { ready: true, summary: summarizeStops(v.stops), ms: v.ms }
      else if (v === null) focusBaseline = { ready: false, error: 'baseline failed' }
    }
    return {
      ok: state.ready && meta && muse.length > 0,
      providers: { asr: { ok: meta, model: process.env.META_ASR_MODEL || 'muse-voice-transcribe-1.0' }, sam: { ok: meta, model: process.env.META_SAM_MODEL || 'sam-3.1' }, muse },
      run: { dir: o.runDir, tokens: tokens.length, pairs: o.data.pairs.length, viewport },
      browser: { ready: state.ready, warmMs: state.warmMs, error: state.error },
      focusBaseline,
    }
  }

  async function handle(req, res, url) {
    const p = url.pathname
    if (!p.startsWith('/__pas/')) return false
    const t0 = Date.now()
    const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)) }
    const name = p.slice('/__pas/'.length)
    try {
      if (req.method === 'GET' && CLIENT_FILES[name]) { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(await readFile(CLIENT_FILES[name])); return true }
      if (req.method === 'GET' && name === 'tokens.css') {
        if (tokensCss == null) tokensCss = await readFile(join(o.runDir, 'tokens.css'), 'utf-8').catch(() => '')
        res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' }); res.end(tokensCss); return true
      }
      if (!localOnly(req)) throw new ApiError(403, 'local_only', 'local only (127.0.0.1, same origin)')
      if (name === 'api/health') {
        if (req.method !== 'GET') throw new ApiError(405, 'method', 'GET only')
        json(200, { ...(await health()), ms: Date.now() - t0 }); return true
      }
      const routes = { 'api/point': 1, 'api/transcribe': 1, 'api/intent': 1, 'api/focus-check': 1 }
      if (!routes[name]) throw new ApiError(404, 'not_found', 'not found')
      if (req.method !== 'POST') throw new ApiError(405, 'method', 'POST only')
      if (name === 'api/transcribe') {
        const wav = new Uint8Array(await readRaw(req, MAX_WAV_BYTES))
        let r
        try { r = await (o.transcribeFn || transcribeWav)(wav) } catch (e) {
          const m = String(e.message || e)
          if (/^(empty audio|audio too long|not a WAV|need 16 kHz)/.test(m)) throw bad(m)
          throw new ApiError(502, 'upstream', m.slice(0, 240))
        }
        log(`pas transcribe ${r.ms} ms: ${r.transcript}`)
        json(200, r); return true
      }
      const body = parseJson(await readRaw(req, 65536))
      needReady()
      let out
      if (name === 'api/point') out = await resolvePoint(core, body.x, body.y)
      else if (name === 'api/intent') out = await decideIntent(core, body)
      else out = await focusCheck(core, body)
      out = { ...out, ms: Date.now() - t0 }
      log(`pas ${name} ${out.ms} ms${out.route ? ` route ${out.route}: ${out.summary}` : ''}`)
      json(200, out); return true
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500
      const code = e instanceof ApiError ? e.code : 'internal'
      log(`pas error ${p}: ${String(e.message || e).slice(0, 200)}`)
      json(status, { error: String(e.message || e).slice(0, 300), code, ms: Date.now() - t0 })
      return true
    }
  }

  /** Add the run's tokens.css to an HTML page of the app (before </head>, else at the top). */
  function injectHtml(html) {
    const tag = '<link rel="stylesheet" href="/__pas/tokens.css" data-s2t-tokens>'
    const s = String(html)
    return /<\/head>/i.test(s) ? s.replace(/<\/head>/i, `${tag}</head>`) : tag + s
  }

  async function close() { if (state.browser) await state.browser.close().catch(() => {}) }

  return { handle, warm, injectHtml, close, health, core, state }
}

function parseJson(buf) {
  try { const v = JSON.parse(String(buf)); if (v && typeof v === 'object') return v } catch (e) { /* fall through */ }
  throw bad('JSON object body required')
}

function readRaw(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = []
    let n = 0, over = false
    // Over the limit: stop keeping data but drain the request, so the 413 reply still reaches the page.
    req.on('data', (c) => { n += c.length; if (over) return; if (n > limit) { over = true; chunks.length = 0; fail(new ApiError(413, 'too_large', 'body too large')) } else chunks.push(c) })
    req.on('end', () => { if (!over) ok(Buffer.concat(chunks)) })
    req.on('error', fail)
  })
}
