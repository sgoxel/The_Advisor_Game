import * as pc from "playcanvas";
import "./style.css";
import {
  WORLD_SEED,
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
  continentAt,
  continentalEnvelope,
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
import { GlobeView } from "./globe-view.ts";
import {
  PLANET_RADIUS,
  POLE_DISTANCE,
  CANONICAL_PLANET_RADIUS,
  CANONICAL_PLANET_CIRCUMFERENCE,
  canonicalCellId,
  canonicalFootprintForHalfHeight,
  flatToLonLat,
  lonLatToFlat,
  wrapX,
  halfHeightForCanonicalFootprint,
  CANONICAL_PLANET_DIAMETER,
  type LonLat,
} from "./planet.ts";
import {
  GPU_LOCAL_LIMIT_M,
  REBASE_THRESHOLD_M,
  LocalRenderFrame,
  type PatchConversionStats,
} from "./render-frame.ts";
import {
  HANDOFF_LOCAL_HALF_HEIGHT,
  HANDOFF_GLOBE_HALF_HEIGHT,
  projectionTransitionForHalfHeight,
  advanceProjectionTransition,
  scaleLabelForHalfHeight,
  SCALE_LADDER,
} from "./handoff.ts";
import {
  coordinateLabel,
  distanceLabel,
  draggedFocus,
  parallelDragFocus,
  surfaceDistance,
  placeLabels,
  type Rect,
} from "./navigation.ts";
import {
  estimateTileGeometryBytes,
  streamingBudgetForViewport,
  type StreamingBudget,
} from "./streaming.ts";

/** Canonical 1/2500 globe-dominant anchor, converted through the temporary S001 presentation adapter. */
const GLOBE_FROM = HANDOFF_GLOBE_HALF_HEIGHT;
/** Surface image passes: a quick preview, then the final image. */
const GLOBE_PASSES = [
  { width: 512, samples: 1 },
  { width: 1024, samples: 2 },
];
/** Hill-shading strength: enough for highlands to read without drowning the land. */
const GLOBE_RELIEF = 0.6;
const FLAT_BACKDROP = new pc.Color(0.65, 0.71, 0.65);

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
const renderFrame = new LocalRenderFrame(view.x, view.z);
let ready = false,
  selectedCode = "",
  activeKeys: string[] = [],
  wanted: Tile[] = [],
  errorText = "";
let app: pc.AppBase, camera: pc.Entity, flatRoot: pc.Entity;
let globe: GlobeView | undefined,
  globeWorker: Worker | undefined,
  globeShown = false,
  globePass = 0, // surface passes applied so far
  globeFit = PLANET_RADIUS * 2.6; // view half-height that frames the whole globe
const globePoint = new pc.Vec3(),
  flatLabelPoint = new pc.Vec3();
let projectionTransition = 0,
  desiredProjectionTransition = 0,
  handoffActive = false,
  handoffDirection = "none",
  handoffRequestedAt = 0,
  handoffDurationMs = 0,
  handoffPreparationStarted = 0,
  handoffPreparationWaitMs = 0,
  handoffBlendDurationMs = 0,
  handoffWaitingForDestination = false,
  slowFrameCount = 0,
  droppedFrameCount = 0,
  lastFlatOpacity = -1,
  detailedMaxHorizontalM = 0,
  detailedMaxFloat32ErrorM = 0;
let worldMaterial: pc.StandardMaterial | undefined;
const tileCache = new Map<
  string,
  { tile: Tile; entity: pc.Entity; meshes: pc.Mesh[]; used: number; bytes: number }
>();
let revision = 0,
  inFlight = 0,
  selectionDirty = true,
  cacheHits = 0,
  cacheMisses = 0,
  evictions = 0,
  cacheGpuBytes = 0,
  readyCpuBytes = 0,
  uploadsThisFrame = 0,
  poleFeedback = "";
let streamingBudget: StreamingBudget = streamingBudgetForViewport(
  innerWidth,
  innerHeight,
);
const pending = new Set<string>();
const uploads: {
  tile: Tile;
  data: TileGeometry;
  precision: PatchConversionStats;
}[] = [];
let worker: Worker;
const layers = { structures: true, nature: true, grid: false };
const pressed = new Set<string>();
const simulation = new LazySimulation();
const clock = new FantasyClock();
const actorSources = new Map<pc.Entity, { x: number; z: number }>();
let navigationFingerprint = "";
let rulerState = {
  pixels: 0,
  distanceM: 0,
  start: { lon: 0, lat: 0 },
  end: { lon: 0, lat: 0 },
};
let labelState: {
  id: string;
  anchor: { x: number; y: number };
  rect: Rect;
  leader: boolean;
}[] = [];

function applyTileRenderTransform(tile: Tile, entity: pc.Entity) {
  const transform = renderFrame.patchTransform(tile);
  entity.setLocalPosition(transform.x, 0, transform.z);
  entity.setLocalEulerAngles(0, transform.yawDegrees, 0);
}

function positionActor(actor: pc.Entity, x: number, z: number) {
  const point = renderFrame.sourceToRender(x, z, heightAt(x, z) + 1.65);
  actor.setLocalPosition(point.x, point.y, point.z);
}

function refreshRenderFrameTransforms() {
  for (const { tile, entity } of tileCache.values())
    applyTileRenderTransform(tile, entity);
  for (const [actor, source] of actorSources)
    if (actor.enabled) positionActor(actor, source.x, source.z);
  navigationFingerprint = "";
}

function rebaseRenderFrame(force = false) {
  const changed = force
    ? renderFrame.rebase(view.x, view.z)
    : renderFrame.maybeRebase(view.x, view.z);
  if (changed) refreshRenderFrameTransforms();
  return changed;
}

function flatWorldPoint(x: number, z: number, y: number): pc.Vec3 {
  const point = renderFrame.sourceToRender(x, z, y);
  if (projectionTransition <= 0.001)
    return new pc.Vec3(point.x, point.y, point.z);
  const focus = renderFrame.sourceToRender(view.x, view.z),
    focusY = Math.max(0, heightAt(view.x, view.z));
  return new pc.Vec3(
    point.x - focus.x,
    PLANET_RADIUS + y - focusY,
    point.z - focus.z,
  );
}

function surfaceAtScreen(x: number, y: number): LonLat | undefined {
  const lens = camera.camera!;
  app.graphicsDevice.updateClientRect();
  lens.aspectRatio = view.aspect;
  lens.onAppPrerender();
  const origin = lens.screenToWorld(x, y, 0),
    direction = lens.screenToWorld(x, y, lens.farClip).sub(origin).normalize();
  if (projectionTransition > 0.5 && globe) {
    const b = origin.dot(direction),
      d = b * b - origin.lengthSq() + PLANET_RADIUS * PLANET_RADIUS;
    if (d < 0) return undefined;
    const distance = -b - Math.sqrt(d);
    if (distance < 0) return undefined;
    return globe.coordinatesOf(origin.add(direction.mulScalar(distance)));
  }
  const yPlane =
    projectionTransition > 0.001
      ? PLANET_RADIUS
      : Math.max(0, heightAt(view.x, view.z));
  const distance = (yPlane - origin.y) / direction.y;
  if (!Number.isFinite(distance) || distance < 0) return undefined;
  const point = origin.add(direction.mulScalar(distance)),
    focus = renderFrame.sourceToRender(view.x, view.z),
    localX = point.x + (projectionTransition > 0.001 ? focus.x : 0),
    localZ = point.z + (projectionTransition > 0.001 ? focus.z : 0);
  try {
    return renderFrame.renderToLonLat(localX, localZ);
  } catch {
    return undefined;
  }
}

function panScreen(ax: number, ay: number, bx: number, by: number) {
  const previous = surfaceAtScreen(ax, ay),
    current = surfaceAtScreen(bx, by);
  if (previous && current) {
    const focus = flatToLonLat(view.x, view.z);
    const parallel =
      Math.abs(by - ay) < 0.001 && Math.abs(Math.sin(view.yaw)) < 1e-9;
    const next = parallel
      ? parallelDragFocus(focus, previous, current)
      : projectionTransition > 0.5
        ? draggedFocus(focus, previous, current)
        : {
            lon:
              focus.lon +
              Math.atan2(
                Math.sin(previous.lon - current.lon),
                Math.cos(previous.lon - current.lon),
              ),
            lat: focus.lat + previous.lat - current.lat,
          };
    const flat = lonLatToFlat(next.lon, next.lat);
    const latitude = focus.lat + previous.lat - current.lat;
    if (!parallel && Math.abs(latitude) > Math.PI / 2)
      flat.z = latitude > 0 ? -POLE_DISTANCE : POLE_DISTANCE;
    navigate(flat.x, flat.z);
  }
}

function updateNavigationHud() {
  const fingerprint = [
    view.x,
    view.z,
    view.yaw,
    view.halfHeight,
    projectionTransition,
    renderFrame.stats.rebases,
    innerWidth,
    innerHeight,
    camera.camera!.aspectRatio,
    app.graphicsDevice.clientRect.width,
    app.graphicsDevice.clientRect.height,
  ].join("/");
  if (fingerprint === navigationFingerprint) return;
  navigationFingerprint = fingerprint;
  const focus = flatToLonLat(view.x, view.z);
  $("focus-coordinates").textContent = coordinateLabel(
    focus,
    projectionTransition <= 0.5,
  );
  $("compass-needle").style.transform =
    `rotate(${(view.yaw * 180) / Math.PI}deg)`;
  // North's screen direction comes from the shared camera attitude. Inferring
  // it from geographic pick deltas introduces projection-dependent zoom drift.
  const screenHeading = -view.yaw || 0;
  $("compass").title =
    `Heading ${(((((screenHeading * 180) / Math.PI) % 360) + 360) % 360).toFixed(0)}° · reset north`;
  const scale = scaleLabelForHalfHeight(view.halfHeight);
  $<HTMLSelectElement>("map-scale").value = scale.slice(2);
  const anchor = (CANONICAL_PLANET_DIAMETER * Number(scale.slice(2))) / 10000;
  const approximate =
    Math.abs(canonicalFootprintForHalfHeight(view.halfHeight) / anchor - 1) >
    0.001;
  for (const option of Array.from($<HTMLSelectElement>("map-scale").options))
    option.textContent = `1/${option.value}${approximate && option.selected ? " ≈" : ""}`;
  $("scale-caption").textContent = approximate ? "Scale ≈" : "Scale";
  let pixels = innerWidth < 700 ? 64 : 104;
  let start: LonLat | undefined, end: LonLat | undefined;
  while (pixels >= 16) {
    start = surfaceAtScreen(innerWidth / 2 - pixels / 2, innerHeight / 2);
    end = surfaceAtScreen(innerWidth / 2 + pixels / 2, innerHeight / 2);
    if (start && end) break;
    pixels -= 8;
  }
  if (start && end) {
    const distanceM = surfaceDistance(start, end);
    rulerState = { pixels, distanceM, start, end };
    $("scale-line").style.width = `${pixels}px`;
    $("scale-text").textContent = distanceLabel(distanceM);
    $("scale-text").title = "Surface distance at map focus";
  }
}

function fail(message: string) {
  errorText = message;
  $("loading").hidden = true;
  $("error").hidden = false;
  $("error").textContent = message;
}
/** Fit the projected sphere, whose centre sits half a radius below the surface focus. */
function freeRadius(): number {
  const cx = innerWidth / 2,
    cy = innerHeight / 2;
  const obstacles: DOMRect[] = [];
  for (const selector of [
    ".masthead",
    ".region-panel",
    ".map-controls",
    ".bottom-bar",
    "#focus-coordinates",
  ]) {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    if (!box || !box.width) continue;
    obstacles.push(box);
  }
  let low = 0,
    high = Math.min(cx - 8, (innerHeight - cy - 8) / 1.5);
  for (let i = 0; i < 24; i++) {
    const radius = (low + high) / 2,
      centreY = cy + radius * 0.5;
    const clear = obstacles.every(
      (box) =>
        Math.hypot(
          Math.max(box.left - cx, 0, cx - box.right),
          Math.max(box.top - centreY, 0, centreY - box.bottom),
        ) >=
        radius + 8,
    );
    if (clear) low = radius;
    else high = radius;
  }
  return Math.max(60, low);
}
/** Start preparing the globe surface off the main thread; each pass runs once. */
function prepareGlobe() {
  if (globeWorker || globePass >= GLOBE_PASSES.length || !globe) return;
  globeWorker = new Worker(new URL("./globe-worker.ts", import.meta.url), {
    type: "module",
  });
  const request = () => {
    const { width, samples } = GLOBE_PASSES[globePass];
    globeWorker!.postMessage({
      id: globePass,
      width,
      height: width / 2,
      samples,
      relief: GLOBE_RELIEF,
    });
  };
  globeWorker.onmessage = (event) => {
    if (event.data.error) {
      fail(`Globe surface failed: ${event.data.error}`);
      return;
    }
    globe!.setSurface(event.data);
    globePass++;
    if (globePass < GLOBE_PASSES.length) request();
    else {
      globeWorker!.terminate();
      globeWorker = undefined;
    }
  };
  globeWorker.onerror = (event) =>
    fail(`Globe worker could not start: ${event.message}`);
  request();
}
function flatCoverageReady() {
  return (
    !selectionDirty &&
    wanted.length > 0 &&
    wanted.every((tile) => tileCache.has(tile.key))
  );
}
function globeCoverageReady() {
  return globePass >= GLOBE_PASSES.length;
}
function destinationCoverageReady(flatReady = flatCoverageReady()): boolean {
  const globeReady = globeCoverageReady();
  if (desiredProjectionTransition > projectionTransition + 0.001)
    return globeReady;
  if (desiredProjectionTransition < projectionTransition - 0.001)
    return flatReady;
  if (desiredProjectionTransition >= 0.999) return globeReady;
  if (desiredProjectionTransition <= 0.001) return flatReady;
  return globeReady && flatReady;
}
function applyPresentation() {
  if (!globe) return;
  desiredProjectionTransition = projectionTransitionForHalfHeight(
    view.halfHeight,
  );
  const active = projectionTransition > 0.001,
    fullGlobe = projectionTransition >= 0.999,
    targetY = Math.max(0, heightAt(view.x, view.z)),
    focusRender = renderFrame.sourceToRender(view.x, view.z);
  globeShown = fullGlobe;
  document.body.classList.toggle("globe-mode", fullGlobe);
  document.body.classList.toggle("handoff-mode", active && !fullGlobe);
  if (active) {
    flatRoot.setLocalPosition(
      -focusRender.x,
      PLANET_RADIUS - targetY,
      -focusRender.z,
    );
    flatRoot.enabled = !fullGlobe;
    const { lon, lat } = flatToLonLat(view.x, view.z);
    globe.orient(lon, lat, 0);
    globe.setVisible(true);
    globe.setBlend(projectionTransition);
    globe.placeCamera(camera, view.halfHeight, view.yaw);
    $("cell-panel").hidden = true;
  } else {
    flatRoot.setLocalPosition(0, 0, 0);
    flatRoot.enabled = true;
    globe.setVisible(false);
    globe.setBlend(0);
    const distance = view.halfHeight * 2.2 + 200;
    camera.setPosition(
      focusRender.x + Math.sin(view.yaw) * distance * 0.5,
      targetY + distance * Math.sin(Math.PI / 3),
      focusRender.z + Math.cos(view.yaw) * distance * 0.5,
    );
    camera.lookAt(focusRender.x, targetY, focusRender.z);
    camera.camera!.orthoHeight = view.halfHeight;
    camera.camera!.farClip = 600000;
  }
  if (worldMaterial) {
    const opacity = 1 - projectionTransition;
    if (
      Math.abs(opacity - lastFlatOpacity) > 0.004 ||
      opacity === 0 ||
      opacity === 1
    ) {
      lastFlatOpacity = opacity;
      worldMaterial.opacity = opacity;
      worldMaterial.blendType =
        opacity < 0.999 ? pc.BLEND_NORMAL : pc.BLEND_NONE;
      // Keep the nearest flat surface in the depth buffer while it remains
      // visible. Without this, overlapping tile skirts alpha-blend together
      // during the handoff and expose rectangular tile seams.
      worldMaterial.depthWrite = opacity > 0.001;
      worldMaterial.update();
    }
  }
  const backdrop = globe.backdropColor,
    t = projectionTransition;
  camera.camera!.clearColor.set(
    FLAT_BACKDROP.r + (backdrop.r - FLAT_BACKDROP.r) * t,
    FLAT_BACKDROP.g + (backdrop.g - FLAT_BACKDROP.g) * t,
    FLAT_BACKDROP.b + (backdrop.b - FLAT_BACKDROP.b) * t,
    1,
  );
}
function updateCamera() {
  selectionDirty = true;
  desiredProjectionTransition = projectionTransitionForHalfHeight(
    view.halfHeight,
  );
  if (desiredProjectionTransition > 0) prepareGlobe();
  applyPresentation();
}
function updateHandoff(dt: number) {
  desiredProjectionTransition = projectionTransitionForHalfHeight(
    view.halfHeight,
  );
  if (desiredProjectionTransition > 0) prepareGlobe();
  const now = performance.now(),
    flatReady = flatCoverageReady(),
    destinationReady = destinationCoverageReady(flatReady),
    needsTransition =
      Math.abs(desiredProjectionTransition - projectionTransition) > 0.001;

  if (needsTransition && !handoffActive) {
    handoffActive = true;
    handoffRequestedAt = now;
    handoffDurationMs = 0;
    handoffPreparationWaitMs = 0;
    handoffBlendDurationMs = 0;
    handoffWaitingForDestination = false;
  }
  if (needsTransition)
    handoffDirection =
      desiredProjectionTransition > projectionTransition
        ? "to-globe"
        : "to-flat";

  if (needsTransition && !destinationReady) {
    if (!handoffWaitingForDestination) {
      handoffWaitingForDestination = true;
      handoffPreparationStarted = now;
    }
  } else if (handoffWaitingForDestination) {
    handoffPreparationWaitMs += now - handoffPreparationStarted;
    handoffPreparationStarted = 0;
    handoffWaitingForDestination = false;
  }

  const target = destinationReady
      ? desiredProjectionTransition
      : projectionTransition,
    canMove = Math.abs(target - projectionTransition) > 0.001;
  if (canMove) handoffBlendDurationMs += Math.max(0, dt * 1000);
  projectionTransition = advanceProjectionTransition(
    projectionTransition,
    target,
    dt,
  );

  if (
    handoffActive &&
    Math.abs(projectionTransition - desiredProjectionTransition) <= 0.001 &&
    destinationCoverageReady(flatReady)
  ) {
    if (handoffWaitingForDestination) {
      handoffPreparationWaitMs += now - handoffPreparationStarted;
      handoffPreparationStarted = 0;
      handoffWaitingForDestination = false;
    }
    handoffDurationMs = now - handoffRequestedAt;
    handoffActive = false;
    handoffDirection = "none";
  }
  applyPresentation();
}
function navigate(x: number, z: number, height = view.halfHeight) {
  view.halfHeight = Math.max(
    2,
    Math.min(Math.max(GLOBE_FROM, globeFit) * 1.3, height),
  );
  const clampedZ = Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, z));
  if (Math.abs(z - clampedZ) > 1e-6)
    poleFeedback = z < -POLE_DISTANCE ? "North pole limit reached" : "South pole limit reached";
  else if (Math.abs(clampedZ) < POLE_DISTANCE - 1) poleFeedback = "";
  view.x = wrapX(x);
  view.z = clampedZ;
  rebaseRenderFrame();
  // Leaving Province level means the globe may be needed soon.
  if (view.halfHeight >= 900) prepareGlobe();
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
  if (tileCache.has(tile.key)) {
    cacheHits++;
    return;
  }
  if (pending.has(tile.key) || pending.size >= streamingBudget.generationReadyQueue)
    return;
  cacheMisses++;
  pending.add(tile.key);
  inFlight++;
  worker.postMessage(tile);
}
function refreshSelection() {
  streamingBudget = streamingBudgetForViewport(innerWidth, innerHeight);
  wanted = selectTiles(view, 190, streamingBudget.activePatches);
  revision++;
  selectionDirty = false;
  const name =
    view.halfHeight < 70
      ? "Street"
      : view.halfHeight < 230
        ? "Village"
        : view.halfHeight < 900
          ? "Province"
          : view.halfHeight < GLOBE_FROM
            ? "Country"
            : "Realm";
  $("detail-name").textContent = name;
  const dotCount = { Street: 5, Village: 4, Province: 3, Country: 2, Realm: 1 }[
    name
  ];
  document
    .querySelectorAll(".detail-dots i")
    .forEach((dot, i) => dot.classList.toggle("active", i < dotCount));
  const s = nearestPlace(view.x, view.z);
  $("place-name").textContent = globeShown
    ? continentalEnvelope(view.x, view.z) < 1
      ? continentAt(view.x, view.z).name
      : "The open sea"
    : s && Math.hypot(view.x - s.x, view.z - s.z) < 200
      ? s.name
      : "The wild marches";
  updateNavigationHud();
}
function processStreaming(material: pc.StandardMaterial) {
  if (selectionDirty) refreshSelection();
  uploadsThisFrame = 0;
  const next = uploads.shift();
  if (next) {
    uploadsThisFrame = 1;
    const bytes = estimateTileGeometryBytes(next.data);
    readyCpuBytes = Math.max(0, readyCpuBytes - bytes);
    const entity = new pc.Entity(next.tile.key),
      meshes: pc.Mesh[] = [];
    for (const [name, g] of Object.entries(next.data)) {
      const mesh = uploadGeometry(g, entity, name, material);
      if (mesh) meshes.push(mesh);
    }
    entity.enabled = false;
    applyTileRenderTransform(next.tile, entity);
    flatRoot.addChild(entity);
    tileCache.set(next.tile.key, {
      tile: next.tile,
      entity,
      meshes,
      used: revision,
      bytes,
    });
    cacheGpuBytes += bytes;
    if (next.tile.size <= 512) {
      detailedMaxHorizontalM = Math.max(
        detailedMaxHorizontalM,
        next.precision.maxHorizontalM,
      );
      detailedMaxFloat32ErrorM = Math.max(
        detailedMaxFloat32ErrorM,
        next.precision.maxFloat32ErrorM,
      );
    }
    pending.delete(next.tile.key);
  }

  const complete = wanted.length > 0 && wanted.every((tile) => tileCache.has(tile.key));
  if (complete) {
    const newKeys = wanted.map((tile) => tile.key),
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
    for (const key of activeKeys) {
      const record = tileCache.get(key);
      if (record) record.entity.enabled = true;
    }
    for (const tile of wanted) {
      if (pending.size >= streamingBudget.generationReadyQueue) break;
      request(tile);
    }
  }

  const protect = new Set([...activeKeys, ...wanted.map((tile) => tile.key)]),
    obsolete = [...tileCache.entries()]
      .filter(([key]) => !protect.has(key))
      .sort((a, b) => a[1].used - b[1].used);
  for (const [key, record] of obsolete) {
    if (
      tileCache.size <= streamingBudget.cachedPatches &&
      cacheGpuBytes <= streamingBudget.gpuBytes
    )
      break;
    record.entity.destroy();
    tileCache.delete(key);
    cacheGpuBytes = Math.max(0, cacheGpuBytes - record.bytes);
    evictions++;
  }

  const notice = poleFeedback ? ` · ${poleFeedback}` : "";
  $("tile-status").textContent =
    projectionTransition >= 0.999
      ? `Globe · ${globePass < GLOBE_PASSES.length ? "refining" : "ready"}${notice}`
      : projectionTransition > 0.001
        ? `Handoff · ${Math.round(projectionTransition * 100)}% · ${pending.size ? "preparing terrain" : "ready"}${notice}`
        : `${activeKeys.length || 1} patches · ${pending.size ? "refining" : "ready"}${notice}`;
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
    const source = renderFrame.renderToSource(point.x, point.z);
    if (point.y <= Math.max(0, heightAt(source.x, source.z))) {
      hit = distance;
      break;
    }
    before = distance;
  }
  if (hit < 0) return;
  for (let i = 0; i < 18; i++) {
    const middle = (before + hit) / 2,
      point = origin.clone().add(direction.clone().mulScalar(middle)),
      source = renderFrame.renderToSource(point.x, point.z);
    if (point.y > Math.max(0, heightAt(source.x, source.z))) before = middle;
    else hit = middle;
  }
  const point = origin.add(direction.mulScalar(hit));
  try {
    const source = renderFrame.renderToSource(point.x, point.z),
      canonical = renderFrame.renderToLonLat(point.x, point.z),
      cell = cellAt(source.x, source.z),
      hierarchy = cellSeed(cell.x, cell.z),
      canonicalId = canonicalCellId(canonical.lon, canonical.lat);
    selectedCode = canonicalId;
    $("cell-panel").hidden = false;
    $("cell-biome").textContent = cell.biome;
    $("cell-coordinates").textContent =
      `${coordinateLabel(canonical, true)} · ${hierarchy.parent.parent.parent.landform}`;
    $("cell-code").textContent = canonicalId;
    $("cell-code").dataset.canonicalId = canonicalId;
    $("cell-height").textContent = `${cell.elevation.toFixed(1)} m`;
    $("cell-height").title =
      `Canonical position: lon ${canonical.lon.toFixed(9)}, lat ${canonical.lat.toFixed(9)}, elevation ${cell.elevation.toFixed(2)} m`;
    $("cell-tile").textContent = `${cell.tile} · derived render tile`;
    $("cell-walkable").textContent = cell.walkable ? "Yes" : "No";
    $("copy-status").textContent = "";
    const patch = hierarchy.parent,
      district = patch.parent,
      region = district.parent,
      province = region.parent;
    const levels = [
      ["Derived source · Province · 2 km", province.code],
      ["Derived source · Region · 200 m", region.code],
      ["Derived source · District · 20 m", district.code],
      ["Derived source · Patch · 4 m", patch.code],
      ["Derived source · Cell · 2 m", hierarchy.code],
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
  $<HTMLSelectElement>("map-scale").replaceChildren(
    ...SCALE_LADDER.map((value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `1/${value}`;
      return option;
    }),
  );
  $<HTMLSelectElement>("map-scale").onchange = (event) =>
    navigate(
      view.x,
      view.z,
      halfHeightForCanonicalFootprint(
        (CANONICAL_PLANET_DIAMETER *
          Number((event.target as HTMLSelectElement).value)) /
          10000,
      ),
    );
  $("compass").onclick = () => {
    view.yaw = 0;
    updateCamera();
  };
  const pointers = new Map<number, { x: number; y: number }>();
  let startX = 0,
    startY = 0,
    moved = false,
    lastPinch = 0;
  canvas.addEventListener("pointerdown", (event) => {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic browser tests */
    }
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
    if (!moved) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) <= 5)
        return;
      moved = true;
      panScreen(startX, startY, event.clientX, event.clientY);
    } else panScreen(previous.x, previous.y, event.clientX, event.clientY);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!moved && pointers.size === 1 && projectionTransition <= 0.001)
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
    // Realm view: the whole globe, centred on the current focus, north up.
    view.yaw = 0;
    const wasGlobe = document.body.classList.contains("globe-mode");
    document.body.classList.add("globe-mode");
    globeFit = (PLANET_RADIUS * innerHeight) / (2 * freeRadius());
    document.body.classList.toggle("globe-mode", wasGlobe);
    navigate(view.x, view.z, Math.max(GLOBE_FROM, globeFit));
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
      $("copy-status").textContent = "Canonical planet ID copied";
    } catch {
      $("copy-status").textContent = "Select the canonical ID above to copy it.";
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
    if (projectionTransition > 0.001)
      globeFit = (PLANET_RADIUS * innerHeight) / (2 * freeRadius());
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
    clearColor: FLAT_BACKDROP,
    nearClip: 0.1,
    farClip: 22000,
  });
  app.root.addChild(camera);
  flatRoot = new pc.Entity("Flat world");
  app.root.addChild(flatRoot);
  globe = new GlobeView(app);
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
  const material = (worldMaterial = new pc.StandardMaterial());
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
    readyCpuBytes += estimateTileGeometryBytes(event.data.data);
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
  let labelFingerprint = "";
  $("backend").textContent =
    `PlayCanvas 2.23.0 · ${device.deviceType === "webgpu" ? "WebGPU" : "WebGL2"}`;
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
          flatRoot.addChild(actor);
          actors.push(actor);
        }
        actors[i].enabled = true;
        actorSources.set(actors[i], { x: visible[i].x, z: visible[i].z });
        positionActor(actors[i], visible[i].x, visible[i].z);
      }
      for (let i = visible.length; i < actors.length; i++)
        actors[i].enabled = false;
    }
    for (const actor of actors)
      if (actor.enabled) {
        actor.setRotation(camera.getRotation());
        actor.rotateLocal(90, 0, 0);
      }
    if (dt > 1 / 30) slowFrameCount++;
    droppedFrameCount += Math.max(0, Math.floor(dt / (1 / 60)) - 1);
    updateHandoff(dt);
    sun.light!.castShadows =
      view.halfHeight < 500 && projectionTransition <= 0.001;
    const destinations =
      projectionTransition > 0.001 || view.halfHeight > 25000
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
    const anchors: {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];
    const focusRender = renderFrame.sourceToRender(view.x, view.z);
    for (const place of destinations) {
      let screen: pc.Vec3;
      const placeHeight = Math.max(0, heightAt(place.x, place.z)) + 2,
        localPoint = renderFrame.sourceToRender(place.x, place.z, placeHeight);
      if (projectionTransition > 0.001) {
        const focusY = Math.max(0, heightAt(view.x, view.z));
        flatLabelPoint.set(
          localPoint.x - focusRender.x,
          PLANET_RADIUS + placeHeight - focusY,
          localPoint.z - focusRender.z,
        );
        const flatScreen = camera.camera!.worldToScreen(flatLabelPoint);
        const { lon, lat } = flatToLonLat(place.x, place.z),
          onFront = globe!.worldPoint(lon, lat, globePoint);
        if (
          (!onFront || globe!.frontness(globePoint) < 0.08) &&
          projectionTransition > 0.55
        )
          continue;
        if (onFront) {
          const globeScreen = camera.camera!.worldToScreen(globePoint),
            t = projectionTransition;
          screen = new pc.Vec3(
            flatScreen.x + (globeScreen.x - flatScreen.x) * t,
            flatScreen.y + (globeScreen.y - flatScreen.y) * t,
            flatScreen.z + (globeScreen.z - flatScreen.z) * t,
          );
        } else screen = flatScreen;
      } else {
        if (
          Math.abs(localPoint.x - focusRender.x) >
            view.halfHeight * view.aspect * 1.4 ||
          Math.abs(localPoint.z - focusRender.z) > view.halfHeight * 1.5
        )
          continue;
        screen = camera.camera!.worldToScreen(
          new pc.Vec3(localPoint.x, placeHeight, localPoint.z),
        );
      }
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
      anchors.push({
        id,
        x: screen.x,
        y: screen.y,
        width: label.offsetWidth,
        height: label.offsetHeight,
      });
    }
    for (const [id, label] of labelNodes)
      if (!visibleLabels.has(id)) {
        label.remove();
        labelNodes.delete(id);
      }
    const obstacles = [
      "masthead",
      "region-panel",
      "cell-panel",
      "travel-panel",
      "bottom-bar",
      "map-controls",
      "telemetry",
      "focus-coordinates",
      "centre-marker",
    ]
      .flatMap((name) =>
        Array.from(document.querySelectorAll(`#${name},.${name}`)),
      )
      .map((node) => node.getBoundingClientRect())
      .filter((r) => r.width && r.height)
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    const fingerprint = JSON.stringify([
      innerWidth,
      innerHeight,
      anchors.map((a) => [
        a.id,
        Math.round(a.x),
        Math.round(a.y),
        a.width,
        a.height,
      ]),
      obstacles,
    ]);
    if (fingerprint !== labelFingerprint) {
      labelFingerprint = fingerprint;
      const placed = placeLabels(anchors, innerWidth, innerHeight, obstacles);
      labelState = placed.map((p) => ({
        id: p.id,
        anchor: { x: p.x, y: p.y },
        rect: p.rect,
        leader: p.leader,
      }));
      const leaders = $("label-leaders");
      leaders.replaceChildren();
      for (const p of placed) {
        labelNodes.get(p.id)!.style.transform =
          `translate(${p.rect.x}px,${p.rect.y}px)`;
        if (p.leader) {
          const line = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line",
          );
          for (const [key, value] of Object.entries({
            x1: p.x,
            y1: p.y,
            x2: p.endX,
            y2: p.endY,
          }))
            line.setAttribute(key, String(value));
          leaders.append(line);
        }
      }
    }
    const speed = innerHeight * Math.min(dt, 0.05) * 0.2;
    const dx =
      (pressed.has("d") || pressed.has("ArrowRight") ? 1 : 0) -
      (pressed.has("a") || pressed.has("ArrowLeft") ? 1 : 0);
    const dz =
      (pressed.has("s") || pressed.has("ArrowDown") ? 1 : 0) -
      (pressed.has("w") || pressed.has("ArrowUp") ? 1 : 0);
    if (dx || dz)
      panScreen(
        innerWidth / 2,
        innerHeight / 2,
        innerWidth / 2 - dx * speed,
        innerHeight / 2 - dz * speed,
      );
    if (pressed.has("q") || pressed.has("e")) {
      view.yaw += (pressed.has("e") ? 1 : -1) * dt * 0.7;
      updateCamera();
    }
    updateNavigationHud();
    if (!errorText) processStreaming(material);
    if (layers.grid && !globeShown)
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
            flatWorldPoint(a[0], a[1], Math.max(0, heightAt(a[0], a[1])) + 0.8),
            flatWorldPoint(b[0], b[1], Math.max(0, heightAt(b[0], b[1])) + 0.8),
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
      planet: {
        radius: CANONICAL_PLANET_RADIUS,
        circumference: CANONICAL_PLANET_CIRCUMFERENCE,
        renderRadius: PLANET_RADIUS,
        flatToLonLat,
        lonLatToFlat,
      },
      handoff: {
        localHalfHeight: HANDOFF_LOCAL_HALF_HEIGHT,
        globeHalfHeight: HANDOFF_GLOBE_HALF_HEIGHT,
      },
      setHalfHeight(height: number) {
        navigate(view.x, view.z, height);
      },
      navigation: {
        surfaceAtScreen,
        setFocus(lon: number, lat: number) {
          const boundedLat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat));
          if (boundedLat !== lat)
            poleFeedback = lat > 0 ? "North pole limit reached" : "South pole limit reached";
          const p = lonLatToFlat(lon, boundedLat);
          navigate(p.x, p.z);
        },
        forceRebase() {
          if (rebaseRenderFrame(true)) updateCamera();
        },
      },
      renderer: rendererState,
      get state() {
        const flatReady = flatCoverageReady(),
          destinationReady = destinationCoverageReady(flatReady),
          activePreparationWaitMs = handoffWaitingForDestination
            ? handoffPreparationWaitMs +
              performance.now() -
              handoffPreparationStarted
            : handoffPreparationWaitMs;
        return {
          ready,
          error: errorText,
          presentation:
            projectionTransition <= 0.001
              ? "flat"
              : projectionTransition >= 0.999
                ? "globe"
                : "transition",
          scaleLabel: scaleLabelForHalfHeight(view.halfHeight),
          canonicalFootprintM: canonicalFootprintForHalfHeight(view.halfHeight),
          navigation: {
            focus: flatToLonLat(view.x, view.z),
            heading: -view.yaw || 0,
            ruler: { ...rulerState },
            labels: labelState,
            selectedCanonicalId: selectedCode || null,
          },
          renderFrame: {
            origin: renderFrame.canonicalOrigin,
            focusDistanceM: renderFrame.distanceFromOrigin(view.x, view.z),
            rebaseThresholdM: REBASE_THRESHOLD_M,
            gpuLocalLimitM: GPU_LOCAL_LIMIT_M,
            detailedMaxHorizontalM,
            maxFloat32ErrorM: detailedMaxFloat32ErrorM,
            ...renderFrame.stats,
          },
          handoff: {
            projectionTransition,
            desiredTransition: desiredProjectionTransition,
            active: handoffActive,
            direction: handoffDirection,
            durationMs: handoffActive
              ? performance.now() - handoffRequestedAt
              : handoffDurationMs,
            preparationWaitMs: activePreparationWaitMs,
            blendDurationMs: handoffBlendDurationMs,
            waitingForDestination: handoffWaitingForDestination,
            destinationReady,
            outstandingGeneration: pending.size,
            slowFrames: slowFrameCount,
            droppedFrames: droppedFrameCount,
          },
          globe: {
            passes: globePass,
            complete: globeCoverageReady(),
            fit: globeFit,
            ...globe!.stats,
          },
          view: { ...view },
          fps,
          performance: {
            backend: rendererState.backend,
            activePatches: activeKeys.length,
            preparedPatches: uploads.length,
            cachedPatches: tileCache.size,
            pendingGeneration: inFlight,
            readyUploads: uploads.length,
            cacheHits,
            cacheMisses,
            evictions,
            cpuResourceBytesEstimated: readyCpuBytes,
            gpuResourceBytesEstimated: cacheGpuBytes,
            uploadsThisFrame,
          },
          streaming: {
            deviceClass: streamingBudget.deviceClass,
            budget: { ...streamingBudget },
            activePatches: activeKeys.length,
            cachedPatches: tileCache.size,
            pendingGeneration: inFlight,
            readyUploads: uploads.length,
            queuedTotal: pending.size,
            cacheHits,
            cacheMisses,
            evictions,
            cpuBytesEstimated: readyCpuBytes,
            gpuBytesEstimated: cacheGpuBytes,
            uploadsThisFrame,
            poleFeedback: poleFeedback || null,
            activeCanonicalKeys: [...activeKeys],
          },
          active: activeKeys.length,
          cached: tileCache.size,
          pending: pending.size,
          levels: [
            ...new Set(activeKeys.map((key) => tileCache.get(key)!.tile.level)),
          ],
          simulation: simulation.stats,
          settled:
            Math.abs(projectionTransition - desiredProjectionTransition) <=
              0.001 &&
            (desiredProjectionTransition <= 0.001 || globeCoverageReady()) &&
            (!globeShown || globeCoverageReady()) &&
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
