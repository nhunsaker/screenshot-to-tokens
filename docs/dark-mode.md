# Dark mode as a token file (`s2t dark`)

Once an app's colors are tokens, a dark theme is one more CSS file. `s2t dark` asks Muse Spark for dark values, checks
every captured text pair in the running app with those values, retries once with the failures fed back, and writes
`tokens.dark.css`. Nothing is merged: the file goes into the PR as an optional file with its own section.

## Run it

```sh
node src/cli.js dark --run out/app-argon                    # Muse Spark Open on Baseten (default)
node src/cli.js dark --run out/app-argon --provider meta    # hosted Muse Spark 1.3
node src/cli.js dark --run out/app-argon --provider both    # both; keeps the one with fewer failing pairs
```

The run folder needs `tokens.json`, `clusters.json`, `capture.json`, `tokens.css`, `rewrite.json` and `run.json`, and
the tokenized site that verify serves (`<run>/site` for a partly rewritten build, else `<run>/rewritten`). It writes
three files into the run folder:

- `tokens.dark.css`: the dark values under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
  and under `:root[data-theme="dark"]`. Load it after `tokens.css`. It follows the system setting, and
  `data-theme="light"` or `"dark"` on `<html>` overrides it either way.
- `dark.json`: text pairs passing before and after, every round from every provider (changes, timings, cached or
  not), which provider and round won, the remaining failures, and the token reach (below).
- `dark.png`: a full-page screenshot with the dark values forced on (`screenshotUrl` from the capture stage). There is
  no pixel gate: dark mode is meant to change pixels.

**Models.** Muse Spark Open on Baseten is the default; with `--provider baseten` or `meta` the other one is the
fallback if the call fails. `--provider both` runs the whole loop (first try and retry) on each, one after the other,
and keeps the proposal with fewer failing pairs; `dark.json` records both, so a run shows both Meta model paths.
Calls use `reasoning_effort: low`. A model id ending in `-contributor` is refused. The key stays in this process
(Keychain via `src/config.js`) and is never printed; errors carry the status and a short body only. Data sent: token
names, color values and contrast numbers (class C). Replies are cached in `out/.cache`; `S2T_CACHE=0` for timings.

**Pages demo.** `sorb-preview.js` now takes `data-dark-css="tokens.dark.css"`: it loads the file and shows a
"Dark theme (proposal): on/off" button that flips `data-theme` on `<html>`. `?theme=dark` (or `light`) sets it from
the URL, so a link can open the demo dark. `node scripts/preview-site.mjs <run>` copies `tokens.dark.css` when the run
has one and adds the attribute.

**PR.** `s2t pr` copies `tokens.dark.css` next to `tokens.css` and appends a "Dark theme (optional file)" section to the
body (pairs passing in the light and dark theme, what is not checked). No dark run, no file and no section.

## What is checked

The contrast logic is the L11 playground's (`src/preview-client/contrast.js`), run in a headless browser instead of
the playground page.

- **Pairs.** Every captured element with its own text (`capture.json`) is one pair. Each is found again in the live
  page by its path and text; colors come from `getComputedStyle`, the background from what is painted under the text
  (hit-testing, translucent layers composited, the worst stop of a gradient). Hidden elements and text over images are
  counted as "not checked".
- **Thresholds.** WCAG 2.x AA: 4.5:1 for body text, 3:1 for large text (24px, or 18.66px and bold).
- **It must be dark.** At least half the checked text must sit on a background with relative luminance at most 0.12.
  A model sometimes answers with a light theme (seen on Argon in L11, and on proinsias here: 5 of 12 answers before
  the prompt named the main background tokens). That answer is rejected however well it scores; if no round is dark,
  no `tokens.dark.css` is written.
- **One retry.** If the first answer is not dark or leaves failures the tokens can fix, the model gets its previous
  theme and those failures back once. The round with the fewest failing pairs that is dark is kept (the retry is not
  assumed better); across providers the same rule picks the winner, the default provider on a tie.
- **Token reach.** Before asking, the stage sets every color token to a probe color and checks again. A text or
  background color that does not move is a literal the rewrite did not tokenize. Failures split three ways in
  `dark.json`: on a gradient (no token controls it), untokenized (the text color is a literal, so in a dark theme the
  only fix would be a light surface), and fixable. Literal sides are marked "no token" in the prompt.
- **The file itself.** After a winner is picked, `tokens.dark.css` is loaded with `data-theme="dark"` on `<html>` and
  every pair is checked again; that is the "after" number. If it differs from the round's own check, the site's CSS
  reacts to `data-theme` too, and `dark.json` says so (`attributeNote`).

## Results (2026-10-27, uncached, `--provider both`)

| Run | Text pairs passing, light | Dark (tokens.dark.css) | Text-is-a-token pairs, light → dark | Winner |
|---|---|---|---|---|
| Argon (`out/rec-argon` copy, re-named with L13 on-surface tokens) | 46 of 87 | 74 of 87 | 42 of 43 → 43 of 43 | Muse Spark 1.3, retry |
| proinsias.github.io (breadth pool, re-named with L13) | 55 of 57 | 50 of 57 | 47 of 49 → 45 of 49 | Muse Spark 1.3, retry |

Timings per call (first try + retry): Argon, Baseten 9.9 s + 5.8 s, Meta 23.0 s + 19.4 s; proinsias, Baseten 11.5 s +
18.8 s, Meta 31.6 s + 45.5 s. Answers vary between runs: on proinsias two uncached runs gave 47 and 50 of 57 (the
second after the prompt started naming the main background tokens), and the pair check itself can differ by one pair
between runs.

- **Argon.** In the light theme 41 pairs fail (mostly `#8898aa` muted text on white). In the dark theme 13 fail, and
  none of them is fixable with tokens: 11 have a literal text color (the sidebar links `rgba(0,0,0,.5)`,
  `.text-muted{color:#8898aa!important}`, "Upgrade to PRO") and 2 are white text on the cyan header gradient. Every
  pair whose text color is a token passes. The sidebar, the page background (`body` `#f8f9fe`) and the header gradient
  are not tokens, so Argon's dark mode is partial: the cards, tables and footer go dark, the sidebar and the strip
  under the header stay light. Muse Spark proposed values for `color.text.on-primary` (L13), so button text stays
  light on the dark buttons.
- **proinsias (on-camera pick).** The page background is a token (`nav.bg` on `body`), so the main page goes dark. The
  masthead bar and the footer have literal light backgrounds and stay light; the 4 "Follow: / Feed" footer pairs fail
  because the muted text token went light while the footer stayed light, and 3 "Skip to" links have a literal text
  color. 2 pairs already failed in the light theme.
- **Picked against.** DiogoRibeiro7 (body background `#fafaf9` is a literal: 75 of 100 in the dark theme, from 100 of
  100) and devbattery (its own CSS already has a `[data-theme="dark"]` theme, so the attribute switched the site's
  theme rather than ours; `dark.json` flags it).

Screenshots: `out/l14-argon/dark.png`, `out/l14-proinsias-l13/dark.png`; the toggle on the preview site:
`out/l14-proinsias-l13/toggle-dark.png`.

## Limits

- **Text contrast only**, on the captured route at capture time. Not hover or focus states, placeholders, icons,
  borders or other non-text contrast; element `opacity` and text shadows are ignored.
- **Only tokens move.** Literal colors the rewrite did not tokenize (Argon's sidebar and page background, proinsias's
  masthead and footer) keep their light values, so a dark theme over a partly tokenized app is partial. `dark.json`
  counts these instead of blaming the model.
- **Gradients and images** are not tokens; text on them is reported, never fixed.
- **One token, two surfaces.** When the same text token sits on a token surface and on a literal light one, no single
  value passes on both. Splitting the token (as L13 does for on-surface text) is the fix, not the dark theme.
- **`data-theme` is shared.** A site that already uses `data-theme="dark"` for its own theme reacts to the toggle too.
- **Model variance.** Two runs of the same prompt can differ by several pairs; the check, not the model, decides what
  ships, and the numbers above are from one run each.

Wording for the video and README follows the spec: say "text contrast" and name the numbers ("41 text pairs fell below
WCAG AA; in the dark theme every pair whose text color is a token passes"); never "accessible" as a verdict or
"compliant".
