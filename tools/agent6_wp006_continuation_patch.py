#!/usr/bin/env python3
from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
updated = text

anchors = [
    (
        "const LOCAL_MEDIUM_RING_SPAN_FACTOR=3;",
        "const LOCAL_MEDIUM_RING_SPAN_FACTOR=6;",
        "medium continuation span",
    ),
    (
        "const LOCAL_SURROUND_SPAN_FACTOR=6;",
        "const LOCAL_SURROUND_SPAN_FACTOR=12;",
        "outer continuation span",
    ),
    (
        "and feather only near the physical 3x ring edge, where the 6x outer fallback\n// takes over.",
        "and feather only near the physical 6x ring edge, where the 12x outer fallback\n// takes over.",
        "continuation comment",
    ),
]
for old, new, label in anchors:
    count = updated.count(old)
    if count != 1:
        raise SystemExit(f"WP006 {label}: expected 1 anchor, found {count}")
    updated = updated.replace(old, new, 1)

if updated == text:
    raise SystemExit("WP006 attempt 3 produced no change")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-006 continuation spans to 6x/12x")
