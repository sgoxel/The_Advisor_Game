"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
global.window=global;

const root=path.resolve(__dirname,"../..");
const modulePath=path.join(root,"scripts/world/protagonist-advancement-goal.js");
delete require.cache[require.resolve(modulePath)];
const Advancement=require(modulePath);
global.ProtagonistAdvancementGoal=Advancement;

const seed="WP-S013-008-SEED",when="1201-10-01 11:00:00";
const profile={traits:{resolve:80,curiosity:70,caution:20,ambition:90,empathy:60,sociability:65}};
const needs={pressures:{hunger:10,fatigue:10,safety:5,social:10}};
const health={condition:0.95,fatigue:0.12,mobilityBlocked:false};
const goals={records:[{id:"G-ADV",status:"active",priority:90,title:"Earn a legitimate guild role"}]};
const authority={roleId:"local-resident",rankTier:0,scopes:["self"]};
const employment={status:"active",contract:{id:"EMP-SMITH",professionId:"smith"}};
const wealth={balanceCopper:240,reserveCopper:40};
const relationship={trust:.82,respect:.84,suspicion:.08,fear:.05,loyalty:.55,resentment:.04};
const primary={
  opportunityId:"ADV-GUILD",kind:"appointment",label:"Ask the master smith about guild appointment",priority:90,grounded:true,available:true,
  sourceRef:{kind:"resident",id:"R1"},targetRoleId:"guild-member",targetRankTier:1,goalLinks:["G-ADV"],
  prerequisites:{satisfied:true,blockers:[]},relationship,
  proposal:{proposalId:"PROP-ADV-GUILD",commandId:"advisor.propose_interaction",parameters:{personId:"R1",interactionTargetId:"OBJ1",topic:"guild appointment"},source:"advancement-evidence"}
};
const secondary={
  opportunityId:"ADV-TRAIN",kind:"training",label:"Ask for advanced forge training",priority:66,grounded:true,available:true,
  sourceRef:{kind:"resident",id:"R2"},prerequisites:{satisfied:true},relationship:{trust:.6,respect:.6},
  proposal:{proposalId:"PROP-ADV-TRAIN",commandId:"advisor.propose_interaction",parameters:{personId:"R2",interactionTargetId:"OBJ2",topic:"advanced training"},source:"advancement-evidence"}
};

const base={seed,when,profile,needs,health,goals,authority,employment,wealth,obligations:[],opportunities:[secondary,primary]};
const pursued=Advancement.evaluate(base);
assert(pursued.ok);assert.equal(pursued.status,"pursue");assert.equal(pursued.selectedOpportunityId,"ADV-GUILD");
assert.equal(pursued.selectedProposal.commandId,"advisor.propose_interaction");assert.equal(pursued.handoff.boundary,"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation");
assert.equal(pursued.handoff.terminalSimulationRequired,true);assert.equal(pursued.authority.opportunityCreation,false);assert.equal(pursued.authority.appointmentAuthority,false);

const replay=Advancement.evaluate({...base,opportunities:[primary,secondary]});
assert.equal(replay.decisionId,pursued.decisionId);assert.equal(replay.selectedOpportunityId,pursued.selectedOpportunityId);assert.deepStrictEqual(replay.evaluated,pursued.evaluated);

const urgent=Advancement.evaluate({...base,needs:{pressures:{hunger:95,fatigue:20,safety:10,social:10}}});
assert.equal(urgent.status,"defer");assert(urgent.selectedOpportunity.softBlockers.includes("urgent-self-care"));assert.equal(urgent.selectedProposal,null);

const conflictOpp={...primary,conflictsWithCommitmentIds:["OBL-FAMILY"]};
const conflict=Advancement.evaluate({...base,goals:{records:[]},obligations:[{id:"OBL-FAMILY",state:"due",priority:95,kind:"family"}],opportunities:[conflictOpp]});
assert.equal(conflict.status,"defer");assert(conflict.selectedOpportunity.softBlockers.includes("commitment-conflict"));

const missingPrereq=Advancement.evaluate({...base,opportunities:[{...primary,prerequisites:{satisfied:false,blockers:["qualification-missing"]}}]});
assert.equal(missingPrereq.status,"reject");assert.equal(missingPrereq.reason,"qualification-missing");assert.equal(missingPrereq.selectedProposal,null);
assert.equal(Advancement.runtimeInput(missingPrereq,{snapshotId:"NONE"}).ok,false);

const ungrounded=Advancement.evaluate({...base,opportunities:[{...primary,grounded:false}]});
assert.equal(ungrounded.status,"reject");assert.equal(ungrounded.reason,"opportunity-not-grounded");
const missingProposal=Advancement.evaluate({...base,opportunities:[{...primary,proposal:null}]});
assert.equal(missingProposal.status,"reject");assert.equal(missingProposal.reason,"proposal-required");

const stable=Advancement.evaluate({
  seed,when,profile:{traits:{resolve:50,curiosity:50,caution:100,ambition:10}},needs,health,goals:{records:[]},authority,employment:{status:"none"},wealth,obligations:[],
  opportunities:[{...primary,priority:90,goalLinks:[],relationship:{trust:.5,respect:.5,suspicion:.2,fear:.1,loyalty:.35,resentment:.1}}]
});
assert.equal(stable.status,"maintain-current-role");assert.equal(stable.reason,"stability-preferred");assert.equal(stable.selectedProposal,null);

const tooMany=Array.from({length:Advancement.MAX_OPPORTUNITIES+1},(_,i)=>({...primary,opportunityId:"ADV-"+i,proposal:{...primary.proposal,proposalId:"P-"+i}}));
assert.equal(Advancement.evaluate({...base,opportunities:tooMany}).reason,"opportunity-limit-exceeded");
const tooManyGoals=Array.from({length:Advancement.MAX_GOALS+1},(_,i)=>({id:"G"+i,status:"active",priority:10}));
assert.equal(Advancement.evaluate({...base,goals:{records:tooManyGoals}}).reason,"goal-read-limit-exceeded");
const duplicate=Advancement.evaluate({...base,opportunities:[primary,{...primary,label:"Conflicting duplicate"}]});
assert.equal(duplicate.status,"reject");assert(duplicate.evaluated.every(x=>x.reason==="opportunity-id-duplicate"));

let profileReads=0,needsReads=0,healthReads=0,goalReads=0,authorityReads=0,employmentReads=0,wealthReads=0,socialReads=0;
global.ProtagonistProfile={summary(){profileReads++;return profile}};
global.ProtagonistNeeds={snapshot(){needsReads++;return needs}};
global.ProtagonistHealth={decisionContext(){healthReads++;return health}};
global.ProtagonistGoals={list(s,o){goalReads++;assert.equal(o.limit,Advancement.MAX_GOALS);return goals.records}};
global.ProtagonistAuthority={decisionContext(){authorityReads++;return authority}};
global.ProtagonistEmployment={current(){employmentReads++;return employment}};
global.ProtagonistWealth={snapshot(){wealthReads++;return wealth}};
global.SocialState={dialogueContext(s,id){socialReads++;assert.equal(id,"R1");return relationship},adviceAcceptability(){return .9}};
global.ProtagonistStanding={snapshot(){throw new Error("Stage 13 standing must not be read")}};
global.ProtagonistStatusObligations={resolve(){throw new Error("Stage 13 status obligations must not be read")}};
global.ProtagonistPatronageOpportunities={list(){throw new Error("Stage 13 patronage opportunities must not be read")}};
global.ProtagonistProfessionOpportunities={list(){throw new Error("Stage 13 profession opportunities must not be read")}};
const live=Advancement.fromLive(seed,when,{obligations:[],opportunities:[{...primary,relationship:null}]});
assert(live.ok&&live.status==="pursue");assert.deepStrictEqual([profileReads,needsReads,healthReads,goalReads,authorityReads,employmentReads,wealthReads,socialReads],[1,1,1,1,1,1,1,1]);

let fakeSchedules=0,captured=null;
const fakeRuntime={schedule(config){fakeSchedules++;captured=config;return{ok:true,reason:"scheduled",attempt:{attemptId:"PAX-ADV",reason:"scheduled"}}}};
const scheduledOnly=Advancement.schedule(pursued,{snapshotId:"SNAP-ADV"},null,{runtime:fakeRuntime,actorPosition:{x:"0",y:"0",level:0}});
assert(scheduledOnly.ok);assert.equal(fakeSchedules,1);assert.equal(captured.proposal.proposalId,"PROP-ADV-GUILD");assert.equal(scheduledOnly.boundary,"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation");

global.CommandSetInterface=Object.freeze({validateProposal(snapshot,p){
  const target=(snapshot?.targets?.interactions||[]).find(x=>x.id===p.parameters.interactionTargetId);
  const person=(snapshot?.targets?.people||[]).find(x=>x.id===p.parameters.personId);
  if(!target||!person)return Object.freeze({ok:false,reason:"target-unavailable"});
  return Object.freeze({ok:true,status:"validated",reason:"proposal-valid",commandId:p.commandId,snapshotId:snapshot.snapshotId,proposalId:p.proposalId,source:p.source,validatedParameters:Object.freeze({...p.parameters})});
}});
global.ObjectInteractions=Object.freeze({context(s,targetId){
  if(targetId!=="OBJ1")return null;
  return Object.freeze({actions:Object.freeze([{id:"work",enabled:true,reason:"ready",target:Object.freeze({x:"0",y:"0",level:0})}])});
}});
let simulationCalls=0;
global.ProtagonistInteractionPipeline=Object.freeze({execute(s,input){
  simulationCalls++;
  return Object.freeze({ok:true,reason:"simulation-terminal-success",interaction:Object.freeze({attemptId:"IAX-ADV",resultId:"IRX-ADV",targetId:input.targetId,action:input.action,status:"terminal-success",reason:"simulation-terminal-success",simulation:Object.freeze({authoritativeTerminalSuccess:true})})});
}});
const evaluatorPath=path.join(root,"scripts/world/protagonist-command-evaluator.js");
delete require.cache[require.resolve(evaluatorPath)];const Evaluator=require(evaluatorPath);global.ProtagonistCommandEvaluator=Evaluator;
const runtimePath=path.join(root,"scripts/world/protagonist-action-runtime.js");
delete require.cache[require.resolve(runtimePath)];const Runtime=require(runtimePath);global.ProtagonistActionRuntime=Runtime;
const rt=Runtime.createRuntime({evaluator:Evaluator});
const commandSnapshot={snapshotId:"SNAP-ADV",context:{seed,when,origin:{x:"0",y:"0",level:0}},targets:{people:[{id:"R1"}],places:[],routes:[],interactions:[{id:"OBJ1",personIds:["R1"],objectType:"workbench",action:"work",position:{x:"0",y:"0",level:0}}]}};
const scheduled=Advancement.schedule(pursued,commandSnapshot,null,{runtime:rt,actorPosition:{x:"0",y:"0",level:0}});
assert(scheduled.ok);const tick=rt.tick({seed,when});assert.equal(tick.processedCount,1);assert.equal(tick.processed[0].state,"succeeded");assert.equal(simulationCalls,1);
assert.equal(tick.processed[0].evaluatorResult.finalValidation.ok,true);assert.equal(tick.processed[0].evaluatorResult.execution.actionExecuted,true);

const telemetry=Advancement.telemetry();
for(const key of ["fullWorldScan","fullSettlementScan","wholeHistoryScan","perFrameScan","directActionExecution","directWorldMutation","directRankMutation","directSkillMutation","directRelationshipMutation","directWealthMutation","appointmentAuthority","opportunityCreation","simulationValidationBypass"])assert.equal(telemetry[key],false,key);
assert.equal(telemetry.selectionEventDriven,true);assert(pursued.serializedBytes<=Advancement.MAX_RESULT_BYTES);

const source=fs.readFileSync(modulePath,"utf8");
for(const forbidden of ["Math.random(","Date.now(","new Date(","innerWidth","innerHeight","devicePixelRatio","navigator.","ProtagonistStanding","ProtagonistStatusObligations","ProtagonistPatronageOpportunities","ProtagonistProfessionOpportunities","ProtagonistAuthority?.transition","applyDelta(","ActionExecutor."])assert(!source.includes(forbidden),"forbidden authority/input reference: "+forbidden);
assert(source.includes('boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation"'));
assert(!source.includes("function evaluatorInput("),"selector must not expose a direct evaluator handoff");

const html=fs.readFileSync(path.join(root,"index.html"),"utf8"),script="scripts/world/protagonist-advancement-goal.js?v=protagonist-advancement-goal-v1";
assert(html.includes(script));assert(html.indexOf(script)>html.indexOf("scripts/world/protagonist-action-runtime.js?v=protagonist-action-runtime-v1"));assert(html.indexOf(script)>html.indexOf("scripts/world/protagonist-employment.js?v=protagonist-employment-v1"));

console.log(JSON.stringify({
  wp:"WP-S013-008",classification:"FUNCTIONAL",visual:"N/A — bounded autonomous advancement selection and runtime handoff introduce no rendered surface",pass:true,version:Advancement.VERSION,
  cases:{pursue:pursued.reason,urgentNeed:urgent.reason,commitmentConflict:conflict.reason,missingPrerequisite:missingPrereq.reason,ungrounded:ungrounded.reason,missingProposal:missingProposal.reason,maintain:stable.reason},
  deterministicReplay:true,inputOrderIndependent:true,stage1To12LiveReadsOnly:true,liveReads:{profileReads,needsReads,healthReads,goalReads,authorityReads,employmentReads,wealthReads,socialReads},
  runtimeBoundary:scheduled.boundary,terminalSimulationState:tick.processed[0].state,simulationCalls,bounds:pursued.bounds,guards:telemetry
},null,2));
