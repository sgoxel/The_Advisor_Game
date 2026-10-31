import { fantasySecondOfDay, timeZoneOffsetHours } from "./clock.ts";
import { greatCircleDistance, sourceToLonLat, wrapSourceX } from "./planet.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import { finalSurfaceAt, finalSurfaceLocalSlopeAt } from "./world-core.ts";
import type { FinalSurface } from "./final-surface.ts";
import type { Resident } from "./simulation.ts";
import { residentWalkableSurface } from "./simulation.ts";
import type { TransportNode, TransportRoadEdge, TransportBridge } from "./transport-network.ts";
import { planTransportRouteCorridorByLeg, sampledCorridorStationFailure } from "./transport-route-corridor.ts";

/** A Simulation-side record of an independent resident decision. UI route previews
 * are not decisions and must never call this just because a route is selected. */
export type ResidentTravelDecision = Readonly<{
  residentCode: string;
  fromNode: string;
  siteNode: string;
  decidedTick: number;
  acceptedByResident: true;
}>;
type Source = Readonly<{ x: number; z: number }>;
type ResidentStart = Pick<Resident, "code" | "x" | "z" | "grounded" | "indoors" | "route">;
type Route = Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>;
type Edge = Pick<TransportRoadEdge, "code" | "from" | "to" | "centerline" | "bridgeCodes">;
type Node = Pick<TransportNode, "x" | "z">;
type Sample = (x: number, z: number) => FinalSurface;
const MAX_STATIONS = 16_384;
const DAY = 86_400, START_WALK = 6 * 3_600, END_WALK = 22 * 3_600;
const WALK_PER_DAY = END_WALK - START_WALK;
const distance = (a: Source, b: Source) =>
  greatCircleDistance(sourceToLonLat(a.x, a.z), sourceToLonLat(b.x, b.z));

export type ValidatedResidentJourney = Readonly<{
  residentCode: string;
  siteNode: string;
  departedTick: number;
  edgeCodes: readonly string[];
  stations: readonly Source[];
  /** Exact macro-road gate after a physically verified local approach (if any). */
  macroStart?: Source;
  cumulativeMetres: readonly number[];
  distanceM: number;
  /** Fixed longitude of the SEED gate owns the walk/rest schedule. */
  originLongitude: number;
}>;

/** Full strict on-demand source validation before Simulation can accept an actor
 * journey. No arbitrary 32-waypoint / 6.5 km one-bridge restriction; the
 * existing canonical 12-road/16,384-station planner owns the hard budget.
 * Every original station and every midpoint must obey the same road-owner,
 * bridge, walkability and 8% interval constraints as the transport release gate.
 * A failed, truncated or unowned route has no journey and no arrival event.
 * This routine is intentionally NOT called per frame or per resident. */
export function prepareResidentTransportJourney(
  resident: ResidentStart,
  decision: ResidentTravelDecision,
  route: Route,
  roads: ReadonlyMap<string, Edge>,
  nodes: ReadonlyMap<string, Node>,
  adjacency: ReadonlyMap<string, readonly { edge: Edge }[]>,
  bridges: readonly Pick<TransportBridge, "roadCode">[],
  surfaceAt: Sample = finalSurfaceAt,
  slopeAt: (x: number, z: number) => number = finalSurfaceLocalSlopeAt,
): ValidatedResidentJourney | null {
  if (!resident.grounded || resident.indoors || resident.route.startsWith("BLOCKED:") ||
      decision.acceptedByResident !== true || decision.residentCode !== resident.code ||
      !Number.isSafeInteger(decision.decidedTick) || decision.decidedTick < 0 ||
      decision.fromNode !== route.from || decision.siteNode !== route.to ||
      !Number.isFinite(resident.x) || !Number.isFinite(resident.z) ||
      route.edgeCodes.length < 2 || route.edgeCodes.length > 12) return null;
  const source = planTransportRouteCorridorByLeg(route, roads, nodes, adjacency);
  if (source.status !== "ready" || source.stations.length < 2 ||
      source.stations.length > MAX_STATIONS ||
      !bridges.some(bridge => route.edgeCodes.includes(bridge.roadCode))) return null;
  const start = source.stations[0], startMetres = distance(resident, start);
  // No camera click or itinerary decision can teleport an actor to a gate.
  // A real resident must already stand at this canonical starting gate.
  if (!Number.isFinite(startMetres) || startMetres > 1) return null;

  const cumulative: number[] = [0];
  let previousSurface: FinalSurface | undefined, previous = start;
  const selectedWet: number[] = [];
  for (let i = 0; i < source.stations.length; i++) {
    const station = source.stations[i], surface = surfaceAt(station.x, station.z),
      slope = surface.deckHeight === null && surface.traversal === "open" && surface.walkable
        ? slopeAt(station.x, station.z) : undefined;
    if (sampledCorridorStationFailure(station, surface, slope) ||
        !residentWalkableSurface(surface)) return null;
    if (surface.water.kind === "river" && surface.deckHeight !== null &&
        bridges.some(bridge => bridge.roadCode === station.edgeCode)) selectedWet.push(i);
    if (i) {
      const metres = distance(previous, station);
      if (!(metres > 0) || !Number.isFinite(metres)) return null;
      const grade = Math.abs(surface.surfaceHeight - previousSurface!.surfaceHeight) / metres;
      if (!Number.isFinite(grade) || grade > .08) return null;
      const mid = { x: wrapSourceX(previous.x + wrapSourceX(station.x - previous.x) / 2),
        z: (previous.z + station.z) / 2 },
        middle = surfaceAt(mid.x, mid.z),
        midSlope = middle.deckHeight === null && middle.traversal === "open" && middle.walkable
          ? slopeAt(mid.x, mid.z) : undefined,
        midStation = { ...station, x: mid.x, z: mid.z },
        halfA = distance(previous, mid), halfB = distance(mid, station);
      if (sampledCorridorStationFailure(midStation, middle, midSlope) ||
          !residentWalkableSurface(middle) || !(halfA > 0 && halfB > 0) ||
          Math.abs(middle.surfaceHeight - previousSurface!.surfaceHeight) / halfA > .08 ||
          Math.abs(surface.surfaceHeight - middle.surfaceHeight) / halfB > .08) return null;
      cumulative.push(cumulative[i - 1] + metres);
    }
    previous = station;
    previousSurface = surface;
  }
  // Require the selected actual wet deck to be flanked by dry road samples,
  // not merely a floating isolated bridge or a water-only endpoint.
  if (!selectedWet.length || !(cumulative[cumulative.length - 1] > 0)) return null;
  // At a canonical Y, the shared endpoint belongs to the incoming station
  // and records the outgoing bridge road as joinedEdgeCode. Count that proven
  // physical endpoint as the bridge's dry approach; requiring its edgeCode to
  // equal the outgoing road would falsely reject a lawful crossing.
  for (const roadCode of new Set(selectedWet.map(i => source.stations[i].edgeCode))) {
    const first = source.stations.findIndex(s => s.edgeCode === roadCode || s.joinedEdgeCode === roadCode),
      last = source.stations.reduce((index, station, i) =>
        station.edgeCode === roadCode || station.joinedEdgeCode === roadCode ? i : index, -1),
      wet = selectedWet.filter(i => source.stations[i].edgeCode === roadCode);
    if (first < 0 || last <= first || first >= wet[0] || last <= wet[wet.length - 1] ||
        surfaceAt(source.stations[first].x, source.stations[first].z).water.kind !== "none" ||
        surfaceAt(source.stations[last].x, source.stations[last].z).water.kind !== "none") return null;
  }
  return Object.freeze({
    residentCode: resident.code, siteNode: route.to, departedTick: decision.decidedTick,
    edgeCodes: Object.freeze([...route.edgeCodes]),
    stations: Object.freeze(source.stations.map(p => Object.freeze({ x: p.x, z: p.z }))),
    cumulativeMetres: Object.freeze(cumulative),
    distanceM: cumulative[cumulative.length - 1],
    originLongitude: sourceToLonLat(start.x, start.z).lon,
  });
}

/**
 * Join a real outdoor actor to an existing SEED road origin ONLY by a local
 * path already validated by the Simulation street/enclosure authority. The
 * local approach is timed movement, not a synthetic starting position or
 * an extra fabricated macro-road. A missing gate, unsafe connector, steep
 * surface or blocked water segment refuses the whole journey.
 *
 * `localSegmentLegal` must be the Simulation's legalStreetSegment predicate:
 * it proves the enclosure/gate and samples the actual street, while this
 * function independently checks final-surface walkability and 8% grades.
 * Calls are bounded and on demand; never run in the frame/render loop.
 */
export function prepareResidentTransportJourneyWithApproach(
  resident: ResidentStart,
  decision: ResidentTravelDecision,
  route: Route,
  roads: ReadonlyMap<string, Edge>,
  nodes: ReadonlyMap<string, Node>,
  adjacency: ReadonlyMap<string, readonly { edge: Edge }[]>,
  bridges: readonly Pick<TransportBridge, "roadCode">[],
  approach: readonly Source[],
  localSegmentLegal: (from: Source, to: Source) => boolean,
  surfaceAt: Sample = finalSurfaceAt,
  slopeAt: (x: number, z: number) => number = finalSurfaceLocalSlopeAt,
): ValidatedResidentJourney | null {
  if (!resident.grounded || resident.indoors || resident.route.startsWith("BLOCKED:") ||
      approach.length < 2 || approach.length > 256 ||
      ![resident.x, resident.z].every(Number.isFinite) ||
      !approach.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)) ||
      distance(resident, approach[0]) > .01 ||
      !nodes.has(route.from) || distance(approach[approach.length - 1], nodes.get(route.from)!) > .01)
    return null;

  let approachMetres = 0;
  const cumulative = [0];
  for (let i = 0; i < approach.length; i++) {
    const current = approach[i], currentSurface = surfaceAt(current.x, current.z),
      localSlope = currentSurface.deckHeight === null && currentSurface.traversal === "open"
        ? slopeAt(current.x, current.z) : undefined;
    if (!residentWalkableSurface(currentSurface) ||
        !Number.isFinite(currentSurface.surfaceHeight) ||
        (localSlope !== undefined &&
          (!Number.isFinite(localSlope) || localSlope < 0 || localSlope > .08))) return null;
    if (!i) continue;
    const previous = approach[i - 1], previousSurface = surfaceAt(previous.x, previous.z),
      metres = distance(previous, current),
      mid = { x: wrapSourceX(previous.x + wrapSourceX(current.x - previous.x) / 2),
        z: (previous.z + current.z) / 2 },
      middle = surfaceAt(mid.x, mid.z),
      midpointSlope = middle.deckHeight === null && middle.traversal === "open"
        ? slopeAt(mid.x, mid.z) : undefined,
      firstHalf = distance(previous, mid), secondHalf = distance(mid, current);
    if (!(metres > 0) || metres > 1_200 || approachMetres + metres > 6_500 ||
        !Number.isFinite(metres) || !localSegmentLegal(previous, current) ||
        !residentWalkableSurface(middle) || !Number.isFinite(middle.surfaceHeight) ||
        (midpointSlope !== undefined &&
          (!Number.isFinite(midpointSlope) || midpointSlope < 0 || midpointSlope > .08)) ||
        !(firstHalf > 0 && secondHalf > 0) ||
        Math.abs(middle.surfaceHeight - previousSurface.surfaceHeight) / firstHalf > .08 ||
        Math.abs(currentSurface.surfaceHeight - middle.surfaceHeight) / secondHalf > .08 ||
        Math.abs(currentSurface.surfaceHeight - previousSurface.surfaceHeight) / metres > .08)
      return null;
    approachMetres += metres;
    cumulative.push(approachMetres);
  }

  // The actor has NOT teleported to the gate. Only the physical macro section
  // is verified from the proven local path's endpoint, then composed with
  // every already-timed local street step.
  const origin = approach[approach.length - 1],
    planned = prepareResidentTransportJourney(
      { ...resident, x: origin.x, z: origin.z }, decision, route,
      roads, nodes, adjacency, bridges, surfaceAt, slopeAt,
    );
  if (!planned || distance(origin, planned.stations[0]) > .01) return null;
  return Object.freeze({
    ...planned,
    stations: Object.freeze([
      ...approach.slice(0, -1).map(point => Object.freeze({ x: point.x, z: point.z })),
      ...planned.stations,
    ]),
    cumulativeMetres: Object.freeze([
      ...cumulative.slice(0, -1),
      ...planned.cumulativeMetres.map(metres => approachMetres + metres),
    ]),
    distanceM: approachMetres + planned.distanceM,
    originLongitude: sourceToLonLat(approach[0].x, approach[0].z).lon,
    macroStart: planned.stations[0],
  });
}

/**
 * A resident who actually reached the canonical site may independently choose
 * to return along the same owned SEED edges. The previous proof does not make
 * a return lawful after a collapsed deck or other world change: build a FRESH
 * fully validated reverse corridor using the same surface and grade limits.
 *
 * This only prepares a possible return, not a resident decision or a
 * persisted Simulation event. If departure used a local street connector,
 * a fresh Simulation street/gate check is required to return all the way to
 * that original departure position (which is not necessarily the home door).
 * The actor must genuinely have reached the site before reversal.
 */
export function prepareResidentTransportReturnJourney(
  resident: ResidentStart,
  decision: ResidentTravelDecision,
  outward: ValidatedResidentJourney,
  originNode: string,
  roads: ReadonlyMap<string, Edge>,
  nodes: ReadonlyMap<string, Node>,
  adjacency: ReadonlyMap<string, readonly { edge: Edge }[]>,
  bridges: readonly Pick<TransportBridge, "roadCode">[],
  surfaceAt: Sample = finalSurfaceAt,
  slopeAt: (x: number, z: number) => number = finalSurfaceLocalSlopeAt,
  localSegmentLegal?: (from: Source, to: Source) => boolean,
): ValidatedResidentJourney | null {
  const outwardStart = outward.macroStart ?? outward.stations[0],
    outwardEnd = outward.stations[outward.stations.length - 1],
    canonicalOrigin = nodes.get(originNode);
  if (!outwardStart || !outwardEnd || !canonicalOrigin ||
      resident.code !== outward.residentCode ||
      decision.residentCode !== resident.code ||
      decision.fromNode !== outward.siteNode ||
      decision.siteNode !== originNode ||
      !Number.isSafeInteger(decision.decidedTick) ||
      decision.decidedTick <= outward.departedTick ||
      !Number.isFinite(outward.distanceM) || outward.distanceM <= 0 ||
      outward.edgeCodes.length < 2 ||
      distance(outwardStart, canonicalOrigin) > 1 ||
      distance(resident, outwardEnd) > 1 ||
      residentTransportJourneyAt(outward, decision.decidedTick).status !== "arrived")
    return null;
  const reverse: Route = { from: outward.siteNode, to: originNode,
    edgeCodes: [...outward.edgeCodes].reverse() };
  const macro = prepareResidentTransportJourney(
    resident, decision, reverse, roads, nodes, adjacency, bridges, surfaceAt, slopeAt,
  );
  if (!macro || !outward.macroStart) return macro;

  // A return to the macro gate is not a return to the original resident.
  // Recheck the actual outward street path in reverse, including the SAME
  // Simulation enclosure/gate authority, on the CURRENT final surface.
  const gateIndex = outward.stations.findIndex(point => distance(point, outward.macroStart!) <= .01);
  if (gateIndex < 0 || gateIndex > 255 ||
      macro.stations.length + gateIndex > MAX_STATIONS) return null;
  if (gateIndex === 0) return macro;
  if (!localSegmentLegal) return null;
  const street = outward.stations.slice(0, gateIndex + 1).reverse();
  if (distance(street[0], macro.stations[macro.stations.length - 1]) > .01) return null;
  const stations: Source[] = [...macro.stations],
    cumulative = [...macro.cumulativeMetres];
  let walked = macro.distanceM, streetMetres = 0;
  for (let i = 1; i < street.length; i++) {
    const a = street[i - 1], b = street[i],
      metres = distance(a, b),
      midpoint = { x: wrapSourceX(a.x + wrapSourceX(b.x - a.x) / 2),
        z: (a.z + b.z) / 2 },
      firstHalf = distance(a, midpoint), secondHalf = distance(midpoint, b),
      sa = surfaceAt(a.x, a.z), sm = surfaceAt(midpoint.x, midpoint.z),
      sb = surfaceAt(b.x, b.z),
      slope = [[a, sa], [midpoint, sm], [b, sb]].map(([point, surface]) =>
        (surface as FinalSurface).deckHeight === null &&
        (surface as FinalSurface).traversal === "open"
          ? slopeAt((point as Source).x, (point as Source).z) : 0);
    if (!(metres > 0) || !Number.isFinite(metres) || metres > 1_200 ||
        streetMetres + metres > 6_500 ||
        !(firstHalf > 0 && secondHalf > 0) ||
        !localSegmentLegal(a, b) ||
        ![sa, sm, sb].every(residentWalkableSurface) ||
        slope.some(value => !Number.isFinite(value) || value < 0 || value > .08) ||
        ![sa.surfaceHeight, sm.surfaceHeight, sb.surfaceHeight].every(Number.isFinite) ||
        Math.abs(sm.surfaceHeight - sa.surfaceHeight) / firstHalf > .08 ||
        Math.abs(sb.surfaceHeight - sm.surfaceHeight) / secondHalf > .08 ||
        Math.abs(sb.surfaceHeight - sa.surfaceHeight) / metres > .08) return null;
    streetMetres += metres;
    walked += metres;
    stations.push(Object.freeze({ x: b.x, z: b.z }));
    cumulative.push(walked);
  }
  return Object.freeze({
    ...macro,
    stations: Object.freeze(stations),
    cumulativeMetres: Object.freeze(cumulative),
    distanceM: walked,
  });
}

/**
 * Finish a freshly revalidated return at the actual owned home door, not merely
 * at the previous departure spot or settlement gate. Simulation supplies the
 * *existing* legal town-street path from its return endpoint to that resolved
 * door. This cannot create a shortcut, virtual home or bridge permission.
 * Every segment, midpoint and ≤8% grade must independently pass again.
 */
export function appendResidentReturnToOwnedDoor(
  journey: ValidatedResidentJourney,
  localPath: readonly Source[],
  localSegmentLegal: (a: Source, b: Source) => boolean,
  surfaceAt: Sample = finalSurfaceAt,
  slopeAt: (x: number, z: number) => number = finalSurfaceLocalSlopeAt,
): ValidatedResidentJourney | null {
  if (localPath.length < 2 || localPath.length > 256 ||
      journey.stations.length + localPath.length - 1 > MAX_STATIONS ||
      localPath.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z)) ||
      distance(journey.stations[journey.stations.length - 1], localPath[0]) > .01) return null;
  const stations: Source[] = [...journey.stations],
    cumulative = [...journey.cumulativeMetres];
  let length = journey.distanceM, localLength = 0;
  for (let i = 1; i < localPath.length; i++) {
    const a = localPath[i - 1], b = localPath[i],
      metres = distance(a, b),
      midpoint = { x: wrapSourceX(a.x + wrapSourceX(b.x - a.x) / 2), z: (a.z + b.z) / 2 },
      firstHalf = distance(a, midpoint), secondHalf = distance(midpoint, b),
      samples = [a, midpoint, b].map(p => surfaceAt(p.x, p.z));
    if (!(metres > 0) || !Number.isFinite(metres) || metres > 1_200 ||
        localLength + metres > 6_500 || !(firstHalf > 0 && secondHalf > 0) ||
        !localSegmentLegal(a, b) ||
        samples.some(s => !residentWalkableSurface(s) || !Number.isFinite(s.surfaceHeight)))
      return null;
    const grades = [Math.abs(samples[1].surfaceHeight - samples[0].surfaceHeight) / firstHalf,
      Math.abs(samples[2].surfaceHeight - samples[1].surfaceHeight) / secondHalf,
      Math.abs(samples[2].surfaceHeight - samples[0].surfaceHeight) / metres];
    for (let k = 0; k < 3; k++) {
      const surface = samples[k], point = [a, midpoint, b][k];
      if (surface.deckHeight === null && surface.traversal === "open")
        grades.push(slopeAt(point.x, point.z));
    }
    if (grades.some(grade => !Number.isFinite(grade) || grade < 0 || grade > .08)) return null;
    localLength += metres;
    length += metres;
    stations.push(Object.freeze({ x: b.x, z: b.z }));
    cumulative.push(length);
  }
  if (!(localLength > 0)) return null;
  return Object.freeze({
    ...journey, stations: Object.freeze(stations),
    cumulativeMetres: Object.freeze(cumulative), distanceM: length,
  });
}

/** Accumulated legal daylight walking time, with a deterministic 22:00–06:00
 * overnight rest (no all-night/multi-day teleport or elapsed wall clock).
 * Uses Fantasy Time and the origin gate's stable local time zone. */
function walkingSecondsAt(tick: number, longitude: number) {
  const offset = timeZoneOffsetHours(longitude) * 3_600,
    originSecond = fantasySecondOfDay(0),
    shifted = tick + offset + originSecond,
    day = Math.floor(shifted / DAY),
    second = shifted - day * DAY;
  return day * WALK_PER_DAY + Math.max(0, Math.min(WALK_PER_DAY, second - START_WALK));
}

/** A pure absolute-time projection of one already-validated Simulation event.
 * The caller retains the same SEED actor; this does not make an Advisor command
 * or a camera route preview authoritative. */
export function residentTransportJourneyAt(
  journey: ValidatedResidentJourney,
  tick: number,
): Readonly<{ residentCode: string; x: number; z: number; status: "not-departed" | "walking" | "resting" | "arrived"; progress: number; distanceM: number }> {
  const elapsed = tick <= journey.departedTick ? 0 :
    Math.max(0, walkingSecondsAt(tick, journey.originLongitude) -
      walkingSecondsAt(journey.departedTick, journey.originLongitude)),
    travelled = Math.min(journey.distanceM, elapsed * GOOD_ROAD_WALK_SPEED_MPS),
    progress = travelled / journey.distanceM;
  let low = 0, high = journey.cumulativeMetres.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (journey.cumulativeMetres[middle] < travelled) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(1, low), a = journey.stations[index - 1], b = journey.stations[index],
    start = journey.cumulativeMetres[index - 1], end = journey.cumulativeMetres[index],
    ratio = Math.max(0, Math.min(1, (travelled - start) / (end - start))),
    x = wrapSourceX(a.x + wrapSourceX(b.x - a.x) * ratio),
    z = a.z + (b.z - a.z) * ratio,
    status = tick < journey.departedTick ? "not-departed" :
      progress >= 1 ? "arrived" :
      // The accepted departure instant itself may be inside the overnight
      // rest window. A zero-distance actor is not "walking" just because
      // this is the first Fantasy Time tick of the approved journey.
      walkingSecondsAt(tick, journey.originLongitude) ===
      walkingSecondsAt(tick - 1, journey.originLongitude) ? "resting" : "walking";
  return { residentCode: journey.residentCode, x, z, status, progress, distanceM: travelled };
}
