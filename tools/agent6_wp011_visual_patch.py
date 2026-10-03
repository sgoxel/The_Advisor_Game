#!/usr/bin/env python3
from pathlib import Path

p = Path('scripts/world/planet-stage.js')
text = p.read_text(encoding='utf-8')
updated = text

# WP-S003-010-003-011 Attempt 2: the center telemetry readout becomes
# absolutely positioned during settlement-overview presentation. The parent
# marker's bounding box then contains only the glyph, so atlas decluttering can
# legally place a canonical label over the readout. Reserve the child readout
# rectangle explicitly; this changes presentation only, never identity/SEED.
old_reserved = 'const reservedSelectors=[".planet-map-context",".planet-places-button",".planet-scale-ruler",".planet-world-center"];'
new_reserved = 'const reservedSelectors=[".planet-map-context",".planet-places-button",".planet-scale-ruler",".planet-world-center",".planet-world-center code"];'
if old_reserved in updated:
    updated = updated.replace(old_reserved, new_reserved, 1)
elif new_reserved not in updated:
    raise SystemExit('atlas reservedSelectors anchor not found')

# Sharpen the three player-visible transition tiers that were visibly soft in
# fresh 1280x657 acceptance frames. Sampling coordinates, footprint, geometry,
# and SEED authority are unchanged; only bounded one-time presentation texture
# density increases. The async sliced preparation path and resource caps remain.
replacements = [
    (
        'Object.freeze({id:"local-area-wide",band:"local-area",visibleHeightMeters:20000,sampleSpacingMeters:480,textureSize:320,reliefClampMeters:5000,reliefGain:8,maxHeightUnits:.60,staticWorld:false}),',
        'Object.freeze({id:"local-area-wide",band:"local-area",visibleHeightMeters:20000,sampleSpacingMeters:480,textureSize:448,reliefClampMeters:5000,reliefGain:8,maxHeightUnits:.60,staticWorld:false}),' 
    ),
    (
        'Object.freeze({id:"settlement-wide",band:"local-area",visibleHeightMeters:5000,sampleSpacingMeters:110,textureSize:448,reliefClampMeters:3000,reliefGain:5.5,maxHeightUnits:.50,staticWorld:false}),',
        'Object.freeze({id:"settlement-wide",band:"local-area",visibleHeightMeters:5000,sampleSpacingMeters:110,textureSize:512,reliefClampMeters:3000,reliefGain:5.5,maxHeightUnits:.50,staticWorld:false}),' 
    ),
    (
        'Object.freeze({id:"near-ground-wide",band:"settlement",visibleHeightMeters:500,sampleSpacingMeters:11,textureSize:352,reliefClampMeters:400,reliefGain:2.2,maxHeightUnits:.33,staticWorld:true}),',
        'Object.freeze({id:"near-ground-wide",band:"settlement",visibleHeightMeters:500,sampleSpacingMeters:11,textureSize:512,reliefClampMeters:400,reliefGain:2.2,maxHeightUnits:.33,staticWorld:true}),' 
    ),
]
for old, new in replacements:
    if old in updated:
        updated = updated.replace(old, new, 1)
    elif new not in updated:
        raise SystemExit('local detail texture anchor not found: ' + old[:80])

if updated == text:
    print('WP011 visual patch already current')
else:
    p.write_text(updated, encoding='utf-8')
    print('patched WP011 center-label exclusion and bounded local texture density')
