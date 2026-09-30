'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-interaction-pipeline.js');
const source=fs.readFileSync(modulePath,'utf8');
const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const evaluatorSource=fs.readFileSync(path.join(repoRoot,'scripts/world/protagonist-command-evaluator.js'),'utf8');
const runtimeSource=fs.readFileSync(path.join(repoRoot,'scripts/world/protagonist-action-runtime.js'),'utf8');

assert(source.includes('VERSION="protagonist-interaction-pipeline-v1"'),'pipeline version marker missing');
assert(source.includes('MAX_ACTIVE=8')&&source.includes('MAX_RESULTS=24')&&source.includes('MAX_LEDGER_BYTES=64*1024'),'bounded ledger markers missing');
assert(!source.includes('Math.random('),'interaction pipeline must not use Math.random');
const pipelineScript='scripts/world/protagonist-interaction-pipeline.js?v=protagonist-interaction-pipeline-v1';
const evaluatorScript='scripts/world/protagonist-command-evaluator.js?v=protagonist-command-evaluator-v1';
const runtimeScript='scripts/world/protagonist-action-runtime.js?v=protagonist-action-runtime-v1';
assert(index.includes(pipelineScript),'canonical root must load interaction pipeline');
assert(index.indexOf(pipelineScript)>index.indexOf(evaluatorScript),'pipeline must load after evaluator definition');
assert(index.indexOf(pipelineScript)<index.indexOf(runtimeScript),'pipeline must load before autonomous runtime');
assert(evaluatorSource.includes('ProtagonistInteractionPipeline -> ObjectInteractions/ActionExecutor'),'evaluator pipeline delegate missing');
assert(runtimeSource.includes('runtimeAttemptId:row.attemptId'),'runtime must thread stable attempt identity');

function clone(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));}
function makeWorld(){
  const stores=new Map();
  function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);}
  return {
    structuralRef(seed,kind,parent,key){return {id:'STR|'+kind+'|'+parent+'|'+key,kind,key:{seed}};},
    resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return {current:entry?clone(entry.changes):{},delta:entry?clone(entry):null};},
    applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id],entry={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:++s.sequence,reason,changes:{...(prev?.changes||{}),...clone(changes)}};s.entries[ref.id]=entry;return {ok:true,reason:'ok',entry:clone(entry)};},
    serializeState(seed){return clone(ensure(seed));},
    restoreState(seed,value){stores.set(seed,clone(value));},
    clear(seed){stores.delete(seed);}
  };
}

const objects={
  'OBJ-WORK':{id:'OBJ-WORK',type:'workbench',buildingId:'BLDG-A',actions:['inspect','work']},
  'BLDG-A:door':{id:'BLDG-A:door',type:'door',buildingId:'BLDG-A',actions:['inspect','enter']}
};
const execStates=new Map();
global.WorldState=makeWorld();
global.ObjectInteractions={
  get(seed,id){return objects[id]||null;},
  context(seed,id,pos){const d=objects[id];if(!d)return null;const here=pos&&String(pos.x)==='0'&&String(pos.y)==='0';return {id,actions:d.actions.map(action=>({id:action,enabled:here,reason:here?'ready':'out-of-range',target:{x:'0',y:'0',level:0}}))};},
  attempt(seed,request){
    const d=objects[request.objectId];
    if(!d)return {ok:false,status:'rejected',reason:'unknown-object',authoritative:true};
    if(!d.actions.includes(request.action))return {ok:false,status:'rejected',reason:'unsupported-action',authoritative:true};
    if(String(request.actorPosition.x)!=='0'||String(request.actorPosition.y)!=='0')return {ok:false,status:'rejected',reason:'out-of-range',authoritative:true};
    if(request.action==='inspect')return {ok:true,status:'complete',reason:'inspected',objectId:d.id,action:'inspect',authoritative:true};
    if(request.action==='enter')return {ok:true,status:'ready',reason:'building-entry-ready',objectId:d.id,action:'enter',delegatesTo:'BuildingInteriors/RoutePlanner',authoritative:true};
    const key=request.actorKind+':'+request.actorId;execStates.set(key,{elapsed:0,action:request.action,objectId:d.id});
    return {ok:true,status:'active',reason:'compatible',objectId:d.id,action:request.action,authoritative:true};
  }
};
global.ActionExecutor={advanceActor(request,seconds){
  const key=request.actorKind+':'+request.actorId,state=execStates.get(key)||{elapsed:0,action:request.activity.action,objectId:request.activity.interactionObjectId};
  state.elapsed+=Number(seconds)||0;execStates.set(key,state);
  if(state.elapsed>=6)return {status:'complete',reason:'compatible',state:{authoritative:true,status:'complete',action:state.action,interactionObjectId:state.objectId,completedSequence:7}};
  return {status:'active',reason:'compatible',state:{authoritative:true,status:'active',action:state.action,interactionObjectId:state.objectId,elapsedSeconds:state.elapsed}};
}};

delete require.cache[require.resolve(modulePath)];
const Pipeline=require(modulePath);
global.ProtagonistInteractionPipeline=Pipeline;
assert.equal(Pipeline.VERSION,'protagonist-interaction-pipeline-v1');

const seed='AGENT6-WP-S010-003',t0='1201-09-30 17:00:00',t3='1201-09-30 17:00:03',t6='1201-09-30 17:00:06';
const pos={x:'0',y:'0',level:0};
function base(externalKey,targetId='OBJ-WORK',action='work',targetKind='object',when=t0){return {when,actorId:'protagonist',actorPosition:pos,targetKind,targetId,action,externalKey,references:{conversationTransactionId:'CTX-1',proposalId:'PROP-1',decisionId:'DEC-1',runtimeAttemptId:externalKey}};}

// Stateful object use: active -> terminal success only after authoritative ActionExecutor completion.
const world=makeWorld(),svc=Pipeline.createService({worldState:world});
const started=svc.execute(seed,base('PAX-1'));
assert(started.ok);assert.equal(started.interaction.status,'active');assert(/^IAX-/.test(started.interaction.attemptId));assert.equal(started.interaction.references.conversationTransactionIds[0],'CTX-1');
const forged=svc.claimCompletion(seed,{attemptId:started.interaction.attemptId,completed:true});
assert.equal(forged.ok,false);assert.equal(forged.claimedCompletionSuppressed,true);assert.equal(svc.get(seed,started.interaction.attemptId).status,'active');
const partial=svc.execute(seed,base('PAX-1','OBJ-WORK','work','object',t3));assert(partial.ok);assert.equal(partial.interaction.status,'active');assert.equal(partial.processedSeconds,3);
const done=svc.execute(seed,base('PAX-1','OBJ-WORK','work','object',t6));assert(done.ok);assert.equal(done.interaction.status,'terminal-success');assert.equal(done.interaction.simulation.authoritativeTerminalSuccess,true);assert(/^IRX-/.test(done.interaction.resultId));
const duplicateDone=svc.execute(seed,base('PAX-1','OBJ-WORK','work','object',t6));assert(duplicateDone.ok&&duplicateDone.duplicate);assert.equal(duplicateDone.interaction.resultId,done.interaction.resultId);

// Building interaction reuses the authoritative door descriptor and can terminally inspect it.
const building=svc.execute(seed,base('PAX-BUILD','BLDG-A:door','inspect','building',t6));
assert(building.ok);assert.equal(building.interaction.status,'terminal-success');assert.equal(building.interaction.targetKind,'building');

// Unknown target and unsupported action fail closed with explicit terminal records.
const unavailable=svc.execute(seed,base('PAX-MISSING','NOPE','inspect','object',t6));assert(unavailable.ok);assert.equal(unavailable.interaction.status,'unavailable');
const rejected=svc.execute(seed,base('PAX-REJECT','OBJ-WORK','teleport','object',t6));assert(rejected.ok);assert.equal(rejected.interaction.status,'rejected');

// Pending and failed person outcomes exist only through an explicit Simulation-facing adapter.
const personWorld=makeWorld();
const personAdapter={
  validation(seedValue,row){return row.targetId==='PERSON-1'?{ok:true,status:'ready',reason:'person-ready',delegate:'TestPersonSimulation'}:{ok:false,status:'unavailable',reason:'person-unavailable',delegate:'TestPersonSimulation'};},
  start(){return {ok:true,status:'pending',reason:'awaiting-person-response',delegate:'TestPersonSimulation'};},
  advance(){return {ok:false,status:'failed',reason:'person-declined',delegate:'TestPersonSimulation'};}
};
const personSvc=Pipeline.createService({worldState:personWorld,adapter:personAdapter});
const pending=personSvc.execute(seed,base('PAX-PERSON','PERSON-1','speak','person',t0));assert(pending.ok);assert.equal(pending.interaction.status,'pending');
const failed=personSvc.execute(seed,base('PAX-PERSON','PERSON-1','speak','person',t3));assert(failed.ok);assert.equal(failed.interaction.status,'failed');

// Save/reload continuity preserves the active attempt and stable identity.
const reloadWorld=makeWorld(),reloadSvc=Pipeline.createService({worldState:reloadWorld});
const reloadStart=reloadSvc.execute(seed,base('PAX-RELOAD'));assert.equal(reloadStart.interaction.status,'active');
const saved=reloadWorld.serializeState(seed);reloadWorld.clear(seed);reloadWorld.restoreState(seed,saved);
const reloaded=Pipeline.createService({worldState:reloadWorld});
const reloadDone=reloaded.execute(seed,base('PAX-RELOAD','OBJ-WORK','work','object',t6));assert.equal(reloadDone.interaction.attemptId,reloadStart.interaction.attemptId);assert.equal(reloadDone.interaction.status,'terminal-success');

// Same direct inputs on independent campaign stores reproduce identity/result.
const wA=makeWorld(),wB=makeWorld(),a=Pipeline.createService({worldState:wA}),b=Pipeline.createService({worldState:wB});
const aBuild=a.execute(seed,base('PAX-DETERMINISTIC','BLDG-A:door','inspect','building',t0)),bBuild=b.execute(seed,base('PAX-DETERMINISTIC','BLDG-A:door','inspect','building',t0));
assert.equal(aBuild.interaction.attemptId,bBuild.interaction.attemptId);assert.equal(aBuild.interaction.resultId,bBuild.interaction.resultId);

// Rewind fails closed with no mutation.
const chronoWorld=makeWorld(),chrono=Pipeline.createService({worldState:chronoWorld});chrono.execute(seed,base('PAX-CHRONO','OBJ-WORK','work','object',t3));const before=JSON.stringify(chrono.snapshot(seed));const rewind=chrono.execute(seed,base('PAX-CHRONO','OBJ-WORK','work','object',t0));assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-interaction-chronology');assert.equal(JSON.stringify(chrono.snapshot(seed)),before);

// Retention is bounded with no whole-world/history scan.
const boundWorld=makeWorld(),bound=Pipeline.createService({worldState:boundWorld});
for(let i=0;i<40;i++){const r=bound.execute(seed,base('PAX-MISS-'+i,'MISSING-'+i,'inspect','object',t0));assert(r.ok);}
const snap=bound.snapshot(seed);assert(snap.resultCount<=Pipeline.MAX_RESULTS);assert(snap.activeCount<=Pipeline.MAX_ACTIVE);assert(snap.serializedBytes<=Pipeline.MAX_LEDGER_BYTES);assert.equal(snap.fullWorldScan,false);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.perFrameScan,false);assert.equal(snap.directWorldMutation,false);assert.equal(snap.worldTruthCopied,false);

// End-to-end runtime/evaluator integration uses the same PAX identity while Simulation remains terminal authority.
global.WorldState=makeWorld();
global.CommandSetInterface=Object.freeze({validateProposal(snapshot,p){
  if(!snapshot?.targets?.interactions?.some(x=>x.id===p.parameters.interactionTargetId))return Object.freeze({ok:false,reason:'target-unavailable'});
  return Object.freeze({ok:true,status:'validated',reason:'proposal-valid',commandId:p.commandId,snapshotId:snapshot.snapshotId,proposalId:p.proposalId,source:p.source,validatedParameters:Object.freeze({...p.parameters})});
}});
const evaluatorPath=path.join(repoRoot,'scripts/world/protagonist-command-evaluator.js');
delete require.cache[require.resolve(evaluatorPath)];
const Evaluator=require(evaluatorPath);
const runtimePath=path.join(repoRoot,'scripts/world/protagonist-action-runtime.js');
delete require.cache[require.resolve(runtimePath)];
const Runtime=require(runtimePath);
const rt=Runtime.createRuntime({evaluator:Evaluator});
const commandSnapshot={snapshotId:'SNAP-WP3',context:{seed,when:t0,origin:pos},targets:{people:[{id:'R1'}],places:[],routes:[],interactions:[{id:'OBJ-WORK',personIds:['R1'],objectType:'workbench',action:'work',position:pos}]}};
const scheduled=rt.schedule({seed,when:t0,snapshot:commandSnapshot,actorPosition:pos,decisionContext:{value:0.99,urgency:0.99,socialAcceptability:0.99},proposal:{proposalId:'PROP-RUNTIME',commandId:'advisor.propose_interaction',parameters:{personId:'R1',interactionTargetId:'OBJ-WORK'},source:'autonomous-runtime'}});
assert(scheduled.ok);
const tick0=rt.tick({seed,when:t0});assert.equal(tick0.processed[0].state,'running');assert.equal(tick0.processed[0].evaluatorResult.execution.delegate,'ProtagonistInteractionPipeline -> ObjectInteractions/ActionExecutor');
const pipelineActive=Pipeline.list(seed,{status:'active'});assert.equal(pipelineActive.length,1);assert.equal(pipelineActive[0].externalKey,scheduled.attempt.attemptId);
const tick6=rt.tick({seed,when:t6});assert.equal(tick6.processed[0].state,'succeeded');assert.equal(Pipeline.list(seed,{status:'terminal-success'}).length,1);

console.log(JSON.stringify({
  wp:'WP-S010-003',classification:'FUNCTIONAL',
  visual:'N/A — persistent interaction attempt/result authority adds no rendered surface',
  pass:true,version:Pipeline.VERSION,
  object:{attemptId:started.interaction.attemptId,resultId:done.interaction.resultId,statuses:['active','terminal-success']},
  buildingStatus:building.interaction.status,personStatuses:[pending.interaction.status,failed.interaction.status],
  unavailableStatus:unavailable.interaction.status,rejectedStatus:rejected.interaction.status,
  forgedSuccessSuppressed:forged.claimedCompletionSuppressed,duplicateIdempotence:true,saveReloadContinuity:true,
  deterministicReplay:true,runtimeIntegration:{runtimeAttemptId:scheduled.attempt.attemptId,states:['running','succeeded'],delegate:tick0.processed[0].evaluatorResult.execution.delegate},
  bounds:snap.bounds,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,directWorldMutation:false,worldTruthCopied:false
},null,2));
