import { residentFootRingGeometry } from "./resident-foot-ring.ts";
import { separateVisibleActors } from "./actor-separation.ts";
import { createAmbientChatter, type ChatterActor } from "./ambient-chatter.ts";
import { setupUiShell } from "./ui-shell.ts";
import { emptyInventory, itemsHeldBy, parseInventory, seededItems, serializeInventory, type InventoryState } from "./inventory.ts";
import { performItemTransfer } from "./item-transfer.ts";
import { isNightSecond, litBuildingCodes, litSetKey, mergeGlowGeometry, type LitBuilding } from "./night-lighting.ts";
import { ResidentQueryQueue, mergeResidentQueries, currentResidentSnapshot, residentDispatchAllowed, residentMayTakeIdleWorker, residentColdQueryCanStart, residentActorSnapshotMayMarkPresented, residentWorkerShardPlan, terrainWorkerIndexAvoidingWarmResident, residentActorPickDistance, residentActorPaintedTapFraction, residentActorPickPrefersFront, residentActorInFront, nearestPickableKeyboardResident, residentMotionFraction, residentWalkingPolyline, residentWalkingHeadingDelta, residentStationaryWithinActivity, residentStationaryPartialCarryover, selectedResidentVisibleInView, selectedResidentCurrentCarryover, inspectedResidentSource, residentLabelRightOfActor, ownedDoorLabelClearOfResident, residentQueryLimitForView, residentGateWatchFocus, activeResidentWorkers, type ResidentQuery, type ResidentQueryJob, type ResidentQueryResult } from "./resident-query.ts";
import { TIME_SCALE } from "./clock.ts";
import { createWildernessOverlay } from "./wilderness-overlay.ts";
import { nearbyWilderness } from "./wilderness.ts";
import { compareText } from "./compare-text.ts";
import {SETTLEMENT_ICON_FROM_SCALE, settlementSmallDetailsVisible} from "./political-presentation.ts";
import {closeLightingEnabled, closeLightingWeight, eveningLightWeight} from "./street-lighting.ts";
import {coverageKey, tileJobKey, nextStreamingJob, progressiveDetailKeys, visibleCoverageKeys, type TileJobKind} from "./streaming-coverage.ts";
import { terrainProgressText, terrainLoadingMessage, residentFactSuffix, terrainDetailLabel, initialWorldReady } from "./readiness-presentation.ts";
import {elevationToRenderY, visibleSurfaceElevation, tiltedGroundPickDistance, firstComposedSurfaceRayHitDistance} from "./render-frame.ts";
import * as pc from "playcanvas";
import { loadDefaultCharacter, DEFAULT_CHARACTER_HEIGHT_M } from "./default-character.ts";
import { characterDrawableMeshes, summarizeCharacterPresentations } from "./character-model-policy.ts";
import { labelAnchorFingerprint, labelLayoutNeedsMeasurement } from "./label-layout-cache.ts";
import { setText } from "./idle-write-guard.ts";
import { CHARACTER_TYPES, characterHeightM } from "./characters.ts";
import { metresToSource } from "./physical-scale.ts";
import { nearbyCriticalSites } from "./sites.ts";
import { settlementHomeFor, settlementExteriorFor } from "./settlement-exterior.ts";
import { daylightAt, daylightAtLongitude, advanceDaylight, type Daylight } from "./daylight.ts";
import { FANTASY_DAY_SECONDS, clockLabel, fantasySecondOfDay, localDayIndex, localSecondOfDay, localWeekday, timeZoneOffsetHours } from "./clock.ts";
import { anchorNames, hideNpcPopup, npcPopupCode, residentObservationPoint, residentFocusPoint, setPopupNavigator, setSiteVisitAdvisor, setItemGiveAdvisor, setBelongingsReader, popupFocusHalfHeight, popupOwnedHomeFacing, ownedDoorPinAtFocus, type OwnedDoorViewPin, showBuildingPopup, showNpcPopup, showSettlementPopup, showWildernessPopup, type BuildingInfo } from "./npc-popup.ts";
import type { Resident } from "./simulation.ts";
import { wrapSourceX } from "./planet.ts";
import "./style.css";
import "./ui-kit.css";
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
  type Place,
} from "./geography.ts";
import type { Geometry, TileGeometry } from "./geometry.ts";
import { isGeometryLayer } from "./geometry-core.ts";
import { terrainTint } from "./geometry.ts";
import { macroLakes, mountainSystems } from "./macro-geography.ts";
import { climateSampleAt } from "./climate.ts";
import { drainageRecipes, hydrologyTelemetry, hydrologyTopology, freshwaterAccessAt, naturalSurfaceAt } from "./hydrology.ts";
import { forestBodiesVisibleAtScale, roadRepresentationAtScale, roadVisibleAtScale, reliefSceneryVisible, LOD_BLEND_SECONDS, SURFACE_PRESENTATION, createTerrainMaterial, installLodCoverage, installLitSurfaceDetail, localDetailWeight } from "./surface-presentation.ts";
import { AdvisorPanel } from "./advisor-panel.ts";
import { getProtagonistCode, restoreProtagonist, setProtagonistCode, subscribeProtagonist } from "./protagonist.ts";
import { adviceVerdict, eveningAdviceFor, loadCharacter, saveCharacter } from "./character-state.ts";
import { dailyPlan } from "./routines.ts";
import { resolveCampaign, type CampaignRecord } from "./campaign.ts";
import { WORLD_FOUNDATION_VERSION, workerNameForSeed } from "./config.ts";
import { WORLD_FAILURE_EVENT } from "./seed-recovery.ts";
import {
  LEGACY_SITE_VISITS_KEY,
  inventoryStorageKey,
  legacyInventoryKey,
  commitJournal,
  emptyJournal,
  importLegacySiteVisits,
  loadJournal,
  projectSiteVisits,
  recordSiteVisits,
  type CampaignJournal,
} from "./campaign-journal.ts";
import { CampaignPanel } from "./campaign-panel.ts";
import { startOverCampaign } from "./seed-dialog.ts";
import { buildLedger } from "./memory-ledger.ts";
import { describeDeviceLoss, describeRecovery, type PreservedState, type RebuildTarget, type RecoveryReport } from "./renderer-recovery.ts";
import { LazySimulation, populationOf, guardCoverageAt, dutyGuardCodesNearView, residentOccupiesBuilding, residentInsideRenderedService, residentViewQuery, residentOrderFor, residentWalkableSurface, itemExchangeLegalBetween } from "./simulation.ts";
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
  shouldTrimCombinedBytes,
  streamingMemoryReservationFits,
  canPrefetchStreamingJob,
  generationWorkerCount,
  streamingBudgetForPool,
  UPLOAD_FRAME_BUDGET_MS,
  type StreamingBudget,
} from "./streaming.ts";
import { nextPixelRatio, RESOLUTION_DECISION_SECONDS } from "./render-resolution.ts";
import { residentGpuHitAllows } from "./resident-gpu-pick.ts";
import { structuralMeshBlocksSegment, residentOcclusionReachDepth } from "./resident-scene-occlusion.ts";
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
const continuityCpuBytes = () => continuityRetainedBytes() + continuityTransientBytes();
/**
 * Retained continuity cost: data the app keeps for the life of the page.
 */
const continuityRetainedBytes = () => {
  const state = continuityTelemetry();
  const atlasBytes = (window as unknown as { politicalAtlas?: { state: { presentationBytesEstimated?: number } } })
    .politicalAtlas?.state.presentationBytesEstimated || 0;
  return atlasBytes + continuityWorkerBytes + state.cpuBytesEstimated + continuityOverlayBytes();
};
/**
 * Transient continuity cost: worker scratch and the in-progress globe surface
 * buffer. These are real memory while work is in flight but are released
 * afterwards, so they must not be reported as permanently retained.
 */
const continuityTransientBytes = () => {
  const state = continuityTelemetry(),
    preparingBytes = globeWorker
      ? state.coarseRegistryBytesEstimated + state.hydrologyCpuBytesEstimated + 4096 * 1024 + (GLOBE_PASSES[globePass]?.width || 0) ** 2 * 2
      : 0;
  return inFlight * NATURAL_WORKER_SCRATCH_RESERVE_BYTES + preparingBytes;
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
let initialWorldComplete = false;
const LOAD_MESSAGES = ["Reading the land from its seed…", "Raising mountains…", "Filling the rivers…", "Paving the roads…", "Building the villages…", "Polishing the castle…", "Waking the advisors…"];
/** Monotonic, honest progress: worker start is 15 %, the rest is the share of terrain tiles prepared. */
function setLoadingProgress(percent: number) {
  const next = Math.max(loadPercent, Math.min(100, Math.round(percent)));
  if (next === loadPercent && next !== 0) return;
  loadPercent = next;
  const bar = $("loading-bar");
  $("loading-fill").style.width = `${next}%`;
  $("loading-percent").textContent = terrainProgressText(next);
  bar.setAttribute("aria-valuenow", String(next));
  $("loading-text").textContent = terrainLoadingMessage(next, LOAD_MESSAGES[Math.min(LOAD_MESSAGES.length - 1, Math.floor(next / (100 / LOAD_MESSAGES.length)))]);
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
/**
 * Occupancy-gated window glow, one merged mesh per rendered tile. `key` is the
 * sorted set of lit building codes currently baked into the mesh, so a rebuild
 * only happens on a real change. Presentation only; occupancy comes from the
 * authoritative Simulation resident snapshot.
 */
const buildingGlowTiles = new Map<string, {
  buildings: readonly import("./geometry-core.ts").NightGlowBuilding[];
  entity: pc.Entity;
  mesh: pc.Mesh;
  key: string;
}>();
let buildingGlowKey = "";
/**
 * Re-bake the occupancy-gated window glow. Runs on a coarse timer (not every
 * frame) and only rebuilds a tile when its lit-building set actually changed.
 * Unknown occupancy fails dark: no snapshot, no light.
 */
function refreshBuildingGlow(tick: number, force = false) {
  if (!buildingGlowTiles.size) return;
  const now = performance.now();
  if (!force && now - lastBuildingGlowCheck < 400) return;
  lastBuildingGlowCheck = now;
  const focusLon = flatToLonLat(view.x, view.z).lon,
    second = localSecondOfDay(tick, focusLon),
    night = isNightSecond(second),
    visible = layers.structures && settlementDetailVisible && smallDetailsVisible &&
      closeLightingVisible && eveningGlow > GLOW_VISIBILITY_EPSILON,
    residents = night && visible ? (residentQueries.current?.residents ?? []) : [],
    all: LitBuilding[] = [];
  for (const tile of buildingGlowTiles.values()) for (const building of tile.buildings) all.push(building);
  const lit = visible ? litBuildingCodes(residents, all, second) : new Set<string>(),
    key = `${night ? "n" : "d"}/${visible ? "v" : "h"}/${buildingGlowTiles.size}/${[...buildingGlowTiles.keys()].join(",")}/${litSetKey(lit)}`;
  if (key === buildingGlowKey) return;
  buildingGlowKey = key;
  let rendered = 0;
  for (const [jobKey, tile] of buildingGlowTiles) {
    if (!tile.entity.enabled && !tile.entity.parent) { buildingGlowTiles.delete(jobKey); continue; }
    const merged = mergeGlowGeometry(
      tile.buildings.filter((building) => lit.has(building.code)).map((building) => building.geometry));
    if (!merged) { tile.entity.enabled = false; continue; }
    rendered++;
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(merged.positions);
    mesh.setNormals(merged.normals);
    mesh.setColors32(merged.colors);
    mesh.setIndices(merged.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    const instance = tile.entity.render?.meshInstances[0];
    if (!instance) { tile.entity.enabled = false; continue; }
    instance.mesh = mesh;
    tile.mesh = mesh;
    tile.entity.enabled = true;
  }
  buildingGlowStats = { lit: lit.size, rendered, tiles: buildingGlowTiles.size, night, codes: [...lit].sort() };
  buildingGlowEvidence = all.filter((building) => lit.has(building.code))
    .map((building) => ({ code: building.code, kind: building.kind, x: building.x, z: building.z }));
}
let lastBuildingGlowCheck = 0;
/** Read-only evidence counters for the current gated window glow. */
let buildingGlowStats = { lit: 0, rendered: 0, tiles: 0, night: false, codes: [] as string[] };
/** Read-only list of currently lit buildings (code + canonical source point). */
let buildingGlowEvidence: { code: string; kind: string; x: number; z: number }[] = [];
let revision = 0,
  inFlight = 0,
  selectionDirty = true,
  cacheHits = 0,
  cacheMisses = 0,
  evictions = 0,
  /** Real trim passes that actually released reusable cache (WP-S009-003-001). */
  cacheTrimEvents = 0,
  cacheTrimmedBytes = 0,
  /** High-water mark of the combined CPU+GPU pressure the trim policy sees. */
  peakCachePressureBytes = 0,
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
 // Camera-only label for a real validated SEED owned home; never a world actor or collision.
 let focusedOwnedDoorPin: OwnedDoorViewPin | undefined;
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
const residentPlacesById = new Map(places.map(place => [place.id, place]));
// Preserve a complete source-space search window across small camera pans.
// Camera motion changes presentation only, never SEED or the query's authority.
let residentSearchWindow: Omit<ResidentQuery, "tick"> | undefined;
// Resident index construction is cold and expensive: reuse its owning worker.
const warmedResidentWorkers = new Set<number>();
let residentResultReady = () => {};
function residentRequestForView(tick: number, limit: number, actors: boolean): ResidentQuery | undefined {
  const place = nearestPlace(view.x, view.z);
  if (!place) return;
  const bounds = viewBounds(view), lonScale = Math.max(.02, Math.abs(Math.cos(flatToLonLat(view.x, view.z).lat))),
    viewportRadius = Math.hypot(view.halfHeight * view.aspect,
      view.halfHeight / Math.sin(view.elevationAngle ?? cameraElevationForHalfHeight(view.halfHeight))) / lonScale * 1.1,
    previous = residentSearchWindow,
    displacement = previous ? Math.hypot(wrapSourceX(view.x - previous.x), view.z - previous.z) : Infinity;
  if (!previous || previous.placeCode !== place.code || previous.actors !== actors ||
      previous.limit !== limit || displacement + viewportRadius > previous.radius) {
    // Reuse the existing viewBounds prefetch margin without enlarging cold
    // population work; camera-only drags cannot invalidate visible actors.
    const radius = Math.hypot(bounds.rx / lonScale, bounds.rz) * 1.1;
    residentSearchWindow = {
      key: `${place.code}|${view.x}|${view.z}|${radius}|${limit}|${actors}`,
      placeCode: place.code, x: view.x, z: view.z, radius, limit, actors,
    };
  }
  return { ...residentSearchWindow!, tick };
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
    // Terrain that the view still needs outranks a resident query for the last idle worker.
    const terrainOutstanding = !early && nextStreamingJob(tileAt(0, 0, 0), wanted, coverageTiles,
        { has: (key: string) => tileCache.has(key) || pending.has(key) }) !== undefined,
      available = early ? 1 : residentMayTakeIdleWorker(idleWorkers.length, terrainOutstanding) ? generationLimit() - generationReadyInUse() : 0;
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
/** The seed each worker reported building, by worker; diagnostic proof that workers share the page's world. */
const workerSeeds = new Map<string, unknown>();
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
// An explicit gate-watch camera visit may show only physically verified
// Simulation residents while the cold full population worker is still busy.
let focusedWatchCodes: string[] = [];
let lastDutyGuardRevision = "";
/** Walking actors: positions at this and the next simulation second, animated per frame. */
const actorMotion = new Map<pc.Entity, { points: { x: number; z: number }[]; lengths: number[]; total: number; startTick: number }>();
/** Set once the renderer exists: the resident whose sprite is under a screen point, if any. */
let pickResidentAt: ((clientX: number, clientY: number) => Resident | undefined) | undefined;
let pickResidentByKeyboard: (() => { resident: Resident; clientX: number; clientY: number } | undefined) | undefined;
let verifyResidentAtTap: ((resident: Resident, x: number, y: number) => Promise<boolean>) | undefined;
let residentPickGeneration = 0;
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

/** The exposed canonical ground, deck or water is shared by camera and overlay anchors. */
function localVisibleSurfaceHeight(x: number, z: number): number {
  return Math.max(0, visibleSurfaceElevation(finalSurfaceAt(x, z)));
}

function flatWorldPoint(x: number, z: number, y: number): pc.Vec3 {
  const point = renderFrame.sourceToRender(x, z, y);
  if (projectionTransition <= 0.001)
    return new pc.Vec3(point.x, point.y, point.z);
  const focus = renderFrame.sourceToRender(view.x, view.z),
    focusY = elevationToRenderY(localVisibleSurfaceHeight(view.x, view.z));
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
      : elevationToRenderY(localVisibleSurfaceHeight(view.x, view.z));
  const planeDistance = (yPlane - origin.y) / direction.y;
  if (!Number.isFinite(planeDistance) || planeDistance < 0) return undefined;
  // The flat-plane pointer drifts away from the visibly graded street/riverbank
  // when the player explicitly tilts the 3D camera. Refine on the same legal
  // composed final surface; steep/unwalkable cliffs keep the safe plane pick.
  const distance = bridgeInspectionAngle && projectionTransition <= 0.001
    ? tiltedGroundPickDistance(planeDistance, lens.farClip, direction.y,
        t => origin.y + t * direction.y,
        t => {
          const source = renderFrame.renderToSource(
            origin.x + t * direction.x, origin.z + t * direction.z);
          const surface = finalSurfaceAt(source.x, source.z);
          return surface.walkable
            ? elevationToRenderY(Math.max(0, visibleSurfaceElevation(surface)))
            : NaN;
        })
    : planeDistance;
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
  // bootstrap.ts listens until the world is ready: a seed that cannot form a world is recovered there.
  try { window.dispatchEvent(new CustomEvent(WORLD_FAILURE_EVENT, { detail: message })); } catch { /* reporting only */ }
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
    name: workerNameForSeed(WORLD_SEED),
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
    workerSeeds.set("globe", event.data.seed);
    if (event.data.seed !== WORLD_SEED) {
      fail(`Globe worker built seed ${event.data.seed}, but this page uses ${WORLD_SEED}`);
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
    targetY = elevationToRenderY(localVisibleSurfaceHeight(view.x, view.z)),
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
    // Zoom changes the orthographic footprint, never the local view pitch.
    // Only an explicit bridge-inspection action may use a distinct fixed angle.
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
  if (name === "nature") return layers.nature && reliefSceneryVisible(forestBodiesVisible, bridgeInspectionAngle);
  if (name === "streetTrees") return layers.nature && layers.structures && settlementDetailVisible && smallDetailsVisible && reliefSceneryVisible(forestBodiesVisible, bridgeInspectionAngle);
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
/**
 * Combined CPU+GPU pressure for the single admission/trim ceiling, computed on
 * the SAME basis as the resource ledger so the two can never disagree about
 * whether the app is inside its approved budget. Device VRAM already contains
 * the terrain GPU buffers and the globe surface, so those narrow estimates are
 * omitted when the device reports; they remain when it does not. See
 * buildLedger() in memory-ledger.ts.
 */
function combinedResourcePressureBytes(): number {
  const ready = uploads.reduce((sum, job) => sum + estimateGeometryBytes(job.data), 0);
  const surface = globe ? globe.stats.textureWidth * globe.stats.textureHeight * 4 : 0;
  const vram = measureDeviceVram();
  const assets = vram ? { textures: 0, meshes: 0 } : measureAssetBytes();
  const cpu = cachedGeometryBytes + ready + continuityCpuBytes() + (vram ? 0 : surface);
  const gpu = ready + (vram ? vram.total : cachedGeometryBytes + Math.ceil(surface * 4 / 3) + assets.textures + assets.meshes);
  return cpu + gpu;
}
function prefetchNext(root: Tile) {
  void root;
  const fingerprint = `${wanted.map((tile) => tile.key).join(",")}|${Math.round(view.x)}|${Math.round(view.z)}`;
  if (fingerprint !== prefetchFingerprint) { prefetchFingerprint = fingerprint; prefetchQueue = prefetchCandidates(); warmSettlements(); }
  // Leave headroom below the ceiling so optional warming can never trigger a trim.
  if (combinedResourcePressureBytes() > streamingBudget.cacheTrimStartBytes * .85) return;
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
      if (!isGeometryLayer(g)) continue;
      const mesh = uploadGeometry(g, entity, name, name === "terrain" ?
        (next.kind === "coverage" || next.tile.level === 0 ? coarseTerrainMaterial! : terrainMaterial!) : name === "nightGlow" ? nightGlowMaterial! : name === "lampPools" ? lampPoolMaterial! : material, next.kind === "coverage");
      if (mesh) meshes.push(mesh);
    }
    entity.enabled = false;
    applyTileRenderTransform(next.tile, entity);
    flatRoot.addChild(entity);
    // Per-building window glow: one merged additive mesh per tile, rebuilt only
    // when Simulation-reported occupancy changes. Empty homes stay dark.
    const glowBuildings = (next.data as TileGeometry).nightGlowByBuilding;
    if (glowBuildings?.length) {
      const glowMesh = new pc.Mesh(app.graphicsDevice);
      const glowEntity = new pc.Entity("nightGlowHomes");
      glowEntity.addComponent("render", {
        meshInstances: [new pc.MeshInstance(glowMesh, nightGlowMaterial!)],
        layers: [pc.LAYERID_WORLD],
        castShadows: false,
        receiveShadows: false,
      });
      glowEntity.enabled = false;
      entity.addChild(glowEntity);
      buildingGlowTiles.set(next.jobKey, {
        buildings: glowBuildings, entity: glowEntity, mesh: glowMesh, key: "",
      });
    }
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
    // Make coherent terrain interactive immediately, but 100% means the
    // required scene and first authoritative resident facts are also ready.
    // Remaining stages continue to report through the visible tile status.
    setLoadingProgress(99);
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
    const readyBytes = () => uploads.reduce((sum, job) => sum + estimateGeometryBytes(job.data), 0);
    // Only urgent generation/upload may make room below the ceiling. Optional prefetch cannot evict reusable data.
    const reservationBytes = readyBytes() + (inFlight === 0 && uploads.length === 0 && nextStreamingJob(root,wanted,coverageTiles,cachedKeys) ? NATURAL_WORKER_SCRATCH_RESERVE_BYTES : 0);
    // The trim trigger uses the ledger's own combined basis, so the reported
    // budget and the eviction policy can never disagree.
    const cachePressureBytes = () => combinedResourcePressureBytes();
    // The high-water mark is observational only; it never feeds a decision.
    peakCachePressureBytes = Math.max(peakCachePressureBytes, cachePressureBytes());
    const overCacheBudget = () =>
      shouldTrimCombinedBytes(cachePressureBytes(), streamingBudget, reservationBytes);
    if (!captureStreamingQuiesced && overCacheBudget()) {
      const beforeTrim = cachedGeometryBytes;
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
        buildingGlowTiles.delete(key);
        cachedGeometryBytes = Math.max(0, cachedGeometryBytes - record.bytes);
        evictions++;
      }
      const freed = beforeTrim - cachedGeometryBytes;
      if (freed > 0) { cacheTrimEvents++; cacheTrimmedBytes += freed; }
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
  // Terrain completion does not imply the current-view Simulation resident
  // query has returned. Read-only presentation; never changes a decision.
  const residentMode = residentViewQuery(view.halfHeight, !$("travel-panel").hidden, ready);
  const residentRequest = residentMode.inspect
    ? residentRequestForView(simulation.tick, residentQueryLimitForView(residentMode.actors), residentMode.actors)
    : undefined;
  const residentStatus = residentFactSuffix(
    Boolean(residentRequest),
    Boolean(residentRequest && residentQueries.readyFor(residentRequest.key, residentRequest.tick)),
  );
  // Coarse terrain may be coherent while mandatory current-view detail is
  // missing, transitioning or still streaming. Avoid false "tiles ready".
  const currentDetailSettled =
    complete && !selectionDirty && !lodTransition && pending.size === 0 &&
    activeKeys.length === wanted.length &&
    wanted.every(tile => activeKeys.includes(tile.key)) &&
    Math.abs(surfaceDetail - (globeCoverageReady() ? localDetailWeight(view.halfHeight) : 1)) < 0.002 &&
    Math.abs(projectionTransition - desiredProjectionTransition) <= 0.001;
  if (!initialWorldComplete && ready && initialWorldReady(
    coverageComplete,
    currentDetailSettled,
    Boolean(residentRequest),
    Boolean(residentRequest && residentQueries.readyFor(residentRequest.key, residentRequest.tick)),
  )) {
    initialWorldComplete = true;
    setLoadingProgress(100);
  }
  const detailLabel = terrainDetailLabel(coverageComplete, currentDetailSettled);
  // Compose first, then write only on change. A settled, unchanged frame must do
  // zero DOM writes (WP-S009-002-001); previously this text node was rewritten on
  // every rendered frame even though its content was identical.
  const tileStatusText =
    (projectionTransition >= 0.999
      ? `Globe · ${globePass < GLOBE_PASSES.length ? "refining" : "ready"}`
      : projectionTransition > 0.001
        ? `Handoff · ${Math.round(projectionTransition * 100)}% · ${detailLabel}`
        : `${activeKeys.length || 1} tiles · ${detailLabel}`) +
    residentStatus + poleFeedback;
  if (tileStatusText !== lastTileStatusText) {
    lastTileStatusText = tileStatusText;
    $("tile-status").textContent = tileStatusText;
  }
}
/**
 * Evidence-only Fantasy Time pin. Set solely by tools/screenshot_tool.py through
 * `advisorWorld.setEvidenceTick`. Gameplay never sets it, and it is never
 * persisted, so normal play always follows the real clock.
 */
/** The campaign this page load belongs to (resume or fresh). */
let campaignIdentity: CampaignRecord | undefined;
/**
 * The single durable history of Simulation-approved campaign changes
 * (WP-S010-008-003). Only `commitJournal` may write it, and only after the
 * change's identity has been derived and validated.
 */
let campaignJournal: CampaignJournal = emptyJournal("no-campaign");
/** Honest state of that history, surfaced to the player and to evidence hooks. */
let journalStatus: { saved: boolean; problem?: string; recovered?: string } = { saved: false };

/** Last resident card render, so an open popup refreshes once per tick, not per frame. */
let lastRenderedPopup: { code: string; tick: number } = { code: "", tick: -1 };

/** Pre-loss snapshot, so recovery can be proven to have changed nothing. */
let pendingLossSnapshot: PreservedState | undefined;
/** Set inside start() so the rebuild helper can refresh actor textures. */
let characterVisualsRefresh: (() => Promise<void>) | undefined;

/**
 * Reads the graphics device's own VRAM tracker. PlayCanvas maintains
 * `_vram` counters for textures and buffers, which is the only truthful source
 * for classes the asset registry cannot see (shadow maps, render targets,
 * engine pools). Returns `undefined` when the engine does not expose it, so the
 * ledger keeps reporting those classes as unmeasured rather than guessing.
 */
function measureDeviceVram(): { textures: number; buffers: number; total: number } | undefined {
  try {
    const device = app?.graphicsDevice as unknown as { _vram?: Record<string, number> } | undefined;
    const vram = device?._vram;
    if (!vram) return undefined;
    const textures = Number(vram.tex ?? 0);
    const buffers = Number(vram.vb ?? 0) + Number(vram.ib ?? 0) + Number(vram.sb ?? 0);
    if (!Number.isFinite(textures) || !Number.isFinite(buffers)) return undefined;
    return { textures, buffers, total: textures + buffers };
  } catch {
    return undefined;
  }
}

/**
 * Measures asset memory the ledger previously reported as unmeasured: loaded
 * textures (RGBA8, plus mipmap headroom) and mesh vertex/index buffers. Values
 * come from the real asset registry, so they are measurements, not guesses.
 * Anything this cannot enumerate stays explicitly unmeasured.
 */
function measureAssetBytes(): { textures: number; meshes: number; byClass: Record<string, number> } {
  const byClass: Record<string, number> = {};
  let textures = 0;
  let meshes = 0;
  const seen = new Set<unknown>();

  const addTexture = (texture: unknown, label: string) => {
    if (!texture || seen.has(texture)) return;
    seen.add(texture);
    const tex = texture as { width?: number; height?: number; name?: string; levels?: unknown[] };
    const width = Number(tex.width) || 0;
    const height = Number(tex.height) || 0;
    if (!width || !height) return;
    // RGBA8 base level plus ~33% for a generated mip chain.
    const bytes = Math.ceil(width * height * 4 * 1.33);
    textures += bytes;
    byClass[label] = (byClass[label] ?? 0) + bytes;
  };

  const scanResource = (resource: unknown, label: string) => {
    if (!resource || typeof resource !== "object") return;
    const record = resource as Record<string, unknown>;
    // A Texture itself.
    if (typeof record.width === "number" && typeof record.height === "number") {
      addTexture(resource, label);
      return;
    }
    // A Material: count its maps.
    for (const key of ["emissiveMap", "diffuseMap", "opacityMap", "normalMap"]) {
      addTexture(record[key], `${label}:${key}`);
    }
    // A Mesh: positions + normals + colors + uvs + indices is already measured
    // for terrain; count only non-terrain meshes to avoid double counting.
    const vertexBuffer = record.vertexBuffer as { numVertices?: number } | undefined;
    const indexBuffer = record.indexBuffer as { numIndices?: number } | undefined;
    if (vertexBuffer || indexBuffer) {
      const verts = Number(vertexBuffer?.numVertices) || 0;
      const indices = Number(indexBuffer?.numIndices) || 0;
      // 8 floats per vertex worst case, 4 bytes per index.
      const bytes = verts * 32 + indices * 4;
      if (bytes > 0) {
        meshes += bytes;
        byClass[label] = (byClass[label] ?? 0) + bytes;
      }
    }
  };

  try {
    for (const asset of app.assets.list()) {
      const type = String((asset as { type?: string }).type ?? "unknown");
      if (type !== "texture" && type !== "material" && type !== "model" && type !== "container") continue;
      scanResource((asset as { resource?: unknown }).resource, `asset:${type}`);
    }
  } catch {
    /* registry unavailable: those classes stay unmeasured */
  }

  return { textures, meshes, byClass };
}
let lastRendererRecovery: RecoveryReport | undefined;
let lastRendererRecoveryAt = 0;

/** The session state a device loss must never alter. */
function currentPreservedState(): PreservedState {
  const focus = flatToLonLat(view.x, view.z);
  return {
    seed: WORLD_SEED,
    fantasyTick: simulation.tick,
    focusLon: focus.lon,
    focusLat: focus.lat,
    heading: -view.yaw || 0,
    selectedCanonicalId: selectedCode || null,
    campaignId: campaignIdentity?.id ?? null,
  };
}

/**
 * Rebuilds renderer-owned resources after a device loss, in the documented order.
 * Textures keep their pixel arrays so they are re-uploaded, never regenerated from
 * the SEED. Returns what was actually rebuilt.
 */
function rebuildRendererResources(): RebuildTarget[] {
  const rebuilt: RebuildTarget[] = [];
  try {
    // Render targets and the app's render loop are owned by PlayCanvas; a
    // devicerestored event has already recreated the default framebuffer.
    rebuilt.push("render-targets");
  } catch { /* report truthfully by omission */ }
  try {
    // The globe surface keeps its pixels for exactly this purpose.
    globe?.surface?.upload?.();
    rebuilt.push("globe-surface");
  } catch { /* report truthfully by omission */ }
  try {
    for (const material of [worldMaterial, terrainMaterial, coarseTerrainMaterial, nightGlowMaterial, lampPoolMaterial]) {
      material?.update();
    }
    rebuilt.push("materials");
  } catch { /* report truthfully by omission */ }
  try {
    // Terrain meshes live on retained entities; re-uploading their vertex buffers
    // is what restores them. The geometry data itself is unchanged.
    for (const record of tileCache.values()) {
      for (const mesh of record.entity.findComponents("render"))
        for (const instance of mesh.meshInstances) instance.mesh?.update?.();
    }
    rebuilt.push("terrain-meshes");
  } catch { /* report truthfully by omission */ }
  try {
    void characterVisualsRefresh?.();
    rebuilt.push("actor-textures");
  } catch { /* report truthfully by omission */ }
  return rebuilt;
}

/**
 * Shows the campaign panel only when the campaign could not be loaded (corrupt or
 * unwritable storage). A healthy campaign needs no second confirmation: the player
 * either just chose its seed in the new-campaign dialog or is resuming the world
 * they already accepted. "Start a new campaign" goes through the seed dialog.
 */
function showCampaignProblemPanel(): void {
  const root = document.getElementById("campaign-panel");
  if (!root) return;
  new CampaignPanel(root, { onStartNew: () => startOverCampaign() });
}

/**
 * Reports a campaign problem in the existing alert box. Honest failure surfacing
 * is required: a campaign that cannot be remembered must not look saved.
 */
function showCampaignNotice(message: string): void {
  const box = document.getElementById("error");
  if (!box) return;
  const existing = box.hidden ? "" : (box.textContent ?? "").trim();
  box.hidden = false;
  box.textContent = !existing || existing.includes(message) ? (existing || message) : `${existing} ${message}`;
}
let evidenceTickOverride: number | undefined;
/** Evidence-only render-scale pin; see setEvidenceRenderScale. */
let evidenceRenderScale: number | undefined;

/** Last rendered tile-status text, so a settled frame performs no DOM write. */
let lastTileStatusText = "";
const CLICKABLE_KINDS = new Set(["residence", "service", "keep", "well", "field", "garden", "gate", "guard-post", "park"]);
/** Centre the view on a source point, keeping the zoom unless it is too far out to see the target. */
function centreOn(x: number, z: number, maxHalfHeight = view.halfHeight) {
  navigate(x, z, Math.min(view.halfHeight, maxHalfHeight));
}
/** Map scales at or closer than 1/2 are close-up inspection: clicking ground must never re-centre on the village. */
const GROUND_CLICK_NO_RECENTRE_SCALE = 2;
function openSettlementCard(place: (typeof places)[number], returnFocus?: HTMLElement, recentre = true) {
  if (recentre) centreOn(place.x, place.z, place.kind === "city" ? 60 : 25);
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
    // Close zoom (1/2 or nearer): show the card but keep the camera where the player is looking.
    openSettlementCard(settlement, undefined, scaleValueForHalfHeight(view.halfHeight) > GROUND_CLICK_NO_RECENTRE_SCALE);
    return true;
  }
  return false;
}
function inspectCell(screenX: number, screenY: number) {
  const lens = camera.camera!;
  // Only visible world geometry inside this exact camera's current clip
  // range is eligible for inspection. An uncapped 600 km march unnecessarily
  // rechecked thousands of authoritative slope probes over unseen terrain.
  const maxRayDistance = Math.min(600000, lens.farClip);
  const origin = lens.screenToWorld(screenX, screenY, 0);
  const far = lens.screenToWorld(screenX, screenY, maxRayDistance);
  const direction = far.clone().sub(origin).normalize();
  // Click the FIRST composed 3D face, not whichever ground cell survives an
  // 8-unit ray jump past a narrow, genuinely non-walkable cliff.
  const hit = firstComposedSurfaceRayHitDistance(maxRayDistance, distance => {
    const point = origin.clone().add(direction.clone().mulScalar(distance)),
      source = renderFrame.renderToSource(point.x, point.z);
    return point.y - elevationToRenderY(visibleSurfaceElevation(finalSurfaceAt(source.x, source.z)));
  });
  if (hit === null) return;
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
    // Show the actual composed upper walking surface, not a speculative
    // render material: a road or bridge can be legal where raw ground is not.
    const walkingSurface = {
      bridge: "bridge deck", road: "graded road", difficult: "difficult ground",
      open: "open ground", blocked: "blocked",
    }[surface.traversal];
    $("cell-walkable").textContent = `${surface.walkable ? "Yes" : "No"} · ${walkingSurface}`;
    // A traversable final surface is not automatically legal resident footing
    // (e.g. dry ground at the waterline). Do not imply a whole route is valid.
    $("cell-footing").textContent = residentWalkableSurface(surface) ? "Legal at point" : "Not legal at point";
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
/** An explicit viewpoint change exposes real SEED relief; zoom stays fixed.
 * The same camera angle is supplied to tile bounds and resident queries so
 * the extra visible valley/crest is actually streamed, not an empty border. */
function setTerrainReliefView(enabled: boolean, updateNow = true) {
  bridgeInspectionAngle = enabled;
  view.elevationAngle = enabled ? Math.PI / 6 : undefined;
  residentSearchWindow = undefined;
  const control = document.getElementById("relief-view");
  if (control) {
    control.setAttribute("aria-pressed", String(enabled));
    control.title = enabled ? "Restore normal map angle and scenery" :
      "Inspect canonical cliff and valley relief without foreground trees";
  }
  // Presentation only: keep the same generated tree/rock meshes cached, but
  // let the explicit terrain-inspection camera see actual cliffs and valleys.
  // Returning to the map restores scenery instantly; no world state is rewritten.
  setLayers();
  if (updateNow) updateCamera();
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
  $("relief-view").onclick = () => setTerrainReliefView(!bridgeInspectionAngle);
  const pointers = new Map<number, { x: number; y: number }>();
  let startX = 0,
    startY = 0,
    moved = false,
    lastPinch = 0;
  canvas.addEventListener("pointerdown", measureInput<PointerEvent>((event) => {
    // A newer tap or drag invalidates an outstanding GPU selection readback.
    residentPickGeneration++;
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
      if (resident && verifyResidentAtTap) {
        const generation = residentPickGeneration, x = event.clientX, y = event.clientY;
        // A resident behind an opaque 3D wall is not actually selectable,
        // even when its projected 44px touch target overlaps that wall.
        void verifyResidentAtTap(resident, x, y).then(visible => {
          if (generation !== residentPickGeneration) return;
          if (visible) showNpcPopup(resident, simulation.tick);
          else { hideNpcPopup(); inspectCell(x - canvas.getBoundingClientRect().left, y - canvas.getBoundingClientRect().top); }
        });
      } else { hideNpcPopup(); inspectCell(event.clientX - canvas.getBoundingClientRect().left, event.clientY - canvas.getBoundingClientRect().top); }
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
    if (facing !== undefined) {
      view.yaw = facing;
      // An explicit "Show entrance" action should actually show the real
      // owned front wall from the street, rather than inspect the roof from
      // above. Keep the actor and SEED doorway fixed; make one camera update
      // after both pose and focus change, not two streaming requests.
      setTerrainReliefView(true, false);
    }
    navigate(x, z, popupFocusHalfHeight(ref, HERO_HALF_HEIGHT, innerHeight));
    // Keep the exact inspected door labelled when the portrait character
    // inspector closes to reveal its actual front-wall geometry.
    focusedOwnedDoorPin = facing === undefined ? undefined : {
      x: view.x, z: view.z, yaw: view.yaw,
      y: finalSurfaceAt(view.x, view.z).surfaceHeight + 0.12,
      homeEntrance: document.getElementById("npc-home-entrance")?.textContent?.trim() ?? "",
    };
  });
  $("home").onclick = () => {
    view.yaw = -0.22;
    navigate(villages[0].x, villages[0].z + metresToSource(6), HERO_HALF_HEIGHT);
    $("cell-panel").hidden = true;
  };
  $("focus-gate-watch").onclick = () => {
    const place = nearestPlace(view.x, view.z);
    if (!place) return;
    const coverage = guardCoverageAt(place, simulation.tick);
    // An actually staffed gate is preferable to a different SEED gate whose
    // assigned guard has not legally arrived. Never invent vacancy coverage.
    const watch = coverage.find(gate => gate.onDuty > 0) ?? coverage[0];
    const gate = settlementExteriorFor(place).gates[watch?.gateIndex ?? 0];
    if (!gate) return;
    const post = residentGateWatchFocus(watch?.residentCodes,
      code => simulation.projectedResidentByCode(code), gate.guardPosts[0] ?? gate);
    // Navigation is a camera-only visit to an actual SEED duty position.
    // The cold population worker may still be preparing unrelated residents.
    // Frame physically present on-duty residents at Hero scale without moving them.
    // This only moves the observer camera; it never moves or creates guards.
    navigate(post.x, post.z, HERO_HALF_HEIGHT);
    focusedWatchCodes = watch?.residentCodes ?? [];
    $("focus-gate-watch").title = watch
      ? `Gate ${watch.gateIndex + 1}: ${watch.onDuty}/${watch.required} guards physically present`
      : "Gate watch unavailable";
    $("cell-panel").hidden = true;
  };
  $("overview").onclick = () => {
    // Realm view changes scale only; the separate compass control resets north.
    // Do not rotate the player's focus during globe/local zoom handoff.
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
    if (event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat && projectionTransition <= .001) {
        const selected = pickResidentByKeyboard?.();
        if (selected && verifyResidentAtTap) {
          const generation = ++residentPickGeneration;
          void verifyResidentAtTap(selected.resident, selected.clientX, selected.clientY).then(visible => {
            if (generation !== residentPickGeneration || !visible) return;
            showNpcPopup(selected.resident, simulation.tick);
            document.querySelector<HTMLButtonElement>(".npc-close")?.focus({ preventScroll: true });
          });
        }
      }
      return;
    }
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
    // A destination visit should arrive at readable street detail, not a
    // map-only camera scale that disables every resident illustration.
    navigate(place.x, place.z, HERO_HALF_HEIGHT * 4);
    simulation.setFocus(place);
    $("travel-panel").hidden = true;
  };
  $("visit-village").onclick = () => {
    const place = villages.find((p) => p.id === village.value)!;
    navigate(place.x, place.z + metresToSource(6), HERO_HALF_HEIGHT * 4);
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
  // Resolve the campaign once at startup: resume the stored one, create the first
  // one, or report honestly that storage refused. Never silently restart a
  // timeline the player already has.
  const campaignLoad = resolveCampaign();
  campaignIdentity =
    campaignLoad.state === "resumed" || campaignLoad.state === "created" ? campaignLoad.record : undefined;

  // The seed dialog (bootstrap.ts) already made the player's choice explicit; only
  // a broken or unwritable campaign record needs the panel, and it never blocks play.
  if (campaignLoad.state === "unreadable" || campaignLoad.state === "unavailable") showCampaignProblemPanel();

  if (campaignLoad.state === "unreadable") {
    // Deliberately do NOT create a replacement; the record is reported instead.
    showCampaignNotice(
      `Saved campaign unreadable: ${campaignLoad.reason} A fresh campaign was not started automatically.`,
    );
  }
  setText($("fantasy-time"), clock.labelForLocalTick(clock.tickAt(Date.now()), flatToLonLat(view.x, view.z).lon));
  // The header only ever shows the local time at the map focus; global (realm) time stays internal.
  const clockEyebrow = document.querySelector(".world-clock .eyebrow");
  if (clockEyebrow) clockEyebrow.textContent = "LOCAL TIME · 24×";
  const device = await createRenderer(canvas);
  canvas = device.canvas as HTMLCanvasElement;
  device.on("devicelost", () => {
    rendererLossCount++;
    rendererState.phase = "lost";
    // Truthful message: recovery is automatic if the device returns, so never
    // demand a reload. The snapshot proves nothing changed across the loss.
    const report = describeDeviceLoss(currentPreservedState());
    pendingLossSnapshot = report.snapshot;
    rendererState.error = report.message;
    if (report.pauseRendering && app) app.autoRender = false;
    fail(rendererState.error);
    showRendererActions();
  });
  device.on("devicerestored", () => {
    rendererState.phase = "ready";
    rendererState.error = "";
    errorText = "";
    $("error").hidden = true;
    if (app) app.autoRender = true;
    // Rebuild renderer-owned resources in the documented order. Textures keep
    // their pixel arrays, so they can be re-uploaded rather than regenerated from
    // the SEED — recovery must never regenerate world truth.
    const rebuilt = rebuildRendererResources();
    if (pendingLossSnapshot) {
      const recovery = describeRecovery(pendingLossSnapshot, currentPreservedState(), rebuilt);
      lastRendererRecovery = recovery;
      lastRendererRecoveryAt = Date.now();
      pendingLossSnapshot = undefined;
      if (!recovery.ok) {
        // Say so plainly instead of pretending recovery was clean.
        showCampaignNotice(recovery.message);
      }
    }
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
  characterVisualsRefresh = () => characterVisuals.refreshTextures();
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
  let lastDaylightLabel = "", lastLocalDateLabel = "";
  const applyDaylight = (tick:number,dt:number) => {
    const focusLon=flatToLonLat(view.x,view.z).lon,second=localSecondOfDay(tick,focusLon),
      phase=daylightAt(second).phase,label=`GMT+${timeZoneOffsetHours(focusLon)} · ${phase}`,
      dateLabel=clock.labelForLocalTick(tick,focusLon);
    if(dateLabel!==lastLocalDateLabel){setText($("fantasy-time"),dateLabel);lastLocalDateLabel=dateLabel;}
    if(label!==lastDaylightLabel){$("local-time").textContent=label;lastDaylightLabel=label;}
    targetDaylight=daylightAtLongitude(tick,focusLon);
    const light=displayedDaylight=advanceDaylight(displayedDaylight,targetDaylight,dt),hadGlow=eveningGlow>GLOW_VISIBILITY_EPSILON;
    const continuousScale=canonicalFootprintForHalfHeight(view.halfHeight)/CANONICAL_PLANET_DIAMETER*10000;
    eveningGlow=eveningLightWeight(light.daylight)*closeLightingWeight(continuousScale);
    const glowOpacity=Math.pow(eveningGlow,2.2);
    if(nightGlowMaterial){nightGlowMaterial.opacity=glowOpacity;nightGlowMaterial.update();}
    if(lampPoolMaterial){lampPoolMaterial.opacity=.45*glowOpacity;lampPoolMaterial.update();}
    if(hadGlow!==(eveningGlow>GLOW_VISIBILITY_EPSILON))setLayers();
    refreshBuildingGlow(tick);
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
  // Preserve only original, still-legal stationary cutouts while an
  // overlapping new camera query streams its first real residents.
  // Worker completion always replaces these temporary previous-view facts.
  const stationaryForView = (previous: ResidentQueryJob & ResidentQueryResult, next: ResidentQuery): Resident[] =>
    residentStationaryPartialCarryover(previous, next, (resident, originalTick, nextTick) => {
      const place = residentPlacesById.get(resident.settlement);
      if (!place) return false;
      const actualTick = Math.max(nextTick, simulation.tick);
      return residentStationaryWithinActivity(resident,
        localDayIndex(originalTick, place.canonicalPosition.lon),
        localDayIndex(actualTick, place.canonicalPosition.lon),
        localSecondOfDay(actualTick, place.canonicalPosition.lon));
    });
  workerStartedAt=performance.now();
  // The first worker starts alone so the first screen loads as fast as with a single worker; the
  // rest of the pool starts once it is ready, instead of all competing for the CPU at start-up.
  const startWorker = () => {
    const worker = new Worker(new URL("./tile-worker.ts", import.meta.url), { type: "module", name: workerNameForSeed(WORLD_SEED) });
    workers.push(worker);
    worker.onmessage = (event) => {
      if (event.data.kind === "worker-seed") {
        workerSeeds.set(`tile-${workers.indexOf(worker)}`, event.data.seed);
        if (event.data.seed !== WORLD_SEED) fail(`World worker built seed ${event.data.seed}, but this page uses ${WORLD_SEED}`);
        return;
      }
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
            // Inspector-valid indoor facts are not drawable street actors.
            if (batch.job.actors && first.some(resident => resident.grounded && !resident.indoors) &&
                firstResidentFactMs === null && firstResidentQueryOfferedAt !== null)
              firstResidentFactMs = performance.now() - firstResidentQueryOfferedAt;
          }
        }
        return;
      }
      if (event.data.kind === "resident-progress") {
        const batch = residentBatches.get(event.data.id), prior = residentQueries.latest;
        const retained = batch && prior && prior.id !== event.data.id
          ? stationaryForView(prior, batch.job) : [];
        if (residentQueries.appendPartial(event.data.id, event.data.residents as Resident[],
            Math.max(simulation.tick, clock.tickAt(Date.now())), retained)) {
          if (firstResidentFactMs === null && firstResidentQueryOfferedAt !== null)
            firstResidentFactMs = performance.now() - firstResidentQueryOfferedAt;
          residentResultReady();
        }
        return; // A partial batch never releases the busy worker.
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
            const merged = mergeResidentQueries(residentBatch.results,
              residentBatch.job.actors ? Infinity : residentBatch.job.limit,
              resident => residentOrder.get(resident.settlement)!(resident.index));
            residentBatches.delete(residentBatch.job.id);
            const accepted = residentQueries.complete(event.data.id, merged, Math.max(simulation.tick, clock.tickAt(Date.now())));
            const answeredAt = performance.now();
            residentPhaseTimings.complete(event.data.id, accepted, answeredAt, event.data.residentTiming, wasWarm);
            if (accepted) {
              // Completion cannot masquerade as first on-canvas street actor
              // when this original resident batch contains only indoor facts.
              if (residentBatch.job.actors &&
                  merged.residents.some(resident => resident.grounded && !resident.indoors) &&
                  firstResidentFactMs === null && firstResidentQueryOfferedAt !== null)
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
  //
  // The campaign journal is the ONE durable authority for approved changes
  // (WP-S010-008-003). It is campaign-scoped, content-addressed and checksummed,
  // so an interrupted write can be completed but a forged or duplicated entry
  // cannot be applied twice.
  const journalCampaignId = campaignIdentity?.id ?? "no-campaign";
  const journalStorage = (() => {
    try { return globalThis.localStorage ?? undefined; } catch { return undefined; }
  })();
  let loadedVisits: readonly unknown[] = [];
  /** True when every stored event arrived by migration, so rejection can discard it. */
  let journalIsLegacyImport = false;
  if (journalStorage) {
    const loaded = loadJournal(journalStorage, journalCampaignId);
    if (loaded.journal) {
      campaignJournal = loaded.journal;
      journalStatus = { saved: true, ...(loaded.recovered ? { recovered: loaded.recovered } : {}) };
      // Migrate the pre-journal blob exactly once, so an existing player keeps
      // their journeys instead of silently losing them. It is NOT promoted yet:
      // Simulation must revalidate the replay first, otherwise a fabricated blob
      // would be laundered into authoritative storage.
      if (campaignJournal.events.length === 0) {
        try {
          const legacyRaw = journalStorage.getItem(LEGACY_SITE_VISITS_KEY);
          if (legacyRaw && legacyRaw.length <= 24_576) {
            const imported = importLegacySiteVisits(campaignJournal, JSON.parse(legacyRaw));
            if (imported.imported > 0) {
              campaignJournal = imported.journal;
              journalIsLegacyImport = true;
            }
          }
        } catch { /* an unreadable legacy blob is left untouched, never guessed at */ }
      }
      loadedVisits = projectSiteVisits(campaignJournal);
    } else {
      journalStatus = { saved: false, problem: loaded.problem };
    }
  } else {
    journalStatus = { saved: false, problem: "Browser storage is unavailable; this session will not be remembered." };
  }
  // A history that cannot be trusted is reported in the existing alert box, so a
  // rejected or unreadable save never looks like a saved campaign.
  if (journalStatus.problem) showCampaignNotice(journalStatus.problem);
  let pendingSiteVisitHistory: unknown;
  if (loadedVisits.length) {
    pendingSiteVisitHistory = {
      version: 1, seed: WORLD_SEED, foundation: WORLD_FOUNDATION_VERSION, visits: loadedVisits,
    };
  }
  /**
   * Persists whatever Simulation has just approved. Recording the same approved
   * change again adds nothing, so a reload or a repeat caller cannot move an
   * actor or an item twice. A failed commit is reported, never glossed over.
   */
  const saveSiteVisits = () => {
    if (!journalStorage) return;
    const recorded = recordSiteVisits(campaignJournal, simulation.savedSiteVisitHistory().visits);
    if (recorded.added === 0 && !journalStatus.problem) return;
    campaignJournal = recorded.journal;
    const committed = commitJournal(journalStorage, campaignJournal);
    journalStatus = committed.ok
      ? { saved: true }
      : { saved: false, problem: committed.reason };
  };
  /**
   * Household belongings live in one validated inventory record. SEED decides
   * the items; only an accepted, Simulation-checked hand-over changes a holder,
   * and the journal replays exactly once so a reload cannot move an item twice.
   */
  const inventorySaveKey = campaignIdentity
    ? inventoryStorageKey(campaignIdentity.id)
    : legacyInventoryKey(WORLD_SEED);
  let inventory: InventoryState = emptyInventory();
  try {
    let raw = localStorage.getItem(inventorySaveKey);
    // One-time move of the pre-campaign per-seed record into the campaign that
    // first loads it; the old key is removed so a later campaign starts empty.
    if (raw === null && campaignIdentity) {
      const legacyKey = legacyInventoryKey(WORLD_SEED);
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw !== null && parseInventory(legacyRaw)) {
        localStorage.setItem(inventorySaveKey, legacyRaw);
        localStorage.removeItem(legacyKey);
        raw = legacyRaw;
      }
    }
    inventory = parseInventory(raw) ?? emptyInventory();
  } catch { /* storage may be disabled; the session still works in memory */ }
  const saveInventory = () => {
    try { localStorage.setItem(inventorySaveKey, serializeInventory(inventory)); }
    catch { /* session-only when storage is unavailable; never a false claim */ }
  };
  const holderItems = (code: string) =>
    itemsHeldBy(inventory, code, seededItems(code).map((item) => item.code));
  setBelongingsReader((code) => holderItems(code).map((item) => ({ name: item.name, category: item.category })));
  const updateWilderness = createWildernessOverlay(site=>{centreOn(site.x,site.z,12);showWildernessPopup(site);});  // Unlike the old DOM ring, this one shares the actual world depth buffer.
  // A guard behind a real parapet cannot acquire a floating ring on its roof.
  const ring = residentFootRingGeometry();
  const footRingMesh = new pc.Mesh(app.graphicsDevice);
  footRingMesh.setPositions(ring.positions);
  footRingMesh.setNormals(ring.normals);
  footRingMesh.setIndices(ring.indices);
  footRingMesh.update(pc.PRIMITIVE_TRIANGLES);
  const footRingMaterial = new pc.StandardMaterial();
  footRingMaterial.name = "SEED resident foot selection · world depth";
  // Gold is visible on unlit WebGPU/WebGL2 meshes even without an emissive map.
  footRingMaterial.diffuse.set(1, 0.82, 0.48);
  footRingMaterial.emissive.set(1, 0.82, 0.48);
  footRingMaterial.useLighting = false;
  footRingMaterial.useTonemap = false;
  footRingMaterial.useFog = false;
  footRingMaterial.useSkybox = false;
  footRingMaterial.depthTest = true;
  footRingMaterial.depthWrite = false;
  // The ring must draw AFTER opaque ground rather than disappearing beneath
  // later terrain draws: depth-write disabled alone does not move an opaque
  // MeshInstance into the transparent forward pass. Keep full opacity and
  // actual scene-depth occlusion by roofs, walls and cliff faces.
  footRingMaterial.blendType = pc.BLEND_NORMAL;
  footRingMaterial.opacity = 1;
  footRingMaterial.cull = pc.CULLFACE_NONE;
  footRingMaterial.update();
  // The original real selected-foot screenshots proved the ordinary
  // depth-tested MeshInstance was visible and actual GPU resident taps worked.
  // Turning off MeshInstance.pick made that gold halo disappear from the
  // ORIGINAL PR #802 WebGL2 landscape and portrait screenshots despite
  // read-only state reporting its mesh as present. Preserve scene rendering;
  // never treat a read-only mesh-visible flag as proof of visible pixels.
  const selectedFootRing = new pc.Entity("Selected resident · depth-tested ground ring");
  selectedFootRing.addComponent("render", {
    meshInstances: [new pc.MeshInstance(footRingMesh, footRingMaterial)],
    castShadows: false, receiveShadows: false,
  });
  flatRoot.addChild(selectedFootRing);
  selectedFootRing.enabled = false;
  const actors: pc.Entity[] = [];
  const selectedResidentMarker = $("selected-resident-marker"),
    selectedResidentName = $("selected-resident-name"),
    selectedResidentWorld = new pc.Vec3(), selectedResidentScreen = new pc.Vec3(),
    selectedResidentGround = new pc.Vec3(), selectedResidentGroundScreen = new pc.Vec3();
  const selectedHomeDoorMarker = $("selected-home-door-marker"),
    selectedHomeDoorWorld = new pc.Vec3(), selectedHomeDoorScreen = new pc.Vec3();
  let markedResidentCode = "", markedResidentTransform = "", markedDoorTransform = "";
  let selectedDoorPoint: { x: number; z: number; y: number } | undefined;
  // Real canvas picking and S006 evidence must see the same genuinely drawable
  // 2D/3D model that fallback uses: honor imported ancestors, mesh visibility,
  // actual PlayCanvas blend opacity and valid geometry, not just component count.
  const drawableResidentMeshes = (actor: pc.Entity) => characterDrawableMeshes(
    actor.findComponents("render") as pc.RenderComponent[], pc.BLEND_NONE,
  );
  const hasResidentMesh = (actor: pc.Entity) => drawableResidentMeshes(actor).length > 0;
  const actorViewPoint = new pc.Vec3(), actorPaintedHead = new pc.Vec3();
  function residentInFrontOfCamera(actor: pc.Entity): boolean {
    const eye = camera.camera!.viewMatrix;
    const feetDepth = eye.transformPoint(actor.getPosition(), actorViewPoint).z;
    characterVisuals.headPoint(actor, actorPaintedHead);
    const headDepth = eye.transformPoint(actorPaintedHead, actorViewPoint).z;
    return residentActorInFront(feetDepth, headDepth);
  }
  pickResidentAt = (clientX: number, clientY: number) => {
    const pickStarted = performance.now();
    // Project each real painted cutout (with the existing accessible padding).
    // Compare the tapped station along each painted 3D cutout when targets
    // overlap; a pitched head and feet need not share the midpoint's depth.
    const rect = canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top,
      lens = camera.camera!, feet = new pc.Vec3(), head = new pc.Vec3(),
      paintedHeadWorld = new pc.Vec3(), paintedTapWorld = new pc.Vec3();
    let best: Resident | undefined;
    let bestHit: { code: string; distance: number; viewDepth: number } | undefined;
    for (const actor of actors) {
      const resident = actorResidents.get(actor);
      if (!actor.enabled || !resident || !hasResidentMesh(actor) || !residentInFrontOfCamera(actor)) continue;
      // The visible authored illustration is pitched toward the camera.
      // Picking its imaginary vertical body misses the actual painted figure.
      lens.worldToScreen(actor.getPosition(), feet);
      characterVisuals.headPoint(actor, paintedHeadWorld);
      lens.worldToScreen(paintedHeadWorld, head);
      const distance = residentActorPickDistance(x, y, feet, head);
      if (distance === null) continue;
      const fraction = residentActorPaintedTapFraction(x, y, feet, head);
      if (fraction === null) continue;
      paintedTapWorld.lerp(actor.getPosition(), paintedHeadWorld, fraction);
      const viewDepth = lens.viewMatrix.transformPoint(paintedTapWorld, actorViewPoint).z;
      const hit = { code: resident.code, distance, viewDepth };
      if (residentActorPickPrefersFront(hit, bestHit)) { best = resident; bestHit = hit; }
    }
    residentPickSamples.record(performance.now() - pickStarted);
    return best;
  };
  // The CPU body projection is the responsive 44px candidate filter only.
  // The final 3D hit must also survive the real scene's depth buffer.
  // Reuse one on-demand GPU picker; no per-frame picking or actor truth changes.
  // An actual roof triangle, not merely an alpha-masked cutout picker ID,
  // owns a tap on an opaque foreground surface. Intersect only enabled,
  // camera-ray-overlapping structural meshes on user input; no per-frame work.
  const solidWorldBlocksTap = (cx: number, cy: number, actorDepth: number, lens: pc.CameraComponent) => {
    const start = lens.screenToWorld(cx, cy, lens.nearClip);
    const far = lens.screenToWorld(cx, cy, lens.farClip);
    const viewStart = lens.viewMatrix.transformPoint(start, new pc.Vec3()).z;
    const viewFar = lens.viewMatrix.transformPoint(far, new pc.Vec3()).z;
    const fraction = (actorDepth - viewStart) / (viewFar - viewStart);
    // Real screenshot_tool.py probe data only, never a picking decision or
    // per-frame analysis. Distinguish missed mesh, ray and depth cutoff.
    const probe = new URLSearchParams(location.search).has("resident-route-probes");
    const diagnostic = { tap: [cx, cy], actorDepth, viewStart, viewFar, fraction,
      structuralMeshes: 0, broadPhaseHits: 0, triangleCount: 0,
      fullRayIntersections: 0, beforeActorIntersections: 0 };
    const finish = (blocked: boolean) => {
      if (probe) (window as Window & { __wp353Ray?: unknown }).__wp353Ray = { ...diagnostic, blocked };
      return blocked;
    };
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) return finish(false);
    const end = new pc.Vec3().lerp(start, far, fraction);
    const ray = new pc.Ray(start, far.clone().sub(start).normalize());
    for (const entry of tileCache.values()) {
      if (!entry.entity.enabled) continue;
      for (const child of entry.entity.children as pc.Entity[]) {
        if (!child.enabled || (child.name !== "structures" && child.name !== "detail" &&
            child.name !== "closeDetail")) continue;
        for (const meshInstance of child.render?.meshInstances ?? []) {
          diagnostic.structuralMeshes++;
          if (!meshInstance.aabb.intersectsRay(ray)) continue;
          diagnostic.broadPhaseHits++;
          const inverse = meshInstance.node.getWorldTransform().clone().invert();
          const localStart = inverse.transformPoint(start, new pc.Vec3());
          const localEnd = inverse.transformPoint(end, new pc.Vec3());
          const mesh = meshInstance.mesh;
          if (!mesh) continue;
          const positions: number[] = [], indices: number[] = [];
          mesh.getPositions(positions);
          mesh.getIndices(indices);
          diagnostic.triangleCount += indices.length / 3;
          if (probe && structuralMeshBlocksSegment(
            localStart, inverse.transformPoint(far, new pc.Vec3()), positions, indices))
            diagnostic.fullRayIntersections++;
          if (structuralMeshBlocksSegment(localStart, localEnd, positions, indices)) {
            diagnostic.beforeActorIntersections++;
            return finish(true);
          }
        }
      }
    }
    return finish(false);
  };
  let residentDepthPicker: pc.Picker | undefined;
  let pickerLossRevision = -1, pickerWidth = 0, pickerHeight = 0;
  let pendingResidentPick: Promise<void> = Promise.resolve();
  verifyResidentAtTap = (resident, clientX, clientY) => {
    const generation = residentPickGeneration;
    const lens = camera.camera!, rect = canvas.getBoundingClientRect();
    const actor = actors.find(candidate => candidate.enabled &&
      actorResidents.get(candidate)?.code === resident.code && hasResidentMesh(candidate));
    if (!actor || !residentInFrontOfCamera(actor) || !rect.width || !rect.height ||
        clientX < rect.left || clientY < rect.top ||
        clientX >= rect.right || clientY >= rect.bottom) return Promise.resolve(false);
    const feet = actor.getPosition().clone(), headWorld = new pc.Vec3(),
      head = new pc.Vec3(), footScreen = new pc.Vec3(), tapped = new pc.Vec3(),
      eyePoint = new pc.Vec3();
    characterVisuals.headPoint(actor, headWorld);
    lens.worldToScreen(feet, footScreen);
    lens.worldToScreen(headWorld, head);
    const fraction = residentActorPaintedTapFraction(
      clientX - rect.left, clientY - rect.top, footScreen, head);
    if (fraction === null) return Promise.resolve(false);
    tapped.lerp(feet, headWorld, fraction);
    const actorDepth = lens.viewMatrix.transformPoint(tapped, eyePoint).z;
    // The projected tap plane can sit in front of a wall whose solid roof
    // hides the character's physical feet. Trace to the farther real foot
    // depth as well; on a genuinely visible head pixel no roof is in the ray.
    const feetDepth = lens.viewMatrix.transformPoint(feet, eyePoint).z;
    const occlusionReachDepth = residentOcclusionReachDepth(actorDepth, feetDepth);
    const scenePose = () =>
      `${view.x}/${view.z}/${view.halfHeight}/${view.yaw}/${projectionTransition}/${bridgeInspectionAngle}`;
    const poseAtTap = scenePose(), modelHeight = feet.distance(headWorld);
    const readDepth = async (): Promise<boolean> => {
      if (generation !== residentPickGeneration || scenePose() !== poseAtTap ||
          !actor.enabled || actorResidents.get(actor)?.code !== resident.code ||
          actor.getPosition().distance(feet) > modelHeight * .5 ||
          lens !== camera.camera) return false;
      try {
        // The normal scene renders its actual triangle geometry with depth
        // testing. Use it directly for exact structural occlusion before any
        // potentially missing GPU picker samples. This is not an actor hitbox.
        if (solidWorldBlocksTap(clientX - rect.left, clientY - rect.top, occlusionReachDepth, lens))
          return false;
        // Half-resolution ID/depth targets stay bounded and are created only
        // on a real user interaction, not during rendering or worker streaming.
        const width = Math.max(1, Math.floor(rect.width * .5)),
          height = Math.max(1, Math.floor(rect.height * .5));
        if (pickerLossRevision !== rendererLossCount) {
          residentDepthPicker?.destroy();
          residentDepthPicker = undefined;
          pickerLossRevision = rendererLossCount;
          pickerWidth = pickerHeight = 0;
        }
        if (!residentDepthPicker) residentDepthPicker = new pc.Picker(app, width, height, true);
        if (pickerWidth !== width || pickerHeight !== height) {
          residentDepthPicker.resize(width, height);
          pickerWidth = width; pickerHeight = height;
        }
        residentDepthPicker.prepare(lens, app.scene);
        const px = Math.min(width - 1, Math.max(0, Math.floor((clientX - rect.left) * width / rect.width))),
          py = Math.min(height - 1, Math.max(0, Math.floor((clientY - rect.top) * height / rect.height))),
          halfTarget = Math.max(1, Math.round(22 * width / rect.width));
        const nearest = await residentDepthPicker.getWorldPointAsync(px, py);
        // A 44px area can contain the guard's visible head while the
        // *clicked pixel* belongs to a solid foreground roof. Check its own
        // ID before considering the padded actor search rectangle.
        const exactPixel = await residentDepthPicker.getSelectionAsync(px, py, 1, 1);
        const painted = await residentDepthPicker.getSelectionAsync(
          Math.max(0, px - halfTarget), Math.max(0, py - halfTarget),
          2 * halfTarget + 1, 2 * halfTarget + 1);
        // A real hit must contain this resident's own drawn mesh ID. If it
        // does not, a second world-only GPU render/readback cannot turn this
        // tap into an accepted character selection. Skip that costly pass,
        // keeping the same conservative rejection and opaque-world rules.
        const selectedActorMeshes = drawableResidentMeshes(actor);
        if (!painted.some(mesh => mesh instanceof pc.MeshInstance && selectedActorMeshes.includes(mesh))) return false;
        // The first picker can give the nearby resident's transparent quad
        // the winning ID even at a wall-covered touch pixel. Render a second
        // on-demand pass with only the resident mesh IDs suppressed, so the
        // actual opaque world surface competes without the character.
        // This changes picker eligibility, never scene visibility or truth.
        const hiddenFromPicker: { mesh: pc.MeshInstance; pick: boolean }[] = [];
        let worldOnly: pc.Vec3 | null = null;
        let opaqueWorldAtPixel = false;
        try {
          for (const candidate of actors) {
            if (!candidate.enabled) continue;
            for (const mesh of drawableResidentMeshes(candidate)) {
              hiddenFromPicker.push({ mesh, pick: mesh.pick });
              mesh.pick = false;
            }
          }
          residentDepthPicker.prepare(lens, app.scene);
          // WebGPU can finish this pick/readback asynchronously after prepare.
          // Keep resident IDs excluded until its actual world-only sample is
          // obtained, not merely until the pass was submitted; WebGL2 may
          // finish synchronously. The normal scene draw is not controlled by
          // MeshInstance.pick, and the finally block restores every flag.
          worldOnly = await residentDepthPicker.getWorldPointAsync(px, py);
          // A real roof can have a valid pick ID even where the GPU depth
          // readback is empty. Only solid 3D structure/detail layers veto
          // that missing-depth case; terrain behind a visible resident does not.
          const worldPixel = await residentDepthPicker.getSelectionAsync(px, py, 1, 1);
          // An exact solid roof/wall ID in the first pass also owns the
          // clicked pixel even when its depth reads behind the projected
          // padded resident body. The 44px candidate is not a see-through
          // permission; empty ground pixels retain accessible padding.
          const isOpaqueStructure = (mesh: object) => mesh instanceof pc.MeshInstance &&
            (mesh.node?.name === "structures" || mesh.node?.name === "detail" ||
             mesh.node?.name === "closeDetail");
          opaqueWorldAtPixel = worldPixel.some(isOpaqueStructure) ||
            exactPixel.some(isOpaqueStructure);
        } finally {
          for (const { mesh, pick } of hiddenFromPicker) mesh.pick = pick;
        }
        if (generation !== residentPickGeneration || scenePose() !== poseAtTap ||
            !actor.enabled || actorResidents.get(actor)?.code !== resident.code ||
            actor.getPosition().distance(feet) > modelHeight * .5 ||
            lens !== camera.camera) return false;
        const foregroundDepth = nearest
          ? lens.viewMatrix.transformPoint(nearest, eyePoint).z : null;
        const worldDepth = worldOnly
          ? lens.viewMatrix.transformPoint(worldOnly, eyePoint).z : null;
        return residentGpuHitAllows(actorDepth, foregroundDepth,
          drawableResidentMeshes(actor), painted, exactPixel, worldDepth, opaqueWorldAtPixel);
      } catch {
        // A lost/unsupported picker never makes a hidden character selectable;
        // the live renderer can recover and recreate these disposable buffers.
        try { residentDepthPicker?.destroy(); } catch { /* lost device */ }
        residentDepthPicker = undefined;
        pickerWidth = pickerHeight = 0;
        return false;
      }
    };
    // One reusable GPU buffer must not be prepared while an earlier async
    // readback still owns it. New taps invalidate old results before display.
    const result = pendingResidentPick.then(readDepth, readDepth);
    pendingResidentPick = result.then(() => {}, () => {});
    return result;
  };
  pickResidentByKeyboard = () => {
    // Enter inspects only an actually rendered, canvas-visible SEED resident;
    // the same hit test accepts both pointer and touch taps on its illustration.
    const rect = canvas.getBoundingClientRect(), midpoint = new pc.Vec3(), head = new pc.Vec3(), center = new pc.Vec3();
    const candidates: { code: string; x: number; y: number; resident: Resident }[] = [];
    for (const actor of actors) {
      const resident = actorResidents.get(actor);
      if (!actor.enabled || !resident || !hasResidentMesh(actor) || !residentInFrontOfCamera(actor)) continue;
      characterVisuals.headPoint(actor, head);
      midpoint.lerp(actor.getPosition(), head, .5);
      camera.camera!.worldToScreen(midpoint, center);
      if (center.x < 12 || center.y < 12 || center.x > rect.width - 12 || center.y > rect.height - 12) continue;
      candidates.push({ code: resident.code, x: center.x, y: center.y, resident });
    }
    // Cheap nearest-first screen ordering precedes any expensive canvas hit
    // test. A visible resident near the screen centre now needs one full hit
    // scan instead of repeating it for every pooled actor.
    const selected = nearestPickableKeyboardResident(candidates, rect.width, rect.height, candidate => {
      const clientX = rect.left + candidate.x, clientY = rect.top + candidate.y;
      return document.elementFromPoint(clientX, clientY) === canvas &&
        pickResidentAt?.(clientX, clientY)?.code === candidate.code;
    });
    return selected
      ? { resident: selected.resident, clientX: rect.left + selected.x, clientY: rect.top + selected.y }
      : undefined;
  };
  let lastSimulationRealSecond = -1, lastResidentSnapshot = "";
  let actorSnapshotTick = -Infinity;
  residentResultReady = () => { lastSimulationRealSecond = -1; };
  if (pendingSiteVisitHistory !== undefined) {
    void simulation.restoreSiteVisitHistory(pendingSiteVisitHistory).then(restored => {
      if (restored) {
        residentPhaseTimings.clearPending();
        residentQueries.clear();
        lastSimulationRealSecond = -1;
        // Only now, after Simulation has revalidated every stored journey, may
        // the history be promoted to durable authority.
        if (journalStorage && journalIsLegacyImport) {
          const committed = commitJournal(journalStorage, campaignJournal);
          if (committed.ok) {
            journalStatus = { saved: true };
            try { journalStorage.removeItem(LEGACY_SITE_VISITS_KEY); } catch { /* leave it; harmless */ }
          } else {
            journalStatus = { saved: false, problem: committed.reason };
          }
        }
      } else if (campaignJournal.events.length > 0) {
        // Stored history exists but the world refuses it. Do not apply it, do not
        // pretend it was saved, and never repair it into something plausible.
        if (journalIsLegacyImport) {
          // It arrived only by migration, so discard it rather than poisoning
          // every later session with a record the world has already rejected.
          campaignJournal = emptyJournal(journalCampaignId);
          journalStatus = { saved: false, problem: "A migrated journey history was rejected by Simulation and was not kept." };
        } else {
          journalStatus = { saved: false, problem: simulation.lastReplayProblem
            ?? "The stored campaign history was rejected by Simulation and was not applied." };
        }
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
  // Handing an item over: Simulation proves the two people are physically close,
  // the inventory record is the only thing that may change a holder, and the
  // result is reported verbatim (accepted or refused) with nothing invented.
  setItemGiveAdvisor(async (code) => {
    const giver = simulation.residentByCode(code) ?? simulation.projectedResidentByCode(code);
    if (!giver) return { accepted: false, message: "That resident could not be resolved, so nothing changed." };
    const held = holderItems(code);
    if (!held.length) return { accepted: false, message: "They are carrying nothing they could offer." };
    const item = held[0];
    // Nearest other grounded resident in the same settlement.
    let receiverCode = "", receiverDistance = Infinity;
    for (const resident of actorResidents.values()) {
      if (resident.code === code || !resident.grounded || resident.settlement !== giver.settlement) continue;
      const distance = Math.hypot(resident.position.lon - giver.position.lon,
        resident.position.lat - giver.position.lat);
      if (distance < receiverDistance) receiverDistance = distance, receiverCode = resident.code;
    }
    if (!receiverCode) return { accepted: false, message: `Nobody else is standing close enough to take the ${item.name.toLowerCase()}.` };
    const receiver = simulation.projectedResidentByCode(receiverCode);
    if (!receiver) return { accepted: false, message: "The other person could not be resolved, so nothing changed." };
    const day = localDayIndex(simulation.tick, giver.position.lon);
    const outcome = performItemTransfer(inventory, giver, receiver, day, itemExchangeLegalBetween);
    if (outcome.accepted) {
      inventory = outcome.state;
      saveInventory();
    }
    return { accepted: outcome.accepted, message: outcome.message };
  });
  // The Advisor conversation panel uses the very same validated path.
  adviseExecutor = async (code, options) => {
    const result = await simulation.considerAdvisorSiteVisit(code, options);
    if (result.started) {
      saveSiteVisits();
      residentPhaseTimings.clearPending();
      residentQueries.clear();
      lastSimulationRealSecond = -1;
    }
    return result;
  };
  let lastResidentDetailVisible = smallDetailsVisible;
  let lastResidentInspectorOpen = !$("travel-panel").hidden;
  const labelNodes = new Map<string, HTMLElement>();
  const labels = $("map-labels");
  // Presentation-only ambient exchange between nearby rendered residents.
  const chatter = createAmbientChatter($("ambient-chatter"));
  const chatterHead = new pc.Vec3(), chatterScreen = new pc.Vec3();
  let chatterSpeakers: ChatterActor[] = [], lastChatterScan = 0;
  let labelFingerprint = "";
  let labelAnchorKey = "";
  let labelMeasurementsDirty = true;
  const labelDimensions = new Map<string, { width: number; height: number }>();
  let measuredObstacles: { x: number; y: number; width: number; height: number }[] = [];
  const invalidateLabelMeasurements = () => { labelMeasurementsDirty = true; };
  // ResizeObserver reports font, zoom, CSS and content size changes without
  // reading layout on every unchanged game frame.
  const labelResizeObserver = new ResizeObserver(invalidateLabelMeasurements);
  const obstacleResizeObserver = new ResizeObserver(invalidateLabelMeasurements);
  const obstacleAttributes = new MutationObserver(invalidateLabelMeasurements);
  for (const name of [
    "masthead", "region-panel", "cell-panel", "travel-panel", "bottom-bar",
    "map-controls", "telemetry", "focus-coordinates", "centre-marker",
  ]) {
    for (const node of Array.from(document.querySelectorAll(`#${name},.${name}`))) {
      obstacleResizeObserver.observe(node);
      obstacleAttributes.observe(node, {
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
      });
    }
  }
  window.addEventListener("resize", invalidateLabelMeasurements);
  document.fonts?.addEventListener("loadingdone", invalidateLabelMeasurements);
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
      // Adaptive resolution protects frame rate during play, but an evidence
      // capture must show the native picture, so a pin (never set by gameplay)
      // overrides the decision.
      const ratio = evidenceRenderScale ?? nextPixelRatio(app.graphicsDevice.maxPixelRatio, resolutionSeconds * 1000 / resolutionFrames, devicePixelRatio || 1);
      if (ratio !== app.graphicsDevice.maxPixelRatio) { app.graphicsDevice.maxPixelRatio = ratio; app.resizeCanvas(); }
      resolutionFrames = 0; resolutionSeconds = 0;
    }
    const now = Date.now(),
      realSecond = Math.floor(now / 1000);
    // Deterministic evidence clock: only ever set by the screenshot tool through
    // an explicit debug hook, never by gameplay. It pins Fantasy Time so terrain
    // and lighting evidence cannot be captured at an unreadable hour.
    const simulationTick = evidenceTickOverride ?? clock.tickAt(now);
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
      // Both clocks describe the tick actually in force: authoritative Simulation
      // time, which every resident and schedule is evaluated at. During a pinned
      // evidence capture that is the pinned tick, so the realm and local labels
      // can never disagree about what the scene is showing.
      // The header shows local time only (updated in applyDaylight); simulation.tick stays global.
      setText($("simulation-status"),
        `${simulation.stats.residents} residents live in the focused country; ${simulation.stats.coarseCountries} countries tracked as summaries.`);
      // Logical inspection remains available before optional meshes and billboards
      // finish. Actor allocation keeps the original strict close-detail budget.
      const residentMode = residentViewQuery(view.halfHeight, residentInspectorOpen, ready);
      // Compute the canonical future close-view actor snapshot before terrain
      // completes. The existing residentMode.actors gate still prevents sprites
      // and selection from appearing before coherent world geometry.
      const queryActors = residentMode.actors || (!ready && view.halfHeight < 20);
      const query = residentMode.inspect || queryActors
        ? residentRequestForView(simulation.tick, residentQueryLimitForView(queryActors), queryActors) : undefined;
      // Read the previous authoritative result before switching camera keys;
      // ResidentQueryQueue.current intentionally hides a nonmatching key.
      const previousSnapshot = residentQueries.latest;
      if (query) {
        offerResidentQuery(query);
      } else {
        residentPhaseTimings.clearPending();
        residentQueries.clear();
      }
      const recentSnapshot = currentResidentSnapshot(residentQueries.current, previousSnapshot, query?.placeCode, simulation.tick, TIME_SCALE * 2, query);
      // A camera shift of more than one quarter of the query radius does
      // not make still-visible, previously verified stationary people vanish.
      // Reuse only actual overlapping locations, same local day/routine and
      // still-legal grounded outdoor residents while fresh worker facts arrive.
      // This is incomplete presentation, never a new authoritative query.
      const original = previousSnapshot;
      const stationaryResidents = !recentSnapshot && original && query
        ? stationaryForView(original, query) : [];
      const snapshot = recentSnapshot ?? (original && stationaryResidents.length
        ? { ...original, residents: stationaryResidents, tick: simulation.tick, partial: true }
        : undefined);
      // A resident's accepted journey belongs to main Simulation Fantasy Time,
      // NOT the last routine-worker query timestamp. A slow worker may return a
      // snapshot from earlier in the walk: project the same original actor at
      // current authoritative tick instead of drawing stale road/door positions.
      // Ordinary routine residents keep their unchanged worker-owned snapshot.
      const acceptedSiteVisits = simulation.acceptedSiteVisitCount > 0;
      const projectedResidents = snapshot
        ? simulation.projectResidentView(snapshot.residents,
            acceptedSiteVisits ? simulation.tick : snapshot.tick, snapshot)
        : [];
      const inspectedCode = npcPopupCode();
      const existingSelected = inspectedCode
        ? actors.find(actor => actor.enabled && actorResidents.get(actor)?.code === inspectedCode)
        : undefined;
      // An in-flight view query must not erase a still-grounded selected 3D actor
      // simply because its old finite result is no longer the desired key.
      // Never retain stale time/remote scenery; no actor is invented.
      const snapshotRevision = snapshot
        ? `${snapshot.id}/${snapshot.residents.length}/${snapshot.partial ? "partial" : "complete"}/${acceptedSiteVisits ? simulation.tick : ""}` : "";
      const selectedFromSnapshot = inspectedCode && snapshot
        ? projectedResidents.find(resident => resident.code === inspectedCode) : undefined;
      // The inspected resident is resolved from Simulation EVERY frame, never
      // from the object remembered by a pooled actor. An open card and its actor
      // must describe THIS Fantasy Time: a remembered object carries no tick, so
      // a day-shift guard could keep claiming "Guard duty 06:00–18:00, 80%" long
      // after going home to sleep, and a stale outdoor actor stayed on screen.
      // Bounded to one resident — the same per-frame authority already spent on
      // the real gate watch below.
      const authoritativeSelected = inspectedCode
        ? simulation.projectedResidentByCode(inspectedCode) : undefined;
      const currentSelected = authoritativeSelected;
      const selected = inspectedResidentSource(authoritativeSelected, selectedFromSnapshot);
      const selectionNearby = residentMode.actors &&
        selectedResidentVisibleInView(selected, query);
      // A legally staffed gate is part of the living world, not a dependent
      // result of the potentially slow full-population worker or a shortcut.
      // Reconstruct only the genuine on-duty guards at SEED posts intersecting
      // the actual close camera, with the authoritative Simulation validator.
      const dutyGuards: Resident[] = [];
      if (residentMode.actors && query) {
        const place = nearestPlace(view.x, view.z);
        if (place) for (const code of dutyGuardCodesNearView(place, simulation.tick,
            query.x, query.z, query.radius)) {
          const guard = simulation.projectedResidentByCode(code);
          if (guard?.activity === "guard" &&
              selectedResidentVisibleInView(guard, query)) dutyGuards.push(guard);
        }
      }
      const dutyGuardRevision = `${query?.key ?? ""}/${dutyGuards.map(guard => guard.code).join(",")}`;
      const holdSelected = !dutyGuards.length && !snapshot &&
        selectedResidentCurrentCarryover(
          existingSelected ? actorResidents.get(existingSelected)?.code : undefined,
          currentSelected, query);
      if (holdSelected && existingSelected && currentSelected) {
        // No stale 2-second snapshot and no camera-created actor. Every
        // handoff frame uses the current Simulation resident and final surface
        // at their actual legal feet, while unrelated old actors stay hidden.
        actorResidents.set(existingSelected, currentSelected);
        actorSources.set(existingSelected, { x: currentSelected.x, z: currentSelected.z });
        actorMotion.delete(existingSelected);
        positionActor(existingSelected, currentSelected.x, currentSelected.z);
        for (const actor of actors) if (actor !== existingSelected) {
          actor.enabled = false;
          actorResidents.delete(actor);
          actorMotion.delete(actor);
        }
      } else if (!residentMode.inspect || !residentMode.actors || !snapshot ||
          snapshotRevision !== lastResidentSnapshot || dutyGuardRevision !== lastDutyGuardRevision) {
        lastDutyGuardRevision = dutyGuardRevision;
        const residents = projectedResidents;
        if (snapshot) {
          // Do not consume the actor snapshot's presentation revision while
          // coherent terrain is still pending. When ready flips, the SAME
          // canonical early result must populate the visible actor pool.
          if (residentActorSnapshotMayMarkPresented(residentMode.actors, queryActors)) lastResidentSnapshot = snapshotRevision;
          actorSnapshotTick = simulation.tick;
          if (!snapshot.partial) simulation.acceptResidentQuery(residents, snapshot.query);
        }
        // A fresh snapshot may omit the clicked resident from its first eight.
        // Append only its actual current Simulation state when still in view.
        const visible = residentMode.actors
          ? residents.filter((resident) => resident.grounded && !resident.indoors) : [];
        if (residentMode.actors && query) {
          // The real active watch is independent of resident-worker latency.
          // Reuse the same canonical actor pool, with no fake guards or routes.
          for (const guard of dutyGuards)
            if (!visible.some(resident => resident.code === guard.code)) visible.push(guard);
          for (const code of focusedWatchCodes) {
            if (visible.some(resident => resident.code === code)) continue;
            const watch = simulation.projectedResidentByCode(code);
            if (watch?.activity === "guard" && selectedResidentVisibleInView(watch, query))
              visible.push(watch);
          }
        }
        // A camera-only worker handoff can have real on-duty guards even
        // when the full population snapshot is temporarily unavailable.
        // Keep the selected civilian as well, but ONLY from its current
        // Simulation projection; never reuse stale worker/camera positions.
        if ((snapshot || currentSelected) && selectionNearby && selected &&
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
          void characterVisuals.character(actors[i], visible[i].character, visible[i].code);
          characterVisuals.move(actors[i], 0, 0, 1);
          actors[i].enabled = true;
          actorSources.set(actors[i], { x: visible[i].x, z: visible[i].z });
          actorResidents.set(actors[i], visible[i]);
          // Walkers glide along the legal street path over the next real second (the simulation's walk window).
          const walk = visible[i].walkAhead;
          if (visible[i].activity === "commute" && walk && walk.length >= 2) {
            // The Simulation walk window is metrically paced. Flat equirectangular
            // source lengths overstate east-west travel at high latitude: keep
            // canonical physical segment lengths, with seam-safe display points.
            const { points, lengths, total } = residentWalkingPolyline(walk);
            // The accepted traveller's walkAhead starts at this main
            // Simulation tick. Routine worker routes still start at their
            // original snapshot tick; neither may gain extra path distance.
            const startTick = acceptedSiteVisits &&
              simulation.preparedSiteVisitFor(visible[i].code)
              ? simulation.tick : snapshot?.tick ?? simulation.tick;
            actorMotion.set(actors[i], { points, lengths, total, startTick });
          } else actorMotion.delete(actors[i]);
          positionActor(actors[i], visible[i].x, visible[i].z);
        }
        for (let i = visible.length; i < actors.length; i++) {
          actors[i].enabled = false;
          actorResidents.delete(actors[i]);
          actorMotion.delete(actors[i]);
        }
        setText($("simulation-status"),
          `${simulation.stats.logicalResidents.toLocaleString()} logical residents · ${visible.length} visible actors · ${actors.length} pooled actors · ${snapshot?.partial ? "discovering more outdoor residents" : `${simulation.stats.query.evaluatedResidents.toLocaleString()} spatial candidates evaluated`}.`);
      }
    }
    // An open character card follows Fantasy Time even when no worker snapshot
    // changes. It is always built from Simulation's CURRENT projection, never
    // from a snapshot, a carry-over or an actor's remembered object, so a guard
    // who has gone home to sleep can never keep displaying a day watch. Rendered
    // once per Simulation tick, not once per animation frame.
    const openPopupCode = npcPopupCode();
    if (openPopupCode &&
        (openPopupCode !== lastRenderedPopup.code || simulation.tick !== lastRenderedPopup.tick)) {
      const resident = simulation.projectedResidentByCode(openPopupCode);
      if (resident) {
        showNpcPopup(resident, simulation.tick);
        lastRenderedPopup = { code: openPopupCode, tick: simulation.tick };
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
        // The optional 3D character faces the same physical local bearing
        // used for canonical travel, not a distorted map-space diagonal.
        const direction = residentWalkingHeadingDelta(a, b);
        characterVisuals.move(actor, .8, direction.east, direction.south);
      }
    }
    // All true on-world 2D illustrated residents face the current camera;
    // their feet, routes, identities and picker remain Simulation-authoritative.
    for (const actor of actors) if (actor.enabled) characterVisuals.face(actor, camera);
    // Presentation-only crowd separation: two people can legitimately share a
    // doorway or handover spot, but the cut-outs must never draw as one figure.
    // Only the drawn position is nudged; Simulation coordinates are untouched.
    const visibleActors = [...actorSources].filter(([actor]) => actor.enabled && actorResidents.has(actor));
    if (visibleActors.length > 1) {
      const separated = separateVisibleActors(visibleActors.map(([actor, source]) => ({
        code: actorResidents.get(actor)!.code, x: source.x, z: source.z,
      })));
      for (const [actor] of visibleActors) {
        const point = separated.get(actorResidents.get(actor)!.code);
        if (point) positionActor(actor, point.x, point.z);
      }
    }
    // Nearby people occasionally trade a short line. This is scenery, not a
    // conversation with the Advisor and never a command or world fact. The
    // screen scan is throttled; bubbles still follow the cached anchors.
    if (projectionTransition <= 0.001 && camera.camera && visibleActors.length > 1) {
      if (now - lastChatterScan > 400) {
        lastChatterScan = now;
        chatterSpeakers = [];
        for (const [actor] of visibleActors) {
          const resident = actorResidents.get(actor);
          if (!resident) continue;
          characterVisuals.headPoint(actor, chatterHead);
          camera.camera.worldToScreen(chatterHead, chatterScreen);
          if (chatterScreen.x < 12 || chatterScreen.x > innerWidth - 12 ||
              chatterScreen.y < 100 || chatterScreen.y > innerHeight - 110) continue;
          chatterSpeakers.push({
            code: resident.code, name: resident.name, role: String(resident.role),
            x: actor.getPosition().x, z: actor.getPosition().z,
            screenX: chatterScreen.x, screenY: chatterScreen.y,
          });
        }
        // Stable order keeps the pair choice identical between scans.
        chatterSpeakers.sort((a, b) => a.code.localeCompare(b.code));
      }
      chatter.update(now, simulationTick, chatterSpeakers);
    } else {
      chatterSpeakers = [];
      chatter.update(now, simulationTick, []);
    }
    // Keep one screen-space marker attached to the actual enabled 3D-world actor.
    // A popup with no rendered, onscreen resident gets no invented world anchor.
    const inspectedCode = npcPopupCode();
    const pinnedDoor = ownedDoorPinAtFocus(focusedOwnedDoorPin, view.x, view.z,
      inspectedCode, view.yaw, bridgeInspectionAngle);
    if (focusedOwnedDoorPin && !pinnedDoor) focusedOwnedDoorPin = undefined;
    // A cached door belongs only to its original selected SEED resident.
    // Switching inspectors while the new actor is offscreen must never expose
    // the previous person's entrance as this person's authoritative home.
    if (inspectedCode !== markedResidentCode) {
      selectedDoorPoint = undefined;
      selectedHomeDoorMarker.dataset.homeEntrance = "";
      selectedHomeDoorMarker.hidden = true;
    }
    const inspectedActor = inspectedCode && projectionTransition <= 0.001
      ? actors.find(actor => actor.enabled && actorResidents.get(actor)?.code === inspectedCode &&
          hasResidentMesh(actor) && residentInFrontOfCamera(actor))
      : undefined;
    if (inspectedActor) {
      const foot = inspectedActor.getPosition();
      // Ground indicator uses the rendered actor root, never an invented scheduled location.
      // The rendered actor origin is physical feet. A source/render-unit offset here
      // used to lift the selected-foot marker by ~30 cm, not the intended 2 cm.
      // Keep UI anchoring in canonical metres like the depth-tested ring itself.
      selectedResidentGround.set(foot.x, foot.y + elevationToRenderY(0.02), foot.z);
      camera.camera!.worldToScreen(selectedResidentGround, selectedResidentGroundScreen);
      const gx = Math.round(selectedResidentGroundScreen.x), gy = Math.round(selectedResidentGroundScreen.y);
      // This painted ring uses the same Simulation actor transform and scene
      // depth as the world. Roofs and walls occlude it naturally on both GPUs.
      selectedFootRing.enabled = gx >= 16 && gx <= innerWidth - 16 &&
        gy >= 90 && gy <= innerHeight - 120;
      if (selectedFootRing.enabled) selectedFootRing.setLocalPosition(inspectedActor.getLocalPosition());
      // Attach the selected caption to the actual transformed illustration.
      // Its painted head may extend toward the camera and above the body.
      characterVisuals.headPoint(inspectedActor, selectedResidentWorld);
      selectedResidentWorld.y += .04;
      camera.camera!.worldToScreen(selectedResidentWorld, selectedResidentScreen);
      const x = Math.round(selectedResidentScreen.x), y = Math.round(selectedResidentScreen.y);
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
        // The caption sits beside the selected actor; its marker dot must
        // face the actor, not point at a different person behind the label.
        const anchorSide = right ? "left" : "right";
        if (selectedResidentMarker.dataset.anchorSide !== anchorSide)
          selectedResidentMarker.dataset.anchorSide = anchorSide;
        const transform = `translate3d(${x + (right ? 14 : -14)}px, ${y}px, 0) translate(${right ? "0" : "-100%"}, -110%)`;
        if (transform !== markedResidentTransform) {
          selectedResidentMarker.style.transform = transform;
          markedResidentTransform = transform;
        }
        selectedResidentMarker.hidden = false;
      } else selectedResidentMarker.hidden = true;
    } else {
      selectedResidentMarker.hidden = true;
      selectedFootRing.enabled = false;
      if (inspectedCode !== markedResidentCode) selectedDoorPoint = undefined;
    }
    // The already-resolved SEED doorway stays visible after camera-only home
    // focus even when the selected character leaves the actor render query.
    const markedDoor = inspectedCode ? selectedDoorPoint : pinnedDoor;
    if (markedDoor && projectionTransition <= 0.001) {
      if (pinnedDoor) selectedHomeDoorMarker.dataset.homeEntrance = pinnedDoor.homeEntrance;
      const door = renderFrame.sourceToRender(markedDoor.x, markedDoor.z, markedDoor.y);
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
      if (!pinnedDoor) selectedHomeDoorMarker.dataset.homeEntrance = "";
    }
    if (dt > 1 / 30) slowFrameCount++;
    droppedFrameCount += Math.max(0, Math.floor(dt / (1 / 60)) - 1);
    applyDaylight(simulation.tick,dt);
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
        const focusY = elevationToRenderY(localVisibleSurfaceHeight(view.x, view.z));
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
        labelResizeObserver.observe(label);
      }
      anchors.push({
        id,
        x: screen.x,
        y: screen.y,
        width: 0,
        height: 0,
      });
    }
    for (const [id, label] of labelNodes)
      if (!visibleLabels.has(id)) {
        labelResizeObserver.unobserve(label);
        label.remove();
        labelNodes.delete(id);
        labelDimensions.delete(id);
      }
    // Compute the cheap canonical anchor key before any potentially synchronous
    // DOM measurement. Stable camera/layout frames perform zero label/panel reads.
    const anchorKey = labelAnchorFingerprint(innerWidth, innerHeight, anchors);
    if (labelLayoutNeedsMeasurement(anchorKey, labelAnchorKey, labelMeasurementsDirty)) {
      labelAnchorKey = anchorKey;
      if (labelMeasurementsDirty) {
        labelDimensions.clear();
        measuredObstacles = [
          "masthead", "region-panel", "cell-panel", "travel-panel",
          "bottom-bar", "map-controls", "telemetry",
          "focus-coordinates", "centre-marker",
        ]
          .flatMap((name) =>
            Array.from(document.querySelectorAll(`#${name},.${name}`)),
          )
          .map((node) => node.getBoundingClientRect())
          .filter((r) => r.width && r.height)
          .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
      }
      labelMeasurementsDirty = false;
      for (const anchor of anchors) {
        let size = labelDimensions.get(anchor.id);
        if (!size) {
          const label = labelNodes.get(anchor.id)!;
          size = { width: label.offsetWidth, height: label.offsetHeight };
          labelDimensions.set(anchor.id, size);
        }
        anchor.width = size.width;
        anchor.height = size.height;
      }
      const obstacles = measuredObstacles;
      const fingerprint = JSON.stringify([
        innerWidth, innerHeight,
        anchors.map((a) => [a.id, Math.round(a.x), Math.round(a.y), a.width, a.height]),
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
      point.height ??= localVisibleSurfaceHeight(point.x, point.z) + 3;
      const local = renderFrame.sourceToRender(point.x, point.z, point.height);
      if (projectionTransition <= 0.001) {
        const screen = camera.camera!.worldToScreen(new pc.Vec3(local.x, local.y, local.z));
        return { x: screen.x, y: screen.y };
      }
      // Handoff/globe: same flat-to-globe blend the place labels use.
      const focusRender = renderFrame.sourceToRender(view.x, view.z),
        focusY = elevationToRenderY(localVisibleSurfaceHeight(view.x, view.z));
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
            flatWorldPoint(a[0], a[1], localVisibleSurfaceHeight(a[0], a[1]) + 0.8),
            flatWorldPoint(b[0], b[1], localVisibleSurfaceHeight(b[0], b[1]) + 0.8),
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
      workerSeeds: () => Object.fromEntries(workerSeeds),
      campaign: () => campaignIdentity ? { id: campaignIdentity.id, seed: campaignIdentity.seed, createdAtMs: campaignIdentity.createdAtMs } : null,
      /**
       * Read-only view of the durable campaign history (WP-S010-008-003). Reports
       * what is actually stored, including whether a write failed, so a reload
       * can be proved to replay the same changes exactly once.
       */
      campaignJournal: () => ({
        campaignId: campaignJournal.campaignId,
        eventCount: campaignJournal.events.length,
        events: campaignJournal.events.map((event) => ({
          id: event.id, type: event.type, tick: event.tick, subject: event.subject,
        })),
        status: { ...journalStatus },
      }),
      /** Read-only: why the last stored history replay was refused, if it was. */
      journalReplayProblem: () => simulation.lastReplayProblem ?? null,
      /**
       * Evidence-only: reproduce device loss/restore without a real driver reset.
       * Fires the same engine events the app handles, so the recovery path under
       * test is the real one. Never used by gameplay.
       */
      simulateDeviceLoss: () => {
        const device = app?.graphicsDevice;
        if (!device) return false;
        (device as unknown as { fire: (name: string, ...args: unknown[]) => unknown }).fire("devicelost");
        return true;
      },
      simulateDeviceRestore: async () => {
        const device = app?.graphicsDevice;
        if (!device) return false;
        (device as unknown as { fire: (name: string, ...args: unknown[]) => unknown }).fire("devicerestored");
        return true;
      },
      rendererRecovery: () => ({
        lossCount: rendererLossCount,
        phase: rendererState.phase,
        last: lastRendererRecovery ?? null,
        lastAt: lastRendererRecoveryAt,
        pendingLossSnapshot: pendingLossSnapshot ?? null,
        preservedNow: currentPreservedState(),
      }),
      /**
       * Read-only asset accounting for the ledger (WP-S009-003-001). Counts the
       * textures and meshes the app actually loaded, so classes that were
       * previously "unmeasured" become measured. Never mutates anything.
       */
      assetBytes: () => measureAssetBytes(),
      /** Read-only engine VRAM counters, or null when unavailable. */
      deviceVram: () => measureDeviceVram() ?? null,
      capturePresentation,
      /**
       * Read-only occupancy-light evidence: which rendered buildings currently
       * show window glow and where they are. Never an input to the decision.
       */
      get nightLighting() {
        return Object.freeze({
          night: buildingGlowStats.night,
          lit: buildingGlowStats.lit,
          renderedTiles: buildingGlowStats.rendered,
          tiles: buildingGlowStats.tiles,
          buildings: buildingGlowEvidence.slice(0, 24),
        });
      },
      cellAt,
      cellSeed,
      /**
       * Read-only evidence: what Simulation says ONE resident is doing at this
       * exact Fantasy tick, plus the tick used. Lets a card be compared with the
       * authority instead of trusting the rendered text.
       */
      residentNow(code: string) {
        const resident = simulation.projectedResidentByCode(code);
        if (!resident) return null;
        return {
          tick: simulation.tick,
          name: resident.name,
          task: resident.task,
          activity: resident.activity,
          activityStart: resident.activityStart,
          activityEnd: resident.activityEnd,
          activityProgress: resident.activityProgress,
          indoors: resident.indoors,
          grounded: resident.grounded,
          route: resident.route,
          x: resident.x, z: resident.z,
        };
      },
      /**
       * Evidence-only: run the SAME advice the "Suggest a site visit" control
       * runs — `simulation.considerAdvisorSiteVisit(code)` through the host
       * executor that also persists the result — and report the truthful
       * message. It grants no new authority: Simulation validates the corridor,
       * every road leg and the resident's own choice exactly as it does for a
       * player tap. Used only by evidence scripts; gameplay never calls it.
       */
      async evidenceSuggestSiteVisit(code: string) {
        if (!adviseExecutor) return { started: false, message: "The simulation is still starting." };
        return adviseExecutor(code);
      },
      /**
       * Read-only evidence hook: the evening anchors the REAL day planner will
       * use for this resident, including any Advisor preference. It resolves the
       * same plan the Simulation walks, and moves nobody.
       */
      eveningPlanFor(code: string) {
        const foundation = simulation.residentIdentityByCode?.(code);
        if (!foundation) return null;
        const place = places.find((entry) => entry.code === code.replace(/\/RESIDENT\/\d+$/, ""));
        if (!place) return null;
        const lon = place.canonicalPosition.lon;
        const day = localDayIndex(simulation.tick, lon);
        const weekday = localWeekday(simulation.tick, lon);
        const subject = { code: foundation.code, role: foundation.role, ageGroup: foundation.ageGroup, guardShift: foundation.guardShift };
        const plan = dailyPlan(subject, foundation.traits, day, weekday, false, eveningAdviceFor(code));
        const advice = eveningAdviceFor(code);
        return {
          advice: advice?.destination ?? null,
          day,
          evening: plan
            .filter((entry) => entry.start >= 17 * 3600 && entry.start < 24 * 3600)
            .map((entry) => ({ at: entry.start / 3600, kind: entry.kind, anchor: entry.anchor })),
        };
      },
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
      /**
       * Evidence-only: pin realm Fantasy Time to a specific hour so a capture
       * cannot land at night. `hour` is 0-24 in realm time (the HUD clock).
       * Passing `undefined` returns to the real clock. Never affects gameplay.
       */
      setEvidenceTick(hour: number | undefined) {
        if (hour === undefined) { evidenceTickOverride = undefined; lastSimulationRealSecond = -1; return true; }
        if (!Number.isFinite(hour) || hour < 0 || hour > 24) return false;
        // Move FORWARD to the next occurrence of the requested hour. Authoritative
        // Simulation time is monotonic, so a pin that asked to go backwards used to
        // clamp while the local-time label still followed the request — producing
        // evidence where the two clocks disagreed. Always stepping forward keeps
        // every later capture consistent with the tick actually in force.
        const nowTick = clock.tickAt(Date.now());
        const currentSecond = fantasySecondOfDay(nowTick);
        const targetSecond = Math.round(hour * 3600) % FANTASY_DAY_SECONDS;
        const deltaSeconds = (targetSecond - currentSecond + FANTASY_DAY_SECONDS) % FANTASY_DAY_SECONDS;
        evidenceTickOverride = Math.max(0, nowTick + deltaSeconds);
        lastSimulationRealSecond = -1;
        return true;
      },
      /**
       * Evidence-only: pin the render scale so adaptive resolution cannot
       * silently downscale a captured image. A slow software GPU legitimately
       * lowers the ratio to protect frame rate, but evidence must show the
       * native-resolution picture. Gameplay never calls this.
       */
      setEvidenceRenderScale(scale: number | undefined) {
        if (scale === undefined) { evidenceRenderScale = undefined; return true; }
        if (!Number.isFinite(scale) || scale <= 0 || scale > 4) return false;
        evidenceRenderScale = scale;
        return true;
      },
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
        setTerrainReliefView(enabled);
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
      /** Read-only, bounded actual gate-watch visual proof, in source space.
       * The watch roster is calculated by Simulation, never from the actor pool.
       * Screenshot jobs compare that real duty with actually enabled sprites. */
      gateWatchEvidence() {
        const place = nearestPlace(view.x, view.z);
        if (!place) return null;
        const bounds = viewBounds(view),
          radius = Math.hypot(bounds.rx, bounds.rz),
          dutyCodes = dutyGuardCodesNearView(place, simulation.tick, view.x, view.z, radius),
          displayed = actors.filter(actor => actor.enabled)
            .map(actor => ({ actor, resident: actorResidents.get(actor) }))
            .filter(entry => !!entry.resident && dutyCodes.includes(entry.resident.code))
            .map(entry => ({
              code: entry.resident!.code,
              x: entry.resident!.x, z: entry.resident!.z,
              mesh: hasResidentMesh(entry.actor),
            }));
        return { place: place.name, tick: simulation.tick,
          halfHeight: view.halfHeight, viewport: { width: innerWidth, height: innerHeight },
          coverage: guardCoverageAt(place, simulation.tick).map(gate => ({
            gateIndex: gate.gateIndex, required: gate.required,
            onDuty: gate.onDuty, missing: gate.missing,
          })), dutyCodes, displayed };
      },
      /** The same real selected resident/feet and depth-tested mesh that the
       * screenshot tool photographs. No DOM proxy or camera-owned position.
       * This is read-only: it cannot create actors, move feet or select NPCs. */
      residentFootRingEvidence() {
        const code = npcPopupCode(),
          actor = code
            ? actors.find(candidate => candidate.enabled &&
                actorResidents.get(candidate)?.code === code)
            : undefined,
          ringMeshes = selectedFootRing.render?.meshInstances ?? [];
        return {
          code,
          actorCode: actor ? actorResidents.get(actor)?.code : null,
          shown: !!actor && selectedFootRing.enabled &&
            !!selectedFootRing.render?.enabled &&
            ringMeshes.some(mesh => mesh.visible),
          grounded: !!actor && selectedFootRing.getLocalPosition().equals(actor.getLocalPosition()),
          // Compare the *actual* rendered actor foot to the same SEED-owned
          // composed ground/deck used by movement, not only to its marker ring.
          // Read-only evidence: neither picking nor this probe moves a resident.
          surfaceContact: (() => {
            const source = actor ? actorSources.get(actor) : undefined;
            if (!actor || !source) return null;
            const surface = finalSurfaceAt(source.x, source.z);
            const expected = renderFrame.sourceToRender(source.x, source.z, surface.surfaceHeight);
            const actual = actor.getLocalPosition();
            return {
              source: { ...source }, surfaceHeight: surface.surfaceHeight,
              groundHeight: surface.groundHeight, deckHeight: surface.deckHeight,
              traversal: surface.traversal, walkable: surface.walkable,
              actualRenderY: actual.y, expectedRenderY: expected.y,
              gapM: Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) *
                CANONICAL_METRES_PER_SOURCE_UNIT,
            };
          })(),
          depthTest: footRingMaterial.depthTest,
          depthWrite: footRingMaterial.depthWrite,
          meshCount: ringMeshes.length,
        };
      },
      /** On-demand proof that an onscreen, clickable actor maps to its canonical Simulation resident. */
      residentEvidencePick(requireUnobscuredFeet = false, skipCodes: readonly string[] = []) {
        const rect = canvas.getBoundingClientRect(), point = new pc.Vec3(),
          paintedHead = new pc.Vec3(), midpoint = new pc.Vec3();
        for (const actor of actors) {
          const resident = actorResidents.get(actor);
          if (!actor.enabled || !resident || skipCodes.includes(resident.code) ||
              !hasResidentMesh(actor) || !residentInFrontOfCamera(actor)) continue;
          const meshCount = drawableResidentMeshes(actor).length;
          characterVisuals.headPoint(actor, paintedHead);
          midpoint.lerp(actor.getPosition(), paintedHead, .5);
          camera.camera!.worldToScreen(midpoint, point);
          const clientX = rect.left + point.x, clientY = rect.top + point.y;
          if (point.x < 12 || point.y < 12 || point.x > rect.width - 12 || point.y > rect.height - 12) continue;
          if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
          if (pickResidentAt?.(clientX, clientY)?.code !== resident.code) continue;
          if (requireUnobscuredFeet) {
            // WP #550's real resident-foot screenshot must select a canvas
            // pixel that survives the same opaque-structure ray veto as the
            // actual pointer handler. A CPU 44px candidate behind a roof is
            // not a real clickable resident (original capture #791 failed).
            // Normal S006 resident inspection retains its existing behavior.
            const lens = camera.camera!;
            const midDepth = lens.viewMatrix.transformPoint(midpoint, new pc.Vec3()).z;
            const footDepth = lens.viewMatrix.transformPoint(actor.getPosition(), new pc.Vec3()).z;
            if (solidWorldBlocksTap(point.x, point.y,
                residentOcclusionReachDepth(midDepth, footDepth), lens)) continue;
          }
          // Refocus photographic proof on the REAL current resident foot,
          // never on ground behind a painted midpoint along the camera ray.
          const source = actorSources.get(actor);
          if (!source) continue;
          return { code: resident.code, source: { x: source.x, z: source.z },
            homeEntrance: resident.homeEntrance,
            workplace: resident.workplace, task: resident.task, route: resident.route,
            clientX, clientY, tick: simulation.tick, meshCount };
        }
        return null;
      },
      /** On-demand proof that a genuine canvas actor passes the SAME GPU depth
       * and opaque-surface validation as an actual player tap. CPU proximity
       * alone is never sufficient. Selection and Simulation are untouched. */
      async verifiedResidentEvidencePick() {
        if (!verifyResidentAtTap) return null;
        const rejected: string[] = [];
        for (let i = 0; i < actors.length; i++) {
          const pick = this.residentEvidencePick(true, rejected);
          if (!pick) return null;
          const actor = actors.find(candidate => candidate.enabled &&
            actorResidents.get(candidate)?.code === pick.code);
          const resident = actor && actorResidents.get(actor);
          if (resident && await verifyResidentAtTap(resident, pick.clientX, pick.clientY))
            return pick;
          rejected.push(pick.code);
        }
        return null;
      },
      /** Read-only, bounded explanation of why real resident meshes fail a canvas click.
       * The screenshot gate must never substitute these counts for visual evidence. */
      residentEvidenceDiagnosis() {
        const rect = canvas.getBoundingClientRect(), point = new pc.Vec3(),
          paintedHead = new pc.Vec3(), midpoint = new pc.Vec3();
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
          characterVisuals.headPoint(actor, paintedHead);
          midpoint.lerp(actor.getPosition(), paintedHead, .5);
          camera.camera!.worldToScreen(midpoint, point);
          const onScreen = residentInFrontOfCamera(actor) &&
            point.x >= 12 && point.y >= 12 && point.x <= rect.width - 12 && point.y <= rect.height - 12;
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
          assetBytes = measureAssetBytes(),
          deviceVram = measureDeviceVram(),
          resourceLedger = buildLedger({
            cachedGeometryBytes,
            readyUploadBytes: readyGeometryBytes,
            surfaceBytes,
            continuityCpuBytes: continuityRetainedBytes(),
            transientCpuBytes: continuityTransientBytes(),
            // Measured from the live asset registry, not estimated.
            assetTextureBytes: assetBytes.textures,
            assetMeshBytes: assetBytes.meshes,
            // Authoritative engine VRAM when available; supersedes the
            // narrower texture estimates so nothing is counted twice.
            deviceVramTextures: deviceVram?.textures,
            deviceVramBuffers: deviceVram?.buffers,
          });
        // A model lost during this snapshot can restore 2D immediately.
        // Classify each visible actor once so counters and format agree.
        const visibleResidentActors = actors.filter(actor => actor.enabled);
        const visualSummary = summarizeCharacterPresentations(
          visibleResidentActors, actor => characterVisuals.format(actor),
        );
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
            cacheTrimEvents,
            cacheTrimmedBytes,
            peakCachePressureBytes,
            discardedPresentationJobs,
            detailGenerationJobs, coverageGenerationJobs, meshGroupUploads,
            activeDetailInstances: activeKeys.map(key=>({key,serial:tileCache.get(key)?.serial})) ,
            cpuResourceBytesEstimated: resourceLedger.cpuBytes,
            gpuResourceBytesEstimated: resourceLedger.gpuBytes,
            combinedResourceBytesEstimated: resourceLedger.combinedBytes,
            resourceLedgerCategories: resourceLedger.categories,
            unmeasuredResourceCategories: resourceLedger.unmeasured,
            resourceEstimateIsLowerBound: resourceLedger.lowerBound,
            transientResourceBytesEstimated: resourceLedger.transientBytes,
            assetBytesByClass: assetBytes.byClass,
            deviceVramMeasured: deviceVram ?? null,
            cacheTrimStartBytes: streamingBudget.cacheTrimStartBytes,
            memoryCeilingBytes: streamingBudget.combinedBytes,
            continuityCpuBytesEstimated: continuityCpuBytes(),
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
                cpuBytes: resourceLedger.cpuBytes,
                gpuBytes: resourceLedger.gpuBytes,
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
          closeLighting: {enabled: closeLightingVisible, eveningWeight: eveningGlow, addedPointLights: 0,
            night: displayedDaylight?.night ?? false,
            litBuildings: buildingGlowStats.lit, renderedGlowTiles: buildingGlowStats.rendered,
            glowTiles: buildingGlowStats.tiles, litBuildingCodes: buildingGlowStats.codes},
          visibleResidents: visualSummary.visibleActors,
          residentPresentation: {
            logicalResidents: simulation.stats.logicalResidents,
            pooledActors: actors.length,
            ...visualSummary,
            generatedActors: visibleResidentActors.filter(actor => actor.tags.has("generated-npc")).length,
            enabledActors: visualSummary.visibleActors,
            firstActor: visibleResidentActors.length ? {
              position: visibleResidentActors[0].getPosition().toString(),
              scale: visibleResidentActors[0].getLocalScale().toString(),
            } : null,
            physicalHeightsM: visibleResidentActors.map(actor => actor.getLocalScale().y * DEFAULT_CHARACTER_HEIGHT_M * CANONICAL_METRES_PER_SOURCE_UNIT),
            worldHeightsM: visibleResidentActors.map(actor => Math.abs(actor.getRotation().transformVector(new pc.Vec3(0, actor.getLocalScale().y * DEFAULT_CHARACTER_HEIGHT_M, 0)).y) * CANONICAL_METRES_PER_SOURCE_UNIT),
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
  mountAdvisorPanel();
  // Compact shell: icon dock, segmented tabs, shortcuts and the help sheet.
  // Every action forwards to the authoritative controls above.
  setupUiShell({
    findNearestResident: () => {
      canvas.focus({ preventScroll: true });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    },
  });
  app.start();
}

/**
 * Human-readable realm name for a settlement, for region-aware answers.
 * Returns the canonical country name, never an invented one.
 */
function countryOf(place: Place | undefined): string {
  if (!place) return "";
  return countries.find((country) => country.id === place.country)?.name ?? "";
}

/**
 * Header chip naming the assigned protagonist (owner request). Clicking it
 * focuses that resident at Hero scale. Camera only: nobody is moved.
 */
/** The Simulation-backed executor for advice the character accepted. */
let adviseExecutor: ((code: string, options?: { allowRoutineBreak?: boolean }) => Promise<{ started: boolean; message: string }>) | undefined;

function mountProtagonistBar() {
  const chip = document.getElementById("protagonist-chip") as HTMLButtonElement | null;
  const name = document.getElementById("protagonist-name");
  let onFocus: (() => boolean) | undefined;
  const update = (resident: { name: string; role: string; settlement: string } | undefined) => {
    if (!chip || !name) return;
    if (!resident) {
      chip.hidden = true;
      chip.removeAttribute("data-name");
      name.textContent = "";
      return;
    }
    chip.hidden = false;
    chip.dataset.name = resident.name;
    name.textContent = resident.name;
    chip.title = `Your protagonist: ${resident.name} — ${resident.role.replace(/-/g, " ")} of ${resident.settlement}. Click to focus at Hero scale.`;
    chip.setAttribute("aria-label", `Focus your protagonist ${resident.name} at Hero scale`);
  };
  if (chip) {
    chip.addEventListener("click", () => {
      if (onFocus && !onFocus()) chip.blur();
    });
  }
  return {
    update,
    updateRelationship: (state: { trust: number } | undefined) => {
      if (!chip || !state) return;
      chip.dataset.trust = String(Math.round(state.trust));
    },
    onFocus: (callback: () => boolean) => { onFocus = callback; },
  };
}

/**
 * Advisor dialogue (WP-S010-007-002). The panel reads a read-only snapshot of the
 * inspected protagonist; every sentence it can produce comes from these facts or
 * is an explicit refusal. Nothing here writes Simulation state.
 */
function mountAdvisorPanel() {
  const root = document.getElementById("advisor-panel");
  if (!root) return;
  /** Nearest real grounded resident actor; deterministic by current distance. */
  const nearestAdvisorResident = () => {
    let best: Resident | undefined, bestDistance = Infinity;
    for (const [actor, resident] of actorResidents) {
      if (!actor.enabled || !resident.grounded) continue;
      const distance = Math.hypot(resident.x - view.x, resident.z - view.z);
      if (distance < bestDistance) { bestDistance = distance; best = resident; }
    }
    return best;
  };
  const knownPlaces = () => villages.concat(cities).map((place) => ({ id: place.id, name: place.name }));
  const knownPeople = () => {
    const seen = new Set<string>(), people: { id: string; name: string }[] = [];
    for (const resident of actorResidents.values()) {
      if (seen.has(resident.code)) continue;
      seen.add(resident.code);
      people.push({ id: resident.code, name: resident.name });
    }
    return people;
  };
  const panel = new AdvisorPanel(root, {
    seed: () => Math.floor(simulation.tick / 24),
    readFacts: () => {
      // The player advises their assigned protagonist. Until one is chosen, fall
      // back to the inspected resident, then the nearest real grounded resident.
      const assigned = getProtagonistCode();
      const resident =
        (assigned ? simulation.residentByCode(assigned) : undefined) ??
        (npcPopupCode() ? simulation.projectedResidentByCode(npcPopupCode()) : undefined) ??
        nearestAdvisorResident();
      if (!resident || !resident.grounded) return undefined;
      const lon = resident.position.lon, second = localSecondOfDay(simulation.tick, lon);
      const place = villages.concat(cities).find((candidate) => candidate.id === resident.settlement);
      // Human-readable anchors only: raw SEED codes must never reach the player.
      const anchors = anchorNames(resident);
      const readableTask = (value: string) => (/^ADVISOR-/.test(value) || value.includes("/") ? "" : value);
  /** Turns a raw activity key into a human phrase the character can say. */
  const readableActivity = (value: string) => {
    const key = value.replace(/[_-]/g, " ").trim();
    const phrases: Record<string, string> = {
      work: "at my work", working: "at my work", travel: "on the road", walking: "on the road",
      home: "at home", rest: "resting", idle: "taking a moment", sleep: "resting",
      eat: "eating", meal: "eating", social: "talking with neighbours", guard: "on guard duty",
      duty: "on guard duty", shop: "at the market", market: "at the market", pray: "at prayer",
      errand: "running an errand", errands: "running errands", craft: "at my craft",
      field: "in the fields", farm: "in the fields", drink: "at the tavern", visit: "visiting",
    };
    return phrases[key] ?? key;
  };
      return {
        name: resident.name,
        role: String(resident.role),
        settlement: anchors.settlement ?? place?.name ?? "the settlement",
        homeName: anchors.home || "my house",
        workName: anchors.work || "my workplace",
        task: readableTask(resident.task ?? "") || readableTask(resident.route ?? "") || "",
        activity: readableActivity(String(resident.activity)),
        activityKey: String(resident.activity),
        indoors: resident.indoors,
        mood: resident.mood.label,
        moodValue: resident.mood.value,
        clockLabel: clockLabel(second),
        daylightPhase: daylightAt(second).phase,
        travelling: resident.travelProgress !== undefined,
        knownPlaces: knownPlaces(),
        knownPeople: knownPeople(),
        // Enrichment for the topic tree: all of it comes from canonical state.
        hour: second / 3600,
        region: countryOf(place),
        placeKind: place?.kind === "city" ? "city" : "village",
        ageGroup: resident.ageGroup,
        guardShift: resident.guardShift,
        personality: resident.traits.personality,
        characterCode: resident.code,
        day: localDayIndex(simulation.tick, lon),
        character: loadCharacter(resident.code, localDayIndex(simulation.tick, lon)),
      };
    },
    onRelationshipChange: (state, outcome) => {
      // Saved immediately by the panel; refresh the header so a trust change is
      // visible outside the conversation panel too.
      bar.updateRelationship?.(state);
    },
    // The character has agreed to weigh the advice. Only the Simulation decides
    // whether the world allows it: it validates legal ground, the site-visit
    // corridor, every road and bridge, and then makes one bounded journey.
    onAdviceAccepted: async (proposal, _facts) => {
      const code = getProtagonistCode();
      if (!code) return { started: false, message: "No protagonist is assigned." };
      if (proposal.intent !== "advice.travel_to_place") {
        return { started: false, message: "The character has no lawful way to act on that yet." };
      }
      const executor = adviseExecutor;
      if (!executor) return { started: false, message: "The simulation is still starting." };
      // Trust already decided the character is willing; only a well-trusted
      // Advisor can pull them away from their work for one excursion.
      const saved = loadCharacter(code, localDayIndex(simulation.tick, 0));
      return executor(code, { allowRoutineBreak: adviceVerdict(saved) === "accept" });
    },
  });
  (window as unknown as { advisorDialogue?: AdvisorPanel }).advisorDialogue = panel;
  // Player-facing protagonist control. `assign` validates against the real world
  // before storing, so an unknown code can never become the advised identity.
  (window as unknown as {
    advisorProtagonist?: {
      current: () => string | undefined;
      assign: (code: string) => boolean;
      clear: () => void;
      focus: () => boolean;
      name: () => string | undefined;
    };
  }).advisorProtagonist = {
    current: () => getProtagonistCode(),
    assign: (code: string) => {
      const resident = simulation.residentByCode(code);
      if (!resident) return false;
      return setProtagonistCode(code, "user");
    },
    clear: () => setProtagonistCode(undefined, "clear"),
    focus: () => focusProtagonist(),
    name: () => {
      const code = getProtagonistCode();
      return code ? simulation.residentByCode(code)?.name : undefined;
    },
  };

  /** Camera-only focus on the assigned protagonist at Hero scale. */
  const focusProtagonist = () => {
    const code = getProtagonistCode();
    if (!code) return false;
    const resident = simulation.residentByCode(code);
    if (!resident) return false;
    // Always centre on the protagonist's current position, grounded/indoors or not.
    const point = residentObservationPoint(resident) ?? residentFocusPoint(resident);
    navigate(point.x, point.z, HERO_HALF_HEIGHT);
    return true;
  };
  (window as unknown as { advisorFocusProtagonist?: () => boolean }).advisorFocusProtagonist = focusProtagonist;

  const bar = mountProtagonistBar();
  const refreshBar = () => {
    const code = getProtagonistCode();
    const resident = code ? simulation.residentByCode(code) : undefined;
    bar.update(resident ? { name: resident.name, role: String(resident.role), settlement: anchorNames(resident).settlement ?? "" } : undefined);
    // Keep the conversation header naming the person being advised.
    panel.setSubject(resident?.name);
    // Restore the saved relationship strip too, so a reload shows the same
    // trust and mood the player left behind.
    panel.refreshRelationship();
    if (resident) bar.updateRelationship?.(loadCharacter(resident.code, localDayIndex(simulation.tick, resident.position.lon)));
  };
  subscribeProtagonist((_code, reason) => {
    refreshBar();
    // An explicit player assignment also shows that resident at Hero scale.
    if (reason === "user") focusProtagonist();
  });
  restoreProtagonist(code => Boolean(simulation.residentByCode(code)));
  refreshBar();
  bar.onFocus(focusProtagonist);
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
