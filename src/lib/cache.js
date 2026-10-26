// Response cache for model calls (Muse Spark chat, SAM 3.1). Keyed by a hash of the exact request, so re-running a
// stage with the same inputs costs nothing and returns instantly; any change to model, prompt, image or settings is a
// new key. Lives under out/.cache (git-ignored). S2T_CACHE=0 turns it off (e.g. for latency measurements).
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

export const cacheEnabled = () => process.env.S2T_CACHE !== '0'
const dir = () => resolve(process.env.S2T_CACHE_DIR || join('out', '.cache'))

/** Stable key for any JSON-able request description. */
export const cacheKey = (kind, request) => `${kind}-${createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 32)}`

export function cacheGet(key) {
  if (!cacheEnabled()) return null
  const p = join(dir(), `${key}.json`)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch (e) { return null }
}

export function cachePut(key, value) {
  if (!cacheEnabled()) return
  try {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(join(dir(), `${key}.json`), JSON.stringify(value))
  } catch (e) { /* a cache write failure never fails the run */ }
}

/** Return the cached value for this request, or call fn() and cache what it returns. */
export async function cached(kind, request, fn) {
  const key = cacheKey(kind, request)
  const hit = cacheGet(key)
  if (hit) return { ...hit, cached: true }
  const value = await fn()
  cachePut(key, value)
  return value
}
