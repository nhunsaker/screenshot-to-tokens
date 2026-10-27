// Dark mode as a token file (`s2t dark --run <dir>`). The L11 playground logic, moved out of the page:
//   1. Open the tokenized app (tokens.css loaded) in a headless browser and check every captured text pair (light).
//   2. Muse Spark proposes dark values for the color tokens (semantic, component, on-surface; new primitives allowed).
//   3. Check every pair again with the proposal applied. If anything fixable fails, or most text is not on a dark
//      background, one automatic retry with that fed back. The round with the fewest failures that is dark is kept.
//   4. Write tokens.dark.css (prefers-color-scheme + [data-theme="dark"]), check that file itself, screenshot dark.png.
// Pure helpers are exported for tests; runDark does the I/O. Data sent to the model: token names, color values and
// contrast numbers only (class C). The API key stays in this process (Keychain via config.js) and is never printed.
import { readFileSync, writeFileSync, existsSync, copyFileSync, appendFileSync } from 'fs'
import { join, resolve, relative, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { playgroundData, readRun, cleanMuseRequest, museMessages, museProviders } from './playground.js'
import { chat, extractJson } from '../providers/llm/chat.js'
import {
  sanitizeProposal, splitFailures, dominantBackground, groupFailures, tokensForColor, parseColor, luminance, round2, UNSAFE,
} from '../preview-client/contrast.js'

const CONTRAST_JS = join(dirname(fileURLToPath(import.meta.url)), '../preview-client/contrast.js')

/** Text on a background with relative luminance at most this counts as "on a dark background" (same as contrast.js). */
export const DARK_LUMINANCE = 0.12

// ---- pure helpers -------------------------------------------------------------------------------------------------

/** Pass/fail counts of one audit (results from contrast.js auditLive). */
export function tally(results) {
  const checked = results.filter((r) => r.status === 'pass' || r.status === 'fail')
  const fail = checked.filter((r) => r.status === 'fail').length
  const skipped = {}
  for (const r of results) if (r.status !== 'pass' && r.status !== 'fail') skipped[r.status] = (skipped[r.status] || 0) + 1
  return { checked: checked.length, pass: checked.length - fail, fail, skipped }
}

/** Share of checked text that sits on a dark background (luminance <= 0.12). */
export function darkShare(results) {
  const checked = results.filter((r) => (r.status === 'pass' || r.status === 'fail') && r.bg)
  if (!checked.length) return 0
  const dark = checked.filter((r) => { const c = parseColor(r.bg); return c && luminance(c) <= DARK_LUMINANCE }).length
  return round2(dark / checked.length)
}

/** Most common LIGHT background under checked text (what the retry is told stayed light). */
export function mainLightBackground(results) {
  const n = {}
  for (const r of results) {
    if ((r.status !== 'pass' && r.status !== 'fail') || !r.bg) continue
    const c = parseColor(r.bg)
    if (c && luminance(c) > DARK_LUMINANCE) n[r.bg] = (n[r.bg] || 0) + 1
  }
  const k = Object.keys(n).sort((a, b) => n[b] - n[a])
  return k[0] || null
}

/**
 * Failure groups (or context pairs) with the tokens behind each side; the shape museMessages reads.
 * Tokens are found by value in the LIGHT theme (`light`: id -> light result), so a dark-theme failure still names the
 * token that controls it. A side the tokens do not reach (`reach`, from reachOf) gets no tokens: the prompt then says
 * "no token", and the model knows that surface or text stays as it is.
 * @param {Array<{fg:string,bg:string,gradient?:boolean,ids?:string[]}>} groups
 * @param {Array<{name:string,tier:string,value:string}>} tokenValues
 * @param {{reach?:Record<string,{fg:boolean,bg:boolean}>|null, light?:Record<string,any>|null}} [ctx]
 */
export function withTokens(groups, tokenValues, ctx = {}) {
  const reach = ctx.reach || null, light = ctx.light || null
  return groups.map((g) => {
    const ids = g.ids || []
    const all = (side) => !reach || !ids.length || ids.every((id) => !reach[id] || reach[id][side])
    const was = (side) => { const r = light && ids.length && light[ids[0]]; return r && r[side] ? r[side] : g[side] }
    return {
      examples: g.examples, count: g.count, fg: g.fg, bg: g.bg, ratio: g.ratio, required: g.required,
      fgTokens: all('fg') ? tokensForColor(was('fg'), tokenValues).slice(0, 4) : [],
      bgTokens: g.gradient || !all('bg') ? [] : tokensForColor(was('bg'), tokenValues).slice(0, 4),
      gradient: !!g.gradient,
    }
  })
}

/** Every checked pairing in the light theme, most common first (capped at 40): the model's context. */
export function contextPairs(lightResults, tokenValues, reach = null) {
  const all = {}
  for (const r of lightResults) {
    if (r.status !== 'pass' && r.status !== 'fail') continue
    const k = r.fg + '|' + r.bg + '|' + r.required
    const g = all[k] || (all[k] = { fg: r.fg, bg: r.bg, gradient: !!r.gradient, ratio: r.ratio, required: r.required, large: r.large, count: 0, examples: [], ids: [] })
    g.count++
    g.ids.push(r.id)
    if (g.examples.length < 2) g.examples.push(r.text)
  }
  return withTokens(Object.keys(all).map((k) => all[k]).sort((a, b) => b.count - a.count).slice(0, 40), tokenValues, { reach })
}

/**
 * Which side of each pair the tokens reach: compare the light audit with one where every color token is set to a
 * probe color. A side that does not move is a literal the rewrite did not tokenize (or a color from a script), so
 * no token change can fix it; those failures are reported apart and kept out of the model's feedback.
 * @returns {Record<string, {fg:boolean, bg:boolean}>}
 */
export function reachOf(light, probe) {
  const p = {}
  for (const r of probe) p[r.id] = r
  const out = {}
  for (const r of light) {
    const q = p[r.id]
    if (!q || !r.fg || !q.fg) continue
    out[r.id] = { fg: q.fg !== r.fg, bg: q.bg !== r.bg }
  }
  return out
}

/** Probe color for reachOf (unlikely to be a real value). */
export const PROBE = '#010203'

/**
 * One round's verdict with its changes applied. Dark = at least half the checked text sits on a dark background
 * (L11 found a model can answer with a light theme; that is rejected however well it scores). Failures split three
 * ways: on a gradient (no token controls it), untokenized (the text color does not move with the tokens: in a dark
 * theme the only "fix" would be to keep its surface light), and fixable.
 */
export function judgeDark(results, tokenValues, reach = null, light = null) {
  const split = splitFailures(results)
  const stuck = (r) => !!(reach && reach[r.id] && !reach[r.id].fg)
  const fixable = split.fixable.filter((r) => !stuck(r))
  const share = darkShare(results)
  return {
    ...tally(results),
    fixable: fixable.length, onGradient: split.gradient.length, untokenized: split.fixable.length - fixable.length,
    dominant: dominantBackground(results), darkShare: share, dark: share >= 0.5,
    lightBg: share >= 0.5 ? null : mainLightBackground(results),
    feedback: withTokens(groupFailures(fixable), tokenValues, { reach, light }),
  }
}

/**
 * Lower is better: a round that is not dark loses to any dark one, then fewer failing pairs (all of them: a proposal
 * can also push text on a fixed color below AA), then fewer fixable ones.
 */
export const rankRound = (j) => (j.dark ? 0 : 1e6) + (j.fail || 0) * 1000 + j.fixable

/** Best round (first on ties: the retry is not assumed better). */
export function pickBest(rounds) {
  return rounds.reduce((best, x) => (rankRound(x.judge) < rankRound(best.judge) ? x : best), rounds[0])
}

/** Prompt note: sides marked "no token" were measured not to move with the tokens (reachOf). */
export const LITERAL_NOTE = '\n\nA text or background marked [no token] is a fixed color in the page CSS: it keeps its light-theme value in the dark theme, whatever you change. Text that sits on a fixed light background must stay dark enough to read on it; do not count on that background turning dark.'

/**
 * Prompt note naming the background tokens under most of the text (from the context pairs), so the model darkens
 * those first. On proinsias (2026-10-27) 5 of 12 answers without it left the main surface light; 0 of 4 with it.
 */
export function surfaceNote(pairs) {
  const n = {}
  for (const p of pairs) if (!p.gradient && p.bgTokens.length) n[p.bgTokens[0]] = (n[p.bgTokens[0]] || 0) + p.count
  const top = Object.keys(n).sort((a, b) => n[b] - n[a]).slice(0, 4)
  if (!top.length) return ''
  return `\n\nMost text sits on these background tokens: ${top.map((k) => `${k} (${n[k]} pairs)`).join(', ')}. Each of them must get a dark value (or point at a dark token); keep the text tokens on them light.`
}

/** Extra prompt lines for on-surface text tokens (L13: color.text.on-primary, on-dark, inverse). */
export function onSurfaceNote(tokens) {
  const on = tokens.filter((t) => /^color\.text\.(on-|inverse$)/.test(t.name)).map((t) => t.name)
  if (!on.length) return ''
  return `\n\nOn-surface text tokens (text that sits on a colored or dark surface, not the page): ${on.join(', ')}. Pick each so it reads on the surface it sits on in the dark theme; do not darken them just because the page text gets lighter.`
}

/** CSS declarations for a proposal: new primitives first, then the rest in proposal order. */
function decls(changes, indent) {
  const sorted = changes.filter((c) => c.isNew).concat(changes.filter((c) => !c.isNew))
  return sorted.filter((c) => /^[a-z0-9-]+$/.test(c.cssVar) && !UNSAFE.test(c.css)).map((c) => `${indent}--${c.cssVar}: ${c.css};`).join('\n')
}

/**
 * tokens.dark.css: the dark values under the system preference (unless the page opts out with data-theme="light")
 * and under an explicit data-theme="dark" (a toggle). Load it after tokens.css.
 */
export function darkCss(changes, { note = '' } = {}) {
  return [
    `/* Dark theme for tokens.css, generated by screenshot-to-tokens${note ? ` (${note})` : ''}. Review before merging. */`,
    '/* Load after tokens.css. Follows the system setting; data-theme="light" or "dark" on <html> overrides it. */',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    decls(changes, '    '),
    '  }',
    '}',
    ':root[data-theme="dark"] {',
    decls(changes, '  '),
    '}',
    '',
  ].join('\n')
}

/** The same values as a plain :root block (forces dark for the screenshot regardless of media or attribute). */
export function forcedDarkCss(changes) {
  return `:root {\n${decls(changes, '  ')}\n}\n`
}

/** Folder that serves the tokenized app for a run: run/site when only part of a served site was rewritten. */
export function siteDirOf(runDir, runMeta, rewrite) {
  if (runMeta.serve && runMeta.target && resolve(runMeta.target) !== resolve(runMeta.serve)) return join(runDir, 'site')
  // A copied run folder keeps the absolute outDir of the original; prefer the copy's own rewritten/ folder.
  if (existsSync(join(runDir, 'rewritten'))) return join(runDir, 'rewritten')
  return rewrite.outDir
}

/**
 * Ask one Muse Spark provider (no fallback). Returns the sanitized proposal plus timing.
 * @param {object} req cleaned request (cleanMuseRequest)
 * @param {Set<string>} known
 * @param {{id:string, baseURL:string, apiKey:string, model:string}} p
 */
export async function askProvider(req, known, p, { chatFn = chat, extra = '' } = {}) {
  if (/-contributor$/i.test(p.model)) throw new Error(`${p.id}: refusing a -contributor model`)
  const messages = museMessages(req)
  if (extra) messages[1] = { ...messages[1], content: messages[1].content + extra }
  const t0 = Date.now()
  try {
    const r = await chatFn({ baseURL: p.baseURL, apiKey: p.apiKey, model: p.model, messages, json: true, reasoningEffort: 'low', timeoutMs: 90000 })
    const out = sanitizeProposal(extractJson(r.text), { known: Array.from(known), allowNew: true, allowAlias: true })
    return { ...out, provider: p.id, model: p.model, ms: Date.now() - t0, cached: !!r.cached, usage: r.usage || null }
  } catch (e) {
    // Status + short body only; never the key.
    throw new Error(`${p.id}: ${String(e.message || e).slice(0, 160)}`)
  }
}

/**
 * The dark loop for one provider: propose, check, one retry with the failures fed back, keep the better round.
 * @param {{tokenValues:Array<{name:string,tier:string,cssVar:string,alias?:string|null,value:string}>, light:any[],
 *   known:Set<string>, audit:(changes:any[])=>Promise<any[]>, ask:(req:object)=>Promise<any>, reach?:object|null, log?:(s:string)=>void}} o
 */
export async function darkLoop(o) {
  const log = o.log || (() => {})
  const pairs = contextPairs(o.light, o.tokenValues, o.reach)
  const lightById = {}
  for (const r of o.light) lightById[r.id] = r
  const base = { task: 'dark', tokens: o.tokenValues, pairs }
  const r1 = await o.ask(cleanMuseRequest(base, o.known))
  const j1 = judgeDark(await o.audit(r1.changes), o.tokenValues, o.reach, lightById)
  log(`${r1.provider} first try: ${r1.changes.length} changes, ${j1.pass}/${j1.checked} pass, ${j1.fixable} fixable failing, ${j1.onGradient} on a gradient, ${j1.untokenized} untokenized, ${Math.round(j1.darkShare * 100)}% of text on dark (${r1.cached ? 'cached' : (r1.ms / 1000).toFixed(1) + ' s'})`)
  const rounds = [{ proposal: r1, judge: j1 }]
  if (!(j1.dark && !j1.fixable) && r1.changes.length) {
    const retry = cleanMuseRequest({
      ...base, previous: r1.changes.map((c) => ({ token: c.token, value: c.css })), failures: j1.feedback, notDarkBg: j1.dark ? null : j1.lightBg,
    }, o.known)
    // cleanMuseRequest keeps only color.* names in `previous`; component tokens (button.bg) belong there too.
    // These came out of sanitizeProposal, so names are known tokens and values are safe.
    retry.previous = r1.changes.map((c) => ({ token: c.token, value: c.css }))
    const r2 = await o.ask(retry)
    const j2 = judgeDark(await o.audit(r2.changes), o.tokenValues, o.reach, lightById)
    log(`${r2.provider} retry: ${r2.changes.length} changes, ${j2.pass}/${j2.checked} pass, ${j2.fixable} fixable failing, ${j2.onGradient} on a gradient, ${j2.untokenized} untokenized, ${Math.round(j2.darkShare * 100)}% of text on dark (${r2.cached ? 'cached' : (r2.ms / 1000).toFixed(1) + ' s'})`)
    rounds.push({ proposal: r2, judge: j2 })
  }
  const best = pickBest(rounds)
  return { rounds, best, kept: rounds.indexOf(best) }
}

/** Compact record of a round for dark.json (no feedback blobs). */
export function roundSummary(x) {
  const j = x.judge, p = x.proposal
  return {
    provider: p.provider, model: p.model, ms: p.ms, cached: p.cached, changes: p.changes.length, rejected: p.rejected,
    checked: j.checked, pass: j.pass, fail: j.fail, fixable: j.fixable, onGradient: j.onGradient, untokenized: j.untokenized,
    darkShare: j.darkShare, dark: j.dark, dominantBg: j.dominant, summary: p.summary,
  }
}

/** Winner across providers: lowest rank; ties keep the earlier (default) provider. */
export function pickProvider(results) {
  return results.reduce((w, r) => (rankRound(r.best.judge) < rankRound(w.best.judge) ? r : w), results[0])
}

/** Markdown section for the PR body (tokens.dark.css is an optional file). */
export function darkPrSection(dark, fileRel) {
  if (!dark || !dark.after) return ''
  const b = dark.before, a = dark.after
  const w = dark.winner
  return [
    '',
    '## Dark theme (optional file)',
    '',
    `\`${fileRel}\` holds dark values for ${dark.changes.length} color tokens, proposed by ${w.label} and checked here before this PR. Load it after tokens.css; it follows the system setting, and \`data-theme="light"\` or \`"dark"\` on \`<html>\` overrides it. Delete the file to ship without a dark theme.`,
    '',
    '| Text contrast (WCAG 2.x AA, captured route) | Pairs passing |',
    '|---|---|',
    `| Light theme (tokens.css) | ${b.pass} of ${b.checked} |`,
    `| Dark theme (tokens.dark.css) | ${a.pass} of ${a.checked} |`,
    '',
    `In the dark theme, ${Math.round(a.darkShare * 100)}% of the checked text sits on a dark background.${a.onGradient ? ` ${a.onGradient} failing pair${a.onGradient === 1 ? '' : 's'} sit on a gradient, which is not a token.` : ''}${a.untokenized ? ` ${a.untokenized} fail because their text color is a literal that is not a token yet.` : ''} Only text contrast is checked: not hover or focus states, placeholders, icons or other non-text contrast.`,
    '',
  ].join('\n')
}

/**
 * Copy tokens.dark.css next to tokens.css in the app repo and append its PR section to the body file.
 * No-op (returns null) when the run has no dark theme. Called once from pr.js.
 */
export function includeDarkInPr(runDir, tokensCssPath, repoDir, bodyPath) {
  const css = join(runDir, 'tokens.dark.css')
  const meta = join(runDir, 'dark.json')
  if (!existsSync(css) || !existsSync(meta)) return null
  const dest = join(dirname(tokensCssPath), 'tokens.dark.css')
  copyFileSync(css, dest)
  const rel = relative(repoDir, dest)
  appendFileSync(bodyPath, darkPrSection(JSON.parse(readFileSync(meta, 'utf-8')), rel))
  return rel
}

const LABEL = { baseten: 'Muse Spark Open on Baseten', meta: 'Muse Spark 1.3 (Meta)' }

// ---- browser ------------------------------------------------------------------------------------------------------

/** contrast.js as a classic script that sets window.__s2tContrast (the page has no module loader for it). */
export function contrastScript(src = readFileSync(CONTRAST_JS, 'utf-8')) {
  const body = src.replace(/^export (function|const) /gm, '$1 ')
  return `window.__s2tContrast = (function () {\n${body}\nreturn { auditLive: auditLive }\n})()`
}

/**
 * Run the dark stage on a run folder.
 * @param {{runDir:string, provider?:'baseten'|'meta'|'both', chatFn?:Function, log?:(s:string)=>void, screenshot?:boolean}} o
 */
export async function runDark(o) {
  const runDir = resolve(o.runDir)
  const log = o.log || (() => {})
  const rd = (n) => JSON.parse(readFileSync(join(runDir, `${n}.json`), 'utf-8'))
  for (const f of ['tokens.json', 'clusters.json', 'capture.json', 'tokens.css', 'rewrite.json', 'run.json']) {
    if (!existsSync(join(runDir, f))) throw new Error(`dark needs ${f} in ${runDir}`)
  }
  const run = readRun(runDir)
  const data = playgroundData(run)
  const capture = run.capture
  const colorTokens = data.tokens.filter((t) => t.kind === 'color')
  const known = new Set(colorTokens.map((t) => t.name))
  if (!data.pairs.length) throw new Error('no text pairs in capture.json; nothing to check')
  const siteDir = siteDirOf(runDir, rd('run'), rd('rewrite'))
  if (!siteDir || !existsSync(siteDir)) throw new Error(`no tokenized site at ${siteDir} (run verify first)`)
  const tokensCss = readFileSync(join(runDir, 'tokens.css'), 'utf-8')

  const which = o.provider === 'both' ? ['baseten', 'meta'] : [o.provider === 'meta' ? 'meta' : 'baseten']
  const available = museProviders('baseten')
  const providers = which.map((id) => available.find((p) => p.id === id)).filter(Boolean)
  if (!providers.length) throw new Error(`no Muse Spark key for ${which.join(' or ')} in the Keychain or env`)
  if (providers.length < which.length) log(`skipping ${which.filter((id) => !providers.find((p) => p.id === id)).join(', ')}: no key`)

  const { serveDir } = await import('../lib/serve.js')
  const { chromium } = await import('playwright')
  const { LAUNCH, newPage, loadImages, settle, screenshotUrl } = await import('./capture.js')
  const server = await serveDir(siteDir)
  const browser = await chromium.launch(LAUNCH)
  const t0 = Date.now()
  try {
    const page = await newPage(browser, capture.viewport)
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
    await page.addStyleTag({ content: tokensCss })
    await loadImages(page)
    await settle(page)
    await page.addScriptTag({ content: contrastScript() })

    // Set the changes as custom properties on <html>, check every pair, put everything back.
    // Rounds are checked with the values as a plain :root stylesheet after tokens.css (the same CSS dark.png uses).
    const audit = (changes) => page.evaluate(([css, pairs]) => {
      const el = document.createElement('style')
      el.textContent = css
      document.head.appendChild(el)
      try { return window.__s2tContrast.auditLive(document, pairs) } finally { el.remove() }
    }, [changes.length ? forcedDarkCss(changes) : '', data.pairs])
    const tokenValues = await page.evaluate((ts) => {
      const cs = getComputedStyle(document.documentElement)
      return ts.map((t) => ({ name: t.name, cssVar: t.cssVar, tier: t.tier, alias: t.alias, value: cs.getPropertyValue('--' + t.cssVar).trim() }))
    }, colorTokens)

    const light = await audit([])
    const before = tally(light)
    const reach = reachOf(light, await audit(colorTokens.map((t) => ({ cssVar: t.cssVar, css: PROBE }))))
    const ids = Object.keys(reach)
    before.tokenReach = { both: ids.filter((k) => reach[k].fg && reach[k].bg).length, textOnly: ids.filter((k) => reach[k].fg && !reach[k].bg).length, bgOnly: ids.filter((k) => !reach[k].fg && reach[k].bg).length, neither: ids.filter((k) => !reach[k].fg && !reach[k].bg).length }
    log(`light theme: ${before.pass} of ${before.checked} text pairs pass (${data.pairs.length} captured); tokens reach text and background of ${before.tokenReach.both}, text only ${before.tokenReach.textOnly}, background only ${before.tokenReach.bgOnly}, neither ${before.tokenReach.neither}`)

    const extra = surfaceNote(contextPairs(light, tokenValues, reach)) + LITERAL_NOTE + onSurfaceNote(colorTokens)
    const perProvider = []
    for (const p of providers) {
      let ask = (req) => askProvider(req, known, p, { chatFn: o.chatFn, extra })
      // Single-provider mode keeps the playground's behaviour: the other Muse Spark is the fallback.
      if (which.length === 1) {
        const fallback = available.find((x) => x.id !== p.id)
        const first = ask
        ask = (req) => first(req).catch((e) => {
          if (!fallback) throw e
          log(`${e.message.slice(0, 120)}; falling back to ${fallback.id}`)
          return askProvider(req, known, fallback, { chatFn: o.chatFn, extra })
        })
      }
      try {
        const r = await darkLoop({ tokenValues, light, known, audit, ask, reach, log })
        perProvider.push({ id: p.id, ...r })
      } catch (e) {
        log(`${p.id} failed: ${String(e.message || e).slice(0, 200)}`)
        perProvider.push({ id: p.id, error: String(e.message || e).slice(0, 200) })
      }
    }
    const ok = perProvider.filter((r) => r.best)
    if (!ok.length) throw new Error(`no provider answered: ${perProvider.map((r) => r.error).join(' | ')}`)
    const win = pickProvider(ok)
    const best = win.best
    const changes = best.proposal.changes
    const record = {
      run: basename(runDir), pairs: data.pairs.length, tokens: colorTokens.length,
      onSurfaceTokens: colorTokens.filter((t) => /^color\.text\.(on-|inverse$)/.test(t.name)).map((t) => t.name),
      before,
      providers: perProvider.map((r) => r.best
        ? { id: r.id, label: LABEL[r.id], rounds: r.rounds.map(roundSummary), kept: r.kept, rank: rankRound(r.best.judge), totalMs: r.rounds.reduce((n, x) => n + x.proposal.ms, 0) }
        : { id: r.id, label: LABEL[r.id], error: r.error }),
      winner: { id: win.id, label: LABEL[best.proposal.provider] || best.proposal.provider, answeredBy: best.proposal.provider, model: best.proposal.model, round: win.kept === 0 ? 'first try' : 'retry' },
      changes: changes.map((c) => ({ token: c.token, cssVar: c.cssVar, value: c.css, isNew: c.isNew, reason: c.reason })),
    }

    if (!best.judge.dark) {
      record.rejected = `not a dark theme: ${Math.round(best.judge.darkShare * 100)}% of the checked text sits on a dark background`
      writeFileSync(join(runDir, 'dark.json'), JSON.stringify(record, null, 2))
      throw new Error(`${record.rejected}; no tokens.dark.css written (see dark.json)`)
    }

    // Check the file itself: tokens.dark.css loaded, data-theme="dark" on <html>, no inline overrides.
    const css = darkCss(changes, { note: `${record.winner.label}, ${record.winner.round}` })
    writeFileSync(join(runDir, 'tokens.dark.css'), css)
    await page.addStyleTag({ content: css })
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
    const final = await audit([])
    const after = judgeDark(final, tokenValues, reach)
    // A site with its own [data-theme="dark"] rules reacts to the attribute too; say so when the file check differs.
    if (after.pass !== best.judge.pass) {
      record.attributeNote = `with data-theme="dark" set, ${after.pass} pass vs ${best.judge.pass} with the values alone: the site's own CSS also reacts to data-theme`
      log(`note: ${record.attributeNote}`)
    }
    delete after.feedback
    record.after = after
    const stuck = (id) => !!(reach[id] && !reach[id].fg)
    // The pairs a token theme can actually steer: text color is a token (the rest is reported, not blamed on Muse).
    const steer = (rs) => tally(rs.filter((r) => reach[r.id] && reach[r.id].fg))
    record.textTokenized = { before: steer(light), after: steer(final) }
    record.failingAfter = groupFailures(final).map((g) => ({ fg: g.fg, bg: g.bg, ratio: g.ratio, required: g.required, gradient: g.gradient, untokenized: g.ids.every(stuck), count: g.count, examples: g.examples }))
    log(`dark theme (tokens.dark.css, ${record.winner.label}, ${record.winner.round}): ${after.pass} of ${after.checked} pass; ${after.fixable} fixable failing, ${after.onGradient} on a gradient, ${after.untokenized} untokenized; ${Math.round(after.darkShare * 100)}% of text on dark`)

    if (o.screenshot !== false) {
      await screenshotUrl(server.url, join(runDir, 'dark.png'), capture.viewport, tokensCss + '\n' + forcedDarkCss(changes))
      record.screenshot = 'dark.png'
    }
    record.totalMs = Date.now() - t0
    record.checkedAt = new Date().toISOString()
    writeFileSync(join(runDir, 'dark.json'), JSON.stringify(record, null, 2))
    return record
  } finally {
    await browser.close()
    await server.close()
  }
}
