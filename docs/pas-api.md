# Point and say: server API (lane A contract)

Status: v2, 2026-10-28 (v1 + fields found while building: `element.control`, outline `dom-control`, `aliasPreferred` / `retargetedFrom`, `ring.nearest`, root asset fallback; measured latencies). Lane A (server) owns this file; lane B (page) builds against it. If it changes, the version
line changes and a copy goes to `out/pas-contract/pas-api.md`.

The routes mount on the local playground server (`s2t playground --run <run> --app <tokenized site>`; point and say
is on unless `--no-pas`). Everything is under `/__pas/`. Local only: the Host header must be `127.0.0.1` or
`localhost` (with a port), and any `Origin` header must equal `http://<host>` (the playground page and its same-origin
iframe). Keys stay in the server process (Keychain via `loadDotEnv`); no response ever contains a key.

## Page setup (what lane B can rely on)

- The tokenized app is at `/app/` (as before). With point and say on, every HTML page under `/app/` gets
  `<link rel="stylesheet" href="/__pas/tokens.css" data-s2t-tokens>` injected before `</head>`. So aliases follow in
  the iframe exactly as in the server's probe page (setting `--color-blue-400` moves `--color-text-muted`).
- Root-absolute asset URLs in the app (CRA builds: `/static/js/main.js`, `/manifest.json`) resolve: with point and say
  on, any GET the playground does not own is served from the app folder when the file exists there. Argon's router
  then moves the iframe to `/admin/index` with `pushState`; that is fine (same origin), but a hard reload of that URL
  is a 404, so reload the iframe with `/app/`.
- `GET /__pas/wav.js` is the in-page recorder/encoder (`recordWav({maxMs})` → `{result: Promise<{wav, ms}>, stop()}`).
- `GET /__pas/contrast.js` is `src/preview-client/contrast.js` (`auditLive`, `freezeTransitions`, ...).
- `GET /__pas/tokens.css` is the run's `tokens.css`.
- **Coordinates:** `x, y` are **page px** (document coordinates, scroll included) in the iframe, at the capture
  viewport width (`health.run.viewport`, 1440 for both demo runs). SAM, the twins and the server's probe page all use
  that width. If the iframe is narrower, render it at the capture width and scale it with a CSS transform, and divide
  the click by the scale. A click outside the captured page returns 400.
- **Applying a change:** for every item in `changes`, `iframe.documentElement.style.setProperty('--' + cssVar, css)`.
  `css` is always a colour (`#rrggbb`, `#rrggbbaa`, `rgba(...)`), a length (`3px`), or `var(--<token>)`; never other
  CSS. A focus proposal also has `rule`: the one generated `:focus-visible` rule (deterministic, from focus.js, never
  from a model) to add as a `<style>` in the iframe.

## Common fields and errors

Every JSON response carries `ms` (server time for the request, integer). Most carry `timings` (per step, ms).

Errors: `{"error": "<plain text>", "code": "<code>"}` with

| HTTP | code | when |
|---|---|---|
| 400 | `bad_request` | missing/invalid field, not a WAV, click outside the page |
| 403 | `local_only` | Host not 127.0.0.1/localhost, or a foreign Origin |
| 404 | `not_found` | unknown route |
| 405 | `method` | wrong method |
| 413 | `too_large` | body over the limit (WAV 12 s ≈ 384 KB; JSON 64 KB) |
| 502 | `upstream` | ASR, SAM or every Muse provider failed (text says which, never a key) |
| 503 | `warming` | the probe browser is not ready yet (retry after `health.browser.ready`) |
| 500 | `internal` | anything else |

## GET /__pas/api/health

```json
{
  "ok": true,
  "providers": {
    "asr": {"ok": true, "model": "muse-voice-transcribe-1.0"},
    "sam": {"ok": true, "model": "sam-3.1"},
    "muse": [{"id": "baseten", "model": "meta-models/muse-spark-open-1026"}, {"id": "fireworks", "model": "..."}, {"id": "meta", "model": "muse-spark-1.3"}]
  },
  "run": {"dir": "/abs/path/out/argon", "tokens": 44, "pairs": 87, "viewport": {"width": 1440, "height": 900}},
  "browser": {"ready": true, "warmMs": 1400, "error": null},
  "focusBaseline": {"ready": true, "summary": {"stops": 25, "measured": 25, "pass": 0, "faint": 2, "none": 23, "noChange": 14, "skipped": 0}, "ms": 9300},
  "ms": 1
}
```

`providers.*.ok` is false (and `muse` is `[]`) when the key is missing. `focusBaseline` is the Tab-through of the
served app as it is, run once at startup; `ready: false` until done.

## POST /__pas/api/point

Request: `{"x": 430, "y": 222}` (page px). Cached by rounded position.

```json
{
  "point": [430, 222],
  "element": {"tag": "span", "text": "Since last month", "path": "...", "classes": ["text-nowrap"],
              "bbox": [378, 213, 104, 19], "color": "#8898aa", "background": "rgba(0, 0, 0, 0)", "large": false,
              "control": null},
  "outline": {"bbox": [378, 213, 104, 19], "source": "dom",
              "sam": {"bbox": [421, 219, 16, 8], "fromMask": true, "fill": 0.6}},
  "sam": {"ms": 980, "source": "sam-point-mask", "note": null},
  "region": {"id": "r12", "label": "text", "bbox": [0, 0, 0, 0]},
  "controls": {
    "color": {"value": "#8898aa", "token": "color.text.muted", "chain": ["color.text.muted", "color.blue.400"]},
    "background-color": null,
    "border-color": null,
    "border-radius": null
  },
  "tokens": ["color.text.muted", "color.blue.400"],
  "pairs": {"token": "color.text.muted", "count": 21, "pass": 0, "fail": 21, "minRatio": 2.95, "maxRatio": 2.95,
            "items": [{"id": "p57", "text": "Since last month", "bg": "#ffffff", "ratio": 2.95, "required": 4.5, "status": "fail"}]},
  "twins": [{"id": "r43", "bbox": [0, 0, 0, 0], "hex": "#5e72e4", "deltaE": 0, "label": "button", "element": {"tag": "a", "text": "See all", "bbox": [0, 0, 0, 0]}, "tokens": ["button.bg", "color.action.primary", "color.blue.500"]}],
  "warnings": [],
  "timings": {"sam": 980, "sentinel": 40, "pairs": 25},
  "ms": 1010
}
```

- `outline.bbox` is what to draw. For text it is the DOM box (`source: "dom"`), because SAM's point mask on text is a
  single glyph; SAM's own box is kept under `outline.sam`. For controls (the hybrid region under the click is a
  button, icon, input or badge) it is SAM's box when SAM returned one (`source: "sam"`), else the control's DOM box
  (`source: "dom-control"`).
- `element.control` = `{tag, classes, bbox}` of the element that paints the fill/border when it is not the clicked
  element itself (clicking the "Month" label span gives the `a.btn` around it); `null` otherwise.
- `controls[prop].token` is the token that **actually** controls that property, found with the sentinel probe. Text
  colour is read on the clicked element; fill, border colour (only when there is a border) and radius on the nearest
  element (itself or up to 4 ancestors) that paints one. The probe: in the server's headless copy of the app, every colour token is set in turn to `#ff00fe` (radius
  tokens to `37px`) and the element's computed style is read. `chain` lists every token that moved it, nearest first
  (the nearest is the one no other member aliases). `null` = no token controls it (a literal colour).
- `tokens` is the union of every controlling token of the element (all properties, all chain members).
- `pairs` = every text pair on the page whose colour comes from `controls.color.token` (sentinel over the whole page,
  live-measured backgrounds). `null` when no token controls the text colour.
- `twins` = look-alike controls (same kind, ΔE76 < 6, size within 2x; see docs/pas-spike.md). Highlights only. Each
  twin has its own sentinel-found `tokens`.

## POST /__pas/api/transcribe

Request: body = a 16 kHz mono 16-bit PCM WAV (`content-type: audio/wav`), at most 12 s. Forwarded to
`muse-voice-transcribe-1.0` with `store: false`.

```json
{"transcript": "This label is too light, make it readable. Keep our gray.", "ms": 1403, "audioMs": 4300}
```

`ms` here is the ASR round trip (the server's own overhead is under 5 ms).

## POST /__pas/api/intent

Request: `{"transcript": "...", "point": {"x": 430, "y": 222}}`. `point` is optional only for the focus route
(the ring is page-wide). The point lookup is the same (cached) as `/api/point`, so the page does not need to resend it.

```json
{
  "route": "contrast",
  "matched": "too light",
  "transcript": "This label is too light. Make it readable, keep our gray.",
  "changes": [
    {"token": "color.text.muted", "cssVar": "color-text-muted", "value": "#687889", "alias": null, "css": "#687889",
     "from": "#8898aa", "why": "Darker in the same hue (OKLCH L 0.673 → 0.566) so all 21 text pairs using it reach 4.5:1"}
  ],
  "rule": null,
  "summary": "21 elements, 2.95:1 → 4.53:1, text contrast (color.text.muted, hue kept).",
  "predicted": {
    "affected": 21,
    "before": {"min": 2.95, "max": 2.95, "pass": 0, "fail": 21},
    "after": {"min": 4.53, "max": 4.53, "pass": 21, "fail": 0},
    "page": {"before": {"pass": 46, "fail": 41}, "after": {"pass": 67, "fail": 20}},
    "regressions": [],
    "blocked": false,
    "reason": null
  },
  "model": null,
  "rejected": [],
  "timings": {"point": 0, "decide": 30, "check": 25},
  "ms": 60
}
```

Routes (deterministic first; `route.js` keys on intent words, not token names):

- **`contrast`** ("readable", "too light", "contrast", "hard to read", "darker"...): no model. The token that controls
  the clicked text's colour (sentinel), the smallest OKLCH lightness change with the hue kept (`contrast-fix.js`) that
  brings **every** pair using it to 4.5:1 (3:1 large) on the measured backgrounds. The value is written on that token
  (an alias becomes a value), so the primitive's other users do not move.
- **`focus`** ("focus", "keyboard", "tab", "ring", "outline", "where I am"): no model. The focus-ring component tokens
  and one `:focus-visible` rule from focus.js. `changes` are `focus.ring.color` (+ `focus.ring.inner-color` when
  two-tone), `focus.ring.width`, `focus.ring.offset`; their `css` is `var(--<colour token>, #hex)` or a length.
  Colour: if the transcript names a colour ("our blue"), the best token of that hue (action/semantic first); if it
  falls under 3:1 against what surrounds some controls, the ring is **two-tone in that hue** and `summary` says so
  (e.g. "Two-tone: color.action.primary is under 3:1 on 4 of 25 controls, so a white band is added."). No colour
  named: focus.js's own choice. No token of the named hue: the nearest hue within 30° (`ring.nearest: true`; Light
  Bootstrap's "blue" is `color.teal.300`, and the summary says so). `ring` = `{mode, color, inner, covered, total, hue,
  nearest}`. `rule` is the CSS to add. `predicted` = `{affected: <stops>, ring: {...}}`; the real
  before/after comes from `/api/focus-check`.
- **`muse`** (anything else): Muse Spark Open, provider chain Baseten → Fireworks → hosted Muse Spark (first that
  answers). The model sees only the tokens that **control** the clicked element and its twins (sentinel-found, not
  value-matched) as CHANGEABLE, and every colour/radius token as alias targets. The reply is sanitized
  (`sanitizeProposal`), restricted to CHANGEABLE, and post-processed: an alias or hex that equals a semantic token's
  value is pointed at that **semantic** token (`color.blue.500` → `color.action.primary`; `aliasPreferred` keeps what
  the model said); a change aimed at a primitive in the chain moves to the nearest non-primitive token in that chain
  (`retargetedFrom` keeps the primitive). A request for a property no token controls (Argon's buttons have no radius
  token) maps to nothing and returns `none`. A change that
  is already in place is kept with `"noop": true` (the card can say "already our brand blue"). `model` =
  `{provider, model, ms}`; `rejected` lists what was dropped and why.
- **`none`**: nothing usable (no token controls the clicked element, the model's reply mapped to nothing, or no point
  for a contrast/muse request). `changes: []`, `summary` says why, `transcript` echoed.

Change item: `{token, cssVar, value|null, alias|null, css, from, why, noop?, isNew?, aliasPreferred?, retargetedFrom?}`; exactly one of `value` /
`alias` is set. `from` is the token's current resolved value.

`predicted` (contrast and muse): the server applies `changes` in its headless copy and re-audits **every** text pair
on the page: `affected` = pairs whose ratio moved, `before`/`after` = ranges over those pairs, `page` = whole-page
counts, `regressions` = pairs that passed and now fail or that fail and got worse (`{id, text, from, to}`).
`blocked: true` when there is any regression; `reason` names the check and the first element
("text contrast: \"Since last month\" 4.6 → 3.1"). The page should still re-audit live (`auditLive`) after applying.

## POST /__pas/api/focus-check

Request: `{"changes": [<change items from an intent response>]}` (only `token` + `css` are read; items are
re-sanitized: known tokens or `focus.ring.*`, colour/length/`var(--known)` values). The server builds the token block and the
focus rule itself (never CSS from the request), loads the served app with them in the warm browser, and Tabs through.

```json
{
  "before": {"stops": 25, "measured": 25, "pass": 0, "faint": 2, "none": 23, "noChange": 14, "skipped": 0},
  "after": {"stops": 25, "measured": 25, "pass": 25, "faint": 0, "none": 0, "noChange": 0, "skipped": 0},
  "compare": {"matched": 25, "better": 25, "same": 0, "worse": []},
  "ring": {"mode": "two-tone", "color": "var(--color-action-primary, #5e72e4)", "inner": "#000000"},
  "timings": {"load": 1400, "tab": 7700},
  "ms": 9200
}
```

`worse` items: `{tag, text, before, after, clippedBy?, inlineWrapsBlock?}`. `before` is the startup baseline (503 with
`code: "warming"` if it is not done yet). One focus check at a time; a second request waits for the first.

## Latencies (measured 2026-10-28, warm server, model/SAM cache off: `S2T_CACHE=0`)

`node scripts/pas-lane-a/live.mjs` drives the endpoints over HTTP, 3 runs per request, click cache cleared each run.

| Endpoint | Argon | Light Bootstrap |
|---|---|---|
| startup: probe page warm | 1.3–1.4 s | 1.3 s |
| startup: focus baseline (Tab-through) | 9.2 s | 11.2–11.6 s |
| `transcribe` (ASR round trip, 3.8–5.3 s clips) | 0.87–1.58 s | 0.96–1.74 s |
| `point` (SAM ‖ sentinel, then pairs + twins) | 0.85–1.60 s (SAM 0.73–1.49 s, sentinel 46–93 ms) | 0.89–2.11 s (SAM 0.78–1.79 s, sentinel 43–53 ms) |
| `intent` contrast (point already resolved) | 13–15 ms | 12–18 ms |
| `intent` focus | 1–3 ms | 1–3 ms |
| `intent` muse (Muse Spark Open on Baseten) | 2.1–2.6 s | 3.1–5.2 s |
| `focus-check` | 9.0–9.4 s | 11.4–11.7 s |

The page can call `point` on click and `transcribe` when the person stops talking in parallel; `intent` then needs
only its own time (the point lookup is cached). What the person waits for after speech: ASR + intent, about 1.1–1.6 s
for contrast and focus, about 3.5–7 s for Muse; the focus check adds 9–12 s (show progress).
