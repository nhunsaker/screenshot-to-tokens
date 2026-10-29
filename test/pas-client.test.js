// Point and say, lane B: pure client helpers (overlay geometry, proposal wording, regression detection).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fmtRatio, contrastLine, focusLine, changeLine, blockedMessage, compareAudits,
  toCaptureXY, captureBoxToOverlay, overlayBoxesFor, clampRecordMs, escapeHtml, prCommandText, whyLine, proposalTitle,
  changeNote, allNoop, ringNote, predictedBlock, pageAuditLine,
} from '../src/preview-client/pas-client.js'

// ---- wording -------------------------------------------------------------------------------------------------

test('fmtRatio: 2 decimals + ":1"', () => {
  assert.equal(fmtRatio(4.5), '4.50:1')
  assert.equal(fmtRatio(2.953), '2.95:1')
  assert.equal(fmtRatio(4.526), '4.53:1')
})

test('contrastLine matches the plan\'s on-screen line and never says "accessible" bare', () => {
  const line = contrastLine(21, 2.95, 4.53)
  assert.equal(line, 'text contrast: 21 elements, 2.95:1 → 4.53:1')
  assert.doesNotMatch(line, /\baccessible\b/i)
  assert.doesNotMatch(line, /\bcompliant\b/i)
  assert.equal(contrastLine(1, 3, 4.5), 'text contrast: 1 element, 3.00:1 → 4.50:1')
})

test('focusLine: "0 of 25 -> 25 of 25 controls"', () => {
  assert.equal(focusLine(0, 25, 25), 'visible focus: 0 of 25 → 25 of 25 controls')
  assert.equal(focusLine(1, 1, 1), 'visible focus: 1 of 1 → 1 of 1 control')
})

test('changeLine: token old -> new', () => {
  assert.equal(changeLine({ token: 'color.text.muted', from: '#8898aa', css: '#687889' }), 'color.text.muted: #8898aa → #687889')
  assert.equal(changeLine({ token: 'button.bg', value: '#5e72e4', css: 'var(--color-blue-500)' }), 'button.bg: #5e72e4 → var(--color-blue-500)')
})

test('blockedMessage names the check and the worst-hit element, with numbers', () => {
  const regressions = [
    { text: 'Copyright', from: 4.6, to: 4.2 },
    { text: 'Since last month', from: 4.53, to: 2.95 },
  ]
  const msg = blockedMessage('text contrast', regressions)
  assert.match(msg, /^BLOCKED: text contrast would regress on/)
  assert.match(msg, /Since last month/) // worst (lowest "to") named, not just the first
  assert.match(msg, /2\.95:1/)
  assert.match(msg, /, and 1 more/)
  assert.doesNotMatch(msg, /\baccessible\b/i)
})

test('blockedMessage with no regressions still names the check', () => {
  assert.equal(blockedMessage('focus ring', []), 'BLOCKED: focus ring would regress.')
})

test('proposalTitle and whyLine', () => {
  assert.equal(proposalTitle('contrast'), 'Contrast fix')
  assert.equal(proposalTitle('focus'), 'Focus ring')
  assert.equal(proposalTitle('muse'), 'Token change')
  assert.equal(whyLine('brand blue', 'fallback'), 'brand blue')
  assert.equal(whyLine('  ', 'fallback'), 'fallback')
  assert.match(whyLine(null), /no further reason/)
})

// ---- regression detection --------------------------------------------------------------------------------------

test('compareAudits: fail -> pass counts as fixed, no regressions', () => {
  const before = [{ id: 'p1', status: 'fail', ratio: 2.95, text: 'Since last month', required: 4.5 }]
  const after = [{ id: 'p1', status: 'pass', ratio: 4.53 }]
  const c = compareAudits(before, after)
  assert.equal(c.fixed, 1)
  assert.equal(c.stillFail, 0)
  assert.equal(c.regressions.length, 0)
  assert.equal(c.allPass, true)
})

test('compareAudits: pass -> fail is a regression (BLOCKED)', () => {
  const before = [{ id: 'p1', status: 'pass', ratio: 4.6, text: 'Copyright', required: 4.5 }]
  const after = [{ id: 'p1', status: 'fail', ratio: 4.2 }]
  const c = compareAudits(before, after)
  assert.equal(c.regressions.length, 1)
  assert.equal(c.regressions[0].text, 'Copyright')
  assert.equal(c.allPass, false)
})

test('compareAudits: still failing but worse is also a regression; still failing but unchanged is not', () => {
  const before = [
    { id: 'p1', status: 'fail', ratio: 3.0, text: 'a', required: 4.5 },
    { id: 'p2', status: 'fail', ratio: 2.0, text: 'b', required: 4.5 },
  ]
  const after = [
    { id: 'p1', status: 'fail', ratio: 2.5 }, // worse -> regression
    { id: 'p2', status: 'fail', ratio: 2.0 }, // unchanged -> not a regression, not "affected"
  ]
  const c = compareAudits(before, after)
  assert.equal(c.regressions.length, 1)
  assert.equal(c.regressions[0].text, 'a')
  assert.equal(c.affected.length, 1)
})

test('compareAudits ignores pairs missing from "after" or with no ratio', () => {
  const before = [{ id: 'p1', status: 'pass', ratio: 5 }, { id: 'p2', status: 'missing', ratio: null }]
  const after = [{ id: 'p1', status: 'pass', ratio: 5 }]
  const c = compareAudits(before, after)
  assert.deepEqual(c, { affected: [], regressions: [], fixed: 0, stillFail: 0, allPass: true })
})

// ---- overlay geometry -----------------------------------------------------------------------------------------

test('toCaptureXY / captureBoxToOverlay are inverses at any display scale', () => {
  const captureViewport = { width: 1440, height: 900 }
  const iframeSize = { width: 720, height: 450 } // shown at half size
  const p = toCaptureXY({ x: 215, y: 111 }, iframeSize, captureViewport)
  assert.ok(Math.abs(p.x - 430) < 1e-9 && Math.abs(p.y - 222) < 1e-9)
  const box = captureBoxToOverlay([378, 213, 104, 19], iframeSize, captureViewport)
  assert.deepEqual(box, { left: 189, top: 106.5, width: 52, height: 9.5 })
})

test('toCaptureXY / captureBoxToOverlay at 1:1 scale is identity', () => {
  const vp = { width: 1440, height: 900 }
  assert.deepEqual(toCaptureXY({ x: 10, y: 20 }, vp, vp), { x: 10, y: 20 })
  assert.deepEqual(captureBoxToOverlay([1, 2, 3, 4], vp, vp), { left: 1, top: 2, width: 3, height: 4 })
})

test('overlayBoxesFor: outline first, then twins, each tagged by kind', () => {
  const point = {
    outline: { bbox: [10, 10, 20, 20] },
    element: { bbox: [10, 10, 20, 20] },
    twins: [{ bbox: [50, 10, 20, 20] }, { bbox: [90, 10, 20, 20] }],
  }
  const vp = { width: 100, height: 100 }
  const boxes = overlayBoxesFor(point, vp, vp)
  assert.equal(boxes.length, 3)
  assert.equal(boxes[0].kind, 'outline')
  assert.equal(boxes[1].kind, 'twin')
  assert.equal(boxes[2].kind, 'twin')
  assert.deepEqual(boxes[1], { left: 50, top: 10, width: 20, height: 20, kind: 'twin' })
})

test('overlayBoxesFor falls back to the element box when SAM found no outline', () => {
  const point = { outline: null, element: { bbox: [5, 5, 10, 10] }, twins: [] }
  const boxes = overlayBoxesFor(point, { width: 10, height: 10 }, { width: 10, height: 10 })
  assert.deepEqual(boxes, [{ left: 5, top: 5, width: 10, height: 10, kind: 'element' }])
})

// ---- contract v2 --------------------------------------------------------------------------------------------------

test('overlayBoxesFor (v2): a click on a control draws the control box; a click on text does not draw its card', () => {
  const vp = { width: 100, height: 100 }
  // "Month" label span inside a.btn: outline is the control's DOM box (dom-control).
  const month = { outline: { bbox: [40, 10, 30, 12], source: 'dom-control' }, element: { bbox: [45, 12, 20, 8], control: { tag: 'a', bbox: [40, 10, 30, 12] } }, twins: [] }
  assert.deepEqual(overlayBoxesFor(month, vp, vp).map((b) => b.kind), ['control'])
  // SAM outline on an icon inside a button whose box differs: both drawn.
  const icon = { outline: { bbox: [10, 10, 8, 8], source: 'sam' }, element: { bbox: [10, 10, 8, 8], control: { bbox: [5, 5, 30, 18] } }, twins: [] }
  assert.deepEqual(overlayBoxesFor(icon, vp, vp).map((b) => b.kind), ['outline', 'control'])
  // Text: the DOM outline only, even though a card paints its background.
  const text = { outline: { bbox: [20, 20, 30, 5], source: 'dom' }, element: { bbox: [20, 20, 30, 5], control: { bbox: [0, 0, 60, 40] } }, twins: [] }
  assert.deepEqual(overlayBoxesFor(text, vp, vp).map((b) => b.kind), ['outline'])
})

test('overlayBoxesFor subtracts the iframe scroll so boxes stay on the element', () => {
  const point = { outline: { bbox: [10, 300, 20, 10], source: 'dom' }, element: null, twins: [{ bbox: [50, 320, 10, 10] }] }
  const vp = { width: 100, height: 100 }
  const boxes = overlayBoxesFor(point, { width: 50, height: 50 }, vp, { x: 0, y: 280 })
  assert.deepEqual(boxes[0], { left: 5, top: 10, width: 10, height: 5, kind: 'outline' })
  assert.deepEqual(boxes[1], { left: 25, top: 20, width: 5, height: 5, kind: 'twin' })
})

test('changeNote: noop, retarget and alias swap from contract v2', () => {
  assert.equal(changeNote({ token: 'button.bg', alias: 'color.action.primary', noop: true }), 'already that value')
  assert.match(changeNote({ token: 'color.text.muted', retargetedFrom: 'color.blue.400' }), /^moved to the semantic token \(the model named color\.blue\.400\)$/)
  assert.match(changeNote({ token: 'button.bg', alias: 'color.action.primary', aliasPreferred: 'color.blue.500' }), /semantic token color\.action\.primary \(the model said color\.blue\.500\)/)
  assert.equal(changeNote({ token: 'x', alias: 'color.red.500' }), '')
  assert.equal(allNoop([{ noop: true }, { noop: true }]), true)
  assert.equal(allNoop([{ noop: true }, {}]), false)
  assert.equal(allNoop([]), false)
})

test('ringNote: "nearest blue in your tokens is teal" only when the ring used the nearest hue', () => {
  assert.equal(ringNote({ nearest: true, hue: 'blue', color: { token: 'color.teal.300', value: '#1dc7ea' } }), 'nearest blue in your tokens is teal (color.teal.300)')
  assert.equal(ringNote({ nearest: true, hue: 'blue', color: { token: 'brand.accent', value: '#1dc7ea' } }), 'nearest blue in your tokens is brand.accent')
  assert.equal(ringNote({ nearest: false, hue: 'blue', color: { token: 'color.action.primary' } }), '')
  assert.equal(ringNote(null), '')
})

test('predictedBlock: the server reason names the check and the element; null when not blocked', () => {
  assert.equal(predictedBlock({ blocked: false }), null)
  assert.equal(predictedBlock({ blocked: true, reason: 'text contrast: "Month" 4.2 → 3.77 (needs 4.5) and 2 more' }), 'BLOCKED: text contrast: "Month" 4.2 → 3.77 (needs 4.5) and 2 more')
  const m = predictedBlock({ blocked: true, reason: null, regressions: [{ text: 'Dashboard', from: 3.54, to: 2.02 }] })
  assert.match(m, /^BLOCKED: text contrast would regress on “Dashboard”/)
  assert.doesNotMatch(m, /\baccessible\b|\bcompliant\b/i)
})

test('pageAuditLine: whole-page failing before -> after', () => {
  const before = [{ status: 'fail' }, { status: 'fail' }, { status: 'pass' }, { status: 'skipped' }]
  const after = [{ status: 'pass' }, { status: 'fail' }, { status: 'pass' }, { status: 'skipped' }]
  assert.equal(pageAuditLine(before, after), 'whole page: 2 → 1 failing of 3 text pairs checked')
})

// ---- misc -------------------------------------------------------------------------------------------------------

test('clampRecordMs: clamps to [0, max], default max 10 s', () => {
  assert.equal(clampRecordMs(5000), 5000)
  assert.equal(clampRecordMs(15000), 10000)
  assert.equal(clampRecordMs(-5), 0)
  assert.equal(clampRecordMs(9000, 8000), 8000)
})

test('escapeHtml escapes the five special characters', () => {
  assert.equal(escapeHtml(`<b>"a" & 'b'</b>`), '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;')
  assert.equal(escapeHtml(null), '')
})

test('prCommandText: text only, two commands, uses the run dir when given', () => {
  const t = prCommandText('out/argon-run')
  assert.equal(t, 's2t review --run out/argon-run\ns2t pr --run out/argon-run --repo <app git root>')
  assert.match(prCommandText(), /<run dir>/)
})
