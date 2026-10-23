import { roads, roadDistanceAt, type Place, type Road } from "./geography.ts";
import { politicalSettlementSiteById } from "./political-settlement-access.ts";
import { lonLatToSource, wrapSourceX } from "./planet.ts";
import { metresToSource, sourceUnitsPerMetreAt } from "./physical-scale.ts";

/**
 * Settlement layout, authored entirely in METRES in a local frame (origin = the
 * place, `a` along the primary road axis, `l` to its left). Only the final
 * conversion step maps local metres to source/render units, so streets, lots,
 * houses, castles, gates and clearances all share one physical scale.
 * Everything is derived from the SEED through the place code.
 */
export type SettlementService =
  | "market"
  | "inn"
  | "blacksmith"
  | "butcher"
  | "guard-office"
  | "farmstead";

export type SettlementPlotKind = "keep" | "well" | "house" | "field" | "service" | "park";
/** Public green space sub-type (a `park` plot). */
export type SettlementParkKind = "square" | "playground" | "flower-garden";
/** Seeded outline of a park: a rectangle, a rectangle with chamfered corners, an inscribed octagon or an inscribed ellipse. */
export type SettlementParkShape = "rect" | "cut" | "octagon" | "round";
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

/** `width` is metres in the core plan (the exterior module converts it to source units). */
export type SettlementStreetPlan = {
  id: string;
  width: number;
  points: readonly SettlementPoint[];
  sharedSegments?: readonly number[];
};

/** `width`/`depth` are metres and `clearanceRadius` is metres in the core plan; candidates are source points. */
export type SettlementPlotPlan = {
  id: string;
  kind: SettlementPlotKind;
  service?: SettlementService;
  fieldForm?: SettlementFieldForm;
  park?: SettlementParkKind;
  parkShape?: SettlementParkShape;
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

/** `radius` is source units (the physical radius in metres is `radiusM`). */
export type SettlementExteriorPlan = {
  placeId: string;
  placeCode: string;
  name: string;
  kind: Place["kind"];
  archetype: SettlementArchetype;
  radius: number;
  radiusM: number;
  primaryAxis: SettlementPoint;
  centre: SettlementPoint;
  entrance: SettlementPoint;
  streets: readonly SettlementStreetPlan[];
  border: readonly SettlementPoint[];
  plots: readonly SettlementPlotPlan[];
  gates: readonly SettlementGatePlan[];
};

/** One frontage lot: a street-facing building slot with a fixed setback. */
export type SettlementLot = {
  x: number;
  z: number;
  yawRad: number;
  /** Source displacement per metre along the street. */
  along: SettlementPoint;
  /** Source displacement per metre away from the street (towards the rear). */
  out: SettlementPoint;
  setbackM: number;
  nominalDepthM: number;
  street: number;
  side: -1 | 1;
};

export const SETTLEMENT_POPULATION = { city: 2400, village: 80 } as const;
/**
 * Smallest centre-to-centre distance between two lots: two clearance circles of the largest house (10.7 m), plus
 * the 0.25 m outward shift each largest house takes from its lot centre. Shorter spacing lets two homes overlap.
 */
export const MINIMUM_LOT_SPACING_M = 11.2;

const TAU = Math.PI * 2;
const PHI = 0.6180339887498949;
const U = metresToSource(1);

function digest(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function unit(address: string) {
  return digest(address) / 4294967296;
}
function normalize(x: number, z: number) {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

type LP = { a: number; l: number };
type Frame = { place: Place; axis: SettlementPoint; kx: number };
type LocalStreet = { id: string; width: number; pts: LP[]; cum: number[]; length: number };
type StaticDisk = { a: number; l: number; r: number };
type Layout = {
  frame: Frame;
  archetype: SettlementArchetype;
  radiusM: number;
  border: LP[];
  streets: LocalStreet[];
  statics: StaticDisk[];
  stretch: number;
  lateralScale: number;
  lots?: SettlementLot[];
  lotGrid?: Map<number, number[]>;
  lotOrder?: { offset: number; step: number; inverse: number };
  grid?: Map<number, number[]>;
};

const toSource = (f: Frame, a: number, l: number): SettlementPoint => ({
  x: wrapSourceX(f.place.x + (f.axis.x * a - f.axis.z * l) * U * f.kx),
  z: f.place.z + (f.axis.z * a + f.axis.x * l) * U,
});
const vecSource = (f: Frame, a: number, l: number): SettlementPoint => ({
  x: (f.axis.x * a - f.axis.z * l) * U * f.kx,
  z: (f.axis.z * a + f.axis.x * l) * U,
});
const yawOf = (f: Frame, a: number, l: number) => {
  const v = vecSource(f, a, l);
  return Math.atan2(v.x, v.z);
};

/** Source units (~15 µm): distances closer than this count as equal when choosing a settlement's road. */
const ROAD_TIE_EPSILON = 1e-6;
function closestRoad(place: Place) {
  let chosen: Road | undefined,
    distance = Infinity;
  for (const road of roads) {
    const candidate = roadDistanceAt(place.x, place.z, road);
    // Several roads usually start at the settlement itself (distance ~0). JavaScript engines differ by
    // ~1e-12 there, so near-ties are decided by road code, never by float noise (else the town's axis,
    // and its whole layout, would differ between browsers).
    if (candidate < distance - ROAD_TIE_EPSILON || (Math.abs(candidate - distance) <= ROAD_TIE_EPSILON && road.code < (chosen?.code || "~"))) {
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

/** Unit axis in METRE space (source x is stretched by 1/cos(latitude)). */
function primaryAxis(place: Place, kx: number) {
  const road = closestRoad(place);
  if (road) {
    const t = tangentAt(place, road);
    return normalize(t.x / kx, t.z);
  }
  const angle = TAU * unit(`${place.code}/EXTERIOR/AXIS`);
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function makeLocal(id: string, width: number, pts: LP[]): LocalStreet {
  const cum = [0];
  for (let index = 1; index < pts.length; index++) cum.push(cum[index - 1] + Math.hypot(pts[index].a - pts[index - 1].a, pts[index].l - pts[index - 1].l));
  return { id, width, pts, cum, length: cum[cum.length - 1] };
}

function sampleStreet(street: LocalStreet, distance: number) {
  const s = Math.max(0, Math.min(street.length, distance));
  let index = 1;
  while (index < street.pts.length - 1 && street.cum[index] < s) index++;
  const a = street.pts[index - 1],
    b = street.pts[index],
    span = street.cum[index] - street.cum[index - 1] || 1,
    t = Math.max(0, Math.min(1, (s - street.cum[index - 1]) / span)),
    tangent = normalize(b.a - a.a, b.l - a.l);
  return { a: a.a + (b.a - a.a) * t, l: a.l + (b.l - a.l) * t, ta: tangent.x, tl: tangent.z, na: -tangent.z, nl: tangent.x };
}

/** Polyline through control points; each span gets a deterministic sideways bend of a few metres. */
function polylineFromControls(place: Place, id: string, controls: readonly (readonly [number, number])[], step: number): LP[] {
  const pts: LP[] = [];
  for (let controlIndex = 1; controlIndex < controls.length; controlIndex++) {
    const a = controls[controlIndex - 1],
      b = controls[controlIndex],
      da = b[0] - a[0],
      dl = b[1] - a[1],
      length = Math.hypot(da, dl) || 1,
      steps = Math.max(2, Math.ceil(length / step)),
      bendSign = (digest(`${place.code}/STREET/${id}/BEND/${controlIndex}`) & 1) === 0 ? -1 : 1,
      bend = bendSign * Math.min(7, (1.5 + unit(`${place.code}/STREET/${id}/BEND-MAG/${controlIndex}`) * 3.5) * Math.min(1, length / 90)),
      na = -dl / length,
      nl = da / length;
    for (let s = controlIndex === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps,
        curve = Math.sin(Math.PI * t) * bend;
      pts.push({ a: a[0] + da * t + na * curve, l: a[1] + dl * t + nl * curve });
    }
  }
  return pts;
}

function loopControls(place: Place, id: string, radiusA: number, radiusL: number, count: number, centreA: number, centreL: number) {
  const controls: [number, number][] = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * TAU + (unit(`${place.code}/${id}/ANGLE/${index}`) - 0.5) * 0.18,
      radial = 0.86 + unit(`${place.code}/${id}/RADIUS/${index}`) * 0.24;
    controls.push([centreA + Math.cos(angle) * radiusA * radial, centreL + Math.sin(angle) * radiusL * radial]);
  }
  controls.push(controls[0]);
  return controls;
}

/** Farthest distance from the origin to the border along a local direction. */
function rayExtent(border: readonly LP[], angle: number) {
  const da = Math.cos(angle), dl = Math.sin(angle);
  let best = 0;
  for (let index = 0; index < border.length; index++) {
    const p = border[index], q = border[(index + 1) % border.length],
      ea = q.a - p.a, el = q.l - p.l, denominator = da * el - dl * ea;
    if (Math.abs(denominator) < 1e-9) continue;
    const t = (p.a * el - p.l * ea) / denominator,
      u = (p.a * dl - p.l * da) / denominator;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, t);
  }
  return best;
}

function insideBorder(border: readonly LP[], a: number, l: number, margin: number) {
  let inside = false, distance = Infinity;
  for (let index = 0; index < border.length; index++) {
    const p = border[index], q = border[(index + 1) % border.length],
      ea = q.a - p.a, el = q.l - p.l, denominator = ea * ea + el * el || 1,
      t = Math.max(0, Math.min(1, ((a - p.a) * ea + (l - p.l) * el) / denominator));
    distance = Math.min(distance, Math.hypot(a - (p.a + ea * t), l - (p.l + el * t)));
    if ((p.l > l) !== (q.l > l) && a < p.a + (l - p.l) * ea / (q.l - p.l)) inside = !inside;
  }
  return inside && distance >= margin;
}

function archetypeFor(place: Place): SettlementArchetype {
  const site = politicalSettlementSiteById.get(place.id),
    value = digest(`${place.code}/EXTERIOR/ARCHETYPE`),
    waterInfluenced = site?.waterContext === "freshwater-lake" || site?.waterContext === "coast",
    relief = site?.maximumEnvelopeReliefSpreadM || 0;
  if (place.kind === "city") {
    if (waterInfluenced && digest(`${place.code}/EXTERIOR/WATER-MORPH`) % 3 === 0) return "riverside";
    if (relief > 34 && digest(`${place.code}/EXTERIOR/RELIEF-MORPH`) % 3 === 1) return "hillside";
    return ["market-trade", "fortified-frontier", "riverside", "hillside"][value % 4] as SettlementArchetype;
  }
  if (waterInfluenced && digest(`${place.code}/EXTERIOR/WATER-MORPH`) % 4 === 0) return "riverside";
  if (relief > 28 && digest(`${place.code}/EXTERIOR/RELIEF-MORPH`) % 5 === 0) return "hillside";
  return [
    "roadside",
    "green",
    "crossroads",
    "dispersed-farming",
    "fortified-frontier",
    "market-trade",
  ][value % 6] as SettlementArchetype;
}

/**
 * Village streets (metres). The main street runs gate to gate along the road
 * axis; lanes branch off it. Old authoring values were relative to an 85-unit
 * radius, `K` maps them to real metres (a village is about 400 m across).
 */
const VILLAGE_K = 2.4;
function villageStreets(place: Place, archetype: SettlementArchetype, e0: number, e1: number, radius: number) {
  const K = VILLAGE_K,
    j = (salt: string, amount: number) => (unit(`${place.code}/STREET/${salt}`) - 0.5) * amount * K,
    c = (a: number, l: number): [number, number] => [a * K, l * K],
    list: { id: string; width: number; controls?: [number, number][]; loop?: [number, number, number, number, number] }[] = [];
  if (archetype === "roadside") {
    list.push({ id: "MAIN", width: 5.4, controls: [[-e0, j("A", 8)], [-e0 * .35, j("B", 16)], [e1 * .28, j("C", 14)], [e1, j("D", 9)]] });
    list.push({ id: "LANE-A", width: 4.2, controls: [c(-20, 4), c(-3, 30 + j("E", 10) / K), c(8, 49 + j("F", 9) / K)] });
  } else if (archetype === "green") {
    list.push({ id: "APPROACH", width: 5.2, controls: [[-e0, -5 * K], c(-32, -8), c(-15, -2), c(8, 0)] });
    list.push({ id: "COMMON-RING", width: 4.2, loop: [29 * K, 23 * K, 9, 8 * K, K] });
    list.push({ id: "BACK-LANE", width: 3.8, controls: [c(18, 18), c(42, 28 + j("G", 6) / K), [radius * .72, (22 + j("H", 8) / K) * K]] });
  } else if (archetype === "crossroads") {
    list.push({ id: "MAIN", width: 5.4, controls: [[-e0, -7 * K], c(-20, j("I", 8) / K), [e1, (9 + j("J", 6) / K) * K]] });
    list.push({ id: "CROSS", width: 4.5, controls: [[-11 * K, -radius * .72], c(-4, -19), c(7, 12), [18 * K, radius * .68]] });
    list.push({ id: "CROOKED-LANE", width: 3.6, controls: [c(14, 3), c(35, -19), c(55, -28 + j("K", 9) / K)] });
  } else if (archetype === "riverside") {
    list.push({ id: "BANK-ROAD", width: 5, controls: [[-e0, -18 * K], c(-35, -12 + j("L", 7) / K), c(18, -8), [e1, (-15 + j("M", 7) / K) * K]] });
    list.push({ id: "HIGH-STREET", width: 4.4, controls: [[-radius * .72, 25 * K], c(-22, 20), c(30, 28 + j("N", 7) / K), [radius * .62, 36 * K]] });
    list.push({ id: "WATER-LANE", width: 3.6, controls: [c(-17, -11), c(-5, 7), c(2, 23)] });
  } else if (archetype === "hillside") {
    list.push({ id: "LOW-CONTOUR", width: 4.8, controls: [[-e0 * .84, -27 * K], c(-30, -18), c(20, -24 + j("O", 8) / K), [e1 * .74, -12 * K]] });
    list.push({ id: "HIGH-CONTOUR", width: 4.2, controls: [[-radius * .62, 29 * K], c(-10, 23 + j("P", 8) / K), [radius * .63, 33 * K]] });
    list.push({ id: "SWITCHBACK", width: 3.7, controls: [c(-28, -19), c(-7, 3), c(-23, 22), c(1, 30)] });
  } else if (archetype === "dispersed-farming") {
    list.push({ id: "FARM-ROAD", width: 5, controls: [[-e0, 5 * K], c(-35, -6), c(14, 6 + j("Q", 10) / K), [e1, -8 * K]] });
    list.push({ id: "NORTH-TRACK", width: 3.5, controls: [c(-34, 0), c(-48, 29), c(-58, 58)] });
    list.push({ id: "SOUTH-TRACK", width: 3.5, controls: [c(26, 1), c(42, -30), c(51, -58)] });
  } else if (archetype === "fortified-frontier") {
    list.push({ id: "GATE-ROAD", width: 5.5, controls: [[-e0, 0], c(-28, -5), c(8, 3), [e1, 0]] });
    list.push({ id: "INNER-LANE", width: 4, loop: [40 * K, 30 * K, 8, 2 * K, 0] });
    list.push({ id: "WATCH-LANE", width: 3.6, controls: [c(-5, -29), c(20, -42), c(43, -31)] });
  } else {
    list.push({ id: "MARKET-STREET", width: 6.3, controls: [[-e0, -3 * K], c(-26, 1), c(18, -2), [e1, 7 * K]] });
    list.push({ id: "MERCHANT-LANE", width: 4.2, controls: [c(-18, 2), c(-8, 28), c(10, 48)] });
    list.push({ id: "CRAFT-LANE", width: 3.9, controls: [c(26, 0), c(35, -25), c(55, -36)] });
  }
  // Every village also has two back lanes parallel to its main street, tied to it by short links,
  // so households stand on real frontage instead of being strung along one road.
  const lane = (side: number) => {
    const off = side * (44 + (unit(`${place.code}/STREET/BACK/${side}`) - .5) * 14);
    return [[-e0 * .5, off * .55], [-e0 * .45, off], [-e0 * .1, off * 1.04], [e1 * .3, off * .98], [e1 * .52, off], [e1 * .55, off * .55]] as [number, number][];
  };
  list.push({ id: "BACK-LANE-N", width: 3.8, controls: lane(1) });
  list.push({ id: "BACK-LANE-S", width: 3.8, controls: lane(-1) });
  const outer = (side: number) => {
    const off = side * (84 + (unit(`${place.code}/STREET/OUTER/${side}`) - .5) * 12);
    return [[-e0 * .3, off * .5], [-e0 * .25, off], [0, off * 1.03], [e1 * .3, off], [e1 * .33, off * .5]] as [number, number][];
  };
  list.push({ id: "OUTER-LANE-N", width: 3.6, controls: outer(1) });
  list.push({ id: "OUTER-LANE-S", width: 3.6, controls: outer(-1) });
  list.push({ id: "LINK-W", width: 3.6, controls: [[-e0 * .5, 44], [-e0 * .5, 0], [-e0 * .5, -44]] });
  list.push({ id: "LINK-MID", width: 3.6, controls: [[e1 * .15, 46], [e1 * .15, 0], [e1 * .15, -46]] });
  list.push({ id: "LINK-E", width: 3.6, controls: [[e1 * .55, 44], [e1 * .55, 0], [e1 * .55, -44]] });
  return list.map((entry) => {
    const controls = entry.controls || loopControls(place, entry.id, entry.loop![0], entry.loop![1], entry.loop![2], entry.loop![3], entry.loop![4]);
    return makeLocal(`${place.code}/STREET/${entry.id}`, entry.width, polylineFromControls(place, entry.id, controls, 12));
  });
}

/**
 * City streets (metres): a market spine gate to gate, radial streets, and
 * concentric ring streets spaced for two rows of houses. Rings are slightly
 * distorted, radials bend, so no street is a ruler line.
 */
function cityStreets(place: Place, border: LP[], e0: number, e1: number, stretch: number, lateralScale: number) {
  const j = (salt: string, amount: number) => (unit(`${place.code}/CITY-STREET/${salt}`) - 0.5) * amount,
    streets: LocalStreet[] = [];
  streets.push(makeLocal(`${place.code}/STREET/MARKET-SPINE`, 8, polylineFromControls(place, "MARKET-SPINE", [[-e0, 0], [-e0 * .5, j("S1", 36)], [0, j("S2", 10)], [e1 * .5, j("S3", 36)], [e1, 0]], 12)));
  const edge = (angle: number) => rayExtent(border, angle), radialCount = 8;
  for (let k = 1; k < radialCount; k++) {
    if (k === radialCount / 2) continue;
    const angle = (k / radialCount) * TAU + j(`R-ANGLE/${k}`, .26), start = 60, end = edge(angle) - 16,
      bend = (digest(`${place.code}/CITY-RADIAL/${k}`) & 1 ? 1 : -1) * (4 + unit(`${place.code}/CITY-RADIAL/${k}/BEND`) * 7),
      pts: LP[] = [], steps = Math.max(2, Math.ceil((end - start) / 20));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, r = start + (end - start) * t, side = Math.sin(Math.PI * t) * bend;
      pts.push({ a: Math.cos(angle) * r - Math.sin(angle) * side, l: Math.sin(angle) * r + Math.cos(angle) * side });
    }
    streets.push(makeLocal(`${place.code}/STREET/RADIAL-${k}`, 6, pts));
  }
  let r = 66 + unit(`${place.code}/CITY-RING/FIRST`) * 6, ring = 0;
  const outermost = Math.min(edge(0), edge(Math.PI), edge(Math.PI / 2), edge(Math.PI * 1.5) - 22) * .93;
  while (r <= outermost) {
    const phase1 = TAU * unit(`${place.code}/CITY-RING/${ring}/P1`), phase2 = TAU * unit(`${place.code}/CITY-RING/${ring}/P2`),
      count = Math.max(24, Math.ceil(TAU * r / 16)), pts: LP[] = [];
    for (let index = 0; index <= count; index++) {
      const angle = (index % count) / count * TAU,
        radius = r * (1 + Math.sin(angle * 2 + phase1) * .045 + Math.sin(angle * 3 + phase2) * .028);
      pts.push({ a: Math.cos(angle) * radius * stretch, l: Math.sin(angle) * radius * lateralScale });
    }
    streets.push(makeLocal(`${place.code}/STREET/RING-${ring}`, 5.5, pts));
    r += 33.5 + unit(`${place.code}/CITY-RING/${ring}/GAP`) * 2.5;
    ring++;
  }
  return streets;
}

/** Along-street offsets (metres) a park may slide to when its planned spot is blocked, nearest first. */
const PARK_SLIDES_M = [6, -6, 12, -12, 18, -18, 24, -24, 30, -30, 36, -36, 42, -42, 48, -48, 54, -54, 60, -60] as const;
/** Extra metres a park may sit further back from its street (tried after every plain slide), so a wide park on a curved street clears its pavement. */
const PARK_PUSHES_M = [3, 6] as const;
/** Park size ranges in metres (width along the street, depth towards the rear), city and village. */
type MetreRange = readonly [number, number];
const PARK_RANGES: Record<SettlementParkKind, { city: { width: MetreRange; depth: MetreRange }; village: { width: MetreRange; depth: MetreRange } }> = {
  square: { city: { width: [24, 38], depth: [18, 28] }, village: { width: [16, 26], depth: [12, 20] } },
  playground: { city: { width: [12, 20], depth: [10, 15] }, village: { width: [11, 16], depth: [9, 13] } },
  "flower-garden": { city: { width: [9, 16], depth: [7, 12] }, village: { width: [8, 14], depth: [6, 10] } },
};
/** The outlines a park of each sub-type may take (equal weights). */
const PARK_SHAPES: Record<SettlementParkKind, readonly SettlementParkShape[]> = {
  square: ["rect", "cut", "octagon", "round"],
  playground: ["rect", "cut"],
  "flower-garden": ["rect", "round", "octagon"],
};

/**
 * A seeded park size and outline. Widths and depths are rounded to 0.5 m and kept inside their ranges; depth never exceeds width.
 * The shape is only a rendering hint: the placement footprint stays the full width × depth rectangle.
 */
export function parkFootprintFor(placeCode: string, id: string, park: SettlementParkKind, city: boolean): { width: number; depth: number; shape: SettlementParkShape } {
  const range = PARK_RANGES[park][city ? "city" : "village"],
    seeded = (salt: string, [low, high]: MetreRange) => Math.round((low + unit(`${placeCode}/PLOT/${id}/${salt}`) * (high - low)) * 2) / 2;
  let width = seeded("PARK-W", range.width), depth = seeded("PARK-D", range.depth);
  if (depth > width) [width, depth] = [depth, width];
  const shapes = PARK_SHAPES[park], shape = shapes[Math.floor(unit(`${placeCode}/PLOT/${id}/PARK-SHAPE`) * shapes.length)];
  return { width, depth, shape };
}

/** Park capacity scales with its area: one visitor per 12 m² (city square, flower garden), 18 m² (village square) or 9 m² (playground); at least 4. */
function parkCapacityFor(park: SettlementParkKind, area: number, city: boolean) {
  const perVisitor = park === "playground" ? 9 : park === "square" && !city ? 18 : 12;
  return Math.max(4, Math.round(area / perVisitor));
}

function footprintFor(
  place: Place,
  id: string,
  kind: SettlementPlotKind,
  service?: SettlementService,
  fieldForm?: SettlementFieldForm,
  park?: SettlementParkKind,
): { width: number; depth: number; shape?: SettlementParkShape } {
  const u = unit(`${place.code}/PLOT/${id}/FOOTPRINT`), city = place.kind === "city";
  if (kind === "keep") return city ? { width: 34, depth: 28 } : { width: 15, depth: 13 };
  if (kind === "well") return { width: 3, depth: 3 };
  if (kind === "park") return parkFootprintFor(place.code, id, park ?? "square", city);
  if (kind === "field") {
    if (fieldForm === "strip") return { width: 12 + u * 8, depth: 24 + u * 12 };
    if (fieldForm === "orchard") return { width: 22 + u * 8, depth: 20 + u * 7 };
    if (fieldForm === "pasture") return { width: 28 + u * 10, depth: 22 + u * 12 };
    return { width: 18 + u * 8, depth: 16 + u * 8 };
  }
  if (kind === "house") return { width: 6 + u * 2, depth: 8 + unit(`${place.code}/PLOT/${id}/DEPTH`) * 2 };
  switch (service) {
    case "market": return city ? { width: 28, depth: 20 } : { width: 18, depth: 13 };
    case "inn": return city ? { width: 17, depth: 19 } : { width: 13, depth: 16 };
    case "blacksmith": return { width: 13, depth: 12 };
    case "butcher": return { width: 10, depth: 11 };
    case "guard-office": return { width: 9, depth: 10 };
    case "farmstead": return { width: 18, depth: 15 };
    default: return { width: 9, depth: 9 };
  }
}

function cloud(layout: Layout, address: string, a: number, l: number, ta: number, tl: number, side: number, spread: number) {
  const result: SettlementPoint[] = [], na = -tl, nl = ta;
  result.push(toSource(layout.frame, a, l));
  for (let ring = 1; ring <= 4; ring++) for (let index = 0; index < 6; index++) {
    const phase = TAU * unit(`${address}/CANDIDATE/${ring}/${index}`),
      along = Math.cos(phase) * spread * ring,
      out = side * Math.abs(Math.sin(phase)) * spread * ring * 0.65;
    result.push(toSource(layout.frame, a + ta * along + na * out, l + tl * along + nl * out));
  }
  return result;
}

function plotOnStreet(
  layout: Layout,
  place: Place,
  streetIndex: number,
  id: string,
  kind: SettlementPlotKind,
  fraction: number,
  side: -1 | 1,
  setback: number,
  capacity: number,
  residents: number,
  service?: SettlementService,
  fieldForm?: SettlementFieldForm,
  park?: SettlementParkKind,
): SettlementPlotPlan {
  const street = layout.streets[streetIndex % layout.streets.length],
    base = sampleStreet(street, fraction * street.length),
    footprint = footprintFor(place, id, kind, service, fieldForm, park),
    plotCapacity = kind === "park" && park ? parkCapacityFor(park, footprint.width * footprint.depth, place.kind === "city") : capacity,
    lateral = side * (street.width * .5 + setback + footprint.depth * .5),
    a = base.a + base.na * lateral, l = base.l + base.nl * lateral,
    yawRad = yawOf(layout.frame, -base.na * side, -base.nl * side) + (unit(`${place.code}/PLOT/${id}/YAW`) - .5) * .12,
    clearanceRadius = Math.hypot(footprint.width, footprint.depth) * .5 + 1.5;
  layout.statics.push({ a, l, r: clearanceRadius });
  // A park that cannot take its planned spot may slide along the same street, on either side (planned spot first).
  const slide = (along: number, sign: -1 | 1, push = 0) => {
    const s = sampleStreet(street, fraction * street.length + along), offset = sign * side * (street.width * .5 + setback + push + footprint.depth * .5);
    return toSource(layout.frame, s.a + s.na * offset, s.l + s.nl * offset);
  };
  return {
    id: `${place.code}/PLOT/${id}`, kind, service, fieldForm, park, parkShape: footprint.shape, capacity: plotCapacity, residents,
    width: footprint.width, depth: footprint.depth, yawRad, clearanceRadius,
    candidates: [
      ...cloud(layout, `${place.code}/PLOT/${id}`, a, l, base.ta, base.tl, side, kind === "service" ? 6 : 5),
      ...(kind === "park" ? PARK_SLIDES_M.flatMap((along) => [slide(along, 1), slide(along, -1)]) : []),
      ...(kind === "park" ? PARK_PUSHES_M.flatMap((push) => [0, ...PARK_SLIDES_M].flatMap((along) => [slide(along, 1, push), slide(along, -1, push)])) : []),
    ],
  };
}

function servicePlot(
  layout: Layout,
  place: Place,
  service: SettlementService,
  streetIndex: number,
  fraction: number,
  side: -1 | 1,
  capacity: number,
  residents: number,
) {
  const setback = 5 + unit(`${place.code}/${service}/SETBACK`) * 5,
    base = plotOnStreet(layout, place, streetIndex, service.toUpperCase(), "service", fraction, side, setback, capacity, residents, service),
    candidates = [...base.candidates], fractions = [0.18, 0.34, 0.5, 0.66, 0.82] as const,
    reach = Math.min(layout.streets.length, 6);
  for (let offset = 0; offset < reach; offset++) {
    const street = layout.streets[(streetIndex + offset) % layout.streets.length];
    for (let fractionIndex = 0; fractionIndex < fractions.length; fractionIndex++) {
      const sample = sampleStreet(street, fractions[fractionIndex] * street.length),
        alternate: -1 | 1 = (digest(`${place.code}/${service}/ALT/${offset}/${fractionIndex}`) & 1) === 0 ? side : (side === 1 ? -1 : 1),
        lateral = alternate * (street.width * .5 + setback + base.depth * .5);
      for (const along of [0, 4.5, -4.5]) {
        const extra = along === 0 ? 0 : alternate * 3.5;
        candidates.push(toSource(layout.frame, sample.a + sample.ta * along + sample.na * (lateral + extra), sample.l + sample.tl * along + sample.nl * (lateral + extra)));
      }
    }
  }
  return { ...base, candidates };
}

const layouts = new Map<string, Layout>();
const plans = new Map<string, SettlementExteriorPlan>();

function buildPlan(place: Place, radiusBoostM: number): SettlementExteriorPlan {
  const city = place.kind === "city",
    kx = sourceUnitsPerMetreAt(place.z).x / U,
    axis = primaryAxis(place, kx),
    frame: Frame = { place, axis, kx },
    site = politicalSettlementSiteById.get(place.id),
    archetype = archetypeFor(place),
    entranceSource = site ? lonLatToSource(site.entrance.lon, site.entrance.lat) : undefined,
    radiusM = city
      ? 640 + Math.round(unit(`${place.code}/RADIUS`) * 50) + radiusBoostM
      : archetype === "dispersed-farming" ? 270 : archetype === "fortified-frontier" ? 205 : 185 + Math.round(unit(`${place.code}/RADIUS`) * 40),
    borderCount = city ? 40 : archetype === "fortified-frontier" ? 20 : 28,
    phaseA = TAU * unit(`${place.code}/BORDER/PHASE-A`),
    phaseB = TAU * unit(`${place.code}/BORDER/PHASE-B`),
    stretch = city ? 1 : archetype === "roadside" ? 1.22 : archetype === "dispersed-farming" ? 1.12 : 1,
    lateralScale = city ? 1 : archetype === "roadside" ? .78 : archetype === "hillside" ? .82 : 1,
    border: LP[] = Array.from({ length: borderCount }, (_, index) => {
      const angle = (index / borderCount) * TAU,
        harmonic = 1 + Math.sin(angle * 2 + phaseA) * (city ? .05 : .08) + Math.sin(angle * 3 + phaseB) * (city ? .03 : .05),
        seeded = .975 + unit(`${place.code}/BORDER/${index}`) * .05,
        distance = radiusM * harmonic * seeded;
      return { a: Math.cos(angle) * distance * stretch, l: Math.sin(angle) * distance * lateralScale };
    }),
    e0 = rayExtent(border, Math.PI), e1 = rayExtent(border, 0),
    streets = city ? cityStreets(place, border, e0, e1, stretch, lateralScale) : villageStreets(place, archetype, e0, e1, radiusM),
    layout: Layout = { frame, archetype, radiusM, border, streets, statics: [], stretch, lateralScale },
    plots: SettlementPlotPlan[] = [];
  layouts.set(place.code, layout);
  const mainStreet = streets[0],
    mainPoints = mainStreet.pts.map((p) => toSource(frame, p.a, p.l)),
    mainStart = mainPoints[0], mainEnd = mainPoints[mainPoints.length - 1],
    entrance = entranceSource ? { x: entranceSource.x, z: entranceSource.z } : unit(`${place.code}/ENTRANCE/END`) < 0.5 ? mainStart : mainEnd;

  plots.push(plotOnStreet(layout, place, 0, "KEEP", "keep", archetype === "fortified-frontier" ? 0.43 : 0.35, -1, 6, city ? 36 : 18, city ? 12 : 7));
  plots.push(plotOnStreet(layout, place, 0, "WELL", "well", archetype === "green" ? 0.54 : 0.5, 1, 2.5, 12, 0));
  plots.push(servicePlot(layout, place, "market", 0, city ? .52 : .56, -1, city ? 120 : 48, 0));
  plots.push(servicePlot(layout, place, "inn", Math.min(1, streets.length - 1), .38, 1, city ? 54 : 24, city ? 8 : 4));
  plots.push(servicePlot(layout, place, "blacksmith", Math.min(2, streets.length - 1), .68, -1, 10, 3));
  plots.push(servicePlot(layout, place, "butcher", Math.min(1, streets.length - 1), .63, -1, 12, 4));
  plots.push(servicePlot(layout, place, "guard-office", 0, .12, 1, 18, 6));
  plots.push(servicePlot(layout, place, "farmstead", streets.length - 1, .82, 1, 14, 6));

  // Public green spaces, placed after the services so they keep their own street frontage.
  const park = (streetIndex: number, id: string, type: SettlementParkKind, fraction: number, side: -1 | 1) =>
    plotOnStreet(layout, place, streetIndex, `PARK/${id}`, "park", fraction, side, 3, 0, 0, undefined, undefined, type);
  if (city) {
    plots.push(park(0, "SQUARE", "square", .44, 1));
    plots.push(park(2 % streets.length, "PLAYGROUND/0", "playground", .5, 1));
    plots.push(park(5 % streets.length, "PLAYGROUND/1", "playground", .5, -1));
    plots.push(park(1 % streets.length, "FLOWER/0", "flower-garden", .3, 1));
    plots.push(park(3 % streets.length, "FLOWER/1", "flower-garden", .3, -1));
    plots.push(park(6 % streets.length, "FLOWER/2", "flower-garden", .3, 1));
  } else {
    plots.push(park(0, "SQUARE", "square", .42, 1));
    plots.push(park(Math.min(1, streets.length - 1), "PLAYGROUND/0", "playground", .55, -1));
    plots.push(park(2 % streets.length, "FLOWER/0", "flower-garden", .35, 1));
    plots.push(park(3 % streets.length, "FLOWER/1", "flower-garden", .35, -1));
  }

  // Farmland lies outside the enclosure, one plot per bearing, never across the wall.
  const forms: SettlementFieldForm[] = ["strip", "paddock", "orchard", "vegetable", "pasture"],
    fieldCount = city ? 11 + (digest(`${place.code}/FIELD_COUNT`) % 6) : 5 + (digest(`${place.code}/FIELD_COUNT`) % 5);
  for (let index = 0; index < fieldCount; index++) {
    const id = `FIELD/${index}`, form = forms[digest(`${place.code}/FIELD/${index}/FORM`) % forms.length],
      footprint = footprintFor(place, id, "field", undefined, form),
      angle = TAU * unit(`${place.code}/FIELD/${index}/ANGLE`) + index * 2.399963,
      reach = rayExtent(border, angle) + 22 + footprint.depth * .5 + (index % 3) * 26,
      a = Math.cos(angle) * reach, l = Math.sin(angle) * reach,
      ta = -Math.sin(angle), tl = Math.cos(angle);
    plots.push({
      id: `${place.code}/PLOT/${id}`, kind: "field", fieldForm: form, capacity: 0, residents: 0,
      width: footprint.width, depth: footprint.depth,
      yawRad: yawOf(frame, -Math.cos(angle), -Math.sin(angle)) + (unit(`${place.code}/PLOT/${id}/YAW`) - .5) * .3,
      clearanceRadius: Math.hypot(footprint.width, footprint.depth) * .5 + 2,
      candidates: cloud(layout, `${place.code}/PLOT/${id}`, a, l, ta, tl, 1, 11),
    });
  }

  const gateCount = city || archetype === "fortified-frontier" ? 2 : 1 + (digest(`${place.code}/GATE_COUNT`) & 1),
    gates: SettlementGatePlan[] = [];
  for (let index = 0; index < gateCount; index++) {
    const endPoint = index === 0 ? mainEnd : mainStart,
      before = index === 0 ? mainPoints[mainPoints.length - 2] : mainPoints[1],
      tangent = normalize(wrapSourceX(endPoint.x - before.x), endPoint.z - before.z),
      directed = index === 0 ? tangent : { x: -tangent.x, z: -tangent.z },
      gate = index === 0 && entranceSource ? entrance : endPoint,
      bearingRad = Math.atan2(directed.z, directed.x),
      normal = { x: -directed.z, z: directed.x },
      guardCount = 1 + (digest(`${place.code}/GATE/${index}/GUARDS`) & 1),
      post = metresToSource(city ? 10 : 8),
      guardPosts = Array.from({ length: guardCount }, (_, guardIndex) => {
        const direction = guardIndex === 0 ? 1 : -1;
        return { x: wrapSourceX(gate.x + normal.x * post * direction), z: gate.z + normal.z * post * direction };
      });
    gates.push({ id: `${place.code}/GATE/${index}`, x: gate.x, z: gate.z, bearingRad, guardPosts });
  }

  return {
    placeId: place.id,
    placeCode: place.code,
    name: place.name,
    kind: place.kind,
    archetype,
    radius: metresToSource(radiusM),
    radiusM,
    primaryAxis: axis,
    centre: toSource(frame, 0, 0),
    entrance,
    streets: streets.map((street) => ({ id: street.id, width: street.width, points: street.pts.map((p) => toSource(frame, p.a, p.l)) })),
    border: border.map((p) => toSource(frame, p.a, p.l)),
    plots,
    gates,
  };
}

/**
 * Lazy deterministic exterior record. Camera/visit order never contributes.
 * A city that cannot seat every canonical household on its frontage lots grows
 * in fixed 30 m steps until it can (a function of the seed-keyed layout only).
 */
export function settlementExteriorFor(place: Place) {
  let plan = plans.get(place.code);
  if (!plan) {
    const wanted = Math.ceil(SETTLEMENT_POPULATION[place.kind] * 1.03);
    for (let boost = 0; boost <= 10; boost++) {
      plan = buildPlan(place, place.kind === "city" ? boost * 30 : 0);
      const layout = layouts.get(place.code)!;
      layout.lots = computeLots(layout, place, wanted);
      if (layout.lots.length >= wanted || place.kind !== "city") break;
    }
    plans.set(place.code, plan!);
    while (plans.size > 24) {
      const oldest = plans.keys().next().value!;
      plans.delete(oldest);
      layouts.delete(oldest);
    }
  }
  return plan!;
}

/** A placed frontage lot in metres: its centre, along-street axis (ta, tl) and outward axis (oa, ol). */
type FrontageLot = { a: number; l: number; ta: number; tl: number; oa: number; ol: number };
/** Conservative home box: the largest house (8 m wide, 10 m deep) with its eave overhang, plus the largest home shift (0.75 m). */
const HOME_HALF_ALONG_M = 4.2, HOME_HALF_OUT_M = 5.95, HOME_REACH_M = 2 * Math.hypot(HOME_HALF_ALONG_M, HOME_HALF_OUT_M);
/** Separating-axis test of two lots' home boxes, so neighbouring homes never overlap at any angle. */
function homesMayOverlap(p: FrontageLot, q: FrontageLot) {
  const dx = q.a - p.a, dl = q.l - p.l;
  for (const [ax, al] of [[p.ta, p.tl], [p.oa, p.ol], [q.ta, q.tl], [q.oa, q.ol]] as const) {
    const separation = Math.abs(dx * ax + dl * al),
      reachP = HOME_HALF_ALONG_M * Math.abs(p.ta * ax + p.tl * al) + HOME_HALF_OUT_M * Math.abs(p.oa * ax + p.ol * al),
      reachQ = HOME_HALF_ALONG_M * Math.abs(q.ta * ax + q.tl * al) + HOME_HALF_OUT_M * Math.abs(q.oa * ax + q.ol * al);
    if (separation >= reachP + reachQ) return false;
  }
  return true;
}

/** Frontage lots. A bounded segment grid keeps generation linear; rejection keeps lots off streets, walls, gates and public buildings. */
function tryLots(layout: Layout, place: Place, pitch: number): SettlementLot[] {
  const city = place.kind === "city", frame = layout.frame, nominalDepth = city ? 9.5 : 9,
    jitter = city ? 0 : Math.min(1.2, Math.max(0, (pitch - MINIMUM_LOT_SPACING_M - .6) / 2)),
    cell = 32, key = (x: number, y: number) => (Math.floor(x / cell) + 512) * 4096 + Math.floor(y / cell) + 512,
    segments = new Map<number, { a0: number; l0: number; a1: number; l1: number; half: number }[]>();
  for (const street of layout.streets) for (let index = 1; index < street.pts.length; index++) {
    const p = street.pts[index - 1], q = street.pts[index], seg = { a0: p.a, l0: p.l, a1: q.a, l1: q.l, half: street.width * .5 },
      steps = Math.max(1, Math.ceil(Math.hypot(q.a - p.a, q.l - p.l) / (cell * .5))), seen = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const k = key(p.a + (q.a - p.a) * s / steps, p.l + (q.l - p.l) * s / steps);
      if (seen.has(k)) continue;
      seen.add(k);
      const bucket = segments.get(k) || [];
      bucket.push(seg);
      segments.set(k, bucket);
    }
  }
  const nearStreet = (a: number, l: number) => {
    const cx = Math.floor(a / cell), cy = Math.floor(l / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const seg of segments.get((cx + dx + 512) * 4096 + cy + dy + 512) || []) {
      const ea = seg.a1 - seg.a0, el = seg.l1 - seg.l0, d2 = ea * ea + el * el || 1,
        t = Math.max(0, Math.min(1, ((a - seg.a0) * ea + (l - seg.l0) * el) / d2));
      if (Math.hypot(a - (seg.a0 + ea * t), l - (seg.l0 + el * t)) < seg.half + 5.6) return true;
    }
    return false;
  };
  const placed = new Map<number, FrontageLot[]>(), lotCell = 16,
    lotKey = (x: number, y: number) => (Math.floor(x / lotCell) + 1024) * 4096 + Math.floor(y / lotCell) + 1024,
    crowded = (lot: FrontageLot) => {
      const cx = Math.floor(lot.a / lotCell), cy = Math.floor(lot.l / lotCell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const other of placed.get((cx + dx + 1024) * 4096 + cy + dy + 1024) || []) {
        const distance = Math.hypot(lot.a - other.a, lot.l - other.l);
        if (distance < MINIMUM_LOT_SPACING_M || (distance < HOME_REACH_M && homesMayOverlap(lot, other))) return true;
      }
      return false;
    },
    gateZone = city ? 46 : 30, main = layout.streets[0],
    ends = [main.pts[0], main.pts[main.pts.length - 1]],
    lots: SettlementLot[] = [];
  for (let streetIndex = 0; streetIndex < layout.streets.length; streetIndex++) {
    const street = layout.streets[streetIndex];
    for (const side of [-1, 1] as const) {
      const margin = city ? 7 : 9;
      for (let s = margin, slot = 0; s <= street.length - margin; slot++) {
        const here = sampleStreet(street, s), ahead = sampleStreet(street, Math.min(street.length, s + 3)),
          curvature = (here.ta * ahead.tl - here.tl * ahead.ta) / 3,
          // Offset-curve speed: inner sides of bends are shorter, so step further along the street to keep the frontage pitch.
          speed = Math.max(.55, 1 - side * curvature * (street.width * .5 + (city ? 2.8 : 5) + (city ? 4.75 : 4.5))),
          step = pitch / speed, currentS = s;
        s += step;
        const block = Math.floor(currentS / (pitch * 4)),
          salt = `${place.code}/LOT/${streetIndex}/${side}`,
          setbackBase = city ? 2.2 + (digest(`${salt}/${block}`) % 13) / 10
            : layout.archetype === "dispersed-farming" ? 10 + (digest(`${salt}/${block}`) % 180) / 10
              : 3.5 + (digest(`${salt}/${block}`) % 46) / 10,
          setback = setbackBase + (city ? 0 : (unit(`${salt}/${slot}/SB`) - .5) * 1.2),
          along = Math.max(0, Math.min(street.length, currentS + (city ? 0 : (unit(`${salt}/${slot}/ALONG`) - .5) * 2 * jitter))),
          base = sampleStreet(street, along),
          offset = street.width * .5 + setback + nominalDepth * .5,
          a = base.a + base.na * side * offset, l = base.l + base.nl * side * offset;
        if (!insideBorder(layout.border, a, l, 10)) continue;
        if (ends.some((end) => Math.hypot(a - end.a, l - end.l) < gateZone)) continue;
        if (nearStreet(a, l)) continue;
        if (layout.statics.some((disk) => Math.hypot(a - disk.a, l - disk.l) < disk.r + 5.4)) continue;
        const frontage: FrontageLot = { a, l, ta: base.ta, tl: base.tl, oa: base.na * side, ol: base.nl * side };
        if (crowded(frontage)) continue;
        const k = lotKey(a, l), bucket = placed.get(k) || [];
        bucket.push(frontage);
        placed.set(k, bucket);
        const point = toSource(frame, a, l), jitterYaw = city ? 0 : (unit(`${salt}/${slot}/YAW`) - .5) * .1;
        lots.push({
          x: point.x, z: point.z,
          yawRad: yawOf(frame, -base.na * side, -base.nl * side) + jitterYaw,
          along: vecSource(frame, base.ta, base.tl),
          out: vecSource(frame, base.na * side, base.nl * side),
          setbackM: setback, nominalDepthM: nominalDepth, street: streetIndex, side,
        });
      }
    }
  }
  return lots;
}

function computeLots(layout: Layout, place: Place, wanted: number) {
  const floor = 11;
  let pitch = place.kind === "city" ? 13 : layout.archetype === "dispersed-farming" ? 34 : 24,
    lots = tryLots(layout, place, pitch);
  for (let attempt = 0; attempt < 24 && lots.length < wanted && pitch > floor; attempt++) {
    pitch = Math.max(floor, pitch * .94);
    lots = tryLots(layout, place, pitch);
  }
  return lots;
}
function lotsFor(place: Place): readonly SettlementLot[] {
  settlementExteriorFor(place);
  return layouts.get(place.code)!.lots!;
}

/** Number of frontage lots a settlement offers (always at least the canonical population). */
export function settlementLotCount(place: Place) {
  return lotsFor(place).length;
}

function lotOrder(place: Place, layout: Layout, count: number) {
  if (layout.lotOrder) return layout.lotOrder;
  let step = Math.max(1, Math.floor(count * (1 - PHI))) | 1;
  while (gcd(step, count) !== 1) step += 2;
  // modular inverse of step (extended Euclid) lets a lot find its resident without walking every home
  let [r0, r1, t0, t1] = [count, step % count, 0, 1];
  while (r1) { const q = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - q * r1]; [t0, t1] = [t1, t0 - q * t1]; }
  return (layout.lotOrder = { offset: digest(`${place.code}/LOT-ORDER`) % count, step, inverse: ((t0 % count) + count) % count });
}

/** The lot of resident home `index`: a seed-keyed coprime walk over every lot of the settlement. */
export function settlementLotFor(place: Place, index: number): SettlementLot {
  const lots = lotsFor(place), count = lots.length;
  if (!count) throw new RangeError(`${place.code} has no frontage lots`);
  const order = lotOrder(place, layouts.get(place.code)!, count);
  return lots[(order.offset + (index % count) * order.step) % count];
}

const LOT_CELL = metresToSource(64);
/**
 * Lots whose centre lies in a source-space rectangle, with the resident home
 * each seats (undefined = vacant lot). Only lots in the rectangle are touched,
 * so callers resolve just the visible area; the answer never depends on what
 * was asked before.
 */
export function settlementLotsInRect(place: Place, minX: number, minZ: number, maxX: number, maxZ: number) {
  const lots = lotsFor(place), layout = layouts.get(place.code)!, count = lots.length, order = lotOrder(place, layout, count),
    population = SETTLEMENT_POPULATION[place.kind], found: { lot: SettlementLot; index: number | undefined }[] = [];
  if (!layout.lotGrid) {
    layout.lotGrid = new Map();
    lots.forEach((lot, i) => {
      const k = Math.floor(wrapSourceX(lot.x - place.x) / LOT_CELL) * 100003 + Math.floor((lot.z - place.z) / LOT_CELL);
      const bucket = layout.lotGrid!.get(k) || [];
      bucket.push(i);
      layout.lotGrid!.set(k, bucket);
    });
  }
  const rx0 = wrapSourceX(minX - place.x), rx1 = rx0 + (maxX - minX), rz0 = minZ - place.z, rz1 = maxZ - place.z;
  for (let cx = Math.floor(rx0 / LOT_CELL); cx <= Math.floor(rx1 / LOT_CELL); cx++) for (let cz = Math.floor(rz0 / LOT_CELL); cz <= Math.floor(rz1 / LOT_CELL); cz++)
    for (const i of layout.lotGrid.get(cx * 100003 + cz) || []) {
      const lot = lots[i];
      const dx = wrapSourceX(lot.x - minX), dz = lot.z - minZ;
      if (dx < 0 || dx >= maxX - minX || dz < 0 || dz >= maxZ - minZ) continue;
      const index = ((i - order.offset) % count + count) % count * order.inverse % count;
      found.push({ lot, index: index < population ? index : undefined });
    }
  return found;
}

/** Resident home indices seated on lots inside a source rectangle (ascending). Only that area is touched. */
export function settlementHomeIndicesNear(place: Place, minX: number, maxX: number, minZ: number, maxZ: number) {
  return settlementLotsInRect(place, minX, minZ, maxX, maxZ).flatMap((entry) => entry.index === undefined ? [] : [entry.index]).sort((a, b) => a - b);
}
