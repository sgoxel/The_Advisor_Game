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
export type CorridorStation = Readonly<{ x: number; z: number; edgeCode: string; joinedEdgeCode?: string; junctionOwnerCodes?: readonly string[] }>;
type Plan = Readonly<
  | { status: "invalid"; stations: readonly CorridorStation[] }
  | { status: "over-budget"; reason: "raw-source-waypoints" | "sample-stations"; edgeCode: string; stations: readonly CorridorStation[] }
  | { status: "ready"; stations: readonly CorridorStation[] }
>;
const EMPTY = Object.freeze([] as CorridorStation[]);

export function planTransportRouteCorridor(
  route: Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>,
  roads: ReadonlyMap<string, Edge>,
  nodes: ReadonlyMap<string, Node>,
  // Already-built canonical walking adjacency; never infer joins from map overlap.
  incidentRoads?: ReadonlyMap<string, readonly { edge: Edge }[]>,
): Plan {
  if (!route.from || !route.to || !route.edgeCodes.length) return Object.freeze({ status: "invalid", stations: EMPTY });
  const stations: CorridorStation[] = [];
  // Only registered graph-incident roads whose source endpoints actually meet
  // the canonical node may own its winning final surface. Shared Y nodes and
  // selected start/end terminals use exactly the same bounded proof.
  const ownersAt = (nodeCode: string): readonly string[] | undefined => {
    const incident = incidentRoads?.get(nodeCode), node = nodes.get(nodeCode);
    if (!incident || !node) return undefined;
    return Object.freeze([...new Set(incident.flatMap(step => {
      const registered = roads.get(step.edge.code);
      if (!registered || registered.from !== step.edge.from ||
          registered.to !== step.edge.to || !registered.centerline?.length) return [];
      const endpoint = registered.from === nodeCode ? registered.centerline[0] :
        registered.to === nodeCode ? registered.centerline[registered.centerline.length - 1] : null;
      return physicalMatch(endpoint, node) ? [registered.code] : [];
    }))].sort());
  };
  let at = route.from;
  // A path with thousands of near-identical raw points could bypass the 4096
  // sampled-station limit yet consume unbounded synchronous planning time.
  // Retire it before scanning/reversing vertices; never claim a partial PASS.
  let remainingSourcePoints = ROUTE_CORRIDOR_STATION_LIMIT * 2;
  for (const code of route.edgeCodes) {
    const edge = roads.get(code);
    if (!edge || !edge.centerline || edge.centerline.length < 2)
      return Object.freeze({ status: "invalid", stations: EMPTY });
    if (edge.centerline.length > remainingSourcePoints)
      return Object.freeze({ status: "over-budget", reason: "raw-source-waypoints", edgeCode: code, stations: EMPTY });
    remainingSourcePoints -= edge.centerline.length;
    const forward = edge.from === at;
    if (!forward && edge.to !== at) return Object.freeze({ status: "invalid", stations: EMPTY });
    // When the caller provides an authoritative walking index, a missing
    // endpoint entry is invalid, not permission to skip ownership validation.
    if (incidentRoads && (!incidentRoads.has(at) || !incidentRoads.has(forward ? edge.to : edge.from)))
      return Object.freeze({ status: "invalid", stations: EMPTY });
    const sourcePoints = forward ? edge.centerline : [...edge.centerline].reverse();
    // Repeated or sub-millimetre-near source vertices are not travel intervals.
    // Use the same physical join tolerance as canonical node endpoints; keep
    // rejecting a wholly collapsed road rather than inventing movement.
    if (sourcePoints.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.z)))
      return Object.freeze({ status: "invalid", stations: EMPTY });
    const points = [sourcePoints[0]];
    for (let i = 1; i < sourcePoints.length; i++) {
      const last = points[points.length - 1], point = sourcePoints[i];
      // Compare against the last RETAINED vertex: a chain of individually
      // tiny offsets can still cross a real canonical sampling interval.
      if (Math.hypot(wrapSourceX(point.x - last.x), point.z - last.z) > 1e-4)
        points.push(point);
    }
    // Collapsing a tiny final tail must still reach the original SEED endpoint
    // exactly, especially when the same route is inspected in reverse.
    if (points.length >= 2) points[points.length - 1] = sourcePoints[sourcePoints.length - 1];
    if (points.length < 2) return Object.freeze({ status: "invalid", stations: EMPTY });
    const start = nodes.get(at), endCode = forward ? edge.to : edge.from,
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
        // Keep actual source-space station spacing <=1 even on diagonal roads.
        steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) - 1e-8));
      if (stations.length && i === 1) {
        const last = stations.length - 1;
        if (Math.hypot(wrapSourceX(stations[last].x - a.x), stations[last].z - a.z) > 1e-4)
          return Object.freeze({ status: "invalid", stations: EMPTY });
        // The composer selects ONE winning road at a Y. It may be a third
        // physically joined graph-incident road, not either selected route leg.
        // Reuse the existing walking index and prove each registered road's
        // actual endpoint meets this exact canonical node. Mere overlap is not
        // a connection. The next station still tests the outgoing route edge.
        const joinedOwners = ownersAt(at);
        if (joinedOwners && (!joinedOwners.includes(stations[last].edgeCode) ||
            !joinedOwners.includes(code)))
          return Object.freeze({ status: "invalid", stations: EMPTY });
        // Never sample a zero-distance span at a shared graph node.
        stations[last] = Object.freeze({
          ...stations[last], joinedEdgeCode: code,
          ...(joinedOwners ? { junctionOwnerCodes: joinedOwners } : {}),
        });
      }
      const additional = steps + (stations.length ? 0 : 1);
      if (!Number.isSafeInteger(steps) || stations.length + additional > ROUTE_CORRIDOR_STATION_LIMIT)
        return Object.freeze({ status: "over-budget", reason: "sample-stations", edgeCode: code, stations: EMPTY });
      for (let step = stations.length ? 1 : 0; step <= steps; step++) {
        const first = stations.length === 0, originOwners = first ? ownersAt(at) : undefined;
        if (originOwners && !originOwners.includes(code))
          return Object.freeze({ status: "invalid", stations: EMPTY });
        stations.push(Object.freeze({
          x: wrapSourceX(a.x + dx * step / steps),
          z: a.z + dz * step / steps,
          edgeCode: code,
          ...(originOwners ? { junctionOwnerCodes: originOwners } : {}),
        }));
      }
    }
    at = endCode;
  }
  // Graph incidence and valid mesh endpoints do not prove the path reaches the requested site.
  if (at !== route.to) return Object.freeze({ status: "invalid", stations: EMPTY });
  const destinationOwners = ownersAt(at);
  if (destinationOwners) {
    const last = stations.length - 1;
    if (last < 0 || !destinationOwners.includes(stations[last].edgeCode))
      return Object.freeze({ status: "invalid", stations: EMPTY });
    stations[last] = Object.freeze({ ...stations[last], junctionOwnerCodes: destinationOwners });
  }
  return Object.freeze({ status: "ready", stations: Object.freeze(stations) });
}

/** One read-only reason for the selected station's actual upper final surface. */
export function sampledCorridorStationFailure(
  station: CorridorStation,
  surface: Pick<FinalSurface, "water" | "walkable" | "traversal" | "deckHeight" | "deckOwnerIds" | "contributingModifierIds"> & Partial<Pick<FinalSurface, "surfaceHeight">>,
  localRoadSlope?: number,
): string | null {
  const incident = (id: string) => id === station.edgeCode || id === station.joinedEdgeCode ||
      !!station.junctionOwnerCodes?.includes(id),
    contributed = (id: string) => surface.contributingModifierIds.includes(id);
  // Diagnose physically unsupported water before the generic unwalkable
  // fallback. This changes the explanation, never the sampled PASS predicate.
  // All runtime samples include top-surface height. Reject a malformed first
  // station here, not as a misleading bad interval at the next station.
  if (surface.surfaceHeight !== undefined && !Number.isFinite(surface.surfaceHeight))
    return "invalid final-surface height";
  // A non-finite deck elevation is never a valid physical walking surface.
  if (surface.deckHeight !== null && !Number.isFinite(surface.deckHeight))
    return "invalid final-surface bridge deck";
  // The compositor exposes the actual top of every bridge as its deck height.
  // Contradictory top elevations cannot describe one walkable final surface.
  if (surface.deckHeight !== null && surface.surfaceHeight !== undefined &&
      surface.surfaceHeight !== surface.deckHeight)
    return "bridge deck disagrees with final-surface top";
  if (surface.deckHeight === null && surface.water.kind !== "none")
    return "water without owned bridge deck";
  if (surface.deckHeight !== null && surface.water.kind !== "none" && surface.water.kind !== "river")
    return "unsupported water under bridge deck";
  if (!surface.walkable) return "blocked final surface";
  if (!surface.contributingModifierIds.some(incident)) return "selected road modifier absent";
  // A real shared Y has one winning final-surface modifier; it may be either
  // selected incident road. The next separate station checks the outgoing road.
  if (surface.deckHeight !== null) {
    if (surface.traversal !== "bridge") return "inconsistent top-deck traversal";
    if (!surface.deckOwnerIds.some(id => incident(id) && contributed(id)))
      return "unrelated higher bridge deck";
    return null;
  }
  if (surface.traversal === "open" && localRoadSlope === undefined)
    return "local road slope not sampled";
  if (surface.traversal === "difficult" ||
      (surface.traversal === "open" && (!Number.isFinite(localRoadSlope) || localRoadSlope! > .08)))
    return "unsafe local road slope";
  if (surface.traversal !== "road" && surface.traversal !== "open")
    return "non-road traversal";
  return null;
}

/** A sampled PASS and its first-failure reason always use identical criteria. */
export function sampledCorridorStationPass(
  station: CorridorStation,
  surface: Pick<FinalSurface, "water" | "walkable" | "traversal" | "deckHeight" | "deckOwnerIds" | "contributingModifierIds"> & Partial<Pick<FinalSurface, "surfaceHeight">>,
  localRoadSlope?: number,
) {
  return sampledCorridorStationFailure(station, surface, localRoadSlope) === null;
}
