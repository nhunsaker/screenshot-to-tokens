// Timeout for calls to outside services. S2T_EXTERNAL_TIMEOUT_MS caps every one of them (the live demo sets 30000,
// so a slow provider fails fast and the page shows an error, not a spinner); unset, each call keeps its own default.

/** min(fallback, S2T_EXTERNAL_TIMEOUT_MS) when the env cap is set, else the fallback. */
export function externalTimeoutMs(fallback) {
  const cap = Number(process.env.S2T_EXTERNAL_TIMEOUT_MS)
  return Number.isFinite(cap) && cap > 0 ? Math.min(fallback, cap) : fallback
}

/** An AbortSignal for fetch() that fires after externalTimeoutMs(fallback). */
export const externalSignal = (fallback = 120000) => AbortSignal.timeout(externalTimeoutMs(fallback))
