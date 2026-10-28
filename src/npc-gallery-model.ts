import * as pc from 'playcanvas';
import { npcModels } from './npc-models.ts';
import { attachPack, animationProfile, type PackController } from '../public/animations/action-adventure/player.js';

/** Gallery-only model loading keeps the world's resident presentation independent. */
export async function loadGalleryCharacter(app: pc.AppBase) {
  const models = new WeakMap<pc.Entity, pc.Entity>();
  const heads = new WeakMap<pc.Entity, pc.GraphNode>();
  const players = new WeakMap<pc.Entity, PackController>();
  const requested = new WeakMap<pc.Entity, number>();
  const speeds = new WeakMap<pc.Entity, number>();
  const neutral = new WeakSet<pc.Entity>();
  const loaded = new Map<string, Promise<pc.ContainerResource>>();
  return {
    create() { return new pc.Entity('Reviewed 3D character'); },
    async character(actor: pc.Entity, key: string) {
      const ticket = (requested.get(actor) ?? 0) + 1;
      requested.set(actor, ticket);
      const entry = (await npcModels()).characters[key];
      if (!entry) throw new Error('No published 3D model for '+key);
      const url = new URL(entry.url, document.baseURI);
      if (entry.revision) url.searchParams.set('v', entry.revision);
      const identity = url.href;
      let loading = loaded.get(identity);
      if (!loading) {
        loading = new Promise<pc.ContainerResource>((resolve, reject) => {
          app.assets.loadFromUrl(identity, 'container', (error, asset) => {
            if (error || !asset) reject(new Error('3D model '+key+': '+error));
            else resolve(asset.resource as pc.ContainerResource);
          });
        });
        loaded.set(identity, loading);
      }
      let resource: pc.ContainerResource;
      try { resource = await loading; }
      catch (error) { loaded.delete(identity); throw error; }
      if (requested.get(actor) !== ticket) return;
      players.get(actor)?.destroy();
      players.delete(actor);
      models.get(actor)?.destroy();
      const model = resource.instantiateRenderEntity();
      model.setLocalScale(1.782 / entry.heightM, 1.782 / entry.heightM, 1.782 / entry.heightM);
      for (const render of model.findComponents('render') as pc.RenderComponent[]) {
        render.castShadows = true;
        render.receiveShadows = true;
      }
      actor.addChild(model);
      models.set(actor, model);
      const head = model.findByName('mixamorig:Head');
      if (head) heads.set(actor, head); else heads.delete(actor);
      actor.tags.add('generated-npc');
      actor.tags.remove('animation-ready');
      actor.tags.remove('animation-unavailable');
      // The neutral export shares downloaded clips; horizontal root travel stays in place.
      void attachPack(pc, app, model, { inPlace: true, profile:animationProfile({...entry,key}) }).then(async player => {
        if (!player) { actor.tags.add('animation-unavailable'); return; }
        if (models.get(actor) !== model) { player.destroy(); return; }
        players.set(actor, player);
        if (neutral.has(actor)) await player.reset();
        else await player.locomotion(speeds.get(actor) ?? 0);
        if (models.get(actor) === model) actor.tags.add('animation-ready');
      }).catch(error => { actor.tags.add('animation-unavailable'); console.warn('Character animation:', error); });
    },
    move(actor: pc.Entity, speedMps: number, _dx: number, _dz: number) {
      if (speeds.get(actor) === speedMps) return;
      speeds.set(actor, speedMps);
      if (neutral.has(actor)) return;
      void players.get(actor)?.locomotion(speedMps);
    },
    rest(actor: pc.Entity, value: boolean) {
      speeds.delete(actor);
      if (value) { neutral.add(actor); void players.get(actor)?.reset(); }
      else { neutral.delete(actor); players.get(actor)?.automatic(); }
    },
    animationState(actor: pc.Entity): string {
      const model = models.get(actor);
      return model?.anim?.enabled ? model.anim.baseLayer?.activeState ?? 'loading' : players.has(actor) ? 'tpose' : 'loading';
    },
    faceCenter(actor: pc.Entity): pc.Vec3 {
      const head = heads.get(actor);
      return head ? head.getPosition().clone().add(new pc.Vec3(0, .07, 0)) : new pc.Vec3(0, 1.586, 0);
    },
  };
}
