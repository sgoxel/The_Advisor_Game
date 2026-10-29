import { ResidentQueryQueue, mergeResidentQueries, currentResidentSnapshot, residentDispatchAllowed, residentColdQueryCanStart, residentActorSnapshotMayMarkPresented, residentWorkerShardPlan, terrainWorkerIndexAvoidingWarmResident, residentActorPickDistance, residentMotionFraction, selectedResidentVisibleInView, residentLabelRightOfActor, ownedDoorLabelClearOfResident, residentQueryLimitForView, activeResidentWorkers, type ResidentQuery, type ResidentQueryJob, type ResidentQueryResult } from "./resident-query.ts";
import { TIME_SCALE } from "./clock.ts";
import { createWildernessOverlay } from "./wilderness-overlay.ts";
import { nearbyWilderness } from "./wilderness.ts";
import { compareText } from "./compare-text.ts";
import {SETTLEMENT_ICON_FROM_SCALE, settlementSmallDetailsVisible} from "./political-presentation.ts";
import {closeLightingEnabled, closeLightingWeight, eveningLightWeight} from "./street-lighting.ts";
import {coverageKey, tileJobKey, nextStreamingJob, progressiveDetailKeys, visibleCoverageKeys, type TileJobKind} from "./streaming-coverage.ts";
import {elevationToRenderY, visibleSurfaceElevation} from "./render-frame.ts";
import * as pc from "playcanvas";
import { loadDefaultCharacter, DEFAULT_CHARACTER_HEIGHT_M } from "./default-character.ts";
import { CHARACTER_TYPES, characterHeightM } from "./characters.ts";
import { metresToSource } from "./physical-scale.ts";
import { nearbyCriticalSites } from "./sites.ts";
import { settlementHomeFor } from "./settlement-exterior.ts";
import { daylightAt, daylightAtLongitude, advanceDaylight, type Daylight } from "./daylight.ts";
import { clockLabel, localSecondOfDay, timeZoneOffsetHours } from "./clock.ts";
import { hideNpcPopup, npcPopupCode, setPopupNavigator, setSiteVisitAdvisor, popupFocusHalfHeight, popupOwnedHomeFacing, showBuildingPopup, showNpcPopup, showSettlementPopup, showWildernessPopup, type BuildingInfo } from "./npc-popup.ts";
import type { Resident } from "./simulation.ts";
import { wrapSourceX } from "./planet.ts";
import "./style.css";
import {
  WORLD_SEED,
  WORLD_SIZE,
  cellAt,
  cellSeed,
  heightAt,
  finalSurfaceAt,
  resolvedSettlementHomeDoorFor,
  finalSurfaceEvidenceAnchors,
  selectTiles,
  featuresFor,
  tileForPosition,
  cameraElevationForHalfHeight,
  viewBounds,
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
  places,
  roads,
  macroPopulationSummary,
  roadJunctions, roadConnections, roadNetworkTelemetry,
} from "./geography.ts";
import type { Geometry, TileGeometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { macroLakes, mountainSystems } from "./macro-geography.ts";
import { climateSampleAt } from "./climate.ts";
import { drainageRecipes, hydrologyTelemetry, hydrologyTopology, freshwaterAccessAt, naturalSurfaceAt } from "./hydrology.ts";
import { forestBodiesVisibleAtScale, roadRepresentationAtScale, roadVisibleAtScale, LOD_BLEND_SECONDS, SURFACE_PRESENTATION, createTerrainMaterial, installLodCoverage, installLitSurfaceDetail, localDetailWeight } from "./surface-presentation.ts";
import { LazySimulation, populationOf, residentOccupiesBuilding, residentInsideRenderedService, residentViewQuery, residentOrderFor } from "./simulation.ts";
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
  CANONICAL_METRES_PER_SOURCE_UNIT,
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
  MIN_HALF_HEIGHT, HERO_HALF_HEIGHT,
  scaleValueForHalfHeight,
  scaleOptionLabel,
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
  withinStreamingBudget,
  shouldTrimStreamingCache,
  streamingMemoryReservationFits,
  canPrefetchStreamingJob,
  generationWorkerCount,
  streamingBudgetForPool,
  UPLOAD_FRAME_BUDGET_MS,
  type StreamingBudget,
} from "./streaming.ts";
import { nextPixelRatio, RESOLUTION_DECISION_SECONDS } from "./render-resolution.ts";
import { BoundedTimingSamples, ResidentQueryPhaseSamples, TileWorkerPhaseSamples } from "./streaming-metrics.ts";

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
/** Backdrop behind the flat map, recoloured by local daylight (see applyDaylight). */
const flatBackdrop = FLAT_BACKDROP.clone();
let continuityWorkerBytes = 0;
const NATURAL_WORKER_SCRATCH_RESERVE_BYTES=32*1024*1024;
let continuityWorkerState: ReturnType<typeof continuityTelemetry> | undefined;
let discardedPresentationJobs = 0;
const continuityCpuBytes = () => {
  const state=continuityTelemetry(), preparingBytes=globeWorker ? state.coarseRegistryBytesEstimated + state.hydrologyCpuBytesEstimated + 4096*1024 + (GLOBE_PASSES[globePass]?.width || 0)**2*2 : 0;
  const atlasBytes=(window as unknown as {politicalAtlas?:{state:{presentationBytesEstimated?:number}}}).politicalAtlas?.state.presentationBytesEstimated||0;
  return atlasBytes + continuityWorkerBytes + inFlight * NATURAL_WORKER_SCRATCH_RESERVE_BYTES + state.cpuBytesEstimated + continuityOverlayBytes() + preparingBytes;
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let canvas = $<HTMLCanvasElement>("world");
const view: View = {
  x: villages[0].x,
  z: villages[0].z + metresToSource(6),
  halfHeight: HERO_HALF_HEIGHT,
  // A hidden or minimised page can report a 0x0 viewport; 0/0 would poison every projection.
  aspect: innerWidth > 0 && innerHeight > 0 ? innerWidth / innerHeight : 16 / 9,
  yaw: -0.22,
  pixels: Math.max(1, innerHeight),
};
// Presentation-only inspection angle; changing it never changes the canonical view or SEED.
let bridgeInspectionAngle = false;
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
  flatLabelPoint = new pc.Vec3(),
  transportGroundPoint = new pc.Vec3();
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
let nightGlowMaterial: pc.StandardMaterial | undefined, lampPoolMaterial: pc.StandardMaterial | undefined;
const GLOW_VISIBILITY_EPSILON = 1e-4;
let eveningGlow = 0;
let displayedDaylight:Daylight|undefined, targetDaylight:Daylight|undefined;
const daylightTintUniform = new Float32Array([1,1,1]);
/** Direction towards the sun (world space) for the terrain's procedural relief shading. */
const sunDirUniform = new Float32Array([0.4,0.8,0.45]);
/** The sun's light (set at start-up) so the camera can fit its shadow range to the view. */
let sunLight: pc.LightComponent | undefined;
let terrainMaterial: pc.StandardMaterial | undefined;
let coarseTerrainMaterial: pc.StandardMaterial | undefined;
let coarseTerrainLayer: pc.Layer, coverageTerrainLayer: pc.Layer;
let coverageTiles: Tile[] = [], coverageComplete = false, coverageStartedAt = 0, coverageDurationMs = 0;
let loadPercent = 0;
const LOAD_MESSAGES = ["Reading the land from its seed…", "Raising mountains…", "Filling the rivers…", "Paving the roads…", "Building the villages…", "Polishing the castle…", "Waking the advisors…"];
/** Monotonic, honest progress: worker start is 15 %, the rest is the share of terrain tiles prepared. */
function setLoadingProgress(percent: number) {
  const next = Math.max(loadPercent, Math.min(100, Math.round(percent)));
  if (next === loadPercent && next !== 0) return;
  loadPercent = next;
  const bar = $("loading-bar");
  $("loading-fill").style.width = `${next}%`;
  $("loading-percent").textContent = `${next}%`;
  bar.setAttribute("aria-valuenow", String(next));
  $("loading-text").textContent = LOAD_MESSAGES[Math.min(LOAD_MESSAGES.length - 1, Math.floor(next / (100 / LOAD_MESSAGES.length)))];
}
let workerStartedAt = 0, workerStartupMs = 0, lastGenerationTiming: Record<string,number> = {};
// Fixed-size performance samples; percentile sorting occurs only in the on-demand state getter.
const frameIntervalSamples = new BoundedTimingSamples();
const cpuUpdateSamples = new BoundedTimingSamples();
// Observable CPU frame work and input callbacks, never inputs to SEED/Simulation.
const cpuFrameSamples = new BoundedTimingSamples();
const engineCpuUpdateSamples = new BoundedTimingSamples();
const cpuRenderSamples = new BoundedTimingSamples();
const inputHandlerSamples = new BoundedTimingSamples();
const drawCallSamples = new BoundedTimingSamples();
const gpuFrameSamples = new BoundedTimingSamples();
let rendererLossCount = 0;
const measureInput = <T extends Event>(handler: (event: T) => void) => (event: T) => {
  const started = performance.now();
  try { handler(event); }
  finally { inputHandlerSamples.record(performance.now() - started); }
};
const workerGenerationSamples = new BoundedTimingSamples();
const workerPhaseSamples = new TileWorkerPhaseSamples();
const uploadSamples = new BoundedTimingSamples();
const residentPhaseTimings = new ResidentQueryPhaseSamples();
const residentPickSamples = new BoundedTimingSamples();
let firstResidentQueryOfferedAt: number | null = null;
let firstResidentFactMs: number | null = null;
let firstCoherentTerrainSinceWorkersMs: number | null = null;
let firstResidentOfferSinceWorkersMs: number | null = null;
let firstResidentDispatchSinceWorkersMs: number | null = null;
let maxGenerationReadyObserved = 0;
let surfaceDetail = 1;
let lodTransition: { oldKeys: string[]; newKeys: string[]; started: number } | undefined;
type CachedTile = {
  kind: TileJobKind;
  tile: Tile;
  entity: pc.Entity;
  meshes: pc.Mesh[];
  used: number;
  bytes: number;
  serial: number;
};
const tileCache = new Map<string, CachedTile>();
let revision = 0,
  inFlight = 0,
  selectionDirty = true,
  cacheHits = 0,
  cacheMisses = 0,
  evictions = 0,
  cachedGeometryBytes = 0,
  meshGroupUploads = 0, detailGenerationJobs = 0, coverageGenerationJobs = 0,
  uploadsThisFrame = 0,
  maxUploadsPerFrame = 0,
  poleStopCount = 0;
/** Tile-generation worker pool size: one worker per spare core (see generationWorkerCount). */
const deviceMemoryGB = (navigator as { deviceMemory?: number }).deviceMemory;
const generationWorkers = generationWorkerCount(navigator.hardwareConcurrency, deviceMemoryGB);
let streamingBudget: StreamingBudget = streamingBudgetForPool(innerWidth, innerHeight, generationWorkers, deviceMemoryGB);
let poleLimit: "north" | "south" | null = null,
  poleLimitUntil = 0;
const previousWantedKeys = new Set<string>();
const pending = new Set<string>();
// Screenshot-tool-only: keep game/Simulation rendering live while deferring
// background GPU buffer churn during a bounded real WebGPU readback.
let captureStreamingQuiesced = false;
const uploads: {
  kind: TileJobKind;
  jobKey: string;
  tile: Tile;
  data: TileGeometry;
  precision: PatchConversionStats;
}[] = [];
/** Tile-generation worker pool: one worker per spare core (see generationWorkerCount). */
const residentQueries = new ResidentQueryQueue(TIME_SCALE * 2, TIME_SCALE);
const residentOrder = new Map(places.map(place => [place.id, residentOrderFor(place)]));
// Resident index construction is cold and expensive: reuse its owning worker.
const warmedResidentWorkers = new Set<number>();
let residentResultReady = () => {};
function residentRequestForView(tick: number, limit: number, actors: boolean): ResidentQuery | undefined {
  const place = nearestPlace(view.x, view.z);
  if (!place) return;
  const bounds = viewBounds(view), lonScale = Math.max(.02, Math.abs(Math.cos(flatToLonLat(view.x, view.z).lat))),
    radius = Math.hypot(bounds.rx / lonScale, bounds.rz) * 1.1,
    key = `${place.code}|${view.x}|${view.z}|${radius}|${limit}|${actors}`;
  return { key, placeCode: place.code, x: view.x, z: view.z, radius, limit, tick, actors };
}
function offerResidentQuery(query: ResidentQuery) {
  const now = performance.now();
  if (firstResidentQueryOfferedAt === null) firstResidentQueryOfferedAt = now;
  if (firstResidentOfferSinceWorkersMs === null) firstResidentOfferSinceWorkersMs = now - workerStartedAt;
  residentPhaseTimings.offer(query.key, now);
  residentQueries.offer(query);
}
type ResidentBatch = {
  job: ResidentQueryJob; unsent: Set<number>; assignments: Map<number, number>;
  results: ResidentQueryResult[]; completed: Set<number>; count: number;
};
const residentBatches = new Map<number, ResidentBatch>();
/** Tiles, ready uploads and active resident shards share the same device admission. */
const residentRunningWorkers = () => activeResidentWorkers(residentBatches.values());
const generationReadyInUse = () => inFlight + uploads.length + residentRunningWorkers();
function dispatchResidentQuery() {
  // One resident worker may overlap an already-running mandatory terrain job.
  // Without an active terrain worker, preserve the original spare-worker/slot
  // reservation. Only one pre-ready resident batch can run at a time; actor
  // facts are never shown before coherent terrain or used as world authority.
  const early = !ready && residentBatches.size === 0 && residentColdQueryCanStart(
    selectionDirty, view.halfHeight, idleWorkers.length,
    generationReadyInUse(), generationLimit(), inFlight);
  if (!residentDispatchAllowed(selectionDirty, ready, idleWorkers.length, residentBatches.size > 0) && !early) return;
  if (!selectionDirty && (ready || early)) {
    const available = early ? 1 : generationLimit() - generationReadyInUse();
    if (available > 0) {
      const job = residentQueries.take(true);
      if (job) {
        const selected = residentWorkerShardPlan(
          idleWorkers.map(worker => workers.indexOf(worker)), warmedResidentWorkers, !!job.actors,
        ).slice(0, available);
        const shards = selected.map((shard, shardIndex) => ({ workerId: shard.workerId, shardIndex }));
        const count = shards.length, now = performance.now();
        if (firstResidentDispatchSinceWorkersMs === null) firstResidentDispatchSinceWorkersMs = now - workerStartedAt;
        residentPhaseTimings.dispatch(job.id, job.key, now);
        residentBatches.set(job.id, { job, count,
          unsent: new Set(shards.map(shard => shard.workerId)),
          assignments: new Map(shards.map(shard => [shard.workerId, shard.shardIndex])),
          results: [], completed: new Set() });
      }
    }
  }
  // Late obsolete responses cannot become visible; newer unsent shards
  // take priority without interrupting an occupied worker.
  for (let index = idleWorkers.length - 1; index >= 0; index--) {
    const worker = idleWorkers[index], workerId = workers.indexOf(worker);
    let batch: ResidentBatch | undefined;
    for (const candidate of residentBatches.values())
      if (candidate.unsent.has(workerId)) batch = candidate;
    if (!batch) continue;
    batch.unsent.delete(workerId);
    idleWorkers.splice(index, 1);
    // Explicit capture URL only; ordinary play never runs route-probe counters.
    worker.postMessage({ ...batch.job,
      routeProbes: new URLSearchParams(window.location.search).has("resident-route-probes"),
      mainSentEpochMs: performance.timeOrigin + performance.now(), shard: {
      index: batch.assignments.get(workerId)!, count: batch.count,
    } });
  }
  maxGenerationReadyObserved = Math.max(maxGenerationReadyObserved, generationReadyInUse());
}
const workers: Worker[] = [], idleWorkers: Worker[] = [], continuityBytesByWorker = new Map<Worker, number>();
let readyWorkers = 0;
/** Shared device-class admission for tile generation + meshes awaiting upload. */
const generationLimit = () => streamingBudget.generationReady;
const layers = { structures: true, nature: true, grid: false };
let settlementDetailVisible = scaleValueForHalfHeight(view.halfHeight) < SETTLEMENT_ICON_FROM_SCALE;
let smallDetailsVisible = settlementSmallDetailsVisible(scaleValueForHalfHeight(view.halfHeight));
let forestBodiesVisible = forestBodiesVisibleAtScale(scaleValueForHalfHeight(view.halfHeight));
let closeLightingVisible = closeLightingEnabled(scaleValueForHalfHeight(view.halfHeight));
const pressed = new Set<string>();
const simulation = new LazySimulation();
const clock = new FantasyClock();
const actorSources = new Map<pc.Entity, { x: number; z: number }>();
/** Resident drawn by each actor, for click picking. */
const actorResidents = new Map<pc.Entity, Resident>();
/** Walking actors: positions at this and the next simulation second, animated per frame. */
const actorMotion = new Map<pc.Entity, { points: { x: number; z: number }[]; lengths: number[]; total: number; startTick: number }>();
/** Set once the renderer exists: the resident whose sprite is under a screen point, if any. */
let pickResidentAt: ((clientX: number, clientY: number) => Resident | undefined) | undefined;
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
  const point = renderFrame.sourceToRender(x, z, finalSurfaceAt(x, z).surfaceHeight);
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
    focusY = elevationToRenderY(Math.max(0, heightAt(view.x, view.z)));
  return new pc.Vec3(
    point.x - focus.x,
    PLANET_RADIUS + point.y - focusY,
    point.z - focus.z,
  );
}

/** S005 road inspector uses the same camera and final-surface elevation as world meshes. */
function projectTransportGround(x: number, z: number) {
  const surface = finalSurfaceAt(x, z),
    point = renderFrame.sourceToRender(x, z, Math.max(0, surface.surfaceHeight) + 0.5);
  transportGroundPoint.set(point.x, point.y, point.z);
  const screen = camera.camera!.worldToScreen(transportGroundPoint);
  return { x: screen.x, y: screen.y };
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
      : elevationToRenderY(Math.max(0, heightAt(view.x, view.z)));
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
  // North's screen direction comes from the shared camera attitude. Inferring
  // it from geographic pick deltas introduces projection-dependent zoom drift.
  const screenHeading = -view.yaw || 0;
  $("compass").title =
    `Heading ${(((((screenHeading * 180) / Math.PI) % 360) + 360) % 360).toFixed(0)}° · reset north`;
  $<HTMLSelectElement>("map-scale").value = String(scaleValueForHalfHeight(view.halfHeight));
  const anchor = (CANONICAL_PLANET_DIAMETER * scaleValueForHalfHeight(view.halfHeight)) / 10000;
  const approximate =
    Math.abs(canonicalFootprintForHalfHeight(view.halfHeight) / anchor - 1) >
    0.001;
  for (const option of Array.from($<HTMLSelectElement>("map-scale").options))
    option.textContent = `${scaleOptionLabel(Number(option.value))}${approximate && option.selected ? " ≈" : ""}`;
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
    terrainMaterial!.emissiveMap = globe!.surface;
    terrainMaterial!.update();
    coarseTerrainMaterial!.emissiveMap = globe!.surface;
    coarseTerrainMaterial!.update();
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
    (wanted.every((tile) => tileCache.has(tile.key)) || coverageComplete)
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
    // The actual rendered ground/bridge/settlement pad owns camera elevation;
    // raw noise height can clip the entire authoritative 3D close-up.
    targetY = elevationToRenderY(Math.max(0, visibleSurfaceElevation(finalSurfaceAt(view.x, view.z)))),
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
    camera.camera!.nearClip = 0.1;
    $("cell-panel").hidden = true;
  } else {
    flatRoot.setLocalPosition(0, 0, 0);
    flatRoot.enabled = true;
    globe.setVisible(false);
    globe.setBlend(0);
    const distance = view.halfHeight * 2.2 + 200;
    // RPG close-up: the camera lowers from a 60° map view to 34° at character zoom, so upright
    // people and buildings keep true relative proportions and painted characters read as drawn.
    const elevationAngle = bridgeInspectionAngle ? Math.PI / 6 : cameraElevationForHalfHeight(view.halfHeight);
    const horizontal = distance * Math.cos(elevationAngle);
    camera.setPosition(
      focusRender.x + Math.sin(view.yaw) * horizontal,
      targetY + distance * Math.sin(elevationAngle),
      focusRender.z + Math.cos(view.yaw) * horizontal,
    );
    camera.lookAt(focusRender.x, targetY, focusRender.z);
    camera.camera!.orthoHeight = view.halfHeight;
    // Orthographic depth precision depends on the whole clip range. Keeping the
    // realm-sized range at Street scale quantizes distinct seabed/water surfaces
    // into the same depth on WebGL2. Bound it to the visible local footprint plus
    // camera distance and generous terrain/model clearance; globe owns its lens.
    camera.camera!.farClip = Math.max(512, distance +
      2 * view.halfHeight * Math.hypot(1, camera.camera!.aspectRatio) + 128);
    // The ~200-unit orthographic camera can look across steep settlement pads,
    // roofs and river decks. A near plane just 4–19 units before its focus
    // can clip every world mesh even while real tiles are ready and clickable.
    // Orthographic depth precision is linear; use a full foreground range.
    const below = 2 + view.halfHeight * 4;
    camera.camera!.nearClip = 0.1;
    if (sunLight) sunLight.shadowDistance = Math.min(420, distance + below);
  }
  for (const material of [worldMaterial, terrainMaterial, coarseTerrainMaterial, nightGlowMaterial, lampPoolMaterial]) if (material) {
    // Replace terrain pixels rather than stacking translucent skirts over the
    // globe. One retained surface owns each pixel throughout the handoff.
    material.setParameter("flatCoverage", material === terrainMaterial || material === coarseTerrainMaterial ? 1 : 1 - projectionTransition);
  }
  const backdrop = globe.backdropColor,
    t = projectionTransition;
  const surfaceOrigin = renderFrame.canonicalOrigin;
  const surfaceFocus = flatToLonLat(view.x, view.z);
  for (const material of [terrainMaterial, coarseTerrainMaterial]) {
    material?.setParameter("surfaceOrigin", [surfaceOrigin.lon, surfaceOrigin.lat]);
    material?.setParameter("surfaceOffset", [flatRoot.getLocalPosition().x, flatRoot.getLocalPosition().y, flatRoot.getLocalPosition().z]);
    material?.setParameter("surfaceProjectionWeight", 1 - localDetailWeight(view.halfHeight));
    material?.setParameter("surfaceFocus", [surfaceFocus.lon, surfaceFocus.lat]);
    material?.setParameter("surfaceTransition", projectionTransition);
  }
  camera.camera!.clearColor.set(
    flatBackdrop.r + (backdrop.r - flatBackdrop.r) * t,
    flatBackdrop.g + (backdrop.g - flatBackdrop.g) * t,
    flatBackdrop.b + (backdrop.b - flatBackdrop.b) * t,
    1,
  );
}
function updateCamera() {
  const roadRepresentation=roadRepresentationAtScale(scaleValueForHalfHeight(view.halfHeight)),showRoads=roadRepresentation==='ground';
  document.body.dataset.roadRepresentation=roadRepresentation;
  terrainMaterial?.setParameter("surfaceRoadVisibility",showRoads?1:0);
  coarseTerrainMaterial?.setParameter("surfaceRoadVisibility",showRoads?1:0);
  const showDetails = scaleValueForHalfHeight(view.halfHeight) < SETTLEMENT_ICON_FROM_SCALE;
  document.body.classList.toggle("settlement-overview", !showDetails);
  const showSmallDetails = settlementSmallDetailsVisible(scaleValueForHalfHeight(view.halfHeight));
  const showLighting = closeLightingEnabled(scaleValueForHalfHeight(view.halfHeight));
  const showForestBodies = forestBodiesVisibleAtScale(scaleValueForHalfHeight(view.halfHeight));
  if (showDetails !== settlementDetailVisible || showLighting !== closeLightingVisible || showSmallDetails !== smallDetailsVisible || showForestBodies !== forestBodiesVisible) {
    settlementDetailVisible = showDetails;
    smallDetailsVisible = showSmallDetails;
    closeLightingVisible = showLighting;
    forestBodiesVisible = showForestBodies;
    setLayers();
  }
  selectionDirty = true;
  desiredProjectionTransition = projectionTransitionForHalfHeight(
    view.halfHeight,
  );
  if (desiredProjectionTransition > 0) prepareGlobe();
  applyPresentation();
}
function updateHandoff(dt: number) {
  const desiredDetail = globeCoverageReady() ? localDetailWeight(view.halfHeight) : 1;
  surfaceDetail += (desiredDetail - surfaceDetail) * (1 - Math.exp(-Math.max(0, dt) / 0.16));
  if (Math.abs(surfaceDetail - desiredDetail) < 0.001) surfaceDetail = desiredDetail;
  terrainMaterial?.setParameter("surfaceDetailWeight", surfaceDetail);
  coarseTerrainMaterial?.setParameter("surfaceDetailWeight", surfaceDetail);
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
function notePoleLimit(side: "north" | "south") {
  poleLimit = side;
  poleLimitUntil = performance.now() + 1600;
  poleStopCount++;
}
function navigate(x: number, z: number, height = view.halfHeight) {
  view.halfHeight = Math.max(
    MIN_HALF_HEIGHT,
    Math.min(Math.max(GLOBE_FROM, globeFit) * 1.3, height),
  );
  const boundedZ = Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, z));
  if (boundedZ !== z) notePoleLimit(z < -POLE_DISTANCE ? "north" : "south");
  view.x = wrapX(x);
  view.z = boundedZ;
  rebaseRenderFrame();
  // Leaving Province level means the globe may be needed soon.
  if (view.halfHeight >= 230) prepareGlobe();
  updateCamera();
}
function uploadGeometry(
  g: Geometry,
  parent: pc.Entity,
  name: string,
  material: pc.StandardMaterial,
  coverage = false,
): pc.Mesh | undefined {
  if (g.positions.length === 0) return;
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(g.positions);
  mesh.setNormals(g.normals);
  mesh.setColors32(g.colors);
  if (g.uvs) mesh.setUvs(0, g.uvs);
  mesh.setIndices(g.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const entity = new pc.Entity(name);
  entity.addComponent("render", {
    meshInstances: [new pc.MeshInstance(mesh, material)],
    layers: coverage ? [coverageTerrainLayer.id] : material === coarseTerrainMaterial ? [coarseTerrainLayer.id] : [pc.LAYERID_WORLD],
    // Close-up props (yard objects, Blender models, furniture) cast shadows too: they only exist at
    // Hero/Close zoom, where the shadow range is fitted tightly around the view (updateCamera).
    castShadows: name !== "terrain" && !["nightGlow", "lampPools"].includes(name),
    receiveShadows: true,
  });
  parent.addChild(entity);
  entity.enabled = tileLayerVisible(name);
  return mesh;
}
function tileLayerVisible(name:string):boolean {
  if (name === "terrain") return true;
  if (name === "nature") return layers.nature && forestBodiesVisible;
  if (name === "streetTrees") return layers.nature && layers.structures && settlementDetailVisible && smallDetailsVisible && forestBodiesVisible;
  if (name === "detail") return layers.structures && layers.nature && settlementDetailVisible && smallDetailsVisible;
  // Physical close-up objects remain present regardless of the lighting tier.
  if (name === "closeDetail")
    return layers.structures && settlementDetailVisible && smallDetailsVisible;
  if (name === "nightGlow" || name === "lampPools")
    return layers.structures && settlementDetailVisible && smallDetailsVisible && closeLightingVisible && eveningGlow > GLOW_VISIBILITY_EPSILON;
  return layers.structures && settlementDetailVisible && (name === "structures" || layers.nature);
}
function setLayers() {
  for (const { entity } of tileCache.values())
    for (const child of entity.children as pc.Entity[]) child.enabled = tileLayerVisible(child.name);
}
/**
 * Background prefetch: once everything on screen is loaded, the idle worker keeps generating
 * what the player is likely to need next, nearest first — two same-detail rings around the
 * view, then the views of the nearest towns and ruins/shrines. It stops at 85% of the cache
 * trim threshold so prefetching never forces anything already cached out.
 */
let prefetchQueue: Tile[] = [], prefetchFingerprint = "", prefetched = 0;
// Idle-only scene warming must yield to playable current-view rendering.
// Measured frame cadence is presentation scheduling, never SEED/Simulation truth.
let measuredStreamingFps = 0;
function prefetchCandidates(): Tile[] {
  const seen = new Set<string>(), out: { tile: Tile; distance: number }[] = [],
    push = (tile: Tile | undefined, weight = 1) => {
      if (!tile || seen.has(tile.key)) return;
      seen.add(tile.key);
      out.push({ tile, distance: Math.hypot(wrapSourceX(tile.minX + tile.size / 2 - view.x), tile.minZ + tile.size / 2 - view.z) * weight });
    };
  const at = (level: number, x: number, z: number) => {
    const count = 2 ** level;
    try { return tileAt(level, ((x % count) + count) % count, z); } catch { return undefined; }
  };
  for (const tile of wanted) for (let ring = 1; ring <= 2; ring++)
    for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++)
      if (Math.max(Math.abs(dx), Math.abs(dz)) === ring) push(at(tile.level, tile.x + dx, tile.z + dz));
  // Nearby destinations the player can jump to from the town and site cards.
  const near = (x: number, z: number) => Math.hypot(wrapSourceX(x - view.x), z - view.z);
  const destinations = [
    ...places.filter((place) => near(place.x, place.z) < metresToSource(25_000)).sort((a, b) => near(a.x, a.z) - near(b.x, b.z)).slice(0, 4)
      .map((place) => ({ x: place.x, z: place.z, halfHeight: place.kind === "city" ? 60 : 25 })),
    ...nearbyCriticalSites(view.x, view.z, metresToSource(30_000), 2).map((site) => ({ x: site.x, z: site.z, halfHeight: 25 })),
  ];
  for (const destination of destinations)
    for (const tile of selectTiles({ ...view, x: destination.x, z: destination.z, halfHeight: Math.min(view.halfHeight, destination.halfHeight) }, 190, 6)) push(tile, 1.5);
  return out.sort((a, b) => a.distance - b.distance).map((entry) => entry.tile).slice(0, 96);
}
function prefetchNext(root: Tile) {
  void root;
  const fingerprint = `${wanted.map((tile) => tile.key).join(",")}|${Math.round(view.x)}|${Math.round(view.z)}`;
  if (fingerprint !== prefetchFingerprint) { prefetchFingerprint = fingerprint; prefetchQueue = prefetchCandidates(); warmSettlements(); }
  const surfaceBytes = globe ? globe.stats.textureWidth * globe.stats.textureHeight * 4 : 0;
  if (2 * cachedGeometryBytes + surfaceBytes + Math.ceil(surfaceBytes * 4 / 3) + continuityCpuBytes() > streamingBudget.cacheTrimStartBytes * .85) return;
  while (prefetchQueue.length) {
    const tile = prefetchQueue.shift()!;
    if (tileCache.has(tile.key) || pending.has(tile.key)) continue;
    prefetched++;
    request(tile, "detail");
    return;
  }
}
/** Pre-build settlement plans, lots and street data for nearby towns in idle main-thread time. */
let warmedPlaces = new Set<string>();
function warmSettlements() {
  // Building up to four other town plans synchronously on this UI thread can
  // starve the first real resident canvas click. Keep optional cache warming
  // for wider views, but never compete with a close-up authority query.
  if (residentViewQuery(view.halfHeight, !$("travel-panel").hidden, ready).inspect || residentQueries.busy) return;
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback ?? ((callback: () => void) => setTimeout(callback, 50));
  const near = (x: number, z: number) => Math.hypot(wrapSourceX(x - view.x), z - view.z),
    targets = places.filter((place) => !warmedPlaces.has(place.code) && near(place.x, place.z) < metresToSource(20_000)).sort((a, b) => near(a.x, a.z) - near(b.x, b.z)).slice(0, 4);
  for (const place of targets) idle(() => {
    // A player may zoom into the settlement before the idle callback executes.
    // Deferred prewarming must not lock their newly interactive resident view.
    if (residentViewQuery(view.halfHeight, !$("travel-panel").hidden, ready).inspect || residentQueries.busy ||
        warmedPlaces.has(place.code)) return;
    warmedPlaces.add(place.code);
    if (warmedPlaces.size > 32) warmedPlaces = new Set([...warmedPlaces].slice(-16));
    settlementHomeFor(place, 0);
  });
}
function request(tile: Tile, kind: TileJobKind = "detail") {
  const job = {tile,kind}, key = tileJobKey(job);
  if (tileCache.has(key) || pending.has(key)) return;
  // Each idle worker takes one job; priorities are recomputed every frame, never queued FIFO.
  if (!idleWorkers.length || generationReadyInUse() >= generationLimit()) return;
  const surfaceBytes=globe?globe.stats.textureWidth*globe.stats.textureHeight*4:0,
    readyBytes=uploads.reduce((sum,job)=>sum+estimateGeometryBytes(job.data),0),
    cpuBytes=cachedGeometryBytes+readyBytes+surfaceBytes+continuityCpuBytes(),
    gpuBytes=cachedGeometryBytes+Math.ceil(surfaceBytes*4/3);
  if(!streamingMemoryReservationFits(cpuBytes,gpuBytes,NATURAL_WORKER_SCRATCH_RESERVE_BYTES,streamingBudget))return;
  pending.add(key);
  inFlight++;
  maxGenerationReadyObserved = Math.max(maxGenerationReadyObserved, generationReadyInUse());
  if(kind === "detail")detailGenerationJobs++;else coverageGenerationJobs++;
  const workerIndex = terrainWorkerIndexAvoidingWarmResident(
    idleWorkers.map(worker => workers.indexOf(worker)), warmedResidentWorkers);
  idleWorkers.splice(workerIndex, 1)[0].postMessage(job);
}
function refreshSelection() {
  // Reserve bounded capacity for old and incoming coverage during the 240 ms blend.
  wanted = selectTiles(view, 190, Math.floor(streamingBudget.activePatches / 2));
  coverageTiles = selectTiles(view, Math.max(512,view.pixels*.75), 16);
  coverageComplete = false; coverageStartedAt = performance.now(); coverageDurationMs = 0;
  const nextWantedKeys = new Set(wanted.map((tile) => tile.key));
  for (const tile of wanted)
    if (!previousWantedKeys.has(tile.key)) {
      if (tileCache.has(tile.key)) cacheHits++;
      else cacheMisses++;
    }
  previousWantedKeys.clear();
  for (const key of nextWantedKeys) previousWantedKeys.add(key);
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
  uploadsThisFrame = 0;
  dispatchResidentQuery();
  if (selectionDirty) refreshSelection();
  // Move finished tiles to the GPU until this frame's upload time (or count) budget is used.
  // Generation itself runs in the worker pool.
  const relevant = (key: string) => key === tileAt(0,0,0).key || coverageTiles.some(tile=>coverageKey(tile)===key) || wanted.some(tile=>tile.key===key) || activeKeys.includes(key) || Boolean(lodTransition?.oldKeys.includes(key));
  const uploadStarted = performance.now();
  for (;;) {
  if (captureStreamingQuiesced) break;
  if (uploadsThisFrame >= streamingBudget.maxUploadsPerFrame || (uploadsThisFrame > 0 && performance.now() - uploadStarted > UPLOAD_FRAME_BUDGET_MS)) break;
  let next = uploads.shift();
  while(next && next.kind === "coverage" && !relevant(next.jobKey)) {
    pending.delete(next.jobKey);
    discardedPresentationJobs++;
    next=uploads.shift();
  }
  if (!next) break;
  {
    const uploadJobStarted = performance.now();
    const bytes = estimateGeometryBytes(next.data);
    const entity = new pc.Entity(next.tile.key),
      meshes: pc.Mesh[] = [];
    for (const [name, g] of Object.entries(next.data)) {
      const mesh = uploadGeometry(g, entity, name, name === "terrain" ?
        (next.kind === "coverage" || next.tile.level === 0 ? coarseTerrainMaterial! : terrainMaterial!) : name === "nightGlow" ? nightGlowMaterial! : name === "lampPools" ? lampPoolMaterial! : material, next.kind === "coverage");
      if (mesh) meshes.push(mesh);
    }
    entity.enabled = false;
    applyTileRenderTransform(next.tile, entity);
    flatRoot.addChild(entity);
    tileCache.set(next.jobKey, {
      kind: next.kind,
      tile: next.tile,
      entity,
      meshes,
      used: revision,
      bytes,
      serial: ++meshGroupUploads,
    });
    cachedGeometryBytes += bytes;
    uploadsThisFrame++;
    maxUploadsPerFrame = Math.max(maxUploadsPerFrame, uploadsThisFrame);
    if (next.kind === "detail" && next.tile.size <= 512) {
      detailedMaxHorizontalM = Math.max(
        detailedMaxHorizontalM,
        next.precision.maxHorizontalM,
      );
      detailedMaxFloat32ErrorM = Math.max(
        detailedMaxFloat32ErrorM,
        next.precision.maxFloat32ErrorM,
      );
    }
    pending.delete(next.jobKey);
    uploadSamples.record(performance.now() - uploadJobStarted);
  }
  }
  const root = tileAt(0,0,0), cachedKeys = tileCache;
  const complete = wanted.length>0 && wanted.every(tile=>cachedKeys.has(tile.key));
  const coarseKeys = coverageTiles.map(coverageKey);
  const coarseReady = coarseKeys.length>0 && coarseKeys.every(key=>cachedKeys.has(key));
  const fineUnion = new Set([...activeKeys,...(lodTransition?.oldKeys||[])]);
  const backgroundKeys = visibleCoverageKeys(coarseKeys,cachedKeys,fineUnion.size,streamingBudget.activePatches);
  coverageComplete = complete || (coarseReady && backgroundKeys.length===coarseKeys.length);
  if (coverageComplete && coverageDurationMs===0) coverageDurationMs=performance.now()-coverageStartedAt;
  if (!ready) {
    const share = (keys: readonly string[]) => keys.length ? keys.filter(key=>cachedKeys.has(key)).length / keys.length : 0;
    setLoadingProgress(coverageComplete ? 99 : 15 + 83 * Math.max(share(coarseKeys), share(wanted.map(tile=>tile.key))));
  }
  if (!lodTransition) {
    const bounds = new Map(wanted.map(tile=>[tile.key,tile]));
    for(const key of activeKeys){const record=tileCache.get(key);if(record)bounds.set(key,record.tile);}
    const overlaps = (a:string,b:string) => {
      const p=bounds.get(a),q=bounds.get(b);
      if(!p||!q)return true;
      return Math.abs(wrapX((p.minX+p.size/2)-(q.minX+q.size/2)))<(p.size+q.size)/2-1e-7 &&
        Math.abs((p.minZ+p.size/2)-(q.minZ+q.size/2))<(p.size+q.size)/2-1e-7;
    };
    const nextKeys = progressiveDetailKeys(wanted.map(tile=>tile.key),cachedKeys,activeKeys,coverageComplete,overlaps,Math.floor(streamingBudget.activePatches/2));
    if(nextKeys.length!==activeKeys.length || nextKeys.some(key=>!activeKeys.includes(key))){
      if(ready)lodTransition={oldKeys:[...activeKeys],newKeys:nextKeys,started:performance.now()};
      activeKeys=nextKeys;
    }
  }
  const enabledFine = new Set([...activeKeys,...(lodTransition?.oldKeys||[])]);
  const background = new Set(visibleCoverageKeys(coarseKeys,cachedKeys,enabledFine.size,streamingBudget.activePatches));
  for(const [key,record] of tileCache){
    if(record.kind==='coverage')record.entity.enabled=(!complete || Boolean(lodTransition)) && background.has(key);
    else if(key===root.key)record.entity.enabled=!complete;
    else record.entity.enabled=enabledFine.has(key);
    if(record.entity.enabled)record.used=revision;
  }
  if (coverageComplete && firstCoherentTerrainSinceWorkersMs === null)
    firstCoherentTerrainSinceWorkersMs = performance.now() - workerStartedAt;
  if (coverageComplete && !ready) {
    ready = true;
    setLoadingProgress(100);
    setTimeout(()=>$("loading").classList.add("done"),350);
    // The first rendered resident is player-facing state, not optional scenery.
    // At the exact frame coarse terrain becomes usable, reserve an idle worker
    // for the authoritative snapshot BEFORE filling it with detail/prefetch.
    // Otherwise a cold close-up can wait for entire mesh generation batches.
    const mode = residentViewQuery(view.halfHeight, !$("travel-panel").hidden, ready);
    if (mode.inspect) {
      const request = residentRequestForView(simulation.tick, residentQueryLimitForView(mode.actors), mode.actors);
      if (request) {
        offerResidentQuery(request);
      }
      dispatchResidentQuery();
    }
  }
  {
    // Fill up to the shared cap with urgent on-screen work (skipping already-built tiles).
    // Optional prefetch must reserve one idle worker and one slot for a new focus/inspect.
    const cachedOrPending={has:(key:string)=>cachedKeys.has(key)||pending.has(key)};
    while(!captureStreamingQuiesced && idleWorkers.length && generationReadyInUse()<generationLimit()){
      const before=inFlight, job=nextStreamingJob(root,wanted,coverageTiles,cachedOrPending);
      if(job)request(job.tile,job.kind);
      // Nothing urgent left: keep warming the cache around the player in the background.
      else if (ready && !lodTransition && measuredStreamingFps >= 30 &&
        canPrefetchStreamingJob(inFlight+residentRunningWorkers(),uploads.length,idleWorkers.length,streamingBudget) &&
        !residentViewQuery(view.halfHeight, !$("travel-panel").hidden, ready).inspect) prefetchNext(root);
      if(inFlight===before)break;
    }
  }
  {
    const surfaceBytes = globe!.stats.textureWidth * globe!.stats.textureHeight * 4;
    const readyBytes = () => uploads.reduce((sum, job) => sum + estimateGeometryBytes(job.data), 0);
    // Only urgent generation/upload may make room below the ceiling. Optional prefetch cannot evict reusable data.
    const reservationBytes = readyBytes() + (inFlight === 0 && uploads.length === 0 && nextStreamingJob(root,wanted,coverageTiles,cachedKeys) ? NATURAL_WORKER_SCRATCH_RESERVE_BYTES : 0);
    const overCacheBudget = () =>
      shouldTrimStreamingCache(cachedGeometryBytes + readyBytes() + surfaceBytes + continuityCpuBytes(),
        cachedGeometryBytes + Math.ceil(surfaceBytes * 4 / 3),streamingBudget,reservationBytes);
    if (!captureStreamingQuiesced && overCacheBudget()) {
      const protect = new Set([
        ...activeKeys,
        ...(lodTransition?.oldKeys ?? []),
        ...wanted.map((t) => t.key),
        ...coverageTiles.map(coverageKey),
        root.key,
      ]);
      const obsolete = [...tileCache.entries()]
        .filter(([key]) => !protect.has(key))
        .sort((a, b) => a[1].used - b[1].used || compareText(a[0], b[0]));
      for (const [key, record] of obsolete) {
        if (!overCacheBudget()) break;
        // MeshInstance destruction releases its mesh reference and GPU buffers.
        record.entity.destroy();
        tileCache.delete(key);
        cachedGeometryBytes = Math.max(0, cachedGeometryBytes - record.bytes);
        evictions++;
      }
    }
  }
  if (lodTransition) {
    const transition = lodTransition;
    const progress = Math.min(1, (performance.now() - transition.started) / (LOD_BLEND_SECONDS * 1000));
    const t = progress * progress * (3 - 2 * progress);
    const incoming = new Set(transition.newKeys), outgoing = new Set(transition.oldKeys);
    for (const key of new Set([...incoming, ...outgoing])) {
      const record = tileCache.get(key);
      if (!record) continue;
      const common = incoming.has(key) && outgoing.has(key);
      for (const child of record.entity.children as pc.Entity[])
        for (const instance of child.render?.meshInstances ?? [])
          // A finished outgoing mask must not hide a cached patch when later reused.
          instance.setParameter("lodCoverage", progress === 1 ? 1 : common ? 1 : incoming.has(key) ? t : -Math.max(1e-7, t));
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
      : projectionTransition > 0.001
        ? `Handoff · ${Math.round(projectionTransition * 100)}% · ${pending.size ? "preparing terrain" : "ready"}`
        : `${activeKeys.length || 1} tiles · ${pending.size ? "refining" : "ready"}`) +
    poleFeedback;
}
const CLICKABLE_KINDS = new Set(["residence", "service", "keep", "well", "field", "garden", "gate", "guard-post", "park"]);
/** Centre the view on a source point, keeping the zoom unless it is too far out to see the target. */
function centreOn(x: number, z: number, maxHalfHeight = view.halfHeight) {
  navigate(x, z, Math.min(view.halfHeight, maxHalfHeight));
}
function openSettlementCard(place: (typeof places)[number], returnFocus?: HTMLElement) {
  centreOn(place.x, place.z, place.kind === "city" ? 60 : 25);
  showSettlementPopup(place, populationOf(place), returnFocus);
}
/**
 * Game-facing click: a building (or gate, field, well) under the point opens its card; ground inside a
 * settlement opens the town card. Both centre the view. Returns false for open country.
 */
function openGameInfoAt(x: number, z: number) {
  const features = featuresFor(tileForPosition(x, z, 12)) as unknown as (BuildingInfo & { x: number; z: number; footprintWidth?: number; footprintDepth?: number })[];
  let best: (typeof features)[number] | undefined, bestDistance = Infinity;
  for (const feature of features) {
    if (!CLICKABLE_KINDS.has(feature.kind) || !feature.name) continue;
    const reach = feature.widthM !== undefined ? metresToSource(Math.max(feature.widthM, feature.depthM ?? feature.widthM) * .55 + 1.5) : Math.max(feature.footprintWidth ?? 0, feature.footprintDepth ?? 0) * .55 + metresToSource(1.5),
      distance = Math.hypot(wrapSourceX(feature.x - x), feature.z - z);
    if (distance <= reach && distance < bestDistance) { best = feature; bestDistance = distance; }
  }
  const settlement = places.find((place) => Math.hypot(wrapSourceX(place.x - x), place.z - z) < (place.kind === "city" ? metresToSource(760) : metresToSource(300)));
  if (best) {
    // Use the residents the workers already computed for this view (current snapshot) instead of
    // re-simulating the neighbourhood on the UI thread: rebuilding every nearby resident's routed
    // schedule here froze the page for many seconds per click. The owner's name and role come from
    // the seeded identity alone (no route work) when the owner is not in the snapshot.
    const known = residentQueries.current?.residents ?? [],
      liveOwner = best.ownerId ? known.find((resident) => resident.code === best.ownerId) : undefined,
      owner = liveOwner ?? (best.ownerId ? simulation.residentIdentityByCode(best.ownerId) : undefined),
      inside = known.filter((resident) => residentOccupiesBuilding(resident, best) &&
        (best.kind !== "service" || residentInsideRenderedService(resident, best)));
    centreOn(best.x, best.z);
    showBuildingPopup(best, settlement, owner, inside);
    return true;
  }
  const wild = nearbyWilderness(x,z,metresToSource(120),8).find(site=>Math.hypot(wrapSourceX(site.x-x),site.z-z)<metresToSource(site.radiusM));
  if(wild){showWildernessPopup(wild);return true;}
  if (settlement) {
    openSettlementCard(settlement);
    return true;
  }
  return false;
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
    if (point.y <= elevationToRenderY(visibleSurfaceElevation(finalSurfaceAt(source.x, source.z)))) {
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
    if (point.y > elevationToRenderY(visibleSurfaceElevation(finalSurfaceAt(source.x, source.z)))) before = middle;
    else hit = middle;
  }
  const point = origin.add(direction.mulScalar(hit));
  {
    const ground = renderFrame.renderToSource(point.x, point.z);
    if (openGameInfoAt(ground.x, ground.z)) { $("cell-panel").hidden = true; return; }
  }
  try {
    const source = renderFrame.renderToSource(point.x, point.z),
      canonical = renderFrame.renderToLonLat(point.x, point.z),
      cell = cellAt(source.x, source.z),
      surface = finalSurfaceAt(source.x, source.z),
      elevation = visibleSurfaceElevation(surface),
      hierarchy = cellSeed(cell.x, cell.z),
      canonicalId = canonicalCellId(canonical.lon, canonical.lat);
    selectedCode = canonicalId;
    $("cell-panel").hidden = false;
    $("cell-biome").textContent = surface.material;
    // Seeded proper name of the nearest named building, street, gate or wall within ~15 m.
    {
      const radius = metresToSource(15), named = (featuresFor(tileForPosition(source.x, source.z, 12)) as { name?: string; kind: string; x: number; z: number; service?: string }[])
        .filter((feature) => feature.name)
        .map((feature) => ({ feature, distance: Math.hypot(wrapSourceX(feature.x - source.x), feature.z - source.z) }))
        .filter((entry) => entry.distance <= radius)
        .sort((a, b) => a.distance - b.distance)[0]?.feature;
      $("cell-name").hidden = !named;
      $("cell-name").textContent = named ? `${named.name} · ${(named.service || named.kind).replaceAll("-", " ")}` : "";
    }
    $("cell-coordinates").textContent =
      `${coordinateLabel(canonical, true)} · ${hierarchy.parent.parent.parent.landform}`;
    $("cell-code").textContent = canonicalId;
    $("cell-code").dataset.canonicalId = canonicalId;
    $("cell-height").textContent = `${elevation.toFixed(1)} m`;
    $("cell-height").title =
      `Canonical position: lon ${canonical.lon.toFixed(9)}, lat ${canonical.lat.toFixed(9)}, elevation ${elevation.toFixed(2)} m`;
    $("cell-tile").textContent = `${cell.tile} · derived render tile`;
    $("cell-walkable").textContent = surface.walkable ? "Yes" : "No";
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
      option.textContent = scaleOptionLabel(value);
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
  canvas.addEventListener("pointerdown", measureInput<PointerEvent>((event) => {
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
  }));
  canvas.addEventListener("pointermove", measureInput<PointerEvent>((event) => {
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
  }));
  canvas.addEventListener("pointerup", measureInput<PointerEvent>((event) => {
    if (!moved && pointers.size === 1 && projectionTransition <= 0.001) {
      // A click on a villager opens its character popup; anywhere else inspects the ground.
      const resident = pickResidentAt?.(event.clientX, event.clientY);
      // Inspect the already-visible resident without moving the map and invalidating terrain coverage.
      // Camera focus is a separate explicit action; selection must keep its world context.
      if (resident) showNpcPopup(resident, simulation.tick);
      else { hideNpcPopup(); inspectCell(event.clientX, event.clientY); }
    }
    pointers.delete(event.pointerId);
    lastPinch = 0;
  }));
  canvas.addEventListener("pointercancel", measureInput<PointerEvent>((event) => {
    pointers.delete(event.pointerId);
    lastPinch = 0;
  }));
  canvas.addEventListener(
    "wheel",
    measureInput<WheelEvent>((event) => {
      event.preventDefault();
      navigate(
        view.x,
        view.z,
        view.halfHeight * Math.exp(event.deltaY * 0.0015),
      );
    }),
    { passive: false },
  );
  // Place rows in the settlement card (notable places, nearby sites, neighbours) centre the camera on
  // the place at Hero zoom; the card stays open so the next place can be picked.
  setPopupNavigator((x, z, ref) => {
    // Camera-only owned-home inspection faces its SEED-resolved front door;
    // unchanged Simulation, resident position, route, home ID, and collision.
    const facing = popupOwnedHomeFacing(ref);
    if (facing !== undefined) view.yaw = facing;
    navigate(x, z, popupFocusHalfHeight(ref, HERO_HALF_HEIGHT, innerHeight));
  });
  $("home").onclick = () => {
    view.yaw = -0.22;
    navigate(villages[0].x, villages[0].z + metresToSource(6), HERO_HALF_HEIGHT);
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
  window.addEventListener("keydown", measureInput<KeyboardEvent>((event) => {
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
  }));
  window.addEventListener("keyup", measureInput<KeyboardEvent>((event) => pressed.delete(event.key)));
  window.addEventListener("blur", () => pressed.clear());
  window.addEventListener("resize", () => {
    app.resizeCanvas();
    // Keep the last real view while the page is hidden or minimised (0x0 viewport).
    if (innerWidth < 1 || innerHeight < 1) return;
    view.aspect = innerWidth / innerHeight;
    view.pixels = Math.min(innerHeight, 1000);
    streamingBudget = streamingBudgetForPool(innerWidth, innerHeight, generationWorkers, deviceMemoryGB);
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
  // Exact non-canvas counterpart to clicking a visible map label: the same
  // SEED-backed place record enters the same read-only inspector.
  const inspect = (place: (typeof places)[number] | undefined) => {
    if (!place) return;
    $("travel-panel").hidden = true;
    openSettlementCard(place, $("open-travel"));
  };
  $("inspect-city").onclick = () => inspect(cities.find((p) => p.id === city.value));
  $("inspect-village").onclick = () => inspect(villages.find((p) => p.id === village.value));
}
async function start() {
  $("world-seed").textContent = WORLD_SEED;
  $("fantasy-time").textContent = clock.labelAt(Date.now());
  const device = await createRenderer(canvas);
  canvas = device.canvas as HTMLCanvasElement;
  device.on("devicelost", () => {
    rendererLossCount++;
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
  // Full native resolution; the update loop steps it down only if the frame rate cannot keep up.
  device.maxPixelRatio = devicePixelRatio || 1;
  // GPU profiling is opt-in for real measurement only; it may add GPU overhead.
  const profileGpu = new URLSearchParams(window.location.search).has("profile-gpu");
  if (profileGpu && device.gpuProfiler) device.gpuProfiler.enabled = true;
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.LightComponentSystem,
    pc.AnimComponentSystem,
  ];
  options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler, pc.AnimClipHandler];
  app = new pc.AppBase(canvas);
  app.init(options);
  const characterVisuals = await loadDefaultCharacter(app);
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
  // Allocate after the engine reserves World/Depth/Skybox/UI layer IDs.
  coarseTerrainLayer = new pc.Layer({name:"Coarse terrain background"});
  coverageTerrainLayer = new pc.Layer({name:"Current view terrain coverage"});
  app.scene.layers.insertOpaque(coarseTerrainLayer, 1);
  app.scene.layers.insertOpaque(coverageTerrainLayer, 2);
  camera.camera!.layers = [globe.surfaceLayer.id, coarseTerrainLayer.id, coverageTerrainLayer.id, ...camera.camera!.layers];
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
  sunLight = sun.light!;
  /**
   * Local-time lighting: the light, ambient, terrain tint and backdrop follow the local clock of the
   * place at the map focus. Adjacent local zones and frame transitions blend; globe and flat terrain share the same displayed tint.
   */
  let lastDaylightLabel = "";
  const applyDaylight = (tick:number,dt:number) => {
    const focusLon=flatToLonLat(view.x,view.z).lon,second=localSecondOfDay(tick,focusLon),
      phase=daylightAt(second).phase,label=`local ${clockLabel(second)} · GMT+${timeZoneOffsetHours(focusLon)} · ${phase}`;
    if(label!==lastDaylightLabel){$("local-time").textContent=label;lastDaylightLabel=label;}
    targetDaylight=daylightAtLongitude(tick,focusLon);
    const light=displayedDaylight=advanceDaylight(displayedDaylight,targetDaylight,dt),hadGlow=eveningGlow>GLOW_VISIBILITY_EPSILON;
    const continuousScale=canonicalFootprintForHalfHeight(view.halfHeight)/CANONICAL_PLANET_DIAMETER*10000;
    eveningGlow=eveningLightWeight(light.daylight)*closeLightingWeight(continuousScale);
    const glowOpacity=Math.pow(eveningGlow,2.2);
    if(nightGlowMaterial){nightGlowMaterial.opacity=glowOpacity;nightGlowMaterial.update();}
    if(lampPoolMaterial){lampPoolMaterial.opacity=.45*glowOpacity;lampPoolMaterial.update();}
    if(hadGlow!==(eveningGlow>GLOW_VISIBILITY_EPSILON))setLayers();
    sun.light!.color.set(...light.sunColor);
    sun.light!.intensity=light.sunIntensity;
    sun.setEulerAngles(light.sunPitch,light.sunYaw,0);
    characterVisuals.setLighting(sun.up, light.terrainTint);
    // A directional light shines along its -Y axis, so its +Y axis points at the sun.
    const towardsSun=sun.up;sunDirUniform[0]=towardsSun.x;sunDirUniform[1]=towardsSun.y;sunDirUniform[2]=towardsSun.z;
    for(const material of [terrainMaterial,coarseTerrainMaterial]) {
      material?.setParameter("sdSunDir",sunDirUniform);
      // Ground shadows fade out as the sun sets (no moon shadows).
      material?.setParameter("sdShadowStrength",0.45*Math.min(1,Math.max(0,(towardsSun.y-0.02)/0.25))*Math.min(1,light.sunIntensity/0.6));
    }
    // Moving water ripples (presentation time, wrapped to keep shader precision).
    const rippleTime=(performance.now()/1000)%600;
    for(const material of [worldMaterial,terrainMaterial,coarseTerrainMaterial]) material?.setParameter("sdTime",rippleTime);
    app.scene.ambientLight.set(...light.ambient);
    flatBackdrop.set(...light.sky,1);
    daylightTintUniform.set(light.terrainTint);
    for(const material of [terrainMaterial,coarseTerrainMaterial]) material?.setParameter("surfaceDaylightTint",daylightTintUniform);
    globe?.setDaylightTint(light.terrainTint);
  };
  const material = (worldMaterial = new pc.StandardMaterial());
  material.diffuse = new pc.Color(1, 1, 1);
  material.diffuseVertexColor = true;
  (material as pc.StandardMaterial & { vertexColorGamma: boolean }).vertexColorGamma = true;
  material.specular = new pc.Color(0.04, 0.04, 0.04);
  material.shininess = 4;
  material.cull = pc.CULLFACE_NONE;
  installLitSurfaceDetail(material);
  material.update();
  const makeGlowMaterial = (pool:boolean) => {
    const glow = new pc.StandardMaterial();
    glow.diffuse = new pc.Color(0, 0, 0);
    glow.emissive = new pc.Color(1, 1, 1);
    glow.emissiveVertexColor = true;
    (glow as pc.StandardMaterial & {vertexColorGamma:boolean}).vertexColorGamma = true;
    glow.useLighting = false; glow.useSkybox = false; glow.useFog = false; glow.useTonemap = false;
    glow.cull = pc.CULLFACE_NONE;
    glow.blendType = pc.BLEND_ADDITIVEALPHA; glow.depthWrite = false; glow.opacity = 0;
    glow.name = pool ? "Fading lantern light pools" : "Fading window and lantern glow";
    installLodCoverage(glow); glow.update(); return glow;
  };
  nightGlowMaterial = makeGlowMaterial(false);
  lampPoolMaterial = makeGlowMaterial(true);
  terrainMaterial = createTerrainMaterial(globe.surface);
  coarseTerrainMaterial = createTerrainMaterial(globe.surface);
  // The world-wide emergency mesh is coverage behind detailed patches. Its
  // interpolated height must never occlude prepared ground while jobs run.
  coarseTerrainMaterial.depthWrite = false;
  coarseTerrainMaterial.depthTest = false;
  coarseTerrainMaterial.update();
  workerStartedAt=performance.now();
  // The first worker starts alone so the first screen loads as fast as with a single worker; the
  // rest of the pool starts once it is ready, instead of all competing for the CPU at start-up.
  const startWorker = () => {
    const worker = new Worker(new URL("./tile-worker.ts", import.meta.url), { type: "module" });
    workers.push(worker);
    worker.onmessage = (event) => {
      if(event.data.ready){
        if(++readyWorkers===1){
          workerStartupMs=performance.now()-workerStartedAt;setLoadingProgress(15);
          for (let index = 1; index < generationWorkers; index++) startWorker();
        }
        idleWorkers.push(worker);
        return;
      }
      if (event.data.kind === "resident-started") {
        residentPhaseTimings.recordStartNotice(event.data.mainSentEpochMs,
          performance.timeOrigin + performance.now());
        return; // Does not free a worker, accept an actor or mutate a batch.
      }
      if (event.data.kind === "resident-first-fact") {
        const batch = residentBatches.get(event.data.id);
        // Preview does not make this worker idle or finish a shard. Final
        // actor membership and all streaming admission remain unchanged.
        if (batch && !$("travel-panel").hidden && !batch.completed.has(event.data.shard) &&
            residentQueries.acceptsPreview(event.data.id, Math.max(simulation.tick, clock.tickAt(Date.now())))) {
          const first = simulation.projectResidentView([event.data.resident as Resident], batch.job.tick, batch.job);
          if (first.length) {
            simulation.acceptResidentQuery(first, {
              settlements: 1, candidateResidents: 1, evaluatedResidents: 1, returnedResidents: first.length,
            });
            if (firstResidentFactMs === null && firstResidentQueryOfferedAt !== null)
              firstResidentFactMs = performance.now() - firstResidentQueryOfferedAt;
          }
        }
        return;
      }
      if (event.data.kind === "residents") {
        idleWorkers.push(worker);
        if (event.data.error) { fail(`Resident query failed: ${event.data.error}`); return; }
        residentPhaseTimings.recordTransport(event.data.residentTiming, performance.timeOrigin + performance.now());
        const wasWarm = warmedResidentWorkers.has(workers.indexOf(worker));
        warmedResidentWorkers.add(workers.indexOf(worker));
        const residentBatch = residentBatches.get(event.data.id);
        if (residentBatch && !residentBatch.completed.has(event.data.shard)) {
          residentBatch.completed.add(event.data.shard);
          residentBatch.results.push(event.data);
          if (residentBatch.completed.size === residentBatch.count) {
            const merged = mergeResidentQueries(residentBatch.results, residentBatch.job.limit, resident => residentOrder.get(resident.settlement)!(resident.index));
            residentBatches.delete(residentBatch.job.id);
            const accepted = residentQueries.complete(event.data.id, merged, Math.max(simulation.tick, clock.tickAt(Date.now())));
            const answeredAt = performance.now();
            residentPhaseTimings.complete(event.data.id, accepted, answeredAt, event.data.residentTiming, wasWarm);
            if (accepted) {
              if (firstResidentFactMs === null && firstResidentQueryOfferedAt !== null)
                firstResidentFactMs = answeredAt - firstResidentQueryOfferedAt;
              residentResultReady();
            }
          }
        }
        return;
      }
      inFlight--;
      idleWorkers.push(worker);
      lastGenerationTiming=event.data.timing||{};
      workerGenerationSamples.record(event.data.timing?.totalMs);
      workerPhaseSamples.record(event.data.kind, event.data.timing);
      continuityBytesByWorker.set(worker, event.data.continuity?.cpuBytesEstimated || 0);
      continuityWorkerBytes = [...continuityBytesByWorker.values()].reduce((sum, bytes) => sum + bytes, 0);
      continuityWorkerState = event.data.continuity;
      if (event.data.error) {
        pending.delete(event.data.jobKey);
        fail(`Tile generation failed: ${event.data.error}`);
        return;
      }
      uploads.push(event.data);
    };
    worker.onerror = (event) =>
      fail(`World worker could not start: ${event.message}`);
  };
  startWorker();
  setupControls();
  updateCamera();
  simulation.setFocus(villages[0]);
  simulation.advance(clock.tickAt(Date.now()));
  // Saved history consists only of SEED identities, absolute ticks and edges.
  // Never hydrate a serialized actor position or validated boolean. Replay
  // runs full character/route/surface decisions; corrupted history is ignored.
  const visitSaveKey = "advisor-game:s005:ALDERWICK:v5:site-visits";
  let pendingSiteVisitHistory: unknown;
  try {
    const stored = localStorage.getItem(visitSaveKey);
    if (stored && stored.length <= 24_576) pendingSiteVisitHistory = JSON.parse(stored);
  } catch { /* storage may be disabled; live game remains playable */ }
  const saveSiteVisits = () => {
    try { localStorage.setItem(visitSaveKey,
      JSON.stringify(simulation.savedSiteVisitHistory())); }
    catch { /* no false claim of durable save when storage unavailable */ }
  };
  const updateWilderness = createWildernessOverlay(site=>{centreOn(site.x,site.z,12);showWildernessPopup(site);});
  const actors: pc.Entity[] = [];
  const selectedResidentMarker = $("selected-resident-marker"),
    selectedResidentName = $("selected-resident-name"),
    selectedResidentGroundMarker = $("selected-resident-ground-marker"),
    selectedResidentWorld = new pc.Vec3(), selectedResidentScreen = new pc.Vec3(),
    selectedResidentGround = new pc.Vec3(), selectedResidentGroundScreen = new pc.Vec3();
  const selectedHomeDoorMarker = $("selected-home-door-marker"),
    selectedHomeDoorWorld = new pc.Vec3(), selectedHomeDoorScreen = new pc.Vec3();
  let markedResidentCode = "", markedResidentTransform = "", markedGroundTransform = "", markedDoorTransform = "", markedActorHeight = "";
  let selectedDoorPoint: { x: number; z: number; y: number } | undefined;
  // A logical resident without an installed visible 3D mesh is not an on-screen click target.
  // Keep normal pointer picking and the S006 real-click evidence under the same predicate.
  const hasResidentMesh = (actor: pc.Entity) => (actor.findComponents("render") as pc.RenderComponent[])
    .some(render => render.enabled && render.entity.enabled && render.meshInstances.length > 0);
  pickResidentAt = (clientX: number, clientY: number) => {
    const pickStarted = performance.now();
    // Project each visible sprite's feet and head to the screen and test the click against
    // that upright rectangle (padded so small, distant villagers stay clickable). Nearest wins.
    const rect = canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top,
      lens = camera.camera!, feet = new pc.Vec3(), head = new pc.Vec3();
    let best: Resident | undefined, bestDistance = Infinity;
    for (const actor of actors) {
      const resident = actorResidents.get(actor);
      if (!actor.enabled || !resident || !hasResidentMesh(actor)) continue;
      const scale = actor.getLocalScale(), up = actor.getRotation().transformVector(new pc.Vec3(0, scale.y * DEFAULT_CHARACTER_HEIGHT_M, 0)), base = actor.getPosition(),
        bottom = base.clone(), top = base.clone().add(up);
      lens.worldToScreen(bottom, feet);
      lens.worldToScreen(top, head);
      const distance = residentActorPickDistance(x, y, feet, head);
      if (distance !== null && distance < bestDistance) { best = resident; bestDistance = distance; }
    }
    residentPickSamples.record(performance.now() - pickStarted);
    return best;
  };
  let lastSimulationRealSecond = -1, lastResidentSnapshot = -1;
  let actorSnapshotTick = -Infinity;
  residentResultReady = () => { lastSimulationRealSecond = -1; };
  if (pendingSiteVisitHistory !== undefined) {
    void simulation.restoreSiteVisitHistory(pendingSiteVisitHistory).then(restored => {
      if (restored) {
        residentPhaseTimings.clearPending();
        residentQueries.clear();
        lastSimulationRealSecond = -1;
      }
    });
  }
  // A suggestion originates only from an actually inspected NPC. The player
  // cannot set acceptance or create route stations; Simulation asks the
  // original resident and strictly validates each canonical walking leg.
  setSiteVisitAdvisor(async code => {
    const result = await simulation.considerAdvisorSiteVisit(code);
    if (result.started) {
      saveSiteVisits();
      residentPhaseTimings.clearPending();
      residentQueries.clear();
      lastSimulationRealSecond = -1;
    }
    return result;
  });
  let lastResidentDetailVisible = smallDetailsVisible;
  let lastResidentInspectorOpen = !$("travel-panel").hidden;
  const labelNodes = new Map<string, HTMLElement>();
  const labels = $("map-labels");
  let labelFingerprint = "";
  $("backend").textContent =
    `PlayCanvas 2.23.0 · ${device.deviceType === "webgpu" ? "WebGPU" : "WebGL2"}`;
  $("backend").title = rendererState.fallbackReason;
  let statsElapsed = 0,
    frames = 0,
    fps = 0;
  let resolutionFrames = 0, resolutionSeconds = 0;
  let cpuFrameStartedAt = 0;
  app.on("update", (dt: number) => {
    if (rendererState.phase === "lost") return;
    const cpuUpdateStarted = performance.now();
    cpuFrameStartedAt = cpuUpdateStarted;
    // Adaptive resolution: average the frame time, decide every couple of seconds.
    resolutionFrames++; resolutionSeconds += dt;
    if (resolutionSeconds >= RESOLUTION_DECISION_SECONDS) {
      const ratio = nextPixelRatio(app.graphicsDevice.maxPixelRatio, resolutionSeconds * 1000 / resolutionFrames, devicePixelRatio || 1);
      if (ratio !== app.graphicsDevice.maxPixelRatio) { app.graphicsDevice.maxPixelRatio = ratio; app.resizeCanvas(); }
      resolutionFrames = 0; resolutionSeconds = 0;
    }
    const now = Date.now(),
      realSecond = Math.floor(now / 1000);
    const simulationTick = clock.tickAt(now);
    if(ready)updateWilderness(view.x,view.z,view.halfHeight,scaleValueForHalfHeight(view.halfHeight),projectionTransition,projectTransportGround);
    const residentInspectorOpen = !$("travel-panel").hidden;
    if (realSecond !== lastSimulationRealSecond || lastResidentDetailVisible !== smallDetailsVisible ||
        residentInspectorOpen !== lastResidentInspectorOpen || selectionDirty) {
      // A camera-only focus/zoom changes the authoritative resident query key.
      // Dispatch its new view even when Fantasy Time is fixed (e.g. on-demand
      // evidence/replay). Otherwise "settled" can remain false indefinitely
      // with an idle resident worker and the previous view's snapshot.
      lastResidentDetailVisible = smallDetailsVisible;
      lastResidentInspectorOpen = residentInspectorOpen;
      if (view.halfHeight < 900)
        simulation.setFocus(nearestPlace(view.x, view.z));
      simulation.advance(Math.max(simulation.tick, simulationTick));
      lastSimulationRealSecond = realSecond;
      $("fantasy-time").textContent = clock.labelAt(now);
      $("simulation-status").textContent =
        `${simulation.stats.residents} residents live in the focused country; ${simulation.stats.coarseCountries} countries tracked as summaries.`;
      // Logical inspection remains available before optional meshes and billboards
      // finish. Actor allocation keeps the original strict close-detail budget.
      const residentMode = residentViewQuery(view.halfHeight, residentInspectorOpen, ready);
      // Compute the canonical future close-view actor snapshot before terrain
      // completes. The existing residentMode.actors gate still prevents sprites
      // and selection from appearing before coherent world geometry.
      const queryActors = residentMode.actors || (!ready && view.halfHeight < 20);
      const query = residentMode.inspect || queryActors
        ? residentRequestForView(simulation.tick, residentQueryLimitForView(queryActors), queryActors) : undefined;
      const previousSnapshot = residentQueries.current;
      if (query) {
        offerResidentQuery(query);
      } else {
        residentPhaseTimings.clearPending();
        residentQueries.clear();
      }
      const snapshot = currentResidentSnapshot(residentQueries.current, previousSnapshot, query?.placeCode, simulation.tick, TIME_SCALE * 2, query);
      // The terrain worker returns immutable routine facts. Reconcile any
      // independently accepted visit here with the main Simulation event
      // before selection, inspector or pooled sprite allocation. No copies.
      const projectedResidents = snapshot
        ? simulation.projectResidentView(snapshot.residents, snapshot.tick, snapshot)
        : [];
      const inspectedCode = npcPopupCode();
      const existingSelected = inspectedCode
        ? actors.find(actor => actor.enabled && actorResidents.get(actor)?.code === inspectedCode)
        : undefined;
      const knownSelected = existingSelected ? actorResidents.get(existingSelected) : undefined;
      // An in-flight view query must not erase a still-grounded selected 3D actor
      // simply because its old finite result is no longer the desired key.
      // Never retain stale time/remote scenery; no actor is invented.
      const selectedFromSnapshot = inspectedCode && snapshot
        ? projectedResidents.find(resident => resident.code === inspectedCode) : undefined;
      const authoritativeSelected = inspectedCode && snapshot &&
        snapshot.id !== lastResidentSnapshot && !selectedFromSnapshot
        ? simulation.projectedResidentByCode(inspectedCode) : undefined;
      const selected = selectedFromSnapshot ?? authoritativeSelected ?? knownSelected;
      const selectionNearby = residentMode.actors &&
        selectedResidentVisibleInView(selected, query);
      const holdSelected = !snapshot && selectionNearby &&
        simulation.tick >= actorSnapshotTick &&
        simulation.tick - actorSnapshotTick <= TIME_SCALE * 2;
      if (holdSelected) {
        // Keep exactly the real selected actor during a short snapshot handoff.
        // Other stale actors never become visible occupants of the new view.
        for (const actor of actors) if (actor !== existingSelected) {
          actor.enabled = false;
          actorResidents.delete(actor);
          actorMotion.delete(actor);
        }
      } else if (!residentMode.inspect || !residentMode.actors || !snapshot || snapshot.id !== lastResidentSnapshot) {
        const residents = projectedResidents;
        if (snapshot) {
          // Do not consume the actor snapshot's presentation revision while
          // coherent terrain is still pending. When ready flips, the SAME
          // canonical early result must populate the visible actor pool.
          if (residentActorSnapshotMayMarkPresented(residentMode.actors, queryActors)) lastResidentSnapshot = snapshot.id;
          actorSnapshotTick = simulation.tick;
          simulation.acceptResidentQuery(residents, snapshot.query);
        }
        // A fresh snapshot may omit the clicked resident from its first eight.
        // Append only its actual current Simulation state when still in view.
        const visible = residentMode.actors
          ? residents.filter((resident) => resident.grounded && !resident.indoors) : [];
        if (snapshot && selectionNearby && selected &&
            !visible.some(resident => resident.code === selected.code)) visible.push(selected);
        for (let i = 0; i < visible.length; i++) {
          if (!actors[i]) {
            const actor = characterVisuals.create();
            flatRoot.addChild(actor);
            actors.push(actor);
          }
          const height = characterHeightM(CHARACTER_TYPES[visible[i].character] || CHARACTER_TYPES.default, visible[i].appearance.silhouette);
          const scale = elevationToRenderY(height / DEFAULT_CHARACTER_HEIGHT_M);
          actors[i].setLocalScale(scale, scale, scale);
          characterVisuals.palette(actors[i], visible[i].variant);
          void characterVisuals.character(actors[i], visible[i].character);
          characterVisuals.move(actors[i], 0, 0, 1);
          actors[i].enabled = true;
          actorSources.set(actors[i], { x: visible[i].x, z: visible[i].z });
          actorResidents.set(actors[i], visible[i]);
          // Walkers glide along the legal street path over the next real second (the simulation's walk window).
          const walk = visible[i].walkAhead;
          if (visible[i].activity === "commute" && walk && walk.length >= 2) {
            // Unwrapped across the date line: x follows the shortest wrapped step from the previous point.
            const points = [{ x: walk[0].x, z: walk[0].z }], lengths = [0];
            for (let k = 1; k < walk.length; k++) {
              const dx = wrapSourceX(walk[k].x - walk[k - 1].x), dz = walk[k].z - walk[k - 1].z;
              points.push({ x: points[k - 1].x + dx, z: walk[k].z });
              lengths.push(lengths[k - 1] + Math.hypot(dx, dz));
            }
            actorMotion.set(actors[i], { points, lengths, total: lengths[lengths.length - 1], startTick: snapshot?.tick ?? simulation.tick });
          } else actorMotion.delete(actors[i]);
          positionActor(actors[i], visible[i].x, visible[i].z);
        }
        for (let i = visible.length; i < actors.length; i++) {
          actors[i].enabled = false;
          actorResidents.delete(actors[i]);
          actorMotion.delete(actors[i]);
        }
        // Keep an open character popup in step with Fantasy Time.
        const popupCode = npcPopupCode();
        if (popupCode) {
          // Prefer the worker snapshot; only a resident outside it is re-evaluated on this thread.
          const resident = residents.find((entry) => entry.code === popupCode) ??
            (selected?.code === popupCode ? selected : simulation.projectedResidentByCode(popupCode));
          if (resident) showNpcPopup(resident, simulation.tick);
        }
        $("simulation-status").textContent =
          `${simulation.stats.logicalResidents.toLocaleString()} logical residents · ${visible.length} visible actors · ${actors.length} pooled actors · ${simulation.stats.query.evaluatedResidents.toLocaleString()} spatial candidates evaluated.`;
      }
    }
    // Per-frame walking: interpolate along the street route between Fantasy Time samples.
    if (actorMotion.size) {
      // Derive both position and animation from the SAME absolute Fantasy Time
      // as the original Simulation snapshot. A frozen clock cannot carry an
      // original SEED actor into an unvalidated future 3D position.
      for (const [actor, motion] of actorMotion) {
        if (!actor.enabled) continue;
        const { points, lengths } = motion,
          target = residentMotionFraction(simulationTick, motion.startTick, TIME_SCALE) * motion.total;
        let k = 1;
        while (k < lengths.length - 1 && lengths[k] < target) k++;
        const a = points[k - 1], b = points[k], span = lengths[k] - lengths[k - 1],
          f = span > 0 ? Math.min(1, (target - lengths[k - 1]) / span) : 1,
          x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
        actorSources.set(actor, { x, z });
        positionActor(actor, x, z);
        characterVisuals.move(actor, .8, b.x-a.x, b.z-a.z);
      }
    }
    // All true on-world 2D illustrated residents face the current camera;
    // their feet, routes, identities and picker remain Simulation-authoritative.
    for (const actor of actors) if (actor.enabled) characterVisuals.face(actor, camera);
    // Keep one screen-space marker attached to the actual enabled 3D-world actor.
    // A popup with no rendered, onscreen resident gets no invented world anchor.
    const inspectedCode = npcPopupCode();
    // A cached door belongs only to its original selected SEED resident.
    // Switching inspectors while the new actor is offscreen must never expose
    // the previous person's entrance as this person's authoritative home.
    if (inspectedCode !== markedResidentCode) {
      selectedDoorPoint = undefined;
      selectedHomeDoorMarker.dataset.homeEntrance = "";
      selectedHomeDoorMarker.hidden = true;
    }
    const inspectedActor = inspectedCode && projectionTransition <= 0.001
      ? actors.find(actor => actor.enabled && actorResidents.get(actor)?.code === inspectedCode)
      : undefined;
    if (inspectedActor) {
      const foot = inspectedActor.getPosition();
      // Ground indicator uses the rendered actor root, never an invented scheduled location.
      selectedResidentGround.set(foot.x, foot.y + .02, foot.z);
      camera.camera!.worldToScreen(selectedResidentGround, selectedResidentGroundScreen);
      const gx = Math.round(selectedResidentGroundScreen.x), gy = Math.round(selectedResidentGroundScreen.y);
      if (gx >= 16 && gx <= innerWidth - 16 && gy >= 90 && gy <= innerHeight - 120) {
        const groundTransform = `translate3d(${gx}px, ${gy}px, 0) translate(-50%, -50%)`;
        if (groundTransform !== markedGroundTransform) {
          selectedResidentGroundMarker.style.transform = groundTransform;
          markedGroundTransform = groundTransform;
        }
        selectedResidentGroundMarker.hidden = false;
      } else selectedResidentGroundMarker.hidden = true;
      selectedResidentWorld.set(foot.x, foot.y + inspectedActor.getLocalScale().y * DEFAULT_CHARACTER_HEIGHT_M + .04, foot.z);
      camera.camera!.worldToScreen(selectedResidentWorld, selectedResidentScreen);
      const x = Math.round(selectedResidentScreen.x), y = Math.round(selectedResidentScreen.y);
      // Physical-size bracket beside the *rendered* model. Its height is the
      // current camera's actual projected head-to-foot distance, never a
      // synthetic 2D character or an independent Simulation coordinate.
      const projectedHeight = Math.max(0, gy - y);
      const nextActorHeight = `${Math.round(Math.min(projectedHeight, innerHeight * .45))}px`;
      if (projectedHeight > 1 && nextActorHeight !== markedActorHeight) {
        selectedResidentGroundMarker.style.setProperty("--actor-projected-height", nextActorHeight);
        markedActorHeight = nextActorHeight;
      }
      if (x >= 80 && x <= innerWidth - 80 && y >= 110 && y <= innerHeight - 120) {
        if (markedResidentCode !== inspectedCode) {
          markedResidentCode = inspectedCode;
          const resident = actorResidents.get(inspectedActor)!;
          selectedResidentName.textContent = `Selected · ${resident.name}`;
          selectedResidentMarker.dataset.residentCode = inspectedCode;
          const place = places.find(place => place.id === resident.settlement);
          const door = place ? resolvedSettlementHomeDoorFor(place, resident.index) : null;
          selectedDoorPoint = door
            ? { x: door.x, z: door.z, y: finalSurfaceAt(door.x, door.z).surfaceHeight + 0.12 }
            : undefined;
          selectedHomeDoorMarker.dataset.homeEntrance = door ? resident.homeEntrance : "";
        }
        // Displace the name to reveal the actual small on-scene character.
        const right = residentLabelRightOfActor(x, innerWidth, innerHeight);
        const transform = `translate3d(${x + (right ? 14 : -14)}px, ${y}px, 0) translate(${right ? "0" : "-100%"}, -110%)`;
        if (transform !== markedResidentTransform) {
          selectedResidentMarker.style.transform = transform;
          markedResidentTransform = transform;
        }
        selectedResidentMarker.hidden = false;
      } else selectedResidentMarker.hidden = true;
    } else {
      selectedResidentMarker.hidden = true;
      selectedResidentGroundMarker.hidden = true;
      if (inspectedCode !== markedResidentCode) selectedDoorPoint = undefined;
    }
    // The already-resolved SEED doorway stays visible after camera-only home
    // focus even when the selected character leaves the actor render query.
    if (inspectedCode && selectedDoorPoint && projectionTransition <= 0.001) {
      const door = renderFrame.sourceToRender(selectedDoorPoint.x, selectedDoorPoint.z, selectedDoorPoint.y);
      selectedHomeDoorWorld.set(door.x, door.y, door.z);
      camera.camera!.worldToScreen(selectedHomeDoorWorld, selectedHomeDoorScreen);
      const dx = Math.round(selectedHomeDoorScreen.x), dy = Math.round(selectedHomeDoorScreen.y),
        visibleDoor = dx >= 90 && dx <= innerWidth - 90 &&
          dy >= 100 && dy <= innerHeight - 120 &&
          (selectedResidentMarker.hidden ||
            // A label anchored at the same SEED door as the selected person's
            // feet must not cover their real 2D body (head distance was wrong).
            ownedDoorLabelClearOfResident(
              { x: dx, y: dy }, selectedResidentGroundScreen, selectedResidentScreen));
      if (visibleDoor) {
        const transform = `translate3d(${dx}px, ${dy}px, 0) translate(-50%, -190%)`;
        if (transform !== markedDoorTransform) {
          selectedHomeDoorMarker.style.transform = transform;
          markedDoorTransform = transform;
        }
        selectedHomeDoorMarker.hidden = false;
      } else selectedHomeDoorMarker.hidden = true;
    } else selectedHomeDoorMarker.hidden = true;
    if (!inspectedCode) {
      markedResidentCode = "";
      selectedDoorPoint = undefined;
      selectedHomeDoorMarker.dataset.homeEntrance = "";
    }
    if (dt > 1 / 30) slowFrameCount++;
    droppedFrameCount += Math.max(0, Math.floor(dt / (1 / 60)) - 1);
    applyDaylight(simulationTick,dt);
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
        const focusY = elevationToRenderY(Math.max(0, heightAt(view.x, view.z)));
        flatLabelPoint.set(
          localPoint.x - focusRender.x,
          PLANET_RADIUS + localPoint.y - focusY,
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
          new pc.Vec3(localPoint.x, localPoint.y, localPoint.z),
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
        // Town and village labels are buttons: click to centre on the settlement and open its card.
        if (place.kind === "city" || place.kind === "village") {
          label.classList.add("clickable");
          label.title = `About ${place.name}`;
          label.addEventListener("click", (event) => { event.stopPropagation(); openSettlementCard(place as (typeof places)[number]); });
        }
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
    // Selected travel route: projected from canonical points, blended like the labels.
    const projectOverlay: RouteProjector = (point) => {
      point.height ??= Math.max(0, heightAt(point.x, point.z)) + 3;
      const local = renderFrame.sourceToRender(point.x, point.z, point.height);
      if (projectionTransition <= 0.001) {
        const screen = camera.camera!.worldToScreen(new pc.Vec3(local.x, local.y, local.z));
        return { x: screen.x, y: screen.y };
      }
      // Handoff/globe: same flat-to-globe blend the place labels use.
      const focusRender = renderFrame.sourceToRender(view.x, view.z),
        focusY = elevationToRenderY(Math.max(0, heightAt(view.x, view.z)));
      flatLabelPoint.set(
        local.x - focusRender.x,
        PLANET_RADIUS + local.y - focusY,
        local.z - focusRender.z,
      );
      const flatScreen = camera.camera!.worldToScreen(flatLabelPoint),
        onFront = globe!.worldPoint(point.lon, point.lat, globePoint);
      if ((!onFront || globe!.frontness(globePoint) < 0.08) && projectionTransition > 0.55)
        return undefined;
      if (!onFront) return { x: flatScreen.x, y: flatScreen.y };
      const globeScreen = camera.camera!.worldToScreen(globePoint),
        t = projectionTransition;
      return {
        x: flatScreen.x + (globeScreen.x - flatScreen.x) * t,
        y: flatScreen.y + (globeScreen.y - flatScreen.y) * t,
      };
    };
    updateRouteOverlay(projectOverlay);
    updateContinuityOverlay(projectOverlay, flatToLonLat(view.x, view.z), { pending: inFlight, prepared: uploads.length, active: activeKeys.length, cached: tileCache.size });
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
      measuredStreamingFps = fps;
      statsElapsed = 0;
      frames = 0;
    }
    frameIntervalSamples.record(dt * 1000);
    cpuUpdateSamples.record(performance.now() - cpuUpdateStarted);
  });
  app.on("frameend", () => {
    // Read engine counters after rendering. Draw calls refer to the previous
    // completed frame; CPU frame excludes GPU execution/browser compositing.
    const stats = app.stats;
    engineCpuUpdateSamples.record(stats.cpuUpdateTime);
    cpuRenderSamples.record(stats.cpuRenderTime);
    drawCallSamples.record(stats.drawCallCount);
    if (cpuFrameStartedAt > 0) cpuFrameSamples.record(performance.now() - cpuFrameStartedAt);
    if (profileGpu) gpuFrameSamples.record(stats.gpuFrameTime);
  });
  // Only the genuine screenshot-tool session can briefly quiesce geometry
  // uploads and worker prefetch while continuing normal GPU frames, actor
  // animation, clock advancement, resident queries and Simulation validation.
  const capturePresentation = (window as Window & { __advisorCaptureMode?: boolean }).__advisorCaptureMode
    ? (() => {
        let captureRenderToken = 0, paintedToken = 0;
        return {
          // Acquire actual ready geometry and the optional-streaming hold in
          // the SAME JS turn, not across a browser screenshot round-trip.
          quiesceStreaming(freezeAfterFrame = false) {
            const state = (window as Window & {
              advisorWorld?: { state: { ready: boolean; settled: boolean; pending: number } };
            }).advisorWorld?.state;
            if (!state?.ready || !state.settled || state.pending !== 0) return 0;
            captureStreamingQuiesced = true;
            const token = ++captureRenderToken;
            if (freezeAfterFrame) {
              // Software WebGPU: finish ONE genuine PlayCanvas frame, then
              // stop new GPU submissions during browser compositor readback.
              // WebGL2 must keep presenting while only streaming is held.
              app.once("postrender", () => {
                // postrender fires before WebGPU submits the current frame.
                // Do not stop submissions until the following browser frame,
                // after the real rendered canvas had a chance to reach Chrome's
                // compositor. An earlier stop stranded 0-frame PNG evidence.
                requestAnimationFrame(() => {
                  if (captureStreamingQuiesced && token === captureRenderToken) {
                    paintedToken = token;
                    app.autoRender = false;
                  }
                });
              });
              app.renderNextFrame = true;
            }
            return token;
          },
          get paintedToken() { return paintedToken; },
          resumeStreaming() {
            // Invalidate a delayed one-shot callback before restoring normal
            // streaming and real-time rendering, including after capture errors.
            ++captureRenderToken;
            captureStreamingQuiesced = false;
            app.autoRender = true;
          },
        };
      })()
    : undefined;
  // Read-only diagnostic interface for deterministic generation and browser verification.
  Object.defineProperty(window, "advisorWorld", {
    value: {
      seed: WORLD_SEED,
      capturePresentation,
      cellAt,
      cellSeed,
      lightingEvidenceAtSource(x:number,z:number) { return featuresFor(tileForPosition(x,z,15)).filter(f => f.kind === "street-lamp"); },
      buildingEvidenceAtSource(x: number, z: number) {
        return featuresFor(tileForPosition(x, z, 9)).filter(feature => feature.widthM !== undefined).map(feature => ({
          code: feature.code, kind: feature.kind, x: feature.x, z: feature.z,
          widthM: feature.widthM, depthM: feature.depthM, house: feature.house,
          footprintAreaM2: feature.widthM! * feature.depthM!,
          storeys: feature.house?.storeys ?? (feature.kind === "keep" ? 3 : feature.service === "inn" ? 2 : 1),
        }));
      },
      wilderness: { nearby:nearbyWilderness },
      geography: { continents, countries, cities, villages, roads, roadJunctions, roadConnections, roadNetwork: roadNetworkTelemetry, population: macroPopulationSummary },
      continuity: { inspect: inspectRegion, terrainQuery, telemetry: () => ({ ...continuityTelemetry(), worker: continuityWorkerState }), clearDetail: clearContinuityDetail, setOverlay: setContinuityOverlay },
      hydrology: { topology: hydrologyTopology, access: freshwaterAccessAt, lakes: macroLakes, mountains: mountainSystems, anchors: finalSurfaceEvidenceAnchors, recipes: drainageRecipes, sampleSource: naturalSurfaceAt, toLonLat: sourceToLonLat, telemetry: hydrologyTelemetry },
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
      setHalfHeight(height: number) {
        navigate(view.x, view.z, height);
      },
      setBridgeInspectionAngle(enabled: boolean) {
        bridgeInspectionAngle = enabled;
        updateCamera();
      },
      navigation: {
        surfaceAtScreen,
        projectGround: projectTransportGround,
        setFocus(lon: number, lat: number) {
          if (lat > Math.PI / 2) notePoleLimit("north");
          else if (lat < -Math.PI / 2) notePoleLimit("south");
          const p = lonLatToFlat(lon, lat);
          navigate(p.x, p.z);
        },
        forceRebase() {
          if (rebaseRenderFrame(true)) updateCamera();
        },
      },
      renderer: rendererState,
      /** On-demand proof that an onscreen, clickable actor maps to its canonical Simulation resident. */
      residentEvidencePick() {
        const rect = canvas.getBoundingClientRect(), point = new pc.Vec3();
        for (const actor of actors) {
          const resident = actorResidents.get(actor);
          if (!actor.enabled || !resident || !hasResidentMesh(actor)) continue;
          const meshCount = (actor.findComponents("render") as pc.RenderComponent[])
            .reduce((count, render) => count + (render.enabled && render.entity.enabled ? render.meshInstances.length : 0), 0);
          camera.camera!.worldToScreen(actor.getPosition().clone().add(new pc.Vec3(0, actor.getLocalScale().y * DEFAULT_CHARACTER_HEIGHT_M * .5, 0)), point);
          const clientX = rect.left + point.x, clientY = rect.top + point.y;
          if (point.x < 12 || point.y < 12 || point.x > rect.width - 12 || point.y > rect.height - 12) continue;
          if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
          if (pickResidentAt?.(clientX, clientY)?.code !== resident.code) continue;
          return { code: resident.code, homeEntrance: resident.homeEntrance,
            workplace: resident.workplace, task: resident.task, route: resident.route,
            clientX, clientY, tick: simulation.tick, meshCount };
        }
        return null;
      },
      /** Read-only, bounded explanation of why real resident meshes fail a canvas click.
       * The screenshot gate must never substitute these counts for visual evidence. */
      residentEvidenceDiagnosis() {
        const rect = canvas.getBoundingClientRect(), point = new pc.Vec3();
        const counts = { enabled: 0, withResident: 0, withMesh: 0, onScreen: 0, unoccluded: 0, pickMatched: 0 };
        const samples: { index: number; mesh: boolean; x: number; y: number; depth: number; obstruction: string; pickMatched: boolean }[] = [];
        for (const actor of actors) {
          if (!actor.enabled) continue;
          counts.enabled++;
          const resident = actorResidents.get(actor);
          if (!resident) continue;
          counts.withResident++;
          const mesh = hasResidentMesh(actor);
          if (mesh) counts.withMesh++;
          camera.camera!.worldToScreen(actor.getPosition().clone().add(new pc.Vec3(0, actor.getLocalScale().y * DEFAULT_CHARACTER_HEIGHT_M * .5, 0)), point);
          const onScreen = point.x >= 12 && point.y >= 12 && point.x <= rect.width - 12 && point.y <= rect.height - 12;
          if (onScreen) counts.onScreen++;
          const clientX = rect.left + point.x, clientY = rect.top + point.y,
            obstruction = onScreen ? document.elementFromPoint(clientX, clientY) : null,
            unobstructed = obstruction === canvas,
            pickMatched = mesh && unobstructed && pickResidentAt?.(clientX, clientY)?.code === resident.code;
          if (unobstructed) counts.unoccluded++;
          if (pickMatched) counts.pickMatched++;
          if (samples.length < 8)
            samples.push({ index: resident.index, mesh, x: Math.round(point.x), y: Math.round(point.y),
              depth: Math.round(point.z * 100) / 100, obstruction: !onScreen ? "offscreen" : unobstructed ? "canvas" : obstruction?.id || obstruction?.tagName || "none",
              pickMatched: !!pickMatched });
        }
        return { ...counts, samples };
      },
      get state() {
        const residentMode = residentViewQuery(view.halfHeight, !$("travel-panel").hidden, ready),
          residentRequest = residentMode.inspect ? residentRequestForView(simulation.tick, residentQueryLimitForView(residentMode.actors), residentMode.actors) : undefined,
          residentViewReady = !residentRequest || residentQueries.readyFor(residentRequest.key, residentRequest.tick);
        const flatReady = flatCoverageReady(),
          destinationReady = destinationCoverageReady(flatReady),
          activePreparationWaitMs = handoffWaitingForDestination
            ? handoffPreparationWaitMs +
              performance.now() -
              handoffPreparationStarted
              : handoffPreparationWaitMs,
          readyGeometryBytes = uploads.reduce(
            (sum, upload) => sum + estimateGeometryBytes(upload.data),
            0,
          ),
          surfaceBytes = globe!.stats.textureWidth * globe!.stats.textureHeight * 4,
          surfaceGpuBytes = Math.ceil(surfaceBytes * 4 / 3);
        return {
          ready,
          error: errorText,
          presentation:
            projectionTransition <= 0.001
              ? "flat"
              : projectionTransition >= 0.999
                ? "globe"
                : "transition",
          surface: { ...SURFACE_PRESENTATION, detailWeight: surfaceDetail, lodBlending: Boolean(lodTransition), textureWidth: globe!.stats.textureWidth, activeTileSizes: [...new Set(activeKeys.map(key => tileCache.get(key)!.tile.size))] },
          scaleLabel: scaleLabelForHalfHeight(view.halfHeight),
          canonicalFootprintM: canonicalFootprintForHalfHeight(view.halfHeight),
          navigation: {
            focus: flatToLonLat(view.x, view.z),
            heading: -view.yaw || 0,
            ruler: { ...rulerState },
            labels: labelState,
            selectedCanonicalId: selectedCode || null,
            poleLimit: {
              side: poleLimit,
              active: Boolean(poleLimit && performance.now() < poleLimitUntil),
              stops: poleStopCount,
            },
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
            outstandingGeneration: inFlight + uploads.length,
            slowFrames: slowFrameCount,
            droppedFrames: droppedFrameCount,
          },
          globe: {
            passes: globePass,
            complete: globeCoverageReady(),
            fit: globeFit,
            ...globe!.stats,
          },
          performance: {
            backend: device.deviceType,
            deviceClass: streamingBudget.deviceClass,
            budget: { ...streamingBudget },
            // CPU update excludes GPU/browser paint; frame interval is scheduling cadence.
            cpuUpdateMs: cpuUpdateSamples.summary(),
            frameIntervalMs: frameIntervalSamples.summary(),
            cpuFrameMs: cpuFrameSamples.summary(),
            cpuEngineUpdateMs: engineCpuUpdateSamples.summary(),
            cpuRenderMs: cpuRenderSamples.summary(),
            inputHandlerMs: inputHandlerSamples.summary(),
            gpuFrameMs: gpuFrameSamples.samples ? gpuFrameSamples.summary() : null,
            drawCalls: app.stats.drawCallCount,
            drawCallSamples: drawCallSamples.summary(),
            // PlayCanvas release builds cannot count submitted triangles:
            // primitiveCount is unavailable, and terrain mesh totals are not
            // submitted/drawn geometry. Never invent a triangle count.
            triangles: null,
            primitivesSubmitted: app.stats.primitiveCount ?? null,
            entities: app.root.find(() => true).length + 1,
            engineVramBytesEstimated: app.stats.vramTotalBytes,
            longFrameCount: slowFrameCount,
            rendererLossCount,
            presentation: projectionTransition <= 0.001 ? "flat" : projectionTransition >= 0.999 ? "globe" : "transition",
            scaleLabel: scaleLabelForHalfHeight(view.halfHeight),
            continuousFootprintM: canonicalFootprintForHalfHeight(view.halfHeight),
            projectionTransition,
            renderScale: app.graphicsDevice.maxPixelRatio / (devicePixelRatio || 1),
            devicePixelRatio: app.graphicsDevice.maxPixelRatio,
            workerMs: { ...workerGenerationSamples.summary(), completed: workerGenerationSamples.samples },
            // Diagnostics only: coverage and detail are different workloads. No samples feed world logic.
            workerPhasesMs: workerPhaseSamples.summary(),
            uploadMs: { ...uploadSamples.summary(), uploadsThisFrame },
            residentQueryMs: residentPhaseTimings.acceptedResponseMs.summary(),
            residentQueryPhases: residentPhaseTimings.summary(),
            residentStartupMilestonesMs: {
              workerReady: workerStartupMs || null,
              coherentTerrainFromWorkerStart: firstCoherentTerrainSinceWorkersMs,
              firstResidentOfferFromWorkerStart: firstResidentOfferSinceWorkersMs,
              firstResidentDispatchFromWorkerStart: firstResidentDispatchSinceWorkersMs,
              firstAcceptedResidentFactFromFirstOffer: firstResidentFactMs,
            },
            residentPickMs: residentPickSamples.summary(),
            firstResidentFactMs,
            residentFactStatus: !residentRequest ? "not-requested" : residentViewReady ? "ready" : !ready ? "pending-world" : residentQueries.busy ? "pending-worker" : "pending-dispatch",
            maxGenerationReadyObserved,
            activePatches: [...tileCache.values()].filter(record => record.entity.enabled).length,
            preparedPatches: uploads.length,
            cachedPatches: tileCache.size,
            pendingGeneration: inFlight,
            readyUploads: uploads.length,
            generationReady: generationReadyInUse(),
            cacheHits,
            cacheMisses,
            evictions,
            discardedPresentationJobs,
            detailGenerationJobs, coverageGenerationJobs, meshGroupUploads,
            activeDetailInstances: activeKeys.map(key=>({key,serial:tileCache.get(key)?.serial})) ,
            cpuResourceBytesEstimated: cachedGeometryBytes + readyGeometryBytes + surfaceBytes + continuityCpuBytes(),
            combinedResourceBytesEstimated: cachedGeometryBytes + readyGeometryBytes + surfaceBytes + continuityCpuBytes() + cachedGeometryBytes + surfaceGpuBytes,
            cacheTrimStartBytes: streamingBudget.cacheTrimStartBytes,
            memoryCeilingBytes: streamingBudget.combinedBytes,
            continuityCpuBytesEstimated: continuityCpuBytes(),
            gpuResourceBytesEstimated: cachedGeometryBytes + surfaceGpuBytes,
            sharedSurfaceBytes: surfaceBytes,
            uploadsThisFrame,
            maxUploadsPerFrame,
            canonicalKeysUnique: new Set(activeKeys).size === activeKeys.length,
            activeCanonicalKeys: [...activeKeys],
            wantedCanonicalKeys: wanted.map((tile) => tile.key),
            poleStops: poleStopCount,
            withinBudget: withinStreamingBudget(
              {
                generationReady: generationReadyInUse(),
                activePatches: [...tileCache.values()].filter(record => record.entity.enabled).length,
                cachedPatches: tileCache.size,
                cpuBytes: cachedGeometryBytes + readyGeometryBytes + surfaceBytes + continuityCpuBytes(),
                gpuBytes: cachedGeometryBytes + surfaceGpuBytes,
              },
              streamingBudget,
            ),
          },
          view: { ...view },
          fps,
          active: activeKeys.length,
          cached: tileCache.size,
          pending: pending.size,
          levels: [
            ...new Set(activeKeys.map((key) => tileCache.get(key)!.tile.level)),
          ],
          coverage: {layerDebug:{previewLayerId:coverageTerrainLayer.id,rootLayerId:coarseTerrainLayer.id,valid:app.scene.layers.getLayerById(coverageTerrainLayer.id)===coverageTerrainLayer && coverageTerrainLayer.id!==pc.LAYERID_DEPTH && coverageTerrainLayer.id!==pc.LAYERID_WORLD,meshes:coverageTerrainLayer.meshInstances.length,culled:coverageTerrainLayer.getCulledInstances(camera.camera!.camera).opaque.length,worldMeshes:app.scene.layers.getLayerById(pc.LAYERID_WORLD)?.meshInstances.length ?? -1,worldCulled:app.scene.layers.getLayerById(pc.LAYERID_WORLD)?.getCulledInstances(camera.camera!.camera).opaque.length ?? -1,cameraLayers:[...camera.camera!.layers],nearClip:camera.camera!.nearClip,farClip:camera.camera!.farClip,cameraPosition:camera.getPosition().toString(),flatRootEnabled:flatRoot.enabled},canonicalKeys:coverageTiles.map(t=>t.key),visibleCanonicalKeys:coverageTiles.filter(t=>tileCache.get(coverageKey(t))?.entity.enabled).map(t=>t.key),complete:!selectionDirty && coverageComplete, durationMs:coverageDurationMs, prepared:coverageTiles.filter(t=>tileCache.has(coverageKey(t))).length, wanted:coverageTiles.length, workerStartupMs, generationWorkers, readyWorkers, busyWorkers: inFlight + residentRunningWorkers(), pixelRatio: app.graphicsDevice.maxPixelRatio, nativePixelRatio: devicePixelRatio, deviceMemoryGB: deviceMemoryGB ?? null, cacheBudgetMB: Math.round(streamingBudget.cacheTrimStartBytes / 1e6), lastGenerationTiming, prefetchedTiles: prefetched, prefetchQueue: prefetchQueue.length, cachedTiles: tileCache.size, cachedGeometryMB: Math.round(cachedGeometryBytes/1e6)},
          simulation: { ...simulation.stats, residentWorkerBusy: residentQueries.busy, residentSnapshotReady: residentViewReady, residentSnapshotTick: residentQueries.current?.tick ?? null },
          settled:
            residentViewReady &&
            !lodTransition &&
            Math.abs(surfaceDetail - (globeCoverageReady() ? localDetailWeight(view.halfHeight) : 1)) < 0.002 &&
            Math.abs(projectionTransition - desiredProjectionTransition) <=
              0.001 &&
            (desiredProjectionTransition <= 0.001 || globeCoverageReady()) &&
            (!globeShown || globeCoverageReady()) &&
            !selectionDirty &&
            pending.size === 0 &&
            activeKeys.length === wanted.length &&
            activeKeys.every((key) => wanted.some((t) => t.key === key)),
          roadRepresentation: roadRepresentationAtScale(scaleValueForHalfHeight(view.halfHeight)),
          roadPresentation: roadVisibleAtScale(scaleValueForHalfHeight(view.halfHeight)) ? "visible" : "hidden",
          settlementPresentation: settlementDetailVisible ? "buildings" : "icons",
          smallDetailsVisible,
          lighting: {displayed:displayedDaylight,target:targetDaylight},
          closeLighting: {enabled: closeLightingVisible, eveningWeight: eveningGlow, addedPointLights: 0},
          visibleResidents: actors.filter(actor => actor.enabled).length,
          residentPresentation: {
            logicalResidents: simulation.stats.logicalResidents,
            pooledActors: actors.length,
            visibleActors: actors.filter(actor => actor.enabled).length,
            format: "skinned-3d", generatedActors: actors.filter(actor => actor.enabled && actor.tags.has("generated-npc")).length, enabledActors: actors.filter(actor => actor.enabled).length, firstActor: (() => { const actor = actors.find(item => item.enabled); return actor ? { position: actor.getPosition().toString(), scale: actor.getLocalScale().toString() } : null; })(),
            physicalHeightsM: actors.filter(actor => actor.enabled).map(actor => actor.getLocalScale().y * DEFAULT_CHARACTER_HEIGHT_M * CANONICAL_METRES_PER_SOURCE_UNIT),
            worldHeightsM: actors.filter(actor => actor.enabled).map(actor => Math.abs(actor.getRotation().transformVector(new pc.Vec3(0, actor.getLocalScale().y * DEFAULT_CHARACTER_HEIGHT_M, 0)).y) * CANONICAL_METRES_PER_SOURCE_UNIT),
            activeScheduleRecords: simulation.stats.activeScheduleRecords,
            evaluatedCandidates: simulation.stats.query.evaluatedResidents,
          },
          visibleGeometryTriangles: Object.fromEntries(
            ["terrain", "structures", "nature", "streetTrees", "detail", "closeDetail", "nightGlow", "lampPools"].map(name => [name,
              [...tileCache.values()].filter(record => record.entity.enabled).reduce((sum,record) =>
                sum + (record.entity.children as pc.Entity[]).filter(child => child.name === name && child.enabled)
                  .reduce((count,child) => count + (child.render?.meshInstances ?? []).reduce((n,instance) =>
                    n + (instance.mesh?.primitive[0]?.count ?? 0) / 3,0),0),0),
            ]),
          ),
          visibleMeshes: Object.fromEntries(
            ["terrain", "structures", "nature", "streetTrees", "detail", "closeDetail", "nightGlow", "lampPools"].map((name) => [
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
