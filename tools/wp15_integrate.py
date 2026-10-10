from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_slice(text: str, start: str, end: str, new: str, label: str) -> str:
    a = text.find(start)
    b = text.find(end, a + len(start))
    if a < 0 or b < 0:
        raise RuntimeError(f"{label}: markers not found")
    return text[:a] + new + text[b:]


# Make the restored hydrology module pure: it may be queried by geography siting
# without creating a geography <-> surface cycle. Settlement/road earthworks live
# in src/surface.ts, which composes this natural authority afterwards.
path = "src/hydrology.ts"
text = read(path)
text = replace_once(
    text,
    'import { nearestPlace, roadAt } from "./geography.ts";\n',
    "",
    "hydrology geography import",
)
pattern = re.compile(
    r'\n  const place = nearestPlace\(sx, z\),.*?\n  if \(hydro\.water === "none"\) elevation = lerp\(3, elevation, flatten\);',
    re.S,
)
text, count = pattern.subn("", text, count=1)
if count != 1:
    raise RuntimeError(f"hydrology earthwork block: expected one match, found {count}")
write(path, text)

# Current geography keeps all recent political-authority work, but settlement
# legality now consults the canonical natural hydrology instead of the old sine river.
path = "src/geography.ts"
text = read(path)
text = replace_once(
    text,
    'import { travelMetrics } from "./travel.ts";\n',
    'import { travelMetrics } from "./travel.ts";\nimport { surfaceAt as naturalSurfaceAt } from "./hydrology.ts";\n',
    "geography hydrology import",
)
new_guard = '''function locallyDrySettlementSite(position: LonLat, maxReliefM: number) {\n  const macro = macroSampleAt(position);\n  if (!macro.land || macro.reliefM > maxReliefM) return false;\n  if (macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS < 42) return false;\n  const { x, z } = lonLatToSource(position.lon, position.lat),\n    surface = naturalSurfaceAt(x, z);\n  return surface.water === "none" && !surface.cliff;\n}\n\n'''
text = replace_slice(
    text,
    "function locallyDrySettlementSite(",
    "/**\n * Country anchors",
    new_guard,
    "geography dry settlement guard",
)
write(path, text)

# Current world keeps recent road/political/runtime integrations and consumes the
# final composed surface for height, biome and traversal. The prototype river is removed.
path = "src/world.ts"
text = read(path)
text = replace_once(
    text,
    'import { macroSampleAt } from "./macro-geography.ts";\n',
    'import { macroSampleAt } from "./macro-geography.ts";\nimport { surfaceAt, surfaceElevationAt } from "./surface.ts";\n',
    "world surface import",
)
text = replace_once(
    text,
    '''export function riverX(z: number): number {\n  return 125 + 42 * Math.sin(z / 150) + 18 * Math.sin(z / 57);\n}\n''',
    "",
    "prototype river function",
)
world_surface = '''/** Global height comes from the shared deterministic final-surface authority. */\nexport function heightAt(x: number, z: number): number {\n  return surfaceElevationAt(x, z);\n}\nexport function biomeAt(x: number, z: number): string {\n  const macro = macroSampleAt(sourceToLonLat(x, z)),\n    surface = surfaceAt(x, z),\n    hierarchy = cellSeed(Math.floor(x / 2), Math.floor(z / 2));\n  if (surface.water === "ocean") return "Ocean";\n  if (surface.water === "lake") return "Lake";\n  if (surface.water === "river") return "River";\n  if (surface.riverBank) return "Riverbank";\n  if (macro.domain === "Island") {\n    const coast = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;\n    if (coast < hierarchy.parent.parent.beachWidth + 5 + hierarchy.surface * 0.15)\n      return "Sandy beach";\n    if (surface.cliff) return "Cliff";\n    if (macro.volcanic && macro.mountainIntensity > 0.16) return "Volcanic highlands";\n    if (macro.mountainIntensity > 0.12 || surface.elevation > 70) return "Highlands";\n    return "Island meadow";\n  }\n  const s = nearestPlace(x, z);\n  if (\n    s &&\n    Math.hypot(wrapSourceX(x - s.x), z - s.z) < (s.kind === "city" ? 420 : 84)\n  )\n    return "Settlement";\n  if (roadAt(x, z)) return "Road";\n  if (surface.cliff) return "Cliff";\n  if (macro.volcanic && macro.mountainIntensity > 0.16) return "Volcanic highlands";\n  if (macro.mountainIntensity > 0.1 || surface.elevation > 70) return "Highlands";\n  return field(x, z, 90, 4) > 0.45 ? "Woodland" : "Meadow";\n}\n\n'''
text = replace_slice(
    text,
    "/** Global height:",
    "/**\n * Transitional equirectangular",
    world_surface,
    "world height/biome authority",
)
cell = '''export function cellAt(x: number, z: number): Cell {\n  const tile = tileForPosition(x, z),\n    cx = Math.floor(x / CELL_SIZE),\n    cz = Math.floor(z / CELL_SIZE),\n    px = cx * CELL_SIZE + 1,\n    pz = cz * CELL_SIZE + 1,\n    surface = surfaceAt(px, pz),\n    road = roadAt(px, pz),\n    bridge = Boolean(road && roadDistanceAt(px, pz, road) <= 5 && surface.water !== "none"),\n    elevation = bridge ? Math.max(3, surface.elevation + 1.5) : surface.elevation,\n    biome = bridge ? "Bridge" : biomeAt(px, pz);\n  return {\n    code: cellSeed(cx, cz).code,\n    x: cx,\n    z: cz,\n    elevation,\n    biome,\n    walkable: bridge || surface.walkable,\n    tile: `${tile.level}/${tile.x}/${tile.z}`,\n  };\n}\n'''
text = replace_slice(
    text,
    "export function cellAt(",
    "/** Features are owned",
    cell,
    "world cell traversal",
)
write(path, text)

# Terrain tint no longer paints a second, sine-derived river. Coarse terrain and
# refined local terrain both read the same surface classification.
path = "src/geometry.ts"
text = read(path)
text = replace_once(
    text,
    'import { featuresFor, field, heightAt, riverX, type Tile } from "./world.ts";\n',
    'import { featuresFor, field, heightAt, type Tile } from "./world.ts";\n',
    "geometry world import",
)
text = replace_once(
    text,
    'import { sourceToLonLat, wrapSourceX, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";\n',
    'import { sourceToLonLat, wrapSourceX, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";\nimport { surfaceAt } from "./surface.ts";\n',
    "geometry surface import",
)
old = '''  // Current composed river surface; avoid constructing the unrelated five-level\n  // feature hierarchy for every surface texel. Same prototype river authority.\n  if (macro.domain === "Mainland" && elevation < 0.1) return color(76, 128, 148);\n  if (macro.domain === "Mainland" && Math.abs(wrapSourceX(x - riverX(z))) < 32)\n    return color(151, 143, 99);\n'''
new = '''  const composedSurface = surfaceAt(x, z);\n  if (composedSurface.water === "river") return color(76, 128, 148);\n  if (composedSurface.riverBank) return color(151, 143, 99);\n'''
text = replace_once(text, old, new, "geometry prototype river tint")
write(path, text)

# Refine the current worker terrain before applying the already-landed bounded
# vegetation batch; do not restore the older per-feature nature path.
path = "src/tile-worker.ts"
text = read(path)
text = replace_once(
    text,
    'import { convertTileGeometryToEnu } from "./render-frame.ts";\n',
    'import { convertTileGeometryToEnu } from "./render-frame.ts";\nimport { refineTerrainGeometry } from "./terrain-refine.ts";\n',
    "tile worker refine import",
)
text = replace_once(
    text,
    '''    const data = buildTile(tile),\n      vegetation = buildVegetationGeometry(tile);\n    data.nature = vegetation.geometry;\n''',
    '''    const data = buildTile(tile),\n      vegetation = buildVegetationGeometry(tile);\n    data.terrain = refineTerrainGeometry(tile, data.terrain);\n    data.nature = vegetation.geometry;\n''',
    "tile worker refine call",
)
write(path, text)

# Keep every existing test routine and add the two WP15 suites.
path = "package.json"
text = read(path)
text = replace_once(
    text,
    'tests/world.test.ts tests/macro-geography.test.ts',
    'tests/world.test.ts tests/hydrology.test.ts tests/terrain-refine.test.ts tests/macro-geography.test.ts',
    "package WP15 tests",
)
write(path, text)

print("WP-S002-004-005 integration patch applied")
