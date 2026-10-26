import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitOutsideParens, pickToken, rewriteCss } from '../src/providers/coder/deterministic.js'
import { coderFor, runRewrite } from '../src/stages/rewrite.js'

/** @type {import('../src/types.js').Cluster[]} */
const clusters = [
  { id: 'color-01', kind: 'color', value: '#1a73e8ff', members: [{ value: '#1a73e8ff', count: 3 }], count: 3, props: {}, regionLabels: {} },
  { id: 'space-01', kind: 'space', value: '8px', members: [{ value: '8px', count: 2 }], count: 2, props: {}, regionLabels: {} },
  { id: 'space-02', kind: 'space', value: '16px', members: [{ value: '16px', count: 2 }], count: 2, props: {}, regionLabels: {} },
]

/** @type {import('../src/types.js').TokenProposal[]} */
const tokens = [
  { name: 'color.blue.600', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: '' },
  { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.600', clusters: ['color-01'], why: '' },
  { name: 'color.border.default', tier: 'semantic', alias: 'color.blue.600', clusters: ['color-01'], why: '' },
  { name: 'space.sm', tier: 'primitive', value: '8px', clusters: ['space-01'], why: '' },
  { name: 'space.lg', tier: 'primitive', value: '16px', clusters: ['space-02'], why: '' },
]

test('splitOutsideParens keeps rgb(...) intact and splits elsewhere', () => {
  const parts = splitOutsideParens('1px solid rgb(26, 115, 232)').map((p) => p.text)
  assert.deepEqual(parts, ['1px', 'solid', 'rgb(26, 115, 232)'])
  assert.deepEqual(splitOutsideParens('8px 16px').map((p) => p.text), ['8px', '16px'])
})

test('pickToken prefers role-matching semantic, then any semantic, then primitive', () => {
  const cluster = clusters[0]
  assert.equal(pickToken('background-color', cluster, tokens).name, 'color.action.primary')
  assert.equal(pickToken('border', cluster, tokens).name, 'color.border.default')
  assert.equal(pickToken('padding', clusters[1], tokens).name, 'space.sm')
})

test('rewriteCss: shorthand split, semantic preference, var() skip', () => {
  const src = [
    '.btn {',
    '  background-color: rgb(26, 115, 232);',
    '  border: 1px solid #1a73e8;',
    '  padding: 8px 16px;',
    '  color: var(--existing, #1a73e8);',
    '  z-index: 2;',
    '}',
  ].join('\n')
  const { code, edits, changed } = rewriteCss(src, 'styles.css', clusters, tokens)
  assert.equal(changed, true)
  assert.match(code, /background-color: var\(--color-action-primary, rgb\(26, 115, 232\)\);/)
  assert.match(code, /border: 1px solid var\(--color-border-default, #1a73e8\);/)
  assert.match(code, /padding: var\(--space-sm, 8px\) var\(--space-lg, 16px\);/)
  // var() skip: untouched, no double wrap.
  assert.match(code, /color: var\(--existing, #1a73e8\);/)
  // unknown prop untouched.
  assert.match(code, /z-index: 2;/)

  const props = edits.map((e) => e.prop)
  assert.deepEqual(props.sort(), ['background-color', 'border', 'padding', 'padding'])
  const bg = edits.find((e) => e.prop === 'background-color')
  assert.equal(bg.before, 'rgb(26, 115, 232)')
  assert.equal(bg.token, 'color.action.primary')
  assert.equal(bg.line, 2)
})

test('runRewrite: copies targetDir, writes rewritten copy + rewrite.json/.diff, leaves target untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 's2t-rewrite-'))
  const targetDir = join(root, 'target')
  const runDir = join(root, 'run')
  mkdirSync(targetDir, { recursive: true })
  const original = '.btn {\n  background-color: rgb(26, 115, 232);\n  padding: 8px 16px;\n}\n.keep { color: #000; }\n'
  writeFileSync(join(targetDir, 'styles.css'), original)
  writeFileSync(join(targetDir, 'notes.txt'), 'not css, ignored')

  const tokenSet = { tokens, namer: 'test' }
  const result = await runRewrite({ targetDir, tokens: tokenSet, clusters, write: true, runDir })

  assert.equal(result.coder, 'deterministic')
  assert.equal(result.written, true)
  assert.equal(result.outDir, join(runDir, 'rewritten'))
  assert.deepEqual(result.files, ['styles.css'])
  assert.ok(result.edits.length >= 3)

  // Original target dir is never modified.
  assert.equal(readFileSync(join(targetDir, 'styles.css'), 'utf-8'), original)

  // Rewritten copy has the edits applied.
  const rewritten = readFileSync(join(runDir, 'rewritten', 'styles.css'), 'utf-8')
  assert.match(rewritten, /var\(--color-action-primary, rgb\(26, 115, 232\)\)/)
  assert.match(rewritten, /var\(--space-sm, 8px\) var\(--space-lg, 16px\)/)
  assert.match(rewritten, /\.keep \{ color: #000; \}/) // untouched rule preserved

  // Non-css files are still copied verbatim.
  assert.equal(readFileSync(join(runDir, 'rewritten', 'notes.txt'), 'utf-8'), 'not css, ignored')

  // rewrite.json + rewrite.diff are written.
  const rewriteJson = JSON.parse(readFileSync(join(runDir, 'rewrite.json'), 'utf-8'))
  assert.equal(rewriteJson.files.length, 1)
  const diff = readFileSync(join(runDir, 'rewrite.diff'), 'utf-8')
  assert.match(diff, /^--- a\/styles\.css/m)
  assert.match(diff, /^-.*background-color: rgb\(26, 115, 232\);/m)
  assert.match(diff, /^\+.*var\(--color-action-primary/m)

  rmSync(root, { recursive: true, force: true })
})

test('runRewrite with write:false: copy is pristine, edits still reported', async () => {
  const root = mkdtempSync(join(tmpdir(), 's2t-rewrite-dry-'))
  const targetDir = join(root, 'target')
  const runDir = join(root, 'run')
  mkdirSync(targetDir, { recursive: true })
  const original = '.btn { background-color: rgb(26, 115, 232); }\n'
  writeFileSync(join(targetDir, 'styles.css'), original)

  const tokenSet = { tokens, namer: 'test' }
  const result = await runRewrite({ targetDir, tokens: tokenSet, clusters, write: false, runDir })

  assert.equal(result.written, false)
  assert.ok(result.edits.length >= 1)
  assert.deepEqual(result.files, ['styles.css'])
  // Copy exists but was never overwritten with edits.
  assert.equal(readFileSync(join(runDir, 'rewritten', 'styles.css'), 'utf-8'), original)

  rmSync(root, { recursive: true, force: true })
})

test('coderFor: unknown id throws, meta throws a clear "not configured" error', async () => {
  assert.throws(() => coderFor('nope'), /unknown coder/)
  const meta = coderFor('meta')
  assert.equal(meta.id, 'meta-code')
  await assert.rejects(meta.rewrite({}), /Muse Code provider not configured yet/)
})
