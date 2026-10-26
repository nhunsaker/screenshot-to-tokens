// Minimal OpenAI-compatible chat client (global fetch). Works for Ollama, Fireworks and,
// assuming Meta's API keeps an OpenAI-compatible endpoint, Meta Model API (verify Oct 26).
// Data policy: only public, non-sensitive (class C) content goes to hosted APIs.
import { cached } from '../../lib/cache.js'
import { recordCall } from '../../lib/metrics.js'

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson(text) {
  if (text == null) throw new Error('empty model reply')
  const s = String(text)
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in model reply')
  return JSON.parse(body.slice(start, end + 1))
}

/**
 * @param {{baseURL:string, apiKey:string, model:string, messages:any[], json?:boolean, timeoutMs?:number, temperature?:number}} o
 * @returns {Promise<{text:string, usage?:any}>}
 */
export async function chat(o) {
  if (!o.baseURL || !o.model) throw new Error('chat: baseURL and model are required')
  // Same request → cached reply (no cost, no wait). The key never includes the API key.
  const req = { baseURL: o.baseURL, model: o.model, messages: o.messages, json: !!o.json, temperature: o.temperature ?? 0.2 }
  const t0 = Date.now()
  const r = await cached('chat', req, () => chatUncached(o))
  recordCall({ kind: 'chat', model: o.model, ms: Date.now() - t0, cached: !!r.cached, usage: r.usage })
  return r
}

async function chatUncached(o) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 120000)
  try {
    const res = await fetch(`${o.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey || 'none'}` },
      body: JSON.stringify({
        model: o.model,
        messages: o.messages,
        temperature: o.temperature ?? 0.2,
        ...(o.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    return { text: data.choices?.[0]?.message?.content ?? '', usage: data.usage }
  } finally {
    clearTimeout(timer)
  }
}
