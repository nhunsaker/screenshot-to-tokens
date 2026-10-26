// Inline SVG in HTML: presentation attributes (fill="#1a73e8") can't hold var(), so a matched
// fill/stroke moves into the style attribute as `fill: var(--token, #1a73e8)`. The fallback keeps
// the original color, so the fallback-only render stays identical.
import { normalizeFor } from '../../lib/props.js'

export const SVG_HTML_EXT = /\.(html?|svg)$/i

const SHAPE_TAG = /<(circle|rect|path|ellipse|line|polyline|polygon|g|text|use)\b([^>]*?)(\/?)>/gi
const PAINT_ATTR = /\s(fill|stroke)\s*=\s*"([^"]*)"/gi

/**
 * @param {string} source @param {string} file
 * @param {(kind:string, prop:string, value:string) => {cssVar:string, token:string}|null} pick
 * @returns {{code:string, edits:{line:number, prop:string, before:string, after:string, token:string}[]}}
 */
export function rewriteSvgAttrs(source, file, pick) {
  const edits = []
  const code = source.replace(SHAPE_TAG, (tag, name, attrs, selfClose, offset) => {
    const decls = []
    const line = source.slice(0, offset).split('\n').length
    let rest = attrs.replace(PAINT_ATTR, (m, prop, raw) => {
      const value = normalizeFor('color', raw)
      const hit = value && pick('color', prop.toLowerCase(), value)
      if (!hit) return m
      const after = `var(${hit.cssVar}, ${raw})`
      decls.push(`${prop.toLowerCase()}: ${after}`)
      edits.push({ line, prop: prop.toLowerCase(), before: raw, after, token: hit.token })
      return ''
    })
    if (!decls.length) return tag
    const trailing = rest.match(/\s*$/)[0]
    rest = rest.slice(0, rest.length - trailing.length)
    const style = rest.match(/\sstyle\s*=\s*"([^"]*)"/i)
    if (style) {
      const merged = style[1].trim().replace(/;?\s*$/, '')
      rest = rest.replace(style[0], ` style="${merged ? merged + '; ' : ''}${decls.join('; ')}"`)
    } else {
      rest = `${rest} style="${decls.join('; ')}"`
    }
    return `<${name}${rest}${trailing}${selfClose}>`
  })
  return { code, edits }
}
