# Demo Targets

Candidates screened for the hackathon demo video: point Screenshot to Tokens at a real
open source app with no design tokens, propose a tiered token set, rewrite the hardcoded
literals, verify by screenshot diff, land a PR. 19 candidates screened, below. Three picks
plus two backups at the bottom, with run commands, target folders, and a gap list for the
rewriter.

Drift counts are from the actual compiled/shipped CSS (or component `<style>` blocks),
fetched via raw.githubusercontent.com. "var(--)" is a count of existing CSS custom property
usages in that file; 0 means genuinely zero tokens today.

## Screened candidates

| Repo | Stars | License | Styling approach | File types | Distinct colors / radii | Uses var()? | How to run | Demo URL | Fit | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| creativetimofficial/argon-dashboard-react | 451 | MIT | Reactstrap + one big compiled CSS bundle (no scoped CSS modules) | .css (+ some .js component props) | 241 hex / 107 rgba / 30 distinct radius values | No (0) | `npm start` (CRA, port 3000), no backend | demos.creative-tim.com/argon-dashboard-react | 5 | Biggest, most dramatic drift of anything screened. Actively pushed Oct 2026. |
| StartBootstrap/startbootstrap-agency | 2032 | MIT | Pug→SCSS, but repo ships a prebuilt `dist/` | .css (compiled) | 100 hex / 42 rgba / 37 distinct radius values | Yes, heavily (607 `var(--bs-*)`) | Serve `dist/` directly, zero npm install | startbootstrap.github.io/startbootstrap-agency | 4 | `dist/css/styles.css` bundles all of Bootstrap 5, which ships ~600 `--bs-*` vars in `:root`. Custom template colors are still hardcoded literals mixed in, but the file is not "zero tokens" end to end — see gap list. |
| StartBootstrap/startbootstrap-resume | 2178 | MIT | Same engine as agency | .css (compiled) | 112 hex / 42 rgba / 37 distinct radius values | Yes, heavily (607 `var(--bs-*)`) | Serve `dist/` directly | startbootstrap.github.io/startbootstrap-resume | 4 | Personal-site genre. Same BS5-var caveat as agency. |
| StartBootstrap/startbootstrap-shop-homepage | 490 | MIT | Same engine, smaller site | .css (compiled) | 110 hex / 41 rgba / 36 distinct radius values | Yes, heavily (610 `var(--bs-*)`) | Serve `dist/` directly | (not separately checked) | 3 | Lower star count, less recognizable than agency/resume. |
| creativetimofficial/light-bootstrap-dashboard-react | 768 | MIT | Reactstrap + one compiled CSS bundle | .css | 58 hex / 23 rgba / 44 radius decls | No (0) | `npm start` (CRA), no backend | demos.creative-tim.com/light-bootstrap-dashboard-react | 4 | Different palette (pastel) from Argon, good for pacing a 3-app video. Last pushed 2024-07, not archived. |
| creativetimofficial/now-ui-dashboard-react | 136 | MIT | Reactstrap + compiled CSS bundle | .css | 49 hex / 20 rgba / 46 radius decls | No (0) | `npm start` (CRA), no backend | demos.creative-tim.com/now-ui-dashboard-react | 4 | Freshest push of the trio (2026-06-24). Lower star count hurts recognizability. |
| creativetimofficial/paper-dashboard-react | 223 | MIT | Reactstrap + compiled CSS bundle | .css | 65 hex / 14 rgba / 61 radius decls | No (0) | `npm start` (CRA), no backend | (not checked) | 3 | Viable, just redundant with the other three Creative Tim dashboards already covering this drift profile. |
| creativetimofficial/material-dashboard-react | 3025 | MIT | MUI v5 + `createTheme`, inline `sx` | .js | n/a | Yes (de facto) | `npm start` | demos.creative-tim.com/material-dashboard-react | 1 | Disqualified: ships `src/assets/theme/base/colors.js`, a centralized palette file. It already *is* a token system, just not CSS vars. Kills the "zero tokens" story. |
| flatlogic/react-material-admin | 1758 | MIT | MUI + `src/themes/` | .js | not measured | Likely yes (de facto) | `npm start` | — | 2 | Has a `themes/` dir parallel to material-dashboard-react's problem; not deep-checked but same risk pattern. |
| coreui/coreui-free-react-admin-template | 4965 | MIT | `@coreui/coreui` v5 (Bootstrap-5-class framework) | .css | not measured | Yes, by design | `npm start` | — | 1 | CoreUI 5 markets CSS-variable theming/dark-mode as a feature. Same disqualifier as Bootstrap 5 and AdminLTE 4. |
| ColorlibHQ/AdminLTE | 45653 | MIT | Bootstrap 5.3 | .scss/.css | not measured | Yes, by design | `npm` build pipeline | adminlte.io | 1 | v4 is a full Bootstrap 5.3 rebuild; theming runs on CSS vars throughout. |
| ColorlibHQ/gentelella | 21551 | MIT | Vite + SCSS, "live theme generator", dark mode | .scss | not measured | Likely yes (dark mode implies vars) | `npm` build pipeline | preview.colorlib.com/theme/gentelella | 1 | The classic Bootstrap-3, hand-styled "Gentelella" everyone remembers is gone — repo was rewritten to a v4 Vite/SCSS stack with a theme generator. Git tags (even old `v2.2.0`) were rewritten to point at the new codebase, so there is no accessible "classic" snapshot to pull from this repo. |
| bchiang7/v4 | 8289 | MIT | styled-components, `GlobalStyle` injecting `:root` vars | .js | n/a | Yes (0 literal drift by design) | `npm run dev` | brittanychiang.com | 1 | `src/styles/variables.js` defines `--navy`, `--green`, `--slate`, etc. as real CSS custom properties consumed everywhere. This is already exactly what our tool produces — nothing to rewrite. |
| saadpasta/developerFolio | 6637 | GPL-3.0 | styled-components | .js | not measured | not checked | `npm start` | — | 0 | License fails criterion 1 (GPL-3.0, not MIT/Apache/BSD). |
| soumyajit4419/Portfolio | 6507 | none | styled-components | .js | not measured | not checked | `npm start` | — | 0 | No license file at all; too risky to use in a public demo PR. |
| gothinkster/react-redux-realworld-example-app | 5615 | MIT | plain CSS import (likely the shared `conduit.css`) | .css | not measured | not checked | `npm start` | — | 1 | Archived (GitHub flag `archived: true`). Fails "actively maintained." |
| realworld-apps/vue-realworld-example-app | 4076 | MIT | Vue 3 + TS, SFC `<style>` blocks | .vue | not measured | not checked | `npm run dev` (Vite) | — | 2 | Actively maintained (pushed 2026-06), but Vue SFC — see gap list, neither coder provider targets `.vue` files today. |
| vuejs/vue-hackernews-2.0 | 10840 | MIT | Vue 2 SFC, scoped `<style>` per component | .vue | sampled one file: 4 distinct hex (`#828282`,`#eee`,`#ff6600`,`#fff`) | No (0) | `npm run dev` | (demo URL not verified; omit) | 2 | Very recognizable ("the" official Vue Hacker News clone) and genuinely zero-token, but stale since 2022 and Vue SFC — same gap as above. |
| tastejs/todomvc (react / vanilla-es6 examples) | 28963 | MIT (confirmed via root `license.md`, "unless otherwise specified") | Shared `todomvc-app-css` common stylesheet across every implementation | .css + .js | 15 hex / 6 rgba / 1 radius decl | No (0) | `npm start` per example, or static open | — | 2 | Technically qualifies (zero tokens) but the common CSS is intentionally small and clean — too little visible drift to carry a "5 blues become 1" demo moment. |

## Recommended 3 + 2 backups

### Pick 1 — Argon Dashboard React
- Repo: `creativetimofficial/argon-dashboard-react`, MIT, 451 stars, pushed 2026-10-04.
- Why: the most dramatic real drift of anything screened — 241 distinct hex colors, 107
  rgba values, 30 distinct border-radius values, zero existing `var(--)` usage anywhere.
  React (CRA + reactstrap), zero backend, instantly recognizable dashboard look for video.
- Run: `git clone` the repo, `npm install`, `npm start` → serves at `http://localhost:3000`.
- `--target`: `src/assets/css/argon-dashboard-react.css` (the compiled bundle is the richest
  single file; component `.js` files mostly use reactstrap class names, not inline styles,
  so this is primarily a `deterministic` / plain-CSS run, not a `jsx.js` run).

### Pick 2 — StartBootstrap Agency
- Repo: `StartBootstrap/startbootstrap-agency`, MIT, 2032 stars.
- Why: a true static landing-page template (no JS framework at all) — exercises the plain-CSS
  path on a non-React target for variety, and needs zero `npm install` to demo since the repo
  ships a prebuilt `dist/`.
- Run: `npx serve dist` (or just open `dist/index.html`) → no install step at all.
- `--target`: `dist/css/styles.css`.
- Caveat (see gap list): this file is the full Bootstrap 5 bundle plus the template's own
  custom rules concatenated together, so it already contains ~600 `var(--bs-*)` declarations
  in its `:root` block. The custom hero/portfolio/testimonial colors the template authors
  actually hand-picked are still hardcoded literals mixed in below that, so the "zero tokens →
  tokens" story still holds for those, but a judge who inspects the file will see Bootstrap's
  own vars already there. If that is too messy for the demo, the lead may want to hand-trim
  the bootstrap preamble out of the target file first.

### Pick 3 — Light Bootstrap Dashboard React
- Repo: `creativetimofficial/light-bootstrap-dashboard-react`, MIT, 768 stars, pushed 2024-07
  (not archived).
- Why: second React/reactstrap dashboard but a visually distinct, lighter palette from
  Argon — good pacing contrast in a 3-app video. Zero existing `var(--)` usage, 58 distinct
  hex colors, 23 rgba, 44 radius declarations.
- Run: `npm install`, `npm start` → `http://localhost:3000`.
- `--target`: `src/assets/css/light-bootstrap-dashboard-react.css`.

### Backup 1 — Now UI Dashboard React
- Repo: `creativetimofficial/now-ui-dashboard-react`, MIT, 136 stars, pushed 2026-06-24 (the
  freshest of the Creative Tim trio). Zero `var(--)`, 49 hex, 20 rgba, 46 radius decls.
- Run: `npm start`. `--target`: `src/assets/css/now-ui-dashboard.css`.
- Swap in if Light Bootstrap Dashboard has a setup snag; same genre and gap profile.

### Backup 2 — StartBootstrap Resume
- Repo: `StartBootstrap/startbootstrap-resume`, MIT, 2178 stars. Same build as Agency
  (prebuilt `dist/`, same BS5-var caveat), but personal-site genre instead of landing page —
  swap in if the agency template's photography-heavy look doesn't read well on camera.
- Run: `npx serve dist`. `--target`: `dist/css/styles.css`.

## Gap list for the rewriter (things it cannot handle yet, given these targets)

- **SCSS variables.** None of the 5 picks need this (all point at compiled `.css`, not
  `.scss`), but several screened repos (StartBootstrap's own `src/scss/_variables.scss`,
  Gentelella v4, Argon's `.scss` source) have a `$variable` layer upstream of the CSS the
  rewriter would see. If the lead ever points `--target` at a `.scss` file directly, hardcoded
  hex inside `_global.scss`/`sections/*.scss` partials would still be literal (not run through
  `$variables` consistently) but the rewriter would need to understand SCSS syntax, which
  isn't mentioned as supported.
- **Framework-level CSS variables mixed into the same file.** Both StartBootstrap picks ship
  compiled CSS that already contains ~600 `var(--bs-*)` declarations from Bootstrap 5 itself,
  sitting alongside the template's own hardcoded literals in one file. The rewriter has no way
  to distinguish "framework var, leave alone" from "author literal, tokenize me" — it will see
  whatever is in the file. Not a crash risk, just a demo-narrative risk (a careful judge could
  ask "isn't this already using variables?").
- **Vue SFC `<style>` blocks (`.vue` files).** `jsx.js`'s extension match is
  `/\.(jsx?|tsx?|mjs)$/` and the plain-CSS path expects a `.css` file; neither covers a `.vue`
  single-file component's embedded `<style>` block. This ruled out two strong, genuinely
  zero-token candidates — `vue-hackernews-2.0` (official Vue team HN clone, very recognizable)
  and `realworld-apps/vue-realworld-example-app` (actively maintained Conduit frontend). Worth
  a follow-up if the team wants a 4th app or a stretch goal: extracting `<style>` blocks from
  `.vue` files and running them through the same CSS path would unlock both.
- **Centralized theme/color files disguised as "no tokens."** `material-dashboard-react`,
  `bchiang7/v4`, and (likely) `flatlogic/react-material-admin` all ship a single
  `colors.js`/`theme.js`/`variables.js` that every component imports — functionally a token
  system already, just not expressed as CSS custom properties. Not a rewriter gap exactly, but
  worth a screening heuristic going forward: grep for a `theme`/`colors`/`palette` file that's
  imported repo-wide before counting literal drift, since raw hex-in-CSS counts alone miss this
  (JS files importing from one theme module don't show up as "many different values").
