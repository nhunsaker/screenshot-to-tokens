# Landscape — Screenshot to Tokens

Researched 2026-10-25, one day before hackathon API access opens. All findings are from public
pages found via web search (titles/dates as fetched; vendor claims, not independently verified).
Re-check anything load-bearing for the demo or README against the live product before quoting it
in front of judges.

## 1. Style auditing & extraction (read-only reports, no code change)

These crawl a live site or paste-in CSS and produce a report or a token file. None of them touch
the app's own source.

- **CSS Stats / Project Wallace** (`projectwallace.com/design-tokens`) — statically analyzes CSS
  (from a URL or pasted text) and extracts colors, font sizes/families, line heights, gradients,
  shadows, border radii, animation timing, as a report or a DTCG-ish token set. Runs in-browser,
  nothing leaves the client. Open source core (`@projectwallace/css-analyzer`), free web tool.
- **Superposition** (`superposition.design`) — drop in a URL, it extracts colors/typography/
  spacing/shadows/motion from the live page and exports to CSS, SCSS, JS, Figma, or an Adobe XD
  plugin. Free, cross-platform desktop app. Long-running (first blog post 2019); no code rewrite,
  no AI component found.
- **Specify** — was a design-token management platform (Figma/code sync, $69-168/mo). **Sunset
  2025-11-15**, no longer operating as of this research. Listed for completeness since it shows up
  in every "token tooling" comparison; dead as of today.
- **Browser extensions** — CSS Peeper (500k+ users, point-and-click style/color/asset inspection,
  no export to tokens) and Design Snap (newer, runs fully client-side, groups colors/type/radii/
  shadows by usage frequency plus a WCAG contrast audit). Both are human-driven inspection aids,
  not pipelines; no rewrite, no verification step.
- **Figma-import plugins** — html.to.design (‹div›RIOTS) rebuilds a whole live site as editable
  Figma layers, auto-creating Figma color/text styles and variables from what it finds; Builder.io
  Visual Copilot goes Figma→code (and vice versa) and claims to understand "your Figma components,
  design tokens, and documentation" when generating — but its primary input is a selected Figma
  frame, not an arbitrary live screenshot. Both operate one direction (web→design or design→code),
  neither closes the loop back into an existing app's source files.
- **Newer CLI/skill-shaped entrants (worth naming specifically, closest in spirit to us):**
  - **Dembrandt** (`github.com/dembrandt/dembrandt`, MIT, active) — Playwright-renders a live URL,
    reads computed styles, and emits tokens as DTCG JSON, a Tailwind theme, a shadcn/ui theme, an
    HTML report, or a brand-guide PDF. Has a `--compare` flag for drift-against-baseline and a
    `--screenshot` flag for viewport captures; an experimental `--ai` flag does ML-based
    brand-primary-color prediction. Ships an MCP server for Claude/Cursor/Windsurf. **Does not
    rewrite the source app** and the screenshot/compare features are for monitoring drift over
    time, not for proving a specific rewrite is safe.
  - **extract-design-tokens** (`github.com/humbleteam/extract-design-system`, MIT) — a Claude Code
    skill + CLI that takes a URL, screenshot, or CSS file and emits role-named (not value-named)
    CSS custom properties and DTCG JSON, explicitly marking anything it's not confident about as
    "not extracted" rather than guessing. LLM does the role-naming judgment; a deterministic skill
    layer enforces structure. No source rewrite, no visual verification, no PR.

**Takeaway for §1:** every one of these stops at a report or a standalone token file. None of them
go back into the app's actual `.css`/`.jsx`/`.vue` files and swap the literal for the token.

## 2. Token management (storage, sync, governance — assumes tokens already exist)

- **Tokens Studio** (Figma plugin) — the de facto standard for *authoring* tokens inside Figma:
  23 token types, JSON storage, sync to GitHub/GitLab/Azure DevOps/Bitbucket/Supernova. A human
  defines the tokens by hand; nothing here extracts them from a running app.
  - A paid **Tokens Studio Platform** (cloud sync) now sits alongside the free plugin.
- **Supernova** — "agentic design system platform," centralizes tokens/components/docs and
  exposes them to AI agents via MCP. Free tier (5 seats, 1 design system) up to a $35/seat/mo Pro
  tier. Consumes tokens from Figma/Storybook; doesn't extract from a live site.
- **zeroheight** — documentation/publishing layer for a design system (token tables, JSON view,
  inline mentions); authoring and extraction both happen elsewhere.
- **Knapsack** — similar space to zeroheight but leans on live connections to design + code so
  docs don't drift once tokens exist; still assumes the tokens already exist somewhere.
- **Figma Variables** — Figma's native token primitive (colors, numbers, strings, booleans,
  modes/themes) plus a growing plugin ecosystem (Design Token Export, Token Exporter, Figma Tokens
  Importer/Exporter) to get them to DTCG JSON/CSS/Tailwind. Still Figma-authored, not
  extracted-from-code-and-rewritten-back.

**Takeaway for §2:** this whole category answers "how do I store, sync, and document tokens I
already decided on," not "how do I find the tokens that are implicitly already in my CSS and
safely swap them in."

## 3. AI-assisted: codegen, lint enforcement, academic work, naive color clustering

- **Builder.io Visual Copilot, v0 (Vercel), Locofy, Anima** — all go from a Figma frame (or, for
  v0, a prompt/screenshot) to *new* generated code. Locofy and Anima both claim some mapping of
  Figma styles to CSS variables/design tokens in their output; v0 can read tokens from a Figma
  import but community reports (Vercel's own forum) say it doesn't reliably respect an existing
  custom token set when generating from scratch — it's a generator, not an in-repo retrofitter.
  None of the four take an already-hardcoded existing app and refactor its literals in place.
- **stylelint-declaration-strict-value** (and the broader "lint design-token usage" pattern,
  e.g. `@projectwallace`'s analyzer feeding a lint rule) — enforces that specific CSS properties
  use a variable/function/keyword instead of a raw value. This is detection-and-fail, wired into
  CI; it does not propose token names, cluster near-duplicate values, or rewrite anything itself —
  a human (or a separate codemod) still has to do the fix by hand.
- **Academic work** — closest hit is Apple ML's "Screen Parsing: Towards Reverse Engineering of UI
  Models from Screenshots" (Li et al., UIST 2021, `machinelearning.apple.com/research/screen-parsing`)
  — predicts UI hierarchy/element roles from a screenshot via NLP-style modeling, demonstrated for
  UI similarity search, accessibility, and code generation. It's about recovering *structure*
  (what element is this, what's its hierarchy), not about proposing a *tiered design-token system*
  with reasons, and it doesn't touch verification or rewriting. We found no paper specifically on
  "infer design tokens from a screenshot."
- **Naive color/palette clustering (GitHub)** — many small open-source CLIs (`paletteq`,
  `palette-extractor`, `Image-Palette-Extractor`, `color-palette-from-image`, etc.) run k-means or
  median-cut clustering over an image's pixels to pull out a dominant color palette. These operate
  on raw pixels with no DOM/CSS awareness, no concept of "button" vs. "background," no semantic
  naming, and no code integration — useful as a palette sketch, not a token pipeline.

**Takeaway for §3:** AI-assisted tools either generate brand-new UI (not retrofit an existing one)
or flag violations without fixing them. Nothing found proposes a reasoned, tiered token set *and*
rewrites the literals *and* proves the rewrite is visually safe.

## 4. Comparison table

| Tool | Input | Output | Rewrites source code | Verifies visually | Names tokens semantically | Pricing / OSS |
|---|---|---|---|---|---|---|
| CSS Stats / Project Wallace | Live URL or pasted CSS | Report + token JSON | No | No | By category, not role | Free, OSS core |
| Superposition | Live URL | CSS/SCSS/JS/Figma/XD export | No | No | By category | Free |
| Specify | Figma + code sync | Token platform | No | No | Yes (human-authored) | Sunset Nov 2025 |
| CSS Peeper / Design Snap | Live page (browser ext.) | Inspector panel / copy-paste | No | No | No | Free |
| html.to.design | Live site | Figma file + styles/variables | No (creates new Figma file) | No | Figma styles, not role-named | Free |
| Builder.io Visual Copilot | Figma frame | New framework code | No (generates new UI) | No | Uses existing tokens if present | Paid |
| Tokens Studio / Supernova / zeroheight / Knapsack / Figma Variables | Human-authored tokens (Figma/Storybook) | JSON, sync, docs | No (tokens pre-exist) | No | Yes, by hand | Free tier → paid SaaS |
| v0 / Locofy / Anima | Figma frame or prompt | New React/Vue/HTML code | No (new code, not a retrofit) | No | Sometimes, if Figma tokens exist | Paid |
| stylelint-declaration-strict-value | Existing CSS | Lint pass/fail in CI | No (flags only) | No | N/A | Free, OSS |
| Dembrandt | Live URL | DTCG/Tailwind/shadcn tokens, drift report, screenshots | No | Partial (baseline drift compare, not a rewrite-safety proof) | Yes, with evidence per pick | Free CLI, paid cloud app |
| extract-design-tokens (humbleteam) | URL, screenshot, or CSS | CSS vars + DTCG JSON | No | No | Yes, role-named | Free, OSS |
| **Screenshot to Tokens (ours)** | Live running app (screenshot + DOM, no source access needed) | Tiered token set (primitive/semantic/component) with reasons, rewritten `.css`/`.vue`/`.jsx`/SVG, a PR, a live Sorb preview | **Yes** — swaps literals for `var(--token, fallback)` in the real files | **Yes** — 3-check pixel diff (fallback-only must match baseline; drift-merged must stay under threshold) | Yes, tiered with a one-line reason per token, human-reviewable before merge | Hackathon build, offline stand-ins for every model step |

## 5. Positioning

**Three-sentence statement (for demo video + README):**

Every tool we found does one of two things: it reports on a website's styles, or it helps build
new UI from a design file. None of them look at a page that already has hardcoded colors and
spacing, work out which values are really the same thing drifted apart, and then rewrite the
app's own source files to use a token, proving with a pixel diff that the rewrite changes nothing. Screenshot to
Tokens closes that loop end to end, from a live running app to a human-reviewed pull request, with
proof before anyone merges.

**Two hardest judge questions:**

1. *"Dembrandt already extracts tokens from a live URL and detects drift against a baseline. What
   do you do that it doesn't?"* Honest answer: Dembrandt extracts and reports; it never touches the
   target app's own source files, and its drift compare is for monitoring a site over time, not
   for proving a specific merge is safe. We rewrite the real `.css`/`.jsx`/`.vue`/SVG files in
   place and run a verify step (fallback-only pixel match, then drift-merged-under-threshold)
   before a human approves the PR. Dembrandt tells you something changed; we tell you a specific
   fix didn't break anything, then let a person merge it.
2. *"Why use a vision-segmentation model (SAM 3.1) at all? Isn't reading the DOM and computed
   styles more reliable than a model guessing at pixels?"* Honest answer: for a well-structured
   HTML/CSS app, DOM reading alone gets most of the way there, and that's exactly our `mock`
   segmenter (DOM boxes) used for the offline demo — segmentation doesn't invent information the
   DOM doesn't have in that case. SAM 3.1 earns its place where DOM structure doesn't map cleanly
   to what a person sees: canvas-rendered UI, inline SVG with no semantic markup, screenshots from
   design tools, or any app whose DOM is too generic (divs on divs) to tell a button from a card.
   It's the layer that lets the pipeline generalize past "well-behaved React app."

## Sources

- https://www.projectwallace.com/design-tokens
- https://www.projectwallace.com/
- https://www.npmjs.com/package/@projectwallace/css-analyzer
- https://superposition.design/support/
- https://kilianvalkhof.com/2019/design/superposition-use-the-design-system-you-already-have/
- https://alternativeto.net/software/specify/about/ (Specify sunset date)
- https://chrome-stats.com/d/css-peeper?hl=en
- https://designsnap.dev/
- https://html.to.design/blog/from-web-to-figma/
- https://www.figma.com/community/plugin/1159123024924461424/html-to-design-by-divriots-import-websites-to-figma-designs-web-html-css
- https://www.builder.io/c/docs/design-tokens
- https://www.builder.io/blog/best-figma-to-code-plugin
- https://github.com/dembrandt/dembrandt
- https://github.com/humbleteam/extract-design-system
- https://github.com/tokens-studio/figma-plugin
- https://tokens.studio/studio-platform
- https://www.supernova.io/pricing
- https://www.supernova.io/supernova-tokens-studio
- https://www.knapsack.cloud/knapsack-vs-zeroheight
- https://help.zeroheight.com/hc/en-us/articles/35886930025755-Documenting-design-tokens
- https://atomize.tools/blog/figma-variables-guide/
- https://www.figma.com/community/plugin/1612168675581720192/design-token-export
- https://www.figma.com/community/plugin/1521741753717588633/token-exporter
- https://github.com/AndyOGo/stylelint-declaration-strict-value
- https://www.snapflow.design/en/blog/figma-to-code-tools-compared
- https://community.vercel.com/t/v0-to-respect-existing-tokens-components/22871
- https://machinelearning.apple.com/research/screen-parsing
- https://dl.acm.org/doi/fullHtml/10.1145/3472749.3474763
- https://github.com/v01dst/paletteq
- https://github.com/ronaksoltani/palette-extractor
- https://github.com/0xelitesystem/color-palette-from-image
