'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-social-contact.js');
const source=fs.readFileSync(modulePath,'utf8');
const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');

assert(source.includes('VERSION="protagonist-social-contact-v1"'),'social-contact version marker missing');
assert(source.includes('MAX_CANDIDATES=8')&&source.includes('MAX_MEMORY_ROWS_PER_PERSON=6')&&source.includes('MAX_MEMORY_ROWS_TOTAL=48'),'social-contact bounds missing');
assert(source.includes('directRelationshipMutation:false')&&source.includes('directMemoryMutation:false')&&source.includes('simulationValidationBypass:false'),'social authority boundary markers missing');
assert(!source.includes('Math.random('),'social selection must not use Math.random');
assert(!source.includes('.recordEvent('),'social selector must not mutate SocialState');
assert(!source.includes('.recordMemory(')&&!source.includes('.recordInteraction('),'social selector must not mutate CharacterMemory');
const script='scripts/world/protagonist-social-contact.js?v=protagonist-social-contact-v1';
const workScript='scripts/world/protagonist-work-routine.js?v=protagonist-work-routine-v1';
assert(index.includes(script),'canonical root must load ProtagonistSocialContact');
assert(index.indexOf(script)>index.indexOf(workScript),'social contact should load after work-routine foundation');
assert(index.indexOf(script)<index.indexOf('scripts/world/conversation-transactions.js?v=conversation-transactions-v2'),'social contact should load before conversation presentation/history');

delete require.cache[require.resolve(modulePath)];
const Social=require(modulePath);
assert.equal(Social.VERSION,'protagonist-social-contact-v1');
assert.deepStrictEqual([...Social.SUPPORTED_INTENTS],['greet','check-in','ask','warn','apologize','avoid']);

const seed='AGENT6-WP-S010-006',when='1201-09-30 14:15:00';
const social=(values,extra={})=>({
  values,
  reputationAverage:Number(extra.reputationAverage||0),
  activeDutyPriority:Number(extra.activeDutyPriority||0),
  relationship:{eventIds:extra.relationshipEventIds||[]},
  reputations:(extra.reputationEventIds||[]).map(id=>({eventIds:[id]})),
  source:'test-social-ledger'
});
const recognition=(extra={})=>({
  metBefore:extra.metBefore===true,
  meaningfulEncounterCount:Number(extra.count||0),
  familiarity:extra.familiarity||'stranger',
  lastTopic:extra.lastTopic||null,
  bounded:true,
  globalScan:false
});
const neutral=social({trust:.5,fear:.1,respect:.5,suspicion:.25,loyalty:.35,resentment:.1});

// Friendly known contact chooses greeting and preserves social reference IDs.
const friendly={
  personId:'R-FRIEND',name:'Mara',available:true,known:true,priority:50,
  social:social({trust:.9,fear:.05,respect:.85,suspicion:.05,loyalty:.8,resentment:.03},{relationshipEventIds:['SOC-FRIEND'],reputationEventIds:['SOC-REP']}),
  recognition:recognition({metBefore:true,count:2,lastTopic:'market'}),memoryRows:[]
};
const friendlyResult=Social.evaluate({seed,when,candidates:[friendly]});
assert.equal(friendlyResult.status,'proposal-ready');
assert.equal(friendlyResult.selectedIntent.type,'greet');
assert.equal(friendlyResult.selectedPerson.id,'R-FRIEND');
assert.equal(friendlyResult.selectedProposal.commandId,'advisor.propose_interaction');
assert.equal(friendlyResult.selectedProposal.parameters.personId,'R-FRIEND');
assert.deepStrictEqual(friendlyResult.selectedIntent.references.relationshipEventIds,['SOC-FRIEND']);
assert.deepStrictEqual(friendlyResult.selectedIntent.references.reputationEventIds,['SOC-REP']);

// Duty-aware contact uses supplied/current duty context without granting duty authority.
const duty={
  personId:'R-GUARD',name:'Gate Guard',available:true,nearby:true,priority:50,
  intentHints:['ask'],topic:'north gate duty',
  social:social({trust:.55,fear:.08,respect:.7,suspicion:.18,loyalty:.45,resentment:.08},{activeDutyPriority:.9}),
  recognition:recognition({metBefore:true,count:1}),memoryRows:[]
};
const dutyResult=Social.evaluate({seed,when,candidates:[duty]});
assert.equal(dutyResult.selectedIntent.type,'ask');
assert.equal(dutyResult.reason,'duty-related-contact');
assert(dutyResult.reasons.includes('duty-context-present'));

// Relationship conflict/fear can produce non-executing avoidance.
const conflict={
  personId:'R-CONFLICT',name:'Rival',available:true,known:true,priority:50,
  social:social({trust:.1,fear:.8,respect:.15,suspicion:.82,loyalty:.1,resentment:.85}),
  recognition:recognition({metBefore:true,count:5}),memoryRows:[]
};
const conflictResult=Social.evaluate({seed,when,candidates:[conflict]});
assert.equal(conflictResult.status,'avoid');
assert.equal(conflictResult.selectedIntent.type,'avoid');
assert.equal(conflictResult.reason,'relationship-conflict-avoidance');
assert.equal(conflictResult.selectedProposal,null);

// An unresolved resident-local memory can raise a check-in without becoming outcome authority.
const memory={
  personId:'R-MEM',name:'Tomas',available:true,known:true,priority:50,
  social:neutral,recognition:recognition({metBefore:true,count:3,lastTopic:'mill gate'}),
  memoryRows:[{id:'MEM-UNRES',kind:'memory',category:'promise',summary:'Unresolved promise about the mill gate',relevance:.95,confidence:.9,resolved:false}]
};
const memoryResult=Social.evaluate({seed,when,candidates:[memory]});
assert.equal(memoryResult.selectedIntent.type,'check-in');
assert.equal(memoryResult.reason,'unresolved-memory-check-in');
assert.equal(memoryResult.selectedIntent.references.memoryReferenceId,'MEM-UNRES');
assert(memoryResult.reasons.includes('bounded-memory-influence'));

// Warning and apology are supported bounded intents from supplied context only.
const warningResult=Social.evaluate({seed,when,candidates:[{...duty,personId:'R-WARN',intentHints:['warn'],warningRelevant:true,topic:'unsafe bridge'}]});
assert.equal(warningResult.selectedIntent.type,'warn');
const apologyResult=Social.evaluate({seed,when,candidates:[{...memory,personId:'R-APOLOGY',intentHints:['apologize'],apologyRelevant:true,topic:'broken promise'}]});
assert.equal(apologyResult.selectedIntent.type,'apologize');

// Invalid/unavailable people fail closed and cannot be invented from a label.
const unavailable=Social.evaluate({seed,when,candidates:[{...friendly,personId:'R-OFF',available:false}]});
assert.equal(unavailable.status,'no-contact');
assert.equal(unavailable.evaluated[0].reason,'person-unavailable');
const ungrounded=Social.evaluate({seed,when,candidates:[{personId:'R-UNKNOWN',name:'Unknown',available:true,known:false,nearby:false,social:neutral,recognition:recognition(),memoryRows:[]}]});
assert.equal(ungrounded.status,'no-contact');
assert.equal(ungrounded.evaluated[0].reason,'person-not-known-or-nearby');
assert.equal(Social.evaluate({seed,when,candidates:[friendly,{...friendly}]}).reason,'duplicate-person-candidate');

// Equal candidates are deterministic and independent of supplied order.
const equalA={personId:'R-A',available:true,known:true,priority:50,social:neutral,recognition:recognition(),memoryRows:[]};
const equalB={personId:'R-B',available:true,known:true,priority:50,social:neutral,recognition:recognition(),memoryRows:[]};
const replayA=Social.evaluate({seed,when,candidates:[equalA,equalB]});
const replayB=Social.evaluate({seed,when,candidates:[equalB,equalA]});
assert.equal(replayA.selectionId,replayB.selectionId);
assert.equal(replayA.selectedPerson.id,replayB.selectedPerson.id);
assert.equal(replayA.selectedIntent.id,replayB.selectedIntent.id);
assert.equal(replayA.selectedProposal.proposalId,replayB.selectedProposal.proposalId);
const later=Social.evaluate({seed,when:'1201-09-30 14:16:00',candidates:[equalA,equalB]});
assert.notEqual(replayA.selectedIntent.id,later.selectedIntent.id,'Fantasy Game Time must participate in stable intent identity');

// Hard candidate budget fails closed.
const tooMany=Array.from({length:Social.MAX_CANDIDATES+1},(_,i)=>({...equalA,personId:'R-'+i}));
assert.equal(Social.evaluate({seed,when,candidates:tooMany}).reason,'candidate-limit-exceeded');

// Live adapter reads each existing social/memory API once per supplied person and never calls mutation APIs.
let socialReads=0,recognitionReads=0,memoryReads=0,mutations=0;
global.SocialState={
  dialogueContext(s,id){socialReads++;assert.equal(s,seed);assert.equal(id,'R-LIVE');return social({trust:.8,fear:.05,respect:.8,suspicion:.08,loyalty:.7,resentment:.04},{relationshipEventIds:['SOC-LIVE'],reputationEventIds:['SOC-LIVE-REP']});},
  recordEvent(){mutations++;throw Error('SocialState mutation not allowed');}
};
global.CharacterMemory={
  recognition(s,id){recognitionReads++;assert.equal(s,seed);assert.equal(id,'R-LIVE');return recognition({metBefore:true,count:4,lastTopic:'harvest'});},
  list(s,actor){memoryReads++;assert.equal(s,seed);assert.deepStrictEqual(actor,{kind:'resident',id:'R-LIVE'});return [{id:'M1',category:'interaction',summary:'Prior harvest conversation',relevance:.4,confidence:.9,resolved:true}];},
  recordMemory(){mutations++;throw Error('CharacterMemory mutation not allowed');},
  recordInteraction(){mutations++;throw Error('CharacterMemory interaction mutation not allowed');}
};
const live=Social.fromLive(seed,when,{candidates:[{personId:'R-LIVE',available:true,known:true,priority:60}]});
assert.equal(live.status,'proposal-ready');
assert.deepStrictEqual([socialReads,recognitionReads,memoryReads,mutations],[1,1,1,0]);
assert.deepStrictEqual(live.selectedIntent.references.relationshipEventIds,['SOC-LIVE']);
assert.deepStrictEqual(live.selectedIntent.references.reputationEventIds,['SOC-LIVE-REP']);
assert.deepStrictEqual(live.reads,{socialReads:1,recognitionReads:1,memoryReads:1,memoryRows:1});

// Real command-set validation accepts only the supplied person target.
const commandPath=path.join(repoRoot,'scripts/world/command-set-interface.js');
delete require.cache[require.resolve(commandPath)];
const CommandSet=require(commandPath);
global.CommandSetInterface=CommandSet;
const pos={x:'0',y:'0',level:0};
const snapshot={
  interfaceVersion:CommandSet.INTERFACE_VERSION,
  snapshotId:'SNAP-SOCIAL',
  context:{seed,when,origin:pos},
  targets:{people:[{id:'R-LIVE'}],places:[],routes:[],interactions:[]}
};
const validated=CommandSet.validateProposal(snapshot,live.selectedProposal);
assert.equal(validated.ok,true);
assert.equal(validated.validatedParameters.personId,'R-LIVE');
assert.equal(CommandSet.validateProposal(snapshot,{...live.selectedProposal,parameters:{...live.selectedProposal.parameters,personId:'R-INVENTED'}}).reason,'target-unavailable');

// Real protagonist evaluator keeps pure person contact at the existing non-mutating dialogue/interaction boundary.
const evaluatorPath=path.join(repoRoot,'scripts/world/protagonist-command-evaluator.js');
delete require.cache[require.resolve(evaluatorPath)];
const Evaluator=require(evaluatorPath);
const evaluated=Evaluator.evaluate({seed,when,snapshot,actorPosition:pos,proposal:live.selectedProposal,decisionContext:{value:.95,urgency:.8,socialAcceptability:.9}});
assert.equal(evaluated.decision,'accepted');
assert.equal(evaluated.finalValidation.ok,true);
assert.equal(evaluated.finalValidation.reason,'person-interaction-proposal-valid');
assert.equal(evaluated.execution.attempted,false);
assert.equal(evaluated.execution.state,'proposal-ready');
assert.equal(evaluated.execution.reason,'person-interaction-requires-later-concrete-target');
assert.equal(evaluated.execution.actionExecuted,false);

// Person-only contact stops at the existing dialogue/interaction boundary; it must not enter a non-terminal action-runtime loop.
let runtimeCalls=0;
const blockedRuntime=Social.runtimeInput(live,snapshot,{value:.95,urgency:.8,socialAcceptability:.9},{actorPosition:pos});
assert.equal(blockedRuntime.ok,false);
assert.equal(blockedRuntime.reason,'person-contact-requires-dialogue-interaction-boundary');
assert.equal(blockedRuntime.evaluatorHandoff.config.proposal.parameters.personId,'R-LIVE');
const scheduled=Social.schedule(live,snapshot,{value:.95,urgency:.8,socialAcceptability:.9},{runtime:{schedule(){runtimeCalls++;return {ok:true};}},actorPosition:pos});
assert.equal(scheduled.ok,true);
assert.equal(scheduled.reason,'dialogue-interaction-boundary-ready');
assert.equal(scheduled.boundary,'ProtagonistCommandEvaluator -> dialogue/interaction boundary');
assert.equal(scheduled.handoff.config.proposal.commandId,'advisor.propose_interaction');
assert.equal(scheduled.handoff.config.proposal.parameters.personId,'R-LIVE');
assert.equal(runtimeCalls,0);
assert.equal(scheduled.directActionExecution,false);
assert.equal(scheduled.directRelationshipMutation,false);
assert.equal(scheduled.directMemoryMutation,false);

assert.equal(live.authority.relationshipAuthority,false);
assert.equal(live.authority.reputationAuthority,false);
assert.equal(live.authority.memoryAuthority,false);
assert.equal(live.authority.dialogueAuthority,false);
assert.equal(live.authority.directRelationshipMutation,false);
assert.equal(live.authority.directMemoryMutation,false);
assert.equal(live.authority.directWorldMutation,false);
assert.equal(live.authority.targetFabrication,false);
assert.equal(live.authority.fullSettlementScan,false);
assert.equal(live.authority.wholeMemoryScan,false);
assert.equal(live.authority.perFrameScan,false);

console.log(JSON.stringify({
  wp:'WP-S010-006',classification:'FUNCTIONAL',visual:'N/A — bounded social-contact selection and person-proposal handoff add no rendered surface',pass:true,version:Social.VERSION,
  evidence:{friendly:friendlyResult.reason,duty:dutyResult.reason,conflict:conflictResult.reason,unresolvedMemory:memoryResult.reason,warning:warningResult.selectedIntent.type,apology:apologyResult.selectedIntent.type,unavailable:unavailable.evaluated[0].reason,ungrounded:ungrounded.evaluated[0].reason,deterministicTie:replayA.selectedPerson.id},
  stableIntentId:live.selectedIntent.id,references:live.selectedIntent.references,liveReads:live.reads,
  commandValidation:validated.reason,evaluatorBoundary:evaluated.execution.reason,
  bounds:live.bounds,directRelationshipMutation:false,directMemoryMutation:false,directWorldMutation:false,simulationValidationBypass:false,fullSettlementScan:false,wholeMemoryScan:false,perFrameScan:false
},null,2));
