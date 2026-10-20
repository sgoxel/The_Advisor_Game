import { freshwaterCrossingAt } from "./hydrology.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, wrapSourceX } from "./planet.ts";
import { finalSurfaceAt } from "./world-core.ts";
import type { TransportBridge, TransportRoadEdge } from "./transport-network.ts";

/**
 * Focus-only proof of the actual final-surface deck at a listed river crossing.
 * A coarse transport crossing record alone never certifies legal bridge traversal.
 */
export function transportBridgeSurfaceAt(x: number, z: number) {
  const surface = finalSurfaceAt(x, z);
  return Object.freeze({
    centerDeckWalkable:
      surface.water.kind === "river" &&
      surface.deckHeight !== null &&
      surface.walkable &&
      surface.traversal === "bridge",
    deckHeight: surface.deckHeight,
    waterKind: surface.water.kind,
    traversal: surface.traversal,
  });
}

/**
 * Inspect one selected graph crossing, not every crossing during pan/zoom.
 * Five wet-span stations and two dry-bank stations report sampled physical truth;
 * they do not certify every intervening point or executed protagonist travel.
 */
export function transportBridgeSpanAt(bridge: TransportBridge, edge: TransportRoadEdge) {
  let nearest = Infinity, direction: {x: number; z: number} | undefined;
  for (let index = 1; index < edge.centerline.length; index++) {
    const a = edge.centerline[index - 1], b = edge.centerline[index],
      dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      qx = wrapSourceX(bridge.x - a.x), qz = bridge.z - a.z,
      length2 = dx * dx + dz * dz;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / length2)),
      distance = Math.hypot(qx - dx * t, qz - dz * t);
    if (distance < nearest) { nearest = distance; direction = {x: dx, z: dz}; }
  }
  const crossing = direction && nearest < 1
    ? freshwaterCrossingAt(bridge.x, bridge.z, direction.x, direction.z) : null;
  const matchingCrossing = !!crossing && crossing.code === bridge.drainageCode
    && Math.abs(crossing.spanM - bridge.spanM) <= Math.max(1, bridge.spanM * .01);
  if (!matchingCrossing || !crossing) return Object.freeze({
    matchingCrossing: false,
    wetStations: 0,
    deckStationsWalkable: false,
    bankStationsWalkable: false,
    approachStations: 0,
    approachStationsOnRoad: false,
    approachStationsWalkable: false,
    approachMaxSampledGrade: null as number | null,
    approachGradeWithinLimit: false,
  });

  const sample = (t: number) => finalSurfaceAt(
    wrapSourceX(bridge.x + crossing.ux * t),
    bridge.z + crossing.uz * t,
  );
  const wet = [0.1, 0.3, 0.5, 0.7, 0.9].map(fraction =>
    sample(crossing.lo + (crossing.hi - crossing.lo) * fraction));
  // Probe only the selected bridge: fixed ten dry approach stations on the
  // source-owned road tangent, not atlas-wide routes or a full continuity proof.
  const offsetsM = [2, 6, 10, 14, 18];
  const approaches = [
    offsetsM.map(metres => sample(crossing.lo - metres / crossing.metresPerUnit)),
    offsetsM.map(metres => sample(crossing.hi + metres / crossing.metresPerUnit)),
  ];
  // Sampling along the crossing tangent does not prove the physical road extends
  // along that tangent. Reject off-centerline stations rather than certifying
  // walkable terrain that the recorded graph edge never reaches.
  const onRoad = (t: number) => {
    const x = wrapSourceX(bridge.x + crossing.ux * t), z = bridge.z + crossing.uz * t;
    const closest = edge.centerline.slice(1).reduce((best, point, index) => {
      const previous = edge.centerline[index],
        dx = wrapSourceX(point.x - previous.x), dz = point.z - previous.z,
        qx = wrapSourceX(x - previous.x), qz = z - previous.z,
        lengthSquared = dx * dx + dz * dz,
        fraction = lengthSquared ? Math.max(0, Math.min(1, (qx * dx + qz * dz) / lengthSquared)) : 0;
      return Math.min(best, Math.hypot(qx - dx * fraction, qz - dz * fraction));
    }, Infinity);
    return closest <= 2 / CANONICAL_METRES_PER_SOURCE_UNIT;
  };
  const approachStationsOnRoad = [
    ...offsetsM.map(metres => crossing.lo - metres / crossing.metresPerUnit),
    ...offsetsM.map(metres => crossing.hi + metres / crossing.metresPerUnit),
  ].every(onRoad);
  const banks = [approaches[0][0], approaches[1][0]];
  const approachGrades = approaches.flatMap(side => side.slice(1).map((surface, i) =>
    Math.abs(surface.groundHeight - side[i].groundHeight) / (offsetsM[i + 1] - offsetsM[i])));
  const approachMaxSampledGrade = Math.max(...approachGrades);
  return Object.freeze({
    matchingCrossing: true,
    wetStations: wet.length,
    deckStationsWalkable: wet.every(surface =>
      surface.water.kind === "river" &&
      surface.deckHeight !== null &&
      surface.walkable &&
      surface.traversal === "bridge"),
    bankStationsWalkable: banks.every(surface =>
      surface.water.kind === "none" && surface.walkable),
    approachStations: approaches.reduce((count, side) => count + side.length, 0),
    approachStationsOnRoad,
    approachStationsWalkable: approachStationsOnRoad && approaches.every(side => side.every(surface =>
      surface.water.kind === "none" && surface.walkable)),
    approachMaxSampledGrade,
    approachGradeWithinLimit: approachMaxSampledGrade <= .08,
  });
}
