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
| 1:05–1:25 | **She decides** | Review page: Accept `color.action.primary`, Rename `color.surface.muted` → `color.surface.subtle`, Accept merge 6px → 4px; terminal: `review` then `eval` | "Nothing is accepted blind. She accepts one, renames one, and accepts a merge the tool would never make on its own. The answer key goes from 20 of 21 to 21 of 21." | `out/l5/l5-review-take.mp4` (Chrome take, choppy) or a fresh take per `demo/L5-review-take.md` | draft exists; a smooth re-take is better |
| 1:25–1:50 | **Safe by construction** | Diff of one rule: `#5e72e4` → `var(--color-action-primary, #5e72e4)`; report's verify section, three rows | "Every approved value becomes a token with the old value kept as the fallback. With only the fallbacks, zero pixels change. With the merged colors, still zero. The spacing cleanup moves under one percent, on purpose, and it's here for her to approve." | `out/demo-argon-baseten/` (rewrite.diff, report verify rows: **0 px · 0.000% · 0.919%**) | exists; record |
| 1:50–2:10 | **See it live before merging** | GitHub Pages: the tokenized Argon, then the proposal link turns the primary color orange with the "Sorb preview, not merged" banner, Show original, back; then the playground sweeping `color.blue.500` while Month follows | "Because tokens are real CSS variables, Sorb previews a change in the running app before anyone merges. Here's a proposal. Here's the original. One primitive, and everything aliased to it follows." | `out/l7/clip-draft.mp4` (18 s: proposal → Show original → playground sweep) | exists |
| 2:10–2:35 | **Holds up** | `docs/breadth.md` table scrolling; real-site scoreboard table; the PR on the fork | "We ran it on 28 public sites we didn't build. On every site that renders the same twice and had values to rewrite, 23 of 23, the rewrite changed zero pixels. We ran the check again; same verdict on every site. And it opens a real pull request." | `docs/breadth.md`, `out/scoreboard.html` "Real sites" table, PR `nhunsaker/argon-dashboard-react#1` | exists; record |
| 2:35–2:45 | **Close** | Report page top, held | "It captures what's there, explains what it found, proves the safe part is safe, and shows her the rest." | — | — |

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

Don't say: "works on any site" (2 sites animate on their own and can't be pixel-checked exactly; say so if asked),
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
- Beat 1: "On this one page: sixty-seven distinct values, and thirteen of them are near-duplicates of others."
- Beat 3: "It captured 277 elements with their real styles. The hybrid segmenter returned 66 regions. 995 style values
  collapsed into 54 clusters. Muse Spark Open, on Baseten, named 86 tokens in under five seconds: primitives, semantic
  tokens, and component tokens like button.active.bg. Then 412 values were rewritten, and checked."
- Beat 4: "Applying her decisions re-runs the rewrite and the checks: 127 edits, and still zero pixels changed."
- Beat 6: "Nothing here is merged. A link carries the proposal to the rest of the team."
Voiced cut: `out/video/demo-v1-vo.mp4` (2:39, −16 LUFS); the only silences are about 1.5 s at beat cuts.
