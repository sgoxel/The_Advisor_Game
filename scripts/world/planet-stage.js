(function(){
"use strict";

const VERSION="planet-registration-v1";
const ENGINE_VERSION="2.22.3";
const ENGINE_URL="https://cdn.jsdelivr.net/npm/playcanvas@"+ENGINE_VERSION+"/+esm";

const EARTH_REFERENCE_RADIUS_METERS=6_371_000;
const WORLD_SCALE_FRACTION=0.10;
const WORLD_RADIUS_METERS=Math.round(EARTH_REFERENCE_RADIUS_METERS*WORLD_SCALE_FRACTION);
const WORLD_DIAMETER_METERS=WORLD_RADIUS_METERS*2;
const WORLD_CIRCUMFERENCE_METERS=2*Math.PI*WORLD_RADIUS_METERS;
const DISPLAY_RADIUS_UNITS=3.25;
const TEXTURE_WIDTH=640;
const TEXTURE_HEIGHT=320;
const LATITUDE_SEGMENTS=96;
const LONGITUDE_SEGMENTS=160;
const HEIGHT_EXAGGERATION=5.0;
const OCEAN_VISUAL_DEPTH_FACTOR=0.0;
const ZOOM_MIN=0;
const ZOOM_MAX=1;
const ZOOM_WHEEL_SENSITIVITY=0.00045;
const ZOOM_PINCH_SENSITIVITY=0.003;
const ZOOM_DISTANCE_FACTOR=0.018;
const SCALE_LADDER=Object.freeze(["1/10","1/20","1/50","1/100","1/250","1/500","1/1000","1/2500","1/5000","1/10000"]);
const SCALE_DENOMINATORS=Object.freeze([10,20,50,100,250,500,1000,2500,5000,10000]);
const SCALE_FOOTPRINT_PROGRESS_EXPONENT=1.6;
const SEMANTIC_SCALE_HYSTERESIS_RATIO=1.06;
let semanticScaleState={index:0,initialized:false,changes:0,holds:0,lastRawIndex:0};
// One continuous footprint ladder drives every representation:
// - up to LADDER_START_SCALAR it is the true surface footprint of the globe
//   camera (it depends on viewport framing, so it is computed, not tabled);
// - above it the footprint shrinks log-uniformly to the 36 m ground view, so
//   each wheel/pinch step changes apparent scale by the same factor.
// Local LOD tiers are native where the ladder equals their height, and the
// semantic band past SEMANTIC_LOCAL_BAND_START is the band of that tier.
const LADDER_START_SCALAR=.70;
const GROUND_FOOTPRINT_HEIGHT_METERS=36;
const SEMANTIC_LOCAL_BAND_START=.58;
const ZOOM_BANDS=Object.freeze([{id:"planet",max:.18},{id:"continent",max:.38},{id:"country-region",max:SEMANTIC_LOCAL_BAND_START},{id:"regional-overview",max:null},{id:"regional-detail",max:null},{id:"district",max:null},{id:"local-area",max:null},{id:"settlement",max:null},{id:"near-ground",max:null},{id:"ground",max:1}]);

let pc=null;
let app=null;
let device=null;
let root=null;
let canvas=null;
let planet=null;
let cameraEntity=null;
let keyLight=null;
let fillLight=null;
let surfaceMaterial=null;
let tangentPatch=null;
let tangentPatchMaterial=null;
let horizonSkirt=null;
let horizonSkirtMaterial=null;
let localStaticRoot=null;
let localStaticMaterials=null;
let localFaunaRoot=null;
let localFaunaActors=[];
let localFaunaClock=0;
const LOCAL_FAUNA_REACTION_TICK_SECONDS=.10;
const LOCAL_FAUNA_BUCKET_METERS=24;
const LOCAL_FAUNA_MEMORY_TTL_MS=8000;
const LOCAL_FAUNA_MEMORY_LIMIT=16;
const LOCAL_FAUNA_SPECS=Object.freeze({
  deer:Object.freeze({triggerMeters:28,speedMetersPerSecond:8.5,reactionSeconds:2.6,returnSpeedMetersPerSecond:3.2,maxAltitudeMeters:0}),
  hare:Object.freeze({triggerMeters:18,speedMetersPerSecond:6.6,reactionSeconds:1.8,returnSpeedMetersPerSecond:2.8,maxAltitudeMeters:0}),
  bird:Object.freeze({triggerMeters:20,speedMetersPerSecond:7.2,reactionSeconds:2.2,returnSpeedMetersPerSecond:3.0,maxAltitudeMeters:12}),
  waterbird:Object.freeze({triggerMeters:17,speedMetersPerSecond:5.8,reactionSeconds:2.0,returnSpeedMetersPerSecond:2.4,maxAltitudeMeters:7})
});
let localFaunaReactionAccumulator=0;
const localFaunaReactionMemory=new Map();
function freshWildlifeReaction(){
  return {
    enabled:true,activeActorCount:0,visibleActorCount:0,reactingActorCount:0,sleepingActorCount:0,
    spatialBucketCount:0,proximityChecks:0,triggerCount:0,triggerByKind:{deer:0,hare:0,bird:0,waterbird:0},
    stateCounts:{idle:0,flee:0,takeoff:0,return:0,sleep:0},presenceMoveMeters:0,
    lastPresenceEastMeters:null,lastPresenceNorthMeters:null,lastTriggerActorId:null,lastTriggerKind:null,
    updateCount:0,lastUpdateMs:0,maxUpdateMs:0,reactionTickMs:LOCAL_FAUNA_REACTION_TICK_SECONDS*1000,
    bucketMeters:LOCAL_FAUNA_BUCKET_METERS,maxActors:4,domesticAvailable:false,
    domesticReason:"no-canonical-domestic-ambient-actor-exposed",
    presentationOnly:true,simulationAuthority:false,bounded:true,fullWorldScan:false
  };
}
let wildlifeReaction=freshWildlifeReaction();
let localWildernessEnabled=true;
let environmentalReactionRoot=null;
let environmentalReactionMaterials=null;
let environmentalReactionTextures=null;
let environmentalReactionPool=[];
const ENVIRONMENT_REACTION_MIN_MOVE_METERS=.65;
const ENVIRONMENT_REACTION_MAX_MOVE_METERS=7.5;
const ENVIRONMENT_REACTION_TRIGGER_INTERVAL_MS=90;
const ENVIRONMENT_REACTION_POOL_PER_KIND=2;
let environmentalReactions={
  enabled:true,poolInitialized:false,poolGroupCount:0,poolDrawableCount:0,activeCount:0,visibleCount:0,activeDrawCallEstimate:0,peakActiveCount:0,
  triggerCount:0,expiredCount:0,reuseCount:0,triggerByKind:{dust:0,grassBend:0,footprint:0},
  lastKind:null,lastSurfaceType:null,lastMovementMeters:0,lastTriggerAtMs:0,lastUpdateMs:0,maxUpdateMs:0,
  minMoveMeters:ENVIRONMENT_REACTION_MIN_MOVE_METERS,maxMoveMeters:ENVIRONMENT_REACTION_MAX_MOVE_METERS,
  triggerIntervalMs:ENVIRONMENT_REACTION_TRIGGER_INTERVAL_MS,desktopActiveCap:6,phoneActiveCap:4,
  source:"canonical ground-scale navigation + TerrainFoundation",poolAllocationsAfterInit:0,
  terrainMutation:false,presentationOnly:true,simulationAuthority:false,bounded:true,fullWorldScan:false,perFrameWorldScan:false
};
let localBuildingActivityRoot=null;
let localBuildingActivityContext=null;
let buildingActivity={
  active:false,authoritativeHour:null,timeBand:"unknown",buildingCount:0,activeBuildingCount:0,
  occupiedBuildingCount:0,activeWorkplaceCount:0,activeHomeCount:0,warmWindowCount:0,
  smokeCueCount:0,openMarketCount:0,forgeGlowCount:0,workPropCount:0,cueCount:0,
  drawCallEstimate:0,dynamicLightCount:0,particleEmitterCount:0,sharedMaterialCount:0,
  updateCount:0,lastUpdateMs:0,maxUpdateMs:0,lastSignature:null,buildings:[],
  activitySource:"DailyActivity.resolveActionTarget",occupancySource:"ResidentMovement.get when available",
  presentationOnly:true,simulationAuthority:false,bounded:true,fullSettlementPerFrameScan:false
};
let localNpcRoot=null;
let localNpcMaterials=null;
let localNpcContext=null;
let localNpcPresentation={active:false,activeCount:0,entityCount:0,drawCallEstimate:0,buildTimeMs:0,authoritativeIdentitySource:"DailyActivity",authoritativeActivitySource:"DailyActivity.resolveActionTarget",presentationOnly:true,simulationAuthority:false};
const localBuildingInspectionKeys=new Set();
const localNpcInspectionKeys=new Set();
let localStatic={active:false,signature:null,level:"inactive",revealTier:"none",settlementId:null,settlementName:null,settlementClass:null,settlementRole:null,settlementPlanRevision:null,layoutSignature:null,canonicalCenterTile:null,presentationScale:1,occupiedAreaCount:0,coarseRoadCount:0,coarseBuildingCount:0,landmarkCount:0,fullRoadCount:0,fullBuildingCount:0,roadCount:0,buildingCount:0,vegetationCount:0,wildernessCount:0,ambientFaunaCount:0,waterCount:0,entityCount:0,triangleEstimate:0,drawCallEstimate:0,buildTimeMs:0,grounded:true,viewportBounded:true,presentationOnly:true,simulationAuthority:false,authority:"spherical-seed-focus-presentation"};
let resizeObserver=null;
let yawDegrees=-18;
let pitchDegrees=-10;
let dragging=false;
let pointerId=null;
let lastPointerX=0;
let lastPointerY=0;
let pointerDragCount=0;
let rotationChangeCount=0;
let ready=false;
let startupError=null;
let frameCount=0;
let activeSeed=null;
let geography=null;
let geographySignature=null;
let geographyVerification=null;
let geographyStats=null;
let featureTargets=null;
let buildTimeMs=0;
let meshVertexCount=0;
let meshTriangleCount=0;
let generatedTexture=null;
let startupProgress={mode:"indeterminate",measuredPercent:null,displayedPercent:null,phaseId:"planning",phaseLabel:"Planning startup…",completedWeightedWork:0,totalWeightedWork:100,firstPaintAtMs:Date.now(),determinateAtMs:null,measured100AtMs:null,gameplayReadyAtMs:null,optionalPostReadyWorkCount:0};
let loadingProof=null;
const STARTUP_SLICE_BUDGET_MS=6;
let startupScheduler={sliceBudgetMs:STARTUP_SLICE_BUDGET_MS,sliceCount:0,yieldCount:0,maxSliceMs:0,longTaskOver50:0,longTaskOver100:0,longTaskOver200:0,longestLongTaskMs:0,controlledLongTaskOver50:0,controlledLongTaskOver100:0,controlledLongTaskOver200:0,controlledLongestLongTaskMs:0,maxEventLoopLagMs:0,heartbeatCount:0,paintHeartbeatCount:0,firstPlayableWorkUnits:0,completedFirstPlayableWorkUnits:0,optionalPostReadyWorkCount:0,backgroundPreparationCompleteAtMs:null,phaseTimings:{}};
let longTaskObserver=null;
let heartbeatTimer=null;
let controlledWorkActive=false;
let lastHeartbeatAt=0;
let destinationNavigator={open:false,category:"all",descriptors:[],selectedId:null,queryCount:0,lastQueryMs:0,navigationCount:0,lastTarget:null};
const inspectionPickables=new Map();
let inspection={selectedId:null,selectedType:null,pointerDownX:0,pointerDownY:0,dragDistance:0,pickQueries:0,lastPickCandidateCount:0,lastPickQueryMs:0,tooltipUpdates:0,lastTooltipUpdateMs:0,contentRefreshes:0,lastContentRefreshAtMs:0,dismissCount:0};
let cloudLayer=null;
let ambientMotion={enabled:true,cloudLayerCount:0,animatedEntityCount:0,drawCallEstimate:0,updateCount:0,lastUpdateMs:0,maxUpdateMs:0,cloudYawDegrees:0};
let atmosphere={active:false,authoritativeHour:null,phase:"unbound",source:"none",dynamicLightCount:2,materialCount:1,drawCallImpact:0,simulationAuthority:false};
let atmospherePalette=null;
let atmosphereTimeBinding={available:false,active:false,readOnly:true,directRealClockRead:false,campaignMutation:false,source:"unavailable",campaignSeed:null,lastTimestampKey:null,lastPollAtMs:0,lastAppliedAtMs:0,pollIntervalMs:1000,error:null};
let wilderness={generated:false,cellCount:0,acceptedStaticProps:0,vegetationClusters:0,rockClusters:0,ambientFaunaZones:0,rejectedWater:0,drawCalls:0,triangles:0,preparationMs:0,cacheReuse:false,perFrameScatter:false,simulationAuthority:false,
  localEnabled:true,localActive:false,localSignature:null,localLevel:null,localBiome:null,localCandidateCount:0,localAcceptedStaticProps:0,localAmbientFaunaActiveCount:0,localShoreAccentCount:0,localRejectedWater:0,localRejectedManaged:0,localRejectedRoad:0,localFamilyCounts:{},localBiomeCounts:{},localDrawCalls:0,localTriangles:0,localPreparationMs:0,localPlanCached:false,localLayoutSignature:null,localFrameUpdateMs:0,localMaxFrameUpdateMs:0,localFullWorldScan:false,localDeterministicGlobalCells:true};
let zoomState={scalar:0,band:"planet",focusLatitudeRadians:-pitchDegrees*Math.PI/180,focusLongitudeRadians:-yawDegrees*Math.PI/180,baseCameraDistance:0,cameraDistance:0,visibleFootprintWidthMeters:WORLD_DIAMETER_METERS,visibleFootprintHeightMeters:WORLD_DIAMETER_METERS,wheelEvents:0,pinchEvents:0,zoomChanges:0};
const activePointers=new Map();
let lastPinchDistance=null;
let projectionState={mode:"globe",blend:0,transitionStart:.45,transitionEnd:.82,tangentOrigin:null,basis:null,cameraTarget:null,continuityErrorMeters:0};
const LOCAL_SAMPLE_SPACING_METERS=2;
const LOCAL_PATCH_MARGIN=1.50;
const LOCAL_RESOURCE_CACHE_LIMIT=8;
const LOCAL_GRACE_RESIDENCY_MS=4500;
const LOCAL_RESIDENCY_RECORD_LIMIT=64;
const LOCAL_PREFETCH_RECORD_LIMIT=16;
// Keep adjacent-tier stabilization narrow enough that the same physical footprint
// resolves to the same canonical LOD after forward or reverse zoom settles.
const LOCAL_LOD_HYSTERESIS=0.003;
// Hierarchical local detail selection is driven by projected screen-space
// error, not by zoom-band identity.  The quadtree root is larger than the
// complete 10%-Earth circumference, so every streamed local cell has stable
// SEED-coordinate ancestry independent of camera/viewport/load order.
const SPATIAL_LOD_ROOT_CELL_METERS=4_194_304;
const SPATIAL_LOD_MAX_DEPTH=20;
// A canonical cell-centered resource must cover every possible focus position
// inside that cell even at the narrowest supported portrait aspect. Keep cell
// span well inside the physical patch's spare margin; identity therefore stays
// viewport-independent while the disposable presentation patch may resize.
const SPATIAL_CELL_MAX_LEVEL_HEIGHT_RATIO=.22;
// Keep local refinement near a two-pixel projected source/geometric error,
 // comparable to a normal screen-space terrain LOD budget.  These are tighter
 // than the original 8/9/6.5px values; hierarchy identity remains coordinate-only.
const SSE_TARGET_PIXELS=2;
const SSE_REFINE_PIXELS=2.5;
const SSE_COARSEN_PIXELS=1.5;
// A representation may shrink to cover a wider view, but once it would need
// to be magnified beyond this ratio it is no longer an acceptable steady-state
// source. Refinement must select a finer canonical child instead of stretching
// a coarse parent across a closer physical scale.
const SSE_MAX_NATIVE_MAGNIFICATION=1.5;
const SPATIAL_OVERSCAN_CELL_RADIUS=1;
// The world-matched tangent continuation must cover large temporary focus
// offsets and child preparation without exposing the clear-color rectangle.
// Keep it bounded to one shared quad/texture while sampling a wider canonical
// SEED footprint; this adds no draw calls or alternate geography authority.
const LOCAL_SURROUND_SPAN_FACTOR=6;
// Every physical LOD is native at its band's upper scalar and covers at most
// ~2.5x of visible-footprint range, so presentation compensation never has to
// shrink or magnify a tier far enough to read as a scale pop or blurry stretch.
const LOCAL_DETAIL_LEVELS=Object.freeze([
  Object.freeze({id:"regional-overview",band:"regional-overview",visibleHeightMeters:400000,sampleSpacingMeters:12000,textureSize:160,reliefClampMeters:7000,reliefGain:11,maxHeightUnits:.95,staticWorld:false}),
  Object.freeze({id:"regional-detail",band:"regional-detail",visibleHeightMeters:140000,sampleSpacingMeters:4000,textureSize:192,reliefClampMeters:7000,reliefGain:10,maxHeightUnits:.80,staticWorld:false}),
  Object.freeze({id:"district",band:"district",visibleHeightMeters:50000,sampleSpacingMeters:1400,textureSize:256,reliefClampMeters:6000,reliefGain:9,maxHeightUnits:.65,staticWorld:false}),
  Object.freeze({id:"local-area-wide",band:"local-area",visibleHeightMeters:20000,sampleSpacingMeters:480,textureSize:320,reliefClampMeters:5000,reliefGain:8,maxHeightUnits:.60,staticWorld:false}),
  Object.freeze({id:"local-area",band:"local-area",visibleHeightMeters:10000,sampleSpacingMeters:220,textureSize:384,reliefClampMeters:4200,reliefGain:7,maxHeightUnits:.55,staticWorld:false}),
  // These physical terrain tiers do not contain settlement geometry yet, so keep
  // the player-facing semantic band at LOCAL AREA until a static-world resource
  // is actually visible. This prevents the UI/ruler from claiming SETTLEMENT
  // while the frame still contains terrain only.
  Object.freeze({id:"settlement-wide",band:"local-area",visibleHeightMeters:5000,sampleSpacingMeters:110,textureSize:448,reliefClampMeters:3000,reliefGain:5.5,maxHeightUnits:.50,staticWorld:false}),
  Object.freeze({id:"settlement",band:"local-area",visibleHeightMeters:2000,sampleSpacingMeters:44,textureSize:448,reliefClampMeters:1600,reliefGain:4,maxHeightUnits:.42,staticWorld:false}),
  Object.freeze({id:"settlement-core",band:"local-area",visibleHeightMeters:1000,sampleSpacingMeters:22,textureSize:448,reliefClampMeters:900,reliefGain:3,maxHeightUnits:.38,staticWorld:false}),
  // The first two static-world tiers visibly contain the road/building layout,
  // so they own SETTLEMENT semantics. NEAR GROUND begins only once the closer
  // resource is ready, preserving truthfulness through asynchronous handoffs.
  Object.freeze({id:"near-ground-wide",band:"settlement",visibleHeightMeters:500,sampleSpacingMeters:11,textureSize:352,reliefClampMeters:400,reliefGain:2.2,maxHeightUnits:.33,staticWorld:true}),
  Object.freeze({id:"near-ground",band:"settlement",visibleHeightMeters:200,sampleSpacingMeters:5,textureSize:384,reliefClampMeters:180,reliefGain:1.5,maxHeightUnits:.28,staticWorld:true}),
  Object.freeze({id:"near-ground-close",band:"near-ground",visibleHeightMeters:80,sampleSpacingMeters:3,textureSize:384,reliefClampMeters:60,reliefGain:.9,maxHeightUnits:.22,staticWorld:true}),
  Object.freeze({id:"ground",band:"ground",visibleHeightMeters:36,sampleSpacingMeters:LOCAL_SAMPLE_SPACING_METERS,textureSize:384,reliefClampMeters:10,reliefGain:.35,maxHeightUnits:.18,staticWorld:true})
]);
const LOCAL_PREP_SLICE_BUDGET_MS=6;
const LOCAL_STANDIN_MAX_MAGNIFICATION=6;
const LOCAL_TANGENT_OWNERSHIP_BLEND=.055;
const LOCAL_STANDIN_MIN_COMPENSATION=1/3;
const GLOBE_VERTICAL_FOV_DEGREES=34;
let ladderCache={key:null,startHeight:0,levelMax:[]};
function globeCameraDistanceForScalar(value){
  const safeSurfaceDistance=DISPLAY_RADIUS_UNITS*1.42;
  const travel=Math.max(0,(zoomState.baseCameraDistance||safeSurfaceDistance*2.5)-safeSurfaceDistance);
  return safeSurfaceDistance+travel*Math.pow(1-clamp(value,0,1),2.15);
}
function globeSurfaceFootprintHeightMeters(value){
  const surfaceDistance=Math.max(.05,globeCameraDistanceForScalar(value)-DISPLAY_RADIUS_UNITS);
  return 2*surfaceDistance*Math.tan(GLOBE_VERTICAL_FOV_DEGREES*Math.PI/360)*(WORLD_RADIUS_METERS/DISPLAY_RADIUS_UNITS);
}
const LADDER_RATE_RAMP=.08;
function ladderState(){
  const key=Number(zoomState.baseCameraDistance||0).toFixed(5);
  if(ladderCache.key===key)return ladderCache;
  // Continue from the globe camera's footprint AND its zoom rate at the ladder
  // start, ramp the log-rate over LADDER_RATE_RAMP, then hold it constant so
  // the ground view lands exactly on GROUND_FOOTPRINT_HEIGHT_METERS at 1.0.
  const startHeight=Math.max(GROUND_FOOTPRINT_HEIGHT_METERS*10,globeSurfaceFootprintHeightMeters(LADDER_START_SCALAR));
  const e=.001,startRate=Math.max(0,(Math.log(globeSurfaceFootprintHeightMeters(LADDER_START_SCALAR-e))-Math.log(startHeight))/e);
  const span=1-LADDER_START_SCALAR,total=Math.log(startHeight/GROUND_FOOTPRINT_HEIGHT_METERS),ramp=Math.min(LADDER_RATE_RAMP,span*.5);
  const cruiseRate=(total-startRate*ramp*.5)/(span-ramp*.5);
  ladderCache={key,startHeight,startRate,cruiseRate,ramp,levelMax:[],orientationStart:0};
  ladderCache.levelMax=LOCAL_DETAIL_LEVELS.map((level,index)=>index===LOCAL_DETAIL_LEVELS.length-1?1:Number(scalarForFootprintHeight(level.visibleHeightMeters).toFixed(6)));
  ladderCache.orientationStart=Number(scalarForFootprintHeight(5000).toFixed(4));
  return ladderCache;
}
function presentationTargetHeightMeters(value=zoomState.scalar){
  const scalar=clamp(value,0,1);
  if(scalar<=LADDER_START_SCALAR)return globeSurfaceFootprintHeightMeters(scalar);
  const L=ladderState(),t=scalar-LADDER_START_SCALAR;
  // integral of rate(t): ramp is a smoothstep blend from startRate to cruiseRate.
  let drop;
  if(t<=L.ramp){const u=t/L.ramp,smoothIntegral=u*u*u-u*u*u*u/2;drop=L.startRate*t+(L.cruiseRate-L.startRate)*L.ramp*smoothIntegral;}
  else drop=L.startRate*L.ramp+(L.cruiseRate-L.startRate)*L.ramp*.5+L.cruiseRate*(t-L.ramp);
  return Math.max(GROUND_FOOTPRINT_HEIGHT_METERS,L.startHeight*Math.exp(-drop));
}
function scalarForFootprintHeight(heightMeters){
  const h=Math.max(GROUND_FOOTPRINT_HEIGHT_METERS,Number(heightMeters)||0);
  let lo=0,hi=1;
  for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(presentationTargetHeightMeters(mid)>h)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}
function levelMaxScalar(index){return ladderState().levelMax[index]??1;}
let localDetail={active:false,level:"inactive",sampleSpacingMeters:LOCAL_SAMPLE_SPACING_METERS,geometrySampleSpacingMeters:LOCAL_SAMPLE_SPACING_METERS,textureSize:0,sourceTextureWidth:0,sourceTextureHeight:0,detailMetersPerTexel:0,surroundMetersPerTexel:0,anisotropy:1,minFilter:"linear-mipmap-linear",magFilter:"linear",detailBandCount:0,surroundDetailBandCount:0,visibleWidthMeters:0,visibleHeightMeters:0,patchWidthMeters:0,patchHeightMeters:0,columns:0,rows:0,vertices:0,triangles:0,estimatedBytes:0,buildTimeMs:0,rebuildCount:0,activePatchCount:0,signature:null};
let requestedLodIndex=0;
let displayResource=null;
let localJob=null;
let localQueuedRequest=null;
let lastZoomDirection=1;
let localFrameStats={lastFrameMs:0,recent:[],maxDuringPreparationMs:0};
const localSharedPrimitives={};
const localResourceCache=new Map();
const localResidency=new Map();
const localRecentEvictions=new Map();
const localMotionPrefetchTargets=new Map();
let localLastRequestRegistered=null;
let localMotionVector={east:0,north:0,magnitude:0};
function freshLocalResources(){
  return {activeSignature:null,requestedSignature:null,preparedSignature:null,preparingSignature:null,requestedLevel:null,visibleLevel:null,requestedCellId:null,activeCellId:null,preparingLevel:null,preparing:false,preparingPrewarm:false,preparationProgress:0,standInActive:false,standInMagnification:1,standInSemanticScale:1,standInOffsetClamped:false,standInPinnedToViewport:false,standInRawOffsetMeters:{east:0,north:0},standInAppliedOffsetMeters:{east:0,north:0},
    cacheHits:0,cacheMisses:0,prewarmHits:0,prewarmCompleted:0,cancelledPreparations:0,deferredRequests:0,evictions:0,destroyedMeshes:0,destroyedTextures:0,activeResourceCount:0,cachedResourceCount:0,estimatedCacheBytes:0,culledOuterRepresentations:0,pendingPreparationCount:0,
    lastBuildMs:0,lastPreparationWallMs:0,lastPreparationBusyMs:0,lastPreparationSlices:0,maxPreparationSliceMs:0,lastSwapMs:0,maxSwapMs:0,swapCount:0,lastPreparationQueuedAtMs:0,lastPreparationCompletedAtMs:0,lastEvictionReason:null,
    blockingZoomBuilds:0,maxFrameMsDuringPreparation:0,recentMaxFrameMs:0,lastFrameMs:0,sliceBudgetMs:LOCAL_PREP_SLICE_BUDGET_MS,cooperativePreparation:true,doubleBufferedSwap:true,
    residencyRevision:"temporal-residency-v1",requestedCellCount:0,preparingCellCount:0,readyCellCount:0,activeCellCount:0,graceResidentCellCount:0,evictedCellCount:0,
    parentFallbackCount:0,rootFallbackCount:0,missingCoverageCount:0,graceReuseCount:0,prefetchRequests:0,prefetchCompleted:0,prefetchHits:0,prefetchMisses:0,
    longestHandoffLatencyMs:0,lastHandoffLatencyMs:0,lastHandoffRequestedAtMs:0,lastHandoffCompletedAtMs:0,
    revisitRegenerationSignature:null,revisitRegenerationPass:true,revisitCount:0,
    requestBudgetPerFrame:1,buildJobBudget:1,prefetchQueueLimit:1,graceResidencyMs:LOCAL_GRACE_RESIDENCY_MS,
    surroundSpanFactor:LOCAL_SURROUND_SPAN_FACTOR,surroundWidthMeters:0,surroundHeightMeters:0,surroundWorldMatched:false};
}
let localResources=freshLocalResources();
let localPreparationToken=0;
let mapPresentation={active:false,context:null,visibleContextKinds:[],visiblePlaceKinds:[],labelCount:0,atlasVisibleLabelCount:0,atlasCandidateCount:0,atlasQueryCellCount:0,hiddenHemisphereCulledCount:0,behindCameraCulledCount:0,offscreenCulledCount:0,occludedCulledCount:0,overlapRejectedCount:0,visibleLabelClasses:[],visibleLabels:[],maxLabelBudget:0,maxLabelDisplacementPixels:0,labelQueryBuildMs:0,cityCandidateCount:0,cityVisibleCount:0,cityMinSeparationMeters:null,citySpacingPass:true,cityQueryCellCount:0,landmarkCandidateCount:0,landmarkVisibleCount:0,landmarkKinds:[],visibleLandmarks:[],maxLandmarkCount:0,borderVisible:false,borderSampleCount:0,borderLandSampleCount:0,borderWaterSampleCount:0,borderOwnerQueryCount:0,borderSegmentCount:0,borderWorldVertexCount:0,projectedBorderSegmentCount:0,politicalOwnerCount:0,borderTopologySignature:null,borderGraphRevision:null,borderGraphNodeCount:0,borderGraphEdgeCount:0,borderGraphOwnerPairs:[],borderEndpointClassifications:null,borderFocusOwnerId:null,waterClippedBorderCount:0,borderDiagnostics:[],registrationMaxRoundTripErrorTiles:0,projectionMode:"globe",scaleDistanceMeters:0,scaleLabel:"",scaleStateIndex:0,scaleStateLabel:SCALE_LADDER[0],scalePixelLength:0,metersPerScreenPixel:0,rulerTruthErrorMeters:0,internalZoomScalar:0,updateCount:0,lastUpdateMs:0,lastBorderBuildMs:0,bounded:true,fullWorldScan:false};
let atlasLabelCache={key:null,candidates:[],queryCellCount:0,buildMs:0};
let atlasStickyBand=null;
const atlasStickyEntities=new Map();
const atlasLabelPlacementCache=new Map();
const atlasEntityCache=new Map();
const atlasIdentityCache=new Map();
const atlasAuthorityIndex=new Map();
const atlasAuthorityQueue=[];
const atlasAuthorityQueued=new Set();
let atlasAuthorityWorkerScheduled=false;
let atlasAuthorityRefreshScheduled=false;
function atlasAuthorityKey(kind,tile){
  if(!tile)return null;
  const size=kind==="country"?Number(window.PoliticalGeography?.COUNTRY_CELL_SIZE||196608):8192;
  const cell=atlasCellForTile(tile,size);
  return activeSeed+"|"+kind+"|"+cell.x+"|"+cell.y;
}
function atlasQueueAuthority(kind,tile){
  if(kind!=="country"&&kind!=="region"||!tile)return;
  const key=atlasAuthorityKey(kind,tile);if(!key||atlasAuthorityIndex.has(key)||atlasAuthorityQueued.has(key))return;
  atlasAuthorityQueued.add(key);atlasAuthorityQueue.push({key,kind,tile:{x:String(tile.x),y:String(tile.y)}});
  if(!atlasAuthorityWorkerScheduled){
    atlasAuthorityWorkerScheduled=true;
    const schedule=window.requestIdleCallback||((cb)=>setTimeout(()=>cb({timeRemaining:()=>4,didTimeout:false}),0));
    schedule(atlasDrainAuthorityQueue,{timeout:120});
  }
}
function atlasScheduleAuthorityRefresh(){
  atlasLabelCache={key:null,candidates:[],queryCellCount:0,buildMs:0};
  mapContextCache={key:null,value:null};
  if(atlasAuthorityRefreshScheduled)return;
  atlasAuthorityRefreshScheduled=true;
  requestAnimationFrame(()=>{
    atlasAuthorityRefreshScheduled=false;
    if(ready&&root&&canvas&&activeSeed)updateMapPresentation();
  });
}
function atlasDrainAuthorityQueue(deadline){
  atlasAuthorityWorkerScheduled=false;
  const started=performance.now();
  let changed=false;
  while(atlasAuthorityQueue.length&&((deadline?.timeRemaining?.()||0)>1||performance.now()-started<3)){
    const job=atlasAuthorityQueue.shift();atlasAuthorityQueued.delete(job.key);
    let value=null;
    try{
      if(job.kind==="country"){
        const c=window.PoliticalGeography?.countryAt?.(activeSeed,job.tile.x,job.tile.y)||null;
        if(c){
          const anchor={x:String(c.mapAnchor?.x??c.politicalCenter?.x??job.tile.x),y:String(c.mapAnchor?.y??c.politicalCenter?.y??job.tile.y)};
          const surface=atlasPlanetSurfaceForTile(anchor.x,anchor.y);
          let owner=null;try{owner=window.PoliticalGeography?.ownerAt?.(activeSeed,anchor.x,anchor.y)||null;}catch(_){owner=null;}
          if(surface.sample?.land&&owner?.id===c.id)value=atlasEntityBase(c.id,"country",c.name,anchor,"PoliticalGeography.countryAt:canonical-owned-land",{countryId:c.id,capital:c.capital||null});
        }
      }else{
        const r=window.RegionProfile?.at?.(activeSeed,job.tile.x,job.tile.y)||null;
        if(r){
          const requested={x:String(r.administrativeSeat?.x??job.tile.x),y:String(r.administrativeSeat?.y??job.tile.y)};
          const regionSize=Number(window.RegionProfile?.REGION_CELL_SIZE||8192);
          const anchor=atlasStableLandAnchor(requested,Math.max(128,Math.floor(regionSize*.28)),(x,y)=>{
            const rr=window.RegionProfile?.at?.(activeSeed,x,y)||null;
            return rr?.id===r.id;
          });
          if(anchor)value=atlasEntityBase(r.id,"region",r.name,anchor,"RegionProfile.at:canonical-owned-land",{countryId:r.parentCountryId});
        }
      }
    }catch(_){}
    atlasAuthorityIndex.set(job.key,value);changed=true;
  }
  if(changed)atlasScheduleAuthorityRefresh();
  if(atlasAuthorityQueue.length&&!atlasAuthorityWorkerScheduled){
    atlasAuthorityWorkerScheduled=true;
    const schedule=window.requestIdleCallback||((cb)=>setTimeout(()=>cb({timeRemaining:()=>4,didTimeout:false}),0));
    schedule(atlasDrainAuthorityQueue,{timeout:120});
  }
}
let mapContextCache={key:null,value:null};
let mapBorderCache={key:null,segments:[],sampleCount:0,landSampleCount:0,waterSampleCount:0,ownerQueryCount:0,ownerCount:0,worldVertexCount:0,topologySignature:null,waterClippedCount:0,diagnostics:[],graphRevision:null,graphNodeCount:0,graphEdgeCount:0,graphOwnerPairs:[],endpointClassifications:null,focusOwnerId:null,builtAtMs:0};
const mapBorderEndpointSnapCache=new Map();
let projectionPresentation={viewBlend:0,angleBlend:0,presentationCompensation:1,patchScale:0,cameraY:0,cameraZ:0,fov:34,targetHeightMeters:650000};
let worldProjectionAnchorCache=null;
let settlementRevealCache={key:null,value:null};
let localStaticRefreshScheduled=false;
let politicalScaleEvidenceCache=null;
let coordinateFabric=null;
function coordinateFabricAuthority(){
  if(!activeSeed||!window.SeedCoordinateFabric)return null;
  if(!coordinateFabric||coordinateFabric.seed!==activeSeed){
    coordinateFabric=window.SeedCoordinateFabric.create(activeSeed,{radiusMeters:WORLD_RADIUS_METERS,tileMeters:Number(window.WorldStandards?.TILE_METERS||2)});
  }
  return coordinateFabric;
}

function wrapLongitudeRadians(value){
  let lon=Number(value)||0;lon=((lon+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;return lon;
}
function planetWorldAnchor(){
  if(worldProjectionAnchorCache)return worldProjectionAnchorCache;
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||window.PlanetGeography?.DEFAULT_TILE_METERS||2));
  const geo=geography?.worldLatLonForTile?.("0","0",tileMeters,WORLD_RADIUS_METERS)||
    window.PlanetGeography?.worldLatLonForTile?.(activeSeed,"0","0",tileMeters,WORLD_RADIUS_METERS)||null;
  let sample=null;try{sample=geo?geography?.sampleLatLon?.(geo.latitudeRadians,geo.longitudeRadians):null;}catch(_){sample=null;}
  worldProjectionAnchorCache=Object.freeze({
    latitudeRadians:Number(geo?.latitudeRadians||0),longitudeRadians:Number(geo?.longitudeRadians||0),
    latitudeDegrees:Number(geo?.latitudeDegrees||0),longitudeDegrees:Number(geo?.longitudeDegrees||0),
    land:Boolean(sample?.land),surfaceClass:String(sample?.surfaceClass||"unknown"),
    elevationMeters:Number(sample?.elevationMeters||0),
    continentId:sample?.continentId||null,continentName:sample?.continentName||null,
    authority:"PlanetGeography seed-fixed spherical registration",
    worldTileOrigin:Object.freeze({x:"0",y:"0"})
  });
  return worldProjectionAnchorCache;
}
function mapWorldTileAt(latitudeRadians,longitudeRadians){
  const fabric=coordinateFabricAuthority();
  if(fabric)return fabric.worldTileForLatLon(latitudeRadians,longitudeRadians);
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||window.PlanetGeography?.DEFAULT_TILE_METERS||2));
  const tile=geography?.worldTileForLatLon?.(latitudeRadians,longitudeRadians,tileMeters,WORLD_RADIUS_METERS)||
    window.PlanetGeography?.worldTileForLatLon?.(activeSeed,latitudeRadians,longitudeRadians,tileMeters,WORLD_RADIUS_METERS);
  return Object.freeze({x:String(tile?.x??"0"),y:String(tile?.y??"0")});
}
function worldLatLonForTile(xValue,yValue){
  const fabric=coordinateFabricAuthority(),geo=fabric?.worldLatLonForTile?.(xValue,yValue);
  if(geo)return geo;
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||window.PlanetGeography?.DEFAULT_TILE_METERS||2));
  const legacy=geography?.worldLatLonForTile?.(xValue,yValue,tileMeters,WORLD_RADIUS_METERS)||
    window.PlanetGeography?.worldLatLonForTile?.(activeSeed,xValue,yValue,tileMeters,WORLD_RADIUS_METERS);
  if(legacy)return Object.freeze({
    latitudeRadians:Number(legacy.latitudeRadians)||0,longitudeRadians:Number(legacy.longitudeRadians)||0,
    latitudeDegrees:Number(legacy.latitudeDegrees)||0,longitudeDegrees:Number(legacy.longitudeDegrees)||0,
    worldTile:Object.freeze({x:String(legacy.worldTile?.x??xValue??"0"),y:String(legacy.worldTile?.y??yValue??"0")})
  });
  return Object.freeze({latitudeRadians:0,longitudeRadians:0,latitudeDegrees:0,longitudeDegrees:0,worldTile:Object.freeze({x:String(xValue??"0"),y:String(yValue??"0")})});
}
function canonicalRegisteredMetersForLatLon(latitudeRadians,longitudeRadians){
  const fabric=coordinateFabricAuthority(),registered=fabric?.registeredMetersForLatLon?.(latitudeRadians,longitudeRadians);
  if(registered)return registered;
  const tile=mapWorldTileAt(latitudeRadians,longitudeRadians);
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||window.PlanetGeography?.DEFAULT_TILE_METERS||2));
  return Object.freeze({
    eastMeters:Number(BigInt(tile.x))*tileMeters,
    northMeters:Number(BigInt(tile.y))*tileMeters,
    authority:"canonical-world-tile-fallback"
  });
}
function canonicalRegisteredDeltaMeters(originLatitudeRadians,originLongitudeRadians,targetLatitudeRadians,targetLongitudeRadians){
  const fabric=coordinateFabricAuthority(),delta=fabric?.registeredDeltaMeters?.(originLatitudeRadians,originLongitudeRadians,targetLatitudeRadians,targetLongitudeRadians);
  if(delta)return delta;
  const origin=canonicalRegisteredMetersForLatLon(originLatitudeRadians,originLongitudeRadians),target=canonicalRegisteredMetersForLatLon(targetLatitudeRadians,targetLongitudeRadians);
  const period=Math.PI*2*WORLD_RADIUS_METERS,half=period*.5;let east=Number(target.eastMeters||0)-Number(origin.eastMeters||0);
  if(east>half)east-=period;else if(east<-half)east+=period;
  return Object.freeze({eastMeters:east,northMeters:Number(target.northMeters||0)-Number(origin.northMeters||0),authority:"canonical-registered-meter-fallback"});
}
function canonicalLatLonForLocalOffset(originLatitudeRadians,originLongitudeRadians,eastMeters,northMeters){
  const fabric=coordinateFabricAuthority(),origin=canonicalRegisteredMetersForLatLon(originLatitudeRadians,originLongitudeRadians);
  const inverse=fabric?.latLonForRegisteredMeters?.(Number(origin.eastMeters||0)+Number(eastMeters||0),Number(origin.northMeters||0)+Number(northMeters||0));
  if(inverse)return inverse;
  const lat=clamp(Number(originLatitudeRadians||0)+Number(northMeters||0)/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999),cosLat=Math.max(.08,Math.cos(originLatitudeRadians));
  const lon=wrapLongitudeRadians(Number(originLongitudeRadians||0)+Number(eastMeters||0)/(WORLD_RADIUS_METERS*cosLat));
  return Object.freeze({latitudeRadians:lat,longitudeRadians:lon,authority:"legacy-local-offset-fallback"});
}
function setWorldTileFocus(xValue,yValue){
  return setViewTarget(worldLatLonForTile(xValue,yValue));
}
function mapGeneratedName(kind,latitudeRadians,longitudeRadians){
  const stems=["Alder","Amber","Ashen","Bright","Cedar","Dawn","Elder","Falcon","Golden","Green","Grey","High","Iron","Lake","North","Oak","Raven","Red","River","Silver","Stone","Sun","Thorn","West","White","Wolf"];
  const tails={continent:["Reach","Land","March"],ocean:["Ocean","Sea","Deep"],country:["Realm","Kingdom","March"],region:["Vale","Reach","Province"],city:["Hold","Gate","Court"],district:["Ward","Shire","Zone"],village:["Ford","Stead","Wick"]};
  const lat=Math.round((Number(latitudeRadians)||0)*180/Math.PI*8),lon=Math.round((Number(longitudeRadians)||0)*180/Math.PI*8);
  let h=2166136261>>>0;for(const ch of String(activeSeed)+"|map:"+kind+"|"+lat+"|"+lon){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return stems[h%stems.length]+" "+(tails[kind]||["Reach"])[(h>>>8)%(tails[kind]||["Reach"]).length];
}
function politicalScaleEvidence(){
  if(politicalScaleEvidenceCache)return politicalScaleEvidenceCache;
  const countryCellSize=Number(window.PoliticalGeography?.COUNTRY_CELL_SIZE||0);
  const regionCellSize=Number(window.RegionProfile?.REGION_CELL_SIZE||8192);
  const ratio=countryCellSize>0&&regionCellSize>0?countryCellSize/regionCellSize:0;
  const owners=new Set();let sampleCount=0;
  if(window.PoliticalGeography?.ownerAt&&activeSeed){
    for(let y=-131072;y<=131072;y+=65536){
      for(let x=-196608;x<=196608;x+=65536){
        try{const owner=window.PoliticalGeography.ownerAt(activeSeed,String(x),String(y));if(owner?.id)owners.add(owner.id);}catch(_){}
        sampleCount++;
      }
    }
  }
  politicalScaleEvidenceCache=Object.freeze({
    countryCellSize,regionCellSize,
    countryRegionLinearRatio:Number(ratio.toFixed(3)),
    nominalRegionCellsPerCountry:Number((ratio*ratio).toFixed(1)),
    boundedSampleCount:sampleCount,
    boundedDistinctCountryOwners:owners.size,
    sampleSpanTiles:Object.freeze({width:393216,height:262144}),
    fullWorldScan:false
  });
  return politicalScaleEvidenceCache;
}
function mapContextForFocus(){
  if(!activeSeed)return null;
  const lat=zoomState.focusLatitudeRadians,lon=zoomState.focusLongitudeRadians,policy=currentSemanticLayerPolicy(false),kinds=policy.contextKinds;
  const key=[activeSeed,policy.id,lat.toFixed(4),lon.toFixed(4)].join("|");
  if(mapContextCache.key===key&&mapContextCache.value)return mapContextCache.value;
  const tile=mapWorldTileAt(lat,lon),needed=new Set(kinds),name=(kind,fallback)=>{
    try{
      if(kind==="continent"){
        const surface=atlasPlanetSurfaceForTile(tile.x,tile.y);
        return surface.sample?.land?(surface.sample?.continentName||fallback):null;
      }
      if(kind==="country"){
        const key=atlasAuthorityKey("country",tile);
        if(!atlasAuthorityIndex.has(key))atlasQueueAuthority("country",tile);
        return atlasAuthorityIndex.get(key)?.name||null;
      }
      if(kind==="region"){
        const key=atlasAuthorityKey("region",tile);
        if(!atlasAuthorityIndex.has(key))atlasQueueAuthority("region",tile);
        return atlasAuthorityIndex.get(key)?.name||null;
      }
      return window.GeographyFoundation?.hierarchyName?.(activeSeed,kind,tile.x,tile.y)||fallback;
    }catch(_){return fallback;}
  };
  const displayName=(kind,fallback)=>{const resolved=name(kind,fallback);return resolved==null?null:String(resolved);};
  const context=Object.freeze({
    continent:needed.has("continent")?displayName("continent",mapGeneratedName("continent",lat,lon)):null,
    country:needed.has("country")?displayName("country",null):null,
    region:needed.has("region")?displayName("region",null):null,
    city:needed.has("city")?displayName("city",mapGeneratedName("city",lat,lon)):null,
    district:needed.has("district")?displayName("district",mapGeneratedName("district",lat,lon)):null,
    village:needed.has("village")?displayName("village",mapGeneratedName("village",lat,lon)):null,
    tileX:tile.x,tileY:tile.y
  });
  mapContextCache={key,value:context};return context;
}
const SEMANTIC_LAYER_SPECS=Object.freeze([
  Object.freeze({id:"semantic-1-10",scaleLabel:"1/10",displayBand:"planet",contextKinds:["continent"],placeKinds:["continent","major-island"],kinds:["continent","ocean"],focusKind:"continent",budget:7,portraitBudget:4,classBudgets:{continent:3,ocean:3},landmarkKinds:["peak","mountain"],borderClasses:[],routeClasses:[],settlementLayers:[],settlementRevealTier:"none",queryMode:"globe",latSpan:68,lonSpan:118}),
  Object.freeze({id:"semantic-1-20",scaleLabel:"1/20",displayBand:"continent",contextKinds:["continent","country"],placeKinds:["continent","country","major-island"],kinds:["continent","ocean","country"],focusKind:"continent",budget:9,portraitBudget:5,classBudgets:{continent:2,ocean:2,country:5},landmarkKinds:["peak","mountain","island"],borderClasses:[],routeClasses:[],settlementLayers:[],settlementRevealTier:"none",queryMode:"globe",latSpan:48,lonSpan:78}),
  Object.freeze({id:"semantic-1-50",scaleLabel:"1/50",displayBand:"country / region",contextKinds:["continent","country"],placeKinds:["country","capital","region","major-landmark"],kinds:["country","region","capital","landmark"],focusKind:"country",budget:10,portraitBudget:6,classBudgets:{country:4,region:3,capital:2,landmark:2},landmarkKinds:["peak","mountain","island"],borderClasses:["national"],routeClasses:[],settlementLayers:[],settlementRevealTier:"none",queryMode:"globe",latSpan:28,lonSpan:44}),
  Object.freeze({id:"semantic-1-100",scaleLabel:"1/100",displayBand:"regional overview",contextKinds:["country","region"],placeKinds:["country","region","capital","major-city","landmark"],kinds:["country","region","capital","city","landmark"],focusKind:"region",budget:11,portraitBudget:7,classBudgets:{country:3,region:4,capital:2,city:3,landmark:2},landmarkKinds:["peak","mountain","island","ruin","water"],borderClasses:["national"],routeClasses:["primary"],settlementLayers:[],settlementRevealTier:"none",queryMode:"local"}),
  Object.freeze({id:"semantic-1-250",scaleLabel:"1/250",displayBand:"regional detail",contextKinds:["country","region","city"],placeKinds:["region","capital","major-city","city","landmark"],kinds:["region","capital","city","landmark"],focusKind:"region",budget:11,portraitBudget:7,classBudgets:{region:4,capital:2,city:4,landmark:2},landmarkKinds:["peak","mountain","ruin","water"],borderClasses:["national","regional"],routeClasses:["primary"],settlementLayers:[],settlementRevealTier:"none",queryMode:"local"}),
  Object.freeze({id:"semantic-1-500",scaleLabel:"1/500",displayBand:"local network",contextKinds:["region","city"],placeKinds:["region","city","town","village","landmark"],kinds:["region","city","town","village","landmark"],focusKind:"city",budget:10,portraitBudget:7,classBudgets:{region:2,city:3,town:3,village:4,landmark:2},landmarkKinds:["city","town","village","ruin","water"],borderClasses:["national","regional"],routeClasses:["primary","secondary"],settlementLayers:[],settlementRevealTier:"none",queryMode:"local"}),
  Object.freeze({id:"semantic-1-1000",scaleLabel:"1/1000",displayBand:"settlement area",contextKinds:["city","village","district"],placeKinds:["city","town","village","district","landmark"],kinds:["city","town","village","district","landmark"],focusKind:"village",budget:9,portraitBudget:6,classBudgets:{city:2,town:3,village:4,district:3,landmark:2},landmarkKinds:["city","town","village","ruin"],borderClasses:["regional"],routeClasses:["primary","secondary"],settlementLayers:["settlement-footprint"],settlementRevealTier:"footprint",queryMode:"local"}),
  Object.freeze({id:"semantic-1-2500",scaleLabel:"1/2500",displayBand:"settlement approach",contextKinds:["village","district"],placeKinds:["town","village","district","landmark"],kinds:["town","village","district","landmark"],focusKind:"village",budget:8,portraitBudget:6,classBudgets:{town:2,village:3,district:3,landmark:2},landmarkKinds:["town","village","ruin"],borderClasses:[],routeClasses:["primary","secondary","local"],settlementLayers:["settlement-footprint","roads"],settlementRevealTier:"route",queryMode:"local"}),
  Object.freeze({id:"semantic-1-5000",scaleLabel:"1/5000",displayBand:"near ground",contextKinds:["village","district"],placeKinds:["village","district","landmark"],kinds:["village","district","landmark"],focusKind:"village",budget:7,portraitBudget:5,classBudgets:{village:2,district:3,landmark:2},landmarkKinds:["village","ruin"],borderClasses:[],routeClasses:["primary","secondary","local"],settlementLayers:["settlement-footprint","roads","buildings"],settlementRevealTier:"refined",queryMode:"local"}),
  Object.freeze({id:"semantic-1-10000",scaleLabel:"1/10000",displayBand:"ground",contextKinds:["village","district"],placeKinds:["village","district","landmark"],kinds:["village","district","landmark"],focusKind:"village",budget:5,portraitBudget:4,classBudgets:{village:1,district:2,landmark:1},landmarkKinds:["village","ruin"],borderClasses:[],routeClasses:["local"],settlementLayers:["settlement-footprint","roads","buildings"],settlementRevealTier:"full",queryMode:"local"})
]);
function semanticLayerSpec(index,portrait=false){
  const i=Math.max(0,Math.min(SEMANTIC_LAYER_SPECS.length-1,Math.round(Number(index)||0))),base=SEMANTIC_LAYER_SPECS[i];
  return Object.freeze({...base,index:i,budget:portrait?base.portraitBudget:base.budget,
    unsupportedEntityClasses:Object.freeze(base.placeKinds.filter(kind=>kind==="town"&&!window.SettlementArchetypes?.settlementsForCountry)),
    classBudgets:Object.freeze({...base.classBudgets})});
}
function semanticScaleIndexForScalar(value=zoomState.scalar){
  const raw=scaleIndexForScalar(value),height=Math.max(GROUND_FOOTPRINT_HEIGHT_METERS,presentationTargetHeightMeters(value));
  if(!semanticScaleState.initialized){
    semanticScaleState={index:raw,initialized:true,changes:0,holds:0,lastRawIndex:raw};return raw;
  }
  let index=semanticScaleState.index;
  while(raw>index&&index<SEMANTIC_LAYER_SPECS.length-1){
    const threshold=Math.sqrt(scaleTargetFootprintHeightMeters(index)*scaleTargetFootprintHeightMeters(index+1));
    if(height>threshold/SEMANTIC_SCALE_HYSTERESIS_RATIO)break;
    index++;
  }
  while(raw<index&&index>0){
    const threshold=Math.sqrt(scaleTargetFootprintHeightMeters(index-1)*scaleTargetFootprintHeightMeters(index));
    if(height<threshold*SEMANTIC_SCALE_HYSTERESIS_RATIO)break;
    index--;
  }
  const changed=index!==semanticScaleState.index;
  semanticScaleState={index,initialized:true,changes:semanticScaleState.changes+(changed?1:0),holds:semanticScaleState.holds+(!changed&&raw!==index?1:0),lastRawIndex:raw};
  return index;
}
function currentSemanticLayerPolicy(portrait=false){return semanticLayerSpec(semanticScaleIndexForScalar(zoomState.scalar),portrait);}
function mapContextKindsForBand(_band){return currentSemanticLayerPolicy(false).contextKinds.slice();}
function mapPlaceKindsForBand(_band){return currentSemanticLayerPolicy(false).placeKinds.slice();}
function scaleTargetFootprintHeightMeters(index){
  const i=Math.max(0,Math.min(SCALE_LADDER.length-1,Math.round(Number(index)||0)));
  const first=Math.max(1,SCALE_DENOMINATORS[0]),last=Math.max(first+1,SCALE_DENOMINATORS[SCALE_DENOMINATORS.length-1]);
  const denominator=Math.max(first,SCALE_DENOMINATORS[i]||first);
  const progress=clamp(Math.log(denominator/first)/Math.log(last/first),0,1);
  // Reserve enough physical footprint for the penultimate scales to remain
  // distinct near-ground refinement tiers. A linear log-denominator curve
  // collapsed 1/5000 into the same 36 m ground LOD as 1/10000.
  const physicalProgress=Math.pow(progress,SCALE_FOOTPRINT_PROGRESS_EXPONENT);
  const startHeight=Math.max(GROUND_FOOTPRINT_HEIGHT_METERS,presentationTargetHeightMeters(0));
  return startHeight*Math.exp(Math.log(GROUND_FOOTPRINT_HEIGHT_METERS/startHeight)*physicalProgress);
}
function scaleIndexForScalar(value=zoomState.scalar){
  const height=Math.max(GROUND_FOOTPRINT_HEIGHT_METERS,presentationTargetHeightMeters(clamp(value,0,1)));
  let best=0,bestDistance=Infinity;
  for(let i=0;i<SCALE_LADDER.length;i++){
    const target=Math.max(GROUND_FOOTPRINT_HEIGHT_METERS,scaleTargetFootprintHeightMeters(i));
    const distance=Math.abs(Math.log(height/target));
    if(distance<bestDistance){best=i;bestDistance=distance;}
  }
  return best;
}
function scalarForScaleIndex(index){
  const i=Math.max(0,Math.min(SCALE_LADDER.length-1,Math.round(Number(index)||0)));
  if(i===0)return 0;if(i===SCALE_LADDER.length-1)return 1;
  return scalarForFootprintHeight(scaleTargetFootprintHeightMeters(i));
}
function scaleStateForScalar(value=zoomState.scalar){
  const index=scaleIndexForScalar(value),scalar=scalarForScaleIndex(index);
  return Object.freeze({index,label:SCALE_LADDER[index],scalar:Number(scalar.toFixed(6)),targetFootprintHeightMeters:Number(presentationTargetHeightMeters(scalar).toFixed(3))});
}
function setScaleIndex(index){return setZoomScalar(scalarForScaleIndex(index));}
function stepScale(direction){const d=Math.sign(Number(direction)||0);return d===0?snapshot():setScaleIndex(scaleIndexForScalar()+d);}
function navigationSensitivity(){
  const rect=canvas?.getBoundingClientRect?.(),widthPx=Math.max(1,Number(rect?.width||1)),heightPx=Math.max(1,Number(rect?.height||1));
  const metersPerPixelX=Math.max(.000001,Number(zoomState.visibleFootprintWidthMeters||1))/widthPx;
  const metersPerPixelY=Math.max(.000001,Number(zoomState.visibleFootprintHeightMeters||1))/heightPx;
  const cosLat=Math.max(.08,Math.cos(zoomState.focusLatitudeRadians));
  const yawDegreesPerPixel=metersPerPixelX/(WORLD_RADIUS_METERS*cosLat)*180/Math.PI;
  const pitchDegreesPerPixel=metersPerPixelY/WORLD_RADIUS_METERS*180/Math.PI;
  return Object.freeze({viewportWidthPixels:widthPx,viewportHeightPixels:heightPx,metersPerPixelX:Number(metersPerPixelX.toFixed(6)),metersPerPixelY:Number(metersPerPixelY.toFixed(6)),yawDegreesPerPixel:Number(yawDegreesPerPixel.toFixed(9)),pitchDegreesPerPixel:Number(pitchDegreesPerPixel.toFixed(9)),samplePixels:100,sampleHorizontalMeters:Number((metersPerPixelX*100).toFixed(3)),sampleVerticalMeters:Number((metersPerPixelY*100).toFixed(3))});
}
function rotateByScreenPixels(dx,dy){
  const sensitivity=navigationSensitivity();
  // Screen-space navigation is defined in physical surface distance, not raw
  // Euler degrees. Convert the requested pointer displacement to a great-circle
  // destination so equal pixel drags track the current visible footprint at
  // every scale, then solve the exact sphere rotation for that canonical focus.
  const eastMeters=-Number(dx||0)*sensitivity.metersPerPixelX;
  const northMeters=Number(dy||0)*sensitivity.metersPerPixelY;
  const distanceMeters=Math.hypot(eastMeters,northMeters);
  if(distanceMeters<1e-9)return snapshot();
  const angular=distanceMeters/WORLD_RADIUS_METERS,bearing=Math.atan2(eastMeters,northMeters);
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians;
  const sinLat0=Math.sin(lat0),cosLat0=Math.cos(lat0),sinAngular=Math.sin(angular),cosAngular=Math.cos(angular);
  const lat=Math.asin(clamp(sinLat0*cosAngular+cosLat0*sinAngular*Math.cos(bearing),-1,1));
  const lon=wrapLongitudeRadians(lon0+Math.atan2(Math.sin(bearing)*sinAngular*cosLat0,cosAngular-sinLat0*Math.sin(lat)));
  return setViewTarget({latitudeRadians:lat,longitudeRadians:lon});
}
function rotateByScreenFraction(xFraction,yFraction){const sensitivity=navigationSensitivity();return rotateByScreenPixels(Number(xFraction||0)*sensitivity.viewportWidthPixels,Number(yFraction||0)*sensitivity.viewportHeightPixels);}
function niceScaleDistanceMeters(widthMeters){
  const target=Math.max(1,Number(widthMeters)||1)*.22;
  const power=Math.pow(10,Math.floor(Math.log10(target)));
  const normalized=target/power;
  const nice=normalized>=5?5:normalized>=2?2:1;
  return nice*power;
}
function scaleRulerForViewport(widthMeters,pixelWidth){
  const width=Math.max(.000001,Number(widthMeters)||1),pixels=Math.max(1,Number(pixelWidth)||1);
  const distanceMeters=niceScaleDistanceMeters(width),metersPerScreenPixel=width/pixels,pixelLength=distanceMeters/metersPerScreenPixel;
  return Object.freeze({distanceMeters,pixelLength:Number(pixelLength.toFixed(4)),metersPerScreenPixel:Number(metersPerScreenPixel.toFixed(6)),truthErrorMeters:Number(Math.abs(distanceMeters-pixelLength*metersPerScreenPixel).toFixed(6))});
}
function formatDistanceMeters(meters){
  const m=Math.max(1,Number(meters)||1);
  if(m>=1000){const km=m/1000;return (km>=100?Math.round(km):km>=10?km.toFixed(0):km.toFixed(1))+" km";}
  return Math.round(m)+" m";
}
function ensureMapPresentationDom(){
  if(!root)return null;
  let layer=root.querySelector(".planet-map-layer");
  if(layer)return layer;
  layer=document.createElement("div");layer.className="planet-map-layer";layer.setAttribute("aria-live","polite");
  const borders=document.createElementNS("http://www.w3.org/2000/svg","svg");borders.setAttribute("class","planet-map-borders");borders.setAttribute("viewBox","0 0 1000 1000");borders.setAttribute("preserveAspectRatio","none");borders.setAttribute("aria-hidden","true");
  const labels=document.createElement("div");labels.className="planet-map-labels";labels.setAttribute("aria-hidden","true");
  const center=document.createElement("div");center.className="planet-world-center";center.setAttribute("aria-label","Canonical gameplay-area center");center.innerHTML='<i aria-hidden="true"></i><code></code>';
  const info=document.createElement("section");info.className="planet-map-context";info.setAttribute("aria-label","Geographic context");
  const scale=document.createElement("div");scale.className="planet-scale-ruler";scale.innerHTML='<div class="planet-scale-meta"><strong></strong><span></span></div><div class="planet-scale-line"><i></i></div><small></small>';
  layer.append(borders,labels,center,info,scale);root.appendChild(layer);return layer;
}
function geographicScenePoint(latitudeRadians,longitudeRadians,surfaceOffsetMeters=0){
  if(!pc||!cameraEntity?.camera||!window.PlanetGeography?.directionFromLatLon)return null;
  const lat=clamp(latitudeRadians,-Math.PI*.499999,Math.PI*.499999),lon=wrapLongitudeRadians(longitudeRadians);
  // Project overlays against the representation that is actually visible.
  // Raw projectionState.blend begins before the tangent surface is presented;
  // using it clipped borders/labels to the hidden tangent patch at 0.12x while
  // the player was still seeing the globe. Switch only when tangent is the
  // dominant rendered representation.
  const tangentActive=Boolean(tangentPatch?.enabled&&displayResource&&Number(projectionPresentation?.representationBlend||0)>=.5);
  if(tangentActive){
    const frame=localDisplayFrame(),dims=frame.dims,lat0=frame.lat0,lon0=frame.lon0,delta=canonicalRegisteredDeltaMeters(lat0,lon0,lat,lon);
    const north=Number(delta.northMeters||0),east=Number(delta.eastMeters||0);
    const insideDetail=Math.abs(east)<=dims.patchWidth*.52&&Math.abs(north)<=dims.patchHeight*.52;
    // The visible local map is the detailed 1x patch plus a canonical 3x
    // surround. Projecting overlays only against the 1x patch made valid
    // country boundaries stop at an invisible interior rectangle while the
    // player still saw world-matched surround terrain beyond it.
    const insideSurround=Boolean(horizonSkirt?.enabled)&&Math.abs(east)<=dims.patchWidth*1.5&&Math.abs(north)<=dims.patchHeight*1.5;
    if(!insideDetail&&!insideSurround)return null;
    const holder=insideDetail?tangentPatch:horizonSkirt;
    const groundY=insideDetail?localGroundHeightUnits(east,north,frame):0;
    const local=new pc.Vec3(east/dims.metersPerUnit,groundY+Number(surfaceOffsetMeters||0)/dims.metersPerUnit,-north/dims.metersPerUnit);
    const world=holder.getWorldTransform().transformPoint(local,new pc.Vec3());
    return {world,mode:insideDetail?"tangent":"tangent-surround",latitudeRadians:lat,longitudeRadians:lon,eastMeters:east,northMeters:north};
  }
  const direction=window.PlanetGeography.directionFromLatLon(lat,lon);if(!direction)return null;
  let sample=null;try{sample=geography?.sampleLatLon?.(lat,lon)||null;}catch(_){sample=null;}
  const visualMeters=visualElevationMeters(sample||{land:true,elevationMeters:0});
  const radius=DISPLAY_RADIUS_UNITS*(1+(visualMeters/WORLD_RADIUS_METERS)*HEIGHT_EXAGGERATION)+(DISPLAY_RADIUS_UNITS/WORLD_RADIUS_METERS)*Number(surfaceOffsetMeters||0);
  const local=new pc.Vec3(direction.x*radius,direction.y*radius,direction.z*radius);
  const world=planet?.getWorldTransform?.().transformPoint(local,new pc.Vec3())||local;
  return {world,mode:"globe",latitudeRadians:lat,longitudeRadians:lon,eastMeters:null,northMeters:null};
}
function cameraViewDepth(world){
  if(!world||!cameraEntity?.camera?.viewMatrix||!pc)return null;
  try{
    const viewPoint=cameraEntity.camera.viewMatrix.transformPoint(world,new pc.Vec3());
    return Number(viewPoint?.z);
  }catch(_){return null;}
}
function projectGeographicAnchor(anchor,options={}){
  if(!canvas||!cameraEntity?.camera||!anchor)return null;
  const scene=geographicScenePoint(anchor.latitudeRadians,anchor.longitudeRadians,options.surfaceOffsetMeters||0);if(!scene)return null;
  if(scene.mode==="globe"&&planet){
    const center=planet.getPosition(),normal=scene.world.clone().sub(center),toCamera=cameraEntity.getPosition().clone().sub(scene.world);
    if(normal.dot(toCamera)<=0)return null;
  }
  const screen=cameraEntity.camera.worldToScreen(scene.world),viewDepth=cameraViewDepth(scene.world),rect=canvas.getBoundingClientRect();
  // PlayCanvas worldToScreen().z is unnormalized clip-space depth and can be
  // negative for visible points, especially with our orthographic camera.
  // The documented behind-camera test is view-space Z: visible points are < 0.
  if(!Number.isFinite(screen.x)||!Number.isFinite(screen.y)||!Number.isFinite(screen.z)||!Number.isFinite(viewDepth)||viewDepth>=0)return null;
  const xPct=screen.x/Math.max(1,rect.width)*100,yPct=screen.y/Math.max(1,rect.height)*100;
  if(options.allowOffscreen!==true&&(xPct<0||xPct>100||yPct<0||yPct>100))return null;
  return {
    x:xPct,y:yPct,screenX:screen.x,screenY:screen.y,depth:screen.z,viewDepth,mode:scene.mode,
    latitudeRadians:scene.latitudeRadians,longitudeRadians:scene.longitudeRadians,
    worldX:Number(scene.world.x.toFixed(6)),worldY:Number(scene.world.y.toFixed(6)),worldZ:Number(scene.world.z.toFixed(6))
  };
}
function projectMapLabel(descriptor){return projectGeographicAnchor(descriptor,{surfaceOffsetMeters:8});}
function gameplayCenterMarkerTelemetry(layer){
  const fabric=coordinateFabricAuthority(),marker=layer?.querySelector?.(".planet-world-center");
  if(!fabric||!marker)return null;
  const center=fabric.describeLatLon(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians,256);
  const cell=fabric.materializeCell(center.worldTile,256);
  const projected=projectGeographicAnchor(center,{surfaceOffsetMeters:14});
  if(!projected){marker.hidden=true;return Object.freeze({visible:false,worldTile:center.worldTile,canonicalSpatialCellId:cell.id});}
  marker.hidden=false;
  const rect=canvas.getBoundingClientRect(),rootRect=root.getBoundingClientRect(),offsetX=rect.left-rootRect.left,offsetY=rect.top-rootRect.top;
  marker.style.left=(offsetX+projected.screenX).toFixed(2)+"px";marker.style.top=(offsetY+projected.screenY).toFixed(2)+"px";
  const code=marker.querySelector("code"),shortCell=cell.cellX+","+cell.cellY;
  if(code)code.textContent="CELL "+shortCell+" · "+center.latitudeDegrees.toFixed(3)+"°, "+center.longitudeDegrees.toFixed(3)+"°";
  marker.dataset.cellId=cell.id;marker.dataset.tile=center.worldTile.x+","+center.worldTile.y;
  return Object.freeze({
    visible:true,screenX:Number(projected.screenX.toFixed(2)),screenY:Number(projected.screenY.toFixed(2)),clipDepth:Number(projected.depth.toFixed(6)),viewDepth:Number(projected.viewDepth.toFixed(6)),projection:projected.mode,
    latitudeDegrees:Number(center.latitudeDegrees.toFixed(6)),longitudeDegrees:Number(center.longitudeDegrees.toFixed(6)),
    worldTile:center.worldTile,registeredMeters:center.registeredMeters,canonicalSpatialCellId:cell.id,streamSignature:cell.signature,
    coordinateFabricRevision:fabric.revisionSignature,roundTripErrorMeters:center.roundTripErrorMeters,worldAnchored:true,fixedHudDot:false
  });
}
function coordinateFabricDiagnostics(){
  const fabric=coordinateFabricAuthority();if(!fabric)return null;
  const center=fabric.describeLatLon(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians,256),systems=[];
  const add=(kind,id,tile,authority)=>{
    if(!tile||tile.x===undefined||tile.y===undefined)return;
    try{
      const d=fabric.describeTile(tile.x,tile.y,256);
      systems.push(Object.freeze({kind,id:String(id||kind),authority:String(authority||""),worldTile:d.worldTile,canonicalSpatialCellId:d.spatialCell.id,latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees,roundTripErrorMeters:d.roundTripErrorMeters}));
    }catch(_){}
  };
  add("gameplay-center","ACTIVE-CENTER",center.worldTile,"PlanetStage.canonicalFocus");
  add("terrain","FOCUS-TERRAIN",center.worldTile,"PlanetGeography.sampleLatLon");
  try{
    const country=window.PoliticalGeography?.countryAt?.(activeSeed,center.worldTile.x,center.worldTile.y);
    const anchor=country?.mapAnchor||country?.politicalCenter||country?.capital;
    if(anchor)add("country",country.id,anchor,"PoliticalGeography.countryAt");
    if(country?.capital)add("capital",country.capital.id,country.capital,"PoliticalGeography.capital");
  }catch(_){}
  try{
    const region=window.RegionProfile?.at?.(activeSeed,center.worldTile.x,center.worldTile.y);
    if(region?.administrativeSeat)add("region",region.id,region.administrativeSeat,"RegionProfile.at");
  }catch(_){}
  try{
    const village=window.GeographyFoundation?.nearestVillage?.(activeSeed,center.worldTile.x,center.worldTile.y,false);
    if(village)add("village",village.name||"village",{x:village.x,y:village.y},"GeographyFoundation.nearestVillage");
  }catch(_){}
  try{
    const landmark=(destinationNavigator.descriptors||[]).slice().sort((a,b)=>Number(b.importance||0)-Number(a.importance||0)||String(a.id).localeCompare(String(b.id)))[0];
    if(landmark)add("landmark",landmark.id,mapWorldTileAt(landmark.latitudeRadians,landmark.longitudeRadians),"DestinationNavigatorDescriptor");
  }catch(_){}
  try{
    const house=window.HousePlans?.build?.(activeSeed)?.[0];
    if(house?.bounds){
      const x=String(Math.round((Number(house.bounds.minX)+Number(house.bounds.maxX))/2)),y=String(Math.round((Number(house.bounds.minY)+Number(house.bounds.maxY))/2));
      add("building",house.id||"house",Object.freeze({x,y}),"HousePlans.build");
    }
  }catch(_){}
  try{
    let road=null;
    for(let y=-20;y<=20&&!road;y++)for(let x=-20;x<=20&&!road;x++){
      const local=window.StartingVillage?.local?.(activeSeed,String(x),String(y)),infra=local&&window.StartingVillage?.infrastructureAt?.(activeSeed,local);
      if(infra?.type==="road"||infra?.type==="path")road={x:String(x),y:String(y),kind:infra.kind||infra.type};
    }
    if(road)add("road",road.kind,road,"StartingVillage.infrastructureAt");
  }catch(_){}
  try{
    const edge=mapBorderCache?.diagnostics?.[0]?.aTile;
    if(edge)add("political-border",mapBorderCache.diagnostics[0].canonicalEdgeId||"border-edge",edge,"PoliticalGeography.canonicalBoundaryGraph");
  }catch(_){}
  const snapshot=fabric.snapshot(center.worldTile);
  return Object.freeze({
    ...snapshot,
    center,
    consumers:Object.freeze(systems),
    consumerKinds:Object.freeze(systems.map(item=>item.kind)),
    maxRoundTripErrorMeters:Number(systems.reduce((m,item)=>Math.max(m,Number(item.roundTripErrorMeters||0)),center.roundTripErrorMeters||0).toFixed(6)),
    sameSeedSpatialAuthority:systems.every(item=>String(item.canonicalSpatialCellId||"").includes(fabric.revisionSignature)),
    fullWorldScan:false
  });
}
function mapLandmarkKindsForBand(_band){return currentSemanticLayerPolicy(false).landmarkKinds.slice();}

function atlasHashText(value){
  let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function atlasFloorDiv(value,size){
  const v=BigInt(String(value)),s=BigInt(size);let q=v/s,r=v%s;if(r!==0n&&v<0n)q-=1n;return q;
}
function atlasCellForTile(tile,size){
  return Object.freeze({x:atlasFloorDiv(tile.x,size),y:atlasFloorDiv(tile.y,size)});
}
function atlasCityCellSize(){return Math.max(1024,Math.round(Number(window.WorldStandards?.CITY_CELL_SIZE_TILES||16384)))}
function atlasCityQuery(){
  const size=atlasCityCellSize(),focusTile=mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  const focusCell=atlasCellForTile(focusTile,size),tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||2));
  const cosLat=Math.max(.08,Math.cos(zoomState.focusLatitudeRadians));
  const halfXTiles=Math.ceil((Math.max(1,zoomState.visibleFootprintWidthMeters)*.56)/(2*tileMeters*cosLat));
  const halfYTiles=Math.ceil((Math.max(1,zoomState.visibleFootprintHeightMeters)*.56)/(2*tileMeters));
  let minX=atlasFloorDiv((BigInt(focusTile.x)-BigInt(halfXTiles)).toString(),size)-1n;
  let maxX=atlasFloorDiv((BigInt(focusTile.x)+BigInt(halfXTiles)).toString(),size)+1n;
  let minY=atlasFloorDiv((BigInt(focusTile.y)-BigInt(halfYTiles)).toString(),size)-1n;
  let maxY=atlasFloorDiv((BigInt(focusTile.y)+BigInt(halfYTiles)).toString(),size)+1n;
  const radius=5n;
  if(maxX-minX+1n>11n){minX=focusCell.x-radius;maxX=focusCell.x+radius;}
  if(maxY-minY+1n>11n){minY=focusCell.y-radius;maxY=focusCell.y+radius;}
  const half=BigInt(Math.floor(size/2)),tiles=[];
  for(let cy=minY;cy<=maxY;cy++)for(let cx=minX;cx<=maxX;cx++){
    tiles.push(Object.freeze({x:(cx*BigInt(size)+half).toString(),y:(cy*BigInt(size)+half).toString(),cellX:cx.toString(),cellY:cy.toString()}));
  }
  tiles.sort((a,b)=>{
    const adx=Number(BigInt(a.cellX)-focusCell.x),ady=Number(BigInt(a.cellY)-focusCell.y),bdx=Number(BigInt(b.cellX)-focusCell.x),bdy=Number(BigInt(b.cellY)-focusCell.y);
    return adx*adx+ady*ady-(bdx*bdx+bdy*bdy)||a.cellY.localeCompare(b.cellY)||a.cellX.localeCompare(b.cellX);
  });
  return Object.freeze({
    key:[size,minX,maxX,minY,maxY].join(":"),
    size,tiles:Object.freeze(tiles.slice(0,121)),
    requestedCellCount:Number((maxX-minX+1n)*(maxY-minY+1n)),
    bounded:true
  });
}
function atlasCellId(prefix,cell){return prefix+"|"+cell.x.toString()+"|"+cell.y.toString()+"|"+atlasHashText(activeSeed+"|"+prefix+"|"+cell.x+"|"+cell.y).slice(0,8);}
function atlasPlanetSurfaceForTile(x,y){
  const geo=worldLatLonForTile(x,y);let sample=null;try{sample=geography?.sampleLatLon?.(geo.latitudeRadians,geo.longitudeRadians)||null;}catch(_){}
  return {geo,sample};
}
function atlasRepresentativeTile(baseX,baseY,step,wantLand,validator){
  const bx=BigInt(String(baseX)),by=BigInt(String(baseY)),s=BigInt(Math.max(1,Math.round(step||1)));
  const offsets=[[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[-2,0],[0,2],[0,-2]];
  for(const [ox,oy] of offsets){
    const x=(bx+BigInt(ox)*s).toString(),y=(by+BigInt(oy)*s).toString();
    let valid=true;try{valid=validator?validator(x,y):true;}catch(_){valid=false;}if(!valid)continue;
    const {sample}=atlasPlanetSurfaceForTile(x,y);if(!sample||Boolean(sample.land)!==Boolean(wantLand))continue;
    return Object.freeze({x,y});
  }
  return null;
}
function atlasStableLandAnchor(base,step,validator){
  if(!base)return null;
  const bx=BigInt(String(base.x)),by=BigInt(String(base.y)),stride=BigInt(Math.max(1,Math.round(step||1)));
  const offsets=[[0,0]];
  for(let ring=1;ring<=6;ring++)for(let spoke=0;spoke<16;spoke++){
    const angle=Math.PI*2*spoke/16;
    offsets.push([Math.round(Math.cos(angle)*ring),Math.round(Math.sin(angle)*ring)]);
  }
  const seen=new Set();
  for(const [ox,oy] of offsets){
    const x=(bx+BigInt(ox)*stride).toString(),y=(by+BigInt(oy)*stride).toString(),key=x+"|"+y;
    if(seen.has(key))continue;seen.add(key);
    let valid=true;try{valid=validator?validator(x,y):true;}catch(_){valid=false;}if(!valid)continue;
    const surface=atlasPlanetSurfaceForTile(x,y);if(surface.sample?.land)return Object.freeze({x,y});
  }
  return null;
}
function atlasEntityBase(id,type,name,anchorTile,authority,extra={}){
  if(!id||!name||!anchorTile)return null;const geo=worldLatLonForTile(anchorTile.x,anchorTile.y);
  return Object.freeze({id:String(id),type:String(type),name:String(name),authority:String(authority),anchorTile:Object.freeze({x:String(anchorTile.x),y:String(anchorTile.y)}),
    latitudeRadians:geo.latitudeRadians,longitudeRadians:geo.longitudeRadians,latitudeDegrees:geo.latitudeDegrees,longitudeDegrees:geo.longitudeDegrees,...extra});
}
function atlasCanonicalEntityForKind(kind,tile){
  if(!activeSeed||!tile)return null;
  if(kind==="continent"){
    const surface=atlasPlanetSurfaceForTile(tile.x,tile.y),continentId=surface.sample?.continentId||null;
    if(!surface.sample?.land||!continentId)return null;
    const cacheKey=activeSeed+"|"+continentId;
    if(atlasEntityCache.has(cacheKey))return atlasEntityCache.get(cacheKey);
    const descriptor=geography?.continentById?.(continentId)||null;
    if(!descriptor){atlasEntityCache.set(cacheKey,null);return null;}
    const anchor=mapWorldTileAt(descriptor.latitudeRadians,descriptor.longitudeRadians);
    const entity=atlasEntityBase(continentId,"continent",descriptor.name,anchor,"PlanetGeography.continentById",{continentId});
    atlasEntityCache.set(cacheKey,entity);return entity;
  }
  if(kind==="ocean"){
    const size=196608,cell=atlasCellForTile(tile,size),id=atlasCellId("OCEAN",cell),cacheKey=activeSeed+"|"+id;
    if(atlasEntityCache.has(cacheKey))return atlasEntityCache.get(cacheKey);
    const half=BigInt(Math.floor(size/2)),base={x:(cell.x*BigInt(size)+half).toString(),y:(cell.y*BigInt(size)+half).toString()};
    const anchor=atlasRepresentativeTile(base.x,base.y,Math.floor(size*.20),false,null);if(!anchor){atlasEntityCache.set(cacheKey,null);return null;}
    const geo=worldLatLonForTile(anchor.x,anchor.y),name=mapGeneratedName("ocean",geo.latitudeRadians,geo.longitudeRadians);
    const entity=atlasEntityBase(id,"ocean",name,anchor,"PlanetGeography+deterministic-water-cell");atlasEntityCache.set(cacheKey,entity);return entity;
  }
  if(kind==="country"||kind==="capital"){
    const key=atlasAuthorityKey("country",tile);
    if(!atlasAuthorityIndex.has(key)){atlasQueueAuthority("country",tile);return null;}
    const countryEntity=atlasAuthorityIndex.get(key);if(!countryEntity)return null;
    if(kind==="country")return countryEntity;
    const capital=countryEntity.capital;if(!capital)return null;
    const capKey=activeSeed+"|"+String(capital.id);
    if(atlasEntityCache.has(capKey))return atlasEntityCache.get(capKey);
    const surface=atlasPlanetSurfaceForTile(capital.x,capital.y);
    let owner=null;try{owner=window.PoliticalGeography?.ownerAt?.(activeSeed,capital.x,capital.y)||null;}catch(_){owner=null;}
    if(!surface.sample?.land||owner?.id!==countryEntity.id){atlasEntityCache.set(capKey,null);return null;}
    const entity=atlasEntityBase(capital.id,"capital",capital.name,{x:capital.x,y:capital.y},"PoliticalGeography.capital:canonical-owned-land",{countryId:countryEntity.id,parentCountryMatch:true});
    atlasEntityCache.set(capKey,entity);return entity;
  }
  if(kind==="region"){
    const key=atlasAuthorityKey("region",tile);
    if(!atlasAuthorityIndex.has(key)){atlasQueueAuthority("region",tile);return null;}
    return atlasAuthorityIndex.get(key);
  }
  if(kind==="city"||kind==="district"){
    const size=kind==="city"?atlasCityCellSize():256,cell=atlasCellForTile(tile,size),id=atlasCellId(kind==="city"?"CITY":"DIST",cell),cacheKey=activeSeed+"|"+id;
    if(atlasEntityCache.has(cacheKey))return atlasEntityCache.get(cacheKey);
    if(kind==="city"){
      const city=window.GeographyFoundation?.cityAtCell?.(activeSeed,cell.x,cell.y)||null;
      if(!city){atlasEntityCache.set(cacheKey,null);return null;}
      const anchor={x:String(city.x),y:String(city.y)},surface=atlasPlanetSurfaceForTile(anchor.x,anchor.y);
      if(!surface.sample?.land){atlasEntityCache.set(cacheKey,null);return null;}
      const entity=atlasEntityBase(id,"city",city.name,anchor,"GeographyFoundation.cityAtCell:seed-land",{cityCellX:String(cell.x),cityCellY:String(cell.y),landValidated:Boolean(city.landValidated)});
      atlasEntityCache.set(cacheKey,entity);return entity;
    }
    const half=BigInt(Math.floor(size/2)),base={x:(cell.x*BigInt(size)+half).toString(),y:(cell.y*BigInt(size)+half).toString()};
    const anchor=atlasRepresentativeTile(base.x,base.y,Math.max(16,Math.floor(size*.2)),true,(x,y)=>{const cc=atlasCellForTile({x,y},size);return cc.x===cell.x&&cc.y===cell.y;});
    if(!anchor){atlasEntityCache.set(cacheKey,null);return null;}const name=window.GeographyFoundation?.hierarchyName?.(activeSeed,kind,anchor.x,anchor.y);if(!name){atlasEntityCache.set(cacheKey,null);return null;}
    const entity=atlasEntityBase(id,kind,name,anchor,"GeographyFoundation.hierarchy");atlasEntityCache.set(cacheKey,entity);return entity;
  }
  if(kind==="village"){
    const v=window.GeographyFoundation?.nearestVillage?.(activeSeed,tile.x,tile.y,false);if(!v)return null;
    const cell=Object.freeze({x:BigInt(v.cellX),y:BigInt(v.cellY)}),id=atlasCellId("VIL",cell),cacheKey=activeSeed+"|"+id;
    if(atlasEntityCache.has(cacheKey))return atlasEntityCache.get(cacheKey);
    const surface=atlasPlanetSurfaceForTile(v.x,v.y);if(!surface.sample?.land){atlasEntityCache.set(cacheKey,null);return null;}
    const entity=atlasEntityBase(id,"village",v.name,{x:v.x,y:v.y},"GeographyFoundation.villageCenter");atlasEntityCache.set(cacheKey,entity);return entity;
  }
  return null;
}
function atlasTownEntitiesForFocus(){
  if(!activeSeed||!window.SettlementArchetypes?.settlementsForCountry||!window.PoliticalGeography?.countryAt)return Object.freeze([]);
  const focusTile=mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  let country=null,plans=[];try{country=window.PoliticalGeography.countryAt(activeSeed,focusTile.x,focusTile.y);plans=country?window.SettlementArchetypes.settlementsForCountry(activeSeed,country,3)||[]:[];}catch(_){plans=[];}
  const out=[];
  for(const plan of plans){
    if(plan?.classId!=="town"||!plan?.center)continue;
    const anchor={x:String(plan.center.x),y:String(plan.center.y)},surface=atlasPlanetSurfaceForTile(anchor.x,anchor.y);
    if(!surface.sample?.land)continue;
    const cacheKey=activeSeed+"|TOWN|"+String(plan.id);
    let entity=atlasEntityCache.get(cacheKey)||null;
    if(!entity){
      entity=atlasEntityBase(plan.id,"town",plan.name,anchor,"SettlementArchetypes.settlementsForCountry:seed-plan",
        {countryId:plan.countryId||country?.id||null,regionId:plan.regionId||null,settlementClass:plan.classId,settlementRole:plan.role||null});
      if(entity)atlasEntityCache.set(cacheKey,entity);
    }
    if(entity)out.push(entity);
  }
  return Object.freeze(out.sort((a,b)=>a.id.localeCompare(b.id)).slice(0,24));
}
function atlasSettlementHierarchyQuery(spec){
  const classes=spec.kinds.filter(kind=>kind==="city"||kind==="town"||kind==="village");
  const api=window.SettlementArchetypes;
  if(!classes.length||!activeSeed||!api?.canonicalSettlementsInBounds)return null;
  const focusTile=mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||2)),cosLat=Math.max(.08,Math.cos(zoomState.focusLatitudeRadians));
  const halfXTiles=Math.ceil((Math.max(1,zoomState.visibleFootprintWidthMeters)*.62)/(2*tileMeters*cosLat));
  const halfYTiles=Math.ceil((Math.max(1,zoomState.visibleFootprintHeightMeters)*.62)/(2*tileMeters));
  const minX=(BigInt(focusTile.x)-BigInt(halfXTiles)).toString(),maxX=(BigInt(focusTile.x)+BigInt(halfXTiles)).toString();
  const minY=(BigInt(focusTile.y)-BigInt(halfYTiles)).toString(),maxY=(BigInt(focusTile.y)+BigInt(halfYTiles)).toString();
  let query=null;try{query=api.canonicalSettlementsInBounds(activeSeed,{minX,maxX,minY,maxY},classes);}catch(_){query=null;}
  if(!query)return null;
  const entities=[];
  for(const record of query.settlements||[]){
    const type=record.classId==="city"?"city":record.classId==="town"?"town":record.classId==="village"?"village":null;
    if(!type||!classes.includes(type))continue;
    const anchor={x:String(record.center.x),y:String(record.center.y)},surface=atlasPlanetSurfaceForTile(anchor.x,anchor.y);
    if(!surface.sample?.land)continue;
    const entity=atlasEntityBase(record.id,type,record.name,anchor,"SettlementArchetypes.canonicalSettlementsInBounds:seed-hierarchy",{
      countryId:record.countryId||null,regionId:record.regionId||null,settlementClass:record.classId,
      importanceClass:record.importanceClass||record.classId,settlementRole:record.role||null,
      generationCellId:record.generationCell?.id||null,generationCellX:record.generationCell?.cellX??null,generationCellY:record.generationCell?.cellY??null,
      hierarchyRevision:query.diagnostics?.revision||null,hierarchySignature:record.cacheRegenerationSignature||null,
      carryingCapacity:Number(record.carryingCapacity||0),candidateRank:Number(record.candidateRank||0),
      nearestSameClassMeters:record.nearestSameClassMeters??null,nearestHigherClassMeters:record.nearestHigherClassMeters??null,
      importance:record.importanceClass==="major-city"?6:record.classId==="city"?4:record.classId==="town"?2:0
    });
    if(entity)entities.push(entity);
  }
  return Object.freeze({
    key:[query.diagnostics?.revision,query.diagnostics?.signature,minX,maxX,minY,maxY,classes.join(",")].join(":"),
    entities:Object.freeze(entities.sort((a,b)=>String(a.id).localeCompare(String(b.id)))),
    diagnostics:query.diagnostics
  });
}
function atlasBandSpec(_band,portrait){return currentSemanticLayerPolicy(portrait);}
function atlasQuerySamples(spec){
  const globe=spec.queryMode==="globe";
  const out=[];
  if(globe){
    const rows=3,cols=5,latSpan=Number(spec.latSpan||28)*Math.PI/180,lonSpan=Number(spec.lonSpan||44)*Math.PI/180;
    for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){
      const fy=rows===1?0:(r/(rows-1)-.5)*2,fx=cols===1?0:(col/(cols-1)-.5)*2;
      out.push(Object.freeze({latitudeRadians:clamp(zoomState.focusLatitudeRadians-fy*latSpan,-Math.PI*.499999,Math.PI*.499999),longitudeRadians:wrapLongitudeRadians(zoomState.focusLongitudeRadians+fx*lonSpan)}));
    }
  }else{
    const rows=3,cols=3,width=Math.max(1,zoomState.visibleFootprintWidthMeters*.88),height=Math.max(1,zoomState.visibleFootprintHeightMeters*.88);
    for(let r=0;r<rows;r++)for(let col=0;col<cols;col++)out.push(geoPointFromViewportGrid(col,r,cols,rows,width,height));
  }
  return out;
}
function atlasFocusEntityIds(spec){
  const tile=mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians),ids={},needed=new Set(spec.kinds);
  let countryEntity=null,regionEntity=null;
  if(needed.has("country")||needed.has("capital")){
    const key=atlasAuthorityKey("country",tile);
    if(!atlasAuthorityIndex.has(key))atlasQueueAuthority("country",tile);
    countryEntity=atlasAuthorityIndex.get(key)||null;
  }
  if(needed.has("region")){
    const key=atlasAuthorityKey("region",tile);
    if(!atlasAuthorityIndex.has(key))atlasQueueAuthority("region",tile);
    regionEntity=atlasAuthorityIndex.get(key)||null;
  }
  if(needed.has("continent")){
    const surface=atlasPlanetSurfaceForTile(tile.x,tile.y);
    ids.continent=surface.sample?.land?(surface.sample?.continentId||null):null;
  }
  if(needed.has("country"))ids.country=countryEntity?.id||null;
  if(needed.has("capital"))ids.capital=countryEntity?.capital?.id||null;
  if(needed.has("region"))ids.region=regionEntity?.id||null;
  for(const kind of ["city","town","village"]){
    if(!needed.has(kind))continue;
    let record=null;try{record=window.SettlementArchetypes?.canonicalSettlementAtPoint?.(activeSeed,kind,tile.x,tile.y)||null;}catch(_){record=null;}
    ids[kind]=record?.id||null;
  }
  if(needed.has("district"))ids.district=atlasCellId("DIST",atlasCellForTile(tile,256));
  return {tile,ids,primaryId:ids[spec.focusKind]||null};
}
function atlasQueryCandidates(spec){
  const precision=spec.queryMode==="globe"?(spec.index<=1?1:2):4;
  const settlementHierarchy=(spec.kinds.includes("city")||spec.kinds.includes("town")||spec.kinds.includes("village"))?atlasSettlementHierarchyQuery(spec):null;
  const key=[activeSeed,spec.id,zoomState.focusLatitudeRadians.toFixed(precision),zoomState.focusLongitudeRadians.toFixed(precision),
    Math.round(Math.log10(Math.max(1,zoomState.visibleFootprintWidthMeters))*20),spec.kinds.join(","),settlementHierarchy?.key||"no-settlement-hierarchy"].join("|");
  if(atlasLabelCache.key===key)return atlasLabelCache;
  const started=performance.now(),samples=atlasQuerySamples(spec),unique=new Map(),focus=atlasFocusEntityIds(spec);
  if(settlementHierarchy){
    for(const entity of settlementHierarchy.entities||[])if(entity&&!unique.has(entity.id))unique.set(entity.id,entity);
  }
  for(const [sampleIndex,point] of samples.entries()){
    let surface=null;try{surface=geography?.sampleLatLon?.(point.latitudeRadians,point.longitudeRadians)||null;}catch(_){surface=null;}if(!surface)continue;
    const tile=mapWorldTileAt(point.latitudeRadians,point.longitudeRadians);
    for(const kind of spec.kinds){
      if(kind==="landmark"||(settlementHierarchy&&["city","town","village"].includes(kind)))continue;
      if(samples.length>9&&["country","region","capital"].includes(kind)&&sampleIndex%3!==1)continue;
      if(kind==="ocean"){if(surface.land)continue;}else if(!surface.land)continue;
      let entity=null;try{entity=atlasCanonicalEntityForKind(kind,tile);}catch(_){entity=null;}if(!entity)continue;
      if(!unique.has(entity.id))unique.set(entity.id,entity);
    }
  }
  if(spec.kinds.includes("landmark")){
    for(const d of destinationNavigator.descriptors){
      if(!["peak","mountain","island","ruin","water"].includes(d.type)||!spec.landmarkKinds.includes(d.type))continue;
      const tile=mapWorldTileAt(d.latitudeRadians,d.longitudeRadians);
      const entity=atlasEntityBase(d.id,"landmark",d.name,tile,"DestinationNavigatorDescriptor",{landmarkType:d.type,importance:Number(d.importance||0),latitudeRadians:Number(d.latitudeRadians)||0,longitudeRadians:Number(d.longitudeRadians)||0,latitudeDegrees:Number(d.latitudeDegrees)||0,longitudeDegrees:Number(d.longitudeDegrees)||0});
      if(entity&&!unique.has(entity.id))unique.set(entity.id,entity);
    }
  }
  if(spec.index===2){
    const countryCount=[...unique.values()].filter(entity=>entity.type==="country").length;
    if(countryCount<2){for(const [id,entity] of [...unique.entries()])if(entity.type==="region")unique.delete(id);}
  }
  const typePriority={continent:100,ocean:96,country:90,landmark:84,region:82,capital:78,city:72,town:70,village:68,district:60};
  const candidates=[...unique.values()].map(entity=>Object.freeze({...entity,currentFocus:entity.id===focus.primaryId,priority:(entity.id===focus.primaryId?1000:0)+(typePriority[entity.type]||0)+Number(entity.importance||0)}))
    .sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  atlasLabelCache={key,candidates,queryCellCount:samples.length+Number(settlementHierarchy?.diagnostics?.queryCellCount||0),
    cityQuery:null,settlementHierarchy,buildMs:Number((performance.now()-started).toFixed(3)),focus};
  return atlasLabelCache;
}
function atlasResolvedIdentity(entity){
  const cacheKey=activeSeed+"|"+entity.id+"|"+entity.anchorTile.x+"|"+entity.anchorTile.y;
  if(atlasIdentityCache.has(cacheKey))return atlasIdentityCache.get(cacheKey);
  const tile=entity.anchorTile,ids={continent:null,country:null,region:null,city:null,town:null,district:null,village:null};
  let resolvedName=null,resolvedId=null;
  try{
    if(entity.type==="continent"){
      const surface=atlasPlanetSurfaceForTile(tile.x,tile.y);
      ids.continent=surface.sample?.land?(surface.sample?.continentId||null):null;resolvedId=ids.continent;
      resolvedName=surface.sample?.continentName||null;
    }else if(entity.type==="ocean"){
      const s=atlasPlanetSurfaceForTile(tile.x,tile.y);resolvedName=s.sample?.land?null:entity.name;resolvedId=s.sample?.land?null:entity.id;
    }else if(entity.type==="country"){
      const country=atlasAuthorityIndex.get(atlasAuthorityKey("country",tile))||null;ids.country=country?.id||null;resolvedId=country?.id||null;resolvedName=country?.name||null;
    }else if(entity.type==="capital"){
      const country=atlasAuthorityIndex.get(atlasAuthorityKey("country",tile))||null;ids.country=country?.id||null;resolvedId=country?.capital?.id||null;resolvedName=country?.capital?.name||null;
    }else if(entity.type==="region"){
      const region=atlasAuthorityIndex.get(atlasAuthorityKey("region",tile))||null;ids.region=region?.id||null;ids.country=region?.countryId||null;resolvedId=region?.id||null;resolvedName=region?.name||null;
    }else if(["city","town","village"].includes(entity.type)&&entity.generationCellX!=null&&entity.generationCellY!=null){
      const record=window.SettlementArchetypes?.canonicalSettlementAtCell?.(
        activeSeed,entity.settlementClass||entity.type,entity.generationCellX,entity.generationCellY
      )||null;
      ids[entity.type]=record?.id||null;ids.country=record?.countryId||entity.countryId||null;ids.region=record?.regionId||entity.regionId||null;
      resolvedId=record?.id||null;resolvedName=record?.name||null;
    }else if(entity.type==="city"){
      const cell=atlasCellForTile(tile,atlasCityCellSize()),city=window.GeographyFoundation?.cityAtCell?.(activeSeed,cell.x,cell.y)||null;
      ids.city=city?atlasCellId("CITY",cell):null;resolvedId=ids.city;resolvedName=city?.name||null;
    }else if(entity.type==="town"){
      const country=entity.countryId?window.PoliticalGeography?.countryById?.(activeSeed,entity.countryId):window.PoliticalGeography?.countryAt?.(activeSeed,tile.x,tile.y);
      const plan=(country&&window.SettlementArchetypes?.settlementsForCountry?.(activeSeed,country,3)||[]).find(item=>item?.id===entity.id&&item?.classId==="town")||null;
      ids.town=plan?.id||null;ids.country=plan?.countryId||entity.countryId||null;ids.region=plan?.regionId||entity.regionId||null;
      resolvedId=plan?.id||null;resolvedName=plan?.name||null;
    }else if(entity.type==="district"){
      const cell=atlasCellForTile(tile,256);ids.district=atlasCellId("DIST",cell);resolvedId=ids.district;resolvedName=window.GeographyFoundation?.hierarchyName?.(activeSeed,"district",tile.x,tile.y)||null;
    }else if(entity.type==="village"){
      const village=window.GeographyFoundation?.nearestVillage?.(activeSeed,tile.x,tile.y,false)||null;
      if(village){ids.village=atlasCellId("VIL",Object.freeze({x:BigInt(village.cellX),y:BigInt(village.cellY)}));resolvedId=ids.village;resolvedName=village.name;}
    }else if(entity.type==="landmark"){
      resolvedName=entity.name;resolvedId=entity.id;
    }
  }catch(_){}
  const result=Object.freeze({ids:Object.freeze(ids),resolvedName:resolvedName||null,resolvedId:resolvedId||null,identityMatch:String(resolvedId||"")===String(entity.id)&&String(resolvedName||"")===String(entity.name)});
  atlasIdentityCache.set(cacheKey,result);return result;
}
function atlasProjectCandidate(entity){
  const scene=geographicScenePoint(entity.latitudeRadians,entity.longitudeRadians,entity.type==="landmark"?8:5);if(!scene)return {reason:"outside-footprint"};
  if(scene.mode==="globe"&&planet){
    const center=planet.getPosition(),normal=scene.world.clone().sub(center),toCamera=cameraEntity.getPosition().clone().sub(scene.world);
    if(normal.dot(toCamera)<=0)return {reason:"hidden-hemisphere"};
  }
  const screen=cameraEntity.camera.worldToScreen(scene.world),viewDepth=cameraViewDepth(scene.world),rect=canvas.getBoundingClientRect();
  if(!Number.isFinite(screen.x)||!Number.isFinite(screen.y)||!Number.isFinite(screen.z))return {reason:"invalid-projection"};
  if(!Number.isFinite(viewDepth)||viewDepth>=0)return {reason:"behind-camera"};
  const x=screen.x/Math.max(1,rect.width)*100,y=screen.y/Math.max(1,rect.height)*100;
  if(x<2||x>98||y<3||y>97)return {reason:"offscreen"};
  return {projection:{x,y,screenX:screen.x,screenY:screen.y,depth:screen.z,viewDepth,mode:scene.mode}};
}
function atlasLabelBox(entity,p,portrait){
  const nameLen=Math.max(5,String(entity.name).length),scale=portrait?.82:1;
  const perChar={continent:15.5,ocean:11.5,country:11.0,region:8.2,capital:7.8,city:7.4,town:7.2,village:7.0,district:6.6,landmark:7.4}[entity.type]||7.4;
  const minWidth={continent:180,ocean:140,country:150,region:115,capital:110,city:104,town:102,village:100,district:96,landmark:86}[entity.type]||100;
  const maxWidth={continent:360,ocean:260,country:300,region:230,capital:220,city:200,town:196,village:190,district:180,landmark:180}[entity.type]||200;
  const width=Math.min(maxWidth,Math.max(minWidth,30+nameLen*perChar))*scale,height=(entity.type==="continent"||entity.type==="ocean"?48:40)*scale;
  return {left:p.screenX-width/2,right:p.screenX+width/2,top:p.screenY-height/2,bottom:p.screenY+height/2};
}
function atlasBoxesOverlap(a,b,gap){return !(a.right+gap<b.left||b.right+gap<a.left||a.bottom+gap<b.top||b.bottom+gap<a.top);}
function atlasPlacementFits(box,rect,reserved,occupied,margin,gap){
  if(box.left<margin||box.right>rect.width-margin||box.top<margin||box.bottom>rect.height-margin)return false;
  if(reserved.some(other=>atlasBoxesOverlap(box,other,gap)))return false;
  if(occupied.some(other=>atlasBoxesOverlap(box,other,gap)))return false;
  return true;
}
function atlasFindLabelPlacement(entity,p,portrait,rect,reserved,occupied){
  const base=atlasLabelBox(entity,p,portrait),width=Math.max(1,base.right-base.left),height=Math.max(1,base.bottom-base.top);
  const margin=portrait?6:8,gap=portrait?5:7,seen=new Set(),candidates=[],maxDisplacement=entity.type==="landmark"?(portrait?82:112):(portrait?58:82);
  const remember=(dx,dy)=>{
    if(Math.hypot(dx,dy)>maxDisplacement+.01)return;
    const key=Math.round(dx)+"|"+Math.round(dy);
    if(seen.has(key))return;seen.add(key);candidates.push({dx,dy});
  };
  // Placement choice must be a pure function of the current canonical anchor,
  // viewport and deterministic candidate ordering. Historical offsets are kept
  // only as telemetry; consulting them here made identical visible states choose
  // different layouts after an intervening pan/portrait frame.
  if(entity.type==="landmark"){
    remember(0,-26);remember(26,0);remember(-26,0);remember(0,26);
  }else remember(0,0);
  const stepX=Math.max(22,Math.min(42,width*.18)),stepY=Math.max(20,Math.min(34,height*.70));
  for(let ring=1;ring<=2;ring++){
    const dx=stepX*ring,dy=stepY*ring;
    remember(0,-dy);remember(0,dy);remember(-dx,0);remember(dx,0);
    remember(-dx,-dy);remember(dx,-dy);remember(-dx,dy);remember(dx,dy);
  }
  const tryCandidate=({dx,dy})=>{
    const minX=margin+width/2,maxX=Math.max(minX,rect.width-margin-width/2);
    const minY=margin+height/2,maxY=Math.max(minY,rect.height-margin-height/2);
    const screenX=clamp(p.screenX+dx,minX,maxX),screenY=clamp(p.screenY+dy,minY,maxY);
    const actualDx=screenX-p.screenX,actualDy=screenY-p.screenY,displacement=Math.hypot(actualDx,actualDy);
    if(displacement>maxDisplacement+.01)return null;
    if(p.mode==="globe"&&entity.type!=="landmark"){
      const cx=rect.width*.5,cy=rect.height*.5;
      const anchorRadius=Math.hypot(p.screenX-cx,p.screenY-cy),placedRadius=Math.hypot(screenX-cx,screenY-cy);
      if(placedRadius>anchorRadius+4)return null;
    }
    const placed={...p,screenX,screenY,x:screenX/Math.max(1,rect.width)*100,y:screenY/Math.max(1,rect.height)*100};
    const box=atlasLabelBox(entity,placed,portrait);
    if(!atlasPlacementFits(box,rect,reserved,occupied,margin,gap))return null;
    return {projection:placed,box,dx:actualDx,dy:actualDy,displacement,maxDisplacement};
  };
  for(const candidate of candidates){
    const placed=tryCandidate(candidate);
    if(placed)return placed;
  }
  return null;
}
function renderAtlasLabels(labelsLayer,portrait,spec){
  const query=atlasQueryCandidates(spec),occupied=[],visible=[],visibleLandmarks=[];
  let hidden=0,behind=0,offscreen=0,occluded=0,overlap=0;
  const hiddenReasons={outsideFootprint:0,hiddenHemisphere:0,behindCamera:0,offscreen:0,identityMismatch:0,overlap:0,duplicateName:0,classBudget:0,globalBudget:0};
  const eligibleCountsByClass={},renderedCountsByClass={};
  for(const entity of query.candidates)eligibleCountsByClass[entity.type]=(eligibleCountsByClass[entity.type]||0)+1;
  const rect=canvas.getBoundingClientRect();
  const projectedById=new Map(),identityById=new Map(),validCandidates=[],seenDisplayNames=new Set();
  const projectionFor=entity=>{
    if(projectedById.has(entity.id))return projectedById.get(entity.id);
    const projected=atlasProjectCandidate(entity);projectedById.set(entity.id,projected);return projected;
  };
  // A candidate may consume semantic density only after it is actually eligible
  // for this frame. Projection/occlusion and canonical identity come before the
  // bounded class/global budgets; otherwise offscreen high-priority entities can
  // starve visible lower-priority entities and create an empty map.
  for(const entity of query.candidates){
    const projected=projectionFor(entity);
    if(!projected.projection){
      if(projected.reason==="hidden-hemisphere"){hidden++;occluded++;hiddenReasons.hiddenHemisphere++;}
      else if(projected.reason==="behind-camera"){behind++;hiddenReasons.behindCamera++;}
      else if(projected.reason==="outside-footprint"){offscreen++;hiddenReasons.outsideFootprint++;}
      else {offscreen++;hiddenReasons.offscreen++;}
      continue;
    }
    const identity=atlasResolvedIdentity(entity);identityById.set(entity.id,identity);
    if(!identity.identityMatch){hiddenReasons.identityMismatch++;continue;}
    const displayKey=entity.type+"|"+String(entity.name).trim().toLocaleLowerCase();
    if(seenDisplayNames.has(displayKey)){hiddenReasons.duplicateName++;continue;}
    seenDisplayNames.add(displayKey);validCandidates.push(entity);
  }
  if(atlasStickyBand!==spec.id){
    atlasStickyBand=spec.id;
    atlasLabelPlacementCache.clear();
  }
  // Semantic hysteresis stabilizes the eligible class set across scale
  // thresholds. Density membership inside that set is recomputed from the
  // current projected/validated candidates so identical visible state cannot
  // inherit a different label set from prior pan or viewport history.
  atlasStickyEntities.clear();
  const classCount=type=>[...atlasStickyEntities.values()].filter(item=>item.type===type).length;
  const canAdd=entity=>{
    if(atlasStickyEntities.has(entity.id))return true;
    if(atlasStickyEntities.size>=spec.budget){hiddenReasons.globalBudget++;return false;}
    const limit=Number(spec.classBudgets?.[entity.type]??spec.budget);
    if(classCount(entity.type)>=limit){hiddenReasons.classBudget++;return false;}
    atlasStickyEntities.set(entity.id,entity);return true;
  };
  // Landmarks are independently eligible at their scale tier. Reserve a small
  // bounded quota so hierarchy labels cannot consume the entire sticky budget.
  const landmarkReserve=spec.kinds.includes("landmark")?Math.min(spec.budget,portrait?2:3,Number(spec.classBudgets?.landmark??3)):0;
  const viewportCenter=Object.freeze({x:rect.width*.5,y:rect.height*.5});
  const preferredLandmarks=validCandidates.filter(entity=>entity.type==="landmark")
    .map(entity=>{const projected=projectionFor(entity).projection;return {entity,projected,distance:Math.hypot(projected.screenX-viewportCenter.x,projected.screenY-viewportCenter.y)};})
    .sort((a,b)=>a.distance-b.distance||Number(b.entity.importance||0)-Number(a.entity.importance||0)||a.entity.id.localeCompare(b.entity.id))
    .slice(0,landmarkReserve)
    .map(item=>item.entity);
  for(const entity of preferredLandmarks){
    if(atlasStickyEntities.has(entity.id)){atlasStickyEntities.set(entity.id,entity);continue;}
    while(atlasStickyEntities.size>=spec.budget){
      const removable=[...atlasStickyEntities.values()].filter(item=>item.type!=="landmark")
        .sort((a,b)=>Number(a.importance||0)-Number(b.importance||0)||b.id.localeCompare(a.id))[0];
      if(!removable)break;
      atlasStickyEntities.delete(removable.id);atlasLabelPlacementCache.delete(removable.id);
    }
    canAdd(entity);
  }
  for(const entity of validCandidates)canAdd(entity);
  const typePriority={continent:100,ocean:96,country:90,landmark:84,region:82,capital:78,city:72,town:70,village:68,district:60};
  const rankedCandidates=[...atlasStickyEntities.values()].map(entity=>({
    ...entity,
    currentFocus:entity.id===query.focus?.primaryId,
    priority:(entity.id===query.focus?.primaryId?1000:0)+(typePriority[entity.type]||0)+Number(entity.importance||0)
  })).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  const candidates=rankedCandidates;
  const reservedSelectors=[".planet-map-context",".planet-places-button",".planet-scale-ruler",".planet-world-center"];
  const reserved=reservedSelectors.map(selector=>root?.querySelector?.(selector)?.getBoundingClientRect?.()).filter(Boolean).map(r=>({left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top}));
  for(const entity of candidates){
    const projected=projectionFor(entity);
    if(!projected.projection)continue;
    const identity=identityById.get(entity.id)||atlasResolvedIdentity(entity);
    if(!identity.identityMatch)continue;
    const anchor=projected.projection,placed=atlasFindLabelPlacement(entity,anchor,portrait,rect,reserved,occupied);
    if(!placed){overlap++;hiddenReasons.overlap++;continue;}
    atlasLabelPlacementCache.set(entity.id,{dx:placed.dx,dy:placed.dy});
    const p=placed.projection,box=placed.box;
    const tag=document.createElement("div");
    tag.className=entity.type==="landmark"?"planet-map-landmark":"planet-atlas-label";
    tag.dataset.kind=entity.type==="landmark"?(entity.landmarkType||"landmark"):entity.type;
    tag.dataset.focus=String(entity.currentFocus===true);
    const rootRect=root.getBoundingClientRect(),canvasOffsetX=rect.left-rootRect.left,canvasOffsetY=rect.top-rootRect.top;
    tag.style.left=(canvasOffsetX+p.screenX).toFixed(2)+"px";tag.style.top=(canvasOffsetY+p.screenY).toFixed(2)+"px";
    tag.innerHTML="<small></small><strong></strong>";
    tag.querySelector("small").textContent=(entity.type==="landmark"?String(entity.landmarkType||"landmark"):entity.type).toUpperCase();
    tag.querySelector("strong").textContent=entity.name;
    const displacement=Math.hypot(placed.dx,placed.dy),leaderVisible=entity.type==="landmark"||displacement>=18;
    if(leaderVisible){
      const leader=document.createElement("i");leader.className="planet-atlas-leader";leader.dataset.landmark=String(entity.type==="landmark");
      leader.style.left=(canvasOffsetX+anchor.screenX).toFixed(2)+"px";leader.style.top=(canvasOffsetY+anchor.screenY).toFixed(2)+"px";
      leader.style.width=displacement.toFixed(1)+"px";
      leader.style.transform="rotate("+Math.atan2(placed.dy,placed.dx).toFixed(5)+"rad)";
      labelsLayer.appendChild(leader);
    }
    labelsLayer.appendChild(tag);occupied.push(box);
    const renderedRect=tag.getBoundingClientRect();
    const renderedCenterX=renderedRect.left+renderedRect.width*.5-rect.left;
    const renderedCenterY=renderedRect.top+renderedRect.height*.5-rect.top;
    const renderedClipped=renderedRect.left<rect.left-0.5||renderedRect.right>rect.right+0.5||renderedRect.top<rect.top-0.5||renderedRect.bottom>rect.bottom+0.5;
    const anchorSurface=atlasPlanetSurfaceForTile(entity.anchorTile.x,entity.anchorTile.y);
    const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||2));
    const roundTrip=geography?.registrationRoundTrip?.(entity.anchorTile.x,entity.anchorTile.y,tileMeters,WORLD_RADIUS_METERS)||null;
    let politicalOwner=null;
    if(["country","region","capital","town"].includes(entity.type))try{politicalOwner=window.PoliticalGeography?.ownerAt?.(activeSeed,entity.anchorTile.x,entity.anchorTile.y)||null;}catch(_){politicalOwner=null;}
    const record=Object.freeze({
      canonicalEntityId:entity.id,entityType:entity.type,displayClass:entity.type==="landmark"?(entity.landmarkType||"landmark"):entity.type,
      authoritativeName:entity.name,authority:entity.authority,currentFocus:Boolean(entity.currentFocus),
      anchorLatitudeDegrees:Number(entity.latitudeDegrees.toFixed(5)),anchorLongitudeDegrees:Number(entity.longitudeDegrees.toFixed(5)),
      anchorWorldTile:entity.anchorTile,resolvedHierarchyIds:identity.ids,identityMatch:identity.identityMatch,
      anchorScreenX:Number(anchor.screenX.toFixed(2)),anchorScreenY:Number(anchor.screenY.toFixed(2)),
      screenX:Number(p.screenX.toFixed(2)),screenY:Number(p.screenY.toFixed(2)),
      placementDx:Number(placed.dx.toFixed(2)),placementDy:Number(placed.dy.toFixed(2)),
      displacementPixels:Number(displacement.toFixed(2)),leaderVisible,
      renderedScreenX:Number(renderedCenterX.toFixed(2)),renderedScreenY:Number(renderedCenterY.toFixed(2)),
      renderedPlacementErrorPixels:Number(Math.hypot(renderedCenterX-p.screenX,renderedCenterY-p.screenY).toFixed(2)),
      renderedClipped,
      planetLand:Boolean(anchorSurface.sample?.land),planetSurfaceClass:String(anchorSurface.sample?.surfaceClass||"unknown"),
      continentId:anchorSurface.sample?.continentId||null,continentName:anchorSurface.sample?.continentName||null,
      politicalOwnerId:politicalOwner?.id||null,parentCountryMatch:entity.type==="capital"?Boolean(politicalOwner?.id&&politicalOwner.id===entity.countryId):null,
      canonicalSpatialCellId:coordinateFabricAuthority()?.cellForTile?.(entity.anchorTile.x,entity.anchorTile.y)?.id||null,
      roundTripErrorTiles:Number(roundTrip?.errorTiles??0),projection:p.mode
    });
    renderedCountsByClass[entity.type]=(renderedCountsByClass[entity.type]||0)+1;
    visible.push(record);if(entity.type==="landmark")visibleLandmarks.push(Object.freeze({id:entity.id,name:entity.name,type:entity.landmarkType||"landmark",latitudeDegrees:record.anchorLatitudeDegrees,longitudeDegrees:record.anchorLongitudeDegrees,screenX:record.screenX,screenY:record.screenY,anchorScreenX:record.anchorScreenX,anchorScreenY:record.anchorScreenY,leaderVisible:record.leaderVisible,leaderStartX:record.anchorScreenX,leaderStartY:record.anchorScreenY,leaderEndX:record.screenX,leaderEndY:record.screenY,displacementPixels:record.displacementPixels,canonicalSpatialCellId:record.canonicalSpatialCellId,projection:record.projection}));
  }
  const orderingSignature=atlasHashText(visible.map(item=>item.canonicalEntityId+"@"+item.screenX.toFixed(1)+","+item.screenY.toFixed(1)).join("|"));
  return {query,visible,visibleLandmarks,hidden,behind,offscreen,occluded,overlap,
    eligibleCountsByClass:Object.freeze({...eligibleCountsByClass}),renderedCountsByClass:Object.freeze({...renderedCountsByClass}),
    hiddenReasons:Object.freeze({...hiddenReasons}),displacedCount:visible.filter(item=>item.displacementPixels>1).length,
    leaderCount:visible.filter(item=>item.leaderVisible).length,orderingSignature,
    viewport:Object.freeze({width:rect.width,height:rect.height})};
}
function geoPointFromViewportGrid(gx,gy,cols,rows,width,height){
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians,cosLat=Math.max(.08,Math.cos(lat0));
  const east=(gx/(cols-1)-.5)*width,north=(.5-gy/(rows-1))*height;
  return Object.freeze({
    latitudeRadians:clamp(lat0+north/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999),
    longitudeRadians:wrapLongitudeRadians(lon0+east/(WORLD_RADIUS_METERS*cosLat))
  });
}
function interpolateGeoPoint(a,b,t){
  const dLon=wrapLongitudeRadians(b.longitudeRadians-a.longitudeRadians);
  return {latitudeRadians:a.latitudeRadians+(b.latitudeRadians-a.latitudeRadians)*t,longitudeRadians:wrapLongitudeRadians(a.longitudeRadians+dLon*t)};
}
function borderSignature(segments){
  let h=2166136261>>>0;
  const rows=segments.map(seg=>{
    const pair=[seg.ownerA,seg.ownerB].sort().join("~");
    const a=seg.aTile,b=seg.bTile;
    return pair+"|"+a.x+","+a.y+"|"+b.x+","+b.y;
  }).sort();
  for(const row of rows)for(const ch of row){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function snapBorderEndpointToNearbyCoast(point){
  if(!point||!geography)return point;
  const tile=point.tile||mapWorldTileAt(point.latitudeRadians,point.longitudeRadians);
  const key=[activeSeed,tile.x,tile.y].join("|");
  if(mapBorderEndpointSnapCache.has(key))return mapBorderEndpointSnapCache.get(key);
  let origin=null;try{origin=geography.sampleLatLon(point.latitudeRadians,point.longitudeRadians);}catch(_){origin=null;}
  if(!origin?.land){mapBorderEndpointSnapCache.set(key,point);return point;}
  const lat0=point.latitudeRadians,lon0=point.longitudeRadians,cosLat=Math.max(.08,Math.cos(lat0));
  let water=null;
  outer:for(const radius of [6000,12000,18000,24000,30000,36000]){
    for(let d=0;d<16;d++){
      const angle=d/16*Math.PI*2,east=Math.cos(angle)*radius,north=Math.sin(angle)*radius;
      const candidate={latitudeRadians:clamp(lat0+north/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999),longitudeRadians:wrapLongitudeRadians(lon0+east/(WORLD_RADIUS_METERS*cosLat))};
      let sample=null;try{sample=geography.sampleLatLon(candidate.latitudeRadians,candidate.longitudeRadians);}catch(_){sample=null;}
      if(!sample?.land){water=candidate;break outer;}
    }
  }
  if(!water){mapBorderEndpointSnapCache.set(key,point);return point;}
  let land={latitudeRadians:point.latitudeRadians,longitudeRadians:point.longitudeRadians},sea=water;
  for(let i=0;i<18;i++){
    const mid=interpolateGeoPoint(land,sea,.5);
    let sample=null;try{sample=geography.sampleLatLon(mid.latitudeRadians,mid.longitudeRadians);}catch(_){sample=null;}
    if(sample?.land)land=mid;else sea=mid;
  }
  const snappedTile=mapWorldTileAt(land.latitudeRadians,land.longitudeRadians);
  const snapped=Object.freeze({latitudeRadians:land.latitudeRadians,longitudeRadians:land.longitudeRadians,tile:Object.freeze({x:String(snappedTile.x),y:String(snappedTile.y)})});
  mapBorderEndpointSnapCache.set(key,snapped);return snapped;
}
function stitchMapBorderSegments(segments){
  const groups=new Map();
  for(const seg of segments){
    const pair=String(seg.stitchKey||[seg.ownerA,seg.ownerB].sort().join("~"));
    if(!groups.has(pair))groups.set(pair,[]);
    groups.get(pair).push(seg);
  }
  const lines=[];
  for(const [pair,group] of groups.entries()){
    const nodes=new Map(),edges=group.map((seg,index)=>({
      index,seg,aKey:seg.aTile.x+","+seg.aTile.y,bKey:seg.bTile.x+","+seg.bTile.y
    }));
    const add=(key,index)=>{if(!nodes.has(key))nodes.set(key,[]);nodes.get(key).push(index);};
    for(const edge of edges){add(edge.aKey,edge.index);add(edge.bKey,edge.index);}
    const unused=new Set(edges.map(edge=>edge.index));
    const pointFor=(edge,key)=>key===edge.aKey?edge.seg.a:edge.seg.b;
    const otherKey=(edge,key)=>key===edge.aKey?edge.bKey:edge.aKey;
    const candidateStarts=()=>[...nodes.entries()]
      .filter(([,indices])=>indices.some(i=>unused.has(i)))
      .sort((a,b)=>{
        const au=a[1].filter(i=>unused.has(i)).length,bu=b[1].filter(i=>unused.has(i)).length;
        return (au===1?0:1)-(bu===1?0:1)||a[0].localeCompare(b[0]);
      });
    while(unused.size){
      const starts=candidateStarts();if(!starts.length)break;
      let currentKey=starts[0][0],guard=0;const points=[];
      while(guard++<group.length+4){
        const options=(nodes.get(currentKey)||[]).filter(i=>unused.has(i)).sort((a,b)=>a-b);
        if(!options.length)break;
        const edge=edges[options[0]];
        if(!points.length)points.push(pointFor(edge,currentKey));
        unused.delete(edge.index);
        currentKey=otherKey(edge,currentKey);
        points.push(pointFor(edge,currentKey));
      }
      if(points.length>=2){
        const first=group[0]||{};
        const firstPoint=points[0],lastPoint=points[points.length-1];
        const closed=String(firstPoint?.tile?.x)===String(lastPoint?.tile?.x)&&String(firstPoint?.tile?.y)===String(lastPoint?.tile?.y);
        if(!closed){
          points[0]=snapBorderEndpointToNearbyCoast(firstPoint);
          points[points.length-1]=snapBorderEndpointToNearbyCoast(lastPoint);
        }
        lines.push(Object.freeze({ownerA:first.ownerA||null,ownerB:first.ownerB||null,points:Object.freeze(points)}));
      }
    }
  }
  return Object.freeze(lines);
}
function buildMapBorderSegments(){
  const policy=currentSemanticLayerPolicy(false),visible=policy.borderClasses.includes("national");
  const empty={segments:[],sampleCount:0,landSampleCount:0,waterSampleCount:0,ownerQueryCount:0,ownerCount:0,worldVertexCount:0,topologySignature:null,waterClippedCount:0,diagnostics:[],graphRevision:null,graphNodeCount:0,graphEdgeCount:0,graphOwnerPairs:[],endpointClassifications:null,focusOwnerId:null,built:false};
  if(!visible||!window.PoliticalGeography?.canonicalBoundaryGraph||!window.PoliticalGeography?.ownerAt)return empty;
  const focusTile=mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  let focusOwnerId=null;
  try{
    const focusSurface=geography?.sampleLatLon?.(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians)||null;
    if(focusSurface?.land)focusOwnerId=String(window.PoliticalGeography.ownerAt(activeSeed,focusTile.x,focusTile.y)?.id||"")||null;
  }catch(_){focusOwnerId=null;}
  if(!focusOwnerId)return empty;
  const started=performance.now();
  let graph=null;try{graph=window.PoliticalGeography.canonicalBoundaryGraph(activeSeed,focusOwnerId);}catch(_){graph=null;}
  if(!graph)return empty;
  const key=[activeSeed,focusOwnerId,graph.revision,graph.signature].join("|");
  if(mapBorderCache.key===key)return {
    segments:mapBorderCache.segments,sampleCount:mapBorderCache.sampleCount,landSampleCount:mapBorderCache.landSampleCount,waterSampleCount:mapBorderCache.waterSampleCount,
    ownerQueryCount:mapBorderCache.ownerQueryCount,ownerCount:mapBorderCache.ownerCount,worldVertexCount:mapBorderCache.worldVertexCount,
    topologySignature:mapBorderCache.topologySignature,waterClippedCount:mapBorderCache.waterClippedCount,diagnostics:mapBorderCache.diagnostics,
    graphRevision:mapBorderCache.graphRevision,graphNodeCount:mapBorderCache.graphNodeCount,graphEdgeCount:mapBorderCache.graphEdgeCount,
    graphOwnerPairs:mapBorderCache.graphOwnerPairs,endpointClassifications:mapBorderCache.endpointClassifications,focusOwnerId,built:false
  };
  const pointFor=point=>{
    const tile=Object.freeze({x:String(point.x),y:String(point.y)}),geo=worldLatLonForTile(tile.x,tile.y);
    return Object.freeze({
      latitudeRadians:geo.latitudeRadians,longitudeRadians:geo.longitudeRadians,tile,
      endpointClassification:String(point.classification||"continuation")
    });
  };
  const segments=graph.edges.map(edge=>{
    const a=pointFor(edge.a),b=pointFor(edge.b);
    return Object.freeze({
      a,b,aTile:a.tile,bTile:b.tile,ownerA:edge.ownerA,ownerB:edge.ownerB,
      stitchKey:"focus:"+focusOwnerId,canonicalEdgeId:edge.id,
      endpointAClass:a.endpointClassification,endpointBClass:b.endpointClassification
    });
  });
  const diagnostics=graph.edges.slice(0,32).map(edge=>Object.freeze({
    canonicalEdgeId:edge.id,ownerPair:Object.freeze([edge.ownerA,edge.ownerB]),
    aTile:Object.freeze({x:edge.a.x,y:edge.a.y}),bTile:Object.freeze({x:edge.b.x,y:edge.b.y}),
    endpointAClass:edge.a.classification,endpointBClass:edge.b.classification,aLand:true,bLand:true
  }));
  mapBorderCache={
    key,segments,sampleCount:graph.sampleCount,landSampleCount:graph.landSampleCount,waterSampleCount:graph.waterSampleCount,
    ownerQueryCount:graph.ownerQueryCount,ownerCount:graph.ownerCount,worldVertexCount:segments.length*2,
    topologySignature:graph.signature,waterClippedCount:graph.waterClippedCount,diagnostics,
    graphRevision:graph.revision,graphNodeCount:graph.nodeCount,graphEdgeCount:graph.edgeCount,
    graphOwnerPairs:graph.ownerPairs,endpointClassifications:graph.endpointClassifications,
    focusOwnerId,builtAtMs:Number((performance.now()-started).toFixed(3))
  };
  return {
    segments,sampleCount:graph.sampleCount,landSampleCount:graph.landSampleCount,waterSampleCount:graph.waterSampleCount,
    ownerQueryCount:graph.ownerQueryCount,ownerCount:graph.ownerCount,worldVertexCount:segments.length*2,
    topologySignature:graph.signature,waterClippedCount:graph.waterClippedCount,diagnostics,
    graphRevision:graph.revision,graphNodeCount:graph.nodeCount,graphEdgeCount:graph.edgeCount,
    graphOwnerPairs:graph.ownerPairs,endpointClassifications:graph.endpointClassifications,focusOwnerId,built:true
  };
}
function borderPathLandSafe(a,b){
  for(const t of [0,.2,.4,.6,.8,1]){
    const point=interpolateGeoPoint(a,b,t);
    let sample=null;try{sample=geography?.sampleLatLon?.(point.latitudeRadians,point.longitudeRadians)||null;}catch(_){sample=null;}
    if(!sample?.land)return false;
  }
  return true;
}
function borderEndpointNearCoast(point){
  if(!point||!geography)return false;
  const lat=Number(point.latitudeRadians)||0,lon=Number(point.longitudeRadians)||0,cosLat=Math.max(.08,Math.cos(lat));
  // Roughly one contour sample spacing. A real land-border endpoint may stop at
  // a coast/lake shore, but an isolated endpoint surrounded by land is a
  // presentation/topology defect and must not be rendered as a dangling stub.
  const radiusMeters=5000;
  const offsets=[[radiusMeters,0],[-radiusMeters,0],[0,radiusMeters],[0,-radiusMeters],
    [radiusMeters*.707,radiusMeters*.707],[-radiusMeters*.707,radiusMeters*.707],
    [radiusMeters*.707,-radiusMeters*.707],[-radiusMeters*.707,-radiusMeters*.707]];
  for(const [east,north] of offsets){
    const sampleLat=clamp(lat+north/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
    const sampleLon=wrapLongitudeRadians(lon+east/(WORLD_RADIUS_METERS*cosLat));
    let sample=null;try{sample=geography.sampleLatLon(sampleLat,sampleLon);}catch(_){sample=null;}
    if(sample&&!sample.land)return true;
  }
  return false;
}
function borderEndpointNearGlobeHorizon(point){
  if(point?.mode!=="globe"||!planet||!cameraEntity)return false;
  const center=planet.getPosition(),cameraPos=cameraEntity.getPosition();
  const nx=Number(point.worldX)-center.x,ny=Number(point.worldY)-center.y,nz=Number(point.worldZ)-center.z;
  const tx=cameraPos.x-Number(point.worldX),ty=cameraPos.y-Number(point.worldY),tz=cameraPos.z-Number(point.worldZ);
  const denom=Math.max(1e-6,Math.hypot(nx,ny,nz)*Math.hypot(tx,ty,tz));
  return (nx*tx+ny*ty+nz*tz)/denom<.12;
}
function borderEndpointJustified(point){
  if(!point)return false;
  if(point.x<=2.5||point.x>=97.5||point.y<=2.5||point.y>=97.5)return true;
  return borderEndpointNearGlobeHorizon(point)||borderEndpointNearCoast(point);
}
function borderRunClosed(run){
  if(!Array.isArray(run)||run.length<3)return false;
  const a=run[0],b=run[run.length-1],latDelta=(Number(a.latitudeRadians)-Number(b.latitudeRadians))*WORLD_RADIUS_METERS;
  const meanLat=(Number(a.latitudeRadians)+Number(b.latitudeRadians))*.5;
  const lonDelta=wrapLongitudeRadians(Number(a.longitudeRadians)-Number(b.longitudeRadians))*WORLD_RADIUS_METERS*Math.max(.08,Math.cos(meanLat));
  return Math.hypot(latDelta,lonDelta)<4000;
}
function borderChainClosed(chain){
  const points=chain?.points||[];if(points.length<3)return false;
  const a=points[0],b=points[points.length-1];
  if(String(a?.tile?.x)===String(b?.tile?.x)&&String(a?.tile?.y)===String(b?.tile?.y))return true;
  const latDelta=(Number(a.latitudeRadians)-Number(b.latitudeRadians))*WORLD_RADIUS_METERS;
  const meanLat=(Number(a.latitudeRadians)+Number(b.latitudeRadians))*.5;
  const lonDelta=wrapLongitudeRadians(Number(a.longitudeRadians)-Number(b.longitudeRadians))*WORLD_RADIUS_METERS*Math.max(.08,Math.cos(meanLat));
  return Math.hypot(latDelta,lonDelta)<4000;
}
function borderChainLengthMeters(chain){
  const points=chain?.points||[];let total=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],latDelta=(Number(b.latitudeRadians)-Number(a.latitudeRadians))*WORLD_RADIUS_METERS;
    const meanLat=(Number(a.latitudeRadians)+Number(b.latitudeRadians))*.5;
    const lonDelta=wrapLongitudeRadians(Number(b.longitudeRadians)-Number(a.longitudeRadians))*WORLD_RADIUS_METERS*Math.max(.08,Math.cos(meanLat));
    total+=Math.hypot(latDelta,lonDelta);
  }
  return total;
}
function semanticLocalLayerDiagnostics(policy){
  const eligibleRoutes=policy.routeClasses.slice(),renderedRoutes=[];
  const tier=String(localStatic?.revealTier||"none"),roadCount=Number(localStatic?.roadCount||0),buildingCount=Number(localStatic?.buildingCount||0);
  const routeTier=new Set(tier==="route"?["primary"]:tier==="coarse"?["primary","secondary"]:["refined","full"].includes(tier)?["primary","secondary","local"]:[]);
  for(const kind of eligibleRoutes)if(roadCount>0&&routeTier.has(kind))renderedRoutes.push(kind);
  const renderedSettlement=[];
  if(policy.settlementLayers.includes("settlement-footprint")&&Number(localStatic?.occupiedAreaCount||0)>0)renderedSettlement.push("settlement-footprint");
  if(policy.settlementLayers.includes("roads")&&roadCount>0)renderedSettlement.push("roads");
  if(policy.settlementLayers.includes("buildings")&&buildingCount>0)renderedSettlement.push("buildings");
  const routeStatus={};for(const kind of eligibleRoutes)routeStatus[kind]=renderedRoutes.includes(kind)?"rendered":(roadCount>0?"presentation-tier-hidden":"authoritative-local-network-not-materialized");
  const settlementStatus={};for(const kind of policy.settlementLayers)settlementStatus[kind]=renderedSettlement.includes(kind)?"rendered":"not-materialized-at-current-focus";
  return Object.freeze({eligibleRouteClasses:Object.freeze(eligibleRoutes),renderedRouteClasses:Object.freeze(renderedRoutes),routeStatus:Object.freeze(routeStatus),
    eligibleSettlementLayers:Object.freeze(policy.settlementLayers.slice()),renderedSettlementLayers:Object.freeze(renderedSettlement),settlementStatus:Object.freeze(settlementStatus),
    roadCount,buildingCount,revealTier:tier});
}
function renderMapPresentation(){
  const layer=ensureMapPresentationDom();if(!layer)return;
  const rect=canvas?.getBoundingClientRect?.(),portrait=(rect?.height||1)>(rect?.width||1),semantic=currentSemanticLayerPolicy(portrait);
  const started=performance.now(),context=mapContextForFocus(),contextKinds=semantic.contextKinds,placeKinds=semantic.placeKinds;
  const centerMarker=gameplayCenterMarkerTelemetry(layer);
  const info=layer.querySelector(".planet-map-context");info.replaceChildren();
  const heading=document.createElement("div");heading.className="planet-map-context-head";heading.innerHTML="<small>WORLD MAP</small><strong></strong>";heading.querySelector("strong").textContent=semantic.displayBand;info.appendChild(heading);
  const names=document.createElement("div");names.className="planet-map-context-names";
  const labels={continent:"CONTINENT",country:"COUNTRY",region:"REGION",city:"CITY",district:"ZONE",village:"VILLAGE"};
  for(const kind of contextKinds){const row=document.createElement("div");row.innerHTML="<span></span><strong></strong>";row.querySelector("span").textContent=labels[kind]||kind.toUpperCase();row.querySelector("strong").textContent=String(context?.[kind]||"—");names.appendChild(row);}info.appendChild(names);

  const border=buildMapBorderSegments(),svg=layer.querySelector(".planet-map-borders");svg.replaceChildren();
  let projectedBorderSegmentCount=0,rejectedInteriorBorderStubCount=0;
  const borderOffsetMeters=Math.max(2,Math.min(24,zoomState.visibleFootprintWidthMeters*.000015));
  const rawBorderLines=stitchMapBorderSegments(border.segments);
  // Canonical political topology is no longer presentation-filtered. Every
  // canonical component is projected; viewport/horizon clipping happens later.
  const borderLines=rawBorderLines;
  const suppressedMinorBorderPolylineCount=0;
  for(const chain of borderLines){
    let run=[];
    const flush=()=>{
      if(run.length<2){run=[];return;}
      const xs=run.map(p=>p.x),ys=run.map(p=>p.y);
      if(Math.max(...xs)<-3||Math.min(...xs)>103||Math.max(...ys)<-3||Math.min(...ys)>103){run=[];return;}
      // Do not declutter, dominance-filter, or reject canonical political
      // components by screen length/endpoints. Those viewport-relative
      // heuristics caused borders to disappear/reappear while the sphere moved.
      // Canonical graph construction has already pruned invalid interior stubs;
      // this layer only performs deterministic world-land clipping + projection.
      const line=document.createElementNS("http://www.w3.org/2000/svg","polyline");
      line.setAttribute("points",run.map(p=>(p.x*10).toFixed(1)+","+(p.y*10).toFixed(1)).join(" "));
      line.setAttribute("class","planet-political-border");
      line.dataset.ownerA=chain.ownerA;line.dataset.ownerB=chain.ownerB;
      svg.appendChild(line);projectedBorderSegmentCount++;run=[];
    };
    const isLandPoint=point=>{
      try{return Boolean(geography?.sampleLatLon?.(point.latitudeRadians,point.longitudeRadians)?.land);}catch(_){return false;}
    };
    const coastBoundary=(landPoint,waterPoint)=>{
      let land=landPoint,water=waterPoint;
      for(let refine=0;refine<14;refine++){
        const mid=interpolateGeoPoint(land,water,.5);
        if(isLandPoint(mid))land=mid;else water=mid;
      }
      return land;
    };
    for(let i=0;i<chain.points.length;i++){
      const point=chain.points[i];
      if(i===0){
        if(isLandPoint(point)){
          const projected=projectGeographicAnchor(point,{surfaceOffsetMeters:borderOffsetMeters,allowOffscreen:true});
          if(projected)run.push(projected);
        }
        continue;
      }
      const previous=chain.points[i-1];
      let samplePoint=previous,sampleLand=isLandPoint(previous);
      for(let step=1;step<=8;step++){
        const densePoint=interpolateGeoPoint(previous,point,step/8),denseLand=isLandPoint(densePoint);
        if(sampleLand&&!denseLand){
          const coast=coastBoundary(samplePoint,densePoint);
          const projected=projectGeographicAnchor(coast,{surfaceOffsetMeters:borderOffsetMeters,allowOffscreen:true});
          if(projected)run.push(projected);
          flush();
        }else if(!sampleLand&&denseLand){
          const coast=coastBoundary(densePoint,samplePoint);
          const coastProjected=projectGeographicAnchor(coast,{surfaceOffsetMeters:borderOffsetMeters,allowOffscreen:true});
          if(coastProjected)run.push(coastProjected);
          const projected=projectGeographicAnchor(densePoint,{surfaceOffsetMeters:borderOffsetMeters,allowOffscreen:true});
          if(projected)run.push(projected);else flush();
        }else if(denseLand){
          const projected=projectGeographicAnchor(densePoint,{surfaceOffsetMeters:borderOffsetMeters,allowOffscreen:true});
          if(projected)run.push(projected);else flush();
        }
        samplePoint=densePoint;sampleLand=denseLand;
      }
    }
    flush();
  }
  svg.hidden=projectedBorderSegmentCount===0;

  const labelsLayer=layer.querySelector(".planet-map-labels");labelsLayer.replaceChildren();
  const spec=semantic,atlas=renderAtlasLabels(labelsLayer,portrait,spec),visible=atlas.visible,visibleLandmarks=atlas.visibleLandmarks;
  const hierarchyVisible=visible.filter(item=>item.entityType!=="landmark"),legacyLabelCount=Math.min(6,hierarchyVisible.length);
  const visibleClasses=Array.from(new Set(visible.map(item=>item.displayClass)));
  const landmarkCandidates=atlas.query.candidates.filter(item=>item.type==="landmark");
  const cityCandidates=atlas.query.candidates.filter(item=>item.type==="city"),cityVisible=visible.filter(item=>item.entityType==="city");
  let cityMinSeparationMeters=null;
  for(let i=0;i<cityCandidates.length;i++)for(let j=i+1;j<cityCandidates.length;j++){
    const delta=canonicalRegisteredDeltaMeters(cityCandidates[i].latitudeRadians,cityCandidates[i].longitudeRadians,cityCandidates[j].latitudeRadians,cityCandidates[j].longitudeRadians);
    const distance=Math.hypot(Number(delta.eastMeters||0),Number(delta.northMeters||0));
    cityMinSeparationMeters=cityMinSeparationMeters==null?distance:Math.min(cityMinSeparationMeters,distance);
  }
  const requiredCitySeparation=Math.max(0,Number(window.WorldStandards?.MIN_CITY_CENTER_DISTANCE_METERS||0));
  const citySpacingPass=cityMinSeparationMeters==null||cityMinSeparationMeters+2>=requiredCitySeparation;
  const maxLandmarkCount=spec.budget;
  const scaleState=scaleStateForScalar(),localLayers=semanticLocalLayerDiagnostics(semantic),ruler=scaleRulerForViewport(zoomState.visibleFootprintWidthMeters,rect?.width||1);
  const scale=layer.querySelector(".planet-scale-ruler");scale.querySelector(".planet-scale-meta strong").textContent=scaleState.label;scale.querySelector(".planet-scale-meta span").textContent=semantic.displayBand;scale.querySelector(".planet-scale-line").style.width=ruler.pixelLength.toFixed(2)+"px";scale.querySelector("small").textContent=formatDistanceMeters(ruler.distanceMeters);
  mapPresentation={
    active:true,context,visibleContextKinds:contextKinds,visiblePlaceKinds:placeKinds,labelCount:legacyLabelCount,
    atlasVisibleLabelCount:visible.length,atlasCandidateCount:atlas.query.candidates.length,atlasQueryCellCount:atlas.query.queryCellCount,
    hiddenHemisphereCulledCount:atlas.hidden,behindCameraCulledCount:atlas.behind,offscreenCulledCount:atlas.offscreen,
    occludedCulledCount:atlas.occluded,overlapRejectedCount:atlas.overlap,visibleLabelClasses:visibleClasses,visibleLabels:visible,
    maxLabelBudget:spec.budget,labelQueryBuildMs:atlas.query.buildMs,
    semanticPolicyId:semantic.id,semanticScaleIndex:semantic.index,semanticScaleLabel:semantic.scaleLabel,semanticDisplayBand:semantic.displayBand,
    semanticRequestedScaleIndex:scaleState.index,semanticHysteresisRatio:SEMANTIC_SCALE_HYSTERESIS_RATIO,semanticHysteresisChanges:semanticScaleState.changes,semanticHysteresisHolds:semanticScaleState.holds,
    semanticEligibleLabelKinds:Object.freeze(semantic.kinds.slice()),semanticClassBudgets:Object.freeze({...semantic.classBudgets}),
    semanticEligibleCountsByClass:atlas.eligibleCountsByClass,semanticRenderedCountsByClass:atlas.renderedCountsByClass,
    semanticHiddenReasonCounts:atlas.hiddenReasons,semanticOrderingSignature:atlas.orderingSignature,semanticDisplacedLabelCount:atlas.displacedCount,semanticLeaderCount:atlas.leaderCount,
    semanticBorderClassesEligible:Object.freeze(semantic.borderClasses.slice()),semanticBorderClassesRendered:Object.freeze(projectedBorderSegmentCount>0&&semantic.borderClasses.includes("national")?["national"]:[]),
    semanticRouteClassesEligible:localLayers.eligibleRouteClasses,semanticRouteClassesRendered:localLayers.renderedRouteClasses,semanticRouteClassStatus:localLayers.routeStatus,
    semanticSettlementLayersEligible:localLayers.eligibleSettlementLayers,semanticSettlementLayersRendered:localLayers.renderedSettlementLayers,semanticSettlementLayerStatus:localLayers.settlementStatus,
    semanticUnsupportedEntityClasses:semantic.unsupportedEntityClasses,semanticPolicySignature:atlasHashText([semantic.id,semantic.kinds.join(","),semantic.borderClasses.join(","),semantic.routeClasses.join(","),semantic.settlementLayers.join(",")].join("|")),
    cityCandidateCount:cityCandidates.length,cityVisibleCount:cityVisible.length,
    cityMinSeparationMeters:cityMinSeparationMeters==null?null:Number(cityMinSeparationMeters.toFixed(3)),citySpacingPass,
    cityQueryCellCount:Number(atlas.query.settlementHierarchy?.diagnostics?.queryCellCount||atlas.query.cityQuery?.tiles?.length||0),cityRequiredMinSeparationMeters:requiredCitySeparation,
    cityVisibleIds:cityVisible.map(item=>item.canonicalEntityId),
    settlementHierarchyRevision:atlas.query.settlementHierarchy?.diagnostics?.revision||null,
    settlementHierarchySignature:atlas.query.settlementHierarchy?.diagnostics?.signature||null,
    settlementHierarchyClassCounts:atlas.query.settlementHierarchy?.diagnostics?.classCounts||{},
    settlementHierarchyQueryCellCount:Number(atlas.query.settlementHierarchy?.diagnostics?.queryCellCount||0),
    settlementHierarchyBounded:atlas.query.settlementHierarchy?atlas.query.settlementHierarchy.diagnostics?.bounded===true:null,
    settlementHierarchyFullWorldScan:atlas.query.settlementHierarchy?atlas.query.settlementHierarchy.diagnostics?.fullWorldScan===true:null,
    landmarkCandidateCount:landmarkCandidates.length,landmarkVisibleCount:visibleLandmarks.length,landmarkKinds:Array.from(new Set(visibleLandmarks.map(item=>item.type))),visibleLandmarks,maxLandmarkCount,
    borderVisible:projectedBorderSegmentCount>0,borderSampleCount:border.sampleCount,borderLandSampleCount:border.landSampleCount,borderWaterSampleCount:border.waterSampleCount,borderOwnerQueryCount:border.ownerQueryCount,borderSegmentCount:border.segments.length,borderWorldVertexCount:border.worldVertexCount,projectedBorderSegmentCount,politicalOwnerCount:border.ownerCount,
    borderTopologySignature:border.topologySignature,borderGraphRevision:border.graphRevision,borderGraphNodeCount:border.graphNodeCount,borderGraphEdgeCount:border.graphEdgeCount,
    borderGraphOwnerPairs:border.graphOwnerPairs,borderEndpointClassifications:border.endpointClassifications,borderFocusOwnerId:border.focusOwnerId,
    waterClippedBorderCount:border.waterClippedCount,borderDiagnostics:border.diagnostics,borderPolylineCount:borderLines.length,rawBorderPolylineCount:rawBorderLines.length,suppressedMinorBorderPolylineCount,rejectedInteriorBorderStubCount,
    maxLabelDisplacementPixels:visible.reduce((max,item)=>Math.max(max,Number(item.displacementPixels||0)),0),
    registrationMaxRoundTripErrorTiles:visible.reduce((max,item)=>Math.max(max,Number(item.roundTripErrorTiles||0)),0),
    projectionMode:projectionState.mode,projectionBlend:Number(projectionState.blend.toFixed(6)),
    scaleDistanceMeters:ruler.distanceMeters,scaleLabel:formatDistanceMeters(ruler.distanceMeters),scaleStateIndex:scaleState.index,scaleStateLabel:scaleState.label,
    scalePixelLength:ruler.pixelLength,metersPerScreenPixel:ruler.metersPerScreenPixel,rulerTruthErrorMeters:ruler.truthErrorMeters,internalZoomScalar:Number(zoomState.scalar.toFixed(6)),
    centerMarker,coordinateFabricRevision:coordinateFabricAuthority()?.revisionSignature||null,
    coordinateFabricStreamedCellIds:coordinateFabricAuthority()?.snapshot?.(mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians))?.streamedCellIds||[],
    updateCount:mapPresentation.updateCount+1,lastUpdateMs:Number((performance.now()-started).toFixed(3)),lastBorderBuildMs:mapBorderCache.builtAtMs,bounded:true,fullWorldScan:false
  };
}
function updateMapPresentation(){if(!root||!canvas||!activeSeed)return;renderMapPresentation();}

function tangentFrame(latitudeRadians,longitudeRadians){
  const fabric=coordinateFabricAuthority(),described=fabric?.describeLatLon?.(latitudeRadians,longitudeRadians);
  if(described?.tangentBasis){
    const basis=described.tangentBasis,planet=described.planetMeters;
    return Object.freeze({
      originMeters:Object.freeze([Number(planet.x.toFixed(3)),Number(planet.y.toFixed(3)),Number(planet.z.toFixed(3))]),
      east:Object.freeze([basis.east.x,basis.east.y,basis.east.z].map(v=>Number(v.toFixed(6)))),
      north:Object.freeze([basis.north.x,basis.north.y,basis.north.z].map(v=>Number(v.toFixed(6)))),
      up:Object.freeze([basis.up.x,basis.up.y,basis.up.z].map(v=>Number(v.toFixed(6))))
    });
  }
  const lat=Number(latitudeRadians)||0,lon=Number(longitudeRadians)||0,cLat=Math.cos(lat),sLat=Math.sin(lat),cLon=Math.cos(lon),sLon=Math.sin(lon);
  const up=[cLat*sLon,sLat,cLat*cLon],east=[cLon,0,-sLon],north=[-sLat*sLon,cLat,-sLat*cLon];
  return Object.freeze({originMeters:Object.freeze(up.map(v=>Number((v*WORLD_RADIUS_METERS).toFixed(3)))),east:Object.freeze(east.map(v=>Number(v.toFixed(6)))),north:Object.freeze(north.map(v=>Number(v.toFixed(6)))),up:Object.freeze(up.map(v=>Number(v.toFixed(6))))});
}
function smoothstep01(value){const t=clamp(value,0,1);return t*t*(3-2*t);}
function projectionHandoffForZoom(value=zoomState.scalar){
  const span=Math.max(.0001,projectionState.transitionEnd-projectionState.transitionStart);
  return smoothstep01((clamp(value,0,1)-projectionState.transitionStart)/span);
}
function projectionPresentationBlendForZoom(value=zoomState.scalar){
  const handoff=projectionHandoffForZoom(value);
  return smoothstep01(clamp((handoff-.18)/.16,0,1));
}
function canonicalSurfaceIdentity(){
  if(!geography)return null;
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians,cosLat=Math.max(.08,Math.cos(lat0));
  const sampleOffset=(eastMeters,northMeters)=>{
    const geo=canonicalLatLonForLocalOffset(lat0,lon0,eastMeters,northMeters),sample=geography.sampleLatLon(geo.latitudeRadians,geo.longitudeRadians);
    return Object.freeze({land:Boolean(sample?.land),surfaceClass:String(sample?.surfaceClass||""),elevationMeters:Number((Number(sample?.elevationMeters||0)).toFixed(2))});
  };
  const ring20km=Object.freeze({north:sampleOffset(0,20000),east:sampleOffset(20000,0),south:sampleOffset(0,-20000),west:sampleOffset(-20000,0)});
  const ring100km=Object.freeze({north:sampleOffset(0,100000),east:sampleOffset(100000,0),south:sampleOffset(0,-100000),west:sampleOffset(-100000,0)});
  const center=sampleOffset(0,0);
  const samples=[center,...Object.values(ring20km),...Object.values(ring100km)];
  const landCount=samples.filter(s=>s.land).length;
  const elevations=samples.map(s=>s.elevationMeters);
  return Object.freeze({
    center,ring20km,ring100km,
    macroDescriptor:Object.freeze({
      landSampleCount:landCount,
      waterSampleCount:samples.length-landCount,
      elevationRangeMeters:Number((Math.max(...elevations)-Math.min(...elevations)).toFixed(2)),
      identitySource:"canonical-geography-samples",
      localLodPreservesMacroIdentity:true
    })
  });
}
function updateProjectionState(){
  const raw=(zoomState.scalar-projectionState.transitionStart)/(projectionState.transitionEnd-projectionState.transitionStart);
  const blend=smoothstep01(raw);
  const frame=tangentFrame(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  projectionState={
    ...projectionState,
    mode:blend<=0?"globe":blend>=1?"local-tangent":"tangent-transition",
    blend,
    tangentOrigin:frame.originMeters,
    basis:Object.freeze({east:frame.east,north:frame.north,up:frame.up}),
    cameraTarget:Object.freeze([0,0,0]),
    continuityErrorMeters:0
  };
}

function clamp(value,min,max){return Math.min(max,Math.max(min,Number(value)||0));}
function loadingNodes(){
  const overlay=root?.querySelector?.(".planet-stage-loading");
  return {overlay,title:overlay?.querySelector?.(".planet-stage-loading-title"),phase:overlay?.querySelector?.(".planet-stage-loading-phase"),bar:overlay?.querySelector?.(".planet-stage-loading-bar"),percent:overlay?.querySelector?.(".planet-stage-loading-percent"),track:overlay?.querySelector?.(".planet-stage-loading-progress")};
}
function presentStartupProgress(){
  const n=loadingNodes();if(!n.overlay)return;
  const p=loadingProof||startupProgress;
  n.overlay.hidden=!loadingProof&&p.mode==="ready";n.overlay.dataset.mode=String(p.mode||"determinate");n.overlay.dataset.phase=String(p.phaseId||"planning");n.overlay.dataset.proof=loadingProof?"true":"false";
  if(n.title)n.title.textContent=String(p.title||((p.mode==="ready")?"World ready":(p.mode==="failed")?"Startup interrupted":"Waking the world"));
  if(n.phase)n.phase.textContent=String(p.phaseLabel||"Preparing world…");
  const value=clamp(p.displayedPercent??p.measuredPercent??0,0,100);
  if(n.bar)n.bar.style.width=value.toFixed(1)+"%";
  if(n.track)n.track.setAttribute("aria-valuenow",String(Math.round(value)));
  if(n.percent)n.percent.textContent=p.mode==="indeterminate"?"Planning startup…":Math.round(value)+"%";
}
function setStartupProgress(phaseId,phaseLabel,percent,mode="determinate"){
  const value=clamp(percent,0,100);
  if(startupProgress.mode==="indeterminate"&&mode!=="indeterminate")startupProgress.determinateAtMs=Date.now();
  const previous=Number(startupProgress.measuredPercent??0);
  const measured=Math.max(previous,value);
  startupProgress={...startupProgress,mode,phaseId:String(phaseId),phaseLabel:String(phaseLabel),measuredPercent:measured,displayedPercent:measured,completedWeightedWork:measured};
  if(measured===100&&!startupProgress.measured100AtMs)startupProgress.measured100AtMs=Date.now();
  presentStartupProgress();
}
function setLoadingProof(mode,phaseId,phaseLabel,percent){
  loadingProof={mode:String(mode||"determinate"),phaseId:String(phaseId||"proof"),phaseLabel:String(phaseLabel||"Preparing world…"),measuredPercent:Number(percent),displayedPercent:Number(percent)};
  presentStartupProgress();return snapshot();
}
function clearLoadingProof(){loadingProof=null;presentStartupProgress();return snapshot();}
function yieldPaint(){startupScheduler.paintHeartbeatCount++;return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}
function yieldBrowser(){
  startupScheduler.yieldCount++;
  return new Promise(resolve=>setTimeout(resolve,0));
}
async function runSlicedRange(total,step){
  startupScheduler.firstPlayableWorkUnits+=total;
  let sliceStarted=performance.now();
  for(let i=0;i<total;i++){    step(i);
    startupScheduler.completedFirstPlayableWorkUnits++;
    const elapsed=performance.now()-sliceStarted;
    if(elapsed>=STARTUP_SLICE_BUDGET_MS&&i+1<total){
      startupScheduler.sliceCount++;
      startupScheduler.maxSliceMs=Math.max(startupScheduler.maxSliceMs,elapsed);
      await yieldBrowser();
      sliceStarted=performance.now();
    }
  }
  const elapsed=performance.now()-sliceStarted;
  startupScheduler.sliceCount++;
  startupScheduler.maxSliceMs=Math.max(startupScheduler.maxSliceMs,elapsed);
}
function beginResponsivenessTelemetry(){
  lastHeartbeatAt=performance.now();
  heartbeatTimer=setInterval(()=>{
    const now=performance.now();
    startupScheduler.maxEventLoopLagMs=Math.max(startupScheduler.maxEventLoopLagMs,Math.max(0,now-lastHeartbeatAt-16));
    startupScheduler.heartbeatCount++;
    lastHeartbeatAt=now;
  },16);
  if("PerformanceObserver" in window){
    try{
      longTaskObserver=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){
          const d=Number(entry.duration)||0;
          startupScheduler.longestLongTaskMs=Math.max(startupScheduler.longestLongTaskMs,d);
          if(d>50)startupScheduler.longTaskOver50++;
          if(d>100)startupScheduler.longTaskOver100++;
          if(d>200)startupScheduler.longTaskOver200++;
          if(controlledWorkActive){
            startupScheduler.controlledLongestLongTaskMs=Math.max(startupScheduler.controlledLongestLongTaskMs,d);
            if(d>50)startupScheduler.controlledLongTaskOver50++;
            if(d>100)startupScheduler.controlledLongTaskOver100++;
            if(d>200)startupScheduler.controlledLongTaskOver200++;
          }
        }
      });
      longTaskObserver.observe({entryTypes:["longtask"]});
    }catch(_){}
  }
}
async function measuredPhase(id,work){
  await yieldBrowser();
  const started=performance.now();
  const result=await work();
  startupScheduler.phaseTimings[id]=Number((performance.now()-started).toFixed(3));
  await yieldBrowser();
  return result;
}
function endResponsivenessTelemetry(){
  if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
  longTaskObserver?.disconnect?.();longTaskObserver=null;
}
function normalizeYaw(value){
  let n=Number(value)||0;
  n%=360;
  if(n<0)n+=360;
  return n;
}
function viewportPixelHeight(){
  const rect=canvas?.getBoundingClientRect?.();
  return Math.max(1,Number(rect?.height||canvas?.height||720));
}
function worldSpaceErrorForLevel(index){
  const level=LOCAL_DETAIL_LEVELS[clamp(Math.round(index),0,LOCAL_DETAIL_LEVELS.length-1)];
  const geometricError=Math.max(.05,Number(level.sampleSpacingMeters||1)*.125);
  // One source texel is the minimum honest texture error. The previous 0.5x
  // factor understated source resolution and kept visibly blocky parents alive.
  const sourceError=Math.max(.05,Number(level.visibleHeightMeters||1)/Math.max(1,Number(level.textureSize||1)));
  return Math.max(geometricError,sourceError);
}
function metersPerScreenPixelForZoom(value=zoomState.scalar){
  return Math.max(.001,presentationTargetHeightMeters(value)/viewportPixelHeight());
}
function projectedPixelErrorForLevel(index,value=zoomState.scalar){
  return worldSpaceErrorForLevel(index)/metersPerScreenPixelForZoom(value);
}
function nativeMagnificationForLevel(index,value=zoomState.scalar){
  const level=LOCAL_DETAIL_LEVELS[clamp(Math.round(index),0,LOCAL_DETAIL_LEVELS.length-1)];
  return Number(level.visibleHeightMeters||1)/Math.max(1,presentationTargetHeightMeters(value));
}
function rawLodIndexForZoom(value){
  for(let index=0;index<LOCAL_DETAIL_LEVELS.length;index++){
    const errorOk=projectedPixelErrorForLevel(index,value)<=SSE_TARGET_PIXELS;
    const nativeScaleOk=nativeMagnificationForLevel(index,value)<=SSE_MAX_NATIVE_MAGNIFICATION;
    if(errorOk&&nativeScaleOk)return index;
  }
  return LOCAL_DETAIL_LEVELS.length-1;
}
function zoomBandFor(value){
  if(value<=SEMANTIC_LOCAL_BAND_START)return (ZOOM_BANDS.find(b=>b.max!==null&&value<=b.max)||ZOOM_BANDS[2]).id;
  return LOCAL_DETAIL_LEVELS[rawLodIndexForZoom(value)].band;
}
function updateZoomFocusFromRotation(){
  // PlayCanvas interprets local Euler angles in XYZ order. For Z=0, the local
  // direction that the rotated sphere places on world +Z is R^T*[0,0,1]:
  // [-sin(yaw), sin(pitch)*cos(yaw), cos(pitch)*cos(yaw)].
  // Convert that exact direction back to the canonical spherical latitude/lon
  // instead of assuming latitude===pitch and longitude===-yaw.
  const pitch=pitchDegrees*Math.PI/180,yaw=yawDegrees*Math.PI/180;
  const x=-Math.sin(yaw),y=Math.sin(pitch)*Math.cos(yaw),z=Math.cos(pitch)*Math.cos(yaw);
  zoomState.focusLatitudeRadians=Math.asin(clamp(y,-1,1));
  zoomState.focusLongitudeRadians=wrapLongitudeRadians(Math.atan2(x,z));
}
function lodHysteresisAt(index){
  const max=levelMaxScalar(index),previousMax=index>0?levelMaxScalar(index-1):projectionState.transitionStart;
  return Math.min(LOCAL_LOD_HYSTERESIS,Math.max(.0005,(max-previousMax)*.2));
}
// Requested LOD follows the zoom scalar (with per-boundary hysteresis). It never
// builds anything by itself; the visible LOD only changes when a prepared
// resource is swapped in.
function requestedLodIndexForZoom(value=zoomState.scalar){
  const levels=LOCAL_DETAIL_LEVELS;
  if(value>=ZOOM_MAX-1e-7)return requestedLodIndex=levels.length-1;
  const rawIndex=rawLodIndexForZoom(value);
  if(!displayResource)return requestedLodIndex=rawIndex;
  // Hysteresis may stabilize only one adjacent LOD boundary. If zoom jumps
  // across multiple physical tiers (for example ground -> local-area), keeping
  // the old fine requested tier would make the ready ground resource stand in
  // at the wrong physical scale until a much coarser threshold is crossed.
  // Multi-tier moves must immediately request the raw target tier.
  if(Math.abs(rawIndex-requestedLodIndex)>1)return requestedLodIndex=rawIndex;
  if(rawIndex>requestedLodIndex){
    // Native-scale safety outranks hysteresis: a coarse tier may be a temporary
    // stand-in while its child prepares, but it may never remain the requested
    // steady-state source once it exceeds the 1.5x native magnification bound.
    if(nativeMagnificationForLevel(requestedLodIndex,value)>SSE_MAX_NATIVE_MAGNIFICATION){
      return requestedLodIndex=rawIndex;
    }
    // Otherwise refine only after the current tier clearly exceeds the pixel
    // error guard, preventing boundary flutter without violating native scale.
    if(projectedPixelErrorForLevel(requestedLodIndex,value)<SSE_REFINE_PIXELS)return requestedLodIndex;
  }else if(rawIndex<requestedLodIndex){
    // Coarsen only once the candidate parent is comfortably below the target.
    if(projectedPixelErrorForLevel(rawIndex,value)>SSE_COARSEN_PIXELS)return requestedLodIndex;
  }
  return requestedLodIndex=rawIndex;
}
function localDetailLevelForZoom(value=zoomState.scalar){return LOCAL_DETAIL_LEVELS[requestedLodIndexForZoom(value)];}
function localPresentationCompensation(value=zoomState.scalar,index=displayResource?.levelIndex??requestedLodIndex){
  const level=LOCAL_DETAIL_LEVELS[index]||LOCAL_DETAIL_LEVELS[0];
  const targetHeight=presentationTargetHeightMeters(value);
  // Values above 1 only occur while a coarser ready LOD stands in for a finer
  // one that is still preparing: it is magnified to the exact target footprint
  // instead of freezing the apparent zoom or popping to an unready tier.
  return clamp(level.visibleHeightMeters/Math.max(1,targetHeight),LOCAL_STANDIN_MIN_COMPENSATION,LOCAL_STANDIN_MAX_MAGNIFICATION);
}
function localTextureSizeForLevel(levelId){
  return Number(LOCAL_DETAIL_LEVELS.find(level=>level.id===levelId)?.textureSize||256);
}
function localTextureAnisotropy(){
  return Math.max(1,Math.min(4,Number(device?.maxAnisotropy||1)));
}
function surfaceDetailBandCount(metersPerTexel){
  const m=Math.max(0,Number(metersPerTexel)||0);
  return (m<=24000?1:0)+(m<=6000?1:0)+(m<=1200?1:0)+(m<=100?1:0)+(m<=30?1:0)+(m<=4?1:0);
}
function seededHash32(label){
  let h=2166136261>>>0;
  for(const ch of String(activeSeed||"")+"|"+String(label||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;h^=h>>>15;
  return h>>>0;
}
function surfaceHash2(ix,iy,salt){
  let h=(Math.imul(ix|0,374761393)^Math.imul(iy|0,668265263)^(salt|0))|0;
  h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;
  return (h>>>0)/4294967295;
}
function surfaceValueNoise(worldEastMeters,worldNorthMeters,scaleMeters,salt){
  const x=worldEastMeters/scaleMeters,y=worldNorthMeters/scaleMeters,x0=Math.floor(x),y0=Math.floor(y),tx=smoothstep01(x-x0),ty=smoothstep01(y-y0);
  const a=surfaceHash2(x0,y0,salt),b=surfaceHash2(x0+1,y0,salt),c=surfaceHash2(x0,y0+1,salt),d=surfaceHash2(x0+1,y0+1,salt);
  return lerp(lerp(a,b,tx),lerp(c,d,tx),ty)-.5;
}
function worldSurfaceDetailValue(worldEastMeters,worldNorthMeters,metersPerTexel,phase){
  const salt=((phase*100000)|0)^0x5f356495;
  let detail=0;
  if(metersPerTexel<=24000)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,32000,salt+11)*.060;
  if(metersPerTexel<=6000)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,9500,salt+29)*.050;
  if(metersPerTexel<=1200)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,2600,salt+47)*.038;
  if(metersPerTexel<=100)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,420,salt+71)*.030;
  if(metersPerTexel<=30)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,95,salt+97)*.022;
  if(metersPerTexel<=4)detail+=surfaceValueNoise(worldEastMeters,worldNorthMeters,24,salt+131)*.014;
  return detail;
}
function patchDimensionsForLevel(index){
  const rect=canvas?.getBoundingClientRect?.(),aspect=Math.max(.35,(rect?.width||1)/(rect?.height||1));
  const levelIndex=clamp(Math.round(index),0,LOCAL_DETAIL_LEVELS.length-1),level=LOCAL_DETAIL_LEVELS[levelIndex];
  const portraitFactor=aspect>=1?1:(82/54);
  const visibleHeight=level.visibleHeightMeters*portraitFactor;
  const visibleWidth=visibleHeight*aspect;
  const patchWidth=visibleWidth*LOCAL_PATCH_MARGIN,patchHeight=visibleHeight*LOCAL_PATCH_MARGIN;
  // Normalize every physical LOD footprint into a bounded presentation mesh.
  const metersPerUnit=Math.max(1,Math.max(patchWidth,patchHeight)/8);
  return {levelIndex,levelId:level.id,band:level.band,visibleWidth,visibleHeight,patchWidth,patchHeight,sampleSpacingMeters:level.sampleSpacingMeters,reliefClampMeters:level.reliefClampMeters,reliefGain:level.reliefGain,maxHeightUnits:level.maxHeightUnits,metersPerUnit,staticWorld:Boolean(level.staticWorld)};
}
// Dimensions of the representation that is actually on screen (the displayed,
// fully prepared resource), with the compensation that maps it to the target
// footprint. Falls back to the requested tier before any resource is ready.
function localPatchDimensions(){
  const dims=displayResource?{...displayResource.dims}:patchDimensionsForLevel(requestedLodIndexForZoom());
  dims.presentationCompensation=localPresentationCompensation(zoomState.scalar,dims.levelIndex);
  return dims;
}
function localDisplayFrame(){
  if(displayResource)return {lat0:displayResource.lat0,lon0:displayResource.lon0,dims:displayResource.dims,groundDetailWeight:displayResource.groundDetailWeight};
  const dims=patchDimensionsForLevel(requestedLodIndexForZoom());
  return {lat0:zoomState.focusLatitudeRadians,lon0:zoomState.focusLongitudeRadians,dims,groundDetailWeight:groundDetailWeightForLevel(dims.levelIndex)};
}
function groundDetailWeightForLevel(index){
  const h=LOCAL_DETAIL_LEVELS[index]?.visibleHeightMeters??GROUND_FOOTPRINT_HEIGHT_METERS;
  return smoothstep01(Math.log(15000/h)/Math.log(15000/GROUND_FOOTPRINT_HEIGHT_METERS));
}
function localHash(eastMeters,northMeters,salt=0){
  const x=Math.floor(eastMeters*.5),z=Math.floor(northMeters*.5),seedSalt=(seededHash32("local-hash")^(salt|0))|0;
  let h=(Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul(seedSalt,2246822519))>>>0;
  h=Math.imul(h^(h>>>13),1274126177)>>>0;return ((h^(h>>>16))>>>0)/4294967295;
}
function localSurfaceSample(registeredEastMeters,registeredNorthMeters,base){
  const salt=((seededUnit("local-ground")*1e9)|0)^0x51f15e;
  const broad=surfaceValueNoise(registeredEastMeters,registeredNorthMeters,34,salt+11)*1.15;
  const medium=surfaceValueNoise(registeredEastMeters,registeredNorthMeters,12,salt+29)*.72;
  const fine=surfaceValueNoise(registeredEastMeters,registeredNorthMeters,4.2,salt+47)*.38;
  const field=(broad+medium+fine)/2.25;
  const land=!!base?.land;
  const microElevation=land?field*5.2:field*.45;
  const baseColor=Array.isArray(base?.color)?base.color:[.18,.32,.22];
  const light=field*.16;
  const high=Number(base?.elevationMeters||0)>2600;
  const color=land
    ? (high
      ? [clamp(.34+light,0,1),clamp(.38+light,0,1),clamp(.30+light*.7,0,1)]
      : [clamp(baseColor[0]*.52+.14+light,0,1),clamp(baseColor[1]*.52+.24+light,0,1),clamp(baseColor[2]*.44+.09+light*.65,0,1)])
    : [clamp(baseColor[0]*.45+.04+light*.15,0,1),clamp(baseColor[1]*.55+.12+light*.2,0,1),clamp(baseColor[2]*.7+.28+light*.28,0,1)];
  return {microElevation,color};
}
function localBiomeCoordinateProof(latitudeRadians,longitudeRadians){
  const tile=mapWorldTileAt(latitudeRadians,longitudeRadians),registered=canonicalRegisteredMetersForLatLon(latitudeRadians,longitudeRadians);
  const sample=geography?.sampleLatLon?.(latitudeRadians,longitudeRadians)||null;
  const local=localSurfaceSample(registered.eastMeters,registered.northMeters,sample);
  const signature="BIO-"+seededHash32([
    tile.x,tile.y,
    Number(registered.eastMeters||0).toFixed(3),Number(registered.northMeters||0).toFixed(3),
    sample?.surfaceClass||"",Number(sample?.elevationMeters||0).toFixed(3),Number(sample?.moisture||0).toFixed(6),Number(sample?.mountainInfluence||0).toFixed(6),
    Number(local.microElevation||0).toFixed(6),(local.color||[]).map(v=>Number(v||0).toFixed(6)).join(",")
  ].join("|")).toString(16).toUpperCase().padStart(8,"0");
  return Object.freeze({
    signature,worldTile:Object.freeze({x:String(tile.x),y:String(tile.y)}),
    registeredMeters:Object.freeze({east:Number(Number(registered.eastMeters||0).toFixed(3)),north:Number(Number(registered.northMeters||0).toFixed(3))}),
    surfaceClass:sample?.surfaceClass||null,land:Boolean(sample?.land),elevationMeters:Number(sample?.elevationMeters||0),
    moisture:Number(sample?.moisture||0),mountainInfluence:Number(sample?.mountainInfluence||0),
    microElevationMeters:Number(Number(local.microElevation||0).toFixed(6)),
    coordinateRevision:coordinateFabricAuthority()?.revisionSignature||null,
    authority:"Campaign-SEED + SeedCoordinateFabric registered coordinates + PlanetGeography"
  });
}
function localGroundHeightUnits(eastMeters,northMeters,frame=localDisplayFrame()){
  const dims=frame.dims,lat0=frame.lat0,lon0=frame.lon0,geo=canonicalLatLonForLocalOffset(lat0,lon0,eastMeters,northMeters);
  const lat=geo.latitudeRadians,lon=geo.longitudeRadians;
  const sample=geography?.sampleLatLon?.(lat,lon),centerElevation=frame.centerElevation??Number(geography?.sampleLatLon?.(lat0,lon0)?.elevationMeters||0);
  const registered=canonicalRegisteredMetersForLatLon(lat,lon),local=localSurfaceSample(registered.eastMeters,registered.northMeters,sample),elevation=Number(sample?.elevationMeters||0);
  const macroDelta=clamp(elevation-centerElevation,-dims.reliefClampMeters,dims.reliefClampMeters);
  const raw=(macroDelta*dims.reliefGain+local.microElevation*.8*frame.groundDetailWeight)/dims.metersPerUnit;
  const ux=eastMeters/dims.patchWidth+.5,vz=northMeters/dims.patchHeight+.5,edge=Math.min(ux,1-ux,vz,1-vz);
  return clamp(raw,-dims.maxHeightUnits,dims.maxHeightUnits)*smoothstep01(clamp(edge/.12,0,1));
}
function localWildernessHashInt(x,y,salt=0){
  const seedSalt=(seededHash32("local-wilderness")^(salt|0))|0;
  let h=(Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(seedSalt,2246822519))>>>0;
  h=Math.imul(h^(h>>>13),1274126177)>>>0;return (h^(h>>>16))>>>0;
}
function localWildernessBiome(sample,nearWater=false){
  if(!sample?.land)return "water";
  if(nearWater||sample.surfaceClass==="coast"||Number(sample.moisture||0)>.68)return "wet";
  if(Number(sample.elevationMeters||0)>1550||Number(sample.mountainInfluence||0)>.22)return "rocky";
  if(Number(sample.moisture||0)>.49)return "wooded";
  return "grassland";
}
function localWildernessFamily(biome,roll){
  const r=clamp(Number(roll)||0,0,.999999);
  // Keep one deterministic global-cell scatter, but give each biome a
  // stronger silhouette vocabulary so terrain identity reads at gameplay zoom.
  if(biome==="rocky")return r<.30?"rock":r<.40?"outcrop":r<.58?"grass":r<.73?"bush":r<.82?"stump":r<.91?"flower":"sapling";
  if(biome==="wet")return r<.38?"reed":r<.52?"bush":r<.68?"driftwood":r<.76?"rock":r<.90?"grass":"flower";
  if(biome==="wooded")return r<.28?"bush":r<.49?"sapling":r<.64?"log":r<.73?"stump":r<.83?"rock":r<.92?"grass":"flower";
  return r<.24?"grass":r<.45?"flower":r<.62?"bush":r<.75?"rock":r<.86?"log":r<.93?"stump":"sapling";
}
function localWildernessSpacing(dims){
  const h=Number(dims?.visibleHeight||dims?.visibleHeightMeters||500);
  // Keep candidate counts bounded without introducing an ordered early-stop
  // band. Each physical LOD gets globally anchored cells large enough that the
  // entire viewport can be scanned and still remain cheap.
  return h<=45?6:h<=90?11:h<=240?32:75;
}
function prepareLocalWildernessPlan(job){
  const started=performance.now(),dims=job?.dims;
  if(!dims?.staticWorld)return null;
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const focus=mapWorldTileAt(job.lat0,job.lon0),centerX=Number(BigInt(focus.x))*tileMeters,centerY=Number(BigInt(focus.y))*tileMeters;
  const spacing=localWildernessSpacing(dims),halfX=dims.patchWidth*.52,halfY=dims.patchHeight*.52;
  const minX=Math.floor((centerX-halfX)/spacing),maxX=Math.ceil((centerX+halfX)/spacing);
  const minY=Math.floor((centerY-halfY)/spacing),maxY=Math.ceil((centerY+halfY)/spacing);
  const raw=[],fauna=[],familyCounts={},biomeCounts={};let candidates=0,rejectedWater=0;
  const salt=((seededUnit("local-wilderness-cells")*0x7fffffff)|0)^0x63d83595;
  const maxStatic=dims.visibleHeight<=90?96:dims.visibleHeight<=240?112:128;
  // Scan the complete bounded patch. The previous ordered early stop filled the
  // budget from one side of the grid, producing the visible horizontal prop
  // band. Global-cell hashes now choose a uniformly distributed bounded subset.
  for(let gy=minY;gy<=maxY;gy++)for(let gx=minX;gx<=maxX;gx++){
    candidates++;const h=localWildernessHashInt(gx,gy,salt),u=(h>>>0)/4294967295;
    const jx=((localWildernessHashInt(gx,gy,salt+17)>>>0)/4294967295-.5)*spacing*.72;
    const jy=((localWildernessHashInt(gx,gy,salt+31)>>>0)/4294967295-.5)*spacing*.72;
    const worldX=(gx+.5)*spacing+jx,worldY=(gy+.5)*spacing+jy,east=worldX-centerX,north=worldY-centerY;
    if(Math.abs(east)>halfX*.965||Math.abs(north)>halfY*.965)continue;
    const tx=String(Math.round(worldX/tileMeters)),ty=String(Math.round(worldY/tileMeters)),geo=worldLatLonForTile(tx,ty);
    const sample=geography?.sampleLatLon?.(geo.latitudeRadians,geo.longitudeRadians);
    if(!sample?.land){rejectedWater++;continue;}
    const probeMeters=Math.max(24,Math.min(56,spacing*2.8)),probe=probeMeters/WORLD_RADIUS_METERS,probeLon=probe/Math.max(.08,Math.cos(geo.latitudeRadians));
    const waterNorthProbe=!geography?.sampleLatLon?.(clamp(geo.latitudeRadians+probe,-Math.PI*.499999,Math.PI*.499999),geo.longitudeRadians)?.land;
    const waterSouthProbe=!geography?.sampleLatLon?.(clamp(geo.latitudeRadians-probe,-Math.PI*.499999,Math.PI*.499999),geo.longitudeRadians)?.land;
    const waterEastProbe=!geography?.sampleLatLon?.(geo.latitudeRadians,wrapLongitudeRadians(geo.longitudeRadians+probeLon))?.land;
    const waterWestProbe=!geography?.sampleLatLon?.(geo.latitudeRadians,wrapLongitudeRadians(geo.longitudeRadians-probeLon))?.land;
    const nearWater=waterNorthProbe||waterSouthProbe||waterEastProbe||waterWestProbe;
    let waterEast=(waterEastProbe?1:0)-(waterWestProbe?1:0),waterNorth=(waterNorthProbe?1:0)-(waterSouthProbe?1:0);
    const waterVectorLength=Math.hypot(waterEast,waterNorth);
    if(waterVectorLength>0){waterEast/=waterVectorLength;waterNorth/=waterVectorLength;}
    const biome=localWildernessBiome(sample,nearWater),density=biome==="wooded"?.76:biome==="wet"?.72:biome==="rocky"?.62:.68;
    if(u>density)continue;
    const roll=(localWildernessHashInt(gx,gy,salt+71)>>>0)/4294967295,family=localWildernessFamily(biome,roll);
    const baseScale=.78+((localWildernessHashInt(gx,gy,salt+93)>>>0)/4294967295)*.62;
    const reliefScale=family==="outcrop"?1.10:(family==="rock"&&biome==="rocky"?1.06:(family==="sapling"&&biome==="wooded"?1.18:(family==="reed"&&biome==="wet"?1.14:1)));
    const closeLod=Number(dims.visibleHeight||dims.visibleHeightMeters||500)<=90;
    const closeReadableScale=closeLod?(biome==="wooded"&&["grass","flower","bush","sapling","log","stump"].includes(family)?1.34:(["grass","flower","bush","sapling","reed"].includes(family)?1.24:1)):1;
    const scale=baseScale*reliefScale*closeReadableScale;
    const rotation=((localWildernessHashInt(gx,gy,salt+109)>>>0)/4294967295)*Math.PI*2;
    const variant=(localWildernessHashInt(gx,gy,salt+131)>>>0)/4294967295;
    const shoreRoll=(localWildernessHashInt(gx,gy,salt+149)>>>0)/4294967295;
    const priority=localWildernessHashInt(gx,gy,salt+191)>>>0;
    const faunaRoll=(localWildernessHashInt(gx,gy,salt+157)>>>0)/4294967295;
    raw.push(Object.freeze({east,north,worldX,worldY,worldTile:Object.freeze({x:tx,y:ty}),family,biome,scale,rotation,variant,priority,faunaRoll,elevationMeters:Number(sample.elevationMeters||0),moisture:Number(sample.moisture||0),mountainInfluence:Number(sample.mountainInfluence||0),nearWater,shoreAccent:nearWater&&shoreRoll<.48,waterEast,waterNorth}));
  }
  raw.sort((a,b)=>a.priority-b.priority||a.worldY-b.worldY||a.worldX-b.worldX);
  const items=raw.slice(0,maxStatic).sort((a,b)=>a.worldY-b.worldY||a.worldX-b.worldX);
  for(const item of items){
    familyCounts[item.family]=(familyCounts[item.family]||0)+1;biomeCounts[item.biome]=(biomeCounts[item.biome]||0)+1;
    if(fauna.length<4&&item.faunaRoll<(item.biome==="wooded"?.085:item.biome==="grassland"?.075:item.biome==="wet"?.06:.025)){
      fauna.push(Object.freeze({...item,kind:item.biome==="wet"?"waterbird":item.biome==="wooded"?"hare":item.biome==="grassland"?"deer":"bird"}));
    }
  }
  const signature="WLD|"+revealHashText([activeSeed,focus.x,focus.y,dims.levelId,spacing,...items.map(x=>x.worldTile.x+","+x.worldTile.y+":"+x.family)].join("|"));
  return Object.freeze({signature,focusTile:focus,spacing,candidates,rejectedWater,items:Object.freeze(items),fauna:Object.freeze(fauna),familyCounts:Object.freeze({...familyCounts}),biomeCounts:Object.freeze({...biomeCounts}),preparationMs:Number((performance.now()-started).toFixed(3)),deterministicGlobalCells:true,fullWorldScan:false});
}
function localWildernessManaged(item,reveal){
  if(!reveal)return {reject:false,road:false};
  const dist=Math.hypot(item.worldX,item.worldY),tileMeters=reveal.tileMeters,ring=Number(window.StartingVillage?.RING_RADIUS_TILES||14)*tileMeters;
  if(dist<Math.max(42,ring+12))return {reject:true,road:false};
  const roadHalf=5.5,axisProtected=(Math.abs(item.worldX)<roadHalf&&Math.abs(item.worldY)<ring+10)||(Math.abs(item.worldY)<roadHalf&&Math.abs(item.worldX)<ring+10);
  const ringProtected=Math.abs(dist-ring)<6.5;
  const dir=window.StartingVillage?.direction?.(activeSeed)||{dx:1,dy:0},along=item.worldX*dir.dx+item.worldY*dir.dy,cross=Math.abs(item.worldX*dir.dy-item.worldY*dir.dx);
  const gatewayProtected=along>ring-5&&along<Number(window.StartingVillage?.GATEWAY_MAINLAND_EDGE_TILES||29)*tileMeters+12&&cross<7;
  if(axisProtected||ringProtected||gatewayProtected)return {reject:true,road:true};
  const transition=smoothstep01((dist-Math.max(42,ring+12))/90);
  const keep=((localWildernessHashInt(Math.round(item.worldX),Math.round(item.worldY),211)>>>0)/4294967295)<(.18+.82*transition);
  return {reject:!keep,road:false};
}
function wildernessColor(family,biome){
  const colors={
    grass:[.27,.50,.12,255],flower:[.88,.38,.10,255],bush:[.10,.31,.07,255],rock:[.34,.33,.30,255],outcrop:[.31,.30,.28,255],
    log:[.26,.13,.05,255],driftwood:[.36,.25,.13,255],stump:[.24,.12,.04,255],sapling:[.13,.39,.08,255],reed:[.30,.44,.11,255]
  };
  const base=colors[family]||[.25,.45,.15,255];
  if(biome==="wet"&&family!=="flower")return [base[0]*.88,Math.min(1,base[1]*1.06),base[2]*.90,255];
  return base;
}
function buildLocalWildernessMesh(plan,frame,reveal){
  if(!plan?.items?.length||!localWildernessEnabled)return {mesh:null,accepted:0,rejectedManaged:0,rejectedRoad:0,shoreAccentCount:0,triangles:0,familyCounts:{},biomeCounts:{}};
  const unit=frame.dims.metersPerUnit,positions=[],normals=[],colors=[],indices=[],familyCounts={},biomeCounts={};let accepted=0,rejectedManaged=0,rejectedRoad=0,shoreAccentCount=0;
  const push=(x,y,z,color)=>{positions.push(x,y,z);normals.push(0,1,0);colors.push(Math.round(color[0]*255),Math.round(color[1]*255),Math.round(color[2]*255),255);return positions.length/3-1;};
  const tri=(a,b,c)=>indices.push(a,b,c);
  const quad=(a,b,c,d)=>{tri(a,b,c);tri(a,c,d);};
  for(const item of plan.items){
    const managed=localWildernessManaged(item,reveal);if(managed.reject){rejectedManaged++;if(managed.road)rejectedRoad++;continue;}
    const x=item.east/unit,z=-item.north/unit,y=localGroundHeightUnits(item.east,item.north,frame)+.012,baseColor=wildernessColor(item.family,item.biome);
    const variant=clamp(Number(item.variant??.5),0,1),tone=.90+variant*.18,color=[clamp(baseColor[0]*tone,0,1),clamp(baseColor[1]*tone,0,1),clamp(baseColor[2]*tone,0,1),255];
    const m=(item.family==="outcrop"?1.48:item.family==="rock"?.76:item.family==="log"||item.family==="driftwood"?1.20:item.family==="sapling"?1.08:item.family==="bush"?.92:item.family==="stump"?.72:.62)*item.scale/unit;
    const h=(item.family==="outcrop"?.88:item.family==="sapling"?4.2:item.family==="reed"?1.75:item.family==="bush"?1.18:item.family==="stump"?.74:item.family==="rock"?.43:item.family==="log"||item.family==="driftwood"?.55:item.family==="flower"?.78:.92)*item.scale/unit;
    const ca=Math.cos(item.rotation),sa=Math.sin(item.rotation);
    if(item.biome==="wet"&&item.shoreAccent&&Math.hypot(Number(item.waterEast||0),Number(item.waterNorth||0))>.1){
      const bx=Number(item.waterEast||0),bz=-Number(item.waterNorth||0),tx=-bz,tz=bx;
      const cx=x+bx*m*.78,cz=z+bz*m*.78,halfLength=m*(2.20+variant*.65),halfDepth=m*.52,py=y+.001;
      const bank=[.08,.25,.18],inner=[.10,.31,.22];
      const a=push(cx-tx*halfLength-bx*halfDepth,py,cz-tz*halfLength-bz*halfDepth,bank);
      const b=push(cx+tx*halfLength-bx*halfDepth,py,cz+tz*halfLength-bz*halfDepth,bank);
      const cc=push(cx+tx*halfLength+bx*halfDepth,py,cz+tz*halfLength+bz*halfDepth,bank);
      const d=push(cx-tx*halfLength+bx*halfDepth,py,cz-tz*halfLength+bz*halfDepth,bank);quad(a,b,cc,d);
      const innerLength=halfLength*.78,innerDepth=halfDepth*.42,icx=cx+bx*halfDepth*.45,icz=cz+bz*halfDepth*.45;
      const ia=push(icx-tx*innerLength-bx*innerDepth,py+.001,icz-tz*innerLength-bz*innerDepth,inner);
      const ib=push(icx+tx*innerLength-bx*innerDepth,py+.001,icz+tz*innerLength-bz*innerDepth,inner);
      const ic=push(icx+tx*innerLength+bx*innerDepth,py+.001,icz+tz*innerLength+bz*innerDepth,inner);
      const id=push(icx-tx*innerLength+bx*innerDepth,py+.001,icz-tz*innerLength+bz*innerDepth,inner);quad(ia,ib,ic,id);
      shoreAccentCount++;
    }
    if(!["grass","flower"].includes(item.family)){
      const patch=item.biome==="wet"?[.07,.20,.17]:item.biome==="rocky"?[.17,.16,.14]:item.biome==="wooded"?[.10,.20,.06]:[.23,.29,.08];
      const pr=m*(item.family==="outcrop"?1.24:1.48),py=y+.002;
      const pa=push(x-pr,py,z,patch),pb=push(x,py,z-pr*.72,patch),pcv=push(x+pr,py,z,patch),pd=push(x,py,z+pr*.72,patch);quad(pa,pb,pcv,pd);
    }
    if(item.family==="rock"||item.family==="outcrop"){
      const ridge=item.family==="outcrop",apexEast=(variant-.5)*m*.58,apexNorth=(.5-variant)*m*.38;
      const a=push(x-m*(1.02+variant*.22),y,z-m*(.58+(1-variant)*.18),color),b=push(x+m*(.86+(1-variant)*.28),y,z-m*(.54+variant*.16),color);
      const c=push(x+m*(.64+variant*.18),y,z+m*(.76+(1-variant)*.24),color),d=push(x-m*(.62+(1-variant)*.22),y,z+m*(.70+variant*.20),color);
      const e=push(x+apexEast,y+h*(.72+variant*.38),z+apexNorth,color);
      tri(a,b,e);tri(b,c,e);tri(c,d,e);tri(d,a,e);quad(a,d,c,b);
      if(ridge){
        // A low secondary lobe follows the deterministic rotation so outcrops
        // read as varied ridge clusters rather than repeated twin pyramids.
        const shade=[color[0]*.86,color[1]*.86,color[2]*.86,255],rm=m*(.46+(1-variant)*.14),rh=h*(.48+variant*.18);
        const ox=ca*m*(.62+variant*.28),oz=sa*m*(.62+variant*.28);
        const aa=push(x+ox-rm,y+.01,z+oz-rm*.50,shade),bb=push(x+ox+rm,y+.01,z+oz-rm*.44,shade);
        const cc=push(x+ox+rm*.60,y+.01,z+oz+rm*.62,shade),dd=push(x+ox-rm*.58,y+.01,z+oz+rm*.58,shade),ee=push(x+ox*.82,y+rh,z+oz*.82,shade);
        tri(aa,bb,ee);tri(bb,cc,ee);tri(cc,dd,ee);tri(dd,aa,ee);quad(aa,dd,cc,bb);
      }
    }else if(item.family==="log"||item.family==="driftwood"){
      const dx=ca*m,dz=sa*m,px=-sa*h*.42,pz=ca*h*.42,top=y+h*.58;
      const a=push(x-dx+px,y,z-dz+pz,color),b=push(x+dx+px,y,z+dz+pz,color),cc=push(x+dx-px,y,z+dz-pz,color),d=push(x-dx-px,y,z-dz-pz,color);
      const e=push(x-dx+px,top,z-dz+pz,color),ff=push(x+dx+px,top,z+dz+pz,color),g=push(x+dx-px,top,z+dz-pz,color),hh=push(x-dx-px,top,z-dz-pz,color);
      quad(a,b,ff,e);quad(b,cc,g,ff);quad(cc,d,hh,g);quad(d,a,e,hh);quad(e,ff,g,hh);
    }else if(item.family==="stump"){
      const a=push(x-m,y,z-m,color),b=push(x+m,y,z-m,color),cc=push(x+m,y,z+m,color),d=push(x-m,y,z+m,color);
      const e=push(x-m*.7,y+h,z-m*.7,color),ff=push(x+m*.7,y+h,z-m*.7,color),g=push(x+m*.7,y+h,z+m*.7,color),hh=push(x-m*.7,y+h,z+m*.7,color);
      quad(a,b,ff,e);quad(b,cc,g,ff);quad(cc,d,hh,g);quad(d,a,e,hh);quad(e,ff,g,hh);
    }else if(item.family==="bush"){
      const top=push(x-m*.18,y+h,z+m*.06,color),bottom=push(x,y+h*.08,z,color),ring=[
        push(x-m,y+h*.48,z,color),push(x,y+h*.48,z-m,color),push(x+m,y+h*.48,z,color),push(x,y+h*.48,z+m,color)
      ];
      for(let k=0;k<4;k++){const n=(k+1)%4;tri(top,ring[k],ring[n]);tri(bottom,ring[n],ring[k]);}
      const side=[color[0]*.88,color[1]*.94,color[2]*.86,255],sm=m*.58,sx=x+m*.46,sz=z-m*.18,st=push(sx,y+h*.78,sz,side),sb=push(sx,y+h*.12,sz,side);
      const sr=[push(sx-sm,y+h*.38,sz,side),push(sx,y+h*.38,sz-sm,side),push(sx+sm,y+h*.38,sz,side),push(sx,y+h*.38,sz+sm,side)];
      for(let k=0;k<4;k++){const n=(k+1)%4;tri(st,sr[k],sr[n]);tri(sb,sr[n],sr[k]);}
    }else if(item.family==="sapling"){
      const trunk=[.31,.18,.07],tw=m*.16,th=h*.58;
      const a=push(x-tw,y,z,trunk),b=push(x+tw,y,z,trunk),cc=push(x+tw,y+th,z,trunk),d=push(x-tw,y+th,z,trunk);quad(a,b,cc,d);
      const e=push(x,y,z-tw,trunk),ff=push(x,y,z+tw,trunk),g=push(x,y+th,z+tw,trunk),hh=push(x,y+th,z-tw,trunk);quad(e,ff,g,hh);
      const cy=y+h*.72,top=push(x,y+h*1.08,z,color),bottom=push(x,cy-h*.22,z,color),ring=[
        push(x-m,cy,z,color),push(x,cy,z-m,color),push(x+m,cy,z,color),push(x,cy,z+m,color)
      ];
      for(let k=0;k<4;k++){const n=(k+1)%4;tri(top,ring[k],ring[n]);tri(bottom,ring[n],ring[k]);}
    }else{
      const stem=item.family==="flower"?[.25,.55,.12]:color,w=m*.28,blades=item.family==="flower"?3:5;
      for(let k=0;k<blades;k++){
        const a=item.rotation+k*Math.PI/blades,dx=Math.cos(a)*w,dz=Math.sin(a)*w,lean=(k-(blades-1)/2)*w*.38;
        const p=push(x-dz,y,z+dx,stem),q=push(x+dz,y,z-dx,stem),r=push(x+lean,y+h*(.78+k*.055),z-lean*.35,stem);tri(p,q,r);
      }
      if(item.family==="flower"){
        const bloom=[.98,.68,.12],center=push(x,y+h,z,bloom),petal=m*.46;
        const p0=push(x-petal,y+h,z,bloom),p1=push(x,y+h+.03,z-petal,bloom),p2=push(x+petal,y+h,z,bloom),p3=push(x,y+h+.03,z+petal,bloom);
        tri(center,p0,p1);tri(center,p1,p2);tri(center,p2,p3);tri(center,p3,p0);
      }
    }
    accepted++;familyCounts[item.family]=(familyCounts[item.family]||0)+1;biomeCounts[item.biome]=(biomeCounts[item.biome]||0)+1;
  }
  if(!indices.length)return {mesh:null,accepted,rejectedManaged,rejectedRoad,shoreAccentCount,triangles:0,familyCounts,biomeCounts};
  // The old wilderness mesh forced every vertex normal straight upward, so
  // rocks, bushes and fauna-adjacent props rendered like flat map symbols.
  // Accumulate real triangle normals while keeping all geometry in one batch.
  normals.fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3;
    const abx=positions[ib]-positions[ia],aby=positions[ib+1]-positions[ia+1],abz=positions[ib+2]-positions[ia+2];
    const acx=positions[ic]-positions[ia],acy=positions[ic+1]-positions[ia+1],acz=positions[ic+2]-positions[ia+2];
    const nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;
    for(const at of [ia,ib,ic]){normals[at]+=nx;normals[at+1]+=ny;normals[at+2]+=nz;}
  }
  for(let i=0;i<normals.length;i+=3){
    normals[i+1]+=.28;
    const len=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;
    normals[i]/=len;normals[i+1]/=len;normals[i+2]/=len;
  }
  const mesh=new pc.Mesh(device);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setColors32(colors);mesh.setIndices(indices);mesh.update();
  return {mesh,accepted,rejectedManaged,rejectedRoad,shoreAccentCount,triangles:indices.length/3,familyCounts,biomeCounts};
}
function buildLocalFaunaMesh(kind,size,unit){
  const positions=[],normals=[],colors=[],indices=[],s=size/unit;
  // Species palettes need enough natural contrast to survive the ground camera
  // and dense biome dressing without becoming UI-like markers.
  const palette=kind==="waterbird"?[.53,.60,.40]:kind==="bird"?[.31,.26,.16]:kind==="hare"?[.69,.43,.18]:[.53,.31,.14];
  const dark=kind==="waterbird"?[.16,.22,.16]:kind==="bird"?[.17,.15,.11]:kind==="hare"?[.22,.11,.05]:[.31,.18,.09];
  const light=kind==="waterbird"?[.98,.95,.76]:kind==="bird"?[.58,.47,.27]:kind==="hare"?[.95,.77,.46]:[.78,.60,.37];
  const push=(x,y,z,color=palette)=>{positions.push(x,y,z);normals.push(0,1,0);colors.push(Math.round(color[0]*255),Math.round(color[1]*255),Math.round(color[2]*255),255);return positions.length/3-1;};
  const tri=(a,b,c)=>indices.push(a,b,c);
  // Reusable rounded low-poly primitive. The old implementation assembled
  // wildlife from rectangular boxes, so even correct behavior read as props.
  // Five latitude bands and eight radial segments keep each animal cheap while
  // giving it a tapered, light-reactive silhouette from the gameplay camera.
  const ellipsoid=(cx,cy,cz,rx,ry,rz,color=palette,segments=8,rings=5)=>{
    const base=positions.length/3;
    for(let ring=0;ring<=rings;ring++){
      const phi=-Math.PI*.5+(ring/rings)*Math.PI,cp=Math.cos(phi),sp=Math.sin(phi);
      for(let segment=0;segment<segments;segment++){
        const theta=(segment/segments)*Math.PI*2;
        push(cx+Math.cos(theta)*cp*rx,cy+sp*ry,cz+Math.sin(theta)*cp*rz,color);
      }
    }
    for(let ring=0;ring<rings;ring++)for(let segment=0;segment<segments;segment++){
      const next=(segment+1)%segments;
      const a=base+ring*segments+segment,b=base+ring*segments+next;
      const d=base+(ring+1)*segments+segment,c=base+(ring+1)*segments+next;
      // Reverse the parametric winding so the outside faces remain front-facing.
      tri(a,c,b);tri(a,d,c);
    }
  };
  const pyramidY=(cx,baseY,cz,rx,rz,height,color=palette)=>{
    const a=push(cx-rx,baseY,cz-rz,color),b=push(cx+rx,baseY,cz-rz,color),c=push(cx+rx,baseY,cz+rz,color),d=push(cx-rx,baseY,cz+rz,color),tip=push(cx,baseY+height,cz,color);
    tri(a,c,b);tri(a,d,c);tri(a,b,tip);tri(b,c,tip);tri(c,d,tip);tri(d,a,tip);
  };
  const pyramidX=(baseX,cy,cz,ry,rz,length,color=palette)=>{
    const a=push(baseX,cy-ry,cz-rz,color),b=push(baseX,cy+ry,cz-rz,color),c=push(baseX,cy+ry,cz+rz,color),d=push(baseX,cy-ry,cz+rz,color),tip=push(baseX+length,cy,cz,color);
    tri(a,b,c);tri(a,c,d);tri(a,tip,b);tri(b,tip,c);tri(c,tip,d);tri(d,tip,a);
  };
  if(kind==="deer"){
    // Compact torso + distinct neck/head/muzzle keeps the top-down silhouette
    // cervid-shaped instead of reading as a long capsule.
    ellipsoid(-s*.10,s*.70,0,s*.55,s*.30,s*.28,palette,10,5);
    ellipsoid(s*.32,s*.95,0,s*.19,s*.38,s*.18,dark,8,5);
    ellipsoid(s*.55,s*1.20,0,s*.27,s*.21,s*.21,palette,8,5);
    ellipsoid(s*.77,s*1.16,0,s*.19,s*.12,s*.13,dark,8,4);
    for(const x of [-s*.36,s*.28])for(const z of [-s*.17,s*.17])ellipsoid(x,s*.29,z,s*.060,s*.28,s*.055,dark,6,4);
    pyramidY(s*.51,s*1.35,-s*.12,s*.075,s*.050,s*.22,dark);
    pyramidY(s*.51,s*1.35,s*.12,s*.075,s*.050,s*.22,dark);
    ellipsoid(-s*.61,s*.75,0,s*.16,s*.09,s*.09,light,6,4);
  }else if(kind==="hare"){
    // Keep the same restrained physical envelope, but put the defining features
    // into the camera-visible X/Z footprint. Vertical ears collapsed into the
    // near-top-down view and made the animal read as a small brown pebble.
    ellipsoid(-s*.12,s*.43,0,s*.50,s*.27,s*.31,palette,9,5);
    ellipsoid(s*.28,s*.58,0,s*.27,s*.22,s*.23,light,8,5);
    // Two long plan-view ears carry bright outer mass plus a narrow dark inner
    // stripe. The two-tone treatment remains part of the same merged mesh and
    // reads as ears even before flee motion, without increasing the actor envelope.
    pyramidX(s*.31,s*.66,-s*.15,s*.070,s*.055,s*.49,light);
    pyramidX(s*.31,s*.66,s*.15,s*.070,s*.055,s*.49,light);
    pyramidX(s*.36,s*.725,-s*.15,s*.018,s*.022,s*.36,dark);
    pyramidX(s*.36,s*.725,s*.15,s*.018,s*.022,s*.36,dark);
    ellipsoid(s*.50,s*.58,0,s*.075,s*.050,s*.060,dark,6,4);
    // Broad rear feet and white tail keep the front/back axis readable during flee.
    ellipsoid(-s*.39,s*.20,-s*.20,s*.28,s*.10,s*.12,dark,6,4);
    ellipsoid(-s*.39,s*.20,s*.20,s*.28,s*.10,s*.12,dark,6,4);
    ellipsoid(-s*.58,s*.45,0,s*.15,s*.14,s*.15,[.95,.90,.78],7,4);
  }else{
    const water=kind==="waterbird";
    ellipsoid(-s*.06,s*.47,0,s*(water?.45:.42),s*(water?.20:.22),s*(water?.25:.28),palette,9,5);
    if(water){
      // Waterbirds need a horizontal neck/head axis: a mostly vertical neck is
      // nearly invisible from the gameplay camera. These merged light forms stay
      // within the prior body envelope but create a clear directional silhouette.
      ellipsoid(s*.28,s*.56,0,s*.29,s*.080,s*.075,light,8,4);
      ellipsoid(s*.53,s*.59,0,s*.16,s*.15,s*.15,light,8,4);
      pyramidX(s*.64,s*.58,0,s*.055,s*.075,s*.28,[.78,.50,.10]);
    }else{
      ellipsoid(s*.39,s*.59,0,s*.18,s*.18,s*.18,light,8,4);
      pyramidX(s*.53,s*.58,0,s*.07,s*.095,s*.28,[.66,.49,.20]);
    }
    // Dark, attached wings widen the plan-view body without increasing actor size.
    // Move their visual centers slightly outward and add a slim light shoulder
    // seam so the idle bird keeps two readable wing lobes against wet terrain.
    ellipsoid(-s*.12,s*.51,-s*.23,s*.34,s*.055,s*.27,dark,8,4);
    ellipsoid(-s*.12,s*.51,s*.23,s*.34,s*.055,s*.27,dark,8,4);
    if(water){
      ellipsoid(-s*.02,s*.565,-s*.17,s*.24,s*.030,s*.055,light,7,3);
      ellipsoid(-s*.02,s*.565,s*.17,s*.24,s*.030,s*.055,light,7,3);
    }
    pyramidX(-s*.33,s*.46,0,s*.070,s*.15,-s*.28,dark);
    if(water){
      ellipsoid(-s*.12,s*.20,-s*.105,s*.045,s*.22,s*.045,[.43,.28,.12],6,4);
      ellipsoid(-s*.12,s*.20,s*.105,s*.045,s*.22,s*.045,[.43,.28,.12],6,4);
    }
  }
  normals.fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3;
    const abx=positions[ib]-positions[ia],aby=positions[ib+1]-positions[ia+1],abz=positions[ib+2]-positions[ia+2];
    const acx=positions[ic]-positions[ia],acy=positions[ic+1]-positions[ia+1],acz=positions[ic+2]-positions[ia+2];
    const nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;
    for(const at of [ia,ib,ic]){normals[at]+=nx;normals[at+1]+=ny;normals[at+2]+=nz;}
  }
  for(let i=0;i<normals.length;i+=3){const len=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;normals[i]/=len;normals[i+1]/=len;normals[i+2]/=len;}
  const mesh=new pc.Mesh(device);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setColors32(colors);mesh.setIndices(indices);mesh.update();
  return {mesh,triangles:indices.length/3};
}
function clearLocalFauna(){
  rememberLocalFaunaActors();
  for(const actor of localFaunaActors)actor.mesh?.destroy?.();
  localFaunaActors=[];localFaunaRoot?.destroy?.();localFaunaRoot=null;
  wildlifeReaction={...wildlifeReaction,activeActorCount:0,visibleActorCount:0,reactingActorCount:0,sleepingActorCount:0,spatialBucketCount:0,stateCounts:{idle:0,flee:0,takeoff:0,return:0,sleep:0}};
}
function localFaunaKey(item){
  return String(activeSeed||"seed")+"|"+String(item?.kind||"fauna")+"|"+String(item?.worldTile?.x??"?")+"|"+String(item?.worldTile?.y??"?");
}
function localFaunaWrappedEastDelta(fromEast,toEast){
  const period=Math.PI*2*WORLD_RADIUS_METERS,half=period*.5;
  let d=Number(toEast||0)-Number(fromEast||0);
  if(d>half)d-=period;else if(d<-half)d+=period;
  return d;
}
function localFaunaPresenceMeters(){
  const p=canonicalRegisteredMetersForLatLon(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  return {east:Number(p?.eastMeters||0),north:Number(p?.northMeters||0)};
}
function pruneLocalFaunaReactionMemory(now=performance.now()){
  for(const [key,value] of localFaunaReactionMemory)if(Number(value?.expiresAt||0)<=now)localFaunaReactionMemory.delete(key);
  while(localFaunaReactionMemory.size>LOCAL_FAUNA_MEMORY_LIMIT)localFaunaReactionMemory.delete(localFaunaReactionMemory.keys().next().value);
}
function rememberLocalFaunaActor(actor,now=performance.now()){
  if(!actor?.id)return;
  localFaunaReactionMemory.delete(actor.id);
  localFaunaReactionMemory.set(actor.id,{
    currentWorldX:Number(actor.currentWorldX||actor.homeWorldX||0),currentWorldY:Number(actor.currentWorldY||actor.homeWorldY||0),
    altitudeMeters:Number(actor.altitudeMeters||0),state:String(actor.state||"idle"),
    reactionRemaining:Number(actor.reactionRemaining||0),cooldownUntil:Number(actor.cooldownUntil||0),
    fleeEast:Number(actor.fleeEast||0),fleeNorth:Number(actor.fleeNorth||0),expiresAt:now+LOCAL_FAUNA_MEMORY_TTL_MS
  });
  pruneLocalFaunaReactionMemory(now);
}
function rememberLocalFaunaActors(){
  const now=performance.now();for(const actor of localFaunaActors)rememberLocalFaunaActor(actor,now);
}
function rebuildLocalFauna(plan,frame,reveal){
  clearLocalFauna();
  if(!localWildernessEnabled||!plan?.fauna?.length||!tangentPatch)return 0;
  pruneLocalFaunaReactionMemory();
  localFaunaRoot=new pc.Entity("LocalAmbientFauna");tangentPatch.addChild(localFaunaRoot);
  const unit=frame.dims.metersPerUnit;
  for(const item of plan.fauna){
    if(localFaunaActors.length>=4||localWildernessManaged(item,reveal).reject)continue;
    // Fauna identity/position comes from the canonical wilderness item, but its
    // physical body size must not inherit that item's unrelated prop-family
    // scale (a deer spawned from a large prop candidate became huge while a hare
    // from a grass candidate became tiny). Use restrained species metres plus a
    // deterministic mild variation from the existing canonical item variant.
    const y=localGroundHeightUnits(item.east,item.north,frame),variation=.92+clamp(Number(item.variant||0),0,1)*.16;
    // Keep deer restrained; use plausible large-hare / goose-sized envelopes
    // for the two species that were sub-pixel/near-sub-pixel in phone evidence.
    // Identity and variation remain canonical and unchanged.
    const size=(item.kind==="deer"?1.15:item.kind==="waterbird"?.92:item.kind==="bird"?.50:.78)*variation;
    const built=buildLocalFaunaMesh(item.kind,size,unit),actorEntity=new pc.Entity("AmbientFauna-"+item.kind+"-"+localFaunaActors.length);localFaunaRoot.addChild(actorEntity);
    actorEntity.addComponent("render",{type:"asset",castShadows:true,receiveShadows:true});actorEntity.render.meshInstances=[new pc.MeshInstance(built.mesh,localStaticMaterials.fauna,actorEntity)];
    const id=localFaunaKey(item),memory=localFaunaReactionMemory.get(id)||null;
    const resourceCenterX=Number(item.worldX||0)-Number(item.east||0),resourceCenterY=Number(item.worldY||0)-Number(item.north||0);
    const currentWorldX=memory?Number(memory.currentWorldX):Number(item.worldX||0),currentWorldY=memory?Number(memory.currentWorldY):Number(item.worldY||0);
    const east=localFaunaWrappedEastDelta(resourceCenterX,currentWorldX),north=currentWorldY-resourceCenterY;
    actorEntity.setLocalPosition(east/unit,y+Number(memory?.altitudeMeters||0)/unit,-north/unit);
    localFaunaActors.push({
      id,entity:actorEntity,mesh:built.mesh,triangles:built.triangles,kind:item.kind,phase:item.rotation,frame,unit,
      worldTile:Object.freeze({x:String(item.worldTile.x),y:String(item.worldTile.y)}),
      homeWorldX:Number(item.worldX||0),homeWorldY:Number(item.worldY||0),resourceCenterX,resourceCenterY,
      currentWorldX,currentWorldY,altitudeMeters:Number(memory?.altitudeMeters||0),
      state:String(memory?.state||"idle"),reactionRemaining:Number(memory?.reactionRemaining||0),cooldownUntil:Number(memory?.cooldownUntil||0),
      fleeEast:Number(memory?.fleeEast||0),fleeNorth:Number(memory?.fleeNorth||0),
      idleRadiusMeters:item.kind==="bird"?.72:item.kind==="waterbird"?.55:item.kind==="hare"?.42:.48,
      lastDistanceMeters:null,lastRenderedEastMeters:east,lastRenderedNorthMeters:north,sleeping:false
    });
  }
  wildlifeReaction={...wildlifeReaction,activeActorCount:localFaunaActors.length};
  return localFaunaActors.length;
}
function localFaunaReactionStateCounts(){
  const counts={idle:0,flee:0,takeoff:0,return:0,sleep:0};
  for(const actor of localFaunaActors){
    if(actor.sleeping)counts.sleep++;
    else if(Object.hasOwn(counts,actor.state))counts[actor.state]++;
    else counts.idle++;
  }
  return counts;
}
function tickLocalFaunaReactionTriggers(){
  if(!wildlifeReaction.enabled||!localFaunaActors.length)return;
  const started=performance.now(),presence=localFaunaPresenceMeters(),lastEast=wildlifeReaction.lastPresenceEastMeters,lastNorth=wildlifeReaction.lastPresenceNorthMeters;
  const moved=lastEast===null||lastNorth===null?0:Math.hypot(localFaunaWrappedEastDelta(lastEast,presence.east),presence.north-lastNorth);
  const buckets=new Map(),bucketMeters=LOCAL_FAUNA_BUCKET_METERS;
  for(const actor of localFaunaActors){
    const dx=localFaunaWrappedEastDelta(presence.east,actor.currentWorldX),dy=actor.currentWorldY-presence.north;
    const key=Math.floor(dx/bucketMeters)+","+Math.floor(dy/bucketMeters);
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(actor);
  }
  const maxTrigger=Math.max(...Object.values(LOCAL_FAUNA_SPECS).map(x=>x.triggerMeters)),ring=Math.ceil(maxTrigger/bucketMeters),nearby=new Set();
  for(let by=-ring;by<=ring;by++)for(let bx=-ring;bx<=ring;bx++){
    const list=buckets.get(bx+","+by);if(list)for(const actor of list)nearby.add(actor);
  }
  let checks=0,triggers=0,lastActor=null,lastKind=null;
  const triggerByKind={...wildlifeReaction.triggerByKind};
  const now=performance.now();
  if(moved>=.6){
    for(const actor of nearby){
      if(actor.sleeping||actor.state!=="idle"||now<Number(actor.cooldownUntil||0))continue;
      const spec=LOCAL_FAUNA_SPECS[actor.kind]||LOCAL_FAUNA_SPECS.deer;
      const dx=localFaunaWrappedEastDelta(presence.east,actor.currentWorldX),dy=actor.currentWorldY-presence.north,distance=Math.hypot(dx,dy);checks++;
      actor.lastDistanceMeters=distance;
      if(distance>spec.triggerMeters)continue;
      const fallback=Number(actor.phase||0),len=Math.max(.001,distance);
      actor.fleeEast=distance<.15?Math.cos(fallback):dx/len;
      actor.fleeNorth=distance<.15?Math.sin(fallback):dy/len;
      actor.state=spec.maxAltitudeMeters>0?"takeoff":"flee";
      actor.reactionRemaining=spec.reactionSeconds;
      actor.cooldownUntil=now+(spec.reactionSeconds+1.25)*1000;
      triggers++;lastActor=actor.id;lastKind=actor.kind;
      triggerByKind[actor.kind]=Number(triggerByKind[actor.kind]||0)+1;
      rememberLocalFaunaActor(actor,now);
    }
  }
  wildlifeReaction={...wildlifeReaction,lastPresenceEastMeters:presence.east,lastPresenceNorthMeters:presence.north,presenceMoveMeters:Number(moved.toFixed(3)),
    spatialBucketCount:buckets.size,proximityChecks:wildlifeReaction.proximityChecks+checks,triggerCount:wildlifeReaction.triggerCount+triggers,
    triggerByKind,lastTriggerActorId:lastActor||wildlifeReaction.lastTriggerActorId,lastTriggerKind:lastKind||wildlifeReaction.lastTriggerKind,
    lastUpdateMs:Number((performance.now()-started).toFixed(4)),maxUpdateMs:Math.max(Number(wildlifeReaction.maxUpdateMs||0),Number((performance.now()-started).toFixed(4)))};
}
function updateLocalFaunaMotion(step){
  if(!localFaunaActors.length){
    wildlifeReaction={...wildlifeReaction,activeActorCount:0,visibleActorCount:0,reactingActorCount:0,sleepingActorCount:0,stateCounts:{idle:0,flee:0,takeoff:0,return:0,sleep:0}};
    return;
  }
  const presence=localFaunaPresenceMeters(),visibleHeight=Math.max(36,Number(zoomState.visibleFootprintHeightMeters||80)),sleepRadius=Math.max(60,Math.min(220,visibleHeight*1.15));
  let visible=0,reacting=0,sleeping=0;
  for(const actor of localFaunaActors){
    const spec=LOCAL_FAUNA_SPECS[actor.kind]||LOCAL_FAUNA_SPECS.deer;
    const pdx=localFaunaWrappedEastDelta(presence.east,actor.currentWorldX),pdy=actor.currentWorldY-presence.north,pdist=Math.hypot(pdx,pdy);
    const shouldSleep=pdist>sleepRadius*(actor.state==="idle"?1:1.35);
    actor.sleeping=shouldSleep;actor.entity.enabled=!shouldSleep;
    if(shouldSleep){sleeping++;continue;}visible++;
    if(actor.state==="flee"||actor.state==="takeoff"){
      actor.currentWorldX+=actor.fleeEast*spec.speedMetersPerSecond*step;
      actor.currentWorldY+=actor.fleeNorth*spec.speedMetersPerSecond*step;
      actor.reactionRemaining=Math.max(0,Number(actor.reactionRemaining||0)-step);
      if(spec.maxAltitudeMeters>0)actor.altitudeMeters=Math.min(spec.maxAltitudeMeters,actor.altitudeMeters+spec.maxAltitudeMeters*.95*step);
      reacting++;
      if(actor.reactionRemaining<=0)actor.state="return";
    }else if(actor.state==="return"){
      const dx=localFaunaWrappedEastDelta(actor.currentWorldX,actor.homeWorldX),dy=actor.homeWorldY-actor.currentWorldY,dist=Math.hypot(dx,dy);
      if(dist>.05){
        const travel=Math.min(dist,spec.returnSpeedMetersPerSecond*step);actor.currentWorldX+=dx/dist*travel;actor.currentWorldY+=dy/dist*travel;
      }
      if(spec.maxAltitudeMeters>0)actor.altitudeMeters=Math.max(0,actor.altitudeMeters-spec.maxAltitudeMeters*.72*step);
      if(dist<=.35&&actor.altitudeMeters<=.08){actor.currentWorldX=actor.homeWorldX;actor.currentWorldY=actor.homeWorldY;actor.altitudeMeters=0;actor.state="idle";}
    }
    const t=localFaunaClock*.65+actor.phase;
    const idle=actor.state==="idle";
    const idleEast=idle?Math.sin(t)*actor.idleRadiusMeters:0,idleNorth=idle?Math.cos(t*.73)*actor.idleRadiusMeters*.65:0;
    const renderWorldX=actor.currentWorldX+idleEast,renderWorldY=actor.currentWorldY+idleNorth;
    const east=localFaunaWrappedEastDelta(actor.resourceCenterX,renderWorldX),north=renderWorldY-actor.resourceCenterY;
    const ground=localGroundHeightUnits(east,north,actor.frame),bob=idle?Math.abs(Math.sin(t*1.8))*actor.idleRadiusMeters*.10/actor.unit:
      (actor.state==="takeoff"?Math.sin(localFaunaClock*12+actor.phase)*.10:0);
    actor.entity.setLocalPosition(east/actor.unit,ground+actor.altitudeMeters/actor.unit+bob,-north/actor.unit);
    const heading=actor.state==="flee"||actor.state==="takeoff"?Math.atan2(actor.fleeEast,actor.fleeNorth)*180/Math.PI:(t*35)%360;
    const reactionLean=actor.state==="flee"?-7:(actor.state==="takeoff"?-12:0);
    actor.entity.setLocalEulerAngles(reactionLean,heading,0);
    actor.lastRenderedEastMeters=east;actor.lastRenderedNorthMeters=north;actor.lastDistanceMeters=pdist;
  }
  wildlifeReaction={...wildlifeReaction,activeActorCount:localFaunaActors.length,visibleActorCount:visible,reactingActorCount:reacting,sleepingActorCount:sleeping,stateCounts:localFaunaReactionStateCounts(),updateCount:wildlifeReaction.updateCount+1};
}
function localFaunaActorSnapshot(actor){
  return Object.freeze({id:actor.id,kind:actor.kind,state:actor.sleeping?"sleep":actor.state,worldTile:actor.worldTile,
    homeWorldMeters:Object.freeze({east:Number(actor.homeWorldX.toFixed(3)),north:Number(actor.homeWorldY.toFixed(3))}),
    currentWorldMeters:Object.freeze({east:Number(actor.currentWorldX.toFixed(3)),north:Number(actor.currentWorldY.toFixed(3))}),
    altitudeMeters:Number(actor.altitudeMeters.toFixed(3)),distanceToPresenceMeters:actor.lastDistanceMeters===null?null:Number(actor.lastDistanceMeters.toFixed(3)),
    visible:Boolean(actor.entity?.enabled),reactionRemaining:Number(Number(actor.reactionRemaining||0).toFixed(3))});
}
function renderLocalWilderness(resource,frame,reveal){
  const plan=resource?.wildernessPlan;
  wilderness={...wilderness,localEnabled:localWildernessEnabled,localActive:false,localSignature:plan?.signature||null,localLevel:resource?.dims?.levelId||null,localBiome:null,localCandidateCount:Number(plan?.candidates||0),localAcceptedStaticProps:0,localAmbientFaunaActiveCount:0,localShoreAccentCount:0,localRejectedWater:Number(plan?.rejectedWater||0),localRejectedManaged:0,localRejectedRoad:0,localFamilyCounts:{},localBiomeCounts:{},localDrawCalls:0,localTriangles:0,localPreparationMs:Number(plan?.preparationMs||0),localPlanCached:Boolean(plan),localLayoutSignature:plan?.signature||null,localFullWorldScan:false,localDeterministicGlobalCells:true};
  if(!plan||!localWildernessEnabled){rebuildLocalFauna(null,frame,reveal);return {accepted:0,triangles:0,drawCalls:0,fauna:0};}
  ensureLocalStaticMaterials();
  const built=buildLocalWildernessMesh(plan,frame,reveal);let drawCalls=0;
  if(built.mesh){
    const entity=new pc.Entity("LocalWildernessBatch");entity.addComponent("render",{type:"asset",castShadows:true,receiveShadows:true});
    entity.render.meshInstances=[new pc.MeshInstance(built.mesh,localStaticMaterials.wilderness,entity)];localStaticRoot.addChild(entity);drawCalls=1;
  }
  const fauna=rebuildLocalFauna(plan,frame,reveal),faunaTriangles=localFaunaActors.reduce((sum,item)=>sum+Number(item.triangles||0),0),dominant=Object.entries(built.biomeCounts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||null;
  wilderness={...wilderness,localActive:built.accepted>0,localBiome:dominant,localAcceptedStaticProps:built.accepted,localAmbientFaunaActiveCount:fauna,localShoreAccentCount:Number(built.shoreAccentCount||0),localRejectedManaged:built.rejectedManaged,localRejectedRoad:built.rejectedRoad,localFamilyCounts:{...built.familyCounts},localBiomeCounts:{...built.biomeCounts},localDrawCalls:drawCalls+fauna,localTriangles:built.triangles+faunaTriangles};
  return {accepted:built.accepted,triangles:built.triangles+faunaTriangles,drawCalls:drawCalls+fauna,fauna};
}

function environmentReactionPhoneProfile(){
  const rect=canvas?.getBoundingClientRect?.();
  return Math.min(Number(rect?.width||9999),Number(rect?.height||9999))<=480;
}
function environmentReactionSurfaceKind(surfaceType){
  const type=String(surfaceType||"").toLowerCase();
  if(["road","path","square","bridge","dirt"].includes(type))return "dust";
  if(type==="grass")return "grassBend";
  if(type==="farmland")return "footprint";
  return null;
}
function environmentReactionTexture(kind){
  const size=128,canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext("2d",{alpha:true});
  if(!ctx)throw new Error("Environmental reaction texture context unavailable");
  ctx.clearRect(0,0,size,size);
  if(kind==="dust"){
    const lobes=[
      [62,64,47,.86],[43,70,31,.56],[83,58,35,.62],[58,44,28,.46],[75,78,26,.42]
    ];
    for(const l of lobes){
      // Flatten each radial lobe into an irregular low ellipse so three pooled
      // puffs combine as a short road-surface cloud instead of a round marker.
      ctx.save();ctx.translate(l[0],l[1]);ctx.scale(1.08,.52);
      const g=ctx.createRadialGradient(0,0,2,0,0,l[2]);
      g.addColorStop(0,`rgba(255,255,255,${l[3]})`);
      g.addColorStop(.34,`rgba(255,255,255,${l[3]*.82})`);
      g.addColorStop(.72,`rgba(255,255,255,${l[3]*.30})`);
      g.addColorStop(1,"rgba(255,255,255,0)");
      ctx.fillStyle=g;ctx.fillRect(-l[2],-l[2],l[2]*2,l[2]*2);ctx.restore();
    }
  }else{
    const strands=[
      [24,81,43,67,64,56,86,55,5.2,.78],
      [18,72,37,63,58,60,78,64,3.6,.66],
      [34,91,48,75,67,66,95,62,4.2,.76],
      [49,94,58,78,74,67,101,69,3.4,.64],
      [29,64,45,57,62,53,89,48,3.0,.57],
      [55,88,66,76,80,72,109,78,4.4,.71],
      [63,95,72,83,83,80,111,91,2.8,.56],
      [38,78,50,68,66,63,94,58,2.6,.54],
      [46,70,57,62,72,59,105,55,2.2,.50],
      [28,86,39,73,51,68,69,70,2.4,.52],
      [57,76,69,66,79,62,98,60,2.5,.52],
      [39,96,48,83,57,76,75,75,2.2,.48]
    ];
    ctx.lineCap="round";ctx.lineJoin="round";
    for(let i=0;i<strands.length;i++){
      const s=strands[i],tone=i%4===0?"142,157,74":i%3===0?"91,121,48":"112,139,56";
      ctx.strokeStyle=`rgba(${tone},${s[9]})`;ctx.lineWidth=s[8];
      ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.bezierCurveTo(s[2],s[3],s[4],s[5],s[6],s[7]);ctx.stroke();
    }
    for(const p of [[45,69,2.1],[70,61,1.7],[84,72,1.8],[56,77,1.5],[95,61,1.4]]){
      ctx.fillStyle="rgba(145,136,76,.28)";ctx.beginPath();ctx.arc(p[0],p[1],p[2],0,Math.PI*2);ctx.fill();
    }
  }
  const texture=new pc.Texture(device,{
    name:"environment-reaction-"+kind,width:size,height:size,
    format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true,
    minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,magFilter:pc.FILTER_LINEAR,
    addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE
  });
  texture.setSource(canvas);return texture;
}
function environmentReactionMaterial(name,r,g,b,opacity=1){
  const m=new pc.StandardMaterial();
  m.name=name;m.diffuse.set(r,g,b);m.emissive.set(r*.12,g*.12,b*.12);m.emissiveIntensity=1;
  m.roughness=.95;m.metalness=0;m.opacity=opacity;m.useLighting=true;m.cull=pc.CULLFACE_NONE;
  if(opacity<1){m.blendType=pc.BLEND_NORMAL;m.depthWrite=false;}
  m.update();return m;
}
function createEnvironmentReactionGroup(kind,index){
  const group=new pc.Entity("EnvironmentReaction-"+kind+"-"+index),children=[];
  environmentalReactionRoot.addChild(group);
  if(kind==="dust"){
    const specs=[
      [-.48,.09,-.12,1.72,.88,1.52],
      [.00,.14,.04,2.08,1.02,1.82],
      [.46,.08,.14,1.58,.80,1.42]
    ];
    for(let i=0;i<specs.length;i++){
      const q=specs[i],e=addLocalPrimitive(group,"DustPuff-"+index+"-"+i,"dust-puff",environmentalReactionMaterials.dust,q[0],q[1],q[2],q[3],q[4],q[5],0,i*17,0);
      e.render.castShadows=false;e.render.receiveShadows=false;children.push(e);
    }
  }else if(kind==="grassBend"){
    const specs=[
      [-.58,.020,-.28,-41,2.10,1.86,2.22],
      [-.15,.024,.13,-11,2.30,2.04,2.36],
      [.30,.021,-.07,21,2.14,1.90,2.24],
      [.61,.018,.27,57,1.90,1.70,2.02]
    ];
    for(let i=0;i<specs.length;i++){
      const q=specs[i],e=addLocalPrimitive(group,"BentGrass-"+index+"-"+i,"bent-grass-blade",environmentalReactionMaterials.grass,q[0],q[1],q[2],q[4],q[5],q[6],0,q[3],0);
      e.render.castShadows=false;e.render.receiveShadows=false;children.push(e);
    }
  }else{
    const specs=[[-.24,.038,-.30,-18],[.24,.038,.30,18]];
    for(let i=0;i<specs.length;i++){
      const q=specs[i],e=addLocalPrimitive(group,"Footprint-"+index+"-"+i,"cylinder",environmentalReactionMaterials.footprint,q[0],q[1],q[2],.34,.05,.56,0,q[3],0);
      children.push(e);
    }
  }
  group.enabled=false;
  return {kind,index,group,children,active:false,startedAtMs:0,lifetimeMs:0,latitudeRadians:0,longitudeRadians:0,directionDegrees:0};
}
function ensureEnvironmentReactionPool(){
  if(environmentalReactionRoot||!pc||!tangentPatch)return Boolean(environmentalReactionRoot);
  environmentalReactionTextures={
    dust:environmentReactionTexture("dust"),
    grass:environmentReactionTexture("grass")
  };
  environmentalReactionMaterials={
    dust:environmentReactionMaterial("EnvironmentDust",.88,.73,.50,.90),
    grass:environmentReactionMaterial("EnvironmentBentGrass",1,1,1,.94),
    footprint:environmentReactionMaterial("EnvironmentFootprint",.28,.15,.055,.90)
  };
  const dust=environmentalReactionMaterials.dust,grass=environmentalReactionMaterials.grass;
  dust.diffuseMap=environmentalReactionTextures.dust;dust.emissiveMap=environmentalReactionTextures.dust;dust.opacityMap=environmentalReactionTextures.dust;dust.opacityMapChannel="a";
  dust.useLighting=false;dust.diffuse.set(.96,.82,.62);dust.emissive.set(.60,.45,.28);dust.emissiveIntensity=.24;dust.blendType=pc.BLEND_NORMAL;dust.depthWrite=false;dust.alphaTest=.015;dust.update();
  grass.diffuseMap=environmentalReactionTextures.grass;grass.opacityMap=environmentalReactionTextures.grass;grass.opacityMapChannel="a";
  grass.diffuse.set(1,1,1);grass.emissive.set(.03,.045,.015);grass.emissiveIntensity=.18;grass.useLighting=true;grass.blendType=pc.BLEND_NORMAL;grass.depthWrite=false;grass.alphaTest=.03;grass.update();
  environmentalReactionRoot=new pc.Entity("LocalEnvironmentalReactions");
  tangentPatch.addChild(environmentalReactionRoot);
  environmentalReactionPool=[];
  for(const kind of ["dust","grassBend","footprint"]){
    for(let i=0;i<ENVIRONMENT_REACTION_POOL_PER_KIND;i++)environmentalReactionPool.push(createEnvironmentReactionGroup(kind,i));
  }
  const drawableCount=environmentalReactionPool.reduce((sum,slot)=>sum+slot.children.length,0);
  environmentalReactions={...environmentalReactions,poolInitialized:true,poolGroupCount:environmentalReactionPool.length,poolDrawableCount:drawableCount,poolAllocationsAfterInit:0};
  return true;
}
function clearEnvironmentalReactions(){
  for(const slot of environmentalReactionPool){slot.active=false;if(slot.group)slot.group.enabled=false;}
  environmentalReactions={...environmentalReactions,activeCount:0,visibleCount:0};
  return snapshot();
}
function triggerEnvironmentReaction(kind,surfaceType,latitudeRadians,longitudeRadians,movementMeters,directionDegrees){
  if(!environmentalReactions.enabled||!ensureEnvironmentReactionPool())return false;
  const cap=environmentReactionPhoneProfile()?environmentalReactions.phoneActiveCap:environmentalReactions.desktopActiveCap;
  const active=environmentalReactionPool.filter(slot=>slot.active);
  let slot=environmentalReactionPool.find(item=>item.kind===kind&&!item.active);
  if(!slot){
    const same=environmentalReactionPool.filter(item=>item.kind===kind).sort((a,b)=>a.startedAtMs-b.startedAtMs);
    slot=same[0]||null;
    if(slot)environmentalReactions={...environmentalReactions,reuseCount:environmentalReactions.reuseCount+1};
  }
  if(!slot)return false;
  if(active.length>=cap&&!slot.active){
    const oldest=active.sort((a,b)=>a.startedAtMs-b.startedAtMs)[0];
    if(oldest){oldest.active=false;oldest.group.enabled=false;environmentalReactions={...environmentalReactions,reuseCount:environmentalReactions.reuseCount+1};}
  }
  const now=performance.now();
  slot.active=true;slot.startedAtMs=now;slot.latitudeRadians=Number(latitudeRadians)||0;slot.longitudeRadians=Number(longitudeRadians)||0;
  slot.directionDegrees=Number(directionDegrees)||0;slot.lifetimeMs=kind==="dust"?3600:kind==="grassBend"?4200:5600;slot.group.enabled=true;
  const counts={...environmentalReactions.triggerByKind,[kind]:(environmentalReactions.triggerByKind[kind]||0)+1};
  environmentalReactions={...environmentalReactions,triggerCount:environmentalReactions.triggerCount+1,triggerByKind:counts,lastKind:kind,lastSurfaceType:String(surfaceType||""),lastMovementMeters:Number(Number(movementMeters||0).toFixed(3)),lastTriggerAtMs:now};
  return true;
}
function recordEnvironmentNavigationPassage(beforeLatitudeRadians,beforeLongitudeRadians,afterLatitudeRadians,afterLongitudeRadians){
  if(!environmentalReactions.enabled||scaleIndexForScalar()<8||!displayResource||!tangentPatch?.enabled||!activeSeed)return false;
  const delta=canonicalRegisteredDeltaMeters(beforeLatitudeRadians,beforeLongitudeRadians,afterLatitudeRadians,afterLongitudeRadians);
  const east=Number(delta.eastMeters||0),north=Number(delta.northMeters||0),distance=Math.hypot(east,north);
  if(distance<ENVIRONMENT_REACTION_MIN_MOVE_METERS||distance>ENVIRONMENT_REACTION_MAX_MOVE_METERS)return false;
  const now=performance.now();
  if(now-Number(environmentalReactions.lastTriggerAtMs||0)<ENVIRONMENT_REACTION_TRIGGER_INTERVAL_MS)return false;
  const tile=mapWorldTileAt(afterLatitudeRadians,afterLongitudeRadians);
  let surfaceType=null;
  try{surfaceType=window.TerrainFoundation?.getType?.(activeSeed,tile.x,tile.y)||null;}catch(_){surfaceType=null;}
  const kind=environmentReactionSurfaceKind(surfaceType);if(!kind)return false;
  const directionDegrees=Math.atan2(east,north)*180/Math.PI;
  // Use the exact canonical coordinate whose TerrainFoundation surface was
  // classified above. Back-shifting presentation could cross a tile boundary
  // and visually place a valid road reaction on adjacent grass.
  return triggerEnvironmentReaction(kind,surfaceType,afterLatitudeRadians,afterLongitudeRadians,distance,directionDegrees);
}
function updateEnvironmentalReactions(){
  if(!environmentalReactionPool.length||!displayResource)return;
  const started=performance.now(),now=performance.now(),frame=localDisplayFrame(),dims=frame.dims;
  let activeCount=0,visibleCount=0,activeDrawCallEstimate=0;
  for(const slot of environmentalReactionPool){
    if(!slot.active)continue;
    const age=now-slot.startedAtMs;
    if(age>=slot.lifetimeMs){slot.active=false;slot.group.enabled=false;environmentalReactions={...environmentalReactions,expiredCount:environmentalReactions.expiredCount+1};continue;}
    activeCount++;
    const delta=canonicalRegisteredDeltaMeters(frame.lat0,frame.lon0,slot.latitudeRadians,slot.longitudeRadians);
    const east=Number(delta.eastMeters||0),north=Number(delta.northMeters||0);
    const inside=Math.abs(east)<=dims.patchWidth*.62&&Math.abs(north)<=dims.patchHeight*.62;
    slot.group.enabled=inside;if(!inside)continue;
    visibleCount++;activeDrawCallEstimate+=slot.children.length;
    const unit=Math.max(1e-9,Number(dims.metersPerUnit||1)),t=clamp(age/slot.lifetimeMs,0,1),ground=localGroundHeightUnits(east,north,frame);
    let scale=1,liftMeters=.035;
    if(slot.kind==="dust"){
      // Keep the three pooled soft-alpha puffs low and spread laterally so
      // movement reads as a short road-surface disturbance, not one tall oval.
      scale=.96+t*.26;liftMeters=.030+t*.080;
      const spread=.18*t,rise=.16*t;
      const bases=[[-.48,.09,-.12],[0,.14,.04],[.46,.08,.14]];
      for(let i=0;i<slot.children.length;i++){
        const b=bases[i],side=i-1;
        slot.children[i].setLocalPosition(b[0]+side*spread,b[1]+rise*(i===1?1:.55),b[2]+side*.08*t);
      }
    }else if(slot.kind==="grassBend"){
      // Keep width stable and settle only slightly so phone-landscape remains
      // readable without growing into a marker-like symbol.
      scale=1-t*.04;liftMeters=.020;
    }else{scale=1-t*.06;liftMeters=.055;}
    slot.group.setLocalPosition(east/unit,ground+liftMeters/unit,-north/unit);
    slot.group.setLocalScale(scale/unit,scale/unit,scale/unit);
    slot.group.setLocalEulerAngles(0,slot.directionDegrees,0);
  }
  const ms=performance.now()-started;
  environmentalReactions={...environmentalReactions,activeCount,visibleCount,activeDrawCallEstimate,peakActiveCount:Math.max(environmentalReactions.peakActiveCount,activeCount),lastUpdateMs:Number(ms.toFixed(4)),maxUpdateMs:Math.max(Number(environmentalReactions.maxUpdateMs||0),Number(ms.toFixed(4)))};
}

function ensureLocalStaticMaterials(){
  if(localStaticMaterials||!pc)return;
  const make=(name,r,g,b,opacity=1)=>{const m=new pc.StandardMaterial();m.name=name;m.diffuse.set(r,g,b);m.__atmosphereBaseDiffuse=[r,g,b];m.roughness=.92;m.opacity=opacity;if(opacity<1){m.blendType=pc.BLEND_NORMAL;m.depthWrite=false;}m.update();return m;};
  const wildernessMaterial=make("LocalWilderness",1,1,1);wildernessMaterial.vertexColors=true;wildernessMaterial.diffuseVertexColor=true;wildernessMaterial.cull=pc.CULLFACE_NONE;wildernessMaterial.update();
  localStaticMaterials={
    road:make("LocalRoad",.22,.14,.075),square:make("LocalSquare",.42,.32,.19),
    wall:make("LocalWall",.68,.50,.30),roof:make("LocalRoof",.30,.095,.055),
    landmark:make("LocalLandmark",.86,.57,.14),footprint:make("LocalSettlementFootprint",.40,.31,.14,.30),
    trunk:make("LocalTrunk",.24,.13,.06),leaf:make("LocalLeaf",.16,.39,.12),water:make("LocalWater",.08,.31,.48,.72),
    activityWarm:(()=>{const m=make("LocalActivityWarm",1,.48,.08);m.__activityEmissiveBoost=1.05;return m;})(),
    activityOpen:(()=>{const m=make("LocalActivityOpen",.96,.64,.12);m.__activityEmissiveBoost=.52;return m;})(),
    activityForge:(()=>{const m=make("LocalActivityForge",1,.16,.025);m.__activityEmissiveBoost=1.12;return m;})(),
    activitySmoke:make("LocalActivitySmoke",.48,.49,.47,.58),
    activityProp:make("LocalActivityProp",.39,.24,.10),
    wilderness:wildernessMaterial,fauna:(()=>{const m=make("LocalFauna",1,1,1);m.vertexColors=true;m.diffuseVertexColor=true;m.cull=pc.CULLFACE_NONE;m.update();return m;})()
  };
}
function sharedLocalPrimitive(type){
  if(localSharedPrimitives[type])return localSharedPrimitives[type];
  let mesh;
  if(type==="dust-puff"){
    // Three softly textured quads inside one shared mesh give broad coverage
    // from the fixed oblique gameplay camera without a faceted solid silhouette.
    mesh=new pc.Mesh(device);
    const positions=[],normals=[],uvs=[],indices=[];
    const addQuad=(verts,normal)=>{
      const base=positions.length/3;
      for(const v of verts){positions.push(v[0],v[1],v[2]);normals.push(normal[0],normal[1],normal[2]);}
      uvs.push(0,1, 1,1, 0,0, 1,0);
      indices.push(base,base+1,base+2, base+1,base+3,base+2);
    };
    addQuad([[-.62,0,-.50],[.62,0,-.50],[-.62,0,.50],[.62,0,.50]],[0,1,0]);
    addQuad([[-.58,-.16,0],[.58,-.16,0],[-.58,.68,0],[.58,.68,0]],[0,0,1]);
    addQuad([[0,-.14,-.56],[0,-.14,.56],[0,.62,-.56],[0,.62,.56]],[1,0,0]);
    mesh.setPositions(positions);mesh.setNormals(normals);mesh.setUvs(0,uvs);mesh.setIndices(indices);mesh.update();
  }else if(type==="bent-grass-blade"){
    // One horizontal UV plane per pooled drawable. The shared alpha texture
    // carries many irregular pressed strands, so four rotated instances read as
    // vegetation rather than a symmetric arrow/chevron marker.
    mesh=new pc.Mesh(device);
    mesh.setPositions([-.62,0,-.54, .62,0,-.54, -.62,0,.54, .62,0,.54]);
    mesh.setNormals([0,1,0, 0,1,0, 0,1,0, 0,1,0]);
    mesh.setUvs(0,[0,1, 1,1, 0,0, 1,0]);
    mesh.setIndices([0,1,2, 1,3,2]);mesh.update();
  }else{
    mesh=type==="cylinder"?pc.createCylinder(device,{radius:.5,height:1}):type==="sphere"?pc.createSphere(device,{radius:.5,latitudeBands:8,longitudeBands:10}):type==="cone"?pc.createCone(device,{baseRadius:.5,peakRadius:.08,height:1,capSegments:8}):pc.createBox(device);
  }
  mesh.incRefCount();// keep alive across static-world rebuilds
  return localSharedPrimitives[type]=mesh;
}
function addLocalPrimitive(parent,name,type,material,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){
  const e=new pc.Entity(name);
  e.addComponent("render",{type:"asset",castShadows:true,receiveShadows:true});e.render.meshInstances=[new pc.MeshInstance(sharedLocalPrimitive(type),material,e)];
  e.setLocalPosition(x,y,z);e.setLocalScale(sx,sy,sz);e.setLocalEulerAngles(rx,ry,rz);parent.addChild(e);return e;
}
function addLocalStatic(name,type,material,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){
  return addLocalPrimitive(localStaticRoot,name,type,material,x,y,z,sx,sy,sz,rx,ry,rz);
}
function revealHashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function settlementRevealTierForScalar(value=zoomState.scalar){
  return semanticLayerSpec(semanticScaleIndexForScalar(value),false).settlementRevealTier;
}
function canonicalStartingVillageReveal(resource){
  if(!activeSeed||!resource||!window.StartingVillage||!window.HousePlans||!window.SpecialLots||!window.SettlementArchetypes||!window.PoliticalGeography)return null;
  // Settlement visibility is a property of the canonical player view, never of
  // whichever SLOD cell happens to be active. Using the resource center here
  // made the same 1/N view drop the village exactly when an east/west child
  // became ready. A conservative viewport half-diagonal keeps the canonical
  // village resident while any part of its established reveal radius can still
  // be on-screen, independent of parent/child handoff timing.
  const focusTile=mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  const resourceTile=mapWorldTileAt(resource.lat0,resource.lon0);
  const distanceTiles=Math.hypot(Number(BigInt(focusTile.x)),Number(BigInt(focusTile.y)));
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const viewportRadiusTiles=Math.hypot(
    Math.max(0,Number(zoomState.visibleFootprintWidthMeters||0)),
    Math.max(0,Number(zoomState.visibleFootprintHeightMeters||0))
  )/(2*tileMeters);
  const canonicalRevealRadiusTiles=512;
  if(distanceTiles>viewportRadiusTiles+canonicalRevealRadiusTiles)return null;
  const key=activeSeed+"|starting-village";
  if(settlementRevealCache.key!==key){
    const country=window.PoliticalGeography.countryAt(activeSeed,"0","0");
    const settlement=(window.SettlementArchetypes.settlementsForCountry(activeSeed,country,3)||[]).find(item=>item.role==="starting-village")||null;
    const village=window.StartingVillage.plan(activeSeed);
    const houses=window.HousePlans.build(activeSeed)||[];
    const specialLots=window.SpecialLots.build(activeSeed)||[];
    if(!settlement||!village||!houses.length){settlementRevealCache={key,value:null};}
    else{
      const layoutSource=[
        settlement.id,settlement.revision,village.gatewayDirection,
        ...houses.map(item=>[item.id,item.bounds.minX,item.bounds.minY,item.bounds.maxX,item.bounds.maxY].join(":")),
        ...specialLots.map(item=>[item.id,item.kind,item.bounds.minX,item.bounds.minY,item.bounds.maxX,item.bounds.maxY].join(":"))
      ].join("|");
      settlementRevealCache={key,value:Object.freeze({
        settlement,village,houses:Object.freeze(houses.slice()),specialLots:Object.freeze(specialLots.slice()),
        layoutSignature:"SVL-"+revealHashText(layoutSource),
        tileMeters:Math.max(1,Number(window.WorldStandards?.TILE_METERS||2))
      })};
    }
  }
  const base=settlementRevealCache.value;if(!base)return null;
  return Object.freeze({...base,focusTile,resourceTile,distanceTiles,viewportRadiusTiles,canonicalRevealRadiusTiles});
}
function revealPresentationScale(dims,tier,coreDiameterMeters){
  if(tier==="full")return 1;
  // Keep the authoritative settlement composition large enough to read as
  // actual world structure, not a locator glyph, then converge rapidly to 1:1.
  const targetFraction=tier==="footprint"?.16:tier==="route"?.17:tier==="coarse"?.22:.22;
  const desiredSpan=Math.max(coreDiameterMeters,dims.patchHeight*targetFraction);
  const cap=tier==="footprint"?400:tier==="route"?200:tier==="coarse"?90:18;
  return Number(clamp(desiredSpan/Math.max(1,coreDiameterMeters),1,cap).toFixed(4));
}
function settlementPresentationLift(tier,value=zoomState.scalar){
  if(tier==="footprint")return .46;
  if(tier==="route")return Number(clamp(.06+(.84-clamp(value,.70,.84))/.14*.18,.06,.24).toFixed(4));
  if(tier==="coarse")return .045;
  return .012;
}
function canonicalSemanticAnchor(frame){
  return {east:Number(frame?.semanticAnchorEastMeters||0),north:Number(frame?.semanticAnchorNorthMeters||0)};
}
function canonicalSemanticGroundHeightUnits(eastMeters,northMeters,frame){
  const anchor=canonicalSemanticAnchor(frame);
  return localGroundHeightUnits(anchor.east+Number(eastMeters||0),anchor.north+Number(northMeters||0),frame);
}
function canonicalSemanticPosition(eastMeters,northMeters,presentationScale,unit,frame){
  const anchor=canonicalSemanticAnchor(frame),scale=Number(presentationScale||1),u=Math.max(1e-9,Number(unit)||1);
  return {x:(anchor.east+Number(eastMeters||0)*scale)/u,z:-(anchor.north+Number(northMeters||0)*scale)/u};
}
function addCanonicalRoadSegment(name,x1,y1,x2,y2,widthMeters,presentationScale,unit,frame,lift=0,material=localStaticMaterials.road){
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const east1=x1*tileMeters,north1=y1*tileMeters,east2=x2*tileMeters,north2=y2*tileMeters;
  const centerEast=(east1+east2)/2,centerNorth=(north1+north2)/2;
  const dx=(east2-east1)*presentationScale,dz=-(north2-north1)*presentationScale;
  const length=Math.max(widthMeters*presentationScale,Math.hypot(dx,dz));
  const angle=Math.atan2(dx,dz)*180/Math.PI;
  const ground=canonicalSemanticGroundHeightUnits(centerEast,centerNorth,frame)+lift+.028,pos=canonicalSemanticPosition(centerEast,centerNorth,presentationScale,unit,frame);
  addLocalStatic(name,"box",material,pos.x,ground,pos.z,widthMeters*presentationScale/unit,.058,length/unit,0,angle,0);
}
function clearInspectionKeySet(keys,preserveSelected=false){
  const selectedKey=inspection.selectedId===null?null:inspectionRegistryKey(inspection.selectedType,inspection.selectedId);
  for(const key of keys)inspectionPickables.delete(key);
  keys.clear();
  if(!preserveSelected&&selectedKey&&!inspectionPickables.has(selectedKey))dismissInspection();
}
function registerLocalInspection(record,keys){
  if(!registerInspectionPickable(record))return false;
  keys.add(inspectionRegistryKey(record.type,record.id));return true;
}
function inspectionEntityBounds(entities,padding=5){
  if(!cameraEntity?.camera||!canvas||!device||!pc)return null;
  const rect=canvas.getBoundingClientRect(),sourceW=Math.max(1,Number(device.width||canvas.width||rect.width)),sourceH=Math.max(1,Number(device.height||canvas.height||rect.height));
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity,seen=0;
  const project=world=>{
    const p=cameraEntity.camera.worldToScreen(world,new pc.Vec3());
    if(!p||![p.x,p.y,p.z].every(Number.isFinite)||p.z<=0)return;
    const x=rect.left+p.x*(rect.width/sourceW),y=rect.top+p.y*(rect.height/sourceH);
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);seen++;
  };
  for(const entity of entities||[]){
    if(!entity?.enabled||!entity.parent)continue;
    for(const meshInstance of entity.render?.meshInstances||[]){
      const aabb=meshInstance.aabb,c=aabb?.center,h=aabb?.halfExtents;if(!c||!h)continue;
      for(const dx of [-1,1])for(const dy of [-1,1])for(const dz of [-1,1])project(new pc.Vec3(c.x+h.x*dx,c.y+h.y*dy,c.z+h.z*dz));
    }
  }
  if(!seen)return null;
  return {left:left-padding,right:right+padding,top:top-padding,bottom:bottom+padding};
}
function inspectionEntityDepth(entities){
  const camera=cameraEntity?.getPosition?.();if(!camera)return Infinity;let best=Infinity;
  for(const entity of entities||[]){if(!entity?.enabled||!entity.parent)continue;const p=entity.getPosition();best=Math.min(best,(p.x-camera.x)**2+(p.y-camera.y)**2+(p.z-camera.z)**2);}
  return best;
}
function readableTitle(value,fallback){
  const text=String(value??"").trim();if(!text)return fallback;
  return text.replace(/[-_]+/g," ").replace(/\b\w/g,ch=>ch.toUpperCase());
}
function inspectionFantasyStamp(){
  const hour=Number.isFinite(Number(atmosphere.authoritativeHour))?Number(atmosphere.authoritativeHour):12.5;
  const whole=Math.floor(hour),minute=Math.round((hour-whole)*60);
  return Object.freeze({year:1100,month:1,day:1,hour:whole,minute:Math.min(59,minute),second:0});
}
function residentInspectionState(residentId){
  const resident=window.DailyActivity?.build?.(activeSeed)?.find(item=>item.id===String(residentId))||null;
  if(!resident)return null;
  const scheduled=window.DailyActivity?.resolveActionTarget?.(activeSeed,resident,inspectionFantasyStamp())||null;
  const movement=window.ResidentMovement?.get?.(resident.id)||null;
  const executing=window.ActionExecutor?.get?.("resident",resident.id)||movement?.actionExecution||null;
  let activity=executing?.label||scheduled?.label||"Idle";
  if(movement?.status==="moving"){
    const state=String(scheduled?.state||"");
    activity=state==="return-home"?"Going home":state==="work"?"Walking to work":"Traveling";
  }else if(executing?.status==="active")activity=executing.label||"Working";
  return Object.freeze({
    residentId:resident.id,
    displayName:String(resident.displayName||resident.name||"Resident"),
    profession:readableTitle(resident.profession,"Unassigned"),
    activity:readableTitle(activity,"Idle"),
    scheduled,
    movement,
    authority:Object.freeze({identityId:resident.id,homeId:resident.homePlanId||null,workplaceId:resident.workplaceId||null,scheduleTimestamp:scheduled?.timestamp||null})
  });
}
function residentPresentationState(resident){
  const movement=window.ResidentMovement?.presentation?.(resident.id)||null;
  const movementState=window.ResidentMovement?.get?.(resident.id)||null;
  const scheduled=window.DailyActivity?.resolveActionTarget?.(activeSeed,resident,inspectionFantasyStamp())||null;
  const point=movement?.point||scheduled?.target||null;if(!point)return null;
  const offset=movement?.offset||{x:0,y:0};
  const indoors=movementState?Boolean(movementState.occupiesBuilding):scheduled?.targetSource==="interior-interaction";
  return Object.freeze({x:Number(point.x)+Number(offset.x||0),y:Number(point.y)+Number(offset.y||0),indoors,scheduled,movementState});
}
function ensureLocalNpcMaterials(){
  if(localNpcMaterials||!pc)return;
  const make=(name,r,g,b)=>{const m=new pc.StandardMaterial();m.name=name;m.diffuse.set(r,g,b);m.__atmosphereBaseDiffuse=[r,g,b];m.roughness=.88;m.metalness=0;m.update();return m;};
  localNpcMaterials={body:make("LocalResidentBody",.19,.42,.72),head:make("LocalResidentHead",.86,.68,.50)};
}
function registerCanonicalBuildingInspection(record,entities){
  const typeLabel=readableTitle(record?.function||record?.kind||record?.type,"Building");
  const explicitName=String(record?.label||record?.name||"").trim();
  const name=explicitName||typeLabel+" "+String(record?.id||"").trim();
  registerLocalInspection({
    id:String(record.id),type:"building",name,functionLabel:typeLabel,buildingType:typeLabel,pickPriority:1,
    authority:Object.freeze({buildingId:String(record.id),kind:record?.kind||null,function:record?.function||null}),
    visible:()=>entities.some(entity=>entity?.enabled&&entity.parent),
    screenBounds:()=>inspectionEntityBounds(entities,6),
    screenDepth:()=>inspectionEntityDepth(entities)
  },localBuildingInspectionKeys);
}
function rebuildCanonicalNpcPresentation(reveal,tier,frame,presentationScale,unit,lift=0,preserveSelection=false){
  const started=performance.now(),selectedNpc=inspection.selectedType==="npc"?inspection.selectedId:null;
  clearInspectionKeySet(localNpcInspectionKeys,preserveSelection);localNpcRoot?.destroy?.();localNpcRoot=null;
  localNpcPresentation={...localNpcPresentation,active:false,activeCount:0,entityCount:0,drawCallEstimate:0,buildTimeMs:0};
  localNpcContext={reveal,tier,frame,presentationScale,unit,lift};
  if(!["refined","full"].includes(tier)||!window.DailyActivity?.build)return;
  ensureLocalNpcMaterials();localNpcRoot=new pc.Entity("CanonicalResidents");tangentPatch.addChild(localNpcRoot);
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2)),roster=window.DailyActivity.build(activeSeed)||[];
  let activeCount=0,entityCount=0;
  for(const resident of roster){
    const state=residentPresentationState(resident);if(!state||state.indoors)continue;
    const east=state.x*tileMeters,north=state.y*tileMeters,ground=canonicalSemanticGroundHeightUnits(east,north,frame)+lift+.015;
    const bodyHeight=Math.max(.10,1.18*presentationScale/unit),bodyWidth=Math.max(.045,.48*presentationScale/unit),headSize=Math.max(.045,.44*presentationScale/unit);
    const pos=canonicalSemanticPosition(east,north,presentationScale,unit,frame),x=pos.x,z=pos.z;
    const body=addLocalPrimitive(localNpcRoot,"ResidentBody-"+resident.id,"cylinder",localNpcMaterials.body,x,ground+bodyHeight*.5,z,bodyWidth,bodyHeight,bodyWidth);
    const head=addLocalPrimitive(localNpcRoot,"ResidentHead-"+resident.id,"sphere",localNpcMaterials.head,x,ground+bodyHeight+headSize*.48,z,headSize,headSize,headSize);
    const entities=[body,head];
    registerLocalInspection({
      id:resident.id,type:"npc",residentId:resident.id,pickPriority:3,
      authority:Object.freeze({residentId:resident.id,identitySource:"DailyActivity",professionSource:"ResidentAssignments",activitySource:"DailyActivity.resolveActionTarget"}),
      inspect:()=>residentInspectionState(resident.id),
      visible:()=>entities.some(entity=>entity?.enabled&&entity.parent),
      screenBounds:()=>inspectionEntityBounds(entities,5),
      screenDepth:()=>inspectionEntityDepth(entities)
    },localNpcInspectionKeys);
    activeCount++;entityCount+=2;
  }
  localNpcPresentation={...localNpcPresentation,active:activeCount>0,activeCount,entityCount,drawCallEstimate:entityCount,buildTimeMs:Number((performance.now()-started).toFixed(3)),time:inspectionFantasyStamp()};
  if(selectedNpc&&!inspectionPickables.has(inspectionRegistryKey("npc",selectedNpc)))dismissInspection();
}
function refreshCanonicalNpcPresentation(){
  if(!localNpcContext)return;
  const c=localNpcContext;rebuildCanonicalNpcPresentation(c.reveal,c.tier,c.frame,c.presentationScale,c.unit,c.lift,true);
}
function addCanonicalBuilding(record,index,presentationScale,unit,frame,detailed,landmark,lift=0){
  const b=record.bounds,tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2)),entities=[];
  const cx=(Number(b.minX)+Number(b.maxX))/2,cy=(Number(b.minY)+Number(b.maxY))/2;
  const w=(Number(b.maxX)-Number(b.minX)+1)*tileMeters,d=(Number(b.maxY)-Number(b.minY)+1)*tileMeters;
  const east=cx*tileMeters,north=cy*tileMeters,ground=canonicalSemanticGroundHeightUnits(east,north,frame)+lift;
  const wall=landmark?localStaticMaterials.landmark:localStaticMaterials.wall,pos=canonicalSemanticPosition(east,north,presentationScale,unit,frame);
  if(!detailed){
    const h=Math.max(.045,Math.min(.16,3.2*presentationScale/unit));
    entities.push(addLocalStatic("CanonicalBlock-"+record.id,"box",wall,pos.x,ground+h*.5,pos.z,w*presentationScale/unit,h,d*presentationScale/unit));
    return entities.length;
  }
  const physicalHeight=record.kind==="meeting-hall"?7.2:record.kind==="barn"?6.2:5.4;
  const h=Math.max(.08,physicalHeight*presentationScale/unit);
  entities.push(addLocalStatic("CanonicalBody-"+record.id,"box",wall,pos.x,ground+h*.5,pos.z,w*presentationScale/unit,h,d*presentationScale/unit));
  const roofMat=landmark?localStaticMaterials.landmark:localStaticMaterials.roof;
  const roofY=ground+h+.025,roofL=canonicalSemanticPosition(east-w*.20,north,presentationScale,unit,frame),roofR=canonicalSemanticPosition(east+w*.20,north,presentationScale,unit,frame);
  entities.push(addLocalStatic("CanonicalRoofL-"+record.id,"box",roofMat,roofL.x,roofY,roofL.z,w*.66*presentationScale/unit,.05,d*1.10*presentationScale/unit,0,0,-24));
  entities.push(addLocalStatic("CanonicalRoofR-"+record.id,"box",roofMat,roofR.x,roofY,roofR.z,w*.66*presentationScale/unit,.05,d*1.10*presentationScale/unit,0,0,24));
  registerCanonicalBuildingInspection(record,entities);
  return entities.length;
}

function clearLocalBuildingActivity(){
  localBuildingActivityRoot?.destroy?.();localBuildingActivityRoot=null;
}
function buildingActivityTimeBand(hour){
  const h=((Number(hour)||0)%24+24)%24;
  if(h<6)return "night";
  if(h<8)return "morning";
  if(h<18)return "day";
  if(h<20)return "evening";
  return "night";
}
function canonicalBuildingActivityState(reveal){
  if(!reveal||!window.DailyActivity?.build||!window.DailyActivity?.resolveActionTarget)return null;
  const started=performance.now(),stamp=inspectionFantasyStamp(),hour=Number(stamp.hour)+Number(stamp.minute||0)/60;
  const byBuilding=new Map();
  const ensure=id=>{
    const key=String(id||"");if(!key)return null;
    if(!byBuilding.has(key))byBuilding.set(key,{scheduledResidentCount:0,occupiedResidentCount:0,workCount:0,homeCount:0,socialCount:0,states:new Set()});
    return byBuilding.get(key);
  };
  const residents=window.DailyActivity.build(activeSeed)||[];
  for(const resident of residents){
    let scheduled=null;try{scheduled=window.DailyActivity.resolveActionTarget(activeSeed,resident,stamp)||null;}catch(_){scheduled=null;}
    const scheduledId=String(scheduled?.buildingId||"");
    if(scheduledId){
      const stats=ensure(scheduledId),state=String(scheduled?.state||scheduled?.kind||"");
      stats.scheduledResidentCount++;stats.states.add(state);
      if(state==="work")stats.workCount++;
      if(["sleep","prepare","breakfast","return-home"].includes(state))stats.homeCount++;
      if(["lunch","social"].includes(state))stats.socialCount++;
    }
    let movement=null;try{movement=window.ResidentMovement?.get?.(resident.id)||null;}catch(_){movement=null;}
    if(movement?.occupiesBuilding&&movement?.buildingId){
      const stats=ensure(movement.buildingId);stats.occupiedResidentCount++;
    }
  }
  const records=[...(reveal.houses||[]),...(reveal.specialLots||[])],night=hour>=19||hour<6;
  const buildings=records.map(record=>{
    const id=String(record.id),fn=String(record.function||"home"),stats=byBuilding.get(id)||{scheduledResidentCount:0,occupiedResidentCount:0,workCount:0,homeCount:0,socialCount:0,states:new Set()};
    const workActive=stats.workCount>0,homeActive=fn==="home"&&stats.homeCount>0,socialActive=stats.socialCount>0;
    const active=stats.occupiedResidentCount>0||workActive||homeActive||socialActive;
    let cue=null;
    if(active&&night&&(fn==="home"||fn==="lodging"||fn==="civic"))cue="warm-window";
    else if(fn==="market"&&workActive)cue="open-sign";
    else if(fn==="craft"&&workActive)cue="forge-glow";
    else if(active&&["home","lodging","farm"].includes(fn))cue="chimney-smoke";
    else if(active)cue="work-prop";
    const bounds=record.bounds||{},centerTile=Object.freeze({
      x:String(Math.round((Number(bounds.minX||0)+Number(bounds.maxX||0))/2)),
      y:String(Math.round((Number(bounds.minY||0)+Number(bounds.maxY||0))/2))
    });
    return Object.freeze({
      id,label:String(record.label||record.name||id),kind:String(record.kind||"building"),function:fn,centerTile,
      active,workActive,homeActive,socialActive,scheduledResidentCount:stats.scheduledResidentCount,
      occupiedResidentCount:stats.occupiedResidentCount,states:Object.freeze([...stats.states].sort()),cue
    });
  });
  const signature="BA|"+revealHashText([activeSeed,Math.floor(hour*4),...buildings.map(x=>[x.id,x.active?1:0,x.cue||"-",x.scheduledResidentCount,x.occupiedResidentCount].join(":"))].join("|"));
  return Object.freeze({
    stamp:Object.freeze({...stamp}),hour:Number(hour.toFixed(3)),timeBand:buildingActivityTimeBand(hour),signature,
    residentsEvaluated:residents.length,occupancySourceAvailable:Boolean(window.ResidentMovement?.get),
    buildings:Object.freeze(buildings),buildMs:Number((performance.now()-started).toFixed(4))
  });
}
function activityBuildingGeometry(record,presentationScale,unit,frame,lift){
  const b=record?.bounds;if(!b)return null;
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const cx=(Number(b.minX)+Number(b.maxX))/2,cy=(Number(b.minY)+Number(b.maxY))/2;
  const w=(Number(b.maxX)-Number(b.minX)+1)*tileMeters,d=(Number(b.maxY)-Number(b.minY)+1)*tileMeters;
  const east=cx*tileMeters,north=cy*tileMeters,ground=canonicalSemanticGroundHeightUnits(east,north,frame)+lift;
  const physicalHeight=record.kind==="meeting-hall"?7.2:record.kind==="barn"?6.2:5.4;
  return {east,north,w,d,ground,height:physicalHeight,presentationScale,unit};
}
function addBuildingActivityCue(record,state,context,index){
  const g=activityBuildingGeometry(record,context.presentationScale,context.unit,context.frame,context.lift);if(!g||!state?.cue)return 0;
  const s=g.presentationScale/g.unit,pos=canonicalSemanticPosition(g.east,g.north,g.presentationScale,g.unit,context.frame),front=canonicalSemanticPosition(g.east,g.north+g.d*.505,g.presentationScale,g.unit,context.frame),x=pos.x,z=pos.z,h=g.height*s,frontZ=front.z;
  const name="BuildingActivity-"+state.cue+"-"+state.id+"-"+index;
  if(state.cue==="warm-window"){
    // One emissive facade panel per active building: larger than the former
    // postage-stamp cue, but still a single shared-material draw with no light.
    addLocalPrimitive(localBuildingActivityRoot,name,"box",localStaticMaterials.activityWarm,x,g.ground+h*.51,frontZ,Math.max(.06,2.8*s),Math.max(.06,1.55*s),Math.max(.025,.24*s));
  }else if(state.cue==="open-sign"){
    // A readable projecting shop/market board, positioned outside the wall so
    // it survives the fixed dimetric camera without becoming floating UI.
    addLocalPrimitive(localBuildingActivityRoot,name,"box",localStaticMaterials.activityOpen,x+g.w*.34*s,g.ground+h*.70,frontZ-Math.max(.03,.20*s),Math.max(.07,2.25*s),Math.max(.06,1.25*s),Math.max(.03,.32*s));
  }else if(state.cue==="forge-glow"){
    addLocalPrimitive(localBuildingActivityRoot,name,"box",localStaticMaterials.activityForge,x,g.ground+h*.43,frontZ-Math.max(.03,.12*s),Math.max(.07,2.75*s),Math.max(.06,1.55*s),Math.max(.03,.28*s));
  }else if(state.cue==="chimney-smoke"){
    addLocalPrimitive(localBuildingActivityRoot,name,"sphere",localStaticMaterials.activitySmoke,x+g.w*.20*s,g.ground+h+Math.max(.10,1.75*s),z,Math.max(.08,2.20*s),Math.max(.11,3.00*s),Math.max(.08,2.20*s));
  }else{
    addLocalPrimitive(localBuildingActivityRoot,name,"box",localStaticMaterials.activityProp,x+g.w*.24*s,g.ground+Math.max(.04,.62*s),frontZ-Math.max(.03,.70*s),Math.max(.06,1.35*s),Math.max(.06,1.22*s),Math.max(.06,1.35*s));
  }
  return 1;
}
function rebuildCanonicalBuildingActivityPresentation(reason="settlement-rebuild"){
  const context=localBuildingActivityContext,started=performance.now();clearLocalBuildingActivity();
  if(!context||!["refined","full"].includes(context.tier)||!tangentPatch){
    buildingActivity={...buildingActivity,active:false,buildingCount:0,activeBuildingCount:0,occupiedBuildingCount:0,activeWorkplaceCount:0,activeHomeCount:0,warmWindowCount:0,smokeCueCount:0,openMarketCount:0,forgeGlowCount:0,workPropCount:0,cueCount:0,drawCallEstimate:0,buildings:[],lastUpdateMs:Number((performance.now()-started).toFixed(4)),lastSignature:null};
    return;
  }
  ensureLocalStaticMaterials();
  const state=canonicalBuildingActivityState(context.reveal);
  if(!state)return;
  localBuildingActivityRoot=new pc.Entity("CanonicalBuildingActivity");tangentPatch.addChild(localBuildingActivityRoot);
  const records=[...(context.reveal.houses||[]),...(context.reveal.specialLots||[])],recordById=new Map(records.map(x=>[String(x.id),x]));
  let cueCount=0;
  for(let i=0;i<state.buildings.length;i++){
    const item=state.buildings[i],record=recordById.get(item.id);if(item.cue&&record)cueCount+=addBuildingActivityCue(record,item,context,i);
  }
  const count=cue=>state.buildings.filter(x=>x.cue===cue).length;
  const active=state.buildings.filter(x=>x.active);
  const elapsed=performance.now()-started;
  buildingActivity={
    active:cueCount>0,authoritativeHour:state.hour,timeBand:state.timeBand,buildingCount:state.buildings.length,
    activeBuildingCount:active.length,occupiedBuildingCount:state.buildings.filter(x=>x.occupiedResidentCount>0).length,
    activeWorkplaceCount:state.buildings.filter(x=>x.workActive).length,activeHomeCount:state.buildings.filter(x=>x.homeActive).length,
    warmWindowCount:count("warm-window"),smokeCueCount:count("chimney-smoke"),openMarketCount:count("open-sign"),
    forgeGlowCount:count("forge-glow"),workPropCount:count("work-prop"),cueCount,drawCallEstimate:cueCount,
    dynamicLightCount:0,particleEmitterCount:0,sharedMaterialCount:5,
    updateCount:Number(buildingActivity.updateCount||0)+1,lastUpdateMs:Number(elapsed.toFixed(4)),
    maxUpdateMs:Math.max(Number(buildingActivity.maxUpdateMs||0),Number(elapsed.toFixed(4))),
    lastSignature:state.signature,buildings:state.buildings,residentsEvaluated:state.residentsEvaluated,
    occupancySourceAvailable:state.occupancySourceAvailable,activitySource:"DailyActivity.resolveActionTarget",
    occupancySource:"ResidentMovement.get when available",updateReason:String(reason),
    presentationOnly:true,simulationAuthority:false,bounded:true,fullSettlementPerFrameScan:false
  };
}
function refreshCanonicalBuildingActivityPresentation(){
  if(localBuildingActivityContext)rebuildCanonicalBuildingActivityPresentation("authoritative-time-change");
}

function rebuildCanonicalSettlementPresentation(resource,reveal,tier,frame){
  const started=performance.now(),dims=resource.dims,unit=dims.metersPerUnit,plan=reveal.settlement,village=reveal.village;
  const scale=revealPresentationScale(dims,tier,Number(village.approximateCoreDiameterMeters||104));
  const villageOrigin=worldLatLonForTile(village.center.x,village.center.y),anchorDelta=canonicalRegisteredDeltaMeters(resource.lat0,resource.lon0,villageOrigin.latitudeRadians,villageOrigin.longitudeRadians);
  const semanticFrame={...frame,semanticAnchorEastMeters:Number(anchorDelta.eastMeters||0),semanticAnchorNorthMeters:Number(anchorDelta.northMeters||0)};
  ensureLocalStaticMaterials();localStaticRoot=new pc.Entity("CanonicalSettlementReveal");tangentPatch.addChild(localStaticRoot);
  const coreRadiusMeters=Number(village.approximateCoreDiameterMeters||104)/2;
  const lift=settlementPresentationLift(tier);
  const centerGround=canonicalSemanticGroundHeightUnits(0,0,semanticFrame)+lift+.012,centerPos=canonicalSemanticPosition(0,0,scale,unit,semanticFrame);
  let occupiedAreaCount=0;
  if(tier==="footprint"){
    addLocalStatic("CanonicalOccupiedArea","cylinder",localStaticMaterials.footprint,centerPos.x,centerGround,centerPos.z,coreRadiusMeters*2*scale/unit,.022,coreRadiusMeters*2*scale/unit);
    occupiedAreaCount=1;
  }
  let roadCount=0,coarseBuildings=0,fullBuildings=0,landmarks=0,vegetation=0,triangles=occupiedAreaCount?80:0;
  const roadWidth=Math.max(5,Number(window.WorldStandards?.TILE_METERS||2)*4);
  const squareHalf=Number(window.StartingVillage.PUBLIC_HALF_SIZE||3);
  const ring=Number(window.StartingVillage.RING_RADIUS_TILES||14);
  const roadDetail=tier==="footprint"?8:tier==="route"?12:16;
  if(tier!=="none"){
    addCanonicalRoadSegment("CanonicalRoad-X",-ring,0,ring,0,roadWidth,scale,unit,semanticFrame,lift);roadCount++;
    addCanonicalRoadSegment("CanonicalRoad-Y",0,-ring,0,ring,roadWidth,scale,unit,semanticFrame,lift);roadCount++;
    const sq=(squareHalf*2+1)*reveal.tileMeters;
    addLocalStatic("CanonicalPublicSquare","box",localStaticMaterials.square,centerPos.x,centerGround+.012,centerPos.z,sq*scale/unit,.032,sq*scale/unit);roadCount++;
  }
  if(roadDetail){
    let previous=null;
    for(let i=0;i<=roadDetail;i++){
      const a=i/roadDetail*Math.PI*2,x=Math.cos(a)*ring,y=Math.sin(a)*ring;
      if(previous){addCanonicalRoadSegment("CanonicalRing-"+i,previous.x,previous.y,x,y,roadWidth,scale,unit,semanticFrame,lift);roadCount++;}
      previous={x,y};
    }
    const dir=window.StartingVillage.direction(activeSeed),start=ring,end=Number(window.StartingVillage.GATEWAY_MAINLAND_EDGE_TILES||29);
    addCanonicalRoadSegment("CanonicalGateway",dir.dx*start,dir.dy*start,dir.dx*end,dir.dy*end,roadWidth,scale,unit,semanticFrame,lift);roadCount++;
  }
  const meeting=reveal.specialLots.find(item=>item.kind==="meeting-hall")||reveal.specialLots[0]||null;
  const ordinary=[...reveal.houses,...reveal.specialLots.filter(item=>!meeting||item.id!==meeting.id)];
  const targetCount=tier==="footprint"?3:tier==="route"?5:tier==="coarse"?Math.min(ordinary.length,10):(tier==="refined"||tier==="full"?ordinary.length:0);
  const detailed=tier==="refined"||tier==="full";
  for(let i=0;i<targetCount;i++){
    addCanonicalBuilding(ordinary[i],i,scale,unit,semanticFrame,detailed,false,lift);
    if(detailed)fullBuildings++;else coarseBuildings++;
  }
  if((tier==="footprint"||tier==="route"||tier==="coarse"||tier==="refined"||tier==="full")&&meeting){
    addCanonicalBuilding(meeting,targetCount,scale,unit,semanticFrame,detailed,true,lift);
    landmarks=1;if(detailed)fullBuildings++;else coarseBuildings++;
  }
  const treeCount=tier==="coarse"?6:tier==="refined"?10:tier==="full"?12:0;
  for(let i=0;i<treeCount;i++){
    const angle=i/Math.max(1,treeCount)*Math.PI*2+localHash(i*17,treeCount,91)*.22;
    const radiusTiles=22+localHash(i*31,treeCount,92)*4;
    const east=Math.cos(angle)*radiusTiles*reveal.tileMeters,north=Math.sin(angle)*radiusTiles*reveal.tileMeters;
    const ground=canonicalSemanticGroundHeightUnits(east,north,semanticFrame)+lift,h=(4.5+localHash(i*43,treeCount,93)*2.5)*scale/unit,pos=canonicalSemanticPosition(east,north,scale,unit,semanticFrame);
    addLocalStatic("CanonicalTreeTrunk-"+i,"cylinder",localStaticMaterials.trunk,pos.x,ground+h*.28,pos.z,.65*scale/unit,Math.max(.04,h*.56),.65*scale/unit);
    addLocalStatic("CanonicalTreeCrown-"+i,"sphere",localStaticMaterials.leaf,pos.x,ground+h*.78,pos.z,3.8*scale/unit,Math.max(.06,h*.82),3.8*scale/unit);
    vegetation++;triangles+=180;
  }
  const wild=renderLocalWilderness(resource,frame,reveal);
  rebuildCanonicalNpcPresentation(reveal,tier,semanticFrame,scale,unit,lift,false);
  localBuildingActivityContext={reveal,tier,frame:semanticFrame,presentationScale:scale,unit,lift};
  rebuildCanonicalBuildingActivityPresentation("settlement-rebuild");
  const entityCount=localStaticRoot.children.length;
  triangles+=roadCount*12+(coarseBuildings*12)+(fullBuildings*36);
  localStatic={
    ...localStatic,active:entityCount>0,signature:resource.signature,level:dims.levelId,revealTier:tier,
    settlementId:plan.id,settlementName:plan.name,settlementClass:plan.classId,settlementRole:plan.role,
    settlementPlanRevision:plan.revision,layoutSignature:reveal.layoutSignature,
    canonicalCenterTile:Object.freeze({x:String(village.center.x),y:String(village.center.y)}),
    presentationScale:scale,occupiedAreaCount,
    coarseRoadCount:(tier==="footprint"||tier==="route"||tier==="coarse")?roadCount:0,
    coarseBuildingCount:coarseBuildings,landmarkCount:landmarks,
    fullRoadCount:detailed?roadCount:0,fullBuildingCount:fullBuildings,
    roadCount,buildingCount:coarseBuildings+fullBuildings,vegetationCount:vegetation,wildernessCount:wild.accepted,ambientFaunaCount:wild.fauna,waterCount:0,
    entityCount,triangleEstimate:triangles+wild.triangles,drawCallEstimate:entityCount+wild.fauna,
    buildTimeMs:Number((performance.now()-started).toFixed(3)),
    grounded:true,viewportBounded:true,presentationOnly:true,simulationAuthority:false,
    authority:"SettlementArchetypes + StartingVillage + HousePlans + SpecialLots"
  };
}
function rebuildLocalStaticPresentation(resource){
  if(!tangentPatch||!device||!geography||!resource)return;
  const started=performance.now(),dims=resource.dims,frame={lat0:resource.lat0,lon0:resource.lon0,dims,groundDetailWeight:resource.groundDetailWeight,centerElevation:resource.centerElevation},eligible=dims.staticWorld;
  clearInspectionKeySet(localBuildingInspectionKeys,false);clearInspectionKeySet(localNpcInspectionKeys,false);
  localNpcRoot?.destroy?.();localNpcRoot=null;localNpcContext=null;localNpcPresentation={...localNpcPresentation,active:false,activeCount:0,entityCount:0,drawCallEstimate:0,buildTimeMs:0};
  clearLocalBuildingActivity();localBuildingActivityContext=null;
  buildingActivity={...buildingActivity,active:false,buildingCount:0,activeBuildingCount:0,occupiedBuildingCount:0,activeWorkplaceCount:0,activeHomeCount:0,warmWindowCount:0,smokeCueCount:0,openMarketCount:0,forgeGlowCount:0,workPropCount:0,cueCount:0,drawCallEstimate:0,buildings:[],lastSignature:null};
  clearLocalFauna();
  localStaticRoot?.destroy?.();localStaticRoot=null;
  const tier=settlementRevealTierForScalar();
  localStatic={...localStatic,active:false,signature:resource.signature,level:dims.levelId,revealTier:"none",settlementId:null,settlementName:null,settlementClass:null,settlementRole:null,settlementPlanRevision:null,layoutSignature:null,canonicalCenterTile:null,presentationScale:1,occupiedAreaCount:0,coarseRoadCount:0,coarseBuildingCount:0,landmarkCount:0,fullRoadCount:0,fullBuildingCount:0,roadCount:0,buildingCount:0,vegetationCount:0,wildernessCount:0,ambientFaunaCount:0,waterCount:0,entityCount:0,triangleEstimate:0,drawCallEstimate:0,buildTimeMs:0,presentationOnly:true,simulationAuthority:false};
  const reveal=canonicalStartingVillageReveal(resource);
  if(reveal&&tier!=="none"){
    rebuildCanonicalSettlementPresentation(resource,reveal,tier,frame);
    return;
  }
  if(!eligible){
    rebuildLocalFauna(null,frame,null);
    wilderness={...wilderness,localActive:false,localSignature:null,localLevel:dims.levelId,localBiome:null,localCandidateCount:0,localAcceptedStaticProps:0,localAmbientFaunaActiveCount:0,localRejectedWater:0,localRejectedManaged:0,localRejectedRoad:0,localFamilyCounts:{},localBiomeCounts:{},localDrawCalls:0,localTriangles:0,localPreparationMs:0,localPlanCached:false,localLayoutSignature:null,localFullWorldScan:false,localDeterministicGlobalCells:true};
    return;
  }
  ensureLocalStaticMaterials();localStaticRoot=new pc.Entity("LocalStaticWorld");tangentPatch.addChild(localStaticRoot);
  const unit=dims.metersPerUnit,center=geography.sampleLatLon(resource.lat0,resource.lon0);
  if(center?.land){
    const wild=renderLocalWilderness(resource,frame,null);
    localStatic.wildernessCount=wild.accepted;localStatic.ambientFaunaCount=wild.fauna;localStatic.vegetationCount=Object.entries(wilderness.localFamilyCounts||{}).filter(([k])=>["grass","flower","bush","sapling","reed"].includes(k)).reduce((sum,[,v])=>sum+Number(v||0),0);
    localStatic.triangleEstimate+=wild.triangles;localStatic.drawCallEstimate+=wild.drawCalls;
  }else{
    rebuildLocalFauna(null,frame,null);wilderness={...wilderness,localActive:false,localAmbientFaunaActiveCount:0};
    const y=localGroundHeightUnits(0,0,frame)+.02;addLocalStatic("SeedWaterSurface","box",localStaticMaterials.water,0,y,0,dims.patchWidth*.88/unit,.035,dims.patchHeight*.88/unit);
    localStatic.waterCount=1;localStatic.triangleEstimate+=12;localStatic.drawCallEstimate+=1;
  }
  localStatic.entityCount=localStaticRoot.children.length;localStatic.active=localStatic.entityCount>0||localFaunaActors.length>0;localStatic.buildTimeMs=Number((performance.now()-started).toFixed(3));
}
function scheduleLocalStaticPresentationRefresh(){
  if(localStaticRefreshScheduled||!displayResource)return;
  // Semantic/static detail may not advance ahead of the supporting terrain cell.
  // Preserve the current ready presentation during asynchronous refinement.
  if(localResources.requestedSignature&&displayResource.signature!==localResources.requestedSignature)return;
  const desired=settlementRevealTierForScalar();
  if(localStatic.signature===displayResource.signature&&localStatic.revealTier===desired)return;
  localStaticRefreshScheduled=true;
  setTimeout(()=>{
    localStaticRefreshScheduled=false;
    if(displayResource&&(!localResources.requestedSignature||displayResource.signature===localResources.requestedSignature))rebuildLocalStaticPresentation(displayResource);
  },0);
}
// ---- Cooperative LOD preparation -------------------------------------------
// A local LOD resource (heightfield mesh + detail texture + 3x surround texture)
// is produced by a generator that yields after every row. The pump runs it in
// bounded slices off the wheel/pinch path; only a finished resource is ever
// swapped in (double buffering), and the previous one stays visible meanwhile.
function* tangentMeshSteps(job){
  const {dims,lat0,lon0}=job,cosLat=Math.max(.08,Math.cos(lat0));
  const columns=Math.max(2,Math.ceil(dims.patchWidth/dims.sampleSpacingMeters)+1);
  const rows=Math.max(2,Math.ceil(dims.patchHeight/dims.sampleSpacingMeters)+1);
  const positions=new Float32Array(columns*rows*3),normals=new Float32Array(columns*rows*3),uvs=new Float32Array(columns*rows*2);
  const frame={lat0,lon0,dims,groundDetailWeight:job.groundDetailWeight,centerElevation:job.centerElevation};
  for(let z=0;z<rows;z++){
    const vz=z/(rows-1),northMeters=(vz-.5)*dims.patchHeight;
    for(let x=0;x<columns;x++){
      const ux=x/(columns-1),eastMeters=(ux-.5)*dims.patchWidth,v=z*columns+x;
      // Macro height identity is clamped to the tier's relief window, micro
      // relief is layered in near the ground, and the outer 12% feathers down
      // to the coarse surround so the LOD edge never reads as a slab.
      positions[v*3]=eastMeters/dims.metersPerUnit;positions[v*3+1]=localGroundHeightUnits(eastMeters,northMeters,frame);positions[v*3+2]=-northMeters/dims.metersPerUnit;
      normals[v*3+1]=1;uvs[v*2]=ux;uvs[v*2+1]=vz;
    }
    yield 1;
  }
  const indices=new Uint32Array((columns-1)*(rows-1)*6);let k=0;
  for(let z=0;z<rows-1;z++)for(let x=0;x<columns-1;x++){const a=z*columns+x,b=a+1,c=a+columns,d=c+1;indices[k++]=a;indices[k++]=c;indices[k++]=b;indices[k++]=b;indices[k++]=c;indices[k++]=d;}
  return {positions,normals,uvs,indices,columns,rows};
}
// Presentation-only relief and land cover, anchored to continuous world meters.
// Each octave fades in once it spans >2 texels, so every LOD shows structure at
// its own scale without aliasing, and finer LODs add detail instead of blur.
const TERRAIN_DETAIL_OCTAVES=Object.freeze([[48000,700],[16000,320],[5200,140],[1700,56],[560,20],[180,7],[60,2.4],[20,.8]]);
function detailOctaveWeight(wavelengthMeters,metersPerTexel){return smoothstep01((wavelengthMeters/Math.max(1e-6,metersPerTexel)-2)/4);}
function terrainDetailHeight(east,north,metersPerTexel,salt){
  let h=0;
  for(let k=0;k<TERRAIN_DETAIL_OCTAVES.length;k++){
    const [wavelength,amplitude]=TERRAIN_DETAIL_OCTAVES[k],w=detailOctaveWeight(wavelength,metersPerTexel);
    if(w<=0)break;
    h+=surfaceValueNoise(east,north,wavelength,salt+k*131)*amplitude*w;
  }
  return h;
}
function landCoverTint(east,north,metersPerTexel,salt,elevation){
  // Forest stands (~1-3 km), meadow/field parcels (~300-600 m) and copses
  // (~80 m). Coarse tiers get the averaged colour, not aliased speckle.
  const wForest=detailOctaveWeight(2400,metersPerTexel),wField=detailOctaveWeight(420,metersPerTexel),wCopse=detailOctaveWeight(90,metersPerTexel);
  if(wForest<=0)return [0,0,0];
  const alpine=smoothstep01((elevation-2200)/900);
  const forestField=surfaceValueNoise(east,north,2400,salt+7)+surfaceValueNoise(east,north,900,salt+11)*.55*wField;
  const forest=smoothstep01((forestField-.02)/.12)*wForest*(1-alpine);
  const parcel=surfaceValueNoise(east,north,420,salt+19)*wField;
  const copse=smoothstep01((surfaceValueNoise(east,north,90,salt+23)-.18)/.1)*wCopse*(1-forest)*(1-alpine);
  const dryField=smoothstep01((parcel-.16)/.08)*(1-forest)*(1-alpine);
  const meadow=smoothstep01((-parcel-.16)/.08)*(1-forest)*(1-alpine);
  // Fine canopy/grass mottling (~150 m and ~50 m) so forest and meadow
  // interiors keep readable texture at 1 km-200 m footprints.
  const mottle=surfaceValueNoise(east,north,150,salt+29)*detailOctaveWeight(150,metersPerTexel)*(.09+.05*forest)+surfaceValueNoise(east,north,50,salt+31)*detailOctaveWeight(50,metersPerTexel)*(.06+.04*forest);
  return [
    mottle*.8-.070*forest-.045*copse+.085*dryField+.030*meadow,
    mottle-.050*forest-.030*copse+.055*dryField+.060*meadow,
    mottle*.55-.050*forest-.030*copse+.005*dryField+.010*meadow
  ];
}
function* surfaceTextureSteps(job,spanEast,spanNorth,size,featherEdges){
  const lat0=job.lat0,lon0=job.lon0,data=new Uint8ClampedArray(size*size*4);
  const metersPerTexel=Math.max(spanEast,spanNorth)/Math.max(1,size);
  const useMicroDetail=metersPerTexel<=4;
  const phase=seededUnit("local-texture-macro")*Math.PI*2;
  const contourStrength=metersPerTexel<=100?.10:metersPerTexel<=1200?.060:.026;
  const detailSalt=((seededUnit("local-terrain-detail")*1e6)|0)^0x2c1b3c6d;
  const light=(()=>{const v=[-.55,.62,.56],l=Math.hypot(...v);return v.map(x=>x/l);})();
  const flatShade=light[2];
  // Fine terrain/biome detail is sampled in the Campaign-SEED registered
  // coordinate frame. Patch recentering, viewport changes and LOD changes may
  // change presentation, but never the world-space inputs to the detail field.
  const centerRegistered=job.biomeCoordinateProof?.registeredMeters||canonicalRegisteredMetersForLatLon(lat0,lon0);
  const centerRegisteredEast=Number(centerRegistered.east??centerRegistered.eastMeters??0),registeredPeriod=Math.PI*2*WORLD_RADIUS_METERS;
  const authoritySize=Math.max(2,Math.min(size,128)),authorityCache=new Array(authoritySize*authoritySize);
  const unwrapRegisteredEast=value=>{
    const delta=Number(value||0)-centerRegisteredEast;
    return centerRegisteredEast+(delta-Math.round(delta/registeredPeriod)*registeredPeriod);
  };
  const authorityAt=(ax,ay)=>{
    const ix=Math.max(0,Math.min(authoritySize-1,ax)),iy=Math.max(0,Math.min(authoritySize-1,ay)),key=iy*authoritySize+ix;
    if(authorityCache[key])return authorityCache[key];
    const au=ix/(authoritySize-1),av=iy/(authoritySize-1);
    const aeast=(au-.5)*spanEast,anorth=(.5-av)*spanNorth,geo=canonicalLatLonForLocalOffset(lat0,lon0,aeast,anorth);
    const alat=geo.latitudeRadians,alon=geo.longitudeRadians;
    const natural=geography.sampleLatLon(alat,alon),registered=canonicalRegisteredMetersForLatLon(alat,alon);
    return authorityCache[key]={natural,registeredEastMeters:unwrapRegisteredEast(registered.eastMeters),registeredNorthMeters:Number(registered.northMeters||0)};
  };
  const mixSample=(ux,vz)=>{
    const gx=ux*(authoritySize-1),gy=vz*(authoritySize-1),x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(authoritySize-1,x0+1),y1=Math.min(authoritySize-1,y0+1),tx=gx-x0,ty=gy-y0;
    const aa=authorityAt(x0,y0),bb=authorityAt(x1,y0),cc=authorityAt(x0,y1),dd=authorityAt(x1,y1);
    const a=aa.natural,b=bb.natural,c=cc.natural,d=dd.natural;
    const bilerp=(va,vb,vc,vd)=>lerp(lerp(Number(va)||0,Number(vb)||0,tx),lerp(Number(vc)||0,Number(vd)||0,tx),ty);
    const color=[0,1,2].map(i=>bilerp(a.color?.[i],b.color?.[i],c.color?.[i],d.color?.[i]));
    const landWeight=bilerp(a.land?1:0,b.land?1:0,c.land?1:0,d.land?1:0);
    return {
      land:landWeight>=.5,color,elevationMeters:bilerp(a.elevationMeters,b.elevationMeters,c.elevationMeters,d.elevationMeters),
      registeredEastMeters:bilerp(aa.registeredEastMeters,bb.registeredEastMeters,cc.registeredEastMeters,dd.registeredEastMeters),
      registeredNorthMeters:bilerp(aa.registeredNorthMeters,bb.registeredNorthMeters,cc.registeredNorthMeters,dd.registeredNorthMeters)
    };
  };
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const ux=(x+.5)/size,vz=(y+.5)/size;
      const east=(ux-.5)*spanEast,north=(.5-vz)*spanNorth;
      const sample=mixSample(ux,vz);
      const base=Array.isArray(sample?.color)?sample.color:(sample?.land?[.28,.46,.20]:[.06,.22,.42]);
      const elevation=Number(sample?.elevationMeters||0);
      const relief=clamp(elevation/5200,0,1);
      // Detail frequencies are anchored to canonical SEED-registered meters.
      // Rebuilding the same coordinates from a different patch/LOD therefore
      // reveals the same field instead of rolling a new patch-relative pattern.
      const worldEast=sample.registeredEastMeters,worldNorth=sample.registeredNorthMeters;
      const macro=worldSurfaceDetailValue(worldEast,worldNorth,metersPerTexel,phase);
      let shade=1,cover=[0,0,0];
      if(sample?.land){
        // Hillshade of authoritative elevation + scale-appropriate detail relief.
        const step=metersPerTexel,dux=step/spanEast,dvz=step/spanNorth;
        const sx=mixSample(Math.min(1,ux+dux),vz),sy=mixSample(ux,Math.max(0,vz-dvz));
        const h0=elevation+terrainDetailHeight(worldEast,worldNorth,metersPerTexel,detailSalt);
        const hx=Number(sx.elevationMeters||0)+terrainDetailHeight(sx.registeredEastMeters,sx.registeredNorthMeters,metersPerTexel,detailSalt);
        const hy=Number(sy.elevationMeters||0)+terrainDetailHeight(sy.registeredEastMeters,sy.registeredNorthMeters,metersPerTexel,detailSalt);
        const exaggeration=2.2,gx=(hx-h0)/step*exaggeration,gy=(hy-h0)/step*exaggeration,nl=Math.hypot(gx,gy,1);
        const lit=(-gx*light[0]-gy*light[1]+light[2])/nl;
        // Keep hillshade readable without clipping bright alpine surfaces.
        shade=clamp(1+(lit-flatShade)*1.0,.72,1.18);
        cover=landCoverTint(worldEast,worldNorth,metersPerTexel,detailSalt,elevation);
      }
      const identityTint=sample?.land?[relief*.075,relief*.065,relief*.035]:[-.012,-.004,.028];
      const contour=.5+.5*Math.sin((elevation/420)*Math.PI*2);
      const contourLine=Math.pow(1-contour,10)*contourStrength;
      const authoritative=base.map((v,i)=>clamp((v+macro*(i===2?.70:1)+identityTint[i]+cover[i]-contourLine*(i===2?.55:1))*shade,0,1));
      let displayColor=authoritative;
      if(useMicroDetail){
        const micro=localSurfaceSample(worldEast,worldNorth,sample).color;
        // As the physical texel size approaches gameplay scale, let canonical
        // registered-meter micro terrain carry more of the surface. This keeps
        // close props visually grounded while coarser views retain macro identity.
        const closeWeight=smoothstep01((4-metersPerTexel)/3.5),microWeight=lerp(.38,.72,closeWeight);
        displayColor=authoritative.map((v,i)=>clamp(v*(1-microWeight)+micro[i]*microWeight,0,1));
      }
      // High peaks are legitimately snow-covered, but the canonical near-white
      // macro palette plus hillshade used to saturate into featureless white.
      // Compress only alpine highlights, preserving SEED-derived hue/detail.
      if(sample?.land&&elevation>3400){
        const snowWeight=smoothstep01((elevation-3400)/2600),cool=[0,.008,.018];
        displayColor=displayColor.map((v,i)=>{
          const compressed=v<=.52?v:.52+(v-.52)*.56;
          return clamp(lerp(v,compressed,snowWeight)+cool[i]*snowWeight,0,.84);
        });
      }
      // Fine canonical albedo roughness keeps close alpine terrain readable
      // without inventing patch-local noise. Frequencies remain registered-meter
      // anchored, so the same coordinate has the same mottling in every rebuild.
      if(sample?.land&&metersPerTexel<=8){
        const coarseScale=Math.max(2,metersPerTexel*6),fineScale=Math.max(.75,metersPerTexel*2);
        const rough=surfaceValueNoise(worldEast,worldNorth,coarseScale,detailSalt+211)*.105+
          surfaceValueNoise(worldEast,worldNorth,fineScale,detailSalt+233)*.045;
        displayColor=displayColor.map((v,i)=>clamp(v+rough*(i===2?.82:i===1?.94:1),0,.86));
      }
      const rgba=rgbaFromColor(displayColor),i=(y*size+x)*4;
      const edgeDistance=Math.min(ux,1-ux,vz,1-vz);
      data[i]=rgba[0];data[i+1]=rgba[1];data[i+2]=rgba[2];data[i+3]=featherEdges?Math.round(255*smoothstep01(clamp(edgeDistance/.18,0,1))):255;
    }
    yield 1;
  }
  return {
    data,size,metersPerTexel,
    coordinateAuthority:"Campaign-SEED + SeedCoordinateFabric.registeredMeters",
    coordinateRevision:coordinateFabricAuthority()?.revisionSignature||null,
    patchRelativeBiomeNoise:false
  };
}
function stitchSurroundCenterToDetail(detail,surround,spanFactor){
  const ds=Number(detail?.size||0),ss=Number(surround?.size||0),factor=Math.max(1,Number(spanFactor||1));
  if(!ds||!ss||!detail?.data||!surround?.data||factor<=1)return;
  // The central 1/spanFactor area of the surround covers exactly the detail
  // patch's world bounds. Blend that center toward the already-generated detail
  // using the same edge feather curve as the foreground patch. The outer
  // surround remains coarse/bounded, while the overlap becomes photometrically
  // continuous instead of exposing a rectangular LOD seam.
  for(let sy=0;sy<ss;sy++){
    const sv=(sy+.5)/ss,dv=(sv-.5)*factor+.5;
    if(dv<=0||dv>=1)continue;
    const dy=Math.max(0,Math.min(ds-1,Math.floor(dv*ds)));
    for(let sx=0;sx<ss;sx++){
      const su=(sx+.5)/ss,du=(su-.5)*factor+.5;
      if(du<=0||du>=1)continue;
      const dx=Math.max(0,Math.min(ds-1,Math.floor(du*ds)));
      const edge=Math.min(du,1-du,dv,1-dv),w=smoothstep01(clamp(edge/.18,0,1));
      if(w<=0)continue;
      const si=(sy*ss+sx)*4,di=(dy*ds+dx)*4;
      surround.data[si]=Math.round(lerp(surround.data[si],detail.data[di],w));
      surround.data[si+1]=Math.round(lerp(surround.data[si+1],detail.data[di+1],w));
      surround.data[si+2]=Math.round(lerp(surround.data[si+2],detail.data[di+2],w));
    }
  }
}
function* localResourceSteps(job){
  const meshData=yield* tangentMeshSteps(job);
  const size=LOCAL_DETAIL_LEVELS[job.levelIndex].textureSize;
  const detail=yield* surfaceTextureSteps(job,job.dims.patchWidth,job.dims.patchHeight,size,true);
  const surround=yield* surfaceTextureSteps(job,job.dims.patchWidth*LOCAL_SURROUND_SPAN_FACTOR,job.dims.patchHeight*LOCAL_SURROUND_SPAN_FACTOR,size,false);
  stitchSurroundCenterToDetail(detail,surround,LOCAL_SURROUND_SPAN_FACTOR);
  return {meshData,detail,surround};
}
function textureFromPixels(pixels){
  const canvas2d=document.createElement("canvas");canvas2d.width=pixels.size;canvas2d.height=pixels.size;
  // Preserve the detail texture's edge alpha; opacityMap uses this exact
  // channel to feather the canonical child into its world-matched surround.
  const ctx=canvas2d.getContext("2d",{alpha:true});ctx.putImageData(new ImageData(pixels.data,pixels.size,pixels.size),0,0);
  const texture=new pc.Texture(device,{width:pixels.size,height:pixels.size,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
  texture.flipY=true;
  texture.addressU=pc.ADDRESS_CLAMP_TO_EDGE;texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;
  texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;texture.magFilter=pc.FILTER_LINEAR;texture.anisotropy=localTextureAnisotropy();texture.setSource(canvas2d);
  return texture;
}
function skirtMeshForDims(dims,spanFactor=LOCAL_SURROUND_SPAN_FACTOR){
  const halfX=dims.patchWidth*spanFactor*.5/dims.metersPerUnit,halfZ=dims.patchHeight*spanFactor*.5/dims.metersPerUnit,mesh=new pc.Mesh(device);
  mesh.setPositions([-halfX,0,-halfZ,halfX,0,-halfZ,-halfX,0,halfZ,halfX,0,halfZ]);
  mesh.setNormals([0,1,0,0,1,0,0,1,0,0,1,0]);mesh.setUvs(0,[0,1,1,1,0,0,1,0]);mesh.setIndices([0,2,1,1,2,3]);mesh.update();
  return mesh;
}
function finalizeLocalResource(job,result){
  const started=performance.now(),dims=job.dims,{meshData,detail,surround}=result;
  const mesh=new pc.Mesh(device);mesh.setPositions(meshData.positions);mesh.setNormals(meshData.normals);mesh.setUvs(0,meshData.uvs);mesh.setIndices(meshData.indices);mesh.update();
  mesh.incRefCount();// owned by the LRU cache, not by whichever MeshInstance shows it
  const skirtMesh=skirtMeshForDims(dims,LOCAL_SURROUND_SPAN_FACTOR);skirtMesh.incRefCount();
  const detailTexture=textureFromPixels(detail),surroundTexture=textureFromPixels(surround),textureSize=detail.size;
  const detailMetersPerTexel=detail.metersPerTexel,surroundMetersPerTexel=surround.metersPerTexel;
  const vertices=meshData.positions.length/3,triangles=meshData.indices.length/3;
  const estimatedBytes=meshData.positions.byteLength+meshData.normals.byteLength+meshData.uvs.byteLength+meshData.indices.byteLength+textureSize*textureSize*4*2;
  const wildernessPlan=prepareLocalWildernessPlan(job);
  const regenerationSignature=localResourceRegenerationSignature(job);
  const resource={signature:job.signature,regenerationSignature,levelIndex:job.levelIndex,dims,lat0:job.lat0,lon0:job.lon0,spatialCell:job.spatialCell,groundDetailWeight:job.groundDetailWeight,centerElevation:job.centerElevation,biomeCoordinateProof:job.biomeCoordinateProof,builtAsPrewarm:job.prewarm,prefetchKind:job.prewarmKind||null,mesh,skirtMesh,detailTexture,surroundTexture,wildernessPlan,estimatedBytes,
    detail:{active:true,level:dims.levelId,band:dims.band,sampleSpacingMeters:dims.sampleSpacingMeters,geometrySampleSpacingMeters:dims.sampleSpacingMeters,textureSize,sourceTextureWidth:textureSize,sourceTextureHeight:textureSize,detailMetersPerTexel:Number(detailMetersPerTexel.toFixed(3)),surroundMetersPerTexel:Number(surroundMetersPerTexel.toFixed(3)),anisotropy:localTextureAnisotropy(),minFilter:"linear-mipmap-linear",magFilter:"linear",detailBandCount:surfaceDetailBandCount(detailMetersPerTexel),surroundDetailBandCount:surfaceDetailBandCount(surroundMetersPerTexel),
      coordinateAuthority:detail.coordinateAuthority,coordinateRevision:detail.coordinateRevision,patchRelativeBiomeNoise:false,biomeCoordinateProof:job.biomeCoordinateProof,
      visibleWidthMeters:dims.visibleWidth,visibleHeightMeters:dims.visibleHeight,patchWidthMeters:dims.patchWidth,patchHeightMeters:dims.patchHeight,columns:meshData.columns,rows:meshData.rows,vertices,triangles,estimatedBytes,buildTimeMs:Number(job.busyMs.toFixed(3)),activePatchCount:1,signature:job.signature}};
  localResourceCache.set(job.signature,resource);
  const evicted=localRecentEvictions.get(job.signature)||null;
  if(evicted){
    localResources.revisitCount++;localResources.revisitRegenerationSignature=regenerationSignature;
    localResources.revisitRegenerationPass=String(evicted.regenerationSignature||"")===String(regenerationSignature);
    localRecentEvictions.delete(job.signature);
  }
  setLocalResidencyState(job.signature,"ready",{cellId:job.spatialCell?.id||null,level:dims.levelId,regenerationSignature,prefetchKind:job.prewarm?job.prewarmKind:null,readyAtMs:performance.now()});
  if(job.prewarm&&job.prewarmKind==="motion"){localResources.prefetchCompleted++;localMotionPrefetchTargets.delete(job.signature);}
  trimLocalResourceCache();
  localResources.cachedResourceCount=localResourceCache.size;
  localResources.estimatedCacheBytes=Array.from(localResourceCache.values()).reduce((sum,item)=>sum+(item.estimatedBytes||0),0);
  return resource;
}
function destroyCachedLocalResource(resource){
  if(!resource||resource===displayResource)return;
  for(const mesh of [resource.mesh,resource.skirtMesh]){if(!mesh)continue;mesh.decRefCount();if(mesh.refCount<1)mesh.destroy();localResources.destroyedMeshes++;}
  resource.detailTexture?.destroy?.();resource.surroundTexture?.destroy?.();localResources.destroyedTextures+=2;
}
function trimLocalResourceCache(){
  if(localResourceCache.size<=LOCAL_RESOURCE_CACHE_LIMIT)return;
  const now=performance.now(),candidates=[...localResourceCache.entries()].filter(([,resource])=>resource!==displayResource&&resource?.signature!==localResources.requestedSignature&&resource?.signature!==localResources.preparingSignature);
  candidates.sort((a,b)=>{
    const ae=localResidency.get(a[0])||{},be=localResidency.get(b[0])||{};
    const ag=ae.state==="grace"&&Number(ae.graceUntilMs||0)>now,bg=be.state==="grace"&&Number(be.graceUntilMs||0)>now;
    if(ag!==bg)return ag?1:-1;
    return Number(ae.lastStateAtMs||0)-Number(be.lastStateAtMs||0);
  });
  for(const [key,resource] of candidates){
    if(localResourceCache.size<=LOCAL_RESOURCE_CACHE_LIMIT)break;
    const entry=localResidency.get(key)||{};
    localResourceCache.delete(key);destroyCachedLocalResource(resource);
    localRecentEvictions.set(key,{regenerationSignature:resource.regenerationSignature||null,cellId:resource.spatialCell?.id||null,evictedAtMs:now});
    setLocalResidencyState(key,"evicted",{...entry,regenerationSignature:resource.regenerationSignature||entry.regenerationSignature||null,evictedAtMs:now});
    localResources.evictions++;localResources.lastEvictionReason=entry.state==="grace"?"bounded-grace-pressure":"bounded-lru";
  }
  pruneLocalResidency();
}
function spatialDepthForLevel(index){
  const level=LOCAL_DETAIL_LEVELS[clamp(Math.round(index),0,LOCAL_DETAIL_LEVELS.length-1)];
  const maxCellSize=Math.max(1,Number(level.visibleHeightMeters||1)*SPATIAL_CELL_MAX_LEVEL_HEIGHT_RATIO);
  // ceil() guarantees the selected canonical cell never exceeds the safe span.
  return clamp(Math.ceil(Math.log2(SPATIAL_LOD_ROOT_CELL_METERS/maxCellSize)),0,SPATIAL_LOD_MAX_DEPTH);
}
function spatialCellAtDepth(depth,registered){
  const d=clamp(Math.round(depth),0,SPATIAL_LOD_MAX_DEPTH),size=SPATIAL_LOD_ROOT_CELL_METERS/Math.pow(2,d);
  const x=Math.floor(Number(registered.eastMeters||0)/size),y=Math.floor(Number(registered.northMeters||0)/size);
  const revision=coordinateFabricAuthority()?.revisionSignature||"legacy-coordinate";
  const id=["SLOD",revision,d,x,y].join("|");
  const minEast=x*size,minNorth=y*size,maxEast=minEast+size,maxNorth=minNorth+size;
  const centerRegistered={eastMeters:minEast+size*.5,northMeters:minNorth+size*.5};
  const ll=coordinateFabricAuthority()?.latLonForRegisteredMeters?.(centerRegistered.eastMeters,centerRegistered.northMeters)||null;
  return Object.freeze({id,depth:d,cellX:x,cellY:y,cellSizeMeters:Number(size.toFixed(3)),
    worldBounds:Object.freeze({minEastMeters:Number(minEast.toFixed(3)),maxEastMeters:Number(maxEast.toFixed(3)),minNorthMeters:Number(minNorth.toFixed(3)),maxNorthMeters:Number(maxNorth.toFixed(3))}),
    centerRegisteredMeters:Object.freeze({east:Number(centerRegistered.eastMeters.toFixed(3)),north:Number(centerRegistered.northMeters.toFixed(3))}),
    centerLatitudeRadians:Number(ll?.latitudeRadians||0),centerLongitudeRadians:Number(ll?.longitudeRadians||0)});
}
function canonicalSpatialCellFor(index,lat,lon){
  const registered=canonicalRegisteredMetersForLatLon(lat,lon),depth=spatialDepthForLevel(index),cell=spatialCellAtDepth(depth,registered);
  const parent=depth>0?spatialCellAtDepth(depth-1,registered):null;
  const renderParent=index>0?spatialCellAtDepth(spatialDepthForLevel(index-1),registered):null;
  return Object.freeze({...cell,parentId:parent?.id||null,renderParentId:renderParent?.id||null,
    levelIndex:index,levelId:LOCAL_DETAIL_LEVELS[index]?.id||null,
    registeredFocus:Object.freeze({east:Number(registered.eastMeters.toFixed(3)),north:Number(registered.northMeters.toFixed(3))})});
}
function localSignatureFor(index,lat,lon){
  const d=patchDimensionsForLevel(index),cell=canonicalSpatialCellFor(index,lat,lon),revision=coordinateFabricAuthority()?.revisionSignature||"legacy-coordinate";
  return [activeSeed,revision,cell.id,d.levelId,Math.ceil(d.patchWidth/d.sampleSpacingMeters),Math.ceil(d.patchHeight/d.sampleSpacingMeters)].join("|");
}
function localResourceRegenerationSignature(job){
  const proof=job?.biomeCoordinateProof||{};
  return "LRES-"+seededHash32([
    "temporal-residency-v1",job?.spatialCell?.id||"",job?.dims?.levelId||"",
    proof.signature||proof.coordinateRevision||"",job?.dims?.sampleSpacingMeters||0
  ].join("|")).toString(16).toUpperCase().padStart(8,"0");
}
function pruneLocalResidency(){
  while(localResidency.size>LOCAL_RESIDENCY_RECORD_LIMIT){
    const first=localResidency.keys().next().value;if(first==null)break;
    if(first===displayResource?.signature){const entry=localResidency.get(first);localResidency.delete(first);localResidency.set(first,entry);continue;}
    localResidency.delete(first);
  }
  while(localRecentEvictions.size>LOCAL_PREFETCH_RECORD_LIMIT)localRecentEvictions.delete(localRecentEvictions.keys().next().value);
  while(localMotionPrefetchTargets.size>LOCAL_PREFETCH_RECORD_LIMIT)localMotionPrefetchTargets.delete(localMotionPrefetchTargets.keys().next().value);
}
function setLocalResidencyState(signature,state,extra={}){
  if(!signature)return null;
  const now=performance.now(),previous=localResidency.get(signature)||{};
  const next={...previous,...extra,signature,state,lastStateAtMs:now};
  localResidency.delete(signature);localResidency.set(signature,next);pruneLocalResidency();return next;
}
function updateLocalMotion(lat,lon){
  const current=canonicalRegisteredMetersForLatLon(lat,lon),previous=localLastRequestRegistered;
  if(previous){
    const east=Number(current.eastMeters||0)-Number(previous.eastMeters||0),north=Number(current.northMeters||0)-Number(previous.northMeters||0),magnitude=Math.hypot(east,north);
    if(magnitude>.01)localMotionVector={east,north,magnitude};
  }
  localLastRequestRegistered={eastMeters:Number(current.eastMeters||0),northMeters:Number(current.northMeters||0)};
}
function localResidencyDiagnostics(){
  const now=performance.now(),counts={requested:0,preparing:0,ready:0,active:0,grace:0,evicted:0};
  const cells=[];
  for(const [signature,entry] of localResidency){
    let state=entry.state;
    if(state==="grace"&&Number(entry.graceUntilMs||0)<=now){
      state=localResourceCache.has(signature)?"ready":"evicted";
      entry.state=state;entry.lastStateAtMs=now;localResidency.set(signature,entry);
    }
    if(counts[state]!=null)counts[state]++;
    if(cells.length<20)cells.push(Object.freeze({
      signature,state,cellId:entry.cellId||null,level:entry.level||null,
      graceRemainingMs:state==="grace"?Math.max(0,Number(entry.graceUntilMs||0)-now):0,
      regenerationSignature:entry.regenerationSignature||null,prefetchKind:entry.prefetchKind||null
    }));
  }
  localResources.requestedCellCount=counts.requested;localResources.preparingCellCount=counts.preparing;localResources.readyCellCount=counts.ready;
  localResources.activeCellCount=counts.active;localResources.graceResidentCellCount=counts.grace;localResources.evictedCellCount=counts.evicted;
  return Object.freeze({
    revision:"temporal-residency-v1",counts:Object.freeze({...counts}),cells:Object.freeze(cells),
    parentFallbackCount:Number(localResources.parentFallbackCount||0),rootFallbackCount:Number(localResources.rootFallbackCount||0),missingCoverageCount:Number(localResources.missingCoverageCount||0),
    graceReuseCount:Number(localResources.graceReuseCount||0),prefetch:Object.freeze({
      requests:Number(localResources.prefetchRequests||0),completed:Number(localResources.prefetchCompleted||0),
      hits:Number(localResources.prefetchHits||0),misses:Number(localResources.prefetchMisses||0),
      pendingTargets:localMotionPrefetchTargets.size
    }),
    handoff:Object.freeze({
      lastLatencyMs:Number(localResources.lastHandoffLatencyMs||0),longestLatencyMs:Number(localResources.longestHandoffLatencyMs||0),
      fallbackActive:Boolean(localResources.standInActive),readyChild:Boolean(localResources.requestedSignature&&localResources.activeSignature===localResources.requestedSignature)
    }),
    revisit:Object.freeze({
      count:Number(localResources.revisitCount||0),regenerationSignature:localResources.revisitRegenerationSignature||null,
      pass:localResources.revisitRegenerationPass!==false
    }),
    budget:Object.freeze({requestsPerFrame:1,buildJobs:1,prefetchQueue:1,sliceBudgetMs:LOCAL_PREP_SLICE_BUDGET_MS,cacheLimit:LOCAL_RESOURCE_CACHE_LIMIT,graceMs:LOCAL_GRACE_RESIDENCY_MS}),
    motion:Object.freeze({east:Number(localMotionVector.east.toFixed(3)),north:Number(localMotionVector.north.toFixed(3)),magnitude:Number(localMotionVector.magnitude.toFixed(3))}),
    bounded:true,fullWorldScan:false
  });
}
function motionPrefetchCandidate(index){
  if(!displayResource||localMotionVector.magnitude<1)return null;
  const cell=canonicalSpatialCellFor(index,zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians),size=Number(cell.cellSizeMeters||0);
  if(size<=0)return null;
  const ax=Math.abs(localMotionVector.east),ay=Math.abs(localMotionVector.north);
  let dx=0,dy=0;
  if(ax>=ay*.45)dx=localMotionVector.east>0?1:-1;
  if(ay>=ax*.45)dy=localMotionVector.north>0?1:-1;
  if(dx===0&&dy===0)return null;
  const east=Number(cell.centerRegisteredMeters?.east||0)+dx*size,north=Number(cell.centerRegisteredMeters?.north||0)+dy*size;
  const ll=coordinateFabricAuthority()?.latLonForRegisteredMeters?.(east,north);if(!ll)return null;
  const signature=localSignatureFor(index,ll.latitudeRadians,ll.longitudeRadians);
  return {index,lat:ll.latitudeRadians,lon:ll.longitudeRadians,signature,cellId:canonicalSpatialCellFor(index,ll.latitudeRadians,ll.longitudeRadians).id};
}
function startLocalJob(index,lat,lon,signature,prewarm,prewarmKind="lod"){
  const dims=patchDimensionsForLevel(index),size=LOCAL_DETAIL_LEVELS[index].textureSize,spatialCell=canonicalSpatialCellFor(index,lat,lon);
  const anchorLat=spatialCell.centerLatitudeRadians,anchorLon=spatialCell.centerLongitudeRadians;
  const columns=Math.max(2,Math.ceil(dims.patchWidth/dims.sampleSpacingMeters)+1),rows=Math.max(2,Math.ceil(dims.patchHeight/dims.sampleSpacingMeters)+1);
  const biomeCoordinateProof=localBiomeCoordinateProof(anchorLat,anchorLon);
  const job={token:++localPreparationToken,signature,levelIndex:index,dims,lat0:anchorLat,lon0:anchorLon,requestedLat0:lat,requestedLon0:lon,spatialCell,prewarm,prewarmKind,groundDetailWeight:groundDetailWeightForLevel(index),centerElevation:Number(geography?.sampleLatLon?.(anchorLat,anchorLon)?.elevationMeters||0),biomeCoordinateProof,
    totalSteps:rows+size*2,steps:0,busyMs:0,slices:0,maxSliceMs:0,startedAtMs:performance.now(),iterator:null};
  job.iterator=localResourceSteps(job);
  localJob=job;localResources.cacheMisses+=prewarm?0:1;
  setLocalResidencyState(signature,"preparing",{cellId:spatialCell.id,level:dims.levelId,prefetchKind:prewarm?prewarmKind:null,requestedAtMs:prewarm?null:performance.now()});
  localResources.preparing=true;localResources.preparingPrewarm=prewarm;localResources.preparingSignature=signature;localResources.preparingLevel=dims.levelId;localResources.preparationProgress=0;
  localResources.lastPreparationQueuedAtMs=Number(job.startedAtMs.toFixed(3));localFrameStats.maxDuringPreparationMs=0;
  scheduleLocalPump();
}
let localPumpScheduled=false;
function scheduleLocalPump(){
  if(localPumpScheduled||!localJob)return;
  localPumpScheduled=true;
  // Macrotask yield between slices lets input, rAF and rendering run; the
  // generator never holds the main thread longer than one slice budget.
  setTimeout(pumpLocalPreparation,0);
}
function pumpLocalPreparation(){
  localPumpScheduled=false;
  const job=localJob;if(!job||!device)return;
  const sliceStart=performance.now();let step=null;
  try{
    while(!(step=job.iterator.next()).done){job.steps++;if(performance.now()-sliceStart>=LOCAL_PREP_SLICE_BUDGET_MS)break;}
  }catch(error){
    // A failed preparation must never wedge the pipeline: drop it, keep the
    // last valid representation on screen and record the failure.
    const failedSignature=localJob?.signature||null;
    localJob=null;localQueuedRequest=null;if(failedSignature)localResidency.delete(failedSignature);localMotionPrefetchTargets.delete(failedSignature);
    localResources.preparing=false;localResources.preparingSignature=null;localResources.preparingLevel=null;
    localResources.failedPreparations=(localResources.failedPreparations||0)+1;localResources.lastPreparationError=String(error?.message||error);
    localResources.pendingPreparationCount=0;
    console.error("Local LOD preparation failed.",error);
    return;
  }
  let sliceMs=performance.now()-sliceStart;
  if(step.done){
    const resource=finalizeLocalResource(job,step.value);
    sliceMs=performance.now()-sliceStart;
    localJob=null;
    localResources.lastBuildMs=Number((job.busyMs+sliceMs).toFixed(3));
    resource.detail.buildTimeMs=localResources.lastBuildMs;
    localResources.preparing=false;localResources.preparingSignature=null;localResources.preparingLevel=null;localResources.preparationProgress=1;
    localResources.lastPreparationWallMs=Number((performance.now()-job.startedAtMs).toFixed(3));
    localResources.lastPreparationBusyMs=Number((job.busyMs+sliceMs).toFixed(3));
    localResources.lastPreparationSlices=job.slices+1;
    localResources.lastPreparationCompletedAtMs=Number(performance.now().toFixed(3));
    localResources.maxFrameMsDuringPreparation=Number(localFrameStats.maxDuringPreparationMs.toFixed(3));
    localResources.preparedSignature=resource.signature;
    if(job.prewarm)localResources.prewarmCompleted++;
    job.slices++;job.maxSliceMs=Math.max(job.maxSliceMs,sliceMs);localResources.maxPreparationSliceMs=Math.max(localResources.maxPreparationSliceMs,Number(sliceMs.toFixed(3)));
    const queued=localQueuedRequest;localQueuedRequest=null;
    if(resource.signature===localResources.requestedSignature){activateLocalDetailResource(resource.signature,false);refreshZoomPresentation();}
    if(queued&&queued.signature===localResources.requestedSignature&&displayResource?.signature!==queued.signature){
      if(localResourceCache.has(queued.signature)){activateLocalDetailResource(queued.signature,true);refreshZoomPresentation();}
      else startLocalJob(queued.index,queued.lat,queued.lon,queued.signature,false);
    }
    if(!localJob)scheduleLocalPrewarm();
    return;
  }
  job.busyMs+=sliceMs;job.slices++;job.maxSliceMs=Math.max(job.maxSliceMs,sliceMs);
  localResources.maxPreparationSliceMs=Math.max(localResources.maxPreparationSliceMs,Number(sliceMs.toFixed(3)));
  localResources.preparationProgress=Number(clamp(job.steps/Math.max(1,job.totalSteps),0,1).toFixed(4));
  scheduleLocalPump();
}
// Called from the zoom/rotation path: records the request and at most swaps
// an already-prepared resource. It never generates geometry or textures.
function requestLocalDetailResource(index){
  const lat=zoomState.focusLatitudeRadians,lon=zoomState.focusLongitudeRadians,cell=canonicalSpatialCellFor(index,lat,lon),signature=localSignatureFor(index,lat,lon);
  updateLocalMotion(lat,lon);
  const previousRequested=localResources.requestedSignature,priorResidency=localResidency.get(signature)||null;
  localResources.requestedSignature=signature;localResources.requestedLevel=LOCAL_DETAIL_LEVELS[index].id;localResources.requestedCellId=cell.id;
  setLocalResidencyState(signature,"requested",{cellId:cell.id,level:LOCAL_DETAIL_LEVELS[index].id,requestedAtMs:performance.now()});
  if(previousRequested!==signature&&displayResource?.signature!==signature){
    localResources.lastHandoffRequestedAtMs=Number(performance.now().toFixed(3));
    // A prepared local representation is the immediate previous/parent fallback.
    // Before the first local resource exists the canonical globe is still the
    // ready root representation, so this is coverage, not a hole.
    if(displayResource)localResources.parentFallbackCount++;
    else if(ready&&projectionState.blend>0)localResources.rootFallbackCount++;
  }
  if(displayResource?.signature===signature){localResources.pendingPreparationCount=0;setLocalResidencyState(signature,"active",{cellId:cell.id,level:LOCAL_DETAIL_LEVELS[index].id});return;}
  localResources.pendingPreparationCount=1;
  if(localResourceCache.has(signature)){
    const cached=localResourceCache.get(signature);
    if(priorResidency?.state==="grace"&&Number(priorResidency.graceUntilMs||0)>performance.now())localResources.graceReuseCount++;
    if(cached?.prefetchKind==="motion")localResources.prefetchHits++;
    localMotionPrefetchTargets.delete(signature);
    activateLocalDetailResource(signature,true);return;
  }
  if(localJob){
    if(localJob.signature===signature){
      if(localJob.prewarm&&localJob.prewarmKind==="motion"){localResources.prefetchMisses++;localMotionPrefetchTargets.delete(signature);}
      localJob.prewarm=false;localResources.preparingPrewarm=false;return;
    }
    // Let a nearly finished same-focus job land (it is still a closer/nearer
    // stand-in); otherwise cancel it and start on the latest request.
    const sameFocus=localJob.lat0===lat&&localJob.lon0===lon;
    if(sameFocus&&!localJob.prewarm&&localJob.steps/Math.max(1,localJob.totalSteps)>=.5){localQueuedRequest={index,lat,lon,signature};localResources.deferredRequests++;return;}
    const cancelledSignature=localJob.signature;
    localResources.cancelledPreparations++;localJob=null;
    localResidency.delete(cancelledSignature);localMotionPrefetchTargets.delete(cancelledSignature);
  }
  localQueuedRequest=null;
  startLocalJob(index,lat,lon,signature,false);
}
function scheduleLocalPrewarm(){
  if(localJob||!displayResource||projectionState.blend<=0)return;
  if(localResources.requestedSignature!==displayResource.signature)return;
  const lat=zoomState.focusLatitudeRadians,lon=zoomState.focusLongitudeRadians,index=displayResource.levelIndex;
  const motion=motionPrefetchCandidate(index);
  if(motion&&!localResourceCache.has(motion.signature)&&motion.signature!==displayResource.signature){
    localMotionPrefetchTargets.set(motion.signature,{cellId:motion.cellId,requestedAtMs:performance.now()});pruneLocalResidency();
    localResources.prefetchRequests++;
    startLocalJob(motion.index,motion.lat,motion.lon,motion.signature,true,"motion");return;
  }
  for(const candidate of [index+lastZoomDirection,index-lastZoomDirection]){
    if(candidate<0||candidate>=LOCAL_DETAIL_LEVELS.length)continue;
    const signature=localSignatureFor(candidate,lat,lon);
    if(localResourceCache.has(signature))continue;
    startLocalJob(candidate,lat,lon,signature,true,"lod");return;
  }
}
// Double-buffered swap: only a fully prepared resource becomes visible.
function activateLocalDetailResource(signature,fromCache){
  if(!tangentPatch?.render||!device||!tangentPatchMaterial||!horizonSkirtMaterial)return false;
  const resource=localResourceCache.get(signature);if(!resource)return false;
  const swapStarted=performance.now();
  localResourceCache.delete(signature);localResourceCache.set(signature,resource);
  if(fromCache){localResources.cacheHits++;if(resource.builtAsPrewarm)localResources.prewarmHits++;wilderness={...wilderness,cacheReuse:Boolean(resource.wildernessPlan)};}else wilderness={...wilderness,cacheReuse:false};
  const previousDisplay=displayResource;
  if(previousDisplay&&previousDisplay.signature!==signature){
    setLocalResidencyState(previousDisplay.signature,"grace",{cellId:previousDisplay.spatialCell?.id||null,level:previousDisplay.dims?.levelId||null,regenerationSignature:previousDisplay.regenerationSignature||null,graceUntilMs:performance.now()+LOCAL_GRACE_RESIDENCY_MS,lastVisibleAtMs:performance.now()});
  }
  displayResource=resource;
  setLocalResidencyState(signature,"active",{cellId:resource.spatialCell?.id||null,level:resource.dims?.levelId||null,regenerationSignature:resource.regenerationSignature||null,activatedAtMs:performance.now()});
  if(localResources.requestedSignature===signature&&localResources.lastHandoffRequestedAtMs){
    const latency=Math.max(0,performance.now()-Number(localResources.lastHandoffRequestedAtMs||0));
    localResources.lastHandoffLatencyMs=Number(latency.toFixed(3));localResources.longestHandoffLatencyMs=Math.max(Number(localResources.longestHandoffLatencyMs||0),localResources.lastHandoffLatencyMs);
    localResources.lastHandoffCompletedAtMs=Number(performance.now().toFixed(3));
  }
  localDetail={...resource.detail,rebuildCount:(localDetail.rebuildCount||0)+1};
  tangentPatch.render.meshInstances=[new pc.MeshInstance(resource.mesh,tangentPatchMaterial,tangentPatch)];
  tangentPatchMaterial.diffuseMap=resource.detailTexture;tangentPatchMaterial.emissiveMap=resource.detailTexture;tangentPatchMaterial.opacityMap=resource.detailTexture;tangentPatchMaterial.opacityMapChannel="a";tangentPatchMaterial.blendType=pc.BLEND_NORMAL;tangentPatchMaterial.depthWrite=false;tangentPatchMaterial.update();
  if(horizonSkirt?.render){
    horizonSkirt.render.meshInstances=[new pc.MeshInstance(resource.skirtMesh,horizonSkirtMaterial,horizonSkirt)];
    localResources.surroundSpanFactor=LOCAL_SURROUND_SPAN_FACTOR;localResources.surroundWidthMeters=Number((resource.dims.patchWidth*LOCAL_SURROUND_SPAN_FACTOR).toFixed(3));localResources.surroundHeightMeters=Number((resource.dims.patchHeight*LOCAL_SURROUND_SPAN_FACTOR).toFixed(3));localResources.surroundWorldMatched=true;
  }
  horizonSkirtMaterial.diffuseMap=resource.surroundTexture;horizonSkirtMaterial.emissiveMap=resource.surroundTexture;horizonSkirtMaterial.diffuse.set(1,1,1);horizonSkirtMaterial.emissive.set(1,1,1);horizonSkirtMaterial.emissiveIntensity=.98;horizonSkirtMaterial.update();
  rebuildLocalStaticPresentation(resource);
  if(atmospherePalette)applyAtmosphereMaterialPalette(atmospherePalette);
  trimLocalResourceCache();
  localResources.activeSignature=signature;localResources.visibleLevel=resource.dims.levelId;localResources.activeCellId=resource.spatialCell?.id||null;localResources.activeResourceCount=1;localResources.cachedResourceCount=localResourceCache.size;
  localResources.pendingPreparationCount=localResources.requestedSignature===signature?0:1;
  localResources.estimatedCacheBytes=Array.from(localResourceCache.values()).reduce((sum,item)=>sum+(item.estimatedBytes||0),0);
  const swapMs=performance.now()-swapStarted;localResources.lastSwapMs=Number(swapMs.toFixed(3));localResources.maxSwapMs=Math.max(localResources.maxSwapMs,localResources.lastSwapMs);localResources.swapCount++;
  return true;
}
// Compile the tangent/surround/static-world shader variants during startup
// (behind the loading overlay and hidden inside the globe) so the first
// planet-to-local handoff does not stall on shader compilation.
async function warmLocalRepresentationShaders(){
  if(!app||!device||!pc)return;
  ensureTangentPatch();ensureHorizonSkirt();ensureLocalStaticMaterials();
  const texture=new pc.Texture(device,{width:4,height:4,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
  const pixels=texture.lock();pixels.fill(255);texture.unlock();
  texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;texture.magFilter=pc.FILTER_LINEAR;
  const quad=skirtMeshForDims({patchWidth:1,patchHeight:1,metersPerUnit:10},1);quad.incRefCount();
  tangentPatchMaterial.diffuseMap=texture;tangentPatchMaterial.emissiveMap=texture;tangentPatchMaterial.opacityMap=texture;tangentPatchMaterial.opacityMapChannel="a";tangentPatchMaterial.opacity=.5;tangentPatchMaterial.blendType=pc.BLEND_NORMAL;tangentPatchMaterial.depthWrite=false;tangentPatchMaterial.update();
  horizonSkirtMaterial.diffuseMap=texture;horizonSkirtMaterial.emissiveMap=texture;horizonSkirtMaterial.opacity=.5;horizonSkirtMaterial.blendType=pc.BLEND_NORMAL;horizonSkirtMaterial.depthWrite=false;horizonSkirtMaterial.update();
  tangentPatch.render.meshInstances=[new pc.MeshInstance(quad,tangentPatchMaterial,tangentPatch)];
  horizonSkirt.render.meshInstances=[new pc.MeshInstance(quad,horizonSkirtMaterial,horizonSkirt)];
  const holder=new pc.Entity("LocalShaderWarmup");app.root.addChild(holder);
  const previousRoot=localStaticRoot;localStaticRoot=holder;
  for(const [type,material] of [["box",localStaticMaterials.road],["box",localStaticMaterials.wall],["box",localStaticMaterials.roof],["cylinder",localStaticMaterials.trunk],["sphere",localStaticMaterials.leaf],["box",localStaticMaterials.water]])addLocalStatic("Warm-"+material.name,type,material,0,0,0,.01,.01,.01);
  localStaticRoot=previousRoot;
  tangentPatch.enabled=true;horizonSkirt.enabled=true;
  await yieldPaint();await yieldPaint();
  tangentPatch.enabled=false;horizonSkirt.enabled=false;
  tangentPatch.render.meshInstances=[];horizonSkirt.render.meshInstances=[];holder.destroy();
  quad.decRefCount();quad.destroy();texture.destroy();
  tangentPatchMaterial.diffuseMap=null;tangentPatchMaterial.emissiveMap=null;tangentPatchMaterial.opacityMap=null;tangentPatchMaterial.update();
  horizonSkirtMaterial.diffuseMap=null;horizonSkirtMaterial.emissiveMap=null;horizonSkirtMaterial.update();
}
function recordLocalFrame(dt){
  const ms=Math.max(0,Number(dt)||0)*1000;localFrameStats.lastFrameMs=ms;
  localFrameStats.recent.push(ms);if(localFrameStats.recent.length>120)localFrameStats.recent.shift();
  if(localJob)localFrameStats.maxDuringPreparationMs=Math.max(localFrameStats.maxDuringPreparationMs,ms);
  localResources.lastFrameMs=Number(ms.toFixed(3));localResources.recentMaxFrameMs=Number(Math.max(0,...localFrameStats.recent).toFixed(3));
  if(localJob)localResources.maxFrameMsDuringPreparation=Number(localFrameStats.maxDuringPreparationMs.toFixed(3));
}
function ensureTangentPatch(){
  if(tangentPatch)return;
  tangentPatchMaterial=new pc.StandardMaterial();tangentPatchMaterial.name="SeededTangentSurface";tangentPatchMaterial.diffuse.set(1,1,1);tangentPatchMaterial.emissive.set(1,1,1);tangentPatchMaterial.emissiveIntensity=.72;tangentPatchMaterial.__atmosphereBaseDiffuse=[1,1,1];tangentPatchMaterial.useLighting=false;tangentPatchMaterial.cull=pc.CULLFACE_NONE;tangentPatchMaterial.roughness=.9;tangentPatchMaterial.update();
  tangentPatch=new pc.Entity("LocalTangentSurface");tangentPatch.addComponent("render",{type:"asset",castShadows:false,receiveShadows:true});
  // Empty until the first cooperatively prepared resource is swapped in.
  tangentPatch.render.meshInstances=[];
  tangentPatch.enabled=false;app.root.addChild(tangentPatch);
}
function ensureHorizonSkirt(){
  if(horizonSkirt||!device)return;
  horizonSkirtMaterial=new pc.StandardMaterial();horizonSkirtMaterial.name="LocalHorizonSkirt";
  horizonSkirtMaterial.diffuse.set(.2,.34,.17);horizonSkirtMaterial.emissive.set(.18,.30,.15);horizonSkirtMaterial.emissiveIntensity=1.08;horizonSkirtMaterial.__atmosphereBaseDiffuse=[.2,.34,.17];
  horizonSkirtMaterial.useLighting=false;horizonSkirtMaterial.cull=pc.CULLFACE_NONE;horizonSkirtMaterial.update();
  horizonSkirt=new pc.Entity("LocalHorizonSkirt");horizonSkirt.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
  horizonSkirt.render.meshInstances=[];horizonSkirt.enabled=false;app.root.addChild(horizonSkirt);
}
// Zoom/rotation path: record the requested tier (may swap in a ready one).
function updateLocalRequest(){
  if(!planet||projectionState.blend<=0)return;
  ensureTangentPatch();ensureHorizonSkirt();
  requestLocalDetailResource(requestedLodIndexForZoom());
}
// visibleHeightUnits: vertical extent, in scene units, that the camera sees at
// the tangent-patch focus. The patch is scaled so it shows exactly the ladder
// footprint (or, for a stand-in, the closest footprint it can honestly show).
function updateProjectionPresentation(visibleHeightUnits=1){
  if(!planet)return;
  const blend=projectionState.blend;
  if(tangentPatch){
    const handoff=projectionHandoffForZoom();
    // Nothing local is shown until a prepared resource exists; the globe keeps
    // ownership meanwhile, so a preparing LOD can never produce a blank frame.
    const tangentVisible=handoff>.02&&Boolean(displayResource);
    // Keep bounded fine geometry hidden at map scale; the seeded coarse surround owns the viewport until near-ground.
    const fineVisible=tangentVisible&&zoomState.scalar>=projectionState.transitionStart;
    tangentPatch.enabled=fineVisible;
    ensureHorizonSkirt();
    const viewBlend=blend;
    if(horizonSkirt){
      horizonSkirt.enabled=tangentVisible;
      // Reveal the canonical tangent continuation quickly enough that the
      // settlement frame is fully owned by the same local geography, rather
      // than looking through a fading globe shell at a different surface.
      const tangentReveal=projectionPresentationBlendForZoom();
      horizonSkirtMaterial.opacity=tangentReveal*.92;
      horizonSkirtMaterial.blendType=pc.BLEND_NORMAL;
      horizonSkirtMaterial.depthWrite=false;
      horizonSkirtMaterial.update();
    }
    // LOD refinement occupies the same camera-facing tangent plane; zoom never changes viewing angle.
    tangentPatch.setLocalEulerAngles(90,0,0);
    const dims=localPatchDimensions(),level=LOCAL_DETAIL_LEVELS[dims.levelIndex];
    const shownHeightMeters=level.visibleHeightMeters/dims.presentationCompensation;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);
    projectionPresentation={...projectionPresentation,viewBlend,presentationCompensation:dims.presentationCompensation,patchScale,shownHeightMeters,targetHeightMeters:presentationTargetHeightMeters()};
    tangentPatch.setLocalScale(patchScale,patchScale,patchScale);
    // A prepared stand-in normally remains exactly world-anchored while a new
    // focus resource is built. At ground scale a small pointer drag can request
    // a focus many kilometres away, which would translate the old 3x surround
    // completely outside the viewport and expose the clear color. Preserve the
    // exact offset while the old surround still covers the requested viewport;
    // otherwise clamp only the temporary stand-in translation to the coverage
    // margin. The requested focus remains authoritative and the new resource is
    // still swapped atomically as soon as preparation completes.
    const rawOffset=displayResource?localFocusOffsetMeters(displayResource):{east:0,north:0};
    const standInActive=Boolean(displayResource)&&localResources.requestedSignature!==displayResource.signature;
    let offset={east:rawOffset.east,north:rawOffset.north},standInOffsetClamped=false;
    if(standInActive&&displayResource){
      const rect=canvas?.getBoundingClientRect?.(),aspect=Math.max(.35,(rect?.width||1)/(rect?.height||1));
      const visibleHeightMeters=shownHeightMeters,visibleWidthMeters=visibleHeightMeters*aspect;
      const surroundWidthMeters=displayResource.dims.patchWidth*LOCAL_SURROUND_SPAN_FACTOR,surroundHeightMeters=displayResource.dims.patchHeight*LOCAL_SURROUND_SPAN_FACTOR;
      const safeEast=Math.max(0,(surroundWidthMeters-visibleWidthMeters)/2);
      const safeNorth=Math.max(0,(surroundHeightMeters-visibleHeightMeters)/2);
      const bounded={east:clamp(rawOffset.east,-safeEast,safeEast),north:clamp(rawOffset.north,-safeNorth,safeNorth)};
      standInOffsetClamped=Math.abs(bounded.east-rawOffset.east)>.001||Math.abs(bounded.north-rawOffset.north)>.001;
      // Once exact world anchoring would move any requested viewport beyond the
      // prepared 3x surround, center the last valid representation instead of
      // parking the camera on its edge. This is presentation-only and lasts
      // only until the authoritative requested-focus resource atomically swaps.
      offset=standInOffsetClamped?{east:0,north:0}:bounded;
    }
    // Terrain must continue zooming while the child prepares, but semantic/static
    // objects from the previous coarse tier must not balloon or clip. Hold their
    // screen-scale until the refined resource atomically activates.
    const semanticHoldScale=standInActive&&Number(dims.presentationCompensation||1)>1
      ? 1/Number(dims.presentationCompensation||1):1;
    // Child-local Y is terrain-normal/elevation. Compensate only the tangent-plane
    // axes so the previous-ready semantic world keeps its ground contact while
    // the terrain stand-in is magnified during an asynchronous child handoff.
    // Root inverse-scaling holds semantic size, but root translation must also
    // pivot around the canonical settlement anchor. Otherwise the parent patch
    // translation/scale magnifies the SLOD-cell-to-village registration offset
    // and the village slides toward a viewport edge while the child prepares.
    let semanticAnchorLocalX=0,semanticAnchorLocalZ=0;
    const semanticCenterTile=localStatic?.canonicalCenterTile;
    if(semanticCenterTile&&displayResource){
      const semanticOrigin=worldLatLonForTile(semanticCenterTile.x,semanticCenterTile.y);
      const semanticDelta=canonicalRegisteredDeltaMeters(displayResource.lat0,displayResource.lon0,semanticOrigin.latitudeRadians,semanticOrigin.longitudeRadians);
      semanticAnchorLocalX=Number(semanticDelta.eastMeters||0)/dims.metersPerUnit;
      semanticAnchorLocalZ=-Number(semanticDelta.northMeters||0)/dims.metersPerUnit;
    }
    const semanticAnchorCompensation=1-semanticHoldScale;
    for(const rootNode of [localStaticRoot,localNpcRoot,localBuildingActivityRoot]){
      if(rootNode?.setLocalScale)rootNode.setLocalScale(semanticHoldScale,1,semanticHoldScale);
      if(rootNode?.setLocalPosition)rootNode.setLocalPosition(semanticAnchorLocalX*semanticAnchorCompensation,0,semanticAnchorLocalZ*semanticAnchorCompensation);
    }
    localResources.standInSemanticScale=Number(semanticHoldScale.toFixed(6));
    tangentPatch.setLocalPosition(offset.east/dims.metersPerUnit*patchScale,offset.north/dims.metersPerUnit*patchScale,DISPLAY_RADIUS_UNITS+.002);
    const requestedIndex=requestedLodIndex,visibleIndex=displayResource?.levelIndex??requestedIndex;
    localResources.standInActive=standInActive;
    localResources.standInOffsetClamped=standInOffsetClamped;
    localResources.standInPinnedToViewport=standInActive&&standInOffsetClamped;
    localResources.standInRawOffsetMeters={east:Number(rawOffset.east.toFixed(3)),north:Number(rawOffset.north.toFixed(3))};
    localResources.standInAppliedOffsetMeters={east:Number(offset.east.toFixed(3)),north:Number(offset.north.toFixed(3))};
    localResources.standInMagnification=Number(Math.max(1,dims.presentationCompensation).toFixed(4));
    localResources.visibleLevel=displayResource?.dims.levelId??null;
    localResources.requestedLevelIndex=requestedIndex;localResources.visibleLevelIndex=displayResource?visibleIndex:null;
    if(horizonSkirt){
      // The 3x world-matched continuation shares the patch scale. During a
      // large focus jump the bounded stand-in offset guarantees that this last
      // valid terrain representation still covers the viewport until swap.
      const surroundScale=patchScale;
      horizonSkirt.setLocalEulerAngles(90,0,0);
      horizonSkirt.setLocalScale(surroundScale,surroundScale,surroundScale);
      horizonSkirt.setLocalPosition(offset.east/dims.metersPerUnit*surroundScale,offset.north/dims.metersPerUnit*surroundScale,DISPLAY_RADIUS_UNITS-.010);
      projectionPresentation={...projectionPresentation,surroundScale};
    }
  }
  // Keep both representations alive during the projection handoff. The old
  // threshold disabled the globe almost exactly when the tangent camera jumped
  // above the patch, making a fixed geographic focus look like a new location.
  // The overlap lets camera motion remain continuous while both surfaces are
  // still derived from the same canonical lat/lon focus.
  const handoff=projectionHandoffForZoom();
  const tangentReveal=displayResource?projectionPresentationBlendForZoom():0;
  const globeFade=tangentReveal;
  planet.enabled=globeFade<.9995;
  if(surfaceMaterial){
    surfaceMaterial.opacity=1-globeFade;
    surfaceMaterial.blendType=handoff>.001?pc.BLEND_NORMAL:pc.BLEND_NONE;
    // The tangent patch is geometrically inside the globe. Once the handoff
    // starts, a depth-writing sphere would mask the canonical tangent surface
    // even while its color is fading. Stop writing depth almost immediately
    // and let opacity alone perform the representation crossfade.
    surfaceMaterial.depthWrite=handoff<.02;
    surfaceMaterial.update();
  }
  if(tangentPatchMaterial){
    tangentPatchMaterial.opacity=tangentReveal;
    tangentPatchMaterial.blendType=pc.BLEND_NORMAL;
    tangentPatchMaterial.depthWrite=false;
    tangentPatchMaterial.update();
  }
  projectionPresentation={...projectionPresentation,
    globeOpacity:Number((1-globeFade).toFixed(6)),
    tangentOpacity:Number(tangentReveal.toFixed(6)),
    horizonOpacity:Number((tangentReveal*.92).toFixed(6)),
    globeDepthWrite:Boolean(handoff<.02)
  };
  if(cloudLayer)cloudLayer.enabled=globeFade<.35;
  localResources.culledOuterRepresentations=planet.enabled?0:1+(cloudLayer?1:0);
  if(blend<=0){localResources.activeResourceCount=0;localResources.pendingPreparationCount=0;localResources.standInActive=false;}
}
function applyCameraZoom(){
  if(!cameraEntity||!zoomState.baseCameraDistance)return;
  const scalar=clamp(zoomState.scalar,ZOOM_MIN,ZOOM_MAX);
  zoomState.requestedBand=zoomBandFor(scalar);
  updateProjectionState();
  updateLocalRequest();
  scheduleLocalStaticPresentationRefresh();
  const targetHeightMeters=Math.max(2,presentationTargetHeightMeters(scalar));
  const visibleHeightUnits=Math.max(1e-6,targetHeightMeters/WORLD_RADIUS_METERS*DISPLAY_RADIUS_UNITS);
  const orthoHeight=Math.max(1e-6,visibleHeightUnits*.5);
  cameraEntity.setLocalPosition(0,0,zoomState.baseCameraDistance);
  cameraEntity.lookAt(0,0,0);
  if(cameraEntity.camera){cameraEntity.camera.projection=pc.PROJECTION_ORTHOGRAPHIC;cameraEntity.camera.orthoHeight=orthoHeight;cameraEntity.camera.fov=GLOBE_VERTICAL_FOV_DEGREES;}
  zoomState.cameraDistance=zoomState.baseCameraDistance;
  const handoff=projectionHandoffForZoom(scalar),representationBlend=displayResource?projectionPresentationBlendForZoom(scalar):0;
  projectionPresentation={...projectionPresentation,viewBlend:projectionState.blend,handoff,representationBlend,angleBlend:0,orientationStart:null,orientationEnd:null,cameraY:0,cameraZ:zoomState.baseCameraDistance,fov:GLOBE_VERTICAL_FOV_DEGREES,orthoHeight,cameraPitchDegrees:0,lookVector:Object.freeze([0,0,-1]),cameraTarget:Object.freeze([0,0,0]),zoomTransform:"orthographic-magnification-only",cameraPoseInvariant:true};
  updateProjectionPresentation(visibleHeightUnits);
  const tangentOwnsView=projectionState.blend>LOCAL_TANGENT_OWNERSHIP_BLEND&&Boolean(displayResource);
  const footprintHeight=tangentOwnsView?Number(projectionPresentation.shownHeightMeters||targetHeightMeters):targetHeightMeters;
  const rect=canvas?.getBoundingClientRect?.(),aspect=Math.max(.1,(rect?.width||1)/(rect?.height||1));
  zoomState.visibleFootprintHeightMeters=Math.max(2,footprintHeight);
  zoomState.visibleFootprintWidthMeters=Math.max(2,footprintHeight*aspect);
  zoomState.band=visibleBandFor(zoomState.requestedBand,tangentOwnsView);
  updateMapPresentation();
}
// Semantic band shown to the player never claims a finer scale than the
// representation currently on screen.
function visibleBandFor(requestedBand,tangentOwnsView){
  const order=ZOOM_BANDS.map(b=>b.id),requested=order.indexOf(requestedBand);
  if(!displayResource||projectionState.blend<=0)return requested>order.indexOf("country-region")?"country-region":requestedBand;
  const visible=order.indexOf(displayResource.dims.band);
  if(!tangentOwnsView)return requested>visible?order[Math.min(requested,visible)]:requestedBand;
  return requested>visible?order[visible]:requestedBand;
}
function refreshZoomPresentation(){if(cameraEntity&&zoomState.baseCameraDistance)applyCameraZoom();}
function localFocusOffsetMeters(resource){
  const delta=canonicalRegisteredDeltaMeters(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians,resource.lat0,resource.lon0);
  return {east:Number(delta.eastMeters||0),north:Number(delta.northMeters||0)};
}
function setZoomScalar(value){
  const next=clamp(value,ZOOM_MIN,ZOOM_MAX);
  if(Math.abs(next-zoomState.scalar)<1e-7)return snapshot();
  lastZoomDirection=next>zoomState.scalar?1:-1;
  zoomState.scalar=next;zoomState.zoomChanges++;applyCameraZoom();return snapshot();
}
function zoomBy(delta){const d=Number(delta||0);return d===0?snapshot():stepScale(d>0?1:-1);}
function applyRotation(){
  if(!planet)return;
  planet.setLocalEulerAngles(pitchDegrees,yawDegrees,0);
  updateZoomFocusFromRotation();
  rotationChangeCount++;  if(zoomState.scalar<=projectionState.transitionStart)updateMapPresentation();
}
function setRotation(yaw,pitch){
  const beforeLatitudeRadians=zoomState.focusLatitudeRadians,beforeLongitudeRadians=zoomState.focusLongitudeRadians;
  yawDegrees=normalizeYaw(yaw);
  pitchDegrees=clamp(pitch,-82,82);
  applyRotation();
  if(zoomState.scalar>projectionState.transitionStart)applyCameraZoom();
  recordEnvironmentNavigationPassage(beforeLatitudeRadians,beforeLongitudeRadians,zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  return snapshot();
}
function rotateBy(deltaYaw,deltaPitch){
  return setRotation(yawDegrees+Number(deltaYaw||0),pitchDegrees+Number(deltaPitch||0));
}
function rotationForLatLon(latitudeRadians,longitudeRadians){
  // Solve the exact inverse of PlayCanvas XYZ Euler rotation for the canonical
  // local direction d=[cos(lat)sin(lon), sin(lat), cos(lat)cos(lon)] such that
  // R(pitch,yaw,0)*d == world +Z. Choose the yaw branch whose cos(yaw) has the
  // same sign as d.z; that keeps the required pitch in the minimal +/-90 range.
  const lat=clamp(Number(latitudeRadians)||0,-Math.PI*.499999,Math.PI*.499999),lon=wrapLongitudeRadians(longitudeRadians);
  const c=Math.cos(lat),dx=c*Math.sin(lon),dy=Math.sin(lat),dz=c*Math.cos(lon);
  const yz=Math.hypot(dy,dz),signCosYaw=dz<0?-1:1;
  const yaw=Math.atan2(-dx,signCosYaw*yz);
  const pitch=yz<1e-12?0:Math.atan2(dy*signCosYaw,Math.abs(dz));
  return Object.freeze({
    yawDegrees:normalizeYaw(yaw*180/Math.PI),
    pitchDegrees:clamp(pitch*180/Math.PI,-82,82)
  });
}
function setViewTarget(target){
  if(!target)return snapshot();
  const rotation=rotationForLatLon(Number(target.latitudeRadians)||0,Number(target.longitudeRadians)||0);
  return setRotation(rotation.yawDegrees,rotation.pitchDegrees);
}
function rgbaFromColor(color){
  return [
    Math.round(clamp(color[0],0,1)*255),
    Math.round(clamp(color[1],0,1)*255),
    Math.round(clamp(color[2],0,1)*255),
    255
  ];
}
async function makeGeographyTexture(){
  const source=document.createElement("canvas");
  source.width=TEXTURE_WIDTH;
  source.height=TEXTURE_HEIGHT;
  const ctx=source.getContext("2d",{alpha:false});
  const image=ctx.createImageData(TEXTURE_WIDTH,TEXTURE_HEIGHT);
  const data=image.data;

  let minElevation=Infinity,maxElevation=-Infinity;
  let landSamples=0,oceanSamples=0,islandSamples=0,mountainSamples=0,peakSamples=0;
  let highest=null,deepest=null,bestIsland=null,bestMountain=null,bestContinent=null,bestContinuity=null,bestContinuityScore=-Infinity;
  const polarReferenceByRow=new Map(),polarBlendStart=80*Math.PI/180,polarBlendSpan=10*Math.PI/180;

  await runSlicedRange(TEXTURE_WIDTH*TEXTURE_HEIGHT,index=>{
    const py=Math.floor(index/TEXTURE_WIDTH),px=index-py*TEXTURE_WIDTH;
    const v=(py+0.5)/TEXTURE_HEIGHT;
    const lat=(0.5-v)*Math.PI;
    const u=(px+0.5)/TEXTURE_WIDTH;
    const lon=(u-0.5)*Math.PI*2;
    const sample=geography.sampleLatLon(lat,lon);
    let renderColor=sample.color;
    const absLat=Math.abs(lat);
    if(absLat>polarBlendStart){
      let reference=polarReferenceByRow.get(py);
      if(!reference){reference=geography.sampleLatLon(lat,0).color;polarReferenceByRow.set(py,reference);}
      const t=smoothstep01((absLat-polarBlendStart)/polarBlendSpan);
      renderColor=sample.color.map((value,channel)=>lerp(value,reference[channel],t));
    }
    const rgba=rgbaFromColor(renderColor);
    const dataIndex=index*4;
    data[dataIndex]=rgba[0];data[dataIndex+1]=rgba[1];data[dataIndex+2]=rgba[2];data[dataIndex+3]=255;
    minElevation=Math.min(minElevation,sample.elevationMeters);
    maxElevation=Math.max(maxElevation,sample.elevationMeters);
    if(sample.land)landSamples++;else oceanSamples++;
    if(sample.islandInfluence>0.28&&sample.continentInfluence<0.22&&sample.land)islandSamples++;
    if(sample.mountainInfluence>0.18)mountainSamples++;
    if(sample.elevationMeters>=3400)peakSamples++;
    const descriptor=Object.freeze({latitudeRadians:sample.latitudeRadians,longitudeRadians:sample.longitudeRadians,latitudeDegrees:Number((sample.latitudeRadians*180/Math.PI).toFixed(3)),longitudeDegrees:Number((sample.longitudeRadians*180/Math.PI).toFixed(3)),elevationMeters:sample.elevationMeters,surfaceClass:sample.surfaceClass,continentInfluence:sample.continentInfluence,islandInfluence:sample.islandInfluence,mountainInfluence:sample.mountainInfluence});
    if(!highest||sample.elevationMeters>highest.elevationMeters)highest=descriptor;
    if(!deepest||sample.elevationMeters<deepest.elevationMeters)deepest=descriptor;
    if(sample.land&&sample.islandInfluence>0.22&&sample.continentInfluence<0.28&&(!bestIsland||sample.islandInfluence>bestIsland.islandInfluence))bestIsland=descriptor;
    if(sample.land&&(!bestMountain||sample.mountainInfluence>bestMountain.mountainInfluence||(sample.mountainInfluence===bestMountain.mountainInfluence&&sample.elevationMeters>bestMountain.elevationMeters)))bestMountain=descriptor;
    if(sample.land&&(!bestContinent||sample.continentInfluence>bestContinent.continentInfluence))bestContinent=descriptor;
    if(sample.land&&Math.abs(descriptor.latitudeDegrees)<=60){
      const continuityScore=sample.continentInfluence*3+sample.moisture*.35-Math.abs(sample.elevationMeters-650)/7000-sample.islandInfluence*.45;
      if(continuityScore>bestContinuityScore){bestContinuityScore=continuityScore;bestContinuity=descriptor;}
    }
  });
  ctx.putImageData(image,0,0);

  const texture=new pc.Texture(device,{
    width:TEXTURE_WIDTH,
    height:TEXTURE_HEIGHT,
    format:pc.PIXELFORMAT_R8_G8_B8_A8,
    mipmaps:true
  });
  texture.name="SeededPlanetGeography";
  texture.flipY=true;
  texture.addressU=pc.ADDRESS_REPEAT;
  texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;
  texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;
  texture.magFilter=pc.FILTER_LINEAR;
  texture.setSource(source);

  generatedTexture=texture;
  geographyStats=Object.freeze({
    textureWidth:TEXTURE_WIDTH,
    textureHeight:TEXTURE_HEIGHT,
    totalTextureSamples:TEXTURE_WIDTH*TEXTURE_HEIGHT,
    minElevationMeters:Number(minElevation.toFixed(2)),
    maxElevationMeters:Number(maxElevation.toFixed(2)),
    landSamples,oceanSamples,islandSamples,mountainSamples,peakSamples,
    landFraction:Number((landSamples/(landSamples+oceanSamples)).toFixed(5)),
    oceanFraction:Number((oceanSamples/(landSamples+oceanSamples)).toFixed(5))
  });
  featureTargets=Object.freeze({
    continent:bestContinent,
    continuityFocus:bestContinuity||bestContinent,
    mountain:bestMountain||highest,
    island:bestIsland,
    peak:highest,
    deepOcean:deepest
  });
  buildDestinationDescriptors();
  return texture;
}
function stablePlaceName(kind,target,index){
  const stems=["Alder","Brim","Cinder","Dawn","Elder","Frost","Glen","Haven","Iron","Juniper","Kings","Lumen","Morrow","North","Oak","Raven","Silver","Thorn","Vale","Willow"];
  const tails={continent:["reach","land","march"],island:["isle","haven","key"],mountain:["spire","peak","crown"],peak:["summit","crest","crown"],water:["deep","sea","blue"],village:["ford","stead","wick"],town:["bridge","market","cross"],city:["hold","gate","court"],ruin:["watch","keep","fall"],hunting:["wood","chase","wild"],fishing:["bay","shore","cove"]};
  const lat=Math.round((Number(target?.latitudeDegrees)||0)*10),lon=Math.round((Number(target?.longitudeDegrees)||0)*10);
  let h=2166136261>>>0;for(const ch of String(activeSeed)+"|"+kind+"|"+lat+"|"+lon+"|"+index){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  const stem=stems[h%stems.length],suffix=(tails[kind]||["reach"])[(h>>>8)%(tails[kind]||["reach"]).length];
  return stem+" "+suffix.charAt(0).toUpperCase()+suffix.slice(1);
}
function descriptorAt(latitudeRadians,longitudeRadians){
  const lat=clamp(latitudeRadians,-Math.PI/2+.01,Math.PI/2-.01),lon=((longitudeRadians+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
  const sample=geography.sampleLatLon(lat,lon);
  return Object.freeze({latitudeRadians:lat,longitudeRadians:lon,latitudeDegrees:Number((lat*180/Math.PI).toFixed(3)),longitudeDegrees:Number((lon*180/Math.PI).toFixed(3)),elevationMeters:Number(sample.elevationMeters)||0,surfaceClass:sample.surfaceClass,land:Boolean(sample.land)});
}
function boundedNearbySample(base,wantLand,label){
  if(!base)return null;
  const seed=String(activeSeed)+"|destination|"+label;let h=2166136261>>>0;for(const ch of seed){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  for(let ring=1;ring<=6;ring++)for(let step=0;step<12;step++){
    const angle=((step+(h%12))/12)*Math.PI*2,span=.025*ring;
    const target=descriptorAt(Number(base.latitudeRadians)+Math.sin(angle)*span,Number(base.longitudeRadians)+Math.cos(angle)*span/Math.max(.3,Math.cos(Number(base.latitudeRadians)||0)));
    if(target.land===wantLand)return target;
  }
  const fallback=descriptorAt(Number(base.latitudeRadians)||0,Number(base.longitudeRadians)||0);
  return fallback.land===wantLand?fallback:null;
}
function greatCircleDistanceKm(a,b){
  const lat1=Number(a?.latitudeRadians)||0,lat2=Number(b?.latitudeRadians)||0;
  const dLat=lat2-lat1,dLon=(Number(b?.longitudeRadians)||0)-(Number(a?.longitudeRadians)||0);
  const q=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return WORLD_RADIUS_METERS*(2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q))))/1000;
}
function currentViewTarget(){return {latitudeRadians:-pitchDegrees*Math.PI/180,longitudeRadians:-yawDegrees*Math.PI/180};}
function buildDestinationDescriptors(){
  const started=performance.now(),continent=featureTargets?.continent,island=featureTargets?.island||continent,mountain=featureTargets?.mountain||continent;
  const source=[
    ["village","settlements",continent,"Starting-area village on seeded habitable land",3],
    ["town","cities",boundedNearbySample(continent,true,"town"),"Regional market town",3],
    ["city","cities",boundedNearbySample(continent,true,"city"),"Major seeded regional center",4],
    ["ruin","historical",boundedNearbySample(mountain,true,"ruin"),"Old hill ruin / historical site",2],
    ["hunting","hunting",boundedNearbySample(continent,true,"hunt"),"Woodland and upland hunting grounds",1],
    ["fishing","fishing",boundedNearbySample(island,false,"fish"),"Coastal fishing waters",1],
    ["continent","landmark",continent,"Major continental landmass",5],
    ["island","nature",island,"Seeded island landmark",3],
    ["mountain","nature",mountain,"Mountain range high point",3],
    ["peak","nature",featureTargets?.peak,"Highest surveyed elevation",4],
    ["water","water",featureTargets?.deepOcean,"Deep ocean basin",2]
  ];
  destinationNavigator.descriptors=source.filter(row=>row[2]).map((row,index)=>{
    const [kind,category,target,description,importance]=row;
    return Object.freeze({id:"planet-place-"+kind+"-"+index,name:stablePlaceName(kind,target,index),type:kind,category,description,importance,
      latitudeRadians:Number(target.latitudeRadians)||0,longitudeRadians:Number(target.longitudeRadians)||0,
      latitudeDegrees:Number(target.latitudeDegrees)||0,longitudeDegrees:Number(target.longitudeDegrees)||0,
      elevationMeters:Number(target.elevationMeters)||0});
  });
  destinationNavigator.queryCount++;
  destinationNavigator.lastQueryMs=Number((performance.now()-started).toFixed(3));
}
function renderDestinationNavigator(){
  if(!root)return;
  let button=root.querySelector(".planet-places-button");
  if(!button){
    button=document.createElement("button");button.type="button";button.className="planet-places-button";button.textContent="Places";button.setAttribute("aria-expanded","false");
    button.addEventListener("click",()=>{destinationNavigator.open=!destinationNavigator.open;renderDestinationNavigator();});
    root.appendChild(button);
  }
  button.setAttribute("aria-expanded",String(destinationNavigator.open));
  let panel=root.querySelector(".planet-places-panel");
  if(!destinationNavigator.open){panel?.remove();return;}
  if(!panel){panel=document.createElement("section");panel.className="planet-places-panel";panel.setAttribute("aria-label","World destinations");root.appendChild(panel);}
  const categories=[["all","All"],["settlements","Settlements"],["cities","Cities / Towns"],["historical","Ruins"],["hunting","Hunting"],["fishing","Fishing"],["water","Water"],["nature","Nature"]];
  const center=currentViewTarget();
  const visible=destinationNavigator.descriptors.filter(d=>destinationNavigator.category==="all"||d.category===destinationNavigator.category).map(d=>({d,distance:greatCircleDistanceKm(center,d)})).sort((a,b)=>a.distance-b.distance||(b.d.importance||0)-(a.d.importance||0));
  panel.replaceChildren();
  const head=document.createElement("div");head.className="planet-places-head";head.innerHTML="<div><small>WORLD NAVIGATOR</small><strong>Places</strong></div>";
  const close=document.createElement("button");close.type="button";close.className="planet-places-close";close.textContent="×";close.setAttribute("aria-label","Close places");close.onclick=()=>{destinationNavigator.open=false;renderDestinationNavigator();};head.appendChild(close);panel.appendChild(head);
  const filters=document.createElement("div");filters.className="planet-places-filters";
  for(const [id,label] of categories){const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.active=String(destinationNavigator.category===id);b.onclick=()=>{destinationNavigator.category=id;renderDestinationNavigator();};filters.appendChild(b);}panel.appendChild(filters);
  const list=document.createElement("div");list.className="planet-places-list";
  for(const entry of visible){
    const d=entry.d,row=document.createElement("article");row.className="planet-place-row";row.dataset.selected=String(destinationNavigator.selectedId===d.id);
    const info=document.createElement("div");
    info.innerHTML="<strong></strong><span></span><small></small>";info.querySelector("strong").textContent=d.name;info.querySelector("span").textContent=d.type+" · "+Math.round(entry.distance).toLocaleString()+" km from view";info.querySelector("small").textContent=d.description+" · "+Math.round(d.elevationMeters).toLocaleString()+" m";
    const go=document.createElement("button");go.type="button";go.textContent="View";go.onclick=()=>{destinationNavigator.selectedId=d.id;destinationNavigator.navigationCount++;destinationNavigator.lastTarget={id:d.id,name:d.name,type:d.type,latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees};setViewTarget(d);renderDestinationNavigator();};
    row.append(info,go);list.appendChild(row);
  }
  panel.appendChild(list);
  const foot=document.createElement("p");foot.className="planet-places-foot";foot.textContent="Camera view only · "+visible.length+" bounded seeded destinations · no world scan";panel.appendChild(foot);
}
function wildernessHash(label){
  let h=2166136261>>>0;for(const ch of String(activeSeed)+"|wilderness|"+label){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;
}
function buildWildernessDescriptors(){
  const started=performance.now(),vegetation=[],rocks=[],fauna=[];let cells=0,rejectedWater=0;
  for(let lat=-72;lat<=72;lat+=8)for(let lon=-176;lon<180;lon+=8){
    cells++;const jLat=((wildernessHash("lat:"+lat+":"+lon)%1000)/999-.5)*3.2,jLon=((wildernessHash("lon:"+lat+":"+lon)%1000)/999-.5)*3.2;
    const sample=geography.sampleLatLon((lat+jLat)*Math.PI/180,(lon+jLon)*Math.PI/180);
    if(!sample.land){rejectedWater++;continue;}
    const descriptor={latitudeRadians:sample.latitudeRadians,longitudeRadians:sample.longitudeRadians,elevationMeters:sample.elevationMeters,surfaceClass:sample.surfaceClass,moisture:sample.moisture};
    const roll=wildernessHash("kind:"+lat+":"+lon)%100;
    if(sample.elevationMeters>1450||sample.mountainInfluence>.22){if(roll<72)rocks.push(descriptor);}    else if(sample.moisture>.40){if(roll<78)vegetation.push(descriptor);}
    else if(roll<48)rocks.push(descriptor);else if(roll<82)vegetation.push(descriptor);
    if(sample.moisture>.46&&sample.elevationMeters<1200&&(wildernessHash("fauna:"+lat+":"+lon)%100)<12)fauna.push(descriptor);
  }
  wilderness={generated:true,cellCount:cells,acceptedStaticProps:vegetation.length+rocks.length,vegetationClusters:vegetation.length,rockClusters:rocks.length,ambientFaunaZones:fauna.length,rejectedWater,drawCalls:0,triangles:0,preparationMs:Number((performance.now()-started).toFixed(3)),cacheReuse:false,perFrameScatter:false,simulationAuthority:false};
  return {vegetation,rocks,fauna};
}
function buildWildernessMesh(items,size){
  const positions=[],normals=[],indices=[];
  for(const item of items){
    const d=window.PlanetGeography.directionFromLatLon(item.latitudeRadians,item.longitudeRadians);
    const radius=DISPLAY_RADIUS_UNITS*(1+(Math.max(40,item.elevationMeters)/WORLD_RADIUS_METERS)*HEIGHT_EXAGGERATION)+.012;
    const base={x:d.x*radius,y:d.y*radius,z:d.z*radius};
    const ref=Math.abs(d.y)<.88?{x:0,y:1,z:0}:{x:1,y:0,z:0};
    let ux=ref.y*d.z-ref.z*d.y,uy=ref.z*d.x-ref.x*d.z,uz=ref.x*d.y-ref.y*d.x;const ul=Math.hypot(ux,uy,uz)||1;ux/=ul;uy/=ul;uz/=ul;
    const vx=d.y*uz-d.z*uy,vy=d.z*ux-d.x*uz,vz=d.x*uy-d.y*ux;
    const start=positions.length/3,half=size*.90;
    positions.push(base.x+ux*half,base.y+uy*half,base.z+uz*half,base.x-ux*half,base.y-uy*half,base.z-uz*half,base.x+vx*half,base.y+vy*half,base.z+vz*half,base.x+d.x*size*.28,base.y+d.y*size*.28,base.z+d.z*size*.28);
    for(let i=0;i<4;i++)normals.push(d.x,d.y,d.z);    indices.push(start,start+1,start+3,start+1,start+2,start+3,start+2,start,start+3);
  }
  if(!positions.length)return null;
  const mesh=new pc.Mesh(device);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setIndices(indices);mesh.update();wilderness.triangles+=indices.length/3;return mesh;
}
function buildWildernessPresentation(){
  const groups=buildWildernessDescriptors();
  const specs=[[groups.vegetation,.028,[.18,.38,.13],"WildernessVegetation"],[groups.rocks,.024,[.38,.33,.25],"WildernessRock"]];
  for(const [items,size,color,name] of specs){const mesh=buildWildernessMesh(items,size);if(!mesh)continue;const material=new pc.StandardMaterial();material.name=name+"Material";material.diffuse.set(...color);material.roughness=.92;material.update();const entity=new pc.Entity(name);entity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});entity.render.meshInstances=[new pc.MeshInstance(mesh,material,entity)];planet.addChild(entity);wilderness.drawCalls++;}
}
function visualElevationMeters(sample){
  if(sample.land)return Math.max(40,Number(sample.elevationMeters)||0);
  return Math.max(-520,(Number(sample.elevationMeters)||0)*OCEAN_VISUAL_DEPTH_FACTOR);
}
async function buildPlanetMesh(){
  const positions=[];
  const uvs=[];
  const indices=[];
  const normals=[];
  const stride=LONGITUDE_SEGMENTS+1;

  await runSlicedRange(LATITUDE_SEGMENTS+1,latIndex=>{
    const v=latIndex/LATITUDE_SEGMENTS;
    const lat=(0.5-v)*Math.PI;
    for(let lonIndex=0;lonIndex<=LONGITUDE_SEGMENTS;lonIndex++){
      const u=lonIndex/LONGITUDE_SEGMENTS;
      const lon=(u-0.5)*Math.PI*2;
      const direction=window.PlanetGeography.directionFromLatLon(lat,lon);
      const sample=geography.sampleDirection(direction);
      const visualMeters=visualElevationMeters(sample);
      const radius=DISPLAY_RADIUS_UNITS*(1+(visualMeters/WORLD_RADIUS_METERS)*HEIGHT_EXAGGERATION);
      positions.push(direction.x*radius,direction.y*radius,direction.z*radius);
      // Every longitude collapses to one geometric point at each pole. Give
      // those duplicate pole vertices one canonical U so the equirectangular
      // texture cannot create a radial seam/fan at the singularity.
      uvs.push((latIndex===0||latIndex===LATITUDE_SEGMENTS)?.5:u,1-v);normals.push(0,0,0);
    }
  });
  await runSlicedRange(LATITUDE_SEGMENTS,lat=>{
    for(let lon=0;lon<LONGITUDE_SEGMENTS;lon++){
      const a=lat*stride+lon;
      const b=a+1;
      const c=a+stride;
      const d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  });
  const faceCount=indices.length/3;
  await runSlicedRange(faceCount,face=>{
    const i=face*3,ia=indices[i],ib=indices[i+1],ic=indices[i+2];
    const ax=positions[ia*3],ay=positions[ia*3+1],az=positions[ia*3+2];
    const bx=positions[ib*3],by=positions[ib*3+1],bz=positions[ib*3+2];
    const cx=positions[ic*3],cy=positions[ic*3+1],cz=positions[ic*3+2];
    const abx=bx-ax,aby=by-ay,abz=bz-az;
    const acx=cx-ax,acy=cy-ay,acz=cz-az;
    const nx=aby*acz-abz*acy;
    const ny=abz*acx-abx*acz;
    const nz=abx*acy-aby*acx;
    normals[ia*3]+=nx;normals[ia*3+1]+=ny;normals[ia*3+2]+=nz;
    normals[ib*3]+=nx;normals[ib*3+1]+=ny;normals[ib*3+2]+=nz;
    normals[ic*3]+=nx;normals[ic*3+1]+=ny;normals[ic*3+2]+=nz;
  });
  await runSlicedRange(normals.length/3,index=>{
    const i=index*3,len=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;
    normals[i]/=len;normals[i+1]/=len;normals[i+2]/=len;
  });
  await runSlicedRange(LATITUDE_SEGMENTS+1,lat=>{
    const a=lat*stride,b=a+LONGITUDE_SEGMENTS;
    const nx=normals[a*3]+normals[b*3],ny=normals[a*3+1]+normals[b*3+1],nz=normals[a*3+2]+normals[b*3+2];
    const len=Math.hypot(nx,ny,nz)||1;
    normals[a*3]=normals[b*3]=nx/len;
    normals[a*3+1]=normals[b*3+1]=ny/len;
    normals[a*3+2]=normals[b*3+2]=nz/len;
  });
  for(const row of [0,LATITUDE_SEGMENTS]){
    let nx=0,ny=0,nz=0;
    for(let lon=0;lon<=LONGITUDE_SEGMENTS;lon++){
      const index=row*stride+lon;
      nx+=normals[index*3];ny+=normals[index*3+1];nz+=normals[index*3+2];
    }
    const len=Math.hypot(nx,ny,nz)||1;
    nx/=len;ny/=len;nz/=len;
    for(let lon=0;lon<=LONGITUDE_SEGMENTS;lon++){
      const index=row*stride+lon;
      normals[index*3]=nx;normals[index*3+1]=ny;normals[index*3+2]=nz;
    }
    await yieldBrowser();
  }

  const mesh=new pc.Mesh(device);
  const commitStarted=performance.now();
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0,uvs);
  mesh.setIndices(indices);
  startupScheduler.phaseTimings.planetMeshBufferStageMs=Number((performance.now()-commitStarted).toFixed(3));
  await yieldBrowser();
  const uploadStarted=performance.now();
  mesh.update();
  startupScheduler.phaseTimings.planetMeshUploadMs=Number((performance.now()-uploadStarted).toFixed(3));
  meshVertexCount=positions.length/3;
  meshTriangleCount=indices.length/3;
  return mesh;
}
function resize(){
  if(!app||!device||!root)return;
  // The scale ladder is discrete player-facing state. Reframing for a new
  // viewport must not leave the scalar calibrated for the previous aspect ratio,
  // or the same 1/N step will show a different physical footprint after resize.
  const preservedScaleIndex=scaleIndexForScalar(zoomState.scalar);
  const width=Math.max(1,Math.round(root.clientWidth||window.innerWidth||1));
  const height=Math.max(1,Math.round(root.clientHeight||window.innerHeight||1));
  const dpr=Math.min(1.5,Math.max(1,Number(window.devicePixelRatio||1)));
  device.maxPixelRatio=dpr;
  app.setCanvasFillMode(pc.FILLMODE_NONE,width,height);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.resizeCanvas(width,height);
  app.updateCanvasSize?.();
  if(cameraEntity){
    const verticalHalfFov=(34*Math.PI/180)*0.5;
    const aspect=Math.max(0.1,width/height);
    const horizontalHalfFov=Math.atan(Math.tan(verticalHalfFov)*aspect);
    const limitingHalfFov=Math.max(0.05,Math.min(verticalHalfFov,horizontalHalfFov));
    const maxReliefFactor=1+(7000/WORLD_RADIUS_METERS)*HEIGHT_EXAGGERATION;
    const framingMargin=(height<=500&&aspect>1.7)?0.78:(aspect>1.7?1.015:1.055);
    const distance=(DISPLAY_RADIUS_UNITS*maxReliefFactor/Math.sin(limitingHalfFov))*framingMargin;
    zoomState.baseCameraDistance=distance;
    zoomState.scalar=scalarForScaleIndex(preservedScaleIndex);
    applyCameraZoom();
  }
}
function dismissInspection(){const hadSelection=inspection.selectedId!==null||inspection.selectedType!==null||!!root?.querySelector?.(".world-inspection-tooltip");inspection.selectedId=null;inspection.selectedType=null;if(hadSelection)inspection.dismissCount++;root?.querySelector?.(".world-inspection-tooltip")?.remove();}
function inspectionIdText(id){return String(id).trim();}
function inspectionRegistryKey(type,id){return String(type)+":"+inspectionIdText(id);}
function registerInspectionPickable(record){
  if(record?.id===undefined||record.id===null||inspectionIdText(record.id).length===0||!["npc","building"].includes(record.type)||typeof record.screenBounds!=="function")return false;
  inspectionPickables.set(inspectionRegistryKey(record.type,record.id),record);return true;
}
function unregisterInspectionPickable(id,type=null){
  const idText=inspectionIdText(id),keys=type?[inspectionRegistryKey(type,idText)]:Array.from(inspectionPickables.entries()).filter(([,record])=>inspectionIdText(record.id)===idText).map(([key])=>key);
  if(inspection.selectedId===idText&&(!type||inspection.selectedType===type))dismissInspection();
  let removed=false;for(const key of keys)removed=inspectionPickables.delete(key)||removed;return removed;
}
function readableInspectionLines(record){
  const readable=(value,fallback)=>{const text=String(value??"").trim();return text||fallback;};
  if(record.type==="npc"){
    let live=null;try{live=typeof record.inspect==="function"?record.inspect():null;}catch{live=null;}
    return [readable(live?.displayName||record.name,"Unknown resident"),readable(live?.profession||record.job,"Unassigned"),readable(live?.activity||record.activity,"Activity unavailable")];
  }
  const functionLabel=String(record.functionLabel??"").trim(),buildingType=String(record.buildingType??"").trim(),typeLabel=functionLabel||buildingType||"Building",name=String(record.name??"").trim();
  return name&&name!==typeLabel?[name,typeLabel]:[typeLabel];
}
function renderInspectionTooltip(record,knownBounds=null){
  let tip=root?.querySelector?.(".world-inspection-tooltip");if(!tip){tip=document.createElement("aside");tip.className="world-inspection-tooltip";tip.setAttribute("role","status");root.appendChild(tip);}
  const started=performance.now();let bounds=knownBounds;try{if(bounds===null)bounds=record.screenBounds();}catch{bounds=null;}
  if(!bounds||![bounds.left,bounds.right,bounds.top,bounds.bottom].every(Number.isFinite)||bounds.left>bounds.right||bounds.top>bounds.bottom){dismissInspection();return false;}
  const now=performance.now(),recordKey=inspectionRegistryKey(record.type,record.id),selectionChanged=tip.dataset.recordKey!==recordKey;
  if(selectionChanged||tip.dataset.contentKey===undefined||now-inspection.lastContentRefreshAtMs>=250){
    const lines=readableInspectionLines(record),contentKey=lines.join("\u001f");
    if(tip.dataset.contentKey!==contentKey){
      tip.replaceChildren();lines.forEach((line,index)=>{const el=document.createElement(index===0?"strong":"span");el.textContent=line;tip.appendChild(el);});
      tip.dataset.contentKey=contentKey;inspection.contentRefreshes++;
    }
    inspection.lastContentRefreshAtMs=now;
  }
  if(selectionChanged)tip.dataset.recordKey=recordKey;
  const rootRect=root.getBoundingClientRect(),anchorX=(bounds.left+bounds.right)/2-rootRect.left,anchorY=bounds.top-rootRect.top;
  tip.style.visibility="hidden";tip.style.left="0px";tip.style.top="0px";
  const tipRect=tip.getBoundingClientRect(),halfWidth=Math.min(rootRect.width/2,tipRect.width/2),margin=12;
  const clampX=value=>clamp(value,margin+halfWidth,Math.max(margin+halfWidth,rootRect.width-margin-halfWidth));
  const clampY=(value,below)=>below
    ?clamp(value,margin,Math.max(margin,rootRect.height-tipRect.height-margin))
    :clamp(value,margin+tipRect.height,Math.max(margin+tipRect.height,rootRect.height-margin));
  const boxFor=(x,y,below)=>({left:x-halfWidth,right:x+halfWidth,top:below?y:y-tipRect.height,bottom:below?y+tipRect.height:y});
  const overlaps=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
  const reserved=[".planet-map-context",".planet-places-button",".planet-scale-ruler"].map(selector=>root.querySelector?.(selector)?.getBoundingClientRect?.()).filter(Boolean).map(r=>({left:r.left-rootRect.left-margin/2,right:r.right-rootRect.left+margin/2,top:r.top-rootRect.top-margin/2,bottom:r.bottom-rootRect.top+margin/2}));
  const preferredBelow=anchorY-tipRect.height-margin<margin,candidates=[];
  const addCandidate=(x,y,below)=>{
    const cx=clampX(x),cy=clampY(y,below),box=boxFor(cx,cy,below);
    if(reserved.some(r=>overlaps(box,r)))return;
    const centerY=below?cy+tipRect.height/2:cy-tipRect.height/2;
    candidates.push({x:cx,y:cy,below,score:Math.hypot(cx-anchorX,centerY-anchorY)+(below===preferredBelow?0:8)});
  };
  for(const below of [preferredBelow,!preferredBelow]){
    const anchorYForSide=below?anchorY+margin:anchorY-margin;
    addCandidate(anchorX,anchorYForSide,below);
    for(const r of reserved){
      addCandidate(r.right+margin+halfWidth,anchorYForSide,below);
      addCandidate(r.left-margin-halfWidth,anchorYForSide,below);
      addCandidate(anchorX,below?r.bottom+margin:r.top-margin,below);
    }
  }
  const chosen=(candidates.sort((a,b)=>a.score-b.score)[0])||{x:clampX(anchorX),y:clampY(preferredBelow?anchorY+margin:anchorY-margin,preferredBelow),below:preferredBelow};
  tip.classList.toggle("below-anchor",chosen.below);tip.dataset.placement=chosen.below?"below":"above";tip.style.left=chosen.x+"px";tip.style.top=chosen.y+"px";tip.style.visibility="";inspection.tooltipUpdates++;inspection.lastTooltipUpdateMs=Number((performance.now()-started).toFixed(3));return true;
}
function pickInspection(clientX,clientY){
  const started=performance.now(),candidates=[];
  for(const record of inspectionPickables.values()){
    let visible=true;try{visible=record.visible?.()!==false;}catch{visible=false;}if(!visible)continue;
    let b=null;try{b=record.screenBounds();}catch{continue;}
    if(!b||![b.left,b.right,b.top,b.bottom].every(Number.isFinite)||b.left>b.right||b.top>b.bottom)continue;
    if(clientX<b.left||clientX>b.right||clientY<b.top||clientY>b.bottom)continue;
    if(typeof record.hitTest==="function"){
      let hit=false;try{hit=record.hitTest(clientX,clientY,b)!==false;}catch{hit=false;}
      if(!hit)continue;
    }
    candidates.push({record,bounds:b});
  }
  const depthOf=record=>{let raw=Infinity;try{raw=typeof record.screenDepth==="function"?record.screenDepth():record.screenDepth??Infinity;}catch{return Infinity;}const value=Number(raw);return Number.isFinite(value)?value:Infinity;};
  const priorityOf=record=>{const value=Number(record.pickPriority??0);return Number.isFinite(value)?value:0;};
  candidates.sort((a,b)=>priorityOf(b.record)-priorityOf(a.record)||depthOf(a.record)-depthOf(b.record)||inspectionRegistryKey(a.record.type,a.record.id).localeCompare(inspectionRegistryKey(b.record.type,b.record.id)));
  inspection.pickQueries++;inspection.lastPickCandidateCount=candidates.length;inspection.lastPickQueryMs=Number((performance.now()-started).toFixed(3));
  const picked=candidates[0];if(!picked){dismissInspection();return null;}inspection.selectedId=inspectionIdText(picked.record.id);inspection.selectedType=picked.record.type;if(!renderInspectionTooltip(picked.record,picked.bounds))return null;return picked.record;
}
function updateInspectionTooltip(){if(inspection.selectedId===null)return;const record=inspectionPickables.get(inspectionRegistryKey(inspection.selectedType,inspection.selectedId));if(!record){dismissInspection();return;}let visible=true;try{visible=record.visible?.()!==false;}catch{visible=false;}if(!visible){dismissInspection();return;}renderInspectionTooltip(record);}
function bindInput(){
  canvas.tabIndex=0;
  canvas.setAttribute("role","application");
  canvas.setAttribute("aria-label","Rotatable seeded fantasy planet. Drag to rotate.");
  canvas.addEventListener("contextmenu",event=>event.preventDefault());
  canvas.addEventListener("wheel",event=>{zoomState.wheelEvents++;if(event.deltaY!==0)stepScale(event.deltaY<0?1:-1);event.preventDefault();},{passive:false});
  canvas.addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse"&&event.button!==0)return;
    activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(activePointers.size===2){const pts=Array.from(activePointers.values());lastPinchDistance=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);dragging=false;pointerId=null;event.preventDefault();return;}
    if(dragging||pointerId!==null){activePointers.delete(event.pointerId);return;}
    dragging=true;pointerId=event.pointerId;
    lastPointerX=event.clientX;lastPointerY=event.clientY;inspection.pointerDownX=event.clientX;inspection.pointerDownY=event.clientY;inspection.dragDistance=0;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.focus({preventScroll:true});
    pointerDragCount++;event.preventDefault();
  },{passive:false});
  canvas.addEventListener("pointermove",event=>{
    if(activePointers.has(event.pointerId))activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(activePointers.size>=2){const pts=Array.from(activePointers.values()).slice(0,2),distance=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);if(lastPinchDistance!==null&&Math.abs(distance-lastPinchDistance)>=8){zoomState.pinchEvents++;stepScale(distance>lastPinchDistance?1:-1);lastPinchDistance=distance;}event.preventDefault();return;}
    if(!dragging||event.pointerId!==pointerId)return;
    const dx=event.clientX-lastPointerX,dy=event.clientY-lastPointerY;
    inspection.dragDistance=Math.max(inspection.dragDistance,Math.hypot(event.clientX-inspection.pointerDownX,event.clientY-inspection.pointerDownY));
    lastPointerX=event.clientX;lastPointerY=event.clientY;
    rotateByScreenPixels(dx,dy);event.preventDefault();
  },{passive:false});
  const endPointer=event=>{
    activePointers.delete(event.pointerId);if(activePointers.size<2)lastPinchDistance=null;
    if(event.pointerId!==pointerId)return;
    dragging=false;canvas.releasePointerCapture?.(event.pointerId);pointerId=null;if(event.type==="pointerup"&&inspection.dragDistance<=6)pickInspection(event.clientX,event.clientY);
  };
  canvas.addEventListener("pointerup",endPointer);
  canvas.addEventListener("pointercancel",endPointer);
  canvas.addEventListener("keydown",event=>{
    let handled=true;
    if(event.key==="ArrowLeft")rotateByScreenFraction(-.08,0);
    else if(event.key==="ArrowRight")rotateByScreenFraction(.08,0);
    else if(event.key==="ArrowUp")rotateByScreenFraction(0,-.08);
    else if(event.key==="ArrowDown")rotateByScreenFraction(0,.08);
    else if(event.key==="+"||event.key==="=")stepScale(1);
    else if(event.key==="-"||event.key==="_")stepScale(-1);
    else if(event.key==="Escape"){dismissInspection();}
    else handled=false;
    if(handled)event.preventDefault();
  });
}
function seededUnit(label){
  let h=2166136261>>>0;for(const ch of String(activeSeed)+"|"+label){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return (h>>>0)/4294967295;
}
function makeCloudTexture(){
  const source=document.createElement("canvas");source.width=256;source.height=128;
  const ctx=source.getContext("2d");const image=ctx.createImageData(source.width,source.height),data=image.data;
  const phaseA=seededUnit("cloud-a")*Math.PI*2,phaseB=seededUnit("cloud-b")*Math.PI*2,phaseC=seededUnit("cloud-c")*Math.PI*2;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const u=x/source.width,v=y/source.height,lat=(v-.5)*Math.PI;
    const field=Math.sin(u*Math.PI*10+phaseA)*.34+Math.sin(u*Math.PI*22+v*Math.PI*5+phaseB)*.22+Math.cos(u*Math.PI*7-v*Math.PI*13+phaseC)*.18+Math.cos(lat*3)*.20;
    // Longitude is singular at a sphere pole and every longitude wedge shares
    // the same physical pole. Even tiny non-zero alpha there stacks through
    // coincident translucent triangles as a radial fan. Keep a true zero-alpha
    // polar cap, then ease clouds back in before normal latitudes.
    const poleDistance=Math.min(v,1-v);
    const polarT=clamp((poleDistance-.05)/.05,0,1),polarFade=polarT*polarT*(3-2*polarT);
    const alpha=Math.round(clamp((field-.12)*260,0,112)*polarFade);const i=(y*source.width+x)*4;
    data[i]=232;data[i+1]=241;data[i+2]=246;data[i+3]=alpha;
  }
  ctx.putImageData(image,0,0);
  const texture=new pc.Texture(device,{width:source.width,height:source.height,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
  texture.name="SeededPlanetClouds";texture.addressU=pc.ADDRESS_REPEAT;texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;texture.magFilter=pc.FILTER_LINEAR;texture.setSource(source);return texture;
}
function buildAmbientMotion(surfaceMesh){
  const material=new pc.StandardMaterial();const texture=makeCloudTexture();
  material.name="SeededCloudLayer";material.diffuse.set(1,1,1);material.emissive.set(.72,.78,.84);material.__atmosphereBaseDiffuse=[1,1,1];material.emissiveMap=texture;material.emissiveIntensity=.9;material.opacityMap=texture;material.opacityMapChannel="a";material.opacity=.58;material.blendType=pc.BLEND_NORMAL;material.depthWrite=false;material.cull=pc.CULLFACE_BACK;material.useLighting=false;material.update();
  cloudLayer=new pc.Entity("AmbientCloudLayer");cloudLayer.setLocalScale(1.018,1.018,1.018);cloudLayer.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});cloudLayer.render.meshInstances=[new pc.MeshInstance(surfaceMesh,material,cloudLayer)];planet.addChild(cloudLayer);
  ambientMotion={...ambientMotion,cloudLayerCount:1,animatedEntityCount:1,drawCallEstimate:1};
}
function updateAmbientMotion(dt){
  if(!ambientMotion.enabled||dragging)return;
  const started=performance.now(),step=Math.min(.12,Math.max(0,Number(dt)||0));ambientMotion.cloudYawDegrees=(ambientMotion.cloudYawDegrees+step*2.4)%360;
  if(cloudLayer)cloudLayer.setLocalEulerAngles(0,ambientMotion.cloudYawDegrees,0);
  localFaunaClock=(localFaunaClock+step)%10000;
  localFaunaReactionAccumulator+=step;
  if(localFaunaReactionAccumulator>=LOCAL_FAUNA_REACTION_TICK_SECONDS){
    localFaunaReactionAccumulator%=LOCAL_FAUNA_REACTION_TICK_SECONDS;
    tickLocalFaunaReactionTriggers();
  }
  const faunaStarted=performance.now();
  updateLocalFaunaMotion(step);
  updateEnvironmentalReactions();
  const faunaMs=performance.now()-faunaStarted;
  wilderness={...wilderness,localFrameUpdateMs:Number(faunaMs.toFixed(4)),localMaxFrameUpdateMs:Math.max(Number(wilderness.localMaxFrameUpdateMs||0),Number(faunaMs.toFixed(4))),localAmbientFaunaActiveCount:localFaunaActors.length};
  ambientMotion.updateCount++;ambientMotion.lastUpdateMs=performance.now()-started;ambientMotion.maxUpdateMs=Math.max(ambientMotion.maxUpdateMs,ambientMotion.lastUpdateMs);
}
function lerp(a,b,t){return a+(b-a)*t;}
function mixRgb(a,b,t){return a.map((v,i)=>lerp(v,b[i],t));}
function fantasyHourFromStamp(stamp){
  if(stamp&&typeof stamp==="object"&&Number.isFinite(Number(stamp.hour)))return ((Number(stamp.hour)%24)+24)%24+clamp(Number(stamp.minute||0),0,59)/60;
  const m=/(?:T|\s)(\d{1,2}):(\d{2})/.exec(String(stamp||""));return m?((Number(m[1])%24)+24)%24+clamp(Number(m[2]),0,59)/60:null;
}
function paletteForHour(hour){
  const stops=[
    {h:0,phase:"night",key:[.50,.62,.92],fill:[.24,.34,.64],ambient:[.20,.23,.36],sky:[.012,.024,.072],keyI:.78,fillI:.72,emissive:.090,worldTint:[.72,.80,1],terrainTint:[.58,.70,1],localTint:[.72,.82,1],terrainI:.58,localE:.045,cloudTint:[.60,.70,.92],cloudI:.72},
    {h:5,phase:"dawn",key:[1,.68,.42],fill:[.40,.44,.68],ambient:[.36,.30,.34],sky:[.12,.075,.14],keyI:1.18,fillI:.82,emissive:.080,worldTint:[1,.86,.72],terrainTint:[1,.76,.58],localTint:[1,.88,.76],terrainI:.73,localE:.025,cloudTint:[1,.80,.76],cloudI:.80},
    {h:8,phase:"day",key:[1,.93,.72],fill:[.36,.54,.82],ambient:[.42,.46,.54],sky:[.018,.045,.09],keyI:1.38,fillI:.90,emissive:.025,worldTint:[1,.97,.88],terrainTint:[1,.95,.84],localTint:[1,.98,.90],terrainI:.76,localE:.008,cloudTint:[.92,.96,1],cloudI:.90},
    {h:12,phase:"day",key:[1,.97,.90],fill:[.34,.50,.78],ambient:[.40,.43,.50],sky:[.004,.008,.018],keyI:1.50,fillI:.94,emissive:.022,worldTint:[1,1,.98],terrainTint:[1,1,.96],localTint:[1,1,.96],terrainI:.78,localE:.006,cloudTint:[.96,.98,1],cloudI:.94},
    {h:17,phase:"late-day",key:[1,.78,.48],fill:[.46,.42,.70],ambient:[.38,.32,.40],sky:[.085,.052,.105],keyI:1.30,fillI:.86,emissive:.070,worldTint:[1,.84,.68],terrainTint:[1,.72,.52],localTint:[1,.85,.70],terrainI:.70,localE:.026,cloudTint:[1,.78,.70],cloudI:.82},
    {h:20,phase:"night",key:[.60,.68,.98],fill:[.27,.38,.70],ambient:[.24,.27,.40],sky:[.018,.03,.082],keyI:.88,fillI:.76,emissive:.085,worldTint:[.76,.82,1],terrainTint:[.60,.72,1],localTint:[.74,.82,1],terrainI:.60,localE:.040,cloudTint:[.64,.72,.94],cloudI:.74},
    {h:24,phase:"night",key:[.50,.62,.92],fill:[.24,.34,.64],ambient:[.20,.23,.36],sky:[.012,.024,.072],keyI:.78,fillI:.72,emissive:.090,worldTint:[.72,.80,1],terrainTint:[.58,.70,1],localTint:[.72,.82,1],terrainI:.58,localE:.045,cloudTint:[.60,.70,.92],cloudI:.72}
  ];
  let a=stops[0],b=stops[1];for(let i=0;i<stops.length-1;i++){if(hour>=stops[i].h&&hour<=stops[i+1].h){a=stops[i];b=stops[i+1];break;}}
  const t=clamp((hour-a.h)/Math.max(.001,b.h-a.h),0,1),phase=(t<.5?a.phase:b.phase);
  return {
    phase,key:mixRgb(a.key,b.key,t),fill:mixRgb(a.fill,b.fill,t),ambient:mixRgb(a.ambient,b.ambient,t),sky:mixRgb(a.sky,b.sky,t),
    keyI:lerp(a.keyI,b.keyI,t),fillI:lerp(a.fillI,b.fillI,t),emissive:lerp(a.emissive,b.emissive,t),
    worldTint:mixRgb(a.worldTint,b.worldTint,t),terrainTint:mixRgb(a.terrainTint,b.terrainTint,t),localTint:mixRgb(a.localTint,b.localTint,t),
    terrainI:lerp(a.terrainI,b.terrainI,t),localE:lerp(a.localE,b.localE,t),cloudTint:mixRgb(a.cloudTint,b.cloudTint,t),cloudI:lerp(a.cloudI,b.cloudI,t)
  };
}
function gradeAtmosphereLocalMaterial(material,tint,emissiveStrength=0){
  if(!material)return false;
  const base=material.__atmosphereBaseDiffuse||[material.diffuse?.r??1,material.diffuse?.g??1,material.diffuse?.b??1];
  material.__atmosphereBaseDiffuse=base;
  material.diffuse.set(base[0]*tint[0],base[1]*tint[1],base[2]*tint[2]);
  const effectiveEmissive=Math.max(Number(emissiveStrength)||0,Number(material.__activityEmissiveBoost)||0);
  material.emissive.set(base[0]*tint[0]*effectiveEmissive,base[1]*tint[1]*effectiveEmissive,base[2]*tint[2]*effectiveEmissive);
  material.emissiveIntensity=1;
  material.update();return true;
}
function applyAtmosphereMaterialPalette(p){
  if(!p)return 0;
  let materialCount=0;
  if(surfaceMaterial){
    surfaceMaterial.diffuse.set(...p.worldTint);
    surfaceMaterial.emissive.set(p.emissive*p.worldTint[0],p.emissive*p.worldTint[1],p.emissive*p.worldTint[2]);
    surfaceMaterial.update();materialCount++;
  }
  if(tangentPatchMaterial){
    tangentPatchMaterial.diffuse.set(...p.terrainTint);tangentPatchMaterial.emissive.set(...p.terrainTint);tangentPatchMaterial.emissiveIntensity=p.terrainI;tangentPatchMaterial.update();materialCount++;
  }
  if(horizonSkirtMaterial){
    horizonSkirtMaterial.diffuse.set(...p.terrainTint);horizonSkirtMaterial.emissive.set(...p.terrainTint);horizonSkirtMaterial.emissiveIntensity=p.terrainI*.96;horizonSkirtMaterial.update();materialCount++;
  }
  if(localStaticMaterials)for(const material of Object.values(localStaticMaterials)){if(gradeAtmosphereLocalMaterial(material,p.localTint,p.localE))materialCount++;}
  if(localNpcMaterials)for(const material of Object.values(localNpcMaterials)){if(gradeAtmosphereLocalMaterial(material,p.localTint,p.localE*1.35))materialCount++;}
  const cloudMaterial=cloudLayer?.render?.meshInstances?.[0]?.material;
  if(cloudMaterial){cloudMaterial.emissive.set(...p.cloudTint);cloudMaterial.emissiveIntensity=p.cloudI;cloudMaterial.update();materialCount++;}
  return materialCount;
}
function applyAuthoritativeFantasyTime(stamp,source="authoritative-fantasy-time"){
  const hour=fantasyHourFromStamp(stamp);if(hour===null||!keyLight||!fillLight||!surfaceMaterial||!cameraEntity)return snapshot();
  const p=paletteForHour(hour);atmospherePalette=p;
  keyLight.light.color.set(...p.key);keyLight.light.intensity=p.keyI;fillLight.light.color.set(...p.fill);fillLight.light.intensity=p.fillI;
  app.scene.ambientLight.set(...p.ambient);cameraEntity.camera.clearColor.set(...p.sky);
  const materialCount=applyAtmosphereMaterialPalette(p);
  atmosphere={
    active:true,authoritativeHour:Number(hour.toFixed(3)),phase:p.phase,source:String(source),dynamicLightCount:2,materialCount,drawCallImpact:0,simulationAuthority:false,
    keyIntensity:Number(p.keyI.toFixed(3)),fillIntensity:Number(p.fillI.toFixed(3)),ambient:p.ambient.map(v=>Number(v.toFixed(3))),sky:p.sky.map(v=>Number(v.toFixed(3))),
    worldTint:p.worldTint.map(v=>Number(v.toFixed(3))),terrainTint:p.terrainTint.map(v=>Number(v.toFixed(3))),localTint:p.localTint.map(v=>Number(v.toFixed(3))),
    terrainEmissiveIntensity:Number(p.terrainI.toFixed(3)),localEmissiveStrength:Number(p.localE.toFixed(3)),cloudTint:p.cloudTint.map(v=>Number(v.toFixed(3))),cloudIntensity:Number(p.cloudI.toFixed(3)),
    groundPaletteIntegrated:true,postProcess:false,weatherSimulation:false
  };
  refreshCanonicalNpcPresentation();
  refreshCanonicalBuildingActivityPresentation();
  if(inspection.selectedId!==null){
    inspection.lastContentRefreshAtMs=Number.NEGATIVE_INFINITY;
    updateInspectionTooltip();
  }
  return snapshot();
}
function atmosphereTimestampKey(value){
  if(!value)return null;
  try{return window.GameTime?.toTimestampKey?.(value)||[value.year,value.month,value.day,value.hour,value.minute,value.second].join("-");}catch(_){return null;}
}
function initializeAtmosphereTimeBinding(){
  const available=Boolean(window.SeedSystem?.loadCampaign&&window.SeedSystem?.getCampaign&&window.GameTime?.getNow);
  atmosphereTimeBinding={...atmosphereTimeBinding,available,active:false,source:available?"GameTime.getNow":"unavailable",campaignSeed:null,lastTimestampKey:null,lastPollAtMs:performance.now(),lastAppliedAtMs:0,error:null};
  if(!available)return false;
  try{
    if(!window.SeedSystem.getCampaign())window.SeedSystem.loadCampaign();
    const campaign=window.SeedSystem.getCampaign();
    if(!campaign){atmosphereTimeBinding={...atmosphereTimeBinding,source:"no-existing-campaign"};return false;}
    const now=window.GameTime.getNow();if(!now){atmosphereTimeBinding={...atmosphereTimeBinding,source:"campaign-without-time"};return false;}
    const key=atmosphereTimestampKey(now);
    applyAuthoritativeFantasyTime(now,"GameTime.getNow");
    atmosphereTimeBinding={...atmosphereTimeBinding,active:true,source:"GameTime.getNow",campaignSeed:String(campaign.seed||""),lastTimestampKey:key,lastAppliedAtMs:performance.now(),error:null};
    return true;
  }catch(error){
    atmosphereTimeBinding={...atmosphereTimeBinding,active:false,source:"binding-error",error:String(error?.message||error)};
    return false;
  }
}
function updateAtmosphereTimeBinding(){
  if(!atmosphereTimeBinding.available)return;
  const nowMs=performance.now();
  if(nowMs-Number(atmosphereTimeBinding.lastPollAtMs||0)<Number(atmosphereTimeBinding.pollIntervalMs||1000))return;
  atmosphereTimeBinding={...atmosphereTimeBinding,lastPollAtMs:nowMs};
  try{
    const campaign=window.SeedSystem?.getCampaign?.()||null;
    if(!campaign){atmosphereTimeBinding={...atmosphereTimeBinding,active:false,source:"no-existing-campaign",campaignSeed:null};return;}
    const now=window.GameTime?.getNow?.();if(!now)return;
    const key=atmosphereTimestampKey(now);
    if(key&&key!==atmosphereTimeBinding.lastTimestampKey){
      applyAuthoritativeFantasyTime(now,"GameTime.getNow");
      atmosphereTimeBinding={...atmosphereTimeBinding,active:true,source:"GameTime.getNow",campaignSeed:String(campaign.seed||""),lastTimestampKey:key,lastAppliedAtMs:nowMs,error:null};
    }else if(!atmosphereTimeBinding.active){
      atmosphereTimeBinding={...atmosphereTimeBinding,active:true,source:"GameTime.getNow",campaignSeed:String(campaign.seed||""),lastTimestampKey:key,error:null};
    }
  }catch(error){atmosphereTimeBinding={...atmosphereTimeBinding,active:false,source:"binding-error",error:String(error?.message||error)};}
}
async function buildScene(){  const started=performance.now();
  setStartupProgress("geography","Generating continents, oceans and islands…",52);
  if(!window.PlanetGeography)throw new Error("PlanetGeography is unavailable");
  activeSeed=window.PlanetGeography.resolveSeed();
  geography=window.PlanetGeography.create(activeSeed);
  worldProjectionAnchorCache=null;
  politicalScaleEvidenceCache=null;
  mapContextCache={key:null,value:null};
  mapBorderCache={key:null,segments:[],sampleCount:0,landSampleCount:0,waterSampleCount:0,ownerQueryCount:0,ownerCount:0,worldVertexCount:0,topologySignature:null,waterClippedCount:0,diagnostics:[],builtAtMs:0};
  mapBorderEndpointSnapCache.clear();
  atlasEntityCache.clear();atlasIdentityCache.clear();atlasStickyEntities.clear();atlasLabelPlacementCache.clear();
  geographySignature=geography.signature();
  geographyVerification=null;
  setStartupProgress("surface","Painting planetary surface and relief…",68);

  app.scene.ambientLight=new pc.Color(0.34,0.37,0.43);

  cameraEntity=new pc.Entity("PlanetCamera");
  cameraEntity.addComponent("camera",{
    clearColor:new pc.Color(0.004,0.008,0.018),
    projection:pc.PROJECTION_ORTHOGRAPHIC,
    orthoHeight:DISPLAY_RADIUS_UNITS*1.1,
    fov:34,
    nearClip:0.1,
    farClip:100
  });
  app.root.addChild(cameraEntity);

  surfaceMaterial=new pc.StandardMaterial();
  surfaceMaterial.name="SeededPlanetSurface";
  surfaceMaterial.diffuse.set(1,1,1);
  surfaceMaterial.diffuseMap=await makeGeographyTexture();
  surfaceMaterial.gloss=0.16;
  surfaceMaterial.metalness=0;
  surfaceMaterial.specular.set(0.18,0.22,0.25);
  surfaceMaterial.emissive.set(0.002,0.004,0.007);
  surfaceMaterial.update();

  planet=new pc.Entity("FantasyPlanet");
  planet.addComponent("render",{type:"asset",castShadows:false,receiveShadows:true});
  setStartupProgress("mesh","Building planetary height mesh…",84);
  const mesh=await buildPlanetMesh();
  planet.render.meshInstances=[new pc.MeshInstance(mesh,surfaceMaterial,planet)];
  app.root.addChild(planet);
  buildAmbientMotion(mesh);
  buildWildernessPresentation();

  keyLight=new pc.Entity("PlanetKeyLight");
  keyLight.addComponent("light",{
    type:"directional",
    color:new pc.Color(1.0,0.97,0.90),
    intensity:1.42,
    castShadows:false
  });
  keyLight.setLocalEulerAngles(26,-42,0);
  app.root.addChild(keyLight);

  fillLight=new pc.Entity("PlanetFillLight");
  fillLight.addComponent("light",{
    type:"directional",
    color:new pc.Color(0.30,0.44,0.72),
    intensity:0.86,
    castShadows:false
  });
  fillLight.setLocalEulerAngles(-18,138,0);
  app.root.addChild(fillLight);

  applyRotation();
  setStartupProgress("scene","Finalizing first playable planet…",95);
  buildTimeMs=performance.now()-started;
}
async function start(){
  if(ready)return snapshot();
  try{
    root=document.getElementById("planetStageRoot");
    if(!root)throw new Error("Planet stage root is missing");
    beginResponsivenessTelemetry();
    presentStartupProgress();
    await yieldPaint();
    setStartupProgress("engine","Loading renderer…",15);
    await yieldPaint();
    document.body.classList.add("planet-stage-active");

    pc=await measuredPhase("engineImportMs",()=>import(ENGINE_URL));
    setStartupProgress("renderer","Initializing PlayCanvas…",32);
    await yieldPaint();
    canvas=document.createElement("canvas");
    canvas.id="planetCanvas";
    canvas.className="planet-stage-canvas";
    canvas.dataset.renderer="playcanvas";
    const loader=root.querySelector(".planet-stage-loading");
    root.replaceChildren(canvas);
    if(loader)root.appendChild(loader);

    device=await measuredPhase("graphicsDeviceMs",()=>pc.createGraphicsDevice(canvas,{
      deviceTypes:[pc.DEVICETYPE_WEBGL2],
      antialias:true,
      depth:true,
      powerPreference:"high-performance"
    }));
    const options=new pc.AppOptions();
    options.graphicsDevice=device;
    options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];
    options.resourceHandlers=[pc.TextureHandler];

    app=new pc.AppBase(canvas);
    await measuredPhase("appInitMs",async()=>app.init(options));
    controlledWorkActive=true;    await measuredPhase("buildSceneMs",()=>buildScene());
    controlledWorkActive=false;
    await yieldPaint();
    bindInput();
    resize();
    app.on?.("update",dt=>{frameCount++;recordLocalFrame(dt);updateAtmosphereTimeBinding();updateInspectionTooltip();updateAmbientMotion(dt);});
    await measuredPhase("appStartMs",async()=>app.start());
    await measuredPhase("localShaderWarmupMs",()=>warmLocalRepresentationShaders());
    initializeAtmosphereTimeBinding();

    if("ResizeObserver" in window){
      resizeObserver=new ResizeObserver(resize);
      resizeObserver.observe(root);
    }else window.addEventListener("resize",resize);

    ready=true;
    setStartupProgress("ready","First playable planet ready",100,"ready");
    startupProgress.gameplayReadyAtMs=Date.now();
    startupScheduler.backgroundPreparationCompleteAtMs=startupProgress.gameplayReadyAtMs;
    startupScheduler.optionalPostReadyWorkCount=0;    endResponsivenessTelemetry();
    await yieldPaint();
    root.dataset.ready="true";
    root.dataset.seed=activeSeed;
    renderDestinationNavigator();
    return snapshot();
  }catch(error){
    controlledWorkActive=false;
    endResponsivenessTelemetry();
    startupError=String(error?.stack||error);
    startupProgress={...startupProgress,mode:"failed",phaseId:"error",phaseLabel:"The planet could not finish preparing."};
    presentStartupProgress();
    if(root){
      root.dataset.ready="false";
      root.dataset.error=startupError;
      root.textContent="Planet renderer failed to start.";
    }
    console.error("Planet stage startup failed.",error);
    throw error;
  }
}
function entityTransformTelemetry(entity){
  if(!entity)return null;
  const p=entity.getPosition?.(),q=entity.getRotation?.(),e=entity.getEulerAngles?.();
  return Object.freeze({position:Object.freeze([Number((p?.x||0).toFixed(6)),Number((p?.y||0).toFixed(6)),Number((p?.z||0).toFixed(6))]),rotationQuaternion:Object.freeze([Number((q?.x||0).toFixed(9)),Number((q?.y||0).toFixed(9)),Number((q?.z||0).toFixed(9)),Number((q?.w??1).toFixed(9))]),eulerDegrees:Object.freeze([Number((e?.x||0).toFixed(6)),Number((e?.y||0).toFixed(6)),Number((e?.z||0).toFixed(6))])});
}
function canonicalScreenFocusTelemetry(){
  const rect=canvas?.getBoundingClientRect?.(),centerX=(rect?.width||0)*.5,centerY=(rect?.height||0)*.5;
  const direction=window.PlanetGeography?.directionFromLatLon?.(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  let screen=null,facingDot=null;
  if(direction&&planet&&cameraEntity?.camera&&pc){
    const local=new pc.Vec3(direction.x*DISPLAY_RADIUS_UNITS,direction.y*DISPLAY_RADIUS_UNITS,direction.z*DISPLAY_RADIUS_UNITS);
    const world=planet.getWorldTransform().transformPoint(local,new pc.Vec3());
    const center=planet.getPosition(),normal=world.clone().sub(center),toCamera=cameraEntity.getPosition().clone().sub(world);
    facingDot=normal.dot(toCamera);
    screen=cameraEntity.camera.worldToScreen(world);
  }
  const x=Number(screen?.x),y=Number(screen?.y),valid=Number.isFinite(x)&&Number.isFinite(y);
  return Object.freeze({valid,screenX:valid?Number(x.toFixed(3)):null,screenY:valid?Number(y.toFixed(3)):null,centerX:Number(centerX.toFixed(3)),centerY:Number(centerY.toFixed(3)),deltaPixels:valid?Number(Math.hypot(x-centerX,y-centerY).toFixed(3)):null,facingDot:facingDot===null?null:Number(facingDot.toFixed(6)),source:"canonical-sphere-transform"});
}
function spatialLodDiagnostics(){
  const requestedIndex=requestedLodIndexForZoom(zoomState.scalar);
  const requestedCell=canonicalSpatialCellFor(requestedIndex,zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  const visibleIndex=displayResource?.levelIndex??null,visibleCell=displayResource?.spatialCell||null;
  const bounds=visibleCell?.worldBounds||null;
  const registered=canonicalRegisteredMetersForLatLon(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  const visibleContainsFocus=Boolean(bounds&&registered.eastMeters>=bounds.minEastMeters&&registered.eastMeters<=bounds.maxEastMeters&&registered.northMeters>=bounds.minNorthMeters&&registered.northMeters<=bounds.maxNorthMeters);
  const parentFallbackActive=Boolean(localResources.standInActive&&visibleCell&&visibleIndex!==null&&visibleIndex<requestedIndex&&visibleContainsFocus);
  const overscanCells=[];
  for(let dy=-SPATIAL_OVERSCAN_CELL_RADIUS;dy<=SPATIAL_OVERSCAN_CELL_RADIUS;dy++)for(let dx=-SPATIAL_OVERSCAN_CELL_RADIUS;dx<=SPATIAL_OVERSCAN_CELL_RADIUS;dx++){
    const size=requestedCell.cellSizeMeters,x=requestedCell.cellX+dx,y=requestedCell.cellY+dy;
    overscanCells.push(["SLOD",coordinateFabricAuthority()?.revisionSignature||"legacy-coordinate",requestedCell.depth,x,y].join("|"));
  }
  const requestedDims=patchDimensionsForLevel(requestedIndex);
  const requestedOffset=localFocusOffsetMeters({lat0:requestedCell.centerLatitudeRadians,lon0:requestedCell.centerLongitudeRadians,dims:requestedDims});
  const marginEast=Math.max(0,(requestedDims.patchWidth-requestedDims.visibleWidth)*.5),marginNorth=Math.max(0,(requestedDims.patchHeight-requestedDims.visibleHeight)*.5);
  const canonicalAnchorCoveragePass=Math.abs(requestedOffset.east)<=marginEast+.01&&Math.abs(requestedOffset.north)<=marginNorth+.01;
  return {
    selectionMode:"screen-space-error",canonicalHierarchy:"SEED-coordinate-quadtree",
    targetPixelError:SSE_TARGET_PIXELS,refinePixelError:SSE_REFINE_PIXELS,coarsenPixelError:SSE_COARSEN_PIXELS,
    metersPerScreenPixel:Number(metersPerScreenPixelForZoom().toFixed(6)),
    requestedLevelIndex:requestedIndex,requestedLevel:LOCAL_DETAIL_LEVELS[requestedIndex]?.id||null,
    requestedWorldSpaceErrorMeters:Number(worldSpaceErrorForLevel(requestedIndex).toFixed(6)),
    requestedProjectedPixelError:Number(projectedPixelErrorForLevel(requestedIndex).toFixed(6)),
    requestedNativeMagnification:Number(nativeMagnificationForLevel(requestedIndex).toFixed(6)),
    maxNativeMagnification:SSE_MAX_NATIVE_MAGNIFICATION,
    visibleLevelIndex:visibleIndex,visibleLevel:visibleIndex===null?null:LOCAL_DETAIL_LEVELS[visibleIndex]?.id||null,
    visibleWorldSpaceErrorMeters:visibleIndex===null?null:Number(worldSpaceErrorForLevel(visibleIndex).toFixed(6)),
    visibleProjectedPixelError:visibleIndex===null?null:Number(projectedPixelErrorForLevel(visibleIndex).toFixed(6)),
    visibleNativeMagnification:visibleIndex===null?null:Number(nativeMagnificationForLevel(visibleIndex).toFixed(6)),
    requestedCell,visibleCell,parentFallbackActive,readyChildHandoff:Boolean(!localResources.standInActive&&visibleCell?.id===requestedCell.id),
    requestedAnchorOffsetMeters:Object.freeze({east:Number(requestedOffset.east.toFixed(3)),north:Number(requestedOffset.north.toFixed(3))}),
    requestedPatchMarginMeters:Object.freeze({east:Number(marginEast.toFixed(3)),north:Number(marginNorth.toFixed(3))}),
    canonicalAnchorCoveragePass,
    visibleContainsFocus,overscanCellIds:Object.freeze(overscanCells),overscanCellCount:overscanCells.length,
    temporalResidency:localResidencyDiagnostics(),
    semanticHiddenReasons:Object.freeze({
      hemisphere:Number(mapPresentation.hiddenHemisphereCulledCount||0),behindCamera:Number(mapPresentation.behindCameraCulledCount||0),
      offscreen:Number(mapPresentation.offscreenCulledCount||0),occluded:Number(mapPresentation.occludedCulledCount||0),overlap:Number(mapPresentation.overlapRejectedCount||0)
    }),
    rootCellMeters:SPATIAL_LOD_ROOT_CELL_METERS,maxDepth:SPATIAL_LOD_MAX_DEPTH,cellMaxLevelHeightRatio:SPATIAL_CELL_MAX_LEVEL_HEIGHT_RATIO,
    hysteresis:true,viewportBounded:true,fullWorldScan:false,cameraAssignsIdentity:false,viewportAssignsIdentity:false
  };
}
function snapshot(){
  return Object.freeze({
    version:VERSION,
    geographyVersion:String(window.PlanetGeography?.VERSION||""),
    stage:"seeded-planetary-geography",
    ready,
    engine:"PlayCanvas",
    engineVersion:ENGINE_VERSION,
    canvasCount:root?.querySelectorAll?.("canvas")?.length||0,
    activeSeed,
    geographyHash:geographySignature?.hash||null,
    geographySignature,
    geographyVerification,
    geographyLayout:geography?.layout||null,
    geographyStats,
    coordinateFabric:coordinateFabricDiagnostics(),
    featureTargets,
    worldScaleFraction:WORLD_SCALE_FRACTION,
    earthReferenceRadiusMeters:EARTH_REFERENCE_RADIUS_METERS,
    worldRadiusMeters:WORLD_RADIUS_METERS,
    worldDiameterMeters:WORLD_DIAMETER_METERS,
    worldCircumferenceMeters:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3)),
    displayRadiusUnits:DISPLAY_RADIUS_UNITS,
    heightExaggeration:HEIGHT_EXAGGERATION,
    oceanVisualDepthFactor:OCEAN_VISUAL_DEPTH_FACTOR,
    texture:Object.freeze({width:TEXTURE_WIDTH,height:TEXTURE_HEIGHT}),
    mesh:Object.freeze({
      latitudeSegments:LATITUDE_SEGMENTS,
      longitudeSegments:LONGITUDE_SEGMENTS,
      vertexCount:meshVertexCount,
      triangleCount:meshTriangleCount
    }),
    buildTimeMs:Number(buildTimeMs.toFixed(3)),
    rotation:Object.freeze({
      yawDegrees:Number(yawDegrees.toFixed(3)),
      pitchDegrees:Number(pitchDegrees.toFixed(3))
    }),
    input:Object.freeze({
      dragging,pointerDragCount,rotationChangeCount,
      mouseDrag:true,touchDrag:true,keyboardRotation:true,wheelZoom:true,pinchZoom:true,keyboardZoom:true,
      wheelSensitivity:ZOOM_WHEEL_SENSITIVITY,pinchSensitivity:ZOOM_PINCH_SENSITIVITY,zoomInputRateFraction:.5,
      dragSensitivity:navigationSensitivity(),scaleAwareDrag:true,scaleAwareKeyboard:true,zoomStepsOnly:true
    }),
    canonicalFocus:Object.freeze({
      latitudeDegrees:Number((zoomState.focusLatitudeRadians*180/Math.PI).toFixed(6)),
      longitudeDegrees:Number((zoomState.focusLongitudeRadians*180/Math.PI).toFixed(6)),
      sphericalVector:tangentFrame(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians).up,
      worldTile:mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians),
      tangentOriginMeters:projectionState.tangentOrigin,
      activeLodOriginMeters:projectionState.tangentOrigin,
      screenSpaceTargetPercent:Object.freeze([50,50]),
      screenSpaceFocus:canonicalScreenFocusTelemetry(),
      screenSpaceFocusDeltaPixels:canonicalScreenFocusTelemetry().deltaPixels,
      authority:"rotation-derived-canonical-latlon",
      zoomMayRelocateFocus:false,
      surfaceIdentity:canonicalSurfaceIdentity()
    }),
    zoom:Object.freeze({
      scalar:Number(zoomState.scalar.toFixed(6)),band:zoomState.band,requestedBand:zoomState.requestedBand||zoomState.band,visibleBand:zoomState.band,
      scaleIndex:scaleStateForScalar().index,scaleLabel:scaleStateForScalar().label,scaleLadder:SCALE_LADDER.slice(),
      requestedLevel:localResources.requestedLevel,visibleLevel:localResources.visibleLevel,
      focusLatitudeDegrees:Number((zoomState.focusLatitudeRadians*180/Math.PI).toFixed(6)),
      focusLongitudeDegrees:Number((zoomState.focusLongitudeRadians*180/Math.PI).toFixed(6)),
      cameraDistance:Number(zoomState.cameraDistance.toFixed(6)),
      baseCameraDistance:Number(zoomState.baseCameraDistance.toFixed(6)),
      visibleFootprintWidthMeters:Number(zoomState.visibleFootprintWidthMeters.toFixed(3)),
      visibleFootprintHeightMeters:Number(zoomState.visibleFootprintHeightMeters.toFixed(3)),
      wheelEvents:zoomState.wheelEvents,pinchEvents:zoomState.pinchEvents,zoomChanges:zoomState.zoomChanges,
      bands:ZOOM_BANDS.map(b=>b.id),detailLevels:LOCAL_DETAIL_LEVELS.map(level=>level.id),sameSphericalAuthority:true,
      dragSensitivity:navigationSensitivity(),
      pose:Object.freeze({sphere:entityTransformTelemetry(planet),camera:entityTransformTelemetry(cameraEntity),cameraLookVector:Object.freeze([0,0,-1]),cameraTarget:Object.freeze([0,0,0]),screenFocus:canonicalScreenFocusTelemetry(),cameraPoseInvariant:true,zoomTransform:"orthographic-magnification-only"}),
      ladder:Object.freeze({labels:SCALE_LADDER.slice(),startScalar:LADDER_START_SCALAR,startHeightMeters:Number(ladderState().startHeight.toFixed(1)),groundHeightMeters:GROUND_FOOTPRINT_HEIGHT_METERS,levelMaxScalars:ladderState().levelMax.slice(),logUniformBelowStart:true})
    }),
    projection:Object.freeze({
      mode:projectionState.mode,
      blend:Number(projectionState.blend.toFixed(6)),
      transitionStart:projectionState.transitionStart,
      transitionEnd:projectionState.transitionEnd,
      tangentOrigin:projectionState.tangentOrigin,
      basis:projectionState.basis,
      cameraTarget:projectionState.cameraTarget,
      continuityErrorMeters:projectionState.continuityErrorMeters,
      derivedFromSphericalAuthority:true,
      localWorldAuthority:false,
      worldTileProjection:Object.freeze({...planetWorldAnchor(),roundTripOrigin:mapWorldTileAt(worldLatLonForTile("0","0").latitudeRadians,worldLatLonForTile("0","0").longitudeRadians),tileMeters:Number(window.WorldStandards?.TILE_METERS||2),registrationRoundTrip:geography?.registrationRoundTrip?.("0","0",Number(window.WorldStandards?.TILE_METERS||2),WORLD_RADIUS_METERS)||null,authority:"PlanetGeography.seed-fixed-spherical-frame"}),
      tangentPatchActive:Boolean(tangentPatch?.enabled),
      tangentPatchDerivedFromFocus:true,
      tangentPatchSpanMeters:Math.max(localDetail.patchWidthMeters,localDetail.patchHeightMeters),
      localDetail:Object.freeze({...localDetail,viewportBounded:true,fullWorldMaterialized:false}),
      spatialLod:Object.freeze(spatialLodDiagnostics()),
      localStatic:Object.freeze({...localStatic,focusLatitudeDegrees:Number((zoomState.focusLatitudeRadians*180/Math.PI).toFixed(6)),focusLongitudeDegrees:Number((zoomState.focusLongitudeRadians*180/Math.PI).toFixed(6)),visibleFootprintWidthMeters:Number(zoomState.visibleFootprintWidthMeters.toFixed(3)),visibleFootprintHeightMeters:Number(zoomState.visibleFootprintHeightMeters.toFixed(3))}),
      resourceBudget:Object.freeze({...localResources,cacheLimit:LOCAL_RESOURCE_CACHE_LIMIT,lodHysteresis:LOCAL_LOD_HYSTERESIS,offscreenFineDetailActive:false,viewportPriority:true}),
      presentation:Object.freeze({...projectionPresentation})
    }),
    activeSystems:Object.freeze({
      protagonistEnabled:false,
      npcEnabled:Boolean(localNpcPresentation.activeCount>0),
      tileSystemActive:false,
      localTerrainActive:Boolean(tangentPatch?.enabled),
      settlementGenerationActive:false,
      buildingGenerationActive:Boolean(localStatic.active&&localStatic.buildingCount>0),
      worldDetailSimulationActive:false
    }),
    generation:Object.freeze({
      generatedOnce:true,
      perFrameGeneration:false,
      sphericalAuthority:true,
      planarTileAuthority:false,
      physicalElevationMeters:true
    }),
    frameCount,
    ambientMotion:Object.freeze({...ambientMotion,lastUpdateMs:Number(ambientMotion.lastUpdateMs.toFixed(4)),maxUpdateMs:Number(ambientMotion.maxUpdateMs.toFixed(4)),presentationOnly:true,simulationAuthority:false}),
    atmosphere:Object.freeze({...atmosphere}),
    atmosphereTimeBinding:Object.freeze({...atmosphereTimeBinding}),
    wilderness:Object.freeze({...wilderness}),
    wildlifeReaction:Object.freeze({...wildlifeReaction,actors:Object.freeze(localFaunaActors.map(localFaunaActorSnapshot)),memoryEntryCount:localFaunaReactionMemory.size,
      speciesRules:Object.freeze(Object.fromEntries(Object.entries(LOCAL_FAUNA_SPECS).map(([kind,spec])=>[kind,Object.freeze({...spec})])))}),
    environmentalReactions:Object.freeze({...environmentalReactions,activeSlots:Object.freeze(environmentalReactionPool.filter(slot=>slot.active).map(slot=>Object.freeze({kind:slot.kind,index:slot.index,ageMs:Number((performance.now()-slot.startedAtMs).toFixed(1)),lifetimeMs:slot.lifetimeMs,latitudeDegrees:Number((slot.latitudeRadians*180/Math.PI).toFixed(6)),longitudeDegrees:Number((slot.longitudeRadians*180/Math.PI).toFixed(6))})))}),
    inspection:Object.freeze({...inspection,activePickableCount:inspectionPickables.size,activeNpcCount:Array.from(inspectionPickables.values()).filter(x=>x.type==="npc").length,activeBuildingCount:Array.from(inspectionPickables.values()).filter(x=>x.type==="building").length,selectedAuthority:inspection.selectedId===null?null:(inspectionPickables.get(inspectionRegistryKey(inspection.selectedType,inspection.selectedId))?.authority||null),boundedActiveRegistry:true,fullWorldScan:false,selectedStateRefreshIntervalMs:250}),
    npcPresentation:Object.freeze({...localNpcPresentation}),
    buildingActivity:Object.freeze({...buildingActivity,buildings:Object.freeze((buildingActivity.buildings||[]).slice())}),
    destinationNavigator:Object.freeze({open:destinationNavigator.open,category:destinationNavigator.category,resultCount:destinationNavigator.descriptors.filter(d=>destinationNavigator.category==="all"||d.category===destinationNavigator.category).length,totalDescriptorCount:destinationNavigator.descriptors.length,categories:Array.from(new Set(destinationNavigator.descriptors.map(d=>d.category))),types:Array.from(new Set(destinationNavigator.descriptors.map(d=>d.type))),selectedId:destinationNavigator.selectedId,queryCount:destinationNavigator.queryCount,lastQueryMs:destinationNavigator.lastQueryMs,navigationCount:destinationNavigator.navigationCount,lastTarget:destinationNavigator.lastTarget,queryCenter:Object.freeze({latitudeDegrees:Number((-pitchDegrees).toFixed(3)),longitudeDegrees:Number((-yawDegrees).toFixed(3))}),boundedQuery:true,descriptorLimit:16,fullWorldScan:false,cameraOnly:true,localChunkMaterialization:false}),
    mapPresentation:Object.freeze({...mapPresentation}),
    politicalScale:politicalScaleEvidence(),
    startupError,
    startupProgress:Object.freeze({...startupProgress,loadingProofActive:Boolean(loadingProof)}),
    loadingPresentation:Object.freeze({...((loadingProof||startupProgress)),loadingProofActive:Boolean(loadingProof)}),
    startupScheduler:Object.freeze({...startupScheduler,progressMonotonic:true,sharedCooperativeScheduler:true,criticalPathOnly:true})
  });
}
function inspectionTargets(){
  return Object.freeze(Array.from(inspectionPickables.values()).map(record=>{
    let bounds=null;try{bounds=record.screenBounds?.()||null;}catch{bounds=null;}
    if(!bounds||![bounds.left,bounds.right,bounds.top,bounds.bottom].every(Number.isFinite))return null;
    return Object.freeze({id:String(record.id),type:record.type,bounds:Object.freeze({...bounds}),authority:record.authority||null});
  }).filter(Boolean));
}
function verify(){
  const stage=snapshot();
  const check=geographyVerification||(window.PlanetGeography?.verifyDeterminism?.(activeSeed)||null);
  geographyVerification=check;
  return Object.freeze({
    pass:Boolean(
      stage.ready&&
      check?.pass===true&&
      stage.geographyHash&&
      stage.geographyStats?.landSamples>0&&
      stage.geographyStats?.oceanSamples>0&&
      stage.geographyStats?.islandSamples>0&&
      stage.geographyStats?.mountainSamples>0&&
      stage.geographyStats?.maxElevationMeters>3000&&
      stage.activeSystems?.tileSystemActive===false&&
      stage.generation?.perFrameGeneration===false
    ),
    stage,check
  });
}
function destroy(){
  resizeObserver?.disconnect?.();resizeObserver=null;
  if(!("ResizeObserver" in window))window.removeEventListener("resize",resize);
  generatedTexture?.destroy?.();generatedTexture=null;
  for(const resource of localResourceCache.values())destroyCachedLocalResource(resource);localResourceCache.clear();localPreparationToken++;localJob=null;localQueuedRequest=null;displayResource=null;localResources=freshLocalResources();
  clearLocalFauna();
  app?.destroy?.();
  app=null;device=null;pc=null;planet=null;cameraEntity=null;canvas=null;localStaticRoot=null;localStaticMaterials=null;localFaunaRoot=null;localFaunaActors=[];localFaunaClock=0;localFaunaReactionAccumulator=0;localFaunaReactionMemory.clear();wildlifeReaction=freshWildlifeReaction();localWildernessEnabled=true;
  environmentalReactionRoot=null;environmentalReactionMaterials=null;environmentalReactionTextures=null;environmentalReactionPool=[];
  environmentalReactions={enabled:true,poolInitialized:false,poolGroupCount:0,poolDrawableCount:0,activeCount:0,visibleCount:0,activeDrawCallEstimate:0,peakActiveCount:0,triggerCount:0,expiredCount:0,reuseCount:0,triggerByKind:{dust:0,grassBend:0,footprint:0},lastKind:null,lastSurfaceType:null,lastMovementMeters:0,lastTriggerAtMs:0,lastUpdateMs:0,maxUpdateMs:0,minMoveMeters:ENVIRONMENT_REACTION_MIN_MOVE_METERS,maxMoveMeters:ENVIRONMENT_REACTION_MAX_MOVE_METERS,triggerIntervalMs:ENVIRONMENT_REACTION_TRIGGER_INTERVAL_MS,desktopActiveCap:6,phoneActiveCap:4,source:"canonical ground-scale navigation + TerrainFoundation",poolAllocationsAfterInit:0,terrainMutation:false,presentationOnly:true,simulationAuthority:false,bounded:true,fullWorldScan:false,perFrameWorldScan:false};
  clearLocalBuildingActivity();localBuildingActivityRoot=null;localBuildingActivityContext=null;
  buildingActivity={...buildingActivity,active:false,buildingCount:0,activeBuildingCount:0,occupiedBuildingCount:0,activeWorkplaceCount:0,activeHomeCount:0,warmWindowCount:0,smokeCueCount:0,openMarketCount:0,forgeGlowCount:0,workPropCount:0,cueCount:0,drawCallEstimate:0,buildings:[],lastSignature:null};
  localNpcRoot=null;localNpcMaterials=null;localNpcContext=null;ready=false;
  inspectionPickables.clear();localBuildingInspectionKeys.clear();localNpcInspectionKeys.clear();
  inspection={selectedId:null,selectedType:null,pointerDownX:0,pointerDownY:0,dragDistance:0,pickQueries:0,lastPickCandidateCount:0,lastPickQueryMs:0,tooltipUpdates:0,lastTooltipUpdateMs:0,contentRefreshes:0,lastContentRefreshAtMs:0,dismissCount:0};
  atmospherePalette=null;atmosphereTimeBinding={available:false,active:false,readOnly:true,directRealClockRead:false,campaignMutation:false,source:"unavailable",campaignSeed:null,lastTimestampKey:null,lastPollAtMs:0,lastAppliedAtMs:0,pollIntervalMs:1000,error:null};
  geography=null;coordinateFabric=null;politicalScaleEvidenceCache=null;worldProjectionAnchorCache=null;settlementRevealCache={key:null,value:null};atlasLabelCache={key:null,candidates:[],queryCellCount:0,buildMs:0};atlasStickyBand=null;atlasStickyEntities.clear();atlasLabelPlacementCache.clear();atlasEntityCache.clear();atlasIdentityCache.clear();semanticScaleState={index:0,initialized:false,changes:0,holds:0,lastRawIndex:0};localResidency.clear();localRecentEvictions.clear();localMotionPrefetchTargets.clear();localLastRequestRegistered=null;localMotionVector={east:0,north:0,magnitude:0};localStaticRefreshScheduled=false;projectionPresentation={viewBlend:0,angleBlend:0,presentationCompensation:1,patchScale:0,cameraY:0,cameraZ:0,fov:34,targetHeightMeters:650000};root?.replaceChildren?.();
}
window.PlanetStage=Object.freeze({
  VERSION,start,snapshot,verify,setRotation,rotateBy,rotateByScreenPixels,rotateByScreenFraction,setViewTarget,setWorldTileFocus,worldLatLonForTile,coordinateDiagnostics:coordinateFabricDiagnostics,rotationForLatLon,setZoomScalar,setScaleIndex,stepScale,zoomBy,scalarForFootprintHeight:(heightMeters)=>Number(scalarForFootprintHeight(heightMeters).toFixed(6)),setLoadingProof,clearLoadingProof,applyAuthoritativeFantasyTime,inspectionTargets,clearEnvironmentalReactions,setEnvironmentalReactionEnabled:(enabled)=>{environmentalReactions={...environmentalReactions,enabled:Boolean(enabled)};if(!enabled)clearEnvironmentalReactions();return snapshot();},setWildernessEnabled:(enabled)=>{localWildernessEnabled=Boolean(enabled);wilderness={...wilderness,localEnabled:localWildernessEnabled};if(displayResource)rebuildLocalStaticPresentation(displayResource);if(atmospherePalette)applyAtmosphereMaterialPalette(atmospherePalette);return snapshot();},openPlaces:()=>{destinationNavigator.open=true;renderDestinationNavigator();return snapshot();},closePlaces:()=>{destinationNavigator.open=false;renderDestinationNavigator();return snapshot();},registerInspectionPickable,unregisterInspectionPickable,dismissInspection,pickInspection,
  setPlacesCategory:(category)=>{destinationNavigator.category=["all","settlements","cities","historical","hunting","fishing","landmark","nature","water"].includes(category)?category:"all";renderDestinationNavigator();return snapshot();},selectPlace:(id)=>{const d=destinationNavigator.descriptors.find(x=>x.id===id);if(d){destinationNavigator.selectedId=d.id;destinationNavigator.navigationCount++;destinationNavigator.lastTarget={id:d.id,name:d.name,latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees};setViewTarget(d);renderDestinationNavigator();}return snapshot();},destroy,
  constants:Object.freeze({
    EARTH_REFERENCE_RADIUS_METERS,WORLD_SCALE_FRACTION,WORLD_RADIUS_METERS,WORLD_DIAMETER_METERS,
    WORLD_CIRCUMFERENCE_METERS:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3)),
    TEXTURE_WIDTH,TEXTURE_HEIGHT,LATITUDE_SEGMENTS,LONGITUDE_SEGMENTS,HEIGHT_EXAGGERATION,ZOOM_MIN,ZOOM_MAX,ZOOM_BANDS,SCALE_LADDER,SCALE_DENOMINATORS,SCALE_FOOTPRINT_PROGRESS_EXPONENT,SEMANTIC_SCALE_HYSTERESIS_RATIO,SEMANTIC_LAYER_SPECS,LOCAL_DETAIL_LEVELS,LADDER_START_SCALAR,GROUND_FOOTPRINT_HEIGHT_METERS,ZOOM_WHEEL_SENSITIVITY,ZOOM_PINCH_SENSITIVITY,LOCAL_RESOURCE_CACHE_LIMIT,LOCAL_GRACE_RESIDENCY_MS,LOCAL_LOD_HYSTERESIS,SPATIAL_LOD_ROOT_CELL_METERS,SPATIAL_CELL_MAX_LEVEL_HEIGHT_RATIO,SSE_TARGET_PIXELS,SSE_REFINE_PIXELS,SSE_COARSEN_PIXELS,LOCAL_SURROUND_SPAN_FACTOR,SSE_MAX_NATIVE_MAGNIFICATION
  })
});
const boot=()=>start().catch(()=>{});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();