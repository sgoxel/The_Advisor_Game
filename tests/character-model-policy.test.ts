import { test } from "node:test";
import { mountNpcPortrait } from "../src/npc-portrait.ts";
import assert from "node:assert/strict";
import { characterModelManifest, characterModelFile, characterVisualFormat, characterMeshHasGeometry, characterDrawableMeshes, loadSharedCharacterArtwork, usableOwnerModel } from "../src/character-model-policy.ts";

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

test("WP #693 render components with zero drawable primitives must keep 2D fallback", () => {
  assert.equal(characterMeshHasGeometry([]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [] } }]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: 0 }] } }]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: NaN }] } }]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: Infinity }] } }]), false);
  assert.equal(characterMeshHasGeometry([{}, { mesh: null }]), false);
  assert.equal(characterVisualFormat(characterMeshHasGeometry([{ mesh: { primitive: [{ count: 0 }] } }])), "2d-cutout");
  assert.equal(characterMeshHasGeometry([
    { mesh: { primitive: [{ count: 0 }] } },
    { mesh: { primitive: [{ count: 6 }] } },
  ]), true, "valid drawable meshes remain eligible for optional 3D");
});

test("WP #693 hidden GLB nodes/components/meshes cannot suppress 2D residents", () => {
  const drawable = { visible: true, mesh: { primitive: [{ count: 6 }] } };
  const hidden = { visible: false, mesh: { primitive: [{ count: 6 }] } };
  const empty = { visible: true, mesh: { primitive: [{ count: 0 }] } };
  const component = (enabled: boolean, entityEnabled: boolean, meshInstances: typeof drawable[]) =>
    ({ enabled, entity: { enabled: entityEnabled }, meshInstances });

  assert.deepEqual(characterDrawableMeshes([
    component(false, true, [drawable]),
    component(true, false, [drawable]),
    component(true, true, [hidden]),
    component(true, true, [empty]),
  ]), [], "a loaded but fully hidden or empty owner GLB must leave 2D visible");

  assert.deepEqual(characterDrawableMeshes([
    component(false, true, [drawable]),
    component(true, true, [hidden, drawable, empty]),
  ]), [drawable], "only a genuinely visible mesh can activate a supplied 3D model");
});

test("WP #693 fully transparent owner GLB geometry cannot hide its 2D resident", () => {
  const geometry = { primitive: [{ count: 6 }] };
  const invisible = { visible: true, mesh: geometry, material: { opacity: 0, transparent: true } };
  const nonfinite = { visible: true, mesh: geometry, material: { opacity: NaN, transparent: true } };
  const drawable = { visible: true, mesh: geometry, material: { opacity: 1, transparent: false } };
  const translucent = { visible: true, mesh: geometry, material: { opacity: 0.5, transparent: true } };
  const masked = { visible: true, mesh: geometry, material: { opacity: 0, transparent: false, alphaTest: 0.5 } };
  const opaqueAlpha = { visible: true, mesh: geometry, material: { opacity: 0, transparent: false } };
  const component = (meshInstances: Array<typeof invisible | typeof masked>) =>
    ({ enabled: true, entity: { enabled: true }, meshInstances });
  assert.deepEqual(characterDrawableMeshes([component([invisible, nonfinite, masked])]), [],
    "zero-opacity blended/masked mesh primitives leave original WebP visible");
  assert.deepEqual(characterDrawableMeshes([component([invisible, drawable, translucent, opaqueAlpha])]),
    [drawable, translucent, opaqueAlpha],
    "valid opaque, visible and semi-transparent GLB parts remain eligible without replacing 2D with invisible art");
});

test("WP #693 missing specialist art shares default material and its correct sprite aspect", async () => {
  const cache = new Map<string, Promise<{ name: string; value: string }>>();
  const calls: Record<string, number> = Object.create(null);
  const load = async (name: string): Promise<string> => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (name === "guard_male") throw Error("missing specialist WebP");
    return "material:" + name;
  };
  const first = loadSharedCharacterArtwork("guard_male", cache, load);
  assert.strictEqual(first, loadSharedCharacterArtwork("guard_male", cache, load),
    "simultaneous resident loads share one request");
  const [illustration, repeated] = await Promise.all([first, loadSharedCharacterArtwork("guard_male", cache, load)]);
  assert.deepEqual(illustration, { name: "default", value: "material:default" });
  assert.strictEqual(illustration, repeated);
  assert.strictEqual(await loadSharedCharacterArtwork("guard_male", cache, load), illustration,
    "a previously missing specialist keeps shared 2D art instead of retrying every actor");
  assert.deepEqual({ ...calls }, { guard_male: 1, default: 1 });
  assert.deepEqual(await loadSharedCharacterArtwork("baker_female", cache, load),
    { name: "baker_female", value: "material:baker_female" },
    "existing matching 2D art remains unchanged");
  assert.equal(calls.baker_female, 1);
  assert.equal(calls.default, 1);
});

test("WP #693 unavailable default art fails honestly and may retry after recovery", async () => {
  const cache = new Map<string, Promise<{ name: string; value: string }>>();
  let requests = 0;
  const load = async () => {
    if (++requests === 1) throw Error("temporary default art failure");
    return "restored default material";
  };
  await assert.rejects(loadSharedCharacterArtwork("default", cache, load), /temporary/);
  assert.deepEqual(await loadSharedCharacterArtwork("default", cache, load),
    { name: "default", value: "restored default material" });
  assert.equal(requests, 2);
});

test("WP #693 transient default outage does not poison a specialist's fallback after recovery", async () => {
  const cache = new Map<string, Promise<{ name: string; value: string }>>();
  let defaultOnline = false;
  const calls: Record<string, number> = Object.create(null);
  const load = async (name: string): Promise<string> => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (name !== "default") throw Error("specialist not deployed");
    if (!defaultOnline) throw Error("default temporarily unavailable");
    return "recovered default illustration";
  };
  const first = loadSharedCharacterArtwork("guard_male", cache, load);
  await assert.rejects(first, /temporarily unavailable/);
  assert.equal(cache.has("guard_male"), false, "rejected specialist fallback must be retryable");
  assert.equal(cache.has("default"), false, "rejected default must be retryable");
  defaultOnline = true;
  assert.deepEqual(await loadSharedCharacterArtwork("guard_male", cache, load),
    { name: "default", value: "recovered default illustration" });
  assert.deepEqual({ ...calls }, { guard_male: 2, default: 2 });
  assert.strictEqual(await loadSharedCharacterArtwork("guard_male", cache, load),
    await loadSharedCharacterArtwork("default", cache, load),
    "recovery uses the shared original 2D material without new downloads");
});

test("WP #693 popup keeps a real 2D portrait after specialist image failure", () => {
  type ImageStub = {
    src: string;
    alt: string;
    dataset: Record<string, string>;
    className: string;
    width: number;
    height: number;
    decoding: string;
    loading: string;
    onerror: (() => void) | null;
  };
  const images: ImageStub[] = [];
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      baseURI: "https://example.test/The_Advisor_Game/",
      createElement(tag: string) {
        assert.equal(tag, "img");
        const picture: ImageStub = {
          src: "", alt: "", dataset: {}, className: "",
          width: 0, height: 0, decoding: "", loading: "", onerror: null,
        };
        images.push(picture);
        return picture;
      },
    },
  });
  try {
    let mounted: unknown;
    const slot = { replaceChildren(image: unknown) { mounted = image; } } as HTMLElement;
    const root = "https://example.test/The_Advisor_Game/characters/";
    mountNpcPortrait(slot, "guard_male", "Marek", "wp693-missing-portrait");
    const picture = images[0]!;
    assert.strictEqual(mounted, picture);
    assert.equal(picture.src, root + "guard_male.webp");
    picture.onerror?.();
    assert.equal(picture.src, root + "default.webp", "failed specialist uses original default art");
    assert.equal(picture.dataset.character, "default");
    mountNpcPortrait(slot, "guard_male", "Marek", "wp693-missing-portrait");
    assert.equal(picture.src, root + "default.webp", "popup refresh never reloads broken specialist");
    mountNpcPortrait(slot, "baker_female", "Mira", "wp693-missing-portrait");
    assert.equal(picture.src, root + "baker_female.webp", "recycled portrait remains person-specific");
    assert.equal(picture.alt, "Illustration of Mira");
    mountNpcPortrait(slot, "guard_male", "Marek", "wp693-missing-portrait");
    assert.equal(picture.src, root + "default.webp", "missing artist fallback remains stable");
    assert.equal(images.length, 1, "same channel reuses its existing image and DOM surface");
    picture.onerror?.();
    assert.equal(picture.src, root + "default.webp", "default errors cannot recurse");
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
