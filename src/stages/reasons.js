// Reasons: ground a token's `why` against the cluster data it's supposed to describe, and flag
// merges that quietly paper over a role conflict. Pure, deterministic, no network, no model calls.
// Built for F5 "Named & why spec cards" — the council gate required both checks below (see
// BRAINSTORM.md, "2. Named & Why Spec Cards: veto risk LOW").
import { propRole } from '../lib/props.js'

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const topEntries = (obj, n = 3) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n)

/** "#abc" / "#abcd" / "#aabbcc" / "#aabbccdd" → lowercase 8-char "rrggbbaa", or null. */
export function normalizeHex(v) {
  if (v == null) return null
  let h = String(v).trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]{3,8}$/.test(h)) return null
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length === 6) h += 'ff'
  return h.length === 8 ? h : null
}

/** Sum every cluster a token references into one usage bag the grounding/templating checks share. */
function aggregate(token, clusters) {
  const byId = new Map((clusters || []).map((c) => [c.id, c]))
  const covered = (token && token.clusters || []).map((id) => byId.get(id)).filter(Boolean)
  const props = {}, regionLabels = {}
  const memberValues = new Set()
  const counts = new Set()
  let count = 0
  for (const c of covered) {
    count += c.count || 0
    counts.add(c.count)
    for (const [p, n] of Object.entries(c.props || {})) { props[p] = (props[p] || 0) + n; counts.add(n) }
    for (const [l, n] of Object.entries(c.regionLabels || {})) { regionLabels[l] = (regionLabels[l] || 0) + n; counts.add(n) }
    for (const m of c.members || []) {
      memberValues.add(m.value)
      counts.add(m.count)
      const n = parseFloat(m.value) // bare numeric values (font-weight "600", a scale step, …) are
      if (!Number.isNaN(n)) counts.add(n) // legitimate claims too, not just usage counts.
    }
    memberValues.add(c.value)
    const vn = parseFloat(c.value)
    if (!Number.isNaN(vn)) counts.add(vn)
  }
  return { covered, count, props, regionLabels, memberValues, counts }
}

// ---------------------------------------------------------------------------
// claim extraction
// ---------------------------------------------------------------------------

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
const PX_RE = /-?\d+(?:\.\d+)?\s*px\b/gi

/** Phrase → OR-set of canonical cluster prop keys it could refer to (any one present grounds it).
 * Order matters: multi-word phrases are checked (and masked out) before the single words they
 * contain, so "text color" doesn't also leave a stray "text" for the region-word scan, or a
 * stray "color" that would wrongly demand a background-color use too. */
const PROP_PHRASES = [
  ['text color', ['color']],
  ['font color', ['color']],
  ['background color', ['background-color']],
  ['background', ['background-color']],
  ['border color', ['border-top-color', 'border-color']],
  ['border', ['border-top-color', 'border-color']],
  ['outline', ['outline-color']],
  ['fill', ['fill']],
  ['stroke', ['stroke']],
  ['box shadow', ['box-shadow']],
  ['shadow', ['box-shadow']],
  ['corner radius', ['border-top-left-radius', 'border-radius']],
  ['radius', ['border-top-left-radius', 'border-radius']],
  ['padding', ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding']],
  ['margin', ['margin-top', 'margin-bottom', 'margin']],
  ['gap', ['row-gap', 'column-gap', 'gap']],
  ['font size', ['font-size']],
  ['font weight', ['font-weight']],
  ['font family', ['font-family']],
  ['line height', ['line-height']],
  ['color', ['color', 'background-color']],
]

// Region labels a `why` can plausibly claim. "text" is deliberately excluded: in real namer
// output it's overwhelmingly used as the English role word ("danger text", "warning text" —
// meaning "used as text color"), not the oracle's literal "text" region label, and treating it
// as a region claim produced a wall of false unsupported-claims on real runs.
export const REGION_WORDS = ['button', 'link', 'input', 'card', 'nav', 'header', 'footer', 'image', 'badge', 'other']

// Exact *hyphenated* computed-style prop names (see lib/props.js STYLE_PROPS), so a compound like
// "border-top-color" is consumed whole before the loose English-phrase heuristics below ever see
// the bare word "color" sitting inside it. Single-word names (color, fill, stroke) are deliberately
// left to the PROP_PHRASES pass below, so a multi-word phrase like "border color" still gets a
// chance to match before a bare "color" inside it is claimed first.
const LITERAL_PROPS = [
  'border-top-left-radius', 'border-top-color', 'background-color', 'outline-color',
  'padding-right', 'padding-bottom', 'padding-left', 'padding-top',
  'margin-bottom', 'margin-top', 'row-gap', 'column-gap',
  'font-weight', 'font-family', 'font-size', 'line-height', 'box-shadow',
  'border-color', 'border-radius',
]

const blank = (text, needle) => text.split(needle).join(' '.repeat(needle.length))

/**
 * Pull out every checkable claim a `why` sentence makes: hex colors, px values, bare numbers
 * (usage counts), and recognized prop/region vocabulary words. `props` is a list of OR-groups —
 * a claim like "background" is grounded if ANY of its group's keys has usage.
 * @param {string} why
 * @returns {{hex:string[], px:number[], numbers:number[], props:string[][], regions:string[]}}
 */
export function extractClaims(why) {
  const s = String(why || '')
  let masked = s.toLowerCase()

  const hex = [...s.matchAll(HEX_RE)].map((m) => m[0])
  const pxMatches = [...s.matchAll(PX_RE)]
  const px = pxMatches.map((m) => parseFloat(m[0]))
  for (const h of hex) masked = blank(masked, h.toLowerCase())
  for (const m of pxMatches) masked = blank(masked, m[0].toLowerCase())

  const numbers = [...masked.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]))

  const props = []
  // Pass 1: exact prop names verbatim ("border-top-color"), consumed whole.
  for (const prop of LITERAL_PROPS) {
    const re = new RegExp(`\\b${prop}\\b`, 'g')
    let found = false
    masked = masked.replace(re, (m) => { found = true; return ' '.repeat(m.length) })
    if (found) props.push([prop])
  }
  // Pass 2: loose English phrases ("text color", "background"). Each match is blanked as it's
  // found so a later, shorter phrase (or the region-word scan) never re-reads the same words —
  // "text color" is consumed whole, not left behind as a stray "text".
  for (const [phrase, keys] of PROP_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'g')
    let found = false
    masked = masked.replace(re, (m) => { found = true; return ' '.repeat(m.length) })
    if (found) props.push(keys)
  }

  const regions = REGION_WORDS.filter((w) => new RegExp(`\\b${w}s?\\b`).test(masked))

  return { hex, px, numbers, props, regions }
}

// ---------------------------------------------------------------------------
// 1. deterministic grounding check (council condition: Hashimoto/TechLead)
// ---------------------------------------------------------------------------

/**
 * Check every claim a token's `why` makes against the usage data of the clusters it covers.
 * Pure; never throws.
 * @param {import('../types.js').TokenProposal} token
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {{grounded: boolean, unsupported: string[]}}
 */
export function checkGrounding(token, clusters) {
  const why = String((token && token.why) || '').trim()
  if (!why) return { grounded: false, unsupported: ['no reason given'] }

  const { covered, props, regionLabels, memberValues, counts } = aggregate(token, clusters)
  if (!covered.length) return { grounded: false, unsupported: ["references no known cluster"] }

  const claims = extractClaims(why)
  const unsupported = []

  for (const hex of claims.hex) {
    const norm = normalizeHex(hex)
    const ok = norm && [...memberValues].some((v) => { const n = normalizeHex(v); return n && n.slice(0, 6) === norm.slice(0, 6) })
    if (!ok) unsupported.push(`hex ${hex} not found in this token's cluster values`)
  }
  for (const px of claims.px) {
    const ok = [...memberValues].some((v) => { const n = parseFloat(v); return !Number.isNaN(n) && Math.abs(n - px) < 0.5 })
    if (!ok) unsupported.push(`${px}px not found in this token's cluster values`)
  }
  for (const n of claims.numbers) {
    if (!counts.has(n)) unsupported.push(`count ${n} not found in this token's usage data`)
  }
  for (const group of claims.props) {
    if (!group.some((p) => props[p])) unsupported.push(`prop "${group[0]}" not used by this token's clusters`)
  }
  for (const r of claims.regions) {
    if (!regionLabels[r]) unsupported.push(`region "${r}" not used by this token's clusters`)
  }

  return { grounded: unsupported.length === 0, unsupported }
}

// ---------------------------------------------------------------------------
// plain templated reason — the fallback shown when `why` isn't grounded
// ---------------------------------------------------------------------------

const PROP_LABEL = {
  color: 'text color', 'background-color': 'background color', background: 'background color',
  'border-top-color': 'border color', 'border-color': 'border color', border: 'border color',
  'outline-color': 'outline color', outline: 'outline color', fill: 'fill color', stroke: 'stroke color',
  'box-shadow': 'shadow', 'border-top-left-radius': 'corner radius', 'border-radius': 'corner radius',
  'padding-top': 'padding', 'padding-right': 'padding', 'padding-bottom': 'padding', 'padding-left': 'padding',
  'margin-top': 'margin', 'margin-bottom': 'margin', 'row-gap': 'gap', 'column-gap': 'gap',
  'font-size': 'font size', 'font-weight': 'font weight', 'font-family': 'font family', 'line-height': 'line height',
}

const plural = (label) => (label.endsWith('s') ? label : label + 's')

const joinWithAnd = (list) => {
  if (list.length <= 1) return list.join('')
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** One or more "merges X and Y" clauses, one per covered cluster that has drifted members. */
function describeMerges(covered) {
  const clauses = []
  for (const c of covered) {
    const members = c.members || []
    if (members.length <= 1) continue
    clauses.push(`merges ${joinWithAnd(members.map((m) => m.value))}`)
  }
  return clauses.join('; ')
}

/**
 * Build a plain, cluster-grounded sentence with no model involved — the fallback shown whenever
 * the model's `why` fails the grounding check.
 * @param {import('../types.js').TokenProposal} token
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {string}
 */
export function templatedReason(token, clusters) {
  const { covered, count, props, regionLabels } = aggregate(token, clusters)
  if (!covered.length) return 'No usage data available for this token.'
  const topProp = topEntries(props, 1)[0]
  const propLabel = topProp ? (PROP_LABEL[topProp[0]] || topProp[0]) : 'value'
  const topRegions = topEntries(regionLabels, 3).map(([k]) => plural(k))
  const regionsText = topRegions.length ? ` in ${joinWithAnd(topRegions)}` : ''
  const merges = describeMerges(covered)
  return `Used ${count} time${count === 1 ? '' : 's'} as ${propLabel}${regionsText}${merges ? `; ${merges}` : ''}.`
}

// ---------------------------------------------------------------------------
// 2. "roles differ" abstain flag (council condition: Frost/Creative-UX)
// ---------------------------------------------------------------------------

/** bg / text / border use counts for one cluster, from its props. */
function roleCounts(cluster) {
  const counts = { bg: 0, text: 0, border: 0 }
  for (const [prop, n] of Object.entries(cluster.props || {})) {
    const r = propRole(prop)
    if (r && counts[r] !== undefined) counts[r] += n
  }
  return counts
}

const SIGNIFICANT_SHARE = 0.2
const SIGNIFICANT_MIN = 2

/** Role families a cluster is used in meaningfully (not just a stray one-off use). */
function significantRoles(cluster) {
  const counts = roleCounts(cluster)
  const total = counts.bg + counts.text + counts.border
  if (!total) return new Set()
  return new Set(Object.entries(counts)
    .filter(([, n]) => n >= SIGNIFICANT_MIN && n / total >= SIGNIFICANT_SHARE)
    .map(([role]) => role))
}

function dominantRole(cluster) {
  const counts = roleCounts(cluster)
  const [role, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return n > 0 ? role : null
}

function dominantRegionLabel(cluster) {
  const entries = Object.entries(cluster.regionLabels || {})
  if (!entries.length) return null
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}

function shareRegionLabel(a, b) {
  const bKeys = new Set(Object.keys(b.regionLabels || {}))
  return Object.keys(a.regionLabels || {}).some((k) => bKeys.has(k))
}

/**
 * True when a token presents a merge as settled that isn't: either one of its clusters is used
 * meaningfully in more than one role family (e.g. background AND text), or — for a token covering
 * several clusters — those clusters have conflicting dominant roles or disjoint region labels.
 * @param {import('../types.js').TokenProposal} token
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {boolean}
 */
export function rolesDiffer(token, clusters) {
  const byId = new Map((clusters || []).map((c) => [c.id, c]))
  const covered = (token && token.clusters || []).map((id) => byId.get(id)).filter(Boolean)
  if (!covered.length) return false

  for (const c of covered) if (significantRoles(c).size > 1) return true

  if (covered.length > 1) {
    const roles = covered.map(dominantRole).filter(Boolean)
    if (new Set(roles).size > 1) return true

    const regionLabels = covered.map(dominantRegionLabel).filter(Boolean)
    if (new Set(regionLabels).size > 1) {
      let overlap = false
      for (let i = 0; i < covered.length && !overlap; i++) {
        for (let j = i + 1; j < covered.length; j++) {
          if (shareRegionLabel(covered[i], covered[j])) { overlap = true; break }
        }
      }
      if (!overlap) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// public API: one call per token for the report to render
// ---------------------------------------------------------------------------

/**
 * Evaluate a single token's reason card: grounding, the text to show (model `why` if grounded,
 * else the plain templated fallback), and the roles-differ abstain flag.
 * @param {import('../types.js').TokenProposal} token
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {{text: string, grounded: boolean, unverified: boolean, unsupported: string[], rolesDiffer: boolean}}
 */
export function evaluateReason(token, clusters) {
  const { grounded, unsupported } = checkGrounding(token, clusters)
  const why = String((token && token.why) || '').trim()
  const text = grounded && why ? why : templatedReason(token, clusters)
  return { text, grounded, unverified: !grounded, unsupported, rolesDiffer: rolesDiffer(token, clusters) }
}
