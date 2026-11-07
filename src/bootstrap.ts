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
import { COARSE_GEOGRAPHY_VERSION, WORLD_SEED } from "./config.ts";
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

async function start(): Promise<void> {
  mountBuildBadge();
  const restored = await hydrateSettlementFoundation();
  provideHydratedSettlements(restored);
  if (restored) {
    (globalThis as Record<string, unknown>).__advisorFoundationHydrated = {
      family: "settlements", seed: WORLD_SEED, version: COARSE_GEOGRAPHY_VERSION,
      cities: restored.cities.length, villages: restored.villages.length,
    };
  }
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
}

void start();
