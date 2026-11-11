"""Objective checks on a real captured PNG: sharpness, contrast, detail presence.

Used for WP-S003-004-001 evidence so a visual verdict cites numbers, not vibes.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image


def analyse(path: Path) -> dict:
    img = Image.open(path).convert("RGB")
    a = np.asarray(img, dtype=np.float32)
    h, w, _ = a.shape

    # Exclude UI chrome: sample the central canvas region only.
    cx0, cx1 = int(w * 0.10), int(w * 0.72)
    cy0, cy1 = int(h * 0.10), int(h * 0.88)
    canvas = a[cy0:cy1, cx0:cx1]
    grey = canvas.mean(axis=2)

    # 1. Global contrast (std of luminance). Flat scenes score low.
    contrast = float(grey.std())

    # 2. Sharpness: variance of the Laplacian. Blurred scenes score low.
    lap = (
        -4 * grey[1:-1, 1:-1]
        + grey[:-2, 1:-1] + grey[2:, 1:-1]
        + grey[1:-1, :-2] + grey[1:-1, 2:]
    )
    sharpness = float(lap.var())

    # 3. Local detail: fraction of pixels with a meaningful gradient.
    gy, gx = np.gradient(grey)
    grad = np.hypot(gx, gy)
    detail_fraction = float((grad > 1.5).mean())

    # 4. Colour diversity: how many distinct hue buckets carry weight.
    rgb = canvas.reshape(-1, 3) / 255.0
    mx, mn = rgb.max(axis=1), rgb.min(axis=1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    hue_buckets = len(np.unique((sat * 24).astype(np.int32)))
    colours = len(np.unique((rgb * 24).astype(np.int32), axis=0))

    return {
        "file": path.name,
        "size": f"{w}x{h}",
        "contrast_std": round(contrast, 2),
        "sharpness_lapvar": round(sharpness, 2),
        "detail_fraction": round(detail_fraction, 4),
        "hue_buckets": hue_buckets,
        "distinct_colours": colours,
        "mean_luma": round(float(grey.mean()), 1),
    }


def score(m: dict) -> int:
    """Rough 1-10 readability score from objective signals (documented, not magic)."""
    s = 0
    if m["contrast_std"] > 18: s += 3
    elif m["contrast_std"] > 10: s += 2
    elif m["contrast_std"] > 5: s += 1
    if m["sharpness_lapvar"] > 250: s += 4
    elif m["sharpness_lapvar"] > 80: s += 3
    elif m["sharpness_lapvar"] > 25: s += 2
    elif m["sharpness_lapvar"] > 8: s += 1
    if m["detail_fraction"] > 0.20: s += 2
    elif m["detail_fraction"] > 0.08: s += 1
    if m["mean_luma"] > 40: s += 1
    return max(1, min(10, s))


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        for path in sorted(Path(arg).glob("*.png")):
            m = analyse(path)
            m["objective_score"] = score(m)
            print(
                f"{m['file'][:56]:58} {m['size']:>10} "
                f"contrast={m['contrast_std']:>6} sharp={m['sharpness_lapvar']:>9} "
                f"detail={m['detail_fraction']:>7} luma={m['mean_luma']:>6} score={m['objective_score']}/10"
            )
