// Cluster: merge near-duplicate values (drift) deterministically, before any model sees them.
// Colors merge by perceptual distance (CIE76 ΔE in Lab); dimensions by a px/percent tolerance.
// Greedy by frequency, so the most-used value is always the representative and chains can't form.

/** "#rrggbb[aa]" → {r,g,b,a} 0..255 / 0..1 */
export function hexToRgba(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  }
}

/** sRGB → CIE Lab (D65). */
export function rgbToLab({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const R = lin(r), G = lin(g), B = lin(b)
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) }
}

export function deltaE(hexA, hexB) {
  const A = hexToRgba(hexA), B = hexToRgba(hexB)
  if (Math.abs(A.a - B.a) > 0.02) return Infinity
  const la = rgbToLab(A), lb = rgbToLab(B)
  return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b)
}

/** Default tolerances. ΔE < 3 is "looks the same" for UI colors. */
export const TOLERANCE = { colorDeltaE: 3, dimPx: 1, dimPct: 0.06 }

const px = (v) => parseFloat(v)

/** Are two normalized values of `kind` the same token? */
export function near(kind, a, b, tol = TOLERANCE) {
  if (a === b) return true
  if (kind === 'color') return deltaE(a, b) < tol.colorDeltaE
  if (kind === 'radius' || kind === 'space' || kind === 'font-size' || kind === 'line-height') {
    const x = px(a), y = px(b)
    if (Number.isNaN(x) || Number.isNaN(y)) return false
    const d = Math.abs(x - y)
    return d <= tol.dimPx || d / Math.max(x, y) <= tol.dimPct
  }
  return false // font-weight, font-family, shadow: exact only
}

const KIND_ORDER = ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'space', 'radius', 'shadow']
const pad = (n) => String(n).padStart(2, '0')

/**
 * @param {{kind:string, value:string, prop:string, regionLabel:string|null}[]} uses
 * @param {typeof TOLERANCE} [tol]
 * @returns {import('../types.js').Cluster[]}
 */
export function clusterUses(uses, tol = TOLERANCE) {
  /** @type {Map<string, Map<string, typeof uses>>} kind → value → uses */
  const byKind = new Map()
  for (const u of uses) {
    if (!byKind.has(u.kind)) byKind.set(u.kind, new Map())
    const m = byKind.get(u.kind)
    if (!m.has(u.value)) m.set(u.value, [])
    m.get(u.value).push(u)
  }
  /** @type {import('../types.js').Cluster[]} */
  const out = []
  const kinds = [...byKind.keys()].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
  for (const kind of kinds) {
    const values = [...byKind.get(kind).entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    /** @type {{rep:string, members:[string, typeof uses][]}[]} */
    const groups = []
    for (const [value, vu] of values) {
      const g = groups.find((g) => near(kind, g.rep, value, tol))
      if (g) g.members.push([value, vu])
      else groups.push({ rep: value, members: [[value, vu]] })
    }
    // Stable, readable order: colors by lightness, dimensions ascending, rest by use.
    if (kind === 'color') groups.sort((a, b) => rgbToLab(hexToRgba(a.rep)).L - rgbToLab(hexToRgba(b.rep)).L)
    else if (['radius', 'space', 'font-size', 'line-height'].includes(kind)) groups.sort((a, b) => px(a.rep) - px(b.rep))
    else if (kind === 'font-weight') groups.sort((a, b) => Number(a.rep) - Number(b.rep))
    groups.forEach((g, i) => {
      const props = {}, regionLabels = {}, propRegions = {}
      let count = 0
      for (const [, vu] of g.members) for (const u of vu) {
        count++
        props[u.prop] = (props[u.prop] || 0) + 1
        if (u.regionLabel) {
          regionLabels[u.regionLabel] = (regionLabels[u.regionLabel] || 0) + 1
          const k = `${u.prop}@${u.regionLabel}`
          propRegions[k] = (propRegions[k] || 0) + 1
        }
      }
      out.push({
        id: `${kind}-${pad(i + 1)}`,
        kind,
        value: g.rep,
        members: g.members.map(([value, vu]) => ({ value, count: vu.length })),
        count,
        props,
        regionLabels,
        propRegions,
      })
    })
  }
  return out
}

/** How much drift we found: distinct raw values vs clusters. */
export function driftSummary(clusters) {
  const distinct = clusters.reduce((n, c) => n + c.members.length, 0)
  return { distinctValues: distinct, clusters: clusters.length, merged: distinct - clusters.length }
}

/**
 * Merge *suggestions* with a looser tolerance: near enough that a designer would probably call
 * them the same, too far to merge automatically (e.g. 4px / 6px radius). A person accepts or declines
 * each one in review; nothing is merged here.
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {{from:string, into:string, why:string}[]}
 */
/** Kinds where loose suggestions make sense. Type-scale steps (font size, line height) are close on purpose. */
const SUGGEST_KINDS = new Set(['color', 'radius', 'space'])

export function suggestMerges(clusters, tol = TOLERANCE) {
  // Colors: a narrow band just past the auto-merge cutoff (ΔE 3 to 3.5); a visible tint is a different token.
  const loose = { colorDeltaE: tol.colorDeltaE + 0.5, dimPx: tol.dimPx * 2, dimPct: tol.dimPct * 2 }
  const out = []
  const absorbed = new Set()
  const byKind = {}
  for (const c of clusters) if (SUGGEST_KINDS.has(c.kind)) (byKind[c.kind] ||= []).push(c)
  for (const list of Object.values(byKind)) {
    const ordered = [...list].sort((a, b) => b.count - a.count)
    for (const into of ordered) {
      if (absorbed.has(into.id)) continue
      for (const from of ordered) {
        if (from === into || absorbed.has(from.id) || from.count > into.count) continue
        if (!near(from.kind, into.value, from.value, loose)) continue
        absorbed.add(from.id)
        out.push({ from: from.id, into: into.id, why: `${from.value} (${from.count} uses) is close to ${into.value} (${into.count} uses); probably the same ${from.kind}.` })
      }
    }
  }
  return out
}
