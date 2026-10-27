// Per-run model-call metrics for the latency waterfall (F19): calls, cache hits, wall time and estimated cost.
// Providers record into one in-process ledger; the pipeline snapshots it around each stage.

// Meta Model API list prices (dev.meta.ai/docs/pricing-rate-limits, checked 2026-10-26). Standard tier only.
// Self-hosted SAM 3.1 on Modal is billed per GPU second (L4 $0.80/h, `modal billing rates` on 2026-10-27).
export const PRICES = {
  'sam-3.1': { perImage: 2.5 / 1000 },
  'muse-spark-1.3': { inPerToken: 1.25 / 1e6, outPerToken: 4.25 / 1e6 },
  'sam-3.1-open@modal': { perGpuSecond: 0.8 / 3600 },
}

const ledger = []

/**
 * Record one model call. `cached` calls cost nothing and are counted separately.
 * `gpuS` is measured GPU time (self-hosted models), priced at the model's per-GPU-second rate.
 */
export function recordCall({ kind, model, ms, cached = false, usage = null, gpuS = 0 }) {
  let usd = 0
  const p = PRICES[model]
  if (!cached && p) {
    if (p.perImage) usd = p.perImage
    if (p.inPerToken && usage) usd = (usage.prompt_tokens || 0) * p.inPerToken + (usage.completion_tokens || 0) * p.outPerToken
    if (p.perGpuSecond) usd = (gpuS || 0) * p.perGpuSecond
  }
  ledger.push({ kind, model, ms, cached, usd, gpuS: cached ? 0 : gpuS || 0 })
}

export const mark = () => ledger.length

/** Summarize calls recorded since a mark(). `gpuS` appears only when a self-hosted model ran. */
export function since(m) {
  const calls = ledger.slice(m)
  const gpuS = calls.reduce((n, c) => n + (c.gpuS || 0), 0)
  return {
    calls: calls.length,
    cached: calls.filter((c) => c.cached).length,
    usd: Math.round(calls.reduce((n, c) => n + c.usd, 0) * 10000) / 10000,
    models: [...new Set(calls.map((c) => c.model))],
    ...(gpuS ? { gpuS: Math.round(gpuS * 1000) / 1000 } : {}),
  }
}
