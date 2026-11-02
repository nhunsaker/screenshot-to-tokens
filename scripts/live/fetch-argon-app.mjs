#!/usr/bin/env node
// Assemble the Argon app that the live Point and say page (tier B) drives, at image build time.
// Takes the fork's public build (s2t-gh-pages branch, tokens/: relative asset URLs, so it works under /try/app/) and
// swaps in this run's tokenized stylesheet (demo/argon-run/app.css, the rewrite output the run files describe), so
// the app, tokens.json, capture.json and regions.json all come from the same run. No app build lands in this repo.
// Usage: node scripts/live/fetch-argon-app.mjs [out dir, default build/argon-app] [--src <checkout of the branch>]
import { execFileSync } from 'node:child_process'
import { cpSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdtempSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const srcAt = args.indexOf('--src')
const out = resolve(root, args.find((a, i) => !a.startsWith('--') && i !== srcAt + 1) || 'build/argon-app')
const REPO = 'https://github.com/nhunsaker/argon-dashboard-react'
const BRANCH = 's2t-gh-pages'

let src = srcAt >= 0 ? resolve(args[srcAt + 1]) : null
if (!src) {
  src = mkdtempSync(join(tmpdir(), 'argon-'))
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '-b', BRANCH, REPO, src], { stdio: 'inherit' })
}
const app = join(src, 'tokens')
if (!existsSync(join(app, 'index.html'))) throw new Error(`no tokens/index.html in ${src}`)

rmSync(out, { recursive: true, force: true })
cpSync(app, out, { recursive: true })
const cssDir = join(out, 'static/css')
for (const f of readdirSync(cssDir)) rmSync(join(cssDir, f))
// The run's stylesheet was rewritten from a root-served build (url(/static/media/...)); the fork's build is relative.
const css = readFileSync(join(root, 'demo/argon-run/app.css'), 'utf-8').replace(/url\(\/static\/media\//g, 'url(../media/')
const name = 'main.s2t.css'
writeFileSync(join(cssDir, name), css)
const indexFile = join(out, 'index.html')
const html = readFileSync(indexFile, 'utf-8').replace(/href="\.\/static\/css\/[^"]+\.css"/, `href="./static/css/${name}"`)
if (!html.includes(name)) throw new Error('index.html: stylesheet link not found')
writeFileSync(indexFile, html)
const missing = [...css.matchAll(/url\(\.\.\/media\/([^)?#]+)/g)].map((m) => m[1]).filter((f) => !existsSync(join(out, 'static/media', f)))
if (missing.length) throw new Error(`media referenced by app.css but missing from the build: ${[...new Set(missing)].slice(0, 5).join(', ')}`)
console.log(`argon app -> ${out} (${BRANCH} tokens/ + demo/argon-run/app.css)`)
