#!/usr/bin/env python3
from pathlib import Path

PATH = Path("scripts/world/planet-stage.js")
text = PATH.read_text(encoding="utf-8")

replacements = [
    (
        'const targetFraction=tier==="footprint"?.16:tier==="route"?.17:tier==="coarse"?.33:.22;',
        '// Match the coarse overview footprint to the next canonical near-ground framing so\n'
        '  // zoom refinement adds detail without making the same village jump larger on screen.\n'
        '  const targetFraction=tier==="footprint"?.16:tier==="route"?.17:tier==="coarse"?.52:.22;'
    ),
    (
        'if(!["refined","full"].includes(String(tier))||!window.RoadSignposts?.build||!localStaticRoot||!pc||!device)return 0;',
        '// Refined scale is the topology/detail handoff: keep large destination panels out of\n'
        '  // the settlement center until full/ground presentation, where they no longer mask it.\n'
        '  if(String(tier)!=="full"||!window.RoadSignposts?.build||!localStaticRoot||!pc||!device)return 0;'
    ),
    (
        'for(const descriptor of plan){\n    if(count>=64)break;',
        '// Phase bounded canonical dressing across the refined -> full handoff instead of\n'
        '  // materializing the whole prop set at the same instant as roofs/facades.\n'
        '  const descriptorCap=tier==="refined"?24:64;\n'
        '  for(const descriptor of plan){\n    if(count>=descriptorCap)break;'
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"WP007 patch anchor count mismatch ({count}) for: {old[:90]}")
    text = text.replace(old, new, 1)

PATH.write_text(text, encoding="utf-8")
print("WP007 continuity patch applied")
