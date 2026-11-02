import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordCall, mark, since } from '../src/lib/metrics.js'

test('metrics keep a bounded ring; marks stay valid after old calls drop', () => {
  for (let i = 0; i < 700; i++) recordCall({ kind: 'sam', model: 'sam-3.1', ms: 1 })
  const m = mark()
  assert.ok(m >= 700)
  recordCall({ kind: 'sam', model: 'sam-3.1', ms: 1 })
  recordCall({ kind: 'sam', model: 'sam-3.1', ms: 1, cached: true })
  const s = since(m)
  assert.equal(s.calls, 2)
  assert.equal(s.cached, 1)
  assert.equal(s.usd, 0.0025)
  // A mark older than the ring sees only what is still kept (at most 500 calls), never throws.
  assert.ok(since(0).calls <= 500)
})
