"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");

const repoRoot=path.resolve(__dirname,"../..");
const modulePath=path.join(repoRoot,"scripts/world/protagonist-social-contact.js");
const source=fs.readFileSync(modulePath,"utf8");
const index=fs.readFileSync(path.join(repoRoot,"index.html"),"utf8");

assert(source.includes('VERSION="protagonist-social-contact-v1"'),"social-contact version marker missing");
assert(source.includes("MAX_CANDIDATES=12")&&source.includes("MAX_INTENTS_PER_PERSON=6"),"social-contact bounds missing");
assert(source.includes("directRelationshipMutation:false")&&source.includes("directMemoryMutation:false")&&source.includes("personFabrication:false"),"authority boundary markers missing");
assert(!source.includes("Math.random("),"social selection must not use Math.random");
assert(!source.includes("SocialState.recordEvent"),"selector must not mutate SocialState");
assert(!source.includes("CharacterMemory.recordInteraction"),"selector must not record memory outcomes");
const script='scripts/world/protagonist-social-contact.js?v=protagonist-social-contact-v1';
const workScript='scripts/world/protagonist-work-routine.js?v=protagonist-work-routine-v1';
assert(index.includes(script),"canonical root must load ProtagonistSocialContact");
assert(index.indexOf(script)>index.indexOf(workScript),"social contact should load after work-routine foundation");
assert(index.indexOf(script)<index.indexOf('scripts/world/conversation-transactions.js?v=conversation-transactions-v2'),"social contact should load before conversation presentation/history");

delete require.cache[require.resolve(modulePath)];
const Social=require(modulePath);
assert.equal(Social.VERSION,"protagonist-social-contact-v1");

const seed="AGENT6-WP-S010-006",when="1201-09-30 15:30:00";
const blankMemory={metBefore:false,familiarity:"stranger",meaningfulEncounterCount:0,lastMeaningfulEvent:null};
function social(values={},extra={}){return {values:{trust:.5,fear:.1,respect:.5,suspicion:.25,loyalty:.35,resentment:.1,...values},reputationAverage:0,activeDutyPriority:0,relationship:{eventIds:[]},reputations:[],...extra};}
function person(id,extra={}){return {id,personId:id,name:id,available:true,nearby:true,socialContext:social(),memoryContext:blankMemory,...extra};}

// Friendly contact.
const friendly=Social.evaluate({seed,when,candidates:[person("R-FRIEND",{topic:"market news",socialContext:social({trust:.9,respect:.82,loyalty:.72,suspicion:.08,resentment:.03,fear:.02}),memoryContext:{...blankMemory,metBefore:true,familiarity:"familiar",meaningfulEncounterCount:4}})]});
assert.equal(friendly.status,"proposal-ready");assert.equal(friendly.selectedPerson.id,"R-FRIEND");assert.equal(friendly.selectedIntent,"greeting");assert.equal(friendly.reason,"friendly-contact");
assert.equal(friendly.selectedProposal.commandId,"advisor.propose_interaction");assert.equal(friendly.selectedProposal.parameters.personId,"R-FRIEND");

// Duty-related contact.
const duty=Social.evaluate({seed,when,candidates:[person("R-DUTY",{topic:"gate safety",urgency:.85,socialContext:social({trust:.62,respect:.72},{activeDutyPriority:.96}),memoryContext:{...blankMemory,metBefore:true,meaningfulEncounterCount:2}})]});
assert.equal(duty.selectedIntent,"warn");assert.equal(duty.reason,"duty-related-contact");assert(duty.reasons.includes("active-duty"));

// Conflict / avoidance.
const conflict=Social.evaluate({seed,when,candidates:[person("R-CONFLICT",{supportedIntents:["greeting","apologize","avoid"],socialContext:social({trust:.08,respect:.18,loyalty:.05,suspicion:.95,resentment:.86,fear:.52}),memoryContext:{...blankMemory,metBefore:true,meaningfulEncounterCount:3}})]});
assert.equal(conflict.status,"avoid");assert.equal(conflict.selectedIntent,"avoid");assert.equal(conflict.reason,"conflict-avoidance");assert.equal(conflict.selectedProposal,null);

// Unresolved memory influences a check-in.
const memory=Social.evaluate({seed,when,candidates:[person("R-MEMORY",{topic:"mill promise",supportedIntents:["greeting","check-in"],socialContext:social({trust:.82,respect:.7,loyalty:.65,suspicion:.1}),memoryContext:{metBefore:true,familiarity:"familiar",meaningfulEncounterCount:5,lastMeaningfulEvent:{id:"INT-PROMISE",type:"promise",topic:"mill promise"}}})]});
assert.equal(memory.selectedIntent,"check-in");assert.equal(memory.reason,"unresolved-memory-follow-up");assert.equal(memory.references.memoryReferenceId,"INT-PROMISE");

// Unavailable/invalid supplied identities fail closed.
const unavailable=Social.evaluate({seed,when,candidates:[person("R-OFF",{available:false})]});
assert.equal(unavailable.status,"no-contact");assert.equal(unavailable.evaluated[0].reason,"person-unavailable");
const missingContext=Social.evaluate({seed,when,candidates:[{id:"R-NOCTX",available:true,nearby:true}]});
assert.equal(missingContext.status,"no-contact");assert.equal(missingContext.evaluated[0].reason,"social-context-unavailable");

// Ambiguous equal candidates use deterministic, order-independent tie-break.
const equalA=person("R-EQUAL-A",{supportedIntents:["greeting"],socialContext:social({trust:.6,respect:.6}),memoryContext:blankMemory});
const equalB=person("R-EQUAL-B",{supportedIntents:["greeting"],socialContext:social({trust:.6,respect:.6}),memoryContext:blankMemory});
const tie1=Social.evaluate({seed,when,candidates:[equalA,equalB]});
const tie2=Social.evaluate({seed,when,candidates:[equalB,equalA]});
assert.equal(tie1.selectedPerson.id,tie2.selectedPerson.id);assert.equal(tie1.socialIntentId,tie2.socialIntentId);assert.equal(tie1.selectionId,tie2.selectionId);

// Hard candidate bound.
const tooMany=Array.from({length:Social.MAX_CANDIDATES+1},(_,i)=>person("R-"+i));
assert.equal(Social.evaluate({seed,when,candidates:tooMany}).reason,"candidate-limit-exceeded");

// Live adapters perform bounded read-only per-person reads and never call mutation APIs.
let socialReads=0,memoryReads=0,socialMutations=0,memoryMutations=0;
global.SocialState={
  dialogueContext(seedValue,id){socialReads++;return id==="R-LIVE-A"?social({trust:.88,respect:.78,loyalty:.7,suspicion:.08}):social({trust:.45,respect:.5,suspicion:.25});},
  recordEvent(){socialMutations++;throw new Error("must not mutate social state");}
};
global.CharacterMemory={
  recognition(seedValue,id){memoryReads++;return id==="R-LIVE-A"?{metBefore:true,familiarity:"familiar",meaningfulEncounterCount:3,lastMeaningfulEvent:null}:blankMemory;},
  recordInteraction(){memoryMutations++;throw new Error("must not mutate memory");}
};
const live=Social.fromLive(seed,when,{candidates:[{id:"R-LIVE-A",available:true,nearby:true,topic:"hello"},{id:"R-LIVE-B",available:true,nearby:true,topic:"hello"}]});
assert.equal(live.status,"proposal-ready");assert.deepStrictEqual(live.readCounts,{candidateRows:2,socialReads:2,memoryReads:2});assert.equal(socialMutations,0);assert.equal(memoryMutations,0);

// Real command validation + evaluator boundary: person-only initiative validates, protagonist still decides, no execution occurs here.
const commandPath=path.join(repoRoot,"scripts/world/command-set-interface.js");
delete require.cache[require.resolve(commandPath)];
const CommandSet=require(commandPath);
global.CommandSetInterface=CommandSet;
global.SocialState={adviceAcceptability(){return .9;}};
const evaluatorPath=path.join(repoRoot,"scripts/world/protagonist-command-evaluator.js");
delete require.cache[require.resolve(evaluatorPath)];
const Evaluator=require(evaluatorPath);
const snapshot={interfaceVersion:CommandSet.INTERFACE_VERSION,snapshotId:"SNAP-SOCIAL",context:{seed,when,origin:{x:"0",y:"0"}},targets:{people:[{id:"R-FRIEND"}],places:[],routes:[],interactions:[]}};
const handoff=Social.handoff(friendly,snapshot,{value:.95,urgency:.75,socialAcceptability:.95},{commandSet:CommandSet,actorPosition:{x:"0",y:"0",level:0}});
assert.equal(handoff.ok,true);assert.equal(handoff.dialogue.config.speakerId,"R-FRIEND");
const input=Social.evaluatorInput(friendly,snapshot,{value:.95,urgency:.75,socialAcceptability:.95},{actorPosition:{x:"0",y:"0",level:0}});
const record=Evaluator.evaluate(input.config);
assert.equal(record.decision,"accepted");assert.equal(record.finalValidation.ok,true);assert.equal(record.finalValidation.reason,"person-interaction-proposal-valid");
assert.equal(record.execution.attempted,false);assert.equal(record.execution.actionExecuted,false);assert.equal(input.config.execute,false);

assert.equal(friendly.authority.directRelationshipMutation,false);assert.equal(friendly.authority.directMemoryMutation,false);assert.equal(friendly.authority.personFabrication,false);assert.equal(friendly.authority.fullSettlementScan,false);assert.equal(friendly.authority.wholeMemoryScan,false);assert.equal(friendly.authority.perFrameScan,false);

console.log(JSON.stringify({
  wp:"WP-S010-006",classification:"FUNCTIONAL",visual:"N/A — bounded social initiative selection and read-only handoff add no rendered surface",pass:true,version:Social.VERSION,
  evidence:{friendly:friendly.reason,duty:duty.reason,conflict:conflict.reason,memory:memory.reason,unavailable:unavailable.evaluated[0].reason,tieWinner:tie1.selectedPerson.id},
  deterministicTieBreak:true,liveReads:live.readCounts,relationshipMutation:false,memoryMutation:false,
  commandValidation:handoff.commandValidation.reason,evaluatorDecision:record.decision,evaluatorValidation:record.finalValidation.reason,actionExecuted:false,
  bounds:friendly.bounds,fullSettlementScan:false,wholeMemoryScan:false,fullWorldScan:false,perFrameScan:false
},null,2));
