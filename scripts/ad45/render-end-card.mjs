// Renders scripts/ad45/end-card.html to out/ad45/work/end-{16x9,1x1,9x16}.png with Playwright.
import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..')
const sizes = { '16x9': [1920, 1080], '1x1': [1080, 1080], '9x16': [1080, 1920] }
const b = await chromium.launch()
for (const [k, [w, h]] of Object.entries(sizes)) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto('file://' + resolve(here, 'end-card.html')); await p.waitForTimeout(300)
  await p.screenshot({ path: resolve(root, `out/ad45/work/end-${k}.png`) }); await p.close()
}
await b.close()
