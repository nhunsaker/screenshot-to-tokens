# Icon and control contrast, target size (L16)

`s2t nontext --run <hybrid run>` measures two WCAG 2.2 checks on the controls SAM 3.1 found in a screenshot:

- **Non-text contrast (WCAG 1.4.11, 3:1):** an icon's color against what surrounds it, and a button's or input's
  boundary (fill or border) against the background around it.
- **Target size (WCAG 2.5.8, at least 24x24 CSS px):** every clickable control.

It works where the DOM has nothing to inspect. On div-soup the page is 34 `div`s, 43 `span`s and a `canvas`, with no
`button`, `input`, link or ARIA role anywhere. **This page's code describes none of its controls; SAM found them, so
we could measure them.**

What this is not: a verdict that a page is accessible or conforms to WCAG. It measures two specific checks on the
captured route, in its default state. It does not measure hover or focus states, text contrast (that is L12),
or anything a screen reader would announce.

## Method

1. **Controls.** Every region of a hybrid run (`S2T_SEGMENTER=hybrid`) labelled `icon`, `button` or `input`.
2. **Outline: a SAM 3.1 point prompt per control.** `input_text` is `<0f>1<|point;x=..;y=..;w=W;h=H|>` at the region's
   center (or the nearest pixel of its concept mask, so a ring-shaped icon is not prompted on its hole); the image is
   the screenshot, or its 1600 px tile on tall pages (a window centered on the control if it straddles a tile edge).
   Four calls in flight, every call cached by model + prompt + image hash (`out/.cache`). Of the detections returned,
   the one with the highest IoU against the region is kept; below 0.3 (the point landed on the page behind the
   control), the region's own concept mask is used instead and the item says so (`outlineSource`).
3. **Mask decoding.** The response carries `<|mask;x=0;y=0;data=H,W,!payload|>`: a one-bit raster covering the
   inclusive box, base85 over printable ASCII minus the wire delimiters, compressed with an adaptive binary range coder
   on a 12-pixel causal context. `src/lib/sam-mask.js` is our own small decoder (no new dependency) following Meta's
   published format (`@meta-sam/parser`). It also has the encoder, used to check that every decoded API mask
   re-encodes to exactly the payload received: 36 of 36 saved masks from the div-soup and Argon runs do.
4. **Ring sampling.** Around the mask: a chessboard distance field. `inside` = mask pixels eroded by 1 px (drops the
   anti-aliased edge); `edge` = mask pixels within 2 px of its edge; `ring` = pixels 2 to 4 px outside the mask.
   The ring's dominant color (4-bit bins, near shades merged) is "the surroundings".
5. **Contrast** (`contrastRatio` from `src/preview-client/contrast.js`):
   - Icons: the best of (the strongest tenth of the icon's pixels vs the ring) and (the strongest tenth vs the icon's
     own dominant color). The first covers a line icon on the page, the second a glyph on a colored circle. Thin strokes
     are a minority of the mask and anti-aliasing spreads them over many shades, so a percentile beats a second color
     cluster here (it found Argon's red list icon at 3.77:1 where clustering said 1.18:1).
   - Buttons and inputs: the best of (fill vs ring) and (each edge color with at least 10% of the edge band vs ring),
     so a 1 px border counts.
   - Pass at 3:1. A **button with visible text inside it** that falls below 3:1 is marked **review**, not failed:
     1.4.11 does not require a visible boundary when the text label identifies the control. The text comes from the
     smallest captured element that contains the control's center and fits inside its box.
6. **Target size.** The hit area is the clickable DOM element under the control when the capture has one
   (`capture.json` `clickable`; for a button, the larger of that element and the SAM outline, since padding counts),
   else the SAM outline. Because `clickable` is inherited by children, the smallest real control (`a`, `button`,
   `input`, ... or a role) wins, else the outermost clickable element (div soup: the `div` with the pointer cursor).
   Icons count as targets only when something clickable sits under them.
   **Spacing exception** (simplified): an undersized target passes if a 24 px circle on its center does not intersect
   another target found here, nor another undersized target's circle. Targets SAM did not find are not considered.
7. **Tokens.** For a failing control, each side's sampled color is matched to the run's color tokens: exact value first
   (semantic before component before primitive, `tokensForColor`), else the nearest color token within RGB distance 10.
8. **Output.** `<run>/nontext.json` (per control: label, bbox, outline source and IoU, ratio with the two colors and
   the basis, pass/fail, clickable, hit area, size verdict, spacing exception, tokens, crop path) and
   `<run>/nontext/<id>.png` crops with the mask outline in magenta. The command adds an "Icon and control contrast,
   target size (SAM)" section with the crops to `report.html`.

## Results (2026-10-27)

### div-soup (`out/div-soup-hybrid`)

9 controls, all found by SAM: 8 buttons, 1 input, no icons. Non-text contrast below 3:1: 7 of 9, of which 6 are
buttons labelled with text ("review") and 1 is the search input. Targets under 24x24: 0 of 9.

| Control | Ratio | Colors (control on surroundings) | Size (hit area) | Token |
|---|---|---|---|---|
| button "New project" | 4.17:1 ok | #1a73e8 on #f5f6f8 | 111x35 | |
| button "Invite" | 1.08:1 review | #ffffff on #f5f6f8 (fill) | 69x35 | color.surface.default on (none) |
| button "View" (row 1) | 1.36:1 review | #dddddd on #ffffff (border) | 58x27 | color.border.default on color.surface.default |
| button "View" (row 2) | 1.33:1 review | #dfdfdf on #ffffff (border) | 59x27 | color.border.default (nearest) on color.surface.default |
| button "View" (row 3) | 1.36:1 review | #dddddd on #ffffff (border) | 58x27 | color.border.default on color.surface.default |
| button "View" (row 4) | 1.35:1 review | #dedede on #ffffff (border) | 58x27 | color.border.default (nearest) on color.surface.default |
| button "View" (row 5) | 1.36:1 review | #dddddd on #ffffff (border) | 58x27 | color.border.default on color.surface.default |
| button "Export" | 4.45:1 ok | #1b74e9 on #ffffff | 119x37 | |
| input (search) | 1.27:1 **below 3:1** | #dddddd on #f6f7f9 (border) | 951x36 | color.border.default on (none) |

The token map points at one decision: every View border is `color.border.default` (#dddddd; three exact, two a shade
off and matched as the nearest token), and so is the search input's border (its surroundings are the page
background, which is not a token). Darkening `color.border.default` raises the input and the View buttons together;
proposing that value and verifying it is future work.

### Argon Dashboard (`out/rec-argon`)

22 controls: 17 icons, 4 buttons, 1 input. Non-text contrast below 3:1: 8 of 22 (none of them text-labelled buttons).
Targets under 24x24: 0 of 17 (the sidebar icons sit inside 250x45 links; the stat-card icons are not clickable).

Below 3:1: the light-pink, cyan and yellow sidebar icons (1.95, 1.91, 1.41:1 on white; `color.teal.200`,
`color.yellow.100`), the white glyphs on the cyan and yellow stat-card circles (1.84 and 1.41:1), the brand logo's
cyan mark (1.91:1), and the search input's translucent border and search icon on the header gradient (2.14 and
1.92:1; no token matches, the colors are blended over a gradient that is not a token). The four buttons pass
(3.87 to 16.45:1).

### Breadth pool (no crashes)

| Site | Controls | Below 3:1 (no text label) | Under 24x24 (no spacing exception) | SAM calls |
|---|---|---|---|---|
| WonYong-Jang | 8 (3 icon, 4 button, 1 input) | 1 (1) | 0 (0) | 8 |
| josh-wong | 20 (12 icon, 7 button, 1 input) | 5 (3) | 2 (0) | 20 |
| proinsias | 23 (15 icon, 8 button) | 8 (3) | 0 (0) | 23 |

josh-wong's two undersized targets (the 78x18 "Projects" nav link and a 69x18 "GitHub" text link with an icon) pass under the spacing exception.

### SAM cost and latency

78 uncached point-prompt calls across the five runs (`sam-3.1`, standard tier, about $0.0025 each: about $0.20).
Uncached latency per call, median (max): div-soup 1.19 s (2.06), Argon 1.67 s (4.25), breadth 0.9 to 1.6 s (3.6).
Wall time at four in flight: div-soup 3.8 s for 9 controls, Argon 10.8 s for 22. Re-runs are cached (about 0.1 s per
control, all pixel work).

## Limits

- **Only the default state of the captured route.** Hover, focus and active states are not captured, so focus
  indicators (also 1.4.11) are not measured.
- **Only what SAM finds.** SAM 3.1 answers for "button", "search bar" and "icon"; controls it misses (div-soup's
  sidebar items, checkboxes, sliders) are not measured, and the spacing exception ignores them.
- **Icon color is a percentile.** An icon whose strokes cover less than a tenth of its mask is measured on
  anti-aliased pixels and comes out lower than its true color; the crop shows what was measured.
- **Gradients and images behind a control** are reduced to their dominant ring color. The Argon header input is
  measured against the gradient's dominant blue, not its lightest point.
- **Boundaries are a review item for text buttons**, not a failure: WCAG 1.4.11 does not require one when the text
  identifies the control. Inputs and icon-only controls are reported as below 3:1.
- **Hit areas come from the DOM when there is one.** On a page with no DOM at all (a mockup PNG), the SAM outline is
  the target, which undercounts transparent padding.
- **Target size uses CSS px from a device-scale-1 screenshot.** A capture at another scale would need dividing.

Wording for anything public: name the check and the number ("8 of 22 icons and controls on Argon fall below 3:1
non-text contrast"). "More accessible" only as a comparison with the specific improvement named next to it. Never
"accessible" or "compliant" as a verdict.
