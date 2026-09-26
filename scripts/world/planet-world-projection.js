(function(){
"use strict";

const VERSION="planet-world-projection-v1";
const WORLD_RADIUS_METERS=637100;
const TILE_METERS_FALLBACK=2;
const MAX_SUPPORT_SETTLEMENTS=16;
const LATITUDE_BANDS=Object.freeze([-48,-32,-16,0,16,32,48]);
const LONGITUDE_SLOTS=12;
const SUPPORT_RING_METERS=Object.freeze([70000,150000,260000]);
const cache=new Map();

function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function wrapLongitude(value){
  let lon=Number(value)||0;
  lon=((lon+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
  return lon;
}
function hash32(text){
  let h=2166136261>>>0;
  const source=String(text==null?"":text);
  for(let i=0;i<source.length;i++){h^=source.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
function unit(seed,key){return hash32(String(seed)+"|"+String(key))/4294967296}
function tileMeters(){return Math.max(1,Number(window.WorldStandards?.TILE_METERS||TILE_METERS_FALLBACK))}
function toBig(value){try{return BigInt(String(value??"0"))}catch(_){return 0n}}
function relativeMeters(xValue,yValue){
  const scale=tileMeters();
  return Object.freeze({east:Number(toBig(xValue))*scale,north:Number(toBig(yValue))*scale});
}
function destination(latitudeRadians,longitudeRadians,eastMeters,northMeters){
  const distance=Math.hypot(eastMeters,northMeters);
  if(distance<1e-9)return Object.freeze({latitudeRadians,longitudeRadians:wrapLongitude(longitudeRadians)});
  const angular=distance/WORLD_RADIUS_METERS;
  const bearing=Math.atan2(eastMeters,northMeters);
  const sinLat=Math.sin(latitudeRadians),cosLat=Math.cos(latitudeRadians);
  const sinAngular=Math.sin(angular),cosAngular=Math.cos(angular);
  const latitude=Math.asin(clamp(sinLat*cosAngular+cosLat*sinAngular*Math.cos(bearing),-1,1));
  const longitude=wrapLongitude(longitudeRadians+Math.atan2(
    Math.sin(bearing)*sinAngular*cosLat,
    cosAngular-sinLat*Math.sin(latitude)
  ));
  return Object.freeze({latitudeRadians:latitude,longitudeRadians:longitude});
}
function inverseDestination(anchorLatitudeRadians,anchorLongitudeRadians,latitudeRadians,longitudeRadians){
  const lat1=Number(anchorLatitudeRadians)||0,lat2=clamp(Number(latitudeRadians)||0,-Math.PI/2,Math.PI/2);
  const deltaLon=wrapLongitude((Number(longitudeRadians)||0)-anchorLongitudeRadians);
  const cosAngular=clamp(Math.sin(lat1)*Math.sin(lat2)+Math.cos(lat1)*Math.cos(lat2)*Math.cos(deltaLon),-1,1);
  const angular=Math.acos(cosAngular);
  if(angular<1e-10)return Object.freeze({eastMeters:0,northMeters:0,distanceMeters:0,bearingRadians:0});
  const bearing=Math.atan2(
    Math.sin(deltaLon)*Math.cos(lat2),
    Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(deltaLon)
  );
  const distance=angular*WORLD_RADIUS_METERS;
  return Object.freeze({
    eastMeters:Math.sin(bearing)*distance,
    northMeters:Math.cos(bearing)*distance,
    distanceMeters:distance,
    bearingRadians:bearing
  });
}
function originCountry(seed){
  try{return window.PoliticalGeography?.countryAt?.(seed,"0","0")||null}catch(_){return null}
}
function supportWorldPoints(seed){
  const points=[];
  const seen=new Set();
  const add=(x,y,kind,id)=>{
    const sx=String(x??"0"),sy=String(y??"0"),key=sx+"|"+sy;
    if(seen.has(key))return;
    seen.add(key);points.push(Object.freeze({x:sx,y:sy,kind:String(kind||"support"),id:String(id||key)}));
  };
  add("0","0","origin","world-origin");
  const country=originCountry(seed);
  if(country){
    add(country.politicalCenter?.x,country.politicalCenter?.y,"country-center",country.id);
    add(country.capital?.x,country.capital?.y,"capital",country.capital?.id||country.id+"|capital");
    try{
      const plans=window.SettlementArchetypes?.settlementsForCountry?.(seed,country,2)||[];
      for(const plan of plans.slice(0,MAX_SUPPORT_SETTLEMENTS))add(plan.center?.x,plan.center?.y,"settlement",plan.id);
    }catch(_){}
  }
  const scale=tileMeters();
  for(const radiusMeters of SUPPORT_RING_METERS){
    const r=Math.max(1,Math.round(radiusMeters/scale));
    add(String(r),"0","support-ring","east-"+radiusMeters);
    add(String(-r),"0","support-ring","west-"+radiusMeters);
    add("0",String(r),"support-ring","north-"+radiusMeters);
    add("0",String(-r),"support-ring","south-"+radiusMeters);
  }
  return Object.freeze(points);
}
function scoreAnchor(seed,geography,latitudeRadians,longitudeRadians,points){
  let score=0,landCount=0,settlementLandCount=0,settlementCount=0,waterCount=0;
  for(const point of points){
    const offset=relativeMeters(point.x,point.y);
    const projected=destination(latitudeRadians,longitudeRadians,offset.east,offset.north);
    let sample=null;
    try{sample=geography?.sampleLatLon?.(projected.latitudeRadians,projected.longitudeRadians)||null}catch(_){sample=null}
    const important=point.kind==="origin"||point.kind==="settlement"||point.kind==="capital";
    if(point.kind==="settlement")settlementCount++;
    if(sample?.land){
      landCount++;
      if(point.kind==="settlement")settlementLandCount++;
      score+=important?12:4;
      const elevation=Number(sample.elevationMeters||0);
      if(elevation>=40&&elevation<=2200)score+=important?3:1;
      if(elevation>3600)score-=important?3:1;
      if(sample.surfaceClass==="coast")score-=important?1:.25;
    }else{
      waterCount++;
      score-=important?24:7;
    }
  }
  score-=Math.abs(latitudeRadians)*2.4;
  return Object.freeze({score,landCount,settlementLandCount,settlementCount,waterCount});
}
function chooseAnchor(seed,geography,points){
  const phase=unit(seed,"planet-world-projection:longitude-phase")*Math.PI*2;
  let best=null,index=0;
  for(const latDegrees of LATITUDE_BANDS){
    const latitudeRadians=latDegrees*Math.PI/180;
    for(let slot=0;slot<LONGITUDE_SLOTS;slot++){
      const longitudeRadians=wrapLongitude(phase+slot*(Math.PI*2/LONGITUDE_SLOTS));
      const scored=scoreAnchor(seed,geography,latitudeRadians,longitudeRadians,points);
      const candidate={
        index:index++,latitudeRadians,longitudeRadians,
        latitudeDegrees:latDegrees,longitudeDegrees:longitudeRadians*180/Math.PI,
        ...scored
      };
      if(
        !best||
        candidate.settlementLandCount>best.settlementLandCount||
        (candidate.settlementLandCount===best.settlementLandCount&&candidate.landCount>best.landCount)||
        (candidate.settlementLandCount===best.settlementLandCount&&candidate.landCount===best.landCount&&candidate.score>best.score)||
        (candidate.settlementLandCount===best.settlementLandCount&&candidate.landCount===best.landCount&&candidate.score===best.score&&candidate.index<best.index)
      )best=candidate;
    }
  }
  return Object.freeze(best);
}
function build(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(cache.has(seed))return cache.get(seed);
  const geography=window.PlanetGeography?.create?.(seed);
  if(!geography)throw new Error("PlanetGeography unavailable for world projection");
  const support=supportWorldPoints(seed);
  const anchor=chooseAnchor(seed,geography,support);
  const scale=tileMeters();
  const project=(xValue,yValue)=>{
    const offset=relativeMeters(xValue,yValue);
    const location=destination(anchor.latitudeRadians,anchor.longitudeRadians,offset.east,offset.north);
    let sample=null;
    try{sample=geography.sampleLatLon(location.latitudeRadians,location.longitudeRadians)}catch(_){sample=null}
    return Object.freeze({
      x:String(xValue??"0"),y:String(yValue??"0"),
      latitudeRadians:location.latitudeRadians,longitudeRadians:location.longitudeRadians,
      latitudeDegrees:Number((location.latitudeRadians*180/Math.PI).toFixed(6)),
      longitudeDegrees:Number((location.longitudeRadians*180/Math.PI).toFixed(6)),
      eastMeters:offset.east,northMeters:offset.north,
      land:Boolean(sample?.land),surfaceClass:String(sample?.surfaceClass||"unknown"),
      elevationMeters:Number(sample?.elevationMeters||0)
    });
  };
  const unproject=(latitudeRadians,longitudeRadians)=>{
    const offset=inverseDestination(anchor.latitudeRadians,anchor.longitudeRadians,latitudeRadians,longitudeRadians);
    const x=Math.round(offset.eastMeters/scale),y=Math.round(offset.northMeters/scale);
    return Object.freeze({
      x:String(x),y:String(y),
      eastMeters:offset.eastMeters,northMeters:offset.northMeters,
      distanceMeters:offset.distanceMeters,bearingRadians:offset.bearingRadians
    });
  };
  const projectedSupport=support.map(point=>Object.freeze({...point,projection:project(point.x,point.y)}));
  const result=Object.freeze({
    version:VERSION,seed,
    authority:"presentation-projection-only",
    worldAuthority:"canonical-planar-world",
    planetAuthority:"PlanetGeography",
    tileMeters:scale,
    radiusMeters:WORLD_RADIUS_METERS,
    anchor:Object.freeze({
      latitudeRadians:anchor.latitudeRadians,longitudeRadians:anchor.longitudeRadians,
      latitudeDegrees:Number(anchor.latitudeDegrees.toFixed(6)),longitudeDegrees:Number(anchor.longitudeDegrees.toFixed(6)),
      score:Number(anchor.score.toFixed(3)),landCount:anchor.landCount,waterCount:anchor.waterCount,
      settlementLandCount:anchor.settlementLandCount,settlementCount:anchor.settlementCount,
      candidateCount:LATITUDE_BANDS.length*LONGITUDE_SLOTS
    }),
    support:Object.freeze({
      count:support.length,
      settlementCount:support.filter(point=>point.kind==="settlement").length,
      projectedLandCount:projectedSupport.filter(point=>point.projection.land).length,
      projectedSettlementLandCount:projectedSupport.filter(point=>point.kind==="settlement"&&point.projection.land).length,
      fullWorldScan:false
    }),
    project,unproject,
    projectSettlement(plan){return plan?.center?project(plan.center.x,plan.center.y):null;},
    roundTrip(xValue,yValue){
      const projected=project(xValue,yValue),returned=unproject(projected.latitudeRadians,projected.longitudeRadians);
      return Object.freeze({
        projected,returned,
        deltaTiles:Object.freeze({
          x:Number(toBig(returned.x)-toBig(xValue)),
          y:Number(toBig(returned.y)-toBig(yValue))
        })
      });
    }
  });
  cache.set(seed,result);
  return result;
}
function clear(seedValue){
  if(seedValue==null){cache.clear();return;}
  cache.delete(String(seedValue));
}

window.PlanetWorldProjection=Object.freeze({
  VERSION,WORLD_RADIUS_METERS,
  forSeed:build,create:build,clear,
  destination,inverseDestination
});
})();