"""SAM 3.1 from Meta's open weights on a Modal GPU (loop L17).

Serves the founder's own calls only: there is no web endpoint. The JS provider
(src/providers/segment/modal-sam.js) reaches it through modal/sam31_client.py, which
calls the deployed class with the caller's Modal token.

What runs:
  - The official facebookresearch/sam3 package (pinned commit below), torch 2.10 + CUDA 12.8.
  - The SAM 3.1 checkpoint `facebook/sam3.1` / `sam3.1_multiplex.pt` (gated on Hugging Face). SAM 3.1 ships one
    merged checkpoint (detector + multiplex tracker). We build only the detector half (the part that answers text
    prompts on a still image: the same promptable concept segmentation the hosted Meta API serves) and load the
    `detector.*` weights into it, then drive it with the package's own Sam3Processor.
  - Weights are downloaded once into the Modal Volume `s2t-sam31-weights` with HF_TOKEN from the Modal secret
    `hf-s2t` (created by the founder; this code never creates, reads out or modifies secrets).

GPU: L4 (24 GB, $0.80/h on Modal on 2026-10-27, the cheapest of L4/A10G). The detector is 854M params; it fits in a
few GB at bf16. Scales to zero: no keep-warm, 60 s idle timeout, one container max.

Deploy:   modal deploy modal/sam31_app.py
Smoke:    modal run modal/sam31_app.py --image path/to.png --prompts button,icon
CPU only (no GPU class; for accounts without GPU access yet):
          S2T_MODAL_CHECK_ONLY=1 modal run modal/sam31_app.py::check        (image + architecture, no weights)
          S2T_MODAL_CHECK_ONLY=1 modal run modal/sam31_app.py::prefetch     (download weights to the Volume, load them)
"""
import io
import os
import time

import modal

APP_NAME = "s2t-sam31"
SAM3_COMMIT = "f1647e8d0c1d280991f4d1b7d974c2704537fe66"  # facebookresearch/sam3 main, 2026-10-23
HF_REPO = "facebook/sam3.1"
HF_FILE = "sam3.1_multiplex.pt"
MODEL_ID = "sam-3.1-open@modal"
GPU = "L4"
GPU_USD_PER_HOUR = 0.80  # modal billing rates, 2026-10-27
# S2T_MODAL_CHECK_ONLY=1 leaves the GPU class out of the app, so the CPU functions run on an account that cannot
# start GPU containers yet (Modal asks for a payment method before any GPU).
CHECK_ONLY = os.environ.get("S2T_MODAL_CHECK_ONLY") == "1"
WEIGHTS_DIR = "/weights"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.10.0",
        "torchvision==0.25.0",
        index_url="https://download.pytorch.org/whl/cu128",
    )
    .pip_install(
        f"sam3 @ git+https://github.com/facebookresearch/sam3.git@{SAM3_COMMIT}",
        "setuptools<80",  # sam3.model_builder imports pkg_resources
        "huggingface_hub==0.36.0",
        "pillow==11.3.0",
        "numpy<2",
        "einops==0.8.1",
        "pycocotools==2.0.10",
        "opencv-python-headless==4.11.0.86",
        "scipy==1.16.2",
        "matplotlib==3.10.7",
        "psutil==7.1.0",
    )
    .env({"HF_HOME": f"{WEIGHTS_DIR}/hf", "HF_HUB_DISABLE_TELEMETRY": "1"})
)

app = modal.App(APP_NAME, image=image)
weights = modal.Volume.from_name("s2t-sam31-weights", create_if_missing=True)
# The HF token comes only from the founder's Modal secret `hf-s2t` (env HF_TOKEN inside the container).
hf_secret = modal.Secret.from_name("hf-s2t")


def _cpu_patch():
    """sam3 allocates a few constant tensors on "cuda" at construction; redirect them to the CPU (CPU paths only)."""
    import torch

    def on_cpu(fn):
        def wrapped(*a, **k):
            if str(k.get("device", "")).startswith("cuda"):
                k["device"] = "cpu"
            return fn(*a, **k)
        return wrapped

    for name in ("zeros", "ones", "arange", "empty", "tensor", "full", "linspace", "randn", "rand"):
        setattr(torch, name, on_cpu(getattr(torch, name)))


def _download():
    from huggingface_hub import hf_hub_download

    t0 = time.time()
    path = hf_hub_download(HF_REPO, HF_FILE, token=os.environ.get("HF_TOKEN"))
    hf_hub_download(HF_REPO, "config.json", token=os.environ.get("HF_TOKEN"))
    weights.commit()  # persists the first download for later containers; cheap once cached
    return path, round(time.time() - t0, 2)


def _build_detector(checkpoint_path, device="cuda"):
    """The SAM 3.1 detector exactly as sam3.model_builder.build_sam3_multiplex_video_predictor builds it, minus the
    tracker, with FlashAttention 3 off (not installed) so it runs on an L4."""
    import pkg_resources
    import torch
    from sam3.model.sam3_multiplex_detector import Sam3MultiplexDetector
    from sam3.model.vl_combiner import SAM3VLBackboneTri
    from sam3.model_builder import (
        _create_dot_product_scoring,
        _create_geometry_encoder,
        _create_multiplex_tri_backbone,
        _create_sam3_transformer,
        _create_segmentation_head,
        _create_text_encoder,
    )

    bpe_path = pkg_resources.resource_filename("sam3", "assets/bpe_simple_vocab_16e6.txt.gz")
    tri_neck = _create_multiplex_tri_backbone(compile_mode=None, use_fa3=False, use_rope_real=False)
    backbone = SAM3VLBackboneTri(scalp=0, visual=tri_neck, text=_create_text_encoder(bpe_path))
    detector = Sam3MultiplexDetector(
        num_feature_levels=1,
        backbone=backbone,
        transformer=_create_sam3_transformer(use_fa3=False),
        segmentation_head=_create_segmentation_head(use_fa3=False),
        semantic_segmentation_head=None,
        input_geometry_encoder=_create_geometry_encoder(),
        use_early_fusion=True,
        use_dot_prod_scoring=True,
        dot_prod_scoring=_create_dot_product_scoring(),
        supervise_joint_box_scores=True,
        is_multiplex=True,
    )
    if checkpoint_path is None:  # architecture check only (no weights)
        return detector.eval(), {"params": int(sum(p.numel() for p in detector.parameters()))}
    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if "model" in ckpt and isinstance(ckpt["model"], dict):
        ckpt = ckpt["model"]
    prefix = "sam3_model." if any(k.startswith("sam3_model.") for k in ckpt) else "detector."
    sd = {k[len(prefix):]: v for k, v in ckpt.items() if k.startswith(prefix)}
    missing, unexpected = detector.load_state_dict(sd, strict=False)
    return detector.to(device).eval(), {"loaded": len(sd), "missing": len(missing), "unexpected": len(unexpected),
                                        "missing_sample": list(missing)[:8], "unexpected_sample": list(unexpected)[:8]}


def _segment(processor, tiles, prompts, threshold, device):
    """One image embedding per tile, then one grounding pass per prompt (the cheap part). Boxes are x1,y1,x2,y2 in
    the tile's own pixels (Sam3Processor resizes to 1008x1008 and scales back)."""
    import contextlib

    import torch
    from PIL import Image

    processor.confidence_threshold = float(threshold)
    ctx = torch.autocast("cuda", dtype=torch.bfloat16) if device == "cuda" else contextlib.nullcontext()
    out = []
    with ctx:
        for png in tiles:
            img = Image.open(io.BytesIO(png)).convert("RGB")
            state = processor.set_image(img)
            per_prompt = {}
            for p in prompts:
                processor.reset_all_prompts(state)
                res = processor.set_text_prompt(prompt=p, state=state)
                boxes = res["boxes"].float().cpu().tolist()
                scores = res["scores"].float().cpu().tolist()
                per_prompt[p] = [
                    {"box": [round(b[0], 1), round(b[1], 1), round(b[2], 1), round(b[3], 1)], "score": round(s, 4)}
                    for b, s in zip(boxes, scores)
                ]
            out.append({"width": img.width, "height": img.height, "detections": per_prompt})
    if device == "cuda":
        torch.cuda.synchronize()
    return out


class Sam31:
    @modal.enter()
    def load(self):
        import torch
        from sam3.model.sam3_image_processor import Sam3Processor

        path, download_s = _download()
        t1 = time.time()
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        self.model, self.load_report = _build_detector(path)
        self.processor = Sam3Processor(self.model, device="cuda", confidence_threshold=0.5)
        self.load_s = {"download_s": download_s, "build_s": round(time.time() - t1, 2)}
        self.calls = 0

    @modal.method()
    def segment(self, tiles, prompts, threshold=0.45):
        """tiles: [PNG bytes]; prompts: [text]. Returns pixel-space boxes per tile per prompt, plus GPU seconds."""
        t0 = time.time()
        cold = self.calls == 0
        self.calls += 1
        out = _segment(self.processor, tiles, prompts, threshold, "cuda")
        return {
            "model": MODEL_ID,
            "checkpoint": f"{HF_REPO}/{HF_FILE}",
            "gpu": GPU,
            "gpu_usd_per_hour": GPU_USD_PER_HOUR,
            "gpu_s": round(time.time() - t0, 3),
            "cold": cold,
            "load": self.load_s if cold else None,
            "load_report": self.load_report if cold else None,
            "tiles": out,
        }


if not CHECK_ONLY:
    Sam31 = app.cls(
        gpu=GPU,
        volumes={WEIGHTS_DIR: weights},
        secrets=[hf_secret],
        scaledown_window=60,  # seconds idle before the container stops; no keep-warm (min_containers=0)
        timeout=600,
        max_containers=1,
    )(Sam31)


@app.function(cpu=2, memory=8192, timeout=900)
def check():
    """CPU only, no weights: proves the image builds and the SAM 3.1 detector constructs."""
    import torch

    _cpu_patch()
    t0 = time.time()
    _, report = _build_detector(None, device="cpu")
    out = {"torch": str(torch.__version__), "cuda_build": str(torch.version.cuda), "build_s": round(time.time() - t0, 1), **report}
    print("CHECK", out)
    return out


@app.function(cpu=4, memory=16384, timeout=1800, volumes={WEIGHTS_DIR: weights}, secrets=[hf_secret])
def prefetch():
    """CPU only: download the gated checkpoint into the Volume once and check every detector weight loads."""
    _cpu_patch()
    path, download_s = _download()
    t0 = time.time()
    _, report = _build_detector(path, device="cpu")
    out = {"path": path, "bytes": os.path.getsize(path), "download_s": download_s, "build_s": round(time.time() - t0, 1), **report}
    print("PREFETCH", out)
    return out


# (CPU inference is not offered: parts of sam3 cast to bf16 internally and fail on a CPU without autocast.)


@app.local_entrypoint()
def main(image: str, prompts: str = "button,search bar,icon", threshold: float = 0.45):
    import json

    with open(image, "rb") as f:
        png = f.read()
    t0 = time.time()
    ps = [p.strip() for p in prompts.split(",") if p.strip()]
    res = Sam31().segment.remote([png], ps, threshold)
    res["client_s"] = round(time.time() - t0, 2)
    print(json.dumps({k: v for k, v in res.items() if k != "tiles"}, indent=2))
    for p, dets in res["tiles"][0]["detections"].items():
        print(f"{p}: {len(dets)}", dets[:3])
