import { roads } from "./geography.ts";
import { heightAt, biomeAt } from "./world.ts";
import { greatCircleDistance, lonLatToSource, type LonLat } from "./planet.ts";
import {
  CONTINUITY_LIMITS,
  clearContinuityRecipeCache,
  continuityMetrics,
  continuityRegionAt,
  continuityRegionRecipe,
  continuityRemoteRoadQuery,
} from "./continuity.ts";

type Road = (typeof roads)[number];
type RuntimeWorld = {
  geography: Record<string, unknown>;
  planet: Record<string, unknown>;
  readonly state: Record<string, any>;
  continuity?: Record<string, unknown>;
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T | null;

function profilePoint(point: LonLat) {
  const source = lonLatToSource(point.lon, point.lat),
    elevationM = heightAt(source.x, source.z),
    biome = biomeAt(source.x, source.z);
  return {
    position: point,
    elevationM: Math.round(elevationM * 100) / 100,
    biome,
    sourcePresentation: source,
  };
}

function roadDistanceTo(position: LonLat, road: Road) {
  return Math.min(
    greatCircleDistance(position, road.fromPosition),
    greatCircleDistance(position, road.toPosition),
  );
}

function nearestRoad(position: LonLat): Road | undefined {
  let best: Road | undefined,
    bestDistance = Infinity;
  for (const road of roads) {
    const distance = roadDistanceTo(position, road);
    if (distance < bestDistance || (distance === bestDistance && road.code < (best?.code || "~"))) {
      best = road;
      bestDistance = distance;
    }
  }
  return best;
}

function install(world: RuntimeWorld) {
  if (world.continuity) return;

  const api = Object.freeze({
    limits: CONTINUITY_LIMITS,
    regionAt(lon: number, lat: number) {
      const cell = continuityRegionAt({ lon, lat });
      return continuityRegionRecipe(cell);
    },
    road(index = 0, campaignRevision = "INITIAL") {
      const road = roads[index];
      if (!road) return undefined;
      const recipe = continuityRemoteRoadQuery(
        road.code,
        road.fromPosition,
        road.toPosition,
        campaignRevision,
      );
      return {
        roadCode: road.code,
        recipe,
        // Same terrain authority used by ordinary rendering/traversal, evaluated
        // only at the compact continuity points. This creates no meshes/entities.
        runtimeProfile: recipe.points.map(profilePoint),
      };
    },
    clearCache: clearContinuityRecipeCache,
    metrics: continuityMetrics,
  });
  Object.defineProperty(world, "continuity", {
    value: api,
    enumerable: true,
    configurable: false,
    writable: false,
  });

  const stateDescriptor = Object.getOwnPropertyDescriptor(world, "state");
  if (stateDescriptor?.get) {
    const sourceState = stateDescriptor.get.bind(world);
    Object.defineProperty(world, "state", {
      configurable: true,
      enumerable: true,
      get() {
        return { ...sourceState(), continuity: continuityMetrics() };
      },
    });
  }

  const layerControls = $(".layer-controls"),
    existingGrid = $("#grid")?.closest("label");
  if (layerControls && !$("#continuity-contracts")) {
    const label = document.createElement("label");
    label.className = "continuity-toggle";
    label.innerHTML = '<input type="checkbox" id="continuity-contracts" /> Continuity contracts <span class="continuity-key">◇</span>';
    existingGrid?.after(label);
  }

  let overlay = $("#continuity-workset");
  if (!overlay) {
    overlay = document.createElement("aside");
    overlay.id = "continuity-workset";
    overlay.className = "continuity-workset";
    overlay.hidden = true;
    overlay.setAttribute("aria-label", "Continuity diagnostics");
    document.body.append(overlay);
  }

  const update = () => {
    const enabled = ($<HTMLInputElement>("#continuity-contracts")?.checked ?? false);
    overlay!.hidden = !enabled;
    if (!enabled) return;
    const state = world.state,
      focus = state.navigation?.focus as LonLat | undefined;
    if (!focus) return;
    const cell = continuityRegionAt(focus),
      region = continuityRegionRecipe(cell),
      road = nearestRoad(focus),
      remote = road
        ? continuityRemoteRoadQuery(road.code, road.fromPosition, road.toPosition)
        : undefined,
      metrics = continuityMetrics(),
      port = remote?.ports[0],
      runtime = port ? profilePoint(port.position) : undefined,
      short = (value: string) => (value.length > 46 ? `${value.slice(0, 21)}…${value.slice(-20)}` : value);
    overlay!.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "eyebrow";
    heading.textContent = "CONTINUITY · BOUNDED WORK SET";
    const title = document.createElement("strong");
    title.textContent = short(region.cell.id);
    const lines = [
      `Definition ${region.domain} · ${region.reliefM.toFixed(2)} m coarse relief`,
      `Dependencies ${region.dependencies.length}/${CONTINUITY_LIMITS.terrainDependencyRegions} · no fine neighbour materialization`,
      road && remote
        ? `Road ${short(road.code)} · ${remote.regions.length} logical regions · ${remote.ports.length} shared ports`
        : "Road no nearby registry entry",
      port && runtime
        ? `Port ${port.candidate + 1}/${CONTINUITY_LIMITS.boundaryCandidates} @ ${(port.t * 100).toFixed(1)}% · ${runtime.biome} · ${runtime.elevationM.toFixed(2)} m`
        : "Port not required inside this corridor",
      remote ? `Recipe ${remote.foundationDigest} · state ${remote.stateDigest}` : "Recipe —",
      `Search ${remote?.searchExpansions ?? 0}/${CONTINUITY_LIMITS.roadSearchExpansions} · cache ${metrics.cacheEntries}/${CONTINUITY_LIMITS.cacheEntries}`,
      `Remote presentation resources ${metrics.materializedPresentationResources} · ${metrics.presentationBytes} B`,
    ];
    overlay!.append(heading, title);
    for (const text of lines) {
      const line = document.createElement("span");
      line.textContent = text;
      overlay!.append(line);
    }
  };

  $<HTMLInputElement>("#continuity-contracts")?.addEventListener("change", update);
  window.setInterval(update, 750);

  const panel = $("#cell-panel"),
    levels = $("#seed-levels");
  const updateInspector = () => {
    if (!panel || panel.hidden || !levels) return;
    const title = $("#cell-height")?.getAttribute("title") || "",
      match = title.match(/lon\s+(-?\d+(?:\.\d+)?),\s*lat\s+(-?\d+(?:\.\d+)?)/);
    if (!match) return;
    const cell = continuityRegionAt({ lon: Number(match[1]), lat: Number(match[2]) }),
      recipe = continuityRegionRecipe(cell);
    let item = levels.querySelector<HTMLElement>("[data-level='planet-continuity']");
    if (!item) {
      item = document.createElement("li");
      item.dataset.level = "planet-continuity";
      levels.prepend(item);
    }
    const label = `Continuity · ${recipe.domain} · ${recipe.dependencies.length}/${CONTINUITY_LIMITS.terrainDependencyRegions} coarse dependencies · lazy road ports`;
    if (item.dataset.fingerprint !== `${label}|${recipe.definitionDigest}`) {
      item.replaceChildren(
        document.createTextNode(label),
        Object.assign(document.createElement("code"), { textContent: recipe.definitionDigest }),
      );
      item.dataset.fingerprint = `${label}|${recipe.definitionDigest}`;
    }
  };
  if (panel)
    new MutationObserver(updateInspector).observe(panel, {
      attributes: true,
      attributeFilter: ["hidden"],
      childList: true,
      subtree: true,
    });
}

function waitForWorld() {
  const world = (window as unknown as { advisorWorld?: RuntimeWorld }).advisorWorld;
  // Wait for canonical-inspector to publish canonical planet authority first so
  // state diagnostics compose rather than race each other during startup.
  if (!world || !(world.planet as { authority?: unknown }).authority) {
    requestAnimationFrame(waitForWorld);
    return;
  }
  install(world);
}

waitForWorld();
