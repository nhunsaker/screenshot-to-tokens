# Demo script: Screenshot to Tokens (v2, 2026-10-27)

Meta Global AI Developer Hackathon, Startup track. Target length: **2:45** (hard cap 3:00).
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

| Time | Beat | On screen | Voiceover (plain, short) | Asset | Status |
|---|---|---|---|---|---|
| 0:00–0:15 | **The problem** | Editor scrolling Argon's compiled CSS: hex codes, pixel values | "This dashboard has no design tokens. Every color and size is typed by hand. Nobody can tell you which ones are meant to match." | Screen recording of the editor | to record |
| 0:15–0:40 | **Pixels, not markup** | Scoreboard split screen: page structure finds **0 of 8** buttons, SAM 3.1 finds **8 of 8** (boxes reveal one by one) | "Lots of real apps give you nothing to read: divs, canvases, no roles. Reading the page's code finds zero of these eight buttons. SAM 3.1 looks at the pixels and finds all eight." | `out/scoreboard.html` hero (has the reveal animation and a Replay button) | exists; record the reveal |
| 0:40–1:05 | **One run on a real app** | Terminal: `zsh scripts/demo-runs.sh` on Argon, stage lines scrolling; then the report's token chips (swatch, name, alias arrow, reason) | "One command. SAM finds the regions, near-duplicate values are clustered, and Muse Spark names a three-tier token set, each with a reason you can read. Twenty-three seconds, under a cent." | `scripts/demo-runs.sh` (warms Baseten first) + `out/demo-argon-baseten/report.html` | exists; recording run 10-27: 23.4 s, naming 4.9 s, $0.007 (`out/rec-argon`) |
| 1:05–1:25 | **She decides** | Review page: Accept `color.action.primary`, Rename `color.surface.muted` → `color.surface.input`, Accept merge 6px → 4px; terminal: `review` then `eval` | "Nothing is accepted blind. She accepts color.action.primary: the blue on every button and badge. She renames the light gray behind the search box from surface.muted to surface.input, so the name says what it's for. And she merges the search box's six-pixel corners into the four pixels the buttons use, a merge the tool never makes on its own." | `out/l5/l5-review-take.mp4` (Chrome take, choppy) or a fresh take per `demo/L5-review-take.md` | draft exists; a smooth re-take is better |
| 1:25–1:50 | **Safe by construction** | Diff of one rule: `#5e72e4` → `var(--color-action-primary, #5e72e4)`; report's verify section, three rows | "Every approved value becomes a token with the old value kept as the fallback. With only the fallbacks, zero pixels change. With the merged colors, still zero. The spacing cleanup moves under one percent, on purpose, and it's here for her to approve." | `out/demo-argon-baseten/` (rewrite.diff, report verify rows: **0 px · 0.000% · 0.919%**) | exists; record |
| 1:50–2:10 | **See it live before merging** | GitHub Pages: the tokenized Argon, then the proposal link turns the primary color orange with the "Sorb preview, not merged" banner, Show original, back; then the playground sweeping `color.blue.500` while Month follows | "Because tokens are real CSS variables, Sorb previews a change in the running app before anyone merges. Here's a proposal. Here's the original. One primitive, and everything aliased to it follows." | `out/l7/clip-draft.mp4` (18 s: proposal → Show original → playground sweep) | exists |
| 2:10–2:35 | **Holds up** | `docs/breadth.md` table scrolling; real-site scoreboard table; the PR on the fork | "We ran it on 28 public sites we didn't build. On every site that renders the same twice and had values to rewrite, 23 of 23, the rewrite changed zero pixels. We ran the check again; same verdict on every site. And it opens a real pull request." | `docs/breadth.md`, `out/scoreboard.html` "Real sites" table, PR `nhunsaker/argon-dashboard-react#1` | exists; record |
| 2:35–3:10 | **Close: what made it possible** | End card, lines revealing in time with the voice: SAM 3.1 · Muse Spark Open on Baseten · Muse Spark contrast audit · No GPU, 191 runs, under $2 · tagline · credits | "Three things made this possible. SAM 3.1 reads an interface from pixels: all eight buttons on a page whose code describes none of them, one painted inside a canvas. Muse Spark Open on Baseten named every token in three to five seconds, three to nine times faster than the hosted model, with the same answer-key scores. And Muse Spark audited contrast on the live app: forty-one failing text pairs, down to two. No GPU in this laptop. Every run in this video, plus the hundred and ninety it took to build it: under two dollars of Meta credit. Propose the change. See it live. Verify before you merge." | `scripts/record-beats.mjs` end card (beat 8) | recorded 10-27 |

Optional beat if a cut runs short (replace the PR mention, 15 s): the local playground's **"Check contrast"**: 41 failing
text pairs, Muse proposes fixes, re-checked, **41 → 2** (`node src/cli.js playground --run out/app-argon --app
/Volumes/SanDisk/s2t-demo-apps/s2t-pages/tokens`; `docs/playground-muse.md`).

## Numbers to say (verified 2026-10-26; re-check on the recording run)

| Claim | Number | Source |
|---|---|---|
| div-soup buttons, page structure vs SAM 3.1 | 0 of 8 vs 8 of 8 (IoU 0.95) | `out/scoreboard.html`, `fixtures/div-soup/regions.truth.json` |
| Argon run time (Baseten namer, uncached) | 23.4 s total, naming 4.9 s, $0.007 (recording run 10-27; 17.1 s on 10-26 before verify gained the noise shot and font wait) | `out/rec-argon/timing.json` |
| Review on the fixture | 20/21 → 21/21, verify 0 px | `demo/L5-review-take.md` |
| Argon verify | fallbacks 0 px · colors 0.000% · all tokens 0.919% | `out/demo-argon-baseten/verify.json` |
| Breadth | 27 reachable sites, 2,313 values rewritten, 23 of 23 stable sites with edits at 0 px; repeat check same verdict on all 27 | `docs/breadth.md` |
| Real-site segmentation (hand-labeled first screens) | hybrid passes on Argon, HackSoc Notts, josh-wong | `docs/real-site-segeval.md` |
| Hosted vs open-weights naming | hosted Muse Spark 1.3 13.7 to 26.2 s; Muse Spark Open on Baseten 3.0 to 4.4 s (3 to 9×); identical fixture evals | `docs/f17-hosted-vs-open.md` |
| Contrast audit (local playground, Argon) | 41 failing text pairs → 2 after Muse fixes | `docs/playground-muse.md` |
| Total Meta spend while building | 191 runs, 397 uncached calls, about $1.84 estimated at list prices (SAM per image + hosted Muse tokens; Baseten not included) | sum of `out/**/timing.json` |
| Breadth compute | 28 sites in 8.9 min summed run time (two at a time) | `out/breadth4/summary.json` |

Don't say: "faster than a VM / local model" (never measured; the comparison we have is hosted vs open weights), "works on any site" (2 sites animate on their own and can't be pixel-checked exactly; say so if asked),
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
Voiced cut: `out/video/demo-v1-vo.mp4` (3:09 with the new closer, −16 LUFS; over the 3:00 target, trims pending); the only silences are about 1.5 s at beat cuts.
