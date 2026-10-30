import * as pc from "playcanvas";
import { CHARACTER_TYPES } from "./characters.ts";
import {
  characterModelManifest, characterModelFile, characterVisualFormat, characterDrawableMeshes, characterModelRenderable, loadSharedCharacterArtwork, loadSharedOwnerModel, usableOwnerModel,
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
  const assigned = new WeakMap<pc.Entity, string>();
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
    async character(actor: pc.Entity, key: string) {
      const name = Object.hasOwn(CHARACTER_TYPES, key) ? key : "default";
      requested.set(actor, name);
      if (assigned.get(actor) === name) return;
      assigned.set(actor, name);
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
      try {
        model = resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
        // PlayCanvas reports .enabled=false for every detached GraphNode,
        // even when its authored enabled flag is true. Probe the model under
        // the live scene root before evaluating its render components.
        // This synchronous phase never hides the resident's original artwork.
        app.root.addChild(model);
        // A GLB may contain hidden nodes, disabled render components or
        // invisible mesh instances alongside genuine geometry. Such authored
        // data must never suppress the visible 2D NPC illustration.
        if (!model.enabled) throw new Error("disabled model root");
        const components = model.findComponents("render") as pc.RenderComponent[];
        const pieces = characterDrawableMeshes(components);
        if (!pieces.length) throw new Error("no visible drawable model geometry");
        // Align the owner's model's actual feet and height to the same 1.782 m
        // nominal body used by the 2D quad; the actor parent still owns the
        // exact Simulation-derived physical scale and absolute world position.
        let minX = Infinity, minY = Infinity, minZ = Infinity,
          maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const part of pieces) {
          const box = part.aabb, c = box.center, h = box.halfExtents;
          minX = Math.min(minX, c.x - h.x); maxX = Math.max(maxX, c.x + h.x);
          minY = Math.min(minY, c.y - h.y); maxY = Math.max(maxY, c.y + h.y);
          minZ = Math.min(minZ, c.z - h.z); maxZ = Math.max(maxZ, c.z + h.z);
        }
        const height = maxY - minY;
        if (!Number.isFinite(height) || height <= 0 ||
            ![minX, minY, minZ, maxX, maxZ].every(Number.isFinite))
          throw new Error("invalid model bounds");
        const factor = DEFAULT_CHARACTER_HEIGHT_M / height;
        model.setLocalScale(factor, factor, factor);
        model.setLocalPosition(-(minX + maxX) * factor / 2, -minY * factor,
          -(minZ + maxZ) * factor / 2);
        if (!current()) { model.destroy(); return; }
        // Move the proven visible mesh to the same Simulation-owned actor.
        // Reparent preserves local GLB scale/foot alignment, not world truth.
        model.reparent(actor);
        activeModels.set(actor, model);
        modelComponents.set(actor, components);
        // Never turn off the 2D fallback until the 3D entity exists and has
        // real renderable geometry. Model failure only removes the optional art.
        cutout.enabled = false;
      } catch (error) {
        model?.destroy();
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
