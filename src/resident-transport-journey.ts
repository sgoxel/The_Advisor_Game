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
      last = source.stations.findLastIndex(s => s.edgeCode === roadCode || s.joinedEdgeCode === roadCode),
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
      tick > journey.departedTick &&
      walkingSecondsAt(tick, journey.originLongitude) ===
      walkingSecondsAt(tick - 1, journey.originLongitude) ? "resting" : "walking";
  return { residentCode: journey.residentCode, x, z, status, progress, distanceM: travelled };
}
