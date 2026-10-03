#!/usr/bin/env python3
from pathlib import Path

PATH=Path("scripts/world/planet-stage.js")
text=PATH.read_text(encoding="utf-8")
updated=text


def replace_once(source,old,new,label):
    count=source.count(old)
    if count!=1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return source.replace(old,new,1)

old_helper='''function surfaceStructuredNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const value=surfaceValueNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt);
  // E[value] and E[.25-|value|] are both approximately zero for the seeded
  // interpolation field. Blending them keeps photometry centered while turning
  // broad blobs into readable ridge/valley structure without another noise query.
  const ridge=.25-Math.abs(value);
  return clamp(value*.62+ridge*.76,-.5,.5);
}'''
new_helper='''function surfaceStructuredNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const x=worldEastMeters/scaleMeters,y=worldNorthMeters/scaleMeters;
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  const tx=smoothstep01(fx),ty=smoothstep01(fy);
  const a=surfaceHash2(x0,y0,salt),b=surfaceHash2(x0+1,y0,salt),c=surfaceHash2(x0,y0+1,salt),d=surfaceHash2(x0+1,y0+1,salt);
  const value=lerp(lerp(a,b,tx),lerp(c,d,tx),ty)-.5;
  // Reuse the exact four deterministic interpolation corners to expose slope
  // structure instead of folding value noise with abs(), which produced a mossy
  // high-frequency texture. The salt selects one of two diagonal directions per
  // physical band; no extra hash/world query or camera-dependent state is added.
  const dtx=6*fx*(1-fx),dty=6*fy*(1-fy);
  const dx=(lerp(b,d,ty)-lerp(a,c,ty))*dtx;
  const dy=(lerp(c,d,tx)-lerp(a,b,tx))*dty;
  const slope=((salt>>>3)&1)?(dx+dy)*.70710678:(dx-dy)*.70710678;
  return clamp(value*.24+slope*.42,-.5,.5);
}'''
updated=replace_once(updated,old_helper,new_helper,"structured helper")

# Inspection isolated the coarse mottling to the first six admitted bands.
# Lower only those confirmed anchors; later frequencies keep their current-main
# values and still receive the slope transform, avoiding guesses across other
# agents' concurrently revised close-scale tuning.
replacements={
    '32000,salt+11)*.018':'32000,salt+11)*.016',
    '9500,salt+29)*.034':'9500,salt+29)*.028',
    '2600,salt+47)*.036':'2600,salt+47)*.026',
    '1200,salt+59)*.026':'1200,salt+59)*.018',
    '420,salt+71)*.014':'420,salt+71)*.010',
    '160,salt+83)*.032':'160,salt+83)*.014',
}
for old,new in replacements.items():
    updated=replace_once(updated,old,new,f"gain {old}")

updated=replace_once(
    updated,
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v40"',
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v41"',
    "revision",
)
updated=replace_once(
    updated,
    'structuredFrequencyTransform:true,',
    'structuredFrequencyTransform:true,structuredSlopeTransform:true,',
    "telemetry",
)

if updated==text:
    raise SystemExit("no attempt 2 changes")
if updated.count('function surfaceStructuredNoise(')!=1:
    raise SystemExit("helper count mismatch")
if 'canonical-continuous-cross-lod-source-v41' not in updated:
    raise SystemExit("v41 revision missing")

PATH.write_text(updated,encoding="utf-8")
print("Applied WP-S003-010-003 Attempt 2 directional slope refinement")
