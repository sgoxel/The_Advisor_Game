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

# WP-S003-010-003-005-002 AGENT #6 continuation.
# The current single-parent regional presentation intentionally suppresses the
# old broad relief ridge, but the remaining registered 16 km / 5.2 km cover
# signal is now too quiet and reads as featureless green. Restore only a bounded
# share of that already-sampled canonical land-cover structure; no sampling,
# authority, coordinates, or topology change.
updated = replace_once(
    updated,
    "const sharedStrategicCoverBoost=1+sharedStrategicMapBand*.055;",
    "const sharedStrategicCoverBoost=1+sharedStrategicMapBand*.30;",
    "regional registered-cover visibility",
)
updated = replace_once(
    updated,
    "const sharedCoarseRegionalCoverGain=1-sharedCoarseRegionalResidualBand*.48;",
    "const sharedCoarseRegionalCoverGain=1-sharedCoarseRegionalResidualBand*.30;",
    "regional cover suppression balance",
)

# Near-ground already samples one deterministic Campaign-SEED registered
# 34/12/4.2 m micro field. Direct color blending alone leaves that field soft.
# Reuse its existing signed microElevation value as a zero-mean albedo-relief cue
# so closer physical texel sizes reveal structure without another noise/geography
# query. Context continuity uses the same ownership weight as the color residual.
updated = replace_once(
    updated,
    """if(useMicroDetail){
        const micro=localSurfaceSample(worldEast,worldNorth,sample).color;
        // Admit the already-authoritative 34/12/4.2 m micro field by this
        // layer's real texel density, not by the coarsest fallback. Edge/context
        // ownership weights make this a refinement residual instead of a card.
        const closeWeight=smoothstep01(clamp((6-metersPerTexel)/5.5,0,1));
        const microContinuity=contextRing?contextRefineWeight:focusRefineWeight;
        const microWeight=lerp(.14,.34,closeWeight)*microContinuity;
        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));
      }""",
    """if(useMicroDetail){
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
      }""",
    "near-ground registered micro relief",
)

if updated == text:
    raise SystemExit("no WP005002 structured-detail changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 registered regional + near-ground structure")
