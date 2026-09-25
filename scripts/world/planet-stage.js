(function(){
"use strict";

const VERSION="planetary-geography-globe-v2";
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

let pc=null;
let app=null;
let device=null;
let root=null;
let canvas=null;
let planet=null;
let cameraEntity=null;
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
let startupScheduler={sliceBudgetMs:STARTUP_SLICE_BUDGET_MS,sliceCount:0,yieldCount:0,maxSliceMs:0,longTaskOver50:0,longTaskOver100:0,longTaskOver200:0,longestLongTaskMs:0,maxEventLoopLagMs:0,heartbeatCount:0,paintHeartbeatCount:0,firstPlayableWorkUnits:0,completedFirstPlayableWorkUnits:0,optionalPostReadyWorkCount:0,backgroundPreparationCompleteAtMs:null};
let longTaskObserver=null;
let heartbeatTimer=null;
let lastHeartbeatAt=0;

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
        }
      });
      longTaskObserver.observe({entryTypes:["longtask"]});
    }catch(_){}
  }
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
function applyRotation(){
  if(!planet)return;
  planet.setLocalEulerAngles(pitchDegrees,yawDegrees,0);
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

  await runSlicedRange(TEXTURE_HEIGHT,py=>{
    const v=(py+0.5)/TEXTURE_HEIGHT;
    const lat=(0.5-v)*Math.PI;
    for(let px=0;px<TEXTURE_WIDTH;px++){
      const u=(px+0.5)/TEXTURE_WIDTH;
      const lon=(u-0.5)*Math.PI*2;
      const sample=geography.sampleLatLon(lat,lon);
      const rgba=rgbaFromColor(sample.color);
      const index=(py*TEXTURE_WIDTH+px)*4;
      data[index]=rgba[0];data[index+1]=rgba[1];data[index+2]=rgba[2];data[index+3]=255;
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
    mountain:bestMountain||highest,
    island:bestIsland,
    peak:highest,
    deepOcean:deepest
  });
  return texture;
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
  for(let lat=0;lat<LATITUDE_SEGMENTS;lat++){
    for(let lon=0;lon<LONGITUDE_SEGMENTS;lon++){
      const a=lat*stride+lon;
      const b=a+1;
      const c=a+stride;
      const d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i],ib=indices[i+1],ic=indices[i+2];
    const ax=positions[ia*3],ay=positions[ia*3+1],az=positions[ia*3+2];
    const bx=positions[ib*3],by=positions[ib*3+1],bz=positions[ib*3+2];
    const cx=positions[ic*3],cy=positions[ic*3+1],cz=positions[ic*3+2];
    const abx=bx-ax,aby=by-ay,abz=bz-az;
    const acx=cx-ax,acy=cy-ay,acz=cz-az;
    const nx=aby*acz-abz*acy;
    const ny=abz*acx-abx*acz;
    const nz=abx*acy-aby*acx;
    for(const index of [ia,ib,ic]){
      normals[index*3]+=nx;normals[index*3+1]+=ny;normals[index*3+2]+=nz;
    }
  }
  for(let i=0;i<normals.length;i+=3){
    const len=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;
    normals[i]/=len;normals[i+1]/=len;normals[i+2]/=len;
  }
  for(let lat=0;lat<=LATITUDE_SEGMENTS;lat++){
    const a=lat*stride,b=a+LONGITUDE_SEGMENTS;
    const nx=normals[a*3]+normals[b*3],ny=normals[a*3+1]+normals[b*3+1],nz=normals[a*3+2]+normals[b*3+2];
    const len=Math.hypot(nx,ny,nz)||1;
    normals[a*3]=normals[b*3]=nx/len;
    normals[a*3+1]=normals[b*3+1]=ny/len;
    normals[a*3+2]=normals[b*3+2]=nz/len;
  }
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
  }

  const mesh=new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0,uvs);
  mesh.setIndices(indices);
  mesh.update();
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
    cameraEntity.setLocalPosition(0,0,distance);
    cameraEntity.lookAt(0,0,0);
  }
}
function bindInput(){
  canvas.tabIndex=0;
  canvas.setAttribute("role","application");
  canvas.setAttribute("aria-label","Rotatable seeded fantasy planet. Drag to rotate.");
  canvas.addEventListener("contextmenu",event=>event.preventDefault());
  canvas.addEventListener("pointerdown",event=>{
    dragging=true;pointerId=event.pointerId;
    lastPointerX=event.clientX;lastPointerY=event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.focus({preventScroll:true});
    pointerDragCount++;event.preventDefault();
  },{passive:false});
  canvas.addEventListener("pointermove",event=>{
    if(!dragging||event.pointerId!==pointerId)return;
    const dx=event.clientX-lastPointerX,dy=event.clientY-lastPointerY;
    lastPointerX=event.clientX;lastPointerY=event.clientY;
    rotateBy(dx*0.34,dy*0.26);event.preventDefault();
  },{passive:false});
  const endPointer=event=>{
    if(event.pointerId!==pointerId)return;
    dragging=false;canvas.releasePointerCapture?.(event.pointerId);pointerId=null;
  };
  canvas.addEventListener("pointerup",endPointer);
  canvas.addEventListener("pointercancel",endPointer);
  canvas.addEventListener("keydown",event=>{
    let handled=true;
    if(event.key==="ArrowLeft")rotateBy(-6,0);
    else if(event.key==="ArrowRight")rotateBy(6,0);
    else if(event.key==="ArrowUp")rotateBy(0,-6);
    else if(event.key==="ArrowDown")rotateBy(0,6);
    else handled=false;
    if(handled)event.preventDefault();
  });
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

  const surfaceMaterial=new pc.StandardMaterial();
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

  const keyLight=new pc.Entity("PlanetKeyLight");
  keyLight.addComponent("light",{
    type:"directional",
    color:new pc.Color(1.0,0.97,0.90),
    intensity:1.42,
    castShadows:false
  });
  keyLight.setLocalEulerAngles(26,-42,0);
  app.root.addChild(keyLight);

  const fillLight=new pc.Entity("PlanetFillLight");
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

    pc=await import(ENGINE_URL);
    setStartupProgress("renderer","Initializing PlayCanvas…",32);
    await yieldPaint();
    canvas=document.createElement("canvas");
    canvas.id="planetCanvas";
    canvas.className="planet-stage-canvas";
    canvas.dataset.renderer="playcanvas";
    const loader=root.querySelector(".planet-stage-loading");
    root.replaceChildren(canvas);
    if(loader)root.appendChild(loader);

    device=await pc.createGraphicsDevice(canvas,{
      deviceTypes:[pc.DEVICETYPE_WEBGL2],
      antialias:true,
      depth:true,
      powerPreference:"high-performance"
    });
    const options=new pc.AppOptions();
    options.graphicsDevice=device;
    options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];
    options.resourceHandlers=[pc.TextureHandler];

    app=new pc.AppBase(canvas);
    app.init(options);
    await buildScene();
    await yieldPaint();
    bindInput();
    resize();
    app.on?.("update",()=>{frameCount++;});
    app.start();

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
    return snapshot();
  }catch(error){
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
      mouseDrag:true,touchDrag:true,keyboardRotation:true
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
  geography=null;root?.replaceChildren?.();
}
window.PlanetStage=Object.freeze({
  VERSION,start,snapshot,verify,setRotation,rotateBy,setViewTarget,rotationForLatLon,setLoadingProof,clearLoadingProof,destroy,
  constants:Object.freeze({
    EARTH_REFERENCE_RADIUS_METERS,WORLD_SCALE_FRACTION,WORLD_RADIUS_METERS,WORLD_DIAMETER_METERS,
    WORLD_CIRCUMFERENCE_METERS:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3)),
    TEXTURE_WIDTH,TEXTURE_HEIGHT,LATITUDE_SEGMENTS,LONGITUDE_SEGMENTS,HEIGHT_EXAGGERATION
  })
});
const boot=()=>start().catch(()=>{});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();