#!/usr/bin/env python3
from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
old = '''// Medium continuation textures are presentation coverage, not canonical tile
// boundaries. Fade them radially across most of their span so the prepared
// parent remains continuous without exposing a rectangular streaming footprint.
const LOCAL_CONTEXT_RING_RADIAL_FEATHER=.62;'''
new = '''// Medium continuation textures are presentation coverage, not canonical tile
// boundaries. Keep their higher-density ready parent opaque across the viewport
// and feather only near the physical 3x ring edge, where the 6x outer fallback
// takes over. This prevents a centered LOD ownership footprint while retaining
// bounded world-matched fallback coverage during larger focus offsets.
const LOCAL_CONTEXT_RING_RADIAL_FEATHER=.16;'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"WP006 continuation feather anchor: expected 1, found {count}")
updated = text.replace(old, new, 1)
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-006 continuation feather")
