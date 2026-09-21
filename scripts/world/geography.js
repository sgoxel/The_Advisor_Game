(function(){
"use strict";

const TILE_METERS=100;
const VILLAGE_CELL_SIZE=72;
const VILLAGE_JITTER=8;
const MIN_VILLAGE_WALK_MINUTES=60;
const MAX_WALK_SPEED_KMH=5.5;
const MAIN_ROAD_WALK_SPEED_KMH=5.5;
const MAX_BRIDGE_WALK_MINUTES=10;
const MAX_BRIDGE_TILES=Math.floor((MAIN_ROAD_WALK_SPEED_KMH*1000/60*MAX_BRIDGE_WALK_MINUTES)/TILE_METERS);
const MAIN_ROAD_WAVE_SCALE=32;
const MAIN_ROAD_WAVE_AMPLITUDE=8;
const BRIDGE_BLOCK_SIZE=24;
const ROAD_WIDTH_POLICY=Object.freeze({
  capital:10,
  city:6,
  town:4,
  village:3,
  wilderness:2,
  rough:1,
  bridge:2
});

const NAME_START=["Alder","Ash","Black","Bright","Cedar","Dawn","Elder","Falcon","Green","Grey","High","Iron","Kings","Lake","North","Oak","Raven","Red","River","Silver","Stone","Sun","Thorn","West","White","Wolf"];
const NAME_END=["barrow","bridge","brook","dale","fall","field","ford","gate","haven","hold","keep","mere","moor","port","reach","ridge","stead","ton","vale","watch","wick","wood"];
const STREET_WORDS=["Market","Mill","River","Oak","Chapel","Smith","North","South","East","West","Gate","Stone","Field","Bridge"];
const AVENUE_WORDS=["King's","Old Road","High","River","Trade","Castle","Market","Pilgrim","Forest"];

function toBig(value){return BigInt(WorldCoordinates.normalize(value))}
function floorDiv(value,divisor){
  let q=value/divisor;
  const r=value%divisor;
  if(r!==0n&&value<0n)q-=1n;
  return q;
}
function absBig(v){return v<0n?-v:v}
function unit(seed,key){return PRNG.foundationUint32(seed,key)/4294967296}
function pick(seed,key,list){return list[PRNG.foundationUint32(seed,key)%list.length]}
function integer(seed,key,min,max){
  const span=max-min+1;
  return min+(PRNG.foundationUint32(seed,key)%span);
}
function generatedName(seed,key,suffix){
  const a=pick(seed,key+":a",NAME_START);
  const b=pick(seed,key+":b",NAME_END);
  return a+b+(suffix?" "+suffix:"");
}
function cellKey(cx,cy){return cx.toString()+":"+cy.toString()}

function villageCellFor(x,y){
  return Object.freeze({
    x:floorDiv(toBig(x),BigInt(VILLAGE_CELL_SIZE)),
    y:floorDiv(toBig(y),BigInt(VILLAGE_CELL_SIZE))
  });
}
function hasVillage(seed,cx,cy){
  if(cx===0n&&cy===0n)return true;
  return unit(seed,"village:presence:"+cellKey(cx,cy))<0.58;
}
function villageCenter(seed,cx,cy){
  if(cx===0n&&cy===0n){
    return Object.freeze({x:"0",y:"0",cellX:"0",cellY:"0",name:generatedName(seed,"village:0:0","Village")});
  }
  const key=cellKey(cx,cy);
  const jx=BigInt(integer(seed,"village:jx:"+key,-VILLAGE_JITTER,VILLAGE_JITTER));
  const jy=BigInt(integer(seed,"village:jy:"+key,-VILLAGE_JITTER,VILLAGE_JITTER));
  const x=cx*BigInt(VILLAGE_CELL_SIZE)+jx;
  const y=cy*BigInt(VILLAGE_CELL_SIZE)+jy;
  return Object.freeze({
    x:x.toString(),y:y.toString(),cellX:cx.toString(),cellY:cy.toString(),
    name:generatedName(seed,"village:"+key,"Village")
  });
}
function villageAtCell(seed,cx,cy){
  return hasVillage(seed,cx,cy)?villageCenter(seed,cx,cy):null;
}
function villagesNear(seed,x,y,radiusCells){
  const base=villageCellFor(x,y);
  const radius=BigInt(radiusCells==null?1:radiusCells);
  const out=[];
  for(let dy=-radius;dy<=radius;dy++){
    for(let dx=-radius;dx<=radius;dx++){
      const cx=base.x+dx;
      const cy=base.y+dy;
      const village=villageAtCell(seed,cx,cy);
      if(village)out.push(village);
    }
  }
  return out;
}
function nearestVillage(seed,x,y,excludeOrigin){
  const px=toBig(x),py=toBig(y);
  let best=null;
  for(let ring=0;ring<=8;ring++){
    const villages=villagesNear(seed,x,y,ring);
    for(const village of villages){
      if(excludeOrigin&&village.x==="0"&&village.y==="0")continue;
      const dx=toBig(village.x)-px;
      const dy=toBig(village.y)-py;
      const dist2=dx*dx+dy*dy;
      if(!best||dist2<best.dist2)best={village,dist2};
    }
    if(best&&ring>=2)break;
  }
  return best?best.village:null;
}

function broadCell(x,y,size){
  const s=BigInt(size);
  return Object.freeze({x:floorDiv(toBig(x),s),y:floorDiv(toBig(y),s)});
}

function smoothstep(value){
  const t=Math.max(0,Math.min(1,value));
  return t*t*(3-2*t);
}

function lerp(a,b,t){
  return a+(b-a)*t;
}

function valueNoise(seed,label,x,y,scale){
  const px=toBig(x);
  const py=toBig(y);
  const s=BigInt(scale);
  const gx=floorDiv(px,s);
  const gy=floorDiv(py,s);
  const localX=Number(px-gx*s)/Number(s);
  const localY=Number(py-gy*s)/Number(s);
  const tx=smoothstep(localX);
  const ty=smoothstep(localY);

  const n00=unit(seed,label+":"+cellKey(gx,gy));
  const n10=unit(seed,label+":"+cellKey(gx+1n,gy));
  const n01=unit(seed,label+":"+cellKey(gx,gy+1n));
  const n11=unit(seed,label+":"+cellKey(gx+1n,gy+1n));

  return lerp(lerp(n00,n10,tx),lerp(n01,n11,tx),ty);
}

function layeredNoise(seed,label,x,y,layers){
  let value=0;
  let total=0;
  for(const layer of layers){
    value+=valueNoise(seed,label+":"+layer[0],x,y,layer[0])*layer[1];
    total+=layer[1];
  }
  return total>0?value/total:0.5;
}

function naturalField(seed,label,x,y){
  return layeredNoise(seed,label,x,y,[[96,0.48],[42,0.32],[17,0.20]]);
}
function hierarchy(seed,x,y){
  const continent=broadCell(x,y,131072);
  const country=broadCell(x,y,32768);
  const region=broadCell(x,y,8192);
  const city=broadCell(x,y,1024);
  const district=broadCell(x,y,256);
  const village=nearestVillage(seed,x,y,false);
  const streetCell=broadCell(x,y,8);
  const avenueCell=broadCell(x,y,32);

  return Object.freeze({
    continent:generatedName(seed,"continent:"+cellKey(continent.x,continent.y),"Continent"),
    country:generatedName(seed,"country:"+cellKey(country.x,country.y),"Realm"),
    region:generatedName(seed,"region:"+cellKey(region.x,region.y),"Region"),
    city:generatedName(seed,"city:"+cellKey(city.x,city.y),"City"),
    district:generatedName(seed,"district:"+cellKey(district.x,district.y),"District"),
    village:village?village.name:"Unsettled Lands",
    avenue:pick(seed,"avenue:"+cellKey(avenueCell.x,avenueCell.y),AVENUE_WORDS)+" Avenue",
    street:pick(seed,"street:"+cellKey(streetCell.x,streetCell.y),STREET_WORDS)+" Street"
  });
}

function environment(seed,x,y){
  const elevationField=layeredNoise(seed,"env:elevation",x,y,[[192,0.50],[72,0.30],[24,0.20]]);
  const moistureField=layeredNoise(seed,"env:moisture",x,y,[[144,0.50],[54,0.30],[18,0.20]]);
  const temperatureField=layeredNoise(seed,"env:temperature",x,y,[[256,0.60],[96,0.25],[32,0.15]]);

  const elevation=Math.round(20+1830*Math.pow(elevationField,1.28));
  const moisture=Math.round(12+84*moistureField);
  const altitudeCooling=Math.min(11,elevation/240);
  const temp=Math.max(-6,Math.min(30,Math.round(5+27*temperatureField-altitudeCooling)));

  let climate="Temperate";
  if(temp<=7)climate="Cold";
  else if(temp>=22)climate="Warm";
  if(moisture>=75)climate+=" Wet";
  else if(moisture<=30)climate+=" Dry";

  let biome="Grassland";
  if(elevation>1250)biome="Highland";
  else if(moisture>72)biome="Woodland";
  else if(moisture<28)biome="Dry Steppe";
  else if(temp>21&&moisture<48)biome="Warm Scrub";

  return Object.freeze({elevationMeters:elevation,moisturePercent:moisture,temperatureC:temp,climate,biome});
}

function villageInfluence(seed,x,y){
  const px=toBig(x),py=toBig(y);
  let nearest=null;
  for(const village of villagesNear(seed,x,y,1)){
    const dx=toBig(village.x)-px;
    const dy=toBig(village.y)-py;
    const man=absBig(dx)+absBig(dy);
    if(!nearest||man<nearest.distance)nearest={village,dx,dy,distance:man};
  }
  return nearest;
}

function rawBaseTerrain(seed,x,y){
  const env=environment(seed,x,y);
  const elevation=env.elevationMeters/1850;
  const moisture=env.moisturePercent/100;
  const hydro=naturalField(seed,"terrain:hydro",x,y);
  const vegetation=naturalField(seed,"terrain:vegetation",x,y);
  const soil=layeredNoise(seed,"terrain:soil",x,y,[[58,0.52],[27,0.30],[11,0.18]]);
  const cultivation=layeredNoise(seed,"terrain:cultivation",x,y,[[44,0.58],[19,0.27],[8,0.15]]);

  // Smooth fields create irregular coastlines/lakes instead of rectangular macro cells.
  const waterScore=hydro*0.68+(1-elevation)*0.32;
  if(waterScore>0.705&&elevation<0.62)return "water";

  if(elevation>0.77){
    return soil>0.43?"rock":"grass";
  }

  if(moisture>0.76&&elevation<0.54&&soil>0.50)return "mud";
  if(moisture>0.62&&vegetation>0.50)return "forest";
  if(moisture<0.29){
    return soil>0.48?"sand":"dirt";
  }

  if(cultivation>0.69&&moisture>0.38&&moisture<0.72&&elevation<0.58)return "farmland";
  if(soil>0.69&&moisture<0.58)return "dirt";
  if(vegetation>0.74&&moisture>0.50)return "forest";
  return "grass";
}

function roadCoordinate(axis,progress,lateral){
  return axis==="horizontal"
    ? Object.freeze({x:progress.toString(),y:String(lateral)})
    : Object.freeze({x:String(lateral),y:progress.toString()});
}

function positiveModBig(value,divisor){
  const r=value%divisor;
  return r<0n?r+divisor:r;
}

function mainRoadCenter(seed,axis,progressValue){
  const progress=toBig(progressValue);
  const label="main-road-wave:"+axis;
  const current=axis==="horizontal"
    ? valueNoise(seed,label,progress.toString(),"0",MAIN_ROAD_WAVE_SCALE)
    : valueNoise(seed,label,"0",progress.toString(),MAIN_ROAD_WAVE_SCALE);
  const origin=valueNoise(seed,label,"0","0",MAIN_ROAD_WAVE_SCALE);
  return Math.round((current-origin)*MAIN_ROAD_WAVE_AMPLITUDE);
}

function bridgeWindow(seed,axis,progressValue){
  const progress=toBig(progressValue);
  const blockSize=BigInt(BRIDGE_BLOCK_SIZE);
  const block=floorDiv(progress,blockSize);
  const local=Number(positiveModBig(progress,blockSize));
  const length=3+(PRNG.foundationUint32(seed,"bridge-length:"+axis+":"+block)%7); // 3..9
  const available=BRIDGE_BLOCK_SIZE-length-8;
  const start=4+(PRNG.foundationUint32(seed,"bridge-start:"+axis+":"+block)%Math.max(1,available+1));
  return Object.freeze({
    active:local>=start&&local<start+length,
    length,
    start,
    block:block.toString()
  });
}

function roadWidthForContext(context,terrain,distanceFromSettlement){
  let width=ROAD_WIDTH_POLICY[context]||ROAD_WIDTH_POLICY.wilderness;

  if(context==="village"){
    if(distanceFromSettlement<=4n)width=ROAD_WIDTH_POLICY.village;
    else if(distanceFromSettlement<=12n)width=2;
    else width=ROAD_WIDTH_POLICY.wilderness;
  }

  if(terrain==="forest"||terrain==="rock"||terrain==="mud"){
    width=Math.min(width,ROAD_WIDTH_POLICY.rough);
  }else if(context==="wilderness"){
    width=Math.min(width,ROAD_WIDTH_POLICY.wilderness);
  }

  if(terrain==="water"){
    width=Math.min(Math.max(1,width),ROAD_WIDTH_POLICY.bridge);
  }

  return Math.max(1,Math.min(ROAD_WIDTH_POLICY.capital,width));
}

function roadContext(seed,x,y){
  const influence=villageInfluence(seed,x,y);
  if(influence&&influence.distance<=14n){
    return Object.freeze({kind:"village",distance:influence.distance,village:influence.village});
  }
  return Object.freeze({kind:"wilderness",distance:999999n,village:null});
}

function mainRoadCandidate(seed,axis,x,y){
  const px=toBig(x),py=toBig(y);
  const progress=axis==="horizontal"?px:py;
  const lateral=axis==="horizontal"?py:px;
  const center=mainRoadCenter(seed,axis,progress);
  const centerCoord=roadCoordinate(axis,progress,center);
  const rawTerrain=rawBaseTerrain(seed,centerCoord.x,centerCoord.y);
  const context=roadContext(seed,centerCoord.x,centerCoord.y);
  const width=roadWidthForContext(context.kind,rawTerrain,context.distance);
  const halfLow=Math.floor((width-1)/2);
  const halfHigh=Math.ceil((width-1)/2);
  const distance=Number(lateral)-center;

  if(distance < -halfLow || distance > halfHigh)return null;

  const bridge=rawTerrain==="water"&&bridgeWindow(seed,axis,progress).active;
  return Object.freeze({
    axis,
    progress:progress.toString(),
    center,
    width,
    type:bridge?"bridge":"road",
    underlying:rawTerrain,
    context:context.kind,
    bridgeWindow:bridge?bridgeWindow(seed,axis,progress):null
  });
}

function mainRoadInfo(seed,x,y){
  const horizontal=mainRoadCandidate(seed,"horizontal",x,y);
  const vertical=mainRoadCandidate(seed,"vertical",x,y);
  if(!horizontal)return vertical;
  if(!vertical)return horizontal;

  const type=(horizontal.type==="bridge"||vertical.type==="bridge")?"bridge":"road";
  return Object.freeze({
    axis:"intersection",
    center:0,
    width:Math.max(horizontal.width,vertical.width),
    type,
    underlying:type==="bridge"?"water":horizontal.underlying,
    context:horizontal.context==="village"||vertical.context==="village"?"village":"wilderness",
    bridgeWindow:type==="bridge"?(horizontal.bridgeWindow||vertical.bridgeWindow):null
  });
}

function roadProtection(seed,x,y){
  const px=toBig(x),py=toBig(y);
  const candidates=[];
  for(const axis of ["horizontal","vertical"]){
    const progress=axis==="horizontal"?px:py;
    const lateral=axis==="horizontal"?py:px;
    const center=mainRoadCenter(seed,axis,progress);
    const rawCenter=roadCoordinate(axis,progress,center);
    const rawTerrain=rawBaseTerrain(seed,rawCenter.x,rawCenter.y);
    const context=roadContext(seed,rawCenter.x,rawCenter.y);
    const width=roadWidthForContext(context.kind,rawTerrain,context.distance);
    const protection=Math.ceil(width/2)+1;
    const distance=Math.abs(Number(lateral)-center);
    if(distance<=protection){
      candidates.push({
        axis,
        progress,
        distance,
        bridge:bridgeWindow(seed,axis,progress)
      });
    }
  }
  return candidates;
}

function baseTerrain(seed,x,y){
  const raw=rawBaseTerrain(seed,x,y);
  if(raw!=="water")return raw;

  // Main-road geography is co-generated with hydrography:
  // wide water cannot erase the road. Outside a short approved bridge window,
  // a narrow deterministic land corridor is retained so the road remains logical.
  const protection=roadProtection(seed,x,y);
  if(protection.length===0)return raw;
  if(protection.some(item=>item.bridge.active))return raw;

  const soil=layeredNoise(seed,"road-land-corridor",x,y,[[28,0.65],[9,0.35]]);
  return soil>0.62?"dirt":"grass";
}

function bridgeRunAt(seed,axis,progressValue){
  const progress=toBig(progressValue);
  const window=bridgeWindow(seed,axis,progress);
  if(!window.active)return 0;

  const center=mainRoadCenter(seed,axis,progress);
  const coord=roadCoordinate(axis,progress,center);
  if(rawBaseTerrain(seed,coord.x,coord.y)!=="water")return 0;

  let run=1;
  for(let step=1;step<=MAX_BRIDGE_TILES;step++){
    const p=progress-BigInt(step);
    const w=bridgeWindow(seed,axis,p);
    const c=roadCoordinate(axis,p,mainRoadCenter(seed,axis,p));
    if(!w.active||rawBaseTerrain(seed,c.x,c.y)!=="water")break;
    run++;
  }
  for(let step=1;step<=MAX_BRIDGE_TILES;step++){
    const p=progress+BigInt(step);
    const w=bridgeWindow(seed,axis,p);
    const c=roadCoordinate(axis,p,mainRoadCenter(seed,axis,p));
    if(!w.active||rawBaseTerrain(seed,c.x,c.y)!=="water")break;
    run++;
  }
  return run;
}

function getTerrainType(seed,x,y){
  const px=toBig(x),py=toBig(y);

  // Main infrastructure is authoritative and cannot be erased by terrain,
  // settlement parcels, buildings, forest, mountain or water.
  const road=mainRoadInfo(seed,x,y);
  if(road)return road.type;

  const influence=villageInfluence(seed,x,y);
  if(influence&&influence.distance<=14n){
    const vx=toBig(influence.village.x),vy=toBig(influence.village.y);
    const dx=px-vx,dy=py-vy;

    if(absBig(dx)<=12n&&absBig(dy)<=12n){
      const villageGround=layeredNoise(
        seed,
        "village-ground:"+influence.village.x+":"+influence.village.y,
        dx.toString(),
        dy.toString(),
        [[10,0.65],[4,0.35]]
      );
      if(villageGround>0.72&&influence.distance>5n)return "farmland";
    }
  }
  return baseTerrain(seed,x,y);
}

function mainRoadProof(seed,radiusValue){
  const radius=BigInt(radiusValue==null?96:radiusValue);
  let continuous=true;
  let maxBridgeTiles=0;
  let maxWidth=0;
  let minWidth=ROAD_WIDTH_POLICY.capital;
  let bridgeCells=0;
  let sampled=0;

  for(const axis of ["horizontal","vertical"]){
    let previous=null;
    let currentBridgeRun=0;
    for(let progress=-radius;progress<=radius;progress++){
      const center=mainRoadCenter(seed,axis,progress);
      if(center==null){
        continuous=false;
        continue;
      }
      if(previous!=null&&Math.abs(center-previous)>1)continuous=false;
      previous=center;

      const coord=roadCoordinate(axis,progress,center);
      const info=mainRoadInfo(seed,coord.x,coord.y);
      if(!info){
        continuous=false;
        continue;
      }

      sampled++;
      maxWidth=Math.max(maxWidth,info.width);
      minWidth=Math.min(minWidth,info.width);

      if(info.type==="bridge"){
        bridgeCells++;
        currentBridgeRun++;
        maxBridgeTiles=Math.max(maxBridgeTiles,currentBridgeRun);
      }else{
        currentBridgeRun=0;
      }
    }
  }

  const maxBridgeWalkMinutes=
    maxBridgeTiles*TILE_METERS/(MAIN_ROAD_WALK_SPEED_KMH*1000/60);

  return Object.freeze({
    continuous,
    sampled,
    minWidth,
    maxWidth,
    bridgeCells,
    maxBridgeTiles,
    maxBridgeWalkMinutes,
    bridgeLimitTiles:MAX_BRIDGE_TILES,
    bridgeLimitMinutes:MAX_BRIDGE_WALK_MINUTES,
    bridgePass:maxBridgeTiles<=MAX_BRIDGE_TILES&&maxBridgeWalkMinutes<=MAX_BRIDGE_WALK_MINUTES+1e-9,
    capitalWidthCap:ROAD_WIDTH_POLICY.capital,
    villageWidthCap:ROAD_WIDTH_POLICY.village
  });
}

const WALK_SPEED_KMH=Object.freeze({
  road:5.5,bridge:5.5,dirt:4.8,grass:4.5,farmland:4.2,sand:3.2,forest:3.0,mud:2.5,rock:2.0,
  water:0,building:0
});
function walkMinutesForStep(type,diagonal){
  const speed=WALK_SPEED_KMH[type]||0;
  if(speed<=0)return Infinity;
  const meters=TILE_METERS*(diagonal?Math.SQRT2:1);
  return meters/(speed*1000/60);
}

function estimateWalkRoute(seed,fromVillage,toVillage){
  const sx=Number(fromVillage.x),sy=Number(fromVillage.y);
  const tx=Number(toVillage.x),ty=Number(toVillage.y);
  if(!Number.isSafeInteger(sx)||!Number.isSafeInteger(sy)||!Number.isSafeInteger(tx)||!Number.isSafeInteger(ty)){
    return Object.freeze({reachable:false,minutes:Infinity,reason:"route-check-local-range"});
  }

  const margin=28;
  const minX=Math.min(sx,tx)-margin,maxX=Math.max(sx,tx)+margin;
  const minY=Math.min(sy,ty)-margin,maxY=Math.max(sy,ty)+margin;
  const key=(x,y)=>x+","+y;
  const heuristic=(x,y)=>{
    const dx=Math.abs(tx-x),dy=Math.abs(ty-y);
    const diagonal=Math.min(dx,dy),straight=Math.max(dx,dy)-diagonal;
    return (diagonal*TILE_METERS*Math.SQRT2+straight*TILE_METERS)/(MAX_WALK_SPEED_KMH*1000/60);
  };
  const open=[{x:sx,y:sy,g:0,f:heuristic(sx,sy)}];
  const best=new Map([[key(sx,sy),0]]);
  const dirs=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  let visited=0;
  const visitLimit=50000;

  while(open.length&&visited<visitLimit){
    let bestIndex=0;
    for(let i=1;i<open.length;i++)if(open[i].f<open[bestIndex].f)bestIndex=i;
    const current=open.splice(bestIndex,1)[0];
    visited++;
    if(current.x===tx&&current.y===ty){
      return Object.freeze({reachable:true,minutes:current.g,visited});
    }
    for(const [dx,dy] of dirs){
      const nx=current.x+dx,ny=current.y+dy;
      if(nx<minX||nx>maxX||ny<minY||ny>maxY)continue;
      const type=(nx===tx&&ny===ty)?"road":getTerrainType(seed,String(nx),String(ny));
      const step=walkMinutesForStep(type,dx!==0&&dy!==0);
      if(!Number.isFinite(step))continue;
      const ng=current.g+step;
      const k=key(nx,ny);
      if(best.has(k)&&best.get(k)<=ng)continue;
      best.set(k,ng);
      open.push({x:nx,y:ny,g:ng,f:ng+heuristic(nx,ny)});
    }
  }
  return Object.freeze({reachable:false,minutes:Infinity,visited,reason:"no-valid-route"});
}

function villageSpacingProof(seed){
  const start=villageCenter(seed,0n,0n);
  const nearest=nearestVillage(seed,"0","0",true);
  if(!nearest)return Object.freeze({pass:false,start,nearest:null,route:null});
  const dx=Number(nearest.x)-Number(start.x);
  const dy=Number(nearest.y)-Number(start.y);
  const directTiles=Math.hypot(dx,dy);
  const fastestPossibleMinutes=(directTiles*TILE_METERS)/(MAX_WALK_SPEED_KMH*1000/60);
  const route=estimateWalkRoute(seed,start,nearest);
  const minutes=route.reachable?route.minutes:Infinity;
  return Object.freeze({
    pass:fastestPossibleMinutes>=MIN_VILLAGE_WALK_MINUTES && (!route.reachable||minutes>=MIN_VILLAGE_WALK_MINUTES),
    start,nearest,directTiles,fastestPossibleMinutes,route,minutes
  });
}

function location(seed,x,y){
  return Object.freeze({
    coordinates:WorldCoordinates.position(x,y),
    hierarchy:hierarchy(seed,x,y),
    environment:environment(seed,x,y),
    terrain:getTerrainType(seed,x,y)
  });
}

window.GeographyFoundation=Object.freeze({
  TILE_METERS,VILLAGE_CELL_SIZE,MIN_VILLAGE_WALK_MINUTES,MAX_WALK_SPEED_KMH,
  MAIN_ROAD_WALK_SPEED_KMH,MAX_BRIDGE_WALK_MINUTES,MAX_BRIDGE_TILES,ROAD_WIDTH_POLICY,
  hierarchy,environment,getTerrainType,location,
  mainRoadCenter,mainRoadInfo,mainRoadProof,roadWidthForContext,bridgeRunAt,
  villageCenter,villageAtCell,nearestVillage,villageSpacingProof,estimateWalkRoute
});
})();
