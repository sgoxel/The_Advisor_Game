import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  canonicalCell,
  cubeFaceToUnit,
  unitToLonLat,
  type CubeCell,
  type LonLat,
} from "./planet.ts";
import {
  MACRO_GEOGRAPHY,
  buildMacroGeography,
  sampleMacroGeography,
  type MountainKind,
} from "./macro-geography.ts";

export const CANONICAL_GENERATOR_VERSION = WORLD_FOUNDATION_VERSION;

export type FoundationSample = {
  id: string;
  sample: number;
  landform: "Mainland" | "Island" | "Ocean";
  continent: number | null;
  island: number | null;
  lake: number | null;
  lakeCode: string | null;
  mountainSystem: string | null;
  mountainKind: MountainKind | null;
};

/** Stable content digest: a coordinate lookup, never a mutable RNG stream. */
function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

/** Centre point of a canonical cube-sphere cell. */
export function canonicalCellCenter(cell: CubeCell): LonLat {
  const count = 2 ** cell.level,
    u = ((cell.u + 0.5) / count) * 2 - 1,
    v = ((cell.v + 0.5) / count) * 2 - 1;
  return unitToLonLat(cubeFaceToUnit(cell.face, u, v));
}

/** Neighbor through cube projection; face-edge ownership remains canonical. */
export function canonicalCellNeighbor(
  cell: CubeCell,
  du: number,
  dv: number,
  seed = WORLD_SEED,
  generation = CANONICAL_GENERATOR_VERSION,
): CubeCell {
  if (!Number.isInteger(du) || !Number.isInteger(dv))
    throw new RangeError("Canonical neighbor offsets must be integers");
  const count = 2 ** cell.level,
    u = ((cell.u + 0.5 + du) / count) * 2 - 1,
    v = ((cell.v + 0.5 + dv) / count) * 2 - 1,
    point = unitToLonLat(cubeFaceToUnit(cell.face, u, v));
  return canonicalCell(point.lon, point.lat, cell.level, seed, generation);
}

export function canonicalCellNeighbors(
  cell: CubeCell,
  seed = WORLD_SEED,
  generation = CANONICAL_GENERATOR_VERSION,
) {
  return {
    west: canonicalCellNeighbor(cell, -1, 0, seed, generation),
    east: canonicalCellNeighbor(cell, 1, 0, seed, generation),
    south: canonicalCellNeighbor(cell, 0, -1, seed, generation),
    north: canonicalCellNeighbor(cell, 0, 1, seed, generation),
  };
}

/** Seed + canonical position is the sole foundation input, including macro identity. */
export function canonicalFoundationSample(
  lon: number,
  lat: number,
  level = 20,
  seed = WORLD_SEED,
  generation = CANONICAL_GENERATOR_VERSION,
): FoundationSample {
  const cell = canonicalCell(lon, lat, level, seed, generation),
    authority = seed === WORLD_SEED && generation === WORLD_FOUNDATION_VERSION
      ? MACRO_GEOGRAPHY
      : buildMacroGeography(seed),
    macro = sampleMacroGeography({ lon, lat }, authority);
  return {
    id: cell.id,
    sample: digest(`${cell.id}/FOUNDATION`),
    landform: macro.landform,
    continent: macro.continent,
    island: macro.island,
    lake: macro.lake,
    lakeCode: macro.lakeCode,
    mountainSystem: macro.mountainSystem,
    mountainKind: macro.mountainKind,
  };
}
