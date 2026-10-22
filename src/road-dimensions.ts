import { CANONICAL_METRES_PER_SOURCE_UNIT, sourceToLonLat } from "./planet.ts";

/** One physical cross-section for transport records, terrain and road meshes. */
export function roadWidthM(road: { code: string; networkKind?: string }) {
  if (road.code.includes("/ROAD/MAIN/")) return 8;
  return road.networkKind === "trunk" ? 6 : 4;
}
export const ROAD_SHOULDER_M = .5;
export const MAX_ROAD_SUPPORT_M = 4 + ROAD_SHOULDER_M;
/** Perpendicular in the local metre metric, then projected back to source X/Z. */
export function roadNormalSource(dx: number, dz: number, z: number, halfWidthM: number) {
  const latitudeScale = Math.max(.01, Math.cos(sourceToLonLat(0, z).lat)),
    east = dx * latitudeScale, length = Math.hypot(east, dz) || 1,
    half = halfWidthM / CANONICAL_METRES_PER_SOURCE_UNIT;
  return { x: -dz / length * half / latitudeScale, z: east / length * half };
}
