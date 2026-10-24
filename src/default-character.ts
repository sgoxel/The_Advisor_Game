import * as pc from "playcanvas";
import { npcModels } from './npc-models.ts';

export const DEFAULT_CHARACTER_HEIGHT_M = 1.782;
export const DEFAULT_CHARACTER_URL = new URL("models/default-character.glb", document.baseURI).href;

const vertexGLSL = `
#include "transformCoreVS"
#include "normalCoreVS"
attribute vec4 vertex_color;
varying vec3 vNormal;
varying vec4 vColor;
void main(void) {
    mat4 model = getModelMatrix();
    vNormal = normalize(getNormalMatrix(model) * getLocalNormal(vertex_normal));
    vColor = vertex_color;
    gl_Position = matrix_viewProjection * model * vec4(getLocalPosition(vertex_position.xyz), 1.0);
}`;
const vertexWGSL = `
#include "transformCoreVS"
#include "normalCoreVS"
attribute vertex_color: vec4f;
varying vNormal: vec3f;
varying vColor: vec4f;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let model = getModelMatrix();
    output.vNormal = normalize(getNormalMatrix(model) * getLocalNormal(vertex_normal));
    output.vColor = vertex_color;
    output.position = uniform.matrix_viewProjection * model * vec4f(getLocalPosition(vertex_position.xyz), 1.0);
    return output;
}`;
const fragmentGLSL = `
#ifdef SHADOW_PASS
    #include "shadowCasterPS"
#else
    #include "gammaPS"
    uniform vec3 uLightDir;
    uniform vec3 uDayTint;
    uniform vec3 uClothTint;
    varying vec3 vNormal;
    varying vec4 vColor;
#endif
void main(void) {
    #ifdef SHADOW_PASS
        gl_FragColor = getShadowOutput();
    #else
        float light = dot(normalize(vNormal), normalize(uLightDir));
        float band = light > 0.55 ? 1.0 : (light > -0.05 ? 0.70 : 0.40);
        vec3 cloth = vColor.g > vColor.r + 0.005 ? uClothTint : vec3(1.0);
        vec3 shadow = mix(vec3(0.78, 0.84, 1.0), vec3(1.0), band);
        gl_FragColor = vec4(gammaCorrectOutput(vColor.rgb * cloth * shadow * band * uDayTint), 1.0);
    #endif
}`;
const fragmentWGSL = `
#ifdef SHADOW_PASS
    #include "shadowCasterPS"
#else
    #include "gammaPS"
    uniform uLightDir: vec3f;
    uniform uDayTint: vec3f;
    uniform uClothTint: vec3f;
    varying vNormal: vec3f;
    varying vColor: vec4f;
#endif
@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    #ifdef SHADOW_PASS
        output.color = getShadowOutput();
    #else
        let light = dot(normalize(vNormal), normalize(uniform.uLightDir));
        let band = select(select(0.40, 0.70, light > -0.05), 1.0, light > 0.55);
        let cloth = select(vec3f(1.0), uniform.uClothTint, vColor.g > vColor.r + 0.005);
        let shadow = mix(vec3f(0.78, 0.84, 1.0), vec3f(1.0), band);
        output.color = vec4f(gammaCorrectOutput(vColor.rgb * cloth * shadow * band * uniform.uDayTint), 1.0);
    #endif
    return output;
}`;

const PALETTES = [new Float32Array([1, 1, 1]), new Float32Array([.70, .85, 1.35]),
  new Float32Array([1.20, .80, .70]), new Float32Array([.95, .95, .60])];

/** Shared GPU geometry and shader; each resident owns its skeleton and animation. */
export async function loadDefaultCharacter(app: pc.AppBase) {
  const asset = await new Promise<pc.Asset>((resolve, reject) => {
    app.assets.loadFromUrl(DEFAULT_CHARACTER_URL, "container", (error, asset) => {
      if (error || !asset) reject(new Error(`Default 3D character could not load: ${error}`));
      else resolve(asset);
    });
  });
  const container = asset.resource as pc.ContainerResource;
  const clips = new Map(container.animations.map(asset => {
    const track = asset.resource as pc.AnimTrack;
    return [track.name, track] as const;
  }));
  if (!clips.has("Idle") || !clips.has("Walk")) throw new Error("Default character requires Idle and Walk clips");
  const material = new pc.ShaderMaterial({ uniqueName: "AdvisorCharacterCel", vertexGLSL, fragmentGLSL, vertexWGSL, fragmentWGSL,
    attributes: { vertex_position: pc.SEMANTIC_POSITION, vertex_normal: pc.SEMANTIC_NORMAL, vertex_color: pc.SEMANTIC_COLOR } });
  material.name = "Default character · three-band cel";
  material.cull = pc.CULLFACE_BACK;
  material.setParameter("uLightDir", new Float32Array([.4, .8, .5]));
  material.setParameter("uDayTint", new Float32Array([1, 1, 1]));
  material.setParameter("uClothTint", PALETTES[0]);
  const models = new WeakMap<pc.Entity, pc.Entity>();
  const walking = new WeakMap<pc.Entity, boolean>();
  const lightDirection = new Float32Array(3), dayTint = new Float32Array(3);
  const requested = new WeakMap<pc.Entity, string>();
  const assigned = new WeakMap<pc.Entity, string>();
  const loaded = new Map<string, Promise<pc.ContainerResource>>();
  function install(actor: pc.Entity, resource: pc.ContainerResource, generated: boolean) {
    models.get(actor)?.destroy();
    const model = resource.instantiateRenderEntity();
    actor.addChild(model);
    for (const render of model.findComponents('render') as pc.RenderComponent[]) {
      render.castShadows = !render.entity.name.includes('Ink Outline');
      render.receiveShadows = generated;
      if (!generated) for (const mesh of render.meshInstances) mesh.material = material;
    }
    const animations = new Map(resource.animations.map(asset => {
      const track = asset.resource as pc.AnimTrack;
      return [track.name, track] as const;
    }));
    model.addComponent('anim', { activate: true });
    model.anim!.loadStateGraph(new pc.AnimStateGraph({ layers: [{ name: 'Base', states: [
      { name: 'START' }, { name: 'Idle', speed: 1, loop: true, defaultState: true }, { name: 'Walk', speed: 1, loop: true },
    ], transitions: [{ from: 'START', to: 'Idle' }] }], parameters: {} }));
    model.anim!.assignAnimation('Idle', animations.get('Idle')!);
    model.anim!.assignAnimation('Walk', animations.get('Walk')!);
    models.set(actor, model);
    walking.delete(actor);
  }
  return {
    url: DEFAULT_CHARACTER_URL,
    clips: [...clips.keys()],
    create() {
      const actor = new pc.Entity("Resident 3D character");
      install(actor, container, false);
      return actor;
    },
    async character(actor: pc.Entity, key: string) {
      requested.set(actor, key);
      const entry = (await npcModels()).characters[key];
      const identity = entry?.url ?? 'default';
      if (requested.get(actor) !== key || assigned.get(actor) === identity) return;
      if (!entry) {
        if (assigned.has(actor)) install(actor, container, false);
        assigned.set(actor, identity);
        actor.tags.remove('generated-npc');
        return;
      }
      let loading = loaded.get(entry.url);
      if (!loading) {
        loading = new Promise<pc.ContainerResource>((resolve, reject) => {
          app.assets.loadFromUrl(new URL(entry.url, document.baseURI).href, 'container', (error, asset) => {
            if (error || !asset) reject(new Error(String(error)));
            else resolve(asset.resource as pc.ContainerResource);
          });
        });
        loaded.set(entry.url, loading);
      }
      try {
        const resource = await loading;
        if (requested.get(actor) !== key || assigned.get(actor) === identity) return;
        install(actor, resource, true);
        assigned.set(actor, identity);
        actor.tags.add('generated-npc');
      } catch (error) { loaded.delete(entry.url); console.warn('NPC model could not load', key, error); }
    },
    palette(actor: pc.Entity, seed: number) {
      if (actor.tags.has('generated-npc')) return;
      for (const render of models.get(actor)!.findComponents("render") as pc.RenderComponent[])
        for (const mesh of render.meshInstances) mesh.setParameter("uClothTint", PALETTES[Math.abs(seed) % PALETTES.length]);
    },
    move(actor: pc.Entity, speedMps: number, dx: number, dz: number) {
      const model = models.get(actor)!;
      const moving = speedMps > .035;
      if (walking.get(actor) !== moving) {
        model.anim!.baseLayer!.transition(moving ? "Walk" : "Idle", .15);
        walking.set(actor, moving);
      }
      model.anim!.speed = moving ? Math.min(1.6, Math.max(.3, speedMps)) : 1;
      if (moving) actor.setLocalEulerAngles(0, Math.atan2(dx, dz) * 180 / Math.PI, 0);
    },
    setLighting(direction: pc.Vec3, tint: readonly number[]) {
      lightDirection[0] = direction.x; lightDirection[1] = direction.y; lightDirection[2] = direction.z;
      dayTint.set(tint);
      material.setParameter("uLightDir", lightDirection);
      material.setParameter("uDayTint", dayTint);
    },
  };
}
