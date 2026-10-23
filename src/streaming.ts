export type StreamingDeviceClass = "phone" | "tablet" | "desktop";

export type StreamingBudget = {
  deviceClass: StreamingDeviceClass;
  generationReady: number;
  activePatches: number;
  cacheTrimStartBytes: number;
  combinedBytes: number;
  cpuBytes: number;
  gpuBytes: number;
};

/** Owner policy, 2026-10-23: decimal MB/GB, combined CPU+GPU estimates.
 * A55/Chrome reference; these are application policies, not browser RAM quotas. */
export const STREAMING_MEMORY_POLICY=Object.freeze({cacheTrimStartBytes:1_000_000_000,combinedBytes:1_000_000_000});

/**
 * Queue and active-render bounds vary with viewport; cache retention is byte-based.
 * Old and incoming coverage stay protected while unused cache entries are trimmed
 * only at the owner's 1 GB ceiling, or when required work needs room. SEED/content never depends on this policy.
 */
export const STREAMING_BUDGETS: Readonly<
  Record<StreamingDeviceClass, StreamingBudget>
> = Object.freeze({
  phone: Object.freeze({
    deviceClass: "phone",
    generationReady: 4,
    activePatches: 89,
    ...STREAMING_MEMORY_POLICY,
    cpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
    gpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
  }),
  tablet: Object.freeze({
    deviceClass: "tablet",
    generationReady: 6,
    activePatches: 119,
    ...STREAMING_MEMORY_POLICY,
    cpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
    gpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
  }),
  desktop: Object.freeze({
    deviceClass: "desktop",
    generationReady: 8,
    activePatches: 159,
    ...STREAMING_MEMORY_POLICY,
    cpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
    gpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
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
    uvs?: ArrayBufferView;
  }
>;

/** Known application-owned mesh-buffer bytes, used as a conservative cache estimate. */
export function estimateGeometryBytes(data: object): number {
  let bytes = 0;
  for (const geometry of Object.values(data) as GeometryBufferSet[string][]) {
    bytes += geometry.positions.byteLength;
    bytes += geometry.normals.byteLength;
    bytes += geometry.colors.byteLength;
    bytes += geometry.indices.byteLength;
    bytes += geometry.uvs?.byteLength ?? 0;
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
    state.cpuBytes <= budget.cpuBytes &&
    state.gpuBytes <= budget.gpuBytes &&
    state.cpuBytes + state.gpuBytes <= budget.combinedBytes
  );
}

/** Reusable terrain remains cached below the ceiling, irrespective of
 * patch count. A single optional reservation represents upcoming transient work. */
export function shouldTrimStreamingCache(cpuBytes:number,gpuBytes:number,budget:StreamingBudget,reservationBytes=0){return cpuBytes+gpuBytes+reservationBytes>budget.cacheTrimStartBytes;}
export function streamingMemoryReservationFits(cpuBytes:number,gpuBytes:number,reservationBytes:number,budget:StreamingBudget){return cpuBytes+gpuBytes+reservationBytes<=budget.combinedBytes;}
