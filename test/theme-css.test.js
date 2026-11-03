// Playground theme export: the in-browser CSS builders match the CLI's writers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { darkThemeCss, darkNote, tokensCssWith, tokensCssFrom, changesCss } from '../src/preview-client/theme-css.js'
import { darkCss } from '../src/stages/dark.js'
import { toCss } from '../src/stages/emit.js'

const CHANGES = [
  { token: 'color.surface.default', cssVar: 'color-surface-default', css: 'var(--color-gray-900)', reason: 'dark page' },
  { token: 'color.gray.900', cssVar: 'color-gray-900', css: '#111827', isNew: true, reason: 'new primitive' },
  { token: 'color.text.default', cssVar: 'color-text-default', css: '#e5e7eb', reason: 'light text' },
  { token: 'bad', cssVar: 'bad', css: 'red; } body { x', reason: 'unsafe' },
]

test('darkThemeCss matches dark.js darkCss byte for byte (with and without a note)', () => {
  const note = darkNote({ app: 'Argon Dashboard', date: '2026-11-03', pass: 80, checked: 87 })
  assert.equal(note, 'Argon Dashboard, 2026-11-03, 80 of 87 text pairs pass')
  assert.equal(darkThemeCss(CHANGES, { note }), darkCss(CHANGES, { note }))
  assert.equal(darkThemeCss(CHANGES), darkCss(CHANGES))
  const css = darkThemeCss(CHANGES, { note })
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n  :root:not\(\[data-theme="light"\]\) \{\n    --color-gray-900: #111827;/)
  assert.match(css, /:root\[data-theme="dark"\] \{\n  --color-gray-900: #111827;/)
  assert.doesNotMatch(css, /body \{ x/)
})

test('tokensCssFrom matches emit.js toCss for the same tokens', () => {
  const set = { tokens: [
    { name: 'color.text.muted', tier: 'semantic', alias: 'color.blue.400' },
    { name: 'color.blue.400', tier: 'primitive', value: '#8898aa' },
    { name: 'button.bg', tier: 'component', alias: 'color.action.primary' },
  ] }
  const pg = set.tokens.map((t) => ({ ...t, cssVar: t.name.replace(/\./g, '-'), value: t.value || null, alias: t.alias || null }))
  assert.equal(tokensCssFrom(pg), toCss(set))
})

test('tokensCssWith: overrides replace values in place, unknown ones are appended, unsafe ones skipped', () => {
  const base = toCss({ tokens: [{ name: 'color.text.muted', tier: 'semantic', alias: 'color.blue.400' }, { name: 'color.blue.400', tier: 'primitive', value: '#8898aa' }] })
  const out = tokensCssWith(base, { 'color-text-muted': '#687889', 'color-new': '#123456', 'x': 'url(evil)' })
  assert.match(out, /  --color-text-muted: #687889;/)
  assert.match(out, /  --color-blue-400: #8898aa;/)
  assert.match(out, /  \/\* overrides \*\/\n  --color-new: #123456;\n\}/)
  assert.doesNotMatch(out, /evil/)
  assert.equal(out.split('\n').length, base.split('\n').length + 2)
})

test('changesCss: only the changed properties, one :root block', () => {
  assert.equal(changesCss({ 'color-text-muted': '#687889', 'button-bg': 'var(--color-red-500)' }),
    '/* Token changes from the playground. Paste after tokens.css. */\n:root {\n  --color-text-muted: #687889;\n  --button-bg: var(--color-red-500);\n}\n')
})
