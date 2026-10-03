#!/usr/bin/env python3
from pathlib import Path

PATH = Path("scripts/world/planet-stage.js")
text = PATH.read_text(encoding="utf-8")
updated = text


def replace_once(old: str, new: str, label: str) -> None:
    global updated
    if new in updated and old not in updated:
        return
    count = updated.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    updated = updated.replace(old, new, 1)


# Attempt 1 proved viewport ownership/eviction remains correct, but the last
# physically resolvable registered bands are too weak and the 3 m band arrives
# only after the near-ground checkpoint. Strengthen only the already-existing
# close bands and admit the existing 3 m band as soon as >=2.4 texels resolve it.
# This adds no new random/authority source and no new frequency sample call at
# ground; near-ground performs one existing deterministic band call earlier.
replace_once(
    "if(metersPerTexel<=16)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,48,salt+109)*.020;",
    "if(metersPerTexel<=16)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,48,salt+109)*.026;",
    "48m registered contrast",
)
replace_once(
    "if(metersPerTexel<=8)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,24,salt+131)*.018;",
    "if(metersPerTexel<=8)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,24,salt+131)*.026;",
    "24m registered contrast",
)
replace_once(
    "if(metersPerTexel<=2.5)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,8,salt+149)*.012;",
    "if(metersPerTexel<=2.5)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,8,salt+149)*.020;",
    "8m registered contrast",
)
replace_once(
    "if(metersPerTexel<=.8)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,3,salt+163)*.008;",
    "if(metersPerTexel<=1.25)detail+=surfaceStructuredNoise(worldEastMeters,worldNorthMeters,3,salt+163)*.020;",
    "3m near-ground admission",
)
replace_once(
    "return (m<=24000?1:0)+(m<=6000?1:0)+(m<=1200?1:0)+(m<=100?1:0)+(m<=30?1:0)+(m<=16?1:0)+(m<=8?1:0)+(m<=2.5?1:0)+(m<=.8?1:0);",
    "return (m<=24000?1:0)+(m<=6000?1:0)+(m<=1200?1:0)+(m<=100?1:0)+(m<=30?1:0)+(m<=16?1:0)+(m<=8?1:0)+(m<=2.5?1:0)+(m<=1.25?1:0);",
    "detail-band telemetry threshold",
)
replace_once(
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v40"',
    'topographicSignalRevision:"canonical-continuous-cross-lod-source-v41"',
    "surface refinement revision",
)
replace_once(
    "structuredFrequencyTransform:true,",
    "structuredFrequencyTransform:true,closeFrequencyContrastV2:true,",
    "attempt telemetry",
)

if updated == text:
    raise SystemExit("no Attempt 2 product changes applied")
PATH.write_text(updated, encoding="utf-8")
print("Applied WP-S003-010-003 Attempt 2 close-frequency refinement")
