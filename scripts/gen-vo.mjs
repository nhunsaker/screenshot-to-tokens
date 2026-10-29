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
// VO_FORMAT: an ElevenLabs output_format (mp3_44100_192, pcm_44100, ...). pcm_* is raw 16-bit mono; it is wrapped
// as a .wav here. The file name keeps vo-<n>.mp3 for mp3 formats and becomes vo-<n>.wav for pcm.
if (process.env.VO_FORMAT) VOICE.format = process.env.VO_FORMAT
const PCM = VOICE.format.startsWith('pcm_'), EXT = PCM ? 'wav' : 'mp3'
const wavHeader = (n, rate) => { const b = Buffer.alloc(44); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b }
const lines = JSON.parse(readFileSync(linesPath, 'utf-8'))
mkdirSync(outDir, { recursive: true })
const key = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'elevenlabs-api', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
for (const [i, raw] of lines.entries()) {
  const out = join(outDir, `vo-${i + 1}.${EXT}`)
  if (existsSync(out)) { console.log(`vo-${i + 1}: exists, skipped`); continue } // never pay twice for the same line
  const text = SAY.reduce((t, [re, s]) => t.replace(re, s), raw)
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=${VOICE.format}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: PCM ? '*/*' : 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: VOICE.model, voice_settings: VOICE.settings }),
  })
  if (!res.ok) { console.error(`vo-${i + 1}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}; stopping (no retry)`); process.exit(1) }
  const body = Buffer.from(await res.arrayBuffer())
  writeFileSync(out, PCM ? Buffer.concat([wavHeader(body.length, Number(VOICE.format.split('_')[1])), body]) : body)
  console.log(`vo-${i + 1}: ${text.length} chars → ${out}`)
}
