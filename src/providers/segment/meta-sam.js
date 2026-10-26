// SAM 3.1 via the Meta Model API (promptable concept segmentation: "button", "card", ...).
// See docs/providers-research.md §1b for what we found pre-access and what to verify Oct 26.
// Data policy: only public, non-sensitive (class C) screenshots go here, on the *standard* model
// id. Never point META_SAM_MODEL at a "-contributor" variant — that tier trains on submitted data.
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'
import { createHash } from 'crypto'
import { cached } from '../../lib/cache.js'
import { postprocessRegions } from '../../stages/segeval.js'

/** Concept prompts sent one per call; each maps to a Region.label. */
// Tuned 2026-10-26 against the live API on acme-shop + div-soup. SAM 3.1 answers for named objects only:
// "button", "search bar", "input field", "icon", "price" return boxes; card, text input, navigation bar, header, link,
// badge, image, panel, tag, label, menu, logo, tab, checkbox, dropdown, avatar, heading all returned zero. Layout
// containers come from the hybrid segmenter's layout + DOM rules instead. Override: S2T_SAM_PROMPTS="a,b,c".
export const CONCEPT_PROMPTS = ['button', 'search bar', 'icon']
export const promptsFromEnv = () =>
  process.env.S2T_SAM_PROMPTS ? process.env.S2T_SAM_PROMPTS.split(',').map((p) => p.trim()).filter(Boolean) : CONCEPT_PROMPTS

export const LABEL_BY_PROMPT = {
  button: 'button',
  'search bar': 'input',
  'input field': 'input',
  price: 'text',
  'text input': 'input',
  card: 'card',
  'navigation bar': 'nav',
  header: 'header',
  link: 'link',
  icon: 'icon',
  image: 'image',
  badge: 'badge',
}

// Tokenizes the assumed SAM 3.1 "Responses API" output_text stream, e.g.:
//   <0f><|box;x1=10;y1=10;x2=110;y2=46;w=1440;h=900|><|mask;x=0;y=0;data=46,101,~abc|>...
// A mask token (if present) always belongs to the immediately preceding box token.
const TOKEN_RE =
  /<\|box;x1=([-\d.]+);y1=([-\d.]+);x2=([-\d.]+);y2=([-\d.]+);w=([-\d.]+);h=([-\d.]+)\|>|<\|mask;x=([-\d.]+);y=([-\d.]+);data=([^|]*)\|>/g

/**
 * Pure tokenizer: output_text → [{box:{x1,y1,x2,y2,w,h}, mask?:string}]. Exported for tests.
 * @param {string} text
 */
export function parseSamOutput(text) {
  if (!text) return []
  const dets = []
  let cur = null
  let m
  const re = new RegExp(TOKEN_RE)
  while ((m = re.exec(String(text)))) {
    if (m[1] !== undefined) {
      cur = { box: { x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]), w: Number(m[5]), h: Number(m[6]) } }
      dets.push(cur)
    } else if (m[7] !== undefined && cur) {
      cur.mask = m[9]
    }
  }
  return dets
}

/** Pull the output_text out of whatever envelope shape the JSON response turns out to use. */
export function extractOutputText(json) {
  if (typeof json === 'string') return json
  if (typeof json?.output_text === 'string') return json.output_text
  const content = json?.output?.[0]?.content
  if (Array.isArray(content)) {
    const t = content.find((c) => typeof c?.text === 'string')
    if (t) return t.text
  }
  return ''
}

/**
 * Response (or raw output_text) → Region[]. Pure except for the optional onMask callback, so it's
 * unit-testable without the network or the filesystem.
 * @param {any} apiJson            Parsed JSON response, or a raw output_text string.
 * @param {{x:number,y:number}} [scale]  Multiplier from the API's reference frame to page px.
 * @param {{label?:string, source?:string, score?:number, idPrefix?:string, startIndex?:number,
 *   onMask?: (maskData:string, region:import('../../types.js').Region, i:number) => (string|undefined)}} [opts]
 * @returns {import('../../types.js').Region[]}
 */
export function toRegions(apiJson, scale = { x: 1, y: 1 }, opts = {}) {
  const { label = 'other', source = 'sam3.1', score = 0.9, idPrefix = 'r', startIndex = 0, onMask } = opts
  const text = typeof apiJson === 'string' ? apiJson : extractOutputText(apiJson)
  const dets = parseSamOutput(text)
  return dets.map((d, i) => {
    const { x1, y1, x2, y2 } = d.box
    const bbox = /** @type {[number,number,number,number]} */ ([
      Math.round(x1 * scale.x),
      Math.round(y1 * scale.y),
      Math.round((x2 - x1) * scale.x),
      Math.round((y2 - y1) * scale.y),
    ])
    const region = { id: `${idPrefix}${startIndex + i}`, bbox, label, score, source }
    if (d.mask && typeof onMask === 'function') {
      const maskPath = onMask(d.mask, region, i)
      if (maskPath) region.mask = maskPath
    }
    return region
  })
}

// ASSUMPTION (verify Oct 26) ───────────────────────────────────────────────────────────────────
// Everything in this function is the best-guess request shape from pre-access docs
// (docs/providers-research.md §1b): POST {base}/v1/responses, a "Responses API" style input array
// mixing input_text (the concept prompt) and input_image (base64 data URI), one call per concept.
// This is the ONE function to fix once real docs/an example response exist — nothing else in this
// file should need to change (parseSamOutput/toRegions above already accept the token-stream shape;
// if the real shape is plain JSON boxes instead, only extractOutputText + this function change).
/** `${base}/v1/responses`, without doubling /v1 when the base already ends in it (api.meta.ai/v1). */
export const responsesUrl = (baseURL) => {
  const b = String(baseURL).replace(/\/+$/, '')
  return /\/v1$/.test(b) ? `${b}/responses` : `${b}/v1/responses`
}

async function callSam(o) {
  // Cached by model + prompt + image hash (the key never includes the API key or the full image).
  const req = { baseURL: o.baseURL, model: o.model, prompt: o.prompt, image: createHash('sha256').update(o.imageDataUrl).digest('hex') }
  const { cached: _hit, ...json } = await cached('sam', req, () => callSamUncached(o))
  return json
}

async function callSamUncached({ baseURL, apiKey, model, imageDataUrl, prompt }) {
  const res = await fetch(responsesUrl(baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageDataUrl },
          ],
        },
      ],
      metadata: { mask_encoding: 'one_bit' },
    }),
  })
  if (!res.ok) throw new Error(`SAM 3.1 ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Run fn over items with at most `limit` in flight; results keep input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** Max tile height. Full-page captures can be 6000+ px tall; segmentation works better per screenful. */
export const TILE_H = 1600

/** Split a PNG into vertical tiles: [{y, png}] with page-px y offsets. Pure; exported for tests. */
export function tilePng(png, tileH = TILE_H) {
  if (png.height <= tileH) return [{ y: 0, png }]
  const tiles = []
  for (let y = 0; y < png.height; y += tileH) {
    const h = Math.min(tileH, png.height - y)
    const t = new PNG({ width: png.width, height: h })
    PNG.bitblt(png, t, 0, y, png.width, h, 0, 0)
    tiles.push({ y, png: t })
  }
  return tiles
}

/** @returns {import('../../types.js').SegmentProvider} */
export default function metaSam() {
  return {
    id: 'sam3.1',
    async segment(capture, runDir) {
      const apiKey = process.env.META_API_KEY
      // Defaults confirmed via GET /v1/models on 2026-10-26 (id is "sam-3.1").
      const baseURL = process.env.META_API_BASE_URL || 'https://api.meta.ai/v1'
      const model = process.env.META_SAM_MODEL || 'sam-3.1'
      if (!apiKey || !baseURL || !model) {
        throw new Error(
          'SAM 3.1 via Meta Model API not configured: set META_API_KEY, META_API_BASE_URL, META_SAM_MODEL (access lands with approval, Oct 26)'
        )
      }
      const screenshotPath = join(runDir, capture.screenshot)
      const full = PNG.sync.read(readFileSync(screenshotPath))

      // Every (tile, prompt) pair is an independent call: run them concurrently (default 4 at a time),
      // then assemble results in a fixed order so region ids and masks stay deterministic.
      const jobs = []
      for (const tile of tilePng(full, Number(process.env.S2T_SAM_TILE_H || TILE_H))) {
        const imageDataUrl = `data:image/png;base64,${PNG.sync.write(tile.png).toString('base64')}`
        for (const prompt of promptsFromEnv()) jobs.push({ tile, imageDataUrl, prompt })
      }
      const calls = jobs.length
      const results = await mapLimit(jobs, Number(process.env.S2T_SAM_CONCURRENCY || 4), async (j) => {
        try {
          return { json: await callSam({ baseURL, apiKey, model, imageDataUrl: j.imageDataUrl, prompt: j.prompt }) }
        } catch (e) {
          return { error: `${j.prompt}@y${j.tile.y}: ${e.message}` }
        }
      })

      /** @type {import('../../types.js').Region[]} */
      const regions = []
      const errors = []
      results.forEach((res, k) => {
        const { tile, prompt } = jobs[k]
        // One concept failing shouldn't sink the whole step, but record it: all failing throws below.
        if (res.error) { errors.push(res.error); return }
        const text = extractOutputText(res.json)
        const dets = parseSamOutput(text)
        if (!dets.length) return
        // If the API resized the image before detecting, dets[0].box.w/h is its reference frame;
        // scale back to the page-px tile we sent, then shift by the tile's page offset.
        const { w: refW, h: refH } = dets[0].box
        const scale = { x: refW ? tile.png.width / refW : 1, y: refH ? tile.png.height / refH : 1 }
        const mapped = toRegions(text, scale, {
          label: LABEL_BY_PROMPT[prompt] || 'other',
          source: 'sam3.1',
          idPrefix: 'r',
          startIndex: regions.length,
          onMask: (maskData, region) => {
            try {
              const maskPath = `mask-${region.id}.raw`
              // Mask encoding not decoded yet: keep the raw token payload so nothing is lost.
              writeFileSync(join(runDir, maskPath), String(maskData))
              return maskPath
            } catch (e) {
              return undefined
            }
          },
        })
        for (const r of mapped) r.bbox[1] += tile.y
        regions.push(...mapped)
      })
      if (errors.length === calls) throw new Error(`SAM 3.1: all ${calls} calls failed; first: ${errors[0]}`)
      if (errors.length) console.warn(`  segment  ${errors.length}/${calls} SAM calls failed (first: ${errors[0]})`)
      return postprocessRegions(regions)
    },
  }
}
