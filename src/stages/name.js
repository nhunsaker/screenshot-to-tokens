// Name: clusters → TokenSet via the configured namer, then validate and repair.
// The model proposes; this file guarantees the shape (every cluster covered, aliases resolve).
import heuristicNamer, { heuristicTokens } from '../providers/llm/heuristic.js'
import llmNamer from '../providers/llm/llm-namer.js'

const NAME_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/
const TIERS = new Set(['primitive', 'semantic', 'component'])

/**
 * Repair a proposed TokenSet against the clusters. Never throws; returns warnings.
 * @param {import('../types.js').TokenSet} set
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {import('../types.js').TokenSet}
 */
export function validateTokenSet(set, clusters, components = null) {
  const warnings = [...(set.warnings || [])]
  const byId = new Map(clusters.map((c) => [c.id, c]))
  const seen = new Set()
  /** @type {import('../types.js').TokenProposal[]} */
  const kept = []
  for (const raw of set.tokens || []) {
    const t = { ...raw, name: String(raw.name || '').trim().toLowerCase().replace(/\s+/g, '-') }
    if (!NAME_RE.test(t.name)) { warnings.push(`dropped bad name "${raw.name}"`); continue }
    if (seen.has(t.name)) { warnings.push(`dropped duplicate ${t.name}`); continue }
    if (!TIERS.has(t.tier)) { warnings.push(`${t.name}: unknown tier "${t.tier}", set to semantic`); t.tier = t.value ? 'primitive' : 'semantic' }
    t.clusters = (Array.isArray(t.clusters) ? t.clusters : []).filter((id) => byId.has(id))
    if (!t.clusters.length) { warnings.push(`dropped ${t.name}: no known cluster`); continue }
    if (t.tier === 'primitive') {
      const c = byId.get(t.clusters[0])
      if (t.value !== c.value) { if (t.value) warnings.push(`${t.name}: value reset to cluster value`); t.value = c.value }
      delete t.alias
    } else {
      delete t.value
    }
    if (typeof t.why !== 'string' || !t.why.trim()) t.why = ''
    seen.add(t.name)
    kept.push(t)
  }
  // Every cluster gets exactly one primitive; fill gaps from the heuristic draft.
  const covered = new Set(kept.filter((t) => t.tier === 'primitive').flatMap((t) => t.clusters))
  const missing = clusters.filter((c) => !covered.has(c.id))
  if (missing.length) {
    const draft = heuristicTokens({ clusters, components })
    for (const c of missing) {
      const d = draft.tokens.find((t) => t.tier === 'primitive' && t.clusters[0] === c.id)
      let name = d.name, i = 2
      while (seen.has(name)) name = `${d.name}-${i++}`
      seen.add(name)
      kept.push({ ...d, name })
      warnings.push(`added primitive ${name} for uncovered ${c.id}`)
    }
  }
  // Aliases must resolve, and must not form cycles.
  const names = new Set(kept.map((t) => t.name))
  // A primitive can cover several clusters once a merge is accepted; map every one of them.
  const primOf = new Map(kept.filter((t) => t.tier === 'primitive').flatMap((t) => t.clusters.map((id) => [id, t.name])))
  for (const t of kept) {
    if (t.tier === 'primitive') continue
    if (!t.alias || !names.has(t.alias) || t.alias === t.name) {
      const fallback = primOf.get(t.clusters[0])
      warnings.push(`${t.name}: alias "${t.alias}" unresolved, pointed at ${fallback}`)
      t.alias = fallback
    }
  }
  const byName = new Map(kept.map((t) => [t.name, t]))
  for (const t of kept) {
    const path = new Set()
    let cur = t
    while (cur && cur.alias) {
      if (path.has(cur.name)) { warnings.push(`${t.name}: alias cycle, pointed at primitive`); t.alias = primOf.get(t.clusters[0]); break }
      path.add(cur.name)
      cur = byName.get(cur.alias)
    }
  }
  // Component tokens (third tier) may only cover values their component actually uses. A component token whose
  // name starts with a profiled component (e.g. button.*) but cites a cluster that component never uses is dropped.
  // A fourth-tier state token (<component>.<state>.<role>, e.g. nav.active.bg) is checked even more strictly:
  // against only the clusters that *state's own* roots use (profile.states[state]), never the component's
  // overall usage — an inactive nav-link's blue never backs an active-pill token into existence, and vice versa.
  if (components && components.length) {
    const used = new Map(components.map((p) => [p.component, new Set(Object.values(p.props).flat().map((x) => x.cluster))]))
    const stateUsed = new Map()
    for (const p of components) {
      for (const [state, info] of Object.entries(p.states || {})) {
        stateUsed.set(`${p.component}.${state}`, new Set(Object.values(info.props).flat().map((x) => x.cluster)))
      }
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      const t = kept[i]
      if (t.tier !== 'component') continue
      const parts = t.name.split('.')
      const comp = parts[0]
      if (parts.length >= 3 && stateUsed.has(`${comp}.${parts[1]}`)) {
        const set = stateUsed.get(`${comp}.${parts[1]}`)
        if (!t.clusters.every((id) => set.has(id))) { warnings.push(`dropped ${t.name}: ${comp}.${parts[1]} never uses ${t.clusters.filter((id) => !set.has(id)).join(', ')}`); kept.splice(i, 1) }
        continue
      }
      // A 3+-segment name that doesn't match any profiled state (typo, or model invented one) has no usage
      // data to check against at all — never trust it.
      if (parts.length >= 3) { warnings.push(`dropped ${t.name}: no profiled state ${comp}.${parts[1]}`); kept.splice(i, 1); continue }
      const set = used.get(comp)
      if (set && !t.clusters.every((id) => set.has(id))) { warnings.push(`dropped ${t.name}: ${comp} never uses ${t.clusters.filter((id) => !set.has(id)).join(', ')}`); kept.splice(i, 1) }
    }
  }
  // Merge suggestions are proposals only (a person accepts them in review). Keep the well-formed ones.
  const merges = []
  for (const m of Array.isArray(set.merges) ? set.merges : []) {
    const a = byId.get(m?.from), b = byId.get(m?.into)
    if (!a || !b || a === b || a.kind !== b.kind) { warnings.push(`dropped merge suggestion ${m?.from} → ${m?.into}`); continue }
    if (merges.some((x) => x.from === m.from)) continue
    merges.push({ from: m.from, into: m.into, why: typeof m.why === 'string' ? m.why : '' })
  }
  return { ...set, tokens: kept, merges, warnings }
}

/** Resolve a token to its literal by following aliases. */
export function resolveValue(name, tokens) {
  const byName = new Map(tokens.map((t) => [t.name, t]))
  let cur = byName.get(name)
  for (let i = 0; cur && i < 10; i++) {
    if (cur.value) return cur.value
    cur = byName.get(cur.alias)
  }
  return null
}

export function namerFor(id) {
  if (id === 'mock') return heuristicNamer()
  return llmNamer(/** @type {any} */ (id))
}

/**
 * Run the namer; on any provider error fall back to the heuristic so the pipeline still completes.
 * @param {{clusters:any[], regions:any[], screenshotPath?:string, namer:string, strict?:boolean}} o
 */
export async function runName(o) {
  const provider = namerFor(o.namer)
  let set
  try {
    set = await provider.name(o)
  } catch (e) {
    if (o.strict) throw e
    set = { ...heuristicTokens(o), warnings: [`namer "${provider.id}" failed, used heuristic: ${e.message}`] }
  }
  return validateTokenSet(set, o.clusters, o.components)
}
