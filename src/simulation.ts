import { compareText } from "./compare-text.ts";
import { residentActorSearchContinues } from "./resident-query.ts";
import { climateSampleAt } from "./climate.ts";
import { countries, places, type Place } from "./geography.ts";
import { characterForRole, type CharacterAge, type CharacterSex } from "./characters.ts";
import { politicalSettlementSiteById } from "./political-settlement-access.ts";
import { digest, finalSurfaceAt, resolvedSettlementHomeDoorFor } from "./world.ts";
import type { FinalSurface } from "./final-surface.ts";
import { settlementExteriorFor, settlementHomeAnchorFor } from "./settlement-exterior.ts";
import { activityAt, dailyPlan, moodAt, traitsFor, type ActivityKind, type Mood, type ResidentTraits, type RoutineAnchor } from "./routines.ts";
import { localDayIndex, localSecondOfDay, localWeekday, TIME_SCALE } from "./clock.ts";
import { familyName, personName } from "./names.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { transportNetwork, transportRoadsNear } from "./transport-network.ts";
import { transportRoadArcStations } from "./transport-bridge-surface.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import type { ResidentSiteVisitJournal } from "./resident-transport-events.ts";
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
  /** False when no legal house door or scheduled surface exists; never render or claim travel. */
  grounded: boolean;
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
  /** While walking: source x/z points along the legal street path for the next TIME_SCALE fantasy seconds (the next real second), so the drawn actor follows corners instead of a chord. */
  walkAhead?: { x: number; z: number }[];
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

export type QueryStats = {
  settlements: number;
  candidateResidents: number;
  evaluatedResidents: number;
  returnedResidents: number;
};

type ResidentBucketBounds = { bx0: number; bx1: number; bz0: number; bz1: number };
type ResidentSpatialIndex = {
  // Equivalent to inserting every resident in all cells of its SEED-derived
  // bounding rectangle, without allocating those potentially thousands of
  // string-keyed cells for each cold city query.
  // Sparse at original SEED indices when a worker owns only one shard.
  // An absent bound is not a resident and can never become a candidate.
  bounds: (ResidentBucketBounds | undefined)[];
  population: number;
};
/** Exact bucket-rectangle intersection; preserves all original candidates. */
export function residentBucketBoundsOverlap(a: ResidentBucketBounds, b: ResidentBucketBounds): boolean {
  return a.bx0 <= b.bx1 && a.bx1 >= b.bx0 &&
    a.bz0 <= b.bz1 && a.bz1 >= b.bz0;
}

const SERVICE_ROLES: readonly ResidentRole[] = [
  "innkeeper",
  "merchant",
  "blacksmith",
  "farmer",
  "butcher",
  "guard-officer",
];
/** Weighted townsfolk mix (per 100): farmers and craft/labour dominate; clergy, nobles and beggars are few. */
// Keep the seeded role slots stable: former child slots now select adult labourers.
const CITIZEN_ROLES: readonly ResidentRole[] = ([
  ["farmer", 24], ["artisan", 22], ["laborer", 21], ["trader", 8], ["laborer", 9], ["elder", 7],
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
/** A shared outdoor standing ground (square, trading pitch, garden, field, gate post...): residents stand on seeded slots inside it. */
type StandArea = { key: string; eastM: number; northM: number; radiusM: number; kerbM: number; clearM: number; field?: boolean };
type SlotState = { valid: Offset[]; next: number; exhausted: boolean; rivals?: StandArea[] };
type StreetSegment = { ax: number; az: number; bx: number; bz: number; halfM: number };
type StandTable = { slotOf: Map<string, number>; total: Map<string, number> };
type SettlementAnchors = {
  markets: ActivitySite[]; gardens: ActivitySite[]; fieldsSites: ActivitySite[]; nature?: { fishing: ActivitySite[]; woodland: ActivitySite[]; maintenance: ActivitySite[] }; inn: Offset; market: Offset; plaza: Offset; keep: Offset; services: Map<string, Offset>; posts: Offset[][];
  /** Standing grounds by anchor coordinates, all of them (each once), the slots generated so far, street segments in metres and the resident-to-slot table. */
  areas: Map<string, StandArea>; areaList: StandArea[]; slots: Map<string, SlotState>; streetCells?: Map<string, StreetSegment[]>; stand?: StandTable;
};
const coordKey = (offset: Offset) => `${offset.eastM.toFixed(2)}/${offset.northM.toFixed(2)}`;
/** Width of the pavement beside a street (mirrors world.ts): nobody stands on the road or its pavement. */
const STREET_CLEAR_M = 1.8;
/** Golden-angle (Vogel) spiral constant: neighbouring slots are at least 0.9 m apart. */
const SLOT_SPIRAL = 0.6;
const SLOT_GAP_M = 0.9;
/** Registers a standing ground at an anchor (the first one registered at a spot wins). */
function standArea(anchors: SettlementAnchors, centre: Offset, radiusM: number, kerbM = STREET_CLEAR_M, clearM = 0, key = coordKey(centre)) {
  const taken = anchors.areas.get(coordKey(centre));
  if (taken) return taken;
  const made: StandArea = { key, eastM: centre.eastM, northM: centre.northM, radiusM, kerbM, clearM };
  anchors.areas.set(coordKey(centre), made); anchors.areaList.push(made);
  return made;
}
const anchorCache = new Map<string, SettlementAnchors>();
/** Real public places of the focused settlement (inn, market, well square, keep, workshops, fields, gate posts); bounded cache. */
function settlementAnchors(place: Place): SettlementAnchors {
  const cached = anchorCache.get(place.code);
  if (cached) return cached;
  const plan = settlementExteriorFor(place), at = (point: { x: number; z: number } | undefined) => point ? offsetForSource(place, point.x, point.z) : { eastM: 0, northM: 0 },
    plotPoint = (kind: string, service?: string) => plan.plots.find((plot) => plot.kind === kind && (!service || plot.service === service))?.candidates[0],
    services = new Map<string, Offset>();
  for (const plot of plan.plots) if (plot.kind === "service" && plot.service) services.set(plot.service, at(plot.candidates[0]));
  // Public trading pitches at street edges, spread through neighbourhoods and thinned evenly over all streets.
  const allPitches = plan.streets.flatMap(street => street.points.slice(0, -1).flatMap((point, i) => {
    if (i % Math.max(1, Math.ceil(street.points.length / 4))) return [];
    const next = street.points[i + 1], scale = sourceUnitsPerMetreAt(point.z),
      dx = wrapSourceX(next.x - point.x) / scale.x, dz = (next.z - point.z) / scale.z,
      length = Math.hypot(dx, dz);
    if (length < 6) return [];
    const side = (i % 2 ? -1 : 1) * (street.width * CANONICAL_METRES_PER_SOURCE_UNIT * .5 + .7);
    return [{ ...at({ x: wrapSourceX(point.x + (next.x - point.x) * .5 - dz / length * side * scale.x),
      z: (point.z + next.z) * .5 + dx / length * side * scale.z }),
      id: `${street.id}/TRADING/${i}`, label: "Trading along the high street" }];
  })).filter(site => outdoorSiteLegal(place, site)),
    pitchCap = place.kind === "city" ? 64 : 16,
    pitches = allPitches.length <= pitchCap ? allPitches : Array.from({ length: pitchCap }, (_, i) => allPitches[Math.floor(i * allPitches.length / pitchCap)]);
  const anchors: SettlementAnchors = {
    inn: at(plotPoint("service", "inn")), market: at(plotPoint("service", "market")),
    plaza: at(plotPoint("well")), keep: at(plotPoint("keep")), services,
    markets: pitches,
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
    areas: new Map(), areaList: [], slots: new Map(),
  };
  // Standing grounds sized by the real footprint: the well square 12 m, service plots and the keep by their half size,
  // gardens by their plot, one shared ground per field, trading pitches and gate posts small.
  const area = (centre: Offset, radiusM: number, kerbM = STREET_CLEAR_M, clearM = 0, key = coordKey(centre)) => standArea(anchors, centre, radiusM, kerbM, clearM, key),
    half = (plot: { widthM?: number; depthM?: number }) => Math.min(plot.widthM ?? 8, plot.depthM ?? 8) / 2;
  area(anchors.plaza, 12, STREET_CLEAR_M, 1.9);
  for (const plot of plan.plots) {
    if (plot.kind === "service" || plot.kind === "keep") area(at(plot.candidates[0]), Math.max(2.5, Math.min(12, half(plot) - .5)));
    else if (plot.kind === "garden") area(at(plot.candidates[0]), Math.max(1.8, Math.min(3.2, half(plot) + .6)));
    else if (plot.kind === "field") {
      const field = area(at(plot.candidates[0]), Math.max(3, Math.min(12, half(plot) * .85)), STREET_CLEAR_M, 0, plot.id);
      field.field = true;
      for (const patch of anchors.fieldsSites) if (patch.id.startsWith(`${plot.id}/PATCH/`) && !anchors.areas.has(coordKey(patch))) anchors.areas.set(coordKey(patch), field);
    }
  }
  for (const post of anchors.posts.flat()) area(post, 2.5);
  for (const site of anchors.markets) area(site, 4.5, .4);
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
  const fishing: ActivitySite[] = [], woodland: ActivitySite[] = [], plan = settlementExteriorFor(place);
  // A streetless plan must stay unreachable, even when the gate corridor is dry.
  // Convert/scan street vertices only if no verified gate corridor reaches the
  // habitat; most dry routes need neither costly scan.
  const hasStreetPoints = plan.streets.some(street => street.points.length > 0);
  let streetPoints: Offset[] | undefined;
  // An exterior bank is not a reachable workplace merely because it is dry
  // from a gate. First prove that the actual internal SEED streets can reach
  // that gate from the town square. Resolve at most two approaches, once per
  // lazy settlement, then reuse them for all bounded habitat candidates.
  const connectedGates = plan.gates
    .map(gate => offsetForSource(place, gate.x, gate.z))
    .filter(gate => streetPath(place, anchors.plaza, gate, false) !== null);
  const reachable = (point: Offset) => {
    if (!hasStreetPoints) return false;
    // Most real field/shore work is directly accessible outside a SEED gate.
    // Validate those corridors against continuous metre-spaced final-surface
    // ground/decks first, without running a whole-graph A* for every candidate.
    for (const gate of connectedGates)
      if (legalStreetSegment(place, gate, point)) return true;
    const points = streetPoints ??= plan.streets.flatMap(street =>
      street.points.map(p => offsetForSource(place, p.x, p.z)));
    const start = points.reduce<Offset | undefined>((best, p) => !best || Math.hypot(p.eastM-point.eastM,p.northM-point.northM) < Math.hypot(best.eastM-point.eastM,best.northM-point.northM) ? p : best, undefined);
    if (!start) return false;
    // Cheap coarse negative only: a wet direct chord is not proof that the
    // same SEED site is unreachable via a real road bridge. Do not run the
    // expensive bridge-road query at every ordinarily dry candidate.
    const distance = Math.hypot(start.eastM - point.eastM, start.northM - point.northM),
      probes = Math.max(1, Math.ceil(distance / 20));
    let directGroundHint = true;
    for (let i = 1; i <= probes; i++) {
      if (!outdoorSiteLegal(place, {
        eastM: start.eastM + (point.eastM - start.eastM) * i / probes,
        northM: start.northM + (point.northM - start.northM) * i / probes,
      })) { directGroundHint = false; break; }
    }
    if (!directGroundHint) {
      // A candidate across water may be reached only from the inhabited
      // town's actual connected gate along an existing, metrically proven
      // SEED bridge. No second graph or imaginary bank crossing is accepted.
      for (const gate of connectedGates)
        if (residentTransportBridgePath(place, gate, point)) return true;
      return false;
    }
    // A route from a nearby orphaned street to the bank is not proof that
    // anyone can get there from the inhabited settlement's connected streets.
    return streetPath(place, start, point) !== null &&
      streetPath(place, anchors.plaza, start, false) !== null;
  };
  for (let i = 0; i < 48; i++) {
    const angle = i * 2.399963229728653 + (digest(`${place.code}/HABITAT`) % 360) * Math.PI / 180,
      radius = [Math.max(65, plan.radiusM + 24), 900, 2400, 3500][i % 4],
      point = { eastM: Math.cos(angle) * radius, northM: Math.sin(angle) * radius },
      ll = canonicalOffset(place, point.eastM, point.northM), source = lonLatToSource(ll.lon, ll.lat), surface = finalSurfaceAt(source.x, source.z);
    if (!surface.walkable || surface.water.kind !== "none" || surface.groundHeight <= .1 || (surface.reservedUse && surface.reservedUse !== place.code)) continue;
    // One point may qualify for woodland and shore work: reuse its identical
    // gate/bridge/final-surface verdict without repeating any route search.
    let verified: boolean | undefined;
    const reachableOnce = () => verified ??= reachable(point);
    if (surface.vegetationDensityScale > .5 && climateSampleAt(ll, surface.groundHeight).forestFamily && woodland.length < 8 && reachableOnce())
      woodland.push({ ...point, id: `${place.code}/WOODLAND/${i}`, label: "Working in the woodland" });
    if (fishing.length < 8 && [0, 1, 2, 3, 4, 5, 6, 7].some(n => {
      const near = canonicalOffset(place, point.eastM + Math.cos(n * Math.PI / 4) * 12, point.northM + Math.sin(n * Math.PI / 4) * 12), p = lonLatToSource(near.lon, near.lat);
      return finalSurfaceAt(p.x, p.z).water.kind !== "none";
    }) && reachableOnce()) fishing.push({ ...point, id: `${place.code}/SHORE/${i}`, label: "Fishing from the bank" });
  }
  // Ordinary labour includes upkeep of physically existing bridges. A far
  // bank is work only when a real SEED gate connects to an actual wet deck
  // and the same canonical road leads all the way to a dry bank station.
  // One local bridge and one small outdoor worksite per village: this never
  // constructs a bridge or derives a path from a screen-space icon.
  const maintenance: ActivitySite[] = [];
  if (place.kind === "village" && connectedGates.length) {
    const scale = sourceUnitsPerMetreAt(place.z),
      roads = transportRoadsNear(place.x, place.z,
        Math.min(16_384, 3800 * Math.max(scale.x, scale.z)), 12),
      bridgeRoads = new Map(roads.map(road => [road.code, road])),
      candidates = transportNetwork.bridges
        .filter(bridge => bridgeRoads.has(bridge.roadCode) &&
          Math.hypot(offsetForSource(place, bridge.x, bridge.z).eastM,
            offsetForSource(place, bridge.x, bridge.z).northM) < 3500)
        .sort((a, b) => compareText(a.code, b.code));
    for (const bridge of candidates.slice(0, 3)) {
      const center = finalSurfaceAt(bridge.x, bridge.z);
      if (center.water.kind === "none" || !residentWalkableSurface(center)) continue;
      const owner = bridgeRoads.get(bridge.roadCode)!,
        banks = transportRoadArcStations(owner.centerline, bridge.x, bridge.z,
          -(bridge.spanM / 2 + 24), bridge.spanM / 2 + 24, 1),
        bridgeOffset = offsetForSource(place, bridge.x, bridge.z);
      for (const [bankIndex, bank] of banks.entries()) {
        const site = offsetForSource(place, bank.x, bank.z);
        if (!outdoorSiteLegal(place, site)) continue;
        for (const gate of connectedGates) {
          const route = residentTransportBridgePath(place, gate, site);
          if (!route) continue;
          // Confirm the executed polyline actually reaches the original
          // water-spanning bridge, not an unrelated same-bank road branch.
          const crossesDeck = route.slice(1).some((to, i) => {
            const from = route[i], dx = to.eastM - from.eastM,
              dz = to.northM - from.northM, length2 = dx * dx + dz * dz,
              t = length2 ? Math.max(0, Math.min(1,
                ((bridgeOffset.eastM - from.eastM) * dx +
                  (bridgeOffset.northM - from.northM) * dz) / length2)) : 0;
            return Math.hypot(from.eastM + dx * t - bridgeOffset.eastM,
              from.northM + dz * t - bridgeOffset.northM) <= 2;
          });
          if (!crossesDeck) continue;
          maintenance.push({ ...site, id: `${bridge.code}/MAINTENANCE/BANK/${bankIndex}`,
            label: "Maintaining the bridge approach" });
          break;
        }
        if (maintenance.length) break;
      }
      if (maintenance.length) break;
    }
  }
  // Shared real outdoor slots remain SEED-indexed; no fabricated workers.
  for (const site of [...fishing, ...woodland, ...maintenance]) standArea(anchors, site, 2.5);
  return anchors.nature = { fishing, woodland, maintenance };
}
/** Select the identical nearest three as stable distance-sort, without sorting
 * and allocating a full settlement-wide garden/market list for every resident. */
export function threeNearestOffsets<T extends Offset>(candidates: readonly T[], home: Offset): T[] {
  const closest: { site: T; distance: number }[] = [];
  for (const site of candidates) {
    const distance = Math.hypot(site.eastM - home.eastM, site.northM - home.northM);
    let slot = 0;
    // Equal distances retain original SEED site order, matching stable Array.sort.
    while (slot < closest.length && closest[slot].distance <= distance) slot++;
    if (slot >= 3) continue;
    closest.splice(slot, 0, { site, distance });
    if (closest.length > 3) closest.pop();
  }
  return closest.map(entry => entry.site);
}
/** These immutable SEED destinations are requested repeatedly by cold spatial
 * indexing, standing-slot rosters and prior-day routine replay. Cache the exact
 * home offset as well as resident identity: an alternate legally resolved door
 * must never inherit a different starting home's selected site. Bounded across
 * settlements; no actor state, routing verdict or sampled surface is cached. */
const neighbourhoodSiteCache = new Map<string, ActivitySite>();
export function neighbourhoodSite(place: Place, foundation: Pick<ResidentFoundation, "code" | "homeOffset">, kind: "garden" | "market"): ActivitySite {
  const key = `${foundation.code}|${kind}|${foundation.homeOffset.eastM},${foundation.homeOffset.northM}`,
    cached = neighbourhoodSiteCache.get(key);
  if (cached) return cached;
  const anchors = settlementAnchors(place),
    nearby = threeNearestOffsets(kind === "garden" ? anchors.gardens : anchors.markets, foundation.homeOffset),
    selected = nearby[digest(`${foundation.code}/${kind}`) % nearby.length] ?? { ...(kind === "garden" ? anchors.plaza : anchors.market), id: `${place.code}/${kind.toUpperCase()}`, label: kind === "garden" ? "Town square" : "Market" };
  neighbourhoodSiteCache.set(key, selected);
  if (neighbourhoodSiteCache.size > 4096)
    neighbourhoodSiteCache.delete(neighbourhoodSiteCache.keys().next().value!);
  return selected;
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
/** The designated bridge-maintenance labourer is immutable SEED identity.
 * Resolve its first eligible slot once per settlement rather than rescanning
 * up to 74 seeded roles for every other labourer's workplace during cold
 * spatial-index construction. Cache only the seed-derived index, never actor state. */
const firstMaintenanceLaborerByPlace = new Map<string, number | undefined>();
function firstMaintenanceLaborerFor(place: Place): number | undefined {
  if (firstMaintenanceLaborerByPlace.has(place.code)) return firstMaintenanceLaborerByPlace.get(place.code);
  const limit = Math.min(80, populationOf(place));
  let first: number | undefined;
  for (let i = SERVICE_ROLES.length; i < limit; i++) {
    if (residentRoleFor(place, i) === "laborer") { first = i; break; }
  }
  firstMaintenanceLaborerByPlace.set(place.code, first);
  while (firstMaintenanceLaborerByPlace.size > 8)
    firstMaintenanceLaborerByPlace.delete(firstMaintenanceLaborerByPlace.keys().next().value!);
  return first;
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
      const fishing = character.startsWith("fisherman"),
        woodland = /^(hunter|woodcutter|herbalist)/.test(character),
        // Only this original first SEED labourer could be reassigned to real
        // bridge upkeep; all other ordinary labourers always used fields/home.
        maintenanceCandidate = place.kind === "village" && index === firstMaintenanceLaborerFor(place);
      // Habitat lookup is expensive: it builds verified final-surface routes.
      // Do not do it for a generic field worker who cannot use any habitat,
      // but never skip it for the canonical bridge candidate or nature trades.
      if (!fishing && !woodland && !maintenanceCandidate)
        return anchors.fieldsSites.length ? pick(anchors.fieldsSites, "FIELD") : home;
      const habitat = natureSites(place),
        sites = fishing ? habitat.fishing : woodland ? habitat.woodland : [];
      const firstLaborer = habitat.maintenance.length ? firstMaintenanceLaborerFor(place) : undefined;
      if (index === firstLaborer) return habitat.maintenance[0];
      return sites.length ? pick(sites, "TRADE") : anchors.fieldsSites.length ? pick(anchors.fieldsSites, "FIELD") : home;
    }
    // A city's clergy minister at the well square and, for two in three, at a shrine in a neighbourhood garden, not all on one spot.
    case "clergy": {
      if (place.kind !== "city" || !anchors.gardens.length || !(digest(`${place.code}/RESIDENT/${index}/SHRINE`) % 3)) return anchors.plaza;
      const shrine: ActivitySite = { ...neighbourhoodSite(place, { code: `${place.code}/RESIDENT/${index}`, homeOffset: home }, "garden"), label: "Tending the shrine" };
      return shrine;
    }
    case "noble": return anchors.keep;
    default: return home; // artisans keep their workshop at home; elders have no workplace
  }
}

/** Exact immutable fields required for spatial indexing, before the character
 * is actually inspected. Building all 2,400 full biographies per cold city
 * query needlessly computes names, birthdays, appearance and traits. */
function uncachedResidentSpatialFactsAt(
  place: Place, index: number,
  exteriorPlan?: ReturnType<typeof settlementExteriorFor>,
) {
  const code = `${place.code}/RESIDENT/${index}`,
    role = residentRoleFor(place, index),
    assignment = guardAssignmentFor(place, index),
    waterContext = politicalSettlementSiteById.get(place.id)?.waterContext,
    character = characterForRole(role, digest(`${code}/CHARACTER`),
      waterContext === "coast" || waterContext === "freshwater-lake"),
    homeLot = settlementHomeAnchorFor(place, index, exteriorPlan),
    homeOffset = offsetForSource(place, homeLot.x, homeLot.z),
    workOffset = workOffsetFor(place, index, role, assignment, homeOffset, character.key);
  return { code, role, index, assignment, character, homeOffset, workOffset };
}
/** Shared immutable per-resident home/work facts used by both the cold
 * spatial index and the standing-slot roster. The first traversal computes
 * each exact SEED-derived offset once; subsequent views never cache actor
 * positions, route legality, or simulation-time decisions. */
const residentSpatialFactsCache = new Map<string, ReturnType<typeof uncachedResidentSpatialFactsAt>>();
function residentSpatialFactsAt(
  place: Place, index: number,
  exteriorPlan?: ReturnType<typeof settlementExteriorFor>,
) {
  const code = `${place.code}/RESIDENT/${index}`,
    cached = residentSpatialFactsCache.get(code);
  if (cached) return cached;
  const facts = uncachedResidentSpatialFactsAt(place, index, exteriorPlan);
  residentSpatialFactsCache.set(code, facts);
  if (residentSpatialFactsCache.size > 3200)
    residentSpatialFactsCache.delete(residentSpatialFactsCache.keys().next().value!);
  return facts;
}

/** Standing-slot rankings need canonical role, traits and anchor offsets, not
 * thousands of full city biographies, birthdays or appearance sprites.
 * Preserve exactly the inputs used by residentFoundationAt + dailyPlan. */
export function residentStandSeedFor(
  place: Place, index: number,
  exteriorPlan?: ReturnType<typeof settlementExteriorFor>,
): Pick<ResidentFoundation, "code" | "role" | "ageGroup" | "guardShift" | "traits" | "homeOffset" | "workOffset"> {
  if (!Number.isInteger(index) || index < 0 || index >= populationOf(place))
    throw new RangeError(`Resident index ${index} is outside ${place.code}`);
  const code = `${place.code}/RESIDENT/${index}`,
    full = residentFoundationCache.get(code);
  if (full) return { code: full.code, role: full.role, ageGroup: full.ageGroup,
    guardShift: full.guardShift, traits: full.traits,
    homeOffset: full.homeOffset, workOffset: full.workOffset };
  const seeded = residentSpatialFactsAt(place, index, exteriorPlan);
  return { code: seeded.code, role: seeded.role, ageGroup: seeded.character.age,
    guardShift: seeded.assignment?.shift,
    traits: traitsFor(seeded.code, seeded.role, seeded.character.age),
    homeOffset: seeded.homeOffset, workOffset: seeded.workOffset };
}

/** Expensive immutable SEED identities are shared by the spatial index, standing-slot
 * roster and route evaluation. Cache data, never a mutable Simulation position.
 * The bounded cache only changes reconstruction cost, not identity or output. */
const residentFoundationCache = new Map<string, ResidentFoundation>();
const RESIDENT_FOUNDATION_CACHE_LIMIT = 3200;
export function residentFoundationAt(
  place: Place,
  index: number,
  exteriorPlan?: ReturnType<typeof settlementExteriorFor>,
): ResidentFoundation {
  if (!Number.isInteger(index) || index < 0 || index >= populationOf(place))
    throw new RangeError(`Resident index ${index} is outside ${place.code}`);
  const code = `${place.code}/RESIDENT/${index}`;
  const cached = residentFoundationCache.get(code);
  if (cached) return cached;
  const { role, assignment, character, homeOffset, workOffset } =
      residentSpatialFactsAt(place, index, exteriorPlan),
    variant = digest(code),
    homeBuilding = `${place.code}/RESIDENCE/${index}`;
  const foundation: ResidentFoundation = {
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
    // Age in days, inside the range the picture shows (adult 16-59 y, elder 60-80 y).
    birthDay: (character.age === "elder" ? 60 * 365 : 16 * 365) +
      digest(`${code}/BIRTH_DAY`) % ((character.age === "elder" ? 21 : 44) * 365),
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
  residentFoundationCache.set(code, foundation);
  while (residentFoundationCache.size > RESIDENT_FOUNDATION_CACHE_LIMIT)
    residentFoundationCache.delete(residentFoundationCache.keys().next().value!);
  return foundation;
}

/** Second of the fantasy day as shown by the HUD clock (tick 0 is not midnight). */
/** Local second of the day at a settlement (realm Fantasy Time shifted by its time zone). */
function daySecond(tick: number, place: Place) {
  return localSecondOfDay(tick, place.canonicalPosition.lon);
}
function isGuardOnDuty(foundation: Pick<ResidentFoundation, "role" | "guardShift">, tick: number, place: Place) {
  if (foundation.role !== "guard") return false;
  const second = daySecond(tick, place), daytime = second >= 6 * HOUR && second < 18 * HOUR;
  return foundation.guardShift === (daytime ? 0 : 1);
}
/** Give the inspector an individual guard verdict from the same physically
 * verified roster that drives group staffing. Off-shift is not a vacancy. */
export function residentGuardPresence(
  resident: Pick<ResidentFoundation, "code" | "role" | "guardShift">,
  tick: number, place: Place, physicallyPresent: readonly string[],
): "off-duty" | "at-post" | "absent" {
  if (!isGuardOnDuty(resident, tick, place)) return "off-duty";
  return physicallyPresent.includes(resident.code) ? "at-post" : "absent";
}
/** Scheduled assignment and physical gate coverage are different facts.
 * A guard with an unresolved house or illegal commute cannot fill a post. */
export function guardCoverageAt(place: Place, tick: number) {
  const coverage = Array.from({ length: gateCountFor(place) }, (_, gateIndex) => ({
    gateIndex, required: guardsPerGateFor(place, gateIndex),
    scheduled: 0, onDuty: 0, missing: 0,
    residentCodes: [] as string[], unresolvedCodes: [] as string[],
  }));
  let index = SERVICE_ROLES.length;
  for (let gateIndex = 0; gateIndex < coverage.length; gateIndex++)
    for (let slot = 0; slot < coverage[gateIndex].required; slot++)
      for (let shift = 0; shift < 2; shift++, index++) {
        const foundation = residentFoundationAt(place, index);
        if (!isGuardOnDuty(foundation, tick, place)) continue;
        const gate = coverage[gateIndex], resident = residentAt(place, index, tick),
          destination = canonicalOffset(place, foundation.workOffset.eastM, foundation.workOffset.northM),
          east = normalizeLongitude(resident.position.lon - destination.lon) *
            CANONICAL_PLANET_RADIUS * Math.cos(destination.lat),
          north = (resident.position.lat - destination.lat) * CANONICAL_PLANET_RADIUS;
        gate.scheduled++;
        if (resident.grounded && resident.activity === "guard" &&
            !resident.route.startsWith("BLOCKED:") && Math.hypot(east, north) <= 2) {
          gate.onDuty++;
          gate.residentCodes.push(foundation.code);
        } else gate.unresolvedCodes.push(foundation.code);
      }
  for (const gate of coverage) gate.missing = gate.required - gate.onDuty;
  return coverage;
}

function anchorOffset(place: Place, foundation: Pick<ResidentFoundation, "code" | "homeOffset" | "workOffset">, anchor: RoutineAnchor): Offset {
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
/** Street centre lines in local metres with their half widths, bucketed in 24 m cells (cached per settlement). */
function streetCellsFor(place: Place, anchors: SettlementAnchors) {
  if (anchors.streetCells) return anchors.streetCells;
  const cells = new Map<string, StreetSegment[]>(), size = 24;
  for (const street of settlementExteriorFor(place).streets) {
    const halfM = street.width * CANONICAL_METRES_PER_SOURCE_UNIT * .5, points = street.points.map((point) => offsetForSource(place, point.x, point.z));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], segment: StreetSegment = { ax: a.eastM, az: a.northM, bx: b.eastM, bz: b.northM, halfM }, reach = halfM + STREET_CLEAR_M + 1;
      for (let cx = Math.floor((Math.min(a.eastM, b.eastM) - reach) / size); cx <= Math.floor((Math.max(a.eastM, b.eastM) + reach) / size); cx++)
        for (let cz = Math.floor((Math.min(a.northM, b.northM) - reach) / size); cz <= Math.floor((Math.max(a.northM, b.northM) + reach) / size); cz++) {
          const key = `${cx}/${cz}`, bucket = cells.get(key);
          if (bucket) bucket.push(segment); else cells.set(key, [segment]);
        }
    }
  }
  return anchors.streetCells = cells;
}
/** True when a point is on a street's road or closer than `kerbM` beyond its edge. */
function onStreetBand(place: Place, anchors: SettlementAnchors, point: Offset, kerbM: number) {
  for (const s of streetCellsFor(place, anchors).get(`${Math.floor(point.eastM / 24)}/${Math.floor(point.northM / 24)}`) ?? []) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, t = Math.max(0, Math.min(1, ((point.eastM - s.ax) * dx + (point.northM - s.az) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(point.eastM - s.ax - dx * t, point.northM - s.az - dz * t) < s.halfM + kerbM) return true;
  }
  return false;
}
/**
 * The n-th free standing slot of an area: a golden-angle spiral around its centre (seeded start angle), skipping
 * the street band, the middle clearance and the discs of smaller neighbouring areas, so slots never share a spot.
 * Slots beyond four times its radius wrap, which only happens for a crowd far larger than the ground.
 */
function slotOffset(place: Place, anchors: SettlementAnchors, area: StandArea, n: number): Offset {
  let state = anchors.slots.get(area.key);
  if (!state) anchors.slots.set(area.key, state = { valid: [], next: 0, exhausted: false });
  const rivals = state.rivals ?? (state.rivals = anchors.areaList.filter((other) => other !== area && (other.radiusM < area.radiusM || (other.radiusM === area.radiusM && other.key < area.key))
    && Math.hypot(other.eastM - area.eastM, other.northM - area.northM) < area.radiusM * 2 + other.radiusM + 1)),
    phase = (digest(`${area.key}/SLOTS`) % 360) * Math.PI / 180;
  while (state.valid.length <= n && !state.exhausted) {
    const j = state.next++, radius = SLOT_SPIRAL * Math.sqrt(j + .5);
    if (radius > area.radiusM * 4) { state.exhausted = true; break; }
    const angle = phase + j * 2.399963229728653, point = { eastM: area.eastM + Math.cos(angle) * radius, northM: area.northM + Math.sin(angle) * radius };
    if (radius < area.clearM || onStreetBand(place, anchors, point, area.kerbM)
      || rivals.some((other) => Math.hypot(point.eastM - other.eastM, point.northM - other.northM) < other.radiusM + SLOT_GAP_M)) continue;
    state.valid.push(point);
  }
  return state.valid.length ? state.valid[n % state.valid.length] : area;
}
const KIND_RANK: Readonly<Partial<Record<ActivityKind, number>>> = { guard: 0, work: 1, lunch: 2, errand: 3, play: 4, stroll: 5, rest: 6, socialise: 7, pray: 8, commute: 9 };
/**
 * Which residents use which standing ground, from their workday and rest-day plans. Each resident gets one slot per
 * ground, numbered by (most frequent use first, resident index), so any two residents at a ground are on different slots.
 */
function standTableFor(place: Place): StandTable {
  const anchors = settlementAnchors(place);
  if (anchors.stand) return anchors.stand;
  const exteriorPlan = settlementExteriorFor(place);
  const users = new Map<string, [number, number][]>();
  for (let index = 0; index < populationOf(place); index++) {
    const foundation = residentStandSeedFor(place, index, exteriorPlan), subject = { code: foundation.code, role: foundation.role, ageGroup: foundation.ageGroup, guardShift: foundation.guardShift }, best = new Map<string, number>();
    for (const [day, weekday] of [[0, 0], [6, 6]]) for (const entry of dailyPlan(subject, foundation.traits, day, weekday)) {
      if (entry.indoors || entry.anchor === "home") continue;
      const ground = anchors.areas.get(coordKey(anchorOffset(place, foundation, entry.anchor)));
      if (ground) best.set(ground.key, Math.min(best.get(ground.key) ?? 99, KIND_RANK[entry.kind] ?? 9));
    }
    for (const [key, rank] of best) { const list = users.get(key); if (list) list.push([rank, index]); else users.set(key, [[rank, index]]); }
  }
  const slotOf = new Map<string, number>(), total = new Map<string, number>();
  for (const [key, list] of users) {
    list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    list.forEach(([, index], slot) => slotOf.set(`${key}|${index}`, slot));
    total.set(key, list.length);
  }
  return anchors.stand = { slotOf, total };
}
/**
 * Where a resident stands while stationary at an outdoor anchor: a seeded slot inside the shared standing ground
 * (pure function of place, resident and anchor, so walks start and end on the same spot). Indoors and at home: the anchor itself.
 */
function standingSpot(place: Place, foundation: ResidentFoundation, anchor: RoutineAnchor, base: Offset, outdoors: boolean): Offset {
  if (!outdoors || anchor === "home" || (foundation.role === "guard" && anchor === "work")) return base;
  const anchors = settlementAnchors(place), ground = anchors.areas.get(coordKey(base));
  if (!ground) return base;
  const table = standTableFor(place), n = table.slotOf.get(`${ground.key}|${foundation.index}`) ?? (table.total.get(ground.key) ?? 0) + digest(`${foundation.code}/VISIT/${ground.key}`) % 509;
  return slotOffset(place, anchors, ground, n);
}
// ---------------------------------------------------------------- street paths

type StreetGraph = { nodes: Offset[]; edges: number[][]; weights: number[][]; grid: Map<string, number[]>; legalEdges: Map<string, boolean>; nearestLegal: Map<string, number>; border: Offset[]; gates: Offset[]; cell: number };
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
  const graph = { nodes, edges, weights, grid, legalEdges: new Map<string, boolean>(),
    nearestLegal: new Map<string, number>(),
    border: plan.border.map(point => offsetForSource(place, point.x, point.z)),
    gates: plan.gates.map(point => offsetForSource(place, point.x, point.z)), cell };
  streetGraphs.set(place.code, graph);
  while (streetGraphs.size > 8) streetGraphs.delete(streetGraphs.keys().next().value!);
  return graph;
}
/** Find the actual closest indexed street vertex, not the first occupied
 * grid bucket. An adjacent cell can contain a closer vertex, especially at
 * cell boundaries. After ring r, unseen cells start at least r cells away. */
export function nearestNode(graph: Pick<StreetGraph, "nodes" | "grid" | "cell">, offset: Offset) {
  let best = -1, bestDistance = Infinity;
  const cx = Math.floor(offset.eastM / graph.cell), cz = Math.floor(offset.northM / graph.cell);
  for (let ring = 0; ring < 40; ring++) {
    // Visit exactly the same perimeter buckets, in the same dx/dz order,
    // without scanning (and rejecting) the growing square's interior.
    for (let dx = -ring; dx <= ring; dx++) {
      const isSide = Math.abs(dx) === ring;
      for (let dz = -ring; dz <= ring; dz += isSide ? 1 : 2 * ring) {
        for (const id of graph.grid.get(`${cx + dx}/${cz + dz}`) ?? []) {
          const d = Math.hypot(graph.nodes[id].eastM - offset.eastM, graph.nodes[id].northM - offset.northM);
          if (d < bestDistance) { best = id; bestDistance = d; }
        }
      }
    }
    if (best >= 0 && bestDistance <= ring * graph.cell) break;
  }
  return best;
}
/** Sample the authoritative final surface at most one physical metre apart, including endpoints.
 * A sub-2 m stream/cut between formerly legal samples cannot authorize an invented shortcut.
 * Presentation streets alone are not walking authority. */
export function continuousWalkableOffsetSegment(
  from: Offset, to: Offset, walkable: (point: Offset) => boolean,
): boolean {
  const length = Math.hypot(to.eastM - from.eastM, to.northM - from.northM);
  const steps = Math.max(1, Math.ceil(length));
  const check = (i: number) => {
    const t = i / steps;
    return walkable({ eastM: from.eastM + (to.eastM - from.eastM) * t,
      northM: from.northM + (to.northM - from.northM) * t });
  };
  // Rejected multi-kilometre doglegs dominate cold lawful route replay.
  // Probe a subset of the *same exact one-metre positions* before the full
  // pass: a confirmed blocked point is decisive. Every successful segment
  // still checks every original metre once, including a narrow wet cut.
  const stride = steps > 128 ? Math.max(2, Math.ceil(steps / 32)) : 1;
  if (stride > 1) {
    for (let i = 0; i <= steps; i += stride) if (!check(i)) return false;
    if (steps % stride && !check(steps)) return false;
  }
  for (let i = 0; i <= steps; i++) {
    if (stride > 1 && (i % stride === 0 || i === steps)) continue;
    if (!check(i)) return false;
  }
  return true;
}
/** A resident may cross the visible settlement enclosure only through a
 * SEED-authored gate aperture. Final-surface walkability alone has no knowledge
 * of the displayed wall/hedge/palisade segments. This check is symmetric. */
export function legalEnclosureSegment(
  from: Offset, to: Offset, border: readonly Offset[], gates: readonly Offset[], gateRadiusM = 9,
): boolean {
  const rx = to.eastM - from.eastM, rz = to.northM - from.northM;
  const throughGate = (eastM: number, northM: number) =>
    gates.some(gate => Math.hypot(gate.eastM - eastM, gate.northM - northM) <= gateRadiusM);
  for (let index = 0; index < border.length; index++) {
    const a = border[index], b = border[(index + 1) % border.length],
      sx = b.eastM - a.eastM, sz = b.northM - a.northM,
      qx = a.eastM - from.eastM, qz = a.northM - from.northM,
      cross = rx * sz - rz * sx;
    if (Math.abs(cross) < 1e-8) {
      // A chord along an enclosure is not a legal path around its wall.
      if (Math.abs(qx * rz - qz * rx) > 1e-6 || rx * rx + rz * rz < 1e-8) continue;
      const denom = rx * rx + rz * rz,
        t0 = (qx * rx + qz * rz) / denom,
        t1 = ((b.eastM - from.eastM) * rx + (b.northM - from.northM) * rz) / denom,
        lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
      if (hi < lo) continue;
      for (const t of [lo, (lo + hi) / 2, hi])
        if (!throughGate(from.eastM + rx * t, from.northM + rz * t)) return false;
      continue;
    }
    const t = (qx * sz - qz * sx) / cross,
      u = (qx * rz - qz * rx) / cross;
    if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) continue;
    if (!throughGate(from.eastM + rx * t, from.northM + rz * t)) return false;
  }
  return true;
}
/** Final-surface bridge decks, not submerged ground, authorize a crossing.
 * Dry paths retain the existing positive-ground requirement; unbridged water
 * is never traversable, even if a presentation material says otherwise. */
export function residentWalkableSurface(surface: Pick<FinalSurface, "walkable" | "water" | "groundHeight" | "deckHeight" | "surfaceHeight" | "traversal">) {
  // A height alone is not a legal crossing: the composed SEED-owned surface
  // must certify both the bridge traversal and the actual walking grade.
  return surface.walkable &&
    ((surface.water.kind === "none" && surface.groundHeight > 0.1) ||
      (surface.deckHeight !== null && surface.traversal === "bridge" &&
        surface.surfaceHeight === surface.deckHeight));
}
// SEED-owned final surface and enclosure never change during resident queries.
// Cache exact *directed* metre-sampled checks; no coordinate rounding, and no
// reversal that could change floating-point boundary samples on a wet bridge.
const streetSegmentLegality = new Map<string, boolean>();
function legalStreetSegment(place: Place, from: Offset, to: Offset): boolean {
  const key = `${place.code}|${from.eastM},${from.northM}|${to.eastM},${to.northM}`,
    cached = streetSegmentLegality.get(key);
  if (cached !== undefined) return cached;
  const { border, gates } = streetGraphFor(place),
    legal = legalEnclosureSegment(from, to, border, gates) &&
      continuousWalkableOffsetSegment(from, to, point => {
        const p = canonicalOffset(place, point.eastM, point.northM),
          source = lonLatToSource(p.lon, p.lat);
        return residentWalkableSurface(finalSurfaceAt(source.x, source.z));
      });
  streetSegmentLegality.set(key, legal);
  while (streetSegmentLegality.size > 16384)
    streetSegmentLegality.delete(streetSegmentLegality.keys().next().value!);
  return legal;
}
/** A resident's nearest street vertex may lie across an impassable cut.
 * Inspect at most sixteen other local vertices (within 24 m of that nearest
 * connection). Dense street junctions can have eight nearby blocked nodes
 * before the first valid approach; every candidate must still pass the same
 * final-surface and enclosure checks. Never accept proximity alone. */
export function nearestLegalStreetNode(
  graph: Pick<StreetGraph, "nodes" | "grid" | "cell">,
  offset: Offset, legal: (from: Offset, to: Offset) => boolean,
): number {
  const nearest = nearestNode(graph, offset);
  if (nearest < 0) return -1;
  if (legal(offset, graph.nodes[nearest])) return nearest;
  const distance = (node: Offset) => Math.hypot(node.eastM - offset.eastM, node.northM - offset.northM),
    maxDistance = distance(graph.nodes[nearest]) + 24,
    cx = Math.floor(offset.eastM / graph.cell), cz = Math.floor(offset.northM / graph.cell),
    rings = Math.min(40, Math.ceil(maxDistance / graph.cell) + 1),
    candidates: { id: number; distance: number }[] = [];
  const consider = (id: number) => {
    if (id === nearest) return;
    const d = distance(graph.nodes[id]);
    if (d <= maxDistance) candidates.push({ id, distance: d });
  };
  // Remote sparse searches can cover thousands of empty grid buckets.
  // Iterate only occupied buckets when cheaper, retaining the exact old
  // square boundary and deterministic distance/id candidate ordering.
  if (graph.grid.size * 2 < (2 * rings + 1) ** 2) {
    for (const [key, ids] of graph.grid) {
      const [x, z] = key.split("/").map(Number);
      if (Math.abs(x - cx) > rings || Math.abs(z - cz) > rings) continue;
      for (const id of ids) consider(id);
    }
  } else {
    for (let dx = -rings; dx <= rings; dx++) for (let dz = -rings; dz <= rings; dz++)
      for (const id of graph.grid.get(`${cx + dx}/${cz + dz}`) ?? []) consider(id);
  }
  candidates.sort((a, b) => a.distance - b.distance || a.id - b.id);
  for (const candidate of candidates.slice(0, 16))
    if (legal(offset, graph.nodes[candidate.id])) return candidate.id;
  return -1;
}
/** Small dry-land obstacles outside a settlement should not make an
 * otherwise legal open-ground journey impossible. Try a deterministic,
 * strictly bounded set of doglegs. Each complete leg still requires the
 * identical gate/wall/final-surface verdict as ordinary resident movement;
 * no bridge or water crossing is invented here. */
export function legalOpenGroundDetour(
  from: Offset, to: Offset, legal: (a: Offset, b: Offset) => boolean,
): Offset[] | null {
  const dx = to.eastM - from.eastM, dz = to.northM - from.northM,
    length = Math.hypot(dx, dz);
  if (length < 12 || length > 4000) return null;
  const sideX = -dz / length, sideZ = dx / length;
  for (const radius of [24, 64, 160, 320]) {
    for (const progress of [.5, .25, .75]) {
      for (const side of [-1, 1]) {
        const pivot = { eastM: from.eastM + dx * progress + sideX * side * radius,
          northM: from.northM + dz * progress + sideZ * side * radius };
        if (legal(from, pivot) && legal(pivot, to)) return [from, pivot, to];
      }
    }
  }
  // Longer lakes and ravines may need a parallel dry corridor rather than a
  // single central bend. Both approach links and the corridor itself must be
  // physically legal. This branch is finite and never invents a crossing.
  for (const radius of [64, 160, 320, 640]) {
    for (const [start, end] of [[.12, .88], [.2, .8]]) {
      for (const side of [-1, 1]) {
        const shiftX = sideX * side * radius, shiftZ = sideZ * side * radius,
          a = { eastM: from.eastM + dx * start + shiftX, northM: from.northM + dz * start + shiftZ },
          b = { eastM: from.eastM + dx * end + shiftX, northM: from.northM + dz * end + shiftZ };
        if (legal(from, a) && legal(a, b) && legal(b, to)) return [from, a, b, to];
      }
    }
  }
  return null;
}
/** Off-street fallback belongs to exterior ground and exact SEED gates.
 * An interior door cannot bypass disconnected streets with a dry chord to a
 * field or even directly to a gate; the street graph must reach that gate first. */
export function exteriorGroundCorridor(
  from: Offset, to: Offset, border: readonly Offset[], gates: readonly Offset[] = [],
): boolean {
  if (border.length < 3) return true;
  const inside = (point: Offset) => {
    let enclosed = false;
    for (let i = 0, j = border.length - 1; i < border.length; j = i++) {
      const a = border[i], b = border[j];
      if ((a.northM > point.northM) !== (b.northM > point.northM) &&
          point.eastM < (b.eastM - a.eastM) * (point.northM - a.northM) /
            (b.northM - a.northM) + a.eastM)
        enclosed = !enclosed;
    }
    return enclosed;
  };
  const exteriorFrom = !inside(from), exteriorTo = !inside(to),
    atGate = (point: Offset) => gates.some(gate =>
      Math.hypot(gate.eastM - point.eastM, gate.northM - point.northM) <= 1e-6);
  return (exteriorFrom && exteriorTo) ||
    (atGate(from) && exteriorTo) || (atGate(to) && exteriorFrom);
}
const pathCache = new Map<string, Offset[] | null>();
/** Distinct canonical entrances must never reuse a route with different endpoints.
 * Exact finite SEED offsets are stable; rounding them could reuse an illegal connector. */
export function residentStreetPathKey(placeCode: string, from: Offset, to: Offset, allowGateDetour: boolean) {
  return `${placeCode}|${from.eastM},${from.northM}|${to.eastM},${to.northM}|${allowGateDetour ? "g" : "d"}`;
}
/**
 * Follow a real SEED road polyline only when its two physical connectors and
 * every intermediate metre are legal. Pure, finite adapter: it proposes neither
 * a new bridge nor a new workplace, and never supplies authoritative walkability.
 */
export function validatedResidentRoadPolyline(
  from: Offset, to: Offset, road: readonly Offset[],
  legal: (a: Offset, b: Offset) => boolean,
  maxConnectorM = 450, maxPathM = 6500,
): Offset[] | null {
  if (road.length < 2 || road.length > 32 || ![from.eastM, from.northM, to.eastM, to.northM].every(Number.isFinite) ||
      road.some(point => !Number.isFinite(point.eastM) || !Number.isFinite(point.northM))) return null;
  const foot = (point: Offset) => {
    let best: { segment: number; offset: Offset; distance: number } | undefined;
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i], b = road[i + 1],
        dx = b.eastM - a.eastM, dz = b.northM - a.northM,
        squared = dx * dx + dz * dz;
      if (squared < 1e-8) continue;
      const t = Math.max(0, Math.min(1,
        ((point.eastM - a.eastM) * dx + (point.northM - a.northM) * dz) / squared)),
        offset = { eastM: a.eastM + dx * t, northM: a.northM + dz * t },
        distance = Math.hypot(point.eastM - offset.eastM, point.northM - offset.northM);
      if (!best || distance < best.distance) best = { segment: i, offset, distance };
    }
    return best;
  };
  const a = foot(from), b = foot(to);
  if (!a || !b || a.distance > maxConnectorM || b.distance > maxConnectorM) return null;
  const interior = a.segment <= b.segment
    ? road.slice(a.segment + 1, b.segment + 1)
    : road.slice(b.segment + 1, a.segment + 1).reverse();
  const path = [from, a.offset, ...interior, b.offset, to],
    distance = path.reduce((sum, p, i) =>
      i ? sum + Math.hypot(p.eastM - path[i - 1].eastM, p.northM - path[i - 1].northM) : 0, 0);
  if (distance > maxPathM) return null;
  for (let i = 1; i < path.length; i++)
    if (!legal(path[i - 1], path[i])) return null;
  return path;
}

/** Demand-driven real transport bridge route between a SEED gate and an
 * exterior livelihood. Called only after local street/dry-detour failure.
 * No source road or water span gets a free pass: every segment uses the
 * same final-surface and enclosure validator as ordinary resident walking. */
function residentTransportBridgePath(place: Place, from: Offset, to: Offset): Offset[] | null {
  const distance = Math.hypot(to.eastM - from.eastM, to.northM - from.northM);
  if (distance < 300 || distance > 5200) return null;
  const midpoint = canonicalOffset(place, (from.eastM + to.eastM) * .5, (from.northM + to.northM) * .5),
    source = lonLatToSource(midpoint.lon, midpoint.lat),
    scale = sourceUnitsPerMetreAt(source.z),
    radius = Math.min(16_384, Math.max(10, Math.max(scale.x, scale.z) * (distance * .7 + 600)));
  const roads = transportRoadsNear(source.x, source.z, radius, 6),
    actualBridgeRoads = new Set(transportNetwork.bridges.map(bridge => bridge.roadCode));
  let best: Offset[] | null = null, bestDistance = Infinity;
  for (const road of roads) {
    if (!actualBridgeRoads.has(road.code) || road.centerline.length > 32) continue;
    const points = road.centerline.map(point => offsetForSource(place, point.x, point.z)),
      candidate = validatedResidentRoadPolyline(from, to, points,
        (a, b) => legalStreetSegment(place, a, b));
    if (!candidate) continue;
    const length = pathLength(candidate);
    if (length < bestDistance) { best = candidate; bestDistance = length; }
  }
  return best;
}

/**
 * Indexed min-priority frontier for canonical street routing. Identical to
 * scanning an insertion-ordered array with strict '<' score comparison:
 * equal scores retain their original OPEN insertion order, while a reopened
 * node gets a fresh order. Score decreases never change that tie order.
 * No camera, elapsed time, SEED mutation or random ordering is involved.
 */
export class StableStreetFrontier {
  private heap: { id: number; score: number; order: number }[] = [];
  private indices = new Map<number, number>();
  private nextOrder = 0;
  get size() { return this.heap.length; }
  private before(a: { score: number; order: number }, b: { score: number; order: number }) {
    return a.score < b.score || (a.score === b.score && a.order < b.order);
  }
  private swap(a: number, b: number) {
    const left = this.heap[a], right = this.heap[b];
    this.heap[a] = right; this.heap[b] = left;
    this.indices.set(left.id, b); this.indices.set(right.id, a);
  }
  private up(start: number) {
    for (let i = start; i > 0;) {
      const parent = Math.floor((i - 1) / 2);
      if (!this.before(this.heap[i], this.heap[parent])) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  private down(start: number) {
    for (let i = start; ;) {
      const left = i * 2 + 1, right = left + 1;
      let best = i;
      if (left < this.size && this.before(this.heap[left], this.heap[best])) best = left;
      if (right < this.size && this.before(this.heap[right], this.heap[best])) best = right;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }
  set(id: number, score: number) {
    const index = this.indices.get(id);
    if (index !== undefined) {
      const previous = this.heap[index].score;
      this.heap[index].score = score;
      if (score < previous) this.up(index);
      else if (score > previous) this.down(index);
    } else {
      const at = this.size;
      this.heap.push({ id, score, order: this.nextOrder++ });
      this.indices.set(id, at);
      this.up(at);
    }
  }
  take(): number {
    if (!this.size) throw new RangeError("empty street frontier");
    const first = this.heap[0].id, last = this.heap.pop()!;
    this.indices.delete(first);
    if (this.size) {
      this.heap[0] = last;
      this.indices.set(last.id, 0);
      this.down(0);
    }
    return first;
  }
}
/** A missing graph route or illegal connecting segment must never become straight-line travel. */
function streetPath(place: Place, from: Offset, to: Offset, allowGateDetour = true): Offset[] | null {
  // Surface, enclosure and street links are bidirectional. Resolve the same
  // canonical orientation regardless of query order, then reverse that exact
  // lawful path for return travel. This avoids a second graph search for every
  // homecoming without making path choice depend on cache visitation order.
  const fromId = `${from.eastM},${from.northM}`, toId = `${to.eastM},${to.northM}`;
  if (compareText(fromId, toId) > 0) {
    const reverse = streetPath(place, to, from, allowGateDetour);
    return reverse ? [...reverse].reverse() : null;
  }
  const key = residentStreetPathKey(place.code, from, to, allowGateDetour),
    cached = pathCache.get(key);
  if (cached !== undefined) return cached;
  // A home-work pair at the same lawful doorway is already at its destination.
  // Do not invent a trip out to a street vertex and back before allowing work.
  if (Math.hypot(to.eastM - from.eastM, to.northM - from.northM) <= 1e-6) {
    const stationary = legalStreetSegment(place, from, to) ? [from, to] : null;
    pathCache.set(key, stationary);
    while (pathCache.size > 4000) pathCache.delete(pathCache.keys().next().value!);
    return stationary;
  }
  const graph = streetGraphFor(place),
    legalConnector = (a: Offset, b: Offset) => legalStreetSegment(place, a, b),
    // The settlement graph, source offsets and legal final surface are
    // immutable within this SEED. Reuse exact directed connector verdicts
    // for home/public/work endpoints across distinct legal route searches.
    nearest = (point: Offset) => {
      const pointKey = `${point.eastM},${point.northM}`,
        cached = graph.nearestLegal.get(pointKey);
      if (cached !== undefined) return cached; // -1 is also a lawful blocked result.
      const chosen = nearestLegalStreetNode(graph, point, legalConnector);
      graph.nearestLegal.set(pointKey, chosen);
      while (graph.nearestLegal.size > 2048)
        graph.nearestLegal.delete(graph.nearestLegal.keys().next().value!);
      return chosen;
    },
    start = nearest(from),
    goal = nearest(to);
  let path: Offset[] | null = null;
  if (start >= 0 && goal >= 0) {
    if (start === goal) {
      path = [from, graph.nodes[start], to];
    } else {
      const cost = new Map<number, number>([[start, 0]]), cameFrom = new Map<number, number>(),
        frontier = new StableStreetFrontier(),
        // Heuristic depends only on immutable graph nodes and the fixed goal.
        // The indexed frontier preserves the prior insertion-order tie rule.
        heuristic = new Map<number, number>(),
        h = (id: number) => {
          const cached = heuristic.get(id);
          if (cached !== undefined) return cached;
          const distance = Math.hypot(graph.nodes[id].eastM - graph.nodes[goal].eastM,
            graph.nodes[id].northM - graph.nodes[goal].northM);
          heuristic.set(id, distance);
          return distance;
        };
      frontier.set(start, h(start));
      while (frontier.size) {
        const current = frontier.take();
        if (current === goal) break;
        graph.edges[current].forEach((next, i) => {
          // A nonimproving edge cannot enter the path, regardless of whether its
          // physical surface is legal. Do not sample every metre needlessly.
          const tentative = cost.get(current)! + graph.weights[current][i];
          if (!(tentative < (cost.get(next) ?? Infinity))) return;
          const edgeKey = `${Math.min(current,next)}/${Math.max(current,next)}`;
          let legal = graph.legalEdges.get(edgeKey);
          if (legal === undefined) {
            legal = legalStreetSegment(place, graph.nodes[current], graph.nodes[next]);
            graph.legalEdges.set(edgeKey, legal);
          }
          if (!legal) return;
          cost.set(next, tentative); cameFrom.set(next, current);
          frontier.set(next, tentative + h(next));
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
  if (!path && exteriorGroundCorridor(from, to, graph.border, graph.gates) && legalStreetSegment(place, from, to)) path = [from, to];
  // Exterior gate-to-habitat corridors can wind around small dry-land
  // obstacles. Only nonrecursive detour legs use this extra bounded search;
  // the main route must still connect through a legal SEED gate.
  if (!path && !allowGateDetour && exteriorGroundCorridor(from, to, graph.border, graph.gates))
    path = legalOpenGroundDetour(from, to, (a, b) => legalStreetSegment(place, a, b));
  // A disconnected local footpath may reach an existing bridge by following
  // its actual SEED macro road, never by cutting across the river.
  if (!path && !allowGateDetour && exteriorGroundCorridor(from, to, graph.border, graph.gates))
    path = residentTransportBridgePath(place, from, to);
  // Outside farm/woodland/shore sites may lie beyond the enclosure. A direct
  // dry chord through the wall is forbidden, but an actual SEED gate can join
  // an internal street approach to a separately verified exterior corridor.
  // Evaluate at most the settlement's two gates; never recurse into gate
  // discovery or treat a missing/impassable side as successful arrival.
  if (!path && allowGateDetour) {
    for (const gate of graph.gates) {
      const approach = streetPath(place, from, gate, false);
      if (!approach) continue;
      const exterior = streetPath(place, gate, to, false);
      if (!exterior) continue;
      const candidate = [...approach, ...exterior.slice(1)];
      if (!path || pathLength(candidate) < pathLength(path)) path = candidate;
    }
  }
  pathCache.set(key, path);
  while (pathCache.size > 4000) pathCache.delete(pathCache.keys().next().value!);
  return path;
}
/**
 * The real resident's existing street/enclosure planner owns the local
 * approach to a macro-road origin. Transport cannot synthesize an actor at
 * a village node: they first follow these actual legal street points.
 * This does not decide to travel or mutate the resident's daily routine.
 */
export function residentLocalTransportApproach(
  place: Place,
  resident: Resident,
  node: Readonly<{ x: number; z: number }>,
): readonly Readonly<{ x: number; z: number }>[] | null {
  if (resident.settlement !== place.id ||
      resident.code !== `${place.code}/RESIDENT/${resident.index}` ||
      !resident.grounded || resident.indoors ||
      resident.route.startsWith("BLOCKED:") ||
      ![resident.x, resident.z, node.x, node.z].every(Number.isFinite))
    return null;
  const from = offsetForSource(place, resident.x, resident.z),
    to = offsetForSource(place, node.x, node.z),
    path = streetPath(place, from, to);
  if (!path || path.length < 2 || path.length > 256) return null;
  const source = path.map(point => {
    const ll = canonicalOffset(place, point.eastM, point.northM);
    return lonLatToSource(ll.lon, ll.lat);
  });
  if (sourceDistance(source[0].x, source[0].z, resident.x, resident.z) > 1e-4 ||
      sourceDistance(source[source.length - 1].x, source[source.length - 1].z, node.x, node.z) > 1e-4)
    return null;
  return Object.freeze(source.map(point => Object.freeze(point)));
}

/** Existing Simulation enclosure + metre-sampled street legality; required at
 * every segment of a resident's local-to-macro travel connector. */
export function residentLocalTransportSegmentLegal(
  place: Place,
  a: Readonly<{ x: number; z: number }>,
  b: Readonly<{ x: number; z: number }>,
) {
  return legalStreetSegment(place, offsetForSource(place, a.x, a.z),
    offsetForSource(place, b.x, b.z));
}

/** Field crews share the fixed SEED field centre as an approach, then walk
 * to their own standing slot. Every added connector uses the same authoritative
 * ground and enclosure checks; failed approaches fall back to the exact search. */
const fieldRouteCache = new Map<string, Offset[] | null>();
function fieldEntry(place: Place, foundation: ResidentFoundation, anchor: RoutineAnchor) {
  const ground = settlementAnchors(place).areas.get(coordKey(anchorOffset(place, foundation, anchor)));
  return ground?.field ? ground : undefined;
}
function routinePath(place: Place, from: Offset, to: Offset, fromEntry?: Offset, toEntry?: Offset): Offset[] | null {
  if (!fromEntry && !toEntry) return streetPath(place, from, to);
  const key = residentStreetPathKey(place.code, from, to, true) +
    `|${fromEntry?.eastM},${fromEntry?.northM}|${toEntry?.eastM},${toEntry?.northM}`,
    cached = fieldRouteCache.get(key);
  if (cached !== undefined) return cached;
  const core = streetPath(place, fromEntry ?? from, toEntry ?? to);
  const route = core && (!fromEntry || legalStreetSegment(place, from, fromEntry)) &&
    (!toEntry || legalStreetSegment(place, toEntry, to))
    ? [...(fromEntry ? [from] : []), ...core, ...(toEntry ? [to] : [])]
    : streetPath(place, from, to);
  fieldRouteCache.set(key, route);
  while (fieldRouteCache.size > 4000) fieldRouteCache.delete(fieldRouteCache.keys().next().value!);
  return route;
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

/** Advance a legal path only by the Fantasy Time actually available. */
export function timedWalkOnPath(
  path: readonly Offset[], elapsedSeconds: number,
): { offset: Offset; progress: number; durationSeconds: number; lengthM: number } {
  const lengthM = pathLength(path);
  if (lengthM <= 1e-6)
    return { offset: path[path.length - 1], progress: 1, durationSeconds: 0, lengthM };
  const durationSeconds = Math.max(60, lengthM / GOOD_ROAD_WALK_SPEED_MPS),
    progress = Math.max(0, Math.min(1, elapsedSeconds / durationSeconds));
  return { offset: pointAlong(path, progress * lengthM), progress, durationSeconds, lengthM };
}
/** The legal path between the current walk position and the position one `aheadSeconds` later, keeping every corner in between. */
export function walkWindowOnPath(path: readonly Offset[], elapsedSeconds: number, aheadSeconds: number): Offset[] {
  const lengthM = pathLength(path);
  if (lengthM <= 1e-6) return [path[path.length - 1], path[path.length - 1]];
  const durationSeconds = Math.max(60, lengthM / GOOD_ROAD_WALK_SPEED_MPS),
    progressAt = (seconds: number) => Math.max(0, Math.min(1, seconds / durationSeconds)) * lengthM,
    d0 = progressAt(elapsedSeconds), d1 = progressAt(elapsedSeconds + aheadSeconds),
    points = [pointAlong(path, d0)];
  let along = 0;
  for (let i = 1; i < path.length - 1; i++) {
    along += Math.hypot(path[i].eastM - path[i - 1].eastM, path[i].northM - path[i - 1].northM);
    if (along > d0 && along < d1) points.push(path[i]);
  }
  points.push(pointAlong(path, d1));
  return points;
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
type ScheduledResidentState = {
  task: string; route: string; offset: Offset; activity: ActivityKind; indoors: boolean;
  mood: ReturnType<typeof moodAt>;
  activityStart: number; activityEnd: number; activityProgress: number;
  travelProgress?: number; travelDistanceM?: number; walkAhead?: Offset[];
};
// Carry yesterday's actual position for guards, the fixed service roster, and
// civilians with a physically blocked or overlong final return. Do not replay
// the entire civilian population on every query; cache only SEED/time facts.
const overnightPositions = new Map<string, ScheduledResidentState>();
// Only uncertain civilian homecomings need yesterday's expensive physical replay.
// Ordinary residents with a proven timely final return keep the cheap analytic path.
const civilianOvernightRisk = new Map<string, boolean>();
/** The final homecoming needs history if its real route is absent or cannot finish
 * by midnight; never infer arrival from the scheduled destination alone. */
export function unfinishedOrBlockedOvernightReturn(path: readonly Offset[] | null, remainingSeconds: number): boolean {
  return !path || timedWalkOnPath(path, remainingSeconds).progress < 1;
}
/** An optimistic straight line is a strict lower bound on every legal street
 * route. If even that line cannot finish in time, do not run a costly street
 * search. All possibly timely routes still get full Simulation validation. */
export function provablyLateWithoutStreetSearch(from: Offset, to: Offset, remainingSeconds: number): boolean {
  const directMetres = Math.hypot(to.eastM - from.eastM, to.northM - from.northM);
  return directMetres > 1e-6 && (remainingSeconds < 60 ||
    directMetres > remainingSeconds * GOOD_ROAD_WALK_SPEED_MPS);
}
/** An unchanged anchor cannot create a prior-day trip or unresolved return.
 * This exact negative check precedes any standing-slot/physical route work. */
export function routineHasAnchorChange(plan: readonly { anchor: string }[]): boolean {
  for (let i = 1; i < plan.length; i++)
    if (plan[i].anchor !== plan[i - 1].anchor) return true;
  return false;
}
function civilianReturnAtRisk(place: Place, foundation: ResidentFoundation, priorTick: number): boolean {
  const lon = place.canonicalPosition.lon, priorDay = localDayIndex(priorTick, lon),
    key = `${foundation.code}|${priorDay}|${foundation.homeOffset.eastM},${foundation.homeOffset.northM}`,
    cached = civilianOvernightRisk.get(key);
  if (cached !== undefined) return cached;
  const plan = dailyPlan({ code: foundation.code, role: foundation.role,
    ageGroup: foundation.ageGroup, guardShift: foundation.guardShift }, foundation.traits,
    priorDay, localWeekday(priorTick, lon));
  if (!routineHasAnchorChange(plan)) {
    civilianOvernightRisk.set(key, false);
    while (civilianOvernightRisk.size > 16384)
      civilianOvernightRisk.delete(civilianOvernightRisk.keys().next().value!);
    return false;
  }
  // A lawful final homeward route is NOT proof the resident reached its
  // scheduled origin: an earlier failed leg may have left them elsewhere.
  // Prove each distinct anchor reached its physical stop before the following
  // departure. Only an uncertain chain needs the expensive prior-day replay.
  let fromAnchor = plan[0].anchor,
    from = standingSpot(place, foundation, fromAnchor,
      anchorOffset(place, foundation, fromAnchor), !plan[0].indoors),
    risk = false;
  for (let i = 1; i < plan.length; i++) {
    const next = plan[i];
    if (next.anchor === plan[i - 1].anchor) continue;
    const to = standingSpot(place, foundation, next.anchor,
      anchorOffset(place, foundation, next.anchor), !next.indoors);
    let nextDeparture = DAY_SECONDS;
    for (let j = i + 1; j < plan.length; j++)
      if (plan[j].anchor !== plan[j - 1].anchor) {
        nextDeparture = plan[j].start;
        break;
      }
    const remainingSeconds = nextDeparture - next.start - 1;
    if (provablyLateWithoutStreetSearch(from, to, remainingSeconds)) {
      risk = true;
      break;
    }
    const route = routinePath(place, from, to,
      fieldEntry(place, foundation, fromAnchor),
      fieldEntry(place, foundation, next.anchor));
    if (unfinishedOrBlockedOvernightReturn(route, remainingSeconds)) {
      risk = true;
      break;
    }
    from = to;
    fromAnchor = next.anchor;
  }
  civilianOvernightRisk.set(key, risk);
  // Three city rosters and their frequent direct-time queries fit without
  // evicting and recomputing every unique door route during bounded queries.
  while (civilianOvernightRisk.size > 16384)
    civilianOvernightRisk.delete(civilianOvernightRisk.keys().next().value!);
  return risk;
}
function scheduleAt(place: Place, foundation: ResidentFoundation, tick: number, replayOvernight = true, phases?: ResidentEvaluationPhases): ScheduledResidentState {
  const lon = place.canonicalPosition.lon, day = localDayIndex(tick, lon), weekday = localWeekday(tick, lon), second = daySecond(tick, place),
    subject = { code: foundation.code, role: foundation.role, ageGroup: foundation.ageGroup, guardShift: foundation.guardShift },
    plan = dailyPlan(subject, foundation.traits, day, weekday),
    { activity, index } = activityAt(plan, second),
    end = plan[index + 1]?.start ?? 24 * HOUR,
    activityProgress = Math.max(0, Math.min(1, (second - activity.start) / Math.max(1, end - activity.start))),
    mood = moodAt(foundation.code, foundation.traits, day, weekday, second),
    timing = { activityStart: activity.start, activityEnd: end, activityProgress };
  // Seed the bounded history replay at an owned home, never at a scheduled
  // post/worksite. Both guard shifts must carry their actual prior-day end
  // position through midnight, including blocked returns.
  const initialAnchor: RoutineAnchor = !replayOvernight ? "home" : plan[0].anchor,
    morning = standingSpot(place, foundation, initialAnchor, anchorOffset(place, foundation, initialAnchor),
      !replayOvernight ? false : !plan[0].indoors),
    previousKey = `${foundation.code}|${day}|${foundation.homeOffset.eastM},${foundation.homeOffset.northM}`;
  let previousDay: ScheduledResidentState | undefined;
  const fixedRoster = foundation.role === "guard" || foundation.index < SERVICE_ROLES.length;
  let needsHistory = replayOvernight && fixedRoster;
  if (replayOvernight && !fixedRoster) {
    const riskStarted = phases ? performance.now() : 0;
    needsHistory = civilianReturnAtRisk(place, foundation, tick - second - 1);
    if (phases) phases.overnightRiskMs += performance.now() - riskStarted;
  }
  if (needsHistory) {
    previousDay = overnightPositions.get(previousKey);
    if (!previousDay) {
      previousDay = scheduleAt(place, foundation, tick - second - 1, false);
      overnightPositions.set(previousKey, previousDay);
      while (overnightPositions.size > 1024) overnightPositions.delete(overnightPositions.keys().next().value!);
    }
  }
  const atMorning = !!previousDay &&
    Math.hypot(previousDay.offset.eastM - morning.eastM, previousDay.offset.northM - morning.northM) <= 2 &&
    (initialAnchor !== "work" || previousDay.activity === "guard");
  // Replay only changed anchors from absolute Fantasy Time. A failed return
  // cannot reset an unarrived day watchman to home at midnight.
  let offset = previousDay?.offset ?? morning,
    actualAnchor: RoutineAnchor | "en route" = previousDay ? (atMorning ? initialAnchor : "en route") : initialAnchor,
    actuallyIndoors = previousDay ? (atMorning && previousDay.indoors) : !replayOvernight || plan[0].indoors;
  type Leg = { path: Offset[]; start: number; origin: RoutineAnchor | "en route"; destination: RoutineAnchor };
  let leg: Leg | undefined;
  let blocked: { origin: RoutineAnchor | "en route"; destination: RoutineAnchor } | undefined;
  if (previousDay && !atMorning) {
    // Complete a real unfinished journey, or remain blocked at the previous
    // position. Never adopt a schedule's new-day origin as an executed move.
    const continuation = streetPath(place, offset, morning);
    if (continuation) leg = { path: continuation, start: 0, origin: "en route", destination: initialAnchor };
    else blocked = { origin: "en route", destination: initialAnchor };
  }
  const advance = (atSecond: number) => {
    if (!leg) return;
    const moved = timedWalkOnPath(leg.path, atSecond - leg.start);
    offset = moved.offset;
    if (moved.progress >= 1) {
      actualAnchor = leg.destination;
      actuallyIndoors = false;
      leg = undefined;
    } else {
      actualAnchor = "en route";
      actuallyIndoors = false;
    }
  };
  for (let step = 1; step <= index; step++) {
    if (plan[step].anchor === plan[step - 1].anchor) continue;
    advance(plan[step].start);
    if (!leg && !blocked && actualAnchor === plan[step - 1].anchor)
      actuallyIndoors = plan[step - 1].indoors;
    const next = plan[step],
      destination = standingSpot(place, foundation, next.anchor, anchorOffset(place, foundation, next.anchor), !next.indoors),
      origin = actualAnchor,
      path = routinePath(place, offset, destination,
        origin === "en route" ? undefined : fieldEntry(place, foundation, origin),
        fieldEntry(place, foundation, next.anchor));
    if (!path) {
      leg = undefined;
      blocked = { origin, destination: next.anchor };
    } else {
      leg = { path, start: next.start, origin, destination: next.anchor };
      blocked = undefined;
    }
  }
  if (leg) {
    const moved = timedWalkOnPath(leg.path, second - leg.start);
    if (moved.progress < 1)
      return {
        task: `Walking to ${leg.destination === "work" ? "work" : leg.destination === "home" ? "home" : `the ${leg.destination}`}`,
        route: `${leg.origin === "en route" ? "En route" : anchorRoute(place, foundation, leg.origin)} → ${anchorRoute(place, foundation, leg.destination)}`,
        offset: moved.offset, activity: "commute" as ActivityKind, indoors: false, mood,
        ...timing, travelProgress: moved.progress, travelDistanceM: moved.lengthM,
        walkAhead: walkWindowOnPath(leg.path, second - leg.start, TIME_SCALE),
      };
    offset = moved.offset;
  }
  if (blocked)
    return {
      task: `Blocked: no legal walking route to ${blocked.destination}`,
      route: `BLOCKED: ${blocked.origin === "en route" ? "en route" : anchorRoute(place, foundation, blocked.origin)} → ${anchorRoute(place, foundation, blocked.destination)}`,
      offset, activity: "rest" as ActivityKind, indoors: actuallyIndoors, mood,
      ...timing, travelProgress: undefined as number | undefined, travelDistanceM: undefined as number | undefined,
      walkAhead: undefined as Offset[] | undefined,
    };
  // A walk that arrived before the next step begins becomes waiting at the destination.
  const arrived = activity.kind === "commute";
  return {
    task: arrived ? `Waiting at ${activity.anchor === "work" ? "work" : activity.anchor === "home" ? "home" : `the ${activity.anchor}`}` :
      activity.anchor === "work" && activity.kind === "work" && (foundation.workOffset as ActivitySite).label ? workTask(foundation) : activity.task,
    route: anchorRoute(place, foundation, activity.anchor), offset,
    activity: (arrived ? "rest" : activity.kind) as ActivityKind,
    indoors: activity.indoors, mood, ...timing,
    travelProgress: undefined as number | undefined, travelDistanceM: undefined as number | undefined,
    walkAhead: undefined as Offset[] | undefined,
  };
}
/** Preserve the exact scheduled point. Invalid ground is reported, not
 * "corrected" by moving a resident radially toward the settlement centre. */
export function legalPosition(
  place: Place,
  eastM: number,
  northM: number,
): { position: CanonicalPosition; x: number; z: number; grounded: boolean } {
  const candidate = canonicalOffset(place, eastM, northM),
    presentation = lonLatToSource(candidate.lon, candidate.lat),
    surface = finalSurfaceAt(presentation.x, presentation.z);
  return {
    position: { lon: candidate.lon, lat: candidate.lat, elevation: surface.surfaceHeight },
    x: presentation.x,
    z: presentation.z,
    grounded: residentWalkableSurface(surface),
  };
}

/** A resident's indoor state belongs to an authoritative site, not any nearby
 * footprint. Feature IDs contain the canonical plot ID after their world prefix. */
export function residentOccupiesBuilding(
  resident: Pick<Resident, "indoors" | "route" | "homeBuilding" | "homeEntrance" | "workplace">,
  building: { code: string; kind: string; service?: string },
): boolean {
  if (!resident.indoors || resident.route.startsWith("BLOCKED:")) return false;
  if (building.kind === "residence")
    return building.code.endsWith(`/${resident.homeBuilding}`) &&
      (resident.route === resident.homeEntrance || resident.route.startsWith(`${resident.homeBuilding}/`));
  if (building.kind !== "service" || !building.service) return false;
  const settlementCode = resident.homeBuilding.split("/RESIDENCE/")[0];
  if (!building.code.includes(`/${settlementCode}/PLOT/`)) return false;
  const site = building.service.replaceAll("-", "_").toUpperCase();
  return resident.route === `${settlementCode}/${site}` ||
    (resident.route === resident.workplace && resident.workplace === `${settlementCode}/SERVICE/${site}`);
}

/** An indoor service worker must occupy THIS rendered plot, not merely share
 * the service name or fall within the spatial query's larger search radius.
 * Use the canonical metric and the same yaw convention as world footprints. */
export function residentInsideRenderedService(
  resident: Pick<Resident, "x" | "z">,
  building: { x: number; z: number; widthM?: number; depthM?: number; yawRad?: number },
): boolean {
  if (!building.widthM || !building.depthM || building.widthM <= 0 || building.depthM <= 0)
    return false;
  const metric = sourceUnitsPerMetreAt(building.z),
    dx = wrapSourceX(resident.x - building.x) / metric.x,
    dz = (resident.z - building.z) / metric.z,
    yaw = building.yawRad ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  return Math.abs(dx * c - dz * s) <= building.widthM / 2 &&
    Math.abs(dx * s + dz * c) <= building.depthM / 2;
}

/** Readable site caption for the inspector only. Full SEED identities remain accessible. */
export function readableResidentSite(code: string): string {
  const parts = code.split("/");
  const residence = parts.lastIndexOf("RESIDENCE");
  if (residence >= 0) {
    const number = parts[residence + 1] ?? "";
    return `Residence ${number}${parts.includes("ENTRANCE") ? " entrance" : ""}`;
  }
  const gate = parts.lastIndexOf("GATE");
  if (gate >= 0 && /^[0-9]+$/.test(parts[gate + 1] ?? "")) {
    const number = Number(parts[gate + 1]) + 1;
    const post = parts[gate + 2] === "POST" && /^[0-9]+$/.test(parts[gate + 3] ?? "")
      ? ` post ${Number(parts[gate + 3]) + 1}` : "";
    return `Gate ${number}${post}`;
  }
  const site = parts.slice(-2);
  return site.join(" ").replaceAll("_", " ").toLowerCase();
}

/** A failed walk is a concrete origin/destination fact, not a generic warning.
 * Retain the precise authoritative code in the expandable diagnostics. */
export function readableResidentRoute(route: string): string {
  const blocked = route.startsWith("BLOCKED:");
  const detail = blocked ? route.slice("BLOCKED:".length).trim() : route;
  const readable = detail.split(" → ").map(part => part.includes("/") ? readableResidentSite(part) : part).join(" → ");
  return blocked ? `Blocked — ${readable}` : readable;
}

/** Player-facing resident facts and close-up actors are not optional scenery.
 * Once coherent terrain is available, allow bounded resident sprites before
 * roads, buildings and decorative meshes finish streaming. */
export function residentViewQuery(
  halfHeight: number, panelOpen: boolean, terrainReady: boolean,
) {
  const actors = terrainReady && halfHeight < 20;
  return { actors, inspect: actors || (panelOpen && halfHeight < 80) };
}

/** Keep the explicitly selected SEED identity across camera/LOD query changes.
 * Only one off-screen resident is resolved; never scan or rebuild the population. */
export function residentInspectorSelection<T extends { code: string; index: number }>(
  visible: readonly T[], selectedCode: string, resolve: (code: string) => T | undefined,
  limit = 16,
) {
  const nearby = [...visible].sort((a, b) => a.index - b.index).slice(0, limit),
    selectedNearby = nearby.find(resident => resident.code === selectedCode),
    selectedVisible = visible.find(resident => resident.code === selectedCode),
    extra = selectedCode && !selectedNearby ? selectedVisible ?? resolve(selectedCode) : undefined,
    records = extra ? [extra, ...nearby] : nearby,
    retained = selectedCode || nearby[0]?.code || "";
  return {
    records,
    selectedCode: retained,
    outsideView: !!extra && !selectedVisible,
    unavailable: !!selectedCode && !selectedNearby && !extra,
  };
}

/** Stable first-answer caption; camera visibility is presentation-only. */
export function residentShortLabel(resident: Pick<Resident, "index" | "role">, outsideView = false) {
  return `Resident ${resident.index + 1} · ${resident.role.replaceAll("-", " ")}${outsideView ? " · off-screen" : ""}`;
}

/** Observational per-query worker totals; never used to schedule or validate an actor. */
export type ResidentEvaluationPhases = {
  candidateLookupMs: number;
  foundationMs: number;
  doorMs: number;
  scheduleMs: number;
  overnightRiskMs: number;
  groundingMs: number;
  evaluated: number;
};

/** State is reconstructed only from immutable SEED foundation + absolute Fantasy Game Time. */
export function residentAt(place: Place, index: number, tick: number, phases?: ResidentEvaluationPhases): Resident {
  const started = phases ? performance.now() : 0;
  const seeded = residentFoundationAt(place, index),
    foundationDone = phases ? performance.now() : 0,
    door = resolvedSettlementHomeDoorFor(place, index),
    doorDone = phases ? performance.now() : 0,
    // The character stands at the same resolved front-wall door as the house
    // renderer/inspector. Keep this lazy: registry and spatial-index builds must
    // never resolve every home's geometry just to query population identity.
    homeOffset = door ? offsetForSource(place, door.x, door.z) : seeded.homeOffset,
    foundation = door ? { ...seeded, homeOffset,
      workOffset: seeded.workOffset === seeded.homeOffset ? homeOffset : seeded.workOffset } : seeded,
    schedule = scheduleAt(place, foundation, tick, true, phases),
    scheduleDone = phases ? performance.now() : 0,
    location = legalPosition(place, schedule.offset.eastM, schedule.offset.northM),
    groundingDone = phases ? performance.now() : 0,
    grounded = !!door && location.grounded,
    blockedReason = !door ? "assigned house has no legally resolved doorway"
      : !location.grounded ? "scheduled position has no legal ground" : undefined;
  if (phases) {
    phases.foundationMs += foundationDone - started;
    phases.doorMs += doorDone - foundationDone;
    phases.scheduleMs += scheduleDone - doorDone;
    phases.groundingMs += groundingDone - scheduleDone;
    phases.evaluated++;
  }
  return {
    ...foundation,
    ...location,
    grounded,
    task: blockedReason ? `Blocked: ${blockedReason}` : schedule.task,
    route: blockedReason ? `BLOCKED: ${blockedReason}` : schedule.route,
    activity: blockedReason ? "rest" : schedule.activity,
    indoors: !blockedReason && schedule.indoors,
    mood: schedule.mood,
    activityStart: schedule.activityStart,
    activityEnd: schedule.activityEnd,
    activityProgress: schedule.activityProgress,
    ...(blockedReason || schedule.travelProgress === undefined ? {} : {
      travelProgress: schedule.travelProgress, travelDistanceM: schedule.travelDistanceM,
      walkAhead: schedule.walkAhead?.map((o) => {
        const c = canonicalOffset(place, o.eastM, o.northM), p = lonLatToSource(c.lon, c.lat);
        return { x: p.x, z: p.z };
      }),
    }),
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
/** Shared stable population sampling order for serial and parallel view queries. */
export function residentOrderFor(place: Place) {
  const population = populationOf(place), start = digest(`${place.code}/VISIBLE_START`) % population;
  return (index: number) => (index - start + population) % population;
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
  // A village-view request must not cold-index a large, lexically earlier city
  // before the village at the actual camera focus. Distance is canonical and
  // wrap-aware; stable SEED codes break ties without randomness.
  return [...found.values()].sort((a, b) =>
    sourceDistance(a.x, a.z, x, z) - sourceDistance(b.x, b.z, x, z) || compareText(a.code, b.code));
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
function residentIndexFor(place: Place, shard?: { index: number; count: number }): ResidentSpatialIndex {
  const bounds: (ResidentBucketBounds | undefined)[] = [],
    population = populationOf(place),
    anchors = settlementAnchors(place),
    // One final SEED border/lot reconciliation per cold spatial index.
    // Previously each residentFoundationAt() called settlementExteriorFor()
    // and repeated the same village border reconciliation thousands of times.
    exteriorPlan = settlementExteriorFor(place),
    // Only immutable, reusable place/work offsets share conversions within
    // this one cold index build. Distinct resident homes and guard overrides
    // retain their exact authoritative projection, without rounding.
    sharedProjection = new Map<string, ReturnType<typeof relativeSourceForOffset>>(),
    projectShared = (offset: Offset) => {
      const key = `${offset.eastM}/${offset.northM}`,
        cached = sharedProjection.get(key);
      if (cached) return cached;
      const projected = relativeSourceForOffset(place, offset);
      // Bound disposable index-build scratch; no cross-country cache or SEED state.
      if (sharedProjection.size >= 4096)
        sharedProjection.delete(sharedProjection.keys().next().value!);
      sharedProjection.set(key, projected);
      return projected;
    },
    sharedPoints = [anchors.inn, anchors.market, anchors.plaza, anchors.keep].map(projectShared);
  for (let index = 0; index < population; index++) {
    // Shard assignments are exact resident-index congruences. In a cold worker,
    // do not construct thousands of unrelated immutable homes, work sites or
    // canonical projections only to discard them after index construction.
    if (shard && index % shard.count !== shard.index) continue;
    // A resident can be anywhere on the corridors between its own places and the public ones it visits.
    const foundation = residentSpatialFactsAt(place, index, exteriorPlan),
      // A guard whose assigned frontage was physically blocked may own a
      // different legal SEED spare lot. Only the small fixed watch roster is
      // resolved here; never materialize all household doors for indexing.
      guardDoor = foundation.role === "guard" ? resolvedSettlementHomeDoorFor(place, index) : undefined,
      resolvedGuardHome = guardDoor ? offsetForSource(place, guardDoor.x, guardDoor.z) : undefined,
      points = [
        relativeSourceForOffset(place, foundation.homeOffset),
        ...(resolvedGuardHome ? [relativeSourceForOffset(place, resolvedGuardHome)] : []),
        projectShared(foundation.workOffset),
        ...sharedPoints,
        projectShared(gardenSite(place, foundation)),
        projectShared(neighbourhoodSite(place, foundation, "market")),
      ],
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
    bounds[index] = { bx0, bx1, bz0, bz1 };
  }
  return { bounds, population };
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
  private lastResidentIndexBuildMs = 0;
  /** Read-only profiling of the most recent focused query; never affects SEED or routines. */
  get residentIndexBuildMs() { return this.lastResidentIndexBuildMs; }
  private selectedResidentCode = "";
  private siteVisitJournal?: ResidentSiteVisitJournal;
  /** Validating a saved ledger must never publish partially restored actors. */
  private replaySiteVisitJournal?: ResidentSiteVisitJournal;
  private restoringSiteVisits = false;
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
        <dt>Actual gate staffing</dt><dd id="resident-gate-staffing" aria-live="polite">—</dd>
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
        home = place ? resolvedSettlementHomeDoorFor(place, resident.index) : undefined,
        door = home ? sourceToLonLat(home.x, home.z) : undefined;

      const houseCode = document.getElementById("resident-house-code");
      if (houseCode) houseCode.textContent = `Home: ${resident.homeBuilding} · entrance: ${resident.homeEntrance} · owner: ${resident.homeOwner} · settlement: ${resident.settlement}`;
      if (door) {
        const world = (
          window as typeof window & {
            advisorWorld?: {
              navigation?: { setFocus?: (lon: number, lat: number) => void };
            };
          }
        ).advisorWorld;
        if (world?.navigation?.setFocus) {
          world.navigation.setFocus(door.lon, door.lat);
          output.textContent = `Assigned home · capacity ${RESIDENTIAL_CAPACITY}. Map focused on legally resolved house doorway. Full identity below.`;
        } else output.textContent = `Assigned home · capacity ${RESIDENTIAL_CAPACITY}. Map focus unavailable. Full identity below.`;
      } else output.textContent = "Assigned home has no legally resolved visible doorway; map focus unchanged. Full identity below.";
    });
  }

  private renderInspectorResident(resident: Resident, outsideView = false) {
    const text = (id: string, value: string) => {
      const node = document.getElementById(id);
      if (node && node.textContent !== value) node.textContent = value;
    };
    text("resident-name", resident.name);
    text("resident-short-id", residentShortLabel(resident, outsideView));
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
    text("resident-route", readableResidentRoute(resident.route));
    text("resident-guard", resident.gatePost
      ? `${readableResidentSite(resident.gatePost)} · ${resident.guardShift === 0 ? "day" : "night"} watch`
      : "Not assigned to the watch");
    const guardPlace = resident.gatePost ? places.find(place => place.id === resident.settlement) : undefined,
      assignedGate = resident.gatePost ? /\/GATE\/(\d+)\/POST\//.exec(resident.gatePost) : null,
      assignedIndex = assignedGate ? Number(assignedGate[1]) : -1,
      currentCoverage = guardPlace && assignedIndex >= 0 ? guardCoverageAt(guardPlace, this.tick)[assignedIndex] : undefined;
    const watchPresence = guardPlace && currentCoverage
      ? residentGuardPresence(resident, this.tick, guardPlace, currentCoverage.residentCodes) : undefined;
    text("resident-gate-staffing", currentCoverage
      ? `Gate ${assignedIndex + 1}: ${currentCoverage.onDuty}/${currentCoverage.required} physically present${currentCoverage.missing
        ? ` · ${currentCoverage.missing} uncovered post${currentCoverage.missing === 1 ? "" : "s"} (legal housing/route unresolved)`
        : " · fully staffed"} · Selected resident: ${watchPresence === "at-post" ? "at assigned post" :
          watchPresence === "off-duty" ? "off duty" : "scheduled, not physically at post"}`
      : "No gate post assigned");
    text(
      "resident-appearance",
      `${resident.character.replaceAll("_", " ")} · ${resident.ageGroup}, ${Math.floor(resident.birthDay / 365)} years`, 
    );
    const avatar = document.getElementById("resident-avatar");
    if (avatar) {
      if (avatar.dataset.silhouette !== String(resident.appearance.silhouette)) avatar.dataset.silhouette = String(resident.appearance.silhouette);
      if (avatar.dataset.hair !== String(resident.appearance.hair)) avatar.dataset.hair = String(resident.appearance.hair);
      if (avatar.dataset.clothing !== String(resident.appearance.clothing)) avatar.dataset.clothing = String(resident.appearance.clothing);
      if (avatar.dataset.character !== resident.character) {
        avatar.dataset.character = resident.character;
        void import("./npc-portrait.ts").then(({ mountNpcPortrait }) => {
            if (avatar.dataset.character === resident.character) mountNpcPortrait(avatar, resident.character, resident.name, "resident");
          });
      }
    }
    const button = document.getElementById("resident-home-inspect") as HTMLButtonElement | null;
    if (button) button.disabled = false;
  }

  private indexFor(place: Place, shard?: { index: number; count: number }) {
    const key = shard ? `${place.code}|SHARD/${shard.index}/${shard.count}` : place.code;
    let index = this.residentIndexes.get(key);
    if (!index) {
      const started = performance.now();
      index = residentIndexFor(place, shard);
      this.lastResidentIndexBuildMs += performance.now() - started;
      this.residentIndexes.set(key, index);
      // At most eight active shards per device, plus one unsharded inspector.
      // Eviction changes only disposable derived indexes, never SEED identity.
      while (this.residentIndexes.size > 16)
        this.residentIndexes.delete(this.residentIndexes.keys().next().value!);
      this.residentIndexBuilds++;
    }
    return index;
  }

  private residentCandidates(place: Place, x: number, z: number, radius: number, shard?: { index: number; count: number }) {
    const index = this.indexFor(place, shard),
      relativeX = wrapSourceX(x - place.x),
      relativeZ = z - place.z,
      bx0 = Math.floor((relativeX - radius) / RESIDENT_BUCKET_SOURCE),
      bx1 = Math.floor((relativeX + radius) / RESIDENT_BUCKET_SOURCE),
      bz0 = Math.floor((relativeZ - radius) / RESIDENT_BUCKET_SOURCE),
      bz1 = Math.floor((relativeZ + radius) / RESIDENT_BUCKET_SOURCE),
      search: ResidentBucketBounds = { bx0, bx1, bz0, bz1 },
      found: number[] = [];
    for (let resident = 0; resident < index.bounds.length; resident++) {
      const bounds = index.bounds[resident];
      if (bounds && residentBucketBoundsOverlap(bounds, search)) found.push(resident);
    }
    const rank = residentOrderFor(place);
    return found.sort((a, b) => rank(a) - rank(b));
  }

  private updateInspector(visible: Resident[], query: QueryStats) {
    if (typeof document === "undefined") return;
    if (!this.inspector) this.installInspector();
    const select = document.getElementById("resident-select") as HTMLSelectElement | null;
    if (!select) return;
    const selection = residentInspectorSelection(visible, this.selectedResidentCode,
      code => this.residentByCode(code)), retained = selection.selectedCode;
    // Stable-frame proximity queries must not recreate the focused select's
    // options or repeatedly announce unchanged resident labels to assistive tech.
    const desiredOptions = [
      ...(selection.unavailable ? [{ value: retained, label: `Selected resident unavailable · ${retained}` }] : []),
      ...selection.records.map((resident) => ({
        value: resident.code,
        label: `${resident.name} · ${resident.role.replaceAll("-", " ")}${selection.outsideView && resident.code === retained ? " · off-screen" : ""}`,
      })),
    ];
    if (select.options.length !== desiredOptions.length || desiredOptions.some((option, i) =>
      select.options[i].value !== option.value || select.options[i].textContent !== option.label))
      select.replaceChildren(...desiredOptions.map(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
      }));
    this.selectedResidentCode = retained;
    if (select.value !== retained) select.value = retained;
    const resident = selection.records.find(entry => entry.code === retained);
    if (resident) {
      this.renderInspectorResident(resident, selection.outsideView);
    } else {
      const name = document.getElementById("resident-name");
      if (name) name.textContent = retained
        ? "Selected resident unavailable — SEED identity retained"
        : "Zoom closer to inspect inhabitants";
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
    shard?: { index: number; count: number },
    prioritizeActors = false,
    phases?: ResidentEvaluationPhases,
  ) {
    this.lastResidentIndexBuildMs = 0;
    if (!(radius >= 0) || !(limit >= 0)) return [] as Resident[];
    // A zero actor budget must be a zero-work, zero-actor query (never one
    // accidental resident from the first candidate bucket).
    if (limit === 0) {
      const empty: QueryStats = { settlements: 0, candidateResidents: 0, evaluatedResidents: 0, returnedResidents: 0 };
      this.lastQuery = empty;
      this.updateInspector([], empty);
      return [] as Resident[];
    }
    const settlements = nearbyPlaces(x, z, radius).filter((place) => {
      const country = countries.find(
        (entry) =>
          entry.continent === place.continent && entry.id === place.country,
      );
      return country?.code === this.activeCountry;
    });
    const query: QueryStats = {
      settlements: settlements.length,
      candidateResidents: 0,
      evaluatedResidents: 0,
      returnedResidents: 0,
    };
    const visible: Resident[] = [], indoorOrUnresolved: Resident[] = [];
    let exhausted = false;
    // Do not eagerly build every nearby settlement's entire resident index.
    // The first bounded view can fill its canonical quota in one settlement;
    // later settlements then contribute no residents and need no cold index.
    // Preserve the exact original place/candidate ordering and legal checks.
    for (const place of settlements) {
      const candidateStarted = phases ? performance.now() : 0;
      const candidates = this.residentCandidates(place, x, z, radius, shard)
        .filter(index => !shard || index % shard.count === shard.index);
      if (phases) phases.candidateLookupMs += performance.now() - candidateStarted;
      query.candidateResidents += candidates.length;
      for (const index of candidates) {
        if (prioritizeActors && !residentActorSearchContinues(query.evaluatedResidents, visible.length, limit)) {
          exhausted = true;
          break;
        }
        const resident = residentAt(place, index, this.tick, phases);
        query.evaluatedResidents++;
        this.residentEvaluationsSinceAdvance++;
        if (sourceDistance(resident.x, resident.z, x, z) > radius) continue;
        if (prioritizeActors && (!resident.grounded || resident.indoors)) indoorOrUnresolved.push(resident);
        else visible.push(resident);
        if (visible.length >= limit) break;
      }
      if (exhausted || visible.length >= limit ||
          (prioritizeActors && !residentActorSearchContinues(query.evaluatedResidents, visible.length, limit))) break;
    }
    // Keep indoor residents inspectable, but never let eight indoor-only facts
    // hide a real legal street actor from the first close-up canvas selection.
    if (prioritizeActors && visible.length < limit)
      visible.push(...indoorOrUnresolved.slice(0, limit - visible.length));
    query.returnedResidents = visible.length;
    this.lastQuery = query;
    this.updateInspector(visible, query);
    return visible;
  }

  /** Worker results feed the same inspector without reconstructing a population on the UI thread. */
  acceptResidentQuery(residents: Resident[], query: QueryStats) {
    this.lastQuery = query;
    this.updateInspector(residents, query);
  }

  /**
   * Seeded identity only (name, role, home, traits): no schedule, route or legality work, so it is
   * cheap enough for UI clicks. Use residentByCode for where the resident is now.
   */
  residentIdentityByCode(code: string) {
    const match = /^(.*)\/RESIDENT\/(\d+)$/.exec(code);
    if (!match) return undefined;
    const place = places.find((entry) => entry.code === match[1]), index = Number(match[2]);
    if (!place || !Number.isInteger(index) || index < 0 || index >= populationOf(place)) return undefined;
    return residentFoundationAt(place, index);
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

  /** Project only an event already admitted by this Simulation journal, never
   * by a worker or a player-supplied route preview. Ordinary identity and
   * schedule reconstruction are unchanged for everyone else. */
  projectedResidentByCode(code: string, tick = this.tick) {
    const resident = this.residentByCode(code, tick);
    return resident && this.siteVisitJournal
      ? this.siteVisitJournal.project(resident, tick) : resident;
  }

  /** Reconcile a routine worker query with this main Simulation's accepted
   * journeys before drawing sprites, picking an actor, or updating inspectors.
   * The worker cannot independently authorize or invent a journey. */
  projectResidentView(
    residents: Resident[], tick: number,
    view: Readonly<{ x: number; z: number; radius: number; limit: number }>,
  ) {
    return this.siteVisitJournal?.visible(residents, tick, view) ?? residents;
  }

  /**
   * On-demand Simulation authority for a proposed canonical site itinerary:
   * character decides independently from SEED personality, mood and current
   * free-time activity; the current street/gate and every owned river/macro
   * section must validate before a journey event is recorded. No camera/route
   * preview can set acceptedByResident. Import terrain/route proof only on
   * explicit demand, never in focusedResidents or an animation frame.
   *
   * Event journal is not yet a live/persistent worker snapshot: callers must
   * not portray it as actual character movement until the shared resident
   * query surface consumes these events.
   */
  async tryBeginSelfDirectedSiteVisit(
    residentCode: string,
    route: Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>,
  ) {
    return this.restoringSiteVisits ? null :
      this.verifySiteVisitAt(residentCode, route, this.tick);
  }

  /** Same strict physical and character decision replay at the SAVED Fantasy
   * tick. Never accept a serialized journey, decision flag or position. */
  private async verifySiteVisitAt(
    residentCode: string,
    route: Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>,
    tick: number,
  ) {
    const currentTick = this.tick, actor = this.residentByCode(residentCode, tick);
    if (!Number.isSafeInteger(tick) || tick < 0 || tick > currentTick) return null;
    if (!actor || !actor.grounded || actor.indoors ||
        route.edgeCodes.length < 2 || route.edgeCodes.length > 12) return null;
    const place = places.find(entry => entry.id === actor.settlement);
    if (!place || actor.code !== `${place.code}/RESIDENT/${actor.index}`) return null;
    const [{ siteTransportNetwork }, { createTransportWalkingIndex },
      { ResidentSiteVisitJournal }] = await Promise.all([
      import("./site-transport-network.ts"),
      import("./transport-walking-route.ts"),
      import("./resident-transport-events.ts"),
    ]);
    // A stale async candidate never starts a journey at a superseded tick.
    // Live offers cannot be backdated; persisted past events replay against
    // their original Fantasy ticks even while present time keeps advancing.
    if (tick === currentTick && this.tick !== currentTick && !this.restoringSiteVisits) return null;
    const nodes = new Map(siteTransportNetwork.nodes.map(node => [node.code, node])),
      origin = nodes.get(route.from), destination = nodes.get(route.to);
    if (!origin || origin.sourceId !== place.id ||
        !["village", "city", "capital"].includes(origin.kind) ||
        !destination || destination.kind !== "site" ||
        !route.edgeCodes.every(code => siteTransportNetwork.roadEdges.some(edge => edge.code === code)))
      return null;
    const roads = new Map(siteTransportNetwork.roadEdges.map(edge => [edge.code, edge])),
      index = createTransportWalkingIndex(siteTransportNetwork);
    const journal = this.replaySiteVisitJournal ??
      (this.siteVisitJournal ??= new ResidentSiteVisitJournal(
        (code, atTick) => this.residentByCode(code, atTick),
      ));
    return journal.tryStart(residentCode, tick, route, roads, nodes,
      index.adjacency, siteTransportNetwork.bridges,
      (resident, gate) => residentLocalTransportApproach(place, resident, gate),
      (from, to) => residentLocalTransportSegmentLegal(place, from, to));
  }

  /**
   * Player advice is a REQUEST, never a travel command. On demand only, ask
   * the existing SEED character whether they will visit one of a few real
   * road-connected sites via an owned bridge, and accept movement only after
   * tryBeginSelfDirectedSiteVisit has independently checked the actor, local
   * gate, full surface, grades and bridge. No background population sweep.
   */
  async considerAdvisorSiteVisit(residentCode: string): Promise<{
    started: boolean; message: string;
  }> {
    if (this.restoringSiteVisits)
      return { started: false, message: "Saved journeys are being revalidated; no new advice has been applied." };
    const tick = this.tick, actor = this.residentByCode(residentCode, tick);
    if (!actor || actor.code !== residentCode)
      return { started: false, message: "No canonical resident is available to consider this advice." };
    if (this.siteVisitJournal?.eventFor(residentCode))
      return this.considerAdvisorHomeReturn(residentCode);
    if (!actor.grounded || actor.indoors || actor.route.startsWith("BLOCKED:"))
      return { started: false, message: "The resident cannot leave a legally grounded outdoor position." };
    if (!["stroll", "errand", "socialise"].includes(actor.activity))
      return { started: false, message: "The resident has chosen to keep their current routine." };
    const [{ siteTransportNetwork }, { siteVisitCorridors }] = await Promise.all([
      import("./site-transport-network.ts"),
      import("./site-visit-advice.ts"),
    ]);
    if (tick !== this.tick)
      return { started: false, message: "The resident's situation changed before the advice was evaluated." };
    const candidates = siteVisitCorridors(siteTransportNetwork, actor.settlement);
    if (!candidates.length)
      return { started: false, message: "No bounded SEED road-and-bridge visit could be proposed from this settlement." };
    // A graph is only a proposal. Every trial must still pass the resident's
    // actual decision AND all Simulation final-surface evidence, or fail closed.
    for (const corridor of candidates.slice(0, 4)) {
      if (this.tick !== tick) break;
      const event = await this.tryBeginSelfDirectedSiteVisit(residentCode, corridor);
      if (event) return {
        started: true,
        message: "The resident chose to set out on a fully verified road-and-bridge journey.",
      };
    }
    return { started: false,
      message: "The resident did not begin this visit; an independent choice or lawful physical route was unavailable." };
  }

  /**
   * Actual site-to-owned-home return. A citizen who has not yet walked all
   * outbound stations cannot reverse, and advice cannot force their homeward
   * choice. Freshly prove reverse bank/bridge, town gate, original departure
   * AND the legally resolved house door on the current final surface.
   */
  private async verifyHomeReturnAt(residentCode: string, tick: number) {
    const journal = this.replaySiteVisitJournal ?? this.siteVisitJournal,
      accepted = journal?.eventFor(residentCode),
      previous = journal?.returnFor(residentCode),
      currentTick = this.tick;
    if (!accepted || previous || !Number.isSafeInteger(tick) ||
        tick <= accepted.decidedTick || tick > currentTick) return null;
    const status = journal!.at(residentCode, tick);
    if (!status || status.status !== "arrived") return null;
    const resident = this.residentByCode(residentCode, tick),
      place = places.find(p => p.id === resident?.settlement);
    if (!resident || !place || !resident.grounded) return null;
    const door = resolvedSettlementHomeDoorFor(place, resident.index);
    if (!door) return null;
    const [{ siteTransportNetwork }, { createTransportWalkingIndex }, {
      prepareResidentTransportReturnJourney, appendResidentReturnToOwnedDoor,
    }] = await Promise.all([
      import("./site-transport-network.ts"),
      import("./transport-walking-route.ts"),
      import("./resident-transport-journey.ts"),
    ]);
    if (!this.restoringSiteVisits && this.tick !== currentTick) return null;
    const roads = new Map(siteTransportNetwork.roadEdges.map(edge => [edge.code, edge])),
      nodes = new Map(siteTransportNetwork.nodes.map(node => [node.code, node])),
      index = createTransportWalkingIndex(siteTransportNetwork),
      siteActor = { ...resident, x: status.x, z: status.z,
        position: { ...sourceToLonLat(status.x, status.z), elevation: finalSurfaceAt(status.x, status.z).surfaceHeight },
        indoors: false, grounded: true, route: "SITE VISIT: reached" },
      decision = { acceptedByResident: true as const, residentCode,
        fromNode: accepted.siteNode, siteNode: accepted.fromNode, decidedTick: tick },
      reversed = prepareResidentTransportReturnJourney(
        siteActor, decision, accepted.journey, accepted.fromNode,
        roads, nodes, index.adjacency, siteTransportNetwork.bridges,
        undefined, undefined, (a, b) => residentLocalTransportSegmentLegal(place, a, b));
    if (!reversed) return null;
    const departure = reversed.stations[reversed.stations.length - 1],
      fromDeparture = { ...resident, x: departure.x, z: departure.z,
        indoors: false, grounded: true, route: "HOME RETURN: local streets" },
      homePath = residentLocalTransportApproach(place, fromDeparture, door);
    if (!homePath) return null;
    const complete = appendResidentReturnToOwnedDoor(reversed, homePath,
      (a, b) => residentLocalTransportSegmentLegal(place, a, b));
    if (!complete) return null;
    return journal?.tryRecordHomeReturn(residentCode, tick, complete, door) ?? null;
  }

  async considerAdvisorHomeReturn(residentCode: string) {
    const saved = this.siteVisitJournal?.eventFor(residentCode);
    if (!saved)
      return { started: false, message: "No accepted site journey exists for this resident." };
    if (this.siteVisitJournal?.returnFor(residentCode))
      return { started: false, message: "This resident already chose a verified homeward journey." };
    if (this.siteVisitJournal?.at(residentCode, this.tick)?.status !== "arrived")
      return { started: false, message: "The resident must physically reach the site before returning." };
    const returned = await this.verifyHomeReturnAt(residentCode, this.tick);
    return returned
      ? { started: true, message: "The resident chose a proven route to their own house door." }
      : { started: false, message: "The resident declined or a real door, street, deck or grade made the return unlawful." };
  }

  /** Canonical versioned event history: rebuild original decisions AND physical
   * journeys at saved Fantasy ticks before any restored actor can move. */
  savedSiteVisitHistory() {
    return { version: 1, seed: "ADVISOR-0126-ALDERWICK",
      foundation: "v5", visits: this.siteVisitJournal?.savedVisits() ?? [] };
  }

  async restoreSiteVisitHistory(saved: unknown): Promise<boolean> {
    if (!saved || typeof saved !== "object") return false;
    const input = saved as Record<string, unknown>;
    if (input.version !== 1 || input.seed !== "ADVISOR-0126-ALDERWICK" ||
        input.foundation !== "v5" || !Array.isArray(input.visits) ||
        input.visits.length > 16) return false;
    if (this.restoringSiteVisits) return false;
    const replayTick = this.tick;
    this.restoringSiteVisits = true;
    try {
      const { ResidentSiteVisitJournal } = await import("./resident-transport-events.ts");
      this.replaySiteVisitJournal = new ResidentSiteVisitJournal(
        (code, atTick) => this.residentByCode(code, atTick));
      const seen = new Set<string>();
      for (const raw of input.visits) {
        if (!raw || typeof raw !== "object") return false;
        const record = raw as Record<string, unknown>;
        if (typeof record.residentCode !== "string" || seen.has(record.residentCode) ||
            typeof record.from !== "string" || typeof record.to !== "string" ||
            !Number.isSafeInteger(record.decidedTick) || (record.decidedTick as number) < 0 ||
            (record.decidedTick as number) > replayTick || !Array.isArray(record.edgeCodes) ||
            record.edgeCodes.length < 2 || record.edgeCodes.length > 12 ||
            !record.edgeCodes.every(code => typeof code === "string" && code.length < 256))
          return false;
        seen.add(record.residentCode);
        const accepted = await this.verifySiteVisitAt(record.residentCode,
          { from: record.from, to: record.to, edgeCodes: record.edgeCodes },
          record.decidedTick as number);
        if (!accepted) return false;
        if (record.homeReturnTick !== undefined) {
          if (!Number.isSafeInteger(record.homeReturnTick) ||
              (record.homeReturnTick as number) > replayTick ||
              !await this.verifyHomeReturnAt(record.residentCode, record.homeReturnTick as number))
            return false;
        }
      }
      // Publish once all sixteen-or-fewer original decisions and every
      // homeward segment have been freshly revalidated. Readers, inspectors
      // and workers never see a partially accepted imported journey.
      this.siteVisitJournal = this.replaySiteVisitJournal;
      return true;
    } catch {
      return false;
    } finally {
      this.replaySiteVisitJournal = undefined;
      this.restoringSiteVisits = false;
    }
  }

  /** Read-only validated departure event; not yet an applied worker-visible trip. */
  preparedSiteVisitFor(residentCode: string) {
    return this.siteVisitJournal?.eventFor(residentCode);
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
