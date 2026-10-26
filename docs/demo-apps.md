# Demo apps (in progress)

## Blocker: `npm install` denied by auto-mode classifier

Cloned `creativetimofficial/argon-dashboard-react` to `/Volumes/SanDisk/s2t-demo-apps/argon`
(`git clone --depth 1`, confirmed `.git`, `package.json`, and
`src/assets/css/argon-dashboard-react.css` present — target path from demo-targets.md is correct).

Running `npm install --no-audit --no-fund` in that clone was **denied by the Claude Code auto
mode classifier** with reason `[Code from External]` — it blocks running install scripts from a
freshly cloned external repo, regardless of founder chat approval, and the denial explicitly
forbids working around it via other tools/wrappers/quoting. This is a harness-level safety gate,
not something resolvable from inside this session.

**Needs a human to either approve the permission prompt directly in this terminal, or add a
Bash allow-rule for `npm install` in this project's settings.** Proceeding with everything else
that doesn't depend on `npm install` (Agency app, which is pre-built/static) while this is open.

Both clones are ready and confirmed (`git clone` itself is not blocked, only `npm install`):
- `/Volumes/SanDisk/s2t-demo-apps/argon` — target `src/assets/css/argon-dashboard-react.css` present.
- `/Volumes/SanDisk/s2t-demo-apps/lightbootstrap` — target `src/assets/css/light-bootstrap-dashboard-react.css` present.

**UPDATE:** founder ran both `npm install`s directly; node_modules present in both (~1,100 packages),
`node_modules/.bin/react-scripts` symlink is actually valid in argon (checked with `file` — resolves to
`../react-scripts/bin/react-scripts.js`, a real node script). Team-lead gave the direct-path start
command as a fallback regardless.

## Second blocker: starting the dev server is also denied

Attempted `node node_modules/react-scripts/bin/react-scripts.js start` (backgrounded) in the argon
clone to bring up the CRA dev server on port 3000 — **denied by the same auto-mode classifier**,
reason `[Code from External]`: running any code out of the externally-cloned repo (not just its
install scripts) is gated. Per team-lead's standing instruction ("if anything else gets blocked...
stop and report rather than working around it"), stopping here rather than retrying with different
flags/wrappers.

This blocks the entire argon + light-bootstrap-dashboard React-app portion of the brief: no dev
server → no `--url http://localhost:3000` pipeline run, no hand-rolled verify step either (same
gate would hit the rewritten-copy dev server on 3001). Agency (static dist, no code execution needed
beyond the node CLI we already run normally) is unaffected and already done above.

**Needs a human to approve this specific prompt live, or add a Bash allow-rule covering running
scripts out of `/Volumes/SanDisk/s2t-demo-apps/*`.** Reported to team-lead; stopping on this thread
until cleared.

**RESOLVED:** team-lead/founder switched to the static-build approach (`npm run build` run by the
founder themselves, `--serve <app>/build` instead of a dev server + `--url`). No code execution
inside either repo was needed from this session for the rest of the work below — `--serve` just
points the CLI's own static file server at the `build/` folder.

## Argon Dashboard React

Build: founder ran `npm run build` → `/Volumes/SanDisk/s2t-demo-apps/argon/build` (index.html +
`build/static/css/main.e73125fd.css`).

Command:
```
S2T_SEGMENTER=hybrid S2T_NAMER=meta node src/cli.js run --serve /Volumes/SanDisk/s2t-demo-apps/argon/build --target /Volumes/SanDisk/s2t-demo-apps/argon/build/static/css --run out/app-argon
node src/cli.js segeval --run out/app-argon
```
Run time: 27.1s (name stage 18.0s, 4 model calls, ~$0.026 — low-effort Muse Spark default).

Pipeline results:
- capture: 277 elements. **Verified visually** (screenshot.png) — real rendered dashboard (sales
  chart, stat tiles, page-visits table), not a blank SPA shell or redirect.
- segment: 66 regions via `hybrid:sam3.1+layout+dom` (link 19, image 1, text 11, nav 2, badge 1,
  card 8, footer 1, button 4, input 1, icon 17, header 1)
- cluster: 995 uses, 67 distinct values → 54 clusters (13 merged)
- name: 64 tokens via `meta:muse-spark-1.3` (54 primitive, 7 semantic, 3 component)
- rewrite: 412 edits, 1 file, 0 validator repairs
- verify (built-in): **fallback-only 34px — FAIL** (0.0018%); colors-only 0.010% (pass); all-tokens
  0.920% (flagged `reviewNeeded`)
- segeval: **GO** — any-label recall 89%, precision 73% @ IoU 0.5. `badge` recall only 17% (1/6
  matched — hybrid segmenter mostly misses badges), `header`/`icon` have 0% precision (oracle
  doesn't tag those labels at all, predicted-only), everything else 100%.

**Gotcha — fallback-only is not actually 0px.** Checked `diff-fallback.png`: the 34px are entirely
inside the "Sales value" line chart (a Chart.js/recharts-style animated SVG line). The before/after
screenshots were captured a few seconds apart and the chart's draw-in animation / anti-aliasing
differs by a handful of pixels between captures — **not a tokens regression**, just chart-animation
jitter. Worth a line in the demo script ("the chart redraws, that's not us").

**Gotcha — source-CSS rewrite touches the minified bundle too.** Ran a separate check (per
team-lead's ask) copying the run to `out/app-argon-srcrewrite` and re-running
`--from rewrite --to rewrite --target .../argon/src/assets/css` (text-only, executes nothing):
1,838 edits across **2 files** — `argon-dashboard-react.css` **and**
`argon-dashboard-react.min.css`. The rewriter has no concept of "generated artifact, don't touch" —
a real PR against this target as-is would diff the minified bundle too, which no reviewer wants to
see hand-edited. Punch-list item: either exclude `*.min.css` by convention, or point `--target` at
the single source file instead of the whole css/ directory for the real PR step.

## Light Bootstrap Dashboard React

Build: founder ran `npm run build` → `/Volumes/SanDisk/s2t-demo-apps/lightbootstrap/build`
(`build/static/css/main.d27ade12.css`).

Command: same shape, `--run out/app-lightbootstrap`.
Run time: 31.6s (name stage 22.2s, 4 model calls, ~$0.030).

Pipeline results:
- capture: 368 elements. **Verified visually** — real rendered dashboard (users-behavior line
  chart, email-statistics pie chart, stat tiles), not blank/redirect.
- segment: 77 regions via `hybrid:sam3.1+layout+dom` (link 18, button 17, nav 1, card 8, text 8,
  image 3, footer 1, icon 20, header 1)
- cluster: 1050 uses, 54 distinct values → 48 clusters (6 merged)
- name: 58 tokens via `meta:muse-spark-1.3` (48 primitive, 8 semantic, 2 component)
- rewrite: 387 edits, 1 file, 0 validator repairs
- verify (built-in): fallback-only **0px (pass)**; colors-only **0.000% (pass)**; all-tokens
  1.850% (flagged `reviewNeeded` — same expected drift-merge story as the other two apps, confirmed
  by inspecting `diff.png`: changes are color-only pixels on text/icons whose color literal merged
  into a shared token, not a layout shift)
- segeval: **GO** — any-label recall 98%, precision 74% @ IoU 0.5. `badge` 0% (1 oracle badge,
  missed), `header`/`icon` 0% precision (same oracle-labeling gap as argon), everything else 100%.

**Gotcha — same min.css + an extra demo-only file.** Source-CSS rewrite check (`out/app-lightbootstrap-srcrewrite`,
`--target .../lightbootstrap/src/assets/css`, text-only): 739 edits across **3 files** —
`demo.css`, `light-bootstrap-dashboard-react.css`, `light-bootstrap-dashboard-react.min.css`.
Same min.css gap as argon, plus `demo.css` is the repo's own demo-page chrome (not part of the
actual dashboard template) — another file a real PR shouldn't touch. Same fix: target the one
real source file explicitly rather than the whole directory.

No animation/async-data gotchas found specifically on light-bootstrap (verify came back clean at
0px/0.000% on both strict checks).

## Compare — all three apps

```
node src/cli.js compare out/app-argon out/app-lightbootstrap out/app-agency
```

| | argon | lightbootstrap | agency |
|---|---|---|---|
| segmenter | dom 42 / sam 22 / layout 2 | dom 56 / sam 20 / layout 1 | dom 81 / sam 31 |
| regions | 66 | 77 | 112 |
| tokens | 64 (54/7/3) | 58 (48/8/2) | 50 (40/8/2) |
| repairs | 0 | 0 | 0 |
| merges | 2 | 4 | 0 |
| segeval any | 89% | 98% | 88% |
| go/no-go | GO | GO | GO |
| verify fallback | 34px (FAIL, chart-animation noise) | 0px (pass) | 0px (pass) |
| verify colors | 0.010% (pass) | 0.000% (pass) | 0.000% (pass) |
| verify all-tokens | 0.920% (review) | 1.850% (review) | 3.743% (review) |
| run time | 27.1s | 31.6s | 55.9s |
| est. cost | $0.026 | $0.030 | — (first run, higher-effort namer) |

## Punch list before a clean demo

1. **Argon's sales chart animates** → the built-in "fallback should be pixel-identical" check reads
   34px/FAIL even though nothing is actually broken. Either capture after a longer settle delay, or
   call it out on camera so a judge doesn't read FAIL as a real regression.
2. **The rewriter doesn't skip generated/non-template files when `--target` is a directory** — on
   both React apps, pointing `--target` at the real `src/assets/css` dir (for the eventual PR step)
   also edits the `.min.css` bundle (and, for light-bootstrap, an unrelated `demo.css`). For the
   actual demo PR, target the single real source file, not the directory.
3. **`badge` is the weakest segeval label** on both dashboards (17%/0% recall) — minor, doesn't
   block GO, but don't zoom in on a badge in the demo video as a "look how good segmentation is" moment.
4. All three runs are GO and clean otherwise; reports + screenshots are saved under
   `out/app-argon/`, `out/app-lightbootstrap/`, `out/app-agency/` (`report.html`, `screenshot.png`,
   `after*.png`, `diff*.png`, `tokens.css`, `tokens.dtcg.json`).

No dev server or background process left running at end of session (checked `ps`/`lsof` on
3000/3001 — clean).


## Agency (startbootstrap-agency, static dist — full built-in verify)

Target already cloned at
`/private/tmp/claude-501/-Users-nobrien-workspace-metatoy/7386bdd0-2487-404d-8ea4-7d2c4f786eae/scratchpad/targets/startbootstrap-agency`
(dist/ prebuilt, zero install needed).

Command (ran once, as instructed):
```
S2T_SEGMENTER=hybrid S2T_NAMER=meta node src/cli.js run --serve <agency>/dist --target <agency>/dist/css --run out/app-agency
node src/cli.js segeval --run out/app-agency
```
Run time: 55.9s total (name stage via real Meta Muse Spark API: 36.2s, 14,378 tokens — ~1 real API call, cached after).

Pipeline results:
- capture: 264 elements
- segment: 112 regions via `hybrid:sam3.1+layout+dom` (nav 1, link 18, header 1, text 25, image 26, card 5, input 4, footer 1, button 14, icon 17)
- cluster: 694 uses, 46 distinct values → 40 clusters (6 merged)
- name: 50 tokens via `meta:muse-spark-1.3` (40 primitive, 8 semantic, 2 component)
- rewrite: 123 edits, 1 file, via deterministic coder, no validator repairs reported
- verify (built-in): fallback-only diff = **0 px (pass)**; colors-only diff = **0.000% (pass)**; all-tokens diff = **3.743% — over the 0.1% threshold, flagged `reviewNeeded`** (drift-merge token values shift layout slightly on this template; expected per README, not a bug, but worth noting on camera / in the demo script as "here's the one that needs human review")
- segeval: **GO** — any-label recall 88%, precision 88% @ IoU 0.5. Weak spots: `icon` has no oracle labels (17 predicted, 0 matched — oracle just doesn't tag icons), `image` recall 62% (26/42), `link` recall 60% (18/30) — hybrid segmenter is undercounting images/links relative to the DOM oracle, everything else 100%.

Screenshots/artifacts: `out/app-agency/{screenshot.png, after.png, after-fallback.png, after-colors.png, diff.png, diff-fallback.png, diff-colors.png, report.html, tokens.css, tokens.dtcg.json}`.

No gotchas — static dist, no dev server, no animations/async data to worry about for this one.

