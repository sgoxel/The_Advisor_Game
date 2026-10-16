import assert from "node:assert/strict";
import test from "node:test";
import { villages } from "../src/geography.ts";
import { buildTile } from "../src/geometry.ts";
import { featuresFor, tileForPosition } from "../src/world.ts";

const fieldTint = (form?: string) => form === "pasture" ? [125, 143, 78]
  : form === "orchard" ? [126, 137, 70]
  : form === "vegetable" ? [137, 121, 65]
  : [158, 132, 66];

test("resolved settlement field form remains visible in generated structure geometry", () => {
  const place = villages[0], tile = tileForPosition(place.x, place.z, 8),
    field = featuresFor(tile).find((feature) => feature.code.includes(`/F/${place.id}/`) && feature.kind === "field");
  assert.ok(field, "starting village must resolve a field");
  const geometry = buildTile(tileForPosition(field.x, field.z, 13)).structures,
    expected = fieldTint(field.fieldForm);
  assert.ok(Array.from({ length: geometry.colors.length / 4 }, (_, index) => index).some((index) =>
    geometry.colors[index * 4] === expected[0] &&
    geometry.colors[index * 4 + 1] === expected[1] &&
    geometry.colors[index * 4 + 2] === expected[2]),
  "field-form base must survive the worker replacing its nature group");
});
