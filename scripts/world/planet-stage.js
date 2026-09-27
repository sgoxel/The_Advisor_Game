(function(){
"use strict";

const VERSION="planet-ground-static-v14";
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
let localStatic={active:false,signature:null,level:"inactive",revealTier:"none",settlementId:null,settlementName:null,settlementClass:null,settlementRole:null,settlementPlanRevision:null,layoutSignature:null,canonicalCenterTile:null,presentationScale:1,occupiedAreaCount:0,coarseRoadCount:0,coarseBuildingCount:0,landmarkCount:0,fullRoadCount:0,fullBuildingCount:0,roadCount:0,buildingCount:0,vegetationCount:0,waterCount:0,entityCount:0,triangleEstimate:0,drawCallEstimate:0,buildTimeMs:0,grounded:true,viewportBounded:true,presentationOnly:true,simulationAuthority:false,authority:"spherical-seed-focus-presentation"};
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
let wilderness={generated:false,cellCount:0,acceptedStaticProps:0,vegetationClusters:0,rockClusters:0,ambientFaunaZones:0,rejectedWater:0,drawCalls:0,triangles:0,preparationMs:0,cacheReuse:false,perFrameScatter:false,simulationAuthority:false};
let zoomState={scalar:0,band:"planet",focusLatitudeRadians:pitchDegrees*Math.PI/180,focusLongitudeRadians:-yawDegrees*Math.PI/180,baseCameraDistance:0,cameraDistance:0,visibleFootprintWidthMeters:WORLD_DIAMETER_METERS,visibleFootprintHeightMeters:WORLD_DIAMETER_METERS,wheelEvents:0,pinchEvents:0,zoomChanges:0};
const activePointers=new Map();
let lastPinchDistance=null;
let projectionState={mode:"globe",blend:0,transitionStart:.45,transitionEnd:.82,tangentOrigin:null,basis:null,cameraTarget:null,continuityErrorMeters:0};
const LOCAL_SAMPLE_SPACING_METERS=2;
const LOCAL_PATCH_MARGIN=1.50;
const LOCAL_RESOURCE_CACHE_LIMIT=5;
const LOCAL_LOD_HYSTERESIS=0.006;
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
function freshLocalResources(){
  return {activeSignature:null,requestedSignature:null,preparedSignature:null,preparingSignature:null,requestedLevel:null,visibleLevel:null,preparingLevel:null,preparing:false,preparingPrewarm:false,preparationProgress:0,standInActive:false,standInMagnification:1,
    cacheHits:0,cacheMisses:0,prewarmHits:0,prewarmCompleted:0,cancelledPreparations:0,deferredRequests:0,evictions:0,destroyedMeshes:0,destroyedTextures:0,activeResourceCount:0,cachedResourceCount:0,estimatedCacheBytes:0,culledOuterRepresentations:0,pendingPreparationCount:0,
    lastBuildMs:0,lastPreparationWallMs:0,lastPreparationBusyMs:0,lastPreparationSlices:0,maxPreparationSliceMs:0,lastSwapMs:0,maxSwapMs:0,swapCount:0,lastPreparationQueuedAtMs:0,lastPreparationCompletedAtMs:0,lastEvictionReason:null,
    blockingZoomBuilds:0,maxFrameMsDuringPreparation:0,recentMaxFrameMs:0,lastFrameMs:0,sliceBudgetMs:LOCAL_PREP_SLICE_BUDGET_MS,cooperativePreparation:true,doubleBufferedSwap:true,
    surroundSpanFactor:3,surroundWidthMeters:0,surroundHeightMeters:0,surroundWorldMatched:false};
}
let localResources=freshLocalResources();
let localPreparationToken=0;
let mapPresentation={active:false,context:null,visibleContextKinds:[],visiblePlaceKinds:[],labelCount:0,atlasVisibleLabelCount:0,atlasCandidateCount:0,atlasQueryCellCount:0,hiddenHemisphereCulledCount:0,behindCameraCulledCount:0,offscreenCulledCount:0,occludedCulledCount:0,overlapRejectedCount:0,visibleLabelClasses:[],visibleLabels:[],maxLabelBudget:0,labelQueryBuildMs:0,landmarkCandidateCount:0,landmarkVisibleCount:0,landmarkKinds:[],visibleLandmarks:[],maxLandmarkCount:0,borderVisible:false,borderSampleCount:0,borderLandSampleCount:0,borderWaterSampleCount:0,borderOwnerQueryCount:0,borderSegmentCount:0,borderWorldVertexCount:0,projectedBorderSegmentCount:0,politicalOwnerCount:0,projectionMode:"globe",scaleDistanceMeters:0,scaleLabel:"",zoomScaleMultiplier:.01,zoomScaleLabel:"0.01x",updateCount:0,lastUpdateMs:0,lastBorderBuildMs:0,bounded:true,fullWorldScan:false};
let atlasLabelCache={key:null,candidates:[],queryCellCount:0,buildMs:0};
const atlasEntityCache=new Map();
const atlasIdentityCache=new Map();
const atlasAuthorityIndex=new Map();
const atlasAuthorityQueue=[];
const atlasAuthorityQueued=new Set();
let atlasAuthorityWorkerScheduled=false;
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
function atlasDrainAuthorityQueue(deadline){
  atlasAuthorityWorkerScheduled=false;
  const started=performance.now();
  while(atlasAuthorityQueue.length&&((deadline?.timeRemaining?.()||0)>1||performance.now()-started<3)){
    const job=atlasAuthorityQueue.shift();atlasAuthorityQueued.delete(job.key);
    let value=null;
    try{
      if(job.kind==="country"){
        const c=window.PoliticalGeography?.countryAt?.(activeSeed,job.tile.x,job.tile.y)||null;
        if(c){
          const anchor={x:String(c.politicalCenter?.x??job.tile.x),y:String(c.politicalCenter?.y??job.tile.y)};
          value=atlasEntityBase(c.id,"country",c.name,anchor,"PoliticalGeography.countryAt:indexed",{countryId:c.id,capital:c.capital||null});
        }
      }else{
        const r=window.RegionProfile?.at?.(activeSeed,job.tile.x,job.tile.y)||null;
        if(r){
          const anchor={x:String(r.administrativeSeat?.x??job.tile.x),y:String(r.administrativeSeat?.y??job.tile.y)};
          value=atlasEntityBase(r.id,"region",r.name,anchor,"RegionProfile.at:indexed",{countryId:r.parentCountryId});
        }
      }
    }catch(_){}
    atlasAuthorityIndex.set(job.key,value);
  }
  if(atlasAuthorityQueue.length&&!atlasAuthorityWorkerScheduled){
    atlasAuthorityWorkerScheduled=true;
    const schedule=window.requestIdleCallback||((cb)=>setTimeout(()=>cb({timeRemaining:()=>4,didTimeout:false}),0));
    schedule(atlasDrainAuthorityQueue,{timeout:120});
  }
}
let mapContextCache={key:null,value:null};
let mapBorderCache={key:null,segments:[],sampleCount:0,landSampleCount:0,waterSampleCount:0,ownerQueryCount:0,ownerCount:0,worldVertexCount:0,builtAtMs:0};
let projectionPresentation={viewBlend:0,angleBlend:0,presentationCompensation:1,patchScale:0,cameraY:0,cameraZ:0,fov:34,targetHeightMeters:650000};
let worldProjectionAnchorCache=null;
let settlementRevealCache={key:null,value:null};
let localStaticRefreshScheduled=false;
let politicalScaleEvidenceCache=null;

function wrapLongitudeRadians(value){
  let lon=Number(value)||0;lon=((lon+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;return lon;
}
function planetWorldAnchor(){
  if(worldProjectionAnchorCache)return worldProjectionAnchorCache;
  let best=null;
  if(geography){
    for(let latDeg=-48;latDeg<=48;latDeg+=8){
      const lat=latDeg*Math.PI/180;
      for(let lonDeg=-176;lonDeg<180;lonDeg+=8){
        const lon=lonDeg*Math.PI/180;
        const sample=geography.sampleLatLon(lat,lon);
        if(!sample?.land)continue;
        const elevation=Number(sample.elevationMeters||0);
        const score=Number(sample.continentInfluence||0)*3.2+Number(sample.moisture||0)*.28-
          Math.abs(elevation-650)/6500-Number(sample.islandInfluence||0)*.42-Math.abs(latDeg)/420;
        if(!best||score>best.score)best={score,lat,lon,sample};
      }
    }
  }
  if(!best){
    const sample=geography?.sampleLatLon?.(0,0)||null;
    best={score:0,lat:0,lon:0,sample};
  }
  worldProjectionAnchorCache=Object.freeze({
    latitudeRadians:best.lat,longitudeRadians:best.lon,
    latitudeDegrees:Number((best.lat*180/Math.PI).toFixed(6)),
    longitudeDegrees:Number((best.lon*180/Math.PI).toFixed(6)),
    land:Boolean(best.sample?.land),surfaceClass:String(best.sample?.surfaceClass||"unknown"),
    elevationMeters:Number(best.sample?.elevationMeters||0),
    authority:"PlanetGeography deterministic land anchor",
    worldTileOrigin:Object.freeze({x:"0",y:"0"})
  });
  return worldProjectionAnchorCache;
}
function mapWorldTileAt(latitudeRadians,longitudeRadians){
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const anchor=planetWorldAnchor(),cosAnchor=Math.max(.08,Math.cos(anchor.latitudeRadians));
  const eastMeters=wrapLongitudeRadians(Number(longitudeRadians)-anchor.longitudeRadians)*WORLD_RADIUS_METERS*cosAnchor;
  const northMeters=(clamp(latitudeRadians,-Math.PI*.499999,Math.PI*.499999)-anchor.latitudeRadians)*WORLD_RADIUS_METERS;
  return Object.freeze({
    x:String(Math.round(eastMeters/tileMeters)),
    y:String(Math.round(northMeters/tileMeters))
  });
}
function worldLatLonForTile(xValue,yValue){
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const anchor=planetWorldAnchor(),cosAnchor=Math.max(.08,Math.cos(anchor.latitudeRadians));
  const x=Number(BigInt(String(xValue??"0"))),y=Number(BigInt(String(yValue??"0")));
  const lat=clamp(anchor.latitudeRadians+y*tileMeters/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
  const lon=wrapLongitudeRadians(anchor.longitudeRadians+x*tileMeters/(WORLD_RADIUS_METERS*cosAnchor));
  return Object.freeze({latitudeRadians:lat,longitudeRadians:lon,latitudeDegrees:Number((lat*180/Math.PI).toFixed(6)),longitudeDegrees:Number((lon*180/Math.PI).toFixed(6)),worldTile:Object.freeze({x:String(xValue??"0"),y:String(yValue??"0")})});
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
  const lat=zoomState.focusLatitudeRadians,lon=zoomState.focusLongitudeRadians,kinds=mapContextKindsForBand(zoomState.band);
  const key=[activeSeed,zoomState.band,lat.toFixed(4),lon.toFixed(4)].join("|");
  if(mapContextCache.key===key&&mapContextCache.value)return mapContextCache.value;
  const tile=mapWorldTileAt(lat,lon),needed=new Set(kinds),name=(kind,fallback)=>{
    try{
      if(kind==="country")return window.PoliticalGeography?.countryAt?.(activeSeed,tile.x,tile.y)?.name||fallback;
      if(kind==="region")return window.RegionProfile?.at?.(activeSeed,tile.x,tile.y)?.name||fallback;
      return window.GeographyFoundation?.hierarchyName?.(activeSeed,kind,tile.x,tile.y)||fallback;
    }catch(_){return fallback;}
  };
  const context=Object.freeze({
    continent:needed.has("continent")?String(name("continent",mapGeneratedName("continent",lat,lon))):null,
    country:needed.has("country")?String(name("country",mapGeneratedName("country",lat,lon))):null,
    region:needed.has("region")?String(name("region",mapGeneratedName("region",lat,lon))):null,
    city:needed.has("city")?String(name("city",mapGeneratedName("city",lat,lon))):null,
    district:needed.has("district")?String(name("district",mapGeneratedName("district",lat,lon))):null,
    village:needed.has("village")?String(name("village",mapGeneratedName("village",lat,lon))):null,
    tileX:tile.x,tileY:tile.y
  });
  mapContextCache={key,value:context};return context;
}
function mapContextKindsForBand(band){
  const table={
    planet:["continent"],continent:["continent"],
    "country-region":["continent","country"],
    "regional-overview":["country","region"],
    "regional-detail":["country","region"],
    district:["region","city"],
    "local-area":["region","city","district"],
    settlement:["city","village","district"],
    "near-ground":["village","district"],ground:["village","district"]
  };
  return table[band]||["continent"];
}
function mapPlaceKindsForBand(band){
  const table={
    planet:["continent"],continent:["continent"],
    "country-region":["continent","city"],
    "regional-overview":["city"],"regional-detail":["city","town"],
    district:["city","town"],"local-area":["city","town","village"],
    settlement:["town","village"],"near-ground":["village"],ground:["village"]
  };
  return table[band]||[];
}
function mapZoomScaleMultiplier(){
  return Math.pow(10,-2+2*clamp(zoomState.scalar,0,1));
}
function formatZoomScale(value){
  const v=Math.max(.0001,Number(value)||.01);
  if(v>=.995)return "1.00x";
  if(v>=.1)return v.toFixed(2)+"x";
  return v.toFixed(2)+"x";
}
function niceScaleDistanceMeters(widthMeters){
  const target=Math.max(1,Number(widthMeters)||1)*.22;
  const power=Math.pow(10,Math.floor(Math.log10(target)));
  const normalized=target/power;
  const nice=normalized>=5?5:normalized>=2?2:1;
  return nice*power;
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
  const info=document.createElement("section");info.className="planet-map-context";info.setAttribute("aria-label","Geographic context");
  const scale=document.createElement("div");scale.className="planet-scale-ruler";scale.innerHTML='<div class="planet-scale-meta"><strong></strong><span></span></div><div class="planet-scale-line"><i></i></div><small></small>';
  layer.append(borders,labels,info,scale);root.appendChild(layer);return layer;
}
function geographicScenePoint(latitudeRadians,longitudeRadians,surfaceOffsetMeters=0){
  if(!pc||!cameraEntity?.camera||!window.PlanetGeography?.directionFromLatLon)return null;
  const lat=clamp(latitudeRadians,-Math.PI*.499999,Math.PI*.499999),lon=wrapLongitudeRadians(longitudeRadians);
  const tangentActive=Boolean(tangentPatch?.enabled&&displayResource&&projectionState.blend>LOCAL_TANGENT_OWNERSHIP_BLEND);
  if(tangentActive){
    const frame=localDisplayFrame(),dims=frame.dims,lat0=frame.lat0,lon0=frame.lon0,cosLat=Math.max(.08,Math.cos(lat0));
    const north=(lat-lat0)*WORLD_RADIUS_METERS,east=wrapLongitudeRadians(lon-lon0)*WORLD_RADIUS_METERS*cosLat;
    if(Math.abs(east)>dims.patchWidth*.52||Math.abs(north)>dims.patchHeight*.52)return null;
    const local=new pc.Vec3(east/dims.metersPerUnit,localGroundHeightUnits(east,north,frame)+Number(surfaceOffsetMeters||0)/dims.metersPerUnit,-north/dims.metersPerUnit);
    const world=tangentPatch.getWorldTransform().transformPoint(local,new pc.Vec3());
    return {world,mode:"tangent",latitudeRadians:lat,longitudeRadians:lon,eastMeters:east,northMeters:north};
  }
  const direction=window.PlanetGeography.directionFromLatLon(lat,lon);if(!direction)return null;
  let sample=null;try{sample=geography?.sampleLatLon?.(lat,lon)||null;}catch(_){sample=null;}
  const visualMeters=visualElevationMeters(sample||{land:true,elevationMeters:0});
  const radius=DISPLAY_RADIUS_UNITS*(1+(visualMeters/WORLD_RADIUS_METERS)*HEIGHT_EXAGGERATION)+(DISPLAY_RADIUS_UNITS/WORLD_RADIUS_METERS)*Number(surfaceOffsetMeters||0);
  const local=new pc.Vec3(direction.x*radius,direction.y*radius,direction.z*radius);
  const world=planet?.getWorldTransform?.().transformPoint(local,new pc.Vec3())||local;
  return {world,mode:"globe",latitudeRadians:lat,longitudeRadians:lon,eastMeters:null,northMeters:null};
}
function projectGeographicAnchor(anchor,options={}){
  if(!canvas||!cameraEntity?.camera||!anchor)return null;
  const scene=geographicScenePoint(anchor.latitudeRadians,anchor.longitudeRadians,options.surfaceOffsetMeters||0);if(!scene)return null;
  if(scene.mode==="globe"&&planet){
    const center=planet.getPosition(),normal=scene.world.clone().sub(center),toCamera=cameraEntity.getPosition().clone().sub(scene.world);
    if(normal.dot(toCamera)<=0)return null;
  }
  const screen=cameraEntity.camera.worldToScreen(scene.world),rect=canvas.getBoundingClientRect();
  if(!Number.isFinite(screen.x)||!Number.isFinite(screen.y)||!Number.isFinite(screen.z)||screen.z<0)return null;
  const xPct=screen.x/Math.max(1,rect.width)*100,yPct=screen.y/Math.max(1,rect.height)*100;
  if(options.allowOffscreen!==true&&(xPct<0||xPct>100||yPct<0||yPct>100))return null;
  return {
    x:xPct,y:yPct,screenX:screen.x,screenY:screen.y,depth:screen.z,mode:scene.mode,
    latitudeRadians:scene.latitudeRadians,longitudeRadians:scene.longitudeRadians,
    worldX:Number(scene.world.x.toFixed(6)),worldY:Number(scene.world.y.toFixed(6)),worldZ:Number(scene.world.z.toFixed(6))
  };
}
function projectMapLabel(descriptor){return projectGeographicAnchor(descriptor,{surfaceOffsetMeters:8});}
function mapLandmarkKindsForBand(band){
  const table={
    planet:["peak","mountain"],
    continent:["peak","mountain","island"],
    "country-region":["peak","mountain","city","island"],
    "regional-overview":["peak","mountain","city","town","ruin","water"],
    "regional-detail":["peak","mountain","city","town","ruin","water"],
    district:["city","town","village","ruin"],
    "local-area":["city","town","village","ruin"],
    settlement:["town","village","ruin"],
    "near-ground":["village","ruin"],
    ground:["village","ruin"]
  };
  return table[band]||[];
}

function atlasHashText(value){
  let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function atlasFloorDiv(value,size){
  const v=BigInt(String(value)),s=BigInt(size);let q=v/s,r=v%s;if(r!==0n&&v<0n)q-=1n;return q;
}
function atlasCellForTile(tile,size){
  return Object.freeze({x:atlasFloorDiv(tile.x,size),y:atlasFloorDiv(tile.y,size)});
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
function atlasEntityBase(id,type,name,anchorTile,authority,extra={}){
  if(!id||!name||!anchorTile)return null;const geo=worldLatLonForTile(anchorTile.x,anchorTile.y);
  return Object.freeze({id:String(id),type:String(type),name:String(name),authority:String(authority),anchorTile:Object.freeze({x:String(anchorTile.x),y:String(anchorTile.y)}),
    latitudeRadians:geo.latitudeRadians,longitudeRadians:geo.longitudeRadians,latitudeDegrees:geo.latitudeDegrees,longitudeDegrees:geo.longitudeDegrees,...extra});
}
function atlasCanonicalEntityForKind(kind,tile){
  if(!activeSeed||!tile)return null;
  if(kind==="continent"){
    const size=131072,cell=atlasCellForTile(tile,size),id=atlasCellId("CONT",cell),cacheKey=activeSeed+"|"+id;
    if(atlasEntityCache.has(cacheKey))return atlasEntityCache.get(cacheKey);
    const half=BigInt(Math.floor(size/2)),base={x:(cell.x*BigInt(size)+half).toString(),y:(cell.y*BigInt(size)+half).toString()};
    const anchor=atlasRepresentativeTile(base.x,base.y,Math.floor(size*.22),true,(x,y)=>{const cc=atlasCellForTile({x,y},size);return cc.x===cell.x&&cc.y===cell.y;});
    if(!anchor){atlasEntityCache.set(cacheKey,null);return null;}const name=window.GeographyFoundation?.hierarchyName?.(activeSeed,"continent",anchor.x,anchor.y);if(!name){atlasEntityCache.set(cacheKey,null);return null;}
    const entity=atlasEntityBase(id,"continent",name,anchor,"GeographyFoundation.hierarchy");atlasEntityCache.set(cacheKey,entity);return entity;
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
    const entity=atlasEntityBase(capital.id,"capital",capital.name,{x:capital.x,y:capital.y},"PoliticalGeography.capital:indexed",{countryId:countryEntity.id});
    atlasEntityCache.set(capKey,entity);return entity;
  }
  if(kind==="region"){
    const key=atlasAuthorityKey("region",tile);
    if(!atlasAuthorityIndex.has(key)){atlasQueueAuthority("region",tile);return null;}
    return atlasAuthorityIndex.get(key);
  }
  if(kind==="city"||kind==="district"){
    const size=kind==="city"?1024:256,cell=atlasCellForTile(tile,size),id=atlasCellId(kind==="city"?"CITY":"DIST",cell),cacheKey=activeSeed+"|"+id;
    if(atlasEntityCache.has(cacheKey))return atlasEntityCache.get(cacheKey);
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
function atlasBandSpec(band,portrait){
  const table={
    planet:{kinds:["continent","ocean"],focusKind:"continent",budget:portrait?4:7,latSpan:68,lonSpan:118},
    continent:{kinds:["continent","ocean","country"],focusKind:"continent",budget:portrait?5:9,latSpan:48,lonSpan:78},
    "country-region":{kinds:["country","region","capital","landmark"],focusKind:"country",budget:portrait?6:10,latSpan:28,lonSpan:44},
    "regional-overview":{kinds:["country","region","capital","city","landmark"],focusKind:"region",budget:portrait?7:11},
    "regional-detail":{kinds:["country","region","capital","city","landmark"],focusKind:"region",budget:portrait?7:12},
    district:{kinds:["region","city","village","landmark"],focusKind:"city",budget:portrait?7:12},
    "local-area":{kinds:["region","city","village","district","landmark"],focusKind:"village",budget:portrait?7:12},
    settlement:{kinds:["city","village","district","landmark"],focusKind:"village",budget:portrait?7:10},
    "near-ground":{kinds:["village","district","landmark"],focusKind:"village",budget:portrait?6:8},
    ground:{kinds:["village","district","landmark"],focusKind:"village",budget:portrait?5:7}
  };
  return table[band]||table.planet;
}
function atlasQuerySamples(spec){
  const globe=zoomState.band==="planet"||zoomState.band==="continent"||zoomState.band==="country-region";
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
  let countryEntity=null,regionEntity=null,village=null;
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
  if(needed.has("village"))try{village=window.GeographyFoundation?.nearestVillage?.(activeSeed,tile.x,tile.y,false)||null;}catch(_){}
  if(needed.has("continent"))ids.continent=atlasCellId("CONT",atlasCellForTile(tile,131072));
  if(needed.has("country"))ids.country=countryEntity?.id||null;
  if(needed.has("capital"))ids.capital=countryEntity?.capital?.id||null;
  if(needed.has("region"))ids.region=regionEntity?.id||null;
  if(needed.has("city"))ids.city=atlasCellId("CITY",atlasCellForTile(tile,1024));
  if(needed.has("district"))ids.district=atlasCellId("DIST",atlasCellForTile(tile,256));
  if(needed.has("village"))ids.village=village?atlasCellId("VIL",Object.freeze({x:BigInt(village.cellX),y:BigInt(village.cellY)})):null;
  return {tile,ids,primaryId:ids[spec.focusKind]||null};
}
function atlasQueryCandidates(spec){
  const precision=(zoomState.band==="planet"||zoomState.band==="continent")?1:2;
  const key=[activeSeed,zoomState.band,zoomState.focusLatitudeRadians.toFixed(precision),zoomState.focusLongitudeRadians.toFixed(precision),Math.round(Math.log10(Math.max(1,zoomState.visibleFootprintWidthMeters))*20),spec.kinds.join(",")].join("|");
  if(atlasLabelCache.key===key)return atlasLabelCache;
  const started=performance.now(),samples=atlasQuerySamples(spec),unique=new Map(),focus=atlasFocusEntityIds(spec);
  for(const [sampleIndex,point] of samples.entries()){
    let surface=null;try{surface=geography?.sampleLatLon?.(point.latitudeRadians,point.longitudeRadians)||null;}catch(_){surface=null;}if(!surface)continue;
    const tile=mapWorldTileAt(point.latitudeRadians,point.longitudeRadians);
    for(const kind of spec.kinds){
      if(kind==="landmark")continue;
      if(samples.length>9&&["country","region","capital"].includes(kind)&&sampleIndex%3!==1)continue;
      if(samples.length>9&&kind==="city"&&sampleIndex%2!==0)continue;
      if(kind==="ocean"){if(surface.land)continue;}else if(!surface.land)continue;
      let entity=null;try{entity=atlasCanonicalEntityForKind(kind,tile);}catch(_){entity=null;}if(!entity)continue;
      if(!unique.has(entity.id))unique.set(entity.id,entity);
    }
  }
  if(spec.kinds.includes("landmark")){
    for(const d of destinationNavigator.descriptors){
      if(!["peak","mountain","island","ruin","water"].includes(d.type))continue;
      const tile=mapWorldTileAt(d.latitudeRadians,d.longitudeRadians);
      const entity=atlasEntityBase(d.id,"landmark",d.name,tile,"DestinationNavigatorDescriptor",{landmarkType:d.type,importance:Number(d.importance||0),latitudeRadians:Number(d.latitudeRadians)||0,longitudeRadians:Number(d.longitudeRadians)||0,latitudeDegrees:Number(d.latitudeDegrees)||0,longitudeDegrees:Number(d.longitudeDegrees)||0});
      if(entity&&!unique.has(entity.id))unique.set(entity.id,entity);
    }
  }
  if(zoomState.band==="country-region"){
    const countryCount=[...unique.values()].filter(entity=>entity.type==="country").length;
    if(countryCount<2){for(const [id,entity] of [...unique.entries()])if(entity.type==="region")unique.delete(id);}
  }
  const typePriority={continent:100,ocean:96,country:90,region:82,capital:78,city:72,village:68,district:60,landmark:52};
  const candidates=[...unique.values()].map(entity=>Object.freeze({...entity,currentFocus:entity.id===focus.primaryId,priority:(entity.id===focus.primaryId?1000:0)+(typePriority[entity.type]||0)+Number(entity.importance||0)}))
    .sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  atlasLabelCache={key,candidates,queryCellCount:samples.length,buildMs:Number((performance.now()-started).toFixed(3)),focus};
  return atlasLabelCache;
}
function atlasResolvedIdentity(entity){
  const cacheKey=activeSeed+"|"+entity.id+"|"+entity.anchorTile.x+"|"+entity.anchorTile.y;
  if(atlasIdentityCache.has(cacheKey))return atlasIdentityCache.get(cacheKey);
  const tile=entity.anchorTile,ids={continent:null,country:null,region:null,city:null,district:null,village:null};
  let resolvedName=null,resolvedId=null;
  try{
    if(entity.type==="continent"){
      const cell=atlasCellForTile(tile,131072);ids.continent=atlasCellId("CONT",cell);resolvedId=ids.continent;
      resolvedName=window.GeographyFoundation?.hierarchyName?.(activeSeed,"continent",tile.x,tile.y)||null;
    }else if(entity.type==="ocean"){
      const s=atlasPlanetSurfaceForTile(tile.x,tile.y);resolvedName=s.sample?.land?null:entity.name;resolvedId=s.sample?.land?null:entity.id;
    }else if(entity.type==="country"){
      const country=atlasAuthorityIndex.get(atlasAuthorityKey("country",tile))||null;ids.country=country?.id||null;resolvedId=country?.id||null;resolvedName=country?.name||null;
    }else if(entity.type==="capital"){
      const country=atlasAuthorityIndex.get(atlasAuthorityKey("country",tile))||null;ids.country=country?.id||null;resolvedId=country?.capital?.id||null;resolvedName=country?.capital?.name||null;
    }else if(entity.type==="region"){
      const region=atlasAuthorityIndex.get(atlasAuthorityKey("region",tile))||null;ids.region=region?.id||null;ids.country=region?.countryId||null;resolvedId=region?.id||null;resolvedName=region?.name||null;
    }else if(entity.type==="city"){
      const cell=atlasCellForTile(tile,1024);ids.city=atlasCellId("CITY",cell);resolvedId=ids.city;resolvedName=window.GeographyFoundation?.hierarchyName?.(activeSeed,"city",tile.x,tile.y)||null;
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
  const screen=cameraEntity.camera.worldToScreen(scene.world),rect=canvas.getBoundingClientRect();
  if(!Number.isFinite(screen.x)||!Number.isFinite(screen.y)||!Number.isFinite(screen.z)||screen.z<0)return {reason:"behind-camera"};
  const x=screen.x/Math.max(1,rect.width)*100,y=screen.y/Math.max(1,rect.height)*100;
  if(x<2||x>98||y<3||y>97)return {reason:"offscreen"};
  return {projection:{x,y,screenX:screen.x,screenY:screen.y,depth:screen.z,mode:scene.mode}};
}
function atlasLabelBox(entity,p,portrait){
  const nameLen=Math.max(5,String(entity.name).length),scale=portrait?.82:1;
  const perChar={continent:15.5,ocean:11.5,country:11.0,region:8.2,capital:7.8,city:7.4,village:7.0,district:6.6,landmark:7.4}[entity.type]||7.4;
  const minWidth={continent:180,ocean:140,country:150,region:115,capital:110,city:104,village:100,district:96,landmark:112}[entity.type]||100;
  const maxWidth={continent:360,ocean:260,country:300,region:230,capital:220,city:200,village:190,district:180,landmark:220}[entity.type]||200;
  const width=Math.min(maxWidth,Math.max(minWidth,30+nameLen*perChar))*scale,height=(entity.type==="continent"||entity.type==="ocean"?48:40)*scale;
  return {left:p.screenX-width/2,right:p.screenX+width/2,top:p.screenY-height/2,bottom:p.screenY+height/2};
}
function atlasBoxesOverlap(a,b,gap){return !(a.right+gap<b.left||b.right+gap<a.left||a.bottom+gap<b.top||b.bottom+gap<a.top);}
function renderAtlasLabels(labelsLayer,portrait,spec){
  const query=atlasQueryCandidates(spec),occupied=[],visible=[],visibleLandmarks=[];
  let hidden=0,behind=0,offscreen=0,occluded=0,overlap=0;
  const rect=canvas.getBoundingClientRect();
  for(const entity of query.candidates){
    if(visible.length>=spec.budget)break;
    const projected=atlasProjectCandidate(entity);
    if(!projected.projection){
      if(projected.reason==="hidden-hemisphere"){hidden++;occluded++;}
      else if(projected.reason==="behind-camera")behind++;
      else offscreen++;
      continue;
    }
    const p=projected.projection;
    if((p.x<30&&p.y<31)||(p.x>80&&p.y<16)||(p.x<27&&p.y>84)){offscreen++;continue;}
    const box=atlasLabelBox(entity,p,portrait),margin=portrait?8:10;
    if(box.left<margin||box.right>rect.width-margin||box.top<margin||box.bottom>rect.height-margin){offscreen++;continue;}
    const reservedSelectors=[".planet-map-context",".planet-places-button",".planet-scale-ruler"];
    const reserved=reservedSelectors.map(selector=>root?.querySelector?.(selector)?.getBoundingClientRect?.()).filter(Boolean).map(r=>({left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top}));
    if(reserved.some(other=>atlasBoxesOverlap(box,other,portrait?6:10))){overlap++;continue;}
    if(occupied.some(other=>atlasBoxesOverlap(box,other,portrait?6:9))){overlap++;continue;}
    const identity=atlasResolvedIdentity(entity);if(!identity.identityMatch)continue;
    const tag=document.createElement("div");
    tag.className=entity.type==="landmark"?"planet-map-landmark":"planet-atlas-label";
    tag.dataset.kind=entity.type==="landmark"?(entity.landmarkType||"landmark"):entity.type;
    tag.dataset.focus=String(entity.currentFocus===true);
    tag.style.left=p.x.toFixed(2)+"%";tag.style.top=p.y.toFixed(2)+"%";
    tag.innerHTML="<small></small><strong></strong>";
    tag.querySelector("small").textContent=(entity.type==="landmark"?String(entity.landmarkType||"landmark"):entity.type).toUpperCase();
    tag.querySelector("strong").textContent=entity.name;
    labelsLayer.appendChild(tag);occupied.push(box);
    const record=Object.freeze({
      canonicalEntityId:entity.id,entityType:entity.type,displayClass:entity.type==="landmark"?(entity.landmarkType||"landmark"):entity.type,
      authoritativeName:entity.name,authority:entity.authority,currentFocus:Boolean(entity.currentFocus),
      anchorLatitudeDegrees:Number(entity.latitudeDegrees.toFixed(5)),anchorLongitudeDegrees:Number(entity.longitudeDegrees.toFixed(5)),
      anchorWorldTile:entity.anchorTile,resolvedHierarchyIds:identity.ids,identityMatch:identity.identityMatch,
      screenX:Number(p.screenX.toFixed(2)),screenY:Number(p.screenY.toFixed(2)),projection:p.mode
    });
    visible.push(record);if(entity.type==="landmark")visibleLandmarks.push(Object.freeze({id:entity.id,name:entity.name,type:entity.landmarkType||"landmark",latitudeDegrees:record.anchorLatitudeDegrees,longitudeDegrees:record.anchorLongitudeDegrees,screenX:record.screenX,screenY:record.screenY,projection:record.projection}));
  }
  return {query,visible,visibleLandmarks,hidden,behind,offscreen,occluded,overlap,viewport:Object.freeze({width:rect.width,height:rect.height})};
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
function buildMapBorderSegments(){
  const band=zoomState.band,visible=["country-region","regional-overview","regional-detail"].includes(band);
  if(!visible||!window.PoliticalGeography?.ownerAt)return {segments:[],sampleCount:0,landSampleCount:0,waterSampleCount:0,ownerQueryCount:0,ownerCount:0,worldVertexCount:0,built:false};
  const quantizedScalar=Math.round(zoomState.scalar*20)/20;
  const key=[activeSeed,band,quantizedScalar,Math.round(zoomState.focusLatitudeRadians*180/Math.PI*4)/4,Math.round(zoomState.focusLongitudeRadians*180/Math.PI*4)/4,Math.round((canvas?.clientWidth||1)/(canvas?.clientHeight||1)*10)/10].join("|");
  if(mapBorderCache.key===key)return {
    segments:mapBorderCache.segments,sampleCount:mapBorderCache.sampleCount,landSampleCount:mapBorderCache.landSampleCount,waterSampleCount:mapBorderCache.waterSampleCount,
    ownerQueryCount:mapBorderCache.ownerQueryCount,ownerCount:mapBorderCache.ownerCount,worldVertexCount:mapBorderCache.worldVertexCount,built:false
  };
  const started=performance.now(),cols=21,rows=13,owners=[],ownerIds=new Set();
  let landSampleCount=0,waterSampleCount=0,ownerQueryCount=0;
  const width=Math.max(1,zoomState.visibleFootprintWidthMeters),height=Math.max(1,zoomState.visibleFootprintHeightMeters);
  for(let r=0;r<rows;r++){
    const row=[];
    for(let col=0;col<cols;col++){
      const point=geoPointFromViewportGrid(col,r,cols,rows,width,height);
      let surface=null;try{surface=geography?.sampleLatLon?.(point.latitudeRadians,point.longitudeRadians)||null;}catch(_){surface=null;}
      if(!surface?.land){waterSampleCount++;row.push("water");continue;}
      landSampleCount++;
      const tile=mapWorldTileAt(point.latitudeRadians,point.longitudeRadians);
      let owner=null;try{owner=window.PoliticalGeography.ownerAt(activeSeed,tile.x,tile.y);ownerQueryCount++;}catch(_){owner=null;}
      const id=String(owner?.id||"none");if(id!=="none")ownerIds.add(id);row.push(id);
    }
    owners.push(row);
  }
  const segments=[],centerOwner=owners[Math.floor(rows/2)][Math.floor(cols/2)];
  const crossesFocusedBorder=(left,right)=>left!=="water"&&right!=="water"&&left!=="none"&&right!=="none"&&(left===centerOwner)!==(right===centerOwner);
  if(centerOwner!=="water"&&centerOwner!=="none"){
    for(let r=0;r<rows-1;r++)for(let col=0;col<cols-1;col++){
      const a=owners[r][col],b=owners[r][col+1],c=owners[r+1][col+1],d=owners[r+1][col],crossings=[];
      if(crossesFocusedBorder(a,b))crossings.push(geoPointFromViewportGrid(col+.5,r,cols,rows,width,height));
      if(crossesFocusedBorder(b,c))crossings.push(geoPointFromViewportGrid(col+1,r+.5,cols,rows,width,height));
      if(crossesFocusedBorder(d,c))crossings.push(geoPointFromViewportGrid(col+.5,r+1,cols,rows,width,height));
      if(crossesFocusedBorder(a,d))crossings.push(geoPointFromViewportGrid(col,r+.5,cols,rows,width,height));
      if(crossings.length===2)segments.push({a:crossings[0],b:crossings[1]});
      else if(crossings.length===4){segments.push({a:crossings[0],b:crossings[1]});segments.push({a:crossings[2],b:crossings[3]});}
    }
  }
  const worldVertexCount=segments.length*3;
  mapBorderCache={key,segments,sampleCount:cols*rows,landSampleCount,waterSampleCount,ownerQueryCount,ownerCount:ownerIds.size,worldVertexCount,builtAtMs:Number((performance.now()-started).toFixed(3))};
  return {segments,sampleCount:cols*rows,landSampleCount,waterSampleCount,ownerQueryCount,ownerCount:ownerIds.size,worldVertexCount,built:true};
}
function renderMapPresentation(){
  const layer=ensureMapPresentationDom();if(!layer)return;
  const started=performance.now(),context=mapContextForFocus(),contextKinds=mapContextKindsForBand(zoomState.band),placeKinds=mapPlaceKindsForBand(zoomState.band);
  const info=layer.querySelector(".planet-map-context");info.replaceChildren();
  const heading=document.createElement("div");heading.className="planet-map-context-head";heading.innerHTML="<small>WORLD MAP</small><strong></strong>";heading.querySelector("strong").textContent=zoomState.band.replaceAll("-"," ");info.appendChild(heading);
  const names=document.createElement("div");names.className="planet-map-context-names";
  const labels={continent:"CONTINENT",country:"COUNTRY",region:"REGION",city:"CITY",district:"ZONE",village:"VILLAGE"};
  for(const kind of contextKinds){const row=document.createElement("div");row.innerHTML="<span></span><strong></strong>";row.querySelector("span").textContent=labels[kind]||kind.toUpperCase();row.querySelector("strong").textContent=String(context?.[kind]||"—");names.appendChild(row);}info.appendChild(names);

  const border=buildMapBorderSegments(),svg=layer.querySelector(".planet-map-borders");svg.replaceChildren();
  let projectedBorderSegmentCount=0;
  const borderOffsetMeters=Math.max(2,Math.min(24,zoomState.visibleFootprintWidthMeters*.000015));
  for(const seg of border.segments){
    const samples=[seg.a,interpolateGeoPoint(seg.a,seg.b,.5),seg.b].map(point=>projectGeographicAnchor(point,{surfaceOffsetMeters:borderOffsetMeters,allowOffscreen:true}));
    if(samples.some(p=>!p))continue;
    const xs=samples.map(p=>p.x),ys=samples.map(p=>p.y);
    if(Math.max(...xs)<-3||Math.min(...xs)>103||Math.max(...ys)<-3||Math.min(...ys)>103)continue;
    const line=document.createElementNS("http://www.w3.org/2000/svg","polyline");
    line.setAttribute("points",samples.map(p=>(p.x*10).toFixed(1)+","+(p.y*10).toFixed(1)).join(" "));
    line.setAttribute("class","planet-political-border");svg.appendChild(line);projectedBorderSegmentCount++;
  }
  svg.hidden=projectedBorderSegmentCount===0;

  const labelsLayer=layer.querySelector(".planet-map-labels");labelsLayer.replaceChildren();
  const rect=canvas?.getBoundingClientRect?.(),portrait=(rect?.height||1)>(rect?.width||1),spec=atlasBandSpec(zoomState.band,portrait);
  const atlas=renderAtlasLabels(labelsLayer,portrait,spec),visible=atlas.visible,visibleLandmarks=atlas.visibleLandmarks;
  const hierarchyVisible=visible.filter(item=>item.entityType!=="landmark"),legacyLabelCount=Math.min(6,hierarchyVisible.length);
  const visibleClasses=Array.from(new Set(visible.map(item=>item.displayClass)));
  const landmarkCandidates=atlas.query.candidates.filter(item=>item.type==="landmark");
  const maxLandmarkCount=spec.budget;
  const multiplier=mapZoomScaleMultiplier(),scaleMeters=niceScaleDistanceMeters(zoomState.visibleFootprintWidthMeters),barPx=clamp(scaleMeters/Math.max(1,zoomState.visibleFootprintWidthMeters)*(rect?.width||1),72,190);
  const scale=layer.querySelector(".planet-scale-ruler");scale.querySelector(".planet-scale-meta strong").textContent=formatZoomScale(multiplier);scale.querySelector(".planet-scale-meta span").textContent=zoomState.band.replaceAll("-"," ");scale.querySelector(".planet-scale-line").style.width=Math.round(barPx)+"px";scale.querySelector("small").textContent=formatDistanceMeters(scaleMeters);
  mapPresentation={
    active:true,context,visibleContextKinds:contextKinds,visiblePlaceKinds:placeKinds,labelCount:legacyLabelCount,
    atlasVisibleLabelCount:visible.length,atlasCandidateCount:atlas.query.candidates.length,atlasQueryCellCount:atlas.query.queryCellCount,
    hiddenHemisphereCulledCount:atlas.hidden,behindCameraCulledCount:atlas.behind,offscreenCulledCount:atlas.offscreen,
    occludedCulledCount:atlas.occluded,overlapRejectedCount:atlas.overlap,visibleLabelClasses:visibleClasses,visibleLabels:visible,
    maxLabelBudget:spec.budget,labelQueryBuildMs:atlas.query.buildMs,
    landmarkCandidateCount:landmarkCandidates.length,landmarkVisibleCount:visibleLandmarks.length,landmarkKinds:Array.from(new Set(visibleLandmarks.map(item=>item.type))),visibleLandmarks,maxLandmarkCount,
    borderVisible:projectedBorderSegmentCount>0,borderSampleCount:border.sampleCount,borderLandSampleCount:border.landSampleCount,borderWaterSampleCount:border.waterSampleCount,borderOwnerQueryCount:border.ownerQueryCount,borderSegmentCount:border.segments.length,borderWorldVertexCount:border.worldVertexCount,projectedBorderSegmentCount,politicalOwnerCount:border.ownerCount,
    projectionMode:projectionState.mode,projectionBlend:Number(projectionState.blend.toFixed(6)),
    scaleDistanceMeters:scaleMeters,scaleLabel:formatDistanceMeters(scaleMeters),zoomScaleMultiplier:Number(multiplier.toFixed(5)),zoomScaleLabel:formatZoomScale(multiplier),
    updateCount:mapPresentation.updateCount+1,lastUpdateMs:Number((performance.now()-started).toFixed(3)),lastBorderBuildMs:mapBorderCache.builtAtMs,bounded:true,fullWorldScan:false
  };
}
function updateMapPresentation(){if(!root||!canvas||!activeSeed)return;renderMapPresentation();}

function tangentFrame(latitudeRadians,longitudeRadians){
  const lat=Number(latitudeRadians)||0,lon=Number(longitudeRadians)||0;
  const cLat=Math.cos(lat),sLat=Math.sin(lat),cLon=Math.cos(lon),sLon=Math.sin(lon);
  const up=[cLat*sLon,sLat,cLat*cLon];
  const east=[cLon,0,-sLon];
  const north=[-sLat*sLon,cLat,-sLat*cLon];
  return Object.freeze({
    originMeters:Object.freeze(up.map(v=>Number((v*WORLD_RADIUS_METERS).toFixed(3)))),
    east:Object.freeze(east.map(v=>Number(v.toFixed(6)))),
    north:Object.freeze(north.map(v=>Number(v.toFixed(6)))),
    up:Object.freeze(up.map(v=>Number(v.toFixed(6))))
  });
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
    const lat=clamp(lat0+northMeters/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
    let lon=lon0+eastMeters/(WORLD_RADIUS_METERS*cosLat);lon=wrapLongitudeRadians(lon);
    const sample=geography.sampleLatLon(lat,lon);
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
    cameraTarget:Object.freeze([0,0,Number((DISPLAY_RADIUS_UNITS*blend).toFixed(6))]),
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
function rawLodIndexForZoom(value){
  const max=ladderState().levelMax,index=max.findIndex(m=>value<=m);
  return index<0?LOCAL_DETAIL_LEVELS.length-1:index;
}
function zoomBandFor(value){
  if(value<=SEMANTIC_LOCAL_BAND_START)return (ZOOM_BANDS.find(b=>b.max!==null&&value<=b.max)||ZOOM_BANDS[2]).id;
  return LOCAL_DETAIL_LEVELS[rawLodIndexForZoom(value)].band;
}
function updateZoomFocusFromRotation(){zoomState.focusLatitudeRadians=pitchDegrees*Math.PI/180;zoomState.focusLongitudeRadians=-yawDegrees*Math.PI/180;}
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
  if(rawIndex>requestedLodIndex){
    const boundary=levelMaxScalar(requestedLodIndex);
    if(value<boundary+lodHysteresisAt(requestedLodIndex+1))return requestedLodIndex;
  }else if(rawIndex<requestedLodIndex){
    const boundary=levelMaxScalar(rawIndex);
    if(value>boundary-lodHysteresisAt(rawIndex+1))return requestedLodIndex;
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
  const x=Math.floor(eastMeters*.5),z=Math.floor(northMeters*.5);
  let h=(Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul((activeSeed||"").length+salt,2246822519))>>>0;
  h=Math.imul(h^(h>>>13),1274126177)>>>0;return ((h^(h>>>16))>>>0)/4294967295;
}
function localSurfaceSample(eastMeters,northMeters,base){
  const salt=((seededUnit("local-ground")*1e9)|0)^0x51f15e;
  const broad=surfaceValueNoise(eastMeters,northMeters,34,salt+11)*1.15;
  const medium=surfaceValueNoise(eastMeters,northMeters,12,salt+29)*.72;
  const fine=surfaceValueNoise(eastMeters,northMeters,4.2,salt+47)*.38;
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
function localGroundHeightUnits(eastMeters,northMeters,frame=localDisplayFrame()){
  const dims=frame.dims,lat0=frame.lat0,lon0=frame.lon0,cosLat=Math.max(.08,Math.cos(lat0));
  const lat=clamp(lat0+northMeters/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
  let lon=lon0+eastMeters/(WORLD_RADIUS_METERS*cosLat);lon=wrapLongitudeRadians(lon);
  const sample=geography?.sampleLatLon?.(lat,lon),centerElevation=frame.centerElevation??Number(geography?.sampleLatLon?.(lat0,lon0)?.elevationMeters||0);
  const local=localSurfaceSample(eastMeters,northMeters,sample),elevation=Number(sample?.elevationMeters||0);
  const macroDelta=clamp(elevation-centerElevation,-dims.reliefClampMeters,dims.reliefClampMeters);
  const raw=(macroDelta*dims.reliefGain+local.microElevation*.8*frame.groundDetailWeight)/dims.metersPerUnit;
  const ux=eastMeters/dims.patchWidth+.5,vz=northMeters/dims.patchHeight+.5,edge=Math.min(ux,1-ux,vz,1-vz);
  return clamp(raw,-dims.maxHeightUnits,dims.maxHeightUnits)*smoothstep01(clamp(edge/.12,0,1));
}
function ensureLocalStaticMaterials(){
  if(localStaticMaterials||!pc)return;
  const make=(name,r,g,b,opacity=1)=>{const m=new pc.StandardMaterial();m.name=name;m.diffuse.set(r,g,b);m.roughness=.92;m.opacity=opacity;if(opacity<1){m.blendType=pc.BLEND_NORMAL;m.depthWrite=false;}m.update();return m;};
  localStaticMaterials={
    road:make("LocalRoad",.34,.25,.16),square:make("LocalSquare",.47,.39,.27),
    wall:make("LocalWall",.72,.55,.34),roof:make("LocalRoof",.35,.12,.08),
    landmark:make("LocalLandmark",.86,.57,.14),footprint:make("LocalSettlementFootprint",.54,.42,.18,.46),
    trunk:make("LocalTrunk",.24,.13,.06),leaf:make("LocalLeaf",.16,.39,.12),water:make("LocalWater",.08,.31,.48,.72)
  };
}
function sharedLocalPrimitive(type){
  if(localSharedPrimitives[type])return localSharedPrimitives[type];
  const mesh=type==="cylinder"?pc.createCylinder(device,{radius:.5,height:1}):type==="sphere"?pc.createSphere(device,{radius:.5,latitudeBands:8,longitudeBands:10}):pc.createBox(device);
  mesh.incRefCount();// keep alive across static-world rebuilds
  return localSharedPrimitives[type]=mesh;
}
function addLocalStatic(name,type,material,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){
  const e=new pc.Entity(name);
  e.addComponent("render",{type:"asset",castShadows:true,receiveShadows:true});e.render.meshInstances=[new pc.MeshInstance(sharedLocalPrimitive(type),material,e)];
  e.setLocalPosition(x,y,z);e.setLocalScale(sx,sy,sz);e.setLocalEulerAngles(rx,ry,rz);localStaticRoot.addChild(e);
}
function revealHashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function settlementRevealTierForScalar(value=zoomState.scalar){
  const s=clamp(value,0,1);
  if(s<.60)return "none";
  if(s<.70)return "footprint";
  if(s<.84)return "route";
  if(s<.92)return "coarse";
  if(s<.97)return "refined";
  return "full";
}
function canonicalStartingVillageReveal(resource){
  if(!activeSeed||!resource||!window.StartingVillage||!window.HousePlans||!window.SpecialLots||!window.SettlementArchetypes||!window.PoliticalGeography)return null;
  const focusTile=mapWorldTileAt(resource.lat0,resource.lon0);
  const distanceTiles=Math.hypot(Number(BigInt(focusTile.x)),Number(BigInt(focusTile.y)));
  if(distanceTiles>512)return null;
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
  return Object.freeze({...base,focusTile,distanceTiles});
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
function addCanonicalRoadSegment(name,x1,y1,x2,y2,widthMeters,presentationScale,unit,frame,lift=0,material=localStaticMaterials.road){
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const east1=x1*tileMeters,north1=y1*tileMeters,east2=x2*tileMeters,north2=y2*tileMeters;
  const centerEast=(east1+east2)/2,centerNorth=(north1+north2)/2;
  const dx=(east2-east1)*presentationScale,dz=-(north2-north1)*presentationScale;
  const length=Math.max(widthMeters*presentationScale,Math.hypot(dx,dz));
  const angle=Math.atan2(dx,dz)*180/Math.PI;
  const ground=localGroundHeightUnits(centerEast,centerNorth,frame)+lift+.028;
  addLocalStatic(name,"box",material,centerEast*presentationScale/unit,ground,-centerNorth*presentationScale/unit,widthMeters*presentationScale/unit,.058,length/unit,0,angle,0);
}
function addCanonicalBuilding(record,index,presentationScale,unit,frame,detailed,landmark,lift=0){
  const b=record.bounds,tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  const cx=(Number(b.minX)+Number(b.maxX))/2,cy=(Number(b.minY)+Number(b.maxY))/2;
  const w=(Number(b.maxX)-Number(b.minX)+1)*tileMeters,d=(Number(b.maxY)-Number(b.minY)+1)*tileMeters;
  const east=cx*tileMeters,north=cy*tileMeters,ground=localGroundHeightUnits(east,north,frame)+lift;
  const wall=landmark?localStaticMaterials.landmark:localStaticMaterials.wall;
  if(!detailed){
    const h=Math.max(.045,Math.min(.16,3.2*presentationScale/unit));
    addLocalStatic("CanonicalBlock-"+record.id,"box",wall,east*presentationScale/unit,ground+h*.5,-north*presentationScale/unit,w*presentationScale/unit,h,d*presentationScale/unit);
    return 1;
  }
  const physicalHeight=record.kind==="meeting-hall"?7.2:record.kind==="barn"?6.2:5.4;
  const h=Math.max(.08,physicalHeight*presentationScale/unit);
  addLocalStatic("CanonicalBody-"+record.id,"box",wall,east*presentationScale/unit,ground+h*.5,-north*presentationScale/unit,w*presentationScale/unit,h,d*presentationScale/unit);
  const roofMat=landmark?localStaticMaterials.landmark:localStaticMaterials.roof;
  const roofY=ground+h+.025;
  addLocalStatic("CanonicalRoofL-"+record.id,"box",roofMat,(east-w*.20)*presentationScale/unit,roofY,-north*presentationScale/unit,w*.66*presentationScale/unit,.05,d*1.10*presentationScale/unit,0,0,-24);
  addLocalStatic("CanonicalRoofR-"+record.id,"box",roofMat,(east+w*.20)*presentationScale/unit,roofY,-north*presentationScale/unit,w*.66*presentationScale/unit,.05,d*1.10*presentationScale/unit,0,0,24);
  return 3;
}
function rebuildCanonicalSettlementPresentation(resource,reveal,tier,frame){
  const started=performance.now(),dims=resource.dims,unit=dims.metersPerUnit,plan=reveal.settlement,village=reveal.village;
  const scale=revealPresentationScale(dims,tier,Number(village.approximateCoreDiameterMeters||104));
  ensureLocalStaticMaterials();localStaticRoot=new pc.Entity("CanonicalSettlementReveal");tangentPatch.addChild(localStaticRoot);
  const coreRadiusMeters=Number(village.approximateCoreDiameterMeters||104)/2;
  const lift=settlementPresentationLift(tier);
  const centerGround=localGroundHeightUnits(0,0,frame)+lift+.012;
  addLocalStatic("CanonicalOccupiedArea","cylinder",localStaticMaterials.footprint,0,centerGround,0,coreRadiusMeters*2*scale/unit,.022,coreRadiusMeters*2*scale/unit);
  let roadCount=0,coarseBuildings=0,fullBuildings=0,landmarks=0,vegetation=0,triangles=80;
  const roadWidth=Math.max(4,Number(window.WorldStandards?.TILE_METERS||2)*3);
  const squareHalf=Number(window.StartingVillage.PUBLIC_HALF_SIZE||3);
  const ring=Number(window.StartingVillage.RING_RADIUS_TILES||14);
  const roadDetail=tier==="footprint"?8:tier==="route"?12:16;
  if(tier!=="none"){
    addCanonicalRoadSegment("CanonicalRoad-X",-ring,0,ring,0,roadWidth,scale,unit,frame,lift);roadCount++;
    addCanonicalRoadSegment("CanonicalRoad-Y",0,-ring,0,ring,roadWidth,scale,unit,frame,lift);roadCount++;
    const sq=(squareHalf*2+1)*reveal.tileMeters;
    addLocalStatic("CanonicalPublicSquare","box",localStaticMaterials.square,0,centerGround+.012,0,sq*scale/unit,.032,sq*scale/unit);roadCount++;
  }
  if(roadDetail){
    let previous=null;
    for(let i=0;i<=roadDetail;i++){
      const a=i/roadDetail*Math.PI*2,x=Math.cos(a)*ring,y=Math.sin(a)*ring;
      if(previous){addCanonicalRoadSegment("CanonicalRing-"+i,previous.x,previous.y,x,y,roadWidth,scale,unit,frame,lift);roadCount++;}
      previous={x,y};
    }
    const dir=window.StartingVillage.direction(activeSeed),start=ring,end=Number(window.StartingVillage.GATEWAY_MAINLAND_EDGE_TILES||29);
    addCanonicalRoadSegment("CanonicalGateway",dir.dx*start,dir.dy*start,dir.dx*end,dir.dy*end,roadWidth,scale,unit,frame,lift);roadCount++;
  }
  const meeting=reveal.specialLots.find(item=>item.kind==="meeting-hall")||reveal.specialLots[0]||null;
  const ordinary=[...reveal.houses,...reveal.specialLots.filter(item=>!meeting||item.id!==meeting.id)];
  const targetCount=tier==="footprint"?3:tier==="route"?5:tier==="coarse"?Math.min(ordinary.length,10):(tier==="refined"||tier==="full"?ordinary.length:0);
  const detailed=tier==="refined"||tier==="full";
  for(let i=0;i<targetCount;i++){
    addCanonicalBuilding(ordinary[i],i,scale,unit,frame,detailed,false,lift);
    if(detailed)fullBuildings++;else coarseBuildings++;
  }
  if((tier==="footprint"||tier==="route"||tier==="coarse"||tier==="refined"||tier==="full")&&meeting){
    addCanonicalBuilding(meeting,targetCount,scale,unit,frame,detailed,true,lift);
    landmarks=1;if(detailed)fullBuildings++;else coarseBuildings++;
  }
  const treeCount=tier==="coarse"?6:tier==="refined"?10:tier==="full"?12:0;
  for(let i=0;i<treeCount;i++){
    const angle=i/Math.max(1,treeCount)*Math.PI*2+localHash(i*17,treeCount,91)*.22;
    const radiusTiles=22+localHash(i*31,treeCount,92)*4;
    const east=Math.cos(angle)*radiusTiles*reveal.tileMeters,north=Math.sin(angle)*radiusTiles*reveal.tileMeters;
    const ground=localGroundHeightUnits(east,north,frame)+lift,h=(4.5+localHash(i*43,treeCount,93)*2.5)*scale/unit;
    addLocalStatic("CanonicalTreeTrunk-"+i,"cylinder",localStaticMaterials.trunk,east*scale/unit,ground+h*.28,-north*scale/unit,.65*scale/unit,Math.max(.04,h*.56),.65*scale/unit);
    addLocalStatic("CanonicalTreeCrown-"+i,"sphere",localStaticMaterials.leaf,east*scale/unit,ground+h*.78,-north*scale/unit,3.8*scale/unit,Math.max(.06,h*.82),3.8*scale/unit);
    vegetation++;triangles+=180;
  }
  const entityCount=localStaticRoot.children.length;
  triangles+=roadCount*12+(coarseBuildings*12)+(fullBuildings*36);
  localStatic={
    ...localStatic,active:entityCount>0,signature:resource.signature,level:dims.levelId,revealTier:tier,
    settlementId:plan.id,settlementName:plan.name,settlementClass:plan.classId,settlementRole:plan.role,
    settlementPlanRevision:plan.revision,layoutSignature:reveal.layoutSignature,
    canonicalCenterTile:Object.freeze({x:String(village.center.x),y:String(village.center.y)}),
    presentationScale:scale,occupiedAreaCount:1,
    coarseRoadCount:(tier==="footprint"||tier==="route"||tier==="coarse")?roadCount:0,
    coarseBuildingCount:coarseBuildings,landmarkCount:landmarks,
    fullRoadCount:detailed?roadCount:0,fullBuildingCount:fullBuildings,
    roadCount,buildingCount:coarseBuildings+fullBuildings,vegetationCount:vegetation,waterCount:0,
    entityCount,triangleEstimate:triangles,drawCallEstimate:entityCount,
    buildTimeMs:Number((performance.now()-started).toFixed(3)),
    grounded:true,viewportBounded:true,presentationOnly:true,simulationAuthority:false,
    authority:"SettlementArchetypes + StartingVillage + HousePlans + SpecialLots"
  };
}
function rebuildLocalStaticPresentation(resource){
  if(!tangentPatch||!device||!geography||!resource)return;
  const started=performance.now(),dims=resource.dims,frame={lat0:resource.lat0,lon0:resource.lon0,dims,groundDetailWeight:resource.groundDetailWeight,centerElevation:resource.centerElevation},eligible=dims.staticWorld;
  localStaticRoot?.destroy?.();localStaticRoot=null;
  const tier=settlementRevealTierForScalar();
  localStatic={...localStatic,active:false,signature:resource.signature,level:dims.levelId,revealTier:"none",settlementId:null,settlementName:null,settlementClass:null,settlementRole:null,settlementPlanRevision:null,layoutSignature:null,canonicalCenterTile:null,presentationScale:1,occupiedAreaCount:0,coarseRoadCount:0,coarseBuildingCount:0,landmarkCount:0,fullRoadCount:0,fullBuildingCount:0,roadCount:0,buildingCount:0,vegetationCount:0,waterCount:0,entityCount:0,triangleEstimate:0,drawCallEstimate:0,buildTimeMs:0,presentationOnly:true,simulationAuthority:false};
  const reveal=canonicalStartingVillageReveal(resource);
  if(reveal&&tier!=="none"){
    rebuildCanonicalSettlementPresentation(resource,reveal,tier,frame);
    return;
  }
  if(!eligible)return;
  ensureLocalStaticMaterials();localStaticRoot=new pc.Entity("LocalStaticWorld");tangentPatch.addChild(localStaticRoot);
  const unit=dims.metersPerUnit,center=geography.sampleLatLon(resource.lat0,resource.lon0);
  if(center?.land){
    const roadWidth=Math.max(4.5,Math.min(9,dims.visibleWidth*.10)),roadSpan=dims.patchHeight*.82,roadSegments=14,segmentMeters=roadSpan/roadSegments;
    for(let r=0;r<roadSegments;r++){
      const north=-roadSpan*.5+(r+.5)*segmentMeters,y=localGroundHeightUnits(0,north,frame)+.035;
      addLocalStatic("SeedRoad-"+r,"box",localStaticMaterials.road,0,y,north/-unit,roadWidth/unit,.055,segmentMeters*1.08/unit);
    }
    localStatic.roadCount=roadSegments;localStatic.triangleEstimate+=roadSegments*12;
    const closeLevel=dims.visibleHeight<=60,count=closeLevel?6:10;
    for(let i=0;i<count;i++){
      const side=i%2===0?-1:1,row=Math.floor(i/2),north=(-.32+row*.16)*dims.patchHeight,east=side*(roadWidth*.5+5+localHash(i*17,north,31)*7);
      if(Math.abs(east)>dims.patchWidth*.43||Math.abs(north)>dims.patchHeight*.43)continue;
      const w=6.5+localHash(east,north,41)*4.5,d=6+localHash(east,north,42)*3.5,h=4.5+localHash(east,north,43)*2.8,y=localGroundHeightUnits(east,north,frame);
      addLocalStatic("SeedBuildingBody-"+i,"box",localStaticMaterials.wall,east/unit,y+h*.5/unit,-north/unit,w/unit,h/unit,d/unit);
      const roofY=y+(h+.65)/unit,roofHalf=w*.66/unit;
      addLocalStatic("SeedBuildingRoofL-"+i,"box",localStaticMaterials.roof,(east-w*.20)/unit,roofY,-north/unit,roofHalf,.55/unit,d*1.18/unit,0,0,-24);
      addLocalStatic("SeedBuildingRoofR-"+i,"box",localStaticMaterials.roof,(east+w*.20)/unit,roofY,-north/unit,roofHalf,.55/unit,d*1.18/unit,0,0,24);
      localStatic.buildingCount++;localStatic.triangleEstimate+=36;
    }
    const trees=closeLevel?14:24;
    for(let i=0;i<trees;i++){
      const east=(localHash(i*29,7,51)-.5)*dims.patchWidth*.78,north=(localHash(13,i*31,52)-.5)*dims.patchHeight*.78;
      if(Math.abs(east)<roadWidth*.9)continue;
      const y=localGroundHeightUnits(east,north,frame),h=3.5+localHash(east,north,53)*3;
      addLocalStatic("SeedTreeTrunk-"+i,"cylinder",localStaticMaterials.trunk,east/unit,y+h*.25/unit,-north/unit,.7/unit,h*.5/unit,.7/unit);
      addLocalStatic("SeedTreeCrown-"+i,"sphere",localStaticMaterials.leaf,east/unit,y+h*.72/unit,-north/unit,4.2/unit,h*.86/unit,4.2/unit);
      localStatic.vegetationCount++;localStatic.triangleEstimate+=180;
    }
  }else{
    const y=localGroundHeightUnits(0,0,frame)+.02;addLocalStatic("SeedWaterSurface","box",localStaticMaterials.water,0,y,0,dims.patchWidth*.88/unit,.035,dims.patchHeight*.88/unit);
    localStatic.waterCount=1;localStatic.triangleEstimate+=12;
  }
  localStatic.entityCount=localStaticRoot.children.length;localStatic.drawCallEstimate=localStatic.entityCount;localStatic.active=localStatic.entityCount>0;localStatic.buildTimeMs=Number((performance.now()-started).toFixed(3));
}
function scheduleLocalStaticPresentationRefresh(){
  if(localStaticRefreshScheduled||!displayResource)return;
  const desired=settlementRevealTierForScalar();
  if(localStatic.signature===displayResource.signature&&localStatic.revealTier===desired)return;
  localStaticRefreshScheduled=true;
  setTimeout(()=>{
    localStaticRefreshScheduled=false;
    if(displayResource)rebuildLocalStaticPresentation(displayResource);
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
  // Continuous (unwrapped) world meters: no seam where the patch crosses the
  // +/-180 degree meridian.
  const worldEastOrigin=lon0*WORLD_RADIUS_METERS*Math.max(.08,Math.cos(lat0)),worldNorthOrigin=lat0*WORLD_RADIUS_METERS;
  const authoritySize=Math.max(2,Math.min(size,128)),authorityCache=new Array(authoritySize*authoritySize);
  const cosLat0=Math.max(.08,Math.cos(lat0));
  const authorityAt=(ax,ay)=>{
    const ix=Math.max(0,Math.min(authoritySize-1,ax)),iy=Math.max(0,Math.min(authoritySize-1,ay)),key=iy*authoritySize+ix;
    if(authorityCache[key])return authorityCache[key];
    const au=ix/(authoritySize-1),av=iy/(authoritySize-1);
    const aeast=(au-.5)*spanEast,anorth=(.5-av)*spanNorth;
    const alat=clamp(lat0+anorth/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
    const alon=wrapLongitudeRadians(lon0+aeast/(WORLD_RADIUS_METERS*cosLat0));
    return authorityCache[key]=geography.sampleLatLon(alat,alon);
  };
  const mixSample=(ux,vz)=>{
    const gx=ux*(authoritySize-1),gy=vz*(authoritySize-1),x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(authoritySize-1,x0+1),y1=Math.min(authoritySize-1,y0+1),tx=gx-x0,ty=gy-y0;
    const a=authorityAt(x0,y0),b=authorityAt(x1,y0),c=authorityAt(x0,y1),d=authorityAt(x1,y1);
    const bilerp=(va,vb,vc,vd)=>lerp(lerp(Number(va)||0,Number(vb)||0,tx),lerp(Number(vc)||0,Number(vd)||0,tx),ty);
    const color=[0,1,2].map(i=>bilerp(a.color?.[i],b.color?.[i],c.color?.[i],d.color?.[i]));
    const landWeight=bilerp(a.land?1:0,b.land?1:0,c.land?1:0,d.land?1:0);
    return {land:landWeight>=.5,color,elevationMeters:bilerp(a.elevationMeters,b.elevationMeters,c.elevationMeters,d.elevationMeters)};
  };
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const ux=(x+.5)/size,vz=(y+.5)/size;
      const east=(ux-.5)*spanEast,north=(.5-vz)*spanNorth;
      const lat=clamp(lat0+north/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
      const lon=wrapLongitudeRadians(lon0+east/(WORLD_RADIUS_METERS*cosLat0));
      const sample=mixSample(ux,vz);
      const base=Array.isArray(sample?.color)?sample.color:(sample?.land?[.28,.46,.20]:[.06,.22,.42]);
      const elevation=Number(sample?.elevationMeters||0);
      const relief=clamp(elevation/5200,0,1);
      // World-space frequencies are anchored to continuous world meters, so
      // finer LODs reveal more source information instead of magnifying a
      // normalized UV pattern. Land/water and elevation remain authoritative.
      const worldEast=worldEastOrigin+east,worldNorth=worldNorthOrigin+north;
      const macro=worldSurfaceDetailValue(worldEast,worldNorth,metersPerTexel,phase);
      let shade=1,cover=[0,0,0];
      if(sample?.land){
        // Hillshade of authoritative elevation + scale-appropriate detail relief.
        const step=metersPerTexel,dux=step/spanEast,dvz=step/spanNorth;
        const h0=elevation+terrainDetailHeight(worldEast,worldNorth,metersPerTexel,detailSalt);
        const hx=Number(mixSample(Math.min(1,ux+dux),vz).elevationMeters||0)+terrainDetailHeight(worldEast+step,worldNorth,metersPerTexel,detailSalt);
        const hy=Number(mixSample(ux,Math.max(0,vz-dvz)).elevationMeters||0)+terrainDetailHeight(worldEast,worldNorth+step,metersPerTexel,detailSalt);
        const exaggeration=2.2,gx=(hx-h0)/step*exaggeration,gy=(hy-h0)/step*exaggeration,nl=Math.hypot(gx,gy,1);
        const lit=(-gx*light[0]-gy*light[1]+light[2])/nl;
        shade=clamp(1+(lit-flatShade)*1.25,.62,1.32);
        cover=landCoverTint(worldEast,worldNorth,metersPerTexel,detailSalt,elevation);
      }
      const identityTint=sample?.land?[relief*.075,relief*.065,relief*.035]:[-.012,-.004,.028];
      const contour=.5+.5*Math.sin((elevation/420)*Math.PI*2);
      const contourLine=Math.pow(1-contour,10)*contourStrength;
      const authoritative=base.map((v,i)=>clamp((v+macro*(i===2?.70:1)+identityTint[i]+cover[i]-contourLine*(i===2?.55:1))*shade,0,1));
      let displayColor=authoritative;
      if(useMicroDetail){const micro=localSurfaceSample(east,north,sample).color;displayColor=authoritative.map((v,i)=>clamp(v*.62+micro[i]*.38,0,1));}
      const rgba=rgbaFromColor(displayColor),i=(y*size+x)*4;
      const edgeDistance=Math.min(ux,1-ux,vz,1-vz);
      data[i]=rgba[0];data[i+1]=rgba[1];data[i+2]=rgba[2];data[i+3]=featherEdges?Math.round(255*smoothstep01(clamp(edgeDistance/.18,0,1))):255;
    }
    yield 1;
  }
  return {data,size,metersPerTexel};
}
function* localResourceSteps(job){
  const meshData=yield* tangentMeshSteps(job);
  const size=LOCAL_DETAIL_LEVELS[job.levelIndex].textureSize;
  const detail=yield* surfaceTextureSteps(job,job.dims.patchWidth,job.dims.patchHeight,size,true);
  const surround=yield* surfaceTextureSteps(job,job.dims.patchWidth*3,job.dims.patchHeight*3,size,false);
  return {meshData,detail,surround};
}
function textureFromPixels(pixels){
  const canvas2d=document.createElement("canvas");canvas2d.width=pixels.size;canvas2d.height=pixels.size;
  const ctx=canvas2d.getContext("2d",{alpha:false});ctx.putImageData(new ImageData(pixels.data,pixels.size,pixels.size),0,0);
  const texture=new pc.Texture(device,{width:pixels.size,height:pixels.size,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
  texture.addressU=pc.ADDRESS_CLAMP_TO_EDGE;texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;
  texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;texture.magFilter=pc.FILTER_LINEAR;texture.anisotropy=localTextureAnisotropy();texture.setSource(canvas2d);
  return texture;
}
function skirtMeshForDims(dims,spanFactor=3){
  const halfX=dims.patchWidth*spanFactor*.5/dims.metersPerUnit,halfZ=dims.patchHeight*spanFactor*.5/dims.metersPerUnit,mesh=new pc.Mesh(device);
  mesh.setPositions([-halfX,0,-halfZ,halfX,0,-halfZ,-halfX,0,halfZ,halfX,0,halfZ]);
  mesh.setNormals([0,1,0,0,1,0,0,1,0,0,1,0]);mesh.setUvs(0,[0,0,1,0,0,1,1,1]);mesh.setIndices([0,2,1,1,2,3]);mesh.update();
  return mesh;
}
function finalizeLocalResource(job,result){
  const started=performance.now(),dims=job.dims,{meshData,detail,surround}=result;
  const mesh=new pc.Mesh(device);mesh.setPositions(meshData.positions);mesh.setNormals(meshData.normals);mesh.setUvs(0,meshData.uvs);mesh.setIndices(meshData.indices);mesh.update();
  mesh.incRefCount();// owned by the LRU cache, not by whichever MeshInstance shows it
  const skirtMesh=skirtMeshForDims(dims,3);skirtMesh.incRefCount();
  const detailTexture=textureFromPixels(detail),surroundTexture=textureFromPixels(surround),textureSize=detail.size;
  const detailMetersPerTexel=detail.metersPerTexel,surroundMetersPerTexel=surround.metersPerTexel;
  const vertices=meshData.positions.length/3,triangles=meshData.indices.length/3;
  const estimatedBytes=meshData.positions.byteLength+meshData.normals.byteLength+meshData.uvs.byteLength+meshData.indices.byteLength+textureSize*textureSize*4*2;
  const resource={signature:job.signature,levelIndex:job.levelIndex,dims,lat0:job.lat0,lon0:job.lon0,groundDetailWeight:job.groundDetailWeight,centerElevation:job.centerElevation,builtAsPrewarm:job.prewarm,mesh,skirtMesh,detailTexture,surroundTexture,estimatedBytes,
    detail:{active:true,level:dims.levelId,band:dims.band,sampleSpacingMeters:dims.sampleSpacingMeters,geometrySampleSpacingMeters:dims.sampleSpacingMeters,textureSize,sourceTextureWidth:textureSize,sourceTextureHeight:textureSize,detailMetersPerTexel:Number(detailMetersPerTexel.toFixed(3)),surroundMetersPerTexel:Number(surroundMetersPerTexel.toFixed(3)),anisotropy:localTextureAnisotropy(),minFilter:"linear-mipmap-linear",magFilter:"linear",detailBandCount:surfaceDetailBandCount(detailMetersPerTexel),surroundDetailBandCount:surfaceDetailBandCount(surroundMetersPerTexel),
      visibleWidthMeters:dims.visibleWidth,visibleHeightMeters:dims.visibleHeight,patchWidthMeters:dims.patchWidth,patchHeightMeters:dims.patchHeight,columns:meshData.columns,rows:meshData.rows,vertices,triangles,estimatedBytes,buildTimeMs:Number(job.busyMs.toFixed(3)),activePatchCount:1,signature:job.signature}};
  localResourceCache.set(job.signature,resource);
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
  for(const [key,resource] of localResourceCache){
    if(localResourceCache.size<=LOCAL_RESOURCE_CACHE_LIMIT)break;
    if(resource===displayResource)continue;// never evict what is on screen
    localResourceCache.delete(key);destroyCachedLocalResource(resource);
    localResources.evictions++;localResources.lastEvictionReason="bounded-lru";
  }
}
function localSignatureFor(index,lat,lon){
  const d=patchDimensionsForLevel(index);
  return [activeSeed,lat.toFixed(5),lon.toFixed(5),d.levelId,Math.ceil(d.patchWidth/d.sampleSpacingMeters),Math.ceil(d.patchHeight/d.sampleSpacingMeters)].join("|");
}
function startLocalJob(index,lat,lon,signature,prewarm){
  const dims=patchDimensionsForLevel(index),size=LOCAL_DETAIL_LEVELS[index].textureSize;
  const columns=Math.max(2,Math.ceil(dims.patchWidth/dims.sampleSpacingMeters)+1),rows=Math.max(2,Math.ceil(dims.patchHeight/dims.sampleSpacingMeters)+1);
  const job={token:++localPreparationToken,signature,levelIndex:index,dims,lat0:lat,lon0:lon,prewarm,groundDetailWeight:groundDetailWeightForLevel(index),centerElevation:Number(geography?.sampleLatLon?.(lat,lon)?.elevationMeters||0),
    totalSteps:rows+size*2,steps:0,busyMs:0,slices:0,maxSliceMs:0,startedAtMs:performance.now(),iterator:null};
  job.iterator=localResourceSteps(job);
  localJob=job;localResources.cacheMisses+=prewarm?0:1;
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
    localJob=null;localQueuedRequest=null;localResources.preparing=false;localResources.preparingSignature=null;localResources.preparingLevel=null;
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
  const lat=zoomState.focusLatitudeRadians,lon=zoomState.focusLongitudeRadians,signature=localSignatureFor(index,lat,lon);
  localResources.requestedSignature=signature;localResources.requestedLevel=LOCAL_DETAIL_LEVELS[index].id;
  if(displayResource?.signature===signature){localResources.pendingPreparationCount=0;return;}
  localResources.pendingPreparationCount=1;
  if(localResourceCache.has(signature)){activateLocalDetailResource(signature,true);return;}
  if(localJob){
    if(localJob.signature===signature){localJob.prewarm=false;localResources.preparingPrewarm=false;return;}
    // Let a nearly finished same-focus job land (it is still a closer/nearer
    // stand-in); otherwise cancel it and start on the latest request.
    const sameFocus=localJob.lat0===lat&&localJob.lon0===lon;
    if(sameFocus&&!localJob.prewarm&&localJob.steps/Math.max(1,localJob.totalSteps)>=.5){localQueuedRequest={index,lat,lon,signature};localResources.deferredRequests++;return;}
    localResources.cancelledPreparations++;localJob=null;
  }
  localQueuedRequest=null;
  startLocalJob(index,lat,lon,signature,false);
}
function scheduleLocalPrewarm(){
  if(localJob||!displayResource||projectionState.blend<=0)return;
  if(localResources.requestedSignature!==displayResource.signature)return;
  const lat=zoomState.focusLatitudeRadians,lon=zoomState.focusLongitudeRadians,index=displayResource.levelIndex;
  for(const candidate of [index+lastZoomDirection,index-lastZoomDirection]){
    if(candidate<0||candidate>=LOCAL_DETAIL_LEVELS.length)continue;
    const signature=localSignatureFor(candidate,lat,lon);
    if(localResourceCache.has(signature))continue;
    startLocalJob(candidate,lat,lon,signature,true);return;
  }
}
// Double-buffered swap: only a fully prepared resource becomes visible.
function activateLocalDetailResource(signature,fromCache){
  if(!tangentPatch?.render||!device||!tangentPatchMaterial||!horizonSkirtMaterial)return false;
  const resource=localResourceCache.get(signature);if(!resource)return false;
  const swapStarted=performance.now();
  localResourceCache.delete(signature);localResourceCache.set(signature,resource);
  if(fromCache){localResources.cacheHits++;if(resource.builtAsPrewarm)localResources.prewarmHits++;}
  displayResource=resource;
  localDetail={...resource.detail,rebuildCount:(localDetail.rebuildCount||0)+1};
  tangentPatch.render.meshInstances=[new pc.MeshInstance(resource.mesh,tangentPatchMaterial,tangentPatch)];
  tangentPatchMaterial.diffuseMap=resource.detailTexture;tangentPatchMaterial.emissiveMap=resource.detailTexture;tangentPatchMaterial.opacityMap=resource.detailTexture;tangentPatchMaterial.opacityMapChannel="a";tangentPatchMaterial.blendType=pc.BLEND_NORMAL;tangentPatchMaterial.depthWrite=false;tangentPatchMaterial.update();
  if(horizonSkirt?.render){
    horizonSkirt.render.meshInstances=[new pc.MeshInstance(resource.skirtMesh,horizonSkirtMaterial,horizonSkirt)];
    localResources.surroundSpanFactor=3;localResources.surroundWidthMeters=Number((resource.dims.patchWidth*3).toFixed(3));localResources.surroundHeightMeters=Number((resource.dims.patchHeight*3).toFixed(3));localResources.surroundWorldMatched=true;
  }
  horizonSkirtMaterial.diffuseMap=resource.surroundTexture;horizonSkirtMaterial.emissiveMap=resource.surroundTexture;horizonSkirtMaterial.diffuse.set(1,1,1);horizonSkirtMaterial.emissive.set(1,1,1);horizonSkirtMaterial.emissiveIntensity=.98;horizonSkirtMaterial.update();
  rebuildLocalStaticPresentation(resource);
  trimLocalResourceCache();
  localResources.activeSignature=signature;localResources.visibleLevel=resource.dims.levelId;localResources.activeResourceCount=1;localResources.cachedResourceCount=localResourceCache.size;
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
  tangentPatchMaterial=new pc.StandardMaterial();tangentPatchMaterial.name="SeededTangentSurface";tangentPatchMaterial.diffuse.set(1,1,1);tangentPatchMaterial.emissive.set(1,1,1);tangentPatchMaterial.emissiveIntensity=.72;tangentPatchMaterial.useLighting=false;tangentPatchMaterial.cull=pc.CULLFACE_NONE;tangentPatchMaterial.roughness=.9;tangentPatchMaterial.update();
  tangentPatch=new pc.Entity("LocalTangentSurface");tangentPatch.addComponent("render",{type:"asset",castShadows:false,receiveShadows:true});
  // Empty until the first cooperatively prepared resource is swapped in.
  tangentPatch.render.meshInstances=[];
  tangentPatch.enabled=false;app.root.addChild(tangentPatch);
}
function ensureHorizonSkirt(){
  if(horizonSkirt||!device)return;
  horizonSkirtMaterial=new pc.StandardMaterial();horizonSkirtMaterial.name="LocalHorizonSkirt";
  horizonSkirtMaterial.diffuse.set(.2,.34,.17);horizonSkirtMaterial.emissive.set(.18,.30,.15);horizonSkirtMaterial.emissiveIntensity=1.08;
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
    tangentPatch.setLocalEulerAngles(0,0,0);
    const dims=localPatchDimensions(),level=LOCAL_DETAIL_LEVELS[dims.levelIndex];
    const shownHeightMeters=level.visibleHeightMeters/dims.presentationCompensation;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);
    projectionPresentation={...projectionPresentation,viewBlend,presentationCompensation:dims.presentationCompensation,patchScale,shownHeightMeters,targetHeightMeters:presentationTargetHeightMeters()};
    tangentPatch.setLocalScale(patchScale,patchScale,patchScale);
    // A stand-in prepared for a slightly different focus (after a pan) is
    // offset by the exact east/north delta so geography stays world-anchored.
    const offset=displayResource?localFocusOffsetMeters(displayResource):{east:0,north:0};
    tangentPatch.setLocalPosition(offset.east/dims.metersPerUnit*patchScale,0,-offset.north/dims.metersPerUnit*patchScale);
    const requestedIndex=requestedLodIndex,visibleIndex=displayResource?.levelIndex??requestedIndex;
    localResources.standInActive=Boolean(displayResource)&&localResources.requestedSignature!==displayResource.signature;
    localResources.standInMagnification=Number(Math.max(1,dims.presentationCompensation).toFixed(4));
    localResources.visibleLevel=displayResource?.dims.levelId??null;
    localResources.requestedLevelIndex=requestedIndex;localResources.visibleLevelIndex=displayResource?visibleIndex:null;
    if(horizonSkirt){
      // The 3x world-matched continuation shares the patch scale so coast and
      // relief bearings line up; stand-in shrink is bounded (1/3) so it still
      // covers the viewport.
      const surroundScale=patchScale;
      horizonSkirt.setLocalScale(surroundScale,surroundScale,surroundScale);
      horizonSkirt.setLocalPosition(offset.east/dims.metersPerUnit*surroundScale,-.012,-offset.north/dims.metersPerUnit*surroundScale);
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
  // Keep the globe camera outside the displaced planetary mesh throughout this
  // foundation WP. Later projection-transition WPs take over before true
  // ground-scale rendering; entering the sphere here produces blank/inverted
  // frames and breaks continuous visual focus.
  const safeSurfaceDistance=DISPLAY_RADIUS_UNITS*1.42;
  const travel=Math.max(0,zoomState.baseCameraDistance-safeSurfaceDistance);
  const distance=safeSurfaceDistance+travel*Math.pow(1-scalar,2.15);
  zoomState.cameraDistance=distance;zoomState.requestedBand=zoomBandFor(scalar);
  updateProjectionState();
  const blend=projectionState.blend;
  updateLocalRequest();
  scheduleLocalStaticPresentationRefresh();
  const globeZ=distance;
  const viewBlend=blend;
  const localZ=6.20;
  const localY=5.00;
  // Projection flattening and camera orientation are intentionally independent.
  // Keep map-scale zoom radial/top-down through the country/regional bands, then
  // introduce the gameplay oblique view gradually across the local approach.
  // This prevents a small wheel/pinch step around 0.06x-0.08x from behaving
  // like camera rotation while preserving the same spherical focus anchor.
  // Gameplay oblique tilt starts at the same ~5 km footprint as before the
  // log-uniform ladder rebalance.
  const orientationStart=ladderState().orientationStart;
  const orientationEnd=1.0;
  const orientationRaw=clamp((scalar-orientationStart)/(orientationEnd-orientationStart),0,1);
  const angleBlend=smoothstep01(orientationRaw);
  const handoff=projectionHandoffForZoom(scalar);
  const representationBlend=displayResource?projectionPresentationBlendForZoom(scalar):0;
  const tangentVisible=representationBlend>.02;
  // The tangent patch lies in X/Z. Once it becomes the visible representation,
  // view it from above; keeping the old globe-front camera at Y~=0 makes the
  // horizontal patch appear as a horizon strip. The later gameplay oblique
  // transition is independent and begins only at orientationStart.
  const mapY=8.0,mapZ=.35;
  const tangentZ=lerp(mapZ,localZ,angleBlend);
  const tangentY=lerp(mapY,localY,angleBlend);
  // Smoothly move from the globe-front camera to the tangent-map camera.
  // Zoom alone must never cause a discrete camera relocation.
  const cameraZ=lerp(globeZ,tangentZ,representationBlend);
  const cameraY=lerp(0,tangentY,representationBlend);
  const targetZ=0;
  const targetY=lerp(0,lerp(0,-.12,angleBlend),representationBlend);
  cameraEntity.setLocalPosition(0,cameraY,cameraZ);cameraEntity.lookAt(0,targetY,targetZ);
  const fov=34+12*angleBlend;if(cameraEntity.camera)cameraEntity.camera.fov=fov;
  const lookLength=Math.max(.000001,Math.hypot(cameraY-targetY,cameraZ-targetZ));
  const lookVector=Object.freeze([0,Number(((targetY-cameraY)/lookLength).toFixed(6)),Number(((targetZ-cameraZ)/lookLength).toFixed(6))]);
  // Presentation pitch is 0 degrees for radial/top-down map viewing and grows
  // only as the later local gameplay oblique camera is introduced.
  const mapPitchBaseline=Math.atan2(mapZ,mapY)*180/Math.PI;
  const cameraPitchDegrees=tangentVisible?Number(Math.max(0,Math.atan2(Math.abs(cameraZ-targetZ),Math.max(.000001,Math.abs(cameraY-targetY)))*180/Math.PI-mapPitchBaseline).toFixed(3)):0;
  projectionPresentation={...projectionPresentation,viewBlend,handoff,representationBlend,angleBlend,orientationStart,orientationEnd,cameraY,cameraZ,fov,cameraPitchDegrees,lookVector,cameraTarget:Object.freeze([0,targetY,targetZ])};
  const focusDistance=Math.hypot(cameraY-targetY,cameraZ-targetZ);
  const rect=canvas?.getBoundingClientRect?.(),aspect=Math.max(.1,(rect?.width||1)/(rect?.height||1));
  const visibleHeightUnits=2*focusDistance*Math.tan(fov*Math.PI/360);
  updateProjectionPresentation(visibleHeightUnits);
  const tangentOwnsView=blend>LOCAL_TANGENT_OWNERSHIP_BLEND&&Boolean(displayResource);
  // Footprint (and therefore the ruler) is what is actually on screen: the
  // globe camera's surface footprint, or the height the tangent patch shows.
  const footprintHeight=tangentOwnsView?projectionPresentation.shownHeightMeters:globeSurfaceFootprintHeightMeters(scalar);
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
  const cosLat=Math.max(.08,Math.cos(zoomState.focusLatitudeRadians));
  return {east:wrapLongitudeRadians(resource.lon0-zoomState.focusLongitudeRadians)*WORLD_RADIUS_METERS*cosLat,north:(resource.lat0-zoomState.focusLatitudeRadians)*WORLD_RADIUS_METERS};
}
function setZoomScalar(value){
  const next=clamp(value,ZOOM_MIN,ZOOM_MAX);
  if(Math.abs(next-zoomState.scalar)<1e-7)return snapshot();
  lastZoomDirection=next>zoomState.scalar?1:-1;
  zoomState.scalar=next;zoomState.zoomChanges++;applyCameraZoom();return snapshot();
}
function zoomBy(delta){return setZoomScalar(zoomState.scalar+Number(delta||0));}
function applyRotation(){
  if(!planet)return;
  planet.setLocalEulerAngles(pitchDegrees,yawDegrees,0);
  updateZoomFocusFromRotation();
  rotationChangeCount++;  if(zoomState.scalar<=projectionState.transitionStart)updateMapPresentation();
}
function setRotation(yaw,pitch){
  yawDegrees=normalizeYaw(yaw);
  pitchDegrees=clamp(pitch,-82,82);
  applyRotation();
  if(zoomState.scalar>projectionState.transitionStart)applyCameraZoom();
  return snapshot();
}
function rotateBy(deltaYaw,deltaPitch){
  return setRotation(yawDegrees+Number(deltaYaw||0),pitchDegrees+Number(deltaPitch||0));
}
function rotationForLatLon(latitudeRadians,longitudeRadians){
  return Object.freeze({
    yawDegrees:normalizeYaw(-longitudeRadians*180/Math.PI),
    pitchDegrees:clamp(latitudeRadians*180/Math.PI,-78,78)
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

  await runSlicedRange(TEXTURE_WIDTH*TEXTURE_HEIGHT,index=>{
    const py=Math.floor(index/TEXTURE_WIDTH),px=index-py*TEXTURE_WIDTH;
    const v=(py+0.5)/TEXTURE_HEIGHT;
    const lat=(0.5-v)*Math.PI;
    const u=(px+0.5)/TEXTURE_WIDTH;
    const lon=(u-0.5)*Math.PI*2;
    const sample=geography.sampleLatLon(lat,lon);
    const rgba=rgbaFromColor(sample.color);
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
function currentViewTarget(){return {latitudeRadians:pitchDegrees*Math.PI/180,longitudeRadians:-yawDegrees*Math.PI/180};}
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
      uvs.push(u,1-v);normals.push(0,0,0);
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
  if(record.type==="npc")return [readable(record.name,"Unknown resident"),readable(record.job,"Unassigned"),readable(record.activity,"Activity unavailable")];
  const functionLabel=String(record.functionLabel??"").trim(),buildingType=String(record.buildingType??"").trim(),typeLabel=functionLabel||buildingType||"Building",name=String(record.name??"").trim();
  return name&&name!==typeLabel?[name,typeLabel]:[typeLabel];
}
function renderInspectionTooltip(record,knownBounds=null){
  let tip=root?.querySelector?.(".world-inspection-tooltip");if(!tip){tip=document.createElement("aside");tip.className="world-inspection-tooltip";tip.setAttribute("role","status");root.appendChild(tip);}
  const started=performance.now();let bounds=knownBounds;try{if(bounds===null)bounds=record.screenBounds();}catch{bounds=null;}
  if(!bounds||![bounds.left,bounds.right,bounds.top,bounds.bottom].every(Number.isFinite)||bounds.left>bounds.right||bounds.top>bounds.bottom){dismissInspection();return false;}
  const now=performance.now(),lines=readableInspectionLines(record),contentKey=lines.join("\u001f"),recordKey=inspectionRegistryKey(record.type,record.id);
  const selectionChanged=tip.dataset.recordKey!==recordKey;
  if(tip.dataset.contentKey!==contentKey&&(selectionChanged||tip.dataset.contentKey===undefined||now-inspection.lastContentRefreshAtMs>=250)){
    tip.replaceChildren();lines.forEach((line,index)=>{const el=document.createElement(index===0?"strong":"span");el.textContent=line;tip.appendChild(el);});
    tip.dataset.contentKey=contentKey;inspection.contentRefreshes++;inspection.lastContentRefreshAtMs=now;
  }
  if(selectionChanged)tip.dataset.recordKey=recordKey;
  const rootRect=root.getBoundingClientRect(),anchorX=(bounds.left+bounds.right)/2-rootRect.left,anchorY=bounds.top-rootRect.top;
  tip.style.visibility="hidden";tip.style.left="0px";tip.style.top="0px";
  const tipRect=tip.getBoundingClientRect(),halfWidth=Math.min(rootRect.width/2,tipRect.width/2),margin=12;
  const x=clamp(anchorX,margin+halfWidth,Math.max(margin+halfWidth,rootRect.width-margin-halfWidth));
  const placeBelow=anchorY-tipRect.height-margin<margin,y=placeBelow?clamp(anchorY+margin,margin,Math.max(margin,rootRect.height-tipRect.height-margin)):clamp(anchorY-tipRect.height-margin,margin,Math.max(margin,rootRect.height-tipRect.height-margin));
  tip.classList.toggle("below-anchor",placeBelow);tip.style.left=x+"px";tip.style.top=y+"px";tip.style.visibility="";inspection.tooltipUpdates++;inspection.lastTooltipUpdateMs=Number((performance.now()-started).toFixed(3));return true;
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
  canvas.addEventListener("wheel",event=>{zoomState.wheelEvents++;zoomBy(-event.deltaY*ZOOM_WHEEL_SENSITIVITY);event.preventDefault();},{passive:false});
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
    if(activePointers.size>=2){const pts=Array.from(activePointers.values()).slice(0,2),distance=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);if(lastPinchDistance!==null){zoomState.pinchEvents++;zoomBy((distance-lastPinchDistance)*ZOOM_PINCH_SENSITIVITY);}lastPinchDistance=distance;event.preventDefault();return;}
    if(!dragging||event.pointerId!==pointerId)return;
    const dx=event.clientX-lastPointerX,dy=event.clientY-lastPointerY;
    inspection.dragDistance=Math.max(inspection.dragDistance,Math.hypot(event.clientX-inspection.pointerDownX,event.clientY-inspection.pointerDownY));
    lastPointerX=event.clientX;lastPointerY=event.clientY;
    rotateBy(dx*0.34,dy*0.26);event.preventDefault();
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
    if(event.key==="ArrowLeft")rotateBy(-6,0);
    else if(event.key==="ArrowRight")rotateBy(6,0);
    else if(event.key==="ArrowUp")rotateBy(0,-6);
    else if(event.key==="ArrowDown")rotateBy(0,6);
    else if(event.key==="+"||event.key==="=")zoomBy(.06);
    else if(event.key==="-"||event.key==="_")zoomBy(-.06);
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
    const alpha=Math.round(clamp((field-.12)*260,0,112));const i=(y*source.width+x)*4;
    data[i]=232;data[i+1]=241;data[i+2]=246;data[i+3]=alpha;
  }
  ctx.putImageData(image,0,0);
  const texture=new pc.Texture(device,{width:source.width,height:source.height,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
  texture.name="SeededPlanetClouds";texture.addressU=pc.ADDRESS_REPEAT;texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;texture.magFilter=pc.FILTER_LINEAR;texture.setSource(source);return texture;
}
function buildAmbientMotion(surfaceMesh){
  const material=new pc.StandardMaterial();const texture=makeCloudTexture();
  material.name="SeededCloudLayer";material.diffuse.set(1,1,1);material.emissive.set(.72,.78,.84);material.emissiveMap=texture;material.emissiveIntensity=.9;material.opacityMap=texture;material.opacityMapChannel="a";material.opacity=.58;material.blendType=pc.BLEND_NORMAL;material.depthWrite=false;material.cull=pc.CULLFACE_BACK;material.useLighting=false;material.update();
  cloudLayer=new pc.Entity("AmbientCloudLayer");cloudLayer.setLocalScale(1.018,1.018,1.018);cloudLayer.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});cloudLayer.render.meshInstances=[new pc.MeshInstance(surfaceMesh,material,cloudLayer)];planet.addChild(cloudLayer);
  ambientMotion={...ambientMotion,cloudLayerCount:1,animatedEntityCount:1,drawCallEstimate:1};
}
function updateAmbientMotion(dt){
  if(!ambientMotion.enabled||!cloudLayer||dragging)return;
  const started=performance.now();ambientMotion.cloudYawDegrees=(ambientMotion.cloudYawDegrees+Math.min(.12,Math.max(0,Number(dt)||0))*2.4)%360;
  cloudLayer.setLocalEulerAngles(0,ambientMotion.cloudYawDegrees,0);ambientMotion.updateCount++;ambientMotion.lastUpdateMs=performance.now()-started;ambientMotion.maxUpdateMs=Math.max(ambientMotion.maxUpdateMs,ambientMotion.lastUpdateMs);
}
function lerp(a,b,t){return a+(b-a)*t;}
function mixRgb(a,b,t){return a.map((v,i)=>lerp(v,b[i],t));}
function fantasyHourFromStamp(stamp){
  if(stamp&&typeof stamp==="object"&&Number.isFinite(Number(stamp.hour)))return ((Number(stamp.hour)%24)+24)%24+clamp(Number(stamp.minute||0),0,59)/60;
  const m=/(?:T|\s)(\d{1,2}):(\d{2})/.exec(String(stamp||""));return m?((Number(m[1])%24)+24)%24+clamp(Number(m[2]),0,59)/60:null;
}
function paletteForHour(hour){
  const stops=[
    {h:0,phase:"night",key:[.50,.62,.92],fill:[.24,.34,.64],ambient:[.20,.23,.36],sky:[.012,.024,.072],keyI:.78,fillI:.72,emissive:.090},
    {h:5,phase:"dawn",key:[1,.68,.42],fill:[.40,.44,.68],ambient:[.36,.30,.34],sky:[.12,.075,.14],keyI:1.18,fillI:.82,emissive:.080},
    {h:8,phase:"day",key:[1,.93,.72],fill:[.36,.54,.82],ambient:[.42,.46,.54],sky:[.018,.045,.09],keyI:1.38,fillI:.90,emissive:.025},
    {h:12,phase:"day",key:[1,.97,.90],fill:[.34,.50,.78],ambient:[.40,.43,.50],sky:[.004,.008,.018],keyI:1.50,fillI:.94,emissive:.022},
    {h:17,phase:"late-day",key:[1,.78,.48],fill:[.46,.42,.70],ambient:[.38,.32,.40],sky:[.085,.052,.105],keyI:1.30,fillI:.86,emissive:.070},
    {h:20,phase:"night",key:[.60,.68,.98],fill:[.27,.38,.70],ambient:[.24,.27,.40],sky:[.018,.03,.082],keyI:.88,fillI:.76,emissive:.085},
    {h:24,phase:"night",key:[.50,.62,.92],fill:[.24,.34,.64],ambient:[.20,.23,.36],sky:[.012,.024,.072],keyI:.78,fillI:.72,emissive:.090}
  ];
  let a=stops[0],b=stops[1];for(let i=0;i<stops.length-1;i++){if(hour>=stops[i].h&&hour<=stops[i+1].h){a=stops[i];b=stops[i+1];break;}}
  const t=clamp((hour-a.h)/Math.max(.001,b.h-a.h),0,1),phase=(t<.5?a.phase:b.phase);
  return {phase,key:mixRgb(a.key,b.key,t),fill:mixRgb(a.fill,b.fill,t),ambient:mixRgb(a.ambient,b.ambient,t),sky:mixRgb(a.sky,b.sky,t),keyI:lerp(a.keyI,b.keyI,t),fillI:lerp(a.fillI,b.fillI,t),emissive:lerp(a.emissive,b.emissive,t)};
}
function applyAuthoritativeFantasyTime(stamp,source="authoritative-fantasy-time"){
  const hour=fantasyHourFromStamp(stamp);if(hour===null||!keyLight||!fillLight||!surfaceMaterial||!cameraEntity)return snapshot();
  const p=paletteForHour(hour);
  keyLight.light.color.set(...p.key);keyLight.light.intensity=p.keyI;fillLight.light.color.set(...p.fill);fillLight.light.intensity=p.fillI;
  app.scene.ambientLight.set(...p.ambient);cameraEntity.camera.clearColor.set(...p.sky);const emissiveTint=p.phase==="night"?[.52,.72,1]:p.phase==="dawn"?[1,.66,.42]:p.phase==="late-day"?[1,.58,.34]:[1,.96,.84];surfaceMaterial.emissive.set(p.emissive*emissiveTint[0],p.emissive*emissiveTint[1],p.emissive*emissiveTint[2]);surfaceMaterial.update();
  atmosphere={active:true,authoritativeHour:Number(hour.toFixed(3)),phase:p.phase,source:String(source),dynamicLightCount:2,materialCount:1,drawCallImpact:0,simulationAuthority:false,keyIntensity:Number(p.keyI.toFixed(3)),fillIntensity:Number(p.fillI.toFixed(3)),ambient:p.ambient.map(v=>Number(v.toFixed(3))),sky:p.sky.map(v=>Number(v.toFixed(3)))};
  return snapshot();
}
async function buildScene(){  const started=performance.now();
  setStartupProgress("geography","Generating continents, oceans and islands…",52);
  if(!window.PlanetGeography)throw new Error("PlanetGeography is unavailable");
  activeSeed=window.PlanetGeography.resolveSeed();
  geography=window.PlanetGeography.create(activeSeed);
  geographySignature=geography.signature();
  geographyVerification=null;
  setStartupProgress("surface","Painting planetary surface and relief…",68);

  app.scene.ambientLight=new pc.Color(0.34,0.37,0.43);

  cameraEntity=new pc.Entity("PlanetCamera");
  cameraEntity.addComponent("camera",{
    clearColor:new pc.Color(0.004,0.008,0.018),
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
    app.on?.("update",dt=>{frameCount++;recordLocalFrame(dt);updateInspectionTooltip();updateAmbientMotion(dt);});
    await measuredPhase("appStartMs",async()=>app.start());
    await measuredPhase("localShaderWarmupMs",()=>warmLocalRepresentationShaders());

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
      wheelSensitivity:ZOOM_WHEEL_SENSITIVITY,pinchSensitivity:ZOOM_PINCH_SENSITIVITY,zoomInputRateFraction:.5
    }),
    canonicalFocus:Object.freeze({
      latitudeDegrees:Number((zoomState.focusLatitudeRadians*180/Math.PI).toFixed(6)),
      longitudeDegrees:Number((zoomState.focusLongitudeRadians*180/Math.PI).toFixed(6)),
      sphericalVector:tangentFrame(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians).up,
      worldTile:mapWorldTileAt(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians),
      tangentOriginMeters:projectionState.tangentOrigin,
      activeLodOriginMeters:projectionState.tangentOrigin,
      screenSpaceTargetPercent:Object.freeze([50,50]),
      screenSpaceFocusDeltaPixels:0,
      authority:"rotation-derived-canonical-latlon",
      zoomMayRelocateFocus:false,
      surfaceIdentity:canonicalSurfaceIdentity()
    }),
    zoom:Object.freeze({
      scalar:Number(zoomState.scalar.toFixed(6)),band:zoomState.band,requestedBand:zoomState.requestedBand||zoomState.band,visibleBand:zoomState.band,
      requestedLevel:localResources.requestedLevel,visibleLevel:localResources.visibleLevel,
      focusLatitudeDegrees:Number((zoomState.focusLatitudeRadians*180/Math.PI).toFixed(6)),
      focusLongitudeDegrees:Number((zoomState.focusLongitudeRadians*180/Math.PI).toFixed(6)),
      cameraDistance:Number(zoomState.cameraDistance.toFixed(6)),
      baseCameraDistance:Number(zoomState.baseCameraDistance.toFixed(6)),
      visibleFootprintWidthMeters:Number(zoomState.visibleFootprintWidthMeters.toFixed(3)),
      visibleFootprintHeightMeters:Number(zoomState.visibleFootprintHeightMeters.toFixed(3)),
      wheelEvents:zoomState.wheelEvents,pinchEvents:zoomState.pinchEvents,zoomChanges:zoomState.zoomChanges,
      bands:ZOOM_BANDS.map(b=>b.id),detailLevels:LOCAL_DETAIL_LEVELS.map(level=>level.id),sameSphericalAuthority:true,
      ladder:Object.freeze({startScalar:LADDER_START_SCALAR,startHeightMeters:Number(ladderState().startHeight.toFixed(1)),groundHeightMeters:GROUND_FOOTPRINT_HEIGHT_METERS,levelMaxScalars:ladderState().levelMax.slice(),logUniformBelowStart:true})
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
      worldTileProjection:Object.freeze({...planetWorldAnchor(),roundTripOrigin:mapWorldTileAt(worldLatLonForTile("0","0").latitudeRadians,worldLatLonForTile("0","0").longitudeRadians),tileMeters:Number(window.WorldStandards?.TILE_METERS||2)}),
      tangentPatchActive:Boolean(tangentPatch?.enabled),
      tangentPatchDerivedFromFocus:true,
      tangentPatchSpanMeters:Math.max(localDetail.patchWidthMeters,localDetail.patchHeightMeters),
      localDetail:Object.freeze({...localDetail,viewportBounded:true,fullWorldMaterialized:false}),
      localStatic:Object.freeze({...localStatic,focusLatitudeDegrees:Number((zoomState.focusLatitudeRadians*180/Math.PI).toFixed(6)),focusLongitudeDegrees:Number((zoomState.focusLongitudeRadians*180/Math.PI).toFixed(6)),visibleFootprintWidthMeters:Number(zoomState.visibleFootprintWidthMeters.toFixed(3)),visibleFootprintHeightMeters:Number(zoomState.visibleFootprintHeightMeters.toFixed(3))}),
      resourceBudget:Object.freeze({...localResources,cacheLimit:LOCAL_RESOURCE_CACHE_LIMIT,lodHysteresis:LOCAL_LOD_HYSTERESIS,offscreenFineDetailActive:false,viewportPriority:true}),
      presentation:Object.freeze({...projectionPresentation})
    }),
    activeSystems:Object.freeze({
      protagonistEnabled:false,
      npcEnabled:false,
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
    wilderness:Object.freeze({...wilderness}),
    inspection:Object.freeze({...inspection,activePickableCount:inspectionPickables.size,activeNpcCount:Array.from(inspectionPickables.values()).filter(x=>x.type==="npc").length,activeBuildingCount:Array.from(inspectionPickables.values()).filter(x=>x.type==="building").length,boundedActiveRegistry:true,fullWorldScan:false}),
    destinationNavigator:Object.freeze({open:destinationNavigator.open,category:destinationNavigator.category,resultCount:destinationNavigator.descriptors.filter(d=>destinationNavigator.category==="all"||d.category===destinationNavigator.category).length,totalDescriptorCount:destinationNavigator.descriptors.length,categories:Array.from(new Set(destinationNavigator.descriptors.map(d=>d.category))),types:Array.from(new Set(destinationNavigator.descriptors.map(d=>d.type))),selectedId:destinationNavigator.selectedId,queryCount:destinationNavigator.queryCount,lastQueryMs:destinationNavigator.lastQueryMs,navigationCount:destinationNavigator.navigationCount,lastTarget:destinationNavigator.lastTarget,queryCenter:Object.freeze({latitudeDegrees:Number(pitchDegrees.toFixed(3)),longitudeDegrees:Number((-yawDegrees).toFixed(3))}),boundedQuery:true,descriptorLimit:16,fullWorldScan:false,cameraOnly:true,localChunkMaterialization:false}),
    mapPresentation:Object.freeze({...mapPresentation}),
    politicalScale:politicalScaleEvidence(),
    startupError,
    startupProgress:Object.freeze({...startupProgress,loadingProofActive:Boolean(loadingProof)}),
    loadingPresentation:Object.freeze({...((loadingProof||startupProgress)),loadingProofActive:Boolean(loadingProof)}),
    startupScheduler:Object.freeze({...startupScheduler,progressMonotonic:true,sharedCooperativeScheduler:true,criticalPathOnly:true})
  });
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
  app?.destroy?.();
  app=null;device=null;pc=null;planet=null;cameraEntity=null;canvas=null;localStaticRoot=null;localStaticMaterials=null;ready=false;
  inspectionPickables.clear();
  inspection={selectedId:null,selectedType:null,pointerDownX:0,pointerDownY:0,dragDistance:0,pickQueries:0,lastPickCandidateCount:0,lastPickQueryMs:0,tooltipUpdates:0,lastTooltipUpdateMs:0,contentRefreshes:0,lastContentRefreshAtMs:0,dismissCount:0};
  geography=null;politicalScaleEvidenceCache=null;worldProjectionAnchorCache=null;settlementRevealCache={key:null,value:null};atlasLabelCache={key:null,candidates:[],queryCellCount:0,buildMs:0};atlasEntityCache.clear();atlasIdentityCache.clear();localStaticRefreshScheduled=false;projectionPresentation={viewBlend:0,angleBlend:0,presentationCompensation:1,patchScale:0,cameraY:0,cameraZ:0,fov:34,targetHeightMeters:650000};root?.replaceChildren?.();
}
window.PlanetStage=Object.freeze({
  VERSION,start,snapshot,verify,setRotation,rotateBy,setViewTarget,setWorldTileFocus,worldLatLonForTile,rotationForLatLon,setZoomScalar,zoomBy,scalarForFootprintHeight:(heightMeters)=>Number(scalarForFootprintHeight(heightMeters).toFixed(6)),setLoadingProof,clearLoadingProof,applyAuthoritativeFantasyTime,openPlaces:()=>{destinationNavigator.open=true;renderDestinationNavigator();return snapshot();},closePlaces:()=>{destinationNavigator.open=false;renderDestinationNavigator();return snapshot();},registerInspectionPickable,unregisterInspectionPickable,dismissInspection,pickInspection,
  setPlacesCategory:(category)=>{destinationNavigator.category=["all","settlements","cities","historical","hunting","fishing","landmark","nature","water"].includes(category)?category:"all";renderDestinationNavigator();return snapshot();},selectPlace:(id)=>{const d=destinationNavigator.descriptors.find(x=>x.id===id);if(d){destinationNavigator.selectedId=d.id;destinationNavigator.navigationCount++;destinationNavigator.lastTarget={id:d.id,name:d.name,latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees};setViewTarget(d);renderDestinationNavigator();}return snapshot();},destroy,
  constants:Object.freeze({
    EARTH_REFERENCE_RADIUS_METERS,WORLD_SCALE_FRACTION,WORLD_RADIUS_METERS,WORLD_DIAMETER_METERS,
    WORLD_CIRCUMFERENCE_METERS:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3)),
    TEXTURE_WIDTH,TEXTURE_HEIGHT,LATITUDE_SEGMENTS,LONGITUDE_SEGMENTS,HEIGHT_EXAGGERATION,ZOOM_MIN,ZOOM_MAX,ZOOM_BANDS,LOCAL_DETAIL_LEVELS,LADDER_START_SCALAR,GROUND_FOOTPRINT_HEIGHT_METERS,ZOOM_WHEEL_SENSITIVITY,ZOOM_PINCH_SENSITIVITY,LOCAL_RESOURCE_CACHE_LIMIT,LOCAL_LOD_HYSTERESIS
  })
});
const boot=()=>start().catch(()=>{});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();