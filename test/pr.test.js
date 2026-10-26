import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { prBody, runPr } from '../src/stages/pr.js'

const tokens = { namer: 'mock-heuristic', tokens: [
  { name: 'color.blue.500', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: 'Merges 2 values.' },
  { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.500', clusters: ['color-01'], why: 'Button fill.' },
] }

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 's2t-pr-'))
  const repo = join(dir, 'app'), runDir = join(dir, 'run')
  mkdirSync(join(repo, 'css'), { recursive: true })
  mkdirSync(join(runDir, 'rewritten', 'css'), { recursive: true })
  writeFileSync(join(repo, 'css', 'a.css'), 'a { color: #1a73e8; }\n')
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't')
  g('add', '-A'); g('commit', '-q', '-m', 'init')
  writeFileSync(join(runDir, 'rewritten', 'css', 'a.css'), 'a { color: var(--color-action-primary, #1a73e8); }\n')
  writeFileSync(join(runDir, 'tokens.css'), ':root { --color-blue-500: #1a73e8; }\n')
  writeFileSync(join(runDir, 'tokens.json'), JSON.stringify(tokens))
  const rewrite = { coder: 'deterministic', written: true, outDir: join(runDir, 'rewritten'), files: ['css/a.css'], edits: [{ file: 'css/a.css', line: 1, prop: 'color', before: '#1a73e8', after: 'var(--color-action-primary, #1a73e8)', token: 'color.action.primary' }] }
  writeFileSync(join(runDir, 'rewrite.json'), JSON.stringify(rewrite))
  return { repo, runDir, rewrite, g }
}

test('prBody lists tokens, uses and verify rows', () => {
  const body = prBody({ tokens, rewrite: { files: ['a.css'], edits: [{ token: 'color.action.primary' }] }, verify: { ratio: 0.01, fallback: { diffPixels: 0, pass: true }, colors: { ratio: 0, pass: true } }, tokensCssRel: 'tokens.css' })
  assert.match(body, /Replaces 1 hardcoded values in 1 files/)
  assert.match(body, /\| `color.action.primary` \| `--color-action-primary` \| → `color.blue.500` \| 1 \|/)
  assert.match(body, /0 px changed, pass/)
})

test('runPr commits on a new branch, does not push without open', () => {
  const { repo, runDir, g } = setup()
  const r = runPr({ runDir, repoDir: repo, targetDir: repo, branch: 's2t/test' })
  assert.equal(r.opened, false)
  assert.equal(g('branch', '--show-current').toString().trim(), 's2t/test')
  assert.match(readFileSync(join(repo, 'css', 'a.css'), 'utf-8'), /var\(--color-action-primary/)
  assert.ok(existsSync(join(repo, 'tokens.css')))
  assert.match(g('log', '--oneline').toString(), /Design tokens: replace 1 hardcoded values/)
})

test('runPr refuses a dirty tree and a failed fallback verify', () => {
  const { repo, runDir } = setup()
  writeFileSync(join(repo, 'dirty.txt'), 'x')
  assert.throws(() => runPr({ runDir, repoDir: repo, targetDir: repo }), /not clean/)
  writeFileSync(join(runDir, 'verify.json'), JSON.stringify({ fallback: { pass: false } }))
  assert.throws(() => runPr({ runDir, repoDir: repo, targetDir: repo }), /fallback-only render changed/)
})
