/**
 * NPC inspector popup: opened by clicking a resident on the map. Shows the
 * seeded identity (picture, name, trade, sex, age, temperament), abilities,
 * personality, current mood and activity, home and workplace by name, and the
 * whole of today's routine with the current step highlighted. It reads only
 * pure SEED + Fantasy Time functions, so it can be refreshed at any moment.
 */
import { continents, countries, places, roadConnections, type Place } from "./geography.ts";
import { greatCircleDistance } from "./planet.ts";
import { nearbyCriticalSites } from "./sites.ts";
import { finalSurfaceAt } from "./world.ts";
import { politicalSettlementSiteById } from "./political-settlement-access.ts";
import { metresToSource } from "./physical-scale.ts";
import { buildingName, familyName, type BuildingKind } from "./names.ts";
import { activityAt, dailyPlan, type Activity } from "./routines.ts";
import { localDayIndex, localSecondOfDay, localWeekday } from "./clock.ts";
import { settlementExteriorFor } from "./settlement-exterior.ts";
import type { Resident } from "./simulation.ts";

const ABILITY_LABELS: [keyof Resident["traits"]["abilities"], string][] = [
  ["strength", "Strength"], ["dexterity", "Dexterity"], ["constitution", "Constitution"],
  ["knowledge", "Knowledge"], ["wisdom", "Wisdom"], ["charisma", "Charisma"],
];
const PERSONALITY_LABELS: [keyof Resident["traits"]["personality"], string][] = [
  ["diligence", "Diligence"], ["sociability", "Sociability"], ["piety", "Piety"], ["temper", "Temper"], ["curiosity", "Curiosity"],
];
const WEEKDAYS = ["Moonday", "Tirsday", "Wodsday", "Thunday", "Freyday", "Marketday", "Restday"];
const ROLE_SERVICE: Partial<Record<string, BuildingKind>> = {
  innkeeper: "inn", merchant: "market", trader: "market", beggar: "market", blacksmith: "blacksmith",
  butcher: "butcher", "guard-officer": "guard-office", noble: "keep", clergy: "well",
};

const clock = (second: number) => `${String(Math.floor(second / 3600)).padStart(2, "0")}:${String(Math.floor((second % 3600) / 60)).padStart(2, "0")}`;
const escape = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const bar = (value: number, max: number, hue: string) =>
  `<span class="npc-bar"><i style="width:${Math.round(Math.max(0, Math.min(1, value / max)) * 100)}%;background:${hue}"></i></span>`;

let root: HTMLElement | undefined;
let currentCode = "";
/** What the popup shows: a resident (refreshed with Fantasy Time), a building or a settlement. */
let currentKind: "npc" | "building" | "settlement" | "" = "";

function placeOf(resident: Resident) {
  return places.find((place) => place.id === resident.settlement);
}
/** Proper names of the settlement's public buildings for routine anchors. */
function anchorNames(resident: Resident) {
  const place = placeOf(resident);
  if (!place) return {} as Record<string, string>;
  const plan = settlementExteriorFor(place), find = (kind: string, service?: string) => plan.plots.find((plot) => plot.kind === kind && (!service || plot.service === service)),
    named = (kind: BuildingKind, plot: ReturnType<typeof find>) => plot ? buildingName(kind, plot.id, place.name, place.continent, plot.ownerId ? familyName(plot.ownerId, place.continent) : undefined, place.kind === "city") : undefined,
    workKind = ROLE_SERVICE[resident.role],
    workPlot = workKind === "keep" ? find("keep") : workKind === "well" ? find("well") : workKind ? find("service", workKind) : undefined,
    home = `${familyName(resident.code, place.continent)} House`,
    work = resident.role === "guard" ? `${place.name} gate post`
      : resident.role === "artisan" ? `${home} (workshop)`
        : resident.role === "farmer" || resident.role === "laborer" ? `${place.name} fields`
          : resident.ageGroup !== "adult" ? home
            : named(workKind ?? "house", workPlot) ?? place.name;
  return {
    home, work,
    inn: named("inn", find("service", "inn")) ?? "the inn",
    market: named("market", find("service", "market")) ?? "the market",
    plaza: named("well", find("well")) ?? "the square",
    keep: named("keep", find("keep")) ?? "the keep",
    settlement: place.name,
  } as Record<string, string>;
}

function install() {
  if (root || typeof document === "undefined") return;
  root = document.createElement("div");
  root.id = "npc-popup";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Character");
  root.hidden = true;
  root.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-close]")) hideNpcPopup();
  });
  document.body.append(root);
  addEventListener("keydown", (event: KeyboardEvent) => { if (event.key === "Escape") hideNpcPopup(); });
}

export function npcPopupCode() {
  return root && !root.hidden && currentKind === "npc" ? currentCode : "";
}
export function hideNpcPopup() {
  if (root) root.hidden = true;
  currentCode = "";
  currentKind = "";
}

/** Open (or refresh) the popup for a resident at a simulation tick. */
export function showNpcPopup(resident: Resident, tick: number) {
  install();
  if (!root) return;
  currentCode = resident.code;
  currentKind = "npc";
  const t = resident.traits, names = anchorNames(resident), lon = placeOf(resident)?.canonicalPosition.lon ?? 0, second = localSecondOfDay(tick, lon), day = localDayIndex(tick, lon), weekday = localWeekday(tick, lon),
    plan = dailyPlan({ code: resident.code, role: resident.role, ageGroup: resident.ageGroup, guardShift: resident.guardShift }, t, day, weekday),
    { index } = activityAt(plan, second),
    where = (activity: Activity) => names[activity.anchor] ?? activity.anchor,
    ageYears = Math.floor(resident.birthDay / 365),
    moodHue = resident.mood.value > .15 ? "#7fc77a" : resident.mood.value > -.15 ? "#d8b979" : "#d0705a",
    picture = new URL(`characters/${resident.character}.webp`, document.baseURI).href;
  root.innerHTML = `
    <div class="npc-head">
      <img src="${picture}" alt="" class="npc-picture">
      <div>
        <div class="eyebrow">${escape(names.settlement ?? "")} · resident</div>
        <h2>${escape(resident.name)}</h2>
        <div class="npc-sub">${escape(resident.role.replaceAll("-", " "))} · ${resident.sex} · ${ageYears} years (${resident.ageGroup}) · ${escape(t.temperament)}</div>
      </div>
      <button class="npc-close" data-close aria-label="Close character">×</button>
    </div>
    <div class="npc-now">
      <div><span class="npc-label">Now</span><b>${escape(resident.task)}</b> <span class="npc-muted">· ${resident.indoors ? "indoors" : "outdoors"}</span></div>
      <div><span class="npc-label">Mood</span><b style="color:${moodHue}">${escape(resident.mood.label)}</b> ${bar(resident.mood.value + 1, 2, moodHue)}</div>
      <div><span class="npc-label">Home</span>${escape(names.home ?? "")}</div>
      <div><span class="npc-label">Work</span>${escape(names.work ?? resident.workplace)}</div>
    </div>
    <div class="npc-columns">
      <section><h3>Abilities</h3>${ABILITY_LABELS.map(([key, label]) => `<div class="npc-row"><span>${label}</span>${bar(t.abilities[key], 18, "#d8b979")}<b>${t.abilities[key]}</b></div>`).join("")}</section>
      <section><h3>Personality</h3>${PERSONALITY_LABELS.map(([key, label]) => `<div class="npc-row"><span>${label}</span>${bar(t.personality[key], 1, "#8fb3c9")}<b>${Math.round(t.personality[key] * 100)}</b></div>`).join("")}</section>
    </div>
    <section class="npc-routine"><h3>Today's routine · ${WEEKDAYS[weekday]}</h3>
      <ol>${plan.map((activity, i) => `<li class="${i === index ? "current" : i < index ? "past" : ""}"><time>${clock(activity.start)}</time><span>${escape(activity.task)}</span><em>${escape(where(activity))}</em></li>`).join("")}</ol>
    </section>
    <code class="npc-code">${escape(resident.code)}</code>`;
  root.hidden = false;
}

// ---------------------------------------------------------------- buildings

export type BuildingInfo = {
  name?: string; kind: string; service?: string; ownerId?: string; widthM?: number; depthM?: number; capacity?: number;
  house?: { houseType: string; storeys: number; roomCount: number }; code: string; fieldForm?: string; label?: string;
};
const SERVICE_TITLE: Record<string, string> = {
  inn: "Inn and tavern", market: "Market", blacksmith: "Smithy", butcher: "Butchery", "guard-office": "Watchhouse",
  farmstead: "Farmstead", merchant: "Trading house", headman: "Headman's hall",
};
function buildingTitle(info: BuildingInfo) {
  if (info.kind === "residence") return info.house ? `${cap(info.house.houseType.replace("-", " "))} · home` : "House";
  if (info.kind === "service") return SERVICE_TITLE[info.service ?? ""] ?? "Workshop";
  if (info.kind === "keep") return "Keep";
  if (info.kind === "well") return "Well";
  if (info.kind === "field") return `${cap(info.fieldForm ?? "field")} field`;
  if (info.kind === "garden") return "Kitchen garden";
  if (info.kind === "gate") return "Town gate";
  if (info.kind === "guard-post") return "Guard post";
  if (info.kind === "street") return "Street";
  if (info.kind === "border") return "Enclosure";
  return cap(info.kind);
}
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Building card: name, type, owner, size, floors, settlement and who is inside right now. */
export function showBuildingPopup(info: BuildingInfo, settlement: Place | undefined, owner: Resident | undefined, inside: readonly Resident[]) {
  install();
  if (!root) return;
  currentCode = info.code;
  currentKind = "building";
  const size = info.widthM && info.depthM ? `${info.widthM.toFixed(1)} × ${info.depthM.toFixed(1)} m (${Math.round(info.widthM * info.depthM)} m²)` : "",
    floors = info.house ? `${info.house.storeys} storey${info.house.storeys > 1 ? "s" : ""} · ${info.house.roomCount} rooms` : info.kind === "keep" ? "3 storeys · towers" : info.service === "inn" ? "2 storeys · common room and lodgings" : "",
    rows: [string, string][] = [];
  if (settlement) rows.push(["Town", settlement.name]);
  if (owner) rows.push([info.kind === "residence" ? "Home of" : "Run by", `${owner.name} · ${owner.role.replaceAll("-", " ")}`]);
  if (size) rows.push(["Size", size]);
  if (floors) rows.push(["Floors", floors]);
  if (info.capacity && info.kind === "service") rows.push(["Serves", `up to ${info.capacity} people`]);
  root.innerHTML = `
    <div class="npc-head info-head">
      <div>
        <div class="eyebrow">${escape(buildingTitle(info))}</div>
        <h2>${escape(info.name ?? buildingTitle(info))}</h2>
      </div>
      <button class="npc-close" data-close aria-label="Close">×</button>
    </div>
    <div class="npc-now">${rows.map(([label, value]) => `<div><span class="npc-label info-label">${escape(label)}</span>${escape(value)}</div>`).join("")}</div>
    <section class="npc-routine"><h3>Inside now</h3>${inside.length
      ? `<ol>${inside.map((resident) => `<li><time>${escape(resident.mood.label)}</time><span>${escape(resident.name)}</span><em>${escape(resident.task)}</em></li>`).join("")}</ol>`
      : `<p class="npc-muted">Nobody is inside at the moment.</p>`}</section>`;
  root.hidden = false;
}

// ---------------------------------------------------------------- settlements

const SETTLEMENT_TYPE: Record<string, [string, string]> = {
  "market-trade": ["Merchant City", "Market Village"],
  riverside: ["River City", "Riverside Village"],
  hillside: ["Hill City", "Hill Village"],
  "fortified-frontier": ["Fortress City", "Frontier Stockade"],
  roadside: ["Road City", "Roadside Village"],
  green: ["Garden City", "Village Green"],
  crossroads: ["Crossroads City", "Crossroads Village"],
  "dispersed-farming": ["Farming Town", "Farming Hamlet"],
};
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/** Compass direction from one source point to another (+z is south). */
function direction(fromX: number, fromZ: number, toX: number, toZ: number) {
  const dx = toX - fromX, dz = toZ - fromZ, angle = Math.atan2(dx, -dz);
  return COMPASS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
}
const km = (metres: number) => metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km` : `${Math.round(metres / 10) * 10} m`;

/** Terrain around a settlement: what lies in each direction at about 1.5 and 4 km. */
function surroundings(place: Place) {
  const found = new Map<string, Set<string>>(), interesting = new Set(["Woodland", "Lake", "River", "Ocean", "Highlands", "Volcanic highlands", "Sandy beach", "Meadow"]),
    pretty: Record<string, string> = { Woodland: "Forest", Lake: "Lake", River: "River", Ocean: "Sea coast", Highlands: "Highlands", "Volcanic highlands": "Volcanic hills", "Sandy beach": "Beaches", Meadow: "Open meadows" };
  for (const distanceM of [1500, 4000]) for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, x = place.x + Math.sin(angle) * metresToSource(distanceM), z = place.z - Math.cos(angle) * metresToSource(distanceM),
      material = finalSurfaceAt(x, z).material;
    if (!interesting.has(material)) continue;
    const label = pretty[material] ?? material, dirs = found.get(label) ?? new Set<string>();
    dirs.add(COMPASS[i]);
    found.set(label, dirs);
  }
  return [...found.entries()].map(([label, dirs]) => `${label} to the ${[...dirs].slice(0, 3).join(", ")}`);
}

/** Town card: type, population, country, notable places, farmland, terrain, nearby sites and neighbours. */
export function showSettlementPopup(place: Place, population: number) {
  install();
  if (!root) return;
  currentCode = place.code;
  currentKind = "settlement";
  const plan = settlementExteriorFor(place), city = place.kind === "city",
    country = countries.find((entry) => entry.continent === place.continent && entry.id === place.country),
    continent = continents[place.continent]?.name ?? "",
    type = (SETTLEMENT_TYPE[plan.archetype] ?? ["City", "Village"])[city ? 0 : 1],
    water = politicalSettlementSiteById.get(place.id)?.waterContext,
    named = (plot: (typeof plan.plots)[number]) => buildingName((plot.kind === "service" ? plot.service : plot.kind) as BuildingKind, plot.id, place.name, place.continent, plot.ownerId ? familyName(plot.ownerId, place.continent) : undefined, city),
    notable = plan.plots.filter((plot) => plot.kind === "service" || plot.kind === "keep" || plot.kind === "well")
      .map((plot) => `${named(plot)} <span class="npc-muted">· ${plot.kind === "service" ? (SERVICE_TITLE[plot.service ?? ""] ?? "workshop").toLowerCase() : plot.kind}</span>`),
    fields = plan.plots.filter((plot) => plot.kind === "field"),
    farmland = fields.length ? `${fields.length} fields (${[...new Set(fields.map((field) => field.fieldForm))].join(", ")}) around the walls` : "",
    sites = nearbyCriticalSites(place.x, place.z, metresToSource(40_000), 6).map((site) => ({
      text: `${site.name} <span class="npc-muted">· ${site.kind === "ruin" ? "ruins" : site.archetype.replace("-", " ")}</span>`,
      distance: greatCircleDistance(place.canonicalPosition, site.canonicalPosition), dir: direction(place.x, place.z, site.x, site.z),
    })),
    neighbours = places.filter((other) => other.id !== place.id)
      .map((other) => ({ other, distance: greatCircleDistance(place.canonicalPosition, other.canonicalPosition) }))
      .sort((a, b) => a.distance - b.distance).slice(0, 5),
    linked = new Set(roadConnections.filter((link) => link.from === place.id || link.to === place.id).map((link) => link.from === place.id ? link.to : link.from)),
    list = (items: readonly string[]) => items.length ? `<ul class="info-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : `<p class="npc-muted">None known.</p>`;
  root.innerHTML = `
    <div class="npc-head info-head">
      <div>
        <div class="eyebrow">${escape(type)}</div>
        <h2>${escape(place.name)}</h2>
        <div class="npc-sub">${escape(country?.name ?? "")}${continent ? ` · ${escape(continent)}` : ""}</div>
      </div>
      <button class="npc-close" data-close aria-label="Close">×</button>
    </div>
    <div class="npc-now">
      <div><span class="npc-label info-label">Population</span>${population.toLocaleString()} inhabitants</div>
      <div><span class="npc-label info-label">Size</span>about ${km(plan.radiusM * 2)} across · ${escape(city ? "stone walls" : "village enclosure")} · ${plan.gates.length} gate${plan.gates.length === 1 ? "" : "s"}</div>
      ${water && water !== "inland" && water !== "dryland-exception" ? `<div><span class="npc-label info-label">Water</span>${water === "coast" ? "On the coast" : "By a freshwater lake"}</div>` : ""}
      ${farmland ? `<div><span class="npc-label info-label">Farmland</span>${escape(farmland)}</div>` : ""}
    </div>
    <section><h3>Notable places</h3>${list(notable)}</section>
    <section><h3>Surroundings</h3>${list(surroundings(place).map(escape))}</section>
    <section><h3>Points of interest nearby</h3>${list(sites.map((site) => `${site.text} <span class="npc-muted">· ${km(site.distance)} ${site.dir}</span>`))}</section>
    <section><h3>Neighbouring settlements</h3>${list(neighbours.map(({ other, distance }) => `${escape(other.name)} <span class="npc-muted">· ${other.kind} · ${km(distance)} ${direction(place.x, place.z, other.x, other.z)}${linked.has(other.id) ? " · road" : ""}</span>`))}</section>`;
  root.hidden = false;
}
