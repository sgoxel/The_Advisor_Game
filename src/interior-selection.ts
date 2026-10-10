import { lonLatToSource } from "./planet.ts";
import { buildingAt, type Building } from "./settlement-layout.ts";

/**
 * Presentation adapter from the existing canonical cell inspector to the building-entry surface.
 * The atlas remains navigation/inspection only: selecting a building merely exposes its canonical
 * record. It does not request Character entry and never materializes an interior.
 */
function installSelectionAdapter() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const panel = document.getElementById("cell-panel"),
    height = document.getElementById("cell-height");
  if (!panel || !height) return;

  let lastCode: string | undefined,
    scheduled = false;
  const emit = (building?: Building) => {
    if (building?.code === lastCode && Boolean(building) === Boolean(lastCode)) return;
    lastCode = building?.code;
    window.dispatchEvent(
      new CustomEvent("advisor:building-selected", { detail: { building } }),
    );
  };
  const sync = () => {
    scheduled = false;
    if (panel.hidden) {
      emit(undefined);
      return;
    }
    const title = height.getAttribute("title") || "",
      match = title.match(/lon\s+(-?\d+(?:\.\d+)?),\s*lat\s+(-?\d+(?:\.\d+)?)/i);
    if (!match) {
      emit(undefined);
      return;
    }
    const lon = Number(match[1]),
      lat = Number(match[2]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      emit(undefined);
      return;
    }
    const source = lonLatToSource(lon, lat);
    emit(buildingAt(source.x, source.z));
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  };

  new MutationObserver(schedule).observe(panel, {
    attributes: true,
    attributeFilter: ["hidden", "title"],
    childList: true,
    characterData: true,
    subtree: true,
  });
  panel.addEventListener("pointerup", schedule, { capture: true });
  schedule();
}

installSelectionAdapter();
