import "./travel-ui.css";
import { roads, villages } from "./geography.ts";
import { distanceLabel } from "./navigation.ts";
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

function syncTravelPanelState() {
  if (!travelPanel) return;
  document.body.classList.toggle("travel-panel-open", !travelPanel.hidden);
}

function refreshTravelSummary() {
  if (!villageSelect || !summary) return;
  const selected = villages.find((place) => place.id === villageSelect.value);
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
