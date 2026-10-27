#!/usr/bin/env node
// L17: hosted SAM 3.1 (Meta Model API) vs open-weights SAM 3.1 (facebook/sam3.1 on Modal).
//   node scripts/modal-parity.mjs smoke <screenshot.png>            cold then warm call, timings + GPU seconds
//   node scripts/modal-parity.mjs breadth <breadth dir> <out dir>   box agreement (IoU) per site on saved screenshots
// Both providers segment the same saved screenshot with the same prompts and 1600 px tiles. Hosted calls are served
// from the response cache when the same request ran before (point S2T_CACHE_DIR at the main checkout's out/.cache).
// Needs MODAL_TOKEN_ID / MODAL_TOKEN_SECRET in the environment for the open model, META_API_KEY (or the Keychain
// item) for any hosted call not in the cache.
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'
import modalSam, { segmentTiles, modalCalls } from '../src/providers/segment/modal-sam.js'
import metaSam, { tilePng, promptsFromEnv } from '../src/providers/segment/meta-sam.js'
import { iou } from '../src/stages/segeval.js'
import { loadDotEnv } from '../src/config.js'

/**
 * Greedy one-to-one matching of two Region[] by IoU (same label), best pairs first. Pure; exported for reuse.
 * @returns {{a:number, b:number, matched:number, meanIou:number|null, pairs:Array<[number,number,number]>}}
 */
export function agreement(a, b, thr = 0.5) {
  const cand = []
  a.forEach((x, i) => b.forEach((y, j) => { if (x.label === y.label) { const v = iou(x.bbox, y.bbox); if (v >= thr) cand.push([i, j, v]) } }))
  cand.sort((p, q) => q[2] - p[2])
  const ua = new Set(), ub = new Set(), pairs = []
  for (const [i, j, v] of cand) { if (ua.has(i) || ub.has(j)) continue; ua.add(i); ub.add(j); pairs.push([i, j, v]) }
  const meanIou = pairs.length ? pairs.reduce((n, p) => n + p[2], 0) / pairs.length : null
  return { a: a.length, b: b.length, matched: pairs.length, meanIou, pairs }
}

const round = (v, d = 3) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

async function smoke(png) {
  process.env.S2T_CACHE = '0'
  const tiles = tilePng(PNG.sync.read(readFileSync(png)))
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now()
    const res = await segmentTiles(tiles, promptsFromEnv())
    const counts = res.map((r) => Object.fromEntries(Object.entries(r.detections).map(([k, v]) => [k, v.length])))
    console.log(JSON.stringify({ run: i ? 'warm' : 'cold', wallMs: Date.now() - t0, call: modalCalls.at(-1), counts }))
  }
}

async function breadth(srcDir, outDir) {
  loadDotEnv()
  const sites = readdirSync(srcDir).filter((d) => existsSync(join(srcDir, d, 'screenshot.png')) && existsSync(join(srcDir, d, 'capture.json'))).sort()
  const hosted = metaSam(), open = modalSam()
  const rows = []
  for (const site of sites) {
    const dir = join(outDir, site)
    mkdirSync(dir, { recursive: true })
    for (const f of ['screenshot.png', 'capture.json']) copyFileSync(join(srcDir, site, f), join(dir, f))
    const capture = JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf-8'))
    const { height } = PNG.sync.read(readFileSync(join(dir, 'screenshot.png')))
    const t0 = Date.now()
    let h, hErr = null
    try { h = await hosted.segment(capture, dir) } catch (e) { hErr = e.message; h = [] }
    const t1 = Date.now()
    const nCalls = modalCalls.length
    const o = await open.segment(capture, dir)
    const t2 = Date.now()
    const call = modalCalls.length > nCalls ? modalCalls.at(-1) : null
    writeFileSync(join(dir, 'regions.hosted.json'), JSON.stringify(h, null, 2))
    writeFileSync(join(dir, 'regions.open.json'), JSON.stringify(o, null, 2))
    const ag = agreement(h, o)
    const byLabel = {}
    for (const lab of [...new Set([...h, ...o].map((r) => r.label))]) {
      const x = agreement(h.filter((r) => r.label === lab), o.filter((r) => r.label === lab))
      byLabel[lab] = { hosted: x.a, open: x.b, matched: x.matched }
    }
    const row = { site, height, tiles: Math.ceil(height / 1600), hosted: ag.a, open: ag.b, matched: ag.matched,
      recall: ag.a ? round(ag.matched / ag.a) : null, precision: ag.b ? round(ag.matched / ag.b) : null, meanIou: round(ag.meanIou),
      byLabel, hostedMs: t1 - t0, openMs: t2 - t1, openGpuS: call ? call.gpuS : 0, openCold: call ? call.cold : null, hostedError: hErr }
    rows.push(row)
    console.log(`${site.padEnd(22)} hosted ${String(row.hosted).padStart(3)}  open ${String(row.open).padStart(3)}  matched ${String(row.matched).padStart(3)}  meanIoU ${row.meanIou ?? '-'}  gpu ${row.openGpuS}s${hErr ? `  HOSTED ERROR ${hErr.slice(0, 80)}` : ''}`)
  }
  const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0)
  const allPairs = rows.filter((r) => r.matched)
  const total = {
    sites: rows.length, hosted: sum('hosted'), open: sum('open'), matched: sum('matched'),
    recall: round(sum('matched') / Math.max(1, sum('hosted'))), precision: round(sum('matched') / Math.max(1, sum('open'))),
    meanIou: round(allPairs.reduce((n, r) => n + r.meanIou * r.matched, 0) / Math.max(1, sum('matched'))),
    openGpuS: round(sum('openGpuS')), tiles: sum('tiles'),
  }
  writeFileSync(join(outDir, 'breadth-iou.json'), JSON.stringify({ total, rows }, null, 2))
  console.log(JSON.stringify(total))
}

const [cmd, a1, a2] = process.argv.slice(2)
if (cmd === 'smoke') await smoke(a1)
else if (cmd === 'probe') {
  // One uncached call; prints every detection (S2T_SAM_PROMPTS and S2T_MODAL_THRESHOLD apply).
  process.env.S2T_CACHE = '0'
  const res = await segmentTiles(tilePng(PNG.sync.read(readFileSync(a1))), promptsFromEnv())
  res.forEach((r, i) => console.log(`tile ${i}`, JSON.stringify(r.detections)))
  console.log(JSON.stringify(modalCalls.at(-1)))
}
else if (cmd === 'breadth') await breadth(a1, a2)
else { console.error('usage: modal-parity.mjs smoke <png> | breadth <breadth dir> <out dir>'); process.exit(2) }
