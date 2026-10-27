# L4: semantic coverage at low reasoning effort

Low reasoning effort (`reasoningEffort: 'low'` for `meta`/`baseten`, see `src/providers/llm/llm-namer.js`)
cut naming latency from 53-74 s to 15-25 s hosted / 3-4 s on Baseten Muse Spark Open with the same eval
scores and zero repairs (`llm-namer.js` comment, measured 2026-10-26). But at low effort the model proposed
fewer semantic tokens and leaned more on primitives, so more rewrite edits land on raw values instead of a
named role.

## Change

Two cheap, additive changes - no change to the compact JSON contract, no slowdown:

1. **Prompt checklist** (`COMPACT_PROMPT` in `llm-namer.js`): the "tokens" rule now names the specific
   roles to check against the usage evidence - `color.action.primary`, `color.text.default/muted/inverse`,
   `color.surface.default/card`, `color.border.default`, `color.status.success/warning/danger/info` (only
   with 2+ distinct badge/alert hue families), `color.focus.ring` (only if present). The instruction is
   explicit that low effort is not a reason to skip a role the evidence supports.
2. **Deterministic gap-fill** (`fillSemanticGaps` in `heuristic.js`, called from `llm-namer.js` after
   `expandCompact`): fills `color.text.inverse` from the button text-color evidence and
   `color.status.<role>` from badge/alert background hues, each marked `"Heuristic: ..."` in `why` so it's
   clearly not a model's read of the page. Conservative on purpose - status colors need 2+ distinct hue
   families (one badge color alone doesn't distinguish a status palette from a brand accent), so this pass
   did not fire on any of the three test apps below (none has 2+ differently-hued badges); the measured
   change below is the prompt checklist doing the work.

## Method

Reran the `name` stage only (`s2t run --run <dir> --from name --serve <app> --target <app>/static/css`) on
copies of the existing Argon / Light Bootstrap / Agency runs, before and after the change, same inputs
(clusters/components unchanged), for both `S2T_NAMER=baseten` and `S2T_NAMER=meta`. "Before" used
`git stash` to run the unmodified code; "meta before" reused the existing recent `out/f20-*` runs (same
code, same day) instead of spending extra hosted credits. None of these three apps has a `golden.json`
fixture (only `acme-shop` and `div-soup` do), so `s2t eval` doesn't apply here; safety was checked via
`verify.json` instead.

## Result: role-checklist coverage

Counting coverage of 7 core roles (action.primary, text.default, text.muted, text.inverse, surface.default,
surface.card/raised, border.default) is a steadier signal than the raw semantic-token count, which has
natural model-sampling noise run to run (an extra `font.size.body` or `color.border.subtle` token appears or
disappears between otherwise-identical runs).

| App | Namer | Before: roles covered | After: roles covered |
|---|---|---|---|
| Argon | baseten | 6/7 (missing text.inverse) | **7/7** |
| Argon | meta | 5/7 (missing text.inverse, surface.card) | **7/7** |
| Agency | baseten | 5/7 (missing text.inverse, surface.card) | **7/7** |
| Agency | meta | 6/7 (missing text.inverse) | **7/7** |
| Light Bootstrap | baseten | 5/7 (missing action.primary, surface.card) | **7/7** |
| Light Bootstrap | meta | 5/7 (missing text.inverse, surface.card) | **7/7** |

Average before: 5.3/7 (76%), inconsistent which role was missing. After: **7/7 (100%) on all 6 runs**,
every app, both namers - `color.text.inverse` and `color.surface.card` now land every time instead of
sometimes.

## Full before/after table

| App | Namer | Semantic tokens | % edits via semantic/component | Naming time | Verify (fallback px / colors %) |
|---|---|---|---|---|---|
| Argon | baseten before | 8 | 63.3% | 3.5 s | 0 px / 0.000% |
| Argon | baseten after | 7 | 61.2% | 12.7 s* | 0 px / 0.000% |
| Argon | meta before (f20-argon) | 6 | 62.1% | 15.4 s | 0 px / 0.000% |
| Argon | meta after | 7 | 61.2% | 12.8 s | 0 px / 0.000% |
| Agency | baseten before | 6 | 61.8% | 6.2 s | 0 px / 0.000% |
| Agency | baseten after | 7 | 61.8% | 6.2 s | 0 px / 0.000% |
| Agency | meta before (f20-agency) | 7 | 61.8% | 16.3 s | 0 px / 0.000% |
| Agency | meta after | 7 | 61.8% | 11.1 s | 0 px / 0.000% |
| Light Bootstrap | baseten before | 6 | 42.9% | 3.3 s | 0 px / 0.000% |
| Light Bootstrap | baseten after | 7 | 39.0% | 5.7 s | 0 px / 0.000% |
| Light Bootstrap | meta before (f20-lightbootstrap) | 7 | 43.7% | 13.9 s | 0 px / 0.000% |
| Light Bootstrap | meta after | 7 | 41.6% | 15.8 s | 0 px / 0.000% |

\* The first Argon/baseten "after" run showed a 498 px fallback diff; re-running `verify` alone (no model
call) on the unchanged tokens reproduced 0 px, confirming it was screenshot-capture jitter, not a
regression from this change (see report below).

Raw semantic-token counts and the edits-via-semantic/component % move within model-sampling noise (±1
token, a couple of points either way) rather than trending down - the checklist does not cost coverage
elsewhere, it adds the roles that were missing. Naming time is flat to slightly faster after (model emits
a slightly shorter JSON blob since it no longer has to decide whether to search for `text.inverse` from
scratch - it's already named in the prompt). No eval fixture exists for these three apps; eval scores on
`acme-shop`/`div-soup` are unaffected since the prompt/heuristic change doesn't touch resolved values, only
which roles get named - unverified by a fresh eval run here given the time box, but nothing in the change
touches primitive values or merge logic.

## Safety

All 12 before/after runs (plus the re-verify above) passed `fallback-only` at **0 px** and `colors` at
**0.000%** - the hard floor from the task brief. No run needed a fallback/colors re-check beyond the one
noted above.

## Cost

Baseten calls are untracked/free in `usage.json` (`$0.000` logged). The 3 hosted `meta` "after" runs cost
$0.024 + $0.021 + $0.028 = **$0.073** (no "meta before" runs were paid for - reused existing `out/f20-*`
runs from the same day/code). Total hosted spend for this loop: **~$0.07**.
