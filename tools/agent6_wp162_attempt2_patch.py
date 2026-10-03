from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
old = '''      // Once the 3x context ring itself reaches local physical resolution, carry
      // most of the same registered high-pass bandwidth as the 1x child. Keeping
      // it at the old fixed 22% residual made the child read as a richer rectangle
      // even though both layers sampled the same canonical coordinates.
      const contextLocalContinuity=contextRing?smoothstep01(clamp((8-metersPerTexel)/6.5,0,1)):0;'''
new = '''      // Begin context continuity as soon as the 3x ring can physically resolve
      // the coarser registered local bands. At ~11 m/texel the ring cannot admit
      // the 18 m band, but it can preserve the 48 m+ structure already visible
      // in the 1x child. Letting that resolvable parent bandwidth stay at the old
      // 22% residual exposed the 1x streaming footprint as a rectangular card.
      const contextLocalContinuity=contextRing?smoothstep01(clamp((20-metersPerTexel)/14,0,1)):0;'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one context-continuity block, found {count}")
path.write_text(text.replace(old, new), encoding="utf-8")
