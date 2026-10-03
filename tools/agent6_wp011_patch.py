#!/usr/bin/env python3
from pathlib import Path

path = Path('scripts/world/planet-stage.js')
text = path.read_text()
old = '''    const microLocationFocus=root?.dataset?.microLocationFocus==="true",travelEncounterFocus=root?.dataset?.travelEncounterFocus==="true",groundCharacterFocus=groundCharacterLayerEligible()||scaleIndexForScalar(zoomState.scalar)===SCALE_LADDER.length-1;
    // The canonical center glyph remains world-anchored and visible at final
    // ground, but its map-coordinate readout yields to the RPG character scene.
    code.style.display=(microLocationFocus||travelEncounterFocus||groundCharacterFocus)?"none":"";'''
new = '''    const microLocationFocus=root?.dataset?.microLocationFocus==="true",travelEncounterFocus=root?.dataset?.travelEncounterFocus==="true",groundCharacterFocus=groundCharacterLayerEligible()||scaleIndexForScalar(zoomState.scalar)===SCALE_LADDER.length-1;
    // WP-S003-010-003-011: at regional-detail/local-network scales the
    // coordinate readout occupied the same screen lane as the authoritative
    // focus geography label. Preserve the exact world-anchored center glyph,
    // but yield the redundant coordinate text in those two public scale bands.
    const mapLabelCollisionBand=[4,5].includes(scaleIndexForScalar(zoomState.scalar));
    // The canonical center glyph remains world-anchored and visible at final
    // ground, but its map-coordinate readout yields to the RPG character scene.
    code.style.display=(microLocationFocus||travelEncounterFocus||groundCharacterFocus||mapLabelCollisionBand)?"none":"";'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one center readout snippet, found {count}')
path.write_text(text.replace(old, new, 1))
