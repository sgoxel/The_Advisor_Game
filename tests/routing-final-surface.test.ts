import assert from "node:assert/strict";
import test from "node:test";
import { roads, villages } from "../src/geography.ts";
import { lonLatToFlat } from "../src/planet.ts";
import { ROUTE_MAX_CELLS, ROUTE_MAX_EXPANSIONS } from "../src/routing.ts";
import {
  clearVillageRouteCache,
  finalTraversalTerrainSampler,
  routeBetweenVillages,
  routingAcceptanceSummary,
  villageRouteCacheStats,
} from "../src/village-routes.ts";
import { cellAt } from "../src/world.ts";

test("village routing consumes runtime cell traversal truth", () => {
  for (const village of villages.slice(0, 12)) {
    const flat = lonLatToFlat(village.canonicalPosition.lon, village.canonicalPosition.lat),
      cell = cellAt(flat.x, flat.z),
      sampled = finalTraversalTerrainSampler(village.canonicalPosition),
      biome = cell.biome.toLowerCase(),
      naturalWater = biome === "ocean" || biome === "lake" || biome === "river";
    assert.equal(sampled.water, naturalWater || !cell.walkable);
    assert.equal(sampled.heightM, cell.elevation);
  }
});

test("seeded road candidates are final-traversal validated instead of bypassing authority", () => {
  clearVillageRouteCache();
  const road = roads[0];
  assert.ok(road, "canonical registry should expose a seeded road fixture");
  const forward = routeBetweenVillages(road.from, road.to);
  assert.equal(forward.found, true, forward.reason);
  assert.ok(forward.cellSizeM > 0, "direct seeded road must still receive bounded final-cell validation");
  assert.ok(forward.attempts >= 1);
  assert.ok(forward.expansions <= ROUTE_MAX_EXPANSIONS);
  const afterFirst = villageRouteCacheStats();
  assert.equal(afterFirst.misses, 1);
  assert.equal(afterFirst.hits, 0);

  const reverse = routeBetweenVillages(road.to, road.from);
  assert.equal(reverse.found, true, reverse.reason);
  const afterReverse = villageRouteCacheStats();
  assert.equal(afterReverse.misses, 1);
  assert.equal(afterReverse.hits, 1);
  assert.equal(reverse.distanceM, forward.distanceM);
  assert.equal(reverse.fantasySeconds, forward.fantasySeconds);
});

test("routing acceptance summary covers the actual generated village registry", () => {
  clearVillageRouteCache();
  const summary = routingAcceptanceSummary();
  assert.equal(summary.villageCount, villages.length);
  assert.equal(summary.totalPairs, (villages.length * (villages.length - 1)) / 2);
  assert.equal(summary.lowerBoundProvenPairs + summary.routedPairs, summary.totalPairs);
  assert.equal(summary.invalidPairs, 0);
  assert.equal(summary.unreachablePairs, 0);
  assert.ok(summary.minimumProvenOrObservedFantasySeconds >= 3_600);
  assert.equal(summary.searchBounds.maxCells, ROUTE_MAX_CELLS);
  assert.equal(summary.searchBounds.maxExpansions, ROUTE_MAX_EXPANSIONS);
  assert.ok(summary.cache.size <= summary.cache.limit);
});
