from pathlib import Path

# Temporary branch-only exact reconciliation helper for WP-S002-004-009.
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

# Preserve canonical farm plots after the vegetation pipeline replaces generic nature geometry.
render_path = Path("src/settlement-render.ts")
render_text = render_path.read_text()
field_function = '''function renderField(tile: Tile, feature: Feature, structures: Builder, detail: Builder) {
  const { x, y, z } = localFeature(tile, feature),
    angle = feature.angle ?? 0,
    width = Math.max(8, feature.width ?? 18),
    depth = Math.max(8, feature.depth ?? 14),
    c = Math.cos(angle),
    s = Math.sin(angle);
  structures.box(x, y + 0.02, z, width, 0.12, depth, angle, [151, 128, 63]);
  if (tile.size <= 64) {
    const rows = Math.max(3, Math.min(10, Math.floor(width / 2)));
    for (let row = 0; row < rows; row++) {
      const offset = rows === 1 ? 0 : -width * 0.42 + (width * 0.84 * row) / (rows - 1),
        px = x + c * offset,
        pz = z - s * offset;
      detail.box(px, y + 0.16, pz, 0.48, 0.32, depth * 0.88, angle, [181, 154, 78]);
    }
    for (const side of [-1, 1]) {
      const localZ = side * depth / 2,
        fx = x + s * localZ,
        fz = z + c * localZ;
      detail.box(fx, y + 0.48, fz, width, 0.9, 0.14, angle, timber);
    }
  }
}

'''
marker = 'function renderBridges(tile: Tile, structures: Builder, detail: Builder) {'
if field_function not in render_text:
    if render_text.count(marker) != 1:
        raise SystemExit('settlement render bridge marker missing')
    render_text = render_text.replace(marker, field_function + marker, 1)
old_loop = '''    if (feature.kind === "house" || feature.kind === "keep") renderBuilding(tile, feature, structures, detail);
    else if (["street", "wall", "gate", "guard-post", "well"].includes(feature.kind))
      renderLinearFeature(tile, feature, structures, detail);'''
new_loop = '''    if (feature.kind === "house" || feature.kind === "keep") renderBuilding(tile, feature, structures, detail);
    else if (feature.kind === "field") renderField(tile, feature, structures, detail);
    else if (["street", "wall", "gate", "guard-post", "well"].includes(feature.kind))
      renderLinearFeature(tile, feature, structures, detail);'''
if old_loop in render_text:
    render_text = render_text.replace(old_loop, new_loop, 1)
elif new_loop not in render_text:
    raise SystemExit('settlement render feature loop missing')
render_path.write_text(render_text)

# Keep the acceptance contact-sheet generator bound to the exact source SHA without relying on a
# file created by a later workflow step. This is test infrastructure only.
acceptance = Path(".github/workflows/wp19-acceptance.yml")
accept_text = acceptance.read_text()
if 'import math\n          files =' in accept_text:
    accept_text = accept_text.replace('import math\n          files =', 'import math\n          import os\n          files =', 1)
accept_text = accept_text.replace('Path("/tmp/source-sha").read_text().strip()', 'os.environ["SOURCE_SHA"]')
acceptance.write_text(accept_text)
