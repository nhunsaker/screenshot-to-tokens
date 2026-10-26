import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iou, scoreSegmentation, goNoGo, formatSegScore, resolveOracle, oracleFor } from '../src/stages/segeval.js'

const R = (id, label, bbox) => ({ id, label, bbox, score: 1, source: 't' })

test('iou', () => {
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1)
  assert.equal(iou([0, 0, 10, 10], [20, 20, 5, 5]), 0)
  assert.ok(Math.abs(iou([0, 0, 10, 10], [5, 0, 10, 10]) - 50 / 150) < 1e-9)
})

test('scoreSegmentation: per label, one-to-one matching, label-agnostic recall', () => {
  const oracle = [R('a', 'button', [0, 0, 100, 40]), R('b', 'button', [200, 0, 100, 40]), R('c', 'card', [0, 100, 300, 200])]
  const pred = [
    R('p1', 'button', [2, 1, 98, 40]),     // matches a
    R('p2', 'button', [3, 2, 96, 38]),     // duplicate of a: must not double-count
    R('p3', 'card', [200, 0, 100, 40]),    // right box, wrong label (b)
    R('p4', 'card', [0, 100, 300, 200]),   // matches c
  ]
  const s = scoreSegmentation(pred, oracle)
  assert.equal(s.perLabel.button.matched, 1)
  assert.equal(s.perLabel.button.recall, 0.5)
  assert.equal(s.perLabel.button.precision, 0.5)
  assert.equal(s.perLabel.card.recall, 1)
  assert.equal(s.anyLabel.matched, 3)
  const v = goNoGo(s)
  assert.equal(v.go, false)
  assert.match(v.reasons.join(), /button recall 50%/)
  assert.match(formatSegScore(s, v), /NO-GO/)
})

test('goNoGo passes when key labels are found', () => {
  const oracle = [R('a', 'button', [0, 0, 100, 40]), R('c', 'card', [0, 100, 300, 200])]
  assert.equal(goNoGo(scoreSegmentation(oracle, oracle)).go, true)
})

test('resolveOracle: prefers a hand-labeled truth file over the DOM oracle', () => {
  const capture = { elements: [{ i: 0, tag: 'div', role: null, bbox: [0, 0, 10, 10], styles: {} }] }
  const truth = [R('h0', 'button', [5, 5, 50, 20])]
  assert.deepEqual(resolveOracle(capture, truth), truth)
  assert.deepEqual(resolveOracle(capture, null), oracleFor(capture))
  assert.deepEqual(resolveOracle(capture, []), oracleFor(capture))
})

test('postprocessRegions: min size, per-label NMS, nested pairs kept', async () => {
  const { postprocessRegions } = await import('../src/stages/segeval.js')
  const out = postprocessRegions([
    R('a', 'card', [0, 0, 300, 200]),
    R('b', 'card', [2, 2, 298, 198]),       // duplicate card → suppressed
    R('c', 'button', [10, 10, 100, 40]),    // nested in card, different label → kept
    R('d', 'icon', [0, 0, 4, 4]),           // speck → dropped
  ])
  assert.deepEqual(out.map((r) => r.label), ['card', 'button'])
  assert.deepEqual(out.map((r) => r.id), ['r0', 'r1'])
})
