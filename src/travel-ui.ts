import "./travel-ui.css";
import { roads, villages } from "./geography.ts";
import { distanceLabel } from "./navigation.ts";
import {
  enuToPosition,
  halfHeightForCanonicalFootprint,
  positionToEnu,
  type CanonicalPosition,
} from "./planet.ts";
import { HANDOFF_LOCAL_FOOTPRINT } from "./handoff.ts";
import { activeRouteId, setActiveRoute } from "./route-overlay.ts";
import { neighbouringVillages, routeBetweenVillages, type VillageRoute } from "./village-routes.ts";
import {
  DIFFICULT_TERRAIN_WALK_SPEED_MPS,
  OPEN_GROUND_WALK_SPEED_MPS,
  fantasyDurationLabel,
  realDurationLabel,
  travelMetrics,
} from "./travel.ts";

const villageSelect = document.getElementById("village-select") as HTMLSelectElement;
const summary = document.getElementById("travel-summary") as HTMLParagraphElement;
const travelPanel = document.getElementById("travel-panel") as HTMLElement;
const routeList = document.getElementById("route-list") as HTMLUListElement | null;
const routeDetail = document.getElementById("route-detail") as HTMLParagraphElement | null;
const routeClear = document.getElementById("route-clear") as HTMLButtonElement | null;

let routeToken = 0;
let routeOrigin = "";
let selectedRouteKey = "";

const routeKey = (from: string, to: string) => `${from}>${to}`;

function hoursMinutes(seconds: number): string {
  const total = Math.round(seconds / 60),
    h = Math.floor(total / 60),
    m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function routeMeta(route: VillageRoute): string {
  return (
    `${distanceLabel(route.distanceM)} · ${hoursMinutes(route.fantasySeconds)} fantasy · ` +
    `${realDurationLabel(route.realSeconds)} at 24×`
  );
}

function surfaceShare(route: VillageRoute, key: keyof VillageRoute["surfaceM"]): string {
  return `${Math.round((route.surfaceM[key] / Math.max(1, route.distanceM)) * 100)}%`;
}

function routeDetailText(fromName: string, toName: string, route: VillageRoute): string {
  const extra = route.fantasySeconds / route.straightLineFantasySeconds - 1;
  return (
    `${fromName} → ${toName}: ${distanceLabel(route.distanceM)} on foot ` +
    `(straight line ${distanceLabel(route.geodesicM)}), ${hoursMinutes(route.fantasySeconds)} fantasy time. ` +
    `Road ${surfaceShare(route, "road")} · open ground ${surfaceShare(route, "open")} · ` +
    `difficult ${surfaceShare(route, "difficult")}` +
    (route.surfaceM.bridge > 0 ? ` · bridge ${surfaceShare(route, "bridge")}` : "") +
    `. Terrain adds ${Math.max(0, Math.round(extra * 100))}% over the fastest possible straight walk; ` +
    `the 60-minute village minimum holds.`
  );
}

/**
 * Largest axis-aligned screen rectangle not covered by any panel, the masthead, bottom bar or
 * map controls (coarse 32x32 occupancy grid, maximal-rectangle search; presentation only).
 */
function freeViewport() {
  const cols = 32,
    rows = 32,
    cw = innerWidth / cols,
    rh = innerHeight / rows;
  const obstacles = [
    "masthead",
    "region-panel",
    "cell-panel",
    "travel-panel",
    "bottom-bar",
    "map-controls",
    "telemetry",
    "focus-coordinates",
  ]
    .flatMap((name) => Array.from(document.querySelectorAll<HTMLElement>(`#${name},.${name}`)))
    .filter((node) => !node.hidden && getComputedStyle(node).display !== "none")
    .map((node) => node.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  const free: boolean[][] = Array.from({ length: rows }, (_, j) =>
    Array.from({ length: cols }, (_, i) => {
      const x0 = i * cw,
        y0 = j * rh;
      return !obstacles.some(
        (r) => r.left < x0 + cw - 1 && r.right > x0 + 1 && r.top < y0 + rh - 1 && r.bottom > y0 + 1,
      );
    }),
  );
  let best = { i: 0, j: 0, w: cols, h: rows, area: 0 };
  const heights = new Array<number>(cols).fill(0);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) heights[i] = free[j][i] ? heights[i] + 1 : 0;
    for (let i = 0; i < cols; i++) {
      let minH = Infinity;
      for (let k = i; k < cols && heights[k] > 0; k++) {
        minH = Math.min(minH, heights[k]);
        const area = (k - i + 1) * minH;
        if (area > best.area) best = { i, j: j - minH + 1, w: k - i + 1, h: minH, area };
      }
    }
  }
  if (!best.area) return { x: 0, y: 0, w: innerWidth, h: innerHeight };
  const inset = 8;
  return {
    x: best.i * cw + inset,
    y: best.j * rh + inset,
    w: Math.max(80, best.w * cw - 2 * inset),
    h: Math.max(80, best.h * rh - 2 * inset),
  };
}

type FrameWorld = {
  setHalfHeight(height: number): void;
  navigation: {
    surfaceAtScreen(x: number, y: number): { lon: number; lat: number } | undefined;
    setFocus(lon: number, lat: number): void;
  };
  state: {
    ready: boolean;
    navigation: { focus: { lon: number; lat: number } };
    handoff: { projectionTransition: number; desiredTransition: number; active: boolean };
  };
};

let frameToken = 0;
let framing = false;

/**
 * Moves the focus so the point under the middle of the free screen area becomes
 * `target`. Called once straight away and, for views that hand off to the globe,
 * again once the projection has settled (the first pass sees the flat camera).
 */
function shiftFocusTowards(world: FrameWorld, free: { x: number; y: number; w: number; h: number }, target: CanonicalPosition) {
  const seen = world.navigation.surfaceAtScreen(free.x + free.w / 2, free.y + free.h / 2);
  if (!seen) return;
  const current = world.state.navigation.focus,
    base: CanonicalPosition = { ...current, elevation: 0 },
    offset = positionToEnu({ ...seen, elevation: 0 }, { ...target, elevation: 0 }),
    shifted = enuToPosition({ east: -offset.east, north: -offset.north, up: 0 }, base);
  world.navigation.setFocus(shifted.lon, shifted.lat);
}

/** Fit a route into the uncovered part of the screen, whatever the current yaw. */
function frameRoute(route: VillageRoute) {
  const world = (window as unknown as { advisorWorld?: FrameWorld }).advisorWorld;
  if (!world || route.points.length < 2) return;
  const origin: CanonicalPosition = { ...route.points[0], elevation: 0 },
    local = route.points.map((p) => positionToEnu({ ...p, elevation: 0 }, origin));
  const east = local.map((p) => p.east),
    north = local.map((p) => p.north),
    midE = (Math.min(...east) + Math.max(...east)) / 2,
    midN = (Math.min(...north) + Math.max(...north)) / 2,
    diag = Math.hypot(Math.max(...east) - Math.min(...east), Math.max(...north) - Math.min(...north)),
    free = freeViewport(),
    fit = Math.max(120, Math.min(free.w, free.h)),
    wanted = Math.max(900, (diag * 1.2 * innerHeight) / fit),
    // Stay in the sharp flat view when the route still fits the screen there; the
    // half-way globe blend is not a reliable place to frame a route.
    flatLimit = HANDOFF_LOCAL_FOOTPRINT * 0.98,
    footprint =
      wanted > flatLimit && (diag * innerHeight) / flatLimit <= 0.95 * Math.min(innerWidth, innerHeight)
        ? flatLimit
        : wanted,
    centre = enuToPosition({ east: midE, north: midN, up: 0 }, origin),
    token = ++frameToken;
  world.navigation.setFocus(centre.lon, centre.lat);
  world.setHalfHeight(halfHeightForCanonicalFootprint(footprint));
  shiftFocusTowards(world, free, { ...centre, elevation: 0 });
  // Long routes hand off towards the globe, which takes a while to prepare. Re-centre
  // once the projection has settled so the framing matches what is finally on screen.
  const h = world.state.handoff;
  framing = h.desiredTransition > 0.001 || h.projectionTransition > 0.001;
  if (!framing) return;
  const started = Date.now();
  let passes = 0;
  const poll = () => {
    if (token !== frameToken) return;
    const state = world.state.handoff;
    if (Date.now() - started > 120_000) framing = false;
    else if (!state.active && Math.abs(state.projectionTransition - state.desiredTransition) < 0.002) {
      shiftFocusTowards(world, freeViewport(), { ...centre, elevation: 0 });
      if (++passes < 2) setTimeout(poll, 1500);
      else framing = false;
    } else setTimeout(poll, 250);
  };
  setTimeout(poll, 250);
}

function clearRoute() {
  frameToken++;
  framing = false;
  selectedRouteKey = "";
  setActiveRoute(null);
  if (routeClear) routeClear.hidden = true;
  if (routeDetail) routeDetail.textContent = "";
  routeList?.querySelectorAll<HTMLElement>(".route-row").forEach((row) => row.setAttribute("aria-pressed", "false"));
}

function selectRoute(fromId: string, toId: string, frame = true) {
  const from = villages.find((v) => v.id === fromId),
    to = villages.find((v) => v.id === toId);
  if (!from || !to) return;
  const route = routeBetweenVillages(fromId, toId);
  if (!route.found) {
    if (routeDetail) routeDetail.textContent = `${from.name} → ${to.name}: no legal walking route exists.`;
    return;
  }
  selectedRouteKey = routeKey(fromId, toId);
  setActiveRoute(
    route.points,
    `${from.name} → ${to.name}\n${distanceLabel(route.distanceM)} · ${hoursMinutes(route.fantasySeconds)}`,
    selectedRouteKey,
  );
  if (routeClear) routeClear.hidden = false;
  if (routeDetail) routeDetail.textContent = routeDetailText(from.name, to.name, route);
  routeList?.querySelectorAll<HTMLElement>(".route-row").forEach((row) =>
    row.setAttribute("aria-pressed", String(row.dataset.to === toId)),
  );
  // On phones the panel covers the whole map: close it, the map tag keeps distance and time.
  if (frame && innerWidth <= 700 && travelPanel) travelPanel.hidden = true;
  if (frame) frameRoute(route);
}

function renderRoutes(selectedId: string | undefined) {
  if (!routeList) return;
  const token = ++routeToken;
  if (selectedId !== routeOrigin) {
    clearRoute();
    routeOrigin = selectedId ?? "";
  }
  routeList.replaceChildren();
  if (!selectedId) return;
  const neighbours = neighbouringVillages(selectedId);
  const rows = neighbours.map(({ place }) => {
    const item = document.createElement("li"),
      row = document.createElement("button");
    row.type = "button";
    row.className = "route-row";
    row.dataset.to = place.id;
    row.dataset.state = "pending";
    row.setAttribute("aria-pressed", String(selectedRouteKey === routeKey(selectedId, place.id)));
    const name = document.createElement("span"),
      meta = document.createElement("span");
    name.className = "route-name";
    name.textContent = place.name;
    meta.className = "route-meta";
    meta.textContent = "Calculating route…";
    row.append(name, meta);
    row.addEventListener("click", () => {
      if (selectedRouteKey === routeKey(selectedId, place.id)) clearRoute();
      else selectRoute(selectedId, place.id);
    });
    item.append(row);
    routeList.append(item);
    return { row, meta, place };
  });
  // Routes are solved one at a time off the click path and cached per village pair.
  const solve = (k: number) => {
    if (token !== routeToken || k >= rows.length) return;
    const { row, meta, place } = rows[k],
      route = routeBetweenVillages(selectedId, place.id);
    row.dataset.state = route.found ? "ready" : "blocked";
    if (route.found) {
      meta.textContent = routeMeta(route);
      row.dataset.distanceM = String(route.distanceM);
      row.dataset.fantasySeconds = String(route.fantasySeconds);
      row.dataset.realSeconds = String(route.realSeconds);
      row.dataset.detour = route.detourFactor.toFixed(3);
    } else meta.textContent = "No legal walking route";
    setTimeout(() => solve(k + 1), 0);
  };
  setTimeout(() => solve(0), 0);
}

routeClear?.addEventListener("click", clearRoute);
Object.defineProperty(window, "advisorRoutes", {
  value: {
    select: (fromId: string, toId: string) => selectRoute(fromId, toId),
    get framing() {
      return framing;
    },
    clear: clearRoute,
    activeId: activeRouteId,
    neighbours: (id: string) => neighbouringVillages(id).map((n) => n.place.id),
    route: (fromId: string, toId: string) => {
      const { points, ...summary } = routeBetweenVillages(fromId, toId);
      return { ...summary, pointCount: points.length };
    },
  },
});

function syncTravelPanelState() {
  if (!travelPanel) return;
  document.body.classList.toggle("travel-panel-open", !travelPanel.hidden);
}

function refreshTravelSummary() {
  if (!villageSelect || !summary) return;
  const selected = villages.find((place) => place.id === villageSelect.value);
  renderRoutes(selected?.id);
  if (!selected) {
    summary.textContent =
      "Travel uses canonical metres and fantasy-time walking speeds. Select a village to inspect a seeded route.";
    return;
  }
  const road = roads.find(
    (candidate) => candidate.from === selected.id || candidate.to === selected.id,
  );
  if (!road) {
    summary.textContent = `${selected.name} has no direct prototype road link yet; no travel time is invented.`;
    return;
  }
  const neighborId = road.from === selected.id ? road.to : road.from;
  const neighbor = villages.find((place) => place.id === neighborId)!;
  const openGround = travelMetrics(road.surfaceLengthM, "open-ground");
  const difficultTerrain = travelMetrics(road.surfaceLengthM, "difficult-terrain");
  summary.dataset.distanceM = String(road.surfaceLengthM);
  summary.dataset.fantasySeconds = String(road.fantasyWalkSeconds);
  summary.dataset.realSeconds = String(road.realWalkSeconds);
  summary.dataset.openGroundFantasySeconds = String(openGround.fantasySeconds);
  summary.dataset.difficultTerrainFantasySeconds = String(
    difficultTerrain.fantasySeconds,
  );
  summary.textContent =
    `${selected.name} → ${neighbor.name}: ${distanceLabel(road.surfaceLengthM)} · ` +
    `${fantasyDurationLabel(road.fantasyWalkSeconds)} on good road · ` +
    `${realDurationLabel(road.realWalkSeconds)} at 24×. ` +
    `Same distance: ${fantasyDurationLabel(openGround.fantasySeconds)} across open ground ` +
    `(${(OPEN_GROUND_WALK_SPEED_MPS * 3.6).toFixed(1)} km/fantasy h) · ` +
    `${fantasyDurationLabel(difficultTerrain.fantasySeconds)} on difficult terrain ` +
    `(${(DIFFICULT_TERRAIN_WALK_SPEED_MPS * 3.6).toFixed(1)} km/fantasy h).`;
}

if (travelPanel) {
  new MutationObserver(syncTravelPanelState).observe(travelPanel, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  syncTravelPanelState();
}

if (villageSelect && summary) {
  villageSelect.addEventListener("change", refreshTravelSummary);
  document.getElementById("city-select")?.addEventListener("change", () =>
    queueMicrotask(refreshTravelSummary),
  );
  document.getElementById("country-select")?.addEventListener("change", () =>
    queueMicrotask(refreshTravelSummary),
  );
  document.getElementById("continent-select")?.addEventListener("change", () =>
    queueMicrotask(refreshTravelSummary),
  );
  new MutationObserver(refreshTravelSummary).observe(villageSelect, {
    childList: true,
  });
  queueMicrotask(refreshTravelSummary);
}
