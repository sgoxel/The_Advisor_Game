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

# WP-S003-010-003-005-002 continuation Attempt 1 (2026-10-03):
# Keep the proven 1x/6x/12x world-matched coverage family, but stop spending a
# full focus-resolution raster on the coarsest 12x fallback. The fallback is
# presentation coverage only; lowering its raster density preserves canonical
# coordinates/determinism and removes a large fraction of per-resource pixels.
updated = replace_once(
    updated,
    'const LOCAL_MEDIUM_RING_TEXTURE_SCALE=.90;\nconst LOCAL_GRACE_RESIDENCY_MS=4500;',
    'const LOCAL_MEDIUM_RING_TEXTURE_SCALE=.90;\nconst LOCAL_SURROUND_RING_TEXTURE_SCALE=.58;\nconst LOCAL_GRACE_RESIDENCY_MS=4500;',
    "bounded outer fallback texture scale",
)
updated = replace_once(
    updated,
    'const surroundSize=broadParent?Math.max(96,Math.round(size*.58)):size;',
    'const surroundSize=Math.max(96,Math.round(size*LOCAL_SURROUND_RING_TEXTURE_SCALE));',
    "bounded outer fallback raster",
)

# Geometry/detail-height keeps the conservative six-samples-per-wavelength ramp.
# Albedo may safely converge sooner because it is a filtered continuous field,
# not displacement. This reveals already-computed SEED-registered local bands
# (460/280/120/90/48/18/9 m) when they are physically resolvable instead of
# holding them near zero until the next LOD. No new noise/geography samples are
# added: only weights on values the function already computes are changed.
updated = replace_once(
    updated,
    'function detailOctaveWeight(wavelengthMeters,metersPerTexel){return smoothstep01((wavelengthMeters/Math.max(1e-6,metersPerTexel)-2)/4);}\nfunction terrainDetailHeight(east,north,metersPerTexel,salt){',
    'function detailOctaveWeight(wavelengthMeters,metersPerTexel){return smoothstep01((wavelengthMeters/Math.max(1e-6,metersPerTexel)-2)/4);}\nfunction colorDetailOctaveWeight(wavelengthMeters,metersPerTexel){return smoothstep01(clamp((wavelengthMeters/Math.max(1e-6,metersPerTexel)-2)/1.75,0,1));}\nfunction terrainDetailHeight(east,north,metersPerTexel,salt){',
    "color-only physical bandwidth ramp",
)
updated = replace_once(
    updated,
    '  const wBroad=detailOctaveWeight(3600,metersPerTexel),wMid=detailOctaveWeight(1500,metersPerTexel),\n    wField=detailOctaveWeight(700,metersPerTexel),wParcelDetail=detailOctaveWeight(460,metersPerTexel),\n    wFine=detailOctaveWeight(280,metersPerTexel),wCopse=detailOctaveWeight(120,metersPerTexel),\n    wGroundDetail=detailOctaveWeight(90,metersPerTexel),wLocalDetail=detailOctaveWeight(48,metersPerTexel),\n    wMicroDetail=detailOctaveWeight(18,metersPerTexel),wSubLocalDetail=detailOctaveWeight(9,metersPerTexel);',
    '  const wBroad=detailOctaveWeight(3600,metersPerTexel),wMid=detailOctaveWeight(1500,metersPerTexel),\n    wField=detailOctaveWeight(700,metersPerTexel),wParcelDetail=colorDetailOctaveWeight(460,metersPerTexel),\n    wFine=colorDetailOctaveWeight(280,metersPerTexel),wCopse=colorDetailOctaveWeight(120,metersPerTexel),\n    wGroundDetail=colorDetailOctaveWeight(90,metersPerTexel),wLocalDetail=colorDetailOctaveWeight(48,metersPerTexel),\n    wMicroDetail=colorDetailOctaveWeight(18,metersPerTexel),wSubLocalDetail=colorDetailOctaveWeight(9,metersPerTexel);',
    "registered local albedo bandwidth",
)

# The zero-mean native-minus-shared residual is the safe place to expose that
# newly resolvable bandwidth: the common parent tone/photometry remains exactly
# shared across rings, while the focus and physically capable context add only
# registered higher-frequency information. Slightly raise its bounded local gain
# and the existing close-detail field; this does not introduce a child tint card.
updated = replace_once(
    updated,
    'const localNativeResidualBoost=1+localNativeResidualBand*.38;',
    'const localNativeResidualBoost=1+localNativeResidualBand*.60;',
    "native registered residual gain",
)
updated = replace_once(
    updated,
    'const closeDetailGain=1+smoothstep01(clamp((80-metersPerTexel)/72,0,1))*.55;',
    'const closeDetailGain=1+smoothstep01(clamp((80-metersPerTexel)/72,0,1))*.75;',
    "close registered cover gain",
)

if updated == text:
    raise SystemExit("no WP-S003-010-003-005-002 native-bandwidth changes applied")

# Contract checks: preserve the accepted concentric ownership path and ensure the
# patch does not accidentally remove the viewport-bounded coverage family.
required = [
    'foregroundFamilyCoversViewport',
    'LOCAL_SURROUND_RING_TEXTURE_SCALE=.58',
    'colorDetailOctaveWeight(48,metersPerTexel)',
    'localNativeResidualBand',
]
for token in required:
    if token not in updated:
        raise SystemExit(f"missing required post-patch contract token: {token}")

path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-005-002 native albedo bandwidth + bounded outer raster")
