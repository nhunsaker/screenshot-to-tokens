import { test } from 'node:test'
import assert from 'node:assert/strict'
import metaSam, { toRegions, parseSamOutput, extractOutputText, CONCEPT_PROMPTS as META_PROMPTS } from '../src/providers/segment/meta-sam.js'
import localSam, { buildArgs, CONCEPT_PROMPTS as LOCAL_PROMPTS } from '../src/providers/segment/local-sam.js'

// ── meta-sam: not-configured guard (no network) ───────────────────────────────────────────────

test('meta-sam: throws the not-configured error when env is unset', async () => {
  const prev = {
    key: process.env.META_API_KEY,
    base: process.env.META_API_BASE_URL,
    model: process.env.META_SAM_MODEL,
  }
  delete process.env.META_API_KEY
  delete process.env.META_API_BASE_URL
  delete process.env.META_SAM_MODEL
  try {
    const provider = metaSam()
    assert.equal(provider.id, 'sam3.1')
    await assert.rejects(
      provider.segment({ screenshot: 's.png', viewport: { width: 100, height: 100 } }, '/tmp/doesnotmatter'),
      /SAM 3\.1 via Meta Model API not configured: set META_API_KEY, META_API_BASE_URL, META_SAM_MODEL/
    )
  } finally {
    for (const [k, envKey] of [['key', 'META_API_KEY'], ['base', 'META_API_BASE_URL'], ['model', 'META_SAM_MODEL']]) {
      if (prev[k] !== undefined) process.env[envKey] = prev[k]
    }
  }
})

test('meta-sam: still throws not-configured even with a readable screenshot (checked before fetch)', async () => {
  delete process.env.META_API_KEY
  delete process.env.META_API_BASE_URL
  delete process.env.META_SAM_MODEL
  const provider = metaSam()
  // runDir/screenshot don't need to exist: the config check must happen before any fs/network call.
  await assert.rejects(provider.segment({ screenshot: 'missing.png' }, '/no/such/dir'), /not configured/)
})

// ── parseSamOutput / toRegions: the response→Region mapping (sample shape from docs research) ──

// Sample output_text shape per docs/providers-research.md §1b: a frame marker, then one
// <|box;...|> per detection, optionally followed by its <|mask;...|>. The API's reference frame
// here (w=720,h=450) is half the real page (1440x900), so scale should halve-undo it.
const SAMPLE_OUTPUT_TEXT =
  '<0f>' +
  '<|box;x1=10;y1=10;x2=60;y2=30;w=720;h=450|>' +
  '<|mask;x=10;y=10;data=46,101,~abc|>' +
  '<|box;x1=100;y1=200;x2=160;y2=236;w=720;h=450|>'

test('parseSamOutput tokenizes boxes and pairs the trailing mask with the preceding box', () => {
  const dets = parseSamOutput(SAMPLE_OUTPUT_TEXT)
  assert.equal(dets.length, 2)
  assert.deepEqual(dets[0].box, { x1: 10, y1: 10, x2: 60, y2: 30, w: 720, h: 450 })
  assert.equal(dets[0].mask, '46,101,~abc')
  assert.equal(dets[1].mask, undefined)
})

test('parseSamOutput returns [] for empty/garbage input', () => {
  assert.deepEqual(parseSamOutput(''), [])
  assert.deepEqual(parseSamOutput(null), [])
  assert.deepEqual(parseSamOutput('no tokens here'), [])
})

test('extractOutputText reads output_text directly or from a Responses-style envelope', () => {
  assert.equal(extractOutputText('raw string'), 'raw string')
  assert.equal(extractOutputText({ output_text: 'x' }), 'x')
  assert.equal(extractOutputText({ output: [{ content: [{ type: 'output_text', text: 'y' }] }] }), 'y')
  assert.equal(extractOutputText({}), '')
})

test('toRegions maps the sample shape to page-px Region[] and scales by the reference frame', () => {
  const scale = { x: 1440 / 720, y: 900 / 450 } // = {x:2, y:2}
  const regions = toRegions(SAMPLE_OUTPUT_TEXT, scale, { label: 'button', source: 'sam3.1' })
  assert.equal(regions.length, 2)
  assert.deepEqual(regions[0], { id: 'r0', bbox: [20, 20, 100, 40], label: 'button', score: 0.9, source: 'sam3.1' })
  assert.deepEqual(regions[1].bbox, [200, 400, 120, 72])
  assert.equal(regions[1].mask, undefined)
})

test('toRegions wires detected masks through the onMask callback and ids continue from startIndex', () => {
  const seen = []
  const regions = toRegions(SAMPLE_OUTPUT_TEXT, { x: 1, y: 1 }, {
    label: 'card',
    startIndex: 5,
    onMask: (maskData, region, i) => {
      seen.push({ maskData, id: region.id, i })
      return `mask-${region.id}.raw`
    },
  })
  assert.equal(regions[0].id, 'r5')
  assert.equal(regions[0].mask, 'mask-r5.raw')
  assert.equal(regions[1].mask, undefined) // no mask token followed the second box
  assert.deepEqual(seen, [{ maskData: '46,101,~abc', id: 'r5', i: 0 }])
})

test('toRegions accepts a full JSON envelope too, not just a raw string', () => {
  const json = { output: [{ content: [{ type: 'output_text', text: SAMPLE_OUTPUT_TEXT }] }] }
  const regions = toRegions(json, { x: 1, y: 1 }, { label: 'icon' })
  assert.equal(regions.length, 2)
  assert.equal(regions[0].label, 'icon')
})

test('meta-sam and local-sam agree on the concept prompt vocabulary', () => {
  assert.deepEqual(META_PROMPTS, LOCAL_PROMPTS)
  assert.ok(META_PROMPTS.includes('button') && META_PROMPTS.includes('search bar'))
})

// ── local-sam: argv construction (no spawn) ─────────────────────────────────────────────────────

test('local-sam buildArgs: default prompts, script path and flags', () => {
  const args = buildArgs({ imagePath: '/run/screenshot.png', outPath: '/run/sam-local.json' })
  assert.equal(args[0].endsWith('scripts/sam_local.py'), true)
  assert.deepEqual(args.slice(1), [
    '--image', '/run/screenshot.png',
    '--prompts', LOCAL_PROMPTS.join(','),
    '--out', '/run/sam-local.json',
  ])
})

test('local-sam buildArgs: custom prompts, script path and model are passed through', () => {
  const args = buildArgs({
    imagePath: 'a.png',
    outPath: 'b.json',
    prompts: ['button', 'card'],
    scriptPath: '/custom/sam_local.py',
    model: 'facebook/sam3',
  })
  assert.deepEqual(args, [
    '/custom/sam_local.py',
    '--image', 'a.png',
    '--prompts', 'button,card',
    '--out', 'b.json',
    '--model', 'facebook/sam3',
  ])
})

test('local-sam: provider id is sam-local', () => {
  const provider = localSam()
  assert.equal(provider.id, 'sam-local')
})
