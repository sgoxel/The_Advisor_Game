import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import {
  naturalElevationAt as naturalElevationBaseAt,
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
const STRUCTURAL_FILTER_STEP = 22;
const FINAL_CLIFF_SLOPE = 1.45;

/**
 * The natural hydrology layer deliberately retains fine deterministic relief so
 * drainage has local structure. The final surface filters only dry rugged ground at
 * a fixed world-space scale before render/collision/routing consume it. This removes
 * sub-cell harmonic ribbing without changing SEED identity, water ownership, river
 * banks, settlement earthworks, or Realm/local query order.
 */
function structuralDryElevationAt(x: number, z: number, natural: SurfaceSample) {
  if (natural.riverBank || natural.slope < 0.12) return natural.elevation;
  const step = STRUCTURAL_FILTER_STEP,
    centre = naturalElevationBaseAt(x, z),
    nw = naturalElevationBaseAt(x - step, z - step),
    ne = naturalElevationBaseAt(x + step, z - step),
    sw = naturalElevationBaseAt(x - step, z + step),
    se = naturalElevationBaseAt(x + step, z + step),
    filtered = centre * 0.44 + (nw + ne + sw + se) * 0.14;
  return lerp(natural.elevation, filtered, 0.68);
}

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
    fromNatural = hydrologySurfaceAt(road.fromX, road.fromZ),
    toNatural = hydrologySurfaceAt(road.toX, road.toZ),
    fromHeight = Math.max(
      1.2,
      structuralDryElevationAt(road.fromX, road.fromZ, fromNatural),
    ),
    toHeight = Math.max(
      1.2,
      structuralDryElevationAt(road.toX, road.toZ, toNatural),
    );
  return lerp(fromHeight, toHeight, t);
}

function earthworkAt(x: number, z: number) {
  const place = nearestPlace(x, z),
    placeDistance = place
      ? Math.hypot(wrapSourceX(x - place.x), z - place.z)
      : Infinity,
    placeRadius = place?.kind === "city" ? 430 : 90,
    placeBlend = place ? smooth01((placeDistance - placeRadius) / 80) : 1,
    placeNatural = place ? hydrologySurfaceAt(place.x, place.z) : undefined,
    placeHeight = place && placeNatural
      ? Math.max(1.2, structuralDryElevationAt(place.x, place.z, placeNatural))
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

function composedDryElevationAt(x: number, z: number, natural: SurfaceSample) {
  const earthwork = earthworkAt(x, z),
    base = structuralDryElevationAt(x, z, natural);
  return {
    earthwork,
    elevation: lerp(earthwork.target, base, earthwork.blend),
  } as const;
}

/**
 * Final-surface composition never erases authoritative hydrology. Settlements and
 * ordinary roads must already occupy legal dry ground; explicit bridge/ford facts
 * belong to the transport authority. Earthworks therefore grade only dry terrain.
 */
export function surfaceElevationAt(x: number, z: number) {
  const natural = hydrologySurfaceAt(x, z);
  if (natural.water !== "none") return natural.elevation;
  return composedDryElevationAt(x, z, natural).elevation;
}

/** One canonical final-surface query for render height, collision and walkability. */
export function surfaceAt(x: number, z: number): SurfaceSample {
  const natural = hydrologySurfaceAt(x, z);
  if (natural.water !== "none") return natural;

  const composed = composedDryElevationAt(x, z, natural),
    graded = composed.earthwork.blend < 0.999,
    elevation = composed.elevation,
    slope = graded ? Math.min(natural.slope, 0.2) : natural.slope,
    // Very short wavelength spikes remain difficult terrain; only sustained strong
    // canonical relief is an impassable cliff in the shared final-surface authority.
    cliff = !graded && natural.slope >= FINAL_CLIFF_SLOPE,
    traversal: TraversalKind = cliff
      ? "blocked-cliff"
      : graded
        ? "walkable"
        : natural.traversal === "difficult" || natural.traversal === "blocked-cliff"
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