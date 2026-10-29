#!/usr/bin/env node
// Short silent clip for the README (captions on screen, no voice): SAM vs DOM, one real run, the diff and the
// three checks, the live preview, the end card. Same method as the FLS README: an mp4 attached through GitHub's
// editor. Reuses the pages scripts/record-beats.mjs wrote under out/video/pages and the run in out/rec-argon.
//   node scripts/record-repo-clip.mjs [--run out/rec-argon] [--apps /path/to/demo-apps] [--only 1]
// --only 1: re-record just the title segment (v3 title card with the payoff loop); rebuild readme-demo.mp4 from the
// seg-<n>.mp4 files (transcode seg-1.webm to seg-1.mp4 first, then concat list.txt with seg-<n>.mp4).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join, resolve } from 'path'
import { chromium } from 'playwright'
import { parseArgs } from '../src/lib/args.js'
import { serveDir } from '../src/lib/serve.js'

const a = parseArgs(process.argv.slice(2))
const RUN = a.run || 'out/rec-argon'
const OUT = resolve('out/video/repo'); mkdirSync(OUT, { recursive: true })
const srv = await serveDir(process.cwd())
const browser = await chromium.launch({ args: ['--disable-gpu'] })
const size = { width: 1280, height: 720 }
const CAPTION = (text) => `(() => { let c = document.getElementById('s2t-cap'); if (!c) { c = document.createElement('div'); c.id = 's2t-cap'; c.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;max-width:88%;background:rgba(17,17,17,.92);color:#fff;font:600 20px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)'; document.body.appendChild(c) } c.textContent = ${JSON.stringify(text)} })()`
const wait = (p, ms) => p.waitForTimeout(ms)
const cap = (p, t) => p.evaluate(CAPTION(t))
const segs = []
const only = a.only ? new Set(String(a.only).split(',').map(Number)) : null
async function seg(n, fn) {
  if (only && !only.has(n)) { segs.push(`seg-${n}.webm`); return }
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: join(OUT, `tmp-${n}`), size } })
  const p = await ctx.newPage()
  try { await fn(p) } finally { await ctx.close() }
  const dir = join(OUT, `tmp-${n}`), f = readdirSync(dir).find((x) => x.endsWith('.webm'))
  renameSync(join(dir, f), join(OUT, `seg-${n}.webm`)); segs.push(`seg-${n}.webm`); console.log(`seg ${n}`)
}
// 1. Title (5 s: the tagline, and one pass of the 4 s payoff loop beside it)
await seg(1, async (p) => { await p.goto(`${srv.url}out/video/pages/title.html`); await wait(p, 5200) })
// 2. SAM vs DOM reveal (9 s)
await seg(2, async (p) => {
  await p.goto(`${srv.url}out/scoreboard.html`, { waitUntil: 'networkidle' }); await cap(p, 'A page with no semantic markup. Page structure finds 0 of 8 buttons. SAM 3.1, from pixels alone, finds 8 of 8.')
  await wait(p, 400); await p.click('#replay'); await wait(p, 6200); await p.evaluate(() => document.querySelector('.headline')?.scrollIntoView({ block: 'start' })); await wait(p, 2200)
})
// 3. One run, terminal at 3x (about 9 s) then the token chips (5 s)
await seg(3, async (p) => {
  const html = readFileSync('out/video/pages/run.html', 'utf-8').replace('const speed=2;', 'const speed=3;').replace('2× replay · real times shown', '3× replay · real times shown')
  writeFileSync('out/video/pages/run3x.html', html)
  await p.goto(`${srv.url}out/video/pages/run3x.html`); await cap(p, 'One command on a real dashboard: SAM 3.1 segments, values cluster, Muse Spark Open (on Baseten) names 86 tokens in 4.9 s. 23 s, under a cent.')
  await p.waitForFunction(() => window.done, null, { timeout: 60000 }); await wait(p, 1200)
  await p.goto(`${srv.url}${RUN}/report.html`, { waitUntil: 'networkidle' }); await cap(p, 'Three tiers, each token with a reason. A person accepts, renames or merges before anything moves.')
  await p.evaluate(() => [...document.querySelectorAll('h3.tier-head')].find((h) => /semantic/.test(h.textContent))?.scrollIntoView({ block: 'start' })); await wait(p, 2600); await p.mouse.wheel(0, 500); await wait(p, 2400)
})
// 4. Diff + verify (10 s)
await seg(4, async (p) => {
  await p.goto(`${srv.url}out/video/pages/diff.html`); await cap(p, 'Every approved value becomes var(--token, original). The old value stays as the fallback.'); await wait(p, 4500)
  await p.goto(`${srv.url}${RUN}/report.html`, { waitUntil: 'networkidle' }); await cap(p, 'Verified by pixels: fallbacks only 0 px · colors 0.000% · the spacing cleanup 0.919%, shown for review.')
  await p.evaluate(() => [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Verify')?.scrollIntoView({ block: 'start' })); await wait(p, 5000)
})
// 5. Live preview in the playground (9 s)
await seg(5, async (p) => {
  await p.goto('https://nhunsaker.github.io/argon-dashboard-react/playground/', { waitUntil: 'networkidle' }); await cap(p, 'Sorb previews a token change in the running app before anyone merges. Change color.blue.500 and every alias follows.')
  await wait(p, 1500); await p.fill('#search', 'blue.500')
  const app = p.frame({ url: /\/tokens\// }) || p.frames()[1]
  if (app) await app.evaluate(() => { const el = [...document.querySelectorAll('a,button')].find((x) => x.textContent.trim().startsWith('Month')); if (el) el.scrollIntoView({ block: 'center' }) })
  await wait(p, 800)
  for (const c of ['#2dce89', '#f5365c', '#8965e0', '#5e72e4']) { await p.evaluate((v) => { const i = document.querySelector('[data-var="color-blue-500"] input[type=color]'); if (i) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })) } }, c); await wait(p, 1300) }
})
// 6. Breadth table (6 s) and end card (6 s)
await seg(6, async (p) => {
  await p.goto(`${srv.url}out/video/pages/breadth.html`); await cap(p, '28 public sites we didn\'t build: 2,313 values rewritten; 0 px changed on 23 of 23 stable sites with edits.'); await wait(p, 6000)
  await p.goto(`${srv.url}out/video/pages/end.html`); await wait(p, 6500)
})
await browser.close(); await srv.close()
writeFileSync(join(OUT, 'list.txt'), segs.map((s) => `file '${s}'`).join('\n') + '\n')
console.log('segments →', OUT)
