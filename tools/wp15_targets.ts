import { villages } from "../src/geography.ts";
import { MACRO_PLAN, macroSampleAt } from "../src/macro-geography.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_RADIUS,
  sourceToLonLat,
  lonLatToSource,
} from "../src/planet.ts";
import {
  drainageRecipeAt,
  freshwaterDistanceAt,
  hydrologyDiagnostics,
  surfaceAt,
  type DrainagePoint,
  type DrainageRecipe,
} from "../src/surface.ts";

const recipes: DrainageRecipe[] = [];
for (let z = 0; z < hydrologyDiagnostics.basinRows; z++)
  for (let x = 0; x < hydrologyDiagnostics.basinColumns; x++) {
    const recipe = drainageRecipeAt(x, z);
    if (recipe) recipes.push(recipe);
  }
if (!recipes.length) throw new Error("No hydrology recipes generated");

const riverRecipe = recipes.find((recipe) => recipe.tributary.length >= 4);
if (!riverRecipe) throw new Error("Visual evidence requires a seeded river with a tributary");
const riverPoint =
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
  : lakeRecipe!.lake!;

let cliffPoint: DrainagePoint | undefined,
  cliffClearance = -Infinity;
const cliffRadii = [0, 24, 48, 72, 96, 128, 160, 224, 320, 448, 640] as const;
const cliffDirections = 16;
for (const mountain of MACRO_PLAN.mountainSystems) {
  for (const anchor of mountain.path) {
    const centre = lonLatToSource(anchor.lon, anchor.lat);
    for (const radius of cliffRadii) {
      const directions = radius === 0 ? 1 : cliffDirections;
      for (let direction = 0; direction < directions; direction++) {
        const angle = (direction / cliffDirections) * Math.PI * 2,
          x = centre.x + Math.cos(angle) * radius,
          z = centre.z + Math.sin(angle) * radius;
        if (z <= -SOURCE_PRESENTATION_POLE_DISTANCE || z >= SOURCE_PRESENTATION_POLE_DISTANCE)
          continue;
        const sample = surfaceAt(x, z),
          macro = macroSampleAt(sourceToLonLat(x, z));
        if (!sample.cliff || sample.water !== "none" || !macro.land) continue;
        const clearance = Math.min(
          macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
          sample.freshwaterDistance,
        );
        if (clearance > cliffClearance) {
          cliffClearance = clearance;
          cliffPoint = { x, z, bed: sample.elevation };
        }
      }
    }
  }
}
if (!cliffPoint) throw new Error("Visual evidence requires a real canonical cliff sample");

// Evidence must show a settlement that has useful freshwater access without
// intentionally framing a building footprint on top of the water corridor.
const rankedVillages = [...villages]
  .map((village) => ({ village, distance: freshwaterDistanceAt(village.x, village.z) }))
  .filter(({ distance }) => Number.isFinite(distance) && distance >= 120 && distance <= 1200)
  .sort((a, b) => a.distance - b.distance || (a.village.id < b.village.id ? -1 : 1));
const village = rankedVillages[0]?.village;
if (!village) throw new Error("Visual evidence requires a village with useful canonical freshwater access");

const mountainCandidates = MACRO_PLAN.mountainSystems
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
if (!mountainTarget) throw new Error("Visual evidence requires a seeded mountain system");

const lonLat = (point: { x: number; z: number }) => sourceToLonLat(point.x, point.z);
process.stdout.write(JSON.stringify({
  river: lonLat(riverPoint),
  lake: lonLat(lakePoint),
  cliff: lonLat(cliffPoint),
  village: village.canonicalPosition,
  mountain: mountainTarget,
  outlet: lonLat(riverRecipe.points[riverRecipe.points.length - 1]),
}));
