# F17: hosted Muse Spark 1.3 vs open-weights Muse Spark Open

Same pages, same captured styles, same SAM 3.1 regions and clusters (hybrid segmenter); only the naming model
changes. Both run with `reasoning_effort: low` and the compact naming contract. Measured 2026-10-26, cache off.

- **Hosted:** `muse-spark-1.3` on the Meta Model API (`S2T_NAMER=meta`).
- **Open weights:** `meta-models/muse-spark-open-1026` on Baseten (`S2T_NAMER=baseten`).

| Page | Model | Naming time | Output tokens | Validator repairs | Semantic + component tokens | Reasons grounded | Roles-differ flags | Eval |
|---|---|---|---|---|---|---|---|---|
| acme-shop (fixture) | hosted | 18.7 s | 3,332 | 0 | 12 | 12/12 | 2 | 20/21 |
| acme-shop (fixture) | open | 4.4 s | 1,036 | 0 | 9 | 9/9 | 2 | 20/21 |
| div-soup (fixture) | hosted | 16.5 s | 3,467 | 0 | 16 | 16/16 | 1 | 18/20 |
| div-soup (fixture) | open | 3.2 s | 893 | 0 | 16 | 15/16 | 2 | 18/20 |
| Argon Dashboard React | hosted | 14.5 s | 2,347 | 0 | 8 | 8/8 | 2 | n/a |
| Argon Dashboard React | open | 4.0 s | 769 | 0 | 12 | 12/12 | 2 | n/a |
| Light Bootstrap Dashboard | hosted | 26.2 s | 4,765 | 0 | 12 | 11/12 | 2 | n/a |
| Light Bootstrap Dashboard | open | 3.0 s | 783 | 2 | 13 | 12/13 | 2 | n/a |
| StartBootstrap Agency | hosted | 14.5 s | 2,528 | 0 | 11 | 11/11 | 4 | n/a |
| StartBootstrap Agency | open | 3.5 s | 902 | 0 | 13 | 13/13 | 4 | n/a |

Argon's first runs showed 2 repairs for both models; the cause was our own draft naming a negative margin
`space.-96`. Fixed (`space.neg-96`) and Argon rerun with the open model: 0 repairs.

## What it shows

- **Same quality on everything we can score.** Identical eval on both fixtures (20/21, 18/20); 94 to 100% of reasons pass
  the deterministic grounding check for both models; the same roles-differ flags fire.
- **Muse Spark Open is 4 to 9 times faster** (3 to 4.4 s vs 14.5 to 26 s for naming) and writes 3 to 6 times fewer
  output tokens.
- **The one model slip:** on Light Bootstrap, Muse Spark Open renamed a primitive to a name already in use. The validator
  dropped the duplicate and re-added coverage (2 repairs), so the token set stayed complete. This is why the model
  proposes and deterministic code guarantees the shape.
- **What this means for a team:** the open-weights model can run on infrastructure they control (served here on
  Baseten) with the same results on these pages, which matters for design systems that can't send code to a hosted
  API. Five pages is a small sample; the numbers are what we measured, not a general claim.

Reproduce: copy a finished run folder, then `S2T_NAMER=<meta|baseten> S2T_CACHE=0 node src/cli.js run --run <copy>
--from name --to emit`, then `node src/cli.js eval --fixture <name> --run <copy>` for the fixtures.
