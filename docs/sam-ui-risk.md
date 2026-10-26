# SAM on UI screenshots: risk assessment

Researched 2026-10-25, one day before Meta Model API access opens (Oct 26). Web research only,
no hands-on testing (no API key yet, no local model runs per the "don't install/run heavy
processes" rule for this task). Confidence tags: **[solid]** multiple independent sources agree,
**[likely]** one decent source, plausible, **[guess]** inferred/pattern-matched.

## 1. Does anyone use SAM on UI screenshots, and how well does concept prompting work there?

No direct evidence of SAM (any version) being run on web app or app UI screenshots specifically.
Search turned up plenty of SAM-on-images work (background removal, Figma cutout plugins, medical
and industrial segmentation), but nothing pairing SAM with "button", "nav bar", or any GUI concept
prompt. **[solid as an absence finding]** — this is itself the headline risk: we are not reusing a
known-working recipe, we are the first data point.

What we do know, by analogy:

- SAM 3's whole feature is promptable concept segmentation (PCS): give it a short noun phrase
  ("yellow school bus", "red bicycle") plus an image, get back every matching box + mask. This is
  exactly our prompt style ("button", "card"). [solid, Meta's own framing, confirmed again on
  `dev.meta.ai/docs/models`: "Give it a short noun phrase such as 'yellow school bus' ... and it
  returns every match as a box and a pixel-accurate mask."]
- SAM is a natural-image segmenter trained on photos, not UI mockups. The closest failure data we
  found is adjacent, not UI-specific:
  - A `facebookresearch/sam3` GitHub issue (#500) about bad segmentation on a plane photo traced to
    **image preprocessing bugs (RGB vs BGR channel order, wrong normalization)**, not a model
    limitation. Good news for our 1b assumption: if results look wrong on day 1, check preprocessing
    before concluding the model can't do UI. [likely, single issue thread]
  - A separate paper on **abstract icon segmentation** (SemLayer, arXiv 2603.24039) found that
    "classical segmentation methods like SAM often fail" on icons because of "high abstraction and
    minimal color cues," confusing strokes with filled regions and producing unstable masks. Icons
    are flat, geometric, and low-texture, exactly the UI-chrome situation we're in for icon/badge
    prompts. [likely, one paper, but the mechanism (SAM relies on texture/edge cues; flat UI chrome
    has little texture) matches well-understood SAM behavior]
  - SAM's own known failure mode is **over-segmentation on texture-rich or occluded regions**, driven
    by its mask-decoder producing multiple plausible masks per prompt; Meta's own pipeline already
    applies IoU-confidence filtering + NMS to control this. [solid, from the original SAM paper and
    repeated across tutorials] For UI screenshots this cuts both ways: nested elements (icon inside
    button inside card) are visually "occluded" in the same sense, so expect SAM to return multiple
    overlapping boxes for one concept (e.g. three "card" hits nested inside each other) rather than
    missing them outright.
  - GUI-grounding benchmark literature (ScreenSpot-Pro, arXiv 2504.07981) is run against
    vision-language grounding models (OS-Atlas, UI-TARS, etc.), not SAM, but its numbers set
    expectations for GUI generally: the best model scored only 18.9% on ScreenSpot-Pro's
    professional-app screens, **icon targets hit 4.0% accuracy vs 28.1% for text targets**, and
    accuracy drops hard as target boxes get smaller (ScreenSpot-Pro's median target is 0.07% of
    image area vs 2.01% in earlier, easier benchmarks). None of this is SAM-specific, but it says
    "small, icon-like UI targets are hard for vision models in general," which should calibrate
    expectations for SAM's badge/icon/link prompts specifically. [solid for the benchmark numbers,
    likely as an analogy to SAM's case since SAM wasn't tested]

Expected failure modes for our concept list, reasoned from the above (not observed):

| Concept | Expected risk | Why |
|---|---|---|
| button, card | lower risk | Usually has a bg fill + shadow/radius = enough visual signal |
| text input | medium | Often just a thin-bordered rectangle, easy to confuse with "card" |
| navigation bar, header | medium | Large flat regions, plausible over-segmentation (nav bar vs its own buttons) |
| icon, badge | high | Small, flat-colored, low-texture, exactly where generic segmenters and GUI-specific models both struggle |
| link | high | Links are usually styled text with no visual chrome at all; nothing for a segmenter to find a box around until it reads the text itself |
| image | lower risk | Photos/illustrations are the content SAM was trained on |

## 2. What do GUI-specific detectors do that SAM doesn't?

| Model | What it's trained for | License | API / free-credit access |
|---|---|---|---|
| **Microsoft OmniParser v2** | YOLO-based icon/button/input detector fine-tuned specifically on screenshots ("where are the clickable things"), plus a captioning model that names each detected region | icon_detect_v3 + icon_caption combo is MIT; the older Ultralytics-based icon detector it superseded is AGPL [solid, HF model card + repo] | Hosted on **Replicate** (`microsoft/omniparser-v2`, ~$0.001/run, few-second latency) and on **Hugging Face** (`microsoft/OmniParser-v2.0`) and Azure AI catalog. **No confirmed listing on Baseten, Fireworks, or Modal** [guess that it's absent; search did not find one, but all three platforms can self-host any HF/Docker model, so it's buildable there even if not pre-listed] |
| **Ferret-UI / Ferret-UI 2** (Apple) | MLLM tuned for mobile UI referring + grounding across iPhone/Android/iPad/web/AppleTV | Research license from Apple, not a permissive OSS license as far as we found [guess, no license page loaded] | No API/hosted endpoint found. Research artifact, not a product. |
| **SeeClick** | Visual GUI grounding (click-point prediction from instruction text) | Code+model on GitHub, open [likely] | No hosted API found; self-host only |
| **CogAgent** | GUI agent grounding, benchmarked alongside SeeClick/Ferret-UI | Open weights (Zhipu AI lineage) [guess] | No hosted API found |
| **UGround / UGround-V1 (OSU-NLP-Group x Orby AI)** | Universal GUI visual grounding, ICLR'25 oral, strong ScreenSpot numbers, built on Qwen2-VL | **MIT license** [solid, repo README] | On Hugging Face with "Inference Providers" listed on the model page, meaning it may be servable through HF's own inference backends; not confirmed on Baseten/Fireworks/Modal directly |
| **GroundingDINO (/ 1.5)** | Open-vocabulary object detector, text prompt → boxes (not UI-specific, but very commonly used as the detector half of "Grounded SAM" pipelines) | **Apache-2.0** [solid, repo + HF] | On **Replicate** (`adirik/grounding-dino`, ~$0.0015/run) and HF Spaces demo; general search suggests Baseten/Fireworks also list grounding-dino variants but this was not independently confirmed by direct page fetch [likely, not verified] |
| **Screen2Words** | Image→natural-language summary of a UI screen (captioning, not detection) | Research code from Google, no bounding boxes at all | Not applicable to our box-extraction need; only useful if we ever want a one-line screen description |

Headline: **ScreenSpot benchmark numbers put Ferret-UI 2 at 54.0% average click accuracy, SeeClick
at 53.4%, CogAgent-18B at 47.4%** [likely, aggregated from arXiv 2410.18967 and related coverage] —
these are instruction-grounding numbers (click on "the submit button"), not concept-segmentation
numbers, so not directly comparable to what SAM would be asked to do, but they confirm GUI-specific
training gives a real, measured edge over general-purpose vision models on UI targets.

**Practical read for the hackathon:** OmniParser v2 is the one GUI-specific option that is both
well-licensed (MIT once you pair icon_detect_v3 + icon_caption) and trivially API-reachable today
(Replicate, cheap, no account setup beyond a Replicate token) without touching the shared Mac's GPU.
If SAM's day-1 recall is bad, OmniParser-via-Replicate is the single best fallback to try next,
better than any of the research-only grounding models above. It returns different box semantics
though (interactive-element detection, not our label set), so `toRegions()`-equivalent mapping would
need new code, not a drop-in swap for `meta-sam.js`.

## 3. Can Muse Spark return bounding boxes directly, as a fallback/ensemble?

Yes, with a caveat. Meta's docs and third-party coverage describe a `container.visual_grounding`
tool inside Muse Spark's agent/chat tool harness: it takes `object_names` (array) and
`image_path`, plus `format_type` (`"bbox"|"point"|"count"`), and returns boxes, points, or counts
per named object. [likely, dev.to writeups + a Meta blog post + an X thread describing hands-on
testing, independently converging] One X post from someone testing it hands-on called it "far from
perfect" at bounding boxes specifically, strongest at counting. [likely, single hands-on report]

**The caveat that matters for Oct 26:** the dev.to piece covering the 16-tool harness states this
capability is **"private preview only for now"** as of its writing. [likely, one source, but it is
the most direct statement found on API availability for this specific tool] That means
`container.visual_grounding` may not be enabled on a fresh hackathon API key even though the chat
product at meta.ai can use it. By contrast, SAM 3.1 is described on `dev.meta.ai/docs/models` as
"a directly callable API model, not a tool within Muse Spark" — a separate, more clearly
general-access surface.

**Recommendation:** try `container.visual_grounding` on Oct 26 as a cheap probe (one Muse Spark
chat-completion call with a tool definition matching the shape above, one screenshot, object names
= our concept list). If it 403s or the tool isn't offered, that confirms private-preview gating and
we drop it without further time spent. If it works, it's attractive as an **ensemble vote**
alongside SAM rather than a replacement: SAM gives pixel masks (useful for color sampling inside a
region), Muse Spark's tool gives a second independent box set per concept at effectively one extra
API call. Use it to break ties when SAM returns zero or multiple candidates for a label, not as the
primary path, since its own accuracy is self-reported as rough and its availability is unconfirmed.

## 4. Prompts, tiling, NMS, and a day-1 quality score

**Prompt phrasing.** Keep the existing one-word-per-concept list (`CONCEPT_PROMPTS` in
`meta-sam.js`) as the baseline, since that matches SAM3's own "short noun phrase" guidance and is
what the mock oracle's labels already assume. Add longer descriptive variants as a second pass only
if the short prompts under-recall, since SAM3 is documented to accept exemplar/visual prompts too,
not just text:

| Current prompt | Candidate longer phrasing to try if recall is low |
|---|---|
| button | "rounded rectangle button with text" or "primary call to action button" |
| text input | "text input field with a visible border" |
| card | "white or light rectangular panel with rounded corners and a shadow" |
| icon | "small square icon, no text" |
| badge | "small pill-shaped label with a count or short word" |

Longer phrases cost nothing extra per call (same endpoint, same pricing unit) so this is cheap to
A/B: run the short list, then the long list, on the same screenshot and compare `segeval.js` scores.

**Tile size.** `TILE_H = 1600` in `meta-sam.js` already matches the capture tiling (1440x1600) in
the brief. No change needed; this keeps each tile close to a single "screenful," which is the
regime SAM and GUI-grounding models are generally evaluated in (ScreenSpot-style single-screen
images), rather than the much harder, much-smaller-relative-target regime of ScreenSpot-Pro's
ultra-high-res professional screens (§1 above).

**Non-max suppression.** Not implemented yet in `meta-sam.js`; SAM's own known over-segmentation
behavior (§1) means the join/cluster stage downstream should expect it, or `segment()` should dedupe
before returning. Add a simple per-label NMS pass: sort by score (SAM concept-match score if
present, else 1.0), suppress any box with IoU > 0.7 against an already-kept box of the **same
label**. Do NOT suppress across labels (an "icon" fully inside a "button" is a real, wanted nested
pair, not a duplicate). `src/stages/segeval.js` already has an `iou()` helper; reuse it rather than
writing a second IoU function.

**Minimum box size.** Add a floor, e.g. drop any region under roughly 8x8 px (or under some % of
tile area) before returning from `segment()`. SAM's token stream can emit degenerate tiny boxes at
tile seams; filtering them is cheaper than letting them pollute the join/cluster stage.

**Labeling overlapping regions.** When two different-label boxes overlap heavily (e.g. "card" and
"button" at >0.8 IoU), prefer the more specific/smaller label for the join step (button over card),
since the join stage's job is to find the DOM element whose computed style explains that region, and
the smaller box is more likely to map to one coherent DOM node rather than a parent + its children.

**Measuring SAM quality on day 1: already built.** `src/stages/segeval.js` exists and does exactly
what was asked: `scoreSegmentation(pred, oracle)` computes per-label precision/recall/mean-IoU via
greedy IoU matching against the mock segmenter's DOM-derived oracle boxes (default threshold IoU ≥
0.5), plus a label-agnostic "any-label" recall/precision. There is also a `GO_RULE` +
`goNoGo(score)`: go when button/input/card each recall ≥ 60% and any-label recall ≥ 50%. This is a
reasonable starting bar; no code change needed to answer this part of the question, just run it
against the real SAM output on Oct 26. One refinement worth considering before day 1: add "icon" to
the reasoning (not necessarily `GO_RULE.labels`, since §1/§2 above suggest icon recall will likely be
the weakest category industry-wide) so a low icon score doesn't quietly fail the whole run; instead
treat icon/badge/link as a known-weak, non-blocking category and gate go/no-go on button, input,
card, and nav/header, which are also the labels that matter most for the token-naming demo story
("this blue is the primary button background").

## 5. Day-1 test plan (Oct 26-27), under 2 hours

| Step | Time | What | Go/no-go signal |
|---|---|---|---|
| 1 | 10 min | Confirm `META_API_KEY` works at all: one trivial chat completion against `META_API_BASE_URL` with the existing `chat()` client (per `docs/providers-research.md` §5). | Auth works, correct base URL identified |
| 2 | 10 min | One raw SAM 3.1 call, one concept ("button"), one small test image, log the full raw response body to disk. | Confirms real response shape vs the token-stream assumption in `meta-sam.js`; if it's plain JSON boxes instead, only `extractOutputText`/`callSam` need a rewrite per the code comments already there |
| 3 | 15 min | If shape matches (or after a quick fix), run `S2T_SEGMENTER=meta node src/cli.js run --fixture acme-shop` end to end on the existing fixture, which already has a `golden.json` with `regions` floors. | Pipeline completes without throwing; some regions come back |
| 4 | 20 min | Run `segeval.scoreSegmentation()` (or a small script calling it) comparing SAM's regions against `oracleFor(capture)` for the acme-shop fixture. Try both the short and long concept-prompt lists (§4) if time allows. | Produces real per-label precision/recall/meanIoU numbers |
| 5 | 10 min | Apply `goNoGo(score)` using the existing `GO_RULE`, adjusted per §4 to exclude icon/badge/link from the blocking set. | **GO** if button, input, card, nav/header each hit ≥ 60% recall and any-label recall ≥ 50%. **NO-GO** otherwise |
| 6 | 15 min (only if NO-GO) | Quick probe of `container.visual_grounding` on Muse Spark (§3) as an ensemble check, and/or try OmniParser v2 via Replicate on the same fixture screenshot for an apples-to-apples precision/recall number against the same oracle. | Decide whether ensemble/fallback closes enough of the gap to demo, or whether the demo script needs to lean harder on the `mock` segmenter for the live demo and show SAM results as "future work" with real numbers from this test |
| buffer | 20 min | Slack for auth/host confusion (two base URL candidates in providers-research.md), model-id spelling (`sam-3.1` vs `sam-3-1`), or a SAM call timing out on a full 1440x1600 tile. | - |

**Go/no-go rule, stated once, plainly:** SAM 3.1 is good enough to demo live if, on the acme-shop
fixture, it recalls at least 60% of the oracle's button, input, card, and nav/header regions (by
IoU ≥ 0.5) and at least 50% of all oracle regions regardless of label. Below that, fall back to the
`mock` segmenter for the live demo path and present the real SAM numbers from this test as evidence
of what's needed before SAM becomes the default, rather than pretending it already works.

## Sources

- https://ai.meta.com/research/sam3/
- https://dev.meta.ai/docs/models
- https://dev.meta.ai/docs/sam/overview (per prior research, docs/providers-research.md §1b)
- https://github.com/facebookresearch/sam3/issues/500
- https://xxuhaiyang.github.io/SemLayer/ and https://arxiv.org/html/2603.24039 (SemLayer, icon segmentation failure modes)
- https://arxiv.org/html/2504.07981v1 (ScreenSpot-Pro: GUI grounding benchmark, icon vs text accuracy, target-size effects)
- https://github.com/microsoft/OmniParser , https://huggingface.co/microsoft/OmniParser-v2.0 , https://replicate.com/microsoft/omniparser-v2
- https://arxiv.org/html/2410.18967 (Ferret-UI 2, ScreenSpot comparison numbers vs CogAgent/SeeClick)
- https://github.com/njucckevin/SeeClick
- https://github.com/OSU-NLP-Group/UGround , https://huggingface.co/osunlp/UGround-V1-2B
- https://github.com/IDEA-Research/GroundingDINO , https://replicate.com/adirik/grounding-dino
- https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/
- https://dev.to/o96a/metas-new-model-has-16-tools-heres-what-they-do-42m6
- https://x.com/deedydas/status/2043127931405529474 (hands-on visual_grounding impressions, via search snippet; page itself paywalled)
- Existing repo docs/code consulted: docs/providers-research.md, src/providers/segment/{mock.js,meta-sam.js}, src/stages/segeval.js
