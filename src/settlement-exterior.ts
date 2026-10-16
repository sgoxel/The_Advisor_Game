import { places, roads, type Place, type Road } from "./geography.ts";
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

function pointOnResidentialSpine(street: SettlementStreetPlan, fraction: number) {
  const a = street.points[0], b = street.points[street.points.length - 1],
    dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
    t = Math.max(0, Math.min(1, fraction)), tangent = normalize(dx, dz);
  return {
    point: { x: wrapSourceX(a.x + dx * t), z: a.z + dz * t },
    tangent,
    normal: { x: -tangent.z, z: tangent.x },
  };
}
function residentialSpineLength(street: SettlementStreetPlan) {
  const a = street.points[0], b = street.points[street.points.length - 1];
  return Math.hypot(wrapSourceX(b.x - a.x), b.z - a.z);
}
function offsetPoint(base: ReturnType<typeof pointOnResidentialSpine>, along: number, lateral: number): SettlementPoint {
  return { x: wrapSourceX(base.point.x + base.tangent.x * along + base.normal.x * lateral), z: base.point.z + base.tangent.z * along + base.normal.z * lateral };
}

/**
 * One canonical one-person residence per resident. All residences use one
 * deterministic straight residential spine and parallel bands. The band count
 * is derived from the spine length and worst-case home footprint so primary
 * plots are disjoint by construction, independent of camera, visit order, LOD,
 * cache state, or renderer backend. Secondary streets remain public/service
 * morphology rather than competing residential coordinate systems.
 */
export function settlementHomeFor(place: Place, index: number, suppliedPlan?: SettlementExteriorPlan): SettlementPlotPlan {
  const population = canonicalSettlementPopulation(place);
  if (!Number.isInteger(index) || index < 0 || index >= population) throw new RangeError(`Invalid resident home index ${index} for ${place.code}`);
  const plan = suppliedPlan || settlementExteriorFor(place), street = plan.streets[0],
    spineLength = residentialSpineLength(street),
    maximumHomeRadius = Math.hypot(.94, 1.06) * .5 + .1,
    minimumAlongSpacing = maximumHomeRadius * 2 + .08,
    maximumSlotsPerRibbon = Math.max(1, Math.floor(spineLength * .88 / minimumAlongSpacing)),
    minimumRibbonCount = Math.ceil(population / maximumSlotsPerRibbon),
    bandCount = Math.max(place.kind === "city" ? 24 : 8, Math.ceil(minimumRibbonCount / 2)),
    ribbonCount = bandCount * 2,
    ribbon = index % ribbonCount,
    ordinal = Math.floor(index / ribbonCount),
    slotsPerRibbon = Math.ceil(population / ribbonCount),
    side: -1 | 1 = (ribbon & 1) === 0 ? -1 : 1,
    band = Math.floor(ribbon / 2),
    fraction = .06 + ((ordinal + .5) / slotsPerRibbon) * .88,
    base = pointOnResidentialSpine(street, fraction),
    width = .68 + unit(`${place.code}/RESIDENCE/${index}/WIDTH`) * .26,
    depth = .78 + unit(`${place.code}/RESIDENCE/${index}/DEPTH`) * .28,
    setback = 1.65 + band * 2.2,
    lateral = side * (street.width * .5 + setback + depth * .5),
    yawRad = Math.atan2(-base.normal.x * side, -base.normal.z * side) + (unit(`${place.code}/RESIDENCE/${index}/YAW`) - .5) * .05,
    spacing = Math.max(2.2, spineLength * .88 / slotsPerRibbon),
    shift = Math.min(.28, spacing * .08),
    candidates: SettlementPoint[] = [offsetPoint(base, 0, lateral)];
  for (const along of [-shift, shift, -shift * 2, shift * 2]) candidates.push(offsetPoint(base, along, lateral));
  return {
    id: `${place.code}/RESIDENCE/${index}`,
    kind: "house",
    ownerId: `${place.code}/RESIDENT/${index}`,
    capacity: 1,
    residents: 1,
    width,
    depth,
    yawRad,
    clearanceRadius: Math.hypot(width, depth) * .5 + .1,
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
function alignGatesToRoads(place: Place, plan: SettlementExteriorPlan): SettlementExteriorPlan {
  if (!plan.gates.length || !plan.streets.length) return plan;
  const approaches = terminalApproaches(place, plan), main = plan.streets[0];
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