import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ASSET_URLS, assetBaseName, assetFor, assetVariants, loadAssetMeshes, parseGlb } from "../src/asset-meshes.ts";
import { buildPropForTest } from "../src/geometry.ts";

const fromDisk = async (url: string) => { const bytes = await readFile(fileURLToPath(url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };
/** Yard footprints (width x depth, metres) from world.ts YARD_PROP_SIZES, plus a height limit. */
const FOOTPRINTS: Record<string, [number, number, number]> = { cart: [1.5, 2.4, 1.2], woodpile: [1.9, 1.1, 1.3], barrels: [1.3, .9, 1.2] };

test("Blender assets parse into flat-coloured, metre-scale meshes inside their yard footprint", async () => {
  for (const [name, url] of Object.entries(ASSET_URLS)) {
    const mesh = parseGlb(await fromDisk(url));
    assert.ok(mesh.triangles > 50 && mesh.triangles <= 1000, `${name}: ${mesh.triangles} triangles`);
    assert.equal(mesh.colors.length, mesh.triangles * 3);
    assert.ok(mesh.indices.every((i) => i < mesh.positions.length / 3), `${name}: indices in range`);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i]); maxX = Math.max(maxX, mesh.positions[i]);
      minY = Math.min(minY, mesh.positions[i + 1]); maxY = Math.max(maxY, mesh.positions[i + 1]);
      minZ = Math.min(minZ, mesh.positions[i + 2]); maxZ = Math.max(maxZ, mesh.positions[i + 2]);
    }
    const footprint = FOOTPRINTS[assetBaseName(name)];
    assert.ok(footprint, `${name}: has a yard footprint`);
    const [w, d, h] = footprint, slack = .05;
    assert.ok(Math.max(-minX, maxX) <= w / 2 + slack && Math.max(-minZ, maxZ) <= d / 2 + slack,
      `${name}: x ${minX.toFixed(2)}..${maxX.toFixed(2)}, z ${minZ.toFixed(2)}..${maxZ.toFixed(2)} inside ${w} x ${d} m`);
    assert.ok(Math.abs(minY) < .05 && maxY < h, `${name}: height ${minY.toFixed(2)}..${maxY.toFixed(2)} m`);
    if (name === "cart") assert.ok(maxZ > 1.0, "cart: shafts point to the front (+Z)");
    if (assetBaseName(name) === "woodpile") assert.ok(maxZ > .3, "woodpile: chopping block in front (+Z)");
  }
});

test("yard objects use the Blender models once loaded, one SEED-chosen variant per home", async () => {
  const prop = (label: string, variant: number, tile?: number) =>
    buildPropForTest({ x: 0, y: 0, z: 0, code: "T", kind: "yard-prop", label, widthM: FOOTPRINTS[label][0], depthM: FOOTPRINTS[label][1], variant, yawRad: .4 }, tile).closeDetail;
  const before = prop("woodpile", 3);
  const result = await loadAssetMeshes(fromDisk);
  assert.deepEqual(result.failed, []);
  assert.equal(result.loaded, Object.keys(ASSET_URLS).length);
  assert.equal(assetVariants("barrels").length, 2);
  for (const label of Object.keys(FOOTPRINTS)) for (const variant of [0, 1, 3, 42]) {
    const drawn = prop(label, variant);
    assert.equal(drawn.indices.length / 3, assetFor(label, variant)!.triangles, `${label} v${variant}: drawn exactly as the Blender mesh`);
    assert.deepEqual(drawn.positions, prop(label, variant).positions, `${label} v${variant}: deterministic`);
    assert.equal(prop(label, variant, 16).indices.length, 0, `${label}: close-up only`);
  }
  assert.notEqual(prop("woodpile", 3).indices.length, before.indices.length, "the procedural woodpile was replaced");
  assert.notEqual(prop("barrels", 0).indices.length, prop("barrels", 1).indices.length, "neighbouring variants pick different barrel models");
});
