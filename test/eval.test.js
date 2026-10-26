import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreRun, formatScore } from '../src/stages/eval.js'

const clusters = [
  { id: 'color-01', kind: 'color', value: '#1a73e8ff', members: [{ value: '#1a73e8ff', count: 3 }, { value: '#1b74e9ff', count: 1 }], count: 4, props: {}, regionLabels: {} },
  { id: 'color-02', kind: 'color', value: '#222222ff', members: [{ value: '#222222ff', count: 2 }], count: 2, props: {}, regionLabels: {} },
  { id: 'color-03', kind: 'color', value: '#333333ff', members: [{ value: '#333333ff', count: 2 }], count: 2, props: {}, regionLabels: {} },
  { id: 'radius-01', kind: 'radius', value: '4px', members: [{ value: '4px', count: 2 }, { value: '5px', count: 1 }], count: 3, props: {}, regionLabels: {} },
]
const tokens = { namer: 't', tokens: [
  ...clusters.map((c) => ({ name: `p.${c.id}`, tier: 'primitive', value: c.value, clusters: [c.id], why: '' })),
  { name: 'color.action.primary', tier: 'semantic', alias: 'p.color-01', clusters: ['color-01'], why: '' },
] }

test('scoreRun: merges, splits, semantics, regions, shape', () => {
  const golden = {
    same: [['#1a73e8', 'rgb(27, 116, 233)'], { kind: 'radius', values: ['4px', '5px'] }],
    different: [['#222', '#333']],
    semantic: [{ value: '#1a73e8', kind: 'color', name: 'color.action.primary' }, { value: '#333', kind: 'color', name: 'color.text.default' }],
    regions: [{ label: 'button', min: 2 }],
  }
  const s = scoreRun({ clusters, tokens, regions: [{ label: 'button' }] }, golden)
  assert.equal(s.byGroup.merge.pass, 3)
  assert.equal(s.byGroup.semantic.pass, 1)
  assert.equal(s.byGroup.segment.pass, 0)
  assert.equal(s.byGroup.shape.pass, 2)
  assert.match(formatScore(s), /✗ semantic: color.text.default/)
})
