import { wrapSourceX } from "./planet.ts";
import type { FinalSurface } from "./final-surface.ts";
import type { TransportRoadEdge } from "./transport-network.ts";

/**
 * Selected-route diagnostic only. Never changes Simulation travel authority.
 * Source-coordinate steps <=1 retain a fixed finite probe budget regardless of
 * camera, cache, or registry size. Refuse an oversized route; never truncate it
 * and report a false full-profile PASS.
 */
export const ROUTE_CORRIDOR_STATION_LIMIT = 4096;
type Edge = Pick<TransportRoadEdge, "code" | "from" | "to" | "centerline">;
export type CorridorStation = Readonly<{ x: number; z: number; edgeCode: string }>;
type Plan = Readonly<
  | { status: "invalid"; stations: readonly CorridorStation[] }
  | { status: "over-budget"; stations: readonly CorridorStation[] }
  | { status: "ready"; stations: readonly CorridorStation[] }
>;
const EMPTY = Object.freeze([] as CorridorStation[]);

export function planTransportRouteCorridor(
  route: Readonly<{ from: string; edgeCodes: readonly string[] }>,
  roads: ReadonlyMap<string, Edge>,
): Plan {
  if (!route.from || !route.edgeCodes.length) return Object.freeze({ status: "invalid", stations: EMPTY });
  const stations: CorridorStation[] = [];
  let at = route.from;
  for (const code of route.edgeCodes) {
    const edge = roads.get(code);
    if (!edge || !edge.centerline || edge.centerline.length < 2)
      return Object.freeze({ status: "invalid", stations: EMPTY });
    const forward = edge.from === at;
    if (!forward && edge.to !== at) return Object.freeze({ status: "invalid", stations: EMPTY });
    const points = forward ? edge.centerline : [...edge.centerline].reverse();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (![a.x, a.z, b.x, b.z].every(Number.isFinite))
        return Object.freeze({ status: "invalid", stations: EMPTY });
      const dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
        steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) - 1e-8));
      if (stations.length && i === 1 && Math.hypot(
        wrapSourceX(stations[stations.length - 1].x - a.x),
        stations[stations.length - 1].z - a.z,
      ) > 1e-4) return Object.freeze({ status: "invalid", stations: EMPTY });
      const additional = steps + (stations.length ? 0 : 1);
      if (!Number.isSafeInteger(steps) || stations.length + additional > ROUTE_CORRIDOR_STATION_LIMIT)
        return Object.freeze({ status: "over-budget", stations: EMPTY });
      for (let step = stations.length ? 1 : 0; step <= steps; step++)
        stations.push(Object.freeze({
          x: wrapSourceX(a.x + dx * step / steps),
          z: a.z + dz * step / steps,
          edgeCode: code,
        }));
    }
    at = forward ? edge.to : edge.from;
  }
  return Object.freeze({ status: "ready", stations: Object.freeze(stations) });
}

/** Each station must belong to its chosen road or its actual river deck. */
export function sampledCorridorStationPass(
  station: CorridorStation,
  surface: Pick<FinalSurface, "water" | "walkable" | "traversal" | "deckHeight" | "deckOwnerIds" | "contributingModifierIds">,
) {
  if (!surface.walkable || !surface.contributingModifierIds.includes(station.edgeCode)) return false;
  if (surface.water.kind === "none") return true;
  return surface.water.kind === "river" &&
    surface.traversal === "bridge" && surface.deckHeight !== null &&
    surface.deckOwnerIds.includes(station.edgeCode);
}
