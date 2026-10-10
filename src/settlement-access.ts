import { CANONICAL_METRES_PER_SOURCE_UNIT } from "./planet.ts";
import {
  settlementPlan,
  type SettlementBuilding,
  type SettlementPlan,
} from "./settlements.ts";

export type SettlementEntranceAccess = {
  buildingCode: string;
  streetCode: string;
  entrance: { x: number; z: number };
  street: { x: number; z: number };
  lengthM: number;
  sourcePoints: readonly { x: number; z: number }[];
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function nearestPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const vx = bx - ax,
    vz = bz - az,
    lengthSq = vx * vx + vz * vz,
    t =
      lengthSq <= 1e-12
        ? 0
        : clamp01(((px - ax) * vx + (pz - az) * vz) / lengthSq),
    x = ax + vx * t,
    z = az + vz * t;
  return { x, z, distance: Math.hypot(px - x, pz - z) };
}

/**
 * Canonical plot-access contract. Entrances are the authoritative building portal;
 * this pure query connects that portal to the nearest internal settlement street.
 * The path is logical world truth and never depends on render tile/LOD/device class.
 */
export function settlementEntranceAccess(
  building: SettlementBuilding,
  plan: SettlementPlan = settlementPlan(building.placeId),
): SettlementEntranceAccess {
  let best:
    | { streetCode: string; x: number; z: number; distance: number }
    | undefined;
  for (const street of plan.streets) {
    for (let index = 1; index < street.sourcePoints.length; index++) {
      const a = street.sourcePoints[index - 1],
        b = street.sourcePoints[index],
        point = nearestPointOnSegment(
          building.entranceX,
          building.entranceZ,
          a.x,
          a.z,
          b.x,
          b.z,
        );
      if (!best || point.distance < best.distance) {
        best = { streetCode: street.code, ...point };
      }
    }
  }
  if (!best)
    throw new Error(`${building.code} has no internal settlement street access`);
  return {
    buildingCode: building.code,
    streetCode: best.streetCode,
    entrance: { x: building.entranceX, z: building.entranceZ },
    street: { x: best.x, z: best.z },
    lengthM: best.distance * CANONICAL_METRES_PER_SOURCE_UNIT,
    sourcePoints: [
      { x: building.entranceX, z: building.entranceZ },
      { x: best.x, z: best.z },
    ],
  };
}

export function settlementAccessRecords(placeId: string) {
  const plan = settlementPlan(placeId);
  return plan.buildings
    .filter((building) => building.use !== "well")
    .map((building) => settlementEntranceAccess(building, plan));
}
