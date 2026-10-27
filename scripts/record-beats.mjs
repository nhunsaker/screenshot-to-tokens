#!/usr/bin/env node
// Draft video beats for the demo (docs/demo-script.md), recorded headless with Playwright at 1280x720. Every number on
// screen comes from a real run folder; terminal beats replay the real output of that run at its real stage timings.
// Writes out/video/beat-<n>.webm. A person adds the voiceover and cuts the final video.
//   node scripts/record-beats.mjs [--run out/rec-argon] [--only 1,3]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join, resolve } from 'path'
import { chromium } from 'playwright'
import { parseArgs } from '../src/lib/args.js'
import { serveDir } from '../src/lib/serve.js'

const a = parseArgs(process.argv.slice(2))
const RUN = a.run || 'out/rec-argon'
const OUT = resolve('out/video'), PAGES = join(OUT, 'pages')
mkdirSync(PAGES, { recursive: true })
const only = a.only ? new Set(String(a.only).split(',').map(Number)) : null
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const BASE_CSS = 'body{margin:0;background:#1e1e1e;color:#d4d4d4;font:17px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:28px 36px}.p{color:#9cdcfe}.p b{color:#c586c0;font-weight:400}.o{white-space:pre;opacity:0}.o.show{opacity:1}.ok{color:#6ad38b}.hl{background:#2d4a2f;outline:1px solid #6ad38b}'

// Beat 1: the stylesheet, one declaration per line, hex codes and px values highlighted.
function editorPage() {
  const dir = '/Volumes/SanDisk/s2t-demo-apps/argon/build/static/css'
  const css = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.css'))), 'utf-8')
  const lines = css.slice(css.indexOf('.btn'), css.indexOf('.btn') + 60000).replace(/\{/g, ' {\n  ').replace(/;/g, ';\n  ').replace(/\}/g, '\n}\n').split('\n').filter((l) => l.trim()).slice(0, 420)
  const body = lines.map((l, i) => `<div><span class="n">${i + 1}</span>${esc(l).replace(/(#[0-9a-fA-F]{3,8}\b)/g, '<span class="hex">$1</span>').replace(/(\b\d+(?:\.\d+)?(?:px|rem)\b)/g, '<span class="px">$1</span>')}</div>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1e1e1e;color:#d4d4d4;font:15px/1.5 ui-monospace,Menlo,monospace}.bar{position:fixed;top:0;left:0;right:0;background:#2d2d2d;color:#ccc;padding:8px 16px;font:13px system-ui}.code{padding:44px 16px}.n{display:inline-block;width:44px;color:#666;text-align:right;margin-right:16px}.hex{color:#f5a97f;background:#3a2a20}.px{color:#b5cea8}</style><div class="bar">argon-dashboard-react / build / static / css / main.css</div><div class="code">${body}</div><script>let y=0;setTimeout(()=>{const t=setInterval(()=>{y+=6;scrollTo(0,y);if(y>5200)clearInterval(t)},16)},700)</script>`
}

// A terminal that types a command and reveals the real output lines at the real stage times (seconds since start).
function terminalPage(cmd, lines, highlight) {
  const rows = lines.map((l) => `<div class="o ${highlight.test(l.text) ? 'ok' : ''}" data-at="${l.at}">${esc(l.text)}</div>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style><div><span class="p">screenshot-to-tokens <b>%</b></span> <span id="t"></span></div><div id="o">${rows}</div>
<script>const cmd=${JSON.stringify(cmd)};const s=ms=>new Promise(r=>setTimeout(r,ms));(async()=>{await s(500);for(const ch of cmd){t.textContent+=ch;await s(22)}await s(250);const t0=Date.now();
for(const o of document.querySelectorAll('.o')){const at=+o.dataset.at*1000;while(Date.now()-t0<at)await s(30);o.classList.add('show')}document.querySelectorAll('.o.ok').forEach(e=>e.classList.add('hl'));window.done=1})()</script>`
}
function runTerminal() {
  const text = readFileSync(`${RUN}-terminal.txt`, 'utf-8').trim().split('\n')
  const timing = JSON.parse(readFileSync(join(RUN, 'timing.json'), 'utf-8'))
  let t = 0
  const at = {}
  for (const s of timing.stages) { t += s.ms / 1000; at[s.stage] = t }
  const lines = text.map((l) => { const m = l.match(/^\s+(\w+)\s/); return { text: l.length > 112 ? l.slice(0, 111) + '…' : l, at: m && at[m[1]] != null ? at[m[1]] : (/^done/.test(l) ? t : 0) } })
  return terminalPage(`node src/cli.js run --serve argon/build --run ${RUN}`, lines, /verify|done in/)
}
function diffPage() {
  const r = JSON.parse(readFileSync(join(RUN, 'rewrite.json'), 'utf-8'))
  const seen = new Set(), pick = []
  for (const e of r.edits) { if (seen.has(e.token) || !/button|action|active|radius|card/.test(e.token)) continue; seen.add(e.token); pick.push(e); if (pick.length >= 8) break }
  const rows = pick.map((e, i) => `<div class="row" style="animation-delay:${0.4 + i * 0.35}s"><div class="m">- ${esc(e.prop)}: ${esc(e.before)};</div><div class="pl">+ ${esc(e.prop)}: ${esc(e.after)};</div></div>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0d1117;color:#c9d1d9;font:18px/1.55 ui-monospace,Menlo,monospace;padding:36px 44px}h1{font:600 18px system-ui;color:#8b949e;margin:0 0 18px}.row{opacity:0;animation:in .4s forwards;margin:0 0 10px}.m{background:#3d1d22;color:#ffa198;padding:2px 10px}.pl{background:#1b3a26;color:#7ee2a8;padding:2px 10px}@keyframes in{to{opacity:1}}.note{margin-top:22px;font:16px system-ui;color:#8b949e}</style><h1>static/css/main.css · ${r.edits.length} values rewritten · the old value stays as the fallback</h1>${rows}<div class="note">Tokens include component and state tokens: button.active.bg is the selected Month toggle.</div>`
}
function breadthPage() {
  const md = readFileSync('docs/breadth.md', 'utf-8')
  const table = md.slice(md.indexOf('| Site |')).trim().split('\n').filter((l) => l.startsWith('|') && !/^\|---/.test(l))
  const [head, ...rows] = table.map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  const cls = (r) => (/0 px \(pass\); colors 0\.000% \(pass\)/.test(r.join(' ')) ? 'pass' : 'other')
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;color:#1d1d1b;font:14px/1.4 system-ui;padding:28px 36px}h1{font-size:24px;margin:0 0 4px}p{color:#6b6a66;margin:0 0 16px}table{border-collapse:collapse;width:100%}td,th{padding:5px 8px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#fafafa}tr.pass td:nth-child(7){color:#137a3a;font-weight:600}tr.other td:nth-child(7){color:#8a5300}</style><h1>28 public sites we didn't build</h1><p>Mirrored, tokenized and verified end to end. 23 of 23 stable sites with edits: rewrite changes 0 px. Re-checked: same verdict on all 27 reachable.</p><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr class="${cls(r)}">${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table><script>let y=0;setTimeout(()=>{const t=setInterval(()=>{y+=3;scrollTo(0,y);if(y>900)clearInterval(t)},16)},1500)</script>`
}

function reviewTerminal() {
  const out = readFileSync('out/video/review-v2-output.txt', 'utf-8').trim().split('\n')
  const lines = out.map((l, i) => ({ text: l, at: 0.25 * i + (/^eval/.test(l) ? 1.2 : 0) }))
  return terminalPage('node src/cli.js review --run out/take-review --decisions review.json && node src/cli.js eval --fixture acme-shop --run out/take-review', lines, /verify|21\/21/)
}
const srv = await serveDir(process.cwd())
const browser = await chromium.launch({ args: ['--disable-gpu'] })
const size = { width: 1280, height: 720 }
async function beat(n, fn) {
  if (only && !only.has(n)) return
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: join(OUT, `tmp-${n}`), size } })
  const page = await ctx.newPage()
  try { await fn(page) } finally { await ctx.close() }
  const dir = join(OUT, `tmp-${n}`), f = readdirSync(dir).find((x) => x.endsWith('.webm'))
  renameSync(join(dir, f), join(OUT, `beat-${n}.webm`))
  console.log(`beat ${n} → out/video/beat-${n}.webm`)
}
const page = (name, html) => { writeFileSync(join(PAGES, name), html); return `${srv.url}out/video/pages/${name}` }
const wait = (p, ms) => p.waitForTimeout(ms)

await beat(1, async (p) => { await p.goto(page('editor.html', editorPage())); await wait(p, 13000) })
await beat(2, async (p) => { await p.goto(`${srv.url}out/scoreboard.html`, { waitUntil: 'networkidle' }); await wait(p, 600); await p.click('#replay'); await wait(p, 6500); await p.evaluate(() => document.querySelector('.headline')?.scrollIntoView({ block: 'start' })); await wait(p, 3500) })
await beat(3, async (p) => {
  await p.goto(page('run.html', runTerminal())); await p.waitForFunction(() => window.done, null, { timeout: 60000 }); await wait(p, 1800)
  await p.goto(`${srv.url}${RUN}/report.html`, { waitUntil: 'networkidle' })
  await p.evaluate(() => [...document.querySelectorAll('h3.tier-head')].find((h) => /semantic/.test(h.textContent))?.scrollIntoView({ block: 'start' })); await wait(p, 3000)
  await p.mouse.wheel(0, 500); await wait(p, 2500); await p.mouse.wheel(0, 500); await wait(p, 2000)
})
await beat(4, async (p) => {
  // Paced to the voiceover: accept (about 2 s in), rename (about 7 s), merge (about 14 s), then the terminal.
  page('review-terminal.html', reviewTerminal())
  await p.goto(`${srv.url}out/video/review-run/report.html`, { waitUntil: 'networkidle' })
  const chip = (n) => p.locator('.chip', { has: p.locator('code.chip-name', { hasText: new RegExp('^' + n.replace(/\./g, '\\.') + '$') }) }).first()
  await chip('color.action.primary').scrollIntoViewIfNeeded(); await wait(p, 1800)
  await chip('color.action.primary').locator('[data-action=accept]').hover(); await wait(p, 600); await chip('color.action.primary').locator('[data-action=accept]').click(); await wait(p, 2600)
  await chip('color.surface.muted').scrollIntoViewIfNeeded(); await wait(p, 1500)
  await chip('color.surface.muted').locator('[data-action=rename]').click(); await wait(p, 500)
  await chip('color.surface.muted').locator('.rename-input').pressSequentially('color.surface.input', { delay: 70 }); await chip('color.surface.muted').locator('.rename-input').press('Enter'); await wait(p, 2200)
  await p.locator('.merge-item').first().scrollIntoViewIfNeeded(); await wait(p, 2200)
  await p.locator('.merge-item .merge-btn').first().click(); await wait(p, 3000)
  await p.goto(`${srv.url}out/video/pages/review-terminal.html`); await p.waitForFunction(() => window.done, null, { timeout: 60000 }); await wait(p, 2500)
})
await beat(5, async (p) => {
  await p.goto(page('diff.html', diffPage())); await wait(p, 6500)
  await p.goto(`${srv.url}${RUN}/report.html`, { waitUntil: 'networkidle' })
  await p.evaluate(() => [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Verify')?.scrollIntoView({ block: 'start' })); await wait(p, 4000)
  await p.mouse.wheel(0, 450); await wait(p, 3500)
})
await beat(7, async (p) => {
  await p.goto(page('breadth.html', breadthPage())); await wait(p, 9000)
  await p.goto(`${srv.url}out/scoreboard.html`, { waitUntil: 'networkidle' })
  await p.evaluate(() => [...document.querySelectorAll('h2')].find((h) => /Real sites/.test(h.textContent))?.scrollIntoView({ block: 'start' })); await wait(p, 4000)
  await p.goto('https://github.com/nhunsaker/argon-dashboard-react/pull/1', { waitUntil: 'domcontentloaded' }); await wait(p, 4000)
})
await beat(8, async (p) => { await p.goto(`${srv.url}${RUN}/report.html`, { waitUntil: 'networkidle' }); await wait(p, 4000) })
await browser.close(); await srv.close()
