import { test } from "node:test";
import { mountNpcPortrait } from "../src/npc-portrait.ts";
import assert from "node:assert/strict";
import { characterModelManifest, characterModelFile, characterVisualFormat, characterMeshHasGeometry, characterDrawableMeshes, characterModelRenderable, characterModelFootPlacement, sameCharacterAssignment, characterModelVisibleOrInvalidate, loadSharedCharacterArtwork, loadSharedOwnerModel, usableOwnerModel } from "../src/character-model-policy.ts";

test("WP #693 pooled actor assignment tracks actual SEED resident, not just portrait type", () => {
  const first = { name: "guard_male", residentCode: "seed-guard-1" };
  assert.equal(sameCharacterAssignment(undefined, first.name, first.residentCode), false);
  assert.equal(sameCharacterAssignment(first, "guard_male", "seed-guard-1"), true,
    "same resident across consecutive refreshes reuses visual state and shared assets");
  assert.equal(sameCharacterAssignment(first, "guard_male", "seed-guard-2"), false,
    "different resident with same artwork must reset stale optional model/heading");
  assert.equal(sameCharacterAssignment(first, "farmer_male", "seed-guard-1"), false,
    "a different authored appearance also resets visual work");
});

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

test("WP #693 failed owner GLB is not permanently cached after network recovery", async () => {
  const cache = new Map<string, Promise<{ file: string } | null>>();
  let online = false;
  const calls: Record<string, number> = Object.create(null);
  const load = async (file: string) => {
    calls[file] = (calls[file] ?? 0) + 1;
    return online ? { file } : null;
  };
  const original = loadSharedOwnerModel("guard_male.glb", cache, load);
  assert.strictEqual(original, loadSharedOwnerModel("guard_male.glb", cache, load),
    "multiple residents share the same in-flight optional GLB request");
  assert.equal(await original, null, "offline owner model leaves 2D fallback intact");
  assert.equal(cache.has("guard_male.glb"), false,
    "a failed model must not become a permanent negative cache entry");
  online = true;
  const recovered = await loadSharedOwnerModel("guard_male.glb", cache, load);
  assert.deepEqual(recovered, { file: "guard_male.glb" },
    "a later resident can adopt the real model after connectivity returns");
  assert.deepEqual({ ...calls }, { "guard_male.glb": 2 });
  assert.strictEqual(await loadSharedOwnerModel("guard_male.glb", cache, load), recovered,
    "successfully loaded GLB stays shared without repeated downloads");
  assert.equal(calls["guard_male.glb"], 2);
});

test("WP #693 rejected owner GLB promises also allow later independent recovery", async () => {
  const cache = new Map<string, Promise<string | null>>();
  let calls = 0;
  const load = async () => {
    if (++calls === 1) throw new Error("offline model download");
    return "restored shared owner GLB";
  };
  const first = loadSharedOwnerModel("farmer_male.glb", cache, load);
  await assert.rejects(first, /offline/);
  assert.equal(cache.has("farmer_male.glb"), false);
  assert.equal(await loadSharedOwnerModel("farmer_male.glb", cache, load),
    "restored shared owner GLB");
  assert.equal(calls, 2);
});

test("WP #693 parent-only foot alignment preserves imported GLB root transforms", () => {
  const part = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
    ({ aabb: { center: { x, y, z }, halfExtents: { x: hx, y: hy, z: hz } } });
  // Staged AABBs already account for authored root scale and translation:
  // an 0.8m baked height is normalized by the NEW parent, not by replacing
  // the imported GLB's own scale a second time.
  const placement = characterModelFootPlacement([part(3, 5, -2, .2, .4, .1)], 1.782);
  assert.ok(placement);
  assert.ok(Math.abs(placement.scale - 1.782 / .8) < 1e-12);
  assert.ok(Math.abs(placement.x + 3 * placement.scale) < 1e-12);
  assert.ok(Math.abs(placement.y + 4.6 * placement.scale) < 1e-12);
  assert.ok(Math.abs(placement.z - 2 * placement.scale) < 1e-12);
  assert.ok(Math.abs(.8 * placement.scale - 1.782) < 1e-12,
    "rendered height remains nominal with a nonunit authored source root");
  assert.equal(characterModelFootPlacement([], 1.782), null);
  assert.equal(characterModelFootPlacement([part(0, 0, 0, 1, 0, 1)], 1.782), null);
  assert.equal(characterModelFootPlacement([part(0, 0, 0, 0, 1, 0)], 1.782), null,
    "a zero-footprint vertical line has no visible GLB face and must retain original 2D art");
  assert.ok(characterModelFootPlacement([part(0, 0, 0, 1, 1, 0)], 1.782),
    "a genuinely visible planar GLB silhouette must not be rejected for having zero depth");
  assert.equal(characterModelFootPlacement([part(0, 0, 0, 1, NaN, 1)], 1.782), null);
  assert.equal(characterModelFootPlacement([part(0, 0, 0, 1, 1, 1)], Infinity), null);
});

test("WP #693 render components with zero drawable primitives must keep 2D fallback", () => {
  assert.equal(characterMeshHasGeometry([]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [] } }]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: 0 }] } }]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: 1 }] } }]), false,
    "one vertex cannot make a visible triangle and must keep the 2D cutout");
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: 2 }] } }]), false,
    "a two-vertex primitive is not drawable triangular character geometry");
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: 3 }] } }]), true,
    "the smallest valid triangular face remains eligible for real 3D");
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: NaN }] } }]), false);
  assert.equal(characterMeshHasGeometry([{ mesh: { primitive: [{ count: Infinity }] } }]), false);
  assert.equal(characterMeshHasGeometry([{}, { mesh: null }]), false);
  assert.equal(characterVisualFormat(characterMeshHasGeometry([{ mesh: { primitive: [{ count: 0 }] } }])), "2d-cutout");
  assert.equal(characterMeshHasGeometry([
    { mesh: { primitive: [{ count: 0 }] } },
    { mesh: { primitive: [{ count: 6 }] } },
  ]), true, "valid drawable meshes remain eligible for optional 3D");
});

test("WP #693 point/line-only owner GLBs cannot suppress original 2D residents", () => {
  // Actual PlayCanvas 2.23 topologies: points 0; lines 1/2/3; filled 4/5/6.
  const primitive = (type: number, count: number) =>
    ({ mesh: { primitive: [{ type, count }] }, visible: true });
  for (const type of [0, 1, 2, 3]) {
    assert.equal(characterMeshHasGeometry([primitive(type, 60)]), false,
      "many non-triangle vertices are not a rendered character surface");
    const actor = { enabled: true };
    assert.equal(characterDrawableMeshes([{
      enabled: true, entity: actor, meshInstances: [primitive(type, 60)],
    }]).length, 0, "line/point-only GLB is not eligible for replacing 2D or picking");
  }
  for (const type of [4, 5, 6])
    assert.equal(characterMeshHasGeometry([primitive(type, 3)]), true,
      "triangle, triangle strip and triangle fan have valid filled surfaces");
  assert.equal(characterMeshHasGeometry([primitive(7, 60)]), false,
    "unsupported primitive topology may not hide the original NPC art");
  assert.equal(characterMeshHasGeometry([{
    mesh: { primitive: [{ type: 1, count: 60 }, { type: 4, count: 3 }] },
  }]), true, "a GLB with real triangles alongside line decoration remains eligible");
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

test("WP #693 disabled ancestor of visible owner GLB cannot suppress 2D art", () => {
  const drawable = { visible: true, mesh: { primitive: [{ count: 6 }] } };
  // The component's own node can be enabled while an imported group above it
  // is disabled. GraphNode.enabled alone does not reflect that hierarchy.
  const hiddenGroup = { enabled: false, parent: null };
  const component = {
    enabled: true, entity: { enabled: true, parent: hiddenGroup }, meshInstances: [drawable],
  };
  assert.deepEqual(characterDrawableMeshes([component]), [],
    "a locally enabled render node inside a disabled group is not drawable");
  hiddenGroup.enabled = true;
  assert.deepEqual(characterDrawableMeshes([component]), [drawable],
    "reactivating the authored group restores real 3D eligibility");
  const disabledScene = { enabled: false, parent: null };
  const root = { enabled: true, parent: disabledScene };
  assert.equal(characterModelRenderable(root, [component]), false,
    "a disabled ancestor of the attached model also requires 2D fallback");
  disabledScene.enabled = true;
  assert.equal(characterModelRenderable(root, [component]), true);
  const actor = {};
  const assigned = new WeakMap<object, { name: string; residentCode: string }>();
  assigned.set(actor, { name: "guard_male", residentCode: "resident-1" });
  hiddenGroup.enabled = false;
  assert.equal(characterModelVisibleOrInvalidate(actor, root, [component], assigned), false);
  assert.equal(assigned.has(actor), false,
    "a hidden group invalidates only the visual assignment so recovery can retry");
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

test("WP #693 imported PlayCanvas blended opacity zero retains 2D cutout", () => {
  // PlayCanvas 2.23 material rendering uses BLEND_NONE=3, BLEND_NORMAL=2.
  // Imported StandardMaterial does not expose the legacy transparent flag.
  const BLEND_NONE = 3, BLEND_NORMAL = 2;
  const mesh = { primitive: [{ count: 6 }] };
  const component = (opacity: number, blendType: number) => ({
    enabled: true, entity: { enabled: true },
    meshInstances: [{ visible: true, mesh, material: { opacity, blendType } }],
  });
  assert.equal(characterDrawableMeshes([component(0, BLEND_NORMAL)], BLEND_NONE).length, 0,
    "a real blended GLB with opacity zero may not displace illustrated resident");
  assert.equal(characterDrawableMeshes([component(NaN, BLEND_NORMAL)], BLEND_NONE).length, 0,
    "nonfinite transparent opacity remains fallback-only");
  assert.equal(characterDrawableMeshes([component(0.5, BLEND_NORMAL)], BLEND_NONE).length, 1,
    "visible translucent owner geometry may render");
  assert.equal(characterDrawableMeshes([component(0, BLEND_NONE)], BLEND_NONE).length, 1,
    "opaque GLB material ignores alpha as defined by the engine");
  const actor = {};
  const assignments = new WeakMap<object, { name: string; residentCode: string }>();
  assignments.set(actor, { name: "guard_male", residentCode: "seed-resident-01" });
  const rendered = component(1, BLEND_NORMAL);
  const root = { enabled: true };
  assert.equal(characterModelVisibleOrInvalidate(actor, root, [rendered], assignments, BLEND_NONE), true);
  rendered.meshInstances[0].material.opacity = 0;
  assert.equal(characterModelVisibleOrInvalidate(actor, root, [rendered], assignments, BLEND_NONE), false,
    "on a formerly visible model becoming blended invisible, restore 2D and allow retry");
  assert.equal(assignments.has(actor), false);
});

test("WP #693 canvas picking uses the same truly drawable 2D or 3D resident form", () => {
  const actor = { enabled: true };
  const cutoutNode = { enabled: true, parent: actor };
  const modelNode = { enabled: true, parent: actor };
  const mesh = { primitive: [{ count: 6 }] };
  const cutout = {
    enabled: true, entity: cutoutNode,
    meshInstances: [{ visible: true, mesh, material: { opacity: 1, blendType: 3 } }],
  };
  const owner = {
    enabled: true, entity: modelNode,
    meshInstances: [{ visible: true, mesh, material: { opacity: 0, blendType: 2 } }],
  };
  const drawable = () => characterDrawableMeshes([cutout, owner], 3).length;
  assert.equal(drawable(), 1, "blended invisible owner GLB cannot create a false click target");
  cutoutNode.enabled = false;
  assert.equal(drawable(), 0, "a missing visible 2D fallback cannot be reported as clickable");
  owner.meshInstances[0].material.opacity = 1;
  assert.equal(drawable(), 1, "the one genuinely rendered 3D form becomes pickable");
  actor.enabled = false;
  assert.equal(drawable(), 0, "disabled resident ancestor suppresses both rendered and picked forms");
});

test("WP #693 previously adopted owner model loss enables same-resident recovery", () => {
  const actor = {};
  const assigned = new WeakMap<object, { name: string; residentCode: string }>();
  const key = { name: "guard_male", residentCode: "seed-guard-1" };
  assigned.set(actor, key);
  const mesh = { visible: true, mesh: { primitive: [{ count: 6 }] },
    material: { opacity: 1, transparent: false } };
  const root = { enabled: true };
  const component = { enabled: true, entity: { enabled: true }, meshInstances: [mesh] };
  assert.equal(characterModelVisibleOrInvalidate(actor, root, [component], assigned), true);
  assert.equal(sameCharacterAssignment(assigned.get(actor), key.name, key.residentCode), true,
    "working 3D resident must not retrigger asset loads each frame");
  component.enabled = false;
  assert.equal(characterModelVisibleOrInvalidate(actor, root, [component], assigned), false,
    "lost model is replaced by the permanent 2D cutout");
  assert.equal(sameCharacterAssignment(assigned.get(actor), key.name, key.residentCode), false,
    "normal subsequent resident refresh can retry after renderer recovery");
  component.enabled = true;
  assigned.set(actor, key);
  mesh.material.opacity = 0;
  mesh.material.transparent = true;
  assert.equal(characterModelVisibleOrInvalidate(actor, root, [component], assigned), false,
    "model becoming fully transparent also restores 2D and permits later retry");
  assert.equal(assigned.has(actor), false);
});

test("WP #693 previously visible owner model reverting invisible keeps 2D eligible", () => {
  const root = { enabled: true };
  const material = { opacity: 1, transparent: false };
  const part = { visible: true, material, mesh: { primitive: [{ count: 6 }] } };
  const component = { enabled: true, entity: { enabled: true }, meshInstances: [part] };
  assert.equal(characterModelRenderable(root, [component]), true, "valid attached owner model is 3D");
  component.enabled = false;
  assert.equal(characterModelRenderable(root, [component]), false, "disabled component must restore 2D");
  component.enabled = true;
  part.visible = false;
  assert.equal(characterModelRenderable(root, [component]), false, "hidden mesh must restore 2D");
  part.visible = true;
  material.opacity = 0;
  material.transparent = true;
  assert.equal(characterModelRenderable(root, [component]), false, "newly transparent mesh restores 2D");
  material.opacity = 1;
  material.transparent = false;
  root.enabled = false;
  assert.equal(characterModelRenderable(root, [component]), false, "disabled model root restores 2D");
  root.enabled = true;
  assert.equal(characterModelRenderable(root, [component]), true, "valid drawable hierarchy remains eligible");
  assert.equal(characterModelRenderable(root, []), false, "missing render components cannot suppress 2D");
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
