# Point and say

Click something in the running app, then say or type what to change. The playground maps the request to design
tokens, applies the change to the live app and checks it before you keep it. Requests that would make text harder to
read somewhere on the page are **blocked** and reverted, and the card names the check and the element.

Plan: `spec/metatoy-studio/hackathons/point-and-say-plan.md`. Server contract: [`pas-api.md`](pas-api.md) (v2).
Spike: [`pas-spike.md`](pas-spike.md). Measured end to end through the page in Chromium on 2026-10-28 (join step,
branch `loop/pas-join`).

## How to run

```sh
node src/cli.js playground --run out/argon --app out/argon/site     # point and say is on by default (--no-pas turns it off)
```

Open the printed `http://127.0.0.1:<port>/` and click **Point and say**. Then click something in the app. Hold
**Hold to talk** while you speak, or type in the field and press Enter. The server binds 127.0.0.1 only. Keys are read
from the macOS Keychain by `loadDotEnv` and stay in the server process. The static GitHub Pages playground has no
`/__pas/` routes, so the feature hides itself there.

At startup the server opens a headless copy of the app (about 1.3 s) and runs one keyboard Tab-through as the focus
baseline (9 s on Argon, 11 s on Light Bootstrap). The page waits for the baseline before it runs a focus check.

## What it does

1. **Point.** The click goes to `POST /__pas/api/point` with page coordinates at the capture width (1440). The server
   runs **SAM 3.1**'s point prompt on the run's screenshot. It finds the element under the click and the tokens that
   *actually* control its colour, background, border and radius. To find those, it sets each token in turn to a
   sentinel colour in its headless copy and reads which ones move the element. It also lists every text pair that uses
   the clicked element's text-colour token, and look-alike controls ("twins"). The page draws the outline (pink) and
   the twins (dashed orange) over the iframe.
2. **Say.** The page records with MediaRecorder and encodes 16 kHz mono WAV in the browser (`/__pas/wav.js`).
   `POST /__pas/api/transcribe` sends the WAV to **`muse-voice-transcribe-1.0`** (`store: false`). You can also type.
3. **Map.** `POST /__pas/api/intent` routes on intent words, deterministic first (next section). Only the
   free-form route uses **Muse Spark Open** (`meta-models/muse-spark-open-1026` on Baseten, falling back to Fireworks
   and then to hosted Muse Spark).
4. **Apply and check, in the page.** Each change is a token: a `--css-var` set on the iframe's root, so aliases and
   every element that shares the token follow. The page re-measures text contrast on the whole live page
   (`auditLive`), before and after. If any pair regresses, or the server's prediction says it is blocked, the page
   reverts the change at once and shows **BLOCKED** with the check and the element. A focus proposal adds the one
   generated `:focus-visible` rule and calls `POST /__pas/api/focus-check`, which Tabs through the served app with the
   ring (9 to 12 s).
5. **Keep, undo, or hand off.** **Keep (preview)** keeps the change. **Copy proposal link** shares it as `?tokens=`.
   **Show PR command** prints `s2t review` / `s2t pr` but does not run them. **Reset all** clears the token changes,
   the focus rule, the outline and the card.

No model ever sends CSS to the page. The server sanitizes every change down to a known token name plus a colour, a
length or `var(--known-token)`. The focus rule comes from `focus.js`, never from a model.

## Deterministic first

| Request (route) | Who decides | What changes |
|---|---|---|
| "too light", "readable", "contrast", "darker" (`contrast`) | `contrast-fix.js`, no model | The clicked text's controlling token gets the smallest OKLCH lightness change, hue kept, that brings **every** pair using it to 4.5:1 (3:1 for large text). The value goes on that token, so the primitive's other users do not move. |
| "focus", "keyboard", "tab", "ring" (`focus`) | `focus.js`, no model | Tokens `focus.ring.color` / `inner-color` / `width` / `offset` plus one `:focus-visible` rule. A named colour ("our blue") picks the best token of that hue. If that colour is under 3:1 next to some controls, the ring gets a contrasting band (two-tone). If no token has the hue, the nearest hue is used and the card says so: "nearest blue in your tokens is teal (color.teal.300)". |
| anything else (`muse`) | Muse Spark Open | Only tokens that control the clicked element or its twins can change. An alias to a primitive is pointed at the semantic token with the same value; the card says "moved to the semantic token". A change already in place is marked `noop`; the card says "already that value" and applies nothing. |

Muse only interprets requests that cannot be computed. The checks gate every route the same way.

## Results (through the page, real apps, Chromium)

Driver: `scripts/pas-join/e2e.mjs`. It clicks inside the playground's iframe, types the request (or holds the mic
while Chromium's fake device plays a `say` WAV), and waits for the page's own final state. Server started with
`S2T_CACHE=0`; each repeat clicks 3 px over so SAM and the sentinel run again. Wall = click → final state on the card.
For typed requests that includes no typing time; for voice it includes the time the mic is held.

| # | App, click, request | Expected | Got | Runs | Wall time |
|---|---|---|---|---|---|
| a | Argon, "Since last month", typed *"This label is too light. Make it readable, keep our gray."* | `color.text.muted` #8898aa → #687889; 21 elements 2.95:1 → 4.53:1; page 41 → 20 failing; 0 regressions | Same, all three runs: #687889, 21 elements, 2.95 → 4.53:1, whole page 41 → 20 failing of 87, 0 regressions | 3/3 | 1.30, 1.04, 1.14 s (point 1.0–1.2 s, intent 14–19 ms) |
| b | Argon, same click, same line **spoken** (fake mic, Samantha 180) | Same as (a) | Transcript "This label is too light, make it readable. Keep our gray." → same change and numbers | 1/1 | 6.19 s with 4.4 s of mic hold; **1.67 s after speech ended** (ASR 1.57 s) |
| c | Argon, sidebar "Icons", typed *"Give every control a visible focus ring in our blue."* | focus 0 pass / 2 faint / 23 none → 25 / 0 / 0; Tab shows the ring | 0/2/23 → 25/0/0, 0 worse, all three runs. Two-tone ring in `color.action.primary` with a black band. Tab: `a "Login"` `:focus-visible`, outline 3px rgb(94,114,228) + black band | 3/3 | 10.34, 9.01, 10.08 s (focus check 8.9–9.0 s) |
| d | Argon, "Month", typed *"Make these buttons red."* | BLOCKED, element named, reverted | "BLOCKED: text contrast would regress on "Month" (4.20:1 → 3.77:1), and 2 more." The server agrees. Reverted: no token overrides left in the iframe. | 1/1 | 2.87 s (Muse 1.67 s) |
| e | Light Bootstrap, "Number", typed contrast line | 12 elements, 2.81 → 4.54:1 | `color.text.muted` #9a9a9a → #767676, 12 elements 2.81 → 4.54:1, whole page 70 → 58 failing of 84 checked, 0 regressions | 1/1 | 1.58 s |
| f | Light Bootstrap, "Account", typed *"Make these buttons our brand blue."* | BLOCKED | Muse: `color.gray.400` → `color.teal.300`. "BLOCKED: text contrast would regress on "Dashboard" (3.54:1 → 2.02:1), and 3 more." Reverted (Account reads #888888 again with the cursor off it) | 1/1 | 5.00 s (Muse 3.96 s) |
| g | Light Bootstrap, focus line (extra) | ring in the nearest hue, said so | "Nearest blue in your tokens is teal (color.teal.300)". Focus 12/11/12 → 23/12/0, 0 worse | 1/1 | 12.0 s (focus check 11.9 s) |

Also checked:
- **Iframe reload.** Argon's router moves the frame to `/admin/index`, and a hard reload of that URL is the
  playground's 404. The page now sends the frame back to `/app/`, and point and say keeps working after the reload
  (`scripts/pas-join/reload-check.mjs`: Argon and Light Bootstrap, the click after the reload resolves).
- **Reset all.** It clears the overlay, the card, the focus rule and every `--var` the change set in the iframe. The
  check runs after every driver run.
- **No console errors** on any run.

Evidence: `out/pas-join/*.json` (one row per run, with timings and the iframe's end state). Screenshots
`out/pas-join/<app>-<step>-*.png` (overlay, recording, transcript, card, Tab ring, PR command). The video is
`out/pas-join/demo-take.webm` (1280x720, 28 s, (a) then (c) with Tab).

## Latency, what the person waits for

| Step | Argon | Light Bootstrap |
|---|---|---|
| Click → outline and controlling token (SAM ∥ sentinel) | 1.0–1.2 s | 0.9–1.5 s |
| End of speech → transcript (ASR) | 1.57 s | not run through the page (endpoint: 0.96–1.74 s, `pas-api.md`) |
| Transcript → applied and checked, contrast (server decision + page apply and whole-page re-audit) | under 0.15 s | under 0.15 s |
| Transcript → blocked and reverted, Muse | 1.7–2.3 s | 3.4–4.0 s |
| Focus check (Tab-through with the ring) | 8.9–9.2 s | 11.9 s |

The click comes before the person speaks, so in practice SAM finishes while they talk. For contrast and blocked
requests the plan's "under 15 s warm" holds with room to spare. The focus route is the slowest at about 10 s,
almost all of it the Tab-through.

## Limits

- **No real human voice has been tested yet.** All speech here is macOS `say` through Chromium's fake mic. The fake
  device loops its file, so a long hold can repeat words; routing keys on intent words, so the intent survives.
  Typing is always available.
- **The focus check takes 9 to 12 s.** The card shows progress. The proposal no longer states a predicted coverage
  count (on Light Bootstrap it predicted "35 of 35 covered" while the Tab-through measured 23 pass and 12 faint).
  `/api/focus-check` now returns a `summary` built from the measured pass / faint / none, and the card's summary line
  is replaced with it when the check finishes (`focusResultSummary`, `focus-intent.js`).
- **Local only.** 127.0.0.1, the founder's keys from the Keychain, and same-origin checks on every `/__pas/` route.
  It is not deployed anywhere.
- Light Bootstrap's live page checks 84 of 96 pairs (12 not visible in that view). The server's own count uses all
  96.
- Muse's wording varies between runs (for example, which twins it names). The token change and the block verdict
  were the same in every run here and in lane A's runs.
- Only one app state per click: hover and active states are not targeted (out of scope in the plan).
