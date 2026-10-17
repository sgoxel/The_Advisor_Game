import { places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import {
  settlementExteriorFor as coreSettlementExteriorFor,
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
  return place.kind === "city" ? 2400 : 80;
}

function residentialSpineLength(street: SettlementStreetPlan) {
  const a = street.points[0], b = street.points[street.points.length - 1];
  return Math.hypot(wrapSourceX(b.x - a.x), b.z - a.z);
}
function pointOnResidentialSpine(street: SettlementStreetPlan, fraction: number) {
  const a = street.points[0], b = street.points[street.points.length - 1],
    dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz) || 1,
    axis = { x: dx / length, z: dz / length }, normal = { x: -axis.z, z: axis.x },
    t = Math.max(0, Math.min(1, fraction)), reference = street.points[Math.floor((street.points.length - 1) * .5)],
    referenceX = wrapSourceX(reference.x - a.x), referenceZ = reference.z - a.z,
    measuredBend = referenceX * normal.x + referenceZ * normal.z,
    bend = Math.max(-12, Math.min(12, measuredBend)), wave = Math.sin(Math.PI * t) * bend,
    slope = (Math.PI * bend / length) * Math.cos(Math.PI * t), tangent = normalize(axis.x + normal.x * slope, axis.z + normal.z * slope);
  return {
    point: { x: wrapSourceX(a.x + axis.x * length * t + normal.x * wave), z: a.z + axis.z * length * t + normal.z * wave },
    tangent,
    normal: { x: -tangent.z, z: tangent.x },
  };
}
function offsetPoint(base: ReturnType<typeof pointOnResidentialSpine>, along: number, lateral: number): SettlementPoint {
  return { x: wrapSourceX(base.point.x + base.tangent.x * along + base.normal.x * lateral), z: base.point.z + base.tangent.z * along + base.normal.z * lateral };
}

/**
 * One canonical one-person residence per resident. Residences advance
 * monotonically along the canonical first-street chord, with a bounded smooth
 * bend derived from that street and deterministic staggered ribbons. City
 * footprints remain readable at settlement scale while primary spacing stays
 * disjoint by construction. Camera, visit order, LOD, cache state and renderer
 * backend never contribute.
 */
export function settlementHomeFor(place: Place, index: number, suppliedPlan?: SettlementExteriorPlan): SettlementPlotPlan {
  const population = canonicalSettlementPopulation(place);
  if (!Number.isInteger(index) || index < 0 || index >= population) throw new RangeError(`Invalid resident home index ${index} for ${place.code}`);
  const plan = suppliedPlan || settlementExteriorFor(place), street = plan.streets[0], city = place.kind === "city",
    spineLength = residentialSpineLength(street),
    maximumWidth = city ? 2.05 : .94,
    maximumDepth = city ? 2.28 : 1.06,
    maximumHomeRadius = Math.hypot(maximumWidth, maximumDepth) * .5 + (city ? .16 : .1),
    minimumAlongSpacing = maximumHomeRadius * 2 + (city ? .5 : .08),
    maximumSlotsPerRibbon = Math.max(1, Math.floor(spineLength * .88 / minimumAlongSpacing)),
    minimumRibbonCount = Math.ceil(population / maximumSlotsPerRibbon),
    bandCount = Math.max(city ? 24 : 8, Math.ceil(minimumRibbonCount / 2)),
    ribbonCount = bandCount * 2,
    ribbon = index % ribbonCount,
    ordinal = Math.floor(index / ribbonCount),
    slotsPerRibbon = Math.ceil(population / ribbonCount),
    side: -1 | 1 = (ribbon & 1) === 0 ? -1 : 1,
    band = Math.floor(ribbon / 2),
    ribbonPhase = city ? (unit(`${place.code}/RESIDENCE/RIBBON/${ribbon}/PHASE`) - .5) * .28 : 0,
    fraction = .06 + ((ordinal + .5 + ribbonPhase) / slotsPerRibbon) * .88,
    base = pointOnResidentialSpine(street, fraction),
    width = city ? 1.45 + unit(`${place.code}/RESIDENCE/${index}/WIDTH`) * .6 : .68 + unit(`${place.code}/RESIDENCE/${index}/WIDTH`) * .26,
    depth = city ? 1.62 + unit(`${place.code}/RESIDENCE/${index}/DEPTH`) * .66 : .78 + unit(`${place.code}/RESIDENCE/${index}/DEPTH`) * .28,
    setback = city ? 2.75 + band * 4.15 : 1.65 + band * 2.2,
    lateralJitter = city ? (unit(`${place.code}/RESIDENCE/${index}/LATERAL`) - .5) * .42 : 0,
    lateral = side * (street.width * .5 + setback + depth * .5) + lateralJitter,
    yawRad = Math.atan2(-base.normal.x * side, -base.normal.z * side) + (unit(`${place.code}/RESIDENCE/${index}/YAW`) - .5) * (city ? .13 : .05),
    spacing = Math.max(city ? 4.4 : 2.2, spineLength * .88 / slotsPerRibbon),
    alongJitter = city ? (unit(`${place.code}/RESIDENCE/${index}/ALONG`) - .5) * Math.min(1.4, spacing * .16) : 0,
    shift = Math.min(city ? 1.05 : .28, spacing * .08),
    candidates: SettlementPoint[] = [offsetPoint(base, alongJitter, lateral)];
  for (const along of [-shift, shift, -shift * 2, shift * 2]) candidates.push(offsetPoint(base, alongJitter + along, lateral));
  return {
    id: `${place.code}/RESIDENCE/${index}`,
    kind: "house",
    ownerId: `${place.code}/RESIDENT/${index}`,
    capacity: 1,
    residents: 1,
    width,
    depth,
    yawRad,
    clearanceRadius: Math.hypot(width, depth) * .5 + (city ? .16 : .1),
    candidates,
  };
}

function servicePlot(place: Place, plot: CorePlotPlan): SettlementPlotPlan {
  if (plot.kind !== "service" || !plot.service) return plot;
  const ownerIndex = SERVICE_OWNER[plot.service], population = canonicalSettlementPopulation(place),
    staff = Math.max(1, Math.min(12, Math.ceil(population / (plot.service === "farmstead" ? 700 : 1100))));
  return { ...plot, ownerId: ownerIndex === undefined ? plot.ownerId : `${place.code}/RESIDENT/${ownerIndex}`, residents: staff, capacity: Math.max(plot.capacity, staff) };
}
function gardenFor(place: Place, home: SettlementPlotPlan, index: number): SettlementPlotPlan {
  const width = 1.4 + unit(`${place.code}/GARDEN/${index}/WIDTH`) * .7, depth = 1.6 + unit(`${place.code}/GARDEN/${index}/DEPTH`) * .8,
    candidates = home.candidates.map((candidate) => ({
      x: wrapSourceX(candidate.x + Math.cos(home.yawRad) * (home.width * .5 + width * .5 + .45)),
      z: candidate.z - Math.sin(home.yawRad) * (home.width * .5 + width * .5 + .45),
    }));
  return { id: `${place.code}/GARDEN/${index}`, kind: "garden", ownerId: home.ownerId, capacity: 0, residents: 0, width, depth, yawRad: home.yawRad, clearanceRadius: Math.hypot(width, depth) * .5 + .12, candidates };
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
for (const connected of roadEdgesByNode.values()) connected.sort((a, b) => a.code.localeCompare(b.code));

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
  for (const approach of approaches.sort((a, b) => a.road.code.localeCompare(b.road.code))) {
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
    return a - b || left[0].localeCompare(right[0]);
  });
  let border = plan.border.map((point) => ({ ...point }));
  for (const [, junction] of ordered) if (pointInsideBorder(place, border, junction.x, junction.z)) border = clipBorderBeforeJunction(place, border, junction.x, junction.z);
  return border.length === plan.border.length && border.every((point, index) => point.x === plan.border[index].x && point.z === plan.border[index].z) ? plan : { ...plan, border };
}
function trimForeignRoadCrossings(place: Place, plan: SettlementExteriorPlan): SettlementExteriorPlan {
  if (place.kind !== "village") return plan;
  const localRoadIds = new Set(roads.filter((road) => road.from === place.id || road.to === place.id).map((road) => road.networkId)),
    foreignRoads = roads.filter((road) => road.networkKind !== "detour" && road.centerline && road.centerline.length >= 2 && !localRoadIds.has(road.networkId) && roadDistanceAt(place.x, place.z, road) <= plan.radius * 1.7)
      .sort((a, b) => a.code.localeCompare(b.code));
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
        x: wrapSourceX(approach.x + normal.x * (guardIndex === 0 ? 9 : -9)), z: approach.z + normal.z * (guardIndex === 0 ? 9 : -9),
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
    useStart = Math.hypot(wrapSourceX(start.x - primary.x), start.z - primary.z) <= Math.hypot(wrapSourceX(end.x - primary.x), end.z - primary.z);
  if (useStart) mainPoints[0] = { x: primary.x, z: primary.z }; else mainPoints[mainPoints.length - 1] = { x: primary.x, z: primary.z };
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
  for (const plot of core.plots) if (plot.kind !== "house") plots.push(servicePlot(place, plot));
  const residentHomeCount = canonicalSettlementPopulation(place), gardenStride = place.kind === "city" ? 48 : 8;
  for (let index = 0; index < residentHomeCount; index += gardenStride) plots.push(gardenFor(place, settlementHomeFor(place, index, { ...core, plots: [], residentHomeCount }), index));
  return remember(alignGatesToRoads(place, { ...core, plots, residentHomeCount }));
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