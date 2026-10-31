import { mountNpcPortrait } from "./npc-portrait.ts";
import { nearbyWilderness, type WildernessSite } from "./wilderness.ts";
/**
 * NPC inspector popup: opened by clicking a resident on the map. Shows the
 * seeded identity (picture, name, trade, sex, age, temperament), abilities,
 * personality, current mood and activity, home and workplace by name, and the
 * whole of today's routine with the current step highlighted. It reads only
 * pure SEED + Fantasy Time functions, so it can be refreshed at any moment.
 */
import { continents, countries, places, roadConnections, type Place } from "./geography.ts";
import { greatCircleDistance, lonLatToSource } from "./planet.ts";
import { criticalSites, nearbyCriticalSites } from "./sites.ts";
import { finalSurfaceAt, resolvedSettlementHomeDoorFor, resolvedSettlementHomeFacingFor } from "./world.ts";
import { politicalSettlementSiteById } from "./political-settlement-access.ts";
import { metresToSource } from "./physical-scale.ts";
import { buildingName, familyName, type BuildingKind } from "./names.ts";
import { activityAt, dailyPlan, type Activity } from "./routines.ts";
import { localDayIndex, localSecondOfDay, localWeekday } from "./clock.ts";
import { settlementExteriorFor } from "./settlement-exterior.ts";
import { populationOf, readableResidentRoute, type Resident } from "./simulation.ts";

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
let popupReturnFocus: HTMLElement | null = null;
let currentNpcPoint: { code: string; x: number; z: number } | undefined;
/** What the popup shows: a resident (refreshed with Fantasy Time), a building or a settlement. */
let currentKind: "npc" | "building" | "settlement" | "wilderness" | "" = "";
/** A UI suggestion never mutates a resident. Main Simulation alone responds
 * after evaluating autonomous choice and lawful SEED site/route constraints. */
let siteVisitAdvisor: ((residentCode: string) => Promise<{ started: boolean; message: string }>) | undefined;
let advicePendingCode = "";
let adviceFeedback: { code: string; message: string } = { code: "", message: "" };
export function setSiteVisitAdvisor(callback: typeof siteVisitAdvisor) {
  siteVisitAdvisor = callback;
}


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

/** Camera jump used by clickable place rows (registered by main: centre on the place at Hero zoom). */
// The genuine 1920x1080 screenshot at half-height 2.5 showed the SEED-owned
// doorway as a tiny marker over a ~76 m neighbourhood. Frame ~44 m instead:
// preserve the real front wall, path and adjacent street, with no resident,
// Simulation, route, ownership or 3D geometry changes.
export const HOME_ENTRANCE_FOCUS_HALF_HEIGHT = 1.45;
/** Portrait observation must show the real 1.5–1.8m person clearly, not as a tiny cutout in empty terrain. */
export const RESIDENT_OBSERVE_HALF_HEIGHT = 0.52;
export function residentObservationPoint(resident: Pick<Resident, "grounded" | "indoors" | "position">) {
  return resident.grounded && !resident.indoors
    ? lonLatToSource(resident.position.lon, resident.position.lat) : undefined;
}
export function popupFocusHalfHeight(ref: string, heroHalfHeight: number, viewportHeight = 1920): number {
  // The actual screenshot-tool portrait shows the SEED character head-up but
  // too small to inspect on the ground. Keep the proven landscape footprint
  // while moving portrait observation closer to that same physical position.
  // This is camera magnification only; the resident is never moved or resized.
  const observeHalfHeight = Math.max(.36, Math.min(RESIDENT_OBSERVE_HALF_HEIGHT,
    .75 * viewportHeight / 1920));
  // Landscape has fewer vertical pixels for the same house: tighten only the
  // camera footprint so the owned front door, physical facade and connected
  // street remain legible. Preserve the wider proven portrait composition and
  // never zoom out an already closer Hero view or move the resident.
  const homeHalfHeight = Math.max(.95, Math.min(HOME_ENTRANCE_FOCUS_HALF_HEIGHT,
    HOME_ENTRANCE_FOCUS_HALF_HEIGHT * viewportHeight / 1920));
  return ref.startsWith("home:") ? Math.max(homeHalfHeight, heroHalfHeight)
    : ref.startsWith("resident:") ? observeHalfHeight : heroHalfHeight;
}
/** Keep the exact clicked SEED-owned doorway labelled only while that camera
 * focus is still held. Pure zoom and explicit view tilt preserve the label;
 * panning away or inspecting another resident clears this camera-only state. */
export type OwnedDoorViewPin = { x: number; z: number; y: number; yaw: number; homeEntrance: string };
export function ownedDoorPinAtFocus(
  pin: OwnedDoorViewPin | undefined, x: number, z: number, inspectedCode: string,
  yaw: number, reliefEnabled: boolean,
): OwnedDoorViewPin | undefined {
  // A rotated/top-down angle can hide the door behind its real roof. Do not
  // paint a screen-space tag through an opaque house in that changed view.
  return !inspectedCode && reliefEnabled && pin?.yaw === yaw &&
    pin.x === x && pin.z === z ? pin : undefined;
}

/** Camera-facing-only view of the real front wall; never rotates a resident. */
export function popupOwnedHomeFacing(ref: string): number | undefined {
  const [kind, id, sub] = ref.split(":");
  // Place IDs are SEED identities, not numeric array indexes. Match the
  // canonical resolver: validate only the resident index, then look up the
  // exact settlement identifier rather than rejecting non-numeric IDs.
  if (kind !== "home" || !/^(0|[1-9][0-9]*)$/.test(sub ?? "")) return undefined;
  const place = places.find(entry => String(entry.id) === id), index = Number(sub);
  if (!place || !Number.isSafeInteger(index) || index >= populationOf(place)) return undefined;
  return resolvedSettlementHomeFacingFor(place, index);
}
let goTo: ((x: number, z: number, ref: string) => void) | undefined;
export function setPopupNavigator(navigator: (x: number, z: number, ref: string) => void) { goTo = navigator; }
/**
 * A list row that takes the camera to a place when clicked. The row only carries a reference
 * ("plot:<settlement>:<plot>", "site:<settlement>:<code>", "place:<id>"); the position is worked out
 * on click (resolveGoTarget), so opening a card computes no coordinates.
 */
const goRow = (html: string, ref: string, name: string) =>
  `<button type="button" class="info-go" data-go="${escape(ref)}" title="Go to ${escape(name)}">${html}</button>`;
export function resolveGoTarget(ref: string): { x: number; z: number } | undefined {
  const [kind, id, sub] = ref.split(":"), place = (key: string) => places.find((entry) => String(entry.id) === key);
  if (kind === "place") return place(id);
  const settlement = place(id);
  if (!settlement) return;
  if (kind === "resident") {
    // Only the actually inspected resident may be framed; a URL-like ref
    // cannot synthesize an actor, resolve a new schedule or move Simulation.
    if (!/^(0|[1-9][0-9]*)$/.test(sub ?? "") || !settlement) return;
    return currentNpcPoint?.code === `${settlement.code}/RESIDENT/${sub}`
      ? { x: currentNpcPoint.x, z: currentNpcPoint.z } : undefined;
  }
  if (kind === "home") {
    // Real doorway only, resolved lazily on the player camera-focus action.
    if (!/^(0|[1-9][0-9]*)$/.test(sub ?? "")) return;
    const index = Number(sub);
    if (!Number.isSafeInteger(index) || index >= populationOf(settlement)) return;
    return resolvedSettlementHomeDoorFor(settlement, index) ?? undefined;
  }
  if (kind === "plot") return settlementExteriorFor(settlement).plots.find((plot) => plot.id === sub)?.candidates[0];
  if (kind === "site") return criticalSites.find((site) => site.code === sub)
    ?? nearbyWilderness(settlement.x, settlement.z, metresToSource(8000), 8).find((site) => site.code === sub);
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
    const advice = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-advice-site]");
    if (advice && currentKind === "npc" && currentCode && siteVisitAdvisor && !advicePendingCode) {
      const code = currentCode;
      advicePendingCode = code;
      adviceFeedback = { code, message: "The resident is considering your advice…" };
      advice.disabled = true;
      const status = root?.querySelector<HTMLElement>("#npc-advice-result");
      if (status) status.textContent = adviceFeedback.message;
      void siteVisitAdvisor(code).then(result => {
        adviceFeedback = { code, message: result.message };
      }).catch(() => {
        adviceFeedback = { code, message: "The suggestion could not be checked; no journey was started." };
      }).finally(() => {
        advicePendingCode = "";
        if (currentKind === "npc" && currentCode === code) {
          const button = root?.querySelector<HTMLButtonElement>("[data-advice-site]");
          if (button) button.disabled = false;
          const feedback = root?.querySelector<HTMLElement>("#npc-advice-result");
          if (feedback) feedback.textContent = adviceFeedback.message;
        }
      });
    }
    const go = (event.target as HTMLElement).closest<HTMLElement>("[data-go]"), target = go && goTo ? resolveGoTarget(go.dataset.go ?? "") : undefined;
    if (target) {
      goTo!(target.x, target.z, go!.dataset.go ?? "");
      if (go?.dataset.go?.startsWith("home:")) {
        // On a phone the inspector covers the screen centre where the actual
        // owned doorway is framed. Reveal the real facade after the camera-only
        // jump; hiding this panel neither moves the resident nor changes the
        // Simulation selection, SEED-owned door or roof depth.
        // Existing close behavior returns keyboard focus to the world canvas.
        hideNpcPopup();
      } else if (go?.dataset.go?.startsWith("resident:")) {
        // Resident observation retains its inspector, but not the expanded
        // technical ledger over the selected real-world sprite.
        const technical = root?.querySelector<HTMLDetailsElement>(".npc-technical");
        if (technical) technical.open = false;
        if (root) root.scrollTop = 0;
      }
    }
    const minimize=(event.target as HTMLElement).closest<HTMLButtonElement>("[data-minimize]"),content=root?.querySelector<HTMLElement>("[data-wilderness-content]");
    if(minimize&&content){content.hidden=!content.hidden;minimize.textContent=content.hidden?"+":"−";minimize.setAttribute("aria-expanded",String(!content.hidden));minimize.setAttribute("aria-label",content.hidden?"Restore window":"Minimize window");}
  });
  document.body.append(root);
  addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && root && !root.hidden) {
      event.preventDefault();
      hideNpcPopup();
    }
  });
}

export function npcPopupCode() {
  return root && !root.hidden && currentKind === "npc" ? currentCode : "";
}
export function hideNpcPopup() {
  if (root) {
    root.hidden = true;
    delete root.dataset.canonicalId;
  }
  currentCode = "";
  currentKind = "";
  currentNpcPoint = undefined;
  const opener = popupReturnFocus;
  popupReturnFocus = null;
  // Opening the travel menu may collapse its parent information panel; do
  // not send the keyboard to a CSS-hidden opener. Return to the visible
  // information-panel toggle so the user can reopen Explore without a mouse.
  const visible = opener?.isConnected && !opener.closest("[hidden]") &&
    !!opener.getClientRects().length && getComputedStyle(opener).visibility !== "hidden";
  const target = visible ? opener : opener?.id === "open-travel"
    ? document.getElementById("toggle-region-panel") : document.getElementById("world");
  target?.focus({ preventScroll: true });
}

/** Open (or refresh) the popup for a resident at a simulation tick. */
export function showNpcPopup(resident: Resident, tick: number) {
  install();
  if (!root) return;
  const sameResident = currentKind === "npc" && currentCode === resident.code;
  const technicalOpen = sameResident && !!root.querySelector<HTMLDetailsElement>(".npc-technical")?.open;
  const secondaryOpen = sameResident && !!root.querySelector<HTMLDetailsElement>(".npc-secondary")?.open;
  const previousScroll = sameResident ? root.scrollTop : 0;
  // Fantasy-time refresh rebuilds the markup: keep the reader's focused control.
  const active = sameResident && root.contains(document.activeElement) ? document.activeElement : null;
  const focusSelector = active?.matches(".npc-technical summary") ? ".npc-technical summary"
    : active?.matches(".npc-secondary summary") ? ".npc-secondary summary"
    : active?.matches('[data-go^="home:"]') ? '[data-go^="home:"]'
    : active?.matches('[data-go^="resident:"]') ? '[data-go^="resident:"]'
    : active?.matches("[data-advice-site]") ? "[data-advice-site]"
    : active?.matches("[data-close]") ? "[data-close]" : "";
  currentCode = resident.code;
  currentKind = "npc";
  const observation = residentObservationPoint(resident);
  currentNpcPoint = observation ? { code: resident.code, ...observation } : undefined;
  const t = resident.traits, names = anchorNames(resident), lon = placeOf(resident)?.canonicalPosition.lon ?? 0, second = localSecondOfDay(tick, lon), day = localDayIndex(tick, lon), weekday = localWeekday(tick, lon),
    plan = dailyPlan({ code: resident.code, role: resident.role, ageGroup: resident.ageGroup, guardShift: resident.guardShift }, t, day, weekday),
    { index } = activityAt(plan, second),
    where = (activity: Activity) => names[activity.anchor] ?? activity.anchor,
    ageYears = Math.floor(resident.birthDay / 365),
    moodHue = resident.mood.value > .15 ? "#7fc77a" : resident.mood.value > -.15 ? "#d8b979" : "#d0705a";
  root.innerHTML = `
    <div class="npc-head">
      <div data-npc-portrait></div>
      <div>
        <div class="eyebrow">${escape(names.settlement ?? "")} · resident</div>
        <h2>${escape(resident.name)}</h2>
        <div class="npc-sub">${escape(resident.role.replaceAll("-", " "))} · ${resident.sex} · ${ageYears} years (${resident.ageGroup}) · ${escape(t.temperament)}</div>
      </div>
      <button class="npc-close" data-close aria-label="Close character">×</button>
    </div>
    <div class="npc-now">
      <div><span class="npc-label">Now</span><b id="npc-current-task">${escape(resident.task)}</b> <span class="npc-muted">· ${resident.indoors ? "indoors" : "outdoors"}</span></div>
      ${observation ? `<div class="npc-observe">${goRow("Observe resident at true scale · camera only", `resident:${resident.settlement}:${resident.index}`, "physical resident")}</div>` : ""}
      <div class="npc-observe">
        <button type="button" class="info-go" data-advice-site
          ${!resident.grounded || resident.indoors || resident.route.startsWith("HOME:") ||
            advicePendingCode === resident.code ? "disabled" : ""}>
          ${resident.route.startsWith("ARRIVED:")
            ? "Suggest returning to owned home · resident decides"
            : resident.route.startsWith("SITE VISIT:")
              ? "Ask to return before site arrival · resident decides"
            : resident.route.startsWith("HOME RETURN:")
              ? "Returning to owned home on verified streets"
              : resident.route.startsWith("HOME:")
                ? "Resident reached their owned home"
                : "Suggest a site visit · resident decides"}
        </button>
        <div id="npc-advice-result" class="npc-muted" role="status" aria-live="polite">
          ${escape(adviceFeedback.code === resident.code ? adviceFeedback.message : "")}
        </div>
      </div>
      <div><span class="npc-label">Route</span><span id="npc-route">${escape(readableResidentRoute(resident.route))}</span></div>
      ${resident.travelProgress !== undefined
        ? `<div><span class="npc-label">Progress</span>${bar(resident.travelProgress, 1, "#8fd18a")} <b>${Math.round(resident.travelProgress * 100)}%</b> <span class="npc-muted">of ${Math.round(resident.travelDistanceM ?? 0)} m along the streets</span></div>`
        : ""}
      <div><span class="npc-label">Step</span>${bar(resident.activityProgress, 1, "#d8b979")} <b>${Math.round(resident.activityProgress * 100)}%</b> <span class="npc-muted">${clock(resident.activityStart)}–${clock(resident.activityEnd % 86400)}</span></div>
      <div><span class="npc-label">Mood</span><b style="color:${moodHue}">${escape(resident.mood.label)}</b> ${bar(resident.mood.value + 1, 2, moodHue)}</div>
      <div><span class="npc-label">Home</span>${escape(names.home ?? "")}
        ${resident.grounded
          ? goRow("Show entrance on map", `home:${resident.settlement}:${resident.index}`, "owned home entrance (camera only)")
          : '<span class="npc-muted">· No legally resolved entrance</span>'}</div>
      <div><span class="npc-label">Work</span>${escape(names.work ?? resident.workplace)}</div>
    </div>
    <details class="npc-technical"${technicalOpen ? " open" : ""}>
      <summary>Canonical SEED journey details</summary>
      <div><span class="npc-label">Resident</span><code id="npc-seed-code" class="npc-code">${escape(resident.code)}</code></div>
      <div><span class="npc-label">Home entrance</span><code id="npc-home-entrance" class="npc-code">${escape(resident.homeEntrance)}</code></div>
      <div><span class="npc-label">Workplace</span><code id="npc-workplace-code" class="npc-code">${escape(resident.workplace)}</code></div>
      <div><span class="npc-label">Actual route</span><code id="npc-route-code" class="npc-code">${escape(resident.route)}</code></div>
    </details>
    <details class="npc-secondary"${secondaryOpen ? " open" : ""}>
      <summary>Abilities, personality & today's routine</summary>
    <div class="npc-columns">
      <section><h3>Abilities</h3>${ABILITY_LABELS.map(([key, label]) => `<div class="npc-row"><span>${label}</span>${bar(t.abilities[key], 18, "#d8b979")}<b>${t.abilities[key]}</b></div>`).join("")}</section>
      <section><h3>Personality</h3>${PERSONALITY_LABELS.map(([key, label]) => `<div class="npc-row"><span>${label}</span>${bar(t.personality[key], 1, "#8fb3c9")}<b>${Math.round(t.personality[key] * 100)}</b></div>`).join("")}</section>
    </div>
    <section class="npc-routine"><h3>Today's routine · ${WEEKDAYS[weekday]}</h3>
      <ol>${plan.map((activity, i) => `<li class="${i === index ? "current" : i < index ? "past" : ""}"><time>${clock(activity.start)}</time><span>${escape(activity.task)}${i === index ? ` · ${Math.round(resident.activityProgress * 100)}%` : i < index ? " · done" : ""}</span><em>${escape(where(activity))}</em></li>`).join("")}</ol>
    </section>
    </details>`;
  root.hidden = false;
  mountNpcPortrait(root.querySelector<HTMLElement>("[data-npc-portrait]")!, resident.character, resident.name);
  root.scrollTop = previousScroll;
  if (focusSelector) root.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
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
export function showBuildingPopup(info: BuildingInfo, settlement: Place | undefined, owner: Pick<Resident, "name" | "role"> | undefined, inside: readonly Resident[]) {
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
export function showSettlementPopup(place: Place, population: number, returnFocus?: HTMLElement) {
  install();
  if (!root) return;
  currentCode = place.code;
  currentKind = "settlement";
  root.dataset.canonicalId = place.id;
  root.setAttribute("aria-label", `${place.name} settlement inspection`);
  popupReturnFocus = returnFocus ?? null;
  const plan = settlementExteriorFor(place), city = place.kind === "city",
    country = countries.find((entry) => entry.continent === place.continent && entry.id === place.country),
    continent = continents[place.continent]?.name ?? "",
    type = (SETTLEMENT_TYPE[plan.archetype] ?? ["City", "Village"])[city ? 0 : 1],
    water = politicalSettlementSiteById.get(place.id)?.waterContext,
    named = (plot: (typeof plan.plots)[number]) => buildingName((plot.kind === "service" ? plot.service : plot.kind) as BuildingKind, plot.id, place.name, place.continent, plot.ownerId ? familyName(plot.ownerId, place.continent) : undefined, city),
    notable = plan.plots.filter((plot) => plot.kind === "service" || plot.kind === "keep" || plot.kind === "well")
      .map((plot) => goRow(`${named(plot)} <span class="npc-muted">· ${plot.kind === "service" ? (SERVICE_TITLE[plot.service ?? ""] ?? "workshop").toLowerCase() : plot.kind}</span>`, `plot:${place.id}:${plot.id}`, named(plot))),
    fields = plan.plots.filter((plot) => plot.kind === "field"),
    farmland = fields.length ? `${fields.length} fields (${[...new Set(fields.map((field) => field.fieldForm))].join(", ")}) around the walls` : "",
    sites = [...nearbyCriticalSites(place.x, place.z, metresToSource(40_000), 6), ...nearbyWilderness(place.x,place.z,metresToSource(8000),8).map(site=>({...site,archetype:site.kind}))].map((site) => ({
      text: `${site.name} <span class="npc-muted">· ${site.kind === "ruin" ? "ruins" : site.archetype.replace("-", " ")}</span>`,
      distance: greatCircleDistance(place.canonicalPosition, site.canonicalPosition), dir: direction(place.x, place.z, site.x, site.z), ref: `site:${place.id}:${site.code}`, name: site.name,
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
    <section><h3>Points of interest nearby</h3>${list(sites.map((site) => goRow(`${site.text} <span class="npc-muted">· ${km(site.distance)} ${site.dir}</span>`, site.ref, site.name)))}</section>
    <section><h3>Neighbouring settlements</h3>${list(neighbours.map(({ other, distance }) => goRow(`${escape(other.name)} <span class="npc-muted">· ${other.kind} · ${km(distance)} ${direction(place.x, place.z, other.x, other.z)}${linked.has(other.id) ? " · road" : ""}</span>`, `place:${other.id}`, other.name)))}</section>`;
  root.hidden = false;
  if (returnFocus) root.querySelector<HTMLButtonElement>("[data-close]")?.focus({ preventScroll: true });
}


export function showWildernessPopup(site: WildernessSite) {
  install();if(!root)return;currentCode=site.code;currentKind="wilderness";
  root.setAttribute("aria-label",site.name);
  root.innerHTML=`<div class="npc-head info-head"><div><div class="eyebrow">${escape(site.kind.replaceAll("-"," "))}</div><h2>${escape(site.name)}</h2></div><button class="npc-close" data-minimize aria-label="Minimize window" aria-expanded="true">−</button><button class="npc-close" data-close aria-label="Close">×</button></div><section data-wilderness-content><p>${escape(site.description)}</p><p class="npc-muted">Elevation ${Math.round(site.canonicalPosition.elevation)} m</p></section>`;
  root.hidden=false;
}
