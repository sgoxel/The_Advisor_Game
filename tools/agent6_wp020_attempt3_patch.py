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

# WP-S003-010-003-005-002 final attempt:
# A medium ring at ~18 m/texel can truthfully resolve 36 m+ structure. The old
# continuity gate waited until 20 m/texel and therefore left the 3x parent much
# flatter than the 1x focus at settlement/local tiers. Admit only the existing
# registered native-minus-shared residual, earlier and with near-focus gain.
updated = replace_once(
    updated,
    'const contextLocalContinuity=contextRing?smoothstep01(clamp((20-metersPerTexel)/14,0,1)):0;\n      const contextResidualGain=contextRing?lerp(.22,.72,contextLocalContinuity):0;\n      const refinementGain=contextRing?contextRefineWeight*contextResidualGain:focusRefineWeight*.94*strategicFocusResidualScale;',
    'const contextLocalContinuity=contextRing?smoothstep01(clamp((48-metersPerTexel)/36,0,1)):0;\n      const contextResidualGain=contextRing?lerp(.38,.92,contextLocalContinuity):0;\n      // Native-minus-shared is a registered high-pass term already computed for\n      // every layer. Strengthen only this zero-mean refinement as physical texel\n      // size enters the local range; the common parent photometry is unchanged.\n      const localNativeResidualBand=smoothstep01(clamp((72-metersPerTexel)/60,0,1));\n      const localNativeResidualBoost=1+localNativeResidualBand*.38;\n      const refinementGain=(contextRing?contextRefineWeight*contextResidualGain:focusRefineWeight*.94*strategicFocusResidualScale)*localNativeResidualBoost;',
    "local registered macro residual continuity",
)

# Land-cover uses the same world-registered native-minus-shared construction.
# Bring its context convergence in line with the macro residual so richer terrain
# structure is not confined to a rectangular 1x focus footprint.
updated = replace_once(
    updated,
    'const contextCoverGain=contextRing?lerp(.38,.82,contextLocalContinuity):0;\n        const coverGain=contextRing?contextRefineWeight*contextCoverGain:focusRefineWeight*.98*strategicFocusResidualScale;',
    'const contextCoverGain=contextRing?lerp(.48,.94,contextLocalContinuity):0;\n        const coverGain=(contextRing?contextRefineWeight*contextCoverGain:focusRefineWeight*.98*strategicFocusResidualScale)*localNativeResidualBoost;',
    "local registered cover residual continuity",
)

# A prepared local terrain resource is concentric by construction: 1x feathered
# focus + world-matched 3x medium + world-matched 6x surround. Continuous zoom can
# temporarily make the 1x overscan smaller than the viewport even though the same
# resource's covering rings remain valid. Hiding the fine child in that interval
# defeats refinement and creates a visible LOD card. Gate ownership on the whole
# prepared family while retaining separate fine-only telemetry.
old = '''    const coverageDims=displayResource?.dims||dims;
    const fineCoverageTolerance=.995;
    const finePatchCoversViewport=Number(coverageDims.patchHeight||0)>=shownHeightMeters*fineCoverageTolerance&&Number(coverageDims.patchWidth||0)>=shownHeightMeters*viewportAspect*fineCoverageTolerance;
    // Terrain coverage and canonical local-world children have separate visual
    // ownership. Keep the tangent transform container alive for eligible local
    // semantics, but let only a viewport-covering fine terrain child take over
    // from the already-ready world-matched medium/outer parents beneath it.
    // This preserves local buildings/roads while an undersized 1x focus child is
    // ready, and prevents its feathered footprint from reading as a rectangular
    // LOD ownership boundary during continuous zoom.
    const fineTerrainVisible=fineVisible&&finePatchCoversViewport&&(!mapScaleShell||mapShellOut>.02);
    const localPresentationVisible=localWorldPresentationEligibility().visible;
    tangentPatch.enabled=fineVisible||localPresentationVisible;
    if(tangentPatch.render)tangentPatch.render.enabled=fineTerrainVisible;
    localResources.foregroundPatchCoversViewport=finePatchCoversViewport;
    localResources.foregroundPatchVisible=fineTerrainVisible;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);
    projectionPresentation={...projectionPresentation,viewBlend,presentationCompensation:dims.presentationCompensation,patchScale,shownHeightMeters,targetHeightMeters:presentationTargetHeightMeters(),foregroundPatchCoversViewport:finePatchCoversViewport};'''
new = '''    const coverageDims=displayResource?.dims||dims;
    const coverageTolerance=.995;
    const covers=(factor)=>Number(coverageDims.patchHeight||0)*factor>=shownHeightMeters*coverageTolerance&&Number(coverageDims.patchWidth||0)*factor>=shownHeightMeters*viewportAspect*coverageTolerance;
    const finePatchCoversViewport=covers(1);
    const mediumRingCoversViewport=covers(LOCAL_MEDIUM_RING_SPAN_FACTOR);
    const surroundCoversViewport=covers(LOCAL_SURROUND_SPAN_FACTOR);
    const foregroundFamilyCoversViewport=finePatchCoversViewport||mediumRingCoversViewport||surroundCoversViewport;
    // Terrain coverage and canonical local-world children have separate visual
    // ownership. The foreground terrain resource is the concentric 1x/3x/6x
    // family, not the 1x texture in isolation. Keep its feathered fine child
    // visible whenever that same prepared, world-matched family covers the
    // viewport; this preserves continuous refinement during between-tier zoom.
    const fineTerrainVisible=fineVisible&&foregroundFamilyCoversViewport&&(!mapScaleShell||mapShellOut>.02);
    const localPresentationVisible=localWorldPresentationEligibility().visible;
    tangentPatch.enabled=fineVisible||localPresentationVisible;
    if(tangentPatch.render)tangentPatch.render.enabled=fineTerrainVisible;
    localResources.finePatchCoversViewport=finePatchCoversViewport;
    localResources.mediumRingCoversViewport=mediumRingCoversViewport;
    localResources.surroundCoversViewport=surroundCoversViewport;
    localResources.foregroundPatchCoversViewport=foregroundFamilyCoversViewport;
    localResources.foregroundPatchVisible=fineTerrainVisible;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);
    projectionPresentation={...projectionPresentation,viewBlend,presentationCompensation:dims.presentationCompensation,patchScale,shownHeightMeters,targetHeightMeters:presentationTargetHeightMeters(),finePatchCoversViewport,foregroundPatchCoversViewport:foregroundFamilyCoversViewport};'''
updated = replace_once(updated, old, new, "concentric foreground ownership")

if updated == text:
    raise SystemExit("no WP020 final-attempt changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 final registered-refinement/coverage-family changes")
