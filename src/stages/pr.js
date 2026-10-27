// PR: take a reviewed run to a branch in the target repo, and (only with open:true) push + open a draft PR.
// Deterministic git + gh. Muse Code can later write the commit message / PR body from the same plan;
// the mechanical apply stays here either way.
//
// Safety: refuses a dirty working tree, always works on a NEW branch, never pushes unless open:true.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { execFileSync } from 'child_process'
import { cssVarOf } from '../lib/props.js'
import { evaluateReason } from './reasons.js'
import { includeDarkInPr } from './dark.js'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** "https://github.com/owner/repo(.git)" or "git@github.com:owner/repo(.git)" → "owner/repo". Pure; exported for tests. */
export function repoFromRemote(url) {
  const m = String(url).trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

/** Group contrast pairs by (text color, background, minimum, tokens) so one bad pairing is one row. */
function groupPairs(list) {
  const groups = new Map()
  for (const p of list) {
    const k = [p.fg, p.bg, p.required, (p.tokens || []).join(',')].join('|')
    const g = groups.get(k) || { ...p, count: 0, examples: [] }
    g.count++
    if (g.examples.length < 3 && !g.examples.includes(p.text)) g.examples.push(p.text)
    g.ratio = Math.min(g.ratio, p.ratio)
    groups.set(k, g)
  }
  return Array.from(groups.values()).sort((a, b) => a.ratio - b.ratio)
}

/** The "Text contrast (WCAG 2.x AA)" section: method, regressions (blocking), then existing failures with their tokens. */
export function contrastSection(c) {
  if (!c || c.error) return []
  const cell = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ')
  const table = (list) => [
    '| Text color | Background (measured) | Ratio | AA min | Pairs | Examples | Token for the text color |',
    '|---|---|---|---|---|---|---|',
    ...groupPairs(list).map((g) => `| \`${g.fg}\` | \`${g.bg}\` | ${g.ratio}:1 | ${g.required}:1${g.large ? ' (large)' : ''} | ${g.count} | ${cell(g.examples.map((e) => `"${e}"`).join(', '))} | ${(g.tokens || []).map((t) => `\`${cssVarOf(t)}\``).join(', ') || 'none'} |`),
  ]
  const fa = c.failingAfter || {}
  const lines = [
    '## Text contrast (WCAG 2.x AA)',
    `${c.pairs} text pairs on the captured page were measured against the SC 1.4.3 minimum (4.5:1, or 3:1 for large text). Text color comes from the computed style; the background is measured on the rendered pixels around the letters, so text on gradients and images is included.`,
    '',
    `Below the minimum: ${c.failingBefore} before this change, ${fa.colors ?? fa.all ?? c.failingBefore} after it. ${c.regressions.length ? `**${c.regressions.length} pair${c.regressions.length === 1 ? '' : 's'} newly below the minimum: verify fails.**` : 'No pair newly falls below the minimum.'}`,
    '',
  ]
  if (c.regressions.length) lines.push('### Newly below the minimum', ...table(c.regressions), '')
  if (c.failing && c.failing.length) lines.push('### Already below the minimum (not changed by this PR)', 'Fixing one of these is a token change: adjust the token in the last column and re-run verify.', '', ...table(c.failing), '')
  lines.push('This checks text contrast on the captured route only. It does not cover hover or focus states, placeholders, non-text contrast, keyboard use or screen readers.', '')
  return lines
}

/** PR body from the run artifacts. Pure; exported for tests. */
export function prBody({ tokens, rewrite, verify, eval: score, tokensCssRel, clusters = [], verifiedOn = '' }) {
  // Same grounding check as the report's spec cards: a reason that cites anything the cluster data doesn't support
  // is replaced by a plain reason built from the data and marked, and role conflicts are flagged for review.
  const byId = new Map(clusters.map((c) => [c.id, c]))
  const reason = (t) => {
    const cl = (t.clusters || []).map((id) => byId.get(id)).filter(Boolean)
    if (!cl.length) return t.why || ''
    const r = evaluateReason(t, cl)
    return `${r.text}${r.unverified ? ' _(model reason replaced: unverified)_' : ''}${r.rolesDiffer ? ' **Roles differ: review.**' : ''}`
  }
  const usedBy = {}
  for (const e of rewrite.edits) usedBy[e.token] = (usedBy[e.token] || 0) + 1
  const byTier = { primitive: [], semantic: [], component: [] }
  for (const t of tokens.tokens) if (t.review !== 'rejected') (byTier[t.tier] || (byTier[t.tier] = [])).push(t)
  const row = (t) => `| \`${t.name}\` | \`${cssVarOf(t.name)}\` | ${t.value || `→ \`${t.alias}\``} | ${usedBy[t.name] || 0} | ${reason(t).replace(/\|/g, '/')} |`
  const pct = (v) => (v ? `${(v.ratio * 100).toFixed(3)}%` : 'not run')
  const lines = [
    `Replaces ${rewrite.edits.length} hardcoded values in ${rewrite.files.length} files with design tokens.`,
    '',
    `Every replacement keeps the original value as the fallback, \`var(--token, original)\`, so nothing changes until \`${tokensCssRel}\` is loaded.`,
    '',
    '## Verify',
    ...(verifiedOn ? [`Measured by rendering ${verifiedOn} before and after with the same stylesheet rules.`, ''] : []),
    '| Check | Result |',
    '|---|---|',
    `| Fallbacks only (must be identical) | ${verify?.fallback ? `${verify.fallback.diffPixels} px changed, ${verify.fallback.pass ? 'pass' : 'FAIL'}` : 'not run'} |`,
    `| Colors merged | ${verify?.colors ? `${pct(verify.colors)}, ${verify.colors.pass ? 'pass' : 'FAIL'}` : 'not run'} |`,
    `| All tokens (layout cleanup, review) | ${pct(verify)} |`,
    ...(verify?.contrast && !verify.contrast.error ? [`| Text contrast, WCAG 2.x AA (no new failing pairs) | ${verify.contrast.failingBefore} of ${verify.contrast.pairs} pairs below AA before, ${verify.contrast.regressions.length} regressions, ${verify.contrast.pass ? 'pass' : 'FAIL'} |`] : []),
    '',
    ...contrastSection(verify?.contrast),
  ]
  if (score) lines.push(`Eval against the golden set: ${score.passed}/${score.total}.`, '')
  if (tokens.reviewed) lines.push(`Reviewed by a person: ${tokens.reviewed.decisions} decisions applied.`, '')
  for (const tier of ['semantic', 'component', 'primitive']) {
    if (!byTier[tier]?.length) continue
    lines.push(`## ${tier[0].toUpperCase() + tier.slice(1)} tokens (${byTier[tier].length})`, '| Token | CSS var | Value | Uses | Why |', '|---|---|---|---|---|', ...byTier[tier].map(row), '')
  }
  lines.push(`Proposed by ${tokens.namer}; generated by screenshot-to-tokens.`)
  return lines.join('\n')
}

/**
 * @param {{runDir:string, repoDir:string, targetDir:string, branch?:string, tokensCssPath?:string, open?:boolean, title?:string}} o
 *   repoDir: git root of the app. targetDir: the folder that was rewritten (inside repoDir).
 *   tokensCssPath: where tokens.css goes (default <targetDir>/tokens.css).
 */
export function runPr(o) {
  // A single-file target means "rewrite this file": its folder is where the rewritten file and tokens.css go.
  if (statSync(o.targetDir).isFile()) o = { ...o, targetDir: dirname(o.targetDir) }
  const rd = (n) => JSON.parse(readFileSync(join(o.runDir, `${n}.json`), 'utf-8'))
  const rewrite = rd('rewrite')
  const tokens = rd('tokens')
  const verify = existsSync(join(o.runDir, 'verify.json')) ? rd('verify') : null
  const score = existsSync(join(o.runDir, 'eval.json')) ? rd('eval') : null
  if (verify && verify.fallback && !verify.fallback.pass) throw new Error('verify failed: fallback-only render changed; refusing to open a PR')
  if (git(o.repoDir, 'status', '--porcelain')) throw new Error(`working tree in ${o.repoDir} is not clean; commit or stash first`)

  const branch = o.branch || `s2t/tokens-${new Date().toISOString().slice(0, 10)}`
  git(o.repoDir, 'checkout', '-b', branch)
  for (const f of rewrite.files) {
    const dest = join(o.targetDir, f)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(rewrite.outDir, f), dest)
  }
  const tokensCss = o.tokensCssPath || join(o.targetDir, 'tokens.css')
  copyFileSync(join(o.runDir, 'tokens.css'), tokensCss)
  const tokensCssRel = relative(o.repoDir, tokensCss)
  const clusters = existsSync(join(o.runDir, 'clusters.json')) ? rd('clusters') : []
  const runMeta = existsSync(join(o.runDir, 'run.json')) ? rd('run') : {}
  const verifiedOn = runMeta.serve ? `the app's production build (\`${runMeta.serve.split('/').slice(-2).join('/')}\`)` : ''
  const body = prBody({ tokens, rewrite, verify, eval: score, tokensCssRel, clusters, verifiedOn })
  // Absolute: gh runs with cwd = the app repo, not this project.
  const bodyPath = resolve(o.runDir, 'pr-body.md')
  writeFileSync(bodyPath, body)
  includeDarkInPr(o.runDir, tokensCss, o.repoDir, bodyPath) // L14: optional tokens.dark.css + its own PR section
  const title = o.title || `Design tokens: replace ${rewrite.edits.length} hardcoded values`
  git(o.repoDir, 'add', '-A')
  git(o.repoDir, 'commit', '-m', title, '-m', `Adds ${tokensCssRel} and rewrites literals to var(--token, fallback). Fallback-only render verified identical.`)
  const result = { branch, files: rewrite.files.length + 1, bodyPath, opened: false, url: null }
  if (o.open) {
    git(o.repoDir, 'push', '-u', 'origin', branch)
    // Open the PR on the clone's OWN origin repo. In a clone of a fork, `gh pr create` can otherwise default to the
    // upstream parent, which would send an unsolicited PR to the original authors.
    const originRepo = repoFromRemote(git(o.repoDir, 'remote', 'get-url', 'origin'))
    if (!originRepo) throw new Error('could not read owner/repo from the origin remote; not opening a PR')
    const base = o.base || git(o.repoDir, 'rev-parse', '--abbrev-ref', `origin/HEAD`).replace(/^origin\//, '') || 'main'
    result.url = execFileSync('gh', ['pr', 'create', '--draft', '--repo', originRepo, '--base', base, '--head', branch, '--title', title, '--body-file', bodyPath], { cwd: o.repoDir, encoding: 'utf-8' }).trim()
    result.repo = originRepo
    result.opened = true
  }
  return result
}
