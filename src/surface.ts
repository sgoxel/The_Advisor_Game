import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import {
  naturalHydrologyDiagnostics,
  naturalSurfaceAt,
  naturalSurfaceElevationAt,
  type NaturalSurfaceSample,
  type NaturalTraversalKind,
  type NaturalWaterKind,
} from "./natural-surface.ts";
import { wrapSourceX } from "./planet.ts";

export type WaterKind = NaturalWaterKind;
export type TraversalKind = NaturalTraversalKind;
export type SurfaceSample = NaturalSurfaceSample;

const smooth01 = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Final currently-implemented surface composition for S002-004-005.
 * Natural terrain/hydrology is upstream and immutable. Settlement pads and road
 * grading may reshape dry terrain only; they never erase or relocate water.
 */
export function surfaceElevationAt(x: number, z: number): number {
  const sx = wrapSourceX(x),
    natural = naturalSurfaceAt(sx, z);
  if (natural.water !== "none") return natural.elevation;

  const place = nearestPlace(sx, z),
    placeDistance = place
      ? Math.hypot(wrapSourceX(sx - place.x), z - place.z)
      : Infinity,
    placeRadius = place?.kind === "city" ? 430 : 90,
    placeBlend = place
      ? smooth01((placeDistance - placeRadius) / 80)
      : 1,
    road = roadAt(sx, z),
    roadDistance = road ? roadDistanceAt(sx, z, road) : Infinity,
    roadBlend = road ? smooth01((roadDistance - 5) / 7) : 1,
    flatten = Math.min(placeBlend, roadBlend);
  return lerp(3, natural.elevation, flatten);
}

export function surfaceAt(x: number, z: number): SurfaceSample {
  const sx = wrapSourceX(x),
    natural = naturalSurfaceAt(sx, z);
  if (natural.water !== "none") return natural;

  const elevation = surfaceElevationAt(sx, z),
    step = 2,
    dx = Math.abs(surfaceElevationAt(sx + step, z) - surfaceElevationAt(sx - step, z)) /
      (step * 2),
    dz = Math.abs(surfaceElevationAt(sx, z + step) - surfaceElevationAt(sx, z - step)) /
      (step * 2),
    slope = Math.max(dx, dz),
    road = roadAt(sx, z),
    onRoad = Boolean(road && roadDistanceAt(sx, z, road) <= 12),
    cliff = !onRoad && slope >= 1.15,
    traversal: TraversalKind = cliff
      ? "blocked-cliff"
      : onRoad
        ? "walkable"
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

export function freshwaterDistanceAt(x: number, z: number) {
  return naturalSurfaceAt(x, z).freshwaterDistance;
}

export const hydrologyDiagnostics = naturalHydrologyDiagnostics;
export { naturalSurfaceAt, naturalSurfaceElevationAt };
