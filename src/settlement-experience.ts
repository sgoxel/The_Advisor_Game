import "./settlement-experience.css";
import { nearestPlace, places } from "./geography.ts";
import { InteriorRuntime, type InteriorLayout } from "./interiors.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT } from "./planet.ts";
import {
  settlementBuilding,
  settlementPlan,
  type BuildingUse,
  type SettlementBuilding,
} from "./settlements.ts";

type AdvisorWorld = {
  state: {
    ready: boolean;
    settled: boolean;
    presentation: string;
    view: { x: number; z: number; halfHeight: number };
  };
  setHalfHeight(height: number): void;
  navigation: { setFocus(lon: number, lat: number): void };
};

type AdvisorWindow = Window &
  typeof globalThis & {
    advisorWorld?: AdvisorWorld;
    advisorSettlements?: unknown;
  };

const windowWithAdvisor = window as AdvisorWindow;
const runtime = new InteriorRuntime(2);
const roleLabel: Record<BuildingUse, string> = {
  home: "Home",
  inn: "Inn",
  market: "Market",
  blacksmith: "Blacksmith",
  farmstead: "Farmstead",
  barn: "Barn",
  butcher: "Butcher",
  "guard-office": "Guard office",
  "guard-post": "Gate post",
  well: "Well",
};
const ENTERABLE = new Set<BuildingUse>([
  "home",
  "inn",
  "market",
  "blacksmith",
  "farmstead",
  "barn",
  "butcher",
  "guard-office",
]);

let activePlaceId = "";
let selectedBuildingCode = "";
let activeLayout: InteriorLayout | undefined;
let selectedRoomCode = "";
let lastSignatures = new Map<string, string>();
let stableReentries = 0;
let unstableReentries = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const inspector = element("aside");
inspector.id = "settlement-inspector";
inspector.hidden = true;
inspector.setAttribute("aria-label", "Settlement building inspector");
inspector.innerHTML = `
  <div class="settlement-inspector-head">
    <div>
      <div class="eyebrow">LIVING SETTLEMENT</div>
      <h2 id="settlement-inspector-name"></h2>
    </div>
  </div>
  <p class="settlement-summary" id="settlement-inspector-summary"></p>
  <div class="settlement-building-strip" id="settlement-building-strip" role="list" aria-label="Inspectable buildings"></div>
  <section class="settlement-selection" id="settlement-selection"></section>
`;
document.body.append(inspector);

const interior = element("section");
interior.id = "interior-experience";
interior.hidden = true;
interior.setAttribute("aria-label", "Building interior");
interior.innerHTML = `
  <div class="interior-world">
    <div class="interior-compass">INTERIOR · ORTHOGRAPHIC PLAN</div>
    <div class="interior-floor-wrap"><div class="interior-floor" id="interior-floor"></div></div>
  </div>
  <aside class="interior-panel">
    <div class="eyebrow">PROTAGONIST INTERIOR</div>
    <h2 id="interior-title"></h2>
    <p class="interior-meta" id="interior-meta"></p>
    <div class="interior-room-detail" id="interior-room-detail"></div>
    <div class="interior-actions">
      <button type="button" class="use-fixture" id="interior-use">Use fixture</button>
      <button type="button" id="interior-exit">Exit &amp; unload</button>
    </div>
    <output class="interior-status" id="interior-status" aria-live="polite"></output>
    <div class="interior-cache" id="interior-cache"></div>
  </aside>
`;
document.body.append(interior);

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function nearestHome(placeId: string, x: number, z: number) {
  return settlementPlan(placeId).buildings
    .filter((building) => building.use === "home")
    .sort(
      (a, b) =>
        Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z),
    )[0];
}

function visibleChoices(placeId: string, x: number, z: number) {
  const plan = settlementPlan(placeId),
    services = plan.buildings.filter(
      (building) =>
        building.use !== "home" && building.use !== "guard-post",
    ),
    home = nearestHome(placeId, x, z);
  return [...services, ...(home ? [home] : [])];
}

function selectedBuilding(placeId: string, x: number, z: number) {
  const selected = selectedBuildingCode
    ? settlementBuilding(selectedBuildingCode)
    : undefined;
  if (selected?.placeId === placeId) return selected;
  const choices = visibleChoices(placeId, x, z),
    defaultBuilding =
      choices.find((building) => building.use === "inn") ?? choices[0];
  selectedBuildingCode = defaultBuilding?.code ?? "";
  return defaultBuilding;
}

function focusBuilding(building: SettlementBuilding) {
  const advisor = windowWithAdvisor.advisorWorld;
  if (!advisor) return;
  advisor.navigation.setFocus(building.entrance.lon, building.entrance.lat);
  advisor.setHalfHeight(55);
}

function selectionMarkup(building: SettlementBuilding) {
  const enterable = ENTERABLE.has(building.use),
    rooms = building.rooms.join(" · ");
  return `
    <strong>${roleLabel[building.use]}</strong>
    <small>${Math.round(building.widthM)} × ${Math.round(building.depthM)} m · ${Math.round(building.heightM)} m high · entrance-connected plot</small>
    <small>${rooms || "Exterior utility"}</small>
    <div class="settlement-actions">
      <button type="button" class="focus-building">Focus entrance</button>
      <button type="button" class="enter-building" ${enterable ? "" : "disabled"}>${enterable ? "Enter building" : "Exterior only"}</button>
    </div>
  `;
}

function renderInspector() {
  const advisor = windowWithAdvisor.advisorWorld;
  if (!advisor?.state.ready || advisor.state.presentation !== "flat") {
    inspector.hidden = true;
    return;
  }
  const { x, z, halfHeight } = advisor.state.view,
    place = nearestPlace(x, z);
  if (!place || halfHeight > 310) {
    inspector.hidden = true;
    return;
  }
  const plan = settlementPlan(place.id),
    sourceRadius = plan.site.envelopeRadiusM / CANONICAL_METRES_PER_SOURCE_UNIT,
    near = Math.hypot(place.x - x, place.z - z) <= sourceRadius + 12;
  if (!near || !plan.buildings.length) {
    inspector.hidden = true;
    return;
  }
  inspector.hidden = false;
  activePlaceId = place.id;
  byId("settlement-inspector-name").textContent = place.name;
  byId("settlement-inspector-summary").textContent =
    `${plan.archetype.replace("-", " ")} · ${plan.population} residents · ${plan.buildings.length} canonical buildings · ${plan.gates.length} gate${plan.gates.length === 1 ? "" : "s"}`;

  const choices = visibleChoices(place.id, x, z),
    building = selectedBuilding(place.id, x, z),
    strip = byId("settlement-building-strip");
  strip.replaceChildren();
  for (const choice of choices) {
    const button = element("button");
    button.type = "button";
    button.setAttribute("role", "listitem");
    button.setAttribute(
      "aria-pressed",
      String(choice.code === building?.code),
    );
    button.textContent = roleLabel[choice.use];
    button.onclick = () => {
      selectedBuildingCode = choice.code;
      renderInspector();
    };
    strip.append(button);
  }
  const selection = byId("settlement-selection");
  if (!building) {
    selection.textContent = "No inspectable building is available here.";
    return;
  }
  selection.innerHTML = selectionMarkup(building);
  selection.querySelector<HTMLButtonElement>(".focus-building")!.onclick = () =>
    focusBuilding(building);
  selection.querySelector<HTMLButtonElement>(".enter-building")!.onclick = () =>
    enterInterior(building.code);
}

function roomForCode(layout: InteriorLayout, code: string) {
  return layout.rooms.find((room) => room.code === code) ?? layout.rooms[0];
}

function renderRoomDetail(layout: InteriorLayout) {
  const room = roomForCode(layout, selectedRoomCode),
    index = layout.rooms.indexOf(room),
    anchor = layout.anchors[index],
    detail = byId("interior-room-detail");
  selectedRoomCode = room.code;
  detail.innerHTML = `
    <strong>${room.use}</strong>
    <p>${Math.round(room.widthM * 10) / 10} × ${Math.round(room.depthM * 10) / 10} m · ${anchor ? `usable ${anchor.use.replaceAll("-", " ")}` : "walkable room"}</p>
  `;
  byId<HTMLButtonElement>("interior-use").textContent = anchor
    ? `Use ${anchor.use.replaceAll("-", " ")}`
    : "Inspect room";
  for (const node of Array.from(
    byId("interior-floor").querySelectorAll<HTMLButtonElement>(".interior-room"),
  ))
    node.setAttribute("aria-pressed", String(node.dataset.code === room.code));
}

function renderInterior(layout: InteriorLayout, building: SettlementBuilding) {
  activeLayout = layout;
  selectedRoomCode = layout.rooms[0]?.code ?? "";
  inspector.hidden = true;
  interior.hidden = false;
  document.body.classList.add("interior-mode");
  byId("interior-title").textContent = roleLabel[building.use];
  byId("interior-meta").textContent =
    `${Math.round(building.widthM)} × ${Math.round(building.depthM)} m canonical footprint · ${layout.rooms.length} functional room${layout.rooms.length === 1 ? "" : "s"}`;

  const floor = byId("interior-floor");
  floor.replaceChildren();
  const shell = element("div", "interior-shell");
  floor.append(shell);
  for (const room of layout.rooms) {
    const button = element("button", "interior-room"),
      left = ((room.x - room.widthM / 2 + layout.widthM / 2) / layout.widthM) * 100,
      top = ((room.z - room.depthM / 2 + layout.depthM / 2) / layout.depthM) * 100,
      width = (room.widthM / layout.widthM) * 100,
      height = (room.depthM / layout.depthM) * 100;
    button.type = "button";
    button.dataset.code = room.code;
    button.style.left = `${left}%`;
    button.style.top = `${top}%`;
    button.style.width = `${width}%`;
    button.style.height = `${height}%`;
    button.setAttribute("aria-label", `Inspect ${room.use}`);
    button.setAttribute("aria-pressed", "false");
    const label = element("span");
    label.textContent = room.use;
    button.append(label);
    button.onclick = () => {
      selectedRoomCode = room.code;
      renderRoomDetail(layout);
    };
    floor.append(button);
  }
  for (const anchor of layout.anchors) {
    const marker = element("i", "interior-fixture");
    marker.title = anchor.use;
    marker.style.left = `${((anchor.x + layout.widthM / 2) / layout.widthM) * 100}%`;
    marker.style.top = `${((anchor.z + layout.depthM / 2) / layout.depthM) * 100}%`;
    floor.append(marker);
  }
  floor.append(element("i", "interior-entry"));
  renderRoomDetail(layout);
  byId("interior-status").textContent =
    "Interior realized only because the protagonist entered this building.";
  updateCacheLabel();
}

function updateCacheLabel() {
  const stats = runtime.stats;
  byId("interior-cache").textContent =
    `Interior residency ${stats.realized}/${stats.maxRealized} · materialized ${stats.materializations} · evicted ${stats.evictions} · stable re-entries ${stableReentries}`;
}

function enterInterior(code: string) {
  const building = settlementBuilding(code);
  if (!building || !ENTERABLE.has(building.use)) return undefined;
  const layout = runtime.enter(code),
    prior = lastSignatures.get(code);
  if (prior) {
    if (prior === layout.signature) stableReentries++;
    else unstableReentries++;
  }
  lastSignatures.set(code, layout.signature);
  selectedBuildingCode = code;
  renderInterior(layout, building);
  return layout;
}

function exitInterior() {
  const code = runtime.activeBuildingCode;
  runtime.exit();
  if (code) runtime.evict(code);
  activeLayout = undefined;
  selectedRoomCode = "";
  interior.hidden = true;
  document.body.classList.remove("interior-mode");
  renderInspector();
  return runtime.stats;
}

byId("interior-exit").onclick = () => exitInterior();
byId("interior-use").onclick = () => {
  if (!activeLayout) return;
  const room = roomForCode(activeLayout, selectedRoomCode),
    index = activeLayout.rooms.indexOf(room),
    anchor = activeLayout.anchors[index];
  byId("interior-status").textContent = anchor
    ? `Used ${anchor.use.replaceAll("-", " ")} in ${room.use}. The interaction target is the same canonical fixture on every re-entry.`
    : `Inspected ${room.use}.`;
  updateCacheLabel();
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !interior.hidden) exitInterior();
});

windowWithAdvisor.advisorSettlements = {
  plan(placeId: string) {
    return settlementPlan(placeId);
  },
  nearest() {
    const advisor = windowWithAdvisor.advisorWorld;
    if (!advisor) return null;
    const place = nearestPlace(advisor.state.view.x, advisor.state.view.z);
    return place ? settlementPlan(place.id) : null;
  },
  focus(placeId: string, use: BuildingUse = "inn") {
    const place = places.find((candidate) => candidate.id === placeId);
    if (!place) throw new RangeError(`Unknown settlement ${placeId}`);
    const building =
      settlementPlan(placeId).buildings.find((candidate) => candidate.use === use) ??
      settlementPlan(placeId).buildings[0];
    selectedBuildingCode = building.code;
    focusBuilding(building);
    return building;
  },
  select(buildingCode: string) {
    const building = settlementBuilding(buildingCode);
    if (!building) throw new RangeError(`Unknown building ${buildingCode}`);
    selectedBuildingCode = buildingCode;
    return building;
  },
  enter(buildingCode: string) {
    return enterInterior(buildingCode);
  },
  exit() {
    return exitInterior();
  },
  get state() {
    return {
      activePlaceId,
      selectedBuildingCode,
      activeInterior: activeLayout?.buildingCode ?? null,
      selectedRoomCode,
      stableReentries,
      unstableReentries,
      interior: runtime.stats,
    };
  },
};

setInterval(renderInspector, 350);
