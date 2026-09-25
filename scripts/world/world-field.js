(function(){
"use strict";

const VERSION="continuous-world-field-v1";
const SEA_LEVEL_METERS=0;
const SAMPLE_CACHE_LIMIT=8192;
const LANDFORM_CACHE_LIMIT=4096;
const DEFAULT_LANDFORM_RADIUS_METERS=96;
const sampleCache=new Map();
const landformCache=new Map();
let sampleCalls=0,sampleCacheHits=0,landformCalls=0,landformCacheHits=0;

function clamp(v,a,b){return Math.min(b,Math.max(a,v));}
function smoothstep01(value){const t=clamp(Number(value)||0,0,1);return t*t*(3-2*t);}
function lerp(a,b,t){return a+(b-a)*t;}
function hash32(text){
  let h=2166136261>>>0;
  const s=String(text);
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;h^=h>>>15;
  return h>>>0;
}
function unit(seed,key){
  if(window.PRNG?.foundationUint32)return window.PRNG.foundationUint32(String(seed),String(key))/4294967296;
  return hash32(String(seed)+"|"+String(key))/4294967296;
}
function floorDivBig(value,divisor){
  let q=value/divisor,r=value%divisor;
  if(r<0n)q-=1n;
  return q;
}
function coordinate(value){
  if(typeof value==="bigint")return Object.freeze({whole:value,fraction:0,key:value.toString()});
  const text=String(value??"0").trim();
  if(/^[+-]?\d+$/.test(text)){
    const whole=BigInt(text);
    return Object.freeze({whole,fraction:0,key:whole.toString()});
  }
  const n=Number(value);
  if(!Number.isFinite(n))return Object.freeze({whole:0n,fraction:0,key:"0"});
  const wholeNumber=Math.floor(n);
  if(!Number.isSafeInteger(wholeNumber)){
    const rounded=BigInt(Math.trunc(n));
    return Object.freeze({whole:rounded,fraction:0,key:rounded.toString()});
  }
  const whole=BigInt(wholeNumber),fraction=n-wholeNumber;
  return Object.freeze({whole,fraction,key:String(n)});
}
function offsetCoordinate(value,deltaMeters){
  const c=coordinate(value),d=Number(deltaMeters)||0;
  if(Number.isInteger(d)&&c.fraction===0)return (c.whole+BigInt(d)).toString();
  const wholeNumber=Number(c.whole);
  if(!Number.isSafeInteger(wholeNumber))return c.key;
  return wholeNumber+c.fraction+d;
}
function lattice(c,scaleMeters){
  const scale=Math.max(1,Math.trunc(Number(scaleMeters)||1));
  const s=BigInt(scale);
  const cell=floorDivBig(c.whole,s);
  const rem=c.whole-cell*s;
  const local=clamp((Number(rem)+c.fraction)/scale,0,1);
  return Object.freeze({cell,local:smoothstep01(local)});
}
function valueNoise(seed,label,xMeters,zMeters,scaleMeters){
  const x=coordinate(xMeters),z=coordinate(zMeters);
  const lx=lattice(x,scaleMeters),lz=lattice(z,scaleMeters);
  const key=(gx,gz)=>String(label)+":"+gx.toString()+":"+gz.toString();
  const n00=unit(seed,key(lx.cell,lz.cell));
  const n10=unit(seed,key(lx.cell+1n,lz.cell));
  const n01=unit(seed,key(lx.cell,lz.cell+1n));
  const n11=unit(seed,key(lx.cell+1n,lz.cell+1n));
  const nx0=lerp(n00,n10,lx.local),nx1=lerp(n01,n11,lx.local);
  return lerp(nx0,nx1,lz.local);
}
function fractal(seed,label,x,z,layers){
  let value=0,total=0;
  for(const [scale,weight] of layers){value+=valueNoise(seed,label+":"+scale,x,z,scale)*weight;total+=weight;}
  return total>0?value/total:0.5;
}
function ridged(seed,label,x,z,layers){
  let value=0,total=0;
  for(const [scale,weight] of layers){
    const n=valueNoise(seed,label+":"+scale,x,z,scale);
    const ridge=1-Math.abs(n*2-1);
    value+=ridge*ridge*weight;total+=weight;
  }
  return total>0?value/total:0;
}
function safeDistanceFromOrigin(x,z){
  const cx=coordinate(x),cz=coordinate(z);
  const nx=Number(cx.whole),nz=Number(cz.whole);
  if(!Number.isSafeInteger(nx)||!Number.isSafeInteger(nz))return Number.POSITIVE_INFINITY;
  return Math.hypot(nx+cx.fraction,nz+cz.fraction);
}
function climateName(temp,moisture){
  let name=temp<=5?"Cold":temp>=23?"Warm":"Temperate";
  if(moisture>=74)name+=" Wet";
  else if(moisture<=29)name+=" Dry";
  return name;
}
function surfaceFor(elevation,moisture,temp,geology,vegetation,riverWater=false){
  if(elevation<=SEA_LEVEL_METERS||riverWater)return "water";
  if(elevation>=1750||geology>0.79&&elevation>760)return "rock";
  if(moisture>=82&&elevation<360)return "mud";
  if(moisture<=23&&temp>=17)return geology>0.48?"sand":"dirt";
  if(vegetation>0.56&&moisture>=48&&elevation<1450)return "forest";
  if(geology>0.73&&moisture<52)return "dirt";
  return "grass";
}
function biomeFor(elevation,moisture,temp,surface){
  if(surface==="water")return "Water";
  if(elevation>=1900)return "Alpine";
  if(elevation>=1200)return moisture>=55?"Forested Highland":"Highland";
  if(temp<=4)return moisture>=55?"Cold Forest":"Cold Steppe";
  if(moisture>=72)return "Woodland";
  if(moisture<=27)return temp>=19?"Warm Scrub":"Dry Steppe";
  if(surface==="forest")return "Temperate Forest";
  return "Grassland";
}
function sample(seedValue,xMetersValue,zMetersValue){
  const seed=String(seedValue??"");
  const x=coordinate(xMetersValue),z=coordinate(zMetersValue);
  const cacheKey=seed+"|"+x.key+"|"+z.key;
  const cached=sampleCache.get(cacheKey);
  if(cached){sampleCacheHits++;return cached;}
  sampleCalls++;

  const continental=fractal(seed,"world:continent",x.key,z.key,[[180000,0.52],[76000,0.30],[31000,0.18]]);
  const regional=fractal(seed,"world:regional",x.key,z.key,[[11000,0.48],[4200,0.32],[1500,0.20]]);
  const ridge=ridged(seed,"world:ridge",x.key,z.key,[[7200,0.52],[2600,0.30],[880,0.18]]);
  const local=fractal(seed,"world:detail",x.key,z.key,[[720,0.48],[260,0.32],[92,0.20]]);
  const moistureField=fractal(seed,"world:moisture",x.key,z.key,[[24000,0.55],[6200,0.29],[1300,0.16]]);
  const temperatureField=fractal(seed,"world:temperature",x.key,z.key,[[42000,0.62],[9800,0.25],[2200,0.13]]);
  const geology=fractal(seed,"world:geology",x.key,z.key,[[15000,0.58],[3600,0.27],[820,0.15]]);
  const vegetation=fractal(seed,"world:vegetation",x.key,z.key,[[5200,0.50],[1300,0.31],[310,0.19]]);
  const valleyBand=Math.abs(valueNoise(seed,"world:valley-band",x.key,z.key,3300)*2-1);
  const valleyMask=1-smoothstep01((valleyBand-0.035)/0.19);
  const landMask=smoothstep01((continental-0.39)/0.25);
  const mountainMask=smoothstep01((continental-0.44)/0.22)*smoothstep01((regional-0.43)/0.33);

  let elevation=(continental-0.455)*1120;
  elevation+=(regional-0.5)*430;
  elevation+=Math.pow(ridge,1.7)*mountainMask*1680;
  elevation+=(local-0.5)*150;
  elevation-=valleyMask*mountainMask*(95+ridge*190);

  const originDistance=safeDistanceFromOrigin(x.key,z.key);
  if(Number.isFinite(originDistance)&&originDistance<4200){
    const starter=smoothstep01(1-originDistance/4200);
    const gentle=fractal(seed,"world:starter-gentle",x.key,z.key,[[980,0.62],[310,0.26],[110,0.12]]);
    const target=128+(gentle-0.5)*72;
    elevation=lerp(elevation,target,starter*0.94);
  }

  elevation=clamp(elevation,-620,3350);
  const moisture=clamp(Math.round(10+88*moistureField+valleyMask*8-landMask*2),4,100);
  const altitudeCooling=Math.max(0,elevation)/235;
  const temp=clamp(Math.round(4+28*temperatureField-altitudeCooling),-12,33);
  const riverWater=originDistance>=1800&&valleyMask>=0.80&&moisture>=52&&elevation>SEA_LEVEL_METERS&&elevation<900;
  const surfaceType=surfaceFor(elevation,moisture,temp,geology,vegetation,riverWater);
  const climate=climateName(temp,moisture);
  const biome=biomeFor(elevation,moisture,temp,surfaceType);

  const result=Object.freeze({
    version:VERSION,
    xMeters:x.key,zMeters:z.key,
    elevationMeters:Number(elevation.toFixed(3)),
    moisturePercent:moisture,
    temperatureC:temp,
    climate,biome,surfaceType,
    seaLevelMeters:SEA_LEVEL_METERS,
    waterKind:surfaceType==="water"?(riverWater?"river":"ocean"):null,
    foundation:Object.freeze({
      continental:Number(continental.toFixed(5)),
      regional:Number(regional.toFixed(5)),
      ridge:Number(ridge.toFixed(5)),
      valley:Number(valleyMask.toFixed(5)),
      geology:Number(geology.toFixed(5)),
      vegetation:Number(vegetation.toFixed(5))
    }),
    deterministic:true,
    continuousMeterField:true,
    tileAuthority:false,
    chunkAuthority:false
  });
  sampleCache.set(cacheKey,result);
  if(sampleCache.size>SAMPLE_CACHE_LIMIT){
    const oldest=sampleCache.keys().next().value;
    if(oldest!==undefined)sampleCache.delete(oldest);
  }
  return result;
}
function elevationMeters(seed,x,z){return Number(sample(seed,x,z).elevationMeters);}
function landform(seedValue,xMetersValue,zMetersValue,radiusMetersValue=DEFAULT_LANDFORM_RADIUS_METERS){
  const seed=String(seedValue??"");
  const x=coordinate(xMetersValue),z=coordinate(zMetersValue);
  const radius=Math.max(16,Math.min(640,Math.round(Number(radiusMetersValue)||DEFAULT_LANDFORM_RADIUS_METERS)));
  const cacheKey=seed+"|"+x.key+"|"+z.key+"|"+radius;
  const cached=landformCache.get(cacheKey);
  if(cached){landformCacheHits++;return cached;}
  landformCalls++;
  const at=(dx,dz)=>sample(seed,offsetCoordinate(x.key,dx),offsetCoordinate(z.key,dz));
  const center=at(0,0),n=at(0,-radius),e=at(radius,0),s=at(0,radius),w=at(-radius,0);
  const ne=at(radius,-radius),nw=at(-radius,-radius),se=at(radius,radius),sw=at(-radius,radius);
  const values=[center,n,e,s,w,ne,nw,se,sw].map(v=>Number(v.elevationMeters));
  const c=values[0];
  const relief=Math.max(...values)-Math.min(...values);
  const gradientX=(Number(e.elevationMeters)-Number(w.elevationMeters))/(2*radius);
  const gradientZ=(Number(s.elevationMeters)-Number(n.elevationMeters))/(2*radius);
  const gradient=Math.hypot(gradientX,gradientZ);
  const curvature=c-(Number(n.elevationMeters)+Number(e.elevationMeters)+Number(s.elevationMeters)+Number(w.elevationMeters))/4;
  const xSaddle=Math.min(
    Math.min(Number(e.elevationMeters),Number(w.elevationMeters))-c,
    c-Math.max(Number(n.elevationMeters),Number(s.elevationMeters))
  );
  const zSaddle=Math.min(
    Math.min(Number(n.elevationMeters),Number(s.elevationMeters))-c,
    c-Math.max(Number(e.elevationMeters),Number(w.elevationMeters))
  );
  const saddleStrength=Math.max(0,xSaddle,zSaddle);
  const slopeDegrees=Math.atan(gradient)*180/Math.PI;
  const ridgeSignal=clamp((curvature-5)/58,0,1)*clamp((relief-28)/180,0,1);
  const valleySignal=clamp((-curvature-5)/58,0,1)*clamp((relief-28)/180,0,1);
  const cliffSignal=clamp((slopeDegrees-31)/25,0,1)*clamp((relief-72)/220,0,1);
  const passSignal=clamp((saddleStrength-2)/24,0,1)*clamp((relief-34)/150,0,1);
  let kind="plain";
  if(passSignal>=0.12&&passSignal>=Math.max(ridgeSignal,valleySignal)*0.92)kind="pass";
  else if(ridgeSignal>=0.14)kind="ridge";
  else if(valleySignal>=0.14)kind="valley";
  else if(cliffSignal>=0.22)kind="cliff";
  else if(slopeDegrees>=8)kind="slope";

  const result=Object.freeze({
    version:VERSION,
    xMeters:x.key,zMeters:z.key,
    kind,
    elevationMeters:Number(c.toFixed(3)),
    gradientMetersPerMeter:Number(gradient.toFixed(6)),
    gradientX:Number(gradientX.toFixed(6)),
    gradientZ:Number(gradientZ.toFixed(6)),
    slopeDegrees:Number(slopeDegrees.toFixed(3)),
    localReliefMeters:Number(relief.toFixed(3)),
    curvatureMeters:Number(curvature.toFixed(3)),
    saddleStrengthMeters:Number(saddleStrength.toFixed(3)),
    ridgeSignal:Number(ridgeSignal.toFixed(4)),
    valleySignal:Number(valleySignal.toFixed(4)),
    cliffSignal:Number(cliffSignal.toFixed(4)),
    passSignal:Number(passSignal.toFixed(4)),
    sampleRadiusMeters:radius,
    surfaceType:center.surfaceType,
    biome:center.biome,
    deterministic:true,
    continuousMeterField:true,
    tileAuthority:false,
    chunkAuthority:false
  });
  landformCache.set(cacheKey,result);
  if(landformCache.size>LANDFORM_CACHE_LIMIT){
    const oldest=landformCache.keys().next().value;
    if(oldest!==undefined)landformCache.delete(oldest);
  }
  return result;
}
function proof(seedValue){
  const seed=String(seedValue??"");
  const a=sample(seed,0,0),b=sample(seed,0,0);
  const fractional=sample(seed,37.25,-19.5);
  const nearby=sample(seed,37.75,-19.5);
  const lf=landform(seed,2048,-1536);
  return Object.freeze({
    version:VERSION,
    deterministic:JSON.stringify(a)===JSON.stringify(b),
    fractionalMeterSampling:fractional.xMeters!==nearby.xMeters,
    boundedContinuity:Math.abs(fractional.elevationMeters-nearby.elevationMeters)<160,
    tileAuthority:false,
    chunkAuthority:false,
    continuousMeterField:true,
    sample:Object.freeze({a,fractional,nearby}),
    landform:lf
  });
}
function stats(){
  return Object.freeze({
    version:VERSION,
    sampleCalls,sampleCacheHits,sampleCacheEntries:sampleCache.size,sampleCacheLimit:SAMPLE_CACHE_LIMIT,
    landformCalls,landformCacheHits,landformCacheEntries:landformCache.size,landformCacheLimit:LANDFORM_CACHE_LIMIT,
    defaultLandformRadiusMeters:DEFAULT_LANDFORM_RADIUS_METERS,
    fullWorldAllocation:false,continuousMeterField:true,tileAuthority:false,chunkAuthority:false
  });
}

window.WorldField=Object.freeze({
  VERSION,SEA_LEVEL_METERS,DEFAULT_LANDFORM_RADIUS_METERS,
  sample,elevationMeters,landform,proof,stats,offsetCoordinate
});
})();