import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteVue } from '../src/providers/coder/deterministic.js'

const clusters = [{ id: 'color-01', kind: 'color', value: '#ff6600ff', members: [{ value: '#ff6600ff', count: 3 }], count: 3, props: {}, regionLabels: {} }]
const tokens = [
  { name: 'color.orange.500', tier: 'primitive', value: '#ff6600ff', clusters: ['color-01'], why: '' },
  { name: 'color.surface.brand', tier: 'semantic', alias: 'color.orange.500', clusters: ['color-01'], why: '' },
]

test('rewriteVue: rewrites plain <style> blocks with file line numbers, skips scss', () => {
  const src = `<template>\n  <div class="header">HN</div>\n</template>\n\n<style scoped>\n.header {\n  background-color: #ff6600;\n}\n</style>\n<style lang="scss">\n.x { color: #ff6600; }\n</style>\n`
  const { code, edits, changed } = rewriteVue(src, 'App.vue', clusters, tokens)
  assert.equal(changed, true)
  assert.match(code, /background-color: var\(--color-surface-brand, #ff6600\);/)
  assert.match(code, /\.x \{ color: #ff6600; \}/)
  assert.equal(edits.length, 1)
  assert.equal(edits[0].line, 7)
  assert.match(code, /<template>\n  <div class="header">HN<\/div>/)
})
