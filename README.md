# Screenshot to Tokens
**A design system from a screenshot in seconds. A more accessible app from the tokens in one change.**

Point it at a live web app that has no design tokens. It captures the page, **SAM 3.1** segments the interface from
pixels (so it works where the markup says nothing), near-duplicate values are clustered, **Muse Spark** names a
three-tier token set (primitive → semantic → component, with a reason per token), a person accepts, renames or merges,
the hardcoded literals are rewritten to `var(--token, original)`, and four checks prove the rewrite itself changes nothing and makes no text
harder to read before a pull request opens. **Sorb** then previews any token change live in your web app.

**▶ The 2:55 demo, narrated:** [watch on YouTube](https://www.youtube.com/watch?v=RpnO9HfF98E) · **Try it live:** [s2t.sorbcloud.com](https://s2t.sorbcloud.com)

**▶ The 55-second demo on X:** [x.com/precogpunk](https://x.com/precogpunk/status/2117740495526834365). If this is useful to you, a repost there helps the project in the hackathon's Most Viral round through Sunday, Nov 8.

[![Screenshot to Tokens: the 2:55 demo on YouTube](docs/media/demo-thumb.jpg)](https://www.youtube.com/watch?v=RpnO9HfF98E)

**One minute, no sound:** the page with no markup, one real run, the diff and the checks, the live preview, the breadth table.

https://github.com/user-attachments/assets/3236827b-b139-4910-b9bc-252291838b0a

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026) by Metatoy. Every model step sits behind a
provider with an offline stand-in, so the pipeline runs without any API key; with keys it uses SAM 3.1 and Muse Spark
on the Meta Model API ([dev.meta.ai](https://dev.meta.ai), `https://api.meta.ai/v1`), the open-weights Muse Spark Open
on our inference partners Baseten (default) and Fireworks (failover), and SAM 3.1 open weights on Modal.

**Measured (details in `docs/`):**

| | |
|---|---|
| Page with no semantic markup (`fixtures/div-soup`) | page structure finds **0 of 8** buttons; SAM 3.1 finds **8 of 8** (`docs/real-site-segeval.md`, `out/scoreboard.html`) |
| Three real dashboards (Argon, Light Bootstrap, Agency) | pass the token eval; rewrite safety **0 px** on all; Argon end to end in 23 s, naming 4.9 s, about $0.007 (`docs/latency.md`) |
| 28 public sites we didn't build | 3,687 values rewritten; **0 px** changed on 23 of 23 stable sites with edits; re-checked, same verdict on all 27 reachable (`docs/breadth.md`) |
| Hosted vs open weights | Muse Spark Open on Baseten names in 3 to 4.4 s vs 13.7 to 26 s hosted, identical fixture evals (`docs/f17-hosted-vs-open.md`) |
| Open weights end to end | SAM 3.1 open weights on a Modal L4 GPU match hosted SAM 3.1 on every test (div-soup 8/8; 3 labeled sites identical; 96.6% box agreement on 27 sites); an Argon run on open weights only kept verify at 0 px (`docs/open-weights-pipeline.md`) |
| Review | accept + rename + merge takes the fixture from 20/21 to 21/21 at 0 px (`demo/L5-review-take.md`) |
| Text contrast check | measured on rendered pixels (gradients and images count); W3C ACT afw4f7: 32/32 consistent; vs axe-core on 28 sites: 99.9% agreement, and 97% of the items axe can't decide settled (the rest flagged for review) (`docs/a11y.md`) |
| Icons and controls (SAM click prompts) | contrast (WCAG 1.4.11) and target size (2.5.8) for each control SAM outlines; 9 controls on the div page the code doesn't describe (`docs/a11y-nontext.md`) |
| Visible keyboard focus (`s2t focus`) | Tab through every stop and compare focused vs unfocused pixels (WCAG 2.4.13 style); 30 real sites: 52% of 1,779 stops pass, 17 sites under half; fix = focus-ring tokens: Argon 0 of 25 → 25 of 25, still 0 px when nothing is focused (`docs/keyboard.md`) |
| Dark mode as a token file | `s2t dark --provider both`: Light Bootstrap Dashboard 83 of 84 text pairs pass in dark (`docs/dark-mode.md`) |
| Local playground | Muse Spark contrast audit 41 → 2 failing text pairs; dark theme 84/87 pairs pass (`docs/playground-muse.md`) |
| Point and say: contrast | click a label in the live web app, say *"make it readable, keep our gray"*: Argon 21 elements 2.95:1 → 4.53:1, whole page 41 → 20 failing text pairs, 0 regressions, 3 of 3 runs; Light Bootstrap 12 elements 2.81:1 → 4.54:1 (`docs/point-and-say.md`) |
| Point and say: focus and blocks | *"a visible focus ring in our blue"*: Argon visible focus 0 → 25 of 25, 3 of 3; *"make these buttons red"*: blocked and reverted, naming "Month" (4.20:1 → 3.77:1) (`docs/point-and-say.md`) |
| Tests | 291 passing (`pnpm test`) |
| Run outputs | `runs/` holds the verify and timing summaries behind every number above |

Live demo site: https://s2t.sorbcloud.com/ (the video, the evidence, both review reports and the breadth table on one page).

Live demo: [original](https://nhunsaker.github.io/argon-dashboard-react/original/) · [tokenized](https://nhunsaker.github.io/argon-dashboard-react/tokens/) ·
[a proposed change, previewed](https://nhunsaker.github.io/argon-dashboard-react/tokens/?tokens=color-action-primary:e8711a) ·
[token playground](https://nhunsaker.github.io/argon-dashboard-react/playground/) · [the PR on our fork](https://github.com/nhunsaker/argon-dashboard-react/pull/2).

## Point and say

Click a control in the live web app, then say or type what to change. Meta's speech model
(`muse-voice-transcribe-1.0`) transcribes the request, SAM 3.1 outlines what was clicked and finds the tokens that
control it, contrast and focus fixes are computed (no model), and other requests go to Muse Spark Open, limited to the
tokens that control the clicked element. Every change is re-checked for text contrast on the whole page and blocked if
anything gets harder to read. Local only: `node src/cli.js playground --run <run> --app <build>`. Details and timings:
[`docs/point-and-say.md`](docs/point-and-say.md).

## Run it

```sh
pnpm install --ignore-workspace   # standalone repo inside a pnpm workspace folder
pnpm test
pnpm demo                         # fixture app, all stand-in providers → out/acme-shop/report.html
node src/cli.js eval --fixture acme-shop   # score the run against fixtures/acme-shop/golden.json
pnpm doctor                       # providers, keys, Ollama, Mac headroom
node src/cli.js segeval --run out/acme-shop          # segmenter vs DOM oracle boxes: GO / NO-GO
node src/cli.js compare out/acme-shop out/acme-shop-meta   # runs side by side
node scripts/access-day.mjs       # with Meta API access: probe response shapes, run everything, score
zsh scripts/demo-runs.sh          # the three demo apps end to end with the open-weights namer (S2T_NAMER=baseten)
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
Playwright  SAM 3.1   bbox    ΔE / px   Muse Spark  repairs   tokens.css  var()      pixel diff  HTML
```

| Stage | Provider env | Stand-in (offline) | Real |
|---|---|---|---|
| segment | `S2T_SEGMENTER` | `mock`: regions from DOM boxes (an oracle; overstates quality) | `meta` SAM 3.1 (hosted), `hybrid` SAM 3.1 + layout + DOM rules, `modal` SAM 3.1 open weights on a Modal GPU, `hybrid+modal` (or `hybrid` with `S2T_SAM=modal`) the hybrid on open weights, `local` SAM on this machine |
| name | `S2T_NAMER` | `mock`: usage-driven heuristic names | `meta` Muse Spark 1.3, `baseten` Muse Spark Open (open weights), `ollama` local Llama, `fireworks` |
| review | `s2t review` | decisions exported from report.html (accept / rename / reject) | same |
| rewrite | `S2T_CODER` | `deterministic`: literal → `var(--token, original)` into `out/<run>/rewritten/` | same; `s2t pr` branches, commits and opens the draft PR |

The model proposes; deterministic code guarantees the shape. `validateTokenSet` makes sure every cluster
has exactly one primitive, aliases resolve without cycles and primitive values match what was captured.
If a provider fails, the run falls back to the heuristic and records a warning in `tokens.json`.

Verify runs three checks: with only the `var()` fallbacks the page must be pixel-identical (0 px); with the merged
color tokens loaded nothing may visibly change; with every token loaded the spacing cleanup is measured and shown
for review. A second shot of the unchanged page marks pixels that move between loads so animations don't count.
A fourth check measures text contrast (WCAG 2.x AA, SC 1.4.3) with the background read from the rendered pixels, and
fails a proposal that adds a failing pair (`docs/a11y.md`).

## Data policy

Only public, non-sensitive pages go to hosted models. Never enable a "Contributor" (trains on your data)
tier. Keys are read from the macOS Keychain or `.env` (git-ignored), never from code.

## Layout

```
src/cli.js, src/pipeline.js     entry + orchestration (each stage writes out/<run>/<stage>.json)
src/stages/                     capture, join, cluster, name (validate), emit, rewrite, verify, report, eval, review, pr, preview
src/providers/segment/          mock, meta-sam (SAM 3.1), hybrid, modal-sam (open weights), local-sam (+ scripts/sam_local.py)
modal/                          SAM 3.1 open-weights app for Modal + its client (docs/open-weights-pipeline.md)
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

## License

Apache-2.0 (`LICENSE`). Clone it and run it on your app.
