// Which computed-style properties we sample, what kind of token each feeds, and the
// role a property implies (used to prefer semantic tokens when rewriting).
import { normalizeColor, normalizeDimension } from '@sorb/seed'

/** Property → cluster kind. Order = capture order. */
export const STYLE_PROPS = {
  'color': 'color',
  'background-color': 'color',
  'border-top-color': 'color',
  'outline-color': 'color',
  'fill': 'color',
  'stroke': 'color',
  'border-top-left-radius': 'radius',
  'padding-top': 'space',
  'padding-right': 'space',
  'padding-bottom': 'space',
  'padding-left': 'space',
  'margin-top': 'space',
  'margin-bottom': 'space',
  'row-gap': 'space',
  'column-gap': 'space',
  'font-size': 'font-size',
  'font-weight': 'font-weight',
  'font-family': 'font-family',
  'line-height': 'line-height',
  'box-shadow': 'shadow',
}

/** Authored CSS property (incl. shorthands) → kind, for the rewrite stage. */
const AUTHORED = {
  'color': 'color', 'background': 'color', 'background-color': 'color',
  'border-color': 'color', 'border': 'color', 'border-top': 'color', 'border-bottom': 'color',
  'border-left': 'color', 'border-right': 'color', 'outline': 'color', 'outline-color': 'color',
  'fill': 'color', 'stroke': 'color',
  'border-radius': 'radius',
  'padding': 'space', 'padding-top': 'space', 'padding-right': 'space', 'padding-bottom': 'space',
  'padding-left': 'space', 'margin': 'space', 'margin-top': 'space', 'margin-bottom': 'space',
  'margin-left': 'space', 'margin-right': 'space', 'gap': 'space', 'row-gap': 'space', 'column-gap': 'space',
  'font-size': 'font-size', 'font-weight': 'font-weight', 'font-family': 'font-family',
  'line-height': 'line-height', 'box-shadow': 'shadow',
}

/** @param {string} prop @returns {string|null} cluster kind for an authored or computed property */
export const propKind = (prop) => {
  const p = String(prop).trim().toLowerCase()
  return STYLE_PROPS[p] || AUTHORED[p] || null
}

/** Role hint for semantic preference: bg | text | border | null. */
export const propRole = (prop) => {
  const p = String(prop).trim().toLowerCase()
  if (p === 'color') return 'text'
  if (p.startsWith('background') || p === 'fill') return 'bg'
  if (p.startsWith('border') || p.startsWith('outline') || p === 'stroke') return 'border'
  return null
}

/** Values that are never tokens (defaults / keywords). */
const SKIP = new Set(['', 'none', 'normal', 'auto', '0px', '0', 'initial', 'inherit', 'currentcolor'])

/**
 * Normalize a raw value for a kind, or null to ignore it.
 * colors → #rrggbbaa (fully transparent dropped); dimensions → "Npx"; others trimmed.
 * @param {string} kind @param {string} raw
 */
export const normalizeFor = (kind, raw) => {
  if (raw == null) return null
  const s = String(raw).trim()
  if (SKIP.has(s.toLowerCase())) return null
  if (kind === 'color') {
    const hex = normalizeColor(s)
    if (!hex || hex.endsWith('00')) return null
    return hex
  }
  if (kind === 'radius' || kind === 'space' || kind === 'font-size') {
    const n = normalizeDimension(s)
    if (n == null || n === 0) return null
    return `${Math.round(n * 100) / 100}px`
  }
  if (kind === 'line-height') {
    const n = normalizeDimension(s)
    return n == null ? null : `${Math.round(n * 100) / 100}px`
  }
  if (kind === 'font-weight') return /^\d+$/.test(s) ? s : null
  // Keep the whole stack: a token that held only the first family would drop the fallbacks.
  if (kind === 'font-family') return s.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean).join(', ') || null
  return s
}

/** Token dot-name → CSS custom property. "color.action.primary" → "--color-action-primary". */
export const cssVarOf = (name) => '--' + String(name).trim().replace(/[.\s/]+/g, '-').toLowerCase()
