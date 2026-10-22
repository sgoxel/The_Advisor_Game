import { wrapSourceX } from "./planet.ts";
import type { FinalSurface } from "./final-surface.ts";
import type { TransportNode, TransportRoadEdge } from "./transport-network.ts";

/**
 * Selected-route diagnostic only. Never changes Simulation travel authority.
 * Source-coordinate steps <=1 retain a fixed finite probe budget regardless of
 * camera, cache, or registry size. Refuse an oversized route; never truncate it
 * and report a false full-profile PASS.
 */
export const ROUTE_CORRIDOR_STATION_LIMIT = 4096;
type Edge = Pick<TransportRoadEdge, "code" | "from" | "to" | "centerline">;
type Node = Pick<TransportNode, "x" | "z">;
const physicalMatch = (a: { x: number; z: number } | null | undefined, b: Node) =>
  !!a && [a.x, a.z, b.x, b.z].every(Number.isFinite) &&
  Math.hypot(wrapSourceX(a.x - b.x), a.z - b.z) <= 1e-4;
export type CorridorStation = Readonly<{ x: number; z: number; edgeCode: string; joinedEdgeCode?: string }>;
type Plan = Readonly<
  | { status: "invalid"; stations: readonly CorridorStation[] }
  | { status: "over-budget"; stations: readonly CorridorStation[] }
  | { status: "ready"; stations: readonly CorridorStation[] }
>;
const EMPTY = Object.freeze([] as CorridorStation[]);

export function planTransportRouteCorridor(
  route: Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>,
  roads: ReadonlyMap<string, Edge>,
  nodes: ReadonlyMap<string, Node>,
): Plan {
  if (!route.from || !route.to || !route.edgeCodes.length) return Object.freeze({ status: "invalid", stations: EMPTY });
  const stations: CorridorStation[] = [];
  let at = route.from;
  for (const code of route.edgeCodes) {
    const edge = roads.get(code);
    if (!edge || !edge.centerline || edge.centerline.length < 2)
      return Object.freeze({ status: "invalid", stations: EMPTY });
    const forward = edge.from === at;
    if (!forward && edge.to !== at) return Object.freeze({ status: "invalid", stations: EMPTY });
    const points = forward ? edge.centerline : [...edge.centerline].reverse(),
      start = nodes.get(at), endCode = forward ? edge.to : edge.from,
      end = nodes.get(endCode);
    // Graph incidence alone cannot certify a detached single-road polyline.
    // Check canonical node positions even for routes with only one edge.
    if (!start || !end || !physicalMatch(points[0], start) || !physicalMatch(points[points.length - 1], end))
      return Object.freeze({ status: "invalid", stations: EMPTY });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (!a || !b || ![a.x, a.z, b.x, b.z].every(Number.isFinite))
        return Object.freeze({ status: "invalid", stations: EMPTY });
      const dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
        steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) - 1e-8));
      if (stations.length && i === 1) {
        const last = stations.length - 1;
        if (Math.hypot(wrapSourceX(stations[last].x - a.x), stations[last].z - a.z) > 1e-4)
          return Object.freeze({ status: "invalid", stations: EMPTY });
        // The final-surface composer contributes one winning road modifier at a
        // coordinate, even where two canonical road centerlines meet. Check
        // either incident owner here; the next station tests the outgoing road.
        // Sampling the junction twice would invent a zero-distance grade span.
        stations[last] = Object.freeze({ ...stations[last], joinedEdgeCode: code });
      }
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
    at = endCode;
  }
  // Graph incidence and valid mesh endpoints do not prove the path reaches the requested site.
  if (at !== route.to) return Object.freeze({ status: "invalid", stations: EMPTY });
  return Object.freeze({ status: "ready", stations: Object.freeze(stations) });
}

/** Each station must belong to its chosen road or its actual river deck. */
export function sampledCorridorStationPass(
  station: CorridorStation,
  surface: Pick<FinalSurface, "water" | "walkable" | "traversal" | "deckHeight" | "deckOwnerIds" | "contributingModifierIds">,
) {
  const incident = (id: string) => id === station.edgeCode || id === station.joinedEdgeCode,
    contributed = (id: string) => surface.contributingModifierIds.includes(id);
  if (!surface.walkable || !surface.contributingModifierIds.some(incident)) return false;
  // A junction may have only ONE SEED-selected road modifier at this exact
  // coordinate. An adjoining road is sampled separately on the next step.
  // A deck must still belong to that SAME contributing incident road,
  // never to an unrelated overpass hiding a lower selected road.
  if (surface.deckHeight !== null)
    return (surface.water.kind === "none" || surface.water.kind === "river") &&
      surface.traversal === "bridge" &&
      surface.deckOwnerIds.some(id => incident(id) && contributed(id));
  // "difficult" includes road slopes above the canonical 8% threshold.
  // A walkable endpoint alone must not certify the selected legal-grade road.
  return surface.water.kind === "none" &&
    (surface.traversal === "road" || surface.traversal === "open");
}
