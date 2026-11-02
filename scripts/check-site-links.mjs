#!/usr/bin/env node
// Link check for the live-demo site: fetch the index logged-out, then every href/src on it (same-site and external).
// Exits 1 if any link is not 200, except ones listed in ALLOW (expected, e.g. the repo while it is private).
// Usage: node scripts/check-site-links.mjs [base URL, default https://s2t.sorbcloud.com/]
const base = process.argv[2] || 'https://s2t.sorbcloud.com/'
// The repo is private until Nov 3; logged-out it answers 404. Remove these once it is public.
const ALLOW = new Set(['https://github.com/nhunsaker/screenshot-to-tokens', 'https://github.com/nhunsaker/screenshot-to-tokens#readme'])

const res = await fetch(base, { redirect: 'follow' })
const html = await res.text()
const links = [...new Set([...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('#'))
  .map((h) => new URL(h.replace(/&amp;/g, '&'), base).href))]
console.log(`${res.status} ${base} (${links.length} links)`)
let bad = 0
for (const u of links) {
  let status
  try { status = (await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 s2t-link-check' } })).status } catch (e) { status = `error ${e.cause?.code || e.message}` }
  const ok = status === 200
  const allowed = !ok && ALLOW.has(u)
  if (!ok && !allowed) bad++
  console.log(`${ok ? 'ok ' : allowed ? 'exp' : 'BAD'} ${status} ${u}`)
}
if (res.status !== 200) bad++
console.log(bad ? `${bad} broken` : 'all links load')
process.exit(bad ? 1 : 0)
