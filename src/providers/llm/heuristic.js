// Offline namer: deterministic primitive / semantic / component names from cluster usage.
// Two jobs: (1) the mock provider until Muse Spark access lands, (2) the draft we hand the
// model, so even a small local Llama only has to refine names and reasons, not invent structure.
import { normalizeColor } from '@sorb/seed'
import { hexToRgba, rgbToLab, suggestMerges } from '../../stages/cluster.js'
import { pairsFromCapture } from '../../preview-client/contrast.js'

const FAMILIES = [
  [15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [200, 'teal'], [255, 'blue'], [290, 'purple'], [345, 'pink'], [361, 'red'],
]

/** Hue family + lightness step (50..950) for a hex color. */
export function colorPrimitiveName(hex) {
  const base = colorBaseName(hex)
  // Translucent colors get an alpha suffix so a 10% black tint is never mistaken for solid black.
  const { a } = hexToRgba(hex)
  return a < 0.995 ? `${base}-a${Math.round(a * 100)}` : base
}

function colorBaseName(hex) {
  const { r, g, b } = hexToRgba(hex)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  // Perceptual chroma (Lab), not RGB saturation: light tints like #dbe6fb are clearly blue to a person
  // but have tiny RGB saturation.
  const lab = rgbToLab({ r, g, b })
  const chroma = Math.hypot(lab.a, lab.b)
  let family = 'gray'
  // Near-white tints read as colored at lower chroma (#eef3fc is blue at 4.9; cool gray #6c757d is 5.8).
  if (chroma > 6 || (lab.L > 92 && chroma > 3.5)) {
    let h
    const d = max - min
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
    family = FAMILIES.find(([lim]) => h < lim)[1]
  }
  const L = lab.L
  if (L >= 99) return 'color.white'
  if (L <= 1) return 'color.black'
  const step = Math.min(950, Math.max(50, Math.round((100 - L) / 10) * 100 || 50))
  return `color.${family}.${step}`
}

const WEIGHT = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' }
const SIZES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']

/** Name each cluster's primitive. Returns Map clusterId → name (unique). */
export function primitiveNames(clusters) {
  const names = new Map()
  const used = new Set()
  const uniq = (n) => { let x = n, i = 2; while (used.has(x)) x = `${n}-${i++}`; used.add(x); return x }
  const byKind = (k) => clusters.filter((c) => c.kind === k)
  for (const c of byKind('color')) names.set(c.id, uniq(colorPrimitiveName(c.value)))
  // Negative spacing (e.g. margin: -96px) needs a valid name segment: space.neg-96, not space.-96.
  const spaceName = (v) => { const n = parseFloat(v); return `space.${n < 0 ? 'neg-' : ''}${String(Math.abs(n)).replace('.', '-')}` }
  byKind('space').forEach((c) => names.set(c.id, uniq(spaceName(c.value))))
  const radii = byKind('radius')
  radii.forEach((c, i) => names.set(c.id, uniq(parseFloat(c.value) >= 999 ? 'radius.full' : `radius.${SIZES[Math.min(i + 1, SIZES.length - 1)]}`)))
  byKind('font-size').forEach((c, i) => names.set(c.id, uniq(`font.size.${SIZES[Math.min(i, SIZES.length - 1)]}`)))
  byKind('line-height').forEach((c, i) => names.set(c.id, uniq(`font.line-height.${i + 1}`)))
  byKind('font-weight').forEach((c) => names.set(c.id, uniq(`font.weight.${WEIGHT[c.value] || c.value}`)))
  byKind('font-family').forEach((c, i) => names.set(c.id, uniq(i === 0 ? 'font.family.base' : `font.family.alt-${i}`)))
  byKind('shadow').forEach((c, i) => names.set(c.id, uniq(`shadow.${i + 1}`)))
  return names
}

/** Cluster with the most uses matching a predicate, or null. */
const top = (clusters, kind, score) => {
  let best = null, bestScore = 0
  for (const c of clusters) {
    if (c.kind !== kind) continue
    const s = score(c)
    if (s > bestScore) { best = c; bestScore = s }
  }
  return best
}
const L = (c) => rgbToLab(hexToRgba(c.value)).L

/**
 * @param {{clusters: import('../../types.js').Cluster[]}} input
 * @returns {import('../../types.js').TokenSet}
 */
/** Property → short role used in component token names (button.bg, card.shadow). Spacing is left to primitives. */
export const COMPONENT_PROP = {
  'background-color': 'bg', 'color': 'text', 'fill': 'icon',
  'border-top-color': 'border', 'border-right-color': 'border', 'border-bottom-color': 'border', 'border-left-color': 'border',
  'border-top-left-radius': 'radius', 'box-shadow': 'shadow',
}

/**
 * Third tier from component profiles: <component>.<role> aliasing the semantic token for that cluster when one exists,
 * else its primitive. Only the dominant cluster per role. Pure; exported for tests.
 */
export function componentTokens(profiles, tokens) {
  const out = []
  const byCluster = (id) => tokens.find((t) => t.tier === 'semantic' && t.clusters.includes(id)) || tokens.find((t) => t.tier === 'primitive' && t.clusters.includes(id))
  for (const p of profiles || []) {
    const roles = {}
    for (const [prop, list] of Object.entries(p.props)) {
      const role = COMPONENT_PROP[prop]
      if (!role || !list.length) continue
      const top = list[0]
      if (!roles[role] || top.n > roles[role].n) roles[role] = top
    }
    for (const [role, top] of Object.entries(roles)) {
      const target = byCluster(top.cluster)
      const name = `${p.component}.${role}`
      if (!target || tokens.some((t) => t.name === name) || out.some((t) => t.name === name)) continue
      out.push({ name, tier: 'component', alias: target.name, clusters: [top.cluster], why: `Most used ${role} value inside ${p.component} regions (${top.n} uses).` })
    }
  }
  return out
}

/**
 * Fourth layer on the third tier: `<component>.<state>.<role>` tokens, aliasing the semantic/primitive token
 * for the cluster that state's own roots use — e.g. `nav.active.bg` for the blue Bootstrap's `.active` class
 * puts on the current pill in a Month/Week toggle. Same dominant-cluster-per-role rule as componentTokens,
 * scoped to profile.states (already restricted to roots carrying that state's class). Pure; exported for tests.
 */
export function componentStateTokens(profiles, tokens) {
  const out = []
  const byCluster = (id) => tokens.find((t) => t.tier === 'semantic' && t.clusters.includes(id)) || tokens.find((t) => t.tier === 'primitive' && t.clusters.includes(id))
  for (const p of profiles || []) {
    for (const [state, info] of Object.entries(p.states || {})) {
      const roles = {}
      for (const [prop, list] of Object.entries(info.props)) {
        const role = COMPONENT_PROP[prop]
        if (!role || !list.length) continue
        const top = list[0]
        if (!roles[role] || top.n > roles[role].n) roles[role] = top
      }
      for (const [role, top] of Object.entries(roles)) {
        const target = byCluster(top.cluster)
        const name = `${p.component}.${state}.${role}`
        if (!target || tokens.some((t) => t.name === name) || out.some((t) => t.name === name)) continue
        out.push({ name, tier: 'component', alias: target.name, clusters: [top.cluster], why: `Most used ${role} value inside ${p.component} ${state} roots (${top.n} uses).` })
      }
    }
  }
  return out
}

export function heuristicTokens({ clusters, components, capture }) {
  const prim = primitiveNames(clusters)
  /** @type {import('../../types.js').TokenProposal[]} */
  const tokens = clusters.map((c) => ({
    name: prim.get(c.id), tier: 'primitive', value: c.value, clusters: [c.id],
    why: c.members.length > 1
      ? `Merges ${c.members.length} near-identical values (${c.members.map((m) => m.value).join(', ')}) used ${c.count} times.`
      : `Used ${c.count} times.`,
  }))
  const sem = (name, c, why, tier = 'semantic') => {
    if (!c || tokens.some((t) => t.name === name)) return
    tokens.push({ name, tier, alias: prim.get(c.id), clusters: [c.id], why })
  }
  const bg = (c) => c.props['background-color'] || 0
  const fg = (c) => c.props['color'] || 0
  // Action color: the most used *background* inside buttons, preferring a chromatic color over
  // white/gray (outline buttons have white backgrounds; the brand fill is the one that matters).
  const pr = (c, k) => (c.propRegions && c.propRegions[k]) || 0
  const chroma = (c) => !/^color\.(gray|white|black)/.test(colorPrimitiveName(c.value))
  const action = top(clusters, 'color', (c) => pr(c, 'background-color@button') * (chroma(c) ? 10 : 1))
  sem('color.action.primary', action, 'Most used background inside buttons.')
  const surface = top(clusters, 'color', (c) => (bg(c) > 0 && L(c) > 90 ? bg(c) : 0))
  sem('color.surface.default', surface, 'Lightest widely used background.')
  const raised = top(clusters, 'color', (c) => (c !== surface && (c.regionLabels.card || 0) && bg(c) ? c.regionLabels.card : 0))
  sem('color.surface.raised', raised, 'Background used most inside cards.')
  const text = top(clusters, 'color', fg)
  sem('color.text.default', text, 'Most used text color.')
  const muted = top(clusters, 'color', (c) => (c !== text && c !== action ? fg(c) : 0))
  sem('color.text.muted', muted, 'Second most used text color.')
  const border = top(clusters, 'color', (c) => ['top', 'right', 'bottom', 'left'].reduce((n, side) => n + (c.props[`border-${side}-color`] || 0), 0))
  sem('color.border.default', border, 'Most used border color.')
  const body = top(clusters, 'font-size', (c) => c.count)
  sem('font.size.body', body, 'Most used font size.')
  const btnRadius = top(clusters, 'radius', (c) => c.regionLabels.button || 0)
  sem('button.radius', btnRadius, 'Corner radius used on buttons.', 'component')
  const cardRadius = top(clusters, 'radius', (c) => c.regionLabels.card || 0)
  sem('card.radius', cardRadius, 'Corner radius used on cards.', 'component')
  const cardShadow = top(clusters, 'shadow', (c) => c.regionLabels.card || 0)
  sem('card.shadow', cardShadow, 'Shadow used on cards.', 'component')
  for (const t of componentTokens(components, tokens)) tokens.push(t)
  for (const t of componentStateTokens(components, tokens)) tokens.push(t)
  // Text sitting on a non-page-surface background (a dark card, the action color) needs its own
  // semantic token even when it is not inside a profiled "button" component; see fillOnSurfaceTextTokens.
  const withOnSurface = capture ? fillOnSurfaceTextTokens(tokens, clusters, capture) : tokens
  return { tokens: withOnSurface, merges: suggestMerges(clusters), namer: 'mock-heuristic' }
}

const STATUS_FAMILY = { green: 'success', red: 'danger', orange: 'warning', yellow: 'warning', blue: 'info', teal: 'info' }

/** Most-used text color inside button regions, from component profiles. */
function buttonTextUse(components) {
  const btn = (components || []).find((p) => p.component === 'button')
  const list = btn && btn.props && btn.props.color
  return list && list.length ? list[0] : null
}

/**
 * Deterministic gap-fill for semantic roles the model (any effort) skipped despite clear evidence in
 * the component profiles: a text color reserved for buttons/inverse surfaces, and status colors from
 * badge/alert backgrounds. Each addition is marked "Heuristic:" in its "why" so it reads as ours, not a
 * model's read of the page. Conservative on purpose: one badge color alone is not enough to tell a status
 * color from a brand accent, so status tokens only land when 2+ distinct hue families show up. Pure;
 * exported for tests.
 * @param {import('../../types.js').TokenProposal[]} tokens
 * @param {import('../../types.js').Cluster[]} clusters
 * @param {any[]} components
 */
export function fillSemanticGaps(tokens, clusters, components) {
  const out = [...tokens]
  const clusterById = (id) => clusters.find((c) => c.id === id)
  const primFor = (id) => out.find((t) => t.tier === 'primitive' && t.clusters?.includes(id))
  const has = (name) => out.some((t) => t.name === name)

  const btnText = buttonTextUse(components)
  if (btnText && !has('color.text.inverse')) {
    const c = clusterById(btnText.cluster)
    const p = c && primFor(c.id)
    const sameRoleAlready = p && out.some((t) => t.tier === 'semantic' && /^color\.text\./.test(t.name) && t.alias === p.name)
    if (p && !sameRoleAlready) {
      out.push({
        name: 'color.text.inverse', tier: 'semantic', alias: p.name, clusters: [c.id],
        why: `Heuristic: most used text color inside buttons (${btnText.n} uses), distinct from the default/muted text roles.`,
      })
    }
  }

  const byFamily = new Map()
  for (const p of components || []) {
    if (p.component !== 'badge' && p.component !== 'alert') continue
    for (const u of p.props?.['background-color'] || []) {
      const c = clusterById(u.cluster)
      if (!c || c.kind !== 'color') continue
      const m = /^color\.([a-z]+)\./.exec(colorPrimitiveName(c.value))
      const role = m && STATUS_FAMILY[m[1]]
      if (!role) continue
      const prev = byFamily.get(role)
      if (!prev || u.n > prev.n) byFamily.set(role, { cluster: c.id, n: u.n })
    }
  }
  if (byFamily.size >= 2) {
    for (const [role, u] of byFamily) {
      const name = `color.status.${role}`
      const p = primFor(u.cluster)
      if (p && !has(name)) {
        out.push({
          name, tier: 'semantic', alias: p.name, clusters: [u.cluster],
          why: `Heuristic: badge/alert background color (${u.n} uses) reads as ${role} by hue.`,
        })
      }
    }
  }
  return out
}

/**
 * For each text color cluster, the background color cluster it most often sits on, from the captured
 * text/background pairs (contrast.js `pairsFromCapture` — the same evidence the verify-stage contrast
 * check uses, re-derived from the raw capture rather than a region-level aggregate). Pure; exported for
 * tests.
 * @param {import('../../types.js').Capture} capture
 * @param {import('../../types.js').Cluster[]} clusters
 * @returns {Map<string, {bgCluster: string|null, n: number, total: number}>} fg cluster id -> dominant bg
 */
export function onSurfaceEvidence(capture, clusters) {
  const byFg = new Map()
  if (!capture || !Array.isArray(capture.elements)) return byFg
  const colorClusters = clusters.filter((c) => c.kind === 'color')
  const clusterOf = (raw) => {
    const hex = normalizeColor(String(raw || ''))
    if (!hex) return null
    const c = colorClusters.find((c) => c.members.some((m) => m.value === hex))
    return c ? c.id : null
  }
  for (const p of pairsFromCapture(capture)) {
    const fg = clusterOf(p.captured.fg)
    const bg = clusterOf(p.captured.bg)
    if (!fg || !bg) continue
    const counts = byFg.get(fg) || new Map()
    counts.set(bg, (counts.get(bg) || 0) + 1)
    byFg.set(fg, counts)
  }
  const out = new Map()
  for (const [fg, counts] of byFg) {
    let bestBg = null, bestN = 0, total = 0
    for (const [bg, n] of counts) { total += n; if (n > bestN) { bestN = n; bestBg = bg } }
    out.set(fg, { bgCluster: bestBg, n: bestN, total })
  }
  return out
}

/**
 * Deterministic gap-fill for text colors that sit on a surface other than the page's own
 * (`color.surface.default`): Argon's white text and white surfaces share one primitive, so a theme that
 * darkens surfaces also darkens that text unless it gets its own semantic token. Convention (reconciling
 * with L4's `color.text.inverse`, kept as-is for button text): `color.text.on-primary` when the dominant
 * background is the action/primary color, else `color.text.on-dark`. Only fires when the evidence clears
 * a small usage floor (n >= 2) and the text cluster has no text-role semantic/component token yet (button
 * text already covered by `fillSemanticGaps`'s `color.text.inverse`, or a model-proposed role). Pure;
 * exported for tests.
 * @param {import('../../types.js').TokenProposal[]} tokens
 * @param {import('../../types.js').Cluster[]} clusters
 * @param {import('../../types.js').Capture} [capture]
 */
export function fillOnSurfaceTextTokens(tokens, clusters, capture) {
  const out = [...tokens]
  if (!capture) return out
  const primFor = (id) => out.find((t) => t.tier === 'primitive' && t.clusters?.includes(id))
  const has = (name) => out.some((t) => t.name === name)
  const byName = (name) => out.find((t) => t.name === name)

  const surface = byName('color.surface.default')
  const surfacePrim = surface && byName(surface.alias)
  const surfaceCluster = surfacePrim && surfacePrim.clusters[0]
  const action = byName('color.action.primary')
  const actionPrim = action && byName(action.alias)
  const actionCluster = actionPrim && actionPrim.clusters[0]

  const textRoleRe = /text|inverse/i
  const textCovered = new Set(
    out.filter((t) => t.tier !== 'primitive' && textRoleRe.test(t.name))
      .flatMap((t) => t.clusters || [])
  )

  const evidence = onSurfaceEvidence(capture, clusters)
  // Deterministic order so repeated runs over the same capture add tokens in the same sequence.
  const entries = [...evidence.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [fgCluster, info] of entries) {
    if (info.n < 2) continue
    if (!info.bgCluster || info.bgCluster === surfaceCluster) continue
    if (textCovered.has(fgCluster)) continue
    const p = primFor(fgCluster)
    if (!p) continue
    const name = info.bgCluster === actionCluster ? 'color.text.on-primary' : 'color.text.on-dark'
    if (has(name)) continue
    const reason = info.bgCluster === actionCluster
      ? `Heuristic: most common background under this text (${info.n}/${info.total} checked pairs) is the action/primary color.`
      : `Heuristic: most common background under this text (${info.n}/${info.total} checked pairs) is not the page surface.`
    out.push({ name, tier: 'semantic', alias: p.name, clusters: [fgCluster], why: reason })
    textCovered.add(fgCluster)
  }
  return out
}

/** @returns {import('../../types.js').NamerProvider} */
export default function heuristicNamer() {
  return { id: 'mock-heuristic', name: async (input) => heuristicTokens(input) }
}
