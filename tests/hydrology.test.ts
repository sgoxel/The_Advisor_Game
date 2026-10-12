import { test } from "node:test";
import assert from "node:assert/strict";
import { villages } from "../src/geography.ts";
import { macroSampleAt, MACRO_PLAN } from "../src/macro-geography.ts";
import {
  SOURCE_PRESENTATION_WIDTH,
  lonLatToSource,
  sourceToLonLat,
} from "../src/planet.ts";
import {
  drainageLakeRadiusAt,
  drainageRecipeAt,
  freshwaterDistanceAt,
  hydrologyDiagnostics,
  naturalElevationAt,
  surfaceAt,
  surfaceElevationAt,
  type DrainageRecipe,
} from "../src/surface.ts";

function generatedRecipes(limit = Infinity) {
  const result: DrainageRecipe[] = [];
  for (let z = 0; z < hydrologyDiagnostics.basinRows; z++)
    for (let x = 0; x < hydrologyDiagnostics.basinColumns; x++) {
      const recipe = drainageRecipeAt(x, z);
      if (recipe) result.push(recipe);
      if (result.length >= limit) return result;
    }
  return result;
}

test("distributed drainage recipes are deterministic, downhill and reach real water", () => {
  const recipes = generatedRecipes();
  assert.ok(recipes.length >= 12, `expected distributed drainage, got ${recipes.length}`);
  const perContinent = new Map<number, number>();
  let withLake = 0;
  for (const recipe of recipes) {
    perContinent.set(recipe.continentId, (perContinent.get(recipe.continentId) || 0) + 1);
    assert.ok(recipe.tributary.length >= 4);
    assert.ok(recipe.points.length >= 5);
    for (let i = 1; i < recipe.points.length; i++)
      assert.ok(
        recipe.points[i].bed < recipe.points[i - 1].bed,
        `${recipe.code} rises downstream at ${i}`,
      );
    for (let i = 1; i < recipe.tributary.length; i++)
      assert.ok(recipe.tributary[i].bed <= recipe.tributary[i - 1].bed + 1e-9);
    const end = recipe.points[recipe.points.length - 1],
      outlet = macroSampleAt(sourceToLonLat(end.x, end.z));
    assert.equal(outlet.land, false, `${recipe.code} must end in macro water`);
    assert.equal(recipe.outlet, outlet.domain === "Lake" ? "lake" : "ocean");
    if (recipe.lake) withLake++;
  }
  for (const continent of MACRO_PLAN.continents)
    assert.ok((perContinent.get(continent.id) || 0) >= 2, `continent ${continent.id} needs multiple drainage systems`);
  assert.ok(withLake >= 1, "at least one seeded basin must expose a local freshwater lake");
  const first = recipes[0],
    key = first.code.split("/HYDRO/")[1].split("/"),
    repeated = drainageRecipeAt(Number(key[0]), Number(key[1]));
  assert.deepEqual(repeated, first);
});

test("local freshwater lakes use deterministic non-circular canonical shorelines", () => {
  const lake = generatedRecipes().find((recipe) => recipe.lake)?.lake;
  assert.ok(lake, "expected a seeded local lake");
  const radii = Array.from({ length: 32 }, (_, index) =>
    drainageLakeRadiusAt(lake, (index / 32) * Math.PI * 2),
  );
  assert.ok(Math.max(...radii) - Math.min(...radii) > lake.radius * 0.12);
  assert.deepEqual(
    radii,
    Array.from({ length: 32 }, (_, index) =>
      drainageLakeRadiusAt(lake, (index / 32) * Math.PI * 2),
    ),
  );
});

test("surface identity is wrap-safe and water/cliffs share traversal truth", () => {
  const recipes = generatedRecipes(6);
  assert.ok(recipes.length > 0);
  for (const recipe of recipes) {
    const point = recipe.points[Math.min(2, recipe.points.length - 2)],
      a = surfaceAt(point.x, point.z),
      b = surfaceAt(point.x + SOURCE_PRESENTATION_WIDTH, point.z);
    assert.ok(Math.abs(a.elevation - b.elevation) < 1e-9);
    assert.equal(a.water, b.water);
    assert.equal(a.traversal, b.traversal);
    assert.equal(a.catchmentCode, b.catchmentCode);
    assert.equal(a.water, "river");
    assert.equal(a.walkable, false);
  }

  let cliffFound = false;
  outer: for (const mountain of MACRO_PLAN.mountainSystems) {
    for (const anchor of mountain.path) {
      const p = lonLatToSource(anchor.lon, anchor.lat);
      for (const [dx, dz] of [[-28, 0], [28, 0], [0, -28], [0, 28], [42, 21], [-42, -21]] as const) {
        const sample = surfaceAt(p.x + dx, p.z + dz);
        if (sample.cliff) {
          assert.equal(sample.traversal, "blocked-cliff");
          assert.equal(sample.walkable, false);
          cliffFound = true;
          break outer;
        }
      }
    }
  }
  assert.equal(cliffFound, true, "seeded mountain systems must expose at least one canonical cliff sample");
});

test("freshwater queries are bounded and a strict majority of villages have seeded access", () => {
  let nearFreshwater = 0;
  for (const village of villages) {
    const distance = freshwaterDistanceAt(village.x, village.z);
    if (distance <= hydrologyDiagnostics.basinSize * 0.8) nearFreshwater++;
    assert.ok(Number.isFinite(distance) || distance === Infinity);
  }
  assert.ok(
    nearFreshwater > villages.length / 2,
    `${nearFreshwater}/${villages.length} villages are within the configured freshwater-access radius`,
  );
  for (let i = 0; i < 180; i++) {
    const x = -SOURCE_PRESENTATION_WIDTH / 2 + (i * 7919) % SOURCE_PRESENTATION_WIDTH,
      z = -54_000 + (i * 1543) % 108_000;
    surfaceElevationAt(x, z);
  }
  assert.ok(hydrologyDiagnostics.cacheSize <= hydrologyDiagnostics.cacheLimit);
  assert.ok(hydrologyDiagnostics.generatedBasins > 0);
  assert.ok(hydrologyDiagnostics.queryCount > 0);
});

test("natural base has irregular local relief without changing macro water authority", () => {
  for (const continent of MACRO_PLAN.continents) {
    const center = lonLatToSource(continent.center.lon, continent.center.lat),
      samples = [
        naturalElevationAt(center.x, center.z),
        naturalElevationAt(center.x + 137, center.z + 83),
        naturalElevationAt(center.x - 211, center.z + 149),
      ];
    assert.ok(samples.every(Number.isFinite));
    assert.ok(new Set(samples.map((value) => value.toFixed(4))).size > 1);
  }
  for (const lake of MACRO_PLAN.lakes.slice(0, 3)) {
    const point = lonLatToSource(lake.center.lon, lake.center.lat),
      macro = macroSampleAt(lake.center);
    assert.equal(macro.domain, "Lake");
    assert.ok(surfaceElevationAt(point.x, point.z) < 0);
    assert.equal(surfaceAt(point.x, point.z).water, "lake");
  }
});
