/**
 * A player-chosen seed must never leave the game frozen. Pure rules only (no DOM):
 * the failed-seed memory, the one-shot failure flag, the recovery decision, the
 * suggestion that avoids failed seeds, and the seed that workers build the world from.
 * The reload path itself is proved in the browser (docs/VERIFICATION.md).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { suggestSeed } from "../src/campaign.ts";
import { DEFAULT_WORLD_SEED, resolveWorldSeed, seedFromWorkerName, workerNameForSeed } from "../src/config.ts";
import {
  FAILED_SEEDS_KEY,
  MAX_FAILED_SEEDS,
  MAX_RECOVERIES_PER_SESSION,
  bumpRecoveryCount,
  consumeSeedFailure,
  failureNotice,
  isEnvironmentFailure,
  peekSeedFailure,
  planSeedRecovery,
  readFailedSeeds,
  recordFailedSeed,
  recoveryCount,
  setSeedFailure,
  shortReason,
  type KeyValueStore,
} from "../src/seed-recovery.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

const NOW = Date.UTC(2026, 10, 14);

test("the failure flag is set, readable, and consumed exactly once", () => {
  const store = memoryStore();
  assert.equal(peekSeedFailure(store), undefined);
  assert.equal(setSeedFailure("ADVISOR-0126-STONELEY", "No bounded road-linked harbor", store), true);
  assert.deepEqual(peekSeedFailure(store), { seed: "ADVISOR-0126-STONELEY", reason: "No bounded road-linked harbor" });
  assert.deepEqual(consumeSeedFailure(store), { seed: "ADVISOR-0126-STONELEY", reason: "No bounded road-linked harbor" });
  assert.equal(consumeSeedFailure(store), undefined, "the flag is one-shot");
  assert.equal(store.data.size, 0);
});

test("the failure flag refuses invalid seeds, corrupt data and missing storage without throwing", () => {
  const store = memoryStore();
  assert.equal(setSeedFailure("not a seed", "x", store), false);
  assert.equal(setSeedFailure("ADVISOR-0126-OAK", "x", undefined), false);
  assert.equal(consumeSeedFailure(undefined), undefined);
  assert.equal(consumeSeedFailure(memoryStore({ "advisor.seedFailure.v1": "{broken" })), undefined);
  assert.equal(consumeSeedFailure(memoryStore({ "advisor.seedFailure.v1": JSON.stringify({ seed: "bad seed" }) })), undefined);
  const throwing: KeyValueStore = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  assert.equal(setSeedFailure("ADVISOR-0126-OAK", "x", throwing), false);
  assert.equal(consumeSeedFailure(throwing), undefined);
  assert.deepEqual(readFailedSeeds(throwing), []);
  assert.doesNotThrow(() => recordFailedSeed("ADVISOR-0126-OAK", throwing));
});

test("reasons are one bounded line", () => {
  assert.equal(shortReason("a\n  b\tc"), "a b c");
  assert.ok(shortReason("x".repeat(500)).length <= 160);
  assert.equal(shortReason(undefined), "");
});

test("the failed-seed list keeps the newest entries, without duplicates, capped", () => {
  const store = memoryStore();
  for (let i = 0; i < MAX_FAILED_SEEDS + 7; i++) recordFailedSeed(`ADVISOR-0126-FAIL${i}`, store);
  const list = readFailedSeeds(store);
  assert.equal(list.length, MAX_FAILED_SEEDS);
  assert.equal(list.at(-1), `ADVISOR-0126-FAIL${MAX_FAILED_SEEDS + 6}`);
  assert.equal(list[0], "ADVISOR-0126-FAIL7", "the oldest entries are dropped");
  recordFailedSeed("ADVISOR-0126-FAIL10", store);
  const again = readFailedSeeds(store);
  assert.equal(again.length, MAX_FAILED_SEEDS);
  assert.equal(again.at(-1), "ADVISOR-0126-FAIL10", "re-recording moves a seed to the end");
  assert.equal(again.filter((s) => s === "ADVISOR-0126-FAIL10").length, 1);
  recordFailedSeed("has spaces", store);
  assert.equal(readFailedSeeds(store).length, MAX_FAILED_SEEDS, "invalid seeds are not stored");
});

test("a corrupt or oversized failed-seed record reads as empty", () => {
  assert.deepEqual(readFailedSeeds(memoryStore({ [FAILED_SEEDS_KEY]: "{nope" })), []);
  assert.deepEqual(readFailedSeeds(memoryStore({ [FAILED_SEEDS_KEY]: JSON.stringify({ a: 1 }) })), []);
  assert.deepEqual(readFailedSeeds(memoryStore({ [FAILED_SEEDS_KEY]: JSON.stringify(["ADVISOR-0126-OAK", 5, "bad seed"]) })), ["ADVISOR-0126-OAK"]);
  assert.deepEqual(readFailedSeeds(memoryStore({ [FAILED_SEEDS_KEY]: "x".repeat(5000) })), []);
});

test("suggestSeed never returns a failed seed, whatever the random source does", () => {
  const first = suggestSeed(NOW, () => 0, []);
  assert.match(first, /^ADVISOR-\d{4}-[A-Z]+$/);
  // A constant random source would suggest the same name forever without avoidance.
  const second = suggestSeed(NOW, () => 0, [first]);
  assert.notEqual(second, first);
  const third = suggestSeed(NOW, () => 0, [first, second]);
  assert.ok(third !== first && third !== second);
  // Avoidance is case-insensitive and also covers the suffix fallback.
  assert.notEqual(suggestSeed(NOW, () => 0, [first.toLowerCase()]), first);
  const all: string[] = [];
  for (let i = 0; i < 700; i++) all.push(suggestSeed(NOW, () => 0, all));
  assert.equal(new Set(all).size, 700, "even when every head+tail name is taken a fresh seed exists");
  assert.ok(all.every((seed) => /^[A-Za-z0-9-]{1,96}$/.test(seed)));
});

test("suggestSeed reads the browser's failed seeds by default", () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  try {
    const failed = suggestSeed(NOW, () => 0, []);
    recordFailedSeed(failed);
    assert.notEqual(suggestSeed(NOW, () => 0), failed);
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test("recovery plan: a player-chosen seed that fails is recovered, everything else is only reported", () => {
  const base = { seed: "ADVISOR-0126-STONELEY", defaultSeed: DEFAULT_WORLD_SEED, seedFromHook: false, message: "Capital missing", priorRecoveries: 0 };
  assert.deepEqual(planSeedRecovery(base), { action: "recover" });
  assert.equal(planSeedRecovery({ ...base, seed: DEFAULT_WORLD_SEED }).action, "report", "the default seed is never auto-recovered");
  assert.equal(planSeedRecovery({ ...base, seedFromHook: true }).action, "report", "a hook-fixed seed would loop");
  assert.equal(planSeedRecovery({ ...base, message: "WebGPU and WebGL2 are unavailable" }).action, "report");
  assert.equal(planSeedRecovery({ ...base, message: "Failed to fetch dynamically imported module: /assets/x.js" }).action, "report");
  assert.equal(planSeedRecovery({ ...base, priorRecoveries: MAX_RECOVERIES_PER_SESSION - 1 }).action, "recover");
  assert.equal(planSeedRecovery({ ...base, priorRecoveries: MAX_RECOVERIES_PER_SESSION }).action, "report", "bounded: no reload loop");
});

test("generation errors are not mistaken for environment failures", () => {
  for (const message of [
    "Seeded macro plan could not place three separated continents",
    "No bounded road-linked harbor",
    "Capital missing",
    "Tile generation failed: Error: Unknown resident settlement",
  ]) assert.equal(isEnvironmentFailure(message), false, message);
});

test("the recovery counter is bounded per session store", () => {
  const store = memoryStore();
  assert.equal(recoveryCount(store), 0);
  assert.equal(bumpRecoveryCount(store), 1);
  assert.equal(bumpRecoveryCount(store), 2);
  assert.equal(recoveryCount(store), 2);
  assert.equal(recoveryCount(memoryStore({ "advisor.seedRecoveries.v1": "junk" })), 0);
});

test("the dialog notice names the failed seed and asks for another", () => {
  assert.equal(
    failureNotice({ seed: "ADVISOR-0126-STONELEY", reason: "x" }),
    "The seed ADVISOR-0126-STONELEY could not form a world. Please choose another.",
  );
});

test("workers build the page's world: the seed travels in the worker name", () => {
  const seed = "ADVISOR-0127-BRAMHOLM";
  assert.equal(seedFromWorkerName(workerNameForSeed(seed)), seed);
  assert.equal(seedFromWorkerName(""), undefined);
  assert.equal(seedFromWorkerName("something-else"), undefined);
  assert.equal(seedFromWorkerName(workerNameForSeed("bad seed!")), undefined);
  // A worker has no localStorage and no page hook: without the name it would silently use the default.
  assert.equal(resolveWorldSeed(undefined, null, undefined), DEFAULT_WORLD_SEED);
  assert.equal(resolveWorldSeed(undefined, null, workerNameForSeed(seed)), seed);
  assert.equal(resolveWorldSeed("ADVISOR-0126-HOOK", JSON.stringify({ seed: "ADVISOR-0126-STORED" }), workerNameForSeed(seed)), seed, "the page's seed wins inside a worker");
  assert.equal(resolveWorldSeed("ADVISOR-0126-HOOK", null, "unrelated-name"), "ADVISOR-0126-HOOK");
});
