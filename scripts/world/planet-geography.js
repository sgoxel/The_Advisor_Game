(function(){
"use strict";

const VERSION="planetary-geography-v4";
const DEFAULT_SEED="The_Advisor_Game_Planet_001";
const STORAGE_KEY="advisor.planet.seed.v1";
const CONTINENT_COUNT=5;
const CONTINENT_LOBES_PER=6;
const ISLAND_CHAIN_COUNT=4;
const ISLANDS_PER_CHAIN=9;
const ISOLATED_ISLAND_COUNT=8;
const MOUNTAIN_NODES_PER_CONTINENT=9;

function clamp(v,a=0,b=1){return Math.min(b,Math.max(a,Number(v)||0));}
function smooth01(v){const t=clamp(v);return t*t*(3-2*t);}
function lerp(a,b,t){return a+(b-a)*t;}
function hash32(text){
  let h=2166136261>>>0;
  const s=String(text);
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;h^=h>>>15;
  return h>>>0;
}
function rngFromSeed(seed,salt){
  let a=hash32(String(seed)+"|"+String(salt))||0x9e3779b9;
  return function(){
    a|=0;a=(a+0x6D2B79F5)|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=(t+Math.imul(t^t>>>7,61|t))^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
function normalize(x,y,z){
  const len=Math.hypot(x,y,z)||1;
  return Object.freeze({x:x/len,y:y/len,z:z/len});
}
function dot(a,b){return a.x*b.x+a.y*b.y+a.z*b.z;}
function cross(a,b){return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
function addScaled(a,b,scale){return {x:a.x+b.x*scale,y:a.y+b.y*scale,z:a.z+b.z*scale};}
function randomUnit(rng,latitudeLimit=0.88){
  const y=(rng()*2-1)*latitudeLimit;
  const a=rng()*Math.PI*2;
  const r=Math.sqrt(Math.max(0,1-y*y));
  return normalize(Math.sin(a)*r,y,Math.cos(a)*r);
}
function tangentBasis(center){
  const ref=Math.abs(center.y)<0.92?{x:0,y:1,z:0}:{x:1,y:0,z:0};
  const u0=cross(ref,center),u=normalize(u0.x,u0.y,u0.z);
  const v0=cross(center,u),v=normalize(v0.x,v0.y,v0.z);
  return {u,v};
}
function offsetOnSphere(center,angle,bearing){
  const basis=tangentBasis(center);
  const tangent={
    x:basis.u.x*Math.cos(bearing)+basis.v.x*Math.sin(bearing),
    y:basis.u.y*Math.cos(bearing)+basis.v.y*Math.sin(bearing),
    z:basis.u.z*Math.cos(bearing)+basis.v.z*Math.sin(bearing)
  };
  return normalize(
    center.x*Math.cos(angle)+tangent.x*Math.sin(angle),
    center.y*Math.cos(angle)+tangent.y*Math.sin(angle),
    center.z*Math.cos(angle)+tangent.z*Math.sin(angle)
  );
}
function lobe(center,radius,innerRatio=0.36,weight=1){
  const outer=Math.max(0.01,Number(radius)||0.5);
  const inner=outer*clamp(innerRatio,0.08,0.88);
  return Object.freeze({
    center,
    radius:outer,
    cosOuter:Math.cos(outer),
    cosInner:Math.cos(inner),
    weight:Number(weight)||1
  });
}
function lobeInfluence(direction,item){
  const d=dot(direction,item.center);
  if(d<=item.cosOuter)return 0;
  const denom=Math.max(1e-9,item.cosInner-item.cosOuter);
  return smooth01((d-item.cosOuter)/denom)*item.weight;
}
function maxInfluence(direction,items){
  let best=0;
  for(const item of items)best=Math.max(best,lobeInfluence(direction,item));
  return clamp(best);
}
function intHash(base,x,y,z){
  let h=(base^Math.imul(x|0,0x9e3779b1)^Math.imul(y|0,0x85ebca77)^Math.imul(z|0,0xc2b2ae3d))>>>0;
  h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;
  return h>>>0;
}
function noise3(base,x,y,z){
  const x0=Math.floor(x),y0=Math.floor(y),z0=Math.floor(z);
  const tx=smooth01(x-x0),ty=smooth01(y-y0),tz=smooth01(z-z0);
  const r=(ix,iy,iz)=>intHash(base,ix,iy,iz)/4294967295;
  const x00=lerp(r(x0,y0,z0),r(x0+1,y0,z0),tx);
  const x10=lerp(r(x0,y0+1,z0),r(x0+1,y0+1,z0),tx);
  const x01=lerp(r(x0,y0,z0+1),r(x0+1,y0,z0+1),tx);
  const x11=lerp(r(x0,y0+1,z0+1),r(x0+1,y0+1,z0+1),tx);
  return lerp(lerp(x00,x10,ty),lerp(x01,x11,ty),tz);
}
function fbm3(base,direction,frequency=1,octaves=4){
  let value=0,total=0,amp=1,f=frequency;
  for(let i=0;i<octaves;i++){
    value+=noise3(base,direction.x*f+17.3,direction.y*f-9.7,direction.z*f+3.1)*amp;
    total+=amp;amp*=0.5;f*=2.03;
  }
  return total?value/total:0.5;
}
function ridged3(base,direction,frequency=1,octaves=3){
  const n=fbm3(base,direction,frequency,octaves);
  const r=1-Math.abs(n*2-1);
  return r*r;
}
function sanitizeSeed(value){
  const clean=String(value??"").trim().replace(/[^A-Za-z0-9._:-]/g,"_").slice(0,64);
  return clean||DEFAULT_SEED;
}
function resolveSeed(){
  let urlSeed=null;
  try{urlSeed=new URLSearchParams(location.search).get("seed");}catch(_){}
  if(urlSeed){
    const seed=sanitizeSeed(urlSeed);
    try{localStorage.setItem(STORAGE_KEY,seed);}catch(_){}
    return seed;
  }
  try{
    const saved=localStorage.getItem(STORAGE_KEY);
    if(saved)return sanitizeSeed(saved);
  }catch(_){}
  try{localStorage.setItem(STORAGE_KEY,DEFAULT_SEED);}catch(_){}
  return DEFAULT_SEED;
}
function persistSeed(value){
  const seed=sanitizeSeed(value);
  try{localStorage.setItem(STORAGE_KEY,seed);}catch(_){}
  return seed;
}
function directionFromLatLon(latitudeRadians,longitudeRadians){
  const lat=clamp(Number(latitudeRadians),-Math.PI/2,Math.PI/2);
  const lon=Number(longitudeRadians)||0;
  let c=Math.cos(lat);
  if(Math.abs(c)<1e-12)c=0;
  return normalize(Math.sin(lon)*c,Math.sin(lat),Math.cos(lon)*c);
}
function colorFor(sample){
  const e=sample.elevationMeters;
  const lat=Math.abs(sample.latitudeRadians)/(Math.PI/2);
  const wet=sample.moisture;
  if(!sample.land){
    const shallow=clamp((e+1900)/1800);
    if(e<-3000)return [0.012,0.055,0.13];
    if(e<-1000)return [lerp(0.015,0.025,shallow),lerp(0.09,0.19,shallow),lerp(0.20,0.34,shallow)];
    return [0.035,lerp(0.22,0.36,shallow),lerp(0.38,0.52,shallow)];
  }
  if(e<90)return [0.62,0.56,0.34];
  if(e<650){
    const dry=clamp(1-wet);
    return [lerp(0.10,0.34,dry),lerp(0.38,0.36,dry),lerp(0.16,0.18,dry)];
  }
  if(e<1800){
    const t=clamp((e-650)/1150);
    return [lerp(0.22,0.38,t),lerp(0.34,0.36,t),lerp(0.16,0.24,t)];
  }
  if(e<3400){
    const t=clamp((e-1800)/1600);
    return [lerp(0.37,0.46,t),lerp(0.33,0.42,t),lerp(0.25,0.35,t)];
  }
  const snow=clamp((e-4550)/1750+Math.max(0,lat-0.62)*0.75);
  return [lerp(0.44,0.94,snow),lerp(0.42,0.95,snow),lerp(0.39,0.97,snow)];
}
function create(seedValue){
  const seed=sanitizeSeed(seedValue);
  const rng=rngFromSeed(seed,"layout");
  const centers=[];
  const minDot=Math.cos(0.88);
  for(let c=0;c<CONTINENT_COUNT;c++){
    let chosen=null;
    for(let attempt=0;attempt<80;attempt++){
      const candidate=randomUnit(rng,0.82);
      if(centers.every(existing=>dot(candidate,existing)<minDot)){chosen=candidate;break;}
      if(!chosen)chosen=candidate;
    }
    centers.push(chosen);
  }

  const continentLobes=[];
  const continentGroups=[];
  centers.forEach((center,index)=>{
    const group=[];
    const mainRadius=0.58+rng()*0.17;
    const main=lobe(center,mainRadius,0.28,1);
    continentLobes.push(main);group.push(main);
    const primaryBearing=rng()*Math.PI*2;
    for(let j=1;j<CONTINENT_LOBES_PER;j++){
      const bearing=primaryBearing+(j-1)*(Math.PI*0.43)+(rng()-0.5)*0.78;
      const offset=mainRadius*(0.24+rng()*0.52);
      const childCenter=offsetOnSphere(center,offset,bearing);
      const radius=mainRadius*(0.32+rng()*0.34);
      const child=lobe(childCenter,radius,0.30,0.94);
      continentLobes.push(child);group.push(child);
    }
    continentGroups.push(Object.freeze({id:index,center,lobes:Object.freeze(group)}));
  });

  const isolatedIslands=[];
  for(let i=0;i<ISOLATED_ISLAND_COUNT;i++){
    let center=randomUnit(rng,0.9);
    for(let attempt=0;attempt<30&&maxInfluence(center,continentLobes)>0.26;attempt++)center=randomUnit(rng,0.9);
    isolatedIslands.push(lobe(center,0.065+rng()*0.085,0.22,0.95));
  }
  const islandChains=[];
  for(let chain=0;chain<ISLAND_CHAIN_COUNT;chain++){
    let origin=randomUnit(rng,0.88);
    for(let attempt=0;attempt<30&&maxInfluence(origin,continentLobes)>0.38;attempt++)origin=randomUnit(rng,0.88);
    const bearing=rng()*Math.PI*2;
    const nodes=[];
    for(let i=0;i<ISLANDS_PER_CHAIN;i++){
      const centered=i-(ISLANDS_PER_CHAIN-1)/2;
      const chainOffset=Math.abs(centered)*(0.046+rng()*0.014);
      const sideBend=Math.sin(centered*0.92)*(0.16+rng()*0.16);
      const center=offsetOnSphere(origin,chainOffset,bearing+(centered<0?Math.PI:0)+sideBend+(rng()-0.5)*0.22);
      const radius=(0.044+rng()*0.034)*(1-Math.min(0.22,Math.abs(centered)*0.03));
      nodes.push(lobe(center,radius,0.18,0.80+rng()*0.12));
    }
    islandChains.push(...nodes);
  }
  const islandLobes=Object.freeze([...isolatedIslands,...islandChains]);

  const mountainNodes=[];
  continentGroups.forEach(group=>{
    const rngMountain=rngFromSeed(seed,"mountain:"+group.id);
    const bearing=rngMountain()*Math.PI*2;
    const span=0.78;
    for(let i=0;i<MOUNTAIN_NODES_PER_CONTINENT;i++){
      const t=i/(MOUNTAIN_NODES_PER_CONTINENT-1)-0.5;
      const angle=Math.abs(t)*span;
      const directionBearing=bearing+(t<0?Math.PI:0)+(rngMountain()-0.5)*0.14;
      const center=offsetOnSphere(group.center,angle,directionBearing);
      mountainNodes.push(lobe(center,0.082+rngMountain()*0.060,0.20,0.86+0.14*(1-Math.abs(t)*2)));
    }
  });

  const bases=Object.freeze({
    coast:hash32(seed+"|coast"),
    detail:hash32(seed+"|detail"),
    highland:hash32(seed+"|highland"),
    mountain:hash32(seed+"|mountain-noise"),
    peak:hash32(seed+"|peak-noise"),
    ocean:hash32(seed+"|ocean"),
    moisture:hash32(seed+"|moisture"),
    warpX:hash32(seed+"|warp-x"),
    warpY:hash32(seed+"|warp-y"),
    warpZ:hash32(seed+"|warp-z")
  });

  function sampleDirection(directionValue){
    const d=normalize(directionValue.x,directionValue.y,directionValue.z);
    const warpFrequency=2.15,warpStrength=0.18;
    const wx=(noise3(bases.warpX,d.x*warpFrequency+4.1,d.y*warpFrequency-1.7,d.z*warpFrequency+2.3)-0.5)*2*warpStrength;
    const wy=(noise3(bases.warpY,d.x*warpFrequency-3.4,d.y*warpFrequency+5.2,d.z*warpFrequency-0.9)-0.5)*2*warpStrength;
    const wz=(noise3(bases.warpZ,d.x*warpFrequency+1.2,d.y*warpFrequency+0.8,d.z*warpFrequency-4.6)-0.5)*2*warpStrength;
    const warped=normalize(d.x+wx,d.y+wy,d.z+wz);
    const continent=maxInfluence(warped,continentLobes);
    const island=maxInfluence(warped,islandLobes);
    const coastNoise=(fbm3(bases.coast,warped,2.7,4)-0.5)*0.44+(fbm3(bases.detail,warped,9.5,3)-0.5)*0.12;
    const islandRough=(fbm3(bases.detail,warped,18.5,3)-0.5)*0.44;
    const islandCut=(ridged3(bases.coast,warped,31.0,2)-0.5)*0.24;
    const continentSignal=continent+coastNoise;
    const islandSignal=island*1.03+coastNoise*0.42+islandRough*clamp(island*1.65)-islandCut*clamp(1-island);
    const landSignal=Math.max(continentSignal,islandSignal)-0.33;
    const land=landSignal>0;
    const interior=land?clamp(landSignal/0.56):0;
    const mountainBase=maxInfluence(warped,mountainNodes);
    const mountainNoise=0.34+0.66*ridged3(bases.mountain,warped,10.5,3);
    const mountainInfluence=land?clamp(mountainBase*mountainNoise*smooth01(interior*1.85)):0;
    const highlandNoise=fbm3(bases.highland,warped,5.4,4);
    const peakNoise=ridged3(bases.peak,warped,22.0,3);
    const moisture=fbm3(bases.moisture,warped,3.8,3);

    let elevationMeters;
    if(land){
      const rolling=Math.max(0,highlandNoise-0.40)*920;
      const base=35+interior*760+rolling;
      const mountains=Math.pow(mountainInfluence,1.48)*(2300+2900*peakNoise);
      const exceptional=Math.pow(mountainInfluence,3.4)*(350+1050*peakNoise);
      elevationMeters=clamp(base+mountains+exceptional,5,7000);
    }else{
      const deep=clamp((-landSignal+0.04)/0.42);
      const oceanNoise=fbm3(bases.ocean,warped,3.2,3);
      elevationMeters=-clamp(120+deep*(1350+3900*oceanNoise),80,5500);
    }

    const latitudeRadians=Math.asin(clamp(d.y,-1,1));
    const longitudeRadians=Math.atan2(d.x,d.z);
    let surfaceClass;
    if(!land)surfaceClass=elevationMeters<-2800?"deep-ocean":elevationMeters<-700?"ocean":"shallow-ocean";
    else if(elevationMeters<90)surfaceClass="coast";
    else if(elevationMeters<650)surfaceClass="lowland";
    else if(elevationMeters<1800)surfaceClass="highland";
    else if(elevationMeters<3400)surfaceClass="mountain";
    else surfaceClass="high-peak";

    const result={
      version:VERSION,seed,
      direction:Object.freeze({x:d.x,y:d.y,z:d.z}),
      latitudeRadians,longitudeRadians,
      land,
      surfaceClass,
      elevationMeters:Number(elevationMeters.toFixed(2)),
      continentInfluence:Number(continent.toFixed(5)),
      islandInfluence:Number(island.toFixed(5)),
      mountainInfluence:Number(mountainInfluence.toFixed(5)),
      moisture:Number(moisture.toFixed(5))
    };
    result.color=Object.freeze(colorFor(result).map(v=>Number(v.toFixed(5))));
    return Object.freeze(result);
  }
  function sampleLatLon(latitudeRadians,longitudeRadians){
    return sampleDirection(directionFromLatLon(latitudeRadians,longitudeRadians));
  }
  function signature(){
    let h=2166136261>>>0;
    let landCount=0,mountainCount=0,islandCount=0,minElevation=Infinity,maxElevation=-Infinity;
    for(let lat=-75;lat<=75;lat+=10){
      for(let lon=-180;lon<180;lon+=10){
        const s=sampleLatLon(lat*Math.PI/180,lon*Math.PI/180);
        const q=Math.round(s.elevationMeters/10);
        h^=(q&0xffff);h=Math.imul(h,16777619)>>>0;
        h^=hash32(s.surfaceClass);h=Math.imul(h,16777619)>>>0;
        if(s.land)landCount++;
        if(s.mountainInfluence>0.18)mountainCount++;
        if(s.islandInfluence>0.28&&s.continentInfluence<0.2)islandCount++;
        minElevation=Math.min(minElevation,s.elevationMeters);
        maxElevation=Math.max(maxElevation,s.elevationMeters);
      }
    }
    return Object.freeze({
      version:VERSION,seed,
      hash:h.toString(16).padStart(8,"0"),
      landCount,mountainCount,islandCount,
      minElevationMeters:Number(minElevation.toFixed(2)),
      maxElevationMeters:Number(maxElevation.toFixed(2))
    });
  }
  function seamProof(){
    const samples=[-75,-45,-15,0,15,45,75].map(degrees=>{
      const lat=degrees*Math.PI/180;
      const a=sampleLatLon(lat,-Math.PI);
      const b=sampleLatLon(lat,Math.PI);
      return Object.freeze({
        latitudeDegrees:degrees,
        elevationDeltaMeters:Number(Math.abs(a.elevationMeters-b.elevationMeters).toFixed(6)),
        classMatch:a.surfaceClass===b.surfaceClass,
        colorDelta:Number(Math.max(...a.color.map((v,i)=>Math.abs(v-b.color[i]))).toFixed(7))
      });
    });
    const north=[-150,-60,0,70,160].map(lon=>sampleLatLon(Math.PI/2,lon*Math.PI/180).elevationMeters);
    const south=[-150,-60,0,70,160].map(lon=>sampleLatLon(-Math.PI/2,lon*Math.PI/180).elevationMeters);
    return Object.freeze({
      longitude:Object.freeze(samples),
      longitudePass:samples.every(x=>x.elevationDeltaMeters<=0.001&&x.classMatch&&x.colorDelta<=0.00001),
      northPoleRangeMeters:Number((Math.max(...north)-Math.min(...north)).toFixed(6)),
      southPoleRangeMeters:Number((Math.max(...south)-Math.min(...south)).toFixed(6))
    });
  }
  return Object.freeze({
    VERSION,seed,
    sampleDirection,sampleLatLon,signature,seamProof,
    layout:Object.freeze({
      continentCount:CONTINENT_COUNT,
      continentLobeCount:continentLobes.length,
      islandNodeCount:islandLobes.length,
      mountainNodeCount:mountainNodes.length
    })
  });
}
function signatureForSeed(seed){return create(seed).signature();}
function verifyDeterminism(seedValue){
  const seed=sanitizeSeed(seedValue);
  const a=create(seed),b=create(seed),other=create(seed+"__alternate");
  const sa=a.signature(),sb=b.signature(),so=other.signature(),seam=a.seamProof();
  return Object.freeze({
    version:VERSION,seed,
    sameSeedHashA:sa.hash,
    sameSeedHashB:sb.hash,
    alternateSeedHash:so.hash,
    sameSeedMatch:sa.hash===sb.hash,
    differentSeedChanges:sa.hash!==so.hash,
    seam,
    pass:sa.hash===sb.hash&&sa.hash!==so.hash&&seam.longitudePass&&seam.northPoleRangeMeters<=0.001&&seam.southPoleRangeMeters<=0.001
  });
}

window.PlanetGeography=Object.freeze({
  VERSION,DEFAULT_SEED,STORAGE_KEY,
  create,signatureForSeed,verifyDeterminism,
  resolveSeed,persistSeed,sanitizeSeed,directionFromLatLon
});
})();