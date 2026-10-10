import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import {
  surfaceAt as hydrologySurfaceAt,
  surfaceElevationAt as hydrologyElevationAt,
  type SurfaceSample,
  type TraversalKind,
} from "./hydrology.ts";

export {
  drainageRecipeAt,
  drainageRecipesNear,
  freshwaterDistanceAt,
  hydrologyDiagnostics,
  naturalElevationAt,
} from "./hydrology.ts";
export type {
  DrainagePoint,
  DrainageRecipe,
  SurfaceSample,
  TraversalKind,
  WaterKind,
} from "./hydrology.ts";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Priority-6/8 local earthwork blend over the natural priority-0..4 surface. */
function earthworkAt(x: number, z: number) {
  const place = nearestPlace(x, z),
    placeDistance = place ? Math.hypot(wrapSourceX(x - place.x), z - place.z) : Infinity,
    placeRadius = place?.kind === "city" ? 430 : 90,
    placeBlend = place
      ? smooth01((placeDistance - placeRadius) / 80)
      : 1,
    road = roadAt(x, z),
    roadDistance = road ? roadDistanceAt(x, z, road) : Infinity,
    roadBlend = road ? smooth01((roadDistance - 5) / 7) : 1,
    blend = Math.min(placeBlend, roadBlend);
  return { blend, place, road } as const;
}

/**
 * Final composed height used by local terrain and all logical traversal callers.
 * Natural water is never flattened away by settlement/road presentation; legal
 * road-water crossings remain explicit bridge cells in world.cellAt().
 */
export function surfaceElevationAt(x: number, z: number) {
  const natural = hydrologySurfaceAt(x, z);
  if (natural.water !== "none") return natural.elevation;
  const earthwork = earthworkAt(x, z);
  return lerp(3, natural.elevation, earthwork.blend);
}

/** One canonical final-surface query for render height, collision and walkability. */
export function surfaceAt(x: number, z: number): SurfaceSample {
  const natural = hydrologySurfaceAt(x, z),
    earthwork = natural.water === "none" ? earthworkAt(x, z) : null,
    graded = Boolean(earthwork && earthwork.blend < 0.999),
    elevation = natural.water === "none"
      ? lerp(3, natural.elevation, earthwork?.blend ?? 1)
      : hydrologyElevationAt(x, z),
    slope = graded ? Math.min(natural.slope, 0.2) : natural.slope,
    cliff = natural.water === "none" && !graded && natural.cliff,
    traversal: TraversalKind =
      natural.water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : slope >= 0.42
            ? "difficult"
            : "walkable";
  return {
    ...natural,
    elevation,
    slope,
    cliff,
    traversal,
    walkable: traversal === "walkable" || traversal === "difficult",
  };
}
