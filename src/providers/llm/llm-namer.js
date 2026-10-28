// Model namer: Muse Spark (meta), local Llama (ollama) or Fireworks, all via one
// OpenAI-compatible client. The model gets the clusters plus the heuristic draft and
// returns a refined TokenSet; validateTokenSet() repairs or rejects what comes back.
import { readFileSync, existsSync } from 'fs'
import { LLM_PRESETS } from '../../config.js'
import { chat, extractJson } from './chat.js'
import { heuristicTokens, fillSemanticGaps, fillOnSurfaceTextTokens } from './heuristic.js'

export const SYSTEM_PROMPT = `You are a design-systems engineer naming design tokens for an app that has none.
You get CLUSTERS of near-duplicate style values found on the page (with how often and where each is used)
and a DRAFT token set. Return an improved token set as JSON only, no prose:
{"tokens":[{"name":"color.blue.600","tier":"primitive","value":"#1a73e8ff","clusters":["color-04"],"why":"..."},
 {"name":"color.action.primary","tier":"semantic","alias":"color.blue.600","clusters":["color-04"],"why":"..."}]}
Rules:
- Three tiers. primitive = raw value, named by what it is (color.blue.600, space.16, radius.md).
  semantic = purpose, aliases a primitive (color.text.muted, color.surface.raised, color.border.default).
  component = one component's use, aliases a primitive or semantic (button.radius, card.shadow).
  A component token may also be scoped to a state the capture observed on it (active/disabled/selected/current),
  named <component>.<state>.<role> (e.g. nav.active.bg) — only when the CLUSTERS/COMPONENTS data shows that
  exact state actually uses that value.
- Every cluster id must be covered by exactly one primitive. Copy primitive values from the cluster "value" exactly.
- Semantic and component tokens use "alias" (an existing token name), never "value".
- Names: lower case, dot separated, no spaces. Keep draft names unless a better one is clearly justified.
- "why" is one short sentence a designer would accept, grounded in the usage counts and regions given.
- Do not invent clusters, values or regions.
- Optional "merges": [{"from":"radius-02","into":"radius-01","why":"..."}] for clusters you think are the same
  design decision drifted apart but too far apart to merge automatically. A person accepts or rejects each one.
  Never suggest merging font sizes or line heights from different steps of a type scale.`

// Compact mode (default): the model returns only what it adds. Primitives come from the deterministic draft
// (values, coverage and count-based reasons are ours); the model renames primitives where a better name is clear
// and writes the semantic/component layer with reasons. Output drops from about 14k tokens to about 1-2k, which
// is most of the latency and cost (naming was 87% of both). S2T_NAMER_MODE=full restores the old contract.
export const COMPACT_PROMPT = `You are a design-systems engineer naming design tokens for an app that has none.
You get CLUSTERS of near-duplicate style values found on the page (with how often and where each is used) and
DRAFT primitive names (one per cluster). Return JSON only, no prose, in exactly this shape:
{"rename":{"<cluster id>":"<better primitive name>"},
 "tokens":[{"name":"color.action.primary","tier":"semantic","alias":"<primitive or semantic name>","clusters":["color-04"],"why":"..."}],
 "merges":[{"from":"radius-02","into":"radius-01","why":"..."}]}
Rules:
- "rename": only clusters whose draft primitive name is clearly wrong or unclear; omit the rest. Primitive names say
  what the value is (color.blue.600, space.16, radius.md).
- "tokens": semantic (purpose) and component tokens only. Each aliases an existing primitive name (after your
  renames) or another of your tokens. Check EACH of these roles against the usage data and include it if the
  evidence supports it (do not force a role with no support, but low effort is not a reason to skip one that has
  it): color.action.primary (button background); color.text.default, color.text.muted, color.text.inverse (text
  on a colored/dark background, e.g. inside buttons); color.text.on-primary / color.text.on-dark (a text color
  whose usage sits mostly on the action color or on a dark/colored card other than the page background - give
  it its own token, never reuse color.surface.* or a surface's primitive for a "color:" role just because the
  raw value matches); color.surface.default, color.surface.card (page vs. card
  background); color.border.default; color.status.success/warning/danger/info (only when badge/alert backgrounds
  show 2+ distinct hue families - one color alone is not a status palette); color.focus.ring (only if a focus
  outline/ring color is actually present in the data).
- Component tokens: for each entry in COMPONENTS, name <component>.<role> (roles: bg, text, border, radius, shadow,
  icon), e.g. button.bg, input.border, card.shadow, nav.bg. Alias the semantic token for that value when one exists
  (button.bg -> color.action.primary), else the primitive. Only use clusters listed in that component's "uses".
- State tokens: when a COMPONENTS entry has a "states" map (active/disabled/selected/current — the states
  a static capture can actually see, e.g. the one nav-link carrying Bootstrap's "active" class), name
  <component>.<state>.<role> (e.g. nav.active.bg, link.active.text) from that state's own "uses", the same way
  as a plain component token. Only use clusters listed under that state; never reuse a different state's or the
  component's overall clusters for it.
- "why": one short sentence grounded only in the usage counts, properties and regions given. Do not quote numbers
  from token names.
- Names: lower case, dot separated, no spaces. Do not invent clusters, values or regions.
- "merges" (optional): clusters that look like the same design decision drifted apart. Never different font sizes
  or line heights from a type scale.`

/**
 * Expand a compact reply into a full TokenSet: draft primitives (renamed where asked) + the model's tokens.
 * Pure; exported for tests.
 */
export function expandCompact(parsed, draft) {
  const rename = parsed && typeof parsed.rename === 'object' && parsed.rename ? parsed.rename : {}
  const nameMap = new Map()
  const prims = draft.tokens.filter((t) => t.tier === 'primitive').map((t) => {
    const to = rename[t.clusters[0]]
    const name = typeof to === 'string' && to.trim() ? to.trim() : t.name
    nameMap.set(t.name, name)
    return { ...t, name }
  })
  const extra = (Array.isArray(parsed?.tokens) ? parsed.tokens : [])
    .filter((t) => t && t.tier !== 'primitive')
    .map((t) => ({ ...t, alias: nameMap.get(t.alias) || t.alias }))
  return { tokens: [...prims, ...extra], renamed: Object.keys(rename).length }
}

/** Compact cluster view for the prompt (keeps tokens small for local models). */
export function promptPayload(clusters, regions, draft, components = []) {
  const regionCounts = {}
  for (const r of regions) regionCounts[r.label] = (regionCounts[r.label] || 0) + 1
  return {
    regions: regionCounts,
    clusters: clusters.map((c) => ({
      id: c.id, kind: c.kind, value: c.value, uses: c.count,
      merged: c.members.length > 1 ? c.members.map((m) => m.value) : undefined,
      props: c.props, in: c.regionLabels,
    })),
    draft: draft.tokens.map(({ name, tier, value, alias, clusters }) => ({ name, tier, value, alias, clusters })),
    draftPrimitives: Object.fromEntries(draft.tokens.filter((t) => t.tier === 'primitive').map((t) => [t.clusters[0], t.name])),
    draftMerges: draft.merges || [],
    // Detected components and the clusters each one uses, per property (the basis for the third tier).
    components: (components || []).map((p) => ({ component: p.component, regions: p.regions,
      uses: Object.fromEntries(Object.entries(p.props).map(([prop, list]) => [prop, list.map((x) => x.cluster)])),
      // Which observable states (active/disabled/selected/current) this component's own roots carry, and the
      // clusters each state's roots use per property — the basis for the fourth-tier state tokens.
      states: Object.fromEntries(Object.entries(p.states || {}).map(([state, info]) => [state,
        Object.fromEntries(Object.entries(info.props).map(([prop, list]) => [prop, list.map((x) => x.cluster)]))])) })),
  }
}

const LOW_EFFORT = new Set(['meta', 'baseten', 'fireworks'])

/**
 * The providers to try, in order: the chosen one, then S2T_NAMER_FALLBACK (comma list; "none" disables). Default
 * for the open-weights namer: the same Muse Spark Open on Fireworks, then hosted Muse Spark. Pure; exported for tests.
 * @param {string} presetId
 * @param {string} [env]
 */
export function namerChain(presetId, env = process.env.S2T_NAMER_FALLBACK) {
  const defaults = { baseten: ['fireworks', 'meta'], fireworks: ['baseten', 'meta'] }
  const extra = env === 'none' ? [] : env ? env.split(',').map((x) => x.trim()).filter(Boolean) : defaults[presetId] || []
  return [presetId, ...extra.filter((id, i, a) => id !== presetId && a.indexOf(id) === i && LLM_PRESETS[id])]
}

/**
 * @param {'meta'|'ollama'|'fireworks'|'baseten'} presetId
 * @returns {import('../../types.js').NamerProvider}
 */
export default function llmNamer(presetId) {
  const preset = LLM_PRESETS[presetId]
  if (!preset) throw new Error(`unknown namer preset: ${presetId}`)
  return {
    id: presetId,
    async name({ clusters, regions, screenshotPath, components, capture }) {
      const cfg = preset()
      if (presetId !== 'ollama' && !cfg.apiKey) {
        throw new Error(`${presetId} namer not configured: set its API key (Meta: META_API_KEY, META_API_BASE_URL, META_NAMER_MODEL after approval)`)
      }
      if (!cfg.baseURL || !cfg.model) throw new Error(`${presetId} namer not configured: base URL / model missing`)
      const draft = heuristicTokens({ clusters, components })
      const user = [{ type: 'text', text: JSON.stringify(promptPayload(clusters, regions, draft, components)) }]
      // Vision models (Muse Spark, llama3.2-vision) can look at the page too. Off by default.
      if (process.env.S2T_NAMER_VISION === '1' && screenshotPath && existsSync(screenshotPath)) {
        const b64 = readFileSync(screenshotPath).toString('base64')
        user.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
      }
      const compact = (process.env.S2T_NAMER_MODE || 'compact') === 'compact'
      const t0 = Date.now()
      // Muse Spark 1.3 is a reasoning model: hidden reasoning was 70-95% of output tokens. Measured 2026-10-26 on
      // acme + div-soup: effort "low" cut naming from 53-74 s to 15-20 s and output tokens from 10-12k to about 3.2k
      // (about 65% cheaper) with the same eval scores, zero repairs and the same reason-grounding rate.
      const messages = [{ role: 'system', content: compact ? COMPACT_PROMPT : SYSTEM_PROMPT }, { role: 'user', content: user.length === 1 ? user[0].text : user }]
      // Failover: the same open model on another host, then hosted Muse Spark, so one provider being down never
      // stops a run. Each attempt that fails (error, timeout, unparseable JSON) is recorded in meta.failover.
      const chain = namerChain(presetId)
      const failover = []
      let answer = null
      for (const [i, id] of chain.entries()) {
        const c = id === presetId ? cfg : LLM_PRESETS[id]()
        if (id !== 'ollama' && !c.apiKey) { failover.push({ provider: id, error: 'not configured' }); continue }
        try {
          const r = await chat({
            ...c,
            json: true,
            timeoutMs: i < chain.length - 1 ? Number(process.env.S2T_NAMER_TIMEOUT_MS || 60000) : undefined,
            reasoningEffort: process.env.S2T_REASONING_EFFORT || (LOW_EFFORT.has(id) ? 'low' : ''),
            messages,
          })
          answer = { ...r, parsed: extractJson(r.text), id, model: c.model }
          break
        } catch (e) {
          failover.push({ provider: id, error: String((e && e.message) || e).slice(0, 200) })
          if (i === chain.length - 1) throw new Error(`all namers failed: ${failover.map((f) => `${f.provider}: ${f.error}`).join('; ')}`)
        }
      }
      const { text, usage, cached } = answer
      const parsed = answer.parsed
      // Merge suggestions are the model's plus the deterministic ones (a person decides each). Low-effort runs often
      // return "merges": [], which used to drop acme-shop's 6px-into-4px suggestion from the review page.
      const modelMerges = Array.isArray(parsed.merges) ? parsed.merges : []
      const merges = [...modelMerges, ...(draft.merges || []).filter((d) => !modelMerges.some((m) => m && m.from === d.from))]
      const rawTokens = compact ? expandCompact(parsed, draft).tokens : parsed.tokens || []
      // Low reasoning effort proposes fewer semantic/component tokens, leaning on primitives more. This
      // deterministic pass fills a short list of roles the model skipped but the component evidence clearly
      // supports (text.inverse, status colors) - see fillSemanticGaps in heuristic.js.
      // Same role: a text color whose own evidence (button text, or any component sitting on a
      // non-page-surface background) the model didn't name gets filled in regardless of its effort.
      const tokens = fillOnSurfaceTextTokens(fillSemanticGaps(rawTokens, clusters, components), clusters, capture)
      return { tokens, merges, namer: `${answer.id}:${answer.model}${compact ? '' : ':full'}`, meta: { mode: compact ? 'compact' : 'full', ms: Date.now() - t0, usage: cached ? { prompt_tokens: 0, completion_tokens: 0, cached_from: usage } : usage, cached: !!cached, ...(failover.length ? { failover } : {}) } }
    },
  }
}
