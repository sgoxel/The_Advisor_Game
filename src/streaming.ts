import type { TileGeometry } from "./geometry.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  canonicalCellId,
  sourceToLonLat,
} from "./planet.ts";
import type { Tile } from "./world.ts";

const MIB = 1024 * 1024;

export type StreamingDeviceClass = "phone" | "tablet" | "desktop";
export type StreamingBudget = {
  queue: number;
  active: number;
  cached: number;
  cpuBytes: number;
  gpuBytes: number;
};

/** Root-contract budgets from docs/PLANET_ARCHITECTURE.md §11.2. */
export const STREAMING_BUDGETS: Readonly<Record<StreamingDeviceClass, StreamingBudget>> =
  Object.freeze({
    phone: Object.freeze({
      queue: 4,
      active: 160,
      cached: 180,
      cpuBytes: 96 * MIB,
      gpuBytes: 96 * MIB,
    }),
    tablet: Object.freeze({
      queue: 6,
      active: 220,
      cached: 240,
      cpuBytes: 160 * MIB,
      gpuBytes: 160 * MIB,
    }),
    desktop: Object.freeze({
      queue: 8,
      active: 260,
      cached: 320,
      cpuBytes: 256 * MIB,
      gpuBytes: 256 * MIB,
    }),
  });

/** Presentation/device policy only; it never changes world identity or values. */
export function classifyStreamingDevice(width: number, height: number): StreamingDeviceClass {
  const shortSide = Math.min(width, height);
  if (shortSide <= 480) return "phone";
  if (shortSide <= 900) return "tablet";
  return "desktop";
}

/** Stable cube-sphere cache identity independent of longitude-wrap representation. */
export function canonicalStreamTileKey(tile: Tile): string {
  const legalMinZ = Math.max(tile.minZ, -SOURCE_PRESENTATION_POLE_DISTANCE),
    legalMaxZ = Math.min(tile.minZ + tile.size, SOURCE_PRESENTATION_POLE_DISTANCE),
    sampleZ = (legalMinZ + legalMaxZ) / 2,
    sampleX = tile.minX + tile.size / 2,
    { lon, lat } = sourceToLonLat(sampleX, sampleZ);
  return `${canonicalCellId(lon, lat, 24)}/STREAM/L${tile.level}`;
}

export type GeometryByteEstimate = { cpuBytes: number; gpuBytes: number };

/** Explicit conservative app-owned geometry estimate for both CPU and GPU residency. */
export function estimateTileGeometryBytes(data: TileGeometry): GeometryByteEstimate {
  let bytes = 0;
  for (const geometry of Object.values(data))
    bytes +=
      geometry.positions.byteLength +
      geometry.normals.byteLength +
      geometry.colors.byteLength +
      geometry.indices.byteLength;
  return { cpuBytes: bytes, gpuBytes: bytes };
}

export function withinStreamingBudget(
  budget: StreamingBudget,
  active: number,
  cached: number,
  queue: number,
  cpuBytes: number,
  gpuBytes: number,
): boolean {
  return (
    active <= budget.active &&
    cached <= budget.cached &&
    queue <= budget.queue &&
    cpuBytes <= budget.cpuBytes &&
    gpuBytes <= budget.gpuBytes
  );
}
