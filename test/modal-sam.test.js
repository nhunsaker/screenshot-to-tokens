import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PNG } from 'pngjs'
import modalSam, { tileToRegions, segmentTiles, MODEL_ID, modalCalls } from '../src/providers/segment/modal-sam.js'
import { mark, since, recordCall } from '../src/lib/metrics.js'
import { segmenterFor } from '../src/pipeline.js'

// A fake of modal/sam31_client.py: same response shape as the deployed app (boxes are x1,y1,x2,y2 in tile px).
function fakeClient(log, { gpuS = 1.2, cold = false, model = 'sam-3.1-open@modal' } = {}) {
  return async (req) => {
    log.push(req)
    return {
      model, gpu: 'L4', gpu_s: gpuS, cold, client_s: 1.5,
      tiles: req.tiles.map((_, i) => ({
        width: 1440, height: 900,
        detections: Object.fromEntries(req.prompts.map((p) => [p, p === 'button' ? [{ box: [10, 20 + i, 110, 56 + i], score: 0.93 }] : []])),
      })),
    }
  }
}

const png = (w, h) => new PNG({ width: w, height: h })
const withEnv = async (env, fn) => {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
  Object.assign(process.env, env)
  try { return await fn() } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}

test('modal-sam tileToRegions: xyxy tile boxes become page-px xywh regions with the tile offset and prompt label', () => {
  const r = tileToRegions({ detections: { button: [{ box: [10.4, 20, 110.6, 56], score: 0.8 }], 'search bar': [{ box: [0, 0, 300, 40], score: 0.7 }] } }, ['button', 'search bar'], 1600)
  assert.deepEqual(r.map((x) => [x.label, x.bbox, x.score, x.source]), [
    ['button', [10, 1620, 100, 36], 0.8, 'sam3.1-open'],
    ['input', [0, 1600, 300, 40], 0.7, 'sam3.1-open'],
  ])
  assert.deepEqual(tileToRegions({ detections: {} }, ['button']), [])
})

test('modal-sam segmentTiles: one client call for all uncached tiles, then served from the cache; GPU seconds priced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-modal-'))
  try {
    await withEnv({ S2T_CACHE_DIR: dir, S2T_CACHE: '1' }, async () => {
      const log = []
      const tiles = [{ y: 0, png: png(20, 20) }, { y: 1600, png: png(20, 10) }]
      const m = mark()
      const first = await segmentTiles(tiles, ['button', 'icon'], { client: fakeClient(log, { gpuS: 3.6 }) })
      assert.equal(log.length, 1)
      assert.equal(log[0].tiles.length, 2)
      assert.deepEqual(log[0].prompts, ['button', 'icon'])
      assert.equal(first[1].detections.button[0].box[1], 21)
      const s = since(m)
      assert.equal(s.calls, 2)
      assert.equal(s.gpuS, 3.6)
      assert.equal(s.usd, Math.round(3.6 * (0.8 / 3600) * 10000) / 10000)
      assert.deepEqual(s.models, [MODEL_ID])
      assert.equal(modalCalls.at(-1).tiles, 2)
      const m2 = mark()
      const again = await segmentTiles(tiles, ['button', 'icon'], { client: fakeClient(log) })
      assert.equal(log.length, 1, 'second run is all cache hits')
      assert.deepEqual(again, first)
      assert.equal(since(m2).cached, 2)
      assert.equal(since(m2).usd, 0)
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('modal-sam segmentTiles: rejects a -contributor model id and a short response', async () => {
  await withEnv({ S2T_CACHE: '0' }, async () => {
    const tiles = [{ y: 0, png: png(4, 4) }]
    await assert.rejects(segmentTiles(tiles, ['button'], { client: fakeClient([], { model: 'sam-3.1-contributor' }) }), /contributor/)
    await assert.rejects(segmentTiles(tiles, ['button'], { client: async () => ({ tiles: [] }) }), /wrong number of tiles/)
  })
})

test('modal-sam provider: tiles a tall screenshot at 1600 px and shifts boxes into page px', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-modal-run-'))
  try {
    writeFileSync(join(dir, 'screenshot.png'), PNG.sync.write(png(40, 2000)))
    await withEnv({ S2T_CACHE: '0', S2T_SAM_PROMPTS: 'button,icon' }, async () => {
      const log = []
      const p = modalSam({ client: fakeClient(log) })
      assert.equal(p.id, 'sam3.1-open@modal')
      const regions = await p.segment({ screenshot: 'screenshot.png', viewport: { width: 40, height: 900 }, elements: [] }, dir)
      assert.equal(log.length, 1)
      assert.equal(log[0].tiles.length, 2)
      assert.deepEqual(regions.map((r) => r.bbox).sort((a, b) => a[1] - b[1]), [[10, 20, 100, 36], [10, 1621, 100, 36]])
      assert.ok(regions.every((r) => r.label === 'button' && /^r\d+$/.test(r.id)))
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('segmenterFor: modal, hybrid+modal and S2T_SAM=modal pick the open-weights SAM', async () => {
  assert.equal((await segmenterFor('modal')).id, 'sam3.1-open@modal')
  assert.equal((await segmenterFor('hybrid+modal')).id, 'hybrid:sam3.1-open@modal+layout+dom')
  await withEnv({ S2T_SAM: 'modal' }, async () => assert.equal((await segmenterFor('hybrid')).id, 'hybrid:sam3.1-open@modal+layout+dom'))
  await withEnv({ S2T_SAM: '' }, async () => assert.equal((await segmenterFor('hybrid')).id, 'hybrid:sam3.1+layout+dom'))
})

test('metrics: per-GPU-second pricing only for the self-hosted model; cached calls are free', () => {
  const m = mark()
  recordCall({ kind: 'sam', model: MODEL_ID, ms: 100, gpuS: 36 })
  recordCall({ kind: 'sam', model: MODEL_ID, ms: 0, cached: true, gpuS: 36 })
  const s = since(m)
  assert.equal(s.usd, 0.008)
  assert.equal(s.gpuS, 36)
  const m2 = mark()
  recordCall({ kind: 'sam', model: 'sam-3.1', ms: 100 })
  assert.equal(since(m2).usd, 0.0025)
  assert.equal(since(m2).gpuS, undefined)
})
