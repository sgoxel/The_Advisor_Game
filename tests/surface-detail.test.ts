import test from "node:test";
import assert from "node:assert/strict";
import { TERRAIN_PALETTE } from "../src/climate.ts";
import {
  LIT_DIFFUSE_GLSL, LIT_DIFFUSE_WGSL, LIT_GLOSS_GLSL, LIT_GLOSS_WGSL, LIT_NORMAL_GLSL, LIT_NORMAL_WGSL, LIT_SPECULAR_GLSL, LIT_SPECULAR_WGSL,
  TERRAIN_APPLY_SHADOW_GLSL, TERRAIN_APPLY_SHADOW_WGSL, SURFACE_KIND as K, litSurfaceKind, surfaceDetailChunks, terrainSurfaceKind,
} from "../src/surface-detail.ts";

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
  assert.equal(litSurfaceKind([30, 40, 46], wall), K.glass, "dark window glass shines");
  assert.equal(litSurfaceKind([52, 50, 48], wall), K.metal, "iron (barrel hoops, lamp posts)");
  // Dark grey flat roofs must not read as shiny metal (they glowed blue at night).
  assert.equal(litSurfaceKind([64, 64, 66], flat), K.roof, "dark grey flat roof is roof, not metal");
  assert.equal(litSurfaceKind([64, 64, 66], wall), K.metal, "the same grey on a wall is still metal");
  assert.equal(litSurfaceKind([70, 120, 150], flat), K.water, "fountain water");
  assert.equal(litSurfaceKind([74, 102, 153], wall), K.none, "blue laundry is cloth, not water");
});

test("terrain colours from the climate palette get their own ground patterns", () => {
  const flat = 1, P = TERRAIN_PALETTE;
  const expect: [keyof typeof P, number][] = [
    ["ocean", K.water], ["lake", K.water], ["sea-ice", K.snow], ["polar-ice", K.snow], ["snowy-mountain", K.snow],
    ["beach", K.sand], ["desert", K.dunes], ["dryland", K.cracked], ["bare-earth", K.dirt], ["cliff", K.rock], ["volcanic", K.rock],
    ["tundra", K.rock], ["conifer-forest", K.forestFloor], ["temperate-forest", K.forestFloor], ["dry-woodland", K.grass],
    ["grassland", K.grass], ["meadow", K.meadow], ["highland", K.grass],
  ];
  for (const [name, kind] of expect) assert.equal(terrainSurfaceKind(P[name], flat), kind, name);
  assert.equal(terrainSurfaceKind([95, 65, 40], flat), K.mud, "dark wet earth");
  // Rendered close-up colours measured in game (terrainTint): village lawn, desert, dry land, bare earth.
  assert.equal(terrainSurfaceKind([112, 121, 72], flat), K.grass, "village lawn");
  assert.equal(terrainSurfaceKind([166, 135, 88], flat), K.dunes, "desert");
  assert.equal(terrainSurfaceKind([154, 133, 83], flat), K.cracked, "dry land");
  assert.equal(terrainSurfaceKind([146, 120, 81], flat), K.dirt, "bare earth");
  assert.equal(terrainSurfaceKind([79, 118, 65], flat), K.forestFloor, "temperate forest");
  assert.equal(terrainSurfaceKind(P.grassland, .4), K.rock, "steep slopes are rock");
  assert.equal(terrainSurfaceKind(P.grassland, flat, true), K.road, "roads win");
});

test("WP #550 rock detail stays in continuous 3D metre space across tessellated cliffs", () => {
  const terrain = surfaceDetailChunks("terrain");
  for (const declaration of [terrain.glslDeclaration, terrain.wgslDeclaration]) {
    assert.ok(declaration.includes("sdNoise3(") && declaration.includes("sdRock3D("),
      "same 3D metre-noise rock functions exist on WebGL2 and WebGPU");
    assert.ok(declaration.includes("p.xy + offset * z"),
      "3D rock lattice is fixed to physical world position, not per-face orientation");
  }
  for (const code of [terrain.glslMainStart, terrain.wgslMainStart]) {
    assert.ok(code.includes("sdUv = sdP.xz;") && code.includes("sdPat = sdRock3D(sdP, sdFp)"),
      "only canonical rock samples continuous 3D; other terrain retains XZ UVs");
    assert.ok(!code.includes("mix(sdP.xz, sdWallUv"),
      "triangle-dependent UV interpolation must not split rock cells into shard seams");
  }
  const lit = surfaceDetailChunks("lit");
  for (const code of [lit.glslMainStart, lit.wgslMainStart])
    assert.ok(!code.includes("sdPat = sdRock3D"),
      "unchanged building, roof, prop and optional GLB materials keep their existing patterns");
});

test("both shader languages carry the same detail pipeline, and only materials that ask for it", () => {
  for (const mode of ["terrain", "lit"] as const) {
    const sd = surfaceDetailChunks(mode);
    for (const name of ["sdHash", "sdNoise", "sdCells", "sdGrass", "sdPattern", "sdKindLit", "sdKindTerrain", "sdBlocks"]) {
      assert.ok(sd.glslDeclaration.includes(`${name}(`) && sd.wgslDeclaration.includes(`fn ${name}(`), `${name} in GLSL and WGSL`);
    }
    for (let kind = 13; kind <= 20; kind++) {
      assert.ok(sd.glslDeclaration.includes(`kind < ${kind}.5`) && sd.wgslDeclaration.includes(`kind < ${kind}.5`), `pattern ${kind} in both languages`);
    }
    // Forward pass only (shadow/pick passes have no vertex colour); derivatives before any branch.
    for (const main of [sd.glslMainStart, sd.wgslMainStart]) {
      assert.ok(main.trimStart().startsWith("#ifdef FORWARD_PASS"));
      assert.ok(main.indexOf("sdFp < 0.45") > main.search(/d(Fdx|pdx)\(sdP\)/), "screen derivatives of position are taken before the branch");
      assert.equal(main.includes("sdKindTerrain("), mode === "terrain");
      assert.equal(main.includes("sdShade ="), mode === "terrain", "terrain shades its relief from the sun; lit materials bend the normal");
      if (mode === "terrain") {
        // Physical polygon normals must influence both WebGL2 and WebGPU
        // terrain emission, without adding a fake height or changing flat land.
        assert.ok(main.includes("dot(sdN, sdL) - sdL.y"), "broad relief responds to actual surface slope");
        assert.ok(main.includes("dot(sdNb, sdL) - dot(sdN, sdL)"), "micro detail remains additive");
      }
      assert.equal(main.includes("sdGlint ="), mode === "terrain", "terrain adds its own sun glints (water, mud, snow)");
      assert.ok(main.includes("sdGloss = mix(") && main.includes("sdSpec = mix("), "per-pixel shine");
    }
  }
  // WGSL reserves many words that are legal names in TypeScript/GLSL ("patch" once broke the WebGPU terrain).
  const reserved = /\b(?:let|var|const)\s+(patch|sample|filter|module|meta|handle|target|layout|input|output|active|demote|discard|enum|null|self|super|this|unless|where|yield|fallthrough|precision|resource|common|inline|interface|subroutine|smooth|flat|centroid)\b/;
  for (const mode of ["terrain", "lit"] as const) {
    const sd = surfaceDetailChunks(mode);
    for (const code of [sd.wgslDeclaration, sd.wgslMainStart]) assert.doesNotMatch(code, reserved, "no WGSL reserved word used as a name");
  }
  assert.ok(LIT_DIFFUSE_GLSL.includes("dAlbedo *= sdMul") && LIT_DIFFUSE_WGSL.includes("dAlbedo * sdMul"));
  assert.ok(LIT_NORMAL_GLSL.includes("dVertexNormalW - sdGrad") && LIT_NORMAL_WGSL.includes("dVertexNormalW - sdGrad"));
  assert.ok(LIT_GLOSS_GLSL.includes("sdGloss") && LIT_GLOSS_WGSL.includes("sdGloss"));
  assert.ok(LIT_SPECULAR_GLSL.includes("sdSpec") && LIT_SPECULAR_WGSL.includes("sdSpec"));
  assert.ok(TERRAIN_APPLY_SHADOW_GLSL.includes("LIT_SHADOW_CATCHER") && TERRAIN_APPLY_SHADOW_WGSL.includes("sdShadowStrength"));
});
