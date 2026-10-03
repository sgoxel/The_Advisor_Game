#!/usr/bin/env python3
from pathlib import Path

p = Path('scripts/world/planet-stage.js')
text = p.read_text(encoding='utf-8')

old_fraction='  const targetFraction=tier==="footprint"?.16:tier==="route"?.17:tier==="coarse"?.22:.22;'
new_fraction='  const targetFraction=tier==="footprint"?.18:tier==="route"?.28:tier==="coarse"?.46:.46;'
if text.count(old_fraction) != 1:
    raise SystemExit(f'targetFraction anchor count={text.count(old_fraction)}')
text = text.replace(old_fraction, new_fraction, 1)

old_comment='''  // WP-S003-010-003-007: the coarse settlement envelope must remain readable
  // in screen space while preserving the exact canonical plan underneath it.
  // These values restore the previously accepted progressive reveal contract:
  // early tiers may exaggerate authoritative geometry for readability, then the
  // representation converges naturally to physical 1:1 by the full tier.'''
new_comment='''  // WP-S003-010-003-007: grow the same canonical settlement footprint
  // monotonically in screen space before refined physical-scale presentation.
  // The overview tiers stay cheap/presentation-only, then converge naturally
  // to the authoritative 1:1 village without a late visual jump.'''
if text.count(old_comment) == 1:
    text = text.replace(old_comment, new_comment, 1)

p.write_text(text, encoding='utf-8')
print('patched WP007 monotonic settlement reveal screen-space ladder')
