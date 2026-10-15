"""Reject broad ground replacement while a stationary pan/zoom destination loads.

Compare unmasked game images at exactly the same camera pose. UI is excluded by
one fixed crop, but houses, fields, trees, streets and residents remain included.
This supplements canonical/settled zoom checks, which missed the root mesh drawing
over local ground. It is not a physical-device performance measurement.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def compare(before, after):
    a, b = [np.asarray(Image.open(p).convert("RGB"), dtype=float) for p in (before, after)]
    if a.shape != b.shape:
        raise ValueError("Pan frames must have the same viewport")
    h, w = a.shape[:2]
    crop = (slice(int(h * .25), int(h * .75)), slice(int(w * .2), int(w * .85)))
    delta = np.abs(a[crop] - b[crop]).mean(axis=2)
    return {"meanRgbDifference": float(delta.mean()),
            "broadChangedFraction": float((delta > 12).mean()),
            "passed": bool(delta.mean() <= 2 and (delta > 12).mean() <= .05)}


if __name__ == "__main__":
    root = Path(sys.argv[1])
    records = json.loads((root / "capture.json").read_text(encoding="utf-8"))
    results = []
    for suffix, settled in [("pan-transient", "pan-settled"),
                            ("zoom-transient", "street"),
                            ("return-transient", "return-settled")]:
        before = next(r for r in records if r["file"].endswith(f"-{suffix}.png"))
        after = next(r for r in records if r["file"].endswith(f"-{settled}.png"))
        if before["view"] != after["view"]:
            raise ValueError(f"Camera changed between {suffix} and {settled}")
        results.append({"fixture": suffix, **compare(root / before["file"], root / after["file"])})
    (root / "pan-metrics.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))
    sys.exit(0 if all(r["passed"] for r in results) else 1)
