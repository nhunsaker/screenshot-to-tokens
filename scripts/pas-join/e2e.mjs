// Point and say, join step: end to end through the PAGE (playground.html in Chromium), not the endpoints. Each step
// clicks the real app inside the playground's iframe, types or speaks (Chromium's fake mic plays a WAV) the request,
// and waits for the page's own final state (window.__pas, set by playground.html). Wall time = click to final state.
// The server must already be running: `S2T_CACHE=0 node src/cli.js playground --run out/argon --app out/argon/site`.
// Usage: node scripts/pas-join/e2e.mjs --url http://127.0.0.1:4481/ --steps a,c,d --reps 3 [--wav out/phrases/a.wav]
//        [--shots out/pas-join] [--video out/pas-join/video] [--out out/pas-join/argon.json]
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join, resolve } from 'path'
import { parseArgs } from '../../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const url = a.url || 'http://127.0.0.1:4481/'
const shots = resolve(a.shots || 'out/pas-join')
const reps = Number(a.reps || 1)
const pace = !!a.pace
mkdirSync(shots, { recursive: true })

// Steps. `at` = capture-space page px (1440 wide); `find` = locate the click target in the iframe's DOM instead.
const STEPS = {
  a: { app: 'argon', name: 'contrast-typed', at: { x: 430, y: 222 }, text: 'This label is too light. Make it readable, keep our gray.' },
  b: { app: 'argon', name: 'contrast-voice', at: { x: 430, y: 222 }, voice: true },
  c: { app: 'argon', name: 'focus-typed', find: 'sidebar', text: 'Give every control a visible focus ring in our blue.', tab: true },
  d: { app: 'argon', name: 'blocked-red', at: { x: 873, y: 328 }, text: 'Make these buttons red.' },
  e: { app: 'lightbootstrap', name: 'contrast-number', at: { x: 460, y: 133 }, text: 'This label is too light. Make it readable, keep our gray.' },
  f: { app: 'lightbootstrap', name: 'blocked-brand-blue', at: { x: 1161, y: 38 }, text: 'Make these buttons our brand blue.' },
  g: { app: 'lightbootstrap', name: 'focus-nearest-hue', at: { x: 460, y: 133 }, text: 'Give every control a visible focus ring in our blue.', tab: true },
}

const wavMs = (file) => { const b = readFileSync(file); return Math.round(((b.length - 44) / 2 / b.readUInt32LE(24)) * 1000) }
const args = ['--autoplay-policy=no-user-gesture-required']
if (a.wav) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(a.wav)}`)
const browser = await chromium.launch({ channel: 'chromium', args })
const vw = Number(a.width || 1440), vh = Number(a.height || 900)
const context = await browser.newContext({ viewport: { width: vw, height: vh }, ...(a.video ? { recordVideo: { dir: resolve(a.video), size: { width: vw, height: vh } } } : {}), permissions: ['microphone'] })
const page = await context.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

const shot = async (name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f }); return f }
const pasState = () => page.evaluate(() => window.__pas || null)
async function waitPhase(pred, ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await pasState()
    if (s && pred(s)) return s
    await page.waitForTimeout(50)
  }
  throw new Error(`timeout waiting for state; last ${JSON.stringify(await pasState()).slice(0, 300)}`)
}

// Open the playground, wait for the focus baseline (the server warms it at startup), turn point and say on.
await page.goto(url)
await page.waitForSelector('#pasTools.on', { timeout: 30000 })
for (let i = 0; i < 120; i++) {
  const h = await page.evaluate(() => fetch('/__pas/api/health').then((r) => r.json()))
  if (h.focusBaseline && h.focusBaseline.ready) break
  await page.waitForTimeout(500)
}
await page.click('#pasToggle')
await page.waitForTimeout(600)

/** Page coordinates (top window) for a capture-space point in the iframe. */
async function toPage(pt) {
  const box = await page.locator('#app').boundingBox()
  const scale = await page.evaluate(() => { const f = document.getElementById('app'); return f.getBoundingClientRect().width / f.offsetWidth })
  const scroll = await page.evaluate(() => { const w = document.getElementById('app').contentWindow; return { x: w.scrollX, y: w.scrollY } })
  return { x: box.x + (pt.x - scroll.x) * scale, y: box.y + (pt.y - scroll.y) * scale, scale }
}
async function findTarget(kind) {
  if (kind === 'sidebar') {
    return page.evaluate(() => {
      const d = document.getElementById('app').contentDocument
      const links = Array.from(d.querySelectorAll('nav a, .sidebar a, .navbar-vertical a')).filter((l) => { const r = l.getBoundingClientRect(); return r.width > 40 && r.height > 10 && r.left < 300 && (l.textContent || '').trim() })
      const l = links.find((x) => /icons|maps|tables|profile/i.test(x.textContent)) || links[1] || links[0]
      const r = l.getBoundingClientRect()
      return { x: Math.round(r.left + Math.min(85, r.width / 2)), y: Math.round(r.top + r.height / 2 + d.defaultView.scrollY), text: l.textContent.trim() }
    })
  }
  throw new Error(`unknown target ${kind}`)
}
async function resetAll() {
  await page.evaluate(() => { const b = document.getElementById('reset'); if (b && !b.disabled) b.click(); else if (window.__pasReset) window.__pasReset() })
  await page.waitForTimeout(300)
}

const rows = []
for (const id of String(a.steps || 'a').split(',')) {
  const st = STEPS[id]
  for (let rep = 1; rep <= reps; rep++) {
    await resetAll()
    const tag = `${st.app}-${id}-${st.name}${reps > 1 ? `-r${rep}` : ''}`
    let target = st.at ? { ...st.at } : await findTarget(st.find)
    // Move 3 capture px per repeat so the server's click cache does not answer (SAM + sentinel re-run each time).
    target = { ...target, x: target.x + (rep - 1) * 3, y: target.y }
    const p = await toPage(target)
    const t0 = Date.now()
    await page.mouse.click(p.x, p.y)
    const pointed = await waitPhase((s) => s.phase === 'pointed' || s.phase === 'error', 30000)
    const tPointed = Date.now()
    if (rep === 1) await shot(`${tag}-1-overlay`)
    let tSpeechEnd = null
    if (st.voice) {
      const ms = wavMs(resolve(a.wav))
      const mic = await page.locator('#pasMic').boundingBox()
      await page.mouse.move(mic.x + mic.width / 2, mic.y + mic.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(Math.max(500, ms - 900)) // fake device plays from the start; release in the tail silence
      if (rep === 1) await shot(`${tag}-2-recording`)
      await page.mouse.up()
      tSpeechEnd = Date.now()
      await waitPhase((s) => !!s.transcript && s.phase !== 'transcribing' || s.phase === 'error', 30000)
      if (rep === 1) await shot(`${tag}-3-transcript`)
    } else {
      // --pace (the demo video): type at a readable speed; the wall time then includes typing.
      if (pace) { await page.waitForTimeout(900); await page.type('#pasText', st.text, { delay: 28 }) } else await page.fill('#pasText', st.text)
      await page.press('#pasText', 'Enter')
    }
    const done = await waitPhase((s) => s.phase === 'done' || s.phase === 'error', 60000)
    const tDone = Date.now()
    if (pace) await page.waitForTimeout(2500)
    await page.evaluate(() => { const r = document.getElementById('pasResults'); r.scrollTop = r.scrollHeight })
    await page.waitForTimeout(350) // past any app transition, so the pixels are the end state
    if (rep === 1) await shot(`${tag}-4-card`)
    await page.mouse.move(5, vh - 5) // off the app: no hover colour in the end-state read
    await page.waitForTimeout(300)
    const clicked = await page.evaluate((t) => {
      const d = document.getElementById('app').contentDocument, w = d.defaultView
      let el = d.elementFromPoint(t.x - w.scrollX, t.y - w.scrollY)
      if (!el) return null
      const ctl = el.closest('a.btn, button, .btn') || el
      const cs = getComputedStyle(el), cc = getComputedStyle(ctl)
      return { text: (el.textContent || '').trim().slice(0, 30), color: cs.color, controlBg: cc.backgroundColor }
    }, target)
    // Proof of the end state in the iframe itself.
    const live = await page.evaluate(() => {
      const d = document.getElementById('app').contentDocument
      const r = d.documentElement.style
      const vars = {}
      for (let i = 0; i < r.length; i++) if (r[i].startsWith('--')) vars[r[i]] = r.getPropertyValue(r[i]).trim()
      return { vars, rule: !!d.getElementById('s2t-pas-focus-rule') && d.getElementById('s2t-pas-focus-rule').textContent.length > 0, path: d.location.pathname, card: document.getElementById('pasResults').innerText }
    })
    let tab = null
    if (st.tab && done.result && done.result.kind === 'focus') {
      // Tab in the iframe: focus its window, press Tab until a sidebar/nav control has focus, read its outline.
      await page.evaluate(() => { const w = document.getElementById('app').contentWindow; w.focus(); w.document.activeElement && w.document.activeElement.blur && w.document.activeElement.blur() })
      const seen = []
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab')
        await page.waitForTimeout(pace ? 700 : 150)
        seen.push(await page.evaluate(() => {
          const d = document.getElementById('app').contentDocument, el = d.activeElement
          if (!el || el === d.body) return null
          const cs = getComputedStyle(el)
          return { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 30), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow.slice(0, 60), focusVisible: el.matches(':focus-visible') }
        }))
      }
      tab = seen
      if (rep === 1) await shot(`${tag}-5-tab-ring`)
      if (pace) { await page.keyboard.press('Tab'); await page.waitForTimeout(700); await page.keyboard.press('Tab'); await page.waitForTimeout(2000) }
    }
    const row = {
      step: id, app: st.app, name: st.name, rep, target, transcript: done.transcript, route: done.intent && done.intent.route,
      result: done.result, error: done.error || null, summary: done.intent && done.intent.summary,
      point: pointed.point, clicked, live: { vars: live.vars, focusRule: live.rule, iframePath: live.path }, tab,
      ms: { wall: tDone - t0, point: tPointed - t0, afterSpeech: tSpeechEnd ? tDone - tSpeechEnd : null, asr: done.asrMs || null, intent: done.intent && done.intent.ms, model: done.intent && done.intent.model ? done.intent.model.ms : null, focusCheck: done.result && done.result.checkMs || null },
    }
    rows.push(row)
    console.log(`${id} #${rep} ${st.app}/${st.name}: ${done.phase} ${JSON.stringify(done.result).slice(0, 260)} | wall ${row.ms.wall} ms (point ${row.ms.point}${row.ms.afterSpeech ? `, after speech ${row.ms.afterSpeech}` : ''})${tab ? ` | tab ${JSON.stringify(tab.filter(Boolean).slice(-1))}` : ''}`)
    if (rep === 1 && /a|e/.test(id) && done.result && done.result.kind === 'applied') {
      await page.click('#pasShowPr').catch(() => {})
      await page.waitForTimeout(200)
      await shot(`${tag}-6-pr-command`)
    }
  }
}

// Reset all must clear point and say's state too (outline, card, focus rule, applied vars). Not in the video take.
if (!pace) await resetAll()
const afterReset = pace ? null : await page.evaluate(() => {
  const d = document.getElementById('app').contentDocument
  return { overlay: document.getElementById('pasOverlay').children.length, card: document.getElementById('pasResults').innerText.trim(), rule: !!d.getElementById('s2t-pas-focus-rule'), vars: Array.from(d.documentElement.style).filter((k) => k.startsWith('--')), phase: window.__pas && window.__pas.phase }
})
console.log(`after reset: ${JSON.stringify(afterReset)}`)
if (consoleErrors.length) console.log(`console errors: ${consoleErrors.slice(0, 5).join(' | ')}`)
const out = resolve(a.out || join(shots, `e2e-${Date.now()}.json`))
writeFileSync(out, JSON.stringify({ url, rows, afterReset, consoleErrors }, null, 2))
console.log(`wrote ${out}`)
const video = page.video()
await context.close()
if (video && a.videoOut) { copyFileSync(await video.path(), resolve(a.videoOut)); console.log(`video ${a.videoOut}`) }
await browser.close()
