import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  measureStop, verdictOf, perimeterArea, surroundings, summarizeStops, pickRingColor, focusTokensCss, withFocusTokens,
  focusRuleCss, unreachableControls, containment, focusPrSection, ringText, measureUrl, NATIVE_FOCUSABLE, compareStops, worseText,
} from '../src/stages/focus.js'
import { prBody } from '../src/stages/pr.js'
import { focusRow } from '../src/stages/report.js'
import { serveDir } from '../src/lib/serve.js'

// ---- synthetic clips ----------------------------------------------------------------------------------------------

/** A w x h RGBA image filled with one color. */
const img = (w, h, [r, g, b]) => {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255 }
  return { width: w, height: h, data }
}
/** Paint a ring of `t` px at distance `off` around the box [x,y,w,h]. */
const ring = (im, [x, y, w, h], off, t, [r, g, b]) => {
  for (let Y = 0; Y < im.height; Y++) for (let X = 0; X < im.width; X++) {
    const dx = Math.max(x - X, 0, X - (x + w - 1)), dy = Math.max(y - Y, 0, Y - (y + h - 1))
    const d = Math.max(dx, dy)
    if (d > off && d <= off + t) { const k = (Y * im.width + X) * 4; im.data[k] = r; im.data[k + 1] = g; im.data[k + 2] = b }
  }
  return im
}
const BOX = [8, 8, 40, 20] // a 40 x 20 control inside a 56 x 36 clip (8 px pad)

test('perimeterArea: a solid 2 px perimeter of a w x h control', () => {
  assert.equal(perimeterArea(40, 20), 240)
  assert.equal(perimeterArea(100, 10), 440)
})

test('verdictOf: pass needs the area at 3:1; faint is at least half the area changed; else none', () => {
  assert.equal(verdictOf({ changed: 300, strong: 240, perimeter2px: 240 }), 'pass')
  assert.equal(verdictOf({ changed: 300, strong: 239, perimeter2px: 240 }), 'faint')
  assert.equal(verdictOf({ changed: 120, strong: 0, perimeter2px: 240 }), 'faint')
  assert.equal(verdictOf({ changed: 119, strong: 119, perimeter2px: 240 }), 'none')
  assert.equal(verdictOf({ changed: 0, strong: 0, perimeter2px: 240 }), 'none')
})

test('measureStop: a 3 px blue ring at offset 2 on white passes', () => {
  const blurred = img(56, 36, [255, 255, 255])
  const focused = ring(img(56, 36, [255, 255, 255]), BOX, 2, 3, [26, 92, 255])
  const m = measureStop(focused, blurred, { w: 40, h: 20 })
  assert.equal(m.verdict, 'pass')
  assert.ok(m.strong >= m.perimeter2px)
  assert.equal(m.changed, m.strong)
})

test('measureStop: a light gray ring is visible but faint; no change is none', () => {
  const blurred = img(56, 36, [255, 255, 255])
  const gray = ring(img(56, 36, [255, 255, 255]), BOX, 2, 3, [200, 200, 200]) // about 1.6:1 against white
  assert.equal(measureStop(gray, blurred, { w: 40, h: 20 }).verdict, 'faint')
  const same = measureStop(img(56, 36, [255, 255, 255]), blurred, { w: 40, h: 20 })
  assert.deepEqual([same.changed, same.strong, same.verdict], [0, 0, 'none'])
  // A 1 px dark ring: strong, but a 1 px ring is under the 2 px area.
  const thin = ring(img(56, 36, [255, 255, 255]), BOX, 0, 1, [0, 0, 0])
  assert.equal(measureStop(thin, blurred, { w: 40, h: 20 }).verdict, 'faint')
})

test('measureStop: antialiasing-level differences do not count as change', () => {
  const blurred = img(20, 20, [255, 255, 255])
  const focused = img(20, 20, [250, 250, 250]) // summed difference 15 < 30
  assert.equal(measureStop(focused, blurred, { w: 4, h: 4 }).changed, 0)
  assert.throws(() => measureStop(img(10, 10, [0, 0, 0]), blurred, { w: 4, h: 4 }), /differ in size/)
})

test('surroundings: the dominant color outside the control box', () => {
  const im = img(56, 36, [30, 40, 90])
  for (let y = 8; y < 28; y++) for (let x = 8; x < 48; x++) { const k = (y * 56 + x) * 4; im.data[k] = 255; im.data[k + 1] = 0; im.data[k + 2] = 0 }
  assert.equal(surroundings(im, BOX), '#1e285a')
})

test('summarizeStops: counts verdicts, keeps skipped stops out of measured', () => {
  const s = summarizeStops([{ verdict: 'pass', changed: 9 }, { verdict: 'faint', changed: 4 }, { verdict: 'none', changed: 0 }, { verdict: 'none', changed: 2 }, { skipped: 'offscreen' }])
  assert.deepEqual(s, { stops: 5, measured: 4, pass: 1, faint: 1, none: 2, noChange: 1, skipped: 1 })
})

// ---- ring color -----------------------------------------------------------------------------------------------------

const TOKENS = [
  { name: 'color.blue.500', tier: 'primitive', value: '#5e72e4ff' },
  { name: 'color.action.primary', tier: 'semantic', value: '#5e72e4ff' },
  { name: 'color.blue.800', tier: 'primitive', value: '#32325dff' },
  { name: 'link.active.bg', tier: 'component', value: '#ffffffff' },
  { name: 'color.surface.default', tier: 'semantic', value: '#ffffffff' },
  { name: 'color.black-a50', tier: 'primitive', value: '#00000080' }, // translucent: never a ring color
]

test('pickRingColor: one color covering every control wins; action.primary over a primitive with the same value', () => {
  const r = pickRingColor([{ bg: '#ffffff' }, { bg: '#f6f9fc' }], TOKENS)
  assert.equal(r.mode, 'single')
  assert.equal(r.total, 2)
  // blue.800 also covers both (higher worst ratio) but coverage ties and action.primary is preferred.
  assert.equal(r.color.token, 'color.action.primary')
  assert.equal(r.color.value, '#5e72e4')
  assert.ok(!('rank' in r.color))
})

test('pickRingColor: coverage beats preference', () => {
  // On a mid-gray, action.primary falls under 3:1 and only the dark navy covers both backgrounds.
  const r = pickRingColor([{ bg: '#ffffff' }, { bg: '#c0c8d0' }], TOKENS)
  assert.equal(r.mode, 'single')
  assert.equal(r.color.token, 'color.blue.800')
})

test('pickRingColor: no single token reaches 3:1 everywhere -> two-tone, darkest + lightest, preferred names', () => {
  const r = pickRingColor([{ bg: '#ffffff' }, { bg: '#5e72e4' }, { bg: '#172b4d' }], TOKENS)
  assert.equal(r.mode, 'two-tone')
  assert.equal(r.color.token, 'color.blue.800')
  assert.equal(r.inner.token, 'color.surface.default') // semantic over the component token with the same white
  assert.equal(r.covered, 3)
  assert.ok(r.bestSingle && r.bestSingle.covered < 3)
  assert.match(ringText(r), /two-tone/)
})

test('pickRingColor: no color tokens -> black and white two-tone', () => {
  const r = pickRingColor([{ bg: '#777777' }], [])
  assert.equal(r.mode, 'two-tone')
  assert.deepEqual([r.color.value, r.inner.value], ['#000000', '#ffffff'])
})

// ---- CSS ----------------------------------------------------------------------------------------------------------

test('focusTokensCss + withFocusTokens: component tokens alias the chosen token; a re-run replaces the block', () => {
  const choice = pickRingColor([{ bg: '#ffffff' }], TOKENS)
  const block = focusTokensCss(choice)
  assert.match(block, /--focus-ring-color: var\(--color-action-primary, #5e72e4\);/)
  assert.match(block, /--focus-ring-width: 3px;/)
  assert.match(block, /--focus-ring-offset: 2px;/)
  const base = ':root {\n  --color-action-primary: #5e72e4;\n}\n'
  const once = withFocusTokens(base, block)
  const twice = withFocusTokens(once, block)
  assert.equal(once, twice)
  assert.ok(once.startsWith(base))
})

test('focusRuleCss: :focus-visible only, !important outline; two-tone adds the light bands', () => {
  const single = focusRuleCss(pickRingColor([{ bg: '#ffffff' }], TOKENS))
  assert.match(single, /:focus-visible \{/)
  assert.ok(single.includes(`:is(${NATIVE_FOCUSABLE}, *):focus-visible`))
  assert.match(single, /outline: var\(--focus-ring-width, 3px\) solid var\(--focus-ring-color, #5e72e4\) !important;/)
  assert.match(single, /outline-offset: var\(--focus-ring-offset, 2px\) !important;/)
  assert.ok(!/box-shadow/.test(single))
  assert.ok(!/:focus(?!-visible)/.test(single.replace(/\/\*[\s\S]*?\*\//g, '')), 'never plain :focus (mouse clicks would show rings)')
  const two = focusRuleCss(pickRingColor([{ bg: '#ffffff' }, { bg: '#172b4d' }, { bg: '#5e72e4' }], TOKENS))
  assert.match(two, /box-shadow: 0 0 0 var\(--focus-ring-offset, 2px\) var\(--focus-ring-inner-color, #ffffff\)/)
  assert.match(focusTokensCss(pickRingColor([{ bg: '#ffffff' }, { bg: '#172b4d' }, { bg: '#5e72e4' }], TOKENS)), /--focus-ring-inner-color: var\(--color-surface-default, #ffffff\);/)
})

// ---- reachability -------------------------------------------------------------------------------------------------

test('containment: share of the inner box inside the outer one', () => {
  assert.equal(containment([0, 0, 10, 10], [0, 0, 20, 20]), 1)
  assert.equal(containment([15, 0, 10, 10], [0, 0, 20, 20]), 0.5)
  assert.equal(containment([0, 0, 0, 0], [0, 0, 20, 20]), 0)
})

test('unreachableControls: flags clickable SAM controls with no Tab stop unless a native focusable or disabled element sits there', () => {
  const regions = [
    { id: 'r1', label: 'button', source: 'sam3.1', bbox: [0, 0, 100, 30] }, // div with a click handler, no stop
    { id: 'r2', label: 'button', source: 'sam3.1', bbox: [0, 100, 100, 30] }, // reached by a Tab stop
    { id: 'r3', label: 'button', source: 'sam3.1', bbox: [0, 200, 100, 30] }, // disabled button, no stop
    { id: 'r4', label: 'icon', source: 'sam3.1', bbox: [0, 300, 20, 20] }, // not clickable
    { id: 'r5', label: 'card', source: 'sam3.1', bbox: [0, 400, 100, 30] }, // not a control label
    { id: 'r6', label: 'button', source: 'mock-dom', bbox: [0, 500, 100, 30] }, // not from SAM
  ]
  const elements = [
    { clickable: true, bbox: [0, 0, 100, 30] }, { clickable: true, bbox: [0, 100, 100, 30] }, { clickable: true, bbox: [0, 200, 100, 30] },
    { clickable: false, bbox: [0, 300, 20, 20] }, { clickable: true, bbox: [0, 400, 100, 30] }, { clickable: true, bbox: [0, 500, 100, 30] },
  ]
  const stops = [{ page: [0, 100, 100, 30] }, { skipped: 'zero size' }]
  const native = { r1: { exempt: false, tag: 'div.btn' }, r3: { exempt: true, tag: 'button', why: 'disabled' } }
  const r = unreachableControls({ regions, elements, stops, native })
  assert.equal(r.samControls, 4)
  assert.equal(r.clickable, 3)
  assert.equal(r.unreached, 2)
  assert.deepEqual(r.flagged.map((x) => x.id), ['r1'])
  assert.deepEqual(r.exempt.map((x) => [x.id, x.why]), [['r3', 'disabled']])
})

// ---- report + PR --------------------------------------------------------------------------------------------------

const FOCUS = {
  cap: 400,
  before: { stops: 25, measured: 25, pass: 0, faint: 2, none: 23, noChange: 20, skipped: 0 },
  reachability: { samControls: 9, clickable: 7, unreached: 7, flagged: [{ id: 'r1', label: 'button', bbox: [1, 2, 3, 4], tag: 'div.n5' }], exempt: [] },
  ring: { mode: 'single', color: { token: 'color.action.primary', value: '#5e72e4', covered: 25 }, covered: 25, total: 25 },
  fix: { after: { stops: 25, measured: 25, pass: 24, faint: 0, none: 1 }, unchanged: { fallback: { diffPixels: 0, ratio: 0 }, colors: { diffPixels: 0, ratio: 0 } }, stops: [{ tag: 'div', text: 'table', changed: 0, strong: 0, perimeter2px: 900, verdict: 'none' }] },
  stops: [],
}

test('focusPrSection: before/after counts, the tokens, the 0 px line, reachability', () => {
  const md = focusPrSection(FOCUS, 'src/focus.css').join('\n')
  assert.match(md, /## Visible keyboard focus \(WCAG 2.4.13 style\)/)
  assert.match(md, /\| Before \| 0 \| 2 \| 23 \| 25 \|/)
  assert.match(md, /\| After this PR \| 24 \| 0 \| 1 \| 25 \|/)
  assert.match(md, /`src\/focus.css`/)
  assert.match(md, /fallback-only render 0 px/)
  assert.match(md, /1 has no Tab stop/)
  assert.ok(!/\baccessible\b|compliant/i.test(md))
  assert.deepEqual(focusPrSection(null), [])
})

test('prBody: a verify-table row and the focus section when focus.json exists', () => {
  const body = prBody({ tokens: { tokens: [], namer: 'x' }, rewrite: { edits: [], files: [] }, verify: null, tokensCssRel: 'tokens.css', focus: FOCUS })
  assert.match(body, /\| Visible focus \(WCAG 2.4.13\), reported \| 0 of 25 Tab stops pass before, 24 of 25 with the focus tokens \|/)
  assert.match(body, /## Visible keyboard focus/)
  const none = prBody({ tokens: { tokens: [], namer: 'x' }, rewrite: { edits: [], files: [] }, verify: null, tokensCssRel: 'tokens.css' })
  assert.ok(!/Visible focus/.test(none))
})

test('focusRow: the fifth verify row with counts, ring swatch, and flagged controls', () => {
  const html = focusRow(FOCUS)
  assert.match(html, /Visible focus \(WCAG 2.4.13\)/)
  assert.match(html, /badge-caution/) // 24 of 25: review, not pass
  assert.match(html, /--focus-ring-color/)
  assert.match(html, /#5e72e4/)
  assert.match(html, /div\.n5/)
  assert.equal(focusRow(null), '')
  assert.match(focusRow({ ...FOCUS, fix: { ...FOCUS.fix, after: { ...FOCUS.fix.after, pass: 25, none: 0 } } }), /badge-pass/)
})

// ---- the control page in a real browser (one Chromium; S2T_SKIP_BROWSER=1 skips) -----------------------------------

test('control page: default link pass, outline removed none, custom ring pass, default button faint, themed outline:0 none; with the rule, all pass', { skip: process.env.S2T_SKIP_BROWSER === '1', timeout: 120000 }, async () => {
  const s = await serveDir(join('fixtures', 'focus-control'))
  try {
    const viewport = { width: 1440, height: 900 }
    const before = await measureUrl(s.url, { viewport })
    assert.deepEqual(before.stops.map((x) => [x.text, x.verdict]), [
      ['Default link', 'pass'], ['Outline removed', 'none'], ['Custom ring', 'pass'], ['Default button', 'faint'], ['Themed button', 'none'],
    ])
    const choice = pickRingColor(before.stops, TOKENS)
    assert.equal(choice.color.token, 'color.action.primary')
    const after = await measureUrl(s.url, { viewport, extraCss: focusRuleCss(choice) })
    assert.deepEqual(after.stops.map((x) => x.verdict), ['pass', 'pass', 'pass', 'pass', 'pass'])
  } finally {
    await s.close()
  }
})

test('compareStops: matches stops by tag, text and box; lists the ones a fix made worse with their cause', () => {
  const before = [
    { tag: 'a', text: 'one', page: [0, 0, 10, 10], verdict: 'faint' },
    { tag: 'a', text: 'two', page: [0, 20, 10, 10], verdict: 'faint' },
    { tag: 'a', text: 'card', page: [0, 40, 10, 10], verdict: 'faint' },
    { tag: 'a', text: 'gone', page: [0, 60, 10, 10], verdict: 'none' },
  ]
  const after = [
    { tag: 'a', text: 'one', page: [0, 0, 10, 10], verdict: 'pass' },
    { tag: 'a', text: 'two', page: [0, 24, 10, 10], verdict: 'none', clippedBy: 'article.card' }, // moved 4 px: still matched
    { tag: 'a', text: 'card', page: [0, 40, 10, 10], verdict: 'none', inlineWrapsBlock: true },
    { tag: 'a', text: 'new', page: [0, 80, 10, 10], verdict: 'pass' },
  ]
  const c = compareStops(before, after)
  assert.deepEqual([c.matched, c.better, c.same, c.worse.length], [3, 1, 0, 2])
  assert.equal(c.worse[0].clippedBy, 'article.card')
  assert.match(worseText(c.worse), /2 stops are worse with the fix: 1 inside a container that clips overflow.*1 inline link wrapping block content/)
})
