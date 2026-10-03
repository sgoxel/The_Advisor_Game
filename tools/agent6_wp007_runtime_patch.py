#!/usr/bin/env python3
from pathlib import Path
import re

p = Path('scripts/world/planet-stage.js')
text = p.read_text(encoding='utf-8')

pattern = re.compile(
    r'''function revealPresentationScale\(dims,tier,coreDiameterMeters\)\{\n'''
    r'''  if\(tier==="full"\)return 1;\n'''
    r'''(?:.*\n)*?'''
    r'''  return Number\(clamp\(desiredSpan/Math\.max\(1,coreDiameterMeters\),1,cap\)\.toFixed\(4\)\);\n'''
    r'''\}'''
)

replacement = '''function revealPresentationScale(dims,tier,coreDiameterMeters){
  if(tier==="full")return 1;
  // WP-S003-010-003-007: grow the same canonical settlement footprint
  // monotonically in screen space before refined physical-scale presentation.
  // The ladder stays cheap/presentation-only at overview tiers, then converges
  // naturally to the authoritative 1:1 village without a late visual jump.
  const targetFraction=tier==="footprint"?.18:tier==="route"?.28:tier==="coarse"?.46:.46;
  const desiredSpan=Math.max(coreDiameterMeters,dims.patchHeight*targetFraction);
  const cap=tier==="footprint"?400:tier==="route"?200:tier==="coarse"?90:18;
  return Number(clamp(desiredSpan/Math.max(1,coreDiameterMeters),1,cap).toFixed(4));
}'''

updated, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'revealPresentationScale anchor count={count}')
if updated == text:
    raise SystemExit('revealPresentationScale produced no change')
p.write_text(updated, encoding='utf-8')
print('patched WP007 monotonic settlement reveal screen-space ladder')
