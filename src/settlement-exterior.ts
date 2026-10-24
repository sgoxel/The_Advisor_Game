import { compareText } from "./compare-text.ts";
import { mergeStreetWithRoads, sharedStreetSegments } from "./street-road-merge.ts";
import { places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import { houseDimensionsFor, metresToSource, physicalFootprintRadius, type HouseDimensions } from "./physical-scale.ts";
import {
  SETTLEMENT_POPULATION,
  settlementExteriorFor as coreSettlementExteriorFor,
  settlementLotFor,
  type SettlementArchetype,
  type SettlementExteriorPlan as CoreExteriorPlan,
  type SettlementFieldForm,
  type SettlementGatePlan,
  type SettlementPlotPlan as CorePlotPlan,
  type SettlementPoint,
  type SettlementService as CoreService,
  type SettlementStreetPlan,
} from "./settlement-exterior-core.ts";

export type { SettlementArchetype, SettlementFieldForm, SettlementGatePlan, SettlementPoint, SettlementStreetPlan };
export type SettlementService = CoreService | "merchant" | "headman";
export type SettlementPlotKind = CorePlotPlan["kind"] | "garden";
export type SettlementPlotPlan = Omit<CorePlotPlan, "kind" | "service"> & {
  kind: SettlementPlotKind;
  service?: SettlementService;
  widthM?: number;
  depthM?: number;
  house?: HouseDimensions;
};
export type SettlementExteriorPlan = Omit<CoreExteriorPlan, "plots"> & {
  /** Static/public plots only. Resident homes are generated analytically on demand. */
  plots: readonly SettlementPlotPlan[];
  residentHomeCount: number;
};

export const SETTLEMENT_EXTERIOR_CACHE_LIMIT = 12;
const cache = new Map<string, SettlementExteriorPlan>();
const SERVICE_OWNER: Readonly<Partial<Record<CoreService, number>>> = {
  inn: 0,
  market: 1,
  blacksmith: 2,
  farmstead: 3,
  butcher: 4,
  "guard-office": 5,
};

function digest(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function unit(address: string) { return digest(address) / 4294967296; }
function normalize(x: number, z: number) {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}
export function canonicalSettlementPopulation(place: Place) {
  return SETTLEMENT_POPULATION[place.kind];
}

/**
 * One canonical one-person residence per resident, on its own frontage lot.
 * Lots are generated in metres along every street of the settlement (see
 * settlement-exterior-core.ts), each with a setback from the street edge, so
 * houses form continuous street fronts that face the road. A resident's lot is
 * a seed-keyed walk over all lots; camera, visit order, LOD, cache state and
 * renderer backend never contribute.
 */
export function homeClearanceRadius(widthM: number, depthM: number) {
  return metresToSource(Math.max(widthM, depthM) * .5 + .35);
}
export function settlementHomeFor(place: Place, index: number, suppliedPlan?: SettlementExteriorPlan): SettlementPlotPlan {
  const population = canonicalSettlementPopulation(place);
  if (!Number.isInteger(index) || index < 0 || index >= population) throw new RangeError(`Invalid resident home index ${index} for ${place.code}`);
  void suppliedPlan;
  const city = place.kind === "city", lot = settlementLotFor(place, index),
    house = houseDimensionsFor(`${place.code}/RESIDENCE/${index}`, city),
    shift = (house.depthM - lot.nominalDepthM) * .5,
    yawRad = lot.yawRad + (unit(`${place.code}/RESIDENCE/${index}/YAW`) - .5) * (city ? .06 : .1),
    at = (along: number, depth = 0): SettlementPoint => ({
      x: wrapSourceX(lot.x + lot.out.x * (shift + depth) + lot.along.x * along),
      z: lot.z + lot.out.z * (shift + depth) + lot.along.z * along,
    });
  return {
    id: `${place.code}/RESIDENCE/${index}`,
    kind: "house",
    ownerId: `${place.code}/RESIDENT/${index}`,
    capacity: 1,
    residents: 1,
    width: metresToSource(house.widthM),
    depth: metresToSource(house.depthM),
    widthM: house.widthM,
    depthM: house.depthM,
    house,
    yawRad,
    clearanceRadius: homeClearanceRadius(house.widthM, house.depthM),
    // If local final terrain rejects the usual frontage position, keep
    // searching within the SAME assigned SEED lot. No radial town relocation
    // and no change of resident identity or housing ownership.
    candidates: [at(0), at(-.6), at(.6), at(-1.2), at(1.2),
      at(0, -.8), at(0, .8), at(-.6, -.8), at(.6, -.8), at(-.6, .8), at(.6, .8)],
  };
}

function servicePlot(place: Place, plot: CorePlotPlan): SettlementPlotPlan {
  if (plot.kind !== "service" || !plot.service) return plot;
  const ownerIndex = SERVICE_OWNER[plot.service], population = canonicalSettlementPopulation(place),
    staff = Math.max(1, Math.min(12, Math.ceil(population / (plot.service === "farmstead" ? 700 : 1100))));
  return { ...plot, ownerId: ownerIndex === undefined ? plot.ownerId : `${place.code}/RESIDENT/${ownerIndex}`, residents: staff, capacity: Math.max(plot.capacity, staff) };
}
/** A small rear garden behind the house, inside its own frontage lot. */
function gardenFor(place: Place, index: number): SettlementPlotPlan {
  const lot = settlementLotFor(place, index), home = settlementHomeFor(place, index),
    widthM = 3 + unit(`${place.code}/GARDEN/${index}/WIDTH`) * 1.2, depthM = 3 + unit(`${place.code}/GARDEN/${index}/DEPTH`) * 1.2,
    // Static gardens resolve before lazy homes. Their clearance disks must
    // leave room for the owner house; mere footprint-depth separation can
    // reject the required house (e.g. guard residence 8) as "unresolved".
    behind = Math.max(
      (home.depthM || 8) * .5 + depthM * .5 + .4,
      Math.max(home.widthM ?? 8, home.depthM ?? 8) * .5 + .35 + Math.hypot(widthM, depthM) * .5 + .1 + .4,
    );
  return {
    id: `${place.code}/GARDEN/${index}`, kind: "garden", ownerId: home.ownerId, capacity: 0, residents: 0,
    width: metresToSource(widthM), depth: metresToSource(depthM), widthM, depthM, yawRad: home.yawRad,
    clearanceRadius: metresToSource(Math.hypot(widthM, depthM) * .5 + .1),
    candidates: home.candidates.map((candidate) => ({ x: wrapSourceX(candidate.x + lot.out.x * behind), z: candidate.z + lot.out.z * behind })),
  };
}

type TerminalApproach = { road: Road; x: number; z: number; snapBorder?: boolean };
const roadEdgesByNode = new Map<string, Road[]>();
for (const road of roads) if (road.networkKind !== "detour" && road.centerline && road.centerline.length >= 2) {
  for (const nodeId of [road.from, road.to]) {
    const connected = roadEdgesByNode.get(nodeId) || [];
    connected.push(road);
    roadEdgesByNode.set(nodeId, connected);
  }
}
for (const connected of roadEdgesByNode.values()) connected.sort((a, b) => compareText(a.code, b.code));

function orientedRoadPoints(road: Road, entryNodeId: string) {
  const source = road.centerline!;
  return road.from === entryNodeId ? source : [...source].reverse();
}
function segmentIntersection(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): { t: number; u: number } | undefined {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz,
    denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const qx = cx - ax, qz = cz - az,
    t = (qx * sz - qz * sx) / denominator,
    u = (qx * rz - qz * rx) / denominator;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return undefined;
  return { t, u };
}
function roadBorderIntersection(place: Place, road: Road, border: readonly SettlementPoint[], entryNodeId: string): SettlementPoint | undefined {
  const source = road.centerline;
  if (!source || source.length < 2) return undefined;
  const points = orientedRoadPoints(road, entryNodeId);
  for (let segment = 0; segment < points.length - 1; segment++) {
    const a = points[segment], b = points[segment + 1],
      ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
      bx = ax + wrapSourceX(b.x - a.x), bz = b.z - place.z;
    for (let edge = 0; edge < border.length; edge++) {
      const c = border[edge], d = border[(edge + 1) % border.length],
        cx = wrapSourceX(c.x - place.x), cz = c.z - place.z,
        dx = cx + wrapSourceX(d.x - c.x), dz = d.z - place.z,
        hit = segmentIntersection(ax, az, bx, bz, cx, cz, dx, dz);
      if (!hit) continue;
      return { x: wrapSourceX(place.x + ax + (bx - ax) * hit.t), z: place.z + az + (bz - az) * hit.t };
    }
  }
  return undefined;
}
function roadPointAtRadius(place: Place, road: Road, radius: number, entryNodeId: string): SettlementPoint | undefined {
  const source = road.centerline;
  if (!source || source.length < 2) return undefined;
  const points = orientedRoadPoints(road, entryNodeId), radiusSquared = radius * radius;
  for (let segment = 0; segment < points.length - 1; segment++) {
    const a = points[segment], b = points[segment + 1],
      ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
      bx = ax + wrapSourceX(b.x - a.x), bz = b.z - place.z,
      vx = bx - ax, vz = bz - az,
      qa = vx * vx + vz * vz,
      qb = 2 * (ax * vx + az * vz),
      qc = ax * ax + az * az - radiusSquared,
      discriminant = qb * qb - 4 * qa * qc;
    if (qa < 1e-12 || discriminant < 0) continue;
    const root = Math.sqrt(Math.max(0, discriminant)), roots = [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].sort((left, right) => left - right);
    for (const t of roots) if (t >= -1e-6 && t <= 1 + 1e-6) {
      const bounded = Math.max(0, Math.min(1, t));
      return { x: wrapSourceX(place.x + ax + vx * bounded), z: place.z + az + vz * bounded };
    }
  }
  return undefined;
}
function pointInsideBorder(place: Place, border: readonly SettlementPoint[], x: number, z: number) {
  const px = wrapSourceX(x - place.x), pz = z - place.z;
  let inside = false;
  for (let index = 0, previous = border.length - 1; index < border.length; previous = index++) {
    const a = border[index], b = border[previous],
      ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
      bx = wrapSourceX(b.x - place.x), bz = b.z - place.z;
    if ((az > pz) !== (bz > pz) && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
/** Presentation only: village lanes stop at the real enclosure, never create exterior graph links. */
export function visibleSettlementStreetSegments(
  place: Place, plan: SettlementExteriorPlan, a: SettlementPoint, b: SettlementPoint,
): readonly (readonly [SettlementPoint, SettlementPoint])[] {
  if (place.kind !== "village") return [[a, b]];
  const ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
    dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
    cuts = [0, 1];
  for (let edge = 0; edge < plan.border.length; edge++) {
    const c = plan.border[edge], d = plan.border[(edge + 1) % plan.border.length],
      cx = wrapSourceX(c.x - place.x), cz = c.z - place.z,
      ex = wrapSourceX(d.x - c.x), ez = d.z - c.z,
      hit = segmentIntersection(ax, az, ax + dx, az + dz, cx, cz, cx + ex, cz + ez);
    if (hit) cuts.push(Math.max(0, Math.min(1, hit.t)));
  }
  cuts.sort((a, b) => a - b);
  const unique = cuts.filter((t, index) => index === 0 || t - cuts[index - 1] > 1e-7),
    at = (t: number): SettlementPoint => ({ x: wrapSourceX(a.x + dx * t), z: a.z + dz * t }),
    visible: [SettlementPoint, SettlementPoint][] = [];
  for (let index = 1; index < unique.length; index++) {
    const from = unique[index - 1], to = unique[index];
    if (to - from < 1e-7 || !pointInsideBorder(place, plan.border, at((from + to) / 2).x, a.z + dz * (from + to) / 2)) continue;
    visible.push([at(from), at(to)]);
  }
  return visible;
}

function terminalApproaches(place: Place, plan: SettlementExteriorPlan): TerminalApproach[] {
  const queue = [place.id], visitedNodes = new Set(queue), visitedRoads = new Set<string>(), approaches: TerminalApproach[] = [];
  while (queue.length) {
    const nodeId = queue.shift()!;
    for (const road of roadEdgesByNode.get(nodeId) || []) {
      if (visitedRoads.has(road.code)) continue;
      visitedRoads.add(road.code);
      const hit = roadBorderIntersection(place, road, plan.border, nodeId);
      if (hit) {
        approaches.push({ road, ...hit });
        continue;
      }
      const points = orientedRoadPoints(road, nodeId), exit = points[points.length - 1], otherNodeId = road.from === nodeId ? road.to : road.from;
      if (pointInsideBorder(place, plan.border, exit.x, exit.z)) {
        if (!visitedNodes.has(otherNodeId)) {
          visitedNodes.add(otherNodeId);
          queue.push(otherNodeId);
        }
        continue;
      }
      const fallback = roadPointAtRadius(place, road, plan.radius, nodeId);
      if (fallback) approaches.push({ road, ...fallback, snapBorder: true });
    }
  }
  const distinct: TerminalApproach[] = [];
  for (const approach of approaches.sort((a, b) => compareText(a.road.code, b.road.code))) {
    if (distinct.some((other) => Math.hypot(wrapSourceX(other.x - approach.x), other.z - approach.z) < .1)) continue;
    distinct.push(approach);
  }
  return distinct.slice(0, 2);
}
function physicalGateApproaches(place: Place, plan: SettlementExteriorPlan): TerminalApproach[] {
  if (place.kind !== "village") return [];
  const crossingRoads: Road[] = [], candidates: TerminalApproach[] = [];
  for (const road of roads) {
    if (road.networkKind === "detour" || !road.centerline || road.centerline.length < 2 || roadDistanceAt(place.x, place.z, road) > plan.radius * 1.7) continue;
    const hits = [roadBorderIntersection(place, road, plan.border, road.from), roadBorderIntersection(place, road, plan.border, road.to)].filter((hit): hit is SettlementPoint => Boolean(hit));
    if (!hits.length) continue;
    crossingRoads.push(road);
    for (const hit of hits) if (!candidates.some((candidate) => Math.hypot(wrapSourceX(candidate.x - hit.x), candidate.z - hit.z) < 1e-6)) candidates.push({ road, ...hit });
  }
  if (!crossingRoads.length) return [];
  const coverage = candidates.map((candidate) => new Set(crossingRoads.filter((road) => roadDistanceAt(candidate.x, candidate.z, road) < .045).map((road) => road.code))),
    coversAll = (indices: readonly number[]) => {
      const covered = new Set<string>();
      for (const index of indices) for (const code of coverage[index]) covered.add(code);
      return covered.size === crossingRoads.length;
    };
  for (let index = 0; index < candidates.length; index++) if (coversAll([index])) return [candidates[index]];
  for (let first = 0; first < candidates.length; first++) for (let second = first + 1; second < candidates.length; second++) {
    if (coversAll([first, second])) return [candidates[first], candidates[second]];
  }
  return [];
}
function segmentCrossesBorder(place: Place, border: readonly SettlementPoint[], a: { x: number; z: number }, b: { x: number; z: number }) {
  const ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
    bx = ax + wrapSourceX(b.x - a.x), bz = b.z - place.z;
  for (let edge = 0; edge < border.length; edge++) {
    const c = border[edge], d = border[(edge + 1) % border.length],
      cx = wrapSourceX(c.x - place.x), cz = c.z - place.z,
      dx = cx + wrapSourceX(d.x - c.x), dz = d.z - place.z,
      hit = segmentIntersection(ax, az, bx, bz, cx, cz, dx, dz);
    if (hit && hit.t > 1e-5 && hit.t < 1 - 1e-5) return true;
  }
  return pointInsideBorder(place, border, a.x, a.z) || pointInsideBorder(place, border, b.x, b.z);
}
function clipBorderToVillageSide(place: Place, border: readonly SettlementPoint[], a: { x: number; z: number }, b: { x: number; z: number }) {
  const ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
    bx = ax + wrapSourceX(b.x - a.x), bz = b.z - place.z,
    vx = bx - ax, vz = bz - az, length = Math.hypot(vx, vz),
    centreCross = vx * -az - vz * -ax;
  if (length < 1e-9 || Math.abs(centreCross) < 1e-6) return border.map((point) => ({ ...point }));
  const side = centreCross > 0 ? 1 : -1,
    centreDistance = Math.abs(centreCross) / length,
    clearance = Math.min(2.5, centreDistance * .25),
    local = border.map((point) => ({ x: wrapSourceX(point.x - place.x), z: point.z - place.z })),
    signedDistance = (point: SettlementPoint) => side * (vx * (point.z - az) - vz * (point.x - ax)) / length,
    clipped: SettlementPoint[] = [];
  for (let index = 0; index < local.length; index++) {
    const previous = local[(index + local.length - 1) % local.length], current = local[index],
      previousDistance = signedDistance(previous), currentDistance = signedDistance(current),
      previousInside = previousDistance >= clearance, currentInside = currentDistance >= clearance;
    if (previousInside !== currentInside) {
      const denominator = currentDistance - previousDistance,
        t = Math.abs(denominator) < 1e-9 ? 0 : (clearance - previousDistance) / denominator;
      clipped.push({ x: previous.x + (current.x - previous.x) * t, z: previous.z + (current.z - previous.z) * t });
    }
    if (currentInside) clipped.push(current);
  }
  if (clipped.length < 3) return border.map((point) => ({ ...point }));
  return clipped.map((point) => ({ x: wrapSourceX(place.x + point.x), z: place.z + point.z }));
}
function clipBorderBeforeJunction(place: Place, border: readonly SettlementPoint[], x: number, z: number) {
  const jx = wrapSourceX(x - place.x), jz = z - place.z, distance = Math.hypot(jx, jz);
  if (distance < 1e-6) return border.map((point) => ({ ...point }));
  const ux = jx / distance, uz = jz / distance,
    cutoff = distance,
    local = border.map((point) => ({ x: wrapSourceX(point.x - place.x), z: point.z - place.z })),
    projected = (point: SettlementPoint) => point.x * ux + point.z * uz,
    clipped: SettlementPoint[] = [];
  for (let index = 0; index < local.length; index++) {
    const previous = local[(index + local.length - 1) % local.length], current = local[index],
      previousProjection = projected(previous), currentProjection = projected(current),
      previousInside = previousProjection <= cutoff, currentInside = currentProjection <= cutoff;
    if (previousInside !== currentInside) {
      const denominator = currentProjection - previousProjection,
        t = Math.abs(denominator) < 1e-9 ? 0 : (cutoff - previousProjection) / denominator;
      clipped.push({ x: previous.x + (current.x - previous.x) * t, z: previous.z + (current.z - previous.z) * t });
    }
    if (currentInside) clipped.push(current);
  }
  if (clipped.length < 3) return border.map((point) => ({ ...point }));
  return clipped.map((point) => ({ x: wrapSourceX(place.x + point.x), z: place.z + point.z }));
}
function trimInternalRoadJunctions(place: Place, plan: SettlementExteriorPlan): SettlementExteriorPlan {
  if (place.kind !== "village") return plan;
  const junctions = new Map<string, SettlementPoint>();
  for (const road of roads) {
    if (road.networkKind === "detour" || roadDistanceAt(place.x, place.z, road) > plan.radius * 1.7) continue;
    if (road.from.startsWith("J/")) junctions.set(road.from, { x: road.fromX, z: road.fromZ });
    if (road.to.startsWith("J/")) junctions.set(road.to, { x: road.toX, z: road.toZ });
  }
  const ordered = [...junctions.entries()].sort((left, right) => {
    const a = Math.hypot(wrapSourceX(left[1].x - place.x), left[1].z - place.z), b = Math.hypot(wrapSourceX(right[1].x - place.x), right[1].z - place.z);
    return a - b || compareText(left[0], right[0]);
  });
  let border = plan.border.map((point) => ({ ...point }));
  for (const [, junction] of ordered) if (pointInsideBorder(place, border, junction.x, junction.z)) border = clipBorderBeforeJunction(place, border, junction.x, junction.z);
  return border.length === plan.border.length && border.every((point, index) => point.x === plan.border[index].x && point.z === plan.border[index].z) ? plan : { ...plan, border };
}
function trimForeignRoadCrossings(place: Place, plan: SettlementExteriorPlan): SettlementExteriorPlan {
  if (place.kind !== "village") return plan;
  const localRoadIds = new Set(roads.filter((road) => road.from === place.id || road.to === place.id).map((road) => road.networkId)),
    foreignRoads = roads.filter((road) => road.networkKind !== "detour" && road.centerline && road.centerline.length >= 2 && !localRoadIds.has(road.networkId) && roadDistanceAt(place.x, place.z, road) <= plan.radius * 1.7)
      .sort((a, b) => compareText(a.code, b.code));
  let border = plan.border.map((point) => ({ ...point }));
  for (const road of foreignRoads) {
    const points = road.centerline!;
    for (let segment = 0; segment < points.length - 1; segment++) {
      const a = points[segment], b = points[segment + 1];
      if (!segmentCrossesBorder(place, border, a, b)) continue;
      border = clipBorderToVillageSide(place, border, a, b);
    }
  }
  return border.length === plan.border.length && border.every((point, index) => point.x === plan.border[index].x && point.z === plan.border[index].z) ? plan : { ...plan, border };
}
function alignGatesToRoads(place: Place, suppliedPlan: SettlementExteriorPlan): SettlementExteriorPlan {
  if (!suppliedPlan.gates.length || !suppliedPlan.streets.length) return suppliedPlan;
  const foreignTrimmed = trimForeignRoadCrossings(place, suppliedPlan), plan = trimInternalRoadJunctions(place, foreignTrimmed),
    physicalApproaches = physicalGateApproaches(place, plan), approaches = physicalApproaches.length ? physicalApproaches : terminalApproaches(place, plan), main = plan.streets[0];
  if (!approaches.length || main.points.length < 2) return plan;
  const targetGateCount = Math.min(2, approaches.length),
    gateTemplates = plan.gates.slice(0, targetGateCount).map((gate) => ({ ...gate, guardPosts: gate.guardPosts.map((post) => ({ ...post })) }));
  while (gateTemplates.length < targetGateCount) {
    const template = gateTemplates[0] || plan.gates[0];
    gateTemplates.push({ ...template, id: `${place.code}/GATE/${gateTemplates.length}`, guardPosts: template.guardPosts.map((post) => ({ ...post })) });
  }
  const gates = gateTemplates.map((gate, index) => {
    const approach = approaches[index];
    const outward = normalize(wrapSourceX(approach.x - place.x), approach.z - place.z), normal = { x: -outward.z, z: outward.x },
      guardPosts = gate.guardPosts.map((_, guardIndex) => ({
        x: wrapSourceX(approach.x + normal.x * metresToSource(guardIndex === 0 ? 9 : -9)), z: approach.z + normal.z * metresToSource(guardIndex === 0 ? 9 : -9),
      }));
    return { ...gate, x: approach.x, z: approach.z, bearingRad: Math.atan2(outward.z, outward.x), guardPosts };
  }), border = plan.border.map((point) => ({ ...point })), usedBorderVertices = new Set<number>();
  for (const approach of approaches) if (approach.snapBorder) {
    let nearest = -1, nearestDistance = Infinity;
    for (let index = 0; index < border.length; index++) {
      if (usedBorderVertices.has(index)) continue;
      const distance = Math.hypot(wrapSourceX(border[index].x - approach.x), border[index].z - approach.z);
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
    }
    if (nearest >= 0) {
      border[nearest] = { x: approach.x, z: approach.z };
      usedBorderVertices.add(nearest);
    }
  }
  const primary = gates[0], mainPoints = main.points.map((point) => ({ ...point })),
    start = mainPoints[0], end = mainPoints[mainPoints.length - 1],
    distance = (a: SettlementPoint, b: SettlementPoint) => Math.hypot(wrapSourceX(a.x - b.x), a.z - b.z);
  const primaryAtStart = distance(start, primary) <= distance(end, primary),
    primaryOnlySpan = distance(primary, primaryAtStart ? end : start);
  if (gates.length === 2 && distance(gates[0], gates[1]) >= Math.max(24, primaryOnlySpan * .95)) {
    // Nearby gates can collapse the residential street's chord and overlap
    // canonical homes. Snap both only when they span a genuinely long
    // interior approach; otherwise retain the proven primary-gate layout.
    const direct = distance(start, gates[0]) + distance(end, gates[1]),
      reverse = distance(start, gates[1]) + distance(end, gates[0]),
      startGate = direct <= reverse ? gates[0] : gates[1],
      endGate = direct <= reverse ? gates[1] : gates[0];
    mainPoints[0] = { x: startGate.x, z: startGate.z };
    mainPoints[mainPoints.length - 1] = { x: endGate.x, z: endGate.z };
  } else if (primaryAtStart) {
    mainPoints[0] = { x: primary.x, z: primary.z };
  } else {
    mainPoints[mainPoints.length - 1] = { x: primary.x, z: primary.z };
  }
  return { ...plan, entrance: { x: primary.x, z: primary.z }, streets: [{ ...main, points: mainPoints }, ...plan.streets.slice(1)], gates, border };
}
function remember(plan: SettlementExteriorPlan) {
  cache.delete(plan.placeCode);
  cache.set(plan.placeCode, plan);
  while (cache.size > SETTLEMENT_EXTERIOR_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return plan;
}

export function settlementExteriorFor(place: Place): SettlementExteriorPlan {
  const existing = cache.get(place.code);
  if (existing) return remember(existing);
  const core = coreSettlementExteriorFor(place), plots: SettlementPlotPlan[] = [];
  for (const plot of core.plots) if (plot.kind !== "house") {
    const owned = servicePlot(place, plot);
    plots.push({
      ...owned, widthM: plot.width, depthM: plot.depth,
      width: metresToSource(plot.width), depth: metresToSource(plot.depth),
      clearanceRadius: plot.kind === "field" ? metresToSource(plot.clearanceRadius) : physicalFootprintRadius(plot.width * 1.08, plot.depth * 1.08, place.z, 1.5),
    });
  }
  const residentHomeCount = canonicalSettlementPopulation(place), gardenStride = place.kind === "city" ? 48 : 8;
  for (let index = 0; index < residentHomeCount; index += gardenStride) plots.push(gardenFor(place, index));
  const aligned = alignGatesToRoads(place, { ...core, plots, residentHomeCount });
  const nearRoads=roads.filter(road=>roadDistanceAt(place.x,place.z,road)<aligned.radius+metresToSource(30));
  return remember({ ...aligned, streets: aligned.streets.map(street => {
    const points=mergeStreetWithRoads(street.points,street.width,nearRoads);
    return {...street,points,sharedSegments:sharedStreetSegments(points,street.width,nearRoads),width:metresToSource(street.width)};
  }) });
}
export function settlementExteriorCacheSize() { return cache.size; }

/** Diagnostics count canonical homes analytically; they never materialize all homes. */
export function settlementExteriorSummary() {
  let cityGates = 0, villageGates = 0, plots = 0, streets = 0, borderPoints = 0;
  const archetypes: Partial<Record<SettlementArchetype, number>> = {};
  for (const place of places) {
    const core = coreSettlementExteriorFor(place), population = canonicalSettlementPopulation(place), nonHomes = core.plots.filter((plot) => plot.kind !== "house").length,
      gardens = Math.ceil(population / (place.kind === "city" ? 48 : 8));
    plots += nonHomes + population + gardens; streets += core.streets.length; borderPoints += core.border.length;
    archetypes[core.archetype] = (archetypes[core.archetype] || 0) + 1;
    if (place.kind === "city") cityGates += core.gates.length; else villageGates += core.gates.length;
  }
  return { plans: places.length, plots, streets, borderPoints, cityGates, villageGates, archetypes, cachedPlans: cache.size } as const;
}
