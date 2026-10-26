// Offline namer: deterministic primitive / semantic / component names from cluster usage.
// Two jobs: (1) the mock provider until Muse Spark access lands, (2) the draft we hand the
// model, so even a small local Llama only has to refine names and reasons, not invent structure.
import { hexToRgba, rgbToLab, suggestMerges } from '../../stages/cluster.js'

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
export function heuristicTokens({ clusters }) {
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
  return { tokens, merges: suggestMerges(clusters), namer: 'mock-heuristic' }
}

/** @returns {import('../../types.js').NamerProvider} */
export default function heuristicNamer() {
  return { id: 'mock-heuristic', name: async (input) => heuristicTokens(input) }
}
