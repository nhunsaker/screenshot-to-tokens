import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matchedGoldIndices, buildScoreboardHtml, writeScoreboard, STEP_MS } from '../src/stages/scoreboard.js'

const R = (id, label, bbox, source = 't') => ({ id, label, bbox, score: 1, source })

test('matchedGoldIndices: greedy one-to-one IoU, same rule as segeval, duplicates never double-count', () => {
  const gold = [R('g0', 'button', [0, 0, 100, 40]), R('g1', 'button', [200, 0, 100, 40])]
  const pred = [
    R('p0', 'button', [2, 1, 98, 38]),   // matches g0
    R('p1', 'button', [3, 2, 96, 36]),   // also overlaps g0, but g0 already taken
    R('p2', 'button', [500, 500, 10, 10]), // matches nothing
  ]
  const idx = matchedGoldIndices(pred, gold)
  assert.deepEqual([...idx].sort(), [0])
})

test('matchedGoldIndices: every gold box found when predictions cover all of them', () => {
  const gold = [R('g0', 'button', [0, 0, 50, 20]), R('g1', 'button', [100, 0, 50, 20]), R('g2', 'button', [200, 0, 50, 20])]
  const pred = gold.map((g, i) => R(`p${i}`, 'button', g.bbox))
  assert.equal(matchedGoldIndices(pred, gold).size, 3)
})

test('buildScoreboardHtml: headline states the honest n/of-total split, boxes carry deterministic step delays', () => {
  const goldButtons = [R('h0', 'button', [10, 10, 40, 20]), R('h1', 'button', [100, 10, 40, 20]), R('h2', 'button', [200, 10, 40, 20])]
  const html = buildScoreboardHtml({
    screenshot: 'data:image/png;base64,AAAA',
    viewport: { width: 1440, height: 900 },
    goldButtons,
    domMatchedIdx: new Set(),
    samMatchedIdx: new Set([0, 1, 2]),
    compare: [],
    real: [],
    method: { fixture: 'div-soup', prompts: ['button'], model: 'sam-3.1', iou: 0.5, date: '2026-10-26' },
  })
  assert.match(html, /0 of 3/)
  assert.match(html, /3 of 3/)
  assert.match(html, new RegExp(`animation-delay:${2 * STEP_MS}ms`))
  assert.match(html, /SAM 3\.1 by Meta, SAM License/)
  // Must not present the DOM detector as a named competing product (council veto condition).
  assert.match(html, /not a named competing product/)
})

test('buildScoreboardHtml: never crashes with missing screenshot/data, renders a placeholder', () => {
  const html = buildScoreboardHtml({})
  assert.match(html, /no screenshot/)
  assert.doesNotMatch(html, /undefined/)
})

test('buildScoreboardHtml: per-label compare table shows recall/precision for every run', () => {
  const score = (perLabel, matched, recall, precision) => ({
    iou: 0.5,
    perLabel,
    anyLabel: { matched, recall, precision },
  })
  const html = buildScoreboardHtml({
    goldButtons: [],
    domMatchedIdx: new Set(),
    samMatchedIdx: new Set(),
    compare: [
      { label: 'DOM (page structure)', score: score({ button: { oracle: 8, predicted: 0, matched: 0, recall: 0, precision: null } }, 0, 0, null) },
      { label: 'SAM 3.1', score: score({ button: { oracle: 8, predicted: 8, matched: 8, recall: 1, precision: 1 } }, 8, 1, 1) },
    ],
    real: [{ label: 'agency (hybrid)', score: score({}, 98, 0.88, 0.87) }],
    method: { fixture: 'div-soup', prompts: [], model: 'sam-3.1', iou: 0.5, date: '2026-10-26' },
  })
  assert.match(html, /DOM \(page structure\)/)
  assert.match(html, /SAM 3\.1/)
  assert.match(html, /88%/)
  assert.match(html, /agency \(hybrid\)/)
  assert.match(html, /DOM oracle/)
})

test('writeScoreboard: wires up a real run set (DOM 0 of N, SAM N of N) from capture/regions.json on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-scoreboard-'))
  const truthPath = join(dir, 'truth.json')
  const truth = [
    { id: 'h0', label: 'button', bbox: [10, 10, 40, 20], score: 1, source: 'human' },
    { id: 'h1', label: 'button', bbox: [100, 10, 40, 20], score: 1, source: 'human' },
  ]
  writeFileSync(truthPath, JSON.stringify(truth))

  const makeRun = (name, regions, screenshotBytes) => {
    const runDir = join(dir, name)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'capture.json'), JSON.stringify({ viewport: { width: 1440, height: 900 }, screenshot: 'shot.png', capturedAt: '2026-10-26T00:00:00Z', elements: [] }))
    writeFileSync(join(runDir, 'regions.json'), JSON.stringify(regions))
    if (screenshotBytes) writeFileSync(join(runDir, 'shot.png'), screenshotBytes)
    return runDir
  }

  const tinyPng = Buffer.from('89504e470d0a1a0a', 'hex') // not a valid PNG, just bytes to embed
  const domDir = makeRun('dom', [], tinyPng)
  const samDir = makeRun('sam', [R('p0', 'button', [10, 10, 40, 20]), R('p1', 'button', [100, 10, 40, 20])])
  const hybridDir = makeRun('hybrid', [R('p0', 'button', [10, 10, 40, 20]), R('p1', 'button', [100, 10, 40, 20])])
  const realDir = makeRun('real', [R('p0', 'card', [0, 0, 100, 100])])

  const outPath = join(dir, 'scoreboard.html')
  const written = writeScoreboard({
    runs: [
      { role: 'dom', label: 'DOM (page structure)', runDir: domDir, truth: truthPath },
      { role: 'sam', label: 'SAM 3.1', runDir: samDir, truth: truthPath },
      { role: 'hybrid', label: 'Hybrid', runDir: hybridDir, truth: truthPath },
      { role: 'real', label: 'a real app', runDir: realDir },
    ],
    out: outPath,
  })

  assert.equal(written, outPath)
  const html = readFileSync(outPath, 'utf-8')
  assert.match(html, /0 of 2/)
  assert.match(html, /2 of 2/)
  assert.match(html, /a real app/)
  rmSync(dir, { recursive: true, force: true })
})
