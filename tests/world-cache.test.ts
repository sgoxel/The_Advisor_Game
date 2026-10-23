import assert from "node:assert/strict";
import test from "node:test";
import cache from "../src/generated/road-network.json" with { type: "json" };
import { ROAD_NETWORK_FINGERPRINT, generateRoadNetworkLive, roads } from "../src/geography.ts";

test("the shipped road-network cache matches the live generator exactly (regenerate with tools/build-world-cache.ts)", () => {
  assert.equal(cache.fingerprint, ROAD_NETWORK_FINGERPRINT, "road-network.json was built from different inputs: run tools/build-world-cache.ts");
  const live = generateRoadNetworkLive();
  assert.equal(JSON.stringify(live), JSON.stringify(cache.network), "road-network.json is stale: run tools/build-world-cache.ts");
  assert.ok(roads.length > 0 && roads.every((road) => road.centerline && road.centerline.length >= 2));
});

test("the shipped transport-extension cache matches the live generator exactly", async () => {
  const stored = (await import("../src/generated/transport-extensions.json", { with: { type: "json" } })).default as { fingerprint: string; extensions: unknown };
  const { TRANSPORT_EXTENSIONS_FINGERPRINT, buildTransportExtensionsLive } = await import("../src/transport-network.ts");
  assert.equal(stored.fingerprint, TRANSPORT_EXTENSIONS_FINGERPRINT, "transport-extensions.json was built from different inputs: run tools/build-world-cache.ts");
  assert.equal(JSON.stringify(buildTransportExtensionsLive()), JSON.stringify(stored.extensions), "transport-extensions.json is stale: run tools/build-world-cache.ts");
});
