// Contract test: a local fake of the Meta Model API (shapes from docs/providers-research.md) drives the
// real meta namer and meta SAM providers end to end. When access lands, rerun with the real base URL;
// if this passes and the real one doesn't, the difference is the API shape, not our pipeline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PNG } from 'pngjs'
import metaSam, { responsesUrl, tilePng } from '../src/providers/segment/meta-sam.js'
import { runName } from '../src/stages/name.js'

const clusters = [
  { id: 'color-01', kind: 'color', value: '#1a73e8ff', members: [{ value: '#1a73e8ff', count: 9 }, { value: '#1b74e9ff', count: 2 }], count: 11, props: { 'background-color': 8 }, regionLabels: { button: 4 } },
  { id: 'color-02', kind: 'color', value: '#333333ff', members: [{ value: '#333333ff', count: 16 }], count: 16, props: { color: 16 }, regionLabels: {} },
]

function fakeMeta() {
  const seen = { chat: [], responses: [] }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const json = JSON.parse(body || '{}')
      res.setHeader('content-type', 'application/json')
      if (req.url === '/v1/chat/completions') {
        seen.chat.push({ auth: req.headers.authorization, json })
        // A plausible model reply: fenced JSON, one primitive renamed, one alias that doesn't resolve.
        const reply = '```json\n' + JSON.stringify({ tokens: [
          { name: 'color.brand.600', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: 'Brand blue; four near-identical spellings merged.' },
          { name: 'color.ink.800', tier: 'primitive', value: '#333333ff', clusters: ['color-02'], why: 'Body text gray.' },
          { name: 'color.action.primary', tier: 'semantic', alias: 'color.brand.600', clusters: ['color-01'], why: 'Fill of primary buttons.' },
          { name: 'color.text.default', tier: 'semantic', alias: 'color.gray.missing', clusters: ['color-02'], why: 'Default text.' },
        ] }) + '\n```'
        res.end(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 900, completion_tokens: 300 } }))
      } else if (req.url === '/v1/responses') {
        const prompt = json.input?.[0]?.content?.find((c) => c.type === 'input_text')?.text
        seen.responses.push({ prompt, model: json.model })
        // Boxes in a half-size reference frame (720 wide) to exercise scaling.
        const out = prompt === 'button'
          ? '<0f><|box;x1=10;y1=20;x2=60;y2=40;w=720;h=500|><|mask;x=0;y=0;data=abc|>'
          : ''
        res.end(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: out }] }] }))
      } else {
        res.statusCode = 404
        res.end('{}')
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}/v1` })))
}

const withEnv = async (env, fn) => {
  const prev = {}
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k] }
  try { return await fn() } finally { for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] } }
}

test('responsesUrl never doubles /v1', () => {
  assert.equal(responsesUrl('https://api.meta.ai/v1'), 'https://api.meta.ai/v1/responses')
  assert.equal(responsesUrl('https://api.meta.ai/'), 'https://api.meta.ai/v1/responses')
})

test('tilePng splits tall screenshots with page offsets', () => {
  const tiles = tilePng(new PNG({ width: 10, height: 2500 }), 1000)
  assert.deepEqual(tiles.map((t) => [t.y, t.png.height]), [[0, 1000], [1000, 1000], [2000, 500]])
})

test('meta namer: request shape, JSON extraction, validator repair', async () => {
  const { server, seen, base } = await fakeMeta()
  try {
    const set = await withEnv({ META_API_KEY: 'test-key', META_API_BASE_URL: base, META_NAMER_MODEL: 'muse-spark-1.3' }, () =>
      runName({ clusters, regions: [], namer: 'meta', strict: true }))
    assert.equal(set.namer, 'meta:muse-spark-1.3')
    assert.equal(seen.chat[0].auth, 'Bearer test-key')
    assert.equal(seen.chat[0].json.model, 'muse-spark-1.3')
    assert.deepEqual(seen.chat[0].json.response_format, { type: 'json_object' })
    assert.ok(set.tokens.find((t) => t.name === 'color.action.primary' && t.alias === 'color.brand.600'))
    assert.equal(set.tokens.find((t) => t.name === 'color.text.default').alias, 'color.ink.800', 'unresolved alias repaired')
    assert.ok(set.warnings.some((w) => /unresolved/.test(w)))
    assert.equal(set.meta.usage.prompt_tokens, 900)
  } finally { server.close() }
})

test('meta SAM: tiles, one call per concept per tile, scaled + offset boxes', async () => {
  const { server, seen, base } = await fakeMeta()
  const runDir = mkdtempSync(join(tmpdir(), 's2t-sam-'))
  writeFileSync(join(runDir, 'shot.png'), PNG.sync.write(new PNG({ width: 1440, height: 2000 })))
  try {
    const regions = await withEnv({ META_API_KEY: 'k', META_API_BASE_URL: base, META_SAM_MODEL: 'sam-3.1', S2T_SAM_TILE_H: "1000" }, () =>
      metaSam().segment({ screenshot: 'shot.png', elements: [] }, runDir))
    assert.equal(seen.responses.length, 2 * 3, '2 tiles x 3 concept prompts')
    assert.ok(seen.responses.every((r) => r.model === 'sam-3.1'))
    const buttons = regions.filter((r) => r.label === 'button')
    assert.equal(buttons.length, 2)
    // Tile height 1000 (set via env at call time): two 1440x1000 tiles vs ref frame 720x500 → x2 both ways,
    // second tile shifted down by its 1000 px page offset.
    assert.deepEqual(buttons[0].bbox, [20, 40, 100, 40])
    assert.deepEqual(buttons[1].bbox, [20, 1040, 100, 40])
    assert.ok(buttons[0].mask)
  } finally { server.close() }
})

test('meta SAM: all calls failing is an error, not an empty success', async () => {
  const dead = createServer((req, res) => { res.statusCode = 500; res.end('boom') })
  await new Promise((r) => dead.listen(0, '127.0.0.1', r))
  const runDir = mkdtempSync(join(tmpdir(), 's2t-sam-'))
  writeFileSync(join(runDir, 'shot.png'), PNG.sync.write(new PNG({ width: 100, height: 100 })))
  try {
    await withEnv({ META_API_KEY: 'k', META_API_BASE_URL: `http://127.0.0.1:${dead.address().port}`, META_SAM_MODEL: 'sam-3.1' }, () =>
      assert.rejects(metaSam().segment({ screenshot: 'shot.png', elements: [] }, runDir), /all 3 calls failed/))
  } finally { dead.close() }
})

test('vision segmenter: boxes JSON → scaled, offset regions', async () => {
  const { visionToRegions } = await import('../src/providers/segment/meta-vision.js')
  const json = { width: 720, height: 800, elements: [
    { label: 'button', box: [10, 20, 60, 40] },
    { label: 'spaceship', box: [0, 0, 10, 10] },
    { label: 'card', box: [50, 50, 40, 40] },
    { label: 'input', box: 'nope' },
  ] }
  const r = visionToRegions(json, { width: 1440, height: 1600, y: 1600 })
  assert.equal(r.length, 2)
  assert.deepEqual(r[0].bbox, [20, 1640, 100, 40])
  assert.equal(r[1].label, 'other')
})
