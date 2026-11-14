/**
 * Seed failure recovery (pure rules; no DOM, no CSS, no world imports).
 *
 * The SEED is player-chosen, so some seed may one day fail to form a world
 * (a generation `throw`, in the page or in a worker). The player must never be
 * left on a frozen loading screen: bootstrap.ts uses these helpers to forget the
 * failed campaign, remember the failure for one reload, and let the seed dialog
 * explain what happened and suggest something else.
 *
 *  - `localStorage`  holds a small, capped list of seeds that failed in this browser,
 *  - `sessionStorage` holds a one-shot flag for the next load plus a recovery counter
 *    that bounds automatic reloads, so recovery can never become a reload loop.
 */
import { isValidSeedCode } from "./config.ts";

/** Dispatched on `window` by the game when a world failure is reported (worker, tile or globe failures). */
export const WORLD_FAILURE_EVENT = "advisor-world-failure";
export const FAILED_SEEDS_KEY = "advisor.failedSeeds.v1";
export const SEED_FAILURE_FLAG_KEY = "advisor.seedFailure.v1";
export const SEED_RECOVERY_COUNT_KEY = "advisor.seedRecoveries.v1";
export const MAX_FAILED_SEEDS = 20;
/** Automatic recoveries allowed in one browser tab session before the error is simply shown. */
export const MAX_RECOVERIES_PER_SESSION = 5;
const MAX_REASON_LENGTH = 160;

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SeedFailure = { readonly seed: string; readonly reason: string };

function safeStore(kind: "localStorage" | "sessionStorage"): KeyValueStore | undefined {
  try {
    return (globalThis as unknown as Record<string, Storage | undefined>)[kind] ?? undefined;
  } catch {
    return undefined;
  }
}

/** A single-line, bounded reason that is safe to show and to store. */
export function shortReason(message: unknown): string {
  const text = String(message ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= MAX_REASON_LENGTH) return text;
  return `${text.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

/* ---------------------------------------------------------------- */
/* Seeds that failed in this browser                                 */
/* ---------------------------------------------------------------- */

/** Failed seeds, oldest first. Corrupt or unreadable storage reads as an empty list. */
export function readFailedSeeds(store: KeyValueStore | undefined = safeStore("localStorage")): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(FAILED_SEEDS_KEY);
    if (!raw || raw.length > 4096) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSeedCode).slice(-MAX_FAILED_SEEDS);
  } catch {
    return [];
  }
}

/** Remembers a failed seed (most recent last, no duplicates, at most MAX_FAILED_SEEDS). Returns the stored list. */
export function recordFailedSeed(seed: string, store: KeyValueStore | undefined = safeStore("localStorage")): string[] {
  if (!isValidSeedCode(seed)) return readFailedSeeds(store);
  const next = [...readFailedSeeds(store).filter((known) => known !== seed), seed].slice(-MAX_FAILED_SEEDS);
  try {
    store?.setItem(FAILED_SEEDS_KEY, JSON.stringify(next));
  } catch {
    /* a full or blocked store only loses the memory of the failure */
  }
  return next;
}

/* ---------------------------------------------------------------- */
/* One-shot flag for the next page load                              */
/* ---------------------------------------------------------------- */

/** Stores the failure for the next load. Returns false when the session store refuses it. */
export function setSeedFailure(seed: string, reason: unknown, store: KeyValueStore | undefined = safeStore("sessionStorage")): boolean {
  if (!store || !isValidSeedCode(seed)) return false;
  try {
    store.setItem(SEED_FAILURE_FLAG_KEY, JSON.stringify({ seed, reason: shortReason(reason) }));
    return store.getItem(SEED_FAILURE_FLAG_KEY) !== null;
  } catch {
    return false;
  }
}

function parseFailure(raw: string | null): SeedFailure | undefined {
  if (!raw || raw.length > 1024) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<SeedFailure> | null;
    if (parsed && isValidSeedCode(parsed.seed)) return { seed: parsed.seed, reason: shortReason(parsed.reason) };
  } catch {
    /* a corrupt flag is no flag */
  }
  return undefined;
}

/** The pending failure, without consuming it. */
export function peekSeedFailure(store: KeyValueStore | undefined = safeStore("sessionStorage")): SeedFailure | undefined {
  try {
    return store ? parseFailure(store.getItem(SEED_FAILURE_FLAG_KEY)) : undefined;
  } catch {
    return undefined;
  }
}

/** Reads and removes the pending failure: it is shown once and never repeats. */
export function consumeSeedFailure(store: KeyValueStore | undefined = safeStore("sessionStorage")): SeedFailure | undefined {
  const failure = peekSeedFailure(store);
  try {
    store?.removeItem(SEED_FAILURE_FLAG_KEY);
  } catch {
    /* ignore */
  }
  return failure;
}

/** Number of automatic recoveries already made in this tab session. */
export function recoveryCount(store: KeyValueStore | undefined = safeStore("sessionStorage")): number {
  try {
    const value = Number(store?.getItem(SEED_RECOVERY_COUNT_KEY) ?? 0);
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function bumpRecoveryCount(store: KeyValueStore | undefined = safeStore("sessionStorage")): number {
  const next = recoveryCount(store) + 1;
  try {
    store?.setItem(SEED_RECOVERY_COUNT_KEY, String(next));
  } catch {
    /* the flag store check in planSeedRecovery still bounds the loop */
  }
  return next;
}

/* ---------------------------------------------------------------- */
/* Deciding what to do about a failure                               */
/* ---------------------------------------------------------------- */

/**
 * Failures that say nothing about the seed: no graphics device, a missing asset or
 * chunk, offline. Choosing another seed cannot fix them, so the player's campaign
 * is kept and the error is shown instead.
 */
const ENVIRONMENT_FAILURE =
  /webgl|webgpu|graphics device|gpu|renderer|canvas|failed to fetch|dynamically imported module|importing a module script|networkerror|load failed|quota|out of memory|allocation failed|invalid array length/i;

export function isEnvironmentFailure(message: unknown): boolean {
  return ENVIRONMENT_FAILURE.test(String(message ?? ""));
}

export type RecoveryInput = {
  /** The seed that failed to form a world. */
  readonly seed: string;
  readonly defaultSeed: string;
  /** True when the seed came from the test hook, so clearing the campaign cannot change it. */
  readonly seedFromHook: boolean;
  readonly message: unknown;
  readonly priorRecoveries: number;
};

export type RecoveryPlan =
  | { readonly action: "recover" }
  | { readonly action: "report"; readonly why: string };

/**
 * `recover`: forget the campaign, flag the failure and reload so the seed dialog
 * opens. `report`: leave the campaign alone and show the error honestly.
 * The default seed is never auto-recovered: it is the fallback and recovering it would loop.
 */
export function planSeedRecovery(input: RecoveryInput): RecoveryPlan {
  if (input.seed === input.defaultSeed) return { action: "report", why: "the reference seed failed; nothing safer to fall back to" };
  if (input.seedFromHook) return { action: "report", why: "the seed is fixed by a test hook" };
  if (isEnvironmentFailure(input.message)) return { action: "report", why: "the failure is about this device or network, not the seed" };
  if (input.priorRecoveries >= MAX_RECOVERIES_PER_SESSION) return { action: "report", why: "too many automatic recoveries in this session" };
  return { action: "recover" };
}

/** The notice the seed dialog shows after a recovery. */
export function failureNotice(failure: SeedFailure): string {
  return `The seed ${failure.seed} could not form a world. Please choose another.`;
}
