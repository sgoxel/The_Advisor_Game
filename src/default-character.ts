import * as pc from "playcanvas";
import { CHARACTER_TYPES } from "./characters.ts";

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
  mesh.setUvs(0, [0, 0, 1, 0, 0, 1, 1, 1]);
  mesh.setIndices([0, 1, 2, 1, 3, 2]);
  mesh.update(pc.PRIMITIVE_TRIANGLES);

  const images = new Map<string, Promise<pc.StandardMaterial>>();
  function artwork(key: string): Promise<pc.StandardMaterial> {
    const name = Object.hasOwn(CHARACTER_TYPES, key) ? key : "default";
    let loading = images.get(name);
    if (loading) return loading;
    const url = new URL(`characters/${name}.webp`, document.baseURI).href;
    loading = new Promise<pc.StandardMaterial>((resolve, reject) => {
      app.assets.loadFromUrl(url, "texture", (error, asset) => {
        if (error || !asset) { reject(new Error(`Resident artwork ${name}: ${error}`)); return; }
        const texture = asset.resource as pc.Texture;
        const material = new pc.StandardMaterial();
        material.name = `SEED character cutout · ${name}`;
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
    }).catch(error => {
      images.delete(name);
      throw error;
    });
    images.set(name, loading);
    return loading;
  }
  // Keep real geometry available immediately. A missing specialist image
  // retains the real authored default, never invents another resident.
  const fallback = await artwork("default");
  const requested = new WeakMap<pc.Entity, string>();
  const assigned = new WeakMap<pc.Entity, string>();
  const renders = new WeakMap<pc.Entity, pc.RenderComponent>();
  const shapes = new WeakMap<pc.Entity, pc.Entity>();
  return {
    url: DEFAULT_CHARACTER_URL,
    clips: [] as string[],
    create() {
      const actor = new pc.Entity("SEED resident illustrated cutout");
      const cutout = new pc.Entity("Authored illustration");
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
      try {
        const material = await artwork(name);
        if (requested.get(actor) !== name) return;
        for (const instance of renders.get(actor)?.meshInstances ?? []) instance.material = material;
        // Shape and colours always agree with the existing SEED popup image.
        const aspect = CHARACTER_TYPES[name].aspect;
        shapes.get(actor)?.setLocalScale(aspect / .4453, 1, 1);
        assigned.set(actor, name);
      } catch (error) {
        console.warn("Resident illustration unavailable", name, error);
      }
    },
    palette(_actor: pc.Entity, _variant: number) {
      // The authored illustrations already express the SEED-picked character.
    },
    move(_actor: pc.Entity, _speedMps: number, _dx: number, _dz: number) {
      // main's interpolation remains the only physical movement authority.
    },
    face(actor: pc.Entity, camera: pc.Entity) {
      // Upright (Y-axis only), camera-facing in the genuine 3D scene.
      const p = actor.getPosition(), c = camera.getPosition();
      actor.setEulerAngles(0, Math.atan2(c.x - p.x, c.z - p.z) * 180 / Math.PI, 0);
    },
    setLighting(_direction: pc.Vec3, _tint: readonly number[]) {
      // Unlit authored ink matches the inspector at day and night.
    },
  };
}
