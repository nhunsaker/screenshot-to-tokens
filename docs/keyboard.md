# Visible keyboard focus and reachability (L18, `s2t focus`)

`s2t focus --run <run dir> [--fix]` presses Tab through the page and measures, for every stop, whether you can see
where the focus is. With `--fix` it adds a focus ring as tokens and measures again. It also lists controls SAM found
that the keyboard never reaches.

What this is: one named check (visible focus, WCAG 2.4.13 style) and one reachability count, on the captured route in
its default state, with numbers. What it is not: a keyboard audit, or a verdict that a page is accessible or conforms
to WCAG. Say what was measured, for example "Argon: 0 of 25 Tab stops showed a visible focus indicator; with the focus
tokens, 24 of 25".

```
s2t focus --run out/m12-argon            # measure only: focus.json, a fifth verify row in report.html
s2t focus --run out/m12-argon --fix      # + focus tokens in tokens.css, focus.css, re-measured, 0 px check
s2t focus --serve <static dir> [--out f] # measure a folder with no run (the breadth baseline)
```

## Method

1. **Load** the original page the way verify does (`openSettled`: seeded `Math.random`, transitions and animations
   off, images loaded, two identical frames), 1440 x 900 at device scale 1.
2. **Tab**, up to a cap (default 400, `--cap`). For each stop: scroll it to the middle of the viewport (instant, not
   smooth), shoot a box 8 CSS px larger than the control on every side with focus, blur it, shoot the same box again,
   then focus it again so the next Tab continues from there.
   - **Wrap detection:** each visited element gets a `data-s2t-focus-seen` attribute; reaching one again ends the walk.
   - **Skipped stops:** zero size; off-screen (the box falls outside the viewport after scrolling); not visible
     (opacity under 0.05 up the tree, or `visibility: hidden`); a screenshot that throws. Skipped stops are listed with
     the reason and are not counted.
3. **Verdict per stop** (`measureStop`, pure). A pixel "changed" when |dR|+|dG|+|dB| > 30 between the two shots; it
   is "strong" when the luminance ratio between its focused and unfocused color is at least 3:1. The bar is a solid
   2 CSS px perimeter of the control, `4 x (w + h)` px:
   - **pass**: strong pixels >= that area (WCAG 2.4.13's minimum area at its 3:1 change of contrast);
   - **faint**: changed pixels >= half that area, but not a pass (visible, under the bar);
   - **none**: fewer changed pixels than that (usually nothing at all; `noChange` counts the exact zeros).
4. **Surroundings** per stop: the dominant color of the unfocused box outside the control (where a ring is drawn),
   kept as `bg`. The ring color is picked against these.
5. **Reachability** (needs a hybrid run's `regions.json`). Of the SAM regions labelled `button`, `input` or `icon`,
   the ones the page treats as clickable (`capture.json` `clickable` overlaps them) and that no Tab stop's box covers.
   Each is then looked up on the live page (`elementFromPoint` at its center, or for `pointer-events: none` controls
   such as Bootstrap's `.disabled`, the smallest matching element whose box contains the center). **Only a control
   whose element is not a native focusable is flagged**: `a`, `button`, `input`, `select`, `textarea`, `summary`, any
   `[tabindex]`, `[disabled]`/`.disabled`/`aria-disabled="true"` are listed as exempt with the reason. This removes
   the false positives the 30-site probe found (a disabled-by-design submit button, count badges inside links).
6. **Output:** `<run>/focus.json` (counts, every stop with its numbers, reachability with flagged and exempt controls,
   the ring choice, and with `--fix` the after counts, the before/after comparison and the 0 px check). The command
   rewrites `report.html` with a fifth verify row, "Visible focus (WCAG 2.4.13)" (and re-adds the L16 section if the
   run has one). `s2t pr` adds a "Visible keyboard focus" section and a verify-table row to the PR body, and copies
   `focus.css` next to the tokens file when the fix was applied.

## The fix, as tokens (`--fix`)

Component-tier tokens go into `tokens.css` between `/* s2t focus:start */` and `/* s2t focus:end */` (a re-run
replaces the block), aliasing the chosen color token:

```css
:root {
  --focus-ring-color: var(--color-blue-800, #32325d);
  --focus-ring-inner-color: var(--color-text-on-primary, #ffffff); /* two-tone only */
  --focus-ring-width: 3px;
  --focus-ring-offset: 2px;
}
```

and **one rule** goes into a separate `focus.css` (Argon's, as generated):

```css
:is(a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe,
    [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: var(--focus-ring-width, 3px) solid var(--focus-ring-color, #32325d) !important;
  outline-offset: var(--focus-ring-offset, 2px) !important;
  box-shadow: 0 0 0 var(--focus-ring-offset, 2px) var(--focus-ring-inner-color, #ffffff),
              0 0 0 calc(var(--focus-ring-offset, 2px) + var(--focus-ring-width, 3px) + 2px) var(--focus-ring-inner-color, #ffffff) !important;
}
```

Why a separate file: `tokens.css` stays values only (no selectors), and the rule must load **after** the theme CSS,
which a PR author places deliberately. Measurements inject both with `page.addStyleTag`, i.e. last.

Why it wins against themes: Argon and Bootstrap set `.btn:focus { outline: 0; box-shadow: none }` and similar. Those
are not `!important`, so an `!important` declaration wins regardless of specificity. `:is()` takes the specificity
of its strongest argument (0,1,1) plus `:focus-visible` (0,1,0), so an important `*:focus { outline: none !important }`
(0,1,0) also loses. `:where()` (specificity 0) would lose that last case, which is why the rule uses `:is()`.

Why it changes no unfocused pixel: it matches only `:focus-visible`, which nothing matches until a key moves focus.
`--fix` checks this twice: it re-runs verify's fallback-only and colors renders with `focus.css` (and the token block)
loaded and compares them to the captured screenshot, and it counts the elements matching `:focus-visible` on a fresh
load with the rule (0 on every target). A render that differs is shot once more (both counts kept); if it still differs,
the same render without `focus.css` is shot too and the two are compared directly.

**Ring color** (`pickRingColor`, deterministic, no model call). Every opaque color token is scored by how many
measured stops' surroundings it reaches 3:1 against. The token covering the most stops wins; ties go to
`color.action.primary`, then other semantic tokens, then component, then primitive, then the higher worst-case ratio.
If no single token reaches 3:1 against **every** control's surroundings, the ring is **two-tone**: the darkest token
as the outline between two bands of the lightest token (box-shadows in the offset gap and outside the outline), so
one tone contrasts with any background; the report and the PR body say so and name the best single token and its
coverage. If the two extremes are under 4.5:1 with each other, black and white are used.

## Validation: the control page

`fixtures/focus-control/index.html` holds five controls with known answers. `test/focus.test.js` runs the probe on it
in Chromium as part of `npm test` (skip with `S2T_SKIP_BROWSER=1`):

| Control | Expected | Measured (changed / at 3:1 / needed px) |
|---|---|---|
| Default link (Chrome's ring) | pass | 418 / 404 / 397: pass |
| Button with `outline: none` | none | 0 / 0 / 539: none |
| Custom ring, `3px solid #1a5cff`, offset 2px | pass | 738 / 738 / 435: pass |
| Default button (Chrome's thin ring) | faint | 468 / 224 / 480: faint |
| Themed button, `.btn:focus { outline: 0; box-shadow: none }` | none | 0 / 0 / 611: none |
| **All five with the generated rule** | pass | 5 of 5 pass (single color and two-tone) |

The default button reading "faint" shows the bar is strict: Chrome's own ring on a button is visible but under a
2 px perimeter at 3:1.

Unit tests cover the verdict thresholds, the pixel comparison on synthetic rings (3 px blue ring pass, light gray ring
faint, 1 px black ring faint, antialiasing-level noise ignored), the surroundings color, ring color choice (coverage
over preference, preferred names on ties, two-tone fallback, no tokens), the CSS (only `:focus-visible`, `!important`,
idempotent token block), reachability (flagged vs exempt vs reached vs not clickable vs not SAM), the before/after
matching, the PR section and the report row.

## Baseline: 30 sites (before any fix)

**First probe (2026-10-28, `out/focustest`, the script this loop turned into the library).** 29 pages with Tab stops,
**1,714 measured stops: 48% pass, 45% faint, 7% none.** 16 of 29 sites had under half their stops passing; 18 had at
least one stop with no visible change; **4 had zero passing stops**: Argon Dashboard (0 of 25), gaotianchi, Awfp1314,
infi-defi. Light Bootstrap: 12 of 35.

**Re-run with the library (this loop, `out/focus/baseline`).** Two probe bugs were fixed on the way:
(1) pages with `scroll-behavior: smooth` (Bootstrap 5 sets it) were shot mid-scroll, so the box missed the control;
`scrollIntoView` now asks for instant scrolling. (2) Controls hidden by an entrance animation that the harness
switches off (opacity 0) were counted as "none"; they are now skipped as not visible. The re-run also measures
DiogoRibeiro7, where the first probe errored.

| | Pages with Tab stops | Measured stops | Pass | Faint | None | Under half passing | Zero passing |
|---|---|---|---|---|---|---|---|
| First probe | 29 | 1,714 | 48% | 45% | 7% | 16 | 4 |
| Library re-run | 30 | 1,779 (29 skipped) | 52% (928) | 44% (786) | 4% (65) | 17 | 4 (the same four) |

Most of the "none" drop is the smooth-scroll fix (Mavrikant 9 to 0, burning-cost 19 to 1, devbattery 14 to 3).
Argon (0 / 2 / 23) and Light Bootstrap (12 / 11 / 12) did not change. C-gyeltshen and div-soup have no Tab stops.

## Before and after the fix (2026-10-28)

All runs: `s2t focus --run <dir> --fix`, cap 400, one browser at a time; "after" is the tokenized site (rewritten CSS)
with `tokens.css` + `focus.css` loaded. Counts are pass / faint / none of the measured stops.

| Site (run) | Tab stops | Before | After | Ring | Worse with the fix | Unfocused px with focus.css (fallback; colors) |
|---|---|---|---|---|---|---|
| Argon Dashboard (`m12-argon`) | 25 | 0 / 2 / 23 | **24 / 0 / 1** | two-tone: `color.blue.800` #32325d + `color.text.on-primary` #fff (best single, `color.action.primary`, 22 of 25) | 0 | 0 px; 0.000% |
| Light Bootstrap (`darkpick/lightbootstrap`) | 35 | 12 / 11 / 12 | **23 / 12 / 0** | two-tone: `color.black` + `color.surface.default` (best single 26 of 35) | 0 | 0 px; 0.000% |
| Agency (`darkpick/agency`) | 36 | 9 / 24 / 3 | **31 / 1 / 4** | two-tone: `color.action.primary` #212529 + `color.surface.default` (best single 32 of 36) | 2 (inline links around blocks) | 0 px; 0.000% |
| gaotianchi (`breadth4`) | 21 (20 measured) | 0 / 19 / 1 | **19 / 1 / 0** | `color.text.default` #434648, all 20 | 0 | 0 px; 0.000% |
| infi-defi (`breadth4`) | 8 | 0 / 8 / 0 | **8 / 0 / 0** | `color.text.default` #e0e1dd (a dark site), all 8 | 0 | 0 px; 0.000% |
| Awfp1314 (`breadth4`) | 6 (2 measured, 4 invisible) | 0 / 2 / 0 | 0 / 1 / 1 | `color.text.default` #1c2131, both | 1 (clipped by `nav` overflow) | 0 px; 0.000% |
| Mavrikant (`breadth4`) | 74 | 58 / 16 / 0 | **68 / 2 / 4** | `color.action.primary` #00788f, all 74 | 4 (clipped by `article.post-card` overflow) | page differs on every load, see below |
| burning-cost (`breadth4`) | 92 (74 measured) | 52 / 22 / 0 | **64 / 3 / 7** | `color.action.primary` #4f7ef8, all 74 | 7 (inline links around blocks) | 0 px (first shot 52 px); 0.000% |

Over the eight sites: 131 of 274 measured stops passed before, 237 of 274 after.

**The 0 px check.** On seven of the eight sites (and div-soup) the fallback-only render is 0 px and the colors render
0.000% with `focus.css` loaded, matching verify without it; Argon, the acceptance case, is 0 px and 0.000%. burning-cost's
first fallback shot differed by 52 px and the re-shot by 0. Mavrikant differs from its own capture on every load
(verify without any focus CSS already reported 474 px there): with `focus.css` 346 px, without it 582 px, and the two
renders differ from each other by 656 px, i.e. the variation is the page's, not the rule's. On every target,
including Mavrikant, **no element matches `:focus-visible` after load with the rule in place**, so the rule has nothing to
paint until a key is pressed.

**Why some stops are still not passing.**
- *Clipped rings (Awfp1314 1, Mavrikant 4):* the control sits in a container with `overflow: hidden` that ends within
  5 px of it, so a ring outside the control is cut off. The site's own indicator was inside the box. These stops are
  worse with the fix and are listed in the PR body and the report ("review these before merging").
- *Inline links wrapping block content (burning-cost 7, Agency 4 of which 2 got worse):* a `display: inline` link
  around `div`s (cards). A solid outline follows the link's own line boxes, which are empty; the browser's default
  `auto` ring follows the children instead, so replacing it loses the faint ring the page had.
- *Translucent controls (Light Bootstrap's 12 table icon buttons):* the button has reduced opacity and the outline is
  painted at the same opacity, so the black ring renders gray (under 3:1). Faint, not none.
- *A focusable scroll container (Argon's "Social traffic" table `div`):* Chrome makes scrollable regions keyboard
  focusable without a `tabindex`; the rule's selector list does not include them.

## Reachability

| Run | SAM controls | Clickable | No Tab stop | Flagged (not a native focusable) | Exempt (reason) |
|---|---|---|---|---|---|
| div-soup (`darkpick/div-soup`) | 9 | 7 | 7 | **7** (`div.q11`, `div.q10`, five `div.t7`) | 0 |
| Agency | 31 | 28 | 7 | 0 | 6 regions over 3 social links (`a.btn.btn-dark`), 1 disabled button (`.disabled`, `pointer-events: none`) |
| burning-cost | 3 | 3 | 2 | 0 | 2 links |
| Argon, Light Bootstrap, gaotianchi, Awfp1314, infi-defi, Mavrikant | 22, 21, 2, 3, 1, 34 | 16, 13, 1, 3, 0, 24 | 0 | 0 | 0 |

div-soup is the clean case: its controls are `div`s with click handlers, the page has no Tab stops at all, and SAM is
what found them. The first probe's other flags (Agency 7, devbattery 16, burning-cost 2) were links, disabled buttons
or badges inside links; they are now reported as exempt with the reason, not flagged. Agency's three social links
(six SAM regions) have no matching Tab stop box but are native links, so they are listed for a look, not counted.

## Limits

- **Default state of the captured route only.** Menus, dialogs and anything opened by a click are not tabbed into;
  focus styles that scripts set (a class added on `focus`, `:focus-within` effects elsewhere on the page) are
  measured only where they change pixels inside the 8 px box.
- **The faint bar is strict.** Chrome's default ring on a button reads faint (468 changed px, 224 at 3:1, 480 needed on
  the control page). Faint means visible but under the 2.4.13 area at 3:1, not invisible.
- **WCAG 2.4.13 style, simplified.** The area test counts changed pixels in the box, not a contiguous perimeter, and
  the contrast is per pixel between its focused and unfocused color. It does not check 2.4.11 (focus not obscured by
  sticky headers) or 2.4.7 beyond what the pixels show.
- **The fix can make a stop worse** where its outline replaces the page's own indicator and cannot be drawn (clipped
  containers, inline links around blocks). The comparison lists them per stop; they need a person.
- **Reachability needs SAM regions** (a hybrid run) and the capture's `clickable` flag; it counts controls SAM found,
  not every control on the page, and a stop "reaches" a control by box overlap.
- **Timing.** One browser at a time; 3 to 30 s per page before, the same after, plus three page loads for the 0 px
  check (more on a page that differs between loads).

## Update 2026-10-28: 25 of 25 on Argon

The last failing Argon stop was the scrollable "Referral visitors" table container, which Chrome makes keyboard-focusable
without a `tabindex`, so the rule's list of native focusables missed it. The rule is now
`:is(<native focusables>, *):focus-visible`: `*` catches browser-focusable containers, and listing the natives keeps
`:is()` at their specificity (it still beats `*:focus{outline:none!important}`). Argon: **0 of 25 → 25 of 25**; with
`focus.css` loaded the page is still 0 px / 0.000% while nothing is focused, and no element matches `:focus-visible`
after load. (The other before → after rows above were measured with the earlier rule.)
