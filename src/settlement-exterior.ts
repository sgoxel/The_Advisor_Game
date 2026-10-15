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

export type SettlementPlotKind = "keep" | "well" | "house" | "field" | "service";
export type SettlementArchetype =
  | "roadside"
  | "green"
  | "crossroads"
  | "riverside"
  | "hillside"
  | "dispersed-farming"
  | "fortified-frontier"
  | "market-trade";
export type SettlementFieldForm = "strip" | "paddock" | "orchard" | "vegetable" | "pasture";

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
  fieldForm?: SettlementFieldForm;
  ownerId?: string;
  capacity: number;
  residents: number;
  width: number;
  depth: number;
  yawRad: number;
  clearanceRadius: number;
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
  archetype: SettlementArchetype;
  radius: number;
  primaryAxis: SettlementPoint;
  centre: SettlementPoint;
  entrance: SettlementPoint;
  streets: readonly SettlementStreetPlan[];
  border: readonly SettlementPoint[];
  plots: readonly SettlementPlotPlan[];
  gates: readonly SettlementGatePlan[];
};

const TAU = Math.PI * 2;
const PHI = 0.6180339887498949;

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

function rotatedAxis(axis: SettlementPoint, angle: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return normalize(axis.x * c - axis.z * s, axis.x * s + axis.z * c);
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

function localPoint(place: Place, axis: SettlementPoint, along: number, lateral: number): SettlementPoint {
  const side = { x: -axis.z, z: axis.x };
  return {
    x: wrapSourceX(place.x + axis.x * along + side.x * lateral),
    z: place.z + axis.z * along + side.z * lateral,
  };
}

function streetFromControls(
  place: Place,
  axis: SettlementPoint,
  id: string,
  width: number,
  controls: readonly (readonly [number, number])[],
): SettlementStreetPlan {
  const points: SettlementPoint[] = [];
  for (let controlIndex = 1; controlIndex < controls.length; controlIndex++) {
    const a = controls[controlIndex - 1],
      b = controls[controlIndex],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz),
      steps = Math.max(1, Math.ceil(length / 8));
    for (let step = controlIndex === 1 ? 0 : 1; step <= steps; step++) {
      const t = step / steps,
        along = a[0] + dx * t,
        lateral = a[1] + dz * t;
      points.push(localPoint(place, axis, along, lateral));
    }
  }
  return { id: `${place.code}/STREET/${id}`, width, points };
}

function irregularLoop(
  place: Place,
  axis: SettlementPoint,
  id: string,
  width: number,
  radiusAlong: number,
  radiusLateral: number,
  count = 9,
  centreAlong = 0,
  centreLateral = 0,
) {
  const controls: [number, number][] = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * TAU + (unit(`${place.code}/${id}/ANGLE/${index}`) - 0.5) * 0.18,
      radial = 0.82 + unit(`${place.code}/${id}/RADIUS/${index}`) * 0.3;
    controls.push([
      centreAlong + Math.cos(angle) * radiusAlong * radial,
      centreLateral + Math.sin(angle) * radiusLateral * radial,
    ]);
  }
  controls.push(controls[0]);
  return streetFromControls(place, axis, id, width, controls);
}

function pointOnStreet(street: SettlementStreetPlan, fraction: number) {
  const points = street.points;
  let total = 0;
  for (let index = 1; index < points.length; index++)
    total += Math.hypot(wrapSourceX(points[index].x - points[index - 1].x), points[index].z - points[index - 1].z);
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index],
      dx = wrapSourceX(b.x - a.x),
      dz = b.z - a.z,
      length = Math.hypot(dx, dz);
    if (target <= length || index + 1 === points.length) {
      const t = length ? Math.max(0, Math.min(1, target / length)) : 0,
        tangent = normalize(dx, dz);
      return {
        point: { x: wrapSourceX(a.x + dx * t), z: a.z + dz * t },
        tangent,
        normal: { x: -tangent.z, z: tangent.x },
      };
    }
    target -= length;
  }
  const a = points[0],
    b = points[Math.min(1, points.length - 1)],
    tangent = normalize(wrapSourceX(b.x - a.x), b.z - a.z);
  return { point: a, tangent, normal: { x: -tangent.z, z: tangent.x } };
}

function offsetPoint(base: ReturnType<typeof pointOnStreet>, along: number, lateral: number) {
  return {
    x: wrapSourceX(base.point.x + base.tangent.x * along + base.normal.x * lateral),
    z: base.point.z + base.tangent.z * along + base.normal.z * lateral,
  };
}

function candidateCloud(
  base: ReturnType<typeof pointOnStreet>,
  address: string,
  lateral: number,
  spread = 6,
) {
  const result: SettlementPoint[] = [],
    sign = lateral < 0 ? -1 : 1;
  result.push(offsetPoint(base, 0, lateral));
  for (let ring = 1; ring <= 4; ring++) {
    for (let index = 0; index < 6; index++) {
      const phase = TAU * unit(`${address}/CANDIDATE/${ring}/${index}`),
        along = Math.cos(phase) * spread * ring,
        side = lateral + sign * Math.abs(Math.sin(phase)) * spread * ring * 0.65;
      result.push(offsetPoint(base, along, side));
    }
  }
  return result;
}

function footprintFor(
  place: Place,
  id: string,
  kind: SettlementPlotKind,
  service?: SettlementService,
  fieldForm?: SettlementFieldForm,
) {
  const u = unit(`${place.code}/PLOT/${id}/FOOTPRINT`);
  if (kind === "keep") return { width: place.kind === "city" ? 20 : 16, depth: place.kind === "city" ? 18 : 15 };
  if (kind === "well") return { width: 3, depth: 3 };
  if (kind === "field") {
    if (fieldForm === "strip") return { width: 12 + u * 8, depth: 24 + u * 12 };
    if (fieldForm === "orchard") return { width: 22 + u * 8, depth: 20 + u * 7 };
    if (fieldForm === "pasture") return { width: 28 + u * 10, depth: 22 + u * 12 };
    return { width: 18 + u * 8, depth: 16 + u * 8 };
  }
  if (kind === "house") return { width: 5.8 + u * 4.5, depth: 6.5 + unit(`${place.code}/PLOT/${id}/DEPTH`) * 5 };
  switch (service) {
    case "market": return { width: 18, depth: 13 };
    case "inn": return { width: 13, depth: 16 };
    case "blacksmith": return { width: 13, depth: 12 };
    case "butcher": return { width: 10, depth: 11 };
    case "guard-office": return { width: 9, depth: 10 };
    case "farmstead": return { width: 18, depth: 15 };
    default: return { width: 9, depth: 9 };
  }
}

function plotOnStreet(
  place: Place,
  street: SettlementStreetPlan,
  id: string,
  kind: SettlementPlotKind,
  fraction: number,
  side: -1 | 1,
  setback: number,
  capacity: number,
  residents: number,
  service?: SettlementService,
  ownerId?: string,
  fieldForm?: SettlementFieldForm,
): SettlementPlotPlan {
  const base = pointOnStreet(street, fraction),
    footprint = footprintFor(place, id, kind, service, fieldForm),
    lateral = side * (street.width * 0.5 + setback + footprint.depth * 0.5),
    yawRad = Math.atan2(-base.normal.x * side, -base.normal.z * side) +
      (unit(`${place.code}/PLOT/${id}/YAW`) - 0.5) * (kind === "field" ? 0.24 : 0.12),
    clearanceRadius = Math.hypot(footprint.width, footprint.depth) * 0.5 + (kind === "field" ? 2 : 1.5);
  return {
    id: `${place.code}/PLOT/${id}`,
    kind,
    service,
    fieldForm,
    ownerId,
    capacity,
    residents,
    width: footprint.width,
    depth: footprint.depth,
    yawRad,
    clearanceRadius,
    candidates: candidateCloud(base, `${place.code}/PLOT/${id}`, lateral, kind === "field" ? 11 : 5),
  };
}

function archetypeFor(place: Place): SettlementArchetype {
  const site = politicalSettlementSiteById.get(place.id);
  if (site?.waterContext === "freshwater-lake" || site?.waterContext === "coast") return "riverside";
  if ((site?.maximumEnvelopeReliefSpreadM || 0) > 34) return "hillside";
  const value = digest(`${place.code}/EXTERIOR/ARCHETYPE`);
  if (place.kind === "city") {
    return ["market-trade", "fortified-frontier", "riverside", "hillside"][value % 4] as SettlementArchetype;
  }
  return [
    "roadside",
    "green",
    "crossroads",
    "dispersed-farming",
    "fortified-frontier",
    "market-trade",
  ][value % 6] as SettlementArchetype;
}

function villageStreets(place: Place, axis: SettlementPoint, archetype: SettlementArchetype, radius: number) {
  const w = 4.2,
    j = (salt: string, amount: number) => (unit(`${place.code}/STREET/${salt}`) - 0.5) * amount,
    streets: SettlementStreetPlan[] = [];
  if (archetype === "roadside") {
    streets.push(streetFromControls(place, axis, "MAIN", 5.4, [[-radius, j("A", 8)], [-radius * .35, j("B", 16)], [radius * .28, j("C", 14)], [radius, j("D", 9)]]));
    streets.push(streetFromControls(place, axis, "LANE-A", w, [[-20, 4], [-3, 30 + j("E", 10)], [8, 49 + j("F", 9)]]));
  } else if (archetype === "green") {
    streets.push(streetFromControls(place, axis, "APPROACH", 5.2, [[-radius, -5], [-32, -8], [-15, -2], [8, 0]]));
    streets.push(irregularLoop(place, axis, "COMMON-RING", w, 29, 23, 9, 8, 1));
    streets.push(streetFromControls(place, axis, "BACK-LANE", 3.8, [[18, 18], [42, 28 + j("G", 6)], [radius * .72, 22 + j("H", 8)]]));
  } else if (archetype === "crossroads") {
    streets.push(streetFromControls(place, axis, "MAIN", 5.4, [[-radius, -7], [-20, j("I", 8)], [radius, 9 + j("J", 6)]]));
    streets.push(streetFromControls(place, axis, "CROSS", 4.5, [[-11, -radius * .72], [-4, -19], [7, 12], [18, radius * .68]]));
    streets.push(streetFromControls(place, axis, "CROOKED-LANE", 3.6, [[14, 3], [35, -19], [55, -28 + j("K", 9)]]));
  } else if (archetype === "riverside") {
    streets.push(streetFromControls(place, axis, "BANK-ROAD", 5, [[-radius, -18], [-35, -12 + j("L", 7)], [18, -8], [radius, -15 + j("M", 7)]]));
    streets.push(streetFromControls(place, axis, "HIGH-STREET", 4.4, [[-radius * .72, 25], [-22, 20], [30, 28 + j("N", 7)], [radius * .62, 36]]));
    streets.push(streetFromControls(place, axis, "WATER-LANE", 3.6, [[-17, -11], [-5, 7], [2, 23]]));
  } else if (archetype === "hillside") {
    streets.push(streetFromControls(place, axis, "LOW-CONTOUR", 4.8, [[-radius * .84, -27], [-30, -18], [20, -24 + j("O", 8)], [radius * .74, -12]]));
    streets.push(streetFromControls(place, axis, "HIGH-CONTOUR", 4.2, [[-radius * .62, 29], [-10, 23 + j("P", 8)], [radius * .63, 33]]));
    streets.push(streetFromControls(place, axis, "SWITCHBACK", 3.7, [[-28, -19], [-7, 3], [-23, 22], [1, 30]]));
  } else if (archetype === "dispersed-farming") {
    streets.push(streetFromControls(place, axis, "FARM-ROAD", 5, [[-radius, 5], [-35, -6], [14, 6 + j("Q", 10)], [radius, -8]]));
    streets.push(streetFromControls(place, axis, "NORTH-TRACK", 3.5, [[-34, 0], [-48, 29], [-58, 58]]));
    streets.push(streetFromControls(place, axis, "SOUTH-TRACK", 3.5, [[26, 1], [42, -30], [51, -58]]));
  } else if (archetype === "fortified-frontier") {
    streets.push(streetFromControls(place, axis, "GATE-ROAD", 5.5, [[-radius, 0], [-28, -5], [8, 3], [radius, 0]]));
    streets.push(irregularLoop(place, axis, "INNER-LANE", 4, 40, 30, 8, 2, 0));
    streets.push(streetFromControls(place, axis, "WATCH-LANE", 3.6, [[-5, -29], [20, -42], [43, -31]]));
  } else {
    streets.push(streetFromControls(place, axis, "MARKET-STREET", 6.3, [[-radius, -3], [-26, 1], [18, -2], [radius, 7]]));
    streets.push(streetFromControls(place, axis, "MERCHANT-LANE", 4.2, [[-18, 2], [-8, 28], [10, 48]]));
    streets.push(streetFromControls(place, axis, "CRAFT-LANE", 3.9, [[26, 0], [35, -25], [55, -36]]));
  }
  return streets;
}

function cityStreets(place: Place, axis: SettlementPoint, archetype: SettlementArchetype, radius: number) {
  const j = (salt: string, amount: number) => (unit(`${place.code}/CITY-STREET/${salt}`) - 0.5) * amount,
    streets: SettlementStreetPlan[] = [];
  if (archetype === "riverside") {
    streets.push(streetFromControls(place, axis, "QUAY", 7, [[-radius, -55], [-140, -38], [35, -48 + j("A", 18)], [radius, -64]]));
    streets.push(streetFromControls(place, axis, "HIGH-STREET", 8, [[-radius, 35], [-120, 18], [70, 34], [radius, 52 + j("B", 16)]]));
    streets.push(streetFromControls(place, axis, "BRIDGE-LANE", 5, [[-90, -45], [-72, -2], [-54, 34]]));
    streets.push(streetFromControls(place, axis, "WAREHOUSE-LANE", 5, [[82, -50], [103, -7], [128, 42]]));
  } else if (archetype === "hillside") {
    streets.push(streetFromControls(place, axis, "LOW-CONTOUR", 7, [[-radius, -90], [-135, -58], [80, -72], [radius, -38]]));
    streets.push(streetFromControls(place, axis, "MID-CONTOUR", 6, [[-radius * .82, 4], [-80, 22], [95, 5 + j("C", 20)], [radius * .76, 31]]));
    streets.push(streetFromControls(place, axis, "HIGH-CONTOUR", 5, [[-radius * .58, 104], [-20, 91], [radius * .55, 120]]));
    streets.push(streetFromControls(place, axis, "SWITCHBACK", 5, [[-175, -55], [-115, 4], [-162, 66], [-93, 106]]));
    streets.push(streetFromControls(place, axis, "SWITCHBACK-2", 5, [[105, -68], [152, -13], [104, 46], [151, 98]]));
  } else if (archetype === "fortified-frontier") {
    streets.push(streetFromControls(place, axis, "GATE-AXIS", 8, [[-radius, 0], [-120, -12], [85, 8], [radius, 0]]));
    streets.push(irregularLoop(place, axis, "WARD-LANE", 6, 145, 112, 11, 8, -9));
    streets.push(streetFromControls(place, axis, "BARRACK-LANE", 5, [[-92, -85], [-24, -118], [55, -92]]));
    streets.push(streetFromControls(place, axis, "MARKET-LANE", 6, [[-45, 20], [-18, 78], [48, 101]]));
  } else {
    streets.push(streetFromControls(place, axis, "MARKET-SPINE", 8, [[-radius, -19], [-160, -8], [-25, 6], [125, -4], [radius, 22]]));
    streets.push(streetFromControls(place, axis, "NORTH-ARC", 6, [[-245, 72], [-112, 128], [25, 111 + j("D", 18)], [224, 70]]));
    streets.push(streetFromControls(place, axis, "SOUTH-ARC", 6, [[-214, -78], [-73, -122], [82, -106 + j("E", 19)], [244, -58]]));
    streets.push(streetFromControls(place, axis, "MERCHANT-CUT", 5, [[-120, -100], [-78, -34], [-54, 31], [-6, 101]]));
    streets.push(streetFromControls(place, axis, "CRAFT-CUT", 5, [[83, -109], [105, -42], [88, 24], [138, 83]]));
  }
  return streets;
}

function servicePlot(
  place: Place,
  streets: readonly SettlementStreetPlan[],
  service: SettlementService,
  streetIndex: number,
  fraction: number,
  side: -1 | 1,
  capacity: number,
  residents: number,
) {
  return plotOnStreet(
    place,
    streets[streetIndex % streets.length],
    service.toUpperCase(),
    "service",
    fraction,
    side,
    3 + unit(`${place.code}/${service}/SETBACK`) * 4,
    capacity,
    residents,
    service,
  );
}

function buildPlan(place: Place): SettlementExteriorPlan {
  const axis = primaryAxis(place),
    site = politicalSettlementSiteById.get(place.id),
    archetype = archetypeFor(place),
    entranceSource = site ? lonLatToSource(site.entrance.lon, site.entrance.lat) : undefined,
    radius = place.kind === "city"
      ? 350 + Math.round(unit(`${place.code}/RADIUS`) * 55)
      : archetype === "dispersed-farming"
        ? 112
        : archetype === "fortified-frontier"
          ? 90
          : 78 + Math.round(unit(`${place.code}/RADIUS`) * 16),
    streets = place.kind === "city"
      ? cityStreets(place, axis, archetype, radius)
      : villageStreets(place, axis, archetype, radius),
    main = streets[0],
    mainStart = main.points[0],
    mainEnd = main.points[main.points.length - 1],
    entrance = entranceSource
      ? { x: entranceSource.x, z: entranceSource.z }
      : unit(`${place.code}/ENTRANCE/END`) < 0.5 ? mainStart : mainEnd,
    centreSample = pointOnStreet(main, archetype === "roadside" ? 0.46 : 0.52),
    centre = centreSample.point,
    plots: SettlementPlotPlan[] = [];

  plots.push(plotOnStreet(place, main, "KEEP", "keep", archetype === "fortified-frontier" ? 0.43 : 0.35, -1, 8, place.kind === "city" ? 36 : 18, place.kind === "city" ? 12 : 7));
  plots.push(plotOnStreet(place, main, "WELL", "well", archetype === "green" ? 0.54 : 0.5, 1, 2.5, 12, 0));

  plots.push(servicePlot(place, streets, "market", 0, place.kind === "city" ? .52 : .56, -1, place.kind === "city" ? 120 : 48, 0));
  plots.push(servicePlot(place, streets, "inn", Math.min(1, streets.length - 1), .38, 1, place.kind === "city" ? 54 : 24, place.kind === "city" ? 8 : 4));
  plots.push(servicePlot(place, streets, "blacksmith", Math.min(2, streets.length - 1), .68, -1, 10, 3));
  plots.push(servicePlot(place, streets, "butcher", Math.min(1, streets.length - 1), .63, -1, 12, 4));
  plots.push(servicePlot(place, streets, "guard-office", 0, .12, 1, 18, 6));
  plots.push(servicePlot(place, streets, "farmstead", streets.length - 1, .82, 1, 14, 6));

  const houseCount = place.kind === "city"
      ? 108 + (digest(`${place.code}/HOUSE_COUNT`) % 28)
      : archetype === "dispersed-farming"
        ? 20 + (digest(`${place.code}/HOUSE_COUNT`) % 8)
        : 28 + (digest(`${place.code}/HOUSE_COUNT`) % 14),
    houseStreetStart = archetype === "green" && streets.length > 1 ? 1 : 0;
  for (let index = 0; index < houseCount; index++) {
    const address = `${place.code}/HOUSE/${index}`,
      streetIndex = houseStreetStart + (digest(`${address}/STREET`) % Math.max(1, streets.length - houseStreetStart)),
      street = streets[streetIndex],
      fraction = 0.07 + (((index * PHI + unit(`${address}/FRACTION`)) % 1) * 0.86),
      side: -1 | 1 = (digest(`${address}/SIDE`) & 1) === 0 ? -1 : 1,
      residents = 2 + (digest(`${address}/RESIDENTS`) % 5),
      setbackBase = archetype === "dispersed-farming" ? 10 : place.kind === "city" ? 3 : 5,
      setback = setbackBase + unit(`${address}/SETBACK`) * (archetype === "dispersed-farming" ? 15 : 8);
    plots.push(plotOnStreet(place, street, `HOUSE/${index}`, "house", fraction, side, setback, residents + 2, residents, undefined, `${place.code}/HOUSEHOLD/${index}`));
  }

  const forms: SettlementFieldForm[] = ["strip", "paddock", "orchard", "vegetable", "pasture"],
    fieldCount = place.kind === "city" ? 11 + (digest(`${place.code}/FIELD_COUNT`) % 6) : 5 + (digest(`${place.code}/FIELD_COUNT`) % 5);
  for (let index = 0; index < fieldCount; index++) {
    const street = streets[(index * 3 + digest(`${place.code}/FIELD/${index}/STREET`)) % streets.length],
      side: -1 | 1 = (digest(`${place.code}/FIELD/${index}/SIDE`) & 1) === 0 ? -1 : 1,
      form = forms[digest(`${place.code}/FIELD/${index}/FORM`) % forms.length],
      fraction = 0.08 + ((index * 0.271 + unit(`${place.code}/FIELD/${index}/FRACTION`)) % 1) * .84,
      setback = place.kind === "city" ? 48 + (index % 4) * 13 : archetype === "dispersed-farming" ? 28 + (index % 3) * 13 : 20 + (index % 3) * 9;
    plots.push(plotOnStreet(place, street, `FIELD/${index}`, "field", fraction, side, setback, 0, 0, undefined, undefined, form));
  }

  const gateCount = place.kind === "city" || archetype === "fortified-frontier" ? 2 : 1 + (digest(`${place.code}/GATE_COUNT`) & 1),
    gates: SettlementGatePlan[] = [];
  for (let index = 0; index < gateCount; index++) {
    const endPoint = index === 0 ? mainEnd : mainStart,
      before = index === 0 ? main.points[main.points.length - 2] : main.points[1],
      tangent = normalize(wrapSourceX(endPoint.x - before.x), endPoint.z - before.z),
      directed = index === 0 ? tangent : { x: -tangent.x, z: -tangent.z },
      gate = index === 0 && entranceSource ? entrance : endPoint,
      bearingRad = Math.atan2(directed.z, directed.x),
      normal = { x: -directed.z, z: directed.x },
      guardCount = 1 + (digest(`${place.code}/GATE/${index}/GUARDS`) & 1),
      guardPosts = Array.from({ length: guardCount }, (_, guardIndex) => {
        const direction = guardIndex === 0 ? 1 : -1,
          distance = place.kind === "city" ? 12 : 9;
        return { x: wrapSourceX(gate.x + normal.x * distance * direction), z: gate.z + normal.z * distance * direction };
      });
    gates.push({ id: `${place.code}/GATE/${index}`, x: gate.x, z: gate.z, bearingRad, guardPosts });
  }

  const borderCount = place.kind === "city" ? 40 : archetype === "fortified-frontier" ? 20 : 28,
    phaseA = TAU * unit(`${place.code}/BORDER/PHASE-A`),
    phaseB = TAU * unit(`${place.code}/BORDER/PHASE-B`),
    stretch = archetype === "roadside" ? 1.22 : archetype === "dispersed-farming" ? 1.12 : 1,
    lateralScale = archetype === "roadside" ? .78 : archetype === "hillside" ? .82 : 1,
    border = Array.from({ length: borderCount }, (_, index) => {
      const angle = (index / borderCount) * TAU,
        harmonic = 1 + Math.sin(angle * 2 + phaseA) * .08 + Math.sin(angle * 3 + phaseB) * .05,
        seeded = .94 + unit(`${place.code}/BORDER/${index}`) * .12,
        distance = radius * harmonic * seeded,
        along = Math.cos(angle) * distance * stretch,
        lateral = Math.sin(angle) * distance * lateralScale;
      return localPoint(place, axis, along, lateral);
    });

  return {
    placeId: place.id,
    placeCode: place.code,
    name: place.name,
    kind: place.kind,
    archetype,
    radius,
    primaryAxis: axis,
    centre,
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

export function settlementExteriorCacheSize() {
  return cache.size;
}

/** Diagnostics deliberately materialize every plan; ordinary rendering uses settlementExteriorFor lazily. */
export function settlementExteriorSummary() {
  let cityGates = 0,
    villageGates = 0,
    plots = 0,
    streets = 0,
    borderPoints = 0;
  const archetypes: Partial<Record<SettlementArchetype, number>> = {};
  for (const place of places) {
    const plan = settlementExteriorFor(place);
    plots += plan.plots.length;
    streets += plan.streets.length;
    borderPoints += plan.border.length;
    archetypes[plan.archetype] = (archetypes[plan.archetype] || 0) + 1;
    if (place.kind === "city") cityGates += plan.gates.length;
    else villageGates += plan.gates.length;
  }
  return { plans: places.length, plots, streets, borderPoints, cityGates, villageGates, archetypes, cachedPlans: cache.size } as const;
}
