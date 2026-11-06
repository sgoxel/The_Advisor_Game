/**
 * WP-S009-006-001 — the persisted foundation must reproduce the *identical*
 * world. This evaluates `geography` twice in one process: once through the
 * normal deterministic generator, then once through the rehydrated foundation,
 * and compares every canonical output that later systems depend on.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  FoundationCache,
  createMemoryBackend,
  foundationDigest,
  foundationCache,
  provideHydratedSettlements,
  setFoundationCache,
  settlementFoundationKey,
  validateSettlementFoundation,
  type SettlementFoundationPayload,
} from "../src/foundation-cache.ts";
import { COARSE_GEOGRAPHY_VERSION, WORLD_SEED } from "../src/config.ts";

const KEY = settlementFoundationKey(WORLD_SEED, COARSE_GEOGRAPHY_VERSION);

test("a rehydrated settlement foundation reproduces the generated world exactly and faster", async () => {
  setFoundationCache(new FoundationCache(createMemoryBackend()));
  const cache = foundationCache();

  const coldStart = performance.now();
  const generated = await import("../src/geography.ts?path=generated");
  const coldMs = performance.now() - coldStart;

  const foundation = generated.currentSettlementFoundation() as SettlementFoundationPayload;
  const coldPlaces = foundationDigest(generated.places);
  const coldRoads = foundationDigest(generated.roads.map((road) => road.code));
  const coldFingerprint = generated.ROAD_NETWORK_FINGERPRINT;

  // Exactly what the browser persists, then reads back on the next opening.
  assert.equal(await cache.save(KEY, foundation), true);
  const restored = await cache.load<SettlementFoundationPayload>(KEY, validateSettlementFoundation);
  assert.ok(restored, "persisted foundation must validate on reload");

  provideHydratedSettlements(restored);
  const warmStart = performance.now();
  const hydrated = await import("../src/geography.ts?path=hydrated");
  const warmMs = performance.now() - warmStart;

  assert.equal(foundationDigest(hydrated.places), coldPlaces, "places must be identical");
  assert.equal(foundationDigest(hydrated.roads.map((road) => road.code)), coldRoads, "roads must be identical");
  assert.equal(hydrated.ROAD_NETWORK_FINGERPRINT, coldFingerprint, "road fingerprint must be identical");
  assert.deepEqual(hydrated.places.map((place) => place.id), generated.places.map((place) => place.id));
  assert.deepEqual(hydrated.macroPopulationSummary, generated.macroPopulationSummary);
  // Distinct object graphs: the world was really rebuilt from the stored record.
  assert.notEqual(hydrated.places, generated.places);

  console.log(`settlement foundation: cold ${coldMs.toFixed(0)} ms -> hydrated ${warmMs.toFixed(0)} ms (${(coldMs / warmMs).toFixed(2)}x)`);
  assert.ok(warmMs < coldMs, `hydrated import (${warmMs.toFixed(0)} ms) must be faster than generation (${coldMs.toFixed(0)} ms)`);
});
