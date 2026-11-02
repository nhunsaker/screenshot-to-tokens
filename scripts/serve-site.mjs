#!/usr/bin/env node
// Static server for the live-demo site (tier A): serves site/ (built by scripts/build-site.mjs) and /health.
// No dependencies. Binds 0.0.0.0:$PORT (default 3000). Usage: node scripts/serve-site.mjs [site dir]
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { join, normalize, extname, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', process.argv[2] || 'site')
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

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

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed\n', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' })
  let path
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { return send(res, 400, 'bad request\n', 'text/plain; charset=utf-8') }
  if (path === '/health') return send(res, 200, JSON.stringify({ ok: true, service: 's2t-site', tier: 'a' }), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' })

  if (path.endsWith('/')) path += 'index.html'
  const file = normalize(join(root, path))
  if (file !== root && !file.startsWith(root + sep)) return send(res, 404, 'not found\n', 'text/plain; charset=utf-8')
  let st
  try { st = statSync(file) } catch { st = null }
  if (st && st.isDirectory()) { res.writeHead(301, { ...BASE_HEADERS, Location: path + '/' }); return res.end() }
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
  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
})

server.listen(PORT, HOST, () => console.log(`s2t-site (tier a) serving ${root} on http://${HOST}:${PORT}`))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)))
