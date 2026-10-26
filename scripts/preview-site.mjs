#!/usr/bin/env node
// Live Sorb preview of a finished run, for the demo recording:
//   node scripts/preview-site.mjs out/app-argon [--port 4600] [--bridge http://127.0.0.1:7791]
// Copies the run's verified site (or its rewritten copy), adds tokens.css and the no-build Sorb preview client,
// and serves it. Then, with a bridge running (`npx -p @sorb/juice sorb dev`), propose a change with
//   node src/cli.js preview --token color.action.primary --value '#e8711a' --bridge <bridge>
// and open the printed URL with ?preview=<id>. Nothing here executes the app's own build tooling.
import { cpSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { serveDir } from '../src/lib/serve.js'
import { parseArgs } from '../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const runDir = resolve(a._[0] || '')
if (!a._[0] || !existsSync(join(runDir, 'tokens.css'))) {
  console.error('usage: node scripts/preview-site.mjs <run dir with tokens.css> [--port 4600] [--bridge http://127.0.0.1:7791]')
  process.exit(2)
}
const bridge = a.bridge || 'http://127.0.0.1:7791'
const src = existsSync(join(runDir, 'site')) ? join(runDir, 'site') : join(runDir, 'rewritten')
const out = join(runDir, 'preview-site')
rmSync(out, { recursive: true, force: true })
cpSync(src, out, { recursive: true })
cpSync(join(runDir, 'tokens.css'), join(out, 'tokens.css'))
cpSync(resolve('src/preview-client/sorb-preview.js'), join(out, 'sorb-preview.js'))
const indexPath = join(out, 'index.html')
if (!existsSync(indexPath)) {
  console.error(`no index.html in ${src}; preview-site needs a servable site`)
  process.exit(2)
}
let html = readFileSync(indexPath, 'utf-8')
html = html.replace('</head>', '<link rel="stylesheet" href="/tokens.css"></head>')
html = html.replace('</body>', `<script src="/sorb-preview.js" data-bridge="${bridge}"></script></body>`)
writeFileSync(indexPath, html)
const s = await serveDir(out, Number(a.port || 4600))
console.log(`preview site: ${s.url}  (add ?preview=<id> from \`s2t preview\`; bridge ${bridge}; Ctrl+C to stop)`)
