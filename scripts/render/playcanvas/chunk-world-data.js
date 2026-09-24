(function(){
"use strict";

const VERSION="1.4.0";
const STANDARD_TERRAIN=new Set([
  "road","bridge","square","path","grass","dirt","farmland","plot",
  "forest","mud","rock","sand","floor","door","wall","water","building"
]);

const cache=new Map();
const everGenerated=new Set();
let cacheHits=0,cacheMisses=0,completeChunkGenerations=0,releases=0,regenerationCount=0;
let activeGenerations=0,preparedGenerations=0,otherGenerations=0;
let terrainFoundationCalls=0,walkabilityClassifications=0;
let totalGenerationMs=0,maxGenerationMs=0;
let viewTileHits=0,viewTileMisses=0,lastViewTileHits=0,lastViewTileMisses=0;
let lastGeneratedIds=Object.freeze([]);

function floorDiv(value,divisor){
  const v=BigInt(String(value)),d=BigInt(divisor);
  let q=v/d,r=v%d;
  if(r<0n)q-=1n;
  return q;
}
function chunkCoordinate(value,size){return floorDiv(value,size);}
function ownsCoordinate(x,y,chunkX,chunkY,size){
  return chunkCoordinate(x,size)===BigInt(chunkX)&&chunkCoordinate(y,size)===BigInt(chunkY);
}
function sparseStaticKind(cell){
  const type=String(cell?.type||"");
  if(type!=="forest"&&type!=="rock")return null;
  try{
    const x=BigInt(cell.x),y=BigInt(cell.y);
    const hash=((x*73856093n)^(y*19349663n))&0xffffffffn;
    if(type==="forest"&&hash%19n===0n)return "tree";
    if(type==="rock"&&hash%13n===0n)return "rock";
  }catch(_){}
  return null;
}
function boundsFor(chunkX,chunkY,size){
  const s=BigInt(size);
  const minX=BigInt(chunkX)*s,minY=BigInt(chunkY)*s;
  return Object.freeze({
    minX:String(minX),minY:String(minY),
    maxX:String(minX+s-1n),maxY:String(minY+s-1n),
    width:size,height:size
  });
}
function assetVersion(){
  return String(window.PlayCanvasAssetStandard?.version||"none");
}
function worldAssetVersion(){
  return String(window.PlayCanvasWorldAssets?.VERSION||"none");
}
function signatureFor({seed,x,y,chunkSize,signature=""}){
  return [
    "chunk-world-data",VERSION,
    "seed="+String(seed||""),
    "chunk="+String(chunkSize),
    "coord="+String(x)+","+String(y),
    "render="+String(signature||"standard"),
    "asset="+assetVersion(),
    "world="+worldAssetVersion()
  ].join("|");
}
function intersects(bounds,other){
  if(!other)return false;
  const aMinX=BigInt(bounds.minX),aMaxX=BigInt(bounds.maxX);
  const aMinY=BigInt(bounds.minY),aMaxY=BigInt(bounds.maxY);
  const bMinX=BigInt(String(other.minX)),bMaxX=BigInt(String(other.maxX));
  const bMinY=BigInt(String(other.minY)),bMaxY=BigInt(String(other.maxY));
  return !(aMaxX<bMinX||bMaxX<aMinX||aMaxY<bMinY||bMaxY<aMinY);
}
function buildingReferences(seed,bounds){
  const out=[];
  for(const plan of HousePlans.build(seed)){
    if(!intersects(bounds,plan.bounds))continue;
    out.push(Object.freeze({
      id:String(plan.id),
      kind:String(plan.kind||"house"),
      source:"house",
      bounds:Object.freeze({
        minX:String(plan.bounds.minX),minY:String(plan.bounds.minY),
        maxX:String(plan.bounds.maxX),maxY:String(plan.bounds.maxY)
      }),
      entrance:plan.entrance?Object.freeze({x:String(plan.entrance.x),y:String(plan.entrance.y)}):null
    }));
  }
  for(const lot of SpecialLots.build(seed)){
    if(!intersects(bounds,lot.bounds))continue;
    out.push(Object.freeze({
      id:String(lot.id),
      kind:String(lot.kind||"special"),
      label:String(lot.label||lot.kind||"special"),
      source:"special",
      enterable:Boolean(lot.enterable),
      bounds:Object.freeze({
        minX:String(lot.bounds.minX),minY:String(lot.bounds.minY),
        maxX:String(lot.bounds.maxX),maxY:String(lot.bounds.maxY)
      }),
      entrance:lot.access?Object.freeze({x:String(lot.access.x),y:String(lot.access.y)}):null
    }));
  }
  return Object.freeze(out.sort((a,b)=>a.id.localeCompare(b.id)));
}
function freezeMovement(state){
  if(!state)return null;
  return Object.freeze({
    terrainType:String(state.terrainType||""),
    category:String(state.category||""),
    walkable:Boolean(state.walkable),
    blocksMovement:Boolean(state.blocksMovement),
    speedKmh:Number(state.speedKmh||0),
    secondsPerTile:Number.isFinite(state.secondsPerTile)?Number(state.secondsPerTile):null,
    buildingId:state.buildingId?String(state.buildingId):null,
    room:state.room?String(state.room):null,
    specialKind:state.specialKind?String(state.specialKind):null,
    barrierKind:state.barrierKind?String(state.barrierKind):null,
    doorwayKind:state.doorwayKind?String(state.doorwayKind):null
  });
}
function freezeTile(tile,movement,localX,localY){
  return Object.freeze({
    localX,localY,
    x:String(tile.x),y:String(tile.y),
    type:String(tile.type||""),
    label:String(tile.label||""),
    color:String(tile.color||"#000000"),
    texture:String(tile.texture||""),
    textureKey:String(tile.textureKey||""),
    overlayTexture:tile.overlayTexture?String(tile.overlayTexture):null,
    overlayTextureKey:tile.overlayTextureKey?String(tile.overlayTextureKey):null,
    buildingId:tile.buildingId?String(tile.buildingId):null,
    room:tile.room?String(tile.room):null,
    specialKind:tile.specialKind?String(tile.specialKind):null,
    specialLabel:tile.specialLabel?String(tile.specialLabel):null,
    movement:freezeMovement(movement)
  });
}
function generate(spec){
  const started=performance.now();
  const seed=String(spec.seed||"");
  const size=Math.max(1,Number(spec.chunkSize)||16);
  const bounds=boundsFor(spec.x,spec.y,size);
  const minX=BigInt(bounds.minX),minY=BigInt(bounds.minY);
  const cells=new Array(size*size);
  const surfaceCounts={};
  const textureKeys=new Set(),overlayTextureKeys=new Set(),buildingIds=new Set();
  const staticObjects=[];
  let treePresentationCount=0,rockPresentationCount=0,otherPresentationCount=0;
  let walkableCount=0,blockedCount=0;

  for(let localY=0;localY<size;localY++){
    for(let localX=0;localX<size;localX++){
      const x=String(minX+BigInt(localX)),y=String(minY+BigInt(localY));
      const tile=TerrainFoundation.getTile(seed,x,y);
      terrainFoundationCalls++;
      const movement=Walkability.classifyPrepared
        ?Walkability.classifyPrepared(seed,tile)
        :Walkability.classify(seed,x,y);
      walkabilityClassifications++;
      if(movement?.walkable)walkableCount++;else blockedCount++;
      const cell=freezeTile(tile,movement,localX,localY);
      cells[localY*size+localX]=cell;
      surfaceCounts[cell.type]=(surfaceCounts[cell.type]||0)+1;
      if(cell.textureKey)textureKeys.add(cell.textureKey);
      if(cell.overlayTextureKey)overlayTextureKeys.add(cell.overlayTextureKey);
      if(cell.buildingId)buildingIds.add(cell.buildingId);
      const sparseKind=sparseStaticKind(cell);
      const allowSparse=sparseKind==="tree"
        ?treePresentationCount<3
        :sparseKind==="rock"
          ?rockPresentationCount<2
          :Boolean(sparseKind&&otherPresentationCount<2);
      if(sparseKind&&allowSparse){
        staticObjects.push(Object.freeze({
          id:"static:"+cell.x+":"+cell.y+":"+sparseKind,
          type:sparseKind,x:cell.x,y:cell.y,sourceTerrain:cell.type
        }));
        if(sparseKind==="tree")treePresentationCount++;
        else if(sparseKind==="rock")rockPresentationCount++;
        else otherPresentationCount++;
      }else if(!STANDARD_TERRAIN.has(cell.type)&&!cell.buildingId&&otherPresentationCount<2){
        staticObjects.push(Object.freeze({
          id:"static:"+cell.x+":"+cell.y+":"+cell.type,
          type:cell.type,x:cell.x,y:cell.y,sourceTerrain:cell.type
        }));
        otherPresentationCount++;
      }
    }
  }

  const buildings=buildingReferences(seed,bounds);
  for(const building of buildings)buildingIds.add(building.id);
  const ownedBuildings=buildings.filter(building=>{
    const anchor=building.entrance||{x:building.bounds.minX,y:building.bounds.minY};
    return ownsCoordinate(anchor.x,anchor.y,spec.x,spec.y,size);
  });
  const interiorObjects=(window.InteriorObjects?.build?.(seed)||[])
    .filter(object=>ownsCoordinate(object?.coordinate?.x,object?.coordinate?.y,spec.x,spec.y,size))
    .map(object=>Object.freeze({
      id:String(object.id),
      type:String(object.type||"object"),
      buildingId:String(object.buildingId||""),
      room:object.room?String(object.room):null,
      x:String(object.coordinate?.x),
      y:String(object.coordinate?.y),
      blocking:Boolean(object.blocking)
    }));
  const elapsed=performance.now()-started;
  totalGenerationMs+=elapsed;maxGenerationMs=Math.max(maxGenerationMs,elapsed);
  completeChunkGenerations++;
  if(spec.state==="Active")activeGenerations++;
  else if(spec.state==="Prepared")preparedGenerations++;
  else otherGenerations++;

  const key=signatureFor(spec);
  const snapshot=Object.freeze({
    key,
    version:VERSION,
    seed,
    chunkX:Number(spec.x),
    chunkY:Number(spec.y),
    chunkSize:size,
    bounds,
    complete:true,
    cells:Object.freeze(cells),
    terrain:Object.freeze({
      surfaceCounts:Object.freeze({...surfaceCounts}),
      textureKeys:Object.freeze([...textureKeys].sort()),
      overlayTextureKeys:Object.freeze([...overlayTextureKeys].sort()),
      walkableCount,blockedCount
    }),
    buildingIds:Object.freeze([...buildingIds].sort()),
    buildings,
    staticObjects:Object.freeze(staticObjects),
    presentation:Object.freeze({
      terrainMeshRequired:true,
      source:"seed-chunk-world-data",
      buildingDescriptors:Object.freeze(ownedBuildings.map(item=>Object.freeze({
        id:item.id,kind:item.kind,label:item.label||item.kind,source:item.source,
        bounds:item.bounds,entrance:item.entrance||null
      }))),
      propDescriptors:Object.freeze(staticObjects.map(item=>Object.freeze({
        id:item.id,type:item.type,x:item.x,y:item.y,sourceTerrain:item.sourceTerrain||null
      }))),
      interiorObjectDescriptors:Object.freeze(interiorObjects),
      hardCodedSampleGeometry:false
    }),
    generationMs:Number(elapsed.toFixed(3)),
    generatedTerrainCalls:size*size,
    generatedWalkabilityClassifications:size*size,
    simulationAuthorityPreserved:true
  });
  cache.set(key,{snapshot,lastUsed:performance.now(),touches:0});
  lastGeneratedIds=Object.freeze([key,...lastGeneratedIds].slice(0,12));
  return snapshot;
}
function getOrCreate(spec){
  const key=signatureFor(spec);
  const existing=cache.get(key);
  if(existing){
    cacheHits++;existing.touches++;existing.lastUsed=performance.now();
    return existing.snapshot;
  }
  cacheMisses++;
  if(everGenerated.has(key))regenerationCount++;
  const snapshot=generate(spec);
  everGenerated.add(key);
  return snapshot;
}
function touch(key){
  const entry=cache.get(String(key||""));
  if(!entry)return false;
  cacheHits++;entry.touches++;entry.lastUsed=performance.now();
  return true;
}
function release(key){
  if(!cache.delete(String(key||"")))return false;
  releases++;
  return true;
}
function cellFromSnapshot(snapshot,xValue,yValue){
  if(!snapshot)return null;
  const x=BigInt(String(xValue)),y=BigInt(String(yValue));
  const minX=BigInt(snapshot.bounds.minX),minY=BigInt(snapshot.bounds.minY);
  const lx=Number(x-minX),ly=Number(y-minY);
  if(lx<0||ly<0||lx>=snapshot.chunkSize||ly>=snapshot.chunkSize)return null;
  return snapshot.cells[ly*snapshot.chunkSize+lx]||null;
}
function snapshotForCoordinate({seed,x,y,chunkSize,signature}){
  const cx=chunkCoordinate(x,chunkSize),cy=chunkCoordinate(y,chunkSize);
  const key=signatureFor({seed,x:Number(cx),y:Number(cy),chunkSize,signature});
  return cache.get(key)?.snapshot||null;
}
function collectView({seed,center,columns,rows,chunkSize,signature}){
  lastViewTileHits=0;
  lastViewTileMisses=0;
  const halfCols=Math.floor(columns/2),halfRows=Math.floor(rows/2);
  const baseCells=[];
  const missing=new Set();
  const used=new Set();
  const centerX=BigInt(String(center.x)),centerY=BigInt(String(center.y));

  function lookup(x,y,{countVisible=false}={}){
    const snapshot=snapshotForCoordinate({seed,x:String(x),y:String(y),chunkSize,signature});
    if(!snapshot){
      if(countVisible){viewTileMisses++;lastViewTileMisses++;}
      missing.add(String(chunkCoordinate(x,chunkSize))+","+String(chunkCoordinate(y,chunkSize)));
      return null;
    }
    const cell=cellFromSnapshot(snapshot,x,y);
    if(!cell){
      if(countVisible){viewTileMisses++;lastViewTileMisses++;}
      missing.add(snapshot.key);
      return null;
    }
    if(countVisible){viewTileHits++;lastViewTileHits++;}
    used.add(snapshot.key);
    return cell;
  }

  for(let row=0;row<rows;row++){
    const y=centerY+BigInt(row-halfRows);
    for(let col=0;col<columns;col++){
      const x=centerX+BigInt(col-halfCols);
      const cell=lookup(x,y,{countVisible:true});
      baseCells.push({row,col,x,y,cell});
    }
  }

  const tiles=[];
  for(const item of baseCells){
    if(!item.cell)continue;
    const neighbor=(dx,dy)=>{
      const cell=lookup(item.x+BigInt(dx),item.y+BigInt(dy));
      return cell?.type||null;
    };
    const neighbors={
      n:neighbor(0,-1),
      e:neighbor(1,0),
      s:neighbor(0,1),
      w:neighbor(-1,0),
      ne:neighbor(1,-1),
      se:neighbor(1,1),
      sw:neighbor(-1,1),
      nw:neighbor(-1,-1)
    };
    const blends=TileTextures.blendSpecs(item.cell.type,neighbors,{
      seed,
      x:item.cell.x,
      y:item.cell.y
    });
    tiles.push(Object.freeze({
      ...item.cell,
      row:item.row,
      col:item.col,
      blends:Object.freeze(blends.map(blend=>Object.freeze({...blend})))
    }));
  }

  for(const key of used)touch(key);
  return Object.freeze({
    ready:missing.size===0&&tiles.length===columns*rows,
    tiles:Object.freeze(tiles),
    missingChunkIds:Object.freeze([...missing].sort()),
    usedChunkIds:Object.freeze([...used].sort()),
    expectedTileCount:columns*rows,
    tileCount:tiles.length,
    simulationAuthorityPreserved:true
  });
}
function stats(){
  let surfaceCellCount=0,buildingReferenceCount=0,staticObjectReferenceCount=0,completeEntryCount=0;
  let presentationBuildingCount=0,presentationPropCount=0,presentationInteriorObjectCount=0,roadCellCount=0,waterCellCount=0,bridgeCellCount=0;
  for(const entry of cache.values()){
    const snapshot=entry.snapshot;
    surfaceCellCount+=Number(snapshot?.cells?.length||0);
    buildingReferenceCount+=Number(snapshot?.buildings?.length||0);
    staticObjectReferenceCount+=Number(snapshot?.staticObjects?.length||0);
    presentationBuildingCount+=Number(snapshot?.presentation?.buildingDescriptors?.length||0);
    presentationPropCount+=Number(snapshot?.presentation?.propDescriptors?.length||0);
    presentationInteriorObjectCount+=Number(snapshot?.presentation?.interiorObjectDescriptors?.length||0);
    roadCellCount+=Number(snapshot?.terrain?.surfaceCounts?.road||0)+Number(snapshot?.terrain?.surfaceCounts?.path||0)+Number(snapshot?.terrain?.surfaceCounts?.square||0);
    waterCellCount+=Number(snapshot?.terrain?.surfaceCounts?.water||0);
    bridgeCellCount+=Number(snapshot?.terrain?.surfaceCounts?.bridge||0);
    if(snapshot?.complete)completeEntryCount++;
  }
  return Object.freeze({
    version:VERSION,
    entryCount:cache.size,
    completeEntryCount,
    surfaceCellCount,
    buildingReferenceCount,
    staticObjectReferenceCount,
    presentationBuildingCount,presentationPropCount,presentationInteriorObjectCount,
    roadCellCount,waterCellCount,bridgeCellCount,
    cacheHits,cacheMisses,
    completeChunkGenerations,
    uniqueGeneratedChunkCount:everGenerated.size,
    regenerationCount,
    activeGenerations,preparedGenerations,otherGenerations,
    releases,
    terrainFoundationCalls,
    walkabilityClassifications,
    viewTileHits,viewTileMisses,lastViewTileHits,lastViewTileMisses,
    totalGenerationMs:Number(totalGenerationMs.toFixed(3)),
    maxGenerationMs:Number(maxGenerationMs.toFixed(3)),
    averageGenerationMs:Number((completeChunkGenerations?totalGenerationMs/completeChunkGenerations:0).toFixed(3)),
    lastGeneratedIds,
    stableChunkIdentity:true,
    completeChunksOnly:true,
    boundedByRendererRetention:true,
    seedDerivedPresentation:true,
    hardCodedSampleGeometry:false,
    simulationAuthorityPreserved:true
  });
}
function clear(){
  cache.clear();
  everGenerated.clear();
  regenerationCount=0;
}
window.PlayCanvasChunkWorldData=Object.freeze({
  version:VERSION,
  getOrCreate,touch,release,collectView,stats,clear,signatureFor
});
})();