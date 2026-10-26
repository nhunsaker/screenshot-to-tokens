#!/usr/bin/env node
// Access day (Mon Oct 26): one command that checks the Meta Model API against our assumptions and
// tells you what to fix. Run after filling .env:  node scripts/access-day.mjs
// Every probe logs the RAW response to out/access-day/ so a shape mismatch is visible, not guessed at.
// Data: sends only the public acme-shop fixture screenshot. Refuses "-contributor" model ids.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { loadDotEnv } from '../src/config.js'
import { responsesUrl } from '../src/providers/segment/meta-sam.js'

loadDotEnv()
const out = join('out', 'access-day')
mkdirSync(out, { recursive: true })
const env = process.env
const results = []
const step = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`) }
const save = (f, body) => writeFileSync(join(out, f), typeof body === 'string' ? body : JSON.stringify(body, null, 2))

// Defaults confirmed 2026-10-26 (quickstart + GET /v1/models); the key comes from the Keychain via loadDotEnv.
env.META_API_BASE_URL ||= 'https://api.meta.ai/v1'
env.META_NAMER_MODEL ||= 'muse-spark-1.3'
env.META_SAM_MODEL ||= 'sam-3.1'
if (!env.META_API_KEY) { console.error('No META_API_KEY (env, .env, or Keychain service "meta-hackathon-api")'); process.exit(2) }
if ([env.META_NAMER_MODEL, env.META_SAM_MODEL, env.META_VISION_MODEL].filter(Boolean).some((m) => /contributor/i.test(m))) {
  console.error('Refusing: a "-contributor" model id is set. That tier trains on your data (policy: never).')
  process.exit(2)
}
if (process.argv.includes('--dry')) { console.log(`would probe ${env.META_API_BASE_URL} with ${env.META_NAMER_MODEL} + ${env.META_SAM_MODEL} (billed calls; run without --dry once credits land)`); process.exit(0) }
const base = env.META_API_BASE_URL.replace(/\/+$/, '')
const auth = { authorization: `Bearer ${env.META_API_KEY}`, 'content-type': 'application/json' }

async function probe(name, url, body, file) {
  try {
    const res = await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify(body) })
    const text = await res.text()
    save(file, `HTTP ${res.status}\n${text}`)
    return { status: res.status, text }
  } catch (e) {
    save(file, `ERROR ${e.message}`)
    return { status: 0, text: e.message }
  }
}

// 1. Chat (OpenAI-compatible) with JSON mode: what our namer uses.
const chatUrl = `${base}/chat/completions`
const c = await probe('chat', chatUrl, { model: env.META_NAMER_MODEL, messages: [{ role: 'user', content: 'Reply with JSON {"ok": true}' }], response_format: { type: 'json_object' } }, 'chat.txt')
let chatOk = false
try { chatOk = c.status === 200 && /"ok"\s*:\s*true/.test(JSON.parse(c.text).choices[0].message.content) } catch (e) { chatOk = false }
step('chat/completions + JSON mode', chatOk, chatOk ? chatUrl : `HTTP ${c.status}; see ${out}/chat.txt (try META_API_BASE_URL=https://api.llama.com/compat/v1 if 404)`)

// 2. Vision through chat (image_url data URI): what the vision namer/segmenter uses.
const shot = 'out/acme-shop/screenshot.png'
if (!existsSync(shot)) execFileSync('node', ['src/cli.js', 'run', '--fixture', 'acme-shop', '--to', 'capture'], { stdio: 'ignore' })
const b64 = readFileSync(shot).toString('base64')
const v = await probe('vision', chatUrl, { model: env.META_VISION_MODEL || env.META_NAMER_MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: 'How many blue buttons are in this screenshot? Reply with JSON {"buttons": N}' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] }], response_format: { type: 'json_object' } }, 'vision.txt')
step('chat with image input', v.status === 200, `HTTP ${v.status}; see ${out}/vision.txt`)

// 3. SAM 3.1, one concept, raw body saved: the ASSUMPTION in meta-sam.js lives or dies here.
const s = await probe('sam', responsesUrl(base), { model: env.META_SAM_MODEL, input: [{ role: 'user', content: [{ type: 'input_text', text: 'button' }, { type: 'input_image', image_url: `data:image/png;base64,${b64}` }] }], metadata: { mask_encoding: 'one_bit' } }, 'sam.txt')
const tokenStream = /<\|box;/.test(s.text)
step('SAM 3.1 responds', s.status === 200, `HTTP ${s.status}; see ${out}/sam.txt`)
step('SAM response uses the <|box;...|> token stream we parse', tokenStream, tokenStream ? '' : 'shape differs: update extractOutputText/parseSamOutput in meta-sam.js from sam.txt')

// 4. If the shapes hold, run the real pipeline + scores.
if (chatOk && tokenStream) {
  const run = 'out/acme-shop-meta'
  const e2 = { ...env, S2T_SEGMENTER: 'meta', S2T_NAMER: 'meta' }
  try {
    execFileSync('node', ['src/cli.js', 'run', '--fixture', 'acme-shop', '--run', run], { env: e2, stdio: 'inherit' })
    execFileSync('node', ['src/cli.js', 'segeval', '--run', run], { stdio: 'inherit' })
    execFileSync('node', ['src/cli.js', 'eval', '--fixture', 'acme-shop', '--run', run], { stdio: 'inherit' })
    step('full pipeline with SAM 3.1 + Muse Spark', true, `${run}/report.html`)
  } catch (e) {
    step('full pipeline with SAM 3.1 + Muse Spark', false, e.message.split('\n')[0])
  }
}
save('summary.json', results)
console.log(`\nraw responses + summary in ${out}/`)
