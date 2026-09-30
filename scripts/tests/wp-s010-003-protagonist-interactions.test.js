'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-interactions.js');
const source=fs.readFileSync(modulePath,'utf8');
assert(source.includes('VERSION="protagonist-interactions-v1"'));
assert(!source.includes('Math.random('));
assert(source.includes('MAX_HISTORY=16')&&source.includes('MAX_LEDGER_BYTES=64*1024'));
assert(source.includes('fullWorldScan:false')&&source.includes('directWorldMutation:false'));

function clone(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{})){if(v&&typeof v==='object'&&!Array.isArray(v))out[k]=merge(out[k],v);else out[k]=clone(v);}return out;}
function makeWorld(){
  const stores=new Map();
  function ensure(seed){if(!stores.has(seed))stores.set(seed,{sequence:0,entries:{}});return stores.get(seed);}
  return {
    structuralRef(seed,kind,parentId,key,initial){return {id:`STR|${kind}|${parentId}|${key}`,kind,key:{parentId,structuralKey:key,initial:clone(initial)}};},
    resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id],foundation={id:ref.id,kind:ref.kind,parentId:ref.key.parentId,structuralKey:ref.key.structuralKey,initial:clone(ref.key.initial)};return {current:merge(foundation,entry?.changes||{}),delta:entry||null};},
    applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;const entry={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};s.entries[ref.id]=entry;return {ok:true,reason:'ok',entry,resolved:this.resolve(seed,ref)};},
    serialize(seed){return clone(ensure(seed));},restore(seed,data){stores.set(seed,clone(data));},clear(seed){stores.set(seed,{sequence:0,entries:{}});},sequence(seed){return ensure(seed).sequence;}
  };
}
function ts(sec){const d=new Date(Date.UTC(1201,8,30,17,0,sec));const p=n=>String(n).padStart(2,'0');return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;}
const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const scriptTag='scripts/world/protagonist-interactions.js?v=protagonist-interactions-v1';
assert(index.includes(scriptTag),'canonical root must load ProtagonistInteractions');
assert(index.indexOf(scriptTag)>index.indexOf('scripts/world/protagonist-journey.js?v=protagonist-journey-v1'));
assert(index.indexOf(scriptTag)<index.indexOf('scripts/world/conversation-transactions.js?v=conversation-transactions-v2'));
const objectInteractionSource=fs.readFileSync(path.join(repoRoot,'scripts/world/object-interactions.js'),'utf8');
assert(objectInteractionSource.includes('Number(request?.seconds)'),'ObjectInteractions must forward bounded progress seconds to ActionExecutor');
const Interactions=require(modulePath);
assert.equal(Interactions.VERSION,'protagonist-interactions-v1');
const seed='AGENT6-WP-S010-003',pos={x:'4',y:'7',level:0};

const calls=[];
const adapter={
  start(seedValue,row){calls.push(['start',row.target.kind,row.target.action]);
    if(row.target.id==='MISSING')return {ok:false,status:'unavailable',reason:'target-unavailable',authoritative:true};
    if(row.target.action==='forbidden')return {ok:false,status:'rejected',reason:'action-not-permitted',authoritative:true};
    if(row.target.action==='inspect'||row.target.action==='enter')return {ok:true,status:'complete',reason:'complete',authoritative:true,objectId:row.target.interactionTargetId||row.target.id,action:row.target.action,delegatesTo:'fixture-simulation'};
    return {ok:true,status:'active',reason:'active',authoritative:true,objectId:row.target.interactionTargetId||row.target.id,action:row.target.action,actionState:{elapsedSeconds:0,durationSeconds:6}};
  },
  advance(seedValue,row,seconds){calls.push(['advance',row.target.kind,row.target.action,seconds]);
    if(row.target.action==='fail')return {ok:true,status:'failed',reason:'simulation-failed',authoritative:true,objectId:row.target.id,action:row.target.action};
    if(row.target.action==='wait')return {ok:true,status:'active',reason:'still-active',authoritative:true,objectId:row.target.id,action:row.target.action,actionState:{elapsedSeconds:seconds,durationSeconds:99}};
    const total=Number(row.simulationElapsedSeconds||0)+seconds;return {ok:true,status:total>=6?'complete':'active',reason:total>=6?'completed':'active',authoritative:true,objectId:row.target.id,action:row.target.action,actionState:{elapsedSeconds:total,durationSeconds:6}};
  }
};
const world=makeWorld(),svc=Interactions.createService({worldState:world,adapter});
const links={conversationTransactionId:'CTX-AAA',actionAttemptId:'PAX-BBB',evaluatorExecutionId:'PCE-CCC',proposalId:'PROP-DDD',decisionId:'PCD-EEE'};

const inspect=svc.start(seed,{when:ts(0),targetKind:'object',targetId:'OBJ-1',interactionTargetId:'OBJ-1',action:'inspect',actorPosition:pos,links});
assert(inspect.ok);assert.equal(inspect.record.status,'succeeded');assert.equal(inspect.record.simulationEvidence.authoritative,true);assert.equal(inspect.record.simulationEvidence.terminal,true);assert.equal(inspect.record.links.conversationTransactionId,'CTX-AAA');

const building=svc.start(seed,{when:ts(1),targetKind:'building',targetId:'BLDG-1',buildingId:'BLDG-1',interactionTargetId:'BLDG-1:door',action:'enter',actorPosition:pos});
assert(building.ok);assert.equal(building.record.status,'succeeded');assert.equal(building.record.target.interactionTargetId,'BLDG-1:door');

const unavailable=svc.start(seed,{when:ts(2),targetKind:'person',targetId:'PERSON-404',action:'social',actorPosition:pos});
assert(unavailable.ok);assert.equal(unavailable.record.status,'active','fixture adapter accepts generic person; production fail-closed is verified below');
assert.equal(svc.advance(seed,{when:ts(8),actorPosition:pos}).record.status,'succeeded');

const missing=svc.start(seed,{when:ts(9),targetKind:'object',targetId:'MISSING',interactionTargetId:'MISSING',action:'inspect',actorPosition:pos});
assert(missing.ok);assert.equal(missing.record.status,'unavailable');
const rejected=svc.start(seed,{when:ts(10),targetKind:'object',targetId:'OBJ-2',interactionTargetId:'OBJ-2',action:'forbidden',actorPosition:pos});
assert(rejected.ok);assert.equal(rejected.record.status,'rejected');

const activeInput={when:ts(11),targetKind:'object',targetId:'OBJ-3',interactionTargetId:'OBJ-3',action:'work',actorPosition:pos,externalKey:'ACTION-1'};
const active=svc.start(seed,activeInput);assert(active.ok&&!active.duplicate);assert.equal(active.record.status,'active');
const dup=svc.start(seed,activeInput);assert(dup.ok&&dup.duplicate);assert.equal(dup.record.attemptId,active.record.attemptId);assert.equal(world.sequence(seed),7,'duplicate must not write another delta');
const p3=svc.advance(seed,{when:ts(14),actorPosition:pos});assert(p3.ok);assert.equal(p3.record.status,'active');assert.equal(p3.processedSeconds,3);

const saved=world.serialize(seed);const activeBefore=JSON.stringify(svc.snapshot(seed).active);world.clear(seed);world.restore(seed,saved);
const reloaded=Interactions.createService({worldState:world,adapter});assert.equal(JSON.stringify(reloaded.snapshot(seed).active),activeBefore);assert.equal('actorPosition' in reloaded.snapshot(seed).active,false);
const done=reloaded.advance(seed,{when:ts(17),actorPosition:pos});assert(done.ok);assert.equal(done.record.status,'succeeded');assert.equal(done.record.attemptId,active.record.attemptId);

const forgedStart=reloaded.start(seed,{when:ts(18),targetKind:'object',targetId:'OBJ-WAIT',interactionTargetId:'OBJ-WAIT',action:'wait',actorPosition:pos});assert.equal(forgedStart.record.status,'active');
const forged=reloaded.advance(seed,{when:ts(19),actorPosition:pos,claimedStatus:'succeeded'});assert.equal(forged.record.status,'active');assert.equal(forged.record.forgedSuccessSuppressed,true);assert.equal(forged.record.simulationEvidence.terminal,false);
assert(reloaded.clear(seed).ok);
const failure=reloaded.start(seed,{when:ts(20),targetKind:'object',targetId:'OBJ-FAIL',interactionTargetId:'OBJ-FAIL',action:'fail',actorPosition:pos});assert.equal(failure.record.status,'active');
const failed=reloaded.advance(seed,{when:ts(21),actorPosition:pos});assert.equal(failed.record.status,'failed');

const prodSeed=seed+'-PROD',prodWorld=makeWorld();let contextCalls=0,attemptCalls=0,elapsed=0;
global.ObjectInteractions={
  context(seedValue,id,actorPosition){contextCalls++;if(seedValue!==prodSeed||id!=='OBJ-PROD')return null;return {id,buildingId:'BLDG-PROD',actions:[{id:'work',enabled:true,reason:'ready',target:{x:'4',y:'7',level:0}}]};},
  attempt(seedValue,request){attemptCalls++;assert.equal(seedValue,prodSeed);assert.equal(request.objectId,'OBJ-PROD');elapsed+=Number(request.seconds||0);return {ok:true,status:elapsed>=6?'complete':'active',reason:elapsed>=6?'completed':'compatible',authoritative:true,objectId:'OBJ-PROD',action:'work',delegatesTo:'ActionExecutor',actionState:{elapsedSeconds:elapsed,durationSeconds:6}};}
};
global.ActionExecutor={get(){return elapsed?{elapsedSeconds:elapsed,interactionObjectId:'OBJ-PROD',action:'work'}:null;}};
const prod=Interactions.createService({worldState:prodWorld});
const prodStart=prod.start(prodSeed,{when:ts(0),targetKind:'building',targetId:'BLDG-PROD',buildingId:'BLDG-PROD',interactionTargetId:'OBJ-PROD',action:'work',actorPosition:pos});
assert.equal(prodStart.record.status,'active');const prodDone=prod.advance(prodSeed,{when:ts(6),actorPosition:pos,claimedStatus:'succeeded'});assert.equal(prodDone.record.status,'succeeded');assert(contextCalls>=2);assert.equal(attemptCalls,2);assert.equal(prodDone.record.simulationEvidence.delegatesTo,'ActionExecutor');

const personWorld=makeWorld(),person=Interactions.createService({worldState:personWorld});const beforeAttempts=attemptCalls;
const personResult=person.start(prodSeed+'-PERSON',{when:ts(0),targetKind:'person',targetId:'R-1',action:'social',actorPosition:pos});
assert.equal(personResult.record.status,'unavailable');assert.equal(personResult.record.reason,'person-interaction-requires-concrete-simulation-target');assert.equal(attemptCalls,beforeAttempts);

for(const snap of [reloaded.snapshot(seed),prod.snapshot(prodSeed),person.snapshot(prodSeed+'-PERSON')]){
  assert(snap.historyCount<=Interactions.MAX_HISTORY);assert(snap.serializedBytes<=Interactions.MAX_LEDGER_BYTES);assert.equal(snap.fullWorldScan,false);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.directWorldMutation,false);assert.equal(snap.conversationAuthority,false);assert.equal(snap.persistenceAuthority,'WorldState CampaignStateDelta');assert.equal(snap.chronologyAuthority,'Fantasy Game Time');
}
console.log(JSON.stringify({wp:'WP-S010-003',classification:'FUNCTIONAL',visual:'N/A — Simulation interaction ledger/outcome authority adds no rendered surface',pass:true,version:Interactions.VERSION,stableAttemptId:active.record.attemptId,stableTerminalResultId:done.record.resultId,objectSuccess:true,buildingSuccess:true,personWithoutConcreteTarget:'unavailable',unavailableTarget:true,rejectedAction:true,activePending:true,failedOutcome:true,forgedSuccessSuppressed:true,duplicateIdempotence:true,saveReloadContinuity:true,productionRevalidation:{contextCalls,attemptCalls,delegate:prodDone.record.simulationEvidence.delegatesTo},linksAreReferences:true,bounds:{maxHistory:Interactions.MAX_HISTORY,maxLedgerBytes:Interactions.MAX_LEDGER_BYTES,maxAdvanceSeconds:Interactions.MAX_ADVANCE_SECONDS},fullWorldScan:false,wholeHistoryScan:false,directWorldMutation:false,conversationAuthority:false},null,2));
