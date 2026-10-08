import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MACRO_PLAN,
  createMacroPlan,
  macroSampleAt,
  mountainSystems,
} from "../src/macro-geography.ts";
import { continents } from "../src/geography.ts";
import { terrainTint } from "../src/geometry.ts";
import { globeSurfaceColor } from "../src/globe-surface.ts";
import { heightAt, regionSeed } from "../src/world.ts";
import { lonLatToSource, sourceToLonLat } from "../src/planet.ts";

const domainAtRegionCenter = (lon: number, lat: number) => {
  const source = lonLatToSource(lon, lat),
    region = regionSeed(source.x / 2, source.z / 2),
    center = sourceToLonLat(region.x * 200 + 100, region.z * 200 + 100);
  return { region, macro: macroSampleAt(center) };
};

test("macro plan is exact, irregular, seed-derived and changes with seed", () => {
  assert.equal(MACRO_PLAN.continents.length, 3);
  assert.equal(MACRO_PLAN.islands.length, 18);
  assert.equal(MACRO_PLAN.lakes.length, 6);
  assert.equal(MACRO_PLAN.mountainSystems.length, 7);
  for (const continent of MACRO_PLAN.continents) {
    assert.equal(continent.lobes.length, 7);
    assert.equal(continent.bays.length, 3);
    assert.ok(continent.majorRadiusRad > continent.minorRadiusRad);
  }
  assert.deepEqual(
    continents.map((continent) => continent.canonicalPosition),
    MACRO_PLAN.continents.map((continent) => ({ ...continent.center, elevation: 0 })),
  );

  const again = createMacroPlan(MACRO_PLAN.seed, MACRO_PLAN.version),
    alternate = createMacroPlan("ADVISOR-0126-ALDERWICK-ALT", MACRO_PLAN.version);
  assert.deepEqual(again, MACRO_PLAN);
  assert.notDeepEqual(
    alternate.continents.map((continent) => continent.center),
    MACRO_PLAN.continents.map((continent) => continent.center),
  );
});

test("mainlands, separate islands and major lakes retain their macro identity in local terrain", () => {
  for (const continent of MACRO_PLAN.continents) {
    const sample = macroSampleAt(continent.center),
      source = lonLatToSource(continent.center.lon, continent.center.lat);
    assert.equal(sample.domain, "Mainland");
    assert.equal(sample.continentId, continent.id);
    assert.ok(heightAt(source.x, source.z) > 0);
  }
  for (const island of MACRO_PLAN.islands) {
    const sample = macroSampleAt(island.center),
      source = lonLatToSource(island.center.lon, island.center.lat);
    assert.equal(sample.domain, "Island");
    assert.equal(sample.islandId, island.id);
    assert.equal(sample.continentId, island.continent);
    assert.ok(heightAt(source.x, source.z) > 0);
  }
  for (const lake of MACRO_PLAN.lakes) {
    const sample = macroSampleAt(lake.center),
      source = lonLatToSource(lake.center.lon, lake.center.lat);
    assert.equal(sample.domain, "Lake");
    assert.equal(sample.lakeId, lake.id);
    assert.ok(heightAt(source.x, source.z) < 0);
  }
  for (const pole of [Math.PI / 2, -Math.PI / 2]) {
    const sample = macroSampleAt({ lon: 0, lat: pole }),
      source = lonLatToSource(0, pole);
    assert.equal(sample.domain, "Ocean");
    assert.ok(heightAt(source.x, source.z) < 0);
  }
});

test("source-detail region labels sample the macro parent instead of creating their own island grid", () => {
  const anchors = [
    ...MACRO_PLAN.continents.map((item) => item.center),
    ...MACRO_PLAN.islands.slice(0, 6).map((item) => item.center),
    ...MACRO_PLAN.lakes.slice(0, 3).map((item) => item.center),
    { lon: 0, lat: Math.PI / 2 },
  ];
  for (const anchor of anchors) {
    const { region, macro } = domainAtRegionCenter(anchor.lon, anchor.lat);
    assert.equal(region.landform, macro.domain);
  }
});

test("every required mountain archetype contributes a stable canonical landform", () => {
  const kinds = new Set(mountainSystems.map((system) => system.kind));
  assert.deepEqual(kinds, new Set([
    "long-chain",
    "compact-massif",
    "hooked-range",
    "low-highlands",
    "dominant-spine",
    "volcanic-chain",
    "volcano",
  ]));
  for (const system of mountainSystems) {
    const samples = [system.center, ...system.path].map((point) => macroSampleAt(point));
    assert.ok(
      samples.some((sample) => sample.mountainSystemId === system.id),
      `${system.code} must influence the final sampled terrain`,
    );
    assert.ok(
      Math.max(...samples.map((sample) => sample.reliefM)) >=
        (system.kind === "low-highlands" ? 50 : 150),
      `${system.code} must retain a readable relief signature`,
    );
  }
  const volcano = mountainSystems.find((system) => system.kind === "volcano")!;
  const volcanic = macroSampleAt(volcano.center);
  assert.equal(volcanic.mountainSystemId, volcano.id);
  assert.equal(volcanic.volcanic, true);
  assert.ok(volcanic.reliefM >= 400);
});

test("macro sampling is order-independent and globe/local presentation reads the same source", () => {
  const positions = [
    ...MACRO_PLAN.continents.map((item) => item.center),
    ...MACRO_PLAN.islands.slice(0, 4).map((item) => item.center),
    ...MACRO_PLAN.lakes.slice(0, 2).map((item) => item.center),
    ...mountainSystems.slice(0, 4).map((item) => item.center),
  ];
  const forward = new Map(
    positions.map((position) => [
      `${position.lon}/${position.lat}`,
      macroSampleAt(position),
    ]),
  );
  const reverse = new Map(
    [...positions].reverse().map((position) => [
      `${position.lon}/${position.lat}`,
      macroSampleAt(position),
    ]),
  );
  assert.deepEqual(reverse, forward);

  for (const position of positions) {
    const { x, z } = lonLatToSource(position.lon, position.lat);
    assert.deepEqual(globeSurfaceColor(x, z, 0), terrainTint(x, z));
  }
});
