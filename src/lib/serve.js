// Tiny static file server so capture and verify run against a local folder offline.
import { createServer } from 'http'
import { readFile, stat } from 'fs/promises'
import { join, extname, normalize } from 'path'

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }

/** Origins of the static servers this process has open (the network guard lets the browser reach only these locally). */
export const SERVED_ORIGINS = new Set()

/** Serve `dir` on a free port. Returns { url, close }. */
export function serveDir(dir, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
      let file = join(dir, p)
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
      res.end(body)
    } catch (e) {
      res.writeHead(404)
      res.end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = /** @type {any} */ (server.address())
      const origin = `http://127.0.0.1:${p}`
      SERVED_ORIGINS.add(origin)
      resolve({ url: `${origin}/`, close: () => { SERVED_ORIGINS.delete(origin); return new Promise((r) => server.close(r)) } })
    })
  })
}
