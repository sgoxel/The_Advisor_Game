const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{}))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k],v):clone(v);return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return (h>>>0).toString(16).toUpperCase().padStart(8,'0');}

const stores=new Map();
function fresh(seed){return {schema:'CampaignStateDelta',seed,sequence:0,entries:{}};}
function ensure(seed){if(!stores.has(seed))stores.set(seed,fresh(seed));return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return {id:`STR|${String(kind).toUpperCase()}|${hash([seed,kind,parent,key].join('|'))}`,kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const state=ensure(seed),entry=state.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry,currentSignature:hash(JSON.stringify(entry?.changes||{}))};},
  applyDelta(seed,ref,changes,reason){const state=ensure(seed),prev=state.entries[ref.id];state.sequence++;state.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:state.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:'ok',entry:clone(state.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,serialized){stores.set(String(campaign.seed),clone(serialized));return {ok:true};}
};

const seed='WP-S009-003-SEED-A';
const otherSeed='WP-S009-003-SEED-B';
global.ProtagonistProfile={derive(s,key='protagonist'){return {protagonistId:'PROTAGONIST-'+hash(s+'|'+key+'|identity-v1')}}};
let now='1201-03-02 09:00:00';
global.GameTime={getTimestampKey(){return now;}};

const modulePath=path.resolve(__dirname,'../world/protagonist-goals.js');
delete require.cache[modulePath];
const Goals=require(modulePath);
assert(Goals,'ProtagonistGoals should attach to window');

assert.equal(Goals.clear(seed).ok,true);
const g1=Goals.create(seed,{goalType:'duty',topic:'Deliver the sealed letter',priority:40,source:{kind:'duty',id:'DUTY-1'},targetRef:{kind:'settlement',id:'SET-1'},historyLinks:['CTX-1']});
assert.equal(g1.ok,true);
const duplicate=Goals.create(seed,{goalType:'duty',topic:'Deliver the sealed letter',priority:40,source:{kind:'duty',id:'DUTY-1'},targetRef:{kind:'settlement',id:'SET-1'},historyLinks:['CTX-1']});
assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.record.id,g1.record.id,'duplicate create must preserve stable goal ID');

now='1201-03-02 09:05:00';
const g2=Goals.create(seed,{goalType:'personal',topic:'Find a safe place to rest',priority:90,source:{kind:'self'},deadlineFantasyTimestamp:'1201-03-02 20:00:00'});
now='1201-03-02 09:10:00';
const g3=Goals.create(seed,{goalType:'advisor',topic:'Ask the miller about work',priority:70,source:{kind:'advisor',id:'ADV-4'}});
assert(g2.ok&&g3.ok);
const ordered=Goals.list(seed,{status:'active',limit:16});
assert.deepStrictEqual(ordered.map(x=>x.id),[g2.record.id,g3.record.id,g1.record.id],'priority query ordering must be deterministic');

now='1201-03-02 09:15:00';
const deferred=Goals.defer(seed,g3.record.id,{reason:'Wait until the mill opens',historyLinks:['CTX-2']});
assert.equal(deferred.ok,true);assert.equal(deferred.record.status,'deferred');
now='1201-03-02 10:00:00';
const reactivated=Goals.activate(seed,g3.record.id,{reason:'Mill is open'});
assert.equal(reactivated.ok,true);assert.equal(reactivated.record.status,'active');

const falseComplete=Goals.complete(seed,g1.record.id,{fantasyTimestamp:'1201-03-02 10:05:00',completed:true,simulationResultId:'CLAIMED-ONLY'});
assert.equal(falseComplete.ok,false);assert.equal(falseComplete.reason,'authoritative-simulation-evidence-required');
assert.equal(Goals.get(seed,g1.record.id).status,'active','false completion claim must not mutate status');

const forged=Goals.complete(seed,g1.record.id,{fantasyTimestamp:'1201-03-02 10:06:00',evidence:{source:'Conversation',authoritative:true,ok:true,status:'completed',simulationResultId:'FAKE-1'}});
assert.equal(forged.ok,false,'non-Simulation completion evidence must fail closed');

const completed=Goals.complete(seed,g1.record.id,{fantasyTimestamp:'1201-03-02 10:10:00',reason:'Letter accepted by recipient',historyLinks:['PCE-22'],evidence:{source:'Simulation',authoritative:true,ok:true,status:'completed',simulationResultId:'PCE-22',authoritativeResultId:'RESULT-22'}});
assert.equal(completed.ok,true);assert.equal(completed.record.status,'completed');assert.equal(completed.record.completion.simulationResultId,'PCE-22');

const terminalUpdate=Goals.update(seed,g1.record.id,{priority:99,fantasyTimestamp:'1201-03-02 10:11:00'});
assert.equal(terminalUpdate.ok,false);assert.equal(terminalUpdate.reason,'terminal-goal');

const updated=Goals.update(seed,g2.record.id,{priority:95,reason:'Fatigue pressure increased',historyLinks:['NEED-1'],fantasyTimestamp:'1201-03-02 10:12:00'});
assert.equal(updated.ok,true);assert.equal(updated.record.priority,95);assert(updated.record.historyLinks.includes('NEED-1'));

const saved=global.WorldState.serializeState(seed);
const beforeReload=Goals.snapshot(seed);
stores.set(seed,fresh(seed));
assert.equal(Goals.snapshot(seed).recordCount,0,'fresh campaign state should have no persisted goals before restore');
assert.equal(global.WorldState.restoreSerializedState({seed},saved).ok,true);
const afterReload=Goals.snapshot(seed);
assert.deepStrictEqual(afterReload.records,beforeReload.records,'save/reload must preserve goal records exactly');
assert.equal(afterReload.protagonistId,beforeReload.protagonistId);

assert.equal(Goals.clear(otherSeed).ok,true);
const other=Goals.create(otherSeed,{goalType:'personal',topic:'Explore the ridge',priority:60,source:{kind:'self'}});
assert.equal(other.ok,true);assert.equal(Goals.snapshot(otherSeed).recordCount,1);
assert.equal(Goals.snapshot(seed).recordCount,3,'other campaign must not affect original campaign goals');

let i=0;
while(Goals.snapshot(seed).recordCount<Goals.MAX_GOALS){
  now='1201-03-03 08:00:00';
  const r=Goals.create(seed,{goalType:'fixture',topic:'Bounded fixture goal '+i,priority:i%101,source:{kind:'event',id:'EV-'+i},externalKey:'FIX-'+i});
  assert.equal(r.ok,true,'bounded fixture create failed before cap: '+i);i++;
}
const overflow=Goals.create(seed,{goalType:'fixture',topic:'One beyond the cap',priority:1,source:{kind:'event',id:'OVERFLOW'},externalKey:'OVERFLOW'});
assert.equal(overflow.ok,false);assert.equal(overflow.reason,'goal-limit-reached');
const boundedQuery=Goals.list(seed,{limit:999});
assert.equal(boundedQuery.length,Goals.MAX_QUERY_RESULTS,'query limit must remain bounded');

const snap=Goals.snapshot(seed);
assert.equal(snap.recordCount,Goals.MAX_GOALS);
assert(snap.serializedBytes<=Goals.MAX_LEDGER_BYTES,'goal ledger exceeded byte budget');
assert.equal(snap.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(snap.chronologyAuthority,'Fantasy Game Time');
assert.equal(snap.fullWorldScan,false);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.boundedGoalScan,true);
assert.equal(snap.directMovement,false);assert.equal(snap.directActionExecution,false);assert.equal(snap.unrelatedWorldMutation,false);assert.equal(snap.goalMetadataMutationOnly,true);

const repoRoot=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const goalScript='scripts/world/protagonist-goals.js?v=protagonist-goals-v1';
assert(html.includes(goalScript),'canonical root must load ProtagonistGoals');
assert(html.indexOf(goalScript)>html.indexOf('scripts/world/protagonist-profile.js?v=protagonist-profile-v1'),'goals should load after immutable profile foundation');
assert(html.indexOf(goalScript)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'),'goals should load before Advisor consumers');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.']){
  assert(!source.includes(forbidden),'forbidden uncontrolled/presentation authority reference: '+forbidden);
}
assert(source.includes('completion:"Simulation-backed evidence only"'),'completion authority contract missing');
assert(source.includes('fullWorldScan:false')&&source.includes('wholeHistoryScan:false'),'bounded scan diagnostics missing');

console.log(JSON.stringify({
  wp:'WP-S009-003',classification:'FUNCTIONAL',visual:'N/A — persistent goal metadata/authority adds no rendered surface',pass:true,
  stableGoalIds:true,priorityOrdering:true,deferReactivate:true,falseCompletionRejected:true,simulationCompletion:true,
  saveReload:true,campaignIsolation:true,duplicateIdempotence:true,boundedRetention:true,
  recordCount:snap.recordCount,maxGoals:Goals.MAX_GOALS,queryLimit:Goals.MAX_QUERY_RESULTS,
  serializedBytes:snap.serializedBytes,maxLedgerBytes:Goals.MAX_LEDGER_BYTES,
  persistenceAuthority:snap.persistenceAuthority,chronologyAuthority:snap.chronologyAuthority,
  fullWorldScan:snap.fullWorldScan,wholeHistoryScan:snap.wholeHistoryScan,directActionExecution:snap.directActionExecution
},null,2));