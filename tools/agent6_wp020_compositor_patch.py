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

# WP-S003-010-003-005-002 Attempt 2:
# Every concentric representation of one prepared local resource must share the
# same low-frequency photometric transfer. Native texel size remains available
# to the existing registered high-pass refinement terms, so zoom adds spatial
# information without changing the parent-scale tone envelope.
updated = replace_once(
    updated,
    "const baseTransferMetersPerTexel=sharedPhotometryLock?sharedMetersPerTexel:metersPerTexel;",
    "const baseTransferMetersPerTexel=sharedMetersPerTexel;",
    "shared local photometric transfer",
)

# Absolute micro-colour is a low-frequency identity change if only the 1x child
# qualifies for it. Admit it only when the whole 1x/3x/6x prepared family can
# physically support the same registered field.
updated = replace_once(
    updated,
    "const useMicroDetail=metersPerTexel<=4;",
    "const useMicroDetail=sharedMetersPerTexel<=4;",
    "shared micro-detail eligibility",
)

# Map readability contrast is a display transfer, not new detail. Drive it from
# the common transfer footprint; registered native macro/cover residuals below
# this stage still add genuine finer information where physically resolvable.
updated = replace_once(
    updated,
    "const localMapReadabilityBand=smoothstep01(clamp((metersPerTexel-18)/34,0,1))*\n          (1-smoothstep01(clamp((metersPerTexel-230)/170,0,1)));",
    "const localMapReadabilityBand=smoothstep01(clamp((baseTransferMetersPerTexel-18)/34,0,1))*\n          (1-smoothstep01(clamp((baseTransferMetersPerTexel-230)/170,0,1)));",
    "shared local-map readability transfer",
)

# Keep the common display result when absolute micro-colour is admitted. The
# previous path restarted from `authoritative`, silently discarding the shared
# readability/chroma transfer. All rings now use one micro gain; texture raster
# density itself remains different and therefore supplies the LOD refinement.
updated = replace_once(
    updated,
    "const closeWeight=smoothstep01((4-metersPerTexel)/3.5);\n        const contextMicroContinuity=contextRing?lerp(.78,1,contextRefineWeight):1;\n        const microWeight=lerp(.16,.32,closeWeight)*contextMicroContinuity;\n        displayColor=authoritative.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));",
    "const closeWeight=smoothstep01((4-baseTransferMetersPerTexel)/3.5);\n        const microWeight=lerp(.16,.32,closeWeight);\n        displayColor=displayColor.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));",
    "shared micro display transfer",
)

# Roughness is a presentation field. Turn it on for the whole concentric family
# at once and evaluate the same registered physical frequencies in every layer;
# differing raster density still reveals more samples without a square tone card.
updated = replace_once(
    updated,
    "if(parentSample?.land&&metersPerTexel<=8){\n        const coarseScale=Math.max(2,metersPerTexel*6),fineScale=Math.max(.75,metersPerTexel*2);",
    "if(parentSample?.land&&sharedMetersPerTexel<=8){\n        const coarseScale=Math.max(2,sharedMetersPerTexel*6),fineScale=Math.max(.75,sharedMetersPerTexel*2);",
    "shared roughness family",
)

# The living-world grade is also low-frequency presentation. Apply one grade and
# one close-variation eligibility band to the entire prepared family; world-space
# noise inputs remain the existing deterministic registered coordinates.
updated = replace_once(
    updated,
    "const localStyleBand=smoothstep01(clamp((styleMax-metersPerTexel)/(styleMax-4),0,1));",
    "const localStyleBand=smoothstep01(clamp((styleMax-baseTransferMetersPerTexel)/(styleMax-4),0,1));",
    "shared living-world style eligibility",
)
updated = replace_once(
    updated,
    "const livingWorldStyleWeight=localStyleBand*(contextRing?lerp(.78,1,contextRefineWeight):1);",
    "const livingWorldStyleWeight=localStyleBand;",
    "shared living-world style weight",
)
updated = replace_once(
    updated,
    "const closeTextureBand=styleContract.closeSurfaceVariation===false?0:livingWorldStyleWeight*smoothstep01(clamp((4-metersPerTexel)/3.5,0,1));",
    "const closeTextureBand=styleContract.closeSurfaceVariation===false?0:livingWorldStyleWeight*smoothstep01(clamp((4-baseTransferMetersPerTexel)/3.5,0,1));",
    "shared close-surface variation eligibility",
)

# A prepared focus patch is generated for the current viewport footprint, while
# the world-matched medium/outer parents remain underneath its feathered edge.
# A 2% expansion requirement therefore misclassifies an exact-fit child as not
# covering the viewport and hides valid terrain. Keep a sub-percent deterministic
# tolerance for floating-point/projection rounding rather than weakening coverage.
updated = replace_once(
    updated,
    "const finePatchCoversViewport=Number(coverageDims.patchHeight||0)>=shownHeightMeters*1.02&&Number(coverageDims.patchWidth||0)>=shownHeightMeters*viewportAspect*1.02;",
    "const fineCoverageTolerance=.995;\n    const finePatchCoversViewport=Number(coverageDims.patchHeight||0)>=shownHeightMeters*fineCoverageTolerance&&Number(coverageDims.patchWidth||0)>=shownHeightMeters*viewportAspect*fineCoverageTolerance;",
    "exact-fit foreground coverage tolerance",
)

if updated == text:
    raise SystemExit("no WP020 compositor changes applied")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 concentric photometry and exact-fit coverage")
