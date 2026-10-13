import assert from "node:assert/strict";
import test from "node:test";
import {
  WORLD_BUILDING_PRIORITIES,
  composeFinalSurface,
  type SurfaceBase,
  type SurfaceModifier,
} from "../src/final-surface.ts";

const dry: SurfaceBase = {
  groundHeight: 42,
  material: "Highlands",
  water: { kind: "none", level: -Infinity, flowX: 0, flowZ: 0 },
  walkable: false,
  vegetationDensityScale: 1,
  reservedUse: null,
};

test("priority map is exact 0-9 owner order", () => {
  assert.deepEqual(Object.values(WORLD_BUILDING_PRIORITIES), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("same-priority modifiers reduce by stable canonical id, not insertion order", () => {
  const a: SurfaceModifier = {
    id: "A",
    priority: 8,
    targetGroundHeight: 10,
    material: "Road",
  };
  const b: SurfaceModifier = {
    id: "B",
    priority: 8,
    targetGroundHeight: 12,
    material: "Settlement",
  };
  assert.deepEqual(composeFinalSurface(dry, [a, b]), composeFinalSurface(dry, [b, a]));
});

test("duplicate canonical modifier identity is idempotent", () => {
  const road: SurfaceModifier = {
    id: "road/wrap-boundary",
    priority: WORLD_BUILDING_PRIORITIES.road,
    weight: 0.75,
    targetGroundHeight: 20,
    material: "Road",
    walkable: true,
    vegetationDensityScale: 0,
    reservedUse: "road/wrap-boundary",
  };
  const single = composeFinalSurface(dry, [road]),
    duplicated = composeFinalSurface(dry, [road, { ...road }]);
  assert.deepEqual(duplicated, single);
  assert.deepEqual(duplicated.contributingModifierIds, [road.id]);
});

test("conflicting records cannot share one canonical modifier identity", () => {
  const a: SurfaceModifier = {
      id: "road/conflict",
      priority: WORLD_BUILDING_PRIORITIES.road,
      targetGroundHeight: 20,
    },
    b: SurfaceModifier = { ...a, targetGroundHeight: 21 };
  assert.throws(
    () => composeFinalSurface(dry, [a, b]),
    /Conflicting canonical surface modifier identity: road\/conflict/,
  );
  assert.throws(
    () => composeFinalSurface(dry, [b, a]),
    /Conflicting canonical surface modifier identity: road\/conflict/,
  );
});

test("road grading changes exposed-ground channels coherently", () => {
  const result = composeFinalSurface(dry, [
    {
      id: "road/1",
      priority: WORLD_BUILDING_PRIORITIES.road,
      targetGroundHeight: 3,
      material: "Road",
      walkable: true,
      vegetationDensityScale: 0,
      reservedUse: "road/1",
    },
  ]);
  assert.equal(result.groundHeight, 3);
  assert.equal(result.surfaceHeight, 3);
  assert.equal(result.material, "Road");
  assert.equal(result.groundMaterial, "Road");
  assert.equal(result.walkable, true);
  assert.equal(result.traversal, "road");
  assert.equal(result.vegetationDensityScale, 0);
  assert.equal(result.reservedUse, "road/1");
});

test("later earthwork cannot erase hydrology; legal crossing uses a separate deck", () => {
  const river: SurfaceBase = {
    ...dry,
    groundHeight: -2.8,
    material: "River",
    water: { kind: "river", level: 0, flowX: 0.2, flowZ: 0.98 },
    walkable: false,
  };
  const result = composeFinalSurface(river, [
    {
      id: "road/bridge",
      priority: WORLD_BUILDING_PRIORITIES.road,
      targetGroundHeight: 3,
      material: "Road",
      walkable: true,
      vegetationDensityScale: 0,
      deckHeight: 3,
    },
  ]);
  assert.equal(result.groundHeight, -2.8);
  assert.equal(result.groundMaterial, "River");
  assert.equal(result.water.kind, "river");
  assert.equal(result.deckHeight, 3);
  assert.equal(result.deckMaterial, "Bridge");
  assert.equal(result.surfaceHeight, 3);
  assert.equal(result.material, "Bridge");
  assert.equal(result.walkable, true);
  assert.equal(result.traversal, "bridge");
});

test("vegetation exclusions union independently from earthwork falloff", () => {
  const result = composeFinalSurface({ ...dry, walkable: true }, [
    {
      id: "road/shoulder",
      priority: WORLD_BUILDING_PRIORITIES.road,
      weight: 0.05,
      vegetationDensityScale: 0,
    },
  ]);
  assert.equal(result.vegetationDensityScale, 0);
});

test("priority-9 site reservation deterministically overrides lower owner reservations", () => {
  const modifiers: SurfaceModifier[] = [
    {
      id: "road/1",
      priority: WORLD_BUILDING_PRIORITIES.road,
      material: "Road",
      reservedUse: "road/1",
      walkable: true,
    },
    {
      id: "site/keep",
      priority: WORLD_BUILDING_PRIORITIES.site,
      material: "Settlement",
      reservedUse: "site/keep",
      walkable: true,
    },
  ];
  const result = composeFinalSurface({ ...dry, walkable: true }, modifiers);
  assert.equal(result.material, "Settlement");
  assert.equal(result.reservedUse, "site/keep");
  assert.deepEqual(result.contributingModifierIds, ["road/1", "site/keep"]);
});
