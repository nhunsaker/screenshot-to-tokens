import { test } from 'node:test'
import assert from 'node:assert/strict'
import { profileComponents, classIndex, componentsForSelector, statesForSelector } from '../src/stages/components.js'
import { componentTokens, componentStateTokens } from '../src/providers/llm/heuristic.js'
import { validateTokenSet } from '../src/stages/name.js'
import { rewriteCss, selectorContext, selectorComponentsAndStates, pickToken } from '../src/providers/coder/deterministic.js'

const el = (i, bbox, classes, styles, text = 'x') => ({ i, tag: 'div', path: 'div', role: null, text, bbox, classes, styles })
const capture = {
  viewport: { width: 1440, height: 900 },
  elements: [
    el(0, [0, 0, 1440, 900], ['page'], { 'background-color': 'rgb(255, 255, 255)' }, ''),
    el(1, [10, 10, 100, 40], ['btn', 'btn-primary', 'mb-2'], { 'background-color': 'rgb(26, 115, 232)', color: 'rgb(255, 255, 255)', 'border-top-left-radius': '4px' }),
    el(2, [120, 10, 100, 40], ['btn', 'btn-primary'], { 'background-color': 'rgb(26, 115, 232)', color: 'rgb(255, 255, 255)', 'border-top-left-radius': '4px' }),
    el(3, [10, 100, 300, 200], ['card', 'shadow'], { 'background-color': 'rgb(250, 250, 250)', 'box-shadow': 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px' }, ''),
  ],
}
const regions = [
  { id: 'r0', label: 'button', bbox: [10, 10, 100, 40], score: 1, source: 'sam3.1' },
  { id: 'r1', label: 'button', bbox: [120, 10, 100, 40], score: 1, source: 'sam3.1' },
  { id: 'r2', label: 'card', bbox: [10, 100, 300, 200], score: 1, source: 'mock-dom' },
]
const clusters = [
  { id: 'color-01', kind: 'color', value: '#1a73e8ff', members: [{ value: '#1a73e8ff', count: 2 }], count: 2, props: {}, regionLabels: {} },
  { id: 'color-02', kind: 'color', value: '#ffffffff', members: [{ value: '#ffffffff', count: 3 }], count: 3, props: {}, regionLabels: {} },
  { id: 'color-03', kind: 'color', value: '#fafafaff', members: [{ value: '#fafafaff', count: 1 }], count: 1, props: {}, regionLabels: {} },
  { id: 'radius-01', kind: 'radius', value: '4px', members: [{ value: '4px', count: 2 }], count: 2, props: {}, regionLabels: {} },
  { id: 'shadow-01', kind: 'shadow', value: 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px', members: [{ value: 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px', count: 1 }], count: 1, props: {}, regionLabels: {} },
]

test('profileComponents: component classes (utility classes dropped) and clusters per prop', () => {
  const p = profileComponents(capture, regions, clusters)
  const btn = p.find((x) => x.component === 'button')
  assert.deepEqual(btn.classes, ['btn', 'btn-primary'])
  assert.equal(btn.props['background-color'][0].cluster, 'color-01')
  assert.equal(p.find((x) => x.component === 'card').props['background-color'][0].cluster, 'color-03', 'button colors do not leak into the card')
  const idx = classIndex(p)
  assert.deepEqual(componentsForSelector('.navbar .btn.btn-primary:hover', idx), ['button'])
  assert.deepEqual(componentsForSelector('.card > .card-body', idx), ['card'])
})

test('componentTokens: <component>.<role> aliasing the semantic token when one exists', () => {
  const p = profileComponents(capture, regions, clusters)
  const tokens = [
    { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: '' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: '' },
    { name: 'radius.sm', tier: 'primitive', value: '4px', clusters: ['radius-01'], why: '' },
  ]
  const out = componentTokens(p, tokens)
  assert.equal(out.find((t) => t.name === 'button.bg').alias, 'color.action.primary')
  assert.equal(out.find((t) => t.name === 'button.radius').alias, 'radius.sm')
})

test('validateTokenSet drops a component token for a value its component never uses', () => {
  const p = profileComponents(capture, regions, clusters)
  const set = { namer: 't', tokens: [
    ...clusters.map((c) => ({ name: `p.${c.id}`, tier: 'primitive', value: c.value, clusters: [c.id], why: '' })),
    { name: 'button.bg', tier: 'component', alias: 'p.color-01', clusters: ['color-01'], why: '' },
    { name: 'button.shadow', tier: 'component', alias: 'p.shadow-01', clusters: ['shadow-01'], why: '' },
  ] }
  const out = validateTokenSet(set, clusters, p)
  assert.ok(out.tokens.some((t) => t.name === 'button.bg'))
  assert.ok(!out.tokens.some((t) => t.name === 'button.shadow'))
  assert.match(out.warnings.join(), /button never uses shadow-01/)
})

test('rewriteCss prefers component tokens inside a component rule, semantic elsewhere', () => {
  const tokens = [
    { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: '' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: '' },
    { name: 'button.bg', tier: 'component', alias: 'color.action.primary', clusters: ['color-01'], why: '' },
  ]
  const idx = classIndex(profileComponents(capture, regions, clusters))
  const css = `.btn-primary {\n  background-color: #1a73e8;\n}\n@media (min-width: 1px) { .hero { background-color: #1a73e8; } }\n.link { color: #1a73e8; }`
  const { code } = rewriteCss(css, 'a.css', clusters, tokens, idx)
  assert.match(code, /\.btn-primary \{\n  background-color: var\(--button-bg, #1a73e8\);/)
  assert.match(code, /\.hero \{ background-color: var\(--color-action-primary, #1a73e8\)/)
  const ctx = selectorContext(css, idx)
  assert.deepEqual(ctx(1, 2), ['button'])
  assert.equal(pickToken('color', clusters[0], tokens, ['button']).name, 'color.action.primary', 'button.bg is not a text role')
})

// L9: a Month/Week-style toggle (Argon Dashboard's `.nav-pills .nav-link.active`) — two `button` regions,
// one carrying the `active` class with a different bg/text than its sibling.
const toggleCapture = {
  viewport: { width: 1440, height: 900 },
  elements: [
    { i: 0, tag: 'a', path: 'a', role: null, text: 'Month', bbox: [0, 0, 80, 40], classes: ['py-2', 'nav-link', 'active'], styles: { 'background-color': 'rgb(94, 114, 228)', color: 'rgb(255, 255, 255)' } },
    { i: 1, tag: 'a', path: 'a', role: null, text: 'Week', bbox: [90, 0, 80, 40], classes: ['py-2', 'nav-link'], styles: { 'background-color': 'rgb(255, 255, 255)', color: 'rgb(94, 114, 228)' } },
  ],
}
const toggleRegions = [
  { id: 'r0', label: 'button', bbox: [0, 0, 80, 40], score: 1, source: 'sam3.1' },
  { id: 'r1', label: 'button', bbox: [90, 0, 80, 40], score: 1, source: 'sam3.1' },
]
const toggleClusters = [
  { id: 'color-blue', kind: 'color', value: '#5e72e4ff', members: [{ value: '#5e72e4ff', count: 2 }], count: 2, props: {}, regionLabels: {} },
  { id: 'color-white', kind: 'color', value: '#ffffffff', members: [{ value: '#ffffffff', count: 2 }], count: 2, props: {}, regionLabels: {} },
  // Present in the cluster set (so validateTokenSet can cover it with a primitive) but never used by either
  // toggle root at all — nothing in this fixture should ever alias it.
  { id: 'color-unused', kind: 'color', value: '#888888ff', members: [{ value: '#888888ff', count: 1 }], count: 1, props: {}, regionLabels: {} },
]

test('profileComponents: an .active root profiles its own bg/text separately, not mixed with its sibling', () => {
  const p = profileComponents(toggleCapture, toggleRegions, toggleClusters)
  const btn = p.find((x) => x.component === 'button')
  // Overall usage still sees both (one blue bg, one white bg) — the dominant one is whichever normalizeFor/
  // insertion order favors; what matters is the *state* profile below is scoped correctly.
  assert.ok(btn.states.active, 'active state profiled')
  assert.equal(btn.states.active.roots, 1)
  assert.equal(btn.states.active.props['background-color'][0].cluster, 'color-blue')
  assert.equal(btn.states.active.props['color'][0].cluster, 'color-white')
  // The .active root's own blue background never leaks into a state the other (inactive) root belongs to.
  assert.ok(!btn.states.disabled && !btn.states.selected && !btn.states.current)
})

test('componentStateTokens: <component>.<state>.<role> aliasing the semantic token for that state\'s own value', () => {
  const p = profileComponents(toggleCapture, toggleRegions, toggleClusters)
  const tokens = [
    { name: 'color.blue.500', tier: 'primitive', value: '#5e72e4ff', clusters: ['color-blue'], why: '' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-blue'], why: '' },
    { name: 'color.white', tier: 'primitive', value: '#ffffffff', clusters: ['color-white'], why: '' },
  ]
  const out = componentStateTokens(p, tokens)
  const bg = out.find((t) => t.name === 'button.active.bg')
  assert.equal(bg.alias, 'color.action.primary')
  assert.equal(out.find((t) => t.name === 'button.active.text').alias, 'color.white')
})

test('validateTokenSet: a state token only survives for the clusters that state\'s own roots use', () => {
  const p = profileComponents(toggleCapture, toggleRegions, toggleClusters)
  const set = { namer: 't', tokens: [
    ...toggleClusters.map((c) => ({ name: `p.${c.id}`, tier: 'primitive', value: c.value, clusters: [c.id], why: '' })),
    { name: 'button.active.bg', tier: 'component', alias: 'p.color-blue', clusters: ['color-blue'], why: '' },
    // Wrong: the active root never uses this value at all.
    { name: 'button.active.border', tier: 'component', alias: 'p.color-unused', clusters: ['color-unused'], why: '' },
    // No such profiled state at all (typo / invented by a model).
    { name: 'button.hover.bg', tier: 'component', alias: 'p.color-blue', clusters: ['color-blue'], why: '' },
  ] }
  const out = validateTokenSet(set, toggleClusters, p)
  assert.ok(out.tokens.some((t) => t.name === 'button.active.bg'))
  assert.ok(!out.tokens.some((t) => t.name === 'button.active.border'))
  assert.ok(!out.tokens.some((t) => t.name === 'button.hover.bg'))
  assert.match(out.warnings.join(), /button\.active never uses color-unused/)
  assert.match(out.warnings.join(), /no profiled state button\.hover/)
})

test('statesForSelector: recognizes .active, :hover, .disabled, :disabled, .selected, [aria-current], [aria-selected=true]', () => {
  assert.deepEqual(statesForSelector('.nav-pills .nav-link.active'), ['active'])
  assert.deepEqual(statesForSelector('.btn:hover'), ['hover'])
  assert.deepEqual(statesForSelector('.btn.disabled'), ['disabled'])
  assert.deepEqual(statesForSelector('.btn:disabled'), ['disabled'])
  assert.deepEqual(statesForSelector('.item.selected'), ['selected'])
  assert.deepEqual(statesForSelector('.nav-link[aria-current]'), ['current'])
  assert.deepEqual(statesForSelector('.tab[aria-selected="true"]'), ['selected'])
  assert.deepEqual(statesForSelector('.btn'), [])
})

test('rewriteCss + selectorComponentsAndStates: a state selector prefers that state\'s own component token', () => {
  const tokens = [
    { name: 'color.blue.500', tier: 'primitive', value: '#5e72e4ff', clusters: ['color-blue'], why: '' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-blue'], why: '' },
    { name: 'button.bg', tier: 'component', alias: 'color.action.primary', clusters: ['color-blue'], why: '' },
    { name: 'button.active.bg', tier: 'component', alias: 'color.action.primary', clusters: ['color-blue'], why: '' },
  ]
  const idx = classIndex(profileComponents(toggleCapture, toggleRegions, toggleClusters))
  const css = `.nav-link.active {\n  background-color: #5e72e4;\n}\n.nav-link {\n  background-color: #5e72e4;\n}`
  const { code } = rewriteCss(css, 'a.css', toggleClusters, tokens, idx)
  assert.match(code, /\.nav-link\.active \{\n  background-color: var\(--button-active-bg, #5e72e4\);/)
  assert.match(code, /\n\.nav-link \{\n  background-color: var\(--button-bg, #5e72e4\);/)
  const ctx = selectorComponentsAndStates(css, idx)
  assert.deepEqual(ctx(1, 2), { components: ['button'], states: ['active'] })
  assert.deepEqual(ctx(4, 2), { components: ['button'], states: [] })
})
