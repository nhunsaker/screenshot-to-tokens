// Local SAM fallback: spawns scripts/sam_local.py (transformers + torch, MPS-if-available) and
// reads back a Region[] JSON file. No network calls here — the heavy lifting is Python's.
// NOT run from this task (see docs/providers-research.md §3: the official SAM 3/3.1 repo expects
// CUDA, MPS support is unverified, and this machine's owner restricts heavy jobs to 00:00–06:00 CDT
// unless a window is granted). Build it, don't run it.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_SCRIPT_PATH = resolve(__dirname, '../../../scripts/sam_local.py')

/** Same concept vocabulary as meta-sam.js, kept local so this provider has no import-time dependency on it. */
export const CONCEPT_PROMPTS = [
  'button', 'text input', 'card', 'navigation bar', 'header', 'link', 'icon', 'image', 'badge',
]

/**
 * Build the argv for `python3 scripts/sam_local.py ...`. Pure + exported so tests can check the
 * exact flags without spawning anything.
 * @param {{imagePath:string, outPath:string, prompts?:string[], scriptPath?:string, model?:string}} o
 * @returns {string[]}
 */
export function buildArgs(o) {
  const prompts = o.prompts && o.prompts.length ? o.prompts : CONCEPT_PROMPTS
  const args = [
    o.scriptPath || DEFAULT_SCRIPT_PATH,
    '--image', o.imagePath,
    '--prompts', prompts.join(','),
    '--out', o.outPath,
  ]
  if (o.model) args.push('--model', o.model)
  return args
}

/** Spawn python3 with argv, resolving when it exits 0, rejecting with stderr otherwise. */
function runPython(args) {
  return new Promise((resolvePromise, reject) => {
    // Weights download to the external drive by default (HF_HOME), never the nearly-full internal disk.
    const env = { ...process.env, HF_HOME: process.env.HF_HOME || join(process.env.S2T_MODELS_DIR || '/Volumes/SanDisk/models', 'huggingface') }
    const proc = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'], env })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('error', (e) => reject(new Error(`sam-local: failed to spawn python3: ${e.message}`)))
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`sam-local: scripts/sam_local.py exited ${code}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ''}`))
      else resolvePromise()
    })
  })
}

/** @returns {import('../../types.js').SegmentProvider} */
export default function localSam() {
  return {
    id: 'sam-local',
    async segment(capture, runDir) {
      const imagePath = join(runDir, capture.screenshot)
      const outPath = join(runDir, 'sam-local.json')
      const args = buildArgs({ imagePath, outPath, model: process.env.SAM_LOCAL_MODEL })
      await runPython(args)
      if (!existsSync(outPath)) throw new Error('sam-local: scripts/sam_local.py exited 0 but wrote no output file')
      /** @type {import('../../types.js').Region[]} */
      const regions = JSON.parse(readFileSync(outPath, 'utf-8'))
      return regions
    },
  }
}
