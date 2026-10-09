import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  CANONICAL_PLANET_CIRCUMFERENCE,
  CANONICAL_PLANET_DIAMETER,
  CANONICAL_PLANET_RADIUS,
  CANONICAL_POLE_DISTANCE,
  PLANET_AUTHORITY,
  RENDER_PLANET_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  canonicalCell,
  canonicalCellId,
  greatCircleDistance,
  lonLatToCartesian,
  lonLatToMeters,
  lonLatToSource,
  metersToLonLat,
  normalizeLongitude,
  sourceToLonLat,
  wrapCanonicalX,
} from "./planet.ts";
import {
  MACRO_PLAN,
  macroIslands,
  macroLakes,
  macroSampleAt,
  mountainSystems,
} from "./macro-geography.ts";
import {
  BIOME_GENERATOR_VERSION,
  BIOME_MATERIALS,
  biomeEvidenceSamples,
  biomeEvidenceSourceSamples,
  biomeSampleAt,
  biomeSampleAtSource,
  climateZoneAt,
  polarSignatures,
} from "./biome.ts";
import {
  CANONICAL_GENERATOR_VERSION,
  canonicalCellCenter,
  canonicalCellNeighbor,
  canonicalCellNeighbors,
  canonicalFoundationSample,
} from "./spatial-authority.ts";

const CANONICAL_ID_LEVEL = 20;

type LegacyCell = {
  code: string;
  x: number;
  z: number;
  elevation: number;
  biome: string;
  walkable: boolean;
  tile: string;
};

type AdvisorWorld = {
  cellAt: (x: number, z: number) => LegacyCell;
  geography: Record<string, unknown>;
  planet: Record<string, unknown>;
  navigation?: { setFocus: (lon: number, lat: number) => void };
  setHalfHeight?: (height: number) => void;
  readonly state?: Record<string, unknown>;
};

const $ = (id: string) => document.getElementById(id);

function degrees(value: number, positive: string, negative: string) {
  const amount = Math.abs((value * 180) / Math.PI).toFixed(5);
  return `${amount}° ${value < 0 ? negative : positive}`;
}

function canonicalFromSourceCell(cell: LegacyCell) {
  const sourceX = cell.x * 2 + 1,
    sourceZ = cell.z * 2 + 1,
    position = sourceToLonLat(sourceX, sourceZ),
    canonical = canonicalCell(
      position.lon,
      position.lat,
      CANONICAL_ID_LEVEL,
      WORLD_SEED,
      CANONICAL_GENERATOR_VERSION,
    );
  return { sourceX, sourceZ, position, canonical };
}

function decorateGeography(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((record) => {
    if (!record || typeof record !== "object") return record;
    const item = record as Record<string, unknown>;
    if (typeof item.x !== "number" || typeof item.z !== "number") return record;
    return {
      ...item,
      sourcePosition: { x: item.x, z: item.z, derivedPresentationOnly: true },
    };
  });
}

function install(world: AdvisorWorld) {
  const sourceCellAt = world.cellAt.bind(world);

  world.cellAt = (x: number, z: number) => {
    const source = sourceCellAt(x, z),
      { position, canonical } = canonicalFromSourceCell(source),
      foundation = canonicalFoundationSample(
        position.lon,
        position.lat,
        CANONICAL_ID_LEVEL,
        WORLD_SEED,
        CANONICAL_GENERATOR_VERSION,
      ),
      macro = macroSampleAt(position),
      climate = biomeSampleAt(position, { elevationM: source.elevation, macro });
    return {
      code: canonical.id,
      canonicalId: canonical.id,
      canonicalCell: canonical,
      foundation,
      macro,
      climate,
      position: { ...position, elevation: source.elevation },
      elevation: source.elevation,
      biome: source.biome,
      walkable: source.walkable,
      sourceDetail: {
        code: source.code,
        cellX: source.x,
        cellZ: source.z,
        renderTile: source.tile,
        derivedPresentationOnly: true,
      },
    } as unknown as LegacyCell;
  };

  world.planet = {
    authority: PLANET_AUTHORITY,
    radiusM: CANONICAL_PLANET_RADIUS,
    diameterM: CANONICAL_PLANET_DIAMETER,
    circumferenceM: CANONICAL_PLANET_CIRCUMFERENCE,
    poleDistanceM: CANONICAL_POLE_DISTANCE,
    identityLevel: CANONICAL_ID_LEVEL,
    generatorVersion: CANONICAL_GENERATOR_VERSION,
    macroGeneratorVersion: WORLD_FOUNDATION_VERSION,
    biomeGeneratorVersion: BIOME_GENERATOR_VERSION,
    canonicalCell,
    canonicalCellId,
    canonicalCellCenter,
    canonicalCellNeighbor,
    canonicalCellNeighbors,
    canonicalFoundationSample,
    macroSampleAt,
    climateZoneAt,
    biomeSampleAt,
    biomeSampleAtSource,
    biomeMaterials: BIOME_MATERIALS,
    biomeEvidenceSamples,
    biomeEvidenceSourceSamples,
    polarSignatures,
    normalizeLongitude,
    wrapCanonicalX,
    lonLatToMeters,
    metersToLonLat,
    lonLatToCartesian,
    greatCircleDistance,
    sourceToLonLat,
    lonLatToSource,
    presentation: {
      sourceWidth: SOURCE_PRESENTATION_WIDTH,
      renderRadius: RENDER_PLANET_RADIUS,
      authoritative: false,
    },
  };

  world.geography = Object.fromEntries(
    Object.entries(world.geography).map(([key, value]) => [key, decorateGeography(value)]),
  );
  Object.assign(world.geography, {
    islands: macroIslands,
    lakes: macroLakes,
    mountainSystems,
    macroPlan: MACRO_PLAN,
    macroSampleAt,
  });

  const stateDescriptor = Object.getOwnPropertyDescriptor(world, "state"),
    planBytesEstimated = new TextEncoder().encode(JSON.stringify(MACRO_PLAN)).byteLength,
    sphereVertices = (96 + 1) * (48 + 1),
    sphereTriangles = 96 * (48 * 2 - 2),
    shadeTriangles = 128,
    sphereGeometryBytesEstimated =
      sphereVertices * (3 + 3 + 2) * 4 + sphereTriangles * 3 * 2,
    shadeGeometryBytesEstimated =
      (shadeTriangles + 1) * (3 + 3 + 2) * 4 + shadeTriangles * 3 * 2;
  if (stateDescriptor?.get) {
    const sourceState = stateDescriptor.get.bind(world);
    Object.defineProperty(world, "state", {
      configurable: true,
      enumerable: true,
      get() {
        const state = sourceState() as Record<string, any>,
          globe = (state.globe || {}) as Record<string, any>,
          handoff = (state.handoff || {}) as Record<string, any>,
          textureBytesEstimated =
            Math.max(0, Number(globe.textureWidth) || 0) *
              Math.max(0, Number(globe.textureHeight) || 0) *
              4 +
            2048 * 4;
        return {
          ...state,
          macroGeography: {
            version: WORLD_FOUNDATION_VERSION,
            climateVersion: BIOME_GENERATOR_VERSION,
            continents: MACRO_PLAN.continents.length,
            islands: macroIslands.length,
            lakes: macroLakes.length,
            mountainSystems: mountainSystems.length,
            recipeCpuBytesEstimated: planBytesEstimated,
          },
          globe: {
            ...globe,
            drawCallsEstimated: 2,
            trianglesEstimated: sphereTriangles + shadeTriangles,
            cpuBytesEstimated: planBytesEstimated,
            textureBytesEstimated,
            geometryBytesEstimated:
              sphereGeometryBytesEstimated + shadeGeometryBytesEstimated,
            gpuBytesEstimated:
              textureBytesEstimated +
              sphereGeometryBytesEstimated +
              shadeGeometryBytesEstimated,
            preparationWaitMs: Number(handoff.preparationWaitMs) || 0,
            recurringGenerationPasses: globe.complete
              ? 0
              : Math.max(0, 2 - (Number(globe.passes) || 0)),
          },
        };
      },
    });
  }

  const panel = $("cell-panel"),
    coordinates = $("cell-coordinates"),
    code = $("cell-code"),
    height = $("cell-height"),
    tile = $("cell-tile"),
    levels = $("seed-levels"),
    copy = $("copy-code"),
    copyStatus = $("copy-status");

  const updateInspector = () => {
    if (!panel || panel.hidden || !coordinates || !code) return;
    const match = coordinates.textContent?.match(/Cell\s+(-?\d+),\s*(-?\d+)/);
    if (!match) return;
    const cellX = Number(match[1]),
      cellZ = Number(match[2]),
      source = sourceCellAt(cellX * 2 + 1, cellZ * 2 + 1),
      { position, canonical } = canonicalFromSourceCell(source),
      macro = macroSampleAt(position),
      climate = biomeSampleAt(position, { elevationM: source.elevation, macro }),
      landform = coordinates.textContent?.split("·").at(-1)?.trim() || "";

    coordinates.textContent = `${degrees(position.lat, "N", "S")} · ${degrees(position.lon, "E", "W")}${landform ? ` · ${landform}` : ""}`;
    code.textContent = canonical.id;
    code.dataset.canonicalId = canonical.id;
    if (height)
      height.title = `Canonical position: lon ${position.lon.toFixed(9)}, lat ${position.lat.toFixed(9)}, elevation ${source.elevation.toFixed(2)} m · ${climate.zone} · ${climate.material.label}`;
    if (tile) tile.textContent = `${source.tile} · derived render tile`;
    if (levels) {
      for (const item of Array.from(levels.children)) {
        const level = (item as HTMLElement).dataset.level;
        if (level === "planet-macro" || level === "planet-climate") continue;
        const first = item.firstChild;
        if (
          first?.nodeType === Node.TEXT_NODE &&
          first.textContent &&
          !first.textContent.startsWith("Derived source · ")
        )
          first.textContent = `Derived source · ${first.textContent}`;
      }
      let climateItem = levels.querySelector<HTMLElement>("[data-level='planet-climate']");
      if (!climateItem) {
        climateItem = document.createElement("li");
        climateItem.dataset.level = "planet-climate";
        levels.prepend(climateItem);
      }
      const climateLabel = `Planet climate · ${climate.zone} · ${climate.material.label} · ${climate.temperatureC.toFixed(1)}° · moisture ${Math.round(climate.moisture * 100)}%`;
      if (climateItem.dataset.fingerprint !== `${climateLabel}|${climate.code}`) {
        climateItem.replaceChildren(
          document.createTextNode(climateLabel),
          Object.assign(document.createElement("code"), { textContent: climate.code }),
        );
        climateItem.dataset.fingerprint = `${climateLabel}|${climate.code}`;
      }

      let macroItem = levels.querySelector<HTMLElement>("[data-level='planet-macro']");
      if (!macroItem) {
        macroItem = document.createElement("li");
        macroItem.dataset.level = "planet-macro";
        levels.prepend(macroItem);
      }
      const continent = MACRO_PLAN.continents[macro.continentId]?.name ?? "Unknown realm",
        feature =
          macro.domain === "Island"
            ? ` · island ${Number(macro.islandId) + 1}`
            : macro.domain === "Lake"
              ? ` · lake ${Number(macro.lakeId) + 1}`
              : "",
        range = macro.mountainKind
          ? ` · ${macro.mountainKind.replaceAll("-", " ")}`
          : "",
        label = `Planet macro · ${macro.domain} · ${continent}${feature}${range}`,
        macroCode = macro.mountainCode || macro.code;
      if (macroItem.dataset.fingerprint !== `${label}|${macroCode}`) {
        macroItem.replaceChildren(
          document.createTextNode(label),
          Object.assign(document.createElement("code"), { textContent: macroCode }),
        );
        macroItem.dataset.fingerprint = `${label}|${macroCode}`;
      }
    }
  };

  if (panel) {
    new MutationObserver(updateInspector).observe(panel, {
      attributes: true,
      attributeFilter: ["hidden"],
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  copy?.addEventListener(
    "click",
    async (event) => {
      event.stopImmediatePropagation();
      const value = code?.dataset.canonicalId || code?.textContent || "";
      try {
        await navigator.clipboard.writeText(value);
        if (copyStatus) copyStatus.textContent = "Canonical planet ID copied";
      } catch {
        if (copyStatus) copyStatus.textContent = "Select the canonical ID above to copy it.";
      }
    },
    { capture: true },
  );

  const home = (world.geography.villages as Array<{
    canonicalPosition?: { lon: number; lat: number };
  }> | undefined)?.[0]?.canonicalPosition;
  const navigateHome = () => {
    if (!home || !world.navigation?.setFocus) return;
    world.navigation.setFocus(home.lon, home.lat);
    world.setHalfHeight?.(97);
  };
  navigateHome();
  $("home")?.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateHome();
    },
    { capture: true },
  );
}

function waitForWorld() {
  const world = (window as unknown as { advisorWorld?: AdvisorWorld }).advisorWorld;
  if (!world?.cellAt || !world.planet) {
    requestAnimationFrame(waitForWorld);
    return;
  }
  install(world);
}

waitForWorld();
