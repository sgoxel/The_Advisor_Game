export type StreamingDeviceClass = "phone" | "tablet" | "desktop";

export type StreamingBudget = {
  deviceClass: StreamingDeviceClass;
  generationReady: number;
  /** Finished tiles moved to the GPU per frame at most (also bounded by UPLOAD_FRAME_BUDGET_MS). */
  maxUploadsPerFrame: number;
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
 * only at the device-sized ceiling (streamingMemoryBytesForDevice, never below 1 GB), or when required work needs room. SEED/content never depends on this policy.
 */
export const STREAMING_BUDGETS: Readonly<
  Record<StreamingDeviceClass, StreamingBudget>
> = Object.freeze({
  phone: Object.freeze({
    deviceClass: "phone",
    generationReady: 4,
    maxUploadsPerFrame: 1,
    activePatches: 89,
    ...STREAMING_MEMORY_POLICY,
    cpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
    gpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
  }),
  tablet: Object.freeze({
    deviceClass: "tablet",
    generationReady: 6,
    maxUploadsPerFrame: 1,
    activePatches: 119,
    ...STREAMING_MEMORY_POLICY,
    cpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
    gpuBytes: STREAMING_MEMORY_POLICY.combinedBytes,
  }),
  desktop: Object.freeze({
    deviceClass: "desktop",
    generationReady: 8,
    maxUploadsPerFrame: 1,
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

/**
 * Tile-generation worker pool size: every logical core except one (kept for the main thread,
 * rendering and input). The only other limit guards against the browser killing the tab for
 * memory: a worker holds ~120 MB at most, and the pool may use up to a quarter of device RAM.
 * `deviceMemoryGB` is navigator.deviceMemory (Chromium reports up to 8; Safari/Firefox omit it).
 * Generation is a pure function of the SEED, so the pool size never changes the world.
 */
export const GENERATION_WORKER_BYTES_ESTIMATE = 120_000_000;
export function generationWorkerCount(hardwareConcurrency?: number, deviceMemoryGB?: number) {
  const cores = hardwareConcurrency && hardwareConcurrency > 0 ? Math.floor(hardwareConcurrency) : 4,
    memoryBytes = (deviceMemoryGB && deviceMemoryGB > 0 ? deviceMemoryGB : 4) * 1e9,
    byMemory = Math.max(1, Math.floor(memoryBytes * .25 / GENERATION_WORKER_BYTES_ESTIMATE));
  return Math.max(1, Math.min(cores - 1, byMemory));
}

/** Main-thread milliseconds per frame that may go to moving finished tiles to the GPU. */
export const UPLOAD_FRAME_BUDGET_MS = 6;

/**
 * Tile cache memory sized to the device instead of one fixed figure: half of RAM on desktops and
 * laptops, 35% on phones and tablets (whose browsers kill tabs sooner), never below the old
 * 1 GB floor and never above 4 GB (about what one browser tab can hold).
 * `deviceMemoryGB` is navigator.deviceMemory (Chromium reports up to 8; others omit it → 4).
 */
export function streamingMemoryBytesForDevice(deviceClass: StreamingDeviceClass, deviceMemoryGB?: number) {
  const memory = (deviceMemoryGB && deviceMemoryGB > 0 ? deviceMemoryGB : 4) * 1e9,
    share = deviceClass === "desktop" ? .5 : .35;
  return Math.round(Math.max(STREAMING_MEMORY_POLICY.combinedBytes, Math.min(4e9, memory * share)));
}

/**
 * Device-class admission is a single bound for generating + ready-to-upload jobs.
 * A high-core worker pool may idle; it must never enlarge the 4/6/8 shared cap.
 * The memory policy is independent (owned by WP-S009-003-001).
 */
export function streamingBudgetForPool(width: number, height: number, _workers: number, deviceMemoryGB?: number): StreamingBudget {
  const budget = streamingBudgetForViewport(width, height), bytes = streamingMemoryBytesForDevice(budget.deviceClass, deviceMemoryGB);
  return { ...budget, cacheTrimStartBytes: bytes, combinedBytes: bytes, cpuBytes: bytes, gpuBytes: bytes };
}

/** Optional prefetch must leave one budget slot AND one idle worker for newly
 * requested on-screen tiles or authoritative resident facts. Urgent work uses
 * the full device budget; this helper never changes SEED contents or priority. */
export function canPrefetchStreamingJob(inFlight: number, ready: number, idleWorkers: number, budget: StreamingBudget): boolean {
  return idleWorkers > 1 && inFlight + ready < budget.generationReady - 1;
}
