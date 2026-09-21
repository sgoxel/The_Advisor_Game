(function(){
"use strict";

const CORE_RADIUS_TILES=26;
const PUBLIC_HALF_SIZE=3;
const RING_RADIUS_TILES=14;
const GATEWAY_MAINLAND_EDGE_TILES=29;
const GATEWAY_ROAD_WIDTH_TILES=3;
const SECONDARY_PATH_WIDTH_TILES=1;

const DIRECTIONS=Object.freeze([
  Object.freeze({name:"East",dx:1,dy:0}),
  Object.freeze({name:"South",dx:0,dy:1}),
  Object.freeze({name:"West",dx:-1,dy:0}),
  Object.freeze({name:"North",dx:0,dy:-1})
]);

const TARGET_PLOT_COUNT=6;
const PLOT_WIDTH=6;
const PLOT_HEIGHT=5;
const plotPlanCache=new Map();


function unit(seed,key){return PRNG.foundationUint32(seed,key)/4294967296}
function toNumber(value){
  const n=Number(WorldCoordinates.normalize(value));
  return Number.isSafeInteger(n)?n:null;
}
function direction(seed){
  return DIRECTIONS[PRNG.foundationUint32(seed,"starting-village:gateway-direction")%DIRECTIONS.length];
}
function phase(seed,key){return unit(seed,"starting-village:phase:"+key)*Math.PI*2}
function boundaryRadius(seed,theta){
  return CORE_RADIUS_TILES+
    Math.sin(theta*3+phase(seed,"3"))*2.8+
    Math.sin(theta*5+phase(seed,"5"))*1.8+
    Math.sin(theta*7+phase(seed,"7"))*1.0;
}
function local(seed,xValue,yValue){
  const x=toNumber(xValue),y=toNumber(yValue);
  if(x==null||y==null)return null;
  const dir=direction(seed);
  return Object.freeze({
    x,y,dir,
    forward:x*dir.dx+y*dir.dy,
    lateral:-x*dir.dy+y*dir.dx,
    radius:Math.hypot(x,y),
    theta:Math.atan2(y,x)
  });
}
function gatewayCenterOffset(seed,forward){
  const a=phase(seed,"gateway-a");
  const b=phase(seed,"gateway-b");
  const raw=
    Math.sin(forward/9+a)*1.8+
    Math.sin(forward/17+b)*1.2;
  const zero=Math.sin(a)*1.8+Math.sin(b)*1.2;
  return Math.round(raw-zero);
}
function gatewayBridge(seed,forward){
  const length=4+(PRNG.foundationUint32(seed,"starting-village:bridge-length")%5); // 4..8 tiles
  const start=20+(PRNG.foundationUint32(seed,"starting-village:bridge-start")%4);
  return Object.freeze({start,length,end:start+length-1,active:forward>=start&&forward<start+length});
}
function isVillageLand(seed,l){
  if(!l)return false;
  return l.radius<=boundaryRadius(seed,l.theta);
}
function isMainlandLand(seed,l){
  if(!l)return false;
  const wave=Math.sin(l.lateral/10+phase(seed,"mainland-edge"))*2.2;
  const edge=GATEWAY_MAINLAND_EDGE_TILES+Math.abs(l.lateral)*0.12+wave;
  return l.forward>=edge;
}
function isGatewayShoulder(seed,l){
  if(!l||l.forward<10)return false;
  const center=gatewayCenterOffset(seed,l.forward);
  const bridge=gatewayBridge(seed,l.forward);
  if(bridge.active)return false;
  return Math.abs(l.lateral-center)<=Math.ceil(GATEWAY_ROAD_WIDTH_TILES/2)+1;
}
function isPublicSquare(l){
  return !!l&&Math.abs(l.x)<=PUBLIC_HALF_SIZE&&Math.abs(l.y)<=PUBLIC_HALF_SIZE;
}
function isMainRoad(seed,l){
  if(!l)return false;
  const ring=Math.abs(l.radius-RING_RADIUS_TILES)<=1.15;
  const centerAvenue=(Math.abs(l.x)<=1&&Math.abs(l.y)<=RING_RADIUS_TILES+1)||
    (Math.abs(l.y)<=1&&Math.abs(l.x)<=RING_RADIUS_TILES+1);
  if(ring||centerAvenue)return true;

  if(l.forward>=0){
    const center=gatewayCenterOffset(seed,l.forward);
    const half=l.forward<=18?1:0;
    return Math.abs(l.lateral-center)<=half;
  }
  return false;
}
function isBridge(seed,l,underlying){
  if(!l||underlying!=="water"||l.forward<0)return false;
  const bridge=gatewayBridge(seed,l.forward);
  const center=gatewayCenterOffset(seed,l.forward);
  return bridge.active&&Math.abs(l.lateral-center)<=1;
}
function isRoadReserved(seed,l){
  if(!l)return false;
  return isPublicSquare(l)||isMainRoad(seed,l)||isSecondaryPath(seed,l);
}

function infrastructureAt(seed,l){
  if(!l)return null;
  if(isPublicSquare(l))return Object.freeze({phase:"roads",type:"square",kind:"public-square"});
  if(isMainRoad(seed,l))return Object.freeze({phase:"roads",type:"road",kind:"main-road"});
  if(isSecondaryPath(seed,l))return Object.freeze({phase:"roads",type:"path",kind:"local-path"});
  return null;
}

function plotBounds(cx,cy,w,h){
  const minX=cx-Math.floor(w/2);
  const minY=cy-Math.floor(h/2);
  return Object.freeze({
    minX,minY,
    maxX:minX+w-1,
    maxY:minY+h-1,
    w,h
  });
}

function boundsOverlap(a,b,padding){
  const p=padding||0;
  return !(
    a.maxX+p<b.minX||
    b.maxX+p<a.minX||
    a.maxY+p<b.minY||
    b.maxY+p<a.minY
  );
}

function plotCandidateValid(seed,bounds,accepted){
  let roadAdjacent=false;

  for(let y=bounds.minY-1;y<=bounds.maxY+1;y++){
    for(let x=bounds.minX-1;x<=bounds.maxX+1;x++){
      const l=local(seed,String(x),String(y));
      if(!l)return false;

      const inside=
        x>=bounds.minX&&x<=bounds.maxX&&
        y>=bounds.minY&&y<=bounds.maxY;

      if(inside){
        if(!isVillageLand(seed,l))return false;
        if(isRoadReserved(seed,l))return false;
      }else if(isRoadReserved(seed,l)){
        roadAdjacent=true;
      }
    }
  }

  if(!roadAdjacent)return false;
  for(const plot of accepted){
    if(boundsOverlap(bounds,plot.bounds,1))return false;
  }
  return true;
}

function buildPlots(seed){
  if(plotPlanCache.has(seed))return plotPlanCache.get(seed);

  const candidates=[];
  for(let y=-11;y<=11;y++){
    for(let x=-11;x<=11;x++){
      if(Math.abs(x)<4||Math.abs(y)<4)continue;
      const score=PRNG.foundationUint32(seed,"starting-village:plot-candidate:"+x+":"+y);
      candidates.push({x,y,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);

  const accepted=[];
  for(const candidate of candidates){
    if(accepted.length>=TARGET_PLOT_COUNT)break;
    const rotate=(PRNG.foundationUint32(
      seed,
      "starting-village:plot-rotate:"+candidate.x+":"+candidate.y
    )&1)===1;
    const w=rotate?PLOT_HEIGHT:PLOT_WIDTH;
    const h=rotate?PLOT_WIDTH:PLOT_HEIGHT;
    const bounds=plotBounds(candidate.x,candidate.y,w,h);
    if(!plotCandidateValid(seed,bounds,accepted))continue;

    accepted.push(Object.freeze({
      id:"P"+(accepted.length+1),
      cx:candidate.x,
      cy:candidate.y,
      w,h,
      bounds,
      phase:"buildings"
    }));
  }

  const frozen=Object.freeze(accepted.slice());
  plotPlanCache.set(seed,frozen);
  return frozen;
}

function plotAt(seed,l){
  if(!l)return null;
  for(const plot of buildPlots(seed)){
    const b=plot.bounds;
    if(l.x>=b.minX&&l.x<=b.maxX&&l.y>=b.minY&&l.y<=b.maxY)return plot;
  }
  return null;
}

function buildingAt(seed,l){
  const plot=plotAt(seed,l);
  return plot?Object.freeze({phase:"buildings",type:"plot",plot}):null;
}

function importantObjectAt(seed,l){
  // Reserved architectural phase. Future wells, monuments, market objects,
  // gates and other important objects must consult road + building reservations.
  void seed;
  void l;
  return null;
}

function isSecondaryPath(seed,l){
  if(!l||!isVillageLand(seed,l))return false;
  // Short connectors from plot rows/columns to the nearest central avenue.
  const horizontal=(Math.abs(l.y-7)<=0&&Math.abs(l.x)<=5)||
    (Math.abs(l.y+7)<=0&&Math.abs(l.x)<=5);
  const vertical=(Math.abs(l.x)<=0&&((l.y>=4&&l.y<=7)||(l.y<=-4&&l.y>=-7)));
  return horizontal||vertical;
}
function farmParcel(seed,l){
  if(!l||!isVillageLand(seed,l))return false;
  if(l.radius<18||l.radius>boundaryRadius(seed,l.theta)-1)return false;
  return unit(seed,"starting-village:farm:"+Math.floor(l.x/3)+":"+Math.floor(l.y/3))>0.45;
}

function resolveInfrastructure(seed,l,infrastructure,underlying){
  if(!infrastructure)return null;
  if(infrastructure.type==="road"&&isBridge(seed,l,underlying))return "bridge";
  return infrastructure.type;
}

function resolveTerrain(seed,l,underlying){
  if(!l)return underlying;
  const villageLand=isVillageLand(seed,l);
  const mainland=isMainlandLand(seed,l);
  const shoulder=isGatewayShoulder(seed,l);

  if(farmParcel(seed,l))return "farmland";

  if((villageLand||mainland||shoulder)&&underlying==="water"){
    return unit(seed,"starting-village:land:"+l.x+":"+l.y)>0.72?"dirt":"grass";
  }
  return underlying;
}

function getType(seed,x,y,underlying){
  const l=local(seed,x,y);
  if(!l)return underlying;

  // AUTHORITATIVE WORLD-PLANNING ORDER:
  // 1) Roads/public infrastructure
  // 2) Buildings/plots
  // 3) Important objects
  // 4) Terrain/background fill
  const infrastructure=infrastructureAt(seed,l);
  const building=buildingAt(seed,l);
  const importantObject=importantObjectAt(seed,l);

  if(infrastructure)return resolveInfrastructure(seed,l,infrastructure,underlying);
  if(building)return building.type;
  if(importantObject)return importantObject.type;
  return resolveTerrain(seed,l,underlying);
}

function plan(seed){
  const dir=direction(seed);
  const bridge=gatewayBridge(seed,0);
  return Object.freeze({
    name:"Starting Village",
    center:Object.freeze({x:"0",y:"0"}),
    tileMeters:WorldStandards.TILE_METERS,
    approximateCoreDiameterMeters:CORE_RADIUS_TILES*2*WorldStandards.TILE_METERS,
    gatewayDirection:dir.name,
    publicSquareMeters:(PUBLIC_HALF_SIZE*2+1)*WorldStandards.TILE_METERS,
    ringRoadRadiusMeters:RING_RADIUS_TILES*WorldStandards.TILE_METERS,
    plotCount:buildPlots(seed).length,
    gatewayMainlandEdgeMeters:GATEWAY_MAINLAND_EDGE_TILES*WorldStandards.TILE_METERS,
    bridgeWindow:Object.freeze({
      startTiles:bridge.start,
      lengthTiles:bridge.length,
      lengthMeters:bridge.length*WorldStandards.TILE_METERS
    })
  });
}

function proof(seed){
  const first=plan(seed);
  const second=plan(seed);
  const dir=direction(seed);
  let roadGapCount=0;
  let mainlandLandSamples=0;
  let mainlandSamples=0;
  let maxBridgeRun=0;
  let currentBridgeRun=0;

  for(let forward=0;forward<=55;forward++){
    const center=gatewayCenterOffset(seed,forward);
    const x=forward*dir.dx-center*dir.dy;
    const y=forward*dir.dy+center*dir.dx;
    const underlying=GeographyFoundation.getTerrainType(seed,String(x),String(y));
    const type=getType(seed,String(x),String(y),underlying);
    if(type!=="road"&&type!=="bridge"&&type!=="square")roadGapCount++;
    if(type==="bridge"){
      currentBridgeRun++;
      maxBridgeRun=Math.max(maxBridgeRun,currentBridgeRun);
    }else currentBridgeRun=0;
  }

  for(let forward=32;forward<=48;forward+=4){
    for(let lateral=-16;lateral<=16;lateral+=4){
      const x=forward*dir.dx-lateral*dir.dy;
      const y=forward*dir.dy+lateral*dir.dx;
      const l=local(seed,String(x),String(y));
      mainlandSamples++;
      if(isMainlandLand(seed,l))mainlandLandSamples++;
    }
  }

  let plotRoadOverlapCount=0;
  let plotSquareOverlapCount=0;
  let plotPathOverlapCount=0;
  for(const plot of buildPlots(seed)){
    const b=plot.bounds;
    for(let y=b.minY;y<=b.maxY;y++){
      for(let x=b.minX;x<=b.maxX;x++){
        const l=local(seed,String(x),String(y));
        if(isPublicSquare(l))plotSquareOverlapCount++;
        if(isMainRoad(seed,l))plotRoadOverlapCount++;
        if(isSecondaryPath(seed,l))plotPathOverlapCount++;
      }
    }
  }

  const bridgeMeters=maxBridgeRun*WorldStandards.TILE_METERS;
  const bridgeMinutes=WorldStandards.walkMinutes(bridgeMeters,WorldStandards.WALK_SPEED_KMH.bridge);

  return Object.freeze({
    deterministic:JSON.stringify(first)===JSON.stringify(second),
    originInsideVillage:isVillageLand(seed,local(seed,"0","0")),
    plotCount:first.plotCount,
    planningOrder:Object.freeze(["roads","buildings","important-objects","terrain"]),
    plotRoadOverlapCount,
    plotSquareOverlapCount,
    plotPathOverlapCount,
    buildingReservationPass:
      first.plotCount===TARGET_PLOT_COUNT&&
      plotRoadOverlapCount===0&&
      plotSquareOverlapCount===0&&
      plotPathOverlapCount===0,
    roadGapCount,
    mainlandConnected:roadGapCount===0&&mainlandLandSamples>0,
    mainlandLandSamples,
    mainlandSamples,
    maxBridgeTiles:maxBridgeRun,
    maxBridgeMeters:bridgeMeters,
    maxBridgeMinutes:bridgeMinutes,
    bridgePass:maxBridgeRun<=WorldStandards.MAX_RURAL_BRIDGE_TILES&&bridgeMinutes<=WorldStandards.MAX_BRIDGE_WALK_MINUTES,
    gatewayDirection:first.gatewayDirection,
    plan:first
  });
}

window.StartingVillage=Object.freeze({
  CORE_RADIUS_TILES,PUBLIC_HALF_SIZE,RING_RADIUS_TILES,
  GATEWAY_MAINLAND_EDGE_TILES,GATEWAY_ROAD_WIDTH_TILES,SECONDARY_PATH_WIDTH_TILES,
  direction,local,getType,plan,proof,
  infrastructureAt,buildingAt,importantObjectAt,resolveInfrastructure,resolveTerrain,
  buildPlots,plotAt,isRoadReserved
});
})();
