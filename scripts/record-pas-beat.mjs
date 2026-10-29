#!/usr/bin/env node
// Demo beat 6, second part: Point and say on Argon, recorded through the real playground page (same driver approach
// as scripts/pas-join/e2e.mjs: click inside the iframe, speak or type the request, wait for the page's own final
// state in window.__pas). 1280x720 like the other beats, with the same caption pill. Every number in a caption is read
// from the page's final state, never typed here. The server must already be running:
//   S2T_CACHE=0 node src/cli.js playground --run out/argon --app <tokenized Argon build>
//
// Typed (the v2 cut): one session, both requests typed.
//   node scripts/record-pas-beat.mjs --url http://127.0.0.1:4400/
//   → out/video/beat-6-pas.webm + beat-6-pas.json (event times in seconds since the video started, plus results)
// Voice (the v3 cut): --voice <dir with req-1.wav, req-2.wav> (scripts/make-requests.sh). Chromium's fake mic restarts
// its one file on every getUserMedia, so each spoken request gets its own browser session:
//   session 1 (fake mic = req-1.wav): click "Since last month", hold to talk, Meta's speech model transcribes, the
//     contrast change lands.
//   session 2 (fake mic = req-2.wav): the contrast change re-applied off camera (typed; the cut starts after it), click
//     a sidebar link, hold to talk, the focus check, Tab, Tab with the ring; then the blocked case: click "Month",
//     type "make these buttons red", BLOCKED and reverted.
//   node scripts/record-pas-beat.mjs --url http://127.0.0.1:4400/ --voice out/video/req
//   → out/video/beat-6-pas-v1.webm, beat-6-pas-v2.webm, beat-6-pas-v3.json (events per session, mic down/up times so
//     the cut can lay the request audio where it was "spoken", transcripts, results). scripts/cut-pas-beat.py --v3 cuts it.
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { parseArgs } from '../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const url = a.url || 'http://127.0.0.1:4400/'
const OUT = resolve('out/video')
const size = { width: 1280, height: 720 }
const CONTRAST = 'This label is too light. Make it readable, keep our gray.'
const FOCUS = 'Give every control a visible focus ring in our blue.'
const RED = 'make these buttons red'
const MONTH = { x: 873, y: 328 } // capture px of Argon's "Month" button (e2e step d)
const SINCE = { x: 430, y: 222 } // capture px of "Since last month" (e2e step a)
const wavMs = (file) => { const b = readFileSync(file); return Math.round(((b.length - 44) / 2 / b.readUInt32LE(24)) * 1000) }

async function session(wav, tmpName) {
  const TMP = join(OUT, tmpName)
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true })
  const args = ['--disable-gpu']
  if (wav) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(wav)}`)
  const browser = await chromium.launch({ channel: 'chromium', args })
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: TMP, size }, ...(wav ? { permissions: ['microphone'] } : {}) })
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
  async function clickAt(pt, k, approach) {
    const p = await toPage(pt)
    if (approach) { await page.mouse.move(p.x - 60, p.y + 40); await wait(250) }
    await page.mouse.move(p.x, p.y, { steps: approach ? 8 : 10 }); await wait(150)
    mark(k); await page.mouse.click(p.x, p.y)
    return waitPhase((s) => s.phase === 'pointed' || s.phase === 'error', 30000)
  }
  async function typed(text, k) {
    await page.fill('#pasText', ''); await page.type('#pasText', text, { delay: 26 }); await wait(300)
    mark(k); await page.press('#pasText', 'Enter')
  }
  // Hold to talk while the fake mic plays the WAV from its start; release in its tail silence (as e2e.mjs does).
  async function spoken(n) {
    const mic = await page.locator('#pasMic').boundingBox()
    await page.mouse.move(mic.x + mic.width / 2, mic.y + mic.height / 2, { steps: 8 }); await wait(200)
    mark(`micDown${n}`); const tDown = Date.now(); await page.mouse.down()
    await wait(Math.max(500, wavMs(resolve(wav)) - 1100)) // 0.4 s after the speech ends (1.5 s of tail silence)
    mark(`micUp${n}`); await page.mouse.up()
    // This recording's transcript, not an earlier one still in the state (speechEndAt is set when the mic is released).
    const s = await waitPhase((s) => (s.speechEndAt > tDown && !!s.transcript && s.phase !== 'transcribing') || s.phase === 'error', 30000)
    mark(`transcript${n}`)
    if (s.phase === 'error') throw new Error(`speech ${n}: ${s.error}`)
    await caption(`Meta's speech model: “${s.transcript}”`)
    return s.transcript
  }
  async function start() {
    await page.goto(url)
    await page.waitForSelector('#pasTools.on', { timeout: 30000 })
    for (let i = 0; i < 120; i++) { const h = await page.evaluate(() => fetch('/__pas/api/health').then((r) => r.json())); if (h.focusBaseline && h.focusBaseline.ready) break; await wait(500) }
    // Voice take: keep the bottom-left 210 px clear for the founder's camera bubble (the panel's long hints and the
    // token filter are hidden so the result card still fits above it). Layout only; nothing the checks read changes.
    if (wav) await page.addStyleTag({ content: 'aside{padding-bottom:210px} #toolsHint,#search,#provider,#pasHint,aside .list{display:none!important} #pasResults{max-height:none!important;flex:1 1 auto;min-height:0}' })
    await page.click('#pasToggle'); await wait(500)
  }
  async function finish(file) {
    await ctx.close()
    const f = readdirSync(TMP).find((x) => x.endsWith('.webm'))
    renameSync(join(TMP, f), join(OUT, file))
    rmSync(TMP, { recursive: true, force: true })
    await browser.close()
  }
  return { page, ev, mark, errors, wait, waitPhase, caption, toPage, sidebarLink, clickAt, typed, spoken, start, finish }
}

function contrastCaption(r1) {
  const c1 = r1.changes[0]
  return `${c1.token}: ${r1.affected} elements, ${r1.before.toFixed(2)}:1 → ${r1.after.toFixed(2)}:1 · whole page ${r1.pageFailBefore} → ${r1.pageFailAfter} failing · 0 regressions`
}
function checkContrast(d1) {
  if (d1.phase !== 'done' || !d1.result || d1.result.kind !== 'applied') throw new Error(`contrast step: ${JSON.stringify(d1).slice(0, 400)}`)
  return d1.result
}
// Focus: the check Tabs through the app (about 9 s; shortened in the cut), then Tab, Tab in the app with the ring.
async function focusAndTab(s, sl) {
  await s.waitPhase((x) => x.phase === 'focus-check' || x.phase === 'done' || x.phase === 'error', 30000)
  s.mark('checkStart')
  const base = (await s.page.evaluate(() => fetch('/__pas/api/health').then((r) => r.json()))).focusBaseline.summary
  await s.wait(700)
  await s.caption(`Focus check: Tab through all ${base.measured} controls with the ring · takes about 9 s, shortened here`)
  const d2 = await s.waitPhase((x) => x.phase === 'done' || x.phase === 'error', 60000)
  s.mark('checkEnd')
  if (!d2.result || d2.result.kind !== 'focus') throw new Error(`focus step: ${JSON.stringify(d2).slice(0, 400)}`)
  const r2 = d2.result
  await s.page.evaluate(() => { const r = document.getElementById('pasResults'), sc = r.querySelector('.score'); if (sc) r.scrollTop = Math.max(0, sc.offsetTop - r.offsetTop - 70); else r.scrollTop = r.scrollHeight })
  await s.caption(`Focus check (${(r2.checkMs / 1000).toFixed(1)} s): visible focus on ${r2.before.pass} → ${r2.after.pass} of ${r2.after.measured} controls · ${r2.worse} worse`)
  await s.wait(2600)
  const page = s.page
  await page.evaluate(() => { const w = document.getElementById('app').contentWindow; w.focus(); const a = w.document.activeElement; if (a && a.blur) a.blur() })
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    const f = await page.evaluate(() => { const d = document.getElementById('app').contentDocument, el = d.activeElement; const r = el.getBoundingClientRect(); return { text: (el.textContent || '').trim().slice(0, 24), left: r.left } })
    if (f.left < 260 && f.text) break
  }
  s.mark('tab0')
  await page.evaluate(() => { document.getElementById('pasOverlay').style.visibility = 'hidden' }) // the click marker off, so only the ring shows
  await s.caption('Tab, Tab: the ring in our blue (color.action.primary), with a dark band')
  const seen = []
  for (let i = 0; i < 2; i++) {
    await s.wait(900); await page.keyboard.press('Tab'); s.mark(`tab${i + 1}`)
    seen.push(await page.evaluate(() => { const d = document.getElementById('app').contentDocument, el = d.activeElement; const cs = getComputedStyle(el); return { text: (el.textContent || '').trim().slice(0, 24), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, focusVisible: el.matches(':focus-visible') } }))
  }
  await s.wait(1800)
  return { r2, seen, sidebar: sl.text }
}

if (!a.voice) {
  // Typed take (v2).
  const s = await session(null, 'tmp-6pas')
  await s.start(); s.mark('ready')
  await s.caption('Point and say: click something in the live web app, then say or type the change'); await s.wait(1600)
  const pt1 = await s.clickAt(SINCE, 'click1', true); s.mark('pointed1')
  await s.caption(`SAM 3.1 outlines what was clicked: "${(pt1.point && pt1.point.element) || '?'}"`); await s.wait(900)
  await s.typed(CONTRAST, 'enter1')
  const r1 = checkContrast(await s.waitPhase((x) => x.phase === 'done' || x.phase === 'error', 60000)); s.mark('done1')
  await s.caption(contrastCaption(r1))
  await s.page.mouse.move(8, 712, { steps: 6 }); await s.wait(3400)
  const sl = await s.sidebarLink()
  await s.clickAt(sl, 'click2'); s.mark('pointed2')
  await s.caption(`Clicked "${sl.text}" in the sidebar`); await s.wait(500)
  await s.typed(FOCUS, 'enter2')
  const f = await focusAndTab(s, sl)
  s.mark('end')
  await s.finish('beat-6-pas.webm')
  writeFileSync(join(OUT, 'beat-6-pas.json'), JSON.stringify({ url, events: s.ev, contrast: r1, focus: f.r2, tab: f.seen, card: null, errors: s.errors }, null, 2))
  console.log(JSON.stringify({ events: s.ev, contrast: { affected: r1.affected, before: r1.before, after: r1.after, page: [r1.pageFailBefore, r1.pageFailAfter] }, focus: { before: f.r2.before.pass, after: f.r2.after.pass, of: f.r2.after.measured, ms: f.r2.checkMs }, tab: f.seen, errors: s.errors }, null, 1))
} else {
  const dir = resolve(a.voice)
  // Session 1: the contrast request, spoken.
  const s1 = await session(join(dir, 'req-1.wav'), 'tmp-6pas-v1')
  await s1.start(); s1.mark('ready')
  await s1.caption('Point and say: click something in the live web app, then say or type the change'); await s1.wait(1600)
  const pt1 = await s1.clickAt(SINCE, 'click1', true); s1.mark('pointed1')
  await s1.caption(`SAM 3.1 outlines what was clicked: "${(pt1.point && pt1.point.element) || '?'}"`); await s1.wait(900)
  const t1 = await s1.spoken(1)
  const r1 = checkContrast(await s1.waitPhase((x) => x.phase === 'done' || x.phase === 'error', 60000)); s1.mark('done1')
  await s1.wait(900)
  await s1.caption(contrastCaption(r1)); s1.mark('cap1')
  await s1.page.mouse.move(8, 712, { steps: 6 }); await s1.wait(3400)
  s1.mark('end')
  await s1.finish('beat-6-pas-v1.webm')

  // Session 2: contrast re-applied off camera, then the focus request spoken, then the blocked case typed.
  const s2 = await session(join(dir, 'req-2.wav'), 'tmp-6pas-v2')
  await s2.start()
  await s2.clickAt(SINCE, 'preClick')
  await s2.page.fill('#pasText', CONTRAST); await s2.page.press('#pasText', 'Enter')
  const r1b = checkContrast(await s2.waitPhase((x) => x.phase === 'done' || x.phase === 'error', 60000))
  await s2.caption(contrastCaption(r1b))
  await s2.page.mouse.move(8, 712); await s2.wait(800)
  s2.mark('ready')
  const sl = await s2.sidebarLink()
  await s2.clickAt(sl, 'click2'); s2.mark('pointed2')
  await s2.caption(`Clicked "${sl.text}" in the sidebar`); await s2.wait(500)
  const t2 = await s2.spoken(2)
  const f = await focusAndTab(s2, sl)
  // Blocked: "Month", typed.
  await s2.page.evaluate(() => { document.getElementById('pasOverlay').style.visibility = '' })
  await s2.caption('')
  const pt3 = await s2.clickAt(MONTH, 'click3'); s2.mark('pointed3')
  await s2.caption(`Clicked "${(pt3.point && pt3.point.element) || '?'}"`); await s2.wait(400)
  await s2.typed(RED, 'enter3')
  const d3 = await s2.waitPhase((x) => x.phase === 'done' || x.phase === 'error', 60000); s2.mark('done3')
  if (!d3.result || d3.result.kind !== 'blocked') throw new Error(`blocked step: ${JSON.stringify(d3).slice(0, 400)}`)
  const m = /on [“"]([^”"]+)[”"] \(([\d.]+):1 → ([\d.]+):1\)/.exec(d3.result.message) || []
  await s2.caption(`Blocked: contrast on "${m[1]}" would regress (${m[2]}:1 → ${m[3]}:1). Reverted.`)
  await s2.page.evaluate(() => { const r = document.getElementById('pasResults'); r.scrollTop = 0 })
  await s2.page.mouse.move(8, 712, { steps: 6 })
  const reverted = await s2.page.evaluate(() => Array.from(document.getElementById('app').contentDocument.documentElement.style).filter((k) => k.startsWith('--')))
  await s2.wait(2600)
  s2.mark('end')
  await s2.finish('beat-6-pas-v2.webm')
  const res = { url, s1: { events: s1.ev, transcript: t1, contrast: r1, errors: s1.errors }, s2: { events: s2.ev, transcript: t2, focus: f.r2, tab: f.seen, sidebar: f.sidebar, blocked: { message: d3.result.message, element: m[1], before: m[2], after: m[3], overridesLeft: reverted }, errors: s2.errors } }
  writeFileSync(join(OUT, 'beat-6-pas-v3.json'), JSON.stringify(res, null, 2))
  console.log(JSON.stringify({ t1, t2, contrast: { affected: r1.affected, before: r1.before, after: r1.after, page: [r1.pageFailBefore, r1.pageFailAfter], token: r1.changes[0] }, focus: { before: f.r2.before.pass, after: f.r2.after.pass, of: f.r2.after.measured }, blocked: res.s2.blocked, ev1: s1.ev, ev2: s2.ev, errors: [...s1.errors, ...s2.errors] }, null, 1))
}
