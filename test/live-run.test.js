import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRunService, newId, validId, stepAfter, rewriteExcerpt, verifyRows, writeResultPage } from '../src/stages/live-run.js'
import { createLedger } from '../src/stages/pas/ledger.js'

const okPreflight = async (url) => ({ ok: true, url, status: 200, type: 'text/html; charset=utf-8', length: 1000 })
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 3000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await tick() } }

test('ids: 16 alphanumeric characters, validated', () => {
  const ids = new Set(Array.from({ length: 200 }, newId))
  assert.equal(ids.size, 200)
  for (const id of ids) assert.ok(validId(id), id)
  for (const bad of ['', '../../etc/passwd', 'abc', 'A'.repeat(17), 'aaaaaaaaaaaaaaa/']) assert.equal(validId(bad), false)
})

test('stepAfter maps pipeline log lines to the next step', () => {
  assert.equal(stepAfter('  capture  812 elements, screenshot.png'), 'segment')
  assert.equal(stepAfter('  name     40 tokens via baseten'), 'rewrite')
  assert.equal(stepAfter('  rewrite  12 edits in 2 files'), 'verify')
  assert.equal(stepAfter('  verify   fallback-only 0 px (pass)'), 'report')
  assert.equal(stepAfter('s2t run → /x'), null)
})

test('queue: one at a time, positions 1/2/3, completes in order, 503 when full; 25 units each', async () => {
  const ledger = createLedger({ caps: { total: 1000 }, runCaps: { session: 10, day: 20, ipDay: 10 } })
  const gates = []
  const order = []
  const svc = createRunService({ dataDir: mkdtempSync(join(tmpdir(), 's2t-runs-')), ledger, preflight: okPreflight, maxWaiting: 2,
    pipeline: (job) => new Promise((done) => gates.push(() => { order.push(job.url); done() })) })
  const who = { session: 'sess-1', ip: '1.2.3.4' }
  const a = await svc.submit('https://a.example/', who)
  const b = await svc.submit('https://b.example/', who)
  const c = await svc.submit('https://c.example/', who)
  assert.deepEqual([a.status, b.status, c.status], [202, 202, 202])
  assert.equal(c.body.budget.left, 925)
  await until(() => gates.length === 1)
  assert.deepEqual([svc.get(a.body.id).position, svc.get(b.body.id).position, svc.get(c.body.id).position], [1, 2, 3])
  assert.equal(svc.get(a.body.id).status, 'running')
  const d = await svc.submit('https://d.example/', who)
  assert.equal(d.status, 503)
  assert.equal(ledger.summary().used, 75, 'busy is not charged')
  gates.shift()(); await until(() => gates.length === 1 && svc.get(b.body.id).status === 'running')
  assert.equal(svc.get(a.body.id).status, 'done')
  assert.equal(svc.get(c.body.id).position, 2)
  gates.shift()(); await until(() => gates.length === 1 && svc.get(c.body.id).status === 'running')
  gates.shift()(); await until(() => svc.get(c.body.id).status === 'done')
  assert.deepEqual(order, ['https://a.example/', 'https://b.example/', 'https://c.example/'])
})

test('refused URLs and caps are not charged; a failed run is refunded', async () => {
  const ledger = createLedger({ caps: { total: 1000 }, runCaps: { session: 3, day: 20, ipDay: 10 } })
  const svc = createRunService({ dataDir: mkdtempSync(join(tmpdir(), 's2t-runs-')), ledger,
    preflight: async (u) => (/private/.test(u) ? { ok: false, reason: 'not public', code: 'refused' } : okPreflight(u)),
    pipeline: async (job) => { if (/boom/.test(job.url)) throw Object.assign(new Error('x'), { userMessage: 'The run took longer than 90 s and was stopped. The run was refunded.' }) } })
  const who = { session: 's', ip: '5.6.7.8' }
  const r = await svc.submit('http://private.example/', who)
  assert.equal(r.status, 400); assert.equal(r.body.code, 'refused')
  assert.equal(ledger.summary().used, 0)
  const boom = await svc.submit('https://boom.example/', who)
  assert.equal(boom.status, 202)
  await until(() => svc.get(boom.body.id).status === 'failed')
  const v = svc.get(boom.body.id)
  assert.equal(v.refunded, true); assert.match(v.error, /90 s/)
  assert.equal(ledger.summary().used, 0)
  assert.equal(ledger.runView(who).runsLeft, 3)
  for (let i = 0; i < 3; i++) { const x = await svc.submit(`https://ok${i}.example/`, who); assert.equal(x.status, 202) }
  const capped = await svc.submit('https://ok4.example/', who)
  assert.equal(capped.status, 429); assert.equal(capped.body.reason, 'runs-session')
  assert.equal(ledger.summary().used, 75)
})

test('non-HTML and error pages are refused before charging', async () => {
  const ledger = createLedger({})
  const svc = createRunService({ dataDir: mkdtempSync(join(tmpdir(), 's2t-runs-')), ledger,
    preflight: async (u) => ({ ok: true, url: u, status: /404/.test(u) ? 404 : 200, type: /pdf/.test(u) ? 'application/pdf' : 'text/html', length: null }), pipeline: async () => {} })
  assert.equal((await svc.submit('https://x.example/404', {})).body.code, 'http-error')
  assert.equal((await svc.submit('https://x.example/a.pdf', {})).body.code, 'not-html')
  assert.equal(ledger.summary().used, 0)
})

test('sweep: results older than 24 h are deleted; jobs left running at boot are failed and refunded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-runs-'))
  const ledger = createLedger({})
  const who = { session: 'boot', ip: '9.9.9.9' }
  const ch = ledger.chargeRun(who)
  const old = join(dir, 'runs', 'OldOldOldOldOld1'), mid = join(dir, 'runs', 'MidMidMidMidMid1')
  mkdirSync(join(old, 'public'), { recursive: true }); mkdirSync(join(mid, 'run'), { recursive: true })
  writeFileSync(join(old, 'job.json'), JSON.stringify({ id: 'OldOldOldOldOld1', status: 'done', createdAt: new Date(Date.now() - 25 * 3600e3).toISOString() }))
  writeFileSync(join(mid, 'job.json'), JSON.stringify({ id: 'MidMidMidMidMid1', status: 'running', createdAt: new Date().toISOString(), who, charge: { day: ch.day } }))
  const svc = createRunService({ dataDir: dir, ledger, preflight: okPreflight, pipeline: async () => {} })
  assert.equal(existsSync(old), false)
  assert.equal(existsSync(join(mid, 'run')), false)
  assert.equal(svc.get('MidMidMidMidMid1').status, 'failed')
  assert.equal(ledger.summary().used, 0)
})

test('result page: header line, verify rows, rewrite excerpt, noindex; no verdict words', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-res-'))
  const run = join(dir, 'run'), pub = join(dir, 'public')
  mkdirSync(run); mkdirSync(pub)
  const edits = Array.from({ length: 45 }, (_, i) => ({ file: 'css/site.css', line: 1 + Math.floor(i / 10), prop: 'color', before: '#333', after: 'var(--color-text-default, #333)', token: 'color.text.default' }))
  writeFileSync(join(run, 'rewrite.json'), JSON.stringify({ edits }))
  writeFileSync(join(run, 'tokens.json'), JSON.stringify({ tokens: [{}, {}, {}] }))
  writeFileSync(join(run, 'verify.json'), JSON.stringify({ ratio: 0.002, allTokensWithinThreshold: false, fallback: { diffPixels: 0, pass: true, noisePixels: 0 }, colors: { ratio: 0, pass: true }, contrast: { pairs: 31, failingBefore: 25, regressions: [], pass: true } }))
  writeFileSync(join(run, 'focus.json'), JSON.stringify({ cap: 40, before: { stops: 12, measured: 12, pass: 2, faint: 1, none: 9 } }))
  const s = writeResultPage({ runDir: run, pubDir: pub, url: 'https://x.example/<b>', at: new Date('2026-11-01T20:00:00Z'), timing: {}, files: 4 })
  assert.deepEqual([s.tokens, s.edits, s.fallbackPx, s.focus.none], [3, 45, 0, 9])
  const html = readFileSync(join(pub, 'index.html'), 'utf-8')
  assert.match(html, /Generated from <a href="https:\/\/x\.example\/&lt;b&gt;"[^>]*>https:\/\/x\.example\/&lt;b&gt;<\/a> on 2026-11-01 20:00 UTC\. Your site's code was not changed; this is a copy\./)
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/)
  assert.match(html, /The first 40 of 45 rewritten values/)
  assert.equal((html.match(/class="add"/g) || []).length, 40)
  assert.match(html, /25 of 31 text pairs below AA before; 0 made worse/)
  assert.doesNotMatch(html, /\b(accessible|compliant|compliance)\b/i)
  assert.equal(rewriteExcerpt(edits, 40).filter((l) => l.kind === 'file').length, 4)
  assert.equal(verifyRows(null).length, 0)
})

test('serveResult: only valid ids, no path escape, noindex header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-runs-'))
  const svc = createRunService({ dataDir: dir, ledger: createLedger({}), preflight: okPreflight, pipeline: async () => {} })
  const id = 'AbCdEfGhIjKlMnOp'
  mkdirSync(join(dir, 'runs', id, 'public'), { recursive: true })
  writeFileSync(join(dir, 'runs', id, 'public', 'index.html'), '<p>ok</p>')
  writeFileSync(join(dir, 'runs', id, 'job.json'), '{"secret":1}')
  const fake = () => { const r = { status: 0, headers: {}, body: '', writeHead(s, h) { r.status = s; Object.assign(r.headers, h || {}) }, end(b) { if (b) r.body += b }, on() { return r }, once() { return r }, emit() {}, write(b) { r.body += b; return true }, removeListener() {} }; return r }
  const get = (p) => { const res = fake(); const handled = svc.serveResult({ method: 'GET' }, res, p, { '.html': 'text/html' }); return { handled, res } }
  assert.equal(get('/run/../../etc/passwd').res.status, 404)
  assert.equal(get(`/run/${id}/../job.json`).res.status, 404)
  assert.equal(get('/run/short/').res.status, 404)
  const ok = get(`/run/${id}/`)
  assert.equal(ok.res.status, 200)
  assert.match(ok.res.headers['x-robots-tag'], /noindex/)
  assert.equal(get('/other').handled, false)
})
