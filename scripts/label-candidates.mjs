#!/usr/bin/env node
// Hand-labeling helper for real-site ground truth (L1). Opens a page at 1440x900 and numbers every element on the
// first screen that BEHAVES clickable (pointer cursor, a, button, input, select, textarea, role=button, onclick).
// Writes <out>/candidates.png (numbered overlay) and <out>/candidates.json. A person then decides, by looking, which
// candidates are buttons / inputs / links, and adds anything the overlay missed. The truth comes from what is on
// screen, not from the segmenters being scored.
//   node scripts/label-candidates.mjs --url <url> --out <dir>      or      --serve <dir> --out <dir>
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { chromium } from 'playwright'
import { parseArgs } from '../src/lib/args.js'
import { serveDir } from '../src/lib/serve.js'

const a = parseArgs(process.argv.slice(2))
if (!a.out || (!a.url && !a.serve)) {
  console.error('usage: node scripts/label-candidates.mjs (--url <url> | --serve <dir>) --out <dir>')
  process.exit(2)
}
const out = resolve(a.out)
mkdirSync(out, { recursive: true })
const server = a.serve ? await serveDir(resolve(a.serve)) : null
const url = server ? server.url : a.url

const browser = await chromium.launch({ args: ['--disable-accelerated-2d-canvas', '--disable-gpu'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
  await page.waitForTimeout(800)
  const candidates = await page.evaluate(() => {
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      const tag = el.tagName.toLowerCase()
      const clickable = cs.cursor === 'pointer' || ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
        el.getAttribute('role') === 'button' || el.hasAttribute('onclick')
      if (!clickable || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.top >= 900 || r.right <= 0 || r.left >= 1440) continue
      const box = [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]
      const key = box.join(',')
      if (seen.has(key)) continue // nested elements with the same box (a > span) count once
      seen.add(key)
      out.push({ n: out.length + 1, tag, cls: (el.getAttribute('class') || '').slice(0, 60), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40), bbox: box })
    }
    return out
  })
  // Numbered overlay for the person labeling.
  await page.evaluate((cands) => {
    const layer = document.createElement('div')
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none'
    for (const c of cands) {
      const b = document.createElement('div')
      b.style.cssText = `position:absolute;left:${c.bbox[0]}px;top:${c.bbox[1]}px;width:${c.bbox[2]}px;height:${c.bbox[3]}px;outline:2px solid #e11d48;outline-offset:-1px`
      const t = document.createElement('span')
      t.textContent = c.n
      t.style.cssText = 'position:absolute;left:-2px;top:-14px;background:#e11d48;color:#fff;font:700 11px/13px system-ui;padding:0 3px;border-radius:3px'
      b.appendChild(t)
      layer.appendChild(b)
    }
    document.body.appendChild(layer)
  }, candidates)
  await page.screenshot({ path: join(out, 'candidates.png'), clip: { x: 0, y: 0, width: 1440, height: 900 } })
  writeFileSync(join(out, 'candidates.json'), JSON.stringify({ url, candidates }, null, 1))
  console.log(`${candidates.length} candidates → ${out}`)
} finally {
  await browser.close()
  if (server) await server.close()
}
