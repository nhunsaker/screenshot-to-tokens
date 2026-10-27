#!/usr/bin/env node
// s2t: screenshot to tokens.
//   s2t run --fixture acme-shop            offline demo, every provider a stand-in
//   s2t run --url http://localhost:3000 --target ./src/styles
//   s2t run --from name --run out/acme      re-run from a stage (e.g. after switching the namer)
//   s2t doctor                              what's configured, what's reachable, Mac headroom
//   s2t serve --fixture acme-shop           serve a fixture to look at it
//   s2t eval | review | pr | preview         score, apply review decisions, branch + PR, live Sorb preview
//   s2t playground --run out/app-argon --app <build>   local token playground + Muse audit fixes / dark theme
//   s2t dark --run out/app-argon [--provider baseten|meta|both]   dark theme as tokens.dark.css, contrast-checked
import { join } from 'path'
import { totalmem, freemem, cpus } from 'os'
import { execSync } from 'child_process'
import { loadDotEnv, settings, LLM_PRESETS } from './config.js'
import { runPipeline, STAGES } from './pipeline.js'
import { serveDir } from './lib/serve.js'
import { parseArgs } from './lib/args.js'
export { parseArgs }

loadDotEnv()


async function doctor() {
  const cfg = settings()
  const gb = (n) => (n / 2 ** 30).toFixed(1)
  console.log('s2t doctor')
  console.log(`  providers   segment=${cfg.segmenter} namer=${cfg.namer} coder=${cfg.coder}`)
  // os.freemem() on macOS counts only untouched pages; memory_pressure reports what is actually available.
  let free = `${gb(freemem())} GB free`
  if (process.platform === 'darwin') {
    try { free = execSync('memory_pressure | tail -1', { encoding: 'utf-8' }).trim().replace('System-wide memory free percentage:', '').trim() + ' free' } catch (e) { /* keep freemem */ }
  }
  console.log(`  machine     ${cpus()[0]?.model || 'cpu'} x${cpus().length}, ${gb(totalmem())} GB RAM, ${free} now`)
  try {
    const df = execSync('df -g / | tail -1', { encoding: 'utf-8' }).trim().split(/\s+/)
    console.log(`  disk        ${df[3]} GB free on /`)
  } catch (e) { /* not fatal */ }
  const meta = LLM_PRESETS.meta()
  console.log(`  meta api    ${meta.apiKey ? 'key set' : 'no key (expected until approval, Oct 26)'}; base=${meta.baseURL || '-'} model=${meta.model || '-'}`)
  console.log('              class C data only; never enable the Contributor tier')
  const ol = LLM_PRESETS.ollama()
  try {
    const r = await fetch(ol.baseURL.replace(/\/v1$/, '') + '/api/tags', { signal: AbortSignal.timeout(1500) })
    const tags = (await r.json()).models?.map((m) => `${m.name} (${(m.size / 1e9).toFixed(1)} GB)`) || []
    console.log(`  ollama      up; models: ${tags.join(', ') || 'none pulled'}; namer model=${ol.model}`)
  } catch (e) {
    console.log('  ollama      not running (start with `ollama serve`; pull a model in a granted heavy window)')
  }
  console.log(`  baseten     ${LLM_PRESETS.baseten().apiKey ? 'key set' : 'no key'}; model=${LLM_PRESETS.baseten().model}`)
  console.log(`  fireworks   ${LLM_PRESETS.fireworks().apiKey ? 'key set' : 'no key'}`)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = parseArgs(rest)
  if (cmd === 'run') {
    const name = a.fixture || (a.serve ? a.serve.replace(/\/+$/, '').split('/').slice(-2).join('-') : a.url ? new URL(a.url).hostname.replace(/\W+/g, '-') : 'run')
    await runPipeline({
      url: a.url, fixture: a.fixture, serve: a.serve, target: a.target,
      runDir: a.run || join('out', name),
      from: a.from, to: a.to, write: a['dry-run'] ? false : true,
    })
  } else if (cmd === 'eval') {
    const { readFileSync, existsSync, writeFileSync } = await import('fs')
    const { scoreRun, formatScore } = await import('./stages/eval.js')
    const fixture = a.fixture || 'acme-shop'
    const runDir = a.run || join('out', fixture)
    const goldenPath = a.golden || join('fixtures', fixture, 'golden.json')
    if (!existsSync(goldenPath)) throw new Error(`no golden file at ${goldenPath}`)
    const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
    const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'))
    const s = scoreRun({ clusters: rd('clusters'), tokens: rd('tokens'), regions: rd('regions') }, golden, golden.kinds || {})
    writeFileSync(join(runDir, 'eval.json'), JSON.stringify(s, null, 2))
    console.log(formatScore(s, `${fixture} (${rd('tokens').namer})`))
  } else if (cmd === 'review') {
    // Apply review.json (exported from the report page) to tokens.json, then re-emit, rewrite, verify, report.
    const { readFileSync, writeFileSync, existsSync, copyFileSync } = await import('fs')
    const { applyReview } = await import('./stages/review.js')
    const runDir = a.run || join('out', a.fixture || 'acme-shop')
    const reviewPath = a.decisions || join(runDir, 'review.json')
    if (!existsSync(reviewPath)) throw new Error(`no decisions at ${reviewPath} (export them from report.html)`)
    const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
    const before = join(runDir, 'tokens.proposed.json')
    if (!existsSync(before)) copyFileSync(join(runDir, 'tokens.json'), before)
    const out = applyReview(JSON.parse(readFileSync(before, 'utf-8')), JSON.parse(readFileSync(reviewPath, 'utf-8')), rd('clusters'))
    writeFileSync(join(runDir, 'tokens.json'), JSON.stringify(out, null, 2))
    console.log(`review: ${out.reviewed.decisions} decisions applied${out.reviewed.notes.length ? `; notes: ${out.reviewed.notes.join('; ')}` : ''}`)
    const run = rd('run')
    await runPipeline({ fixture: a.fixture, target: run.target, runDir, from: 'emit' })
  } else if (cmd === 'segeval') {
    // Score a run's regions (e.g. after S2T_SEGMENTER=meta) against DOM oracle boxes; prints GO / NO-GO.
    // --truth <file> scores against a hand-labeled Region[] instead (for fixtures where the DOM oracle
    // is itself useless, e.g. div-soup — see fixtures/div-soup/regions.truth.json).
    const { readFileSync, writeFileSync, existsSync } = await import('fs')
    const { scoreSegmentation, goNoGo, resolveOracle, formatSegScore, clipToScreen } = await import('./stages/segeval.js')
    const runDir = a.run || join('out', a.fixture || 'acme-shop')
    const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
    let regions = a.regions ? JSON.parse(readFileSync(a.regions, 'utf-8')) : rd('regions')
    // --max-y 900 scores only the first screen (real-site truth is labeled on the first screen only).
    if (a['max-y']) regions = clipToScreen(regions, Number(a['max-y']))
    if (a.truth && !existsSync(a.truth)) throw new Error(`no truth file at ${a.truth}`)
    const truth = a.truth ? JSON.parse(readFileSync(a.truth, 'utf-8')) : null
    const oracle = resolveOracle(rd('capture'), truth)
    const score = scoreSegmentation(regions, oracle, { iou: a.iou ? Number(a.iou) : 0.5 })
    const verdict = goNoGo(score)
    writeFileSync(join(runDir, 'segeval.json'), JSON.stringify({ ...score, verdict, oracleSource: truth ? a.truth : 'dom-oracle', maxY: a['max-y'] ? Number(a['max-y']) : null }, null, 2))
    console.log(formatSegScore(score, verdict))
  } else if (cmd === 'compare') {
    // s2t compare out/acme-shop out/acme-shop-meta  (or --runs a,b)
    const { compareRuns } = await import('./stages/compare.js')
    const dirs = a.runs ? String(a.runs).split(',') : a._
    if (dirs.length < 1) throw new Error('compare needs run folders: s2t compare out/a out/b')
    console.log(compareRuns(dirs))
  } else if (cmd === 'pr') {
    // Branch + commit in the app repo. Pushes and opens a draft PR only with --open.
    const { resolve } = await import('path')
    const { runPr } = await import('./stages/pr.js')
    if (!a.repo) throw new Error('pr needs --repo <app git root> (and --target <rewritten folder> if not the root)')
    const runDir = a.run || join('out', a.fixture || 'run')
    const r = runPr({ runDir, repoDir: resolve(a.repo), targetDir: resolve(a.target || a.repo), branch: a.branch, tokensCssPath: a['tokens-css'] && resolve(a['tokens-css']), open: !!a.open })
    console.log(`pr: committed on ${r.branch} (${r.files} files); body at ${r.bodyPath}${r.opened ? `; opened ${r.url}` : '; not pushed (add --open to push + open a draft PR)'}`)
  } else if (cmd === 'preview') {
    // Live preview through a running Sorb bridge (`sorb dev`): s2t preview --token color.action.primary --value '#e8711a'
    const { proposePreview } = await import('./stages/preview.js')
    const bridgeUrl = a.bridge || 'http://localhost:7777'
    if (!a.token || !a.value) throw new Error('preview needs --token <name> --value <css value>')
    // Sorb keys tokens by CSS var name without "--" (sorb-leaf applyTokens sets `--${key}`).
    const { cssVarOf } = await import('./lib/props.js')
    const r = await proposePreview({ bridgeUrl, tokenName: cssVarOf(a.token).slice(2), value: a.value, key: process.env.SORB_BRIDGE_KEY })
    const app = a['app-url'] ? `${a['app-url'].replace(/\/$/, '')}/?preview=${r.id}` : r.url
    console.log(`preview ${r.id}: open ${app}`)
  } else if (cmd === 'scoreboard') {
    // F7: SAM vs DOM split-screen scoreboard (div-soup DOM/SAM/hybrid vs the hand-labeled truth,
    // plus two real apps scored honestly against the DOM oracle). s2t scoreboard --out out/scoreboard.html
    const { writeScoreboard } = await import('./stages/scoreboard.js')
    const truth = join('fixtures', 'div-soup', 'regions.truth.json')
    const outPath = a.out || join('out', 'scoreboard.html')
    const p = writeScoreboard({
      runs: [
        { role: 'dom', label: 'DOM (page structure)', runDir: join('out', 'div-soup'), truth },
        { role: 'sam', label: 'SAM 3.1', runDir: join('out', 'div-soup-sam'), truth },
        { role: 'hybrid', label: 'Hybrid (SAM + layout + DOM)', runDir: join('out', 'div-soup-hybrid'), truth },
        { role: 'real', label: 'agency (hybrid)', runDir: join('out', 'agency-hybrid') },
        { role: 'real', label: 'acme-shop (hybrid)', runDir: join('out', 'acme-shop-hybrid') },
        // L1: real sites vs hand-labeled first-screen truth (capture once, segment three ways; see docs/real-site-segeval.md).
        ...[['argon', 'Argon Dashboard'], ['hacksoc', 'HackSoc Notts'], ['joshwong', 'josh-wong.github.io']].flatMap(([id, site]) =>
          ['dom', 'sam', 'hybrid'].map((segmenter) => ({ role: 'site', site, segmenter, label: `${site} (${segmenter})`, runDir: join('out', 'l1', `${id}-${segmenter}`), truth: join('fixtures', 'l1', `${id}.truth.json`), maxY: 900 }))),
      ],
      out: outPath,
    })
    console.log(`scoreboard: wrote ${p}`)
  } else if (cmd === 'playground') {
    // Local only (127.0.0.1): playground + tokenized app + /api/muse (audit fixes, dark theme). Never deploy this.
    const { startPlayground } = await import('./stages/playground.js')
    if (!a.run || !a.app) throw new Error('playground needs --run <run dir> --app <dir of the tokenized app build>')
    const s = await startPlayground({ runDir: a.run, appDir: a.app, port: Number(a.port || 4400), provider: a.provider === 'meta' ? 'meta' : 'baseten', title: a.title, log: (m) => console.log(`  ${m}`) })
    console.log(`playground: ${s.tokens} tokens, ${s.pairs} text pairs at ${s.url} (local only; Ctrl+C to stop)`)
  } else if (cmd === 'dark') {
    // L14: Muse Spark proposes dark token values; every text pair is checked in the browser; writes tokens.dark.css,
    // dark.json and dark.png into the run folder. Local only (the key stays in this process).
    const { runDark } = await import('./stages/dark.js')
    if (!a.run) throw new Error('dark needs --run <run dir> (after verify)')
    const provider = a.provider === 'both' ? 'both' : a.provider === 'meta' ? 'meta' : 'baseten'
    const r = await runDark({ runDir: a.run, provider, log: (m) => console.log(`  ${m}`) })
    console.log(`dark: ${r.before.pass} of ${r.before.checked} text pairs pass in the light theme, ${r.after.pass} of ${r.after.checked} in the dark theme (${r.winner.label}, ${r.winner.round}); wrote tokens.dark.css, dark.json${r.screenshot ? ', dark.png' : ''}`)
  } else if (cmd === 'doctor') {
    await doctor()
  } else if (cmd === 'serve') {
    const s = await serveDir(join('fixtures', a.fixture || 'acme-shop'), Number(a.port || 4321))
    console.log(`serving at ${s.url} (Ctrl+C to stop)`)
  } else {
    console.log(`usage: s2t run --fixture <name> | --serve <static dir> | --url <url> [--target <dir>] [--run <dir>] [--from <stage>] [--to <stage>]
       s2t eval --fixture <name> [--run <dir>] [--golden <file>]
       s2t segeval --run <dir> [--iou 0.5] [--truth <file>] [--max-y 900]  (vs DOM oracle, or a hand-labeled Region[] file; GO / NO-GO)
       s2t compare <run dir> <run dir> ...       (providers, eval, segeval, verify, model usage side by side)
       s2t review --run <dir> [--decisions review.json]
       s2t pr --run <dir> --repo <app git root> [--target <dir>] [--branch <name>] [--open]
       s2t preview --token <name> --value <css> [--bridge http://localhost:7777] [--app-url <url>]
       s2t scoreboard [--out out/scoreboard.html]      (SAM vs DOM split-screen scoreboard: div-soup + 2 real apps)
       s2t playground --run <run dir> --app <tokenized app build> [--port 4400] [--provider baseten|meta] [--title <name>]
       s2t dark --run <run dir> [--provider baseten|meta|both]   (tokens.dark.css + dark.json + dark.png, text contrast checked)
       s2t doctor
       s2t serve --fixture <name> [--port 4321]
stages: ${STAGES.join(' → ')}`)
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
