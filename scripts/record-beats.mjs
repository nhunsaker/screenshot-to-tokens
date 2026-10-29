#!/usr/bin/env node
// Draft video beats for the demo (docs/demo-script.md), recorded headless with Playwright at 1280x720. Every number on
// screen comes from a real run folder; terminal beats replay the real output of that run at its real stage timings.
// Writes out/video/beat-<n>.webm. A person adds the voiceover and cuts the final video.
//   node scripts/record-beats.mjs [--run out/rec-argon] [--only 1,3] [--apps /path/to/demo-apps]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join, resolve } from 'path'
import { chromium } from 'playwright'
import { parseArgs } from '../src/lib/args.js'
import { serveDir } from '../src/lib/serve.js'

const a = parseArgs(process.argv.slice(2))
const RUN = a.run || 'out/rec3-argon'
const APPS = a.apps || process.env.S2T_APPS || '/Volumes/SanDisk/s2t-demo-apps' // demo app builds (docs/demo-apps.md)
const OUT = resolve('out/video'), PAGES = join(OUT, 'pages')
mkdirSync(PAGES, { recursive: true })
const only = a.only ? new Set(String(a.only).split(',').map(Number)) : null
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const BASE_CSS = 'body{margin:0;background:#1e1e1e;color:#d4d4d4;font:17px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:28px 36px}.p{color:#9cdcfe}.p b{color:#c586c0;font-weight:400}.o{white-space:pre;opacity:0}.o.show{opacity:1}.ok{color:#6ad38b}.hl{background:#2d4a2f;outline:1px solid #6ad38b}'

// Beat 1: the stylesheet, one declaration per line, hex codes and px values highlighted.
function editorPage() {
  const dir = `${APPS}/argon/build/static/css`
  const css = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.css'))), 'utf-8')
  const lines = css.slice(css.indexOf('.btn'), css.indexOf('.btn') + 60000).replace(/\{/g, ' {\n  ').replace(/;/g, ';\n  ').replace(/\}/g, '\n}\n').split('\n').filter((l) => l.trim()).slice(0, 420)
  const body = lines.map((l, i) => `<div><span class="n">${i + 1}</span>${esc(l).replace(/(#[0-9a-fA-F]{3,8}\b)/g, '<span class="hex">$1</span>').replace(/(\b\d+(?:\.\d+)?(?:px|rem)\b)/g, '<span class="px">$1</span>')}</div>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1e1e1e;color:#d4d4d4;font:15px/1.5 ui-monospace,Menlo,monospace}.bar{position:fixed;top:0;left:0;right:0;background:#2d2d2d;color:#ccc;padding:8px 16px;font:13px system-ui}.code{padding:44px 16px}.n{display:inline-block;width:44px;color:#666;text-align:right;margin-right:16px}.hex{color:#f5a97f;background:#3a2a20}.px{color:#b5cea8}</style><div class="bar">argon-dashboard-react / build / static / css / main.css</div><div class="code">${body}</div><script>let y=0;setTimeout(()=>{const t=setInterval(()=>{y+=6;scrollTo(0,y);if(y>5200)clearInterval(t)},16)},700)</script>`
}

// A terminal that types a command and reveals the real output lines at the real stage times (seconds since start).
function terminalPage(cmd, lines, highlight, speed = 1) {
  const label = speed > 1 ? `<div style="position:fixed;right:18px;top:14px;font:600 13px system-ui;color:#999;border:1px solid #444;border-radius:6px;padding:3px 8px">${speed}× replay · real times shown</div>` : ''
  const rows = lines.map((l) => `<div class="o ${highlight.test(l.text) ? 'ok' : ''}" data-at="${l.at}">${esc(l.text)}</div>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style><div><span class="p">screenshot-to-tokens <b>%</b></span> <span id="t"></span></div>${label}<div id="o">${rows}</div>
<script>const cmd=${JSON.stringify(cmd)};const speed=${JSON.stringify(speed)};const s=ms=>new Promise(r=>setTimeout(r,ms));(async()=>{await s(500);for(const ch of cmd){t.textContent+=ch;await s(22)}await s(250);const t0=Date.now();
for(const o of document.querySelectorAll('.o')){const at=+o.dataset.at*1000/speed;while(Date.now()-t0<at)await s(30);o.classList.add('show')}document.querySelectorAll('.o.ok').forEach(e=>e.classList.add('hl'));window.done=1})()</script>`
}
function runTerminal() {
  const text = readFileSync(`${RUN}-terminal.txt`, 'utf-8').trim().split('\n')
  const timing = JSON.parse(readFileSync(join(RUN, 'timing.json'), 'utf-8'))
  let t = 0
  const at = {}
  for (const s of timing.stages) { t += s.ms / 1000; at[s.stage] = t }
  const lines = text.map((l) => { const m = l.match(/^\s+(\w+)\s/); return { text: l.length > 112 ? l.slice(0, 111) + '…' : l, at: m && at[m[1]] != null ? at[m[1]] : (/^done/.test(l) ? t : 0) } })
  return terminalPage(`node src/cli.js run --serve argon/build --run ${RUN}`, lines, /verify|report|done in/, 3)
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

// Beat 0: the hackathon title card (no footage of the pre-existing Sorb product; the voice explains it). v3: the
// two-sentence tagline, and beside it a muted 4 s loop of the payoff cropped from beat 6's Point and say take
// (out/video/assets/v3/payoff-loop.webm: "Since last month" going from fail to pass, then the Tab focus ring). The
// bottom-left corner stays empty for the founder's camera bubble.
function titleCard() {
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0f1115;color:#e8e8e4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;height:100vh;overflow:hidden}.c{position:absolute;left:72px;top:170px;width:560px}.k{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#8a9af0;opacity:0;transition:opacity .5s;line-height:1.5}.t{font-size:56px;font-weight:700;letter-spacing:-1px;margin:12px 0 16px;opacity:0;transition:opacity .5s;line-height:1.05}.s{font-size:24px;color:#d6d5cf;line-height:1.4;opacity:0;transition:opacity .5s}.n{font-size:14px;color:#6b6a66;margin-top:22px;opacity:0;transition:opacity .5s;line-height:1.45}.on{opacity:1!important}.v{position:absolute;left:672px;top:200px;width:536px;opacity:0;transition:opacity .6s}.v video{width:536px;height:301px;border-radius:12px;display:block;box-shadow:0 10px 40px rgba(0,0,0,.5)}.cap{margin-top:12px;font-size:16px;color:#b9b8b2;min-height:24px}.cap b{color:#7ee2a8;font-weight:600}.cap i{color:#ffa198;font-style:normal;font-weight:600}</style>
<div class="c"><div class="k" data-at="0.2">Meta Global AI Developer Hackathon · Startup track · Build for Your World</div><div class="t" data-at="0.5">Screenshot to Tokens</div><div class="s" data-at="1.1">A design system from a screenshot in seconds. A more accessible app from the tokens in one change.</div><div class="n" data-at="2.6">Sorb is Metatoy's existing product and is not shown here. Everything in this video was built Oct 25 to 29, 2026 (git tag pre-event-baseline marks the line).</div></div>
<div class="v" data-at="0.3"><video id="loop" src="../assets/v3/payoff-loop.webm" muted autoplay loop playsinline></video><div class="cap" id="cap"></div></div>
<script>const t0=Date.now();setInterval(()=>{for(const e of document.querySelectorAll('[data-at]')){if(Date.now()-t0>=+e.dataset.at*1000)e.classList.add('on')}},100)
const v=document.getElementById('loop'),cap=document.getElementById('cap');const show=()=>{const t=v.currentTime;cap.innerHTML=t<0.85?'“Since last month”: <i>2.95:1, fails text contrast</i>':t<2?'“Since last month”: <b>4.53:1, passes</b> (one token changed)':'Tab: a <b>visible focus ring</b> in the app’s blue';requestAnimationFrame(show)};show()</script>`
}
await beat(0, async (p) => {
  // Title card only: the event guide says the demo shows only what was built during the event, so no footage of
  // the pre-existing Sorb product; the card explains it in words.
  await p.goto(page('title.html', titleCard())); await wait(p, a.v3 ? 21500 : 12500)
})
await beat(1, async (p) => { await p.goto(page('editor.html', editorPage())); await wait(p, 8800) })
await beat(2, async (p) => { await p.goto(`${srv.url}out/scoreboard.html`, { waitUntil: 'networkidle' }); await wait(p, 600); await p.click('#replay'); await wait(p, 6500); await p.evaluate(() => document.querySelector('.headline')?.scrollIntoView({ block: 'start' })); await wait(p, 3500) })
await beat(3, async (p) => {
  await p.goto(page('run.html', runTerminal())); await p.waitForFunction(() => window.done, null, { timeout: 60000 }); await wait(p, 1200)
  await p.goto(`${srv.url}${RUN}/report.html`, { waitUntil: 'networkidle' })
  await p.evaluate(() => { const c = document.createElement('div'); c.textContent = 'The review report it writes: every proposed token, with its reason'; c.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;background:rgba(17,17,17,.92);color:#fff;font:600 18px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 14px;border-radius:10px'; document.body.appendChild(c) })
  await wait(p, 2200)
  await p.evaluate(() => [...document.querySelectorAll('h3.tier-head')].find((h) => /semantic/.test(h.textContent))?.scrollIntoView({ block: 'start' })); await wait(p, 3200)
  await p.mouse.wheel(0, 450); await wait(p, 3000)
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
  await p.goto(`${srv.url}out/video/pages/review-terminal.html`); await p.waitForFunction(() => window.done, null, { timeout: 60000 }); await wait(p, 1200)
})
await beat(5, async (p) => {
  await p.goto(page('diff.html', diffPage())); await wait(p, 6500)
  await p.goto(`${srv.url}${RUN}/report.html`, { waitUntil: 'networkidle' })
  await p.evaluate(() => [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Verify')?.scrollIntoView({ block: 'start' })); await wait(p, 4000)
  await p.mouse.wheel(0, 450); await wait(p, 3500)
})
await beat(7, async (p) => { await p.goto(page('breadth.html', breadthPage())); await wait(p, 11500) })
// v3 end card: the items follow the closing line (the three Meta model families, open weights), then the callback
// line above Sorb's tagline, the repo / PR / live-demo links; the "3 to 9×" line is on the card only, not in the
// voice. The items sit in a 2 × 2 grid so everything left of x = 300 ends above y = 450, so the bottom-left corner stays clear for the camera
// bubble (credits are bottom-right).
function endCard() {
  const items = [
    [2.6, 'SAM 3.1', 'reads the interface from pixels', '8 of 8 buttons on a page whose code describes none of them'],
    [5.2, 'Muse Spark', 'names the tokens, with a reason for every one', 'Muse Spark Open on Baseten: 3 to 9× faster than hosted Muse'],
    [7.2, "Meta's speech model", 'takes the spoken request (muse-voice-transcribe-1.0)', 'Point and say: click, speak, the change is checked live'],
    [9.4, 'Open weights, end to end', 'SAM 3.1 open weights on a Modal GPU · Muse Spark Open on Baseten', 'open SAM matches hosted SAM on every test'],
  ]
  const rows = items.map(([at, h, sub, big]) => `<div class="it" data-at="${at}"><div class="h">${esc(h)}</div><div class="s">${esc(sub)}</div><div class="b">${esc(big)}</div></div>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0f1115;color:#e8e8e4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:64px 72px;height:100vh;box-sizing:border-box;overflow:hidden}.g{display:grid;grid-template-columns:1fr 1fr;gap:22px 56px}.it{opacity:0;transform:translateY(8px);transition:opacity .5s,transform .5s;margin:0}.on{opacity:1!important;transform:none!important}.h{font-size:27px;font-weight:700;letter-spacing:-.3px}.s{font-size:16px;color:#9a9a94;margin-top:2px}.b{font-size:19px;color:#8a9af0;margin-top:2px}.cb{opacity:0;transition:opacity .6s;font-size:28px;font-weight:600;line-height:1.3;margin:40px 0 14px;color:#e8e8e4;max-width:1136px}.tg{opacity:0;transition:opacity .6s;font-size:34px;font-weight:700;color:#7ee2a8}.ln{position:absolute;left:300px;right:72px;bottom:64px;text-align:right;font-size:17px;line-height:1.55;color:#e8e8e4;opacity:0;transition:opacity .6s}.cr{position:absolute;left:300px;right:72px;bottom:22px;text-align:right;font-size:12px;color:#6b6a66;opacity:0;transition:opacity .6s}</style><div class="g">${rows}</div>
<div class="cb" data-at="12.6">The design system took seconds. Making the app more accessible took one change each.</div>
<div class="tg" data-at="17.6">Propose the change. See it live. Verify before you merge.</div>
<div class="ln" data-at="17.9">Code: github.com/nhunsaker/screenshot-to-tokens<br>PR: github.com/nhunsaker/argon-dashboard-react/pull/2 · Live demo: nhunsaker.github.io/argon-dashboard-react</div>
<div class="cr" data-at="19.5">SAM 3.1, Muse Spark and the speech model by Meta · Muse Spark Open served on Baseten · Argon Dashboard React by Creative Tim (MIT; our fork, not affiliated) · breadth-run sites are MIT/Apache/BSD/ISC licensed, used with credit</div>
<script>const t0=Date.now();setInterval(()=>{for(const e of document.querySelectorAll('[data-at]')){if(Date.now()-t0>=+e.dataset.at*1000)e.classList.add('on')}},100)</script>`
}
// Beat 9 (played before the closer): accessibility. Contrast row on the Argon report, the axe-core comparison card,
// SAM's controls on div-soup, then a dark mode switched on as a token file (Light Bootstrap Dashboard React, MIT).
function axeCard() {
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;color:#1d1d1b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:56px 72px}h1{font-size:30px;margin:0 0 6px}p{color:#6b6a66;font-size:17px;margin:0 0 26px}table{border-collapse:collapse;font-size:21px;width:100%}td,th{padding:12px 14px;border-bottom:1px solid #eee;text-align:left}th{font-size:15px;color:#6b6a66;font-weight:600}.n{font-weight:700;color:#137a3a}</style>
<h1>Our text-contrast check vs axe-core, 28 sites</h1><p>Text colour from the DOM, background measured on the rendered pixels, so gradients and images count.</p>
<table><tr><th>axe-core says</th><th>items</th><th>we agree</th><th>opposite verdict</th></tr>
<tr><td>violation</td><td>309</td><td class="n">308</td><td>0</td></tr>
<tr><td>pass</td><td>2,174</td><td class="n">2,165</td><td>1 (a page that animates)</td></tr>
<tr><td>can't decide (needs a person)</td><td>251</td><td class="n">we decide 97%; the rest flagged for review</td><td>—</td></tr></table>`
}
function focusCard() {
  const f = JSON.parse(readFileSync('out/video/beat-6-pas.json', 'utf-8')).focus
  const row = (k, s) => `<tr><td>${k}</td><td class="n">${s.pass} of ${s.measured}</td><td>${s.pass} pass · ${s.faint} faint · ${s.none} none</td></tr>`
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;color:#1d1d1b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:56px 72px}h1{font-size:30px;margin:0 0 6px}p{color:#6b6a66;font-size:17px;margin:0 0 26px}table{border-collapse:collapse;font-size:24px;width:100%}td,th{padding:14px;border-bottom:1px solid #eee;text-align:left}th{font-size:15px;color:#6b6a66;font-weight:600}.n{font-weight:700;color:#137a3a;font-size:34px}tr:first-of-type+tr .n{color:#b3261e}</style>
<h1>Keyboard focus on Argon: visible focus at each Tab stop</h1><p>Measured by tabbing through the live web app, before and after the focus-ring tokens (the ring is shown in the Point and say beat).</p>
<table><tr><th></th><th>visible focus</th><th>Tab stops</th></tr>${row("theme's own styles", f.before)}${row('with the focus-ring tokens', f.after)}</table>`
}
await beat(9, async (p) => {
  await p.goto(`${srv.url}out/m12-argon/report.html`, { waitUntil: 'networkidle' })
  await p.evaluate(() => [...document.querySelectorAll('strong')].find((h) => /Text contrast/.test(h.textContent))?.scrollIntoView({ block: 'center' })); await wait(p, 6300)
  await p.goto(page('axe.html', axeCard())); await wait(p, 10000)
  // Keyboard focus on Argon, as numbers only: the ring itself is shown live in beat 6 (Point and say). Numbers from
  // that beat's recording run (out/video/beat-6-pas.json, the playground's own Tab-through).
  await p.goto(page('focus.html', focusCard())); await wait(p, 4800)
  const dark = await serveDir(resolve('out/video/assets/lightbootstrap-dark'))
  try {
    await p.goto(dark.url, { waitUntil: 'networkidle' }); await wait(p, 1200)
    await p.click('#sorb-theme-toggle'); await wait(p, 3600)
  } finally { await dark.close() }
})
await beat(8, async (p) => { await p.goto(page('end.html', endCard())); await wait(p, 24000) })
await browser.close(); await srv.close()
