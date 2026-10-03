#!/usr/bin/env python3
from pathlib import Path

PATH = Path("scripts/world/planet-stage.js")
text = PATH.read_text(encoding="utf-8")
updated = text


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return source.replace(old, new, 1)

# AGENT #6 / WP-S003-010-003 / new-run Attempt 1.
# Keep the existing Campaign-SEED coordinate authority and resource topology.
# The visual defect is that close tiers are still dominated by broad material
# value fields, then ground adds a different tiny-scale style field. Build one
# deterministic registered geomorphology family and reuse it across those tiers.

weight_anchor = '''function colorDetailOctaveWeight(wavelengthMeters,metersPerTexel){return smoothstep01(clamp((wavelengthMeters/Math.max(1e-6,metersPerTexel)-2)/1.75,0,1));}\nfunction terrainDetailHeight(east,north,metersPerTexel,salt){'''
weight_replacement = '''function colorDetailOctaveWeight(wavelengthMeters,metersPerTexel){return smoothstep01(clamp((wavelengthMeters/Math.max(1e-6,metersPerTexel)-2)/1.75,0,1));}\nfunction surfaceGeomorphologySignal(worldEastMeters,worldNorthMeters,scaleMeters,salt){\n  const x=worldEastMeters/scaleMeters,y=worldNorthMeters/scaleMeters;\n  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;\n  const tx=smoothstep01(fx),ty=smoothstep01(fy);\n  const a=surfaceHash2(x0,y0,salt),b=surfaceHash2(x0+1,y0,salt),c=surfaceHash2(x0,y0+1,salt),d=surfaceHash2(x0+1,y0+1,salt);\n  const value=lerp(lerp(a,b,tx),lerp(c,d,tx),ty)-.5;\n  const dtx=6*fx*(1-fx),dty=6*fy*(1-fy);\n  const dx=(lerp(b,d,ty)-lerp(a,c,ty))*dtx;\n  const dy=(lerp(c,d,tx)-lerp(a,b,tx))*dty;\n  const along=((salt>>>3)&1)?(dx+dy)*.70710678:(dx-dy)*.70710678;\n  // Signed ridge/valley bands come from the same continuous scalar field as the\n  // slope derivative. Positive and negative bands are symmetric, so this adds\n  // readable landform boundaries without a camera-relative brightness bias.\n  const ridge=1-smoothstep01(clamp(Math.abs(value-.17)*7.0,0,1));\n  const valley=1-smoothstep01(clamp(Math.abs(value+.17)*7.0,0,1));\n  return clamp(along*.28+(ridge-valley)*.24+value*.08,-.5,.5);\n}\nfunction localGeomorphologySignal(worldEastMeters,worldNorthMeters,metersPerTexel,salt){\n  const m=Math.max(.05,Number(metersPerTexel)||1);\n  let signal=0;\n  for(const [wavelength,gain,offset] of [[120,.022,41],[48,.030,53],[18,.034,67],[7,.030,79],[2.8,.018,97]]){\n    const weight=colorDetailOctaveWeight(wavelength,m);\n    if(weight<=0)continue;\n    signal+=surfaceGeomorphologySignal(worldEastMeters,worldNorthMeters,wavelength,salt+offset)*gain*weight;\n  }\n  return signal;\n}\nfunction terrainDetailHeight(east,north,metersPerTexel,salt){'''
updated = replace_once(updated, weight_anchor, weight_replacement, "registered geomorphology helpers")

old_mottle = '''  const closeDetailGain=1+smoothstep01(clamp((80-metersPerTexel)/72,0,1))*.55;\n  const mottle=(surfaceMaterialNoise(we,wn,700,salt+31)*.024*wField+\n    surfaceMaterialNoise(we,wn,460,salt+33)*.030*wParcelDetail+\n    surfaceMaterialNoise(we,wn,280,salt+37)*.026*wFine+\n    surfaceMaterialNoise(we,wn,120,salt+41)*.016*wCopse+\n    surfaceMaterialNoise(we,wn,90,salt+43)*.010*wGroundDetail+\n    surfaceMaterialNoise(we,wn,48,salt+47)*.018*wLocalDetail+\n    surfaceMaterialNoise(we,wn,18,salt+53)*.026*wMicroDetail+\n    surfaceMaterialNoise(we,wn,9,salt+61)*.018*wSubLocalDetail)*closeDetailGain;\n  // Map-scale readability comes from one continuous registered-meter cover\n  // field, not from parcel meshes or camera-relative decoration. Stronger chroma\n  // separation reveals woodland/meadow/dry openings only when physically\n  // resolvable, so refinement adds information without changing world identity.\n  const coverContrast=lerp(1.18,2.05,smoothstep01(clamp((220-metersPerTexel)/215,0,1)));\n  return [\n    (mottle*.76-forestDelta*.105-copse*.026+dryField*.095+meadow*.010)*coverContrast+strategic*(.72+.20*alpine),\n    (mottle*.94-forestDelta*.010-copse*.008+dryField*.038+meadow*.086)*coverContrast+strategic*(1.00-.18*alpine),\n    (mottle*.48-forestDelta*.082-copse*.024+dryField*.006+meadow*.016)*coverContrast+strategic*(.50+.14*alpine)\n  ];'''
new_mottle = '''  const closeDetailGain=1+smoothstep01(clamp((80-metersPerTexel)/72,0,1))*.42;\n  const closeGeomorphBand=smoothstep01(clamp((42-metersPerTexel)/36,0,1));\n  // Broad material regions stay as low-frequency identity, but they may not own\n  // the near-ground image. Fade their residual contrast as fixed registered\n  // ridge/valley/drainage bands become physically resolvable.\n  const broadMottleRetention=lerp(1,.24,closeGeomorphBand);\n  const transitionalRetention=lerp(1,.38,closeGeomorphBand);\n  const broadMottle=(surfaceMaterialNoise(we,wn,700,salt+31)*.024*wField+\n    surfaceMaterialNoise(we,wn,460,salt+33)*.030*wParcelDetail+\n    surfaceMaterialNoise(we,wn,280,salt+37)*.026*wFine)*broadMottleRetention;\n  const transitionalMottle=(surfaceMaterialNoise(we,wn,120,salt+41)*.014*wCopse+\n    surfaceMaterialNoise(we,wn,90,salt+43)*.009*wGroundDetail)*transitionalRetention;\n  const localForm=localGeomorphologySignal(we,wn,metersPerTexel,salt+37)*lerp(.35,1.12,closeGeomorphBand);\n  const mottle=(broadMottle+transitionalMottle+localForm)*closeDetailGain;\n  // Keep broad land-cover category identity, but at near-ground let the same\n  // registered geomorphology carry most visible contrast instead of kilometer\n  // regions reading as magnified blurry blobs.\n  const regionPersistence=lerp(1,.52,closeGeomorphBand);\n  const coverContrast=lerp(1.18,1.86,smoothstep01(clamp((220-metersPerTexel)/215,0,1)));\n  return [\n    (mottle*.76+(-forestDelta*.105-copse*.026+dryField*.095+meadow*.010)*regionPersistence)*coverContrast+strategic*(.72+.20*alpine),\n    (mottle*.94+(-forestDelta*.010-copse*.008+dryField*.038+meadow*.086)*regionPersistence)*coverContrast+strategic*(1.00-.18*alpine),\n    (mottle*.48+(-forestDelta*.082-copse*.024+dryField*.006+meadow*.016)*regionPersistence)*coverContrast+strategic*(.50+.14*alpine)\n  ];'''
updated = replace_once(updated, old_mottle, new_mottle, "close land-cover geomorphology")

old_micro = '''        const registeredMicro=\n          surfaceMaterialNoise(worldEast,worldNorth,34,microSurfaceSalt+11)*.042*w34+\n          surfaceMaterialNoise(worldEast,worldNorth,12,microSurfaceSalt+29)*.030*w12+\n          surfaceMaterialNoise(worldEast,worldNorth,4.2,microSurfaceSalt+47)*.019*w42;\n        // The 7 m slope band is fully resolved by near-ground-close (~1.1 m/texel)\n        // but remains absent from settlement (~3.9 m/texel). The 2.8 m child then\n        // eases in toward ground. Both are the same registered signal at every LOD.\n        const registeredFine=(w7>0?surfaceStructuredNoise(worldEast,worldNorth,7,microSurfaceSalt+71)*.058*w7:0)+\n          (w28>0?surfaceStructuredNoise(worldEast,worldNorth,2.8,microSurfaceSalt+89)*.026*w28:0);\n        const closeGain=lerp(.92,1.34,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));\n        displayColor=displayColor.map((v,i)=>clamp(v+registeredMicro*closeGain*(i===0?1:i===1?.92:.72)+registeredFine*(i===0?.72:i===1?1:.50),0,.88));'''
new_micro = '''        const registeredMicro=\n          surfaceGeomorphologySignal(worldEast,worldNorth,34,detailSalt+48)*.038*w34+\n          surfaceGeomorphologySignal(worldEast,worldNorth,12,detailSalt+66)*.030*w12+\n          surfaceGeomorphologySignal(worldEast,worldNorth,4.2,detailSalt+84)*.020*w42;\n        // Reuse the same fixed registered geomorphology family that landCoverTint\n        // carries through close tiers. The 7 m and 2.8 m bands therefore sharpen\n        // existing landform identity instead of introducing a separate ground look.\n        const registeredFine=(w7>0?surfaceGeomorphologySignal(worldEast,worldNorth,7,detailSalt+116)*.040*w7:0)+\n          (w28>0?surfaceGeomorphologySignal(worldEast,worldNorth,2.8,detailSalt+134)*.024*w28:0);\n        const persistentForm=localGeomorphologySignal(worldEast,worldNorth,metersPerTexel,detailSalt+37);\n        const closeGain=lerp(.88,1.18,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));\n        displayColor=displayColor.map((v,i)=>clamp(v+(registeredMicro*closeGain+persistentForm*.52)*(i===0?1:i===1?.94:.72)+registeredFine*(i===0?.70:i===1?1:.52),0,.88));'''
updated = replace_once(updated, old_micro, new_micro, "persistent close geomorphology")

old_rough = '''      if(parentSample?.land&&metersPerTexel<=8){\n        const coarseScale=Math.max(2,metersPerTexel*6),fineScale=Math.max(.75,metersPerTexel*2);\n        const rough=surfaceMaterialNoise(worldEast,worldNorth,coarseScale,detailSalt+211)*.052+\n          surfaceMaterialNoise(worldEast,worldNorth,fineScale,detailSalt+233)*.026;\n        displayColor=displayColor.map((v,i)=>clamp(v+rough*(i===2?.82:i===1?.94:1),0,.86));\n      }'''
new_rough = '''      if(parentSample?.land&&metersPerTexel<=8){\n        // Fine roughness must reinforce the same fixed registered landform family;\n        // do not derive a new LOD-sized noise scale that changes identity per tier.\n        const rough=localGeomorphologySignal(worldEast,worldNorth,metersPerTexel,detailSalt+37)*.46;\n        displayColor=displayColor.map((v,i)=>clamp(v+rough*(i===2?.78:i===1?.94:1),0,.86));\n      }'''
updated = replace_once(updated, old_rough, new_rough, "fixed close roughness identity")

old_style = '''        if(closeTextureBand>.001&&["terrain:grass","terrain:forest","terrain:farmland"].includes(role)){\n          const broadStyle=surfaceValueNoise(worldEast,worldNorth,5.5,detailSalt+307),fineStyle=surfaceValueNoise(worldEast,worldNorth,1.4,detailSalt+331),microStyle=surfaceValueNoise(worldEast,worldNorth,.62,detailSalt+349);\n          const broadWeight=colorDetailOctaveWeight(5.5,metersPerTexel),fineWeight=colorDetailOctaveWeight(1.4,metersPerTexel),microWeight=colorDetailOctaveWeight(.62,metersPerTexel);\n          const patch=(broadStyle*.145*broadWeight+fineStyle*.070*fineWeight+microStyle*.035*microWeight)*closeTextureBand;\n          displayColor=[clamp(displayColor[0]+patch*.92,0,1),clamp(displayColor[1]+patch*.68,0,1),clamp(displayColor[2]-patch*.12,0,1)];\n        }'''
new_style = '''        if(closeTextureBand>.001&&["terrain:grass","terrain:forest","terrain:farmland"].includes(role)){\n          // Ground styling follows the same canonical landform signal already\n          // visible at near-ground; style adds chroma, not a new patch pattern.\n          const form=localGeomorphologySignal(worldEast,worldNorth,metersPerTexel,detailSalt+37);\n          const patch=form*closeTextureBand*.62;\n          displayColor=[clamp(displayColor[0]+patch*.78,0,1),clamp(displayColor[1]+patch*.62,0,1),clamp(displayColor[2]-patch*.10,0,1)];\n        }'''
updated = replace_once(updated, old_style, new_style, "ground style continuity")

old_toon = '''          const closeToon=smoothstep01(clamp((18-metersPerTexel)/17.5,0,1));\n          const stepSize=lerp(.050,.028,closeToon);\n          const quantized=clamp(Math.round(luma/stepSize)*stepSize,0,1);\n          const shift=(quantized-luma)*toonBand*.68;'''
new_toon = '''          const closeToon=smoothstep01(clamp((18-metersPerTexel)/17.5,0,1));\n          // Preserve cel readability without flattening away the geomorphology\n          // that is finally resolved at near-ground/ground physical texel sizes.\n          const stepSize=lerp(.050,.016,closeToon);\n          const quantized=clamp(Math.round(luma/stepSize)*stepSize,0,1);\n          const shift=(quantized-luma)*toonBand*lerp(.68,.44,closeToon);'''
updated = replace_once(updated, old_toon, new_toon, "close toon continuity")

updated = replace_once(
    updated,
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v42"',
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v43"',
    "topographic revision",
)
updated = replace_once(
    updated,
    'nearGroundRegisteredMicroV3:true,',
    'nearGroundRegisteredMicroV3:true,canonicalGeomorphologyV1:true,groundStyleGeomorphologyContinuity:true,',
    "geomorphology telemetry",
)

if updated == text:
    raise SystemExit("no WP003 Phase 3 Attempt 1 changes applied")
for required in (
    'function surfaceGeomorphologySignal(',
    'function localGeomorphologySignal(',
    'canonical-continuous-cross-lod-source-v43',
    'canonicalGeomorphologyV1:true',
):
    if required not in updated:
        raise SystemExit(f"missing required marker: {required}")

PATH.write_text(updated, encoding="utf-8")
print("Applied WP-S003-010-003 Phase 3 Attempt 1 canonical geomorphology continuity")
