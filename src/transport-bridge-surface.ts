import { freshwaterCrossingAt } from "./hydrology.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, sourceToLonLat, wrapSourceX } from "./planet.ts";
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
 * Sample the source-owned physical road in canonical metres from a bridge
 * anchor. Never extend beyond its recorded endpoints or invent a tangent
 * shortcut when the centerline bends. Focus-only, bounded by stationCount.
 */
export function transportRoadArcStations(
  points: readonly { x: number; z: number }[], x: number, z: number,
  fromMetres: number, toMetres: number, stationCount: number,
): readonly { x: number; z: number }[] {
  if (points.length < 2 || !Number.isInteger(stationCount) || stationCount < 1 || stationCount > 48 ||
    !Number.isFinite(fromMetres) || !Number.isFinite(toMetres) || fromMetres >= toMetres) return [];
  const segments: { a: { x: number; z: number }; dx: number; dz: number; start: number; lengthM: number }[] = [];
  let total = 0, best = Infinity, anchor = -1;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      squared = dx * dx + dz * dz;
    if (squared < 1e-12) continue;
    const sourceLength = Math.sqrt(squared),
      lat = sourceToLonLat(a.x, a.z).lat,
      lengthM = CANONICAL_METRES_PER_SOURCE_UNIT * Math.hypot(dx * Math.cos(lat), dz),
      qx = wrapSourceX(x - a.x), qz = z - a.z,
      fraction = Math.max(0, Math.min(1, (qx * dx + qz * dz) / squared)),
      distance = Math.hypot(qx - dx * fraction, qz - dz * fraction);
    if (distance < best) { best = distance; anchor = total + fraction * lengthM; }
    segments.push({ a, dx, dz, start: total, lengthM });
    total += lengthM;
  }
  const start = anchor + fromMetres, finish = anchor + toMetres;
  if (best > 2 / CANONICAL_METRES_PER_SOURCE_UNIT || start < -1e-6 || finish > total + 1e-6) return [];
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
 * Inspect one selected graph crossing, not every crossing during pan/zoom.
 * Bounded wet, bank, and road-aligned crossing samples report physical truth;
 * samples never certify unsampled continuity or executed protagonist travel.
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
    routeStations: 0,
    routeStationsOnRoad: false,
    routeStationsWalkable: false,
    routeMaxSampledGrade: null as number | null,
    routeGradeWithinLimit: false,
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
  // Sample the actual graph-owned centerline, not the projected straight
  // water-crossing tangent. The budget stays <=49 final-surface queries, and
  // missing physical bank-to-road coverage is reported as not certified.
  const sampledMetres = (crossing.hi - crossing.lo) * crossing.metresPerUnit + 36,
    segmentCount = Math.max(2, Math.min(48, Math.ceil(sampledMetres / 4))),
    roadStations = transportRoadArcStations(edge.centerline, bridge.x, bridge.z,
      crossing.lo * crossing.metresPerUnit - 18,
      crossing.hi * crossing.metresPerUnit + 18, segmentCount),
    routeStationsOnRoad = roadStations.length === segmentCount + 1,
    routeStations = roadStations.map(point => ({ surface: finalSurfaceAt(point.x, point.z) })),
    routeStationsWalkable = routeStationsOnRoad && routeStations.every(({ surface }) =>
      surface.walkable &&
      (surface.water.kind === "none" ||
        (surface.water.kind === "river" && surface.deckHeight !== null && surface.traversal === "bridge"))),
    routeGradeStepM = sampledMetres / segmentCount,
    routeMaxSampledGrade = routeStationsOnRoad ? Math.max(...routeStations.slice(1).map(({ surface }, index) => {
      const previous = routeStations[index].surface;
      return Math.abs((surface.deckHeight ?? surface.groundHeight) -
        (previous.deckHeight ?? previous.groundHeight)) / routeGradeStepM;
    })) : null;

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
    approachGradeWithinLimit: approachStationsOnRoad && approachMaxSampledGrade <= .08,
    routeStations: routeStations.length,
    routeStationsOnRoad,
    routeStationsWalkable,
    routeMaxSampledGrade,
    routeGradeWithinLimit: routeStationsWalkable && routeMaxSampledGrade !== null && routeMaxSampledGrade <= .08,
  });
}
