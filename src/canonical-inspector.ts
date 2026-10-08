import { WORLD_SEED } from "./config.ts";
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
  CANONICAL_GENERATOR_VERSION,
  canonicalCellCenter,
  canonicalCellNeighbor,
  canonicalCellNeighbors,
  canonicalFoundationSample,
} from "./spatial-authority.ts";
import { MACRO_GEOGRAPHY } from "./macro-geography.ts";

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
};

const $ = (id: string) => document.getElementById(id);

function degrees(value: number, positive: string, negative: string) {
  const amount = Math.abs((value * 180) / Math.PI).toFixed(5);
  return `${amount}° ${value < 0 ? negative : positive}`;
}

function canonicalFromSourceCell(cell: LegacyCell) {
  // The source cell indices are transitional render/generation detail. Use its
  // centre only to locate the canonical planet point; never use the L1–L5 code
  // or source address as global identity.
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

  // Public diagnostics return canonical position/identity first. The old source
  // sample is retained only under an explicitly derived presentation field.
  world.cellAt = (x: number, z: number) => {
    const source = sourceCellAt(x, z),
      { position, canonical } = canonicalFromSourceCell(source),
      foundation = canonicalFoundationSample(
        position.lon,
        position.lat,
        CANONICAL_ID_LEVEL,
        WORLD_SEED,
        CANONICAL_GENERATOR_VERSION,
      );
    return {
      code: canonical.id,
      canonicalId: canonical.id,
      canonicalCell: canonical,
      foundation,
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
    canonicalCell,
    canonicalCellId,
    canonicalCellCenter,
    canonicalCellNeighbor,
    canonicalCellNeighbors,
    canonicalFoundationSample,
    normalizeLongitude,
    wrapCanonicalX,
    lonLatToMeters,
    metersToLonLat,
    lonLatToCartesian,
    greatCircleDistance,
    sourceToLonLat,
    lonLatToSource,
    macro: {
      seed: MACRO_GEOGRAPHY.seed,
      version: MACRO_GEOGRAPHY.version,
      continents: MACRO_GEOGRAPHY.continents,
      islands: MACRO_GEOGRAPHY.islands,
      lakes: MACRO_GEOGRAPHY.lakes,
      mountainSystems: MACRO_GEOGRAPHY.mountainSystems,
    },
    presentation: {
      sourceWidth: SOURCE_PRESENTATION_WIDTH,
      renderRadius: RENDER_PLANET_RADIUS,
      authoritative: false,
    },
  };

  world.geography = Object.fromEntries(
    Object.entries(world.geography).map(([key, value]) => [key, decorateGeography(value)]),
  );

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
      landform = coordinates.textContent?.split("·").at(-1)?.trim() || "";

    coordinates.textContent = `${degrees(position.lat, "N", "S")} · ${degrees(position.lon, "E", "W")}${landform ? ` · ${landform}` : ""}`;
    code.textContent = canonical.id;
    code.dataset.canonicalId = canonical.id;
    if (height)
      height.title = `Canonical position: lon ${position.lon.toFixed(9)}, lat ${position.lat.toFixed(9)}, elevation ${source.elevation.toFixed(2)} m`;
    if (tile) tile.textContent = `${source.tile} · derived render tile`;
    if (levels) {
      let planetLevel = levels.querySelector<HTMLElement>("[data-planet-level]");
      if (!planetLevel) {
        planetLevel = document.createElement("li");
        planetLevel.dataset.planetLevel = "true";
        planetLevel.append("Planet · Macro geography");
        const text = document.createElement("code");
        text.textContent = `${WORLD_SEED}/${CANONICAL_GENERATOR_VERSION}/MACRO`;
        planetLevel.append(text);
        levels.prepend(planetLevel);
      }
      for (const item of Array.from(levels.children)) {
        if ((item as HTMLElement).dataset.planetLevel) continue;
        const first = item.firstChild;
        if (
          first?.nodeType === Node.TEXT_NODE &&
          first.textContent &&
          !first.textContent.startsWith("Derived source · ")
        )
          first.textContent = `Derived source · ${first.textContent}`;
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
