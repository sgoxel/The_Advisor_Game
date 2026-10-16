import assert from "node:assert/strict";
import test from "node:test";
import { villages } from "../src/geography.ts";
import { buildTile } from "../src/geometry.ts";
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { featuresFor, tileForPosition } from "../src/world.ts";

const fieldTint = (form?: string) => form === "pasture" ? [125, 143, 78]
  : form === "orchard" ? [126, 137, 70]
  : form === "vegetable" ? [137, 121, 65]
  : [158, 132, 66];

test("resolved settlement field form remains visible in generated structure geometry", () => {
  const place = villages[0], plan = settlementExteriorFor(place), tiles = new Map<string, ReturnType<typeof tileForPosition>>();
  for (const candidate of [{ x: place.x, z: place.z }, ...plan.plots.filter((plot) => plot.kind === "field").flatMap((plot) => plot.candidates)]) {
    const tile = tileForPosition(candidate.x, candidate.z, 8);
    tiles.set(tile.key, tile);
  }
  const field = [...tiles.values()].flatMap(featuresFor)
    .find((feature) => feature.code.includes(`/F/${place.id}/`) && feature.kind === "field");
  assert.ok(field, "starting village must resolve a field");
  const geometry = buildTile(tileForPosition(field.x, field.z, 13)).structures,
    expected = fieldTint(field.fieldForm);
  assert.ok(Array.from({ length: geometry.colors.length / 4 }, (_, index) => index).some((index) =>
    geometry.colors[index * 4] === expected[0] &&
    geometry.colors[index * 4 + 1] === expected[1] &&
    geometry.colors[index * 4 + 2] === expected[2]),
  "field-form base must survive the worker replacing its nature group");
});

test("settlement overlay vertices stay in the tile-local geometry frame", () => {
  const place = villages.reduce((chosen, candidate) =>
      Math.hypot(candidate.x, candidate.z) > Math.hypot(chosen.x, chosen.z) ? candidate : chosen),
    plan = settlementExteriorFor(place),
    tiles = new Map<string, ReturnType<typeof tileForPosition>>(),
    points = [
      { x: place.x, z: place.z },
      ...plan.plots.flatMap((plot) => plot.candidates),
      ...plan.streets.flatMap((street) => street.points),
      ...plan.gates.map((gate) => ({ x: gate.x, z: gate.z })),
    ];
  assert.ok(Math.hypot(place.x, place.z) > 1000, "fixture must be meaningfully far from source origin");
  for (const point of points) {
    const tile = tileForPosition(point.x, point.z, 13);
    tiles.set(tile.key, tile);
  }
  const feature = [...tiles.values()].flatMap(featuresFor)
    .find((candidate) => candidate.code.includes(`/F/${place.id}/`) &&
      ["field", "service", "street", "border", "gate", "guard-post"].includes(candidate.kind));
  assert.ok(feature, "far settlement must expose a semantic exterior feature");
  const tile = tileForPosition(feature.x, feature.z, 13), geometry = buildTile(tile).structures,
    localLimit = tile.size / 2 + 96;
  for (let index = 0; index < geometry.positions.length; index += 3) {
    assert.ok(Math.abs(geometry.positions[index]) <= localLimit,
      `structure x escaped tile-local frame: ${geometry.positions[index]} vs ${localLimit}`);
    assert.ok(Math.abs(geometry.positions[index + 2]) <= localLimit,
      `structure z escaped tile-local frame: ${geometry.positions[index + 2]} vs ${localLimit}`);
  }
});
