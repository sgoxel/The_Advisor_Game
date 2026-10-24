import test from "node:test";
import assert from "node:assert/strict";
import { LIT_DIFFUSE_GLSL, LIT_DIFFUSE_WGSL, LIT_NORMAL_GLSL, LIT_NORMAL_WGSL, SURFACE_KIND as K, litSurfaceKind, surfaceDetailChunks } from "../src/surface-detail.ts";

test("lit surfaces pick a pattern from their colour and orientation", () => {
  const wall = 0, roof = .8, flat = 1;
  assert.equal(litSurfaceKind([226, 214, 190], wall), K.plaster, "cream house wall");
  assert.equal(litSurfaceKind([168, 70, 52], wall), K.brick, "red wall");
  assert.equal(litSurfaceKind([120, 86, 54], wall), K.wood, "timber wall / barrel");
  assert.equal(litSurfaceKind([150, 146, 138], wall), K.ashlar, "grey stone wall");
  assert.equal(litSurfaceKind([140, 75, 50], roof), K.roof, "pitched roof");
  assert.equal(litSurfaceKind([140, 75, 50], flat), K.roof, "low roof seen as flat");
  assert.equal(litSurfaceKind([112, 92, 62], flat), K.dirt, "dirt road strip");
  assert.equal(litSurfaceKind([150, 150, 146], flat), K.paving, "grey paving");
  assert.equal(litSurfaceKind([90, 130, 60], flat), K.grass, "lawn");
  assert.equal(litSurfaceKind([70, 110, 50], roof), K.foliage, "tree crown");
  assert.equal(litSurfaceKind([30, 40, 46], wall), K.none, "dark window glass stays plain");
});

test("both shader languages carry the same detail pipeline, and only materials that ask for it", () => {
  for (const mode of ["terrain", "lit"] as const) {
    const sd = surfaceDetailChunks(mode);
    for (const name of ["sdHash", "sdNoise", "sdCells", "sdPattern", "sdKindLit", "sdKindTerrain", "sdBlocks"]) {
      assert.ok(sd.glslDeclaration.includes(`${name}(`) && sd.wgslDeclaration.includes(`fn ${name}(`), `${name} in GLSL and WGSL`);
    }
    // Forward pass only (shadow/pick passes have no vertex colour); derivatives before any branch.
    for (const main of [sd.glslMainStart, sd.wgslMainStart]) {
      assert.ok(main.trimStart().startsWith("#ifdef FORWARD_PASS"));
      assert.ok(main.indexOf("sdFp < 0.45") > main.search(/d(Fdx|pdx)\(sdP\)/), "screen derivatives of position are taken before the branch");
      assert.equal(main.includes("sdKindTerrain("), mode === "terrain");
      assert.equal(main.includes("sdShade ="), mode === "terrain", "terrain shades its relief from the sun; lit materials bend the normal");
    }
  }
  assert.ok(LIT_DIFFUSE_GLSL.includes("dAlbedo *= sdMul") && LIT_DIFFUSE_WGSL.includes("dAlbedo * sdMul"));
  assert.ok(LIT_NORMAL_GLSL.includes("dVertexNormalW - sdGrad") && LIT_NORMAL_WGSL.includes("dVertexNormalW - sdGrad"));
});
