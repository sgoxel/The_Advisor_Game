'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-work-routine.js');
const source=fs.readFileSync(modulePath,'utf8');
const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');

assert(source.includes('VERSION="protagonist-work-routine-v1"'),'work-routine version marker missing');
assert(source.includes('MAX_CANDIDATES=12')&&source.includes('MAX_WORK_BLOCKS=4')&&source.includes('MAX_GOALS=8'),'work-routine bounds missing');
assert(source.includes('economyAuthority:false')&&source.includes('resourceProductionAuthority:false')&&source.includes('simulationValidationBypass:false'),'authority boundary markers missing');
assert(!source.includes('Math.random('),'work selection must not use Math.random');
const script='scripts/world/protagonist-work-routine.js?v=protagonist-work-routine-v1';
const selfCareScript='scripts/world/protagonist-self-care.js?v=protagonist-self-care-v1';
assert(index.includes(script),'canonical root must load ProtagonistWorkRoutine');
assert(index.indexOf(script)>index.indexOf(selfCareScript),'work routine should load after self-care foundation');
assert(index.indexOf(script)<index.indexOf('scripts/world/conversation-transactions.js?v=conversation-transactions-v2'),'work routine should load before conversation presentation/history');

delete require.cache[require.resolve(modulePath)];
const Work=require(modulePath);
assert.equal(Work.VERSION,'protagonist-work-routine-v1');

const seed='AGENT6-WP-S010-005',when='1201-09-30 09:00:00';
const lowNeeds={pressureMilli:{hunger:15000,fatigue:18000,safety:8000,social:12000}};
const healthy={conditionMilli:90000,fatigueMilli:18000};
const guildAuthority={scopes:['self','guild:participate']};
const workBlocks=[{id:'DAY',startMinute:480,endMinute:1020}];
function ctx(professionId,workplaceId,extra={}){return {professionId,workplaceId,workBlocks,...extra};}

const smith={
  id:'SMITH-WORK',kind:'indoor-work',professionIds:['smith'],workplaceId:'SMITHY',targetId:'SMITHY:anvil',
  available:true,priority:70,requiredAuthorityScope:'guild:participate',dutyId:'DUTY-SMITH',
  proposal:{proposalId:'P-SMITH',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'SMITHY:anvil'},source:'work-fixture'}
};
const wood={
  id:'WOOD-WORK',kind:'outdoor-work',professionIds:['woodcutter'],workplaceId:'WOODLOT-S7',targetId:'WOODLOT-S7:work',
  available:true,priority:65,requiresHealthyMobility:true,
  proposal:{proposalId:'P-WOOD',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'WOODLOT-S7:work'},source:'work-fixture'}
};
const guard={
  id:'GUARD-POST',kind:'public-duty',professionIds:['guard'],workplaceId:'NORTH-GATE',targetId:'NORTH-GATE:post',
  available:true,priority:75,requiredAuthorityScope:'settlement:administration',dutyId:'DUTY-GATE',
  proposal:{proposalId:'P-GUARD',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'NORTH-GATE:post'},source:'work-fixture'}
};

// Indoor craft duty.
const smithResult=Work.evaluate({seed,when,context:ctx('smith','SMITHY'),needs:lowNeeds,health:healthy,goals:{records:[]},authority:guildAuthority,candidates:[smith]});
assert.equal(smithResult.status,'proposal-ready');assert.equal(smithResult.disposition,'work');assert.equal(smithResult.selectedCandidate.kind,'indoor-work');
assert.equal(smithResult.selectedCandidate.workplaceId,'SMITHY');assert.equal(smithResult.selectedProposal.commandId,'advisor.propose_interaction');

// Outdoor work.
const woodResult=Work.evaluate({seed,when,context:ctx('woodcutter','WOODLOT-S7'),needs:lowNeeds,health:healthy,goals:{records:[]},authority:{scopes:['self']},candidates:[wood]});
assert.equal(woodResult.status,'proposal-ready');assert.equal(woodResult.selectedCandidate.kind,'outdoor-work');

// Guard/public duty with legitimate authority.
const guardResult=Work.evaluate({seed,when,context:ctx('guard','NORTH-GATE'),needs:lowNeeds,health:healthy,goals:{records:[]},authority:{scopes:['self','settlement:administration']},candidates:[guard]});
assert.equal(guardResult.status,'proposal-ready');assert.equal(guardResult.selectedCandidate.kind,'public-duty');

// Missing workplace fails closed without invented work.
const missing=Work.evaluate({seed,when,context:{professionId:'smith',workBlocks},needs:lowNeeds,health:healthy,goals:{records:[]},authority:guildAuthority,candidates:[smith]});
assert.equal(missing.status,'no-duty');assert.equal(missing.reason,'workplace-unavailable');assert.equal(missing.selectedProposal,null);

// Urgent self-preservation defers duty but retains it conceptually.
const hungry=Work.evaluate({seed,when,context:ctx('smith','SMITHY'),needs:{pressureMilli:{hunger:91000,fatigue:10000,safety:10000}},health:healthy,goals:{records:[]},authority:guildAuthority,candidates:[smith]});
assert.equal(hungry.status,'deferred');assert.equal(hungry.reason,'defer-for-hunger');assert(hungry.reasons.includes('duty-preserved'));assert.equal(hungry.selectedProposal,null);

// Injury constrains mobility-heavy outdoor duty.
const injured=Work.evaluate({seed,when,context:ctx('woodcutter','WOODLOT-S7'),needs:lowNeeds,health:{conditionMilli:45000,fatigueMilli:20000},goals:{records:[]},authority:{scopes:['self']},candidates:[wood]});
assert.equal(injured.status,'no-duty');assert.equal(injured.evaluated[0].reason,'injury-mobility-constraint');

// Lawful authority restriction fails closed.
const unlawful=Work.evaluate({seed,when,context:ctx('guard','NORTH-GATE'),needs:lowNeeds,health:healthy,goals:{records:[]},authority:{scopes:['self']},candidates:[guard]});
assert.equal(unlawful.status,'no-duty');assert.equal(unlawful.evaluated[0].reason,'authority-scope-missing');

// Active duty commitment deterministically influences equal-priority work.
const committedCandidate={...smith,id:'SMITH-COMMIT',priority:50,goalIds:['GOAL-DUTY']};
const otherCandidate={...smith,id:'SMITH-OTHER',priority:50,dutyId:'DUTY-OTHER'};
const committed=Work.evaluate({seed,when,context:ctx('smith','SMITHY'),needs:lowNeeds,health:healthy,goals:{records:[{id:'GOAL-DUTY',status:'active',priority:95,source:{kind:'duty',id:'DUTY-SMITH'}}]},authority:guildAuthority,candidates:[otherCandidate,committedCandidate]});
assert.equal(committed.selectedCandidate.id,'SMITH-COMMIT');assert.equal(committed.reason,'work-duty-commitment-supported');assert.equal(committed.selectedCandidate.supportPriority,95);

// End of duty block can produce a supplied, still-validated leave proposal.
const leave=Work.evaluate({seed,when:'1201-09-30 19:00:00',context:ctx('smith','SMITHY',{atWorkplace:true,leaveProposal:{proposalId:'P-LEAVE',commandId:'advisor.propose_travel',parameters:{destinationId:'HOME'}}}),needs:lowNeeds,health:healthy,goals:{records:[]},authority:guildAuthority,candidates:[smith]});
assert.equal(leave.status,'leave');assert.equal(leave.disposition,'leave');assert.equal(leave.reason,'leave-duty-block-ended');assert.equal(leave.selectedProposal.commandId,'advisor.propose_travel');

// Same input set is order-stable and replay-stable.
const replayA=Work.evaluate({seed,when,context:ctx('smith','SMITHY'),needs:lowNeeds,health:healthy,goals:{records:[]},authority:guildAuthority,candidates:[committedCandidate,otherCandidate]});
const replayB=Work.evaluate({seed,when,context:ctx('smith','SMITHY'),needs:lowNeeds,health:healthy,goals:{records:[]},authority:guildAuthority,candidates:[otherCandidate,committedCandidate]});
assert.equal(replayA.selectionId,replayB.selectionId);assert.deepStrictEqual(replayA.selectedCandidate,replayB.selectedCandidate);assert.deepStrictEqual(replayA.selectedProposal,replayB.selectedProposal);

// Hard read/candidate budgets fail closed.
const tooMany=Array.from({length:Work.MAX_CANDIDATES+1},(_,i)=>({...smith,id:'SMITH-'+i}));
assert.equal(Work.evaluate({seed,when,context:ctx('smith','SMITHY'),needs:lowNeeds,health:healthy,goals:{records:[]},authority:guildAuthority,candidates:tooMany}).reason,'candidate-limit-exceeded');
const tooManyBlocks=Array.from({length:Work.MAX_WORK_BLOCKS+1},(_,i)=>({id:'B'+i,startMinute:i*10,endMinute:i*10+5}));
assert.equal(Work.evaluate({seed,when,context:{professionId:'smith',workplaceId:'SMITHY',workBlocks:tooManyBlocks},needs:lowNeeds,health:healthy,goals:{records:[]},authority:guildAuthority,candidates:[smith]}).reason,'work-block-limit-exceeded');
const tooManyGoals=Array.from({length:Work.MAX_GOALS+1},(_,i)=>({id:'G'+i,status:'active',priority:10}));
assert.equal(Work.evaluate({seed,when,context:ctx('smith','SMITHY'),needs:lowNeeds,health:healthy,goals:{records:tooManyGoals},authority:guildAuthority,candidates:[smith]}).reason,'goal-read-limit-exceeded');

// Live adapters use bounded existing Stage 9 read APIs exactly once.
let needsReads=0,healthReads=0,goalReads=0,authorityReads=0;
global.ProtagonistNeeds={snapshot(){needsReads++;return lowNeeds;}};
global.ProtagonistHealth={decisionContext(){healthReads++;return healthy;}};
global.ProtagonistGoals={list(seedValue,options){goalReads++;assert.equal(options.limit,Work.MAX_GOALS);return [];}};
global.ProtagonistAuthority={decisionContext(){authorityReads++;return guildAuthority;}};
const live=Work.fromLive(seed,when,{context:ctx('smith','SMITHY'),candidates:[smith]});
assert.equal(live.status,'proposal-ready');assert.deepStrictEqual([needsReads,healthReads,goalReads,authorityReads],[1,1,1,1]);

// Actual existing evaluator/runtime boundary validates and delegates selected work to Simulation.
global.CommandSetInterface=Object.freeze({validateProposal(snapshot,p){
  const target=(snapshot?.targets?.interactions||[]).find(x=>x.id===p.parameters.interactionTargetId);
  if(!target)return Object.freeze({ok:false,reason:'target-unavailable'});
  return Object.freeze({ok:true,status:'validated',reason:'proposal-valid',commandId:p.commandId,snapshotId:snapshot.snapshotId,proposalId:p.proposalId,source:p.source,validatedParameters:Object.freeze({...p.parameters})});
}});
global.ObjectInteractions=Object.freeze({context(seedValue,targetId,position){
  if(targetId!=='SMITHY:anvil')return null;
  return Object.freeze({actions:Object.freeze([{id:'work',enabled:true,reason:'ready',target:Object.freeze({x:'0',y:'0',level:0})}])});
}});
global.ProtagonistInteractionPipeline=Object.freeze({execute(seedValue,input){
  return Object.freeze({ok:true,reason:'simulation-terminal-success',interaction:Object.freeze({
    attemptId:'IAX-WORK',resultId:'IRX-WORK',targetId:input.targetId,action:input.action,status:'terminal-success',reason:'simulation-terminal-success',simulation:Object.freeze({authoritativeTerminalSuccess:true})
  })});
}});
const evaluatorPath=path.join(repoRoot,'scripts/world/protagonist-command-evaluator.js');
delete require.cache[require.resolve(evaluatorPath)];
const Evaluator=require(evaluatorPath);
const runtimePath=path.join(repoRoot,'scripts/world/protagonist-action-runtime.js');
delete require.cache[require.resolve(runtimePath)];
const Runtime=require(runtimePath);
const rt=Runtime.createRuntime({evaluator:Evaluator});
const actorPosition={x:'0',y:'0',level:0};
const commandSnapshot={snapshotId:'SNAP-WORK',context:{seed,when,origin:actorPosition},targets:{people:[],places:[],routes:[],interactions:[{id:'SMITHY:anvil',objectType:'workbench',action:'work',position:actorPosition}]}};
const scheduled=Work.schedule(smithResult,commandSnapshot,{value:0.99,urgency:0.90,socialAcceptability:0.95,dutyConflict:false},{runtime:rt,actorPosition});
assert(scheduled.ok);assert.equal(scheduled.boundary,'ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation');
const tick=rt.tick({seed,when});assert.equal(tick.processedCount,1);assert.equal(tick.processed[0].state,'succeeded');
assert.equal(tick.processed[0].evaluatorResult.finalValidation.ok,true);
assert.equal(tick.processed[0].evaluatorResult.execution.delegate,'ProtagonistInteractionPipeline -> ObjectInteractions/ActionExecutor');
assert.equal(tick.processed[0].evaluatorResult.execution.actionExecuted,true);

assert.equal(smithResult.authority.professionAuthority,false);assert.equal(smithResult.authority.workplaceAuthority,false);assert.equal(smithResult.authority.economyAuthority,false);assert.equal(smithResult.authority.currencyAuthority,false);assert.equal(smithResult.authority.wageAuthority,false);assert.equal(smithResult.authority.resourceProductionAuthority,false);assert.equal(smithResult.authority.directWorldMutation,false);assert.equal(smithResult.authority.permissionFabrication,false);assert.equal(smithResult.authority.fullSettlementScan,false);assert.equal(smithResult.authority.perFrameScan,false);

console.log(JSON.stringify({
  wp:'WP-S010-005',classification:'FUNCTIONAL',visual:'N/A — bounded profession/duty selection and runtime handoff add no rendered surface',pass:true,version:Work.VERSION,
  evidence:{indoor:smithResult.selectedCandidate.kind,outdoor:woodResult.selectedCandidate.kind,publicDuty:guardResult.selectedCandidate.kind,missingWorkplace:missing.reason,highNeed:hungry.reason,injury:injured.evaluated[0].reason,authorityRestriction:unlawful.evaluated[0].reason,leave:leave.reason,commitment:committed.reason},
  deterministicReplay:true,liveReads:{needsReads,healthReads,goalReads,authorityReads},runtimeState:tick.processed[0].state,runtimeDelegate:tick.processed[0].evaluatorResult.execution.delegate,
  bounds:smithResult.bounds,directActionExecution:false,directWorldMutation:false,economyAuthority:false,resourceProductionAuthority:false,simulationValidationBypass:false,fullSettlementScan:false,perFrameScan:false
},null,2));
