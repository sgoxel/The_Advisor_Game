(function(){
"use strict";

const VERSION="planet-ground-static-v3";
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
const ZOOM_BANDS=Object.freeze([{id:"planet",max:.18},{id:"continent",max:.38},{id:"country-region",max:.58},{id:"regional-overview",max:.70},{id:"regional-detail",max:.78},{id:"district",max:.86},{id:"local-area",max:.92},{id:"settlement",max:.97},{id:"near-ground",max:.995},{id:"ground",max:1}]);

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
let localStatic={active:false,signature:null,level:"inactive",roadCount:0,buildingCount:0,vegetationCount:0,waterCount:0,entityCount:0,triangleEstimate:0,drawCallEstimate:0,buildTimeMs:0,grounded:true,viewportBounded:true,authority:"spherical-seed-focus-presentation"};
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
let projectionState={mode:"globe",blend:0,transitionStart:.35,transitionEnd:.995,tangentOrigin:null,basis:null,cameraTarget:null,continuityErrorMeters:0};
const LOCAL_SAMPLE_SPACING_METERS=2;
const LOCAL_PATCH_MARGIN=1.50;
const LOCAL_RESOURCE_CACHE_LIMIT=4;
const LOCAL_LOD_HYSTERESIS=0.006;
const LOCAL_DETAIL_LEVELS=Object.freeze([
  Object.freeze({id:"regional-overview",max:.70,visibleHeightMeters:420000,sampleSpacingMeters:24000,reliefClampMeters:7000,reliefGain:11}),
  Object.freeze({id:"regional-detail",max:.78,visibleHeightMeters:140000,sampleSpacingMeters:8000,reliefClampMeters:7000,reliefGain:10}),
  Object.freeze({id:"district",max:.86,visibleHeightMeters:36000,sampleSpacingMeters:2400,reliefClampMeters:6000,reliefGain:9}),
  Object.freeze({id:"local-area",max:.92,visibleHeightMeters:8000,sampleSpacingMeters:250,reliefClampMeters:4200,reliefGain:7}),
  Object.freeze({id:"settlement",max:.97,visibleHeightMeters:1800,sampleSpacingMeters:60,reliefClampMeters:1600,reliefGain:4}),
  Object.freeze({id:"near-ground",max:.995,visibleHeightMeters:360,sampleSpacingMeters:12,reliefClampMeters:180,reliefGain:1.5}),
  Object.freeze({id:"ground",max:1,visibleHeightMeters:36,sampleSpacingMeters:LOCAL_SAMPLE_SPACING_METERS,reliefClampMeters:10,reliefGain:.35})
]);
const PRESENTATION_FOOTPRINT_ANCHORS=Object.freeze([
  Object.freeze({scalar:.35,heightMeters:650000}),
  Object.freeze({scalar:.60,heightMeters:520000}),
  Object.freeze({scalar:.70,heightMeters:400000}),
  Object.freeze({scalar:.78,heightMeters:300000}),
  Object.freeze({scalar:.86,heightMeters:180000}),
  Object.freeze({scalar:.92,heightMeters:80000}),
  Object.freeze({scalar:.97,heightMeters:20000}),
  Object.freeze({scalar:.995,heightMeters:2000}),
  Object.freeze({scalar:1,heightMeters:36})
]);
let localDetail={active:false,level:"inactive",sampleSpacingMeters:LOCAL_SAMPLE_SPACING_METERS,visibleWidthMeters:0,visibleHeightMeters:0,patchWidthMeters:0,patchHeightMeters:0,columns:0,rows:0,vertices:0,triangles:0,estimatedBytes:0,buildTimeMs:0,rebuildCount:0,activePatchCount:0,signature:null};
let localLodIndex=0;
const localResourceCache=new Map();
let localResources={activeSignature:null,cacheHits:0,cacheMisses:0,evictions:0,destroyedMeshes:0,destroyedTextures:0,activeResourceCount:0,cachedResourceCount:0,estimatedCacheBytes:0,culledOuterRepresentations:0,pendingPreparationCount:0,lastBuildMs:0,lastEvictionReason:null};
let mapPresentation={active:false,context:null,visibleContextKinds:[],visiblePlaceKinds:[],labelCount:0,borderVisible:false,borderSampleCount:0,borderSegmentCount:0,politicalOwnerCount:0,scaleDistanceMeters:0,scaleLabel:"",zoomScaleMultiplier:.01,zoomScaleLabel:"0.01x",updateCount:0,lastUpdateMs:0,lastBorderBuildMs:0,bounded:true,fullWorldScan:false};
let mapContextCache={key:null,value:null};
let mapBorderCache={key:null,segments:[],sampleCount:0,ownerCount:0,builtAtMs:0};
let projectionPresentation={viewBlend:0,angleBlend:0,presentationCompensation:1,patchScale:0,cameraY:0,cameraZ:0,fov:34,targetHeightMeters:650000};
let politicalScaleEvidenceCache=null;

function wrapLongitudeRadians(value){
  let lon=Number(value)||0;lon=((lon+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;return lon;
}
function mapWorldTileAt(latitudeRadians,longitudeRadians){
  const tileMeters=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
  return Object.freeze({
    x:String(Math.round(wrapLongitudeRadians(longitudeRadians)*WORLD_RADIUS_METERS/tileMeters)),
    y:String(Math.round(clamp(latitudeRadians,-Math.PI*.499999,Math.PI*.499999)*WORLD_RADIUS_METERS/tileMeters))
  });
}
function mapGeneratedName(kind,latitudeRadians,longitudeRadians){
  const stems=["Alder","Amber","Ashen","Bright","Cedar","Dawn","Elder","Falcon","Golden","Green","Grey","High","Iron","Lake","North","Oak","Raven","Red","River","Silver","Stone","Sun","Thorn","West","White","Wolf"];
  const tails={continent:["Reach","Land","March"],country:["Realm","Kingdom","March"],region:["Vale","Reach","Province"],city:["Hold","Gate","Court"],district:["Ward","Shire","Zone"],village:["Ford","Stead","Wick"]};
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
  const lat=zoomState.focusLatitudeRadians,lon=zoomState.focusLongitudeRadians;
  const key=[activeSeed,lat.toFixed(4),lon.toFixed(4)].join("|");
  if(mapContextCache.key===key&&mapContextCache.value)return mapContextCache.value;
  const tile=mapWorldTileAt(lat,lon);
  let hierarchy=null;
  try{hierarchy=window.GeographyFoundation?.hierarchy?.(activeSeed,tile.x,tile.y)||null;}catch(_){hierarchy=null;}
  const context=Object.freeze({
    continent:String(hierarchy?.continent||mapGeneratedName("continent",lat,lon)),
    country:String(hierarchy?.country||mapGeneratedName("country",lat,lon)),
    region:String(hierarchy?.region||mapGeneratedName("region",lat,lon)),
    city:String(hierarchy?.city||mapGeneratedName("city",lat,lon)),
    district:String(hierarchy?.district||mapGeneratedName("district",lat,lon)),
    village:String(hierarchy?.village||mapGeneratedName("village",lat,lon)),
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
function projectMapLabel(descriptor){
  if(!canvas||!cameraEntity?.camera)return null;
  const rect=canvas.getBoundingClientRect(),blend=projectionState.blend;
  if(blend<=.02){
    const direction=window.PlanetGeography?.directionFromLatLon?.(descriptor.latitudeRadians,descriptor.longitudeRadians);if(!direction)return null;
    const radius=DISPLAY_RADIUS_UNITS*1.035;
    const world=new pc.Vec3(direction.x*radius,direction.y*radius,direction.z*radius);
    const screen=cameraEntity.camera.worldToScreen(world);
    if(!Number.isFinite(screen.x)||!Number.isFinite(screen.y)||screen.z<0)return null;
    return {x:screen.x/Math.max(1,rect.width)*100,y:screen.y/Math.max(1,rect.height)*100};
  }
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians;
  const dLat=Number(descriptor.latitudeRadians)-lat0;
  const dLon=wrapLongitudeRadians(Number(descriptor.longitudeRadians)-lon0);
  const north=dLat*WORLD_RADIUS_METERS,east=dLon*WORLD_RADIUS_METERS*Math.max(.08,Math.cos(lat0));
  const width=Math.max(1,zoomState.visibleFootprintWidthMeters),height=Math.max(1,zoomState.visibleFootprintHeightMeters);
  return {x:50+(east/width)*100,y:50-(north/height)*100};
}
function buildMapBorderSegments(){
  const band=zoomState.band;
  const visible=["country-region","regional-overview","regional-detail"].includes(band);
  if(!visible||!window.PoliticalGeography?.ownerAt)return {segments:[],sampleCount:0,ownerCount:0,built:false};
  const quantizedScalar=Math.round(zoomState.scalar*20)/20;
  const key=[activeSeed,band,quantizedScalar,Math.round(zoomState.focusLatitudeRadians*180/Math.PI*2)/2,Math.round(zoomState.focusLongitudeRadians*180/Math.PI*2)/2,Math.round((canvas?.clientWidth||1)/(canvas?.clientHeight||1)*10)/10].join("|");
  if(mapBorderCache.key===key)return {segments:mapBorderCache.segments,sampleCount:mapBorderCache.sampleCount,ownerCount:mapBorderCache.ownerCount,built:false};
  const started=performance.now(),cols=13,rows=9,owners=[],ownerIds=new Set();
  const width=Math.max(1,zoomState.visibleFootprintWidthMeters),height=Math.max(1,zoomState.visibleFootprintHeightMeters);
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians,cosLat=Math.max(.08,Math.cos(lat0));
  for(let r=0;r<rows;r++){
    const row=[];
    for(let col=0;col<cols;col++){
      const east=(col/(cols-1)-.5)*width,north=(.5-r/(rows-1))*height;
      const lat=clamp(lat0+north/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
      const lon=wrapLongitudeRadians(lon0+east/(WORLD_RADIUS_METERS*cosLat));
      const tile=mapWorldTileAt(lat,lon);
      let owner=null;try{owner=window.PoliticalGeography.ownerAt(activeSeed,tile.x,tile.y);}catch(_){owner=null;}
      const id=String(owner?.id||"none");ownerIds.add(id);row.push(id);
    }
    owners.push(row);
  }
  const segments=[],sx=1000/(cols-1),sy=1000/(rows-1);
  const centerOwner=owners[Math.floor(rows/2)][Math.floor(cols/2)];
  const crossesFocusedBorder=(left,right)=>(left===centerOwner)!==(right===centerOwner);
  // Outline only the country under the view focus. Neighboring countries still
  // contribute to ownership resolution, but their mutual borders are omitted
  // so the map stays readable instead of becoming a dense political mesh.
  for(let r=0;r<rows-1;r++)for(let col=0;col<cols-1;col++){
    const a=owners[r][col],b=owners[r][col+1],c=owners[r+1][col+1],d=owners[r+1][col];
    const x=col*sx,y=r*sy,crossings=[];
    if(crossesFocusedBorder(a,b))crossings.push({x:x+sx*.5,y});
    if(crossesFocusedBorder(b,c))crossings.push({x:x+sx,y:y+sy*.5});
    if(crossesFocusedBorder(d,c))crossings.push({x:x+sx*.5,y:y+sy});
    if(crossesFocusedBorder(a,d))crossings.push({x,y:y+sy*.5});
    if(crossings.length===2)segments.push({x1:crossings[0].x,y1:crossings[0].y,x2:crossings[1].x,y2:crossings[1].y});
    else if(crossings.length===4){
      segments.push({x1:crossings[0].x,y1:crossings[0].y,x2:crossings[1].x,y2:crossings[1].y});
      segments.push({x1:crossings[2].x,y1:crossings[2].y,x2:crossings[3].x,y2:crossings[3].y});
    }
  }
  mapBorderCache={key,segments,sampleCount:cols*rows,ownerCount:ownerIds.size,builtAtMs:Number((performance.now()-started).toFixed(3))};
  return {segments,sampleCount:cols*rows,ownerCount:ownerIds.size,built:true};
}
function renderMapPresentation(){
  const layer=ensureMapPresentationDom();if(!layer)return;
  const started=performance.now(),context=mapContextForFocus(),contextKinds=mapContextKindsForBand(zoomState.band),placeKinds=mapPlaceKindsForBand(zoomState.band);
  const info=layer.querySelector(".planet-map-context");info.replaceChildren();
  const heading=document.createElement("div");heading.className="planet-map-context-head";heading.innerHTML="<small>WORLD MAP</small><strong></strong>";heading.querySelector("strong").textContent=zoomState.band.replaceAll("-"," ");info.appendChild(heading);
  const names=document.createElement("div");names.className="planet-map-context-names";
  const labels={continent:"CONTINENT",country:"COUNTRY",region:"REGION",city:"CITY",district:"ZONE",village:"VILLAGE"};
  for(const kind of contextKinds){const row=document.createElement("div");row.innerHTML="<span></span><strong></strong>";row.querySelector("span").textContent=labels[kind]||kind.toUpperCase();row.querySelector("strong").textContent=String(context?.[kind]||"—");names.appendChild(row);}info.appendChild(names);
  const border=buildMapBorderSegments(),svg=layer.querySelector(".planet-map-borders");svg.replaceChildren();svg.hidden=!border.segments.length;
  for(const seg of border.segments){const line=document.createElementNS("http://www.w3.org/2000/svg","line");line.setAttribute("x1",seg.x1.toFixed(1));line.setAttribute("y1",seg.y1.toFixed(1));line.setAttribute("x2",seg.x2.toFixed(1));line.setAttribute("y2",seg.y2.toFixed(1));line.setAttribute("class","planet-political-border");svg.appendChild(line);}
  const labelsLayer=layer.querySelector(".planet-map-labels");labelsLayer.replaceChildren();let labelCount=0;
  const candidates=destinationNavigator.descriptors.filter(d=>placeKinds.includes(d.type)).sort((a,b)=>(b.importance||0)-(a.importance||0));
  for(const d of candidates){
    if(labelCount>=6)break;const p=projectMapLabel(d);if(!p||p.x<7||p.x>93||p.y<9||p.y>91)continue;
    const tag=document.createElement("div");tag.className="planet-map-label";tag.dataset.kind=d.type;tag.style.left=p.x.toFixed(2)+"%";tag.style.top=p.y.toFixed(2)+"%";tag.innerHTML="<small></small><strong></strong>";tag.querySelector("small").textContent=d.type.toUpperCase();tag.querySelector("strong").textContent=d.name;labelsLayer.appendChild(tag);labelCount++;
  }
  const multiplier=mapZoomScaleMultiplier(),scaleMeters=niceScaleDistanceMeters(zoomState.visibleFootprintWidthMeters),rect=canvas?.getBoundingClientRect?.(),barPx=clamp(scaleMeters/Math.max(1,zoomState.visibleFootprintWidthMeters)*(rect?.width||1),72,190);
  const scale=layer.querySelector(".planet-scale-ruler");scale.querySelector(".planet-scale-meta strong").textContent=formatZoomScale(multiplier);scale.querySelector(".planet-scale-meta span").textContent=zoomState.band.replaceAll("-"," ");scale.querySelector(".planet-scale-line").style.width=Math.round(barPx)+"px";scale.querySelector("small").textContent=formatDistanceMeters(scaleMeters);
  mapPresentation={active:true,context,visibleContextKinds:contextKinds,visiblePlaceKinds:placeKinds,labelCount,borderVisible:border.segments.length>0,borderSampleCount:border.sampleCount,borderSegmentCount:border.segments.length,politicalOwnerCount:border.ownerCount,scaleDistanceMeters:scaleMeters,scaleLabel:formatDistanceMeters(scaleMeters),zoomScaleMultiplier:Number(multiplier.toFixed(5)),zoomScaleLabel:formatZoomScale(multiplier),updateCount:mapPresentation.updateCount+1,lastUpdateMs:Number((performance.now()-started).toFixed(3)),lastBorderBuildMs:mapBorderCache.builtAtMs,bounded:true,fullWorldScan:false};
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
  n.overlay.hidden=false;n.overlay.dataset.mode=String(p.mode||"determinate");n.overlay.dataset.phase=String(p.phaseId||"planning");n.overlay.dataset.proof=loadingProof?"true":"false";
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
  for(let i=0;i<total;i++){
    step(i);
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
function zoomBandFor(value){return (ZOOM_BANDS.find(b=>value<=b.max)||ZOOM_BANDS[ZOOM_BANDS.length-1]).id;}
function updateZoomFocusFromRotation(){zoomState.focusLatitudeRadians=pitchDegrees*Math.PI/180;zoomState.focusLongitudeRadians=-yawDegrees*Math.PI/180;}
function localDetailLevelForZoom(value=zoomState.scalar){
  if(value>=ZOOM_MAX-1e-7){localLodIndex=LOCAL_DETAIL_LEVELS.length-1;return LOCAL_DETAIL_LEVELS[localLodIndex];}
  const rawIndex=Math.max(0,LOCAL_DETAIL_LEVELS.findIndex(level=>value<=level.max));
  if(!localDetail.active){localLodIndex=rawIndex;return LOCAL_DETAIL_LEVELS[localLodIndex];}
  if(rawIndex>localLodIndex){
    const boundary=LOCAL_DETAIL_LEVELS[localLodIndex]?.max??1;
    if(value<boundary+LOCAL_LOD_HYSTERESIS)return LOCAL_DETAIL_LEVELS[localLodIndex];
  }else if(rawIndex<localLodIndex){
    const boundary=LOCAL_DETAIL_LEVELS[rawIndex]?.max??0;
    if(value>boundary-LOCAL_LOD_HYSTERESIS)return LOCAL_DETAIL_LEVELS[localLodIndex];
  }
  localLodIndex=rawIndex;
  return LOCAL_DETAIL_LEVELS[localLodIndex];
}
function presentationTargetHeightMeters(value=zoomState.scalar){
  const scalar=clamp(value,0,1),anchors=PRESENTATION_FOOTPRINT_ANCHORS;
  if(scalar<=anchors[0].scalar)return anchors[0].heightMeters;
  for(let i=1;i<anchors.length;i++){
    const a=anchors[i-1],b=anchors[i];
    if(scalar<=b.scalar){
      const t=clamp((scalar-a.scalar)/(b.scalar-a.scalar),0,1);
      return Math.exp(Math.log(a.heightMeters)*(1-t)+Math.log(b.heightMeters)*t);
    }
  }
  return anchors[anchors.length-1].heightMeters;
}
function localPresentationCompensation(value=zoomState.scalar,index=localLodIndex){
  const level=LOCAL_DETAIL_LEVELS[index]||LOCAL_DETAIL_LEVELS[0];
  const targetHeight=presentationTargetHeightMeters(value);
  return clamp(level.visibleHeightMeters/Math.max(1,targetHeight),.02,1);
}
function localTextureSizeForLevel(levelId){
  if(["regional-overview","regional-detail","district"].includes(levelId))return 64;
  if(["local-area","settlement"].includes(levelId))return 192;
  return 256;
}
function localPatchDimensions(){
  const rect=canvas?.getBoundingClientRect?.(),aspect=Math.max(.35,(rect?.width||1)/(rect?.height||1));
  const level=localDetailLevelForZoom();
  const portraitFactor=aspect>=1?1:(82/54);
  const visibleHeight=level.visibleHeightMeters*portraitFactor;
  const visibleWidth=visibleHeight*aspect;
  const patchWidth=visibleWidth*LOCAL_PATCH_MARGIN,patchHeight=visibleHeight*LOCAL_PATCH_MARGIN;
  // Normalize every physical LOD footprint into a bounded presentation mesh.
  // Presentation compensation keeps apparent scale continuous when the cached
  // physical LOD switches to the next smaller footprint.
  const metersPerUnit=Math.max(1,Math.max(patchWidth,patchHeight)/8);
  return {levelId:level.id,visibleWidth,visibleHeight,patchWidth,patchHeight,sampleSpacingMeters:level.sampleSpacingMeters,reliefClampMeters:level.reliefClampMeters,reliefGain:level.reliefGain,metersPerUnit,presentationCompensation:localPresentationCompensation()};
}
function localHash(eastMeters,northMeters,salt=0){
  const x=Math.floor(eastMeters*.5),z=Math.floor(northMeters*.5);
  let h=(Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul((activeSeed||"").length+salt,2246822519))>>>0;
  h=Math.imul(h^(h>>>13),1274126177)>>>0;return ((h^(h>>>16))>>>0)/4294967295;
}
function localSurfaceSample(eastMeters,northMeters,base){
  const phase=seededUnit("local-ground")*Math.PI*2;
  const broad=Math.sin(eastMeters*.085+phase)*Math.cos(northMeters*.073-phase*.61);
  const medium=Math.sin((eastMeters+northMeters)*.19+phase*.37)*.55;
  const fine=Math.cos(eastMeters*.41-northMeters*.33+phase*.83)*.22;
  const field=(broad+medium+fine)/1.77;
  const land=!!base?.land;
  const microElevation=land?field*4.8:field*.45;
  const baseColor=Array.isArray(base?.color)?base.color:[.18,.32,.22];
  const detail=Math.sin(eastMeters*.92+phase*1.7)*Math.sin(northMeters*.78-phase*.9)*.035;
  const light=field*.11+detail;
  const high=Number(base?.elevationMeters||0)>2600;
  const color=land
    ? (high
      ? [clamp(.34+light,0,1),clamp(.38+light,0,1),clamp(.30+light*.7,0,1)]
      : [clamp(baseColor[0]*.48+.16+light,0,1),clamp(baseColor[1]*.48+.28+light,0,1),clamp(baseColor[2]*.40+.10+light*.6,0,1)])
    : [clamp(baseColor[0]*.45+.04+light*.15,0,1),clamp(baseColor[1]*.55+.12+light*.2,0,1),clamp(baseColor[2]*.7+.28+light*.28,0,1)];
  return {microElevation,color};
}
function localGroundHeightUnits(eastMeters,northMeters,dims){
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians,cosLat=Math.max(.08,Math.cos(lat0));
  const lat=clamp(lat0+northMeters/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
  let lon=lon0+eastMeters/(WORLD_RADIUS_METERS*cosLat);lon=((lon+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
  const sample=geography?.sampleLatLon?.(lat,lon),centerElevation=Number(geography?.sampleLatLon?.(lat0,lon0)?.elevationMeters||0);
  const local=localSurfaceSample(eastMeters,northMeters,sample),elevation=Number(sample?.elevationMeters||0);
  const macroDelta=clamp(elevation-centerElevation,-dims.reliefClampMeters,dims.reliefClampMeters);
  const weight=smoothstep01((zoomState.scalar-.90)/.10),raw=(macroDelta*dims.reliefGain+local.microElevation*.8*weight)/dims.metersPerUnit;
  const ux=eastMeters/dims.patchWidth+.5,vz=northMeters/dims.patchHeight+.5,edge=Math.min(ux,1-ux,vz,1-vz);
  return raw*smoothstep01(clamp(edge/.12,0,1));
}
function ensureLocalStaticMaterials(){
  if(localStaticMaterials||!pc)return;
  const make=(name,r,g,b)=>{const m=new pc.StandardMaterial();m.name=name;m.diffuse.set(r,g,b);m.roughness=.92;m.update();return m;};
  localStaticMaterials={road:make("LocalRoad",.34,.25,.16),wall:make("LocalWall",.72,.55,.34),roof:make("LocalRoof",.35,.12,.08),trunk:make("LocalTrunk",.24,.13,.06),leaf:make("LocalLeaf",.16,.39,.12),water:make("LocalWater",.08,.31,.48)};
}
function addLocalStatic(name,type,material,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){
  const e=new pc.Entity(name),mesh=type==="cylinder"?pc.createCylinder(device,{radius:.5,height:1}):type==="sphere"?pc.createSphere(device,{radius:.5,latitudeBands:8,longitudeBands:10}):pc.createBox(device);
  e.addComponent("render",{type:"asset",castShadows:true,receiveShadows:true});e.render.meshInstances=[new pc.MeshInstance(mesh,material,e)];
  e.setLocalPosition(x,y,z);e.setLocalScale(sx,sy,sz);e.setLocalEulerAngles(rx,ry,rz);localStaticRoot.addChild(e);
}
function rebuildLocalStaticPresentation(signature){
  if(!tangentPatch||!device||!geography)return;
  const started=performance.now(),dims=localPatchDimensions(),eligible=["near-ground","ground"].includes(dims.levelId);
  localStaticRoot?.destroy?.();localStaticRoot=null;
  localStatic={...localStatic,active:false,signature,level:dims.levelId,roadCount:0,buildingCount:0,vegetationCount:0,waterCount:0,entityCount:0,triangleEstimate:0,drawCallEstimate:0,buildTimeMs:0};
  if(!eligible)return;
  ensureLocalStaticMaterials();localStaticRoot=new pc.Entity("LocalStaticWorld");tangentPatch.addChild(localStaticRoot);
  const unit=dims.metersPerUnit,center=geography.sampleLatLon(zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);
  if(center?.land){
    const roadWidth=Math.max(4.5,Math.min(9,dims.visibleWidth*.10)),roadSpan=dims.patchHeight*.82,roadSegments=14,segmentMeters=roadSpan/roadSegments;
    for(let r=0;r<roadSegments;r++){
      const north=-roadSpan*.5+(r+.5)*segmentMeters,y=localGroundHeightUnits(0,north,dims)+.035;
      addLocalStatic("SeedRoad-"+r,"box",localStaticMaterials.road,0,y,north/-unit,roadWidth/unit,.055,segmentMeters*1.08/unit);
    }
    localStatic.roadCount=roadSegments;localStatic.triangleEstimate+=roadSegments*12;
    const count=dims.levelId==="ground"?6:10;
    for(let i=0;i<count;i++){
      const side=i%2===0?-1:1,row=Math.floor(i/2),north=(-.32+row*.16)*dims.patchHeight,east=side*(roadWidth*.5+5+localHash(i*17,north,31)*7);
      if(Math.abs(east)>dims.patchWidth*.43||Math.abs(north)>dims.patchHeight*.43)continue;
      const w=6.5+localHash(east,north,41)*4.5,d=6+localHash(east,north,42)*3.5,h=4.5+localHash(east,north,43)*2.8,y=localGroundHeightUnits(east,north,dims);
      addLocalStatic("SeedBuildingBody-"+i,"box",localStaticMaterials.wall,east/unit,y+h*.5/unit,-north/unit,w/unit,h/unit,d/unit);
      const roofY=y+(h+.65)/unit,roofHalf=w*.66/unit,roofOffset=w*.20/unit;
      addLocalStatic("SeedBuildingRoofL-"+i,"box",localStaticMaterials.roof,(east-w*.20)/unit,roofY,-north/unit,roofHalf,.55/unit,d*1.18/unit,0,0,-24);
      addLocalStatic("SeedBuildingRoofR-"+i,"box",localStaticMaterials.roof,(east+w*.20)/unit,roofY,-north/unit,roofHalf,.55/unit,d*1.18/unit,0,0,24);
      localStatic.buildingCount++;localStatic.triangleEstimate+=36;
    }
    const trees=dims.levelId==="ground"?14:24;
    for(let i=0;i<trees;i++){
      const east=(localHash(i*29,7,51)-.5)*dims.patchWidth*.78,north=(localHash(13,i*31,52)-.5)*dims.patchHeight*.78;
      if(Math.abs(east)<roadWidth*.9)continue;
      const y=localGroundHeightUnits(east,north,dims),h=3.5+localHash(east,north,53)*3;
      addLocalStatic("SeedTreeTrunk-"+i,"cylinder",localStaticMaterials.trunk,east/unit,y+h*.25/unit,-north/unit,.7/unit,h*.5/unit,.7/unit);
      addLocalStatic("SeedTreeCrown-"+i,"sphere",localStaticMaterials.leaf,east/unit,y+h*.72/unit,-north/unit,4.2/unit,h*.86/unit,4.2/unit);
      localStatic.vegetationCount++;localStatic.triangleEstimate+=180;
    }
  }else{
    const y=localGroundHeightUnits(0,0,dims)+.02;addLocalStatic("SeedWaterSurface","box",localStaticMaterials.water,0,y,0,dims.patchWidth*.88/unit,.035,dims.patchHeight*.88/unit);
    localStatic.waterCount=1;localStatic.triangleEstimate+=12;
  }
  localStatic.entityCount=localStaticRoot.children.length;localStatic.drawCallEstimate=localStatic.entityCount;localStatic.active=localStatic.entityCount>0;localStatic.buildTimeMs=Number((performance.now()-started).toFixed(3));
}
function buildTangentPatchMesh(){
  const started=performance.now(),dims=localPatchDimensions();
  const columns=Math.max(2,Math.ceil(dims.patchWidth/dims.sampleSpacingMeters)+1);
  const rows=Math.max(2,Math.ceil(dims.patchHeight/dims.sampleSpacingMeters)+1);
  const positions=[],normals=[],uvs=[],indices=[],localMetersPerUnit=dims.metersPerUnit;
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians,cosLat=Math.max(.08,Math.cos(lat0));
  const centerElevation=Number(geography?.sampleLatLon?.(lat0,lon0)?.elevationMeters||0);
  for(let z=0;z<rows;z++){
    const vz=z/(rows-1),northMeters=(vz-.5)*dims.patchHeight;
    for(let x=0;x<columns;x++){
      const ux=x/(columns-1),eastMeters=(ux-.5)*dims.patchWidth;
      const lat=clamp(lat0+northMeters/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
      let lon=lon0+eastMeters/(WORLD_RADIUS_METERS*cosLat);lon=((lon+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
      const sample=geography?.sampleLatLon?.(lat,lon);
      const local=localSurfaceSample(eastMeters,northMeters,sample);
      const elevation=Number(sample?.elevationMeters||0);
      // A 2 m presentation patch must preserve macro height identity without
      // turning coarse planetary sample boundaries into local-scale cliffs.
      // Clamp the macro delta to the bounded near-ground window and layer only
      // subtle deterministic micro relief on top.
      const macroDelta=clamp(elevation-centerElevation,-dims.reliefClampMeters,dims.reliefClampMeters);
      const groundDetailWeight=smoothstep01((zoomState.scalar-.90)/.10);
      const microMeters=local.microElevation*.8*groundDetailWeight;
      const rawHeightUnits=(macroDelta*dims.reliefGain+microMeters)/localMetersPerUnit;
      // Feather the outer 12% of the bounded detailed patch down to its coarse
      // surround so the LOD boundary never presents as a cut-off rectangular slab.
      const edgeDistance=Math.min(ux,1-ux,vz,1-vz);
      const edgeBlend=smoothstep01(clamp(edgeDistance/.12,0,1));
      const heightUnits=rawHeightUnits*edgeBlend;
      positions.push(eastMeters/localMetersPerUnit,heightUnits,-northMeters/localMetersPerUnit);
      normals.push(0,1,0);uvs.push(ux,vz);
    }
  }
  for(let z=0;z<rows-1;z++)for(let x=0;x<columns-1;x++){const a=z*columns+x,b=a+1,c=a+columns,d=c+1;indices.push(a,c,b,b,c,d);}
  const mesh=new pc.Mesh(device);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setUvs(0,uvs);mesh.setIndices(indices);mesh.update();
  localDetail={active:true,level:dims.levelId,sampleSpacingMeters:dims.sampleSpacingMeters,visibleWidthMeters:dims.visibleWidth,visibleHeightMeters:dims.visibleHeight,patchWidthMeters:dims.patchWidth,patchHeightMeters:dims.patchHeight,columns,rows,vertices:positions.length/3,triangles:indices.length/3,estimatedBytes:positions.length*4+normals.length*4+uvs.length*4+indices.length*4,buildTimeMs:Number((performance.now()-started).toFixed(3)),rebuildCount:localDetail.rebuildCount+1,activePatchCount:1,signature:[activeSeed,lat0.toFixed(6),lon0.toFixed(6),dims.levelId,columns,rows].join("|")};
  return mesh;
}
function destroyCachedLocalResource(resource){
  if(!resource)return;
  resource.mesh?.destroy?.();localResources.destroyedMeshes++;
  resource.detailTexture?.destroy?.();resource.surroundTexture?.destroy?.();localResources.destroyedTextures+=2;
}
function trimLocalResourceCache(){
  while(localResourceCache.size>LOCAL_RESOURCE_CACHE_LIMIT){
    const oldestKey=localResourceCache.keys().next().value;
    const resource=localResourceCache.get(oldestKey);
    localResourceCache.delete(oldestKey);destroyCachedLocalResource(resource);
    localResources.evictions++;localResources.lastEvictionReason="bounded-lru";
  }
}
function activateLocalDetailResource(signature){
  if(!tangentPatch?.render||!device||!tangentPatchMaterial||!horizonSkirtMaterial)return;
  let resource=localResourceCache.get(signature);
  if(resource){
    localResourceCache.delete(signature);localResourceCache.set(signature,resource);localResources.cacheHits++;
    localDetail={...resource.detail,rebuildCount:localDetail.rebuildCount,signature};
  }else{
    localResources.cacheMisses++;localResources.pendingPreparationCount=1;
    const started=performance.now(),mesh=buildTangentPatchMesh(),dims=localPatchDimensions(),textureSize=localTextureSizeForLevel(dims.levelId);
    const detailTexture=makeLocalSurfaceTexture(dims.patchWidth,dims.patchHeight,textureSize,true);
    const surroundTexture=makeLocalSurfaceTexture(dims.patchWidth*12,dims.patchHeight*12,textureSize,false);
    resource={mesh,detailTexture,surroundTexture,detail:{...localDetail,signature,textureSize},estimatedBytes:localDetail.estimatedBytes+textureSize*textureSize*4*2};
    localDetail={...resource.detail};
    localResourceCache.set(signature,resource);localResources.lastBuildMs=Number((performance.now()-started).toFixed(3));localResources.pendingPreparationCount=0;
    trimLocalResourceCache();
  }
  tangentPatch.render.meshInstances=[new pc.MeshInstance(resource.mesh,tangentPatchMaterial,tangentPatch)];
  tangentPatchMaterial.diffuseMap=resource.detailTexture;tangentPatchMaterial.emissiveMap=resource.detailTexture;tangentPatchMaterial.opacityMap=resource.detailTexture;tangentPatchMaterial.opacityMapChannel="a";tangentPatchMaterial.opacity=1;tangentPatchMaterial.blendType=pc.BLEND_NORMAL;tangentPatchMaterial.depthWrite=false;tangentPatchMaterial.update();
  horizonSkirtMaterial.diffuseMap=resource.surroundTexture;horizonSkirtMaterial.emissiveMap=resource.surroundTexture;horizonSkirtMaterial.diffuse.set(1,1,1);horizonSkirtMaterial.emissive.set(1,1,1);horizonSkirtMaterial.emissiveIntensity=.98;horizonSkirtMaterial.update();
  localResources.activeSignature=signature;localResources.activeResourceCount=1;localResources.cachedResourceCount=localResourceCache.size;
  localResources.estimatedCacheBytes=Array.from(localResourceCache.values()).reduce((sum,item)=>sum+(item.estimatedBytes||0),0);
  rebuildLocalStaticPresentation(signature);
}
function makeLocalSurfaceTexture(spanEast,spanNorth,size=256,featherEdges=false){
  const canvas2d=document.createElement("canvas");canvas2d.width=size;canvas2d.height=size;
  const ctx=canvas2d.getContext("2d",{alpha:false}),image=ctx.createImageData(size,size),data=image.data;
  const lat0=zoomState.focusLatitudeRadians,lon0=zoomState.focusLongitudeRadians;
  const center=geography.sampleLatLon(lat0,lon0),forcedLand=!!center?.land;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const east=((x+.5)/size-.5)*spanEast,north=(.5-(y+.5)/size)*spanNorth;
    const lat=clamp(lat0+north/WORLD_RADIUS_METERS,-Math.PI*.499999,Math.PI*.499999);
    const cosLat=Math.max(.08,Math.cos(lat0));
    let lon=lon0+east/(WORLD_RADIUS_METERS*cosLat);lon=((lon+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    const sample=geography.sampleLatLon(lat,lon),local=localSurfaceSample(east,north,sample);
    const displayColor=forcedLand?local.color.map(v=>clamp(v*.88,0,1)):local.color;
    const rgba=rgbaFromColor(displayColor),i=(y*size+x)*4;
    const ux=(x+.5)/size,vz=(y+.5)/size,edgeDistance=Math.min(ux,1-ux,vz,1-vz);
    const alpha=featherEdges?Math.round(255*smoothstep01(clamp(edgeDistance/.18,0,1))):255;
    data[i]=rgba[0];data[i+1]=rgba[1];data[i+2]=rgba[2];data[i+3]=alpha;
  }
  ctx.putImageData(image,0,0);
  const texture=new pc.Texture(device,{width:size,height:size,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
  texture.addressU=pc.ADDRESS_CLAMP_TO_EDGE;texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;
  texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;texture.magFilter=pc.FILTER_LINEAR;texture.setSource(canvas2d);
  return texture;
}
function updateTangentPatchTexture(){
  if(!tangentPatchMaterial||!geography)return;
  const dims=localPatchDimensions();
  const detailTexture=makeLocalSurfaceTexture(dims.patchWidth,dims.patchHeight,256,true);
  tangentPatchMaterial.diffuseMap=detailTexture;
  tangentPatchMaterial.emissiveMap=detailTexture;
  tangentPatchMaterial.opacityMap=detailTexture;
  tangentPatchMaterial.opacityMapChannel="a";
  tangentPatchMaterial.opacity=1;
  tangentPatchMaterial.blendType=pc.BLEND_NORMAL;
  tangentPatchMaterial.depthWrite=false;
  tangentPatchMaterial.update();
  if(horizonSkirtMaterial){
    // The flat surround spans 12x the detailed patch in presentation space.
    // Sample exactly 12x the physical area as well so its central texture
    // coordinates line up with the detailed patch edges.
    const surroundTexture=makeLocalSurfaceTexture(dims.patchWidth*12,dims.patchHeight*12,256,false);
    horizonSkirtMaterial.diffuseMap=surroundTexture;
    horizonSkirtMaterial.emissiveMap=surroundTexture;
    horizonSkirtMaterial.diffuse.set(1,1,1);
    horizonSkirtMaterial.emissive.set(1,1,1);
    horizonSkirtMaterial.emissiveIntensity=.98;
    horizonSkirtMaterial.update();
  }
}
function ensureTangentPatch(){
  if(tangentPatch)return;
  tangentPatchMaterial=new pc.StandardMaterial();tangentPatchMaterial.name="SeededTangentSurface";tangentPatchMaterial.diffuse.set(1,1,1);tangentPatchMaterial.emissive.set(1,1,1);tangentPatchMaterial.emissiveIntensity=1.08;tangentPatchMaterial.useLighting=false;tangentPatchMaterial.cull=pc.CULLFACE_NONE;tangentPatchMaterial.roughness=.9;tangentPatchMaterial.update();
  tangentPatch=new pc.Entity("LocalTangentSurface");tangentPatch.addComponent("render",{type:"asset",castShadows:false,receiveShadows:true});
  tangentPatch.render.meshInstances=[new pc.MeshInstance(buildTangentPatchMesh(),tangentPatchMaterial,tangentPatch)];
  tangentPatch.enabled=false;app.root.addChild(tangentPatch);
}
function ensureHorizonSkirt(){
  if(horizonSkirt||!device)return;
  horizonSkirtMaterial=new pc.StandardMaterial();horizonSkirtMaterial.name="LocalHorizonSkirt";
  horizonSkirtMaterial.diffuse.set(.2,.34,.17);horizonSkirtMaterial.emissive.set(.18,.30,.15);horizonSkirtMaterial.emissiveIntensity=1.08;
  horizonSkirtMaterial.useLighting=false;horizonSkirtMaterial.cull=pc.CULLFACE_NONE;horizonSkirtMaterial.update();
  const mesh=new pc.Mesh(device);
  mesh.setPositions([-48,0,-48,48,0,-48,-48,0,48,48,0,48]);
  mesh.setNormals([0,1,0,0,1,0,0,1,0,0,1,0]);
  mesh.setUvs(0,[0,0,1,0,0,1,1,1]);
  mesh.setIndices([0,2,1,1,2,3]);mesh.update();
  horizonSkirt=new pc.Entity("LocalHorizonSkirt");horizonSkirt.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
  horizonSkirt.render.meshInstances=[new pc.MeshInstance(mesh,horizonSkirtMaterial,horizonSkirt)];horizonSkirt.enabled=false;app.root.addChild(horizonSkirt);
}
function updateProjectionPresentation(){
  if(!planet)return;
  const blend=projectionState.blend;
  if(blend>0){
    ensureTangentPatch();ensureHorizonSkirt();
    const dims=localPatchDimensions(),sig=[activeSeed,zoomState.focusLatitudeRadians.toFixed(5),zoomState.focusLongitudeRadians.toFixed(5),dims.levelId,Math.ceil(dims.patchWidth/dims.sampleSpacingMeters),Math.ceil(dims.patchHeight/dims.sampleSpacingMeters)].join("|");
    if(localResources.activeSignature!==sig)activateLocalDetailResource(sig);
  }
  if(tangentPatch){
    const tangentVisible=blend>.055;
    tangentPatch.enabled=tangentVisible;
    ensureHorizonSkirt();
    const viewBlend=blend;
    if(horizonSkirt){horizonSkirt.enabled=tangentVisible;horizonSkirt.setLocalPosition(0,-.012,0);}
    tangentPatch.setLocalPosition(0,0,0);
    tangentPatch.setLocalEulerAngles(0,0,0);
    // Match each finer cached LOD's apparent scale to the prior LOD at entry,
    // then ease toward its native scale across the band.
    const dims=localPatchDimensions(),basePatchScale=1.45+(1-viewBlend)*.35;
    const patchScale=basePatchScale*dims.presentationCompensation;
    projectionPresentation={...projectionPresentation,viewBlend,presentationCompensation:dims.presentationCompensation,patchScale,targetHeightMeters:presentationTargetHeightMeters()};
    tangentPatch.setLocalScale(patchScale,patchScale,patchScale);
    if(horizonSkirt)horizonSkirt.setLocalScale(patchScale,patchScale,patchScale);
  }
  planet.enabled=blend<=.06;
  if(cloudLayer)cloudLayer.enabled=planet.enabled;
  localResources.culledOuterRepresentations=planet.enabled?0:1+(cloudLayer?1:0);
  if(blend<=0){localResources.activeResourceCount=0;localResources.activeSignature=null;}
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
  zoomState.cameraDistance=distance;zoomState.band=zoomBandFor(scalar);
  updateProjectionState();
  const blend=projectionState.blend;
  // Move into a clearly elevated tangent camera before the globe is retired.
  // Intermediate regional/district tiers should read as progressively closer
  // terrain maps, not as a low grazing-angle strip that appears to jump to ground.
  updateProjectionPresentation();
  const globeZ=distance;
  const viewBlend=blend;
  const localZ=6.20;
  const localY=5.00;
  // Projection flattening and camera orientation are intentionally independent.
  // Keep map-scale zoom radial/top-down through the country/regional bands, then
  // introduce the gameplay oblique view gradually across the local approach.
  // This prevents a small wheel/pinch step around 0.06x-0.08x from behaving
  // like camera rotation while preserving the same spherical focus anchor.
  const orientationStart=.72;
  const orientationEnd=.995;
  const orientationRaw=clamp((scalar-orientationStart)/(orientationEnd-orientationStart),0,1);
  const angleBlend=smoothstep01(orientationRaw);
  const tangentVisible=viewBlend>.055;
  // The tangent patch lies in X/Z. Once it becomes the visible representation,
  // view it from above; keeping the old globe-front camera at Y~=0 makes the
  // horizontal patch appear as a horizon strip. The later gameplay oblique
  // transition is independent and begins only at orientationStart.
  const mapY=8.0,mapZ=.35;
  const cameraZ=tangentVisible?lerp(mapZ,localZ,angleBlend):globeZ;
  const cameraY=tangentVisible?lerp(mapY,localY,angleBlend):0;
  const targetZ=0;
  const targetY=tangentVisible?lerp(0,-.12,angleBlend):0;
  cameraEntity.setLocalPosition(0,cameraY,cameraZ);cameraEntity.lookAt(0,targetY,targetZ);
  const fov=34+12*angleBlend;if(cameraEntity.camera)cameraEntity.camera.fov=fov;
  const lookLength=Math.max(.000001,Math.hypot(cameraY-targetY,cameraZ-targetZ));
  const lookVector=Object.freeze([0,Number(((targetY-cameraY)/lookLength).toFixed(6)),Number(((targetZ-cameraZ)/lookLength).toFixed(6))]);
  // Presentation pitch is 0 degrees for radial/top-down map viewing and grows
  // only as the later local gameplay oblique camera is introduced.
  const mapPitchBaseline=Math.atan2(mapZ,mapY)*180/Math.PI;\n  const cameraPitchDegrees=tangentVisible?Number(Math.max(0,Math.atan2(Math.abs(cameraZ-targetZ),Math.max(.000001,Math.abs(cameraY-targetY)))*180/Math.PI-mapPitchBaseline).toFixed(3)):0;
  projectionPresentation={...projectionPresentation,viewBlend,angleBlend,orientationStart,orientationEnd,cameraY,cameraZ,fov,cameraPitchDegrees,lookVector,cameraTarget:Object.freeze([0,targetY,targetZ])};
  const focusDistance=Math.hypot(cameraY-targetY,cameraZ-targetZ);
  const rect=canvas?.getBoundingClientRect?.(),aspect=Math.max(.1,(rect?.width||1)/(rect?.height||1));
  const verticalFov=34*Math.PI/180;
  const visibleHeightUnits=2*focusDistance*Math.tan(verticalFov/2);
  const visibleWidthUnits=visibleHeightUnits*aspect;
  const metersPerUnit=WORLD_RADIUS_METERS/DISPLAY_RADIUS_UNITS;
  if(blend>.055){
    const dims=localPatchDimensions(),comp=Math.max(.08,dims.presentationCompensation||1);
    zoomState.visibleFootprintWidthMeters=Math.max(2,dims.visibleWidth/comp);
    zoomState.visibleFootprintHeightMeters=Math.max(2,dims.visibleHeight/comp);
  }else{
    zoomState.visibleFootprintWidthMeters=Math.max(2,visibleWidthUnits*metersPerUnit);
    zoomState.visibleFootprintHeightMeters=Math.max(2,visibleHeightUnits*metersPerUnit);
  }
  updateMapPresentation();
}
function setZoomScalar(value){
  const next=clamp(value,ZOOM_MIN,ZOOM_MAX);
  if(Math.abs(next-zoomState.scalar)<1e-7)return snapshot();
  zoomState.scalar=next;zoomState.zoomChanges++;applyCameraZoom();return snapshot();
}
function zoomBy(delta){return setZoomScalar(zoomState.scalar+Number(delta||0));}
function applyRotation(){
  if(!planet)return;
  planet.setLocalEulerAngles(pitchDegrees,yawDegrees,0);
  updateZoomFocusFromRotation();
  rotationChangeCount++;
  if(zoomState.scalar<=projectionState.transitionStart)updateMapPresentation();
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
  let highest=null,deepest=null,bestIsland=null,bestMountain=null,bestContinent=null;

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
    if(sample.elevationMeters>1450||sample.mountainInfluence>.22){if(roll<72)rocks.push(descriptor);}
    else if(sample.moisture>.40){if(roll<78)vegetation.push(descriptor);}
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
    for(let i=0;i<4;i++)normals.push(d.x,d.y,d.z);
    indices.push(start,start+1,start+3,start+1,start+2,start+3,start+2,start,start+3);
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
async function buildScene(){
  const started=performance.now();
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
    controlledWorkActive=true;
    await measuredPhase("buildSceneMs",()=>buildScene());
    controlledWorkActive=false;
    await yieldPaint();
    bindInput();
    resize();
    app.on?.("update",dt=>{frameCount++;updateInspectionTooltip();updateAmbientMotion(dt);});
    await measuredPhase("appStartMs",async()=>app.start());

    if("ResizeObserver" in window){
      resizeObserver=new ResizeObserver(resize);
      resizeObserver.observe(root);
    }else window.addEventListener("resize",resize);

    ready=true;
    setStartupProgress("ready","First playable planet ready",100,"ready");
    startupProgress.gameplayReadyAtMs=Date.now();
    startupScheduler.backgroundPreparationCompleteAtMs=startupProgress.gameplayReadyAtMs;
    startupScheduler.optionalPostReadyWorkCount=0;
    endResponsivenessTelemetry();
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
    zoom:Object.freeze({
      scalar:Number(zoomState.scalar.toFixed(6)),band:zoomState.band,
      focusLatitudeDegrees:Number((zoomState.focusLatitudeRadians*180/Math.PI).toFixed(6)),
      focusLongitudeDegrees:Number((zoomState.focusLongitudeRadians*180/Math.PI).toFixed(6)),
      cameraDistance:Number(zoomState.cameraDistance.toFixed(6)),
      baseCameraDistance:Number(zoomState.baseCameraDistance.toFixed(6)),
      visibleFootprintWidthMeters:Number(zoomState.visibleFootprintWidthMeters.toFixed(3)),
      visibleFootprintHeightMeters:Number(zoomState.visibleFootprintHeightMeters.toFixed(3)),
      wheelEvents:zoomState.wheelEvents,pinchEvents:zoomState.pinchEvents,zoomChanges:zoomState.zoomChanges,
      bands:ZOOM_BANDS.map(b=>b.id),detailLevels:LOCAL_DETAIL_LEVELS.map(level=>level.id),sameSphericalAuthority:true
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
  for(const resource of localResourceCache.values())destroyCachedLocalResource(resource);localResourceCache.clear();localResources={activeSignature:null,cacheHits:0,cacheMisses:0,evictions:0,destroyedMeshes:0,destroyedTextures:0,activeResourceCount:0,cachedResourceCount:0,estimatedCacheBytes:0,culledOuterRepresentations:0,pendingPreparationCount:0,lastBuildMs:0,lastEvictionReason:null};
  app?.destroy?.();
  app=null;device=null;pc=null;planet=null;cameraEntity=null;canvas=null;localStaticRoot=null;localStaticMaterials=null;ready=false;
  inspectionPickables.clear();
  inspection={selectedId:null,selectedType:null,pointerDownX:0,pointerDownY:0,dragDistance:0,pickQueries:0,lastPickCandidateCount:0,lastPickQueryMs:0,tooltipUpdates:0,lastTooltipUpdateMs:0,contentRefreshes:0,lastContentRefreshAtMs:0,dismissCount:0};
  geography=null;politicalScaleEvidenceCache=null;projectionPresentation={viewBlend:0,angleBlend:0,presentationCompensation:1,patchScale:0,cameraY:0,cameraZ:0,fov:34,targetHeightMeters:650000};root?.replaceChildren?.();
}
window.PlanetStage=Object.freeze({
  VERSION,start,snapshot,verify,setRotation,rotateBy,setViewTarget,rotationForLatLon,setZoomScalar,zoomBy,setLoadingProof,clearLoadingProof,applyAuthoritativeFantasyTime,openPlaces:()=>{destinationNavigator.open=true;renderDestinationNavigator();return snapshot();},closePlaces:()=>{destinationNavigator.open=false;renderDestinationNavigator();return snapshot();},registerInspectionPickable,unregisterInspectionPickable,dismissInspection,pickInspection,
  setPlacesCategory:(category)=>{destinationNavigator.category=["all","settlements","cities","historical","hunting","fishing","landmark","nature","water"].includes(category)?category:"all";renderDestinationNavigator();return snapshot();},selectPlace:(id)=>{const d=destinationNavigator.descriptors.find(x=>x.id===id);if(d){destinationNavigator.selectedId=d.id;destinationNavigator.navigationCount++;destinationNavigator.lastTarget={id:d.id,name:d.name,latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees};setViewTarget(d);renderDestinationNavigator();}return snapshot();},destroy,
  constants:Object.freeze({
    EARTH_REFERENCE_RADIUS_METERS,WORLD_SCALE_FRACTION,WORLD_RADIUS_METERS,WORLD_DIAMETER_METERS,
    WORLD_CIRCUMFERENCE_METERS:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3)),
    TEXTURE_WIDTH,TEXTURE_HEIGHT,LATITUDE_SEGMENTS,LONGITUDE_SEGMENTS,HEIGHT_EXAGGERATION,ZOOM_MIN,ZOOM_MAX,ZOOM_BANDS,LOCAL_DETAIL_LEVELS,PRESENTATION_FOOTPRINT_ANCHORS,ZOOM_WHEEL_SENSITIVITY,ZOOM_PINCH_SENSITIVITY,LOCAL_RESOURCE_CACHE_LIMIT,LOCAL_LOD_HYSTERESIS
  })
});
const boot=()=>start().catch(()=>{});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();