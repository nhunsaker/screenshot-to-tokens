// React / JSX rewrite via the published @sorb/seed adapt pieces: detectHardcoded finds inline-style,
// styled-components and style-object literals; rewriteSource swaps them for var(--token, original).
// Plain CSS lives in deterministic.js; this covers the React apps most demo targets are.
import { detectHardcoded } from '@sorb/seed'
import { rewriteSource } from '@sorb/seed/src/adapt/codemod.js'
import { propKind, normalizeFor } from '../../lib/props.js'

export const JSX_EXT = /\.(jsx?|tsx?|mjs)$/

/** backgroundColor → background-color */
export const kebab = (prop) => String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())

/**
 * Rewrite one JSX/JS source string.
 * @param {string} source
 * @param {string} file
 * @param {(kind:string, prop:string, value:string) => {cssVar:string, token:string}|null} pick
 *   Token chooser shared with the CSS rewriter (same semantic preference rules).
 * @returns {{code:string, edits:{line:number, prop:string, before:string, after:string, token:string}[]}}
 */
export function rewriteJsx(source, file, pick) {
  const sites = detectHardcoded(source, file)
  const rows = []
  const edits = []
  for (const s of sites) {
    const prop = kebab(s.prop)
    const kind = propKind(prop)
    if (!kind) continue
    // JSX numbers mean px for dimensions (borderRadius: 4).
    const raw = /^\d+(\.\d+)?$/.test(s.raw) && kind !== 'font-weight' ? `${s.raw}px` : s.raw
    const value = normalizeFor(kind, raw)
    if (!value) continue
    const hit = pick(kind, prop, value)
    if (!hit) continue
    rows.push({ ...s, cssVar: hit.cssVar, tokenId: hit.token, confidence: 1, candidates: [hit.token], status: 'auto' })
    edits.push({ line: s.loc.line, prop: s.prop, before: s.raw, after: `var(${hit.cssVar}, ${s.raw})`, token: hit.token })
  }
  if (!rows.length) return { code: source, edits: [] }
  let { code } = rewriteSource(source, rows)
  // @sorb/seed 0.5.1 codemod writes a numeric JSX value as `var(--x, 4)`; inside a string React no
  // longer adds px, so the fallback is invalid CSS. Add the unit back. (Upstream fix: sorb-seed codemod.)
  for (const r of rows) {
    if (!/^\d+(\.\d+)?$/.test(r.raw) || propKind(kebab(r.prop)) === 'font-weight') continue
    code = code.split(`var(${r.cssVar}, ${r.raw})`).join(`var(${r.cssVar}, ${r.raw}px)`)
  }
  for (const e of edits) if (/^\d+(\.\d+)?$/.test(e.before) && !e.after.endsWith('px)') && propKind(kebab(e.prop)) !== 'font-weight') e.after = e.after.replace(/\)$/, 'px)')
  return { code, edits }
}
