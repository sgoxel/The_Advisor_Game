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
  "scripts/data/config.js","scripts/data/world-standards.js","scripts/core/prng.js",
  "scripts/world/coordinates.js","scripts/core/seed.js","scripts/core/game-time.js",
  "scripts/world/geography.js","scripts/world/planet-geography.js","scripts/world/political-geography.js",
  "scripts/world/country-profile.js","scripts/world/region-profile.js","scripts/world/settlement-archetypes.js",
  "scripts/world/world-field.js","scripts/world/world-destinations.js","scripts/world/micro-locations.js"
].forEach(load);

assert(global.WorldDestinations?.poiCell,"bounded raw POI-cell API missing");
assert(global.MicroLocations,"MicroLocations API missing");
const seed="WP_S006_007_001_ACCEPTANCE";
const otherSeed="WP_S006_007_001_ACCEPTANCE_ALT";
const api=global.MicroLocations;

function ringCells(radius){
  const out=[];
  for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++)out.push({x,y,d:x*x+y*y});
  return out.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);
}
const samples=new Map(),visited=[];
for(const cell of ringCells(10)){
  const location=api.composeCell(seed,String(cell.x),String(cell.y));
  visited.push({cx:cell.x,cy:cell.y,type:location?.compositionType||null});
  if(location&&!samples.has(location.compositionType))samples.set(location.compositionType,{cell,location});
  if(samples.size>=6)break;
}
assert(samples.size>=6,"expected at least six deterministic micro-location composition types in bounded POI cells");
const chosen=[...samples.values()].slice(0,6);

function contextPass(location){
  const ev=location.sourceEvidence||{},source=location.sourceType;
  if(source==="hunting")return Number(ev.forestSamples||0)>=3||/forest|woodland/i.test(String(ev.biome||""));
  if(source==="fishing")return Number(ev.waterSamples||0)>=2||Number(ev.waterArms||0)>=1;
  if(source==="forest")return Number(ev.forestSamples||0)>=4;
  if(source==="grazing")return Number(ev.openSamples||0)>=4;
  if(source==="gathering")return Number(ev.forestSamples||0)>=3||Number(ev.rockSamples||0)>=2;
  if(["ruin","fort","tower"].includes(source))return String(ev.terrain)!=="water";
  if(["cave","cliff","outcrop"].includes(source))return String(ev.terrain)!=="water";
  return Number(ev.waterSamples||0)>=1||Number(ev.waterArms||0)>=1;
}
for(const {location} of chosen){
  assert(location.id&&location.sourceDestinationId&&location.compositionType,"micro-location identity incomplete");
  assert(contextPass(location),"micro-location source context invalid: "+location.compositionType);
  assert(location.propCount>0&&location.propCount<=api.MAX_PROPS_PER_LOCATION,"prop count outside bounded contract");
  assert(location.footprintRadiusTiles<=7,"micro-location footprint is not small/local");
  assert.strictEqual(location.strategicVisibilityTier,"local","micro-location strategic visibility tier changed");
  assert.strictEqual(location.lazy,true,"micro-location is not lazy");
  assert.strictEqual(location.seedOnly,true,"micro-location is not SEED-only");
  assert.strictEqual(location.simulationAuthority,false,"presentation became simulation authority");
  assert.strictEqual(location.questAuthority,false,"micro-location fabricated quest authority");
  assert.strictEqual(location.rewardAuthority,false,"micro-location fabricated reward authority");
  const ids=new Set(location.props.map(p=>p.id));
  assert.strictEqual(ids.size,location.props.length,"duplicate prop IDs in composition");
  assert(location.props.every(p=>p.type==="dressing"&&p.context==="micro-location:"+location.compositionType),"composition props not routed through shared dressing renderer");
}

const first=chosen[0].location;
const chunkSize=16;
function floorDiv(n,d){let q=n/d,r=n%d;if(r!==0n&&n<0n)q-=1n;return q}
const ax=BigInt(first.anchor.x),ay=BigInt(first.anchor.y),cx=floorDiv(ax,BigInt(chunkSize)),cy=floorDiv(ay,BigInt(chunkSize));
const bounds={minX:String(cx*16n),minY:String(cy*16n),maxX:String(cx*16n+15n),maxY:String(cy*16n+15n)};
const before=api.forChunk(seed,bounds);
assert(before.locations.some(x=>x.id===first.id),"active chunk did not lazily materialize expected micro-location");
const beforeSig=before.locations.find(x=>x.id===first.id).signature;
api.clearTransient();
const after=api.forChunk(seed,bounds);
const afterLocation=after.locations.find(x=>x.id===first.id);
assert(afterLocation&&afterLocation.signature===beforeSig,"chunk unload/revisit changed micro-location composition");

const same=api.composeCell(seed,String(chosen[1].cell.x),String(chosen[1].cell.y));
assert.strictEqual(same.signature,chosen[1].location.signature,"same-SEED composition changed");
const alt=api.composeCell(otherSeed,String(chosen[1].cell.x),String(chosen[1].cell.y));
assert(!alt||alt.signature!==same.signature||alt.id!==same.id,"alternate SEED did not alter micro-location identity");

const stats=api.stats();
assert(stats.maxQueryCellsPerChunk<=4&&stats.compositionCacheEntries<=stats.compositionCacheLimit,"micro-location cache/query bound exceeded");
assert.strictEqual(stats.fullWorldScan,false,"micro-location reported full-world scan");
assert.strictEqual(stats.perFrameScan,false,"micro-location reported per-frame scan");
assert.strictEqual(stats.lazyChunkMaterialization,true,"micro-location lost lazy materialization");

const chunkSource=fs.readFileSync("scripts/render/playcanvas/chunk-world-data.js","utf8");
const meshSource=fs.readFileSync("scripts/render/playcanvas/terrain-chunk-mesh.js","utf8");
const stageSource=fs.readFileSync("scripts/world/planet-stage.js","utf8");
const html=fs.readFileSync("index.html","utf8");
assert(/MicroLocations\?\.forChunk/.test(chunkSource),"chunk world data is not wired to MicroLocations");
assert(/MicroLocations\?\.forChunk/.test(stageSource),"canonical PlanetStage is not wired to MicroLocations");
assert(/microLocations:Object\.freeze/.test(stageSource),"PlanetStage snapshot does not expose micro-location telemetry");
for(const semantic of ["campfire","tent","ruin-wall","shrine","grave","dock","fish-rack","unusual-tree","quarry","cave-mouth"]){
  assert(meshSource.includes('semantic==="'+semantic+'"'),"chunk renderer missing micro-location semantic "+semantic);
  assert(stageSource.includes('semantic==="'+semantic+'"'),"canonical PlanetStage missing micro-location semantic "+semantic);
}
assert(html.indexOf("scripts/world/world-destinations.js")<html.indexOf("scripts/world/micro-locations.js"),"MicroLocations must load after WorldDestinations");
assert(html.indexOf("scripts/world/micro-locations.js")<html.indexOf("scripts/world/planet-stage.js"),"MicroLocations must load before PlanetStage world navigation");

console.log(JSON.stringify({
  pass:true,wp:"WP-S006-007-001",classification:"MIXED",
  seed,alternateSeed:otherSeed,
  compositionTypes:chosen.map(x=>x.location.compositionType),
  samples:chosen.map(x=>({cell:x.cell,id:x.location.id,type:x.location.compositionType,sourceType:x.location.sourceType,sourceDestinationId:x.location.sourceDestinationId,anchor:x.location.anchor,anchorShiftTiles:x.location.anchorShiftTiles,propCount:x.location.propCount,signature:x.location.signature})),
  revisit:{id:first.id,signatureBefore:beforeSig,signatureAfter:afterLocation.signature,stable:true},
  bounds:{visitedCells:visited.length,maxEvidenceCells:441,maxQueryCellsPerChunk:api.MAX_QUERY_CELLS_PER_CHUNK,maxLocationsPerChunk:api.MAX_LOCATIONS_PER_CHUNK,maxPropsPerLocation:api.MAX_PROPS_PER_LOCATION,fullWorldScan:false,perFrameScan:false},
  telemetry:stats
},null,2));