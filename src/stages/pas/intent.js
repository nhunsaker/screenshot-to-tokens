// Point and say, model path: Muse Spark Open (Baseten; hosted Muse Spark as fallback, via playground.museProviders)
// maps a spoken request about the clicked control to TOKEN changes only (alias to an existing token preferred, else a
// value). The reply is sanitized (contrast.sanitizeProposal) and restricted to tokens that touch the clicked element or
// its twins; anything else is rejected, never applied. Data sent: token names/values, the transcript, element text.
import { chat, extractJson } from '../../providers/llm/chat.js'
import { museProviders } from '../playground.js'
import { sanitizeProposal } from '../../preview-client/contrast.js'

export const INTENT_SYSTEM = `You turn a designer's spoken request about one clicked UI element into DESIGN TOKEN changes (never raw CSS).
CHANGEABLE lists the only tokens you may change (they style the clicked element and its look-alikes). TOKENS lists every
token you may point an alias at. Prefer re-pointing a token's alias to an existing semantic/component token over
inventing a value. If the request is already satisfied, return no changes and say so.
Reply JSON only: {"changes":[{"token":"<name from CHANGEABLE>","alias":"<name from TOKENS>"|null,"value":"<#rrggbb>"|null,"why":"<short>"}],"affects":"<one line on which elements change>"}`

/** Chat messages for the mapping. Pure. */
export function intentMessages({ transcript, clicked, changeable, tokens }) {
  const user = JSON.stringify({
    transcript: String(transcript || '').slice(0, 400),
    clicked,
    CHANGEABLE: changeable,
    TOKENS: tokens.map((t) => ({ name: t.name, tier: t.tier, alias: t.alias || null, value: t.value || null })),
  })
  return [{ role: 'system', content: INTENT_SYSTEM }, { role: 'user', content: user }]
}

/**
 * Validate a mapping reply: sanitize against every known token (alias targets), then keep only changes to tokens in
 * `changeable`. Pure.
 * @returns {{changes:Array<object>, rejected:Array<object>, affects:string}}
 */
export function restrictProposal(raw, { known, changeable }) {
  const items = raw && Array.isArray(raw.changes) ? raw.changes : []
  const asSanitizable = { changes: items.map((c) => c && ({ token: c.token, value: c.alias || c.value, reason: c.why || c.reason })) }
  const s = sanitizeProposal(asSanitizable, { known, allowAlias: true })
  const allow = new Set(changeable)
  const changes = s.changes.filter((c) => allow.has(c.token))
  const rejected = s.rejected.concat(s.changes.filter((c) => !allow.has(c.token)).map((c) => ({ token: c.token, value: c.value, why: 'does not touch the clicked element or its twins' })))
  return { changes, rejected, affects: String((raw && raw.affects) || '').replace(/[<>]/g, '').slice(0, 300) }
}

/** Ask Muse; provider failover as in the playground. Returns the restricted proposal + provider + ms. */
export async function museIntent(req, { provider = 'baseten', chatFn = chat } = {}) {
  const providers = museProviders(provider)
  if (!providers.length) throw new Error('no Muse Spark key (Baseten or Meta)')
  const messages = intentMessages(req)
  const errors = []
  for (const p of providers) {
    const t0 = Date.now()
    try {
      const r = await chatFn({ baseURL: p.baseURL, apiKey: p.apiKey, model: p.model, messages, json: true, reasoningEffort: 'low', timeoutMs: 60000 })
      const raw = extractJson(r.text)
      const out = restrictProposal(raw, { known: req.tokens.map((t) => t.name), changeable: req.changeable })
      return { ...out, raw, provider: p.id, model: p.model, ms: Date.now() - t0, cached: !!r.cached }
    } catch (e) { errors.push(`${p.id}: ${String(e.message || e).slice(0, 160)}`) }
  }
  throw new Error(errors.join(' | '))
}
