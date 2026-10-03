#!/usr/bin/env python3
from pathlib import Path

# AGENT #6 attempt-2: apply only product/runtime evidence changes from CI.
def replace_once(text, old, new, label):
    count=text.count(old)
    if count==0 and new in text:
        return text
    if count!=1:
        raise SystemExit(f"{label}: expected 1 anchor, found {count}")
    return text.replace(old,new,1)

planet=Path("scripts/world/planet-stage.js")
text=planet.read_text(encoding="utf-8")
text=replace_once(text,"const LOCAL_PATCH_MARGIN=1.50;","const LOCAL_PATCH_MARGIN=3.00; // WP006_VIEWPORT_SAFE_FINE_COVERAGE_V3","fine physical coverage margin")
text=replace_once(text,"WP006_ATOMIC_VIEWPORT_OWNER_V2","WP006_ATOMIC_VIEWPORT_OWNER_V3","atomic owner marker")
text=replace_once(text,"displayResource&&displayResource.levelIndex<=WP006_SINGLE_PARENT_MAX_LEVEL&&!finePatchCoversViewport&&mediumRingCoversViewport","displayResource&&!finePatchCoversViewport&&mediumRingCoversViewport","medium fallback owner scope")
text=replace_once(text,"displayResource&&displayResource.levelIndex<=WP006_SINGLE_PARENT_MAX_LEVEL&&!finePatchCoversViewport&&!mediumRingCoversViewport&&surroundCoversViewport","displayResource&&!finePatchCoversViewport&&!mediumRingCoversViewport&&surroundCoversViewport","outer fallback owner scope")
planet.write_text(text,encoding="utf-8")

shot=Path("tools/screenshot_tool.py")
st=shot.read_text(encoding="utf-8")
st=replace_once(st,'PROFILES={"landscape":(1920,1080),"portrait":(1080,1920),"tablet":(1920,1080),"phone":(1080,1920)}','PROFILES={"landscape":(1365,768),"portrait":(390,844),"tablet":(1024,768),"phone":(390,844),"phone-landscape":(844,390)}',"evidence viewport profiles")
st=replace_once(st,'if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_SCALE_HANDOFF_SCENARIO,WP_TEMPORAL_RESIDENCY_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:','if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_TEMPORAL_RESIDENCY_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:',"WP006 fixed viewport override")
shot.write_text(st,encoding="utf-8")
print("patched WP-S003-010-003-006 viewport-safe fine coverage and cross-device screenshot profiles")
