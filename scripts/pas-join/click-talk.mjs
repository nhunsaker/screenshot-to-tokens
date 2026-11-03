import { chromium } from 'playwright'
const wav = process.argv[2], url = process.argv[3]
const b = await chromium.launch({ channel: 'chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto(url); await p.waitForFunction(() => window.__pas && window.__pas.phase === 'ready', null, { timeout: 30000 }).catch(() => {})
await p.locator('#pasToggle').click(); const mic = p.locator('#pasMic')
await mic.click() // tap → click-to-talk
await p.waitForTimeout(800); const l1 = await mic.textContent()
await p.waitForTimeout(4500)
await mic.click() // second click sends
await p.waitForFunction(() => window.__pas && window.__pas.transcript, null, { timeout: 20000 }).catch(() => {})
const s = await p.evaluate(() => window.__pas)
console.log(JSON.stringify({ labelWhileRecording: l1, recordedMs: s.recordedMs, transcript: s.transcript }))
await b.close()
