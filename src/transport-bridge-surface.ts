import { freshwaterCrossingAt } from "./hydrology.ts";
import { wrapSourceX } from "./planet.ts";
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
  });

  const sample = (t: number) => finalSurfaceAt(
    wrapSourceX(bridge.x + crossing.ux * t),
    bridge.z + crossing.uz * t,
  );
  const wet = [0.1, 0.3, 0.5, 0.7, 0.9].map(fraction =>
    sample(crossing.lo + (crossing.hi - crossing.lo) * fraction));
  const bankOffset = 2 / crossing.metresPerUnit,
    banks = [sample(crossing.lo - bankOffset), sample(crossing.hi + bankOffset)];
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
  });
}
