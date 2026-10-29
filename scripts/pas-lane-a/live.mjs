// Point and say, lane A live check: start the playground with the /__pas/ API on a run, then drive the endpoints the
// way the page will (HTTP only, no page): speech WAV -> /api/transcribe -> /api/intent with the click -> for focus,
// /api/focus-check. Each scenario repeats `--reps` times with the click cache cleared (SAM and the sentinel re-run).
// Speech: the spike's `say` phrases (scripts/pas-spike/make-phrases.sh, 48 kHz) re-encoded to 16 kHz mono with wav.js.
// Usage: node scripts/pas-lane-a/live.mjs --run out/argon --app out/argon/site --scenarios argon [--reps 3] [--phrases out/phrases]
import { readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { loadDotEnv } from '../../src/config.js'
import { parseArgs } from '../../src/lib/args.js'
import { startPlayground } from '../../src/stages/playground.js'
import { encodeWav } from '../../src/stages/pas/wav.js'

loadDotEnv()
const a = parseArgs(process.argv.slice(2))
const run = resolve(a.run || 'out/argon')
const reps = Number(a.reps || 3)
const phrases = resolve(a.phrases || 'out/phrases')

const SCENARIOS = {
  argon: [
    { id: 'contrast', phrase: 'a', click: { x: 430, y: 222 }, expect: (r) => r.route === 'contrast' && r.changes[0] && r.changes[0].token === 'color.text.muted' && r.predicted.after.min >= 4.5 && r.predicted.after.fail === 0 && r.predicted.regressions.length === 0 },
    { id: 'focus', phrase: 'b', click: null, focusCheck: true, expect: (r) => r.route === 'focus' && r.changes.some((c) => c.token === 'focus.ring.color') },
    { id: 'muse-month', phrase: 'e', click: { x: 873, y: 328 }, expect: (r, pt) => r.route === 'muse' && r.changes.some((c) => c.alias === 'color.action.primary') && r.changes.every((c) => pt.changeable.includes(c.token)) },
  ],
  // Typed requests (no speech): a real Muse change on Month, a radius request, and a regression the gate must block.
  'argon-typed': [
    { id: 'muse-red', text: 'Make these buttons red.', click: { x: 873, y: 328 }, expect: (r, pt) => r.route === 'muse' && r.changes.length > 0 && r.changes.every((c) => pt.changeable.includes(c.token)) && r.changes.some((c) => !c.noop) },
    { id: 'muse-radius', text: 'Round these buttons like pills.', click: { x: 873, y: 328 }, expect: (r, pt) => r.changes.every((c) => pt.changeable.includes(c.token)) },
    { id: 'muse-light-text', text: 'Make this label very light gray, almost white.', click: { x: 430, y: 222 }, expect: (r) => r.route === 'none' || (r.predicted && r.predicted.blocked) || r.changes.every((c) => c.noop) },
  ],
  lightbootstrap: [
    { id: 'contrast-number', phrase: 'a', click: { x: 460, y: 133 }, expect: (r) => r.route === 'contrast' && r.changes.length === 1 && r.predicted.after.fail === 0 && r.predicted.regressions.length === 0 },
    { id: 'focus', phrase: 'b', click: null, focusCheck: true, expect: (r) => r.route === 'focus' },
    { id: 'muse-account', phrase: 'e', click: { x: 1161, y: 38 }, expect: (r, pt) => (r.route === 'muse' || r.route === 'none') && r.changes.every((c) => pt.changeable.includes(c.token)) },
  ],
}

/** 48 kHz 16-bit mono WAV file -> 16 kHz WAV bytes via the page's own encoder. */
function wav16(file) {
  const b = readFileSync(file)
  const rate = b.readUInt32LE(24)
  let off = 12
  while (off < b.length && b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4)
  const len = b.readUInt32LE(off + 4)
  const pcm = new Float32Array(len / 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(off + 8 + i * 2) / 32768
  return { wav: encodeWav(pcm, rate), audioMs: Math.round((pcm.length / rate) * 1000) }
}

const s = await startPlayground({ runDir: run, appDir: resolve(a.app || join(run, 'site')), port: 0, pas: true, log: (m) => console.log(`  ${m}`) })
await s.warming
const t0 = Date.now()
await s.pas.core.focus.start()
console.log(`focus baseline ready (${Date.now() - t0} ms after warm)`)
const post = async (path, body, raw) => {
  const t = Date.now()
  const r = await fetch(new URL(path, s.url), { method: 'POST', headers: { 'content-type': raw ? 'audio/wav' : 'application/json' }, body: raw ? body : JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`${path} ${r.status}: ${j.error}`)
  return { ...j, wallMs: Date.now() - t }
}
const health = await (await fetch(new URL('__pas/api/health', s.url))).json()
console.log(`health: ok ${health.ok}; muse ${health.providers.muse.map((m) => m.id).join(' > ')}; focus baseline ${JSON.stringify(health.focusBaseline.summary)}`)

const rows = []
for (const name of String(a.scenarios || 'argon').split(',')) {
  for (const sc of SCENARIOS[name]) {
    for (let i = 1; i <= reps; i++) {
      s.pas.core.cache.clear()
      s.pas.core.pctx.cache.clear()
      const { wav, audioMs } = sc.text ? { wav: null, audioMs: 0 } : wav16(join(phrases, `${sc.phrase}.wav`))
      const asr = sc.text ? { transcript: sc.text, ms: 0 } : await post('__pas/api/transcribe', wav, true)
      let pt = null
      if (sc.click) pt = await post('__pas/api/point', sc.click)
      const intent = await post('__pas/api/intent', { transcript: asr.transcript, point: sc.click })
      let fc = null
      if (sc.focusCheck && intent.route === 'focus') fc = await post('__pas/api/focus-check', { changes: intent.changes })
      const changeable = pt ? Array.from(new Set(pt.tokens.concat(pt.twins.flatMap((t) => t.tokens)))) : []
      const ok = !!sc.expect(intent, { changeable })
      const row = {
        app: name, scenario: sc.id, rep: i, ok, transcript: asr.transcript, route: intent.route, summary: intent.summary,
        changes: intent.changes.map((c) => ({ token: c.token, alias: c.alias, value: c.value, noop: !!c.noop, aliasPreferred: c.aliasPreferred || null, retargetedFrom: c.retargetedFrom || null })),
        rejected: intent.rejected, model: intent.model,
        point: pt && { element: pt.element.text, controls: Object.fromEntries(Object.entries(pt.controls).map(([k, v]) => [k, v && v.token])), twins: pt.twins.map((t) => t.id), changeable, pairs: pt.pairs && { count: pt.pairs.count, min: pt.pairs.minRatio } },
        predicted: intent.predicted && { affected: intent.predicted.affected, before: intent.predicted.before, after: intent.predicted.after, page: intent.predicted.page, regressions: intent.predicted.regressions && intent.predicted.regressions.length, blocked: intent.predicted.blocked },
        focusCheck: fc && { before: fc.before, after: fc.after, worse: fc.compare.worse.length, timings: fc.timings, ms: fc.ms },
        ms: { audio: audioMs, asr: asr.ms, point: pt ? pt.ms : null, sam: pt ? pt.sam.ms : null, sentinel: pt ? pt.timings.sentinel : null, intent: intent.ms, model: intent.model ? intent.model.ms : null, focusCheck: fc ? fc.ms : null },
      }
      rows.push(row)
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}/${sc.id} #${i}: "${asr.transcript}" -> ${intent.route}: ${intent.summary}${fc ? ` | focus-check ${fc.before.pass}/${fc.before.measured} pass -> ${fc.after.pass}/${fc.after.measured} pass, ${fc.compare.worse.length} worse, ${fc.ms} ms` : ''} | ms ${JSON.stringify(row.ms)}`)
    }
  }
}
const out = a.out || join(run, 'pas-live.json')
writeFileSync(out, JSON.stringify({ run, health, rows }, null, 2))
console.log(`wrote ${out}: ${rows.filter((r) => r.ok).length} of ${rows.length} pass`)
await s.close()
process.exit(0)
