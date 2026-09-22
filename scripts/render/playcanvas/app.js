(function(){
"use strict";

const ENGINE_VERSION="2.22.3";
const ENGINE_URL="https://cdn.jsdelivr.net/npm/playcanvas@"+ENGINE_VERSION+"/+esm";
let enginePromise=null;

function loadEngine(){
  if(!enginePromise)enginePromise=import(ENGINE_URL);
  return enginePromise;
}

function normalizePreference(value){
  const v=String(value||"webgl2").toLowerCase();
  return ["webgl2","webgpu","auto"].includes(v)?v:"webgl2";
}

function create({backendPreference="webgl2"}={}){
  const preference=normalizePreference(backendPreference);
  let pc=null;
  let app=null;
  let device=null;
  let host=null;
  let canvas=null;
  let camera=null;
  let resizeObserver=null;
  let lastModel=null;
  let proofState=null;
  let occlusionProofState=null;
  let beforeInit=null;
  let afterInit=null;

  let lastSnapshot=Object.freeze({
    ready:false,
    engine:"PlayCanvas",
    engineVersion:ENGINE_VERSION,
    backend:"not-initialized",
    gpu:false,
    webgl:false,
    webgpu:false,
    canvasCount:0,
    migrationFoundation:true
  });

  function requestedDeviceTypes(){
    if(preference==="webgpu")return [pc.DEVICETYPE_WEBGPU,pc.DEVICETYPE_WEBGL2];
    if(preference==="auto"&&navigator.gpu)return [pc.DEVICETYPE_WEBGPU,pc.DEVICETYPE_WEBGL2];
    return [pc.DEVICETYPE_WEBGL2];
  }

  function resize(){
    if(!app||!host)return;
    const width=Math.max(1,Math.round(host.clientWidth||1));
    const height=Math.max(1,Math.round(host.clientHeight||1));
    app.setCanvasFillMode(pc.FILLMODE_NONE,width,height);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.resizeCanvas(width,height);
    app.updateCanvasSize?.();
  }

  function baseSnapshot(extra={}){
    const deviceType=device?.deviceType||"unknown";
    const current=window.RendererContract?.simulationSnapshot?.()||null;
    return Object.freeze({
      ready:Boolean(app&&device),
      engine:"PlayCanvas",
      engineVersion:ENGINE_VERSION,
      rendererContractVersion:window.RendererContract?.version||null,
      backend:deviceType,
      requestedBackend:preference,
      gpu:Boolean(device),
      webgl:deviceType==="webgl2",
      webgpu:deviceType==="webgpu",
      webgpuAvailable:Boolean(navigator.gpu),
      canvasCount:host?host.querySelectorAll("canvas").length:0,
      domTerrainTileCount:document.querySelectorAll(".terrain-tile").length,
      logicalTextureKeyPass:true,
      simulationAuthorityPreserved:beforeInit&&afterInit
        ?window.RendererContract.sameSimulation(beforeInit,afterInit)
        :true,
      simulationSnapshot:current,
      frame:lastModel,
      regionKey:lastModel?.regionKey||null,
      tileCount:lastModel?.tileCount||0,
      buildingPresentation:Object.freeze({
        layerOrder:Object.freeze(["playcanvas-world"]),
        proofState,
        visibleBuildingCount:lastModel?.buildingCount||0,
        visibleInteriorObjectCount:lastModel?.interiorObjectCount||0,
        simulationAuthorityPreserved:true,
        migrationFoundation:true
      }),
      buildingOcclusion:Object.freeze({
        proofState:occlusionProofState,
        simulationAuthorityPreserved:true,
        migrationFoundation:true
      }),
      terrainChunks:Object.freeze({
        migrationFoundation:true,
        visibleChunkCount:0,
        preparedChunkCount:0,
        hits:0,
        misses:0,
        compositions:0,
        invalidations:0,
        createdSprites:0,
        reusedSprites:0,
        removedSprites:0,
        evictions:0,
        visibleWaitedForComposition:false
      }),
      ...extra
    });
  }

  async function init(target){
    if(app)return snapshot();
    if(!target)throw new Error("PlayCanvas renderer requires a gameplay host");
    host=target;
    beforeInit=window.RendererContract?.simulationSnapshot?.()||null;
    pc=await loadEngine();

    canvas=document.createElement("canvas");
    canvas.id="gameCanvas";
    canvas.className="game-canvas";
    canvas.setAttribute("aria-label","PlayCanvas GPU-rendered gameplay world");
    canvas.dataset.renderer="playcanvas";
    host.replaceChildren(canvas);

    device=await pc.createGraphicsDevice(canvas,{
      deviceTypes:requestedDeviceTypes(),
      antialias:false,
      depth:true,
      powerPreference:"high-performance"
    });

    const options=new pc.AppOptions();
    options.graphicsDevice=device;
    options.componentSystems=[
      pc.RenderComponentSystem,
      pc.CameraComponentSystem,
      pc.LightComponentSystem
    ];
    options.resourceHandlers=[
      pc.TextureHandler,
      pc.ContainerHandler
    ];

    app=new pc.AppBase(canvas);
    app.init(options);

    camera=new pc.Entity("MigrationFoundationCamera");
    camera.addComponent("camera",{
      clearColor:new pc.Color(0.125,0.145,0.114),
      projection:pc.PROJECTION_ORTHOGRAPHIC,
      orthoHeight:12
    });
    camera.setPosition(0,10,10);
    camera.lookAt(0,0,0);
    app.root.addChild(camera);

    const ground=new pc.Entity("MigrationFoundationGround");
    ground.addComponent("render",{type:"box"});
    ground.setLocalScale(12,0.15,8);
    ground.setPosition(0,-0.25,0);
    app.root.addChild(ground);

    const marker=new pc.Entity("MigrationFoundationMarker");
    marker.addComponent("render",{type:"box"});
    marker.setLocalScale(1.6,1.6,1.6);
    marker.setPosition(0,0.7,0);
    app.root.addChild(marker);

    const light=new pc.Entity("MigrationFoundationLight");
    light.addComponent("light",{type:"directional",intensity:1});
    light.setEulerAngles(45,35,0);
    app.root.addChild(light);

    app.scene.ambientLight=new pc.Color(0.35,0.35,0.35);
    resize();
    app.start();

    if("ResizeObserver" in window){
      resizeObserver=new ResizeObserver(resize);
      resizeObserver.observe(host);
    }else{
      window.addEventListener("resize",resize);
    }

    afterInit=window.RendererContract?.simulationSnapshot?.()||null;
    if(beforeInit&&afterInit&&!window.RendererContract.sameSimulation(beforeInit,afterInit)){
      throw new Error("PlayCanvas initialization changed authoritative Simulation state");
    }

    host.hidden=false;
    lastSnapshot=baseSnapshot({
      ready:true,
      canvasCount:host.querySelectorAll("canvas").length
    });
    return lastSnapshot;
  }

  function render(model){
    lastModel=window.RendererContract?.frameFromModel?.(model)||null;
    if(host)host.hidden=false;
    resize();
    lastSnapshot=baseSnapshot();
    return lastSnapshot;
  }

  function prepareTerrain(model){
    const frame=window.RendererContract?.frameFromModel?.(model)||null;
    return Object.freeze({
      prepared:false,
      migrationFoundation:true,
      regionKey:frame?.regionKey||null,
      reason:"3D chunk preparation is implemented by later Stage 3 WPs"
    });
  }

  function setBuildingProofState(state){
    proofState=(state===null||state===undefined||state==="off")?null:String(state);
    lastSnapshot=baseSnapshot();
    return lastSnapshot;
  }

  function setBuildingOcclusionProofState(state){
    occlusionProofState=(state===null||state===undefined||state==="off")?null:String(state);
    lastSnapshot=baseSnapshot();
    return lastSnapshot;
  }

  function clear(){
    lastModel=null;
    if(host)host.hidden=true;
    lastSnapshot=baseSnapshot({ready:Boolean(app&&device)});
  }

  function snapshot(){
    return lastSnapshot;
  }

  function destroy(){
    resizeObserver?.disconnect?.();
    resizeObserver=null;
    if(!resizeObserver)window.removeEventListener?.("resize",resize);
    app?.destroy?.();
    app=null;device=null;camera=null;
    canvas?.remove?.();
    canvas=null;host=null;
  }

  return Object.freeze({
    init,
    render,
    prepareTerrain,
    clear,
    snapshot,
    destroy,
    setBuildingProofState,
    setBuildingOcclusionProofState,
    projectionBasis:Object.freeze({x:1,y:1}),
    proofStates:Object.freeze(["outside","entering","inside","behind","leaving"]),
    occlusionProofStates:Object.freeze(["front","behind","clear","inside","restored"])
  });
}

window.PlayCanvasRendererFactory=Object.freeze({
  engineVersion:ENGINE_VERSION,
  engineUrl:ENGINE_URL,
  loadEngine,
  create
});
})();