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
export const ROUTE_CORRIDOR_LEG_LIMIT = 12;
export const ROUTE_CORRIDOR_EXTENDED_STATION_LIMIT = ROUTE_CORRIDOR_STATION_LIMIT * 4;
type Edge = Pick<TransportRoadEdge, "code" | "from" | "to" | "centerline">;
type Node = Pick<TransportNode, "x" | "z">;
const physicalMatch = (a: { x: number; z: number } | null | undefined, b: Node) =>
  !!a && [a.x, a.z, b.x, b.z].every(Number.isFinite) &&
  Math.hypot(wrapSourceX(a.x - b.x), a.z - b.z) <= 1e-4;
export type CorridorStation = Readonly<{ x: number; z: number; edgeCode: string; joinedEdgeCode?: string; junctionOwnerCodes?: readonly string[] }>;
type Plan = Readonly<
  | { status: "invalid"; reason?: "repeated-road" | "source-chain"; edgeCode?: string; stations: readonly CorridorStation[] }
  | { status: "over-budget"; reason: "raw-source-waypoints" | "sample-stations" | "route-stations" | "route-legs"; edgeCode: string; stations: readonly CorridorStation[] }
  | { status: "ready"; stations: readonly CorridorStation[] }
>;
const EMPTY = Object.freeze([] as CorridorStation[]);
const invalidSourceChain = (edgeCode: string): Plan =>
  Object.freeze({ status: "invalid", reason: "source-chain", edgeCode, stations: EMPTY });

export function planTransportRouteCorridor(
  route: Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>,
  roads: ReadonlyMap<string, Edge>,
  nodes: ReadonlyMap<string, Node>,
  // Already-built canonical walking adjacency; never infer joins from map overlap.
  incidentRoads?: ReadonlyMap<string, readonly { edge: Edge }[]>,
): Plan {
  // A selected route must be a non-retracing walk. Name the first
  // repeated SEED road before any physical sampling, never invent a PASS.
  if (!route.from || !route.to || !route.edgeCodes.length)
    return Object.freeze({ status: "invalid", stations: EMPTY });
  const seenRoads = new Set<string>();
  for (const code of route.edgeCodes) {
    if (seenRoads.has(code))
      return Object.freeze({ status: "invalid", reason: "repeated-road", edgeCode: code, stations: EMPTY });
    seenRoads.add(code);
  }
  // Inspect every SEED edge's *endpoint geometry* before applying the heavier
  // raw-point/station budget. Otherwise an oversized first road could mask
  // a detached later road or a path that never reaches its requested site.
  // This is bounded by graph edge count and does not sample final surfaces.
  let endpointAt = route.from;
  for (const code of route.edgeCodes) {
    const edge = roads.get(code);
    if (!edge?.centerline || edge.centerline.length < 2)
      return invalidSourceChain(code);
    const forward = edge.from === endpointAt;
    if (!forward && edge.to !== endpointAt)
      return invalidSourceChain(code);
    const next = forward ? edge.to : edge.from,
      first = edge.centerline[forward ? 0 : edge.centerline.length - 1],
      last = edge.centerline[forward ? edge.centerline.length - 1 : 0],
      origin = nodes.get(endpointAt), destination = nodes.get(next);
    if (!origin || !destination ||
        !physicalMatch(first, origin) || !physicalMatch(last, destination) ||
        (incidentRoads && (!incidentRoads.has(endpointAt) || !incidentRoads.has(next))))
      return invalidSourceChain(code);
    endpointAt = next;
  }
  if (endpointAt !== route.to)
    return invalidSourceChain(route.edgeCodes[route.edgeCodes.length - 1]);
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

/**
 * Explicit on-demand fallback for multi-road routes refused by the 4096-station
 * whole-route planner. Each SEED road retains the SAME <=4096-station proof,
 * including canonical incident owner checks at its endpoints. Shared nodes
 * are inspected exactly once with both incident route legs recorded.
 *
 * A strict 12-road / 16384-station / 8192-raw-waypoint ceiling prevents an
 * unbounded diagnostic. No source data is changed or invented and no
 * partial profile can be reported as ready.
 */
export function planTransportRouteCorridorByLeg(
  route: Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>,
  roads: ReadonlyMap<string, Edge>,
  nodes: ReadonlyMap<string, Node>,
  incidentRoads?: ReadonlyMap<string, readonly { edge: Edge }[]>,
): Plan {
  const whole = planTransportRouteCorridor(route, roads, nodes, incidentRoads);
  if (whole.status !== "over-budget" || whole.reason !== "sample-stations") return whole;
  if (route.edgeCodes.length > ROUTE_CORRIDOR_LEG_LIMIT)
    return Object.freeze({ status: "over-budget", reason: "route-legs",
      edgeCode: route.edgeCodes[ROUTE_CORRIDOR_LEG_LIMIT], stations: EMPTY });
  const stations: CorridorStation[] = [];
  let at = route.from, remainingRawPoints = ROUTE_CORRIDOR_STATION_LIMIT * 2;
  for (const code of route.edgeCodes) {
    const edge = roads.get(code);
    // The whole-route source preflight already checked every join; preserve
    // its refusal if source inputs change or prove malformed in a leg.
    if (!edge || !edge.centerline || edge.centerline.length > remainingRawPoints)
      return Object.freeze({ status: "over-budget", reason: "raw-source-waypoints",
        edgeCode: code, stations: EMPTY });
    remainingRawPoints -= edge.centerline.length;
    const next = edge.from === at ? edge.to : edge.from,
      part = planTransportRouteCorridor(
        { from: at, to: next, edgeCodes: [code] }, roads, nodes, incidentRoads);
    if (part.status !== "ready") return part;
    const previousIndex = stations.length - 1;
    if (previousIndex >= 0) {
      const previous = stations[previousIndex], first = part.stations[0];
      if (!first || Math.hypot(wrapSourceX(first.x - previous.x), first.z - previous.z) > 1e-4 ||
          (incidentRoads && (!previous.junctionOwnerCodes?.includes(code) ||
            !first.junctionOwnerCodes?.includes(previous.edgeCode))))
        return Object.freeze({ status: "invalid", stations: EMPTY });
    }
    const extra = part.stations.length - (previousIndex >= 0 ? 1 : 0);
    if (stations.length + extra > ROUTE_CORRIDOR_EXTENDED_STATION_LIMIT)
      return Object.freeze({ status: "over-budget", reason: "route-stations",
        edgeCode: code, stations: EMPTY });
    if (previousIndex >= 0)
      stations[previousIndex] = Object.freeze({
        ...stations[previousIndex], joinedEdgeCode: code,
      });
    for (let i = previousIndex >= 0 ? 1 : 0; i < part.stations.length; i++)
      stations.push(part.stations[i]);
    at = next;
  }
  if (at !== route.to) return Object.freeze({ status: "invalid", stations: EMPTY });
  return Object.freeze({ status: "ready", stations: Object.freeze(stations) });
}

/** Yield only after a complete station. This is a UI scheduling budget, never
 * a surface sampling limit or a change to deterministic SEED/Simulation truth. */
export const TRANSPORT_PROBE_FRAME_BUDGET_MS = 6;
export function transportProbeFrameBudgetReached(completed: number, elapsedMs: number) {
  return completed > 0 && (!Number.isFinite(elapsedMs) || elapsedMs >= TRANSPORT_PROBE_FRAME_BUDGET_MS);
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
      (surface.traversal === "open" && (!Number.isFinite(localRoadSlope) || localRoadSlope! < 0 || localRoadSlope! > .08)))
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
