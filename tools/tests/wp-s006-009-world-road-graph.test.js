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
  "scripts/world/planet-geography.js",
  "scripts/world/geography.js",
  "scripts/world/political-geography.js",
  "scripts/world/country-profile.js",
  "scripts/world/region-profile.js",
  "scripts/world/country-relations.js",
  "scripts/world/starting-village.js",
  "scripts/world/settlement-archetypes.js",
  "scripts/world/world-road-graph.js"
].forEach(load);

assert(global.WorldRoadGraph,"WorldRoadGraph API missing");
const api=global.WorldRoadGraph;
const seed="WP_S006_009_ACCEPTANCE";
const alternateSeed="WP_S006_009_ACCEPTANCE_ALT";
const country=global.PoliticalGeography.countryAt(seed,"0","0");
assert(country&&country.id,"canonical origin country missing");

const started=performance.now();
const first=api.graphForCountry(seed,country,{radius:4});
const coldMs=performance.now()-started;
assert(first,"road graph missing");
assert(first.nodes.length>=2,"road graph needs at least two canonical settlement nodes");
assert(first.nodes.length<=api.MAX_NODES,"node cap exceeded");
assert(first.edges.length>=first.nodes.length-1,"backbone does not connect every node");
assert(first.edges.length<=api.MAX_EDGES,"edge cap exceeded");
assert.strictEqual(first.diagnostics.connectedComponents,1,"road graph is disconnected");
assert.strictEqual(first.diagnostics.bounded,true,"graph is not bounded");
assert.strictEqual(first.diagnostics.fullWorldScan,false,"graph reported full-world scan");
assert.strictEqual(first.diagnostics.localChunkMaterialization,false,"graph materialized local chunks");
assert.strictEqual(first.diagnostics.detailedSegmentsMaterialized,0,"graph materialized detailed route geometry");
assert.strictEqual(first.diagnostics.perFramePlanning,false,"graph planning leaked into per-frame work");
assert(first.diagnostics.candidateComparisonCount>0,"hierarchy parent candidates were not compared");
assert(first.diagnostics.totalCorridorSamples>=first.edges.length*3,"route corridor evidence missing");
assert(first.diagnostics.geographyInfluencedEdgeCount===first.edges.length,"geography did not influence every planned edge");
assert(first.diagnostics.planningMs<=8000,"cold graph planning exceeded 8s acceptance budget");
assert(coldMs<=9000,"cold graph wall-clock exceeded 9s acceptance budget");

for(const node of first.nodes){
  assert(node.id&&node.name&&node.center&&node.roadNetworkRole,"node descriptor incomplete");
  assert.strictEqual(node.countryId,String(country.id),"node escaped requested country");
  assert(node.localApproach&&node.localApproach.authority,"settlement approach metadata missing");
}
for(const edge of first.edges){
  assert(edge.id&&edge.aId&&edge.bId&&edge.roadClass,"edge descriptor incomplete");
  assert(["trunk","primary","secondary","local"].includes(edge.roadClass),"unknown road class");
  assert(edge.geometry&&edge.geometry.points.length===11,"coarse corridor geometry incomplete");
  assert(edge.geometry.samples.length===edge.geometry.points.length,"corridor sample evidence mismatch");
  assert(Number.isFinite(edge.distanceMeters)&&edge.distanceMeters>0,"edge distance invalid");
  assert(Number.isFinite(edge.straightLineMeters)&&edge.straightLineMeters>0,"straight-line distance invalid");
  assert(Number.isFinite(edge.geometry.detourRatio)&&edge.geometry.detourRatio>=1,"detour ratio invalid");
  assert(Number.isFinite(edge.geometry.maxGrade)&&edge.geometry.maxGrade>=0,"grade evidence invalid");
  assert.strictEqual(edge.descriptorOnly,true,"edge is not descriptor-only");
  assert.strictEqual(edge.localDetailedSegmentsMaterialized,0,"edge materialized local detail");
}

const ids=new Set(first.nodes.map(node=>node.id));
for(const junction of first.junctions){
  assert(ids.has(junction.nodeId),"junction references unknown graph node");
  assert(junction.degree>=3,"junction degree below 3");
  assert.strictEqual(junction.branches.length,junction.degree,"junction branch count mismatch");
}

const root=first.nodes[0];
let routeCount=0;
let maxRouteQueryMs=0;
for(const node of first.nodes){
  if(node.id===root.id)continue;
  const route=api.route(seed,country,node.id,root.id,{radius:4});
  assert(route.found,"no road-only route from "+node.name+" to "+root.name);
  assert(route.edgeIds.length>=1,"non-root route has no graph edges");
  assert(route.nodeIds[0]===node.id&&route.nodeIds.at(-1)===root.id,"route endpoints changed");
  assert.strictEqual(route.bounded,true,"route query exceeded expansion budget");
  assert.strictEqual(route.localChunkMaterialization,false,"route query materialized local chunks");
  assert(route.expandedNodes<=api.MAX_ROUTE_EXPANSIONS,"route expansion cap exceeded");
  maxRouteQueryMs=Math.max(maxRouteQueryMs,route.queryMs);
  routeCount++;
}
assert(routeCount===first.nodes.length-1,"not every settlement could route to the graph hub");
assert(maxRouteQueryMs<=100,"descriptor road routing exceeded 100ms");

const same=api.graphForCountry(seed,country,{radius:4});
assert.strictEqual(same.signature,first.signature,"same graph query changed signature");
api.clear();
const rebuilt=api.graphForCountry(seed,country,{radius:4});
assert.strictEqual(rebuilt.signature,first.signature,"cache-clear rebuild changed graph signature");

const altCountry=global.PoliticalGeography.countryAt(alternateSeed,"0","0");
const alt=api.graphForCountry(alternateSeed,altCountry,{radius:4});
assert(alt&&alt.signature,"alternate-SEED graph missing");
assert.notStrictEqual(alt.signature,first.signature,"alternate SEED did not change graph signature");

const proof=api.proof(seed,country);
assert.strictEqual(proof.pass,true,"built-in road graph proof failed");
assert.strictEqual(proof.deterministic,true,"built-in graph determinism failed");
assert.strictEqual(proof.everyConnected,true,"built-in connectivity proof failed");
assert.strictEqual(proof.routePass,true,"built-in route proof failed");

const starting=first.nodes.find(node=>node.role==="starting-village");
if(starting){
  assert.strictEqual(starting.localApproach.kind,"starting-village-gateway","starting village did not expose its canonical road gateway");
}

const classes=new Set(first.nodes.map(node=>node.classId));
const edgeClasses=new Set(first.edges.map(edge=>edge.roadClass));
const hierarchyCoverage=["town","village"].filter(cls=>classes.has(cls));
assert(hierarchyCoverage.length>=1,"representative lower-order settlement class missing");
assert(edgeClasses.size>=1,"road hierarchy classification missing");

const sharedUse=new Map();
for(const node of first.nodes.filter(node=>node.id!==root.id).slice(-Math.min(8,first.nodes.length-1))){
  const route=api.route(seed,country,node.id,root.id,{radius:4});
  for(const edgeId of route.edgeIds)sharedUse.set(edgeId,(sharedUse.get(edgeId)||0)+1);
}
const sharedCorridor=[...sharedUse.entries()].filter(([,count])=>count>=2);
assert(sharedCorridor.length>=1||first.nodes.length<=2,"no shared corridor appears in representative settlement-to-hub routes");

const html=fs.readFileSync("index.html","utf8");
const settlementIndex=html.indexOf("scripts/world/settlement-archetypes.js");
const roadIndex=html.indexOf("scripts/world/world-road-graph.js");
const signIndex=html.indexOf("scripts/world/road-signposts.js");
const destinationIndex=html.indexOf("scripts/world/world-destinations.js");
assert(settlementIndex>=0&&roadIndex>settlementIndex,"world-road-graph.js must load after canonical settlement hierarchy");
assert(signIndex>roadIndex&&destinationIndex>roadIndex,"road graph authority must load before signposts and destinations");

console.log(JSON.stringify({
  pass:true,
  seed,
  country:{id:first.countryId,name:first.countryName},
  signature:first.signature,
  alternateSignature:alt.signature,
  deterministic:true,
  coldMs:Number(coldMs.toFixed(3)),
  planningMs:first.diagnostics.planningMs,
  routeCount,
  maxRouteQueryMs:Number(maxRouteQueryMs.toFixed(3)),
  nodeCount:first.nodes.length,
  edgeCount:first.edges.length,
  junctionCount:first.junctions.length,
  nodeClassCounts:first.diagnostics.nodeClassCounts,
  edgeClassCounts:first.diagnostics.edgeClassCounts,
  connectedComponents:first.diagnostics.connectedComponents,
  redundancyEdgeCount:first.diagnostics.redundancyEdgeCount,
  geography:{
    influencedEdges:first.diagnostics.geographyInfluencedEdgeCount,
    detouredEdges:first.diagnostics.detouredEdgeCount,
    waterCrossings:first.diagnostics.waterCrossingCount,
    corridorSamples:first.diagnostics.totalCorridorSamples
  },
  representativeSharedCorridors:sharedCorridor.slice(0,8),
  settlementApproach:starting?starting.localApproach:null,
  bounded:{
    maxNodes:api.MAX_NODES,maxEdges:api.MAX_EDGES,maxRouteExpansions:api.MAX_ROUTE_EXPANSIONS,
    fullWorldScan:false,localChunkMaterialization:false,detailedSegmentsMaterialized:0,perFramePlanning:false
  }
},null,2));
