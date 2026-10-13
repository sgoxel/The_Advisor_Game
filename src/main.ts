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
import { terrainTint } from "./geometry.ts";
import { climateSampleAt } from "./climate.ts";
import { drainageRecipes, hydrologyTelemetry, naturalSurfaceAt } from "./hydrology.ts";
import { LOD_BLEND_SECONDS, SURFACE_PRESENTATION, createTerrainMaterial, installLodCoverage, localDetailWeight } from "./surface-presentation.ts";
import { LazySimulation } from "./simulation.ts";
import { FantasyClock } from "./clock.ts";
import { createRenderer, rendererState } from "./renderer.ts";
import { GlobeView } from "./globe-view.ts";
import { updateRouteOverlay } from "./route-overlay.ts";
import { inspectRegion, continuityTelemetry, terrainQuery, clearContinuityDetail } from "./continuity-runtime.ts";
import { setContinuityOverlay, updateContinuityOverlay, continuityOverlayBytes } from "./continuity-overlay.ts";
import type { RouteProjector } from "./route-overlay.ts";
import {
  PLANET_RADIUS,
  POLE_DISTANCE,
  CANONICAL_PLANET_RADIUS,
  CANONICAL_PLANET_CIRCUMFERENCE,
  canonicalCellId,
  canonicalFootprintForHalfHeight,
  flatToLonLat,
  lonLatToFlat,
  sourceToLonLat,
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
  estimateGeometryBytes,
  streamingBudgetForViewport,
  withinStreamingBudget,
  type StreamingBudget,
} from "./streaming.ts";

/** WP-S002-003-003 runtime streaming budgets. */
/** Canonical 1/2500 globe-dominant anchor, converted through the temporary S001 presentation adapter. */
const GLOBE_FROM = HANDOFF_GLOBE_HALF_HEIGHT;
/** One shared final surface; preview replacement must not recolor a visible map. */
const GLOBE_PASSES = [
  { width: 1024, samples: 1 },
];
/** Terrain color interpretation is identical in the globe and flat representations. */
const GLOBE_RELIEF = SURFACE_PRESENTATION.relief;
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
  globePass = 0,
  globeFit = PLANET_RADIUS * 2.6;
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
  detailedMaxHorizontalM = 0,
  detailedMaxFloat32ErrorM = 0;
let worldMaterial: pc.StandardMaterial | undefined;
let terrainMaterial: pc.StandardMaterial | undefined;
let surfaceDetail = 1;
let lodTransition: { oldKeys: string[]; newKeys: string[]; started: number } | undefined;
type CachedTile = {
  tile: Tile;
  entity: pc.Entity;
  meshes: pc.Mesh[];
  used: number;
  bytes: number;
};
const tileCache = new Map<string, CachedTile>();
let revision = 0,
  inFlight = 0,
  selectionDirty = true,
  cacheHits = 0,
  cacheMisses = 0,
  evictions = 0,
  cachedGeometryBytes = 0,
  uploadsThisFrame = 0,
  maxUploadsPerFrame = 0,
  poleStopCount = 0;
let streamingBudget: StreamingBudget = streamingBudgetForViewport(
  innerWidth,
  innerHeight,
);
let poleLimit: "north" | "south" | null = null,
  poleLimitUntil = 0;
const previousWantedKeys = new Set<string>();
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
      : draggedFocus(focus, previous, current);
    const flat = lonLatToFlat(next.lon, next.lat);
    const latitude = focus.lat + previous.lat - current.lat;
    if (!parallel && Math.abs(latitude) > Math.PI / 2) {
      notePoleLimit(latitude > 0 ? "north" : "south");
      flat.z = latitude > 0 ? -POLE_DISTANCE : POLE_DISTANCE;
    }
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
    terrainMaterial!.emissiveMap = globe!.surface;
    terrainMaterial!.update();
    globePass++;
    if (globePass < GLOBE_PASSES.length) request();
    else {
      globeWorker!.terminate();
      globeWorker = undefined;
    }
  };
  globeWorker.onerror = (event) =>
    fail(`Globe worker could not start: ${event.message}`);
}
function globeCoverageReady() {
  return globePass >= GLOBE_PASSES.length && Boolean(globe?.surface);
}
function flatCoverageReady() {
  return wanted.length > 0 && wanted.every((tile) => tileCache.has(tile.key));
}
function destinationCoverageReady(flatReady = flatCoverageReady()) {
  return desiredProjectionTransition > 0 ? globeCoverageReady() : flatReady;
}
function applyPresentation() {
  if (!globe || !flatRoot || !terrainMaterial) return;
  const flatAmount = 1 - projectionTransition,
    shouldShowGlobe = projectionTransition > 0.001 || desiredProjectionTransition > 0;
  flatRoot.enabled = flatAmount > 0.001;
  globe.setVisible(shouldShowGlobe);
  globeShown = shouldShowGlobe;
  terrainMaterial.setParameter("flatCoverage", flatAmount);
  terrainMaterial.setParameter("surfaceTransition", projectionTransition);
  const focus = flatToLonLat(view.x, view.z);
  terrainMaterial.setParameter("surfaceFocus", [focus.lon, focus.lat]);
  terrainMaterial.update();
  if (globe?.entity) globe.entity.setLocalEulerAngles(0, 0, 0);
  document.body.classList.toggle("globe-mode", globeShown);
}
function setHalfHeight(height: number) {
  navigate(view.x, view.z, height);
}
function updateProjection() {
  const target = projectionTransitionForHalfHeight(view.halfHeight),
    was = projectionTransition;
  desiredProjectionTransition = target;
  if (desiredProjectionTransition > 0) prepareGlobe();
  const now = performance.now(),
    flatReady = flatCoverageReady(),
    destinationReady = destinationCoverageReady(flatReady),
    needsTransition =
      Math.abs(desiredProjectionTransition - projectionTransition) > 0.001;
  if (needsTransition && !handoffActive) {
    handoffActive = true;
    handoffDirection = desiredProjectionTransition > projectionTransition ? "globe" : "local";
    handoffRequestedAt = now;
    handoffPreparationStarted = now;
    handoffPreparationWaitMs = 0;
    handoffBlendDurationMs = 0;
    handoffWaitingForDestination = !destinationReady;
  }
  if (needsTransition && !destinationReady) {
    handoffWaitingForDestination = true;
    applyPresentation();
    return;
  }
  if (handoffWaitingForDestination) {
    handoffPreparationWaitMs += now - handoffPreparationStarted;
    handoffWaitingForDestination = false;
  }
  if (needsTransition) {
    const before = projectionTransition;
    projectionTransition = advanceProjectionTransition(
      projectionTransition,
      desiredProjectionTransition,
      1 / 60,
    );
    if (projectionTransition !== before)
      handoffBlendDurationMs += 1000 / 60;
  }
  if (
    handoffActive &&
    Math.abs(desiredProjectionTransition - projectionTransition) <= 0.001
  ) {
    projectionTransition = desiredProjectionTransition;
    handoffDurationMs = now - handoffRequestedAt;
    handoffActive = false;
    handoffDirection = "none";
  }
  if (projectionTransition !== was) selectionDirty = true;
  applyPresentation();
}
function notePoleLimit(side: "north" | "south") {
  poleLimit = side;
  poleLimitUntil = performance.now() + 1600;
  poleStopCount++;
}
function navigate(x: number, z: number, height = view.halfHeight) {
  view.halfHeight = Math.max(
    2,
    Math.min(
      PLANET_RADIUS * 4,
      height,
    ),
  );
  view.x = x;
  view.z = z;
  rebaseRenderFrame();
  selectionDirty = true;
  updateCamera();
}
function updateCamera() {
  const elevation = Math.max(0, heightAt(view.x, view.z)),
    pitch = Math.PI / 3,
    cameraHeight = view.halfHeight / Math.sin(pitch),
    distance = view.halfHeight / Math.tan(pitch);
  camera.setLocalPosition(
    0,
    PLANET_RADIUS + elevation + cameraHeight,
    distance,
  );
  camera.setLocalEulerAngles(60, 0, 0);
  camera.camera!.orthoHeight = view.halfHeight;
  camera.camera!.nearClip = Math.max(0.1, cameraHeight * 0.01);
  camera.camera!.farClip = PLANET_RADIUS * 8;
  applyPresentation();
}
function makeWorldMaterial() {
  const material = new pc.StandardMaterial();
  material.diffuse.set(0.88, 0.91, 0.84);
  material.useLighting = false;
  material.update();
  return material;
}
function flatCoverageMaterial() {
  if (!worldMaterial) worldMaterial = makeWorldMaterial();
  return worldMaterial;
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
  ctx.fillRect(39, 40, 8, 27);
  ctx.fillStyle = coats[variant % coats.length];
  ctx.fillRect(20, 33, 24, 38);
  ctx.fillStyle = "#cda774";
  ctx.beginPath();
  ctx.arc(32, 21, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a3827";
  ctx.fillRect(20, 8, 24, 11);
  const texture = new pc.Texture(app.graphicsDevice, {
    width: 64,
    height: 96,
    format: pc.PIXELFORMAT_R8_G8_B8_A8,
    mipmaps: false,
  });
  texture.setSource(image);
  const material = new pc.StandardMaterial();
  material.diffuseMap = texture;
  material.opacityMap = texture;
  material.alphaTest = 0.05;
  material.useLighting = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}
function setupControls() {
  const pointer = { down: false, x: 0, y: 0 };
  canvas.addEventListener("pointerdown", (event) => {
    pointer.down = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointer.down) return;
    panScreen(pointer.x, pointer.y, event.clientX, event.clientY);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  canvas.addEventListener("pointerup", (event) => {
    pointer.down = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const before = surfaceAtScreen(event.clientX, event.clientY);
    navigate(view.x, view.z, view.halfHeight * Math.exp(event.deltaY * 0.001));
    const after = surfaceAtScreen(event.clientX, event.clientY);
    if (before && after) {
      const focus = flatToLonLat(view.x, view.z),
        next = draggedFocus(focus, before, after),
        flat = lonLatToFlat(next.lon, next.lat);
      navigate(flat.x, flat.z);
    }
  }, { passive: false });
  let pinchDistance = 0;
  const touches = new Map<number, PointerEvent>();
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    touches.set(event.pointerId, event);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinchDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    touches.set(event.pointerId, event);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()],
        distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchDistance > 0) navigate(view.x, view.z, view.halfHeight * pinchDistance / distance);
      pinchDistance = distance;
    }
  });
  const clearTouch = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinchDistance = 0;
  };
  canvas.addEventListener("pointerup", clearTouch);
  canvas.addEventListener("pointercancel", clearTouch);
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (target.matches("input,select,textarea,button")) return;
    pressed.add(event.key.toLowerCase());
  });
  document.addEventListener("keyup", (event) => pressed.delete(event.key.toLowerCase()));
  $("overview").onclick = () => {
    view.yaw = 0;
    const wasGlobe = document.body.classList.contains("globe-mode");
    document.body.classList.add("globe-mode");
    globeFit = (PLANET_RADIUS * innerHeight) / (2 * freeRadius());
    document.body.classList.toggle("globe-mode", wasGlobe);
    navigate(view.x, view.z, Math.max(GLOBE_FROM, globeFit));
  };
  $("zoom-in").onclick = () => navigate(view.x, view.z, view.halfHeight / 1.4);
  $("zoom-out").onclick = () => navigate(view.x, view.z, view.halfHeight * 1.4);
  $<HTMLSelectElement>("map-scale").onchange = (event) => {
    const denominator = Number((event.target as HTMLSelectElement).value);
    navigate(view.x, view.z, halfHeightForCanonicalFootprint(CANONICAL_PLANET_DIAMETER * denominator / 10000));
  };
  $("compass").onclick = () => {
    view.yaw = 0;
    updateCamera();
  };
  $("rotate-left").onclick = () => {
    view.yaw -= Math.PI / 6;
    updateCamera();
  };
  $("rotate-right").onclick = () => {
    view.yaw += Math.PI / 6;
    updateCamera();
  };
  $("home").onclick = () => {
    const place = villages[0];
    navigate(place.x, place.z + 14, 97);
    simulation.setFocus(place);
  };
  $("open-travel").onclick = () => {
    $("travel-panel").hidden = false;
  };
  $("close-travel").onclick = () => {
    $("travel-panel").hidden = true;
  };
  $("region-country").onclick = () => {
    const country = countries.find((entry) => entry.code === simulation.activeCountry) ?? countries[0];
    navigate(country.x, country.z, 1800);
  };
  $("region-city").onclick = () => {
    const country = countries.find((entry) => entry.code === simulation.activeCountry) ?? countries[0];
    const place = cities.find((entry) => entry.country === country.id && entry.continent === country.continent) ?? cities[0];
    navigate(place.x, place.z, 450);
  };
  $("region-village").onclick = () => {
    const country = countries.find((entry) => entry.code === simulation.activeCountry) ?? countries[0];
    const place = villages.find((entry) => entry.country === country.id && entry.continent === country.continent) ?? villages[0];
    navigate(place.x, place.z, 97);
  };
}
function setupTravel() {
  const continent = $<HTMLSelectElement>("continent-select"),
    country = $<HTMLSelectElement>("country-select"),
    place = $<HTMLSelectElement>("village-select");
  continent.innerHTML = continents.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  const updateCountries = () => {
    const continentId = Number(continent.value);
    const available = countries.filter((item) => item.continent === continentId);
    country.innerHTML = available.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
    updatePlaces();
  };
  const updatePlaces = () => {
    const continentId = Number(continent.value), countryId = Number(country.value);
    const available = villages.filter((item) => item.continent === continentId && item.country === countryId);
    place.innerHTML = available.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  };
  continent.onchange = updateCountries;
  country.onchange = updatePlaces;
  $("travel-go").onclick = () => {
    const placeId = place.value;
    const target = villages.find((item) => item.id === placeId);
    if (!target) return;
    navigate(target.x, target.z + 14, 97);
    simulation.setFocus(target);
    $("travel-panel").hidden = true;
  };
  updateCountries();
}
function setupClickInspect() {
  const close = () => {
    $("cell-panel").hidden = true;
  };
  $("close-cell").onclick = close;
  canvas.addEventListener("click", (event) => {
    const coordinate = surfaceAtScreen(event.clientX, event.clientY);
    if (!coordinate) return;
    const point = lonLatToFlat(coordinate.lon, coordinate.lat),
      cell = cellAt(point.x, point.z),
      selected = tileAt(point.x, point.z),
      info = $("cell-info");
    selectedCode = canonicalCellId(coordinate, 12);
    info.textContent = `${selectedCode} · ${cell.biome} · ${selected.region} · ${Math.round(selected.elevation)} m`;
    $("cell-panel").hidden = false;
  });
}
function setupResize() {
  addEventListener("resize", () => {
    app.resizeCanvas();
    view.aspect = innerWidth / innerHeight;
    view.pixels = Math.min(innerHeight, 1000);
    streamingBudget = streamingBudgetForViewport(innerWidth, innerHeight);
    if (projectionTransition > 0.001)
      globeFit = (PLANET_RADIUS * innerHeight) / (2 * freeRadius());
    updateCamera();
  });
}
function setupWorker() {
  worker = new Worker(new URL("./tile-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    inFlight--;
    const payload = event.data as { tile: Tile; data: TileGeometry; precision: PatchConversionStats };
    if (!pending.delete(payload.tile.key)) return;
    uploads.push(payload);
  };
  worker.onerror = (event) => fail(`World worker could not start: ${event.message}`);
}
function queueTile(tile: Tile) {
  if (tileCache.has(tile.key) || pending.has(tile.key)) return;
  pending.add(tile.key);
  inFlight++;
  worker.postMessage(tile);
}
function refreshSelection() {
  wanted = selectTiles(view, 190, Math.floor(streamingBudget.activePatches / 2));
  const nextWantedKeys = new Set(wanted.map((tile) => tile.key));
  for (const tile of wanted)
    if (!previousWantedKeys.has(tile.key)) {
      if (tileCache.has(tile.key)) cacheHits++;
      else cacheMisses++;
      queueTile(tile);
    } else if (!tileCache.has(tile.key)) queueTile(tile);
  previousWantedKeys.clear();
  for (const key of nextWantedKeys) previousWantedKeys.add(key);
  selectionDirty = false;
}
function material() {
  if (!terrainMaterial) throw new Error("terrain material unavailable");
  return terrainMaterial;
}
function processStreaming(material: pc.StandardMaterial) {
  uploadsThisFrame = 0;
  while (uploads.length && uploadsThisFrame < streamingBudget.uploadsPerFrame) {
    const { tile, data, precision } = uploads.shift()!;
    pending.delete(tile.key);
    const old = tileCache.get(tile.key);
    if (old) {
      cachedGeometryBytes -= old.bytes;
      old.entity.destroy();
      tileCache.delete(tile.key);
    }
    const entity = new pc.Entity(`Terrain ${tile.key}`),
      meshes: pc.Mesh[] = [];
    entity.addComponent("render");
    const mesh = pc.createMesh(app.graphicsDevice, data.positions, {
      normals: data.normals,
      uvs: data.uvs,
      indices: data.indices,
      colors: data.colors,
    });
    const instance = new pc.MeshInstance(mesh, material);
    entity.render!.meshInstances = [instance];
    flatRoot.addChild(entity);
    applyTileRenderTransform(tile, entity);
    const bytes = estimateGeometryBytes(data);
    tileCache.set(tile.key, { tile, entity, meshes: [mesh], used: revision++, bytes });
    cachedGeometryBytes += bytes;
    detailedMaxHorizontalM = Math.max(detailedMaxHorizontalM, precision.maxHorizontalM);
    detailedMaxFloat32ErrorM = Math.max(detailedMaxFloat32ErrorM, precision.maxFloat32ErrorM);
    uploadsThisFrame++;
  }
  const complete = wanted.every((tile) => tileCache.has(tile.key));
  if (complete && !lodTransition) {
    const newKeys = wanted.map((t) => t.key),
      active = new Set(newKeys);
    if (ready && (newKeys.length !== activeKeys.length || newKeys.some(key => !activeKeys.includes(key))))
      lodTransition = { oldKeys: [...activeKeys], newKeys, started: performance.now() };
    const retained = new Set(lodTransition?.oldKeys ?? []);
    for (const [key, record] of tileCache) {
      record.entity.enabled = active.has(key) || retained.has(key);
      if (active.has(key)) record.used = revision;
    }
    activeKeys = newKeys;
    ready = true;
    $("loading").hidden = true;
  }
  if (lodTransition) {
    const transition = lodTransition;
    const progress = Math.min(1, (performance.now() - transition.started) / (LOD_BLEND_SECONDS * 1000));
    const t = progress * progress * (3 - 2 * progress);
    const incoming = new Set(transition.newKeys), outgoing = new Set(transition.oldKeys);
    for (const key of new Set([...incoming, ...outgoing])) {
      const record = tileCache.get(key);
      if (!record) continue;
      const instance = record.entity.render!.meshInstances[0];
      instance.setParameter("lodCoverage", incoming.has(key) && outgoing.has(key) ? 1 : incoming.has(key) ? t : -(1 - t));
      if (progress === 1) record.entity.enabled = incoming.has(key);
    }
    if (progress === 1) lodTransition = undefined;
  }
  const poleFeedback =
    poleLimit && performance.now() < poleLimitUntil
      ? ` · ${poleLimit === "north" ? "North" : "South"} pole limit`
      : "";
  $("tile-status").textContent =
    (projectionTransition >= 0.999
      ? `Globe · ${globePass < GLOBE_PASSES.length ? "refining" : "ready"}`
      : `Local · ${activeKeys.length} patches`) + poleFeedback;
}
async function start() {
  $("world-seed").textContent = WORLD_SEED;
  $("fantasy-time").textContent = clock.labelAt(Date.now());
  const device = await createRenderer(canvas);
  canvas = device.canvas as HTMLCanvasElement;
  device.on("devicelost", () => {
    rendererState.phase = "lost";
    rendererState.error = "The GPU connection was lost. Reload the page to restore rendering.";
    if (app) app.autoRender = false;
    fail(rendererState.error);
  });
  device.maxPixelRatio = Math.min(devicePixelRatio, 1.5);
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem];
  options.resourceHandlers = [];
  app = new pc.AppBase(canvas);
  app.init(options);
  camera = new pc.Entity("Camera");
  camera.addComponent("camera", {
    clearColor: FLAT_BACKDROP,
    projection: pc.PROJECTION_ORTHOGRAPHIC,
    orthoHeight: view.halfHeight,
  });
  app.root.addChild(camera);
  flatRoot = new pc.Entity("Flat world");
  app.root.addChild(flatRoot);
  globe = new GlobeView(app);
  terrainMaterial = createTerrainMaterial(globe.surface);
  globe.material = terrainMaterial;
  setupWorker();
  setupControls();
  setupTravel();
  setupClickInspect();
  setupResize();
  updateCamera();
  simulation.setFocus(villages[0]);
  simulation.advance(clock.tickAt(Date.now()));
  const characterMaterials = [0, 1, 2].map(characterMaterial);
  const actors: pc.Entity[] = [];
  let lastSimulationRealSecond = -1;
  const labelNodes = new Map<string, HTMLElement>();
  const labels = $("map-labels");
  let labelFingerprint = "";
  app.on("update", (dt) => {
    if (selectionDirty) refreshSelection();
    updateProjection();
    const now = Date.now(), realSecond = Math.floor(now / 1000);
    const simulationTick = clock.tickAt(now);
    if (realSecond !== lastSimulationRealSecond) {
      if (view.halfHeight < 900) simulation.setFocus(nearestPlace(view.x, view.z));
      simulation.advance(Math.max(simulation.tick, simulationTick));
      lastSimulationRealSecond = realSecond;
      $("fantasy-time").textContent = clock.labelAt(now);
      $("simulation-status").textContent =
        `${simulation.stats.residents} residents live in the focused country; ${simulation.stats.coarseCountries} countries tracked as summaries.`;
      const visible = view.halfHeight < 240
        ? simulation.focusedResidents(view.x, view.z, view.halfHeight * 1.5).slice(0, 96)
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
        actorSources.set(actors[i], { x: visible[i].x, z: visible[i].z });
        positionActor(actors[i], visible[i].x, visible[i].z);
        actors[i].enabled = true;
      }
      for (let i = visible.length; i < actors.length; i++) actors[i].enabled = false;
    }
    const labelFingerprintNext = `${Math.round(view.x / 2)}/${Math.round(view.z / 2)}/${Math.round(view.halfHeight)}/${Math.round(view.yaw * 100)}/${innerWidth}/${innerHeight}`;
    if (labelFingerprintNext !== labelFingerprint) {
      labelFingerprint = labelFingerprintNext;
      const anchors = placeLabels(view, innerWidth, innerHeight);
      labels.replaceChildren();
      labelState = anchors.map((anchor) => ({ id: anchor.id, anchor: { x: anchor.x, y: anchor.y }, rect: anchor.rect, leader: anchor.leader }));
      for (const anchor of anchors) {
        const node = document.createElement("div");
        node.className = "map-label";
        node.textContent = anchor.text;
        node.style.left = `${anchor.rect.x}px`;
        node.style.top = `${anchor.rect.y}px`;
        labels.append(node);
      }
    }
    if (!ready) return;
    const speed = innerHeight * Math.min(dt, 0.05) * 0.2;
    const dx = (pressed.has("d") || pressed.has("arrowright") ? 1 : 0) - (pressed.has("a") || pressed.has("arrowleft") ? 1 : 0);
    const dz = (pressed.has("s") || pressed.has("arrowdown") ? 1 : 0) - (pressed.has("w") || pressed.has("arrowup") ? 1 : 0);
    if (dx || dz)
      panScreen(innerWidth / 2, innerHeight / 2, innerWidth / 2 - dx * speed, innerHeight / 2 - dz * speed);
    if (pressed.has("q") || pressed.has("e")) {
      view.yaw += (pressed.has("e") ? 1 : -1) * dt * 0.7;
      updateCamera();
    }
    updateNavigationHud();
    const projectOverlay: RouteProjector = (point) => {
      point.height ??= Math.max(0, heightAt(point.x, point.z)) + 3;
      const local = renderFrame.sourceToRender(point.x, point.z, point.height);
      if (projectionTransition <= 0.001) {
        const screen = camera.camera!.worldToScreen(new pc.Vec3(local.x, point.height, local.z));
        return { x: screen.x, y: screen.y };
      }
      const focusRender = renderFrame.sourceToRender(view.x, view.z),
        focusY = Math.max(0, heightAt(view.x, view.z));
      flatLabelPoint.set(local.x - focusRender.x, PLANET_RADIUS + point.height - focusY, local.z - focusRender.z);
      const flatScreen = camera.camera!.worldToScreen(flatLabelPoint),
        onFront = globe!.worldPoint(point.lon, point.lat, globePoint);
      if ((!onFront || globe!.frontness(globePoint) < 0.08) && projectionTransition > 0.55) return undefined;
      if (!onFront) return { x: flatScreen.x, y: flatScreen.y };
      const globeScreen = camera.camera!.worldToScreen(globePoint), t = projectionTransition;
      return { x: flatScreen.x + (globeScreen.x - flatScreen.x) * t, y: flatScreen.y + (globeScreen.y - flatScreen.y) * t };
    };
    updateRouteOverlay(projectOverlay);
    updateContinuityOverlay(projectOverlay, flatToLonLat(view.x, view.z), { pending: inFlight, prepared: uploads.length, active: activeKeys.length, cached: tileCache.size });
    if (!errorText) processStreaming(material());
    if (layers.grid && !globeShown)
      for (const key of activeKeys) {
        const t = tileCache.get(key)!.tile;
        const corners = [[t.minX, t.minZ], [t.minX + t.size, t.minZ], [t.minX + t.size, t.minZ + t.size], [t.minX, t.minZ + t.size]];
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          app.drawLine(
            flatWorldPoint(a[0], a[1], Math.max(0, heightAt(a[0], a[1])) + 0.8),
            flatWorldPoint(b[0], b[1], Math.max(0, heightAt(b[0], b[1])) + 0.8),
            new pc.Color(0.91, 0.77, 0.42), true,
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
  Object.defineProperty(window, "advisorWorld", {
    value: {
      seed: WORLD_SEED,
      cellAt,
      cellSeed,
      geography: { continents, countries, cities, villages, roads },
      continuity: { inspect: inspectRegion, terrainQuery, telemetry: () => ({ ...continuityTelemetry(), worker: continuityWorkerState }), clearDetail: clearContinuityDetail, setOverlay: setContinuityOverlay },
      hydrology: { recipes: drainageRecipes, sampleSource: naturalSurfaceAt, toLonLat: sourceToLonLat, telemetry: hydrologyTelemetry },
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
      surface: {
        sample(lon: number, lat: number) {
          const point = lonLatToFlat(lon, lat), elevation = heightAt(point.x, point.z);
          return { ...climateSampleAt({lon, lat}, elevation), albedo: terrainTint(point.x, point.z, 32, elevation) };
        },
      },
      setHalfHeight(height: number) { navigate(view.x, view.z, height); },
      navigation: {
        surfaceAtScreen,
        setFocus(lon: number, lat: number) {
          if (lat > Math.PI / 2) notePoleLimit("north");
          else if (lat < -Math.PI / 2) notePoleLimit("south");
          const next = lonLatToFlat(lon, lat);
          navigate(next.x, next.z);
        },
        forceRebase() { rebaseRenderFrame(true); },
      },
      get state() {
        const flatReady = flatCoverageReady(),
          destinationReady = destinationCoverageReady(flatReady),
          activePreparationWaitMs = handoffWaitingForDestination
            ? handoffPreparationWaitMs + performance.now() - handoffPreparationStarted
            : handoffPreparationWaitMs,
          readyGeometryBytes = uploads.reduce((sum, upload) => sum + estimateGeometryBytes(upload.data), 0),
          surfaceBytes = globe?.surface ? globe.surface.width * globe.surface.height * 4 : 0,
          surfaceGpuBytes = surfaceBytes;
        return {
          ready,
          view: { ...view },
          presentation: projectionTransition >= 0.999 ? "globe" : projectionTransition <= 0.001 ? "flat" : "transition",
          navigation: {
            focus: flatToLonLat(view.x, view.z),
            ruler: { ...rulerState },
            labels: labelState,
            selectedCanonicalId: selectedCode || null,
            poleLimit: { side: poleLimit, active: Boolean(poleLimit && performance.now() < poleLimitUntil), stops: poleStopCount },
          },
          renderFrame: {
            origin: renderFrame.canonicalOrigin,
            rebases: renderFrame.stats.rebases,
            maxHorizontalM: renderFrame.stats.maxHorizontalM,
            maxFloat32ErrorM: renderFrame.stats.maxFloat32ErrorM,
          },
          handoff: {
            projectionTransition,
            desiredTransition: desiredProjectionTransition,
            active: handoffActive,
            direction: handoffDirection,
            durationMs: handoffActive ? performance.now() - handoffRequestedAt : handoffDurationMs,
            preparationWaitMs: activePreparationWaitMs,
            blendDurationMs: handoffBlendDurationMs,
            waitingForDestination: handoffWaitingForDestination,
            destinationReady,
          },
          globe: globe ? { passes: globePass, complete: globeCoverageReady(), fit: globeFit, ...globe.stats } : null,
          performance: {
            backend: device.deviceType,
            deviceClass: streamingBudget.deviceClass,
            budget: { ...streamingBudget },
            activePatches: [...tileCache.values()].filter(record => record.entity.enabled).length,
            preparedPatches: uploads.length,
            cachedPatches: tileCache.size,
            pendingGeneration: inFlight,
            readyUploads: uploads.length,
            generationReady: inFlight + uploads.length,
            cacheHits,
            cacheMisses,
            evictions,
            cpuBytes: cachedGeometryBytes + readyGeometryBytes + surfaceBytes,
            gpuBytes: cachedGeometryBytes + surfaceGpuBytes,
            surfaceBytes,
            cachedGeometryBytes,
            uploadLimit: streamingBudget.uploadsPerFrame,
            uploadsThisFrame,
            maxUploadsPerFrame,
            wantedCanonicalKeys: wanted.map((tile) => tile.key),
            poleStops: poleStopCount,
            withinBudget: withinStreamingBudget(
              {
                generationReady: inFlight + uploads.length,
                activePatches: [...tileCache.values()].filter(record => record.entity.enabled).length,
                cachedPatches: tileCache.size,
                cpuBytes: cachedGeometryBytes + readyGeometryBytes + surfaceBytes,
                gpuBytes: cachedGeometryBytes + surfaceGpuBytes,
              }, streamingBudget,
            ),
            slowFrames: slowFrameCount,
            droppedFrames: droppedFrameCount,
            detailedMaxHorizontalM,
            detailedMaxFloat32ErrorM,
          },
        };
      },
    },
  });
  app.start();
}

let statsElapsed = 0, frames = 0, fps = 0;
start().catch((error) => fail(error instanceof Error ? error.message : String(error)));
