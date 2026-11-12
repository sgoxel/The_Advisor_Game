/**
 * App-owned resource ledger (WP-S009-003-001).
 *
 * The README/PLANET_ARCHITECTURE policy is one combined CPU+GPU estimate for
 * everything the application owns, capped at 1,000,000,000 bytes. Before this
 * module the reported total was assembled inline and had two real defects:
 *
 *  1. **Queued uploads were missing from the GPU side.** Geometry waiting in the
 *     upload queue occupies CPU while pending and GPU once submitted, so the GPU
 *     total undercounted by the whole ready-upload set.
 *  2. **Nothing said what was *not* counted.** Model and texture assets, shadow
 *     maps and render targets have no measurement here, so a bare "we are under
 *     1 GB" claim would be misleading. Unmeasured classes are named explicitly
 *     instead of being silently treated as zero.
 *
 * Nothing in this module decides world truth; it only accounts for memory.
 */

export type ResourceCategory =
  | "cached-geometry-cpu"
  | "cached-geometry-gpu"
  | "ready-upload-cpu"
  | "ready-upload-gpu"
  | "surface-texture-cpu"
  | "surface-texture-gpu"
  | "continuity-worker-cpu"
  | "transient-worker-scratch"
  | "asset-textures"
  | "asset-meshes";

export type LedgerInput = {
  /** Retained terrain/feature geometry held on the CPU. */
  readonly cachedGeometryBytes: number;
  /** Queued geometry that will become GPU memory once submitted. */
  readonly readyUploadBytes: number;
  /** Globe surface texture pixels held on the CPU. */
  readonly surfaceBytes: number;
  /** Measured texture bytes from the live asset registry. */
  readonly assetTextureBytes?: number;
  /** Measured non-terrain mesh vertex/index bytes. */
  readonly assetMeshBytes?: number;
  /** Continuity data retained for the life of the page. */
  readonly continuityCpuBytes: number;
  /**
   * Continuity worker scratch and in-progress buffers. Real memory while work is
   * in flight, released afterwards — reported separately so a steady-state total
   * is never inflated by a transient peak.
   */
  readonly transientCpuBytes?: number;
  /** Texture upload overhead factor; GPU copies are padded by the driver. */
  readonly surfaceGpuFactor?: number;
};

/**
 * Resource classes that remain genuinely unmeasured. Asset textures and meshes
 * moved out of this list once the live asset registry was measurable; anything
 * still here is honestly declared rather than treated as zero.
 */
export const UNMEASURED_CATEGORIES: readonly string[] = Object.freeze([
  "shadow-maps",
  "render-targets",
  "engine-internal-pools",
]);

export type Ledger = {
  readonly categories: Readonly<Record<ResourceCategory, number>>;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly combinedBytes: number;
  /** Subset of the total that is expected to be released once work settles. */
  readonly transientBytes: number;
  /** Categories that are known to exist but are not measured by this build. */
  readonly unmeasured: readonly string[];
  /** True when the combined estimate must be treated as a lower bound. */
  readonly lowerBound: boolean;
};

const DEFAULT_SURFACE_GPU_FACTOR = 4 / 3;

/** Coerces any input to a finite non-negative byte count. */
function bytes(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Builds the combined ledger. Cached geometry is counted once per side because it
 * genuinely exists in both places (CPU copy retained for eviction/reuse, GPU copy
 * for drawing).
 */
export function buildLedger(input: LedgerInput): Ledger {
  const factor = Number.isFinite(input.surfaceGpuFactor) && (input.surfaceGpuFactor as number) > 0
    ? (input.surfaceGpuFactor as number)
    : DEFAULT_SURFACE_GPU_FACTOR;

  const cached = bytes(input.cachedGeometryBytes);
  const ready = bytes(input.readyUploadBytes);
  const surface = bytes(input.surfaceBytes);

  const categories: Record<ResourceCategory, number> = {
    "cached-geometry-cpu": cached,
    "cached-geometry-gpu": cached,
    // A queued upload is real CPU memory now, and will be real GPU memory shortly;
    // counting it on both sides is the conservative, honest choice.
    "ready-upload-cpu": ready,
    "ready-upload-gpu": ready,
    "surface-texture-cpu": surface,
    "surface-texture-gpu": Math.ceil(surface * factor),
    "continuity-worker-cpu": bytes(input.continuityCpuBytes),
    "transient-worker-scratch": bytes(input.transientCpuBytes ?? 0),
    // Measured assets live on the GPU; the CPU does not retain a second copy.
    "asset-textures": bytes(input.assetTextureBytes ?? 0),
    "asset-meshes": bytes(input.assetMeshBytes ?? 0),
  };

  const cpuBytes =
    categories["cached-geometry-cpu"] +
    categories["ready-upload-cpu"] +
    categories["surface-texture-cpu"] +
    categories["continuity-worker-cpu"] +
    categories["transient-worker-scratch"];
  const gpuBytes =
    categories["cached-geometry-gpu"] +
    categories["ready-upload-gpu"] +
    categories["surface-texture-gpu"] +
    categories["asset-textures"] +
    categories["asset-meshes"];

  return {
    categories,
    cpuBytes,
    gpuBytes,
    combinedBytes: cpuBytes + gpuBytes,
    transientBytes: categories["transient-worker-scratch"],
    unmeasured: UNMEASURED_CATEGORIES,
    lowerBound: UNMEASURED_CATEGORIES.length > 0,
  };
}

/** True when the measured ledger already exceeds the approved ceiling. */
export function exceedsCeiling(ledger: Pick<Ledger, "combinedBytes">, ceilingBytes: number): boolean {
  return ledger.combinedBytes > ceilingBytes;
}

/**
 * Trim point: once the measured total crosses this, unused caches are released
 * before the hard ceiling is reached.
 */
export function shouldTrim(ledger: Pick<Ledger, "combinedBytes">, trimStartBytes: number): boolean {
  return ledger.combinedBytes > trimStartBytes;
}
