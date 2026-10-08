import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STREAMING_BUDGETS,
  deviceClassForViewport,
  streamingBudgetForViewport,
} from "../src/streaming.ts";
import {
  WORLD_MIN,
  WORLD_SIZE,
  selectTiles,
  type View,
} from "../src/world.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  sourceToLonLat,
} from "../src/planet.ts";

const view = (x: number, z: number, halfHeight = 96): View => ({
  x,
  z,
  halfHeight,
  aspect: 16 / 9,
  yaw: 0,
  pixels: 720,
});

test("streaming budgets match the root phone/tablet/desktop contract", () => {
  assert.equal(deviceClassForViewport(390, 844), "phone");
  assert.equal(deviceClassForViewport(844, 390), "phone");
  assert.equal(deviceClassForViewport(768, 1024), "tablet");
  assert.equal(deviceClassForViewport(1024, 768), "tablet");
  assert.equal(deviceClassForViewport(1280, 720), "desktop");
  assert.equal(deviceClassForViewport(1440, 900), "desktop");
  assert.deepEqual(streamingBudgetForViewport(390, 844), STREAMING_BUDGETS.phone);
  assert.deepEqual(
    [
      STREAMING_BUDGETS.phone.generationReadyQueue,
      STREAMING_BUDGETS.tablet.generationReadyQueue,
      STREAMING_BUDGETS.desktop.generationReadyQueue,
    ],
    [4, 6, 8],
  );
  assert.deepEqual(
    [
      STREAMING_BUDGETS.phone.activePatches,
      STREAMING_BUDGETS.tablet.activePatches,
      STREAMING_BUDGETS.desktop.activePatches,
    ],
    [160, 220, 260],
  );
  assert.deepEqual(
    [
      STREAMING_BUDGETS.phone.cachedPatches,
      STREAMING_BUDGETS.tablet.cachedPatches,
      STREAMING_BUDGETS.desktop.cachedPatches,
    ],
    [180, 240, 320],
  );
});

test("wrap-straddling selection covers both source edges with unique canonical keys", () => {
  const max = -WORLD_MIN,
    tiles = selectTiles(view(max - 20, 0), 190, STREAMING_BUDGETS.phone.activePatches);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.length <= STREAMING_BUDGETS.phone.activePatches);
  assert.equal(new Set(tiles.map((tile) => tile.key)).size, tiles.length);
  assert.ok(tiles.some((tile) => tile.minX < WORLD_MIN + 1024));
  assert.ok(tiles.some((tile) => tile.minX + tile.size > max - 1024));
});

test("one full circumference returns identical canonical patch identities", () => {
  const a = selectTiles(view(1234, -2200), 190, 220).map((tile) => tile.key),
    b = selectTiles(view(1234 + WORLD_SIZE, -2200), 190, 220).map(
      (tile) => tile.key,
    );
  assert.deepEqual(b, a);
});

test("pole-straddling selection reflects across the pole without duplicate ownership", () => {
  const pole = SOURCE_PRESENTATION_POLE_DISTANCE,
    tiles = selectTiles(view(2400, -pole + 8), 190, 220);
  assert.ok(tiles.length > 0);
  assert.equal(new Set(tiles.map((tile) => tile.key)).size, tiles.length);
  for (const tile of tiles) {
    assert.ok(tile.minZ >= -pole - 1e-9);
    assert.ok(tile.minZ + tile.size <= pole + 1e-9);
    const centre = sourceToLonLat(
      tile.minX + tile.size / 2,
      tile.minZ + tile.size / 2,
    );
    assert.ok(centre.lat >= -Math.PI / 2 && centre.lat <= Math.PI / 2);
  }
  const focusLon = sourceToLonLat(2400, -pole + 8).lon,
    oppositeLon = ((focusLon + Math.PI + Math.PI) % (Math.PI * 2)) - Math.PI;
  assert.ok(
    tiles.some((tile) => {
      const lon = sourceToLonLat(
        tile.minX + tile.size / 2,
        tile.minZ + tile.size / 2,
      ).lon;
      return Math.abs(Math.atan2(Math.sin(lon - focusLon), Math.cos(lon - focusLon))) < 0.2;
    }),
  );
  assert.ok(
    tiles.some((tile) => {
      const lon = sourceToLonLat(
        tile.minX + tile.size / 2,
        tile.minZ + tile.size / 2,
      ).lon;
      return Math.abs(Math.atan2(Math.sin(lon - oppositeLon), Math.cos(lon - oppositeLon))) < 0.2;
    }),
  );
});
