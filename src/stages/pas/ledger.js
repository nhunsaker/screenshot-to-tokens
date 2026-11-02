// Demo budget for the public Point and say page (live demo tier B). Every metered call costs units; caps are global,
// per day (UTC), per session cookie and per IP per day. Pure core (`createLedger`) plus a JSON file store with an
// atomic write (temp file + rename), so a restart keeps the count. The page shows "Demo budget: N of 1,000 left".
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { createHash, randomBytes } from 'crypto'

/** Units per action (live-demo-plan.md, "The budget"). Deterministic intents (contrast, focus) cost nothing. */
export const COSTS = { point: 1, transcribe: 1, 'intent-deterministic': 0, 'intent-muse': 2, 'focus-check': 3 }

export const DEFAULT_CAPS = { total: 1000, day: 300, session: 40, ipDay: 80 }

/** Caps from env: S2T_BUDGET (global), S2T_BUDGET_DAY, S2T_BUDGET_SESSION, S2T_BUDGET_IP_DAY. */
export function capsFromEnv(env = process.env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.max(0, Math.floor(Number(v))) : d)
  return {
    total: n(env.S2T_BUDGET, DEFAULT_CAPS.total), day: n(env.S2T_BUDGET_DAY, DEFAULT_CAPS.day),
    session: n(env.S2T_BUDGET_SESSION, DEFAULT_CAPS.session), ipDay: n(env.S2T_BUDGET_IP_DAY, DEFAULT_CAPS.ipDay),
  }
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)
const KEEP_DAYS = 3

/**
 * Pure ledger. `charge(kind, {session, ip})` checks every cap before spending; a refused charge spends nothing.
 * `left` is the shared counter (global cap minus everything spent), `total` the global cap, and `mine` what this
 * caller can still spend (the smallest of the four remaining amounts: total, today, this session, this IP today).
 * @param {{caps?:Partial<typeof DEFAULT_CAPS>, state?:any, now?:()=>number, onChange?:(state:any)=>void}} [o]
 */
export function createLedger(o = {}) {
  const caps = { ...DEFAULT_CAPS, ...(o.caps || {}) }
  const now = o.now || Date.now
  const st = normalize(o.state)
  // Session ids and IPs are stored only as salted hashes (the salt lives in the ledger file, so caps survive restarts).
  const h = (v) => (v ? createHash('sha256').update(st.salt + '|' + v).digest('hex').slice(0, 16) : null)
  const hashed = (who) => ({ session: h(who && who.session), ip: h(who && who.ip) })

  function prune(today) {
    // Per-day maps only need today; keep a couple of days for the logs, drop the rest so the file stays small.
    for (const map of [st.byDay, st.byIpDay]) for (const d of Object.keys(map)) if (d < dayOf(now() - KEEP_DAYS * 864e5) && d !== today) delete map[d]
  }

  function remaining(who) {
    const { session, ip } = hashed(who)
    const today = dayOf(now())
    const ipUsed = ip ? ((st.byIpDay[today] || {})[ip] || 0) : 0
    const r = {
      total: caps.total - st.used,
      day: caps.day - (st.byDay[today] || 0),
      session: session ? caps.session - (st.bySession[session] || 0) : caps.session,
      ip: caps.ipDay - ipUsed,
    }
    for (const k of Object.keys(r)) r[k] = Math.max(0, r[k])
    return r
  }

  /** What this caller sees: {left, total, mine, reason}; reason names the cap that is spent, when one is. */
  function view(who = {}) {
    const r = remaining(who)
    return { left: r.total, total: caps.total, mine: Math.min(r.total, r.day, r.session, r.ip), reason: reasonOf(r) }
  }

  function reasonOf(r, need = 1) {
    if (r.total < need) return 'total'
    if (r.day < need) return 'day'
    if (r.session < need) return 'session'
    if (r.ip < need) return 'ip'
    return null
  }

  /**
   * Spend the units for one action, or several at once (all or nothing). Unknown kinds throw (a programming error).
   * @param {string|string[]} kind
   * @returns {{ok:boolean, units:number, left:number, total:number, mine:number, reason:string|null}}
   */
  function charge(kind, who = {}) {
    const kinds = Array.isArray(kind) ? kind : [kind]
    for (const k of kinds) if (!(k in COSTS)) throw new Error(`unknown budget action: ${k}`)
    const units = kinds.reduce((n, k) => n + COSTS[k], 0)
    const today = dayOf(now())
    const reason = units > 0 ? reasonOf(remaining(who), units) : null
    if (reason) return { ok: false, units, ...pick(view(who)), reason }
    if (units > 0) {
      const k = hashed(who)
      st.used += units
      st.byDay[today] = (st.byDay[today] || 0) + units
      if (k.session) st.bySession[k.session] = (st.bySession[k.session] || 0) + units
      if (k.ip) { const m = st.byIpDay[today] || (st.byIpDay[today] = {}); m[k.ip] = (m[k.ip] || 0) + units }
      for (const kd of kinds) st.calls[kd] = (st.calls[kd] || 0) + 1
      prune(today)
      if (o.onChange) o.onChange(st)
    }
    return { ok: true, units, ...pick(view(who)), reason: null }
  }

  /** Give units back (the action failed on our side or upstream; the visitor should not pay for it). */
  function refund(kind, who = {}) {
    const kinds = Array.isArray(kind) ? kind : [kind]
    const units = kinds.reduce((n, k) => n + (COSTS[k] || 0), 0)
    if (!units) return
    const today = dayOf(now())
    const hk = hashed(who)
    st.used = Math.max(0, st.used - units)
    if (st.byDay[today]) st.byDay[today] = Math.max(0, st.byDay[today] - units)
    if (hk.session && st.bySession[hk.session]) st.bySession[hk.session] = Math.max(0, st.bySession[hk.session] - units)
    const m = st.byIpDay[today]
    if (hk.ip && m && m[hk.ip]) m[hk.ip] = Math.max(0, m[hk.ip] - units)
    for (const k of kinds) if (st.calls[k]) st.calls[k] -= 1
    if (o.onChange) o.onChange(st)
  }

  /** Summary for /api/budget and the logs: no session ids or IPs. */
  function summary() {
    const today = dayOf(now())
    return { total: caps.total, used: st.used, left: Math.max(0, caps.total - st.used), today: st.byDay[today] || 0, caps, calls: { ...st.calls }, sessions: Object.keys(st.bySession).length }
  }

  return { charge, refund, view, summary, caps, state: () => st }
}

const pick = (v) => ({ left: v.left, total: v.total, mine: v.mine })

function normalize(s) {
  const o = s && typeof s === 'object' ? s : {}
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  return { salt: typeof o.salt === 'string' && o.salt ? o.salt : randomBytes(16).toString('hex'), used: Number(o.used) || 0, byDay: obj(o.byDay), bySession: obj(o.bySession), byIpDay: obj(o.byIpDay), calls: obj(o.calls) }
}

/** Read a ledger state file; a missing or broken file is a fresh ledger (logged by the caller). */
export function readLedgerFile(file) {
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch (e) { return null }
}

/** Atomic write: temp file in the same folder, then rename over the old one. */
export function writeLedgerFile(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, file)
}

/** A ledger kept in $S2T_DATA/ledger.json (or `file`), caps from env unless given. */
export function fileLedger({ file, caps, now } = {}) {
  const f = file || join(process.env.S2T_DATA || 'out/data', 'ledger.json')
  return { file: f, ...createLedger({ caps: caps || capsFromEnv(), now, state: readLedgerFile(f), onChange: (st) => writeLedgerFile(f, st) }) }
}

/**
 * The caller's IP behind Traefik. Traefik appends the peer address to X-Forwarded-For, so with one proxy in front the
 * LAST entry is the real client; earlier entries are whatever the client sent and can be forged (the "first hop"
 * is only safe when the proxy strips client-sent headers). `trustProxy` false uses the socket address only.
 */
export function clientIp(req, trustProxy = true) {
  const hops = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean) : []
  const ip = hops[hops.length - 1] || (req.socket && req.socket.remoteAddress) || ''
  return ip.replace(/^::ffff:/, '').slice(0, 64)
}
