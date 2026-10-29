// Point and say: route a transcript. Deterministic first for accessibility requests (the checks compute the fix; the
// model only interprets words): "readable / contrast / too light" -> contrast fix; "focus ring / keyboard / where I
// am" -> focus-ring tokens; anything else -> Muse Spark mapping. Keys on intent words, not token names, so a misheard
// "gray" or "blue" does not change the route.

const FOCUS = /\bfocus|\bkeyboard\b|\btab(bing)?\b|where (i am|i'?m at)|\boutline\b|\bring\b/i
const CONTRAST = /\breadab|\blegib|\bcontrast\b|too (light|faint|pale|washed|low|grey|gray)|\b(hard|easier|difficult) to (read|see)\b|\bcan'?t read\b|\b(darker|lighter)\b|\bfaint\b|\bwashed[- ]out\b/i

/** @returns {{route:'focus'|'contrast'|'muse', matched:string|null}} */
export function routeIntent(transcript) {
  const t = String(transcript || '')
  let m = t.match(FOCUS)
  if (m) return { route: 'focus', matched: m[0] }
  m = t.match(CONTRAST)
  if (m) return { route: 'contrast', matched: m[0] }
  return { route: 'muse', matched: null }
}
