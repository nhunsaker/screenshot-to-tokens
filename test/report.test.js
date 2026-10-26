import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildReportHtml, writeReport } from '../src/stages/report.js'

// A hand-rolled 1x1 transparent PNG, base64-encoded. Good enough to exercise the base64-inlining
// path without pulling in a real screenshot.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const capture = {
  url: 'http://localhost:4321/',
  viewport: { width: 400, height: 300 },
  screenshot: 'screenshot.png',
  capturedAt: '2026-10-25T00:00:00.000Z',
  elements: [],
}

const regions = [
  { id: 'r0', bbox: [10, 10, 100, 40], label: 'button', score: 0.92, source: 'mock-dom' },
  { id: 'r1', bbox: [10, 60, 200, 20], label: 'text', score: 0.5, source: 'mock-dom' },
]

const clusters = [
  {
    id: 'color-01', kind: 'color', value: '#1a73e8ff',
    members: [{ value: '#1a73e8ff', count: 3 }, { value: '#1b74e9ff', count: 1 }],
    count: 4, props: { 'background-color': 3, color: 1 }, regionLabels: { button: 3 },
  },
  {
    id: 'radius-01', kind: 'radius', value: '4px',
    members: [{ value: '4px', count: 2 }],
    count: 2, props: { 'border-top-left-radius': 2 }, regionLabels: {},
  },
]

const tokens = {
  namer: 'mock-heuristic',
  warnings: [],
  tokens: [
    { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: 'most-used blue' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: 'buttons use it <script>alert(1)</script>' },
    { name: 'button.radius', tier: 'component', alias: 'color.blue.500', clusters: ['radius-01'], why: '' },
  ],
}

const rewrite = {
  coder: 'deterministic',
  written: true,
  files: ['src/button.css'],
  outDir: '/tmp/out',
  edits: [
    { file: 'src/button.css', line: 12, prop: 'background-color', before: '#1a73e8', after: 'var(--color-action-primary, #1a73e8)', token: 'color.action.primary' },
  ],
}

const verify = {
  diffPixels: 12, totalPixels: 120000, ratio: 0.0001, pass: true, threshold: 0.001,
  before: 'screenshot.png', after: 'after.png', diff: 'diff.png',
}

test('buildReportHtml renders every section when everything is present', () => {
  const html = buildReportHtml({
    capture, regions, clusters, tokens, rewrite, verify,
    screenshot: 'data:image/png;base64,' + TINY_PNG_B64,
    verifyImages: { before: 'data:image/png;base64,' + TINY_PNG_B64, after: null, diff: null },
  })
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /http:\/\/localhost:4321\//) // header: run url
  assert.match(html, /mock-heuristic/) // header: namer provider
  assert.match(html, /MOCK \/ offline/) // mock badge on segment/namer/coder
  assert.match(html, /region/) // hero overlay boxes present
  assert.match(html, /color\.action\.primary/) // token chip name
  assert.match(html, /--color-action-primary/) // css var name shown
  assert.match(html, /color-01/) // cluster id referenced by a chip
  assert.match(html, /radius-01/) // clusters table row
  assert.match(html, /src\/button\.css:12/) // rewrite edit file:line
  assert.match(html, /PASS/) // verify badge
  assert.match(html, /0\.010%|0\.0100%|0\.010 ?%/) // ratio rendered as a percentage (12/120000 * 100 = 0.01)
})

test('buildReportHtml escapes text instead of injecting it as markup', () => {
  const html = buildReportHtml({ tokens, clusters })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('buildReportHtml renders every section gracefully with no data at all', () => {
  const html = buildReportHtml({})
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /No screenshot yet/)
  assert.match(html, /No token set yet/)
  assert.match(html, /No clusters yet/)
  assert.match(html, /No rewrite yet/)
  assert.match(html, /No verify yet/)
  assert.match(html, /not run yet/)
})

test('buildReportHtml handles a cluster with no matching token / drifted members', () => {
  const html = buildReportHtml({ clusters })
  assert.match(html, /merged/) // color-01 has 2 members -> drift badge
  assert.match(html, /#1b74e9ff/) // merged member value shown
})

test('writeReport works on a run dir that only has clusters.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-report-'))
  try {
    writeFileSync(join(dir, 'clusters.json'), JSON.stringify(clusters))
    const outPath = writeReport(dir)
    assert.equal(outPath, join(dir, 'report.html'))
    const html = readFileSync(outPath, 'utf-8')
    assert.match(html, /<!doctype html>/i)
    assert.match(html, /No screenshot yet/)
    assert.match(html, /color-01/)
    assert.match(html, /No token set yet/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('token chips carry data-token-name, review controls and a review badge', () => {
  const reviewedToken = {
    ...tokens,
    tokens: [
      { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: 'x', review: 'accepted' },
      { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: 'y', review: 'rejected' },
    ],
    reviewed: { at: '2026-10-25T01:00:00.000Z', decisions: 2, reviewed: 2, notes: ['no token nope'] },
  }
  const html = buildReportHtml({ tokens: reviewedToken, clusters })
  assert.match(html, /data-token-name="color\.blue\.500"/)
  assert.match(html, /class="review-btn" data-action="accept"/)
  assert.match(html, /class="review-btn" data-action="rename"/)
  assert.match(html, /class="review-btn" data-action="reject"/)
  assert.match(html, /class="rename-input"/)
  assert.match(html, /badge-pass">accepted/) // accepted -> pass-styled badge
  assert.match(html, /badge-fail">rejected/) // rejected -> fail-styled badge
  assert.match(html, /Reviewed 2026-10-25T01:00:00\.000Z/) // set.reviewed summary line
  assert.match(html, /no token nope/) // reviewed.notes surfaced
})

test('the review toolbar and its script render only when there are tokens to review', () => {
  const withTokens = buildReportHtml({ tokens, clusters })
  assert.match(withTokens, /id="download-review"/)
  assert.match(withTokens, /node src\/cli\.js review --run/)
  assert.match(withTokens, /URL\.createObjectURL/) // the download script is inlined

  const withoutTokens = buildReportHtml({})
  assert.ok(!withoutTokens.includes('id="download-review"'))
})

test('hero notes the mock-oracle caveat when regions came from mock-dom, not otherwise', () => {
  const withMock = buildReportHtml({ capture, regions, screenshot: 'data:image/png;base64,' + TINY_PNG_B64 })
  assert.match(withMock, /mock oracle/)

  const samRegions = regions.map((r) => ({ ...r, source: 'sam3.1' }))
  const withSam = buildReportHtml({ capture, regions: samRegions, screenshot: 'data:image/png;base64,' + TINY_PNG_B64 })
  assert.ok(!withSam.includes('mock oracle'))
})

test('verify renders the fallback/colors/all-tokens breakdown when the richer shape is present', () => {
  const richVerify = {
    diffPixels: 500, totalPixels: 120000, ratio: 0.004, pass: true, threshold: 0.001,
    before: 'screenshot.png', after: 'after.png', diff: 'diff.png',
    allTokensWithinThreshold: false, reviewNeeded: true,
    fallback: { diffPixels: 0, totalPixels: 120000, ratio: 0, pass: true, threshold: 0, before: 'a', after: 'b', diff: 'c' },
    colors: { diffPixels: 10, totalPixels: 120000, ratio: 0.00008, pass: true, threshold: 0.001, before: 'a', after: 'b', diff: 'c' },
  }
  const html = buildReportHtml({
    verify: richVerify,
    verifyImages: {
      before: 'data:image/png;base64,AA==', after: 'data:image/png;base64,AA==', diff: 'data:image/png;base64,AA==',
      fallback: { before: 'data:image/png;base64,AA==', after: null, diff: null },
      colors: { before: 'data:image/png;base64,AA==', after: null, diff: null },
    },
  })
  assert.match(html, /Fallbacks only \(safety\)/)
  assert.match(html, /Colors merged/)
  assert.match(html, /All tokens \(layout cleanup to review\)/)
  // the all-tokens row is over threshold (reviewNeeded) -> "review" pill, not "FAIL".
  assert.match(html, /badge-caution">review</)
  assert.ok(!html.includes('badge-fail">FAIL<')) // fallback and colors both passed -> no FAIL pill
  assert.equal((html.match(/class="verify-row"/g) || []).length, 3) // one row per check
  assert.equal((html.match(/class="verify-grid verify-grid--compact"/g) || []).length, 3) // each row gets its own thumbnail trio

  // the simple (no breakdown) shape still renders the single-line summary, unchanged.
  const simpleHtml = buildReportHtml({ verify })
  assert.ok(!simpleHtml.includes('class="verify-row"'))
  assert.match(simpleHtml, /PASS/)
})

test('verify shows a FAIL pill on a check row that did not pass', () => {
  const failingVerify = {
    diffPixels: 50, totalPixels: 1000, ratio: 0.05, pass: false, threshold: 0.001,
    before: 'a', after: 'b', diff: 'c', allTokensWithinThreshold: false, reviewNeeded: true,
    fallback: { diffPixels: 5, totalPixels: 1000, ratio: 0.005, pass: false, threshold: 0, before: 'a', after: 'b', diff: 'c' },
    colors: { diffPixels: 0, totalPixels: 1000, ratio: 0, pass: true, threshold: 0.001, before: 'a', after: 'b', diff: 'c' },
  }
  const html = buildReportHtml({ verify: failingVerify })
  assert.match(html, /badge-fail">FAIL</) // fallback broke safety -> FAIL, not review
  assert.match(html, /badge-pass">pass</) // colors still fine
  assert.match(html, /badge-fail">FAIL<\/span>\s*rewrite gate/) // overall gate fails too
})

test('writeReport inlines the screenshot and verify images as data URIs when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-report-full-'))
  try {
    const png = Buffer.from(TINY_PNG_B64, 'base64')
    writeFileSync(join(dir, 'capture.json'), JSON.stringify(capture))
    writeFileSync(join(dir, 'screenshot.png'), png)
    writeFileSync(join(dir, 'verify.json'), JSON.stringify(verify))
    writeFileSync(join(dir, 'after.png'), png)
    writeFileSync(join(dir, 'diff.png'), png)
    const outPath = writeReport(dir)
    const html = readFileSync(outPath, 'utf-8')
    assert.match(html, /data:image\/png;base64,/)
    // hero screenshot + verify's before/after/diff (before re-reads screenshot.png separately) = 4 inlined images.
    assert.equal(html.split('data:image/png;base64,').length - 1, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('report shows merge suggestions with an accept toggle', async () => {
  const { buildReportHtml } = await import('../src/stages/report.js')
  const html = buildReportHtml({
    clusters: [
      { id: 'radius-01', kind: 'radius', value: '4px', members: [{ value: '4px', count: 5 }], count: 5, props: {}, regionLabels: {} },
      { id: 'radius-02', kind: 'radius', value: '6px', members: [{ value: '6px', count: 1 }], count: 1, props: {}, regionLabels: {} },
    ],
    tokens: { namer: 't', merges: [{ from: 'radius-02', into: 'radius-01', why: 'close <b>' }], tokens: [
      { name: 'radius.sm', tier: 'primitive', value: '4px', clusters: ['radius-01'], why: '' },
      { name: 'radius.md', tier: 'primitive', value: '6px', clusters: ['radius-02'], why: '' },
    ] },
  })
  const assert = (await import('node:assert/strict')).default
  assert.match(html, /Suggested merges/)
  assert.match(html, /data-merge-from="radius-02" data-merge-into="radius-01"/)
  assert.match(html, /<code>6px<\/code> &rarr; <code>4px<\/code>/)
  assert.ok(!html.includes('close <b>'))
})

// ---------------------------------------------------------------------------
// F5 "Named & why spec cards" — grounding + roles-differ surfaced on the token chip
// ---------------------------------------------------------------------------

const f5Regions = [
  { id: 'r0', bbox: [10, 10, 100, 40], label: 'button', score: 0.9, source: 'sam3.1' },
  { id: 'r1', bbox: [10, 60, 300, 20], label: 'card', score: 0.6, source: 'sam3.1' },
]

const f5Capture = {
  url: 'http://localhost:4321/', viewport: { width: 400, height: 300 },
  screenshot: 'screenshot.png', capturedAt: '2026-10-25T00:00:00.000Z', elements: [],
}

const groundedCluster = {
  id: 'color-03', kind: 'color', value: '#333333ff',
  members: [{ value: '#333333ff', count: 22 }, { value: '#343434ff', count: 10 }],
  count: 32, props: { color: 32 }, regionLabels: { button: 6, card: 26 },
}

// Used both as background (button) and as text (card) in significant proportion each way —
// the merge is not settled, and the card must say so rather than presenting it as clean.
const conflictedCluster = {
  id: 'color-09', kind: 'color', value: '#1a73e8ff',
  members: [{ value: '#1a73e8ff', count: 10 }],
  count: 10, props: { 'background-color': 6, color: 4 }, regionLabels: { button: 6, card: 4 },
}

test('a grounded why is shown verbatim, with no unverified/roles-differ badge', () => {
  const html = buildReportHtml({
    capture: f5Capture, regions: f5Regions, clusters: [groundedCluster],
    tokens: { namer: 'meta:muse-spark-1.3', tokens: [
      { name: 'color.gray.800', tier: 'primitive', value: '#333333ff', clusters: ['color-03'], why: 'Dominant text color with 32 uses across card and button.' },
    ] },
    screenshot: 'data:image/png;base64,' + TINY_PNG_B64,
  })
  assert.match(html, /Dominant text color with 32 uses across card and button\./)
  assert.ok(!html.includes('unverified'))
  assert.ok(!html.includes('Roles differ'))
  // provenance: namer id + the segmenter source of the regions shown
  assert.match(html, /namer <code>meta:muse-spark-1\.3<\/code>/)
  assert.match(html, /regions via <code>sam3\.1<\/code>/)
})

test('an ungrounded why is replaced by the plain templated reason and marked unverified, visibly', () => {
  const html = buildReportHtml({
    clusters: [groundedCluster],
    tokens: { namer: 'meta:muse-spark-1.3', tokens: [
      { name: 'color.gray.800', tier: 'primitive', value: '#333333ff', clusters: ['color-03'], why: 'Used 999 times in the sidebar nav.' },
    ] },
  })
  assert.ok(!html.includes('Used 999 times in the sidebar nav.'))
  assert.match(html, /Used 32 times as text color/) // the templated fallback took over
  assert.match(html, /badge badge-caution">unverified/) // visible, not hidden
  assert.match(html, /model said, unverified:/)
  assert.match(html, /count 999/)
})

test('a token whose clusters disagree on role gets a visible "Roles differ" badge and is never presented as settled', () => {
  const html = buildReportHtml({
    clusters: [conflictedCluster],
    tokens: { namer: 'mock', tokens: [
      { name: 'color.brand', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-09'], why: 'Primary brand color.' },
    ] },
  })
  assert.match(html, /badge badge-caution">Roles differ: review/)
})

test('a clean single-role token never gets the roles-differ badge', () => {
  const html = buildReportHtml({
    clusters: [groundedCluster],
    tokens: { namer: 'mock', tokens: [
      { name: 'color.gray.800', tier: 'primitive', value: '#333333ff', clusters: ['color-03'], why: 'Dominant text color.' },
    ] },
  })
  assert.ok(!html.includes('Roles differ'))
})

test('a token chip shows the merged cluster members, where it is used, and the value/alias chain', () => {
  const html = buildReportHtml({
    clusters: [groundedCluster],
    tokens: { namer: 'mock', tokens: [
      { name: 'color.gray.800', tier: 'primitive', value: '#333333ff', clusters: ['color-03'], why: '' },
      { name: 'color.text.muted', tier: 'semantic', alias: 'color.gray.800', clusters: ['color-03'], why: '' },
    ] },
  })
  assert.match(html, /#343434ff &times;10/) // drifted member + count
  assert.match(html, /props:.*color \(32\)/s)
  assert.match(html, /regions:.*card \(26\)/s)
  assert.match(html, /color\.text\.muted.*&rarr;.*color\.gray\.800.*&rarr;.*#333333ff/s) // chain ends at the literal
})

test('a token chip crops up to 3 screenshot regions matching its clusters, with no new image files', () => {
  const html = buildReportHtml({
    capture: f5Capture, regions: f5Regions, clusters: [groundedCluster],
    tokens: { namer: 'mock', tokens: [
      { name: 'color.gray.800', tier: 'primitive', value: '#333333ff', clusters: ['color-03'], why: '' },
    ] },
    screenshot: 'data:image/png;base64,' + TINY_PNG_B64,
  })
  assert.match(html, /class="thumb"/)
  assert.match(html, /background-image:url\(data:image\/png;base64,/)
  // no thumbs at all when there is no screenshot to crop from
  const noScreenshot = buildReportHtml({ regions: f5Regions, clusters: [groundedCluster], tokens: { namer: 'mock', tokens: [
    { name: 'color.gray.800', tier: 'primitive', value: '#333333ff', clusters: ['color-03'], why: '' },
  ] } })
  assert.ok(!noScreenshot.includes('class="thumb"'))
})

test('writeReport links images instead of embedding when asked (big runs)', async () => {
  const { writeReport } = await import('../src/stages/report.js')
  const { mkdtempSync, writeFileSync, readFileSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { PNG } = await import('pngjs')
  const assert = (await import('node:assert/strict')).default
  const dir = mkdtempSync(join(tmpdir(), 's2t-rep-'))
  writeFileSync(join(dir, 'screenshot.png'), PNG.sync.write(new PNG({ width: 4, height: 4 })))
  writeFileSync(join(dir, 'capture.json'), JSON.stringify({ url: 'x', viewport: { width: 4, height: 4 }, screenshot: 'screenshot.png', elements: [] }))
  const linked = readFileSync(writeReport(dir, { images: 'link' }), 'utf-8')
  assert.match(linked, /src="screenshot.png"/)
  assert.ok(!linked.includes('data:image/png;base64'))
  const embedded = readFileSync(writeReport(dir, { images: 'auto' }), 'utf-8')
  assert.match(embedded, /data:image\/png;base64/)
})
