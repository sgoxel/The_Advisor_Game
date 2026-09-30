const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const repoRoot=path.resolve(__dirname,'../..');

function clone(v){return v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));}
function worldStub(){
  const store=new Map();
  return {
    structuralRef(seed,kind,actor,key){return {id:[seed,kind,actor,key].join('|')};},
    resolve(seed,ref){const current=store.get(ref.id);return current?{current:clone(current),delta:{revision:Number(current.__revision||0)}}:null;},
    applyDelta(seed,ref,patch){const previous=store.get(ref.id)||{},revision=Number(previous.__revision||0)+1,current={...clone(previous),...clone(patch),__revision:revision};store.set(ref.id,current);return {ok:true,reason:'ok',entry:{revision}};},
    _store:store
  };
}
const world=worldStub();
global.WorldState=world;
global.ProtagonistProfile={derive(seed,key){return {protagonistId:'PROTAGONIST-'+String(seed).replace(/[^A-Z0-9]/gi,'').slice(0,8).toUpperCase()};}};
global.GameTime={getTimestampKey(){return '1201-03-02 10:00:00';}};

const goalsPath=path.join(repoRoot,'scripts/world/protagonist-goals.js');
delete require.cache[require.resolve(goalsPath)];
const Goals=require(goalsPath);
global.ProtagonistGoals=Goals;

const progressPath=path.join(repoRoot,'scripts/world/protagonist-goal-progress.js');
delete require.cache[require.resolve(progressPath)];
const Progress=require(progressPath);
assert.equal(Progress.VERSION,'protagonist-goal-progress-v1');

const seed='GOAL-PROGRESS-SEED';
function makeGoal(label,minute){
  const r=Goals.create(seed,{topic:label,goalType:'commitment',priority:70,source:{kind:'self'},fantasyTimestamp:'1201-03-02 10:'+String(minute).padStart(2,'0')+':00',externalKey:'FIX-'+label});
  assert(r.ok,label);return r.record.id;
}
const gPartial=makeGoal('Reach market',0);
const gBlocked=makeGoal('Cross pass',1);
const gFailed=makeGoal('Ask gatekeeper',2);
const gDeferred=makeGoal('Repair gear',3);
const gComplete=makeGoal('Finish smith task',4);
const gForged=makeGoal('Forged completion guard',5);
const gAbandoned=makeGoal('Old plan',6);

const outcomes=new Map([
  ['action:PAX-PART',{attemptId:'PAX-PART',state:'running',terminal:false,reason:'simulation-handoff-active'}],
  ['action:PAX-BLOCK',{attemptId:'PAX-BLOCK',state:'blocked',terminal:true,reason:'route-blocked'}],
  ['interaction:IAX-FAIL',{attemptId:'IAX-FAIL',resultId:'IRX-FAIL',status:'failed',reason:'interaction-failed',simulation:{authoritativeTerminalSuccess:false}}],
  ['action:PAX-DEFER',{attemptId:'PAX-DEFER',state:'deferred',terminal:false,reason:'protagonist-deferred'}],
  ['action:PAX-DONE',{attemptId:'PAX-DONE',state:'succeeded',terminal:true,reason:'simulation-terminal-success',evaluatorResult:{finalValidation:{ok:true},execution:{actionExecuted:true,state:'succeeded',authoritativeResult:{id:'SIM-WORK-77',terminal:true}}}}],
  ['action:PAX-FORGED',{attemptId:'PAX-FORGED',state:'succeeded',terminal:true,reason:'claimed-only',evaluatorResult:{finalValidation:{ok:true},execution:{actionExecuted:false,state:'succeeded',authoritativeResult:{id:'FAKE-77',terminal:true}}}}]
]);
const svc=Progress.createService({worldState:world,goals:Goals,resolveOutcome(seedValue,kind,id){return outcomes.get(kind+':'+id)|| (kind==='goal'?Goals.get(seedValue,id):null);}});

const partial=svc.record(seed,{goalId:gPartial,sourceKind:'action',sourceId:'PAX-PART',when:'1201-03-02 10:10:00'});
assert(partial.ok);assert.equal(partial.observation.status,'progress');assert.equal(Goals.get(seed,gPartial).status,'active');

const blocked=svc.record(seed,{goalId:gBlocked,sourceKind:'action',sourceId:'PAX-BLOCK',when:'1201-03-02 10:11:00'});
assert(blocked.ok);assert.equal(blocked.observation.status,'blocked');assert.equal(Goals.get(seed,gBlocked).status,'active');
const replan=svc.record(seed,{goalId:gBlocked,sourceKind:'action',sourceId:'PAX-BLOCK',when:'1201-03-02 10:12:00',replanNeeded:true});
assert(replan.ok);assert.equal(replan.observation.status,'replan-needed');
const context=svc.replanContext(seed,gBlocked);
assert(context.ok&&context.replanNeeded);assert.equal(context.status,'replan-needed');assert(context.reasons.length>=1);assert.equal(context.plannerAuthority,false);

const failed=svc.record(seed,{goalId:gFailed,sourceKind:'interaction',sourceId:'IAX-FAIL',when:'1201-03-02 10:13:00'});
assert(failed.ok);assert.equal(failed.observation.status,'failed');assert.equal(Goals.get(seed,gFailed).status,'active');

const deferred=svc.record(seed,{goalId:gDeferred,sourceKind:'action',sourceId:'PAX-DEFER',when:'1201-03-02 10:14:00'});
assert(deferred.ok);assert.equal(deferred.observation.status,'deferred');assert.equal(Goals.get(seed,gDeferred).status,'active');

const completed=svc.record(seed,{goalId:gComplete,sourceKind:'action',sourceId:'PAX-DONE',when:'1201-03-02 10:15:00'});
assert(completed.ok);const completedGoal=Goals.get(seed,gComplete);assert.equal(completedGoal.status,'completed');assert.equal(completedGoal.completion.source,'Simulation');assert.equal(completedGoal.completion.simulationResultId,'SIM-WORK-77');
const duplicate=svc.record(seed,{goalId:gComplete,sourceKind:'action',sourceId:'PAX-DONE',when:'1201-03-02 10:15:00'});
assert(duplicate.ok&&duplicate.duplicate);assert.equal(duplicate.observation.observationId,completed.observation.observationId);

const forged=svc.record(seed,{goalId:gForged,sourceKind:'action',sourceId:'PAX-FORGED',when:'1201-03-02 10:16:00'});
assert.equal(forged.ok,false);assert.equal(forged.reason,'authoritative-source-state-unsupported');assert.equal(Goals.get(seed,gForged).status,'active');

const abandonedTransition=Goals.abandon(seed,gAbandoned,{fantasyTimestamp:'1201-03-02 10:17:00',reason:'explicit-authoritative-goal-transition'});
assert(abandonedTransition.ok);
const abandoned=svc.record(seed,{goalId:gAbandoned,sourceKind:'goal',sourceId:gAbandoned,when:'1201-03-02 10:17:01'});
assert(abandoned.ok);assert.equal(abandoned.observation.status,'abandoned');

const rewind=svc.record(seed,{goalId:gBlocked,sourceKind:'action',sourceId:'PAX-BLOCK',when:'1201-03-02 10:09:00'});
assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-progress-chronology');

const svcReload=Progress.createService({worldState:world,goals:Goals,resolveOutcome(seedValue,kind,id){return outcomes.get(kind+':'+id)|| (kind==='goal'?Goals.get(seedValue,id):null);}});
const afterReload=svcReload.list(seed,gComplete,{limit:12});
assert.equal(afterReload.length,1);assert.equal(afterReload[0].resultReference,'SIM-WORK-77');assert.equal(afterReload[0].worldTruthCopied,false);

const snap=svcReload.snapshot(seed);
assert(snap.compatible);assert(snap.recordCount>=7);assert.equal(snap.bounds.maxObservations,32);assert.equal(snap.bounds.maxQueryResults,12);assert.equal(snap.bounds.maxLedgerBytes,48*1024);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.fullWorldScan,false);assert.equal(snap.perFrameScan,false);assert.equal(snap.directActionExecution,false);assert.equal(snap.directWorldMutation,false);assert.equal(snap.plannerAuthority,false);assert.equal(snap.completionAuthority,'ProtagonistGoals with terminal Simulation evidence');

const html=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const script='scripts/world/protagonist-goal-progress.js?v=protagonist-goal-progress-v1';
assert(html.includes(script),'canonical root must load goal progress');
assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-journey.js?v=protagonist-journey-v1'));
assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-interaction-pipeline.js?v=protagonist-interaction-pipeline-v1'));

console.log(JSON.stringify({wp:'WP-S010-007',status:'PASS',visual:'N/A',evidence:{partial:partial.observation.status,blocked:blocked.observation.status,replan:context.status,failed:failed.observation.status,deferred:deferred.observation.status,completed:completedGoal.status,forgedRejected:!forged.ok,abandoned:abandoned.observation.status,duplicateIdempotent:duplicate.duplicate,saveReload:afterReload.length===1,bounds:snap.bounds,fullWorldScan:snap.fullWorldScan,wholeHistoryScan:snap.wholeHistoryScan,directActionExecution:snap.directActionExecution,directWorldMutation:snap.directWorldMutation}}));
