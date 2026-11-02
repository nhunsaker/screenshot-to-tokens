// Point and say, lane A: the server API (src/stages/pas/api.js) with a fake probe page, fake focus runner and fake
// model; the sentinel probe on a fake DOM; semantic-alias preference; restriction; focus proposal + focus-check wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request } from 'http'
import { PNG } from 'pngjs'
import { probeAtPoint, orderChain, comparePairs, pairStats, PROBE_PROPS, SENTINEL_COLOR, SENTINEL_RADIUS } from '../src/stages/pas/sentinel.js'
import { decideIntent, resolvePoint, focusCheck, sanitizeFocusChanges, changeableFrom, createPasApi, serial } from '../src/stages/pas/api.js'
import { refineChanges, preferSemantic, restrictProposal, museIntent, intentProviders } from '../src/stages/pas/intent.js'
import { focusProposal, ringForHue, namedHue, inHue, choiceFromChanges, focusResultSummary } from '../src/stages/pas/focus-intent.js'
import { startPlayground } from '../src/stages/playground.js'

// Argon-like tokens (playground shape).
const T = (name, tier, kind, value, alias) => ({ name, tier, kind, cssVar: name.replace(/\./g, '-'), value: value || null, alias: alias || null })
const TOKENS = [
  T('color.action.primary', 'semantic', 'color', null, 'color.blue.500'),
  T('color.text.muted', 'semantic', 'color', null, 'color.blue.400'),
  T('color.surface.card', 'semantic', 'color', null, 'color.white'),
  T('button.bg', 'component', 'color', null, 'color.action.primary'),
  T('button.border', 'component', 'color', null, 'color.action.primary'),
  T('footer.text', 'component', 'color', '#8898aa'),
  T('color.blue.500', 'primitive', 'color', '#5e72e4'),
  T('color.blue.400', 'primitive', 'color', '#8898aa'),
  T('color.white', 'primitive', 'color', '#ffffff'),
  T('radius.md', 'primitive', 'radius', '6px'),
]

// ---- sentinel probe on a fake DOM ----------------------------------------------------------------------------------

/** A tiny DOM: custom properties on :root (defaults + overrides), elements whose styles are var() expressions. */
function fakeDom(defaults, elements) {
  const over = {}
  const rootStyle = { getPropertyValue: (k) => over[k] || '', setProperty: (k, v) => { over[k] = v }, removeProperty: (k) => { delete over[k] } }
  const resolve = (expr, depth = 0) => {
    const m = String(expr).match(/^var\(--([a-z0-9-]+)\)$/)
    if (!m || depth > 8) return expr
    const v = over['--' + m[1]] || defaults[m[1]]
    return v == null ? '' : resolve(v, depth + 1)
  }
  const els = elements.map((e) => ({ ...e, nodeType: 1, tagName: e.tag.toUpperCase(), classList: [], childNodes: [{ nodeType: 3, textContent: e.text || '' }], getBoundingClientRect: () => ({ left: e.box[0], top: e.box[1], width: e.box[2], height: e.box[3] }) }))
  const view = {
    scrollX: 0, scrollY: 0, innerHeight: 900, scrollTo() {},
    getComputedStyle: (n) => {
      const s = n.styles || {}
      const get = (k) => resolve(s[k] || (k.endsWith('width') ? '0px' : k.endsWith('style') ? 'none' : k.includes('radius') ? '0px' : k === 'background-color' ? 'rgba(0, 0, 0, 0)' : ''))
      return { getPropertyValue: get, get color() { return get('color') }, get backgroundColor() { return get('background-color') }, get borderTopColor() { return get('border-top-color') }, get borderTopLeftRadius() { return get('border-top-left-radius') }, fontSize: '14px', fontWeight: '400' }
    },
  }
  const doc = { defaultView: view, documentElement: { style: rootStyle }, body: { nodeType: 1 }, elementFromPoint: (x, y) => els.find((e) => e.hit && x >= e.box[0] && x < e.box[0] + e.box[2] && y >= e.box[1] && y < e.box[1] + e.box[3]) || null }
  els.forEach((e) => { e.parentElement = els.find((p) => p.id === e.parent) || doc.body })
  return { doc, view, over }
}

const ARGON_VARS = { 'color-text-muted': 'var(--color-blue-400)', 'color-blue-400': '#8898aa', 'footer-text': '#8898aa', 'color-action-primary': 'var(--color-blue-500)', 'color-blue-500': '#5e72e4', 'button-bg': 'var(--color-action-primary)', 'button-border': 'var(--color-action-primary)', 'color-white': '#ffffff', 'radius-md': '6px', 'color-surface-card': 'var(--color-white)' }

function withDom(dom, fn) {
  const saved = [globalThis.document, globalThis.window]
  globalThis.document = dom.doc
  globalThis.window = dom.view
  try { return fn() } finally { globalThis.document = saved[0]; globalThis.window = saved[1] }
}

test('probeAtPoint: the sentinel finds the token chain that controls the text, not every token with the same value', () => {
  const dom = fakeDom(ARGON_VARS, [{ id: 'label', tag: 'span', text: 'Since last month', box: [378, 213, 104, 19], hit: true, styles: { color: 'var(--color-text-muted)' } }])
  const probeTokens = TOKENS.map((t) => ({ name: t.name, cssVar: t.cssVar, kind: t.kind }))
  const r = withDom(dom, () => probeAtPoint({ x: 430, y: 222, tokens: probeTokens, props: PROBE_PROPS, color: SENTINEL_COLOR, radius: SENTINEL_RADIUS }))
  assert.deepEqual(r.controls.color.sort(), ['color.blue.400', 'color.text.muted'])
  assert.ok(!r.controls.color.includes('footer.text'), 'same value, different token: not a controller')
  assert.deepEqual(r.controls['border-color'], [], 'no border, so currentColor does not count')
  assert.equal(r.element.text, 'Since last month')
  assert.deepEqual(Object.keys(dom.over), [], 'every sentinel is put back')
  assert.deepEqual(orderChain(r.controls.color, TOKENS), { token: 'color.text.muted', chain: ['color.text.muted', 'color.blue.400'] })
})

test('probeAtPoint: fill, border and radius come from the control around the clicked label', () => {
  const dom = fakeDom(ARGON_VARS, [
    { id: 'btn', tag: 'a', box: [835, 310, 76, 37], styles: { 'background-color': 'var(--button-bg)', 'border-top-width': '1px', 'border-top-style': 'solid', 'border-top-color': 'var(--button-border)', 'border-top-left-radius': 'var(--radius-md)' } },
    { id: 'lbl', parent: 'btn', tag: 'span', text: 'Month', box: [850, 320, 40, 16], hit: true, styles: { color: 'var(--color-white)' } },
  ])
  const probeTokens = TOKENS.map((t) => ({ name: t.name, cssVar: t.cssVar, kind: t.kind }))
  const r = withDom(dom, () => probeAtPoint({ x: 860, y: 325, tokens: probeTokens, props: PROBE_PROPS, color: SENTINEL_COLOR, radius: SENTINEL_RADIUS }))
  assert.equal(orderChain(r.controls['background-color'], TOKENS).token, 'button.bg')
  assert.deepEqual(orderChain(r.controls['background-color'], TOKENS).chain, ['button.bg', 'color.action.primary', 'color.blue.500'])
  assert.equal(orderChain(r.controls['border-color'], TOKENS).token, 'button.border')
  assert.deepEqual(r.controls['border-radius'], ['radius.md'])
  assert.equal(r.element.control.tag, 'a')
})

test('orderChain, pairStats, comparePairs (regression blocks and names the element)', () => {
  assert.deepEqual(orderChain([], TOKENS), { token: null, chain: [] })
  assert.equal(orderChain(['color.blue.500', 'button.bg', 'color.action.primary'], TOKENS).token, 'button.bg')
  assert.deepEqual(pairStats([{ ratio: 2.9, status: 'fail' }, { ratio: 4.6, status: 'pass' }]), { count: 2, pass: 1, fail: 1, minRatio: 2.9, maxRatio: 4.6 })
  const before = [{ id: 'a', text: 'A', ratio: 2.9, status: 'fail', required: 4.5 }, { id: 'b', text: 'Bee', ratio: 4.8, status: 'pass', required: 4.5 }, { id: 'c', text: 'C', ratio: 7, status: 'pass', required: 4.5 }]
  const ok = comparePairs(before, [{ ...before[0], ratio: 4.6, status: 'pass' }, before[1], before[2]])
  assert.equal(ok.affected, 1)
  assert.equal(ok.blocked, false)
  assert.deepEqual(ok.after, { min: 4.6, max: 4.6, pass: 1, fail: 0 })
  const bad = comparePairs(before, [{ ...before[0], ratio: 4.6, status: 'pass' }, { ...before[1], ratio: 3.1, status: 'fail' }, before[2]])
  assert.equal(bad.blocked, true)
  assert.match(bad.reason, /^text contrast: "Bee" 4\.8 → 3\.1/)
})

// ---- the API core with a fake probe -------------------------------------------------------------------------------

const PAIRS = [
  { id: 'p1', text: 'Since last month', bg: '#ffffff', ratio: 2.95, required: 4.5, status: 'fail', fg: '#8898aa' },
  { id: 'p2', text: 'Since yesterday', bg: '#ffffff', ratio: 2.95, required: 4.5, status: 'fail', fg: '#8898aa' },
  { id: 'p3', text: 'Footer', bg: '#ffffff', ratio: 2.95, required: 4.5, status: 'fail', fg: '#8898aa' },
]

function fakeCore(o = {}) {
  const calls = { audit: [], muse: [], at: 0 }
  const probe = {
    at: async (x) => {
      calls.at++
      if (x > 800) return { element: { tag: 'span', text: 'Month', bbox: [850, 320, 40, 16], color: 'rgb(255, 255, 255)', background: 'rgb(94, 114, 228)', classes: [], fontSize: '14px', fontWeight: '600', control: { tag: 'a', classes: ['btn'], bbox: [835, 310, 76, 37] } }, controls: { color: ['color.white'], 'background-color': ['button.bg', 'color.action.primary', 'color.blue.500'], 'border-color': [], 'border-radius': [] } }
      return { element: { tag: 'span', text: 'Since last month', bbox: [378, 213, 104, 19], color: 'rgb(136, 152, 170)', background: 'rgba(0, 0, 0, 0)', classes: ['text-nowrap'], fontSize: '14px', fontWeight: '400' }, controls: { color: o.literal ? [] : ['color.blue.400', 'color.text.muted'], 'background-color': [], 'border-color': [], 'border-radius': [] } }
    },
    pairsUsing: async () => ['p1', 'p2'],
    audit: async (changes) => {
      calls.audit.push(changes)
      const c = changes[0]
      return PAIRS.map((p) => (c && ['p1', 'p2'].includes(p.id) ? { ...p, ratio: o.worse ? 2 : 4.53, status: o.worse ? 'fail' : 'pass' } : p))
    },
  }
  const focus = { baseline: async () => STOPS, check: async (css) => { calls.css = css; return { stops: STOPS.map((s) => ({ ...s, verdict: 'pass' })), timings: { load: 1, tab: 2 } } } }
  return {
    calls,
    core: {
      page: { width: 1440, height: 2000 }, tokens: TOKENS, known: new Set(TOKENS.map((t) => t.name)),
      values: [{ name: 'color.action.primary', tier: 'semantic', value: '#5e72e4' }, { name: 'color.blue.500', tier: 'primitive', value: '#5e72e4' }, { name: 'color.white', tier: 'primitive', value: '#ffffff' }],
      baseline: PAIRS, probe, focus, cache: new Map(),
      pointFn: async (x) => (x > 800 ? { sam: { ms: 5, source: 'sam-point-box' }, outline: { bbox: [835, 310, 76, 37] }, region: { id: 'r42', label: 'button', bbox: [835, 310, 76, 37] }, element: { path: 'a.btn>span' }, twins: [{ id: 'r43', bbox: [1200, 400, 56, 28], hex: '#5e72e4', deltaE: 0 }] } : { sam: { ms: 5, source: 'sam-point-mask' }, outline: { bbox: [421, 219, 16, 8], fromMask: true }, region: null, element: { path: 'span.text-nowrap' }, twins: [] }),
      museFn: async (req) => { calls.muse.push(req); return o.muse ? o.muse(req) : { changes: [], rejected: [], affects: '', provider: 'baseten', model: 'm', ms: 1 } },
    },
  }
}

const STOPS = [{ tag: 'a', text: 'Dashboard', verdict: 'none', bg: '#ffffff' }, { tag: 'a', text: 'Month', verdict: 'none', bg: '#5e72e4' }, { tag: 'button', text: 'Go', verdict: 'faint', bg: '#f6f9fc' }]

test('resolvePoint: DOM box for text (SAM glyph kept aside), sentinel controls, pairs using the token; cached', async () => {
  const { core, calls } = fakeCore()
  const r = await resolvePoint(core, 430, 222)
  assert.equal(r.outline.source, 'dom')
  assert.deepEqual(r.outline.bbox, [378, 213, 104, 19])
  assert.deepEqual(r.outline.sam.bbox, [421, 219, 16, 8])
  assert.deepEqual(r.controls.color, { value: '#8898aa', token: 'color.text.muted', chain: ['color.text.muted', 'color.blue.400'] })
  assert.equal(r.pairs.count, 2)
  assert.equal(r.element.path, 'span.text-nowrap')
  const again = await resolvePoint(core, 430.2, 221.8)
  assert.equal(again.cachedClick, true)
  assert.equal(calls.at, 1)
  await assert.rejects(resolvePoint(core, -1, 5), /outside the captured page/)
  await assert.rejects(resolvePoint(core, 'a', 5), /x, y/)
})

test('decideIntent contrast: deterministic fix on the sentinel token, every pair to 4.5:1, re-audited, no model', async () => {
  const { core, calls } = fakeCore()
  const r = await decideIntent(core, { transcript: 'This label is too light. Make it readable, keep our gray.', point: { x: 430, y: 222 } })
  assert.equal(r.route, 'contrast')
  assert.equal(r.changes.length, 1)
  assert.equal(r.changes[0].token, 'color.text.muted')
  assert.equal(r.changes[0].css, r.changes[0].value)
  assert.match(r.changes[0].value, /^#[0-9a-f]{6}$/)
  assert.equal(r.predicted.blocked, false)
  assert.equal(r.predicted.affected, 2)
  assert.match(r.summary, /^2 elements, 2\.95:1 → 4\.5\d:1, text contrast \(color\.text\.muted, hue kept\)\./)
  assert.equal(calls.muse.length, 0)
  assert.equal(r.model, null)
})

test('decideIntent contrast: a regression elsewhere blocks with the element named; a literal colour routes to none', async () => {
  const { core } = fakeCore({ worse: true })
  const r = await decideIntent(core, { transcript: 'too faint', point: { x: 430, y: 222 } })
  assert.equal(r.predicted.blocked, true)
  assert.match(r.summary, /Blocked: text contrast: "Since last month"/)
  const lit = await decideIntent(fakeCore({ literal: true }).core, { transcript: 'make it readable', point: { x: 430, y: 222 } })
  assert.equal(lit.route, 'none')
  assert.deepEqual(lit.changes, [])
  assert.match(lit.summary, /No token controls the colour/)
  const noPoint = await decideIntent(core, { transcript: 'make it readable' })
  assert.equal(noPoint.route, 'none')
  await assert.rejects(decideIntent(core, { transcript: '  ' }), /transcript required/)
})

test('decideIntent focus: ring tokens + rule, no point needed, no model', async () => {
  const { core, calls } = fakeCore()
  const r = await decideIntent(core, { transcript: 'Give every control a visible focus ring in our blue.' })
  assert.equal(r.route, 'focus')
  assert.deepEqual(r.changes.map((c) => c.token), ['focus.ring.color', 'focus.ring.inner-color', 'focus.ring.width', 'focus.ring.offset'])
  assert.equal(r.changes[0].alias, 'color.action.primary')
  assert.match(r.rule, /:focus-visible/)
  assert.match(r.summary, /^Two-tone ring in color\.action\.primary/)
  assert.equal(calls.muse.length, 0)
})

test('decideIntent muse: the model sees only sentinel-found tokens of the click and its twins; noop kept, not applied', async () => {
  const { core, calls } = fakeCore({ muse: (req) => ({ changes: refineChanges([{ token: 'button.bg', css: 'var(--color-blue-500)', reason: 'brand' }], { tokens: req.tokens, chains: req.chains }), rejected: [], affects: 'Month and See all', provider: 'baseten', model: 'm', ms: 3 }) })
  const r = await decideIntent(core, { transcript: 'Make these buttons our brand blue.', point: { x: 873, y: 328 } })
  assert.equal(r.route, 'muse')
  const req = calls.muse[0]
  assert.deepEqual(req.changeable.map((c) => c.name).sort(), ['button.bg', 'color.action.primary', 'color.blue.500', 'color.white'])
  assert.ok(!req.changeable.some((c) => c.name === 'color.text.muted' || c.name === 'color.surface.card'), 'value-matched white surface tokens stay out')
  assert.equal(req.changeable.find((c) => c.name === 'button.bg').nearest, true)
  assert.deepEqual(r.changes.map((c) => [c.token, c.alias, !!c.noop]), [['button.bg', 'color.action.primary', true]])
  assert.match(r.summary, /^Already in place/)
  assert.equal(calls.audit.length, 0, 'a no-op is not re-audited')
  assert.equal(r.outline, undefined)
})

test('changeableFrom marks the nearest token per property and adds twin chains', () => {
  const pt = { controls: { color: { token: 'color.text.muted', chain: ['color.text.muted', 'color.blue.400'] }, 'background-color': null }, twins: [{ chains: [['button.bg', 'color.action.primary']] }] }
  const c = changeableFrom(pt, TOKENS)
  assert.deepEqual(c.map((x) => [x.name, x.nearest]), [['color.text.muted', true], ['color.blue.400', false], ['button.bg', true], ['color.action.primary', false]])
})

// ---- semantic preference, restriction, failover --------------------------------------------------------------------

test('preferSemantic / refineChanges: primitive alias -> semantic, hex -> semantic, primitive target -> nearest token', () => {
  assert.equal(preferSemantic('color.blue.500', { tokens: TOKENS, changing: 'button.bg' }), 'color.action.primary')
  assert.equal(preferSemantic('#5e72e4', { tokens: TOKENS, changing: 'button.bg' }), 'color.action.primary')
  assert.equal(preferSemantic('color.action.primary', { tokens: TOKENS, changing: 'button.bg' }), null, 'already the best name')
  assert.equal(preferSemantic('color.blue.500', { tokens: TOKENS, changing: 'color.action.primary' }), null, 'never a token that points back at the one changing')
  const out = refineChanges([
    { token: 'button.border', css: 'var(--color-blue-500)', reason: 'brand' },
    { token: 'color.blue.400', css: '#5e72e4', reason: 'blue text' },
  ], { tokens: TOKENS, chains: [['color.text.muted', 'color.blue.400']] })
  assert.deepEqual(out[0], { token: 'button.border', cssVar: 'button-border', value: null, alias: 'color.action.primary', css: 'var(--color-action-primary)', from: '#5e72e4', why: 'brand', aliasPreferred: 'color.blue.500', noop: true })
  assert.equal(out[1].token, 'color.text.muted')
  assert.equal(out[1].retargetedFrom, 'color.blue.400')
  assert.equal(out[1].alias, 'color.action.primary')
  assert.equal(out[1].noop, undefined)
})

test('restrictProposal: radius tokens take px or a radius alias; colour rules unchanged; changeable objects accepted', () => {
  const r = restrictProposal({ changes: [
    { token: 'radius.md', value: '12px' }, { token: 'radius.md', value: '12px; color:red' }, { token: 'button.bg', value: 'url(x)' }, { token: 'button.bg', alias: 'color.action.primary' },
  ] }, { known: TOKENS.map((t) => t.name), changeable: [{ name: 'radius.md' }, { name: 'button.bg' }], radiusTokens: ['radius.md'] })
  assert.deepEqual(r.changes.map((c) => [c.token, c.css]), [['button.bg', 'var(--color-action-primary)'], ['radius.md', '12px']])
  assert.deepEqual(r.rejected.map((x) => x.why).sort(), ['not a radius', 'unsafe value'])
})

test('museIntent: fails over Baseten -> Fireworks, restricts and refines; intentProviders never -contributor', async () => {
  const providers = [{ id: 'baseten', baseURL: 'b', apiKey: 'k1', model: 'm1' }, { id: 'fireworks', baseURL: 'f', apiKey: 'k2', model: 'm2' }]
  const seen = []
  const chatFn = async (o) => {
    seen.push(o.model)
    if (o.model === 'm1') throw new Error('503 overloaded')
    return { text: JSON.stringify({ changes: [{ token: 'button.bg', alias: 'color.blue.500', why: 'brand' }, { token: 'card.bg', value: '#000' }], affects: 'buttons' }) }
  }
  const r = await museIntent({ transcript: 'brand blue', clicked: {}, changeable: [{ name: 'button.bg' }], tokens: TOKENS }, { chatFn, providers })
  assert.deepEqual(seen, ['m1', 'm2'])
  assert.equal(r.provider, 'fireworks')
  assert.deepEqual(r.changes.map((c) => [c.token, c.alias, c.aliasPreferred]), [['button.bg', 'color.action.primary', 'color.blue.500']])
  assert.equal(r.rejected.length, 1)
  assert.match(r.errors[0], /^baseten: 503/)
  const saved = { ...process.env }
  process.env.BASETEN_API_KEY = 'x'; process.env.FIREWORKS_API_KEY = 'y'; process.env.META_API_KEY = 'z'
  process.env.FIREWORKS_MODEL = 'accounts/x/models/muse-contributor'
  try { assert.deepEqual(intentProviders('baseten', '').map((p) => p.id), ['baseten', 'meta']) } finally {
    for (const k of ['BASETEN_API_KEY', 'FIREWORKS_API_KEY', 'META_API_KEY', 'FIREWORKS_MODEL']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
})

// ---- focus ---------------------------------------------------------------------------------------------------------

test('namedHue / inHue / ringForHue: named blue kept, two-tone when it fails 3:1 somewhere, nearest hue when none', () => {
  assert.equal(namedHue('a visible focus ring in our blue'), 'blue')
  assert.equal(namedHue('keep our grey'), 'gray')
  assert.equal(namedHue('a visible focus ring'), null)
  assert.ok(inHue('#5e72e4', 'blue') && !inHue('#1dc7ea', 'blue') && inHue('#1dc7ea', 'blue', 30))
  const values = [{ name: 'color.action.primary', tier: 'semantic', value: '#5e72e4' }, { name: 'color.blue.500', tier: 'primitive', value: '#5e72e4' }, { name: 'color.white', tier: 'primitive', value: '#ffffff' }, { name: 'color.gray.900', tier: 'primitive', value: '#111111' }]
  const two = ringForHue('blue', STOPS, values)
  assert.equal(two.mode, 'two-tone')
  assert.equal(two.color.token, 'color.action.primary')
  assert.equal(two.covered, 3)
  const one = ringForHue('blue', [{ bg: '#ffffff' }], values)
  assert.equal(one.mode, 'single')
  const near = ringForHue('blue', [{ bg: '#ffffff' }], [{ name: 'color.teal.300', tier: 'primitive', value: '#1dc7ea' }])
  assert.equal(near.nearest, true)
  assert.equal(ringForHue('green', STOPS, values), null)
  const p = focusProposal('a ring in our green', STOPS, values)
  assert.match(p.summary, /No green token in this app/)
})

test('focusCheck: rebuilds the token block and rule from sanitized changes (never CSS from the request)', async () => {
  const { core, calls } = fakeCore()
  const prop = focusProposal('focus ring in our blue', STOPS, core.values)
  const r = await focusCheck(core, { changes: prop.changes })
  assert.deepEqual(r.before, { stops: 3, measured: 3, pass: 0, faint: 1, none: 2, noChange: 0, skipped: 0 })
  assert.equal(r.after.pass, 3)
  assert.equal(r.compare.better, 3)
  assert.equal(r.ring.mode, 'two-tone')
  assert.match(calls.css, /--focus-ring-color: var\(--color-action-primary, #5e72e4\);/)
  assert.match(calls.css, /:focus-visible \{/)
  assert.deepEqual(choiceFromChanges(prop.changes).color.value, '#5e72e4')
  assert.throws(() => sanitizeFocusChanges([{ token: 'focus.ring.color', css: 'red; } body { display:none' }], core.known), /unsafe/)
  assert.throws(() => sanitizeFocusChanges([{ token: 'evil.token', css: '#fff' }], core.known), /unknown token/)
  assert.throws(() => sanitizeFocusChanges([{ token: 'focus.ring.color', css: 'var(--not-a-token)' }], core.known), /not a colour/)
  assert.throws(() => sanitizeFocusChanges([], core.known), /1 to 20/)
})

test('serial runs jobs one at a time, in order, and survives a failure', async () => {
  const q = serial()
  const log = []
  const job = (n, ms, fail) => q(async () => { log.push(`start ${n}`); await new Promise((r) => setTimeout(r, ms)); log.push(`end ${n}`); if (fail) throw new Error('x') })
  await Promise.allSettled([job(1, 20, true), job(2, 1), job(3, 1)])
  assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3'])
})

// ---- HTTP: mounted on the playground, guards, tokens.css injection, no keys --------------------------------------

function tinyRun() {
  const dir = mkdtempSync(join(tmpdir(), 'pas-api-'))
  const png = new PNG({ width: 40, height: 30 })
  png.data.fill(255)
  writeFileSync(join(dir, 'screenshot.png'), PNG.sync.write(png))
  writeFileSync(join(dir, 'capture.json'), JSON.stringify({ screenshot: 'screenshot.png', viewport: { width: 40, height: 30 }, elements: [] }))
  writeFileSync(join(dir, 'regions.json'), '[]')
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ namer: 'mock', tokens: [{ name: 'color.white', tier: 'primitive', value: '#ffffff', clusters: ['c1'] }] }))
  writeFileSync(join(dir, 'clusters.json'), JSON.stringify([{ id: 'c1', kind: 'color' }]))
  writeFileSync(join(dir, 'rewrite.json'), JSON.stringify({ edits: [] }))
  writeFileSync(join(dir, 'tokens.css'), ':root { --color-white: #ffffff; }\n')
  const app = join(dir, 'app')
  require_mkdir(app)
  writeFileSync(join(app, 'index.html'), '<html><head><title>x</title></head><body>hi</body></html>')
  require_mkdir(join(app, 'static'))
  writeFileSync(join(app, 'static', 'main.js'), 'console.log(1)')
  return { dir, app }
}
import { mkdirSync } from 'fs'
const require_mkdir = (p) => mkdirSync(p, { recursive: true })

function get(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const u = new URL(url)
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
      let s = ''
      res.on('data', (c) => { s += c })
      res.on('end', () => ok({ status: res.statusCode, body: s }))
    })
    req.on('error', fail)
    if (body) req.write(body)
    req.end()
  })
}

test('playground + pas: routes mounted, Host/Origin guards, tokens.css injected into the app, no key in health', async () => {
  const { dir, app } = tinyRun()
  const saved = process.env.BASETEN_API_KEY
  process.env.BASETEN_API_KEY = 'secret-key-value-123'
  const { createPasApi: make } = await import('../src/stages/pas/api.js')
  const { playgroundData, readRun } = await import('../src/stages/playground.js')
  const data = playgroundData(readRun(dir), { app: 'app/' })
  const probe = { at: async () => null, pairsUsing: async () => [], audit: async () => [] }
  const focus = { baseline: async () => [], check: async () => ({ stops: [], timings: {} }), start: () => Promise.resolve({ stops: [], ms: 1 }), state: () => Promise.resolve({ stops: [], ms: 1 }) }
  const pas = make({ runDir: dir, data, probe, focus, transcribeFn: async () => ({ transcript: 'hello', ms: 3 }) })
  const s = await startPlayground({ runDir: dir, appDir: app, port: 0, pas })
  try {
    await s.warming
    const h = await get(`${s.url}__pas/api/health`)
    assert.equal(h.status, 200)
    assert.ok(!h.body.includes('secret-key-value-123'))
    assert.equal(JSON.parse(h.body).focusBaseline.ready, true)
    const html = await get(`${s.url}app/`)
    assert.match(html.body, /<link rel="stylesheet" href="\/__pas\/tokens.css" data-s2t-tokens><\/head>/)
    assert.equal((await get(`${s.url}__pas/tokens.css`)).body, ':root { --color-white: #ffffff; }\n')
    assert.equal((await get(`${s.url}static/main.js`)).body, 'console.log(1)', 'root-absolute app assets resolve')
    const client = await get(`${s.url}pas-client.js`)
    assert.equal(client.status, 200, 'the page imports ./pas-client.js; it must be served')
    assert.match(client.body, /export function overlayBoxesFor/)
    assert.equal((await get(`${s.url}__pas/api/point`, { method: 'POST', headers: { host: 'evil.example:80' }, body: '{}' })).status, 403)
    assert.equal((await get(`${s.url}__pas/api/point`, { method: 'POST', headers: { origin: 'http://evil.example' }, body: '{}' })).status, 403)
    const bad = await get(`${s.url}__pas/api/point`, { method: 'POST', body: '{"x":100,"y":5}' })
    assert.equal(bad.status, 400)
    assert.equal(JSON.parse(bad.body).code, 'bad_request')
    assert.equal((await get(`${s.url}__pas/api/intent`, { method: 'GET' })).status, 405)
    assert.equal((await get(`${s.url}__pas/api/nope`, { method: 'POST', body: '{}' })).status, 404)
    const tr = await get(`${s.url}__pas/api/transcribe`, { method: 'POST', body: 'RIFF' })
    assert.deepEqual(JSON.parse(tr.body).transcript, 'hello')
    const big = await get(`${s.url}__pas/api/intent`, { method: 'POST', body: 'x'.repeat(70000) })
    assert.equal(big.status, 413)
  } finally {
    await s.close()
    if (saved === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = saved
  }
})

test('focus summary reports the measured Tab-through (pass/faint/none), never the predicted coverage count', async () => {
  const { core } = fakeCore()
  const prop = focusProposal('focus ring in our blue', STOPS, core.values)
  assert.doesNotMatch(prop.summary, /\d+ of \d+ covered/)
  assert.match(prop.summary, /Tab-through check measures it next/)
  const r = await focusCheck(core, { changes: prop.changes })
  assert.equal(r.summary, `Measured by Tab-through: visible focus on 0 → ${r.after.pass} of ${r.after.measured} controls (before 0 pass, 1 faint, 2 none; after ${r.after.pass} pass, ${r.after.faint} faint, ${r.after.none} none).`)
  // Light Bootstrap's case: predicted 35 of 35, measured 23 pass / 12 faint. The line says what was measured.
  const lb = focusResultSummary({ measured: 35, pass: 12, faint: 11, none: 12 }, { measured: 35, pass: 23, faint: 12, none: 0 })
  assert.equal(lb, 'Measured by Tab-through: visible focus on 12 → 23 of 35 controls (before 12 pass, 11 faint, 12 none; after 23 pass, 12 faint, 0 none).')
  assert.doesNotMatch(lb, /35 of 35/)
  assert.match(focusResultSummary({ measured: 3, pass: 1, faint: 0, none: 2 }, { measured: 3, pass: 2, faint: 0, none: 1 }, 1), /; 1 control worse\.$/)
})

test('sameOriginOnly: public host and origin only; POST must send Origin', async () => {
  const { sameOriginOnly, apiAllowed, localOnly } = await import('../src/stages/pas/server.js')
  const O = 'https://s2t.sorbcloud.com'
  const req = (host, origin, method = 'POST') => ({ method, headers: { host, ...(origin ? { origin } : {}) } })
  assert.equal(sameOriginOnly(req('s2t.sorbcloud.com', O), O), true)
  assert.equal(sameOriginOnly(req('s2t.sorbcloud.com', null, 'GET'), O), true)
  assert.equal(sameOriginOnly(req('s2t.sorbcloud.com', null, 'POST'), O), false)
  assert.equal(sameOriginOnly(req('s2t.sorbcloud.com', 'https://evil.example'), O), false)
  assert.equal(sameOriginOnly(req('s2t.sorbcloud.com', 'http://s2t.sorbcloud.com'), O), false)
  assert.equal(sameOriginOnly(req('evil.example', O), O), false)
  assert.equal(sameOriginOnly(req('127.0.0.1:3000', 'http://127.0.0.1:3000'), O), false)
  assert.equal(sameOriginOnly(req('S2T.sorbcloud.com', O), O), true)
  assert.equal(sameOriginOnly(req('s2t.sorbcloud.com', O), O + '/'), true)
  assert.equal(sameOriginOnly(req('localhost:4567', 'http://localhost:4567'), 'http://localhost:4567'), true)
  assert.equal(sameOriginOnly(req('localhost:4567', 'http://localhost:4568'), 'http://localhost:4567'), false)
  assert.equal(sameOriginOnly(req('x', 'y'), 'not a url'), false)
  // Unset public origin: the local guard, unchanged.
  assert.equal(apiAllowed(req('127.0.0.1:4400', 'http://127.0.0.1:4400'), null), localOnly(req('127.0.0.1:4400', 'http://127.0.0.1:4400')))
  assert.equal(apiAllowed(req('s2t.sorbcloud.com', O), null), false)
  assert.equal(apiAllowed(req('s2t.sorbcloud.com', O), O), true)
})

test('public mode: same-origin guard, session cookie, budget on every response, 429 at the cap, refunds, probe reset', async () => {
  const { dir, app } = tinyRun()
  const { createPasApi: make } = await import('../src/stages/pas/api.js')
  const { createLedger } = await import('../src/stages/pas/ledger.js')
  const { playgroundData, readRun } = await import('../src/stages/playground.js')
  const data = playgroundData(readRun(dir), { app: 'app/' })
  let resets = 0
  const probe = { at: async () => null, pairsUsing: async () => [], audit: async () => [], reset: async () => { resets++ } }
  const focus = { baseline: async () => [], check: async () => ({ stops: [], timings: {} }), start: () => Promise.resolve({ stops: [], ms: 1 }), state: () => Promise.resolve({ stops: [], ms: 1 }) }
  const ledger = createLedger({ caps: { total: 3, day: 300, session: 40, ipDay: 80 } })
  const s0 = await startPlayground({ runDir: dir, appDir: app, port: 0, pas: { handle: async () => false } }) // find a free port
  const port = Number(new URL(s0.url).port); await s0.close()
  const origin = `http://localhost:${port}`
  const pas = make({ runDir: dir, data, probe, focus, publicOrigin: origin, ledger, transcribeFn: async () => ({ transcript: 'hello', ms: 3 }) })
  const s = await startPlayground({ runDir: dir, appDir: app, port, pas, public: { origin, ledger } })
  const H = { host: `localhost:${port}`, origin }
  try {
    await s.warming
    // Local Host is refused in public mode (Host must be the public origin's).
    assert.equal((await get(`${s.url}__pas/api/transcribe`, { method: 'POST', body: 'RIFF' })).status, 403)
    // POST without Origin is refused; GET health without Origin is fine and carries the budget.
    assert.equal((await get(`${s.url}__pas/api/transcribe`, { method: 'POST', headers: { host: H.host }, body: 'RIFF' })).status, 403)
    const h = await get(`${s.url}__pas/api/health`, { headers: { host: H.host } })
    assert.deepEqual(JSON.parse(h.body).budget, { left: 3, total: 3, mine: 3 })
    assert.equal(JSON.parse(h.body).run.dir, dir) // runLabel unset here
    // The unmetered Muse route is off.
    assert.equal(JSON.parse((await get(`${s.url}api/muse`, { headers: H })).body).ok, false)
    assert.equal((await get(`${s.url}api/muse`, { method: 'POST', headers: H, body: '{}' })).status, 403)
    let r = await getFull(`${s.url}__pas/api/transcribe`, { method: 'POST', headers: H, body: 'RIFF' })
    assert.equal(r.status, 200)
    const sid = /s2t_sid=([^;]+); Path=\/; HttpOnly; SameSite=Lax/.exec(r.headers['set-cookie'][0])
    assert.ok(sid, 'session cookie set, HttpOnly, SameSite=Lax (no Secure on http)')
    assert.deepEqual(JSON.parse(r.body).budget, { left: 2, total: 3, mine: 2 })
    const C = { ...H, cookie: `s2t_sid=${sid[1]}` }
    r = await getFull(`${s.url}__pas/api/transcribe`, { method: 'POST', headers: C, body: 'RIFF' })
    assert.equal(r.headers['set-cookie'], undefined, 'known session: no new cookie')
    assert.deepEqual(JSON.parse(r.body).budget, { left: 1, total: 3, mine: 1 })
    // A bad point request (400) is refunded and still carries the budget; the probe is reset after the job.
    const before = resets
    const bad = await get(`${s.url}__pas/api/point`, { method: 'POST', headers: C, body: '{"x":100,"y":5}' })
    assert.equal(bad.status, 400)
    assert.deepEqual(JSON.parse(bad.body).budget, { left: 1, total: 3, mine: 1 })
    assert.equal(resets, before + 1)
    r = await getFull(`${s.url}__pas/api/transcribe`, { method: 'POST', headers: C, body: 'RIFF' })
    assert.deepEqual(JSON.parse(r.body).budget, { left: 0, total: 3, mine: 0 })
    const capped = await get(`${s.url}__pas/api/transcribe`, { method: 'POST', headers: C, body: 'RIFF' })
    assert.equal(capped.status, 429)
    const cj = JSON.parse(capped.body)
    assert.equal(cj.code, 'budget'); assert.equal(cj.reason, 'total'); assert.deepEqual(cj.budget, { left: 0, total: 3, mine: 0 })
    const sum = await get(`${s.url}__pas/api/budget`, { headers: { host: H.host } })
    assert.equal(JSON.parse(sum.body).used, 3)
    assert.doesNotMatch(sum.body, new RegExp(sid[1]))
  } finally { await s.close() }
})

function getFull(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const u = new URL(url)
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
      let s = ''
      res.on('data', (c) => { s += c })
      res.on('end', () => ok({ status: res.statusCode, body: s, headers: res.headers }))
    })
    req.on('error', fail)
    if (body) req.write(body)
    req.end()
  })
}
