import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  drainageRecipes,
  freshwaterCrossingSpanMAt,
  hydrologyTelemetry,
  naturalSurfaceAt,
} from "../src/hydrology.ts";
import { MACRO_PLAN, macroSampleAt } from "../src/macro-geography.ts";
import { SOURCE_PRESENTATION_WIDTH, sourceToLonLat } from "../src/planet.ts";
import { RURAL_BRIDGE_MAX_LENGTH_M } from "../src/world.ts";

test("each continent has multiple independent bounded drainage recipes", () => {
  assert.ok(drainageRecipes.length >= MACRO_PLAN.continents.length * 3);
  for (let continentId = 0; continentId < MACRO_PLAN.continents.length; continentId++)
    assert.ok(
      drainageRecipes.filter((recipe) => recipe.continentId === continentId).length >= 3,
      `continent ${continentId} has too few drainage recipes`,
    );
});

test("main channels and tributaries descend monotonically into ocean or lake authority", () => {
  for (const recipe of drainageRecipes) {
    assert.ok(recipe.points.length >= 8, `${recipe.code} is too short`);
    for (const path of [recipe.points, recipe.tributary])
      for (let i = 1; i < path.length; i++)
        assert.ok(path[i].bed <= path[i - 1].bed + 1e-9, `${recipe.code} bed rises at ${i}`);

    const end = recipe.points.at(-1)!;
    const domain = macroSampleAt(sourceToLonLat(end.x, end.z)).domain;
    assert.equal(domain, recipe.outlet === "lake" ? "Lake" : "Ocean", `${recipe.code} has a false outlet`);
  }
});

test("natural freshwater is one shared non-walkable surface and legal rural crossings fit the cap", () => {
  for (const recipe of drainageRecipes) {
    const a = recipe.points[Math.max(1, Math.floor(recipe.points.length / 2) - 1)];
    const b = recipe.points[Math.floor(recipe.points.length / 2)];
    const x = a.x + (b.x - a.x) * 0.5;
    const z = a.z + (b.z - a.z) * 0.5;
    const sample = naturalSurfaceAt(x, z);
    assert.equal(sample.water.kind, "river", `${recipe.code} midpoint is not freshwater`);
    assert.equal(sample.walkable, false);
    assert.equal(sample.material, "River");
    const spanM = freshwaterCrossingSpanMAt(x, z);
    assert.ok(spanM > 0 && spanM <= RURAL_BRIDGE_MAX_LENGTH_M, `${recipe.code} crossing exceeds rural bridge cap`);
  }
});

test("natural authority repeats exactly across source wrap and stays query-bounded", () => {
  const recipe = drainageRecipes[0];
  assert.ok(recipe);
  const point = recipe.points[Math.floor(recipe.points.length / 2)];
  const before = hydrologyTelemetry();
  for (let i = 0; i < 48; i++) {
    const x = point.x + i * 17;
    const z = point.z + i * 11;
    const a = naturalSurfaceAt(x, z);
    const b = naturalSurfaceAt(x + SOURCE_PRESENTATION_WIDTH, z);
    assert.equal(a.material, b.material);
    assert.equal(a.water.kind, b.water.kind);
    assert.ok(Math.abs(a.groundHeight - b.groundHeight) < 1e-9);
    assert.equal(a.walkable, b.walkable);
  }
  const after = hydrologyTelemetry();
  const checks = after.segmentChecks - before.segmentChecks;
  assert.ok(checks < 48 * 2 * 160, `spatial query examined too many segments: ${checks}`);
});

test("natural terrain/hydrology source uses no runtime random or wall-clock authority", () => {
  const source = readFileSync(new URL("../src/hydrology.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now/);
});
