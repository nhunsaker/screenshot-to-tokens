// F7: SAM vs DOM Split-Screen Scoreboard. A self-contained HTML page for the hackathon video: on
// div-soup (a page built with no semantic markup — see fixtures/div-soup/README.md), the DOM-only
// segmenter finds 0 of the 8 hand-labeled buttons while SAM 3.1 finds 8 of 8, scored at IoU 0.5
// against fixtures/div-soup/regions.truth.json via scoreSegmentation/resolveOracle
// (src/stages/segeval.js). Below the hero: a per-label recall/precision table across the DOM,
// SAM-only and hybrid runs, then two real-app rows (scored honestly against the DOM oracle, which
// overstates quality since it's the same page — see the method note).
//
// "Page structure (DOM)" is this project's own offline segmenter, not a named competing product —
// it's the floor any pixel-based segmenter has to clear on markup-free pages.
import { readFileSync, writeFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { iou, scoreSegmentation, resolveOracle, clipToScreen, goNoGo } from './segeval.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])
const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`)

/** Milliseconds between each box's reveal (and the matching counter tick). Deterministic — not random. */
export const STEP_MS = 220

/**
 * Greedy one-to-one IoU matching (same rule scoreSegmentation uses internally, duplicated here
 * since segeval.js doesn't export index-level matches) — returns the set of GOLD indices matched,
 * so the hero view can mark each hand-labeled box found/missed rather than just a count.
 * @param {import('../types.js').Region[]} pred
 * @param {import('../types.js').Region[]} gold
 */
export function matchedGoldIndices(pred, gold, thr = 0.5) {
  const pairs = []
  for (let i = 0; i < pred.length; i++) for (let j = 0; j < gold.length; j++) {
    const v = iou(pred[i].bbox, gold[j].bbox)
    if (v >= thr) pairs.push([v, i, j])
  }
  pairs.sort((a, b) => b[0] - a[0])
  const usedP = new Set(), usedG = new Set()
  for (const [v, i, j] of pairs) {
    if (usedP.has(i) || usedG.has(j)) continue
    usedP.add(i); usedG.add(j)
  }
  return usedG
}

// ---------------------------------------------------------------------------
// section builders
// ---------------------------------------------------------------------------

function heroPanel({ title, subtitle, screenshot, W, H, boxes, matchedIdx }) {
  const matched = matchedIdx.size, total = boxes.length
  const boxesHtml = boxes.map((b, i) => {
    const [x, y, w, h] = b.bbox
    const left = (x / W) * 100, top = (y / H) * 100, ww = (w / W) * 100, hh = (h / H) * 100
    const found = matchedIdx.has(i)
    const style = `left:${left}%;top:${top}%;width:${ww}%;height:${hh}%;animation-delay:${i * STEP_MS}ms`
    return `<div class="box ${found ? 'found' : 'missed'}" data-step="${i}" data-found="${found ? 1 : 0}" style="${style}"></div>`
  }).join('')
  return `<div class="panel">
    <h3>${escapeHtml(title)}</h3>
    <p class="muted">${escapeHtml(subtitle)}</p>
    <div class="shot-wrap" style="aspect-ratio:${W} / ${H}">
      ${screenshot ? `<img src="${screenshot}" alt="${escapeHtml(title)} screenshot">` : '<div class="placeholder">no screenshot</div>'}
      <div class="overlay">${boxesHtml}</div>
    </div>
    <div class="counter" data-counter><span class="n" data-count>${matched}</span><span class="slash">/</span><span class="d">${total}</span></div>
  </div>`
}

function compareTable(compare) {
  if (!compare.length) return ''
  const labels = [...new Set(compare.flatMap((r) => Object.keys(r.score.perLabel)))].sort()
  const head1 = `<tr><th rowspan="2">label</th>${compare.map((r) => `<th colspan="2">${escapeHtml(r.label)}</th>`).join('')}</tr>`
  const head2 = `<tr>${compare.map(() => '<th>recall</th><th>precision</th>').join('')}</tr>`
  const rows = labels.map((l) => {
    const cells = compare.map((r) => {
      const s = r.score.perLabel[l]
      if (!s || !s.oracle) return '<td class="muted">-</td><td class="muted">-</td>'
      return `<td>${pct(s.recall)} <span class="muted">(${s.matched}/${s.oracle})</span></td><td>${pct(s.precision)}</td>`
    }).join('')
    return `<tr><td>${escapeHtml(l)}</td>${cells}</tr>`
  }).join('')
  return `<div class="table-wrap"><table><thead>${head1}${head2}</thead><tbody>${rows}</tbody></table></div>`
}

function realAppRows(real) {
  if (!real.length) return ''
  const rows = real.map((r) => {
    const a = r.score.anyLabel
    return `<tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${pct(a.recall)} <span class="muted">(${a.matched} matched)</span></td>
      <td>${pct(a.precision)}</td>
      <td class="muted">vs the DOM oracle: same page, so this overstates quality (see method note)</td>
    </tr>`
  }).join('')
  return `<section class="card">
    <h2>Real apps</h2>
    <p class="muted">Not the fixture: two of the demo's real sites, any-label recall/precision (all regions, not just buttons).</p>
    <div class="table-wrap"><table>
      <thead><tr><th>app</th><th>recall</th><th>precision</th><th>oracle</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`
}

// L1: real sites scored against first-screen truth labeled from the screenshot (fixtures/l1/*.truth.json), so unlike the
// DOM-oracle rows above this doesn't flatter the DOM segmenter. One row per site, one column group per segmenter.
const SEGMENTERS = [['dom', 'DOM'], ['sam', 'SAM 3.1'], ['hybrid', 'Hybrid']]

function realSiteTable(sites) {
  if (!sites.length) return ''
  const names = [...new Set(sites.map((r) => r.site))]
  const cell = (r) => {
    if (!r) return '<td class="muted">-</td><td class="muted">-</td><td class="muted">-</td>'
    const a = r.score.anyLabel, b = r.score.perLabel.button
    const go = r.verdict.go ? '<b>GO</b>' : `<span class="muted" title="${escapeHtml(r.verdict.reasons.join('; '))}">no-go</span>`
    return `<td>${pct(a.recall)} <span class="muted">/ ${pct(a.precision)}</span></td><td>${b && b.oracle ? `${b.matched}/${b.oracle}` : '-'}</td><td>${go}</td>`
  }
  const rows = names.map((n) => `<tr><td>${escapeHtml(n)}</td>${SEGMENTERS.map(([k]) => cell(sites.find((r) => r.site === n && r.segmenter === k))).join('')}</tr>`).join('')
  const head1 = `<tr><th rowspan="2">site</th>${SEGMENTERS.map(([, l]) => `<th colspan="3">${l}</th>`).join('')}</tr>`
  const head2 = `<tr>${SEGMENTERS.map(() => '<th>recall / precision</th><th>buttons</th><th>gate</th>').join('')}</tr>`
  return `<section class="card">
    <h2>Real sites, labeled from the screenshot</h2>
    <p class="muted">First screen (1440&times;900) of three public sites, labeled box by box from the screenshot (not from any segmenter output; truth files in fixtures/l1, open to review). Same capture for all three segmenters; any-label recall / precision at IoU 0.5. Hover a no-go for the reason.</p>
    <div class="table-wrap"><table><thead>${head1}${head2}</thead><tbody>${rows}</tbody></table></div>
  </section>`
}

function methodNote(m) {
  return `<section class="card method">
    <h2>Method</h2>
    <ul>
      <li>Fixture: <code>${escapeHtml(m.fixture)}</code>; hand-labeled ground truth in <code>fixtures/div-soup/regions.truth.json</code> (not the DOM, which this fixture is built to defeat).</li>
      <li>SAM prompts: ${(m.prompts || []).map((p) => `<code>${escapeHtml(p)}</code>`).join(', ') || '-'}.</li>
      <li>Model: <code>${escapeHtml(m.model)}</code> via the Meta Model API.</li>
      <li>Match rule: greedy one-to-one, IoU &ge; ${escapeHtml(m.iou)}, same-label only.</li>
      <li>Run date: ${escapeHtml(m.date)}.</li>
    </ul>
    <p class="attribution">SAM 3.1 by Meta, SAM License.</p>
    <p class="muted">"Page structure (DOM)" is this project's own offline segmenter (src/providers/segment/mock.js), used as the baseline any pixel-based segmenter has to clear on a page with no semantic markup. It is not a named competing product.</p>
  </section>`
}

const SCRIPT = `<script>
(function () {
  var STEP_MS = ${STEP_MS};
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function play() {
    qsa('.panel').forEach(function (panel) {
      var countEl = panel.querySelector('[data-count]');
      var boxes = qsa('.box', panel);
      if (!countEl) return;
      var finalVal = boxes.filter(function (b) { return b.getAttribute('data-found') === '1'; }).length;
      if (reducedMotion()) { countEl.textContent = String(finalVal); return; }
      countEl.textContent = '0';
      var running = 0;
      boxes.forEach(function (b) {
        var step = parseInt(b.getAttribute('data-step'), 10) || 0;
        var found = b.getAttribute('data-found') === '1';
        if (!found) return;
        setTimeout(function () { running += 1; countEl.textContent = String(running); }, step * STEP_MS + 260);
      });
    });
  }
  function replay() {
    qsa('.box').forEach(function (b) {
      b.style.animation = 'none';
      void b.offsetWidth; // force reflow so the animation restarts from the same deterministic delay
      b.style.animation = '';
    });
    play();
  }
  play();
  var btn = document.getElementById('replay');
  if (btn) btn.addEventListener('click', replay);
})();
</script>`

const CSS = `
:root {
  --bg: #f7f7f7; --surface: #ffffff; --fg: #4a4a4a; --border: #d1d1d1;
  --accent: #f26722; --secondary: #8b7e66; --muted: #8b7e66;
  --good: #15803d; --bad: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1c; --surface: #262626; --fg: #f2f2f2; --border: #3a3a3a;
    --accent: #f26722; --secondary: #c9bda3; --muted: #a99a84;
    --good: #4ade80; --bad: #f87171;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 16px 16px 60px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
.muted { color: var(--muted); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.card h2 { margin-top: 0; }
h1 { color: var(--accent); margin: 0 0 4px; }
.headline { font-size: 1.1em; margin: 0 0 16px; }
.headline b { color: var(--accent); }
.hero { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 8px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; text-align: center; }
.panel h3 { margin: 0 0 2px; }
.shot-wrap { position: relative; width: 100%; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: var(--bg); margin: 10px 0; }
.shot-wrap img { display: block; width: 100%; height: 100%; }
.overlay { position: absolute; inset: 0; }
.placeholder { display: flex; align-items: center; justify-content: center; height: 240px; color: var(--muted); }
.box { position: absolute; border: 3px solid var(--bad); border-radius: 4px; opacity: 0; animation: reveal 0.25s ease-out forwards; box-sizing: border-box; }
.box.found { border-color: var(--good); background: rgba(21, 128, 61, 0.14); }
.box.missed { border-style: dashed; background: transparent; }
@keyframes reveal { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .box { animation: none; opacity: 1; } }
.counter { font-size: 2.6em; font-weight: 700; }
.counter .slash { color: var(--muted); margin: 0 4px; }
.counter .d { color: var(--muted); }
.replay-row { text-align: center; margin: 0 0 20px; }
#replay { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-weight: 600; cursor: pointer; font-size: 0.9em; }
#replay:hover { opacity: 0.9; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
.method ul { margin: 0 0 10px; padding-left: 20px; }
.attribution { font-weight: 600; }
@media (max-width: 720px) {
  .hero { grid-template-columns: 1fr; }
  .wrap { padding: 10px 10px 60px; }
}
`

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Pure: build the full scoreboard.html string from an already-loaded data bag.
 * @param {{
 *   screenshot?: string|null,
 *   viewport?: {width?:number, height?:number},
 *   goldButtons?: import('../types.js').Region[],
 *   domMatchedIdx?: Set<number>,
 *   samMatchedIdx?: Set<number>,
 *   compare?: Array<{label:string, score: ReturnType<typeof scoreSegmentation>}>,
 *   real?: Array<{label:string, score: ReturnType<typeof scoreSegmentation>}>,
 *   sites?: Array<{site:string, segmenter:'dom'|'sam'|'hybrid', score: ReturnType<typeof scoreSegmentation>, verdict: {go:boolean, reasons:string[]}}>,
 *   method?: {fixture?:string, prompts?:string[], model?:string, iou?:number, date?:string},
 * }} data
 * @returns {string}
 */
export function buildScoreboardHtml(data = {}) {
  const {
    screenshot = null, viewport = {}, goldButtons = [],
    domMatchedIdx = new Set(), samMatchedIdx = new Set(),
    compare = [], real = [], sites = [], method = {},
  } = data
  const W = viewport.width || 1440
  const H = viewport.height || 900
  const total = goldButtons.length
  const domN = domMatchedIdx.size
  const samN = samMatchedIdx.size

  const hero = `<div class="hero">
    ${heroPanel({ title: 'Page structure (DOM)', subtitle: 'Boxes from tags, roles and computed styles. No vision model.', screenshot, W, H, boxes: goldButtons, matchedIdx: domMatchedIdx })}
    ${heroPanel({ title: 'SAM 3.1', subtitle: 'Boxes from pixels alone, prompted with "button". Same screenshot, no markup needed.', screenshot, W, H, boxes: goldButtons, matchedIdx: samMatchedIdx })}
  </div>
  <p class="replay-row"><button type="button" id="replay">Replay reveal</button></p>`

  const body = `
    <h1>Screenshot &rarr; Tokens: SAM vs DOM</h1>
    <p class="headline">On a page with no semantic markup, page structure (DOM) finds <b>${domN} of ${total}</b> buttons. SAM 3.1 finds <b>${samN} of ${total}</b>.</p>
    ${hero}
    <section class="card">
      <h2>All runs, per label</h2>
      <p class="muted">Recall/precision at IoU 0.5 against the hand-labeled truth (fixtures/div-soup/regions.truth.json).</p>
      ${compareTable(compare)}
    </section>
    ${realSiteTable(sites)}
    ${realAppRows(real)}
    ${methodNote(method)}
  `

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SAM vs DOM scoreboard</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
${SCRIPT}
</body>
</html>
`
}

/**
 * Read the given runs, score each (pure, via scoreSegmentation/resolveOracle), and write the
 * scoreboard page. The hero split-screen needs one `role: 'dom'` and one `role: 'sam'` run scored
 * against the same truth file; `role: 'hybrid'` runs join the per-label table; `role: 'real'` runs
 * (no `truth`) are always scored against the DOM oracle and shown separately, honestly labeled; `role: 'site'`
 * runs are real sites scored against hand-labeled first-screen truth (`maxY` clips predictions to that screen).
 * @param {{
 *   runs: Array<{role: 'dom'|'sam'|'hybrid'|'real'|'site', label: string, runDir: string, truth?: string, site?: string, segmenter?: string, maxY?: number}>,
 *   out: string,
 *   images?: 'embed'|'link'|'auto',
 * }} o
 * @returns {string} the path written
 */
export function writeScoreboard({ runs, out, images } = {}) {
  if (!runs || !runs.length) throw new Error('writeScoreboard needs at least one run')
  const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf-8'))

  const scoreRun = (r) => {
    const capture = readJson(r.runDir, 'capture')
    const all = readJson(r.runDir, 'regions')
    const regions = r.maxY ? clipToScreen(all, r.maxY) : all
    const truth = r.truth ? JSON.parse(readFileSync(r.truth, 'utf-8')) : null
    const oracle = resolveOracle(capture, truth)
    const score = scoreSegmentation(regions, oracle, { iou: 0.5 })
    return { ...r, capture, regions, oracle, score }
  }

  const compareRuns = runs.filter((r) => r.role === 'dom' || r.role === 'sam' || r.role === 'hybrid').map(scoreRun)
  const realRuns = runs.filter((r) => r.role === 'real').map(scoreRun)
  const siteRuns = runs.filter((r) => r.role === 'site').map(scoreRun).map((r) => ({ ...r, verdict: goNoGo(r.score) }))

  const domScored = compareRuns.find((r) => r.role === 'dom')
  const samScored = compareRuns.find((r) => r.role === 'sam')
  if (!domScored || !samScored) throw new Error('writeScoreboard needs a dom run and a sam run for the hero split-screen')

  const goldButtons = domScored.oracle.filter((r) => r.label === 'button')
  const domPredButtons = domScored.regions.filter((r) => r.label === 'button')
  const samPredButtons = samScored.regions.filter((r) => r.label === 'button')
  const domMatchedIdx = matchedGoldIndices(domPredButtons, goldButtons)
  const samMatchedIdx = matchedGoldIndices(samPredButtons, goldButtons)

  // Screenshot: embed as a data URI unless it's large, same convention as report.js (S2T_REPORT_IMAGES).
  const mode = images || process.env.S2T_REPORT_IMAGES || 'auto'
  const shotRel = domScored.capture && domScored.capture.screenshot
  const shotPath = shotRel ? join(domScored.runDir, shotRel) : null
  let shotSize = 0
  if (shotPath) { try { shotSize = statSync(shotPath).size } catch (e) { shotSize = 0 } }
  const embed = !!shotPath && (mode === 'embed' || (mode === 'auto' && shotSize * 4 / 3 < 8 * 1024 * 1024))
  const screenshot = !shotPath ? null
    : embed ? 'data:image/png;base64,' + readFileSync(shotPath).toString('base64')
    : existsSync(shotPath) ? encodeURI(shotPath) : null

  const html = buildScoreboardHtml({
    screenshot,
    viewport: domScored.capture.viewport || { width: 1440, height: 900 },
    goldButtons,
    domMatchedIdx,
    samMatchedIdx,
    compare: compareRuns,
    real: realRuns,
    sites: siteRuns,
    method: {
      fixture: 'div-soup',
      prompts: ['button', 'search bar', 'icon'],
      model: 'sam-3.1',
      iou: 0.5,
      // The SAM run is the measurement being reported, so date the method note by it.
      date: ((samScored && samScored.capture && samScored.capture.capturedAt) || (domScored.capture && domScored.capture.capturedAt) || new Date().toISOString()).slice(0, 10),
    },
  })
  writeFileSync(out, html)
  return out
}
