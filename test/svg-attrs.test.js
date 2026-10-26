import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteSvgAttrs } from '../src/providers/coder/svg-attrs.js'

const pick = (kind, prop, v) => (v === '#1a73e8ff' ? { cssVar: '--color-action-primary', token: 'color.action.primary' } : null)

test('moves matched fill/stroke into style, merges an existing style, leaves the rest', () => {
  const src = `<svg fill="none">\n<circle r="10" fill="#1a73e8" />\n<rect style="opacity: .5" stroke="#1A73E8" fill="#eee"/>\n<path d="M0" stroke="#fff"/></svg>`
  const { code, edits } = rewriteSvgAttrs(src, 'index.html', pick)
  assert.match(code, /<circle r="10" style="fill: var\(--color-action-primary, #1a73e8\)" \/>/)
  assert.match(code, /<rect style="opacity: .5; stroke: var\(--color-action-primary, #1A73E8\)" fill="#eee"\/>/)
  assert.match(code, /<path d="M0" stroke="#fff"\/>/)
  assert.match(code, /<svg fill="none">/)
  assert.deepEqual(edits.map((e) => e.line), [2, 3])
})
