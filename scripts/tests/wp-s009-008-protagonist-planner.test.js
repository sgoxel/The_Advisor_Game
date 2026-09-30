const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

const modulePath=path.resolve(__dirname,'../world/protagonist-planner.js');
delete require.cache[modulePath];
const Planner=require(modulePath);
assert(Planner,'ProtagonistPlanner should attach to window');

const seed='WP-S009-008-SEED-A',when='1201-05-03 08:00:00';
const context={contextId:'DCTX-FIXTURE-1',decisionContext:{value:0.72,urgency:0.61,socialAcceptability:0.70,dutyConflict:false},reasons:['active-commitment']};

const competing=Planner.plan({
  seed,when,context,
  candidates:[
    {candidateId:'GOAL-FOOD',kind:'goal',goalId:'GOAL-A',priority:82,urgency:78,suitability:90,state:'available',reasonCodes:['hunger-pressure']},
    {candidateId:'GOAL-DUTY',kind:'goal',goalId:'GOAL-B',priority:90,urgency:40,suitability:85,state:'available',reasonCodes:['existing-commitment']},
    {candidateId:'GOAL-REST',kind:'goal',goalId:'GOAL-C',priority:65,urgency:65,suitability:80,state:'available'}
  ]
});
const competingReplay=Planner.plan(JSON.parse(JSON.stringify({seed,when,context,candidates:[
  {candidateId:'GOAL-FOOD',kind:'goal',goalId:'GOAL-A',priority:82,urgency:78,suitability:90,state:'available',reasonCodes:['hunger-pressure']},
  {candidateId:'GOAL-DUTY',kind:'goal',goalId:'GOAL-B',priority:90,urgency:40,suitability:85,state:'available',reasonCodes:['existing-commitment']},
  {candidateId:'GOAL-REST',kind:'goal',goalId:'GOAL-C',priority:65,urgency:65,suitability:80,state:'available'}
]})));
assert.equal(competing.ok,true);assert.deepStrictEqual(competingReplay,competing,'same SEED + fantasy time + candidates must replay exactly');
assert(/^PLAN-[0-9A-F]{8}$/.test(competing.planId));assert(/^SEL-[0-9A-F]{8}$/.test(competing.selectionId));
assert.equal(competing.selectionState,'selected');assert.equal(competing.selectedCandidate.candidateId,'GOAL-FOOD','weighted deterministic ranking should select the stronger immediate goal');
assert.equal(competing.queue.length,3);assert.equal(competing.handoff.directExecution,false);assert.equal(competing.authority.directActionExecution,false);

const deferred=Planner.plan({
  seed,when:'1201-05-03 08:10:00',context,
  candidates:[
    {candidateId:'WAIT-A',kind:'goal',goalId:'GOAL-WAIT-A',priority:80,urgency:30,suitability:60,state:'deferred',deferReason:'not-ready'},
    {candidateId:'BLOCK-B',kind:'goal',goalId:'GOAL-BLOCK-B',priority:100,urgency:100,suitability:100,state:'blocked',blockedReason:'target-unavailable'}
  ]
});
assert.equal(deferred.selectionState,'deferred');assert.equal(deferred.selectedCandidate,null);assert.equal(deferred.selectionId,null);assert(deferred.reasons.includes('deferred-candidates-remain'));

const noop=Planner.plan({seed,when:'1201-05-03 08:20:00',context,candidates:[]});
assert.equal(noop.selectionState,'noop');assert.equal(noop.selectedCandidate,null);assert(noop.reasons.includes('no-valid-candidates'));

const invalidMix=Planner.plan({
  seed,when:'1201-05-03 08:30:00',context,
  candidates:[
    {candidateId:'BAD-PRIORITY',kind:'goal',goalId:'G-BAD',priority:500,urgency:10,state:'available'},
    {candidateId:'BAD-ACTION',kind:'action',priority:50,urgency:50,state:'available'},
    {candidateId:'GOOD-ACTION',kind:'action',priority:60,urgency:70,suitability:75,state:'available',proposal:{proposalId:'AUTO-1',commandId:'advisor.query_information',parameters:{topic:'weather'},source:'autonomous-planner'}}
  ]
});
assert.equal(invalidMix.ok,true);assert.equal(invalidMix.rejectedCandidates.length,2);assert.equal(invalidMix.selectedCandidate.candidateId,'GOOD-ACTION');assert.equal(invalidMix.selectedProposal.commandId,'advisor.query_information');
assert.deepStrictEqual(invalidMix.rejectedCandidates.map(x=>x.reason),['candidate-priority-invalid','action-proposal-required']);

const limitCandidates=Array.from({length:Planner.MAX_CANDIDATES+1},(_,i)=>({candidateId:'C-'+i,kind:'goal',goalId:'G-'+i,priority:50,urgency:50,state:'available'}));
const overLimit=Planner.plan({seed,when:'1201-05-03 08:35:00',context,candidates:limitCandidates});
assert.equal(overLimit.ok,false);assert.equal(overLimit.reason,'candidate-limit-exceeded');

const initial=Planner.plan({
  seed,when:'1201-05-03 09:00:00',context,
  candidates:[
    {candidateId:'MARKET',kind:'action',priority:80,urgency:80,suitability:90,state:'available',proposal:{proposalId:'MARKET-P',commandId:'advisor.query_schedule',parameters:{topic:'market'}}},
    {candidateId:'REST',kind:'action',priority:70,urgency:55,suitability:75,state:'available',proposal:{proposalId:'REST-P',commandId:'advisor.query_information',parameters:{topic:'rest'}}}
  ]
});
assert.equal(initial.selectedCandidate.candidateId,'MARKET');

const saved=Planner.serialize(initial);assert.equal(typeof saved,'string');
const restored=Planner.restore(saved);assert.equal(restored.ok,true);assert.deepStrictEqual(restored.plan,initial,'serialized plan must restore without drift');

const changedConfig={
  seed,when:'1201-05-03 09:15:00',context,previousPlan:saved,
  interruption:{kind:'candidate-invalidated',candidateId:'MARKET',reasonCode:'market-closed'},
  candidates:[
    {candidateId:'MARKET',kind:'action',priority:80,urgency:80,suitability:90,state:'blocked',blockedReason:'market-closed',proposal:{proposalId:'MARKET-P',commandId:'advisor.query_schedule',parameters:{topic:'market'}}},
    {candidateId:'REST',kind:'action',priority:70,urgency:75,suitability:90,state:'available',proposal:{proposalId:'REST-P',commandId:'advisor.query_information',parameters:{topic:'rest'}}}
  ]
};
const replannedA=Planner.replan(changedConfig),replannedB=Planner.replan({...changedConfig,previousPlan:initial});
assert.equal(replannedA.ok,true);assert.deepStrictEqual(replannedB,replannedA,'restored and in-memory previous plan must replan identically');
assert.equal(replannedA.previousPlanId,initial.planId);assert.equal(replannedA.interruptedSelectionId,initial.selectionId);
assert.equal(replannedA.selectedCandidate.candidateId,'REST');assert(replannedA.reasons.includes('replan-candidate-invalidated'));
assert(replannedA.historyPlanIds.includes(initial.planId));assert(replannedA.chronologyDepth<=Planner.MAX_HISTORY);

const rewind=Planner.replan({...changedConfig,when:'1201-05-03 08:59:59',previousPlan:initial});
assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-plan-chronology');

const tampered=JSON.parse(saved);tampered.selectionState='noop';
const tamperedRestore=Planner.restore(JSON.stringify(tampered));assert.equal(tamperedRestore.ok,false);assert.equal(tamperedRestore.reason,'plan-signature-mismatch');

global.CommandSetInterface={
  validateProposal(snapshot,proposal){
    return Object.freeze({ok:true,status:'accepted',reason:'valid',proposalId:proposal.proposalId||null,commandId:proposal.commandId,validatedParameters:Object.freeze({...proposal.parameters}),source:proposal.source||'direct'});
  }
};
const evaluatorPath=path.resolve(__dirname,'../world/protagonist-command-evaluator.js');
delete require.cache[evaluatorPath];
const Evaluator=require(evaluatorPath);
const handoff=Planner.evaluatorInput(invalidMix,{snapshotId:'PLAN-SNAP',context:{seed,when:'1201-05-03 08:30:00'},targets:{}},context.decisionContext);
assert.equal(handoff.ok,true);assert.equal(handoff.executionDisabled,true);assert.equal(handoff.boundary,'ProtagonistCommandEvaluator');assert.equal(handoff.config.execute,false);
const evaluated=Evaluator.evaluate(handoff.config);
assert.equal(evaluated.protagonistEvaluation.checked,true);assert.equal(evaluated.execution.attempted,false);assert.equal(evaluated.authority.simulationValidation,true);assert.equal(evaluated.authority.parallelWorldAuthority,false);

const goalOnlyHandoff=Planner.evaluatorInput(competing,{snapshotId:'X',context:{seed,when},targets:{}},context.decisionContext);
assert.equal(goalOnlyHandoff.ok,false);assert.equal(goalOnlyHandoff.reason,'selected-executable-proposal-required');

global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;global.navigator={userAgent:'device-a'};
const presentationA=Planner.plan({seed,when,context,candidates:[{candidateId:'P',kind:'goal',goalId:'GP',priority:50,urgency:50,state:'available'}]});
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'device-b'};
const presentationB=Planner.plan({seed,when,context,candidates:[{candidateId:'P',kind:'goal',goalId:'GP',priority:50,urgency:50,state:'available'}]});
assert.deepStrictEqual(presentationB,presentationA,'presentation/device state influenced planner');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input reference: '+forbidden);
for(const forbidden of ['ActionExecutor','RoutePlanner','applyDelta','setPosition','teleport'])assert(!source.includes(forbidden),'planner must not contain direct execution/mutation path: '+forbidden);
assert(source.includes('fullWorldScan:false')&&source.includes('perFrameScan:false'),'bounded scan contract missing');

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/protagonist-planner.js?v=protagonist-autonomous-planner-v1';
  assert(html.includes(script),'canonical root must load ProtagonistPlanner');
  assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-decision-context.js?v=protagonist-decision-context-v1'));
  assert(html.indexOf(script)<html.indexOf('scripts/world/protagonist-command-evaluator.js?v=protagonist-command-evaluator-v1'));
}

const telemetry=Planner.telemetry();
assert(telemetry.plans>=8);assert(telemetry.replans>=3);assert(telemetry.restores>=3);assert(telemetry.rejectedCandidates>=2);
assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.perFrameScan,false);assert.equal(telemetry.authority,false);

console.log(JSON.stringify({
  wp:'WP-S009-008',classification:'FUNCTIONAL',visual:'N/A — autonomous planning queue adds no rendered surface',pass:true,
  version:Planner.VERSION,deterministicSelection:true,stablePlanIds:true,stableSelectionIds:true,competingGoalSelection:true,
  deferState:true,noopState:true,invalidCandidateRejection:true,candidateLimit:Planner.MAX_CANDIDATES,queueLimit:Planner.MAX_QUEUE,
  changedConditionReplanning:true,serializedReplay:true,rewindRejected:true,tamperRejected:true,evaluatorBoundary:true,executionAttempted:false,
  fullWorldScan:false,perFrameScan:false,worldMutation:false,directActionExecution:false,telemetry
},null,2));
