import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFor, cssVarOf, propKind } from '../src/lib/props.js'
import { containment, regionFor, collectUses } from '../src/stages/join.js'
import { clusterUses, deltaE, near, driftSummary } from '../src/stages/cluster.js'
import { colorPrimitiveName, heuristicTokens } from '../src/providers/llm/heuristic.js'
import { validateTokenSet, resolveValue, runName } from '../src/stages/name.js'
import { extractJson } from '../src/providers/llm/chat.js'
import { promptPayload } from '../src/providers/llm/llm-namer.js'
import { toCss, toDtcg } from '../src/stages/emit.js'
import { regionsFromCapture } from '../src/providers/segment/mock.js'

const el = (i, bbox, styles, extra = {}) => ({ i, tag: 'div', path: 'div', role: null, text: 'x', bbox, styles, ...extra })

const capture = {
  url: 'test', viewport: { width: 800, height: 600 }, screenshot: 's.png', capturedAt: '',
  elements: [
    el(0, [0, 0, 800, 600], { 'background-color': 'rgb(255, 255, 255)', color: 'rgb(51, 51, 51)', 'font-size': '16px' }, { text: '' }),
    el(1, [10, 10, 100, 36], { 'background-color': 'rgb(26, 115, 232)', color: 'rgb(255, 255, 255)', 'border-top-left-radius': '4px', 'font-size': '14px' }, { tag: 'button', role: 'button' }),
    el(2, [120, 10, 100, 36], { 'background-color': 'rgb(27, 116, 233)', color: 'rgb(255, 255, 255)', 'border-top-left-radius': '5px', 'font-size': '14.5px' }, { tag: 'button', role: 'button' }),
    el(3, [10, 100, 300, 200], { 'background-color': 'rgb(250, 250, 250)', 'box-shadow': 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px', 'border-top-left-radius': '8px', color: 'rgb(52, 52, 52)', 'font-size': '16px' }),
    el(4, [20, 110, 80, 20], { color: 'rgb(51, 51, 51)', 'font-size': '16px', 'padding-top': '8px', 'padding-left': '9px' }),
  ],
}

test('normalizeFor drops defaults and transparent, normalizes px', () => {
  assert.equal(normalizeFor('color', 'rgba(0, 0, 0, 0)'), null)
  assert.equal(normalizeFor('color', 'rgb(26, 115, 232)'), '#1a73e8ff')
  assert.equal(normalizeFor('space', '0px'), null)
  assert.equal(normalizeFor('font-family', '"Inter", system-ui, sans-serif'), 'Inter, system-ui, sans-serif')
  assert.equal(cssVarOf('color.action.primary'), '--color-action-primary')
  assert.equal(propKind('border'), 'color')
})

test('join: smallest containing region wins', () => {
  const regions = [{ id: 'big', bbox: [0, 0, 800, 600], label: 'card', score: 1, source: 't' }, { id: 'small', bbox: [5, 5, 120, 50], label: 'button', score: 1, source: 't' }]
  assert.equal(containment([10, 10, 10, 10], [0, 0, 100, 100]), 1)
  assert.equal(regionFor([10, 10, 100, 36], regions).id, 'small')
  assert.equal(regionFor([700, 590, 200, 200], regions), null)
})

test('join skips inherited text props on elements without text', () => {
  const uses = collectUses(capture, [])
  assert.ok(!uses.some((u) => u.element === 0 && u.prop === 'color'))
  assert.ok(uses.some((u) => u.element === 0 && u.prop === 'background-color'))
})

test('cluster merges drift, keeps distinct values apart', () => {
  assert.ok(deltaE('#1a73e8ff', '#1b74e9ff') < 1)
  assert.ok(deltaE('#222222ff', '#333333ff') > 3)
  assert.equal(near('radius', '4px', '5px'), true)
  assert.equal(near('radius', '4px', '8px'), false)
  const regions = regionsFromCapture(capture)
  const clusters = clusterUses(collectUses(capture, regions))
  const blue = clusters.find((c) => c.kind === 'color' && c.members.some((m) => m.value === '#1b74e9ff'))
  assert.equal(blue.members.length, 2)
  const gray = clusters.find((c) => c.kind === 'color' && c.members.some((m) => m.value === '#333333ff'))
  assert.ok(gray.members.some((m) => m.value === '#343434ff'))
  const d = driftSummary(clusters)
  assert.ok(d.merged >= 3)
  assert.ok(clusters.every((c, i) => clusters.findIndex((x) => x.id === c.id) === i))
})

test('color primitive names', () => {
  assert.equal(colorPrimitiveName('#1a73e8ff'), 'color.blue.500')
  assert.equal(colorPrimitiveName('#ffffffff'), 'color.white')
  assert.equal(colorPrimitiveName('#0000001a'), 'color.black-a10')
  assert.match(colorPrimitiveName('#dbe6fbff'), /^color\.blue\./, 'light tint keeps its hue')
  assert.match(colorPrimitiveName('#eef3fcff'), /^color\.blue\./)
  assert.match(colorPrimitiveName('#6c757dff'), /^color\.gray\./, 'cool gray stays gray')
  assert.match(colorPrimitiveName('#333333ff'), /^color\.gray\.\d+$/)
})

test('heuristic tokens: one primitive per cluster, semantics alias primitives', () => {
  const regions = regionsFromCapture(capture)
  const clusters = clusterUses(collectUses(capture, regions))
  const set = validateTokenSet(heuristicTokens({ clusters }), clusters)
  assert.deepEqual(set.warnings, [])
  const prims = set.tokens.filter((t) => t.tier === 'primitive')
  assert.equal(prims.length, clusters.length)
  const action = set.tokens.find((t) => t.name === 'color.action.primary')
  assert.ok(action, 'action.primary from button backgrounds')
  assert.equal(resolveValue('color.action.primary', set.tokens), '#1a73e8ff')
  assert.ok(set.tokens.find((t) => t.name === 'button.radius' && t.tier === 'component'))
})

test('validateTokenSet repairs a sloppy model reply', () => {
  const regions = regionsFromCapture(capture)
  const clusters = clusterUses(collectUses(capture, regions))
  const c0 = clusters[0]
  const sloppy = {
    namer: 'model',
    tokens: [
      { name: 'Brand Blue', tier: 'primitive', value: '#000', clusters: [c0.id], why: 'x' },
      { name: 'brand-blue', tier: 'primitive', value: '#000', clusters: [c0.id] },
      { name: 'ghost', tier: 'primitive', value: '#123', clusters: ['nope'] },
      { name: 'color.link', tier: 'semantic', alias: 'missing.token', clusters: [c0.id], why: 'links' },
      { name: 'a', tier: 'semantic', alias: 'b', clusters: [c0.id] },
      { name: 'b', tier: 'semantic', alias: 'a', clusters: [c0.id] },
    ],
  }
  const set = validateTokenSet(sloppy, clusters)
  assert.equal(set.tokens.find((t) => t.name === 'brand-blue').value, c0.value)
  assert.ok(!set.tokens.some((t) => t.name === 'ghost'))
  assert.equal(set.tokens.filter((t) => t.tier === 'primitive').length >= clusters.length, true)
  assert.equal(resolveValue('color.link', set.tokens), c0.value)
  assert.ok(resolveValue('a', set.tokens))
  assert.ok(set.warnings.length >= 4)
})

test('runName falls back to heuristic when the provider fails', async () => {
  const regions = regionsFromCapture(capture)
  const clusters = clusterUses(collectUses(capture, regions))
  const prev = process.env.META_API_KEY
  delete process.env.META_API_KEY
  const set = await runName({ clusters, regions, namer: 'meta' })
  assert.equal(set.namer, 'mock-heuristic')
  assert.match(set.warnings[0], /not configured/)
  await assert.rejects(runName({ clusters, regions, namer: 'meta', strict: true }), /not configured/)
  if (prev !== undefined) process.env.META_API_KEY = prev
})

test('extractJson handles fences and chatter', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"tokens":[]}\n```'), { tokens: [] })
  assert.deepEqual(extractJson('here {"a":1} done'), { a: 1 })
  assert.throws(() => extractJson('nothing'))
})

test('prompt payload is compact and complete', () => {
  const regions = regionsFromCapture(capture)
  const clusters = clusterUses(collectUses(capture, regions))
  const p = promptPayload(clusters, regions, heuristicTokens({ clusters }))
  assert.equal(p.clusters.length, clusters.length)
  assert.ok(p.regions.button >= 2)
  assert.ok(JSON.stringify(p).length < 8000)
})

test('emit css + dtcg', () => {
  const set = { namer: 't', tokens: [
    { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: '' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: 'buttons' },
  ] }
  const css = toCss(set)
  assert.match(css, /--color-blue-500: #1a73e8;/)
  assert.match(css, /--color-action-primary: var\(--color-blue-500\);/)
  const j = toDtcg(set, [{ id: 'color-01', kind: 'color' }])
  assert.equal(j.color.action.primary.$value, '{color.blue.500}')
  assert.equal(j.color.blue['500'].$type, 'color')
})

test('mock oracle: a padded, filled link is a button', async () => {
  const { labelFor } = await import('../src/providers/segment/mock.js')
  const base = { i: 0, tag: 'a', path: 'a', role: 'link', text: 'Shop', bbox: [0, 0, 160, 40] }
  assert.equal(labelFor({ ...base, styles: { 'background-color': 'rgb(26, 115, 232)', 'padding-left': '16px', 'padding-top': '10px' } }), 'button')
  assert.equal(labelFor({ ...base, styles: { 'background-color': 'rgba(0, 0, 0, 0)', 'padding-left': '0px', 'padding-top': '0px' } }), 'link')
})

test('expandCompact: draft primitives + renames + model tokens, aliases follow renames', async () => {
  const { expandCompact } = await import('../src/providers/llm/llm-namer.js')
  const draft = { tokens: [
    { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: 'Used 9 times.' },
    { name: 'color.gray.800', tier: 'primitive', value: '#333333ff', clusters: ['color-02'], why: 'Used 16 times.' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: 'draft' },
  ] }
  const out = expandCompact({ rename: { 'color-01': 'color.brand.500' }, tokens: [
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: 'Button fills.' },
    { name: 'oops', tier: 'primitive', value: '#000', clusters: ['color-02'] },
  ] }, draft)
  assert.equal(out.renamed, 1)
  assert.deepEqual(out.tokens.filter((t) => t.tier === 'primitive').map((t) => t.name), ['color.brand.500', 'color.gray.800'])
  assert.equal(out.tokens.find((t) => t.name === 'color.action.primary').alias, 'color.brand.500')
  assert.ok(!out.tokens.some((t) => t.name === 'oops'))
})

test('negative and fractional spacing get valid primitive names', async () => {
  const { primitiveNames } = await import('../src/providers/llm/heuristic.js')
  const names = primitiveNames([
    { id: 'space-01', kind: 'space', value: '-96px', members: [], count: 1, props: {}, regionLabels: {} },
    { id: 'space-02', kind: 'space', value: '7.5px', members: [], count: 1, props: {}, regionLabels: {} },
  ])
  assert.equal(names.get('space-01'), 'space.neg-96')
  assert.equal(names.get('space-02'), 'space.7-5')
})
