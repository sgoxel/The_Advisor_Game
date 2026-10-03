#!/usr/bin/env python3
from pathlib import Path
import re

PATH=Path("scripts/world/planet-stage.js")
text=PATH.read_text(encoding="utf-8")
updated=text

def replace_once(source,old,new,label):
    count=source.count(old)
    if count!=1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return source.replace(old,new,1)

# WP-S003-010-003 / AGENT #6 / Attempt 2.
# Attempt 1 proved that converting only the macro residual to a ridge-like signal
# still leaves the dominant land-cover and close albedo paths as bilinearly smooth
# value-noise. Keep the identical Campaign-SEED registered sample locations and
# call count, but make those already-paid material frequencies read as bounded
# vegetation/soil regions and edges as physical texel size shrinks.
anchor='''function surfaceStructuredNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const value=surfaceValueNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt);
  // E[value] and E[.25-|value|] are both approximately zero for the seeded
  // interpolation field. Blending them keeps photometry centered while turning
  // broad blobs into readable ridge/valley structure without another noise query.
  const ridge=.25-Math.abs(value);
  return clamp(value*.62+ridge*.76,-.5,.5);
}
'''
material_helper=anchor+'''function surfaceMaterialNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const value=surfaceValueNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt);
  // Presentation-only material structure from the same registered scalar.
  // A bounded terraced component makes vegetation/soil regions and their edges
  // readable as physical texel size shrinks instead of leaving a bilinear blur.
  const ridge=.25-Math.abs(value);
  const terraced=Math.round(value*10)/10;
  return clamp(value*.34+ridge*.62+terraced*.46,-.5,.5);
}
'''
updated=replace_once(updated,anchor,material_helper,"material helper")

# Registered map relief keeps its exact wavelength/call budget while using the
# already-introduced structured transform for clearer ridge/valley derivatives.
pattern=re.compile(r"function registeredMapReliefValue\(worldEastMeters,worldNorthMeters,metersPerTexel,salt\)\{.*?\n\}",re.S)
match=pattern.search(updated)
if not match:
    raise SystemExit("registeredMapReliefValue not found")
body=match.group(0)
if body.count("surfaceValueNoise(")!=1:
    raise SystemExit("registered relief call structure changed")
body=body.replace("surfaceValueNoise(","surfaceStructuredNoise(")
updated=updated[:match.start()]+body+updated[match.end():]

# Preserve smooth low-frequency domain warp. Transform only the actual cover
# octaves, so all existing 48 km -> 9 m physical admission thresholds and the
# total number of deterministic samples remain unchanged.
pattern=re.compile(r"function landCoverTint\(east,north,metersPerTexel,salt,elevation\)\{.*?\n\}",re.S)
match=pattern.search(updated)
if not match:
    raise SystemExit("landCoverTint not found")
body=match.group(0)
body=body.replace("surfaceValueNoise(east,north,6200,salt+101)","__WARP_E__")
body=body.replace("surfaceValueNoise(east,north,5400,salt+107)","__WARP_N__")
cover_calls=body.count("surfaceValueNoise(")
if cover_calls<10:
    raise SystemExit(f"land-cover octave structure changed: {cover_calls}")
body=body.replace("surfaceValueNoise(","surfaceMaterialNoise(")
body=body.replace("__WARP_E__","surfaceValueNoise(east,north,6200,salt+101)")
body=body.replace("__WARP_N__","surfaceValueNoise(east,north,5400,salt+107)")
updated=updated[:match.start()]+body+updated[match.end():]

# The near-ground residual and final close-albedo roughness were still the old
# smooth scalar family in Attempt 1. Reuse the same three/two samples with the
# material transform and a bounded contrast increase; no new calls or authority.
updated=replace_once(updated,
'''        const registeredMicro=
          surfaceValueNoise(worldEast,worldNorth,34,microSurfaceSalt+11)*.024*w34+
          surfaceValueNoise(worldEast,worldNorth,12,microSurfaceSalt+29)*.017*w12+
          surfaceValueNoise(worldEast,worldNorth,4.2,microSurfaceSalt+47)*.011*w42;
        const closeGain=lerp(.86,1.18,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));''',
'''        const registeredMicro=
          surfaceMaterialNoise(worldEast,worldNorth,34,microSurfaceSalt+11)*.042*w34+
          surfaceMaterialNoise(worldEast,worldNorth,12,microSurfaceSalt+29)*.030*w12+
          surfaceMaterialNoise(worldEast,worldNorth,4.2,microSurfaceSalt+47)*.019*w42;
        const closeGain=lerp(.92,1.28,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));''',
"near-ground material residual")
updated=replace_once(updated,
'''        const rough=surfaceValueNoise(worldEast,worldNorth,coarseScale,detailSalt+211)*.040+
          surfaceValueNoise(worldEast,worldNorth,fineScale,detailSalt+233)*.018;''',
'''        const rough=surfaceMaterialNoise(worldEast,worldNorth,coarseScale,detailSalt+211)*.052+
          surfaceMaterialNoise(worldEast,worldNorth,fineScale,detailSalt+233)*.026;''',
"close material roughness")

updated=replace_once(updated,
'topographicSignalRevision:"canonical-continuous-cross-lod-source-v40"',
'topographicSignalRevision:"canonical-continuous-cross-lod-source-v41"',
"topographic revision")
updated=replace_once(updated,
'structuredFrequencyTransform:true,',
'structuredFrequencyTransform:true,materialFrequencyTransform:true,',
"material telemetry")

if updated==text:
    raise SystemExit("no Attempt 2 changes applied")
if updated.count("function surfaceMaterialNoise(")!=1:
    raise SystemExit("material helper count mismatch")
if 'canonical-continuous-cross-lod-source-v41' not in updated:
    raise SystemExit("v41 telemetry missing")

PATH.write_text(updated,encoding="utf-8")
print("Applied WP-S003-010-003 Attempt 2 registered material refinement")
