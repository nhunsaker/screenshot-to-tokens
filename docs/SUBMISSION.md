# Submission: Screenshot to Tokens

Meta Global AI Developer Hackathon, Oct 26 – Nov 4, 2026.

## One-line pitch

Point it at a running app with no design tokens. It captures the page, finds the colors and
spacing that drifted apart by accident, proposes a reasoned token set, rewrites the real source
files to use it, proves with a pixel diff that the rewrite itself changes nothing, and shows exactly
what the cleanup changes, before a human merges anything.

## What existed before the hackathon, and what is new

The rules ask every entrant to separate pre-existing work from hackathon work. Here is the line, and the git history
shows it exactly.

**Before the building period (tag `pre-event-baseline`, built Oct 25, 2026):** the pipeline scaffold with an offline
stand-in for every Meta model. That covers capture, a DOM-based mock segmenter, clustering, a heuristic namer and validator,
the rewrite, the three-check verify, the HTML report with review, the CLI, two test fixtures and the test suite. It depends
only on the published `@sorb/seed` package; Sorb itself is Metatoy's existing product and is not part of this repo.

**Built during the hackathon (Oct 26 to Nov 4, every commit after `pre-event-baseline`):** everything that uses Meta's
models, and every feature shown in the demo video. _(Filled in as work lands; see `git log pre-event-baseline..HEAD`.)_

## The problem

One person, one moment: a design engineer inherits a React app with zero design tokens. Every
color and radius is typed by hand. Five buttons use five almost-identical blues because three
different people copy-pasted one over two years, and nobody can tell you which ones are supposed
to match. She does not have time to grep every CSS file by hand, and she will not trust a rewrite
she cannot verify. That is the moment this tool is built for.

## How it works

See `docs/architecture.svg` for the full diagram. In short:

A running app gets **captured** (Playwright: full-page screenshot plus computed styles per
element). The screenshot is **segmented** into UI regions, button, card, input, nav, using SAM
3.1, with a vision-model fallback and a DOM-derived mock for offline runs. Each style value is
**joined** to the smallest region that contains it, then **clustered**: near-duplicate colors
merge by ΔE in Lab space, near-duplicate sizes merge by a pixel/percent tolerance. The clusters go
to **naming**: Muse Spark proposes a tiered token set (primitive, semantic, component) with a
one-line reason per token, and deterministic code validates the result, one primitive per cluster,
aliases that resolve, no cycles, before anything downstream sees it. A person **reviews** the
proposal and can accept, rename, reject, or merge any token. Approved tokens are **emitted** as
`tokens.css` and a DTCG JSON file, then used to **rewrite** the literals in the real source,
plain CSS, Vue `<style>` blocks, JSX/styled-components, and inline SVG `fill`/`stroke`, to
`var(--token, fallback)`, keeping the original value as the fallback. The rewrite is **verified**
with a three-way pixel diff before it ever reaches a **pull request**. A side branch lets the same
tokens drive a live preview in a running app through Sorb, with no rebuild.

The model proposes; deterministic code guarantees the shape. If a model call fails, the pipeline
falls back to a heuristic and records a warning rather than failing silently.

## Built with Meta models

- **SAM 3.1** (segmentation). The screenshot is sent with short, open-vocabulary noun-phrase
  prompts, "button," "card," "nav bar," "input," one call per concept, to get back boxes/masks
  for each UI region. This is the `S2T_SEGMENTER=meta` provider in `src/providers/segment/meta-sam.js`.
  A DOM-derived mock and a vision-model fallback stand in for it offline.
- **Muse Spark** (naming, validated). Given the clusters and a heuristic first draft, Muse Spark
  proposes the final token names, tiers, and a one-line reason per token. Deterministic code
  (`validateTokenSet`) checks every proposal before it is used: one primitive per cluster, aliases
  resolve without cycles, and primitive values match what was actually captured. The model never
  gets the final say on shape, only on naming.
- **Muse Code** (PR, if real). The plan was for Muse Code to open the pull request from the
  rewrite's edit plan. We found no documented headless API or scriptable CLI for it before access
  day, so the PR step is deterministic (`git` + `gh`) unless that changes. *[placeholder: update
  this section after Oct 26 if Muse Code turns out to have a real scriptable surface we used.]*

## What was proven (2026-10-25, offline, before API access)

Everything below ran against this repo's offline stand-in providers (a DOM-derived mock segmenter,
a usage-driven heuristic namer), not the real SAM 3.1 or Muse Spark. Numbers are copied as-measured,
not rounded up.

| Check | Result |
|---|---|
| Fixture (`acme-shop`, planted drift) full pipeline | 3 s; 43 distinct values → 33 clusters; 127 edits in CSS + inline SVG |
| Verify on fixture | fallbacks only **0 px**; colors merged **0.000%**; all tokens **1.7%** (spacing merges, flagged for review) |
| Eval vs hand-written golden set | **20/21** as proposed; **21/21** after one human-accepted merge suggestion (6 px radius into 4 px) in review |
| Real site (StartBootstrap Agency, MIT license, `--serve dist --target dist/css`) | 6 s; 123 edits; fallbacks **0 px**; colors **0.000%**; all tokens **3.7%** |
| Live Sorb preview (published `@sorb/juice` 0.3.0 + `src/preview-client/sorb-preview.js`) | one `s2t preview` call turned every button, badge, link, logo, and SVG illustration orange, no rebuild |
| Fake Meta API contract test | Muse Spark chat shape and the SAM 3.1 token-stream shape drive the real providers (tiling, scaling, repair) |
| Review loop (`review.json` → `s2t review`) | rename follows aliases, reject drops the token, rewrite and verify rerun correctly |

*[placeholder: real SAM 3.1 and Muse Spark numbers from Oct 26+ go here once access-day testing
runs, segmentation recall vs the DOM oracle (`s2t segeval`), and a namer score vs the golden set,
replacing or sitting alongside the offline numbers above.]*

## What's honest about the limits

- **SAM on UI screenshots is unproven.** We found no published use of SAM, any version, on app UI
  screenshots. Buttons, cards, and photo-like images are the regions most likely to work; icons,
  badges, and links are the regions most likely to come back weak or missing, because they are
  small, flat, and low on the texture SAM relies on. The go/no-go gate (`s2t segeval`) checks
  button/input/card/nav recall at 60% and treats icon/badge/link as known-weak, non-blocking
  categories rather than pretending they will work.
- **Icons and badges are the weak spot industry-wide, not just for us.** Published GUI-grounding
  benchmarks put icon-target accuracy far below text-target accuracy for vision models in general.
  We expect the same pattern here.
- **Fallbacks exist because we expect to need them.** If SAM's day-1 recall is too low to demo
  live, the pipeline falls back to the DOM-derived mock segmenter and the SAM numbers are shown as
  evidence of what is needed next, not hidden. If Muse Spark naming is unavailable or fails, a
  local heuristic draft covers it, with a warning, not a silent substitution.
- **Everything marked MOCK stays marked MOCK.** The report page carries a visible badge whenever a
  stand-in provider ran instead of a real model, on purpose, so nobody mistakes an offline demo
  for a live one.
- **Known gaps:** SCSS/Less sources are not rewritten, only compiled CSS; `lang="scss"` Vue blocks
  are skipped; authored unitless line-heights are left alone; verifying a remote `--url` app with
  hashed CSS bundles isn't possible yet, it needs the local source build.

## Positioning vs the closest tools

Every comparable tool we found does one of two things: it reports on a website's existing styles,
or it helps build new UI from a design file. Nothing we found goes back into an app's own source
files and swaps a hardcoded literal for a token. The closest is **Dembrandt**, which extracts
tokens from a live URL and can detect drift against a saved baseline, but it never touches the
target app's source and its drift check is for watching a site over time, not for proving one
specific rewrite is safe to merge. Screenshot to Tokens rewrites the real `.css`/`.jsx`/`.vue`/SVG
files in place and runs a three-check pixel-diff verification before a human approves the pull
request, closing the loop from a live running app to a reviewed, mergeable change.

## Track fit

**Startup track.** Sorb is a real product already in production (a design-token bridge between
Figma and React with a published npm scope, `@sorb/*`). This hackathon project is a separate,
standalone repo by design, so it depends only on the already-published `@sorb/seed` package and
never touches Sorb's private code, but it is built to feed directly into Sorb: the tokens this
pipeline proposes are the same tokens Sorb's live-preview bridge already knows how to serve to a
running app.

## How to run (5 commands)

```sh
pnpm install --ignore-workspace          # standalone repo inside a pnpm workspace folder
pnpm test                                # 68 unit tests
pnpm demo                                # fixture app, offline stand-in providers → out/acme-shop/report.html
node src/cli.js eval --fixture acme-shop # score the run against fixtures/acme-shop/golden.json
pnpm doctor                              # checks providers, keys, Ollama, Mac headroom
```

Open `out/acme-shop/report.html` after `pnpm demo` to see the region overlay, token chips with
reasons, the review step, and the verify diff.

## Data policy

Only public, non-sensitive pages go to a hosted model. The "Contributor" tier that Meta's API
offers at a steep discount in exchange for training on your prompts and completions is never
enabled, not for this project, not anywhere in this repo; `.env.example` and the provider code
flag this at every point a model id is read. Keys live in `.env`, git-ignored, never in code.

## Links

*[placeholder: repo URL, not yet public as of this writing]*
*[placeholder: demo video link, recording is planned for Nov 3, see `docs/demo-script.md`]*
