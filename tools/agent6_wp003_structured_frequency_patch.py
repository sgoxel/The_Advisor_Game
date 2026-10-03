#!/usr/bin/env python3
from pathlib import Path
import re

PATH = Path("scripts/world/planet-stage.js")
text = PATH.read_text(encoding="utf-8")
updated = text


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return source.replace(old, new, 1)

# WP-S003-010-003 / AGENT #6.
# The current density/coverage gate is functionally correct, but accepted closer
# frames still magnify smooth value-noise blobs. Keep the exact same deterministic
# world-coordinate samples and physical wavelength ladder, but remap each scalar
# sample into a zero-mean structured signal. This adds no geography/world queries,
# no camera-relative state, and no new authority; it only makes the already-paid
# frequencies read as ridges/valleys instead of broad soft mottling.
old_noise = '''function surfaceValueNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const x=worldEastMeters/scaleMeters,y=worldNorthMeters/scaleMeters,x0=Math.floor(x),y0=Math.floor(y),tx=smoothstep01(x-x0),ty=smoothstep01(y-y0);
  const a=surfaceHash2(x0,y0,salt),b=surfaceHash2(x0+1,y0,salt),c=surfaceHash2(x0,y0+1,salt),d=surfaceHash2(x0+1,y0+1,salt);
  return lerp(lerp(a,b,tx),lerp(c,d,tx),ty)-.5;
}
function worldSurfaceDetailValue(worldEastMeters,worldNorthMeters,metersPerTexel,phase){'''
new_noise = '''function surfaceValueNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const x=worldEastMeters/scaleMeters,y=worldNorthMeters/scaleMeters,x0=Math.floor(x),y0=Math.floor(y),tx=smoothstep01(x-x0),ty=smoothstep01(y-y0);
  const a=surfaceHash2(x0,y0,salt),b=surfaceHash2(x0+1,y0,salt),c=surfaceHash2(x0,y0+1,salt),d=surfaceHash2(x0+1,y0+1,salt);
  return lerp(lerp(a,b,tx),lerp(c,d,tx),ty)-.5;
}
function surfaceStructuredNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const value=surfaceValueNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt);
  // E[value] and E[.25-|value|] are both approximately zero for the seeded
  // interpolation field. Blending them keeps photometry centered while turning
  // broad blobs into readable ridge/valley structure without another noise query.
  const ridge=.25-Math.abs(value);
  return clamp(value*.62+ridge*.76,-.5,.5);
}
function worldSurfaceDetailValue(worldEastMeters,worldNorthMeters,metersPerTexel,phase){'''
updated = replace_once(updated, old_noise, new_noise, "structured-noise helper")

# Transform only the existing registered detail ladder; do not change thresholds,
# wavelengths, or call count. Slightly restore the two broadest gains because the
# new zero-mean ridge component carries shape instead of a low-frequency wash.
world_pattern = re.compile(r"function worldSurfaceDetailValue\(worldEastMeters,worldNorthMeters,metersPerTexel,phase\)\{.*?\n\}", re.S)
world_match = world_pattern.search(updated)
if not world_match:
    raise SystemExit("worldSurfaceDetailValue not found")
world_body = world_match.group(0)
call_count = world_body.count("surfaceValueNoise(")
if call_count < 8:
    raise SystemExit(f"worldSurfaceDetailValue expected registered ladder calls, found {call_count}")
world_new = world_body.replace("surfaceValueNoise(", "surfaceStructuredNoise(")
world_new = world_new.replace(",32000,salt+11)*.012", ",32000,salt+11)*.018")
world_new = world_new.replace(",9500,salt+29)*.026", ",9500,salt+29)*.034")
updated = updated[:world_match.start()] + world_new + updated[world_match.end():]

# Ground/near-ground color currently uses the same smooth scalar family at
# 34/12/4.2 m. Remap those three existing samples too so the final ground view
# continues the same structured family instead of becoming flatter than frame 09.
local_pattern = re.compile(r"function localSurfaceSample\(registeredEastMeters,registeredNorthMeters,base\)\{.*?\n\}", re.S)
local_match = local_pattern.search(updated)
if not local_match:
    raise SystemExit("localSurfaceSample not found")
local_body = local_match.group(0)
local_calls = local_body.count("surfaceValueNoise(")
if local_calls != 3:
    raise SystemExit(f"localSurfaceSample expected exactly 3 surface noise calls, found {local_calls}")
local_new = local_body.replace("surfaceValueNoise(", "surfaceStructuredNoise(")
updated = updated[:local_match.start()] + local_new + updated[local_match.end():]

# Make evidence unambiguous about which signal family is rendered.
updated = replace_once(
    updated,
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v39"',
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v40"',
    "topographic revision",
)
updated = replace_once(
    updated,
    'focusAuthorityEdgeMatched:true,focusAuthorityApplied:true,',
    'focusAuthorityEdgeMatched:true,focusAuthorityApplied:true,structuredFrequencyTransform:true,',
    "structured-frequency telemetry",
)

if updated == text:
    raise SystemExit("no WP-S003-010-003 structured-frequency changes applied")
if updated.count("function surfaceStructuredNoise(") != 1:
    raise SystemExit("structured helper count mismatch")
if 'canonical-continuous-cross-lod-source-v40' not in updated:
    raise SystemExit("v40 telemetry missing")

PATH.write_text(updated, encoding="utf-8")
print("Applied WP-S003-010-003 structured registered frequency refinement")
