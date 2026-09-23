(function(){
"use strict";

const VERSION="1.0.0";
const STANDARD_TERRAIN=new Set([
  "road","bridge","square","path","grass","dirt","farmland","plot",
  "forest","mud","rock","sand","floor","door","wall","water","building"
]);

const cache=new Map();
let cacheHits=0,cacheMisses=0,completeChunkGenerations=0,releases=0;
let terrainFoundationCalls=0,walkabilityClassifications=0;
let totalGenerationMs=0,maxGenerationMs=0;
let viewTileHits=0,viewTileMisses=0;
let lastGeneratedIds=Object.freeze([]);

function floorDiv(value,divisor){
  const v=BigInt(String(value)),d=BigInt(divisor);
  let q=v/d,r=v%d;
  if(r<0n)q-=1n;
  return q;
}
function chunkCoordinate(value,size){return floorDiv(value,size);}
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
  return window.PlayCanvasWorldAssets?"catalog-1":"none";
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
      if(!STANDARD_TERRAIN.has(cell.type)&&!cell.buildingId){
        staticObjects.push(Object.freeze({
          id:"static:"+cell.x+":"+cell.y+":"+cell.type,
          type:cell.type,x:cell.x,y:cell.y
        }));
      }
    }
  }

  const buildings=buildingReferences(seed,bounds);
  for(const building of buildings)buildingIds.add(building.id);
  const elapsed=performance.now()-started;
  totalGenerationMs+=elapsed;maxGenerationMs=Math.max(maxGenerationMs,elapsed);
  completeChunkGenerations++;

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
      buildingDescriptors:Object.freeze(buildings.map(item=>Object.freeze({
        id:item.id,kind:item.kind,source:item.source,bounds:item.bounds
      }))),
      propDescriptors:Object.freeze(staticObjects.map(item=>Object.freeze({
        id:item.id,type:item.type,x:item.x,y:item.y
      })))
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
  return generate(spec);
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
  const halfCols=Math.floor(columns/2),halfRows=Math.floor(rows/2);
  const tiles=[];
  const missing=new Set();
  const used=new Set();
  const centerX=BigInt(String(center.x)),centerY=BigInt(String(center.y));
  for(let row=0;row<rows;row++){
    const y=centerY+BigInt(row-halfRows);
    for(let col=0;col<columns;col++){
      const x=centerX+BigInt(col-halfCols);
      const snapshot=snapshotForCoordinate({seed,x:String(x),y:String(y),chunkSize,signature});
      if(!snapshot){
        viewTileMisses++;
        missing.add(String(chunkCoordinate(x,chunkSize))+","+String(chunkCoordinate(y,chunkSize)));
        continue;
      }
      const cell=cellFromSnapshot(snapshot,x,y);
      if(!cell){
        viewTileMisses++;
        missing.add(snapshot.key);
        continue;
      }
      viewTileHits++;
      used.add(snapshot.key);
      tiles.push(cell);
    }
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
  return Object.freeze({
    version:VERSION,
    entryCount:cache.size,
    cacheHits,cacheMisses,
    completeChunkGenerations,
    releases,
    terrainFoundationCalls,
    walkabilityClassifications,
    viewTileHits,viewTileMisses,
    totalGenerationMs:Number(totalGenerationMs.toFixed(3)),
    maxGenerationMs:Number(maxGenerationMs.toFixed(3)),
    averageGenerationMs:Number((completeChunkGenerations?totalGenerationMs/completeChunkGenerations:0).toFixed(3)),
    lastGeneratedIds,
    stableChunkIdentity:true,
    completeChunksOnly:true,
    boundedByRendererRetention:true,
    simulationAuthorityPreserved:true
  });
}
function clear(){
  cache.clear();
}
window.PlayCanvasChunkWorldData=Object.freeze({
  version:VERSION,
  getOrCreate,touch,release,collectView,stats,clear,signatureFor
});
})();