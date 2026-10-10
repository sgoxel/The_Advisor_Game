from pathlib import Path

path = Path("src/world.ts")
text = path.read_text()

replacements = [
    (
        'import { nearestPlace, places, roadAt } from "./geography.ts";',
        'import { nearestPlace, places, roadAt, roadDistanceAt } from "./geography.ts";',
    ),
    (
        'smooth(Math.min(1, Math.max(0, (Math.abs(z - road.z) - 5) / 7)))',
        'smooth(Math.min(1, Math.max(0, (roadDistanceAt(x, z, road) - 5) / 7)))',
    ),
    (
        'bridge = road && Math.abs(pz - road.z) <= 5 && heightAt(px, pz) < 2.9;',
        'bridge = road && roadDistanceAt(px, pz, road) <= 5 && heightAt(px, pz) < 2.9;',
    ),
    (
        '  for (const s of places) {\n    const margin = s.kind === "city" ? 480 : 160;',
        '  // Detailed settlement realization is a focused/local presentation concern.\n'
        '  // Coarse tiles retain canonical place metadata but never instantiate every city/village layout.\n'
        '  if (tile.size <= 512)\n'
        '    for (const s of places) {\n'
        '    const margin = s.kind === "city" ? 480 : 160;',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match for {old[:80]!r}, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text)
