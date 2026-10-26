// Provider selection from env (+ an optional .env file). No dotenv dependency.
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execFileSync } from 'child_process'

/** Meta API key from the macOS login Keychain (service "meta-hackathon-api"), so it never sits in a file. */
function keychainMetaKey() {
  if (process.platform !== 'darwin') return ''
  try {
    return execFileSync('security', ['find-generic-password', '-s', process.env.META_KEYCHAIN_SERVICE || 'meta-hackathon-api', '-w'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (e) {
    return ''
  }
}

/** Load KEY=VALUE lines from .env into process.env without overriding real env vars; then fill META_API_KEY from the Keychain. */
export function loadDotEnv(cwd = process.cwd()) {
  try { readDotEnv(cwd) } finally {
    if (!process.env.META_API_KEY) {
      const k = keychainMetaKey()
      if (k) process.env.META_API_KEY = k
    }
  }
}

function readDotEnv(cwd) {
  const p = resolve(cwd, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

/** The OpenAI-compatible endpoints we know how to call. Meta's base URL is unknown until access. */
export const LLM_PRESETS = {
  ollama: () => ({
    id: 'ollama',
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  }),
  meta: () => ({
    id: 'meta',
    // Defaults from dev.meta.ai/docs/quickstart (2026-10-26). Never a "-contributor" model id.
    baseURL: process.env.META_API_BASE_URL || 'https://api.meta.ai/v1',
    apiKey: process.env.META_API_KEY || '',
    model: process.env.META_NAMER_MODEL || 'muse-spark-1.3',
  }),
  fireworks: () => ({
    id: 'fireworks',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    apiKey: process.env.FIREWORKS_API_KEY || '',
    model: process.env.FIREWORKS_MODEL || 'accounts/fireworks/models/llama-v3p1-8b-instruct',
  }),
}

export function settings() {
  return {
    segmenter: process.env.S2T_SEGMENTER || 'mock',
    namer: process.env.S2T_NAMER || 'mock',
    coder: process.env.S2T_CODER || 'deterministic',
    viewport: { width: 1440, height: 900 },
    verifyThreshold: Number(process.env.S2T_VERIFY_THRESHOLD || 0.001),
  }
}
