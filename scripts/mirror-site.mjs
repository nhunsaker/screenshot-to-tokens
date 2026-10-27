#!/usr/bin/env node
// Save a live page as a local static folder so the full pipeline (rewrite + verify) can run on it: opens the URL at
// 1440x900 and writes every same-origin response (HTML, CSS, JS, fonts, images) under its URL path; "/" and "/x/"
// become index.html. Cross-origin assets (CDN fonts, analytics) stay remote. Only for public, permissively licensed
// sites (docs/breadth.md).
//   node scripts/mirror-site.mjs <url> <out dir>
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
  const [url, out] = process.argv.slice(2)
  if (!url || !out) { console.error('usage: node scripts/mirror-site.mjs <url> <out dir>'); process.exit(2) }
  const root = resolve(out)
  // The origin is wherever the page lands (github.io sites often redirect to a custom domain).
  let origin = new URL(url).origin
  const browser = await chromium.launch({ args: ['--disable-accelerated-2d-canvas', '--disable-gpu'] })
  let saved = 0
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const pending = []
    page.on('response', (res) => {
      const u = new URL(res.url())
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame() && res.status() === 200) origin = u.origin
      if (u.origin !== origin || res.status() !== 200) return
      pending.push(res.body().then((body) => {
        const file = join(root, mirrorPath(u.pathname))
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, body)
        saved++
      }).catch((e) => { void e }))
    })
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
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
  console.log(`mirror: ${saved} files → ${root}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
