(function(){
"use strict";

const TILE_METERS=WorldStandards.TILE_METERS;
const VILLAGE_CELL_SIZE=WorldStandards.VILLAGE_CELL_SIZE_TILES;
const VILLAGE_JITTER=WorldStandards.VILLAGE_JITTER_TILES;
const MIN_VILLAGE_WALK_MINUTES=WorldStandards.MIN_VILLAGE_WALK_MINUTES;
const MAX_WALK_SPEED_KMH=WorldStandards.FASTEST_NORMAL_WALK_KMH;
const MAIN_ROAD_WALK_SPEED_KMH=WorldStandards.WALK_SPEED_KMH.road;
const MAX_BRIDGE_WALK_MINUTES=WorldStandards.MAX_BRIDGE_WALK_MINUTES;
const MAX_BRIDGE_TILES=WorldStandards.MAX_RURAL_BRIDGE_TILES;
const BRIDGE_BLOCK_SIZE=24;
const ROAD_WIDTH_POLICY=WorldStandards.ROAD_WIDTH_TILES;

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
    country:window.PoliticalGeography?.countryAt?.(seed,x,y)?.name||generatedName(seed,"country:"+cellKey(country.x,country.y),"Realm"),
    region:window.RegionProfile?.at?.(seed,x,y)?.name||generatedName(seed,"region:"+cellKey(region.x,region.y),"Region"),
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

function bridgeWindow(seed,axis,progressValue,scope){
  const progress=toBig(progressValue);
  const blockSize=BigInt(BRIDGE_BLOCK_SIZE);
  const block=floorDiv(progress,blockSize);
  const local=Number(positiveModBig(progress,blockSize));
  const prefix=(scope||"road")+":"+axis+":"+block;
  const length=3+(PRNG.foundationUint32(seed,"bridge-length:"+prefix)%7); // 3..9
  const available=BRIDGE_BLOCK_SIZE-length-8;
  const start=4+(PRNG.foundationUint32(seed,"bridge-start:"+prefix)%Math.max(1,available+1));
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
    if(distanceFromSettlement<=4n){
      width=ROAD_WIDTH_POLICY.village;
    }else if(distanceFromSettlement<=12n){
      width=2;
    }else{
      width=ROAD_WIDTH_POLICY.wilderness;
    }
  }

  if(terrain==="forest"||terrain==="rock"||terrain==="mud"){
    if(context==="village"&&distanceFromSettlement<=4n){
      width=Math.min(width,ROAD_WIDTH_POLICY.village);
    }else if(context==="village"&&distanceFromSettlement<=12n){
      width=Math.min(width,2);
    }else{
      width=Math.min(width,ROAD_WIDTH_POLICY.rough);
    }
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

function withinRoadWidth(signedDistance,width){
  const low=Math.floor((width-1)/2);
  const high=Math.ceil((width-1)/2);
  return signedDistance>=-low&&signedDistance<=high;
}

function villageRoadInfo(seed,x,y){
  const influence=villageInfluence(seed,x,y);
  if(!influence||influence.distance>15n)return null;

  const px=toBig(x),py=toBig(y);
  const vx=toBig(influence.village.x),vy=toBig(influence.village.y);
  const dx=Number(px-vx),dy=Number(py-vy);
  if(!Number.isSafeInteger(dx)||!Number.isSafeInteger(dy))return null;

  const raw=rawBaseTerrain(seed,x,y);
  const contextDistance=influence.distance;
  const branchWidth=roadWidthForContext("village",raw,contextDistance);
  const scope=influence.village.x+":"+influence.village.y;

  const horizontalBase=valueNoise(seed,"village-main-h:"+scope,String(dx),"0",7);
  const horizontalZero=valueNoise(seed,"village-main-h:"+scope,"0","0",7);
  const horizontalY=Math.round((horizontalBase-horizontalZero)*4);
  const horizontalSigned=dy-horizontalY;
  const horizontalActive=Math.abs(dx)<=11&&withinRoadWidth(horizontalSigned,branchWidth);

  const verticalBase=valueNoise(seed,"village-main-v:"+scope,"0",String(dy),7);
  const verticalZero=valueNoise(seed,"village-main-v:"+scope,"0","0",7);
  const verticalX=Math.round((verticalBase-verticalZero)*4);
  const verticalSigned=dx-verticalX;
  const verticalActive=Math.abs(dy)<=11&&withinRoadWidth(verticalSigned,branchWidth);

  const radial=Math.hypot(dx,dy);
  const ringNoise=layeredNoise(
    seed,
    "village-main-ring:"+scope,
    String(dx),
    String(dy),
    [[12,0.65],[5,0.35]]
  );
  const ringRadius=9.25+(ringNoise-0.5)*2.2;
  const ringWidth=2;
  const ringActive=Math.abs(radial-ringRadius)<=0.9;

  if(!horizontalActive&&!verticalActive&&!ringActive)return null;

  let axis="ring";
  let bridge=null;
  if(horizontalActive){
    axis="horizontal";
    bridge=bridgeWindow(seed,"horizontal",String(dx),scope);
  }
  if(verticalActive&&(!horizontalActive||Math.abs(verticalSigned)<Math.abs(horizontalSigned))){
    axis="vertical";
    bridge=bridgeWindow(seed,"vertical",String(dy),scope);
  }

  const isBridge=axis!=="ring"&&raw==="water"&&bridge&&bridge.active;
  return Object.freeze({
    axis,
    width:axis==="ring"?ringWidth:branchWidth,
    type:isBridge?"bridge":"road",
    underlying:raw,
    context:"village",
    bridgeWindow:isBridge?bridge:null,
    bridgeLengthTiles:isBridge?bridge.length:0,
    village:influence.village
  });
}

function mainRoadInfo(seed,x,y){
  return villageRoadInfo(seed,x,y);
}

function baseTerrain(seed,x,y){
  const raw=rawBaseTerrain(seed,x,y);
  if(raw!=="water")return raw;

  const influence=villageInfluence(seed,x,y);
  if(!influence||influence.distance>14n)return raw;

  const road=villageRoadInfo(seed,x,y);
  if(road&&road.type==="bridge")return raw;

  // The inhabited village foundation retains coherent buildable land.
  // The edge remains irregular so the settlement can still border water naturally.
  const distance=Number(influence.distance);
  const shore=layeredNoise(
    seed,
    "village-land:"+influence.village.x+":"+influence.village.y,
    x,
    y,
    [[18,0.60],[7,0.40]]
  );
  if(distance<=10||shore>0.48+(distance-10)*0.055){
    return shore>0.63?"mud":"grass";
  }
  return raw;
}

function bridgeRunAt(seed,axis,progressValue){
  const origin=villageCenter(seed,0n,0n);
  const scope=origin.x+":"+origin.y;
  const window=bridgeWindow(seed,axis,progressValue,scope);
  return window.active?window.length:0;
}

function getTerrainType(seed,x,y){
  const px=toBig(x),py=toBig(y);

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
  const radius=Math.max(12,Math.min(24,Number(radiusValue==null?16:radiusValue)));
  const cells=new Map();
  let maxBridgeTiles=0;
  let maxWidth=0;
  let minWidth=ROAD_WIDTH_POLICY.capital;

  for(let y=-radius;y<=radius;y++){
    for(let x=-radius;x<=radius;x++){
      const info=mainRoadInfo(seed,String(x),String(y));
      if(!info)continue;
      const key=x+","+y;
      cells.set(key,info);
      maxWidth=Math.max(maxWidth,info.width);
      minWidth=Math.min(minWidth,info.width);
      maxBridgeTiles=Math.max(maxBridgeTiles,info.bridgeLengthTiles||0);
    }
  }

  const keys=[...cells.keys()];
  let connected=keys.length>0;
  if(keys.length){
    const visited=new Set([keys[0]]);
    const queue=[keys[0]];
    while(queue.length){
      const current=queue.shift();
      const [x,y]=current.split(",").map(Number);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const next=(x+dx)+","+(y+dy);
        if(cells.has(next)&&!visited.has(next)){
          visited.add(next);
          queue.push(next);
        }
      }
    }
    connected=visited.size===cells.size;
  }

  const maxBridgeWalkMinutes=
    maxBridgeTiles*TILE_METERS/(MAIN_ROAD_WALK_SPEED_KMH*1000/60);

  return Object.freeze({
    continuous:connected,
    sampled:cells.size,
    minWidth:cells.size?minWidth:0,
    maxWidth,
    bridgeCells:[...cells.values()].filter(info=>info.type==="bridge").length,
    maxBridgeTiles,
    maxBridgeWalkMinutes,
    bridgeLimitTiles:MAX_BRIDGE_TILES,
    bridgeLimitMinutes:MAX_BRIDGE_WALK_MINUTES,
    bridgePass:maxBridgeTiles<=MAX_BRIDGE_TILES&&maxBridgeWalkMinutes<=MAX_BRIDGE_WALK_MINUTES+1e-9,
    capitalWidthCap:ROAD_WIDTH_POLICY.capital,
    villageWidthCap:ROAD_WIDTH_POLICY.village,
    networkKind:"village-ring-connected-avenues"
  });
}

const WALK_SPEED_KMH=WorldStandards.WALK_SPEED_KMH;
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
  const directMeters=directTiles*TILE_METERS;
  const fastestPossibleMinutes=WorldStandards.walkMinutes(directMeters,MAX_WALK_SPEED_KMH);
  const pass=fastestPossibleMinutes>=MIN_VILLAGE_WALK_MINUTES;
  return Object.freeze({
    pass,start,nearest,directTiles,directMeters,
    fastestPossibleMinutes,
    minutes:fastestPossibleMinutes,
    route:Object.freeze({
      evaluated:false,
      reachable:null,
      reason:"geometric-lower-bound",
      note:"Straight-line travel at the fastest normal walk is already >= 1 fantasy hour."
    })
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
  mainRoadInfo,mainRoadProof,roadWidthForContext,bridgeRunAt,
  villageCenter,villageAtCell,nearestVillage,villageSpacingProof,estimateWalkRoute
});
})();
