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

# WP-S003-010-003-005-002 continuation, current-run Attempt 1.
# The 3x context was being forced to the 12x fallback's photometric bandwidth,
# which makes a physically denser ring look equally soft and exposes the 1x
# child as a centered detail island. Keep every texture on its actual source
# meters/texel; the existing shared-parent residuals + feathering remain intact.
updated = replace_once(
    updated,
    "const unifiedContinuationBasis=contextRing&&job.levelIndex<=8;\n  if(unifiedContinuationBasis)metersPerTexel=sharedMetersPerTexel;",
    "const unifiedContinuationBasis=false;\n  if(unifiedContinuationBasis)metersPerTexel=sharedMetersPerTexel;",
    "physical context bandwidth",
)

# The strategic lock also zeroed contextRefineWeight through settlement scale.
# Preserve the common parent term but admit only the already-computed registered
# native-minus-parent residual according to the ring's real density.
updated = replace_once(
    updated,
    "const sharedPhotometryLock=job.levelIndex<=2;",
    "const sharedPhotometryLock=false;",
    "registered context refinement unlock",
)

updated = replace_once(
    updated,
    "const detailSalt=((seededUnit(\"local-terrain-detail\")*1e6)|0)^0x2c1b3c6d;",
    "const detailSalt=((seededUnit(\"local-terrain-detail\")*1e6)|0)^0x2c1b3c6d;\n  const microSurfaceSalt=((seededUnit(\"local-ground\")*1e9)|0)^0x51f15e;",
    "micro surface salt",
)

old_micro = """      if(useMicroDetail){
        const microSample=localSurfaceSample(worldEast,worldNorth,sample),micro=microSample.color;
        // Admit the already-authoritative 34/12/4.2 m micro field by this
        // layer's real texel density, not by the coarsest fallback. Edge/context
        // ownership weights make this a refinement residual instead of a card.
        const closeWeight=smoothstep01(clamp((6-metersPerTexel)/5.5,0,1));
        const microContinuity=contextRing?contextRefineWeight:focusRefineWeight;
        const microWeight=lerp(.14,.34,closeWeight)*microContinuity;
        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));
        // microElevation is the signed form of the same registered field already
        // sampled above. A small zero-mean tonal cue exposes its physical relief
        // at sub-6 m/texel without adding a second texture identity or extra work.
        const microRelief=clamp(Number(microSample.microElevation||0)/5.2,-1,1);
        const microReliefGain=lerp(.018,.050,closeWeight)*microContinuity;
        displayColor=displayColor.map((v,i)=>clamp(v+microRelief*microReliefGain*(i===2?.76:i===1?.94:1),0,.88));
      }"""
new_micro = """      if(useMicroDetail){
        // Use the exact existing local-ground SEED frequencies as a zero-mean
        // registered residual. Each octave enters only when this layer can
        // physically resolve it, so focus/context differ only by real bandwidth,
        // never by a centered ownership/palette weight.
        const w34=colorDetailOctaveWeight(34,metersPerTexel);
        const w12=colorDetailOctaveWeight(12,metersPerTexel);
        const w42=colorDetailOctaveWeight(4.2,metersPerTexel);
        const registeredMicro=
          surfaceValueNoise(worldEast,worldNorth,34,microSurfaceSalt+11)*.024*w34+
          surfaceValueNoise(worldEast,worldNorth,12,microSurfaceSalt+29)*.017*w12+
          surfaceValueNoise(worldEast,worldNorth,4.2,microSurfaceSalt+47)*.011*w42;
        const closeGain=lerp(.86,1.18,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));
        displayColor=displayColor.map((v,i)=>clamp(v+registeredMicro*closeGain*(i===0?1:i===1?.92:.72),0,.88));
      }"""
updated = replace_once(updated, old_micro, new_micro, "zero-mean registered micro field")

# Fine albedo roughness should use each texture's actual density as well. The
# prior shared-density condition preserved a coarse blur even when the child or
# medium context could resolve a smaller registered scale.
updated = replace_once(
    updated,
    "if(parentSample?.land&&sharedMetersPerTexel<=8){\n        const coarseScale=Math.max(2,sharedMetersPerTexel*6),fineScale=Math.max(.75,sharedMetersPerTexel*2);",
    "if(parentSample?.land&&metersPerTexel<=8){\n        const coarseScale=Math.max(2,metersPerTexel*6),fineScale=Math.max(.75,metersPerTexel*2);",
    "physical roughness bandwidth",
)

# The structured close-surface style added after the prior attempt was focus-only
# and therefore another potential detail card. Keep the same registered 5.5/1.4/
# .62 m fields, but filter each frequency by physical meters/texel and allow any
# eligible context layer to carry the same world-space signal.
old_style = """        const closeTextureEligibility=smoothstep01(clamp((2.4-metersPerTexel)/2,0,1));
        const closeTextureContinuity=contextRing?0:focusRefineWeight;
        const closeTextureBand=styleContract.closeSurfaceVariation===false?0:livingWorldStyleWeight*closeTextureEligibility*closeTextureContinuity;
        if(closeTextureBand>.001&&[\"terrain:grass\",\"terrain:forest\",\"terrain:farmland\"].includes(role)){
          const broadStyle=surfaceValueNoise(worldEast,worldNorth,5.5,detailSalt+307),fineStyle=surfaceValueNoise(worldEast,worldNorth,1.4,detailSalt+331),microStyle=surfaceValueNoise(worldEast,worldNorth,.62,detailSalt+349);
          const patch=(broadStyle*.145+fineStyle*.070+microStyle*.035)*closeTextureBand;
          displayColor=[clamp(displayColor[0]+patch*.92,0,1),clamp(displayColor[1]+patch*.68,0,1),clamp(displayColor[2]-patch*.12,0,1)];
        }"""
new_style = """        const closeTextureEligibility=smoothstep01(clamp((2.4-metersPerTexel)/2,0,1));
        const closeTextureBand=styleContract.closeSurfaceVariation===false?0:livingWorldStyleWeight*closeTextureEligibility;
        if(closeTextureBand>.001&&[\"terrain:grass\",\"terrain:forest\",\"terrain:farmland\"].includes(role)){
          const broadStyle=surfaceValueNoise(worldEast,worldNorth,5.5,detailSalt+307),fineStyle=surfaceValueNoise(worldEast,worldNorth,1.4,detailSalt+331),microStyle=surfaceValueNoise(worldEast,worldNorth,.62,detailSalt+349);
          const broadWeight=colorDetailOctaveWeight(5.5,metersPerTexel),fineWeight=colorDetailOctaveWeight(1.4,metersPerTexel),microWeight=colorDetailOctaveWeight(.62,metersPerTexel);
          const patch=(broadStyle*.145*broadWeight+fineStyle*.070*fineWeight+microStyle*.035*microWeight)*closeTextureBand;
          displayColor=[clamp(displayColor[0]+patch*.92,0,1),clamp(displayColor[1]+patch*.68,0,1),clamp(displayColor[2]-patch*.12,0,1)];
        }"""
updated = replace_once(updated, old_style, new_style, "physical close-surface style continuity")

if updated == text:
    raise SystemExit("no WP005002 current-run attempt-1 changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 physical context/detail bandwidth")
