// Fallback segmenter: ask a vision LLM (Muse Spark 1.3 on the Meta Model API, or any OpenAI-compatible
// vision model) for UI element boxes as JSON. Used if SAM 3.1 scores NO-GO on UI screenshots
// (`s2t segeval`). Same tiling as meta-sam so tall pages stay legible.
// Data policy: public, non-sensitive screenshots only; standard (non "-contributor") model ids only.
import { readFileSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'
import { postprocessRegions } from '../../stages/segeval.js'
import { LLM_PRESETS } from '../../config.js'
import { chat, extractJson } from '../llm/chat.js'
import { tilePng, TILE_H } from './meta-sam.js'

export const LABELS = ['button', 'input', 'card', 'nav', 'header', 'footer', 'link', 'badge', 'image', 'icon']

export const VISION_PROMPT = `You are labeling a screenshot of a web page for a design-system audit.
Return JSON only: {"width":W,"height":H,"elements":[{"label":"button","box":[x1,y1,x2,y2]}]}
- width/height: the image size you measured coordinates against.
- label: one of ${LABELS.join(', ')}.
- box: pixel coordinates of the element's visible edges (x1,y1 top-left, x2,y2 bottom-right).
- Include every distinct button, input, card, badge, nav, header and footer. Skip plain paragraphs.`

/**
 * Model reply (parsed) → Region[] in page px. Pure; exported for tests.
 * @param {any} json  {width, height, elements:[{label, box:[x1,y1,x2,y2]}]}
 * @param {{width:number, height:number, y:number}} tile  The tile we sent and its page offset.
 * @param {number} startIndex
 */
export function visionToRegions(json, tile, startIndex = 0) {
  const sx = json?.width ? tile.width / json.width : 1
  const sy = json?.height ? tile.height / json.height : 1
  const out = []
  for (const e of Array.isArray(json?.elements) ? json.elements : []) {
    const b = e?.box
    if (!Array.isArray(b) || b.length !== 4 || b.some((n) => typeof n !== 'number')) continue
    const [x1, y1, x2, y2] = b
    if (x2 <= x1 || y2 <= y1) continue
    const label = LABELS.includes(e.label) ? e.label : 'other'
    out.push({
      id: `v${startIndex + out.length}`,
      bbox: [Math.round(x1 * sx), Math.round(y1 * sy + tile.y), Math.round((x2 - x1) * sx), Math.round((y2 - y1) * sy)],
      label, score: typeof e.score === 'number' ? e.score : 0.7, source: 'vision-llm',
    })
  }
  return out
}

/** @param {'meta'|'ollama'|'fireworks'} [presetId] @returns {import('../../types.js').SegmentProvider} */
export default function metaVision(presetId = 'meta') {
  return {
    id: `vision:${presetId}`,
    async segment(capture, runDir) {
      const cfg = LLM_PRESETS[presetId]()
      const model = process.env.META_VISION_MODEL || cfg.model
      if (presetId !== 'ollama' && !cfg.apiKey) throw new Error(`vision segmenter (${presetId}) not configured: set META_API_KEY, META_API_BASE_URL, META_VISION_MODEL (or META_NAMER_MODEL)`)
      if (!cfg.baseURL || !model) throw new Error(`vision segmenter (${presetId}) not configured: base URL / model missing`)
      const full = PNG.sync.read(readFileSync(join(runDir, capture.screenshot)))
      const regions = []
      for (const t of tilePng(full, Number(process.env.S2T_SAM_TILE_H || TILE_H))) {
        const url = `data:image/png;base64,${PNG.sync.write(t.png).toString('base64')}`
        const { text } = await chat({
          ...cfg, model, json: true,
          messages: [{ role: 'user', content: [{ type: 'text', text: VISION_PROMPT }, { type: 'image_url', image_url: { url } }] }],
        })
        regions.push(...visionToRegions(extractJson(text), { width: t.png.width, height: t.png.height, y: t.y }, regions.length))
      }
      return postprocessRegions(regions)
    },
  }
}
