export type StreamingDeviceClass = "phone" | "tablet" | "desktop";

export type StreamingBudget = {
  deviceClass: StreamingDeviceClass;
  generationReady: number;
  activePatches: number;
  cachedPatches: number;
  cpuBytes: number;
  gpuBytes: number;
};

const MIB = 1024 * 1024;

/** Binding Stage S002 budgets from docs/PLANET_ARCHITECTURE.md. */
export const STREAMING_BUDGETS: Readonly<
  Record<StreamingDeviceClass, StreamingBudget>
> = Object.freeze({
  phone: Object.freeze({
    deviceClass: "phone",
    generationReady: 4,
    activePatches: 160,
    cachedPatches: 180,
    cpuBytes: 96 * MIB,
    gpuBytes: 96 * MIB,
  }),
  tablet: Object.freeze({
    deviceClass: "tablet",
    generationReady: 6,
    activePatches: 220,
    cachedPatches: 240,
    cpuBytes: 160 * MIB,
    gpuBytes: 160 * MIB,
  }),
  desktop: Object.freeze({
    deviceClass: "desktop",
    generationReady: 8,
    activePatches: 260,
    cachedPatches: 320,
    cpuBytes: 256 * MIB,
    gpuBytes: 256 * MIB,
  }),
});

/**
 * Rendering policy only. Device class never enters generation or canonical IDs.
 * Phone landscape remains a phone; 1024-class layouts remain tablets; laptop
 * and desktop widths get the desktop envelope.
 */
export function streamingDeviceClassForViewport(
  width: number,
  height: number,
): StreamingDeviceClass {
  if (!(width > 0) || !(height > 0)) return "phone";
  const shortSide = Math.min(width, height),
    longSide = Math.max(width, height);
  if (shortSide <= 600) return "phone";
  if (longSide <= 1100) return "tablet";
  return "desktop";
}

export function streamingBudgetForViewport(
  width: number,
  height: number,
): StreamingBudget {
  return STREAMING_BUDGETS[streamingDeviceClassForViewport(width, height)];
}

export type GeometryBufferSet = Record<
  string,
  {
    positions: ArrayBufferView;
    normals: ArrayBufferView;
    colors: ArrayBufferView;
    indices: ArrayBufferView;
  }
>;

/** Known application-owned mesh-buffer bytes, used as a conservative cache estimate. */
export function estimateGeometryBytes(data: GeometryBufferSet): number {
  let bytes = 0;
  for (const geometry of Object.values(data)) {
    bytes += geometry.positions.byteLength;
    bytes += geometry.normals.byteLength;
    bytes += geometry.colors.byteLength;
    bytes += geometry.indices.byteLength;
  }
  return bytes;
}

/** Helper shared by runtime and tests so queue/accounting policy has one definition. */
export function withinStreamingBudget(
  state: {
    generationReady: number;
    activePatches: number;
    cachedPatches: number;
    cpuBytes: number;
    gpuBytes: number;
  },
  budget: StreamingBudget,
): boolean {
  return (
    state.generationReady <= budget.generationReady &&
    state.activePatches <= budget.activePatches &&
    state.cachedPatches <= budget.cachedPatches &&
    state.cpuBytes <= budget.cpuBytes &&
    state.gpuBytes <= budget.gpuBytes
  );
}
