/**
 * Renderer loss/recovery contract (WP-S009-003-001).
 *
 * The GPU connection can be lost at any time (driver reset, tab backgrounded for
 * a long time, memory pressure). Two rules matter:
 *
 *  1. **Be truthful.** The old handler told the player to "reload the page" even
 *     though an automatic `devicerestored` path exists. A message that asks for a
 *     reload when recovery is actually possible is a lie about the state.
 *  2. **Recovery must not change the world.** After the device returns, focus,
 *     heading, fantasy tick, SEED and the selected resident must be identical.
 *     Only renderer-owned objects (textures, buffers, targets) are rebuilt.
 *
 * This module is deliberately pure: it decides what to do and compares state, but
 * the caller performs the engine calls.
 */

/** The parts of session state that must survive a device loss unchanged. */
export type PreservedState = {
  readonly seed: string;
  readonly fantasyTick: number;
  readonly focusLon: number;
  readonly focusLat: number;
  readonly heading: number;
  readonly selectedCanonicalId: string | null;
  readonly campaignId: string | null;
};

/** A resource class the renderer must rebuild after a device loss. */
export type RebuildTarget = "globe-surface" | "terrain-meshes" | "materials" | "render-targets" | "actor-textures";

/**
 * What to rebuild, in order. Pure renderer presentation only — no Simulation
 * state, no SEED facts, no positions.
 */
export const RECOVERY_ORDER: readonly RebuildTarget[] = Object.freeze([
  "render-targets",
  "globe-surface",
  "materials",
  "terrain-meshes",
  "actor-textures",
]);

export type LossReport = {
  /** Truthful, player-facing text. Never asks for a reload when restore is possible. */
  readonly message: string;
  /** Whether the render loop should stay paused. */
  readonly pauseRendering: boolean;
  /** State captured so recovery can be proven to have changed nothing. */
  readonly snapshot: PreservedState;
};

export type RecoveryReport = {
  readonly ok: boolean;
  readonly message: string;
  /** Categories actually rebuilt, in order. */
  readonly rebuilt: readonly RebuildTarget[];
  /** True only when every preserved field matched the pre-loss snapshot. */
  readonly statePreserved: boolean;
  /** Human-readable list of fields that changed, for honest reporting. */
  readonly changed: readonly string[];
};

/** Captures the loss decision and the state that must survive it. */
export function describeDeviceLoss(state: PreservedState): LossReport {
  return {
    message:
      "The GPU connection was lost. Your campaign is untouched — rendering will resume automatically if the device comes back.",
    pauseRendering: true,
    snapshot: { ...state },
  };
}

/** Compares two preserved-state snapshots. Sub-millimetre drift is tolerated. */
export function comparePreservedState(before: PreservedState, after: PreservedState): string[] {
  const changed: string[] = [];
  if (before.seed !== after.seed) changed.push("seed");
  if (before.fantasyTick !== after.fantasyTick) changed.push("fantasyTick");
  // Focus is a smoothed camera value; floating point churn must not read as a jump.
  if (Math.abs(before.focusLon - after.focusLon) > 1e-9) changed.push("focusLon");
  if (Math.abs(before.focusLat - after.focusLat) > 1e-9) changed.push("focusLat");
  if (Math.abs(before.heading - after.heading) > 1e-9) changed.push("heading");
  if (before.selectedCanonicalId !== after.selectedCanonicalId) changed.push("selectedCanonicalId");
  if (before.campaignId !== after.campaignId) changed.push("campaignId");
  return changed;
}

/**
 * Builds the recovery report from what was actually rebuilt. `ok` requires both a
 * completed rebuild list and unchanged preserved state — a recovery that lost the
 * player's focus is not a success.
 */
export function describeRecovery(
  before: PreservedState,
  after: PreservedState,
  rebuilt: readonly RebuildTarget[],
): RecoveryReport {
  const changed = comparePreservedState(before, after);
  const statePreserved = changed.length === 0;
  const complete = rebuilt.length === RECOVERY_ORDER.length;
  if (!statePreserved) {
    return {
      ok: false,
      message: `Rendering resumed, but session state changed (${changed.join(", ")}).`,
      rebuilt,
      statePreserved,
      changed,
    };
  }
  if (!complete) {
    return {
      ok: false,
      message: "Rendering resumed, but some renderer resources were not rebuilt.",
      rebuilt,
      statePreserved,
      changed,
    };
  }
  return {
    ok: true,
    message: "Rendering restored. Your campaign, focus and selection are unchanged.",
    rebuilt,
    statePreserved,
    changed,
  };
}

/**
 * True when a loss should be treated as recoverable. A WebGL context loss or a
 * WebGPU device-lost-with-restore is recoverable; a permanently failed device is
 * not, and must keep the honest failure path.
 */
export function isRecoverableLoss(reason: string): boolean {
  const text = reason.toLowerCase();
  if (text.includes("destroyed") || text.includes("destroy")) return false;
  return true;
}
