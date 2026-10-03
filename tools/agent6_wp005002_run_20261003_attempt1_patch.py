#!/usr/bin/env python3
from pathlib import Path

PATH = Path("scripts/world/planet-stage.js")
text = PATH.read_text(encoding="utf-8")
updated = text


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count == 0 and new in source:
        return source
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return source.replace(old, new, 1)

# WP-S003-010-003-005-002 / AGENT #6 / 2026-10-03 new-run Attempt 1.
# Previous evidence proves the 3.00x physical patch margin is far larger than the
# accepted viewport at local/near-ground tiers. Right-size deterministic overscan
# by physical LOD. This increases real texel/source density and reduces bounded
# preparation work without shrinking any accepted viewport below full coverage.
old_relief = '''function registeredMapReliefValue(worldEastMeters,worldNorthMeters,metersPerTexel,salt){
  // Presentation-only relief: use only wavelengths that remain physically
  // resolvable at this texel size. Inputs are Campaign-SEED registered metres,
  // so focus movement/LOD/cache order cannot change the field.
  const m=Math.max(1,Number(metersPerTexel)||1);
  let value=0,weight=0;
  for(const [wavelength,gain] of [[5200,.32],[2600,.62],[1200,.54],[560,.30]]){
    if(wavelength/m<2.25)continue;
    value+=surfaceValueNoise(worldEastMeters,worldNorthMeters,wavelength,salt+Math.round(wavelength))*gain;
    weight+=gain;
  }
  return weight?value/weight:0;
}

function patchDimensionsForLevel(index){'''
new_relief = '''function registeredMapReliefValue(worldEastMeters,worldNorthMeters,metersPerTexel,salt){
  // Presentation-only relief: use only wavelengths that remain physically
  // resolvable at this texel size. Inputs are Campaign-SEED registered metres,
  // so focus movement/LOD/cache order cannot change the field.
  const m=Math.max(1,Number(metersPerTexel)||1);
  let value=0,weight=0;
  for(const [wavelength,gain] of [[5200,.32],[2600,.62],[1200,.54],[560,.30]]){
    if(wavelength/m<2.25)continue;
    value+=surfaceValueNoise(worldEastMeters,worldNorthMeters,wavelength,salt+Math.round(wavelength))*gain;
    weight+=gain;
  }
  return weight?value/weight:0;
}
function localPatchMarginForLevel(levelIndex){
  const index=clamp(Math.round(levelIndex),0,LOCAL_DETAIL_LEVELS.length-1);
  // Strategic parents need more camera/projection overscan. Once the tangent
  // surface owns the view, 1.65x keeps a generous feather outside the accepted
  // viewport; final ground needs only a compact deterministic guard band.
  if(index<=1)return 2.35;
  if(index===2)return 2.00;
  if(index===3)return 1.75;
  if(index<=10)return 1.65;
  return 1.40;
}

function patchDimensionsForLevel(index){'''
updated = replace_once(updated, old_relief, new_relief, "per-LOD physical overscan helper")
updated = replace_once(
    updated,
    "  const patchWidth=visibleWidth*LOCAL_PATCH_MARGIN,patchHeight=visibleHeight*LOCAL_PATCH_MARGIN;",
    "  const patchMargin=localPatchMarginForLevel(levelIndex);\n  const patchWidth=visibleWidth*patchMargin,patchHeight=visibleHeight*patchMargin;",
    "per-LOD physical overscan use",
)
updated = replace_once(
    updated,
    "  return {levelIndex,levelId:level.id,band:level.band,visibleWidth,visibleHeight,patchWidth,patchHeight,sampleSpacingMeters:level.sampleSpacingMeters,reliefClampMeters:level.reliefClampMeters,reliefGain:level.reliefGain,maxHeightUnits:level.maxHeightUnits,metersPerUnit,staticWorld:Boolean(level.staticWorld)};",
    "  return {levelIndex,levelId:level.id,band:level.band,visibleWidth,visibleHeight,patchWidth,patchHeight,patchMargin,sampleSpacingMeters:level.sampleSpacingMeters,reliefClampMeters:level.reliefClampMeters,reliefGain:level.reliefGain,maxHeightUnits:level.maxHeightUnits,metersPerUnit,staticWorld:Boolean(level.staticWorld)};",
    "overscan telemetry",
)

# Add cumulative registered wavelengths only when the physical texel can resolve
# them. These are world-coordinate deterministic residuals, not camera-relative
# decoration, so each closer accepted scale reveals new frequencies in place.
updated = replace_once(
    updated,
    '''  if(metersPerTexel<=30)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,95,salt+97)*.025;
  if(metersPerTexel<=4)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,24,salt+131)*.016;
  return detail;''',
    '''  if(metersPerTexel<=30)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,95,salt+97)*.025;
  if(metersPerTexel<=16)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,48,salt+109)*.020;
  if(metersPerTexel<=8)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,24,salt+131)*.018;
  if(metersPerTexel<=2.5)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,8,salt+149)*.012;
  if(metersPerTexel<=.8)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,3,salt+163)*.008;
  return detail;''',
    "cumulative registered close-frequency ladder",
)
updated = replace_once(
    updated,
    '''  return (m<=24000?1:0)+(m<=6000?1:0)+(m<=1200?1:0)+(m<=100?1:0)+(m<=30?1:0)+(m<=4?1:0);''',
    '''  return (m<=24000?1:0)+(m<=6000?1:0)+(m<=1200?1:0)+(m<=100?1:0)+(m<=30?1:0)+(m<=16?1:0)+(m<=8?1:0)+(m<=2.5?1:0)+(m<=.8?1:0);''',
    "detail-band telemetry",
)

# The focus owner is already required to cover the viewport before it becomes
# visible. Let that fully-covering owner use its native physical micro bandwidth;
# keep context rings on the shared-family gate so no different-frequency card can
# leak into fallback coverage.
updated = replace_once(
    updated,
    "const useMicroDetail=sharedMetersPerTexel<=4;",
    "const useMicroDetail=contextRing?sharedMetersPerTexel<=4:metersPerTexel<=8;",
    "focus-native micro-detail eligibility",
)

# Evidence/debug authority text should state the actual strategy being rendered.
updated = updated.replace(
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v38"',
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v39"',
    1,
)
if 'canonical-continuous-cross-lod-source-v39' not in updated:
    raise SystemExit("topographic revision anchor missing")

if updated == text:
    raise SystemExit("no WP-S003-010-003-005-002 Attempt 1 changes applied")
PATH.write_text(updated, encoding="utf-8")
print("Applied WP-S003-010-003-005-002 new-run Attempt 1 physical-density refinement")
