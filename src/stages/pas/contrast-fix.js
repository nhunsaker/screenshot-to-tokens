// Point and say, deterministic path for "make it readable": the smallest OKLCH lightness change to one colour token
// (hue kept; chroma reduced only if the colour leaves the sRGB gamut) that brings EVERY text pair using that token to
// its WCAG 2.x AA minimum (4.5:1, or 3:1 for large text) against the backgrounds measured in the live page.
// No model involved. Pure; conversions per Björn Ottosson's OKLab (2020).
import { parseColor, toHex, contrastRatio, round2 } from '../../preview-client/contrast.js'

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** sRGB {r,g,b} 0..255 -> OKLab {L,a,b}. */
export function rgbToOklab({ r, g, b }) {
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab -> linear-light sRGB (unclamped; out of [0,1] means out of gamut). */
function oklabToLinear({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

/** OKLab -> sRGB 0..255 (clamped). */
export function oklabToRgb(lab) {
  const [r, g, b] = oklabToLinear(lab)
  const c = (v) => Math.round(Math.max(0, Math.min(255, gam(Math.max(0, Math.min(1, v))))))
  return { r: c(r), g: c(g), b: c(b) }
}

export function rgbToOklch(c) {
  const { L, a, b } = rgbToOklab(c)
  const C = Math.hypot(a, b)
  return { L, C, h: C < 1e-6 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 }
}

const inGamut = (lab) => oklabToLinear(lab).every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** OKLCH -> sRGB, reducing chroma (hue and lightness kept) until it fits the sRGB gamut. */
export function oklchToRgb({ L, C, h }) {
  const rad = h * Math.PI / 180
  let lo = 0, hi = C
  const at = (c) => ({ L, a: c * Math.cos(rad), b: c * Math.sin(rad) })
  if (inGamut(at(C))) return oklabToRgb(at(C))
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (inGamut(at(mid))) lo = mid; else hi = mid }
  return oklabToRgb(at(lo))
}

/** Every pair's ratio with `fg` (keeps the token's alpha) and whether all reach their minimum. */
export function checkPairs(fg, pairs) {
  const rows = pairs.map((p) => {
    const bg = parseColor(p.bg)
    const ratio = contrastRatio(fg, bg)
    return { ...p, ratio: round2(ratio), pass: ratio + 1e-9 >= p.required }
  })
  return { rows, allPass: rows.every((r) => r.pass), worst: rows.reduce((m, r) => Math.min(m, r.ratio), Infinity) }
}

/**
 * The smallest lightness change to `value` that makes every pair pass. Tries darker and lighter and keeps the one
 * with the smaller |ΔL| that works (a token used on both light and dark backgrounds may have none).
 * @param {string} value current colour of the token (hex/rgb, alpha kept)
 * @param {Array<{bg:string, required:number, id?:string, text?:string}>} pairs measured backgrounds of every text
 *   pair whose colour comes from this token
 * @returns {{value:string, from:string, dL:number, direction:'darker'|'lighter'|'none', before:object, after:object}|{error:string, before:object}}
 */
export function minimalLightnessFix(value, pairs, o = {}) {
  const step = o.step || 0.0025
  const c0 = parseColor(value)
  if (!c0) return { error: `not a colour: ${value}`, before: null }
  const before = checkPairs(c0, pairs)
  if (!pairs.length) return { error: 'no text pairs use this token', before }
  if (before.allPass) return { value: toHex(c0), from: toHex(c0), dL: 0, direction: 'none', before, after: before }
  const lch = rgbToOklch(c0)
  const tries = []
  for (const dir of [-1, 1]) {
    for (let L = lch.L + dir * step; L >= 0 && L <= 1; L += dir * step) {
      const rgb = oklchToRgb({ L, C: lch.C, h: lch.h })
      const fg = { ...rgb, a: c0.a }
      const chk = checkPairs(fg, pairs)
      if (chk.allPass) { tries.push({ L, rgb, chk, dir }); break }
    }
  }
  if (!tries.length) return { error: 'no lightness of this hue passes every pair (it sits on both light and dark backgrounds)', before }
  tries.sort((a, b) => Math.abs(a.L - lch.L) - Math.abs(b.L - lch.L))
  const t = tries[0]
  const hex = toHex(t.rgb) + (c0.a < 1 ? Math.round(c0.a * 255).toString(16).padStart(2, '0') : '')
  return { value: hex, from: value, dL: Math.round((t.L - lch.L) * 1000) / 1000, direction: t.dir < 0 ? 'darker' : 'lighter', before, after: t.chk, oklch: { from: lchRound(lch), to: lchRound(rgbToOklch(t.rgb)) } }
}

const lchRound = (x) => ({ L: Math.round(x.L * 1000) / 1000, C: Math.round(x.C * 1000) / 1000, h: Math.round(x.h * 10) / 10 })

/**
 * contrastFix(tokenName, pairsUsingToken, tokens): the proposal for one token.
 * `tokens` = [{name, value?, alias?}] (tokens.json shape); the token's current value is resolved through aliases.
 * The change is written on the named token itself (an alias becomes a value), so only that token and the tokens that
 * alias it move, never the primitive's other users.
 * @returns {{token:string, value:string, from:string, aliasOf:string|null, dL:number, direction:string, before:object, after:object}|{token:string, error:string}}
 */
export function contrastFix(tokenName, pairsUsingToken, tokens) {
  const by = new Map((tokens || []).map((t) => [t.name, t]))
  const t = by.get(tokenName)
  if (!t) return { token: tokenName, error: 'unknown token' }
  const seen = new Set()
  let cur = t
  while (cur && cur.value == null && cur.alias && !seen.has(cur.name)) { seen.add(cur.name); cur = by.get(cur.alias) }
  if (!cur || cur.value == null) return { token: tokenName, error: 'token has no resolvable value' }
  const r = minimalLightnessFix(String(cur.value), pairsUsingToken)
  if (r.error) return { token: tokenName, error: r.error, before: r.before }
  return { token: tokenName, aliasOf: t.alias || null, ...r }
}
