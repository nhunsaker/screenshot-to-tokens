// Point and say, deterministic path for "give every control a visible focus ring": the focus-ring component tokens
// and the one :focus-visible rule from focus.js. The colour: if the person names one ("in our blue"), the best token
// of that hue (action/semantic first); if it falls under 3:1 against what surrounds some controls, the ring is
// two-tone in that hue (a contrasting band inside and outside the outline) and the summary says so. No colour named:
// focus.js's own pick (pickRingColor). No model. Pure.
import { pickRingColor, focusRuleCss, FOCUS_MIN_RATIO, RING } from '../focus.js'
import { parseColor, toHex, contrastRatio, luminance, round2, cssVarName } from '../../preview-client/contrast.js'
import { rgbToOklch } from './contrast-fix.js'

/** Hue words a person may say, with their OKLCH hue ranges in degrees (gray/black/white by chroma/lightness). */
export const HUES = {
  red: [[0, 40], [345, 360]], orange: [[40, 75]], yellow: [[75, 115]], green: [[115, 175]],
  teal: [[175, 235]], cyan: [[175, 235]], blue: [[235, 300]], indigo: [[255, 300]], purple: [[290, 335]], violet: [[290, 335]],
  pink: [[330, 360], [0, 15]], gray: 'neutral', grey: 'neutral', black: 'black', white: 'white',
}

/** The colour word in a transcript ("in our blue" -> "blue"), else null. "grey" reads as "gray". Pure. */
export function namedHue(transcript) {
  const m = String(transcript || '').toLowerCase().match(new RegExp(`\\b(${Object.keys(HUES).join('|')})\\b`))
  return m ? (m[1] === 'grey' ? 'gray' : m[1]) : null
}

/** Whether a colour belongs to a hue word (`widen` degrees on each side of its range). Pure. */
export function inHue(color, hue, widen = 0) {
  const c = parseColor(color)
  if (!c) return false
  const { L, C, h } = rgbToOklch(c)
  const spec = HUES[hue]
  if (spec === 'neutral') return C < 0.035 && L > 0.15 && L < 0.95
  if (spec === 'black') return C < 0.035 && L <= 0.25
  if (spec === 'white') return C < 0.035 && L >= 0.95
  const within = (x, a, b) => x >= a && x < b
  return C >= 0.04 && spec.some(([a, b]) => within(h, a - widen, b + widen) || within(h + 360, a - widen, b + widen) || within(h - 360, a - widen, b + widen))
}

const rankOf = (t) => (t.name === 'color.action.primary' ? 0 : /^color\.action\./.test(t.name) ? 1 : t.tier === 'semantic' ? 2 : t.tier === 'component' ? 3 : 4)

/**
 * Ring choice for a named hue. Candidates: opaque tokens whose name has the word or whose value is that hue. Best =
 * the preferred name (action > semantic > component > primitive; ties: covers the most stops at >= 3:1). If it
 * does not cover every stop, two-tone: the inner band is the darkest or lightest token (or black/white), whichever
 * contrasts most with the ring colour. No token of that hue: the nearest hue within 30° (`nearest: true`), else null.
 * @param {{bg?:string|null}[]} stops
 * @param {{name:string, tier:string, value:string}[]} values
 */
export function ringForHue(hue, stops, values) {
  const bgs = stops.map((s) => s.bg && parseColor(s.bg)).filter(Boolean)
  const opaque = values.filter((t) => { const c = parseColor(t.value); return c && c.a === 1 })
  const word = new RegExp(`(^|\\.)${hue === 'gray' ? 'gr[ae]y' : hue}(\\.|$)`)
  let nearest = false
  let cands = opaque.filter((t) => word.test(t.name) || inHue(t.value, hue))
  if (!cands.length) { cands = opaque.filter((t) => inHue(t.value, hue, 30)); nearest = true }
  if (!cands.length) return null
  const scored = cands.map((t) => {
    const c = parseColor(t.value)
    const rs = bgs.map((b) => contrastRatio(c, b))
    return { token: t.name, tier: t.tier, value: toHex(c), covered: rs.filter((r) => r >= FOCUS_MIN_RATIO).length, worst: rs.length ? round2(Math.min(...rs)) : null, rank: rankOf(t) }
  }).sort((a, b) => a.rank - b.rank || b.covered - a.covered || (b.worst ?? 0) - (a.worst ?? 0))
  // The preferred name of the hue (the action colour first): the person named the hue, so we keep it and add a
  // band where it is too weak rather than switching to a darker token of the same family.
  const best = scored[0]
  const { rank, ...color } = best
  const total = bgs.length
  if (best.covered === total) return { mode: 'single', color, covered: best.covered, total, hue, nearest }
  const c = parseColor(color.value)
  const byLum = opaque.map((t) => ({ t, l: luminance(parseColor(t.value)) }))
  const darkest = [...byLum].sort((a, b) => a.l - b.l)[0]
  const lightest = [...byLum].sort((a, b) => b.l - a.l)[0]
  const opts = [darkest && { token: darkest.t.name, tier: darkest.t.tier, value: toHex(parseColor(darkest.t.value)) }, lightest && { token: lightest.t.name, tier: lightest.t.tier, value: toHex(parseColor(lightest.t.value)) }, { token: null, tier: null, value: '#ffffff' }, { token: null, tier: null, value: '#000000' }].filter(Boolean)
  // Band: covers the most stops together with the ring colour; then a token over a literal; then the one that stands
  // out most against the ring colour itself.
  const cover = (o) => bgs.filter((b) => Math.max(contrastRatio(c, b), contrastRatio(parseColor(o.value), b)) >= FOCUS_MIN_RATIO).length
  const inner = opts.map((o) => ({ ...o, vs: contrastRatio(c, parseColor(o.value)), n: cover(o) }))
    .sort((a, b) => b.n - a.n || (!!b.token - !!a.token) || b.vs - a.vs)[0]
  const covered = inner.n
  const { vs, n, ...innerOut } = inner
  return { mode: 'two-tone', color, inner: innerOut, covered, total, singleCovered: best.covered, hue, nearest }
}

const varOr = (c) => (c.token ? `var(--${cssVarName(c.token)}, ${c.value})` : c.value)

/** Change items (contract shape) for a ring choice. Pure. */
export function ringChanges(choice) {
  const item = (token, css, value, alias, why) => ({ token, cssVar: cssVarName(token), value, alias, css, from: null, why, isNew: true })
  const out = [item('focus.ring.color', varOr(choice.color), choice.color.token ? null : choice.color.value, choice.color.token, `Ring colour${choice.hue ? ` in the named ${choice.hue}` : ''}`)]
  if (choice.mode === 'two-tone') out.push(item('focus.ring.inner-color', varOr(choice.inner), choice.inner.token ? null : choice.inner.value, choice.inner.token, 'Contrasting band so the ring shows on every surface'))
  out.push(item('focus.ring.width', RING.width, RING.width, null, 'Ring width'))
  out.push(item('focus.ring.offset', RING.offset, RING.offset, null, 'Gap between the control and the ring'))
  return out
}

/** The choice back from change items (focus-check rebuilds the rule from the request, never takes CSS). Pure. */
export function choiceFromChanges(changes) {
  const get = (cssVar) => (changes || []).find((c) => c && c.cssVar === cssVar)
  const col = get('focus-ring-color')
  if (!col) return null
  const fallback = (c) => { const m = String(c.css || '').match(/#[0-9a-f]{3,8}\b/i); return m ? m[0] : parseColor(c.css) ? toHex(parseColor(c.css)) : '#000000' }
  const inner = get('focus-ring-inner-color')
  return { mode: inner ? 'two-tone' : 'single', color: { token: null, value: fallback(col) }, ...(inner ? { inner: { token: null, value: fallback(inner) } } : {}) }
}

/**
 * The focus proposal. `stops` = the startup Tab-through of the served app (each with `bg`, its surroundings).
 * @returns {{changes:object[], rule:string, summary:string, ring:object, predicted:object}}
 */
export function focusProposal(transcript, stops, values) {
  const measured = stops.filter((s) => s.verdict)
  const hue = namedHue(transcript)
  let choice = hue ? ringForHue(hue, measured, values) : null
  let note = ''
  if (hue && !choice) note = ` No ${hue} token in this app, so the ring uses the best-contrast token instead.`
  if (!choice) choice = pickRingColor(measured, values)
  const name = (c) => c.token || c.value
  let summary
  if (choice.mode === 'single') summary = `Focus ring in ${name(choice.color)} (${choice.color.value}), 3:1 or more against the surroundings of each control. The Tab-through check measures it next.`
  else if (choice.hue) summary = `Two-tone ring in ${name(choice.color)} (${choice.color.value}) with a ${name(choice.inner)} band: ${name(choice.color)} alone is under 3:1 next to ${choice.total - choice.singleCovered} of ${choice.total} controls, so the band carries it there. The Tab-through check measures it next.`
  else summary = `Two-tone ring (${name(choice.color)} with a ${name(choice.inner)} band): no single token reaches 3:1 next to every control. The Tab-through check measures it next.`
  if (choice.nearest) note = ` No token is ${hue} exactly; ${name(choice.color)} is the nearest hue.` + note
  summary += note
  const rule = focusRuleCss(choice)
  const before = { stops: stops.length, measured: measured.length, pass: measured.filter((s) => s.verdict === 'pass').length, faint: measured.filter((s) => s.verdict === 'faint').length, none: measured.filter((s) => s.verdict === 'none').length }
  return {
    changes: ringChanges(choice), rule, summary,
    ring: { mode: choice.mode, color: choice.color, inner: choice.inner || null, covered: choice.covered, total: choice.total, hue: choice.hue || null, nearest: !!choice.nearest },
    predicted: { affected: measured.length, before, ring: { mode: choice.mode, covered: choice.covered, total: choice.total } },
  }
}

/**
 * The focus result line, from the measured Tab-through (pass / faint / none), never from the predicted coverage: on
 * Light Bootstrap the prediction says every stop is covered while the Tab-through measures 23 pass and 12 faint. Pure.
 * @param {{measured:number, pass:number, faint:number, none:number}} before
 * @param {{measured:number, pass:number, faint:number, none:number}} after
 * @param {number} [worse] controls whose indicator got worse
 */
export function focusResultSummary(before, after, worse = 0) {
  const counts = (s) => `${s.pass} pass, ${s.faint} faint, ${s.none} none`
  return `Measured by Tab-through: visible focus on ${before.pass} → ${after.pass} of ${after.measured} controls (before ${counts(before)}; after ${counts(after)})` +
    (worse ? `; ${worse} control${worse === 1 ? '' : 's'} worse.` : '.')
}
