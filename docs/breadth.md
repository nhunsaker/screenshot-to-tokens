# Breadth run: 28 real sites (L2, 2026-10-26)

Every site in the demo pool (`spec/.../demo-site-pool.md`: public `*.github.io` sites with an MIT, Apache-2.0, BSD or
ISC licence) was mirrored locally (`scripts/mirror-site.mjs`: the page plus its same-origin CSS, JS, fonts and images)
and run end to end: hybrid segmenter (SAM 3.1 + layout + DOM), Muse Spark Open on Baseten for naming, deterministic
rewrite, three-check verify. Runner: `node scripts/breadth-run.mjs <pool.md> --concurrency 2`. About 19 s per site.

## Result

- **27 sites reachable** (ethmarks.github.io now returns 404). **1,631 tokens proposed, 2,313 hardcoded values rewritten.**
- **Rewrite safety (fallbacks only, must be 0 px): 23 of 23 stable sites with edits.** Two sites with no edits pass
  trivially (burning-cost: its styles weren't in a same-origin stylesheet the rewrite could reach; C-gyeltshen: no
  tokens) and are not counted.
- **Two sites move on their own** (zeikar: a physics-driven tag pile; Mavrikant: a live signal waveform). The unchanged
  page differs from itself between loads, so a pixel check can't be exact there. Every remaining changed pixel is inside
  the moving region; the rest of each page is identical. Reported, not counted as passes.
- **Color check flagged one merge for review:** on CWWhitney, `#f6f8fa` (4 uses) merged into `#ffffff`. The two are
  under the ΔE 3 merge limit, but across large backgrounds that is 0.33% of pixels, so the gate says a person decides.
  The rewrite itself is 0 px there.

## What the run fixed along the way (all in the verify harness, none in the rewrite)

1. The rewrite's site copy skipped every `dist` folder, so a Jekyll Chirpy theme's scripts were missing from the
   verified page and lazy images stayed blurred (up to 106,097 px "changed"). Now the whole site is copied.
2. A page Content-Security-Policy blocked the injected style tag (DiogoRibeiro7). Our browser now bypasses CSP.
3. Lazy-loaded images are loaded (eager, one scroll, decode) before every screenshot.
4. Every screenshot gets the same seeded `Math.random`, and a second shot of the unchanged page marks pixels that move
   between loads; they are excluded from the counts, painted blue in the diff, and reported.

## Repeat check (L6, 2026-10-26 23:30)

The verify stage was re-run on all 27 finished sites (same rewrite, fresh screenshots), two at a time.
- **The rewrite gate repeated on every site:** all 25 that passed (fallbacks 0 px, colors invisible) passed again; the
  two self-animating sites failed again, with the remaining pixels again only inside their moving regions.
- **23 of 27 produced byte-identical verify results.** The other two stable sites moved only in numbers that don't
  gate: devbattery's "all tokens" view 78 px → 0 px (web-font timing), burning-cost's colors view 0 → 5 px (still
  0.000%, pass).
- Fix applied after L6: every screenshot now waits for `document.fonts.ready` (devbattery re-checked: gates 0 px).
  Side effect: with fonts loaded, the review-only "all tokens" view now shows font-size token changes it used to miss
  (devbattery 0.31%).

## Per site

| Site | Framework | Licence | Status | Tokens | Edits | Safety checks |
|---|---|---|---|---|---|---|
| wonyong-jang.github.io | jekyll | MIT | ok | 69 | 328 | fallback-only 0 px (pass); colors 0.000% (pass) |
| devbattery.github.io | jekyll | MIT | ok | 117 | 222 | fallback-only 0 px (pass); colors 0.000% (pass) |
| ragu-manjegowda.github.io | jekyll | MIT | ok | 53 | 87 | fallback-only 0 px (pass); colors 0.000% (pass) |
| tw93.github.io | jekyll | MIT | ok | 41 | 1 | fallback-only 0 px (pass); colors 0.000% (pass) |
| josh-wong.github.io | docusaurus | MIT | ok | 65 | 66 | fallback-only 0 px (pass); colors 0.000% (pass) |
| diogoribeiro7.github.io | jekyll | MIT | ok | 74 | 201 | fallback-only 0 px (pass); colors 0.000% (pass) |
| geuni620.github.io | gatsby | ISC | ok | 43 | 2 | fallback-only 0 px (pass); colors 0.000% (pass) |
| utzcoz.github.io | jekyll | Apache-2.0 | ok | 32 | 84 | fallback-only 0 px (pass); colors 0.000% (pass) |
| andra-sun.github.io | jekyll | MIT | ok | 74 | 24 | fallback-only 0 px (pass); colors 0.000% (pass) |
| proinsias.github.io | jekyll | MIT | ok | 51 | 144 | fallback-only 0 px (pass); colors 0.000% (pass) |
| awfp1314.github.io | astro | MIT | ok | 37 | 11 | fallback-only 0 px (pass); colors 0.000% (pass) |
| gaotianchi.github.io | jekyll | MIT | ok | 41 | 157 | fallback-only 0 px (pass); colors 0.000% (pass) |
| burning-cost.github.io | jekyll | MIT | ok | 149 | 0 | fallback-only 0 px (pass); colors 0.000% (pass) |
| cgoldberg.github.io | jekyll | MIT | ok | 72 | 21 | fallback-only 0 px (pass); colors 0.000% (pass) |
| zzy979.github.io | jekyll | MIT | ok | 74 | 24 | fallback-only 0 px (pass); colors 0.000% (pass) |
| mavrikant.github.io | jekyll | MIT | ok | 108 | 244 | fallback-only 371 px (FAIL); colors 0.015% (pass) |
| ethmarks.github.io | hugo | Apache-2.0 | mirror-failed | - | - | site returns 404 |
| nithinbekal.github.io | jekyll | MIT | ok | 28 | 42 | fallback-only 0 px (pass); colors 0.000% (pass) |
| infi-defi.github.io | hugo | MIT | ok | 28 | 16 | fallback-only 0 px (pass); colors 0.000% (pass) |
| cwwhitney.github.io | hugo | MIT | ok | 37 | 133 | fallback-only 0 px (pass); colors 0.331% (FAIL) |
| c-gyeltshen.github.io | jekyll | MIT | ok | 0 | 0 | fallback-only 0 px (pass); colors 0.000% (pass) |
| ruzickap.github.io | jekyll | Apache-2.0 | ok | 75 | 21 | fallback-only 0 px (pass); colors 0.000% (pass) |
| stuocs.github.io | jekyll | MIT | ok | 73 | 25 | fallback-only 0 px (pass); colors 0.000% (pass) |
| cheonjoosung.github.io | jekyll | MIT | ok | 25 | 12 | fallback-only 0 px (pass); colors 0.000% (pass) |
| dieghernan.github.io | jekyll | MIT | ok | 74 | 308 | fallback-only 0 px (pass); colors 0.000% (pass) |
| hacksocnotts.github.io | hugo | MIT | ok | 49 | 65 | fallback-only 0 px (pass); colors 0.000% (pass) |
| linkarzu.github.io | jekyll | MIT | ok | 73 | 32 | fallback-only 0 px (pass); colors 0.000% (pass) |
| zeikar.github.io | jekyll | MIT | ok | 69 | 43 | fallback-only 31782 px (FAIL); colors 0.406% (FAIL) |
