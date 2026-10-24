import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ASSET_URLS, assetMesh, loadAssetMeshes, parseGlb } from "../src/asset-meshes.ts";
import { buildPropForTest } from "../src/geometry.ts";

const fromDisk = async (url: string) => { const bytes = await readFile(fileURLToPath(url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };

test("Blender assets parse into flat-coloured, metre-scale meshes inside their yard footprint", async () => {
  for (const [name, url] of Object.entries(ASSET_URLS)) {
    const mesh = parseGlb(await fromDisk(url));
    assert.ok(mesh.triangles > 50 && mesh.triangles <= 1500, `${name}: ${mesh.triangles} triangles`);
    assert.equal(mesh.colors.length, mesh.triangles * 3);
    assert.ok(mesh.indices.every((i) => i < mesh.positions.length / 3), `${name}: indices in range`);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i]); maxX = Math.max(maxX, mesh.positions[i]);
      minY = Math.min(minY, mesh.positions[i + 1]); maxY = Math.max(maxY, mesh.positions[i + 1]);
      minZ = Math.min(minZ, mesh.positions[i + 2]); maxZ = Math.max(maxZ, mesh.positions[i + 2]);
    }
    // The hand cart's yard footprint is 1.5 m x 2.4 m; it stands on the ground and is under 1.2 m tall.
    if (name === "cart") {
      assert.ok(maxX - minX <= 1.6 && maxZ - minZ <= 2.45, `${name}: ${(maxX - minX).toFixed(2)} x ${(maxZ - minZ).toFixed(2)} m`);
      assert.ok(Math.abs(minY) < .05 && maxY < 1.2, `${name}: height ${minY.toFixed(2)}..${maxY.toFixed(2)} m`);
      assert.ok(maxZ > 1.0, `${name}: shafts point to the front (+Z)`);
    }
  }
});

test("yard carts use the Blender model once it is loaded", async () => {
  const before = buildPropForTest({ x: 0, y: 0, z: 0, code: "T", kind: "yard-prop", label: "cart", widthM: 1.5, depthM: 2.4, variant: 3, yawRad: .4 }).closeDetail;
  const result = await loadAssetMeshes(fromDisk);
  assert.deepEqual(result.failed, []);
  const after = buildPropForTest({ x: 0, y: 0, z: 0, code: "T", kind: "yard-prop", label: "cart", widthM: 1.5, depthM: 2.4, variant: 3, yawRad: .4 }).closeDetail;
  assert.equal(after.indices.length / 3, assetMesh("cart")!.triangles, "the drawn cart is exactly the Blender mesh");
  assert.notEqual(after.indices.length, before.indices.length, "the procedural fallback was replaced");
  assert.equal(buildPropForTest({ x: 0, y: 0, z: 0, code: "T", kind: "yard-prop", label: "cart", widthM: 1.5, depthM: 2.4, variant: 3, yawRad: .4 }, 16).closeDetail.indices.length, 0, "close-up only");
});
