"use strict";
const assert=require("assert");

const snapshot=Object.freeze({
  interfaceVersion:"advisor-command-set-v1",snapshotId:"CMDCTX-TEST",
  context:Object.freeze({seed:"AGENT6-WP-S008-005",when:"1201-09-30 11:26:00",origin:Object.freeze({x:"0",y:"0"})}),
  targets:Object.freeze({
    people:Object.freeze([Object.freeze({id:"R1",kind:"person",position:{x:"4",y:"0"}})]),
    places:Object.freeze([
      Object.freeze({id:"P1",kind:"place",position:{x:"10",y:"0"}}),
      Object.freeze({id:"P2",kind:"place",position:{x:"6",y:"2"}})
    ]),
    routes:Object.freeze([]),
    interactions:Object.freeze([Object.freeze({id:"OBJ1",kind:"interaction",personIds:Object.freeze(["R1"]),action:"work",position:{x:"0",y:"0"}})])
  })
});

globalThis.CommandSetInterface=Object.freeze({
  validateProposal(s,p){
    if(!s||s.snapshotId!==snapshot.snapshotId)return Object.freeze({ok:false,reason:"invalid-snapshot"});
    const id=String(p?.commandId||""),params=p?.parameters||{};
    const accepted=["advisor.query_information","advisor.query_schedule","advisor.propose_advice","advisor.propose_travel","advisor.propose_interaction"];
    if(!accepted.includes(id))return Object.freeze({ok:false,reason:"unknown-command",commandId:id,details:null});
    if(id==="advisor.propose_travel"&&!s.targets.places.some(x=>x.id===params.destinationId))return Object.freeze({ok:false,reason:"target-unavailable",commandId:id,details:{parameter:"destinationId",targetId:params.destinationId}});
    if(id==="advisor.propose_interaction"){
      if(!s.targets.people.some(x=>x.id===params.personId))return Object.freeze({ok:false,reason:"target-unavailable",commandId:id,details:{parameter:"personId"}});
      if(params.interactionTargetId){
        const t=s.targets.interactions.find(x=>x.id===params.interactionTargetId);
        if(!t)return Object.freeze({ok:false,reason:"target-unavailable",commandId:id,details:{parameter:"interactionTargetId"}});
        if(!t.personIds.includes(params.personId))return Object.freeze({ok:false,reason:"interaction-target-not-associated-with-person",commandId:id});
      }
    }
    return Object.freeze({ok:true,status:"validated",reason:"proposal-valid",commandId:id,snapshotId:s.snapshotId,proposalId:p.proposalId||null,source:p.source||null,validatedParameters:Object.freeze({...params}),worldMutation:false,executionAttempted:false});
  }
});

let routeCalls=0,interactionAttempts=0;
globalThis.RoutePlanner=Object.freeze({
  findRoute(seed,from,to,opts){
    routeCalls++;
    assert.strictEqual(seed,"AGENT6-WP-S008-005");
    assert.ok(opts.maxNodes<=3000);
    const steps=Math.abs(Number(to.x)-Number(from.x))+Math.abs(Number(to.y)-Number(from.y));
    return Object.freeze({found:true,stepCount:steps,totalSeconds:steps*2,reason:"found"});
  }
});
globalThis.ObjectInteractions=Object.freeze({
  context(seed,id,actor){
    if(id!=="OBJ1")return null;
    return Object.freeze({id,actions:Object.freeze([Object.freeze({id:"work",enabled:String(actor.x)==="0"&&String(actor.y)==="0",reason:"ready",target:{x:"0",y:"0"}})])});
  },
  attempt(seed,request){
    interactionAttempts++;
    assert.strictEqual(request.actorKind,"protagonist");
    assert.strictEqual(request.objectId,"OBJ1");
    return Object.freeze({ok:true,status:"active",reason:"compatible",objectId:"OBJ1",action:"work",delegatesTo:"ActionExecutor"});
  }
});
globalThis.SocialState=Object.freeze({adviceAcceptability(){return 0.8;}});

const Evaluator=require("../world/protagonist-command-evaluator.js");
const base={seed:"AGENT6-WP-S008-005",when:"1201-09-30 11:26:00",snapshot,actorPosition:{x:"0",y:"0"}};

const travel=Evaluator.evaluate({...base,proposal:{proposalId:"TRAVEL-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}},decisionContext:{value:0.95,urgency:0.9,socialAcceptability:0.8}});
assert.strictEqual(travel.decision,"accepted");
assert.strictEqual(travel.originalValidation.ok,true);
assert.strictEqual(travel.execution.state,"route-ready");
assert.strictEqual(travel.execution.delegate,"RoutePlanner");
assert.strictEqual(travel.execution.positionMutation,false);
assert.strictEqual(travel.authority.teleportation,false);
assert.strictEqual(routeCalls,1);

const beforeInvalidRoutes=routeCalls,beforeInvalidInteractions=interactionAttempts;
const invalid=Evaluator.evaluate({...base,proposal:{proposalId:"BAD-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P999"}},decisionContext:{value:1,urgency:1,socialAcceptability:1}});
assert.strictEqual(invalid.decision,"invalid");
assert.strictEqual(invalid.finalValidation.ok,false);
assert.strictEqual(invalid.finalValidation.reason,"target-unavailable");
assert.strictEqual(invalid.execution.attempted,false);
assert.strictEqual(invalid.authority.teleportation,false);
assert.strictEqual(routeCalls,beforeInvalidRoutes);
assert.strictEqual(interactionAttempts,beforeInvalidInteractions);

const rejected=Evaluator.evaluate({...base,proposal:{proposalId:"REJECT-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}},decisionContext:{value:0.05,urgency:0.05,socialAcceptability:0.05}});
assert.strictEqual(rejected.decision,"rejected");
assert.strictEqual(rejected.execution.attempted,false);
assert.strictEqual(routeCalls,beforeInvalidRoutes+1);

const deferred=Evaluator.evaluate({...base,proposal:{proposalId:"DEFER-1",commandId:"advisor.propose_advice",parameters:{topic:"Visit the smith later"}},decisionContext:{value:0.56,urgency:0.5,socialAcceptability:0.55}});
assert.strictEqual(deferred.decision,"deferred");
assert.strictEqual(deferred.execution.attempted,false);
assert.strictEqual(deferred.finalValidation.ok,true);

const modified=Evaluator.evaluate({...base,proposal:{proposalId:"MOD-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}},modifiedProposal:{proposalId:"MOD-ALT-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P2"},source:"protagonist-modification"},decisionContext:{value:0.70,urgency:0.55,socialAcceptability:0.60,dutyConflict:true}});
assert.strictEqual(modified.decision,"modified");
assert.strictEqual(modified.finalProposal.validatedParameters.destinationId,"P2");
assert.strictEqual(modified.execution.state,"route-ready");
assert.strictEqual(modified.protagonistEvaluation.reason,"lawful-validated-alternative-selected");

const interaction=Evaluator.evaluate({...base,proposal:{proposalId:"ACT-1",commandId:"advisor.propose_interaction",parameters:{personId:"R1",interactionTargetId:"OBJ1"}},decisionContext:{value:0.95,urgency:0.85,socialAcceptability:0.9}});
assert.strictEqual(interaction.decision,"accepted");
assert.strictEqual(interaction.finalValidation.ok,true);
assert.strictEqual(interaction.execution.attempted,true);
assert.strictEqual(interaction.execution.actionExecuted,true);
assert.strictEqual(interaction.execution.delegate,"ObjectInteractions -> ActionExecutor");
assert.strictEqual(interaction.execution.directWorldMutation,false);
assert.strictEqual(interactionAttempts,1);

const replayA=Evaluator.evaluate({...base,execute:false,proposal:{proposalId:"REPLAY-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}},decisionContext:{value:0.8,urgency:0.7,socialAcceptability:0.7}});
const replayB=Evaluator.evaluate({...base,execute:false,proposal:{proposalId:"REPLAY-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}},decisionContext:{value:0.8,urgency:0.7,socialAcceptability:0.7}});
assert.strictEqual(replayA.decision,replayB.decision);
assert.strictEqual(replayA.transactionId,replayB.transactionId);
assert.strictEqual(replayA.decisionId,replayB.decisionId);
assert.strictEqual(Evaluator.serialize(replayA),Evaluator.serialize(replayB));
const later=Evaluator.evaluate({...base,when:"1201-09-30 11:27:00",execute:false,proposal:{proposalId:"REPLAY-1",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}},decisionContext:{value:0.8,urgency:0.7,socialAcceptability:0.7}});
assert.notStrictEqual(later.decisionId,replayA.decisionId);

for(const row of [travel,invalid,rejected,deferred,modified,interaction,replayA]){
  assert.strictEqual(row.authority.fullWorldScan,false);
  assert.strictEqual(row.authority.parallelWorldAuthority,false);
  assert.strictEqual(row.authority.directControl,false);
  assert.strictEqual(row.authority.directPositionMutation,false);
  assert.strictEqual(row.authority.teleportation,false);
}

console.log(JSON.stringify({
  wp:"WP-S008-005",
  classification:"FUNCTIONAL",
  visual:"N/A — proposal evaluation and execution-boundary authority adds no rendered surface",
  pass:true,
  evaluatorVersion:Evaluator.EVALUATOR_VERSION,
  cases:{acceptedTravel:travel.decision,invalidTarget:invalid.finalValidation.reason,rejected:rejected.decision,deferred:deferred.decision,modified:modified.decision,acceptedInteraction:interaction.execution.state},
  routeCalls,interactionAttempts,deterministicReplay:true,seedAndFantasyTimeAuthority:true,
  noTeleport:true,directPositionMutation:false,fullWorldScan:false,parallelWorldAuthority:false
},null,2));
