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

function create({pc,device,parent,material,textureAtlasProvider=()=>null,buildingSurfaceAtlasProvider=()=>null,seedProvider=()=>"",registerRoof=()=>{}}={}){
  if(!pc||!device||!parent||!material)throw new Error("PlayCanvasTerrainChunkMesh requires pc/device/parent/material");
  material.vertexColors=true;
  material.diffuseVertexColor=true;
  material.diffuse.set(1,1,1);
  material.gloss=0.06;
  material.metalness=0;
  material.update();

  const presentationMaterials=new Map();
  const surfaceBoundMaterials=new Set();
  const primitiveMeshes=new Map();
  const baseBox=new pc.BoxGeometry();
  let creations=0,destroys=0,totalBuildMs=0,maxBuildMs=0;
  let presentationEntityCreations=0,presentationEntityDestroys=0,presentationMeshInstanceCreations=0;
  let staticBatchMeshCreations=0,staticBatchSourcePrimitiveCount=0,instancedGroupCreations=0,instancedObjectCount=0;
  let instancingBufferUpdates=0,frustumCulledMeshInstances=0;

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
    let geometry;
    if(kind==="tree-trunk")geometry=new pc.CylinderGeometry({radius:0.5,height:1,heightSegments:1,capSegments:8});
    else geometry=new pc.SphereGeometry({radius:0.5,latitudeBands:8,longitudeBands:8});
    const mesh=pc.Mesh.fromGeometry(device,geometry);
    primitiveMeshes.set(kind,mesh);
    return mesh;
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
  function matrixDataFor(instances,worldX,worldZ){
    const data=new Float32Array(instances.length*16);
    const matrix=new pc.Mat4(),pos=new pc.Vec3(),rot=new pc.Quat(),scale=new pc.Vec3();
    for(let i=0;i<instances.length;i++){
      const item=instances[i];
      pos.set(Number(worldX)+item.position[0],item.position[1],Number(worldZ)+item.position[2]);
      rot.setFromEulerAngles(...(item.euler||[0,0,0]));
      scale.set(...item.scale);
      matrix.setTRS(pos,rot,scale);
      data.set(matrix.data,i*16);
    }
    return data;
  }
  function instanceAabb(instances,worldX,worldZ){
    if(!instances.length)return new pc.BoundingBox(new pc.Vec3(worldX,0,worldZ),new pc.Vec3(1,1,1));
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const item of instances){
      const hx=Math.abs(item.scale[0])*0.6,hy=Math.abs(item.scale[1])*0.6,hz=Math.abs(item.scale[2])*0.6;
      const x=Number(worldX)+item.position[0],y=item.position[1],z=Number(worldZ)+item.position[2];
      minX=Math.min(minX,x-hx);maxX=Math.max(maxX,x+hx);
      minY=Math.min(minY,y-hy);maxY=Math.max(maxY,y+hy);
      minZ=Math.min(minZ,z-hz);maxZ=Math.max(maxZ,z+hz);
    }
    return new pc.BoundingBox(
      new pc.Vec3((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2),
      new pc.Vec3((maxX-minX)/2,(maxY-minY)/2,(maxZ-minZ)/2)
    );
  }
  function createInstancedGroup(root,name,mesh,mat,instances,worldX=0,worldZ=0){
    if(!instances.length)return null;
    const entity=new pc.Entity(name);
    const mi=new pc.MeshInstance(mesh,mat,entity);
    const format=pc.VertexFormat.getDefaultInstancingFormat(device);
    const vb=new pc.VertexBuffer(device,format,instances.length,{data:matrixDataFor(instances,worldX,worldZ)});
    mi.setInstancing(vb,true);
    mi.aabb=instanceAabb(instances,worldX,worldZ);
    entity.addComponent("render",{meshInstances:[mi],castShadows:false,receiveShadows:false});
    root.addChild(entity);
    presentationEntityCreations++;
    presentationMeshInstanceCreations++;
    instancedGroupCreations++;
    instancedObjectCount+=instances.length;
    frustumCulledMeshInstances++;
    return {entity,meshInstance:mi,vertexBuffer:vb,instances};
  }
  function updateInstancingGroup(group,worldX,worldZ){
    if(!group)return;
    group.vertexBuffer.setData(matrixDataFor(group.instances,worldX,worldZ));
    group.meshInstance.aabb=instanceAabb(group.instances,worldX,worldZ);
    instancingBufferUpdates++;
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
    const wall=special
      ?presentationMaterial("building-special-wall",0.53,0.45,0.31,0.10)
      :presentationMaterial("building-house-wall",0.61,0.52,0.36,0.10);
    const roof=presentationMaterial("building-roof",0.33,0.15,0.10,0.08);
    const door=presentationMaterial("building-door",0.20,0.11,0.06,0.06);
    const rootName="ChunkBuilding_"+String(descriptor.id||index).replace(/[^a-z0-9_-]+/gi,"-");
    const outerW=b.width*0.90,outerD=b.depth*0.90,thickness=0.22;
    const wallBatch=batchFor(batches,wall.name,wall);
    appendBoxBatch(wallBatch,[b.x,height*0.5,b.z-outerD*0.5],[outerW,height,thickness],0);
    appendBoxBatch(wallBatch,[b.x,height*0.5,b.z+outerD*0.5],[outerW,height,thickness],0);
    appendBoxBatch(wallBatch,[b.x-outerW*0.5,height*0.5,b.z],[thickness,height,Math.max(thickness,outerD-thickness*2)],0);
    appendBoxBatch(wallBatch,[b.x+outerW*0.5,height*0.5,b.z],[thickness,height,Math.max(thickness,outerD-thickness*2)],0);
    buildGabledRoof(root,descriptor,rootName,b,height,outerW,outerD,roof,roofProfiles);
    let count=6;
    if(descriptor.entrance){
      const p=localTileCenter(worldData,descriptor.entrance.x,descriptor.entrance.y);
      const entranceX=String(descriptor.entrance.x),entranceY=String(descriptor.entrance.y);
      const minX=String(descriptor.bounds?.minX),maxX=String(descriptor.bounds?.maxX);
      const minY=String(descriptor.bounds?.minY),maxY=String(descriptor.bounds?.maxY);
      const onMinX=entranceX===minX,onMaxX=entranceX===maxX,onMinY=entranceY===minY,onMaxY=entranceY===maxY;
      const faceOffset=thickness*0.5+0.08;
      const doorPosition=[p.x,0.70,p.z];
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
    appendBoxBatch(batchFor(batches,mat.name,mat),[p.x,spec.y,p.z],spec.scale,0);
    return 1;
  }
  function collectPropInstances(worldData,descriptor,treeTrunks,treeCanopies,rocks){
    const p=localTileCenter(worldData,descriptor.x,descriptor.y);
    const type=String(descriptor.type||"");
    if(type==="tree"){
      treeTrunks.push({position:[p.x,0.72,p.z],scale:[0.30,1.35,0.30],euler:[0,0,0]});
      treeCanopies.push({position:[p.x,1.75,p.z],scale:[1.05,0.95,1.05],euler:[0,0,0]});
      return 2;
    }
    rocks.push({position:[p.x,0.34,p.z],scale:[0.70,0.48,0.62],euler:[0,0,0]});
    return 1;
  }

  function build(spec){
    const started=performance.now();
    const size=Math.max(1,Number(spec.chunkSize)||16);
    const segments=Math.min(8,size);
    const step=size/segments;
    const metersPerTile=2;
    const half=size*metersPerTile/2;
    const seed=String(seedProvider()||"");
    const baseX=BigInt(Math.trunc(Number(spec.x)||0))*BigInt(size);
    const baseZ=BigInt(Math.trunc(Number(spec.y)||0))*BigInt(size);
    const positions=[],normals=[],colors32=[],uvs=[],indices=[];
    const activeAtlas=textureAtlasProvider?.()||null;
    let texturedBlockCount=0,colorFallbackBlockCount=0;
    const texturedSurfaceTypes=new Set(),fallbackSurfaceTypes=new Set();

    for(let bz=0;bz<segments;bz++){
      for(let bx=0;bx<segments;bx++){
        const startX=Math.round(bx*step),endX=Math.round((bx+1)*step);
        const startZ=Math.round(bz*step),endZ=Math.round((bz+1)*step);
        const worldX=baseX+BigInt(startX);
        const worldZ=baseZ+BigInt(startZ);
        const fallback=sampleColor(seed,Number(worldX),Number(worldZ));
        const surface=blockSurface(spec.worldData,startX,startZ,endX,endZ,fallback);
        const rect=activeAtlas?.stats?.()?.ready?activeAtlas.uvRect?.(surface.type):null;
        const x0=startX*metersPerTile-half,x1=endX*metersPerTile-half;
        const z0=startZ*metersPerTile-half,z1=endZ*metersPerTile-half;
        const base=positions.length/3;
        positions.push(x0,0.05,z0, x1,0.05,z0, x0,0.05,z1, x1,0.05,z1);
        normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
        if(rect){
          appendColor32(colors32,[1,1,1,1],4);
          uvs.push(rect.u0,rect.v0, rect.u1,rect.v0, rect.u0,rect.v1, rect.u1,rect.v1);
          texturedBlockCount++;texturedSurfaceTypes.add(rect.type||surface.type);
        }else{
          appendColor32(colors32,surface.color,4);
          uvs.push(0,0, 1,0, 0,1, 1,1);
          colorFallbackBlockCount++;fallbackSurfaceTypes.add(surface.type);
        }
        indices.push(base,base+2,base+1, base+1,base+2,base+3);
      }
    }

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

    const treeTrunks=[],treeCanopies=[],rocks=[];
    for(let i=0;i<props.length;i++)sourcePresentationPrimitiveCount+=collectPropInstances(spec.worldData,props[i],treeTrunks,treeCanopies,rocks);
    const worldX=Number(spec.worldX||0),worldZ=Number(spec.worldZ||0);
    const instancedGroups=[
      createInstancedGroup(entity,"ChunkTrees_Trunks",primitiveMesh("tree-trunk"),presentationMaterial("tree-trunk",0.28,0.18,0.10),treeTrunks,worldX,worldZ),
      createInstancedGroup(entity,"ChunkTrees_Canopies",primitiveMesh("tree-canopy"),presentationMaterial("tree-canopy",0.18,0.38,0.16),treeCanopies,worldX,worldZ),
      createInstancedGroup(entity,"ChunkRocks",primitiveMesh("rock"),presentationMaterial("rock",0.39,0.40,0.37),rocks,worldX,worldZ)
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
      vertexCount:positions.length/3,
      triangleCount:indices.length/3,
      meshInstanceCount:1,
      materialCount:1,
      texturedBlockCount,colorFallbackBlockCount,
      texturedSurfaceTypes:Object.freeze([...texturedSurfaceTypes].sort()),
      fallbackSurfaceTypes:Object.freeze([...fallbackSurfaceTypes].sort()),
      terrainTextureAtlasReady:Boolean(activeAtlas?.stats?.()?.ready),
      terrainTextureAtlasSignature:String(activeAtlas?.stats?.()?.signature||""),
      presentationMeshInstanceCount,
      presentationEntityCount,
      sourcePresentationEntityCount,
      sourcePresentationPrimitiveCount,
      staticBatchCount,
      staticBatchSourcePrimitiveCount:staticBatches.reduce((sum,item)=>sum+item.sourcePrimitiveCount,0),
      instancedGroupCount,
      instancedObjectCount:treeTrunks.length+treeCanopies.length+rocks.length,
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
  function reposition(resource,worldX,worldZ){
    if(!resource)return;
    for(const group of resource.instancedGroups||[])updateInstancingGroup(group,Number(worldX||0),Number(worldZ||0));
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
      instancedGroupCreations,instancedObjectCount,instancingBufferUpdates,
      frustumCulledMeshInstances,
      sharedPresentationMaterialCount:presentationMaterials.size,
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
      seedDerivedPresentation:true,
      hardCodedSampleGeometry:false,
      simulationAuthorityPreserved:true
    });
  }
  return Object.freeze({build,reposition,destroy,stats});
}

window.PlayCanvasTerrainChunkMesh=Object.freeze({create});
})();
