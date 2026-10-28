// Reachability: controls SAM saw (button/input/icon) that the page treats as clickable, with no Tab stop on them.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { iou } from '../../src/stages/segeval.js'
const contain = (inner, outer) => { const [x, y, w, h] = inner, [X, Y, W, H] = outer; const ix = Math.max(0, Math.min(x + w, X + W) - Math.max(x, X)), iy = Math.max(0, Math.min(y + h, Y + H) - Math.max(y, Y)); return w * h ? (ix * iy) / (w * h) : 0 }
const runs = { argon: 'out/m12-argon', lightbootstrap: 'out/darkpick/lightbootstrap', agency: 'out/darkpick/agency', 'acme-shop': 'out/darkpick/acme-shop', 'div-soup': 'out/darkpick/div-soup' }
const rows = []
for (const f of readdirSync('out/focustest/breadth').filter((x) => x.endsWith('.json'))) {
  const site = f.replace('.json', ''); const stops = JSON.parse(readFileSync('out/focustest/breadth/' + f, 'utf-8')).filter((r) => r.page)
  const run = runs[site] || `out/breadth4/${site}`
  if (!existsSync(run + '/regions.json')) { rows.push({ site, stops: stops.length, note: 'no run' }); continue }
  const regs = JSON.parse(readFileSync(run + '/regions.json', 'utf-8')), cap = JSON.parse(readFileSync(run + '/capture.json', 'utf-8'))
  const sam = regs.filter((r) => /^sam/.test(String(r.source)) && ['button', 'input', 'icon'].includes(r.label))
  const clickable = (b) => cap.elements.some((e) => e.clickable && iou(e.bbox, b) > 0.5 || (e.clickable && contain(b, e.bbox) > 0.8 && e.bbox[2] * e.bbox[3] < b[2] * b[3] * 6))
  const reached = (b) => stops.some((s) => iou(s.page, b) > 0.3 || contain(b, s.page) > 0.6)
  const unreachable = sam.filter((r) => clickable(r.bbox) && !reached(r.bbox))
  const m = stops.filter((r) => !r.skipped)
  rows.push({ site, stops: stops.length, pass: m.filter((r) => r.passes).length, weak: m.filter((r) => r.visible && !r.passes).length, none: m.filter((r) => !r.visible).length,
    samControls: sam.length, samClickable: sam.filter((r) => clickable(r.bbox)).length, unreachable: unreachable.length, examples: unreachable.slice(0, 3).map((r) => `${r.label}@${r.bbox.join(',')}`) })
}
writeFileSync('out/focustest/summary.json', JSON.stringify(rows, null, 1))
console.log('site | tab stops | focus: pass / faint / none | SAM controls (clickable) | clickable but unreachable')
for (const r of rows.sort((a, b) => (b.unreachable || 0) - (a.unreachable || 0) || (b.none || 0) - (a.none || 0))) console.log([r.site, r.stops, r.note || `${r.pass} / ${r.weak} / ${r.none}`, r.note ? '' : `${r.samControls} (${r.samClickable})`, r.note ? '' : r.unreachable].join(' | '))
