// Deterministic coder: no model. Copies targetDir (minus node_modules/.git/build output), then for
// every .css file (and .js/.jsx/.ts/.tsx via jsx.js) swaps literal
// value parts that match a cluster for var(<cssVar>, <original part>). The fallback inside
// var() is always the untouched original text, so a page with no tokens.css loaded renders
// pixel-identical to the source (verify stage checks exactly this).
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, basename } from 'path'
import { propKind, propRole, normalizeFor, cssVarOf } from '../../lib/props.js'
import { rewriteJsx, JSX_EXT } from './jsx.js'
import { classIndex, componentsForSelector } from '../../stages/components.js'
import { rewriteSvgAttrs, SVG_HTML_EXT } from './svg-attrs.js'

/** Split a CSS declaration value into whitespace-separated parts, but never inside parens
 *  (keeps "rgb(26, 115, 232)" intact). Returns [{text, start, end}] offsets into `value`. */
export function splitOutsideParens(value) {
  const parts = []
  let depth = 0
  let start = -1
  for (let i = 0; i <= value.length; i++) {
    const c = value[i]
    const atSpace = c === undefined || /\s/.test(c)
    if (c === '(') depth++
    if (depth === 0 && atSpace) {
      if (start !== -1) { parts.push({ text: value.slice(start, i), start, end: i }); start = -1 }
    } else if (start === -1) {
      start = i
    }
    if (c === ')') depth--
  }
  return parts
}

/** Kinds whose authored value is one semantic unit, never split on whitespace. */
const WHOLE_VALUE_KINDS = new Set(['font-family', 'shadow'])

/** Value parts for a declaration: either the whole trimmed value, or whitespace-split parts. */
function valueParts(kind, value) {
  if (WHOLE_VALUE_KINDS.has(kind)) {
    const m = value.match(/\S.*\S|\S/)
    if (!m) return []
    return [{ text: m[0], start: m.index, end: m.index + m[0].length }]
  }
  return splitOutsideParens(value)
}

/** Role-name regexes used to prefer a semantic/component token whose name matches the property's role. */
const ROLE_RE = {
  bg: /surface|bg|background|action|fill/i,
  text: /text|fg|foreground|ink/i,
  border: /border|outline|stroke|divider/i,
}

/**
 * Pick the best token for a cluster + authoring property.
 * @param {string} prop @param {import('../../types.js').Cluster} cluster
 * @param {import('../../types.js').TokenProposal[]} tokens
 * @returns {import('../../types.js').TokenProposal|null}
 */
/** Which component-token role an authored property maps to (bg, text, border, radius, shadow, icon). */
export function componentRole(prop) {
  const p = String(prop).toLowerCase()
  if (p === 'fill' || p === 'stroke') return 'icon'
  const kind = propKind(p)
  if (kind === 'radius') return 'radius'
  if (kind === 'shadow') return 'shadow'
  return propRole(p) // bg | text | border | null
}

export function pickToken(prop, cluster, tokens, components = []) {
  const candidates = tokens.filter((t) => Array.isArray(t.clusters) && t.clusters.includes(cluster.id))
  if (!candidates.length) return null
  // Inside a rule for a detected component (e.g. `.btn { … }`), prefer that component's token for this role.
  const role = componentRole(prop)
  if (role && components.length) {
    const hit = candidates.find((t) => t.tier === 'component' && components.some((c) => t.name === `${c}.${role}` || t.name.startsWith(`${c}.`) && t.name.endsWith(`.${role}`)))
    if (hit) return hit
  }
  const semRole = propRole(prop)
  const roleRe = semRole && ROLE_RE[semRole]
  if (roleRe) {
    const hit = candidates.find((t) => t.tier !== 'primitive' && roleRe.test(t.name))
    if (hit) return hit
  }
  const semantic = candidates.find((t) => t.tier === 'semantic')
  if (semantic) return semantic
  const component = candidates.find((t) => t.tier === 'component')
  if (component) return component
  return candidates.find((t) => t.tier === 'primitive') || candidates[0]
}

/** Find the cluster (of `kind`) whose members include `normalized`, or null. */
function clusterFor(kind, normalized, clusters) {
  return clusters.find((c) => c.kind === kind && c.members.some((m) => m.value === normalized)) || null
}

const DECL_RE = /([a-zA-Z-]+)(\s*:\s*)([^;{}]+)(;)/g

/**
 * Rewrite one CSS source string.
 * @param {string} source @param {string} relFile
 * @param {import('../../types.js').Cluster[]} clusters
 * @param {import('../../types.js').TokenProposal[]} tokens
 * @returns {{code:string, edits:import('../../types.js').RewriteEdit[], changed:boolean}}
 */
/**
 * Selector-aware context: which detected components the rule around each declaration styles. Walks braces so nested
 * blocks (@media) work; returns a function (lineIdx, col) → component labels. Pure; exported for tests.
 */
export function selectorContext(source, classIdx) {
  const lines = source.split('\n')
  const startStack = []
  const stack = []
  let pending = ''
  for (const line of lines) {
    startStack.push({ stack: [...stack], pending })
    for (const ch of line) {
      if (ch === '{') { stack.push(pending.trim()); pending = '' }
      else if (ch === '}') { stack.pop(); pending = '' }
      else if (ch === ';') pending = ''
      else pending += ch
    }
    pending += ' '
  }
  return (lineIdx, col) => {
    if (!classIdx || !classIdx.size) return []
    const st = startStack[lineIdx]
    const s2 = [...st.stack]
    let pend = st.pending
    for (const ch of lines[lineIdx].slice(0, col)) {
      if (ch === '{') { s2.push(pend.trim()); pend = '' }
      else if (ch === '}') { s2.pop(); pend = '' }
      else if (ch === ';') pend = ''
      else pend += ch
    }
    return componentsForSelector(s2.join(' '), classIdx)
  }
}

export function rewriteCss(source, relFile, clusters, tokens, classIdx = null) {
  const ctxAt = selectorContext(source, classIdx)
  const lines = source.split('\n')
  const edits = []
  let changedAny = false
  const outLines = lines.map((line, idx) => {
    let out = ''
    let last = 0
    let lineChanged = false
    let m
    DECL_RE.lastIndex = 0
    while ((m = DECL_RE.exec(line))) {
      const [full, propRaw, sep, value, semi] = m
      const prop = propRaw.trim().toLowerCase()
      const kind = propKind(prop)
      out += line.slice(last, m.index)
      if (!kind) {
        out += full
        last = m.index + full.length
        continue
      }
      const parts = valueParts(kind, value)
      let newValue = value
      // Replace back-to-front so offsets stay valid.
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i]
        if (/^var\(/i.test(part.text)) continue
        const normalized = normalizeFor(kind, part.text)
        if (!normalized) continue
        const cluster = clusterFor(kind, normalized, clusters)
        if (!cluster) continue
        const token = pickToken(prop, cluster, tokens, ctxAt(idx, m.index))
        if (!token) continue
        const cssVar = cssVarOf(token.name)
        const after = `var(${cssVar}, ${part.text})`
        newValue = newValue.slice(0, part.start) + after + newValue.slice(part.end)
        edits.push({ file: relFile, line: idx + 1, prop, before: part.text, after, token: token.name })
        lineChanged = true
      }
      out += propRaw + sep + newValue + semi
      last = m.index + full.length
    }
    out += line.slice(last)
    if (lineChanged) changedAny = true
    return out
  })
  return { code: outLines.join('\n'), edits, changed: changedAny }
}

/** Folders never copied or rewritten (real apps carry these). */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.sorb', '.cache'])

/**
 * Vue single-file components: run each <style> block through rewriteCss, keeping line numbers.
 * Blocks with lang="scss|sass|less|stylus" are skipped (not plain CSS).
 */
export function rewriteVue(source, relFile, clusters, tokens, classIdx = null) {
  const edits = []
  let changed = false
  const code = source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, body, close, offset) => {
    if (/\blang\s*=\s*["'](scss|sass|less|stylus)["']/i.test(open)) return m
    const lineOffset = source.slice(0, offset + open.length).split('\n').length - 1
    const r = rewriteCss(body, relFile, clusters, tokens, classIdx)
    if (!r.changed) return m
    changed = true
    for (const e of r.edits) edits.push({ ...e, line: e.line + lineOffset })
    return open + r.code + close
  })
  return { code, edits, changed }
}

/** Recursively list files under dir (relative paths, posix separators). */
function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, base))
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out
}

/** Build a simple unified-ish per-file diff from changed (line, oldLine, newLine) triples. */
function buildDiff(file, oldLines, newLines) {
  const rows = []
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      rows.push(`- ${oldLines[i] ?? ''}`)
      rows.push(`+ ${newLines[i] ?? ''}`)
    }
  }
  if (!rows.length) return ''
  return `--- a/${file}\n+++ b/${file}\n${rows.join('\n')}\n`
}

/**
 * @type {import('../../types.js').CoderProvider}
 */
export default function deterministicCoder() {
  return {
    id: 'deterministic',
    /** @param {{targetDir:string, tokens:import('../../types.js').TokenSet, clusters:import('../../types.js').Cluster[], write:boolean, runDir:string}} input */
    async rewrite({ targetDir, tokens, clusters, components = [], write, runDir }) {
      const classIdx = classIndex(components)
      const outDir = join(runDir, 'rewritten')
      rmSync(outDir, { recursive: true, force: true })
      mkdirSync(runDir, { recursive: true })
      // A single file target (e.g. src/assets/css/argon-dashboard-react.css) rewrites just that file, so a PR
      // doesn't also touch minified copies or unrelated stylesheets sitting next to it.
      if (statSync(targetDir).isFile()) {
        mkdirSync(outDir, { recursive: true })
        cpSync(targetDir, join(outDir, basename(targetDir)))
      } else {
        // Copy the whole site (built folders like assets/js/dist included) so verify serves a complete page; only the
        // walk below skips SKIP_DIRS. Skipping dist here hid Chirpy's scripts and failed verify (L2: 44,885 px).
        cpSync(targetDir, outDir, { recursive: true, filter: (src) => !/^(node_modules|\.git)$/.test(basename(src)) })
      }

      const files = walk(outDir).filter((f) => extname(f) === '.css' || extname(f) === '.vue' || JSX_EXT.test(f) || SVG_HTML_EXT.test(f))
      // JSX/JS files go through @sorb/seed's detector + codemod with the same token choice as CSS.
      const pickFor = (kind, prop, value) => {
        const cluster = clusterFor(kind, value, clusters)
        const token = cluster && pickToken(prop, cluster, tokens.tokens || [])
        return token ? { cssVar: cssVarOf(token.name), token: token.name } : null
      }
      const allEdits = []
      const changedFiles = []
      let diffText = ''

      for (const relFile of files) {
        const abs = join(outDir, relFile)
        const original = readFileSync(abs, 'utf-8')
        let code, edits, changed
        if (extname(relFile) === '.vue') {
          ;({ code, edits, changed } = rewriteVue(original, relFile, clusters, tokens.tokens || [], classIdx))
        } else if (JSX_EXT.test(relFile) || SVG_HTML_EXT.test(relFile)) {
          const r = JSX_EXT.test(relFile) ? rewriteJsx(original, relFile, pickFor) : rewriteSvgAttrs(original, relFile, pickFor)
          code = r.code
          edits = r.edits.map((e) => ({ file: relFile, ...e }))
          changed = edits.length > 0
        } else {
          ;({ code, edits, changed } = rewriteCss(original, relFile, clusters, tokens.tokens || [], classIdx))
        }
        if (!changed) continue
        changedFiles.push(relFile)
        allEdits.push(...edits)
        diffText += buildDiff(relFile, original.split('\n'), code.split('\n'))
        if (write) writeFileSync(abs, code)
      }

      writeFileSync(join(runDir, 'rewrite.diff'), diffText)

      return {
        coder: 'deterministic',
        edits: allEdits,
        files: changedFiles,
        written: !!write,
        outDir,
      }
    },
  }
}
