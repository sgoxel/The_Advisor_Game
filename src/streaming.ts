import type { TileGeometry } from "./geometry.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_WIDTH,
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

/** Root-contract hard ceilings from docs/PLANET_ARCHITECTURE.md §11.2; normal refinement may stay below them. */
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
export function classifyStreamingDevice(
  width: number,
  height: number,
): StreamingDeviceClass {
  const shortSide = Math.min(width, height),
    longSide = Math.max(width, height);
  if (shortSide <= 480) return "phone";
  if (longSide < 1200) return "tablet";
  return "desktop";
}

/** Shortest signed source-domain offset on the canonical east-west wrap. */
export function wrappedSourceDelta(fromX: number, toX: number): number {
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  return (
    ((((toX - fromX + half) % SOURCE_PRESENTATION_WIDTH) +
      SOURCE_PRESENTATION_WIDTH) %
      SOURCE_PRESENTATION_WIDTH) -
    half
  );
}

/** A render tile is legal when any of its north-south support intersects the planet. */
export function tileIntersectsPoleBand(
  tile: Pick<Tile, "minZ" | "size">,
): boolean {
  return (
    tile.minZ < SOURCE_PRESENTATION_POLE_DISTANCE &&
    tile.minZ + tile.size > -SOURCE_PRESENTATION_POLE_DISTANCE
  );
}

/** Wrap-aware source-space viewport overlap used only to choose disposable render tiles. */
export function tileIntersectsWrappedView(
  tile: Pick<Tile, "minX" | "minZ" | "size">,
  focusX: number,
  focusZ: number,
  radiusX: number,
  radiusZ: number,
): boolean {
  if (!tileIntersectsPoleBand(tile)) return false;
  const centerX = tile.minX + tile.size / 2,
    centerZ = tile.minZ + tile.size / 2,
    dx = Math.abs(wrappedSourceDelta(focusX, centerX)),
    dz = Math.abs(centerZ - focusZ);
  return dx <= radiusX + tile.size / 2 && dz <= radiusZ + tile.size / 2;
}

/** Stable cube-sphere cache identity independent of longitude-wrap representation. */
export function canonicalStreamTileKey(
  tile: Pick<Tile, "level" | "minX" | "minZ" | "size">,
): string {
  const legalMinZ = Math.max(tile.minZ, -SOURCE_PRESENTATION_POLE_DISTANCE),
    legalMaxZ = Math.min(
      tile.minZ + tile.size,
      SOURCE_PRESENTATION_POLE_DISTANCE,
    ),
    sampleZ = (legalMinZ + legalMaxZ) / 2,
    sampleX = tile.minX + tile.size / 2,
    { lon, lat } = sourceToLonLat(sampleX, sampleZ);
  return `${canonicalCellId(lon, lat, 24)}/STREAM/L${tile.level}`;
}

export type GeometryByteEstimate = { cpuBytes: number; gpuBytes: number };

/** Explicit conservative app-owned geometry estimate for both CPU and GPU residency. */
export function estimateTileGeometryBytes(
  data: TileGeometry,
): GeometryByteEstimate {
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
