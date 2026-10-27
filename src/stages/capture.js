// Capture: full-page screenshot + computed styles for every visible element.
// The walker runs IN THE PAGE (passed to page.evaluate), so it must be self-contained.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { STYLE_PROPS } from '../lib/props.js'

// Canvas content sometimes went missing from full-page screenshots (headless GPU canvas race; seen on the
// div-soup chart, 2026-10-26), which made verify flaky. Draw 2D canvases on the CPU and let two frames paint
// before every screenshot.
export const LAUNCH = { args: ['--disable-accelerated-2d-canvas', '--disable-gpu'] }
async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  // JS-driven animations (e.g. Chart.js draw-in on the Argon dashboard) ignore the CSS animation kill switch and
  // made verify flaky (34 px "changed" in a chart line). Wait until two consecutive frames are identical, up to
  // about 3 s; if the page never settles, carry on and let verify report what it sees.
  let prev = await page.screenshot({ fullPage: true })
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250)
    const next = await page.screenshot({ fullPage: true })
    if (next.equals(prev)) return
    prev = next
  }
}

// Lazy-loaded images (Jekyll Chirpy and friends) load only when scrolled into view and fade in, so two screenshots
// of the same page could differ (L2 breadth run: Andra-sun's post images were half-faded in one shot, 44,885 px).
// Load every image eagerly, scroll the page once to wake scroll-driven loaders, and wait for the images to decode.
async function loadImages(page) {
  await page.evaluate(async () => {
    for (const img of Array.from(document.images)) img.loading = 'eager'
    const step = Math.max(200, window.innerHeight)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 50))
    }
    window.scrollTo(0, 0)
    // Web fonts swapping in mid-shot moved a few glyph pixels (L2/L6: devbattery 78 px in one run, 0 in the next).
    if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))])
    const pending = Array.from(document.images).filter((img) => !img.complete).map((img) => new Promise((r) => { img.onload = img.onerror = r }))
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 3000))])
  })
}

// Some pages set a Content-Security-Policy that blocks injected <style> tags (L2: DiogoRibeiro7); we inject the
// animation kill switch and, in verify, tokens.css, so bypass CSP in our own browser.
const PAGE = { deviceScaleFactor: 1, bypassCSP: true }

// Randomized layouts (zeikar.github.io throws its tag pile down differently on every load) made two shots of the
// same page differ. Every page we screenshot gets the same seeded Math.random, so "random" comes out identical.
const SEEDED_RANDOM = `(() => { let s = 0x2f6b9a1d; Math.random = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 } })()`
async function newPage(browser, viewport) {
  const page = await browser.newPage({ ...PAGE, viewport })
  await page.addInitScript(SEEDED_RANDOM)
  return page
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
      // Full class list (capped) so component profiles can map CSS selectors back to detected components.
      classes: Array.prototype.slice.call(el.classList || [], 0, 8),
      text: ownText(el),
      // Does it behave clickable (itself or through a clickable ancestor; cursor is inherited)? Lets the hybrid
      // tell a status pill (looks like a button, does nothing) from a real button.
      clickable: cs.cursor === 'pointer' || !!el.closest('a[href],button,input,select,textarea,label,summary,[onclick],[role=button],[role=link],[role=tab],[tabindex]:not([tabindex="-1"])'),
      bbox: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)],
      styles,
    })
  }
  return out
}

/**
 * In-page text walker for the contrast check (L12). Self-contained like walkPage. One entry per element that owns
 * visible text: the boxes of its own text runs (Range rects, page px; tighter than the element box, so a long
 * gradient behind a short label is measured where the letters are), its painted text color, the product of its and
 * its ancestors' opacity, and whether it is disabled (inactive controls and their labels are exempt from SC 1.4.3).
 * Walks open shadow roots too, so text inside web components is not skipped.
 */
function walkTexts(maxElements, keep) {
  const out = []
  const els = []
  const pathOf = (el) => {
    const parts = []
    let cur = el
    for (let d = 0; cur && cur.nodeType === 1 && d < 4; d++) {
      let p = cur.tagName.toLowerCase()
      const cls = (cur.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0]
      if (cls) p += '.' + cls
      parts.unshift(p)
      cur = cur.parentElement || (cur.parentNode && cur.parentNode.host) || null
    }
    return parts.join('>')
  }
  const isDisabled = (el) => {
    if (el.closest('[aria-disabled="true"], fieldset:disabled') || (el.matches && el.matches(':disabled'))) return true
    const lab = el.closest('label')
    if (lab && lab.control && (lab.control.disabled || lab.control.closest('fieldset:disabled, [aria-disabled="true"]'))) return true
    // Text that names a disabled widget through aria-labelledby.
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (!n.id) continue
      const users = document.querySelectorAll('[aria-labelledby~="' + CSS.escape(n.id) + '"]')
      for (const u of users) if (u.matches(':disabled, [aria-disabled="true"]') || u.closest('[aria-disabled="true"], fieldset:disabled')) return true
    }
    return false
  }
  const visit = (el, opacity) => {
    if (out.length >= maxElements) return
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'svg') return
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return
    const op = opacity * (Number(cs.opacity) || 0)
    if (op <= 0) return
    const kids = el.shadowRoot ? [el.shadowRoot, el] : [el]
    let text = ''
    const rects = []
    for (const root of kids) {
      for (const n of root.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue
        text += n.textContent
        const r = document.createRange()
        r.selectNodeContents(n)
        for (const b of r.getClientRects()) if (b.width >= 1 && b.height >= 1 && rects.length < 16) rects.push([b.left + scrollX, b.top + scrollY, b.width, b.height])
      }
    }
    text = text.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (text && rects.length && cs.visibility !== 'hidden') {
      const r = el.getBoundingClientRect()
      const fill = cs.getPropertyValue('-webkit-text-fill-color')
      out.push({
        path: pathOf(el), tag, text,
        bbox: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)],
        rects: rects.map((b) => b.map((v) => Math.round(v * 10) / 10)),
        color: fill && fill !== cs.color ? fill : cs.color,
        opacity: Math.round(op * 1000) / 1000,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        disabled: isDisabled(el),
      })
      els.push(el)
    }
    for (const c of el.children) visit(c, op)
    if (el.shadowRoot) for (const c of el.shadowRoot.children) visit(c, op)
  }
  if (document.body) visit(document.body, 1)
  // Benchmarks map another tool's findings (axe nodes) back to these samples by element.
  if (keep) window.__s2tTextEls = els
  return out
}

/** Text samples (walkTexts) from a loaded page. keep: leave the elements on window.__s2tTextEls (benchmarks). */
export function collectTexts(page, maxElements = 3000, keep = false) {
  return page.evaluate(([fn, max, k]) => (new Function('return ' + fn)())(max, k), [walkTexts.toString(), maxElements, keep])
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
    const page = await newPage(browser, o.viewport)
    await page.goto(o.url, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
    const screenshot = 'screenshot.png'
    await loadImages(page)
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

/**
 * Screenshot only (verify stage uses this for the "after" image). With o.texts, also returns the page's text samples
 * (walkTexts) read from the same render, for the contrast check.
 * @returns {Promise<Array<import('../types.js').TextSample>|undefined>}
 */
export async function screenshotUrl(url, path, viewport, extraCss = '', o = {}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(LAUNCH)
  try {
    const page = await openSettled(browser, url, viewport, extraCss)
    await page.screenshot({ path, fullPage: true })
    if (o.texts) return await collectTexts(page)
  } finally {
    await browser.close()
  }
}

/** A page loaded the way every verify screenshot is taken (seeded random, animations off, images loaded, settled). Benchmarks reuse it. */
export async function openSettled(browser, url, viewport, extraCss = '') {
  const page = await newPage(browser, viewport)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
  if (extraCss) await page.addStyleTag({ content: extraCss })
  await loadImages(page)
  await settle(page)
  return page
}
