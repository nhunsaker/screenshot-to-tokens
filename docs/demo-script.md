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
| 0:00–0:17 | 0 · **Intro: what Sorb is, what we built** | Title card only (no footage of the pre-existing product): Screenshot to Tokens, an add-on to Sorb for apps with no tokens yet; "Sorb is Metatoy's existing product and is not shown here. Everything in this video was built Oct 25 to 27, 2026." **v3:** Title card (kicker, name, tagline) over a 4 s loop of the payoff: the clicked label going from gray-on-white fail to pass, then the focus ring on Tab | "Build for your world. Mine is design engineering: apps with no design system, every color typed in by hand. Screenshot to Tokens turns a live web app into a design system in seconds. Then it uses those tokens to make the app more accessible: text contrast, keyboard focus, dark mode, one checked change each." | `scripts/record-beats.mjs` beat 0 | recorded 10-27 |
| 0:17–0:26 | 1 · **The problem** | Editor scrolling Argon's compiled CSS: hex codes, pixel values | "This dashboard has no design tokens. Every color and size is typed by hand. Nobody can tell you which ones are meant to match." | Screen recording of the editor | to record |
| 0:26–0:37 | 2 · **Pixels, not markup** | Scoreboard split screen: page structure finds **0 of 8** buttons, SAM 3.1 finds **8 of 8** (boxes reveal one by one) | "Reading this page's code finds zero of its eight buttons: it's all divs and a canvas. Meta's SAM 3.1 looks at the pixels and finds all eight." | `out/scoreboard.html` hero (has the reveal animation and a Replay button) | exists; record the reveal |
| 0:37–0:51 | 3 · **One run on a real app** | Terminal: `zsh scripts/demo-runs.sh` on Argon, stage lines scrolling; then the report's token chips (swatch, name, alias arrow, reason) | "One command. SAM finds the regions, Muse Spark names a three-tier token set, and it writes a review report with a reason for every token. Twenty-three seconds, under a cent." | `scripts/demo-runs.sh` (warms Baseten first) + `out/demo-argon-baseten/report.html` | exists; recording run 10-27: 23.4 s, naming 4.9 s, $0.007 (`out/rec-argon`) |
| 0:51–1:07 | 4 · **She decides** | Review page: Accept `color.action.primary`, Rename `color.surface.muted` → `color.surface.input`, Accept merge 6px → 4px; terminal: `review` then `eval` | "Nothing is accepted blind. I accept the primary blue, rename the search box's gray to surface.input, and merge its six-pixel corners into the buttons' four, a call the tool leaves to me. Then: 127 edits, and zero pixels changed." | `out/l5/l5-review-take.mp4` (Chrome take, choppy) or a fresh take per `demo/L5-review-take.md` | draft exists; a smooth re-take is better |
| 1:07–1:22 | 5 · **Safe by construction** | Diff of one rule: `#5e72e4` → `var(--color-action-primary, #5e72e4)`; report's verify section, three rows **v3:** Diff, then the four verify rows | "Every value becomes a token, with the original kept as its fallback. Four checks run before any pull request: zero pixels changed, merged colors invisible, the cleanup shown for my approval, and no text made harder to read." | `out/demo-argon-baseten/` (rewrite.diff, report verify rows: **0 px · 0.000% · 0.919%**) | exists; record |
| 1:22–1:55 | 6 · **See it live, then Point and say** | 6 s of the old beat: proposal link turns the primary orange with the "Sorb preview, not merged" banner, Show original. Then the playground on Argon (`scripts/record-pas-beat.mjs`, real page, real server): click "Since last month" (magenta outline, caption "SAM 3.1 outlines what was clicked"), the typed line, caption **"color.text.muted: 21 elements, 2.95:1 → 4.53:1 · whole page 41 → 20 failing · 0 regressions"**, the label darkens; click the sidebar "Icons" link, the focus line, caption "Focus check: Tab through all 25 controls with the ring · takes about 9 s, shortened here" (about 2 s kept of 9.1 s), caption "Focus check (9.1 s): visible focus on 0 → 25 of 25 controls · 0 worse", then Tab, Tab: the ring on User Profile, Tables **v3:** 5 s proposal link + Show original. Then Argon in the playground: click "Since last month" (outline), the request **spoken** (mic, live transcript), card "21 elements, 2.95:1 → 4.53:1, whole page 41 → 20"; click a sidebar link, spoken focus request, focus check (shortened, labeled), 0 → 25 of 25, Tab, Tab with the ring; **new 3 s: "make these buttons red" → BLOCKED card naming "Month", reverted** | "Because tokens are real CSS variables, Sorb shows a change live before anyone merges. So I just point and say it. *[spoken] This label is too light. Make it readable, keep our gray.* Meta's speech model hears me, SAM outlines what I clicked, and the fix is computed, not guessed: twenty-one labels now pass contrast. *[spoken] Give every control a visible focus ring in our blue.* And if I ask for something that hurts contrast, it's blocked." | `out/video/n6-v2.mp4` (`scripts/cut-pas-beat.py` from `beat-6-pas.webm` + 6 s of `n6.mp4`); numbers in `out/video/beat-6-pas.json` | recorded 10-28 |
| 1:55–2:03 | 7 · **Holds up** | `docs/breadth.md` table scrolling; real-site scoreboard table; the PR on the fork | "We ran it on twenty-eight public sites we didn't build. Everywhere a page renders the same twice, the rewrite changed zero pixels." | `docs/breadth.md`, `out/scoreboard.html` "Real sites" table, PR `nhunsaker/argon-dashboard-react#1` | exists; record |
| 2:03–2:33 | 9 · **More accessible, checked (L15)** | Argon report's text-contrast row (41 of 87 below AA, 0 regressions); the axe-core card (28 sites: 308/309 violations, 2,165/2,174 passes, 1 opposite verdict, 97% of "needs a person" decided); a numbers card for keyboard focus on Argon (0 of 25 → 25 of 25, from beat 6's Tab-through; the ring itself is shown in beat 6); Light Bootstrap Dashboard React switched to its dark mode token file (83 of 84 text pairs pass) | "Low-contrast text is on eighty-four percent of home pages, the web's most common accessibility failure. Europe's Accessibility Act already applies, and US state and local government sites must meet WCAG 2.1 AA by April 2027. On twenty-eight sites our check agrees with axe-core ninety-nine point nine percent of the time, settles ninety-seven percent of what it can't decide, and flags the rest for review. And dark mode is a token file." | `scripts/record-beats.mjs` beat 9 → `out/video/n9-v2.mp4` | recorded 10-28 |
| 2:33–2:59 | 8 · **Close: what made it possible** | End card, lines revealing in time with the voice: SAM 3.1 · Muse Spark Open on Baseten · Muse Spark contrast audit · No GPU, one run under a cent · tagline · credits | "Meta's models do the seeing, the naming and the listening: SAM 3.1 reads the interface from pixels, Muse Spark names the tokens, Meta's speech model takes the request, and SAM and Muse Spark both run on open weights. The design system took seconds. Making the app more accessible took one change each. Propose it, see it live, verify before you merge." | `scripts/record-beats.mjs` end card (beat 8) | recorded 10-27 |

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

## v3 cut: founder VO (2026-10-29, branch `loop/final-cut`; stub, the video agent fills the numbers)

- Rehearsal track: `out/video/demo-v1-vo.mp4` re-mixed with the founder-VO script above (synthetic voices), **_:__**
  long, ≤ 3:00, −16 LUFS (measured: _), longest pause _ s.
- Screen track for the founder: `out/video/screen-track.mp4` (no audio, re-paced to the targets, bottom-left kept
  clear) + `out/video/teleprompter.md`.
- Beat 6 re-take with both requests **spoken** (fake mic, Michael voice WAVs): contrast _, focus _, blocked case
  ("make these buttons red" → BLOCKED naming "Month") _ s.
- Beat 0 payoff loop behind the title card: _ s. Beats 0 and 8 re-recorded with the tagline and the end-card callback.
- Rebuild steps: _
