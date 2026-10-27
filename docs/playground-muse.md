# Playground + Muse: contrast audit and dark theme (local only)

The token playground (`src/preview-client/playground.html`) gets two tools:

- **Check contrast**: a WCAG 2.x AA audit of the running app with the current token values. This step is deterministic
  and does not call a model. **Ask Muse to fix these** sends the failures to Muse Spark. Muse proposes token values,
  and the page checks each proposal again before offering it.
- **Build a dark theme**: Muse re-points the semantic tokens (and may add primitives). The theme is applied as a
  preview and every text pair is checked. If anything fails, or the result is not actually dark, the page makes one
  automatic retry with that fed back.

Nothing is merged. Applied changes stay in the page, and **Copy proposal link** gives the usual `?tokens=` link
(the app's `sorb-preview.js` shows its "preview, not merged" banner).

## Run it

```sh
node src/cli.js playground --run out/app-argon --app /Volumes/SanDisk/s2t-demo-apps/s2t-pages/tokens
# open http://127.0.0.1:4400/   (--port, --provider baseten|meta, --title)
```

The server listens on 127.0.0.1 only. It serves the page, `contrast.js`, `tokens.json` (built from the run), the app
under `/app/` (same origin, so the page can set custom properties inside the iframe) and `POST /api/muse`.

- The API key stays in the server process (macOS Keychain via `src/config.js`) and never reaches the browser.
- `/api/muse` refuses any Host other than 127.0.0.1 or localhost (blocks DNS rebinding) and any cross-origin POST.
- The browser cannot send its own prompt. The server rebuilds the prompt from known token names, color values and
  contrast numbers (class C data), and checks the model's reply against the run's tokens.
- **Never deploy this.** The founder declined a public relay.

**Models.** Muse Spark Open on Baseten is the default. Hosted Muse Spark (Meta) is the option in the dropdown, and each
is the fallback for the other. Calls use `reasoning_effort: low`. A model id ending in `-contributor` is never used.
Replies are cached like every other chat call (`out/.cache`).

**Static build.** `node scripts/build-playground.mjs <run> <out>` also copies `contrast.js` and puts the pairs into
`tokens.json`, so the audit works on GitHub Pages too. The page checks for `/api/muse` and hides the Muse buttons when
it is missing; the one 404 in the console is that check. An older deployed build without `contrast.js` or pairs keeps
working as before, with the tools hidden.

## What is checked

- **Pairs.** Every captured element with its own text (`capture.json`) is one pair. The page finds each element again
  in the live iframe by its path and text.
- **Colors.** Colors are read live with `getComputedStyle`, so the check always uses the current token values.
  Transitions are turned off while reading, because Argon's links fade and a mid-fade color would give a wrong result.
- **Background.** The background is whatever is painted under the text, found by hit-testing (`elementsFromPoint`) and
  then compositing translucent layers. Walking up through parent elements missed Argon's absolutely positioned gradient
  header. For a gradient, the worst stop counts. A background image cannot be checked and is reported as such.
  Elements hidden at the current width are counted as "not checked".
- **Thresholds.** 4.5:1 for body text, 3:1 for large text (24px, or 18.66px and bold).
- **Fixes.** Each proposed change is applied on its own and the page is checked again. A change is offered only if it
  fixes at least one failing pair and breaks none. The verified changes are then checked together.
- **Dark theme.** Most of the text must sit on a dark background (relative luminance at most 0.12). The round with the
  fewest failures that is also dark is kept; the retry is not assumed to be better. Failures on a gradient are shown
  separately because no token controls them.

Pure functions live in `src/preview-client/contrast.js` and `src/stages/playground.js`, with tests in
`test/contrast.test.js`. The unsafe-value rule is shared with `sorb-preview.js`, and a test keeps the two identical.

## Results on Argon (`out/app-argon`, 2026-10-26)

- **Audit:** 41 of 87 text pairs fail AA (9 color pairings). Most are `color.text.muted` #8898aa on white (2.95:1),
  plus the status greens, oranges and reds, and white on the cyan gradient header.
- **Muse fix** (Baseten, 6.9 s, and 12.3 s after a prompt change): 7 changes proposed and 6 verified. 41 → 2 failing.
  The 2 that remain are white text on the gradient header, which has no token.
- **Dark theme** (Baseten, 11.9 s, then a 4.2 s retry): the first try left 2 fixable failures and the retry fixed them.
  84 of 87 pairs pass and the main text background is #172033. The 3 failures sit on gradients. One of them is a real
  tokenization finding: the run gave white text and white surfaces a single token (`color.surface.default`), so a
  dark surface also turns "Sales value" dark on the dark card.
- **Hosted Muse Spark** (Meta) on the fix path: 6.4 s.

## Limits

- Only what was captured is checked: one route, at capture time. Text added later, other routes, placeholders,
  hover/focus states and icons are not checked.
- Non-text contrast (borders, icons, 3:1 UI components) is out of scope.
- Element `opacity` is ignored, and text shadows are not considered.
- Token mapping goes by value. A failing color is linked to every token with the same current value, so white text
  and white surfaces share candidates. A proposal that moves the wrong one gets caught by the re-check, not prevented.
- Argon's page background (`body` #f8f9fe) and its gradients are not tokens, so a dark theme cannot reach them. The
  area under the cards stays light.
- A dark-theme retry can be slow. One measured retry took 46 s, before the prompt was changed to ignore gradient pairs.
