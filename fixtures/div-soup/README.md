# div-soup

The counter-case to `acme-shop`. Same idea (drifted colors/radii/spacing that a token pipeline
should merge) but built so the **DOM gives the pipeline nothing to work with**: a small SaaS
dashboard (sidebar nav, top bar + search, 4 KPI cards, a traffic chart, a status table) made
entirely of `<div>`/`<span>` with meaningless classes (`.x1`, `.q11`, `.c-9f`, `.t7`, ...) — no
`button`/`a`/`input`/`nav`/`header` tags, no ARIA roles, clickable things are `div onclick=""`.
It also has one `<canvas>` element that draws its own chart *and* a baked-in "Export" button —
content a DOM-based segmenter cannot see as elements at all, only as pixels inside one `<canvas>`
box.

## Why this fixture exists

`acme-shop` is a well-built page: real `<button>`/`<nav>`/`<input role>` tags mean the offline
`mock` segmenter (`src/providers/segment/mock.js`, which labels by ARIA role/tag first, then a
style heuristic for card/badge) does a good job standing in for SAM. That's a fair demo, but it
invites the obvious judge question: **"if the DOM already gives you boxes and labels, why do you
need SAM 3.1 at all?"** `div-soup` is the answer: plenty of real products (generic component
libraries, canvas-rendered dashboards, legacy div-soup markup) give the DOM nothing usable, and
that's exactly where a pixel-based segmenter earns its keep.

## The numbers (mock segmenter, honest)

`node src/cli.js run --fixture div-soup --run out/div-soup` → capture 78 elements → mock-dom finds
**19 regions, all labeled `badge` (13) or `card` (6)** — zero buttons, inputs, or nav, because
`labelFor()` in `mock.js` only ever emits those from ARIA role/tag, and this page has none.

**`eval` vs `golden.json`** (merge/semantic are independent of segmentation and still work, since
they read computed styles, not the mock's regions):

```
eval div-soup (mock-heuristic): 13/20 (65%)
  merge     7/10
  semantic  3/4
  segment   1/4      ← card ≥ 4 passes (6 found); button ≥ 7, input ≥ 1, nav ≥ 1 all fail (0 found)
  shape     2/2
```

**`segeval` vs the mock's own DOM oracle** (`node src/cli.js segeval --run out/div-soup`) is
**trivially 100% / GO** — it's comparing the mock to itself, same as any fixture. That number is
meaningless here and is exactly why this fixture needed a second, independent ground truth.

**`segeval` vs a hand-labeled ground truth** (what a person looking at the screenshot actually
sees — `regions.truth.json`, 23 regions across header/nav/input/button/card/badge, including the
canvas-drawn Export button):

```
node src/cli.js segeval --run out/div-soup --truth fixtures/div-soup/regions.truth.json

segeval @ IoU 0.5: any-label recall  63%, precision  79%
  label     oracle  pred  match  recall  precision  meanIoU
  badge          9    13      9  100%     69%     1.00
  button         8     0      0    0%      -       -
  card           4     6      4  100%     67%     1.00
  header         1     0      0    0%      -       -
  input          1     0      0    0%      -       -
  nav            1     0      0    0%      -       -
  NO-GO: button recall 0% < 60%; input recall 0% < 60%; nav recall 0% < 60%; header recall 0% < 60%
```

So: the DOM-based mock catches `card`/`badge` for free (its style heuristic — bg + radius, sized
right — still works, because it doesn't need a tag to see a filled rounded rect). It is **blind**
to `button`, `input`, `nav`, and `header` — 0% recall on all four — because those only exist in
this fixture as classed `<div>`s with no role, and the canvas Export button has no DOM footprint
to even find. Precision on `badge`/`card` is inflated too (69%/67%, not 100%) because the mock
over-segments the chart panel and table container as extra "cards."

## What a real segmenter has to beat

A SAM 3.1 run (`S2T_SEGMENTER=meta node src/cli.js run --fixture div-soup ... && node src/cli.js
segeval --run out/div-soup --truth fixtures/div-soup/regions.truth.json`) is doing real work here
the moment it clears **any** recall on `button`/`input`/`nav`/`header` — the DOM mock's floor on
this fixture is exactly 0%. The bar to look good: recall ≥ 60% on all five GO-rule labels
(`button`, `input`, `card`, `nav`, `header` — `src/stages/segeval.js` `GO_RULE`), and ideally a hit
on the canvas-drawn Export button (`h10` in `regions.truth.json`), which no DOM-based approach can
ever find.

## Files

- `index.html`, `styles.css` — the fixture page (div/span only; one inline-scripted `<canvas>` chart
  + canvas-drawn button; drifted blues `#1a73e8`/`#1b74e9`/`#1A73E8`, grays `#333`/`#343434`/
  `rgb(52, 52, 52)`, radii `4`/`5`/`6`px, spacing `7`/`8`/`9`px, same pattern as `acme-shop`).
- `golden.json` — merge/semantic/region expectations for `s2t eval` (same schema as `acme-shop`).
- `regions.truth.json` — hand-labeled ground truth `Region[]` (23 regions: nav, header, input,
  8 buttons incl. the canvas Export button, 4 cards, 9 badges) for `s2t segeval --truth`.

## Code change

Added `--truth <file>` to `s2t segeval` (`src/cli.js`) and `resolveOracle(capture, truth)`
(`src/stages/segeval.js`) so a run's regions can be scored against a hand-labeled file instead of
the DOM oracle, with the old oracle-only behavior as the default when `--truth` is omitted. Unit
test in `test/segeval.test.js` (`resolveOracle: prefers a hand-labeled truth file...`).
`node --test test/*.test.js` → 79 pass, 0 fail.
