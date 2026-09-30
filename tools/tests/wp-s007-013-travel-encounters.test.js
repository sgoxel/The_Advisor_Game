"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");

global.window=globalThis;
global.document=undefined;
global.setInterval=()=>1;
global.clearInterval=()=>{};
let perf=0;global.performance={now:()=>{perf+=0.06;return perf;}};

function hash32(seed,key){
  let h=2166136261>>>0;
  for(const ch of String(seed)+"|"+String(key)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  return h>>>0;
}
global.PRNG={foundationUint32:hash32};
global.WorldStandards={TILE_METERS:2};
global.PlanetGeography={
  DEFAULT_WORLD_RADIUS_METERS:637100,
  create:()=>({
    worldLatLonForTile:(x,y)=>({latitudeRadians:Number(BigInt(x))/100000,longitudeRadians:Number(BigInt(y))/100000}),
    sampleLatLon:(lat,lon)=>({land:Math.round(Math.abs(lat*100000)+Math.abs(lon*100000))%17!==0,elevationMeters:180})
  })
};
global.GeographyFoundation={
  TILE_METERS:2,
  environment:(seed,x,y)=>{
    const cx=Number(BigInt(x)/48n),band=Math.abs(cx)%3;
    return {biome:band===0?"Woodland":band===1?"Grassland":"Highland",climate:"Temperate"};
  },
  getTerrainType:(seed,x,y)=>{
    const bx=BigInt(x),by=BigInt(y);
    if((bx*3n+by*5n)%29n===0n)return "water";
    return bx%4n===0n?"road":"grass";
  },
  mainRoadInfo:(seed,x,y)=>BigInt(x)%4n===0n?{type:"road",context:"regional"}:null,
  hierarchy:(seed,x,y)=>({region:"Region-"+String(BigInt(x)/192n)})
};
global.PoliticalGeography={countryAt:(seed,x,y)=>({id:"C-"+String(BigInt(x)/384n),name:"Country "+String(BigInt(x)/384n)})};
global.RegionProfile={
  at:(seed,x,y)=>{
    const cx=Number(BigInt(x)/48n);
    return {id:"R-"+Math.floor(cx/4),name:"Region "+Math.floor(cx/4),specialization:{defense:(Math.abs(cx)%5)/4,trade:(Math.abs(cx+2)%5)/4}};
  }
};
global.GameTime={getTimestampKey:()=>null,getNow:()=>null};
global.SeedSystem={getCampaign:()=>null};
global.PlanetStage=undefined;

vm.runInThisContext(fs.readFileSync("scripts/world/travel-encounters.js","utf8"),{filename:"travel-encounters.js"});

const seed="WP-S007-013-V2-TEST";
function addHours(base,hours){
  const m=base.match(/^(\d+)-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/),d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6])));
  d.setUTCHours(d.getUTCHours()+hours);const p=n=>String(n).padStart(2,"0");
  return String(d.getUTCFullYear()).padStart(4,"0")+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate())+" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+":"+p(d.getUTCSeconds());
}

const samples=[];
for(let i=0;i<720;i++){
  const cell=(i%12)-6;
  samples.push({point:{x:String(cell*48+8),y:String(((i*5)%9-4)*48+7)},timestamp:addHours("1201-04-01 00:00:00",i*6)});
}
const first=TravelEncounters.stream(seed,samples),repeated=TravelEncounters.stream(seed,samples),alternate=TravelEncounters.stream(seed+"-ALT",samples);
assert.deepStrictEqual(first,repeated,"same SEED/time travel stream changed");
assert.notDeepStrictEqual(first,alternate,"alternate SEED did not alter travel encounter stream");
const frequency=first.length/samples.length;
assert(frequency>=0.02&&frequency<=0.10,"rare encounter frequency outside 2%-10%: "+frequency);

for(const row of first.slice(0,100)){
  const event=TravelEncounters.probe(seed,samples[row.sampleIndex].point,samples[row.sampleIndex].timestamp);
  assert(event&&event.id===row.id,"stream/probe ordering mismatch");
  assert(event.actorCount>=1&&event.actorCount<=4,"exact actor bound exceeded");
  assert.strictEqual(event.authoritativeOutcome,false);
  assert.strictEqual(event.politicalOutcome,false);
  assert.strictEqual(event.fullWorldScan,false);
  assert.strictEqual(event.perFrameScan,false);
  assert.strictEqual(event.context.visualSurfaceValid,true,"event visual anchor is not canonical land");
  assert.strictEqual(event.visualAnchor.planetSurfaceAgreement,true,"PlanetGeography/terrain surface agreement missing");
  assert(event.visualAnchor.checkedCount<=TravelEncounters.MAX_VISUAL_ANCHOR_CHECKS,"visual anchor search exceeded bound");
  if(["traveling-merchant","small-caravan","pilgrims","road-patrol","messenger"].includes(event.type))assert.strictEqual(event.context.onRoad,true,event.type+" spawned without road context");
}

const stamp="1201-06-02 12:00:00",visualTypes=["traveling-merchant","small-caravan","road-patrol","messenger"],proofRows=[];
for(let i=0;i<visualTypes.length;i++){
  const type=visualTypes[i],base={x:String(24+i*53),y:String(24+i*31),level:0};
  TravelEncounters.clearProof(seed);
  const visual=TravelEncounters.resolveVisualAnchor(seed,base,stamp,type,"unit-"+type);
  assert.strictEqual(visual.valid,true,type+" did not find bounded canonical visual anchor");
  assert(visual.checkedCount<=TravelEncounters.MAX_VISUAL_ANCHOR_CHECKS);
  const proof=TravelEncounters.proofActivate(seed,type,base,stamp);
  assert.strictEqual(proof.pass,true,type+" proof activation failed");
  assert.strictEqual(proof.event.context.visualSurfaceValid,true);
  assert.strictEqual(proof.event.context.onRoad,true,type+" proof is not road-aware");
  assert(proof.snapshot.exactActorCount>=1&&proof.snapshot.exactActorCount<=4);
  assert(proof.snapshot.exactActors.every(a=>a.travelEncounter&&a.presentationOnly&&!a.simulationAuthority&&a.point.x===proof.event.anchor.x&&a.point.y===proof.event.anchor.y));
  const repeat=TravelEncounters.proofActivate(seed,type,base,stamp);
  assert.strictEqual(repeat.event.id,proof.event.id,"same proof context changed encounter identity");
  const far=TravelEncounters.localPresentation(seed,{x:String(BigInt(proof.event.anchor.x)+500n),y:String(BigInt(proof.event.anchor.y)+500n)},stamp);
  assert.strictEqual(far.active,false,type+" exact actors materialized far away");
  assert.strictEqual(far.summaryOnly,true,type+" off-screen encounter did not remain summary-only");
  proofRows.push({type,id:proof.event.id,actorCount:proof.snapshot.exactActorCount,anchor:proof.event.anchor,anchorChecks:proof.event.visualAnchor.checkedCount});
}
TravelEncounters.clearProof(seed);

const source=fs.readFileSync("scripts/world/travel-encounters.js","utf8"),stageSource=fs.readFileSync("scripts/world/planet-stage.js","utf8"),html=fs.readFileSync("index.html","utf8"),css=fs.readFileSync("styles/travel-encounters.css","utf8"),mainCss=fs.readFileSync("styles/main.css","utf8");
assert(source.includes("PlanetGeography?.create?.(seed)"),"canonical PlanetGeography visual surface validation missing");
assert(source.includes("MAX_VISUAL_ANCHOR_CHECKS=81"),"bounded visual-anchor cap missing");
assert(source.includes("seedAndFantasyTimeOnly:true"),"SEED + fantasy-time authority flag missing");
assert(source.includes("getTimestampKey?.()||window.GameTime?.getNow?.()"),"auto refresh lacks fantasy-time fallback");
assert(source.includes('proofBySeed.has(String(seed))'),"proof-mode encounter card is not preserved when GameTime is unavailable");
assert(stageSource.includes('const settlementCrowdActive=["refined","full"].includes(String(tier))'),"routine settlement crowd gate missing");
assert(stageSource.includes("TravelEncounters?.localPresentation?.(activeSeed,focusTile,stamp"),"PlanetStage is not wired to rare encounters");
assert(stageSource.includes('travelerSilhouetteRevision:"travel-encounter-silhouette-v3"'),"traveler silhouette revision missing");
assert(stageSource.includes("topFacingTravelerBodies:true"),"top-facing traveler body geometry missing");
assert(stageSource.includes("travelEncounterBodyMinPx"),"traveler screen-size telemetry missing");
assert(stageSource.includes("mergedPresentationBuildMs"),"merged traveler presentation timing telemetry missing");
assert(stageSource.includes("travelEncounters:window.TravelEncounters?.snapshot?.(activeSeed)||null"),"PlanetStage snapshot missing travel encounter state");
assert(stageSource.includes('root.dataset.travelEncounterFocus=String(Boolean(encounter?.active))'),"travel encounter focus declutter state missing");
assert(stageSource.includes("travelEncounterDecluttered"),"center-marker declutter telemetry missing");
assert(mainCss.includes('data-travel-encounter-focus="true"')&&mainCss.includes("translateY(-46px)")&&mainCss.includes("code{display:none!important}"),"center HUD traveler declutter CSS missing");
assert(html.includes("travel-encounters.js?v=travel-encounters-v3"),"travel encounter runtime cache revision missing");
assert(html.indexOf("scripts/world/travel-encounters.js")<html.indexOf("scripts/world/planet-stage.js"),"travel runtime must load before PlanetStage");
assert(css.includes(".travel-encounter-card")&&css.includes("z-index:90")&&css.includes('.wayfinding-sign-text-layer{display:none!important}')&&source.includes("document.body||document.getElementById"),"dedicated travel card overlay or wayfinding declutter layer missing or malformed");

console.log(JSON.stringify({
  pass:true,wp:"WP-S007-013",classification:"MIXED",
  distribution:{samples:samples.length,encounters:first.length,frequency:Number(frequency.toFixed(4)),cooldownHours:TravelEncounters.WINDOW_HOURS*TravelEncounters.COOLDOWN_WINDOWS},
  determinism:{sameStream:true,alternateSeedDiverges:true,orderedIds:first.slice(0,12).map(x=>x.id)},
  proofRows,
  bounds:{maxExactActors:TravelEncounters.MAX_EXACT_ACTORS,localRadiusTiles:TravelEncounters.LOCAL_RADIUS_TILES,macroCellTiles:TravelEncounters.MACRO_CELL_TILES,maxVisualAnchorChecks:TravelEncounters.MAX_VISUAL_ANCHOR_CHECKS},
  architecture:{canonicalLandAnchor:true,roadAware:true,summaryOffscreen:true,exactNearOnly:true,oneMergedPresentationBatch:true,fullWorldScan:false,perFrameScan:false,politicalOutcome:false}
},null,2));