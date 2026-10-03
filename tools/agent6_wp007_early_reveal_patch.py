#!/usr/bin/env python3
from pathlib import Path

PATH = Path("scripts/world/planet-stage.js")
text = PATH.read_text(encoding="utf-8")
old = '''  const staticWorldVisible=Boolean(level?.staticWorld)||requestedLevel==="ground";\n  const effectiveRevealTier=broadMapScale?"none":revealTier;\n  return Object.freeze({visible:!broadMapScale&&(effectiveRevealTier!=="none"||staticWorldVisible),revealTier:effectiveRevealTier,requestedScaleIndex,broadMapScale,rawLevelIndex:rawIndex,rawLevelId:requestedLevel==="ground"?"ground":level?.id||null,rawStaticWorld:staticWorldVisible});\n'''
new = '''  const staticWorldVisible=Boolean(level?.staticWorld)||requestedLevel==="ground";\n  // WP-S003-010-003-007: broad-map suppression applies to decorative/full local\n  // materialization, not the bounded canonical footprint/route previews whose\n  // purpose is to keep inhabited structure truthful before settlement scale.\n  const broadMapRevealAllowed=revealTier==="footprint"||revealTier==="route";\n  const effectiveRevealTier=broadMapScale&&!broadMapRevealAllowed?"none":revealTier;\n  const revealVisible=effectiveRevealTier!=="none";\n  return Object.freeze({visible:revealVisible||(!broadMapScale&&staticWorldVisible),revealTier:effectiveRevealTier,requestedScaleIndex,broadMapScale,rawLevelIndex:rawIndex,rawLevelId:requestedLevel==="ground"?"ground":level?.id||null,rawStaticWorld:staticWorldVisible});\n'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"WP007 early reveal anchor mismatch: {count}")
PATH.write_text(text.replace(old,new,1), encoding="utf-8")
print("WP007 bounded footprint/route eligibility restored")
