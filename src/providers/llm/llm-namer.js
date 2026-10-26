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
      const t0 = Date.now()
      const { text, usage } = await chat({
        ...cfg,
        json: true,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user.length === 1 ? user[0].text : user }],
      })
      const parsed = extractJson(text)
      // If the model says nothing about merges, keep the deterministic suggestions rather than losing them.
      const merges = Array.isArray(parsed.merges) ? parsed.merges : draft.merges || []
      return { tokens: parsed.tokens || [], merges, namer: `${presetId}:${cfg.model}`, meta: { ms: Date.now() - t0, usage } }
    },
  }
}
