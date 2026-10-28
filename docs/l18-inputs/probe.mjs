// Focus-visibility probe: Tab through a page; for each focused control compare the focused vs blurred pixels in a
// box around it. WCAG 2.4.13-style numbers: changed area (vs a 2 CSS px perimeter of the control) and the contrast
// of the change (luminance ratio between focused and unfocused colour of the changed pixels).
import { writeFileSync } from 'fs'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'
import { serveDir } from '../../src/lib/serve.js'

const [dir, name, maxTabs = 80, outDir = 'out/focustest'] = process.argv.slice(2)
const srv = await serveDir(dir)
const browser = await chromium.launch({ args: ['--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto(srv.url, { waitUntil: 'networkidle' })
await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
await page.waitForTimeout(800)
const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const out = [], seen = new Set()
for (let i = 0; i < Number(maxTabs); i++) {
  await page.keyboard.press('Tab')
  await page.waitForTimeout(60)
  const info = await page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    if (el.dataset.s2tSeen) return { wrapped: true }
    el.dataset.s2tSeen = '1'
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    return { tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30), x: r.left, y: r.top, w: r.width, h: r.height, page: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)], fv: el.matches(':focus-visible') }
  })
  if (!info) continue
  if (info.wrapped) break // back at the first stop
  if (info.w < 2 || info.h < 2) { out.push({ ...info, skipped: 'zero size' }); continue }
  await page.waitForTimeout(80)
  const pad = 8
  const clip = { x: Math.max(0, info.x - pad), y: Math.max(0, info.y - pad), width: Math.min(1440, info.w + 2 * pad), height: Math.min(900, info.h + 2 * pad) }
  clip.width = Math.min(clip.width, 1440 - clip.x); clip.height = Math.min(clip.height, 900 - clip.y)
  if (clip.x >= 1440 || clip.y >= 900 || clip.width < 4 || clip.height < 4 || info.y + info.h < 0) { out.push({ ...info, skipped: 'offscreen' }); continue }
  let focused
  try { focused = PNG.sync.read(await page.screenshot({ clip })) } catch (e) { out.push({ ...info, skipped: 'offscreen' }); continue }
  // Blur without moving the Tab position: remember the element, blur it, shoot, refocus via keyboard order later.
  await page.evaluate(() => { window.__last = document.activeElement; document.activeElement.blur() })
  await page.waitForTimeout(80)
  const blurred = PNG.sync.read(await page.screenshot({ clip }))
  await page.evaluate(() => { const el = window.__last; if (el) el.focus({ preventScroll: true }) })
  // Changed pixels and the contrast of the change.
  let changed = 0, strong = 0
  for (let k = 0; k < focused.data.length; k += 4) {
    const a = focused.data, b = blurred.data
    const dr = Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2])
    if (dr > 30) { changed++; if (ratio(lum(a[k], a[k + 1], a[k + 2]), lum(b[k], b[k + 1], b[k + 2])) >= 3) strong++ }
  }
  const perimeter2px = 2 * (info.w + info.h) * 2 // a 2 CSS px solid perimeter
  out.push({ tag: info.tag, text: info.text, page: info.page, fv: info.fv, changed, strong, perimeter2px: Math.round(perimeter2px), visible: changed >= perimeter2px * 0.5, passes: strong >= perimeter2px })
}
await browser.close(); await srv.close()
writeFileSync(`${outDir}/${name}.json`, JSON.stringify(out, null, 1))
const ok = out.filter((r) => !r.skipped)
console.log(`${name}: ${out.length} tab stops, ${ok.length} measured; visible change ${ok.filter((r) => r.visible).length}; meets 2.4.13 (area >= 2px perimeter at >= 3:1) ${ok.filter((r) => r.passes).length}; no change at all ${ok.filter((r) => r.changed === 0).length}`)
if (process.env.FOCUS_VERBOSE) for (const r of out.slice(0, 40)) console.log(`  ${r.tag.padEnd(6)} ${(r.text || '').padEnd(24)} ${r.skipped ? r.skipped : `changed ${String(r.changed).padStart(5)} strong ${String(r.strong).padStart(5)} need ${String(r.perimeter2px).padStart(4)} ${r.passes ? 'PASS' : r.visible ? 'weak' : 'NONE'}`}`)
