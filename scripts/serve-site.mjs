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
// The kill switch is S2T_TIERS (env change + restart): without b, /try/ redirects home and the index shows the clips.
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

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra })
  res.end(res.req.method === 'HEAD' ? undefined : body)
}

// ---- tier b: the playground with point and say, metered -----------------------------------------------------------

let live = null // { port, pas, ledger }
async function startTierB() {
  const origin = process.env.S2T_PUBLIC === '1' ? String(process.env.S2T_ORIGIN || '').replace(/\/$/, '') : ''
  if (!origin) { log('tier b off: needs S2T_PUBLIC=1 and S2T_ORIGIN (e.g. https://s2t.sorbcloud.com)'); return }
  // Nothing a visitor sends is kept: no response cache on disk. Every outside call gives up after 30 s.
  process.env.S2T_CACHE = '0'
  if (!process.env.S2T_EXTERNAL_TIMEOUT_MS) process.env.S2T_EXTERNAL_TIMEOUT_MS = '30000'
  const { loadDotEnv } = await import('../src/config.js')
  loadDotEnv(repo) // Linux: real env vars; macOS dev: falls back to the Keychain. Never logged.
  const { fileLedger } = await import('../src/stages/pas/ledger.js')
  const { startPlayground } = await import('../src/stages/playground.js')
  const ledger = fileLedger()
  log(`budget ledger ${ledger.file}: ${JSON.stringify(ledger.summary())}`)
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
    res.writeHead(r.statusCode || 502, r.headers)
    r.pipe(res)
  })
  up.setTimeout(120000, () => up.destroy(new Error('upstream timeout')))
  up.on('error', (e) => {
    log(`proxy error ${path}: ${String(e.message).slice(0, 120)}`)
    if (!res.headersSent) send(res, 502, JSON.stringify({ error: 'the live demo is restarting; try again in a moment', code: 'proxy' }), 'application/json; charset=utf-8')
    else res.destroy()
  })
  req.pipe(up)
}

// ---- tier a: the index (tier b's "Try it live" slot resolved at serve time) and static files ----------------------

const tierB = () => TIERS.includes('b') && !!live
function indexHtml() {
  const html = readFileSync(join(root, 'index.html'), 'utf-8')
  const keep = tierB() ? 'tier-b' : 'no-tier-b', drop = tierB() ? 'no-tier-b' : 'tier-b'
  return html.replace(new RegExp(`<!--${drop}-->[\\s\\S]*?<!--/${drop}-->\\n?`, 'g'), '').replace(new RegExp(`<!--/?${keep}-->`, 'g'), '')
}

async function health() {
  const out = { ok: true, service: 's2t-site', tiers: TIERS }
  if (TIERS.includes('b')) {
    const st = live && live.pas ? live.pas.state : null
    out.browser = { ready: !!(st && st.ready), warmMs: st ? st.warmMs : null, error: st ? st.error : 'tier b not started' }
    if (live) { const b = live.ledger.summary(); out.budget = { left: b.left, total: b.total } }
  }
  return out
}

const server = createServer(async (req, res) => {
  let path
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { return send(res, 400, 'bad request\n', 'text/plain; charset=utf-8') }
  if (path === '/health') return send(res, 200, JSON.stringify(await health()), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' })

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
server.listen(PORT, HOST, () => log(`serving ${root} on http://${HOST}:${PORT} (tiers ${TIERS.join(',')}${TIERS.includes('b') && !live ? ', b NOT running' : ''})`))
async function shutdown() {
  server.close()
  if (live && live.pas && live.pas.close) await live.pas.close().catch(() => {})
  process.exit(0)
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, shutdown)
