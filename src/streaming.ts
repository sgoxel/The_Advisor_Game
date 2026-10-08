import type { TileGeometry } from "./geometry.ts";

export type DeviceClass = "phone" | "tablet" | "desktop";
export type StreamingBudget = {
  deviceClass: DeviceClass;
  generationReadyQueue: number;
  activePatches: number;
  cachedPatches: number;
  cpuBytes: number;
  gpuBytes: number;
};

const MiB = 1024 * 1024;

export const STREAMING_BUDGETS: Readonly<Record<DeviceClass, StreamingBudget>> =
  Object.freeze({
    phone: Object.freeze({
      deviceClass: "phone",
      generationReadyQueue: 4,
      activePatches: 160,
      cachedPatches: 180,
      cpuBytes: 96 * MiB,
      gpuBytes: 96 * MiB,
    }),
    tablet: Object.freeze({
      deviceClass: "tablet",
      generationReadyQueue: 6,
      activePatches: 220,
      cachedPatches: 240,
      cpuBytes: 160 * MiB,
      gpuBytes: 160 * MiB,
    }),
    desktop: Object.freeze({
      deviceClass: "desktop",
      generationReadyQueue: 8,
      activePatches: 260,
      cachedPatches: 320,
      cpuBytes: 256 * MiB,
      gpuBytes: 256 * MiB,
    }),
  });

/**
 * Deterministic presentation-only device class. It changes budgets, never world
 * identity or generated content. The seven Stage S002 regression viewports map
 * phone portrait/landscape to phone, tablets to tablet and laptop/desktop to desktop.
 */
export function deviceClassForViewport(width: number, height: number): DeviceClass {
  const shortSide = Math.min(width, height),
    longSide = Math.max(width, height);
  if (shortSide <= 500 && longSide <= 900) return "phone";
  if (shortSide <= 800 && longSide <= 1100) return "tablet";
  return "desktop";
}

export function streamingBudgetForViewport(
  width: number,
  height: number,
): StreamingBudget {
  return STREAMING_BUDGETS[deviceClassForViewport(width, height)];
}

/** Explicit app-owned geometry byte estimate used for cache accounting. */
export function estimateTileGeometryBytes(data: TileGeometry): number {
  let total = 0;
  for (const geometry of Object.values(data))
    total +=
      geometry.positions.byteLength +
      geometry.normals.byteLength +
      geometry.colors.byteLength +
      geometry.indices.byteLength;
  return total;
}
