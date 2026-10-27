#!/usr/bin/env node
// Benchmark A (L12): the W3C ACT rule afw4f7 "Text has minimum contrast" (WCAG 2 SC 1.4.3). Fetches the official
// test cases, loads each example page in Playwright the way verify does, runs our pixel checker on it and scores the
// page outcome against the expected one.
//
//   node scripts/bench-act-contrast.mjs [--out out/bench-act] [--offline]
//
// Outcome per page: failed if any checked text fails, passed if some text was checked and all passed, inapplicable
// if nothing was checked (hidden, disabled, decorative, not HTML text). ACT counts an implementation consistent when
// it fails every failed example and fails none of the passed or inapplicable ones; we report that and the exact match.
// The rule scores the HIGHEST possible contrast ("best"); the pipeline gate uses the worst background cluster, so both
// readings are reported.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'
import { LAUNCH, openSettled, collectTexts } from '../src/stages/capture.js'
import { evaluateTexts } from '../src/stages/text-contrast.js'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const outDir = resolve(opt('--out', 'out/bench-act'))
mkdirSync(outDir, { recursive: true })
const SRC = 'https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases.json'

const cached = join(outDir, 'testcases.json')
let all
if (args.includes('--offline') && existsSync(cached)) all = JSON.parse(readFileSync(cached, 'utf-8'))
else {
  const res = await fetch(SRC)
  if (!res.ok) throw new Error(`fetch ${SRC}: ${res.status}`)
  all = await res.json()
  writeFileSync(cached, JSON.stringify(all))
}
const cases = (all.testcases || all).filter((t) => t.ruleId === 'afw4f7')

const outcome = (pairs) => pairs.some((p) => p.status === 'fail') ? 'failed' : pairs.some((p) => p.status === 'pass') ? 'passed' : 'inapplicable'
const consistent = (expected, got) => (expected === 'failed' ? got === 'failed' : got !== 'failed')

const browser = await chromium.launch(LAUNCH)
const rows = []
try {
  for (const t of cases) {
    const page = await openSettled(browser, t.url, { width: 1280, height: 720 })
    const shot = join(outDir, `${t.testcaseId}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    const texts = await collectTexts(page)
    await page.close()
    const img = PNG.sync.read(readFileSync(shot))
    const best = evaluateTexts(img, texts, { mode: 'best' })
    const worst = evaluateTexts(img, texts, { mode: 'worst' })
    const row = {
      id: t.testcaseId, title: t.testcaseTitle, approved: !!t.approved, expected: t.expected,
      act: outcome(best), gate: outcome(worst),
      texts: best.map((p, i) => ({ text: p.text, status: p.status, ratio: p.ratio, worst: worst[i].ratio, required: p.required, fg: p.fg, bg: p.bg })),
    }
    row.consistent = consistent(t.expected, row.act)
    row.exact = t.expected === row.act
    row.gateConsistent = consistent(t.expected, row.gate)
    rows.push(row)
    const mark = row.consistent ? (row.exact ? 'ok ' : 'ok~') : 'BAD'
    console.log(`${mark} ${t.expected.padEnd(12)} act=${row.act.padEnd(12)} gate=${row.gate.padEnd(12)} ${t.testcaseTitle}${t.approved ? '' : ' (proposed)'}  ${row.texts.map((x) => `${x.status}${x.ratio != null ? ' ' + x.ratio + '/' + x.required : ''}`).join('; ')}`)
  }
} finally {
  await browser.close()
}

const tally = (list, key) => list.filter((r) => r[key]).length
const approved = rows.filter((r) => r.approved)
const byExpected = {}
for (const r of approved) {
  const b = byExpected[r.expected] || (byExpected[r.expected] = { total: 0, consistent: 0, exact: 0, gateConsistent: 0 })
  b.total++; b.consistent += r.consistent; b.exact += r.exact; b.gateConsistent += r.gateConsistent
}
const summary = {
  source: SRC, rule: 'afw4f7', ranAt: new Date().toISOString(),
  approved: { total: approved.length, consistent: tally(approved, 'consistent'), exact: tally(approved, 'exact'), gateConsistent: tally(approved, 'gateConsistent'), byExpected },
  proposed: rows.filter((r) => !r.approved).map((r) => ({ title: r.title, expected: r.expected, act: r.act, gate: r.gate })),
  rows,
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`\nACT afw4f7, ${approved.length} approved test cases: consistent ${summary.approved.consistent}/${approved.length}, exact outcome ${summary.approved.exact}/${approved.length} (highest-contrast reading); gate reading consistent ${summary.approved.gateConsistent}/${approved.length}`)
for (const [k, b] of Object.entries(byExpected)) console.log(`  ${k.padEnd(12)} ${b.consistent}/${b.total} consistent, ${b.exact}/${b.total} exact, gate ${b.gateConsistent}/${b.total}`)
for (const p of summary.proposed) console.log(`  proposed: ${p.title} expected ${p.expected}, got ${p.act} (gate ${p.gate})`)
console.log(`→ ${join(outDir, 'summary.json')}`)
