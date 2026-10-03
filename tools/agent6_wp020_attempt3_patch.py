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

# WP-S003-010-003-005-002 continuation Attempt 3 (final attempt this run,
# 2026-10-03). Preserve Attempt 2's accepted density/coverage family and close
# registered detail, but remove redundant per-pixel authority/style work and
# broaden one deterministic focus handoff so the 1x child reads as refinement
# rather than a rectangular card.

# Shared photometry now makes a broader alpha/refinement transition safe. The
# previous 12% square ramp reached full-detail opacity too quickly, leaving a
# conspicuous inner rectangle at 0.63x-0.81x. One 22% curve is reused by focus
# authority mixing, native high-pass admission, alpha, and center stitching.
updated = replace_once(
    updated,
    '''// Narrow cross-LOD visual handoff. The old 18% edge feather made the canonical
// focus patch read as a giant blurred square at 1/500-1/2500. Colors are
// already world-coordinate stitched, so only a small bounded blend is needed.
const LOCAL_TEXTURE_HANDOFF_FEATHER=.12;''',
    '''// Shared photometry lets the child refinement fade over a broader bounded
// handoff without creating the old tinted/blurred card. Reuse this single curve
// for focus authority, registered high-pass, alpha and center stitching so no
// independent square boundary can become visible during zoom.
const LOCAL_TEXTURE_HANDOFF_FEATHER=.22;''',
    "broader unified focus handoff",
)

# Main texture pixels sampled the same coarse authoritative surface twice:
# mixSample() sampled it and the loop immediately sampled it again as
# parentSample. Pass the already-resolved parent into mixSample. Derivative
# probes still sample their own neighbor coordinates, so pixels/world truth are
# identical while one expensive authority lookup per generated pixel disappears.
old_mix = '''  const mixSample=(ux,vz)=>{
    const east=(ux-.5)*spanEast,north=(.5-vz)*spanNorth,coarse=surfaceAuthority.sample(east,north);
    if(!focusAuthority)return coarse;
    const edge=Math.min(ux,1-ux,vz,1-vz),refine=smoothstep01(clamp((edge-.025)/.145,0,1));
    return refine<=0?coarse:blendSurfaceAuthoritySamples(coarse,focusAuthority.sample(east,north),refine);
  };
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const ux=(x+.5)/size,vz=(y+.5)/size,pixelOffset=(y*size+x)*4;
      const east=(ux-.5)*spanEast,north=(.5-vz)*spanNorth;
      const sample=mixSample(ux,vz),parentSample=surfaceAuthority.sample(east,north);'''
new_mix = '''  const mixSample=(ux,vz,coarseSample=null)=>{
    const east=(ux-.5)*spanEast,north=(.5-vz)*spanNorth,coarse=coarseSample||surfaceAuthority.sample(east,north);
    if(!focusAuthority)return coarse;
    const refine=localTextureHandoffCoverage(ux,vz,false);
    return refine<=0?coarse:blendSurfaceAuthoritySamples(coarse,focusAuthority.sample(east,north),refine);
  };
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const ux=(x+.5)/size,vz=(y+.5)/size,pixelOffset=(y*size+x)*4;
      const east=(ux-.5)*spanEast,north=(.5-vz)*spanNorth;
      const parentSample=surfaceAuthority.sample(east,north),sample=mixSample(ux,vz,parentSample);'''
updated = replace_once(updated, old_mix, new_mix, "deduplicate primary surface authority sample")

updated = replace_once(
    updated,
    'const focusRefineWeight=contextRing?0:smoothstep01(clamp((focusEdgeDistance-.018)/.105,0,1));',
    'const focusRefineWeight=contextRing?0:localTextureHandoffCoverage(ux,vz,false);',
    "unify focus registered-refinement handoff",
)

# Attempt 2 generated close micro/style noise again over the full 6x medium
# raster even though localResourceSteps deterministically stitches the already
# generated 1x focus center into that medium parent. Keep absolute local style
# grade shared, but compute expensive micro/close variation only once on focus;
# the existing center stitch carries those exact registered pixels through the
# overlap while the medium's lower-frequency context remains continuous outside.
updated = replace_once(
    updated,
    'const useMicroDetail=metersPerTexel<=6;',
    'const useMicroDetail=!contextRing&&metersPerTexel<=6;',
    "focus-only close micro generation",
)
updated = replace_once(
    updated,
    'const microContinuity=contextRing?clamp(Math.max(.32,contextRefineWeight),0,1):focusRefineWeight;\n        const microWeight=lerp(.10,.30,closeWeight)*microContinuity;',
    'const microWeight=lerp(.10,.30,closeWeight)*focusRefineWeight;',
    "reuse unified focus micro feather",
)
updated = replace_once(
    updated,
    'const closeTextureContinuity=contextRing?contextRefineWeight:focusRefineWeight;',
    'const closeTextureContinuity=contextRing?0:focusRefineWeight;',
    "avoid redundant context close-style noise",
)

if updated == text:
    raise SystemExit("no WP-S003-010-003-005-002 Attempt 3 changes applied")

required = [
    'foregroundFamilyCoversViewport',
    'LOCAL_SURROUND_RING_TEXTURE_SCALE=.58',
    'LOCAL_TEXTURE_HANDOFF_FEATHER=.22',
    'coarseSample||surfaceAuthority.sample',
    'const useMicroDetail=!contextRing&&metersPerTexel<=6',
    'const closeTextureContinuity=contextRing?0:focusRefineWeight',
]
for token in required:
    if token not in updated:
        raise SystemExit(f"missing required post-patch contract token: {token}")

path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 final Attempt 3 unified handoff + deduplicated preparation")
