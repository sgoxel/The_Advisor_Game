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
const riverPoint = riverRecipe.points[Math.min(5, riverRecipe.points.length - 2)];

const lakeRecipe = recipes.find((recipe) => recipe.lake);
if (!lakeRecipe?.lake) throw new Error("Visual evidence requires an actual seeded freshwater lake");
const lakePoint = lakeRecipe.lake;

let cliffPoint: DrainagePoint | undefined,
  cliffScore = -Infinity;
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
        if (!sample.cliff || sample.water !== "none" || !macro.land || sample.elevation < 28)
          continue;
        const clearance = Math.min(
            macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
            sample.freshwaterDistance,
          ),
          score = sample.slope * 220 + Math.min(1200, clearance) * 0.08 + Math.min(260, sample.elevation) * 0.05;
        if (score > cliffScore) {
          cliffScore = score;
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
  .filter(
    (system) =>
      system.path.length >= 4 &&
      (system.kind === "long-chain" ||
        system.kind === "hooked-range" ||
        system.kind === "dominant-spine" ||
        system.kind === "compact-massif"),
  )
  .flatMap((system) =>
    system.path.map((anchor) => {
      const macro = macroSampleAt(anchor),
        coast = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
        score =
          system.reliefM * (0.7 + macro.mountainIntensity) +
          Math.min(3000, Math.max(0, coast)) * 0.09 -
          system.widthRad * 180;
      return { anchor, macro, coast, score };
    }),
  )
  .filter(
    ({ macro, coast }) =>
      macro.land && macro.mountainIntensity >= 0.045 && coast >= 900,
  )
  .sort((a, b) => b.score - a.score);
const mountainTarget = mountainCandidates[0]?.anchor;
if (!mountainTarget) throw new Error("Visual evidence requires an inland seeded mountain range segment");

const lonLat = (point: { x: number; z: number }) => sourceToLonLat(point.x, point.z);
process.stdout.write(JSON.stringify({
  river: lonLat(riverPoint),
  lake: lonLat(lakePoint),
  cliff: lonLat(cliffPoint),
  village: village.canonicalPosition,
  mountain: mountainTarget,
  outlet: lonLat(riverRecipe.points[riverRecipe.points.length - 1]),
}));
