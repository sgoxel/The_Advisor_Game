import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  drainageRecipeAt,
  hydrologyDiagnostics,
  surfaceAt,
} from "../src/surface.ts";
import { finalTerrainSampler, planRoute } from "../src/routing.ts";
import { sourceToLonLat, SOURCE_PRESENTATION_WIDTH } from "../src/planet.ts";

function firstRiverPoint() {
  for (let z = 0; z < hydrologyDiagnostics.basinRows; z++)
    for (let x = 0; x < hydrologyDiagnostics.basinColumns; x++) {
      const recipe = drainageRecipeAt(x, z);
      if (recipe && recipe.points.length > 4)
        return recipe.points[Math.min(3, recipe.points.length - 2)];
    }
  throw new Error("seed must expose a canonical river");
}

test("prototype sine-wave hydrology is absent from runtime and settlement authority", () => {
  const world = fs.readFileSync(new URL("../src/world.ts", import.meta.url), "utf8"),
    geography = fs.readFileSync(new URL("../src/geography.ts", import.meta.url), "utf8");
  assert.equal(world.includes("riverX("), false);
  assert.equal(world.includes("S001 prototype"), false);
  assert.equal(geography.includes("prototypeRiverX"), false);
  assert.equal(geography.includes("old source-domain river"), false);
});

test("routing samples the same canonical water identity as the final surface", () => {
  const point = firstRiverPoint(),
    position = sourceToLonLat(point.x, point.z),
    canonical = surfaceAt(point.x, point.z),
    wrapped = surfaceAt(point.x + SOURCE_PRESENTATION_WIDTH, point.z),
    routed = finalTerrainSampler(position);
  assert.equal(canonical.water, "river");
  assert.equal(canonical.walkable, false);
  assert.equal(wrapped.water, canonical.water);
  assert.equal(wrapped.catchmentCode, canonical.catchmentCode);
  assert.equal(routed.water, true);
  assert.equal(routed.heightM, canonical.elevation);

  const destination = sourceToLonLat(point.x + 900, point.z + 500),
    result = planRoute({
      from: { ...position, elevation: canonical.elevation },
      to: { ...destination, elevation: surfaceAt(point.x + 900, point.z + 500).elevation },
    });
  assert.equal(result.found, false);
  assert.equal(result.reason, "start-in-water");
});
