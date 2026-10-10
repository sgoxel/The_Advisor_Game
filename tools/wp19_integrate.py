from pathlib import Path

# Temporary branch-only exact reconciliation helper for WP-S002-004-009.
# Re-triggered after the final interior/presentation regression additions so the patch
# runs against the exact branch head that will enter acceptance.
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
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        text = text.replace(old, new, 1)
    elif old_count == 0 and new_count == 1:
        continue
    else:
        raise SystemExit(f"unexpected reconciliation counts old={old_count} new={new_count} for {old[:80]!r}")

path.write_text(text)

# Keep the acceptance contact-sheet generator bound to the exact source SHA without relying on a
# file created by a later workflow step. This is test infrastructure only.
acceptance = Path(".github/workflows/wp19-acceptance.yml")
accept_text = acceptance.read_text()
if 'import math\n          files =' in accept_text:
    accept_text = accept_text.replace('import math\n          files =', 'import math\n          import os\n          files =', 1)
accept_text = accept_text.replace('Path("/tmp/source-sha").read_text().strip()', 'os.environ["SOURCE_SHA"]')
acceptance.write_text(accept_text)
