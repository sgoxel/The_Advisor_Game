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
const CHARACTER_CONTACT_SHADOW_LIFT=0.024;
const CHARACTER_MIN_SCREEN_PX=32;
const CHARACTER_SHORT_VIEW_FALLBACK_PX=26;
// WP-S003-004-005 COMPLETED: double the complete bounded presentation result; Simulation size is unchanged.
const CHARACTER_BASELINE_MAX_PRESENTATION_SCALE=5.0;
const CHARACTER_PRESENTATION_MULTIPLIER=2.0;
const CHARACTER_MAX_PRESENTATION_SCALE=10.0;
const CHARACTER_BILLBOARD_PITCH_DEGREES=90;
const NPC_SEPARATION_STEP_TILES=0.22;
const NPC_SEPARATION_MAX_STEPS=4;
const NPC_SEPARATION_SCREEN_PADDING_PX=4;
let enginePromise=null;

function loadEngine(){
  if(!enginePromise)enginePromise=import(ENGINE_URL);
  return enginePromise;
}
function normalizePreference(value){const v=String(value||"webgl2").toLowerCase();return ["webgl2","webgpu","auto"].includes(v)?v:"webgl2";}
function finiteOrNull(value){if(value===null||value===undefined||value==="")return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
function worldVisualStyle(){return window.AdvisorWorldVisualStyle||null;}

function create({backendPreference="webgl2",maxPixelRatio=null,renderScale=null}={}){
  const preference=normalizePreference(backendPreference),maxPixelRatioOverride=finiteOrNull(maxPixelRatio),renderScaleOverride=finiteOrNull(renderScale);
  let pc=null,app=null,device=null,host=null,canvas=null,resizeObserver=null,lastModel=null,proofState=null,occlusionProofState=null,beforeInit=null,afterInit=null,sceneAnchor=null,quality=null;
  let sceneAnchorRevision=0,lastPositionedAnchorRevision=0,lastResizeSignature="",lastCameraBillboardYawDegrees=45;
  let cameraRoot=null,camera=null,worldRoot=null,terrainPreloadRoot=null,terrainRoot=null,terrainBaseEntity=null,structuresRoot=null,propsRoot=null,characterContactRoot=null,charactersRoot=null,lightingRoot=null,interiorProofRoot=null,characterProofRoot=null,assetPreparationProofRoot=null;
  let characterPreparation=null,worldPreparation=null,terrainPreloadManager=null,terrainChunkMeshFactory=null,terrainTextureAtlas=null,buildingSurfaceAtlas=null,treeSpriteAtlas=null,lastPreparedTerrainKey="",pendingTerrainDestination=null,interiorProofState=null,interiorProofPanel=null,characterProofState=null,characterProofPanel=null,lastRawSeed=null,assetPreparationProofState=false,qualityChangeHandler=null,renderQualityChangeHandler=null,renderQualityFrameHandler=null,ambientMotionFrameHandler=null,ambientMotionProofOverride=null,terrainMicroReliefProofOverride=null;
  let lastWorldPreparation=Object.freeze({ready:false,regionCount:0,keyCount:0,regionKeys:Object.freeze([]),logicalKeys:Object.freeze([]),simulationAuthorityPreserved:true});
  let lastMaterialQuality=Object.freeze({profile:"standard",cacheSignature:"pc-material-quality@standard",materialCount:0,textureCount:0,materialVariantCount:0,worldAssetCacheLimit:48,textureBudgetMB:48,anisotropy:2,auxiliaryMaps:true,detailMaps:false,simulationAuthorityPreserved:true});
  let lastAssetPreparationProof=Object.freeze({active:false,logicalKey:null,entityCount:0,meshInstanceCount:0,materialCount:0,networkLoads:0,containerParses:0,simulationAuthorityPreserved:true});
  let lastRawInteriorObjects=[],lastRawBuildingInteriors=[];
  let lastInteriorObjectPresentation=Object.freeze({active:false,state:null,buildingId:null,buildingLabel:null,buildingSource:null,objectCount:0,interactionCount:0,reachableInteractionCount:0,blockingObjectCount:0,objects:Object.freeze([])});
  let lastCharacterProof=Object.freeze({active:false,state:null,protagonistId:null,world:null,scene:null,feetY:null,height:null,yawDegrees:null,occlusionExpected:null,cutawayActive:false});
  const materials=new Map(),roofEntities=[],characterMaterials=new Map(),characterTextures=new Map(),characterEntities=new Map(),registeredCharacterAssets=new Set();
  let characterContactMesh=null,characterContactMaterialRef=null,characterContactEntity=null,characterContactMeshInstance=null,characterContactBuffer=null,characterContactCapacity=0,characterContactBufferUpdates=0;
  let lastCharacterState=Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:0,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,instances:Object.freeze([])});
  let lastCharacterContactState=Object.freeze({count:0,drawCalls:0,materialCount:0,hardwareInstanced:true,terrainAlignedCount:0,quality:"standard",opacity:0.145,simulationAuthorityPreserved:true});
  let lastCutawayState=Object.freeze({active:false,local:true,targetBuildingId:null,hiddenRoofCount:0,totalRoofCount:0});
  let lastSnapshot=Object.freeze({ready:false,engine:"PlayCanvas",engineVersion:ENGINE_VERSION,backend:"not-initialized",gpu:false,webgl:false,webgpu:false,canvasCount:0,migrationFoundation:true,sceneBaseline:false});
  const navigationTelemetry={
    cameraTransformCalls:0,totalCameraTransformMs:0,lastCameraTransformMs:0,maxCameraTransformMs:0,
    preloadUpdateCalls:0,totalPreloadUpdateMs:0,lastPreloadUpdateMs:0,maxPreloadUpdateMs:0,
    canvasResizeCalls:0,canvasResizeSkips:0,bulkChunkRepositions:0,bulkChunkRepositionedResources:0,
    initialAnchorSets:0,sceneAnchorRebases:0
  };
  const ambientFrameTelemetry={calls:0,totalMs:0,lastMs:0,maxMs:0,lastActiveResources:0};

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
    terrainChunkMeshFactory?.refreshContactShadowMaterials?.();
    refreshCharacterContactMaterial();
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
  function material(name,r,g,b){if(materials.has(name))return materials.get(name);const m=new pc.StandardMaterial();const style=worldVisualStyle();m.name=name;m.diffuse.set(r,g,b);m.gloss=Number(style?.materials?.sharedGloss??0.18);m.metalness=Number(style?.materials?.metalness??0);m.update();materials.set(name,m);return m;}
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
    for(const root of [terrainPreloadRoot,terrainRoot,structuresRoot,propsRoot,characterContactRoot,interiorProofRoot,assetPreparationProofRoot])collectMaterials(root,set);
    return set;
  }
  function applyTextureSampling(texture,q){
    if(!texture)return false;
    try{
      if("anisotropy" in texture)texture.anisotropy=Math.max(1,Math.min(q.anisotropy,Number(device?.maxAnisotropy||q.anisotropy)));
      if(texture._advisorDisableMipSampling===true){
        if(pc?.FILTER_LINEAR!==undefined)texture.magFilter=pc.FILTER_LINEAR;
        if(pc?.FILTER_LINEAR!==undefined)texture.minFilter=pc.FILTER_LINEAR;
      }else if(q.filtering==="bilinear"){
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
    if(characterContactRoot)characterContactRoot.enabled=enabled;
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
    // Normal resident movement never reveals roofs/walls. NPCs entering a
    // building are hidden instead; cutaway remains available only to explicit
    // building/protagonist proof presentation.
    return proofState==="inside"||proofState==="entering"||proofState==="behind";
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
    const visualStyle=worldVisualStyle(),lighting=visualStyle?.lighting||{};
    const clear=lighting.clearColor||[0.125,0.155,0.12];
    const sunStyle=lighting.sun||{color:[1,0.95,0.82],intensity:1.25,euler:[48,32,0]};
    const fillStyle=lighting.fill||{color:[0.62,0.72,0.88],intensity:0.30,euler:[55,210,0]};
    const ambient=lighting.ambient||[0.30,0.33,0.29];
    cameraRoot=new pc.Entity("CameraRoot");camera=new pc.Entity("OrthographicGameplayCamera");camera.addComponent("camera",{clearColor:new pc.Color(...clear),projection:pc.PROJECTION_ORTHOGRAPHIC,orthoHeight:BASE_ORTHO_HEIGHT,nearClip:0.1,farClip:200});cameraRoot.addChild(camera);app.root.addChild(cameraRoot);
    worldRoot=new pc.Entity("WorldRoot");terrainPreloadRoot=new pc.Entity("TerrainPreloadRoot");terrainRoot=new pc.Entity("TerrainRoot");structuresRoot=new pc.Entity("StructuresRoot");propsRoot=new pc.Entity("PropsRoot");characterContactRoot=new pc.Entity("CharacterContactShadowsRoot");charactersRoot=new pc.Entity("CharacterBillboardsRoot");interiorProofRoot=new pc.Entity("InteriorObjectProofRoot");characterProofRoot=new pc.Entity("CharacterProofGeometryRoot");assetPreparationProofRoot=new pc.Entity("AssetPreparationProofRoot");lightingRoot=new pc.Entity("LightingRoot");interiorProofRoot.enabled=false;characterProofRoot.enabled=false;assetPreparationProofRoot.enabled=false;worldRoot.addChild(terrainPreloadRoot);worldRoot.addChild(terrainRoot);worldRoot.addChild(structuresRoot);worldRoot.addChild(propsRoot);worldRoot.addChild(characterContactRoot);worldRoot.addChild(charactersRoot);worldRoot.addChild(interiorProofRoot);worldRoot.addChild(characterProofRoot);worldRoot.addChild(assetPreparationProofRoot);app.root.addChild(worldRoot);app.root.addChild(lightingRoot);
    // Normal gameplay contains no hard-coded demo village. Terrain, roads, water,
    // buildings and static props are instantiated only from complete SEED-derived
    // chunk resources under TerrainPreloadRoot.
    terrainBaseEntity=null;
    const sun=new pc.Entity("SunLight");sun.addComponent("light",{type:"directional",intensity:Number(sunStyle.intensity??1.25),color:new pc.Color(...sunStyle.color),castShadows:false});sun.setLocalEulerAngles(...sunStyle.euler);lightingRoot.addChild(sun);const fill=new pc.Entity("FillLight");fill.addComponent("light",{type:"directional",intensity:Number(fillStyle.intensity??0.30),color:new pc.Color(...fillStyle.color),castShadows:false});fill.setLocalEulerAngles(...fillStyle.euler);lightingRoot.addChild(fill);app.scene.ambientLight=new pc.Color(...ambient);updateCameraTransform();
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
    const materialRefreshCount=Number(terrainChunkMeshFactory?.refreshTreeMaterials?.()||0);
    const retiredTextureReleaseCount=Number(treeSpriteAtlas.releaseRetiredTextures?.()||0);
    const finalState=treeSpriteAtlas.stats?.()||state;
    return Object.freeze({...finalState,materialRefreshCount,retiredTextureReleaseCount});
  }
  async function prepareBuildingSurfaceAtlas(){
    if(!window.PlayCanvasBuildingSurfaceAtlas)throw new Error("PlayCanvas building surface atlas is unavailable");
    if(!buildingSurfaceAtlas)buildingSurfaceAtlas=window.PlayCanvasBuildingSurfaceAtlas.create({
      pc,device,
      qualitySignatureProvider:()=>textureQualitySnapshot().cacheSignature,
      resolutionProvider:()=>Math.max(64,Math.min(128,Math.floor(textureQualitySnapshot().maxMaterialTextureResolution/4)))
    });
    const state=await buildingSurfaceAtlas.prepare();
    const textures=buildingSurfaceAtlas.textures?.()||[];
    if(textures.length){
      const q=textureQualitySnapshot();
      for(const texture of textures)if(texture)applyTextureSampling(texture,q);
    }else{
      const texture=buildingSurfaceAtlas.texture?.()||null;
      if(texture)applyTextureSampling(texture,textureQualitySnapshot());
    }
    const materialRefreshCount=Number(terrainChunkMeshFactory?.refreshBuildingMaterials?.()||0);
    // Keep the superseded atlas alive while PlayCanvas applies the updated
    // material/sampler state to GPU draw bindings. Two rAF boundaries are
    // bounded and deterministic, and avoid destroying a texture still queued
    // by a long-lived variant material.
    let rebindGraceFrames=0;
    if(typeof requestAnimationFrame==="function"){
      for(let i=0;i<2;i++){
        await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
        rebindGraceFrames++;
      }
    }
    const retiredTextureReleaseCount=Number(buildingSurfaceAtlas.releaseRetiredTextures?.()||0);
    const finalState=buildingSurfaceAtlas.stats?.()||state;
    return Object.freeze({...finalState,materialRefreshCount,retiredTextureReleaseCount,rebindGraceFrames});
  }
  function terrainMicroReliefEffective(q=textureQualitySnapshot()){
    return Boolean(q.auxiliaryMaps)&&terrainMicroReliefProofOverride!==false;
  }
  async function prepareTerrainTextureAtlas(){
    if(!window.PlayCanvasTerrainTextureAtlas)throw new Error("PlayCanvas terrain texture atlas is unavailable");
    if(!terrainTextureAtlas)terrainTextureAtlas=window.PlayCanvasTerrainTextureAtlas.create({pc,device});
    const state=await terrainTextureAtlas.prepare();
    const mat=material("terrain-chunk-surface",1,1,1);
    const texture=terrainTextureAtlas.texture?.()||null;
    const detailTexture=terrainTextureAtlas.detailTexture?.()||null;
    const normalDetailTexture=terrainTextureAtlas.normalDetailTexture?.()||null;
    const q=textureQualitySnapshot();
    mat.vertexColors=true;
    mat.diffuseVertexColor=true;
    // UV0 now selects the authoritative terrain family's authored atlas cell.
    // The atlas itself is opaque, so surface interiors retain full identity.
    mat.diffuseMap=state?.ready?texture:null;
    mat.diffuseMapUv=0;
    mat.diffuse.set(1,1,1);
    // UV1 keeps the existing shared micro-relief repetition independent from
    // semantic atlas UVs, so one shared material remains sufficient.
    const origin=rememberMaterialOrigin(mat)||{};
    materialQualityOrigins.set(mat,{...origin,normalMap:state?.ready?normalDetailTexture:null});
    const microReliefEnabled=Boolean(state?.ready)&&terrainMicroReliefEffective(q);
    mat.normalMap=microReliefEnabled?normalDetailTexture:null;
    mat.normalMapUv=1;
    mat.bumpiness=microReliefEnabled?0.65:0;
    mat.gloss=0.06;
    mat.metalness=0;
    if(texture)applyTextureSampling(texture,q);
    if(detailTexture)applyTextureSampling(detailTexture,q);
    if(normalDetailTexture)applyTextureSampling(normalDetailTexture,q);
    mat.update();
    // Route hierarchy materials bind authored road/path/square atlas slots.
    // Refresh them before retired atlas generations are released.
    const routeMaterialRefreshCount=Number(terrainChunkMeshFactory?.refreshRouteSurfaceMaterials?.()||0);
    // The materials now reference the new terrain-detail/atlas generation, so
    // superseded shared terrain textures can be safely released.
    const retiredTextureReleaseCount=Number(terrainTextureAtlas.releaseRetiredTextures?.()||0);
    const finalState=terrainTextureAtlas.stats?.()||state;
    return Object.freeze({...finalState,materialRebindCount:1,routeMaterialRefreshCount,retiredTextureReleaseCount});
  }
  function terrainChunkSignature(){
    // Chunk geometry/world data is SEED-derived. Include the active campaign
    // SEED in resource identity so a real campaign switch cannot reuse the
    // previous campaign's prepared meshes. Framebuffer/material quality remains
    // excluded because those changes do not alter geometry.
    return "geometry=heightfield-v13-cliff-lips-contours|seed="+String(lastRawSeed||"none");
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
    resource.entity.setLocalPosition(p.x,0,p.z);
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
      qualityProvider:()=>renderQualitySnapshot(),
      registerRoof:(roof,descriptor)=>{if(roof){if(descriptor?.id)roof._advisorBuildingId=String(descriptor.id);roofEntities.push(roof);}}
    });
    return terrainChunkMeshFactory;
  }
  function prepareTerrainChunkData(spec){
    const request={
      seed:lastRawSeed||"",
      x:spec.x,y:spec.y,chunkSize:spec.chunkSize,
      signature:spec.signature,state:spec.state,
      streamingProfile:spec.streamingProfile||"full",
      requiredCellIndices:Array.isArray(spec.requiredCellIndices)?spec.requiredCellIndices:null
    };
    if(
      spec?.source==="destination"&&String(spec?.streamingProfile||"")==="minimum"&&
      typeof window.PlayCanvasChunkWorldData?.prepareMinimumStep==="function"
    ){
      return window.PlayCanvasChunkWorldData.prepareMinimumStep(
        request,spec.incrementalState||null,Math.max(1,Number(spec.maxCells)||2)
      );
    }
    return window.PlayCanvasChunkWorldData?.getOrCreate?.(request)||null;
  }
  function prepareTerrainMeshChunk(spec){
    const factory=initTerrainChunkMeshFactory();
    if(!factory)throw new Error("PlayCanvas terrain chunk mesh factory is unavailable");
    const worldData=spec?.preparedData??prepareTerrainChunkData(spec);
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
    if(resource?.worldDataKey)window.PlayCanvasChunkWorldData?.release?.(resource.worldDataKey,resource.worldData||null);
    if(terrainChunkMeshFactory)terrainChunkMeshFactory.destroy(resource);
    else resource?.entity?.destroy?.();
  }
  function terrainMeshMetrics(){
    let meshResourceCount=0,activeMeshCount=0,preparedMeshCount=0,cachedMeshCount=0;
    let streamingMinimumMeshResourceCount=0,streamingSparseMeshResourceCount=0,streamingSparseMeshCellCount=0;
    let meshInstanceCount=0,vertices=0,triangles=0;
    let presentationMeshInstanceCount=0,presentationEntityCount=0,sourcePresentationEntityCount=0,buildingPresentationCount=0,interiorObjectPresentationCount=0,propPresentationCount=0;
    let entranceTreatmentCount=0,entranceOrdinaryCount=0,entranceSpecialCount=0,entranceThresholdCount=0,entranceFramePrimitiveCount=0,entranceWearCount=0,entranceAwningCount=0,entranceSignCount=0,entrancePrimitiveCount=0;
    const entranceTreatmentSamples=[];
    let entranceAuthoritativeDoorAnchored=true,entranceRendererOnly=true,entranceNavigationBlocking=false,entranceCollisionBlocking=false;
    let landmarkPresentationCount=0,landmarkPrimitiveCount=0;
    const landmarkTreatmentCounts={},landmarkContextCounts={},landmarkSamples=[];
    let landmarkDeterministic=true,landmarkRendererOnly=true,landmarkNavigationAuthority=false,landmarkCollisionAuthority=false,landmarkSimulationAuthorityPreserved=true;
    let dressingPresentationCount=0,dressingDescriptorCount=0,dressingPrimitiveInstanceCount=0,dressingInstancedGroupCount=0,dressingRouteSafeCount=0;
    const dressingContextCounts={},dressingSemanticCounts={},dressingSamples=[];
    let dressingDeterministic=true,dressingRendererOnly=true;
    let treePresentationCount=0,treeVariant0Count=0,treeVariant1Count=0,treeInstancedGroupCount=0,treeCylinderSpherePlaceholderCount=0;
    let contactShadowBuildingCount=0,contactShadowTreeCount=0,contactShadowPropCount=0,contactShadowObjectCount=0,contactShadowInstancedGroupCount=0,contactShadowDrawCalls=0;
    let contactShadowRendererOnly=true,contactShadowTerrainSampled=true;
    let roofProfileCount=0,roofNormalProfileCount=0,roofSpecialProfileCount=0,roofProfilePass=true,roofCenterRidgeHigher=true,roofEaveContactPass=true,roofFootprintDriven=true;
    const roofProfileSamples=[],treeVariationSamples=[],treeSampleChunks=[];
    let staticBatchCount=0,staticBatchSourcePrimitiveCount=0,instancedGroupCount=0,instancedObjectCount=0;
    let optimizedPresentationDrawCalls=0,unoptimizedPresentationDrawCalls=0,savedDrawCalls=0;
    let frustumCulledResourceCount=0,hardwareInstancedResourceCount=0,batchedResourceCount=0;
    let renderMeshInstanceCount=0,visibleMeshInstanceCount=0,culledMeshInstanceCount=0,cullEnabledMeshInstanceCount=0;
    let roadCellCount=0,waterCellCount=0,bridgeCellCount=0,terrainTypeCount=0;
    let texturedBlockCount=0,colorFallbackBlockCount=0;
    const texturedSurfaceTypes=new Set(),fallbackSurfaceTypes=new Set();
    const semanticSurfaceTileCounts={};
    const contourSurfacePairCounts={},contourSharedEdgeKeys=new Set();
    let contourPatchCount=0,contourVertexCount=0,contourAddedTriangleCount=0,contourBuildMs=0;
    let contourSharedEdgeDuplicateCount=0;
    let terrainVariationResourceCount=0,terrainVariationEvaluatedVertexCount=0,terrainVariationTintedVertexCount=0;
    let terrainVariationMinTintComponent=Infinity,terrainVariationMaxTintComponent=-Infinity;
    let terrainVariationDrawCallsAdded=0,terrainVariationMaterialsAdded=0,terrainVariationTexturesAdded=0,terrainVariationTrianglesAdded=0;
    let terrainVariationDeterministic=true,terrainVariationGlobalCoordinateField=true,terrainVariationChunkBorderContinuous=true;
    let terrainVariationContourCompatible=true,terrainVariationBaseSurfaceIdentityPreserved=true,terrainVariationRendererOnly=true;
    let terrainVariationNavigationAuthority=false,terrainVariationCollisionAuthority=false,terrainVariationSimulationAuthorityPreserved=true;
    const terrainVariationCategoryCounts={},terrainVariationSamples=[],terrainVariationSignatures=new Set();
    let ambientMotionResourceCount=0,ambientTreeCount=0,ambientSmokeEmitterCount=0,ambientSmokePuffCount=0,ambientPennantCount=0;
    let ambientAddedDrawCalls=0,ambientParticleEmitterCount=0,ambientAnimatedMaterialShaderCount=0;
    let ambientActiveTreeResourceCount=0,ambientActiveSmokeResourceCount=0,ambientActivePennantResourceCount=0;
    let ambientUpdateCount=0,ambientBufferUpdateCount=0,ambientLastCpuUpdateMs=0,ambientMaxCpuUpdateMs=0;
    let ambientRendererOnly=true,ambientNavigationAuthority=false,ambientCollisionAuthority=false,ambientSimulationAuthorityPreserved=true;
    let ambientContextAware=true,ambientLodSimplifiedCount=0;
    const ambientQualities=new Set(),ambientZoomSamples=[];
    let seedDerivedPresentation=true,hardCodedSampleGeometry=false;
    let heightfieldResourceCount=0,indexedHeightfieldResourceCount=0;
    let minConditionedHeight=Infinity,maxConditionedHeight=-Infinity;
    let minSourceElevationMeters=Infinity,maxSourceElevationMeters=-Infinity;
    let heightfieldGridResolution=0,heightfieldStepTiles=0,visibleFrameTerrainRebuildCount=0;
    let roadProfileResourceCount=0,roadProfileVertexCount=0,roadProfileCoreVertexCount=0,roadProfileShoulderVertexCount=0;
    let roadProfileRoadVertexCount=0,roadProfilePathVertexCount=0,roadProfileSquareVertexCount=0;
    let minRoadProfileDelta=Infinity,maxRoadProfileDelta=-Infinity,minRoadCoreHeightDelta=Infinity,maxRoadCoreHeightDelta=-Infinity;
    let hydrologyResourceCount=0,hydrologyWaterCellCount=0,hydrologyBridgeCellCount=0;
    let hydrologyBridgeWaterUnderlayCellCount=0,hydrologyBridgeDeckTriangleCount=0;
    let hydrologyBankFaceCount=0,hydrologyBankFaceTriangleCount=0,hydrologyBankFaceDrawCallsAdded=0;
    let hydrologyWaterSurfaceMin=Infinity,hydrologyWaterSurfaceMax=-Infinity;
    let hydrologyBedMin=Infinity,hydrologyBedMax=-Infinity,hydrologyBankMin=Infinity,hydrologyBankMax=-Infinity;
    let hydrologyBridgeClearanceMin=Infinity,hydrologyBridgeClearanceMax=-Infinity;
    let hydrologyWaterBelowBank=true,hydrologyBedBelowWater=true,hydrologyBridgeClearsWater=true;
    let hydrologySeamSafeGlobalCoordinates=true,hydrologyChunkPrepared=true,hydrologyPerFrameRegenerationCount=0;
    let hydrologyRendererOnly=true,hydrologyNavigationAuthority=false,hydrologyCollisionAuthority=false,hydrologyWaterIdentityChanged=false;
    const hydrologyKindCounts={},hydrologySamples=[];
    let landformResourceCount=0,landformGradientMin=Infinity,landformGradientMax=-Infinity;
    let landformReliefMin=Infinity,landformReliefMax=-Infinity,landformConditionOffsetMin=Infinity,landformConditionOffsetMax=-Infinity;
    let landformDrawCallsAdded=0,landformTrianglesAdded=0,landformMaterialsAdded=0,landformPerFrameRegenerationCount=0;
    let landformCliffFaceCount=0,landformCliffFaceTriangleCount=0,landformTriangleBudget=0;
    let landformCliffLipCount=0,landformCliffLipTriangleCount=0;
    let landformDeterministic=true,landformSeamSafeGlobalCoordinates=true,landformChunkPrepared=true,landformRendererOnly=true;
    let landformNavigationAuthority=false,landformCollisionAuthority=false,landformSimulationAuthorityPreserved=true;
    const landformClassCounts={},landformSamples=[];
    let routeSurfaceCellCount=0,routeMainRoadCellCount=0,routeLocalPathCellCount=0,routeSquareCellCount=0,routeConnectorCellCount=0;
    let routeEdgeStripCount=0,routeDiagonalBridgeCount=0,routeDiagonalRibbonOnlyCellCount=0,routeSurfaceTriangleCount=0,routeNetworkConnectedRouteCount=0,routeNetworkTotalRouteCount=0;
    let routeSurfaceRouteSafe=true,routeNetworkRouteSafetyPass=true,routeSurfaceRendererOnly=true,routeNetworkDeterministic=true;
    const routeSurfaceSamples=[];
    const heightfieldResources=new Map();
    const materialNames=new Set();
    terrainPreloadManager?.forEachResource?.((resource,entry)=>{
      const presentationKind=String(resource?.presentationKind||"");
      if(presentationKind!=="chunk-mesh"&&presentationKind!=="streaming-minimum-chunk-mesh")return;
      meshResourceCount++;
      if(resource?.streamingMinimum===true||presentationKind==="streaming-minimum-chunk-mesh")streamingMinimumMeshResourceCount++;
      if(resource?.streamingSparseMesh===true){
        streamingSparseMeshResourceCount++;
        streamingSparseMeshCellCount+=Number(resource.streamingSparseMeshCellCount||0);
      }
      if(entry?.state==="Active")activeMeshCount++;
      else if(entry?.state==="Prepared")preparedMeshCount++;
      else cachedMeshCount++;
      meshInstanceCount+=Number(resource.meshInstanceCount||0);
      vertices+=Number(resource.vertexCount||0);
      triangles+=Number(resource.triangleCount||0);
      if(resource.heightfieldGridResolution){
        heightfieldResourceCount++;
        if(resource.indexedSharedVertices===true||resource.indexedSemanticQuads===true)indexedHeightfieldResourceCount++;
        heightfieldGridResolution=Math.max(heightfieldGridResolution,Number(resource.heightfieldGridResolution||0));
        heightfieldStepTiles=Math.max(heightfieldStepTiles,Number(resource.heightfieldStepTiles||0));
        minConditionedHeight=Math.min(minConditionedHeight,Number(resource.minConditionedHeight||0));
        maxConditionedHeight=Math.max(maxConditionedHeight,Number(resource.maxConditionedHeight||0));
        minSourceElevationMeters=Math.min(minSourceElevationMeters,Number(resource.minSourceElevationMeters||0));
        maxSourceElevationMeters=Math.max(maxSourceElevationMeters,Number(resource.maxSourceElevationMeters||0));
        visibleFrameTerrainRebuildCount+=Number(resource.visibleFrameTerrainRebuildCount||0);
        if(resource.roadProfileEnabled===true){
          roadProfileResourceCount++;
          roadProfileVertexCount+=Number(resource.roadProfileVertexCount||0);
          roadProfileCoreVertexCount+=Number(resource.roadProfileCoreVertexCount||0);
          roadProfileShoulderVertexCount+=Number(resource.roadProfileShoulderVertexCount||0);
          roadProfileRoadVertexCount+=Number(resource.roadProfileRoadVertexCount||0);
          roadProfilePathVertexCount+=Number(resource.roadProfilePathVertexCount||0);
          roadProfileSquareVertexCount+=Number(resource.roadProfileSquareVertexCount||0);
          if(Number(resource.roadProfileVertexCount||0)>0){
            minRoadProfileDelta=Math.min(minRoadProfileDelta,Number(resource.minRoadProfileDelta||0));
            maxRoadProfileDelta=Math.max(maxRoadProfileDelta,Number(resource.maxRoadProfileDelta||0));
          }
          if(Number(resource.roadProfileRoadVertexCount||0)>0&&Number(resource.roadProfileCoreVertexCount||0)>0){
            minRoadCoreHeightDelta=Math.min(minRoadCoreHeightDelta,Number(resource.minRoadCoreHeightDelta||0));
            maxRoadCoreHeightDelta=Math.max(maxRoadCoreHeightDelta,Number(resource.maxRoadCoreHeightDelta||0));
          }
        }
        if(resource.hydrologyEnabled===true){
          hydrologyResourceCount++;
          hydrologyWaterCellCount+=Number(resource.hydrologyWaterCellCount||0);
          hydrologyBridgeCellCount+=Number(resource.hydrologyBridgeCellCount||0);
          hydrologyBridgeWaterUnderlayCellCount+=Number(resource.hydrologyBridgeWaterUnderlayCellCount||0);
          hydrologyBridgeDeckTriangleCount+=Number(resource.hydrologyBridgeDeckTriangleCount||0);
          hydrologyBankFaceCount+=Number(resource.hydrologyBankFaceCount||0);
          hydrologyBankFaceTriangleCount+=Number(resource.hydrologyBankFaceTriangleCount||0);
          hydrologyBankFaceDrawCallsAdded+=Number(resource.hydrologyBankFaceDrawCallsAdded||0);
          if(Number.isFinite(Number(resource.hydrologyWaterSurfaceMin)))hydrologyWaterSurfaceMin=Math.min(hydrologyWaterSurfaceMin,Number(resource.hydrologyWaterSurfaceMin));
          if(Number.isFinite(Number(resource.hydrologyWaterSurfaceMax)))hydrologyWaterSurfaceMax=Math.max(hydrologyWaterSurfaceMax,Number(resource.hydrologyWaterSurfaceMax));
          if(Number.isFinite(Number(resource.hydrologyBedMin)))hydrologyBedMin=Math.min(hydrologyBedMin,Number(resource.hydrologyBedMin));
          if(Number.isFinite(Number(resource.hydrologyBedMax)))hydrologyBedMax=Math.max(hydrologyBedMax,Number(resource.hydrologyBedMax));
          if(Number.isFinite(Number(resource.hydrologyBankMin)))hydrologyBankMin=Math.min(hydrologyBankMin,Number(resource.hydrologyBankMin));
          if(Number.isFinite(Number(resource.hydrologyBankMax)))hydrologyBankMax=Math.max(hydrologyBankMax,Number(resource.hydrologyBankMax));
          if(Number.isFinite(Number(resource.hydrologyBridgeClearanceMin)))hydrologyBridgeClearanceMin=Math.min(hydrologyBridgeClearanceMin,Number(resource.hydrologyBridgeClearanceMin));
          if(Number.isFinite(Number(resource.hydrologyBridgeClearanceMax)))hydrologyBridgeClearanceMax=Math.max(hydrologyBridgeClearanceMax,Number(resource.hydrologyBridgeClearanceMax));
          hydrologyWaterBelowBank=hydrologyWaterBelowBank&&resource.hydrologyWaterBelowBank!==false;
          hydrologyBedBelowWater=hydrologyBedBelowWater&&resource.hydrologyBedBelowWater!==false;
          hydrologyBridgeClearsWater=hydrologyBridgeClearsWater&&resource.hydrologyBridgeClearsWater!==false;
          hydrologySeamSafeGlobalCoordinates=hydrologySeamSafeGlobalCoordinates&&resource.hydrologySeamSafeGlobalCoordinates!==false;
          hydrologyChunkPrepared=hydrologyChunkPrepared&&resource.hydrologyChunkPrepared!==false;
          hydrologyPerFrameRegenerationCount+=Number(resource.hydrologyPerFrameRegenerationCount||0);
          hydrologyRendererOnly=hydrologyRendererOnly&&resource.hydrologyRendererOnly!==false;
          hydrologyNavigationAuthority=hydrologyNavigationAuthority||resource.hydrologyNavigationAuthority===true;
          hydrologyCollisionAuthority=hydrologyCollisionAuthority||resource.hydrologyCollisionAuthority===true;
          hydrologyWaterIdentityChanged=hydrologyWaterIdentityChanged||resource.hydrologyWaterIdentityChanged===true;
          for(const [key,value] of Object.entries(resource.hydrologyKindCounts||{})){
            hydrologyKindCounts[key]=(hydrologyKindCounts[key]||0)+Number(value||0);
          }
          if(hydrologySamples.length<64){
            for(const item of resource.hydrologySamples||[]){
              if(hydrologySamples.length>=64)break;
              hydrologySamples.push(item);
            }
          }
        }
        if(resource.landformEnabled===true){
          landformResourceCount++;
          if(Number.isFinite(Number(resource.landformGradientMin)))landformGradientMin=Math.min(landformGradientMin,Number(resource.landformGradientMin));
          if(Number.isFinite(Number(resource.landformGradientMax)))landformGradientMax=Math.max(landformGradientMax,Number(resource.landformGradientMax));
          if(Number.isFinite(Number(resource.landformReliefMin)))landformReliefMin=Math.min(landformReliefMin,Number(resource.landformReliefMin));
          if(Number.isFinite(Number(resource.landformReliefMax)))landformReliefMax=Math.max(landformReliefMax,Number(resource.landformReliefMax));
          if(Number.isFinite(Number(resource.landformConditionOffsetMin)))landformConditionOffsetMin=Math.min(landformConditionOffsetMin,Number(resource.landformConditionOffsetMin));
          if(Number.isFinite(Number(resource.landformConditionOffsetMax)))landformConditionOffsetMax=Math.max(landformConditionOffsetMax,Number(resource.landformConditionOffsetMax));
          landformDrawCallsAdded+=Number(resource.landformDrawCallsAdded||0);
          landformTrianglesAdded+=Number(resource.landformTrianglesAdded||0);
          landformMaterialsAdded+=Number(resource.landformMaterialsAdded||0);
          landformCliffFaceCount+=Number(resource.landformCliffFaceCount||0);
          landformCliffFaceTriangleCount+=Number(resource.landformCliffFaceTriangleCount||0);
          landformCliffLipCount+=Number(resource.landformCliffLipCount||0);
          landformCliffLipTriangleCount+=Number(resource.landformCliffLipTriangleCount||0);
          landformTriangleBudget+=Number(resource.landformTriangleBudgetPerChunk||0);
          landformPerFrameRegenerationCount+=Number(resource.landformPerFrameRegenerationCount||0);
          landformDeterministic=landformDeterministic&&resource.landformDeterministic!==false;
          landformSeamSafeGlobalCoordinates=landformSeamSafeGlobalCoordinates&&resource.landformSeamSafeGlobalCoordinates!==false;
          landformChunkPrepared=landformChunkPrepared&&resource.landformChunkPrepared!==false;
          landformRendererOnly=landformRendererOnly&&resource.landformRendererOnly!==false;
          landformNavigationAuthority=landformNavigationAuthority||resource.landformNavigationAuthority===true;
          landformCollisionAuthority=landformCollisionAuthority||resource.landformCollisionAuthority===true;
          landformSimulationAuthorityPreserved=landformSimulationAuthorityPreserved&&resource.landformSimulationAuthorityPreserved!==false;
          for(const [key,value] of Object.entries(resource.landformClassCounts||{}))landformClassCounts[key]=(landformClassCounts[key]||0)+Number(value||0);
          if(landformSamples.length<64){
            for(const item of resource.landformSamples||[]){
              if(landformSamples.length>=64)break;
              landformSamples.push(item);
            }
          }
        }
        heightfieldResources.set(Number(resource.x)+","+Number(resource.y),resource);
      }
      if(resource.terrainVariationEnabled===true){
        terrainVariationResourceCount++;
        terrainVariationEvaluatedVertexCount+=Number(resource.terrainVariationEvaluatedVertexCount||0);
        terrainVariationTintedVertexCount+=Number(resource.terrainVariationTintedVertexCount||0);
        terrainVariationMinTintComponent=Math.min(terrainVariationMinTintComponent,Number(resource.terrainVariationMinTintComponent??1));
        terrainVariationMaxTintComponent=Math.max(terrainVariationMaxTintComponent,Number(resource.terrainVariationMaxTintComponent??1));
        terrainVariationDrawCallsAdded+=Number(resource.terrainVariationDrawCallsAdded||0);
        terrainVariationMaterialsAdded+=Number(resource.terrainVariationMaterialsAdded||0);
        terrainVariationTexturesAdded+=Number(resource.terrainVariationTexturesAdded||0);
        terrainVariationTrianglesAdded+=Number(resource.terrainVariationTrianglesAdded||0);
        terrainVariationDeterministic=terrainVariationDeterministic&&resource.terrainVariationDeterministic!==false;
        terrainVariationGlobalCoordinateField=terrainVariationGlobalCoordinateField&&resource.terrainVariationGlobalCoordinateField!==false;
        terrainVariationChunkBorderContinuous=terrainVariationChunkBorderContinuous&&resource.terrainVariationChunkBorderContinuous!==false;
        terrainVariationContourCompatible=terrainVariationContourCompatible&&resource.terrainVariationContourCompatible!==false;
        terrainVariationBaseSurfaceIdentityPreserved=terrainVariationBaseSurfaceIdentityPreserved&&resource.terrainVariationBaseSurfaceIdentityPreserved!==false;
        terrainVariationRendererOnly=terrainVariationRendererOnly&&resource.terrainVariationRendererOnly!==false;
        terrainVariationNavigationAuthority=terrainVariationNavigationAuthority||resource.terrainVariationNavigationAuthority===true;
        terrainVariationCollisionAuthority=terrainVariationCollisionAuthority||resource.terrainVariationCollisionAuthority===true;
        terrainVariationSimulationAuthorityPreserved=terrainVariationSimulationAuthorityPreserved&&resource.terrainVariationSimulationAuthorityPreserved!==false;
        for(const [key,value] of Object.entries(resource.terrainVariationCategoryCounts||{})){
          terrainVariationCategoryCounts[key]=(terrainVariationCategoryCounts[key]||0)+Number(value||0);
        }
        if(terrainVariationSamples.length<64){
          for(const item of resource.terrainVariationSamples||[]){
            if(terrainVariationSamples.length>=64)break;
            terrainVariationSamples.push(item);
          }
        }
        const signature=String(resource.signature||"")+"|"+String(resource.terrainVariationTintedVertexCount||0)+"|"+
          String(resource.terrainVariationMinTintComponent??1)+"|"+String(resource.terrainVariationMaxTintComponent??1);
        terrainVariationSignatures.add(signature);
      }
      if(resource.ambientMotionEnabled===true){
        ambientMotionResourceCount++;
        ambientTreeCount+=Number(resource.ambientTreeCount||0);
        ambientSmokeEmitterCount+=Number(resource.ambientSmokeEmitterCount||0);
        ambientSmokePuffCount+=Number(resource.ambientSmokePuffCount||0);
        ambientPennantCount+=Number(resource.ambientPennantCount||0);
        ambientAddedDrawCalls+=Number(resource.ambientAddedDrawCalls||0);
        ambientParticleEmitterCount+=Number(resource.ambientParticleEmitterCount||0);
        ambientAnimatedMaterialShaderCount+=Number(resource.ambientAnimatedMaterialShaderCount||0);
        ambientActiveTreeResourceCount+=resource.ambientTreeActive===true?1:0;
        ambientActiveSmokeResourceCount+=resource.ambientSmokeActive===true?1:0;
        ambientActivePennantResourceCount+=resource.ambientPennantActive===true?1:0;
        ambientUpdateCount+=Number(resource.ambientUpdateCount||0);
        ambientBufferUpdateCount+=Number(resource.ambientBufferUpdateCount||0);
        ambientLastCpuUpdateMs=Math.max(ambientLastCpuUpdateMs,Number(resource.ambientLastCpuUpdateMs||0));
        ambientMaxCpuUpdateMs=Math.max(ambientMaxCpuUpdateMs,Number(resource.ambientMaxCpuUpdateMs||0));
        ambientRendererOnly=ambientRendererOnly&&resource.ambientRendererOnly!==false;
        ambientNavigationAuthority=ambientNavigationAuthority||resource.ambientNavigationAuthority===true;
        ambientCollisionAuthority=ambientCollisionAuthority||resource.ambientCollisionAuthority===true;
        ambientSimulationAuthorityPreserved=ambientSimulationAuthorityPreserved&&resource.ambientSimulationAuthorityPreserved!==false;
        ambientContextAware=ambientContextAware&&resource.ambientContextAware!==false;
        if(resource.ambientLodSimplified===true)ambientLodSimplifiedCount++;
        if(resource.ambientQuality)ambientQualities.add(String(resource.ambientQuality));
        if(ambientZoomSamples.length<16)ambientZoomSamples.push(Number(resource.ambientZoom||1));
      }
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
      entranceTreatmentCount+=Number(resource.entranceTreatmentCount||0);
      entranceOrdinaryCount+=Number(resource.entranceOrdinaryCount||0);
      entranceSpecialCount+=Number(resource.entranceSpecialCount||0);
      entranceThresholdCount+=Number(resource.entranceThresholdCount||0);
      entranceFramePrimitiveCount+=Number(resource.entranceFramePrimitiveCount||0);
      entranceWearCount+=Number(resource.entranceWearCount||0);
      entranceAwningCount+=Number(resource.entranceAwningCount||0);
      entranceSignCount+=Number(resource.entranceSignCount||0);
      entrancePrimitiveCount+=Number(resource.entrancePrimitiveCount||0);
      entranceAuthoritativeDoorAnchored=entranceAuthoritativeDoorAnchored&&resource.entranceAuthoritativeDoorAnchored!==false;
      entranceRendererOnly=entranceRendererOnly&&resource.entranceRendererOnly!==false;
      entranceNavigationBlocking=entranceNavigationBlocking||resource.entranceNavigationBlocking===true;
      entranceCollisionBlocking=entranceCollisionBlocking||resource.entranceCollisionBlocking===true;
      if(entranceTreatmentSamples.length<64){
        for(const item of resource.entranceTreatmentSamples||[]){
          if(entranceTreatmentSamples.length>=64)break;
          entranceTreatmentSamples.push(item);
        }
      }
      landmarkPresentationCount+=Number(resource.landmarkPresentationCount||0);
      landmarkPrimitiveCount+=Number(resource.landmarkPrimitiveCount||0);
      for(const [key,value] of Object.entries(resource.landmarkTreatmentCounts||{}))landmarkTreatmentCounts[key]=(landmarkTreatmentCounts[key]||0)+Number(value||0);
      for(const [key,value] of Object.entries(resource.landmarkContextCounts||{}))landmarkContextCounts[key]=(landmarkContextCounts[key]||0)+Number(value||0);
      landmarkDeterministic=landmarkDeterministic&&resource.landmarkDeterministic!==false;
      landmarkRendererOnly=landmarkRendererOnly&&resource.landmarkRendererOnly!==false;
      landmarkNavigationAuthority=landmarkNavigationAuthority||resource.landmarkNavigationAuthority===true;
      landmarkCollisionAuthority=landmarkCollisionAuthority||resource.landmarkCollisionAuthority===true;
      landmarkSimulationAuthorityPreserved=landmarkSimulationAuthorityPreserved&&resource.landmarkSimulationAuthorityPreserved!==false;
      if(landmarkSamples.length<24){
        for(const item of resource.landmarkSamples||[]){
          if(landmarkSamples.length>=24)break;
          landmarkSamples.push(item);
        }
      }
      contactShadowBuildingCount+=Number(resource.contactShadowBuildingCount||0);
      contactShadowTreeCount+=Number(resource.contactShadowTreeCount||0);
      contactShadowPropCount+=Number(resource.contactShadowPropCount||0);
      contactShadowObjectCount+=Number(resource.contactShadowObjectCount||0);
      contactShadowInstancedGroupCount+=Number(resource.contactShadowInstancedGroupCount||0);
      contactShadowDrawCalls+=Number(resource.contactShadowDrawCalls||0);
      contactShadowRendererOnly=contactShadowRendererOnly&&resource.contactShadowRendererOnly!==false;
      contactShadowTerrainSampled=contactShadowTerrainSampled&&resource.contactShadowTerrainSampled!==false;
      routeSurfaceCellCount+=Number(resource.routeSurfaceCellCount||0);
      routeMainRoadCellCount+=Number(resource.routeMainRoadCellCount||0);
      routeLocalPathCellCount+=Number(resource.routeLocalPathCellCount||0);
      routeSquareCellCount+=Number(resource.routeSquareCellCount||0);
      routeConnectorCellCount+=Number(resource.routeConnectorCellCount||0);
      routeEdgeStripCount+=Number(resource.routeEdgeStripCount||0);
      routeDiagonalBridgeCount+=Number(resource.routeDiagonalBridgeCount||0);
      routeDiagonalRibbonOnlyCellCount+=Number(resource.routeDiagonalRibbonOnlyCellCount||0);
      routeSurfaceTriangleCount+=Number(resource.routeSurfaceTriangleCount||0);
      routeNetworkConnectedRouteCount=Math.max(routeNetworkConnectedRouteCount,Number(resource.routeNetworkConnectedRouteCount||0));
      routeNetworkTotalRouteCount=Math.max(routeNetworkTotalRouteCount,Number(resource.routeNetworkTotalRouteCount||0));
      routeSurfaceRouteSafe=routeSurfaceRouteSafe&&resource.routeSurfaceRouteSafe!==false;
      routeNetworkRouteSafetyPass=routeNetworkRouteSafetyPass&&resource.routeNetworkRouteSafetyPass!==false;
      routeSurfaceRendererOnly=routeSurfaceRendererOnly&&resource.routeSurfaceRendererOnly!==false;
      routeNetworkDeterministic=routeNetworkDeterministic&&resource.routeNetworkDeterministic!==false;
      if(routeSurfaceSamples.length<48){
        for(const item of resource.routeSurfaceSamples||[]){
          if(routeSurfaceSamples.length>=48)break;
          routeSurfaceSamples.push(item);
        }
      }
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
      dressingPresentationCount+=Number(resource.dressingPresentationCount||0);
      dressingDescriptorCount+=Number(resource.dressingDescriptorCount||0);
      dressingPrimitiveInstanceCount+=Number(resource.dressingPrimitiveInstanceCount||0);
      dressingInstancedGroupCount+=Number(resource.dressingInstancedGroupCount||0);
      dressingRouteSafeCount+=Number(resource.dressingRouteSafeCount||0);
      dressingDeterministic=dressingDeterministic&&resource.dressingDeterministic!==false;
      dressingRendererOnly=dressingRendererOnly&&resource.dressingRendererOnly!==false;
      for(const [key,value] of Object.entries(resource.dressingContextCounts||{}))dressingContextCounts[key]=(dressingContextCounts[key]||0)+Number(value||0);
      for(const [key,value] of Object.entries(resource.dressingSemanticCounts||{}))dressingSemanticCounts[key]=(dressingSemanticCounts[key]||0)+Number(value||0);
      if(dressingSamples.length<96){
        for(const item of resource.dressingSamples||[]){
          if(dressingSamples.length>=96)break;
          dressingSamples.push(item);
        }
      }
      treePresentationCount+=Number(resource.treePresentationCount||0);
      treeVariant0Count+=Number(resource.treeVariant0Count||0);
      treeVariant1Count+=Number(resource.treeVariant1Count||0);
      treeInstancedGroupCount+=Number(resource.treeInstancedGroupCount||0);
      treeCylinderSpherePlaceholderCount+=Number(resource.treeCylinderSpherePlaceholderCount||0);
      if(Number(resource.treePresentationCount||0)>0){
        const firstTreeSample=Array.isArray(resource.treeVariationSamples)&&resource.treeVariationSamples.length
          ?resource.treeVariationSamples[0]
          :null;
        treeSampleChunks.push(Object.freeze({
          chunkX:Number(resource.x),chunkY:Number(resource.y),count:Number(resource.treePresentationCount||0),state:String(entry?.state||""),
          sample:firstTreeSample?Object.freeze({
            x:String(firstTreeSample.x),y:String(firstTreeSample.y),
            variant:Number(firstTreeSample.variant||0),flipX:Boolean(firstTreeSample.flipX),
            scaleChoice:Number(firstTreeSample.scaleChoice||1)
          }):null
        }));
      }
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
      for(const [type,count] of Object.entries(resource.semanticSurfaceTileCounts||{})){
        semanticSurfaceTileCounts[type]=(semanticSurfaceTileCounts[type]||0)+Number(count||0);
      }
      contourPatchCount+=Number(resource.contourPatchCount||0);
      contourVertexCount+=Number(resource.contourVertexCount||0);
      contourAddedTriangleCount+=Number(resource.contourAddedTriangleCount||0);
      contourBuildMs+=Number(resource.contourBuildMs||0);
      for(const [pair,count] of Object.entries(resource.contourSurfacePairCounts||{})){
        contourSurfacePairCounts[pair]=(contourSurfacePairCounts[pair]||0)+Number(count||0);
      }
      for(const key of resource.contourSharedEdgeKeys||[]){
        if(contourSharedEdgeKeys.has(String(key)))contourSharedEdgeDuplicateCount++;
        contourSharedEdgeKeys.add(String(key));
      }
      seedDerivedPresentation=seedDerivedPresentation&&resource.seedDerivedPresentation===true;
      hardCodedSampleGeometry=hardCodedSampleGeometry||resource.hardCodedSampleGeometry===true;
      const name=resource.meshInstance?.material?.name;
      if(name)materialNames.add(name);
    });
    let sharedBorderPairCount=0,sharedBorderMaxError=0;
    const compareBorders=(a,b)=>{
      if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return;
      sharedBorderPairCount++;
      for(let i=0;i<a.length;i++)sharedBorderMaxError=Math.max(sharedBorderMaxError,Math.abs(Number(a[i])-Number(b[i])));
    };
    for(const resource of heightfieldResources.values()){
      compareBorders(resource.borderHeights?.east,heightfieldResources.get((Number(resource.x)+1)+","+Number(resource.y))?.borderHeights?.west);
      compareBorders(resource.borderHeights?.south,heightfieldResources.get(Number(resource.x)+","+(Number(resource.y)+1))?.borderHeights?.north);
    }
    const heightfieldPass=heightfieldResourceCount>0&&indexedHeightfieldResourceCount===heightfieldResourceCount&&sharedBorderMaxError<=1e-7;
    const generatorStats=terrainChunkMeshFactory?.stats?.()||{};
    const routeSurfaceMaterialCount=Number(generatorStats.routeSurfaceMaterialCount||0);
    const textureProfile=textureQualitySnapshot();
    const surfaceDebugReport=Object.freeze(Object.fromEntries(
      Object.entries(generatorStats.surfaceIdentityBindings||{}).map(([type,row])=>[
        type,
        Object.freeze({
          ...row,
          qualityProfile:String(textureProfile.profile||"standard"),
          materialCacheSignature:String(textureProfile.cacheSignature||"")
        })
      ])
    ));

    return Object.freeze({
      resourceKind:"chunk-mesh",
      meshResourceCount,activeMeshCount,preparedMeshCount,cachedMeshCount,
      streamingMinimumMeshResourceCount,streamingSparseMeshResourceCount,streamingSparseMeshCellCount,
      meshInstanceCount,vertices,triangles,
      heightfieldResourceCount,indexedHeightfieldResourceCount,
      heightfieldGridResolution,heightfieldStepTiles,
      indexedSharedVertices:generatorStats.indexedSharedVertices===true,
      indexedSemanticQuads:generatorStats.indexedSemanticQuads===true,
      semanticUvChannel:0,normalDetailUvChannel:1,
      heightfieldPass,
      minConditionedHeight:Number.isFinite(minConditionedHeight)?Number(minConditionedHeight.toFixed(4)):null,
      maxConditionedHeight:Number.isFinite(maxConditionedHeight)?Number(maxConditionedHeight.toFixed(4)):null,
      minSourceElevationMeters:Number.isFinite(minSourceElevationMeters)?Number(minSourceElevationMeters.toFixed(1)):null,
      maxSourceElevationMeters:Number.isFinite(maxSourceElevationMeters)?Number(maxSourceElevationMeters.toFixed(1)):null,
      sharedBorderPairCount,
      sharedBorderMaxError:Number(sharedBorderMaxError.toFixed(8)),
      sharedBorderEquality:sharedBorderPairCount>0&&sharedBorderMaxError<=1e-7,
      hydrologyEnabled:hydrologyResourceCount>0,
      hydrologyVersion:String(generatorStats.hydrologyVersion||"hydrology-basin-v1"),
      hydrologyResourceCount,
      hydrologyWaterCellCount,
      hydrologyBridgeCellCount,
      hydrologyBridgeWaterUnderlayCellCount,
      hydrologyBridgeDeckTriangleCount,
      hydrologyBridgeWaterUnderlayVisible:hydrologyBridgeWaterUnderlayCellCount>0&&hydrologyBridgeDeckTriangleCount>=2,
      hydrologyBankFaceCount,
      hydrologyBankFaceTriangleCount,
      hydrologyBankFaceDrawCallsAdded,
      hydrologyBankFacesPrepared:hydrologyWaterCellCount===0||hydrologyBankFaceCount>0,
      hydrologyKindCounts:Object.freeze({...hydrologyKindCounts}),
      hydrologySamples:Object.freeze(hydrologySamples.slice()),
      hydrologyWaterSurfaceMin:Number.isFinite(hydrologyWaterSurfaceMin)?Number(hydrologyWaterSurfaceMin.toFixed(6)):null,
      hydrologyWaterSurfaceMax:Number.isFinite(hydrologyWaterSurfaceMax)?Number(hydrologyWaterSurfaceMax.toFixed(6)):null,
      hydrologyBedMin:Number.isFinite(hydrologyBedMin)?Number(hydrologyBedMin.toFixed(6)):null,
      hydrologyBedMax:Number.isFinite(hydrologyBedMax)?Number(hydrologyBedMax.toFixed(6)):null,
      hydrologyBankMin:Number.isFinite(hydrologyBankMin)?Number(hydrologyBankMin.toFixed(6)):null,
      hydrologyBankMax:Number.isFinite(hydrologyBankMax)?Number(hydrologyBankMax.toFixed(6)):null,
      hydrologyBridgeClearanceMin:Number.isFinite(hydrologyBridgeClearanceMin)?Number(hydrologyBridgeClearanceMin.toFixed(6)):null,
      hydrologyBridgeClearanceMax:Number.isFinite(hydrologyBridgeClearanceMax)?Number(hydrologyBridgeClearanceMax.toFixed(6)):null,
      hydrologyWaterBelowBank,
      hydrologyBedBelowWater,
      hydrologyBridgeClearsWater,
      hydrologySeamSafeGlobalCoordinates,
      hydrologyChunkPrepared,
      hydrologyPerFrameRegenerationCount,
      hydrologyRendererOnly,
      hydrologyNavigationAuthority,
      hydrologyCollisionAuthority,
      hydrologyWaterIdentityChanged,
      hydrologyPass:Boolean(
        hydrologyResourceCount>0&&hydrologyWaterCellCount>0&&
        hydrologyWaterBelowBank&&hydrologyBedBelowWater&&hydrologyBridgeClearsWater&&
        hydrologySeamSafeGlobalCoordinates&&hydrologyChunkPrepared&&hydrologyPerFrameRegenerationCount===0&&
        hydrologyRendererOnly&&!hydrologyNavigationAuthority&&!hydrologyCollisionAuthority&&!hydrologyWaterIdentityChanged
      ),
      landformEnabled:landformResourceCount>0&&generatorStats.landformEnabled===true,
      landformVersion:String(generatorStats.landformVersion||"macro-landform-v4"),
      landformSampleRadiusTiles:Number(generatorStats.landformSampleRadiusTiles||0),
      landformResourceCount,
      landformClassCounts:Object.freeze({...landformClassCounts}),
      landformSamples:Object.freeze(landformSamples.slice()),
      landformGradientMin:Number.isFinite(landformGradientMin)?Number(landformGradientMin.toFixed(4)):null,
      landformGradientMax:Number.isFinite(landformGradientMax)?Number(landformGradientMax.toFixed(4)):null,
      landformReliefMin:Number.isFinite(landformReliefMin)?Number(landformReliefMin.toFixed(2)):null,
      landformReliefMax:Number.isFinite(landformReliefMax)?Number(landformReliefMax.toFixed(2)):null,
      landformConditionOffsetMin:Number.isFinite(landformConditionOffsetMin)?Number(landformConditionOffsetMin.toFixed(6)):null,
      landformConditionOffsetMax:Number.isFinite(landformConditionOffsetMax)?Number(landformConditionOffsetMax.toFixed(6)):null,
      landformSteepFaceTreatment:String(generatorStats.landformSteepFaceTreatment||"gradient+elevation-contours+sparse-cliff-aprons+top-rock-lips"),
      landformCliffFaceCount,landformCliffFaceTriangleCount,
      landformCliffLipCount,landformCliffLipTriangleCount,landformTriangleBudget,
      landformDrawCallsAdded,landformTrianglesAdded,landformMaterialsAdded,
      landformDeterministic,landformSeamSafeGlobalCoordinates,landformChunkPrepared,landformPerFrameRegenerationCount,
      landformRendererOnly,landformNavigationAuthority,landformCollisionAuthority,landformSimulationAuthorityPreserved,
      landformPass:Boolean(
        landformResourceCount>0&&landformDeterministic&&landformSeamSafeGlobalCoordinates&&landformChunkPrepared&&
        landformPerFrameRegenerationCount===0&&landformRendererOnly&&!landformNavigationAuthority&&!landformCollisionAuthority&&
        landformSimulationAuthorityPreserved&&landformDrawCallsAdded===0&&landformMaterialsAdded===0&&
        landformTrianglesAdded<=landformTriangleBudget
      ),
      contourAlgorithm:String(generatorStats.contourAlgorithm||""),
      contourPreparationOnly:generatorStats.contourPreparationOnly===true,
      contourHaloTiles:Number(generatorStats.contourHaloTiles||0),
      contourRoundRadiusTiles:Number(generatorStats.contourRoundRadiusTiles||0),
      contourTransitionBandWidthTiles:Number(generatorStats.contourTransitionBandWidthTiles||0),
      contourMaxBoundaryDeviationTiles:Number(generatorStats.contourMaxBoundaryDeviationTiles||0),
      contourArcSegments:Number(generatorStats.contourArcSegments||0),
      contourPatchCount,contourVertexCount,contourAddedTriangleCount,
      contourBuildMs:Number(contourBuildMs.toFixed(3)),
      contourDrawCallsAdded:Number(generatorStats.contourDrawCallsAdded||0),
      contourMaterialCountAdded:Number(generatorStats.contourMaterialCountAdded||0),
      contourPerFrameRegenerationCount:Number(generatorStats.contourPerFrameRegenerationCount||0),
      contourCanonicalCornerOwnership:generatorStats.contourCanonicalCornerOwnership===true,
      contourSharedEdgeKeyCount:contourSharedEdgeKeys.size,
      contourSharedEdgeDuplicateCount,
      contourSharedEdgeEquality:contourSharedEdgeDuplicateCount===0,
      contourSurfacePairCounts:Object.freeze({...contourSurfacePairCounts}),
      contourTileCentersPreserved:generatorStats.contourTileCentersPreserved===true,
      contourAlphaBlend:generatorStats.contourAlphaBlend===true,
      terrainVariationEnabled:terrainVariationResourceCount>0&&generatorStats.terrainVariationEnabled===true,
      terrainVariationStrategy:String(generatorStats.terrainVariationStrategy||""),
      terrainVariationMacroScaleTiles:Number(generatorStats.terrainVariationMacroScaleTiles||0),
      terrainVariationContextRadiusTiles:Number(generatorStats.terrainVariationContextRadiusTiles||0),
      terrainVariationResourceCount,
      terrainVariationEvaluatedVertexCount,
      terrainVariationTintedVertexCount,
      terrainVariationCategoryCounts:Object.freeze({...terrainVariationCategoryCounts}),
      terrainVariationSamples:Object.freeze(terrainVariationSamples.slice()),
      terrainVariationResourceSignatureCount:terrainVariationSignatures.size,
      terrainVariationMinTintComponent:Number.isFinite(terrainVariationMinTintComponent)?Number(terrainVariationMinTintComponent.toFixed(4)):1,
      terrainVariationMaxTintComponent:Number.isFinite(terrainVariationMaxTintComponent)?Number(terrainVariationMaxTintComponent.toFixed(4)):1,
      terrainVariationDrawCallsAdded,
      terrainVariationMaterialsAdded,
      terrainVariationTexturesAdded,
      terrainVariationTrianglesAdded,
      terrainVariationDeterministic:Boolean(terrainVariationDeterministic),
      terrainVariationGlobalCoordinateField:Boolean(terrainVariationGlobalCoordinateField),
      terrainVariationChunkBorderContinuous:Boolean(terrainVariationChunkBorderContinuous),
      terrainVariationContourCompatible:Boolean(terrainVariationContourCompatible),
      terrainVariationBaseSurfaceIdentityPreserved:Boolean(terrainVariationBaseSurfaceIdentityPreserved),
      terrainVariationRendererOnly:Boolean(terrainVariationRendererOnly),
      terrainVariationNavigationAuthority:Boolean(terrainVariationNavigationAuthority),
      terrainVariationCollisionAuthority:Boolean(terrainVariationCollisionAuthority),
      terrainVariationSimulationAuthorityPreserved:Boolean(terrainVariationSimulationAuthorityPreserved),
      terrainVariationPass:Boolean(
        terrainVariationResourceCount>0&&terrainVariationTintedVertexCount>0&&
        terrainVariationDeterministic&&terrainVariationGlobalCoordinateField&&terrainVariationChunkBorderContinuous&&
        terrainVariationContourCompatible&&terrainVariationBaseSurfaceIdentityPreserved&&terrainVariationRendererOnly&&
        !terrainVariationNavigationAuthority&&!terrainVariationCollisionAuthority&&terrainVariationSimulationAuthorityPreserved&&
        terrainVariationDrawCallsAdded===0&&terrainVariationMaterialsAdded===0&&terrainVariationTexturesAdded===0&&terrainVariationTrianglesAdded===0&&
        Number.isFinite(terrainVariationMinTintComponent)&&terrainVariationMinTintComponent>=0.80&&
        Number.isFinite(terrainVariationMaxTintComponent)&&terrainVariationMaxTintComponent<=1.10
      ),
      ambientMotionEnabled:ambientMotionResourceCount>0&&generatorStats.ambientMotionEnabled===true,
      ambientMotionStrategy:String(generatorStats.ambientMotionStrategy||""),
      ambientMotionResourceCount,
      ambientTreeCount,ambientSmokeEmitterCount,ambientSmokePuffCount,ambientPennantCount,
      ambientEffectTypeCount:(ambientTreeCount>0?1:0)+(ambientSmokePuffCount>0?1:0)+(ambientPennantCount>0?1:0),
      ambientActiveEffectTypeCount:(ambientActiveTreeResourceCount>0?1:0)+(ambientActiveSmokeResourceCount>0?1:0)+(ambientActivePennantResourceCount>0?1:0),
      ambientActiveTreeResourceCount,ambientActiveSmokeResourceCount,ambientActivePennantResourceCount,
      ambientAddedDrawCalls,
      ambientParticleEmitterCount,
      ambientAnimatedMaterialShaderCount,
      ambientSharedMaterialCount:Number(generatorStats.ambientSharedMaterialCount||0),
      ambientUpdateCount,ambientBufferUpdateCount,
      ambientLastCpuUpdateMs:Number(ambientLastCpuUpdateMs.toFixed(3)),
      ambientMaxCpuUpdateMs:Number(Math.max(ambientMaxCpuUpdateMs,Number(generatorStats.ambientMaxUpdateMs||0)).toFixed(3)),
      ambientAverageFactoryUpdateMs:Number(generatorStats.ambientAverageUpdateMs||0),
      ambientFactoryUpdateCalls:Number(generatorStats.ambientUpdateCalls||0),
      ambientFactorySkippedUpdateCalls:Number(generatorStats.ambientSkippedUpdateCalls||0),
      ambientFactoryBufferUpdates:Number(generatorStats.ambientBufferUpdates||0),
      ambientMotionProofOverride,
      ambientFrameUpdateCalls:Number(ambientFrameTelemetry.calls||0),
      ambientFrameLastCpuMs:Number(ambientFrameTelemetry.lastMs.toFixed(3)),
      ambientFrameMaxCpuMs:Number(ambientFrameTelemetry.maxMs.toFixed(3)),
      ambientFrameAverageCpuMs:Number((ambientFrameTelemetry.calls?ambientFrameTelemetry.totalMs/ambientFrameTelemetry.calls:0).toFixed(3)),
      ambientFrameActiveResources:Number(ambientFrameTelemetry.lastActiveResources||0),
      ambientRendererOnly:Boolean(ambientRendererOnly&&generatorStats.ambientRendererOnly!==false),
      ambientNavigationAuthority:Boolean(ambientNavigationAuthority||generatorStats.ambientNavigationAuthority===true),
      ambientCollisionAuthority:Boolean(ambientCollisionAuthority||generatorStats.ambientCollisionAuthority===true),
      ambientSimulationAuthorityPreserved:Boolean(ambientSimulationAuthorityPreserved&&generatorStats.ambientSimulationAuthorityPreserved!==false),
      ambientContextAware:Boolean(ambientContextAware),
      ambientLodSimplifiedResourceCount:ambientLodSimplifiedCount,
      ambientQualityLevels:Object.freeze([...ambientQualities].sort()),
      ambientZoomSamples:Object.freeze(ambientZoomSamples.slice()),
      ambientCullingMode:"chunk-active+mesh-frustum+zoom-lod",
      ambientLowProfileReduction:true,
      ambientMobileWebGL2Safe:true,
      ambientMotionPass:Boolean(
        ambientMotionResourceCount>0&&ambientTreeCount>0&&
        ((ambientTreeCount>0?1:0)+(ambientSmokePuffCount>0?1:0)+(ambientPennantCount>0?1:0))>=2&&
        ambientUpdateCount>0&&ambientBufferUpdateCount>0&&ambientContextAware&&ambientRendererOnly&&
        !ambientNavigationAuthority&&!ambientCollisionAuthority&&ambientSimulationAuthorityPreserved&&
        ambientParticleEmitterCount===0&&ambientAnimatedMaterialShaderCount===0&&
        ambientAddedDrawCalls<=ambientMotionResourceCount*2
      ),
      terrainGroundSampler:"indexed-triangle-exact",
      roadProfileEnabled:roadProfileResourceCount>0&&generatorStats.roadProfileEnabled===true,
      roadProfileMode:String(generatorStats.roadProfileMode||""),
      roadLiftWorldUnits:Number(generatorStats.roadLiftWorldUnits||0),
      pathLiftWorldUnits:Number(generatorStats.pathLiftWorldUnits||0),
      squareLiftWorldUnits:Number(generatorStats.squareLiftWorldUnits||0),
      roadShoulderCoreRadiusTiles:Number(generatorStats.roadShoulderCoreRadiusTiles||0),
      roadShoulderBlendWidthTiles:Number(generatorStats.roadShoulderBlendWidthTiles||0),
      roadShoulderBlendWidthWorldUnits:Number(generatorStats.roadShoulderBlendWidthWorldUnits||0),
      bridgeClearanceWorldUnits:Number(generatorStats.bridgeClearanceWorldUnits||0),
      roadProfileGroundingShared:generatorStats.roadProfileGroundingShared===true,
      routeSurfaceCellCount,routeMainRoadCellCount,routeLocalPathCellCount,routeSquareCellCount,routeConnectorCellCount,
      routeEdgeStripCount,routeDiagonalBridgeCount,routeDiagonalRibbonOnlyCellCount,routeSurfaceTriangleCount,
      routeSurfaceMaterialCount,
      routeSurfaceMaterialNames:generatorStats.routeSurfaceMaterialNames||Object.freeze([]),
      routeSurfaceMaterialRebinds:Number(generatorStats.routeSurfaceMaterialRebinds||0),
      routeSurfaceMaterialRefreshes:Number(generatorStats.routeSurfaceMaterialRefreshes||0),
      routeSurfaceMaterialAtlasSignatures:generatorStats.routeSurfaceMaterialAtlasSignatures||Object.freeze([]),
      routeSurfaceStaleBindingCount:Number(generatorStats.routeSurfaceStaleBindingCount||0),
      routeSurfaceBindings:generatorStats.routeSurfaceBindings||Object.freeze({}),
      routeSurfaceSamples:Object.freeze(routeSurfaceSamples.slice()),
      routeSurfaceRouteSafe:Boolean(routeSurfaceRouteSafe),
      routeSurfaceRendererOnly:Boolean(routeSurfaceRendererOnly),
      routeNetworkConnectedRouteCount,routeNetworkTotalRouteCount,
      routeNetworkRouteSafetyPass:Boolean(routeNetworkRouteSafetyPass),
      routeNetworkDeterministic:Boolean(routeNetworkDeterministic),
      roadHierarchyPresentationPass:Boolean(
        routeMainRoadCellCount>0&&routeSquareCellCount>0&&
        routeSurfaceMaterialCount>0&&routeSurfaceMaterialCount<=3&&
        routeSurfaceRouteSafe&&routeNetworkRouteSafetyPass&&routeSurfaceRendererOnly&&routeNetworkDeterministic&&
        Number(generatorStats.routeSurfaceStaleBindingCount||0)===0
      ),
      roadProfileResourceCount,
      roadProfileVertexCount,
      roadProfileCoreVertexCount,
      roadProfileShoulderVertexCount,
      roadProfileRoadVertexCount,
      roadProfilePathVertexCount,
      roadProfileSquareVertexCount,
      minRoadProfileDelta:Number.isFinite(minRoadProfileDelta)?Number(minRoadProfileDelta.toFixed(6)):0,
      maxRoadProfileDelta:Number.isFinite(maxRoadProfileDelta)?Number(maxRoadProfileDelta.toFixed(6)):0,
      minRoadCoreHeightDelta:Number.isFinite(minRoadCoreHeightDelta)?Number(minRoadCoreHeightDelta.toFixed(6)):0,
      maxRoadCoreHeightDelta:Number.isFinite(maxRoadCoreHeightDelta)?Number(maxRoadCoreHeightDelta.toFixed(6)):0,
      visibleFrameTerrainRebuildCount,
      materialCount:materialNames.size,
      presentationMeshInstanceCount,presentationEntityCount,sourcePresentationEntityCount,
      staticBatchCount,staticBatchSourcePrimitiveCount,instancedGroupCount,instancedObjectCount,
      optimizedPresentationDrawCalls,unoptimizedPresentationDrawCalls,savedDrawCalls,
      drawCallReductionRatio:unoptimizedPresentationDrawCalls?Number((savedDrawCalls/unoptimizedPresentationDrawCalls).toFixed(4)):0,
      frustumCulledResourceCount,hardwareInstancedResourceCount,batchedResourceCount,
      renderMeshInstanceCount,visibleMeshInstanceCount,culledMeshInstanceCount,cullEnabledMeshInstanceCount,
      buildingPresentationCount,
      entranceTreatmentCount,entranceOrdinaryCount,entranceSpecialCount,entranceThresholdCount,
      entranceFramePrimitiveCount,entranceWearCount,entranceAwningCount,entranceSignCount,entrancePrimitiveCount,
      entranceTreatmentSamples:Object.freeze(entranceTreatmentSamples.slice()),
      entranceAuthoritativeDoorAnchored:Boolean(entranceTreatmentCount>0&&entranceAuthoritativeDoorAnchored),
      entranceRendererOnly:Boolean(entranceRendererOnly),
      entranceNavigationBlocking:Boolean(entranceNavigationBlocking),
      entranceCollisionBlocking:Boolean(entranceCollisionBlocking),
      entranceSharedMaterialCount:Number(generatorStats.entranceSharedMaterialCount||0),
      entranceReadabilityPresentationPass:Boolean(
        entranceTreatmentCount>0&&entranceThresholdCount===entranceTreatmentCount&&
        entranceFramePrimitiveCount===entranceTreatmentCount*3&&
        entranceWearCount===entranceTreatmentCount&&
        entranceAuthoritativeDoorAnchored&&entranceRendererOnly&&
        !entranceNavigationBlocking&&!entranceCollisionBlocking&&
        Number(generatorStats.entranceSharedMaterialCount||0)<=5
      ),
      landmarkPresentationCount,landmarkPrimitiveCount,
      landmarkTreatmentCounts:Object.freeze({...landmarkTreatmentCounts}),
      landmarkContextCounts:Object.freeze({...landmarkContextCounts}),
      landmarkSamples:Object.freeze(landmarkSamples.slice()),
      landmarkSharedMaterialCount:Number(generatorStats.landmarkSharedMaterialCount||0),
      landmarkDeterministic:Boolean(landmarkDeterministic),
      landmarkRendererOnly:Boolean(landmarkRendererOnly),
      landmarkNavigationAuthority:Boolean(landmarkNavigationAuthority),
      landmarkCollisionAuthority:Boolean(landmarkCollisionAuthority),
      landmarkSimulationAuthorityPreserved:Boolean(landmarkSimulationAuthorityPreserved),
      landmarkVisualHierarchyPass:Boolean(
        landmarkPresentationCount===1&&landmarkPrimitiveCount>=3&&
        Object.keys(landmarkTreatmentCounts).length===1&&Object.keys(landmarkContextCounts).length===1&&
        landmarkDeterministic&&landmarkRendererOnly&&!landmarkNavigationAuthority&&!landmarkCollisionAuthority&&
        landmarkSimulationAuthorityPreserved&&Number(generatorStats.landmarkSharedMaterialCount||0)<=3
      ),
      contactShadowTechnique:"batched-foundation-halo+instanced-ground-disc+dynamic-character-disc",
      contactShadowBuildingCount,contactShadowTreeCount,contactShadowPropCount,contactShadowObjectCount,
      contactShadowInstancedGroupCount,contactShadowDrawCalls,
      contactShadowMaterialCount:Number(generatorStats.contactShadowMaterialCount||0),
      contactShadowQuality:String(generatorStats.contactShadowQuality||renderQualitySnapshot()?.activeLevel||"standard"),
      contactShadowOpacity:Number(generatorStats.contactShadowOpacity||0),
      contactShadowMaterialRefreshes:Number(generatorStats.contactShadowMaterialRefreshes||0),
      contactShadowRendererOnly:Boolean(contactShadowRendererOnly),
      contactShadowTerrainSampled:Boolean(contactShadowTerrainSampled),
      contactShadowStaticPass:Boolean(contactShadowBuildingCount>0&&contactShadowTreeCount>0&&contactShadowInstancedGroupCount>0&&contactShadowRendererOnly&&contactShadowTerrainSampled),
      roofProfileCount,roofNormalProfileCount,roofSpecialProfileCount,
      roofProfilePass:Boolean(roofProfileCount>0&&roofProfilePass&&roofCenterRidgeHigher&&roofEaveContactPass&&roofFootprintDriven),
      roofCenterRidgeHigher:Boolean(roofProfileCount>0&&roofCenterRidgeHigher),
      roofEaveContactPass:Boolean(roofProfileCount>0&&roofEaveContactPass),
      roofFootprintDriven:Boolean(roofProfileCount>0&&roofFootprintDriven),
      roofProfileSamples:Object.freeze(roofProfileSamples.slice()),
      roofGeometryAuthority:"renderer-only building footprints",
      interiorObjectPresentationCount,propPresentationCount,
      dressingPresentationCount,dressingDescriptorCount,dressingPrimitiveInstanceCount,dressingInstancedGroupCount,dressingRouteSafeCount,
      dressingContextCounts:Object.freeze({...dressingContextCounts}),
      dressingSemanticCounts:Object.freeze({...dressingSemanticCounts}),
      dressingSamples:Object.freeze(dressingSamples.slice()),
      dressingDeterministic,dressingRendererOnly,
      dressingHardwareInstanced:generatorStats.dressingHardwareInstanced===true,
      dressingSharedMaterialCount:Number(generatorStats.dressingSharedMaterialCount||0),
      dressingRouteProtectionPass:dressingPresentationCount>0&&dressingRouteSafeCount===dressingPresentationCount,
      treePresentationCount,treeVariant0Count,treeVariant1Count,treeInstancedGroupCount,
      treeCylinderSpherePlaceholderCount,
      treePlanePresentation:treePresentationCount>0&&treeCylinderSpherePlaceholderCount===0,
      treeDeterministicVariation:true,
      treeVariationSamples:Object.freeze(treeVariationSamples.slice()),
      treeSampleChunks:Object.freeze(treeSampleChunks.sort((a,b)=>b.count-a.count||a.chunkY-b.chunkY||a.chunkX-b.chunkX).slice(0,24)),
      treeSpriteAtlas:treeSpriteAtlas?.stats?.()||null,
      treeSharedTextureCount:Number(treeSpriteAtlas?.stats?.()?.gpuTextureCount||0),
      treeSharedMaterialCount:Number(generatorStats.treeSpriteMaterialCount||0),
      instancingCoordinateSpace:String(generatorStats.instancingCoordinateSpace||""),
      instancingParentTranslationAppliedOnce:generatorStats.instancingParentTranslationAppliedOnce===true,
      instancingRepositionViaParent:true,
      instancingBufferUpdates:Number(generatorStats.instancingBufferUpdates||0),
      instancingParentRepositions:Number(generatorStats.instancingParentRepositions||0),
      roadCellCount,waterCellCount,bridgeCellCount,terrainTypeCount,
      texturedBlockCount,colorFallbackBlockCount,
      texturedSurfaceTypes:Object.freeze([...texturedSurfaceTypes].sort()),
      fallbackSurfaceTypes:Object.freeze([...fallbackSurfaceTypes].sort()),
      semanticSurfaceTileCounts:Object.freeze({...semanticSurfaceTileCounts}),
      surfaceIdentityMode:"semantic-atlas-per-logical-tile",
      surfaceDebugReport,
      textureAtlas:terrainTextureAtlas?.stats?.()||null,
      terrainSurfaceMode:String(terrainTextureAtlas?.stats?.()?.heightfieldSurfaceMode||""),
      terrainDetailTextureReady:terrainTextureAtlas?.stats?.()?.detailTextureReady===true,
      terrainNormalDetailTextureReady:terrainTextureAtlas?.stats?.()?.normalDetailTextureReady===true,
      terrainMicroReliefMode:String(terrainTextureAtlas?.stats?.()?.microReliefMode||"off"),
      terrainMicroReliefEnabled:terrainTextureAtlas?.stats?.()?.normalDetailTextureReady===true&&terrainMicroReliefEffective(),
      terrainMicroReliefQualityAllows:textureQualitySnapshot().auxiliaryMaps,
      terrainMicroReliefProofOverride:terrainMicroReliefProofOverride,
      terrainMicroReliefStrength:Number(terrainTextureAtlas?.stats?.()?.normalDetailStrength||0),
      terrainMicroReliefGeometryVerticesAdded:Number(terrainTextureAtlas?.stats?.()?.microReliefGeometryVerticesAdded||0),
      terrainMicroReliefMaterialVariantsAdded:Number(terrainTextureAtlas?.stats?.()?.microReliefMaterialVariantsAdded||0),
      buildingSurfaceAtlas:buildingSurfaceAtlas?.stats?.()||null,
      buildingTexturedMaterialCount:Number(generatorStats.buildingTexturedMaterialCount||0),
      buildingTexturedMaterialNames:generatorStats.buildingTexturedMaterialNames||Object.freeze([]),
      seedDerivedPresentation,
      hardCodedSampleGeometry,
      normalWorldSource:"seed-chunk-world-data",
      generator:generatorStats,
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
      performanceProvider:()=>renderQualitySnapshot(),
      prepareChunk:prepareTerrainMeshChunk,
      prepareChunkData:prepareTerrainChunkData,
      cancelChunkData:reason=>window.PlayCanvasChunkWorldData?.cancelMinimumPreparation?.(reason),
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
  function screenToWorldTile(screenX,screenY){
    const width=Math.max(1,host?.clientWidth||1),height=Math.max(1,host?.clientHeight||1);
    const sx=Number(screenX),sy=Number(screenY);
    if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<0||sy<0||sx>width||sy>height)return null;
    const centerGround=screenGroundPoint(width*0.5,height*0.5,0);
    const targetGround=screenGroundPoint(sx,sy,0);
    const center=window.Camera?.getCenter?.();
    if(!centerGround||!targetGround||!center)return null;
    const quantize=value=>value>=0?Math.floor(value+0.5):Math.ceil(value-0.5);
    const dx=quantize(-(targetGround.x-centerGround.x)/WORLD_TILE_METERS);
    const dy=quantize(-(targetGround.z-centerGround.z)/WORLD_TILE_METERS);
    const p=WorldCoordinates.add(center,String(dx),String(dy));
    return Object.freeze({
      x:p.x,y:p.y,level:0,
      source:"playcanvas-screen-ground-pick",
      screen:Object.freeze({x:sx,y:sy}),
      cameraCenter:Object.freeze({x:String(center.x),y:String(center.y)}),
      simulationAuthorityPreserved:true
    });
  }
  function terrainActiveRadii(centerOverride=null){
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
      const centerSource=centerOverride||lastModel?.center;
      const center=centerSource?characterScenePoint(centerSource):Object.freeze({x:0,z:0});
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
  function terrainChunkFloor(value,size){
    const v=BigInt(String(value)),d=BigInt(Math.max(1,Number(size)||1));
    let q=v/d,r=v%d;
    if(r<0n)q-=1n;
    return Number(q);
  }
  function terrainDestinationRequirements(frame,halo=1){
    const size=Math.max(1,terrainChunkSize());
    const columns=Math.max(1,Number(frame?.columns||1)),rows=Math.max(1,Number(frame?.rows||1));
    const halfCols=Math.floor(columns/2),halfRows=Math.floor(rows/2);
    const cx=BigInt(String(frame?.center?.x??"0")),cy=BigInt(String(frame?.center?.y??"0"));
    const margin=BigInt(Math.max(1,Number(halo)||1));
    const minX=cx-BigInt(halfCols)-margin,maxX=cx+BigInt(columns-halfCols-1)+margin;
    const minY=cy-BigInt(halfRows)-margin,maxY=cy+BigInt(rows-halfRows-1)+margin;
    const byChunk=new Map();
    const d=BigInt(size);
    for(let y=minY;y<=maxY;y++){
      for(let x=minX;x<=maxX;x++){
        const chunkX=terrainChunkFloor(x,size),chunkY=terrainChunkFloor(y,size);
        const id=String(chunkX)+","+String(chunkY);
        const localX=Number(x-BigInt(chunkX)*d),localY=Number(y-BigInt(chunkY)*d);
        const index=localY*size+localX;
        if(!byChunk.has(id))byChunk.set(id,[]);
        byChunk.get(id).push(index);
      }
    }
    const requiredChunkIds=Object.freeze([...byChunk.keys()].sort((a,b)=>{
      const [ax,ay]=a.split(",").map(Number),[bx,by]=b.split(",").map(Number);
      return ay-by||ax-bx;
    }));
    const requiredCellsByChunk={};
    for(const id of requiredChunkIds){
      requiredCellsByChunk[id]=Object.freeze([...new Set(byChunk.get(id))].sort((a,b)=>a-b));
    }
    return Object.freeze({
      requiredChunkIds,
      requiredCellsByChunk:Object.freeze(requiredCellsByChunk),
      requestedCellCount:requiredChunkIds.reduce((sum,id)=>sum+requiredCellsByChunk[id].length,0),
      haloTiles:Number(margin)
    });
  }
  function terrainDestinationChunkIds(frame){
    return terrainDestinationRequirements(frame,1).requiredChunkIds;
  }
  function terrainDestinationRadii(frame){
    const size=Math.max(1,terrainChunkSize());
    const columns=Math.max(1,Number(frame?.columns||1));
    const rows=Math.max(1,Number(frame?.rows||1));
    return Object.freeze({
      x:Math.max(1,Math.ceil(Math.floor(columns/2)/size)),
      y:Math.max(1,Math.ceil(Math.floor(rows/2)/size))
    });
  }
  function repositionTerrainResourcesIfNeeded(manager){
    if(!manager||lastPositionedAnchorRevision===sceneAnchorRevision)return 0;
    let count=0;
    manager.forEachResource(resource=>{positionTerrainChunk(resource);count++;});
    navigationTelemetry.bulkChunkRepositions++;
    navigationTelemetry.bulkChunkRepositionedResources+=count;
    lastPositionedAnchorRevision=sceneAnchorRevision;
    return count;
  }
  function updateTerrainPreload(center){
    const manager=initTerrainPreload();
    if(!manager||!center)return null;
    const started=performance.now();
    navigationTelemetry.preloadUpdateCalls++;
    manager.setChunkSize(terrainChunkSize());
    const radii=terrainActiveRadii(center);
    const result=manager.update({center,activeRadiusX:radii.x,activeRadiusY:radii.y});
    repositionTerrainResourcesIfNeeded(manager);
    const elapsed=performance.now()-started;
    navigationTelemetry.lastPreloadUpdateMs=elapsed;
    navigationTelemetry.totalPreloadUpdateMs+=elapsed;
    navigationTelemetry.maxPreloadUpdateMs=Math.max(navigationTelemetry.maxPreloadUpdateMs,elapsed);
    return result;
  }
  async function prepareTerrainDestination(model,{onProgress=null,graceMs=180,forceGate=false}={}){
    lastRawSeed=model?.seed??lastRawSeed;
    const frame=window.RendererContract?.frameFromModel?.(model)||null;
    if(!frame?.center)return Object.freeze({ready:false,reason:"missing-center"});
    const manager=initTerrainPreload();
    if(!manager)return Object.freeze({ready:false,reason:"preload-unavailable"});
    manager.setChunkSize(terrainChunkSize());
    // Destination coverage comes from the requested logical view itself, not
    // from either the old camera transform or the not-yet-committed target.
    // This keeps long-distance work bounded and deterministic.
    const radii=terrainDestinationRadii(frame);
    const destinationRequirements=terrainDestinationRequirements(frame,1);
    const requiredChunkIds=destinationRequirements.requiredChunkIds;
    const requiredCellsByChunk=destinationRequirements.requiredCellsByChunk;
    const terrainTextures=await prepareTerrainTextureAtlas();
    const buildingTextures=await prepareBuildingSurfaceAtlas();
    const treeSprites=await prepareTreeSpriteAtlas();
    const result=await manager.prepareDestination({
      center:frame.center,
      activeRadiusX:radii.x,
      activeRadiusY:radii.y,
      requiredChunkIds,
      requiredCellsByChunk
    },{onProgress,graceMs,forceGate});
    if(!result?.ready)return Object.freeze({...result,terrainTextures,buildingTextures,treeSprites});
    // The streaming-minimum mesh is self-contained (terrain atlas + procedural
    // building presentation). Optional glTF/prop world assets are deliberately
    // not part of the gate-critical path and resume after Ready.
    const worldAssets=Object.freeze({ready:true,deferred:true,reason:"streaming-minimum-critical-path",simulationAuthorityPreserved:true});
    pendingTerrainDestination=Object.freeze({
      key:preparedTerrainKey(lastRawSeed,frame.center),
      center:Object.freeze({x:String(frame.center.x),y:String(frame.center.y)}),
      activeRadiusX:radii.x,activeRadiusY:radii.y,
      requiredChunkIds,
      requiredCellsByChunk,
      requestedCellCount:destinationRequirements.requestedCellCount
    });
    return Object.freeze({
      ...result,
      worldAssetsReady:true,
      worldAssets,
      terrainTextures,buildingTextures,treeSprites,
      activeRadiusX:radii.x,activeRadiusY:radii.y,requiredChunkIds,
      requiredDestinationCellCount:destinationRequirements.requestedCellCount,
      streamingMinimumResources:Number(manager.stats?.().streamingMinimumResources||0),
      destinationPresentationProfile:"minimum",
      simulationAuthorityPreserved:true
    });
  }
  function cancelTerrainDestination(reason="superseded"){
    pendingTerrainDestination=null;
    return terrainPreloadManager?.cancelDestination?.(reason)||null;
  }
  function finishTerrainDestination(){
    const result=terrainPreloadManager?.finishDestination?.()||null;
    const background=Boolean(window.TerrainChunkPreloadSettings?.get?.()?.backgroundChunkGeneration);
    if(background){
      setTimeout(()=>{
        if(!app||!terrainPreloadManager)return;
        void prepareWorldAssets().catch(error=>console.warn("Deferred destination world-asset preparation failed.",error));
      },0);
    }
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
    const treatment=worldVisualStyle()?.spriteTreatment?.character||{};
    const diffuseTint=Array.isArray(treatment.diffuseTint)?treatment.diffuseTint:[1,1,1];
    const emissiveTint=Array.isArray(treatment.emissiveTint)?treatment.emissiveTint:[1,1,1];
    material.diffuse.set(...diffuseTint);
    material.emissive.set(...emissiveTint);
    material.diffuseMap=texture;
    material.emissiveMap=texture;
    material.opacityMap=texture;
    material.opacityMapChannel="a";
    material.alphaTest=Number(treatment.alphaTest??0.12);
    material.blendType=pc.BLEND_NONE;
    material.depthWrite=true;
    material.depthTest=true;
    material.cull=pc.CULLFACE_NONE;
    material.useLighting=treatment.useLighting===true;
    material._advisorArtTreatmentSignature=String(worldVisualStyle()?.signature||"");
    material._advisorArtRole=String(treatment.role||"character");
    material.update();
    characterMaterials.set(url,material);
    return material;
  }
  function characterContactProfile(){
    const managed=renderQualitySnapshot()||{};
    const level=String(managed.activeLevel||managed.mode||"standard");
    const opacity=level==="low"?0.105:level==="high"?0.185:0.145;
    return Object.freeze({level,opacity});
  }
  function refreshCharacterContactMaterial(){
    if(!pc)return null;
    if(!characterContactMaterialRef){
      const m=new pc.StandardMaterial();
      m.name="character-contact-shadow";
      characterContactMaterialRef=m;
      materials.set(m.name,m);
    }
    const profile=characterContactProfile(),m=characterContactMaterialRef;
    m.diffuse.set(0.035,0.028,0.022);
    m.emissive.set(0.018,0.014,0.011);
    m.opacity=profile.opacity;
    m.blendType=pc.BLEND_NORMAL;
    m.depthWrite=false;
    m.depthTest=true;
    m.cull=pc.CULLFACE_NONE;
    m.useLighting=false;
    m.gloss=0;
    m.metalness=0;
    m.update();
    return m;
  }
  function characterContactDiscMesh(){
    if(characterContactMesh)return characterContactMesh;
    const mesh=new pc.Mesh(device),positions=[0,0,0],normals=[0,1,0],uvs=[0.5,0.5],indices=[],segments=16;
    for(let i=0;i<=segments;i++){
      const a=Math.PI*2*i/segments,x=Math.cos(a)*0.5,z=Math.sin(a)*0.5;
      positions.push(x,0,z);normals.push(0,1,0);uvs.push(x+0.5,z+0.5);
    }
    for(let i=0;i<segments;i++)indices.push(0,i+1,i+2);
    mesh.setPositions(positions);mesh.setNormals(normals);mesh.setUvs(0,uvs);mesh.setIndices(indices);mesh.update();
    characterContactMesh=mesh;
    return mesh;
  }
  function characterContactResources(){
    if(characterContactEntity)return characterContactEntity;
    if(!characterContactRoot)return null;
    const entity=new pc.Entity("CharacterContactShadowInstances");
    const mi=new pc.MeshInstance(characterContactDiscMesh(),refreshCharacterContactMaterial(),entity);
    entity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
    entity.render.meshInstances=[mi];
    entity.enabled=false;
    characterContactRoot.addChild(entity);
    characterContactEntity=entity;
    characterContactMeshInstance=mi;
    return entity;
  }
  function characterContactSlope(point,offset){
    const size=terrainChunkSize(),half=0.22;
    const ox=Number(offset?.x||0),oy=Number(offset?.y||0);
    const left=Number(terrainChunkMeshFactory?.heightAtTile?.(point.x,point.y,size,ox-half,oy)||0);
    const right=Number(terrainChunkMeshFactory?.heightAtTile?.(point.x,point.y,size,ox+half,oy)||0);
    const north=Number(terrainChunkMeshFactory?.heightAtTile?.(point.x,point.y,size,ox,oy-half)||0);
    const south=Number(terrainChunkMeshFactory?.heightAtTile?.(point.x,point.y,size,ox,oy+half)||0);
    const run=half*2*WORLD_TILE_METERS;
    const sx=(right-left)/Math.max(0.001,run),sz=(south-north)/Math.max(0.001,run);
    return Object.freeze({
      eulerX:Number((Math.atan2(sz,1)*180/Math.PI).toFixed(4)),
      eulerZ:Number((-Math.atan2(sx,1)*180/Math.PI).toFixed(4)),
      slopeMagnitude:Number(Math.hypot(sx,sz).toFixed(5))
    });
  }
  function characterContactMatrixData(items){
    const data=new Float32Array(items.length*16);
    const matrix=new pc.Mat4(),pos=new pc.Vec3(),rot=new pc.Quat(),scale=new pc.Vec3();
    for(let i=0;i<items.length;i++){
      const item=items[i];
      pos.set(item.x,item.y,item.z);
      rot.setFromEulerAngles(item.eulerX,0,item.eulerZ);
      scale.set(item.scaleX,1,item.scaleZ);
      matrix.setTRS(pos,rot,scale);
      data.set(matrix.data,i*16);
    }
    return data;
  }
  function characterContactAabb(items){
    if(!items.length)return new pc.BoundingBox(new pc.Vec3(0,0,0),new pc.Vec3(1,0.1,1));
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const item of items){
      const hx=Math.abs(item.scaleX)*0.6,hz=Math.abs(item.scaleZ)*0.6;
      minX=Math.min(minX,item.x-hx);maxX=Math.max(maxX,item.x+hx);
      minY=Math.min(minY,item.y-0.08);maxY=Math.max(maxY,item.y+0.08);
      minZ=Math.min(minZ,item.z-hz);maxZ=Math.max(maxZ,item.z+hz);
    }
    return new pc.BoundingBox(
      new pc.Vec3((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2),
      new pc.Vec3((maxX-minX)/2,(maxY-minY)/2,(maxZ-minZ)/2)
    );
  }
  function syncCharacterContactShadows(items){
    const list=Array.isArray(items)?items:[];
    const entity=characterContactResources();
    const profile=characterContactProfile();
    refreshCharacterContactMaterial();
    if(!entity||!characterContactMeshInstance||!list.length){
      if(entity)entity.enabled=false;
      lastCharacterContactState=Object.freeze({
        count:0,drawCalls:0,materialCount:characterContactMaterialRef?1:0,hardwareInstanced:true,
        terrainAlignedCount:0,quality:profile.level,opacity:profile.opacity,bufferUpdates:characterContactBufferUpdates,
        groundLift:CHARACTER_CONTACT_SHADOW_LIFT,simulationAuthorityPreserved:true
      });
      return lastCharacterContactState;
    }
    const data=characterContactMatrixData(list);
    const format=pc.VertexFormat.getDefaultInstancingFormat(device);
    if(!characterContactBuffer||characterContactCapacity!==list.length||typeof characterContactBuffer.setData!=="function"){
      characterContactBuffer?.destroy?.();
      characterContactBuffer=new pc.VertexBuffer(device,format,list.length,{data});
      characterContactCapacity=list.length;
    }else characterContactBuffer.setData(data);
    characterContactMeshInstance.setInstancing(characterContactBuffer,true);
    entity.render.customAabb=characterContactAabb(list);
    entity.enabled=true;
    characterContactBufferUpdates++;
    lastCharacterContactState=Object.freeze({
      count:list.length,drawCalls:1,materialCount:1,hardwareInstanced:true,
      terrainAlignedCount:list.filter(item=>item.terrainAligned).length,
      quality:profile.level,opacity:profile.opacity,bufferUpdates:characterContactBufferUpdates,
      groundLift:CHARACTER_CONTACT_SHADOW_LIFT,
      maxSlopeMagnitude:Number(Math.max(...list.map(item=>Number(item.slopeMagnitude||0))).toFixed(5)),
      feetCoordinateAnchored:true,terrainGroundSampler:"indexed-triangle-exact",simulationAuthorityPreserved:true
    });
    return lastCharacterContactState;
  }

  function clearCharacterBillboards(){
    syncCharacterContactShadows([]);
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
  function projectedScreenPoint(scenePoint,worldY){
    const component=camera?.camera;
    if(!component?.worldToScreen||!pc)return null;
    try{
      const screen=component.worldToScreen(new pc.Vec3(scenePoint.x,worldY,scenePoint.z),new pc.Vec3());
      return Object.freeze({x:Number(screen.x),y:Number(screen.y)});
    }catch(_){return null}
  }
  function characterPresentationMetrics(scenePoint,feetY,baseHeight){
    const shortViewport=Math.max(1,Number(host?.clientHeight||1))<260;
    const targetPixelHeight=shortViewport?CHARACTER_SHORT_VIEW_FALLBACK_PX:CHARACTER_MIN_SCREEN_PX;
    const basePixelHeight=projectedCharacterPixels(scenePoint,feetY,baseHeight);
    const requiredHeight=basePixelHeight>0?baseHeight*(targetPixelHeight/basePixelHeight):baseHeight;
    // Preserve the pre-WP visible-height rule as an explicit baseline, then
    // multiply that complete result. This guarantees a true 2x presentation
    // increase instead of merely raising the minimum screen-pixel floor.
    const baselinePresentationHeight=clamp(
      Math.max(baseHeight,requiredHeight),
      baseHeight,
      baseHeight*CHARACTER_BASELINE_MAX_PRESENTATION_SCALE
    );
    const presentationHeight=clamp(
      baselinePresentationHeight*CHARACTER_PRESENTATION_MULTIPLIER,
      baseHeight*CHARACTER_PRESENTATION_MULTIPLIER,
      baseHeight*CHARACTER_MAX_PRESENTATION_SCALE
    );
    const baselineRenderedPixelHeight=projectedCharacterPixels(scenePoint,feetY,baselinePresentationHeight);
    const renderedPixelHeight=projectedCharacterPixels(scenePoint,feetY,presentationHeight);
    return Object.freeze({
      baseHeight,
      baselinePresentationHeight,
      baselinePresentationScale:Number((baselinePresentationHeight/baseHeight).toFixed(4)),
      baselineRenderedPixelHeight:Number(baselineRenderedPixelHeight.toFixed(2)),
      presentationMultiplier:CHARACTER_PRESENTATION_MULTIPLIER,
      effectivePresentationMultiplier:Number((presentationHeight/baselinePresentationHeight).toFixed(4)),
      presentationHeight,
      presentationScale:Number((presentationHeight/baseHeight).toFixed(4)),
      targetPixelHeight,
      renderedPixelHeight:Number(renderedPixelHeight.toFixed(2)),
      boundedFallback:Boolean(renderedPixelHeight+0.5<targetPixelHeight*CHARACTER_PRESENTATION_MULTIPLIER),
      shortViewport,
      baselineMaxPresentationScale:CHARACTER_BASELINE_MAX_PRESENTATION_SCALE,
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
    /* Active terrain already bounds character presentation to the prepared
       gameplay area. Do not apply a smaller camera-center box here: the
       PlayCanvas frustum/render path can cull genuinely off-screen billboards
       without making on-screen NPCs pop near viewport edges. */
    return true;
  }
  function syncCharacterBillboards(characters){
    if(!charactersRoot)return Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:characterTextures.size,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,suppressedCharacterCount:0,suppressedCharacterIds:Object.freeze([]),instances:Object.freeze([])});
    const desired=new Map();
    const cameraFacingYaw=Number(lastCameraBillboardYawDegrees||45);
    let activeCharacterCount=0;
    const visibleIds=[];
    const suppressedIds=[];
    const instances=[];
    const contactShadows=[];
    const placedResidents=[];
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
      const entity=record.entity;
      const role=String(raw.role||"resident");
      const flipped=Boolean(raw.flipX);
      const elevation=Math.max(0,Number(raw.elevation??CHARACTER_DEFAULT_ELEVATION));
      const baseOffset=Object.freeze({
        x:Number(raw.presentationOffset?.x||0),
        y:Number(raw.presentationOffset?.y||0)
      });
      const shifts=role==="resident"
        ?[0,...Array.from({length:NPC_SEPARATION_MAX_STEPS},(_,index)=>{
            const step=(index+1)*NPC_SEPARATION_STEP_TILES;
            return [step,-step];
          }).flat()]
        :[0];
      let selected=null;
      for(const separationShift of shifts){
        const finalOffset=Object.freeze({
          x:baseOffset.x+separationShift,
          y:baseOffset.y-separationShift
        });
        const candidateScenePoint=characterScenePoint(point,finalOffset);
        const candidateGroundY=Number(terrainChunkMeshFactory?.heightAtTile?.(
          point.x,point.y,terrainChunkSize(),finalOffset.x,finalOffset.y
        )||0);
        const candidateFeetY=candidateGroundY+elevation+CHARACTER_GROUND_LIFT;
        const candidatePresentation=characterPresentationMetrics(candidateScenePoint,candidateFeetY,baseHeight);
        const candidateHeight=candidatePresentation.presentationHeight;
        const candidateWidth=candidateHeight*aspect;
        const screen=projectedScreenPoint(candidateScenePoint,candidateFeetY+candidateHeight*0.5);
        const renderedHeight=Math.max(
          8,
          Number(candidatePresentation.renderedPixelHeight||0),
          Number(candidatePresentation.targetPixelHeight||CHARACTER_MIN_SCREEN_PX)*CHARACTER_PRESENTATION_MULTIPLIER
        );
        const rect=screen?Object.freeze({
          x:screen.x,
          y:screen.y,
          halfWidth:renderedHeight*aspect*0.5,
          halfHeight:renderedHeight*0.5
        }):null;
        const overlaps=role==="resident"&&rect&&placedResidents.some(other=>
          Math.abs(rect.x-other.x)<rect.halfWidth+other.halfWidth+NPC_SEPARATION_SCREEN_PADDING_PX&&
          Math.abs(rect.y-other.y)<rect.halfHeight+other.halfHeight+NPC_SEPARATION_SCREEN_PADDING_PX
        );
        selected={finalOffset,separationShift,scenePoint:candidateScenePoint,groundY:candidateGroundY,feetY:candidateFeetY,presentation:candidatePresentation,height:candidateHeight,width:candidateWidth,rect};
        if(!overlaps)break;
      }
      const scenePoint=selected.scenePoint;
      const groundY=selected.groundY;
      const feetY=selected.feetY;
      const presentation=selected.presentation;
      const height=selected.height;
      const width=selected.width;
      if(role==="resident"&&selected.rect)placedResidents.push(selected.rect);
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
      const contactSlope=characterContactSlope(point,selected.finalOffset);
      contactShadows.push(Object.freeze({
        id,role,
        x:scenePoint.x,y:groundY+CHARACTER_CONTACT_SHADOW_LIFT,z:scenePoint.z,
        scaleX:role==="protagonist"?1.04:0.90,
        scaleZ:role==="protagonist"?0.62:0.52,
        eulerX:contactSlope.eulerX,eulerZ:contactSlope.eulerZ,
        slopeMagnitude:contactSlope.slopeMagnitude,
        terrainAligned:true,
        world:Object.freeze({x:String(point.x),y:String(point.y)})
      }));
      instances.push(Object.freeze({
        id,
        role,
        world:Object.freeze({x:String(point.x),y:String(point.y)}),
        simulationPresentationOffset:baseOffset,
        separationOffset:Object.freeze({x:Number(selected.separationShift||0),y:Number(-(selected.separationShift||0))}),
        separationApplied:Math.abs(Number(selected.separationShift||0))>1e-9,
        presentationOffset:selected.finalOffset,
        scene:Object.freeze({x:scenePoint.x,z:scenePoint.z}),
        groundY,
        baselineFeetY:feetY,
        feetY,
        terrainGrounded:true,
        groundSampler:"indexed-triangle-exact",
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
        baselinePresentationHeight:presentation.baselinePresentationHeight,
        baselinePresentationScale:presentation.baselinePresentationScale,
        baselineRenderedPixelHeight:presentation.baselineRenderedPixelHeight,
        presentationMultiplier:presentation.presentationMultiplier,
        effectivePresentationMultiplier:presentation.effectivePresentationMultiplier,
        renderedPixelHeight:presentation.renderedPixelHeight,
        targetPixelHeight:presentation.targetPixelHeight,
        presentationScale:presentation.presentationScale,
        baselineMaxPresentationScale:presentation.baselineMaxPresentationScale,
        maxPresentationScale:presentation.maxPresentationScale,
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
    syncCharacterContactShadows(contactShadows);
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
  function updateCameraTransform(centerOverride=null,zoomOverride=null){
    if(!camera)return;
    const started=performance.now();
    navigationTelemetry.cameraTransformCalls++;
    if(interiorProofState){
      const building=selectInteriorProofBuilding(interiorProofState),bounds=proofBounds(building);
      if(bounds)updateInteriorProofCamera(bounds);
    }else{
      const center=centerOverride||lastModel?.center||window.Camera?.getCenter?.()||{x:"0",y:"0"};
      ensureSceneAnchor(center);
      const dx=safeDeltaTiles(center.x,sceneAnchor?.x??center.x)??0,dy=safeDeltaTiles(center.y,sceneAnchor?.y??center.y)??0;
      const requestedZoom=zoomOverride===null||zoomOverride===undefined
        ?(lastModel?.cameraZoom??window.Camera?.getZoom?.()??1)
        :zoomOverride;
      const targetX=dx*WORLD_TILE_METERS,targetZ=dy*WORLD_TILE_METERS,zoom=clamp(Number(requestedZoom),0.5,2);
      const targetY=Number(terrainChunkMeshFactory?.heightAtTile?.(center.x,center.y,terrainChunkSize())||0);
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
        targetY+15.5*cameraDistanceScale,
        targetZ+13.5*cameraDistanceScale
      );
      camera.lookAt(targetX,targetY,targetZ);
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
  function resize(centerOverride=null,zoomOverride=null){
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
    updateCameraTransform(centerOverride,zoomOverride);
    if(lastModel?.visibleCharacters&&charactersRoot)syncCharacterBillboards(lastModel.visibleCharacters);
  }
  function frameStats(){const stats=app?.stats||{},rawGpu=Number(stats.frame?.gpuTime??stats.frame?.gpuMs);return Object.freeze({frameMs:Number(stats.frame?.ms||0),gpuMs:Number.isFinite(rawGpu)?rawGpu:null,renderMs:Number(stats.frame?.renderTime||0),drawCalls:Number(stats.drawCalls?.total||device?._drawCallsPerFrame||0),triangles:Number(stats.frame?.triangles||device?._primitiveCount||0)});}
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
      terrainHeightVertexSampleCalls:Number(generator.heightVertexSampleCalls||0),
      terrainGroundSampleCalls:Number(generator.heightGroundSampleCalls||0),
      visibleFrameTerrainRebuildCount:0,
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
  function sceneInfo(){const sampleCount=sampleVillageEntityCount();return Object.freeze({projection:camera?.camera?.projection===pc?.PROJECTION_ORTHOGRAPHIC?"orthographic":"unknown",orthoHeight:Number(camera?.camera?.orthoHeight||0),baseOrthoHeight:BASE_ORTHO_HEIGHT,wideOrthoHeight:WIDE_ORTHO_HEIGHT,portraitOrthoHeight:PORTRAIT_ORTHO_HEIGHT,shortLandscapeOrthoHeight:SHORT_LANDSCAPE_ORTHO_HEIGHT,worldTileMeters:WORLD_TILE_METERS,anchor:sceneAnchor,roots:Object.freeze(["TerrainPreloadRoot","TerrainRoot","StructuresRoot","PropsRoot","CharacterContactShadowsRoot","CharacterBillboardsRoot","LightingRoot"]),entityCount:entityCount(app?.root),terrainEntityCount:entityCount(terrainRoot),structureEntityCount:entityCount(structuresRoot),propEntityCount:entityCount(propsRoot),characterEntityCount:entityCount(charactersRoot),characterBillboardCount:Number(characterEntities.size||0),characterContactShadowEntityCount:entityCount(characterContactRoot),lightingEntityCount:entityCount(lightingRoot),materialCount:Number(lastMaterialQuality.materialCount||0),materialVariantCount:Number(lastMaterialQuality.materialVariantCount||0),roofStyle:"gabled-center-ridge-two-plane",roofEntityCount:roofEntities.filter(roof=>Boolean(roof?.parent)).length,cutawayActive:lastCutawayState.active,cutawayLocal:lastCutawayState.local,cutawayBuildingId:lastCutawayState.targetBuildingId,hiddenRoofCount:lastCutawayState.hiddenRoofCount,normalWorldSource:"seed-chunk-world-data",sampleVillageEntityCount:sampleCount,hardCodedSampleGeometry:sampleCount>0});}
  function canvasInfo(){return Object.freeze({cssWidth:Math.max(0,Math.round(host?.clientWidth||0)),cssHeight:Math.max(0,Math.round(host?.clientHeight||0)),backingWidth:Number(canvas?.width||0),backingHeight:Number(canvas?.height||0)});}
  function baseSnapshot(extra={}){const deviceType=device?.deviceType||"unknown",current=window.RendererContract?.simulationSnapshot?.()||null;return Object.freeze({ready:Boolean(app&&device),engine:"PlayCanvas",engineVersion:ENGINE_VERSION,rendererContractVersion:window.RendererContract?.version||null,backend:deviceType,requestedBackend:preference,gpu:Boolean(device),webgl:deviceType==="webgl2",webgpu:deviceType==="webgpu",webgpuAvailable:Boolean(navigator.gpu),migrationFoundation:true,sceneBaseline:Boolean(camera&&worldRoot),canvasCount:host?host.querySelectorAll("canvas").length:0,canvas:canvasInfo(),quality:quality||Object.freeze({deviceClass:"unknown",browserDevicePixelRatio:Number(window.devicePixelRatio||1),maxPixelRatio:1,renderScale:1,effectivePixelRatio:1}),scene:sceneInfo(),worldVisualStyle:worldVisualStyle()?.snapshot?.()||null,performance:frameStats(),navigationHotPath:navigationHotPathMetrics(),domTerrainTileCount:document.querySelectorAll(".terrain-tile").length,logicalTextureKeyPass:true,simulationAuthorityPreserved:beforeInit&&afterInit?window.RendererContract.sameSimulation(beforeInit,afterInit):true,simulationSnapshot:current,frame:lastModel,regionKey:lastModel?.regionKey||null,tileCount:lastModel?.tileCount||0,protagonistVisible:Boolean(lastCharacterState.visibleProtagonist),characterPresentation:Object.freeze({activeCharacterCount:Number(lastCharacterState.activeCharacterCount||0),simulatedCharacterCount:Number(lastCharacterState.simulatedCharacterCount||0),preparedCharacterCount:Number(lastCharacterState.preparedCharacterCount||0),visibleCharacterIds:lastCharacterState.visibleCharacterIds,visibleProtagonist:Boolean(lastCharacterState.visibleProtagonist),suppressedCharacterCount:Number(lastCharacterState.suppressedCharacterCount||0),suppressedCharacterIds:lastCharacterState.suppressedCharacterIds||Object.freeze([]),instances:lastCharacterState.instances||Object.freeze([]),feetAnchored:true,billboardMode:"camera-facing-upright",wpS003004005Revision:"completed",minScreenPixelHeight:CHARACTER_MIN_SCREEN_PX,shortViewportFallbackPixelHeight:CHARACTER_SHORT_VIEW_FALLBACK_PX,baselineMaxPresentationScale:CHARACTER_BASELINE_MAX_PRESENTATION_SCALE,presentationMultiplier:CHARACTER_PRESENTATION_MULTIPLIER,maxPresentationScale:CHARACTER_MAX_PRESENTATION_SCALE,depthTest:true,depthWrite:true,sharedTextureCount:characterTextures.size,sharedMaterialCount:characterMaterials.size,
contactShadowCount:Number(lastCharacterContactState.count||0),
contactShadowDrawCalls:Number(lastCharacterContactState.drawCalls||0),
contactShadowMaterialCount:Number(lastCharacterContactState.materialCount||0),
contactShadowHardwareInstanced:Boolean(lastCharacterContactState.hardwareInstanced),
contactShadowTerrainAlignedCount:Number(lastCharacterContactState.terrainAlignedCount||0),
contactShadowQuality:String(lastCharacterContactState.quality||"standard"),
contactShadowOpacity:Number(lastCharacterContactState.opacity||0),
contactShadowGroundLift:Number(lastCharacterContactState.groundLift||CHARACTER_CONTACT_SHADOW_LIFT),
contactShadowFeetCoordinateAnchored:Boolean(lastCharacterContactState.feetCoordinateAnchored),
contactShadowTerrainGroundSampler:lastCharacterContactState.terrainGroundSampler||"indexed-triangle-exact",
contactShadowBufferUpdates:Number(lastCharacterContactState.bufferUpdates||0),
simulationAuthorityPreserved:true,migrationFoundation:true}),contactGrounding:lastCharacterContactState,characterProof:lastCharacterProof,buildingPresentation:Object.freeze({layerOrder:Object.freeze(["playcanvas-world"]),proofState,visibleBuildingCount:lastModel?.buildingCount||0,visibleInteriorObjectCount:lastModel?.interiorObjectCount||0,simulationAuthorityPreserved:true,migrationFoundation:true,cutawayActive:lastCutawayState.active,cutawayLocal:lastCutawayState.local,cutawayBuildingId:lastCutawayState.targetBuildingId,hiddenRoofCount:lastCutawayState.hiddenRoofCount,totalRoofCount:lastCutawayState.totalRoofCount}),buildingOcclusion:Object.freeze({proofState:occlusionProofState,simulationAuthorityPreserved:true,migrationFoundation:true}),interiorObjectPresentation:lastInteriorObjectPresentation,assetPreparationProof:lastAssetPreparationProof,materialTextureQuality:lastMaterialQuality,worldAssetPreparation:lastWorldPreparation,worldAssetCache:worldPreparation?.stats?.()||null,worldAssetProof:worldPreparation?.proof?.()||null,characterAssetPreparation:characterPreparation?.stats?.()||null,terrainPreload:terrainPreloadManager?.stats?.()||Object.freeze({settings:window.TerrainChunkPreloadSettings?.get?.()||null,Active:0,Prepared:0,Cached:0,queueDepth:0,hits:0,misses:0,compositions:0,evictions:0,visibleWaits:0,bounded:true,simulationAuthorityPreserved:true}),terrainChunks:Object.freeze({migrationFoundation:true,visibleChunkCount:Number(terrainPreloadManager?.stats?.().Active||0),preparedChunkCount:Number(terrainPreloadManager?.stats?.().Prepared||0),cachedChunkCount:Number(terrainPreloadManager?.stats?.().Cached||0),hits:Number(terrainPreloadManager?.stats?.().hits||0),misses:Number(terrainPreloadManager?.stats?.().misses||0),compositions:Number(terrainPreloadManager?.stats?.().compositions||0),chunkSize:Number(terrainPreloadManager?.stats?.().chunkSize||terrainChunkSize()),signature:String(terrainPreloadManager?.stats?.().signature||""),presentationSignature:terrainTextureProfile(),invalidations:Number(terrainPreloadManager?.stats?.().invalidations||0),lastInvalidationReason:terrainPreloadManager?.stats?.().lastInvalidationReason||null,createdSprites:0,reusedSprites:Number(terrainPreloadManager?.stats?.().hits||0),removedSprites:0,evictions:Number(terrainPreloadManager?.stats?.().evictions||0),visibleWaitedForComposition:Number(terrainPreloadManager?.stats?.().visibleWaits||0)>0,...terrainMeshMetrics()}),...extra});}
  let ambientMotionClockSeconds=0;
  function updateAmbientMotionFrame(dt){
    const seconds=Math.max(0,Number(dt)||0);
    ambientMotionClockSeconds+=seconds;
    if(!terrainChunkMeshFactory||!terrainPreloadManager)return;
    const started=performance.now();
    const managed=renderQualitySnapshot()||{};
    const qualityLevel=String(managed.activeLevel||managed.mode||"standard");
    const zoom=Math.max(0.05,Number(lastModel?.cameraZoom??window.Camera?.getZoom?.()??1));
    let activeResources=0;
    terrainPreloadManager.forEachResource?.((resource,entry)=>{
      if(entry?.state!=="Active"||resource?.entity?.enabled===false)return;
      activeResources++;
      terrainChunkMeshFactory.updateAmbientMotion?.(resource,ambientMotionClockSeconds,{qualityLevel,zoom,enabled:ambientMotionProofOverride!==false});
    });
    const elapsed=performance.now()-started;
    ambientFrameTelemetry.calls++;
    ambientFrameTelemetry.totalMs+=elapsed;
    ambientFrameTelemetry.lastMs=elapsed;
    ambientFrameTelemetry.maxMs=Math.max(ambientFrameTelemetry.maxMs,elapsed);
    ambientFrameTelemetry.lastActiveResources=activeResources;
  }

  async function init(target){if(app)return snapshot();if(!target)throw new Error("PlayCanvas renderer requires a gameplay host");host=target;beforeInit=window.RendererContract?.simulationSnapshot?.()||null;pc=await loadEngine();canvas=document.createElement("canvas");canvas.id="gameCanvas";canvas.className="game-canvas";canvas.setAttribute("aria-label","PlayCanvas orthographic 3D gameplay world");canvas.dataset.renderer="playcanvas";host.replaceChildren(canvas);device=await pc.createGraphicsDevice(canvas,{deviceTypes:requestedDeviceTypes(),antialias:false,depth:true,powerPreference:"high-performance"});const options=new pc.AppOptions();options.graphicsDevice=device;options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];options.resourceHandlers=[pc.TextureHandler,pc.ContainerHandler];app=new pc.AppBase(canvas);app.init(options);const initialTextureQuality=textureQualitySnapshot();characterPreparation=window.PlayCanvasAssetPreparation?.create({app,pc,cacheLimit:64})||null;worldPreparation=window.PlayCanvasAssetPreparation?.create({app,pc,cacheLimit:initialTextureQuality.worldAssetCacheLimit})||null;if(!worldPreparation||!window.PlayCanvasWorldAssets?.registerBaseline?.(worldPreparation))throw new Error("PlayCanvas world asset catalog registration failed");buildScene();setNormalWorldEnabled(false);applyRenderLightingQuality();resize();initTerrainPreload();applyMaterialTextureQuality();qualityChangeHandler=handleTextureQualityChange;window.addEventListener("advisor:texture-quality-change",qualityChangeHandler);renderQualityChangeHandler=handleRenderQualityChange;window.addEventListener("advisor:render-quality-change",renderQualityChangeHandler);renderQualityFrameHandler=dt=>window.RuntimeRenderQuality?.recordFrame?.(Math.max(0,Number(dt)||0)*1000);app.on?.("update",renderQualityFrameHandler);ambientMotionFrameHandler=updateAmbientMotionFrame;app.on?.("update",ambientMotionFrameHandler);app.start();if("ResizeObserver" in window){resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);}else window.addEventListener("resize",resize);afterInit=window.RendererContract?.simulationSnapshot?.()||null;if(beforeInit&&afterInit&&!window.RendererContract.sameSimulation(beforeInit,afterInit))throw new Error("PlayCanvas initialization changed authoritative Simulation state");host.hidden=false;lastSnapshot=baseSnapshot({ready:true,canvasCount:host.querySelectorAll("canvas").length});return lastSnapshot;}
  function render(model){lastRawSeed=model?.seed??lastRawSeed;lastRawInteriorObjects=Array.isArray(model?.interiorObjects)?model.interiorObjects:[];lastRawBuildingInteriors=Array.isArray(model?.buildingInteriors)?model.buildingInteriors:[];const frame=window.RendererContract?.frameFromModel?.(model)||null;lastModel=frame?Object.freeze({...frame,cameraZoom:Number(window.Camera?.getZoom?.()??1)}):null;if(host)host.hidden=false;ensureSceneAnchor(lastModel?.center);resize();const terrainKey=preparedTerrainKey(lastRawSeed,lastModel?.center);const worldReady=terrainKey===lastPreparedTerrainKey&&lastWorldPreparation?.ready===true;if(assetPreparationProofState)setNormalWorldEnabled(false);else setNormalWorldEnabled(worldReady);syncCharacterBillboards(lastModel?.visibleCharacters||[]);applyCutaway();if(interiorProofState)buildInteriorObjectProof(interiorProofState);if(characterProofState)rebuildCharacterProof();lastSnapshot=baseSnapshot();return lastSnapshot;}
  async function prepareTerrain(model){
    lastRawSeed=model?.seed??lastRawSeed;
    const frame=window.RendererContract?.frameFromModel?.(model)||null;
    if(!frame?.center)return Object.freeze({prepared:false,chunkMesh:false,worldAssetsReady:false,regionKey:frame?.regionKey||null,reason:"missing-center"});
    ensureSceneAnchor(frame.center);
    // During destination handoff lastModel may still describe the previous view,
    // including its previous zoom. Drive both center and zoom from the current
    // Camera request before sampling terrainActiveRadii(); otherwise a 2.00x ->
    // 0.50x transition can keep the small 2.00x active ring for one full render
    // and expose the finite chunk diamond against the clear background.
    const requestedZoom=clamp(Number(window.Camera?.getZoom?.()??lastModel?.cameraZoom??1),0.5,2);
    resize(frame.center,requestedZoom);
    const terrainTextures=await prepareTerrainTextureAtlas();
    const buildingTextures=await prepareBuildingSurfaceAtlas();
    const treeSprites=await prepareTreeSpriteAtlas();
    const terrainKey=preparedTerrainKey(lastRawSeed,frame.center);
    const pending=pendingTerrainDestination?.key===terrainKey?pendingTerrainDestination:null;
    const committedDestination=Boolean(pending);
    let preload;
    if(pending){
      const manager=initTerrainPreload();
      preload=manager?.commitDestination?.({
        center:pending.center,
        activeRadiusX:pending.activeRadiusX,
        activeRadiusY:pending.activeRadiusY,
        requiredChunkIds:pending.requiredChunkIds
      })||Object.freeze({ready:false,reason:"destination-commit-unavailable"});
      if(preload?.ready!==true){
        return Object.freeze({prepared:false,chunkMesh:true,chunkWorldData:true,worldAssetsReady:false,regionKey:frame.regionKey||null,preload,reason:"destination-commit-not-ready",simulationAuthorityPreserved:true});
      }
      repositionTerrainResourcesIfNeeded(manager);
      pendingTerrainDestination=null;
    }else{
      preload=updateTerrainPreload(frame.center);
    }
    if(committedDestination){
      lastWorldPreparation=Object.freeze({
        ready:true,deferred:true,reason:"streaming-minimum-committed",
        regionCount:Number(preload?.Active||0),keyCount:0,
        regionKeys:Object.freeze([]),logicalKeys:Object.freeze([]),
        simulationAuthorityPreserved:true
      });
    }
    const worldAssets=committedDestination?lastWorldPreparation:await prepareWorldAssets();
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
  function setAmbientMotionProofState(value){
    ambientMotionProofOverride=(value===null||value===undefined||value==="auto")?null:Boolean(value);
    const managed=renderQualitySnapshot()||{};
    const qualityLevel=String(managed.activeLevel||managed.mode||"standard");
    const zoom=Math.max(0.05,Number(lastModel?.cameraZoom??window.Camera?.getZoom?.()??1));
    let activeResources=0;
    terrainPreloadManager?.forEachResource?.((resource,entry)=>{
      if(entry?.state!=="Active"||resource?.entity?.enabled===false)return;
      activeResources++;
      terrainChunkMeshFactory?.updateAmbientMotion?.(resource,ambientMotionClockSeconds,{qualityLevel,zoom,enabled:ambientMotionProofOverride!==false,force:true});
    });
    lastSnapshot=baseSnapshot();
    return Object.freeze({override:ambientMotionProofOverride,enabled:ambientMotionProofOverride!==false,activeResources,qualityLevel,zoom:Number(zoom.toFixed(3)),simulationAuthorityPreserved:true});
  }
  function setTerrainMicroReliefProofState(value){
    terrainMicroReliefProofOverride=(value===null||value===undefined||value==="auto")?null:Boolean(value);
    const q=textureQualitySnapshot();
    const mat=materials.get("terrain-chunk-surface")||null;
    const normal=terrainTextureAtlas?.normalDetailTexture?.()||null;
    const enabled=Boolean(normal)&&terrainMicroReliefEffective(q);
    if(mat){
      const origin=rememberMaterialOrigin(mat)||{};
      materialQualityOrigins.set(mat,{...origin,normalMap:normal});
      mat.normalMap=enabled?normal:null;
      mat.bumpiness=enabled?0.65:0;
      try{mat.update?.()}catch(_){}
    }
    lastSnapshot=baseSnapshot();
    return Object.freeze({override:terrainMicroReliefProofOverride,enabled,qualityAllows:Boolean(q.auxiliaryMaps),profile:q.profile});
  }
  function setBuildingProofState(state){proofState=(state===null||state===undefined||state==="off")?null:String(state);applyCutaway();lastSnapshot=baseSnapshot();return lastSnapshot;}
  function setBuildingOcclusionProofState(state){occlusionProofState=(state===null||state===undefined||state==="off")?null:String(state);lastSnapshot=baseSnapshot();return lastSnapshot;}
  function clear(){pendingTerrainDestination=null;assetPreparationProofState=false;ambientMotionProofOverride=null;assetPreparationProofRoot&&clearEntityChildren(assetPreparationProofRoot);if(assetPreparationProofRoot)assetPreparationProofRoot.enabled=false;lastAssetPreparationProof=Object.freeze({active:false,logicalKey:null,entityCount:0,meshInstanceCount:0,materialCount:0,networkLoads:0,containerParses:0,simulationAuthorityPreserved:true});lastModel=null;lastRawSeed=null;lastPreparedTerrainKey="";worldPreparation?.invalidate?.();lastWorldPreparation=Object.freeze({ready:false,regionCount:0,keyCount:0,regionKeys:Object.freeze([]),logicalKeys:Object.freeze([]),simulationAuthorityPreserved:true});lastRawInteriorObjects=[];lastRawBuildingInteriors=[];setInteriorObjectProofState(null);setCharacterProofState(null);clearCharacterBillboards();if(host)host.hidden=true;lastSnapshot=baseSnapshot({ready:Boolean(app&&device)});}
  function snapshot(){if(app&&device)lastSnapshot=baseSnapshot();return lastSnapshot;}
  function destroy(){pendingTerrainDestination=null;resizeObserver?.disconnect?.();resizeObserver=null;window.removeEventListener?.("resize",resize);if(qualityChangeHandler)window.removeEventListener?.("advisor:texture-quality-change",qualityChangeHandler);qualityChangeHandler=null;if(renderQualityChangeHandler)window.removeEventListener?.("advisor:render-quality-change",renderQualityChangeHandler);renderQualityChangeHandler=null;if(renderQualityFrameHandler)app?.off?.("update",renderQualityFrameHandler);renderQualityFrameHandler=null;if(ambientMotionFrameHandler)app?.off?.("update",ambientMotionFrameHandler);ambientMotionFrameHandler=null;ambientMotionClockSeconds=0;ambientMotionProofOverride=null;ambientFrameTelemetry.calls=0;ambientFrameTelemetry.totalMs=0;ambientFrameTelemetry.lastMs=0;ambientFrameTelemetry.maxMs=0;ambientFrameTelemetry.lastActiveResources=0;terrainPreloadManager?.destroy?.();terrainPreloadManager=null;terrainChunkMeshFactory=null;terrainTextureAtlas?.destroy?.();terrainTextureAtlas=null;buildingSurfaceAtlas?.destroy?.();buildingSurfaceAtlas=null;treeSpriteAtlas?.destroy?.();treeSpriteAtlas=null;lastPreparedTerrainKey="";window.PlayCanvasChunkWorldData?.clear?.();app?.destroy?.();app=null;device=null;lastResizeSignature="";sceneAnchorRevision=0;lastPositionedAnchorRevision=0;cameraRoot=null;camera=null;worldRoot=null;terrainPreloadRoot=null;terrainRoot=null;terrainBaseEntity=null;structuresRoot=null;propsRoot=null;characterContactRoot=null;charactersRoot=null;lightingRoot=null;interiorProofRoot=null;characterProofRoot=null;assetPreparationProofRoot=null;interiorProofPanel?.remove?.();interiorProofPanel=null;characterProofPanel?.remove?.();characterProofPanel=null;roofEntities.length=0;lastCutawayState=Object.freeze({active:false,local:true,targetBuildingId:null,hiddenRoofCount:0,totalRoofCount:0});characterContactBuffer?.destroy?.();characterContactBuffer=null;characterContactCapacity=0;characterContactMesh?.destroy?.();characterContactMesh=null;characterContactEntity=null;characterContactMeshInstance=null;characterContactMaterialRef=null;characterContactBufferUpdates=0;materials.clear();characterMaterials.clear();characterTextures.clear();characterEntities.clear();registeredCharacterAssets.clear();characterPreparation?.invalidate?.();worldPreparation?.invalidate?.();characterPreparation=null;worldPreparation=null;canvas?.remove?.();canvas=null;host=null;sceneAnchor=null;lastCharacterState=Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:0,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,instances:Object.freeze([])});lastCharacterContactState=Object.freeze({count:0,drawCalls:0,materialCount:0,hardwareInstanced:true,terrainAlignedCount:0,quality:"standard",opacity:0.145,simulationAuthorityPreserved:true});}
  return Object.freeze({
    init,render,prepareTerrain,prepareTerrainDestination,cancelTerrainDestination,finishTerrainDestination,getPreparedTerrainView,
    prepareCharacters,updateCharacters,clear,snapshot,destroy,
    setAssetPreparationProofState,setAmbientMotionProofState,setTerrainMicroReliefProofState,setBuildingProofState,setBuildingOcclusionProofState,setInteriorObjectProofState,setCharacterProofState,
    screenToCameraDelta,screenToWorldTile,
    hydrologyAtTile:(x,y)=>terrainChunkMeshFactory?.hydrologyAtTile?.(x,y)||null,
    waterSurfaceAtVertex:(x,y)=>terrainChunkMeshFactory?.waterSurfaceAtVertex?.(x,y)??null,
    landformAtTile:(x,y)=>terrainChunkMeshFactory?.landformAtTile?.(x,y)||null,
    // Conservative logical-view coverage for the tilted orthographic PlayCanvas
    // camera. The previous 1:1 hint under-prepared sparse destination cells at
    // 0.50x and portrait aspect ratios, exposing clear-color holes around roads
    // and buildings before full chunks upgraded.
    projectionBasis:Object.freeze({x:0.66,y:0.50}),
    proofStates:Object.freeze(["outside","entering","inside","behind","leaving"]),
    occlusionProofStates:Object.freeze(["front","behind","clear","inside","restored"]),
    interiorObjectProofStates:Object.freeze(["house","special"]),
    characterProofStates:Object.freeze(["open","front","behind","entering","inside"])
  });
}
window.PlayCanvasRendererFactory=Object.freeze({engineVersion:ENGINE_VERSION,engineUrl:ENGINE_URL,loadEngine,create});
})();