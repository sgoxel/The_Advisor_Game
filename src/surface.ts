import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import {
  surfaceAt as hydrologySurfaceAt,
  type SurfaceSample,
  type TraversalKind,
} from "./hydrology.ts";

export {
  drainageLakeRadiusAt,
  drainageRecipeAt,
  drainageRecipesNear,
  freshwaterDistanceAt,
  hydrologyDiagnostics,
  naturalElevationAt,
} from "./hydrology.ts";
export type {
  DrainageLake,
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

function roadGradeAt(
  x: number,
  z: number,
  road: NonNullable<ReturnType<typeof roadAt>>,
) {
  const px = road.fromX + wrapSourceX(x - road.fromX),
    vx = road.toX - road.fromX,
    vz = road.toZ - road.fromZ,
    lengthSq = vx * vx + vz * vz,
    t =
      lengthSq <= 1e-9
        ? 0
        : clamp01(((px - road.fromX) * vx + (z - road.fromZ) * vz) / lengthSq),
    fromHeight = Math.max(1.2, hydrologySurfaceAt(road.fromX, road.fromZ).elevation),
    toHeight = Math.max(1.2, hydrologySurfaceAt(road.toX, road.toZ).elevation);
  return lerp(fromHeight, toHeight, t);
}

function earthworkAt(x: number, z: number) {
  const place = nearestPlace(x, z),
    placeDistance = place
      ? Math.hypot(wrapSourceX(x - place.x), z - place.z)
      : Infinity,
    placeRadius = place?.kind === "city" ? 430 : 90,
    placeBlend = place ? smooth01((placeDistance - placeRadius) / 80) : 1,
    placeHeight = place
      ? Math.max(1.2, hydrologySurfaceAt(place.x, place.z).elevation)
      : 0,
    road = roadAt(x, z),
    roadDistance = road ? roadDistanceAt(x, z, road) : Infinity,
    roadBlend = road ? smooth01((roadDistance - 5) / 7) : 1,
    roadHeight = road ? roadGradeAt(x, z, road) : 0;

  if (road && roadBlend <= placeBlend)
    return { blend: roadBlend, target: roadHeight } as const;
  if (place) return { blend: placeBlend, target: placeHeight } as const;
  return { blend: 1, target: 0 } as const;
}

/**
 * Final-surface composition never erases authoritative hydrology. Settlements and
 * ordinary roads must already occupy legal dry ground; explicit bridge/ford facts
 * belong to the transport authority. Earthworks therefore grade only dry terrain.
 */
export function surfaceElevationAt(x: number, z: number) {
  const natural = hydrologySurfaceAt(x, z);
  if (natural.water !== "none") return natural.elevation;
  const earthwork = earthworkAt(x, z);
  return lerp(earthwork.target, natural.elevation, earthwork.blend);
}

/** One canonical final-surface query for render height, collision and walkability. */
export function surfaceAt(x: number, z: number): SurfaceSample {
  const natural = hydrologySurfaceAt(x, z);
  if (natural.water !== "none") return natural;

  const earthwork = earthworkAt(x, z),
    graded = earthwork.blend < 0.999,
    elevation = graded
      ? lerp(earthwork.target, natural.elevation, earthwork.blend)
      : natural.elevation,
    slope = graded ? Math.min(natural.slope, 0.2) : natural.slope,
    cliff = !graded && natural.cliff,
    traversal: TraversalKind = cliff
      ? "blocked-cliff"
      : graded
        ? "walkable"
        : natural.traversal === "difficult"
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
