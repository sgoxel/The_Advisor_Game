(function(){
"use strict";

const TILE_METERS=100;
const VILLAGE_CELL_SIZE=72;
const VILLAGE_JITTER=8;
const MIN_VILLAGE_WALK_MINUTES=60;
const MAX_WALK_SPEED_KMH=5.5;

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

function baseTerrain(seed,x,y){
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

function roadOffset(seed,village,axis,progress){
  const key="village-road:"+axis+":"+village.x+":"+village.y;
  const field=axis==="vertical"
    ? valueNoise(seed,key,"0",progress,7)
    : valueNoise(seed,key,progress,"0",7);
  return Math.round((field-0.5)*7);
}

function getTerrainType(seed,x,y){
  const px=toBig(x),py=toBig(y);
  const influence=villageInfluence(seed,x,y);
  if(influence&&influence.distance<=14n){
    const vx=toBig(influence.village.x),vy=toBig(influence.village.y);
    const dx=px-vx,dy=py-vy;

    const verticalOffset=BigInt(roadOffset(seed,influence.village,"vertical",dy.toString()));
    const horizontalOffset=BigInt(roadOffset(seed,influence.village,"horizontal",dx.toString()));
    const verticalDistance=absBig(dx-verticalOffset);
    const horizontalDistance=absBig(dy-horizontalOffset);
    const onRoad=verticalDistance===0n||horizontalDistance===0n;

    if(onRoad)return "road";

    const nearRoad=verticalDistance<=1n||horizontalDistance<=1n;
    if(nearRoad&&absBig(dx)<=8n&&absBig(dy)<=8n){
      return unit(seed,"building:"+px+":"+py)<0.36?"building":"dirt";
    }

    if(absBig(dx)<=12n&&absBig(dy)<=12n){
      const villageGround=layeredNoise(
        seed,
        "village-ground:"+influence.village.x+":"+influence.village.y,
        dx.toString(),
        dy.toString(),
        [[10,0.65],[4,0.35]]
      );
      return villageGround>0.57?"farmland":"grass";
    }
  }
  return baseTerrain(seed,x,y);
}

const WALK_SPEED_KMH=Object.freeze({
  road:5.5,dirt:4.8,grass:4.5,farmland:4.2,sand:3.2,forest:3.0,mud:2.5,rock:2.0,
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
  hierarchy,environment,getTerrainType,location,
  villageCenter,villageAtCell,nearestVillage,villageSpacingProof,estimateWalkRoute
});
})();
