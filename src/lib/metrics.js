// Per-run model-call metrics for the latency waterfall (F19): calls, cache hits, wall time and estimated cost.
// Providers record into one in-process ledger; the pipeline snapshots it around each stage.

// Meta Model API list prices (dev.meta.ai/docs/pricing-rate-limits, checked 2026-10-26). Standard tier only.
export const PRICES = {
  'sam-3.1': { perImage: 2.5 / 1000 },
  'muse-spark-1.3': { inPerToken: 1.25 / 1e6, outPerToken: 4.25 / 1e6 },
}

const ledger = []

/** Record one model call. `cached` calls cost nothing and are counted separately. */
export function recordCall({ kind, model, ms, cached = false, usage = null }) {
  let usd = 0
  const p = PRICES[model]
  if (!cached && p) {
    if (p.perImage) usd = p.perImage
    if (p.inPerToken && usage) usd = (usage.prompt_tokens || 0) * p.inPerToken + (usage.completion_tokens || 0) * p.outPerToken
  }
  ledger.push({ kind, model, ms, cached, usd })
}

export const mark = () => ledger.length

/** Summarize calls recorded since a mark(). */
export function since(m) {
  const calls = ledger.slice(m)
  return {
    calls: calls.length,
    cached: calls.filter((c) => c.cached).length,
    usd: Math.round(calls.reduce((n, c) => n + c.usd, 0) * 10000) / 10000,
    models: [...new Set(calls.map((c) => c.model))],
  }
}
