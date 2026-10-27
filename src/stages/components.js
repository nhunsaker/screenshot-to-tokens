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

// Observable UI states: classes a framework toggles onto a component root to mark it (Bootstrap's `.active`,
// `.disabled`, `.selected`), which a static capture can actually see on the DOM. `:hover`/`:focus` can't be
// observed this way (no live pointer at capture time); those are still recognized at the selector level
// (STATE_SELECTOR, below) so the rewrite can prefer a state token if one happens to exist, but a static run
// will never have usage data to back a hover/focus token into existence.
export const STATE_LABELS = ['active', 'disabled', 'selected', 'current']

/** IoU-ish: the element box and the region box describe the same thing. */
const sameBox = (a, b) => containment(a, b) >= 0.9 && containment(b, a) >= 0.85

/** Top-3 clusters per property, by use count. Shared shape for a component's overall props and each state's. */
function topClustersByProp(uses, clusterOf, matches) {
  const props = {}
  for (const u of uses) {
    if (!matches(u)) continue
    const id = clusterOf.get(`${u.kind}:${u.value}`)
    if (!id) continue
    ;(props[u.prop] ||= {})[id] = ((props[u.prop] || {})[id] || 0) + 1
  }
  const propList = {}
  for (const [prop, m] of Object.entries(props)) {
    propList[prop] = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cluster, n]) => ({ cluster, n }))
  }
  return propList
}

/**
 * @param {import('../types.js').Capture} capture
 * @param {import('../types.js').Region[]} regions
 * @param {import('../types.js').Cluster[]} clusters
 * @returns {{component:string, regions:number, classes:string[], props:Record<string,{cluster:string,n:number}[]>, states:Record<string,{roots:number,props:Record<string,{cluster:string,n:number}[]>}>}[]}
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
    // Which of this label's own root elements carry a state class (e.g. the one `.nav-link` that is `.active`),
    // keyed by state → set of root element indices. Used below to profile that state's own value usage.
    const stateRoots = {}
    // Classes actually seen on a state root (e.g. `nav-link` on the one that's `.active`) — kept even when the
    // class is too rare across every root to clear the general share threshold below, since carrying a state is
    // reliable evidence on its own that the class belongs to this component.
    const stateClasses = new Set()
    let roots = 0
    for (const r of regs) {
      const root = capture.elements.find((e) => sameBox(e.bbox, r.bbox))
      if (!root) continue
      roots++
      const rootClasses = new Set(root.classes || [])
      for (const cls of rootClasses) if (!UTILITY.test(cls)) classCount[cls] = (classCount[cls] || 0) + 1
      let hasState = false
      for (const state of STATE_LABELS) if (rootClasses.has(state)) { (stateRoots[state] ||= new Set()).add(root.i); hasState = true }
      // The state class itself (e.g. `active`) is a generic marker, not evidence of which component this is —
      // only its *other* classes (e.g. `nav-link`) say that.
      if (hasState) for (const cls of rootClasses) if (!UTILITY.test(cls) && !STATE_LABELS.includes(cls)) stateClasses.add(cls)
    }
    // A class names the component if at least a third of its roots carry it (and at least 2 when there are several).
    const minShare = Math.max(1, Math.ceil(roots / 3))
    const classes = Object.entries(classCount).filter(([, n]) => n >= minShare && (roots < 3 || n >= 2)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c)
    for (const cls of stateClasses) if (!classes.includes(cls)) classes.push(cls)
    // Values used inside these regions, per property → cluster.
    const propList = topClustersByProp(allUses, clusterOf, (u) => u.regionLabel === label)
    // Per state: only the values seen on the roots that actually carry that state's class, so e.g. an
    // `.active` nav-pill's own background never gets credited to every other (inactive) pill too.
    const states = {}
    for (const [state, idxSet] of Object.entries(stateRoots)) {
      const sList = topClustersByProp(allUses, clusterOf, (u) => u.regionLabel === label && idxSet.has(u.element))
      if (Object.keys(sList).length) states[state] = { roots: idxSet.size, props: sList }
    }
    if (Object.keys(propList).length) out.push({ component: label, regions: regs.length, classes, props: propList, states })
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

// Selector text → canonical state name. Independent of classIndex: `:hover`/`:focus`/`:disabled` are
// pseudo-classes, never authored classes, and `[aria-current]`/`[aria-selected=true]` are attribute selectors —
// none of those would ever show up as a component class. `.active`/`.disabled`/`.selected` are also matched
// here (not just via the class list) since a selector like `.nav-link.active` carries the state right in the
// text that reaches selectorContext.
const STATE_SELECTOR = [
  [/\.active\b/, 'active'],
  [/:hover\b/, 'hover'],
  [/\.disabled\b/, 'disabled'],
  [/:disabled\b/, 'disabled'],
  [/\.selected\b/, 'selected'],
  [/:focus\b/, 'focus'],
  [/\[\s*aria-current(?:\s*=[^\]]*)?\]/, 'current'],
  [/\[\s*aria-selected\s*=\s*["']?true["']?\s*\]/, 'selected'],
]

/** Which states (active, hover, disabled, selected, focus, current) a CSS selector names. */
export function statesForSelector(selector) {
  const found = new Set()
  const s = String(selector)
  for (const [re, name] of STATE_SELECTOR) if (re.test(s)) found.add(name)
  return [...found]
}
