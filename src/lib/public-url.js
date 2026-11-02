// Public-URL guard for the live demo's "run it on a public page" (tier C). A visitor's URL makes our server open a
// browser and fetch things, so every address it reaches must be on the public internet (SSRF):
//   checkUrl(raw)          syntax: http(s) only, ports 80/443 only, no credentials, no localhost / *.local / bare
//                          host names / our own host; IP literals checked at once.
//   publicLookup           a dns.lookup replacement that resolves every A/AAAA and fails if ANY address is private,
//                          loopback, link-local, CGNAT, multicast, reserved, metadata, ULA, or our own server. Node's
//                          http(s) uses it at connect time, so the address checked is the address connected to (no
//                          DNS-rebinding gap for our own requests).
//   validatePublicUrl(raw) checkUrl + resolve.
//   followRedirects(raw)   GET with manual redirects, every hop re-validated, at most 3; returns the final URL, the
//                          status and the content type. The body is not read past the headers.
//   guardPage(page, o)     Playwright: every request the browser makes (page.route) is checked the same way and
//                          aborted when its host is not public; WebSockets are closed. `o.allowOrigins` lets the run's
//                          own 127.0.0.1 static servers through (the mirror is served locally for capture/verify).
import { BlockList, isIP } from 'node:net'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'

export const OWN_HOSTS = ['s2t.sorbcloud.com']
export const OWN_IPS = ['5.78.129.14']

const v4 = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) v4.addSubnet(net, bits, 'ipv4')
const v6 = new BlockList()
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32],
  ['100::', 64], ['2001::', 32], ['2001:10::', 28], ['2001:20::', 28],
]) v6.addSubnet(net, bits, 'ipv6')

/** The IPv4 address inside an IPv6 one (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16, compat ::a.b.c.d), else null. */
export function embeddedV4(ip) {
  const s = ip.toLowerCase()
  const dotted = s.match(/^(?:::ffff:|::ffff:0:|64:ff9b::|::)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return dotted[1]
  const words = expand6(s)
  if (!words) return null
  const toV4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')
  // ::ffff:hhhh:hhhh and ::hhhh:hhhh (deprecated compat) and 64:ff9b::/96
  if (words.slice(0, 5).every((w) => w === 0) && (words[5] === 0xffff || words[5] === 0)) return words[5] === 0 && words[6] === 0 && words[7] <= 1 ? null : toV4(words[6], words[7])
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((w) => w === 0)) return toV4(words[6], words[7])
  if (words[0] === 0x2002) return toV4(words[1], words[2])
  return null
}

/** Eight 16-bit words of an IPv6 address, or null. */
function expand6(s) {
  if (isIP(s) !== 6) return null
  let str = s
  const m = str.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (m) { const p = m[1].split('.').map(Number); str = str.slice(0, -m[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16) }
  const [head, tail] = str.split('::')
  const h = head ? head.split(':') : []
  const t = tail != null ? (tail ? tail.split(':') : []) : null
  const parts = t == null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
  if (parts.length !== 8) return null
  return parts.map((x) => parseInt(x || '0', 16))
}

/**
 * Why an address may not be reached, or null when it is public.
 * @param {string} ip
 * @param {{ownIps?:string[]}} [o]
 */
export function blockedAddress(ip, o = {}) {
  const raw = String(ip || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const fam = isIP(raw)
  if (!fam) return 'not an IP address'
  if ((o.ownIps || OWN_IPS).includes(raw)) return 'our own server'
  if (fam === 4) {
    if (raw === '169.254.169.254') return 'cloud metadata address'
    return v4.check(raw, 'ipv4') ? 'private or reserved address' : null
  }
  const inner = embeddedV4(raw)
  if (inner) return blockedAddress(inner, o)
  return v6.check(raw, 'ipv6') ? 'private or reserved address' : null
}

/**
 * Syntax check. Returns {ok:true, url} (a URL object, normalised) or {ok:false, reason}.
 * @param {string} raw
 * @param {{ownHosts?:string[], ownIps?:string[]}} [o]
 */
export function checkUrl(raw, o = {}) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return { ok: false, reason: 'Enter a web address.' }
  if (s.length > 2048) return { ok: false, reason: 'That address is too long.' }
  let u
  try { u = new URL(s) } catch (e) {
    // "example.com" without a scheme: assume https.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) { try { u = new URL('https://' + s) } catch (e2) { return { ok: false, reason: 'That is not a web address.' } } }
    else return { ok: false, reason: 'That is not a web address.' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only http and https pages can be run.' }
  if (u.username || u.password) return { ok: false, reason: 'Addresses with a user name or password are not accepted.' }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return { ok: false, reason: 'That address has no host.' }
  if (host.startsWith('[') || isIP(host)) {
    const why = blockedAddress(host, o)
    if (why) return { ok: false, reason: `That address points at a ${why}, not a public page.` }
    if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, reason: 'Only the standard web ports (80 and 443) are allowed.' }
    return { ok: true, url: u }
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'localhost is not a public page.' }
  if (/\.(local|internal|lan|home|intranet|corp|private|localdomain|home\.arpa)$/.test(host)) return { ok: false, reason: 'That is a local network name, not a public page.' }
  if (!host.includes('.')) return { ok: false, reason: 'That host name is not a public domain.' }
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, reason: 'Only the standard web ports (80 and 443) are allowed.' }
  if (!/^[a-z0-9.-]+$/.test(host) || host.split('.').some((l) => !l || l.length > 63)) return { ok: false, reason: 'That host name is not valid.' }
  if ((o.ownHosts || OWN_HOSTS).some((h) => host === h || host.endsWith('.' + h))) return { ok: false, reason: 'That is this demo site; pick another page.' }
  return { ok: true, url: u }
}

/**
 * Resolve every A/AAAA for a host name; throw (code EBLOCKED) when there are none or any is not public.
 * @param {string} host
 * @param {{lookup?:typeof dns.promises.lookup, ownIps?:string[]}} [o]
 * @returns {Promise<string[]>}
 */
export async function resolvePublic(host, o = {}) {
  const h = String(host).replace(/^\[|\]$/g, '')
  if (isIP(h)) {
    const why = blockedAddress(h, o)
    if (why) throw blockedError(`${h} is a ${why}`)
    return [h]
  }
  const lookup = o.lookup || dns.promises.lookup
  let addrs
  try { addrs = await lookup(h, { all: true, verbatim: true }) } catch (e) {
    const err = new Error(`${h} did not resolve (${e.code || e.message})`); err.code = 'ENOTFOUND'; throw err
  }
  if (!addrs || !addrs.length) { const err = new Error(`${h} did not resolve`); err.code = 'ENOTFOUND'; throw err }
  for (const a of addrs) {
    const why = blockedAddress(a.address, o)
    if (why) throw blockedError(`${h} resolves to a ${why}`)
  }
  return addrs.map((a) => a.address)
}

function blockedError(msg) { const e = new Error(msg); e.code = 'EBLOCKED'; return e }

/** dns.lookup-compatible function for http(s).request / net.connect: refuses any non-public address. */
export function publicLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {} }
  const opts = typeof options === 'number' ? { family: options } : (options || {})
  resolvePublic(hostname).then((list) => {
    const fam = (a) => (isIP(a) === 6 ? 6 : 4)
    const pick = opts.family ? list.filter((a) => fam(a) === opts.family) : list
    if (!pick.length) return cb(Object.assign(new Error(`no ${opts.family === 6 ? 'IPv6' : 'IPv4'} address for ${hostname}`), { code: 'ENOTFOUND' }))
    if (opts.all) return cb(null, pick.map((a) => ({ address: a, family: fam(a) })))
    cb(null, pick[0], fam(pick[0]))
  }, (e) => cb(e))
}

/**
 * Syntax + DNS. {ok:true, url, addresses} or {ok:false, reason, code}.
 * @param {string} raw
 * @param {{lookup?:any, ownHosts?:string[], ownIps?:string[]}} [o]
 */
export async function validatePublicUrl(raw, o = {}) {
  const c = checkUrl(raw, o)
  if (!c.ok) return { ok: false, reason: c.reason, code: 'refused' }
  try {
    const addresses = await resolvePublic(c.url.hostname, o)
    return { ok: true, url: c.url, addresses }
  } catch (e) {
    if (e.code === 'EBLOCKED') return { ok: false, reason: `That page is not on the public internet (${e.message}).`, code: 'refused' }
    return { ok: false, reason: `That host name did not resolve. Check the address.`, code: 'unresolved' }
  }
}

/**
 * GET the URL with redirects followed by hand (each hop re-validated, connect-time lookup guarded), at most
 * `maxRedirects`. Resolves {ok:true, url, status, type, length, hops} or {ok:false, reason, code}.
 * @param {string} raw
 * @param {{maxRedirects?:number, timeoutMs?:number, request?:(u:URL, cb:(res:any)=>void)=>any, ownHosts?:string[], ownIps?:string[], lookup?:any}} [o]
 */
export async function followRedirects(raw, o = {}) {
  const max = o.maxRedirects == null ? 3 : o.maxRedirects
  const hops = []
  let current = String(raw)
  for (let i = 0; i <= max; i++) {
    const v = await validatePublicUrl(current, o)
    if (!v.ok) return { ok: false, reason: i ? `It redirects to an address we can't open: ${v.reason}` : v.reason, code: v.code, hops }
    let res
    try { res = await headOf(v.url, o) } catch (e) {
      if (e.code === 'EBLOCKED') return { ok: false, reason: 'That page is not on the public internet.', code: 'refused', hops }
      return { ok: false, reason: `The page did not answer (${String(e.code || e.message).slice(0, 60)}).`, code: 'unreachable', hops }
    }
    hops.push({ url: v.url.href, status: res.status })
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (i === max) return { ok: false, reason: `Too many redirects (more than ${max}).`, code: 'redirects', hops }
      try { current = new URL(res.location, v.url).href } catch (e) { return { ok: false, reason: 'The page redirects to an invalid address.', code: 'unreachable', hops } }
      continue
    }
    return { ok: true, url: v.url.href, status: res.status, type: res.type, length: res.length, hops }
  }
  return { ok: false, reason: 'Too many redirects.', code: 'redirects', hops }
}

/** One GET; resolves with status, location, content type and length once the headers arrive (the body is dropped). */
function headOf(u, o) {
  const timeoutMs = o.timeoutMs || 10000
  return new Promise((done, fail) => {
    const mod = u.protocol === 'https:' ? https : http
    const opts = { method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 (s2t live demo; +https://s2t.sorbcloud.com)', accept: 'text/html,*/*;q=0.8' }, lookup: o.lookupFn || publicLookup, timeout: timeoutMs }
    const req = (o.request ? o.request(u, opts) : mod.request(u, opts))
    req.on('response', (res) => {
      const out = { status: res.statusCode || 0, location: res.headers.location || null, type: String(res.headers['content-type'] || ''), length: Number(res.headers['content-length']) || null }
      res.destroy()
      done(out)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', fail)
    req.end()
  })
}

/**
 * Check every browser request on a Playwright page; abort the ones whose host is not public. `allowOrigins` (exact
 * origins, e.g. the run's own http://127.0.0.1:port static servers) pass. data:/blob:/about: pass. Returns a stats
 * object {blocked:[...], checked} the caller can log.
 * @param {any} page Playwright Page (or BrowserContext)
 * @param {{allowOrigins?:()=>Iterable<string>|Iterable<string>, ownIps?:string[], onBlock?:(url:string, why:string)=>void}} [o]
 */
export async function guardPage(page, o = {}) {
  const cache = new Map()
  const stats = { blocked: [], checked: 0 }
  const allowed = () => new Set(typeof o.allowOrigins === 'function' ? o.allowOrigins() : (o.allowOrigins || []))
  const verdict = (host) => {
    if (!cache.has(host)) cache.set(host, resolvePublic(host, o).then(() => null, (e) => e.message || 'blocked'))
    return cache.get(host)
  }
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    let why = null
    try {
      const u = new URL(url)
      if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return route.continue()
      if (allowed().has(u.origin)) return route.continue()
      stats.checked++
      if (u.protocol !== 'http:' && u.protocol !== 'https:') why = `scheme ${u.protocol}`
      else if (u.username || u.password) why = 'credentials in URL'
      else why = await verdict(u.hostname.replace(/^\[|\]$/g, ''))
    } catch (e) { why = 'bad url' }
    if (why) {
      stats.blocked.push(url.slice(0, 200))
      if (o.onBlock) o.onBlock(url, why)
      return route.abort('blockedbyclient').catch(() => {})
    }
    return route.continue().catch(() => {})
  })
  if (typeof page.routeWebSocket === 'function') await page.routeWebSocket(/.*/, (ws) => ws.close()).catch(() => {})
  return stats
}
