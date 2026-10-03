#!/usr/bin/env python3
from pathlib import Path

PATH=Path("scripts/world/planet-stage.js")
text=PATH.read_text(encoding="utf-8")
updated=text

def replace_once(old,new,label):
    global updated
    if new in updated and old not in updated:
        return
    count=updated.count(old)
    if count!=1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    updated=updated.replace(old,new,1)

# WP-S003-010-003 / AGENT #6 / Attempt 3 (final allowed visual attempt).
# Keep the Attempt-2 registered material transform. Add two bounded, physically
# gated structured micro-bands only once the current source resolves them. These
# use the same Campaign-SEED-derived salts and canonical world-meter coordinates;
# they are presentation-only and add no camera identity, gameplay authority, or
# off-screen ownership. Conditional evaluation avoids the extra sample work at
# settlement and broader map levels.
old='''        const w34=colorDetailOctaveWeight(34,metersPerTexel);
        const w12=colorDetailOctaveWeight(12,metersPerTexel);
        const w42=colorDetailOctaveWeight(4.2,metersPerTexel);
        const registeredMicro=
          surfaceMaterialNoise(worldEast,worldNorth,34,microSurfaceSalt+11)*.042*w34+
          surfaceMaterialNoise(worldEast,worldNorth,12,microSurfaceSalt+29)*.030*w12+
          surfaceMaterialNoise(worldEast,worldNorth,4.2,microSurfaceSalt+47)*.019*w42;
        const closeGain=lerp(.92,1.28,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));
        displayColor=displayColor.map((v,i)=>clamp(v+registeredMicro*closeGain*(i===0?1:i===1?.92:.72),0,.88));'''
new='''        const w34=colorDetailOctaveWeight(34,metersPerTexel);
        const w12=colorDetailOctaveWeight(12,metersPerTexel);
        const w42=colorDetailOctaveWeight(4.2,metersPerTexel);
        const w7=colorDetailOctaveWeight(7,metersPerTexel);
        const w28=colorDetailOctaveWeight(2.8,metersPerTexel);
        const registeredMicro=
          surfaceMaterialNoise(worldEast,worldNorth,34,microSurfaceSalt+11)*.042*w34+
          surfaceMaterialNoise(worldEast,worldNorth,12,microSurfaceSalt+29)*.030*w12+
          surfaceMaterialNoise(worldEast,worldNorth,4.2,microSurfaceSalt+47)*.019*w42;
        // The 7 m slope band is fully resolved by near-ground-close (~1.1 m/texel)
        // but remains absent from settlement (~3.9 m/texel). The 2.8 m child then
        // eases in toward ground. Both are the same registered signal at every LOD.
        const registeredFine=(w7>0?surfaceStructuredNoise(worldEast,worldNorth,7,microSurfaceSalt+71)*.058*w7:0)+
          (w28>0?surfaceStructuredNoise(worldEast,worldNorth,2.8,microSurfaceSalt+89)*.026*w28:0);
        const closeGain=lerp(.92,1.34,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));
        displayColor=displayColor.map((v,i)=>clamp(v+registeredMicro*closeGain*(i===0?1:i===1?.92:.72)+registeredFine*(i===0?.72:i===1?1:.50),0,.88));'''
replace_once(old,new,"near-ground registered micro block")
replace_once('topographicSignalRevision:"canonical-continuous-cross-lod-source-v41"','topographicSignalRevision:"canonical-continuous-cross-lod-source-v42"',"telemetry revision")
replace_once('structuredFrequencyTransform:true,structuredSlopeTransform:true,materialFrequencyTransform:true,','structuredFrequencyTransform:true,structuredSlopeTransform:true,materialFrequencyTransform:true,nearGroundRegisteredMicroV3:true,',"attempt telemetry")

if updated==text:
    raise SystemExit("no Attempt 3 product changes applied")
PATH.write_text(updated,encoding="utf-8")
print("Applied WP-S003-010-003 Attempt 3 registered near-ground micro-band refinement")
