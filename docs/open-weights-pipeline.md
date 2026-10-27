# L17: the whole pipeline on open weights (SAM 3.1 on Modal + Muse Spark Open on Baseten)

Same screenshots, same prompts (`button`, `search bar`, `icon`), same 1600 px tiles, same hybrid rules; only the SAM
changes. Measured 2026-10-27.

- **Hosted:** `sam-3.1` on the Meta Model API (`S2T_SEGMENTER=meta`, or `hybrid`).
- **Open weights:** `facebook/sam3.1` (checkpoint `sam3.1_multiplex.pt`) run with Meta's own `sam3` package on a Modal
  L4 GPU (`S2T_SEGMENTER=modal`, or `hybrid+modal`). Model id in the metrics: `sam-3.1-open@modal`.

## Method

- `modal/sam31_app.py` builds the SAM 3.1 detector the way `sam3.model_builder` builds it for the 3.1 video predictor
  (tri-head ViT backbone, text encoder, DETR decoder, segmentation head), leaves the multiplex tracker out, and loads the
  checkpoint's `detector.*` weights: 1,166 tensors, 0 missing, 0 unexpected, 854M parameters. It is driven by the
  package's `Sam3Processor` (resize to 1008 x 1008, one image embedding per tile, one grounding pass per prompt), bf16
  autocast. Pinned: `facebookresearch/sam3@f1647e8`, torch 2.10.0 + CUDA 12.8.
- The weights (3.5 GB) download once into the Modal Volume `s2t-sam31-weights` with `HF_TOKEN` from the Modal secret
  `hf-s2t` (created by the founder). Later containers read them from the Volume.
- No web endpoint. `modal/sam31_client.py` calls the deployed class with the caller's Modal token; the JS provider
  (`src/providers/segment/modal-sam.js`) spawns it with `uvx --from modal==1.6.3 python`, one call per screenshot
  (all tiles, all prompts), and caches each tile's result under `out/.cache`.
- Scales to zero: no keep-warm, 60 s idle window, at most one container.
- **Score cutoff 0.45.** The package default is 0.5. At 0.5 the open model returned 613 boxes where the hosted API
  returned 686 on the 27 breadth sites, and it missed div-soup's search bar (score 0.47). 0.45 gives the same count as
  hosted (686 vs 686). This was tuned once on the breadth set and then left alone for every other number here;
  `S2T_MODAL_THRESHOLD` overrides it.
- Hosted numbers come from the existing runs (`out/div-soup-sam`, `out/div-soup-hybrid`, `out/l1/<site>-sam|hybrid`)
  and, for breadth, from the response cache of the breadth4 runs, so no hosted call was repeated.

## Parity (IoU 0.5)

| Page | Segmenter | Hosted SAM 3.1 | Open SAM 3.1 | Buttons (hosted / open) | Gate (hosted / open) |
|---|---|---|---|---|---|
| div-soup (fixture) | SAM alone | 58% recall / 100% precision | 58% / 100% | 8/8 · 8/8 | no-go · no-go (no cards, nav, header, by design) |
| div-soup (fixture) | hybrid | 100% / 86% | 100% / 86% | 8/8 · 8/8 | GO · GO |
| Argon Dashboard | SAM alone | 22% / 41% | 22% / 41% | 4/4 · 4/4 | no-go · no-go |
| Argon Dashboard | hybrid | 73% / 50% | 73% / 50% | 4/4 · 4/4 | GO · GO |
| HackSoc Notts | SAM alone | 0% / - | 0% / - | 0/1 · 0/1 | no-go · no-go |
| HackSoc Notts | hybrid | 100% / 58% | 100% / 58% | 1/1 · 1/1 | GO · GO |
| josh-wong.github.io | SAM alone | 48% / 56% | 48% / 56% | 3/4 · 3/4 | no-go · no-go |
| josh-wong.github.io | hybrid | 100% / 51% | 100% / 51% | 4/4 · 4/4 | GO · GO |

L1 sites are scored with `segeval --max-y 900` against `fixtures/l1/<site>.truth.json`; div-soup against
`fixtures/div-soup/regions.truth.json`. Every per-label recall and precision is identical; matched-box IoU differs by
0.00 to 0.03 (open is slightly tighter on div-soup: input 1.00 vs 0.97).

**div-soup's story holds on open weights:** the DOM finds 0 of 8 buttons, open SAM 3.1 finds 8 of 8, like the hosted
model. It also repeats the hosted model's quirk: 13 "buttons", 5 of them status pills, which the hybrid's inert-pill
rule turns into badges.

### Box agreement on 27 breadth sites

The saved screenshots in `out/breadth4/<site>/` (75 tiles), segmented by both models; boxes matched one-to-one at
IoU >= 0.5 with the same label (`scripts/modal-parity.mjs breadth`). (The breadth4 folder holds 27 sites, not 28.)

| Cutoff | Hosted boxes | Open boxes | Matched | Hosted boxes found by open | Open boxes found by hosted | Mean IoU of matches |
|---|---|---|---|---|---|---|
| 0.50 | 686 | 613 | 598 | 87.2% | 97.6% | 0.89 |
| **0.45 (default)** | 686 | 686 | 663 | **96.6%** | **96.6%** | 0.89 |
| 0.40 | 686 | 725 | 677 | 98.7% | 93.4% | 0.89 |

At 0.45 by label: buttons 222 matched of 232 hosted / 225 open, icons 431 of 444 / 451, inputs 10 of 10 / 10.
13 of 27 sites agree box for box; the largest gap is zeikar (hosted 16 icons, open 10). Mean IoU 0.89 means the
two models draw slightly different boxes around the same things (different resize and preprocessing on each side), not
different things.

## Latency and cost

| | Hosted SAM 3.1 | Open SAM 3.1 on Modal L4 |
|---|---|---|
| Argon segment stage, warm | 2.2 s p50 (docs/latency.md) | 1.9 s (one tile: 0.46 GPU s + client and network) |
| Per tile | 3 calls (one per prompt) | 0.44 GPU s for all 3 prompts (33.1 GPU s over 75 tiles) |
| $ per tile | $0.0075 (3 x $0.0025) | $0.0001 measured GPU time (0.44 s x $0.80/h) |
| $ per screenshot (breadth average, 2.8 tiles) | $0.021 | $0.0003 measured GPU time |
| Cold start | none | 164 s (container start, about 8 GB image, 16 s to build the model and load 3.5 GB of weights); the very first call after deploy took 573 s |

The measured GPU seconds are what `recordCall` prices (`gpuS` in `timing.json`). Modal bills container time, which also
counts startup and the 60 s idle window after the last call, so the bill is higher than the per-image figure: for this
whole loop (image builds, weight download, two cold starts, three breadth passes, all parity runs) Modal billed
**$0.18** (L4 $0.159, CPU and memory $0.024, egress $0.001; `modal billing report` at 18:27 CDT) against about
2 minutes of measured inference. For a single page the startup and the idle window dominate (60 s of idle L4 is
$0.013), then each extra screenshot while warm costs $0.0001 of GPU time. Batches are where self-hosting is cheapest.

## All open weights: Argon, end to end

`S2T_SEGMENTER=hybrid+modal S2T_NAMER=baseten S2T_CACHE=0`, with the Meta key withheld (a nonexistent Keychain
service), so a hosted call would have failed:

- segment: 66 regions via `hybrid:sam3.1-open@modal+layout+dom`, 1.9 s, 0.46 GPU s (same 66 regions and labels as the
  hosted hybrid run on this page)
- name: 86 tokens via `meta-models/muse-spark-open-1026` on Baseten, 4.0 s
- verify: **fallback-only 0 px (pass); colors 0.000% (pass)**; all tokens 0.919% (layout changes for review); text
  contrast 0 regressions
- models in `timing.json`: `sam-3.1-open@modal` and `meta-models/muse-spark-open-1026`, nothing else. 19.6 s total.

## Limits

- **Point prompts are not served.** `src/stages/nontext.js` asks the hosted API for a point-prompted outline per control.
  In the open release, single-image point prompts go through the SAM 3.1 multiplex tracker (the video predictor), not
  the detector; wiring that is a separate change. Without it, `s2t nontext` falls back to the hybrid's boxes
  (`S2T_NONTEXT_SAM=0`).
- **No masks.** The app returns boxes and scores. The hosted provider also saves masks, which `nontext` uses for icon
  outlines; open runs have none, so those checks use boxes.
- **Cold starts are slow** (2.5 to 10 minutes). Run a batch, or call once to warm up before a demo. Memory snapshots
  would cut this; not done here.
- The cutoff (0.45) was picked on the breadth set; div-soup and L1 are not fully independent of that choice, since the
  div-soup search-bar miss is what prompted looking at it.
- Same data policy as hosted: only public, non-sensitive screenshots go to Modal.

## How to run

```
# once (founder): Modal payment method; Modal secret hf-s2t with HF_TOKEN that has facebook/sam3.1 access
modal deploy modal/sam31_app.py
# MODAL_TOKEN_ID / MODAL_TOKEN_SECRET in the environment (or a Modal profile), then:
S2T_SEGMENTER=hybrid+modal S2T_NAMER=baseten node src/cli.js run --serve <app build> --run out/<run>
S2T_SEGMENTER=modal node src/cli.js run --url https://example.invalid --run <copy of a run> --from segment --to segment
node scripts/modal-parity.mjs smoke <screenshot.png>          # cold, then warm
node scripts/modal-parity.mjs breadth out/breadth4 out/l17/breadth
```

Without GPU access, `S2T_MODAL_CHECK_ONLY=1 modal run modal/sam31_app.py::check` builds the image and the model on a CPU,
and `::prefetch` downloads and loads the weights.
