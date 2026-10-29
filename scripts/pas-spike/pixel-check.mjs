// Spike check for the coder fix: the original build vs the re-rewritten site (fallbacks only, and with tokens.css
// injected) must render the same pixels. Usage: node scripts/pas-spike/pixel-check.mjs <buildDir> <runCopy> <waitSelector>
import { readFileSync } from 'fs'
import { join } from 'path'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { serveDir } from '../../src/lib/serve.js'

const [build, run, sel] = process.argv.slice(2)
const shot = async (dir, css) => {
  const srv = await serveDir(dir)
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  await p.goto(srv.url, { waitUntil: 'load' })
  await p.waitForSelector(sel)
  if (css) await p.addStyleTag({ content: css })
  await p.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
  await p.waitForTimeout(1500)
  const png = PNG.sync.read(await p.screenshot({ fullPage: true }))
  await b.close(); await srv.close()
  return png
}
const diff = (a, b) => {
  if (a.width !== b.width || a.height !== b.height) return `size ${a.width}x${a.height} vs ${b.width}x${b.height}`
  return pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1, includeAA: false })
}
const orig = await shot(build)
const site = await shot(join(run, 'site'))
const withTokens = await shot(join(run, 'site'), readFileSync(join(run, 'tokens.css'), 'utf-8'))
const again = await shot(build)
console.log(`${run}: original vs original (noise) ${diff(orig, again)} px; vs rewritten (fallbacks) ${diff(orig, site)} px; vs rewritten + tokens.css ${diff(orig, withTokens)} px`)
