// Live demo tier C: "run it on a public page". A visitor posts a URL; we check it is public (src/lib/public-url.js),
// charge one run (25 units, ledger.chargeRun), and queue it. One job runs at a time, at most 5 wait (else 503). A job:
//   copy     scripts/mirror-site.mjs --public: the page + its same-origin files, 5 MB cap, every browser request
//            checked (public hosts only)
//   run      s2t run --serve <mirror> --run <dir> with S2T_SEGMENTER=hybrid S2T_NAMER=baseten (as breadth-run.mjs),
//            S2T_NET_GUARD=1 so capture and verify browsers can only reach public hosts and the run's own local servers
//   focus    s2t focus --run <dir> --cap 40, only if 25 s of the job's time is left (reported, not required)
//   report   the review report slimmed (scripts/slim-report.mjs), a result page with the verify table, the text
//            contrast and focus summaries, the token file and the first 40 rewritten values
// 90 s hard limit for the whole job (the child process tree is killed); a timeout, crash or a site we could not copy
// refunds the run. Results live under $S2T_DATA/runs/<16-char id>/public, unlisted and noindex, deleted after 24 h
// (swept on boot and on every new job); the raw run (screenshots, the mirror) is deleted as soon as the page is built.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, createReadStream } from 'node:fs'
import { join, normalize, sep, extname, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { followRedirects } from '../lib/public-url.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const STEPS = ['copy', 'capture', 'segment', 'name', 'rewrite', 'verify', 'focus', 'report']
const ID_RE = /^[A-Za-z0-9]{16}$/
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 16 random characters from [A-Za-z0-9] (rejection sampling, no modulo bias). */
export function newId() {
  let out = ''
  while (out.length < 16) for (const b of randomBytes(32)) if (b < 248 && out.length < 16) out += ALNUM[b % 62]
  return out
}
export const validId = (id) => ID_RE.test(String(id || ''))

/** The pipeline's stage log lines ("  capture  …") mark the END of a stage; this is the step that starts next. */
export function stepAfter(line) {
  const m = /^ {2}(capture|segment|cluster|name|emit|rewrite|verify|report)\s/.exec(line)
  if (!m) return null
  return { capture: 'segment', segment: 'name', cluster: 'name', name: 'rewrite', emit: 'rewrite', rewrite: 'verify', verify: 'report', report: 'report' }[m[1]]
}

/** Every descendant pid of `pid` (Linux /proc, else `ps`), deepest first. */
function descendants(pid) {
  const kids = new Map()
  try {
    if (existsSync('/proc/self/stat')) {
      for (const d of readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue
        try { const s = readFileSync(`/proc/${d}/stat`, 'utf-8'); const ppid = Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]); (kids.get(ppid) || kids.set(ppid, []).get(ppid)).push(Number(d)) } catch (e) { /* gone */ }
      }
    } else {
      for (const line of String(execFileSync('ps', ['-A', '-o', 'pid=,ppid='])).split('\n')) {
        const [p, pp] = line.trim().split(/\s+/).map(Number)
        if (p) (kids.get(pp) || kids.set(pp, []).get(pp)).push(p)
      }
    }
  } catch (e) { /* best effort */ }
  const out = []
  const walk = (p) => { for (const c of kids.get(p) || []) { walk(c); out.push(c) } }
  walk(pid)
  return out
}
/** Kill a child and everything it started (Playwright's Chromium runs in its own process group). */
export function killTree(child) {
  if (!child || child.exitCode != null) return
  const tree = descendants(child.pid)
  try { child.kill('SIGTERM') } catch (e) { /* gone */ }
  setTimeout(() => {
    for (const p of [...tree, child.pid]) { try { process.kill(p, 'SIGKILL') } catch (e) { /* gone */ } }
  }, 1500).unref()
}

/**
 * Run a node script as a child; resolve {code, out, timedOut}. onLine gets each stdout/stderr line.
 * @returns {{promise:Promise<{code:number|null, out:string, timedOut:boolean}>, child:any}}
 */
function runChild(args, { env, timeoutMs, onLine }) {
  const child = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', buf = '', timedOut = false
  const take = (d) => {
    const s = String(d)
    out = (out + s).slice(-20000)
    buf += s
    let i
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (onLine) onLine(line) }
  }
  child.stdout.on('data', take)
  child.stderr.on('data', take)
  const t = setTimeout(() => { timedOut = true; killTree(child) }, Math.max(1000, timeoutMs))
  const promise = new Promise((done) => child.on('close', (code) => { clearTimeout(t); done({ code, out, timedOut }) }))
  return { promise, child }
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf-8')) } catch (e) { return null } }

const REASONS = {
  total: 'The demo budget is used up for now.',
  'runs-day': 'Today\'s runs are used up.',
  'runs-session': 'That\'s the most runs for one visit.',
  'runs-ip': 'This network has used today\'s runs.',
}

/**
 * @param {{dataDir:string, ledger:any, log?:(s:string)=>void, timeoutMs?:number, maxWaiting?:number, keepMs?:number,
 *   env?:Record<string,string|undefined>, preflight?:typeof followRedirects, now?:()=>number,
 *   pipeline?:(job:any, ctx:any)=>Promise<void>}} o
 *   pipeline: replaces the real copy/run/report steps (tests).
 */
export function createRunService(o) {
  const log = o.log || (() => {})
  const runsDir = join(o.dataDir, 'runs')
  mkdirSync(runsDir, { recursive: true })
  const timeoutMs = o.timeoutMs || Number(process.env.S2T_RUN_TIMEOUT_MS) || 90000
  const maxWaiting = o.maxWaiting == null ? 5 : o.maxWaiting
  const keepMs = o.keepMs || 24 * 3600 * 1000
  const now = o.now || Date.now
  const preflight = o.preflight || followRedirects
  /** @type {Map<string, any>} */
  const jobs = new Map()
  const waiting = []
  let running = null

  const dirOf = (id) => join(runsDir, id)
  const save = (job) => { try { mkdirSync(dirOf(job.id), { recursive: true }); writeFileSync(join(dirOf(job.id), 'job.json'), JSON.stringify(job)) } catch (e) { log(`run ${job.id}: could not save job (${e.message})`) } }

  /** Delete results older than keepMs. On boot, jobs that were queued or running are failed and refunded. */
  function sweep(boot = false) {
    let removed = 0
    for (const id of readdirSync(runsDir)) {
      const d = dirOf(id)
      const job = readJson(join(d, 'job.json'))
      let born = job && job.createdAt ? Date.parse(job.createdAt) : NaN
      if (!Number.isFinite(born)) { try { born = statSync(d).mtimeMs } catch (e) { born = 0 } }
      if (now() - born > keepMs) {
        if (running && running.id === id) continue
        rmSync(d, { recursive: true, force: true }); jobs.delete(id); removed++
        continue
      }
      if (boot && job && (job.status === 'queued' || job.status === 'running')) {
        if (job.who && job.charge) o.ledger.refundRun(job.who, job.charge.day)
        Object.assign(job, { status: 'failed', error: 'The server restarted during this run; it was not charged.', who: undefined, refunded: true })
        save(job)
        for (const sub of ['run', 'mirror']) rmSync(join(d, sub), { recursive: true, force: true })
      }
    }
    if (removed) log(`runs: swept ${removed} results older than ${Math.round(keepMs / 3600000)} h`)
    return removed
  }
  sweep(true)

  function publicView(job) {
    if (!job) return null
    const order = running ? [running, ...waiting] : [...waiting]
    const pos = order.indexOf(job)
    return {
      id: job.id, url: job.url, status: job.status, step: job.step || null, steps: STEPS,
      position: pos >= 0 ? pos + 1 : null,
      ms: job.startedAt ? (job.finishedAt ? Date.parse(job.finishedAt) : now()) - Date.parse(job.startedAt) : 0,
      waitedMs: job.startedAt ? Date.parse(job.startedAt) - Date.parse(job.createdAt) : now() - Date.parse(job.createdAt),
      error: job.error || null, refunded: !!job.refunded,
      result: job.status === 'done' ? { page: `/run/${job.id}/`, report: `/run/${job.id}/report.html`, tokens: `/run/${job.id}/tokens.css`, summary: job.summary || null } : null,
    }
  }

  function get(id) {
    if (!validId(id)) return null
    const job = jobs.get(id) || readJson(join(dirOf(id), 'job.json'))
    return job ? publicView(job) : null
  }

  const queueInfo = () => ({ running: running ? 1 : 0, waiting: waiting.length, max: maxWaiting })
  const full = () => waiting.length >= maxWaiting

  /**
   * Submit a URL. Returns {status, body}: 202 {id, ...} queued; 400 refused (no charge); 429 cap (no charge);
   * 503 busy (no charge).
   * @param {string} url @param {{session?:string, ip?:string}} who
   */
  async function submit(url, who) {
    if (full()) return { status: 503, body: { error: 'Busy, try in a minute.', code: 'busy', queue: queueInfo() } }
    const v = await preflight(url)
    if (!v.ok) return { status: 400, body: { error: v.reason, code: v.code || 'refused' } }
    if (v.status >= 400) return { status: 400, body: { error: `That page answered ${v.status}; only pages that load can be run.`, code: 'http-error' } }
    if (v.type && !/text\/html|application\/xhtml/i.test(v.type)) return { status: 400, body: { error: `That address is not a web page (${v.type.split(';')[0]}).`, code: 'not-html' } }
    if (v.length && v.length > 5 * 1024 * 1024) return { status: 400, body: { error: 'That page is over 5 MB.', code: 'too-big' } }
    if (full()) return { status: 503, body: { error: 'Busy, try in a minute.', code: 'busy', queue: queueInfo() } }
    const charge = o.ledger.chargeRun(who)
    if (!charge.ok) return { status: 429, body: { error: REASONS[charge.reason] || 'The demo budget is used up for now.', code: 'budget', reason: charge.reason, budget: { left: charge.left, total: charge.total, runsLeft: charge.runsLeft } } }
    sweep()
    const job = { id: newId(), url: String(url).trim(), target: v.url, status: 'queued', step: null, createdAt: new Date(now()).toISOString(), who, charge: { day: charge.day, units: charge.units } }
    jobs.set(job.id, job)
    waiting.push(job)
    save(job)
    log(`run ${job.id}: queued ${job.target} (position ${waiting.length + (running ? 1 : 0)}; ${charge.left} units left)`)
    pump() // starts at once when nothing is running (synchronously takes the job off the queue)
    return { status: 202, body: { ...publicView(job), budget: { left: charge.left, total: charge.total, runsLeft: charge.runsLeft } } }
  }

  async function pump() {
    if (running || !waiting.length) return
    const job = waiting.shift()
    running = job
    job.status = 'running'; job.step = 'copy'; job.startedAt = new Date(now()).toISOString()
    save(job)
    const deadline = Date.now() + timeoutMs
    let failure = null
    try {
      await (o.pipeline || realPipeline)(job, { deadline, dir: dirOf(job.id), log, env: o.env || process.env, save: () => save(job) })
    } catch (e) {
      failure = e
    }
    job.finishedAt = new Date(now()).toISOString()
    const ms = Date.parse(job.finishedAt) - Date.parse(job.startedAt)
    if (failure) {
      o.ledger.refundRun(job.who, job.charge.day)
      Object.assign(job, { status: 'failed', error: failure.userMessage || 'The run failed on our side.', refunded: true })
      log(`run ${job.id}: failed after ${ms} ms at ${job.step}: ${String(failure.message || failure).slice(0, 200)} (refunded)`)
    } else {
      job.status = 'done'
      log(`run ${job.id}: done in ${ms} ms${job.summary ? ` (${job.summary.tokens} tokens, ${job.summary.edits} edits, fallback ${job.summary.fallbackPx} px)` : ''}`)
    }
    job.who = undefined
    save(job)
    for (const sub of ['run', 'mirror']) rmSync(join(dirOf(job.id), sub), { recursive: true, force: true })
    running = null
    setImmediate(pump)
  }

  /** The real job: copy → run → (focus) → result page. Throws an Error with .userMessage on failure. */
  async function realPipeline(job, ctx) {
    const left = () => ctx.deadline - Date.now()
    const fail = (msg, user) => Object.assign(new Error(msg), { userMessage: user })
    const mirror = join(ctx.dir, 'mirror'), runDir = join(ctx.dir, 'run'), pub = join(ctx.dir, 'public')
    const env = {
      ...ctx.env, S2T_SEGMENTER: 'hybrid', S2T_NAMER: 'baseten', S2T_NET_GUARD: '1', S2T_CACHE: '0',
      S2T_GOTO_TIMEOUT_MS: '30000', S2T_EXTERNAL_TIMEOUT_MS: ctx.env.S2T_EXTERNAL_TIMEOUT_MS || '30000',
    }
    const timing = {}
    let t = Date.now()
    // 1. copy
    const m = runChild(['scripts/mirror-site.mjs', job.target, mirror, '--public'], { env, timeoutMs: Math.min(35000, left()) })
    const mr = await m.promise
    timing.copy = Date.now() - t
    if (mr.timedOut) throw fail('mirror timeout', 'The page took too long to load (over 30 s). The run was refunded.')
    if (mr.code === 3) throw fail('mirror too big', 'That page and its files are over 5 MB, too big for the live demo. The run was refunded.')
    const files = Number((mr.out.match(/mirror: (\d+) files/) || [])[1] || 0)
    if (mr.code !== 0 || !files || !existsSync(join(mirror, 'index.html'))) throw fail(`mirror failed: ${mr.out.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`, 'We could not copy that page. The run was refunded.')
    // 2. run
    job.step = 'capture'; ctx.save()
    t = Date.now()
    const r = runChild(['src/cli.js', 'run', '--serve', mirror, '--run', runDir], {
      env, timeoutMs: left(),
      onLine: (line) => { const next = stepAfter(line); if (next && next !== job.step) { timing[job.step] = Date.now() - t; t = Date.now(); job.step = next; ctx.save() } },
    })
    const rr = await r.promise
    if (rr.timedOut) throw fail('run timeout', `The run took longer than ${Math.round(timeoutMs / 1000)} s and was stopped. The run was refunded.`)
    if (rr.code !== 0 || !existsSync(join(runDir, 'report.html'))) throw fail(`run failed: ${rr.out.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`, 'The run failed on our side. The run was refunded.')
    timing[job.step] = Date.now() - t
    // 3. focus (only if there is time; reported, not required)
    if (left() > 25000 && existsSync(join(runDir, 'regions.json'))) {
      job.step = 'focus'; ctx.save()
      t = Date.now()
      const f = runChild(['src/cli.js', 'focus', '--run', runDir, '--cap', '40'], { env, timeoutMs: left() - 4000 })
      const fr = await f.promise
      timing.focus = Date.now() - t
      if (fr.code !== 0) ctx.log(`run ${job.id}: focus skipped (${fr.timedOut ? 'out of time' : 'failed'})`)
    }
    // 4. result page
    job.step = 'report'; ctx.save()
    t = Date.now()
    const { slimReport } = await import('../../scripts/slim-report.mjs')
    slimReport(runDir, pub, job.target)
    job.summary = writeResultPage({ runDir, pubDir: pub, url: job.target, at: new Date(now()), timing, files })
    timing.report = Date.now() - t
    job.timing = timing
  }

  /** HTTP: POST /api/run {url}, GET /api/run (status for this visitor), GET /api/run/<id>. */
  async function handleApi(req, res, path, who) {
    const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); res.end(JSON.stringify(v)) }
    if (path === '/api/run' && req.method === 'POST') {
      let body
      try { body = JSON.parse(String(await readBody(req, 4096)) || '{}') } catch (e) { return json(400, { error: 'Send JSON: {"url": "https://…"}', code: 'bad-request' }) }
      const r = await submit(body && body.url, who)
      return json(r.status, r.body)
    }
    if (path === '/api/run' && req.method === 'GET') {
      const v = o.ledger.runView(who)
      return json(200, { budget: { left: v.left, total: v.total }, runsLeft: v.runsLeft, reason: v.reason, cost: v.cost, caps: v.caps, queue: queueInfo() })
    }
    const m = /^\/api\/run\/([^/]+)$/.exec(path)
    if (m && req.method === 'GET') {
      const v = get(m[1])
      return v ? json(200, v) : json(404, { error: 'No such run (results are deleted after 24 hours).', code: 'not-found' })
    }
    return json(405, { error: 'method not allowed' })
  }

  /** Static files of a finished result: /run/<id>/… from runs/<id>/public. Returns false when not a result path. */
  function serveResult(req, res, path, types) {
    const m = /^\/run\/([^/]+)(\/.*)?$/.exec(path)
    if (!m) return false
    const notFound = () => { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' }); res.end('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title><p>No such result. Results are deleted after 24 hours. <a href="/">Back to Screenshot to Tokens</a>.</p>') }
    if (!validId(m[1])) { notFound(); return true }
    if (!m[2]) { res.writeHead(301, { location: `/run/${m[1]}/` }); res.end(); return true }
    const root = join(dirOf(m[1]), 'public')
    let rel = m[2]
    if (rel.endsWith('/')) rel += 'index.html'
    const file = normalize(join(root, rel))
    if (!file.startsWith(root + sep)) { notFound(); return true }
    let st
    try { st = statSync(file) } catch (e) { st = null }
    if (!st || !st.isFile()) { notFound(); return true }
    const ext = extname(file).toLowerCase()
    const headers = { 'content-type': (types && types[ext]) || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
    if (ext === '.css' || ext === '.json') headers['content-disposition'] = `attachment; filename="${ext === '.css' ? 'tokens.css' : 'tokens.dtcg.json'}"`
    // The report is our HTML, but it quotes text from the visitor's page: no scripts from anywhere else, no frames.
    if (ext === '.html') headers['content-security-policy'] = "default-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
    res.writeHead(200, headers)
    if (req.method === 'HEAD') { res.end(); return true }
    createReadStream(file).on('error', () => res.destroy()).pipe(res)
    return true
  }

  return { submit, get, sweep, handleApi, serveResult, queueInfo, jobs, _state: () => ({ running, waiting }) }
}

function readBody(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => { n += c.length; if (n > limit) { fail(new Error('body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

/** The first `max` rewritten values, grouped by file and line, as diff lines. */
export function rewriteExcerpt(edits, max = 40) {
  const lines = []
  let last = ''
  for (const e of (edits || []).slice(0, max)) {
    const where = `${e.file}:${e.line}`
    if (where !== last) { lines.push({ kind: 'file', text: `@@ ${where}` }); last = where }
    lines.push({ kind: 'del', text: `- ${e.prop}: ${e.before}` })
    lines.push({ kind: 'add', text: `+ ${e.prop}: ${e.after}` })
  }
  return lines
}

/** The verify rows the result page shows (and the job summary keeps). */
export function verifyRows(v) {
  if (!v) return []
  const pct = (x) => `${(x.ratio * 100).toFixed(3)}%`
  const rows = [
    { check: 'Fallbacks only (the rewrite, no tokens loaded)', result: `${v.fallback.diffPixels} px changed`, verdict: v.fallback.pass ? 'pass' : 'fail', gate: true },
    { check: 'Colors merged (color tokens loaded)', result: `${pct(v.colors)} of pixels changed`, verdict: v.colors.pass ? 'pass' : 'fail', gate: true },
    { check: 'Cleanup (every token loaded)', result: `${pct(v)} of pixels changed`, verdict: v.allTokensWithinThreshold ? 'within threshold' : 'for review', gate: false },
  ]
  const c = v.contrast
  if (c && !c.error) rows.push({ check: 'Text contrast (WCAG 2.x AA, SC 1.4.3)', result: `${c.failingBefore} of ${c.pairs} text pairs below AA before; ${c.regressions.length} made worse`, verdict: c.pass ? 'pass' : 'fail', gate: true })
  else if (c) rows.push({ check: 'Text contrast (WCAG 2.x AA, SC 1.4.3)', result: 'not measured', verdict: 'n/a', gate: false })
  const noise = v.fallback.noisePixels
  if (noise) rows.push({ check: 'Page moves on its own', result: `${noise} px differ between two loads of the unchanged page; excluded`, verdict: 'note', gate: false })
  return rows
}

/** Write public/index.html for one result; returns the summary kept in job.json. */
export function writeResultPage({ runDir, pubDir, url, at, timing, files }) {
  const rd = (n) => readJson(join(runDir, `${n}.json`))
  const tokens = rd('tokens'), rewrite = rd('rewrite'), verify = rd('verify'), focus = rd('focus')
  const edits = rewrite ? rewrite.edits : []
  const rows = verifyRows(verify)
  const excerpt = rewriteExcerpt(edits, 40)
  const fileCount = rewrite ? new Set(edits.map((e) => e.file)).size : 0
  const nTokens = tokens ? (tokens.tokens || []).length : 0
  const when = at.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const fb = focus && focus.before
  const summary = { tokens: nTokens, edits: edits.length, files: fileCount, fallbackPx: verify ? verify.fallback.diffPixels : null, colorsPass: verify ? verify.colors.pass : null, contrast: verify && verify.contrast && !verify.contrast.error ? { pairs: verify.contrast.pairs, failingBefore: verify.contrast.failingBefore, regressions: verify.contrast.regressions.length } : null, focus: fb ? { stops: fb.stops, measured: fb.measured, pass: fb.pass, faint: fb.faint, none: fb.none } : null, timing }
  const verdictCell = (r) => `<td class="v ${r.verdict === 'pass' ? 'pass' : r.verdict === 'fail' ? 'flag' : ''}">${esc(r.verdict)}</td>`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Run result · Screenshot to Tokens</title>
<style>
:root { color-scheme: dark; --bg: #0f1115; --raised: #161920; --border: #2c313c; --text: #e8e8e4; --muted: #a3a39d; --good: #7ee2a8; --note: #f5c46b; --link: #8a9af0; --del: #ff9d9d; --add: #7ee2a8; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--link); }
a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; border-radius: 4px; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.8rem; margin: 8px 0 6px; letter-spacing: -.3px; }
h2 { font-size: 1.25rem; margin: 32px 0 8px; }
.gen { color: var(--muted); margin: 0 0 18px; overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 12px; padding: 0; margin: 0; list-style: none; }
.stats li { background: var(--raised); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; }
.stats b { display: block; font-size: 1.4rem; }
.table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: .95rem; }
th, td { text-align: left; vertical-align: top; padding: 9px 14px; border-bottom: 1px solid var(--border); }
thead th { color: var(--muted); font-weight: 600; font-size: .85rem; }
tbody tr:last-child td { border-bottom: 0; }
td.pass { color: var(--good); font-weight: 600; } td.flag { color: var(--note); font-weight: 600; }
.links { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; list-style: none; }
.links a { display: inline-block; background: var(--raised); border: 1px solid var(--border); border-radius: 10px; padding: 8px 14px; font-weight: 600; text-decoration: none; }
pre { background: var(--raised); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; overflow-x: auto; font: 13px/1.5 ui-monospace, Menlo, monospace; margin: 0; }
pre .file { color: var(--muted); } pre .del { color: var(--del); } pre .add { color: var(--add); }
</style>
</head>
<body>
<main class="wrap">
<p><a href="/">← Screenshot to Tokens</a></p>
<h1>Run result</h1>
<p class="gen">Generated from <a href="${esc(url)}" rel="nofollow noopener noreferrer">${esc(url)}</a> on ${esc(when)}. Your site's code was not changed; this is a copy.</p>
<ul class="stats">
  <li><b>${nTokens}</b>tokens proposed</li>
  <li><b>${edits.length}</b>hardcoded values rewritten${fileCount ? ` in ${fileCount} file${fileCount === 1 ? '' : 's'}` : ''}</li>
  <li><b>${files}</b>files copied</li>
</ul>
${edits.length ? '' : '<p class="muted">No values were rewritten: the page\'s styles were not in a same-origin stylesheet the rewrite could reach (inline styles or a CDN stylesheet). The proposed tokens are still in the report and tokens.css.</p>'}
<h2>Checks on the rewritten copy</h2>
<div class="table-scroll"><table>
<thead><tr><th>Check</th><th>Result</th><th>Verdict</th></tr></thead>
<tbody>
${rows.map((r) => `<tr><td>${esc(r.check)}${r.gate ? '' : ' <span class="muted">(reported, not a gate)</span>'}</td><td>${esc(r.result)}</td>${verdictCell(r)}</tr>`).join('\n')}
${fb ? `<tr><td>Visible keyboard focus <span class="muted">(reported, not a gate; first ${esc(focus.cap)} Tab stops)</span></td><td>${esc(fb.stops)} Tab stops, ${esc(fb.measured)} measured: ${esc(fb.pass)} with a visible focus ring, ${esc(fb.faint)} faint, ${esc(fb.none)} with none</td><td class="v">reported</td></tr>` : ''}
</tbody></table></div>
<p class="muted">Fallbacks only must be 0 px: every rewritten value keeps the original as its fallback, so the page looks the same before the token file loads. Checked on this one page at 1440 px wide; hover and focus states, other routes and other screen sizes are not checked.</p>
<h2>Downloads</h2>
<ul class="links">
  <li><a href="report.html">The review report</a></li>
  <li><a href="tokens.css" download="tokens.css"><code>tokens.css</code></a></li>
  ${existsSync(join(pubDir, 'tokens.dtcg.json')) ? '<li><a href="tokens.dtcg.json" download="tokens.dtcg.json"><code>tokens.dtcg.json</code> (DTCG)</a></li>' : ''}
</ul>
<h2>What the rewrite would be</h2>
<p class="muted">${edits.length > 40 ? `The first 40 of ${edits.length} rewritten values` : `All ${edits.length} rewritten values`}, as <code>property: before → after</code>. Each keeps the original value as the fallback.</p>
${excerpt.length ? `<pre>${excerpt.map((l) => `<span class="${l.kind}">${esc(l.text)}</span>`).join('\n')}</pre>` : '<p class="muted">Nothing to show.</p>'}
<p class="muted">This result is unlisted and is deleted 24 hours after the run.</p>
</main>
</body>
</html>
`
  mkdirSync(pubDir, { recursive: true })
  writeFileSync(join(pubDir, 'index.html'), html)
  return summary
}
