import { villages } from "../src/geography.ts";
import { MACRO_PLAN } from "../src/macro-geography.ts";
import { sourceToLonLat, lonLatToSource } from "../src/planet.ts";
import {
  drainageRecipeAt,
  freshwaterDistanceAt,
  hydrologyDiagnostics,
  surfaceAt,
  type DrainageRecipe,
} from "../src/surface.ts";

const recipes: DrainageRecipe[] = [];
for (let z = 0; z < hydrologyDiagnostics.basinRows; z++)
  for (let x = 0; x < hydrologyDiagnostics.basinColumns; x++) {
    const recipe = drainageRecipeAt(x, z);
    if (recipe) recipes.push(recipe);
  }
if (!recipes.length) throw new Error("No hydrology recipes generated");

const riverRecipe = recipes.find((r) => r.tributary.length >= 4) || recipes[0],
  riverPoint = riverRecipe.points[Math.min(5, riverRecipe.points.length - 2)],
  lakeRecipe = recipes.find((r) => r.lake),
  lakePoint = lakeRecipe?.lake || riverPoint;

let cliffPoint = riverPoint;
outer: for (const mountain of MACRO_PLAN.mountainSystems) {
  for (const anchor of mountain.path) {
    const p = lonLatToSource(anchor.lon, anchor.lat);
    for (const [dx, dz] of [[-42, 0], [42, 0], [0, -42], [0, 42], [56, 28], [-56, -28]] as const) {
      if (surfaceAt(p.x + dx, p.z + dz).cliff) {
        cliffPoint = { x: p.x + dx, z: p.z + dz, bed: surfaceAt(p.x + dx, p.z + dz).elevation };
        break outer;
      }
    }
  }
}

// Evidence must show a settlement that has useful freshwater access without
// intentionally framing a building footprint on top of the water corridor.
const rankedVillages = [...villages]
  .map((village) => ({ village, distance: freshwaterDistanceAt(village.x, village.z) }))
  .filter(({ distance }) => Number.isFinite(distance) && distance >= 120 && distance <= 1200)
  .sort((a, b) => a.distance - b.distance);
const village = rankedVillages[0]?.village || [...villages].sort(
  (a, b) => freshwaterDistanceAt(a.x, a.z) - freshwaterDistanceAt(b.x, b.z),
)[0];
const mountain = [...MACRO_PLAN.mountainSystems].sort((a, b) => b.reliefM - a.reliefM)[0];

const lonLat = (p: { x: number; z: number }) => sourceToLonLat(p.x, p.z);
process.stdout.write(JSON.stringify({
  river: lonLat(riverPoint),
  lake: lonLat(lakePoint),
  cliff: lonLat(cliffPoint),
  village: village.canonicalPosition,
  mountain: mountain.center,
  outlet: lonLat(riverRecipe.points[riverRecipe.points.length - 1]),
}));