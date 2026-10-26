// Orchestrates the stages. Each stage writes <runDir>/<stage>.json so runs are inspectable
// and a single stage can be re-run (e.g. swap the namer without re-capturing).
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'fs'
import { join, resolve, relative } from 'path'
import { settings } from './config.js'
import { runCapture, screenshotUrl } from './stages/capture.js'
import { collectUses } from './stages/join.js'
import { clusterUses, driftSummary } from './stages/cluster.js'
import { runName } from './stages/name.js'
import { toCss, toDtcg } from './stages/emit.js'
import { serveDir } from './lib/serve.js'
import { usableTokens } from './stages/review.js'
import { mark, since } from './lib/metrics.js'

export const STAGES = ['capture', 'segment', 'cluster', 'name', 'emit', 'rewrite', 'verify', 'report']

const writeJson = (runDir, name, data) => writeFileSync(join(runDir, `${name}.json`), JSON.stringify(data, null, 2))
const readJson = (runDir, name) => JSON.parse(readFileSync(join(runDir, `${name}.json`), 'utf-8'))

/** Segmenter by id. Hosted / local SAM providers load lazily so a missing one never breaks mock runs. */
export async function segmenterFor(id) {
  if (id === 'mock') return (await import('./providers/segment/mock.js')).default()
  if (id === 'meta') return (await import('./providers/segment/meta-sam.js')).default()
  // SAM 3.1 for buttons / inputs / icons + layout rules anchored on them + DOM style rules (the recommended mode).
  if (id === 'hybrid') return (await import('./providers/segment/hybrid.js')).default()
  if (id === 'local') return (await import('./providers/segment/local-sam.js')).default()
  // Fallback if SAM scores NO-GO on UI: a vision LLM returns boxes as JSON (meta = Muse Spark).
  if (id === 'vision') return (await import('./providers/segment/meta-vision.js')).default('meta')
  if (id === 'vision-ollama') return (await import('./providers/segment/meta-vision.js')).default('ollama')
  throw new Error(`unknown segmenter: ${id}`)
}

const logLine = (stage, msg) => console.log(`  ${stage.padEnd(8)} ${msg}`)

/**
 * @param {{url?:string, fixture?:string, serve?:string, target?:string, runDir:string, from?:string, to?:string, write?:boolean}} o
 *   url: app to capture. fixture: name under fixtures/ (served locally; also the rewrite target).
 *   target: source folder to rewrite (plain CSS). from/to: stage range.
 */
export async function runPipeline(o) {
  const cfg = settings()
  const runDir = resolve(o.runDir)
  mkdirSync(runDir, { recursive: true })
  const range = STAGES.slice(STAGES.indexOf(o.from || 'capture'), STAGES.indexOf(o.to || 'report') + 1)
  const on = (s) => range.includes(s)
  // Read a stage's output only if a later stage in this run needs it (so `--to capture` works).
  const after = (stage) => range.some((x) => STAGES.indexOf(x) > STAGES.indexOf(stage))
  const readIf = (stage, name) => (after(stage) ? readJson(runDir, name) : null)
  const servers = []
  const t0 = Date.now()
  // F19 latency waterfall: each stage logs once when it finishes, so the time since the previous log is that
  // stage's wall time; model calls (count, cache hits, cost) come from the metrics ledger over the same span.
  const timings = []
  let tStage = Date.now(), mStage = mark()
  const log = (stage, msg) => {
    timings.push({ stage, ms: Date.now() - tStage, ...since(mStage) })
    writeJson(runDir, 'timing', { totalMs: Date.now() - t0, stages: timings })
    tStage = Date.now(); mStage = mark()
    logLine(stage, msg)
  }
  try {
    let url = o.url
    let target = o.target ? resolve(o.target) : null
    // --fixture <name> and --serve <dir> both serve a static folder locally; it is also the rewrite target
    // unless --target narrows it (e.g. --serve dist --target dist/css).
    const staticDir = o.fixture ? resolve('fixtures', o.fixture) : o.serve ? resolve(o.serve) : null
    if (staticDir) {
      if (!existsSync(staticDir) && (on('capture') || on('verify') || on('rewrite'))) throw new Error(`no folder at ${staticDir}`)
      target = target || staticDir
      if (on('capture') || on('verify')) {
        const s = await serveDir(staticDir)
        servers.push(s)
        url = s.url
      }
    }
    const providers = { segmenter: cfg.segmenter, namer: cfg.namer, coder: cfg.coder }
    writeJson(runDir, 'run', { url: o.url || (o.fixture ? `fixture:${o.fixture}` : `serve:${o.serve}`), target, serve: staticDir, providers, startedAt: new Date().toISOString() })
    console.log(`s2t run → ${runDir}\n  providers: segment=${cfg.segmenter} namer=${cfg.namer} coder=${cfg.coder}`)

    if (on('capture')) {
      if (!url) throw new Error('capture needs --url or --fixture')
      const cap = await runCapture({ url, runDir, viewport: cfg.viewport })
      log('capture', `${cap.elements.length} elements, screenshot.png`)
    }
    const capture = readIf('capture', 'capture')

    if (on('segment')) {
      const seg = await segmenterFor(cfg.segmenter)
      const regions = await seg.segment(capture, runDir)
      writeJson(runDir, 'regions', regions)
      const counts = {}
      for (const r of regions) counts[r.label] = (counts[r.label] || 0) + 1
      log('segment', `${regions.length} regions via ${seg.id} ${JSON.stringify(counts)}`)
    }
    const regions = readIf('segment', 'regions')

    if (on('cluster')) {
      const uses = collectUses(capture, regions)
      const clusters = clusterUses(uses)
      writeJson(runDir, 'clusters', clusters)
      const d = driftSummary(clusters)
      log('cluster', `${uses.length} uses, ${d.distinctValues} distinct values → ${d.clusters} clusters (${d.merged} merged)`)
    }
    const clusters = readIf('cluster', 'clusters')

    if (on('name')) {
      const t = Date.now()
      const set = await runName({ clusters, regions, screenshotPath: join(runDir, capture.screenshot), namer: cfg.namer })
      writeJson(runDir, 'tokens', set)
      // Credit metering: one line per model call, so we can see what a full app run costs.
      if (set.meta) {
        const u = existsSync(join(runDir, 'usage.json')) ? readJson(runDir, 'usage') : []
        u.push({ stage: 'name', provider: set.namer, at: new Date().toISOString(), ...set.meta })
        writeJson(runDir, 'usage', u)
      }
      const tiers = {}
      for (const tk of set.tokens) tiers[tk.tier] = (tiers[tk.tier] || 0) + 1
      log('name', `${set.tokens.length} tokens via ${set.namer} ${JSON.stringify(tiers)} in ${Date.now() - t} ms${set.warnings?.length ? `, ${set.warnings.length} repairs` : ''}`)
    }
    const tokens = readIf('name', 'tokens')

    if (on('emit')) {
      writeFileSync(join(runDir, 'tokens.css'), toCss(usableTokens(tokens)))
      writeFileSync(join(runDir, 'tokens.dtcg.json'), JSON.stringify(toDtcg(usableTokens(tokens), clusters), null, 2))
      log('emit', 'tokens.css, tokens.dtcg.json')
    }

    if (on('rewrite')) {
      if (!target) {
        log('rewrite', 'skipped (no --target source folder)')
      } else {
        const { runRewrite } = await import('./stages/rewrite.js')
        const rw = await runRewrite({ targetDir: target, tokens: usableTokens(tokens), clusters, write: o.write !== false, runDir })
        log('rewrite', `${rw.edits.length} edits in ${rw.files.length} files via ${rw.coder} → ${rw.outDir}`)
      }
    }

    if (on('verify') && existsSync(join(runDir, 'rewrite.json'))) {
      const rw = readJson(runDir, 'rewrite')
      if (rw.outDir && existsSync(rw.outDir)) {
        const { compareScreenshots } = await import('./stages/verify.js')
        // If only part of a served site was rewritten (--serve dist --target dist/css), verify a copy of
        // the whole site with the rewritten files laid over it, not the rewritten folder alone.
        let siteDir = rw.outDir
        const runMeta = readJson(runDir, 'run')
        if (runMeta.serve && runMeta.target && resolve(runMeta.target) !== resolve(runMeta.serve)) {
          siteDir = join(runDir, 'site')
          rmSync(siteDir, { recursive: true, force: true })
          cpSync(runMeta.serve, siteDir, { recursive: true, filter: (src) => !/[\/](node_modules|\.git)$/.test(src) })
          cpSync(rw.outDir, join(siteDir, relative(runMeta.serve, runMeta.target)), { recursive: true })
        }
        const s = await serveDir(siteDir)
        servers.push(s)
        // Check 1: fallbacks only (no tokens loaded) must be pixel-identical to the original.
        const fb = join(runDir, 'after-fallback.png')
        await screenshotUrl(s.url, fb, cfg.viewport)
        const v1 = compareScreenshots(join(runDir, capture.screenshot), fb, join(runDir, 'diff-fallback.png'), 0)
        // Check 2: color tokens only. Merged colors are within ΔE 3, so this should look identical.
        const kindOf = new Map(clusters.map((c) => [c.id, c.kind]))
        const usable = usableTokens(tokens)
        const colorSet = { ...usable, tokens: usable.tokens.filter((t) => kindOf.get(t.clusters[0]) === 'color') }
        const afterColors = join(runDir, 'after-colors.png')
        await screenshotUrl(s.url, afterColors, cfg.viewport, toCss(colorSet))
        const v2 = compareScreenshots(join(runDir, capture.screenshot), afterColors, join(runDir, 'diff-colors.png'), cfg.verifyThreshold)
        // Check 3: every token. Merging 7/8/9px spacing into one value moves things on purpose;
        // this diff is shown to the reviewer as "what the cleanup changes", not failed.
        const after = join(runDir, 'after.png')
        await screenshotUrl(s.url, after, cfg.viewport, readFileSync(join(runDir, 'tokens.css'), 'utf-8'))
        const v3 = compareScreenshots(join(runDir, capture.screenshot), after, join(runDir, 'diff.png'), cfg.verifyThreshold)
        const rel = (v) => ({ ...v, before: v.before.replace(runDir + '/', ''), after: v.after.replace(runDir + '/', ''), diff: v.diff.replace(runDir + '/', '') })
        const out = {
          ...rel(v3),
          // Gate: rewrite is safe (fallbacks identical) and color merges are invisible.
          pass: v1.pass && v2.pass,
          allTokensWithinThreshold: v3.pass,
          reviewNeeded: !v3.pass,
          fallback: rel(v1),
          colors: rel(v2),
        }
        writeJson(runDir, 'verify', out)
        const pct = (v) => `${(v.ratio * 100).toFixed(3)}%`
        log('verify', `fallback-only ${v1.diffPixels} px (${v1.pass ? 'pass' : 'FAIL'}); colors ${pct(v2)} (${v2.pass ? 'pass' : 'FAIL'}); all tokens ${pct(v3)} (${v3.pass ? 'within threshold' : 'layout changes for review'})`)
      }
    }

    if (on('report')) {
      const { writeReport } = await import('./stages/report.js')
      const p = writeReport(runDir)
      log('report', p)
    }
    const usd = timings.reduce((n, t) => n + t.usd, 0)
    const calls = timings.reduce((n, t) => n + t.calls, 0), hits = timings.reduce((n, t) => n + t.cached, 0)
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${calls} model calls (${hits} cached) · about $${usd.toFixed(3)}`)
  } finally {
    for (const s of servers) await s.close()
  }
}
