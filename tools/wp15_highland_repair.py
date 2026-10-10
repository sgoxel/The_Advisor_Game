from pathlib import Path

p = Path('src/hydrology.ts')
text = p.read_text()
old = '''          : slope >= 0.28
            ? "difficult"'''
new = '''          : slope >= 0.28 || core.macro.reliefM >= 50 || core.macro.mountainIntensity >= 0.04
            ? "difficult"'''
if old not in text:
    raise SystemExit('highland traversal anchor missing')
p.write_text(text.replace(old, new, 1))

p = Path('src/surface.ts')
text = p.read_text()
old = '''    traversal: TraversalKind =
      natural.water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : slope >= 0.42
            ? "difficult"
            : "walkable";'''
new = '''    traversal: TraversalKind =
      natural.water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : graded
            ? "walkable"
            : natural.traversal === "difficult"
              ? "difficult"
              : "walkable";'''
if old not in text:
    raise SystemExit('final surface traversal anchor missing')
p.write_text(text.replace(old, new, 1))
