/**
 * World SEED selection. This module has NO imports on purpose: `campaign.ts`
 * imports from here, so anything it pulled in would create a cycle.
 *
 * The SEED is the single authority for world foundation. Its value is chosen
 * before any world module is evaluated, in this order:
 *   0. inside a Web Worker: the seed the page passed in the worker's `name`
 *      (workers have no localStorage and no page globals, so without this they
 *      would silently build the DEFAULT world while the page shows another),
 *   1. `globalThis.__ADVISOR_SEED__` (test hook, when it is a valid seed),
 *   2. the SEED of the stored campaign record (the player's chosen world),
 *   3. DEFAULT_WORLD_SEED (the reference scenario, used when nothing is stored).
 * Storage is read defensively: a missing, corrupt or unreadable record falls back
 * to the default and never throws.
 */

export const DEFAULT_WORLD_SEED = "ADVISOR-0126-ALDERWICK";
/** Must match `CAMPAIGN_STORAGE_KEY` in campaign.ts (re-exported from there). */
export const CAMPAIGN_STORAGE_KEY = "advisor.campaign.v1";
const SEED_PATTERN = /^[A-Za-z0-9-]{1,96}$/;
const MAX_STORED_RECORD_LENGTH = 4096;

/** True for a seed code the world can be generated from: 1-96 characters of [A-Za-z0-9-]. */
export function isValidSeedCode(value: unknown): value is string {
  return typeof value === "string" && SEED_PATTERN.test(value);
}

const WORKER_NAME_PREFIX = "advisor-seed:";

/** The `name` option the page gives every Worker it creates, so the worker builds the page's world. */
export function workerNameForSeed(seed: string): string {
  return `${WORKER_NAME_PREFIX}${seed}`;
}

/** The seed carried by a worker `name`, or undefined when the name carries none. */
export function seedFromWorkerName(name: unknown): string | undefined {
  if (typeof name !== "string" || !name.startsWith(WORKER_NAME_PREFIX)) return undefined;
  const seed = name.slice(WORKER_NAME_PREFIX.length);
  return isValidSeedCode(seed) ? seed : undefined;
}

/** Pure seed resolution (see the module comment for precedence). */
export function resolveWorldSeed(hook: unknown, storedRaw: string | null | undefined, workerName?: unknown): string {
  const fromWorker = seedFromWorkerName(workerName);
  if (fromWorker !== undefined) return fromWorker;
  if (isValidSeedCode(hook)) return hook;
  if (typeof storedRaw === "string" && storedRaw.length > 0 && storedRaw.length <= MAX_STORED_RECORD_LENGTH) {
    try {
      const parsed = JSON.parse(storedRaw) as { seed?: unknown } | null;
      if (parsed && isValidSeedCode(parsed.seed)) return parsed.seed;
    } catch {
      /* corrupt record: the reference scenario is used; campaign.ts reports it */
    }
  }
  return DEFAULT_WORLD_SEED;
}

function readStoredRaw(): string | null {
  try {
    return globalThis.localStorage?.getItem(CAMPAIGN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** `self.name` when running inside a dedicated worker; undefined on the page and in Node. */
function workerScopeName(): unknown {
  const scope = globalThis as { WorkerGlobalScope?: new () => unknown; name?: unknown };
  return typeof scope.WorkerGlobalScope === "function" && globalThis instanceof scope.WorkerGlobalScope
    ? scope.name
    : undefined;
}

/** The SEED every world module is generated from in this page load (and in each of its workers). */
export const WORLD_SEED: string = resolveWorldSeed(
  (globalThis as { __ADVISOR_SEED__?: unknown }).__ADVISOR_SEED__,
  readStoredRaw(),
  workerScopeName(),
);

/** Seeded macro-geography + canonical climate/material foundation. Backward compatibility is intentionally not retained. */
export const WORLD_FOUNDATION_VERSION = "v5";
/** Retain accepted macro/political/climate recipes while terrain/drainage move to v5. */
export const COARSE_GEOGRAPHY_VERSION = "v4";
