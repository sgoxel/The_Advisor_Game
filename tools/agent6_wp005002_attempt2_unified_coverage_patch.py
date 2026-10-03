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

# WP-S003-010-003-005-002 AGENT #6 current-run Attempt 2.
# Three accepted local checkpoints were choosing a native 1x footprint smaller
# than the visible viewport. Increase physical coverage only; texture pixel
# counts, coordinate authority, sample spacing, and deterministic content stay
# unchanged. The ratios keep each tier near/above the existing steady native
# compensation target so the fine owner can cover the accepted viewport.
updated = replace_once(
    updated,
    'Object.freeze({id:"settlement",band:"local-area",visibleHeightMeters:2000,sampleSpacingMeters:44,textureSize:640,reliefClampMeters:1600,reliefGain:4,maxHeightUnits:.42,staticWorld:false})',
    'Object.freeze({id:"settlement",band:"local-area",visibleHeightMeters:2300,sampleSpacingMeters:44,textureSize:640,reliefClampMeters:1600,reliefGain:4,maxHeightUnits:.42,staticWorld:false})',
    "settlement viewport coverage",
)
updated = replace_once(
    updated,
    'Object.freeze({id:"near-ground-wide",band:"settlement",visibleHeightMeters:500,sampleSpacingMeters:11,textureSize:512,reliefClampMeters:400,reliefGain:2.2,maxHeightUnits:.33,staticWorld:true})',
    'Object.freeze({id:"near-ground-wide",band:"settlement",visibleHeightMeters:750,sampleSpacingMeters:11,textureSize:512,reliefClampMeters:400,reliefGain:2.2,maxHeightUnits:.33,staticWorld:true})',
    "near-ground-wide viewport coverage",
)
updated = replace_once(
    updated,
    'Object.freeze({id:"near-ground-close",band:"near-ground",visibleHeightMeters:80,sampleSpacingMeters:3,textureSize:384,reliefClampMeters:60,reliefGain:.9,maxHeightUnits:.22,staticWorld:true})',
    'Object.freeze({id:"near-ground-close",band:"near-ground",visibleHeightMeters:160,sampleSpacingMeters:3,textureSize:384,reliefClampMeters:60,reliefGain:.9,maxHeightUnits:.22,staticWorld:true})',
    "near-ground-close viewport coverage",
)

# Texture albedo uses one shared canonical base authority across focus/medium/
# outer. Finer tiers may add only registered-meter high-pass refinement. This
# prevents the higher-resolution focus authority raster itself from painting a
# finite differently colored card inside an otherwise world-matched parent.
updated = replace_once(
    updated,
    'const surfaceAuthority=sharedSurfaceAuthority(job),focusAuthority=contextRing?null:focusSurfaceAuthority(job);',
    'const surfaceAuthority=sharedSurfaceAuthority(job),focusAuthority=null;',
    "single canonical texture base authority",
)

# Preserve a little more of the existing canonical macro hue at regional scale.
# This reuses parentSample already in memory; it adds no geography/noise query.
updated = replace_once(
    updated,
    'const strategicSourceCap=lerp(.110,.046,strategicSourceBand);',
    'const strategicSourceCap=lerp(.120,.078,strategicSourceBand);',
    "regional canonical source visibility",
)

# The outer parent was being rewritten with the medium/detail center before GPU
# upload. Therefore a hidden medium/fine mesh could still leave a visible richer
# rectangle baked into the supposedly single parent. Keep all parent rasters
# independent and world-matched; runtime alpha compositing of ready layers is the
# handoff mechanism, as already documented below this block.
updated = replace_once(
    updated,
    '''  if(job.levelIndex<=2){
    // Phase 19 final: strategic children are already edge-feathered registered
    // residuals over one shared parent basis. Keep BOTH coarser parents fully
    // continuous underneath them. Rewriting/carving either parent reintroduces
    // a magnified rectangular/ridge handoff during animated strategic zoom.
  }else{
    stitchSurroundCenterToDetail(detail,medium,LOCAL_MEDIUM_RING_SPAN_FACTOR);
    stitchSurroundCenterToDetail(medium,surround,LOCAL_SURROUND_SPAN_FACTOR/LOCAL_MEDIUM_RING_SPAN_FACTOR);
  }''',
    '''  // Cross-LOD continuity: each raster remains an independent sampling of
  // the same canonical world coordinates. Do not bake a finer child/medium
  // center into its coarser parent; that persists as a rectangular frequency
  // island even when the finer mesh is not rendered. Feathered child alpha over
  // an opaque world-matched parent performs the transition without rewriting
  // either owner's source texture.''',
    "remove baked nested texture centers",
)

if updated == text:
    raise SystemExit("no WP005002 attempt-2 unified coverage changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 unified canonical coverage")
