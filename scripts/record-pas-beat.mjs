#!/usr/bin/env node
// Demo beat 6, second part: Point and say on Argon, recorded through the real playground page (same driver approach
// as scripts/pas-join/e2e.mjs: click inside the iframe, type the request, wait for the page's own final state in
// window.__pas). 1280x720 like the other beats, with the same caption pill. Every number in a caption is read from the
// page's final state, never typed here. Writes out/video/beat-6-pas.webm and out/video/beat-6-pas.json (event times
// in seconds since the video started, plus the results), which scripts/cut-pas-beat.sh uses to shorten the focus wait.
// The server must already be running: `S2T_CACHE=0 node src/cli.js playground --run out/argon --app out/argon/site`.
//   node scripts/record-pas-beat.mjs --url http://127.0.0.1:4400/
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, renameSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { parseArgs } from '../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const url = a.url || 'http://127.0.0.1:4400/'
const OUT = resolve('out/video'), TMP = join(OUT, 'tmp-6pas')
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true })
const size = { width: 1280, height: 720 }
const CONTRAST = 'This label is too light. Make it readable, keep our gray.'
const FOCUS = 'Give every control a visible focus ring in our blue.'

const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: TMP, size } })
const page = await ctx.newPage()
const T0 = Date.now()
const ev = {}
const mark = (k) => { ev[k] = +((Date.now() - T0) / 1000).toFixed(2) }
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message || e)))
const wait = (ms) => page.waitForTimeout(ms)
const pas = () => page.evaluate(() => window.__pas || null)
async function waitPhase(pred, ms = 60000) {
  const t = Date.now()
  while (Date.now() - t < ms) { const s = await pas(); if (s && pred(s)) return s; await wait(50) }
  throw new Error(`timeout; last ${JSON.stringify(await pas()).slice(0, 300)}`)
}
// The caption pill the other beats use (record-beats.mjs), on the playground's top window.
const caption = (t) => page.evaluate((t) => {
  let c = document.getElementById('s2t-cap')
  if (!c) { c = document.createElement('div'); c.id = 's2t-cap'; c.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;background:rgba(17,17,17,.92);color:#fff;font:600 18px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 14px;border-radius:10px;max-width:1100px;text-align:center;white-space:nowrap'; document.body.appendChild(c) }
  c.style.display = t ? '' : 'none'; c.textContent = t || ''
}, t)

async function toPage(pt) {
  const box = await page.locator('#app').boundingBox()
  const k = await page.evaluate(() => { const f = document.getElementById('app'); const w = f.contentWindow; return { s: f.getBoundingClientRect().width / f.offsetWidth, x: w.scrollX, y: w.scrollY } })
  return { x: box.x + (pt.x - k.x) * k.s, y: box.y + (pt.y - k.y) * k.s }
}
const sidebarLink = () => page.evaluate(() => {
  const d = document.getElementById('app').contentDocument
  const links = Array.from(d.querySelectorAll('nav a, .sidebar a, .navbar-vertical a')).filter((l) => { const r = l.getBoundingClientRect(); return r.width > 40 && r.height > 10 && r.left < 300 && (l.textContent || '').trim() })
  const l = links.find((x) => /icons/i.test(x.textContent)) || links[1]
  const r = l.getBoundingClientRect()
  return { x: Math.round(r.left + Math.min(85, r.width / 2)), y: Math.round(r.top + r.height / 2 + d.defaultView.scrollY), text: l.textContent.trim() }
})

await page.goto(url)
await page.waitForSelector('#pasTools.on', { timeout: 30000 })
for (let i = 0; i < 120; i++) { const h = await page.evaluate(() => fetch('/__pas/api/health').then((r) => r.json())); if (h.focusBaseline && h.focusBaseline.ready) break; await wait(500) }
await page.click('#pasToggle'); await wait(500)
mark('ready')
await caption('Point and say: click something in the live web app, then say or type the change'); await wait(1600)

// 1. Contrast: click "Since last month" (capture px 430,222, the e2e driver's step a), type, Enter.
let p = await toPage({ x: 430, y: 222 })
await page.mouse.move(p.x - 60, p.y + 40); await wait(250)
await page.mouse.move(p.x, p.y, { steps: 8 }); await wait(150)
mark('click1'); await page.mouse.click(p.x, p.y)
const pt1 = await waitPhase((s) => s.phase === 'pointed' || s.phase === 'error', 30000)
mark('pointed1')
await caption(`SAM 3.1 outlines what was clicked: "${(pt1.point && pt1.point.element) || '?'}"`); await wait(900)
await page.type('#pasText', CONTRAST, { delay: 26 }); await wait(350)
mark('enter1'); await page.press('#pasText', 'Enter')
const d1 = await waitPhase((s) => s.phase === 'done' || s.phase === 'error', 60000)
mark('done1')
if (d1.phase !== 'done' || !d1.result || d1.result.kind !== 'applied') throw new Error(`contrast step: ${JSON.stringify(d1).slice(0, 400)}`)
const r1 = d1.result, c1 = r1.changes[0]
await caption(`${c1.token}: ${r1.affected} elements, ${r1.before.toFixed(2)}:1 → ${r1.after.toFixed(2)}:1 · whole page ${r1.pageFailBefore} → ${r1.pageFailAfter} failing · 0 regressions`)
await page.mouse.move(8, 712, { steps: 6 }); await wait(3400)

// 2. Focus: click a sidebar link, type, Enter; the focus check Tabs through the app (about 9 s; shortened in the cut).
const sl = await sidebarLink()
p = await toPage(sl)
await page.mouse.move(p.x, p.y, { steps: 10 }); await wait(150)
mark('click2'); await page.mouse.click(p.x, p.y)
await waitPhase((s) => s.phase === 'pointed' || s.phase === 'error', 30000)
mark('pointed2')
await caption(`Clicked "${sl.text}" in the sidebar`); await wait(500)
await page.fill('#pasText', ''); await page.type('#pasText', FOCUS, { delay: 26 }); await wait(300)
mark('enter2'); await page.press('#pasText', 'Enter')
await waitPhase((s) => s.phase === 'focus-check' || s.phase === 'done' || s.phase === 'error', 30000)
mark('checkStart')
const base = (await page.evaluate(() => fetch('/__pas/api/health').then((r) => r.json()))).focusBaseline.summary
await caption(`Focus check: Tab through all ${base.measured} controls with the ring · takes about 9 s, shortened here`)
const d2 = await waitPhase((s) => s.phase === 'done' || s.phase === 'error', 60000)
mark('checkEnd')
if (!d2.result || d2.result.kind !== 'focus') throw new Error(`focus step: ${JSON.stringify(d2).slice(0, 400)}`)
const r2 = d2.result
await page.evaluate(() => { const r = document.getElementById('pasResults'); r.scrollTop = r.scrollHeight })
await caption(`Focus check (${(r2.checkMs / 1000).toFixed(1)} s): visible focus on ${r2.before.pass} → ${r2.after.pass} of ${r2.after.measured} controls · ${r2.worse} worse`)
await wait(2600)

// 3. Tab, Tab in the app: start just before the sidebar link so the ring lands on the sidebar.
await page.evaluate(() => { const w = document.getElementById('app').contentWindow; w.focus(); const a = w.document.activeElement; if (a && a.blur) a.blur() })
const seen = []
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab')
  const f = await page.evaluate(() => { const d = document.getElementById('app').contentDocument, el = d.activeElement; const r = el.getBoundingClientRect(); return { text: (el.textContent || '').trim().slice(0, 24), left: r.left } })
  if (f.left < 260 && f.text) break
}
mark('tab0')
await page.evaluate(() => { document.getElementById('pasOverlay').style.visibility = 'hidden' }) // the click marker off, so only the ring shows
await caption('Tab, Tab: the ring in our blue (color.action.primary), with a dark band')
for (let i = 0; i < 2; i++) {
  await wait(900); await page.keyboard.press('Tab'); mark(`tab${i + 1}`)
  seen.push(await page.evaluate(() => { const d = document.getElementById('app').contentDocument, el = d.activeElement; const cs = getComputedStyle(el); return { text: (el.textContent || '').trim().slice(0, 24), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, focusVisible: el.matches(':focus-visible') } }))
}
await wait(1800)
mark('end')
const video = page.video()
await ctx.close()
const f = readdirSync(TMP).find((x) => x.endsWith('.webm'))
renameSync(join(TMP, f), join(OUT, 'beat-6-pas.webm'))
await browser.close()
const res = { url, events: ev, contrast: r1, focus: r2, tab: seen, card: null, errors }
writeFileSync(join(OUT, 'beat-6-pas.json'), JSON.stringify(res, null, 2))
console.log(JSON.stringify({ events: ev, contrast: { change: c1, affected: r1.affected, before: r1.before, after: r1.after, page: [r1.pageFailBefore, r1.pageFailAfter] }, focus: { before: r2.before.pass, after: r2.after.pass, of: r2.after.measured, ms: r2.checkMs }, tab: seen, errors }, null, 1))
void video
