#!/usr/bin/env node
// Token playground: the tokenized app in an iframe next to a panel of its real tokens. Changing a token sets the CSS
// custom property inside the iframe (same origin), so the app updates live and aliases cascade
// (change color.blue.500 and everything aliased to it follows). Nothing is merged; a link captures the proposal.
//   node scripts/build-playground.mjs <run dir> <out dir> [--app ../tokens/] [--title "Argon Dashboard"]
// <run dir> needs tokens.json, clusters.json, rewrite.json (the run whose tokens.css the app loads); capture.json adds
// the text/background pairs the accessibility audit checks. For Muse (audit fixes, dark theme) use `s2t playground`.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from '../src/lib/args.js'
import { playgroundData, readRun } from '../src/stages/playground.js'

const a = parseArgs(process.argv.slice(2))
const [runDir, outDir] = a._.map((p) => resolve(p))
if (!runDir || !outDir) {
  console.error('usage: node scripts/build-playground.mjs <run dir> <out dir> [--app ../tokens/] [--title <name>]')
  process.exit(2)
}
// Static build: no /api/muse here, so the page hides the Muse buttons; the contrast audit still runs in the browser.
const data = playgroundData(readRun(runDir), { title: a.title, app: a.app })
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'tokens.json'), JSON.stringify(data, null, 1))
const client = join(dirname(fileURLToPath(import.meta.url)), '../src/preview-client')
writeFileSync(join(outDir, 'index.html'), readFileSync(join(client, 'playground.html'), 'utf-8'))
copyFileSync(join(client, 'contrast.js'), join(outDir, 'contrast.js'))
console.log(`playground: ${data.tokens.length} tokens, ${data.pairs.length} text pairs → ${outDir}`)
