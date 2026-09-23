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

function create({pc,device,parent,material,seedProvider=()=>""}={}){
  if(!pc||!device||!parent||!material)throw new Error("PlayCanvasTerrainChunkMesh requires pc/device/parent/material");
  material.vertexColors=true;
  material.gloss=0.08;
  material.metalness=0;
  material.update();

  let creations=0,destroys=0,totalBuildMs=0,maxBuildMs=0;

  function sampleHeight(seed,x,z){
    const broad=signed01(seed,Math.trunc(x/4),Math.trunc(z/4),"broad");
    const fine=signed01(seed,x,z,"fine");
    return 0.05 + broad*0.018 + fine*0.006;
  }
  function sampleColor(seed,x,z,height){
    const n=signed01(seed,x,z,"color");
    const lift=clamp((height+0.09)*0.55,-0.03,0.04);
    const r=clamp(0.29+n*0.018+lift,0.20,0.40);
    const g=clamp(0.42+n*0.025+lift,0.30,0.55);
    const b=clamp(0.215+n*0.012+lift*0.5,0.14,0.30);
    return [r,g,b,1];
  }
  function build(spec){
    const started=performance.now();
    const size=Math.max(1,Number(spec.chunkSize)||16);
    const segments=Math.min(4,size);
    const step=size/segments;
    const metersPerTile=2;
    const half=size*metersPerTile/2;
    const seed=String(seedProvider()||"");
    const baseX=BigInt(Math.trunc(Number(spec.x)||0))*BigInt(size);
    const baseZ=BigInt(Math.trunc(Number(spec.y)||0))*BigInt(size);
    const positions=[],normals=[],colors=[],indices=[];

    for(let z=0;z<=segments;z++){
      for(let x=0;x<=segments;x++){
        const tileX=Math.round(x*step);
        const tileZ=Math.round(z*step);
        const worldX=baseX+BigInt(tileX);
        const worldZ=baseZ+BigInt(tileZ);
        const wx=Number(worldX),wz=Number(worldZ);
        const y=sampleHeight(seed,wx,wz);
        positions.push(x*step*metersPerTile-half,y,z*step*metersPerTile-half);
        normals.push(0,1,0);
        colors.push(...sampleColor(seed,wx,wz,y));
      }
    }
    const row=segments+1;
    for(let z=0;z<segments;z++){
      for(let x=0;x<segments;x++){
        const a=z*row+x,b=a+1,c=a+row,d=c+1;
        indices.push(a,c,b,b,c,d);
      }
    }

    const geometry=new pc.Geometry();
    geometry.positions=positions;
    geometry.normals=normals;
    geometry.colors=colors;
    geometry.indices=indices;
    const mesh=pc.Mesh.fromGeometry(device,geometry);
    const entity=new pc.Entity("TerrainChunkMesh_"+spec.x+"_"+spec.y);
    entity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
    const meshInstance=new pc.MeshInstance(mesh,material,entity);
    entity.render.meshInstances=[meshInstance];
    parent.addChild(entity);
    entity.enabled=false;

    const buildMs=performance.now()-started;
    creations++;totalBuildMs+=buildMs;maxBuildMs=Math.max(maxBuildMs,buildMs);
    return {
      entity,mesh,meshInstance,
      x:Number(spec.x),y:Number(spec.y),chunkSize:size,signature:String(spec.signature||""),
      segments,
      vertexCount:positions.length/3,
      triangleCount:indices.length/3,
      meshInstanceCount:1,
      materialCount:1,
      buildMs,
      presentationKind:"chunk-mesh",
      complete:true
    };
  }
  function destroy(resource){
    if(!resource)return;
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
      oneEntityPerChunk:true,
      oneEntityPerTile:false,
      sharedMaterial:true,
      completeChunkMesh:true,
      simulationAuthorityPreserved:true
    });
  }
  return Object.freeze({build,destroy,stats});
}

window.PlayCanvasTerrainChunkMesh=Object.freeze({create});
})();