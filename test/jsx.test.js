import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { rewriteJsx, kebab } from '../src/providers/coder/jsx.js'
import deterministicCoder from '../src/providers/coder/deterministic.js'

const clusters = [
  { id: 'color-01', kind: 'color', value: '#1a73e8ff', members: [{ value: '#1a73e8ff', count: 2 }, { value: '#1b74e9ff', count: 1 }], count: 3, props: {}, regionLabels: {} },
  { id: 'radius-01', kind: 'radius', value: '4px', members: [{ value: '4px', count: 2 }], count: 2, props: {}, regionLabels: {} },
]
const tokens = { namer: 't', tokens: [
  { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: '' },
  { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: '' },
  { name: 'radius.sm', tier: 'primitive', value: '4px', clusters: ['radius-01'], why: '' },
] }

test('kebab', () => assert.equal(kebab('backgroundColor'), 'background-color'))

test('rewriteJsx: inline style, numeric radius gets px fallback', () => {
  const src = `export const B = () => <button style={{ backgroundColor: '#1b74e9', borderRadius: 4 }}>Hi</button>`
  const pick = (kind, prop, v) => kind === 'color' ? { cssVar: '--color-action-primary', token: 'color.action.primary' } : { cssVar: '--radius-sm', token: 'radius.sm' }
  const { code, edits } = rewriteJsx(src, 'B.jsx', pick)
  assert.match(code, /var\(--color-action-primary, #1b74e9\)/)
  assert.match(code, /var\(--radius-sm, 4px\)/)
  assert.equal(edits.length, 2)
})

test('deterministic coder rewrites jsx and skips node_modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-jsx-'))
  const target = join(dir, 'app'), runDir = join(dir, 'run')
  mkdirSync(join(target, 'src'), { recursive: true })
  mkdirSync(join(target, 'node_modules', 'x'), { recursive: true })
  writeFileSync(join(target, 'src', 'B.jsx'), `export const B = () => <b style={{ color: '#1a73e8' }}>x</b>\n`)
  writeFileSync(join(target, 'node_modules', 'x', 'y.css'), `a { color: #1a73e8; }\n`)
  const r = await deterministicCoder().rewrite({ targetDir: target, tokens, clusters, write: true, runDir })
  assert.deepEqual(r.files, ['src/B.jsx'])
  assert.ok(!existsSync(join(runDir, 'rewritten', 'node_modules')))
  assert.match(readFileSync(join(runDir, 'rewritten', 'src', 'B.jsx'), 'utf-8'), /var\(--color-/)
})

test('deterministic coder: a single-file target rewrites only that file', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readdirSync } = await import('fs')
  const dir = mkdtempSync(join(tmpdir(), 's2t-file-'))
  mkdirSync(join(dir, 'css'))
  writeFileSync(join(dir, 'css', 'app.css'), 'a { color: #1a73e8; }\n')
  writeFileSync(join(dir, 'css', 'app.min.css'), 'a{color:#1a73e8}')
  const r = await deterministicCoder().rewrite({ targetDir: join(dir, 'css', 'app.css'), tokens, clusters, write: true, runDir: join(dir, 'run') })
  assert.deepEqual(r.files, ['app.css'])
  assert.deepEqual(readdirSync(join(dir, 'run', 'rewritten')), ['app.css'])
})
