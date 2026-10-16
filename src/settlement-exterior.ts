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
export type SettlementService = CoreSettlementService;
export type SettlementPlotKind = CoreSettlementPlotPlan["kind"];
export type SettlementPlotPlan = CoreSettlementPlotPlan;
export type SettlementExteriorPlan = CoreSettlementExteriorPlan;

type MorphologyService = CoreSettlementService | "merchant" | "headman";
type MorphologyPlotKind = CoreSettlementPlotPlan["kind"] | "garden";
type MorphologyPlotPlan = Omit<CoreSettlementPlotPlan, "kind" | "service" | "candidates"> & {
  kind: MorphologyPlotKind;
  service?: MorphologyService;
  candidates: readonly SettlementPoint[];
};
type MorphologyExteriorPlan = Omit<CoreSettlementExteriorPlan, "plots"> & {
  plots: readonly MorphologyPlotPlan[];
};

const TAU = Math.PI * 2;
const cache = new Map<string, CoreSettlementExteriorPlan>();
const SERVICE_RESIDENT_INDEX: Readonly<Partial<Record<CoreSettlementService, number>>> = {
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
function canonicalPopulationFor(place: Place) {
  // This is the same canonical population authority used by simulation.ts. Keeping
  // housing realization here avoids importing simulation -> world -> morphology.
  return place.kind === "city" ? 2400 : 80;
}
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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
function demandAdjustedPlot(
  place: Place,
  plot: CoreSettlementPlotPlan,
  homeIndex: number,
  homeCount: number,
): CoreSettlementPlotPlan {
  const population = canonicalPopulationFor(place);
  if (plot.kind === "house") {
    const baseResidents = Math.floor(population / Math.max(1, homeCount)),
      remainder = population % Math.max(1, homeCount),
      residents = baseResidents + (homeIndex < remainder ? 1 : 0),
      capacity = residents + Math.max(2, Math.ceil(residents * .12)),
      demandScale = clamp(Math.sqrt(capacity / 6), .9, 2.2),
      // Storeys absorb most city density; footprint still grows measurably with household demand.
      footprintScale = 1 + (demandScale - 1) * .24,
      width = plot.width * footprintScale,
      depth = plot.depth * footprintScale;
    return {
      ...plot,
      residents,
      capacity,
      width,
      depth,
      clearanceRadius: Math.hypot(width, depth) * .5 + 1.5,
    };
  }
  if (plot.kind !== "service" || !plot.service) return plot;
  const service = plot.service,
    staffDivisor: Readonly<Record<CoreSettlementService, number>> = {
      market: 650,
      inn: 520,
      blacksmith: 1200,
      butcher: 1100,
      "guard-office": 480,
      farmstead: 430,
    },
    staff = Math.max(1, Math.ceil(population / staffDivisor[service])),
    serviceDemand = Math.max(staff + 2, Math.round(plot.capacity * (.86 + .28 * unit(`${place.code}/${service}/DEMAND`)))),
    baseCapacity = Math.max(1, plot.capacity),
    footprintScale = clamp(Math.sqrt(serviceDemand / baseCapacity), .9, 1.16),
    width = plot.width * footprintScale,
    depth = plot.depth * footprintScale,
    residentIndex = SERVICE_RESIDENT_INDEX[service];
  return {
    ...plot,
    ownerId: residentIndex === undefined ? plot.ownerId : `${place.code}/RESIDENT/${residentIndex}`,
    residents: staff,
    capacity: serviceDemand,
    width,
    depth,
    clearanceRadius: Math.hypot(width, depth) * .5 + 1.5,
  };
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
): MorphologyPlotPlan {
  const street = plan.streets[streetIndex % plan.streets.length], base = pointOnStreet(street, fraction),
    setback = 10 + unit(`${place.code}/${service}/SETBACK`) * 6,
    lateral = side * (street.width * .5 + setback + depth * .5),
    id = `${place.code}/PLOT/${service.toUpperCase()}`,
    yawRad = Math.atan2(-base.normal.x * side, -base.normal.z * side) + (unit(`${id}/YAW`) - .5) * .12,
    clearanceRadius = Math.hypot(width, depth) * .5 + 1.5,
    candidates = candidateCloud(base, id, lateral, 7);
  for (let offset = 1; offset < plan.streets.length; offset++) {
    const alternateStreet = plan.streets[(streetIndex + offset) % plan.streets.length],
      alternate = pointOnStreet(alternateStreet, .15 + ((unit(`${id}/ALT/${offset}`) + fraction) % .7)),
      alternateSide: -1 | 1 = (digest(`${id}/SIDE/${offset}`) & 1) === 0 ? side : (side === 1 ? -1 : 1),
      altLateral = alternateSide * (alternateStreet.width * .5 + setback + depth * .5);
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
function gardenFor(place: Place, plan: CoreSettlementExteriorPlan, home: CoreSettlementPlotPlan, index: number): MorphologyPlotPlan {
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
export function settlementExteriorFor(place: Place): CoreSettlementExteriorPlan {
  const existing = cache.get(place.code);
  if (existing) return existing;
  const core = coreSettlementExteriorFor(place), plots: MorphologyPlotPlan[] = [],
    homeCount = core.plots.filter((plot) => plot.kind === "house").length,
    population = canonicalPopulationFor(place);
  let rolesAdded = false, homeIndex = 0;
  for (const rawPlot of core.plots) {
    const plot = demandAdjustedPlot(place, rawPlot, homeIndex, homeCount);
    plots.push(plot);
    if (!rolesAdded && plot.service === "farmstead") {
      const merchantResidents = Math.max(1, Math.ceil(population / 900)),
        merchantCapacity = merchantResidents + Math.max(4, Math.ceil(population / 180)),
        merchantScale = clamp(Math.sqrt(merchantCapacity / (place.kind === "city" ? 36 : 18)), .9, 1.18),
        headmanResidents = Math.max(2, Math.ceil(population / 1200)),
        headmanCapacity = headmanResidents + Math.max(4, Math.ceil(population / 300)),
        headmanScale = clamp(Math.sqrt(headmanCapacity / (place.kind === "city" ? 20 : 12)), .9, 1.18);
      plots.push(servicePlot(place, core, "merchant", 0, place.kind === "city" ? .62 : .72, 1, 12 * merchantScale, 11 * merchantScale, merchantCapacity, merchantResidents));
      plots.push(servicePlot(place, core, "headman", Math.min(1, core.streets.length - 1), place.kind === "city" ? .24 : .28, -1, 16 * headmanScale, 14 * headmanScale, headmanCapacity, headmanResidents));
      rolesAdded = true;
    }
    if (plot.kind === "house") {
      const match = /HOUSE\/(\d+)$/.exec(plot.id), index = match ? Number(match[1]) : -1;
      if (index >= 0 && index % 5 === 0) plots.push(gardenFor(place, core, plot, index));
      homeIndex++;
    }
  }
  const morphologyPlan: MorphologyExteriorPlan = { ...core, plots };
  const publicPlan = morphologyPlan as unknown as CoreSettlementExteriorPlan;
  cache.set(place.code, publicPlan);
  return publicPlan;
}

export function settlementExteriorCacheSize() { return cache.size; }
export function settlementExteriorSummary() {
  let cityGates = 0, villageGates = 0, plotCount = 0, streets = 0, borderPoints = 0;
  const archetypes: Partial<Record<SettlementArchetype, number>> = {};
  for (const place of places) {
    const plan = settlementExteriorFor(place) as unknown as MorphologyExteriorPlan;
    plotCount += plan.plots.length;
    streets += plan.streets.length;
    borderPoints += plan.border.length;
    archetypes[plan.archetype] = (archetypes[plan.archetype] || 0) + 1;
    if (place.kind === "city") cityGates += plan.gates.length; else villageGates += plan.gates.length;
  }
  return { plans: places.length, plots: plotCount, streets, borderPoints, cityGates, villageGates, archetypes, cachedPlans: cache.size } as const;
}
