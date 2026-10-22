import { freshwaterCrossingAt } from "./hydrology.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, greatCircleDistance, sourceToLonLat, wrapSourceX } from "./planet.ts";
import { finalSurfaceAt } from "./world-core.ts";
import { sampledCorridorStationPass } from "./transport-route-corridor.ts";
import type { TransportBridge, TransportRoadEdge } from "./transport-network.ts";

/** First unsafe reason from the selected road's actual top final surface; no extra queries. */
function sampledBridgeTopFailure(
  edgeCode: string, surface: ReturnType<typeof finalSurfaceAt>,
): string {
  if (!surface.walkable) return "blocked final surface";
  if (!surface.contributingModifierIds.includes(edgeCode)) return "selected road modifier absent";
  if (surface.deckHeight !== null) {
    if (!surface.deckOwnerIds.includes(edgeCode)) return "unrelated higher bridge deck";
    if (surface.traversal !== "bridge") return "inconsistent top-deck traversal";
    if (surface.water.kind !== "none" && surface.water.kind !== "river") return "unsupported water under deck";
  } else {
    if (surface.water.kind !== "none") return "water without owned deck";
    if (surface.traversal === "difficult") return "unsafe local road slope";
    if (surface.traversal !== "road" && surface.traversal !== "open") return "non-road traversal";
  }
  return "physical traversal not certified";
}

/**
 * Focus-only proof of the actual final-surface deck at a listed river crossing.
 * A coarse crossing or unrelated nearby bridge never certifies this selected road's legal deck.
 */
export function transportBridgeSurfaceAt(x: number, z: number, roadCode: string) {
  const surface = finalSurfaceAt(x, z);
  return Object.freeze({
    centerDeckWalkable:
      surface.water.kind === "river" &&
      surface.deckHeight !== null &&
      surface.walkable &&
      surface.traversal === "bridge" &&
      surface.deckOwnerIds.includes(roadCode),
    deckHeight: surface.deckHeight,
    waterKind: surface.water.kind,
    traversal: surface.traversal,
  });
}

/**
 * Sample the source-owned physical road in canonical metres from a bridge
 * anchor. Latitude-scaled east/north proximity must match physical arc length.
 * Never extend beyond its recorded endpoints or invent a tangent
 * shortcut when the centerline bends. Focus-only, bounded by stationCount.
 */
export function transportRoadArcStations(
  points: readonly { x: number; z: number }[], x: number, z: number,
  fromMetres: number, toMetres: number, stationCount: number,
): readonly { x: number; z: number }[] {
  if (points.length < 2 || !Number.isInteger(stationCount) || stationCount < 1 || stationCount > 48 ||
    !Number.isFinite(fromMetres) || !Number.isFinite(toMetres) || fromMetres >= toMetres) return [];
  const segments: { a: { x: number; z: number }; dx: number; dz: number; start: number; lengthM: number }[] = [];
  let total = 0, bestMetres = Infinity, anchor = -1;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      latitudeScale = Math.cos(sourceToLonLat(a.x, a.z).lat),
      east = dx * latitudeScale, north = dz,
      queryEast = wrapSourceX(x - a.x) * latitudeScale, queryNorth = z - a.z,
      squared = east * east + north * north;
    if (squared < 1e-12) continue;
    const lengthM = CANONICAL_METRES_PER_SOURCE_UNIT * Math.sqrt(squared),
      fraction = Math.max(0, Math.min(1, (queryEast * east + queryNorth * north) / squared)),
      distanceM = CANONICAL_METRES_PER_SOURCE_UNIT *
        Math.hypot(queryEast - east * fraction, queryNorth - north * fraction);
    if (distanceM < bestMetres) { bestMetres = distanceM; anchor = total + fraction * lengthM; }
    segments.push({ a, dx, dz, start: total, lengthM });
    total += lengthM;
  }
  const start = anchor + fromMetres, finish = anchor + toMetres;
  if (bestMetres > 2 || start < -1e-6 || finish > total + 1e-6) return [];
  const samples: { x: number; z: number }[] = [];
  for (let index = 0, cursor = 0; index <= stationCount; index++) {
    const at = Math.max(0, Math.min(total, start + (finish - start) * index / stationCount));
    while (cursor < segments.length - 1 && at > segments[cursor].start + segments[cursor].lengthM) cursor++;
    const segment = segments[cursor],
      fraction = Math.max(0, Math.min(1, (at - segment.start) / segment.lengthM));
    samples.push({ x: wrapSourceX(segment.a.x + segment.dx * fraction), z: segment.a.z + segment.dz * fraction });
  }
  return samples;
}

/**
 * Five wet-deck stations at the same 10/30/50/70/90% offsets used by the
 * inspector, but measured along the actual source-owned road arc. A missing
 * recorded span yields no samples; no straight-water tangent can certify a
 * different physical path.
 */
export function transportRoadWetStations(
  points: readonly { x: number; z: number }[], x: number, z: number,
  crossing: Readonly<{ lo: number; hi: number; metresPerUnit: number }>,
) {
  const start = crossing.lo * crossing.metresPerUnit,
    span = (crossing.hi - crossing.lo) * crossing.metresPerUnit;
  return transportRoadArcStations(points, x, z, start + span * .1, start + span * .9, 4);
}

/**
 * Sample actual traversed elevation, including the physical bridge deck over
 * dry-bank piers. Bare ground below a deck is not the walking grade.
 * Probe only the existing two five-station banks at 4m intervals.
 */
export function transportBankApproachGrade(
  sides: readonly (readonly { surfaceHeight: number }[])[],
): number | null {
  if (sides.length !== 2 || sides.some(side => side.length !== 5)) return null;
  let maximum = 0;
  for (const side of sides)
    for (let i = 1; i < side.length; i++) {
      const rise = Math.abs(side[i].surfaceHeight - side[i - 1].surfaceHeight);
      if (!Number.isFinite(rise)) return null;
      maximum = Math.max(maximum, rise / 4);
    }
  return maximum;
}

/** Both dry-bank approach probes follow the immutable road, not a projected tangent. */
export function transportRoadBankApproaches(
  points: readonly { x: number; z: number }[], x: number, z: number,
  crossing: Readonly<{ lo: number; hi: number; metresPerUnit: number }>,
) {
  const leftM = crossing.lo * crossing.metresPerUnit,
    rightM = crossing.hi * crossing.metresPerUnit;
  return Object.freeze({
    left: transportRoadArcStations(points, x, z, leftM - 18, leftM - 2, 4).slice().reverse(),
    right: transportRoadArcStations(points, x, z, rightM + 2, rightM + 18, 4),
  });
}

/**
 * Inspect one selected graph crossing, not every crossing during pan/zoom.
 * Bounded wet, bank, and road-aligned crossing samples report physical truth;
 * samples never certify unsampled continuity or executed protagonist travel.
 */
export function transportBridgeSpanAt(bridge: TransportBridge, edge: TransportRoadEdge) {
  let nearestMetres = Infinity, direction: {x: number; z: number} | undefined;
  for (let index = 1; index < edge.centerline.length; index++) {
    const a = edge.centerline[index - 1], b = edge.centerline[index],
      dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      latitudeScale = Math.cos(sourceToLonLat(a.x, a.z).lat),
      east = dx * latitudeScale, north = dz,
      queryEast = wrapSourceX(bridge.x - a.x) * latitudeScale, queryNorth = bridge.z - a.z,
      length2 = east * east + north * north;
    if (length2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, (queryEast * east + queryNorth * north) / length2)),
      distanceM = CANONICAL_METRES_PER_SOURCE_UNIT *
        Math.hypot(queryEast - east * t, queryNorth - north * t);
    if (distanceM < nearestMetres) { nearestMetres = distanceM; direction = {x: dx, z: dz}; }
  }
  // A bridge anchor must lie on the same physical road as the bounded
  // arc samples (2 canonical metres), not merely within one source unit
  // (~15 m). Otherwise a nearby unrelated crossing can look graph-matched.
  const crossing = direction && nearestMetres <= 2
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
    routeStations: 0,
    routeStationsOnRoad: false,
    routeStationsSurfaceOwned: false,
    routeStationsWalkable: false,
    routeStationsTopLegal: false,
    routeFirstUnsafeStation: null as number | null,
    routeFirstUnsafeCause: null as string | null,
    approachStationsTopLegal: false,
    approachFirstUnsafeBank: null as string | null,
    approachFirstUnsafeCause: null as string | null,
    routeMaxSampledGrade: null as number | null,
    routeGradeWithinLimit: false,
  });

  // Wet-deck evidence must follow the same bent, wrap-safe canonical road
  // as the bank and full-crossing probes, not a potentially false tangent.
  const wet = transportRoadWetStations(edge.centerline, bridge.x, bridge.z, crossing)
    .map(point => finalSurfaceAt(point.x, point.z));
  // Fixed 2–18 m bank probes now trace the same SEED-owned road curve
  // as the route samples. Missing road endpoints cannot be extrapolated.
  const bankPoints = transportRoadBankApproaches(edge.centerline, bridge.x, bridge.z, crossing),
    approachStationsOnRoad = bankPoints.left.length === 5 && bankPoints.right.length === 5,
    approaches = [bankPoints.left, bankPoints.right].map(side =>
      side.map(point => finalSurfaceAt(point.x, point.z))),
    banks = [approaches[0][0], approaches[1][0]],
    approachMaxSampledGrade = approachStationsOnRoad ? transportBankApproachGrade(approaches) : null;
  // Sample the actual graph-owned centerline, not the projected straight
  // water-crossing tangent. The route probe stays <=49 stations, and
  // missing physical bank-to-road coverage is reported as not certified.
  const sampledMetres = (crossing.hi - crossing.lo) * crossing.metresPerUnit + 36,
    segmentCount = Math.max(2, Math.min(48, Math.ceil(sampledMetres / 4))),
    roadStations = transportRoadArcStations(edge.centerline, bridge.x, bridge.z,
      crossing.lo * crossing.metresPerUnit - 18,
      crossing.hi * crossing.metresPerUnit + 18, segmentCount),
    routeStationsOnRoad = roadStations.length === segmentCount + 1,
    routeStations = roadStations.map(point => ({ point, surface: finalSurfaceAt(point.x, point.z) })),
    // Existing walkability / average grade alone cannot certify a locally
    // difficult slope or an unrelated top bridge hiding this selected road.
    routeFirstUnsafeIndex = routeStations.findIndex(({ point, surface }) =>
      !sampledCorridorStationPass({ ...point, edgeCode: edge.code }, surface)),
    routeStationsTopLegal = routeStationsOnRoad && routeFirstUnsafeIndex < 0,
    approachUnsafe = approaches.map((side, sideIndex) => side.findIndex((surface, index) =>
      surface.water.kind !== "none" || !sampledCorridorStationPass({
        ...bankPoints[sideIndex === 0 ? "left" : "right"][index], edgeCode: edge.code,
      }, surface))),
    approachStationsTopLegal = approachStationsOnRoad && approachUnsafe.every(index => index < 0),
    // Coordinate agreement is not enough: a walkable field/another road
    // must never certify the graph-selected road's physical crossing.
    routeStationsSurfaceOwned = routeStationsOnRoad && routeStations.every(({ surface }) =>
      surface.contributingModifierIds.includes(edge.code) &&
      (surface.water.kind !== "river" || surface.deckOwnerIds.includes(edge.code))),
    routeStationsWalkable = routeStationsSurfaceOwned && routeStations.every(({ surface }) =>
      surface.walkable &&
      (surface.water.kind === "none" ||
        (surface.water.kind === "river" && surface.deckHeight !== null && surface.traversal === "bridge"))),
    // The canonical road may bend and traverse different latitudes. Grade
    // must use each actual geodesic station separation, not nominal span / N.
    routeMaxSampledGrade = routeStationsOnRoad ? Math.max(...roadStations.slice(1).map((point, index) => {
      const previous = roadStations[index],
        stepM = greatCircleDistance(
          sourceToLonLat(previous.x, previous.z),
          sourceToLonLat(point.x, point.z),
        ),
        rise = Math.abs(routeStations[index + 1].surface.surfaceHeight -
          routeStations[index].surface.surfaceHeight);
      return Number.isFinite(stepM) && stepM > 0 && Number.isFinite(rise) ? rise / stepM : Infinity;
    })) : null;

  return Object.freeze({
    matchingCrossing: true,
    wetStations: wet.length,
    deckStationsWalkable: wet.length === 5 && wet.every(surface =>
      surface.water.kind === "river" &&
      surface.deckHeight !== null &&
      surface.walkable &&
      surface.traversal === "bridge" &&
      surface.deckOwnerIds.includes(edge.code)),
    bankStationsWalkable: approachStationsOnRoad && banks.every(surface =>
      surface.water.kind === "none" && surface.walkable),
    approachStations: approaches.reduce((count, side) => count + side.length, 0),
    approachStationsOnRoad,
    approachStationsWalkable: approachStationsOnRoad && approaches.every(side => side.every(surface =>
      surface.water.kind === "none" && surface.walkable)),
    approachMaxSampledGrade,
    approachGradeWithinLimit: approachStationsOnRoad && approachMaxSampledGrade !== null && approachMaxSampledGrade <= .08,
    routeStations: routeStations.length,
    routeStationsOnRoad,
    routeStationsSurfaceOwned,
    routeStationsWalkable,
    routeStationsTopLegal,
    routeFirstUnsafeStation: routeFirstUnsafeIndex < 0 ? null : routeFirstUnsafeIndex + 1,
    routeFirstUnsafeCause: routeFirstUnsafeIndex < 0 ? null :
      sampledBridgeTopFailure(edge.code, routeStations[routeFirstUnsafeIndex].surface),
    approachStationsTopLegal,
    approachFirstUnsafeBank: approachUnsafe[0] >= 0 ? `left station ${approachUnsafe[0] + 1}` :
      approachUnsafe[1] >= 0 ? `right station ${approachUnsafe[1] + 1}` : null,
    approachFirstUnsafeCause: approachUnsafe[0] >= 0 ? (approaches[0][approachUnsafe[0]].water.kind !== "none"
      ? "wet bank" : sampledBridgeTopFailure(edge.code, approaches[0][approachUnsafe[0]])) :
      approachUnsafe[1] >= 0 ? (approaches[1][approachUnsafe[1]].water.kind !== "none"
        ? "wet bank" : sampledBridgeTopFailure(edge.code, approaches[1][approachUnsafe[1]])) : null,
    routeMaxSampledGrade,
    routeGradeWithinLimit: routeStationsWalkable && routeMaxSampledGrade !== null && routeMaxSampledGrade <= .08,
  });
}

/** A selected crossing passes only if BOTH bank and whole-span grade checks pass. */
export function sampledBridgeCrossingPass(
  centerDeckWalkable: boolean,
  span: ReturnType<typeof transportBridgeSpanAt>,
): boolean {
  return centerDeckWalkable && span.matchingCrossing &&
    span.deckStationsWalkable && span.bankStationsWalkable &&
    span.approachStationsWalkable && span.approachGradeWithinLimit &&
    span.routeStationsWalkable && span.routeGradeWithinLimit;
}
