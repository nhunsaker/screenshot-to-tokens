# Breadth run: 28 real sites (L2, 2026-10-26; re-run 2026-10-28 with the rewriter fix)

Every site in the demo pool (`spec/.../demo-site-pool.md`: public `*.github.io` sites with an MIT, Apache-2.0, BSD or
ISC licence) was mirrored locally (`scripts/mirror-site.mjs`: the page plus its same-origin CSS, JS, fonts and images)
and run end to end: hybrid segmenter (SAM 3.1 + layout + DOM), Muse Spark Open on Baseten for naming, deterministic
rewrite, three-check verify. Runner: `node scripts/breadth-run.mjs <pool.md> --concurrency 2`. About 19 s per site.

## Result (re-run 2026-10-28, after the rewriter fix)

The point-and-say spike found that the rewriter skipped the **last declaration of every block in minified CSS** (no
trailing `;`) and read `!important` as part of the value. Fixed in `859f7a1`; every site re-run (`out/breadth5`):
- **27 sites reachable, 1,632 tokens proposed, 3,687 hardcoded values rewritten** (was 2,313 before the fix).
- **Rewrite safety: still 0 px on 23 of 23 stable sites with edits.** Same exceptions as before: the two sites that
  animate on their own (Mavrikant, zeikar) and CWWhitney's near-white color merge flagged for review (rewrite 0 px).
- **Repeat check: same verdict on every site with edits** (24 of 27 byte-identical). burning-cost has 0 edits; its
  first shot differed by 43 px of render jitter that the repeat marked as page noise.

## Result (first run, 2026-10-26)

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

## Per site (2026-10-28 re-run)

| Site | Framework | Licence | Status | Tokens | Edits | Safety checks |
|---|---|---|---|---|---|---|
| wonyong-jang.github.io | jekyll | MIT | ok | 70 | 460 | fallback-only 0 px (pass); colors 0.000% (pass) |
| devbattery.github.io | jekyll | MIT | ok | 106 | 358 | fallback-only 0 px (pass); colors 0.000% (pass) |
| ragu-manjegowda.github.io | jekyll | MIT | ok | 53 | 125 | fallback-only 0 px (pass); colors 0.000% (pass) |
| tw93.github.io | jekyll | MIT | ok | 42 | 1 | fallback-only 0 px (pass); colors 0.000% (pass) |
| josh-wong.github.io | docusaurus | MIT | ok | 66 | 85 | fallback-only 0 px (pass); colors 0.000% (pass) |
| diogoribeiro7.github.io | jekyll | MIT | ok | 75 | 294 | fallback-only 0 px (pass); colors 0.000% (pass) |
| geuni620.github.io | gatsby | ISC | ok | 43 | 2 | fallback-only 0 px (pass); colors 0.000% (pass) |
| utzcoz.github.io | jekyll | Apache-2.0 | ok | 32 | 84 | fallback-only 0 px (pass); colors 0.000% (pass) |
| andra-sun.github.io | jekyll | MIT | ok | 74 | 50 | fallback-only 0 px (pass); colors 0.000% (pass) |
| awfp1314.github.io | astro | MIT | ok | 36 | 17 | fallback-only 0 px (pass); colors 0.000% (pass) |
| proinsias.github.io | jekyll | MIT | ok | 52 | 243 | fallback-only 0 px (pass); colors 0.000% (pass) |
| gaotianchi.github.io | jekyll | MIT | ok | 41 | 213 | fallback-only 0 px (pass); colors 0.000% (pass) |
| burning-cost.github.io | jekyll | MIT | ok | 150 | 0 | fallback-only 43 px (FAIL); colors 0.000% (pass) |
| cgoldberg.github.io | jekyll | MIT | ok | 72 | 42 | fallback-only 0 px (pass); colors 0.000% (pass) |
| mavrikant.github.io | jekyll | MIT | ok | 111 | 305 | fallback-only 1100 px (FAIL); colors 0.010% (pass) |
| zzy979.github.io | jekyll | MIT | ok | 74 | 50 | fallback-only 0 px (pass); colors 0.000% (pass) |
| ethmarks.github.io | hugo | Apache-2.0 | mirror-failed | - | - | site returns 404 |
| nithinbekal.github.io | jekyll | MIT | ok | 29 | 42 | fallback-only 0 px (pass); colors 0.000% (pass) |
| infi-defi.github.io | hugo | MIT | ok | 27 | 16 | fallback-only 0 px (pass); colors 0.000% (pass) |
| cwwhitney.github.io | hugo | MIT | ok | 36 | 514 | fallback-only 0 px (pass); colors 0.331% (FAIL) |
| c-gyeltshen.github.io | jekyll | MIT | ok | 0 | 0 | fallback-only 0 px (pass); colors 0.000% (pass) |
| ruzickap.github.io | jekyll | Apache-2.0 | ok | 76 | 43 | fallback-only 0 px (pass); colors 0.000% (pass) |
| stuocs.github.io | jekyll | MIT | ok | 72 | 51 | fallback-only 0 px (pass); colors 0.000% (pass) |
| cheonjoosung.github.io | jekyll | MIT | ok | 26 | 23 | fallback-only 0 px (pass); colors 0.000% (pass) |
| dieghernan.github.io | jekyll | MIT | ok | 76 | 502 | fallback-only 0 px (pass); colors 0.000% (pass) |
| hacksocnotts.github.io | hugo | MIT | ok | 50 | 65 | fallback-only 0 px (pass); colors 0.000% (pass) |
| linkarzu.github.io | jekyll | MIT | ok | 74 | 59 | fallback-only 0 px (pass); colors 0.000% (pass) |
| zeikar.github.io | jekyll | MIT | ok | 69 | 43 | fallback-only 29719 px (FAIL); colors 0.350% (FAIL) |
