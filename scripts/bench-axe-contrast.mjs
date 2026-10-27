#!/usr/bin/env node
// Benchmark B (L12): our text-contrast checker against axe-core's `color-contrast` rule on the same served page.
// One page load per site: screenshot + our text samples, then axe-core (node_modules/axe-core/axe.min.js, injected)
// with only `color-contrast`. Each axe node is mapped back to our sample for the same element, and we report:
//   - agreement on axe's violations (do we fail them too?) and passes (do we pass them too?)
//   - our verdicts on axe's "incomplete" nodes, the ones axe cannot decide (gradients, images, overlaps), by reason.
//
//   node scripts/bench-axe-contrast.mjs                     Argon + 2 breadth mirrors (josh-wong, HackSocNotts)
//   node scripts/bench-axe-contrast.mjs --sites a,b,c       these breadth mirrors (dir names under --mirrors)
//   node scripts/bench-axe-contrast.mjs --all               Argon + every mirror under --mirrors (28 sites; heavy:
//                                                           run in the 00:00-06:00 CDT window, one at a time)
//   [--mirrors /Volumes/SanDisk/s2t-breadth4] [--argon /Volumes/SanDisk/s2t-demo-apps/argon/build] [--out out/bench-axe]
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'
import { LAUNCH, openSettled, collectTexts } from '../src/stages/capture.js'
import { evaluateTexts } from '../src/stages/text-contrast.js'
import { serveDir } from '../src/lib/serve.js'
import { settings } from '../src/config.js'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const outDir = resolve(opt('--out', 'out/bench-axe'))
const mirrors = resolve(opt('--mirrors', '/Volumes/SanDisk/s2t-breadth4'))
const argon = resolve(opt('--argon', '/Volumes/SanDisk/s2t-demo-apps/argon/build'))
const AXE = join(here, '..', 'node_modules', 'axe-core', 'axe.min.js')
mkdirSync(outDir, { recursive: true })

let sites = [{ name: 'argon', dir: argon }]
const pick = opt('--sites', null)
if (args.includes('--all')) sites = sites.concat(readdirSync(mirrors).filter((d) => existsSync(join(mirrors, d, 'index.html'))).map((d) => ({ name: d, dir: join(mirrors, d) })))
else sites = sites.concat((pick ? pick.split(',') : ['josh-wong', 'HackSocNotts']).map((d) => ({ name: d, dir: join(mirrors, d) })))

const viewport = settings().viewport
const axeVersion = JSON.parse(readFileSync(join(here, '..', 'node_modules', 'axe-core', 'package.json'), 'utf-8')).version
const MEASURED = (s) => s === 'pass' || s === 'fail'

/** Run axe color-contrast in the page and map each node to an index into window.__s2tTextEls (-1 if none). */
async function runAxe(page) {
  await page.addScriptTag({ path: AXE })
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations', 'passes', 'incomplete'] })
    const els = window.__s2tTextEls || []
    const nodes = []
    for (const kind of ['violations', 'passes', 'incomplete']) {
      for (const rule of r[kind]) for (const n of rule.nodes) {
        const sel = n.target[0]
        let el = null
        try { el = typeof sel === 'string' ? document.querySelector(sel) : null } catch (e) { el = null }
        const check = (n.any && n.any[0]) || {}
        const d = check.data || {}
        nodes.push({ kind, target: n.target.join(' >> '), idx: el ? els.indexOf(el) : -1, reason: d.messageKey || null, fg: d.fgColor || null, bg: d.bgColor || null, ratio: d.contrastRatio || null, expected: d.expectedContrastRatio || null })
      }
    }
    return nodes
  })
}

const results = []
const browser = await chromium.launch(LAUNCH)
try {
  for (const site of sites) {
    if (!existsSync(site.dir) || !statSync(site.dir).isDirectory()) { console.log(`skip ${site.name}: no folder at ${site.dir}`); continue }
    const t0 = Date.now()
    const srv = await serveDir(site.dir)
    try {
      const page = await openSettled(browser, srv.url, viewport)
      const shot = join(outDir, `${site.name}.png`)
      await page.screenshot({ path: shot, fullPage: true })
      const texts = await collectTexts(page, 3000, true)
      const axeNodes = await runAxe(page)
      await page.close()
      const ours = evaluateTexts(PNG.sync.read(readFileSync(shot)), texts)
      const row = { site: site.name, ms: 0, ourPairs: ours.filter((p) => MEASURED(p.status)).length, ourFailing: ours.filter((p) => p.status === 'fail').length, axe: {} }
      const examples = { violationsWePass: [], passesWeFail: [], incomplete: [] }
      for (const kind of ['violations', 'passes', 'incomplete']) {
        const list = axeNodes.filter((n) => n.kind === kind)
        const b = row.axe[kind] = { total: list.length, matched: 0, weFail: 0, wePass: 0, weSkip: {}, byReason: {} }
        for (const n of list) {
          const p = n.idx >= 0 ? ours[n.idx] : null
          if (!p) continue
          b.matched++
          if (p.status === 'fail') b.weFail++
          else if (p.status === 'pass') b.wePass++
          else b.weSkip[p.status] = (b.weSkip[p.status] || 0) + 1
          if (kind === 'incomplete') {
            const r = b.byReason[n.reason || 'other'] || (b.byReason[n.reason || 'other'] = { total: 0, pass: 0, fail: 0, skipped: 0 })
            r.total++
            if (p.status === 'pass') r.pass++; else if (p.status === 'fail') r.fail++; else r.skipped++
          }
          const ex = { text: p.text, axe: { reason: n.reason, fg: n.fg, bg: n.bg, ratio: n.ratio, expected: n.expected }, ours: { status: p.status, fg: p.fg, bg: p.bg, ratio: p.ratio, required: p.required } }
          if (kind === 'violations' && p.status === 'pass') examples.violationsWePass.push(ex)
          if (kind === 'passes' && p.status === 'fail') examples.passesWeFail.push(ex)
          if (kind === 'incomplete' && examples.incomplete.length < 40) examples.incomplete.push(ex)
        }
      }
      // Our measured pairs on elements axe did not report at all.
      const seen = new Set(axeNodes.map((n) => n.idx).filter((i) => i >= 0))
      row.oursOnly = ours.filter((p, i) => MEASURED(p.status) && !seen.has(i)).length
      row.ms = Date.now() - t0
      row.examples = examples
      results.push(row)
      writeFileSync(join(outDir, `${site.name}.json`), JSON.stringify({ ...row, axeNodes, ours }, null, 2))
      const v = row.axe.violations, ps = row.axe.passes, inc = row.axe.incomplete
      console.log(`${site.name}: axe violations ${v.total} (we fail ${v.weFail}/${v.matched} matched), passes ${ps.total} (we pass ${ps.wePass}/${ps.matched}), incomplete ${inc.total} (we decide ${inc.wePass + inc.weFail}/${inc.matched}: ${inc.wePass} pass, ${inc.weFail} fail) · ours ${row.ourFailing}/${row.ourPairs} failing · ${(row.ms / 1000).toFixed(1)} s`)
    } catch (e) {
      results.push({ site: site.name, error: String((e && e.message) || e) })
      console.log(`${site.name}: ERROR ${e && e.message}`)
    } finally {
      await srv.close()
    }
  }
} finally {
  await browser.close()
}

const sum = (k, f) => results.filter((r) => r.axe).reduce((n, r) => n + f(r.axe[k]), 0)
const total = {
  sites: results.filter((r) => r.axe).length,
  violations: { total: sum('violations', (b) => b.total), matched: sum('violations', (b) => b.matched), weFail: sum('violations', (b) => b.weFail) },
  passes: { total: sum('passes', (b) => b.total), matched: sum('passes', (b) => b.matched), wePass: sum('passes', (b) => b.wePass) },
  incomplete: { total: sum('incomplete', (b) => b.total), matched: sum('incomplete', (b) => b.matched), wePass: sum('incomplete', (b) => b.wePass), weFail: sum('incomplete', (b) => b.weFail) },
}
const byReason = {}
for (const r of results) for (const [k, v] of Object.entries((r.axe && r.axe.incomplete.byReason) || {})) {
  const b = byReason[k] || (byReason[k] = { total: 0, pass: 0, fail: 0, skipped: 0 })
  for (const f of Object.keys(b)) b[f] += v[f]
}
total.incomplete.byReason = byReason
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ axeVersion, viewport, ranAt: new Date().toISOString(), total, sites: results.map(({ examples, ...r }) => r) }, null, 2))
console.log(`\naxe-core ${axeVersion} color-contrast vs pixel checker, ${total.sites} sites:`)
console.log(`  violations: we fail ${total.violations.weFail} of ${total.violations.matched} matched (${total.violations.total} reported)`)
console.log(`  passes:     we pass ${total.passes.wePass} of ${total.passes.matched} matched (${total.passes.total} reported)`)
console.log(`  incomplete: we give a verdict on ${total.incomplete.wePass + total.incomplete.weFail} of ${total.incomplete.matched} matched (${total.incomplete.wePass} pass, ${total.incomplete.weFail} fail; ${total.incomplete.total} reported)`)
for (const [k, b] of Object.entries(byReason)) console.log(`    ${k.padEnd(22)} ${b.total}: ${b.pass} pass, ${b.fail} fail, ${b.skipped} not measured`)
console.log(`→ ${join(outDir, 'summary.json')}`)
