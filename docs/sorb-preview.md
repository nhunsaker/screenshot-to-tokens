# Sorb live preview

The demo beat after rewrite/verify: a person nudges one token (e.g.
`color.action.primary`) and sees it change in the running app immediately — no
rebuild, no redeploy. This is exactly what Sorb (`sorb-juice` bridge +
`sorb-leaf` React SDK) already does; we don't build a preview mechanism, we
plug our output into theirs.

Everything below is sourced from the local `sorb-juice`/`sorb-leaf`/`sorb-core`
checkouts (source + READMEs), not from vendoring any of their code — this repo
only talks to a running `sorb dev` bridge over HTTP.

## Which package does what

| Package | Published version | Role |
|---|---|---|
| `@sorb/juice` | 0.3.0 | The bridge server + CLI (`sorb dev`). Holds the "current preview" in memory/DB and serves it over HTTP. |
| `@sorb/leaf` | 0.5.1 | React SDK (`SorbProvider`, `PreviewBanner`, hooks). Polls or SSE-subscribes the bridge and writes tokens onto `:root` as CSS custom properties. |
| `@sorb/core` | 0.3.0 | Shared JSDoc contract only (`ResolvedToken`/`ResolvedMap`, `TIERS`/`TIER_RANK`). No runtime code to import for this. |
| `@sorb/seed` | 0.5.1 | Capture + normalizers — we already depend on this (`src/lib/props.js`). Not used for preview itself. |

**Note on versions:** `sorb-juice`/`sorb-core` on npm (0.3.0) lag the local
monorepo checkout, which has newer routes in flight (e.g. the SSE
`/orgs/:orgId/preview/:id/subscribe` endpoint is flagged in `sorb-leaf`'s
`sse.js` as a TODO "reconcile when the sorb-juice agent lands the real
endpoint"). The core `POST/GET/PUT/DELETE /preview` + `GET /tokens/resolved`
routes this doc relies on are the long-stable ones described in the
`sorb-juice` README and are safe to depend on; we don't depend on the SSE
route (see Transport below).

This repo **does not add `@sorb/juice`/`@sorb/leaf`/`@sorb/core` as
dependencies** (no `pnpm install` was run for this task). `src/stages/preview.js`
talks to the bridge with plain `fetch` and reproduces the `ResolvedToken` shape
as a local JSDoc typedef. A consumer app wiring a **React** target would add
`@sorb/leaf` itself — that's their dependency, not ours.

## Config file: `sorb.config.json`

Written by `sorb init` (or our `writeSorbConfig()`, which mirrors it):

```json
{
  "namespace": "my-app",
  "tokenSources": ["tokens/primitive.json", "tokens/semantic.json", "tokens/component.json"],
  "styleDictionaryConfig": "sd.config.js",
  "port": 7777,
  "figmaFileKey": "abc123XYZ",
  "appUrl": "http://localhost:5173",
  "gh": "https://github.com/my-org/my-repo/edit/main/tokens/component.json"
}
```

`tokenSources` is a list of DTCG-shaped JSON files (a single merged file also
works — Style Dictionary just needs *a* DTCG source). Our `toDtcg()` output
(`tokens.json`, emit.js) is already DTCG-shaped (`$value`/`$type`/`$description`),
so pointing `tokenSources` at our emitted `tokens.json` is enough to get
`sorb dev` serving our tokens — see "Mapping plan" below for the one thing that
needs translating (`$type` has no `"shadow"`).

## Bridge endpoints (confirmed against `sorb-juice/src/server.js`)

The ones this demo needs:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/preview` | Body is the **raw tokens map itself** (`await c.req.json()` — not `{tokens: {...}}`). Returns `{ id, url }` where `url` is `"?preview=<id>"`. This is what the Figma plugin does; our `proposePreview()` does the same thing from Node. |
| `GET` | `/preview/:id` | The React app polls this while a preview is active. Response wraps the stored body: `{ id, tokens }`. |
| `GET` | `/preview/latest` | Most-recently-pushed preview, no id needed. |
| `PUT` | `/preview/:id` | Update a preview in place (live-edit mode). |
| `DELETE` | `/preview/:id` | Clear a preview, revert to committed tokens. |
| `GET` | `/tokens/resolved` | The resolved bindable map: `[{ id, cssVar, value, tier, type }]` per token — this is the `ResolvedToken`/`ResolvedMap` shape `toSorbTokens()` produces. |
| `GET` | `/health` | No auth, always open — good smoke test. |

In **local mode** (`sorb dev`, no `databaseUrl`) every route above is open, no
auth. Hosted mode (Sorb Cloud or a self-host with `databaseUrl`) requires a
Bearer key on everything except `/health`/`/ready`; `proposePreview()` takes an
optional `key` for that case.

## Transport: how the page receives the change

**Poll, by default.** `sorb-leaf`'s `PreviewConfig.pollInterval` defaults to
**1500 ms** — `SorbProvider` re-fetches `GET /preview/:id` on that interval
while a preview is active. SSE (`GET /orgs/:orgId/preview/:id/subscribe`) is a
newer, not-yet-published addition (Mode A / hosted relay only, per `sse.js`'s
own TODO) — today's path for a local `sorb dev` bridge, and the one our demo
should rely on, is the poll loop.

For a plain (non-React) page there's no `SorbProvider` to do this for you —
see "Non-React path" below for the ~15-line equivalent.

## Minimal steps (React target)

1. `npm install @sorb/juice @sorb/leaf` in the target app (their deps, not ours).
2. `npx sorb init` → edit `sorb.config.json` (`tokenSources` → our emitted
   `tokens.json`, or use `writeSorbConfig()` from this repo to write it
   directly into the target app's root).
3. `sorb dev` (default port 7777).
4. Wrap the app in `<SorbProvider config={...}>` (reads `preview.origin`,
   defaults to `http://localhost:7777`).
5. Call `proposePreview({ bridgeUrl, tokenName: 'color.action.primary', value: '#6d28d9' })`
   from this repo (or POST the same body with curl/the Figma plugin) → open
   the app at `<appUrl><url>` from the response (the `?preview=<id>` query
   string) → the banner/tokens update within one poll interval (≤1.5 s).

## Minimal steps (plain HTML/CSS target — our fixture apps)

The acme-shop-style fixture apps in this repo have no React tree to mount a
`SorbProvider` into. Two options, in order of how little we'd need to add:

**A. Skip `sorb-leaf` entirely, write tokens.css straight (what rewrite/verify
already do).** The demo's "nudge and see it live" moment can be done without
touching Sorb at all: the rewritten page already loads `tokens.css` with
`var(--token, fallback)`; editing one `:root` custom property via
devtools/a script IS the live-preview beat. This is the lowest-risk path if
the three demo apps stay plain HTML.

**B. Talk to the real `sorb dev` bridge from a tiny no-build client.** If the
demo specifically wants "the same bridge a Figma plugin would drive," add
`src/preview-client/sorb-preview-client.js` (plain ESM, no bundler, no
`@sorb/leaf` dependency) that:
   - fetches `GET /preview/latest` (or `GET /preview/:id` from a `?preview=`
     query param) every `pollInterval` ms,
   - applies the returned token map onto `document.documentElement.style` —
     the same operation as `sorb-leaf`'s `applyTokens()` (`root.style.setProperty('--'+key, value)`).

   This reimplements ~15 lines of `sorb-leaf/src/apply.js`'s poll+apply path
   without pulling in React or the package itself (keeps us dependency-free,
   per the hackathon rule). Not written yet — flagged for whoever wires the
   actual demo page, since it depends on which of the three target apps keeps
   a plain-HTML shape.

## Token id / CSS var comparison

Ours and Sorb's naming are already aligned by construction:

| | Ours (`screenshot-to-tokens`) | Sorb (`@sorb/core`) |
|---|---|---|
| Dotted id | `color.action.primary` (`TokenProposal.name`) | `button.primary.bg.default` (`ResolvedToken.id`) |
| CSS var | `--color-action-primary` (`cssVarOf()`, `lib/props.js`) | `--button-primary-bg-default` (`ResolvedToken.cssVar`) |
| Var rule | `'.' → '-'`, lower-cased | same (dotted id → kebab `--`-prefixed) |
| Tiers | `'primitive'\|'semantic'\|'component'` (`TokenProposal.tier`) | `'primitive'\|'semantic'\|'component'` (`Tier`, `@sorb/core`) — **identical vocabulary, identical precedence order** (`TIER_RANK`: component beats semantic beats primitive) |

So `cssVarOf()` (already in `src/lib/props.js`) IS Sorb's `id → cssVar` rule;
nothing to reconcile there. The one real gap is `$type`:

| Our `Cluster.kind` | Sorb `TokenType` | Match? |
|---|---|---|
| `color` | `color` | exact |
| `radius`, `space`, `font-size`, `line-height` | `dimension` | exact (all four collapse to one Sorb type) |
| `font-weight` | `fontWeight` | exact |
| `font-family` | `fontFamily` | exact |
| `shadow` | *(none)* | **no match** — `@sorb/core`'s `TokenType` is `'color'\|'dimension'\|'fontFamily'\|'fontWeight'\|'number'\|'string'`, no `shadow`. `toSorbTokens()` falls back to `'string'`. |

## Mapping plan: our `tokens.json` → Sorb's resolved-map

`src/stages/preview.js` exports `toSorbTokens(tokenSet, clusters)`:

1. For each `TokenProposal`, take `value` directly (primitives) or follow the
   alias chain with the existing `resolveValue()` (`src/stages/name.js` — the
   same resolver `validateTokenSet` uses to catch cycles) to a literal
   (`ResolvedToken.value` must carry no `var()` chains, per the `@sorb/core`
   contract).
2. Strip the `ff` alpha suffix from 8-digit hex (reuses `emit.js`'s `cssValue()`
   — same display convention `toCss()` already uses for `tokens.css`).
3. `cssVar` = `cssVarOf(name)` (already shared code, `lib/props.js`).
4. `type` = `Cluster.kind` run through the table above (`clusters` param is
   optional; omit it and every token types as `'string'`).
5. `tier` passes through unchanged (same three-value enum on both sides).

Result: an array of `{ id, cssVar, value, tier, type }` — byte-shape-compatible
with what `GET /tokens/resolved` serves and what a `TargetAdapter`/the plugin
expects as a `ResolvedMap`.

## What's NOT wired yet (for whoever picks this up)

- `src/pipeline.js` doesn't call any of this — `preview.js`'s three exports
  are usable standalone (e.g. from a demo script / `report.js`'s HTML) but
  nothing in the pipeline writes a `sorb.config.json` or proposes a preview
  automatically yet. Natural hook: a new optional stage after `verify`, or a
  CLI flag like `s2t run --preview` that calls `writeSorbConfig(target, {...})`
  once and `proposePreview({ bridgeUrl, tokenName, value })` per nudged token.
- The plain-HTML "option B" client (`src/preview-client/`) described above is
  designed but not written — depends on which of the three demo apps keeps a
  non-React shape (see `docs/demo-targets.md`, owned by another track).
- `proposePreview` assumes `sorb dev` is already running at `bridgeUrl`
  (default `http://localhost:7777`); it throws a clear error (naming `sorb dev`)
  if the bridge isn't reachable rather than trying to start one.
