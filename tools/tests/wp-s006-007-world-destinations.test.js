"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");
const {performance}=require("perf_hooks");

class MemoryStorage{
  constructor(){this.map=new Map()}
  getItem(key){return this.map.has(String(key))?this.map.get(String(key)):null}
  setItem(key,value){this.map.set(String(key),String(value))}
  removeItem(key){this.map.delete(String(key))}
}

global.window=globalThis;
global.performance=performance;
global.localStorage=new MemoryStorage();
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],body:null};
global.location={search:"",hash:"",pathname:"/"};
Object.defineProperty(globalThis,"navigator",{value:{userAgent:"node"},configurable:true});
function load(path){vm.runInThisContext(fs.readFileSync(path,"utf8"),{filename:path})}

[
  "scripts/data/config.js",
  "scripts/data/world-standards.js",
  "scripts/core/prng.js",
  "scripts/world/coordinates.js",
  "scripts/core/seed.js",
  "scripts/core/game-time.js",
  "scripts/world/geography.js",
  "scripts/world/planet-geography.js",
  "scripts/world/political-geography.js",
  "scripts/world/country-profile.js",
  "scripts/world/region-profile.js",
  "scripts/world/settlement-archetypes.js",
  "scripts/world/world-destinations.js"
].forEach(load);

assert(global.WorldDestinations,"WorldDestinations API missing");
const seed="WP_S006_007_ACCEPTANCE";
const otherSeed="WP_S006_007_ACCEPTANCE_ALT";
const api=global.WorldDestinations;

const origins=[{x:"0",y:"0"}];
for(const rep of (global.RegionProfile?.representatives?.(seed)||[]).slice(0,4)){
  const seat=rep.administrativeSeat||{};
  if(seat.x!=null&&seat.y!=null)origins.push({x:String(seat.x),y:String(seat.y)});
}
const fixedOffsets=[{x:"22000",y:"18000"},{x:"-26000",y:"12000"},{x:"16000",y:"-28000"}];
origins.push(...fixedOffsets);

const summaries=[];
const all=[];
for(const origin of origins){
  const first=api.queryNearby(seed,origin,{radiusMeters:80000,maxResults:32});
  const second=api.queryNearby(seed,origin,{radiusMeters:80000,maxResults:32});
  assert.strictEqual(api.signature(first),api.signature(second),"same-SEED nearby query changed");
  assert.deepStrictEqual(first.results.map(x=>x.id),second.results.map(x=>x.id),"same-SEED result ordering changed");
  assert(first.diagnostics.bounded,"query did not report bounded execution");
  assert.strictEqual(first.diagnostics.fullWorldScan,false,"query reported full world scan");
  assert.strictEqual(first.diagnostics.localChunkMaterialization,false,"descriptor query materialized local chunks");
  assert(first.diagnostics.queryCellCount<=api.MAX_QUERY_CELLS,"POI cell cap exceeded");
  assert(first.results.length<=api.MAX_QUERY_RESULTS,"result cap exceeded");
  for(const d of first.results){
    assert(d.id&&d.type&&d.name,"descriptor identity incomplete");
    assert(d.center&&d.coordinates,"descriptor coordinate missing");
    assert(Number.isFinite(d.distanceMeters)&&Number.isFinite(d.bearingDegrees)&&d.directionLabel,"query distance/direction missing");
    assert(typeof d.countryName==="string"&&typeof d.regionName==="string","country/region missing");
    assert(Number.isFinite(d.importance)&&Number.isFinite(d.footprintRadiusMeters),"importance/footprint missing");
    assert(d.discoverability&&Array.isArray(d.activityTags)&&d.description,"descriptor gameplay metadata missing");
    assert(d.navigation&&d.strategicVisibilityTier,"navigation/strategic metadata missing");
    assert.strictEqual(d.localMaterialized,false,"destination unexpectedly materialized local detail");
    assert.strictEqual(d.seedOnly,true,"destination is not marked SEED-only");
  }
  all.push(...first.results);
  summaries.push({origin,signature:api.signature(first),count:first.results.length,queryMs:first.diagnostics.queryMs,queryCellCount:first.diagnostics.queryCellCount,settlementQueryCellCount:first.diagnostics.settlementQueryCellCount});
}

const byId=new Map(all.map(x=>[x.id,x]));
const unique=[...byId.values()];
const settlementTypes=new Set(unique.filter(x=>["hamlet","village","town","city","capital"].includes(x.type)).map(x=>x.type));
assert(settlementTypes.size>=3,"expected at least three canonical settlement sizes across fixed queries");
assert(unique.some(x=>x.category==="historical"),"no deterministic historical destination found across fixed queries");
assert(unique.some(x=>x.type==="hunting"),"no hunting destination found across fixed queries");
assert(unique.some(x=>x.type==="fishing"),"no fishing destination found across fixed queries");
assert(unique.some(x=>x.category==="water"),"no natural water destination found across fixed queries");

const fishing=unique.find(x=>x.type==="fishing");
assert(fishing.evidence.waterSamples>=2||fishing.evidence.waterArms>=1,"fishing destination lacks water evidence");
const hunting=unique.find(x=>x.type==="hunting");
assert(hunting.evidence.forestSamples>=3||["Woodland","Highland"].includes(hunting.evidence.biome),"hunting destination lacks wilderness evidence");
const historical=unique.find(x=>x.category==="historical");
assert.notStrictEqual(historical.evidence.terrain,"water","historical destination placed on water");
const water=unique.find(x=>x.category==="water");
assert(water.evidence.waterSamples>=1,"water destination lacks seeded water evidence");

const third=api.queryNearby(otherSeed,origins[0],{radiusMeters:80000,maxResults:32});
assert.notStrictEqual(api.signature(api.queryNearby(seed,origins[0],{radiusMeters:80000,maxResults:32})),api.signature(third),"different SEED did not change destination signature");

const filtered=api.queryNearby(seed,origins[0],{radiusMeters:80000,maxResults:12,categories:["historical"]});
assert(filtered.results.every(x=>x.category==="historical"),"category filter leaked unrelated destinations");
const minImportance=api.queryNearby(seed,origins[0],{radiusMeters:80000,maxResults:12,minImportance:3});
assert(minImportance.results.every(x=>x.importance>=3),"importance filter leaked lower-tier destinations");
const discovered=api.queryNearby(seed,origins[0],{radiusMeters:80000,maxResults:32,discoveredOnly:true,discoveredIds:[]});
assert(discovered.results.every(x=>x.discoverability.defaultState==="known"),"discovered-only query leaked undiscovered destination");

const verification=api.verify(seed,origins[0]);
assert.strictEqual(verification.pass,true,"built-in destination verification failed");

const html=fs.readFileSync("index.html","utf8");
const destinationScript=html.indexOf("scripts/world/world-destinations.js");
const stageScript=html.indexOf("scripts/world/planet-stage.js");
assert(destinationScript>=0&&stageScript>destinationScript,"world-destinations.js must load before planet-stage.js");
const stageSource=fs.readFileSync("scripts/world/planet-stage.js","utf8");
assert(/WorldDestinations\?\.queryNearby/.test(stageSource),"PlanetStage navigator is not wired to WorldDestinations");

console.log(JSON.stringify({
  pass:true,
  deterministic:true,
  sameSeedSignature:verification.signatureA,
  differentSeedSignature:api.signature(third),
  fixedQueryCount:summaries.length,
  summaries,
  uniqueDestinationCount:unique.length,
  settlementTypes:[...settlementTypes].sort(),
  requiredExamples:{
    historical:{id:historical.id,type:historical.type,name:historical.name,distanceMeters:historical.distanceMeters,direction:historical.directionLabel,country:historical.countryName,region:historical.regionName},
    hunting:{id:hunting.id,name:hunting.name,forestSamples:hunting.evidence.forestSamples,biome:hunting.evidence.biome},
    fishing:{id:fishing.id,name:fishing.name,waterSamples:fishing.evidence.waterSamples},
    water:{id:water.id,type:water.type,name:water.name,waterSamples:water.evidence.waterSamples}
  },
  bounds:{maxQueryCells:api.MAX_QUERY_CELLS,maxResults:api.MAX_QUERY_RESULTS,maxRadiusMeters:api.MAX_QUERY_RADIUS_METERS,fullWorldScan:false,localChunkMaterialization:false},
  filters:{historicalOnly:filtered.results.length,minImportance:minImportance.results.length,discoveredOnly:discovered.results.length},
  navigatorIntegration:true
},null,2));
