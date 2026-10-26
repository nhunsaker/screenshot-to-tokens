# Provider research — Meta Model API, SAM 3.1, Muse Code, local Llama

Researched 2026-10-25 (one day before hackathon API access opens, 2026-10-26). Everything below is
from public docs/blog posts/news coverage found via web search — **none of it is hands-on verified**
against a live key. Re-check every endpoint/field name on Oct 26 before trusting it. Confidence tags:
**[solid]** multiple independent sources agree · **[likely]** one decent source, plausible · **[guess]**
inferred/pattern-matched, could easily be wrong.

## 1. Meta Model API ("Llama API" / dev.meta.ai)

Two public-facing doc domains showed up and seem to be the same product under rename/redirect:
`llama.developer.meta.com` 302-redirects to `dev.meta.ai` (e.g. `/docs/overview/` → `/docs/overview.md`).
Treat **`dev.meta.ai`** as current; `llama.developer.meta.com` as the older/alias name. [likely]

- **Base URL (native "Responses" API):** `https://api.meta.ai/v1` [likely]
- **OpenAI-compat base URL:** `https://api.llama.com/compat/v1/` per the Llama-API-branded docs
  [likely] — note this is a *different host* than `api.meta.ai`; unclear if both work or if one is
  stale. **Verify which host is current on Oct 26**; our client code takes the base URL from
  `META_API_BASE_URL` so either works once we know which.
- **Auth:** `Authorization: Bearer <API_KEY>` [solid] — matches the shape `src/providers/llm/chat.js`
  already sends, so the existing OpenAI-compatible `chat()` client should work unmodified once
  `META_API_BASE_URL` + `META_API_KEY` + a model id are set.
- **OpenAI SDK compatibility:** chat completions, streaming, JSON/structured output
  (`response_format: {type:"json_object"}`), function/tool calling, and vision (image_url) are all
  listed as supported on the compat layer. [likely]
- **Image input:** `image_url` accepts a real URL **or** a base64 data URI
  (`"data:image/jpeg;base64,<bytes>"`), inline images capped at 50 MB, up to 50 images/request,
  >50 → HTTP 400. Files API supports up to 1 GiB for larger uploads. Image tokens scale with
  resolution (~1300–1500 input tokens for a ~1280px image). [likely] This is good news for us: the
  full-page screenshot can go straight in as a data URI, no hosting step needed.
- **Muse Spark (naming model):** model ids seen: `muse-spark-1.1`, `muse-spark-1.2`, `muse-spark-1.3`,
  plus `-contributor` variants of each (see §1a). 1.3 is described as the current frontier
  reasoning/coding model; vision ("image understanding": scene description, object detection,
  perception grounding/coordinates) is demonstrated specifically on **Muse Spark 1.3**. [likely]
  Context window ~1M tokens (reported for 1.1; presumably ≥ for 1.3). [guess for 1.3's exact number]
  → set `META_NAMER_MODEL=muse-spark-1.3` once confirmed; our code already sends vision content only
  when `S2T_NAMER_VISION=1`, so this is a one-env-var change.
- **Rate limits / pricing:** Standard tier reported as 3,000 RPM / 1M TPM per team across API keys
  [likely, from aggregator sites, not Meta's own docs — treat as rough]. Base Muse pricing
  ~$1.25/M input, ~$4.25/M output tokens (one aggregator); contributor pricing far lower (§1a). SAM
  3.1 pricing reported as **$2.50 / 1,000 images** and **$0.20 / 1,000 video frames** [likely].
  $20 in free credits mentioned for new API accounts generally. **All pricing numbers are
  third-party-aggregator sourced, not from a primary Meta pricing page we could load — re-verify.**

### 1a. The "Contributor" tier — do not enable

Multiple independent sources (Meta's own announcement coverage + several tech blogs/news aggregators,
converging independently, so **[solid]** as a finding even though no single primary doc page loaded
cleanly) describe a **Contributor mode**: model ids like `muse-spark-1.2-contributor` /
`muse-spark-1.3-contributor`, priced roughly **10–12x cheaper** than standard (e.g. $0.10/M input vs
$1.25/M standard) but in exchange **your prompts and completions (including inter-session messages)
may be used by Meta to improve its products** — i.e. it trains on your data. It also reportedly carries
a much lower rate limit (~100 RPM vs 3,000 RPM standard).

**Per the hackathon's own data policy and this repo's hard rule: never select a `-contributor` model
id, never flip any "contributor"/"data sharing" toggle in the Meta dashboard.** Only public,
non-sensitive (class C) data goes to the API at all, and only on the standard (non-training) tier.
`.env.example` and the code comments in `meta-sam.js` flag this at every point a model id is read.

### 1b. SAM 3.1 via Meta Model API — the part we implement against

This is the best-documented piece because Meta shipped a dedicated SAM docs page
(`dev.meta.ai/docs/sam/overview`) and a product page (`dev.meta.ai/models/sam-3-1`). Still **[likely]**
not **[solid]** — one fetch each, and the two pages disagreed on the model-id spelling.

- **Model id:** seen as both `sam-3.1` and `sam-3-1` in different places. **Unverified which is
  correct — this is exactly why `META_SAM_MODEL` is an env var, not hardcoded.**
- **Endpoint:** `POST {base}/v1/responses` (the same "Responses API" shape Muse models use, not a
  bespoke `/segment` endpoint) [likely]. One call can carry image or video.
- **Request shape (as reported):** a `responses`-style payload with an input array mixing
  `{type:"input_text", text:"<short noun phrase, e.g. 'button'>"}` and
  `{type:"input_image", image_url:"<url or data: URI>"}` items. Optional
  `metadata:{mask_encoding:"one_bit"}` to control mask encoding. [likely, one source]
- **Response shape (as reported):** NOT a plain JSON array of boxes — it's a token-stream-ish
  `output_text` using special-token markup: a frame marker, then per-object tokens like
  `<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>` and `<|mask;x=..;y=..;data=<compressed>|>`, terminated by
  a `response.completed` event. Meta reportedly ships a `@meta-sam/parser` helper to decode this.
  [likely, one source — this is the single most important thing to re-verify Oct 26, since it
  determines whether `meta-sam.js`'s response parsing works at all or needs a rewrite to pull in that
  parser npm package.]
- **Concept prompts:** SAM 3/3.1's whole pitch is *promptable concept segmentation* — short
  open-vocabulary noun phrases like "button", "text input", "card", "navigation bar", "header",
  "link", "icon", "image", "badge" are exactly the right prompt style (this matches Meta's own
  "yellow school bus" example pattern). [solid, this is SAM3's core capability per multiple sources]
  One call appears to take one phrase; our factory sends one call per concept, which also means
  partial failure (one concept's call failing) doesn't kill the whole segment step.
- **Open weights (if the API falls through or for local fallback):** `facebook/sam3.1` / `facebook/sam3`
  on Hugging Face, gated (click-through "share your HF info" + Meta privacy policy). License:
  Meta's own "SAM License" — permits commercial use, redistribution-with-license, derivative works;
  **prohibits military/weapons, nuclear, espionage use**; no explicit open-source (OSI) license,
  just a permissive-ish custom one. [solid — license terms corroborated across HF pages + GitHub]
  GitHub: `facebookresearch/sam3` — ships `sam3.model_builder.build_sam3_image_model()` and a
  `Sam3Processor` (direct PyTorch, not HF `transformers` classes — a different source claimed HF
  `transformers` ships `Sam3Model`/`Sam3Processor` too; **both may be true**, HF's `transformers`
  integration wrapping the same weights). [likely, two sources disagree slightly on the exact import
  path]
  - **Requirements (from the GitHub repo):** Python ≥3.12, **PyTorch 2.7+ with CUDA 12.6+**,
    `pip install -e .`. **No MPS/Apple Silicon support mentioned anywhere** — the repo explicitly
    calls out "CUDA-compatible GPU". [likely] This matters a lot for us (§3 below).
  - **Model size:** 848M parameters [likely]; checkpoint GB size and RAM/VRAM needs weren't stated on
    the pages we loaded — **unverified**, but 848M params at fp16 is roughly ~1.7 GB of weights alone,
    plus encoder/decoder activation memory; on CUDA docs assume a real GPU, not unified memory. Running
    this on a 16 GB M4 with no CUDA and no confirmed MPS path is a stretch — see §4.

## 2. Muse Code

Described as Meta's **terminal-based coding agent** ("out of beta for long-horizon engineering work"),
distinct from the Muse Spark chat/vision model — it writes/debugs code, handles longer tasks, and can
run sub-agents concurrently. [likely] We found **no documented standalone HTTP API or scriptable CLI
flags** for driving it headless from another program (as opposed to an interactive terminal session) —
treat "Muse Code opens the PR for us" as aspirational/stretch-goal, not something to build against
before Oct 26. `src/providers/coder/meta-code.js` (not in scope for this task) should probably stay a
stub that throws "not available" until we've actually seen a CLI/API surface for it. **[guess]** on the
"no headless API" claim — absence of evidence, not evidence of absence; worth a direct look at
dev.meta.ai's docs nav on Oct 26 in case it's just not indexed yet.

## 3. Local SAM on this Mac (Apple Silicon)

- No MPS/Apple Silicon support is mentioned in the official `facebookresearch/sam3` repo docs we could
  load; it explicitly requires CUDA. **[likely]** this means running the *official* SAM 3/3.1 repo
  as-shipped on an M4 Mac (no discrete GPU, no CUDA) will not work without someone else's MPS port.
  PyTorch itself supports an `mps` device backend generally, so a community fork/patch *might* exist,
  but we found none verified. `scripts/sam_local.py` is written defensively: it tries `torch.backends
  .mps.is_available()` and falls back to CPU, but on CPU an 848M-parameter segmentation transformer
  over a full-page screenshot would likely be very slow (seconds-to-tens-of-seconds per image, unverified
  guess) — acceptable for a hackathon demo of a handful of screenshots, not for a tight loop.
- Given the CUDA requirement and the "don't start heavy processes" hard rule for this task, `local-sam`
  is built but **not run** here; it's a fallback path to try by hand later, ideally during the
  00:00–06:00 CDT window the Mac's owner allows for heavy jobs.

## 4. Local Llama via Ollama on this Mac (M4, 10 cores, 16 GB unified memory)

Public benchmark numbers found (**[likely]**, aggregator/community benchmark sites, not Meta's own):

| Model | Quant | Approx. weights size | Reported tok/s on M4-class 16 GB | Fits w/ Chrome+Playwright+editor? |
|---|---|---|---|---|
| llama3.2:1b | Q4 | ~0.8–1 GB | ~80–90 tok/s (M3 Pro number, directionally similar) | yes, easily |
| llama3.2:3b | Q4_K_M | ~2 GB | ~41–47 tok/s (multiple M4 Mac mini sources) | yes, comfortably |
| llama3.1:8b | Q4_K_M | ~4.9 GB | not found directly; scales down from 3B roughly with size/bandwidth — **[guess]** maybe ~15–20 tok/s | tight: 4.9 GB weights + KV cache + OS + Chrome + Playwright + editor on 16 GB unified memory leaves little headroom; usable but don't run it next to a heavy Chrome session |
| llama3.2-vision:11b | Q4_K_M | ~6.1–7 GB | not found; vision models generally slower per token than text-only at same size | risky on 16 GB alongside everything else; would want to close Chrome/other apps first |
| Llama 4 Scout (109B total, MoE, 17B active) | Q4 | **~65 GB** reported | n/a | **does not fit** — not a 16 GB-Mac model at any quant we'd want to use |

Token-generation speed on Apple Silicon is memory-bandwidth-bound (the model has to be re-read from
unified memory for every token), which is why bigger models get disproportionately slower, and why the
M4 Pro/Max (more memory bandwidth) numbers floating around online don't apply to a base M4. [solid —
this mechanism is well understood and consistently cited across sources]

**Recommendation:** `llama3.2:3b` is the right default for `OLLAMA_MODEL` on this machine — fast enough
to be usable interactively, small enough to coexist with Chrome + Playwright + an editor without
starving the system, good enough for naming/tagging tasks (it's already the repo's current default in
`.env.example`, so no change needed). If naming quality is lacking at demo time and there's RAM
headroom, try `llama3.1:8b` as a step up, but expect it to be noticeably slower and to want other apps
closed. Do **not** attempt `llama4-scout` or any model requiring tens of GB locally. None of this has
been run in this session — no Ollama process was started and no models were pulled, per the hard rule
against starting heavy local processes without a granted window (00:00–06:00 CDT unless the owner
grants one).

## 5. Env vars / model ids to fill in on Oct 26

```
META_API_KEY=                      # from the approval email / dev.meta.ai dashboard
META_API_BASE_URL=                 # try https://api.meta.ai/v1 first; https://api.llama.com/compat/v1 if that 404s
META_NAMER_MODEL=muse-spark-1.3    # NOT -contributor — verify this exact id string on Oct 26
META_SAM_MODEL=sam-3.1             # verify spelling — docs disagreed between "sam-3.1" and "sam-3-1"
```

First thing to do Oct 26: hit the real base URL with a trivial chat completion using the existing
`chat()` client and a `curl`/Node one-liner to confirm host + auth + model id before touching the
pipeline; then send one SAM request for a single screenshot and log the raw response body to see
whether the token-stream shape above is right or whether `meta-sam.js`'s `toRegions()` needs a rewrite.

## Sources

- https://llama.developer.meta.com/docs/features/compatibility/ (redirects to dev.meta.ai)
- https://llama.developer.meta.com/docs/overview/ (redirects to dev.meta.ai)
- https://dev.meta.ai/docs/overview.md
- https://dev.meta.ai/docs/image-understanding
- https://dev.meta.ai/docs/sam/overview
- https://dev.meta.ai/models/sam-3-1
- https://dev.meta.ai/products/meta-model-api
- https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/
- https://ai.meta.com/blog/segment-anything-model-3/
- https://github.com/facebookresearch/sam3
- https://huggingface.co/facebook/sam3 , https://huggingface.co/facebook/sam3.1
- https://x.com/MetaforDevs/status/2100993422865944967
- https://digg.com/tech/72cpvq31 ; https://cryptorank.io/news/feed/9f627-... ; https://www.developersdigest.tech/blog/meta-muse-code-spark-1-2-release ; https://blog.kilo.ai/p/meta-will-cut-your-token-bill-20x ; https://neomanex.com/news/meta-muse-spark-contributor-tier-data-price ; https://www.techtimes.com/articles/326714/20260904/... (Contributor tier, cross-checked across several independent write-ups)
- https://modelpiper.com/blog/ollama-vs-llamacpp-benchmark-mac ; https://pocketclaw.dev/guides/local-llms-benchmark-2026 ; https://computingforgeeks.com/ollama-models-cheat-sheet/ (M4 Ollama tok/s)
- https://www.spheron.network/blog/llm-vram-calculator-llama-4/ ; https://willitrunai.com/blog/llama-4-gpu-requirements (Llama 4 Scout size)
