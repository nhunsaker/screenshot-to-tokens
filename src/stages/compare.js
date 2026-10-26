// Compare runs side by side (e.g. mock vs SAM 3.1, heuristic vs Muse Spark): providers, eval, segeval,
// verify, model usage. Reads only what each run folder has; missing pieces print as "-".
import { readFileSync, existsSync } from 'fs'
import { join, basename } from 'path'

const rd = (dir, n) => { try { return JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf-8')) } catch (e) { return null } }
const pct = (v, d = 0) => (v == null ? '-' : `${(v * 100).toFixed(d)}%`)

/** Summarize one run folder into flat rows. Pure apart from reads; exported for tests. */
export function summarizeRun(dir) {
  const run = rd(dir, 'run'), tokens = rd(dir, 'tokens'), regions = rd(dir, 'regions')
  const ev = rd(dir, 'eval'), seg = rd(dir, 'segeval'), ver = rd(dir, 'verify'), usage = rd(dir, 'usage')
  const tiers = {}
  for (const t of tokens?.tokens || []) tiers[t.tier] = (tiers[t.tier] || 0) + 1
  const tok = (usage || []).reduce((a, u) => ({ in: a.in + (u.usage?.prompt_tokens || 0), out: a.out + (u.usage?.completion_tokens || 0) }), { in: 0, out: 0 })
  return {
    run: basename(dir),
    // Hybrid runs mix sources, so show the share per source (e.g. "sam3.1 14 · layout 2 · mock-dom 96").
    segmenter: regions && regions.length
      ? Object.entries(regions.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')
      : run?.providers?.segmenter || '-',
    namer: tokens?.namer || '-',
    regions: regions ? String(regions.length) : '-',
    tokens: tokens ? `${tokens.tokens.length} (${tiers.primitive || 0}/${tiers.semantic || 0}/${tiers.component || 0})` : '-',
    repairs: tokens ? String((tokens.warnings || []).length) : '-',
    merges: tokens ? String((tokens.merges || []).length) : '-',
    eval: ev ? `${ev.passed}/${ev.total}` : '-',
    'eval semantic': ev?.byGroup?.semantic ? `${ev.byGroup.semantic.pass}/${ev.byGroup.semantic.total}` : '-',
    'segeval any': seg ? pct(seg.anyLabel?.recall) : '-',
    'segeval button': seg?.perLabel?.button ? pct(seg.perLabel.button.recall) : '-',
    'go/no-go': seg?.verdict ? (seg.verdict.go ? 'GO' : 'NO-GO') : '-',
    'verify fallback': ver?.fallback ? `${ver.fallback.diffPixels} px` : '-',
    'verify colors': ver?.colors ? pct(ver.colors.ratio, 3) : '-',
    'verify all': ver ? pct(ver.ratio, 3) : '-',
    'model tokens in/out': usage ? `${tok.in}/${tok.out}` : '-',
  }
}

export function formatCompare(rows) {
  const keys = Object.keys(rows[0])
  const w0 = Math.max(...keys.map((k) => k.length))
  const ws = rows.map((r) => Math.max(...keys.map((k) => String(r[k]).length)))
  return keys.map((k) => `${k.padEnd(w0)}  ${rows.map((r, i) => String(r[k]).padEnd(ws[i])).join('  ')}`).join('\n')
}

export function compareRuns(dirs) {
  const missing = dirs.filter((d) => !existsSync(d))
  if (missing.length) throw new Error(`no run folder: ${missing.join(', ')}`)
  return formatCompare(dirs.map(summarizeRun))
}
