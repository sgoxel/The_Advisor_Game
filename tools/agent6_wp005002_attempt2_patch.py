#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
updated = text

# WP-S003-010-003-005-002 continuation Attempt 2.
# The medium ring can become physically eligible for the same registered
# 34/12/4.2 m micro field as the focus child. Excluding it creates a richer
# rectangular 1x identity at close zoom. Eligibility is therefore physical,
# not layer-role based; canonical coordinates and world authority are unchanged.
updated = replace_once(
    updated,
    "const useMicroDetail=!contextRing&&metersPerTexel<=6;",
    "const useMicroDetail=metersPerTexel<=6;",
    "physical micro-detail eligibility",
)

# Keep the existing registered micro sample, but treat its contribution as
# refinement owned by the layer that can resolve it. This carries the same field
# into the physically eligible medium ring and strengthens only the near-ground
# band that remained visually soft in fresh evidence.
updated = replace_once(
    updated,
    "const closeWeight=smoothstep01(clamp((6-metersPerTexel)/5.5,0,1));\n        const microWeight=lerp(.10,.30,closeWeight)*focusRefineWeight;\n        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));",
    "const closeWeight=smoothstep01(clamp((6-metersPerTexel)/5.5,0,1));\n        const microContinuity=contextRing?contextRefineWeight:focusRefineWeight;\n        const microWeight=lerp(.14,.34,closeWeight)*microContinuity;\n        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));",
    "registered micro refinement continuity",
)

if updated == text:
    raise SystemExit("no WP005002 attempt-2 changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 near-ground registered micro continuity")
