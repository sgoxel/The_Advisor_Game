import test from "node:test";
import assert from "node:assert/strict";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_WIDTH,
} from "../src/planet.ts";
import {
  STREAMING_BUDGETS,
  canonicalStreamTileKey,
  classifyStreamingDevice,
  estimateTileGeometryBytes,
  withinStreamingBudget,
} from "../src/streaming.ts";
import {
  MAX_LEVEL,
  WORLD_SIZE,
  selectTiles,
  tileAt,
  type Tile,
  type View,
} from "../src/world.ts";

const view = (x: number, z: number): View => ({
  x,
  z,
  halfHeight: 97,
  aspect: 1440 / 900,
  yaw: 0,
  pixels: 900,
});

test("streaming device classes use root-contract budgets", () => {
  assert.equal(classifyStreamingDevice(390, 844), "phone");
  assert.equal(classifyStreamingDevice(844, 390), "phone");
  assert.equal(classifyStreamingDevice(768, 1024), "tablet");
  assert.equal(classifyStreamingDevice(1440, 900), "desktop");
  assert.deepEqual(STREAMING_BUDGETS.phone, {
    queue: 4,
    active: 160,
    cached: 180,
    cpuBytes: 96 * 1024 * 1024,
    gpuBytes: 96 * 1024 * 1024,
  });
  assert.equal(
    withinStreamingBudget(
      STREAMING_BUDGETS.tablet,
      220,
      240,
      6,
      160 * 1024 * 1024,
      160 * 1024 * 1024,
    ),
    true,
  );
  assert.equal(
    withinStreamingBudget(STREAMING_BUDGETS.phone, 161, 1, 1, 1, 1),
    false,
  );
});

test("canonical stream keys ignore equivalent full-turn source representations", () => {
  const count = 2 ** MAX_LEVEL,
    source = tileAt(MAX_LEVEL, count - 4, Math.floor(count / 2)),
    alias: Tile = {
      ...source,
      x: source.x + count,
      minX: source.minX + WORLD_SIZE,
      key: `${source.key}/full-turn-alias`,
    };
  assert.equal(canonicalStreamTileKey(alias), canonicalStreamTileKey(source));
  assert.match(canonicalStreamTileKey(source), /\/PLANET\/v1\/F\d\/L24\//);
});

test("wrap-straddling selection covers both seam sides with unique canonical ownership", () => {
  const selected = selectTiles(
    view(SOURCE_PRESENTATION_WIDTH / 2 - 10, 0),
    190,
    STREAMING_BUDGETS.desktop.active,
  );
  assert.ok(selected.length > 0);
  assert.ok(selected.length <= STREAMING_BUDGETS.desktop.active);
  assert.ok(
    selected.some(
      (tile) => tile.minX < -SOURCE_PRESENTATION_WIDTH / 2 + 1024,
    ),
  );
  assert.ok(
    selected.some(
      (tile) =>
        tile.minX + tile.size > SOURCE_PRESENTATION_WIDTH / 2 - 1024,
    ),
  );
  const keys = selected.map(canonicalStreamTileKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("pole selection never streams a second clamped copy beyond either pole", () => {
  for (const z of [
    -SOURCE_PRESENTATION_POLE_DISTANCE,
    SOURCE_PRESENTATION_POLE_DISTANCE,
  ]) {
    const selected = selectTiles(
      view(12345, z),
      190,
      STREAMING_BUDGETS.phone.active,
    );
    assert.ok(selected.length > 0);
    assert.ok(selected.length <= STREAMING_BUDGETS.phone.active);
    for (const tile of selected) {
      assert.ok(tile.minZ + tile.size > -SOURCE_PRESENTATION_POLE_DISTANCE);
      assert.ok(tile.minZ < SOURCE_PRESENTATION_POLE_DISTANCE);
    }
    const keys = selected.map(canonicalStreamTileKey);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test("geometry byte accounting uses transferred typed-array storage", () => {
  const geometry = {
    positions: new Float32Array(9),
    normals: new Float32Array(9),
    colors: new Uint8Array(12),
    indices: new Uint32Array(3),
  };
  const estimate = estimateTileGeometryBytes({
    terrain: geometry,
    structures: geometry,
    nature: geometry,
    detail: geometry,
  });
  const one =
    geometry.positions.byteLength +
    geometry.normals.byteLength +
    geometry.colors.byteLength +
    geometry.indices.byteLength;
  assert.deepEqual(estimate, { cpuBytes: one * 4, gpuBytes: one * 4 });
});
