(function(){
"use strict";

const VERSION="1.9.0";
const STANDARD_TERRAIN=new Set([
  "road","bridge","square","path","grass","dirt","farmland","plot",
  "forest","mud","rock","sand","floor","door","wall","water","building"
]);

const cache=new Map();
const dressingCache=new Map();
const connectorCache=new Map();
const landmarkCache=new Map();
const everGenerated=new Set();
let cacheHits=0,cacheMisses=0,completeChunkGenerations=0,releases=0,regenerationCount=0;
let activeGenerations=0,preparedGenerations=0,otherGenerations=0;
let terrainFoundationCalls=0,walkabilityClassifications=0,connectorTerrainChecks=0;
let totalGenerationMs=0,maxGenerationMs=0;
let viewTileHits=0,viewTileMisses=0,lastViewTileHits=0,lastViewTileMisses=0;
let lastGeneratedIds=Object.freeze([]);
let terrainWorker=null,terrainWorkerSequence=0;
const terrainWorkerJobs=new Map();
let terrainWorkerRequests=0,terrainWorkerCompletions=0,terrainWorkerCancellations=0;
let terrainWorkerErrors=0,terrainWorkerCells=0,terrainWorkerFallbacks=0,totalTerrainWorkerMs=0,maxTerrainWorkerMs=0;

function ensureTerrainWorker(){
  if(terrainWorker)return terrainWorker;
  if(typeof Worker!=="function")return null;
  try{
    const worker=new Worker("scripts/render/playcanvas/terrain-stream-worker.js");
    worker.onmessage=event=>{
      const message=event?.data||{};
      const id=String(message.id||"");
      const record=terrainWorkerJobs.get(id);
      if(!record)return;
      if(message.type==="complete"){
        terrainWorkerJobs.delete(id);
        record.work.workerStatus="ready";
        record.work.workerTypes=new Map((message.results||[]).map(item=>[Number(item.index),String(item.type||"grass")]));
        const workerMs=Math.max(0,Number(message.workerMs||0));
        terrainWorkerCompletions++;
        terrainWorkerCells+=Math.max(0,Number(message.cells||record.work.workerTypes.size||0));
        totalTerrainWorkerMs+=workerMs;
        maxTerrainWorkerMs=Math.max(maxTerrainWorkerMs,workerMs);
      }else if(message.type==="cancelled"){
        terrainWorkerJobs.delete(id);
        record.work.workerStatus="cancelled";
        terrainWorkerCancellations++;
      }else if(message.type==="error"){
        terrainWorkerJobs.delete(id);
        record.work.workerStatus="fallback";
        record.work.workerError=String(message.error||"terrain-worker-error");
        terrainWorkerErrors++;
        terrainWorkerFallbacks++;
      }
    };
    worker.onerror=()=>{
      terrainWorkerErrors++;
      terrainWorkerFallbacks+=terrainWorkerJobs.size;
      for(const record of terrainWorkerJobs.values()){
        record.work.workerStatus="fallback";
        record.work.workerError="terrain-worker-runtime-error";
      }
      terrainWorkerJobs.clear();
      try{worker.terminate();}catch(_){}
      terrainWorker=null;
    };
    terrainWorker=worker;
    return worker;
  }catch(_){
    terrainWorkerErrors++;
    return null;
  }
}
function absBigInt(value){
  const v=BigInt(String(value));
  return v<0n?-v:v;
}
function workerEligibleCoordinate(x,y){
  try{
    return absBigInt(x)>BigInt(STREAMING_MINIMUM_STARTING_VILLAGE_DETAIL_RADIUS)||
      absBigInt(y)>BigInt(STREAMING_MINIMUM_STARTING_VILLAGE_DETAIL_RADIUS);
  }catch(_){
    return false;
  }
}
function dispatchTerrainWorker(work){
  const worker=ensureTerrainWorker();
  if(!worker)return false;
  const cells=work.indices.map(index=>{
    const localY=Math.floor(index/work.size),localX=index-localY*work.size;
    return Object.freeze({
      index,
      x:String(work.minX+BigInt(localX)),
      y:String(work.minY+BigInt(localY))
    });
  });
  if(!cells.length||!cells.every(cell=>workerEligibleCoordinate(cell.x,cell.y)))return false;
  const id="terrain-"+(++terrainWorkerSequence);
  work.workerJobId=id;
  work.workerStatus="pending";
  terrainWorkerJobs.set(id,{work});
  terrainWorkerRequests++;
  try{
    worker.postMessage({type:"prepare",id,seed:work.seed,cells});
    return true;
  }catch(error){
    terrainWorkerJobs.delete(id);
    work.workerStatus="fallback";
    work.workerError=String(error?.message||error||"terrain-worker-post-failed");
    terrainWorkerErrors++;
    terrainWorkerFallbacks++;
    return false;
  }
}
function cancelMinimumPreparation(reason="superseded"){
  const worker=terrainWorker;
  let cancelled=0;
  for(const [id,record] of terrainWorkerJobs){
    record.work.workerStatus="cancelled";
    record.work.workerCancelReason=String(reason||"superseded");
    try{worker?.postMessage?.({type:"cancel",id});}catch(_){}
    terrainWorkerJobs.delete(id);
    terrainWorkerCancellations++;
    cancelled++;
  }
  return cancelled;
}

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
function presentationHash32(seed,x,y,salt){
  const text=[String(seed||""),String(x),String(y),String(salt||"")].join("|");
  let h=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;h^=h>>>15;
  return h>>>0;
}
function sparseStaticKind(cell){
  const type=String(cell?.type||"");
  if(type!=="rock")return null;
  try{
    const x=BigInt(cell.x),y=BigInt(cell.y);
    const hash=((x*73856093n)^(y*19349663n))&0xffffffffn;
    if(hash%13n===0n)return "rock";
  }catch(_){}
  return null;
}

const DRESSING_BLOCKED_TERRAIN=new Set(["road","path","square","bridge","water","door","wall","floor","building"]);
const DRESSING_ALLOWED_TERRAIN=new Set(["grass","dirt","farmland","plot","mud"]);
const DRESSING_CONTEXTS=Object.freeze({
  residential:Object.freeze(["garden","woodpile","bush","flower","fence"]),
  commercial:Object.freeze(["signpost","barrel","crate","cart","sack"]),
  workshop:Object.freeze(["woodpile","crate","barrel","cart","work-prop"]),
  farm:Object.freeze(["fence","garden","pen","sack","cart"]),
  civic:Object.freeze(["well","signpost","flower","bush","bench"])
});
function buildingDressingContext(building){
  const kind=String(building?.kind||"").toLowerCase();
  if(building?.source!=="special")return "residential";
  if(kind==="tavern"||kind==="shop"||kind==="storehouse")return "commercial";
  if(kind==="workshop"||kind==="workyard")return "workshop";
  if(kind==="barn")return "farm";
  if(kind==="meeting-hall")return "civic";
  return "commercial";
}
function buildingCatalog(seed){
  const out=[];
  for(const plan of HousePlans.build(seed)){
    out.push(Object.freeze({
      id:String(plan.id),
      kind:String(plan.kind||"house"),
      source:"house",
      enterable:true,
      bounds:Object.freeze({
        minX:String(plan.bounds.minX),minY:String(plan.bounds.minY),
        maxX:String(plan.bounds.maxX),maxY:String(plan.bounds.maxY)
      }),
      entrance:plan.entrance?Object.freeze({
        x:String(plan.entrance.x),y:String(plan.entrance.y),
        side:String(plan.entrance.side||""),
        target:plan.entrance.target?Object.freeze({x:String(plan.entrance.target.x),y:String(plan.entrance.target.y)}):null,
        accessLengthTiles:Number(plan.entrance.accessLengthTiles||0)
      }):null
    }));
  }
  for(const lot of SpecialLots.build(seed)){
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
      entrance:lot.access?Object.freeze({
        x:String(lot.access.x),y:String(lot.access.y),
        side:String(lot.access.side||""),
        target:lot.access.target?Object.freeze({x:String(lot.access.target.x),y:String(lot.access.target.y)}):null,
        accessLengthTiles:Number(lot.access.accessLengthTiles||0)
      }):null
    }));
  }
  return Object.freeze(out.sort((a,b)=>a.id.localeCompare(b.id)));
}
function settlementLandmarkPlan(seed){
  const cacheKey=String(seed||"");
  if(landmarkCache.has(cacheKey))return landmarkCache.get(cacheKey);
  const settlement=window.SettlementArchetypes?.build?.(
    cacheKey,{x:"0",y:"0"},{classHint:"village",nameHint:"Starting Village"}
  )||null;
  const tags=Array.isArray(settlement?.subtypes?.tags)&&settlement.subtypes.tags.length
    ?settlement.subtypes.tags.map(String)
    :["mixed"];
  const primary=tags[0]||"mixed";
  const choiceByTag=Object.freeze({
    agricultural:Object.freeze({kind:"barn",treatment:"harvest-cupola",role:"agricultural-anchor"}),
    forest:Object.freeze({kind:"workshop",treatment:"timber-stack",role:"craft-anchor"}),
    mining:Object.freeze({kind:"workshop",treatment:"forge-stack",role:"production-anchor"}),
    trade:Object.freeze({kind:"tavern",treatment:"market-crest",role:"trade-anchor"}),
    port:Object.freeze({kind:"tavern",treatment:"market-crest",role:"travel-anchor"}),
    frontier:Object.freeze({kind:"meeting-hall",treatment:"watch-cupola",role:"frontier-anchor"}),
    fortified:Object.freeze({kind:"meeting-hall",treatment:"watch-cupola",role:"civic-defense-anchor"}),
    mixed:Object.freeze({kind:"meeting-hall",treatment:"civic-cupola",role:"civic-anchor"})
  });
  const choice=choiceByTag[primary]||choiceByTag.mixed;
  const catalog=buildingCatalog(cacheKey);
  const selected=
    catalog.find(item=>item.source==="special"&&item.kind===choice.kind)||
    catalog.find(item=>item.source==="special"&&item.kind==="meeting-hall")||
    catalog.find(item=>item.source==="special")||null;
  const plan=selected?Object.freeze({
    id:"landmark:"+String(selected.id),
    buildingId:String(selected.id),
    buildingKind:String(selected.kind||"special"),
    treatment:choice.treatment,
    role:choice.role,
    contextTag:primary,
    contextTags:Object.freeze(tags.slice(0,4)),
    settlementClass:String(settlement?.classId||"village"),
    settlementRevision:String(settlement?.revision||""),
    countryId:String(settlement?.countryId||""),
    regionId:String(settlement?.regionId||""),
    publicSpaceBand:String(settlement?.publicSpaceScale?.band||""),
    deterministic:true,
    rendererOnly:true,
    navigationAuthority:false,
    collisionAuthority:false,
    simulationAuthorityPreserved:true
  }):null;
  landmarkCache.set(cacheKey,plan);
  return plan;
}

const CONNECTOR_BLOCKED_TERRAIN=new Set(["water","wall","floor","door","building"]);
const CONNECTOR_ROUTE_TERRAIN=new Set(["road","path","square","bridge"]);
function connectorKey(x,y){return String(x)+","+String(y)}
function connectorOutward(entrance){
  const x=BigInt(String(entrance?.x||"0")),y=BigInt(String(entrance?.y||"0"));
  switch(String(entrance?.side||"")){
    case "N":return Object.freeze({x:String(x),y:String(y-1n)});
    case "W":return Object.freeze({x:String(x-1n),y:String(y)});
    case "E":return Object.freeze({x:String(x+1n),y:String(y)});
    default:return Object.freeze({x:String(x),y:String(y+1n)});
  }
}
function connectorOrientation(previous,current,next){
  const cx=BigInt(String(current.x)),cy=BigInt(String(current.y));
  const points=[previous,next].filter(Boolean).map(point=>({
    dx:Number(BigInt(String(point.x))-cx),
    dy:Number(BigInt(String(point.y))-cy)
  }));
  const horizontal=points.some(point=>point.dx!==0);
  const vertical=points.some(point=>point.dy!==0);
  if(horizontal&&vertical)return "corner";
  if(horizontal)return "horizontal";
  if(vertical)return "vertical";
  return "terminal";
}
function connectorTile(seed,x,y){
  connectorTerrainChecks++;
  return TerrainFoundation.getTile(seed,String(x),String(y));
}
function connectorPassable(seed,x,y,targetKey){
  const key=connectorKey(x,y);
  if(key===targetKey)return true;
  const tile=connectorTile(seed,x,y);
  const type=String(tile?.type||"");
  if(!tile||tile.buildingId||CONNECTOR_BLOCKED_TERRAIN.has(type))return false;
  return true;
}
function findConnectorPath(seed,building){
  const entrance=building?.entrance||null,target=entrance?.target||null;
  if(!entrance||!target)return null;
  const start=connectorOutward(entrance);
  const targetKey=connectorKey(target.x,target.y);
  if(connectorKey(start.x,start.y)===targetKey)return Object.freeze([start]);
  const sx=BigInt(start.x),sy=BigInt(start.y),tx=BigInt(String(target.x)),ty=BigInt(String(target.y));
  const minX=(sx<tx?sx:tx)-3n,maxX=(sx>tx?sx:tx)+3n;
  const minY=(sy<ty?sy:ty)-3n,maxY=(sy>ty?sy:ty)+3n;
  const queue=[{x:sx,y:sy,dir:null,path:[Object.freeze({x:String(sx),y:String(sy)})]}];
  const visited=new Set([connectorKey(sx,sy)]);
  while(queue.length){
    const current=queue.shift();
    const key=connectorKey(current.x,current.y);
    if(key===targetKey)return Object.freeze(current.path);
    const neighbors=[
      {x:current.x+1n,y:current.y,dir:"E"},{x:current.x-1n,y:current.y,dir:"W"},
      {x:current.x,y:current.y+1n,dir:"S"},{x:current.x,y:current.y-1n,dir:"N"}
    ].filter(point=>point.x>=minX&&point.x<=maxX&&point.y>=minY&&point.y<=maxY);
    neighbors.sort((a,b)=>{
      const da=(a.x>tx?a.x-tx:tx-a.x)+(a.y>ty?a.y-ty:ty-a.y);
      const db=(b.x>tx?b.x-tx:tx-b.x)+(b.y>ty?b.y-ty:ty-b.y);
      if(da!==db)return da<db?-1:1;
      // Prefer staying on the current heading when multiple shortest steps are
      // available. This keeps short door connectors as one or two clean runs
      // instead of a hash-driven zig-zag staircase.
      const turnA=current.dir&&a.dir!==current.dir?1:0;
      const turnB=current.dir&&b.dir!==current.dir?1:0;
      if(turnA!==turnB)return turnA-turnB;
      const ah=presentationHash32(seed,String(a.x),String(a.y),"connector:"+building.id);
      const bh=presentationHash32(seed,String(b.x),String(b.y),"connector:"+building.id);
      return bh-ah;
    });
    for(const next of neighbors){
      const nextKey=connectorKey(next.x,next.y);
      if(visited.has(nextKey)||!connectorPassable(seed,next.x,next.y,targetKey))continue;
      visited.add(nextKey);
      queue.push({
        x:next.x,y:next.y,dir:next.dir,
        path:[...current.path,Object.freeze({x:String(next.x),y:String(next.y)})]
      });
      if(visited.size>160)break;
    }
    if(visited.size>160)break;
  }
  return null;
}
function routeConnectorPlan(seed){
  const cacheKey=String(seed||"");
  if(connectorCache.has(cacheKey))return connectorCache.get(cacheKey);
  const cells=[],routes=[],occupied=new Set();
  for(const building of buildingCatalog(seed)){
    if(building.enterable===false||!building.entrance?.target)continue;
    const path=findConnectorPath(seed,building);
    const target=building.entrance.target;
    const connected=Boolean(path?.length);
    const renderedCells=[];
    if(path){
      for(let i=0;i<path.length;i++){
        const point=path[i],key=connectorKey(point.x,point.y);
        const tile=connectorTile(seed,point.x,point.y);
        const type=String(tile?.type||"");
        if(CONNECTOR_ROUTE_TERRAIN.has(type))continue;
        const previous=i===0?{x:building.entrance.x,y:building.entrance.y}:path[i-1];
        const next=i+1<path.length?path[i+1]:target;
        if(occupied.has(key))continue;
        occupied.add(key);
        const descriptor=Object.freeze({
          id:"connector:"+building.id+":"+String(i).padStart(2,"0"),
          routeId:"connector:"+building.id,
          type:"door-connector",
          semantic:"connector-path",
          buildingId:String(building.id),
          buildingKind:String(building.kind||""),
          x:String(point.x),y:String(point.y),
          door:Object.freeze({x:String(building.entrance.x),y:String(building.entrance.y),side:String(building.entrance.side||"")}),
          target:Object.freeze({x:String(target.x),y:String(target.y)}),
          orientation:connectorOrientation(previous,point,next),
          sourceTerrain:type,
          routeSafe:Boolean(tile&&!tile.buildingId&&!CONNECTOR_BLOCKED_TERRAIN.has(type)),
          rendererOnly:true
        });
        cells.push(descriptor);
        renderedCells.push(descriptor.id);
      }
    }
    routes.push(Object.freeze({
      id:"connector:"+building.id,
      buildingId:String(building.id),
      buildingKind:String(building.kind||""),
      source:String(building.source||""),
      door:Object.freeze({x:String(building.entrance.x),y:String(building.entrance.y),side:String(building.entrance.side||"")}),
      target:Object.freeze({x:String(target.x),y:String(target.y)}),
      targetTerrain:String(connectorTile(seed,target.x,target.y)?.type||""),
      accessLengthTiles:Number(building.entrance.accessLengthTiles||0),
      connected,
      renderedCellCount:renderedCells.length,
      renderedCells:Object.freeze(renderedCells)
    }));
  }
  const result=Object.freeze({
    cells:Object.freeze(cells.sort((a,b)=>a.id.localeCompare(b.id))),
    routes:Object.freeze(routes.sort((a,b)=>a.id.localeCompare(b.id))),
    cellKeys:occupied,
    deterministic:true,
    rendererOnly:true,
    simulationAuthorityPreserved:true
  });
  connectorCache.set(cacheKey,result);
  return result;
}

function roadAdjacent(seed,x,y){
  const bx=BigInt(String(x)),by=BigInt(String(y));
  for(const [dx,dy] of [[1n,0n],[-1n,0n],[0n,1n],[0n,-1n]]){
    const tile=TerrainFoundation.getTile(seed,String(bx+dx),String(by+dy));
    if(["road","path","square"].includes(String(tile?.type||"")))return true;
  }
  return false;
}
function dressingCell(seed,x,y,building,semantic,used){
  const sx=String(x),sy=String(y),key=sx+","+sy;
  if(used.has(key))return null;
  const bx=BigInt(sx),by=BigInt(sy);
  const b=building.bounds||{};
  const minX=BigInt(String(b.minX)),maxX=BigInt(String(b.maxX));
  const minY=BigInt(String(b.minY)),maxY=BigInt(String(b.maxY));
  if(bx>=minX&&bx<=maxX&&by>=minY&&by<=maxY)return null;
  if(building.entrance){
    const ex=BigInt(String(building.entrance.x)),ey=BigInt(String(building.entrance.y));
    if((bx>ex?bx-ex:ex-bx)+(by>ey?by-ey:ey-by)<=2n)return null;
  }
  const tile=TerrainFoundation.getTile(seed,sx,sy);
  const type=String(tile?.type||"");
  if(!tile||tile.buildingId||DRESSING_BLOCKED_TERRAIN.has(type)||!DRESSING_ALLOWED_TERRAIN.has(type))return null;
  const local=window.StartingVillage?.local?.(seed,sx,sy)||null;
  if(local&&window.StartingVillage?.isRoadReserved?.(seed,local))return null;
  if(routeConnectorPlan(seed).cellKeys.has(key))return null;
  if((semantic==="garden"||semantic==="pen")&&!["grass","farmland","plot","dirt"].includes(type))return null;
  const needsRoadContext=semantic==="signpost"||semantic==="cart"||semantic==="barrel";
  const adjacentRoad=needsRoadContext?roadAdjacent(seed,sx,sy):false;
  return Object.freeze({x:sx,y:sy,type,roadAdjacent:adjacentRoad});
}
function dressingCandidates(seed,building,semantic,used){
  const b=building.bounds||{};
  const minX=BigInt(String(b.minX)),maxX=BigInt(String(b.maxX));
  const minY=BigInt(String(b.minY)),maxY=BigInt(String(b.maxY));
  const candidates=[];
  for(let ring=1;ring<=3;ring++){
    const r=BigInt(ring);
    for(let y=minY-r;y<=maxY+r;y++){
      for(let x=minX-r;x<=maxX+r;x++){
        if(x!==minX-r&&x!==maxX+r&&y!==minY-r&&y!==maxY+r)continue;
        const cell=dressingCell(seed,x,y,building,semantic,used);
        if(!cell)continue;
        const h=presentationHash32(seed,cell.x,cell.y,"dressing:"+building.id+":"+semantic);
        const roadPreference=(semantic==="signpost"||semantic==="cart"||semantic==="barrel")&&cell.roadAdjacent?0x100000000:0;
        candidates.push(Object.freeze({...cell,ring,score:roadPreference+h}));
      }
    }
  }
  candidates.sort((a,b)=>b.score-a.score||a.ring-b.ring||Number(BigInt(a.y)-BigInt(b.y))||Number(BigInt(a.x)-BigInt(b.x)));
  return candidates;
}
function semanticDressing(seed){
  const cacheKey=String(seed||"");
  if(dressingCache.has(cacheKey))return dressingCache.get(cacheKey);
  const used=new Set();
  const out=[];
  for(const building of buildingCatalog(seed)){
    const context=buildingDressingContext(building);
    const palette=DRESSING_CONTEXTS[context]||DRESSING_CONTEXTS.residential;
    const target=building.source==="special"?4:3;
    const shift=presentationHash32(seed,building.id,"0","dressing-palette")%palette.length;
    for(let i=0;i<target;i++){
      const semantic=palette[(i+shift)%palette.length];
      const candidates=dressingCandidates(seed,building,semantic,used);
      const selected=candidates[0];
      if(!selected)continue;
      const key=selected.x+","+selected.y;
      used.add(key);
      const h=presentationHash32(seed,selected.x,selected.y,"dressing-transform:"+semantic);
      out.push(Object.freeze({
        id:"dressing:"+building.id+":"+i+":"+semantic,
        type:"dressing",
        semantic,
        context,
        buildingId:String(building.id),
        x:selected.x,y:selected.y,
        sourceTerrain:selected.type,
        roadAdjacent:Boolean(selected.roadAdjacent),
        routeSafe:true,
        rotation:(h%4)*90,
        variant:(h>>>3)%3,
        presentationScore:h
      }));
    }
  }
  const result=Object.freeze(out.sort((a,b)=>a.id.localeCompare(b.id)));
  dressingCache.set(cacheKey,result);
  return result;
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
  return Object.freeze(buildingCatalog(seed).filter(item=>intersects(bounds,item.bounds)));
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
  const treeCandidates=[];
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
      if(cell.type==="forest"){
        treeCandidates.push(Object.freeze({
          cell,
          score:presentationHash32(seed,cell.x,cell.y,"tree-placement")
        }));
      }
      const sparseKind=sparseStaticKind(cell);
      const allowSparse=sparseKind==="rock"
        ?rockPresentationCount<2
        :Boolean(sparseKind&&otherPresentationCount<2);
      if(sparseKind&&allowSparse){
        staticObjects.push(Object.freeze({
          id:"static:"+cell.x+":"+cell.y+":"+sparseKind,
          type:sparseKind,x:cell.x,y:cell.y,sourceTerrain:cell.type
        }));
        if(sparseKind==="rock")rockPresentationCount++;
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

  // Tree descriptors are renderer-only presentation data. Choose a small,
  // deterministic, well-spaced subset from all forest cells instead of taking
  // the first row-major hash hits; this avoids diagonal/grid bands across
  // adjacent chunks while preserving bounded density and Simulation authority.
  const forestCellCount=treeCandidates.length;
  const treeTarget=forestCellCount?Math.min(3,Math.ceil(forestCellCount/64)):0;
  const rankedTrees=treeCandidates.slice().sort((a,b)=>b.score-a.score||a.cell.localY-b.cell.localY||a.cell.localX-b.cell.localX);
  const selectedTrees=[];
  const minTreeSeparationSq=20;
  for(const candidate of rankedTrees){
    if(selectedTrees.length>=treeTarget)break;
    const separated=selectedTrees.every(other=>{
      const dx=candidate.cell.localX-other.cell.localX,dy=candidate.cell.localY-other.cell.localY;
      return dx*dx+dy*dy>=minTreeSeparationSq;
    });
    if(separated)selectedTrees.push(candidate);
  }
  if(selectedTrees.length<treeTarget){
    for(const candidate of rankedTrees){
      if(selectedTrees.length>=treeTarget)break;
      if(!selectedTrees.includes(candidate))selectedTrees.push(candidate);
    }
  }
  for(const candidate of selectedTrees){
    const cell=candidate.cell;
    staticObjects.push(Object.freeze({
      id:"static:"+cell.x+":"+cell.y+":tree",
      type:"tree",x:cell.x,y:cell.y,sourceTerrain:cell.type,
      presentationScore:candidate.score
    }));
    treePresentationCount++;
  }

  const buildings=buildingReferences(seed,bounds);
  for(const building of buildings)buildingIds.add(building.id);
  const landmarkPlan=settlementLandmarkPlan(seed);
  const routeNetworkPlan=routeConnectorPlan(seed);
  const connectorDescriptors=routeNetworkPlan.cells.filter(item=>ownsCoordinate(item.x,item.y,spec.x,spec.y,size));
  const dressing=semanticDressing(seed).filter(item=>ownsCoordinate(item.x,item.y,spec.x,spec.y,size));
  for(const item of dressing)staticObjects.push(item);
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
        bounds:item.bounds,entrance:item.entrance||null,
        landmark:landmarkPlan&&landmarkPlan.buildingId===item.id?landmarkPlan:null
      }))),
      landmark:landmarkPlan?Object.freeze({
        ...landmarkPlan,
        ownedByChunk:ownedBuildings.some(item=>item.id===landmarkPlan.buildingId)
      }):null,
      propDescriptors:Object.freeze(staticObjects.map(item=>Object.freeze({
        id:item.id,type:item.type,x:item.x,y:item.y,sourceTerrain:item.sourceTerrain||null,
        semantic:item.semantic||null,context:item.context||null,buildingId:item.buildingId||null,
        roadAdjacent:Boolean(item.roadAdjacent),routeSafe:item.routeSafe!==false,
        rotation:Number(item.rotation||0),variant:Number(item.variant||0)
      }))),
      connectorDescriptors:Object.freeze(connectorDescriptors),
      routeNetwork:Object.freeze({
        connectorCellCount:connectorDescriptors.length,
        connectorRouteIds:Object.freeze([...new Set(connectorDescriptors.map(item=>item.routeId))].sort()),
        connectedRouteCount:routeNetworkPlan.routes.filter(item=>item.connected).length,
        totalRouteCount:routeNetworkPlan.routes.length,
        routeSafetyPass:connectorDescriptors.every(item=>item.routeSafe===true),
        deterministic:true,
        rendererOnly:true,
        simulationAuthorityPreserved:true
      }),
      dressing:Object.freeze({
        count:dressing.length,
        routeSafeCount:dressing.filter(item=>item.routeSafe!==false).length,
        contexts:Object.freeze(dressing.reduce((acc,item)=>{acc[item.context]=(acc[item.context]||0)+1;return acc;},{})),
        semantics:Object.freeze(dressing.reduce((acc,item)=>{acc[item.semantic]=(acc[item.semantic]||0)+1;return acc;},{})),
        deterministic:true,
        rendererOnly:true
      }),
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
const STREAMING_MINIMUM_STARTING_VILLAGE_DETAIL_RADIUS=64;
function streamingMinimumTileFromType(seed,underlying,x,y){
  const local=window.StartingVillage?.local?.(seed,x,y)||null;
  const infrastructure=local?StartingVillage.infrastructureAt(seed,local):null;
  const type=local
    ?(infrastructure
      ?StartingVillage.resolveInfrastructure(seed,local,infrastructure,underlying)
      :StartingVillage.resolveTerrain(seed,local,underlying))
    :underlying;
  const palette=TerrainPalette.get(type);
  return Object.freeze({
    x:String(x),y:String(y),type:String(type||"grass"),
    label:String(palette?.label||type||"Terrain"),
    color:String(palette?.color||"#6f8f45"),
    texture:TileTextures.asset(type),
    textureKey:TileTextures.assetKey(type),
    overlayTexture:null,overlayTextureKey:null,
    buildingId:null,room:null,specialKind:null,specialLabel:null,
    streamingMinimumFastPath:true,
    streamingMinimumWorkerType:true
  });
}
function streamingMinimumTile(seed,x,y){
  const local=window.StartingVillage?.local?.(seed,x,y)||null;
  const canUseFarFastPath=
    local&&Number(local.radius)>STREAMING_MINIMUM_STARTING_VILLAGE_DETAIL_RADIUS&&
    typeof window.GeographyFoundation?.getTerrainType==="function"&&
    typeof window.StartingVillage?.infrastructureAt==="function"&&
    typeof window.StartingVillage?.resolveInfrastructure==="function"&&
    typeof window.StartingVillage?.resolveTerrain==="function";
  if(!canUseFarFastPath)return TerrainFoundation.getTile(seed,x,y);

  const underlying=GeographyFoundation.getTerrainType(seed,x,y);
  const infrastructure=StartingVillage.infrastructureAt(seed,local);
  const type=infrastructure
    ?StartingVillage.resolveInfrastructure(seed,local,infrastructure,underlying)
    :StartingVillage.resolveTerrain(seed,local,underlying);
  const palette=TerrainPalette.get(type);
  return Object.freeze({
    x:String(x),y:String(y),type:String(type||"grass"),
    label:String(palette?.label||type||"Terrain"),
    color:String(palette?.color||"#6f8f45"),
    texture:TileTextures.asset(type),
    textureKey:TileTextures.assetKey(type),
    overlayTexture:null,overlayTextureKey:null,
    buildingId:null,room:null,specialKind:null,specialLabel:null,
    streamingMinimumFastPath:true
  });
}

function prepareMinimumStep(spec,state=null,maxCells=8){
  const key=signatureFor(spec);
  const existing=cache.get(key);
  const seed=String(spec.seed||"");
  const size=Math.max(1,Number(spec.chunkSize)||16);
  const fullCellCount=size*size;
  const requestedIndices=[...new Set((Array.isArray(spec?.requiredCellIndices)?spec.requiredCellIndices:[])
    .map(Number).filter(index=>Number.isInteger(index)&&index>=0&&index<fullCellCount))].sort((a,b)=>a-b);
  const requested=requestedIndices.length?requestedIndices:Array.from({length:fullCellCount},(_,index)=>index);
  const existingSnapshot=existing?.snapshot?.complete?existing.snapshot:null;
  const missingIndices=existingSnapshot
    ?requested.filter(index=>!existingSnapshot.cells?.[index])
    :requested;
  if(existingSnapshot&&missingIndices.length===0){
    cacheHits++;existing.touches++;existing.lastUsed=performance.now();
    const prepared=Number(existingSnapshot.streamingMinimumPreparedCellCount||existingSnapshot.cells?.filter?.(Boolean)?.length||existingSnapshot.cells?.length||0);
    return Object.freeze({pending:false,data:existingSnapshot,completed:requested.length,total:requested.length,percent:100,cached:true,prepared});
  }
  let work=state;
  if(!work||work.key!==key){
    const bounds=boundsFor(spec.x,spec.y,size);
    const cells=existingSnapshot?Array.from(existingSnapshot.cells||[]):new Array(fullCellCount);
    cells.length=fullCellCount;
    work={
      key,seed,size,bounds,indices:Object.freeze(missingIndices.slice()),
      minX:BigInt(bounds.minX),minY:BigInt(bounds.minY),
      cursor:0,cells,
      surfaceCounts:{...(existingSnapshot?.terrain?.surfaceCounts||{})},
      textureKeys:new Set(existingSnapshot?.terrain?.textureKeys||[]),
      overlayTextureKeys:new Set(existingSnapshot?.terrain?.overlayTextureKeys||[]),
      buildingIds:new Set(existingSnapshot?.buildingIds||[]),
      walkableCount:Number(existingSnapshot?.terrain?.walkableCount||0),
      blockedCount:Number(existingSnapshot?.terrain?.blockedCount||0),
      startedAt:performance.now(),
      workerStatus:"idle",workerTypes:null,workerJobId:null,workerError:null
    };
    if(!dispatchTerrainWorker(work)){
      work.workerStatus="fallback";
      terrainWorkerFallbacks++;
    }
  }
  const total=work.indices.length;
  if(work.workerStatus==="cancelled"){
    return Object.freeze({
      pending:true,state:work,completed:work.cursor,total,percent:Math.min(99,Math.floor(work.cursor/Math.max(1,total)*100)),
      sliceMs:0,workerPending:false,workerCancelled:true
    });
  }
  if(work.workerStatus==="pending"){
    return Object.freeze({
      pending:true,state:work,completed:work.cursor,total,percent:Math.min(99,Math.floor(work.cursor/Math.max(1,total)*100)),
      sliceMs:0,workerPending:true,workerJobId:work.workerJobId
    });
  }
  const slice=Math.max(1,Math.min(32,Number(maxCells)||16));
  const sliceStarted=performance.now();
  let processed=0;
  while(work.cursor<total&&processed<slice){
    const index=work.indices[work.cursor];
    const localY=Math.floor(index/size),localX=index-localY*size;
    const x=String(work.minX+BigInt(localX)),y=String(work.minY+BigInt(localY));
    const workerType=work.workerStatus==="ready"?work.workerTypes?.get(index):null;
    const tile=workerType
      ?streamingMinimumTileFromType(seed,workerType,x,y)
      :streamingMinimumTile(seed,x,y);
    if(!workerType)terrainFoundationCalls++;
    const movement=Walkability.classifyPrepared
      ?Walkability.classifyPrepared(seed,tile)
      :Walkability.classify(seed,x,y);
    walkabilityClassifications++;
    if(movement?.walkable)work.walkableCount++;else work.blockedCount++;
    const cell=freezeTile(tile,movement,localX,localY);
    work.cells[index]=cell;
    work.surfaceCounts[cell.type]=(work.surfaceCounts[cell.type]||0)+1;
    if(cell.textureKey)work.textureKeys.add(cell.textureKey);
    if(cell.overlayTextureKey)work.overlayTextureKeys.add(cell.overlayTextureKey);
    if(cell.buildingId)work.buildingIds.add(cell.buildingId);
    work.cursor++;processed++;
    // Budget by real elapsed work, not an arbitrary fixed cell count. A single
    // expensive authoritative cell may exceed the target, but a second one is
    // never started in the same paint slice after the budget is consumed.
    if(processed>=1&&performance.now()-sliceStarted>=4)break;
  }
  if(work.cursor<total){
    return Object.freeze({
      pending:true,state:work,completed:work.cursor,total,
      percent:Math.min(99,Math.floor(work.cursor/total*100)),
      sliceMs:Number((performance.now()-sliceStarted).toFixed(3))
    });
  }

  const elapsed=performance.now()-work.startedAt;
  totalGenerationMs+=elapsed;maxGenerationMs=Math.max(maxGenerationMs,elapsed);
  completeChunkGenerations++;
  if(spec.state==="Active")activeGenerations++;
  else if(spec.state==="Prepared")preparedGenerations++;
  else otherGenerations++;

  const emptyList=Object.freeze([]);
  const preparedCellCount=work.cells.reduce((count,cell)=>count+(cell?1:0),0);
  const snapshot=Object.freeze({
    key,version:VERSION,seed,
    chunkX:Number(spec.x),chunkY:Number(spec.y),chunkSize:size,
    bounds:work.bounds,complete:true,streamingMinimum:true,
    streamingMinimumSparse:preparedCellCount<fullCellCount,
    streamingMinimumPreparedCellCount:preparedCellCount,
    cells:Object.freeze(work.cells),
    terrain:Object.freeze({
      surfaceCounts:Object.freeze({...work.surfaceCounts}),
      textureKeys:Object.freeze([...work.textureKeys].sort()),
      overlayTextureKeys:Object.freeze([...work.overlayTextureKeys].sort()),
      walkableCount:work.walkableCount,blockedCount:work.blockedCount
    }),
    buildingIds:Object.freeze([...work.buildingIds].sort()),
    buildings:emptyList,
    staticObjects:emptyList,
    presentation:Object.freeze({
      terrainMeshRequired:true,
      source:"seed-chunk-world-data",
      buildingDescriptors:emptyList,
      landmark:null,
      propDescriptors:emptyList,
      connectorDescriptors:emptyList,
      routeNetwork:Object.freeze({
        connectorCellCount:0,connectorRouteIds:emptyList,connectedRouteCount:0,totalRouteCount:0,
        routeSafetyPass:true,deterministic:true,rendererOnly:true,simulationAuthorityPreserved:true
      }),
      dressing:Object.freeze({
        count:0,routeSafeCount:0,contexts:Object.freeze({}),semantics:Object.freeze({}),
        deterministic:true,rendererOnly:true
      }),
      interiorObjectDescriptors:emptyList,
      hardCodedSampleGeometry:false,
      streamingMinimum:true
    }),
    generationMs:Number(elapsed.toFixed(3)),
    generatedTerrainCalls:total,
    generatedWalkabilityClassifications:total,
    terrainWorkerUsed:work.workerStatus==="ready",
    terrainWorkerJobId:work.workerJobId,
    terrainWorkerError:work.workerError,
    simulationAuthorityPreserved:true
  });
  cache.set(key,{snapshot,lastUsed:performance.now(),touches:0});
  everGenerated.add(key);
  lastGeneratedIds=Object.freeze([key,...lastGeneratedIds].slice(0,12));
  return Object.freeze({pending:false,data:snapshot,completed:total,total,percent:100,cached:false,sliceMs:Number((performance.now()-sliceStarted).toFixed(3))});
}
function getOrCreate(spec){
  const key=signatureFor(spec);
  const existing=cache.get(key);
  if(existing){
    const wantsFull=String(spec?.streamingProfile||"full")!=="minimum";
    if(existing.snapshot?.streamingMinimum&&wantsFull){
      cacheMisses++;
      regenerationCount++;
      const snapshot=generate(spec);
      everGenerated.add(key);
      return snapshot;
    }
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
function release(key,expectedSnapshot=null){
  const id=String(key||"");
  const entry=cache.get(id);
  if(!entry)return false;
  // A sparse resource can be replaced while a newer expanded snapshot already
  // owns the same logical key. Never let destruction of the old mesh evict the
  // newer cache record.
  if(expectedSnapshot&&entry.snapshot!==expectedSnapshot)return false;
  cache.delete(id);
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
  let presentationBuildingCount=0,presentationPropCount=0,presentationInteriorObjectCount=0,presentationDressingCount=0,dressingRouteSafeCount=0,presentationConnectorCount=0,connectorRouteSafeCount=0,roadCellCount=0,waterCellCount=0,bridgeCellCount=0;
  const dressingContexts={},dressingSemantics={},connectorRouteIds=new Set();
  for(const entry of cache.values()){
    const snapshot=entry.snapshot;
    surfaceCellCount+=Number(snapshot?.cells?.length||0);
    buildingReferenceCount+=Number(snapshot?.buildings?.length||0);
    staticObjectReferenceCount+=Number(snapshot?.staticObjects?.length||0);
    presentationBuildingCount+=Number(snapshot?.presentation?.buildingDescriptors?.length||0);
    presentationPropCount+=Number(snapshot?.presentation?.propDescriptors?.length||0);
    presentationInteriorObjectCount+=Number(snapshot?.presentation?.interiorObjectDescriptors?.length||0);
    presentationDressingCount+=Number(snapshot?.presentation?.dressing?.count||0);
    dressingRouteSafeCount+=Number(snapshot?.presentation?.dressing?.routeSafeCount||0);
    presentationConnectorCount+=Number(snapshot?.presentation?.routeNetwork?.connectorCellCount||0);
    connectorRouteSafeCount+=Number(snapshot?.presentation?.connectorDescriptors?.filter?.(item=>item?.routeSafe!==false)?.length||0);
    for(const id of snapshot?.presentation?.routeNetwork?.connectorRouteIds||[])connectorRouteIds.add(String(id));
    for(const [key,value] of Object.entries(snapshot?.presentation?.dressing?.contexts||{}))dressingContexts[key]=(dressingContexts[key]||0)+Number(value||0);
    for(const [key,value] of Object.entries(snapshot?.presentation?.dressing?.semantics||{}))dressingSemantics[key]=(dressingSemantics[key]||0)+Number(value||0);
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
    presentationDressingCount,dressingRouteSafeCount,
    presentationConnectorCount,connectorRouteSafeCount,
    connectorRouteCount:connectorRouteIds.size,
    connectorRouteIds:Object.freeze([...connectorRouteIds].sort()),
    connectorRouteSafetyPass:presentationConnectorCount===connectorRouteSafeCount,
    connectorPlanCacheEntries:connectorCache.size,
    connectorTerrainChecks,
    connectorDeterministic:true,
    connectorRendererOnly:true,
    dressingContexts:Object.freeze({...dressingContexts}),
    dressingSemantics:Object.freeze({...dressingSemantics}),
    dressingDeterministic:true,
    dressingRendererOnly:true,
    dressingPlanCacheEntries:dressingCache.size,
    landmarkPlanCacheEntries:landmarkCache.size,
    landmarkDeterministic:true,
    landmarkRendererOnly:true,
    roadCellCount,waterCellCount,bridgeCellCount,
    cacheHits,cacheMisses,
    completeChunkGenerations,
    uniqueGeneratedChunkCount:everGenerated.size,
    regenerationCount,
    activeGenerations,preparedGenerations,otherGenerations,
    releases,
    terrainFoundationCalls,
    walkabilityClassifications,
    terrainWorkerRequests,terrainWorkerCompletions,terrainWorkerCancellations,
    terrainWorkerErrors,terrainWorkerCells,terrainWorkerFallbacks,
    terrainWorkerPending:terrainWorkerJobs.size,
    totalTerrainWorkerMs:Number(totalTerrainWorkerMs.toFixed(3)),
    maxTerrainWorkerMs:Number(maxTerrainWorkerMs.toFixed(3)),
    averageTerrainWorkerMs:Number((terrainWorkerCompletions?totalTerrainWorkerMs/terrainWorkerCompletions:0).toFixed(3)),
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
  cancelMinimumPreparation("clear");
  cache.clear();
  dressingCache.clear();
  connectorCache.clear();
  landmarkCache.clear();
  everGenerated.clear();
  regenerationCount=0;
}
window.PlayCanvasChunkWorldData=Object.freeze({
  version:VERSION,
  getOrCreate,prepareMinimumStep,cancelMinimumPreparation,touch,release,collectView,stats,clear,signatureFor,landmarkPlan:settlementLandmarkPlan
});
})();