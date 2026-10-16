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
  plots: readonly SettlementPlotPlan[];
};

const TAU = Math.PI * 2;
const PHI = 0.6180339887498949;
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

function pointOnStreet(street: SettlementStreetPlan, fraction: number) {
  let total = 0;
  for (let index = 1; index < street.points.length; index++)
    total += Math.hypot(wrapSourceX(street.points[index].x - street.points[index - 1].x), street.points[index].z - street.points[index - 1].z);
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      length = Math.hypot(dx, dz);
    if (target <= length || index + 1 === street.points.length) {
      const t = length ? Math.max(0, Math.min(1, target / length)) : 0, tangent = normalize(dx, dz);
      return { point: { x: wrapSourceX(a.x + dx * t), z: a.z + dz * t }, tangent, normal: { x: -tangent.z, z: tangent.x } };
    }
    target -= length;
  }
  const a = street.points[0], b = street.points[Math.min(1, street.points.length - 1)], tangent = normalize(wrapSourceX(b.x - a.x), b.z - a.z);
  return { point: a, tangent, normal: { x: -tangent.z, z: tangent.x } };
}
function offsetPoint(base: ReturnType<typeof pointOnStreet>, along: number, lateral: number): SettlementPoint {
  return { x: wrapSourceX(base.point.x + base.tangent.x * along + base.normal.x * lateral), z: base.point.z + base.tangent.z * along + base.normal.z * lateral };
}

/**
 * Canonical one-person residence. Identity mirrors simulation.ts exactly; the
 * candidate cloud is presentation/placement acceleration only and never changes ownership.
 */
function homePlot(place: Place, plan: CoreExteriorPlan, index: number): SettlementPlotPlan {
  const streetIndex = (index + digest(`${place.code}/RESIDENCE/${index}/STREET`)) % plan.streets.length,
    street = plan.streets[streetIndex],
    slot = Math.floor(index / Math.max(1, plan.streets.length)),
    side: -1 | 1 = (digest(`${place.code}/RESIDENCE/${index}/SIDE`) & 1) === 0 ? -1 : 1,
    bandCount = place.kind === "city" ? 8 : 4,
    band = Math.floor(slot / 32) % bandCount,
    fraction = .035 + (((index * PHI) + unit(`${place.code}/RESIDENCE/${index}/FRACTION`)) % 1) * .93,
    base = pointOnStreet(street, fraction),
    width = .68 + unit(`${place.code}/RESIDENCE/${index}/WIDTH`) * .34,
    depth = .78 + unit(`${place.code}/RESIDENCE/${index}/DEPTH`) * .38,
    setback = 1.25 + band * 1.55 + (slot % 4) * .11,
    lateral = side * (street.width * .5 + setback + depth * .5),
    yawRad = Math.atan2(-base.normal.x * side, -base.normal.z * side) + (unit(`${place.code}/RESIDENCE/${index}/YAW`) - .5) * .08,
    primary = offsetPoint(base, 0, lateral),
    candidates: SettlementPoint[] = [primary];
  for (const along of [-1.35, 1.35, -2.7, 2.7]) candidates.push(offsetPoint(base, along, lateral));
  for (const outward of [1.1, 2.2]) candidates.push(offsetPoint(base, 0, lateral + side * outward));
  return {
    id: `${place.code}/RESIDENCE/${index}`,
    kind: "house",
    ownerId: `${place.code}/RESIDENT/${index}`,
    capacity: 1,
    residents: 1,
    width,
    depth,
    yawRad,
    clearanceRadius: Math.hypot(width, depth) * .5 + .16,
    candidates,
  };
}

function servicePlot(place: Place, plot: CorePlotPlan): SettlementPlotPlan {
  if (plot.kind !== "service" || !plot.service) return plot;
  const ownerIndex = SERVICE_OWNER[plot.service],
    population = canonicalSettlementPopulation(place),
    staff = Math.max(1, Math.min(12, Math.ceil(population / (plot.service === "farmstead" ? 700 : 1100))));
  return {
    ...plot,
    ownerId: ownerIndex === undefined ? plot.ownerId : `${place.code}/RESIDENT/${ownerIndex}`,
    residents: staff,
    capacity: Math.max(plot.capacity, staff),
  };
}

function gardenFor(place: Place, home: SettlementPlotPlan, index: number): SettlementPlotPlan {
  const width = 1.4 + unit(`${place.code}/GARDEN/${index}/WIDTH`) * .7,
    depth = 1.6 + unit(`${place.code}/GARDEN/${index}/DEPTH`) * .8,
    candidates = home.candidates.map((candidate) => ({
      x: wrapSourceX(candidate.x + Math.cos(home.yawRad) * (home.width * .5 + width * .5 + .45)),
      z: candidate.z - Math.sin(home.yawRad) * (home.width * .5 + width * .5 + .45),
    }));
  return {
    id: `${place.code}/GARDEN/${index}`,
    kind: "garden",
    ownerId: home.ownerId,
    capacity: 0,
    residents: 0,
    width,
    depth,
    yawRad: home.yawRad,
    clearanceRadius: Math.hypot(width, depth) * .5 + .12,
    candidates,
  };
}

function terminalApproach(place: Place): { road: Road; x: number; z: number } | undefined {
  const candidates = roads.filter((road) => road.networkKind !== "detour" && (road.from === place.id || road.to === place.id) && road.centerline && road.centerline.length >= 2)
    .sort((a, b) => a.code.localeCompare(b.code));
  for (const road of candidates) {
    const points = road.centerline!;
    const next = road.from === place.id ? points[1] : points[points.length - 2];
    if (Math.hypot(wrapSourceX(next.x - place.x), next.z - place.z) > .001) return { road, x: next.x, z: next.z };
  }
  return undefined;
}
function alignPrimaryGateToRoad(place: Place, plan: SettlementExteriorPlan): SettlementExteriorPlan {
  if (!plan.gates.length || !plan.streets.length) return plan;
  const approach = terminalApproach(place), main = plan.streets[0];
  if (!approach || main.points.length < 2) return plan;
  const outward = normalize(wrapSourceX(approach.x - place.x), approach.z - place.z), gatePoint = {
      x: wrapSourceX(place.x + outward.x * plan.radius), z: place.z + outward.z * plan.radius,
    },
    start = main.points[0], end = main.points[main.points.length - 1],
    useStart = Math.hypot(wrapSourceX(start.x - gatePoint.x), start.z - gatePoint.z) <= Math.hypot(wrapSourceX(end.x - gatePoint.x), end.z - gatePoint.z),
    mainPoints = main.points.map((point) => ({ ...point }));
  if (useStart) mainPoints[0] = gatePoint; else mainPoints[mainPoints.length - 1] = gatePoint;
  const normal = { x: -outward.z, z: outward.x }, primary = plan.gates[0],
    guardPosts = primary.guardPosts.map((_, index) => ({
      x: wrapSourceX(gatePoint.x + normal.x * (index === 0 ? 9 : -9)), z: gatePoint.z + normal.z * (index === 0 ? 9 : -9),
    })),
    primaryGate = { ...primary, x: gatePoint.x, z: gatePoint.z, bearingRad: Math.atan2(outward.z, outward.x), guardPosts },
    border = plan.border.map((point) => ({ ...point }));
  let nearest = 0, nearestDistance = Infinity;
  for (let index = 0; index < border.length; index++) {
    const distance = Math.hypot(wrapSourceX(border[index].x - gatePoint.x), border[index].z - gatePoint.z);
    if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
  }
  border[nearest] = gatePoint;
  return { ...plan, entrance: gatePoint, streets: [{ ...main, points: mainPoints }, ...plan.streets.slice(1)], gates: [primaryGate, ...plan.gates.slice(1)], border };
}

export function settlementExteriorFor(place: Place): SettlementExteriorPlan {
  const existing = cache.get(place.code);
  if (existing) return existing;
  const core = coreSettlementExteriorFor(place), plots: SettlementPlotPlan[] = [];
  for (const plot of core.plots) if (plot.kind !== "house") plots.push(servicePlot(place, plot));
  const population = canonicalSettlementPopulation(place), gardenStride = place.kind === "city" ? 48 : 8;
  for (let index = 0; index < population; index++) {
    const home = homePlot(place, core, index);
    plots.push(home);
    if (index % gardenStride === 0) plots.push(gardenFor(place, home, index));
  }
  const plan = alignPrimaryGateToRoad(place, { ...core, plots });
  cache.set(place.code, plan);
  return plan;
}
export function settlementExteriorCacheSize() { return cache.size; }

/** Diagnostics count canonical homes analytically; they do not eagerly materialize every detailed residence. */
export function settlementExteriorSummary() {
  let cityGates = 0, villageGates = 0, plots = 0, streets = 0, borderPoints = 0;
  const archetypes: Partial<Record<SettlementArchetype, number>> = {};
  for (const place of places) {
    const core = coreSettlementExteriorFor(place), population = canonicalSettlementPopulation(place),
      nonHomes = core.plots.filter((plot) => plot.kind !== "house").length,
      gardens = Math.ceil(population / (place.kind === "city" ? 48 : 8));
    plots += nonHomes + population + gardens;
    streets += core.streets.length;
    borderPoints += core.border.length;
    archetypes[core.archetype] = (archetypes[core.archetype] || 0) + 1;
    if (place.kind === "city") cityGates += core.gates.length; else villageGates += core.gates.length;
  }
  return { plans: places.length, plots, streets, borderPoints, cityGates, villageGates, archetypes, cachedPlans: cache.size } as const;
}
