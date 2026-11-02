#!/usr/bin/env node
// Save a live page as a local static folder so the full pipeline (rewrite + verify) can run on it: opens the URL at
// 1440x900 and writes every same-origin response (HTML, CSS, JS, fonts, images) under its URL path; "/" and "/x/"
// become index.html. Cross-origin assets (CDN fonts, analytics) stay remote. Only for public, permissively licensed
// sites (docs/breadth.md).
//   node scripts/mirror-site.mjs <url> <out dir> [--public]
// --public (live demo tier C, a visitor's URL): every browser request is checked by src/lib/public-url.js guardPage
// (public hosts only, WebSockets and service workers off), the saved files are capped at 5 MB in total (S2T_MIRROR_CAP
// bytes; over the cap the mirror fails with "too big"), and the page gets 25 s to load plus at most 5 s to go quiet.
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { chromium } from 'playwright'

/** URL path → file path inside the mirror; exported for tests. */
export function mirrorPath(pathname) {
  let p = decodeURIComponent(pathname || '/')
  if (p.endsWith('/')) p += 'index.html'
  return p.split('/').filter((s) => s && s !== '..' && s !== '.').join('/')
}

async function main() {
  const argv = process.argv.slice(2)
  const pub = argv.includes('--public')
  const [url, out] = argv.filter((x) => x !== '--public')
  if (!url || !out) { console.error('usage: node scripts/mirror-site.mjs <url> <out dir> [--public]'); process.exit(2) }
  const root = resolve(out)
  const cap = Number(process.env.S2T_MIRROR_CAP) || 5 * 1024 * 1024
  let bytes = 0, tooBig = false
  // The origin is wherever the page lands (github.io sites often redirect to a custom domain).
  let origin = new URL(url).origin
  const browser = await chromium.launch({ args: ['--disable-accelerated-2d-canvas', '--disable-gpu'] })
  let saved = 0
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...(pub ? { serviceWorkers: 'block' } : {}) })
    if (pub) {
      const { guardPage } = await import('../src/lib/public-url.js')
      await guardPage(page, { onBlock: (u, why) => console.error(`guard: blocked ${u.slice(0, 120)} (${why})`) })
    }
    const pending = []
    page.on('response', (res) => {
      const u = new URL(res.url())
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame() && res.status() === 200) origin = u.origin
      if (u.origin !== origin || res.status() !== 200) return
      pending.push(res.body().then((body) => {
        if (pub) {
          bytes += body.length
          if (bytes > cap) { tooBig = true; return }
        }
        const file = join(root, mirrorPath(u.pathname))
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, body)
        saved++
      }).catch((e) => { void e }))
    })
    let res
    if (pub) {
      res = await page.goto(url, { waitUntil: 'load', timeout: 25000 })
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    } else {
      res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
    }
    // Let late lazy assets arrive before the browser closes.
    // Redirected to a sub-path (e.g. /en/)? Make the root serve that page too.
    const landed = new URL(page.url())
    await page.waitForTimeout(500)
    await Promise.all(pending)
    if (landed.origin === origin && landed.pathname !== '/' && res) {
      const html = await res.text().catch(() => null)
      if (html) writeFileSync(join(root, 'index.html'), html)
    }
  } finally {
    await browser.close()
  }
  if (tooBig) { console.error(`✗ too big: the page and its same-origin files are over ${(cap / 1024 / 1024).toFixed(0)} MB`); process.exit(3) }
  console.log(`mirror: ${saved} files${pub ? `, ${(bytes / 1024).toFixed(0)} KB` : ''} → ${root}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
