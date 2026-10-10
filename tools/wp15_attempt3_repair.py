from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor missing in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "src/hydrology.ts",
    '''  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    ridgePhase = addressed(`RIDGE/${macro.continentId}`) * Math.PI * 2,
    secondaryPhase = addressed(`RIDGE-SECONDARY/${macro.continentId}`) * Math.PI * 2,
    ridgeWave = 1 - Math.abs(Math.sin(position.lon * 401 + position.lat * 277 + ridgePhase)),
    secondary = 1 - Math.abs(Math.sin(position.lon * 233 - position.lat * 359 + secondaryPhase)),
    ridge = smooth01((ridgeWave - 0.34) / 0.66) * 0.72 + smooth01((secondary - 0.55) / 0.45) * 0.28,
    ridgeDetail = (ridge - 0.2) * Math.min(142, macro.reliefM * 0.38) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,''',
    '''  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    // Local mountain detail must not collapse into parallel sine bands. Seeded spherical
    // layers are cross-warped in absolute coordinates so the macro range still owns the
    // location/relief while local ridges fork, bend and vary without a visible stripe grid.
    warpX = (sphericalNoise(sx, z, 11 + macro.continentId) - 0.5) * 420,
    warpZ = (sphericalNoise(sx, z, 17 + macro.continentId) - 0.5) * 360,
    ridgeA = sphericalNoise(sx + warpX, z + warpZ, 71 + macro.continentId * 3),
    ridgeB = sphericalNoise(sx - warpZ * 0.55, z + warpX * 0.43, 97 + macro.continentId * 5),
    ridgeC = sphericalNoise(sx + warpZ * 0.31, z - warpX * 0.67, 131 + macro.continentId * 7),
    ridgeField = ridgeA * 0.5 + ridgeB * 0.32 + ridgeC * 0.18,
    ridge = smooth01((ridgeField - 0.34) / 0.66),
    ridgeDetail = (ridge - 0.34) * Math.min(118, macro.reliefM * 0.32) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,''',
)

replace_once(
    "tools/wp15_targets.ts",
    '''const riverPoint = riverRecipe.points[Math.min(5, riverRecipe.points.length - 2)];

const lakeRecipe = recipes.find((recipe) => recipe.lake);
if (!lakeRecipe?.lake) throw new Error("Visual evidence requires an actual seeded freshwater lake");
const lakePoint = lakeRecipe.lake;''',
    '''const riverPoint =
  riverRecipe.points[Math.min(riverRecipe.points.length - 2, Math.max(2, Math.floor(riverRecipe.points.length * 0.5)))];

// Province evidence should show a lake that is large enough to read at that level.
// Macro lakes are the same canonical water authority used by every closer level.
const macroLake = [...MACRO_PLAN.lakes].sort(
  (a, b) => b.radiusRad - a.radiusRad || (a.code < b.code ? -1 : 1),
)[0];
const lakeRecipe = recipes.find((recipe) => recipe.lake);
if (!macroLake && !lakeRecipe?.lake)
  throw new Error("Visual evidence requires an actual seeded freshwater lake");
const lakePoint = macroLake
  ? lonLatToSource(macroLake.center.lon, macroLake.center.lat)
  : lakeRecipe!.lake!;''',
)

replace_once(
    "tools/wp15_targets.ts",
    '''const mountain =
  [...MACRO_PLAN.mountainSystems]
    .filter((system) => system.path.length >= 4 && system.kind !== "volcano")
    .sort(
      (a, b) =>
        b.reliefM * b.lengthRad - a.reliefM * a.lengthRad ||
        (a.code < b.code ? -1 : 1),
    )[0] ?? [...MACRO_PLAN.mountainSystems].sort((a, b) => b.reliefM - a.reliefM)[0];
if (!mountain) throw new Error("Visual evidence requires a seeded mountain system");
const mountainTarget = mountain.path[Math.floor(mountain.path.length / 2)] ?? mountain.center;''',
    '''const mountainCandidates = MACRO_PLAN.mountainSystems
  .filter((system) => system.path.length >= 4 && system.kind !== "volcano")
  .flatMap((system) =>
    system.path.map((anchor) => {
      const macro = macroSampleAt(anchor),
        clearance = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
      return {
        system,
        anchor,
        clearance,
        score: system.reliefM * system.lengthRad * Math.min(1.5, 0.55 + clearance / 4200),
      };
    }),
  )
  .filter(({ clearance, anchor }) =>
    clearance >= 900 && macroSampleAt(anchor).land,
  )
  .sort(
    (a, b) => b.score - a.score || (a.system.code < b.system.code ? -1 : 1),
  );
const mountainTarget =
  mountainCandidates[0]?.anchor ??
  MACRO_PLAN.mountainSystems.find((system) => system.kind !== "volcano")?.center;
if (!mountainTarget) throw new Error("Visual evidence requires a seeded mountain system");''',
)
