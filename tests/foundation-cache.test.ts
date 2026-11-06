/**
 * WP-S009-006-001 — durable SEED/version-keyed foundation storage.
 *
 * A cached foundation is an optimization only: it must never become a second
 * authority for world truth, and every failure mode must fall back to the
 * unchanged deterministic generator.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  FoundationCache,
  SETTLEMENT_FOUNDATION_VERSION,
  canonicalJson,
  createMemoryBackend,
  foundationBytes,
  foundationDigest,
  foundationStorageKey,
  provideHydratedSettlements,
  queueSettlementFoundationSave,
  setFoundationCache,
  settlementFoundationKey,
  takeHydratedSettlements,
  validateSettlementFoundation,
  type FoundationBackend,
  type FoundationKey,
  type SettlementFoundationPayload,
} from "../src/foundation-cache.ts";

const KEY: FoundationKey = { seed: "ADVISOR-0126-ALDERWICK/v4", family: "settlements", version: SETTLEMENT_FOUNDATION_VERSION };

const place = (id: string, x: number, z: number) => ({
  id, code: `${id}/CODE`, name: id, kind: "village" as const, continent: "c", country: "k",
  x, z, canonicalPosition: { lon: x, lat: z }, elevation: 3,
});

const payload = (): SettlementFoundationPayload => ({
  cities: [place("c/1/0", 1, 2)],
  villages: [place("c/1/0/0", 3, 4)],
  cityParents: [],
  summary: { version: "v2", countries: [], candidateCount: 0 },
});

test("canonical JSON ignores object key order so digests survive storage round trips", () => {
  assert.equal(canonicalJson({ a: 1, b: [2, { d: 4, c: 3 }] }), canonicalJson({ b: [2, { c: 3, d: 4 }], a: 1 }));
  assert.notEqual(foundationDigest({ a: 1 }), foundationDigest({ a: 2 }));
  assert.equal(foundationDigest(payload()), foundationDigest(JSON.parse(JSON.stringify(payload()))));
});

test("a saved foundation round trips with identical content", async () => {
  const cache = new FoundationCache(createMemoryBackend());
  assert.equal(await cache.save(KEY, payload()), true);
  const loaded = await cache.load<SettlementFoundationPayload>(KEY, validateSettlementFoundation);
  assert.deepEqual(loaded, payload());
  assert.equal(foundationDigest(loaded), foundationDigest(payload()));
});

test("a different SEED, family or generator version never reuses an entry", async () => {
  const cache = new FoundationCache(createMemoryBackend());
  await cache.save(KEY, payload());
  assert.equal(await cache.load({ ...KEY, seed: "OTHER-SEED/v4" }), undefined);
  assert.equal(await cache.load({ ...KEY, family: "roads" }), undefined);
  assert.equal(await cache.load({ ...KEY, version: "settlements-v0" }), undefined);
});

test("a corrupted or hand-edited record is rejected instead of trusted", async () => {
  const backend = createMemoryBackend();
  const cache = new FoundationCache(backend);
  await cache.save(KEY, payload());
  const storageKey = foundationStorageKey(KEY);
  const stored = (await backend.read(storageKey)) as Record<string, unknown>;
  // Same digest, different payload: must not be accepted as world truth.
  await backend.write(storageKey, { ...stored, payload: { ...payload(), villages: [] } });
  assert.equal(await cache.load(storageKey ? KEY : KEY, validateSettlementFoundation), undefined);
  // Malformed record shape.
  await backend.write(storageKey, { key: storageKey, payload: null });
  assert.equal(await cache.load(KEY), undefined);
});

test("shape validation rejects structurally invalid foundations", () => {
  assert.equal(validateSettlementFoundation(payload()), true);
  assert.equal(validateSettlementFoundation({ ...payload(), cities: [] }), false);
  assert.equal(validateSettlementFoundation({ ...payload(), villages: [{ id: 1 }] as never }), false);
  assert.equal(validateSettlementFoundation({ ...payload(), summary: null } as never), false);
});

test("a failing or quota-limited backend never throws and never invents a hit", async () => {
  const broken: FoundationBackend = {
    durable: true,
    read: async () => { throw new Error("QuotaExceededError"); },
    write: async () => { throw new Error("QuotaExceededError"); },
    remove: async () => { throw new Error("QuotaExceededError"); },
    list: async () => { throw new Error("QuotaExceededError"); },
  };
  const cache = new FoundationCache(broken);
  assert.equal(await cache.save(KEY, payload()), false);
  assert.equal(await cache.load(KEY), undefined);
  assert.match(String(cache.storageError), /QuotaExceeded/);
  assert.deepEqual(await cache.stats(), { durable: true, entries: 0, bytes: 0 });
});

test("storage is bounded: the oldest entry is retired before an oversized write", async () => {
  const cache = new FoundationCache(createMemoryBackend(), { maxBytes: foundationBytes(payload()) * 2 + 8, now: () => 0 });
  const older: FoundationKey = { ...KEY, version: "settlements-v0" };
  const newer: FoundationKey = { ...KEY, version: "settlements-v3" };
  assert.equal(await cache.save(older, payload()), true);
  assert.equal(await cache.save(newer, payload()), true);
  // Third equal-size record must retire the oldest to stay inside the cap.
  assert.equal(await cache.save(KEY, payload()), true);
  const stats = await cache.stats();
  assert.ok(stats.entries <= 3);
  assert.ok(stats.bytes <= foundationBytes(payload()) * 3);
});

test("hydration is consumed at most once per page load", () => {
  provideHydratedSettlements(payload());
  assert.deepEqual(takeHydratedSettlements(), payload());
  assert.equal(takeHydratedSettlements(), undefined);
  provideHydratedSettlements(undefined);
  assert.equal(takeHydratedSettlements(), undefined);
});

test("an invalid hydrated payload is discarded, not injected", () => {
  provideHydratedSettlements({ cities: [], villages: [], cityParents: [], summary: {} });
  assert.equal(takeHydratedSettlements(), undefined);
});

test("background save never throws when storage is unavailable", () => {
  setFoundationCache(new FoundationCache(createMemoryBackend()));
  assert.doesNotThrow(() => queueSettlementFoundationSave(KEY, payload()));
});
