# Demo script: Screenshot to Tokens (v2, 2026-10-27)

Meta Global AI Developer Hackathon, Startup track. **Length cap: 3:00.** The event guide (official guide, mirrored at
github.com/meta-ai-hackathon/meta-hack, read 2026-10-27; confirm against the Official Rules in the Cerebral Valley
dashboard) says: "3-minute demo video" is the primary judging artifact alongside code and the live product; **"New work
only: demo shows only what you built during the event — unclear contribution = immediate disqualification"**; scoring
Impact 30% · Meta AI tooling 25% · Demo 25% · Technical depth 20%; pre-submit checklist: repo public, video link works,
every contributor listed. So: nothing pre-existing on screen (the intro explains Sorb in words on a title card, no
footage of the product), and every beat names the Meta model doing the work.
Startup judging is technical execution and whether it holds up in production, so the spine is: one person, one
problem, one visual proof, then evidence that it holds up on sites we didn't build.

Rules for the take:
- Every number on screen comes from a real run. Say the number from the recording run, never a rounder one.
- Name the models doing the work: SAM 3.1 (Meta Model API) segments; Muse Spark Open on Baseten names tokens (hosted
  Muse Spark is one switch away). No feature tour.
- The story doesn't change after `demo-v1`: pipeline shape, the 0/8 vs 8/8 moment, "the rewrite changes nothing; the
  cleanup is shown for review".

## Persona

A design engineer who just inherited a dashboard. No design system: hundreds of hand-typed hex codes and pixel values,
and several almost-identical blues from years of copy-paste. She can't grep it all by hand, and she won't merge a
rewrite she can't verify.

## Beats

**Founder VO (2026-10-29).** The Voiceover column is the founder's script from
`spec/metatoy-studio/hackathons/final-cut-plan.md` (rubric review 2026-10-29): he narrates the whole video with a
camera bubble (Loom over the silent screen track, or separate camera + mic files). The two *[spoken]* requests in beat 6
go through the playground's real mic path, so Meta's speech model transcribes them on screen. Targets are the plan's;
the v2 times are superseded. Beat 9 plays before the close (beat 8). The synthetic rehearsal cut uses Emma for the
narration and Michael for the two spoken requests. Earlier VO lines are in git history (`10e52ca`).

| Target (v3) | Beat | On screen | Voiceover (founder VO) | Asset | Status |
|---|---|---|---|---|---|
| 0:00–0:24 (v3 0:00.0–0:28.9) | 0 · **Open: the two halves** | Title card: kicker (theme), **Screenshot to Tokens**, the tagline "A design system from a screenshot in seconds. A more accessible app from the tokens in one change.", the "not shown here" line (built Oct 25 to 29); beside it a muted 4 s loop cropped from beat 6's take: "Since last month" 2.95:1 fail → 4.53:1 pass, then the Tab focus ring | "Build for your world. Mine is design engineering, and most apps I inherit have no design tokens: every color is a bare value in a stylesheet, with no name to say what it's for, so neither a person nor an AI can change it safely in one place. Screenshot to Tokens gives a live web app a design system in seconds, a name and a reason for every value. Then text contrast, keyboard focus, dark mode: one checked token change each." | `scripts/record-beats.mjs --only 0 --v3` (loop: `out/video/assets/v3/payoff-loop.webm`) | recorded 10-29 |
| 0:17–0:26 (v3 0:28.9–0:33.4) | 1 · **The problem** | Editor scrolling Argon's compiled CSS: hex codes, pixel values | "Here's one. Nobody can tell you which of these values are meant to match." | Screen recording of the editor | to record |
| 0:26–0:37 (v3 0:33.4–0:41.4) | 2 · **Pixels, not markup** | Scoreboard split screen: page structure finds **0 of 8** buttons, SAM 3.1 finds **8 of 8** (boxes reveal one by one) | "Reading this page's code finds zero of its eight buttons. Meta's SAM 3.1 looks at the pixels and finds all eight." | `out/scoreboard.html` hero (has the reveal animation and a Replay button) | exists; record the reveal |
| 0:37–0:51 (v3 0:41.4–0:54.6) | 3 · **One run on a real app** | Terminal: `zsh scripts/demo-runs.sh` on Argon, stage lines scrolling; then the report's token chips (swatch, name, alias arrow, reason) **v3:** terminal, then a 5–7 s three-tier card (`record-beats.mjs` beat 13: `--color-blue-500: #5e72e4;` primitive · `--color-action-primary: var(--color-blue-500);` semantic · `--button-bg: var(--color-action-primary);` component · `background-color:var(--button-bg, #5e72e4);` the source; "Change color.action.primary once and every button, badge and link follows. A name a person, or a model, can act on."), then the terminal's "done in" line | "One command. SAM finds the regions, and Muse Spark names every value on three tiers: the raw color, what it means, and where it's used, in a review report. Twenty-three seconds, under a cent." | `scripts/demo-runs.sh` (warms Baseten first) + `out/demo-argon-baseten/report.html` | exists; recording run 10-27: 23.4 s, naming 4.9 s, $0.007 (`out/rec-argon`) |
| 0:51–1:07 (v3 0:54.6–1:11.4) | 4 · **She decides** | Review page: Accept `color.action.primary`, Rename `color.surface.muted` → `color.surface.input`, Accept merge 6px → 4px; terminal: `review` then `eval` (21/21) | "Nothing is accepted blind. I accept the primary blue, rename the search box's gray to surface.input, and merge its six-pixel corners into the buttons' four. Then: 127 edits, and zero pixels changed." | `out/video/n4.mp4` (opening dwell trimmed to the line) | recorded 10-27; re-paced 10-29 |
| 1:07–1:22 (v3 1:11.4–1:21.5) | 5 · **Safe by construction** | Diff of one rule: `#5e72e4` → `var(--color-action-primary, #5e72e4)`; report's verify section, three rows **v3:** Diff, then the four verify rows | "Every value becomes a token. Four checks run before any pull request: zero pixels changed, merged colors invisible, and no text made harder to read." | `out/demo-argon-baseten/` (rewrite.diff, report verify rows: **0 px · 0.000% · 0.919%**) | exists; record |
| 1:22–1:55 (v3 1:21.5–1:54.8) | 6 · **See it live, then Point and say** | 5 s proposal link + Show original. Then the playground on Argon, two browser sessions (`scripts/record-pas-beat.mjs --voice out/video/req`; Chromium's fake mic restarts its file on every recording, so one session per request): click "Since last month" (SAM outline, real wait shortened), hold to talk, caption **"Meta's speech model: “this label is too light. Make it readable. Keep our gray.”"**, caption "color.text.muted: 21 elements, 2.95:1 → 4.53:1 · whole page 41 → 20 failing · 0 regressions" over the panel's result card; click "Icons", hold to talk, "Meta's speech model: “Give every control a visible focus ring in our blue.”", "Focus check (8.9 s): visible focus on 0 → 25 of 25 controls · 0 worse", Tab, Tab with the ring; click "Month", typed "make these buttons red" → **"Blocked: contrast on "Month" would regress (4.20:1 → 3.77:1). Reverted."** The panel keeps its bottom-left 210 px empty for the camera bubble | "Tokens are real CSS variables, so Sorb shows a change live before anyone merges. So I just point and say it. *[spoken] This label is too light. Make it readable, keep our gray.* Meta's speech model hears me, SAM outlines what I clicked, and it changes a token, never raw CSS, so the fix is computed, not guessed: twenty-one labels now pass contrast. *[spoken] Give every control a visible focus ring in our blue.* And if I ask for something that hurts contrast, it's blocked." | `beat-6-pas-v1.webm`, `beat-6-pas-v2.webm`, `beat-6-pas-v3.json` + 5 s of `n6.mp4`, cut in `scripts/mix_v3.py`; requests `out/video/req/req-{1,2}.wav` (ElevenLabs Michael, `scripts/make-requests.sh`) | recorded 10-29; re-recorded 11-03 with the redesigned panel |
| 1:55–2:03 (v3 1:54.8–2:01.9) | 7 · **Holds up** | `docs/breadth.md` table scrolling; real-site scoreboard table; the PR on the fork | "We ran it on twenty-eight public sites we didn't build. On every stable site, the rewrite changed zero pixels." | `docs/breadth.md`, `out/scoreboard.html` "Real sites" table, PR `nhunsaker/argon-dashboard-react#1` | exists; record |
| 2:03–2:33 (v3 2:01.9–2:27.3) | 9 · **More accessible, checked (L15)** | Argon report's text-contrast row (41 of 87 below AA, 0 regressions); the axe-core card (28 sites: 308/309 violations, 2,165/2,174 passes, 1 opposite verdict, 97% of "needs a person" decided); a numbers card for keyboard focus on Argon (0 of 25 → 25 of 25, from beat 6's Tab-through; the ring itself is shown in beat 6); Light Bootstrap Dashboard React switched to its dark mode token file (83 of 84 text pairs pass) **v3:** dark mode no longer narrated: a 2.5 s dark-mode hold under the last words | "Low-contrast text is on eighty-four percent of home pages, the web's most common accessibility failure. Europe's Accessibility Act already applies, and US state and local government sites must meet WCAG 2.1 AA by April 2027. On twenty-eight sites our check agrees with axe-core ninety-nine point nine percent of the time, and settles ninety-seven percent of what it can't decide." | `scripts/record-beats.mjs` beat 9 → `out/video/n9-v2.mp4` | recorded 10-28 |
| 2:31–3:00 (v3 2:27.3–2:57.9) | 8 · **Close: what made it possible** | End card: SAM 3.1 (0 of 8 from the code, 8 of 8 from pixels) · Muse Spark (Muse Spark Open on Baseten: 3 to 9× faster than hosted Muse) · Open weights, end to end · Meta's speech model; then large: "The design system took seconds. Making the app more accessible took one change each." (on the card, not spoken); Sorb's tagline "Propose the change. See it live. Verify before you merge."; bottom-right: "Open source · Apache-2.0 · github.com/nhunsaker/screenshot-to-tokens", PR and live-demo links, credits (bottom-left clear) | "Meta's models made this possible. SAM 3.1 finds controls the code never describes: zero of eight became eight of eight. Muse Spark gives every bare value a name and a reason, in seconds, on open weights, under a cent a run. And the speech model means anyone who can point and talk can make a checked change. Every number in this video comes from a real run, in the repo. It's open source: clone it and run it on your app today." | `scripts/record-beats.mjs --only 8 --v3` (30 s hold) | recorded 10-29 |

Optional beat if a cut runs short (replace the PR mention, 15 s): the local playground's **"Check contrast"**: 41 failing
text pairs, Muse proposes fixes, re-checked, **41 → 2** (`node src/cli.js playground --run out/app-argon --app
/Volumes/SanDisk/s2t-demo-apps/s2t-pages/tokens`; `docs/playground-muse.md`).

## Numbers to say (verified 2026-10-26; re-check on the recording run)

| Claim | Number | Source |
|---|---|---|
| div-soup buttons, page structure vs SAM 3.1 | 0 of 8 vs 8 of 8 (IoU 0.95) | `out/scoreboard.html`, `fixtures/div-soup/regions.truth.json` |
| Argon run time (Baseten namer, uncached) | 19.7 s total, naming 4.5 s, $0.007 (recording run 10-28 `out/rec3-argon`, uncached, 844 edits after the rewriter fix) | `out/rec-argon/timing.json` |
| Review on the fixture | 20/21 → 21/21, verify 0 px | `demo/L5-review-take.md` |
| Argon verify | fallbacks 0 px · colors 0.000% · all tokens 0.919% | `out/demo-argon-baseten/verify.json` |
| Breadth | 27 reachable sites, 3,687 values rewritten, 23 of 23 stable sites with edits at 0 px; repeat check same verdict on all 27 | `docs/breadth.md` |
| Real-site segmentation (hand-labeled first screens) | hybrid passes on Argon, HackSoc Notts, josh-wong | `docs/real-site-segeval.md` |
| Hosted vs open-weights naming | hosted Muse Spark 1.3 13.7 to 26.2 s; Muse Spark Open on Baseten 3.0 to 4.4 s (3 to 9×); identical fixture evals | `docs/f17-hosted-vs-open.md` |
| Contrast audit (local playground, Argon) | 41 failing text pairs → 2 after Muse fixes | `docs/playground-muse.md` |
| One run on Argon (what the closer says) | $0.007 estimated at list prices (3 SAM images + naming) | `out/rec-argon/timing.json` |
| Breadth compute | 28 sites in 8.9 min summed run time (two at a time) | `out/breadth4/summary.json` |

Don't say: total spend across the build (founder, 10-27: say what one run costs instead), "faster than a VM / local model" (never measured; the comparison we have is hosted vs open weights), "works on any site" (2 sites animate on their own and can't be pixel-checked exactly; say so if asked),
"production-ready", or a model speed without the namer named.

## Recording plan

1. Tue: record beats 1, 3, 5 and 7 fresh (editor, terminal run, diff + verify, breadth scroll). Re-take beat 4 with
   smooth video (Playwright recorder or a manual take); beat 2 from the scoreboard reveal; beat 6 from the L7 clip.
2. Voiceover: one take per beat, plain voice; cut to the times above.
3. Rough cut → `demo-v1`. Watch once at 1x for any claim that isn't on screen.

## Credits on screen (end card)

SAM 3.1 and Muse Spark by Meta · Muse Spark Open served on Baseten · Argon Dashboard React by Creative Tim (MIT; demo
on our fork, not affiliated) · public sites in the breadth run are MIT/Apache/BSD/ISC licensed, used with credit.

## Draft cut (2026-10-27)

`node scripts/record-beats.mjs` records beats 1–5, 7 and 8 headless at 1280x720 from the real run in `out/rec-argon`
(terminal beats replay that run's real output at its real stage timings); beat 6 is `out/l7/clip-draft.mp4`.
Silent rough cut: `out/video/demo-v1-draft.mp4` (2:18). Needs: voiceover, trims to the beat times, end card.

Open issue for the cut: the PR on screen (fork #1) says "replace 919 hardcoded values"; it was opened from the
10-26 run, while the diff beat shows the recording run's 412 edits on the compiled stylesheet. Either re-open the PR
from `out/rec-argon` or don't show the count on the PR page.

## Voiceover (generated 2026-10-27)

`node scripts/gen-vo.mjs` with the flsx.io ElevenLabs voice (`nyfVCF0XNA1BwwJ7FiP2`, `eleven_multilingual_v2`).
Main lines are the Voiceover column above. Second lines fill the long pauses (numbers from `out/rec-argon` and the
review run), spoken 0.6 s after each beat's first line (`docs/demo-vo-extra.json`):
- Beat 3 (terminal replays at 2×, labeled on screen; the real 23.4 s stays in the output): "Two hundred seventy-seven
  elements. Sixty-six regions. Eighty-six tokens named by Muse Spark Open in under five seconds. Four hundred twelve
  values rewritten, and checked."
- Beat 4: "Applying her decisions: 127 edits, zero pixels changed, and the answer key goes to twenty-one of twenty-one."
- Beat 6: "Nothing here is merged. A link carries the proposal to the rest of the team."
Voiced cut: `out/video/demo-v1-vo.mp4` (2:56 with the accessibility beat; closer, beat 4 and beat 7 shortened, the PR page dropped; −16 LUFS). Mixer: `python3 scripts/mix-demo.py`. No public rule caps the video length (checked the Cerebral Valley event page 10-27); 2 to 3 minutes is the pattern from past winners.; the only silences are about 1.5 s at beat cuts.

## 2026-10-28 wording changes (founder)
- No "243 cases for a person": say 99.9% agreement with axe-core, and that it settles 97% of what axe-core can't decide
  and flags the rest for review.
- Beat 3 says the run writes a review report ("Then it writes a review report, every token with its reason, ready to
  accept, rename or merge"), the terminal highlights the `report` line, and the report opens with a caption.
- Report header fix: the segmenter is named from all region sources ("hybrid: sam3.1 + layout + DOM"), not the first
  region, so hybrid runs no longer show "mock-dom · MOCK"; the deterministic rewriter has no MOCK badge.

## v2 cut: Point and say beat (2026-10-28, branch `loop/pas-beat`)

`out/video/demo-v2-vo.mp4`, **2:58.7**, −16 LUFS target (measured −15.9 integrated), no pause over 1.5 s
(`silencedetect` at −40 dB; the longest is 1.29 s). `demo-v1-vo.mp4` is untouched. Rebuild:
1. Server: `S2T_CACHE=0 node src/cli.js playground --run out/argon --app out/argon/site` (fresh start, so SAM and the
   sentinel run for real on each click).
2. `node scripts/record-pas-beat.mjs --url http://127.0.0.1:<port>/` → `out/video/beat-6-pas.webm` + `.json`.
3. `python3 scripts/cut-pas-beat.py` → `out/video/n6-v2.mp4`; `node scripts/record-beats.mjs --only 9`, then
   transcode `beat-9.webm` to `n9-v2.mp4` and cut it at 26.9 s.
4. VO lines `out/video/vo-v2/b6/line.json`, `vo-v2/b9/line.json` (`node scripts/gen-vo.mjs <line.json> <dir>`).
5. `python3 scripts/mix-demo.py --v2` (also trims a picture tail that would leave a pause over 1.5 s; beat 3 loses 0.7 s).

Recording run: point 1.5 s and 1.6 s, contrast intent 19 ms, focus check 9.06 s (shown shortened, labeled on screen).
The take types the request; it does not use the mic. The founder can speak it live and re-record the line.
Beat 6 is 23.6 s, not 25 to 28 s: the 3:00 cap left 23 to 24 s once beat 9 was 27 s, so the line was cut from about
65 words to 56 ("Meta's speech model hears it" dropped since nothing is spoken on screen; "Same checks gate every
change" dropped).

## v3 cut: founder VO (2026-10-29)

- Rehearsal cut: `out/video/demo-v3-vo.mp4`, **2:57.9**, −16.0 LUFS integrated (loudnorm two-pass, linear), true peak −1.96 dBTP,
  longest pause 1.44 s (`silencedetect` −40 dB). Earlier mixes kept: `demo-v3a-vo.mp4` (first v3, 2:57.3),
  `demo-v3b-vo.mp4` (founder's first 10-29 edits, 2:58.7); v1 and v2 untouched.
- Audio chain (`scripts/mix_v3.py`): Emma (`nyfVCF0XNA1BwwJ7FiP2`) lines at ElevenLabs `mp3_44100_192` (`out/video/vo-hq/`;
  the 128 kbps set in `vo-v3/` is the fallback), highpass 70 Hz, pauses between phrases cut to 0.35 s, `atempo=1.04`,
  each line set to −20 LUFS by plain gain. The two requests are Michael (`EK4IAYGwCrQUchP03Yjp`) from the 44.1 kHz MP3s
  (`req/vo-<n>.mp3`); the 16 kHz `req-<n>.wav` copies are only the fake-mic input, so Meta's speech model transcribed
  them live in the take. Mixed in 48 kHz float WAV; pre-gain to −16 and alimiter at −2.5 dBFS sample peak, loudnorm
  two-pass linear, then one AAC encode (256 kbps, 48 kHz stereo) muxed with the stream-copied picture.
- Beat 6 take (fresh server, `S2T_CACHE=0`, `out/argon` + `out/argon/site`): SAM points in 1.5 to 2.7 s; transcripts
  "this label is too light. Make it readable. Keep our gray." and "Give every control a visible focus ring in our
  blue."; `color.text.muted` #8898aa → #687889, 21 elements 2.95:1 → 4.53:1, page 41 → 20 failing; focus check 8.9 s,
  0 → 25 of 25; blocked: "BLOCKED: text contrast would regress on “Month” (4.20:1 → 3.77:1), and 2 more.", reverted.
- Beat times: 0 0:00.0–0:28.9 · 1 0:28.9–0:33.4 · 2 0:33.4–0:41.4 · 3 0:41.4–0:54.6 · 4 0:54.6–1:11.4 · 5 1:11.4–1:21.5 · 6 1:21.5–1:54.8 · 7 1:54.8–2:01.9 · 9 2:01.9–2:27.3 · 8 2:27.3–2:57.9
  (beat 7 opens on the last 1.3 s of the BLOCKED card).
- **v3d (2026-11-03): beat 6 re-recorded with the redesigned Point and say panel** (commits 0796646 + 0e08f6f): steps
  row, target box, mic with a live level meter while recording, plain-words result card (swatches #8898aa → #687889,
  "21 labels now pass text contrast: 2.95:1 → 4.53:1", shield "Checked on the whole page: 41 → 20 text pairs failing,
  0 got worse"), focus card "25 of 25 controls now show a visible focus ring (was 0)", red BLOCKED card on "Month"
  ("BLOCKED: text contrast would regress on “Month” (4.20:1 → 3.77:1), and 2 more.", reverted). Same numbers as v3;
  focus check 9.1 s; transcripts exact ("This label is too light. Make it readable. Keep our gray." / "Give every
  control a visible focus ring in our blue."). During the take More tools, the token filter and token list are hidden
  and the panel scrolls each card to end 218 px above the bottom, so the bottom-left 210 px stays clear. The recorder
  now re-records a session whose transcript doubles a word (the speech model did "Keep Keep" on two takes). Beat 0's
  payoff loop re-cropped from the new take. Cut timing unchanged: every beat start and the beat 6 cues match v3
  (request 1 at 1:29.4, request 2 at 1:45.5, "it's blocked" at 1:53.1); 2:57.9, −16.0 LUFS, true peak −1.96 dBTP,
  longest pause 1.44 s. The previous cut is kept as `demo-v3c-vo.mp4` / `screen-track-v3c.mp4` (take: `*-v3c.*`).
- Screen track for the founder: `out/video/screen-track.mp4` (same picture, only the two requests, same gain) +
  `out/video/teleprompter.md` (timecodes, lines, the requests marked "[say into the mic]", recording guidance).
  The camera bubble goes bottom-left for the whole video (the end card's links and credits are bottom-right).
- Rebuild: `node scripts/gen-vo.mjs out/video/req/lines.json out/video/req EK4IAYGwCrQUchP03Yjp` and
  `sh scripts/make-requests.sh`; server as above; `node scripts/record-pas-beat.mjs --url http://127.0.0.1:4400/ --voice
  out/video/req`; `node scripts/record-beats.mjs --only 0,8 --v3` and `--only 13` (the tier card); Emma lines
  `VO_FORMAT=mp3_44100_192 node scripts/gen-vo.mjs out/video/vo-hq/<beat>/line.json out/video/vo-hq/<beat>`;
  `python3 scripts/mix-demo.py --v3` (both tracks, `v3/beats.json`).

## Final cut (founder VO, 2026-11-03)

- `out/video/final.mp4`, **2:55.4** (2:55.4), 1920x1080 (the 1280x720 sources upscaled with lanczos), −16.0 LUFS
  integrated (two-pass linear loudnorm), true peak below −2.8 dBTP, longest pause 1.27 s (`silencedetect` −40 dB).
  Voice-only mix: `out/video/final-vo.wav`. Contact sheet: `out/video/final-contact.png` (labels under each frame).
- Every voice is the founder's: no synthetic narrator and no synthetic request voice. **Beat 7 is dropped** (founder:
  it doesn't add much; no take 12). Founder cuts, 11-03: take 13 loses the Europe / WCAG sentence, take 14 loses
  "under a cent a run" ("...in seconds, on open weights."), take 06 loses "merged colors invisible," ("zero pixels
  changed, and no text made harder to read"). Each cut keeps a 0.2 s breath at a word boundary; the joins were
  checked with the speech model. The end card still says "under a cent a run" on screen.
- Takes (files `~/Movies/2026-11-03 <time>.mov`, copied to `out/video/founder/src/`; mapping, transcripts and edit
  points in `out/video/founder/takes.json`): 01 `12-48-24` (camera, short version B; the cleaner of two reads,
  12-48-08 says "most of the apps" and "in a second") · 02 `12-30-09` · 03 `12-30-15` · 04 `12-30-27` (misread "in a
  view report. Review report" cut to "in a review report") · 05 `12-31-45` · 06 `12-32-07` · 07 `12-32-52` · 08
  `12-33-07` (request 1) · 09 `12-33-15` · 10 `12-33-33` (request 2) · 11 `12-33-50` · 13 `12-34-39` (to 6.92 s) +
  `12-35-03` · 14 `12-35-24` (a stray "using", "under a cent a run", and "every" before "anyone" cut). Unused: the long
  beat 0 takes (`12-28-09`, `12-28-50`, `12-29-31` voice only; `12-42-36`, `12-43-18`, `12-43-29`, `12-44-04`,
  `12-44-16` camera), `12-48-08`, `12-30-49`, `12-31-13`, `12-31-39`, `12-32-34`, `12-32-45`, `12-33-42`, `12-34-00`,
  `12-35-18`.
- Audio per take: highpass 70 Hz, afftdn nr 8 at the file's noise floor, pauses inside a line over 0.5 s shortened to
  0.5 s (the words themselves are never sped up or slowed down: atempo 1.0), trimmed to speech with a 0.15 s head and
  a 0.25 s tail, −20 LUFS. Mix: 48 kHz float, alimiter at 0.68, two-pass linear loudnorm −16 / TP −1.5, one AAC
  256k encode.
- Beat 0: the title is re-rendered (`node scripts/record-beats.mjs --only 0 --v3 --title-ms 34000`) with the
  disclosure "built Oct 26 to Nov 3, 2026 (git tag pre-event-baseline marks the line)". The founder's camera is cropped
  from the OBS composite (camera rectangle x 70–331, y 466–613 at 1280x720; a 146 px square around the face) and placed
  as a round bubble bottom-left: 330 px across at 1920x1080 (220 at 720p), 36 px margins (24), 3 px ring (2). Its sound
  comes from the same file, so lip sync holds; beat 0 has no pause edits. The take is one variable at the top of
  `scripts/mix_final.py` (`BEAT0`, or `FIN_BEAT0=<time>`); beat 0's length follows it (take + 0.4 s).
- Beat times: 0 0:00.0–0:13.6 · 1 0:13.6–0:18.9 · 2 0:18.9–0:28.7 · 3 0:28.7–0:47.5 · 4 0:47.5–1:06.1 · 5 1:06.1–1:17.3 · 6 1:17.3–2:00.7 · 9 2:00.7–2:19.9 · 8 2:19.9–2:55.4.
- Beat 6 keeps the take's caption pills (burned in at record time by `scripts/record-pas-beat.mjs`): SAM's outline,
  the contrast result, "Clicked Icons", the focus check, Tab Tab, Blocked. The click lands on "So I just point";
  request 1 at 1:29.1 (SAM's outline lands 1.0 s earlier, as take 07 ends; the mic press is right under
  the first word), request 2 at 1:49.0 after the Icons click, the BLOCKED card at
  1:58.5, "it's blocked" at 1:58.8 (take 11 split at its pause).
- Rebuild: `node scripts/founder-transcribe.mjs` (Meta's speech model, `store: false`, files cut into pieces of up to 11 s
  at their pauses; writes `out/video/founder/transcripts.json` from the 16 kHz WAVs in `out/video/founder/wav16/`),
  then `python3 scripts/mix_final.py` (also writes the contact sheet).
