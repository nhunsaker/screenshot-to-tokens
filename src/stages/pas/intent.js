// Point and say, model path: Muse Spark Open (Baseten, then Fireworks, then hosted Muse Spark: the namer's failover
// chain) maps a spoken request about the clicked control to TOKEN changes only (alias to an existing token preferred,
// else a value). CHANGEABLE is the set of tokens the sentinel probe found controlling the clicked element and its
// twins, never a value match. The reply is sanitized (contrast.sanitizeProposal), restricted to CHANGEABLE, then
// refined: alias targets move to the semantic token with the same value (color.blue.500 -> color.action.primary),
// changes aimed at a primitive in the element's chain move to the nearest non-primitive, and changes already in place
// are kept as no-ops. Data sent: token names/values, the transcript, the element's text and colours.
import { chat, extractJson } from '../../providers/llm/chat.js'
import { LLM_PRESETS } from '../../config.js'
import { namerChain } from '../../providers/llm/llm-namer.js'
import { sanitizeProposal, cssVarName, parseColor, toHex } from '../../preview-client/contrast.js'

export const INTENT_SYSTEM = `You turn a designer's spoken request about one clicked UI element into DESIGN TOKEN changes (never raw CSS).
CHANGEABLE lists the only tokens you may change: the tokens that style the clicked element and its look-alikes, with the
property each controls; "nearest" marks the token the element uses directly. Change the nearest token, not a primitive
further down the chain. TOKENS lists every token you may point an alias at. Prefer an alias to an existing SEMANTIC token
(for example color.action.primary for "our brand blue", color.text.muted for "our gray") over a primitive (color.blue.500)
or a new value. Radius values are px. If the request is already satisfied, still return the change that states it (the
alias the token already has), so the person sees which token carries it.
Reply JSON only: {"changes":[{"token":"<name from CHANGEABLE>","alias":"<name from TOKENS>"|null,"value":"<#rrggbb or Npx>"|null,"why":"<short>"}],"affects":"<one line on which elements change>"}`

/** Chat messages for the mapping. Pure. */
export function intentMessages({ transcript, clicked, changeable, tokens }) {
  const user = JSON.stringify({
    transcript: String(transcript || '').slice(0, 400),
    clicked,
    CHANGEABLE: changeable,
    TOKENS: tokens.map((t) => ({ name: t.name, tier: t.tier, kind: t.kind, alias: t.alias || null, value: t.value || null })),
  })
  return [{ role: 'system', content: INTENT_SYSTEM }, { role: 'user', content: user }]
}

const PX = /^(\d{1,3}(\.\d+)?)px$/

/**
 * Validate a mapping reply: sanitize against every known token (alias targets), then keep only changes to tokens in
 * `changeable` (names, or {name} objects). Radius tokens (`radiusTokens`) take a px value or a radius alias. Pure.
 * @returns {{changes:Array<object>, rejected:Array<object>, affects:string}}
 */
export function restrictProposal(raw, { known, changeable, radiusTokens = [] }) {
  const items = raw && Array.isArray(raw.changes) ? raw.changes : []
  const radius = new Set(radiusTokens)
  const colorItems = items.filter((c) => !(c && radius.has(c.token)))
  const asSanitizable = { changes: colorItems.map((c) => c && ({ token: c.token, value: c.alias || c.value, reason: c.why || c.reason })) }
  const s = sanitizeProposal(asSanitizable, { known: known.filter((n) => !radius.has(n)), allowAlias: true })
  for (const c of items.filter((x) => x && radius.has(x.token))) {
    const v = String(c.alias || c.value || '').trim()
    const reason = String(c.why || c.reason || '').replace(/[<>]/g, '').slice(0, 300)
    if (PX.test(v)) s.changes.push({ token: c.token, cssVar: cssVarName(c.token), value: v, css: v, reason, isNew: false })
    else if (radius.has(v) && v !== c.token) s.changes.push({ token: c.token, cssVar: cssVarName(c.token), value: v, css: `var(--${cssVarName(v)})`, reason, isNew: false })
    else s.rejected.push({ token: String(c.token).slice(0, 80), value: v.slice(0, 80), why: 'not a radius' })
  }
  const allow = new Set((changeable || []).map((c) => (typeof c === 'string' ? c : c.name)))
  const changes = s.changes.filter((c) => allow.has(c.token))
  const rejected = s.rejected.concat(s.changes.filter((c) => !allow.has(c.token)).map((c) => ({ token: c.token, value: c.value, why: 'does not touch the clicked element or its twins' })))
  return { changes, rejected, affects: String((raw && raw.affects) || '').replace(/[<>]/g, '').slice(0, 300) }
}

const TIER_RANK = { semantic: 0, component: 1, primitive: 2 }
const prefRank = (t) => (t.name === 'color.action.primary' ? -2 : /^color\.action\./.test(t.name) ? -1 : TIER_RANK[t.tier] ?? 3)

/** Resolve a token's value through aliases. Pure. */
export function resolveValue(name, byName) {
  const seen = new Set()
  for (let t = byName.get(name); t && !seen.has(t.name); t = byName.get(t.alias)) {
    seen.add(t.name)
    if (t.value != null) return String(t.value)
  }
  return null
}

const sameColor = (a, b) => { const x = parseColor(a), y = parseColor(b); return !!(x && y && x.r === y.r && x.g === y.g && x.b === y.b && Math.abs(x.a - y.a) < 0.01) }

/**
 * The semantic token to alias instead of `target` (a token name or a colour): one whose resolved value equals it, best
 * by action > semantic > component; only if it ranks above `target`. Never the token being changed, and never a token
 * that (through aliases) points back at it (a cycle). Pure.
 */
export function preferSemantic(target, { tokens, changing }) {
  const byName = new Map(tokens.map((t) => [t.name, t]))
  const self = byName.get(target)
  const value = self ? resolveValue(target, byName) : target
  if (!value || !parseColor(value)) return null
  const pointsAt = (name, goal) => { const seen = new Set(); for (let t = byName.get(name); t && !seen.has(t.name); t = byName.get(t.alias)) { if (t.name === goal) return true; seen.add(t.name) } return false }
  const cands = tokens.filter((t) => t.kind !== 'radius' && t.name !== changing && t.name !== target && !pointsAt(t.name, changing) && sameColor(resolveValue(t.name, byName), value))
    .sort((a, b) => prefRank(a) - prefRank(b))
  const best = cands[0]
  if (!best) return null
  if (self && prefRank(best) >= prefRank(self)) return null
  return best.name
}

/**
 * Refine restricted changes into contract change items: semantic alias targets, primitives moved to the nearest
 * non-primitive in the clicked element's chain, no-ops marked. Pure.
 * @param {Array<{token:string, value:string, css:string, reason:string, isNew?:boolean}>} changes from restrictProposal
 * @param {{tokens:{name:string, tier:string, kind?:string, alias?:string|null, value?:string|null}[], chains?:string[][]}} o
 *   chains = the sentinel chains (nearest first) of the clicked element and its twins
 */
export function refineChanges(changes, { tokens, chains = [] }) {
  const byName = new Map(tokens.map((t) => [t.name, t]))
  const out = []
  const seen = new Set()
  for (const c of changes) {
    let token = c.token
    let retargeted = null
    const t = byName.get(token)
    if (t && t.tier === 'primitive') {
      const chain = chains.find((ch) => ch.includes(token))
      const nearer = chain && chain.slice(0, chain.indexOf(token)).find((n) => byName.get(n) && byName.get(n).tier !== 'primitive')
      if (nearer) { retargeted = token; token = nearer }
    }
    if (seen.has(token)) continue
    seen.add(token)
    const kind = byName.get(token) && byName.get(token).kind
    const ref = String(c.css).match(/^var\(--([a-z0-9-]+)\)$/i)
    let alias = ref ? (tokens.find((x) => cssVarName(x.name) === ref[1]) || {}).name || null : null
    let value = alias ? null : c.css
    let aliasPreferred = null
    if (kind !== 'radius') {
      const better = preferSemantic(alias || value, { tokens, changing: token })
      if (better) { aliasPreferred = alias || value; alias = better; value = null }
    }
    const from = resolveValue(token, byName)
    const cur = byName.get(token)
    const newValue = alias ? resolveValue(alias, byName) : value
    const noop = !!(cur && ((alias && cur.alias === alias) || (!alias && from && newValue && (sameColor(from, newValue) || from === newValue))))
    const item = {
      token, cssVar: cssVarName(token), value: value && parseColor(value) ? (parseColor(value).a < 1 ? value : toHex(parseColor(value))) : value, alias,
      css: alias ? `var(--${cssVarName(alias)})` : c.css, from, why: c.reason || '',
    }
    if (aliasPreferred) item.aliasPreferred = aliasPreferred
    if (retargeted) item.retargetedFrom = retargeted
    if (noop) item.noop = true
    if (c.isNew) item.isNew = true
    out.push(item)
  }
  return out
}

/** Muse providers in the namer's failover order (Baseten -> Fireworks -> hosted), keys present, never "-contributor". */
export function intentProviders(first = 'baseten', env) {
  return namerChain(first, env).map((id) => LLM_PRESETS[id]()).filter((p) => p.apiKey && p.model && p.id !== 'ollama' && !/-contributor$/i.test(p.model))
}

/**
 * Ask Muse; provider failover. Returns the restricted, refined proposal + provider + ms.
 * @param {{transcript:string, clicked:object, changeable:Array<string|object>, tokens:object[], chains?:string[][]}} req
 */
export async function museIntent(req, { provider = 'baseten', chatFn = chat, providers } = {}) {
  const list = providers || intentProviders(provider)
  if (!list.length) throw new Error('no Muse Spark key (Baseten, Fireworks or Meta)')
  const messages = intentMessages(req)
  const radiusTokens = req.tokens.filter((t) => t.kind === 'radius').map((t) => t.name)
  const errors = []
  for (const p of list) {
    const t0 = Date.now()
    try {
      const r = await chatFn({ baseURL: p.baseURL, apiKey: p.apiKey, model: p.model, messages, json: true, reasoningEffort: 'low', timeoutMs: 45000 })
      const raw = extractJson(r.text)
      const out = restrictProposal(raw, { known: req.tokens.map((t) => t.name), changeable: req.changeable, radiusTokens })
      const changes = refineChanges(out.changes, { tokens: req.tokens, chains: req.chains || [] })
      return { changes, rejected: out.rejected, affects: out.affects, raw, provider: p.id, model: p.model, ms: Date.now() - t0, cached: !!r.cached, errors }
    } catch (e) { errors.push(`${p.id}: ${String(e.message || e).slice(0, 160)}`) }
  }
  throw new Error(errors.join(' | '))
}
