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
 */
export const TERRAIN_PALETTE: Readonly<Record<TerrainClass, RGB>> = {
  ocean: [76, 124, 148],
  lake: [70, 124, 151],
  "sea-ice": [184, 208, 211],
  "polar-ice": [218, 226, 221],
  tundra: [148, 158, 132],
  "snowy-mountain": [221, 223, 211],
  cliff: [110, 105, 96],
  beach: [203, 188, 140],
  desert: [190, 153, 93],
  dryland: [159, 137, 86],
  "bare-earth": [137, 112, 78],
  "conifer-forest": [55, 88, 66],
  "temperate-forest": [73, 108, 65],
  "dry-woodland": [105, 117, 70],
  grassland: [116, 142, 78],
  meadow: [128, 151, 89],
  highland: [126, 132, 111],
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
 * Irregular, seed-addressed polar boundary. It is deliberately evaluated from
 * longitude and hemisphere so the north and south frozen regions are related by
 * the same authority but are never mirrored copies.
 */
export function polarBoundaryAt(position: LonLat) {
  const hemisphere = position.lat >= 0 ? 1 : -1,
    wave = seededWave(
      { lon: position.lon + hemisphere * 0.37, lat: hemisphere * 0.91 },
      3,
    );
  return 0.735 + (wave - 0.5) * 0.09;
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
  const macro = macroSampleAt(position);
  if (!macro.land) {
    if (frozen) return { terrainClass: "sea-ice", forestFamily: null };
    return { terrainClass: macro.domain === "Lake" ? "lake" : "ocean", forestFamily: null };
  }

  if (frozen) {
    if (elevationM > Math.max(120, snowLineM * 0.5) || temperatureC < -13)
      return { terrainClass: "polar-ice", forestFamily: null };
    return { terrainClass: "tundra", forestFamily: null };
  }

  if (elevationM >= snowLineM && temperatureC < 7)
    return { terrainClass: "snowy-mountain", forestFamily: null };
  if (macro.volcanic && macro.mountainIntensity > 0.12)
    return { terrainClass: "volcanic", forestFamily: null };

  const coastM = Math.max(0, macro.coastDistanceRad * CANONICAL_PLANET_RADIUS),
    beachReachM = 850 + 1250 * seededWave(position, 1);
  if (coastM <= beachReachM) {
    if (ruggedness > 0.58 || elevationM > 105)
      return { terrainClass: "cliff", forestFamily: null };
    return { terrainClass: "beach", forestFamily: null };
  }
  if (ruggedness > 0.73 && elevationM > 80)
    return { terrainClass: "cliff", forestFamily: null };
  if (elevationM > 185 || macro.mountainIntensity > 0.27)
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
 * Elevation may be supplied by the local height authority; otherwise the macro
 * relief supplies a conservative Realm-scale sample.
 */
export function climateSampleAt(position: LonLat, elevationM?: number): ClimateSample {
  const canonical = {
      lon: normalizeLongitude(position.lon),
      lat: clampLatitude(position.lat),
    },
    macro = macroSampleAt(canonical),
    elevation = Math.max(0, elevationM ?? macro.reliefM),
    latitude01 = Math.abs(canonical.lat) / (Math.PI / 2),
    continentality = clamp01(Math.max(0, macro.coastDistanceRad) / 0.12),
    thermalWave = seededWave(canonical, 0) - 0.5,
    moistureWave = seededWave(canonical, 1),
    rainWave = seededWave(canonical, 2),
    temperatureC =
      30.5 -
      45 * Math.pow(latitude01, 1.12) -
      elevation * 0.0061 +
      thermalWave * 7.5 -
      continentality * 2.2,
    subtropicalDrying = Math.exp(-Math.pow((latitude01 - 0.31) / 0.14, 2)),
    coastHumidity = macro.land ? (1 - continentality) * 0.12 : 0.15,
    moisture = clamp01(
      0.2 + moistureWave * 0.48 + rainWave * 0.18 + coastHumidity - subtropicalDrying * 0.27,
    ),
    frozen = frozenLatitudeAt(canonical),
    snowLineM = Math.max(
      95,
      650 - latitude01 * 470 + (seededWave(canonical, 2) - 0.5) * 120,
    ),
    ruggedness = clamp01(
      macro.mountainIntensity * 0.78 +
        Math.min(1, elevation / 520) * 0.18 +
        seededWave(canonical, 3) * 0.18,
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
