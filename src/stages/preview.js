// Preview: wire our emitted TokenSet into Sorb's live bridge so a person can
// nudge one token and see it in the running app with no rebuild — the demo
// beat after rewrite/verify. See docs/sorb-preview.md for the full writeup
// (endpoints, config shape, steps per app type).
//
// Deliberately dependency-free: no `@sorb/*` package is installed in this repo
// (hackathon rule — published packages only, and we're not adding any here),
// so this talks to a running `sorb dev` bridge purely over HTTP (global
// `fetch`) and reproduces the shared @sorb/core `ResolvedToken` shape as a
// plain JSDoc typedef rather than an import.
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { cssVarOf } from '../lib/props.js'
import { cssValue } from './emit.js'
import { resolveValue } from './name.js'

/**
 * Sorb's resolved-token shape (`@sorb/core` `ResolvedToken` / `ResolvedMap`,
 * sorb-core/src/types.js): `{ id, cssVar, value, tier, type }[]`. `tier` reuses
 * our own vocabulary byte-for-byte ('primitive'|'semantic'|'component'). `type`
 * is DTCG-ish ('color'|'dimension'|'fontFamily'|'fontWeight'|'number'|'string')
 * and has NO 'shadow' entry — our 'shadow' cluster kind has no exact match, so
 * it maps to 'string' (nearest fit; flagged in docs/sorb-preview.md).
 * @typedef {Object} SorbResolvedToken
 * @property {string} id
 * @property {string} cssVar
 * @property {string|number} value
 * @property {string} tier
 * @property {string} type
 */

const SORB_TYPE = {
  color: 'color',
  radius: 'dimension',
  space: 'dimension',
  'font-size': 'dimension',
  'line-height': 'dimension',
  'font-weight': 'fontWeight',
  'font-family': 'fontFamily',
  shadow: 'string', // no DTCG "shadow" $type in @sorb/core's TokenType — nearest fit
}

/**
 * Our TokenSet → Sorb's resolved bindable token map. Pure (no I/O). Aliases are
 * followed to a literal (ResolvedToken.value must carry "no var() chains", per
 * the @sorb/core contract) using the same `resolveValue` the name stage uses to
 * validate alias chains, so an unresolved/cyclic alias can never reach here.
 * `clusters` is optional and only used to guess each token's DTCG `$type` from
 * its Cluster.kind (mirrors `toDtcg` in emit.js) — omit it and every token's
 * type falls back to `'string'`.
 *
 * @param {import('../types.js').TokenSet} tokenSet
 * @param {import('../types.js').Cluster[]} [clusters]
 * @returns {SorbResolvedToken[]}
 */
export function toSorbTokens(tokenSet, clusters = []) {
  const kindOf = new Map(clusters.map((c) => [c.id, c.kind]))
  const tokens = tokenSet.tokens || []
  return tokens.map((t) => {
    const raw = t.value != null ? t.value : resolveValue(t.name, tokens)
    const kind = t.clusters && t.clusters.length ? kindOf.get(t.clusters[0]) : undefined
    return {
      id: t.name,
      cssVar: cssVarOf(t.name),
      value: raw == null ? '' : cssValue(raw),
      tier: t.tier,
      type: SORB_TYPE[kind] || 'string',
    }
  })
}

/**
 * Propose a live token preview against a running `sorb-juice` bridge
 * (`sorb dev`, default `http://localhost:7777`) — the same `POST /preview`
 * route the Figma plugin posts to. The bridge stores the raw JSON body
 * verbatim and returns a short id; opening the app at `<appUrl>${url}` (the
 * returned `?preview=<id>` query string) shows it live via the leaf SDK's
 * poll/SSE loop, no rebuild.
 *
 * Pass either a single `{tokenName, value}` (the demo's "nudge one token"
 * beat, e.g. `color.action.primary`) or a full `tokens` map; not both. Token
 * keys are sent WITHOUT the leading `--` (CSS custom-property names), e.g.
 * `"color-action-primary"` — `cssVarOf(name).slice(2)` if you're starting from
 * our dotted names (see `toSorbTokens`/`cssVarOf`).
 *
 * @param {{
 *   bridgeUrl: string,
 *   tokenName?: string,
 *   value?: string|number,
 *   tokens?: Record<string, string|number>,
 *   key?: string,
 * }} o  `key`: optional Bearer key for a hosted bridge; omit for local `sorb dev` (unauthenticated).
 * @returns {Promise<{id: string, url: string}>}
 */
export async function proposePreview({ bridgeUrl, tokenName, value, tokens, key }) {
  if (!bridgeUrl) throw new Error('proposePreview needs {bridgeUrl} (e.g. http://localhost:7777)')
  const body = tokens || (tokenName != null && value != null ? { [tokenName]: value } : null)
  if (!body || Object.keys(body).length === 0) {
    throw new Error('proposePreview needs either {tokens: {...}} or {tokenName, value}')
  }
  if (typeof fetch !== 'function') {
    throw new Error('proposePreview needs global fetch (Node >=18); this process has none')
  }
  const base = String(bridgeUrl).replace(/\/$/, '')
  const headers = { 'content-type': 'application/json' }
  if (key) headers.authorization = `Bearer ${key}`
  let res
  try {
    // POST /preview stores the raw request body AS the tokens map (no
    // {tokens: ...} wrapper) — confirmed against sorb-juice/src/server.js.
    res = await fetch(`${base}/preview`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (e) {
    throw new Error(`proposePreview: could not reach bridge at ${base} — is \`sorb dev\` running? (${e.message})`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`proposePreview: bridge rejected the proposal (HTTP ${res.status}): ${text || res.statusText}`)
  }
  const json = await res.json()
  return { id: json.id, url: `${base}${json.url || `?preview=${json.id}`}` }
}

/**
 * Write a starter `sorb.config.json` for a target app — the exact shape
 * `sorb init` writes (sorb-juice README "Configure it with sorb.config.json").
 * Idempotent like `sorb init`: refuses to clobber an existing file unless
 * `opts.overwrite` is true.
 *
 * @param {string} runDir  Directory to write `sorb.config.json` into (the target app's root).
 * @param {{
 *   namespace?: string,
 *   tokenSources?: string[],
 *   port?: number,
 *   appUrl?: string,
 *   gh?: string,
 *   figmaFileKey?: string,
 *   styleDictionaryConfig?: string,
 *   overwrite?: boolean,
 * }} [opts]
 * @returns {{path: string, written: boolean}}
 */
export function writeSorbConfig(runDir, opts = {}) {
  const dir = resolve(runDir)
  const path = join(dir, 'sorb.config.json')
  if (existsSync(path) && !opts.overwrite) return { path, written: false }
  /** @type {Record<string, unknown>} */
  const config = {
    namespace: opts.namespace || 's2t-demo',
    tokenSources: opts.tokenSources && opts.tokenSources.length ? opts.tokenSources : ['tokens.json'],
    port: opts.port || 7777,
    appUrl: opts.appUrl || '',
    gh: opts.gh || '',
  }
  if (opts.figmaFileKey) config.figmaFileKey = opts.figmaFileKey
  if (opts.styleDictionaryConfig) config.styleDictionaryConfig = opts.styleDictionaryConfig
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
  return { path, written: true }
}
