# F20: component tokens (the third tier, end to end)
> Note (2026-10-28): the numbers below predate the rewriter fix (`859f7a1`); Argon now has 844 edits (was 412), Light Bootstrap 692 (was 387). The token counts and the 0 px results are unchanged.

Detected components (SAM 3.1 buttons and inputs, layout headers and navs, style-rule cards and badges) are profiled:
the CSS classes on each component's root elements and the value clusters it uses per property. Muse Spark names
`<component>.<role>` tokens from that profile (`button.bg -> color.action.primary -> color.blue.500`), the validator drops
any component token for a value its component never uses, and the rewrite is selector-aware: inside a component's rule
(`.btn-primary { … }`) it prefers that component's token for the matching role.

Measured 2026-10-26 (hosted Muse Spark 1.3, low reasoning effort, hybrid segmenter):

| Page | Component tokens | Rewrite edits | Edits using component tokens | Semantic | Primitive | Repairs | Safety checks |
|---|---|---|---|---|---|---|---|
| Argon Dashboard React | 21 | 412 | 77 (19%) | 179 | 156 | 0 | 0 px / 0.000% |
| Light Bootstrap Dashboard | 15 | 387 | 75 (19%) | 94 | 218 | 0 | 0 px / 0.000% |
| StartBootstrap Agency | 12 | 123 | 36 (29%) | 40 | 47 | 0 | 0 px / 0.000% |
| acme-shop (fixture) | 14 | 127 | 18 (14%) | 46 | 63 | 0 | 0 px / 0.000% |
| div-soup (fixture) | 19 | 98 | 18 (18%) | 27 | 53 | 0 | 0 px / 0.000% |

Before F20, pages had 3 to 4 component tokens and the rewrite never preferred them. Eval is unchanged (acme 20/21,
div-soup 18/20). A judgment call to review: on Agency the model aliased `button.bg -> color.text.default`, because that
yellow is also the site's accent text color; the roles-differ flag exists for exactly this.

## L9: component states as tokens

Profiling now also looks at which of a component's own roots carry an observable state class — `active`,
`disabled`, `selected`, `current` (the ones a static capture can actually see; `:hover`/`:focus` need a live
pointer, so they're only recognized at the selector level, never backed by real usage data from a static
capture). For each state, only the clusters that state's own roots use are recorded (`profile.states.<state>.props`),
so an inactive sibling's values never leak into what the active one's token can cover. Muse Spark names
`<component>.<state>.<role>` tokens from that (`nav.active.bg`), aliasing the semantic/primitive token for the
value the state actually uses, and `validateTokenSet` checks each one strictly against that state's own usage
(not the component's overall usage, and not at all if the named state was never profiled). The rewrite is
selector-aware the same way as F20's base component tokens, but a state selector (`.active`, `:hover`,
`.disabled`, `:disabled`, `.selected`, `:focus`, `[aria-current]`, `[aria-selected=true]`) now prefers that
state's own token first, falling back to the component's base token outside one.

A class seen only on a state-carrying root (e.g. the one `.nav-link` that is `.active`) now also names its
component, even when that class is too rare across every root to clear F20's share threshold on its own —
carrying a state is reliable evidence by itself (the bare state class, e.g. `active`, is excluded: it says
nothing about *which* component).

Motivating case — Argon Dashboard's Month/Week toggle (`.nav-pills .nav-link.active{background-color:#5e72e4;color:#fff}`
vs the inactive pill's white background): measured 2026-10-26 (hosted Muse Spark 1.3, low reasoning effort,
hybrid segmenter), re-run from the name stage on the existing F20 captures:

| Page | Component tokens | State tokens | Rewrite edits | Edits using a state token | Safety checks |
|---|---|---|---|---|---|
| Argon Dashboard React | 25 | 4 (`button.active.bg/.radius/.shadow`, `link.active.bg`) | 412 | 2 | fallback 0 px, colors 0.000% |
| Light Bootstrap Dashboard | 17 | 2 (`button.active.bg/.radius`) | 387 | 3 | fallback 0 px, colors 0.000% |

`button.active.bg` is exactly the Argon toggle's blue, aliased to `color.action.primary` — the active pill's
background now reads as "this component, in this state" instead of just another button background. Zero
validator warnings on either page (no state token was proposed for a value its state didn't use).

## L13: on-surface text tokens

Argon's button/card text and its page/card surfaces are the same raw color (white), so they land in one
cluster with one primitive. Without a text-role semantic token of its own, a `color:` declaration on that
cluster had nowhere correct to land: `pickToken`'s generic "any semantic token for this cluster" fallback
could pick `color.surface.default` — a theme that darkens surfaces would darken that text too (found while
building L11's dark-theme playground: Argon's "Sales value" card label went dark-on-dark).

**Evidence.** `onSurfaceEvidence` (`src/providers/llm/heuristic.js`) re-derives each text/background pairing
from the raw capture with `contrast.js`'s own `pairsFromCapture` (the same function the verify-stage contrast
check uses) and maps both colors to cluster ids. For every text cluster, it reports the background cluster it
sits on most often. `fillOnSurfaceTextTokens` then adds a semantic token for any text cluster whose dominant
background is *not* the page's `color.surface.default` cluster and has no text-role token yet (at least two
observed pairs, so a one-off doesn't fire): `color.text.on-primary` when that background is the
`color.action.primary` cluster, else `color.text.on-dark`.

**Convention.** Three text-role semantic names now exist and all alias a primitive, never invent one:
`color.text.inverse` (kept as-is — the L4 heuristic's button-text evidence), `color.text.on-primary`, and
`color.text.on-dark` (the two L13 additions, for text on a colored/dark surface that evidence didn't already
cover as "inside a button"). A model is free to propose `color.text.inverse` itself for the same case — the
compact prompt's checklist (`COMPACT_PROMPT` in `llm-namer.js`) now names all three and tells the model never
to reuse `color.surface.*` or a surface's primitive for a `color:` role just because the raw value matches;
`fillOnSurfaceTextTokens` runs after the model either way, so a skipped role still gets filled deterministically.

**Rewrite.** `pickToken` (`src/providers/coder/deterministic.js`) already prefers a token whose name matches
the declaration's role (`text` for `color:`) before falling back to "any semantic" — enough by itself once an
on-surface token exists, since its name contains "text". The one remaining gap was the fallback itself: a
`color:` declaration with no text-role token yet could still land on a surface-named one sharing the same
primitive. `pickToken` now excludes any semantic/component token matching `/surface/i` from that generic
fallback for a text-role declaration (primitive wins instead) — one targeted rule, not a blanket "never
cross roles" (an existing, intentional case keeps a text color that happens to equal the brand action color
landing on `color.action.primary` rather than the bare primitive).

Measured 2026-10-27 (hosted Muse Spark 1.3 and Baseten Muse Spark Open, low reasoning effort, re-run from the
name stage on the existing captures):

| Page | Namer | On-surface text tokens added | `color:` edits using one | Button/card text aliases a surface token? | Safety |
|---|---|---|---|---|---|
| Argon Dashboard React | baseten | `color.text.on-primary` | 28 | No | fallback 0 px, colors 0.000% |
| Argon Dashboard React | meta | `color.text.on-primary` | 28 | No | fallback 0 px, colors 0.000% |
| Light Bootstrap Dashboard | baseten | `color.text.inverse` (model-named; same role) | 31 (+9 via `button.text`) | No | fallback 0 px, colors 0.000% |
| StartBootstrap Agency | baseten | `color.text.on-primary` | 25 | No | fallback 0 px, colors 0.000% |

No run put a `color:` declaration on `color.surface.default`/`.card` or a surface's bare primitive. Fixture
evals unchanged: acme-shop 20/21 and div-soup 18/20 (3 uncached `S2T_NAMER=baseten` runs each, `S2T_CACHE=0`
on div-soup with `S2T_SEGMENTER=hybrid` so SAM-only regions resolve — same as L9/F20's measurement setup).
