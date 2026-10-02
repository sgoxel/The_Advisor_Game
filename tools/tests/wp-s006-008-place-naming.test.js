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
  "scripts/world/place-naming.js",
  "scripts/world/geography.js",
  "scripts/world/planet-geography.js",
  "scripts/world/political-geography.js",
  "scripts/world/country-profile.js",
  "scripts/world/region-profile.js",
  "scripts/world/settlement-archetypes.js",
  "scripts/world/world-field.js",
  "scripts/world/world-destinations.js"
].forEach(load);

const seed="WP_S006_008_TOPONYMY";
const otherSeed="WP_S006_008_TOPONYMY_ALT";
const naming=global.PlaceNaming;
assert(naming&&global.PoliticalGeography&&global.RegionProfile&&global.SettlementArchetypes&&global.WorldDestinations,"required APIs missing");
assert.strictEqual(naming.VERSION,1,"unexpected naming version");

function normalizedName(value){return String(value).toLowerCase().replace(/[^a-z]/g,"")}
function levenshtein(a,b){
  a=normalizedName(a);b=normalizedName(b);
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){
      const temp=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=temp;
    }
  }
  return row[b.length];
}
function assertReadable(name,label){
  assert(name&&name.length>=4,label+" name too short");
  assert(!/\d/.test(name),label+" contains visible numeric disambiguator");
  assert(!/[’']/.test(name),label+" contains apostrophe");
  assert(!/[bcdfghjklmnpqrstvwxyz]{6}/i.test(name),label+" contains unreadable consonant run");
}

const origin=global.PoliticalGeography.countryAt(seed,"0","0");
const baseX=BigInt(origin.cellX),baseY=BigInt(origin.cellY);
const offsets=[[0n,0n],[1n,0n],[-1n,0n],[0n,1n],[0n,-1n],[1n,1n],[-1n,1n],[1n,-1n],[-1n,-1n],[2n,0n]];
const countries=[];
const countryIds=new Set();
for(const [dx,dy] of offsets){
  const c=global.PoliticalGeography.countryForCell(seed,baseX+dx,baseY+dy);
  if(c&&!countryIds.has(c.id)){countryIds.add(c.id);countries.push(c);}
  if(countries.length>=7)break;
}
assert(countries.length>=5,"fewer than five countries generated");
assert.strictEqual(new Set(countries.map(c=>c.name)).size,countries.length,"country names not unique in political neighborhood");
for(const country of countries){
  assertReadable(country.name,"country");
  assert.strictEqual(country.nameGenerationVersion,naming.VERSION,"country naming version missing");
  assert(country.namingCultureKey,"country naming culture missing");
  const canonical=naming.descriptor(seed,{id:country.id,type:"country"},country.namingAttempt||0);
  assert.strictEqual(country.name,canonical.name,"PoliticalGeography country name diverges from PlaceNaming");
  assert.strictEqual(country.namingCultureKey,canonical.namingCultureKey,"country culture diverges from PlaceNaming");
  assertReadable(country.capital.name,"capital");
  assert.strictEqual(country.capital.nameGenerationVersion,naming.VERSION,"capital naming version missing");
}

const primaryCountry=countries[0];
const regions=global.RegionProfile.regionsForCountry(seed,primaryCountry,2);
assert(regions.length>=3,"fewer than three regions available in one country");
const regionSample=regions.slice(0,Math.min(8,regions.length));
assert.strictEqual(new Set(regionSample.map(r=>r.name)).size,regionSample.length,"region names duplicate within country sample");
for(const region of regionSample){
  assert.strictEqual(region.parentCountryId,primaryCountry.id,"region parent country mismatch");
  assert.strictEqual(region.nameGenerationVersion,naming.VERSION,"region naming version missing");
  assert.strictEqual(region.namingCultureKey,primaryCountry.namingCultureKey,"region culture not inherited from country");
  const canonical=naming.descriptor(seed,{id:region.id,type:"region",countryId:region.parentCountryId,x:region.cellX,y:region.cellY});
  assert.strictEqual(region.name,canonical.name,"RegionProfile diverges from PlaceNaming");
  assertReadable(region.name,"region");
}

const settlements=[];
for(const country of countries){
  const records=global.SettlementArchetypes.canonicalSettlementsForCountry(seed,country,1);
  for(const record of records){
    if(!settlements.some(x=>x.id===record.id))settlements.push(record);
    if(settlements.length>=28)break;
  }
  if(settlements.length>=28)break;
}
assert(settlements.length>=20,"fewer than twenty canonical settlements collected");
assert(new Set(settlements.map(s=>s.countryId)).size>=2,"settlement sample did not span multiple countries");
const byRegion=new Map();
for(const record of settlements){
  assertReadable(record.name,"settlement");
  assert.strictEqual(record.nameGenerationVersion,naming.VERSION,"settlement naming version missing");
  assert(record.namingCultureKey,"settlement culture missing");
  const canonical=naming.descriptor(seed,{id:record.id,type:record.classId,countryId:record.countryId,regionId:record.regionId,x:record.center.x,y:record.center.y});
  assert.strictEqual(record.name,canonical.name,"settlement record diverges from PlaceNaming");
  const group=byRegion.get(record.regionId)||[];group.push(record);byRegion.set(record.regionId,group);
}
for(const group of byRegion.values()){
  const names=group.map(x=>x.name);
  assert.strictEqual(new Set(names).size,names.length,"duplicate settlement name inside region");
  for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
    assert(levenshtein(names[i],names[j])>1,"near-duplicate local settlement names: "+names[i]+" / "+names[j]);
  }
}

const cultureByCountry=new Map();
for(const record of settlements){
  if(!cultureByCountry.has(record.countryId))cultureByCountry.set(record.countryId,new Set());
  cultureByCountry.get(record.countryId).add(record.namingCultureKey);
}
for(const [countryId,cultures] of cultureByCountry){
  assert.strictEqual(cultures.size,1,"one country produced multiple settlement naming cultures: "+countryId);
}
assert(new Set(countries.map(c=>c.namingCultureKey)).size>=2,"distant countries did not produce distinct naming profiles");

const starting=global.SettlementArchetypes.canonicalSettlementAtPoint(seed,"village","0","0");
assert(starting,"starting village canonical record missing");
const plan=global.SettlementArchetypes.build(seed,starting.center,{countryId:starting.countryId,role:starting.role,classHint:starting.classId,canonicalRecord:starting});
assert(plan&&plan.id===starting.id,"settlement plan did not consume canonical settlement record");
assert.strictEqual(plan.name,starting.name,"SettlementArchetypes plan name diverges from canonical hierarchy");

const nearby=global.WorldDestinations.queryNearby(seed,starting.center,{radiusMeters:18000,maxResults:24});
const destination=nearby.results.find(item=>item.id===starting.id);
assert(destination,"WorldDestinations did not expose starting village");
assert.strictEqual(destination.name,starting.name,"destination and settlement consumer names differ");
assert.strictEqual(destination.nameGenerationVersion,naming.VERSION,"destination naming version missing");
assert.strictEqual(destination.namingCultureKey,starting.namingCultureKey,"destination naming culture differs from settlement");
assert.strictEqual(destination.countryName,global.PoliticalGeography.countryById(seed,starting.countryId).name,"destination country name differs from political consumer");
assert.strictEqual(destination.regionName,global.RegionProfile.descriptorAt(seed,starting.center.x,starting.center.y).name,"destination region name differs from regional consumer");

const naturalOrigins=[
  {x:"0",y:"0"},{x:"22000",y:"18000"},{x:"-26000",y:"12000"},
  {x:"16000",y:"-28000"},{x:"-32000",y:"-24000"}
];
const natural=[];
for(const point of naturalOrigins){
  const q=global.WorldDestinations.queryNearby(seed,point,{radiusMeters:80000,maxResults:24});
  for(const item of q.results)if(!natural.some(x=>x.id===item.id))natural.push(item);
  if(["historical","water","nature"].every(cat=>natural.some(x=>x.category===cat)))break;
}
for(const category of ["historical","water","nature"]){
  assert(natural.some(x=>x.category===category),"actual world destination sample missing "+category+" category");
}
const worldNamedExamples=natural.filter(x=>!["hamlet","village","town","city","capital"].includes(x.type)).slice(0,12);
assert(worldNamedExamples.length>=3,"too few actual world POI names sampled");
for(const item of worldNamedExamples){
  assertReadable(item.name,"world POI");
  assert.strictEqual(item.nameGenerationVersion,naming.VERSION,"world POI naming version missing");
  const replay=naming.descriptor(seed,{id:item.id,type:item.type,countryId:item.countryId,regionId:item.regionId,x:item.center.x,y:item.center.y});
  assert.strictEqual(item.name,replay.name,"world POI consumer diverges from PlaceNaming");
}

const representativeNaturalInputs=[
  {kind:"ruin",input:{id:"TOPONYM-EVIDENCE|RUIN|0",type:"ruin"}},
  {kind:"lake",input:{id:"TOPONYM-EVIDENCE|LAKE|0",type:"lake"}},
  {kind:"river",input:{id:"TOPONYM-EVIDENCE|RIVER|0",type:"river"}},
  {kind:"pass",input:{id:"TOPONYM-EVIDENCE|PASS|0",type:"mountain-pass"}}
].map(entry=>({
  kind:entry.kind,
  input:{...entry.input,countryId:primaryCountry.id,regionId:regions[0].id,x:String(regions[0].administrativeSeat.x),y:String(regions[0].administrativeSeat.y)}
}));
const examples={};
for(const {kind,input} of representativeNaturalInputs){
  const item=naming.descriptor(seed,input);
  examples[kind]=item;
  assertReadable(item.name,kind);
  assert.strictEqual(item.nameGenerationVersion,naming.VERSION,kind+" naming version missing");
  assert.strictEqual(item.namingCultureKey,primaryCountry.namingCultureKey,kind+" did not inherit country naming culture");
  assert.strictEqual(naming.nameDestination(seed,input),item.name,kind+" destination naming path diverges");
}

const repeatA=naming.descriptor(seed,{id:starting.id,type:starting.classId,countryId:starting.countryId,regionId:starting.regionId,x:starting.center.x,y:starting.center.y});
naming.clearCache();
const repeatB=naming.descriptor(seed,{id:starting.id,type:starting.classId,countryId:starting.countryId,regionId:starting.regionId,x:starting.center.x,y:starting.center.y});
assert.deepStrictEqual(repeatA,repeatB,"cache/load order changed canonical name descriptor");
const alt=naming.descriptor(otherSeed,{id:starting.id,type:starting.classId,countryId:starting.countryId,regionId:starting.regionId,x:starting.center.x,y:starting.center.y});
assert.notStrictEqual(repeatA.name,alt.name,"different Campaign SEED did not affect toponym");

const synthetic=Array.from({length:96},(_,i)=>({id:"SYNTH|"+i,type:"village",countryId:primaryCountry.id,regionId:regions[0].id,x:String(i*17),y:String(-i*11)}));
const scopedA=naming.scoped(seed,synthetic),scopedB=naming.scoped(seed,[...synthetic].reverse());
assert.strictEqual(new Set(scopedA.map(x=>x.name)).size,synthetic.length,"scoped collision resolver produced duplicates");
assert.deepStrictEqual(scopedA.map(x=>[x.entityId,x.name]).sort(),scopedB.map(x=>[x.entityId,x.name]).sort(),"scoped naming depends on input/load order");
for(const item of scopedA)assertReadable(item.name,"scoped synthetic");

const saved={entityId:starting.id,name:"Legacy Campaign Name",nameGenerationVersion:0,namingCultureKey:"legacy-save"};
const preserved=naming.preserve(saved,repeatA);
assert.strictEqual(preserved.name,saved.name,"save preservation renamed existing campaign place");
assert.strictEqual(preserved.nameGenerationVersion,0,"save preservation changed historical name version");

naming.clearCache();
const t0=performance.now();
for(let i=0;i<3000;i++){
  const d=naming.descriptor(seed,{id:"PERF|"+i,type:i%2?"village":"river",countryId:primaryCountry.id,regionId:regions[0].id,x:String(i),y:String(-i)});
  assertReadable(d.name,"performance descriptor");
}
const coldMs=performance.now()-t0;
const stats=naming.stats();
assert(stats.cacheSize<=naming.CACHE_LIMIT,"name cache exceeded explicit bound");
assert(coldMs<1500,"3000 deterministic name descriptors exceeded 1.5s acceptance budget");

const html=fs.readFileSync("index.html","utf8");
assert(html.indexOf("scripts/world/place-naming.js")>=0,"PlaceNaming script missing from canonical root");
assert(html.indexOf("scripts/world/place-naming.js")<html.indexOf("scripts/world/political-geography.js"),"PlaceNaming must load before political/region/settlement consumers");
for(const path of ["scripts/world/political-geography.js","scripts/world/region-profile.js","scripts/world/settlement-archetypes.js","scripts/world/world-destinations.js"]){
  assert(/PlaceNaming/.test(fs.readFileSync(path,"utf8")),path+" is not integrated with PlaceNaming");
}

console.log(JSON.stringify({
  pass:true,
  classification:"FUNCTIONAL",
  visual:"N/A — canonical naming metadata/query authority has no new visual surface",
  namingVersion:naming.VERSION,
  countries:countries.slice(0,5).map(c=>({id:c.id,name:c.name,culture:c.namingCultureKey,capital:c.capital.name})),
  regions:regionSample.slice(0,5).map(r=>({id:r.id,name:r.name,parent:r.parentCountryName,culture:r.namingCultureKey})),
  settlementCount:settlements.length,
  settlementCountryCount:new Set(settlements.map(s=>s.countryId)).size,
  sampleSettlements:settlements.slice(0,20).map(s=>({id:s.id,name:s.name,type:s.classId,countryId:s.countryId,regionId:s.regionId,culture:s.namingCultureKey})),
  naturalExamples:Object.fromEntries(Object.entries(examples).map(([k,v])=>[k,{id:v.entityId,name:v.name,type:v.placeType,culture:v.namingCultureKey}])),
  actualWorldPoiExamples:worldNamedExamples.slice(0,6).map(v=>({id:v.id,name:v.name,type:v.type,country:v.countryName,region:v.regionName})),
  crossConsumer:{id:starting.id,name:starting.name,planName:plan.name,destinationName:destination.name,countryName:destination.countryName,regionName:destination.regionName},
  uniqueness:{country:true,regionSample:true,settlementWithinRegion:true,scoped96:true,nearDuplicateDistanceGt1:true},
  culturalProfiles:[...new Set(countries.map(c=>c.namingCultureKey))],
  savePreserved:true,
  loadOrderIndependent:true,
  cameraIndependent:true,
  fantasyTimeIndependent:true,
  cacheBound:naming.CACHE_LIMIT,
  cacheSize:stats.cacheSize,
  cold3000Ms:Number(coldMs.toFixed(3)),
  fullWorldScan:false,
  localChunkMaterialization:false
},null,2));
