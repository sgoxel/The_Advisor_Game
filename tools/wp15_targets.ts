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

function dryRadialSamples(x: number, z: number, radii: readonly number[], directions: number) {
  const samples = [surfaceAt(x, z)];
  for (const radius of radii)
    for (let direction = 0; direction < directions; direction++) {
      const angle = (direction / directions) * Math.PI * 2,
        pz = z + Math.sin(angle) * radius;
      if (pz <= -SOURCE_PRESENTATION_POLE_DISTANCE || pz >= SOURCE_PRESENTATION_POLE_DISTANCE)
        continue;
      samples.push(surfaceAt(x + Math.cos(angle) * radius, pz));
    }
  return samples.filter((sample) => sample.water === "none");
}

let cliffPoint: DrainagePoint | undefined,
  cliffScore = -Infinity,
  fallbackCliffPoint: DrainagePoint | undefined,
  fallbackCliffScore = -Infinity;
const cliffRadii = [0, 24, 48, 72, 96, 128, 160, 224, 320, 448, 640] as const;
for (const mountain of MACRO_PLAN.mountainSystems) {
  for (const anchor of mountain.path) {
    const centre = lonLatToSource(anchor.lon, anchor.lat);
    for (const radius of cliffRadii) {
      const directions = radius === 0 ? 1 : 16;
      for (let direction = 0; direction < directions; direction++) {
        const angle = (direction / 16) * Math.PI * 2,
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
          baseScore = sample.slope * 150 + Math.min(1400, clearance) * 0.05 + Math.min(300, sample.elevation) * 0.08;
        if (baseScore > fallbackCliffScore) {
          fallbackCliffScore = baseScore;
          fallbackCliffPoint = { x, z, bed: sample.elevation };
        }

        const local = dryRadialSamples(x, z, [48, 96, 160, 240, 360], 12),
          localSpan = local.length
            ? Math.max(...local.map((candidate) => candidate.elevation)) - Math.min(...local.map((candidate) => candidate.elevation))
            : 0,
          cliffNeighbours = local.filter((candidate) => candidate.cliff).length,
          shoulderNeighbours = local.filter((candidate) => !candidate.cliff).length,
          closeShoulder = dryRadialSamples(x, z, [48, 96, 144], 12).some((candidate) => !candidate.cliff);
        if (localSpan < 28 || cliffNeighbours < 2 || shoulderNeighbours < 4 || !closeShoulder)
          continue;
        const score = baseScore + Math.min(220, localSpan) * 5 + Math.min(12, shoulderNeighbours) * 16;
        if (score > cliffScore) {
          cliffScore = score;
          cliffPoint = { x, z, bed: sample.elevation };
        }
      }
    }
  }
}
cliffPoint ??= fallbackCliffPoint;
if (!cliffPoint) throw new Error("Visual evidence requires a real canonical cliff sample");

const rankedVillages = [...villages]
  .map((village) => ({ village, distance: freshwaterDistanceAt(village.x, village.z) }))
  .filter(({ distance }) => Number.isFinite(distance) && distance >= 120 && distance <= 1600)
  .sort((a, b) => a.distance - b.distance || (a.village.id < b.village.id ? -1 : 1));
const village = rankedVillages[0]?.village;
if (!village) throw new Error("Visual evidence requires a village with useful canonical freshwater access");

const mountainCandidates = MACRO_PLAN.mountainSystems
  .filter((system) => system.path.length >= 4)
  .flatMap((system) =>
    system.path.map((anchor) => {
      const centre = lonLatToSource(anchor.lon, anchor.lat),
        macro = macroSampleAt(anchor),
        coast = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
        dry = dryRadialSamples(centre.x, centre.z, [280, 560, 900, 1300], 12),
        elevations = dry.map((sample) => sample.elevation),
        span = elevations.length ? Math.max(...elevations) - Math.min(...elevations) : 0,
        maximum = elevations.length ? Math.max(...elevations) : 0,
        score = span * 6 + maximum * 0.7 + macro.mountainIntensity * 1200 + Math.min(3000, Math.max(0, coast)) * 0.05;
      return { anchor, macro, coast, span, maximum, score };
    }),
  )
  .filter(
    ({ macro, coast, span, maximum }) =>
      macro.land && macro.mountainIntensity >= 0.04 && coast >= 900 && span >= 50 && maximum >= 80,
  )
  .sort((a, b) => b.score - a.score);
const mountainTarget = mountainCandidates[0]?.anchor;
if (!mountainTarget) throw new Error("Visual evidence requires a seeded mountain segment with real Province-scale relief");

const lonLat = (point: { x: number; z: number }) => sourceToLonLat(point.x, point.z);
process.stdout.write(JSON.stringify({
  river: lonLat(riverPoint),
  lake: lonLat(lakePoint),
  cliff: lonLat(cliffPoint),
  village: village.canonicalPosition,
  mountain: mountainTarget,
  outlet: lonLat(riverRecipe.points[riverRecipe.points.length - 1]),
}));
