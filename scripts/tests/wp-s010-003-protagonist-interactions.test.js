'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-interactions.js');
const source=fs.readFileSync(modulePath,'utf8');
assert(source.includes('VERSION="protagonist-interactions-v1"'),'interaction pipeline version marker missing');
assert(source.includes('MAX_RECORDS=16'),'bounded record cap missing');
assert(source.includes('MAX_LEDGER_BYTES=48*1024'),'bounded ledger byte cap missing');
assert(!source.includes('Math.random('),'interaction pipeline must not use Math.random');
assert(source.includes('fullWorldScan:false')&&source.includes('wholeHistoryScan:false')&&source.includes('directWorldMutation:false'),'authority boundary markers missing');

const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const pipelineScript='scripts/world/protagonist-interactions.js?v=protagonist-interactions-v1';
assert(index.includes(pipelineScript),'canonical root must load ProtagonistInteractionPipeline');
assert(index.indexOf(pipelineScript)>index.indexOf('scripts/world/protagonist-command-evaluator.js?v=protagonist-command-evaluator-v1'),'pipeline must load after evaluator definition');
assert(index.indexOf(pipelineScript)<index.indexOf('scripts/world/protagonist-action-runtime.js?v=protagonist-action-runtime-v1'),'pipeline must load before autonomous runtime execution');

function makeWorld(){
  const stores=new Map();
  const ensure=seed=>{if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);};
  return {
    structuralRef(seed,kind,parent,key){return {id:'STR|'+kind+'|'+parent+'|'+key,kind,key:{seed,parent,key}};},
    resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id];return {current:entry?JSON.parse(JSON.stringify(entry.current)):null,delta:entry?{revision:entry.revision}:null};},
    applyDelta(seed,ref,changes,reason){const s=ensure(seed),prior=s.entries[ref.id],revision=(prior?.revision||0)+1;const current={...(prior?.current||{}),...JSON.parse(JSON.stringify(changes))};s.entries[ref.id]={revision,current,reason};s.sequence++;return {ok:true,reason:'ok',entry:{revision}};},
    serializeState(seed){return JSON.parse(JSON.stringify(ensure(seed)));},
    clear(seed){stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});},
    restoreSerializedState(seed,raw){stores.set(seed,JSON.parse(JSON.stringify(raw)));return {ok:true};},
    sequence(seed){return ensure(seed).sequence;}
  };
}

const actionStates=new Map();let objectAttempts=0,actionExecutorCalls=0,personAttempts=0;
function contextFor(id,position){
  if(id==='MISSING')return null;
  const isDoor=id.endsWith(':door');
  const action=isDoor?'inspect':(id==='OBJ-REJECT'?'inspect':'work');
  return {id,buildingId:isDoor?id.slice(0,-5):'BLD-WORK',actions:[{id:action,enabled:true,reason:'ready',target:position||{x:'0',y:'0'}}]};
}
const objectInteractions={
  context(seed,id,position){return contextFor(id,position);},
  attempt(seed,request){
    objectAttempts++;
    const ctx=contextFor(request.objectId,request.actorPosition);if(!ctx)return {ok:false,status:'rejected',reason:'unknown-object',objectId:request.objectId,action:request.action,authoritative:true};
    const supported=ctx.actions.some(a=>a.id===request.action);if(!supported)return {ok:false,status:'rejected',reason:'unsupported-action',objectId:request.objectId,action:request.action,authoritative:true};
    if(request.action==='inspect')return {ok:true,status:'complete',reason:'inspected',objectId:request.objectId,buildingId:ctx.buildingId,action:'inspect',authoritative:true};
    actionExecutorCalls++;
    const key=request.actorId+'|'+request.objectId+'|'+request.action,elapsed=(actionStates.get(key)||0)+Math.max(0,Number(request.advanceSeconds)||0);actionStates.set(key,elapsed);
    if(elapsed>=6)return {ok:true,status:'complete',reason:'compatible',objectId:request.objectId,buildingId:ctx.buildingId,action:request.action,actionState:{completedSequence:7},authoritative:true};
    return {ok:true,status:'active',reason:'compatible',objectId:request.objectId,buildingId:ctx.buildingId,action:request.action,actionState:{elapsedSeconds:elapsed},authoritative:true};
  }
};
const personInteractions={
  context(seed,id){if(id==='P-MISSING')return null;return {id,actions:[{id:'social',enabled:true,reason:'ready'}]};},
  attempt(seed,request,seconds){personAttempts++;if(request.personId==='P-FORGE')return {ok:true,status:'complete',reason:'claimed',personId:request.personId,action:'social',authoritative:false};return {ok:true,status:'complete',reason:'conversation-complete',personId:request.personId,action:'social',authoritative:true,evidenceId:'SIM-A1B2C3D4'};}
};
function ts(second){return '1201-09-30 17:00:'+String(second).padStart(2,'0');}
const Pipeline=require(modulePath);
assert.equal(Pipeline.VERSION,'protagonist-interactions-v1');
const seed='AGENT6-WP-S010-003',world=makeWorld(),svc=Pipeline.createService({worldState:world,objectInteractions,personInteractions});
const pos={x:'0',y:'0',level:0};

const started=svc.execute(seed,{when:ts(0),targetKind:'object',targetId:'OBJ-USE',action:'work',actorPosition:pos,externalKey:'RUN-OBJECT',proposalId:'PROP-1',decisionId:'DEC-1',evaluatorExecutionId:'EX-1',actionRuntimeAttemptId:'PAX-1',conversationTransactionId:'CTX-1'});
assert(started.ok);assert.equal(started.status,'active');assert.equal(started.terminal,false);assert.equal(started.terminalSuccess,false);const objectAttemptId=started.record.attemptId;
const done=svc.advance(seed,{when:ts(6),attemptId:objectAttemptId,actorPosition:pos,proposalId:'PROP-1',decisionId:'DEC-1',evaluatorExecutionId:'EX-2',actionRuntimeAttemptId:'PAX-1'});
assert(done.ok);assert.equal(done.status,'succeeded');assert.equal(done.terminal,true);assert.equal(done.terminalSuccess,true);assert(/^SIM-[0-9A-F]{8}$/.test(done.authoritativeEvidenceId));assert(actionExecutorCalls>=2);
const objectRecord=svc.get(seed,objectAttemptId);assert.deepEqual(objectRecord.references.proposalIds,['PROP-1']);assert.deepEqual(objectRecord.references.actionRuntimeAttemptIds,['PAX-1']);assert.deepEqual(objectRecord.references.conversationTransactionIds,['CTX-1']);assert.equal(objectRecord.result.worldTruthCopied,false);

const seqBeforeDup=world.sequence(seed);const dup=svc.execute(seed,{when:ts(9),targetKind:'object',targetId:'OBJ-USE',action:'work',actorPosition:pos,externalKey:'RUN-OBJECT',proposalId:'PROP-1',actionRuntimeAttemptId:'PAX-1'});
assert(dup.ok&&dup.duplicate);assert.equal(dup.record.attemptId,objectAttemptId);assert.equal(world.sequence(seed),seqBeforeDup);

const building=svc.execute(seed,{when:ts(10),targetKind:'building',targetId:'BLD-1',action:'inspect',actorPosition:pos,externalKey:'RUN-BUILDING'});
assert(building.ok);assert.equal(building.status,'succeeded');assert.equal(building.record.objectId,'BLD-1:door');assert.equal(building.terminalSuccess,true);

const person=svc.execute(seed,{when:ts(11),targetKind:'person',targetId:'P1',action:'social',actorPosition:pos,externalKey:'RUN-PERSON'});
assert(person.ok);assert.equal(person.status,'succeeded');assert.equal(person.authoritativeEvidenceId,'SIM-A1B2C3D4');assert.equal(personAttempts,1);

const unavailable=svc.execute(seed,{when:ts(12),targetKind:'object',targetId:'MISSING',action:'work',actorPosition:pos,externalKey:'RUN-MISSING'});
assert(unavailable.ok);assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.terminalSuccess,false);assert.equal(unavailable.authoritativeEvidenceId,null);
const rejected=svc.execute(seed,{when:ts(13),targetKind:'object',targetId:'OBJ-REJECT',action:'teleport',actorPosition:pos,externalKey:'RUN-REJECT'});
assert(rejected.ok);assert.equal(rejected.status,'rejected');assert.equal(rejected.terminalSuccess,false);

const forged=svc.execute(seed,{when:ts(14),targetKind:'person',targetId:'P-FORGE',action:'social',actorPosition:pos,externalKey:'RUN-FORGE',claimedResult:{ok:true,status:'complete'}});
assert(forged.ok);assert.equal(forged.status,'failed');assert.equal(forged.terminalSuccess,false);assert.equal(forged.authoritativeEvidenceId,null);assert.equal(forged.record.result.reason,'non-authoritative-success-suppressed');

const reloadSeed=seed+'-RELOAD',reloadWorld=makeWorld(),reloadSvc=Pipeline.createService({worldState:reloadWorld,objectInteractions,personInteractions});
const active=reloadSvc.execute(reloadSeed,{when:ts(0),targetKind:'object',targetId:'OBJ-RELOAD',action:'work',actorPosition:pos,externalKey:'RUN-RELOAD'});assert.equal(active.status,'active');
const saved=reloadWorld.serializeState(reloadSeed),activeId=active.record.attemptId;reloadWorld.clear(reloadSeed);reloadWorld.restoreSerializedState(reloadSeed,saved);
const afterReload=Pipeline.createService({worldState:reloadWorld,objectInteractions,personInteractions}).advance(reloadSeed,{when:ts(6),attemptId:activeId,actorPosition:pos});
assert(afterReload.ok);assert.equal(afterReload.status,'succeeded');assert.equal(afterReload.terminalSuccess,true);

const rewindSeed=seed+'-REWIND',rewindWorld=makeWorld(),rewindSvc=Pipeline.createService({worldState:rewindWorld,objectInteractions,personInteractions});
const rew=rewindSvc.execute(rewindSeed,{when:ts(6),targetKind:'object',targetId:'OBJ-R',action:'work',actorPosition:pos,externalKey:'RUN-R'});assert.equal(rew.status,'active');const rewSeq=rewindWorld.sequence(rewindSeed);
const rewind=rewindSvc.advance(rewindSeed,{when:ts(5),attemptId:rew.record.attemptId,actorPosition:pos});assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-interaction-chronology');assert.equal(rewindWorld.sequence(rewindSeed),rewSeq);

for(let i=0;i<Pipeline.MAX_RECORDS+4;i++){
  const r=svc.execute(seed,{when:'1201-09-30 18:'+String(i).padStart(2,'0')+':00',targetKind:'building',targetId:'BULK-'+i,action:'inspect',actorPosition:pos,externalKey:'BULK-'+i});assert(r.ok);
}
const snap=svc.snapshot(seed);assert(snap.recordCount<=Pipeline.MAX_RECORDS);assert(snap.serializedBytes<=Pipeline.MAX_LEDGER_BYTES);assert.equal(snap.fullWorldScan,false);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.perFrameScan,false);assert.equal(snap.directWorldMutation,false);assert.equal(snap.dialogueCompletionAuthority,false);assert.equal(snap.uiCompletionAuthority,false);assert.equal(snap.providerCompletionAuthority,false);assert.equal(snap.worldTruthCopied,false);

console.log(JSON.stringify({wp:'WP-S010-003',classification:'FUNCTIONAL',visual:'N/A — persistent Simulation interaction outcome authority adds no rendered surface',pass:true,version:Pipeline.VERSION,stableAttemptId:objectAttemptId,objectUseTerminalSuccess:true,buildingInteractionSuccess:true,personInteractionSuccess:true,unavailableState:unavailable.status,rejectedState:rejected.status,forgedSuccessSuppressed:forged.status==='failed',saveReloadContinuity:true,duplicateIdempotence:true,objectAttempts,actionExecutorCalls,personAttempts,bounds:{maxRecords:Pipeline.MAX_RECORDS,maxLedgerBytes:Pipeline.MAX_LEDGER_BYTES,maxAdvanceSeconds:Pipeline.MAX_ADVANCE_SECONDS},fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,directWorldMutation:false},null,2));