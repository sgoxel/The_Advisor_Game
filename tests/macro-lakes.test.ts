import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MACRO_GEOGRAPHY,
  buildMacroGeography,
  sampleMacroGeography,
} from "../src/macro-geography.ts";
import { canonicalFoundationSample } from "../src/spatial-authority.ts";
import { heightAt } from "../src/world.ts";
import { lonLatToSource } from "../src/planet.ts";

test("macro lakes are deterministic seeded inland water bodies", () => {
  assert.ok(MACRO_GEOGRAPHY.lakes.length >= 3);
  assert.deepEqual(
    buildMacroGeography(MACRO_GEOGRAPHY.seed).lakes,
    MACRO_GEOGRAPHY.lakes,
  );
  assert.notDeepEqual(
    buildMacroGeography("ADVISOR-OTHER-SEED").lakes.map((lake) => lake.canonicalPosition),
    MACRO_GEOGRAPHY.lakes.map((lake) => lake.canonicalPosition),
  );

  const continentsWithLakes = new Set<number>();
  for (const lake of MACRO_GEOGRAPHY.lakes) {
    continentsWithLakes.add(lake.continent);
    const sample = sampleMacroGeography(lake.canonicalPosition),
      foundation = canonicalFoundationSample(
        lake.canonicalPosition.lon,
        lake.canonicalPosition.lat,
      ),
      source = lonLatToSource(
        lake.canonicalPosition.lon,
        lake.canonicalPosition.lat,
      );
    assert.equal(sample.landform, "Ocean");
    assert.equal(sample.continent, lake.continent);
    assert.equal(sample.lake, lake.id);
    assert.equal(sample.lakeCode, lake.code);
    assert.equal(foundation.continent, lake.continent);
    assert.equal(foundation.lake, lake.id);
    assert.equal(foundation.lakeCode, lake.code);
    assert.ok(heightAt(source.x, source.z) < 0.1);
  }
  assert.equal(continentsWithLakes.size, 3);
});
