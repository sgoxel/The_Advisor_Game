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
# The prior continuation forced every context ring back to the 12x parent's
# photometric meters/texel. That made the physically denser 3x ring visually
# as soft as the fallback and exposed the 1x child as a centered detail island.
# Keep every layer on its real source density; existing world-registered residual
# math and radial/edge feathering already provide deterministic continuity.
updated = replace_once(
    updated,
    "const unifiedContinuationBasis=contextRing&&job.levelIndex<=8;\n  if(unifiedContinuationBasis)metersPerTexel=sharedMetersPerTexel;",
    "const unifiedContinuationBasis=false;\n  if(unifiedContinuationBasis)metersPerTexel=sharedMetersPerTexel;",
    "physical context bandwidth",
)

# Strategic locking had the same ownership side effect through settlement scale:
# contextRefineWeight became zero even when the medium ring could resolve more
# registered structure. Preserve the shared parent basis, but allow native-minus-
# parent high-pass information at every physically eligible ring.
updated = replace_once(
    updated,
    "const sharedPhotometryLock=job.levelIndex<=2;",
    "const sharedPhotometryLock=false;",
    "registered context refinement unlock",
)

# Reuse the exact existing local-ground SEED salt once per texture build. The
# close field below uses the same 34/12/4.2 m world-registered samples as
# localSurfaceSample(), but as a zero-mean physically filtered residual instead
# of blending toward a separate local color palette.
updated = replace_once(
    updated,
    "const detailSalt=((seededUnit(\"local-terrain-detail\")*1e6)|0)^0x2c1b3c6d;",
    "const detailSalt=((seededUnit(\"local-terrain-detail\")*1e6)|0)^0x2c1b3c6d;\n  const microSurfaceSalt=((seededUnit(\"local-ground\")*1e9)|0)^0x51f15e;",
    "micro surface salt",
)

old_micro = """      if(useMicroDetail){
        const micro=localSurfaceSample(worldEast,worldNorth,sample).color;
        // Admit the already-authoritative 34/12/4.2 m micro field by this
        // layer's real texel density, not by the coarsest fallback. Edge/context
        // ownership weights make this a refinement residual instead of a card.
        const closeWeight=smoothstep01(clamp((6-metersPerTexel)/5.5,0,1));
        const microContinuity=contextRing?contextRefineWeight:focusRefineWeight;
        const microWeight=lerp(.14,.34,closeWeight)*microContinuity;
        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));
      }"""
new_micro = """      if(useMicroDetail){
        // Same registered 34/12/4.2 m family as localSurfaceSample(), but each
        // octave enters only when this layer can physically resolve it. Because
        // this is zero-mean additive detail, no focus/context layer can acquire
        // a separate palette or centered brightness identity.
        const w34=colorDetailOctaveWeight(34,metersPerTexel);
        const w12=colorDetailOctaveWeight(12,metersPerTexel);
        const w42=colorDetailOctaveWeight(4.2,metersPerTexel);
        const registeredMicro=
          surfaceValueNoise(worldEast,worldNorth,34,microSurfaceSalt+11)*.024*w34+
          surfaceValueNoise(worldEast,worldNorth,12,microSurfaceSalt+29)*.017*w12+
          surfaceValueNoise(worldEast,worldNorth,4.2,microSurfaceSalt+47)*.011*w42;
        const closeGain=lerp(.86,1.18,smoothstep01(clamp((6-metersPerTexel)/5.5,0,1)));
        displayColor=displayColor.map((v,i)=>clamp(v+registeredMicro*closeGain*(i===0?1:i===1?.92:.72),0,1));
      }"""
updated = replace_once(updated, old_micro, new_micro, "zero-mean registered micro field")

# Ground roughness must also follow each layer's physical texel density. Using
# the 12x shared density made the close focus texture and its context ring sample
# the same coarse roughness scale, which preserved blur even after source density
# improved.
updated = replace_once(
    updated,
    "if(parentSample?.land&&sharedMetersPerTexel<=8){\n        const coarseScale=Math.max(2,sharedMetersPerTexel*6),fineScale=Math.max(.75,sharedMetersPerTexel*2);",
    "if(parentSample?.land&&metersPerTexel<=8){\n        const coarseScale=Math.max(2,metersPerTexel*6),fineScale=Math.max(.75,metersPerTexel*2);",
    "physical roughness bandwidth",
)

if updated == text:
    raise SystemExit("no WP005002 current-run attempt-1 changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 physical context/detail bandwidth")
