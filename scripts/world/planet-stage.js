(function(){
"use strict";

const VERSION="planet-zoom-foundation-v1";
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
const ZOOM_WHEEL_SENSITIVITY=0.0009;
const ZOOM_PINCH_SENSITIVITY=0.006;
const ZOOM_DISTANCE_FACTOR=0.018;
const ZOOM_BANDS=Object.freeze([{id:"planet",max:.18},{id:"continent",max:.42},{id:"country-region",max:.66},{id:"local-area",max:.86},{id:"ground",max:1}]);

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
function applyCameraZoom(){
  if(!cameraEntity||!zoomState.baseCameraDistance)return;
  const scalar=clamp(zoomState.scalar,ZOOM_MIN,ZOOM_MAX);
  const distance=Math.max(DISPLAY_RADIUS_UNITS*1.025,zoomState.baseCameraDistance*Math.pow(ZOOM_DISTANCE_FACTOR,scalar));
  cameraEntity.setLocalPosition(0,0,distance);cameraEntity.lookAt(0,0,0);
  zoomState.cameraDistance=distance;zoomState.band=zoomBandFor(scalar);
  const rect=canvas?.getBoundingClientRect?.(),aspect=Math.max(.1,(rect?.width||1)/(rect?.height||1));
  const verticalFov=34*Math.PI/180;
  const visibleHeightUnits=2*distance*Math.tan(verticalFov/2);
  const visibleWidthUnits=visibleHeightUnits*aspect;
  const metersPerUnit=WORLD_RADIUS_METERS/DISPLAY_RADIUS_UNITS;
  zoomState.visibleFootprintWidthMeters=Math.max(2,visibleWidthUnits*metersPerUnit);
  zoomState.visibleFootprintHeightMeters=Math.max(2,visibleHeightUnits*metersPerUnit);
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
}
function setRotation(yaw,pitch){
  yawDegrees=normalizeYaw(yaw);
  pitchDegrees=clamp(pitch,-82,82);
  applyRotation();
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
      mouseDrag:true,touchDrag:true,keyboardRotation:true,wheelZoom:true,pinchZoom:true,keyboardZoom:true
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
      bands:ZOOM_BANDS.map(b=>b.id),sameSphericalAuthority:true
    }),
    activeSystems:Object.freeze({
      protagonistEnabled:false,
      npcEnabled:false,
      tileSystemActive:false,
      localTerrainActive:false,
      settlementGenerationActive:false,
      buildingGenerationActive:false,
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
  app?.destroy?.();
  app=null;device=null;pc=null;planet=null;cameraEntity=null;canvas=null;ready=false;
  inspectionPickables.clear();
  inspection={selectedId:null,selectedType:null,pointerDownX:0,pointerDownY:0,dragDistance:0,pickQueries:0,lastPickCandidateCount:0,lastPickQueryMs:0,tooltipUpdates:0,lastTooltipUpdateMs:0,contentRefreshes:0,lastContentRefreshAtMs:0,dismissCount:0};
  geography=null;root?.replaceChildren?.();
}
window.PlanetStage=Object.freeze({
  VERSION,start,snapshot,verify,setRotation,rotateBy,setViewTarget,rotationForLatLon,setZoomScalar,zoomBy,setLoadingProof,clearLoadingProof,applyAuthoritativeFantasyTime,openPlaces:()=>{destinationNavigator.open=true;renderDestinationNavigator();return snapshot();},closePlaces:()=>{destinationNavigator.open=false;renderDestinationNavigator();return snapshot();},registerInspectionPickable,unregisterInspectionPickable,dismissInspection,pickInspection,
  setPlacesCategory:(category)=>{destinationNavigator.category=["all","settlements","cities","historical","hunting","fishing","landmark","nature","water"].includes(category)?category:"all";renderDestinationNavigator();return snapshot();},selectPlace:(id)=>{const d=destinationNavigator.descriptors.find(x=>x.id===id);if(d){destinationNavigator.selectedId=d.id;destinationNavigator.navigationCount++;destinationNavigator.lastTarget={id:d.id,name:d.name,latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees};setViewTarget(d);renderDestinationNavigator();}return snapshot();},destroy,
  constants:Object.freeze({
    EARTH_REFERENCE_RADIUS_METERS,WORLD_SCALE_FRACTION,WORLD_RADIUS_METERS,WORLD_DIAMETER_METERS,
    WORLD_CIRCUMFERENCE_METERS:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3)),
    TEXTURE_WIDTH,TEXTURE_HEIGHT,LATITUDE_SEGMENTS,LONGITUDE_SEGMENTS,HEIGHT_EXAGGERATION,ZOOM_MIN,ZOOM_MAX,ZOOM_BANDS
  })
});
const boot=()=>start().catch(()=>{});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();