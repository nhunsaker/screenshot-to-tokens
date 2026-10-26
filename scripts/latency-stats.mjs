#!/usr/bin/env node
// F19 statistics: summarize timing.json across repeated runs into median (p50) and p90 per stage, plus cost.
//   node scripts/latency-stats.mjs out/lat-argon-* out/lat-agency-* ...   (prints a markdown table)
// Runs are grouped by name with the trailing "-<n>" removed (out/lat-argon-3 → lat-argon).
import { readFileSync, existsSync } from 'fs'
import { join, basename } from 'path'

const pct = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}

const groups = {}
for (const dir of process.argv.slice(2)) {
  const f = join(dir, 'timing.json')
  if (!existsSync(f)) continue
  const t = JSON.parse(readFileSync(f, 'utf-8'))
  const g = basename(dir).replace(/-\d+$/, '')
  ;(groups[g] ||= []).push(t)
}

const STAGES = ['capture', 'segment', 'name', 'verify']
const lines = ['| Page | Runs | Total p50 | Total p90 | ' + STAGES.map((s) => `${s} p50 / p90`).join(' | ') + ' | Cost p50 |', '|---|---|---|---|' + STAGES.map(() => '---|').join('') + '---|']
for (const [g, runs] of Object.entries(groups)) {
  const total = runs.map((r) => r.totalMs / 1000)
  const cost = runs.map((r) => r.stages.reduce((n, s) => n + (s.usd || 0), 0))
  const cells = STAGES.map((st) => {
    const xs = runs.map((r) => (r.stages.find((s) => s.stage === st) || { ms: 0 }).ms / 1000)
    return `${pct(xs, 50).toFixed(1)} / ${pct(xs, 90).toFixed(1)} s`
  })
  lines.push(`| ${g.replace(/^lat-/, '')} | ${runs.length} | ${pct(total, 50).toFixed(1)} s | ${pct(total, 90).toFixed(1)} s | ${cells.join(' | ')} | $${pct(cost, 50).toFixed(3)} |`)
}
console.log(lines.join('\n'))
