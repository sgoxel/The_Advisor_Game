import * as pc from 'playcanvas';
import { loadDefaultCharacter } from './default-character.ts';

type Portrait = { canvas: HTMLCanvasElement; selected: string; initialization?: ReturnType<typeof initialize> };
const portraits = new Map<string, Portrait>();

async function initialize(canvas: HTMLCanvasElement) {
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: ['webgl2'], antialias: true, alpha: true });
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.AnimComponentSystem];
  options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler, pc.AnimClipHandler];
  const app = new pc.AppBase(canvas);
  app.init(options);
  app.autoRender = false;
  app.scene.ambientLight = new pc.Color(.65, .68, .64);
  const camera = new pc.Entity('Portrait camera');
  camera.addComponent('camera', { projection: pc.PROJECTION_ORTHOGRAPHIC, orthoHeight: .67,
    nearClip: .01, farClip: 20, clearColor: new pc.Color(.075, .13, .11, 0) });
  camera.setPosition(.9, 1.5, 3);
  camera.lookAt(0, 1.16, 0);
  app.root.addChild(camera);
  const light = new pc.Entity('Portrait studio light');
  light.addComponent('light', { type: 'directional', intensity: 1.4 });
  light.setEulerAngles(40, -25, 0);
  app.root.addChild(light);
  const factory = await loadDefaultCharacter(app);
  const actor = factory.create();
  app.root.addChild(actor);
  let inView = false;
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; }).observe(canvas);
  app.on('update', () => {
    const visible = canvas.isConnected && inView && !document.hidden;
    actor.enabled = visible;
    if (visible) { factory.move(actor, 0, 0, 1); app.renderNextFrame = true; }
  });
  app.start();
  return { factory, actor };
}

/** One reusable GPU canvas survives the popup's once-a-second HTML refresh. */
export function mountNpcPortrait(slot: HTMLElement, key: string, name: string, channel = 'popup') {
  let portrait = portraits.get(channel);
  if (!portrait) {
    const canvas = document.createElement('canvas');
    canvas.className = 'npc-picture npc-model-portrait';
    canvas.setAttribute('role', 'img');
    canvas.width = 224;
    canvas.height = 288;
    portrait = { canvas, selected: key };
    portraits.set(channel, portrait);
  }
  const view = portrait, canvas = view.canvas;
  view.selected = key;
  canvas.setAttribute('aria-label', `3D portrait of ${name}`);
  canvas.dataset.character = key;
  slot.append(canvas);
  view.initialization ??= initialize(canvas);
  void view.initialization.then(async ({ factory, actor }) => {
    if (view.selected !== key) return;
    await factory.character(actor, key);
    if (view.selected === key) canvas.dataset.generated = String(actor.tags.has('generated-npc'));
  }).catch(error => {
    slot.textContent = '3D portrait unavailable';
    console.warn('3D portrait could not initialize', error);
  });
}
