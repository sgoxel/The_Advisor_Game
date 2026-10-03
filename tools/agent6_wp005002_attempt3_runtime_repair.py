#!/usr/bin/env python3
"""Repair the current ready-scale telemetry expression so WP005002 final visual evidence can execute.

This changes no world authority, LOD selection, terrain generation, camera state, or Simulation state.
It replaces one undefined presentation helper call with the existing canonical footprint->scalar mapping.
"""
from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
old = "scaleStateForScalar(levelNativeScalar(displayResource.levelIndex))"
new = "scaleStateForScalar(scalarForFootprintHeight(LOCAL_DETAIL_LEVELS[Math.max(0,Math.min(LOCAL_DETAIL_LEVELS.length-1,Number(displayResource.levelIndex)||0))].visibleHeightMeters))"
count = text.count(old)
if count == 0 and new in text:
    print("WP005002 Attempt 3 runtime repair already present")
    raise SystemExit(0)
if count != 1:
    raise SystemExit(f"Expected one ready-scale runtime anchor, found {count}")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print("Applied WP005002 Attempt 3 ready-scale runtime repair")
