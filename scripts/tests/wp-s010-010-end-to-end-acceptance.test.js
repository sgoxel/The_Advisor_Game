"use strict";
const assert=require("assert");
const path=require("path");

global.window=global;
global.TextEncoder=global.TextEncoder||require("util").TextEncoder;

function clone(v){return v==null||typeof v!=="object"?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));}
function merge(a,b){if(!b||typeof b!=="object"||Array.isArray(b))return clone(b);const out=(a&&typeof a==="object"&&!Array.isArray(a))?clone(a):{};for(const [k,v] of Object.entries(b))out[k]=(v&&typeof v==="object"&&!Array.isArray(v))?merge(out[k],v):clone(v);return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function makeWorld(){
  const stores=new Map();
  function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:"CampaignStateDelta",seed,sequence:0,entries:{}});return stores.get(seed);}
  return {
    structuralRef(seed,kind,parent,key,initial){return {id:"STR|"+String(kind).toUpperCase()+"|"+hash([seed,kind,parent,key].join("|")),kind,key:{initial:clone(initial||{})}};},
    resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry?clone(entry):null};},
    applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:"ok",entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)};},
    serializeState(seed){return clone(ensure(seed));},
    restoreSerializedState(campaign,value){stores.set(String(campaign.seed),clone(value));return {ok:true};},
    clear(seed){stores.set(seed,{schema:"CampaignStateDelta",seed,sequence:0,entries:{}});}
  };
}

const seed="AGENT6-WP-S010-010";
const when="1201-09-30 21:25:00";
global.WorldState=makeWorld();
global.GameTime={getTimestampKey(){return when;}};
global.SeedSystem={getCampaign(){return {seed,protagonistId:"protagonist"};}};

const sim={contextCalls:0,attemptCalls:0};
global.ObjectInteractions=Object.freeze({
  get(seedValue,id){return seedValue===seed&&id==="OBJ-ACCEPT"?Object.freeze({id,type:"workbench",buildingId:"BLDG-A",actions:Object.freeze(["inspect"])}):null;},
  context(seedValue,id,actorPosition){
    sim.contextCalls++;
    if(seedValue!==seed||id!=="OBJ-ACCEPT")return null;
    const ready=String(actorPosition?.x)==="0"&&String(actorPosition?.y)==="0";
    return Object.freeze({id,actions:Object.freeze([Object.freeze({id:"inspect",enabled:ready,reason:ready?"ready":"out-of-range",target:Object.freeze({x:"0",y:"0",level:0})})])});
  },
  attempt(seedValue,request){
    sim.attemptCalls++;
    assert.strictEqual(seedValue,seed);
    assert.strictEqual(request.actorKind,"protagonist");
    assert.strictEqual(request.objectId,"OBJ-ACCEPT");
    assert.strictEqual(request.action,"inspect");
    return Object.freeze({ok:true,status:"completed",reason:"inspected",id:"SIM-INSPECT-RESULT",objectId:"OBJ-ACCEPT",action:"inspect",authoritative:true});
  }
});

const Router=require("../world/local-conversation-router.js");
const CommandSet=require("../world/command-set-interface.js");
const Pipeline=require("../world/protagonist-interaction-pipeline.js");
const Evaluator=require("../world/protagonist-command-evaluator.js");
const Runtime=require("../world/protagonist-action-runtime.js");
require("../world/conversation-transactions.js");
const Ledger=global.ConversationTransactions;

function commandSnapshot(){
  return CommandSet.buildSnapshot({seed,when,origin:{x:"0",y:"0"}},{
    getResidentRoster(){return Object.freeze([Object.freeze({id:"R01",name:"Rowan"})]);},
    getDailyActivities(){return Object.freeze([Object.freeze({residentId:"R01",target:{x:"0",y:"0"},state:"working",action:"inspect",intendedAction:"inspect",label:"Inspecting workshop bench",buildingId:"BLDG-A",interactionObjectId:"OBJ-ACCEPT",interactionObjectType:"workbench",targetSource:"interior-interaction"})]);},
    queryDestinations(){return Object.freeze({results:Object.freeze([]),diagnostics:Object.freeze({bounded:true,fullWorldScan:false})});},
    getCountry(){return null;},getRoadGraph(){return null;},getKnownLeads(){return Object.freeze([]);}
  });
}
function adviceRoute(){
  return Router.route("Speak with Rowan and inspect the workshop bench.",{
    seed,when,character:{id:"protagonist",name:"Protagonist"},externalAiEnabled:false
  },{
    matchSentence(){return null;},getMemory(){return Object.freeze([]);},getAdvice(){return Object.freeze([]);},getSocialContext(){return null;}
  });
}
function proposalFromAdvice(route,snapshot,proposalId="PROP-WP-S010-010"){
  assert.strictEqual(route.selectedIntentId,"advisor.interaction.request","acceptance adapter requires the recognized interaction intent");
  const person=snapshot.targets.people.find(row=>row.id==="R01");
  const interaction=snapshot.targets.interactions.find(row=>row.id==="OBJ-ACCEPT");
  assert(person&&interaction&&interaction.personIds.includes(person.id),"bounded snapshot must expose the authoritative person/object association");
  return Object.freeze({proposalId,commandId:"advisor.propose_interaction",parameters:Object.freeze({personId:person.id,interactionTargetId:interaction.id,topic:"Inspect the workshop bench"}),source:"wp-s010-010-acceptance-harness"});
}
function reset(seedValue=seed){
  Runtime.reset();
  Pipeline.clear(seedValue);
  Ledger.clear(seedValue);
}
function runSuccess(){
  reset();
  const snapshot=commandSnapshot(),route=adviceRoute(),proposal=proposalFromAdvice(route,snapshot);
  assert.strictEqual(snapshot.diagnostics.fullWorldScan,false);
  assert.strictEqual(snapshot.capabilities.executionAuthority,false);
  assert.strictEqual(route.worldMutation,false);
  assert.strictEqual(route.actionExecuted,false);
  const scheduled=Runtime.schedule({seed,when,snapshot,proposal,actorId:"protagonist",actorPosition:{x:"0",y:"0"},decisionContext:{value:.98,urgency:.92,socialAcceptability:.95}});
  assert.strictEqual(scheduled.ok,true);
  const tick=Runtime.tick({seed,when,maxAttempts:1});
  assert.strictEqual(tick.ok,true);assert.strictEqual(tick.processedCount,1);
  const row=tick.processed[0],evaluation=row.evaluatorResult;
  assert.strictEqual(row.state,"succeeded");assert.strictEqual(row.terminal,true);
  assert.strictEqual(evaluation.decision,"accepted");
  assert.strictEqual(evaluation.finalValidation.ok,true);
  assert.strictEqual(evaluation.execution.state,"completed");
  assert.strictEqual(evaluation.execution.actionExecuted,true);
  assert.strictEqual(evaluation.execution.delegate,"ProtagonistInteractionPipeline -> ObjectInteractions/ActionExecutor");
  assert.strictEqual(evaluation.execution.authoritativeResult.terminal,true);
  assert.strictEqual(evaluation.authority.directControl,false);
  assert.strictEqual(evaluation.authority.directPositionMutation,false);
  assert.strictEqual(evaluation.authority.teleportation,false);
  const interaction=Pipeline.get(seed,evaluation.execution.authoritativeResult.attemptId);
  assert(interaction);assert.strictEqual(interaction.status,"terminal-success");
  assert.strictEqual(interaction.simulation.authoritativeTerminalSuccess,true);
  const message={messageId:"MSG-WP-S010-010",role:"player",text:"Speak with Rowan and inspect the workshop bench.",referenceId:"ADVICE-WP-S010-010"};
  const stored=Ledger.fromEvaluation(seed,message,route,evaluation,{characterMemoryIds:["MEM-WP-S010-010"],replyText:"I inspected the workshop bench. Simulation confirmed the result."});
  assert.strictEqual(stored.ok,true);
  assert.strictEqual(stored.record.outcome.state,"completed");
  assert.strictEqual(stored.record.outcome.authoritativeExecution,true);
  assert.strictEqual(stored.record.outcome.simulationResultId,evaluation.executionId);
  assert(stored.record.links.proposalIds.includes(evaluation.proposal.proposalId));
  assert(stored.record.links.decisionIds.includes(evaluation.decisionId));
  assert(stored.record.links.simulationResultIds.includes(evaluation.executionId));
  assert(stored.record.links.characterMemoryIds.includes("MEM-WP-S010-010"));
  return {snapshot,route,proposal,scheduled,tick,row,evaluation,interaction,stored};
}

const first=runSuccess();
const saved=WorldState.serializeState(seed);
const firstLedger=Ledger.snapshot(seed);
WorldState.clear(seed);
assert.strictEqual(Ledger.snapshot(seed).recordCount,0);
WorldState.restoreSerializedState({seed},saved);
const restored=Ledger.snapshot(seed);
assert.deepStrictEqual(restored.records,firstLedger.records,"persistent history must preserve the authoritative completion/reference chain");

const stable={
  runtimeAttemptId:first.row.attemptId,
  decisionId:first.evaluation.decisionId,
  executionId:first.evaluation.executionId,
  interactionAttemptId:first.interaction.attemptId,
  interactionResultId:first.interaction.resultId,
  conversationId:first.stored.record.id
};
const second=runSuccess();
assert.deepStrictEqual({
  runtimeAttemptId:second.row.attemptId,
  decisionId:second.evaluation.decisionId,
  executionId:second.evaluation.executionId,
  interactionAttemptId:second.interaction.attemptId,
  interactionResultId:second.interaction.resultId,
  conversationId:second.stored.record.id
},stable,"same Campaign SEED + Fantasy Game Time + inputs must reproduce stable chain IDs");

const snapshot=commandSnapshot(),route=adviceRoute(),validProposal=proposalFromAdvice(route,snapshot,"PROP-ZERO-ACTION");
function runZero(proposal,decisionContext){
  const runtime=Runtime.createRuntime({evaluator:Evaluator});
  const before=sim.attemptCalls;
  const scheduled=runtime.schedule({seed,when,snapshot,proposal,actorId:"protagonist",actorPosition:{x:"0",y:"0"},decisionContext});
  assert.strictEqual(scheduled.ok,true);
  const tick=runtime.tick({seed,when,maxAttempts:1});
  assert.strictEqual(tick.processedCount,1);
  assert.strictEqual(sim.attemptCalls,before,"zero-action path must not reach Simulation attempt");
  return tick.processed[0];
}
const rejected=runZero(validProposal,{value:.02,urgency:.02,socialAcceptability:.02});
assert.strictEqual(rejected.state,"rejected");assert.strictEqual(rejected.evaluatorResult.execution.attempted,false);
const deferred=runZero({...validProposal,proposalId:"PROP-DEFER"},{value:.50,urgency:.50,socialAcceptability:.50});
assert.strictEqual(deferred.state,"deferred");assert.strictEqual(deferred.evaluatorResult.execution.attempted,false);
const invalid=runZero({proposalId:"PROP-INVALID",commandId:"advisor.propose_interaction",parameters:{personId:"R01",interactionTargetId:"OBJ-NOT-IN-SNAPSHOT"},source:"wp-s010-010-acceptance-harness"},{value:1,urgency:1,socialAcceptability:1});
assert.strictEqual(invalid.state,"invalid");assert.strictEqual(invalid.evaluatorResult.finalValidation.reason,"target-unavailable");assert.strictEqual(invalid.evaluatorResult.execution.attempted,false);

const runtimeSnap=Runtime.snapshot(),pipelineSnap=Pipeline.snapshot(seed),ledgerSnap=Ledger.snapshot(seed);
assert(runtimeSnap.pendingCount<=Runtime.MAX_PENDING&&runtimeSnap.resultCount<=Runtime.MAX_RESULTS);
assert(pipelineSnap.activeCount<=Pipeline.MAX_ACTIVE&&pipelineSnap.resultCount<=Pipeline.MAX_RESULTS);
assert(ledgerSnap.recordCount<=Ledger.MAX_RECORDS&&ledgerSnap.serializedBytes<=Ledger.MAX_LEDGER_BYTES);
assert.strictEqual(runtimeSnap.fullWorldScan,false);assert.strictEqual(runtimeSnap.perFrameScan,false);
assert.strictEqual(pipelineSnap.fullWorldScan,false);assert.strictEqual(pipelineSnap.wholeHistoryScan,false);assert.strictEqual(pipelineSnap.perFrameScan,false);
assert.strictEqual(ledgerSnap.fullWorldScan,false);assert.strictEqual(ledgerSnap.wholeCampaignScan,false);

console.log(JSON.stringify({
  wp:"WP-S010-010",classification:"MIXED",pass:true,
  successfulChain:{
    adviceIntent:first.route.selectedIntentId,
    proposalId:first.evaluation.proposal.proposalId,
    runtimeAttemptId:stable.runtimeAttemptId,
    decision:first.evaluation.decision,decisionId:stable.decisionId,
    validation:first.evaluation.finalValidation.reason,
    simulationDelegate:first.evaluation.execution.delegate,
    interactionAttemptId:stable.interactionAttemptId,
    interactionResultId:stable.interactionResultId,
    simulationTerminal:first.interaction.simulation.authoritativeTerminalSuccess,
    conversationId:stable.conversationId,
    historyOutcome:first.stored.record.outcome.state,
    memoryLink:first.stored.record.links.characterMemoryIds[0]
  },
  zeroAction:{rejected:rejected.state,deferred:deferred.state,invalid:invalid.state,invalidReason:invalid.evaluatorResult.finalValidation.reason},
  deterministicReplay:true,persistentHistoryReload:true,
  bounds:{runtimeMaxPerTick:Runtime.MAX_PER_TICK,pipelineMaxActive:Pipeline.MAX_ACTIVE,pipelineMaxResults:Pipeline.MAX_RESULTS,conversationMaxRecords:Ledger.MAX_RECORDS,conversationMaxBytes:Ledger.MAX_LEDGER_BYTES},
  authority:{advisorDirectControl:false,directPositionMutation:false,teleportation:false,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,terminalSimulationCompletionRequired:true},
  simulationAttemptCalls:sim.attemptCalls
},null,2));
