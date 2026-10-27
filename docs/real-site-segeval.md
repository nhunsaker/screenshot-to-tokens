# Real-site segmentation scores (L1)

The div-soup fixture shows where SAM beats the DOM: a page with no semantic markup. These scores cover the opposite
case: three ordinary public sites. The truth comes from the screenshot, not from the DOM or any segmenter.

## Method

1. `node scripts/label-candidates.mjs --url <site> --out out/l1/<id>` numbers every clickable element on the first
   screen (1440x900) and writes `candidates.png`.
2. Each box was labeled from that overlay and the screenshot: button, input, link, icon, badge, card, nav, header.
   Things that look like a button count as buttons whatever their tag. Truth files: `fixtures/l1/<id>.truth.json`.
   The labels were made by the agent from the overlays and are open to review. HackSoc's nav was widened once, to
   include the JOIN US! box that sits at the top of the same link column.
3. Capture once (`--to segment` with the DOM segmenter), copy `capture.json` to two more folders, and segment the
   same capture with `S2T_SEGMENTER=meta` (SAM 3.1) and `S2T_SEGMENTER=hybrid`.
4. `s2t segeval --run <dir> --truth fixtures/l1/<id>.truth.json --max-y 900`. Captures are full-page, so `--max-y`
   clips predictions to the first screen: a full-height sidebar is scored by its visible part, and regions below the
   fold aren't counted as false positives.

## Results (IoU 0.5, 2026-10-26)

| Site | DOM recall / precision | SAM 3.1 | Hybrid | Buttons (DOM / SAM / hybrid) | Gate (hybrid) |
|---|---|---|---|---|---|
| Argon Dashboard (React, MIT) | 63% / 60% | 22% / 41% | 73% / 50% | 4/4 · 4/4 · 4/4 | GO |
| HackSoc Notts (Jekyll) | 100% / 54% | 0% / - | 100% / 58% | 0/1 · 0/1 · 0/1 | no-go: button |
| josh-wong.github.io (Docusaurus) | 81% / 53% | 48% / 56% | 100% / 50% | 4/4 · 3/4 · 4/4 | GO |

## What it says

- **The hybrid has the best recall on all three sites.** On well-built pages the DOM already does most of the work.
  SAM adds what it can't see: the icons (Argon 4 of 15, josh-wong 5 of 5) and, on Argon, the header via the
  SAM-anchored layout rule.
- **SAM alone is not enough on real sites.** It is literal: it finds buttons, search bars and icons, and never
  cards, nav, header or links (by design, docs/sam-ui-risk.md).
- **HackSoc is the honest miss.** On a dark, retro page SAM returned 0 boxes, and the DOM calls the green JOIN US! box
  a link (it's an `<a>` with no button styling the rules recognise). Nothing finds the one button, so the gate says
  no-go. Fix ideas belong to L10 (badge vs button vs link merge) and a SAM prompt pass on dark themes.
- **Precision is 50 to 60% everywhere,** mostly from regions the truth doesn't label (text blocks, images, footers)
  and from SAM icons on glyphs that weren't labeled. Treat precision here as a lower bound.

## Reproduce

```
node src/cli.js run --serve <argon build> --run out/l1/argon-dom --to segment
node src/cli.js run --url https://hacksocnotts.github.io/ --run out/l1/hacksoc-dom --to segment
node src/cli.js run --url https://josh-wong.github.io/ --run out/l1/joshwong-dom --to segment
# copy capture.json + run.json + screenshot.png to <id>-sam and <id>-hybrid, then:
S2T_SEGMENTER=meta   node src/cli.js run --url x --run out/l1/<id>-sam    --from segment --to segment
S2T_SEGMENTER=hybrid node src/cli.js run --url x --run out/l1/<id>-hybrid --from segment --to segment
node src/cli.js segeval --run out/l1/<id>-hybrid --truth fixtures/l1/<id>.truth.json --max-y 900
node src/cli.js scoreboard   # adds the "Real sites" table
```

Cost: 9 SAM calls, about $0.02.
