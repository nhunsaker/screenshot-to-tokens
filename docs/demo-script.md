# Demo script: Screenshot to Tokens

Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026. Target length: 2:30 to 3:00.
Pattern from past Meta hackathon winners: one person, one moment, one visual demo. No
narrator reading slides. No feature tour. One problem, one fix, one proof.

## Persona

A design engineer who just inherited a React app. There is no design system. There are
hundreds of hand-typed hex codes and pixel values across the CSS, and five of them are
almost the same blue because three different people copy-pasted a button over two years.
She does not have time to grep every file by hand, and she does not trust a rewrite she
cannot verify.

## Beats

**0:00 to 0:15: The problem.**
On camera, talking head, or voiceover over a code editor. She says something like: "This
app has zero design tokens. Every color and radius is typed by hand, and nobody can tell
you which ones are supposed to match." Show a quick scroll through a CSS file full of
hex codes.

**0:15 to 0:30: Point at the running app.**
Cut to the app running in a browser, full page (the fixture for rehearsal; one of the three real
open source apps in `docs/demo-targets.md` for the recording). She points at two
buttons that look almost the same shade of blue. "Same button, two different blues. One
pixel of radius apart. Nobody did this on purpose."

**0:30 to 0:55: Segmentation overlay.**
Run the capture and segment stage on camera, or cut to the result. The screenshot appears
with colored boxes drawn over it: button, nav, card, input. "SAM 3.1 looks at the screenshot
and tells us what each region actually is, a button, a card, a nav bar, without touching the
DOM."

**0:55 to 1:20: Token proposal with reasons.**
Scroll the report page's token section. Chips show a color swatch, the token name, an alias
arrow from semantic to primitive, and a one-line reason. "Muse Spark looked at where each
value shows up and proposed a name for it, color.action.primary, with a reason attached. Not
a guess. A reason you can read and reject."

**1:20 to 1:45: Human review.**
Show the review step: accept, rename, or reject a proposed token right in the report. "She
does not have to accept any of this blind. She can rename a token, reject one that is wrong,
and only the ones she approves move forward."

**1:45 to 2:05: The rewrite.**
Show a before/after diff of one CSS file: a hex code on the left, `var(--color-action-primary,
#1a73e8)` on the right. "One command opens a pull request that swaps every approved literal for
a token, with the old value kept as the fallback. Nothing breaks if the token is missing."
(`s2t pr --open`. If Muse Code turns out to have a scriptable interface, it writes the PR description;
otherwise do not credit it on camera.)

**2:05 to 2:25: Live preview.**
Cut to Sorb's preview banner running against the same app. Change one token's value in the
bridge and the running app updates in place, no reload. "And because the fallback is a real
CSS variable, Sorb can preview a token change against the live app before anyone merges
anything."

**2:25 to 2:40: Verify.**
Show the verify section of the report: three rows. "With only the fallbacks, zero pixels changed,
so the rewrite is safe. With the merged colors loaded, still zero: five blues became one and nobody
can see the difference. The spacing merges do move things a little, on purpose, and that diff is
right here for her to approve." (Real numbers from the fixture: 0 px, 0.000%, 1.7%. On StartBootstrap
Agency: 0 px, 0.000%, 3.7%. Say the real numbers from the recording run, never a rounder one.)

**2:40 to end: Closing line.**
Back on camera. "It captures what is there, explains what it found, and proves the safe part
is safe and shows her the rest. That is the whole loop." Hold on the report page or the app for the last
two seconds.

## Shot list

1. Code editor scrolling through a CSS file full of hex codes and pixel values (B-roll).
2. Fixture app in a browser, two buttons side by side, zoomed in enough to see the mismatch.
3. Screenshot with the region overlay toggled on and off in `report.html` (use the toggle
   checkbox so the on/off happens live, not as two separate captures).
4. Token chips in `report.html`, scrolled slowly, reason text visible and readable.
5. The review UI: one accept click, one rename, one reject, each with a visible result.
6. A code diff (editor split view or a GitHub compare screen) showing one hex literal
   becoming a `var()` call with a fallback.
7. Sorb's preview banner next to the running app, one token value changed, the app's color
   updating without a page reload.
8. The verify section of `report.html`: the gate badge and the three rows (fallbacks only, colors
   merged, all tokens) with their ratios.
9. Closing shot: the full report page, scrolled to the top, held for a beat.

## What must be real vs what can be pre-recorded

**Real, on the day:** the fixture app, the capture and segment stages, the cluster and token
proposal stages, the report page itself (region overlay toggle, token chips, clusters table),
and the verify diff. All of this runs today against the offline stand-in providers
(`mock-dom` for segmentation, `mock-heuristic` for naming), which the report marks with a
visible MOCK badge. That badge should stay on screen. It is honest about what is live model
output versus a deterministic stand-in, and judges will trust the demo more for showing it,
not less.

**Pre-recorded or staged ahead of time:** the review step (walk through it once beforehand so
the accept/rename/reject clicks land cleanly on camera), the rewrite diff (prepare the before
and after file side by side rather than running the rewrite live, since live rewriting a real
target app adds a dependency the recording does not need), and the Sorb live-preview beat
(proven 2026-10-25 with the published `@sorb/juice` 0.3.0 bridge: `npx -p @sorb/juice sorb dev`,
`s2t preview --token color.action.primary --value '#e8711a'`, and `src/preview-client/sorb-preview.js`
on the page. It is reliable enough to do live, but record a clean take as a backup). If SAM 3.1 or Muse Spark API access lands before the
recording, swap the mock providers for real calls and drop the MOCK badge for that beat. If
it has not landed, keep the stand-ins and say so in the voiceover rather than hiding it.

## Notes on delivery

Plain voice. Short sentences. Say what the tool did, not how impressive it is. Let the
screenshot overlay and the diff do the persuading. If something has to be cut for time, cut
the live-preview beat before cutting the verify diff. The diff is the proof. Everything else
is the pitch.
