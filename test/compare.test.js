import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { summarizeRun, formatCompare, compareRuns } from '../src/stages/compare.js'

test('summarizeRun reads what exists; missing pieces are "-"', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-cmp-'))
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ namer: 'meta:muse-spark-1.3', warnings: ['x'], tokens: [{ tier: 'primitive' }, { tier: 'semantic' }] }))
  writeFileSync(join(dir, 'usage.json'), JSON.stringify([{ usage: { prompt_tokens: 900, completion_tokens: 300 } }]))
  const r = summarizeRun(dir)
  assert.equal(r.namer, 'meta:muse-spark-1.3')
  assert.equal(r.tokens, '2 (1/1/0)')
  assert.equal(r.repairs, '1')
  assert.equal(r.eval, '-')
  assert.equal(r['model tokens in/out'], '900/300')
  assert.match(formatCompare([r, r]), /^run\s+/)
  assert.throws(() => compareRuns([join(dir, 'nope')]), /no run folder/)
})
