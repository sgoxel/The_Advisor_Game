import { roads, villages } from "./geography.ts";
import { distanceLabel } from "./navigation.ts";
import {
  OPEN_GROUND_WALK_SPEED_MPS,
  fantasyDurationLabel,
  realDurationLabel,
} from "./travel.ts";

const villageSelect = document.getElementById("village-select") as HTMLSelectElement;
const summary = document.getElementById("travel-summary") as HTMLParagraphElement;

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
  summary.dataset.distanceM = String(road.surfaceLengthM);
  summary.dataset.fantasySeconds = String(road.fantasyWalkSeconds);
  summary.dataset.realSeconds = String(road.realWalkSeconds);
  summary.textContent =
    `${selected.name} → ${neighbor.name}: ${distanceLabel(road.surfaceLengthM)} · ` +
    `${fantasyDurationLabel(road.fantasyWalkSeconds)} on good road · ` +
    `${realDurationLabel(road.realWalkSeconds)} at 24×. ` +
    `Open ground is ${(OPEN_GROUND_WALK_SPEED_MPS * 3.6).toFixed(1)} km/fantasy h; difficult terrain is slower.`;
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
