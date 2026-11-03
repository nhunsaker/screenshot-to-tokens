#!/usr/bin/env node
// Build the static live-demo site (tier A of the live demo plan) into site/ from committed inputs only:
//   docs/SUBMISSION.md (Evidence table), docs/breadth.md (per-site table), demo/argon-run and demo/lightbootstrap-run
//   (slimmed review reports, made by scripts/slim-report.mjs), demo/site-media (poster, dark mode, Point and say shots).
// No dependencies; run at image build time. Usage: node scripts/build-site.mjs [out dir, default site]
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, process.argv[2] || 'site')

// ── YOUTUBE EMBED SLOT ── fill on Nov 3 with the unlisted upload's video id (the part after `v=`), then rebuild.
// Empty = show the poster frame and a link to the repo README, where the video is embedded.
const YOUTUBE_ID = process.env.S2T_YOUTUBE_ID || 'RpnO9HfF98E'

const REPO = 'https://github.com/nhunsaker/screenshot-to-tokens'
// Tier C example chips: five stable breadth-pool sites with edits and fallbacks 0 px in docs/breadth.md (MIT; one per
// framework where we can: Jekyll x2, Hugo, Astro, Docusaurus), all small (under 1.5 MB mirrored).
const RUN_EXAMPLES = ['https://gaotianchi.github.io/', 'https://proinsias.github.io/', 'https://infi-defi.github.io/', 'https://awfp1314.github.io/', 'https://josh-wong.github.io/']
const PAGES = 'https://nhunsaker.github.io/argon-dashboard-react'
const PR = 'https://github.com/nhunsaker/argon-dashboard-react/pull/2'

const read = (p) => readFileSync(join(root, p), 'utf-8')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// Inline markdown used in the tables: **bold**, *em*, `code`. Escape first, then mark up.
const md = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>')

function mdTable(text, startRe) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => startRe.test(l))
  if (i < 0) throw new Error(`table not found: ${startRe}`)
  const rows = []
  for (let j = i; j < lines.length && lines[j].startsWith('|'); j++) {
    if (/^\|[\s|:-]+\|$/.test(lines[j])) continue
    rows.push(lines[j].slice(1, -1).split('|').map((c) => c.trim()))
  }
  return { head: rows[0], body: rows.slice(1) }
}

function renderTable({ head, body }, { caption, label, cellClass = () => '' }) {
  const th = head.map((h) => `<th scope="col">${md(h)}</th>`).join('')
  const tr = body.map((r) => `<tr>${r.map((c, k) => k === 0 ? `<th scope="row">${md(c)}</th>` : `<td${cellClass(c, k) ? ` class="${cellClass(c, k)}"` : ''}>${md(c)}</td>`).join('')}</tr>`).join('\n')
  return `<div class="table-scroll" role="region" aria-label="${esc(label)}" tabindex="0"><table>
<caption>${caption}</caption>
<thead><tr>${th}</tr></thead>
<tbody>
${tr}
</tbody></table></div>`
}

// Evidence: verbatim from docs/SUBMISSION.md (section "Evidence").
const submission = read('docs/SUBMISSION.md')
const evSection = submission.slice(submission.indexOf('## Evidence'))
const evidence = mdTable(evSection, /^\| Claim \|/)

// Breadth: the per-site table from docs/breadth.md (the 2026-10-28 re-run).
const breadth = mdTable(read('docs/breadth.md'), /^\| Site \|/)

// Three-tier card: the real lines from the Argon run's tokens.css; the source line as rewritten in main.css.
const tokensCss = read('demo/argon-run/tokens.css')
const need = (re, what) => { const m = tokensCss.match(re); if (!m) throw new Error(`tier card: ${what} not found in demo/argon-run/tokens.css`); return m[0].trim() }
const tiers = [
  [need(/--color-blue-500:\s*#[0-9a-f]+;/i, 'primitive'), 'Primitive', 'the raw value'],
  [need(/--color-action-primary:\s*var\(--color-blue-500\);/, 'semantic'), 'Semantic', 'what it means'],
  [need(/--button-bg:\s*var\(--color-action-primary\);/, 'component'), 'Component', 'where it’s used'],
  ['background-color: var(--button-bg, #5e72e4);', 'Source', 'the original kept as the fallback'],
]

const steps = [
  ['Capture', 'Playwright opens the live web app and takes a full-page screenshot plus the computed style of every element.'],
  ['Segment', '<strong>SAM 3.1</strong> finds buttons, inputs and icons from the pixels, even where the markup describes nothing.'],
  ['Name', '<strong>Muse Spark</strong> names a three-tier token set, primitive → semantic → component, with a reason for each token. Code checks every proposal.'],
  ['Review', 'A person accepts, renames, rejects or merges tokens in the HTML report.'],
  ['Rewrite', 'Hardcoded values in the real source become <code>var(--token, original)</code>, so the original stays as the fallback.'],
  ['Verify, then open a pull request', 'Four checks: fallbacks only must be 0 px changed, merged colors must be invisible, the full cleanup is shown for review, and no text may get harder to read (text contrast, WCAG AA).'],
]

const size = (p) => { const b = statSync(join(root, p)).size; return b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B` }

const video = YOUTUBE_ID
  ? `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${esc(YOUTUBE_ID)}" title="Screenshot to Tokens, demo video (2:55)" allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy"></iframe></div>`
  : `<!-- YOUTUBE EMBED SLOT: set YOUTUBE_ID in scripts/build-site.mjs (or S2T_YOUTUBE_ID) on Nov 3 and rebuild. -->
<figure class="video-poster">
  <a href="${REPO}#readme"><img src="media/poster.png" width="640" height="360" alt="Title card of the demo video: Screenshot to Tokens, Meta Global AI Developer Hackathon, Startup track."></a>
  <figcaption>The 2:57 demo video. <a href="${REPO}#readme">Watch it in the repo README</a> (the repo is public from Nov 3; the video gets its own player here then).</figcaption>
</figure>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screenshot to Tokens</title>
<meta name="description" content="A design system from a screenshot in seconds. A more accessible app from the tokens in one change. SAM 3.1 and Muse Spark, built for the Meta Global AI Developer Hackathon.">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%230f1115%27/%3E%3Crect x=%277%27 y=%277%27 width=%2718%27 height=%2718%27 rx=%274%27 fill=%27%238a9af0%27/%3E%3C/svg%3E">
<style>
/* Our own page eats our own cooking: every value is a token, every use is var(--token, fallback). */
:root {
  --color-ink-950: #0f1115;
  --color-ink-900: #161920;
  --color-ink-800: #1f232c;
  --color-ink-700: #2c313c;
  --color-sand-100: #e8e8e4;
  --color-sand-300: #c9d1d9;
  --color-sand-500: #a3a39d;
  --color-indigo-300: #8a9af0;
  --color-indigo-200: #b4bef6;
  --color-mint-300: #7ee2a8;
  --color-coral-300: #ffa198;
  --color-amber-300: #f5c46b;

  --color-surface-page: var(--color-ink-950, #0f1115);
  --color-surface-raised: var(--color-ink-900, #161920);
  --color-surface-code: var(--color-ink-800, #1f232c);
  --color-border-default: var(--color-ink-700, #2c313c);
  --color-text-default: var(--color-sand-100, #e8e8e4);
  --color-text-code: var(--color-sand-300, #c9d1d9);
  --color-text-muted: var(--color-sand-500, #a3a39d);
  --color-text-eyebrow: var(--color-indigo-300, #8a9af0);
  --color-text-good: var(--color-mint-300, #7ee2a8);
  --color-text-bad: var(--color-coral-300, #ffa198);
  --color-text-note: var(--color-amber-300, #f5c46b);
  --color-action-primary: var(--color-indigo-300, #8a9af0);
  --color-action-primary-hover: var(--color-indigo-200, #b4bef6);
  --color-focus-ring: var(--color-amber-300, #f5c46b);

  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --radius-card: 12px;
  --radius-chip: 10px;
  --space-gutter: 16px;
  --size-content: 1040px;
  --focus-ring-width: 3px;
  --focus-ring-offset: 2px;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--color-surface-page, #0f1115);
  color: var(--color-text-default, #e8e8e4);
  font: 17px/1.6 var(--font-sans, sans-serif);
}
a { color: var(--color-action-primary, #8a9af0); text-underline-offset: 3px; }
a:hover { color: var(--color-action-primary-hover, #b4bef6); }
:focus-visible {
  outline: var(--focus-ring-width, 3px) solid var(--color-focus-ring, #f5c46b);
  outline-offset: var(--focus-ring-offset, 2px);
  border-radius: 4px;
}
code { font-family: var(--font-mono, monospace); font-size: 0.9em; color: var(--color-text-code, #c9d1d9); overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; display: block; }
.skip { position: absolute; left: -9999px; top: 8px; background: var(--color-surface-raised, #161920); padding: 8px 12px; z-index: 10; }
.skip:focus { left: 8px; }
.wrap { max-width: var(--size-content, 1040px); margin: 0 auto; padding: 0 var(--space-gutter, 16px); }
header.hero { padding: 64px 0 32px; }
.eyebrow { font-size: 0.82rem; letter-spacing: .12em; text-transform: uppercase; color: var(--color-text-eyebrow, #8a9af0); margin: 0 0 12px; }
h1 { font-size: clamp(2.2rem, 6vw, 3.5rem); line-height: 1.05; letter-spacing: -1px; margin: 0 0 18px; }
.tagline { font-size: clamp(1.2rem, 3vw, 1.6rem); line-height: 1.35; font-weight: 600; margin: 0 0 14px; max-width: 46rem; }
.lede { color: var(--color-text-muted, #a3a39d); max-width: 46rem; margin: 0; }
section { padding: 36px 0; border-top: 1px solid var(--color-border-default, #2c313c); }
h2 { font-size: 1.6rem; letter-spacing: -.3px; margin: 0 0 8px; }
h3 { font-size: 1.15rem; margin: 22px 0 6px; }
.sub { color: var(--color-text-muted, #a3a39d); margin: 0 0 20px; max-width: 46rem; }
.muted { color: var(--color-text-muted, #a3a39d); }
.video-poster { margin: 0; }
.video-poster a { display: inline-block; border-radius: var(--radius-card, 12px); }
.video-poster img { border-radius: var(--radius-card, 12px); border: 1px solid var(--color-border-default, #2c313c); width: 640px; }
.video-poster figcaption, figure figcaption { color: var(--color-text-muted, #a3a39d); font-size: 0.92rem; margin-top: 10px; }
.video-frame { position: relative; aspect-ratio: 16 / 9; max-width: 800px; }
.video-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: var(--radius-card, 12px); }
ol.steps { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; counter-reset: step; }
ol.steps li { background: var(--color-surface-raised, #161920); border: 1px solid var(--color-border-default, #2c313c); border-radius: var(--radius-card, 12px); padding: 16px 18px; counter-increment: step; }
ol.steps li::before { content: counter(step); display: inline-block; font: 700 0.85rem/1 var(--font-sans, sans-serif); color: var(--color-text-eyebrow, #8a9af0); margin-right: 8px; }
ol.steps .h { font-weight: 700; }
ol.steps p { margin: 6px 0 0; color: var(--color-text-muted, #a3a39d); font-size: 0.96rem; }
.tier-card { background: var(--color-surface-raised, #161920); border: 1px solid var(--color-border-default, #2c313c); border-radius: var(--radius-card, 12px); padding: 22px; margin: 0; }
.tier-card ol { list-style: none; margin: 0; padding: 0; }
.tier-card li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 18px; padding: 10px 0; border-bottom: 1px solid var(--color-border-default, #2c313c); }
.tier-card li:last-child { border-bottom: 0; margin-top: 10px; }
.tier-card li code { font-size: clamp(0.85rem, 2.4vw, 1.08rem); }
.tier { flex: none; background: var(--color-surface-code, #1f232c); color: var(--color-text-default, #e8e8e4); font-size: 0.9rem; font-weight: 600; padding: 4px 10px; border-radius: var(--radius-chip, 10px); }
.tier span { font-weight: 400; color: var(--color-text-muted, #a3a39d); }
.benefit { color: var(--color-text-good, #7ee2a8); font-weight: 700; font-size: 1.15rem; line-height: 1.4; margin: 18px 0 0; }
.table-scroll { overflow-x: auto; border: 1px solid var(--color-border-default, #2c313c); border-radius: var(--radius-card, 12px); }
table { border-collapse: collapse; width: 100%; font-size: 0.93rem; }
caption { max-width: calc(100vw - 2 * var(--space-gutter, 16px) - 4px); white-space: normal; text-align: left; padding: 12px 14px 4px; color: var(--color-text-muted, #a3a39d); font-size: 0.88rem; }
th, td { text-align: left; vertical-align: top; padding: 9px 14px; border-bottom: 1px solid var(--color-border-default, #2c313c); }
thead th { color: var(--color-text-muted, #a3a39d); font-weight: 600; font-size: 0.85rem; white-space: nowrap; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
tbody th { font-weight: 600; }
.evidence td:nth-child(2) { min-width: 18rem; }
.breadth td, .breadth th { white-space: nowrap; }
.breadth td:last-child { white-space: normal; min-width: 16rem; }
.evidence td:last-child code { overflow-wrap: normal; white-space: nowrap; }
td.pass { color: var(--color-text-good, #7ee2a8); }
td.flag { color: var(--color-text-note, #f5c46b); }
.links { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; padding: 0; margin: 0; list-style: none; }
.links li { background: var(--color-surface-raised, #161920); border: 1px solid var(--color-border-default, #2c313c); border-radius: var(--radius-card, 12px); padding: 14px 16px; }
.links a { font-weight: 600; }
.links p { margin: 4px 0 0; color: var(--color-text-muted, #a3a39d); font-size: 0.92rem; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.pair figure, .shots figure { margin: 0; }
.pair img, .shots img { border-radius: var(--radius-chip, 10px); border: 1px solid var(--color-border-default, #2c313c); }
.shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.note { display: inline-block; background: var(--color-surface-code, #1f232c); color: var(--color-text-note, #f5c46b); font-weight: 600; padding: 4px 12px; border-radius: var(--radius-chip, 10px); margin: 0 0 16px; }
.try-row { margin: 0 0 16px; }
.try { display: inline-block; background: #8a9af0; color: #0f1115; font-weight: 700; padding: 8px 16px; border-radius: var(--radius-chip, 10px); text-decoration: none; margin-right: 8px; }
.try:hover { background: #a9b5f5; }
.good { color: var(--color-text-good, #7ee2a8); font-weight: 600; }
/* tier c: run it on a public page */
.run-form label { display: block; font-weight: 600; margin: 0 0 6px; }
.run-row { display: flex; flex-wrap: wrap; gap: 8px; }
.run-row input { flex: 1 1 260px; min-width: 0; font: inherit; padding: 8px 12px; border-radius: var(--radius-chip, 10px); border: 1px solid #5c6370; background: var(--color-surface-raised, #161920); color: var(--color-text-default, #e8e8e4); }
.run-row input:focus-visible, .chip:focus-visible, .try:focus-visible { outline: 3px solid #8a9af0; outline-offset: 2px; }
.run-row .try { border: 0; font: inherit; font-weight: 700; cursor: pointer; margin: 0; }
.run-row .try:disabled { opacity: .6; cursor: not-allowed; }
.run-note { color: var(--color-text-muted, #a3a39d); font-size: 0.92rem; margin: 10px 0; }
.run-examples { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
.chip { font: inherit; font-size: 0.88rem; background: var(--color-surface-code, #1f232c); color: var(--color-text-default, #e8e8e4); border: 1px solid var(--color-border-default, #2c313c); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.chip:hover { border-color: #8a9af0; }
.run-status { margin-top: 8px; }
.run-msg { margin: 8px 0; }
.run-done { color: var(--color-text-good, #7ee2a8); font-weight: 600; }
.run-steps { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 0; margin: 6px 0; font-size: 0.92rem; }
.run-steps .step-done { color: var(--color-text-good, #7ee2a8); }
.run-steps .step-now { color: var(--color-text-default, #e8e8e4); font-weight: 700; }
.run-steps .step-todo { color: var(--color-text-muted, #a3a39d); }
footer { border-top: 1px solid var(--color-border-default, #2c313c); padding: 28px 0 48px; color: var(--color-text-muted, #a3a39d); font-size: 0.92rem; }
footer p { margin: 4px 0; }
.scroll-hint { display: none; color: var(--color-text-muted, #a3a39d); font-size: 0.85rem; margin: 0 0 8px; }
@media (max-width: 700px) { .scroll-hint { display: block; } }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
<header class="hero">
  <p class="eyebrow">Meta Global AI Developer Hackathon · Startup track</p>
  <h1>Screenshot to Tokens</h1>
  <p class="tagline">A design system from a screenshot in seconds. A more accessible app from the tokens in one change.</p>
  <p class="lede">Point it at a live web app with no design tokens. SAM 3.1 reads the interface from pixels, Muse Spark names a
  tiered token set, a person reviews it, the hardcoded values in the real source become <code>var(--token, original)</code>,
  and four checks prove nothing moved before a pull request opens.</p>
</header>

<main id="main">
<section aria-labelledby="video-h">
  <h2 id="video-h">The demo video</h2>
  ${video}
</section>

<section aria-labelledby="what-h">
  <h2 id="what-h">What it does</h2>
  <p class="sub">Two Meta model steps (SAM 3.1, Muse Spark); everything else is deterministic code you can check.</p>
  <ol class="steps">
${steps.map(([h, p]) => `    <li><span class="h">${h}</span><p>${p}</p></li>`).join('\n')}
  </ol>
</section>

<section aria-labelledby="tiers-h">
  <h2 id="tiers-h">Three tiers, one name each</h2>
  <p class="sub">Real lines from the Argon Dashboard run: <code>tokens.css</code> and the rewritten <code>main.css</code>.</p>
  <figure class="tier-card">
    <ol>
${tiers.map(([code, tier, why]) => `      <li><code>${esc(code)}</code><span class="tier">${tier} <span>· ${why}</span></span></li>`).join('\n')}
    </ol>
    <figcaption class="benefit">Change color.action.primary once and every button, badge and link follows. A name a person, or a model, can act on.</figcaption>
  </figure>
</section>

<section aria-labelledby="try-h">
  <h2 id="try-h">Try it</h2>
  <p class="sub">Argon Dashboard React (Creative Tim, MIT) on our fork's GitHub Pages: the original, the tokenized build, a proposed
  change previewed live, and the token playground.</p>
  <ul class="links">
    <li><a href="${PAGES}/original/">Original</a><p>The app as published, every color typed in place.</p></li>
    <li><a href="${PAGES}/tokens/">Tokenized</a><p>Same pixels, now driven by <code>tokens.css</code>.</p></li>
    <li><a href="${PAGES}/tokens/?tokens=color-action-primary:e8711a">A proposed change, previewed</a><p><code>color.action.primary</code> set to orange: every button, badge and link follows.</p></li>
    <li><a href="${PAGES}/playground/">Token playground</a><p>Change any token, check text contrast, build a dark theme (static, no model calls).</p></li>
  </ul>
  <h3>The review reports</h3>
  <ul class="links">
    <li><a href="argon-run/report.html">Argon Dashboard: review report</a><p>Every proposed token with its reason, SAM regions, and the verify table.</p></li>
    <li><a href="lightbootstrap-run/report.html">Light Bootstrap Dashboard: review report</a><p>The second demo app, same pipeline.</p></li>
    <li><a href="argon-run/tokens.css" download="argon-tokens.css">Argon <code>tokens.css</code></a><p>${size('demo/argon-run/tokens.css')}, the token file the rewrite points at.</p></li>
    <li><a href="lightbootstrap-run/tokens.css" download="lightbootstrap-tokens.css">Light Bootstrap <code>tokens.css</code></a><p>${size('demo/lightbootstrap-run/tokens.css')}.</p></li>
  </ul>
</section>

<section aria-labelledby="evidence-h">
  <h2 id="evidence-h">Evidence</h2>
  <p class="sub">All numbers from real runs, reproducible from the repo (as in <code>docs/SUBMISSION.md</code>).</p>
  <div class="evidence">
  ${renderTable(evidence, { caption: 'Each claim, its measured result, and the file in the repo that holds it.', label: 'Evidence table' })}
  </div>
</section>

<section aria-labelledby="dark-h">
  <h2 id="dark-h">Dark mode as a token file</h2>
  <p class="sub">Light Bootstrap Dashboard: <span class="good">83 of 84 text pairs pass text contrast in dark</span> (14 of 84 in its original
  light theme). One token file, every text pair checked; the top navbar is not a token, so it stays light.</p>
  <div class="pair">
    <figure><img src="media/dark-before.jpg" width="1440" height="900" loading="lazy" alt="Light Bootstrap Dashboard in its original light theme: white cards, a line chart and a pie chart, dark sidebar."><figcaption>Before: the original light theme.</figcaption></figure>
    <figure><img src="media/dark-after.jpg" width="1440" height="900" loading="lazy" alt="The same dashboard with the dark token file applied: black cards and page, light text, the same charts; the top navbar stays light."><figcaption>After: the proposed dark token file.</figcaption></figure>
  </div>
</section>

<section aria-labelledby="breadth-h">
  <h2 id="breadth-h">28 public sites we didn't build</h2>
  <p class="sub">Mirrored, tokenized and verified end to end: <span class="good">3,687 values rewritten, 0 px changed on 23 of 23</span>
  stable sites with edits. Two sites animate on their own and are reported, not counted as passes. From <code>docs/breadth.md</code>.</p>
  <p class="scroll-hint" aria-hidden="true">Swipe the table sideways for every column.</p>
  <div class="breadth">
  ${renderTable(breadth, { caption: 'Per site, 2026-10-28 re-run. Safety checks: fallbacks only must be 0 px; merged colors must be invisible.', label: 'Breadth table, 28 sites', cellClass: (c, k) => k === 6 ? (/FAIL/.test(c) ? 'flag' : /pass/.test(c) ? 'pass' : '') : '' })}
  </div>
</section>

<section aria-labelledby="pas-h">
  <h2 id="pas-h">Point and say</h2>
  <!--tier-b--><p class="try-row"><a class="try" href="/try/">Try it live</a> <span class="muted">On Argon Dashboard, with a shared demo budget that counts down on the page.</span></p><!--/tier-b-->
  <!--no-tier-b--><p class="note">Live version coming</p><!--/no-tier-b-->
  <p class="sub">Click a control in the live web app, then say or type the change. Meta's speech model transcribes it, SAM 3.1
  outlines what was clicked, contrast and focus fixes are computed (no model), and every change is re-checked on the whole
  page and blocked if any text gets harder to read. Screenshots from the recorded runs on Argon:</p>
  <div class="shots">
    <figure><img src="media/pas-contrast.jpg" width="1440" height="900" loading="lazy" alt="Token playground beside Argon Dashboard. Request: this label is too light, make it readable, keep our gray. Result: text contrast on 21 elements goes from 2.95:1 to 4.53:1."><figcaption>“Make it readable, keep our gray.” Text contrast: 21 elements 2.95:1 → 4.53:1, whole page 41 → 20 failing text pairs.</figcaption></figure>
    <figure><img src="media/pas-focus.jpg" width="1440" height="900" loading="lazy" alt="Token playground beside Argon Dashboard with focus rings drawn on the sidebar links. Result: visible keyboard focus on 0 of 25 controls before, 25 of 25 after."><figcaption>“A visible focus ring in our blue.” Keyboard focus: 0 → 25 of 25 controls.</figcaption></figure>
    <figure><img src="media/pas-blocked.jpg" width="1440" height="900" loading="lazy" alt="Token playground beside Argon Dashboard. Request: make these buttons red. Result: blocked, text contrast would regress on the Month button from 4.20:1 to 3.77:1, reverted automatically."><figcaption>“Make these buttons red.” Blocked and reverted: “Month” would drop from 4.20:1 to 3.77:1.</figcaption></figure>
  </div>
</section>

<!--tier-c--><section aria-labelledby="run-h">
  <h2 id="run-h">Run it on a public page</h2>
  <p class="sub">Paste the address of a public web page. We copy the page and its same-origin files, run the whole pipeline on
  the copy, and show the review report, the checks and the token file. About 20 to 60 seconds.</p>
  <form id="run-form" class="run-form" novalidate>
    <label for="run-url">Page address</label>
    <div class="run-row">
      <input id="run-url" name="url" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.github.io/" required>
      <button type="submit" class="try">Run</button>
    </div>
    <p class="run-note">The page's screenshot goes to Meta's hosted models with <code>store: false</code>. Public pages only. Results are deleted after 24 hours.</p>
    <p class="run-examples"><span class="muted">Examples from the 28-site run:</span>
${RUN_EXAMPLES.map((u) => `      <button type="button" class="chip" data-run-example="${u}">${u.replace(/^https:\/\/|\/$/g, '')}</button>`).join('\n')}
    </p>
    <p id="run-budget" class="muted" aria-live="polite"></p>
  </form>
  <div id="run-status" class="run-status" aria-live="polite"></div>
</section>
<script src="run-client.js" defer></script><!--/tier-c-->

<section aria-labelledby="code-h">
  <h2 id="code-h">Code and pull request</h2>
  <ul class="links">
    <li><a href="${REPO}">The repo on GitHub</a><p>Public from Nov 3. Clone it and run it on your own app.</p></li>
    <li><a href="${PR}">Pull request #2 on our fork of Argon Dashboard React</a><p>The rewrite with the verify table and the text pairs below AA, each with the token that controls it.</p></li>
  </ul>
</section>
</main>

<footer>
  <p>Open source under the Apache-2.0 license.</p>
  <p>Metatoy · Built for the Meta Global AI Developer Hackathon</p>
</footer>
</div>
</body>
</html>
`

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'index.html'), html)
// The review report and token files only; the rest of demo/argon-run is the live demo's run input (tier B).
const PUBLISHED = /^(report\.html|tokens\.css|tokens\.dtcg\.json|img(\/.*)?)$/
cpSync(join(root, 'demo/argon-run'), join(out, 'argon-run'), { recursive: true, filter: (src) => { const rel = src.slice(join(root, 'demo/argon-run').length + 1); return !rel || PUBLISHED.test(rel) } })
cpSync(join(root, 'demo/lightbootstrap-run'), join(out, 'lightbootstrap-run'), { recursive: true })
cpSync(join(root, 'demo/site-media'), join(out, 'media'), { recursive: true })
// The recorded Point and say take: the live page (tier B) shows it when the demo budget is used up.
cpSync(join(root, 'demo/media'), join(out, 'media'), { recursive: true })
// Tier C's form script (the form itself is only served when the server runs tier c).
cpSync(join(root, 'scripts/live/run-client.js'), join(out, 'run-client.js'))

const total = (d) => readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? total(join(d, e.name)) : statSync(join(d, e.name)).size), 0)
console.log(`site → ${out} (${(total(out) / 1024 / 1024).toFixed(1)} MB; evidence ${evidence.body.length} rows, breadth ${breadth.body.length} sites)`)
