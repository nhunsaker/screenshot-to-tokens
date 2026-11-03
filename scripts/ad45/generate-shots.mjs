#!/usr/bin/env node
// Generate the 45 s promo's seven cut scenes on Runway (spec/metatoy-studio/hackathons/ad-45s-script.md §B).
// Per shot: a keyframe from the prompt (gen4_image, 16:9), then image_to_video (gen4_turbo) with the motion prompt.
//   node scripts/ad45/generate-shots.mjs [--only 1,5] [--model gen4_turbo] [--dry]
// Key: macOS Keychain item `runway-api` (never printed). Output: out/ad45/shots/shot-<n>.mp4 + keyframe-<n>.png.
// Runway API: https://docs.dev.runwayml.com — durations are 5 or 10 s, ratio 1280:720.
import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { parseArgs } from '../../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const KEY = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'runway-api', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const BASE = 'https://api.dev.runwayml.com/v1'
const H = { Authorization: `Bearer ${KEY}`, 'X-Runway-Version': '2024-11-06', 'content-type': 'application/json' }
const MODEL = a.model || 'gen4_turbo'
const OUT = 'out/ad45/shots'
mkdirSync(OUT, { recursive: true })

const STYLE = 'Clean 3D motion graphics, dark charcoal background, soft studio light from the top left, shallow depth of field. Palette: one electric indigo blue, a magenta accent, a muted green for passes, warm off-white surfaces. Flat UI panels floating in space with gentle parallax, thin glowing outlines, precise and calm, like a product film for a developer tool. No people, no text, no letters, no logos, no lens flares.'

// seconds: Runway accepts 5 or 10. The edit trims each to its slot (the VO sets the real timing).
const SHOTS = [
  { n: 1, seconds: 5, frame: 'A tall sheet of code floats in the dark, hundreds of small color swatches scattered down its lines like loose beads, each a slightly different blue or gray. One swatch near the center glows faintly.', motion: 'The camera drifts slowly down the sheet. The glowing swatch pulses gently. Everything else is still.' },
  { n: 2, seconds: 10, frame: 'A screenshot of a dashboard rendered as a dense field of pixels, slightly out of focus, with eight rectangular button shapes and one chart area.', motion: 'Thin glowing indigo outlines bloom one by one around the eight button shapes, tracing their edges with a drawn-on feel, including one inside the chart. The field sharpens as the outlines complete. Slow push in.' },
  { n: 3, seconds: 10, frame: 'Dozens of loose color swatches hover above a dark code sheet, about to lift off, with three empty stacked rows faintly outlined in mid air above them.', motion: 'The swatches fly toward the camera and sort themselves into the three stacked rows: a wide bottom row, a narrower middle row, a short top row. Thin lines connect each swatch to the one above it like a family tree assembling itself. Calm and precise, then a slight orbit.' },
  { n: 4, seconds: 10, frame: 'Lines of code on a dark floating panel, each line a plain bar with a small colored block at its end. Below the panel, four small unlit circles in a row.', motion: 'One by one the colored blocks slide left and a slim indigo capsule takes their place, the old block tucking inside the capsule like a seed in a pod. The four circles light up green in sequence. A rectangular card slides in from the right edge like a document being filed.' },
  { n: 5, seconds: 10, frame: 'A floating dashboard panel with a large number and a small gray caption under it, a slim cursor arrow nearby, a thin empty horizontal meter under the panel.', motion: 'The cursor glides onto the caption; a thin magenta outline draws itself around the caption. A short row of vertical bars rises beside the cursor like a sound wave and pulses, then fades. The gray caption darkens to a deep slate gray and twenty other small captions across the panel darken in the same moment. The meter fills from a third to three quarters and turns green.' },
  { n: 6, seconds: 5, frame: 'Twenty-eight small identical cards arranged in a tidy grid across the frame, each face down, in the dark.', motion: 'The cards flip in a fast wave to show a thin green check each. The grid holds, then a single wide deep-red card with a thin pale outline slides over it, firm and final, and the grid behind it dims.' },
  { n: 7, seconds: 5, frame: 'An empty dark frame with a single small indigo capsule at the center catching a little light.', motion: 'The capsule expands smoothly into a wide clean panel. The panel settles and holds. Nothing else moves.' },
]

const only = a.only ? String(a.only).split(',').map(Number) : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`)
  return j
}
async function waitTask(id, label) {
  for (let i = 0; i < 120; i++) {
    await sleep(5000)
    const r = await fetch(`${BASE}/tasks/${id}`, { headers: H })
    const j = await r.json()
    if (j.status === 'SUCCEEDED') return j.output
    if (j.status === 'FAILED' || j.status === 'CANCELLED') throw new Error(`${label}: ${j.status} ${j.failure || ''} ${j.failureCode || ''}`)
    if (i % 6 === 5) console.log(`  ${label}: ${j.status} (${(i + 1) * 5} s)`)
  }
  throw new Error(`${label}: timed out`)
}
async function download(url, file) {
  const r = await fetch(url)
  writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

for (const s of SHOTS) {
  if (only && !only.includes(s.n)) continue
  const key = `${OUT}/keyframe-${s.n}.png`, vid = `${OUT}/shot-${s.n}.mp4`
  if (existsSync(vid)) { console.log(`shot ${s.n}: exists, skip`); continue }
  console.log(`shot ${s.n}: keyframe…`)
  if (a.dry) { console.log(`  [dry] ${STYLE} ${s.frame}`); console.log(`  [dry] ${s.motion} (${s.seconds}s)`); continue }
  // 1. keyframe
  const img = await post('/text_to_image', { model: 'gen4_image', promptText: `${STYLE} ${s.frame}`, ratio: '1920:1080' })
  const imgOut = await waitTask(img.id, `shot ${s.n} keyframe`)
  await download(imgOut[0], key)
  // 2. motion
  console.log(`shot ${s.n}: video (${MODEL}, ${s.seconds} s)…`)
  const b64 = `data:image/png;base64,${readFileSync(key).toString('base64')}`
  const v = await post('/image_to_video', { model: MODEL, promptImage: b64, promptText: `${STYLE} ${s.motion}`, ratio: '1280:720', duration: s.seconds })
  const vOut = await waitTask(v.id, `shot ${s.n} video`)
  await download(vOut[0], vid)
  console.log(`shot ${s.n} → ${vid}`)
}
console.log('done')
