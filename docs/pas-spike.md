# Point and say: spike results (2026-10-28)

The 2-hour go/no-go spike from `spec/metatoy-studio/hackathons/point-and-say-plan.md`, "Spike first". Branch
`loop/pas-spike`. The code is modular so lanes A and B can promote it as is.

**Verdict: GO.** One condition: the coder fix in this branch (below) has to land and the demo runs have to be re-run
with it. Without the fix, the Argon demo click ("Since last month") is not controlled by any token, and the loop
has nothing to change.

## What was built

| File | What |
|---|---|
| `src/stages/pas/wav.js` | In-page recorder + encoder: MediaRecorder → decodeAudioData → 16 kHz mono 16-bit WAV (pure `encodeWav`, `resample`, `floatTo16`, `readWavHeader`; no imports, so the browser loads it) |
| `src/stages/pas/transcribe.js` | Forwards a WAV to `muse-voice-transcribe-1.0` (multipart `request` + `audio`), with `store: false` and the WAV checked first |
| `src/stages/pas/point.js` | `pointAt(ctx, x, y)` runs the SAM 3.1 point prompt on the run's screenshot (nontext.js tiling), then finds the DOM element under the click, its colour tokens, and its twins |
| `src/stages/pas/twins.js` | Look-alikes from the run's hybrid regions: same kind, ΔE76 < 6 on the control's own colour, width and height each within 2x; stroke-coloured matches also need similar surroundings |
| `src/stages/pas/contrast-fix.js` | OKLab/OKLCH conversions and `contrastFix(token, pairs, tokens)`: the smallest OKLCH lightness change, hue kept, that brings every pair using the token to 4.5:1 (3:1 large) |
| `src/stages/pas/route.js` | Deterministic-first routing on intent words: contrast, focus, or Muse |
| `src/stages/pas/intent.js` | Muse Spark Open mapping (intent.mjs prompt), sanitized and restricted to tokens that touch the clicked element and its twins |
| `src/stages/pas/server.js` | `pasHandler()` for `/__pas/api/transcribe`, `/__pas/api/point`, `/__pas/wav.js`, `/__pas/contrast.js` (local only, same origin) + a spike server that serves the app at `/` |
| `scripts/pas-spike/*` | Drivers: `make-phrases.sh`, `speech.mjs`, `argon-loop.mjs`, `lb-twins.mjs`, `rewrite-site.mjs`, `pixel-check.mjs`, `asr-probe.mjs`, `mic-debug.mjs` |
| `test/pas.test.js` | 17 unit tests (WAV, ASR request, OKLCH + contrast fix, routing, twins, point helpers, proposal restriction) |

`nontext.js` now exports `callSamPoint` and `windowFor`. No other API changes.

## Coder fix (found by the spike; must land before recording)

The deterministic coder's declaration regex required a `;`. In minified CSS the last declaration of a block has none
(`.text-muted{color:#8898aa!important}`), and `!important` was read as part of the value, so neither was rewritten.
The fix: `DECL_RE` accepts a trailing `}` (lookahead) and an optional `!important`, which is kept after the `var()`.
There is a test in `test/rewrite.test.js`.

| | Argon (m12-argon) | Light Bootstrap (darkpick) |
|---|---|---|
| Edits before → after | 412 → 844 | 387 → 692 |
| `color.text.muted` uses after | 36 | 15 |
| Pixels: original build vs rewritten (fallbacks only) | 0 px (before and after) | 0 px (before and after) |
| Pixels: original vs rewritten + tokens.css | 17,985 px before and after (unchanged) | 22,957 → 32,076 px |

On the canonical `out/m12-argon` site, the loop finds no token for the clicked text (`token null; 0 pairs`). The rewrite
pass fixes that. Light Bootstrap's merged-colour drift grows by 9,119 px with tokens.css applied, because more literals
now carry their merged token value. Re-run both demo runs end to end (verify included) before relying on them.

## 1. Speech through the browser path: 6 of 6 (pass ≥ 5)

Phrases were made with macOS `say` and converted to 48 kHz WAV with lead and tail silence. Chromium (Playwright,
`channel: 'chromium'`) played each one through `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture`.
The page recorded it with MediaRecorder, encoded it in the page to 16 kHz mono WAV, and POSTed it to the local
`/__pas/api/transcribe`. That endpoint forwarded it to `muse-voice-transcribe-1.0`. Phrase (f) is (a) mixed with pink
noise at about -20 dBFS RMS. The speech itself averages about -18 dBFS, so the noise is nearly as loud as the voice.

| # | Voice, rate | Transcript | Route | Intent ok | ASR ms |
|---|---|---|---|---|---|
| a | Samantha 180 | This label is too light, make it readable. Keep our gray. | contrast | yes | 1403 |
| b | Daniel 200 | Give everyGive every control a visible focus ring in our blue. | focus | yes | 1488 |
| c | Karen 220 | Make this text darker so it's easier to read. | contrast | yes | 1275 |
| d | Moira 170 | I can't see where the keyboard focuses. | focus | yes | 1171 |
| e | Fred 210 | Make these buttons our brand blue. | muse | yes | 1170 |
| f | Samantha 180 + noise | This label is too light, make it readable. Keep our gray. | contrast | yes | 1448 |

- (b) "Give everyGive every" is the fake device looping its file past the end of the recording window. The ASR heard
  what was played; this is not an ASR error. (d) "focuses" still routes to focus. In the loop runs, (a) came back
  three times as "keep **are** gray". Routing keys on "too light", so the intent survives.
- ASR round trip: 1.2 to 1.6 s for 4 to 5 s of audio.
- `store: false` in the ASR `request` part is **accepted** (200; `scripts/pas-spike/asr-probe.mjs`). We cannot see
  whether it is honored. It is sent on every call.
- Recording: an AudioContext + ScriptProcessor capture produced **no samples** in headless Chromium. MediaRecorder
  with a 250 ms timeslice, decoded by `decodeAudioData`, works. A recorder stopped by its timer without a timeslice
  came back undecodable.
- **Not tested: a real human voice.** No founder clip was available. This is the remaining speech risk (accent, room,
  mic, speaking pace). Typed input stays as the fallback.

## 2. One full loop on Argon: pass

Click (430, 222) on "Since last month" in the Traffic stat card, then say phrase (a) through the fake mic. The page
is the served tokenized app (the copied run's re-rewritten `site/`, with `tokens.css` injected), viewport 1440x900.

- **Point:** SAM 3.1 returned a mask. The element is `span.text-nowrap` "Since last month", colour `#8898aa`.
  Value-matched tokens: `color.text.muted`, `footer.text`, `color.blue.400`. A sentinel probe sets each candidate to
  `#ff00fe` and checks whether the clicked element follows. It confirmed **`color.text.muted`**, an alias of
  `color.blue.400`.
- **Pairs using the token:** the same sentinel probe over the whole page found 21 text pairs, all on `#ffffff` at
  2.95:1.
- **Fix (deterministic, no model):** `color.text.muted` changes from `#8898aa` to **`#687889`**. In OKLCH that is
  L 0.673 → 0.566 (ΔL -0.107), hue 251.4° → 250°, chroma 0.032 → 0.033. The value is written on the semantic token,
  so `color.blue.400`'s other users stay as they are.
- **Apply + re-audit of the whole page (87 pairs):** failing 41 → 20. The 21 pairs that use the token went from
  2.95:1 to **4.53:1**, all passing. **Regressions: 0.** No pair got worse. The 20 still failing belong to other tokens.
- This matches the plan's on-screen line ("21 elements, 2.9:1 → 4.6:1"). The real "after" number is **4.53**.

Timings, uncached SAM/ASR (fresh cache directory per run), warm server and browser:

| Run | SAM | ASR | Decision | Apply + audit | After speech ends | Steps added up | Click → done (incl. 5.3 s of speech) |
|---|---|---|---|---|---|---|---|
| 1 | 1725 | 1220 | 25 | 19 | 1269 | 2989 | 6831 |
| 3 | 2988 | 1472 | 28 | 18 | 1523 | 4506 | 74920 (see below) |
| 4 | 967 | 1255 | 30 | 15 | 1304 | 2267 | 6849 |
| 5 | 849 | 1590 | 28 | 16 | 1640 | 2483 | 7167 |

SAM runs while the person is still talking. What the person waits for is "after speech ends": **1.3 to 1.6 s**.
Every step added up is 2.3 to 4.5 s. The 15 s budget holds with a wide margin.

Harness problems, for honesty:
- Run 3 stalled for about 68 s before recording started: the fake media device or `getUserMedia` in headless
  Chromium. The pipeline steps in that run took normal times.
- Run 2 printed nothing; the cause was not found.
- Lane B should time this with a real mic in headed Chrome.

**Muse path, phrase (e) on the "Month" button (873, 328):**
- Twins: `r43` and `r44` (both blue "See all" buttons, ΔE 0). The white "Week" button was correctly excluded.
- Route: muse.
- Muse Spark Open on Baseten, 2.5 to 8.0 s across 4 runs, proposed `button.bg → color.blue.500`. Two of the 4 runs
  also proposed `button.active.bg` and `button.border`.
- All changes were aliases (no raw CSS). Sanitized. None rejected.
- After apply: 0 pairs affected, 0 regressions. Month is already brand blue, so this is visually a no-op, which is
  correct.
- Weaknesses:
  - Muse aliased to the primitive `color.blue.500` and not the semantic `color.action.primary`. Lane A should prefer
    semantic targets in the prompt or post-process.
  - The "changeable" set is too broad. It is value-matched, so white text pulls in `color.white` and the surface
    tokens. Lane A should restrict it with the same sentinel probe the contrast path uses.

## 3. Twins on Light Bootstrap: pass

All 7 clicks went through `pointAt` with SAM point outlines.

| Click | Own colour | Twins (ΔE) | Correct | False across colours |
|---|---|---|---|---|
| Sidebar icon "User profile" (45,161) | `#bdbdbd` strokes on `#464646` | r75, r69, r65, r66 (0.4 to 4.0) | 4 of 7 sidebar icons | 0 |
| Card icon orange (345,153) | `#ff9501` | none | n/a | 0 (green/red/blue card icons excluded) |
| Card icon green (631,153) | `#87cb17` | none | n/a | 0 |
| Card icon red (919,153) | `#ff4b56` | none | n/a | 0 |
| Card icon blue (1207,153) | `#1e63f0` | none | n/a | 0 |
| Small grey "Update now" icon (314,220) | `#acacac` | r76, r70, r67 (0.4 to 1.9) | 3 of 3 | 0 |
| Top nav link "Account" (1161,38) | `#8d8d8d` | r11, r17, r14, r12 (0.4 to 4.3) | 3 of 3 (+ r12, a grey icon link) | 0 |

Two fixes the spike needed:
1. **The control's own colour, not its most common colour.** The orange, green, red and blue card icons all sit on
   white. Using the largest colour inside the mask would make them twins of each other. The rule: the largest inside
   colour that differs from the surroundings, or the core colour of thin strokes.
2. **Stroke colours depend on the background.** A light sidebar icon on the dark photo samples like a mid-grey footer
   icon on white (ΔE 4.4 to 5.9). Stroke-based matches now also need similar surroundings (ring ΔE < 20). Filled
   controls don't, so Argon's Month and "See all" stay twins across a dark card and a white one.

Misses:
- Sidebar icons r60, r62 (the active item, on a lighter highlight) and r68 are not matched.
- "Dropdown" is labelled `button`, not `link`, so it is not a twin of "Account".

Twins are highlights only, so a miss costs a highlight and never a wrong change.

## What lanes A and B can promote

- **Lane A (server):**
  - `pasHandler` mounts on `startPlayground` by adding a `routes` hook or calling it before the 404.
  - `transcribe.js`, `point.js`, `twins.js`, `contrast-fix.js`, `route.js` and `intent.js` are ready as they are.
  - Still to build:
    - the focus route (`runFocus` with the proposal CSS);
    - semantic-first alias targets for Muse;
    - narrowing "changeable" with the sentinel probe;
    - `/api/intent` itself (the spike calls `museIntent` directly);
    - Muse failover to Fireworks (the spike uses the playground's Baseten → Meta order).
- **Lane B (page):**
  - `wav.js` `recordWav()` is the hold-to-talk recorder (MediaRecorder, timeslice 250 ms).
  - The sentinel probe from `argon-loop.mjs` belongs in the page: find the controlling token, then the pairs using it.
  - `auditLive` before and after with the comparison rule (regression = passed then failed, or failing and got worse)
    goes in as is.
  - For text clicks, outline the DOM element. SAM's point mask on text is a single glyph: `[421,219,16,8]` for
    "Since last month".
- **Pipeline:** the coder fix. Re-run the demo runs with it.

## Risks remaining

1. **Real human speech is untested.** Typed fallback stays.
2. **The coder fix changes every run's rewrite** (Argon 412 → 844 edits). Fallback pixels are 0 px on both apps, but
   Light Bootstrap's merged-colour drift with tokens.css grows. Full verify re-runs are needed before recording.
3. **Muse token hygiene.** It aliased to a primitive, and the changeable set is too broad. Both are contained by
   sanitizing and the no-regression gate, but they are visible in a proposal card.
4. **SAM's text outline is a glyph,** not the label (display only).
5. **Fake-device stalls in headless Chromium.** These affect the test harness only. Verify with a real mic.
