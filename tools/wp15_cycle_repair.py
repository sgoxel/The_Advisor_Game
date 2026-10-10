from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"repair anchor missing in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


# Restore the validated natural highland traversal semantics in the final composed surface.
replace_once(
    "src/surface.ts",
    '''    // A 25% natural grade is already materially difficult on foot and matches the
    // route planner's difficult-slope authority. Local road/pad earthworks remain
    // walkable because their composed grade is capped below this threshold.
    traversal: TraversalKind =
      natural.water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : slope >= 0.25
            ? "difficult"
            : "walkable";''',
    '''    // Natural difficult/highland truth survives composition. Only a real bounded
    // road/pad grade may deliberately turn difficult natural ground into walkable ground.
    traversal: TraversalKind =
      natural.water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : graded
            ? "walkable"
            : natural.traversal === "difficult"
              ? "difficult"
              : "walkable";''',
)

# Replace the stripe-prone oriented ridge waves with cross-warped spherical seed noise.
p = Path("src/hydrology.ts")
text = p.read_text()
pattern = re.compile(
    r'''  const noise = terrainNoise\(sx, z\),\n.*?    coastSource = macro\.coastDistanceRad \* SOURCE_PRESENTATION_RADIUS;''',
    re.S,
)
replacement = '''  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    // Cross-warped spherical fields fork and bend ridges without introducing a
    // source-grid axis, repeated stripe frequency, camera input or mutable RNG.
    warpX = (sphericalNoise(sx, z, 13 + macro.continentId) - 0.5) * 480,
    warpZ = (sphericalNoise(sx, z, 19 + macro.continentId) - 0.5) * 420,
    ridgeA = sphericalNoise(sx + warpX, z + warpZ, 181 + macro.continentId * 7),
    ridgeB = sphericalNoise(sx - warpZ * 0.57, z + warpX * 0.41, 263 + macro.continentId * 11),
    ridgeC = sphericalNoise(sx + warpZ * 0.29, z - warpX * 0.69, 397 + macro.continentId * 13),
    ridgeField = ridgeA * 0.5 + ridgeB * 0.32 + ridgeC * 0.18,
    ridge = smooth01((ridgeField - 0.32) / 0.68),
    ridgeDetail = (ridge - 0.32) * Math.min(132, macro.reliefM * 0.34) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    macroRelief = macro.reliefM * (0.72 + 0.22 * noise) + ridgeDetail,
    // Preserve materially tall systems while avoiding a single 600 m wall filling
    // a Province view. Height remains canonical and shared by render/traversal.
    cap = macro.domain === "Island" ? 180 : 470,
    terrain = Math.min(cap, Math.max(1.2, base + macroRelief)),
    coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"natural elevation block replacement count={count}")
p.write_text(text)

replace_once(
    "src/hydrology.ts",
    '''          : slope >= 0.42
            ? "difficult"
            : "walkable";''',
    '''          : slope >= 0.28 || core.macro.reliefM >= 50 || core.macro.mountainIntensity >= 0.04
            ? "difficult"
            : "walkable";''',
)

# Honor the established exact detail endpoints while keeping canonical vertex detail
# dominant through the Province evidence band. Smoothstep has zero derivative at both ends.
p = Path("src/surface-presentation.ts")
text = p.read_text()
pattern = re.compile(r'''export function localDetailWeight\(halfHeight: number\): number \{.*?\n\}''', re.S)
replacement = '''export function localDetailWeight(halfHeight: number): number {
  if (halfHeight <= 700) return 1;
  if (halfHeight >= 900) return 0;
  const t = Math.max(
    0,
    Math.min(1, (Math.log(halfHeight) - Math.log(700)) / Math.log(900 / 700)),
  );
  return 1 - t * t * (3 - 2 * t);
}'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"detail weight replacement count={count}")
p.write_text(text)

# Reduce triangle-by-triangle visual banding and spend extra samples only on close/rugged tiles.
replace_once(
    "src/terrain-refine.ts",
    '''    shade = Math.abs(unitY) > 0.995 ? 1 : Math.max(0.72, Math.min(1.08, 0.79 + light * 0.28)),''',
    '''    shade = Math.abs(unitY) > 0.995 ? 1 : Math.max(0.9, Math.min(1.045, 0.965 + light * 0.085)),''',
)
replace_once(
    "src/terrain-refine.ts",
    '''    sides = 16;''',
    '''    sides = 24;''',
)
replace_once(
    "src/terrain-refine.ts",
    '''  const targetResolution = tile.size <= 128 ? 56 : tile.size <= 512 ? 40 : 28,
    resolution = Math.max(1, Math.min(targetResolution, Math.floor(tile.size / 2))),
    step = tile.size / resolution,
    grid: Vertex[][] = [];''',
    '''  const center = macroSampleAt(
      sourceToLonLat(wrapSourceX(tile.minX + tile.size / 2), tile.minZ + tile.size / 2),
    ),
    rugged = center.reliefM >= 80 || center.mountainIntensity >= 0.06,
    targetResolution = tile.size <= 128 ? 68 : tile.size <= 512 ? (rugged ? 52 : 40) : rugged ? 40 : 28,
    resolution = Math.max(1, Math.min(targetResolution, Math.floor(tile.size / 2))),
    step = tile.size / resolution,
    grid: Vertex[][] = [];''',
)

print("WP15 fresh-cycle repair applied")
