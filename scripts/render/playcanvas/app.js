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
  let cameraRoot=null,camera=null,worldRoot=null,terrainPreloadRoot=null,terrainRoot=null,terrainBaseEntity=null,structuresRoot=null,propsRoot=null,charactersRoot=null,lightingRoot=null,interiorProofRoot=null,characterProofRoot=null;
  let characterPreparation=null,worldPreparation=null,terrainPreloadManager=null,terrainChunkMeshFactory=null,lastPreparedTerrainKey="",interiorProofState=null,interiorProofPanel=null,characterProofState=null,characterProofPanel=null,lastRawSeed=null;\n  let lastWorldPreparation=Object.freeze({ready:false,regionCount:0,keyCount:0,regionKeys:Object.freeze([]),logicalKeys:Object.freeze([]),simulationAuthorityPreserved:true});
  let lastRawInteriorObjects=[],lastRawBuildingInteriors=[];
  let lastInteriorObjectPresentation=Object.freeze({active:false,state:null,buildingId:null,buildingLabel:null,buildingSource:null,objectCount:0,interactionCount:0,reachableInteractionCount:0,blockingObjectCount:0,objects:Object.freeze([])});
  let lastCharacterProof=Object.freeze({active:false,state:null,protagonistId:null,world:null,scene:null,feetY:null,height:null,yawDegrees:null,occlusionExpected:null,cutawayActive:false});
  const materials=new Map(),roofEntities=[],characterMaterials=new Map(),characterTextures=new Map(),characterEntities=new Map(),registeredCharacterAssets=new Set();
  let lastCharacterState=Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:0,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,instances:Object.freeze([])});
  let lastSnapshot=Object.freeze({ready:false,engine:"PlayCanvas",engineVersion:ENGINE_VERSION,backend:"not-initialized",gpu:false,webgl:false,webgpu:false,canvasCount:0,migrationFoundation:true,sceneBaseline:false});

  function requestedDeviceTypes(){if(preference==="webgpu")return [pc.DEVICETYPE_WEBGPU,pc.DEVICETYPE_WEBGL2];if(preference==="auto"&&navigator.gpu)return [pc.DEVICETYPE_WEBGPU,pc.DEVICETYPE_WEBGL2];return [pc.DEVICETYPE_WEBGL2];}
  function deviceClass(){const width=Math.max(1,Number(window.innerWidth||host?.clientWidth||1)),height=Math.max(1,Number(window.innerHeight||host?.clientHeight||1)),shortSide=Math.min(width,height),longSide=Math.max(width,height),coarse=Boolean(window.matchMedia?.("(pointer:coarse)")?.matches);if(shortSide<=520||(longSide<=900&&shortSide<=520))return "phone";if(shortSide<=900||coarse)return "tablet";return "desktop";}
  function resolveQuality(width,height){const cls=deviceClass(),defaults=cls==="phone"?{maxPixelRatio:1.0,renderScale:0.85}:cls==="tablet"?{maxPixelRatio:1.25,renderScale:0.90}:{maxPixelRatio:1.5,renderScale:1.0};const dpr=clamp(maxPixelRatioOverride??defaults.maxPixelRatio,0.75,2),scale=clamp(renderScaleOverride??defaults.renderScale,0.6,1),browserDpr=Math.max(1,Number(window.devicePixelRatio||1)),effectivePixelRatio=Math.max(0.5,Math.min(browserDpr,dpr)*scale);return Object.freeze({deviceClass:cls,browserDevicePixelRatio:browserDpr,maxPixelRatio:dpr,renderScale:scale,effectivePixelRatio});}
  function material(name,r,g,b){if(materials.has(name))return materials.get(name);const m=new pc.StandardMaterial();m.name=name;m.diffuse.set(r,g,b);m.gloss=0.18;m.metalness=0;m.update();materials.set(name,m);return m;}
  function primitive(parent,name,type,position,scale,mat,euler=null){const entity=new pc.Entity(name);entity.addComponent("render",{type,material:mat});entity.setLocalPosition(...position);entity.setLocalScale(...scale);if(euler)entity.setLocalEulerAngles(...euler);parent.addChild(entity);return entity;}
  function makeTree(x,z,index){const trunk=primitive(propsRoot,"TreeTrunk_"+index,"cylinder",[x,1,z],[0.42,2,0.42],material("tree-trunk",0.30,0.20,0.12));primitive(propsRoot,"TreeCanopy_"+index,"sphere",[x,2.55,z],[1.55,1.45,1.55],material("tree-canopy",0.22,0.39,0.18));return trunk;}
  function makeHouse(x,z,index,wallColor){
    const wall=material("house-wall-"+index,...wallColor),roof=material("house-roof",0.34,0.16,0.12);
    primitive(structuresRoot,"HouseWall_"+index,"box",[x,1,z],[3.4,2,2.7],wall);
    /* Two shallow pitched planes replace the old rectangular roof slab.  They are
       independent entities so deterministic interior proof/cutaway can hide them. */
    roofEntities.push(primitive(structuresRoot,"HouseRoofL_"+index,"box",[x-0.82,2.48,z],[2.05,0.18,3.18],roof,[0,0,-27]));
    roofEntities.push(primitive(structuresRoot,"HouseRoofR_"+index,"box",[x+0.82,2.48,z],[2.05,0.18,3.18],roof,[0,0,27]));
    primitive(structuresRoot,"HouseDoor_"+index,"box",[x,0.72,z-1.39],[0.65,1.35,0.10],material("house-door",0.18,0.10,0.06));
  }
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
  function setNormalWorldEnabled(enabled){
    if(terrainPreloadRoot)terrainPreloadRoot.enabled=enabled;
    if(terrainRoot)terrainRoot.enabled=enabled;
    if(structuresRoot)structuresRoot.enabled=enabled;
    if(propsRoot)propsRoot.enabled=enabled;
    if(charactersRoot)charactersRoot.enabled=enabled;
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
  function applyCutaway(){const hidden=proofState==="inside"||proofState==="entering";for(const roof of roofEntities)roof.enabled=!hidden;}
  function buildScene(){
    cameraRoot=new pc.Entity("CameraRoot");camera=new pc.Entity("OrthographicGameplayCamera");camera.addComponent("camera",{clearColor:new pc.Color(0.125,0.155,0.12),projection:pc.PROJECTION_ORTHOGRAPHIC,orthoHeight:BASE_ORTHO_HEIGHT,nearClip:0.1,farClip:200});cameraRoot.addChild(camera);app.root.addChild(cameraRoot);
    worldRoot=new pc.Entity("WorldRoot");terrainPreloadRoot=new pc.Entity("TerrainPreloadRoot");terrainRoot=new pc.Entity("TerrainRoot");structuresRoot=new pc.Entity("StructuresRoot");propsRoot=new pc.Entity("PropsRoot");charactersRoot=new pc.Entity("CharacterBillboardsRoot");interiorProofRoot=new pc.Entity("InteriorObjectProofRoot");characterProofRoot=new pc.Entity("CharacterProofGeometryRoot");lightingRoot=new pc.Entity("LightingRoot");interiorProofRoot.enabled=false;characterProofRoot.enabled=false;worldRoot.addChild(terrainPreloadRoot);worldRoot.addChild(terrainRoot);worldRoot.addChild(structuresRoot);worldRoot.addChild(propsRoot);worldRoot.addChild(charactersRoot);worldRoot.addChild(interiorProofRoot);worldRoot.addChild(characterProofRoot);app.root.addChild(worldRoot);app.root.addChild(lightingRoot);
    terrainBaseEntity=primitive(terrainRoot,"TerrainBase","box",[0,-0.22,0],[30,0.35,24],material("terrain-grass",0.30,0.43,0.22));terrainBaseEntity.enabled=false;primitive(terrainRoot,"RoadEastWest","box",[0,0.015,0],[30,0.08,2.2],material("road-earth",0.48,0.39,0.26));primitive(terrainRoot,"RoadNorthSouth","box",[0,0.02,0],[2.2,0.09,24],material("road-earth",0.48,0.39,0.26));primitive(terrainRoot,"WaterEdge","box",[0,-0.04,9.4],[30,0.10,5.2],material("water",0.20,0.40,0.48));primitive(terrainRoot,"Bridge","box",[0,0.12,8],[2.6,0.22,3.1],material("bridge",0.39,0.29,0.18));
    makeHouse(-5,-4,1,[0.58,0.48,0.32]);makeHouse(5,-3,2,[0.49,0.43,0.31]);makeHouse(-5,4,3,[0.54,0.45,0.29]);makeHouse(5,4,4,[0.52,0.40,0.27]);[[-9,-6],[-9,3],[9,-6],[9,2],[-11,7],[11,7]].forEach(([x,z],i)=>makeTree(x,z,i+1));
    primitive(propsRoot,"VillageStone","sphere",[3,0.55,-7],[1.1,0.75,0.9],material("stone",0.38,0.40,0.37));primitive(propsRoot,"VillageMarker","cylinder",[-2,0.75,-7],[0.55,1.5,0.55],material("marker",0.60,0.50,0.28));
    const sun=new pc.Entity("SunLight");sun.addComponent("light",{type:"directional",intensity:1.25,color:new pc.Color(1,0.95,0.82),castShadows:false});sun.setLocalEulerAngles(48,32,0);lightingRoot.addChild(sun);const fill=new pc.Entity("FillLight");fill.addComponent("light",{type:"directional",intensity:0.30,color:new pc.Color(0.62,0.72,0.88),castShadows:false});fill.setLocalEulerAngles(55,210,0);lightingRoot.addChild(fill);app.scene.ambientLight=new pc.Color(0.30,0.33,0.29);updateCameraTransform();
  }
  function entityCount(entity){if(!entity)return 0;let count=1;for(const child of entity.children||[])count+=entityCount(child);return count;}
  function safeDeltaTiles(value,anchor){try{const delta=BigInt(String(value))-BigInt(String(anchor)),limit=BigInt(REBASE_DISTANCE_TILES);if(delta>limit||delta<-limit)return null;return Number(delta);}catch(_){return 0;}}
  function ensureSceneAnchor(center){if(!center)return;if(!sceneAnchor){sceneAnchor=Object.freeze({x:String(center.x),y:String(center.y)});return;}const dx=safeDeltaTiles(center.x,sceneAnchor.x),dy=safeDeltaTiles(center.y,sceneAnchor.y);if(dx===null||dy===null)sceneAnchor=Object.freeze({x:String(center.x),y:String(center.y)});}
  function terrainChunkSize(){
    const configured=Number(window.TerrainChunkSizeSettings?.get?.()?.chunkSize||16);
    return [8,16,32,64].includes(configured)?configured:16;
  }
  function terrainTextureProfile(){
    return String(window.TextureQualitySettings?.get?.()?.profile||quality?.deviceClass||"standard");
  }
  function terrainChunkSignature(){
    return "quality="+terrainTextureProfile()+"|scale="+Number(quality?.renderScale||1).toFixed(2);
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
  }
  function initTerrainChunkMeshFactory(){
    if(terrainChunkMeshFactory)return terrainChunkMeshFactory;
    if(!window.PlayCanvasTerrainChunkMesh)return null;
    terrainChunkMeshFactory=window.PlayCanvasTerrainChunkMesh.create({
      pc,
      device,
      parent:terrainPreloadRoot,
      material:material("terrain-grass",0.30,0.43,0.22),
      seedProvider:()=>lastRawSeed||""
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
    const resource=factory.build({...spec,worldData});
    resource.worldData=worldData;
    resource.worldDataKey=worldData?.key||resource.worldDataKey||null;
    positionTerrainChunk(resource);
    resource.entity.enabled=false;
    return resource;
  }
  function activateTerrainChunk(resource){
    if(resource?.worldDataKey)window.PlayCanvasChunkWorldData?.touch?.(resource.worldDataKey);
    positionTerrainChunk(resource);
    if(resource?.entity)resource.entity.enabled=true;
  }
  function deactivateTerrainChunk(resource){positionTerrainChunk(resource);if(resource?.entity)resource.entity.enabled=false;}
  function destroyTerrainChunk(resource){
    if(resource?.worldDataKey)window.PlayCanvasChunkWorldData?.release?.(resource.worldDataKey);
    if(terrainChunkMeshFactory)terrainChunkMeshFactory.destroy(resource);
    else resource?.entity?.destroy?.();
  }
  function terrainMeshMetrics(){
    let meshResourceCount=0,activeMeshCount=0,preparedMeshCount=0,cachedMeshCount=0;
    let meshInstanceCount=0,vertices=0,triangles=0;
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
      const name=resource.meshInstance?.material?.name;
      if(name)materialNames.add(name);
    });
    return Object.freeze({
      resourceKind:"chunk-mesh",
      meshResourceCount,activeMeshCount,preparedMeshCount,cachedMeshCount,
      meshInstanceCount,vertices,triangles,
      materialCount:materialNames.size,
      generator:terrainChunkMeshFactory?.stats?.()||null,
      worldData:window.PlayCanvasChunkWorldData?.stats?.()||null,
      oneEntityPerTile:false,
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
    manager.setChunkSize(terrainChunkSize());
    const radii=terrainActiveRadii();
    const result=manager.update({center,activeRadiusX:radii.x,activeRadiusY:radii.y});
    manager.forEachResource(positionTerrainChunk);
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
  function characterScenePoint(point){
    const dx=safeDeltaTiles(point?.x,sceneAnchor?.x??point?.x)??0,dy=safeDeltaTiles(point?.y,sceneAnchor?.y??point?.y)??0;
    return Object.freeze({x:dx*WORLD_TILE_METERS,z:dy*WORLD_TILE_METERS});
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
    const cameraPosition=camera?.getPosition?.()||new pc.Vec3(13.5,15.5,13.5);
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
      const height=Math.max(0.8,Number(raw.height||WORLD_TILE_METERS*CHARACTER_HEIGHT_SCALE));
      const width=Math.max(height*aspect,height*0.46);
      let record=characterEntities.get(id);
      if(!record||record.url!==url){
        record?.entity?.destroy?.();
        const entity=new pc.Entity("CharacterBillboard_"+id);
        entity.addComponent("render",{type:"plane",material:characterMaterial(url,texture),castShadows:false,receiveShadows:false});
        charactersRoot.addChild(entity);
        record=Object.freeze({entity,url});
        characterEntities.set(id,record);
      }
      const scenePoint=characterScenePoint(point);
      const entity=record.entity;
      const flipped=Boolean(raw.flipX);
      const elevation=Math.max(0,Number(raw.elevation??CHARACTER_DEFAULT_ELEVATION));
      const yaw=billboardYawDegrees(scenePoint,cameraPosition);
      entity.enabled=true;
      /* PlayCanvas primitive planes are local XZ surfaces. Their visual width
         therefore scales on X and image height scales on Z. Aim local -Z at
         the camera, then rotate locally so the plane's Z axis becomes world-up. */
      entity.setLocalPosition(scenePoint.x,elevation+height*0.5+CHARACTER_GROUND_LIFT,scenePoint.z);
      entity.setLocalScale((flipped?-1:1)*width,1,height);
      entity.lookAt(cameraPosition.x,entity.getPosition().y,cameraPosition.z);
      entity.rotateLocal(-90,0,0);
      desired.set(id,record);
      visibleIds.push(id);
      instances.push(Object.freeze({
        id,
        role:String(raw.role||"resident"),
        world:Object.freeze({x:String(point.x),y:String(point.y)}),
        scene:Object.freeze({x:scenePoint.x,z:scenePoint.z}),
        feetY:elevation+CHARACTER_GROUND_LIFT,
        centerY:elevation+height*0.5+CHARACTER_GROUND_LIFT,
        height,
        width,
        yawDegrees:yaw,
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
  function updateCameraTransform(){if(!camera)return;if(interiorProofState){const building=selectInteriorProofBuilding(interiorProofState),bounds=proofBounds(building);if(bounds)updateInteriorProofCamera(bounds);return;}const center=lastModel?.center||window.Camera?.getCenter?.()||{x:"0",y:"0"};ensureSceneAnchor(center);const dx=safeDeltaTiles(center.x,sceneAnchor?.x??center.x)??0,dy=safeDeltaTiles(center.y,sceneAnchor?.y??center.y)??0,targetX=dx*WORLD_TILE_METERS,targetZ=dy*WORLD_TILE_METERS,zoom=clamp(Number(lastModel?.cameraZoom??window.Camera?.getZoom?.()??1),0.5,2),width=Math.max(1,host?.clientWidth||1),height=Math.max(1,host?.clientHeight||1),aspect=width/height,baseFrameHeight=aspect>3&&height<220?SHORT_LANDSCAPE_ORTHO_HEIGHT:aspect<0.8?PORTRAIT_ORTHO_HEIGHT:aspect>2.2?WIDE_ORTHO_HEIGHT:BASE_ORTHO_HEIGHT;camera.camera.orthoHeight=baseFrameHeight/zoom;camera.setPosition(targetX+13.5,15.5,targetZ+13.5);camera.lookAt(targetX,0,targetZ);}
  function resize(){if(!app||!host||!device)return;const width=Math.max(1,Math.round(host.clientWidth||1)),height=Math.max(1,Math.round(host.clientHeight||1));quality=resolveQuality(width,height);device.maxPixelRatio=quality.effectivePixelRatio;app.setCanvasFillMode(pc.FILLMODE_NONE,width,height);app.setCanvasResolution(pc.RESOLUTION_AUTO);app.resizeCanvas(width,height);app.updateCanvasSize?.();updateCameraTransform();}
  function frameStats(){const stats=app?.stats||{};return Object.freeze({frameMs:Number(stats.frame?.ms||0),renderMs:Number(stats.frame?.renderTime||0),drawCalls:Number(stats.drawCalls?.total||device?._drawCallsPerFrame||0),triangles:Number(stats.frame?.triangles||device?._primitiveCount||0)});}
  function sceneInfo(){return Object.freeze({projection:camera?.camera?.projection===pc?.PROJECTION_ORTHOGRAPHIC?"orthographic":"unknown",orthoHeight:Number(camera?.camera?.orthoHeight||0),baseOrthoHeight:BASE_ORTHO_HEIGHT,wideOrthoHeight:WIDE_ORTHO_HEIGHT,portraitOrthoHeight:PORTRAIT_ORTHO_HEIGHT,shortLandscapeOrthoHeight:SHORT_LANDSCAPE_ORTHO_HEIGHT,worldTileMeters:WORLD_TILE_METERS,anchor:sceneAnchor,roots:Object.freeze(["TerrainRoot","StructuresRoot","PropsRoot","CharacterBillboardsRoot","LightingRoot"]),entityCount:entityCount(app?.root),terrainEntityCount:entityCount(terrainRoot),structureEntityCount:entityCount(structuresRoot),propEntityCount:entityCount(propsRoot),characterEntityCount:entityCount(charactersRoot),characterBillboardCount:Number(characterEntities.size||0),lightingEntityCount:entityCount(lightingRoot),roofStyle:"pitched-two-plane",roofEntityCount:roofEntities.length,cutawayActive:proofState==="inside"||proofState==="entering"});}
  function canvasInfo(){return Object.freeze({cssWidth:Math.max(0,Math.round(host?.clientWidth||0)),cssHeight:Math.max(0,Math.round(host?.clientHeight||0)),backingWidth:Number(canvas?.width||0),backingHeight:Number(canvas?.height||0)});}
  function baseSnapshot(extra={}){const deviceType=device?.deviceType||"unknown",current=window.RendererContract?.simulationSnapshot?.()||null;return Object.freeze({ready:Boolean(app&&device),engine:"PlayCanvas",engineVersion:ENGINE_VERSION,rendererContractVersion:window.RendererContract?.version||null,backend:deviceType,requestedBackend:preference,gpu:Boolean(device),webgl:deviceType==="webgl2",webgpu:deviceType==="webgpu",webgpuAvailable:Boolean(navigator.gpu),migrationFoundation:true,sceneBaseline:Boolean(camera&&worldRoot),canvasCount:host?host.querySelectorAll("canvas").length:0,canvas:canvasInfo(),quality:quality||Object.freeze({deviceClass:"unknown",browserDevicePixelRatio:Number(window.devicePixelRatio||1),maxPixelRatio:1,renderScale:1,effectivePixelRatio:1}),scene:sceneInfo(),performance:frameStats(),domTerrainTileCount:document.querySelectorAll(".terrain-tile").length,logicalTextureKeyPass:true,simulationAuthorityPreserved:beforeInit&&afterInit?window.RendererContract.sameSimulation(beforeInit,afterInit):true,simulationSnapshot:current,frame:lastModel,regionKey:lastModel?.regionKey||null,tileCount:lastModel?.tileCount||0,protagonistVisible:Boolean(lastCharacterState.visibleProtagonist),characterPresentation:Object.freeze({activeCharacterCount:Number(lastCharacterState.activeCharacterCount||0),simulatedCharacterCount:Number(lastCharacterState.simulatedCharacterCount||0),preparedCharacterCount:Number(lastCharacterState.preparedCharacterCount||0),visibleCharacterIds:lastCharacterState.visibleCharacterIds,visibleProtagonist:Boolean(lastCharacterState.visibleProtagonist),suppressedCharacterCount:Number(lastCharacterState.suppressedCharacterCount||0),suppressedCharacterIds:lastCharacterState.suppressedCharacterIds||Object.freeze([]),instances:lastCharacterState.instances||Object.freeze([]),feetAnchored:true,billboardMode:"vertical-yaw",depthTest:true,depthWrite:true,sharedTextureCount:characterTextures.size,sharedMaterialCount:characterMaterials.size,simulationAuthorityPreserved:true,migrationFoundation:true}),characterProof:lastCharacterProof,buildingPresentation:Object.freeze({layerOrder:Object.freeze(["playcanvas-world"]),proofState,visibleBuildingCount:lastModel?.buildingCount||0,visibleInteriorObjectCount:lastModel?.interiorObjectCount||0,simulationAuthorityPreserved:true,migrationFoundation:true,cutawayActive:proofState==="inside"||proofState==="entering"}),buildingOcclusion:Object.freeze({proofState:occlusionProofState,simulationAuthorityPreserved:true,migrationFoundation:true}),interiorObjectPresentation:lastInteriorObjectPresentation,worldAssetPreparation:lastWorldPreparation,worldAssetCache:worldPreparation?.stats?.()||null,worldAssetProof:worldPreparation?.proof?.()||null,characterAssetPreparation:characterPreparation?.stats?.()||null,terrainPreload:terrainPreloadManager?.stats?.()||Object.freeze({settings:window.TerrainChunkPreloadSettings?.get?.()||null,Active:0,Prepared:0,Cached:0,queueDepth:0,hits:0,misses:0,compositions:0,evictions:0,visibleWaits:0,bounded:true,simulationAuthorityPreserved:true}),terrainChunks:Object.freeze({migrationFoundation:true,visibleChunkCount:Number(terrainPreloadManager?.stats?.().Active||0),preparedChunkCount:Number(terrainPreloadManager?.stats?.().Prepared||0),cachedChunkCount:Number(terrainPreloadManager?.stats?.().Cached||0),hits:Number(terrainPreloadManager?.stats?.().hits||0),misses:Number(terrainPreloadManager?.stats?.().misses||0),compositions:Number(terrainPreloadManager?.stats?.().compositions||0),chunkSize:Number(terrainPreloadManager?.stats?.().chunkSize||terrainChunkSize()),signature:String(terrainPreloadManager?.stats?.().signature||""),invalidations:Number(terrainPreloadManager?.stats?.().invalidations||0),lastInvalidationReason:terrainPreloadManager?.stats?.().lastInvalidationReason||null,createdSprites:0,reusedSprites:Number(terrainPreloadManager?.stats?.().hits||0),removedSprites:0,evictions:Number(terrainPreloadManager?.stats?.().evictions||0),visibleWaitedForComposition:Number(terrainPreloadManager?.stats?.().visibleWaits||0)>0,...terrainMeshMetrics()}),...extra});}
  async function init(target){if(app)return snapshot();if(!target)throw new Error("PlayCanvas renderer requires a gameplay host");host=target;beforeInit=window.RendererContract?.simulationSnapshot?.()||null;pc=await loadEngine();canvas=document.createElement("canvas");canvas.id="gameCanvas";canvas.className="game-canvas";canvas.setAttribute("aria-label","PlayCanvas orthographic 3D gameplay world");canvas.dataset.renderer="playcanvas";host.replaceChildren(canvas);device=await pc.createGraphicsDevice(canvas,{deviceTypes:requestedDeviceTypes(),antialias:false,depth:true,powerPreference:"high-performance"});const options=new pc.AppOptions();options.graphicsDevice=device;options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];options.resourceHandlers=[pc.TextureHandler,pc.ContainerHandler];app=new pc.AppBase(canvas);app.init(options);characterPreparation=window.PlayCanvasAssetPreparation?.create({app,pc,cacheLimit:64})||null;worldPreparation=window.PlayCanvasAssetPreparation?.create({app,pc,cacheLimit:96})||null;if(!worldPreparation||!window.PlayCanvasWorldAssets?.registerBaseline?.(worldPreparation))throw new Error("PlayCanvas world asset catalog registration failed");buildScene();setNormalWorldEnabled(false);resize();initTerrainPreload();app.start();if("ResizeObserver" in window){resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);}else window.addEventListener("resize",resize);afterInit=window.RendererContract?.simulationSnapshot?.()||null;if(beforeInit&&afterInit&&!window.RendererContract.sameSimulation(beforeInit,afterInit))throw new Error("PlayCanvas initialization changed authoritative Simulation state");host.hidden=false;lastSnapshot=baseSnapshot({ready:true,canvasCount:host.querySelectorAll("canvas").length});return lastSnapshot;}
  function render(model){lastRawSeed=model?.seed??lastRawSeed;lastRawInteriorObjects=Array.isArray(model?.interiorObjects)?model.interiorObjects:[];lastRawBuildingInteriors=Array.isArray(model?.buildingInteriors)?model.buildingInteriors:[];const frame=window.RendererContract?.frameFromModel?.(model)||null;lastModel=frame?Object.freeze({...frame,cameraZoom:Number(window.Camera?.getZoom?.()??1)}):null;if(host)host.hidden=false;ensureSceneAnchor(lastModel?.center);resize();updateCameraTransform();const terrainKey=preparedTerrainKey(lastRawSeed,lastModel?.center);const worldReady=terrainKey===lastPreparedTerrainKey&&lastWorldPreparation?.ready===true;setNormalWorldEnabled(worldReady);applyCutaway();syncCharacterBillboards(lastModel?.visibleCharacters||[]);if(interiorProofState)buildInteriorObjectProof(interiorProofState);if(characterProofState)rebuildCharacterProof();lastSnapshot=baseSnapshot();return lastSnapshot;}
  async function prepareTerrain(model){
    lastRawSeed=model?.seed??lastRawSeed;
    const frame=window.RendererContract?.frameFromModel?.(model)||null;
    if(!frame?.center)return Object.freeze({prepared:false,chunkMesh:false,worldAssetsReady:false,regionKey:frame?.regionKey||null,reason:"missing-center"});
    ensureSceneAnchor(frame.center);
    resize();
    updateCameraTransform();
    const preload=updateTerrainPreload(frame.center);
    const worldAssets=await prepareWorldAssets();
    if(!worldAssets.ready){
      setNormalWorldEnabled(false);
      return Object.freeze({prepared:false,chunkMesh:true,chunkWorldData:true,worldAssetsReady:false,regionKey:frame.regionKey||null,preload,worldAssets,reason:"world-assets-not-ready",simulationAuthorityPreserved:true});
    }
    setNormalWorldEnabled(true);
    lastPreparedTerrainKey=preparedTerrainKey(lastRawSeed,frame.center);
    return Object.freeze({
      prepared:true,
      chunkMesh:true,
      chunkWorldData:true,
      worldAssetsReady:true,
      regionKey:frame.regionKey||null,
      preload,
      worldAssets,
      mesh:terrainMeshMetrics(),
      worldData:window.PlayCanvasChunkWorldData?.stats?.()||null,
      simulationAuthorityPreserved:true
    });
  }
  function setBuildingProofState(state){proofState=(state===null||state===undefined||state==="off")?null:String(state);applyCutaway();lastSnapshot=baseSnapshot();return lastSnapshot;}
  function setBuildingOcclusionProofState(state){occlusionProofState=(state===null||state===undefined||state==="off")?null:String(state);lastSnapshot=baseSnapshot();return lastSnapshot;}
  function clear(){lastModel=null;lastRawSeed=null;lastPreparedTerrainKey="";worldPreparation?.invalidate?.();lastWorldPreparation=Object.freeze({ready:false,regionCount:0,keyCount:0,regionKeys:Object.freeze([]),logicalKeys:Object.freeze([]),simulationAuthorityPreserved:true});lastRawInteriorObjects=[];lastRawBuildingInteriors=[];setInteriorObjectProofState(null);setCharacterProofState(null);clearCharacterBillboards();if(host)host.hidden=true;lastSnapshot=baseSnapshot({ready:Boolean(app&&device)});}
  function snapshot(){if(app&&device)lastSnapshot=baseSnapshot();return lastSnapshot;}
  function destroy(){resizeObserver?.disconnect?.();resizeObserver=null;window.removeEventListener?.("resize",resize);terrainPreloadManager?.destroy?.();terrainPreloadManager=null;terrainChunkMeshFactory=null;lastPreparedTerrainKey="";window.PlayCanvasChunkWorldData?.clear?.();app?.destroy?.();app=null;device=null;cameraRoot=null;camera=null;worldRoot=null;terrainPreloadRoot=null;terrainRoot=null;terrainBaseEntity=null;structuresRoot=null;propsRoot=null;charactersRoot=null;lightingRoot=null;interiorProofRoot=null;characterProofRoot=null;interiorProofPanel?.remove?.();interiorProofPanel=null;characterProofPanel?.remove?.();characterProofPanel=null;roofEntities.length=0;materials.clear();characterMaterials.clear();characterTextures.clear();characterEntities.clear();registeredCharacterAssets.clear();characterPreparation?.invalidate?.();worldPreparation?.invalidate?.();characterPreparation=null;worldPreparation=null;canvas?.remove?.();canvas=null;host=null;sceneAnchor=null;lastCharacterState=Object.freeze({activeCharacterCount:0,simulatedCharacterCount:0,preparedCharacterCount:0,visibleCharacterIds:Object.freeze([]),visibleProtagonist:false,instances:Object.freeze([])});}
  return Object.freeze({init,render,prepareTerrain,getPreparedTerrainView,prepareCharacters,clear,snapshot,destroy,setBuildingProofState,setBuildingOcclusionProofState,setInteriorObjectProofState,setCharacterProofState,projectionBasis:Object.freeze({x:1,y:1}),proofStates:Object.freeze(["outside","entering","inside","behind","leaving"]),occlusionProofStates:Object.freeze(["front","behind","clear","inside","restored"]),interiorObjectProofStates:Object.freeze(["house","special"]),characterProofStates:Object.freeze(["open","front","behind","entering","inside"])});
}
window.PlayCanvasRendererFactory=Object.freeze({engineVersion:ENGINE_VERSION,engineUrl:ENGINE_URL,loadEngine,create});
})();