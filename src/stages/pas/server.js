// Point and say: local-only HTTP handlers. `pasHandler(ctx)` returns (req, res, url) => handled?, so the same routes
// can mount on the playground server (lane A) or on the spike's server, which serves the tokenized app at "/".
//   GET  /__pas/wav.js, /__pas/contrast.js   the in-page WAV encoder and the live contrast audit
//   POST /__pas/api/transcribe  WAV body -> {transcript, ms}
//   POST /__pas/api/point       {x, y} page px -> pointAt() result
// Same guards as /api/muse: Host must be 127.0.0.1/localhost (DNS rebinding) and any Origin must be this origin.
import { createServer } from 'http'
import { readFile, stat } from 'fs/promises'
import { join, extname, normalize, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { transcribe } from './transcribe.js'
import { pointAt } from './point.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject' }

function readRaw(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => { n += c.length; if (n > limit) { fail(new Error('body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

/** True when the request may use the API (local host name, same origin). */
export function localOnly(req) {
  const host = req.headers.host || ''
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false
  return !req.headers.origin || req.headers.origin === `http://${host}`
}

/**
 * Public mode (S2T_PUBLIC=1, live demo): the request must come from the one public origin. Host must be that
 * origin's host (Traefik routes by it; anything else is a rebinding or a direct hit), and Origin must equal it when
 * sent; a state-changing request (not GET/HEAD) must send it, which every browser does for fetch POSTs.
 * @param {{headers:Record<string, any>, method?:string}} req
 * @param {string} origin e.g. https://s2t.sorbcloud.com
 */
export function sameOriginOnly(req, origin) {
  let want
  try { want = new URL(origin) } catch (e) { return false }
  if (want.origin !== origin.replace(/\/$/, '')) return false
  if ((req.headers.host || '').toLowerCase() !== want.host) return false
  const o = req.headers.origin
  if (o == null) return req.method === 'GET' || req.method === 'HEAD'
  return o === want.origin
}

/** The API guard: same-origin on the public host when `publicOrigin` is set, else local only. */
export function apiAllowed(req, publicOrigin) {
  return publicOrigin ? sameOriginOnly(req, publicOrigin) : localOnly(req)
}

/** @param {{point?:any, log?:(s:string)=>void, transcribeFn?:typeof transcribe}} ctx */
export function pasHandler(ctx) {
  const log = ctx.log || (() => {})
  return async (req, res, url) => {
    const p = url.pathname
    if (!p.startsWith('/__pas/')) return false
    const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)) }
    const CLIENT_FILES = { '/__pas/wav.js': join(HERE, 'wav.js'), '/__pas/contrast.js': join(HERE, '../../preview-client/contrast.js') }
    if (CLIENT_FILES[p]) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
      res.end(await readFile(CLIENT_FILES[p]))
      return true
    }
    if (!localOnly(req)) { json(403, { error: 'local only' }); return true }
    if (req.method !== 'POST') { json(405, { error: 'POST only' }); return true }
    try {
      if (p === '/__pas/api/transcribe') {
        const wav = new Uint8Array(await readRaw(req, 500000))
        const r = await (ctx.transcribeFn || transcribe)(wav)
        log(`transcribe ${r.ms} ms: ${r.transcript}`)
        json(200, r)
        return true
      }
      if (p === '/__pas/api/point') {
        if (!ctx.point) { json(404, { error: 'no run loaded' }); return true }
        const b = JSON.parse(String(await readRaw(req, 2000)))
        const x = Number(b.x), y = Number(b.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) { json(400, { error: 'x, y required' }); return true }
        const t0 = Date.now()
        const r = await pointAt(ctx.point, x, y)
        log(`point ${x},${y} ${Date.now() - t0} ms (SAM ${r.sam.ms} ms ${r.sam.source})`)
        json(200, { ...r, ms: Date.now() - t0 })
        return true
      }
      json(404, { error: 'not found' })
    } catch (e) {
      log(`error ${p}: ${String(e.message || e).slice(0, 200)}`)
      json(500, { error: String(e.message || e).slice(0, 300) })
    }
    return true
  }
}

/** Spike server: the tokenized app at "/" (SPA fallback) plus the /__pas routes. 127.0.0.1 only. */
export function startPasServer({ appDir, port = 0, ...ctx }) {
  const root = resolve(appDir)
  const handle = pasHandler(ctx)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    try {
      if (await handle(req, res, url)) return
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
      let file = join(root, rel)
      if (!file.startsWith(root)) { res.writeHead(403); return res.end() }
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html') } catch (e) { file = join(root, 'index.html') }
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch (e) { res.writeHead(500); res.end(String(e.message).slice(0, 200)) }
  })
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => {
    const { port: p } = /** @type {any} */ (server.address())
    ok({ url: `http://127.0.0.1:${p}/`, close: () => new Promise((r) => server.close(r)) })
  }))
}
