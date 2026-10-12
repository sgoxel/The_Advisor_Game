import { countries, places, type Place } from "./geography.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import { digest, heightAt } from "./world.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  CANONICAL_PLANET_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  clampLatitude,
  lonLatToSource,
  normalizeLongitude,
  wrapSourceX,
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
  | "trader";

export type ResidentFoundation = {
  code: string;
  name: string;
  settlement: string;
  home: string;
  homeEntrance: string;
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
  homeOffset: { eastM: number; northM: number };
  workOffset: { eastM: number; northM: number };
};

export type Resident = ResidentFoundation & {
  /** Canonical spherical simulation position. */
  position: CanonicalPosition;
  /** Transitional renderer/source coordinates; never stable world identity. */
  x: number;
  z: number;
  task: string;
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

const SERVICE_ROLES: readonly ResidentRole[] = [
  "innkeeper",
  "merchant",
  "blacksmith",
  "farmer",
  "butcher",
  "guard-officer",
];
const CITIZEN_ROLES: readonly ResidentRole[] = [
  "artisan",
  "laborer",
  "farmer",
  "trader",
];
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
};
const GIVEN_NAMES = [
  "Alda",
  "Beren",
  "Cora",
  "Dain",
  "Elin",
  "Fenn",
  "Garrick",
  "Hale",
  "Iris",
  "Jorin",
  "Kestrel",
  "Lysa",
  "Marek",
  "Nella",
  "Orin",
  "Perrin",
] as const;
const FAMILY_NAMES = [
  "Ash",
  "Briar",
  "Crow",
  "Dale",
  "Ember",
  "Ford",
  "Grey",
  "Hearth",
  "Iron",
  "Lake",
  "Moss",
  "Oak",
  "Pine",
  "Reed",
  "Stone",
  "Vale",
] as const;
const DAY_SECONDS = 86_400;
const HOUR = 3_600;
const PLACE_BUCKET_SOURCE = 128;
const MAX_RESIDENT_ROAM_M = 320;
const MAX_RESIDENT_ROAM_SOURCE =
  MAX_RESIDENT_ROAM_M / CANONICAL_METRES_PER_SOURCE_UNIT;
const DEFAULT_VISIBLE_LIMIT = 128;

export const populationOf = (place: Place) =>
  place.kind === "city" ? 2400 : 80;

/**
 * Cached tangent coefficients are presentation-independent acceleration data.
 * Resident routes stay within a few hundred metres of their settlement centre,
 * keeping this local spherical tangent approximation well below one metre of
 * position error while avoiding repeated ECEF/ENU trigonometry.
 */
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

function seededOffset(
  code: string,
  minRadiusM: number,
  maxRadiusM: number,
): { eastM: number; northM: number } {
  const angle = ((digest(`${code}/ANGLE`) % 65_536) / 65_536) * Math.PI * 2,
    radiusSpan = Math.max(1, Math.round(maxRadiusM - minRadiusM)),
    radius = minRadiusM + (digest(`${code}/RADIUS`) % radiusSpan);
  return {
    eastM: Math.cos(angle) * radius,
    northM: Math.sin(angle) * radius,
  };
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
    for (let slot = 0; slot < slots; slot++) {
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

function workOffsetFor(
  place: Place,
  code: string,
  role: ResidentRole,
  assignment: GuardAssignment | undefined,
) {
  if (assignment) {
    const gates = gateCountFor(place),
      base = ((digest(`${place.code}/GATE_ORIENTATION`) % 65_536) / 65_536) *
        Math.PI *
        2,
      angle = base + (assignment.gateIndex / gates) * Math.PI * 2,
      radius = place.kind === "city" ? 230 : 72;
    return {
      eastM: Math.cos(angle) * radius,
      northM: Math.sin(angle) * radius,
    };
  }
  const serviceRadius = role === "farmer" ? 62 : 22;
  return seededOffset(`${code}/WORK/${ROLE_WORKPLACE[role]}`, 8, serviceRadius);
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
    home = `${place.code}/HOME/${index}`,
    first = GIVEN_NAMES[variant % GIVEN_NAMES.length],
    family = FAMILY_NAMES[
      digest(`${code}/FAMILY`) % FAMILY_NAMES.length
    ];
  return {
    code,
    name: `${first} ${family}`,
    settlement: place.id,
    home,
    homeEntrance: `${home}/ENTRANCE`,
    workplace: assignment?.gatePost ?? `${place.code}/SERVICE/${ROLE_WORKPLACE[role]}`,
    role,
    gatePost: assignment?.gatePost,
    guardShift: assignment?.shift,
    index,
    variant,
    birthDay: digest(`${code}/BIRTH_DAY`) % (90 * 365),
    appearance: {
      silhouette: digest(`${code}/SILHOUETTE`) % 5,
      hair: digest(`${code}/HAIR`) % 8,
      clothing: digest(`${code}/CLOTHING`) % 9,
    },
    homeOffset: seededOffset(
      `${home}/POSITION`,
      10,
      place.kind === "city" ? 215 : 58,
    ),
    workOffset: workOffsetFor(place, code, role, assignment),
  };
}

function daySecond(tick: number) {
  return ((tick % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
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

function routeOffset(
  from: { eastM: number; northM: number },
  to: { eastM: number; northM: number },
  progress: number,
) {
  const t = Math.max(0, Math.min(1, progress));
  if (t <= 0.5) {
    const k = 1 - t * 2;
    return { eastM: from.eastM * k, northM: from.northM * k };
  }
  const k = (t - 0.5) * 2;
  return { eastM: to.eastM * k, northM: to.northM * k };
}

function scheduleAt(foundation: ResidentFoundation, tick: number) {
  const second = daySecond(tick);
  if (foundation.role === "guard") {
    if (isGuardOnDuty(foundation, tick))
      return { task: "Guard duty", offset: foundation.workOffset };
    return { task: "Resting at home", offset: foundation.homeOffset };
  }
  if (second < 6 * HOUR)
    return { task: "Resting at home", offset: foundation.homeOffset };
  if (second < 7 * HOUR)
    return {
      task: "Walking to work",
      offset: routeOffset(
        foundation.homeOffset,
        foundation.workOffset,
        (second - 6 * HOUR) / HOUR,
      ),
    };
  if (second < 18 * HOUR)
    return {
      task:
        foundation.role === "farmer"
          ? "Working the farm"
          : foundation.role === "blacksmith"
            ? "Working the forge"
            : foundation.role === "merchant" || foundation.role === "trader"
              ? "Trading"
              : foundation.role === "innkeeper"
                ? "Keeping the inn"
                : foundation.role === "butcher"
                  ? "Working the butcher shop"
                  : foundation.role === "guard-officer"
                    ? "Coordinating the watch"
                    : "Working",
      offset: foundation.workOffset,
    };
  if (second < 19 * HOUR)
    return {
      task: "Walking home",
      offset: routeOffset(
        foundation.workOffset,
        foundation.homeOffset,
        (second - 18 * HOUR) / HOUR,
      ),
    };
  return { task: "At home", offset: foundation.homeOffset };
}

function legalPosition(
  place: Place,
  eastM: number,
  northM: number,
): { position: CanonicalPosition; x: number; z: number } {
  const candidate = canonicalOffset(place, eastM, northM),
    presentation = lonLatToSource(candidate.lon, candidate.lat),
    legal = heightAt(presentation.x, presentation.z) > 0.1,
    source = legal ? presentation : { x: place.x, z: place.z },
    surface = legal ? candidate : place.canonicalPosition,
    elevation = heightAt(source.x, source.z);
  return {
    position: { lon: surface.lon, lat: surface.lat, elevation },
    x: source.x,
    z: source.z,
  };
}

/**
 * Resident state is analytical from immutable SEED-derived foundation + absolute
 * Fantasy Game Time. Calling this directly at a future tick is identical to
 * stepping through every intermediate tick.
 */
export function residentAt(
  place: Place,
  index: number,
  tick: number,
): Resident {
  const foundation = residentFoundationAt(place, index),
    schedule = scheduleAt(foundation, tick),
    location = legalPosition(
      place,
      schedule.offset.eastM,
      schedule.offset.northM,
    );
  return {
    ...foundation,
    ...location,
    task: schedule.task,
  };
}

export function summaryAt(code: string, tick: number): CountryState {
  const baseline = digest(code) % 5000;
  return {
    code,
    population: 7920,
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
function bucketKey(x: number, z: number) {
  return `${bucketX(x)}/${bucketZ(z)}`;
}
const placeBuckets = new Map<string, Place[]>();
for (const place of places) {
  const key = bucketKey(place.x, place.z),
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
      if (!bucket) continue;
      for (const place of bucket) found.set(place.code, place);
    }
  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function sourceDistance(ax: number, az: number, bx: number, bz: number) {
  const dx = wrapSourceX(ax - bx);
  return Math.hypot(dx, az - bz);
}

function countryLogicalPopulation(code: string) {
  return (countryPlaces.get(code) ?? []).reduce(
    (total, place) => total + populationOf(place),
    0,
  );
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

  setFocus(place: Place | undefined) {
    if (!place) return;
    const next = countries.find(
      (country) =>
        country.continent === place.continent && country.id === place.country,
    )!.code;
    if (this.activeCountry && this.activeCountry !== next)
      this.reconstructionCount++;
    this.activeCountry = next;
  }

  setInterest(code: string) {
    this.interested.clear();
    this.interested.add(code);
  }

  advance(tick: number) {
    if (tick < this.tick)
      throw new RangeError("Simulation time must move forward");
    this.tick = tick;
    this.residentEvaluationsSinceAdvance = 0;
    for (const country of countries) {
      const live = country.code === this.activeCountry,
        interested = this.interested.has(country.code),
        interval = live ? 1 : interested ? 30 : 300,
        previous = this.summaries.get(country.code),
        tier = live ? "live" : interested ? "interested" : "coarse";
      if (
        !previous ||
        live ||
        previous.tier !== tier ||
        tick - previous.lastTick >= interval
      ) {
        const state = summaryAt(country.code, tick);
        state.tier = tier;
        this.summaries.set(country.code, state);
      }
    }
  }

  /**
   * Renderer-interest query. Work is bounded to spatially nearby settlements,
   * and only analytical resident states that can contribute to the visible pool
   * are materialized. Logical population identity itself remains complete.
   */
  focusedResidents(
    x: number,
    z: number,
    radius: number,
    limit = DEFAULT_VISIBLE_LIMIT,
  ) {
    if (!(radius >= 0) || !(limit >= 0)) return [] as Resident[];
    const candidates = nearbyPlaces(x, z, radius).filter((place) => {
      const country = countries.find(
        (entry) =>
          entry.continent === place.continent && entry.id === place.country,
      );
      return country?.code === this.activeCountry;
    });
    const query: QueryStats = {
      settlements: candidates.length,
      candidateResidents: candidates.reduce(
        (total, place) => total + populationOf(place),
        0,
      ),
      evaluatedResidents: 0,
      returnedResidents: 0,
    };
    const visible: Resident[] = [];
    for (const place of candidates) {
      const count = populationOf(place),
        start = digest(`${place.code}/VISIBLE_START`) % count;
      for (let offset = 0; offset < count; offset++) {
        const index = (start + offset) % count,
          resident = residentAt(place, index, this.tick);
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
      query: { ...this.lastQuery },
      coarseCountries: [...this.summaries.values()].filter(
        (state) => state.tier === "coarse",
      ).length,
    };
  }
}
