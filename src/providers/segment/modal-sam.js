// SAM 3.1 from Meta's open weights (facebook/sam3.1), self-hosted on a Modal GPU (loop L17).
// Same contract as meta-sam.js (concept prompts, 1600 px tiles, Region[] in page px, request cache, recordCall), but
// the model runs in modal/sam31_app.py and is reached through modal/sam31_client.py (the Modal Python client, spawned
// with uv; auth = the caller's Modal token). No web endpoint, so nothing is reachable without that token.
// Data policy: only public, non-sensitive screenshots go to Modal (same rule as the hosted API).
import { spawn } from 'node:child_process'
import { readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { PNG } from 'pngjs'
import { cacheGet, cachePut, cacheKey } from '../../lib/cache.js'
import { recordCall } from '../../lib/metrics.js'
import { postprocessRegions } from '../../stages/segeval.js'
import { LABEL_BY_PROMPT, promptsFromEnv, tilePng, TILE_H } from './meta-sam.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const MODEL_ID = 'sam-3.1-open@modal'
export const CLIENT_PATH = resolve(__dirname, '../../../modal/sam31_client.py')
export const MODAL_VERSION = '1.6.3'
// Score cutoff (presence x box score). The package default is 0.5; 0.45 matches the hosted API's box count on the 27
// breadth sites (686 vs 686 boxes, 96.6% matched both ways; 0.5 found only 87% of the hosted boxes). docs/open-weights-pipeline.md
export const DEFAULT_THRESHOLD = 0.45

/** Every call the provider made in this process (cold flag, GPU seconds, wall time), for the parity scripts. */
export const modalCalls = []

/**
 * Spawn the Python client: request JSON on stdin, response JSON on stdout. Exported so tests can swap it out.
 * @param {{tiles:string[], prompts:string[], threshold:number}} request  tiles are base64 PNGs
 * @returns {Promise<any>}
 */
export function runModalClient(request) {
  return new Promise((resolvePromise, reject) => {
    const cmd = process.env.S2T_MODAL_PYTHON ? process.env.S2T_MODAL_PYTHON.split(' ') : ['uvx', '--from', `modal==${MODAL_VERSION}`, 'python']
    const proc = spawn(cmd[0], [...cmd.slice(1), CLIENT_PATH], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => { out += d })
    proc.stderr.on('data', (d) => { err += d })
    proc.on('error', (e) => reject(new Error(`modal-sam: failed to spawn ${cmd[0]}: ${e.message}`)))
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`modal-sam: client exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`))
      try { resolvePromise(JSON.parse(out)) } catch (e) { reject(new Error(`modal-sam: bad client output: ${out.slice(0, 200)}`)) }
    })
    proc.stdin.end(JSON.stringify(request))
  })
}

/**
 * One tile's detections → Region[] in page px. Boxes come back as [x1, y1, x2, y2] in the tile's own pixels
 * (the app resizes to the model's 1008 px frame and scales back). Pure; exported for tests.
 * @param {{detections: Record<string, {box:number[], score:number}[]>}} tileResult
 * @param {string[]} prompts  prompt order (fixes region order, so ids are deterministic)
 * @param {number} tileY      the tile's page-px offset
 * @returns {import('../../types.js').Region[]}
 */
export function tileToRegions(tileResult, prompts, tileY = 0) {
  const out = []
  for (const prompt of prompts) {
    for (const d of tileResult?.detections?.[prompt] || []) {
      const [x1, y1, x2, y2] = d.box
      out.push({
        id: `m${out.length}`,
        bbox: [Math.round(x1), Math.round(y1 + tileY), Math.round(x2 - x1), Math.round(y2 - y1)],
        label: LABEL_BY_PROMPT[prompt] || 'other',
        score: typeof d.score === 'number' ? d.score : 0.9,
        source: 'sam3.1-open',
      })
    }
  }
  return out
}

/**
 * Segment PNG tiles with the Modal app, using the request cache per tile. Returns one result per tile.
 * Exported so the parity scripts can segment saved screenshots without a capture.json.
 * @param {{y:number, png:any}[]} tiles
 * @param {string[]} prompts
 * @param {{threshold?:number, client?:(req:any)=>Promise<any>}} [o]
 */
export async function segmentTiles(tiles, prompts, o = {}) {
  const threshold = o.threshold ?? Number(process.env.S2T_MODAL_THRESHOLD || DEFAULT_THRESHOLD)
  const client = o.client || runModalClient
  const b64 = tiles.map((t) => PNG.sync.write(t.png).toString('base64'))
  const keys = b64.map((b) => cacheKey('sam-modal', { model: MODEL_ID, prompts, threshold, image: createHash('sha256').update(b).digest('hex') }))
  const results = keys.map((k) => cacheGet(k))
  const todo = results.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0)
  for (let i = 0; i < results.length; i++) if (results[i]) recordCall({ kind: 'sam', model: MODEL_ID, ms: 0, cached: true })
  if (todo.length) {
    const t0 = Date.now()
    const res = await client({ tiles: todo.map((i) => b64[i]), prompts, threshold })
    const ms = Date.now() - t0
    if (!res || !Array.isArray(res.tiles) || res.tiles.length !== todo.length) throw new Error('modal-sam: response has the wrong number of tiles')
    if (/-contributor$/.test(String(res.model || ''))) throw new Error('modal-sam: refusing a "-contributor" model id')
    const gpuS = Number(res.gpu_s) || 0
    modalCalls.push({ tiles: todo.length, gpuS, ms, clientS: res.client_s, cold: !!res.cold, load: res.load || null })
    todo.forEach((ti, j) => {
      results[ti] = res.tiles[j]
      cachePut(keys[ti], res.tiles[j])
      // GPU time is split evenly over the tiles of one request, so per-tile costs sum to the measured total.
      recordCall({ kind: 'sam', model: MODEL_ID, ms: Math.round(ms / todo.length), cached: false, gpuS: gpuS / todo.length })
    })
  }
  return results
}

/** @returns {import('../../types.js').SegmentProvider} */
export default function modalSam(o = {}) {
  return {
    id: 'sam3.1-open@modal',
    async segment(capture, runDir) {
      const full = PNG.sync.read(readFileSync(join(runDir, capture.screenshot)))
      const tiles = tilePng(full, Number(process.env.S2T_SAM_TILE_H || TILE_H))
      const prompts = promptsFromEnv()
      const results = await segmentTiles(tiles, prompts, o)
      const regions = results.flatMap((r, i) => tileToRegions(r, prompts, tiles[i].y))
      return postprocessRegions(regions)
    },
  }
}
