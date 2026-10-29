#!/usr/bin/env node
// Demo voiceover with the same ElevenLabs voice and settings as the flsx.io walkthrough
// (Metatoy's flsx.io walkthrough). Key from the macOS Keychain item `elevenlabs-api`; never printed.
//   node scripts/gen-vo.mjs out/video/vo-lines.json out/video/vo [voice id]
// Optional third argument: another ElevenLabs voice, same model and settings (the v3 cut's spoken requests use
// Michael, EK4IAYGwCrQUchP03Yjp; scripts/make-requests.sh turns them into fake-mic WAVs).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'

const VOICE = { id: 'nyfVCF0XNA1BwwJ7FiP2', model: 'eleven_multilingual_v2', format: 'mp3_44100_128', settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }
// Spoken forms only; the script text stays as written.
const SAY = [[/SAM 3\.1/g, 'SAM three point one'], [/\b20 of 21\b/g, 'twenty of twenty-one'], [/\b21 of 21\b/g, 'twenty-one of twenty-one'], [/\b23 of 23\b/g, 'twenty-three of twenty-three'], [/\b28\b/g, 'twenty-eight'], [/surface\.input/g, 'surface dot input'], [/WCAG 2\.1 AA/g, 'W-CAG two point one, double-A'], [/\b127\b/g, 'a hundred and twenty-seven']]
const [linesPath, outDir, voiceId] = process.argv.slice(2)
if (voiceId) VOICE.id = voiceId
const lines = JSON.parse(readFileSync(linesPath, 'utf-8'))
mkdirSync(outDir, { recursive: true })
const key = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'elevenlabs-api', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
for (const [i, raw] of lines.entries()) {
  const out = join(outDir, `vo-${i + 1}.mp3`)
  if (existsSync(out)) { console.log(`vo-${i + 1}: exists, skipped`); continue } // never pay twice for the same line
  const text = SAY.reduce((t, [re, s]) => t.replace(re, s), raw)
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=${VOICE.format}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: VOICE.model, voice_settings: VOICE.settings }),
  })
  if (!res.ok) { console.error(`vo-${i + 1}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}; stopping (no retry)`); process.exit(1) }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  console.log(`vo-${i + 1}: ${text.length} chars → ${out}`)
}
