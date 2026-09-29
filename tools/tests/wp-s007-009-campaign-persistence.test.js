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
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],body:null};
global.location={search:"",hash:"",pathname:"/"};
global.innerWidth=1440;
global.innerHeight=900;
global.devicePixelRatio=1;
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
  "scripts/world/world-state.js",
  "scripts/core/event-scheduler.js"
].forEach(load);

global.GlobalCountrySimulation={
  ensureScheduled(){return {scheduled:0}},
  tick(){return {batch:{processedCount:0}}}
};
global.RegionalSettlementSimulation={
  ensureScheduled(){return {scheduled:0}},
  tick(){return {batch:{processedCount:0}}}
};
global.NPCLifecycle={};

load("scripts/world/lazy-catchup.js");
load("scripts/world/campaign-persistence.js");

assert(global.CampaignPersistence,"CampaignPersistence API missing");
assert(WorldState.serializeState&&WorldState.restoreSerializedState,"WorldState persistence hooks missing");
assert(CatchUpSimulation.serializeState&&CatchUpSimulation.restoreSerializedState,"CatchUp persistence hooks missing");

function addHours(value,hours){
  const ms=Date.parse(String(value).replace(" ","T")+"Z")+hours*3600000;
  const d=new Date(ms),p=n=>String(n).padStart(2,"0");
  return String(d.getUTCFullYear()).padStart(4,"0")+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate())+" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+":"+p(d.getUTCSeconds());
}
function resetRuntime(campaign,timestamp){
  WorldState.bindCampaign(campaign,{reset:true});
  EventScheduler.reset(campaign.seed);
  CatchUpSimulation.bindCampaign(campaign,{reset:true,timestamp});
}
function jsonClone(v){return JSON.parse(JSON.stringify(v))}

const seed="WP_S007_009_ACCEPTANCE";
const started=SeedSystem.startNewCampaign(seed);
assert(started.ok&&started.campaign,"campaign creation failed");
const campaign=started.campaign;
const fixedTimestamp=GameTime.getTimestampKey();
resetRuntime(campaign,fixedTimestamp);

const settlementRef=WorldState.structuralRef(seed,"settlement-progress","WORLD","SETTLEMENT:ALPHA",{
  stableSettlementId:"SETTLEMENT:ALPHA",populationBaseline:180
});
const npcRef=WorldState.structuralRef(seed,"npc",settlementRef.id,"NPC:ALPHA:001",{
  stableNpcId:"NPC:ALPHA:001",name:"Test Resident",profession:"smith"
});
assert(WorldState.applyDelta(seed,settlementRef,{population:214,prosperity:0.63,ownerId:"HOUSE:A"},"save-load settlement mutation").ok);
assert(WorldState.applyDelta(seed,npcRef,{state:{alive:true,duty:"smith-shift",relationshipRevision:3}},"save-load npc mutation").ok);

const distantRef=WorldState.terrainRef(seed,"1000000","-1000000");
const distantBefore=WorldState.resolve(seed,distantRef);
assert(distantBefore&&distantBefore.currentSignature,"distant SEED foundation failed");
const deltaBefore=WorldState.deltaSnapshot(seed);
assert(!deltaBefore.entries.some(e=>e.entityId===distantRef.id),"untouched distant foundation was serialized as delta");

const futureEvent=EventScheduler.schedule(seed,{
  fantasyTimestamp:addHours(fixedTimestamp,24),
  systemKind:"future-test",
  entityId:npcRef.id,
  slotKey:"resume-proof",
  payload:{kind:"scheduled-future-proof"}
}).event;
assert(futureEvent&&futureEvent.id,"future scheduler event missing");
CatchUpSimulation.persist(seed);

const created=CampaignPersistence.createSave({capturedRealMs:123456789,persist:true});
assert(created.ok,created.reason);
const save=created.save;
const validation=CampaignPersistence.validate(save);
assert(validation.ok,validation.reason);

assert.strictEqual(save.schema,"AdvisorCampaignSave");
assert.strictEqual(save.saveSchemaVersion,1);
assert.strictEqual(save.worldGeneratorVersion,WorldState.WORLD_GENERATOR_VERSION);
assert.strictEqual(save.simulationRulesVersion,CampaignPersistence.SIMULATION_RULES_VERSION);
assert.strictEqual(save.seed,seed);
assert.strictEqual(save.campaignKey,[campaign.seed,campaign.realStartMs,campaign.restartCount].join("|"));
assert(save.gameTime.creationFantasyTimestamp&&save.gameTime.currentAuthoritativeFantasyTimestamp,"fantasy timestamps missing");
assert(save.gameTime.offlineProgressionPolicy&&save.gameTime.offlineProgressionPolicy.fantasyHoursPerRealHour===24,"offline progression metadata missing");
assert(save.schedulerState.pendingEvents.some(e=>e.id===futureEvent.id),"scheduled event metadata missing");
assert(save.catchUpState.lastAuthoritativeTimestamp===fixedTimestamp,"catch-up checkpoint missing");
assert(save.deltaIndex.settlement.includes(settlementRef.id),"settlement delta index missing");
assert(save.deltaIndex.npc.includes(npcRef.id),"NPC delta index missing");
assert.strictEqual(save.sparse,true);
assert.strictEqual(save.wholeWorldSerialized,false);
assert.strictEqual(save.renderStateSerialized,false);
assert.strictEqual(save.cameraStateSerialized,false);
assert(save.serializedBytes<CampaignPersistence.MAX_SAVE_BYTES,"save exceeded sparse budget");

const worldStateSerialized=save.campaignStateDelta;
assert(!JSON.stringify(worldStateSerialized).includes(distantBefore.foundationSignature),"distant immutable foundation leaked into sparse save");
assert(Object.keys(worldStateSerialized.entries).length===2,"unexpected sparse delta count");

const settlementBefore=WorldState.resolve(seed,settlementRef);
const npcBefore=WorldState.resolve(seed,npcRef);
const schedulerBefore=EventScheduler.serialize(seed);

resetRuntime(campaign,fixedTimestamp);
assert.strictEqual(WorldState.deltaSnapshot(seed).entryCount,0,"runtime reset did not clear deltas");

(async()=>{
  const restored=await CampaignPersistence.restoreAndResume(save,{targetTimestamp:fixedTimestamp,maxBatches:4,maxSlices:8});
  assert(restored.ok&&restored.complete&&restored.authoritativeReady,restored.reason||restored.error);
  assert.strictEqual(CampaignPersistence.resumeStatus().ready,true,"gameplay readiness gate did not open after catch-up");
  const settlementAfter=WorldState.resolve(seed,settlementRef);
  const npcAfter=WorldState.resolve(seed,npcRef);
  assert.strictEqual(settlementAfter.currentSignature,settlementBefore.currentSignature,"settlement delta changed after reload");
  assert.strictEqual(npcAfter.currentSignature,npcBefore.currentSignature,"NPC persistent state changed after reload");
  assert.strictEqual(settlementAfter.entityRef.id,settlementRef.id,"settlement stable ID changed");
  assert.strictEqual(npcAfter.entityRef.id,npcRef.id,"NPC stable ID changed");
  const schedulerAfter=EventScheduler.serialize(seed);
  assert.deepStrictEqual(schedulerAfter.pendingEvents.map(e=>e.id),schedulerBefore.pendingEvents.map(e=>e.id),"scheduler pending events changed after reload");
  assert.strictEqual(WorldState.deltaSnapshot(seed).entryCount,2,"saved sparse deltas not fully restored");

  const distantAfter=WorldState.resolve(seed,distantRef);
  assert.strictEqual(distantAfter.foundationSignature,distantBefore.foundationSignature,"untouched distant area failed deterministic SEED regeneration");

  const firstSignatures={...restored.signatures,settlement:settlementAfter.currentSignature,npc:npcAfter.currentSignature,distant:distantAfter.foundationSignature};

  resetRuntime(campaign,fixedTimestamp);
  global.innerWidth=390;global.innerHeight=844;global.devicePixelRatio=3;
  const mobileRestore=await CampaignPersistence.restoreAndResume(save,{targetTimestamp:fixedTimestamp,maxBatches:1,maxSlices:8});
  assert(mobileRestore.ok&&mobileRestore.authoritativeReady,"mobile/device-timing restore failed");
  const secondSignatures={...mobileRestore.signatures,settlement:WorldState.resolve(seed,settlementRef).currentSignature,npc:WorldState.resolve(seed,npcRef).currentSignature,distant:WorldState.resolve(seed,distantRef).foundationSignature};
  assert.deepStrictEqual(secondSignatures,firstSignatures,"camera/device timing changed authoritative resume state");

  resetRuntime(campaign,fixedTimestamp);
  const beforeInvalid=WorldState.deltaSnapshot(seed).entryCount;
  const generatorMismatch=jsonClone(save);generatorMismatch.worldGeneratorVersion="advisor-world-foundation-v0";
  const mismatchResult=await CampaignPersistence.restoreAndResume(generatorMismatch,{targetTimestamp:fixedTimestamp});
  assert.strictEqual(mismatchResult.ok,false,"generator-version mismatch loaded silently");
  assert.strictEqual(mismatchResult.reason,"generator-version-incompatible");
  assert.strictEqual(WorldState.deltaSnapshot(seed).entryCount,beforeInvalid,"incompatible load mutated world state");

  const simulationMismatch=jsonClone(save);simulationMismatch.simulationRulesVersion="advisor-simulation-rules-v0";
  const simCheck=CampaignPersistence.validate(simulationMismatch);
  assert.strictEqual(simCheck.reason,"simulation-version-incompatible","simulation mismatch was not detected");

  const corrupt=jsonClone(save);
  corrupt.campaignStateDelta.entries[settlementRef.id].changes.population=999999;
  const corruptResult=await CampaignPersistence.restoreAndResume(corrupt,{targetTimestamp:fixedTimestamp});
  assert.strictEqual(corruptResult.ok,false,"corrupt checksum loaded");
  assert.strictEqual(corruptResult.reason,"checksum-mismatch");
  assert.strictEqual(CampaignPersistence.resumeStatus().ready,false,"failed load exposed authoritative-ready state");

  const stored=CampaignPersistence.stored();
  assert(stored.ok,"stored versioned checkpoint did not validate");
  assert.strictEqual(stored.save.catchUpState.lastAuthoritativeTimestamp,fixedTimestamp,"post-resume checkpoint did not retain authoritative timestamp");
  assert(stored.save.checksum===mobileRestore.checkpointChecksum||stored.save.checksum===restored.checkpointChecksum,"stored checkpoint checksum not returned by resume");

  const html=fs.readFileSync("index.html","utf8");
  const stageSource=fs.readFileSync("scripts/world/planet-stage.js","utf8");
  const dependencyOrder=[
    "scripts/world/world-state.js","scripts/core/event-scheduler.js","scripts/world/global-country-simulation.js",
    "scripts/world/regional-settlement-simulation.js","scripts/world/npc-lifecycle.js","scripts/world/lazy-catchup.js",
    "scripts/world/campaign-persistence.js","scripts/world/planet-stage.js"
  ].map(path=>html.indexOf(path));
  assert(dependencyOrder.every((value,index)=>value>=0&&(index===0||value>dependencyOrder[index-1])),"production persistence dependency load order invalid");
  assert(/CampaignPersistence\.restoreAndResume/.test(stageSource),"PlanetStage production bootstrap does not use versioned restore gate");
  assert(/CampaignPersistence\.createSave/.test(stageSource),"PlanetStage does not checkpoint adopted existing campaigns");
  assert(/Saved campaign is incompatible or corrupt/.test(stageSource),"production load failure is not user-visible/actionable");

  console.log(JSON.stringify({
    pass:true,
    classification:"FUNCTIONAL",
    visual:"N/A — versioned persistence and deterministic resume authority add no rendered surface",
    seed,
    save:{
      schema:save.schema,saveSchemaVersion:save.saveSchemaVersion,
      worldGeneratorVersion:save.worldGeneratorVersion,simulationRulesVersion:save.simulationRulesVersion,
      serializedBytes:save.serializedBytes,checksum:save.checksum,sparse:save.sparse,
      deltaEntries:Object.keys(save.campaignStateDelta.entries).length,
      deltaFamilies:Object.fromEntries(Object.entries(save.deltaIndex).map(([k,v])=>[k,v.length])),
      schedulerPending:save.schedulerState.pendingEvents.length,
      lastAuthoritativeTimestamp:save.catchUpState.lastAuthoritativeTimestamp
    },
    restore:{
      authoritativeReady:restored.authoritativeReady,
      targetTimestamp:restored.targetTimestamp,
      deltaEntryCount:restored.deltaEntryCount,
      schedulerPending:restored.schedulerPending,
      signatures:firstSignatures,
      deviceInvariant:true,
      stableIds:true,
      distantSeedRegeneration:true
    },
    compatibility:{
      generatorMismatch:mismatchResult.reason,
      simulationMismatch:simCheck.reason,
      corruption:corruptResult.reason,
      partialStateInteractable:false,
      migrationsImplemented:0,
      productionBootstrapIntegrated:true,
      userVisibleFailure:true
    },
    bounds:{maxSaveBytes:CampaignPersistence.MAX_SAVE_BYTES,wholeWorldSerialized:false,renderStateSerialized:false,cameraStateSerialized:false}
  },null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
