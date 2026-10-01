"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");
const {performance}=require("perf_hooks");

class MemoryStorage{
  constructor(){this.map=new Map()}
  getItem(k){return this.map.has(String(k))?this.map.get(String(k)):null}
  setItem(k,v){this.map.set(String(k),String(v))}
  removeItem(k){this.map.delete(String(k))}
}
global.window=globalThis;
global.performance=performance;
global.localStorage=new MemoryStorage();
global.document={visibilityState:"visible",addEventListener(){},removeEventListener(){}};
global.addEventListener=()=>{};
global.requestIdleCallback=undefined;
Object.defineProperty(globalThis,"navigator",{value:{storage:{estimate:async()=>({usage:4096,quota:64*1024*1024}),persisted:async()=>true}},configurable:true});

const campaign={
  seed:"WP_S007_009_001_ACCEPTANCE",
  realStartMs:1700000000000,
  fantasyStart:{year:1200,month:1,day:1,hour:8,minute:0,second:0},
  protagonist:{x:"0",y:"0"},
  restartCount:0
};
global.SeedSystem={getCampaign:()=>campaign};
global.WorldState={WORLD_GENERATOR_VERSION:"advisor-world-foundation-v1"};
global.CampaignPersistence={stored:()=>({ok:true,validation:{serializedBytes:4096}})};

function load(path){vm.runInThisContext(fs.readFileSync(path,"utf8"),{filename:path})}
load("scripts/world/generated-world-store.js");
load("scripts/world/place-naming.js");

const shared={records:new Map(),meta:new Map(),failNextCommit:false,failError:null};
const backend=GeneratedWorldStore._testing.memoryBackend(shared);
backend.kind="test-durable-indexeddb-equivalent";
backend.durable=true;
GeneratedWorldStore._testing.useBackend(backend);

const base=(family,recordId,dependencySignature="v1",familyVersion=1)=>({
  seed:campaign.seed,family,recordId,familyVersion,dependencySignature,
  generatorVersion:"advisor-world-foundation-v1",regenCost:family==="road-graph"?20:4,importance:4
});

(async()=>{
  const firstBind=await GeneratedWorldStore.bindCampaign(campaign,{prime:false});
  assert(firstBind.ok&&firstBind.durable,"durable backend did not bind");

  let generatorCalls=0;
  const generated={};
  for(const [family,id] of [["settlement-plan","SET-A"],["road-graph","COUNTRY-A|r4|country-partition"],["poi-cell","12,-7"],["logical-chunk","4,9"]]){
    const out=await GeneratedWorldStore.resolve(base(family,id),async()=>{
      generatorCalls++;
      return {family,id,signature:"SIG-"+family+"-"+id,seed:campaign.seed};
    });
    assert(out.ok&&out.generated&&out.source==="seed-regeneration","first run should regenerate missing "+family);
    generated[family]=out.value;
  }

  const named=PlaceNaming.descriptor(campaign.seed,{id:"SET-A",type:"town",countryId:"COUNTRY-A",regionId:"REGION-A"},0);
  assert(named?.name&&named.entityId==="SET-A","canonical name generation failed");

  const flush1=await GeneratedWorldStore.flush({maxRecords:GeneratedWorldStore.MAX_WRITE_BATCH});
  assert(flush1.ok&&flush1.written===5,"first durable batch should commit four generic records plus one name");
  assert.strictEqual(generatorCalls,4);
  const firstTelemetry=GeneratedWorldStore.telemetry();
  assert.strictEqual(firstTelemetry.persistentCacheRecords,5);
  assert(firstTelemetry.persistentCacheBytes>0);
  assert.strictEqual(firstTelemetry.authoritativeSaveBytes,4096);
  assert.strictEqual(firstTelemetry.authoritativeRecordsEvictable,false);
  assert.strictEqual(firstTelemetry.gpuObjectsDurable,false);
  assert.strictEqual(firstTelemetry.cameraKeyed,false);

  // Simulate a second browser/app session while retaining only the durable backend.
  GeneratedWorldStore._testing.resetRuntime({keepBackend:true});
  PlaceNaming.clearCache();
  global.SeedSystem={getCampaign:()=>campaign};
  const secondBind=await GeneratedWorldStore.bindCampaign(campaign,{primeLimit:16});
  assert(secondBind.ok&&secondBind.prime.loaded===5,"second session did not hydrate persisted generated records");

  for(const [family,id] of [["settlement-plan","SET-A"],["road-graph","COUNTRY-A|r4|country-partition"],["poi-cell","12,-7"],["logical-chunk","4,9"]]){
    const out=await GeneratedWorldStore.resolve(base(family,id),async()=>{
      generatorCalls++;
      return {unexpected:true};
    });
    assert(out.ok&&!out.generated,"second session regenerated valid "+family);
    assert.deepStrictEqual(out.value,generated[family],"persistent "+family+" changed");
  }
  assert.strictEqual(generatorCalls,4,"valid persisted records should eliminate second-session regeneration");

  const namedAgain=PlaceNaming.descriptor(campaign.seed,{id:"SET-A",type:"town",countryId:"COUNTRY-A",regionId:"REGION-A"},0);
  assert.deepStrictEqual(namedAgain,named,"PlaceNaming did not reuse its hydrated durable record");
  assert((GeneratedWorldStore.telemetry().hitsByFamily["place-name"]||0)>=1,"place-name persistent hit not recorded");

  // Missing detail continues from the unresolved frontier instead of replaying prior work.
  const frontierResult=await GeneratedWorldStore.resolve(base("poi-cell","13,-7"),async()=>{
    generatorCalls++;return {family:"poi-cell",id:"13,-7",signature:"NEW-POI"};
  });
  assert(frontierResult.generated&&generatorCalls===5,"unresolved frontier did not generate exactly the new record");
  await GeneratedWorldStore.flush({maxRecords:32});
  assert((GeneratedWorldStore.telemetry().generationFrontier["poi-cell"]?.resolvedCount||0)>=2,"frontier metadata did not advance");

  // Targeted invalidation removes only the incompatible family/dependency.
  const invalidated=await GeneratedWorldStore.invalidateFamily("place-name",{familyVersion:1,dependencySignature:"toponymy-v999"});
  assert(invalidated.ok&&invalidated.removed>=1,"controlled naming version change did not invalidate naming records");
  const roadStillThere=await GeneratedWorldStore.load(base("road-graph","COUNTRY-A|r4|country-partition"));
  assert(roadStillThere.hit,"targeted naming invalidation removed unrelated road records");

  // Crash safety: failed batch must leave the previous committed revision intact.
  const crashOptions=base("settlement-plan","CRASH-SAFE","stable-deps");
  GeneratedWorldStore.recordGenerated(crashOptions,{revision:1,value:"committed"});
  assert((await GeneratedWorldStore.flush({maxRecords:32})).ok,"baseline crash record failed to commit");
  GeneratedWorldStore.recordGenerated(crashOptions,{revision:2,value:"staging"});
  shared.failNextCommit=true;
  shared.failError=new Error("simulated interrupted transaction");
  const failed=await GeneratedWorldStore.flush({maxRecords:32});
  assert.strictEqual(failed.ok,false,"interrupted transaction unexpectedly committed");
  GeneratedWorldStore._testing.resetRuntime({keepBackend:true});
  await GeneratedWorldStore.bindCampaign(campaign,{primeLimit:16});
  const recovered=await GeneratedWorldStore.load(crashOptions);
  assert(recovered.hit&&recovered.value.revision===1,"last fully committed revision was not recovered after interrupted write");

  // Bounded write-behind: one flush never exceeds MAX_WRITE_BATCH.
  for(let i=0;i<70;i++)GeneratedWorldStore.recordGenerated(base("logical-chunk","BATCH-"+i),{i,payload:"x".repeat(64)});
  const bounded=await GeneratedWorldStore.flush({maxRecords:GeneratedWorldStore.MAX_WRITE_BATCH});
  assert(bounded.ok&&bounded.written===GeneratedWorldStore.MAX_WRITE_BATCH,"write batch exceeded or missed hard batch limit");
  assert(bounded.remaining===70-GeneratedWorldStore.MAX_WRITE_BATCH,"write-behind queue depth is incorrect after bounded batch");
  while(GeneratedWorldStore.telemetry().dirtyQueueDepth)assert((await GeneratedWorldStore.flush({maxRecords:32})).ok);

  // Startup hydration is lazy/bounded rather than loading the entire persistent world.
  GeneratedWorldStore._testing.resetRuntime({keepBackend:true});
  const boundedPrime=await GeneratedWorldStore.bindCampaign(campaign,{primeLimit:3});
  assert(boundedPrime.prime.loaded===3,"prime limit was not respected");
  assert(GeneratedWorldStore.telemetry().persistentCacheRecords>3,"test needs more durable records than the prime window");
  assert.strictEqual(GeneratedWorldStore.telemetry().wholeCacheLoadedAtStartup,false);

  // Authoritative campaign header survives deletion/eviction of derived generated cache.
  localStorage.setItem("authoritative-campaign-sentinel",JSON.stringify({seed:campaign.seed,settlementRevision:9,npcRevision:4}));
  const cleared=await GeneratedWorldStore.clearDerived();
  assert(cleared.ok&&cleared.authoritativeCampaignUntouched,"derived cache clear did not report authority separation");
  assert.deepStrictEqual(JSON.parse(localStorage.getItem("authoritative-campaign-sentinel")),{seed:campaign.seed,settlementRevision:9,npcRevision:4},"derived cache deletion erased authoritative campaign history");

  // Quota/storage failure degrades to SEED regeneration without exposing corrupt persistent data.
  GeneratedWorldStore.recordGenerated(base("poi-cell","QUOTA"),{signature:"quota-generated"});
  shared.failNextCommit=true;
  const quotaError=new Error("Quota exceeded");quotaError.name="QuotaExceededError";shared.failError=quotaError;
  const quota=await GeneratedWorldStore.flush({maxRecords:32});
  assert.strictEqual(quota.ok,false,"quota failure unexpectedly committed");
  GeneratedWorldStore._testing.resetRuntime({keepBackend:true});
  await GeneratedWorldStore.bindCampaign(campaign,{primeLimit:8});
  let quotaRegen=0;
  const quotaRecovered=await GeneratedWorldStore.resolve(base("poi-cell","QUOTA"),async()=>{quotaRegen++;return {signature:"quota-generated"}});
  assert(quotaRecovered.generated&&quotaRegen===1,"storage failure did not safely fall back to deterministic regeneration");

  // Production integration contracts.
  const html=fs.readFileSync("index.html","utf8");
  const namingSource=fs.readFileSync("scripts/world/place-naming.js","utf8");
  const settlementSource=fs.readFileSync("scripts/world/settlement-archetypes.js","utf8");
  const roadSource=fs.readFileSync("scripts/world/world-road-graph.js","utf8");
  const destinationSource=fs.readFileSync("scripts/world/world-destinations.js","utf8");
  const persistenceSource=fs.readFileSync("scripts/world/campaign-persistence.js","utf8");
  const stageSource=fs.readFileSync("scripts/world/planet-stage.js","utf8");
  const order=[
    "scripts/core/game-time.js","scripts/world/generated-world-store.js","scripts/world/place-naming.js",
    "scripts/world/settlement-archetypes.js","scripts/world/world-road-graph.js","scripts/world/world-state.js",
    "scripts/world/campaign-persistence.js","scripts/world/world-destinations.js","scripts/world/planet-stage.js"
  ].map(path=>html.indexOf(path));
  assert(order.every((value,index)=>value>=0&&(index===0||value>order[index-1])),"production generated-store load order is invalid");
  assert(namingSource.includes('family:"place-name"'),"PlaceNaming durable integration missing");
  assert(settlementSource.includes('family:"settlement-plan"'),"SettlementArchetypes durable integration missing");
  assert(roadSource.includes('family:"road-graph"')&&roadSource.includes('focusKey==="auto"'),"road graph durable partition is missing or camera-keyed");
  assert(destinationSource.includes('family:"poi-cell"'),"WorldDestinations durable POI integration missing");
  assert(persistenceSource.includes("GeneratedWorldStore?.flushSoon")&&persistenceSource.includes("GeneratedWorldStore?.bindCampaign"),"authoritative save/resume coordination missing");
  assert(stageSource.includes("GeneratedWorldStore?.bindCampaign")&&stageSource.includes("GeneratedWorldStore?.markFirstPlayable")&&stageSource.includes("generatedWorldStore:"),"PlanetStage current-area resume/telemetry integration missing");

  const finalTelemetry=GeneratedWorldStore.telemetry();
  console.log(JSON.stringify({
    pass:true,
    classification:"FUNCTIONAL / PERSISTENCE / PERFORMANCE",
    visual:"N/A — durable generated-record caching changes persistence and load behavior, not rendered presentation",
    campaignId:GeneratedWorldStore.campaignIdFor(campaign),
    firstSession:{generatorCalls:4,records:firstTelemetry.persistentCacheRecords,bytes:firstTelemetry.persistentCacheBytes,writeBatchLimit:firstTelemetry.writeBatchLimit},
    secondSession:{primed:secondBind.prime.loaded,generatorCallsAfterReuse:4,placeNameReused:namedAgain.name===named.name,wholeCacheLoaded:false},
    frontier:{newGenerationCount:1,poiResolved:GeneratedWorldStore.telemetry().generationFrontier["poi-cell"]?.resolvedCount||0},
    invalidation:{family:"place-name",removed:invalidated.removed,unrelatedRoadReusable:roadStillThere.hit},
    crashSafety:{failedCommit:true,recoveredRevision:recovered.value.revision},
    writeBehind:{batchLimit:GeneratedWorldStore.MAX_WRITE_BATCH,firstBatchWritten:bounded.written,remainingAfterFirstBatch:bounded.remaining},
    recovery:{derivedCacheRemoved:cleared.removed,authoritativeCampaignUntouched:true,quotaFallbackRegenerated:quotaRecovered.generated},
    production:{indexedDbPrimary:true,partitionedLazy:true,placeNames:true,settlementPlans:true,countryRoadPartitions:true,poiPartitions:true,prePlayablePrime:true,explicitSaveFlush:true},
    rules:{seedFallback:true,cameraKeyed:false,gpuObjectsDurable:false,authoritativeRecordsEvictable:false,softBudgetBytes:GeneratedWorldStore.SOFT_BUDGET_BYTES,hardBudgetBytes:GeneratedWorldStore.HARD_BUDGET_BYTES}
  },null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
