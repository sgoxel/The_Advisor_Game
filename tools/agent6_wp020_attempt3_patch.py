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

# WP-S003-010-003-005-002 continuation Attempt 2 (2026-10-03).
# Attempt 1 proved that the cheaper 12x raster is beneficial, but applying the
# faster color bandwidth ramp to 460..90 m cover bands made mid-local focus
# layers read as noisy rectangular cards. Keep the faster ramp only for the
# genuinely local 48/18/9 m registered bands; broad cover returns to the
# conservative anti-alias ramp already used by geometry.
updated = replace_once(
    updated,
    '  const wBroad=detailOctaveWeight(3600,metersPerTexel),wMid=detailOctaveWeight(1500,metersPerTexel),\n    wField=detailOctaveWeight(700,metersPerTexel),wParcelDetail=colorDetailOctaveWeight(460,metersPerTexel),\n    wFine=colorDetailOctaveWeight(280,metersPerTexel),wCopse=colorDetailOctaveWeight(120,metersPerTexel),\n    wGroundDetail=colorDetailOctaveWeight(90,metersPerTexel),wLocalDetail=colorDetailOctaveWeight(48,metersPerTexel),\n    wMicroDetail=colorDetailOctaveWeight(18,metersPerTexel),wSubLocalDetail=colorDetailOctaveWeight(9,metersPerTexel);',
    '  const wBroad=detailOctaveWeight(3600,metersPerTexel),wMid=detailOctaveWeight(1500,metersPerTexel),\n    wField=detailOctaveWeight(700,metersPerTexel),wParcelDetail=detailOctaveWeight(460,metersPerTexel),\n    wFine=detailOctaveWeight(280,metersPerTexel),wCopse=detailOctaveWeight(120,metersPerTexel),\n    wGroundDetail=detailOctaveWeight(90,metersPerTexel),wLocalDetail=colorDetailOctaveWeight(48,metersPerTexel),\n    wMicroDetail=colorDetailOctaveWeight(18,metersPerTexel),wSubLocalDetail=colorDetailOctaveWeight(9,metersPerTexel);',
    "limit accelerated color bandwidth to genuinely local bands",
)

# Undo Attempt 1's broad residual amplification. The registered local/micro
# detail below is now admitted by physical layer density and edge-feathered
# ownership, so the common cover residual no longer needs extra contrast.
updated = replace_once(
    updated,
    'const localNativeResidualBoost=1+localNativeResidualBand*.60;',
    'const localNativeResidualBoost=1+localNativeResidualBand*.38;',
    "restore bounded native residual gain",
)
updated = replace_once(
    updated,
    'const closeDetailGain=1+smoothstep01(clamp((80-metersPerTexel)/72,0,1))*.75;',
    'const closeDetailGain=1+smoothstep01(clamp((80-metersPerTexel)/72,0,1))*.55;',
    "restore bounded close cover gain",
)

# The previous micro gate used the shared 12x parent texel size. At the required
# ~0.78x checkpoint that parent is ~10 m/texel even though the focus is 0.5
# m/texel and the medium context is ~3.3 m/texel, so real 12/4.2 m registered
# signal was deliberately suppressed and the view became enlarged green blur.
# Gate by each layer's physical density instead, and multiply by the existing
# focus/context handoff weights so the signal fades before a rectangle boundary.
updated = replace_once(
    updated,
    '  const useMicroDetail=sharedMetersPerTexel<=4;',
    '  const useMicroDetail=metersPerTexel<=6;',
    "physical micro detail eligibility",
)
old_micro = '''      if(useMicroDetail){
        const micro=localSurfaceSample(worldEast,worldNorth,sample).color;
        // As the physical texel size approaches gameplay scale, let canonical
        // registered-meter micro terrain carry more of the surface. This keeps
        // close props visually grounded while coarser views retain macro identity.
        const closeWeight=smoothstep01((4-baseTransferMetersPerTexel)/3.5);
        const microWeight=lerp(.16,.32,closeWeight);
        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));
      }'''
new_micro = '''      if(useMicroDetail){
        const micro=localSurfaceSample(worldEast,worldNorth,sample).color;
        // Admit the already-authoritative 34/12/4.2 m micro field by this
        // layer's real texel density, not by the coarsest fallback. Edge/context
        // ownership weights make this a refinement residual instead of a card.
        const closeWeight=smoothstep01(clamp((6-metersPerTexel)/5.5,0,1));
        const microContinuity=contextRing?clamp(Math.max(.32,contextRefineWeight),0,1):focusRefineWeight;
        const microWeight=lerp(.10,.30,closeWeight)*microContinuity;
        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));
      }'''
updated = replace_once(updated, old_micro, new_micro, "edge-feathered physical micro refinement")

# The living-world close variation had the same shared-parent gate, leaving even
# the 0.225 m/texel ground texture almost flat. Reuse its existing deterministic
# 5.5/1.4/.62 m field only where the current layer can support it, and feather
# by the same ownership weights. No new world truth or texture dimensions.
old_style = '        const closeTextureBand=styleContract.closeSurfaceVariation===false?0:livingWorldStyleWeight*smoothstep01(clamp((4-baseTransferMetersPerTexel)/3.5,0,1));'
new_style = '''        const closeTextureEligibility=smoothstep01(clamp((2.4-metersPerTexel)/2,0,1));
        const closeTextureContinuity=contextRing?contextRefineWeight:focusRefineWeight;
        const closeTextureBand=styleContract.closeSurfaceVariation===false?0:livingWorldStyleWeight*closeTextureEligibility*closeTextureContinuity;'''
updated = replace_once(updated, old_style, new_style, "physical close style refinement")

if updated == text:
    raise SystemExit("no WP-S003-010-003-005-002 Attempt 2 changes applied")

required = [
    'foregroundFamilyCoversViewport',
    'LOCAL_SURROUND_RING_TEXTURE_SCALE=.58',
    'const useMicroDetail=metersPerTexel<=6',
    'closeTextureEligibility',
    'colorDetailOctaveWeight(48,metersPerTexel)',
]
for token in required:
    if token not in updated:
        raise SystemExit(f"missing required post-patch contract token: {token}")

path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 physical micro/style refinement with feathered ownership")
