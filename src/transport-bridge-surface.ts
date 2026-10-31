import { freshwaterCrossingAt } from "./hydrology.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, greatCircleDistance, sourceToLonLat, wrapSourceX } from "./planet.ts";
import { finalSurfaceAt, finalSurfaceLocalSlopeAt, RURAL_BRIDGE_MAX_LENGTH_M } from "./world-core.ts";
import { ROUTE_CORRIDOR_STATION_LIMIT, riverBridgeDeckAboveWater, sampledCorridorStationFailure, sampledCorridorStationPass } from "./transport-route-corridor.ts";
import type { TransportBridge, TransportRoadEdge } from "./transport-network.ts";

/** Bridge and route probes must name the SAME first unsafe canonical surface reason. */
export function sampledBridgeTopFailure(
  edgeCode: string, surface: ReturnType<typeof finalSurfaceAt>, localRoadSlope?: number,
): string {
  return sampledCorridorStationFailure({ x: 0, z: 0, edgeCode }, surface, localRoadSlope) ??
    "physical traversal not certified";
}

// On-demand only: "open" remains Simulation-walkable between 8% and 15%,
// but a selected road must satisfy the same stricter <=8% grade as the route probe.
function openRoadSlope(point: { x: number; z: number }, surface: ReturnType<typeof finalSurfaceAt>) {
  return surface.deckHeight === null && surface.traversal === "open" && surface.walkable
    ? finalSurfaceLocalSlopeAt(point.x, point.z) : undefined;
}

/**
 * A deck-owner label alone cannot certify that the chosen SEED road
 * physically contributes to the final surface. Use the same two ownership
 * facts as the selected whole-route station verifier.
 */
export function selectedRoadBridgeDeckWalkable(
  surface: Pick<ReturnType<typeof finalSurfaceAt>,
    "surfaceHeight" | "water" | "deckHeight" | "walkable" | "traversal" | "deckOwnerIds" | "contributingModifierIds">,
  roadCode: string,
): boolean {
  return Number.isFinite(surface.surfaceHeight) && riverBridgeDeckAboveWater(surface) &&
    surface.deckHeight !== null &&
    surface.surfaceHeight === surface.deckHeight && surface.walkable &&
    surface.traversal === "bridge" &&
    surface.deckOwnerIds.includes(roadCode) &&
    surface.contributingModifierIds.includes(roadCode);
}

/** Dry landfall must expose the same physical, road-owned deck as the wet span.
 * A walkable bank by itself cannot certify that the bridge actually touches it. */
export function selectedRoadDryLandingDeckWalkable(
  surface: Pick<ReturnType<typeof finalSurfaceAt>,
    "surfaceHeight" | "water" | "deckHeight" | "walkable" | "traversal" | "deckOwnerIds" | "contributingModifierIds">,
  roadCode: string,
): boolean {
  return surface.water.kind === "none" && Number.isFinite(surface.surfaceHeight) &&
    surface.deckHeight !== null && Number.isFinite(surface.deckHeight) &&
    surface.surfaceHeight === surface.deckHeight && surface.walkable &&
    surface.traversal === "bridge" && surface.deckOwnerIds.includes(roadCode) &&
    surface.contributingModifierIds.includes(roadCode);
}

/**
 * Focus-only proof of the actual final-surface deck at a listed river crossing.
 * A coarse crossing or unrelated nearby bridge never certifies this selected road's legal deck.
 */
export function transportBridgeSurfaceAt(x: number, z: number, roadCode: string) {
  const surface = finalSurfaceAt(x, z);
  return Object.freeze({
    centerDeckWalkable: selectedRoadBridgeDeckWalkable(surface, roadCode),
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
  // The 49 sampled stations are not a bound on raw source processing.
  // Share the selected-route diagnostic's finite waypoint budget before
  // touching any centerline element; oversized inputs remain unverified.
  if (!Array.isArray(points) || points.length < 2 ||
    points.length > ROUTE_CORRIDOR_STATION_LIMIT * 2 ||
    !Number.isFinite(x) || !Number.isFinite(z) ||
    !Number.isInteger(stationCount) || stationCount < 1 || stationCount > 48 ||
    !Number.isFinite(fromMetres) || !Number.isFinite(toMetres) || fromMetres >= toMetres) return [];
  const segments: { a: { x: number; z: number }; dx: number; dz: number; start: number; lengthM: number }[] = [];
  let total = 0, bestMetres = Infinity, anchor = -1;
  // Two distant positions along a self-crossing/hairpin can be equally close
  // to one bridge coordinate. Do not silently certify the wrong river span.
  // Four metres is twice the existing two-metre road-anchor tolerance.
  let firstNearbyArc: number | undefined;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    // A broken downstream span invalidates the entire physical crossing,
    // even when an earlier valid segment happens to contain the anchor.
    if (!a || !b || ![a.x, a.z, b.x, b.z].every(Number.isFinite)) return [];
    const dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      latitudeScale = Math.cos(sourceToLonLat(a.x, a.z).lat),
      east = dx * latitudeScale, north = dz,
      queryEast = wrapSourceX(x - a.x) * latitudeScale, queryNorth = z - a.z,
      squared = east * east + north * north;
    if (squared < 1e-12) continue;
    const lengthM = CANONICAL_METRES_PER_SOURCE_UNIT * Math.sqrt(squared),
      fraction = Math.max(0, Math.min(1, (queryEast * east + queryNorth * north) / squared)),
      distanceM = CANONICAL_METRES_PER_SOURCE_UNIT *
        Math.hypot(queryEast - east * fraction, queryNorth - north * fraction);
    const arc = total + fraction * lengthM;
    if (distanceM <= 2) {
      if (firstNearbyArc !== undefined && Math.abs(arc - firstNearbyArc) > 4) return [];
      firstNearbyArc ??= arc;
    }
    if (distanceM < bestMetres) { bestMetres = distanceM; anchor = arc; }
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
 * Probe only the existing two five-station banks. Measure the true
 * spherical separation: arc interpolation and pole/seam rounding must never
 * turn a <4 m physical step into a falsely legal nominal-4 m grade.
 */
export function transportBankApproachGrade(
  sides: readonly (readonly { surfaceHeight: number }[])[],
  stations: readonly (readonly { x: number; z: number }[])[],
): number | null {
  if (sides.length !== 2 || sides.some(side => side.length !== 5) ||
      stations.length !== 2 || stations.some(side => side.length !== 5)) return null;
  let maximum = 0;
  for (let sideIndex = 0; sideIndex < 2; sideIndex++)
    for (let i = 1; i < 5; i++) {
      const previous = stations[sideIndex][i - 1], current = stations[sideIndex][i],
        heightA = sides[sideIndex][i - 1].surfaceHeight,
        heightB = sides[sideIndex][i].surfaceHeight;
      if (![previous.x, previous.z, current.x, current.z, heightA, heightB].every(Number.isFinite))
        return null;
      const metres = greatCircleDistance(
        sourceToLonLat(previous.x, previous.z), sourceToLonLat(current.x, current.z));
      if (!Number.isFinite(metres) || metres <= 0) return null;
      maximum = Math.max(maximum, Math.abs(heightB - heightA) / metres);
    }
  return maximum;
}

/**
 * Pure evidence from already sampled canonical road positions and top-surface
 * heights. Identify the FIRST sampled interval violating 8% without confusing
 * interval rise/run with the separate local final-surface slope.
 */
export function transportRoadIntervalGradeEvidence(
  points: readonly { x: number; z: number }[], heights: readonly number[],
) {
  if (points.length < 2 || points.length !== heights.length)
    return Object.freeze({ maximum: null as number | null,
      firstUnsafeStation: null as number | null, firstUnsafeGrade: null as number | null });
  let maximum = 0, firstUnsafeStation: number | null = null, firstUnsafeGrade: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i],
      valid = a && b && [a.x, a.z, b.x, b.z].every(Number.isFinite),
      metres = valid ? greatCircleDistance(
        sourceToLonLat(a.x, a.z), sourceToLonLat(b.x, b.z)) : NaN,
      rise = Math.abs(heights[i] - heights[i - 1]),
      grade = Number.isFinite(metres) && metres > 0 && Number.isFinite(rise)
        ? rise / metres : Infinity;
    maximum = Math.max(maximum, grade);
    if (firstUnsafeStation === null && grade > .08) {
      firstUnsafeStation = i + 1;
      firstUnsafeGrade = grade;
    }
  }
  return Object.freeze({ maximum, firstUnsafeStation, firstUnsafeGrade });
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
  // Reject oversized raw centerlines before the anchor search as well as
  // the downstream wet/bank samplers. Never truncate a candidate crossing.
  const boundedCenterline = Array.isArray(edge.centerline) &&
    edge.centerline.length >= 2 &&
    edge.centerline.length <= ROUTE_CORRIDOR_STATION_LIMIT * 2;
  for (let index = 1; boundedCenterline && index < edge.centerline.length; index++) {
    const a = edge.centerline[index - 1], b = edge.centerline[index];
    if (!a || !b || ![bridge.x, bridge.z, a.x, a.z, b.x, b.z].every(Number.isFinite)) {
      direction = undefined;
      break; // Invalid physical source segment cannot identify an owned crossing.
    }
    const dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
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
  const crossing = direction && nearestMetres <= 2 && bridge.roadCode === edge.code
    ? freshwaterCrossingAt(bridge.x, bridge.z, direction.x, direction.z) : null;
  const matchingCrossing = !!crossing && crossing.code === bridge.drainageCode
    && Math.abs(crossing.spanM - bridge.spanM) <= Math.max(1, bridge.spanM * .01);
  if (!matchingCrossing || !crossing) return Object.freeze({
    matchingCrossing: false,
    wetStations: 0,
    deckStationsWalkable: false,
    dryLandingStations: 0,
    dryLandingDeckContact: false,
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
    routeFirstUnsafeIntervalStation: null as number | null,
    routeFirstUnsafeIntervalGrade: null as number | null,
    approachStationsTopLegal: false,
    approachFirstUnsafeBank: null as string | null,
    approachFirstUnsafeCause: null as string | null,
    routeFirstUnsafeLocalGrade: null as number | null,
    approachFirstUnsafeLocalGrade: null as number | null,
    routeMaxSampledGrade: null as number | null,
    routeGradeWithinLimit: false,
  });

  // Wet-deck evidence must follow the same bent, wrap-safe canonical road
  // as the bank and full-crossing probes, not a potentially false tangent.
  const wet = transportRoadWetStations(edge.centerline, bridge.x, bridge.z, crossing)
    .map(point => finalSurfaceAt(point.x, point.z));
  // The final-surface compositor only extends a legal deck by the existing
  // source-derived pier allowance, bounded by the original <=120 m bridge law.
  // Inspect its physical halfway point on EACH dry bank along the actual road,
  // rather than accepting a walkable approach merely adjacent to wet deck.
  const pierMetres = Math.max(0, Math.min(5, (RURAL_BRIDGE_MAX_LENGTH_M - crossing.spanM) / 2)),
    dryLandingPoints = pierMetres > 0 ? transportRoadArcStations(
      edge.centerline, bridge.x, bridge.z,
      crossing.lo * crossing.metresPerUnit - pierMetres / 2,
      crossing.hi * crossing.metresPerUnit + pierMetres / 2, 1,
    ) : [],
    dryLandingDeckContact = dryLandingPoints.length === 2 && dryLandingPoints.every(point =>
      selectedRoadDryLandingDeckWalkable(finalSurfaceAt(point.x, point.z), edge.code));
  // Fixed 2–18 m bank probes now trace the same SEED-owned road curve
  // as the route samples. Missing road endpoints cannot be extrapolated.
  const bankPoints = transportRoadBankApproaches(edge.centerline, bridge.x, bridge.z, crossing),
    approachStationsOnRoad = bankPoints.left.length === 5 && bankPoints.right.length === 5,
    approaches = [bankPoints.left, bankPoints.right].map(side =>
      side.map(point => finalSurfaceAt(point.x, point.z))),
    banks = [approaches[0][0], approaches[1][0]],
    approachMaxSampledGrade = approachStationsOnRoad ? transportBankApproachGrade(
      approaches, [bankPoints.left, bankPoints.right]) : null;
  // Sample the actual graph-owned centerline, not the projected straight
  // water-crossing tangent. The route probe stays <=49 stations, and
  // missing physical bank-to-road coverage is reported as not certified.
  const sampledMetres = (crossing.hi - crossing.lo) * crossing.metresPerUnit + 36,
    segmentCount = Math.max(2, Math.min(48, Math.ceil(sampledMetres / 4))),
    roadStations = transportRoadArcStations(edge.centerline, bridge.x, bridge.z,
      crossing.lo * crossing.metresPerUnit - 18,
      crossing.hi * crossing.metresPerUnit + 18, segmentCount),
    routeStationsOnRoad = roadStations.length === segmentCount + 1,
    routeStations = roadStations.map(point => {
      const surface = finalSurfaceAt(point.x, point.z);
      return { point, surface, localRoadSlope: openRoadSlope(point, surface) };
    }),
    approachLocalSlopes = [bankPoints.left, bankPoints.right].map((points, sideIndex) =>
      points.map((point, index) => openRoadSlope(point, approaches[sideIndex][index]))),
    // A walkable "open" bank can still exceed the road's 8% local grade.
    // Reuse the selected-corridor predicate for the same final-surface owner.
    routeFirstUnsafeIndex = routeStations.findIndex(({ point, surface, localRoadSlope }) =>
      !sampledCorridorStationPass({ ...point, edgeCode: edge.code }, surface, localRoadSlope)),
    routeStationsTopLegal = routeStationsOnRoad && routeFirstUnsafeIndex < 0,
    approachUnsafe = approaches.map((side, sideIndex) => side.findIndex((surface, index) =>
      surface.water.kind !== "none" || !sampledCorridorStationPass({
        ...bankPoints[sideIndex === 0 ? "left" : "right"][index], edgeCode: edge.code,
      }, surface, approachLocalSlopes[sideIndex][index]))),
    approachStationsTopLegal = approachStationsOnRoad && approachUnsafe.every(index => index < 0),
    firstUnsafeBankIndex = approachUnsafe[0] >= 0 ? 0 : approachUnsafe[1] >= 0 ? 1 : -1,
    firstUnsafeBankStation = firstUnsafeBankIndex < 0 ? null :
      bankPoints[firstUnsafeBankIndex === 0 ? "left" : "right"][approachUnsafe[firstUnsafeBankIndex]],
    firstUnsafeBankSurface = firstUnsafeBankIndex < 0 ? null :
      approaches[firstUnsafeBankIndex][approachUnsafe[firstUnsafeBankIndex]],
    firstUnsafeBankLocalSlope = firstUnsafeBankIndex < 0 ? undefined :
      approachLocalSlopes[firstUnsafeBankIndex][approachUnsafe[firstUnsafeBankIndex]],
    // Coordinate agreement is not enough: a walkable field/another road
    // must never certify the graph-selected road's physical crossing.
    routeStationsSurfaceOwned = routeStationsOnRoad && routeStations.every(({ surface }) =>
      surface.contributingModifierIds.includes(edge.code) &&
      (surface.water.kind !== "river" || surface.deckOwnerIds.includes(edge.code))),
    routeStationsWalkable = routeStationsSurfaceOwned && routeStations.every(({ surface }) =>
      surface.walkable &&
      (surface.water.kind === "none" ||
        (surface.water.kind === "river" && surface.deckHeight !== null && surface.traversal === "bridge"))),
    // Actual spherical station separation, never the nominal water-span step.
    // Reuse these grades to expose the first bad interval without extra samples.
    routeGrades = routeStationsOnRoad
      ? transportRoadIntervalGradeEvidence(roadStations,
          routeStations.map(({ surface }) => surface.surfaceHeight))
      : Object.freeze({ maximum: null as number | null,
          firstUnsafeStation: null as number | null, firstUnsafeGrade: null as number | null }),
    routeMaxSampledGrade = routeGrades.maximum;

  return Object.freeze({
    matchingCrossing: true,
    wetStations: wet.length,
    deckStationsWalkable: wet.length === 5 && wet.every(surface =>
      selectedRoadBridgeDeckWalkable(surface, edge.code)),
    dryLandingStations: dryLandingPoints.length,
    dryLandingDeckContact,
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
      sampledBridgeTopFailure(edge.code, routeStations[routeFirstUnsafeIndex].surface,
        routeStations[routeFirstUnsafeIndex].localRoadSlope),
    routeFirstUnsafeIntervalStation: routeGrades.firstUnsafeStation,
    routeFirstUnsafeIntervalGrade: routeGrades.firstUnsafeGrade,
    // Reuse an already measured open-bank slope, or measure a difficult
    // station only after its failure. Never confuse it with interval grade.
    routeFirstUnsafeLocalGrade: routeFirstUnsafeIndex < 0 ? null :
      routeStations[routeFirstUnsafeIndex].localRoadSlope ??
      (routeStations[routeFirstUnsafeIndex].surface.traversal === "difficult"
        ? finalSurfaceLocalSlopeAt(routeStations[routeFirstUnsafeIndex].point.x,
          routeStations[routeFirstUnsafeIndex].point.z) : null),
    approachStationsTopLegal,
    approachFirstUnsafeBank: approachUnsafe[0] >= 0 ? `left station ${approachUnsafe[0] + 1}` :
      approachUnsafe[1] >= 0 ? `right station ${approachUnsafe[1] + 1}` : null,
    approachFirstUnsafeCause: approachUnsafe[0] >= 0 ? (approaches[0][approachUnsafe[0]].water.kind !== "none"
      ? "wet bank" : sampledBridgeTopFailure(edge.code, approaches[0][approachUnsafe[0]],
        approachLocalSlopes[0][approachUnsafe[0]])) :
      approachUnsafe[1] >= 0 ? (approaches[1][approachUnsafe[1]].water.kind !== "none"
        ? "wet bank" : sampledBridgeTopFailure(edge.code, approaches[1][approachUnsafe[1]],
          approachLocalSlopes[1][approachUnsafe[1]])) : null,
    approachFirstUnsafeLocalGrade: firstUnsafeBankLocalSlope ??
      (firstUnsafeBankStation && firstUnsafeBankSurface?.water.kind === "none" &&
        firstUnsafeBankSurface.traversal === "difficult"
        ? finalSurfaceLocalSlopeAt(firstUnsafeBankStation.x, firstUnsafeBankStation.z) : null),
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
    span.deckStationsWalkable && span.dryLandingDeckContact && span.bankStationsWalkable &&
    span.approachStationsWalkable && span.approachGradeWithinLimit &&
    span.routeStationsWalkable && span.routeGradeWithinLimit &&
    span.routeStationsTopLegal && span.approachStationsTopLegal;
}
