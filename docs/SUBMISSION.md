# Submission: Screenshot to Tokens

Meta Global AI Developer Hackathon, Oct 26 – Nov 4, 2026 · **Startup track** · Theme: **Build for Your World**

## One-line pitch

Point it at a live web app with no design tokens. SAM 3.1 reads the interface from pixels, Muse Spark names a tiered
token set with a reason for each token, a person reviews it, the hardcoded values in the real source are rewritten to
`var(--token, original)`, and four checks prove the rewrite changes nothing and makes no text harder to read, before a
pull request opens. From then on, making the app more accessible, or giving it a dark mode, is one token change.

## Links

- **Demo video (2:57):** _[link to the unlisted YouTube upload]_
- **Code:** https://github.com/nhunsaker/screenshot-to-tokens
- **Live demo:** https://nhunsaker.github.io/argon-dashboard-react/ (original, tokenized, a previewed change, token playground)
- **A real pull request on our fork of Argon Dashboard React:** https://github.com/nhunsaker/argon-dashboard-react/pull/2

## The problem (Build for Your World)

I've spent my career as a design engineer cleaning up the same mess by hand: an app with no design tokens, where every
color and size was typed in place and copied across screens until nobody can say which ones are meant to match. Fixing
it means grepping hundreds of literals and hoping the rewrite doesn't change anything, so most teams never do. And until
an app has tokens, everything that depends on them, a brand refresh, a dark mode, a contrast fix, has to be done by hand
in every file.

It matters beyond tidiness. Low-contrast text is the most common accessibility failure on the web: WebAIM's 2026 survey
of one million home pages found it on 83.9% of them. In the EU, the European Accessibility Act has applied to new
digital products and services since 28 June 2025, and in the US, state and local government sites must meet WCAG 2.1 AA
from April 2027.

## What it does

1. **Capture** a live web app (Playwright: full-page screenshot plus computed styles per element).
2. **Segment** the screenshot with **SAM 3.1** (buttons, inputs, icons from pixels), combined with layout rules anchored
   on SAM's regions and DOM style rules for cards, badges and links. Works where the markup describes nothing.
3. **Cluster** near-duplicate values (ΔE for colors, a tolerance for sizes).
4. **Name** a three-tier token set (primitive → semantic → component, plus state tokens like `button.active.bg` and
   on-surface text tokens like `color.text.on-primary`) with **Muse Spark**, one reason per token. Deterministic code
   validates every proposal: one primitive per cluster, aliases resolve, values match what was captured.
5. **Review:** a person accepts, renames, rejects or merges tokens in the HTML report.
6. **Rewrite** the literals in the real source (CSS, Vue `<style>`, JSX/styled-components, inline SVG) to
   `var(--token, original)`, keeping the original as the fallback.
7. **Verify** with four checks: fallbacks only must be pixel-identical; merged colors must be invisible; the full
   cleanup is measured and shown for review; and **text contrast** (WCAG 2.x AA, SC 1.4.3) is measured on the rendered
   pixels, so a proposal that makes any text harder to read is blocked.
8. **Pull request** with the verify table and the text pairs below AA, each with the token that controls it.
9. **Preview** any token change live in the web app itself through Sorb, before anyone merges.

Also built on the same tokens: `s2t dark` proposes a dark theme as a token file (every text pair contrast-checked, one
automatic retry), and `s2t nontext` uses SAM 3.1 click prompts to outline each icon and control and measure its contrast
(WCAG 1.4.11) and target size (WCAG 2.5.8), and `s2t focus` tabs through the page to measure visible keyboard focus and
fixes it with focus-ring tokens.

## Built with Meta's models

| Model | What it does here | Measured |
|---|---|---|
| **SAM 3.1** (Meta Model API) | Segments buttons, inputs and icons from pixels; click (point) prompts outline single controls for measurement | On a page built of divs and a canvas, page structure finds **0 of 8** buttons and SAM finds **8 of 8** (IoU 0.95), including one painted inside a canvas. Click-to-outline in about 1.6 s |
| **Muse Spark Open** on Baseten (open weights) | The default namer, and dark-theme proposals | Names a page's tokens in **3 to 5 s**, 3 to 9× faster than hosted Muse Spark 1.3, with identical fixture scores |
| **SAM 3.1 open weights** on a Modal GPU (`facebook/sam3.1`) | The same segmentation, self-hosted, so the whole pipeline runs on open weights | Matches hosted SAM 3.1 on every test: div-soup 8/8, the 3 hand-labeled sites identical, 96.6% box agreement on 27 sites (mean IoU 0.89); about $0.0003 of GPU time per screenshot warm. An Argon run on open weights only kept verify at 0 px |
| **Muse Spark 1.3** (hosted) | Alternative namer; dark-theme proposals in `--provider both` (the better result is kept) | 13.7 to 26.2 s per naming call; won the dark-theme comparison on Light Bootstrap Dashboard |

No GPU on the laptop; one full run on Argon Dashboard costs under a cent. With SAM on Modal and Muse Spark Open on Baseten, the whole pipeline runs on Meta's open weights (`docs/open-weights-pipeline.md`).

## Evidence (all numbers from real runs; reproducible from the repo)

| Claim | Result | Where |
|---|---|---|
| Rewrite is safe on real sites | 28 public, permissively licensed sites we didn't build: **2,313 values rewritten, 0 px changed on 23 of 23** stable sites with edits; a second run gave the same verdict on all 27 reachable | `docs/breadth.md` |
| Segmentation on real sites | Hand-labeled first screens of 3 sites: the combined segmenter passes all three | `docs/real-site-segeval.md` |
| End to end, Argon Dashboard | 16 to 23 s, naming 3.6 to 4.9 s; checks 0 px · 0.000% · 0.919% | `docs/latency.md` |
| Human review | Accept, rename and merge take the fixture's answer-key score from 20/21 to 21/21, still 0 px | `demo/L5-review-take.md` |
| Text contrast vs the W3C rule | ACT rule afw4f7 (text has minimum contrast): **32 of 32** approved test cases consistent, 31 exact | `docs/a11y.md` |
| Text contrast vs axe-core 4.14 | 28 sites: agrees on 308 of 309 violations and 2,165 of 2,174 passes, **99.9% agreement** (1 opposite verdict in 2,483, on a page that animates); of the items axe-core can't decide (text on gradients and images), it settles **97%** and flags the rest for review | `docs/a11y.md` |
| Icons and controls (SAM) | On the div page, SAM found 9 controls the code doesn't describe; each measured for contrast and size | `docs/a11y-nontext.md` |
| Visible keyboard focus | 30 real sites, 1,779 Tab stops: 52% show a focus indicator that meets the bar, 17 sites under half. One focus-ring token set takes Argon from **0 of 25 to 25 of 25**, still 0 px when nothing is focused. SAM also finds controls a keyboard can't reach: on the div page, 7 of 7 clickable controls | `docs/keyboard.md` |
| Dark mode as a token file | Light Bootstrap Dashboard: 83 of 84 text pairs pass in dark (14 of 84 in its original light theme) | `docs/dark-mode.md` |
| Tests | 232 passing | `pnpm test` |

## How it scores against the rubric

| Rubric | Where to look |
|---|---|
| **Impact (30%)** | The problem above; contrast fixes, visible keyboard focus and dark mode become token changes; 28-site breadth run; 30-site keyboard baseline |
| **Use of Meta AI tooling (25%)** | SAM 3.1 on UI screenshots, where the DOM has nothing (0/8 vs 8/8); SAM click prompts to measure single controls; the whole pipeline on Meta's open weights (SAM 3.1 on Modal, Muse Spark Open on Baseten) with parity shown against the hosted models; hosted Muse Spark compared on every dark theme |
| **Technical depth & execution (20%)** | The model proposes, deterministic code guarantees the shape; four-check verify; benchmarks against the W3C ACT test cases and axe-core; 232 tests |
| **Demo (25%)** | The video; the live demo site and playground; PR #2 on the fork |

## What existed before the hackathon, and what is new

**Before the building period (git tag `pre-event-baseline`, built Oct 25, 2026):** the pipeline scaffold with an
offline stand-in for every Meta model: capture, a DOM-based mock segmenter, clustering, a heuristic namer and validator,
the rewrite, a three-check verify, the HTML report with review, the CLI, two test fixtures and the test suite. It
depends only on the published `@sorb/seed` package. **Sorb** is Metatoy's existing product (a design-token bridge
between design and a live web app, published under `@sorb/*`); it is not part of this repo and not shown in the video.

**Built during the hackathon (66 commits after `pre-event-baseline`, `git log pre-event-baseline..main`):** everything
that uses Meta's models (SAM 3.1 segmentation and click prompts, Muse Spark naming hosted and open-weights, the hybrid
segmenter), component and state tokens, on-surface text tokens, the text-contrast check and its benchmarks, SAM-measured
controls, dark mode, the 28-site breadth run, the live demo site, the playground, and the demo video.

## Limits

- Text contrast is checked on the captured page in its default state: not hover or focus states, placeholders, or
  non-text contrast beyond the SAM-measured controls. This is a contrast check, not a full accessibility audit (no
  keyboard or screen-reader checks).
- Two of the 28 sites animate on their own (a randomly thrown tag pile, a live waveform); pixel checks can't be exact
  there, so they're reported separately, not counted as passes.
- SCSS/Less sources aren't rewritten (the compiled CSS is); hashed CSS bundles behind a remote URL need the local build.
- Dark mode only reaches colors that are tokens: on Argon the sidebar, page background and header gradient stay light.

## How to run

```sh
pnpm install --ignore-workspace
pnpm test                                   # 232 tests
pnpm demo                                   # fixture app, offline stand-ins → out/acme-shop/report.html
S2T_SEGMENTER=hybrid S2T_NAMER=baseten node src/cli.js run --serve <app build> --target <css dir> --run out/my-app
node src/cli.js dark --run out/my-app --provider both
```

## Data policy

Only public pages go to hosted models. Meta's "Contributor" tier (cheaper because it trains on your data) is never
used; the code refuses `-contributor` model ids. SAM requests send `store: false`. Keys are read from the macOS Keychain
or a git-ignored `.env`, never from code.

## Team

Nathan O'Brien, Metatoy (https://github.com/nhunsaker): solo founder; design, engineering and the demo. Built with AI
coding agents (Claude Code) under his direction.
