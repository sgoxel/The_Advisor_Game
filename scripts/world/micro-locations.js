(function(){
"use strict";

const VERSION="1.0.0";
const POI_CELL_TILES=8192;
const CHUNK_QUERY_MARGIN_TILES=14;
const MAX_QUERY_CELLS_PER_CHUNK=4;
const MAX_LOCATIONS_PER_CHUNK=2;
const MAX_PROPS_PER_LOCATION=14;
const COMPOSITION_CACHE_LIMIT=256;
const WATER_SEARCH_STEPS=Object.freeze([1,2,4,8,16,32,48,64,96]);
const SUPPORTED_SOURCE_TYPES=new Set([
  "ruin","fort","tower","hunting","fishing","forest","gathering","grazing",
  "cave","cliff","outcrop","waterfall","river-location","confluence","bridge"
]);

const compositionCache=new Map();
let queryCount=0,queryCellCount=0,cacheHits=0,cacheMisses=0,compositionBuilds=0;
let materializationCount=0,materializedPropCount=0,maxBuildMs=0,lastBuildMs=0,lastQueryMs=0;

function now(){return typeof performance!=="undefined"&&performance.now?performance.now():Date.now();}
function hash32(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function floorDiv(value,divisor){const v=BigInt(String(value)),d=BigInt(String(divisor));let q=v/d,r=v%d;if(r!==0n&&v<0n)q-=1n;return q;}
function absBig(value){const v=BigInt(String(value));return v<0n?-v:v;}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function freezeArray(values){return Object.freeze(values.map(item=>Object.freeze(item)));}
function cellKey(seed,cx,cy){return String(seed)+"|"+String(cx)+"|"+String(cy);}
function rotate(dx,dy,quarterTurns){
  let x=Number(dx)||0,y=Number(dy)||0;
  const turns=((Math.round(Number(quarterTurns)||0)%4)+4)%4;
  for(let i=0;i<turns;i++){const t=x;x=-y;y=t;}
  return Object.freeze({x:Math.round(x),y:Math.round(y)});
}
function sourceContextValid(source){
  const type=String(source?.type||""),ev=source?.evidence||{},terrain=String(ev.terrain||"");
  if(!SUPPORTED_SOURCE_TYPES.has(type))return false;
  if(["ruin","fort","tower"].includes(type))return terrain!=="water";
  if(type==="hunting")return Number(ev.forestSamples||0)>=3||/forest|woodland/i.test(String(ev.biome||""));
  if(type==="fishing")return Number(ev.waterSamples||0)>=2||Number(ev.waterArms||0)>=1;
  if(type==="forest")return Number(ev.forestSamples||0)>=4;
  if(type==="gathering")return Number(ev.forestSamples||0)>=3||Number(ev.rockSamples||0)>=2;
  if(type==="grazing")return Number(ev.openSamples||0)>=4;
  if(["cave","cliff","outcrop"].includes(type))return terrain!=="water"&&(Number(ev.rockSamples||0)>=1||Number(ev.slopeMeters||0)>=80);
  if(["waterfall","river-location","confluence","bridge"].includes(type))return Number(ev.waterSamples||0)>=1||Number(ev.waterArms||0)>=1||terrain==="water"||terrain==="bridge";
  return false;
}
function compositionType(seed,source){
  const type=String(source?.type||"");
  if(["ruin","fort","tower"].includes(type)){
    const variants=["ruined-tower","shrine","burial-site"];
    return variants[hash32(String(seed)+"|historical-template|"+String(source.id))%variants.length];
  }
  if(type==="hunting")return "hunter-camp";
  if(type==="fishing")return "fishing-spot";
  if(type==="forest")return "unusual-grove";
  if(type==="gathering")return Number(source?.evidence?.rockSamples||0)>=2?"quarry-outcrop":"hidden-clearing";
  if(type==="grazing")return "abandoned-cart-campsite";
  if(type==="cave")return "cave-entrance";
  if(type==="cliff"||type==="outcrop")return "quarry-outcrop";
  if(type==="waterfall")return "waterfall-crossing";
  if(type==="river-location"||type==="confluence"||type==="bridge")return "river-crossing";
  return null;
}
function worldSurface(seed,x,y){
  try{return String(window.WorldField?.sample?.(String(seed),String(BigInt(String(x))*2n),String(BigInt(String(y))*2n))?.surfaceType||"");}
  catch(_){try{return String(window.GeographyFoundation?.getTerrainType?.(String(seed),String(x),String(y))||"");}catch(__){return "";}}
}
function waterFacingYaw(dx,dy){
  if(dx===0n&&dy<0n)return 180;
  if(dx>0n&&dy===0n)return 270;
  if(dx===0n&&dy>0n)return 0;
  return 90;
}
function shoreAnchor(seed,source){
  const center={x:BigInt(String(source.center.x)),y:BigInt(String(source.center.y))};
  const dirs=[
    Object.freeze({dx:0n,dy:-1n}),Object.freeze({dx:1n,dy:0n}),
    Object.freeze({dx:0n,dy:1n}),Object.freeze({dx:-1n,dy:0n})
  ];
  const centerWater=worldSurface(seed,String(center.x),String(center.y))==="water";
  let best=null;
  for(const dir of dirs){
    let low=0,lowTarget=centerWater,high=null;
    for(const step of WATER_SEARCH_STEPS){
      const distance=BigInt(step),x=center.x+dir.dx*distance,y=center.y+dir.dy*distance;
      const isWater=worldSurface(seed,String(x),String(y))==="water";
      const target=centerWater?!isWater:isWater;
      if(target){high=step;break;}
      low=step;lowTarget=target;
    }
    if(high===null)continue;
    let lo=low,hi=high;
    while(hi-lo>1){
      const mid=Math.floor((lo+hi)/2),distance=BigInt(mid);
      const isWater=worldSurface(seed,String(center.x+dir.dx*distance),String(center.y+dir.dy*distance))==="water";
      const target=centerWater?!isWater:isWater;
      if(target)hi=mid;else lo=mid;
    }
    let anchorDistance,waterDx,waterDy;
    if(centerWater){
      // Source is inside a river/lake corridor. The first dry tile is the
      // shoreline anchor; water lies back toward the source center.
      anchorDistance=hi;waterDx=-dir.dx;waterDy=-dir.dy;
    }else{
      // Source is dry but water-adjacent. Keep the anchor on the last dry tile
      // so docks/crossing props never start several dozen metres inland.
      anchorDistance=lo;waterDx=dir.dx;waterDy=dir.dy;
    }
    const distance=BigInt(anchorDistance),candidate={
      x:center.x+dir.dx*distance,y:center.y+dir.dy*distance,
      yaw:waterFacingYaw(waterDx,waterDy),distance:anchorDistance
    };
    if(!best||candidate.distance<best.distance||(candidate.distance===best.distance&&candidate.yaw<best.yaw))best=candidate;
  }
  if(best)return Object.freeze({x:String(best.x),y:String(best.y),yaw:best.yaw,shiftTiles:best.distance});
  return Object.freeze({x:String(center.x),y:String(center.y),yaw:(hash32(seed+"|shore-fallback|"+source.id)%4)*90,shiftTiles:0});
}
function defaultAnchor(seed,source){
  return Object.freeze({
    x:String(source.center.x),y:String(source.center.y),
    yaw:(hash32(String(seed)+"|micro-yaw|"+String(source.id))%4)*90,shiftTiles:0
  });
}
function anchorFor(seed,source){
  const type=String(source?.type||"");
  return ["fishing","waterfall","river-location","confluence","bridge"].includes(type)?shoreAnchor(seed,source):defaultAnchor(seed,source);
}
function layoutFor(type){
  const layouts={
    "ruined-tower":[["ruin-wall",-2,-2,0],["ruin-wall",0,-2,1],["ruin-wall",2,-2,2],["ruin-wall",-2,0,1],["ruin-wall",2,0,0],["marker-stone",0,1,1],["crate",1,2,0]],
    "shrine":[["shrine",0,0,0],["marker-stone",-2,-2,0],["marker-stone",2,-2,1],["marker-stone",-2,2,2],["marker-stone",2,2,0],["flower",0,2,1],["bench",0,-2,0]],
    "burial-site":[["grave",-2,-1,0],["grave",0,-1,1],["grave",2,-1,2],["grave",-1,2,1],["grave",1,2,0],["marker-stone",0,-3,1],["flower",0,0,2]],
    "hunter-camp":[["tent",-2,1,0],["campfire",1,0,1],["crate",2,2,0],["woodpile",-1,-2,2],["sack",2,-2,1],["fish-rack",-3,-1,0]],
    "fishing-spot":[["dock",0,0,0],["dock",0,1,1],["dock",0,2,2],["fish-rack",-2,0,1],["barrel",2,0,0],["crate",-2,2,2],["signpost",2,2,1]],
    "unusual-grove":[["unusual-tree",0,0,0],["bush",-3,-1,0],["bush",3,-1,1],["bush",-2,3,2],["bush",2,3,0],["marker-stone",0,-3,1],["flower",1,2,2]],
    "hidden-clearing":[["campfire",0,0,0],["bench",-2,1,0],["bench",2,1,1],["bush",-3,-2,2],["bush",3,-2,0],["marker-stone",0,3,1]],
    "abandoned-cart-campsite":[["cart",-1,0,0],["tent",2,1,1],["campfire",1,-2,2],["crate",-3,2,0],["sack",-2,-2,1],["woodpile",3,-1,2]],
    "quarry-outcrop":[["quarry",0,0,0],["marker-stone",-2,-2,0],["marker-stone",2,-2,1],["marker-stone",-2,2,2],["marker-stone",2,2,0],["work-prop",0,3,1],["cart",3,0,2]],
    "cave-entrance":[["cave-mouth",0,0,0],["marker-stone",-2,1,0],["marker-stone",2,1,1],["campfire",0,3,2],["woodpile",-2,3,0]],
    "waterfall-crossing":[["dock",0,0,0],["dock",0,1,1],["signpost",-2,-1,0],["marker-stone",2,-1,1],["bench",-2,2,2]],
    "river-crossing":[["dock",0,0,0],["dock",0,1,1],["dock",0,2,2],["signpost",-2,0,0],["barrel",2,1,1]]
  };
  return layouts[type]||[];
}
function propDescriptor(location,entry,index){
  const [semantic,dx,dy,variant]=entry,turns=Math.round(location.rotation/90),offset=rotate(dx,dy,turns);
  const x=BigInt(location.anchor.x)+BigInt(offset.x),y=BigInt(location.anchor.y)+BigInt(offset.y);
  return Object.freeze({
    id:"micro-prop:"+location.id+":"+String(index).padStart(2,"0")+":"+semantic,
    type:"dressing",semantic,context:"micro-location:"+location.compositionType,
    microLocationId:location.id,microLocationType:location.compositionType,
    destinationId:location.sourceDestinationId,
    x:String(x),y:String(y),sourceTerrain:String(location.sourceTerrain||""),
    roadAdjacent:false,routeSafe:true,rotation:location.rotation,variant:Number(variant||0)%3,
    rendererOnly:true,simulationAuthority:false,collisionAuthority:false,navigationAuthority:false
  });
}
function composeDestination(seedValue,sourceValue,relatedIdsValue){
  const started=now(),seed=String(seedValue||""),source=sourceValue||null;
  if(!source||!sourceContextValid(source))return null;
  const type=compositionType(seed,source);if(!type)return null;
  const key=String(seed)+"|"+String(source.id)+"|"+type;
  const cached=compositionCache.get(key);
  if(cached){cacheHits++;compositionCache.delete(key);compositionCache.set(key,cached);return cached;}
  cacheMisses++;
  const anchor=anchorFor(seed,source),rotation=Number(anchor.yaw||0);
  const relatedIds=Object.freeze([...(relatedIdsValue||[])].map(String).sort());
  const base={
    id:"MLOC|"+hash32(key+"|"+anchor.x+"|"+anchor.y).toString(16).padStart(8,"0"),
    version:VERSION,compositionType:type,sourceDestinationId:String(source.id),
    relatedDestinationIds:relatedIds,sourceType:String(source.type),sourceCategory:String(source.category||""),
    sourceTerrain:String(source?.evidence?.terrain||""),sourceEvidence:Object.freeze({...source.evidence}),
    sourceCenter:Object.freeze({x:String(source.center.x),y:String(source.center.y)}),
    anchor:Object.freeze({x:String(anchor.x),y:String(anchor.y)}),
    anchorShiftTiles:Number(anchor.shiftTiles||0),rotation,
    footprintRadiusTiles:7,strategicVisibilityTier:"local",localVisibilityTier:"near-ground",
    deterministic:true,seedOnly:true,lazy:true,rendererOnly:true,
    simulationAuthority:false,collisionAuthority:false,navigationAuthority:false,
    questAuthority:false,rewardAuthority:false
  };
  const props=layoutFor(type).slice(0,MAX_PROPS_PER_LOCATION).map((entry,index)=>propDescriptor(base,entry,index));
  const result=Object.freeze({...base,props:Object.freeze(props),propCount:props.length,signature:hash32(props.map(p=>p.id+"@"+p.x+","+p.y+"#"+p.rotation).join("|")).toString(16).padStart(8,"0")});
  compositionCache.set(key,result);compositionBuilds++;
  if(compositionCache.size>COMPOSITION_CACHE_LIMIT)compositionCache.delete(compositionCache.keys().next().value);
  const elapsed=now()-started;lastBuildMs=elapsed;maxBuildMs=Math.max(maxBuildMs,elapsed);
  return result;
}
function choosePrimary(seed,candidates,cx,cy){
  const valid=(candidates||[]).filter(sourceContextValid);
  if(!valid.length)return null;
  valid.sort((a,b)=>{
    const ah=hash32(String(seed)+"|micro-primary|"+String(cx)+"|"+String(cy)+"|"+String(a.id));
    const bh=hash32(String(seed)+"|micro-primary|"+String(cx)+"|"+String(cy)+"|"+String(b.id));
    return bh-ah||String(a.id).localeCompare(String(b.id));
  });
  return valid[0];
}
function composeCell(seedValue,cxValue,cyValue){
  const started=now(),seed=String(seedValue||""),cx=String(cxValue),cy=String(cyValue);
  const query=window.WorldDestinations?.poiCell?.(seed,cx,cy)||null;
  queryCount++;queryCellCount++;
  const candidates=Array.isArray(query?.results)?query.results:[];
  const primary=choosePrimary(seed,candidates,cx,cy);
  lastQueryMs=now()-started;
  if(!primary)return null;
  return composeDestination(seed,primary,candidates.map(item=>item.id));
}
function intersectsLocation(bounds,location,margin=0){
  const radius=BigInt(Math.max(0,Math.ceil(Number(location?.footprintRadiusTiles||0)+Number(margin||0))));
  const x=BigInt(String(location.anchor.x)),y=BigInt(String(location.anchor.y));
  return !(x+radius<BigInt(String(bounds.minX))||x-radius>BigInt(String(bounds.maxX))||y+radius<BigInt(String(bounds.minY))||y-radius>BigInt(String(bounds.maxY)));
}
function cellsForBounds(bounds,marginTiles){
  const margin=BigInt(Math.max(0,Math.ceil(Number(marginTiles)||0)));
  const minX=BigInt(String(bounds.minX))-margin,maxX=BigInt(String(bounds.maxX))+margin;
  const minY=BigInt(String(bounds.minY))-margin,maxY=BigInt(String(bounds.maxY))+margin;
  const minCx=floorDiv(minX,POI_CELL_TILES),maxCx=floorDiv(maxX,POI_CELL_TILES);
  const minCy=floorDiv(minY,POI_CELL_TILES),maxCy=floorDiv(maxY,POI_CELL_TILES);
  const centerX=(minX+maxX)/2n,centerY=(minY+maxY)/2n,ccx=floorDiv(centerX,POI_CELL_TILES),ccy=floorDiv(centerY,POI_CELL_TILES);
  const cells=[];
  for(let cy=minCy;cy<=maxCy;cy++)for(let cx=minCx;cx<=maxCx;cx++){
    const dx=Number(cx-ccx),dy=Number(cy-ccy);
    cells.push({cx,cy,d:dx*dx+dy*dy});
  }
  cells.sort((a,b)=>a.d-b.d||(a.cy<b.cy?-1:a.cy>b.cy?1:a.cx<b.cx?-1:a.cx>b.cx?1:0));
  return cells.slice(0,MAX_QUERY_CELLS_PER_CHUNK);
}
function forChunk(seedValue,boundsValue){
  const started=now(),seed=String(seedValue||""),bounds=boundsValue||null;
  if(!bounds)return Object.freeze({seed,locations:Object.freeze([]),diagnostics:Object.freeze({queryCellCount:0,bounded:true,fullWorldScan:false})});
  const cells=cellsForBounds(bounds,CHUNK_QUERY_MARGIN_TILES),locations=[];
  for(const cell of cells){
    const location=composeCell(seed,cell.cx,cell.cy);
    if(location&&intersectsLocation(bounds,location,CHUNK_QUERY_MARGIN_TILES))locations.push(location);
    if(locations.length>=MAX_LOCATIONS_PER_CHUNK)break;
  }
  materializationCount++;materializedPropCount+=locations.reduce((n,item)=>n+item.propCount,0);
  const elapsed=now()-started;lastBuildMs=elapsed;maxBuildMs=Math.max(maxBuildMs,elapsed);
  return Object.freeze({
    seed,locations:Object.freeze(locations),
    diagnostics:Object.freeze({
      version:VERSION,queryCellCount:cells.length,maxQueryCells:MAX_QUERY_CELLS_PER_CHUNK,
      locationCount:locations.length,propCount:locations.reduce((n,item)=>n+item.propCount,0),
      bounded:true,fullWorldScan:false,perFrameScan:false,lazyChunkMaterialization:true,
      sourceAuthority:"WorldDestinations.poiCell + Campaign SEED"
    })
  });
}
function clearTransient(){compositionCache.clear();}
function stats(){
  return Object.freeze({
    version:VERSION,queryCount,queryCellCount,cacheHits,cacheMisses,compositionBuilds,
    compositionCacheEntries:compositionCache.size,compositionCacheLimit:COMPOSITION_CACHE_LIMIT,
    materializationCount,materializedPropCount,lastBuildMs:Number(lastBuildMs.toFixed(3)),
    maxBuildMs:Number(maxBuildMs.toFixed(3)),lastQueryMs:Number(lastQueryMs.toFixed(3)),
    maxLocationsPerChunk:MAX_LOCATIONS_PER_CHUNK,maxPropsPerLocation:MAX_PROPS_PER_LOCATION,
    maxQueryCellsPerChunk:MAX_QUERY_CELLS_PER_CHUNK,chunkQueryMarginTiles:CHUNK_QUERY_MARGIN_TILES,
    deterministic:true,seedOnly:true,bounded:true,fullWorldScan:false,perFrameScan:false,
    lazyChunkMaterialization:true,simulationAuthority:false
  });
}

window.MicroLocations=Object.freeze({
  VERSION,POI_CELL_TILES,CHUNK_QUERY_MARGIN_TILES,MAX_QUERY_CELLS_PER_CHUNK,MAX_LOCATIONS_PER_CHUNK,
  MAX_PROPS_PER_LOCATION,COMPOSITION_CACHE_LIMIT,SUPPORTED_SOURCE_TYPES,
  composeDestination,composeCell,forChunk,clearTransient,stats
});
})();