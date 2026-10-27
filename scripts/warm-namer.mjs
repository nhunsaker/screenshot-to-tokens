#!/usr/bin/env node
// Wake the naming endpoint before a recorded run, so a cold start never lands on camera. One tiny uncached call
// to the S2T_NAMER preset (default baseten); prints its latency, never the key.
//   node scripts/warm-namer.mjs
import { loadDotEnv, LLM_PRESETS } from '../src/config.js'
import { chat } from '../src/providers/llm/chat.js'

loadDotEnv()
process.env.S2T_CACHE = '0'
const id = process.env.S2T_NAMER || 'baseten'
const preset = LLM_PRESETS[id] && LLM_PRESETS[id]()
if (!preset) { console.error(`no LLM preset "${id}"`); process.exit(2) }
if (/-contributor$/.test(preset.model)) { console.error('refusing a -contributor model id'); process.exit(2) }
const t0 = Date.now()
try {
  await chat({ ...preset, messages: [{ role: 'user', content: 'Reply with the word ok.' }], reasoningEffort: 'low', timeoutMs: 60000 })
  console.log(`${id} (${preset.model}) warm in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
} catch (e) {
  console.error(`${id} warm-up failed: ${e.message}`)
  process.exit(1)
}
