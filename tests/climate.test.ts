import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIMATE_AUTHORITY_CODE,
  TERRAIN_PALETTE,
  climateSampleAt,
  frozenLatitudeAt,
  polarBoundaryAt,
  terrainLabel,
  type ClimateSample,
  type TerrainClass,
} from "../src/climate.ts";
import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "../src/config.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { lonLatToSource } from "../src/planet.ts";
import { terrainTint } from "../src/geometry.ts";

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function canonicalSamples() {
  const samples: { lon: number; lat: number; climate: ClimateSample }[] = [];
  for (let latDeg = -87.5; latDeg <= 87.5; latDeg += 2.5)
    for (let lonDeg = -177.5; lonDeg < 180; lonDeg += 2.5) {
      const lon = radians(lonDeg),
        lat = radians(latDeg),
        position = { lon, lat },
        macro = macroSampleAt(position),
        climate = climateSampleAt(position, macro.reliefM);
      samples.push({ lon, lat, climate });
    }
  return samples;
}

const samples = canonicalSamples();
const byTerrain = new Map<TerrainClass, (typeof samples)[number]>();
for (const item of samples) if (!byTerrain.has(item.climate.terrainClass)) byTerrain.set(item.climate.terrainClass, item);

test("climate authority is seed-addressed and foundation-versioned", () => {
  assert.equal(WORLD_SEED, "ADVISOR-0126-ALDERWICK");
  assert.equal(WORLD_FOUNDATION_VERSION, "v4");
  assert.equal(CLIMATE_AUTHORITY_CODE, `${WORLD_SEED}/v4/CLIMATE`);
  for (const item of samples.filter((_, index) => index % 191 === 0)) {
    const position = { lon: item.lon, lat: item.lat };
    assert.deepEqual(climateSampleAt(position), climateSampleAt(position));
    assert.ok(climateSampleAt(position).code.startsWith(CLIMATE_AUTHORITY_CODE));
  }
});

test("both poles are frozen by one irregular non-mirrored authority", () => {
  const north = climateSampleAt({ lon: 0.37, lat: Math.PI / 2 }),
    south = climateSampleAt({ lon: 0.37, lat: -Math.PI / 2 });
  assert.equal(north.frozen, true);
  assert.equal(south.frozen, true);
  assert.equal(frozenLatitudeAt({ lon: 0.37, lat: Math.PI / 2 }), true);
  assert.equal(frozenLatitudeAt({ lon: 0.37, lat: -Math.PI / 2 }), true);
  assert.ok(["sea-ice", "polar-ice"].includes(north.terrainClass));
  assert.ok(["sea-ice", "polar-ice"].includes(south.terrainClass));
  assert.notEqual(
    polarBoundaryAt({ lon: 0.37, lat: 1 }),
    polarBoundaryAt({ lon: 0.37, lat: -1 }),
  );
  assert.notEqual(north.temperatureC, south.temperatureC);
});

test("frozen-zone borders are irregular rather than constant-latitude bands", () => {
  const lat = radians(67),
    states = new Set<boolean>();
  for (let lonDeg = -180; lonDeg < 180; lonDeg += 5)
    states.add(frozenLatitudeAt({ lon: radians(lonDeg), lat }));
  assert.deepEqual([...states].sort(), [false, true]);
});

test("canonical seed contains the required major terrain and forest families", () => {
  const required: TerrainClass[] = [
    "grassland",
    "desert",
    "bare-earth",
    "beach",
    "cliff",
    "conifer-forest",
    "temperate-forest",
    "dry-woodland",
    "snowy-mountain",
    "sea-ice",
  ];
  for (const terrain of required)
    assert.ok(byTerrain.has(terrain), `canonical seed must contain ${terrain}`);
  assert.equal(byTerrain.get("conifer-forest")!.climate.forestFamily, "conifer-boreal");
  assert.equal(
    byTerrain.get("temperate-forest")!.climate.forestFamily,
    "temperate-deciduous-mixed",
  );
  assert.equal(byTerrain.get("dry-woodland")!.climate.forestFamily, "warm-dry-woodland");
});

test("coasts, cliffs and snow are physically constrained by canonical samples", () => {
  const beach = byTerrain.get("beach")!.climate,
    cliff = byTerrain.get("cliff")!.climate,
    snow = byTerrain.get("snowy-mountain")!.climate;
  assert.ok(beach.coastDistanceM >= 0 && beach.coastDistanceM < 2300);
  assert.ok(cliff.ruggedness > 0.58 || cliff.elevationM > 80);
  assert.ok(snow.elevationM >= snow.snowLineM);
  assert.ok(snow.temperatureC < 7);
});

test("all semantic materials use one bounded renderer-independent RGB authority", () => {
  assert.equal(Object.keys(TERRAIN_PALETTE).length, 19);
  for (const [terrain, rgb] of Object.entries(TERRAIN_PALETTE)) {
    assert.equal(rgb.length, 3, terrain);
    for (const channel of rgb)
      assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, terrain);
  }
  for (const item of samples.filter((_, index) => index % 173 === 0)) {
    const { x, z } = lonLatToSource(item.lon, item.lat),
      coarse = terrainTint(x, z, 4096),
      local = terrainTint(x, z, 32),
      delta = Math.hypot(
        coarse[0] - local[0],
        coarse[1] - local[1],
        coarse[2] - local[2],
      );
    // Detail frequency may refine the surface but cannot jump to another palette.
    assert.ok(delta < 70, `${terrainLabel(item.climate)} palette drifted ${delta.toFixed(1)}`);
  }
});
