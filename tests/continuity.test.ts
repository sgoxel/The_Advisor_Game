import assert from "node:assert/strict";
import test from "node:test";
import { roads } from "../src/geography.ts";
import { biomeAt, heightAt } from "../src/world.ts";
import { lonLatToSource } from "../src/planet.ts";
import { canonicalCellNeighbors } from "../src/spatial-authority.ts";
import {
  CONTINUITY_LIMITS,
  clearContinuityRecipeCache,
  continuityBoundary,
  continuityMetrics,
  continuityRegionAt,
  continuityRegionRecipe,
  continuityRemoteRoadQuery,
  continuityRoadPort,
  continuityRoadRecipe,
} from "../src/continuity.ts";

test("continuity regions have fixed five-region coarse support", () => {
  const cell = continuityRegionAt({ lon: 0.31, lat: -0.22 }),
    a = continuityRegionRecipe(cell),
    b = continuityRegionRecipe(cell);
  assert.equal(a.definitionDigest, b.definitionDigest);
  assert.equal(a.dependencies.length, CONTINUITY_LIMITS.terrainDependencyRegions);
  assert.equal(new Set(a.dependencies).size, a.dependencies.length);
});

test("shared boundary identity and road port are orientation independent", () => {
  const a = continuityRegionAt({ lon: 0.31, lat: -0.22 }),
    b = canonicalCellNeighbors(a).east,
    forward = continuityBoundary(a, b),
    reverse = continuityBoundary(b, a),
    portA = continuityRoadPort(forward, "FIXTURE/ROAD", 0),
    portB = continuityRoadPort(reverse, "FIXTURE/ROAD", 0);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(portA, portB);
  assert.notEqual(portA.t, 0.5, "normal fixture must not be forced through an edge midpoint");
  assert.ok(portA.candidate < CONTINUITY_LIMITS.boundaryCandidates);
});

test("terrain-valid candidate enumeration can move a crossing away from its first sample", () => {
  let varied = false;
  outer: for (let latitude = -1.44; latitude <= 1.44; latitude += 0.16) {
    for (let longitude = -3.06; longitude <= 3.06; longitude += 0.18) {
      const cell = continuityRegionAt({ lon: longitude, lat: latitude });
      for (const neighbour of Object.values(canonicalCellNeighbors(cell))) {
        const boundary = continuityBoundary(cell, neighbour);
        for (let variant = 0; variant < 24; variant++) {
          const port = continuityRoadPort(
            boundary,
            `FIXTURE/TERRAIN-OBSTACLE/${variant}`,
            0,
          );
          if (!port.fallback && port.candidate > 0) {
            varied = true;
            assert.notEqual(port.t, 0.5);
            assert.ok(port.candidate < CONTINUITY_LIMITS.boundaryCandidates);
            break outer;
          }
        }
      }
    }
  }
  assert.ok(
    varied,
    "expected a deterministic legal later candidate on a mixed terrain edge",
  );
});

test("ten seeded road fixtures rebuild identically after reverse order and eviction", () => {
  const fixtures = roads.slice(0, 10);
  assert.equal(fixtures.length, 10);
  const expected = fixtures.map((road) => {
    const recipe = continuityRoadRecipe(road.code, road.fromPosition, road.toPosition);
    const reverse = continuityRoadRecipe(road.code, road.toPosition, road.fromPosition);
    assert.equal(reverse.foundationDigest, recipe.foundationDigest);
    assert.equal(reverse.stateDigest, recipe.stateDigest);
    assert.deepEqual([...reverse.points].reverse(), recipe.points);
    assert.ok(recipe.searchExpansions <= CONTINUITY_LIMITS.roadSearchExpansions);
    assert.ok(recipe.regions.length <= CONTINUITY_LIMITS.roadRegionLimit);
    return recipe.foundationDigest;
  });

  clearContinuityRecipeCache();
  for (const index of [7, 2, 9, 0, 5, 1, 8, 3, 6, 4]) {
    const road = fixtures[index],
      rebuilt = continuityRoadRecipe(road.code, road.fromPosition, road.toPosition);
    assert.equal(rebuilt.foundationDigest, expected[index]);
  }
});

test("shared port terrain/traversal samples agree exactly at one canonical coordinate", () => {
  const road = roads[0],
    recipe = continuityRoadRecipe(road.code, road.fromPosition, road.toPosition);
  assert.ok(recipe.ports.length > 0, "fixture must cross at least one logical region edge");
  for (const port of recipe.ports.slice(0, 4)) {
    const sourceA = lonLatToSource(port.position.lon, port.position.lat),
      sourceB = lonLatToSource(port.position.lon, port.position.lat),
      heightA = heightAt(sourceA.x, sourceA.z),
      heightB = heightAt(sourceB.x, sourceB.z);
    assert.ok(Math.abs(heightA - heightB) <= 0.01);
    assert.equal(biomeAt(sourceA.x, sourceA.z), biomeAt(sourceB.x, sourceB.z));
  }
});

test("campaign revision survives cache eviction without changing fixed foundation", () => {
  const road = roads[1],
    before = continuityRoadRecipe(road.code, road.fromPosition, road.toPosition, "0126-04-07 12:00:00/bridge-open"),
    initial = continuityRoadRecipe(road.code, road.fromPosition, road.toPosition, "INITIAL");
  assert.equal(before.foundationDigest, initial.foundationDigest);
  assert.notEqual(before.stateDigest, initial.stateDigest);
  clearContinuityRecipeCache();
  const after = continuityRoadRecipe(road.code, road.fromPosition, road.toPosition, "0126-04-07 12:00:00/bridge-open");
  assert.equal(after.foundationDigest, before.foundationDigest);
  assert.equal(after.stateDigest, before.stateDigest);
});

test("remote road queries cannot allocate presentation resources", () => {
  const road = roads[2],
    before = continuityMetrics();
  continuityRemoteRoadQuery(road.code, road.fromPosition, road.toPosition);
  const after = continuityMetrics();
  assert.equal(after.materializedPresentationResources, 0);
  assert.equal(after.presentationBytes, 0);
  assert.ok(after.remoteQueries > before.remoteQueries);
});

test("recipe cache is bounded and eviction does not become authority", () => {
  clearContinuityRecipeCache();
  const point = roads[0].fromPosition;
  for (let index = 0; index < CONTINUITY_LIMITS.cacheEntries + 24; index++)
    continuityRoadRecipe(`CACHE/FIXTURE/${index}`, point, point);
  const metrics = continuityMetrics();
  assert.ok(metrics.cacheEntries <= CONTINUITY_LIMITS.cacheEntries);
  assert.ok(metrics.cacheEvictions >= 24);
});

test("longitude aliases, poles and cube-face ties retain canonical identity", () => {
  const wrapA = continuityRegionAt({ lon: Math.PI, lat: 0 }),
    wrapB = continuityRegionAt({ lon: -Math.PI, lat: 0 }),
    wrapC = continuityRegionAt({ lon: Math.PI * 3, lat: 0 }),
    northA = continuityRegionAt({ lon: 0, lat: Math.PI / 2 }),
    northB = continuityRegionAt({ lon: 2.4, lat: Math.PI / 2 }),
    southA = continuityRegionAt({ lon: -1.1, lat: -Math.PI / 2 }),
    southB = continuityRegionAt({ lon: 1.7, lat: -Math.PI / 2 }),
    tie = continuityRegionAt({ lon: Math.PI / 4, lat: 0 });
  assert.equal(wrapA.id, wrapB.id);
  assert.equal(wrapA.id, wrapC.id);
  assert.equal(northA.id, northB.id);
  assert.equal(southA.id, southB.id);
  assert.ok(/^ADVISOR-0126-ALDERWICK\/PLANET\/v1\/F[0-5]\/L7\//.test(tie.id));
});

test("all direct cube neighbours reconstruct one exact shared edge record", () => {
  const cell = continuityRegionAt({ lon: -0.6, lat: 0.42 }),
    neighbours = canonicalCellNeighbors(cell);
  for (const neighbour of Object.values(neighbours)) {
    const a = continuityBoundary(cell, neighbour),
      b = continuityBoundary(neighbour, cell);
    assert.equal(a.id, b.id);
    assert.deepEqual(a.from, b.from);
    assert.deepEqual(a.to, b.to);
  }
});

test("cube-face corner neighbours retain one owner and one edge record", () => {
  const cubeCornerLatitude = Math.asin(1 / Math.sqrt(3)),
    cell = continuityRegionAt({ lon: Math.PI / 4, lat: cubeCornerLatitude });
  for (const neighbour of Object.values(canonicalCellNeighbors(cell))) {
    const forward = continuityBoundary(cell, neighbour),
      reverse = continuityBoundary(neighbour, cell);
    assert.equal(forward.id, reverse.id);
    assert.equal(forward.ownerId, reverse.ownerId);
    assert.deepEqual(forward.from, reverse.from);
    assert.deepEqual(forward.to, reverse.to);
  }
});
