#!/usr/bin/env node
// Slim a run's report.html for the static demo site: every embedded data:image is written once to its own file
// (deduplicated by content hash) and the HTML points at it, so an 80 MB report becomes a few hundred KB of HTML plus a
// handful of images. Absolute local paths (/Users/…, /Volumes/…, /data/…) are scrubbed to the run-relative form.
// Usage: node scripts/slim-report.mjs <run dir> <out dir> [label shown in place of the local server URL]
// Tier C imports slimReport() for each visitor's result page.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** @returns {{html:number, images:number, imageBytes:number}} */
export function slimReport(run, outDir, label) {
  mkdirSync(join(outDir, 'img'), { recursive: true })
  let html = readFileSync(join(run, 'report.html'), 'utf-8')
  const seen = new Map()
  html = html.replace(/data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)/g, (_, ext, b64) => {
    const buf = Buffer.from(b64, 'base64')
    const name = `img/${createHash('sha256').update(buf).digest('hex').slice(0, 12)}.${ext === 'jpeg' ? 'jpg' : ext}`
    if (!seen.has(name)) { writeFileSync(join(outDir, name), buf); seen.set(name, buf.length) }
    return name
  })
  html = html.replace(/(?:serve:)?\/(?:Users|Volumes|private|tmp|data|app)\/[^"'<>\s)]*/g, (m) => '…/' + m.split('/').slice(-2).join('/'))
  // The run served the app on an ephemeral 127.0.0.1 port; show what was captured instead of a dead local URL.
  if (label) html = html.replace(/(<div class="run-url">)[^<]*(<\/div>)/, (_, a, b) => a + label.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + b)
  writeFileSync(join(outDir, 'report.html'), html)
  for (const f of ['tokens.css', 'tokens.dtcg.json']) if (existsSync(join(run, f))) copyFileSync(join(run, f), join(outDir, f))
  const imageBytes = [...seen.values()].reduce((a, b) => a + b, 0)
  return { html: html.length, images: seen.size, imageBytes }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [run, outDir, label] = process.argv.slice(2)
  if (!run || !outDir) { console.error('usage: slim-report.mjs <run dir> <out dir>'); process.exit(2) }
  const r = slimReport(run, outDir, label)
  console.log(`${outDir}: report.html ${(r.html / 1024).toFixed(0)} KB, ${r.images} images ${(r.imageBytes / 1024).toFixed(0)} KB`)
}
