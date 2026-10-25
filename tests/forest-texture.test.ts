import test from "node:test";
import assert from "node:assert/strict";
import { villages } from "../src/geography.ts";
import { climateSampleAt } from "../src/climate.ts";
import { sourceToLonLat, SOURCE_PRESENTATION_WIDTH } from "../src/planet.ts";
import { forestTextureAt, forestTextureFor, forestStandNoise } from "../src/forest-texture.ts";
import { forestCoverForTile, TREE_TEXTURE_MIN } from "../src/forest-cover.ts";
import { finalSurfaceAt, type Tile } from "../src/world.ts";

const tile = (x: number, z: number, size: number): Tile => ({ minX: x, minZ: z, size, key: `forest-texture/${x}/${z}/${size}`, level: 0, x: 0, z: 0 });
const M = 8 / 15.27; // 8 m in source units (15.27 m per unit)
const forestAt = (x: number, z: number) => {
  const s = finalSurfaceAt(x, z);
  return climateSampleAt(sourceToLonLat(x, z), s.groundHeight).forestFamily;
};
/** First forest point found on rings around the first villages: deterministic, bounded. */
function forestOrigin() {
  for (const place of villages.slice(0, 20))
    for (let r = 30; r < 600; r += 30)
      for (let a = 0; a < 12; a++) {
        const x = place.x + Math.cos(a / 12 * 6.283) * r, z = place.z + Math.sin(a / 12 * 6.283) * r,
          s = finalSurfaceAt(x, z);
        if (s.water.kind !== "none" || s.vegetationDensityScale < .9 || !forestAt(x, z)) continue;
        let n = 0;
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (forestAt(x + i * M * 3, z + j * M * 3)) n++;
        if (n >= 30) return { x, z };
      }
  throw new Error("No forest fixture near the villages");
}

test("forest texture is pure, bounded to 0..1 and identical across calls", () => {
  const o = forestOrigin();
  for (let i = 0; i < 300; i++) {
    const x = o.x + (i % 20) * M * 1.7, z = o.z + Math.floor(i / 20) * M * 1.7, a = forestTextureAt(x, z);
    assert.equal(forestTextureAt(x, z), a);
    assert.ok(a >= 0 && a <= 1 && Number.isFinite(a), `${a}`);
    assert.equal(forestTextureAt(x + SOURCE_PRESENTATION_WIDTH, z), a, "the world wraps seamlessly in x");
  }
  const n = forestStandNoise(sourceToLonLat(o.x, o.z));
  assert.ok(n >= 0 && n <= 1);
});

test("forest texture is zero outside forest climate, on roads and on water", () => {
  const o = forestOrigin();
  let nonForest = 0, road = 0, water = 0;
  for (const place of villages.slice(0, 12)) {
    assert.equal(forestTextureAt(place.x, place.z), 0, "settlement centre is never forest");
    for (let i = -25; i <= 25; i++) for (let j = -25; j <= 25; j++) {
      const x = place.x + i * 6, z = place.z + j * 6, s = finalSurfaceAt(x, z), t = forestTextureAt(x, z);
      if (!forestAt(x, z)) { nonForest++; assert.equal(t, 0); }
      if (s.groundMaterial === "Road") { road++; assert.equal(t, 0); }
      if (s.water.kind !== "none") { water++; assert.equal(t, 0); }
    }
  }
  assert.ok(nonForest > 0 && road > 0 && water > 0, `fixtures ${nonForest}/${road}/${water}`);
  assert.equal(forestTextureFor(sourceToLonLat(o.x, o.z), null, 1), 0);
  assert.equal(forestTextureFor(sourceToLonLat(o.x, o.z), "temperate-deciduous-mixed", 0), 0);
});

test("a forest has dark tree stands and light grassy clearings", () => {
  const o = forestOrigin();
  let dark = 0, light = 0, total = 0;
  for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
    const x = o.x + i * M, z = o.z + j * M;
    if (!forestAt(x, z)) continue;
    const t = forestTextureAt(x, z);
    total++; if (t > .7) dark++; if (t < .3) light++;
  }
  assert.ok(total > 1000, `${total}`);
  assert.ok(dark > total * .05, `dark ${dark}/${total}`);
  assert.ok(light > total * .05, `light ${light}/${total}`);
});

test("3D trees stand only on dark texture and never in light clearings", () => {
  const o = forestOrigin();
  let trees = 0, emptyTiles = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const t = tile(o.x + i * 8, o.z + j * 8, 8), cover = forestCoverForTile(t);
    for (const tree of cover.patches) {
      trees++;
      const texture = forestTextureAt(tree.x, tree.z);
      assert.ok(texture >= TREE_TEXTURE_MIN && texture > .3, `tree ${tree.code} on texture ${texture}`);
    }
    // A tile whose sampled texture is light everywhere holds no tree.
    let maxTexture = 0;
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) maxTexture = Math.max(maxTexture, forestTextureAt(t.minX + a + .5, t.minZ + b + .5));
    if (maxTexture < .05) { emptyTiles++; assert.equal(cover.patches.length, 0); }
  }
  assert.ok(trees > 40, `${trees} trees`);
  assert.ok(emptyTiles > 0, "fixture contains a light clearing tile");
});

test("coarse tiles carry no tree bodies: far zoom shows the forest only as terrain colour", () => {
  const o = forestOrigin();
  for (const size of [16, 64, 256]) assert.equal(forestCoverForTile(tile(o.x, o.z, size)).patches.length, 0);
});
