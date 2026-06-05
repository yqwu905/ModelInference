#!/usr/bin/env python3
"""Mock inference engine for demos and tests.

Stands in for a real image-generating inference pipeline so the whole tool
works end to end without a GPU. Generates deterministic placeholder PNGs whose
colours derive from the prompt + seed, with the parameters drawn on top.

Usage (matches DEFAULT_INFERENCE_COMMAND in app/config.py):

    python mock_inference.py --ckpt CKPT --out OUTDIR \
        --prompt "..." --count 4 --seed 42
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - Pillow is a declared dependency
    print("Pillow is required for the mock inference engine", file=sys.stderr)
    sys.exit(1)

W, H = 512, 512


def _color(text: str) -> tuple[int, int, int]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    # Keep it reasonably bright/saturated.
    return (60 + digest[0] % 180, 60 + digest[1] % 180, 60 + digest[2] % 180)


def _gradient(base: tuple[int, int, int], shift: int) -> Image.Image:
    # Compute a small gradient then upscale — far cheaper than per-pixel on 512x512.
    sw, sh = 32, 32
    small = Image.new("RGB", (sw, sh))
    pixels = []
    r, g, b = base
    for y in range(sh):
        t = y / sh
        for x in range(sw):
            s = (x / sw + shift / 360.0) % 1.0
            pixels.append(
                (
                    int(r * (0.5 + 0.5 * s)),
                    int(g * (0.4 + 0.6 * t)),
                    int(b * (0.5 + 0.5 * (1 - s))),
                )
            )
    small.putdata(pixels)
    return small.resize((W, H), Image.Resampling.BILINEAR)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prompt", default="")
    ap.add_argument("--count", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    ckpt_name = os.path.basename(args.ckpt.rstrip("/")) or args.ckpt
    print(f"[mock_inference] checkpoint={ckpt_name} prompt={args.prompt!r} "
          f"count={args.count} seed={args.seed}")

    try:
        font = ImageFont.load_default()
    except Exception:  # pragma: no cover
        font = None

    count = max(1, min(args.count, 64))
    for i in range(count):
        base = _color(f"{args.prompt}|{args.seed}|{i}")
        img = _gradient(base, (args.seed + i * 37) % 360)
        draw = ImageDraw.Draw(img)
        lines = [
            f"#{i}",
            f"ckpt: {ckpt_name[:28]}",
            f"seed: {args.seed}",
            f"prompt:",
            *(args.prompt[j:j + 30] for j in range(0, min(len(args.prompt), 90), 30)),
        ]
        y = 16
        for line in lines:
            draw.text((16, y), line, fill=(255, 255, 255), font=font)
            y += 16
        path = out / f"image_{i:03d}.png"
        img.save(path)
        print(f"[mock_inference] wrote {path}")

    print(f"[mock_inference] done: {count} image(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
