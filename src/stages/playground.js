// Token playground data + the local-only playground server (`s2t playground`).
// The server binds 127.0.0.1 and serves: the playground page, contrast.js, tokens.json (built from a run), the
// tokenized app under /app/ (same origin, so the page can set custom properties inside its iframe), and
// POST /api/muse, which calls Muse Spark with the API key held here; the key never reaches the browser.
// Data sent to the model: public token names, values and contrast numbers only (class C). Never deploy this.
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { join, extname, normalize, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { cssVarOf } from '../lib/props.js'
import { cssValue } from './emit.js'
import { LLM_PRESETS } from '../config.js'
import { chat, extractJson } from '../providers/llm/chat.js'
import { pairsFromCapture, sanitizeProposal, parseColor, UNSAFE } from '../preview-client/contrast.js'

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '../preview-client')

/**
 * Playground tokens.json from a run: playable tokens (color, radius) with tier, alias and use counts, plus the
 * text/background pairs from capture.json that the accessibility audit checks.
 */
export function playgroundData({ set, clusters, rewrite, capture }, { title, app } = {}) {
  const kindOf = new Map(clusters.map((c) => [c.id, c.kind]))
  const used = {}
  for (const e of rewrite.edits) used[e.token] = (used[e.token] || 0) + 1
  // Only kinds a person can meaningfully play with live: colors, radii; shadows stay out (complex values).
  const PLAYABLE = new Set(['color', 'radius'])
  const tokens = set.tokens
    .filter((t) => PLAYABLE.has(kindOf.get(t.clusters[0])))
    .map((t) => ({
      name: t.name, tier: t.tier, kind: kindOf.get(t.clusters[0]), cssVar: cssVarOf(t.name).slice(2),
      value: t.value ? cssValue(t.value) : null, alias: t.alias || null, why: t.why || '', uses: used[t.name] || 0,
    }))
  // Order: semantic and component first (the decisions), then primitives by use.
  const order = { semantic: 0, component: 1, primitive: 2 }
  tokens.sort((x, y) => order[x.tier] - order[y.tier] || y.uses - x.uses)
  return {
    title: title || 'Token playground', app: app || '../tokens/', namer: set.namer, edits: rewrite.edits.length, tokens,
    pairs: capture ? pairsFromCapture(capture) : [],
  }
}

/** Read a run folder into playgroundData's inputs. */
export function readRun(runDir) {
  const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
  return { set: rd('tokens'), clusters: rd('clusters'), rewrite: rd('rewrite'), capture: existsSync(join(runDir, 'capture.json')) ? rd('capture') : null }
}

// ---- Muse prompts -------------------------------------------------------------------------------------------------

const FIX_SYSTEM = `You fix WCAG 2.x AA text contrast failures in a design-token set (4.5:1 for body text, 3:1 for large text).
You get the color tokens with their CURRENT values and the failing text/background pairs, each with the tokens whose
value equals its text color (fgTokens) and its background (bgTokens).
Change as few tokens as possible. Keep each hue and the brand feel: darken or lighten the same hue rather than swapping
hues. Prefer changing a semantic text token over a primitive (a primitive change moves every alias). Do not change a
token in a way that would break another pair you were given. Every value you propose must itself reach the required
ratio against the background it is fixing; compute it.
Reply with JSON only: {"summary":"one or two plain sentences on what was wrong","changes":[{"token":"<name from the list>","value":"#rrggbb","reason":"<short, with the new ratio>"}]}`

const DARK_SYSTEM = `You build a dark theme for a design-token set by re-pointing its semantic and component color tokens.
For each token you change, give either a hex value or the name of another token from the list (an alias). You may add
new primitive tokens named color.<hue>.<step> (for example color.gray.900) with hex values and point semantic tokens at
them. Surfaces become dark, text light, borders subtle; keep the brand/action hues recognizable (lighten them if they
sit on dark surfaces). The main surfaces must end up dark (for example #172033); a light theme is not an answer. Every text/background
pair you are given must reach WCAG AA (4.5:1 body, 3:1 large) after your change, except pairs on "a gradient, not a
token": no token controls a gradient, so ignore those and never lighten surfaces for them. Prefer changing the semantic
layer; a primitive change also moves every token and element that uses it directly.
Reply with JSON only: {"summary":"one or two plain sentences","changes":[{"token":"<name>","value":"#rrggbb or <token name>","reason":"<short>"}]}`

const num = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 100) / 100 : null)
const str = (s, n = 64) => String(s == null ? '' : s).replace(/[<>]/g, '').slice(0, n)
const colorOr = (v) => { const s = str(v, 40); return parseColor(s) && !UNSAFE.test(s) ? s : null }

/**
 * Clean the browser's request down to what the prompt needs: known tokens with color values, and pairs with numbers.
 * Anything else is dropped, so the page cannot smuggle other content to the model.
 * @param {any} body
 * @param {Set<string>} known token names from the run
 */
export function cleanMuseRequest(body, known) {
  const b = body && typeof body === 'object' ? body : {}
  const task = b.task === 'dark' ? 'dark' : 'fix'
  const tokens = (Array.isArray(b.tokens) ? b.tokens : []).filter((t) => t && known.has(t.name)).slice(0, 200)
    .map((t) => ({ name: t.name, tier: ['semantic', 'component', 'primitive'].includes(t.tier) ? t.tier : 'primitive', value: colorOr(t.value), alias: known.has(t.alias) ? t.alias : null }))
    .filter((t) => t.value)
  const names = (a) => (Array.isArray(a) ? a.filter((n) => known.has(n)).slice(0, 6) : [])
  const pairs = (a) => (Array.isArray(a) ? a : []).slice(0, 60).map((p) => ({
    examples: (Array.isArray(p.examples) ? p.examples : []).slice(0, 3).map((x) => str(x, 40)),
    count: num(p.count) || 1, fg: colorOr(p.fg), bg: colorOr(p.bg), ratio: num(p.ratio), required: num(p.required) === 3 ? 3 : 4.5,
    fgTokens: names(p.fgTokens), bgTokens: names(p.bgTokens), gradient: p.gradient === true,
  })).filter((p) => p.fg && p.bg)
  const previous = (Array.isArray(b.previous) ? b.previous : []).slice(0, 80)
    .filter((c) => c && typeof c.token === 'string' && /^color\.[a-z0-9.-]+$/i.test(c.token))
    .map((c) => ({ token: str(c.token, 80), value: str(c.value, 64) })).filter((c) => !UNSAFE.test(c.value))
  return { task, tokens, failures: pairs(b.failures), pairs: pairs(b.pairs), previous, notDarkBg: colorOr(b.notDarkBg) }
}

/** Chat messages for a cleaned request. */
export function museMessages(req) {
  const tokens = req.tokens.map((t) => `${t.name} (${t.tier}) = ${t.value}${t.alias ? ` [alias of ${t.alias}]` : ''}`).join('\n')
  const pair = (p) => `- "${p.examples.join('", "')}" x${p.count}: text ${p.fg} [${p.fgTokens.join(', ') || 'no token'}] on ${p.bg} [${p.gradient ? 'a gradient, not a token' : p.bgTokens.join(', ') || 'no token'}] ratio ${p.ratio ?? '?'} needs ${p.required}`
  if (req.task === 'fix') {
    return [
      { role: 'system', content: FIX_SYSTEM },
      { role: 'user', content: `Color tokens:\n${tokens}\n\nFailing pairs:\n${req.failures.map(pair).join('\n')}` },
    ]
  }
  let user = `Color tokens (light theme now):\n${tokens}\n\nText/background pairs on the page (light theme):\n${req.pairs.map(pair).join('\n')}`
  if (req.previous.length) {
    user += `\n\nYour previous dark theme:\n${req.previous.map((c) => `${c.token} = ${c.value}`).join('\n')}`
    if (req.notDarkBg) user += `\n\nIt was NOT dark: most text still sat on ${req.notDarkBg}. The surfaces must be dark.`
    if (req.failures.length) user += `\n\nWith it applied, these pairs still fail (colors shown are the dark-theme values):\n${req.failures.map(pair).join('\n')}`
    user += '\n\nReturn the full corrected dark theme (all changes, not only the new ones).'
  }
  return [{ role: 'system', content: DARK_SYSTEM }, { role: 'user', content: user }]
}

/** Provider order: the chosen one first, the other Muse Spark as fallback. Never a "-contributor" model. */
export function museProviders(first = 'baseten') {
  const order = first === 'meta' ? ['meta', 'baseten'] : ['baseten', 'meta']
  return order.map((id) => LLM_PRESETS[id]()).filter((p) => p.apiKey && p.model && !/-contributor$/i.test(p.model))
}

/** Ask Muse Spark; returns the sanitized proposal plus which provider answered and how long it took. */
export async function askMuse(req, known, { provider = 'baseten', chatFn = chat } = {}) {
  const providers = museProviders(provider)
  if (!providers.length) throw new Error('no Muse Spark key (Baseten or Meta) in the Keychain or env')
  const messages = museMessages(req)
  const errors = []
  for (const p of providers) {
    const t0 = Date.now()
    try {
      const r = await chatFn({ baseURL: p.baseURL, apiKey: p.apiKey, model: p.model, messages, json: true, reasoningEffort: 'low', timeoutMs: 60000 })
      const raw = extractJson(r.text)
      const out = sanitizeProposal(raw, { known: Array.from(known), allowNew: req.task === 'dark', allowAlias: req.task === 'dark' })
      return { ...out, provider: p.id, model: p.model, ms: Date.now() - t0, cached: !!r.cached, usage: r.usage || null }
    } catch (e) {
      // Error text only (status + short body); never the key.
      errors.push(`${p.id}: ${String(e.message || e).slice(0, 160)}`)
    }
  }
  throw new Error(errors.join(' | '))
}

// ---- server -------------------------------------------------------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.map': 'application/json' }

async function sendFile(res, file) {
  const body = await readFile(file)
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(body)
}

function readBody(req, limit = 200000) {
  return new Promise((ok, fail) => {
    let s = ''
    req.on('data', (c) => { s += c; if (s.length > limit) { fail(new Error('body too large')); req.destroy() } })
    req.on('end', () => ok(s))
    req.on('error', fail)
  })
}

/**
 * Start the local playground. Returns {url, close}.
 * @param {{runDir:string, appDir:string, port?:number, provider?:'baseten'|'meta', title?:string, log?:(s:string)=>void}} o
 */
export function startPlayground(o) {
  const appDir = resolve(o.appDir)
  const data = playgroundData(readRun(resolve(o.runDir)), { title: o.title, app: 'app/' })
  const known = new Set(data.tokens.filter((t) => t.kind === 'color').map((t) => t.name))
  const log = o.log || (() => {})
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const p = url.pathname
    const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)) }
    try {
      if (p === '/api/muse') {
        // Same-origin only: a page on another origin (or a DNS-rebinding host name) gets nothing.
        const host = req.headers.host || ''
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(403, { error: 'local only' })
        if (req.method === 'GET') {
          const ps = museProviders(o.provider)
          return json(200, { ok: ps.length > 0, providers: ps.map((x) => ({ id: x.id, model: x.model })) })
        }
        if (req.method !== 'POST') return json(405, { error: 'POST only' })
        if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(403, { error: 'same origin only' })
        const body = JSON.parse(await readBody(req))
        const clean = cleanMuseRequest(body, known)
        const provider = body.provider === 'meta' ? 'meta' : o.provider
        const r = await askMuse(clean, known, { provider })
        log(`muse ${clean.task}${clean.previous.length ? ' (retry)' : ''}: ${r.provider} ${r.ms} ms${r.cached ? ' (cached)' : ''}, ${r.changes.length} changes, ${r.rejected.length} rejected`)
        return json(200, r)
      }
      if (p === '/' || p === '/index.html') return sendFile(res, join(CLIENT, 'playground.html'))
      if (p === '/contrast.js') return sendFile(res, join(CLIENT, 'contrast.js'))
      if (p === '/tokens.json') return json(200, data)
      if (p === '/app') { res.writeHead(302, { location: '/app/' }); return res.end() }
      if (p.startsWith('/app/')) {
        const rel = normalize(decodeURIComponent(p.slice(5))).replace(/^(\.\.[/\\])+/, '')
        let file = join(appDir, rel)
        if (!file.startsWith(appDir)) return json(403, { error: 'outside app' })
        try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html') } catch (e) { file = join(appDir, 'index.html') } // SPA fallback
        return sendFile(res, file)
      }
      json(404, { error: 'not found' })
    } catch (e) {
      log(`error ${p}: ${String(e.message || e).slice(0, 200)}`)
      json(500, { error: String(e.message || e).slice(0, 300) })
    }
  })
  return new Promise((ok) => {
    server.listen(o.port || 0, '127.0.0.1', () => {
      const { port } = /** @type {any} */ (server.address())
      ok({ url: `http://127.0.0.1:${port}/`, tokens: data.tokens.length, pairs: data.pairs.length, close: () => new Promise((r) => server.close(r)) })
    })
  })
}
