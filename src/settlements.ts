import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { nearestPlace, places, type Place } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  politicalSettlementSiteById,
  type PoliticalSettlementSitePlan,
} from "./political-settlement-access.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  enuToPosition,
  lonLatToSource,
  positionToEnu,
  type CanonicalPosition,
} from "./planet.ts";

export type SettlementArchetype =
  | "roadstead"
  | "green"
  | "riverside"
  | "terraced"
  | "market-ring";
export type BuildingUse =
  | "home"
  | "inn"
  | "market"
  | "blacksmith"
  | "farmstead"
  | "barn"
  | "butcher"
  | "guard-office"
  | "guard-post"
  | "well";
export type ResidentProfession =
  | "innkeeper"
  | "merchant"
  | "blacksmith"
  | "farmer"
  | "butcher"
  | "guard"
  | "carpenter"
  | "weaver"
  | "miller"
  | "laborer";

export type SettlementStreet = {
  code: string;
  kind: "main" | "street" | "lane" | "green-ring";
  widthM: number;
  points: readonly CanonicalPosition[];
  sourcePoints: readonly { x: number; z: number }[];
};
export type SettlementGate = {
  code: string;
  position: CanonicalPosition;
  x: number;
  z: number;
  headingRad: number;
  widthM: number;
  guardPostCodes: readonly string[];
};
export type SettlementBuilding = {
  code: string;
  placeId: string;
  use: BuildingUse;
  position: CanonicalPosition;
  x: number;
  z: number;
  widthM: number;
  depthM: number;
  heightM: number;
  headingRad: number;
  entrance: CanonicalPosition;
  entranceX: number;
  entranceZ: number;
  capacity: number;
  rooms: readonly string[];
  workplaceProfession?: ResidentProfession;
  visualVariant: number;
};
export type SettlementField = {
  code: string;
  position: CanonicalPosition;
  x: number;
  z: number;
  widthM: number;
  depthM: number;
  headingRad: number;
  visualVariant: number;
};
export type SettlementResident = {
  code: string;
  placeId: string;
  homeCode: string;
  profession: ResidentProfession;
  workplaceCode?: string;
};
export type SettlementPlan = {
  placeId: string;
  placeCode: string;
  name: string;
  kind: Place["kind"];
  archetype: SettlementArchetype;
  population: number;
  site: PoliticalSettlementSitePlan;
  streets: readonly SettlementStreet[];
  gates: readonly SettlementGate[];
  border: readonly CanonicalPosition[];
  borderSource: readonly { x: number; z: number }[];
  buildings: readonly SettlementBuilding[];
  fields: readonly SettlementField[];
  residents: readonly SettlementResident[];
};
export type SettlementRenderFeature = {
  kind: "house" | "keep" | "field" | "well";
  role: BuildingUse | "field";
  x: number;
  z: number;
  code: string;
  variant: number;
  width: number;
  depth: number;
  height: number;
  heading: number;
};

type LocalPoint = { east: number; north: number };
type Candidate = LocalPoint & { heading: number; score: number };
const TAU = Math.PI * 2;
const RENDER_HORIZONTAL_EXAGGERATION = 1.2;
const RENDER_VERTICAL_EXAGGERATION = 4.5;
const planCache = new Map<string, SettlementPlan>();

function digest(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/SETTLEMENT/${address}`) / 4294967296;
}
function signed(address: string) {
  return addressed(address) * 2 - 1;
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function distance(a: LocalPoint, b: LocalPoint) {
  return Math.hypot(a.east - b.east, a.north - b.north);
}
function localPosition(origin: CanonicalPosition, point: LocalPoint) {
  return enuToPosition({ east: point.east, north: point.north, up: 0 }, origin);
}
function sourceOf(position: CanonicalPosition) {
  return lonLatToSource(position.lon, position.lat);
}
function toLocal(origin: CanonicalPosition, position: CanonicalPosition): LocalPoint {
  const local = positionToEnu(position, origin);
  return { east: local.east, north: local.north };
}
function heading(a: LocalPoint, b: LocalPoint) {
  return Math.atan2(b.north - a.north, b.east - a.east);
}
function lerpPoint(a: LocalPoint, b: LocalPoint, t: number): LocalPoint {
  return {
    east: a.east + (b.east - a.east) * t,
    north: a.north + (b.north - a.north) * t,
  };
}
function polylineLength(points: readonly LocalPoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}
function pointOnPolyline(points: readonly LocalPoint[], targetM: number) {
  let remaining = targetM;
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (remaining <= length || i === points.length - 1) {
      const t = length <= 1e-9 ? 0 : clamp(remaining / length, 0, 1);
      return { point: lerpPoint(points[i - 1], points[i], t), heading: heading(points[i - 1], points[i]) };
    }
    remaining -= length;
  }
  return { point: points.at(-1)!, heading: heading(points.at(-2)!, points.at(-1)!) };
}

function chooseArchetype(place: Place, site: PoliticalSettlementSitePlan): SettlementArchetype {
  if (place.kind === "city")
    return addressed(`${place.code}/CITY/FORM`) < 0.58 ? "market-ring" : "terraced";
  if (site.waterContext === "freshwater-lake" || site.waterContext === "coast")
    return addressed(`${place.code}/WATER/FORM`) < 0.72 ? "riverside" : "green";
  const value = addressed(`${place.code}/FORM`);
  return value < 0.34 ? "roadstead" : value < 0.68 ? "green" : "terraced";
}

function streetRecord(
  place: Place,
  index: number,
  kind: SettlementStreet["kind"],
  widthM: number,
  local: readonly LocalPoint[],
): SettlementStreet {
  const points = local.map((point) => localPosition(place.canonicalPosition, point));
  return {
    code: `${place.code}/STREET/${index}/${kind}`,
    kind,
    widthM,
    points,
    sourcePoints: points.map(sourceOf),
  };
}

function makeStreets(place: Place, site: PoliticalSettlementSitePlan, archetype: SettlementArchetype) {
  const entrance = toLocal(place.canonicalPosition, site.entrance),
    entranceAngle = Math.atan2(entrance.north, entrance.east),
    gateRadius = site.envelopeRadiusM * 0.78,
    bend = site.envelopeRadiusM * 0.12 * signed(`${place.code}/MAIN/BEND`),
    perpendicular = { east: -Math.sin(entranceAngle) * bend, north: Math.cos(entranceAngle) * bend },
    main: LocalPoint[] = [
      entrance,
      { east: Math.cos(entranceAngle) * gateRadius, north: Math.sin(entranceAngle) * gateRadius },
      {
        east: Math.cos(entranceAngle) * gateRadius * 0.46 + perpendicular.east,
        north: Math.sin(entranceAngle) * gateRadius * 0.46 + perpendicular.north,
      },
      { east: -perpendicular.east * 0.2, north: -perpendicular.north * 0.2 },
      {
        east: -Math.cos(entranceAngle) * site.envelopeRadiusM * 0.62,
        north: -Math.sin(entranceAngle) * site.envelopeRadiusM * 0.62,
      },
    ],
    streets: SettlementStreet[] = [
      streetRecord(place, 0, "main", place.kind === "city" ? 9 : 6, main),
    ];

  if (archetype === "green" || archetype === "market-ring") {
    const radius = site.envelopeRadiusM * (place.kind === "city" ? 0.3 : 0.24),
      points: LocalPoint[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * TAU + entranceAngle * 0.17,
        r = radius * (1 + 0.08 * signed(`${place.code}/GREEN/${i}`));
      points.push({ east: Math.cos(a) * r, north: Math.sin(a) * r });
    }
    streets.push(streetRecord(place, streets.length, "green-ring", place.kind === "city" ? 8 : 5, points));
  }

  const branchCount = place.kind === "city" ? 5 : archetype === "roadstead" ? 2 : 3,
    branchLength = site.envelopeRadiusM * (place.kind === "city" ? 0.72 : 0.58),
    base = entranceAngle + Math.PI / 2;
  for (let branch = 0; branch < branchCount; branch++) {
    const angle =
        base +
        (branch - (branchCount - 1) / 2) * (place.kind === "city" ? 0.58 : 0.76) +
        signed(`${place.code}/BRANCH/${branch}/ANGLE`) * 0.18,
      startRadius = site.envelopeRadiusM * (0.05 + 0.08 * addressed(`${place.code}/BRANCH/${branch}/START`)),
      lateral = branchLength * 0.12 * signed(`${place.code}/BRANCH/${branch}/BEND`),
      start = {
        east: Math.cos(angle + Math.PI) * startRadius,
        north: Math.sin(angle + Math.PI) * startRadius,
      },
      mid = {
        east: Math.cos(angle) * branchLength * 0.46 - Math.sin(angle) * lateral,
        north: Math.sin(angle) * branchLength * 0.46 + Math.cos(angle) * lateral,
      },
      endLength = branchLength * (0.86 + 0.1 * addressed(`${place.code}/BRANCH/${branch}/LENGTH`)),
      end = { east: Math.cos(angle) * endLength, north: Math.sin(angle) * endLength };
    streets.push(streetRecord(place, streets.length, "street", place.kind === "city" ? 7 : 4.6, [start, mid, end]));
  }

  if (archetype === "riverside") {
    const tangent = entranceAngle + Math.PI / 2,
      radius = site.envelopeRadiusM * 0.58,
      points: LocalPoint[] = [];
    for (let i = -3; i <= 3; i++) {
      const along = (i / 3) * radius,
        curve = site.envelopeRadiusM * 0.1 * (1 - (i * i) / 9);
      points.push({
        east: Math.cos(tangent) * along + Math.cos(entranceAngle) * curve,
        north: Math.sin(tangent) * along + Math.sin(entranceAngle) * curve,
      });
    }
    streets.push(streetRecord(place, streets.length, "street", 5, points));
  }

  if (archetype === "terraced") {
    for (let band = -1; band <= 1; band++) {
      const offset = band * site.envelopeRadiusM * 0.24,
        tangent = entranceAngle + Math.PI / 2,
        length = site.envelopeRadiusM * (0.58 - Math.abs(band) * 0.08),
        points: LocalPoint[] = [];
      for (let i = -2; i <= 2; i++) {
        const along = (i / 2) * length,
          wobble = signed(`${place.code}/TERRACE/${band}/${i}`) * site.envelopeRadiusM * 0.025;
        points.push({
          east: Math.cos(tangent) * along + Math.cos(entranceAngle) * (offset + wobble),
          north: Math.sin(tangent) * along + Math.sin(entranceAngle) * (offset + wobble),
        });
      }
      streets.push(streetRecord(place, streets.length, "lane", place.kind === "city" ? 6 : 4.2, points));
    }
  }
  return streets;
}

function plotCandidates(place: Place, site: PoliticalSettlementSitePlan, streets: readonly SettlementStreet[]) {
  const result: Candidate[] = [];
  for (let streetIndex = 0; streetIndex < streets.length; streetIndex++) {
    const local = streets[streetIndex].points.map((point) => toLocal(place.canonicalPosition, point)),
      length = polylineLength(local),
      spacing =
        (place.kind === "city" ? 15 : 18) +
        addressed(`${place.code}/PLOT/${streetIndex}/SPACING`) * (place.kind === "city" ? 7 : 8),
      count = Math.max(1, Math.floor(length / spacing));
    for (let step = 1; step < count; step++) {
      const sampled = pointOnPolyline(
        local,
        step * spacing + signed(`${place.code}/PLOT/${streetIndex}/${step}/ALONG`) * spacing * 0.22,
      );
      for (const side of [-1, 1]) {
        const offset =
            (place.kind === "city" ? 11 : 12.5) +
            addressed(`${place.code}/PLOT/${streetIndex}/${step}/${side}/OFFSET`) *
              (place.kind === "city" ? 7 : 8),
          angle = sampled.heading + side * Math.PI / 2,
          point = {
            east: sampled.point.east + Math.cos(angle) * offset,
            north: sampled.point.north + Math.sin(angle) * offset,
          },
          radius = Math.hypot(point.east, point.north);
        if (radius > site.envelopeRadiusM * 0.77 || radius < 15) continue;
        result.push({
          ...point,
          heading:
            sampled.heading +
            (side < 0 ? Math.PI : 0) +
            signed(`${place.code}/PLOT/${streetIndex}/${step}/${side}/ANGLE`) * 0.1,
          score: radius + addressed(`${place.code}/PLOT/${streetIndex}/${step}/${side}/RANK`) * 5,
        });
      }
    }
  }

  const rings = place.kind === "city" ? 9 : 6,
    baseCount = place.kind === "city" ? 40 : 22;
  for (let ring = 1; ring <= rings; ring++) {
    const radius = site.envelopeRadiusM * (0.16 + (ring / rings) * 0.59),
      count = Math.max(8, Math.round(baseCount * (0.45 + ring / rings)));
    for (let i = 0; i < count; i++) {
      const angle =
          TAU * ((i * 0.61803398875 + addressed(`${place.code}/RING/${ring}/PHASE`)) % 1) +
          signed(`${place.code}/RING/${ring}/${i}/JITTER`) * 0.045,
        radial = radius * (0.94 + 0.12 * addressed(`${place.code}/RING/${ring}/${i}/R`));
      result.push({
        east: Math.cos(angle) * radial,
        north: Math.sin(angle) * radial,
        heading: angle + Math.PI / 2 + signed(`${place.code}/RING/${ring}/${i}/H`) * 0.16,
        score: radial + 8 + addressed(`${place.code}/RING/${ring}/${i}/S`) * 7,
      });
    }
  }
  return result.sort((a, b) => a.score - b.score || a.east - b.east || a.north - b.north);
}

const PROGRAM: Record<
  BuildingUse,
  {
    width: [number, number];
    depth: [number, number];
    height: [number, number];
    capacity: number;
    rooms: readonly string[];
    profession?: ResidentProfession;
  }
> = {
  home: { width: [8, 11], depth: [9, 13], height: [5, 7.2], capacity: 1, rooms: ["living/common", "bedroom", "latrine"] },
  inn: { width: [18, 24], depth: [15, 20], height: [8, 11], capacity: 14, rooms: ["common room", "kitchen/service", "guest room A", "guest room B", "storage"], profession: "innkeeper" },
  market: { width: [20, 28], depth: [14, 20], height: [5.5, 7.5], capacity: 18, rooms: ["selling hall", "stalls", "storage"], profession: "merchant" },
  blacksmith: { width: [14, 18], depth: [12, 16], height: [6, 8], capacity: 5, rooms: ["forge", "work floor", "fuel/tool storage"], profession: "blacksmith" },
  farmstead: { width: [16, 21], depth: [14, 19], height: [6, 8], capacity: 8, rooms: ["farm living", "work room", "produce storage"], profession: "farmer" },
  barn: { width: [8, 13], depth: [8, 14], height: [7, 10], capacity: 12, rooms: ["storage bay", "work aisle"] },
  butcher: { width: [12, 16], depth: [10, 14], height: [5.5, 7], capacity: 5, rooms: ["sales", "work room", "cold/storage"], profession: "butcher" },
  "guard-office": { width: [12, 17], depth: [10, 14], height: [6, 8], capacity: 8, rooms: ["duty room", "equipment storage", "rest alcove"], profession: "guard" },
  "guard-post": { width: [6, 8], depth: [5, 7], height: [7, 10], capacity: 2, rooms: ["duty shelter", "equipment niche"], profession: "guard" },
  well: { width: [4, 5], depth: [4, 5], height: [2, 3], capacity: 10, rooms: ["water point"] },
};

function dimensions(place: Place, use: BuildingUse, slot: number) {
  const p = PROGRAM[use];
  return {
    widthM: p.width[0] + (p.width[1] - p.width[0]) * addressed(`${place.code}/BUILD/${use}/${slot}/W`),
    depthM: p.depth[0] + (p.depth[1] - p.depth[0]) * addressed(`${place.code}/BUILD/${use}/${slot}/D`),
    heightM: p.height[0] + (p.height[1] - p.height[0]) * addressed(`${place.code}/BUILD/${use}/${slot}/H`),
    program: p,
  };
}

function makeBuilding(
  place: Place,
  use: BuildingUse,
  slot: number,
  candidate: Candidate,
): SettlementBuilding {
  const { widthM, depthM, heightM, program } = dimensions(place, use, slot),
    position = localPosition(place.canonicalPosition, candidate),
    source = sourceOf(position),
    entranceLocal = {
      east: candidate.east + Math.cos(candidate.heading + Math.PI / 2) * (depthM * 0.5 + 1.2),
      north: candidate.north + Math.sin(candidate.heading + Math.PI / 2) * (depthM * 0.5 + 1.2),
    },
    entrance = localPosition(place.canonicalPosition, entranceLocal),
    entranceSource = sourceOf(entrance);
  return {
    code: `${place.code}/BUILD/${use}/${slot}`,
    placeId: place.id,
    use,
    position,
    x: source.x,
    z: source.z,
    widthM,
    depthM,
    heightM,
    headingRad: candidate.heading,
    entrance,
    entranceX: entranceSource.x,
    entranceZ: entranceSource.z,
    capacity: program.capacity,
    rooms: program.rooms,
    workplaceProfession: program.profession,
    visualVariant: digest(`${place.code}/BUILD/${use}/${slot}/VISUAL`),
  };
}

function buildPlan(place: Place): SettlementPlan {
  const site = politicalSettlementSiteById.get(place.id);
  if (!site) throw new Error(`Settlement ${place.id} has no accepted political site plan`);
  const archetype = chooseArchetype(place, site),
    streets = makeStreets(place, site, archetype),
    candidates = plotCandidates(place, site, streets),
    accepted: SettlementBuilding[] = [],
    acceptedLocal: LocalPoint[] = [],
    used = new Set<number>();

  const accept = (use: BuildingUse, slot: number, candidate: Candidate) => {
    const building = makeBuilding(place, use, slot, candidate);
    accepted.push(building);
    acceptedLocal.push({ east: candidate.east, north: candidate.north });
    return building;
  };
  const pick = (use: BuildingUse, slot: number, preference: "centre" | "outer" = "centre") => {
    const dims = dimensions(place, use, slot);
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const c = candidates[i],
        radial = Math.hypot(c.east, c.north),
        score =
          (preference === "outer" ? Math.abs(radial - site.envelopeRadiusM * 0.62) : radial) +
          addressed(`${place.code}/PICK/${use}/${slot}/${i}`) * 9,
        need = Math.hypot(dims.widthM, dims.depthM) * 0.5 + 3;
      if (score >= bestScore) continue;
      let overlap = false;
      for (let j = 0; j < accepted.length; j++) {
        const other = Math.hypot(accepted[j].widthM, accepted[j].depthM) * 0.5 + 2;
        if (distance(c, acceptedLocal[j]) < need + other) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) throw new Error(`Settlement ${place.id} could not place ${use}/${slot}`);
    used.add(best);
    return accept(use, slot, candidates[best]);
  };

  const serviceUses: BuildingUse[] = [
    "inn",
    "market",
    "blacksmith",
    "farmstead",
    "butcher",
    "guard-office",
    "barn",
  ];
  const services = serviceUses.map((use, index) =>
    pick(use, index, use === "farmstead" || use === "barn" ? "outer" : "centre"),
  );
  accept("well", 0, {
    east: signed(`${place.code}/WELL/E`) * 5,
    north: signed(`${place.code}/WELL/N`) * 5,
    heading: 0,
    score: 0,
  });

  const entrance = toLocal(place.canonicalPosition, site.entrance),
    entranceAngle = Math.atan2(entrance.north, entrance.east),
    gateCount = addressed(`${place.code}/GATE/COUNT`) < 0.54 ? 1 : 2,
    gates: SettlementGate[] = [];
  for (let gateIndex = 0; gateIndex < gateCount; gateIndex++) {
    const angle =
        gateIndex === 0
          ? entranceAngle
          : entranceAngle + Math.PI + signed(`${place.code}/GATE/SECOND`) * 0.34,
      radius = site.envelopeRadiusM * (0.76 + 0.035 * addressed(`${place.code}/GATE/${gateIndex}/R`)),
      gateLocal = { east: Math.cos(angle) * radius, north: Math.sin(angle) * radius },
      guardCount = 1 + (digest(`${place.code}/GATE/${gateIndex}/GUARDS`) & 1),
      guardPostCodes: string[] = [];
    for (let guard = 0; guard < guardCount; guard++) {
      const side = guard % 2 === 0 ? -1 : 1,
        tangent = angle + side * Math.PI / 2,
        post = accept("guard-post", gateIndex * 2 + guard, {
          east: gateLocal.east + Math.cos(tangent) * (7 + guard * 4),
          north: gateLocal.north + Math.sin(tangent) * (7 + guard * 4),
          heading: angle,
          score: 0,
        });
      guardPostCodes.push(post.code);
    }
    const position = localPosition(place.canonicalPosition, gateLocal),
      source = sourceOf(position);
    gates.push({
      code: `${place.code}/GATE/${gateIndex}`,
      position,
      x: source.x,
      z: source.z,
      headingRad: angle,
      widthM: place.kind === "city" ? 9 : 6,
      guardPostCodes,
    });
  }

  const nonHomes = accepted.length,
    population = Math.floor(
      place.kind === "city"
        ? clamp(site.plotCapacity - nonHomes - 8, 96, 160)
        : clamp(site.plotCapacity - nonHomes - 4, 24, 38),
    );
  for (let i = 0; i < population; i++)
    pick("home", i, i < population * 0.35 ? "centre" : "outer");

  const border: CanonicalPosition[] = [],
    borderSource: { x: number; z: number }[] = [],
    vertices = place.kind === "city" ? 18 : 12;
  for (let i = 0; i <= vertices; i++) {
    const index = i % vertices,
      angle = (index / vertices) * TAU + addressed(`${place.code}/BORDER/PHASE`) * 0.18,
      radius = site.envelopeRadiusM * (0.79 + signed(`${place.code}/BORDER/${index}`) * 0.045),
      position = localPosition(place.canonicalPosition, {
        east: Math.cos(angle) * radius,
        north: Math.sin(angle) * radius,
      });
    border.push(position);
    borderSource.push(sourceOf(position));
  }

  const fields: SettlementField[] = [],
    fieldCount = place.kind === "city" ? 5 : 4 + (digest(`${place.code}/FIELD/COUNT`) % 3);
  for (let i = 0; i < fieldCount; i++) {
    const angle =
        TAU * ((i / fieldCount + addressed(`${place.code}/FIELD/${i}/PHASE`) * 0.16) % 1),
      radius = site.envelopeRadiusM * (0.66 + addressed(`${place.code}/FIELD/${i}/R`) * 0.18),
      position = localPosition(place.canonicalPosition, {
        east: Math.cos(angle) * radius,
        north: Math.sin(angle) * radius,
      }),
      source = sourceOf(position);
    fields.push({
      code: `${place.code}/FIELD/${i}`,
      position,
      x: source.x,
      z: source.z,
      widthM: 28 + addressed(`${place.code}/FIELD/${i}/W`) * (place.kind === "city" ? 38 : 24),
      depthM: 18 + addressed(`${place.code}/FIELD/${i}/D`) * 28,
      headingRad: angle + Math.PI / 2 + signed(`${place.code}/FIELD/${i}/H`) * 0.4,
      visualVariant: digest(`${place.code}/FIELD/${i}/V`),
    });
  }

  const homes = accepted.filter((building) => building.use === "home"),
    workplace = new Map<ResidentProfession, string>();
  for (const service of services)
    if (service.workplaceProfession) workplace.set(service.workplaceProfession, service.code);
  const mandatory: { profession: ResidentProfession; workplace?: string }[] = [
    { profession: "innkeeper", workplace: workplace.get("innkeeper") },
    { profession: "merchant", workplace: workplace.get("merchant") },
    { profession: "blacksmith", workplace: workplace.get("blacksmith") },
    { profession: "farmer", workplace: workplace.get("farmer") },
    { profession: "butcher", workplace: workplace.get("butcher") },
    { profession: "guard", workplace: workplace.get("guard") },
    ...accepted
      .filter((building) => building.use === "guard-post")
      .map((building) => ({ profession: "guard" as const, workplace: building.code })),
  ],
    fallback: ResidentProfession[] = ["carpenter", "weaver", "miller", "laborer"],
    residents = homes.map((home, index): SettlementResident => {
      const assignment = mandatory[index] ?? {
        profession: fallback[digest(`${place.code}/RESIDENT/${index}/PROF`) % fallback.length],
        workplace: undefined,
      };
      return {
        code: `${place.code}/RESIDENT/${index}`,
        placeId: place.id,
        homeCode: home.code,
        profession: assignment.profession,
        workplaceCode: assignment.workplace,
      };
    });

  return {
    placeId: place.id,
    placeCode: place.code,
    name: place.name,
    kind: place.kind,
    archetype,
    population,
    site,
    streets,
    gates,
    border,
    borderSource,
    buildings: accepted,
    fields,
    residents,
  };
}

export function settlementPlan(placeId: string) {
  let plan = planCache.get(placeId);
  if (plan) return plan;
  const place = places.find((candidate) => candidate.id === placeId);
  if (!place) throw new RangeError(`Unknown settlement ${placeId}`);
  plan = buildPlan(place);
  planCache.set(placeId, plan);
  return plan;
}
export function settlementPlans() {
  return places.map((place) => settlementPlan(place.id));
}
export function settlementPopulation(placeId: string) {
  return settlementPlan(placeId).population;
}
export function settlementBuilding(code: string): SettlementBuilding | undefined {
  for (const place of places) {
    if (!code.startsWith(`${place.code}/BUILD/`)) continue;
    return settlementPlan(place.id).buildings.find((building) => building.code === code);
  }
  return undefined;
}
export function settlementResident(placeId: string, index: number) {
  return settlementPlan(placeId).residents[index];
}
export function settlementBuildingsNearSource(x: number, z: number, radiusSource = 80) {
  return places
    .filter((place) => Math.hypot(place.x - x, place.z - z) <= radiusSource)
    .flatMap((place) => settlementPlan(place.id).buildings);
}

function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const vx = bx - ax,
    vz = bz - az,
    lengthSq = vx * vx + vz * vz,
    t = lengthSq <= 1e-12 ? 0 : clamp(((px - ax) * vx + (pz - az) * vz) / lengthSq, 0, 1),
    dx = px - (ax + vx * t),
    dz = pz - (az + vz * t);
  return Math.hypot(dx, dz);
}
export function settlementStreetAtSource(x: number, z: number) {
  const place = nearestPlace(x, z);
  if (!place) return false;
  const site = politicalSettlementSiteById.get(place.id);
  if (!site) return false;
  const radiusSource = (site.envelopeRadiusM + 320) / CANONICAL_METRES_PER_SOURCE_UNIT;
  if (Math.hypot(place.x - x, place.z - z) > radiusSource) return false;
  for (const street of settlementPlan(place.id).streets) {
    const halfWidth = Math.max(
      0.28,
      (street.widthM * 0.5) / CANONICAL_METRES_PER_SOURCE_UNIT,
    );
    for (let i = 1; i < street.sourcePoints.length; i++) {
      const a = street.sourcePoints[i - 1],
        b = street.sourcePoints[i];
      if (segmentDistance(x, z, a.x, a.z, b.x, b.z) <= halfWidth) return true;
    }
  }
  return false;
}

export function settlementRenderFeaturesForBounds(
  minX: number,
  minZ: number,
  size: number,
): SettlementRenderFeature[] {
  const result: SettlementRenderFeature[] = [],
    maxX = minX + size,
    maxZ = minZ + size,
    margin = 36;
  for (const place of places) {
    if (
      place.x < minX - margin ||
      place.x > maxX + margin ||
      place.z < minZ - margin ||
      place.z > maxZ + margin
    )
      continue;
    const plan = settlementPlan(place.id);
    for (const building of plan.buildings) {
      if (
        building.x < minX ||
        building.x >= maxX ||
        building.z < minZ ||
        building.z >= maxZ
      )
        continue;
      result.push({
        kind:
          building.use === "well"
            ? "well"
            : building.use === "guard-office"
              ? "keep"
              : "house",
        role: building.use,
        x: building.x,
        z: building.z,
        code: building.code,
        variant: building.visualVariant,
        width: Math.max(
          0.55,
          (building.widthM / CANONICAL_METRES_PER_SOURCE_UNIT) *
            RENDER_HORIZONTAL_EXAGGERATION,
        ),
        depth: Math.max(
          0.55,
          (building.depthM / CANONICAL_METRES_PER_SOURCE_UNIT) *
            RENDER_HORIZONTAL_EXAGGERATION,
        ),
        height: Math.max(
          0.8,
          (building.heightM / CANONICAL_METRES_PER_SOURCE_UNIT) *
            RENDER_VERTICAL_EXAGGERATION,
        ),
        heading: building.headingRad,
      });
    }
    for (const field of plan.fields) {
      if (field.x < minX || field.x >= maxX || field.z < minZ || field.z >= maxZ)
        continue;
      result.push({
        kind: "field",
        role: "field",
        x: field.x,
        z: field.z,
        code: field.code,
        variant: field.visualVariant,
        width: Math.max(1.8, field.widthM / CANONICAL_METRES_PER_SOURCE_UNIT),
        depth: Math.max(1.2, field.depthM / CANONICAL_METRES_PER_SOURCE_UNIT),
        height: 0.15,
        heading: field.headingRad,
      });
    }
  }
  return result;
}

export function settlementPlanFingerprint(plan: SettlementPlan) {
  return [
    plan.placeCode,
    plan.archetype,
    plan.population,
    ...plan.streets.map(
      (street) =>
        `${street.code}:${street.points
          .map((p) => `${p.lon.toFixed(8)},${p.lat.toFixed(8)}`)
          .join(";")}`,
    ),
    ...plan.buildings.map(
      (building) =>
        `${building.code}:${building.use}:${building.position.lon.toFixed(8)},${building.position.lat.toFixed(8)}:${building.widthM.toFixed(2)}x${building.depthM.toFixed(2)}:${building.headingRad.toFixed(4)}`,
    ),
    ...plan.gates.map(
      (gate) =>
        `${gate.code}:${gate.position.lon.toFixed(8)},${gate.position.lat.toFixed(8)}:${gate.guardPostCodes.join(",")}`,
    ),
    ...plan.residents.map(
      (resident) =>
        `${resident.code}:${resident.homeCode}:${resident.profession}:${resident.workplaceCode ?? ""}`,
    ),
  ].join("|");
}

export const SETTLEMENT_PRESENTATION = Object.freeze({
  horizontalBuildingExaggeration: RENDER_HORIZONTAL_EXAGGERATION,
  verticalBuildingExaggeration: RENDER_VERTICAL_EXAGGERATION,
  logicalCoordinates: "canonical-ENU-metres",
  interiors: "protagonist-demand-only",
});
