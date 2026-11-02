import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createLedger, fileLedger, capsFromEnv, clientIp, COSTS, DEFAULT_CAPS } from '../src/stages/pas/ledger.js'

const clock = (iso) => { let t = Date.parse(iso); return { now: () => t, add: (ms) => { t += ms } } }

test('costs match the plan table', () => {
  assert.deepEqual(COSTS, { point: 1, transcribe: 1, 'intent-deterministic': 0, 'intent-muse': 2, 'focus-check': 3 })
  assert.deepEqual(DEFAULT_CAPS, { total: 1000, day: 300, session: 40, ipDay: 80 })
})

test('charges decrement left and total stays the global cap', () => {
  const l = createLedger({ caps: { total: 1000, day: 300, session: 40, ipDay: 80 } })
  const who = { session: 's1', ip: '1.2.3.4' }
  assert.equal(l.view(who).mine, 40); assert.equal(l.view(who).left, 1000) // the session cap is the smallest
  let r = l.charge('point', who)
  assert.equal(r.ok, true); assert.equal(r.units, 1); assert.equal(r.mine, 39); assert.equal(r.left, 999); assert.equal(r.total, 1000)
  r = l.charge('intent-muse', who); assert.equal(r.mine, 37)
  r = l.charge('focus-check', who); assert.equal(r.mine, 34)
  r = l.charge('intent-deterministic', who); assert.equal(r.mine, 34); assert.equal(r.units, 0)
  assert.equal(l.summary().used, 6)
  assert.throws(() => l.charge('bogus', who), /unknown budget action/)
})

test('global cap: refused without spending, reason total', () => {
  const l = createLedger({ caps: { total: 5 } })
  const who = { session: 'a', ip: '1.1.1.1' }
  l.charge('focus-check', who); l.charge('point', who)
  const r = l.charge('focus-check', who) // 3 > 1 left
  assert.equal(r.ok, false); assert.equal(r.reason, 'total'); assert.equal(r.mine, 1)
  assert.equal(l.summary().used, 4)
  assert.equal(l.charge('point', who).ok, true)
  assert.equal(l.charge('point', who).reason, 'total')
  // Free actions still go through at zero.
  assert.equal(l.charge('intent-deterministic', who).ok, true)
})

test('per-session cap is per cookie; another session still has budget', () => {
  const l = createLedger({ caps: { session: 3 } })
  const a = { session: 'a', ip: '1.1.1.1' }, b = { session: 'b', ip: '1.1.1.1' }
  l.charge('focus-check', a)
  const r = l.charge('point', a)
  assert.equal(r.ok, false); assert.equal(r.reason, 'session')
  assert.equal(l.charge('point', b).ok, true)
  assert.equal(l.view(b).mine, 2)
})

test('per-IP per-day cap spans sessions and resets the next UTC day', () => {
  const c = clock('2026-11-02T23:59:00Z')
  const l = createLedger({ caps: { ipDay: 2, session: 100 }, now: c.now })
  assert.equal(l.charge('point', { session: 'a', ip: '9.9.9.9' }).ok, true)
  assert.equal(l.charge('point', { session: 'b', ip: '9.9.9.9' }).ok, true)
  const r = l.charge('point', { session: 'c', ip: '9.9.9.9' })
  assert.equal(r.reason, 'ip')
  assert.equal(l.charge('point', { session: 'c', ip: '8.8.8.8' }).ok, true)
  c.add(2 * 60 * 1000) // past midnight UTC
  assert.equal(l.charge('point', { session: 'c', ip: '9.9.9.9' }).ok, true)
})

test('day cap rolls over at UTC midnight; the global cap does not', () => {
  const c = clock('2026-11-03T10:00:00Z')
  const l = createLedger({ caps: { total: 10, day: 4, session: 100, ipDay: 100 }, now: c.now })
  const who = { session: 's', ip: 'i' }
  for (let i = 0; i < 4; i++) assert.equal(l.charge('point', who).ok, true)
  assert.equal(l.charge('point', who).reason, 'day')
  assert.equal(l.view(who).mine, 0)
  c.add(864e5)
  assert.equal(l.view(who).mine, 4)
  for (let i = 0; i < 4; i++) l.charge('point', who)
  c.add(864e5)
  assert.equal(l.view(who).mine, 2) // 10 total - 8 used
  l.charge('point', who); l.charge('point', who)
  assert.equal(l.charge('point', who).reason, 'total')
})

test('old per-day entries are pruned', () => {
  const c = clock('2026-11-01T12:00:00Z')
  const l = createLedger({ now: c.now })
  l.charge('point', { session: 's', ip: 'i' })
  c.add(10 * 864e5)
  l.charge('point', { session: 's', ip: 'i' })
  assert.deepEqual(Object.keys(l.state().byDay), ['2026-11-11'])
  assert.deepEqual(Object.keys(l.state().byIpDay), ['2026-11-11'])
})

test('refund gives units back', () => {
  const l = createLedger()
  const who = { session: 's', ip: 'i' }
  l.charge('intent-muse', who)
  l.refund('intent-muse', who)
  assert.equal(l.summary().used, 0)
  assert.equal(l.view(who).mine, 40)
})

test('file ledger persists across restarts with an atomic write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  const file = join(dir, 'sub', 'ledger.json')
  const a = fileLedger({ file, caps: { total: 50 } })
  a.charge('focus-check', { session: 's', ip: 'i' })
  a.charge('point', { session: 's', ip: 'i' })
  assert.ok(existsSync(file))
  assert.equal(readdirSync(join(dir, 'sub')).filter((f) => f.endsWith('.tmp')).length, 0)
  assert.equal(JSON.parse(readFileSync(file, 'utf-8')).used, 4)
  const b = fileLedger({ file, caps: { total: 50 } })
  assert.equal(b.summary().used, 4)
  assert.equal(b.view({ session: 's', ip: 'i' }).mine, 36)
  // A broken file starts fresh rather than crashing.
  const c = fileLedger({ file: join(dir, 'missing.json') })
  assert.equal(c.summary().used, 0)
})

test('caps from env', () => {
  assert.deepEqual(capsFromEnv({}), DEFAULT_CAPS)
  assert.deepEqual(capsFromEnv({ S2T_BUDGET: '5', S2T_BUDGET_DAY: '3', S2T_BUDGET_SESSION: 'x' }), { total: 5, day: 3, session: 40, ipDay: 80 })
})

test('client IP: last X-Forwarded-For hop (the one Traefik appended), else the socket', () => {
  const req = (xff, addr = '::ffff:10.0.0.2') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: addr } })
  assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9')
  assert.equal(clientIp(req('1.1.1.1, 203.0.113.9')), '203.0.113.9')
  assert.equal(clientIp(req('')), '10.0.0.2')
  assert.equal(clientIp(req('1.1.1.1'), false), '10.0.0.2')
})

test('several actions charge all or nothing', () => {
  const l = createLedger({ caps: { session: 3 } })
  const who = { session: 's', ip: 'i' }
  assert.equal(l.charge(['point', 'intent-muse'], who).mine, 0)
  const r = l.charge(['point', 'intent-deterministic'], who)
  assert.equal(r.ok, false); assert.equal(r.units, 1)
  assert.equal(l.summary().used, 3)
  assert.equal(l.charge(['intent-deterministic'], who).ok, true)
  l.refund(['point', 'intent-muse'], who)
  assert.equal(l.summary().used, 0)
})

test('session ids and IPs are stored hashed, with a salt that persists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  const file = join(dir, 'ledger.json')
  const a = fileLedger({ file })
  a.charge('point', { session: 'session-abc', ip: '203.0.113.9' })
  const raw = readFileSync(file, 'utf-8')
  assert.doesNotMatch(raw, /session-abc|203\.0\.113\.9/)
  const b = fileLedger({ file })
  assert.equal(b.view({ session: 'session-abc', ip: '203.0.113.9' }).mine, 39)
})
