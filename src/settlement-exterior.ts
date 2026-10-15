import { places, roads, roadDistanceAt, type Place, type Road } from "./geography.ts";
import { politicalSettlementSiteById } from "./political-settlement-access.ts";
import { lonLatToSource, wrapSourceX } from "./planet.ts";

export type SettlementService =
  | "market"
  | "inn"
  | "blacksmith"
  | "butcher"
  | "guard-office"
  | "farmstead";

export type SettlementPlotKind =
  | "keep"
  | "well"
  | "house"
  | "field"
  | "service";

export type SettlementPoint = { x: number; z: number };

export type SettlementStreetPlan = {
  id: string;
  width: number;
  points: readonly SettlementPoint[];
};

export type SettlementPlotPlan = {
  id: string;
  kind: SettlementPlotKind;
  service?: SettlementService;
  ownerId?: string;
  capacity: number;
  residents: number;
  candidates: readonly SettlementPoint[];
};

export type SettlementGatePlan = {
  id: string;
  x: number;
  z: number;
  bearingRad: number;
  guardPosts: readonly SettlementPoint[];
};

export type SettlementExteriorPlan = {
  placeId: string;
  placeCode: string;
  name: string;
  kind: Place["kind"];
  radius: number;
  primaryAxis: SettlementPoint;
  entrance: SettlementPoint;
  streets: readonly SettlementStreetPlan[];
  border: readonly SettlementPoint[];
  plots: readonly SettlementPlotPlan[];
  gates: readonly SettlementGatePlan[];
};

const TAU = Math.PI * 2;

function digest(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

function unit(address: string) {
  return digest(address) / 4294967296;
}

function normalize(x: number, z: number) {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

function closestRoad(place: Place) {
  let chosen: Road | undefined,
    distance = Infinity;
  for (const road of roads) {
    const candidate = roadDistanceAt(place.x, place.z, road);
    if (candidate < distance || (candidate === distance && road.code < (chosen?.code || "~"))) {
      chosen = road;
      distance = candidate;
    }
  }
  return chosen;
}

function tangentAt(place: Place, road: Road) {
  const path = road.centerline || [
    { x: road.fromX, z: road.fromZ },
    { x: road.toX, z: road.toZ },
  ];
  let best = Infinity,
    tangent = { x: wrapSourceX(road.toX - road.fromX), z: road.toZ - road.fromZ };
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1],
      b = path[index],
      dx = wrapSourceX(b.x - a.x),
      dz = b.z - a.z,
      qx = wrapSourceX(place.x - a.x),
      qz = place.z - a.z,
      denominator = dx * dx + dz * dz || 1,
      t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / denominator)),
      distance = Math.hypot(qx - dx * t, qz - dz * t);
    if (distance < best) {
      best = distance;
      tangent = { x: dx, z: dz };
    }
  }
  return normalize(tangent.x, tangent.z);
}

function primaryAxis(place: Place) {
  const road = closestRoad(place);
  if (road) return tangentAt(place, road);
  const angle = TAU * unit(`${place.code}/EXTERIOR/AXIS`);
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function localPoint(
  place: Place,
  axis: SettlementPoint,
  along: number,
  lateral: number,
): SettlementPoint {
  const side = { x: -axis.z, z: axis.x };
  return {
    x: wrapSourceX(place.x + axis.x * along + side.x * lateral),
    z: place.z + axis.z * along + side.z * lateral,
  };
}

function curvedStreet(
  place: Place,
  axis: SettlementPoint,
  id: string,
  halfLength: number,
  lateral: number,
  bend: number,
  phase: number,
): SettlementStreetPlan {
  const pointCount = Math.max(9, Math.ceil((halfLength * 2) / 9) + 1),
    points = Array.from({ length: pointCount }, (_, index) => {
      const t = index / (pointCount - 1),
        along = (t * 2 - 1) * halfLength,
        curve = Math.sin(t * Math.PI + phase) * bend + Math.sin(t * TAU + phase * 0.7) * bend * 0.25;
      return localPoint(place, axis, along, lateral + curve);
    });
  return { id: `${place.code}/STREET/${id}`, width: 5, points };
}

function rotatedAxis(axis: SettlementPoint, angle: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return normalize(axis.x * c - axis.z * s, axis.x * s + axis.z * c);
}

function candidatesAround(
  place: Place,
  axis: SettlementPoint,
  address: string,
  along: number,
  lateral: number,
  spread = 16,
) {
  const result: SettlementPoint[] = [],
    phase = TAU * unit(`${address}/PHASE`);
  result.push(localPoint(place, axis, along, lateral));
  for (let ring = 1; ring <= 3; ring++) {
    const radius = spread * ring;
    for (let index = 0; index < 8; index++) {
      const angle = phase + (index / 8) * TAU;
      result.push(
        localPoint(
          place,
          axis,
          along + Math.cos(angle) * radius,
          lateral + Math.sin(angle) * radius,
        ),
      );
    }
  }
  return result;
}

function plot(
  place: Place,
  axis: SettlementPoint,
  id: string,
  kind: SettlementPlotKind,
  along: number,
  lateral: number,
  capacity: number,
  residents: number,
  service?: SettlementService,
  spread?: number,
  ownerId?: string,
): SettlementPlotPlan {
  return {
    id: `${place.code}/PLOT/${id}`,
    kind,
    service,
    ownerId,
    capacity,
    residents,
    candidates: candidatesAround(place, axis, `${place.code}/PLOT/${id}`, along, lateral, spread),
  };
}

function buildPlan(place: Place): SettlementExteriorPlan {
  const axis = primaryAxis(place),
    site = politicalSettlementSiteById.get(place.id),
    entranceSource = site ? lonLatToSource(site.entrance.lon, site.entrance.lat) : undefined,
    entrance = entranceSource
      ? { x: entranceSource.x, z: entranceSource.z }
      : localPoint(place, axis, place.kind === "city" ? 350 : 78, 0),
    radius = place.kind === "city" ? 360 : 82,
    bend = 7 + unit(`${place.code}/EXTERIOR/BEND`) * (place.kind === "city" ? 24 : 10),
    streets: SettlementStreetPlan[] = [
      curvedStreet(place, axis, "MAIN", radius, 0, bend * 0.4, 0),
      curvedStreet(
        place,
        rotatedAxis(axis, Math.PI / 2 + (unit(`${place.code}/EXTERIOR/CROSS`) - 0.5) * 0.42),
        "CROSS",
        radius * (place.kind === "city" ? 0.74 : 0.64),
        place.kind === "city" ? 24 : 11,
        bend,
        0.8,
      ),
    ];
  if (place.kind === "city") {
    streets.push(
      curvedStreet(place, rotatedAxis(axis, 0.62), "DIAGONAL-A", radius * 0.68, -42, bend * 0.8, 1.4),
      curvedStreet(place, rotatedAxis(axis, -0.78), "DIAGONAL-B", radius * 0.62, 38, bend * 0.7, 2.1),
    );
  }

  const plots: SettlementPlotPlan[] = [
    plot(place, axis, "KEEP", "keep", -34, -32, place.kind === "city" ? 36 : 18, place.kind === "city" ? 12 : 7, undefined, 13),
    plot(place, axis, "WELL", "well", 7, 18, 12, 0, undefined, 9),
    plot(place, axis, "MARKET", "service", 20, -28, place.kind === "city" ? 120 : 48, 0, "market", 12),
    plot(place, axis, "INN", "service", -18, 31, place.kind === "city" ? 54 : 24, place.kind === "city" ? 8 : 4, "inn", 12),
    plot(place, axis, "BLACKSMITH", "service", 46, 32, 10, 3, "blacksmith", 12),
    plot(place, axis, "BUTCHER", "service", -50, -30, 12, 4, "butcher", 12),
    plot(place, axis, "GUARD", "service", 2, -48, 18, 6, "guard-office", 12),
    plot(place, axis, "FARMSTEAD", "service", place.kind === "city" ? 245 : 57, 36, 14, 6, "farmstead", 13),
  ];

  const houseCount = place.kind === "city" ? 96 : 28;
  for (let index = 0; index < houseCount; index++) {
    const lane = index % streets.length,
      streetAxis = lane === 0 ? axis : rotatedAxis(axis, Math.PI / 2 + lane * 0.18),
      row = Math.floor(index / 2),
      usable = place.kind === "city" ? 300 : 66,
      along = -usable + ((row * (place.kind === "city" ? 17 : 13)) % Math.max(1, usable * 2)),
      side = index % 2 === 0 ? -1 : 1,
      setback = (place.kind === "city" ? 19 : 17) + (digest(`${place.code}/HOUSE/${index}`) % 9),
      jitter = (unit(`${place.code}/HOUSE/${index}/JITTER`) - 0.5) * 8,
      residents = 2 + (digest(`${place.code}/HOUSE/${index}/RESIDENTS`) % 5);
    plots.push(
      plot(
        place,
        streetAxis,
        `HOUSE/${index}`,
        "house",
        along + jitter,
        side * setback,
        residents + 2,
        residents,
        undefined,
        place.kind === "city" ? 10 : 8,
        `${place.code}/HOUSEHOLD/${index}`,
      ),
    );
  }

  const fieldCount = place.kind === "city" ? 12 : 5;
  for (let index = 0; index < fieldCount; index++) {
    const side = index % 2 === 0 ? -1 : 1,
      along = (place.kind === "city" ? 250 : 55) + Math.floor(index / 2) * (place.kind === "city" ? 24 : 13),
      lateral = side * (place.kind === "city" ? 150 + (index % 3) * 28 : 54 + (index % 3) * 11);
    plots.push(plot(place, axis, `FIELD/${index}`, "field", along, lateral, 0, 0, undefined, 14));
  }

  const gateCount = place.kind === "city" ? 2 : 1 + (digest(`${place.code}/GATE_COUNT`) & 1),
    gates: SettlementGatePlan[] = [];
  for (let index = 0; index < gateCount; index++) {
    const sign = index === 0 ? 1 : -1,
      gate = index === 0 && entranceSource
        ? entrance
        : localPoint(place, axis, sign * radius, 0),
      bearingRad = Math.atan2(axis.z * sign, axis.x * sign),
      side = { x: -Math.sin(bearingRad), z: Math.cos(bearingRad) },
      guardCount = 1 + (digest(`${place.code}/GATE/${index}/GUARDS`) & 1),
      guardPosts = Array.from({ length: guardCount }, (_, guardIndex) => {
        const direction = guardIndex === 0 ? 1 : -1;
        return { x: wrapSourceX(gate.x + side.x * 9 * direction), z: gate.z + side.z * 9 * direction };
      });
    gates.push({ id: `${place.code}/GATE/${index}`, x: gate.x, z: gate.z, bearingRad, guardPosts });
  }

  const borderCount = place.kind === "city" ? 48 : 24,
    border = Array.from({ length: borderCount }, (_, index) => {
      const angle = (index / borderCount) * TAU,
        irregularity = 0.9 + unit(`${place.code}/BORDER/${index}`) * 0.08,
        distance = radius * irregularity;
      return localPoint(place, axis, Math.cos(angle) * distance, Math.sin(angle) * distance);
    });

  return {
    placeId: place.id,
    placeCode: place.code,
    name: place.name,
    kind: place.kind,
    radius,
    primaryAxis: axis,
    entrance,
    streets,
    border,
    plots,
    gates,
  };
}

const cache = new Map<string, SettlementExteriorPlan>();

/** Lazy deterministic exterior record. Camera/visit order never contributes. */
export function settlementExteriorFor(place: Place) {
  let plan = cache.get(place.code);
  if (!plan) {
    plan = buildPlan(place);
    cache.set(place.code, plan);
  }
  return plan;
}

export function settlementExteriorSummary() {
  let cityGates = 0,
    villageGates = 0,
    plots = 0,
    streets = 0,
    borderPoints = 0;
  for (const place of places) {
    const plan = settlementExteriorFor(place);
    plots += plan.plots.length;
    streets += plan.streets.length;
    borderPoints += plan.border.length;
    if (place.kind === "city") cityGates += plan.gates.length;
    else villageGates += plan.gates.length;
  }
  return { plans: places.length, plots, streets, borderPoints, cityGates, villageGates, cachedPlans: cache.size } as const;
}
