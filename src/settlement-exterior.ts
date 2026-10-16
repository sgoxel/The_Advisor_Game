import { places, type Place } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import {
  settlementExteriorFor as coreSettlementExteriorFor,
  type SettlementArchetype,
  type SettlementExteriorPlan as CoreSettlementExteriorPlan,
  type SettlementFieldForm,
  type SettlementGatePlan,
  type SettlementPlotPlan as CoreSettlementPlotPlan,
  type SettlementPoint,
  type SettlementService as CoreSettlementService,
  type SettlementStreetPlan,
} from "./settlement-exterior-core.ts";

export type { SettlementArchetype, SettlementFieldForm, SettlementGatePlan, SettlementPoint, SettlementStreetPlan };

export type SettlementService = CoreSettlementService | "merchant" | "headman";
export type SettlementPlotKind = CoreSettlementPlotPlan["kind"] | "garden";
export type SettlementPlotPlan = Omit<CoreSettlementPlotPlan, "kind" | "service" | "candidates"> & {
  kind: SettlementPlotKind;
  service?: SettlementService;
  candidates: readonly SettlementPoint[];
};
export type SettlementExteriorPlan = Omit<CoreSettlementExteriorPlan, "plots"> & {
  plots: readonly SettlementPlotPlan[];
};

const TAU = Math.PI * 2;
const cache = new Map<string, SettlementExteriorPlan>();

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
function pointOnStreet(street: SettlementStreetPlan, fraction: number) {
  let total = 0;
  for (let index = 1; index < street.points.length; index++)
    total += Math.hypot(wrapSourceX(street.points[index].x - street.points[index - 1].x), street.points[index].z - street.points[index - 1].z);
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);
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
function candidateCloud(base: ReturnType<typeof pointOnStreet>, address: string, lateral: number, spread = 7) {
  const result: SettlementPoint[] = [], sign = lateral < 0 ? -1 : 1;
  result.push(offsetPoint(base, 0, lateral));
  for (let ring = 1; ring <= 8; ring++) for (let index = 0; index < 8; index++) {
    const phase = TAU * unit(`${address}/CANDIDATE/${ring}/${index}`),
      along = Math.cos(phase) * spread * ring,
      side = lateral + sign * Math.abs(Math.sin(phase)) * spread * ring * .78;
    result.push(offsetPoint(base, along, side));
  }
  return result;
}
function servicePlot(
  place: Place,
  plan: CoreSettlementExteriorPlan,
  service: "merchant" | "headman",
  streetIndex: number,
  fraction: number,
  side: -1 | 1,
  width: number,
  depth: number,
  capacity: number,
  residents: number,
): SettlementPlotPlan {
  const street = plan.streets[streetIndex % plan.streets.length], base = pointOnStreet(street, fraction),
    setback = 10 + unit(`${place.code}/${service}/SETBACK`) * 6,
    lateral = side * (street.width * .5 + setback + depth * .5),
    id = `${place.code}/PLOT/${service.toUpperCase()}`,
    yawRad = Math.atan2(-base.normal.x * side, -base.normal.z * side) + (unit(`${id}/YAW`) - .5) * .12,
    clearanceRadius = Math.hypot(width, depth) * .5 + 1.5,
    candidates = candidateCloud(base, id, lateral, 7);
  for (let offset = 1; offset < plan.streets.length; offset++) {
    const alternate = pointOnStreet(plan.streets[(streetIndex + offset) % plan.streets.length], .15 + ((unit(`${id}/ALT/${offset}`) + fraction) % .7)),
      alternateSide: -1 | 1 = (digest(`${id}/SIDE/${offset}`) & 1) === 0 ? side : (side === 1 ? -1 : 1),
      altLateral = alternateSide * (plan.streets[(streetIndex + offset) % plan.streets.length].width * .5 + setback + depth * .5);
    candidates.push(...candidateCloud(alternate, `${id}/ALT/${offset}`, altLateral, 8));
  }
  return { id, kind: "service", service, capacity, residents, width, depth, yawRad, clearanceRadius, candidates };
}
function nearestStreet(plan: CoreSettlementExteriorPlan, x: number, z: number) {
  let best: { x: number; z: number; distance: number } | undefined;
  for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      qx = wrapSourceX(x - a.x), qz = z - a.z, denominator = dx * dx + dz * dz || 1,
      t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / denominator)), px = wrapSourceX(a.x + dx * t), pz = a.z + dz * t,
      distance = Math.hypot(wrapSourceX(x - px), z - pz);
    if (!best || distance < best.distance) best = { x: px, z: pz, distance };
  }
  return best || { x, z, distance: 0 };
}
function gardenFor(place: Place, plan: CoreSettlementExteriorPlan, home: CoreSettlementPlotPlan, index: number): SettlementPlotPlan {
  const width = 7 + unit(`${place.code}/GARDEN/${index}/WIDTH`) * 5,
    depth = 6 + unit(`${place.code}/GARDEN/${index}/DEPTH`) * 6,
    shift = 12 + unit(`${place.code}/GARDEN/${index}/SHIFT`) * 5,
    candidates = home.candidates.map((candidate) => {
      const street = nearestStreet(plan, candidate.x, candidate.z), dx = wrapSourceX(candidate.x - street.x), dz = candidate.z - street.z,
        direction = normalize(dx, dz);
      return { x: wrapSourceX(candidate.x + direction.x * shift), z: candidate.z + direction.z * shift };
    });
  return {
    id: `${place.code}/PLOT/GARDEN/${index}`,
    kind: "garden",
    ownerId: home.ownerId,
    capacity: 0,
    residents: 0,
    width,
    depth,
    yawRad: home.yawRad,
    clearanceRadius: Math.hypot(width, depth) * .5 + 1.5,
    candidates,
  };
}

/**
 * S004 morphology layer. The core keeps the established seeded street/archetype authority
 * (including /EXTERIOR/WATER-MORPH); this layer adds functional frontage roles and household yards.
 */
export function settlementExteriorFor(place: Place): SettlementExteriorPlan {
  let cached = cache.get(place.code);
  if (cached) return cached;
  const core = coreSettlementExteriorFor(place), plots: SettlementPlotPlan[] = [];
  let rolesAdded = false;
  for (const plot of core.plots) {
    plots.push(plot as SettlementPlotPlan);
    if (!rolesAdded && plot.service === "farmstead") {
      plots.push(servicePlot(place, core, "merchant", 0, place.kind === "city" ? .62 : .72, 1, 12, 11, place.kind === "city" ? 36 : 18, place.kind === "city" ? 5 : 3));
      plots.push(servicePlot(place, core, "headman", Math.min(1, core.streets.length - 1), place.kind === "city" ? .24 : .28, -1, 16, 14, place.kind === "city" ? 20 : 12, place.kind === "city" ? 8 : 6));
      rolesAdded = true;
    }
    if (plot.kind === "house") {
      const match = /HOUSE\/(\d+)$/.exec(plot.id), index = match ? Number(match[1]) : -1;
      if (index >= 0 && index % 5 === 0) plots.push(gardenFor(place, core, plot, index));
    }
  }
  cached = { ...core, plots };
  cache.set(place.code, cached);
  return cached;
}

export function settlementExteriorCacheSize() { return cache.size; }
export function settlementExteriorSummary() {
  let cityGates = 0, villageGates = 0, plotCount = 0, streets = 0, borderPoints = 0;
  const archetypes: Partial<Record<SettlementArchetype, number>> = {};
  for (const place of places) {
    const plan = settlementExteriorFor(place);
    plotCount += plan.plots.length;
    streets += plan.streets.length;
    borderPoints += plan.border.length;
    archetypes[plan.archetype] = (archetypes[plan.archetype] || 0) + 1;
    if (place.kind === "city") cityGates += plan.gates.length; else villageGates += plan.gates.length;
  }
  return { plans: places.length, plots: plotCount, streets, borderPoints, cityGates, villageGates, archetypes, cachedPlans: cache.size } as const;
}
