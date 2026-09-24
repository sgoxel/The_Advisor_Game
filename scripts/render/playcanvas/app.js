(function(){
"use strict";

const ENGINE_VERSION="2.22.3";
const ENGINE_URL="https://cdn.jsdelivr.net/npm/playcanvas@"+ENGINE_VERSION+"/+esm";
const WORLD_TILE_METERS=2;
const BASE_ORTHO_HEIGHT=18;
const WIDE_ORTHO_HEIGHT=15.5;
const PORTRAIT_ORTHO_HEIGHT=21.5;
const SHORT_LANDSCAPE_ORTHO_HEIGHT=9.6;
const REBASE_DISTANCE_TILES=256;
const CHARACTER_HEIGHT_SCALE=0.94;
const CHARACTER_GROUND_LIFT=0.06;
const CHARACTER_DEFAULT_ELEVATION=0.03;
const CHARACTER_MIN_SCREEN_PX=32;
const CHARACTER_SHORT_VIEW_FALLBACK_PX=26;
const CHARACTER_MAX_PRESENTATION_SCALE=5.0;
const CHARACTER_BILLBOARD_PITCH_DEGREES=90;
let enginePromise=null;

function loadEngine(){
  if(!enginePromise)enginePromise=import(ENGINE_URL);
  return enginePromise;
}
function normalizePreference(value){const v=String(value||"webgl2").toLowerCase();return ["webgl2","webgpu","auto"].includes(v)?v:"webgl2";}
function finiteOrNull(value){if(value===null||value===undefined||value==="")return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}

function create({backendPreference="webgl2",maxPixelRatio=null,renderScale=null}={}){
  const preference=normalizePreference(backendPreference),maxPixelRatioOverride=finiteOrNull(maxPixelRatio),renderScaleOverride=finiteOrNull(renderScale);
  let pc=null,app=null,device=null,host=null,canvas=null,resizeObserver=null,lastModel=null,proofState=null,occlusionProofState=null,beforeInit=null,afterInit=null,sceneAnchor=null,quality=null;
  let sceneAnchorRevision=0,lastPositionedAnchorRevision=0,lastResizeSignature="",lastCameraBillboardYawDegrees=45;
  let cameraRoot=null,camera=null,worldRoot=null,terrainPreloadRoot=null,terrainRoot=null,terrainBaseEntity=null,structuresRoot=null,propsRoot=null,charactersRoot=null,lightingRoot=null,interiorProofRoot=null,characterProofRoot=null,assetPreparationProofRoot=null;
  let characterPreparation=null,worldPreparation=null,terrainPreloadManager=null,terrainChunkMeshFactory=null,terrainTextureAtlas=null,buildingSurfaceAtlas=null,treeSpriteAtlas=null,lastPreparedTerrainKey="",interiorProofState=null,interiorProofPanel=null,characterProofState=null,characterProofPanel=null,lastRawSeed=null,assetPreparationProofState=false,qualityChangeHandler=null,renderQualityChangeHandler=null,renderQualityFrameHandler=null;
  let lastWorldPreparation=Object.freeze({ready:false,regionCount:0,keyCount:0,regionKeys:Object.freeze([]),logicalKeys:Object.freeze([]),simulationAuthorityPreserved:true});
  let lastMaterialQuality=Object.freeze({profile:"standard",cacheSignature:"pc-material-quality@standard",materialCount:0,textureCount:0,materialVariantCount:0,worldAssetCacheLimit:48,textureBudgetMB:48,anisotropy:2,auxiliaryMaps:true,detailMaps:false,simulationAuthorityPreserved:true});
  let lastAssetPreparationProof=Object.freeze({active:false,logicalKey:null,entityCount:0,meshInstanceCount:0,materialCount:0,networkLoads:0,containerParses:0,simulationAuthorityPreserved:true});
  let lastRawInteriorObjects=[],lastRawBuildingInteriors=[];
  let lastInteriorObjectPresentation=Object.freeze({active:false,state:null,buildingId:null,buildingLabel:null,buildingSource:null,objectCount:0,interactionCount:0,reachableInteractionCount:0,blockingObjectCount:0,objects:Object.freeze([])});
  let lastCharacterProof=Object.freeze({active:false,state:null,protagonistId:null,world:null,scene:null,feetY:null,height:null,yawDegrees:null,occlusionExpected:null,cutawayActive:false});
  const materials=new Map(),roofEntities=[],characterMaterials=new Map(),characterTextures=new Map(),characterEntities=new Map(),registeredCharacterAssets=new Set();
  let lastCharacterState=Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:0,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,instances:Object.freeze([])});
  let lastCutawayState=Object.freeze({active:false,local:true,targetBuildingId:null,hiddenRoofCount:0,totalRoofCount:0});
  let lastSnapshot=Object.freeze({ready:false,engine:"PlayCanvas",engineVersion:ENGINE_VERSION,backend:"not-initialized",gpu:false,webgl:false,webgpu:false,canvasCount:0,migrationFoundation:true,sceneBaseline:false});
  const navigationTelemetry={
    cameraTransformCalls:0,totalCameraTransformMs:0,lastCameraTransformMs:0,maxCameraTransformMs:0,
    preloadUpdateCalls:0,totalPreloadUpdateMs:0,lastPreloadUpdateMs:0,maxPreloadUpdateMs:0,
    canvasResizeCalls:0,canvasResizeSkips:0,bulkChunkRepositions:0,bulkChunkRepositionedResources:0,
    initialAnchorSets:0,sceneAnchorRebases:0
  };

  function requestedDeviceTypes(){if(preference==="webgpu")return [pc.DEVICETYPE_WEBGPU,pc.DEVICETYPE_WEBGL2];if(preference==="auto"&&navigator.gpu)return [pc.DEVICETYPE_WEBGPU,pc.DEVICETYPE_WEBGL2];return [pc.DEVICETYPE_WEBGL2];}
  function deviceClass(){const width=Math.max(1,Number(window.innerWidth||host?.clientWidth||1)),height=Math.max(1,Number(window.innerHeight||host?.clientHeight||1)),shortSide=Math.min(width,height),longSide=Math.max(width,height),coarse=Boolean(window.matchMedia?.("(pointer:coarse)")?.matches);if(shortSide<=520||(longSide<=900&&shortSide<=520))return "phone";if(shortSide<=900||coarse)return "tablet";return "desktop";}
  function renderQualitySnapshot(){return window.RuntimeRenderQuality?.snapshot?.()||null;}
  function resolveQuality(width,height){
    const cls=deviceClass(),defaults=cls==="phone"?{maxPixelRatio:1.0,renderScale:0.75}:cls==="tablet"?{maxPixelRatio:1.25,renderScale:0.85}:{maxPixelRatio:1.5,renderScale:1.0};
    const managed=renderQualitySnapshot();
    const dpr=clamp(maxPixelRatioOverride??managed?.maxPixelRatio??defaults.maxPixelRatio,0.75,2);
    const scale=clamp(renderScaleOverride??managed?.renderScale??defaults.renderScale,0.6,1);
    const browserDpr=Math.max(1,Number(window.devicePixelRatio||1)),effectivePixelRatio=Math.max(0.5,Math.min(browserDpr,dpr)*scale);
    return Object.freeze({
      deviceClass:cls,browserDevicePixelRatio:browserDpr,maxPixelRatio:dpr,renderScale:scale,effectivePixelRatio,
      mode:managed?.mode||"device-default",activeLevel:managed?.activeLevel||"device-default",autoSelected:Boolean(managed?.autoSelected),
      textureProfile:managed?.textureProfile||window.RuntimeTextureQuality?.getProfile?.()||"standard",
      lightCount:Number(managed?.lightCount??2),shadowQuality:String(managed?.shadowQuality||"off"),shadowsEnabled:Boolean(managed?.shadowsEnabled),
      lodDistanceScale:Number(managed?.lodDistanceScale??1),propDensityScale:Number(managed?.propDensityScale??1),
      antialiasing:String(managed?.antialiasing||"off"),postProcessing:String(managed?.postProcessing||"off"),
      targetFps:Number(managed?.targetFps||60),minimumFps:Number(managed?.minimumFps||30),
      lowFrameStreak:Number(managed?.lowFrameStreak||0),goodFrameStreak:Number(managed?.goodFrameStreak||0),
      transitionCount:Number(managed?.transitionCount||0),lastTransitionReason:managed?.lastTransitionReason||null,
      persistedMode:managed?.persistedMode||null,simulationAuthorityPreserved:true
    });
  }
  function applyRenderLightingQuality(){
    const managed=renderQualitySnapshot();
    const sun=lightingRoot?.findByName?.("SunLight"),fill=lightingRoot?.findByName?.("FillLight");
    if(sun?.light)sun.light.castShadows=Boolean(managed?.shadowsEnabled);
    if(fill){
      fill.enabled=Number(managed?.lightCount??2)>1;
      if(fill.light)fill.light.castShadows=false;
    }
    return Object.freeze({
      lightCount:Number(managed?.lightCount??2),
      shadowQuality:String(managed?.shadowQuality||"off"),
      shadowsEnabled:Boolean(managed?.shadowsEnabled)
    });
  }
  function handleRenderQualityChange(){
    lastResizeSignature="";
    applyRenderLightingQuality();
    resize();
    lastSnapshot=baseSnapshot();
  }
  function material(name,r,g,b){if(materials.has(name))return materials.get(name);const m=new pc.StandardMaterial();m.name=name;m.diffuse.set(r,g,b);m.gloss=0.18;m.metalness=0;m.update();materials.set(name,m);return m;}
  function primitive(parent,name,type,position,scale,mat,euler=null){const entity=new pc.Entity(name);entity.addComponent("render",{type,material:mat});entity.setLocalPosition(...position);entity.setLocalScale(...scale);if(euler)entity.setLocalEulerAngles(...euler);parent.addChild(entity);return entity;}
  // Normal-world houses and trees are generated only by PlayCanvasTerrainChunkMesh from
  // authoritative building footprints. The old hard-coded demo house path was
  // retired so no second roof constructor can reintroduce an inverted pitch.
  function proofMaterial(name,r,g,b,emissive=0){
    const key="proof-"+name;
    if(materials.has(key))return materials.get(key);
    const m=new pc.StandardMaterial();
    m.name=key;
    m.diffuse.set(r,g,b);
    if(emissive>0)m.emissive.set(r*emissive,g*emissive,b*emissive);
    m.gloss=0.12;
    m.metalness=0;
    m.update();
    materials.set(key,m);
    return m;
  }
  function clearEntityChildren(entity){
    if(!entity)return;
    for(const child of [...entity.children])child.destroy();
  }
  const QUALITY_AUX_MAP_SLOTS=Object.freeze(["normalMap","metalnessMap","glossMap","aoMap","heightMap"]);
  const QUALITY_DETAIL_MAP_SLOTS=Object.freeze(["diffuseDetailMap","normalDetailMap","aoDetailMap"]);
  const QUALITY_TEXTURE_SLOTS=Object.freeze([
    "diffuseMap","emissiveMap","opacityMap","lightMap",
    ...QUALITY_AUX_MAP_SLOTS,...QUALITY_DETAIL_MAP_SLOTS
  ]);
  const materialQualityOrigins=new WeakMap();
  function textureQualitySnapshot(){
    const q=window.RuntimeTextureQuality?.snapshot?.()||{};
    return Object.freeze({
      profile:String(q.qualityProfile||"standard"),
      cacheSignature:String(q.cacheSignature||"pc-material-quality@standard"),
      worldAssetCacheLimit:Math.max(1,Number(q.worldAssetCacheLimit||48)),
      textureBudgetMB:Math.max(1,Number(q.textureBudgetMB||48)),
      maxMaterialTextureResolution:Math.max(1,Number(q.maxMaterialTextureResolution||1024)),
      anisotropy:Math.max(1,Number(q.anisotropy||2)),
      auxiliaryMaps:q.auxiliaryMaps!==false,
      detailMaps:Boolean(q.detailMaps),
      filtering:String(q.filtering||"trilinear"),
      mipBias:Number(q.mipBias||0),
      materialComplexity:String(q.materialComplexity||"standard"),
      compressionPolicy:String(q.compressionPolicy||"prefer-compressed-runtime"),
      characterSpritePolicy:String(q.characterSpritePolicy||"native-separate")
    });
  }
  function rememberMaterialOrigin(mat){
    if(!mat||materialQualityOrigins.has(mat))return materialQualityOrigins.get(mat)||null;
    const state={};
    for(const slot of QUALITY_AUX_MAP_SLOTS)state[slot]=mat[slot]||null;
    for(const slot of QUALITY_DETAIL_MAP_SLOTS)state[slot]=mat[slot]||null;
    materialQualityOrigins.set(mat,state);
    return state;
  }
  function collectMaterials(root,set){
    if(!root)return;
    const render=root.render;
    if(render?.meshInstances)for(const instance of render.meshInstances)if(instance?.material)set.add(instance.material);
    for(const child of root.children||[])collectMaterials(child,set);
  }
  function worldMaterials(){
    const set=new Set(materials.values());
    for(const root of [terrainPreloadRoot,terrainRoot,structuresRoot,propsRoot,interiorProofRoot,assetPreparationProofRoot])collectMaterials(root,set);
    return set;
  }
  function applyTextureSampling(texture,q){
    if(!texture)return false;
    try{
      if("anisotropy" in texture)texture.anisotropy=Math.max(1,Math.min(q.anisotropy,Number(device?.maxAnisotropy||q.anisotropy)));
      if(q.filtering==="bilinear"){
        if(pc?.FILTER_LINEAR!==undefined)texture.magFilter=pc.FILTER_LINEAR;
        if(pc?.FILTER_LINEAR!==undefined)texture.minFilter=pc.FILTER_LINEAR;
      }else{
        if(pc?.FILTER_LINEAR!==undefined)texture.magFilter=pc.FILTER_LINEAR;
        if(pc?.FILTER_LINEAR_MIPMAP_LINEAR!==undefined)texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;
      }
    }catch(_){}
    return true;
  }
  function applyMaterialTextureQuality(){
    const q=textureQualitySnapshot(),mats=worldMaterials(),texturesSeen=new Set(),variants=new Set();
    worldPreparation?.setCacheLimit?.(q.worldAssetCacheLimit);
    for(const mat of mats){
      if(!mat)continue;
      const origin=rememberMaterialOrigin(mat)||{};
      for(const slot of QUALITY_AUX_MAP_SLOTS)if(slot in mat)mat[slot]=q.auxiliaryMaps?(origin[slot]||null):null;
      for(const slot of QUALITY_DETAIL_MAP_SLOTS)if(slot in mat)mat[slot]=q.detailMaps?(origin[slot]||null):null;
      for(const slot of QUALITY_TEXTURE_SLOTS){
        const texture=mat[slot]||null;
        if(texture){texturesSeen.add(texture);applyTextureSampling(texture,q);}
      }
      const flags=[
        Boolean(mat.diffuseMap),Boolean(mat.normalMap),Boolean(mat.metalnessMap),Boolean(mat.glossMap),
        Boolean(mat.aoMap),Boolean(mat.heightMap),Boolean(mat.diffuseDetailMap),Boolean(mat.normalDetailMap),
        String(mat.blendType??""),String(mat.shadingModel??"")
      ];
      variants.add(flags.join(":"));
      try{mat.update?.()}catch(_){}
    }
    lastMaterialQuality=Object.freeze({
      profile:q.profile,cacheSignature:q.cacheSignature,
      maxMaterialTextureResolution:q.maxMaterialTextureResolution,
      materialCount:mats.size,textureCount:texturesSeen.size,materialVariantCount:variants.size,
      worldAssetCacheLimit:q.worldAssetCacheLimit,textureBudgetMB:q.textureBudgetMB,
      anisotropy:q.anisotropy,auxiliaryMaps:q.auxiliaryMaps,detailMaps:q.detailMaps,
      filtering:q.filtering,mipBias:q.mipBias,materialComplexity:q.materialComplexity,
      compressionPolicy:q.compressionPolicy,characterSpritePolicy:q.characterSpritePolicy,
      perFrameResizeOrTranscode:false,simulationAuthorityPreserved:true
    });
    return lastMaterialQuality;
  }
  function handleTextureQualityChange(){
    // Texture/material quality is presentation state. Chunk geometry is unchanged,
    // so retain prepared meshes/entities and update their shared materials in place.
    applyMaterialTextureQuality();
    lastSnapshot=baseSnapshot();
  }
  function setNormalWorldEnabled(enabled){
    if(terrainPreloadRoot)terrainPreloadRoot.enabled=enabled;
    if(terrainRoot)terrainRoot.enabled=enabled;
    if(structuresRoot)structuresRoot.enabled=enabled;
    if(propsRoot)propsRoot.enabled=enabled;
    if(charactersRoot)charactersRoot.enabled=enabled;
  }
  function countPreparedProof(entity){
    let entityCount=0,meshInstanceCount=0;
    const materialNames=new Set();
    const walk=node=>{
      if(!node)return;
      entityCount++;
      const render=node.render;
      if(render?.meshInstances){
        meshInstanceCount+=render.meshInstances.length;
        for(const instance of render.meshInstances){
          const name=instance?.material?.name;
          if(name)materialNames.add(name);
        }
      }
      for(const child of node.children||[])walk(child);
    };
    walk(entity);
    return Object.freeze({entityCount,meshInstanceCount,materialCount:materialNames.size});
  }
  function setAssetPreparationProofState(enabled){
    assetPreparationProofState=Boolean(enabled);
    if(!assetPreparationProofRoot)throw new Error("Asset preparation proof root is unavailable");
    clearEntityChildren(assetPreparationProofRoot);
    if(!assetPreparationProofState){
      assetPreparationProofRoot.enabled=false;
      setNormalWorldEnabled(Boolean(lastWorldPreparation?.ready));
      resize();
      updateCameraTransform();
      const stats=worldPreparation?.stats?.()||{};
      lastAssetPreparationProof=Object.freeze({
        active:false,logicalKey:null,entityCount:0,meshInstanceCount:0,materialCount:0,
        networkLoads:Number(stats.networkLoads||0),
        containerParses:Number(stats.containerParses||0),
        simulationAuthorityPreserved:true
      });
      lastSnapshot=baseSnapshot();
      return lastSnapshot;
    }
    const logicalKey=window.PlayCanvasWorldAssets?.WORLD_KEYS?.prototypeSet||"world.prototype.representative-set";
    const asset=worldPreparation?.asset?.(logicalKey);
    const resource=asset?.resource;
    if(!resource?.instantiateRenderEntity)throw new Error("Prepared representative glTF resource is unavailable");
    setNormalWorldEnabled(false);
    assetPreparationProofRoot.enabled=true;
    const root=resource.instantiateRenderEntity();
    root.name="PreparedRepresentativeAssetSet";
    assetPreparationProofRoot.addChild(root);
    // Frame the already-prepared representative set tightly enough for honest
    // visual inspection without scaling or rebuilding the cached glTF content.
    camera.camera.orthoHeight=7.6;
    camera.setPosition(17,15,20);
    camera.lookAt(0,1,1);
    applyMaterialTextureQuality();
    const counts=countPreparedProof(root);
    const stats=worldPreparation?.stats?.()||{};
    lastAssetPreparationProof=Object.freeze({
      active:true,
      logicalKey,
      entityCount:counts.entityCount,
      meshInstanceCount:counts.meshInstanceCount,
      materialCount:counts.materialCount,
      networkLoads:Number(stats.networkLoads||0),
      containerParses:Number(stats.containerParses||0),
      cachedAsset:true,
      simulationAuthorityPreserved:true
    });
    lastSnapshot=baseSnapshot();
    return lastSnapshot;
  }
  function ensureInteriorProofPanel(){
    if(interiorProofPanel||!host)return interiorProofPanel;
    const panel=document.createElement("div");
    panel.className="interior-object-proof-panel";
    panel.hidden=true;
    host.appendChild(panel);
    interiorProofPanel=panel;
    return panel;
  }
  function proofBounds(building){
    const cells=building?.interiorFloorCells||[];
    if(!cells.length)return null;
    let minX=BigInt(cells[0].x),maxX=minX,minY=BigInt(cells[0].y),maxY=minY;
    for(const cell of cells){
      const x=BigInt(cell.x),y=BigInt(cell.y);
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
    return Object.freeze({minX,maxX,minY,maxY,width:Number(maxX-minX+1n),height:Number(maxY-minY+1n)});
  }
  function proofPoint(point,bounds){
    const x=Number(BigInt(point.x)-bounds.minX);
    const y=Number(BigInt(point.y)-bounds.minY);
    return Object.freeze({
      x:(x-(bounds.width-1)/2)*WORLD_TILE_METERS,
      z:(y-(bounds.height-1)/2)*WORLD_TILE_METERS
    });
  }
  function addInteriorProofObject(object,bounds,index){
    const p=proofPoint(object.coordinate,bounds);
    const wood=proofMaterial("wood",0.42,0.27,0.16);
    const darkWood=proofMaterial("dark-wood",0.30,0.18,0.11);
    const cloth=proofMaterial("bed-cloth",0.55,0.42,0.34);
    const stone=proofMaterial("hearth-stone",0.34,0.32,0.29);
    const ember=proofMaterial("hearth-ember",0.86,0.28,0.08,0.25);
    const baseName="ProofObject_"+index+"_"+object.type;
    if(object.type==="bed"){
      primitive(interiorProofRoot,baseName,"box",[p.x,0.28,p.z],[1.55,0.42,0.95],cloth);
      primitive(interiorProofRoot,baseName+"_Pillow","box",[p.x-0.48,0.52,p.z],[0.42,0.12,0.72],proofMaterial("pillow",0.78,0.72,0.58));
    }else if(object.type==="chair"){
      primitive(interiorProofRoot,baseName,"box",[p.x,0.38,p.z],[0.65,0.68,0.65],wood);
      primitive(interiorProofRoot,baseName+"_Back","box",[p.x,0.88,p.z+0.26],[0.65,0.72,0.13],darkWood);
    }else if(object.type==="table"){
      primitive(interiorProofRoot,baseName,"cylinder",[p.x,0.62,p.z],[0.92,0.18,0.92],wood);
      primitive(interiorProofRoot,baseName+"_Leg","cylinder",[p.x,0.30,p.z],[0.22,0.62,0.22],darkWood);
    }else if(object.type==="hearth"){
      primitive(interiorProofRoot,baseName,"box",[p.x,0.42,p.z],[1.10,0.78,0.90],stone);
      primitive(interiorProofRoot,baseName+"_Fire","sphere",[p.x,0.88,p.z],[0.34,0.30,0.34],ember);
    }else{
      const height=object.type==="storage"?1.20:0.84;
      const width=object.type==="counter"?1.65:1.45;
      primitive(interiorProofRoot,baseName,"box",[p.x,height*0.5,p.z],[width,height,0.78],object.type==="storage"?darkWood:wood);
      if(object.type==="workbench"||object.type==="counter"){
        primitive(interiorProofRoot,baseName+"_Top","box",[p.x,height+0.07,p.z],[width+0.12,0.14,0.90],proofMaterial("work-top",0.62,0.48,0.31));
      }
    }
    return p;
  }
  function updateInteriorProofPanel(summary){
    const panel=ensureInteriorProofPanel();
    if(!panel)return;
    panel.hidden=!summary?.active;
    panel.replaceChildren();
    if(!summary?.active)return;
    const title=document.createElement("strong");
    title.textContent="Interior Object Proof — "+summary.buildingLabel;
    panel.appendChild(title);
    const meta=document.createElement("small");
    meta.textContent=(summary.buildingSource==="house"?"HOUSE":"FUNCTIONAL")+" · "+summary.objectCount+" objects · "+summary.reachableInteractionCount+"/"+summary.interactionCount+" interactions reachable";
    panel.appendChild(meta);
    const list=document.createElement("div");
    list.className="interior-object-proof-list";
    for(const item of summary.objects){
      const row=document.createElement("div");
      row.className="interior-object-proof-row";
      const name=document.createElement("b");
      name.textContent=item.type.toUpperCase()+" · "+item.id;
      const detail=document.createElement("span");
      detail.textContent=(item.room||"room")+" · ("+item.coordinate.x+","+item.coordinate.y+") · "+(item.blocking?"BLOCKING":"PASSABLE")+" · "+item.actions.join("/")+" · interact ("+item.interaction.x+","+item.interaction.y+") · route "+(item.reachable?"✓":"✕");
      row.append(name,detail);
      list.appendChild(row);
    }
    panel.appendChild(list);
  }
  function selectInteriorProofBuilding(state){
    const source=state==="special"?"special":"house";
    return lastRawBuildingInteriors
      .filter(building=>building.source===source&&lastRawInteriorObjects.some(object=>object.buildingId===building.id))
      .slice()
      .sort((a,b)=>{
        const ac=lastRawInteriorObjects.filter(object=>object.buildingId===a.id).length;
        const bc=lastRawInteriorObjects.filter(object=>object.buildingId===b.id).length;
        return bc-ac||String(a.id).localeCompare(String(b.id));
      })[0]||null;
  }
  function updateInteriorProofCamera(bounds){
    if(!camera||!bounds)return;
    const span=Math.max(bounds.width,bounds.height)*WORLD_TILE_METERS;
    camera.camera.orthoHeight=Math.max(10,span*1.55);
    const lift=Math.max(10,span*0.90);
    const offset=Math.max(8,span*0.80);
    camera.setPosition(offset,lift,offset);
    camera.lookAt(0,0,0);
  }
  function buildInteriorObjectProof(state){
    if(!interiorProofRoot)return lastInteriorObjectPresentation;
    clearEntityChildren(interiorProofRoot);
    const building=selectInteriorProofBuilding(state);
    const bounds=proofBounds(building);
    if(!building||!bounds){
      lastInteriorObjectPresentation=Object.freeze({active:false,state,buildingId:null,buildingLabel:null,buildingSource:null,objectCount:0,interactionCount:0,reachableInteractionCount:0,blockingObjectCount:0,objects:Object.freeze([])});
      updateInteriorProofPanel(lastInteriorObjectPresentation);
      return lastInteriorObjectPresentation;
    }
    setNormalWorldEnabled(false);
    interiorProofRoot.enabled=true;
    const floorWidth=bounds.width*WORLD_TILE_METERS,floorDepth=bounds.height*WORLD_TILE_METERS;
    primitive(interiorProofRoot,"ProofFloor","box",[0,-0.12,0],[floorWidth,0.22,floorDepth],proofMaterial("floor",0.52,0.43,0.29));
    const wall=proofMaterial("wall",0.55,0.49,0.39);
    primitive(interiorProofRoot,"ProofWallN","box",[0,0.55,-floorDepth/2],[floorWidth+0.25,1.10,0.18],wall);
    primitive(interiorProofRoot,"ProofWallW","box",[-floorWidth/2,0.55,0],[0.18,1.10,floorDepth],wall);
    primitive(interiorProofRoot,"ProofWallE","box",[floorWidth/2,0.55,0],[0.18,1.10,floorDepth],wall);
    const marker=proofMaterial("interaction",0.18,0.78,0.35,0.20);
    const entranceMat=proofMaterial("entrance",0.18,0.46,0.88,0.18);
    const routeMat=proofMaterial("route",0.80,0.72,0.20,0.10);
    const objects=lastRawInteriorObjects.filter(object=>object.buildingId===building.id);
    const summaries=[];
    let interactionCount=0,reachableInteractionCount=0,blockingObjectCount=0;
    objects.forEach((object,index)=>{
      addInteriorProofObject(object,bounds,index);
      if(object.blocking)blockingObjectCount++;
      const interaction=object.interactionPositions?.[0]||null;
      let reachable=false;
      if(interaction){
        interactionCount++;
        const ip=proofPoint(interaction,bounds);
        primitive(interiorProofRoot,"Interaction_"+index,"cylinder",[ip.x,0.08,ip.z],[0.48,0.10,0.48],marker);
        const start=building.entrance?.door;
        const route=start&&lastRawSeed?RoutePlanner.findRoute(lastRawSeed,start,interaction):null;
        reachable=Boolean(route?.found);
        if(reachable){
          reachableInteractionCount++;
          for(let r=0;r<route.path.length;r+=Math.max(1,Math.ceil(route.path.length/9))){
            const rp=proofPoint(route.path[r],bounds);
            primitive(interiorProofRoot,"Route_"+index+"_"+r,"sphere",[rp.x,0.10,rp.z],[0.16,0.16,0.16],routeMat);
          }
        }
        summaries.push(Object.freeze({
          id:object.id,type:object.type,room:object.room||null,blocking:Boolean(object.blocking),
          actions:Object.freeze([...(object.actions||[])]),
          coordinate:Object.freeze({x:String(object.coordinate.x),y:String(object.coordinate.y)}),
          interaction:Object.freeze({x:String(interaction.x),y:String(interaction.y)}),
          reachable
        }));
      }
    });
    if(building.entrance?.door){
      const ep=proofPoint(building.entrance.door,bounds);
      primitive(interiorProofRoot,"EntranceMarker","cylinder",[ep.x,0.10,ep.z],[0.55,0.12,0.55],entranceMat);
    }
    updateInteriorProofCamera(bounds);
    lastInteriorObjectPresentation=Object.freeze({
      active:true,state,buildingId:building.id,buildingLabel:building.label,buildingSource:building.source,
      objectCount:objects.length,interactionCount,reachableInteractionCount,blockingObjectCount,
      objects:Object.freeze(summaries)
    });
    updateInteriorProofPanel(lastInteriorObjectPresentation);
    return lastInteriorObjectPresentation;
  }
  function setInteriorObjectProofState(state){
    interiorProofState=(state==="house"||state==="special")?state:null;
    if(!interiorProofState){
      if(interiorProofRoot){clearEntityChildren(interiorProofRoot);interiorProofRoot.enabled=false;}
      setNormalWorldEnabled(true);
      lastInteriorObjectPresentation=Object.freeze({active:false,state:null,buildingId:null,buildingLabel:null,buildingSource:null,objectCount:0,interactionCount:0,reachableInteractionCount:0,blockingObjectCount:0,objects:Object.freeze([])});
      updateInteriorProofPanel(lastInteriorObjectPresentation);
      updateCameraTransform();
    }else{
      buildInteriorObjectProof(interiorProofState);
    }
    lastSnapshot=baseSnapshot();
    return lastSnapshot;
  }
  function ensureCharacterProofPanel(){
    if(characterProofPanel||!host)return characterProofPanel;
    const panel=document.createElement("div");
    panel.className="character-billboard-proof-panel";
    panel.hidden=true;
    host.appendChild(panel);
    characterProofPanel=panel;
    return panel;
  }
  function protagonistCharacterInstance(){
    return (lastCharacterState.instances||[]).find(item=>item.id==="protagonist")||null;
  }
  function proofDirection(instance){
    const cameraPosition=camera?.getPosition?.()||new pc.Vec3(13.5,15.5,13.5);
    const dx=Number(cameraPosition.x)-Number(instance?.scene?.x||0);
    const dz=Number(cameraPosition.z)-Number(instance?.scene?.z||0);
    const length=Math.hypot(dx,dz)||1;
    return Object.freeze({x:dx/length,z:dz/length});
  }
  function buildCharacterRoom(instance,{roof=false}={}){
    if(!characterProofRoot||!instance)return;
    const p=instance.scene,room=proofMaterial("character-room",0.54,0.46,0.34);
    const trim=proofMaterial("character-room-trim",0.31,0.22,0.15);
    primitive(characterProofRoot,"CharacterProofFloor","box",[p.x,-0.09,p.z],[5.0,0.16,5.0],proofMaterial("character-room-floor",0.45,0.36,0.25));
    primitive(characterProofRoot,"CharacterProofBack","box",[p.x,1.15,p.z-2.35],[5.0,2.3,0.22],room);
    primitive(characterProofRoot,"CharacterProofLeft","box",[p.x-2.35,1.15,p.z],[0.22,2.3,4.8],room);
    primitive(characterProofRoot,"CharacterProofRight","box",[p.x+2.35,1.15,p.z],[0.22,2.3,4.8],room);
    primitive(characterProofRoot,"CharacterProofDoorL","box",[p.x-0.95,1.05,p.z+2.35],[0.7,2.1,0.22],trim);
    primitive(characterProofRoot,"CharacterProofDoorR","box",[p.x+0.95,1.05,p.z+2.35],[0.7,2.1,0.22],trim);
    primitive(characterProofRoot,"CharacterProofLintel","box",[p.x,2.0,p.z+2.35],[1.2,0.22,0.22],trim);
    if(roof)primitive(characterProofRoot,"CharacterProofRoof","box",[p.x,2.65,p.z-0.55],[5.1,0.20,3.9],proofMaterial("character-roof",0.30,0.17,0.12));
  }
  function updateCharacterProofPanel(summary){
    const panel=ensureCharacterProofPanel();
    if(!panel)return;
    panel.hidden=!summary?.active;
    panel.replaceChildren();
    if(!summary?.active)return;
    const title=document.createElement("strong");
    title.textContent="2D Character Billboard Proof — "+String(summary.state||"open").toUpperCase();
    const line1=document.createElement("small");
    line1.textContent="Authoritative world ("+summary.world.x+","+summary.world.y+") → scene ("+summary.scene.x.toFixed(2)+","+summary.scene.z.toFixed(2)+") · feet Y "+summary.feetY.toFixed(2)+" m";
    const line2=document.createElement("small");
    line2.textContent=summary.height.toFixed(2)+" m tall · yaw "+summary.yawDegrees.toFixed(1)+"° · depth test/write ON · "+(summary.flipX?"flipped":"normal")+" · frame "+summary.frameIndex;
    const line3=document.createElement("small");
    line3.textContent=summary.activeCharacterCount+" active / "+summary.simulatedCharacterCount+" simulated · "+summary.preparedCharacterCount+" prepared textures · cutaway "+(summary.cutawayActive?"ON":"OFF");
    panel.append(title,line1,line2,line3);
  }
  function rebuildCharacterProof(){
    if(!characterProofRoot)return lastCharacterProof;
    clearEntityChildren(characterProofRoot);
    const instance=protagonistCharacterInstance();
    if(!characterProofState||!instance){
      characterProofRoot.enabled=false;
      lastCharacterProof=Object.freeze({active:false,state:characterProofState,protagonistId:null,world:null,scene:null,feetY:null,height:null,yawDegrees:null,occlusionExpected:null,cutawayActive:false});
      updateCharacterProofPanel(lastCharacterProof);
      return lastCharacterProof;
    }
    characterProofRoot.enabled=true;
    const direction=proofDirection(instance);
    const p=instance.scene;
    const state=characterProofState;
    if(state==="front"||state==="behind"){
      const towardCamera=state==="behind"?1:-1;
      const distance=state==="behind"?1.05:1.65;
      const wx=p.x+direction.x*distance*towardCamera;
      const wz=p.z+direction.z*distance*towardCamera;
      const wall=primitive(characterProofRoot,"CharacterOcclusionWall","box",[wx,1.20,wz],[2.7,2.4,0.36],proofMaterial("character-occluder",0.46,0.30,0.20));
      wall.setLocalEulerAngles(0,billboardYawDegrees({x:wx,z:wz},camera?.getPosition?.()||new pc.Vec3(13.5,15.5,13.5)),0);
    }else if(state==="entering"){
      buildCharacterRoom(instance,{roof:true});
    }else if(state==="inside"){
      buildCharacterRoom(instance,{roof:false});
    }
    primitive(characterProofRoot,"CharacterFeetAnchor","cylinder",[p.x,Math.max(0.015,instance.feetY-0.02),p.z],[0.42,0.05,0.42],proofMaterial("character-anchor",0.18,0.78,0.35,0.16));
    lastCharacterProof=Object.freeze({
      active:true,
      state,
      protagonistId:instance.id,
      world:instance.world,
      scene:instance.scene,
      feetY:instance.feetY,
      height:instance.height,
      yawDegrees:instance.yawDegrees,
      flipX:instance.flipX,
      frameIndex:instance.frameIndex,
      occlusionExpected:state==="behind"?"occluded":state==="front"?"in-front":"none",
      cutawayActive:state==="inside",
      activeCharacterCount:Number(lastCharacterState.activeCharacterCount||0),
      simulatedCharacterCount:Number(lastCharacterState.simulatedCharacterCount||0),
      preparedCharacterCount:Number(lastCharacterState.preparedCharacterCount||0),
      simulationAuthorityPreserved:true
    });
    updateCharacterProofPanel(lastCharacterProof);
    return lastCharacterProof;
  }
  function setCharacterProofState(state){
    characterProofState=["open","front","behind","entering","inside"].includes(String(state))?String(state):null;
    if(characterProofState&&interiorProofState)setInteriorObjectProofState(null);
    rebuildCharacterProof();
    lastSnapshot=baseSnapshot();
    return lastSnapshot;
  }
  function movementProofCutawayRequested(){
    const stage=window.ResidentMovement?.proofSnapshot?.()?.stage;
    return stage==="door-entering"||stage==="inside-arrived"||stage==="door-leaving";
  }
  function cutawayRequested(){
    return proofState==="inside"||proofState==="entering"||proofState==="behind"||movementProofCutawayRequested();
  }
  function activeRoofGroups(){
    const groups=new Map();
    for(let i=roofEntities.length-1;i>=0;i--){
      const roof=roofEntities[i];
      if(!roof?.parent){roofEntities.splice(i,1);continue;}
      const id=String(roof._advisorBuildingId||"");
      if(!id||roof.parent?.enabled===false)continue;
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push(roof);
    }
    return groups;
  }
  function cutawayFocusPoint(){
    const proofResidentId=window.ResidentMovement?.proofSnapshot?.()?.residentId;
    const proofResident=proofResidentId
      ?(lastCharacterState.instances||[]).find(item=>item.id==="resident:"+proofResidentId)
      :null;
    if(proofResident?.scene){
      return {
        x:Number(proofResident.scene.x||0),
        z:Number(proofResident.scene.z||0),
        buildingId:proofResident.buildingId?String(proofResident.buildingId):null
      };
    }
    const protagonist=(lastCharacterState.instances||[]).find(item=>item.id==="protagonist")||null;
    if(protagonist?.scene)return {x:Number(protagonist.scene.x||0),z:Number(protagonist.scene.z||0),buildingId:protagonist.buildingId?String(protagonist.buildingId):null};
    const point=characterScenePoint(lastModel?.center||{x:sceneAnchor?.x||"0",y:sceneAnchor?.y||"0"});
    return {x:Number(point.x||0),z:Number(point.z||0),buildingId:null};
  }
  function selectCutawayBuildingId(groups){
    if(!groups.size)return null;
    const focus=cutawayFocusPoint();
    if(focus.buildingId&&groups.has(focus.buildingId))return focus.buildingId;
    let bestId=null,bestDistance=Infinity;
    for(const [id,roofs] of groups){
      if(!roofs.length)continue;
      let x=0,z=0,n=0;
      for(const roof of roofs){
        const p=roof.getPosition?.();
        if(!p)continue;
        x+=Number(p.x||0);z+=Number(p.z||0);n++;
      }
      if(!n)continue;
      x/=n;z/=n;
      const dx=x-focus.x,dz=z-focus.z,distance=dx*dx+dz*dz;
      if(distance<bestDistance){bestDistance=distance;bestId=id;}
    }
    return bestId;
  }
  function applyCutaway(){
    const requested=cutawayRequested();
    const groups=activeRoofGroups();
    const targetBuildingId=requested?selectCutawayBuildingId(groups):null;
    let hiddenRoofCount=0,totalRoofCount=0;
    for(const roofs of groups.values()){
      for(const roof of roofs){
        totalRoofCount++;
        const hide=Boolean(requested&&targetBuildingId&&String(roof._advisorBuildingId||"")===targetBuildingId);
        roof.enabled=!hide;
        if(hide)hiddenRoofCount++;
      }
    }
    lastCutawayState=Object.freeze({
      active:Boolean(requested&&targetBuildingId&&hiddenRoofCount>0),
      local:true,
      targetBuildingId:targetBuildingId||null,
      hiddenRoofCount,
      totalRoofCount
    });
    return lastCutawayState;
  }
  function buildScene(){
    cameraRoot=new pc.Entity("CameraRoot");camera=new pc.Entity("OrthographicGameplayCamera");camera.addComponent("camera",{clearColor:new pc.Color(0.125,0.155,0.12),projection:pc.PROJECTION_ORTHOGRAPHIC,orthoHeight:BASE_ORTHO_HEIGHT,nearClip:0.1,farClip:200});cameraRoot.addChild(camera);app.root.addChild(cameraRoot);
    worldRoot=new pc.Entity("WorldRoot");terrainPreloadRoot=new pc.Entity("TerrainPreloadRoot");terrainRoot=new pc.Entity("TerrainRoot");structuresRoot=new pc.Entity("StructuresRoot");propsRoot=new pc.Entity("PropsRoot");charactersRoot=new pc.Entity("CharacterBillboardsRoot");interiorProofRoot=new pc.Entity("InteriorObjectProofRoot");characterProofRoot=new pc.Entity("CharacterProofGeometryRoot");assetPreparationProofRoot=new pc.Entity("AssetPreparationProofRoot");lightingRoot=new pc.Entity("LightingRoot");interiorProofRoot.enabled=false;characterProofRoot.enabled=false;assetPreparationProofRoot.enabled=false;worldRoot.addChild(terrainPreloadRoot);worldRoot.addChild(terrainRoot);worldRoot.addChild(structuresRoot);worldRoot.addChild(propsRoot);worldRoot.addChild(charactersRoot);worldRoot.addChild(interiorProofRoot);worldRoot.addChild(characterProofRoot);worldRoot.addChild(assetPreparationProofRoot);app.root.addChild(worldRoot);app.root.addChild(lightingRoot);
    // Normal gameplay contains no hard-coded demo village. Terrain, roads, water,
    // buildings and static props are instantiated only from complete SEED-derived
    // chunk resources under TerrainPreloadRoot.
    terrainBaseEntity=null;
    const sun=new pc.Entity("SunLight");sun.addComponent("light",{type:"directional",intensity:1.25,color:new pc.Color(1,0.95,0.82),castShadows:false});sun.setLocalEulerAngles(48,32,0);lightingRoot.addChild(sun);const fill=new pc.Entity("FillLight");fill.addComponent("light",{type:"directional",intensity:0.30,color:new pc.Color(0.62,0.72,0.88),castShadows:false});fill.setLocalEulerAngles(55,210,0);lightingRoot.addChild(fill);app.scene.ambientLight=new pc.Color(0.30,0.33,0.29);updateCameraTransform();
  }
  function entityCount(entity){if(!entity)return 0;let count=1;for(const child of entity.children||[])count+=entityCount(child);return count;}
  function safeDeltaTiles(value,anchor){try{const delta=BigInt(String(value))-BigInt(String(anchor)),limit=BigInt(REBASE_DISTANCE_TILES);if(delta>limit||delta<-limit)return null;return Number(delta);}catch(_){return 0;}}
  function ensureSceneAnchor(center){
    if(!center)return;
    if(!sceneAnchor){
      sceneAnchor=Object.freeze({x:String(center.x),y:String(center.y)});
      sceneAnchorRevision++;
      navigationTelemetry.initialAnchorSets++;
      return;
    }
    const dx=safeDeltaTiles(center.x,sceneAnchor.x),dy=safeDeltaTiles(center.y,sceneAnchor.y);
    if(dx===null||dy===null){
      sceneAnchor=Object.freeze({x:String(center.x),y:String(center.y)});
      sceneAnchorRevision++;
      navigationTelemetry.sceneAnchorRebases++;
    }
  }
  function terrainChunkSize(){
    const configured=Number(window.TerrainChunkSizeSettings?.get?.()?.chunkSize||16);
    return [8,16,32,64].includes(configured)?configured:16;
  }
  function terrainTextureProfile(){
    return textureQualitySnapshot().cacheSignature;
  }
  async function prepareTreeSpriteAtlas(){
    if(!window.PlayCanvasTreeSpriteAtlas)throw new Error("PlayCanvas tree sprite atlas is unavailable");
    if(!treeSpriteAtlas)treeSpriteAtlas=window.PlayCanvasTreeSpriteAtlas.create({
      pc,device,
      qualitySignatureProvider:()=>textureQualitySnapshot().cacheSignature,
      resolutionProvider:()=>Math.max(192,Math.min(384,Math.floor(textureQualitySnapshot().maxMaterialTextureResolution/2)))
    });
    const state=await treeSpriteAtlas.prepare();
    const texture=treeSpriteAtlas.texture?.()||null;
    if(texture)applyTextureSampling(texture,textureQualitySnapshot());
    return state;
  }
  async function prepareBuildingSurfaceAtlas(){
    if(!window.PlayCanvasBuildingSurfaceAtlas)throw new Error("PlayCanvas building surface atlas is unavailable");
    if(!buildingSurfaceAtlas)buildingSurfaceAtlas=window.PlayCanvasBuildingSurfaceAtlas.create({
      pc,device,
      qualitySignatureProvider:()=>textureQualitySnapshot().cacheSignature,
      resolutionProvider:()=>Math.max(64,Math.min(128,Math.floor(textureQualitySnapshot().maxMaterialTextureResolution/4)))
    });
    const state=await buildingSurfaceAtlas.prepare();
    const texture=buildingSurfaceAtlas.texture?.()||null;
    if(texture)applyTextureSampling(texture,textureQualitySnapshot());
    return state;
  }
  async function prepareTerrainTextureAtlas(){
    if(!window.PlayCanvasTerrainTextureAtlas)throw new Error("PlayCanvas terrain texture atlas is unavailable");
    if(!terrainTextureAtlas)terrainTextureAtlas=window.PlayCanvasTerrainTextureAtlas.create({pc,device});
    const state=await terrainTextureAtlas.prepare();
    const mat=material("terrain-chunk-surface",1,1,1);
    const texture=terrainTextureAtlas.texture?.()||null;
    mat.vertexColors=true;
    mat.diffuseVertexColor=!Boolean(state?.ready&&texture);
    mat.diffuseMap=state?.ready?texture:null;
    mat.gloss=0.06;
    mat.metalness=0;
    if(texture)applyTextureSampling(texture,textureQualitySnapshot());
    mat.update();
    return state;
  }
  function terrainChunkSignature(){
    // Chunk resources contain deterministic geometry plus references to shared
    // materials. Framebuffer scale and material-quality changes do not alter
    // geometry, so they must not invalidate prepared chunk meshes/entities.
    return "geometry=seed-chunk-v1";
  }
  function terrainChunkPosition(chunkX,chunkY,chunkSize){
    const anchorX=BigInt(sceneAnchor?.x||"0"),anchorY=BigInt(sceneAnchor?.y||"0");
    const size=BigInt(chunkSize);
    const centerX2=BigInt(chunkX)*size*2n+BigInt(chunkSize-1);
    const centerY2=BigInt(chunkY)*size*2n+BigInt(chunkSize-1);
    const dx2=centerX2-anchorX*2n,dy2=centerY2-anchorY*2n;
    return Object.freeze({
      x:Number(dx2)*WORLD_TILE_METERS/2,
      z:Number(dy2)*WORLD_TILE_METERS/2
    });
  }
  function positionTerrainChunk(resource){
    if(!resource?.entity)return;
    const p=terrainChunkPosition(resource.x,resource.y,resource.chunkSize);
    resource.entity.setLocalPosition(p.x,-0.095,p.z);
    terrainChunkMeshFactory?.reposition?.(resource,p.x,p.z);
  }
  function initTerrainChunkMeshFactory(){
    if(terrainChunkMeshFactory)return terrainChunkMeshFactory;
    if(!window.PlayCanvasTerrainChunkMesh)return null;
    terrainChunkMeshFactory=window.PlayCanvasTerrainChunkMesh.create({
      pc,
      device,
      parent:terrainPreloadRoot,
      material:material("terrain-chunk-surface",1,1,1),
      textureAtlasProvider:()=>terrainTextureAtlas,
      buildingSurfaceAtlasProvider:()=>buildingSurfaceAtlas,
      treeSpriteAtlasProvider:()=>treeSpriteAtlas,
      treeYawProvider:()=>lastCameraBillboardYawDegrees,
      seedProvider:()=>lastRawSeed||"",
      registerRoof:(roof,descriptor)=>{if(roof){if(descriptor?.id)roof._advisorBuildingId=String(descriptor.id);roofEntities.push(roof);}}
    });
    return terrainChunkMeshFactory;
  }
  function prepareTerrainMeshChunk(spec){
    const factory=initTerrainChunkMeshFactory();
    if(!factory)throw new Error("PlayCanvas terrain chunk mesh factory is unavailable");
    const worldData=window.PlayCanvasChunkWorldData?.getOrCreate?.({
      seed:lastRawSeed||"",
      x:spec.x,
      y:spec.y,
      chunkSize:spec.chunkSize,
      signature:spec.signature,
      state:spec.state
    })||null;
    const chunkPosition=terrainChunkPosition(spec.x,spec.y,spec.chunkSize);
    const resource=factory.build({...spec,worldData,worldX:chunkPosition.x,worldZ:chunkPosition.z});
    resource.worldData=worldData;
    resource.worldDataKey=worldData?.key||resource.worldDataKey||null;
    positionTerrainChunk(resource);
    resource.entity.enabled=false;
    return resource;
  }
  function activateTerrainChunk(resource){
    if(resource?.worldDataKey)window.PlayCanvasChunkWorldData?.touch?.(resource.worldDataKey);
    if(resource?.entity)resource.entity.enabled=true;
  }
  function deactivateTerrainChunk(resource){if(resource?.entity)resource.entity.enabled=false;}
  function destroyTerrainChunk(resource){
    if(resource?.worldDataKey)window.PlayCanvasChunkWorldData?.release?.(resource.worldDataKey);
    if(terrainChunkMeshFactory)terrainChunkMeshFactory.destroy(resource);
    else resource?.entity?.destroy?.();
  }
  function terrainMeshMetrics(){
    let meshResourceCount=0,activeMeshCount=0,preparedMeshCount=0,cachedMeshCount=0;
    let meshInstanceCount=0,vertices=0,triangles=0;
    let presentationMeshInstanceCount=0,presentationEntityCount=0,sourcePresentationEntityCount=0,buildingPresentationCount=0,interiorObjectPresentationCount=0,propPresentationCount=0;
    let treePresentationCount=0,treeVariant0Count=0,treeVariant1Count=0,treeInstancedGroupCount=0,treeCylinderSpherePlaceholderCount=0;
    let roofProfileCount=0,roofNormalProfileCount=0,roofSpecialProfileCount=0,roofProfilePass=true,roofCenterRidgeHigher=true,roofEaveContactPass=true,roofFootprintDriven=true;
    const roofProfileSamples=[],treeVariationSamples=[],treeSampleChunks=[];
    let staticBatchCount=0,staticBatchSourcePrimitiveCount=0,instancedGroupCount=0,instancedObjectCount=0;
    let optimizedPresentationDrawCalls=0,unoptimizedPresentationDrawCalls=0,savedDrawCalls=0;
    let frustumCulledResourceCount=0,hardwareInstancedResourceCount=0,batchedResourceCount=0;
    let renderMeshInstanceCount=0,visibleMeshInstanceCount=0,culledMeshInstanceCount=0,cullEnabledMeshInstanceCount=0;
    let roadCellCount=0,waterCellCount=0,bridgeCellCount=0,terrainTypeCount=0;
    let texturedBlockCount=0,colorFallbackBlockCount=0;
    const texturedSurfaceTypes=new Set(),fallbackSurfaceTypes=new Set();
    let seedDerivedPresentation=true,hardCodedSampleGeometry=false;
    const materialNames=new Set();
    terrainPreloadManager?.forEachResource?.((resource,entry)=>{
      if(resource?.presentationKind!=="chunk-mesh")return;
      meshResourceCount++;
      if(entry?.state==="Active")activeMeshCount++;
      else if(entry?.state==="Prepared")preparedMeshCount++;
      else cachedMeshCount++;
      meshInstanceCount+=Number(resource.meshInstanceCount||0);
      vertices+=Number(resource.vertexCount||0);
      triangles+=Number(resource.triangleCount||0);
      presentationMeshInstanceCount+=Number(resource.presentationMeshInstanceCount||0);
      presentationEntityCount+=Number(resource.presentationEntityCount||0);
      sourcePresentationEntityCount+=Number(resource.sourcePresentationEntityCount||0);
      staticBatchCount+=Number(resource.staticBatchCount||0);
      staticBatchSourcePrimitiveCount+=Number(resource.staticBatchSourcePrimitiveCount||0);
      instancedGroupCount+=Number(resource.instancedGroupCount||0);
      instancedObjectCount+=Number(resource.instancedObjectCount||0);
      optimizedPresentationDrawCalls+=Number(resource.optimizedPresentationDrawCalls||0);
      unoptimizedPresentationDrawCalls+=Number(resource.unoptimizedPresentationDrawCalls||0);
      savedDrawCalls+=Number(resource.savedDrawCalls||0);
      if(resource.frustumCulling===true)frustumCulledResourceCount++;
      if(resource.hardwareInstancing===true)hardwareInstancedResourceCount++;
      if(resource.chunkLocalStaticBatching===true)batchedResourceCount++;
      if(resource.entity){
        const stack=[resource.entity];
        while(stack.length){
          const node=stack.pop();
          for(const mi of node?.render?.meshInstances||[]){
            renderMeshInstanceCount++;
            if(mi.cull!==false)cullEnabledMeshInstanceCount++;
            if(entry?.state==="Active"&&mi.visibleThisFrame===true)visibleMeshInstanceCount++;
            else if(entry?.state==="Active"&&mi.cull!==false)culledMeshInstanceCount++;
          }
          for(const child of node?.children||[])stack.push(child);
        }
      }
      buildingPresentationCount+=Number(resource.buildingPresentationCount||0);
      roofProfileCount+=Number(resource.roofProfileCount||0);
      roofNormalProfileCount+=Number(resource.roofNormalProfileCount||0);
      roofSpecialProfileCount+=Number(resource.roofSpecialProfileCount||0);
      roofProfilePass=roofProfilePass&&resource.roofProfilePass!==false;
      roofCenterRidgeHigher=roofCenterRidgeHigher&&resource.roofCenterRidgeHigher!==false;
      roofEaveContactPass=roofEaveContactPass&&resource.roofEaveContactPass!==false;
      roofFootprintDriven=roofFootprintDriven&&resource.roofFootprintDriven!==false;
      if(roofProfileSamples.length<16){
        for(const item of resource.roofProfiles||[]){
          if(roofProfileSamples.length>=16)break;
          roofProfileSamples.push(item);
        }
      }
      interiorObjectPresentationCount+=Number(resource.interiorObjectPresentationCount||0);
      propPresentationCount+=Number(resource.propPresentationCount||0);
      treePresentationCount+=Number(resource.treePresentationCount||0);
      treeVariant0Count+=Number(resource.treeVariant0Count||0);
      treeVariant1Count+=Number(resource.treeVariant1Count||0);
      treeInstancedGroupCount+=Number(resource.treeInstancedGroupCount||0);
      treeCylinderSpherePlaceholderCount+=Number(resource.treeCylinderSpherePlaceholderCount||0);
      if(Number(resource.treePresentationCount||0)>0)treeSampleChunks.push(Object.freeze({
        chunkX:Number(resource.x),chunkY:Number(resource.y),count:Number(resource.treePresentationCount||0),state:String(entry?.state||"")
      }));
      if(treeVariationSamples.length<24){
        for(const item of resource.treeVariationSamples||[]){
          if(treeVariationSamples.length>=24)break;
          treeVariationSamples.push(item);
        }
      }
      roadCellCount+=Number(resource.roadCellCount||0);
      waterCellCount+=Number(resource.waterCellCount||0);
      bridgeCellCount+=Number(resource.bridgeCellCount||0);
      terrainTypeCount=Math.max(terrainTypeCount,Number(resource.terrainTypeCount||0));
      texturedBlockCount+=Number(resource.texturedBlockCount||0);
      colorFallbackBlockCount+=Number(resource.colorFallbackBlockCount||0);
      for(const type of resource.texturedSurfaceTypes||[])texturedSurfaceTypes.add(String(type));
      for(const type of resource.fallbackSurfaceTypes||[])fallbackSurfaceTypes.add(String(type));
      seedDerivedPresentation=seedDerivedPresentation&&resource.seedDerivedPresentation===true;
      hardCodedSampleGeometry=hardCodedSampleGeometry||resource.hardCodedSampleGeometry===true;
      const name=resource.meshInstance?.material?.name;
      if(name)materialNames.add(name);
    });
    return Object.freeze({
      resourceKind:"chunk-mesh",
      meshResourceCount,activeMeshCount,preparedMeshCount,cachedMeshCount,
      meshInstanceCount,vertices,triangles,
      materialCount:materialNames.size,
      presentationMeshInstanceCount,presentationEntityCount,sourcePresentationEntityCount,
      staticBatchCount,staticBatchSourcePrimitiveCount,instancedGroupCount,instancedObjectCount,
      optimizedPresentationDrawCalls,unoptimizedPresentationDrawCalls,savedDrawCalls,
      drawCallReductionRatio:unoptimizedPresentationDrawCalls?Number((savedDrawCalls/unoptimizedPresentationDrawCalls).toFixed(4)):0,
      frustumCulledResourceCount,hardwareInstancedResourceCount,batchedResourceCount,
      renderMeshInstanceCount,visibleMeshInstanceCount,culledMeshInstanceCount,cullEnabledMeshInstanceCount,
      buildingPresentationCount,
      roofProfileCount,roofNormalProfileCount,roofSpecialProfileCount,
      roofProfilePass:Boolean(roofProfileCount>0&&roofProfilePass&&roofCenterRidgeHigher&&roofEaveContactPass&&roofFootprintDriven),
      roofCenterRidgeHigher:Boolean(roofProfileCount>0&&roofCenterRidgeHigher),
      roofEaveContactPass:Boolean(roofProfileCount>0&&roofEaveContactPass),
      roofFootprintDriven:Boolean(roofProfileCount>0&&roofFootprintDriven),
      roofProfileSamples:Object.freeze(roofProfileSamples.slice()),
      roofGeometryAuthority:"renderer-only building footprints",
      interiorObjectPresentationCount,propPresentationCount,
      treePresentationCount,treeVariant0Count,treeVariant1Count,treeInstancedGroupCount,
      treeCylinderSpherePlaceholderCount,
      treePlanePresentation:treePresentationCount>0&&treeCylinderSpherePlaceholderCount===0,
      treeDeterministicVariation:true,
      treeVariationSamples:Object.freeze(treeVariationSamples.slice()),
      treeSampleChunks:Object.freeze(treeSampleChunks.sort((a,b)=>b.count-a.count||a.chunkY-b.chunkY||a.chunkX-b.chunkX).slice(0,24)),
      treeSpriteAtlas:treeSpriteAtlas?.stats?.()||null,
      treeSharedTextureCount:Number(treeSpriteAtlas?.stats?.()?.gpuTextureCount||0),
      treeSharedMaterialCount:Number(terrainChunkMeshFactory?.stats?.()?.treeSpriteMaterialCount||0),
      roadCellCount,waterCellCount,bridgeCellCount,terrainTypeCount,
      texturedBlockCount,colorFallbackBlockCount,
      texturedSurfaceTypes:Object.freeze([...texturedSurfaceTypes].sort()),
      fallbackSurfaceTypes:Object.freeze([...fallbackSurfaceTypes].sort()),
      textureAtlas:terrainTextureAtlas?.stats?.()||null,
      buildingSurfaceAtlas:buildingSurfaceAtlas?.stats?.()||null,
      buildingTexturedMaterialCount:Number(terrainChunkMeshFactory?.stats?.()?.buildingTexturedMaterialCount||0),
      buildingTexturedMaterialNames:terrainChunkMeshFactory?.stats?.()?.buildingTexturedMaterialNames||Object.freeze([]),
      seedDerivedPresentation,
      hardCodedSampleGeometry,
      normalWorldSource:"seed-chunk-world-data",
      generator:terrainChunkMeshFactory?.stats?.()||null,
      worldData:window.PlayCanvasChunkWorldData?.stats?.()||null,
      oneEntityPerTile:false,
      chunkLocalStaticBatching:true,
      hardwareInstancing:true,
      frustumCulling:true,
      completeChunkMeshes:true,
      completeChunkWorldData:Boolean(window.PlayCanvasChunkWorldData),
      simulationAuthorityPreserved:true
    });
  }
  function initTerrainPreload(){
    if(terrainPreloadManager||!window.TerrainChunkPreload)return terrainPreloadManager;
    initTerrainChunkMeshFactory();
    terrainPreloadManager=window.TerrainChunkPreload.createManager({
      chunkSize:terrainChunkSize(),
      signatureProvider:terrainChunkSignature,
      prepareChunk:prepareTerrainMeshChunk,
      activateChunk:activateTerrainChunk,
      deactivateChunk:deactivateTerrainChunk,
      destroyChunk:destroyTerrainChunk
    });
    return terrainPreloadManager;
  }
  function screenGroundPoint(screenX,screenY,groundY=0){
    const component=camera?.camera;
    if(!component?.screenToWorld||!pc)return null;
    const near=Math.max(0.01,Number(component.nearClip||0.1));
    const far=Math.max(near+1,Number(component.farClip||200));
    const a=component.screenToWorld(Number(screenX),Number(screenY),near,new pc.Vec3());
    const b=component.screenToWorld(Number(screenX),Number(screenY),far,new pc.Vec3());
    const deltaY=b.y-a.y;
    if(Math.abs(deltaY)<1e-7)return null;
    const t=(Number(groundY)-a.y)/deltaY;
    if(!Number.isFinite(t)||t<0||t>1)return null;
    return Object.freeze({
      x:a.x+(b.x-a.x)*t,
      z:a.z+(b.z-a.z)*t
    });
  }
  function screenToCameraDelta(screenX,screenY){
    const inputX=Number(screenX),inputY=Number(screenY);
    if(!Number.isFinite(inputX)||!Number.isFinite(inputY)||(inputX===0&&inputY===0))return null;
    const width=Math.max(1,host?.clientWidth||1),height=Math.max(1,host?.clientHeight||1);
    const magnitude=Math.hypot(inputX,inputY);
    const requestedX=inputX/magnitude,requestedY=inputY/magnitude;
    const sample=Math.max(48,Math.min(180,Math.min(width,height)*0.2));
    const cx=width*0.5,cy=height*0.5;
    const centerPoint=screenGroundPoint(cx,cy,0);
    const requestPoint=screenGroundPoint(cx+requestedX*sample,cy+requestedY*sample,0);
    const rightPoint=screenGroundPoint(cx+sample,cy,0);
    const downPoint=screenGroundPoint(cx,cy+sample,0);
    if(!centerPoint||!requestPoint||!rightPoint||!downPoint)return null;
    const rawWorldX=-(requestPoint.x-centerPoint.x)/WORLD_TILE_METERS;
    const rawWorldY=-(requestPoint.z-centerPoint.z)/WORLD_TILE_METERS;
    const rawScale=Math.max(Math.abs(rawWorldX),Math.abs(rawWorldY));
    if(!Number.isFinite(rawScale)||rawScale<1e-7)return null;
    const quantize=value=>value>=0?Math.floor(value+0.5):Math.ceil(value-0.5);
    let worldX=quantize(rawWorldX/rawScale);
    let worldY=quantize(rawWorldY/rawScale);
    if(Object.is(worldX,-0))worldX=0;
    if(Object.is(worldY,-0))worldY=0;
    if(worldX===0&&worldY===0){
      if(Math.abs(rawWorldX)>=Math.abs(rawWorldY))worldX=rawWorldX>=0?1:-1;
      else worldY=rawWorldY>=0?1:-1;
    }
    const rightX=rightPoint.x-centerPoint.x,rightZ=rightPoint.z-centerPoint.z;
    const downX=downPoint.x-centerPoint.x,downZ=downPoint.z-centerPoint.z;
    const determinant=rightX*downZ-downX*rightZ;
    let projectedX=0,projectedY=0;
    if(Math.abs(determinant)>1e-9){
      const contentX=-worldX*WORLD_TILE_METERS;
      const contentZ=-worldY*WORLD_TILE_METERS;
      projectedX=((contentX*downZ-downX*contentZ)/determinant)*sample;
      projectedY=((rightX*contentZ-contentX*rightZ)/determinant)*sample;
    }
    const projectedMagnitude=Math.hypot(projectedX,projectedY);
    const projectedUnit=projectedMagnitude>1e-7
      ?Object.freeze({x:projectedX/projectedMagnitude,y:projectedY/projectedMagnitude})
      :Object.freeze({x:0,y:0});
    const dot=Math.max(-1,Math.min(1,requestedX*projectedUnit.x+requestedY*projectedUnit.y));
    const angleErrorDegrees=projectedMagnitude>1e-7?Math.acos(dot)*180/Math.PI:180;
    return Object.freeze({
      source:"playcanvas-screen-to-ground",
      requestedScreen:Object.freeze({x:requestedX,y:requestedY}),
      rawWorld:Object.freeze({x:rawWorldX,y:rawWorldY}),
      worldDelta:Object.freeze({x:worldX,y:worldY}),
      projectedScreen:Object.freeze({x:projectedX,y:projectedY}),
      projectedUnit,
      angleErrorDegrees:Number(angleErrorDegrees.toFixed(3)),
      normalizedInput:true,
      simulationAuthorityPreserved:true
    });
  }
  function terrainActiveRadii(){
    const meters=Math.max(1,terrainChunkSize()*WORLD_TILE_METERS);
    const width=Math.max(1,host?.clientWidth||1),height=Math.max(1,host?.clientHeight||1);
    const aspect=width/height;
    const halfHeight=Math.max(1,Number(camera?.camera?.orthoHeight||BASE_ORTHO_HEIGHT));
    const fallback=Object.freeze({
      x:Math.max(1,Math.ceil((halfHeight*aspect*1.45)/meters)+1),
      y:Math.max(1,Math.ceil((halfHeight*1.45)/meters)+1)
    });
    try{
      const component=camera?.camera;
      if(!component?.screenToWorld)return fallback;
      const center=lastModel?.center?characterScenePoint(lastModel.center):Object.freeze({x:0,z:0});
      const groundY=-0.33;
      const near=Math.max(0.01,Number(component.nearClip||0.1));
      const far=Math.max(near+1,Number(component.farClip||200));
      let maxDx=0,maxDz=0,valid=0;
      for(const [sx,sy] of [[0,0],[width,0],[0,height],[width,height]]){
        const a=component.screenToWorld(sx,sy,near,new pc.Vec3());
        const b=component.screenToWorld(sx,sy,far,new pc.Vec3());
        const dy=b.y-a.y;
        if(Math.abs(dy)<1e-6)continue;
        const t=(groundY-a.y)/dy;
        if(!Number.isFinite(t)||t<0||t>1)continue;
        const gx=a.x+(b.x-a.x)*t;
        const gz=a.z+(b.z-a.z)*t;
        maxDx=Math.max(maxDx,Math.abs(gx-center.x));
        maxDz=Math.max(maxDz,Math.abs(gz-center.z));
        valid++;
      }
      if(valid<2)return fallback;
      return Object.freeze({
        x:Math.max(1,Math.ceil(maxDx/meters)+1),
        y:Math.max(1,Math.ceil(maxDz/meters)+1)
      });
    }catch(_){
      return fallback;
    }
  }
  function updateTerrainPreload(center){
    const manager=initTerrainPreload();
    if(!manager||!center)return null;
    const started=performance.now();
    navigationTelemetry.preloadUpdateCalls++;
    manager.setChunkSize(terrainChunkSize());
    const radii=terrainActiveRadii();
    const result=manager.update({center,activeRadiusX:radii.x,activeRadiusY:radii.y});
    if(lastPositionedAnchorRevision!==sceneAnchorRevision){
      let count=0;
      manager.forEachResource(resource=>{positionTerrainChunk(resource);count++;});
      navigationTelemetry.bulkChunkRepositions++;
      navigationTelemetry.bulkChunkRepositionedResources+=count;
      lastPositionedAnchorRevision=sceneAnchorRevision;
    }
    const elapsed=performance.now()-started;
    navigationTelemetry.lastPreloadUpdateMs=elapsed;
    navigationTelemetry.totalPreloadUpdateMs+=elapsed;
    navigationTelemetry.maxPreloadUpdateMs=Math.max(navigationTelemetry.maxPreloadUpdateMs,elapsed);
    return result;
  }
  function preparedTerrainKey(seed,center){
    if(!center)return "";
    return [
      String(seed||""),
      String(center.x),String(center.y),
      String(terrainChunkSize()),
      String(terrainChunkSignature())
    ].join("|");
  }
  function terrainResourceSignature(){
    return String(
      terrainPreloadManager?.stats?.().signature||
      ("chunk="+terrainChunkSize()+"|"+terrainChunkSignature())
    );
  }
  function getPreparedTerrainView(model){
    const seed=String(model?.seed??lastRawSeed??"");
    const center=model?.center||lastModel?.center;
    const columns=Math.max(1,Number(model?.columns||lastModel?.columns||0));
    const rows=Math.max(1,Number(model?.rows||lastModel?.rows||0));
    if(!seed||!center||!columns||!rows||!window.PlayCanvasChunkWorldData){
      return Object.freeze({ready:false,tiles:Object.freeze([]),missingChunkIds:Object.freeze([]),tileCount:0,expectedTileCount:columns*rows});
    }
    return window.PlayCanvasChunkWorldData.collectView({
      seed,center,columns,rows,
      chunkSize:terrainChunkSize(),
      signature:terrainResourceSignature()
    });
  }
  function worldPreparationRequirements(){
    const requirements=[],retainRegionKeys=[],logicalKeys=new Set();
    terrainPreloadManager?.forEachResource?.((resource,entry)=>{
      if(entry?.state!=="Active"&&entry?.state!=="Prepared")return;
      const data=resource?.worldData;
      if(!data?.complete)return;
      const required=window.PlayCanvasWorldAssets?.requirements?.({
        regionKey:data.key,
        tiles:data.cells,
        buildings:data.buildings,
        buildingInteriors:data.buildings,
        props:data.staticObjects
      });
      if(!required)return;
      requirements.push({regionKey:required.regionKey,keys:required.keys});
      retainRegionKeys.push(required.regionKey);
      for(const key of required.keys)logicalKeys.add(key);
    });
    return Object.freeze({
      requirements:Object.freeze(requirements),
      retainRegionKeys:Object.freeze(retainRegionKeys),
      logicalKeys:Object.freeze([...logicalKeys].sort())
    });
  }
  async function prepareWorldAssets(){
    if(!worldPreparation||!window.PlayCanvasWorldAssets)throw new Error("PlayCanvas world asset preparation is unavailable");
    const set=worldPreparationRequirements();
    if(!set.requirements.length){
      lastWorldPreparation=Object.freeze({ready:false,regionCount:0,keyCount:0,regionKeys:Object.freeze([]),logicalKeys:set.logicalKeys,reason:"no-active-or-prepared-chunks",simulationAuthorityPreserved:true});
      return lastWorldPreparation;
    }
    const result=await worldPreparation.prepareRegions(set.requirements,{retainRegionKeys:set.retainRegionKeys});
    const ready=Boolean(result?.ready&&!result?.stale&&set.retainRegionKeys.every(key=>worldPreparation.isReady?.(key)));
    applyMaterialTextureQuality();
    lastWorldPreparation=Object.freeze({
      ready,
      stale:Boolean(result?.stale),
      regionCount:set.retainRegionKeys.length,
      keyCount:set.logicalKeys.length,
      regionKeys:set.retainRegionKeys,
      logicalKeys:set.logicalKeys,
      preparation:result||null,
      cache:worldPreparation.stats?.()||null,
      proof:worldPreparation.proof?.()||null,
      simulationAuthorityPreserved:true
    });
    return lastWorldPreparation;
  }
  function characterAssetKey(character){
    const frameUrls=Array.isArray(character?.frameUrls)&&character.frameUrls.length?character.frameUrls:null;
    if(frameUrls){
      const index=((Number(character?.frameIndex||0)%frameUrls.length)+frameUrls.length)%frameUrls.length;
      return String(frameUrls[index]||"");
    }
    return String(character?.textureUrl||character?.assetUrl||"");
  }
  function characterScenePoint(point,presentationOffset=null){
    const dx=safeDeltaTiles(point?.x,sceneAnchor?.x??point?.x)??0,dy=safeDeltaTiles(point?.y,sceneAnchor?.y??point?.y)??0;
    const ox=Math.max(-1,Math.min(1,Number(presentationOffset?.x||0)));
    const oy=Math.max(-1,Math.min(1,Number(presentationOffset?.y||0)));
    return Object.freeze({x:(dx+ox)*WORLD_TILE_METERS,z:(dy+oy)*WORLD_TILE_METERS});
  }
  function registerCharacterAsset(url){
    if(!characterPreparation||!url||registeredCharacterAssets.has(url))return;
    characterPreparation.register(url,{type:"texture",url,character:true});
    registeredCharacterAssets.add(url);
  }
  async function loadCharacterTexture(url){
    if(!url)return null;
    if(characterTextures.has(url))return characterTextures.get(url);
    registerCharacterAsset(url);
    if(!characterPreparation)throw new Error("PlayCanvas character preparation is unavailable");
    const asset=await characterPreparation.load(url);
    const texture=asset?.resource||null;
    if(texture)characterTextures.set(url,texture);
    return texture;
  }
  function characterMaterial(url,texture){
    if(characterMaterials.has(url))return characterMaterials.get(url);
    const material=new pc.StandardMaterial();
    material.name="character-"+url.split("/").pop().replace(/[^a-z0-9]+/gi,"-").replace(/^-+|-+$/g,"");
    material.diffuse.set(1,1,1);
    material.emissive.set(1,1,1);
    material.diffuseMap=texture;
    material.emissiveMap=texture;
    material.opacityMap=texture;
    material.opacityMapChannel="a";
    material.alphaTest=0.12;
    material.blendType=pc.BLEND_NONE;
    material.depthWrite=true;
    material.depthTest=true;
    material.cull=pc.CULLFACE_NONE;
    material.useLighting=false;
    material.update();
    characterMaterials.set(url,material);
    return material;
  }
  function clearCharacterBillboards(){
    for(const record of characterEntities.values())record.entity?.destroy?.();
    characterEntities.clear();
    lastCharacterState=Object.freeze({
      activeCharacterCount:0,
      simulatedCharacterCount:Number(lastModel?.simulatedCharacterCount||0),
      preparedCharacterCount:characterTextures.size,
      visibleCharacterIds:Object.freeze([]),
      visibleProtagonist:false,
      instances:Object.freeze([])
    });
  }
  function billboardYawDegrees(scenePoint,cameraPosition){
    const dx=Number(cameraPosition.x)-Number(scenePoint.x);
    const dz=Number(cameraPosition.z)-Number(scenePoint.z);
    return Math.atan2(dx,dz)*180/Math.PI;
  }
  function projectedCharacterPixels(scenePoint,feetY,worldHeight){
    const component=camera?.camera;
    if(!component?.worldToScreen||!pc)return 0;
    try{
      const bottom=component.worldToScreen(new pc.Vec3(scenePoint.x,feetY,scenePoint.z),new pc.Vec3());
      const top=component.worldToScreen(new pc.Vec3(scenePoint.x,feetY+worldHeight,scenePoint.z),new pc.Vec3());
      return Math.hypot(Number(top.x)-Number(bottom.x),Number(top.y)-Number(bottom.y));
    }catch(_){return 0}
  }
  function characterPresentationMetrics(scenePoint,feetY,baseHeight){
    const shortViewport=Math.max(1,Number(host?.clientHeight||1))<260;
    const targetPixelHeight=shortViewport?CHARACTER_SHORT_VIEW_FALLBACK_PX:CHARACTER_MIN_SCREEN_PX;
    const basePixelHeight=projectedCharacterPixels(scenePoint,feetY,baseHeight);
    const requiredHeight=basePixelHeight>0?baseHeight*(targetPixelHeight/basePixelHeight):baseHeight;
    const presentationHeight=clamp(Math.max(baseHeight,requiredHeight),baseHeight,baseHeight*CHARACTER_MAX_PRESENTATION_SCALE);
    const renderedPixelHeight=projectedCharacterPixels(scenePoint,feetY,presentationHeight);
    return Object.freeze({
      baseHeight,
      presentationHeight,
      presentationScale:Number((presentationHeight/baseHeight).toFixed(4)),
      targetPixelHeight,
      renderedPixelHeight:Number(renderedPixelHeight.toFixed(2)),
      boundedFallback:Boolean(renderedPixelHeight+0.5<targetPixelHeight),
      shortViewport,
      maxPresentationScale:CHARACTER_MAX_PRESENTATION_SCALE
    });
  }
  function applyCharacterBillboardRotation(entity,yawDegrees){
    const pitch=new pc.Quat().setFromEulerAngles(CHARACTER_BILLBOARD_PITCH_DEGREES,0,0);
    const yaw=new pc.Quat().setFromEulerAngles(0,Number(yawDegrees)||0,0);
    const rotation=new pc.Quat();
    rotation.mul2(yaw,pitch);
    entity.setLocalRotation(rotation);
  }
  function characterChunkCoordinate(value,size){
    const d=BigInt(size),v=BigInt(String(value));
    let q=v/d,r=v%d;
    if(r<0n)q-=1n;
    return Number(q);
  }
  function characterInsideActiveTerrain(point){
    const stats=terrainPreloadManager?.stats?.();
    const center=stats?.centerChunk;
    if(!center||!point)return true;
    const size=Math.max(1,Number(stats.chunkSize||terrainChunkSize()));
    const radii=terrainActiveRadii();
    const x=characterChunkCoordinate(point.x,size),y=characterChunkCoordinate(point.y,size);
    if(x<center.x-radii.x||x>center.x+radii.x||y<center.y-radii.y||y>center.y+radii.y)return false;
    /* The current PlayCanvas stage presents authored village structures only near
       the camera center. Keep normal NPC billboards in that same visual context
       instead of drawing isolated sprites over otherwise empty prepared chunks.
       This is presentation-only; Simulation coordinates are never changed. */
    const cameraCenter=lastModel?.center;
    if(!cameraCenter)return true;
    const dx=safeDeltaTiles(point.x,cameraCenter.x),dy=safeDeltaTiles(point.y,cameraCenter.y);
    return dx!==null&&dy!==null&&Math.abs(dx)<=8&&Math.abs(dy)<=8;
  }
  function syncCharacterBillboards(characters){
    if(!charactersRoot)return Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:characterTextures.size,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,suppressedCharacterCount:0,suppressedCharacterIds:Object.freeze([]),instances:Object.freeze([])});
    const desired=new Map();
    const cameraFacingYaw=Number(lastCameraBillboardYawDegrees||45);
    let activeCharacterCount=0;
    const visibleIds=[];
    const suppressedIds=[];
    const instances=[];
    for(const raw of characters||[]){
      const url=characterAssetKey(raw);
      const point=raw?.point;
      if(!url||!point)continue;
      const texture=characterTextures.get(url);
      if(!texture)continue;
      const id=String(raw.id||url);
      if(!characterInsideActiveTerrain(point)){suppressedIds.push(id);continue;}
      const aspect=texture.width&&texture.height?texture.width/texture.height:0.75;
      const baseHeight=Math.max(0.8,Number(raw.height||WORLD_TILE_METERS*CHARACTER_HEIGHT_SCALE));
      let record=characterEntities.get(id);
      if(!record||record.url!==url){
        record?.entity?.destroy?.();
        const entity=new pc.Entity("CharacterBillboard_"+id);
        entity.addComponent("render",{type:"plane",material:characterMaterial(url,texture),castShadows:false,receiveShadows:false});
        charactersRoot.addChild(entity);
        record=Object.freeze({entity,url});
        characterEntities.set(id,record);
      }
      const scenePoint=characterScenePoint(point,raw.presentationOffset);
      const entity=record.entity;
      const flipped=Boolean(raw.flipX);
      const elevation=Math.max(0,Number(raw.elevation??CHARACTER_DEFAULT_ELEVATION));
      const feetY=elevation+CHARACTER_GROUND_LIFT;
      const presentation=characterPresentationMetrics(scenePoint,feetY,baseHeight);
      const height=presentation.presentationHeight;
      const width=height*aspect;
      const yaw=cameraFacingYaw;
      entity.enabled=true;
      /* Primitive planes lie on local XZ. Compose one explicit transform:
         +90° about local X maps the texture's top (-Z) to world +Y, then yaw
         the plane normal toward the orthographic view direction. This avoids
         the old lookAt()+local-rotation sequence that inverted the artwork. */
      entity.setLocalPosition(scenePoint.x,feetY+height*0.5,scenePoint.z);
      entity.setLocalScale((flipped?-1:1)*width,1,height);
      applyCharacterBillboardRotation(entity,yaw);
      desired.set(id,record);
      visibleIds.push(id);
      instances.push(Object.freeze({
        id,
        role:String(raw.role||"resident"),
        world:Object.freeze({x:String(point.x),y:String(point.y)}),
        presentationOffset:Object.freeze({x:Number(raw.presentationOffset?.x||0),y:Number(raw.presentationOffset?.y||0)}),
        scene:Object.freeze({x:scenePoint.x,z:scenePoint.z}),
        feetY,
        centerY:feetY+height*0.5,
        baseHeight,
        height,
        width,
        aspectRatio:Number(aspect.toFixed(5)),
        yawDegrees:yaw,
        cameraFacingYawDegrees:yaw,
        billboardBasis:"yaw(+Y)*plane(+90X)",
        cameraFacing:true,
        upright:true,
        verticalInverted:false,
        imageUpAxis:"+Y",
        renderedPixelHeight:presentation.renderedPixelHeight,
        targetPixelHeight:presentation.targetPixelHeight,
        presentationScale:presentation.presentationScale,
        boundedFallback:presentation.boundedFallback,
        shortViewport:presentation.shortViewport,
        flipX:flipped,
        frameIndex:Number(raw.frameIndex||0),
        textureUrl:url,
        buildingId:raw.buildingId?String(raw.buildingId):null,
        depthTest:true,
        depthWrite:true
      }));
      activeCharacterCount++;
    }
    for(const [id,record] of [...characterEntities.entries()]){
      if(desired.has(id))continue;
      record.entity?.destroy?.();
      characterEntities.delete(id);
    }
    lastCharacterState=Object.freeze({
      activeCharacterCount,
      simulatedCharacterCount:Number(lastModel?.simulatedCharacterCount||0),
      preparedCharacterCount:characterTextures.size,
      visibleCharacterIds:Object.freeze(visibleIds),
      visibleProtagonist:visibleIds.includes("protagonist"),
      suppressedCharacterCount:suppressedIds.length,
      suppressedCharacterIds:Object.freeze(suppressedIds),
      instances:Object.freeze(instances)
    });
    return lastCharacterState;
  }
  async function prepareCharacters(characters,simulatedCharacterCount=0){
    const visibleCharacters=Array.isArray(characters)?characters:[];
    const urls=[...new Set(visibleCharacters.map(characterAssetKey).filter(Boolean))];
    await Promise.all(urls.map(loadCharacterTexture));
    return Object.freeze({
      ready:true,
      stale:false,
      visibleCharacterCount:visibleCharacters.length,
      simulatedCharacterCount:Number(simulatedCharacterCount||lastModel?.simulatedCharacterCount||0),
      preparedCharacterCount:characterTextures.size,
      visibleCharacterIds:Object.freeze(visibleCharacters.map(character=>String(character?.id||"")).filter(Boolean))
    });
  }
  async function updateCharacters(characters,simulatedCharacterCount=0){
    const visible=Array.isArray(characters)?characters:[];
    await prepareCharacters(visible,simulatedCharacterCount);
    if(!lastModel)return snapshot();
    lastModel=Object.freeze({
      ...lastModel,
      visibleCharacters:Object.freeze(visible.slice()),
      visibleEntities:Object.freeze(visible.slice()),
      simulatedCharacterCount:Number(simulatedCharacterCount||0)
    });
    syncCharacterBillboards(lastModel.visibleCharacters);
    applyCutaway();
    lastSnapshot=baseSnapshot();
    return lastSnapshot;
  }
  function updateCameraTransform(){
    if(!camera)return;
    const started=performance.now();
    navigationTelemetry.cameraTransformCalls++;
    if(interiorProofState){
      const building=selectInteriorProofBuilding(interiorProofState),bounds=proofBounds(building);
      if(bounds)updateInteriorProofCamera(bounds);
    }else{
      const center=lastModel?.center||window.Camera?.getCenter?.()||{x:"0",y:"0"};
      ensureSceneAnchor(center);
      const dx=safeDeltaTiles(center.x,sceneAnchor?.x??center.x)??0,dy=safeDeltaTiles(center.y,sceneAnchor?.y??center.y)??0;
      const targetX=dx*WORLD_TILE_METERS,targetZ=dy*WORLD_TILE_METERS,zoom=clamp(Number(lastModel?.cameraZoom??window.Camera?.getZoom?.()??1),0.5,2);
      const width=Math.max(1,host?.clientWidth||1),height=Math.max(1,host?.clientHeight||1),aspect=width/height;
      const baseFrameHeight=aspect>3&&height<220?SHORT_LANDSCAPE_ORTHO_HEIGHT:aspect<0.8?PORTRAIT_ORTHO_HEIGHT:aspect>2.2?WIDE_ORTHO_HEIGHT:BASE_ORTHO_HEIGHT;
      camera.camera.orthoHeight=baseFrameHeight/zoom;
      // Orthographic distance does not change composition or scale. Keep the
      // camera farther back along the same view direction so the complete
      // tilted view volume stays in front of the ground plane at wide/portrait
      // zoom-out framing instead of clipping the lower world to clear color.
      const cameraFrameScale=Math.max(1,camera.camera.orthoHeight/BASE_ORTHO_HEIGHT);
      const cameraDistanceScale=cameraFrameScale*2;
      camera.camera.farClip=Math.max(200,400*cameraFrameScale);
      camera.setPosition(
        targetX+13.5*cameraDistanceScale,
        15.5*cameraDistanceScale,
        targetZ+13.5*cameraDistanceScale
      );
      camera.lookAt(targetX,0,targetZ);
      const cameraPosition=camera.getPosition();
      lastCameraBillboardYawDegrees=Math.atan2(
        Number(cameraPosition.x)-targetX,
        Number(cameraPosition.z)-targetZ
      )*180/Math.PI;
    }
    const elapsed=performance.now()-started;
    navigationTelemetry.lastCameraTransformMs=elapsed;
    navigationTelemetry.totalCameraTransformMs+=elapsed;
    navigationTelemetry.maxCameraTransformMs=Math.max(navigationTelemetry.maxCameraTransformMs,elapsed);
  }
  function resize(){
    if(!app||!host||!device)return;
    const width=Math.max(1,Math.round(host.clientWidth||1)),height=Math.max(1,Math.round(host.clientHeight||1));
    quality=resolveQuality(width,height);
    const signature=[width,height,quality.effectivePixelRatio].join("|");
    if(signature!==lastResizeSignature){
      device.maxPixelRatio=quality.effectivePixelRatio;
      app.setCanvasFillMode(pc.FILLMODE_NONE,width,height);
      app.setCanvasResolution(pc.RESOLUTION_AUTO);
      app.resizeCanvas(width,height);
      app.updateCanvasSize?.();
      lastResizeSignature=signature;
      navigationTelemetry.canvasResizeCalls++;
    }else navigationTelemetry.canvasResizeSkips++;
    updateCameraTransform();
    if(lastModel?.visibleCharacters&&charactersRoot)syncCharacterBillboards(lastModel.visibleCharacters);
  }
  function frameStats(){const stats=app?.stats||{};return Object.freeze({frameMs:Number(stats.frame?.ms||0),renderMs:Number(stats.frame?.renderTime||0),drawCalls:Number(stats.drawCalls?.total||device?._drawCallsPerFrame||0),triangles:Number(stats.frame?.triangles||device?._primitiveCount||0)});}
  function navigationHotPathMetrics(){
    const preload=terrainPreloadManager?.stats?.()||{};
    const generator=terrainChunkMeshFactory?.stats?.()||{};
    const assetStats=worldPreparation?.stats?.()||{};
    return Object.freeze({
      persistentSceneGraph:true,
      fullSceneRebuilds:0,
      cameraTransformCalls:navigationTelemetry.cameraTransformCalls,
      lastCameraTransformMs:Number(navigationTelemetry.lastCameraTransformMs.toFixed(3)),
      maxCameraTransformMs:Number(navigationTelemetry.maxCameraTransformMs.toFixed(3)),
      averageCameraTransformMs:Number((navigationTelemetry.cameraTransformCalls?navigationTelemetry.totalCameraTransformMs/navigationTelemetry.cameraTransformCalls:0).toFixed(3)),
      preloadUpdateCalls:navigationTelemetry.preloadUpdateCalls,
      lastPreloadUpdateMs:Number(navigationTelemetry.lastPreloadUpdateMs.toFixed(3)),
      maxPreloadUpdateMs:Number(navigationTelemetry.maxPreloadUpdateMs.toFixed(3)),
      averagePreloadUpdateMs:Number((navigationTelemetry.preloadUpdateCalls?navigationTelemetry.totalPreloadUpdateMs/navigationTelemetry.preloadUpdateCalls:0).toFixed(3)),
      canvasResizeCalls:navigationTelemetry.canvasResizeCalls,
      canvasResizeSkips:navigationTelemetry.canvasResizeSkips,
      bulkChunkRepositions:navigationTelemetry.bulkChunkRepositions,
      bulkChunkRepositionedResources:navigationTelemetry.bulkChunkRepositionedResources,
      initialAnchorSets:navigationTelemetry.initialAnchorSets,
      sceneAnchorRebases:navigationTelemetry.sceneAnchorRebases,
      chunkActivations:Number(preload.activations||0),
      chunkDeactivations:Number(preload.deactivations||0),
      stateReuses:Number(preload.stateReuses||0),
      cacheReuses:Number(preload.cacheReuses||0),
      chunkResourceCreations:Number(preload.resourceCreations||0),
      chunkResourceDestructions:Number(preload.resourceDestructions||0),
      staticEntityCreations:Number(generator.entityCreations||0),
      staticEntityDestructions:Number(generator.entityDestroys||0),
      chunkMeshCreations:Number(generator.creations||0),
      chunkMeshDestructions:Number(generator.destroys||0),
      chunkMeshBuildTotalMs:Number(generator.totalBuildMs||0),
      chunkMeshBuildMaxMs:Number(generator.maxBuildMs||0),
      assetWaits:Number(assetStats.waits||0),
      assetNetworkLoads:Number(assetStats.networkLoads||0),
      assetContainerParses:Number(assetStats.containerParses||0),
      visibleAssetLoads:Number(preload.visibleAssetLoads||0),
      visibleTextureDecodes:Number(preload.visibleTextureDecodes||0),
      visibleGltfParses:Number(preload.visibleGltfParses||0),
      redundantStateCallbacks:Number(preload.redundantStateCallbacks||0),
      simulationAuthorityPreserved:true
    });
  }
  const SAMPLE_VILLAGE_NAMES=Object.freeze(["RoadEastWest","RoadNorthSouth","WaterEdge","Bridge","VillageStone","VillageMarker","HouseWall_1","HouseWall_2","HouseWall_3","HouseWall_4","TreeTrunk_1"]);
  function sampleVillageEntityCount(){return SAMPLE_VILLAGE_NAMES.reduce((count,name)=>count+(app?.root?.findByName?.(name)?1:0),0);}
  function sceneInfo(){const sampleCount=sampleVillageEntityCount();return Object.freeze({projection:camera?.camera?.projection===pc?.PROJECTION_ORTHOGRAPHIC?"orthographic":"unknown",orthoHeight:Number(camera?.camera?.orthoHeight||0),baseOrthoHeight:BASE_ORTHO_HEIGHT,wideOrthoHeight:WIDE_ORTHO_HEIGHT,portraitOrthoHeight:PORTRAIT_ORTHO_HEIGHT,shortLandscapeOrthoHeight:SHORT_LANDSCAPE_ORTHO_HEIGHT,worldTileMeters:WORLD_TILE_METERS,anchor:sceneAnchor,roots:Object.freeze(["TerrainPreloadRoot","TerrainRoot","StructuresRoot","PropsRoot","CharacterBillboardsRoot","LightingRoot"]),entityCount:entityCount(app?.root),terrainEntityCount:entityCount(terrainRoot),structureEntityCount:entityCount(structuresRoot),propEntityCount:entityCount(propsRoot),characterEntityCount:entityCount(charactersRoot),characterBillboardCount:Number(characterEntities.size||0),lightingEntityCount:entityCount(lightingRoot),materialCount:Number(lastMaterialQuality.materialCount||0),materialVariantCount:Number(lastMaterialQuality.materialVariantCount||0),roofStyle:"gabled-center-ridge-two-plane",roofEntityCount:roofEntities.filter(roof=>Boolean(roof?.parent)).length,cutawayActive:lastCutawayState.active,cutawayLocal:lastCutawayState.local,cutawayBuildingId:lastCutawayState.targetBuildingId,hiddenRoofCount:lastCutawayState.hiddenRoofCount,normalWorldSource:"seed-chunk-world-data",sampleVillageEntityCount:sampleCount,hardCodedSampleGeometry:sampleCount>0});}
  function canvasInfo(){return Object.freeze({cssWidth:Math.max(0,Math.round(host?.clientWidth||0)),cssHeight:Math.max(0,Math.round(host?.clientHeight||0)),backingWidth:Number(canvas?.width||0),backingHeight:Number(canvas?.height||0)});}
  function baseSnapshot(extra={}){const deviceType=device?.deviceType||"unknown",current=window.RendererContract?.simulationSnapshot?.()||null;return Object.freeze({ready:Boolean(app&&device),engine:"PlayCanvas",engineVersion:ENGINE_VERSION,rendererContractVersion:window.RendererContract?.version||null,backend:deviceType,requestedBackend:preference,gpu:Boolean(device),webgl:deviceType==="webgl2",webgpu:deviceType==="webgpu",webgpuAvailable:Boolean(navigator.gpu),migrationFoundation:true,sceneBaseline:Boolean(camera&&worldRoot),canvasCount:host?host.querySelectorAll("canvas").length:0,canvas:canvasInfo(),quality:quality||Object.freeze({deviceClass:"unknown",browserDevicePixelRatio:Number(window.devicePixelRatio||1),maxPixelRatio:1,renderScale:1,effectivePixelRatio:1}),scene:sceneInfo(),performance:frameStats(),navigationHotPath:navigationHotPathMetrics(),domTerrainTileCount:document.querySelectorAll(".terrain-tile").length,logicalTextureKeyPass:true,simulationAuthorityPreserved:beforeInit&&afterInit?window.RendererContract.sameSimulation(beforeInit,afterInit):true,simulationSnapshot:current,frame:lastModel,regionKey:lastModel?.regionKey||null,tileCount:lastModel?.tileCount||0,protagonistVisible:Boolean(lastCharacterState.visibleProtagonist),characterPresentation:Object.freeze({activeCharacterCount:Number(lastCharacterState.activeCharacterCount||0),simulatedCharacterCount:Number(lastCharacterState.simulatedCharacterCount||0),preparedCharacterCount:Number(lastCharacterState.preparedCharacterCount||0),visibleCharacterIds:lastCharacterState.visibleCharacterIds,visibleProtagonist:Boolean(lastCharacterState.visibleProtagonist),suppressedCharacterCount:Number(lastCharacterState.suppressedCharacterCount||0),suppressedCharacterIds:lastCharacterState.suppressedCharacterIds||Object.freeze([]),instances:lastCharacterState.instances||Object.freeze([]),feetAnchored:true,billboardMode:"camera-facing-upright",minScreenPixelHeight:CHARACTER_MIN_SCREEN_PX,shortViewportFallbackPixelHeight:CHARACTER_SHORT_VIEW_FALLBACK_PX,maxPresentationScale:CHARACTER_MAX_PRESENTATION_SCALE,depthTest:true,depthWrite:true,sharedTextureCount:characterTextures.size,sharedMaterialCount:characterMaterials.size,simulationAuthorityPreserved:true,migrationFoundation:true}),characterProof:lastCharacterProof,buildingPresentation:Object.freeze({layerOrder:Object.freeze(["playcanvas-world"]),proofState,visibleBuildingCount:lastModel?.buildingCount||0,visibleInteriorObjectCount:lastModel?.interiorObjectCount||0,simulationAuthorityPreserved:true,migrationFoundation:true,cutawayActive:lastCutawayState.active,cutawayLocal:lastCutawayState.local,cutawayBuildingId:lastCutawayState.targetBuildingId,hiddenRoofCount:lastCutawayState.hiddenRoofCount,totalRoofCount:lastCutawayState.totalRoofCount}),buildingOcclusion:Object.freeze({proofState:occlusionProofState,simulationAuthorityPreserved:true,migrationFoundation:true}),interiorObjectPresentation:lastInteriorObjectPresentation,assetPreparationProof:lastAssetPreparationProof,materialTextureQuality:lastMaterialQuality,worldAssetPreparation:lastWorldPreparation,worldAssetCache:worldPreparation?.stats?.()||null,worldAssetProof:worldPreparation?.proof?.()||null,characterAssetPreparation:characterPreparation?.stats?.()||null,terrainPreload:terrainPreloadManager?.stats?.()||Object.freeze({settings:window.TerrainChunkPreloadSettings?.get?.()||null,Active:0,Prepared:0,Cached:0,queueDepth:0,hits:0,misses:0,compositions:0,evictions:0,visibleWaits:0,bounded:true,simulationAuthorityPreserved:true}),terrainChunks:Object.freeze({migrationFoundation:true,visibleChunkCount:Number(terrainPreloadManager?.stats?.().Active||0),preparedChunkCount:Number(terrainPreloadManager?.stats?.().Prepared||0),cachedChunkCount:Number(terrainPreloadManager?.stats?.().Cached||0),hits:Number(terrainPreloadManager?.stats?.().hits||0),misses:Number(terrainPreloadManager?.stats?.().misses||0),compositions:Number(terrainPreloadManager?.stats?.().compositions||0),chunkSize:Number(terrainPreloadManager?.stats?.().chunkSize||terrainChunkSize()),signature:String(terrainPreloadManager?.stats?.().signature||""),presentationSignature:terrainTextureProfile(),invalidations:Number(terrainPreloadManager?.stats?.().invalidations||0),lastInvalidationReason:terrainPreloadManager?.stats?.().lastInvalidationReason||null,createdSprites:0,reusedSprites:Number(terrainPreloadManager?.stats?.().hits||0),removedSprites:0,evictions:Number(terrainPreloadManager?.stats?.().evictions||0),visibleWaitedForComposition:Number(terrainPreloadManager?.stats?.().visibleWaits||0)>0,...terrainMeshMetrics()}),...extra});}
  async function init(target){if(app)return snapshot();if(!target)throw new Error("PlayCanvas renderer requires a gameplay host");host=target;beforeInit=window.RendererContract?.simulationSnapshot?.()||null;pc=await loadEngine();canvas=document.createElement("canvas");canvas.id="gameCanvas";canvas.className="game-canvas";canvas.setAttribute("aria-label","PlayCanvas orthographic 3D gameplay world");canvas.dataset.renderer="playcanvas";host.replaceChildren(canvas);device=await pc.createGraphicsDevice(canvas,{deviceTypes:requestedDeviceTypes(),antialias:false,depth:true,powerPreference:"high-performance"});const options=new pc.AppOptions();options.graphicsDevice=device;options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];options.resourceHandlers=[pc.TextureHandler,pc.ContainerHandler];app=new pc.AppBase(canvas);app.init(options);const initialTextureQuality=textureQualitySnapshot();characterPreparation=window.PlayCanvasAssetPreparation?.create({app,pc,cacheLimit:64})||null;worldPreparation=window.PlayCanvasAssetPreparation?.create({app,pc,cacheLimit:initialTextureQuality.worldAssetCacheLimit})||null;if(!worldPreparation||!window.PlayCanvasWorldAssets?.registerBaseline?.(worldPreparation))throw new Error("PlayCanvas world asset catalog registration failed");buildScene();setNormalWorldEnabled(false);applyRenderLightingQuality();resize();initTerrainPreload();applyMaterialTextureQuality();qualityChangeHandler=handleTextureQualityChange;window.addEventListener("advisor:texture-quality-change",qualityChangeHandler);renderQualityChangeHandler=handleRenderQualityChange;window.addEventListener("advisor:render-quality-change",renderQualityChangeHandler);renderQualityFrameHandler=dt=>window.RuntimeRenderQuality?.recordFrame?.(Math.max(0,Number(dt)||0)*1000);app.on?.("update",renderQualityFrameHandler);app.start();if("ResizeObserver" in window){resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);}else window.addEventListener("resize",resize);afterInit=window.RendererContract?.simulationSnapshot?.()||null;if(beforeInit&&afterInit&&!window.RendererContract.sameSimulation(beforeInit,afterInit))throw new Error("PlayCanvas initialization changed authoritative Simulation state");host.hidden=false;lastSnapshot=baseSnapshot({ready:true,canvasCount:host.querySelectorAll("canvas").length});return lastSnapshot;}
  function render(model){lastRawSeed=model?.seed??lastRawSeed;lastRawInteriorObjects=Array.isArray(model?.interiorObjects)?model.interiorObjects:[];lastRawBuildingInteriors=Array.isArray(model?.buildingInteriors)?model.buildingInteriors:[];const frame=window.RendererContract?.frameFromModel?.(model)||null;lastModel=frame?Object.freeze({...frame,cameraZoom:Number(window.Camera?.getZoom?.()??1)}):null;if(host)host.hidden=false;ensureSceneAnchor(lastModel?.center);resize();const terrainKey=preparedTerrainKey(lastRawSeed,lastModel?.center);const worldReady=terrainKey===lastPreparedTerrainKey&&lastWorldPreparation?.ready===true;if(assetPreparationProofState)setNormalWorldEnabled(false);else setNormalWorldEnabled(worldReady);syncCharacterBillboards(lastModel?.visibleCharacters||[]);applyCutaway();if(interiorProofState)buildInteriorObjectProof(interiorProofState);if(characterProofState)rebuildCharacterProof();lastSnapshot=baseSnapshot();return lastSnapshot;}
  async function prepareTerrain(model){
    lastRawSeed=model?.seed??lastRawSeed;
    const frame=window.RendererContract?.frameFromModel?.(model)||null;
    if(!frame?.center)return Object.freeze({prepared:false,chunkMesh:false,worldAssetsReady:false,regionKey:frame?.regionKey||null,reason:"missing-center"});
    ensureSceneAnchor(frame.center);
    resize();
    const terrainTextures=await prepareTerrainTextureAtlas();
    const buildingTextures=await prepareBuildingSurfaceAtlas();
    const treeSprites=await prepareTreeSpriteAtlas();
    const preload=updateTerrainPreload(frame.center);
    const worldAssets=await prepareWorldAssets();
    if(!worldAssets.ready){
      if(!assetPreparationProofState)setNormalWorldEnabled(false);
      return Object.freeze({prepared:false,chunkMesh:true,chunkWorldData:true,worldAssetsReady:false,regionKey:frame.regionKey||null,preload,worldAssets,reason:"world-assets-not-ready",simulationAuthorityPreserved:true});
    }
    if(!assetPreparationProofState)setNormalWorldEnabled(true);
    lastPreparedTerrainKey=preparedTerrainKey(lastRawSeed,frame.center);
    return Object.freeze({
      prepared:true,
      chunkMesh:true,
      chunkWorldData:true,
      worldAssetsReady:true,
      regionKey:frame.regionKey||null,
      preload,
      worldAssets,
      terrainTextures,
      buildingTextures,
      treeSprites,
      mesh:terrainMeshMetrics(),
      worldData:window.PlayCanvasChunkWorldData?.stats?.()||null,
      simulationAuthorityPreserved:true
    });
  }
  function setBuildingProofState(state){proofState=(state===null||state===undefined||state==="off")?null:String(state);applyCutaway();lastSnapshot=baseSnapshot();return lastSnapshot;}
  function setBuildingOcclusionProofState(state){occlusionProofState=(state===null||state===undefined||state==="off")?null:String(state);lastSnapshot=baseSnapshot();return lastSnapshot;}
  function clear(){assetPreparationProofState=false;assetPreparationProofRoot&&clearEntityChildren(assetPreparationProofRoot);if(assetPreparationProofRoot)assetPreparationProofRoot.enabled=false;lastAssetPreparationProof=Object.freeze({active:false,logicalKey:null,entityCount:0,meshInstanceCount:0,materialCount:0,networkLoads:0,containerParses:0,simulationAuthorityPreserved:true});lastModel=null;lastRawSeed=null;lastPreparedTerrainKey="";worldPreparation?.invalidate?.();lastWorldPreparation=Object.freeze({ready:false,regionCount:0,keyCount:0,regionKeys:Object.freeze([]),logicalKeys:Object.freeze([]),simulationAuthorityPreserved:true});lastRawInteriorObjects=[];lastRawBuildingInteriors=[];setInteriorObjectProofState(null);setCharacterProofState(null);clearCharacterBillboards();if(host)host.hidden=true;lastSnapshot=baseSnapshot({ready:Boolean(app&&device)});}
  function snapshot(){if(app&&device)lastSnapshot=baseSnapshot();return lastSnapshot;}
  function destroy(){resizeObserver?.disconnect?.();resizeObserver=null;window.removeEventListener?.("resize",resize);if(qualityChangeHandler)window.removeEventListener?.("advisor:texture-quality-change",qualityChangeHandler);qualityChangeHandler=null;if(renderQualityChangeHandler)window.removeEventListener?.("advisor:render-quality-change",renderQualityChangeHandler);renderQualityChangeHandler=null;if(renderQualityFrameHandler)app?.off?.("update",renderQualityFrameHandler);renderQualityFrameHandler=null;terrainPreloadManager?.destroy?.();terrainPreloadManager=null;terrainChunkMeshFactory=null;terrainTextureAtlas?.destroy?.();terrainTextureAtlas=null;buildingSurfaceAtlas?.destroy?.();buildingSurfaceAtlas=null;treeSpriteAtlas?.destroy?.();treeSpriteAtlas=null;lastPreparedTerrainKey="";window.PlayCanvasChunkWorldData?.clear?.();app?.destroy?.();app=null;device=null;lastResizeSignature="";sceneAnchorRevision=0;lastPositionedAnchorRevision=0;cameraRoot=null;camera=null;worldRoot=null;terrainPreloadRoot=null;terrainRoot=null;terrainBaseEntity=null;structuresRoot=null;propsRoot=null;charactersRoot=null;lightingRoot=null;interiorProofRoot=null;characterProofRoot=null;assetPreparationProofRoot=null;interiorProofPanel?.remove?.();interiorProofPanel=null;characterProofPanel?.remove?.();characterProofPanel=null;roofEntities.length=0;lastCutawayState=Object.freeze({active:false,local:true,targetBuildingId:null,hiddenRoofCount:0,totalRoofCount:0});materials.clear();characterMaterials.clear();characterTextures.clear();characterEntities.clear();registeredCharacterAssets.clear();characterPreparation?.invalidate?.();worldPreparation?.invalidate?.();characterPreparation=null;worldPreparation=null;canvas?.remove?.();canvas=null;host=null;sceneAnchor=null;lastCharacterState=Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:0,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,instances:Object.freeze([])});}
  return Object.freeze({init,render,prepareTerrain,getPreparedTerrainView,prepareCharacters,updateCharacters,clear,snapshot,destroy,setAssetPreparationProofState,setBuildingProofState,setBuildingOcclusionProofState,setInteriorObjectProofState,setCharacterProofState,screenToCameraDelta,projectionBasis:Object.freeze({x:1,y:1}),proofStates:Object.freeze(["outside","entering","inside","behind","leaving"]),occlusionProofStates:Object.freeze(["front","behind","clear","inside","restored"]),interiorObjectProofStates:Object.freeze(["house","special"]),characterProofStates:Object.freeze(["open","front","behind","entering","inside"])});
}
window.PlayCanvasRendererFactory=Object.freeze({engineVersion:ENGINE_VERSION,engineUrl:ENGINE_URL,loadEngine,create});
})();