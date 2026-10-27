#!/usr/bin/env node
// L7: a short before/after clip of the hosted demo for social posts (draft; a person cuts and posts it).
// Records: the tokenized app, a proposed token change applied live (blue -> orange) with the banner, "Show original"
// toggling back, then the playground changing color.blue.500 so everything aliased to it follows.
//   node scripts/record-clip.mjs [--base https://nhunsaker.github.io/argon-dashboard-react] [--out out/l7]
import { mkdirSync, renameSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { chromium } from 'playwright'
import { parseArgs } from '../src/lib/args.js'

const a = parseArgs(process.argv.slice(2))
const base = (a.base || 'https://nhunsaker.github.io/argon-dashboard-react').replace(/\/$/, '')
const out = resolve(a.out || 'out/l7')
mkdirSync(out, { recursive: true })
const size = { width: 1280, height: 720 }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: out, size } })
const page = await ctx.newPage()
const pause = (ms) => page.waitForTimeout(ms)
try {
  await page.goto(`${base}/tokens/`, { waitUntil: 'networkidle' })
  await pause(1800)
  await page.goto(`${base}/tokens/?tokens=color-action-primary:e8711a`, { waitUntil: 'networkidle' })
  await pause(2500)
  await page.click('#sorb-preview-toggle')
  await pause(1500)
  await page.click('#sorb-preview-toggle')
  await pause(1500)
  await page.goto(`${base}/playground/`, { waitUntil: 'networkidle' })
  await pause(2000)
  await page.fill('#search', 'blue.500')
  // Bring the Month/Week toggle (it uses the primary color) into view inside the app frame.
  const app = page.frame({ url: /\/tokens\// }) || page.frames()[1]
  if (app) await app.evaluate(() => { const el = [...document.querySelectorAll('a,button')].find((x) => x.textContent.trim().startsWith('Month')); if (el) el.scrollIntoView({ block: 'center' }) })
  await pause(1000)
  // Sweep the primitive through a few colors; every alias follows live in the app.
  for (const c of ['#2dce89', '#f5365c', '#8965e0', '#5e72e4']) {
    await page.evaluate((v) => {
      const input = document.querySelector('[data-var="color-blue-500"] input[type=color]')
      if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })) }
    }, c)
    await pause(1200)
  }
} finally {
  await ctx.close()
  await browser.close()
}
const webm = readdirSync(out).filter((f) => f.endsWith('.webm')).map((f) => join(out, f)).pop()
if (webm) renameSync(webm, join(out, 'clip.webm'))
console.log(`clip → ${join(out, 'clip.webm')}`)
