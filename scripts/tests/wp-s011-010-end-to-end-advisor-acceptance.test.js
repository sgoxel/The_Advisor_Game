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
    structuralRef(seed,kind,parent,key,initial){return{id:"STR|"+String(kind).toUpperCase()+"|"+hash([seed,kind,parent,key].join("|")),kind,key:{initial:clone(initial||{})}};},
    resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return{current:merge(ref.key.initial,entry?.changes||{}),delta:entry?clone(entry):null};},
    applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return{ok:true,reason:"ok",entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)};},
    serializeState(seed){return clone(ensure(seed));},
    restoreSerializedState(campaign,value){stores.set(String(campaign.seed),clone(value));return{ok:true};},
    clear(seed){stores.set(seed,{schema:"CampaignStateDelta",seed,sequence:0,entries:{}});}
  };
}
function makeStorage(){
  const m=new Map();
  return {
    get length(){return m.size;},
    key(i){return Array.from(m.keys())[i]??null;},
    getItem(k){return m.has(String(k))?m.get(String(k)):null;},
    setItem(k,v){m.set(String(k),String(v));},
    removeItem(k){m.delete(String(k));},
    clear(){m.clear();}
  };
}

const seed="AGENT6-WP-S011-010";
const when="1201-10-01 10:00:00";
global.WorldState=makeWorld();
global.localStorage=makeStorage();
global.GameTime={getTimestampKey(){return when;}};
global.SeedSystem={getCampaign(){return{seed,protagonistId:"protagonist"};},getSettings(){return{seed};}};

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
    assert.equal(seedValue,seed);assert.equal(request.actorKind,"protagonist");assert.equal(request.objectId,"OBJ-ACCEPT");assert.equal(request.action,"inspect");
    return Object.freeze({ok:true,status:"completed",reason:"inspected",id:"SIM-WP-S011-010-RESULT",objectId:"OBJ-ACCEPT",action:"inspect",authoritative:true});
  }
});

const Progression=require("../world/advisor-progression.js");
const Insight=require("../world/advisor-insight.js");
const Resolution=require("../world/advisor-tool-resolution.js");
const Command=require("../world/advisor-command.js");
const AdvisorChannel=require("../world/advisor-channel.js");
require("../world/character-memory.js");
const Memory=global.CharacterMemory;
const Router=require("../world/local-conversation-router.js");
const CommandSet=require("../world/command-set-interface.js");
const Pipeline=require("../world/protagonist-interaction-pipeline.js");
const Evaluator=require("../world/protagonist-command-evaluator.js");
const Runtime=require("../world/protagonist-action-runtime.js");
require("../world/conversation-transactions.js");
const Ledger=global.ConversationTransactions;

function reset(){
  WorldState.clear(seed);localStorage.clear();Runtime.reset();Pipeline.clear(seed);Ledger.clear(seed);
}
function commandSnapshot(){
  return CommandSet.buildSnapshot({seed,when,origin:{x:"0",y:"0"}},{
    getResidentRoster(){return Object.freeze([Object.freeze({id:"R01",name:"Rowan"})]);},
    getDailyActivities(){return Object.freeze([Object.freeze({residentId:"R01",target:{x:"0",y:"0"},state:"working",action:"inspect",intendedAction:"inspect",label:"Inspecting workshop bench",buildingId:"BLDG-A",interactionObjectId:"OBJ-ACCEPT",interactionObjectType:"workbench",targetSource:"interior-interaction"})]);},
    queryDestinations(){return Object.freeze({results:Object.freeze([]),diagnostics:Object.freeze({bounded:true,fullWorldScan:false})});},
    getCountry(){return null;},getRoadGraph(){return null;},getKnownLeads(){return Object.freeze([]);}
  });
}
function investigate(seedValue=seed,time=when){
  return Insight.analyze(seedValue,{
    subject:{id:"BLDG-A",type:"place"},fantasyTimestamp:time,
    evidence:[
      {refId:"SIM:OBJ-ACCEPT",subjectId:"BLDG-A",sourceType:"simulation",reliability:"verified",claimKey:"workbench-actionable",stance:"support",fantasyTimestamp:time},
      {refId:"OBS:OBJ-ACCEPT",subjectId:"BLDG-A",sourceType:"direct-observation",reliability:"verified",claimKey:"workbench-actionable",stance:"support",fantasyTimestamp:time}
    ]
  });
}
function resolveInsight(seedValue,insight,time=when){
  return Resolution.autoResolve(seedValue,{requestId:"REQ-WP-S011-010-INSIGHT",toolId:"advisor.insight",fantasyTimestamp:time,context:{refId:insight.result.id,sourceSystem:"AdvisorInsight",validated:true},accessibility:{inputModality:"keyboard"}});
}
function awardInsight(seedValue,resolution,time=when){
  return Progression.award(seedValue,"insight",{campaignSeed:seedValue,kind:"advisor-tool-result",authority:"AdvisorToolResolution",validated:true,rewardBand:"success",fantasyTimestamp:time,toolId:"advisor.insight",outcomeId:resolution.result.id,sourceSystem:"AdvisorToolResolution"});
}
function adviceRoute(){
  return Router.route("Speak with Rowan and inspect the workshop bench.",{seed,when,character:{id:"protagonist",name:"Protagonist"},externalAiEnabled:false},{matchSentence(){return null;},getMemory(){return Object.freeze([]);},getAdvice(){return Object.freeze([]);},getSocialContext(){return null;}});
}
function proposalFromAdvice(route,snapshot,insightId){
  assert.equal(route.selectedIntentId,"advisor.interaction.request");
  const person=snapshot.targets.people.find(row=>row.id==="R01"),interaction=snapshot.targets.interactions.find(row=>row.id==="OBJ-ACCEPT");
  assert(person&&interaction&&interaction.personIds.includes(person.id));
  return Object.freeze({proposalId:"PROP-WP-S011-010",commandId:"advisor.propose_interaction",parameters:Object.freeze({personId:person.id,interactionTargetId:interaction.id,topic:"Inspect the workshop bench"}),source:"advisor-insight:"+insightId});
}
function runSuccess(){
  reset();
  const insight=investigate();assert(insight.ok);assert.equal(insight.result.status,"supported");assert.equal(insight.result.worldTruth,false);
  const resolution=resolveInsight(seed,insight);assert(resolution.ok);assert.equal(resolution.result.downstream.protagonistChoiceRequired,true);assert.equal(resolution.result.downstream.simulationValidationRequired,true);assert.equal(resolution.result.authority.executesAction,false);
  const progression=awardInsight(seed,resolution);assert(progression.ok);assert.equal(progression.event.outcomeId,resolution.result.id);assert.equal(progression.track.totalXp,40);
  const forged=Progression.award(seed,"insight",{campaignSeed:seed,kind:"advisor-tool-result",authority:"UI",validated:true,rewardBand:"milestone",fantasyTimestamp:when,toolId:"advisor.insight",outcomeId:"UI-FORGED",sourceSystem:"AdvisorToolbeltUI"});assert.equal(forged.ok,false);

  const advice=AdvisorChannel.recordAdvice(seed,{topic:"Insight "+insight.result.id+": inspect the workshop bench with Rowan.",target:{type:"interaction",id:"OBJ-ACCEPT",label:"Workshop bench"},timestamp:when,details:"Grounded evidence "+insight.result.evidenceRefIds.join(", ")},"protagonist");
  assert(advice&&advice.id);
  const memory=Memory.recordAdviceReference(seed,{kind:"protagonist",id:"protagonist"},advice.id,{timestamp:when,summary:"Grounded Advisor finding "+insight.result.id+" supports inspecting the workshop bench."});
  assert(memory&&memory.id);assert.equal(memory.externalRef.id,advice.id);

  const snapshot=commandSnapshot(),route=adviceRoute(),proposal=proposalFromAdvice(route,snapshot,insight.result.id);
  assert.equal(snapshot.diagnostics.fullWorldScan,false);assert.equal(route.worldMutation,false);assert.equal(route.actionExecuted,false);
  const scheduled=Runtime.schedule({seed,when,snapshot,proposal,actorId:"protagonist",actorPosition:{x:"0",y:"0",level:0},decisionContext:{value:.98,urgency:.92,socialAcceptability:.95}});
  assert.equal(scheduled.ok,true);
  const tick=Runtime.tick({seed,when,maxAttempts:1}),row=tick.processed[0],evaluation=row.evaluatorResult;
  assert.equal(row.state,"succeeded");assert.equal(evaluation.decision,"accepted");assert.equal(evaluation.finalValidation.ok,true);assert.equal(evaluation.execution.actionExecuted,true);assert.equal(evaluation.execution.state,"completed");assert.equal(evaluation.execution.authoritativeResult.terminal,true);
  const interaction=Pipeline.get(seed,evaluation.execution.authoritativeResult.attemptId);assert(interaction);assert.equal(interaction.status,"terminal-success");assert.equal(interaction.simulation.authoritativeTerminalSuccess,true);
  const stored=Ledger.fromEvaluation(seed,{messageId:"MSG-WP-S011-010",referenceId:insight.result.id,role:"player",text:"Speak with Rowan and inspect the workshop bench."},route,evaluation,{advisorChannelIds:[advice.id],characterMemoryIds:[memory.id],replyText:"I inspected the workshop bench. Simulation confirmed the result."});
  assert(stored.ok);assert.equal(stored.record.outcome.state,"completed");assert.equal(stored.record.outcome.authoritativeExecution,true);assert.equal(stored.record.message.referenceId,insight.result.id);assert(stored.record.links.advisorChannelIds.includes(advice.id));assert(stored.record.links.characterMemoryIds.includes(memory.id));
  return{insight,resolution,progression,advice,memory,snapshot,route,proposal,row,evaluation,interaction,stored};
}

const first=runSuccess();
const before={insight:Insight.snapshot(seed),resolution:Resolution.snapshot(seed),progression:Progression.snapshot(seed),conversation:Ledger.snapshot(seed)};
const saved=WorldState.serializeState(seed);
WorldState.clear(seed);
assert.equal(Insight.snapshot(seed).resultCount,0);assert.equal(Resolution.snapshot(seed).resolutionCount,0);assert.equal(Progression.snapshot(seed).eventCount,0);assert.equal(Ledger.snapshot(seed).recordCount,0);
WorldState.restoreSerializedState({seed},saved);
assert.deepStrictEqual(Insight.snapshot(seed),before.insight);assert.deepStrictEqual(Resolution.snapshot(seed),before.resolution);assert.deepStrictEqual(Progression.snapshot(seed),before.progression);assert.deepStrictEqual(Ledger.snapshot(seed),before.conversation);
assert(Memory.list(seed,{kind:"protagonist",id:"protagonist"}).some(x=>x.id===first.memory.id));

const stable={insightId:first.insight.result.id,resolutionId:first.resolution.result.id,progressionEventId:first.progression.event.id,adviceId:first.advice.id,memoryId:first.memory.id,runtimeAttemptId:first.row.attemptId,decisionId:first.evaluation.decisionId,executionId:first.evaluation.executionId,interactionAttemptId:first.interaction.attemptId,conversationId:first.stored.record.id};
const second=runSuccess();
assert.deepStrictEqual({insightId:second.insight.result.id,resolutionId:second.resolution.result.id,progressionEventId:second.progression.event.id,adviceId:second.advice.id,memoryId:second.memory.id,runtimeAttemptId:second.row.attemptId,decisionId:second.evaluation.decisionId,executionId:second.evaluation.executionId,interactionAttemptId:second.interaction.attemptId,conversationId:second.stored.record.id},stable);

const weakSeed="WP-S011-010-WEAK",beforeWeakAttempts=sim.attemptCalls;
const weak=Insight.analyze(weakSeed,{subject:{id:"BLDG-A",type:"place"},fantasyTimestamp:"1201-10-01 10:01:00",evidence:[{refId:"RUMOR:OBJ-ACCEPT",subjectId:"BLDG-A",sourceType:"rumor",reliability:"uncertain",claimKey:"workbench-actionable",stance:"support",fantasyTimestamp:"1201-10-01 10:01:00"}]});
assert(weak.ok);assert.equal(weak.result.status,"uncertain");assert.equal(weak.result.worldTruth,false);assert.equal(sim.attemptCalls,beforeWeakAttempts,"uncertain evidence must not execute an action");

const snapshot=commandSnapshot(),route=adviceRoute(),validProposal=proposalFromAdvice(route,snapshot,first.insight.result.id);
function runZero(proposal,decisionContext){
  const runtime=Runtime.createRuntime({evaluator:Evaluator}),beforeAttempts=sim.attemptCalls;
  const scheduled=runtime.schedule({seed,when,snapshot,proposal,actorId:"protagonist",actorPosition:{x:"0",y:"0",level:0},decisionContext});assert(scheduled.ok);
  const tick=runtime.tick({seed,when,maxAttempts:1});assert.equal(tick.processedCount,1);assert.equal(sim.attemptCalls,beforeAttempts,"zero-action path reached Simulation");
  return tick.processed[0];
}
const rejected=runZero({...validProposal,proposalId:"PROP-REJECT"},{value:.02,urgency:.02,socialAcceptability:.02});assert.equal(rejected.state,"rejected");
const deferred=runZero({...validProposal,proposalId:"PROP-DEFER"},{value:.50,urgency:.50,socialAcceptability:.50});assert.equal(deferred.state,"deferred");
const invalid=runZero({proposalId:"PROP-INVALID",commandId:"advisor.propose_interaction",parameters:{personId:"R01",interactionTargetId:"OBJ-NOT-IN-SNAPSHOT"},source:"advisor-insight:"+first.insight.result.id},{value:1,urgency:1,socialAcceptability:1});assert.equal(invalid.state,"invalid");assert.equal(invalid.evaluatorResult.finalValidation.reason,"target-unavailable");

const authTime="1201-10-01 10:02:00",operation={id:"OP-GATE",refId:"OPREF:GATE",objectiveId:"OBJ:GATE",targetRefId:"PLACE:GATE",requiredAuthorityScope:"settlement:administration",validated:true,requirements:{routeRequired:true,minCapability:.7,minSupplyCoverage:.65,minEquipmentCoverage:.6,minCondition:.7,minAvailableActors:6}};
const unauthorized=Command.analyze("WP-S011-010-NOAUTH",{fantasyTimestamp:authTime,operation,sources:[
  {sourceSystem:"ProtagonistAuthority",refId:"AUTH:P",fantasyTimestamp:authTime,validated:true,values:{scopes:["self"],rankTier:1}},
  {sourceSystem:"ProtagonistHealth",refId:"HEALTH:P",fantasyTimestamp:authTime,validated:true,values:{conditionMilli:90000,fatigueMilli:10000,activeInjuryCount:0}},
  {sourceSystem:"ProtagonistInventory",refId:"INV:P",fantasyTimestamp:authTime,validated:true,values:{equipmentCoverage:.9,supplyCoverage:.9,missingRequirementCount:0}},
  {sourceSystem:"RoutePlanner",refId:"ROUTE:GATE",fantasyTimestamp:authTime,validated:true,values:{routeFound:true,routeRisk:.1,routeSeconds:300,stepCount:12,maxSlopeAngleDegrees:5}},
  {sourceSystem:"WorldState",refId:"CAP:GATE",fantasyTimestamp:authTime,validated:true,values:{capability:.9,cohesion:.9,availableActors:10,groupSize:10,threat:.1}}
]});
assert(unauthorized.ok);assert.equal(unauthorized.result.status,"blocked");assert(unauthorized.result.assessment.blockers.some(x=>x.id==="authority-scope-missing"));
const noAuthResolution=Resolution.autoResolve("WP-S011-010-NOAUTH",{requestId:"REQ-NOAUTH",toolId:"advisor.command",fantasyTimestamp:authTime,context:{refId:unauthorized.result.id,sourceSystem:"AdvisorCommand",validated:true},accessibility:{inputModality:"keyboard"}});
assert(noAuthResolution.ok);assert.equal(noAuthResolution.result.authority.grantsAuthority,false);assert.equal(noAuthResolution.result.authority.executesAction,false);

const bounds={insight:Insight.snapshot(seed),resolution:Resolution.snapshot(seed),progression:Progression.snapshot(seed),runtime:Runtime.snapshot(),pipeline:Pipeline.snapshot(seed),conversation:Ledger.snapshot(seed)};
assert(bounds.insight.resultCount<=Insight.MAX_RESULTS);assert(bounds.resolution.resolutionCount<=Resolution.MAX_RESOLUTIONS);assert(bounds.progression.eventCount<=Progression.MAX_EVENTS);assert(bounds.conversation.recordCount<=Ledger.MAX_RECORDS);
assert.equal(bounds.insight.fullWorldScan,false);assert.equal(bounds.resolution.fullWorldScan,false);assert.equal(bounds.progression.fullWorldScan,false);assert.equal(bounds.runtime.fullWorldScan,false);assert.equal(bounds.pipeline.fullWorldScan,false);assert.equal(bounds.conversation.fullWorldScan,false);

console.log(JSON.stringify({
  wp:"WP-S011-010",classification:"MIXED",pass:true,
  successfulChain:{insightId:stable.insightId,evidenceRefs:first.insight.result.evidenceRefIds,resolutionId:stable.resolutionId,progressionEventId:stable.progressionEventId,adviceId:stable.adviceId,memoryId:stable.memoryId,proposalId:first.evaluation.proposal.proposalId,runtimeAttemptId:stable.runtimeAttemptId,decision:first.evaluation.decision,decisionId:stable.decisionId,executionId:stable.executionId,interactionAttemptId:stable.interactionAttemptId,conversationId:stable.conversationId,historyOutcome:first.stored.record.outcome.state},
  zeroAction:{uncertain:weak.result.status,rejected:rejected.state,deferred:deferred.state,invalid:invalid.state,invalidReason:invalid.evaluatorResult.finalValidation.reason,noAuthority:unauthorized.result.status,noAuthorityBlocker:"authority-scope-missing"},
  progression:{xp:first.progression.track.totalXp,eventOutcomeId:first.progression.event.outcomeId,forgedUiEvidenceRejected:true},
  deterministicReplay:true,persistentWorldStateReload:true,persistentMemoryReference:true,
  bounds:{maxInsightResults:Insight.MAX_RESULTS,maxResolutions:Resolution.MAX_RESOLUTIONS,maxProgressionEvents:Progression.MAX_EVENTS,maxRuntimePerTick:Runtime.MAX_PER_TICK,maxConversationRecords:Ledger.MAX_RECORDS},
  authority:{investigationWorldTruth:false,toolExecutesAction:false,toolGrantsAuthority:false,protagonistChoiceRequired:true,simulationValidationRequired:true,terminalSimulationCompletionRequired:true,fullWorldScan:false,perFrameScan:false}
},null,2));
