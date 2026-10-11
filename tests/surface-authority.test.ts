import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { places, roads } from "../src/geography.ts";
import {
  drainageRecipeAt,
  hydrologyDiagnostics,
  surfaceAt,
} from "../src/surface.ts";
import { surfaceAt as naturalSurfaceAt } from "../src/hydrology.ts";
import { sourceToLonLat, SOURCE_PRESENTATION_WIDTH } from "../src/planet.ts";
import { finalTraversalTerrainSampler } from "../src/village-routes.ts";
import { biomeAt, heightAt } from "../src/world.ts";

function firstRiverPoint() {
  for (let z = 0; z < hydrologyDiagnostics.basinRows; z++)
    for (let x = 0; x < hydrologyDiagnostics.basinColumns; x++) {
      const recipe = drainageRecipeAt(x, z);
      if (recipe && recipe.points.length > 4)
        return recipe.points[Math.min(3, recipe.points.length - 2)];
    }
  throw new Error("seed must expose a canonical river");
}

test("prototype sine-wave hydrology is absent from runtime authority", () => {
  const world = fs.readFileSync(new URL("../src/world.ts", import.meta.url), "utf8"),
    geometry = fs.readFileSync(new URL("../src/geometry.ts", import.meta.url), "utf8");
  assert.equal(world.includes("riverX("), false);
  assert.equal(world.includes("S001 prototype"), false);
  assert.equal(geometry.includes("riverX("), false);
});

test("world, final surface and routing read the same canonical river", () => {
  const point = firstRiverPoint(),
    canonical = surfaceAt(point.x, point.z),
    wrapped = surfaceAt(point.x + SOURCE_PRESENTATION_WIDTH, point.z),
    position = sourceToLonLat(point.x, point.z),
    routed = finalTraversalTerrainSampler(position);
  assert.equal(canonical.water, "river");
  assert.equal(canonical.walkable, false);
  assert.equal(wrapped.water, canonical.water);
  assert.equal(wrapped.catchmentCode, canonical.catchmentCode);
  assert.equal(heightAt(point.x, point.z), canonical.elevation);
  assert.equal(biomeAt(point.x, point.z), "River");
  assert.equal(routed.water, true);
});

test("settlement anchors and ordinary seeded road corridors do not erase hydrology", () => {
  for (const place of places) {
    const natural = naturalSurfaceAt(place.x, place.z);
    assert.equal(natural.water, "none", `${place.code} anchor overlaps ${natural.water}`);
    assert.equal(natural.cliff, false, `${place.code} anchor is a canonical cliff`);
  }
  let samples = 0;
  for (const road of roads) {
    const steps = Math.max(2, Math.ceil(road.presentationLengthSourceUnits / 4));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps,
        x = road.fromX + (road.toX - road.fromX) * t,
        z = road.fromZ + (road.toZ - road.fromZ) * t,
        natural = naturalSurfaceAt(x, z),
        composed = surfaceAt(x, z);
      assert.equal(
        natural.water,
        "none",
        `${road.code} crosses ${natural.water} at t=${t.toFixed(4)} without bridge/ford authority`,
      );
      assert.equal(composed.water, natural.water);
      samples++;
    }
  }
  assert.ok(samples > roads.length * 2);
});
