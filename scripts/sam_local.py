#!/usr/bin/env python3
"""Local SAM 3 / 3.1 segmentation helper, driven by src/providers/segment/local-sam.js.

NOT RUN as part of this task — this is scaffolding for later, by hand, during the Mac owner's
granted heavy-job window (00:00-06:00 CDT unless another window is granted). Do not pip install
anything or run this from an agent session; a human runs it deliberately.

What it needs (per docs/providers-research.md §3, from the facebookresearch/sam3 repo + HF docs,
UNVERIFIED on this machine):
  - Python >= 3.12
  - torch >= 2.7 (the official repo asks for CUDA 12.6+; Apple Silicon MPS support is NOT
    confirmed anywhere we found — this script tries MPS and falls back to CPU, but CPU inference
    of an 848M-parameter segmentation transformer over a full-page screenshot may take many
    seconds per image)
  - transformers, with Sam3Model / Sam3Processor (the HF-ported classes; the upstream repo's own
    `sam3.model_builder.build_sam3_image_model()` + `Sam3Processor` is an alternate, non-HF path —
    if the transformers import below 404s on PyPI's published version, that's the fallback to try)
  - the gated `facebook/sam3.1` (or `facebook/sam3`) weights: `hf auth login` with a token that has
    accepted the model's license on huggingface.co first
  - Memory: weights alone are a few GB at fp16; budget for 4-6 GB of resident memory on a 16 GB
    Mac, which is tight alongside Chrome + Playwright + an editor — close other heavy apps first.

Usage (by hand, later):
  python3 scripts/sam_local.py --image out/<run>/screenshot.png \
      --prompts button,"text input",card,"navigation bar",header,link,icon,image,badge \
      --out out/<run>/sam-local.json

Output: a JSON array of Region objects (see src/types.js) written to --out:
  [{"id": "r0", "bbox": [x, y, w, h], "label": "button", "score": 0.0-1.0, "source": "sam-local"}, ...]
"""
import argparse
import csv
import io
import json
import sys

LABEL_BY_PROMPT = {
    "button": "button",
    "text input": "input",
    "card": "card",
    "navigation bar": "nav",
    "header": "header",
    "link": "link",
    "icon": "icon",
    "image": "image",
    "badge": "badge",
}

DEFAULT_MODEL = "facebook/sam3.1"


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--image", required=True, help="Path to the full-page screenshot PNG.")
    p.add_argument("--prompts", required=True, help="Comma-separated concept prompts, e.g. button,card.")
    p.add_argument("--out", required=True, help="Path to write the Region[] JSON to.")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"HF model id (default: {DEFAULT_MODEL}).")
    return p.parse_args(argv)


def pick_device():
    """MPS if available (unverified for SAM 3 — see module docstring), else CPU."""
    import torch  # deferred import: give the clearer missing-deps message first if torch is absent

    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_model(model_id, device):
    # ASSUMPTION (unverified on this machine): transformers ships Sam3Model/Sam3Processor for the
    # SAM 3 family. If this import fails on the installed transformers version, the alternate path
    # is the upstream repo's own `sam3.model_builder.build_sam3_image_model()` + `Sam3Processor`
    # (see docs/providers-research.md §1b) — that path needs `pip install -e .` from a checkout of
    # facebookresearch/sam3, not a PyPI package.
    from transformers import Sam3Model, Sam3Processor

    processor = Sam3Processor.from_pretrained(model_id)
    model = Sam3Model.from_pretrained(model_id).to(device)
    model.eval()
    return model, processor


def segment_image(model, processor, device, image_path, prompts):
    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    regions = []
    next_id = 0
    for prompt in prompts:
        label = LABEL_BY_PROMPT.get(prompt, "other")
        inputs = processor(images=image, text=prompt, return_tensors="pt").to(device)
        import torch

        with torch.no_grad():
            outputs = model(**inputs)
        # ASSUMPTION: post-processing API name/shape is unverified pre-access; this is the
        # single spot to adjust once real output is observed. Expected shape: boxes in
        # (x1, y1, x2, y2) pixel coords, one row per detected instance, plus per-instance scores.
        results = processor.post_process_instance_segmentation(
            outputs, target_sizes=[(height, width)]
        )[0]
        boxes = results.get("boxes", [])
        scores = results.get("scores", [])
        for i, box in enumerate(boxes):
            x1, y1, x2, y2 = [float(v) for v in box]
            score = float(scores[i]) if i < len(scores) else 0.5
            regions.append(
                {
                    "id": f"r{next_id}",
                    "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
                    "label": label,
                    "score": score,
                    "source": "sam-local",
                }
            )
            next_id += 1
    return regions


def main(argv):
    args = parse_args(argv)
    prompts = next(csv.reader(io.StringIO(args.prompts)))

    try:
        device = pick_device()
        model, processor = load_model(args.model, device)
    except ImportError as e:
        sys.stderr.write(
            "sam_local.py: missing dependency ({}). This script needs torch, transformers and "
            "Pillow, plus the gated facebook/sam3.1 weights (hf auth login after accepting the "
            "model license). See the header comment in this file for the exact install steps — "
            "none of that has been installed in this environment on purpose (shared machine, "
            "no unsupervised pip installs). Not installing automatically.\n".format(e)
        )
        return 1
    except OSError as e:
        sys.stderr.write(
            f"sam_local.py: could not load model '{args.model}' ({e}). Likely missing HF auth / "
            "license acceptance, or no network access. Run `hf auth login` by hand first.\n"
        )
        return 1

    try:
        regions = segment_image(model, processor, device, args.image, prompts)
    except Exception as e:  # pragma: no cover - defensive; real shape unverified pre-access
        sys.stderr.write(f"sam_local.py: segmentation failed ({e}). The post-processing API name "
                          "or output shape likely changed — see the ASSUMPTION comment in "
                          "segment_image().\n")
        return 1

    with open(args.out, "w") as f:
        json.dump(regions, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
