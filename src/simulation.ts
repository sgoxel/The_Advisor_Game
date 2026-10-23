import { compareText } from "./compare-text.ts";
import { climateSampleAt } from "./climate.ts";
import { countries, places, type Place } from "./geography.ts";
import { characterForRole, type CharacterAge, type CharacterSex } from "./characters.ts";
import { politicalSettlementSiteById } from "./political-settlement-access.ts";
import { digest, finalSurfaceAt, heightAt } from "./world.ts";
import { settlementExteriorFor, settlementHomeFor } from "./settlement-exterior.ts";
import { activityAt, dailyPlan, moodAt, traitsFor, type ActivityKind, type Mood, type ResidentTraits, type RoutineAnchor } from "./routines.ts";
import { localDayIndex, localSecondOfDay, localWeekday } from "./clock.ts";
import { familyName, personName } from "./names.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  CANONICAL_PLANET_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  clampLatitude,
  lonLatToSource,
  normalizeLongitude,
  wrapSourceX,
  sourceToLonLat,
  type CanonicalPosition,
} from "./planet.ts";

export type ResidentRole =
  | "innkeeper"
  | "merchant"
  | "blacksmith"
  | "farmer"
  | "butcher"
  | "guard-officer"
  | "guard"
  | "artisan"
  | "laborer"
  | "trader"
  | "clergy"
  | "noble"
  | "beggar"
  | "child"
  | "elder";

export type ResidentFoundation = {
  code: string;
  name: string;
  home: string;
  settlement: string;
  homeBuilding: string;
  homeEntrance: string;
  homeOwner: string;
  workplace: string;
  role: ResidentRole;
  gatePost?: string;
  guardShift?: 0 | 1;
  index: number;
  variant: number;
  birthDay: number;
  appearance: {
    silhouette: number;
    hair: number;
    clothing: number;
  };
  /** Illustrated character type (public/characters/<character>.webp); its sex and age match the picture. */
  character: string;
  sex: CharacterSex;
  ageGroup: CharacterAge;
  /** Seeded ability scores, personality and temperament (see routines.ts). */
  traits: ResidentTraits;
  /** The resident's own house lot and real workplace, metres east/north of the settlement centre. */
  homeOffset: { eastM: number; northM: number };
  workOffset: { eastM: number; northM: number };
};

export type Resident = ResidentFoundation & {
  position: CanonicalPosition;
  x: number;
  z: number;
  task: string;
  route: string;
  /** What the daily routine is doing now, and whether that happens inside a building. */
  activity: ActivityKind;
  indoors: boolean;
  mood: Mood;
  /** Current routine step: local start/end second and progress 0-1. */
  activityStart: number;
  activityEnd: number;
  activityProgress: number;
  /** While walking between places: share of the street route covered (0-1) and its length. */
  travelProgress?: number;
  travelDistanceM?: number;
};

export type CountryState = {
  code: string;
  population: number;
  grain: number;
  lastTick: number;
  tier: "live" | "interested" | "coarse";
};

type GuardAssignment = {
  gatePost: string;
  gateIndex: number;
  slot: number;
  shift: 0 | 1;
};

type QueryStats = {
  settlements: number;
  candidateResidents: number;
  evaluatedResidents: number;
  returnedResidents: number;
};

type ResidentSpatialIndex = {
  buckets: Map<string, number[]>;
  population: number;
};

const SERVICE_ROLES: readonly ResidentRole[] = [
  "innkeeper",
  "merchant",
  "blacksmith",
  "farmer",
  "butcher",
  "guard-officer",
];
/** Weighted townsfolk mix (per 100): farmers and craft/labour dominate; clergy, nobles and beggars are few. */
const CITIZEN_ROLES: readonly ResidentRole[] = ([
  ["farmer", 24], ["artisan", 22], ["laborer", 21], ["trader", 8], ["child", 9], ["elder", 7],
  ["clergy", 3], ["beggar", 3], ["noble", 2],
] as const).flatMap(([role, weight]) => Array.from({ length: weight }, () => role));
const ROLE_WORKPLACE: Readonly<Record<ResidentRole, string>> = {
  innkeeper: "INN",
  merchant: "MARKET",
  blacksmith: "BLACKSMITH",
  farmer: "FARMSTEAD",
  butcher: "BUTCHER",
  "guard-officer": "GUARD_OFFICE",
  guard: "GUARD_POST",
  artisan: "WORKSHOP",
  laborer: "YARD",
  trader: "MARKET",
  clergy: "CHAPEL",
  noble: "KEEP",
  beggar: "MARKET",
  child: "HOME",
  elder: "HOME",
};
const DAY_SECONDS = 86_400;
const HOUR = 3_600;
const PLACE_BUCKET_SOURCE = 128;
const RESIDENT_BUCKET_SOURCE = 4;
const MAX_RESIDENT_ROAM_M = 3600; // Includes a bounded walk to outlying fishing/woodland work.
const MAX_RESIDENT_ROAM_SOURCE =
  MAX_RESIDENT_ROAM_M / CANONICAL_METRES_PER_SOURCE_UNIT;
const DEFAULT_VISIBLE_LIMIT = 128;
export const RESIDENTIAL_CAPACITY = 1;

export const populationOf = (place: Place) =>
  place.kind === "city" ? 2400 : 80;

const tangentMetrics = new Map<
  string,
  { radiansPerEastM: number; radiansPerNorthM: number }
>();
function metricsFor(place: Place) {
  let result = tangentMetrics.get(place.code);
  if (!result) {
    const cosLat = Math.max(1e-9, Math.abs(Math.cos(place.canonicalPosition.lat)));
    result = {
      radiansPerEastM: 1 / (CANONICAL_PLANET_RADIUS * cosLat),
      radiansPerNorthM: 1 / CANONICAL_PLANET_RADIUS,
    };
    tangentMetrics.set(place.code, result);
  }
  return result;
}
function canonicalOffset(
  place: Place,
  eastM: number,
  northM: number,
): CanonicalPosition {
  const metrics = metricsFor(place);
  return {
    lon: normalizeLongitude(
      place.canonicalPosition.lon + eastM * metrics.radiansPerEastM,
    ),
    lat: clampLatitude(
      place.canonicalPosition.lat + northM * metrics.radiansPerNorthM,
    ),
    elevation: place.canonicalPosition.elevation,
  };
}

/** Metres east/north of the settlement centre for a source-space point (inverse of canonicalOffset). */
function offsetForSource(place: Place, x: number, z: number) {
  const metrics = metricsFor(place), ll = sourceToLonLat(x, z);
  return {
    eastM: normalizeLongitude(ll.lon - place.canonicalPosition.lon) / metrics.radiansPerEastM,
    northM: (ll.lat - place.canonicalPosition.lat) / metrics.radiansPerNorthM,
  };
}
type Offset = { eastM: number; northM: number };
type ActivitySite = Offset & { id: string; label: string };
type SettlementAnchors = { markets: ActivitySite[]; gardens: ActivitySite[]; fieldsSites: ActivitySite[]; nature?: { fishing: ActivitySite[]; woodland: ActivitySite[] }; inn: Offset; market: Offset; plaza: Offset; keep: Offset; services: Map<string, Offset>; posts: Offset[][] };
const anchorCache = new Map<string, SettlementAnchors>();
/** Real public places of the focused settlement (inn, market, well square, keep, workshops, fields, gate posts); bounded cache. */
function settlementAnchors(place: Place): SettlementAnchors {
  const cached = anchorCache.get(place.code);
  if (cached) return cached;
  const plan = settlementExteriorFor(place), at = (point: { x: number; z: number } | undefined) => point ? offsetForSource(place, point.x, point.z) : { eastM: 0, northM: 0 },
    plotPoint = (kind: string, service?: string) => plan.plots.find((plot) => plot.kind === kind && (!service || plot.service === service))?.candidates[0],
    services = new Map<string, Offset>();
  for (const plot of plan.plots) if (plot.kind === "service" && plot.service) services.set(plot.service, at(plot.candidates[0]));
  const anchors: SettlementAnchors = {
    inn: at(plotPoint("service", "inn")), market: at(plotPoint("service", "market")),
    plaza: at(plotPoint("well")), keep: at(plotPoint("keep")), services,
    // Public trading pitches at street edges, spread through neighbourhoods.
    markets: plan.streets.flatMap(street => street.points.slice(0, -1).flatMap((point, i) => {
      if (i % Math.max(1, Math.ceil(street.points.length / 4))) return [];
      const next = street.points[i + 1], scale = sourceUnitsPerMetreAt(point.z),
        dx = wrapSourceX(next.x - point.x) / scale.x, dz = (next.z - point.z) / scale.z,
        length = Math.hypot(dx, dz);
      if (length < 6) return [];
      const side = (i % 2 ? -1 : 1) * (street.width * CANONICAL_METRES_PER_SOURCE_UNIT * .5 + .7);
      return [{ ...at({ x: wrapSourceX(point.x + (next.x - point.x) * .5 - dz / length * side * scale.x),
        z: (point.z + next.z) * .5 + dx / length * side * scale.z }),
        id: `${street.id}/TRADING/${i}`, label: "Trading along the high street" }];
    })).filter(site => outdoorSiteLegal(place, site)).slice(0, 16),
    gardens: plan.plots.filter(plot => plot.kind === "garden").map(plot => ({ ...at(plot.candidates[0]), id: plot.id, label: "Neighbourhood garden" })).filter(site => outdoorSiteLegal(place, site)),
    fieldsSites: plan.plots.filter(plot => plot.kind === "field").flatMap(plot => {
      // Separate working patches across a real cultivated plot, not one shared centre.
      const width = plot.width * CANONICAL_METRES_PER_SOURCE_UNIT,
        depth = plot.depth * CANONICAL_METRES_PER_SOURCE_UNIT;
      const columns = place.kind === "city" ? 5 : 3, rows = place.kind === "city" ? 5 : 2;
      return Array.from({ length: columns * rows }, (_, i) => {
        const x = ((i % columns + .5) / columns - .5) * width * .75, z = ((Math.floor(i / columns) + .5) / rows - .5) * depth * .75;
        return { ...at({ x: plot.candidates[0].x + (Math.cos(plot.yawRad) * x + Math.sin(plot.yawRad) * z) * sourceUnitsPerMetreAt(plot.candidates[0].z).x,
            z: plot.candidates[0].z + (-Math.sin(plot.yawRad) * x + Math.cos(plot.yawRad) * z) * sourceUnitsPerMetreAt(plot.candidates[0].z).z }),
          id: `${plot.id}/PATCH/${i}`, label: plot.fieldForm === "orchard" ? "Tending the orchard" : "Working the farm" };
      }).filter(site => outdoorSiteLegal(place, site));
    }),
    posts: plan.gates.map((gate) => (gate.guardPosts.length ? gate.guardPosts : [gate]).map((post) => at(post))),
  };
  anchorCache.set(place.code, anchors);
  while (anchorCache.size > 16) anchorCache.delete(anchorCache.keys().next().value!);
  return anchors;
}
/** Check the canonical dry traversable surface once when choosing an activity destination. */
function outdoorSiteLegal(place: Place, offset: Offset) {
  const ll = canonicalOffset(place, offset.eastM, offset.northM), source = lonLatToSource(ll.lon, ll.lat), surface = finalSurfaceAt(source.x, source.z);
  return surface.walkable && surface.water.kind === "none" && surface.groundHeight > .1;
}
/** Bounded, lazy habitat search; no fishing inland without a shore, no invented hunting site. */
function natureSites(place: Place) {
  const anchors = settlementAnchors(place);
  if (anchors.nature) return anchors.nature;
  const fishing: ActivitySite[] = [], woodland: ActivitySite[] = [], plan = settlementExteriorFor(place),
    streetPoints = plan.streets.flatMap(street => street.points.map(point => offsetForSource(place, point.x, point.z)));
  const reachable = (point: Offset) => {
    const start = streetPoints.reduce<Offset | undefined>((best, p) => !best || Math.hypot(p.eastM-point.eastM,p.northM-point.northM) < Math.hypot(best.eastM-point.eastM,best.northM-point.northM) ? p : best, undefined);
    if (!start) return false;
    const steps = Math.ceil(Math.hypot(start.eastM-point.eastM,start.northM-point.northM) / 20);
    for (let i = 1; i <= steps; i++) if (!outdoorSiteLegal(place, { eastM: start.eastM + (point.eastM-start.eastM)*i/steps, northM: start.northM + (point.northM-start.northM)*i/steps })) return false;
    return true;
  };
  for (let i = 0; i < 48; i++) {
    const angle = i * 2.399963229728653 + (digest(`${place.code}/HABITAT`) % 360) * Math.PI / 180,
      radius = [Math.max(65, plan.radiusM + 24), 900, 2400, 3500][i % 4],
      point = { eastM: Math.cos(angle) * radius, northM: Math.sin(angle) * radius },
      ll = canonicalOffset(place, point.eastM, point.northM), source = lonLatToSource(ll.lon, ll.lat), surface = finalSurfaceAt(source.x, source.z);
    if (!surface.walkable || surface.water.kind !== "none" || surface.groundHeight <= .1 || (surface.reservedUse && surface.reservedUse !== place.code)) continue;
    if (surface.vegetationDensityScale > .5 && climateSampleAt(ll, surface.groundHeight).forestFamily && woodland.length < 8 && reachable(point))
      woodland.push({ ...point, id: `${place.code}/WOODLAND/${i}`, label: "Working in the woodland" });
    if (fishing.length < 8 && [0, 1, 2, 3, 4, 5, 6, 7].some(n => {
      const near = canonicalOffset(place, point.eastM + Math.cos(n * Math.PI / 4) * 12, point.northM + Math.sin(n * Math.PI / 4) * 12), p = lonLatToSource(near.lon, near.lat);
      return finalSurfaceAt(p.x, p.z).water.kind !== "none";
    }) && reachable(point)) fishing.push({ ...point, id: `${place.code}/SHORE/${i}`, label: "Fishing from the bank" });
  }
  return anchors.nature = { fishing, woodland };
}
function neighbourhoodSite(place: Place, foundation: Pick<ResidentFoundation, "code" | "homeOffset">, kind: "garden" | "market"): ActivitySite {
  const anchors = settlementAnchors(place), nearby = [...(kind === "garden" ? anchors.gardens : anchors.markets)].sort((a,b) => Math.hypot(a.eastM-foundation.homeOffset.eastM,a.northM-foundation.homeOffset.northM)-Math.hypot(b.eastM-foundation.homeOffset.eastM,b.northM-foundation.homeOffset.northM)).slice(0,3);
  return nearby[digest(`${foundation.code}/${kind}`) % nearby.length] ?? { ...(kind === "garden" ? anchors.plaza : anchors.market), id: `${place.code}/${kind.toUpperCase()}`, label: kind === "garden" ? "Town square" : "Market" };
}
function gardenSite(place: Place, foundation: Pick<ResidentFoundation, "code" | "homeOffset">): ActivitySite {
  return neighbourhoodSite(place, foundation, "garden");
}
export function gateCountFor(place: Place) {
  return 1 + (digest(`${place.code}/GATE_COUNT`) % 2);
}
export function guardsPerGateFor(place: Place, gateIndex: number) {
  return 1 + (digest(`${place.code}/GATE/${gateIndex}/STAFF`) % 2);
}
function guardAssignmentFor(
  place: Place,
  residentIndex: number,
): GuardAssignment | undefined {
  let cursor = SERVICE_ROLES.length;
  const gateCount = gateCountFor(place);
  for (let gateIndex = 0; gateIndex < gateCount; gateIndex++) {
    const slots = guardsPerGateFor(place, gateIndex);
    for (let slot = 0; slot < slots; slot++)
      for (const shift of [0, 1] as const) {
        if (residentIndex === cursor)
          return {
            gatePost: `${place.code}/GATE/${gateIndex}/POST/${slot}`,
            gateIndex,
            slot,
            shift,
          };
        cursor++;
      }
  }
  return undefined;
}
function residentRoleFor(place: Place, index: number): ResidentRole {
  if (index < SERVICE_ROLES.length) return SERVICE_ROLES[index];
  if (guardAssignmentFor(place, index)) return "guard";
  return CITIZEN_ROLES[
    digest(`${place.code}/RESIDENT/${index}/ROLE`) % CITIZEN_ROLES.length
  ];
}
/** The real building or plot where a resident works. */
function workOffsetFor(place: Place, index: number, role: ResidentRole, assignment: GuardAssignment | undefined, home: Offset, character: string): Offset {
  const anchors = settlementAnchors(place), pick = <T>(list: readonly T[], salt: string) => list[digest(`${place.code}/RESIDENT/${index}/${salt}`) % list.length];
  if (assignment && anchors.posts.length) {
    const posts = anchors.posts[assignment.gateIndex % anchors.posts.length];
    return posts[assignment.slot % posts.length];
  }
  const service = (name: string) => anchors.services.get(name) ?? anchors.market;
  switch (role) {
    case "innkeeper": return anchors.inn;
    case "merchant": return anchors.market;
    case "trader": case "beggar": return neighbourhoodSite(place, {code: `${place.code}/RESIDENT/${index}`, homeOffset: home}, "market");
    case "blacksmith": return service("blacksmith");
    case "butcher": return service("butcher");
    case "guard-officer": return service("guard-office");
    case "farmer": return index < SERVICE_ROLES.length || !anchors.fieldsSites.length ? service("farmstead") : pick(anchors.fieldsSites, "FIELD");
    case "laborer": {
      const habitat = natureSites(place), sites = character.startsWith("fisherman") ? habitat.fishing : /^(hunter|woodcutter|herbalist)/.test(character) ? habitat.woodland : [];
      return sites.length ? pick(sites, "TRADE") : anchors.fieldsSites.length ? pick(anchors.fieldsSites, "FIELD") : home;
    }
    case "clergy": return anchors.plaza;
    case "noble": return anchors.keep;
    default: return home; // artisans keep their workshop at home; children and elders have no workplace
  }
}

export function residentFoundationAt(
  place: Place,
  index: number,
): ResidentFoundation {
  if (!Number.isInteger(index) || index < 0 || index >= populationOf(place))
    throw new RangeError(`Resident index ${index} is outside ${place.code}`);
  const code = `${place.code}/RESIDENT/${index}`,
    variant = digest(code),
    role = residentRoleFor(place, index),
    assignment = guardAssignmentFor(place, index),
    homeBuilding = `${place.code}/RESIDENCE/${index}`,
    waterContext = politicalSettlementSiteById.get(place.id)?.waterContext,
    character = characterForRole(role, digest(`${code}/CHARACTER`), waterContext === "coast" || waterContext === "freshwater-lake"),
    // Home is the resident's own frontage lot (lazy lot lookup, focused settlement only).
    homeLot = settlementHomeFor(place, index).candidates[0],
    homeOffset = offsetForSource(place, homeLot.x, homeLot.z),
    workOffset = workOffsetFor(place, index, role, assignment, homeOffset, character.key);
  return {
    code,
    name: personName(code, character.sex, place.continent),
    home: homeBuilding,
    settlement: place.id,
    homeBuilding,
    homeEntrance: `${homeBuilding}/ENTRANCE`,
    homeOwner: code,
    workplace:
      assignment?.gatePost ?? (workOffset as ActivitySite).id ?? (workOffset === homeOffset ? `${homeBuilding}/${role === "artisan" ? "WORKSHOP" : "HOME"}` : `${place.code}/SERVICE/${ROLE_WORKPLACE[role]}`),
    role,
    gatePost: assignment?.gatePost,
    guardShift: assignment?.shift,
    index,
    variant,
    // Age in days, inside the range the picture shows (child 6-12 y, adult 16-59 y, elder 60-80 y).
    birthDay: (character.age === "child" ? 6 * 365 : character.age === "elder" ? 60 * 365 : 16 * 365) +
      digest(`${code}/BIRTH_DAY`) % ((character.age === "child" ? 7 : character.age === "elder" ? 21 : 44) * 365),
    appearance: {
      silhouette: digest(`${code}/SILHOUETTE`) % 5,
      hair: digest(`${code}/HAIR`) % 8,
      clothing: digest(`${code}/CLOTHING`) % 9,
    },
    character: character.key,
    sex: character.sex,
    ageGroup: character.age,
    traits: traitsFor(code, role, character.age),
    homeOffset,
    workOffset,
  };
}

/** Second of the fantasy day as shown by the HUD clock (tick 0 is not midnight). */
/** Local second of the day at a settlement (realm Fantasy Time shifted by its time zone). */
function daySecond(tick: number, place: Place) {
  return localSecondOfDay(tick, place.canonicalPosition.lon);
}
function isGuardOnDuty(foundation: ResidentFoundation, tick: number, place: Place) {
  if (foundation.role !== "guard") return false;
  const second = daySecond(tick, place), daytime = second >= 6 * HOUR && second < 18 * HOUR;
  return foundation.guardShift === (daytime ? 0 : 1);
}
export function guardCoverageAt(place: Place, tick: number) {
  const coverage = Array.from({ length: gateCountFor(place) }, (_, gateIndex) => ({
    gateIndex,
    required: guardsPerGateFor(place, gateIndex),
    onDuty: 0,
    residentCodes: [] as string[],
  }));
  let index = SERVICE_ROLES.length;
  for (let gateIndex = 0; gateIndex < coverage.length; gateIndex++)
    for (let slot = 0; slot < coverage[gateIndex].required; slot++)
      for (let shift = 0; shift < 2; shift++, index++) {
        const foundation = residentFoundationAt(place, index);
        if (isGuardOnDuty(foundation, tick, place)) {
          coverage[gateIndex].onDuty++;
          coverage[gateIndex].residentCodes.push(foundation.code);
        }
      }
  return coverage;
}

/** Deterministic local commute corridor between a resident's assigned endpoints. */
function routeOffset(
  from: { eastM: number; northM: number },
  to: { eastM: number; northM: number },
  progress: number,
) {
  const t = Math.max(0, Math.min(1, progress));
  return {
    eastM: from.eastM + (to.eastM - from.eastM) * t,
    northM: from.northM + (to.northM - from.northM) * t,
  };
}
function anchorOffset(place: Place, foundation: ResidentFoundation, anchor: RoutineAnchor): Offset {
  if (anchor === "home") return foundation.homeOffset;
  if (anchor === "work") return foundation.workOffset;
  const anchors = settlementAnchors(place);
  if (anchor === "garden") return gardenSite(place, foundation);
  if (anchor === "market") return neighbourhoodSite(place, foundation, "market");
  return anchor === "inn" ? anchors.inn : anchor === "keep" ? anchors.keep : anchors.plaza;
}
function anchorRoute(place: Place, foundation: ResidentFoundation, anchor: RoutineAnchor) {
  if (anchor === "garden" || anchor === "market") return (anchorOffset(place, foundation, anchor) as ActivitySite).id;
  return anchor === "home" ? foundation.homeEntrance : anchor === "work" ? ((foundation.workOffset as ActivitySite).id ?? foundation.workplace) : `${foundation.settlement}/${anchor.toUpperCase()}`;
}
/** Small seeded standing spot around an outdoor anchor, so a crowd at the market does not stack. */
function standingSpot(foundation: ResidentFoundation, anchor: RoutineAnchor, base: Offset, outdoors: boolean): Offset {
  if (!outdoors || anchor === "home") return base;
  const angle = (digest(`${foundation.code}/SPOT/${anchor}`) % 360) * Math.PI / 180, radius = (anchor === "garden" || (base as ActivitySite).id) ? .3 + (digest(`${foundation.code}/SPOT-R/${anchor}`) % 7) / 10 : 2 + (digest(`${foundation.code}/SPOT-R/${anchor}`) % 70) / 10;
  return { eastM: base.eastM + Math.cos(angle) * radius, northM: base.northM + Math.sin(angle) * radius };
}
// ---------------------------------------------------------------- street paths

type StreetGraph = { nodes: Offset[]; edges: number[][]; weights: number[][]; grid: Map<string, number[]>; legalEdges: Map<string, boolean>; cell: number };
const streetGraphs = new Map<string, StreetGraph>();
/**
 * Walkable street network of a settlement in local metres: every street
 * polyline point is a node, consecutive points are linked, and points of
 * different streets closer than 9 m are joined (junctions). Built once per
 * focused settlement; bounded cache.
 */
function streetGraphFor(place: Place): StreetGraph {
  const cached = streetGraphs.get(place.code);
  if (cached) return cached;
  const plan = settlementExteriorFor(place), nodes: Offset[] = [], edges: number[][] = [], weights: number[][] = [], streetOf: number[] = [], cell = 12,
    grid = new Map<string, number[]>(), keyOf = (o: Offset) => `${Math.floor(o.eastM / cell)}/${Math.floor(o.northM / cell)}`,
    link = (a: number, b: number) => {
      const w = Math.hypot(nodes[a].eastM - nodes[b].eastM, nodes[a].northM - nodes[b].northM);
      edges[a].push(b); weights[a].push(w); edges[b].push(a); weights[b].push(w);
    };
  plan.streets.forEach((street, streetIndex) => {
    let previous = -1;
    for (const point of street.points) {
      const id = nodes.length, offset = offsetForSource(place, point.x, point.z);
      nodes.push(offset); edges.push([]); weights.push([]);
      const key = keyOf(offset), bucket = grid.get(key) ?? [];
      // Junctions: join to nearby points of other streets.
      const [cx, cz] = key.split("/").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const other of grid.get(`${cx + dx}/${cz + dz}`) ?? [])
        if (streetOf[other] !== streetIndex && Math.hypot(nodes[other].eastM - offset.eastM, nodes[other].northM - offset.northM) < 9) link(id, other);
      bucket.push(id); grid.set(key, bucket); streetOf.push(streetIndex);
      if (previous >= 0) link(previous, id);
      previous = id;
    }
  });
  const graph = { nodes, edges, weights, grid, legalEdges: new Map<string, boolean>(), cell };
  streetGraphs.set(place.code, graph);
  while (streetGraphs.size > 8) streetGraphs.delete(streetGraphs.keys().next().value!);
  return graph;
}
function nearestNode(graph: StreetGraph, offset: Offset) {
  let best = -1, bestDistance = Infinity;
  const cx = Math.floor(offset.eastM / graph.cell), cz = Math.floor(offset.northM / graph.cell);
  for (let ring = 0; ring < 40 && best < 0; ring++)
    for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      for (const id of graph.grid.get(`${cx + dx}/${cz + dz}`) ?? []) {
        const d = Math.hypot(graph.nodes[id].eastM - offset.eastM, graph.nodes[id].northM - offset.northM);
        if (d < bestDistance) { best = id; bestDistance = d; }
      }
    }
  return best;
}
/** Sample the authoritative final surface every 2 physical metres, including endpoints.
 * Presentation streets alone are not walking authority. */
export function continuousWalkableOffsetSegment(
  from: Offset, to: Offset, walkable: (point: Offset) => boolean,
): boolean {
  const length = Math.hypot(to.eastM - from.eastM, to.northM - from.northM);
  const steps = Math.max(1, Math.ceil(length / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!walkable({ eastM: from.eastM + (to.eastM - from.eastM) * t,
      northM: from.northM + (to.northM - from.northM) * t })) return false;
  }
  return true;
}
function legalStreetSegment(place: Place, from: Offset, to: Offset): boolean {
  return continuousWalkableOffsetSegment(from, to, point => {
    const p = canonicalOffset(place, point.eastM, point.northM),
      source = lonLatToSource(p.lon, p.lat),
      surface = finalSurfaceAt(source.x, source.z);
    return surface.walkable && heightAt(source.x, source.z) > 0.1;
  });
}
const pathCache = new Map<string, Offset[] | null>();
/** A missing graph route or illegal connecting segment must never become straight-line travel. */
function streetPath(place: Place, from: Offset, to: Offset): Offset[] | null {
  const key = `${place.code}|${from.eastM.toFixed(1)},${from.northM.toFixed(1)}|${to.eastM.toFixed(1)},${to.northM.toFixed(1)}`,
    cached = pathCache.get(key);
  if (cached !== undefined) return cached;
  const graph = streetGraphFor(place), start = nearestNode(graph, from), goal = nearestNode(graph, to);
  let path: Offset[] | null = null;
  if (start >= 0 && goal >= 0 &&
      legalStreetSegment(place, from, graph.nodes[start]) &&
      legalStreetSegment(place, graph.nodes[goal], to)) {
    if (start === goal) {
      path = [from, graph.nodes[start], to];
    } else {
      const cost = new Map<number, number>([[start, 0]]), cameFrom = new Map<number, number>(),
        open = [start],
        h = (id: number) => Math.hypot(graph.nodes[id].eastM - graph.nodes[goal].eastM, graph.nodes[id].northM - graph.nodes[goal].northM);
      while (open.length) {
        let bestIndex = 0;
        for (let i = 1; i < open.length; i++)
          if (cost.get(open[i])! + h(open[i]) < cost.get(open[bestIndex])! + h(open[bestIndex])) bestIndex = i;
        const current = open.splice(bestIndex, 1)[0];
        if (current === goal) break;
        graph.edges[current].forEach((next, i) => {
          const edgeKey = `${Math.min(current,next)}/${Math.max(current,next)}`;
          let legal = graph.legalEdges.get(edgeKey);
          if (legal === undefined) {
            legal = legalStreetSegment(place, graph.nodes[current], graph.nodes[next]);
            graph.legalEdges.set(edgeKey, legal);
          }
          if (!legal) return;
          const tentative = cost.get(current)! + graph.weights[current][i];
          if (tentative < (cost.get(next) ?? Infinity)) {
            cost.set(next, tentative); cameFrom.set(next, current);
            if (!open.includes(next)) open.push(next);
          }
        });
      }
      if (cost.has(goal)) {
        const route: Offset[] = [];
        for (let node: number | undefined = goal; node !== undefined; node = cameFrom.get(node))
          route.unshift(graph.nodes[node]);
        path = [from, ...route, to];
      }
    }
  }
  // Some outdoor work sites are reached over open walkable ground rather than a
  // settlement street. Allow that physical corridor only after checking EVERY
  // segment sample; a disconnected graph is never permission to cross obstacles.
  if (!path && legalStreetSegment(place, from, to)) path = [from, to];
  pathCache.set(key, path);
  while (pathCache.size > 4000) pathCache.delete(pathCache.keys().next().value!);
  return path;
}
/** Replay earlier routine destinations from the last place actually reached. A failed
 * leg cannot become the origin of a later move just because Fantasy Time advances. */
export function lastReachableRoutineStop<T>(
  stops: readonly T[], canTravel: (from: T, to: T) => boolean,
): T {
  let reached = stops[0];
  for (let i = 1; i < stops.length; i++)
    if (canTravel(reached, stops[i])) reached = stops[i];
  return reached;
}
function pathLength(path: readonly Offset[]) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].eastM - path[i - 1].eastM, path[i].northM - path[i - 1].northM);
  return total;
}
function pointAlong(path: readonly Offset[], distanceM: number): Offset {
  let remaining = Math.max(0, distanceM);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], length = Math.hypot(b.eastM - a.eastM, b.northM - a.northM);
    if (remaining <= length) {
      const t = length ? remaining / length : 0;
      return { eastM: a.eastM + (b.eastM - a.eastM) * t, northM: a.northM + (b.northM - a.northM) * t };
    }
    remaining -= length;
  }
  return path[path.length - 1];
}

/**
 * The resident's state at an absolute tick: today's seeded plan (role, age,
 * weekday, traits, mood) gives the activity and how far through it they are;
 * moving between two places follows the settlement's streets at the canonical
 * good-road walking pace, so position and progress change smoothly over time.
 */
function workTask(foundation: ResidentFoundation) {
  const site = foundation.workOffset as ActivitySite;
  if (site.id?.includes("/WOODLAND/")) return foundation.character.startsWith("hunter") ? "Hunting in the woodland" : foundation.character.startsWith("herbalist") ? "Gathering woodland herbs" : "Cutting timber in the woodland";
  return site.label ?? "Working";
}
function scheduleAt(place: Place, foundation: ResidentFoundation, tick: number) {
  const lon = place.canonicalPosition.lon, day = localDayIndex(tick, lon), weekday = localWeekday(tick, lon), second = daySecond(tick, place),
    subject = { code: foundation.code, role: foundation.role, ageGroup: foundation.ageGroup, guardShift: foundation.guardShift },
    plan = dailyPlan(subject, foundation.traits, day, weekday),
    { activity, previous, index } = activityAt(plan, second),
    end = plan[index + 1]?.start ?? 24 * HOUR,
    activityProgress = Math.max(0, Math.min(1, (second - activity.start) / Math.max(1, end - activity.start))),
    target = standingSpot(foundation, activity.anchor, anchorOffset(place, foundation, activity.anchor), !activity.indoors),
    mood = moodAt(foundation.code, foundation.traits, day, weekday, second),
    timing = { activityStart: activity.start, activityEnd: end, activityProgress };
  // The walk to this place began with the first step of the run of steps at this anchor; it
  // continues until it arrives, even if a later step at the same place has already started.
  let arrival = index;
  while (arrival > 0 && plan[arrival - 1].anchor === activity.anchor) arrival--;
  const departure = plan[arrival - 1];
  if (departure && previous) {
    const earlier = plan.slice(0, arrival);
    const stops = earlier
      .filter((step, i) => i === earlier.length - 1 || step.anchor !== earlier[i + 1].anchor)
      .map(step => ({
        anchor: step.anchor,
        indoors: step.indoors,
        offset: standingSpot(foundation, step.anchor, anchorOffset(place, foundation, step.anchor), !step.indoors),
      }));
    const reached = lastReachableRoutineStop(stops, (a, b) => streetPath(place, a.offset, b.offset) !== null),
      from = reached.offset, path = streetPath(place, from, target);
    if (!path)
      return {
        task: `Blocked: no legal walking route to ${activity.anchor}`,
        route: `BLOCKED: ${anchorRoute(place, foundation, reached.anchor)} → ${anchorRoute(place, foundation, activity.anchor)}`,
        offset: from, activity: "rest" as ActivityKind, indoors: reached.indoors, mood,
        ...timing, travelProgress: undefined as number | undefined, travelDistanceM: undefined as number | undefined,
      };
    const lengthM = pathLength(path),
      travel = Math.max(60, lengthM / GOOD_ROAD_WALK_SPEED_MPS), elapsed = second - plan[arrival].start;
    if (elapsed < travel)
      return {
        task: plan[arrival].kind === "commute" ? plan[arrival].task : `Walking to ${activity.anchor === "work" ? "work" : activity.anchor === "home" ? "home" : `the ${activity.anchor}`}`,
        route: `${anchorRoute(place, foundation, departure.anchor)} → ${anchorRoute(place, foundation, activity.anchor)}`,
        offset: pointAlong(path, (elapsed / travel) * lengthM), activity: "commute" as ActivityKind, indoors: false, mood,
        ...timing, travelProgress: elapsed / travel, travelDistanceM: lengthM,
      };
  }
  // A walk that arrived before the next step begins becomes waiting at the destination.
  const arrived = activity.kind === "commute";
  return { task: arrived ? `Waiting at ${activity.anchor === "work" ? "work" : activity.anchor === "home" ? "home" : `the ${activity.anchor}`}` : activity.anchor === "work" && activity.kind === "work" && (foundation.workOffset as ActivitySite).label ? workTask(foundation) : activity.task, route: anchorRoute(place, foundation, activity.anchor), offset: target, activity: (arrived ? "rest" : activity.kind) as ActivityKind, indoors: activity.indoors, mood, ...timing, travelProgress: undefined as number | undefined, travelDistanceM: undefined as number | undefined };
}
function legalPosition(
  place: Place,
  eastM: number,
  northM: number,
): { position: CanonicalPosition; x: number; z: number } {
  let scale = 1;
  for (let attempt = 0; attempt < 7; attempt++) {
    const candidate = canonicalOffset(place, eastM * scale, northM * scale),
      presentation = lonLatToSource(candidate.lon, candidate.lat),
      surface = finalSurfaceAt(presentation.x, presentation.z);
    if (surface.walkable && heightAt(presentation.x, presentation.z) > 0.1) {
      const elevation = heightAt(presentation.x, presentation.z);
      return {
        position: { lon: candidate.lon, lat: candidate.lat, elevation },
        x: presentation.x,
        z: presentation.z,
      };
    }
    scale *= 0.68;
  }
  const elevation = heightAt(place.x, place.z);
  return {
    position: {
      lon: place.canonicalPosition.lon,
      lat: place.canonicalPosition.lat,
      elevation,
    },
    x: place.x,
    z: place.z,
  };
}

/** Readable site caption for the inspector only. Full SEED identities remain accessible. */
export function readableResidentSite(code: string): string {
  const parts = code.split("/");
  const residence = parts.lastIndexOf("RESIDENCE");
  if (residence >= 0) {
    const number = parts[residence + 1] ?? "";
    return `Residence ${number}${parts.includes("ENTRANCE") ? " entrance" : ""}`;
  }
  const site = parts.slice(-2);
  return site.join(" ").replaceAll("_", " ").toLowerCase();
}

/** State is reconstructed only from immutable SEED foundation + absolute Fantasy Game Time. */
export function residentAt(place: Place, index: number, tick: number): Resident {
  const foundation = residentFoundationAt(place, index),
    schedule = scheduleAt(place, foundation, tick),
    location = legalPosition(
      place,
      schedule.offset.eastM,
      schedule.offset.northM,
    );
  return {
    ...foundation,
    ...location,
    task: schedule.task,
    route: schedule.route,
    activity: schedule.activity,
    indoors: schedule.indoors,
    mood: schedule.mood,
    activityStart: schedule.activityStart,
    activityEnd: schedule.activityEnd,
    activityProgress: schedule.activityProgress,
    ...(schedule.travelProgress === undefined ? {} : { travelProgress: schedule.travelProgress, travelDistanceM: schedule.travelDistanceM }),
  };
}
export function summaryAt(code: string, tick: number): CountryState {
  const baseline = digest(code) % 5000;
  return {
    code,
    population: countryLogicalPopulation(code),
    grain: baseline + Math.floor(tick / 60) * 12,
    lastTick: tick,
    tier: "coarse",
  };
}

const countryPlaces = new Map<string, Place[]>();
for (const country of countries)
  countryPlaces.set(
    country.code,
    places.filter(
      (place) =>
        place.continent === country.continent && place.country === country.id,
    ),
  );
function bucketX(x: number) {
  const wrapped = wrapSourceX(x),
    shifted = wrapped + SOURCE_PRESENTATION_WIDTH / 2,
    count = Math.ceil(SOURCE_PRESENTATION_WIDTH / PLACE_BUCKET_SOURCE);
  return ((Math.floor(shifted / PLACE_BUCKET_SOURCE) % count) + count) % count;
}
function bucketZ(z: number) {
  return Math.floor(z / PLACE_BUCKET_SOURCE);
}
const placeBuckets = new Map<string, Place[]>();
for (const place of places) {
  const key = `${bucketX(place.x)}/${bucketZ(place.z)}`,
    bucket = placeBuckets.get(key);
  if (bucket) bucket.push(place);
  else placeBuckets.set(key, [place]);
}
function nearbyPlaces(x: number, z: number, radius: number) {
  const countX = Math.ceil(SOURCE_PRESENTATION_WIDTH / PLACE_BUCKET_SOURCE),
    reach = radius + MAX_RESIDENT_ROAM_SOURCE / Math.max(.05, Math.cos(sourceToLonLat(x,z).lat)),
    cellReach = Math.ceil(reach / PLACE_BUCKET_SOURCE),
    centerX = bucketX(x),
    centerZ = bucketZ(z),
    found = new Map<string, Place>();
  for (let dz = -cellReach; dz <= cellReach; dz++)
    for (let dx = -cellReach; dx <= cellReach; dx++) {
      const bx = ((centerX + dx) % countX + countX) % countX,
        bucket = placeBuckets.get(`${bx}/${centerZ + dz}`);
      if (bucket) for (const place of bucket) found.set(place.code, place);
    }
  return [...found.values()].sort((a, b) => compareText(a.code, b.code));
}
function sourceDistance(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(wrapSourceX(ax - bx), az - bz);
}
function countryLogicalPopulation(code: string) {
  return (countryPlaces.get(code) ?? []).reduce(
    (total, place) => total + populationOf(place),
    0,
  );
}
function relativeSourceForOffset(
  place: Place,
  offset: { eastM: number; northM: number },
) {
  const canonical = canonicalOffset(place, offset.eastM, offset.northM),
    source = lonLatToSource(canonical.lon, canonical.lat);
  return {
    x: wrapSourceX(source.x - place.x),
    z: source.z - place.z,
  };
}
function residentIndexFor(place: Place): ResidentSpatialIndex {
  const buckets = new Map<string, number[]>(),
    population = populationOf(place),
    anchors = settlementAnchors(place);
  for (let index = 0; index < population; index++) {
    // A resident can be anywhere on the corridors between its own places and the public ones it visits.
    const foundation = residentFoundationAt(place, index),
      points = [foundation.homeOffset, foundation.workOffset, anchors.inn, anchors.market, anchors.plaza, anchors.keep, gardenSite(place, foundation), neighbourhoodSite(place, foundation, "market")].map((offset) => relativeSourceForOffset(place, offset)),
      // Street routes can bend away from the straight line between places: pad the box.
      pad = (place.kind === "city" ? 90 : 45) / CANONICAL_METRES_PER_SOURCE_UNIT,
      minX = Math.min(...points.map((point) => point.x)) - pad,
      maxX = Math.max(...points.map((point) => point.x)) + pad,
      minZ = Math.min(...points.map((point) => point.z)) - pad,
      maxZ = Math.max(...points.map((point) => point.z)) + pad,
      bx0 = Math.floor(minX / RESIDENT_BUCKET_SOURCE),
      bx1 = Math.floor(maxX / RESIDENT_BUCKET_SOURCE),
      bz0 = Math.floor(minZ / RESIDENT_BUCKET_SOURCE),
      bz1 = Math.floor(maxZ / RESIDENT_BUCKET_SOURCE);
    for (let bz = bz0; bz <= bz1; bz++)
      for (let bx = bx0; bx <= bx1; bx++) {
        const key = `${bx}/${bz}`,
          bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
  }
  return { buckets, population };
}

export class LazySimulation {
  tick = 0;
  activeCountry = "";
  interested = new Set<string>();
  summaries = new Map<string, CountryState>();
  private lastQuery: QueryStats = {
    settlements: 0,
    candidateResidents: 0,
    evaluatedResidents: 0,
    returnedResidents: 0,
  };
  private residentEvaluationsSinceAdvance = 0;
  private reconstructionCount = 0;
  private residentIndexBuilds = 0;
  private residentIndexes = new Map<string, ResidentSpatialIndex>();
  private selectedResidentCode = "";
  private inspector?: HTMLElement;

  constructor() {
    if (typeof document !== "undefined") this.installInspector();
  }

  private installInspector() {
    if (document.getElementById("resident-inspector")) {
      this.inspector = document.getElementById("resident-inspector") ?? undefined;
      return;
    }
    const panel = document.getElementById("travel-panel");
    if (!panel) return;
    const section = document.createElement("section");
    section.id = "resident-inspector";
    section.className = "route-block resident-inspector";
    section.setAttribute("aria-label", "Nearby resident inspector");
    section.innerHTML = `
      <div class="eyebrow">NEARBY RESIDENTS</div>
      <label for="resident-select">Inhabitant</label>
      <select id="resident-select" aria-label="Nearby inhabitant"></select>
      <div class="resident-identity">
        <div id="resident-avatar" aria-hidden="true"><i></i></div>
        <div><h3 id="resident-name">Zoom closer to inspect inhabitants</h3><span id="resident-short-id" class="resident-short-id"></span></div>
      </div>
      <dl id="resident-details">
        <dt>Role</dt><dd id="resident-role">—</dd>
        <dt>Current task</dt><dd id="resident-task">—</dd>
        <dt>Mood</dt><dd id="resident-mood">—</dd>
        <dt>Traits</dt><dd id="resident-traits">—</dd>
        <dt>House</dt><dd id="resident-home">—</dd>
        <dt>Workplace / post</dt><dd id="resident-workplace">—</dd>
        <dt>Current route</dt><dd id="resident-route">—</dd>
        <dt>Guard assignment</dt><dd id="resident-guard">—</dd>
        <dt>Character</dt><dd id="resident-appearance">—</dd>
      </dl>
      <button id="resident-home-inspect" type="button" disabled>Inspect assigned house</button>
      <p class="hint" id="resident-house-details" aria-live="polite"></p>
      <details class="resident-technical">
        <summary>Exact resident, site and route identifiers</summary>
        <dl>
          <dt>Resident</dt><dd><code id="resident-code"></code></dd>
          <dt>Home and entrance</dt><dd><code id="resident-home-code"></code></dd>
          <dt>Workplace</dt><dd><code id="resident-work-code"></code></dd>
          <dt>Route</dt><dd><code id="resident-route-code"></code></dd>
          <dt>Guard</dt><dd><code id="resident-guard-code"></code></dd>
          <dt>House ownership</dt><dd><code id="resident-house-code"></code></dd>
        </dl>
        <p class="hint" id="resident-performance" aria-live="polite"></p>
      </details>`;
    const livingWorld = document.getElementById("simulation-status")?.previousElementSibling;
    if (livingWorld) panel.insertBefore(section, livingWorld);
    else panel.append(section);
    this.inspector = section;
    const select = document.getElementById("resident-select") as HTMLSelectElement | null;
    select?.addEventListener("change", () => {
      this.selectedResidentCode = select.value;
      const resident = this.residentByCode(select.value);
      if (resident) this.renderInspectorResident(resident);
    });
    document.getElementById("resident-home-inspect")?.addEventListener("click", () => {
      const resident = this.residentByCode(this.selectedResidentCode),
        output = document.getElementById("resident-house-details");
      if (!resident || !output) return;
      document.getElementById("travel-panel")?.classList.add("house-focused");
      const place = places.find((entry) => entry.id === resident.settlement),
        home = place
          ? legalPosition(place, resident.homeOffset.eastM, resident.homeOffset.northM)
          : undefined;

      const houseCode = document.getElementById("resident-house-code");
      if (houseCode) houseCode.textContent = `Home: ${resident.homeBuilding} · entrance: ${resident.homeEntrance} · owner: ${resident.homeOwner} · settlement: ${resident.settlement}`;
      if (home) {
        const world = (
          window as typeof window & {
            advisorWorld?: {
              navigation?: { setFocus?: (lon: number, lat: number) => void };
            };
          }
        ).advisorWorld;
        if (world?.navigation?.setFocus) {
          world.navigation.setFocus(home.position.lon, home.position.lat);
          output.textContent = `Assigned home · capacity ${RESIDENTIAL_CAPACITY}. Map focused on canonical entrance. Full identity below.`;
        } else output.textContent = `Assigned home · capacity ${RESIDENTIAL_CAPACITY}. Map focus unavailable. Full identity below.`;
      } else output.textContent = "Assigned home entrance unavailable. Full identity below.";
    });
  }

  private renderInspectorResident(resident: Resident) {
    const text = (id: string, value: string) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };
    text("resident-name", resident.name);
    text("resident-short-id", `Resident ${resident.index + 1} · ${resident.role.replaceAll("-", " ")}`);
    text("resident-code", resident.code);
    text("resident-home-code", `${resident.homeBuilding} · ${resident.homeEntrance}`);
    text("resident-work-code", resident.workplace);
    text("resident-route-code", resident.route);
    text("resident-guard-code", resident.gatePost ?? "No guard assignment");
    text("resident-role", resident.role.replaceAll("-", " "));
    text("resident-task", resident.task);
    text("resident-mood", `${resident.mood.label} (${resident.mood.value >= 0 ? "+" : ""}${resident.mood.value.toFixed(2)})`);
    const a = resident.traits.abilities;
    text("resident-traits", `${resident.traits.temperament} · STR ${a.strength} DEX ${a.dexterity} CON ${a.constitution} KNO ${a.knowledge} WIS ${a.wisdom} CHA ${a.charisma}`);
    text("resident-home", `${familyName(resident.code, places.find((place) => place.id === resident.settlement)?.continent ?? 0)} home · assigned entrance`);
    text("resident-workplace", readableResidentSite(resident.workplace));
    text("resident-route", resident.route.startsWith("BLOCKED:")
      ? "Blocked — no continuous legal walking route"
      : resident.route.includes(" → ")
        ? resident.route.split(" → ").map(readableResidentSite).join(" → ")
        : readableResidentSite(resident.route));
    text("resident-guard", resident.gatePost
      ? `${readableResidentSite(resident.gatePost)} · ${resident.guardShift === 0 ? "day" : "night"} watch`
      : "Not assigned to the watch");
    text(
      "resident-appearance",
      `${resident.character.replaceAll("_", " ")} · ${resident.sex} · ${resident.ageGroup}, ${Math.floor(resident.birthDay / 365)} years`,
    );
    const avatar = document.getElementById("resident-avatar");
    if (avatar) {
      avatar.dataset.silhouette = String(resident.appearance.silhouette);
      avatar.dataset.hair = String(resident.appearance.hair);
      avatar.dataset.clothing = String(resident.appearance.clothing);
      avatar.dataset.character = resident.character;
      avatar.style.backgroundImage = `url("${new URL(`characters/${resident.character}.webp`, document.baseURI).href}")`;
    }
    const button = document.getElementById("resident-home-inspect") as HTMLButtonElement | null;
    if (button) button.disabled = false;
  }

  private indexFor(place: Place) {
    let index = this.residentIndexes.get(place.code);
    if (!index) {
      index = residentIndexFor(place);
      this.residentIndexes.set(place.code, index);
      this.residentIndexBuilds++;
    }
    return index;
  }

  private residentCandidates(place: Place, x: number, z: number, radius: number) {
    const index = this.indexFor(place),
      relativeX = wrapSourceX(x - place.x),
      relativeZ = z - place.z,
      bx0 = Math.floor((relativeX - radius) / RESIDENT_BUCKET_SOURCE),
      bx1 = Math.floor((relativeX + radius) / RESIDENT_BUCKET_SOURCE),
      bz0 = Math.floor((relativeZ - radius) / RESIDENT_BUCKET_SOURCE),
      bz1 = Math.floor((relativeZ + radius) / RESIDENT_BUCKET_SOURCE),
      found = new Set<number>();
    for (let bz = bz0; bz <= bz1; bz++)
      for (let bx = bx0; bx <= bx1; bx++)
        for (const resident of index.buckets.get(`${bx}/${bz}`) ?? [])
          found.add(resident);
    const start = digest(`${place.code}/VISIBLE_START`) % index.population;
    return [...found].sort(
      (a, b) =>
        ((a - start + index.population) % index.population) -
        ((b - start + index.population) % index.population),
    );
  }

  private updateInspector(visible: Resident[], query: QueryStats) {
    if (typeof document === "undefined") return;
    if (!this.inspector) this.installInspector();
    const select = document.getElementById("resident-select") as HTMLSelectElement | null;
    if (!select) return;
    const sample = [...visible].sort((a, b) => a.index - b.index).slice(0, 16),
      retained = sample.some((resident) => resident.code === this.selectedResidentCode)
        ? this.selectedResidentCode
        : sample[0]?.code ?? "";
    select.replaceChildren(
      ...sample.map((resident) => {
        const option = document.createElement("option");
        option.value = resident.code;
        option.textContent = `${resident.name} · ${resident.role.replaceAll("-", " ")}`;
        return option;
      }),
    );
    this.selectedResidentCode = retained;
    select.value = retained;
    const resident = sample.find((entry) => entry.code === retained);
    if (resident) this.renderInspectorResident(resident);
    else {
      const name = document.getElementById("resident-name");
      if (name) name.textContent = "Zoom closer to inspect inhabitants";
      const button = document.getElementById("resident-home-inspect") as HTMLButtonElement | null;
      if (button) button.disabled = true;
    }
    const performance = document.getElementById("resident-performance");
    if (performance)
      performance.textContent = `${query.candidateResidents.toLocaleString()} spatial candidates · ${query.evaluatedResidents.toLocaleString()} evaluated · ${query.returnedResidents.toLocaleString()} visible from ${countryLogicalPopulation(this.activeCountry).toLocaleString()} logical residents · ${this.residentIndexes.size} active spatial indexes`;
  }

  setFocus(place: Place | undefined) {
    if (!place) return;
    const next = countries.find(
      (country) =>
        country.continent === place.continent && country.id === place.country,
    )!.code;
    if (this.activeCountry && this.activeCountry !== next) {
      this.reconstructionCount++;
      this.residentIndexes.clear();
    }
    this.activeCountry = next;
  }
  setInterest(code: string) {
    this.interested.clear();
    this.interested.add(code);
  }
  advance(tick: number) {
    if (tick < this.tick) throw new RangeError("Simulation time must move forward");
    this.tick = tick;
    this.residentEvaluationsSinceAdvance = 0;
    for (const country of countries) {
      const live = country.code === this.activeCountry,
        interested = this.interested.has(country.code),
        interval = live ? 1 : interested ? 30 : 300,
        previous = this.summaries.get(country.code),
        tier = live ? "live" : interested ? "interested" : "coarse";
      if (!previous || live || previous.tier !== tier || tick - previous.lastTick >= interval) {
        const state = summaryAt(country.code, tick);
        state.tier = tier;
        this.summaries.set(country.code, state);
      }
    }
  }

  focusedResidents(
    x: number,
    z: number,
    radius: number,
    limit = DEFAULT_VISIBLE_LIMIT,
  ) {
    if (!(radius >= 0) || !(limit >= 0)) return [] as Resident[];
    const settlements = nearbyPlaces(x, z, radius).filter((place) => {
      const country = countries.find(
        (entry) =>
          entry.continent === place.continent && entry.id === place.country,
      );
      return country?.code === this.activeCountry;
    });
    const candidateSets = settlements.map((place) => ({
      place,
      residents: this.residentCandidates(place, x, z, radius),
    }));
    const query: QueryStats = {
      settlements: settlements.length,
      candidateResidents: candidateSets.reduce(
        (total, candidate) => total + candidate.residents.length,
        0,
      ),
      evaluatedResidents: 0,
      returnedResidents: 0,
    };
    const visible: Resident[] = [];
    for (const candidate of candidateSets) {
      for (const index of candidate.residents) {
        const resident = residentAt(candidate.place, index, this.tick);
        query.evaluatedResidents++;
        this.residentEvaluationsSinceAdvance++;
        if (sourceDistance(resident.x, resident.z, x, z) > radius) continue;
        visible.push(resident);
        if (visible.length >= limit) break;
      }
      if (visible.length >= limit) break;
    }
    query.returnedResidents = visible.length;
    this.lastQuery = query;
    this.updateInspector(visible, query);
    return visible;
  }

  residentByCode(code: string, tick = this.tick) {
    const match = /^(.*)\/RESIDENT\/(\d+)$/.exec(code);
    if (!match) return undefined;
    const place = places.find((entry) => entry.code === match[1]);
    if (!place) return undefined;
    const index = Number(match[2]);
    if (!Number.isInteger(index) || index < 0 || index >= populationOf(place))
      return undefined;
    return residentAt(place, index, tick);
  }

  /** Diagnostic compatibility façade. It materializes one analytical sample only on read. */
  get residents() {
    const result = new Map<string, Resident[]>();
    if (!this.activeCountry) return result;
    const place = countryPlaces.get(this.activeCountry)?.[0];
    if (place) result.set(this.activeCountry, [residentAt(place, 0, this.tick)]);
    return result;
  }

  get stats() {
    const residents = this.activeCountry
      ? countryLogicalPopulation(this.activeCountry)
      : 0;
    return {
      tick: this.tick,
      countries: this.summaries.size,
      liveCountries: this.activeCountry ? 1 : 0,
      residents,
      logicalResidents: residents,
      activeScheduleRecords: 0,
      residentEvaluationsSinceAdvance: this.residentEvaluationsSinceAdvance,
      reconstructionCount: this.reconstructionCount,
      residentIndexBuilds: this.residentIndexBuilds,
      activeResidentIndexes: this.residentIndexes.size,
      query: { ...this.lastQuery },
      coarseCountries: [...this.summaries.values()].filter(
        (state) => state.tier === "coarse",
      ).length,
    };
  }
}