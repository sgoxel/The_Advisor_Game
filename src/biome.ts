import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { MACRO_PLAN, macroSampleAt, type MacroSample } from "./macro-geography.ts";
import {
  CANONICAL_PLANET_RADIUS,
  lonLatToSource,
  lonLatToUnit,
  sourceToLonLat,
  type LonLat,
} from "./planet.ts";

export type ClimateZone = "Frozen" | "Cold" | "Temperate" | "Dry" | "Warm";
export type ForestFamily = "boreal" | "temperate" | "warm-woodland" | null;
export type BiomeId =
  | "ocean"
  | "lake"
  | "polar-sea-ice"
  | "polar-land-ice"
  | "tundra"
  | "snowy-mountain"
  | "cliff-rock"
  | "volcanic-highland"
  | "highland"
  | "beach"
  | "desert"
  | "dryland"
  | "bare-ground"
  | "boreal-forest"
  | "temperate-forest"
  | "warm-woodland"
  | "grassland";

export type BiomeMaterial = {
  id: BiomeId;
  label: string;
  color: readonly [number, number, number];
  vegetation: "none" | "sparse" | "grass" | "boreal" | "temperate" | "warm-woodland";
  density: number;
  water: boolean;
  frozen: boolean;
  rock: boolean;
};

export type BiomeSample = {
  code: string;
  zone: ClimateZone;
  biome: BiomeId;
  material: BiomeMaterial;
  forestFamily: ForestFamily;
  temperatureC: number;
  moisture: number;
  frozen: boolean;
  coastDistanceRad: number;
  elevationM: number;
  slopeM: number;
  macro: MacroSample;
};

export const BIOME_MATERIALS: Readonly<Record<BiomeId, BiomeMaterial>> = {
  ocean: { id: "ocean", label: "Open sea", color: [72, 122, 139], vegetation: "none", density: 0, water: true, frozen: false, rock: false },
  lake: { id: "lake", label: "Freshwater lake", color: [72, 126, 148], vegetation: "none", density: 0, water: true, frozen: false, rock: false },
  "polar-sea-ice": { id: "polar-sea-ice", label: "Frozen sea", color: [201, 220, 222], vegetation: "none", density: 0, water: true, frozen: true, rock: false },
  "polar-land-ice": { id: "polar-land-ice", label: "Polar ice", color: [221, 226, 214], vegetation: "none", density: 0, water: false, frozen: true, rock: false },
  tundra: { id: "tundra", label: "Tundra", color: [147, 151, 122], vegetation: "sparse", density: 0.12, water: false, frozen: false, rock: false },
  "snowy-mountain": { id: "snowy-mountain", label: "Snowy mountain", color: [205, 207, 194], vegetation: "sparse", density: 0.04, water: false, frozen: true, rock: true },
  "cliff-rock": { id: "cliff-rock", label: "Cliff / exposed rock", color: [121, 119, 105], vegetation: "sparse", density: 0.03, water: false, frozen: false, rock: true },
  "volcanic-highland": { id: "volcanic-highland", label: "Volcanic highland", color: [91, 83, 74], vegetation: "sparse", density: 0.02, water: false, frozen: false, rock: true },
  highland: { id: "highland", label: "Highland", color: [133, 137, 116], vegetation: "sparse", density: 0.12, water: false, frozen: false, rock: true },
  beach: { id: "beach", label: "Beach / coastal margin", color: [202, 185, 132], vegetation: "sparse", density: 0.03, water: false, frozen: false, rock: false },
  desert: { id: "desert", label: "Desert", color: [190, 160, 105], vegetation: "sparse", density: 0.025, water: false, frozen: false, rock: false },
  dryland: { id: "dryland", label: "Dry grassland", color: [157, 145, 91], vegetation: "sparse", density: 0.12, water: false, frozen: false, rock: false },
  "bare-ground": { id: "bare-ground", label: "Bare earth", color: [139, 116, 82], vegetation: "sparse", density: 0.02, water: false, frozen: false, rock: false },
  "boreal-forest": { id: "boreal-forest", label: "Boreal conifer forest", color: [63, 92, 69], vegetation: "boreal", density: 0.72, water: false, frozen: false, rock: false },
  "temperate-forest": { id: "temperate-forest", label: "Temperate mixed forest", color: [68, 108, 66], vegetation: "temperate", density: 0.76, water: false, frozen: false, rock: false },
  "warm-woodland": { id: "warm-woodland", label: "Warm dry woodland", color: [89, 112, 65], vegetation: "warm-woodland", density: 0.48, water: false, frozen: false, rock: false },
  grassland: { id: "grassland", label: "Grassland / meadow", color: [113, 139, 79], vegetation: "grass", density: 0.32, water: false, frozen: false, rock: false },
};

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(channel: string, index: number) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CLIMATE/${channel}/${index}`) / 4294967296;
}
function sphericalField(position: LonLat, channel: string): number {
  const p = lonLatToUnit(position.lon, position.lat);
  let total = 0,
    weight = 0;
  for (let octave = 0; octave < 4; octave++) {
    const ax = addressed(channel, octave * 4) * 2 - 1,
      ay = addressed(channel, octave * 4 + 1) * 2 - 1,
      az = addressed(channel, octave * 4 + 2) * 2 - 1,
      phase = addressed(channel, octave * 4 + 3) * Math.PI * 2,
      length = Math.hypot(ax, ay, az) || 1,
      frequency = 1.7 * 2 ** octave,
      amplitude = 0.56 ** octave;
    total += Math.sin(((p[0] * ax + p[1] * ay + p[2] * az) / length) * frequency * Math.PI + phase) * amplitude;
    weight += amplitude;
  }
  return Math.max(0, Math.min(1, 0.5 + total / (weight * 2)));
}
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function climateZoneAt(position: LonLat, elevationM = 0) {
  const edgeNoise = sphericalField(position, "polar-edge") - 0.5,
    polarEdge = 1.13 + edgeNoise * 0.18,
    absLat = Math.abs(position.lat),
    thermalNoise = (sphericalField(position, "temperature") - 0.5) * 7,
    temperatureC = 29 - 48 * Math.pow(Math.sin(absLat), 1.22) - Math.max(0, elevationM) * 0.018 + thermalNoise;
  if (absLat >= polarEdge || temperatureC <= -9) return { zone: "Frozen" as const, temperatureC, polarEdge };
  if (temperatureC < 5) return { zone: "Cold" as const, temperatureC, polarEdge };
  if (temperatureC > 20) return { zone: "Warm" as const, temperatureC, polarEdge };
  return { zone: "Temperate" as const, temperatureC, polarEdge };
}

export function biomeSampleAt(
  position: LonLat,
  context: { elevationM?: number; slopeM?: number; macro?: MacroSample } = {},
): BiomeSample {
  const macro = context.macro ?? macroSampleAt(position),
    elevationM = Math.max(0, context.elevationM ?? macro.reliefM),
    slopeM = Math.max(0, context.slopeM ?? 0),
    climate = climateZoneAt(position, elevationM),
    coastInfluence = Math.exp(-Math.max(0, macro.coastDistanceRad) / 0.09),
    moistureNoise = sphericalField(position, "moisture"),
    aridity = sphericalField(position, "aridity"),
    rainShadow = macro.mountainIntensity * (0.08 + 0.12 * sphericalField(position, "rain-shadow")),
    moisture = clamp01(0.08 + moistureNoise * 0.64 + coastInfluence * 0.18 - rainShadow - (aridity - 0.5) * 0.2),
    geology = sphericalField(position, "geology"),
    patch = sphericalField(position, "ground-patch");
  let zone: ClimateZone = climate.zone,
    biome: BiomeId;

  if (macro.domain === "Ocean" || macro.domain === "Lake") {
    if (climate.zone === "Frozen") biome = "polar-sea-ice";
    else biome = macro.domain === "Lake" ? "lake" : "ocean";
  } else if (climate.zone === "Frozen") {
    biome = climate.temperatureC < -4 || elevationM > 80 ? "polar-land-ice" : "tundra";
  } else if ((elevationM > 220 || macro.mountainIntensity > 0.42) && climate.temperatureC < 3.5) {
    biome = "snowy-mountain";
  } else if (macro.volcanic && macro.mountainIntensity > 0.18) {
    biome = "volcanic-highland";
  } else if (slopeM > 3.4 || (macro.mountainIntensity > 0.72 && elevationM > 180)) {
    biome = "cliff-rock";
  } else if (macro.coastDistanceRad >= 0 && macro.coastDistanceRad < 0.00024 + sphericalField(position, "coast") * 0.00012 && slopeM < 2.1) {
    biome = "beach";
  } else if (climate.temperatureC < 4.5) {
    biome = moisture > 0.44 ? "boreal-forest" : "tundra";
  } else if (moisture < 0.31 && climate.temperatureC > 14) {
    zone = "Dry";
    biome = geology > 0.7 || patch < 0.14 ? "bare-ground" : "desert";
  } else if (moisture < 0.42 && climate.temperatureC > 8) {
    zone = "Dry";
    biome = patch > 0.76 ? "bare-ground" : "dryland";
  } else if (elevationM > 150 || macro.mountainIntensity > 0.28) {
    biome = geology > 0.7 ? "cliff-rock" : "highland";
  } else if (climate.temperatureC < 10 && moisture > 0.49) {
    biome = "boreal-forest";
  } else if (climate.temperatureC < 19 && moisture > 0.5) {
    biome = "temperate-forest";
  } else if (climate.temperatureC >= 19 && moisture > 0.43) {
    biome = "warm-woodland";
  } else if (patch < 0.1 && moisture < 0.48) {
    biome = "bare-ground";
  } else {
    biome = "grassland";
  }

  const material = BIOME_MATERIALS[biome],
    forestFamily: ForestFamily =
      biome === "boreal-forest" ? "boreal" :
      biome === "temperate-forest" ? "temperate" :
      biome === "warm-woodland" ? "warm-woodland" : null;
  return {
    code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CLIMATE/${zone}/${biome}`,
    zone,
    biome,
    material,
    forestFamily,
    temperatureC: climate.temperatureC,
    moisture,
    frozen: material.frozen,
    coastDistanceRad: macro.coastDistanceRad,
    elevationM,
    slopeM,
    macro,
  };
}

export function biomeSampleAtSource(x: number, z: number, context: { elevationM?: number; slopeM?: number } = {}) {
  return biomeSampleAt(sourceToLonLat(x, z), context);
}

export function biomeColorAtSource(x: number, z: number, context: { elevationM?: number; slopeM?: number } = {}) {
  return biomeSampleAtSource(x, z, context).material.color;
}

export function biomeEvidenceSamples() {
  const wanted: BiomeId[] = [
    "grassland", "desert", "bare-ground", "boreal-forest", "temperate-forest",
    "warm-woodland", "snowy-mountain", "cliff-rock",
  ];
  const result: Partial<Record<BiomeId | "north-pole" | "south-pole" | "beach", LonLat>> = {
    "north-pole": { lon: 0.37, lat: Math.PI / 2 },
    "south-pole": { lon: -1.11, lat: -Math.PI / 2 },
  };
  for (let latDeg = -82; latDeg <= 82 && wanted.some((id) => !result[id]); latDeg += 2)
    for (let lonDeg = -178; lonDeg < 180; lonDeg += 2) {
      const position = { lon: lonDeg * Math.PI / 180, lat: latDeg * Math.PI / 180 },
        sample = biomeSampleAt(position);
      if (wanted.includes(sample.biome) && !result[sample.biome]) result[sample.biome] = position;
    }

  // Beaches are intentionally narrow. Find a real mainland coast by bisecting from
  // each seeded continent centre toward many bearings, then sample just inside it.
  for (const continent of MACRO_PLAN.continents) {
    if (result.beach) break;
    for (let bearing = 0; bearing < Math.PI * 2 && !result.beach; bearing += Math.PI / 24) {
      let lo = 0,
        hi = Math.min(1.25, continent.majorRadiusRad * 1.8);
      const pointAt = (distance: number) => {
        const sinLat = Math.sin(continent.center.lat) * Math.cos(distance) + Math.cos(continent.center.lat) * Math.sin(distance) * Math.cos(bearing),
          lat = Math.asin(Math.max(-1, Math.min(1, sinLat))),
          lon = continent.center.lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(continent.center.lat), Math.cos(distance) - Math.sin(continent.center.lat) * Math.sin(lat));
        return { lon: ((lon + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI, lat };
      };
      if (macroSampleAt(pointAt(hi)).land) continue;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (macroSampleAt(pointAt(mid)).land) lo = mid;
        else hi = mid;
      }
      for (const inset of [0.00008, 0.00016, 0.00026]) {
        const candidate = pointAt(Math.max(0, lo - inset));
        if (biomeSampleAt(candidate).biome === "beach") {
          result.beach = candidate;
          break;
        }
      }
    }
  }
  return result;
}

export function biomeEvidenceSourceSamples() {
  return Object.fromEntries(
    Object.entries(biomeEvidenceSamples()).map(([key, position]) => [key, lonLatToSource(position!.lon, position!.lat)]),
  );
}

export function polarSignatures() {
  const signature = (lon: number, lat: number) => {
    const sample = biomeSampleAt({ lon, lat });
    return `${sample.biome}/${sample.temperatureC.toFixed(3)}/${sample.moisture.toFixed(3)}/${sample.macro.domain}/${sample.macro.mountainIntensity.toFixed(3)}`;
  };
  const north = [0.1, 1.2, 2.4].map((lon) => signature(lon, 1.46)),
    south = [-0.4, -1.7, 2.1].map((lon) => signature(lon, -1.46));
  return { north, south };
}

export const BIOME_GENERATOR_VERSION = `${WORLD_FOUNDATION_VERSION}/climate-1`;
export const CLIMATE_PLANET_RADIUS_M = CANONICAL_PLANET_RADIUS;
