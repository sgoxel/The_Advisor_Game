import * as pc from "playcanvas";
import "./style.css";
import {
  WORLD_SEED,
  WORLD_MIN,
  WORLD_SIZE,
  cellAt,
  cellSeed,
  heightAt,
  selectTiles,
  tileAt,
  type Tile,
  type View,
} from "./world.ts";
import {
  nearestPlace,
  continents,
  countries,
  cities,
  villages,
  roads,
} from "./geography.ts";
import type { Geometry, TileGeometry } from "./geometry.ts";
import { LazySimulation } from "./simulation.ts";
import { FantasyClock } from "./clock.ts";
import { createRenderer, rendererState } from "./renderer.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let canvas = $<HTMLCanvasElement>("world");
const view: View = {
  x: 0,
  z: 14,
  halfHeight: 97,
  aspect: innerWidth / innerHeight,
  yaw: -0.22,
  pixels: innerHeight,
};
let ready = false,
  selectedCode = "",
  activeKeys: string[] = [],
  wanted: Tile[] = [],
  errorText = "";
let app: pc.AppBase, camera: pc.Entity;
const tileCache = new Map<
  string,
  { tile: Tile; entity: pc.Entity; meshes: pc.Mesh[]; used: number }
>();
let revision = 0,
  inFlight = 0,
  residentLimit = 200,
  selectionDirty = true;
const pending = new Set<string>();
const uploads: { tile: Tile; data: TileGeometry }[] = [];
let worker: Worker;
const layers = { structures: true, nature: true, grid: false };
const pressed = new Set<string>();
const simulation = new LazySimulation();
const clock = new FantasyClock();

function fail(message: string) {
  errorText = message;
  $("loading").hidden = true;
  $("error").hidden = false;
  $("error").textContent = message;
}
function updateCamera() {
  const distance = view.halfHeight * 2.2 + 200;
  const targetY = Math.max(0, heightAt(view.x, view.z));
  camera.setPosition(
    view.x + Math.sin(view.yaw) * distance * 0.5,
    targetY + distance * Math.sin(Math.PI / 3),
    view.z + Math.cos(view.yaw) * distance * 0.5,
  );
  camera.lookAt(view.x, targetY, view.z);
  camera.camera!.orthoHeight = view.halfHeight;
  camera.camera!.farClip = 600000;
  selectionDirty = true;
}
function navigate(x: number, z: number, height = view.halfHeight) {
  view.x = Math.max(WORLD_MIN + 100, Math.min(-WORLD_MIN - 100, x));
  view.z = Math.max(WORLD_MIN + 100, Math.min(-WORLD_MIN - 100, z));
  view.halfHeight = Math.max(2, Math.min(150000, height));
  updateCamera();
}
function uploadGeometry(
  g: Geometry,
  parent: pc.Entity,
  name: string,
  material: pc.StandardMaterial,
): pc.Mesh | undefined {
  if (g.positions.length === 0) return;
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(g.positions);
  mesh.setNormals(g.normals);
  mesh.setColors32(g.colors);
  mesh.setIndices(g.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const entity = new pc.Entity(name);
  entity.addComponent("render", {
    meshInstances: [new pc.MeshInstance(mesh, material)],
    castShadows: name !== "terrain",
    receiveShadows: true,
  });
  parent.addChild(entity);
  entity.enabled =
    name === "terrain" ||
    (name === "structures"
      ? layers.structures
      : name === "nature"
        ? layers.nature
        : layers.structures && layers.nature);
  return mesh;
}
function setLayers() {
  for (const { entity } of tileCache.values())
    for (const child of entity.children as pc.Entity[]) {
      child.enabled =
        child.name === "terrain" ||
        (child.name === "structures"
          ? layers.structures
          : child.name === "nature"
            ? layers.nature
            : layers.structures && layers.nature);
    }
}
function request(tile: Tile) {
  if (tileCache.has(tile.key) || pending.has(tile.key)) return;
  pending.add(tile.key);
  inFlight++;
  worker.postMessage(tile);
}
function refreshSelection() {
  wanted = selectTiles(view);
  revision++;
  selectionDirty = false;
  const name =
    view.halfHeight < 70
      ? "Street"
      : view.halfHeight < 230
        ? "Village"
        : view.halfHeight < 900
          ? "Province"
          : "Realm";
  $("detail-name").textContent = name;
  const dotCount = { Street: 4, Village: 3, Province: 2, Realm: 1 }[name];
  document
    .querySelectorAll(".detail-dots i")
    .forEach((dot, i) => dot.classList.toggle("active", i < dotCount));
  const s = nearestPlace(view.x, view.z);
  $("place-name").textContent =
    s && Math.hypot(view.x - s.x, view.z - s.z) < 200
      ? s.name
      : "The wild marches";
  const metresPerPixel = (view.halfHeight * 2) / innerHeight;
  const maxPixels = innerWidth < 700 ? 65 : 110;
  const target = metresPerPixel * maxPixels;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const distance =
    [1, 2, 5, 10]
      .map((n) => n * magnitude)
      .filter((n) => n <= target)
      .at(-1) || magnitude;
  $("scale-line").style.width = `${distance / metresPerPixel}px`;
  $("scale-text").textContent =
    distance >= 1000 ? `${distance / 1000} km` : `${distance} m`;
}
function processStreaming(material: pc.StandardMaterial) {
  if (selectionDirty) refreshSelection();
  // At most one GPU mesh group per frame. Generation is isolated in a worker.
  const next = uploads.shift();
  if (next) {
    const entity = new pc.Entity(next.tile.key),
      meshes: pc.Mesh[] = [];
    for (const [name, g] of Object.entries(next.data)) {
      const mesh = uploadGeometry(g, entity, name, material);
      if (mesh) meshes.push(mesh);
    }
    entity.enabled = false;
    app.root.addChild(entity);
    tileCache.set(next.tile.key, {
      tile: next.tile,
      entity,
      meshes,
      used: revision,
    });
    pending.delete(next.tile.key);
  }
  const root = tileAt(0, 0, 0);
  if (!tileCache.has(root.key)) {
    if (inFlight + uploads.length < 3) request(root);
  } else {
    const complete = wanted.every((tile) => tileCache.has(tile.key));
    if (complete) {
      const newKeys = wanted.map((t) => t.key),
        active = new Set(newKeys);
      for (const [key, record] of tileCache) {
        record.entity.enabled = active.has(key);
        if (active.has(key)) record.used = revision;
      }
      activeKeys = newKeys;
      if (!ready) {
        ready = true;
        $("loading").classList.add("done");
      }
    } else {
      // Keep the previous coverage and coarse root until the replacement is complete.
      tileCache.get(root.key)!.entity.enabled = true;
      if (!ready && tileCache.size > 1) $("loading").classList.add("done");
      for (const tile of wanted) {
        if (inFlight + uploads.length >= 3) break;
        request(tile);
      }
    }
    if (tileCache.size > residentLimit) {
      const protect = new Set([
        ...activeKeys,
        ...wanted.map((t) => t.key),
        root.key,
      ]);
      const obsolete = [...tileCache.entries()]
        .filter(([key]) => !protect.has(key))
        .sort((a, b) => a[1].used - b[1].used);
      for (const [key, record] of obsolete) {
        if (tileCache.size <= residentLimit) break;
        // MeshInstance destruction releases its mesh reference and GPU buffers.
        record.entity.destroy();
        tileCache.delete(key);
      }
    }
  }
  $("tile-status").textContent =
    `${activeKeys.length || 1} tiles · ${pending.size ? "refining" : "ready"}`;
}
function inspectCell(screenX: number, screenY: number) {
  const origin = camera.camera!.screenToWorld(screenX, screenY, 0);
  const far = camera.camera!.screenToWorld(screenX, screenY, 600000);
  const direction = far.clone().sub(origin).normalize();
  let before = 0,
    hit = -1;
  // March to the first surface crossing, then solve the coordinate height field.
  const marchStep = Math.max(8, view.halfHeight / 40);
  for (let distance = 0; distance <= 600000; distance += marchStep) {
    const point = origin.clone().add(direction.clone().mulScalar(distance));
    if (point.y <= Math.max(0, heightAt(point.x, point.z))) {
      hit = distance;
      break;
    }
    before = distance;
  }
  if (hit < 0) return;
  for (let i = 0; i < 18; i++) {
    const middle = (before + hit) / 2,
      point = origin.clone().add(direction.clone().mulScalar(middle));
    if (point.y > Math.max(0, heightAt(point.x, point.z))) before = middle;
    else hit = middle;
  }
  const point = origin.add(direction.mulScalar(hit));
  try {
    const cell = cellAt(point.x, point.z),
      hierarchy = cellSeed(cell.x, cell.z);
    selectedCode = cell.code;
    $("cell-panel").hidden = false;
    $("cell-biome").textContent = cell.biome;
    $("cell-coordinates").textContent =
      `Cell ${cell.x}, ${cell.z} · ${hierarchy.parent.parent.parent.landform}`;
    $("cell-code").textContent = cell.code;
    $("cell-height").textContent = `${cell.elevation.toFixed(1)} m`;
    $("cell-tile").textContent = cell.tile;
    $("cell-walkable").textContent = cell.walkable ? "Yes" : "No";
    $("copy-status").textContent = "";
    const patch = hierarchy.parent,
      district = patch.parent,
      region = district.parent,
      province = region.parent;
    const levels = [
      ["Province · 2 km", province.code],
      ["Region · 200 m", region.code],
      ["District · 20 m", district.code],
      ["Patch · 4 m", patch.code],
      ["Cell · 2 m", hierarchy.code],
    ];
    $("seed-levels").replaceChildren(
      ...levels.map(([name, code]) => {
        const li = document.createElement("li");
        li.textContent = name;
        const text = document.createElement("code");
        text.textContent = code;
        li.append(text);
        return li;
      }),
    );
  } catch {
    /* A click past the finite realm boundary has no logical cell. */
  }
}
function setupControls() {
  const pointers = new Map<number, { x: number; y: number }>();
  let startX = 0,
    startY = 0,
    moved = false,
    lastPinch = 0;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      moved = true;
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x,
      dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch > 0 && distance > 0)
        navigate(view.x, view.z, (view.halfHeight * lastPinch) / distance);
      lastPinch = distance;
      moved = true;
      return;
    }
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 5)
      moved = true;
    if (!moved) return;
    const scale = (view.halfHeight * 2) / innerHeight,
      c = Math.cos(view.yaw),
      s = Math.sin(view.yaw);
    navigate(
      view.x - dx * scale * c - (dy * scale * s) / Math.sin(Math.PI / 3),
      view.z + dx * scale * s - (dy * scale * c) / Math.sin(Math.PI / 3),
    );
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!moved && pointers.size === 1)
      inspectCell(event.clientX, event.clientY);
    pointers.delete(event.pointerId);
    lastPinch = 0;
  });
  canvas.addEventListener("pointercancel", (event) => {
    pointers.delete(event.pointerId);
    lastPinch = 0;
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      navigate(
        view.x,
        view.z,
        view.halfHeight * Math.exp(event.deltaY * 0.0015),
      );
    },
    { passive: false },
  );
  $("home").onclick = () => {
    view.yaw = -0.22;
    navigate(0, 14, 97);
    $("cell-panel").hidden = true;
  };
  $("overview").onclick = () => {
    view.yaw = 0;
    navigate(-10000, 6500, 100000);
    $("cell-panel").hidden = true;
  };
  $("zoom-in").onclick = () => navigate(view.x, view.z, view.halfHeight / 1.4);
  $("zoom-out").onclick = () => navigate(view.x, view.z, view.halfHeight * 1.4);
  $("rotate").onclick = () => {
    view.yaw += Math.PI / 4;
    updateCamera();
  };
  $("close-cell").onclick = () => {
    $("cell-panel").hidden = true;
  };
  setupTravel();
  $("copy-code").onclick = async () => {
    try {
      await navigator.clipboard.writeText(selectedCode);
      $("copy-status").textContent = "Cell code copied";
    } catch {
      $("copy-status").textContent = "Select the code above to copy it.";
    }
  };
  for (const key of ["structures", "nature", "grid"] as const)
    $<HTMLInputElement>(key).onchange = (event) => {
      layers[key] = (event.target as HTMLInputElement).checked;
      setLayers();
    };
  window.addEventListener("keydown", (event) => {
    if (document.activeElement !== canvas) return;
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "w",
        "a",
        "s",
        "d",
        "q",
        "e",
      ].includes(event.key)
    ) {
      pressed.add(event.key);
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => pressed.delete(event.key));
  window.addEventListener("blur", () => pressed.clear());
  window.addEventListener("resize", () => {
    app.resizeCanvas();
    view.aspect = innerWidth / innerHeight;
    view.pixels = Math.min(innerHeight, 1000);
    updateCamera();
  });
}
function setupTravel() {
  const continent = $<HTMLSelectElement>("continent-select"),
    country = $<HTMLSelectElement>("country-select"),
    city = $<HTMLSelectElement>("city-select"),
    village = $<HTMLSelectElement>("village-select");
  const options = (
    select: HTMLSelectElement,
    items: { value: string; name: string }[],
  ) => {
    select.replaceChildren(
      ...items.map((item) => new Option(item.name, item.value)),
    );
  };
  const updateVillages = () =>
    options(
      village,
      villages
        .filter((v) => v.id.startsWith(city.value + "/"))
        .map((v) => ({ value: v.id, name: v.name })),
    );
  const updateCities = () => {
    const c = countries.find((c) => c.code === country.value)!;
    simulation.setInterest(c.code);
    options(
      city,
      cities
        .filter((t) => t.continent === c.continent && t.country === c.id)
        .map((t) => ({ value: t.id, name: t.name })),
    );
    updateVillages();
  };
  const updateCountries = () => {
    options(
      country,
      countries
        .filter((c) => c.continent === Number(continent.value))
        .map((c) => ({ value: c.code, name: c.name })),
    );
    updateCities();
  };
  options(
    continent,
    continents.map((c) => ({ value: String(c.id), name: c.name })),
  );
  updateCountries();
  continent.onchange = updateCountries;
  country.onchange = updateCities;
  city.onchange = updateVillages;
  $("open-travel").onclick = () => {
    $("travel-panel").hidden = !$("travel-panel").hidden;
  };
  $("close-travel").onclick = () => {
    $("travel-panel").hidden = true;
  };
  $("visit-city").onclick = () => {
    const place = cities.find((p) => p.id === city.value)!;
    navigate(place.x, place.z, 450);
    simulation.setFocus(place);
    $("travel-panel").hidden = true;
  };
  $("visit-village").onclick = () => {
    const place = villages.find((p) => p.id === village.value)!;
    navigate(place.x, place.z + 14, 97);
    simulation.setFocus(place);
    $("travel-panel").hidden = true;
  };
}
function characterMaterial(variant: number): pc.StandardMaterial {
  const image = document.createElement("canvas");
  image.width = 64;
  image.height = 96;
  const ctx = image.getContext("2d")!;
  const coats = ["#785137", "#687b69", "#aa7950"];
  ctx.fillStyle = "#3a382c";
  ctx.fillRect(22, 69, 9, 22);
  ctx.fillRect(35, 69, 9, 22);
  ctx.fillStyle = "#d2b17e";
  ctx.fillRect(17, 40, 8, 27);
  ctx.fillRect(43, 40, 8, 27);
  ctx.fillStyle = coats[variant];
  ctx.beginPath();
  ctx.moveTo(23, 36);
  ctx.lineTo(43, 36);
  ctx.lineTo(49, 75);
  ctx.lineTo(17, 75);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#463b2c";
  ctx.fillRect(21, 61, 23, 4);
  ctx.fillStyle = "#d7b487";
  ctx.beginPath();
  ctx.ellipse(33, 25, 11, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4e3c2a";
  ctx.beginPath();
  ctx.ellipse(33, 16, 13, 9, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(20, 15, 26, 5);
  ctx.fillStyle = "#493b2c";
  ctx.fillRect(27, 26, 2, 2);
  ctx.fillRect(37, 26, 2, 2);
  const texture = new pc.Texture(app.graphicsDevice, {
    width: 64,
    height: 96,
    mipmaps: true,
  });
  texture.setSource(image);
  const material = new pc.StandardMaterial();
  material.diffuseMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = "a";
  material.alphaTest = 0.4;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}
async function start() {
  $("world-seed").textContent = WORLD_SEED;
  $("fantasy-time").textContent = clock.labelAt(Date.now());
  const device = await createRenderer(canvas);
  canvas = device.canvas as HTMLCanvasElement;
  device.on("devicelost", () => {
    rendererState.phase = "lost";
    rendererState.error =
      "The GPU connection was lost. Reload the page to restore rendering.";
    if (app) app.autoRender = false;
    fail(rendererState.error);
    showRendererActions();
  });
  device.on("devicerestored", () => {
    rendererState.phase = "ready";
    rendererState.error = "";
    errorText = "";
    $("error").hidden = true;
    app.autoRender = true;
  });
  device.maxPixelRatio = Math.min(devicePixelRatio, 1.5);
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.LightComponentSystem,
  ];
  options.resourceHandlers = [pc.TextureHandler];
  app = new pc.AppBase(canvas);
  app.init(options);
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.scene.ambientLight = new pc.Color(0.4, 0.46, 0.41);
  camera = new pc.Entity("Atlas camera");
  camera.addComponent("camera", {
    projection: pc.PROJECTION_ORTHOGRAPHIC,
    clearColor: new pc.Color(0.65, 0.71, 0.65),
    nearClip: 0.1,
    farClip: 22000,
  });
  app.root.addChild(camera);
  const sun = new pc.Entity("Late afternoon sun");
  sun.addComponent("light", {
    type: "directional",
    color: new pc.Color(1, 0.94, 0.84),
    intensity: 0.9,
    castShadows: true,
    shadowResolution: 2048,
    shadowDistance: 420,
    shadowBias: 0.3,
    normalOffsetBias: 0.15,
  });
  sun.setEulerAngles(48, -28, 0);
  app.root.addChild(sun);
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(1, 1, 1);
  material.diffuseVertexColor = true;
  material.specular = new pc.Color(0.04, 0.04, 0.04);
  material.shininess = 4;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  worker = new Worker(new URL("./tile-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event) => {
    inFlight--;
    if (event.data.error) {
      pending.delete(event.data.tile.key);
      fail(`Tile generation failed: ${event.data.error}`);
      return;
    }
    uploads.push(event.data);
  };
  worker.onerror = (event) =>
    fail(`World worker could not start: ${event.message}`);
  setupControls();
  updateCamera();
  simulation.setFocus(villages[0]);
  simulation.advance(clock.tickAt(Date.now()));
  const characterMaterials = [0, 1, 2].map(characterMaterial);
  const actors: pc.Entity[] = [];
  let lastSimulationRealSecond = -1;
  const labelNodes = new Map<string, HTMLElement>();
  const labels = $("map-labels");
  $("backend").textContent = `PlayCanvas 2.23.0 · ${device.deviceType === "webgpu" ? "WebGPU" : "WebGL2"}`;
  $("backend").title = rendererState.fallbackReason;
  let statsElapsed = 0,
    frames = 0,
    fps = 0;
  app.on("update", (dt: number) => {
    if (rendererState.phase === "lost") return;
    const now = Date.now(),
      realSecond = Math.floor(now / 1000);
    const simulationTick = clock.tickAt(now);
    if (realSecond !== lastSimulationRealSecond) {
      if (view.halfHeight < 900)
        simulation.setFocus(nearestPlace(view.x, view.z));
      simulation.advance(Math.max(simulation.tick, simulationTick));
      lastSimulationRealSecond = realSecond;
      $("fantasy-time").textContent = clock.labelAt(now);
      $("simulation-status").textContent =
        `${simulation.stats.residents} residents live in the focused country; ${simulation.stats.coarseCountries} countries tracked as summaries.`;
      const visible =
        view.halfHeight < 240
          ? simulation
              .focusedResidents(view.x, view.z, view.halfHeight * 1.5)
              .slice(0, 96)
          : [];
      for (let i = 0; i < visible.length; i++) {
        if (!actors[i]) {
          const actor = new pc.Entity("Resident billboard");
          actor.addComponent("render", {
            type: "plane",
            castShadows: false,
            receiveShadows: false,
            material: characterMaterials[visible[i].variant % 3],
          });
          actor.setLocalScale(2.2, 1, 3.3);
          app.root.addChild(actor);
          actors.push(actor);
        }
        actors[i].enabled = true;
        actors[i].setPosition(
          visible[i].x,
          heightAt(visible[i].x, visible[i].z) + 1.65,
          visible[i].z,
        );
      }
      for (let i = visible.length; i < actors.length; i++)
        actors[i].enabled = false;
    }
    for (const actor of actors)
      if (actor.enabled) {
        actor.setRotation(camera.getRotation());
        actor.rotateLocal(90, 0, 0);
      }
    sun.light!.castShadows = view.halfHeight < 500;
    const destinations =
      view.halfHeight > 25000
        ? continents.map((c) => ({
            ...c,
            id: `continent-${c.id}`,
            kind: "continent",
          }))
        : view.halfHeight > 1000
          ? countries.map((c) => ({ ...c, id: c.code, kind: "country" }))
          : view.halfHeight > 230
            ? cities
            : villages;
    const visibleLabels = new Set<string>();
    for (const place of destinations) {
      if (
        Math.abs(place.x - view.x) > view.halfHeight * view.aspect * 1.4 ||
        Math.abs(place.z - view.z) > view.halfHeight * 1.5
      )
        continue;
      const screen = camera.camera!.worldToScreen(
        new pc.Vec3(
          place.x,
          Math.max(0, heightAt(place.x, place.z)) + 2,
          place.z,
        ),
      );
      if (
        screen.x < 15 ||
        screen.x > innerWidth - 15 ||
        screen.y < 90 ||
        screen.y > innerHeight - 120
      )
        continue;
      const id = String(place.id);
      visibleLabels.add(id);
      let label = labelNodes.get(id);
      if (!label) {
        label = document.createElement("div");
        label.className = `map-label ${place.kind}`;
        label.textContent = place.name;
        labels.append(label);
        labelNodes.set(id, label);
      }
      label.style.transform = `translate(${screen.x}px,${screen.y}px) translate(-50%,-100%)`;
    }
    for (const [id, label] of labelNodes)
      if (!visibleLabels.has(id)) {
        label.remove();
        labelNodes.delete(id);
      }
    const speed = view.halfHeight * dt * 0.8;
    const dx =
      (pressed.has("d") || pressed.has("ArrowRight") ? 1 : 0) -
      (pressed.has("a") || pressed.has("ArrowLeft") ? 1 : 0);
    const dz =
      (pressed.has("s") || pressed.has("ArrowDown") ? 1 : 0) -
      (pressed.has("w") || pressed.has("ArrowUp") ? 1 : 0);
    if (dx || dz)
      navigate(
        view.x +
          dx * speed * Math.cos(view.yaw) +
          dz * speed * Math.sin(view.yaw),
        view.z -
          dx * speed * Math.sin(view.yaw) +
          dz * speed * Math.cos(view.yaw),
      );
    if (pressed.has("q") || pressed.has("e")) {
      view.yaw += (pressed.has("e") ? 1 : -1) * dt * 0.7;
      updateCamera();
    }
    if (!errorText) processStreaming(material);
    if (layers.grid)
      for (const key of activeKeys) {
        const t = tileCache.get(key)!.tile;
        const corners = [
          [t.minX, t.minZ],
          [t.minX + t.size, t.minZ],
          [t.minX + t.size, t.minZ + t.size],
          [t.minX, t.minZ + t.size],
        ];
        for (let i = 0; i < 4; i++) {
          const a = corners[i],
            b = corners[(i + 1) % 4];
          app.drawLine(
            new pc.Vec3(a[0], Math.max(0, heightAt(a[0], a[1])) + 0.8, a[1]),
            new pc.Vec3(b[0], Math.max(0, heightAt(b[0], b[1])) + 0.8, b[1]),
            new pc.Color(0.91, 0.77, 0.42),
            true,
          );
        }
      }
    statsElapsed += dt;
    frames++;
    if (statsElapsed >= 1) {
      fps = Math.round(frames / statsElapsed);
      statsElapsed = 0;
      frames = 0;
    }
  });
  // Read-only diagnostic interface for deterministic generation and browser verification.
  Object.defineProperty(window, "advisorWorld", {
    value: {
      seed: WORLD_SEED,
      cellAt,
      cellSeed,
      geography: { continents, countries, cities, villages, roads },
      clock,
      renderer: rendererState,
      get state() {
        return {
          ready,
          error: errorText,
          view: { ...view },
          fps,
          active: activeKeys.length,
          cached: tileCache.size,
          pending: pending.size,
          levels: [
            ...new Set(activeKeys.map((key) => tileCache.get(key)!.tile.level)),
          ],
          simulation: simulation.stats,
          settled:
            !selectionDirty &&
            pending.size === 0 &&
            activeKeys.length === wanted.length &&
            activeKeys.every((key) => wanted.some((t) => t.key === key)),
          visibleMeshes: Object.fromEntries(
            ["terrain", "structures", "nature", "detail"].map((name) => [
              name,
              [...tileCache.values()].filter(
                (r) =>
                  r.entity.enabled &&
                  r.entity.children.some(
                    (child) => child.name === name && child.enabled,
                  ),
              ).length,
            ]),
          ),
        };
      },
    },
  });
  app.start();
}
function showRendererActions() {
  const actions = document.createElement("div");
  actions.className = "renderer-actions";
  const retry = document.createElement("button");
  retry.textContent = "Retry rendering";
  retry.onclick = () => {
    const url = new URL(location.href);
    url.searchParams.delete("renderer");
    location.assign(url);
  };
  actions.append(retry);
  $("error").append(actions);
}
start().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  $("backend").textContent = "3D renderer unavailable";
  $("tile-status").textContent = "Renderer initialization failed";
  showRendererActions();
});
