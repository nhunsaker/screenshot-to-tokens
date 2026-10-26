// Eval: score a run against a hand-written golden file, so a provider swap is measured, not eyeballed.
//
// golden.json shape (per fixture, written by a person):
// {
//   "same":      [["#1a73e8", "#1b74e9"], {"kind": "radius", "values": ["4px", "5px"]}],  // must land in one cluster
//   "different": [["#222", "#333"]],                                           // must land in different clusters
//   "semantic":  [{ "value": "#1a73e8", "kind": "color", "name": "color.action.primary", "accept": ["color.action", "color.brand"] }],
//   "regions":   [{ "label": "button", "min": 4 }]                             // segmentation floor per label
// }
import { normalizeFor } from '../lib/props.js'

const clusterOf = (clusters, kind, raw) => {
  const v = normalizeFor(kind, raw)
  return clusters.find((c) => c.kind === kind && c.members.some((m) => m.value === v)) || null
}
const kindOfRaw = (raw) => (/^(#|rgb|hsl)/i.test(String(raw).trim()) ? 'color' : null)

/**
 * @param {{clusters:any[], tokens:{tokens:any[]}, regions:any[]}} run
 * @param {any} golden
 */
export function scoreRun(run, golden, kindHint = {}) {
  const checks = []
  const primByCluster = new Map()
  for (const t of run.tokens?.tokens || []) if (t.tier === 'primitive') for (const id of t.clusters) primByCluster.set(id, t.name)
  const primOf = (id) => primByCluster.get(id) || id
  const add = (group, name, pass, detail = '') => checks.push({ group, name, pass, detail })

  for (const g of golden.same || []) {
    // A group is ["#1a73e8", ...] (colors) or { "kind": "space", "values": ["8px", "9px"] }.
    const group = Array.isArray(g) ? g : g.values
    const kind = (!Array.isArray(g) && g.kind) || kindHint[group[0]] || kindOfRaw(group[0]) || 'radius'
    // Same = lands on the same primitive token (so an accepted merge counts), else the same cluster.
    const ids = group.map((raw) => { const c = clusterOf(run.clusters, kind, raw); return c ? primOf(c.id) : null })
    const pass = ids.every((id) => id && id === ids[0])
    add('merge', `same: ${group.join(' = ')}`, pass, ids.join(', '))
  }
  for (const d of golden.different || []) {
    const [a, b] = Array.isArray(d) ? d : d.values
    const kind = (!Array.isArray(d) && d.kind) || kindHint[a] || kindOfRaw(a) || 'radius'
    const ca = clusterOf(run.clusters, kind, a), cb = clusterOf(run.clusters, kind, b)
    const pa = ca && primOf(ca.id), pb = cb && primOf(cb.id)
    add('merge', `different: ${a} ≠ ${b}`, !!(pa && pb && pa !== pb), `${pa} vs ${pb}`)
  }
  const tokens = run.tokens?.tokens || []
  for (const s of golden.semantic || []) {
    const c = clusterOf(run.clusters, s.kind, s.value)
    if (!c) { add('semantic', s.name, false, `value ${s.value} not captured`); continue }
    const names = tokens.filter((t) => t.tier !== 'primitive' && t.clusters.includes(c.id)).map((t) => t.name)
    const accept = [s.name, ...(s.accept || [])]
    const exact = names.includes(s.name)
    const close = names.some((n) => accept.some((p) => n.startsWith(p)))
    add('semantic', s.name, exact || close, names.join(', ') || 'no semantic token on this cluster')
  }
  for (const r of golden.regions || []) {
    const n = (run.regions || []).filter((x) => x.label === r.label).length
    add('segment', `${r.label} ≥ ${r.min}`, n >= r.min, `${n} found`)
  }
  const prims = new Set(tokens.filter((t) => t.tier === 'primitive').flatMap((t) => t.clusters))
  add('shape', 'every cluster has a primitive', run.clusters.every((c) => prims.has(c.id)))
  add('shape', 'no validator repairs', !(run.tokens?.warnings || []).length, (run.tokens?.warnings || []).slice(0, 3).join('; '))

  const by = {}
  for (const c of checks) {
    by[c.group] ||= { pass: 0, total: 0 }
    by[c.group].total++
    if (c.pass) by[c.group].pass++
  }
  const passed = checks.filter((c) => c.pass).length
  return { score: checks.length ? passed / checks.length : 0, passed, total: checks.length, byGroup: by, checks }
}

export function formatScore(s, label = '') {
  const lines = [`eval ${label}: ${s.passed}/${s.total} (${(s.score * 100).toFixed(0)}%)`]
  for (const [g, v] of Object.entries(s.byGroup)) lines.push(`  ${g.padEnd(9)} ${v.pass}/${v.total}`)
  for (const c of s.checks.filter((c) => !c.pass)) lines.push(`  ✗ ${c.group}: ${c.name}  (${c.detail})`)
  return lines.join('\n')
}
