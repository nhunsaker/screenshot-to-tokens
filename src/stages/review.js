// Review: a person accepts, renames or rejects proposed tokens; we apply the decisions and re-emit.
// The report page exports decisions as JSON (review.json); `s2t review --run <dir>` applies them.
//
// review.json: { "decisions": [
//   { "name": "color.blue.500", "action": "accept" },
//   { "name": "color.text.muted", "action": "rename", "to": "color.text.subtle" },
//   { "name": "card.shadow", "action": "reject" },
//   { "action": "merge", "from": "radius-02", "into": "radius-01" } ] }
// Rejecting a primitive keeps it (every cluster needs one) but marks it rejected so rewrite skips it.
import { validateTokenSet } from './name.js'

/**
 * @param {import('../types.js').TokenSet} set
 * @param {{decisions:{name:string, action:'accept'|'rename'|'reject', to?:string}[]}} review
 * @param {import('../types.js').Cluster[]} clusters
 */
export function applyReview(set, review, clusters) {
  const notes = []
  let tokens = set.tokens.map((t) => ({ ...t }))
  const rename = new Map()
  for (const d of review.decisions || []) {
    if (d.action === 'merge') continue
    const t = tokens.find((x) => x.name === d.name)
    if (!t) { notes.push(`no token ${d.name}`); continue }
    if (d.action === 'accept') t.review = 'accepted'
    else if (d.action === 'rename' && d.to) {
      if (tokens.some((x) => x.name === d.to)) { notes.push(`rename ${d.name} → ${d.to}: name taken`); continue }
      rename.set(t.name, d.to)
      t.name = d.to
      t.review = 'renamed'
    } else if (d.action === 'reject') t.review = 'rejected'
    else notes.push(`unknown action ${d.action} for ${d.name}`)
  }
  // Accepted merge suggestions: { "action": "merge", "from": "radius-02", "into": "radius-01" }.
  // The surviving primitive takes over the absorbed cluster; the absorbed primitive is dropped and
  // anything that aliased it is re-pointed at the survivor. Its literals then rewrite to the survivor.
  const merged = []
  for (const d of review.decisions || []) {
    if (d.action !== 'merge') continue
    const intoPrim = tokens.find((t) => t.tier === 'primitive' && t.clusters.includes(d.into))
    const fromPrim = tokens.find((t) => t.tier === 'primitive' && t.clusters.includes(d.from))
    if (!intoPrim || !fromPrim || intoPrim === fromPrim) { notes.push(`merge ${d.from} → ${d.into}: no such clusters`); continue }
    intoPrim.clusters = [...intoPrim.clusters, ...fromPrim.clusters.filter((id) => !intoPrim.clusters.includes(id))]
    intoPrim.why = `${intoPrim.why} Absorbs ${fromPrim.value} (accepted merge).`.trim()
    intoPrim.review = intoPrim.review || 'accepted'
    tokens = tokens.filter((t) => t !== fromPrim)
    for (const t of tokens) {
      if (t.alias === fromPrim.name) t.alias = intoPrim.name
      if (t.tier !== 'primitive') t.clusters = t.clusters.map((id) => (id === d.from ? d.into : id))
    }
    merged.push(d.from)
  }
  const remainingMerges = (set.merges || []).filter((m) => !merged.includes(m.from))
  // Follow renames in aliases.
  for (const t of tokens) if (t.alias && rename.has(t.alias)) t.alias = rename.get(t.alias)
  // Drop rejected non-primitives; re-point anything that aliased them at their primitive.
  const dropped = new Set(tokens.filter((t) => t.review === 'rejected' && t.tier !== 'primitive').map((t) => t.name))
  tokens = tokens.filter((t) => !dropped.has(t.name))
  for (const t of tokens) if (t.alias && dropped.has(t.alias)) t.alias = undefined
  const out = validateTokenSet({ ...set, tokens, merges: remainingMerges, warnings: [] }, clusters)
  const reviewed = out.tokens.filter((t) => t.review).length
  return { ...out, reviewed: { at: new Date().toISOString(), decisions: (review.decisions || []).length, reviewed, merged, notes } }
}

/** Tokens the rewrite may use: everything except rejected ones. */
export const usableTokens = (set) => ({ ...set, tokens: set.tokens.filter((t) => t.review !== 'rejected') })
