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
  const macro=broadCell(x,y,24);
  const key=cellKey(macro.x,macro.y);
  const elevation=integer(seed,"env:elevation:"+key,20,1850);
  const moisture=integer(seed,"env:moisture:"+key,18,92);
  const temp=integer(seed,"env:temperature:"+key,2,26);
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
  const block=broadCell(x,y,12);
  const key=cellKey(block.x,block.y);
  const local=unit(seed,"terrain:local:"+WorldCoordinates.normalize(x)+":"+WorldCoordinates.normalize(y));
  const waterChance=unit(seed,"terrain:water:"+key);

  if(waterChance<0.085)return "water";
  if(env.elevationMeters>1450)return local<0.72?"rock":"grass";
  if(env.moisturePercent>76)return local<0.70?"forest":"mud";
  if(env.moisturePercent<27)return local<0.60?"sand":"dirt";
  if(env.biome==="Woodland")return local<0.72?"forest":"grass";
  if(local<0.58)return "grass";
  if(local<0.72)return "farmland";
  if(local<0.84)return "dirt";
  if(local<0.92)return "forest";
  return "mud";
}

function getTerrainType(seed,x,y){
  const px=toBig(x),py=toBig(y);
  const influence=villageInfluence(seed,x,y);
  if(influence&&influence.distance<=14n){
    const vx=toBig(influence.village.x),vy=toBig(influence.village.y);
    const dx=px-vx,dy=py-vy;
    if(dx===0n||dy===0n)return "road";
    const nearRoad=absBig(dx)<=1n||absBig(dy)<=1n;
    if(nearRoad&&absBig(dx)<=8n&&absBig(dy)<=8n){
      return unit(seed,"building:"+px+":"+py)<0.36?"building":"dirt";
    }
    if(absBig(dx)<=12n&&absBig(dy)<=12n){
      return unit(seed,"village-ground:"+px+":"+py)<0.58?"grass":"farmland";
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
