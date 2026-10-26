// Report: capture/regions/clusters/tokens/rewrite/verify → one self-contained report.html.
// Every section renders gracefully when its JSON is missing (a stage that hasn't run yet),
// because providers are mock/offline stand-ins until API access lands.
import { readFileSync, writeFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { cssVarOf } from '../lib/props.js'

// ---------------------------------------------------------------------------
// small, dependency-free helpers
// ---------------------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Escape text for safe interpolation into HTML (and into "" attribute values). */
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])

/** Characters allowed in a value we are willing to drop straight into a style="" attribute.
 * Excludes quotes/angle-brackets/semicolons/braces, so it can never break out of the attribute
 * or the stylesheet even though it is untouched data from a captured page. */
const CSS_SAFE = /^[-+.,%#()/0-9a-zA-Z ]{0,80}$/
const safeCss = (v) => (v != null && CSS_SAFE.test(String(v)) ? String(v) : null)

const isMockId = (id) => !!id && /mock|deterministic/i.test(id)

const REVIEW_BADGE_CLASS = { accepted: 'badge-pass', renamed: 'badge-info', rejected: 'badge-fail' }

const topEntries = (obj, n = 3) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n)

/** Read + JSON.parse a file, or null if it does not exist / is not valid JSON. */
const readJsonSafe = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

/** Read a PNG and inline it as a data: URI, or null if it can't be read. */
const readPngDataUri = (p) => {
  try { return 'data:image/png;base64,' + readFileSync(p).toString('base64') } catch { return null }
}

// ---------------------------------------------------------------------------
// label colors (region overlays) — deterministic, no dependency on brand hex so the
// hash fallback for unknown labels stays in the same hsl() color space.
// ---------------------------------------------------------------------------

const LABEL_HUES = { button: 18, link: 208, input: 208, nav: 142, card: 32, badge: 35, header: 0, footer: 0, text: 0, image: 32, other: 32 }
const hueFor = (label) => {
  if (Object.prototype.hasOwnProperty.call(LABEL_HUES, label)) return LABEL_HUES[label]
  let h = 0
  for (const c of String(label)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}
const strokeForLabel = (label) => `hsl(${hueFor(label)} 65% 45%)`
const fillForLabel = (label) => `hsl(${hueFor(label)} 65% 45% / 18%)`

// ---------------------------------------------------------------------------
// token helpers
// ---------------------------------------------------------------------------

/** Walk the alias chain to a literal value, or null if it never resolves (cycle / missing). */
const resolveTokenValue = (token, byName, seen = new Set()) => {
  if (!token || seen.has(token.name)) return null
  if (token.value != null) return token.value
  if (!token.alias) return null
  seen.add(token.name)
  return resolveTokenValue(byName.get(token.alias), byName, seen)
}

/** A small visual preview for a cluster/token value, or '' when the kind has no useful preview. */
const kindPreview = (kind, value) => {
  const v = safeCss(value)
  if (!v) return ''
  if (kind === 'color') return `<span class="swatch" style="background:${v}"></span>`
  if (kind === 'radius') return `<span class="swatch swatch-neutral" style="border-radius:${v}"></span>`
  if (kind === 'space') {
    const n = Math.min(parseFloat(v) || 0, 64)
    return `<span class="swatch swatch-bar" style="width:${n}px"></span>`
  }
  if (kind === 'shadow') return `<span class="swatch swatch-neutral" style="box-shadow:${v}"></span>`
  if (kind === 'font-size') return `<span class="sample" style="font-size:${v}">Ag</span>`
  if (kind === 'font-weight') return `<span class="sample" style="font-weight:${v}">Ag</span>`
  if (kind === 'font-family') return `<span class="sample" style="font-family:${v}">Ag</span>`
  return ''
}

// ---------------------------------------------------------------------------
// section builders — every one takes the whole `data` bag and is null-safe.
// ---------------------------------------------------------------------------

const sectionWrap = (title, body) => `<section class="card"><h2>${escapeHtml(title)}</h2>${body}</section>`
const empty = (msg) => `<p class="muted">${escapeHtml(msg)}</p>`

function providerIds(data) {
  const { capture, regions, tokens, rewrite } = data
  const fromCaptureProviders = capture && capture.providers
    ? (typeof capture.providers === 'string' ? capture.providers : capture.providers.segment)
    : null
  const segment = fromCaptureProviders || (regions && regions[0] && regions[0].source) || null
  const namer = (tokens && tokens.namer) || null
  const coder = (rewrite && rewrite.coder) || null
  return { segment, namer, coder }
}

function headerSection(data) {
  const { capture } = data
  const providers = providerIds(data)
  const providerRow = (label, id) => {
    if (!id) return `<div class="provider"><span class="provider-label">${escapeHtml(label)}</span><span class="muted">not run yet</span></div>`
    const badge = isMockId(id) ? '<span class="badge badge-info">MOCK / offline</span>' : ''
    return `<div class="provider"><span class="provider-label">${escapeHtml(label)}</span><code>${escapeHtml(id)}</code>${badge}</div>`
  }
  return `<header class="report-header">
    <h1>Screenshot &rarr; Tokens</h1>
    <div class="run-meta">
      ${capture && capture.url ? `<div class="run-url">${escapeHtml(capture.url)}</div>` : empty('no capture yet')}
      ${capture && capture.capturedAt ? `<div class="muted">${escapeHtml(capture.capturedAt)}</div>` : ''}
    </div>
    <div class="providers">
      ${providerRow('Segment', providers.segment)}
      ${providerRow('Namer', providers.namer)}
      ${providerRow('Coder', providers.coder)}
    </div>
  </header>`
}

function heroSection(data) {
  const { capture, regions, screenshot } = data
  if (!screenshot) return sectionWrap('Screenshot', empty('No screenshot yet — run the capture stage.'))
  const regs = regions || []
  const W = (capture && capture.viewport && capture.viewport.width) || 1440
  let H = (capture && capture.viewport && capture.viewport.height) || 900
  for (const r of regs) { const bottom = r.bbox[1] + r.bbox[3]; if (bottom > H) H = bottom }
  for (const e of (capture && capture.elements) || []) { const bottom = e.bbox[1] + e.bbox[3]; if (bottom > H) H = bottom }

  const boxes = regs.map((r) => {
    const [x, y, w, h] = r.bbox
    const left = (x / W) * 100, top = (y / H) * 100, ww = (w / W) * 100, hh = (h / H) * 100
    const tip = `${r.label} (${Number(r.score ?? 0).toFixed(2)})`
    const style = `left:${left}%;top:${top}%;width:${ww}%;height:${hh}%;--stroke:${strokeForLabel(r.label)};--fill:${fillForLabel(r.label)}`
    return `<div class="region" style="${style}" data-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}"></div>`
  }).join('')

  const toggle = regs.length
    ? `<label class="toggle"><input type="checkbox" id="toggle-regions" checked> Show ${regs.length} region${regs.length === 1 ? '' : 's'}</label>`
    : empty('No regions yet — run the segment stage.')

  const oracleNote = regs.length && regs[0].source === 'mock-dom'
    ? empty('These regions come from a mock oracle (DOM boxes), not SAM 3.1 looking at pixels. It can see the DOM, SAM only sees pixels, so these scores overstate real segmentation quality.')
    : ''

  return sectionWrap('Screenshot', `
    ${toggle}
    ${oracleNote}
    <div class="hero" style="aspect-ratio:${W} / ${H}">
      <img src="${screenshot}" alt="Captured screenshot">
      <div class="overlay-layer">${boxes}</div>
    </div>
  `)
}

function tokensSection(data) {
  const { tokens, clusters } = data
  if (!tokens) return sectionWrap('Tokens', empty('No token set yet — run the name stage.'))
  const list = tokens.tokens || []
  if (!list.length) return sectionWrap('Tokens', empty('No tokens proposed.'))
  const clustersById = new Map((clusters || []).map((c) => [c.id, c]))
  const byName = new Map(list.map((t) => [t.name, t]))

  const tiers = ['primitive', 'semantic', 'component']
  const groups = tiers.map((tier) => {
    const inTier = list.filter((t) => t.tier === tier)
    if (!inTier.length) return ''
    const chips = inTier.map((t) => {
      const cluster = (t.clusters || []).map((id) => clustersById.get(id)).find(Boolean)
      const kind = cluster ? cluster.kind : null
      const resolved = resolveTokenValue(t, byName)
      const preview = kindPreview(kind, resolved)
      const alias = t.alias ? `<div class="alias">&rarr; <code>${escapeHtml(t.alias)}</code></div>` : ''
      const clusterPills = (t.clusters || []).map((id) => `<span class="pill">${escapeHtml(id)}</span>`).join('')
      const reviewBadge = t.review ? `<span class="badge ${REVIEW_BADGE_CLASS[t.review] || 'badge-info'}">${escapeHtml(t.review)}</span>` : ''
      return `<div class="chip" data-token-name="${escapeHtml(t.name)}">
        <div class="chip-head">${preview}<code class="chip-name">${escapeHtml(t.name)}</code>${reviewBadge}</div>
        <div class="chip-var"><code>${escapeHtml(cssVarOf(t.name))}</code></div>
        ${alias}
        ${t.why ? `<div class="chip-why">${escapeHtml(t.why)}</div>` : ''}
        <div class="chip-meta">${clusterPills}</div>
        <div class="review-controls">
          <button type="button" class="review-btn" data-action="accept">Accept</button>
          <button type="button" class="review-btn" data-action="rename">Rename</button>
          <button type="button" class="review-btn" data-action="reject">Reject</button>
          <input type="text" class="rename-input" placeholder="new name, Enter to confirm" hidden>
          <span class="review-status muted"></span>
        </div>
      </div>`
    }).join('')
    return `<h3 class="tier-head">${escapeHtml(tier)} <span class="muted">(${inTier.length})</span></h3><div class="chip-grid">${chips}</div>`
  }).join('')

  const reviewed = tokens.reviewed
    ? `<p class="muted">Reviewed ${escapeHtml(tokens.reviewed.at)}: ${escapeHtml(tokens.reviewed.decisions)} decision${tokens.reviewed.decisions === 1 ? '' : 's'} applied, ${escapeHtml(tokens.reviewed.reviewed)} token${tokens.reviewed.reviewed === 1 ? '' : 's'} marked.${(tokens.reviewed.notes || []).length ? ' Notes: ' + tokens.reviewed.notes.map(escapeHtml).join('; ') : ''}</p>`
    : ''
  const warnings = (tokens.warnings || []).length
    ? `<p class="muted">${escapeHtml(tokens.warnings.length)} validator repair${tokens.warnings.length === 1 ? '' : 's'}: ${tokens.warnings.slice(0, 5).map(escapeHtml).join('; ')}</p>`
    : ''
  // Merge suggestions: close values the tool would not merge on its own. A person decides.
  const merges = (tokens.merges || []).length
    ? `<h3 class="tier-head">Suggested merges <span class="muted">(${tokens.merges.length})</span></h3><ul class="merge-list">${tokens.merges.map((m) => {
        const a = clustersById.get(m.from), b = clustersById.get(m.into)
        return `<li class="merge-item" data-merge-from="${escapeHtml(m.from)}" data-merge-into="${escapeHtml(m.into)}">
          <code>${escapeHtml(a ? a.value : m.from)}</code> &rarr; <code>${escapeHtml(b ? b.value : m.into)}</code>
          <span class="muted">${escapeHtml(m.why || '')}</span>
          <button type="button" class="review-btn merge-btn" data-action="accept">Accept merge</button>
        </li>`
      }).join('')}</ul>`
    : ''
  return sectionWrap('Tokens', reviewed + groups + merges + warnings)
}

function clustersSection(data) {
  const { clusters } = data
  if (!clusters) return sectionWrap('Clusters', empty('No clusters yet — run the cluster stage.'))
  if (!clusters.length) return sectionWrap('Clusters', empty('No clusters found.'))
  const rows = clusters.map((c) => {
    const drift = (c.members || []).length > 1
    const members = (c.members || []).map((m) => `<span class="pill">${escapeHtml(m.value)} &times;${escapeHtml(m.count)}</span>`).join('')
    const topProps = topEntries(c.props).map(([k, v]) => `${escapeHtml(k)} (${v})`).join(', ') || '—'
    const topRegions = topEntries(c.regionLabels).map(([k, v]) => `${escapeHtml(k)} (${v})`).join(', ') || '—'
    return `<tr class="${drift ? 'drift' : ''}">
      <td><code>${escapeHtml(c.id)}</code></td>
      <td>${escapeHtml(c.kind)}</td>
      <td class="value-cell">${kindPreview(c.kind, c.value)}<code>${escapeHtml(c.value)}</code></td>
      <td>${members}${drift ? '<span class="badge badge-info">merged</span>' : ''}</td>
      <td>${escapeHtml(c.count)}</td>
      <td>${topProps}</td>
      <td>${topRegions}</td>
    </tr>`
  }).join('')
  return sectionWrap('Clusters', `<div class="table-wrap"><table>
    <thead><tr><th>id</th><th>kind</th><th>representative</th><th>members</th><th>uses</th><th>top props</th><th>top regions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`)
}

function rewriteSection(data) {
  const { rewrite } = data
  if (!rewrite) return sectionWrap('Rewrite', empty('No rewrite yet — run the rewrite stage.'))
  const edits = rewrite.edits || []
  const fileCount = (rewrite.files || []).length
  const summary = `${edits.length} edit${edits.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'} via <code>${escapeHtml(rewrite.coder)}</code>${rewrite.written ? '' : ' (dry run — not written)'}`
  if (!edits.length) return sectionWrap('Rewrite', `<p>${summary}</p>${empty('No literals replaced.')}`)
  const rows = edits.map((e) => `<tr>
    <td><code>${escapeHtml(e.file)}:${escapeHtml(e.line)}</code></td>
    <td>${escapeHtml(e.prop)}</td>
    <td><code>${escapeHtml(e.before)}</code></td>
    <td><code>${escapeHtml(e.after)}</code></td>
    <td><code>${escapeHtml(cssVarOf(e.token))}</code></td>
  </tr>`).join('')
  return sectionWrap('Rewrite', `<p>${summary}</p><div class="table-wrap"><table>
    <thead><tr><th>file:line</th><th>prop</th><th>before</th><th>after</th><th>token</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`)
}

const verifyFig = (src, label) => src
  ? `<figure><img src="${src}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>`
  : `<figure class="missing"><div class="placeholder">no image</div><figcaption>${escapeHtml(label)}</figcaption></figure>`

const STATUS_BADGE_CLASS = { pass: 'badge-pass', FAIL: 'badge-fail', review: 'badge-caution' }

/** One named pixel-diff check (fallback / colors / all tokens), with its own status pill and thumbnails. */
function verifyRow(label, v, imgs, status) {
  if (!v) return ''
  const i = imgs || {}
  const pct = Number(v.ratio ?? 0) * 100
  const badge = `<span class="badge ${STATUS_BADGE_CLASS[status] || 'badge-info'}">${escapeHtml(status)}</span>`
  return `<div class="verify-row">
    <div class="verify-row-head">
      ${badge} <strong>${escapeHtml(label)}</strong>
      <span class="muted">${escapeHtml(v.diffPixels)} / ${escapeHtml(v.totalPixels)} px (${pct.toFixed(3)}%), threshold ${escapeHtml(v.threshold)}</span>
    </div>
    <div class="verify-grid verify-grid--compact">
      ${verifyFig(i.before, 'before')}
      ${verifyFig(i.after, 'after')}
      ${verifyFig(i.diff, 'diff')}
    </div>
  </div>`
}

function verifySection(data) {
  const { verify, verifyImages } = data
  if (!verify) return sectionWrap('Verify', empty('No verify yet — run the verify stage.'))
  const imgs = verifyImages || {}

  // Older/simple verify.json has just one check; the richer shape breaks it into fallback
  // (rewrite safety, must be 0 px), colors (merges must be invisible) and all-tokens (the full
  // picture, which may legitimately move pixels when e.g. 7/8/9px spacing is merged on purpose).
  const hasBreakdown = verify.fallback || verify.colors
  if (!hasBreakdown) {
    const badge = verify.pass ? '<span class="badge badge-pass">PASS</span>' : '<span class="badge badge-fail">FAIL</span>'
    const pct = Number(verify.ratio ?? 0) * 100
    return sectionWrap('Verify', `
      <p>${badge} ${pct.toFixed(3)}% of pixels changed (${escapeHtml(verify.diffPixels)} / ${escapeHtml(verify.totalPixels)}), threshold ${escapeHtml(verify.threshold)}</p>
      <div class="verify-grid">
        ${verifyFig(imgs.before, 'before')}
        ${verifyFig(imgs.after, 'after')}
        ${verifyFig(imgs.diff, 'diff')}
      </div>
    `)
  }

  const gateBadge = verify.pass ? '<span class="badge badge-pass">PASS</span>' : '<span class="badge badge-fail">FAIL</span>'
  const rows = [
    verifyRow('Fallbacks only (safety)', verify.fallback, imgs.fallback, verify.fallback && verify.fallback.pass ? 'pass' : 'FAIL'),
    verifyRow('Colors merged', verify.colors, imgs.colors, verify.colors && verify.colors.pass ? 'pass' : 'FAIL'),
    verifyRow('All tokens (layout cleanup to review)', verify, imgs, verify.reviewNeeded ? 'review' : 'pass'),
  ].join('')

  return sectionWrap('Verify', `
    <p>${gateBadge} rewrite gate: fallbacks must be pixel-identical and color merges must be invisible</p>
    ${rows}
  `)
}

/** A stable-ish id to scope the browser's localStorage key, so two reports opened from the
 * same file:// origin don't clobber each other's unsent review decisions. Best effort only. */
const runIdFor = (data) => {
  const capture = data.capture
  const bits = [(capture && capture.url) || '', (capture && capture.capturedAt) || '']
  return bits.join('|') || 's2t'
}

function reviewToolbar(data) {
  const tokens = data.tokens
  if (!tokens || !(tokens.tokens || []).length) return ''
  return `<div class="review-toolbar">
    <button type="button" id="download-review">Download review.json (0)</button>
    <span class="muted">Save it into the run folder, then run <code>node src/cli.js review --run out/&lt;run&gt;</code></span>
  </div>`
}

// Vanilla JS, no external scripts, no network and no required storage: decisions live in memory
// for the view and are mirrored to localStorage only as a best-effort convenience (try/catch).
const REVIEW_SCRIPT = `<script>
(function () {
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var runId = document.body.getAttribute('data-run-id') || 's2t';
  var storeKey = 's2t-review:' + runId;
  var decisions = {};
  try {
    var saved = localStorage.getItem(storeKey);
    if (saved) decisions = JSON.parse(saved) || {};
  } catch (e) { /* no storage available; decisions stay in memory for this view only */ }

  function persist() {
    try { localStorage.setItem(storeKey, JSON.stringify(decisions)); } catch (e) { /* best effort only */ }
  }

  function updateToolbar() {
    var btn = document.getElementById('download-review');
    if (!btn) return;
    btn.textContent = 'Download review.json (' + Object.keys(decisions).length + ')';
  }

  function renderChip(chip, name) {
    var d = decisions[name];
    qsa('.review-btn', chip).forEach(function (b) { b.classList.remove('active'); });
    var status = chip.querySelector('.review-status');
    if (!d) { if (status) status.textContent = ''; return; }
    var sel = chip.querySelector('.review-btn[data-action="' + d.action + '"]');
    if (sel) sel.classList.add('active');
    if (status) status.textContent = d.action === 'rename' ? ('renaming to ' + d.to) : d.action;
  }

  qsa('.chip[data-token-name]').forEach(function (chip) {
    var name = chip.getAttribute('data-token-name');
    var input = chip.querySelector('.rename-input');
    renderChip(chip, name);
    qsa('.review-btn', chip).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        if (action === 'rename') {
          if (input) { input.hidden = !input.hidden; if (!input.hidden) input.focus(); }
          return;
        }
        decisions[name] = { name: name, action: action };
        if (input) input.hidden = true;
        persist();
        renderChip(chip, name);
        updateToolbar();
      });
    });
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var to = input.value.trim();
        if (!to) return;
        decisions[name] = { name: name, action: 'rename', to: to };
        input.hidden = true;
        persist();
        renderChip(chip, name);
        updateToolbar();
      });
    }
  });

  qsa('.merge-item').forEach(function (li) {
    var from = li.getAttribute('data-merge-from'), into = li.getAttribute('data-merge-into');
    var key = 'merge:' + from;
    var btn = li.querySelector('.merge-btn');
    function render() { if (btn) btn.classList.toggle('active', !!decisions[key]); }
    render();
    if (btn) btn.addEventListener('click', function () {
      if (decisions[key]) delete decisions[key];
      else decisions[key] = { action: 'merge', from: from, into: into };
      persist(); render(); updateToolbar();
    });
  });

  updateToolbar();

  var downloadBtn = document.getElementById('download-review');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', function () {
      var payload = { decisions: Object.keys(decisions).map(function (k) { return decisions[k]; }) };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'review.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
})();
</script>`

// ---------------------------------------------------------------------------
// styling — self-contained, system font stack, light default + dark via prefers-color-scheme
// ---------------------------------------------------------------------------

const CSS = `
:root {
  --bg: #f7f7f7; --surface: #ffffff; --fg: #4a4a4a; --border: #d1d1d1;
  --accent: #f26722; --secondary: #8b7e66;
  --good: #15803d; --bad: #b3261e; --caution: #b45309;
  --info-fg: #2a5aa0; --info-bg: #eef4fb; --info-border: #cfe0f3;
  --muted: #8b7e66;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1c; --surface: #262626; --fg: #f2f2f2; --border: #3a3a3a;
    --accent: #f26722; --secondary: #c9bda3;
    --good: #4ade80; --bad: #f87171; --caution: #fbbf24;
    --info-fg: #8ab4e8; --info-bg: #16263a; --info-border: #274a6e;
    --muted: #a99a84;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 16px 16px 90px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
.muted { color: var(--muted); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.card h2 { margin-top: 0; }
.report-header h1 { margin: 0 0 8px; color: var(--accent); }
.run-url { font-weight: 600; word-break: break-all; }
.providers { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
.provider { display: flex; align-items: center; gap: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; }
.provider-label { color: var(--secondary); font-size: 0.85em; }
.badge { display: inline-block; font-size: 0.75em; font-weight: 600; border-radius: 999px; padding: 2px 8px; }
.badge-info { background: var(--info-bg); color: var(--info-fg); border: 1px solid var(--info-border); }
.badge-pass { background: var(--info-bg); color: var(--good); border: 1px solid var(--good); }
.badge-fail { background: var(--info-bg); color: var(--bad); border: 1px solid var(--bad); }
.toggle { display: inline-block; margin-bottom: 10px; cursor: pointer; }
.hero { position: relative; width: 100%; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.hero img { display: block; width: 100%; height: 100%; }
.overlay-layer { position: absolute; inset: 0; }
#toggle-regions:not(:checked) ~ .hero .overlay-layer { display: none; }
.region { position: absolute; border: 2px solid var(--stroke); background: var(--fill); box-sizing: border-box; }
.region:hover::after {
  content: attr(data-tip); position: absolute; top: -1.6em; left: 0;
  background: var(--stroke); color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px;
  white-space: nowrap; z-index: 5;
}
.tier-head { margin: 18px 0 8px; text-transform: capitalize; }
.chip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.chip { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: var(--bg); }
.chip-head { display: flex; align-items: center; gap: 8px; }
.chip-name { font-weight: 600; }
.chip-var { color: var(--secondary); margin-top: 4px; }
.chip-why { margin-top: 6px; font-size: 0.9em; }
.chip-meta { margin-top: 6px; }
.alias { margin-top: 4px; }
.pill { display: inline-block; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; font-size: 0.8em; margin: 2px 2px 0 0; }
.swatch { display: inline-block; width: 22px; height: 22px; border: 1px solid var(--border); flex-shrink: 0; }
.swatch-neutral { background: var(--surface); }
.swatch-bar { height: 10px; border-radius: 3px; background: var(--secondary); }
.sample { font-size: 14px; border: 1px solid var(--border); border-radius: 4px; padding: 0 6px; background: var(--surface); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
tr.drift { background: var(--info-bg); }
.verify-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.verify-grid figure { margin: 0; }
.verify-grid img { width: 100%; border: 1px solid var(--border); border-radius: 6px; display: block; }
.verify-grid figcaption { text-align: center; color: var(--secondary); font-size: 0.85em; margin-top: 4px; }
.placeholder { display: flex; align-items: center; justify-content: center; height: 120px; border: 1px dashed var(--border); border-radius: 6px; color: var(--muted); }
.badge-caution { background: var(--info-bg); color: var(--caution); border: 1px solid var(--caution); }
.verify-row { margin-bottom: 16px; }
.verify-row:last-child { margin-bottom: 0; }
.verify-row-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
.verify-grid--compact { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.verify-grid--compact img { max-height: 180px; object-fit: contain; background: var(--surface); }
.review-controls { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.review-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; font-size: 0.8em; cursor: pointer; color: var(--fg); }
.merge-list { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 8px; }
.merge-item { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.review-btn.active[data-action="accept"] { background: var(--good); color: #fff; border-color: var(--good); }
.review-btn.active[data-action="reject"] { background: var(--bad); color: #fff; border-color: var(--bad); }
.review-btn.active[data-action="rename"] { background: var(--info-fg); color: #fff; border-color: var(--info-fg); }
.rename-input { font-size: 0.85em; padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--fg); }
.rename-input[hidden] { display: none; }
.review-status { font-size: 0.8em; }
.review-toolbar {
  position: fixed; bottom: 16px; right: 16px; left: 16px; z-index: 20;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 14px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px; max-width: 1100px; margin: 0 auto;
}
.review-toolbar button { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 8px 14px; font-weight: 600; cursor: pointer; font-size: 0.9em; }
.review-toolbar button:hover { opacity: 0.9; }
@media (max-width: 640px) {
  .wrap { padding: 10px 10px 90px; }
  .chip-grid { grid-template-columns: 1fr 1fr; }
  .review-toolbar { flex-direction: column; align-items: stretch; text-align: center; }
}
`

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Pure: build the full report.html string from already-loaded data. Every field is optional —
 * a missing stage just renders a "not run yet" message in its section.
 * @param {{
 *   capture?: import('../types.js').Capture|null,
 *   regions?: import('../types.js').Region[]|null,
 *   clusters?: import('../types.js').Cluster[]|null,
 *   tokens?: import('../types.js').TokenSet|null,
 *   rewrite?: import('../types.js').RewriteResult|null,
 *   verify?: import('../types.js').VerifyResult|null,
 *   screenshot?: string|null,
 *   verifyImages?: {before?: string|null, after?: string|null, diff?: string|null,
 *     fallback?: {before?: string|null, after?: string|null, diff?: string|null}|null,
 *     colors?: {before?: string|null, after?: string|null, diff?: string|null}|null},
 * }} data
 * @returns {string}
 */
export function buildReportHtml(data = {}) {
  const body = [
    headerSection(data),
    heroSection(data),
    tokensSection(data),
    clustersSection(data),
    rewriteSection(data),
    verifySection(data),
  ].join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screenshot &rarr; Tokens report</title>
<style>${CSS}</style>
</head>
<body data-run-id="${escapeHtml(runIdFor(data))}">
<div class="wrap">
${body}
</div>
${reviewToolbar(data)}
${REVIEW_SCRIPT}
</body>
</html>
`
}

/**
 * Read whatever exists of <runDir>/{capture,regions,clusters,tokens,rewrite,verify}.json,
 * inline the screenshot and before/after/diff PNGs as data URIs (or link them when large), write <runDir>/report.html.
 * @param {string} runDir
 * @returns {string} the path written
 */
export function writeReport(runDir, o = {}) {
  // Images: embed as data URIs (one portable file) unless that gets big; tall real sites x 7 images can
  // reach 25+ MB, so "auto" links them as relative files instead. S2T_REPORT_IMAGES=embed|link overrides.
  const mode = o.images || process.env.S2T_REPORT_IMAGES || 'auto'
  const capture = readJsonSafe(join(runDir, 'capture.json'))
  const regions = readJsonSafe(join(runDir, 'regions.json'))
  const clusters = readJsonSafe(join(runDir, 'clusters.json'))
  const tokens = readJsonSafe(join(runDir, 'tokens.json'))
  const rewrite = readJsonSafe(join(runDir, 'rewrite.json'))
  const verify = readJsonSafe(join(runDir, 'verify.json'))

  const rels = [capture && capture.screenshot]
  for (const v of [verify, verify && verify.fallback, verify && verify.colors]) if (v) rels.push(v.before, v.after, v.diff)
  const total = rels.filter(Boolean).reduce((n, r) => { try { return n + statSync(join(runDir, r)).size } catch (e) { return n } }, 0)
  const embed = mode === 'embed' || (mode === 'auto' && total * 4 / 3 < 8 * 1024 * 1024)
  // Linked mode uses the relative path (report.html sits in runDir); only if the file exists.
  const img = (rel) => (rel ? (embed ? readPngDataUri(join(runDir, rel)) : existsSync(join(runDir, rel)) ? encodeURI(rel) : null) : null)
  const screenshot = capture && capture.screenshot ? img(capture.screenshot) : null
  const imagesFor = (v) => v
    ? { before: img(v.before), after: img(v.after), diff: img(v.diff) }
    : null
  const verifyImages = verify
    ? { ...imagesFor(verify), fallback: imagesFor(verify.fallback), colors: imagesFor(verify.colors) }
    : null

  const html = buildReportHtml({ capture, regions, clusters, tokens, rewrite, verify, screenshot, verifyImages })
  const outPath = join(runDir, 'report.html')
  writeFileSync(outPath, html)
  return outPath
}
