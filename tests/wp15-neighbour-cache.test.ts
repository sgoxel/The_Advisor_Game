import test from "node:test";
import assert from "node:assert/strict";
import {
  clearVillageRouteCache,
  neighbouringVillages,
  routeBetweenVillages,
  villageRouteCacheSize,
} from "../src/village-routes.ts";

const PROBE_VILLAGES = ["1/3/0/0", "1/5/2/0", "0/0/0/0", "2/3/1/1"] as const;

test("selected walking neighbours retain the same legal-route fact after candidate probing", () => {
  for (const id of PROBE_VILLAGES) {
    clearVillageRouteCache();
    const neighbours = neighbouringVillages(id);
    assert.ok(neighbours.length >= 1 && neighbours.length <= 4, `${id} exposes bounded walking neighbours`);
    for (const { place } of neighbours) {
      const route = routeBetweenVillages(id, place.id);
      assert.equal(route.found, true, `${id}|${place.id} must retain its proven legal route (${route.reason})`);
    }
    assert.ok(villageRouteCacheSize() <= 256, "route cache remains bounded");
  }
});
