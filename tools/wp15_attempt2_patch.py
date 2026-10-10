from pathlib import Path
import re


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing patch anchor in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, count))


# ---- hydrology: broad seeded structure, organic water geometry, bounded exact queries ----
replace(
    "src/hydrology.ts",
    "    irregular =\n      1 +\n      0.13 * Math.sin(angle * 3 + lake.phase) +\n      0.075 * Math.sin(angle * 5 - lake.phase * 0.61) +\n      0.045 * Math.cos(angle * 7 + lake.phase * 1.37);\n  return Math.max(lake.radius * 0.64, ellipse * irregular);",
    "    irregular =\n      1 +\n      0.14 * Math.cos(angle + lake.phase * 0.37) +\n      0.1 * Math.sin(angle * 2 - lake.phase * 0.61) +\n      0.075 * Math.sin(angle * 3 + lake.phase) +\n      0.045 * Math.cos(angle * 5 + lake.phase * 1.37);\n  return Math.max(lake.radius * 0.58, ellipse * irregular);",
)
replace(
    "src/hydrology.ts",
    "  return base * growth * variation;\n}\nconst sphericalPhaseCache",
    """  return base * growth * variation;
}

type RecipeBounds = {
  anchorX: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};
const recipeBoundsCache = new WeakMap<DrainageRecipe, RecipeBounds>();
function drainageRecipeBounds(recipe: DrainageRecipe): RecipeBounds {
  const cached = recipeBoundsCache.get(recipe);
  if (cached) return cached;
  const anchorX = recipe.points[0]?.x ?? 0;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const include = (x: number, z: number, margin: number) => {
    const ux = anchorX + wrapSourceX(x - anchorX);
    minX = Math.min(minX, ux - margin);
    maxX = Math.max(maxX, ux + margin);
    minZ = Math.min(minZ, z - margin);
    maxZ = Math.max(maxZ, z + margin);
  };
  for (const point of recipe.points) include(point.x, point.z, recipe.width * 1.65 + 24);
  for (const point of recipe.tributary) include(point.x, point.z, recipe.width * 0.95 + 24);
  if (recipe.lake) {
    const radius = recipe.lake.radius * (1 + recipe.lake.elongation + 0.3) + 24;
    include(recipe.lake.x, recipe.lake.z, radius);
  }
  const bounds = { anchorX, minX, maxX, minZ, maxZ };
  recipeBoundsCache.set(recipe, bounds);
  return bounds;
}
function distanceToRecipeBounds(x: number, z: number, bounds: RecipeBounds) {
  const ux = bounds.anchorX + wrapSourceX(x - bounds.anchorX),
    dx = ux < bounds.minX ? bounds.minX - ux : ux > bounds.maxX ? ux - bounds.maxX : 0,
    dz = z < bounds.minZ ? bounds.minZ - z : z > bounds.maxZ ? z - bounds.maxZ : 0;
  return Math.hypot(dx, dz);
}
const sphericalPhaseCache""",
)
replace(
    "src/hydrology.ts",
    """    terms = [
      Math.sin(lon * 227 + lat * 281 + phase[0]) * 0.28,
      Math.cos(lon * 389 - lat * 313 + phase[1]) * 0.22,
      Math.sin(lon * 653 + lat * 509 + phase[2]) * 0.18,
      Math.cos(lon * 997 - lat * 761 + phase[3]) * 0.14,
      Math.sin(lon * 1543 + lat * 1187 + phase[4]) * 0.11,
      Math.cos(lon * 2381 - lat * 1801 + phase[5]) * 0.07,
    ];""",
    """    terms = [
      Math.sin(lon * 181 + lat * 233 + phase[0]) * 0.36,
      Math.cos(lon * 307 - lat * 251 + phase[1]) * 0.27,
      Math.sin(lon * 487 + lat * 373 + phase[2]) * 0.19,
      Math.cos(lon * 701 - lat * 557 + phase[3]) * 0.12,
      Math.sin(lon * 947 + lat * 719 + phase[4]) * 0.06,
    ];""",
)
replace(
    "src/hydrology.ts",
    "  return terms.reduce((sum, value) => sum + value, 0);\n}\n\n/**\n * Canonical natural terrain.",
    """  return terms.reduce((sum, value) => sum + value, 0);
}
function mountainStructureNoise(x: number, z: number, continentId: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = fineReliefPhases(continentId),
    warpLon = Math.sin(p.lon * 23 + p.lat * 19 + phase[4]) * 0.009,
    warpLat = Math.cos(p.lon * 29 - p.lat * 17 + phase[5]) * 0.008,
    lon = p.lon + warpLon,
    lat = p.lat + warpLat,
    value =
      Math.sin(lon * 41 + lat * 57 + phase[0]) * 0.46 +
      Math.cos(lon * 67 - lat * 43 + phase[1]) * 0.34 +
      Math.sin(lon * 103 + lat * 79 + phase[2]) * 0.2;
  return Math.max(0, Math.min(1, (value + 1) * 0.5));
}

/**
 * Canonical natural terrain.""",
)
replace(
    "src/hydrology.ts",
    """  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    fine = fineReliefNoise(sx, z, macro.continentId),
    // Macro authority decides where/which mountain exists; this continuous spectrum
    // breaks its wide footprint into local shoulders, gullies and ridges at Province scale.
    localRelief = fine * Math.min(138, macro.reliefM * 0.27) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    rawRelief = Math.max(0, macro.reliefM * (0.54 + 0.2 * noise) + localRelief),""",
    """  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    structure = mountainStructureNoise(sx, z, macro.continentId),
    fine = fineReliefNoise(sx, z, macro.continentId),
    // Macro authority owns mountain identity; a lower-frequency seeded structure
    // carves shoulders and valleys before a restrained local spectrum adds detail.
    structureFactor = lerp(1, 0.58 + structure * 0.82, mountainWeight),
    localRelief = fine * Math.min(72, macro.reliefM * 0.15) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    rawRelief = Math.max(
      0,
      macro.reliefM * (0.52 + 0.16 * noise) * structureFactor + localRelief,
    ),""",
)
replace(
    "src/hydrology.ts",
    """  const phase = addressed(`${key}/meander-phase`) * Math.PI * 2,
    amplitude = 0.145 + addressed(`${key}/meander-amplitude`) * 0.12;
  return (
    Math.sin(step * 0.31 + phase) * amplitude +
    Math.sin(step * 0.13 + phase * 1.73) * amplitude * 0.52
  );""",
    """  const phase = addressed(`${key}/meander-phase`) * Math.PI * 2,
    amplitude = 0.17 + addressed(`${key}/meander-amplitude`) * 0.11;
  return (
    Math.sin(step * 0.21 + phase) * amplitude +
    Math.sin(step * 0.08 + phase * 1.73) * amplitude * 0.46 +
    Math.sin(step * 0.39 - phase * 0.57) * amplitude * 0.18
  );""",
)
replace("src/hydrology.ts", "direction = blendDirection(direction, flowTarget(current.x, current.z, continentId), 0.52);", "direction = blendDirection(direction, flowTarget(current.x, current.z, continentId), 0.48);")
replace("src/hydrology.ts", "direction = rotateDirection(direction, riverMeander(key, RIVER_STEPS + extra) * 0.42);", "direction = rotateDirection(direction, riverMeander(key, RIVER_STEPS + extra) * 0.55);")
replace("src/hydrology.ts", "      width = 11 + addressed(`${key}/width`) * 12;", "      width = 7 + addressed(`${key}/width`) * 9;")
replace("src/hydrology.ts", "      direction = blendDirection(direction, flowTarget(x, z, macro.continentId), 0.4);", "      direction = blendDirection(direction, flowTarget(x, z, macro.continentId), 0.36);")
replace("src/hydrology.ts", "                elongation: 0.11 + addressed(`${key}/lake-elongation`) * 0.17,", "                elongation: 0.22 + addressed(`${key}/lake-elongation`) * 0.2,")

p = Path("src/hydrology.ts")
text = p.read_text()
pattern = re.compile(r"function nearestHydrology\(x: number, z: number\): HydroHit \{.*?\n\}\n\nfunction cachePrepared", re.S)
replacement = '''function nearestHydrology(x: number, z: number): HydroHit {
  queryCount++;
  const canonicalX = wrapSourceX(x),
    gx = Math.floor((canonicalX + SOURCE_PRESENTATION_WIDTH / 2) / BASIN_SIZE),
    gz = Math.floor((z + SOURCE_PRESENTATION_POLE_DISTANCE) / BASIN_SIZE),
    candidates: { recipe: DrainageRecipe; lowerBound: number }[] = [];
  let best: HydroHit = {
    water: "none",
    bank: false,
    distance: Infinity,
    bed: naturalElevationAt(canonicalX, z),
    code: null,
  };

  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      const recipe = drainageRecipeAt(gx + dx, gz + dz);
      if (!recipe) continue;
      const bounds = drainageRecipeBounds(recipe);
      candidates.push({ recipe, lowerBound: distanceToRecipeBounds(canonicalX, z, bounds) });
    }
  }
  candidates.sort((a, b) => a.lowerBound - b.lowerBound || a.recipe.code.localeCompare(b.recipe.code));

  for (const { recipe, lowerBound } of candidates) {
    if (lowerBound > Math.max(0, best.distance)) break;
    if (recipe.lake) {
      const lakeDx = wrapSourceX(canonicalX - recipe.lake.x),
        lakeDz = z - recipe.lake.z,
        shoreRadius = drainageLakeRadiusAt(recipe.lake, Math.atan2(lakeDz, lakeDx)),
        distance = Math.hypot(lakeDx, lakeDz) - shoreRadius;
      if (distance < best.distance)
        best = {
          water: distance <= 0 ? "lake" : "none",
          bank: distance > 0 && distance <= 24,
          distance,
          bed: recipe.lake.level,
          code: recipe.code,
        };
    }
    for (const [pathIndex, path] of [recipe.points, recipe.tributary].entries()) {
      for (let i = 0; i < path.length - 1; i++) {
        const hit = pointDistanceToSegment(canonicalX, z, path[i], path[i + 1]),
          width = drainageRiverWidthAt(recipe, i, pathIndex === 1),
          distance = hit.distance - width,
          bed = lerp(path[i].bed, path[i + 1].bed, hit.t);
        if (distance < best.distance)
          best = {
            water: distance <= 0 ? "river" : "none",
            bank: distance > 0 && distance <= 18,
            distance,
            bed,
            code: recipe.code,
          };
      }
    }
  }
  return best;
}

function cachePrepared'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit("nearestHydrology replacement failed")
p.write_text(text)

# ---- local mesh: spend triangles only where silhouettes need them ----
replace("src/terrain-runtime.ts", "  for (let i = 0; i < 8; i++) {", "  for (let i = 0; i < 6; i++) {")
replace(
    "src/terrain-runtime.ts",
    """  if (tile.size <= 32) target = coastal || rugged ? 32 : 18;
  else if (tile.size <= 64) target = coastal || rugged ? 40 : 26;
  else if (tile.size <= 128) target = coastal || rugged ? 48 : 32;
  else if (tile.size <= 256) target = coastal || rugged ? 56 : 38;
  else target = coastal || rugged ? 48 : 30;""",
    """  if (tile.size <= 32) target = coastal ? 36 : rugged ? 30 : 18;
  else if (tile.size <= 64) target = coastal ? 48 : rugged ? 40 : 26;
  else if (tile.size <= 128) target = coastal ? 64 : rugged ? 48 : 32;
  else if (tile.size <= 256) target = coastal ? 80 : rugged ? 56 : 38;
  else target = coastal ? 80 : rugged ? 44 : 30;""",
)

# ---- material presentation: narrower beach band, exposed canonical cliffs ----
replace(
    "src/geometry.ts",
    "    coastWeight = (1 - smoothstep(35, 190, coastDistance)) * (1 - smoothstep(0.5, 0.72, sample.ruggedness)),",
    "    coastWeight = (1 - smoothstep(18, 90, coastDistance)) * (1 - smoothstep(0.5, 0.72, sample.ruggedness)),",
)
replace("src/geometry.ts", "  base = blendColor(base, TERRAIN_PALETTE.beach, coastWeight * 0.92);", "  base = blendColor(base, TERRAIN_PALETTE.beach, coastWeight * 0.82);")
replace(
    "src/terrain-polish.ts",
    """    rockWeight = Math.min(
      0.42,
      steep * (close ? 0.25 : 0.12) +
        highland * (close ? 0.06 : 0.035) +
        (surface.cliff ? (close ? 0.12 : 0.04) : 0),
    ),""",
    """    rockWeight = Math.min(
      0.72,
      steep * (close ? 0.25 : 0.12) +
        highland * (close ? 0.06 : 0.035) +
        (surface.cliff ? (close ? 0.58 : 0.26) : 0),
    ),""",
)
replace(
    "src/terrain-polish.ts",
    """      tileSize <= 32 ? 0.86 :
      tileSize <= 64 ? 0.76 :
      tileSize <= 128 ? 0.46 : 0.22,""",
    """      tileSize <= 32 ? 0.96 :
      tileSize <= 64 ? 0.82 :
      tileSize <= 128 ? 0.46 : 0.22,""",
)

# Make canonical hydrology/final-surface tests part of every acceptance run.
replace(
    "package.json",
    "tests/world.test.ts tests/macro-geography.test.ts",
    "tests/world.test.ts tests/hydrology.test.ts tests/surface-authority.test.ts tests/macro-geography.test.ts",
)
