# F19: run time and cost over repeated runs

Five uncached runs per real demo app (hosted Muse Spark 1.3 naming at low reasoning effort, hybrid segmenter, SAM 3.1),
measured 2026-10-26 18:26-18:33 CDT on an M4 Mac with 16 GB. Wall time per stage from each run's `timing.json`;
p50 = median, p90 = 90th percentile. Cost at Meta Model API list prices. Reproduce with `scripts/latency-runs.sh`.

| Page | Runs | Total p50 | Total p90 | capture p50 / p90 | segment p50 / p90 | name p50 / p90 | verify p50 / p90 | Cost p50 |
|---|---|---|---|---|---|---|---|---|
| agency | 5 | 34.9 s | 35.5 s | 2.8 / 2.8 s | 7.1 / 9.5 s | 12.8 / 15.9 s | 9.9 / 10.1 s | $0.050 |
| argon | 5 | 26.8 s | 29.9 s | 2.2 / 2.6 s | 2.2 / 2.9 s | 15.3 / 17.6 s | 6.4 / 6.5 s | $0.035 |
| lightbootstrap | 5 | 24.2 s | 26.3 s | 1.7 / 1.8 s | 2.1 / 2.7 s | 14.6 / 17.4 s | 4.9 / 4.9 s | $0.032 |

- **Safety checks held on all 15 runs:** fallbacks-only 0 px and colors-merged 0.000% every time.
- **Naming is most of the time** (about 15 s of 24 to 35 s). The open-weights model on Baseten names in 3 to 4 s (see
  `docs/f17-hosted-vs-open.md`), which would bring a full run under 15 s.
- **Agency is a 6,000 px tall page**, so SAM runs on 4 tiles (12 calls in parallel): 7 s and $0.05 instead of 2 s and $0.035.
- The F20 component-token change landed between rounds 3 and 4; naming time in rounds 4 and 5 is in the same range.
- This is wall time on one machine for these pages, not a throughput benchmark.

## L3: the demo namer is Muse Spark Open on Baseten (2026-10-26)

`zsh scripts/demo-runs.sh` warms the Baseten endpoint (`scripts/warm-namer.mjs`, 1.2 s), then runs the three demo apps
end to end, uncached, with `S2T_NAMER=baseten`. Hosted Muse Spark stays one switch away (`S2T_NAMER=meta`).

| App | Hosted total p50 (5 runs, above) | Open weights total (1 run) | Naming | Safety checks |
|---|---|---|---|---|
| Argon Dashboard | 26.8 s | 17.1 s | 4.2 s | 0 px, colors 0.000% |
| Light Bootstrap Dashboard | 24.2 s | 12.4 s | 3.6 s | 0 px, colors 0.000% |
| StartBootstrap Agency | 34.9 s | 26.4 s | 5.1 s | 0 px, colors 0.000% |

Naming is no longer the longest stage; verify (three screenshot passes) and, on the long Agency page, SAM tiles are.
Cost: $0.007 to $0.03 per run. One run per app, so these are single measurements, not percentiles.

**"3 to 5 s" naming, the combined range:** across these 3 runs (`out/demo-{argon,lightbootstrap,agency}-baseten/timing.json`:
4.196 s, 3.609 s, 5.119 s) plus the 5 single-fixture runs in `docs/f17-hosted-vs-open.md`
(`out/f17b-acme-shop-hybrid-baseten/timing.json` 4.382 s, `out/f17b-div-soup-hybrid-baseten/timing.json` 3.213 s,
`out/f17b-app-argon-baseten/timing.json` 4.021 s, `out/f17b-app-lightbootstrap-baseten/timing.json` 3.012 s,
`out/f17b-app-agency-baseten/timing.json` 3.488 s), Muse Spark Open on Baseten's measured naming time across all 8 runs
is 3.0 to 5.1 s &mdash; "3 to 5 s" rounds that correctly; it is not the f17 fixtures' narrower 3 to 4.4 s alone.
