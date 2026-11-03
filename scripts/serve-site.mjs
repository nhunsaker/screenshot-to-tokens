#!/usr/bin/env node
// Server for the live-demo site. One process, one public port (0.0.0.0:$PORT, default 3000):
//   tier a: site/ (built by scripts/build-site.mjs), static, no spend.
//   tier b (S2T_TIERS includes b, S2T_PUBLIC=1, S2T_ORIGIN set): Point and say on Argon at /try/. The playground runs
//     in this process on an internal 127.0.0.1 port and this server proxies to it:
//       /try/*      -> playground /*   (page, tokens.json, pas-client.js, contrast.js, the app under /try/app/)
//       /__pas/*    -> playground /__pas/*   (the page and the app's injected tokens.css use these root paths)
//       /api/budget -> playground /__pas/api/budget   (ledger summary, no ids or IPs)
//     Host, Origin, Cookie and X-Forwarded-For pass through untouched, so the API's same-origin guard and the budget's
//     per-IP cap see what Traefik saw. The Argon build has relative asset URLs, so nothing root-absolute leaks out of
//     /try/app/. The API is metered by the budget ledger ($S2T_DATA/ledger.json).
//   tier c (S2T_TIERS includes c, same env as b): "run it on a public page" (src/stages/live-run.js).
//       POST /api/run {url} -> {id}; GET /api/run/<id> -> status; GET /api/run -> this visitor's runs left + queue;
//       /run/<id>/ -> the result page (unlisted, noindex, deleted after 24 h). Metered by the same ledger (25 units).
// The kill switch is S2T_TIERS (env change + restart): without b, /try/ redirects home and the index shows the clips;
// without c, the run form is not on the index and /api/run answers 404.
// Usage: node scripts/serve-site.mjs [site dir]
import { createServer, request as httpRequest } from 'node:http'
import { createReadStream, statSync, readFileSync } from 'node:fs'
import { join, normalize, extname, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(repo, process.argv[2] || 'site')
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const TIERS = String(process.env.S2T_TIERS || 'a').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const log = (s) => console.log(`[s2t] ${s}`)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
}
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
}

// Analytics: self-hosted Umami (stats.n8plusus.com). The tag is added to every HTML page the site serves when
// S2T_UMAMI_ID is set (production only); pageviews plus the data-umami-event clicks the pages mark. No cookies.
const UMAMI_ID = process.env.S2T_UMAMI_ID || ''
const UMAMI_TAG = UMAMI_ID ? `<script defer src="https://stats.n8plusus.com/script.js" data-website-id="${UMAMI_ID}"></script>` : ''
function withUmami(html) {
  if (!UMAMI_TAG) return html
  const s = String(html)
  if (s.includes('data-website-id=')) return s
  const i = s.search(/<\/head>/i)
  return i >= 0 ? s.slice(0, i) + UMAMI_TAG + s.slice(i) : s + UMAMI_TAG
}

function send(res, status, body, type, extra = {}) {
  if (/^text\/html/.test(type)) body = withUmami(body)
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra })
  res.end(res.req.method === 'HEAD' ? undefined : body)
}

// ---- tier b: the playground with point and say, metered -----------------------------------------------------------

const ORIGIN = process.env.S2T_PUBLIC === '1' ? String(process.env.S2T_ORIGIN || '').replace(/\/$/, '') : ''
let shared = null // { ledger } once b or c starts
/** One ledger for tiers b and c (one JSON file; two instances would overwrite each other). */
async function sharedSetup() {
  if (shared) return shared
  // Nothing a visitor sends is kept: no response cache on disk. Every outside call gives up after 30 s.
  process.env.S2T_CACHE = '0'
  if (!process.env.S2T_EXTERNAL_TIMEOUT_MS) process.env.S2T_EXTERNAL_TIMEOUT_MS = '30000'
  const { loadDotEnv } = await import('../src/config.js')
  loadDotEnv(repo) // Linux: real env vars; macOS dev: falls back to the Keychain. Never logged.
  const { fileLedger } = await import('../src/stages/pas/ledger.js')
  const ledger = fileLedger()
  log(`budget ledger ${ledger.file}: ${JSON.stringify(ledger.summary())}`)
  shared = { ledger }
  return shared
}

let live = null // { port, pas, ledger }
async function startTierB() {
  const origin = ORIGIN
  if (!origin) { log('tier b off: needs S2T_PUBLIC=1 and S2T_ORIGIN (e.g. https://s2t.sorbcloud.com)'); return }
  const { ledger } = await sharedSetup()
  const { startPlayground } = await import('../src/stages/playground.js')
  const s = await startPlayground({
    runDir: join(repo, process.env.S2T_ARGON_RUN || 'demo/argon-run'),
    appDir: join(repo, process.env.S2T_ARGON_APP || 'build/argon-app'),
    title: 'Argon Dashboard', pas: true, log,
    public: { origin, ledger, runLabel: 'demo/argon-run' },
  })
  live = { port: Number(new URL(s.url).port), pas: s.pas, ledger }
  log(`tier b: playground on ${s.url} (internal), public at ${origin}/try/; ${s.tokens} tokens, ${s.pairs} text pairs`)
  if (s.warming) s.warming.then(() => log(`tier b: browser ${s.pas && s.pas.state.ready ? `ready in ${s.pas.state.warmMs} ms` : `NOT ready: ${s.pas && s.pas.state.error}`}`))
}

function proxy(req, res, path) {
  const up = httpRequest({ host: '127.0.0.1', port: live.port, method: req.method, path, headers: req.headers }, (r) => {
    const isHtml = UMAMI_TAG && /^text\/html/.test(String(r.headers['content-type'] || ''))
    if (!isHtml) { res.writeHead(r.statusCode || 502, r.headers); return r.pipe(res) }
    const chunks = []
    r.on('data', (c) => chunks.push(c))
    r.on('end', () => {
      const body = withUmami(Buffer.concat(chunks).toString('utf8'))
      const headers = { ...r.headers, 'content-length': Buffer.byteLength(body) }
      delete headers['transfer-encoding']
      res.writeHead(r.statusCode || 502, headers)
      res.end(req.method === 'HEAD' ? undefined : body)
    })
  })
  up.setTimeout(120000, () => up.destroy(new Error('upstream timeout')))
  up.on('error', (e) => {
    log(`proxy error ${path}: ${String(e.message).slice(0, 120)}`)
    if (!res.headersSent) send(res, 502, JSON.stringify({ error: 'the live demo is restarting; try again in a moment', code: 'proxy' }), 'application/json; charset=utf-8')
    else res.destroy()
  })
  req.pipe(up)
}

// ---- tier c: run it on a public page ------------------------------------------------------------------------------

let runs = null // createRunService()
async function startTierC() {
  if (!ORIGIN) { log('tier c off: needs S2T_PUBLIC=1 and S2T_ORIGIN'); return }
  const { ledger } = await sharedSetup()
  const { createRunService } = await import('../src/stages/live-run.js')
  runs = createRunService({ dataDir: process.env.S2T_DATA || 'out/data', ledger, log })
  log(`tier c: runs under ${join(process.env.S2T_DATA || 'out/data', 'runs')}; ${JSON.stringify(ledger.runCaps)} runs, ${runs.queueInfo().max} waiting max`)
}

/** The visitor's session (the same s2t_sid cookie tier b sets) and IP, for the ledger's caps. */
async function visitor(req, res) {
  const { clientIp } = await import('../src/stages/pas/ledger.js')
  const { randomUUID } = await import('node:crypto')
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)s2t_sid=([A-Za-z0-9-]{8,64})/)
  let session = m ? m[1] : null
  if (!session) {
    session = randomUUID()
    res.setHeader('set-cookie', `s2t_sid=${session}; Path=/; HttpOnly; SameSite=Lax${ORIGIN.startsWith('https:') ? '; Secure' : ''}`)
  }
  return { session, ip: clientIp(req, true) }
}

// ---- tier a: the index (tier b's "Try it live" slot resolved at serve time) and static files ----------------------

const tierB = () => TIERS.includes('b') && !!live
const tierC = () => TIERS.includes('c') && !!runs
/** Keep the <!--tier-x--> or the <!--no-tier-x--> block of the index, drop the other. */
function pickBlock(html, tier, on) {
  const keep = on ? `tier-${tier}` : `no-tier-${tier}`, drop = on ? `no-tier-${tier}` : `tier-${tier}`
  return html.replace(new RegExp(`<!--${drop}-->[\\s\\S]*?<!--/${drop}-->\\n?`, 'g'), '').replace(new RegExp(`<!--/?${keep}-->`, 'g'), '')
}
function indexHtml() {
  return pickBlock(pickBlock(readFileSync(join(root, 'index.html'), 'utf-8'), 'b', tierB()), 'c', tierC())
}

async function health() {
  const out = { ok: true, service: 's2t-site', tiers: TIERS }
  if (TIERS.includes('b')) {
    const st = live && live.pas ? live.pas.state : null
    out.browser = { ready: !!(st && st.ready), warmMs: st ? st.warmMs : null, error: st ? st.error : 'tier b not started' }
    if (live) { const b = live.ledger.summary(); out.budget = { left: b.left, total: b.total } }
  }
  if (TIERS.includes('c')) {
    out.runs = runs ? runs.queueInfo() : { error: 'tier c not started' }
    if (shared && !out.budget) { const b = shared.ledger.summary(); out.budget = { left: b.left, total: b.total } }
  }
  return out
}

const server = createServer(async (req, res) => {
  let path
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { return send(res, 400, 'bad request\n', 'text/plain; charset=utf-8') }
  if (path === '/health') return send(res, 200, JSON.stringify(await health()), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' })

  if (path === '/api/run' || path.startsWith('/api/run/')) {
    const json = (code, v) => send(res, code, JSON.stringify(v), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' })
    if (!tierC()) return json(404, { error: 'Running your own page is off right now.', code: 'off' })
    const { sameOriginOnly } = await import('../src/stages/pas/server.js')
    if (!sameOriginOnly(req, ORIGIN)) return json(403, { error: 'same origin only', code: 'same_origin' })
    try { return await runs.handleApi(req, res, path, await visitor(req, res)) } catch (e) {
      log(`api/run error: ${String(e.message || e).slice(0, 200)}`)
      if (!res.headersSent) return json(500, { error: 'Something went wrong on our side.', code: 'server' })
      return res.destroy()
    }
  }
  if (path.startsWith('/run/')) {
    if (!tierC()) return send(res, 404, '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found. <a href="/">Back to Screenshot to Tokens</a>.</p>', 'text/html; charset=utf-8')
    if (runs.serveResult(req, res, path, TYPES)) return
  }
  if (path === '/api/budget' && !tierB() && shared) {
    const { COSTS, RUN_COST } = await import('../src/stages/pas/ledger.js')
    return send(res, 200, JSON.stringify({ ...shared.ledger.summary(), costs: { ...COSTS, run: RUN_COST } }), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' })
  }

  if (path === '/try' || path.startsWith('/try/') || path.startsWith('/__pas/') || path === '/api/budget') {
    if (!tierB()) { res.writeHead(302, { ...BASE_HEADERS, Location: '/#pas-h' }); return res.end() }
    const raw = req.url || '/'
    if (path === '/try') { res.writeHead(301, { ...BASE_HEADERS, Location: '/try/' }); return res.end() }
    if (path === '/api/budget') return proxy(req, res, '/__pas/api/budget')
    return proxy(req, res, path.startsWith('/try/') ? raw.slice('/try'.length) : raw)
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed\n', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' })
  if (path === '/' || path === '/index.html') return send(res, 200, indexHtml(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' })

  if (path.endsWith('/')) path += 'index.html'
  const file = normalize(join(root, path))
  if (file !== root && !file.startsWith(root + sep)) return send(res, 404, 'not found\n', 'text/plain; charset=utf-8')
  let st
  try { st = statSync(file) } catch { st = null }
  if (st && st.isDirectory()) { res.writeHead(301, { ...BASE_HEADERS, Location: path + '/' }); return res.end() }
  if (!st && path === '/favicon.ico') { res.writeHead(204, BASE_HEADERS); return res.end() }
  if (!st) return send(res, 404, '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found. <a href="/">Back to Screenshot to Tokens</a>.</p>', 'text/html; charset=utf-8')

  const ext = extname(file).toLowerCase()
  const headers = {
    ...BASE_HEADERS,
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Last-Modified': st.mtime.toUTCString(),
    // HTML revalidates every time (redeploys show at once); media and token files cache for an hour.
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  }
  if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(st.mtime.toUTCString())) {
    res.writeHead(304, headers); return res.end()
  }
  // Byte ranges for the clips (Safari will not play an mp4 without them).
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
  if (range && (ext === '.mp4' || ext === '.webm')) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1
    if (start > end || start >= st.size) { res.writeHead(416, { ...BASE_HEADERS, 'Content-Range': `bytes */${st.size}` }); return res.end() }
    res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    return createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
  }
  res.writeHead(200, { ...headers, ...(ext === '.mp4' || ext === '.webm' ? { 'Accept-Ranges': 'bytes' } : {}) })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
})

if (TIERS.includes('b')) await startTierB().catch((e) => log(`tier b failed to start: ${String(e.message || e).slice(0, 200)}`))
if (TIERS.includes('c')) await startTierC().catch((e) => log(`tier c failed to start: ${String(e.message || e).slice(0, 200)}`))
server.listen(PORT, HOST, () => log(`serving ${root} on http://${HOST}:${PORT} (tiers ${TIERS.join(',')}${TIERS.includes('b') && !live ? ', b NOT running' : ''}${TIERS.includes('c') && !runs ? ', c NOT running' : ''})`))
async function shutdown() {
  server.close()
  if (live && live.pas && live.pas.close) await live.pas.close().catch(() => {})
  process.exit(0)
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, shutdown)
