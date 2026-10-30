import * as pc from "playcanvas";
import { CHARACTER_TYPES } from "./characters.ts";
import {
  characterModelManifest, characterModelFile, characterVisualFormat, characterDrawableMeshes, characterModelRenderable, characterModelFootPlacement, sameCharacterAssignment, loadSharedCharacterArtwork, loadSharedOwnerModel, usableOwnerModel,
  type CharacterVisualFormat, type CharacterModelManifest,
} from "./character-model-policy.ts";

/** Camera-facing authored cutouts in the real 3D world, not DOM proxy actors.
 * SEED/Simulation still own every identity, position, height and walking leg. */
export const DEFAULT_CHARACTER_HEIGHT_M = 1.782;
export const DEFAULT_CHARACTER_URL = new URL("characters/default.webp", document.baseURI).href;

export async function loadDefaultCharacter(app: pc.AppBase) {
  // One shared upright quad in metres, with its feet at the authoritative
  // resident ground anchor. World-space scale comes from main's SEED height.
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions([
    -DEFAULT_CHARACTER_HEIGHT_M * .4453 / 2, 0, 0,
     DEFAULT_CHARACTER_HEIGHT_M * .4453 / 2, 0, 0,
    -DEFAULT_CHARACTER_HEIGHT_M * .4453 / 2, DEFAULT_CHARACTER_HEIGHT_M, 0,
     DEFAULT_CHARACTER_HEIGHT_M * .4453 / 2, DEFAULT_CHARACTER_HEIGHT_M, 0,
  ]);
  mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  // WebP image origin is the upper-left in this texture handler; keep
  // illustrated heads above their Simulation-grounded feet.
  mesh.setUvs(0, [0, 1, 1, 1, 0, 0, 1, 0]);
  mesh.setIndices([0, 1, 2, 1, 3, 2]);
  mesh.update(pc.PRIMITIVE_TRIANGLES);

  const images = new Map<string, Promise<{ name: string; value: pc.StandardMaterial }>>();
  function artwork(key: string) {
    const name = Object.hasOwn(CHARACTER_TYPES, key) ? key : "default";
    return loadSharedCharacterArtwork(name, images, (requested) => {
      const url = new URL(`characters/${requested}.webp`, document.baseURI).href;
      return new Promise<pc.StandardMaterial>((resolve, reject) => {
        app.assets.loadFromUrl(url, "texture", (error, asset) => {
          if (error || !asset) {
            if (requested !== "default")
              console.warn("Resident illustration unavailable; using default cutout", requested, error);
            reject(new Error(`Resident artwork ${requested}: ${error}`));
            return;
          }
          const texture = asset.resource as pc.Texture;
          const material = new pc.StandardMaterial();
          material.name = `SEED character cutout · ${requested}`;
          material.diffuseMap = texture;
          material.opacityMap = texture;
          material.opacityMapChannel = "a";
          material.alphaTest = 0.08;
          material.useLighting = false;
          material.useFog = false;
          material.useSkybox = false;
          material.cull = pc.CULLFACE_NONE;
          material.update();
          resolve(material);
        });
      });
    });
  }
  // The owner may deploy GLBs later by uploading characters/models/*.glb
  // and adding matching illustration-type filenames to models.json. An empty,
  // absent or invalid manifest never starts a 3D request or delays 2D actors.
  const manifest: Promise<CharacterModelManifest> = fetch(
    new URL("characters/models.json", document.baseURI).href,
  ).then(response => response.ok ? response.json() : {})
    .then(characterModelManifest)
    .catch(() => characterModelManifest({}));
  const resources = new Map<string, Promise<pc.ContainerResource | null>>();
  function ownerModel(file: string): Promise<pc.ContainerResource | null> {
    return loadSharedOwnerModel(file, resources, requested => {
      const url = new URL(`characters/models/${requested}`, document.baseURI).href;
      return new Promise<pc.ContainerResource | null>(resolve => {
        app.assets.loadFromUrl(url, "container", (error, asset) => {
          if (error || !asset?.resource) {
            console.warn("Optional character model unavailable; keeping illustration", requested, error);
            resolve(null);
            return;
          }
          resolve(asset.resource);
        });
      });
    });
  }
  // Keep real 2D geometry available immediately in every shipped version.
  // Missing specialist images retain the existing authored default.
  const fallback = (await artwork("default")).value;
  const requested = new WeakMap<pc.Entity, string>();
  const assigned = new WeakMap<pc.Entity, { name: string; residentCode: string }>();
  const revisions = new WeakMap<pc.Entity, number>();
  const renders = new WeakMap<pc.Entity, pc.RenderComponent>();
  const shapes = new WeakMap<pc.Entity, pc.Entity>();
  const activeModels = new WeakMap<pc.Entity, pc.Entity>();
  const modelComponents = new WeakMap<pc.Entity, pc.RenderComponent[]>();
  const headings = new WeakMap<pc.Entity, number>();
  function hasVisibleModel(actor: pc.Entity): boolean {
    const model = activeModels.get(actor);
    if (!model) return false;
    if (characterModelRenderable(model, modelComponents.get(actor) ?? [])) return true;
    // A once-validated model can become disabled or have its components
    // hidden after a renderer/scene change. Never leave its resident invisible.
    activeModels.delete(actor);
    modelComponents.delete(actor);
    model.destroy();
    const cutout = shapes.get(actor);
    if (cutout) cutout.enabled = true;
    return false;
  }
  return {
    url: DEFAULT_CHARACTER_URL,
    clips: [] as string[],
    /** Truthful actor presentation, including mixtures of optional 3D and 2D. */
    format(actor: pc.Entity): CharacterVisualFormat {
      return characterVisualFormat(hasVisibleModel(actor));
    },
    create() {
      const actor = new pc.Entity("SEED resident visual");
      const cutout = new pc.Entity("Authored 2D illustration");
      cutout.addComponent("render", {
        meshInstances: [new pc.MeshInstance(mesh, fallback)],
        castShadows: false, receiveShadows: false,
      });
      actor.addChild(cutout);
      renders.set(actor, cutout.render!);
      shapes.set(actor, cutout);
      return actor;
    },
    async character(actor: pc.Entity, key: string, residentCode: string) {
      const name = Object.hasOwn(CHARACTER_TYPES, key) ? key : "default";
      requested.set(actor, name);
      // Pooled visual slots can move between distinct SEED residents sharing
      // one authored presentation type. Never retain the previous resident's
      // heading or a failed optional GLB decision for the next person.
      if (sameCharacterAssignment(assigned.get(actor), name, residentCode)) return;
      assigned.set(actor, { name, residentCode });
      headings.delete(actor);
      const revision = (revisions.get(actor) ?? 0) + 1;
      revisions.set(actor, revision);
      const current = () => requested.get(actor) === name && revisions.get(actor) === revision;
      // Recycled pooled residents immediately keep the original picture while
      // art/model assets change asynchronously. Old model roots are removed.
      activeModels.get(actor)?.destroy();
      activeModels.delete(actor);
      modelComponents.delete(actor);
      const cutout = shapes.get(actor)!;
      cutout.enabled = true;
      for (const instance of renders.get(actor)?.meshInstances ?? []) instance.material = fallback;
      cutout.setLocalScale(1, 1, 1);
      void artwork(name).then(({ name: artworkName, value: material }) => {
        if (!current()) return;
        for (const instance of renders.get(actor)?.meshInstances ?? []) instance.material = material;
        // A missing specialist image uses the shared default proportions too.
        cutout.setLocalScale(CHARACTER_TYPES[artworkName].aspect / .4453, 1, 1);
      }).catch(error => {
        if (current()) console.warn("Resident illustration unavailable", name, error);
      });
      const models = await manifest;
      if (!current()) return;
      const file = characterModelFile(name, models);
      if (!file) return;
      const resource = await usableOwnerModel(file, ownerModel);
      if (!current() || !resource) return;
      let model: pc.Entity | undefined;
      let anchor: pc.Entity | undefined;
      try {
        model = resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
        // The authored GLB root may already carry translation/rotation/scale.
        // Ground a separate parent so normalization does not erase that art.
        // PlayCanvas reports detached nodes disabled, so validate beneath the
        // enabled live root without hiding the permanent 2D illustration.
        anchor = new pc.Entity("Owner model foot alignment");
        app.root.addChild(anchor);
        anchor.addChild(model);
        // A GLB may contain hidden nodes, disabled render components or
        // invisible mesh instances alongside genuine geometry. Such authored
        // data must never suppress the visible 2D NPC illustration.
        if (!model.enabled) throw new Error("disabled model root");
        const components = model.findComponents("render") as pc.RenderComponent[];
        const pieces = characterDrawableMeshes(components);
        if (!pieces.length) throw new Error("no visible drawable model geometry");
        // The AABBs include the owner's authored GLB root transform. Normalize
        // only our neutral parent: replacing model.scale would multiply an
        // already-scaled bound by the wrong factor and break ground contact.
        const placement = characterModelFootPlacement(pieces, DEFAULT_CHARACTER_HEIGHT_M);
        if (!placement) throw new Error("invalid model bounds");
        anchor.setLocalScale(placement.scale, placement.scale, placement.scale);
        anchor.setLocalPosition(placement.x, placement.y, placement.z);
        if (!current()) { anchor.destroy(); return; }
        // Attach to the same Simulation actor; original GLB local transforms
        // and root-motion authority stay untouched (visual placement only).
        anchor.reparent(actor);
        activeModels.set(actor, anchor);
        modelComponents.set(actor, components);
        // Never turn off the 2D fallback until the 3D entity exists and has
        // real renderable geometry. Model failure only removes the optional art.
        cutout.enabled = false;
      } catch (error) {
        if (anchor) anchor.destroy();
        else model?.destroy();
        if (current()) console.warn("Invalid owner character model; keeping illustration", file, error);
      }
    },
    palette(_actor: pc.Entity, _variant: number) {
      // The authored illustrations already express the SEED-picked character.
    },
    move(actor: pc.Entity, speedMps: number, dx: number, dz: number) {
      // Motion direction rotates only the visual model; Simulation moves feet.
      if (speedMps > 0 && Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 0)
        headings.set(actor, Math.atan2(dx, dz) * 180 / Math.PI);
    },
    face(actor: pc.Entity, camera: pc.Entity) {
      // 2D sprites face the camera. Optional 3D models retain their movement
      // heading rather than changing NPC decisions with camera motion.
      if (hasVisibleModel(actor)) {
        actor.setEulerAngles(0, headings.get(actor) ?? 0, 0);
      } else {
        const p = actor.getPosition(), c = camera.getPosition();
        actor.setEulerAngles(0, Math.atan2(c.x - p.x, c.z - p.z) * 180 / Math.PI, 0);
      }
    },
    setLighting(_direction: pc.Vec3, _tint: readonly number[]) {
      // Unlit authored ink matches the inspector at day and night.
    },
  };
}
