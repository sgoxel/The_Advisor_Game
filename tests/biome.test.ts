import test from "node:test";
import assert from "node:assert/strict";
import {
  biomeEvidenceSamples,
  biomeSampleAt,
  biomeSampleAtSource,
  polarSignatures,
  type BiomeId,
} from "../src/biome.ts";
import { globeSurfaceColor } from "../src/globe-surface.ts";
import { terrainTint } from "../src/geometry.ts";
import { lonLatToSource } from "../src/planet.ts";

const required: BiomeId[] = [
  "grassland",
  "desert",
  "bare-ground",
  "boreal-forest",
  "temperate-forest",
  "warm-woodland",
  "snowy-mountain",
  "cliff-rock",
];

test("both poles are frozen by the same climate authority", () => {
  for (const lat of [Math.PI / 2, -Math.PI / 2]) {
    const sample = biomeSampleAt({ lon: 0.41, lat });
    assert.equal(sample.zone, "Frozen");
    assert.equal(sample.frozen, true);
    assert.match(sample.biome, /polar-/);
  }
});

test("canonical seed contains required terrain classes and three forest families", () => {
  const samples = biomeEvidenceSamples();
  for (const id of required) {
    assert.ok(samples[id], `missing evidence sample for ${id}`);
    assert.equal(biomeSampleAt(samples[id]!).biome, id);
  }
  assert.ok(samples.beach, "missing canonical beach sample");
  assert.equal(biomeSampleAt(samples.beach!).biome, "beach");
  const families = new Set(
    ["boreal-forest", "temperate-forest", "warm-woodland"].map(
      (id) => biomeSampleAt(samples[id as BiomeId]!).forestFamily,
    ),
  );
  assert.deepEqual(families, new Set(["boreal", "temperate", "warm-woodland"]));
});

test("beaches belong to the canonical coast and cliffs/snow belong to mountain authority", () => {
  const samples = biomeEvidenceSamples(),
    beach = biomeSampleAt(samples.beach!),
    cliff = biomeSampleAt(samples["cliff-rock"]!),
    snow = biomeSampleAt(samples["snowy-mountain"]!);
  assert.equal(beach.macro.land, true);
  assert.ok(beach.coastDistanceRad >= 0 && beach.coastDistanceRad < 0.00036);
  assert.ok(cliff.macro.mountainIntensity > 0.28 || cliff.elevationM > 150);
  assert.ok(snow.elevationM > 180 || snow.macro.mountainIntensity > 0.4);
  assert.ok(snow.temperatureC < 3.5);
});

test("Realm and flat material identity agree at matching absolute coordinates", () => {
  const samples = biomeEvidenceSamples();
  for (const key of [
    "grassland",
    "desert",
    "beach",
    "boreal-forest",
    "temperate-forest",
    "warm-woodland",
    "snowy-mountain",
    "north-pole",
    "south-pole",
  ] as const) {
    const position = samples[key]!;
    assert.ok(position, `missing ${key}`);
    const source = lonLatToSource(position.lon, position.lat),
      realm = biomeSampleAt(position),
      flat = biomeSampleAtSource(source.x, source.z);
    assert.equal(flat.zone, realm.zone, `${key} climate changed by presentation`);
    assert.equal(flat.biome, realm.biome, `${key} material changed by presentation`);
    assert.deepEqual(globeSurfaceColor(source.x, source.z), terrainTint(source.x, source.z));
  }
});

test("polar borders are irregular rather than constant-latitude bands", () => {
  const transitions: number[] = [];
  for (const lon of [-2.8, -2.1, -1.4, -0.7, 0, 0.7, 1.4, 2.1, 2.8]) {
    let first = 1.0;
    for (let lat = 1.0; lat <= 1.48; lat += 0.005)
      if (biomeSampleAt({ lon, lat }).zone === "Frozen") {
        first = lat;
        break;
      }
    transitions.push(first);
  }
  assert.ok(Math.max(...transitions) - Math.min(...transitions) > 0.035);
});

test("seeded biome samples are visit-order independent and polar regions are not mirrored", () => {
  const positions = [
    { lon: -2.4, lat: -0.7 },
    { lon: -1.1, lat: 0.3 },
    { lon: 0.2, lat: 1.18 },
    { lon: 1.7, lat: -1.27 },
    { lon: 2.6, lat: 0.58 },
  ];
  const signature = (position: { lon: number; lat: number }) => {
    const sample = biomeSampleAt(position);
    return `${sample.zone}/${sample.biome}/${sample.temperatureC.toFixed(6)}/${sample.moisture.toFixed(6)}`;
  };
  const forward = positions.map(signature),
    reverse = [...positions].reverse().map(signature).reverse();
  assert.deepEqual(forward, reverse);
  const polar = polarSignatures();
  assert.notDeepEqual(polar.north, polar.south);
});
