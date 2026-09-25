(function(){
"use strict";

const VERSION="planet-sphere-foundation-v1";
const ENGINE_VERSION="2.22.3";
const ENGINE_URL="https://cdn.jsdelivr.net/npm/playcanvas@"+ENGINE_VERSION+"/+esm";

const EARTH_REFERENCE_RADIUS_METERS=6_371_000;
const WORLD_SCALE_FRACTION=0.10;
const WORLD_RADIUS_METERS=Math.round(EARTH_REFERENCE_RADIUS_METERS*WORLD_SCALE_FRACTION);
const WORLD_DIAMETER_METERS=WORLD_RADIUS_METERS*2;
const WORLD_CIRCUMFERENCE_METERS=2*Math.PI*WORLD_RADIUS_METERS;
const DISPLAY_RADIUS_UNITS=3.25;

let pc=null;
let app=null;
let device=null;
let root=null;
let canvas=null;
let planet=null;
let resizeObserver=null;
let yawDegrees=-22;
let pitchDegrees=-12;
let dragging=false;
let pointerId=null;
let lastPointerX=0;
let lastPointerY=0;
let pointerDragCount=0;
let rotationChangeCount=0;
let ready=false;
let startupError=null;
let frameCount=0;

function clamp(value,min,max){return Math.min(max,Math.max(min,Number(value)||0));}
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
function makeGridTexture(){
  const source=document.createElement("canvas");
  source.width=1024;
  source.height=512;
  const ctx=source.getContext("2d",{alpha:false});
  const gradient=ctx.createLinearGradient(0,0,0,source.height);
  gradient.addColorStop(0,"#30506b");
  gradient.addColorStop(0.48,"#193b55");
  gradient.addColorStop(0.52,"#183950");
  gradient.addColorStop(1,"#27475f");
  ctx.fillStyle=gradient;
  ctx.fillRect(0,0,source.width,source.height);

  ctx.lineWidth=1;
  ctx.strokeStyle="rgba(213,231,238,0.11)";
  for(let lon=0;lon<=24;lon++){
    const x=Math.round(lon*source.width/24)+0.5;
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,source.height);ctx.stroke();
  }
  for(let lat=1;lat<12;lat++){
    const y=Math.round(lat*source.height/12)+0.5;
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(source.width,y);ctx.stroke();
  }

  ctx.strokeStyle="rgba(228,239,242,0.28)";
  ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(0,source.height/2+0.5);ctx.lineTo(source.width,source.height/2+0.5);ctx.stroke();
  ctx.beginPath();ctx.moveTo(source.width/2+0.5,0);ctx.lineTo(source.width/2+0.5,source.height);ctx.stroke();

  const texture=new pc.Texture(device,{
    width:source.width,
    height:source.height,
    format:pc.PIXELFORMAT_R8_G8_B8_A8,
    mipmaps:true
  });
  texture.name="PlanetFoundationCoordinateGrid";
  texture.addressU=pc.ADDRESS_REPEAT;
  texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;
  texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;
  texture.magFilter=pc.FILTER_LINEAR;
  texture.setSource(source);
  return texture;
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
}
function bindInput(){
  canvas.tabIndex=0;
  canvas.setAttribute("role","application");
  canvas.setAttribute("aria-label","Rotatable fantasy world sphere. Drag to rotate.");
  canvas.addEventListener("contextmenu",event=>event.preventDefault());
  canvas.addEventListener("pointerdown",event=>{
    dragging=true;
    pointerId=event.pointerId;
    lastPointerX=event.clientX;
    lastPointerY=event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.focus({preventScroll:true});
    pointerDragCount++;
    event.preventDefault();
  },{passive:false});
  canvas.addEventListener("pointermove",event=>{
    if(!dragging||event.pointerId!==pointerId)return;
    const dx=event.clientX-lastPointerX;
    const dy=event.clientY-lastPointerY;
    lastPointerX=event.clientX;
    lastPointerY=event.clientY;
    rotateBy(dx*0.34,dy*0.26);
    event.preventDefault();
  },{passive:false});
  const endPointer=event=>{
    if(event.pointerId!==pointerId)return;
    dragging=false;
    canvas.releasePointerCapture?.(event.pointerId);
    pointerId=null;
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
function buildScene(){
  app.scene.ambientLight=new pc.Color(0.11,0.14,0.18);

  const camera=new pc.Entity("PlanetCamera");
  camera.addComponent("camera",{
    clearColor:new pc.Color(0.012,0.018,0.032),
    fov:34,
    nearClip:0.1,
    farClip:100
  });
  camera.setLocalPosition(0,0,13.2);
  camera.lookAt(0,0,0);
  app.root.addChild(camera);

  const surfaceMaterial=new pc.StandardMaterial();
  surfaceMaterial.name="PlanetFoundationSurface";
  surfaceMaterial.diffuse.set(1,1,1);
  surfaceMaterial.diffuseMap=makeGridTexture();
  surfaceMaterial.gloss=0.18;
  surfaceMaterial.metalness=0;
  surfaceMaterial.emissive.set(0.005,0.011,0.018);
  surfaceMaterial.update();

  planet=new pc.Entity("FantasyPlanet");
  planet.addComponent("render",{type:"sphere",material:surfaceMaterial,castShadows:false,receiveShadows:true});
  planet.setLocalScale(DISPLAY_RADIUS_UNITS*2,DISPLAY_RADIUS_UNITS*2,DISPLAY_RADIUS_UNITS*2);
  app.root.addChild(planet);

  const keyLight=new pc.Entity("PlanetKeyLight");
  keyLight.addComponent("light",{
    type:"directional",
    color:new pc.Color(0.95,0.96,1),
    intensity:1.55,
    castShadows:false
  });
  keyLight.setLocalEulerAngles(32,-38,0);
  app.root.addChild(keyLight);

  const rimLight=new pc.Entity("PlanetRimLight");
  rimLight.addComponent("light",{
    type:"directional",
    color:new pc.Color(0.38,0.52,0.72),
    intensity:0.42,
    castShadows:false
  });
  rimLight.setLocalEulerAngles(-22,142,0);
  app.root.addChild(rimLight);

  applyRotation();
}
async function start(){
  if(ready)return snapshot();
  try{
    root=document.getElementById("planetStageRoot");
    if(!root)throw new Error("Planet stage root is missing");
    document.body.classList.add("planet-stage-active");

    pc=await import(ENGINE_URL);
    canvas=document.createElement("canvas");
    canvas.id="planetCanvas";
    canvas.className="planet-stage-canvas";
    canvas.dataset.renderer="playcanvas";
    root.replaceChildren(canvas);

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
    buildScene();
    bindInput();
    resize();
    app.on?.("update",()=>{frameCount++;});
    app.start();

    if("ResizeObserver" in window){
      resizeObserver=new ResizeObserver(resize);
      resizeObserver.observe(root);
    }else{
      window.addEventListener("resize",resize);
    }

    ready=true;
    root.dataset.ready="true";
    return snapshot();
  }catch(error){
    startupError=String(error?.stack||error);
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
    stage:"planet-sphere-foundation",
    ready,
    engine:"PlayCanvas",
    engineVersion:ENGINE_VERSION,
    canvasCount:root?.querySelectorAll?.("canvas")?.length||0,
    worldScaleFraction:WORLD_SCALE_FRACTION,
    earthReferenceRadiusMeters:EARTH_REFERENCE_RADIUS_METERS,
    worldRadiusMeters:WORLD_RADIUS_METERS,
    worldDiameterMeters:WORLD_DIAMETER_METERS,
    worldCircumferenceMeters:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3)),
    displayRadiusUnits:DISPLAY_RADIUS_UNITS,
    rotation:Object.freeze({
      yawDegrees:Number(yawDegrees.toFixed(3)),
      pitchDegrees:Number(pitchDegrees.toFixed(3))
    }),
    input:Object.freeze({
      dragging,
      pointerDragCount,
      rotationChangeCount,
      mouseDrag:true,
      touchDrag:true,
      keyboardRotation:true
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
    frameCount,
    startupError
  });
}
function destroy(){
  resizeObserver?.disconnect?.();
  resizeObserver=null;
  if(!("ResizeObserver" in window))window.removeEventListener("resize",resize);
  app?.destroy?.();
  app=null;device=null;pc=null;planet=null;canvas=null;ready=false;
  root?.replaceChildren?.();
}

window.PlanetStage=Object.freeze({
  VERSION,
  start,
  snapshot,
  setRotation,
  rotateBy,
  destroy,
  constants:Object.freeze({
    EARTH_REFERENCE_RADIUS_METERS,
    WORLD_SCALE_FRACTION,
    WORLD_RADIUS_METERS,
    WORLD_DIAMETER_METERS,
    WORLD_CIRCUMFERENCE_METERS:Number(WORLD_CIRCUMFERENCE_METERS.toFixed(3))
  })
});

const boot=()=>start().catch(()=>{});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();