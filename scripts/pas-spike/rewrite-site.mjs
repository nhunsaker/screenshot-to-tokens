// Spike helper: re-run the deterministic coder (with the last-declaration / !important fix) on a COPIED run, and lay
// the rewritten CSS over its site/ folder. Usage: node scripts/pas-spike/rewrite-site.mjs <runCopy> <cssDir>
// Never point this at a canonical run under out/; it rewrites rewrite.json, rewrite.diff, rewritten/ and site/.
import { readFileSync, writeFileSync, cpSync, readdirSync } from 'fs'
import { join } from 'path'
import deterministicCoder from '../../src/providers/coder/deterministic.js'

const [runDir, cssDir] = process.argv.slice(2)
if (!runDir || !cssDir || !/pas-spike/.test(runDir)) throw new Error('usage: rewrite-site.mjs out/pas-spike/<copy> <build>/static/css')
const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
const before = rd('rewrite').edits.length
const r = await deterministicCoder().rewrite({ targetDir: cssDir, tokens: rd('tokens'), clusters: rd('clusters'), components: rd('components'), write: true, runDir })
writeFileSync(join(runDir, 'rewrite.json'), JSON.stringify(r, null, 2))
for (const f of readdirSync(r.outDir)) if (f.endsWith('.css')) cpSync(join(r.outDir, f), join(runDir, 'site/static/css', f))
const byToken = {}
for (const e of r.edits) byToken[e.token] = (byToken[e.token] || 0) + 1
console.log(`edits ${before} -> ${r.edits.length}; files ${r.files.join(', ')}; color.text.muted uses: ${byToken['color.text.muted'] || 0}`)
