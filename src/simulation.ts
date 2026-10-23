import { countries, places, type Place } from "./geography.ts";
import { characterForRole, type CharacterAge, type CharacterSex } from "./characters.ts";
import { politicalSettlementSiteById } from "./political-settlement-access.ts";
import { digest, finalSurfaceAt, heightAt } from "./world.ts";
import { settlementExteriorFor, settlementHomeFor } from "./settlement-exterior.ts";
import { activityAt, dailyPlan, moodAt, traitsFor, type ActivityKind, type Mood, type ResidentTraits, type RoutineAnchor } from "./routines.ts";
import { fantasyDayIndex, fantasySecondOfDay, fantasyWeekday } from "./clock.ts";
import { familyName, personName } from "./names.ts";
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
const MAX_RESIDENT_ROAM_M = 320;
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
type SettlementAnchors = { inn: Offset; market: Offset; plaza: Offset; keep: Offset; services: Map<string, Offset>; fields: Offset[]; posts: Offset[][] };
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
    fields: plan.plots.filter((plot) => plot.kind === "field").map((plot) => at(plot.candidates[0])),
    posts: plan.gates.map((gate) => (gate.guardPosts.length ? gate.guardPosts : [gate]).map((post) => at(post))),
  };
  anchorCache.set(place.code, anchors);
  while (anchorCache.size > 16) anchorCache.delete(anchorCache.keys().next().value!);
  return anchors;
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
function workOffsetFor(place: Place, index: number, role: ResidentRole, assignment: GuardAssignment | undefined, home: Offset): Offset {
  const anchors = settlementAnchors(place), pick = <T>(list: readonly T[], salt: string) => list[digest(`${place.code}/RESIDENT/${index}/${salt}`) % list.length];
  if (assignment && anchors.posts.length) {
    const posts = anchors.posts[assignment.gateIndex % anchors.posts.length];
    return posts[assignment.slot % posts.length];
  }
  const service = (name: string) => anchors.services.get(name) ?? anchors.market;
  switch (role) {
    case "innkeeper": return anchors.inn;
    case "merchant": case "trader": case "beggar": return anchors.market;
    case "blacksmith": return service("blacksmith");
    case "butcher": return service("butcher");
    case "guard-officer": return service("guard-office");
    case "farmer": return index < SERVICE_ROLES.length || !anchors.fields.length ? service("farmstead") : pick(anchors.fields, "FIELD");
    case "laborer": return anchors.fields.length && digest(`${place.code}/RESIDENT/${index}/LABOUR`) % 3 ? pick(anchors.fields, "FIELD") : service("farmstead");
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
    homeOffset = offsetForSource(place, homeLot.x, homeLot.z);
  return {
    code,
    name: personName(code, character.sex, place.continent),
    home: homeBuilding,
    settlement: place.id,
    homeBuilding,
    homeEntrance: `${homeBuilding}/ENTRANCE`,
    homeOwner: code,
    workplace:
      assignment?.gatePost ?? `${place.code}/SERVICE/${ROLE_WORKPLACE[role]}`,
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
    workOffset: workOffsetFor(place, index, role, assignment, homeOffset),
  };
}

/** Second of the fantasy day as shown by the HUD clock (tick 0 is not midnight). */
function daySecond(tick: number) {
  return fantasySecondOfDay(tick);
}
function isGuardOnDuty(foundation: ResidentFoundation, tick: number) {
  if (foundation.role !== "guard") return false;
  const daytime = daySecond(tick) >= 6 * HOUR && daySecond(tick) < 18 * HOUR;
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
        if (isGuardOnDuty(foundation, tick)) {
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
  return anchor === "inn" ? anchors.inn : anchor === "market" ? anchors.market : anchor === "keep" ? anchors.keep : anchors.plaza;
}
function anchorRoute(foundation: ResidentFoundation, anchor: RoutineAnchor) {
  return anchor === "home" ? foundation.homeEntrance : anchor === "work" ? foundation.workplace : `${foundation.settlement}/${anchor.toUpperCase()}`;
}
/** Small seeded standing spot around an outdoor anchor, so a crowd at the market does not stack. */
function standingSpot(foundation: ResidentFoundation, anchor: RoutineAnchor, base: Offset, outdoors: boolean): Offset {
  if (!outdoors || anchor === "home") return base;
  const angle = (digest(`${foundation.code}/SPOT/${anchor}`) % 360) * Math.PI / 180, radius = 2 + (digest(`${foundation.code}/SPOT-R/${anchor}`) % 70) / 10;
  return { eastM: base.eastM + Math.cos(angle) * radius, northM: base.northM + Math.sin(angle) * radius };
}
/**
 * The resident's state at an absolute tick: today's seeded plan (role, age,
 * weekday, traits, mood) gives the activity; moving between two places takes
 * real walking time at the canonical good-road pace along the corridor between them.
 */
function scheduleAt(place: Place, foundation: ResidentFoundation, tick: number) {
  const day = fantasyDayIndex(tick), weekday = fantasyWeekday(tick), second = daySecond(tick),
    subject = { code: foundation.code, role: foundation.role, ageGroup: foundation.ageGroup, guardShift: foundation.guardShift },
    plan = dailyPlan(subject, foundation.traits, day, weekday),
    { activity, previous } = activityAt(plan, second),
    target = standingSpot(foundation, activity.anchor, anchorOffset(place, foundation, activity.anchor), !activity.indoors),
    mood = moodAt(foundation.code, foundation.traits, day, weekday, second);
  if (previous && previous.anchor !== activity.anchor) {
    const from = standingSpot(foundation, previous.anchor, anchorOffset(place, foundation, previous.anchor), !previous.indoors),
      distanceM = Math.hypot(target.eastM - from.eastM, target.northM - from.northM),
      travel = Math.max(60, distanceM / GOOD_ROAD_WALK_SPEED_MPS), elapsed = second - activity.start;
    if (elapsed < travel)
      return {
        task: activity.kind === "commute" ? activity.task : `Walking to ${activity.anchor === "work" ? "work" : activity.anchor === "home" ? "home" : `the ${activity.anchor}`}`,
        route: `${anchorRoute(foundation, previous.anchor)} → ${anchorRoute(foundation, activity.anchor)}`,
        offset: routeOffset(from, target, elapsed / travel), activity: "commute" as ActivityKind, indoors: false, mood,
      };
  }
  return { task: activity.task, route: anchorRoute(foundation, activity.anchor), offset: target, activity: activity.kind, indoors: activity.indoors, mood };
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
    reach = radius + MAX_RESIDENT_ROAM_SOURCE,
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
  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
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
      points = [foundation.homeOffset, foundation.workOffset, anchors.inn, anchors.market, anchors.plaza, anchors.keep].map((offset) => relativeSourceForOffset(place, offset)),
      minX = Math.min(...points.map((point) => point.x)),
      maxX = Math.max(...points.map((point) => point.x)),
      minZ = Math.min(...points.map((point) => point.z)),
      maxZ = Math.max(...points.map((point) => point.z)),
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
        <div><h3 id="resident-name">Zoom closer to inspect inhabitants</h3><code id="resident-code"></code></div>
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
      <p class="hint" id="resident-performance" aria-live="polite"></p>`;
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
      output.textContent = `House ${resident.homeBuilding} · entrance ${resident.homeEntrance} · owner ${resident.homeOwner} · capacity ${RESIDENTIAL_CAPACITY} · settlement ${resident.settlement}${home ? " · world focus moved to entrance anchor" : ""}`;
      if (home) {
        const world = (
          window as typeof window & {
            advisorWorld?: {
              navigation?: { setFocus?: (lon: number, lat: number) => void };
            };
          }
        ).advisorWorld;
        world?.navigation?.setFocus?.(home.position.lon, home.position.lat);
      }
    });
  }

  private renderInspectorResident(resident: Resident) {
    const text = (id: string, value: string) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };
    text("resident-name", resident.name);
    text("resident-code", resident.code);
    text("resident-role", resident.role.replaceAll("-", " "));
    text("resident-task", resident.task);
    text("resident-mood", `${resident.mood.label} (${resident.mood.value >= 0 ? "+" : ""}${resident.mood.value.toFixed(2)})`);
    const a = resident.traits.abilities;
    text("resident-traits", `${resident.traits.temperament} · STR ${a.strength} DEX ${a.dexterity} CON ${a.constitution} KNO ${a.knowledge} WIS ${a.wisdom} CHA ${a.charisma}`);
    text("resident-home", `${familyName(resident.code, places.find((place) => place.id === resident.settlement)?.continent ?? 0)} House · ${resident.homeBuilding}`);
    text("resident-workplace", resident.workplace);
    text("resident-route", resident.route);
    text(
      "resident-guard",
      resident.gatePost
        ? `${resident.gatePost} · ${resident.guardShift === 0 ? "day" : "night"} shift`
        : "Not assigned to the watch",
    );
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