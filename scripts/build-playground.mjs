#!/usr/bin/env node
// Token playground: the tokenized app in an iframe next to a panel of its real tokens. Changing a token sets the CSS
// custom property inside the iframe (same origin), so the app updates live and aliases cascade
// (change color.blue.500 and everything aliased to it follows). Nothing is merged; a link captures the proposal.
//   node scripts/build-playground.mjs <run dir> <out dir> [--app ../tokens/] [--title "Argon Dashboard"]
// <run dir> needs tokens.json, clusters.json, rewrite.json (the run whose tokens.css the app loads).
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from '../src/lib/args.js'
import { cssVarOf } from '../src/lib/props.js'
import { cssValue } from '../src/stages/emit.js'

const a = parseArgs(process.argv.slice(2))
const [runDir, outDir] = a._.map((p) => resolve(p))
if (!runDir || !outDir) {
  console.error('usage: node scripts/build-playground.mjs <run dir> <out dir> [--app ../tokens/] [--title <name>]')
  process.exit(2)
}
const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
const set = rd('tokens'), clusters = rd('clusters'), rewrite = rd('rewrite')
const kindOf = new Map(clusters.map((c) => [c.id, c.kind]))
const used = {}
for (const e of rewrite.edits) used[e.token] = (used[e.token] || 0) + 1

// Only kinds a person can meaningfully play with live: colors, radii, shadows stay out (complex values).
const PLAYABLE = new Set(['color', 'radius'])
const tokens = set.tokens
  .filter((t) => PLAYABLE.has(kindOf.get(t.clusters[0])))
  .map((t) => ({
    name: t.name, tier: t.tier, kind: kindOf.get(t.clusters[0]), cssVar: cssVarOf(t.name).slice(2),
    value: t.value ? cssValue(t.value) : null, alias: t.alias || null, why: t.why || '', uses: used[t.name] || 0,
  }))
// Order: semantic and component first (the decisions), then primitives by use.
const order = { semantic: 0, component: 1, primitive: 2 }
tokens.sort((x, y) => order[x.tier] - order[y.tier] || y.uses - x.uses)

const data = { title: a.title || 'Token playground', app: a.app || '../tokens/', namer: set.namer, edits: rewrite.edits.length, tokens }
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'tokens.json'), JSON.stringify(data, null, 1))
const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/preview-client/playground.html'), 'utf-8')
writeFileSync(join(outDir, 'index.html'), PAGE)
console.log(`playground: ${tokens.length} tokens → ${outDir}`)
