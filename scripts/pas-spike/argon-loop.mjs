// Spike test 2: one full point-and-say loop on Argon, in a real Chromium page of the served tokenized app.
//   click "Since last month" -> /__pas/api/point (SAM 3.1 point prompt + element + tokens + twins)
//   speak phrase (a) through the fake mic -> in-page WAV -> /__pas/api/transcribe (muse-voice-transcribe-1.0)
//   route -> contrast: find the token that controls the clicked text (sentinel probe), every pair using it
//   (sentinel probe over the whole page), contrastFix() -> setProperty -> auditLive over the whole page.
// Then phrase (e) on the "Month" button through Muse Spark Open, restricted to tokens touching it and its twins.
// Usage: S2T_CACHE_DIR=<fresh dir> node scripts/pas-spike/argon-loop.mjs [run] [phrasesDir]
import { readFileSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { chromium } from 'playwright'
import { loadDotEnv } from '../../src/config.js'
import { startPasServer } from '../../src/stages/pas/server.js'
import { loadPointContext, pointAt, elementAt, tokensForElement } from '../../src/stages/pas/point.js'
import { routeIntent } from '../../src/stages/pas/route.js'
import { contrastFix } from '../../src/stages/pas/contrast-fix.js'
import { museIntent } from '../../src/stages/pas/intent.js'
import { pairsFromCapture, cssVarName } from '../../src/preview-client/contrast.js'

loadDotEnv()
const run = process.argv[2] || 'out/pas-spike/argon'
const phrases = resolve(process.argv[3] || 'out/pas-spike/phrases')
const SENTINEL = '#ff00fe'
const CLICK = { x: 430, y: 222 } // "Since last month" in the Traffic stat card (capture bbox [378,213,104,19])
const MONTH = { x: 873, y: 328 } // the "Month" button
const wavMs = (f) => { const b = readFileSync(f); return Math.round(((b.length - 44) / b.readUInt32LE(28)) * 1000) }
const time = async (fn) => { const t0 = Date.now(); const v = await fn(); return [v, Date.now() - t0] }

const [pctx, loadMs] = await time(() => loadPointContext(run))
const tokensJson = pctx.tokens
const pairs = pairsFromCapture(pctx.capture)
const server = await startPasServer({ appDir: join(run, 'site'), point: pctx, log: (s) => console.log('  server', s) })
const wav = `${phrases}/a.wav`
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(server.url, { waitUntil: 'load' })
await page.waitForSelector('.card-stats')
await page.addStyleTag({ content: readFileSync(join(run, 'tokens.css'), 'utf-8') })
await page.evaluate(async () => { window.__c = await import('/__pas/contrast.js') })
const audit = () => page.evaluate((ps) => window.__c.auditLive(document, ps), pairs)
const summary = (rs) => ({ pass: rs.filter((r) => r.status === 'pass').length, fail: rs.filter((r) => r.status === 'fail').length, other: rs.filter((r) => r.status !== 'pass' && r.status !== 'fail').length })
const [before, warmAuditMs] = await time(audit)
console.log(`warm: run loaded in ${loadMs} ms; baseline audit ${warmAuditMs} ms: ${JSON.stringify(summary(before))}`)

// ---- the loop (clock starts at the click) ---------------------------------------------------------------------
const T0 = Date.now()
const pointP = time(() => page.evaluate((c) => fetch('/__pas/api/point', { method: 'POST', body: JSON.stringify(c) }).then((r) => r.json()), CLICK))
const speechP = page.evaluate(async (recMs) => {
  const m = await import('/__pas/wav.js')
  const rec = await m.recordWav({ maxMs: recMs })
  const out = await rec.result
  const t1 = performance.now()
  const body = await fetch('/__pas/api/transcribe', { method: 'POST', body: out.wav }).then((r) => r.json())
  return { ...body, recordMs: out.ms, asrRoundTripMs: Math.round(performance.now() - t1) }
}, wavMs(wav))
const [[point, pointMs], speech] = await Promise.all([pointP, speechP])
const tSpeechDone = Date.now()
console.log(`point ${pointMs} ms (SAM ${point.sam.ms} ms, ${point.sam.source}): ${point.element && point.element.text} [${point.element && point.element.path}] color tokens ${JSON.stringify(point.tokens.color)}`)
console.log(`speech: recorded ${speech.recordMs} ms, ASR ${speech.ms} ms (round trip ${speech.asrRoundTripMs} ms): ${speech.transcript}`)

// Decision.
const [decision, decisionMs] = await time(async () => {
  const route = routeIntent(speech.transcript)
  if (route.route !== 'contrast') return { route }
  const candidates = (point.tokens.color && point.tokens.color.tokens) || []
  // Which candidate actually controls the clicked text? Set each to a sentinel and see if the element's colour follows.
  const controlling = await page.evaluate(({ cands, x, y, s }) => {
    const el = document.elementFromPoint(x, y)
    const root = document.documentElement.style
    for (const c of cands) {
      const v = '--' + c.replace(/[.\s/]+/g, '-').toLowerCase()
      const old = root.getPropertyValue(v)
      root.setProperty(v, s)
      const hit = getComputedStyle(el).color.replace(/\s/g, '') === 'rgb(255,0,254)'
      if (old) root.setProperty(v, old); else root.removeProperty(v)
      if (hit) return c
    }
    return null
  }, { cands: candidates, x: CLICK.x, y: CLICK.y, s: SENTINEL })
  if (!controlling) return { route, candidates, controlling: null }
  // Every text pair on the page whose colour comes from that token (sentinel probe over the whole page).
  const users = await page.evaluate(({ ps, v, s }) => {
    const root = document.documentElement.style
    root.setProperty(v, s)
    const rs = window.__c.auditLive(document, ps)
    root.removeProperty(v)
    return rs.filter((r) => r.fg === s).map((r) => ({ id: r.id, text: r.text, bg: r.bg, required: r.required }))
  }, { ps: pairs, v: '--' + cssVarName(controlling), s: SENTINEL })
  const fix = contrastFix(controlling, users, tokensJson.tokens)
  return { route, candidates, controlling, users, fix }
})
console.log(`decision ${decisionMs} ms: route ${decision.route.route} (${decision.route.matched}); token ${decision.controlling}; ${decision.users ? decision.users.length : 0} pairs use it; fix ${decision.fix ? JSON.stringify({ value: decision.fix.value, from: decision.fix.from, dL: decision.fix.dL, oklch: decision.fix.oklch, error: decision.fix.error }) : '-'}`)

// Apply + re-audit the whole page.
let after = null, applyMs = 0, compare = null
if (decision.fix && !decision.fix.error) {
  ;[after, applyMs] = await time(async () => {
    await page.evaluate(({ v, val }) => document.documentElement.style.setProperty(v, val), { v: '--' + cssVarName(decision.controlling), val: decision.fix.value })
    return audit()
  })
  compare = comparePairs(before, after)
}
const T1 = Date.now()
const loop = {
  click: CLICK, element: point.element, outline: point.outline, twins: point.twins,
  timingsMs: { sam: point.sam.ms, pointEndpoint: pointMs, speechRecorded: speech.recordMs, asr: speech.ms, decision: decisionMs, applyAndAudit: applyMs, clickToDone: T1 - T0, afterSpeechEnds: T1 - tSpeechDone + speech.asrRoundTripMs, processingSequential: point.sam.ms + speech.ms + decisionMs + applyMs },
  transcript: speech.transcript, decision, before: summary(before), after: after && summary(after), compare,
}
console.log(`apply+audit ${applyMs} ms: before ${JSON.stringify(loop.before)} after ${JSON.stringify(loop.after)}`)
if (compare) console.log(`affected ${compare.affected.length} pairs (${compare.fixed} fixed, ${compare.stillFail} still failing); regressions ${compare.regressions.length}; worse but passing ${compare.worseButPass}; token users min ratio ${compare.usersMin}`)
console.log(`timings ${JSON.stringify(loop.timingsMs)}`)

function comparePairs(b, a) {
  const by = new Map(a.map((r) => [r.id, r]))
  const affected = [], regressions = []
  let worseButPass = 0
  for (const r0 of b) {
    const r1 = by.get(r0.id)
    if (!r1 || r0.ratio == null || r1.ratio == null) continue
    if (Math.abs(r1.ratio - r0.ratio) > 0.005) affected.push({ id: r0.id, text: r0.text, bg: r1.bg, from: r0.ratio, to: r1.ratio, required: r0.required, status: `${r0.status}->${r1.status}` })
    if ((r0.status === 'pass' && r1.status === 'fail') || (r1.status === 'fail' && r1.ratio < r0.ratio - 0.005)) regressions.push({ id: r0.id, text: r0.text, from: r0.ratio, to: r1.ratio })
    else if (r1.ratio < r0.ratio - 0.005) worseButPass++
  }
  const users = new Set((decision.users || []).map((u) => u.id))
  const usersAfter = a.filter((r) => users.has(r.id) && r.ratio != null)
  return {
    affected, regressions, worseButPass,
    fixed: affected.filter((x) => x.status === 'fail->pass').length, stillFail: affected.filter((x) => x.status === 'fail->fail').length,
    usersMin: usersAfter.reduce((m, r) => Math.min(m, r.ratio), Infinity), usersAllPass: usersAfter.every((r) => r.status === 'pass'),
    usersRange: { from: [Math.min(...affected.map((x) => x.from)), Math.max(...affected.map((x) => x.from))], to: [Math.min(...affected.map((x) => x.to)), Math.max(...affected.map((x) => x.to))] },
  }
}

// ---- (e) on the Month button through Muse ---------------------------------------------------------------------
await page.evaluate(() => document.documentElement.removeAttribute('style'))
const speechE = JSON.parse(readFileSync('out/pas-spike/speech.json', 'utf-8')).rows.find((r) => r.id === 'e')
const [month, monthMs] = await time(() => pointAt(pctx, MONTH.x, MONTH.y))
// Tokens that touch the clicked element and its twins (value match on each element's captured colours).
const touch = new Set()
const els = [month.element].concat(month.twins.map((t) => elementAt(pctx.capture.elements, t.bbox[0] + t.bbox[2] / 2, t.bbox[1] + t.bbox[3] / 2)))
for (const el of els) for (const v of Object.values(tokensForElement(el, pctx.values))) v.tokens.forEach((n) => touch.add(n))
const colorTokens = tokensJson.tokens.filter((t) => /^color\.|\.(bg|text|border)$/.test(t.name))
const changeable = colorTokens.filter((t) => touch.has(t.name)).map((t) => t.name)
const req = {
  transcript: speechE.transcript, changeable, tokens: colorTokens,
  clicked: { text: month.element && month.element.text, tag: month.element && month.element.tag, classes: month.element && month.element.classes, background: month.element && month.element.background, color: month.element && month.element.color, twins: month.twins.length },
}
const route = routeIntent(req.transcript)
const [muse, museMs] = await time(() => museIntent(req))
let museAudit = null
if (muse.changes.length) {
  await page.evaluate((cs) => cs.forEach((c) => document.documentElement.style.setProperty('--' + c.cssVar, c.css)), muse.changes)
  const a2 = await audit()
  const cmp = comparePairs(before, a2)
  museAudit = { after: summary(a2), regressions: cmp.regressions, affected: cmp.affected.length }
}
console.log(`(e) "${req.transcript}" route ${route.route}; Month point ${monthMs} ms (SAM ${month.sam.ms} ms); twins ${month.twins.map((t) => t.id + ' ' + t.hex + ' dE ' + t.deltaE).join(', ')}; changeable ${changeable.join(', ')}`)
console.log(`    Muse ${muse.provider} ${muse.ms} ms: changes ${JSON.stringify(muse.changes.map((c) => ({ token: c.token, value: c.value, css: c.css, why: c.reason })))}; rejected ${JSON.stringify(muse.rejected)}; affects: ${muse.affects}`)
if (museAudit) console.log(`    audit after Muse: ${JSON.stringify(museAudit)}`)

await browser.close()
await server.close()
writeFileSync('out/pas-spike/argon-loop.json', JSON.stringify({ loop, monthMuse: { point: month, pointMs: monthMs, req: { ...req, tokens: req.tokens.length }, route, muse, museMs, museAudit } }, null, 2))
