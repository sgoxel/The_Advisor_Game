import { countries, places, type Place } from "./geography.ts";
import { digest, finalSurfaceAt, heightAt } from "./world.ts";
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
  home: string;
  settlement: string;
  homeBuilding: string;
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
  position: CanonicalPosition;
  x: number;
  z: number;
  task: string;
  route: string;
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
const RESIDENT_BUCKET_SOURCE = 4;
const MAX_RESIDENT_ROAM_M = 320;
const MAX_RESIDENT_ROAM_SOURCE =
  MAX_RESIDENT_ROAM_M / CANONICAL_METRES_PER_SOURCE_UNIT;
const DEFAULT_VISIBLE_LIMIT = 128;
export const RESIDENTIAL_CAPACITY = 8;

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
function seededOffset(code: string, minRadiusM: number, maxRadiusM: number) {
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
function workOffsetFor(
  place: Place,
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
  const workplaceCode = `${place.code}/SERVICE/${ROLE_WORKPLACE[role]}`,
    radius = role === "farmer" ? (place.kind === "city" ? 195 : 62) : 28;
  return seededOffset(`${workplaceCode}/POSITION`, 8, radius);
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
    household = Math.floor(index / RESIDENTIAL_CAPACITY),
    homeBuilding = `${place.code}/RESIDENCE/${household}`,
    first = GIVEN_NAMES[variant % GIVEN_NAMES.length],
    family = FAMILY_NAMES[digest(`${code}/FAMILY`) % FAMILY_NAMES.length];
  return {
    code,
    name: `${first} ${family}`,
    home: place.id,
    settlement: place.id,
    homeBuilding,
    homeEntrance: `${homeBuilding}/ENTRANCE`,
    workplace:
      assignment?.gatePost ?? `${place.code}/SERVICE/${ROLE_WORKPLACE[role]}`,
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
      `${homeBuilding}/POSITION`,
      10,
      place.kind === "city" ? 215 : 58,
    ),
    workOffset: workOffsetFor(place, role, assignment),
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
function scheduleAt(foundation: ResidentFoundation, tick: number) {
  const second = daySecond(tick),
    workRoute = `${foundation.homeEntrance} → ${foundation.workplace}`,
    homeRoute = `${foundation.workplace} → ${foundation.homeEntrance}`;
  if (foundation.role === "guard")
    return isGuardOnDuty(foundation, tick)
      ? {
          task: "Guard duty",
          route: foundation.gatePost ?? foundation.workplace,
          offset: foundation.workOffset,
        }
      : {
          task: "Resting at home",
          route: foundation.homeEntrance,
          offset: foundation.homeOffset,
        };
  if (second < 6 * HOUR)
    return {
      task: "Resting at home",
      route: foundation.homeEntrance,
      offset: foundation.homeOffset,
    };
  if (second < 7 * HOUR)
    return {
      task: "Walking to work",
      route: workRoute,
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
      route: foundation.workplace,
      offset: foundation.workOffset,
    };
  if (second < 19 * HOUR)
    return {
      task: "Walking home",
      route: homeRoute,
      offset: routeOffset(
        foundation.workOffset,
        foundation.homeOffset,
        (second - 18 * HOUR) / HOUR,
      ),
    };
  return {
    task: "At home",
    route: foundation.homeEntrance,
    offset: foundation.homeOffset,
  };
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
    route: schedule.route,
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
    population = populationOf(place);
  for (let index = 0; index < population; index++) {
    const foundation = residentFoundationAt(place, index),
      home = relativeSourceForOffset(place, foundation.homeOffset),
      work = relativeSourceForOffset(place, foundation.workOffset),
      minX = Math.min(home.x, work.x),
      maxX = Math.max(home.x, work.x),
      minZ = Math.min(home.z, work.z),
      maxZ = Math.max(home.z, work.z),
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
        <dt>House</dt><dd id="resident-home">—</dd>
        <dt>Workplace / post</dt><dd id="resident-workplace">—</dd>
        <dt>Current route</dt><dd id="resident-route">—</dd>
        <dt>Guard assignment</dt><dd id="resident-guard">—</dd>
        <dt>Appearance seed</dt><dd id="resident-appearance">—</dd>
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
      if (resident && output)
        output.textContent = `House ${resident.homeBuilding} · entrance ${resident.homeEntrance} · household capacity ${RESIDENTIAL_CAPACITY} · settlement ${resident.settlement}`;
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
    text("resident-home", resident.homeBuilding);
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
      `silhouette ${resident.appearance.silhouette + 1} · hair ${resident.appearance.hair + 1} · clothing ${resident.appearance.clothing + 1}`,
    );
    const avatar = document.getElementById("resident-avatar");
    if (avatar) {
      avatar.dataset.silhouette = String(resident.appearance.silhouette);
      avatar.dataset.hair = String(resident.appearance.hair);
      avatar.dataset.clothing = String(resident.appearance.clothing);
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
    const sample = visible.slice(0, 16),
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
