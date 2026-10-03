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

# WP-S003-010-003-005-002 current-run Attempt 2.
# Exact 4db8c0 evidence proved the 22% focus feather is geometrically too wide
# for LOCAL_PATCH_MARGIN=1.50: only 56% of the patch is fully opaque, or ~84%
# of the viewport. Keep a real transition band, but make the settled opaque core
# wider than the viewport so the fallback never reads as a centered halo.
updated = replace_once(
    updated,
    "const LOCAL_TEXTURE_HANDOFF_FEATHER=.22;",
    "const LOCAL_TEXTURE_HANDOFF_FEATHER=.12;",
    "viewport-safe focus feather",
)

# Context remains world-matched fallback coverage outside the focused viewport,
# but does not need near-focus raster density. Lower only disposable presentation
# density; canonical coordinates, geometry, and Simulation remain unchanged.
updated = replace_once(
    updated,
    "const LOCAL_MEDIUM_RING_TEXTURE_SCALE=.90;",
    "const LOCAL_MEDIUM_RING_TEXTURE_SCALE=.72;",
    "medium fallback raster scale",
)
updated = replace_once(
    updated,
    "const WP006_SINGLE_PARENT_OUTER_TEXTURE_SCALE=.86;",
    "const WP006_SINGLE_PARENT_OUTER_TEXTURE_SCALE=.50;",
    "outer fallback raster scale",
)

# Exact per-tier anchors avoid accidental cross-line matching. 512 px still
# yields a strictly improving physical meters/texel ladder while cutting the
# costly 640 px intermediate focus rasters by 36% and removing the 640->512
# source-size reversal at the near-ground-wide handoff.
for level_id in ("local-area-wide","local-area","settlement-wide","settlement","settlement-core"):
    old_prefix=f'Object.freeze({{id:"{level_id}",'
    start=updated.find(old_prefix)
    if start<0:
        raise SystemExit(f"texture ladder: missing exact level {level_id}")
    line_end=updated.find("\n",start)
    if line_end<0: line_end=len(updated)
    line=updated[start:line_end]
    if line.count("textureSize:640")!=1:
        raise SystemExit(f"texture ladder: expected one 640 px token at {level_id}, line={line!r}")
    updated=updated[:start]+line.replace("textureSize:640","textureSize:512",1)+updated[line_end:]

# README now establishes simple 3D meshes with cel/toon shading as the primary
# presentation direction. Reuse already-computed deterministic albedo/lighting
# and quantize only luminance at physically local scales. This adds no world or
# noise samples and converts smooth value-noise gradients into readable stylized
# terrain planes instead of amplifying fuzzy texture.
toon_anchor = '      pushRange("finalLuma",luma3(displayColor));'
toon_block = '''      if(parentSample?.land){
        const toonBand=smoothstep01(clamp((220-metersPerTexel)/190,0,1));
        if(toonBand>.001){
          const luma=luma3(displayColor);
          const closeToon=smoothstep01(clamp((18-metersPerTexel)/17.5,0,1));
          const stepSize=lerp(.050,.028,closeToon);
          const quantized=clamp(Math.round(luma/stepSize)*stepSize,0,1);
          const shift=(quantized-luma)*toonBand*.68;
          displayColor=displayColor.map(v=>clamp(v+shift,0,.88));
        }
      }
      pushRange("finalLuma",luma3(displayColor));'''
updated = replace_once(updated, toon_anchor, toon_block, "toon terrain luminance")

if updated == text:
    raise SystemExit("no WP005002 current-run attempt-2 changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 viewport-core toon refinement")
