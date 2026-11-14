/**
 * Browser bootstrap for WP-S009-006-001.
 *
 * The world modules build their SEED-derived foundations at import time, so a
 * durable foundation can only be reused if it is read *before* those modules
 * are evaluated. This module does exactly that:
 *
 *   1. read the digest-verified settlement foundation from persistent storage
 *      (bounded wait; missing/corrupt/stale storage resolves to "regenerate"),
 *   2. hand it to `geography` through the foundation cache,
 *   3. import the unchanged application modules in their original order.
 *
 * Storage is never authority: if anything about the persisted record is wrong,
 * the deterministic generator produces the identical world as before.
 */
import {
  foundationCache,
  provideHydratedSettlements,
  settlementFoundationKey,
  validateSettlementFoundation,
  type SettlementFoundationPayload,
} from "./foundation-cache.ts";
import { COARSE_GEOGRAPHY_VERSION, DEFAULT_WORLD_SEED, WORLD_SEED } from "./config.ts";
import { campaignNeedsChoice, clearCampaign, readCampaign, resolveCampaign, saveNewCampaign } from "./campaign.ts";
import {
  WORLD_FAILURE_EVENT,
  bumpRecoveryCount,
  consumeSeedFailure,
  failureNotice,
  planSeedRecovery,
  recordFailedSeed,
  recoveryCount,
  setSeedFailure,
  shortReason,
} from "./seed-recovery.ts";
import { askForNewCampaign, mountNewCampaignEntry } from "./seed-dialog.ts";
import { mountBuildBadge } from "./build-info.ts";

/** Hydration must never delay startup noticeably; a slow disk simply regenerates. */
const HYDRATION_TIMEOUT_MS = 1500;

async function hydrationDeadline<T>(work: Promise<T>, fallback: T, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function hydrateSettlementFoundation(): Promise<SettlementFoundationPayload | undefined> {
  const cache = foundationCache();
  if (!cache.durable) return undefined;
  try {
    return await hydrationDeadline(
      cache.load<SettlementFoundationPayload>(
        settlementFoundationKey(WORLD_SEED, COARSE_GEOGRAPHY_VERSION),
        validateSettlementFoundation,
      ),
      undefined,
      HYDRATION_TIMEOUT_MS,
    );
  } catch {
    return undefined;
  }
}

/**
 * Safety net: a seed that cannot form a world must never leave the player on a
 * frozen loading screen. Until the world reports ready, any generation failure
 * (import-time throw, uncaught error, rejected promise, worker/tile failure) on a
 * player-chosen seed forgets that campaign, remembers the seed as failed and reloads
 * into the seed dialog. The default seed, a hook-fixed seed, device failures and
 * repeated failures only show the error: no loop is possible.
 */
let recovering = false;

function worldIsReady(): boolean {
  const world = (window as unknown as { advisorWorld?: { state?: { ready?: boolean } } }).advisorWorld;
  return world?.state?.ready === true;
}

function showStartupError(message: string): void {
  const error = document.getElementById("error");
  if (!error) return;
  document.getElementById("loading")?.setAttribute("hidden", "");
  if (error.hidden) {
    error.hidden = false;
    error.textContent = message;
  }
}

function handleStartupFailure(raw: unknown): void {
  if (recovering || worldIsReady()) return;
  const message = shortReason(raw instanceof Error ? raw.message : raw);
  const plan = planSeedRecovery({
    seed: WORLD_SEED,
    defaultSeed: DEFAULT_WORLD_SEED,
    seedFromHook: (globalThis as { __ADVISOR_SEED__?: unknown }).__ADVISOR_SEED__ !== undefined,
    message,
    priorRecoveries: recoveryCount(),
  });
  console.error(`[advisor] startup failure for seed ${WORLD_SEED}: ${message} (${plan.action})`);
  if (plan.action === "report") {
    showStartupError(`The world could not be built: ${message}`);
    return;
  }
  recovering = true;
  recordFailedSeed(WORLD_SEED);
  if (!setSeedFailure(WORLD_SEED, message)) {
    recovering = false;
    showStartupError(`Seed ${WORLD_SEED} could not form a world: ${message}. Browser storage is unavailable, so it could not be replaced automatically.`);
    return;
  }
  bumpRecoveryCount();
  clearCampaign();
  if (readCampaign().record) {
    recovering = false;
    showStartupError(`Seed ${WORLD_SEED} could not form a world: ${message}. The saved campaign could not be cleared in this browser.`);
    return;
  }
  location.reload();
}

function watchStartupFailures(): void {
  window.addEventListener("error", (event) => {
    // Resource and cross-origin noise carries no error object; only real throws count.
    if (event.error === undefined || event.error === null) return;
    handleStartupFailure(event.error);
  });
  window.addEventListener("unhandledrejection", (event) => handleStartupFailure(event.reason));
  window.addEventListener(WORLD_FAILURE_EVENT, (event) => handleStartupFailure((event as CustomEvent).detail));
}

/**
 * Test/dev hook, documented in docs/VERIFICATION.md: `globalThis.__ADVISOR_FORCE_GENERATION_FAILURE__`
 * makes generation fail on purpose so the recovery path can be proved without touching
 * generation code. `true` or "sync": throw while the world modules load; "async": an
 * uncaught error shortly after load starts; any seed code: fail only for that seed.
 * The default seed never fails on purpose, so recovery always has somewhere to land.
 */
function forcedGenerationFailure(): void {
  const hook = (globalThis as { __ADVISOR_FORCE_GENERATION_FAILURE__?: unknown }).__ADVISOR_FORCE_GENERATION_FAILURE__;
  if (hook === undefined || hook === false || WORLD_SEED === DEFAULT_WORLD_SEED) return;
  if (typeof hook === "string" && hook !== "sync" && hook !== "async" && hook !== WORLD_SEED) return;
  if (hook === "async") {
    setTimeout(() => { throw new Error(`Forced generation failure (test hook) for seed ${WORLD_SEED}`); }, 50);
    return;
  }
  throw new Error(`Forced generation failure (test hook) for seed ${WORLD_SEED}`);
}

async function start(): Promise<void> {
  mountBuildBadge();
  watchStartupFailures();
  // A seed that failed on the previous load is reported once, in the dialog below.
  const previousFailure = consumeSeedFailure();
  // A new campaign starts with the player's seed choice, before any world module
  // is evaluated. The seed is read by config.ts at module init, so a different
  // choice needs a reload; the reload finds the stored campaign and does not ask again.
  // The test hook skips the dialog so automated captures keep their fixed seed.
  if (!seedHookSet() && campaignNeedsChoice()) {
    const chosen = await askForNewCampaign(
      (seed) => saveNewCampaign(seed),
      document,
      previousFailure ? { message: failureNotice(previousFailure), detail: previousFailure.reason || undefined } : undefined,
    );
    if (chosen !== WORLD_SEED) {
      location.reload();
      return;
    }
  }
  // Resolve the campaign BEFORE importing any world module. `clock.ts` fixes its
  // epoch at module init from the stored campaign, so creating the campaign only
  // afterwards would make the first page load use the demo epoch and then jump to
  // the real one on reload — fantasy time must never run backwards.
  resolveCampaign();
  const restored = await hydrateSettlementFoundation();
  provideHydratedSettlements(restored);
  if (restored) {
    (globalThis as Record<string, unknown>).__advisorFoundationHydrated = {
      family: "settlements", seed: WORLD_SEED, version: COARSE_GEOGRAPHY_VERSION,
      cities: restored.cities.length, villages: restored.villages.length,
    };
  }
  forcedGenerationFailure();
  // Same modules, same order as the previous static <script type="module"> tags.
  await import("./transport-network.ts");
  await import("./main.ts");
  await import("./information-panel.ts");
  await import("./canonical-inspector.ts");
  await import("./travel-ui.ts");
  await import("./routing-diagnostics.ts");
  await import("./political-settlement-access.ts");
  await import("./political-atlas.ts");
  await import("./transport-inspector.ts");
  await import("./site-experience.ts");
  await import("./popup-panels.ts");
  mountNewCampaignEntry();
}

function seedHookSet(): boolean {
  // Automated browsers (Playwright/CI evidence, screenshot tool) keep the default
  // campaign instead of waiting on the interactive seed dialog.
  if (typeof navigator !== "undefined" && navigator.webdriver) return true;
  return (globalThis as { __ADVISOR_SEED__?: unknown }).__ADVISOR_SEED__ !== undefined;
}

start().catch(handleStartupFailure);
