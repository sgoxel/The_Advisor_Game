'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-action-runtime.js');
const source=fs.readFileSync(modulePath,'utf8');
assert(source.includes('VERSION="protagonist-action-runtime-v1"'),'runtime version marker missing');
assert(!source.includes('Math.random('),'runtime must not use Math.random');
assert(source.includes('MAX_PER_TICK=4'),'bounded tick cap missing');
assert(source.includes('directWorldMutation:false')&&source.includes('directPositionMutation:false')&&source.includes('teleportation:false'),'authority boundary markers missing');

const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const runtimeScript='scripts/world/protagonist-action-runtime.js?v=protagonist-action-runtime-v1';
assert(index.includes(runtimeScript),'canonical root must load ProtagonistActionRuntime');
assert(index.indexOf(runtimeScript)>index.indexOf('scripts/world/protagonist-command-evaluator.js?v=protagonist-command-evaluator-v1'),'runtime must load after evaluator');
assert(index.indexOf(runtimeScript)<index.indexOf('scripts/world/conversation-transactions.js?v=conversation-transactions-v2'),'runtime should load before conversation transaction presentation/history');

function evalRecord(config){
  const cmd=config.proposal.commandId;
  const common={transactionId:'TX-'+cmd,decisionId:'DEC-'+cmd,executionId:'EX-'+cmd,finalValidation:{ok:true,reason:'valid'}};
  if(cmd==='case.defer')return {...common,decision:'deferred',execution:{attempted:false,state:'not-run',actionExecuted:false}};
  if(cmd==='case.reject')return {...common,decision:'rejected',execution:{attempted:false,state:'not-run',actionExecuted:false}};
  if(cmd==='case.invalid')return {...common,decision:'invalid',finalValidation:{ok:false,reason:'target-unavailable'},execution:{attempted:false,state:'not-run',actionExecuted:false}};
  if(cmd==='case.running')return {...common,decision:'accepted',execution:{attempted:true,state:'route-ready',reason:'handoff-ready',actionExecuted:false}};
  if(cmd==='case.blocked')return {...common,decision:'accepted',execution:{attempted:false,state:'blocked',reason:'simulation-blocked',actionExecuted:false}};
  return {...common,decision:'accepted',execution:{attempted:true,state:'completed',reason:'complete',actionExecuted:true}};
}
const fakeEvaluator={evaluate:evalRecord};
global.ProtagonistCommandEvaluator=fakeEvaluator;
const Runtime=require(modulePath);
assert(Runtime&&Runtime.VERSION==='protagonist-action-runtime-v1');

const seed='AGENT6-WP-S010-001';
const t0='1201-09-30 17:00:00',t1='1201-09-30 17:00:01',t2='1201-09-30 17:00:02';
function proposal(commandId,id=commandId){return {proposalId:id,commandId,parameters:{target:id},source:'test'};}

// Deterministic schedule identity + duplicate idempotence.
const a=Runtime.createRuntime({evaluator:fakeEvaluator});
const s1=a.schedule({seed,when:t0,proposal:proposal('case.success','S1')});
const s2=a.schedule({seed,when:t0,proposal:proposal('case.success','S1')});
assert(s1.ok&&!s1.duplicate);assert(s2.ok&&s2.duplicate);assert.equal(s1.attempt.attemptId,s2.attempt.attemptId);assert.equal(a.snapshot().pendingCount,1);
const aReplay=Runtime.createRuntime({evaluator:fakeEvaluator});
assert.equal(aReplay.schedule({seed,when:t0,proposal:proposal('case.success','S1')}).attempt.attemptId,s1.attempt.attemptId,'same input must reproduce stable attempt id');

// Terminal success executes exactly once and duplicate reschedule remains idempotent.
const tickSuccess=a.tick({seed,when:t0});
assert.equal(tickSuccess.processedCount,1);assert.equal(tickSuccess.processed[0].state,'succeeded');assert.equal(tickSuccess.processed[0].terminal,true);assert.equal(a.snapshot().pendingCount,0);assert.equal(a.snapshot().resultCount,1);
const terminalDup=a.schedule({seed,when:t0,proposal:proposal('case.success','S1')});assert(terminalDup.duplicate);assert.equal(a.tick({seed,when:t1}).processedCount,0);

// Deferred/running attempts remain pending but are processed at most once per tick.
const b=Runtime.createRuntime({evaluator:fakeEvaluator});
const d=b.schedule({seed,when:t0,proposal:proposal('case.defer','D1')});
const r=b.schedule({seed,when:t0,proposal:proposal('case.running','R1')});
assert(d.ok&&r.ok);const first=b.tick({seed,when:t0,maxAttempts:4});
assert.equal(first.processedCount,2,'nonterminal attempts must not loop repeatedly in one tick');
assert(first.processed.some(x=>x.state==='deferred'));assert(first.processed.some(x=>x.state==='running'));assert.equal(b.snapshot().pendingCount,2);
const second=b.tick({seed,when:t1,maxAttempts:1});assert.equal(second.processedCount,1);assert.equal(b.telemetry().maxProcessedInTick,2);

// Revalidation at execution time can invalidate or reject an already scheduled attempt without mutation.
const c=Runtime.createRuntime({evaluator:fakeEvaluator});
c.schedule({seed,when:t0,proposal:proposal('case.invalid','I1')});
c.schedule({seed,when:t0,proposal:proposal('case.reject','J1')});
c.schedule({seed,when:t0,proposal:proposal('case.blocked','B1')});
const cTick=c.tick({seed,when:t0,maxAttempts:4});
assert.equal(cTick.processedCount,3);assert(cTick.processed.some(x=>x.state==='invalid'&&x.reason==='target-unavailable'));assert(cTick.processed.some(x=>x.state==='rejected'));assert(cTick.processed.some(x=>x.state==='blocked'));assert.equal(c.snapshot().pendingCount,0);

// Chronology is monotonic and fail closed.
const chrono=Runtime.createRuntime({evaluator:fakeEvaluator});
assert(chrono.schedule({seed,when:t1,proposal:proposal('case.success','C1')}).ok);
assert.equal(chrono.schedule({seed,when:t0,proposal:proposal('case.success','C0')}).reason,'cannot-rewind-schedule-chronology');
assert(chrono.tick({seed,when:t1}).ok);assert.equal(chrono.tick({seed,when:t0}).reason,'cannot-rewind-tick-chronology');
assert.equal(chrono.schedule({seed,when:t2,dueWhen:t1,proposal:proposal('case.success','C2')}).reason,'due-time-before-schedule');

// Pending queue and per-tick work remain bounded.
const cap=Runtime.createRuntime({evaluator:fakeEvaluator});
for(let i=0;i<Runtime.MAX_PENDING;i++)assert(cap.schedule({seed,when:t0,proposal:proposal('case.success','CAP-'+i)}).ok);
assert.equal(cap.snapshot().pendingCount,Runtime.MAX_PENDING);assert.equal(cap.schedule({seed,when:t0,proposal:proposal('case.success','OVER')}).reason,'pending-cap-reached');
const capTick=cap.tick({seed,when:t0,maxAttempts:99});assert.equal(capTick.processedCount,Runtime.MAX_PER_TICK);assert.equal(cap.telemetry().maxProcessedInTick,Runtime.MAX_PER_TICK);

// Planner-selected proposal is accepted as the runtime source without executing inside the planner.
const p=Runtime.createRuntime({evaluator:fakeEvaluator});
const plan={ok:true,seed,when:t0,planId:'PLAN-1234ABCD',selectionId:'SEL-1234ABCD',selectedProposal:proposal('case.success','PLAN-ACTION')};
const ps=p.schedule({plan,snapshot:{snapshotId:'SNAP'}});assert(ps.ok);assert.equal(ps.attempt.planId,plan.planId);assert.equal(ps.attempt.selectionId,plan.selectionId);assert.equal(p.tick({seed,when:t0}).processed[0].state,'succeeded');

// Existing evaluator integration: authoritative object interaction flows through ObjectInteractions -> ActionExecutor boundary.
global.CommandSetInterface=Object.freeze({validateProposal(snapshot,p){
  if(!snapshot?.targets?.interactions?.some(x=>x.id===p.parameters.interactionTargetId))return Object.freeze({ok:false,reason:'target-unavailable'});
  return Object.freeze({ok:true,status:'validated',reason:'proposal-valid',commandId:p.commandId,snapshotId:snapshot.snapshotId,proposalId:p.proposalId,source:p.source,validatedParameters:Object.freeze({...p.parameters})});
}});
let interactionAttempts=0;
global.ObjectInteractions=Object.freeze({
  context(seedValue,id){if(seedValue!==seed||id!=='OBJ1')return null;return Object.freeze({id,actions:Object.freeze([Object.freeze({id:'work',enabled:true,reason:'ready',target:{x:'0',y:'0'}})])});},
  attempt(seedValue,request){interactionAttempts++;assert.equal(seedValue,seed);assert.equal(request.objectId,'OBJ1');return Object.freeze({ok:true,status:'completed',reason:'completed',objectId:'OBJ1',action:'work'});}
});
const evaluatorPath=path.join(repoRoot,'scripts/world/protagonist-command-evaluator.js');
delete require.cache[require.resolve(evaluatorPath)];
const Evaluator=require(evaluatorPath);
const real=Runtime.createRuntime({evaluator:Evaluator});
const snapshot={snapshotId:'SNAP-REAL',context:{seed,when:t0,origin:{x:'0',y:'0',level:0}},targets:{people:[{id:'R1'}],places:[],routes:[],interactions:[{id:'OBJ1',personIds:['R1'],action:'work',position:{x:'0',y:'0'}}]}};
const realScheduled=real.schedule({seed,when:t0,snapshot,actorPosition:{x:'0',y:'0',level:0},decisionContext:{value:0.99,urgency:0.99,socialAcceptability:0.99},proposal:{proposalId:'REAL-1',commandId:'advisor.propose_interaction',parameters:{personId:'R1',interactionTargetId:'OBJ1'},source:'autonomous-runtime'}});
assert(realScheduled.ok);const realTick=real.tick({seed,when:t0});assert.equal(realTick.processedCount,1);assert.equal(realTick.processed[0].state,'succeeded');assert.equal(realTick.processed[0].evaluatorResult.execution.delegate,'ObjectInteractions -> ActionExecutor');assert.equal(interactionAttempts,1);

for(const snap of [a.snapshot(),b.snapshot(),c.snapshot(),cap.snapshot(),real.snapshot()]){
  assert.equal(snap.fullWorldScan,false);assert.equal(snap.perFrameScan,false);assert.equal(snap.directWorldMutation,false);assert.equal(snap.directPositionMutation,false);assert.equal(snap.teleportation,false);assert.equal(snap.simulationValidationBypass,false);assert(snap.pendingCount<=Runtime.MAX_PENDING);assert(snap.resultCount<=Runtime.MAX_RESULTS);
}

console.log(JSON.stringify({wp:'WP-S010-001',classification:'FUNCTIONAL',visual:'N/A — bounded execution runtime/authority boundary adds no rendered surface',pass:true,version:Runtime.VERSION,stableAttemptId:s1.attempt.attemptId,duplicateIdempotence:true,states:['succeeded','deferred','running','invalid','rejected','blocked'],realSimulationDelegate:'ObjectInteractions -> ActionExecutor',interactionAttempts,bounds:{maxPending:Runtime.MAX_PENDING,maxResults:Runtime.MAX_RESULTS,maxPerTick:Runtime.MAX_PER_TICK},eventDriven:true,perFrameScan:false,fullWorldScan:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,simulationValidationBypass:false},null,2));
