# F20: component tokens (the third tier, end to end)

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
