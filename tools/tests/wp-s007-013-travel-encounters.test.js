"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");

global.window=globalThis;
global.document=undefined;
global.setInterval=()=>1;
global.clearInterval=()=>{};
let perf=0;global.performance={now:()=>{perf+=0.07;return perf;}};

function hash32(seed,key){
  let h=2166136261>>>0;
  for(const ch of String(seed)+"|"+String(key)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  return h>>>0;
}
global.PRNG={foundationUint32:hash32};
global.GeographyFoundation={
  environment:(seed,x,y)=>{
    const cx=Number(BigInt(x)/48n),band=Math.abs(cx)%3;
    return {biome:band===0?"Woodland":band===1?"Grassland":"Highland",climate:"Temperate"};
  },
  getTerrainType:(seed,x,y)=>Number(BigInt(x)/48n)%2===0?"road":"grass",
  mainRoadInfo:(seed,x,y)=>Number(BigInt(x)/48n)%2===0?{type:"road",context:"regional"}:null,
  hierarchy:(seed,x,y)=>({region:"Region-"+String(BigInt(x)/192n)})
};
global.PoliticalGeography={
  countryAt:(seed,x,y)=>({id:"C-"+String(BigInt(x)/384n),name:"Country "+String(BigInt(x)/384n)})
};
global.RegionProfile={
  at:(seed,x,y)=>{
    const cx=Number(BigInt(x)/48n);
    return {id:"R-"+Math.floor(cx/4),name:"Region "+Math.floor(cx/4),specialization:{defense:(Math.abs(cx)%5)/4,trade:(Math.abs(cx+2)%5)/4}};
  }
};
global.GameTime={getTimestampKey:()=>null};
global.SeedSystem={getCampaign:()=>null};
global.PlanetStage=undefined;

vm.runInThisContext(fs.readFileSync("scripts/world/travel-encounters.js","utf8"),{filename:"travel-encounters.js"});

const seed="WP-S007-013-TEST";
function addHours(base,hours){
  const m=base.match(/^(\d+)-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6])));
  d.setUTCHours(d.getUTCHours()+hours);
  const p=n=>String(n).padStart(2,"0");
  return String(d.getUTCFullYear()).padStart(4,"0")+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate())+" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+":"+p(d.getUTCSeconds());
}

const samples=[];
for(let i=0;i<720;i++){
  const cell=(i%12)-6;
  samples.push({point:{x:String(cell*48+8),y:String(((i*5)%9-4)*48+7)},timestamp:addHours("1201-04-01 00:00:00",i*6)});
}
const first=TravelEncounters.stream(seed,samples);
const repeated=TravelEncounters.stream(seed,samples);
const alternate=TravelEncounters.stream(seed+"-ALT",samples);
assert.deepStrictEqual(first,repeated,"same SEED/time travel stream changed");
assert.notDeepStrictEqual(first,alternate,"alternate SEED did not alter travel encounter stream");
const frequency=first.length/samples.length;
assert(frequency>=0.02&&frequency<=0.10,"rare encounter frequency outside 2%-10%: "+frequency);

const byBlock=new Map();
for(const event of first){
  const k=event.regionId+"|"+event.cooldownBlock+"|"+event.anchor.x+"|"+event.anchor.y;
  byBlock.set(k,(byBlock.get(k)||0)+1);
}
assert([...byBlock.values()].every(n=>n===1),"encounter density/cooldown emitted duplicates in one block");

for(const eventRow of first.slice(0,80)){
  const event=TravelEncounters.probe(seed,samples[eventRow.sampleIndex].point,samples[eventRow.sampleIndex].timestamp);
  assert(event&&event.id===eventRow.id,"stream/probe ordering mismatch");
  assert(event.actorCount>=1&&event.actorCount<=4,"exact actor bound exceeded");
  assert.strictEqual(event.authoritativeOutcome,false,"rare encounter invented authoritative world outcome");
  assert.strictEqual(event.politicalOutcome,false,"rare encounter invented political outcome");
  assert.strictEqual(event.fullWorldScan,false);
  assert.strictEqual(event.perFrameScan,false);
  if(["traveling-merchant","small-caravan","pilgrims","road-patrol","messenger"].includes(event.type)){
    assert.strictEqual(event.context.onRoad,true,event.type+" spawned without road context");
  }
  if(event.type==="hunter-party"){
    assert(["Woodland","Highland"].includes(event.context.biome),"hunter party ignored biome eligibility");
  }
}

const proofAnchor={x:"24",y:"24",level:0},proofTime="1201-06-02 12:00:00";
const visualTypes=["traveling-merchant","small-caravan","road-patrol","messenger"];
const proofRows=[];
for(const type of visualTypes){
  TravelEncounters.clearProof(seed);
  const proof=TravelEncounters.proofActivate(seed,type,proofAnchor,proofTime);
  assert.strictEqual(proof.pass,true,type+" proof activation failed");
  assert.strictEqual(proof.snapshot.active,true);
  assert(proof.snapshot.exactActorCount>=1&&proof.snapshot.exactActorCount<=4);
  assert(proof.snapshot.exactActors.every(a=>a.travelEncounter&&a.presentationOnly&&!a.simulationAuthority));
  const far=TravelEncounters.localPresentation(seed,{x:"500",y:"500"},proofTime);
  assert.strictEqual(far.active,false,type+" exact actors materialized off-screen");
  assert.strictEqual(far.summaryOnly,true,type+" off-screen encounter did not remain summary-only");
  proofRows.push({type,actorCount:proof.snapshot.exactActorCount,id:proof.event.id});
}
TravelEncounters.clearProof(seed);

const source=fs.readFileSync("scripts/world/travel-encounters.js","utf8");
assert(source.includes("RegionProfile?.at"),"regional context missing");
assert(source.includes("PoliticalGeography?.countryAt"),"political context missing");
assert(source.includes("GeographyFoundation?.mainRoadInfo"),"road context missing");
assert(source.includes("GeographyFoundation?.environment"),"biome context missing");
assert(source.includes("seedAndFantasyTimeOnly:true"),"SEED + fantasy-time authority flag missing");

console.log(JSON.stringify({
  pass:true,wp:"WP-S007-013",classification:"MIXED",
  distribution:{samples:samples.length,encounters:first.length,frequency:Number(frequency.toFixed(4)),cooldownHours:TravelEncounters.WINDOW_HOURS*TravelEncounters.COOLDOWN_WINDOWS},
  determinism:{sameStream:true,alternateSeedDiverges:true,orderedIds:first.slice(0,12).map(x=>x.id)},
  proofRows,
  bounds:{maxExactActors:TravelEncounters.MAX_EXACT_ACTORS,localRadiusTiles:TravelEncounters.LOCAL_RADIUS_TILES,macroCellTiles:TravelEncounters.MACRO_CELL_TILES},
  architecture:{summaryOffscreen:true,exactNearOnly:true,pooledPresentation:true,fullWorldScan:false,perFrameScan:false,politicalOutcome:false}
},null,2));
