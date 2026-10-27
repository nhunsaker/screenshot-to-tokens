"""Client for the deployed SAM 3.1 Modal app, spawned by src/providers/segment/modal-sam.js.

stdin:  {"tiles": ["<base64 PNG>", ...], "prompts": ["button", ...], "threshold": 0.45}
stdout: the app's response ({"model", "gpu", "gpu_s", "cold", "tiles": [{"width","height","detections":{prompt:[{box,score}]}}]})
        plus "client_s" (wall time of the remote call as seen from here).

Auth is the caller's Modal token (MODAL_TOKEN_ID / MODAL_TOKEN_SECRET in the environment, or a Modal profile).
Run with: uvx --from modal==1.6.3 python modal/sam31_client.py < request.json
"""
import base64
import json
import os
import sys
import time

import modal


def main():
    req = json.load(sys.stdin)
    app_name = os.environ.get("S2T_MODAL_APP", "s2t-sam31")
    tiles = [base64.b64decode(t) for t in req["tiles"]]
    cls = modal.Cls.from_name(app_name, "Sam31")
    t0 = time.time()
    res = cls().segment.remote(tiles, req["prompts"], float(req.get("threshold", 0.45)))
    res["client_s"] = round(time.time() - t0, 3)
    json.dump(res, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write(f"sam31_client: {type(e).__name__}: {e}\n")
        sys.exit(1)
