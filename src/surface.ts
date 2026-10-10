import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import {
  surfaceAt as hydrologySurfaceAt,
  surfaceElevationAt as hydrologyElevationAt,
  type SurfaceSample,
  type TraversalKind,
} from "./hydrology.ts";

export {
  drainageLakeRadiusAt,
  drainageRecipeAt,
  drainageRecipesNear,
  drainageRiverWidthAt,
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
    return { blend: roadBlend, target: roadHeight, place, road } as const;
  if (place)
    return { blend: placeBlend, target: placeHeight, place, road } as const;
  return { blend: 1, target: 0, place, road } as const;
}

/**
 * Bounded final-surface earthworks may bridge/culvert a local river (or a local
 * drainage lake beneath an actual road), but never rewrite ocean or macro-lake
 * ownership. This keeps the completed political foundation intact while giving
 * rendering, collision and routing one composed surface truth.
 */
function earthworkDisplacesLocalWater(
  natural: SurfaceSample,
  earthwork: ReturnType<typeof earthworkAt>,
) {
  if (earthwork.blend >= 0.999) return false;
  if (natural.water === "river") return Boolean(earthwork.road || earthwork.place);
  if (natural.water === "lake" && natural.catchmentCode)
    return Boolean(earthwork.road);
  return false;
}

export function surfaceElevationAt(x: number, z: number) {
  const natural = hydrologySurfaceAt(x, z),
    earthwork = earthworkAt(x, z),
    displaced = earthworkDisplacesLocalWater(natural, earthwork);
  if (natural.water !== "none" && !displaced) return natural.elevation;
  return lerp(earthwork.target, natural.elevation, earthwork.blend);
}

/** One canonical final-surface query for render height, collision and walkability. */
export function surfaceAt(x: number, z: number): SurfaceSample {
  const natural = hydrologySurfaceAt(x, z),
    earthwork = earthworkAt(x, z),
    displaced = earthworkDisplacesLocalWater(natural, earthwork),
    water = displaced ? "none" : natural.water,
    graded = earthwork.blend < 0.999 && water === "none",
    elevation = graded
      ? lerp(earthwork.target, natural.elevation, earthwork.blend)
      : water === "none"
        ? natural.elevation
        : hydrologyElevationAt(x, z),
    slope = graded ? Math.min(natural.slope, 0.2) : natural.slope,
    cliff = water === "none" && !graded && natural.cliff,
    traversal: TraversalKind =
      water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : graded
            ? "walkable"
            : natural.traversal === "difficult"
              ? "difficult"
              : "walkable";
  return {
    ...natural,
    water,
    elevation,
    slope,
    cliff,
    traversal,
    walkable: traversal === "walkable" || traversal === "difficult",
  };
}
