import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeHex, extractClaims, checkGrounding, templatedReason, rolesDiffer, evaluateReason,
} from '../src/stages/reasons.js'

const colorCluster = {
  id: 'color-03', kind: 'color', value: '#333333ff',
  members: [{ value: '#333333ff', count: 22 }, { value: '#343434ff', count: 10 }],
  count: 32, props: { color: 32 }, regionLabels: { button: 6, card: 26 },
}

const radiusCluster = {
  id: 'radius-01', kind: 'radius', value: '4px',
  members: [{ value: '4px', count: 2 }],
  count: 2, props: { 'border-top-left-radius': 2 }, regionLabels: {},
}

const bgOnlyCluster = {
  id: 'color-04', kind: 'color', value: '#1a73e8ff',
  members: [{ value: '#1a73e8ff', count: 20 }],
  count: 20, props: { 'background-color': 20 }, regionLabels: { button: 20 },
}

const textOnlyCluster = {
  id: 'color-05', kind: 'color', value: '#1a73e8ff',
  members: [{ value: '#1a73e8ff', count: 15 }],
  count: 15, props: { color: 15 }, regionLabels: { text: 15 },
}

// A single cluster used both as background and as text, in meaningful proportion each way.
const mixedRoleCluster = {
  id: 'color-06', kind: 'color', value: '#1a73e8ff',
  members: [{ value: '#1a73e8ff', count: 10 }],
  count: 10, props: { 'background-color': 6, color: 4 }, regionLabels: { button: 6, text: 4 },
}

const clusters = [colorCluster, radiusCluster, bgOnlyCluster, textOnlyCluster, mixedRoleCluster]

// ---------------------------------------------------------------------------
// normalizeHex
// ---------------------------------------------------------------------------

test('normalizeHex expands shorthand and drops bad input', () => {
  assert.equal(normalizeHex('#333'), '333333ff')
  assert.equal(normalizeHex('#343434'), '343434ff')
  assert.equal(normalizeHex('#343434ff'), '343434ff')
  assert.equal(normalizeHex('#abcd'), 'aabbccdd')
  assert.equal(normalizeHex('not-a-color'), null)
  assert.equal(normalizeHex(null), null)
})

// ---------------------------------------------------------------------------
// extractClaims
// ---------------------------------------------------------------------------

test('extractClaims pulls hex, px, bare numbers and recognized words out of a sentence', () => {
  const claims = extractClaims('Used 23 times as text color in cards and buttons; merges #333 and #343434, was 16px before.')
  assert.deepEqual(claims.hex, ['#333', '#343434'])
  assert.deepEqual(claims.px, [16])
  assert.deepEqual(claims.numbers, [23])
  assert.ok(claims.props.some((g) => g.includes('color')))
  assert.ok(claims.regions.includes('card'))
  assert.ok(claims.regions.includes('button'))
})

test('extractClaims does not double-count numbers embedded in hex codes or px values', () => {
  const claims = extractClaims('close to #343434, roughly 16px wide')
  assert.deepEqual(claims.numbers, [])
})

test('extractClaims returns no claims for a plain unclaimed sentence', () => {
  const claims = extractClaims('most-used blue')
  assert.deepEqual(claims.hex, [])
  assert.deepEqual(claims.px, [])
  assert.deepEqual(claims.numbers, [])
  assert.deepEqual(claims.props, [])
  assert.deepEqual(claims.regions, [])
})

test('extractClaims does not let "text color" leave a stray "text" region claim or a bare "color" claim behind', () => {
  const claims = extractClaims('Dominant text color with 32 uses across card and button.')
  assert.deepEqual(claims.props, [['color']])
  assert.deepEqual(claims.regions.sort(), ['button', 'card'])
})

// ---------------------------------------------------------------------------
// checkGrounding
// ---------------------------------------------------------------------------

test('checkGrounding passes a why whose claims all match the cluster data', () => {
  const token = { name: 'color.gray.800', clusters: ['color-03'], why: 'Dominant text color with 32 uses across card and button.' }
  const { grounded, unsupported } = checkGrounding(token, clusters)
  assert.equal(grounded, true)
  assert.deepEqual(unsupported, [])
})

test('checkGrounding flags an unsupported hex that is not one of the cluster members', () => {
  const token = { name: 'color.gray.800', clusters: ['color-03'], why: 'Merges #333333 and #ff00ff.' }
  const { grounded, unsupported } = checkGrounding(token, clusters)
  assert.equal(grounded, false)
  assert.match(unsupported.join(' '), /#ff00ff/)
})

test('checkGrounding flags an unsupported px value', () => {
  const token = { name: 'radius.sm', clusters: ['radius-01'], why: 'Corner radius, used at 8px.' }
  const { grounded, unsupported } = checkGrounding(token, clusters)
  assert.equal(grounded, false)
  assert.match(unsupported.join(' '), /8px/)
})

test('checkGrounding flags an unsupported usage count', () => {
  const token = { name: 'color.gray.800', clusters: ['color-03'], why: 'Used 999 times.' }
  const { grounded, unsupported } = checkGrounding(token, clusters)
  assert.equal(grounded, false)
  assert.match(unsupported.join(' '), /999/)
})

test('checkGrounding flags a region word the token\'s clusters never actually use', () => {
  const token = { name: 'color.gray.800', clusters: ['color-03'], why: 'Used as the sidebar nav accent.' }
  const { grounded, unsupported } = checkGrounding(token, clusters)
  assert.equal(grounded, false)
  assert.match(unsupported.join(' '), /nav/)
})

test('checkGrounding treats an empty why as unverified', () => {
  const { grounded, unsupported } = checkGrounding({ name: 'x', clusters: ['color-03'], why: '' }, clusters)
  assert.equal(grounded, false)
  assert.deepEqual(unsupported, ['no reason given'])
})

test('checkGrounding treats a token referencing no known cluster as unverified', () => {
  const { grounded, unsupported } = checkGrounding({ name: 'x', clusters: ['nope'], why: 'solid reasoning' }, clusters)
  assert.equal(grounded, false)
  assert.ok(unsupported.length)
})

// ---------------------------------------------------------------------------
// templatedReason
// ---------------------------------------------------------------------------

test('templatedReason builds a plain cluster-grounded sentence with merge members listed', () => {
  const text = templatedReason({ name: 'color.gray.800', clusters: ['color-03'] }, clusters)
  assert.match(text, /Used 32 times/)
  assert.match(text, /text color/)
  assert.match(text, /cards?/)
  assert.match(text, /buttons?/)
  assert.match(text, /merges #333333ff and #343434ff/)
})

test('templatedReason handles a cluster with no drifted members and no region data', () => {
  const text = templatedReason({ name: 'radius.sm', clusters: ['radius-01'] }, clusters)
  assert.equal(text, 'Used 2 times as corner radius.')
})

test('templatedReason never throws on a token with no covered clusters', () => {
  assert.equal(templatedReason({ name: 'x', clusters: [] }, clusters), 'No usage data available for this token.')
})

// ---------------------------------------------------------------------------
// rolesDiffer
// ---------------------------------------------------------------------------

test('rolesDiffer is false for a cluster used in one consistent role', () => {
  assert.equal(rolesDiffer({ name: 'color.action.bg', clusters: ['color-04'] }, clusters), false)
})

test('rolesDiffer is true when one cluster is used meaningfully as both background and text', () => {
  assert.equal(rolesDiffer({ name: 'color.mixed', clusters: ['color-06'] }, clusters), true)
})

test('rolesDiffer is true when a token merges clusters with conflicting dominant roles and no shared region', () => {
  // color-04 is all background/button, color-05 is all text/text-region: no overlap, different roles.
  const token = { name: 'color.action.primary', clusters: ['color-04', 'color-05'] }
  assert.equal(rolesDiffer(token, clusters), true)
})

test('rolesDiffer is false when merged clusters agree on role and share a region', () => {
  const sameRoleA = { id: 'color-07', kind: 'color', value: '#111', members: [{ value: '#111', count: 5 }], count: 5, props: { 'background-color': 5 }, regionLabels: { button: 5 } }
  const sameRoleB = { id: 'color-08', kind: 'color', value: '#112', members: [{ value: '#112', count: 3 }], count: 3, props: { 'background-color': 3 }, regionLabels: { button: 3 } }
  const token = { name: 'color.action.primary', clusters: ['color-07', 'color-08'] }
  assert.equal(rolesDiffer(token, [sameRoleA, sameRoleB]), false)
})

test('rolesDiffer is false for a token with no covered clusters', () => {
  assert.equal(rolesDiffer({ name: 'x', clusters: [] }, clusters), false)
})

// ---------------------------------------------------------------------------
// evaluateReason (the one call the report makes per token)
// ---------------------------------------------------------------------------

test('evaluateReason keeps a grounded why verbatim and does not flag roles-differ for a clean single-role token', () => {
  const token = { name: 'color.action.primary', clusters: ['color-04'], why: 'Primary button background, used 20 times.' }
  const r = evaluateReason(token, clusters)
  assert.equal(r.grounded, true)
  assert.equal(r.unverified, false)
  assert.equal(r.text, token.why)
  assert.equal(r.rolesDiffer, false)
})

test('evaluateReason falls back to the templated reason when why is ungrounded, and still marks it visible, not hidden', () => {
  const token = { name: 'color.gray.800', clusters: ['color-03'], why: 'Used 999 times in the sidebar.' }
  const r = evaluateReason(token, clusters)
  assert.equal(r.grounded, false)
  assert.equal(r.unverified, true)
  assert.ok(r.unsupported.length >= 1)
  assert.match(r.text, /Used 32 times/) // the templated fallback, not the invented sentence
})

test('evaluateReason flags rolesDiffer independently of grounding', () => {
  const token = { name: 'color.mixed', clusters: ['color-06'], why: 'Primary brand color.' }
  const r = evaluateReason(token, clusters)
  assert.equal(r.rolesDiffer, true)
})
