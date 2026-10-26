import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyReview, usableTokens } from '../src/stages/review.js'

const clusters = [
  { id: 'color-01', kind: 'color', value: '#1a73e8ff', members: [{ value: '#1a73e8ff', count: 3 }], count: 3, props: {}, regionLabels: {} },
  { id: 'shadow-01', kind: 'shadow', value: 'x', members: [{ value: 'x', count: 1 }], count: 1, props: {}, regionLabels: {} },
]
const set = { namer: 't', tokens: [
  { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: '' },
  { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: '' },
  { name: 'button.bg', tier: 'component', alias: 'color.action.primary', clusters: ['color-01'], why: '' },
  { name: 'shadow.1', tier: 'primitive', value: 'x', clusters: ['shadow-01'], why: '' },
  { name: 'card.shadow', tier: 'component', alias: 'shadow.1', clusters: ['shadow-01'], why: '' },
] }

test('applyReview: rename follows aliases, reject drops non-primitives, primitives survive', () => {
  const out = applyReview(set, { decisions: [
    { name: 'color.blue.500', action: 'rename', to: 'color.brand.500' },
    { name: 'color.action.primary', action: 'reject' },
    { name: 'shadow.1', action: 'reject' },
    { name: 'card.shadow', action: 'accept' },
    { name: 'nope', action: 'accept' },
  ] }, clusters)
  const names = out.tokens.map((t) => t.name)
  assert.ok(names.includes('color.brand.500'))
  assert.ok(!names.includes('color.action.primary'))
  assert.equal(out.tokens.find((t) => t.name === 'button.bg').alias, 'color.brand.500')
  assert.ok(names.includes('shadow.1'), 'rejected primitive kept for coverage')
  assert.ok(!usableTokens(out).tokens.some((t) => t.name === 'shadow.1'))
  assert.match(out.reviewed.notes.join(), /no token nope/)
})

test('applyReview: accepted merge folds a cluster into the survivor primitive', () => {
  const clusters2 = [
    { id: 'radius-01', kind: 'radius', value: '4px', members: [{ value: '4px', count: 5 }], count: 5, props: {}, regionLabels: {} },
    { id: 'radius-02', kind: 'radius', value: '6px', members: [{ value: '6px', count: 1 }], count: 1, props: {}, regionLabels: {} },
  ]
  const set2 = { namer: 't', merges: [{ from: 'radius-02', into: 'radius-01', why: 'close' }], tokens: [
    { name: 'radius.sm', tier: 'primitive', value: '4px', clusters: ['radius-01'], why: '' },
    { name: 'radius.md', tier: 'primitive', value: '6px', clusters: ['radius-02'], why: '' },
    { name: 'badge.radius', tier: 'component', alias: 'radius.md', clusters: ['radius-02'], why: '' },
  ] }
  const out = applyReview(set2, { decisions: [{ action: 'merge', from: 'radius-02', into: 'radius-01' }] }, clusters2)
  assert.ok(!out.tokens.some((t) => t.name === 'radius.md'))
  assert.deepEqual(out.tokens.find((t) => t.name === 'radius.sm').clusters, ['radius-01', 'radius-02'])
  assert.equal(out.tokens.find((t) => t.name === 'badge.radius').alias, 'radius.sm')
  assert.deepEqual(out.merges, [])
  assert.deepEqual(out.warnings, [])
})
