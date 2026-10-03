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
# of the viewport. The parent/context halo is therefore guaranteed even though
# the foreground geometry covers the viewport. Keep a real transition band, but
# make the settled opaque core wider than the viewport.
updated = replace_once(
    updated,
    "const LOCAL_TEXTURE_HANDOFF_FEATHER=.22;",
    "const LOCAL_TEXTURE_HANDOFF_FEATHER=.12;",
    "viewport-safe focus feather",
)

# Context is fallback coverage outside the focused viewport. It must remain
# world-matched, but it does not need near-focus raster density. Reducing only
# the medium/outer presentation rasters cuts bounded cooperative work and cache
# pressure without changing canonical coordinates, geometry, or world authority.
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

# The 640 px intermediate focus tiers dominate preparation cost while the
# physical patch footprint shrinks strongly between tiers. 512 px still gives a
# strictly improving meters/texel ladder, removes the resolution reversal into
# near-ground-wide (already 512), and cuts those focus raster pixels by 36%.
level_ids=("local-area-wide","local-area","settlement-wide","settlement","settlement-core")
for level_id in level_ids:
    old=f'id:"{level_id}",'
    pos=updated.find(old)
    if pos<0:
        raise SystemExit(f"texture ladder: missing level {level_id}")
    end=updated.find("}),",pos)
    if end<0:
        raise SystemExit(f"texture ladder: malformed level {level_id}")
    chunk=updated[pos:end]
    if "textureSize:640" not in chunk:
        raise SystemExit(f"texture ladder: expected 640 px at {level_id}")
    updated=updated[:pos]+chunk.replace("textureSize:640","textureSize:512",1)+updated[end:]

# README now establishes simple 3D meshes with cel/toon shading as the primary
# presentation direction. Reuse the already-computed deterministic albedo and
# lighting signal and quantize only luminance at physically local scales. This
# adds zero geography/noise samples, preserves hue/authority, and turns smooth
# value-noise gradients into readable stylized terrain planes instead of blur.
toon_anchor = """      pushRange(\"finalLuma\",luma3(displayColor));"""
toon_block = """      if(parentSample?.land){
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
      pushRange(\"finalLuma\",luma3(displayColor));"""
updated = replace_once(updated, toon_anchor, toon_block, "toon terrain luminance")

if updated == text:
    raise SystemExit("no WP005002 current-run attempt-2 changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 viewport-core toon refinement")
