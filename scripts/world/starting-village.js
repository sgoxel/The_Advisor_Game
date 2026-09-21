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

const BASE_PLOTS=Object.freeze([
  Object.freeze({id:"P1",cx:8,cy:7,w:6,h:5}),
  Object.freeze({id:"P2",cx:-8,cy:7,w:6,h:5}),
  Object.freeze({id:"P3",cx:8,cy:-7,w:6,h:5}),
  Object.freeze({id:"P4",cx:-8,cy:-7,w:6,h:5}),
  Object.freeze({id:"P5",cx:0,cy:10,w:7,h:4}),
  Object.freeze({id:"P6",cx:0,cy:-10,w:7,h:4})
]);

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
function plotAt(l){
  if(!l)return null;
  for(const plot of BASE_PLOTS){
    const minX=plot.cx-Math.floor(plot.w/2);
    const maxX=minX+plot.w-1;
    const minY=plot.cy-Math.floor(plot.h/2);
    const maxY=minY+plot.h-1;
    if(l.x>=minX&&l.x<=maxX&&l.y>=minY&&l.y<=maxY)return plot;
  }
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

function getType(seed,x,y,underlying){
  const l=local(seed,x,y);
  if(!l)return underlying;

  const villageLand=isVillageLand(seed,l);
  const mainland=isMainlandLand(seed,l);
  const shoulder=isGatewayShoulder(seed,l);

  // Short approved bridge keeps water beneath; otherwise the gateway road/causeway
  // and its shoulders are guaranteed land so the Starting Village cannot be isolated.
  if(isBridge(seed,l,underlying))return "bridge";

  if(isPublicSquare(l))return "square";
  if(isMainRoad(seed,l))return "road";

  const plot=plotAt(l);
  if(plot&&villageLand)return "plot";
  if(villageLand&&isSecondaryPath(seed,l))return "path";
  if(farmParcel(seed,l))return "farmland";

  if((villageLand||mainland||shoulder)&&underlying==="water"){
    return unit(seed,"starting-village:land:"+l.x+":"+l.y)>0.72?"dirt":"grass";
  }

  return underlying;
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
    plotCount:BASE_PLOTS.length,
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
    if(type!=="road"&&type!=="bridge")roadGapCount++;
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

  const bridgeMeters=maxBridgeRun*WorldStandards.TILE_METERS;
  const bridgeMinutes=WorldStandards.walkMinutes(bridgeMeters,WorldStandards.WALK_SPEED_KMH.bridge);

  return Object.freeze({
    deterministic:JSON.stringify(first)===JSON.stringify(second),
    originInsideVillage:isVillageLand(seed,local(seed,"0","0")),
    plotCount:first.plotCount,
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
  direction,local,getType,plan,proof,plotAt
});
})();
