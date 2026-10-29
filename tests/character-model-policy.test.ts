import { test } from "node:test";
import assert from "node:assert/strict";
import { characterModelManifest, characterModelFile, characterVisualFormat, usableOwnerModel } from "../src/character-model-policy.ts";

test("WP #693 no owner model leaves residents in 2D", () => {
  for (const source of [undefined, null, "", [], {}, 5]) {
    const models = characterModelManifest(source);
    assert.equal(characterModelFile("default", models), null);
    assert.equal(characterModelFile("guard_male", models), null);
    assert.equal(characterVisualFormat(false), "2d-cutout");
  }
});

test("WP #693 valid model can coexist with an unmatched resident's illustration", () => {
  const models = characterModelManifest({
    guard_male: "guard_male.glb",
    farmer_male: "farmer_2.glb",
    baker_female: "../invalid.glb",
    default: "https://invalid.example/model.glb",
    unknown: "unknown.glb",
    noblewoman_female: "noblewoman_female.gltf",
  });
  assert.equal(characterModelFile("guard_male", models), "guard_male.glb");
  assert.equal(characterModelFile("farmer_male", models), "farmer_2.glb");
  for (const name of ["baker_female", "default", "unknown", "noblewoman_female", "constructor"])
    assert.equal(characterModelFile(name, models), null, name);
  assert.equal(characterVisualFormat(true), "3d-model");
  assert.equal(characterVisualFormat(false), "2d-cutout");
  assert.equal(Object.getPrototypeOf(models), null);
});

test("WP #693 invalid entries cannot select a model or defeat existing artwork", () => {
  const models = characterModelManifest(JSON.parse('{"guard_male":"..%2fhidden.glb","constructor":"bad.glb","farmer_male":"farmer_male.glb"}'));
  assert.equal(characterModelFile("guard_male", models), null);
  assert.equal(characterModelFile("constructor", models), null);
  assert.equal(characterModelFile("farmer_male", models), "farmer_male.glb");
  assert.equal(characterVisualFormat(false), "2d-cutout");
});

test("WP #693 missing model, failed loader and invalid resource never remove 2D fallback", async () => {
  let called = 0;
  const load = async (file: string) => { called++; if (file === "broken.glb") throw Error("network fail"); return { file }; };
  assert.equal(await usableOwnerModel(null, load), null);
  assert.equal(called, 0, "empty manifest requests no 3D model");
  assert.equal(await usableOwnerModel("broken.glb", load), null, "rejected asset is optional");
  assert.equal(characterVisualFormat(false), "2d-cutout");
  assert.deepEqual(await usableOwnerModel("guard_male.glb", load), { file: "guard_male.glb" });
  assert.equal(characterVisualFormat(true), "3d-model");
});
