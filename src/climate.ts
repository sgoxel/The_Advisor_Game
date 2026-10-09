import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  CANONICAL_PLANET_RADIUS,
  clampLatitude,
  normalizeLongitude,
  type LonLat,
} from "./planet.ts";

export type ClimateZone =
  | "Polar"
  | "Subpolar"
  | "Cold temperate"
  | "Temperate"
  | "Warm"
  | "Arid"
  | "Alpine";

export type ForestFamily =
  | "conifer-boreal"
  | "temperate-deciduous-mixed"
  | "warm-dry-woodland";

export type TerrainClass =
  | "ocean"
  | "lake"
  | "sea-ice"
  | "polar-ice"
  | "tundra"
  | "snowy-mountain"
  | "cliff"
  | "beach"
  | "desert"
  | "dryland"
  | "bare-earth"
  | "conifer-forest"
  | "temperate-forest"
  | "dry-woodland"
  | "grassland"
  | "meadow"
  | "highland"
  | "volcanic";

export type RGB = readonly [number, number, number];

/**
 * One semantic base-colour authority for every LOD and renderer. Detail paths may
 * add bounded variation around these values, but may not substitute another
 * palette for the same terrain identity.
 *
 * Neighbouring lowland classes intentionally use a compressed luminance/chroma
 * range. The terrain mesh interpolates vertex colours, so large contrast jumps at
 * semantic thresholds reveal the low-poly triangulation as artificial wedges.
 * Shape, vegetation and canonical identity still distinguish the biomes. Frozen
 * land is deliberately cool/high-luminance while cliffs retain a dark neutral rock
 * cue so those physically meaningful surfaces remain readable on phone screens.
 */
export const TERRAIN_PALETTE: Readonly<Record<TerrainClass, RGB>> = {
  ocean: [76, 124, 148],
  lake: [70, 124, 151],
  "sea-ice": [207, 228, 233],
  "polar-ice": [241, 247, 248],
  tundra: [198, 211, 208],
  "snowy-mountain": [242, 244, 241],
  cliff: [62, 65, 66],
  beach: [186, 172, 132],
  desert: [176, 151, 104],
  dryland: [151, 135, 93],
  "bare-earth": [143, 124, 92],
  "conifer-forest": [55, 88, 66],
  "temperate-forest": [73, 108, 65],
  "dry-woodland": [105, 117, 70],
  grassland: [126, 145, 91],
  meadow: [137, 155, 100],
  highland: [127, 130, 116],
  volcanic: [92, 88, 79],
};

export const CLIMATE_AUTHORITY_CODE = `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CLIMATE`;

export type ClimateSample = {
  code: string;
  zone: ClimateZone;
  terrainClass: TerrainClass;
  materialId: string;
  baseColor: RGB;
  temperatureC: number;
  moisture: number;
  coastDistanceM: number;
  elevationM: number;
  snowLineM: number;
  ruggedness: number;
  frozen: boolean;
  forestFamily: ForestFamily | null;
  parentMacroCode: string;
};

const TAU = Math.PI * 2;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CLIMATE/${address}`) / 4294967296;
}

const phase = (address: string) => addressed(address) * TAU;
const PHASES = [phase("temperature"), phase("moisture-a"), phase("moisture-b"), phase("polar")];
const REGIONAL_PHASES = [
  phase("regional-a"),
  phase("regional-b"),
  phase("regional-c"),
  phase("regional-d"),
];
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** Low-frequency spherical field. No mutable PRNG, sampling order or camera input. */
function seededWave(position: LonLat, layer: number) {
  const lon = normalizeLongitude(position.lon),
    lat = clampLatitude(position.lat),
    p = PHASES[layer % PHASES.length],
    a = Math.sin(lon * (1.7 + layer * 0.23) + p) * Math.cos(lat * (2.3 + layer * 0.17)),
    b = Math.sin(lon * (3.1 + layer * 0.19) - lat * (1.4 + layer * 0.11) + p * 0.61),
    c = Math.cos(lon * 0.73 + lat * (4.2 + layer * 0.13) - p * 0.37);
  return (a * 0.48 + b * 0.32 + c * 0.2 + 1) * 0.5;
}

/**
 * Mid-frequency spherical field used only to bend ecological thresholds and
 * coastal suitability. Its bounded amplitude produces regional ecotones instead
 * of locally straight bands without introducing high-frequency texture noise.
 */
function regionalWave(position: LonLat, layer: number) {
  const lon = normalizeLongitude(position.lon),
    lat = clampLatitude(position.lat),
    p = REGIONAL_PHASES[layer % REGIONAL_PHASES.length],
    a = Math.sin(lon * (19 + layer * 2.7) + lat * (11 + layer * 1.3) + p),
    b = Math.cos(lon * (37 + layer * 3.1) - lat * (23 + layer * 1.7) - p * 0.71),
    c = Math.sin(lon * (61 + layer * 4.3) + lat * (47 + layer * 2.1) + p * 0.43);
  return clamp01((a * 0.5 + b * 0.3 + c * 0.2 + 1) * 0.5);
}

/**
 * Irregular, seed-addressed polar boundary. Long waves define the cap while a
 * small regional component breaks blob-like edges without creating noisy stripes.
 */
export function polarBoundaryAt(position: LonLat) {
  const hemisphere = position.lat >= 0 ? 1 : -1,
    primary = seededWave(
      { lon: position.lon + hemisphere * 0.37, lat: hemisphere * 0.91 },
      3,
    ),
    secondary = seededWave(
      { lon: position.lon * 1.37 - hemisphere * 0.21, lat: hemisphere * 0.78 },
      1,
    ),
    regional = regionalWave(
      { lon: position.lon + hemisphere * 0.11, lat: hemisphere * 0.82 },
      3,
    );
  return 0.735 + (primary - 0.5) * 0.075 + (secondary - 0.5) * 0.035 + (regional - 0.5) * 0.018;
}

export function frozenLatitudeAt(position: LonLat) {
  const latitude01 = Math.abs(clampLatitude(position.lat)) / (Math.PI / 2);
  return latitude01 >= polarBoundaryAt(position);
}

function classifyZone(
  temperatureC: number,
  moisture: number,
  elevationM: number,
  frozen: boolean,
): ClimateZone {
  if (frozen) return "Polar";
  if (elevationM > 310 && temperatureC < 9) return "Alpine";
  if (moisture < 0.29 && temperatureC > 10) return "Arid";
  if (temperatureC < -2) return "Subpolar";
  if (temperatureC < 8) return "Cold temperate";
  if (temperatureC < 19) return "Temperate";
  return "Warm";
}

function forestFamilyFor(temperatureC: number, moisture: number): ForestFamily | null {
  if (temperatureC <= 8 && temperatureC > -9 && moisture >= 0.4) return "conifer-boreal";
  if (temperatureC > 7 && temperatureC < 22 && moisture >= 0.55)
    return "temperate-deciduous-mixed";
  if (temperatureC >= 17 && moisture >= 0.34 && moisture < 0.58)
    return "warm-dry-woodland";
  return null;
}

function terrainFor(
  position: LonLat,
  temperatureC: number,
  moisture: number,
  elevationM: number,
  snowLineM: number,
  ruggedness: number,
  frozen: boolean,
): { terrainClass: TerrainClass; forestFamily: ForestFamily | null } {
  const macro = macroSampleAt(position),
    regional = regionalWave(position, 0);
  if (!macro.land) {
    if (frozen) return { terrainClass: "sea-ice", forestFamily: null };
    return { terrainClass: macro.domain === "Lake" ? "lake" : "ocean", forestFamily: null };
  }

  if (frozen) {
    if (elevationM > Math.max(120, snowLineM * 0.5) || temperatureC < -13)
      return { terrainClass: "polar-ice", forestFamily: null };
    return { terrainClass: "tundra", forestFamily: null };
  }

  // Preserve the volcanic archetype as its own readable geology even in cold climates.
  if (macro.volcanic && macro.mountainIntensity > 0.12)
    return { terrainClass: "volcanic", forestFamily: null };
  if (elevationM >= snowLineM && temperatureC < 7)
    return { terrainClass: "snowy-mountain", forestFamily: null };

  const coastM = Math.max(0, macro.coastDistanceRad * CANONICAL_PLANET_RADIUS),
    beachSuitability = regionalWave(position, 3),
    beachReachM = 75 + 235 * beachSuitability;
  if (coastM <= Math.max(45, beachReachM)) {
    if (ruggedness > 0.58 || elevationM > 105)
      return { terrainClass: "cliff", forestFamily: null };
    // Keep beach identity to a narrow, SEED-suitable shoreline. This avoids a
    // broad stair-stepped sand band on the coarse local terrain mesh while still
    // preserving sandy/shingle margins at genuinely suitable coasts.
    if (
      (coastM <= 70 && beachSuitability > 0.26) ||
      (coastM <= beachReachM && beachSuitability > 0.72)
    )
      return { terrainClass: "beach", forestFamily: null };
  }
  if (ruggedness > 0.73 && elevationM > 80)
    return { terrainClass: "cliff", forestFamily: null };
  const highlandThreshold = 0.25 + (regional - 0.5) * 0.09;
  if (elevationM > 185 || macro.mountainIntensity > highlandThreshold)
    return { terrainClass: "highland", forestFamily: null };

  if (moisture < 0.23 && temperatureC > 12)
    return { terrainClass: "desert", forestFamily: null };
  if (moisture < 0.31 && temperatureC > 8)
    return { terrainClass: "bare-earth", forestFamily: null };
  if (moisture < 0.39 && temperatureC > 11)
    return { terrainClass: "dryland", forestFamily: null };

  const forestFamily = forestFamilyFor(temperatureC, moisture);
  if (forestFamily === "conifer-boreal")
    return { terrainClass: "conifer-forest", forestFamily };
  if (forestFamily === "temperate-deciduous-mixed")
    return { terrainClass: "temperate-forest", forestFamily };
  if (forestFamily === "warm-dry-woodland")
    return { terrainClass: "dry-woodland", forestFamily };

  return {
    terrainClass: moisture > 0.66 && temperatureC > 2 ? "meadow" : "grassland",
    forestFamily: null,
  };
}

/**
 * Canonical seeded climate/material sample shared by Realm and every local LOD.
 * The optional second argument is accepted only because presentation callers may
 * already have a local mesh height; semantic identity deliberately ignores it.
 * Macro relief is the single canonical elevation input for this climate authority.
 */
export function climateSampleAt(position: LonLat, _presentationElevationM?: number): ClimateSample {
  const canonical = {
      lon: normalizeLongitude(position.lon),
      lat: clampLatitude(position.lat),
    },
    macro = macroSampleAt(canonical),
    elevation = Math.max(0, macro.reliefM),
    latitude01 = Math.abs(canonical.lat) / (Math.PI / 2),
    continentality = clamp01(Math.max(0, macro.coastDistanceRad) / 0.12),
    thermalWave = seededWave(canonical, 0) - 0.5,
    moistureWave = seededWave(canonical, 1),
    rainWave = seededWave(canonical, 2),
    regionalMoisture = regionalWave(canonical, 0) - 0.5,
    regionalThermal = regionalWave(canonical, 1) - 0.5,
    baseTemperatureC =
      30.5 -
      45 * Math.pow(latitude01, 1.12) -
      elevation * 0.0061 +
      thermalWave * 7.5 +
      regionalThermal * 3.2 -
      continentality * 2.2,
    // Dominant spines represent the world's highest compressed macro relief. Give
    // their upper canonical recipe a deterministic alpine microclimate so the
    // required snowy mountains exist without inventing a camera/LOD-only snow mask.
    temperatureC =
      macro.mountainKind === "dominant-spine" && elevation > 260
        ? Math.min(baseTemperatureC, 3.5 + thermalWave * 5 + regionalThermal * 1.4)
        : baseTemperatureC,
    subtropicalDrying = Math.exp(-Math.pow((latitude01 - 0.31) / 0.14, 2)),
    coastHumidity = macro.land ? (1 - continentality) * 0.12 : 0.15,
    moisture = clamp01(
      0.2 +
        moistureWave * 0.48 +
        rainWave * 0.18 +
        regionalMoisture * 0.14 +
        coastHumidity -
        subtropicalDrying * 0.27,
    ),
    frozen = frozenLatitudeAt(canonical),
    baseSnowLineM = Math.max(
      95,
      650 -
        latitude01 * 470 +
        (seededWave(canonical, 2) - 0.5) * 120 +
        (regionalWave(canonical, 2) - 0.5) * 85,
    ),
    snowLineM =
      macro.mountainKind === "dominant-spine" && elevation > 260
        ? Math.min(baseSnowLineM, Math.max(150, elevation * 0.82))
        : baseSnowLineM,
    ruggedness = clamp01(
      macro.mountainIntensity * 0.78 +
        Math.min(1, elevation / 520) * 0.18 +
        seededWave(canonical, 3) * 0.13 +
        regionalWave(canonical, 3) * 0.09,
    ),
    zone = classifyZone(temperatureC, moisture, elevation, frozen),
    classified = terrainFor(
      canonical,
      temperatureC,
      moisture,
      elevation,
      snowLineM,
      ruggedness,
      frozen,
    ),
    terrainClass = classified.terrainClass;
  return {
    code: `${CLIMATE_AUTHORITY_CODE}/${zone.replaceAll(" ", "-").toUpperCase()}/${terrainClass.toUpperCase()}`,
    zone,
    terrainClass,
    materialId: `terrain/${terrainClass}`,
    baseColor: TERRAIN_PALETTE[terrainClass],
    temperatureC,
    moisture,
    coastDistanceM: macro.coastDistanceRad * CANONICAL_PLANET_RADIUS,
    elevationM: elevation,
    snowLineM,
    ruggedness,
    frozen,
    forestFamily: classified.forestFamily,
    parentMacroCode: macro.mountainCode || macro.code,
  };
}

export function terrainLabel(sample: Pick<ClimateSample, "terrainClass">) {
  const labels: Record<TerrainClass, string> = {
    ocean: "Ocean",
    lake: "Lake",
    "sea-ice": "Sea ice",
    "polar-ice": "Polar ice",
    tundra: "Tundra",
    "snowy-mountain": "Snowy mountain",
    cliff: "Cliff",
    beach: "Sandy beach",
    desert: "Desert",
    dryland: "Dryland",
    "bare-earth": "Bare ground",
    "conifer-forest": "Conifer forest",
    "temperate-forest": "Temperate forest",
    "dry-woodland": "Dry woodland",
    grassland: "Grassland",
    meadow: "Meadow",
    highland: "Highlands",
    volcanic: "Volcanic highlands",
  };
  return labels[sample.terrainClass];
}

export function terrainDetailAmount(sample: ClimateSample) {
  // Semantic recognition survives low quality; this only controls sub-material detail.
  return smooth01(0.35 + sample.moisture * 0.35 + sample.ruggedness * 0.3);
}