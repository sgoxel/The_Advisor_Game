import { test } from "node:test";
import assert from "node:assert/strict";
import { cities, villages } from "../src/geography.ts";
import { macroSampleAt, MACRO_PLAN } from "../src/macro-geography.ts";
import {
  SOURCE_PRESENTATION_WIDTH,
  lonLatToSource,
  sourceToLonLat,
} from "../src/planet.ts";
import {
  HYDRO_BASIN_SIZE,
  drainageRecipeAt,
  naturalFreshwaterDistanceAt,
  naturalHydrologyDiagnostics,
  naturalSurfaceAt,
  naturalSurfaceElevationAt,
  type DrainageRecipe,
} from "../src/natural-surface.ts";
import { surfaceAt, surfaceElevationAt } from "../src/surface.ts";
import { macroTerrainSampler } from "../src/routing.ts";

function generatedRecipes(limit = Infinity) {
  const result: DrainageRecipe[] = [];
  for (let z = 0; z < naturalHydrologyDiagnostics.basinRows; z++)
    for (let x = 0; x < naturalHydrologyDiagnostics.basinColumns; x++) {
      const recipe = drainageRecipeAt(x, z);
      if (recipe) result.push(recipe);
      if (result.length >= limit) return result;
    }
  return result;
}

test("distributed drainage recipes are deterministic, downhill and reach canonical water", () => {
  const recipes = generatedRecipes();
  assert.ok(recipes.length >= 12, `expected distributed drainage, got ${recipes.length}`);
  const perContinent = new Map<number, number>();
  let withLake = 0;
  for (const recipe of recipes) {
    perContinent.set(recipe.continentId, (perContinent.get(recipe.continentId) || 0) + 1);
    assert.ok(recipe.tributary.length >= 4);
    assert.ok(recipe.points.length >= 5);
    for (let i = 1; i < recipe.points.length; i++)
      assert.ok(recipe.points[i].bed < recipe.points[i - 1].bed, `${recipe.code} rises downstream at ${i}`);
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

test("natural and composed surfaces are wrap-safe and share water traversal truth", () => {
  const recipes = generatedRecipes(6);
  assert.ok(recipes.length > 0);
  for (const recipe of recipes) {
    const point = recipe.points[Math.min(2, recipe.points.length - 2)],
      a = naturalSurfaceAt(point.x, point.z),
      b = naturalSurfaceAt(point.x + SOURCE_PRESENTATION_WIDTH, point.z),
      final = surfaceAt(point.x, point.z),
      route = macroTerrainSampler(sourceToLonLat(point.x, point.z));
    assert.ok(Math.abs(a.elevation - b.elevation) < 1e-9);
    assert.equal(a.water, b.water);
    assert.equal(a.traversal, b.traversal);
    assert.equal(a.catchmentCode, b.catchmentCode);
    assert.equal(a.water, "river");
    assert.equal(a.walkable, false);
    assert.equal(final.water, "river");
    assert.equal(final.walkable, false);
    assert.equal(route.water, true);
  }
});

test("canonical mountain terrain exposes blocked cliffs and final routing consumes them", () => {
  let cliffFound = false;
  outer: for (const mountain of MACRO_PLAN.mountainSystems) {
    for (const anchor of mountain.path) {
      const p = lonLatToSource(anchor.lon, anchor.lat);
      for (const [dx, dz] of [
        [-28, 0], [28, 0], [0, -28], [0, 28], [42, 21], [-42, -21],
      ] as const) {
        const sample = surfaceAt(p.x + dx, p.z + dz);
        if (sample.cliff) {
          assert.equal(sample.traversal, "blocked-cliff");
          assert.equal(sample.walkable, false);
          const route = macroTerrainSampler(sourceToLonLat(p.x + dx, p.z + dz));
          assert.equal(route.blocked, true);
          cliffFound = true;
          break outer;
        }
      }
    }
  }
  assert.equal(cliffFound, true, "seeded mountain systems must expose a canonical cliff sample");
});

test("settlement canonical cores are naturally dry without relocating hydrology", () => {
  let villagesWithNearbyWater = 0;
  for (const place of [...cities, ...villages]) {
    const protectedRadius = place.kind === "city" ? 60 : 42,
      offsets = [
        [0, 0],
        [protectedRadius * 0.7, 0],
        [-protectedRadius * 0.7, 0],
        [0, protectedRadius * 0.7],
        [0, -protectedRadius * 0.7],
        [protectedRadius * 0.55, protectedRadius * 0.55],
        [-protectedRadius * 0.55, -protectedRadius * 0.55],
      ] as const;
    for (const [dx, dz] of offsets) {
      const natural = naturalSurfaceAt(place.x + dx, place.z + dz),
        final = surfaceAt(place.x + dx, place.z + dz);
      assert.equal(natural.water, "none", `${place.code} canonical core must be naturally dry`);
      assert.equal(final.water, "none", `${place.code} final canonical core must stay dry`);
    }
    if (place.kind === "village" && naturalFreshwaterDistanceAt(place.x, place.z) <= HYDRO_BASIN_SIZE * 0.8)
      villagesWithNearbyWater++;
  }
  assert.ok(villagesWithNearbyWater > villages.length / 2, `${villagesWithNearbyWater}/${villages.length} villages need nearby freshwater`);
});

test("surface queries are bounded and preserve natural water beneath dry-only earthworks", () => {
  for (let i = 0; i < 180; i++) {
    const x = -SOURCE_PRESENTATION_WIDTH / 2 + (i * 7919) % SOURCE_PRESENTATION_WIDTH,
      z = -54_000 + (i * 1543) % 108_000;
    naturalSurfaceElevationAt(x, z);
    surfaceElevationAt(x, z);
  }
  assert.ok(naturalHydrologyDiagnostics.basinCacheSize <= naturalHydrologyDiagnostics.basinCacheLimit);
  assert.ok(naturalHydrologyDiagnostics.queryCacheSize <= naturalHydrologyDiagnostics.queryCacheLimit);
  assert.ok(naturalHydrologyDiagnostics.generatedBasins > 0);
  assert.ok(naturalHydrologyDiagnostics.queryCount > 0);

  const recipe = generatedRecipes(1)[0],
    point = recipe.points[Math.min(2, recipe.points.length - 2)],
    natural = naturalSurfaceAt(point.x, point.z),
    final = surfaceAt(point.x, point.z);
  assert.equal(natural.water, "river");
  assert.equal(final.water, natural.water);
  assert.equal(final.elevation, natural.elevation);
});

test("natural base has irregular local relief without changing macro lake authority", () => {
  for (const continent of MACRO_PLAN.continents) {
    const center = lonLatToSource(continent.center.lon, continent.center.lat),
      samples = [
        naturalSurfaceElevationAt(center.x, center.z),
        naturalSurfaceElevationAt(center.x + 137, center.z + 83),
        naturalSurfaceElevationAt(center.x - 211, center.z + 149),
      ];
    assert.ok(samples.every(Number.isFinite));
    assert.ok(new Set(samples.map((value) => value.toFixed(4))).size > 1);
  }
  for (const lake of MACRO_PLAN.lakes.slice(0, 3)) {
    const point = lonLatToSource(lake.center.lon, lake.center.lat),
      macro = macroSampleAt(lake.center);
    assert.equal(macro.domain, "Lake");
    assert.ok(naturalSurfaceElevationAt(point.x, point.z) < 0);
    assert.equal(naturalSurfaceAt(point.x, point.z).water, "lake");
  }
});
