// Component profiles: the bridge from detected regions to the third token tier.
//
// For each kind of component we detected (button, input, card, badge, header, nav, footer, link), record:
//   - the CSS classes its root elements carry (so the rewrite can tell `.btn { … }` is a button rule), and
//   - which value clusters it uses, per property (so component tokens can only cover values that component uses).
// Pure: capture + regions + clusters in, profiles out.
import { collectUses, containment } from './join.js'

export const COMPONENT_LABELS = ['button', 'input', 'card', 'badge', 'header', 'nav', 'footer', 'link']

// Utility / layout classes say nothing about which component a rule styles (Bootstrap, Tailwind-ish).
const UTILITY = /^(m[trblxy]?|p[trblxy]?|g[xy]?|col|row|d|flex|align|justify|text|font|fw|bg|w|h|mw|mh|position|top|bottom|start|end|border|rounded|shadow|order|float|overflow|opacity|gap|lh|fs|container|clearfix|visible|invisible|sr)(-|$)/

/** IoU-ish: the element box and the region box describe the same thing. */
const sameBox = (a, b) => containment(a, b) >= 0.9 && containment(b, a) >= 0.85

/**
 * @param {import('../types.js').Capture} capture
 * @param {import('../types.js').Region[]} regions
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {{component:string, regions:number, classes:string[], props:Record<string,{cluster:string,n:number}[]>}[]}
 */
export function profileComponents(capture, regions, clusters) {
  const clusterOf = new Map()
  for (const c of clusters) for (const m of c.members) clusterOf.set(`${c.kind}:${m.value}`, c.id)
  // Assign every value to the smallest region around it (any label), so a button's blue inside a card counts for
  // the button, not the card.
  const allUses = collectUses(capture, regions)
  const out = []
  for (const label of COMPONENT_LABELS) {
    const regs = regions.filter((r) => r.label === label)
    if (!regs.length) continue
    // Root elements: the element whose box is the region's box.
    const classCount = {}
    let roots = 0
    for (const r of regs) {
      const root = capture.elements.find((e) => sameBox(e.bbox, r.bbox))
      if (!root) continue
      roots++
      for (const cls of new Set(root.classes || [])) if (!UTILITY.test(cls)) classCount[cls] = (classCount[cls] || 0) + 1
    }
    // A class names the component if at least a third of its roots carry it (and at least 2 when there are several).
    const minShare = Math.max(1, Math.ceil(roots / 3))
    const classes = Object.entries(classCount).filter(([, n]) => n >= minShare && (roots < 3 || n >= 2)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c)
    // Values used inside these regions, per property → cluster.
    const props = {}
    for (const u of allUses) {
      if (u.regionLabel !== label) continue
      const id = clusterOf.get(`${u.kind}:${u.value}`)
      if (!id) continue
      ;(props[u.prop] ||= {})[id] = ((props[u.prop] || {})[id] || 0) + 1
    }
    const propList = {}
    for (const [prop, m] of Object.entries(props)) {
      propList[prop] = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cluster, n]) => ({ cluster, n }))
    }
    if (Object.keys(propList).length) out.push({ component: label, regions: regs.length, classes, props: propList })
  }
  return out
}

/** class name → component label (first profile wins), for selector-aware rewriting. */
export function classIndex(profiles) {
  const m = new Map()
  for (const p of profiles || []) for (const c of p.classes) if (!m.has(c)) m.set(c, p.component)
  return m
}

/** Which components a CSS selector styles, by the classes it mentions. */
export function componentsForSelector(selector, index) {
  const found = new Set()
  for (const m of String(selector).matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    const label = index.get(m[1])
    if (label) found.add(label)
  }
  return [...found]
}
