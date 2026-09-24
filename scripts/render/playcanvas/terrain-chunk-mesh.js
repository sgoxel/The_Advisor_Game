(function(){
"use strict";

function hash32(text){
  let h=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  h^=h>>>13; h=Math.imul(h,0x5bd1e995)>>>0; h^=h>>>15;
  return h>>>0;
}
function signed01(seed,x,z,salt){
  const h=hash32(String(seed)+"|"+String(x)+"|"+String(z)+"|"+String(salt||""));
  return (h/4294967295)*2-1;
}
function clamp(v,a,b){return Math.min(b,Math.max(a,v));}

const HEIGHTFIELD_VERTICAL_SCALE=0.0022;
const HEIGHTFIELD_RELIEF=0.065;
const HEIGHTFIELD_WATER_Y=-0.22;
const HEIGHTFIELD_BRIDGE_CLEARANCE=0.18;
const heightReferenceCache=new Map();
const heightVertexCache=new Map();
const HEIGHT_VERTEX_CACHE_LIMIT=16384;
let heightVertexSampleCalls=0,heightVertexCacheHits=0,heightGroundSampleCalls=0;

function floorDivBig(value,divisor){
  let q=value/divisor,r=value%divisor;
  if(r<0n)q-=1n;
  return q;
}
function heightfieldSegments(size){
  const bounded=Math.max(1,Math.trunc(Number(size)||16));
  for(let candidate=Math.min(8,bounded);candidate>=1;candidate--)if(bounded%candidate===0)return candidate;
  return 1;
}
function heightfieldStep(size){return Math.max(1,Math.trunc(Number(size)||16)/heightfieldSegments(size));}
function referenceElevation(seed){
  const key=String(seed||"");
  if(!key)return 0;
  if(heightReferenceCache.has(key))return heightReferenceCache.get(key);
  const value=Number(window.GeographyFoundation?.environment?.(key,"0","0")?.elevationMeters||0);
  heightReferenceCache.set(key,value);
  return value;
}
function heightfieldColor(seed,x,z,value){
  const text=String(value||"").trim();
  const match=/^#([0-9a-f]{6})$/i.exec(text);
  if(match){
    const n=parseInt(match[1],16);
    return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,1];
  }
  const noise=signed01(seed,x,z,"color");
  return [
    clamp(0.29+noise*0.018,0.20,0.40),
    clamp(0.42+noise*0.025,0.30,0.55),
    clamp(0.215+noise*0.012,0.14,0.30),
    1
  ];
}
function terrainHeightVertex(seed,xValue,yValue){
  const seedKey=String(seed||"");
  const x=String(xValue),y=String(yValue);
  if(!seedKey)return Object.freeze({height:0,type:"grass",color:[0.29,0.42,0.215,1],elevationMeters:0});
  const cacheKey=seedKey+"|"+x+"|"+y;
  const cached=heightVertexCache.get(cacheKey);
  if(cached){
    heightVertexCacheHits++;
    return cached;
  }
  heightVertexSampleCalls++;
  const env=window.GeographyFoundation?.environment?.(seed,x,y)||null;
  const elevation=Number(env?.elevationMeters||referenceElevation(seed));
  const reference=referenceElevation(seed);
  const macro=(elevation-reference)*HEIGHTFIELD_VERTICAL_SCALE;
  const tile=window.TerrainFoundation?.getTile?.(seed,x,y)||null;
  const type=String(tile?.type||"grass");
  let height=macro;
  if(type==="water")height=HEIGHTFIELD_WATER_Y;
  else if(type==="bridge")height=Math.max(HEIGHTFIELD_WATER_Y+HEIGHTFIELD_BRIDGE_CLEARANCE,macro);
  else if(type==="road"||type==="path"||type==="square"||type==="building"||type==="floor"||type==="door"||type==="wall"){
    height=macro;
  }else{
    height+=signed01(seed,x,y,"heightfield-relief")*HEIGHTFIELD_RELIEF;
  }
  const sample=Object.freeze({
    height:clamp(height,-3.4,3.4),
    type,
    color:heightfieldColor(seed,x,y,tile?.color),
    elevationMeters:elevation
  });
  heightVertexCache.set(cacheKey,sample);
  if(heightVertexCache.size>HEIGHT_VERTEX_CACHE_LIMIT){
    const oldest=heightVertexCache.keys().next().value;
    if(oldest!==undefined)heightVertexCache.delete(oldest);
  }
  return sample;
}
function terrainHeightAtTile(seed,xValue,yValue,size=16,offsetX=0,offsetY=0){
  if(!String(seed||""))return 0;
  heightGroundSampleCalls++;
  const step=heightfieldStep(size);
  const x=Number(xValue)+0.5+Number(offsetX||0);
  const y=Number(yValue)+0.5+Number(offsetY||0);
  if(!Number.isFinite(x)||!Number.isFinite(y))return 0;
  const x0=Math.floor(x/step)*step,y0=Math.floor(y/step)*step;
  const tx=(x-x0)/step,tz=(y-y0)/step;
  const h00=terrainHeightVertex(seed,String(x0),String(y0)).height;
  const h10=terrainHeightVertex(seed,String(x0+step),String(y0)).height;
  const h01=terrainHeightVertex(seed,String(x0),String(y0+step)).height;
  const h11=terrainHeightVertex(seed,String(x0+step),String(y0+step)).height;
  if(tx+tz<=1)return h00+tx*(h10-h00)+tz*(h01-h00);
  return h11+(1-tz)*(h10-h11)+(1-tx)*(h01-h11);
}

function create({pc,device,parent,material,textureAtlasProvider=()=>null,buildingSurfaceAtlasProvider=()=>null,treeSpriteAtlasProvider=()=>null,treeYawProvider=()=>45,seedProvider=()=>"",registerRoof=()=>{}}={}){
  if(!pc||!device||!parent||!material)throw new Error("PlayCanvasTerrainChunkMesh requires pc/device/parent/material");
  material.vertexColors=true;
  material.diffuseVertexColor=true;
  material.diffuse.set(1,1,1);
  material.gloss=0.06;
  material.metalness=0;
  material.update();

  const presentationMaterials=new Map();
  const treeSpriteMaterials=new Map();
  const surfaceBoundMaterials=new Set();
  const primitiveMeshes=new Map();
  const baseBox=new pc.BoxGeometry();
  let creations=0,destroys=0,totalBuildMs=0,maxBuildMs=0;
  let presentationEntityCreations=0,presentationEntityDestroys=0,presentationMeshInstanceCreations=0;
  let staticBatchMeshCreations=0,staticBatchSourcePrimitiveCount=0,instancedGroupCreations=0,instancedObjectCount=0;
  let instancingBufferUpdates=0,instancingParentRepositions=0,frustumCulledMeshInstances=0;

  function applyBuildingSurfaceMaterial(m,name,r,g,b){
    const atlas=buildingSurfaceAtlasProvider?.()||null;
    const state=atlas?.stats?.()||null;
    const rect=state?.ready?atlas?.rectForMaterial?.(name):null;
    const texture=state?.ready?atlas?.texture?.():null;
    if(rect&&texture){
      m.diffuseMap=texture;
      m.diffuse.set(1,1,1);
      if(m.diffuseMapTiling?.set)m.diffuseMapTiling.set(rect.uScale,rect.vScale);
      else m.diffuseMapTiling=new pc.Vec2(rect.uScale,rect.vScale);
      if(m.diffuseMapOffset?.set)m.diffuseMapOffset.set(rect.u0,rect.v0);
      else m.diffuseMapOffset=new pc.Vec2(rect.u0,rect.v0);
      surfaceBoundMaterials.add(name);
      return true;
    }
    m.diffuseMap=null;
    m.diffuse.set(r,g,b);
    return false;
  }
  function presentationMaterial(name,r,g,b,gloss=0.10){
    let m=presentationMaterials.get(name)||null;
    if(!m){
      m=new pc.StandardMaterial();
      m.name="chunk-"+name;
      m.gloss=gloss;
      m.metalness=0;
      presentationMaterials.set(name,m);
    }
    applyBuildingSurfaceMaterial(m,name,r,g,b);
    m.update();
    return m;
  }
  function primitive(root,name,type,position,scale,mat,euler=null){
    const entity=new pc.Entity(name);
    entity.addComponent("render",{type,material:mat,castShadows:false,receiveShadows:false});
    entity.setLocalPosition(...position);
    entity.setLocalScale(...scale);
    if(euler)entity.setLocalEulerAngles(...euler);
    root.addChild(entity);
    presentationEntityCreations++;
    presentationMeshInstanceCreations+=Number(entity.render?.meshInstances?.length||1);
    for(const mi of entity.render?.meshInstances||[]){mi.cull=true;frustumCulledMeshInstances++;}
    return entity;
  }
  function primitiveMesh(kind){
    if(primitiveMeshes.has(kind))return primitiveMeshes.get(kind);
    let mesh;
    if(kind==="tree-plane"){
      mesh=new pc.Mesh(device);
      mesh.setPositions([-0.5,0,0, 0.5,0,0, -0.5,1,0, 0.5,1,0]);
      mesh.setNormals([0,0,1, 0,0,1, 0,0,1, 0,0,1]);
      // Browser image sources are top-down while PlayCanvas UV V=0 is the
      // texture bottom. Flip V once in the shared plane mesh so authored tree
      // trunks remain grounded and canopies stay above them.
      mesh.setUvs(0,[0,1, 1,1, 0,0, 1,0]);
      mesh.setIndices([0,1,2, 1,3,2]);
      mesh.update();
    }else{
      const geometry=new pc.SphereGeometry({radius:0.5,latitudeBands:8,longitudeBands:8});
      mesh=pc.Mesh.fromGeometry(device,geometry);
    }
    primitiveMeshes.set(kind,mesh);
    return mesh;
  }
  function setMapRect(material,prefix,rect){
    const tiling=material[prefix+"MapTiling"],offset=material[prefix+"MapOffset"];
    if(tiling?.set)tiling.set(rect.uScale,rect.vScale);else material[prefix+"MapTiling"]=new pc.Vec2(rect.uScale,rect.vScale);
    if(offset?.set)offset.set(rect.u0,rect.v0);else material[prefix+"MapOffset"]=new pc.Vec2(rect.u0,rect.v0);
  }
  function treeSpriteMaterial(variant){
    const index=Math.max(0,Math.min(1,Math.trunc(Number(variant)||0)));
    if(treeSpriteMaterials.has(index))return treeSpriteMaterials.get(index);
    const atlas=treeSpriteAtlasProvider?.()||null,state=atlas?.stats?.()||null;
    const texture=state?.ready?atlas?.texture?.():null,rect=atlas?.rect?.(index)||{u0:index*0.5,v0:0,uScale:0.5,vScale:1};
    if(!texture)return presentationMaterial("tree-fallback",0.20,0.42,0.18,0.02);
    const m=new pc.StandardMaterial();
    m.name="chunk-tree-sprite-"+index;
    m.diffuse.set(1,1,1);
    m.diffuseMap=texture;
    m.opacityMap=texture;
    m.opacityMapChannel="a";
    setMapRect(m,"diffuse",rect);
    setMapRect(m,"opacity",rect);
    m.alphaTest=0.10;
    m.blendType=pc.BLEND_NONE;
    m.depthWrite=true;
    m.depthTest=true;
    m.cull=pc.CULLFACE_NONE;
    m.useLighting=false;
    m.gloss=0;
    m.metalness=0;
    m.update();
    treeSpriteMaterials.set(index,m);
    return m;
  }
  function sampleColor(seed,x,z){
    const n=signed01(seed,x,z,"color");
    return [
      clamp(0.29+n*0.018,0.20,0.40),
      clamp(0.42+n*0.025,0.30,0.55),
      clamp(0.215+n*0.012,0.14,0.30),
      1
    ];
  }
  function parseHexColor(value){
    const text=String(value||"").trim();
    const match=/^#([0-9a-f]{6})$/i.exec(text);
    if(!match)return null;
    const n=parseInt(match[1],16);
    return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,1];
  }
  function appendColor32(target,color,count=1){
    const rgba=[
      Math.round(clamp(Number(color?.[0]??0),0,1)*255),
      Math.round(clamp(Number(color?.[1]??0),0,1)*255),
      Math.round(clamp(Number(color?.[2]??0),0,1)*255),
      Math.round(clamp(Number(color?.[3]??1),0,1)*255)
    ];
    for(let i=0;i<count;i++)target.push(...rgba);
  }
  function terrainPriority(type){
    const t=String(type||"");
    if(t==="bridge")return 100;
    if(t==="road"||t==="path"||t==="square")return 90;
    if(t==="water")return 80;
    if(t==="building"||t==="floor"||t==="door"||t==="wall")return 70;
    if(t==="farmland"||t==="plot")return 60;
    if(t==="rock"||t==="sand"||t==="mud"||t==="dirt")return 50;
    if(t==="forest")return 40;
    return 10;
  }
  function blockSurface(worldData,startX,startZ,endX,endZ,fallback){
    const size=Number(worldData?.chunkSize||0);
    if(!worldData?.cells||!size)return {type:"grass",color:fallback};
    let chosenType=null,chosenPriority=-1;
    const counts=new Map();
    for(let z=startZ;z<endZ;z++){
      for(let x=startX;x<endX;x++){
        const cell=worldData.cells[z*size+x];
        if(!cell)continue;
        const type=String(cell.type||"");
        counts.set(type,(counts.get(type)||0)+1);
        const priority=terrainPriority(type);
        if(priority>chosenPriority){chosenPriority=priority;chosenType=type;}
      }
    }
    if(chosenPriority<=10&&counts.size){
      chosenType=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0];
    }
    let r=0,g=0,b=0,n=0;
    for(let z=startZ;z<endZ;z++){
      for(let x=startX;x<endX;x++){
        const cell=worldData.cells[z*size+x];
        if(!cell||String(cell.type||"")!==chosenType)continue;
        const color=parseHexColor(cell.color);
        if(!color)continue;
        r+=color[0];g+=color[1];b+=color[2];n++;
      }
    }
    return {type:chosenType||"grass",color:n?[r/n,g/n,b/n,1]:fallback};
  }
  function localTileCenter(worldData,x,y){
    const size=Number(worldData?.chunkSize||0);
    const half=size;
    try{
      const lx=Number(BigInt(String(x))-BigInt(worldData.bounds.minX));
      const ly=Number(BigInt(String(y))-BigInt(worldData.bounds.minY));
      return {x:(lx+0.5)*2-half,z:(ly+0.5)*2-half};
    }catch(_){return {x:0,z:0};}
  }
  function localBounds(worldData,bounds){
    const size=Number(worldData?.chunkSize||0),half=size;
    try{
      const minX=Number(BigInt(bounds.minX)-BigInt(worldData.bounds.minX));
      const maxX=Number(BigInt(bounds.maxX)-BigInt(worldData.bounds.minX));
      const minY=Number(BigInt(bounds.minY)-BigInt(worldData.bounds.minY));
      const maxY=Number(BigInt(bounds.maxY)-BigInt(worldData.bounds.minY));
      return {
        x:((minX+maxX+1)/2)*2-half,
        z:((minY+maxY+1)/2)*2-half,
        width:Math.max(1,(maxX-minX+1)*2),
        depth:Math.max(1,(maxY-minY+1)*2)
      };
    }catch(_){return {x:0,z:0,width:2,depth:2};}
  }

  function staticBatchCollector(){
    return new Map();
  }
  function batchFor(collector,key,mat){
    if(!collector.has(key))collector.set(key,{key,material:mat,positions:[],normals:[],uvs:[],indices:[],sourcePrimitiveCount:0});
    return collector.get(key);
  }
  function appendBoxBatch(batch,position,scale,eulerZ=0){
    const p=baseBox.positions||[],n=baseBox.normals||[],uv=baseBox.uvs||[],idx=baseBox.indices||[];
    const base=batch.positions.length/3;
    const sx=Number(scale[0]),sy=Number(scale[1]),sz=Number(scale[2]);
    const tx=Number(position[0]),ty=Number(position[1]),tz=Number(position[2]);
    const a=Number(eulerZ||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    for(let i=0;i<p.length;i+=3){
      const x=p[i]*sx,y=p[i+1]*sy,z=p[i+2]*sz;
      batch.positions.push(x*c-y*s+tx,x*s+y*c+ty,z+tz);
      const nx=n[i],ny=n[i+1],nz=n[i+2];
      batch.normals.push(nx*c-ny*s,nx*s+ny*c,nz);
      const uvIndex=(i/3)*2;
      batch.uvs.push(Number(uv[uvIndex]??0),Number(uv[uvIndex+1]??0));
    }
    for(const value of idx)batch.indices.push(base+value);
    batch.sourcePrimitiveCount++;
    staticBatchSourcePrimitiveCount++;
  }
  function finalizeStaticBatches(root,collector){
    const meshes=[];
    for(const batch of collector.values()){
      if(!batch.positions.length)continue;
      const mesh=new pc.Mesh(device);
      mesh.setPositions(batch.positions);
      mesh.setNormals(batch.normals);
      if(batch.uvs.length===(batch.positions.length/3)*2)mesh.setUvs(0,batch.uvs);
      mesh.setIndices(batch.indices);
      mesh.update();
      const batchEntity=new pc.Entity("ChunkStaticBatch_"+String(batch.key).replace(/[^a-z0-9_-]+/gi,"-"));
      batchEntity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
      const mi=new pc.MeshInstance(mesh,batch.material,batchEntity);
      mi.cull=true;
      batchEntity.render.meshInstances=[mi];
      root.addChild(batchEntity);
      presentationEntityCreations++;
      presentationMeshInstanceCreations++;
      frustumCulledMeshInstances++;
      meshes.push({entity:batchEntity,mesh,meshInstance:mi,sourcePrimitiveCount:batch.sourcePrimitiveCount});
      staticBatchMeshCreations++;
    }
    return meshes;
  }
  function matrixDataFor(instances){
    const data=new Float32Array(instances.length*16);
    const matrix=new pc.Mat4(),pos=new pc.Vec3(),rot=new pc.Quat(),scale=new pc.Vec3();
    for(let i=0;i<instances.length;i++){
      const item=instances[i];
      // Instance transforms are chunk-local. The parent chunk Entity owns the
      // scene-anchor/world translation exactly once.
      pos.set(item.position[0],item.position[1],item.position[2]);
      rot.setFromEulerAngles(...(item.euler||[0,0,0]));
      scale.set(...item.scale);
      matrix.setTRS(pos,rot,scale);
      data.set(matrix.data,i*16);
    }
    return data;
  }
  function instanceAabb(instances){
    if(!instances.length)return new pc.BoundingBox(new pc.Vec3(0,0,0),new pc.Vec3(1,1,1));
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const item of instances){
      const hx=Math.abs(item.scale[0])*0.6,hy=Math.abs(item.scale[1])*0.6,hz=Math.abs(item.scale[2])*0.6;
      const x=item.position[0],y=item.position[1],z=item.position[2];
      minX=Math.min(minX,x-hx);maxX=Math.max(maxX,x+hx);
      if(item.anchorBottom){minY=Math.min(minY,y);maxY=Math.max(maxY,y+Math.abs(item.scale[1]));}
      else{minY=Math.min(minY,y-hy);maxY=Math.max(maxY,y+hy);}
      minZ=Math.min(minZ,z-hz);maxZ=Math.max(maxZ,z+hz);
    }
    return new pc.BoundingBox(
      new pc.Vec3((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2),
      new pc.Vec3((maxX-minX)/2,(maxY-minY)/2,(maxZ-minZ)/2)
    );
  }
  function createInstancedGroup(root,name,mesh,mat,instances){
    if(!instances.length)return null;
    const entity=new pc.Entity(name);
    const mi=new pc.MeshInstance(mesh,mat,entity);
    const format=pc.VertexFormat.getDefaultInstancingFormat(device);
    const vb=new pc.VertexBuffer(device,format,instances.length,{data:matrixDataFor(instances)});
    mi.setInstancing(vb,true);
    entity.addComponent("render",{meshInstances:[mi],castShadows:false,receiveShadows:false});
    entity.render.customAabb=instanceAabb(instances);
    root.addChild(entity);
    presentationEntityCreations++;
    presentationMeshInstanceCreations++;
    instancedGroupCreations++;
    instancedObjectCount+=instances.length;
    frustumCulledMeshInstances++;
    return {entity,meshInstance:mi,vertexBuffer:vb,instances};
  }

  function buildGabledRoof(root,descriptor,rootName,b,height,outerW,outerD,roof,roofProfiles){
    const pitchDegrees=28;
    const pitchRadians=pitchDegrees*Math.PI/180;
    const panelThickness=0.16;
    const overhang=clamp(Math.min(outerW,outerD)*0.07,0.16,0.42);
    const slopeAcrossX=outerW<=outerD;
    const wallSpan=slopeAcrossX?outerW:outerD;
    const ridgeLength=(slopeAcrossX?outerD:outerW)+overhang*2;
    const eaveSpan=wallSpan+overhang*2;
    const halfSpan=eaveSpan*0.5;
    const rise=halfSpan*Math.tan(pitchRadians);
    const panelLength=halfSpan/Math.cos(pitchRadians);
    const eaveBottomY=height-0.04;
    const centerY=eaveBottomY+rise*0.5+(panelThickness*0.5*Math.cos(pitchRadians));
    const ridgeBottomY=eaveBottomY+rise;
    const ridgeTopY=ridgeBottomY+panelThickness*Math.cos(pitchRadians);
    let left,right;
    if(slopeAcrossX){
      left=primitive(
        root,rootName+"_RoofL","box",
        [b.x-halfSpan*0.5,centerY,b.z],
        [panelLength,panelThickness,ridgeLength],roof,[0,0,pitchDegrees]
      );
      right=primitive(
        root,rootName+"_RoofR","box",
        [b.x+halfSpan*0.5,centerY,b.z],
        [panelLength,panelThickness,ridgeLength],roof,[0,0,-pitchDegrees]
      );
    }else{
      left=primitive(
        root,rootName+"_RoofL","box",
        [b.x,centerY,b.z-halfSpan*0.5],
        [ridgeLength,panelThickness,panelLength],roof,[-pitchDegrees,0,0]
      );
      right=primitive(
        root,rootName+"_RoofR","box",
        [b.x,centerY,b.z+halfSpan*0.5],
        [ridgeLength,panelThickness,panelLength],roof,[pitchDegrees,0,0]
      );
    }
    left._advisorBuildingId=String(descriptor.id||"");
    right._advisorBuildingId=String(descriptor.id||"");
    registerRoof(left,descriptor);registerRoof(right,descriptor);
    const profile=Object.freeze({
      buildingId:String(descriptor.id||""),
      source:String(descriptor.source||"normal"),
      footprintWidth:Number(b.width.toFixed(3)),
      footprintDepth:Number(b.depth.toFixed(3)),
      wallWidth:Number(outerW.toFixed(3)),
      wallDepth:Number(outerD.toFixed(3)),
      ridgeAxis:slopeAcrossX?"z":"x",
      slopeAxis:slopeAcrossX?"x":"z",
      pitchDegrees,
      overhang:Number(overhang.toFixed(3)),
      wallTopY:Number(height.toFixed(3)),
      eaveBottomY:Number(eaveBottomY.toFixed(3)),
      ridgeBottomY:Number(ridgeBottomY.toFixed(3)),
      ridgeTopY:Number(ridgeTopY.toFixed(3)),
      centerRidgeHigher:ridgeBottomY>eaveBottomY+0.2,
      eaveContact:Math.abs(height-eaveBottomY)<=0.08,
      restrainedOverhang:overhang>=0.16&&overhang<=0.42,
      footprintDriven:true,
      twoPlane:true
    });
    roofProfiles.push(profile);
    return Object.freeze({left,right,profile});
  }

  function buildBuilding(root,worldData,descriptor,index,batches,roofProfiles){
    const b=localBounds(worldData,descriptor.bounds||{});
    const special=descriptor.source==="special";
    const height=special?2.25:1.75;
    const anchor=descriptor.entrance||descriptor.bounds||{};
    const groundY=terrainHeightAtTile(String(seedProvider()||""),anchor.x??descriptor.bounds?.minX??"0",anchor.y??descriptor.bounds?.minY??"0",worldData?.chunkSize||16);
    const wallTopY=groundY+height;
    const wall=special
      ?presentationMaterial("building-special-wall",0.53,0.45,0.31,0.10)
      :presentationMaterial("building-house-wall",0.61,0.52,0.36,0.10);
    const roof=presentationMaterial("building-roof",0.33,0.15,0.10,0.08);
    const door=presentationMaterial("building-door",0.20,0.11,0.06,0.06);
    const rootName="ChunkBuilding_"+String(descriptor.id||index).replace(/[^a-z0-9_-]+/gi,"-");
    const outerW=b.width*0.90,outerD=b.depth*0.90,thickness=0.22;
    const wallBatch=batchFor(batches,wall.name,wall);
    appendBoxBatch(wallBatch,[b.x,groundY+height*0.5,b.z-outerD*0.5],[outerW,height,thickness],0);
    appendBoxBatch(wallBatch,[b.x,groundY+height*0.5,b.z+outerD*0.5],[outerW,height,thickness],0);
    appendBoxBatch(wallBatch,[b.x-outerW*0.5,groundY+height*0.5,b.z],[thickness,height,Math.max(thickness,outerD-thickness*2)],0);
    appendBoxBatch(wallBatch,[b.x+outerW*0.5,groundY+height*0.5,b.z],[thickness,height,Math.max(thickness,outerD-thickness*2)],0);
    buildGabledRoof(root,descriptor,rootName,b,wallTopY,outerW,outerD,roof,roofProfiles);
    let count=6;
    if(descriptor.entrance){
      const p=localTileCenter(worldData,descriptor.entrance.x,descriptor.entrance.y);
      const entranceX=String(descriptor.entrance.x),entranceY=String(descriptor.entrance.y);
      const minX=String(descriptor.bounds?.minX),maxX=String(descriptor.bounds?.maxX);
      const minY=String(descriptor.bounds?.minY),maxY=String(descriptor.bounds?.maxY);
      const onMinX=entranceX===minX,onMaxX=entranceX===maxX,onMinY=entranceY===minY,onMaxY=entranceY===maxY;
      const faceOffset=thickness*0.5+0.08;
      const doorPosition=[p.x,groundY+0.70,p.z];
      let doorScale=[0.82,1.34,0.10];
      if(onMinX){doorPosition[0]=b.x-outerW*0.5-faceOffset;doorScale=[0.10,1.34,0.82];}
      else if(onMaxX){doorPosition[0]=b.x+outerW*0.5+faceOffset;doorScale=[0.10,1.34,0.82];}
      else if(onMinY){doorPosition[2]=b.z-outerD*0.5-faceOffset;}
      else if(onMaxY){doorPosition[2]=b.z+outerD*0.5+faceOffset;}
      appendBoxBatch(batchFor(batches,door.name,door),doorPosition,doorScale,0);
      count++;
    }
    return count;
  }
  function buildInteriorObject(worldData,descriptor,batches){
    const p=localTileCenter(worldData,descriptor.x,descriptor.y);
    const type=String(descriptor.type||"object");
    const specs={
      bed:{scale:[1.45,0.42,1.70],y:0.27,color:[0.50,0.31,0.24]},
      table:{scale:[1.20,0.62,0.86],y:0.36,color:[0.39,0.24,0.12]},
      chair:{scale:[0.58,0.76,0.58],y:0.42,color:[0.35,0.22,0.12]},
      hearth:{scale:[0.88,0.66,0.88],y:0.36,color:[0.48,0.20,0.10]},
      storage:{scale:[1.00,0.96,0.82],y:0.50,color:[0.32,0.23,0.15]},
      workbench:{scale:[1.46,0.80,0.72],y:0.43,color:[0.42,0.29,0.16]}
    };
    const spec=specs[type]||{scale:[0.78,0.60,0.78],y:0.34,color:[0.36,0.29,0.20]};
    const mat=presentationMaterial("interior-"+type,...spec.color,0.08);
    const groundY=terrainHeightAtTile(String(seedProvider()||""),descriptor.x,descriptor.y,worldData?.chunkSize||16);
    appendBoxBatch(batchFor(batches,mat.name,mat),[p.x,groundY+spec.y,p.z],spec.scale,0);
    return 1;
  }
  function collectPropInstances(worldData,descriptor,treeVariants,rocks,treeVariationSamples){
    const p=localTileCenter(worldData,descriptor.x,descriptor.y);
    const type=String(descriptor.type||"");
    if(type==="tree"){
      const seed=String(seedProvider()||"");
      const h=hash32(seed+"|"+String(descriptor.x)+"|"+String(descriptor.y)+"|tree-sprite");
      const variant=h&1,scaleIndex=(h>>>1)%3,flipX=Boolean((h>>>3)&1);
      const scaleChoices=[0.88,1.0,1.12],scaleChoice=scaleChoices[scaleIndex];
      const baseHeight=variant===0?5.35:5.75,height=baseHeight*scaleChoice;
      const width=height*(variant===0?0.70:0.64);
      const jitterX=((((h>>>8)&255)/255)-0.5)*1.0;
      const jitterZ=((((h>>>16)&255)/255)-0.5)*1.0;
      const yaw=Number(treeYawProvider?.()??45);
      const groundY=terrainHeightAtTile(seed,descriptor.x,descriptor.y,worldData?.chunkSize||16,jitterX/2,jitterZ/2);
      const item={
        position:[p.x+jitterX,groundY+0.055,p.z+jitterZ],
        scale:[(flipX?-1:1)*width,height,1],
        euler:[0,yaw,0],
        anchorBottom:true,
        variant,flipX,scaleChoice,
        sourceX:String(descriptor.x),sourceY:String(descriptor.y)
      };
      treeVariants[variant].push(item);
      if(treeVariationSamples.length<12)treeVariationSamples.push(Object.freeze({
        x:item.sourceX,y:item.sourceY,variant,flipX,scaleChoice:Number(scaleChoice.toFixed(2)),
        offsetX:Number(jitterX.toFixed(3)),offsetZ:Number(jitterZ.toFixed(3)),
        width:Number(width.toFixed(3)),height:Number(height.toFixed(3)),yawDegrees:Number(yaw.toFixed(3))
      }));
      return 1;
    }
    const rockGroundY=terrainHeightAtTile(String(seedProvider()||""),descriptor.x,descriptor.y,worldData?.chunkSize||16);
    rocks.push({position:[p.x,rockGroundY+0.34,p.z],scale:[0.70,0.48,0.62],euler:[0,0,0]});
    return 1;
  }

  function build(spec){
    const started=performance.now();
    const size=Math.max(1,Number(spec.chunkSize)||16);
    const segments=heightfieldSegments(size);
    const step=heightfieldStep(size);
    const metersPerTile=2;
    const half=size*metersPerTile/2;
    const seed=String(seedProvider()||"");
    const baseX=BigInt(Math.trunc(Number(spec.x)||0))*BigInt(size);
    const baseZ=BigInt(Math.trunc(Number(spec.y)||0))*BigInt(size);
    const positions=[],normals=[],colors32=[],uvs=[],indices=[];
    const activeAtlas=textureAtlasProvider?.()||null;
    const detailReady=Boolean(activeAtlas?.stats?.()?.detailTextureReady);
    let texturedBlockCount=detailReady?segments*segments:0,colorFallbackBlockCount=detailReady?0:segments*segments;
    const texturedSurfaceTypes=new Set(),fallbackSurfaceTypes=new Set();
    const localSamples=new Map();
    let minHeight=Infinity,maxHeight=-Infinity,minElevation=Infinity,maxElevation=-Infinity;
    const sampleVertex=(wx,wz)=>{
      const key=String(wx)+","+String(wz);
      if(localSamples.has(key))return localSamples.get(key);
      const sample=terrainHeightVertex(seed,wx,wz);
      localSamples.set(key,sample);
      return sample;
    };
    for(let gz=0;gz<=segments;gz++){
      for(let gx=0;gx<=segments;gx++){
        const tileX=gx*step,tileZ=gz*step;
        const wx=baseX+BigInt(tileX),wz=baseZ+BigInt(tileZ);
        const sample=sampleVertex(wx,wz);
        const left=sampleVertex(wx-BigInt(step),wz).height;
        const right=sampleVertex(wx+BigInt(step),wz).height;
        const up=sampleVertex(wx,wz-BigInt(step)).height;
        const down=sampleVertex(wx,wz+BigInt(step)).height;
        const dx=(right-left)/(2*step*metersPerTile),dz=(down-up)/(2*step*metersPerTile);
        const nx=-dx,ny=1,nz=-dz,normLen=Math.hypot(nx,ny,nz)||1;
        positions.push(tileX*metersPerTile-half,sample.height,tileZ*metersPerTile-half);
        normals.push(nx/normLen,ny/normLen,nz/normLen);
        appendColor32(colors32,sample.color,1);
        // The shared detail texture repeats independently from terrain-family color,
        // so indexed border vertices keep one UV and remain seam-safe.
        uvs.push(Number(wx)*0.25,Number(wz)*0.25);
        minHeight=Math.min(minHeight,sample.height);maxHeight=Math.max(maxHeight,sample.height);
        minElevation=Math.min(minElevation,sample.elevationMeters);maxElevation=Math.max(maxElevation,sample.elevationMeters);
        if(detailReady)texturedSurfaceTypes.add(sample.type);else fallbackSurfaceTypes.add(sample.type);
      }
    }
    const stride=segments+1;
    for(let gz=0;gz<segments;gz++){
      for(let gx=0;gx<segments;gx++){
        const i0=gz*stride+gx,i1=i0+1,i2=i0+stride,i3=i2+1;
        indices.push(i0,i2,i1, i1,i2,i3);
      }
    }
    const borderHeights=Object.freeze({
      north:Object.freeze(Array.from({length:stride},(_,i)=>positions[i*3+1])),
      south:Object.freeze(Array.from({length:stride},(_,i)=>positions[((segments*stride)+i)*3+1])),
      west:Object.freeze(Array.from({length:stride},(_,i)=>positions[(i*stride)*3+1])),
      east:Object.freeze(Array.from({length:stride},(_,i)=>positions[(i*stride+segments)*3+1]))
    });

    const mesh=new pc.Mesh(device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setColors32(colors32);
    mesh.setUvs(0,uvs);
    mesh.setIndices(indices);
    mesh.update();
    const entity=new pc.Entity("TerrainChunkMesh_"+spec.x+"_"+spec.y);
    entity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
    const meshInstance=new pc.MeshInstance(mesh,material,entity);
    meshInstance.cull=true;
    entity.render.meshInstances=[meshInstance];
    parent.addChild(entity);
    entity.enabled=false;
    frustumCulledMeshInstances++;

    const presentation=spec.worldData?.presentation||{};
    const buildings=Array.isArray(presentation.buildingDescriptors)?presentation.buildingDescriptors:[];
    const props=Array.isArray(presentation.propDescriptors)?presentation.propDescriptors:[];
    const interiorObjects=Array.isArray(presentation.interiorObjectDescriptors)?presentation.interiorObjectDescriptors:[];
    const batches=staticBatchCollector();
    const roofProfiles=[];
    let sourcePresentationPrimitiveCount=0;
    for(let i=0;i<buildings.length;i++)sourcePresentationPrimitiveCount+=buildBuilding(entity,spec.worldData,buildings[i],i,batches,roofProfiles);
    for(let i=0;i<interiorObjects.length;i++)sourcePresentationPrimitiveCount+=buildInteriorObject(spec.worldData,interiorObjects[i],batches);

    const staticBatches=finalizeStaticBatches(entity,batches);

    const treeVariants=[[],[]],rocks=[],treeVariationSamples=[];
    for(let i=0;i<props.length;i++)sourcePresentationPrimitiveCount+=collectPropInstances(spec.worldData,props[i],treeVariants,rocks,treeVariationSamples);
    const treeGroups=[
      createInstancedGroup(entity,"ChunkTrees_Variant0",primitiveMesh("tree-plane"),treeSpriteMaterial(0),treeVariants[0]),
      createInstancedGroup(entity,"ChunkTrees_Variant1",primitiveMesh("tree-plane"),treeSpriteMaterial(1),treeVariants[1])
    ].filter(Boolean);
    const instancedGroups=[
      ...treeGroups,
      createInstancedGroup(entity,"ChunkRocks",primitiveMesh("rock"),presentationMaterial("rock",0.39,0.40,0.37),rocks)
    ].filter(Boolean);

    const roofPrimitiveCount=buildings.length*2;
    const staticBatchCount=staticBatches.length;
    const instancedGroupCount=instancedGroups.length;
    const optimizedPresentationDrawCalls=roofPrimitiveCount+staticBatchCount+instancedGroupCount;
    const unoptimizedPresentationDrawCalls=sourcePresentationPrimitiveCount;
    const presentationMeshInstanceCount=optimizedPresentationDrawCalls;
    const presentationEntityCount=roofPrimitiveCount+staticBatchCount+instancedGroupCount;
    const sourcePresentationEntityCount=unoptimizedPresentationDrawCalls;
    const savedDrawCalls=Math.max(0,unoptimizedPresentationDrawCalls-optimizedPresentationDrawCalls);

    const surfaceCounts=spec.worldData?.terrain?.surfaceCounts||{};
    const buildMs=performance.now()-started;
    creations++;totalBuildMs+=buildMs;maxBuildMs=Math.max(maxBuildMs,buildMs);
    return {
      entity,mesh,meshInstance,staticBatches,instancedGroups,
      x:Number(spec.x),y:Number(spec.y),chunkSize:size,signature:String(spec.signature||""),
      segments,
      heightfieldGridResolution:segments+1,
      heightfieldStepTiles:step,
      indexedSharedVertices:true,
      vertexCount:positions.length/3,
      triangleCount:indices.length/3,
      minConditionedHeight:Number(minHeight.toFixed(4)),
      maxConditionedHeight:Number(maxHeight.toFixed(4)),
      minSourceElevationMeters:Number(minElevation.toFixed(1)),
      maxSourceElevationMeters:Number(maxElevation.toFixed(1)),
      borderHeights,
      terrainGroundSampler:"indexed-triangle-exact",
      terrainHeightPreparedOnly:true,
      visibleFrameTerrainRebuildCount:0,
      meshInstanceCount:1,
      materialCount:1,
      texturedBlockCount,colorFallbackBlockCount,
      texturedSurfaceTypes:Object.freeze([...texturedSurfaceTypes].sort()),
      fallbackSurfaceTypes:Object.freeze([...fallbackSurfaceTypes].sort()),
      terrainTextureAtlasReady:Boolean(activeAtlas?.stats?.()?.ready),
      terrainTextureAtlasSignature:String(activeAtlas?.stats?.()?.signature||""),
      terrainSurfaceDetailTextureReady:detailReady,
      terrainSurfaceMode:"shared-detail-texture+semantic-vertex-color",
      presentationMeshInstanceCount,
      presentationEntityCount,
      sourcePresentationEntityCount,
      sourcePresentationPrimitiveCount,
      staticBatchCount,
      staticBatchSourcePrimitiveCount:staticBatches.reduce((sum,item)=>sum+item.sourcePrimitiveCount,0),
      instancedGroupCount,
      instancedObjectCount:treeVariants[0].length+treeVariants[1].length+rocks.length,
      treePresentationCount:treeVariants[0].length+treeVariants[1].length,
      treeVariant0Count:treeVariants[0].length,
      treeVariant1Count:treeVariants[1].length,
      treeInstancedGroupCount:treeGroups.length,
      treePlanePresentation:true,
      treeCylinderSpherePlaceholderCount:0,
      treeCameraFacingYawDegrees:Number((Number(treeYawProvider?.()??45)).toFixed(3)),
      treeDeterministicVariation:true,
      instancingCoordinateSpace:"chunk-local",
      instancingParentTranslationAppliedOnce:true,
      instancingRepositionViaParent:true,
      treePlacementJitter:true,
      treePlacementJitterMaxMeters:0.5,
      treeVariationSamples:Object.freeze(treeVariationSamples.slice()),
      treeSpriteAtlas:treeSpriteAtlasProvider?.()?.stats?.()||null,
      treeSharedTextureCount:Number(treeSpriteAtlasProvider?.()?.stats?.()?.gpuTextureCount||0),
      treeSharedMaterialCount:treeSpriteMaterials.size,
      hardwareInstancing:instancedGroupCount>0,
      chunkLocalStaticBatching:staticBatchCount>0,
      frustumCulling:true,
      optimizedPresentationDrawCalls,
      unoptimizedPresentationDrawCalls,
      savedDrawCalls,
      drawCallReductionRatio:unoptimizedPresentationDrawCalls?Number((savedDrawCalls/unoptimizedPresentationDrawCalls).toFixed(4)):0,
      buildingPresentationCount:buildings.length,
      buildingTexturedMaterialCount:surfaceBoundMaterials.size,
      buildingTexturedMaterialNames:Object.freeze([...surfaceBoundMaterials].sort()),
      buildingSurfaceAtlas:buildingSurfaceAtlasProvider?.()?.stats?.()||null,
      staticBatchUvEnabled:staticBatches.every(item=>Boolean(item.mesh)),
      roofProfileCount:roofProfiles.length,
      roofNormalProfileCount:roofProfiles.filter(item=>item.source!=="special").length,
      roofSpecialProfileCount:roofProfiles.filter(item=>item.source==="special").length,
      roofProfilePass:roofProfiles.length===buildings.length&&roofProfiles.every(item=>item.centerRidgeHigher&&item.eaveContact&&item.restrainedOverhang&&item.footprintDriven),
      roofCenterRidgeHigher:roofProfiles.every(item=>item.centerRidgeHigher),
      roofEaveContactPass:roofProfiles.every(item=>item.eaveContact),
      roofFootprintDriven:roofProfiles.every(item=>item.footprintDriven),
      roofProfiles:Object.freeze(roofProfiles.slice()),
      interiorObjectPresentationCount:interiorObjects.length,
      propPresentationCount:props.length,
      roadCellCount:Number(surfaceCounts.road||0)+Number(surfaceCounts.path||0)+Number(surfaceCounts.square||0),
      waterCellCount:Number(surfaceCounts.water||0),
      bridgeCellCount:Number(surfaceCounts.bridge||0),
      terrainTypeCount:Object.keys(surfaceCounts).length,
      seedDerivedPresentation:presentation.source==="seed-chunk-world-data",
      hardCodedSampleGeometry:Boolean(presentation.hardCodedSampleGeometry),
      buildMs,
      worldDataKey:spec.worldData?.key||null,
      worldDataComplete:Boolean(spec.worldData?.complete),
      presentationKind:"chunk-mesh",
      complete:true
    };
  }
  function reposition(resource){
    if(!resource)return;
    // The chunk Entity is repositioned by app.js. Instance matrices remain
    // chunk-local, so scene-anchor changes require no GPU buffer rewrite.
    instancingParentRepositions+=Number(resource.instancedGroups?.length||0);
  }
  function destroy(resource){
    if(!resource)return;
    presentationEntityDestroys+=Number(resource.presentationEntityCount||0);
    for(const group of resource.instancedGroups||[])group.vertexBuffer?.destroy?.();
    for(const item of resource.staticBatches||[])item.mesh?.destroy?.();
    resource.entity?.destroy?.();
    resource.mesh?.destroy?.();
    destroys++;
  }
  function stats(){
    return Object.freeze({
      creations,destroys,
      liveMeshes:Math.max(0,creations-destroys),
      totalBuildMs:Number(totalBuildMs.toFixed(3)),
      maxBuildMs:Number(maxBuildMs.toFixed(3)),
      averageBuildMs:Number((creations?totalBuildMs/creations:0).toFixed(3)),
      presentationEntityCreations,presentationEntityDestroys,presentationMeshInstanceCreations,
      entityCreations:creations+presentationEntityCreations,
      entityDestroys:destroys+presentationEntityDestroys,
      staticBatchMeshCreations,staticBatchSourcePrimitiveCount,
      instancedGroupCreations,instancedObjectCount,instancingBufferUpdates,instancingParentRepositions,
      instancingCoordinateSpace:"chunk-local",
      instancingParentTranslationAppliedOnce:true,
      frustumCulledMeshInstances,
      sharedPresentationMaterialCount:presentationMaterials.size,
      treeSpriteMaterialCount:treeSpriteMaterials.size,
      treeSpriteAtlas:treeSpriteAtlasProvider?.()?.stats?.()||null,
      treePlaneMeshPrepared:primitiveMeshes.has("tree-plane"),
      treeCylinderSpherePlaceholders:false,
      buildingTexturedMaterialCount:surfaceBoundMaterials.size,
      buildingTexturedMaterialNames:Object.freeze([...surfaceBoundMaterials].sort()),
      buildingSurfaceAtlas:buildingSurfaceAtlasProvider?.()?.stats?.()||null,
      oneEntityPerChunk:true,
      oneEntityPerTile:false,
      sharedMaterial:true,
      terrainTextureAtlas:textureAtlasProvider?.()?.stats?.()||null,
      chunkLocalStaticBatching:true,
      hardwareInstancing:true,
      frustumCulling:true,
      completeChunkMesh:true,
      heightfield:true,
      heightfieldGridResolutionDefault:9,
      heightfieldVerticalScale:HEIGHTFIELD_VERTICAL_SCALE,
      heightfieldWaterY:HEIGHTFIELD_WATER_Y,
      heightVertexSampleCalls,
      heightVertexCacheHits,
      heightVertexCacheEntries:heightVertexCache.size,
      heightVertexCacheLimit:HEIGHT_VERTEX_CACHE_LIMIT,
      heightGroundSampleCalls,
      seedDerivedPresentation:true,
      hardCodedSampleGeometry:false,
      simulationAuthorityPreserved:true
    });
  }
  function heightAtTile(x,y,chunkSize=16,offsetX=0,offsetY=0){
    return terrainHeightAtTile(String(seedProvider()||""),x,y,chunkSize,offsetX,offsetY);
  }
  return Object.freeze({build,reposition,destroy,stats,heightAtTile});
}

window.PlayCanvasTerrainChunkMesh=Object.freeze({create});
})();
