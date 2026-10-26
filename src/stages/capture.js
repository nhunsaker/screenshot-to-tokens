// Capture: full-page screenshot + computed styles for every visible element.
// The walker runs IN THE PAGE (passed to page.evaluate), so it must be self-contained.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { STYLE_PROPS } from '../lib/props.js'

// Canvas content sometimes went missing from full-page screenshots (headless GPU canvas race; seen on the
// div-soup chart, 2026-10-26), which made verify flaky. Draw 2D canvases on the CPU and let two frames paint
// before every screenshot.
const LAUNCH = { args: ['--disable-accelerated-2d-canvas', '--disable-gpu'] }
async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** In-page walker. Self-contained: no closures over module scope. */
function walkPage(props, maxElements) {
  const out = []
  const implicitRole = (el) => {
    const t = el.tagName.toLowerCase()
    if (t === 'button') return 'button'
    if (t === 'a' && el.hasAttribute('href')) return 'link'
    if (t === 'input' || t === 'textarea' || t === 'select') return 'textbox'
    if (t === 'nav') return 'navigation'
    if (t === 'header') return 'banner'
    if (t === 'footer') return 'contentinfo'
    if (t === 'img' || t === 'svg') return 'img'
    if (/^h[1-6]$/.test(t)) return 'heading'
    return null
  }
  const pathOf = (el) => {
    const parts = []
    let cur = el
    for (let d = 0; cur && cur.nodeType === 1 && d < 4; d++) {
      let p = cur.tagName.toLowerCase()
      const cls = (cur.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0]
      if (cls) p += '.' + cls
      parts.unshift(p)
      cur = cur.parentElement
    }
    return parts.join('>')
  }
  const ownText = (el) => {
    let s = ''
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent
    return s.trim().replace(/\s+/g, ' ').slice(0, 40)
  }
  const all = document.body ? document.body.querySelectorAll('*') : []
  for (const el of all) {
    if (out.length >= maxElements) break
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'noscript') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    const styles = {}
    for (const p of props) styles[p] = cs.getPropertyValue(p)
    // Border color only matters when there is a border.
    // Each side's border color only counts when that side actually has a border.
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (parseFloat(cs.getPropertyValue('border-' + side + '-width')) === 0 || cs.getPropertyValue('border-' + side + '-style') === 'none') delete styles['border-' + side + '-color']
    }
    if (cs.outlineStyle === 'none') delete styles['outline-color']
    // fill/stroke only mean something on SVG shapes; HTML elements report a default black fill.
    const isShape = el instanceof SVGElement && !(el instanceof SVGSVGElement)
    if (!isShape || cs.fill === 'none') delete styles['fill']
    if (!isShape || cs.stroke === 'none') delete styles['stroke']
    out.push({
      i: out.length,
      tag,
      path: pathOf(el),
      role: el.getAttribute('role') || implicitRole(el),
      text: ownText(el),
      bbox: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)],
      styles,
    })
  }
  return out
}

/**
 * @param {{url:string, runDir:string, viewport:{width:number,height:number}, maxElements?:number}} o
 * @returns {Promise<import('../types.js').Capture>}
 */
export async function runCapture(o) {
  const { chromium } = await import('playwright')
  mkdirSync(o.runDir, { recursive: true })
  const browser = await chromium.launch(LAUNCH)
  try {
    const page = await browser.newPage({ viewport: o.viewport, deviceScaleFactor: 1 })
    await page.goto(o.url, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
    const screenshot = 'screenshot.png'
    await settle(page)
    await page.screenshot({ path: join(o.runDir, screenshot), fullPage: true })
    const elements = await page.evaluate(([props, max]) => {
      // eslint-disable-next-line no-new-func
      return (new Function('return ' + props.fn)())(props.list, max)
    }, [{ fn: walkPage.toString(), list: Object.keys(STYLE_PROPS) }, o.maxElements || 3000])
    /** @type {import('../types.js').Capture} */
    const capture = { url: o.url, viewport: o.viewport, screenshot, elements, capturedAt: new Date().toISOString() }
    writeFileSync(join(o.runDir, 'capture.json'), JSON.stringify(capture, null, 2))
    return capture
  } finally {
    await browser.close()
  }
}

/** Screenshot only (verify stage uses this for the "after" image). */
export async function screenshotUrl(url, path, viewport, extraCss = '') {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(LAUNCH)
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
    if (extraCss) await page.addStyleTag({ content: extraCss })
    await settle(page)
    await page.screenshot({ path, fullPage: true })
  } finally {
    await browser.close()
  }
}
