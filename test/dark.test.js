import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import {
  tally, reachOf, PROBE, darkShare, mainLightBackground, contextPairs, judgeDark, rankRound, pickBest, pickProvider, onSurfaceNote, surfaceNote,
  darkCss, forcedDarkCss, siteDirOf, askProvider, darkLoop, contrastScript, darkPrSection, includeDarkInPr,
} from '../src/stages/dark.js'

const tv = [
  { name: 'color.text.default', tier: 'semantic', cssVar: 'color-text-default', value: '#32325d' },
  { name: 'color.surface.default', tier: 'semantic', cssVar: 'color-surface-default', value: '#ffffff' },
  { name: 'color.white', tier: 'primitive', cssVar: 'color-white', value: '#ffffff' },
]
const known = new Set(tv.map((t) => t.name))
const res = (status, bg, extra = {}) => ({ id: 'p' + Math.random(), text: 'Hi', status, fg: '#32325d', bg, ratio: status === 'pass' ? 12 : 2, required: 4.5, large: false, gradient: false, ...extra })

test('tally: counts checked pairs and the reasons others were skipped', () => {
  const t = tally([res('pass', '#ffffff'), res('fail', '#ffffff'), { status: 'hidden' }, { status: 'image' }, { status: 'hidden' }])
  assert.deepEqual(t, { checked: 2, pass: 1, fail: 1, skipped: { hidden: 2, image: 1 } })
})

test('darkShare / mainLightBackground: share of text on luminance <= 0.12, and the main light bg left', () => {
  const r = [res('pass', '#172033'), res('pass', '#172033'), res('fail', '#ffffff'), res('pass', '#f8f9fe'), res('pass', '#f8f9fe'), { status: 'hidden' }]
  assert.equal(darkShare(r), 0.4)
  assert.equal(mainLightBackground(r), '#f8f9fe')
  assert.equal(darkShare([]), 0)
  assert.equal(mainLightBackground([res('pass', '#000000')]), null)
})

test('judgeDark: a light answer is not dark however well it scores; gradient failures are split out', () => {
  const light = judgeDark([res('pass', '#ffffff'), res('pass', '#ffffff'), res('pass', '#ffffff')], tv)
  assert.equal(light.fail, 0)
  assert.equal(light.dark, false)
  assert.equal(light.lightBg, '#ffffff')
  const dark = judgeDark([res('pass', '#172033'), res('fail', '#172033', { fg: '#32325d' }), res('fail', '#11cdef', { gradient: true })], tv)
  assert.equal(dark.dark, true)
  assert.equal(dark.fixable, 1)
  assert.equal(dark.onGradient, 1)
  assert.equal(dark.lightBg, null)
  assert.deepEqual(dark.feedback[0].fgTokens, ['color.text.default'])
  assert.ok(rankRound(dark) < rankRound(light), 'any dark round beats a light one')
})

test('reachOf + judgeDark: failures whose text color no token reaches are untokenized, kept out of the feedback', () => {
  const light = [res('pass', '#ffffff', { id: 'a' }), res('pass', '#ffffff', { id: 'b' }), res('pass', '#ffffff', { id: 'c' }), { id: 'h', status: 'hidden' }]
  const probe = [res('fail', PROBE, { id: 'a', fg: PROBE }), res('fail', '#ffffff', { id: 'b' }), res('fail', PROBE, { id: 'c' })]
  const reach = reachOf(light, probe)
  assert.deepEqual(reach, { a: { fg: true, bg: true }, b: { fg: false, bg: false }, c: { fg: false, bg: true } })
  const j = judgeDark([res('fail', '#172033', { id: 'a' }), res('fail', '#172033', { id: 'b', fg: '#000000' }), res('fail', '#172033', { id: 'c', fg: '#111111' })], tv, reach)
  assert.equal(j.fixable, 1)
  assert.equal(j.untokenized, 2)
  assert.ok(!j.feedback.some((g) => g.fg === '#000000' || g.fg === '#111111'), 'untokenized pairs not sent to the model')
})

test('pickBest keeps the first round on a tie; pickProvider keeps the default on a tie', () => {
  const a = { judge: { dark: true, fixable: 2 } }, b = { judge: { dark: true, fixable: 2 } }, c = { judge: { dark: true, fixable: 0 } }
  assert.equal(pickBest([a, b]), a)
  assert.equal(pickBest([a, c]), c)
  assert.equal(pickBest([{ judge: { dark: false, fixable: 0 } }, a]), a)
  const base = { id: 'baseten', best: a }, meta = { id: 'meta', best: b }
  assert.equal(pickProvider([base, meta]).id, 'baseten')
  assert.equal(pickProvider([base, { id: 'meta', best: c }]).id, 'meta')
  // Fewer failing pairs overall wins, even when both have no fixable failures left.
  const d = { judge: { dark: true, fail: 18, fixable: 0 } }, e = { judge: { dark: true, fail: 13, fixable: 0 } }
  assert.equal(pickProvider([{ id: 'baseten', best: d }, { id: 'meta', best: e }]).id, 'meta')
})

test('contextPairs: groups pairings, most common first, with tokens behind each side', () => {
  const p = contextPairs([res('pass', '#ffffff'), res('pass', '#ffffff'), res('fail', '#11cdef', { gradient: true, fg: '#ffffff' }), { status: 'hidden' }], tv)
  assert.equal(p.length, 2)
  assert.equal(p[0].count, 2)
  assert.deepEqual(p[0].bgTokens, ['color.surface.default', 'color.white'])
  assert.deepEqual(p[1].bgTokens, [], 'no token controls a gradient')
  assert.equal(p[1].gradient, true)
})

test('surfaceNote: names the background tokens under most text, gradients and untokenized surfaces left out', () => {
  const note = surfaceNote([
    { count: 3, bgTokens: ['nav.bg'], gradient: false }, { count: 9, bgTokens: ['color.surface.default', 'color.white'], gradient: false },
    { count: 50, bgTokens: [], gradient: true }, { count: 40, bgTokens: [], gradient: false },
  ])
  assert.match(note, /color\.surface\.default \(9 pairs\), nav\.bg \(3 pairs\)\. Each of them must get a dark value/)
  assert.equal(surfaceNote([]), '')
})

test('onSurfaceNote: lists on-surface text tokens when present, nothing otherwise', () => {
  assert.equal(onSurfaceNote(tv), '')
  const n = onSurfaceNote([...tv, { name: 'color.text.on-primary' }, { name: 'color.text.inverse' }])
  assert.match(n, /color\.text\.on-primary, color\.text\.inverse/)
})

const changes = [
  { token: 'color.surface.default', cssVar: 'color-surface-default', css: 'var(--color-gray-900)', isNew: false },
  { token: 'color.gray.900', cssVar: 'color-gray-900', css: '#172033', isNew: true },
  { token: 'color.text.default', cssVar: 'color-text-default', css: '#e9ecef', isNew: false },
  { token: 'color.bad', cssVar: 'color-bad', css: 'red;}body{x', isNew: false }, // never emitted
]

test('darkCss: media query that respects data-theme="light", plus an explicit data-theme="dark" block', () => {
  const css = darkCss(changes, { note: 'test' })
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme="light"\]\) \{/)
  assert.match(css, /\n:root\[data-theme="dark"\] \{\n/)
  // New primitives come first so the aliases read top-down.
  assert.ok(css.indexOf('--color-gray-900: #172033') < css.indexOf('--color-surface-default: var(--color-gray-900)'))
  assert.equal(css.match(/--color-text-default: #e9ecef;/g).length, 2)
  assert.ok(!/body\{/.test(css), 'unsafe value dropped')
  assert.ok(!css.includes('color-bad'))
  assert.match(forcedDarkCss(changes), /^:root \{\n {2}--color-gray-900: #172033;/)
})

test('siteDirOf: served-site runs use run/site; a copied run uses its own rewritten/', () => {
  const d = mkdtempSync(join(tmpdir(), 's2t-dark-'))
  assert.equal(siteDirOf(d, { serve: '/a/build', target: '/a/build/static/css' }, { outDir: '/x' }), join(d, 'site'))
  assert.equal(siteDirOf(d, { serve: '/a', target: '/a' }, { outDir: '/x' }), '/x')
  mkdirSync(join(d, 'rewritten'))
  assert.equal(siteDirOf(d, { serve: '/a', target: '/a' }, { outDir: '/x' }), join(d, 'rewritten'))
})

const preset = { id: 'baseten', baseURL: 'https://inference.baseten.co/v1', apiKey: 'bk-secret', model: 'meta-models/muse-spark-open-1026' }

test('askProvider: low reasoning effort, sanitized dark proposal, extra note appended, never a -contributor model, no key in errors', async () => {
  let seen = null
  const chatFn = async (o) => { seen = o; return { text: '{"summary":"dark","changes":[{"token":"color.gray.900","value":"#172033"},{"token":"color.surface.default","value":"color.gray.900"},{"token":"color.nope","value":"url(x)"}]}' } }
  const req = { task: 'dark', tokens: [], pairs: [], previous: [], failures: [], notDarkBg: null }
  const r = await askProvider(req, known, preset, { chatFn, extra: '\n\nNOTE' })
  assert.equal(seen.reasoningEffort, 'low')
  assert.ok(seen.messages[1].content.endsWith('NOTE'))
  assert.deepEqual(r.changes.map((c) => [c.token, c.css, c.isNew]), [['color.gray.900', '#172033', true], ['color.surface.default', 'var(--color-gray-900)', false]])
  assert.equal(r.rejected.length, 1)
  await assert.rejects(askProvider(req, known, { ...preset, model: 'muse-spark-1.3-contributor' }, { chatFn }), /contributor/)
  await assert.rejects(askProvider(req, known, preset, { chatFn: async () => { throw new Error('chat 401: bad key') } }), (e) => /baseten: chat 401/.test(e.message) && !/secret/.test(e.message))
})

test('darkLoop: retries once with the failures and the light background fed back, keeps the better round', async () => {
  const asks = []
  const replies = [
    { provider: 'baseten', model: 'm', ms: 5, cached: false, summary: '', rejected: [], changes: [{ token: 'color.text.default', cssVar: 'color-text-default', css: '#e9ecef' }] },
    { provider: 'baseten', model: 'm', ms: 7, cached: false, summary: '', rejected: [], changes: [{ token: 'color.surface.default', cssVar: 'color-surface-default', css: '#172033' }, { token: 'color.text.default', cssVar: 'color-text-default', css: '#e9ecef' }] },
  ]
  const ask = async (req) => { asks.push(req); return replies[asks.length - 1] }
  // Round 1 leaves the surface white (light text on white: fails, not dark); round 2 darkens it.
  const audit = async (cs) => cs.some((c) => c.token === 'color.surface.default')
    ? [res('pass', '#172033', { fg: '#e9ecef' }), res('pass', '#172033', { fg: '#e9ecef' })]
    : [res('fail', '#ffffff', { fg: '#e9ecef' }), res('fail', '#ffffff', { fg: '#e9ecef' })]
  const light = [res('pass', '#ffffff'), res('pass', '#ffffff')]
  const r = await darkLoop({ tokenValues: tv, light, known, audit, ask })
  assert.equal(asks.length, 2)
  assert.equal(asks[0].task, 'dark')
  assert.equal(asks[0].pairs.length, 1)
  assert.equal(asks[1].notDarkBg, '#ffffff')
  assert.equal(asks[1].failures.length, 1)
  assert.deepEqual(asks[1].previous, [{ token: 'color.text.default', value: '#e9ecef' }])
  assert.equal(r.kept, 1)
  assert.equal(r.best.judge.dark, true)
  assert.equal(r.best.judge.fixable, 0)
})

test('darkLoop: no retry when the first round is dark and nothing fixable fails', async () => {
  let n = 0
  const ask = async () => { n++; return { provider: 'meta', model: 'm', ms: 1, cached: true, summary: '', rejected: [], changes: [{ token: 'color.surface.default', cssVar: 'color-surface-default', css: '#000000' }] } }
  const audit = async () => [res('pass', '#000000'), res('fail', '#11cdef', { gradient: true })]
  const r = await darkLoop({ tokenValues: tv, light: [res('pass', '#ffffff')], known, audit, ask })
  assert.equal(n, 1)
  assert.equal(r.kept, 0)
  assert.equal(r.best.judge.onGradient, 1)
})

test('contrastScript: contrast.js runs as a classic script and exposes auditLive', () => {
  const ctx = { window: {} }
  vm.runInNewContext(contrastScript(), ctx)
  assert.equal(typeof ctx.window.__s2tContrast.auditLive, 'function')
})

test('darkPrSection + includeDarkInPr: copies tokens.dark.css next to tokens.css and appends the section', () => {
  const run = mkdtempSync(join(tmpdir(), 's2t-dark-run-'))
  const repo = mkdtempSync(join(tmpdir(), 's2t-dark-repo-'))
  const body = join(run, 'pr-body.md')
  writeFileSync(body, '# PR\n')
  assert.equal(includeDarkInPr(run, join(repo, 'css', 'tokens.css'), repo, body), null, 'no dark theme: no-op')
  const dark = { before: { pass: 46, checked: 87 }, after: { pass: 84, checked: 87, darkShare: 0.8, onGradient: 3 }, changes: [1, 2], winner: { label: 'Muse Spark Open on Baseten' } }
  writeFileSync(join(run, 'tokens.dark.css'), ':root{}')
  writeFileSync(join(run, 'dark.json'), JSON.stringify(dark))
  mkdirSync(join(repo, 'css'))
  assert.equal(includeDarkInPr(run, join(repo, 'css', 'tokens.css'), repo, body), 'css/tokens.dark.css')
  assert.equal(readFileSync(join(repo, 'css', 'tokens.dark.css'), 'utf-8'), ':root{}')
  const md = readFileSync(body, 'utf-8')
  assert.match(md, /## Dark theme \(optional file\)/)
  assert.match(md, /\| Dark theme \(tokens\.dark\.css\) \| 84 of 87 \|/)
  assert.match(md, /3 failing pairs sit on a gradient/)
  assert.ok(!/\baccessible\b|compliant/i.test(md), 'wording rule: no verdicts')
  assert.equal(darkPrSection(null, 'x'), '')
})
