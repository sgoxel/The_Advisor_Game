/**
 * NPC inspector popup: opened by clicking a resident on the map. Shows the
 * seeded identity (picture, name, trade, sex, age, temperament), abilities,
 * personality, current mood and activity, home and workplace by name, and the
 * whole of today's routine with the current step highlighted. It reads only
 * pure SEED + Fantasy Time functions, so it can be refreshed at any moment.
 */
import { places } from "./geography.ts";
import { buildingName, familyName, type BuildingKind } from "./names.ts";
import { activityAt, dailyPlan, type Activity } from "./routines.ts";
import { fantasyDayIndex, fantasySecondOfDay, fantasyWeekday } from "./clock.ts";
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
  return root && !root.hidden ? currentCode : "";
}
export function hideNpcPopup() {
  if (root) root.hidden = true;
  currentCode = "";
}

/** Open (or refresh) the popup for a resident at a simulation tick. */
export function showNpcPopup(resident: Resident, tick: number) {
  install();
  if (!root) return;
  currentCode = resident.code;
  const t = resident.traits, names = anchorNames(resident), second = fantasySecondOfDay(tick), day = fantasyDayIndex(tick), weekday = fantasyWeekday(tick),
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
