// Point and say, join step: the iframe survives a hard reload of the route the app's router pushed (Argon pushes
// /admin/index; the playground serves the app only under /app/). Reload, then check the frame is back on the app and
// point and say still captures a click (the hooks are re-attached on every load).
// Usage: node scripts/pas-join/reload-check.mjs --url http://127.0.0.1:4481/ --x 430 --y 222
import { chromium } from 'playwright'
import { parseArgs } from '../../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(a.url || 'http://127.0.0.1:4481/')
await page.waitForSelector('#pasTools.on', { timeout: 30000 })
await page.click('#pasToggle')
await page.waitForTimeout(500)
const path = () => page.evaluate(() => document.getElementById('app').contentDocument.location.pathname)
const before = await path()
await page.evaluate(() => document.getElementById('app').contentWindow.location.reload())
await page.waitForTimeout(3000)
const after = await path()
const appText = await page.evaluate(() => document.getElementById('app').contentDocument.body.innerText.slice(0, 60).replace(/\s+/g, ' '))
const box = await page.locator('#app').boundingBox()
const scale = await page.evaluate(() => { const f = document.getElementById('app'); return f.getBoundingClientRect().width / f.offsetWidth })
await page.mouse.click(box.x + Number(a.x || 430) * scale, box.y + Number(a.y || 222) * scale)
await page.waitForFunction(() => window.__pas && (window.__pas.phase === 'pointed' || window.__pas.phase === 'error'), null, { timeout: 30000 })
const st = await page.evaluate(() => ({ phase: window.__pas.phase, point: window.__pas.point, overlay: document.getElementById('pasOverlay').children.length }))
console.log(JSON.stringify({ before, after, appText, afterReloadClick: st }))
await browser.close()
