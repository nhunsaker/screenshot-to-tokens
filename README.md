# Screenshot to Tokens

Point it at a running app that has no design tokens. It captures the page, segments it into UI regions,
merges the drifted values (five almost-identical blues become one), proposes a tiered token set with a
reason for each token, rewrites the hardcoded literals to `var(--token, fallback)`, and proves with a
screenshot diff that the rewrite itself changes nothing, then shows exactly what the cleanup changes.

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026) with SAM 3.1 (segmentation),
Muse Spark (naming) and Muse Code (the pull request). Every model step sits behind a provider with an
offline stand-in, so the whole pipeline runs today without any API key.

## Run it

```sh
pnpm install --ignore-workspace   # standalone repo inside a pnpm workspace folder
pnpm test
pnpm demo                         # fixture app, all stand-in providers → out/acme-shop/report.html
node src/cli.js eval --fixture acme-shop   # score the run against fixtures/acme-shop/golden.json
pnpm doctor                       # providers, keys, Ollama, Mac headroom
node src/cli.js segeval --run out/acme-shop          # segmenter vs DOM oracle boxes: GO / NO-GO
node src/cli.js compare out/acme-shop out/acme-shop-meta   # runs side by side
node scripts/access-day.mjs       # once Meta API keys are in .env: probe shapes, run everything, score
```

Reports embed their images when they total under 8 MB and link them otherwise (`S2T_REPORT_IMAGES=embed|link`).

Static build: `node src/cli.js run --serve ./dist --target ./dist/css` (serves the folder, rewrites the target).
Dev server: `node src/cli.js run --url http://localhost:3000 --target ./src/styles`.
Re-run from one stage after switching a provider: `S2T_NAMER=ollama node src/cli.js run --fixture acme-shop --from name`.

After the run:

```sh
# 1. review in out/<run>/report.html, download review.json into the run folder, then
node src/cli.js review --run out/acme-shop
# 2. branch + commit in the app repo (add --open to push and open a draft PR)
node src/cli.js pr --run out/acme-shop --repo ../my-app --target ../my-app/src/styles
# 3. live preview a token change through a running Sorb bridge (`npx -p @sorb/juice sorb dev`)
node src/cli.js preview --token color.action.primary --value '#e8711a' --app-url http://localhost:3000
```

Plain HTML pages get live preview by adding `src/preview-client/sorb-preview.js` after `tokens.css`
(`<script src="sorb-preview.js" data-bridge="http://localhost:7777"></script>`); React apps use `@sorb/leaf`.
See `docs/sorb-preview.md`.

What the rewriter handles: plain `.css`, `<style>` blocks in `.vue` files (not `lang="scss"`), inline styles and
styled-components in `.js/.jsx/.ts/.tsx` (via `@sorb/seed`), and `fill` / `stroke` on inline SVG in `.html`.
It never touches `node_modules`, `.git` or build output folders.

## Pipeline

```
capture → segment → join → cluster → name → validate → emit → rewrite → verify → report
Playwright  SAM 3.1   bbox    ΔE / px   Muse Spark  repairs   tokens.css  Muse Code  pixel diff  HTML
```

| Stage | Provider env | Stand-in (offline) | Real |
|---|---|---|---|
| segment | `S2T_SEGMENTER` | `mock`: regions from DOM boxes (an oracle; overstates quality) | `meta` SAM 3.1, `local` SAM on this machine |
| name | `S2T_NAMER` | `mock`: usage-driven heuristic names | `meta` Muse Spark, `ollama` local Llama, `fireworks` |
| review | `s2t review` | decisions exported from report.html (accept / rename / reject) | same |
| rewrite | `S2T_CODER` | `deterministic`: plain-CSS rewrite into `out/<run>/rewritten/` | `meta` Muse Code opens the PR |

The model proposes; deterministic code guarantees the shape. `validateTokenSet` makes sure every cluster
has exactly one primitive, aliases resolve without cycles and primitive values match what was captured.
If a provider fails, the run falls back to the heuristic and records a warning in `tokens.json`.

Verify runs two checks: with only the `var()` fallbacks the page must be pixel-identical, and with
`tokens.css` loaded (drift merged) the change must stay under `S2T_VERIFY_THRESHOLD`.

## Data policy

Only public, non-sensitive pages go to hosted models. Never enable a "Contributor" (trains on your data)
tier. Keys live in `.env` (git-ignored), never in code.

## Layout

```
src/cli.js, src/pipeline.js     entry + orchestration (each stage writes out/<run>/<stage>.json)
src/stages/                     capture, join, cluster, name (validate), emit, rewrite, verify, report, eval, review, pr, preview
src/providers/segment/          mock, meta-sam (SAM 3.1), local-sam (+ scripts/sam_local.py)
src/providers/llm/              chat (OpenAI-compatible), heuristic, llm-namer
src/providers/coder/            deterministic (CSS + Vue), jsx, svg-attrs, meta-code
src/preview-client/             sorb-preview.js (no-build live preview for plain HTML)
fixtures/acme-shop/             demo storefront with deliberate drift + golden.json
docs/                           providers-research.md, demo-script.md, demo-targets.md, sorb-preview.md
test/fake-meta.test.js          contract test against a fake Meta API (rerun shapes on access day)
```

Builds on the published [`@sorb/seed`](https://www.npmjs.com/package/@sorb/seed) normalizers (Apache-2.0).

## Architecture

![Pipeline diagram](docs/architecture.svg)

Capture, join, cluster, emit, rewrite, and verify are deterministic code. Segment and name are the
two Meta model steps (SAM 3.1, Muse Spark), each with an offline stand-in. Review is a human step.
Full write-up: [`docs/SUBMISSION.md`](docs/SUBMISSION.md).

## Submission

Hackathon submission text, built-with-Meta-models detail, what was proven with real numbers, and
honest limits: [`docs/SUBMISSION.md`](docs/SUBMISSION.md).
