import * as pc from 'playcanvas';
import { loadDefaultCharacter } from './default-character.ts';
import { npcModels } from './npc-models.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#character')!;
const selector = document.querySelector<HTMLSelectElement>('#character-select')!;
const status = document.querySelector<HTMLElement>('#status')!;
const name = document.querySelector<HTMLElement>('#name')!;
const label = (key: string) => key.replaceAll('_', ' ').replace(/\b\w/g, value => value.toUpperCase());

async function start() {
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: ['webgl2'], antialias: true });
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.AnimComponentSystem];
  options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler, pc.AnimClipHandler];
  const app = new pc.AppBase(canvas);
  app.init(options);
  app.setCanvasFillMode(pc.FILLMODE_NONE);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  const resize = () => app.resizeCanvas(innerWidth, Math.max(200, innerHeight-(innerWidth<=600?250:0)));
  resize();
  app.scene.ambientLight = new pc.Color(.6, .65, .6);
  const camera = new pc.Entity('Character camera');
  camera.addComponent('camera', { fov: 32, nearClip: .01, farClip: 100, clearColor: new pc.Color(.086, .137, .118) });
  app.root.addChild(camera);
  const light = new pc.Entity('Studio light');
  light.addComponent('light', { type: 'directional', intensity: 1.3 });
  light.setEulerAngles(40, -30, 0);
  app.root.addChild(light);
  const factory = await loadDefaultCharacter(app);
  const actor = factory.create();
  app.root.addChild(actor);
  let moving = false, yaw = 18, pitch = 6, distance = 4.1;
  let selection = 0;
  async function choose(key: string) {
    const ticket = ++selection;
    status.textContent = 'Loading ' + label(key) + '…';
    await factory.character(actor, key);
    if (ticket !== selection) return;
    name.textContent = label(key);
    const entry = (await npcModels()).characters[key];
    canvas.dataset.character = key;
    canvas.dataset.generated = String(actor.tags.has('generated-npc'));
    status.textContent = entry ? `${entry.triangles.toLocaleString()} triangles · textured and animated` : 'Original animated 3D character';
    const url = new URL(location.href);
    url.searchParams.set('character', key);
    history.replaceState(null, '', url);
  }
  async function refresh() {
    const manifest = await npcModels();
    const keys = Object.keys(manifest.characters).sort();
    for (const key of keys) if (!Array.from(selector.options).some(option => option.value === key)) selector.add(new Option(label(key), key));
    if (!selector.options.length) selector.add(new Option('Original character', 'default'));
    if (!canvas.dataset.character) {
      const desired = new URL(location.href).searchParams.get('character');
      selector.value = desired && keys.includes(desired) ? desired : selector.options[0].value;
      await choose(selector.value);
    }
    selector.title = `${keys.length} of 39 generated character types available`;
  }
  selector.addEventListener('change', () => void choose(selector.value));
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-motion]'))) button.addEventListener('click', () => {
    moving = button.dataset.motion === 'walk';
    canvas.dataset.motion = moving ? 'walk' : 'idle';
  });
  let drag: [number, number] | undefined;
  canvas.addEventListener('pointerdown', event => { drag = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    yaw -= (event.clientX-drag[0])*.4;
    pitch = Math.max(-60, Math.min(65, pitch+(event.clientY-drag[1])*.3));
    drag = [event.clientX,event.clientY];
  });
  canvas.addEventListener('pointerup', () => { drag = undefined; });
  canvas.addEventListener('wheel', event => { event.preventDefault(); distance = Math.max(2, Math.min(7, distance+event.deltaY*.004)); }, { passive: false });
  app.on('update', () => {
    factory.move(actor, moving ? .8 : 0, 0, 1);
    const y=yaw*Math.PI/180, p=pitch*Math.PI/180;
    camera.setPosition(Math.sin(y)*Math.cos(p)*distance, .9+Math.sin(p)*distance, Math.cos(y)*Math.cos(p)*distance);
    camera.lookAt(0,.9,0);
  });
  window.addEventListener('resize', resize);
  app.start();
  await refresh();
  setInterval(() => void refresh(), 60_000);
}
void start().catch(error => { status.textContent = 'Character preview could not start: '+String(error); });
