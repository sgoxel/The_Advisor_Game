from pathlib import Path
import re
import textwrap

# Geography: canonical hydrology exists before settlement selection. Settlement cores
# and ordinary road connectors selected afterwards must remain dry.
p = Path("src/geography.ts")
text = p.read_text()
text = text.replace(
    'import { surfaceAt as naturalSurfaceAt } from "./hydrology.ts";',
    'import { freshwaterDistanceAt, surfaceAt as naturalSurfaceAt } from "./hydrology.ts";',
    1,
)
start = text.index("/**\n * Transitional settlement-site guard")
end = text.index("/**\n * Country anchors", start)
replacement = textwrap.dedent(r'''
/**
 * Settlement selection consumes canonical natural hydrology that already exists.
 * Core clearance prevents a city/village footprint from claiming river/lake water.
 */
function locallyDrySettlementSite(
  position: LonLat,
  maxReliefM: number,
  coreRadius: number,
) {
  const macro = macroSampleAt(position);
  if (!macro.land || macro.reliefM > maxReliefM) return false;
  if (macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS < Math.max(42, coreRadius)) return false;
  const { x, z } = lonLatToSource(position.lon, position.lat),
    surface = naturalSurfaceAt(x, z);
  return surface.water === "none" && !surface.cliff && surface.freshwaterDistance > coreRadius;
}

/**
 * Ordinary settlement roads have no implicit bridge authority. Candidate villages
 * are accepted only when the intended predecessor connector is provably dry.
 *
 * Distance-to-water is 1-Lipschitz: with <=96-unit sample gaps and >60 units of
 * freshwater/coast clearance at every sample, every point between samples retains
 * >12 units of clearance. This is a conservative bounded proof and avoids the old
 * thousands-of-full-surface-samples-per-candidate hot path.
 */
function naturalConnectorLegal(from: LonLat, to: LonLat) {
  const a = lonLatToSource(from.lon, from.lat),
    b = lonLatToSource(to.lon, to.lat),
    dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    length = Math.hypot(dx, dz),
    maxGap = 96,
    requiredClearance = 60,
    steps = Math.max(2, Math.ceil(length / maxGap));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      x = wrapSourceX(a.x + dx * t),
      z = a.z + dz * t,
      macro = macroSampleAt(sourceToLonLat(x, z));
    if (
      !macro.land ||
      freshwaterDistanceAt(x, z) <= requiredClearance ||
      macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS <= requiredClearance
    ) return false;
  }
  return true;
}

''')
text = text[:start] + replacement + text[end:]
text = text.replace("!locallyDrySettlementSite(candidate, 90)", "!locallyDrySettlementSite(candidate, 90, 80)", 1)
text = text.replace("!locallyDrySettlementSite(candidate, 95)", "!locallyDrySettlementSite(candidate, 95, 72)", 1)
old_owner = '''          candidate = destination(city.canonicalPosition, bearing, distanceM / CANONICAL_PLANET_RADIUS),
          owner = countryAtPosition(candidate);'''
new_owner = '''          candidate = destination(city.canonicalPosition, bearing, distanceM / CANONICAL_PLANET_RADIUS),
          owner = countryAtPosition(candidate),
          predecessor = v > 0 ? result.find((place) => place.id === `${city.id}/${v - 1}`) : undefined;'''
assert old_owner in text, "village candidate owner block not found"
text = text.replace(old_owner, new_owner, 1)
old_condition = '''          !locallyDrySettlementSite(candidate, 95, 72) ||
          accepted.some((other) => macroFeatureDistanceM(candidate, other) < 6_000)'''
new_condition = '''          !locallyDrySettlementSite(candidate, 95, 72) ||
          (predecessor && !naturalConnectorLegal(predecessor.canonicalPosition, candidate)) ||
          accepted.some((other) => macroFeatureDistanceM(candidate, other) < 6_000)'''
assert old_condition in text, "village legality condition not found"
text = text.replace(old_condition, new_condition, 1)
p.write_text(text)

# World: no inferred bridge. Roads are dry by construction. Feature footprints use
# canonical water-edge clearance instead of merely checking centre height.
p = Path("src/world.ts")
text = p.read_text()
text = text.replace(
    'import { nearestPlace, places, roadAt, roadDistanceAt } from "./geography.ts";',
    'import { nearestPlace, places, roadAt } from "./geography.ts";',
    1,
)
cell_pattern = re.compile(r'''export function cellAt\(x: number, z: number\): Cell \{.*?\n\}\n/\*\* Features are owned''', re.S)
cell_replacement = '''export function cellAt(x: number, z: number): Cell {
  const tile = tileForPosition(x, z),
    cx = Math.floor(x / CELL_SIZE),
    cz = Math.floor(z / CELL_SIZE),
    px = cx * CELL_SIZE + 1,
    pz = cz * CELL_SIZE + 1,
    surface = surfaceAt(px, pz);
  return {
    code: cellSeed(cx, cz).code,
    x: cx,
    z: cz,
    elevation: surface.elevation,
    biome: biomeAt(px, pz),
    walkable: surface.walkable,
    tile: `${tile.level}/${tile.x}/${tile.z}`,
  };
}
/** Features are owned'''
text, count = cell_pattern.subn(cell_replacement, text, count=1)
assert count == 1, "cellAt bridge block not found"
old_add = '''    if (heightAt(x, z) < 0.2) return;
    features.push({
      kind,
      x,
      z,
      y: heightAt(x, z),
      variant,
      code: `${WORLD_SEED}/${GENERATOR_VERSION}/F/${id}`,
    });'''
new_add = '''    const surface = surfaceAt(x, z),
      clearance =
        kind === "keep" ? 18 :
        kind === "field" ? 14 :
        kind === "house" ? 8 :
        kind === "tree" ? 5 : 4,
      macro = macroSampleAt(sourceToLonLat(x, z));
    if (
      surface.water !== "none" ||
      surface.cliff ||
      surface.elevation < 0.2 ||
      surface.freshwaterDistance <= clearance ||
      macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS <= clearance
    ) return;
    features.push({
      kind,
      x,
      z,
      y: surface.elevation,
      variant,
      code: `${WORLD_SEED}/${GENERATOR_VERSION}/F/${id}`,
    });'''
assert old_add in text, "world feature legality block not found"
text = text.replace(old_add, new_add, 1)
p.write_text(text)

# Foundation v5 deliberately changes all seed-addressed content.
for filename in ["tests/world.test.ts", "tests/climate.test.ts"]:
    p = Path(filename)
    text = p.read_text()
    text = text.replace('WORLD_FOUNDATION_VERSION, "v4"', 'WORLD_FOUNDATION_VERSION, "v5"')
    text = text.replace('`${WORLD_SEED}/v4/CLIMATE`', '`${WORLD_SEED}/v5/CLIMATE`')
    p.write_text(text)
