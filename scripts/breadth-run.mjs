#!/usr/bin/env node
// L2 breadth run: every site in the demo pool (public, permissively licensed *.github.io sites), mirrored locally
// (scripts/mirror-site.mjs) and run end to end with the hybrid segmenter and the open-weights namer. One site at a
// time; a failure is recorded and the run moves on. Writes out/breadth/summary.json and out/breadth/table.md.
//   node scripts/breadth-run.mjs <demo-site-pool.md> [--mirrors /Volumes/SanDisk/s2t-breadth] [--only owner1,owner2]
// L6 (--reverify): re-run only the verify stage on every finished site and record whether the result repeats.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { parseArgs } from '../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const pool = a._[0]
if (!pool) { console.error('usage: node scripts/breadth-run.mjs <demo-site-pool.md> [--mirrors dir] [--only a,b] [--reverify]'); process.exit(2) }
const mirrors = resolve(a.mirrors || '/Volumes/SanDisk/s2t-breadth')
const outRoot = resolve('out/breadth')
mkdirSync(outRoot, { recursive: true })

/** Pool table rows: | Licence | Framework | owner/owner.github.io | — exported shape for the summary. */
export function poolSites(md) {
  const rows = []
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([\w.-]+)\s*\|\s*(\w+)\s*\|\s*([\w-]+)\/([\w.-]+\.github\.io)\s*\|/)
    if (m) rows.push({ licence: m[1], framework: m[2], owner: m[3], url: `https://${m[4].toLowerCase()}/` })
  }
  return rows
}

const env = { ...process.env, S2T_SEGMENTER: process.env.S2T_SEGMENTER || 'hybrid', S2T_NAMER: process.env.S2T_NAMER || 'baseten' }
const run = (args, timeout) => spawnSync(process.execPath, args, { env, encoding: 'utf-8', timeout })
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null)
const summaryPath = join(outRoot, 'summary.json')
const summary = readJson(summaryPath) || {}

let sites = poolSites(readFileSync(pool, 'utf-8'))
if (a.only) { const only = new Set(String(a.only).split(',')); sites = sites.filter((s) => only.has(s.owner)) }

function verifyOf(runDir) {
  const v = readJson(join(runDir, 'verify.json'))
  if (!v) return null
  return v
}

for (const [i, s] of sites.entries()) {
  const runDir = join(outRoot, s.owner)
  const t0 = Date.now()
  const row = summary[s.owner] || { ...s }
  if (a.reverify) {
    if (!existsSync(join(runDir, 'rewrite.json'))) continue
    const before = JSON.stringify(verifyOf(runDir))
    const r = run(['src/cli.js', 'run', '--serve', join(mirrors, s.owner), '--run', runDir, '--from', 'verify', '--to', 'verify'], 180000)
    const after = verifyOf(runDir)
    row.reverify = { ok: r.status === 0, same: JSON.stringify(after) === before, verify: after, ms: Date.now() - t0 }
  } else {
    const m = run(['scripts/mirror-site.mjs', s.url, join(mirrors, s.owner)], 120000)
    const files = Number((m.stdout || '').match(/mirror: (\d+) files/)?.[1] || 0)
    if (m.status !== 0 || !files) {
      Object.assign(row, { status: 'mirror-failed', error: (m.stderr || m.stdout || '').trim().slice(-200), ms: Date.now() - t0 })
    } else {
      const r = run(['src/cli.js', 'run', '--serve', join(mirrors, s.owner), '--run', runDir], 420000)
      const log = (r.stdout || '') + (r.stderr || '')
      const tokens = readJson(join(runDir, 'tokens.json'))
      const rw = readJson(join(runDir, 'rewrite.json'))
      Object.assign(row, {
        status: r.status === 0 ? 'ok' : 'failed', files,
        error: r.status === 0 ? null : log.trim().split('\n').slice(-2).join(' ').slice(0, 300),
        tokens: tokens ? tokens.tokens.length : null, edits: rw ? rw.edits.length : null,
        verifyLine: (log.match(/verify\s+(.*)/) || [])[1] || null, verify: verifyOf(runDir), ms: Date.now() - t0,
      })
    }
  }
  summary[s.owner] = row
  writeFileSync(summaryPath, JSON.stringify(summary, null, 1))
  console.log(`[${i + 1}/${sites.length}] ${s.owner}: ${a.reverify ? (row.reverify ? (row.reverify.same ? 'same' : 'DIFFERENT') : 'skipped') : row.status} ${row.verifyLine || row.error || ''}`.slice(0, 220))
}

// Table for docs/breadth.md.
const rows = Object.values(summary)
const lines = ['| Site | Framework | Licence | Status | Tokens | Edits | Safety checks | Repeat |', '|---|---|---|---|---|---|---|---|']
for (const r of rows) lines.push(`| ${r.url.replace(/^https:\/\/|\/$/g, '')} | ${r.framework} | ${r.licence} | ${r.status} | ${r.tokens ?? '-'} | ${r.edits ?? '-'} | ${r.verifyLine ? r.verifyLine.replace(/; all tokens.*/, '') : (r.error || '-').slice(0, 80)} | ${r.reverify ? (r.reverify.same ? 'same' : 'different') : '-'} |`)
writeFileSync(join(outRoot, 'table.md'), lines.join('\n') + '\n')
console.log(`table → ${join(outRoot, 'table.md')}`)
