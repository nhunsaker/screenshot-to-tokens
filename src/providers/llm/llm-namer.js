// Model namer: Muse Spark (meta), local Llama (ollama) or Fireworks, all via one
// OpenAI-compatible client. The model gets the clusters plus the heuristic draft and
// returns a refined TokenSet; validateTokenSet() repairs or rejects what comes back.
import { readFileSync, existsSync } from 'fs'
import { LLM_PRESETS } from '../../config.js'
import { chat, extractJson } from './chat.js'
import { heuristicTokens } from './heuristic.js'

export const SYSTEM_PROMPT = `You are a design-systems engineer naming design tokens for an app that has none.
You get CLUSTERS of near-duplicate style values found on the page (with how often and where each is used)
and a DRAFT token set. Return an improved token set as JSON only, no prose:
{"tokens":[{"name":"color.blue.600","tier":"primitive","value":"#1a73e8ff","clusters":["color-04"],"why":"..."},
 {"name":"color.action.primary","tier":"semantic","alias":"color.blue.600","clusters":["color-04"],"why":"..."}]}
Rules:
- Three tiers. primitive = raw value, named by what it is (color.blue.600, space.16, radius.md).
  semantic = purpose, aliases a primitive (color.text.muted, color.surface.raised, color.border.default).
  component = one component's use, aliases a primitive or semantic (button.radius, card.shadow).
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
- "tokens": semantic (purpose: color.text.muted, color.surface.raised, color.border.default, color.action.primary)
  and component (one component's use: button.radius, card.shadow) tokens only. Each aliases an existing primitive
  name (after your renames) or another of your tokens. Cover the roles the usage data supports; skip the rest.
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
export function promptPayload(clusters, regions, draft) {
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
  }
}

/**
 * @param {'meta'|'ollama'|'fireworks'} presetId
 * @returns {import('../../types.js').NamerProvider}
 */
export default function llmNamer(presetId) {
  const preset = LLM_PRESETS[presetId]
  if (!preset) throw new Error(`unknown namer preset: ${presetId}`)
  return {
    id: presetId,
    async name({ clusters, regions, screenshotPath }) {
      const cfg = preset()
      if (presetId !== 'ollama' && !cfg.apiKey) {
        throw new Error(`${presetId} namer not configured: set its API key (Meta: META_API_KEY, META_API_BASE_URL, META_NAMER_MODEL after approval)`)
      }
      if (!cfg.baseURL || !cfg.model) throw new Error(`${presetId} namer not configured: base URL / model missing`)
      const draft = heuristicTokens({ clusters })
      const user = [{ type: 'text', text: JSON.stringify(promptPayload(clusters, regions, draft)) }]
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
      const { text, usage, cached } = await chat({
        ...cfg,
        json: true,
        reasoningEffort: process.env.S2T_REASONING_EFFORT || (presetId === 'meta' || presetId === 'baseten' ? 'low' : ''),
        messages: [{ role: 'system', content: compact ? COMPACT_PROMPT : SYSTEM_PROMPT }, { role: 'user', content: user.length === 1 ? user[0].text : user }],
      })
      const parsed = extractJson(text)
      // If the model says nothing about merges, keep the deterministic suggestions rather than losing them.
      const merges = Array.isArray(parsed.merges) ? parsed.merges : draft.merges || []
      const tokens = compact ? expandCompact(parsed, draft).tokens : parsed.tokens || []
      return { tokens, merges, namer: `${presetId}:${cfg.model}${compact ? '' : ':full'}`, meta: { mode: compact ? 'compact' : 'full', ms: Date.now() - t0, usage: cached ? { prompt_tokens: 0, completion_tokens: 0, cached_from: usage } : usage, cached: !!cached } }
    },
  }
}
