const assert=require('assert');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{}))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k],v):clone(v);return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return (h>>>0).toString(16).toUpperCase().padStart(8,'0');}

const stores=new Map();
let activeSeed='WP006-SEED-A';
function ensure(seed){if(!stores.has(seed))stores.set(seed,{seed,sequence:0,entries:{}});return stores.get(seed);}

global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return {id:`STR|${String(kind).toUpperCase()}|${hash([seed,kind,parent,key].join('|'))}`,kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const state=ensure(seed),entry=state.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry,currentSignature:hash(JSON.stringify(entry?.changes||{}))};},
  applyDelta(seed,ref,changes,reason){const state=ensure(seed),prev=state.entries[ref.id];state.sequence++;state.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:state.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:'ok',entry:clone(state.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,serialized){stores.set(String(campaign.seed),clone(serialized));return {ok:true};},
  bindCampaign(campaign){activeSeed=String(campaign.seed);ensure(activeSeed);return {ok:true};}
};
global.SeedSystem={getCampaign(){return {seed:activeSeed}}};
let now='1201-03-02 09:00:00';
global.GameTime={getTimestampKey(){return now;}};

require(path.resolve(__dirname,'../world/conversation-transactions.js'));
const Ledger=global.ConversationTransactions;
assert(Ledger,'ConversationTransactions should attach to window');

function baseRecord(i,overrides={}){
  return {
    fantasyTimestamp:`1201-03-${String(2+Math.floor(i/24)).padStart(2,'0')} ${String(i%24).padStart(2,'0')}:00:00`,
    message:{messageId:`M-${i}`,referenceId:`REF-${i}`,role:'player',text:`Message ${i}`},
    routing:{mode:'local',recognizedIntentIds:[`intent.${i%3}`]},
    ...overrides
  };
}

assert.equal(Ledger.clear(activeSeed).ok,true);
const local=Ledger.append(activeSeed,baseRecord(0,{links:{characterMemoryIds:['MEM-1'],advisorChannelIds:['ADV-1']}}));
assert.equal(local.ok,true);
assert.equal(local.record.message.referenceId,'REF-0','message reference metadata must persist');
const rejected=Ledger.append(activeSeed,baseRecord(1,{proposalId:'P-1',decisionId:'D-REJECT',outcome:{completed:true}}));
assert.equal(rejected.record.outcome.state,'unexecuted','claimed completion without Simulation evidence must be suppressed');
assert.equal(rejected.record.outcome.claimedCompletionSuppressed,true);
const completed=Ledger.append(activeSeed,baseRecord(2,{proposalId:'P-2',decisionId:'D-ACCEPT',simulationResult:{executionId:'EX-2',actionExecuted:true,state:'completed',ok:true,authoritativeResultId:'AR-2'}}));
assert.equal(completed.record.outcome.state,'completed');
assert.equal(completed.record.outcome.simulationResultId,'EX-2');
assert.equal(completed.record.outcome.authoritativeResultId,'AR-2');

const duplicate=Ledger.append(activeSeed,baseRecord(2,{proposalId:'P-2',decisionId:'D-ACCEPT',simulationResult:{executionId:'EX-2',actionExecuted:true,state:'completed',ok:true,authoritativeResultId:'AR-2'}}));
assert.equal(duplicate.duplicate,true);
assert.equal(duplicate.record.id,completed.record.id);

assert.equal(Ledger.get(activeSeed,local.record.id).id,local.record.id);
assert(Ledger.list(activeSeed,{limit:2}).length<=2);

const saved=WorldState.serializeState(activeSeed);
const savedJson=JSON.stringify(saved);
assert(savedJson.includes('conversationTransactions'));
const before=Ledger.snapshot(activeSeed);
stores.set(activeSeed,{seed:activeSeed,sequence:0,entries:{}});
assert.equal(Ledger.snapshot(activeSeed).recordCount,0);
WorldState.restoreSerializedState({seed:activeSeed},saved);
const after=Ledger.snapshot(activeSeed);
assert.deepEqual(after.records,before.records,'save/reload must preserve chronology, IDs, and outcome references');
assert.equal(after.records.find(r=>r.id===rejected.record.id).outcome.state,'unexecuted');

WorldState.bindCampaign({seed:'WP006-SEED-B'});
assert.equal(Ledger.snapshot('WP006-SEED-B').recordCount,0);
WorldState.bindCampaign({seed:'WP006-SEED-A'});
assert.deepEqual(Ledger.snapshot('WP006-SEED-A').records,before.records);

Ledger.clear(activeSeed);
for(let i=0;i<Ledger.MAX_RECORDS+9;i++){
  const result=Ledger.append(activeSeed,baseRecord(i));
  assert.equal(result.ok,true);
}
const bounded=Ledger.snapshot(activeSeed);
assert.equal(bounded.recordCount,Ledger.MAX_RECORDS);
assert(bounded.serializedBytes<=Ledger.MAX_LEDGER_BYTES);
assert.equal(bounded.records[0].message.messageId,'M-9','oldest nine rows should be pruned deterministically');
assert.equal(bounded.records.at(-1).message.messageId,`M-${Ledger.MAX_RECORDS+8}`);

Ledger.clear(activeSeed);
for(let i=0;i<Ledger.MAX_RECORDS;i++)Ledger.append(activeSeed,baseRecord(i,{message:{messageId:`BIG-${i}`,role:'player',text:'x'.repeat(5000)}}));
const byteBounded=Ledger.snapshot(activeSeed);
assert(byteBounded.serializedBytes<=Ledger.MAX_LEDGER_BYTES);
assert(byteBounded.records.every(r=>r.message.text.length<=Ledger.MAX_DIALOGUE_CHARS));

const safe=Ledger.append(activeSeed,baseRecord(80,{apiKey:'SECRET',camera:{x:1},renderState:{gpu:'x'},providerPayload:{raw:'secret'},routing:{mode:'external-fallback',recognizedIntentIds:['intent.safe'],externalProviderUsed:true}}));
const safeJson=JSON.stringify(safe.record);
assert(!safeJson.includes('SECRET'));
assert(!safeJson.includes('\"providerPayload\":'));
assert(!safeJson.includes('\"camera\":'));
assert(!safeJson.includes('\"renderState\":'));
assert.equal(safe.record.authority.providerStatePersisted,false);
assert.equal(safe.record.authority.renderStatePersisted,false);
assert.equal(safe.record.authority.cameraStatePersisted,false);

const ctxRef=WorldState.structuralRef(activeSeed,Ledger.REGISTRY_KIND,'WORLD',Ledger.REGISTRY_KEY,{role:'advisor-conversation-history',authority:'ConversationTransactions registry foundation'});
const state=ensure(activeSeed);
state.entries[ctxRef.id].changes.conversationTransactions.schemaVersion=999;
const incompatible=Ledger.snapshot(activeSeed);
assert.equal(incompatible.compatible,false);
assert.equal(incompatible.recordCount,0);
assert.equal(Ledger.append(activeSeed,baseRecord(90)).ok,false);
assert.equal(Ledger.append(activeSeed,baseRecord(90)).reason,'ledger-incompatible');

stores.set(activeSeed,{seed:activeSeed,sequence:0,entries:{}});
const malformedSeed='WP006-MALFORMED';
WorldState.bindCampaign({seed:malformedSeed});
Ledger.append(malformedSeed,baseRecord(0));
const malformedRef=WorldState.structuralRef(malformedSeed,Ledger.REGISTRY_KIND,'WORLD',Ledger.REGISTRY_KEY,{role:'advisor-conversation-history',authority:'ConversationTransactions registry foundation'});
ensure(malformedSeed).entries[malformedRef.id].changes.conversationTransactions.records[0].outcome={state:'completed',simulationResultId:null,authoritativeResultId:null,authoritativeExecution:true,claimedCompletionSuppressed:false};
assert.equal(Ledger.snapshot(malformedSeed).compatible,false,'malformed completed record must fail safely');
assert.equal(Ledger.append(malformedSeed,baseRecord(1)).reason,'ledger-incompatible');
WorldState.bindCampaign({seed:'WP006-SEED-A'});
stores.set(activeSeed,{seed:activeSeed,sequence:0,entries:{}});
const evalRejected=Ledger.fromEvaluation(activeSeed,{messageId:'EV-1',role:'player',text:'Try it.'},{mode:'local',recognizedIntentIds:['intent.interaction']},{when:'1201-04-01 10:00:00',decisionId:'PCD-1',executionId:'PCE-1',proposal:{proposalId:'PCP-1'},execution:{attempted:false,state:'not-run',actionExecuted:false}});
const evalActive=Ledger.fromEvaluation(activeSeed,{messageId:'EV-2',role:'player',text:'Use it.'},{mode:'local',recognizedIntentIds:['intent.interaction']},{when:'1201-04-01 10:01:00',decisionId:'PCD-2',executionId:'PCE-2',proposal:{proposalId:'PCP-2'},execution:{attempted:true,state:'active',actionExecuted:true,authoritativeResult:{ok:true,id:'ACT-2',status:'active'}}});
const evalDone=Ledger.fromEvaluation(activeSeed,{messageId:'EV-3',role:'player',text:'Finish it.'},{mode:'local',recognizedIntentIds:['intent.interaction']},{when:'1201-04-01 10:02:00',decisionId:'PCD-3',executionId:'PCE-3',proposal:{proposalId:'PCP-3'},execution:{attempted:true,state:'complete',actionExecuted:true,authoritativeResult:{ok:true,id:'ACT-3',status:'complete'}}});
assert.equal(evalRejected.record.outcome.state,'unexecuted');
assert.equal(evalActive.record.outcome.state,'unexecuted','active Simulation state must not be labeled completed');
assert.equal(evalDone.record.outcome.state,'completed');
assert.equal(evalDone.record.outcome.simulationResultId,'PCE-3');

const finalSnap=Ledger.snapshot(activeSeed);
assert.equal(finalSnap.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(finalSnap.chronologyAuthority,'Fantasy Game Time');
assert.equal(finalSnap.fullWorldScan,false);
assert.equal(finalSnap.wholeCampaignScan,false);
assert.equal(finalSnap.indexedById,true);
assert.equal(finalSnap.bounded,true);

console.log(JSON.stringify({
  wp:'WP-S008-006',classification:'FUNCTIONAL',visual:'N/A — bounded persistence/runtime authority adds no rendered surface',
  pass:true,stableIds:true,saveReload:true,leaveReturn:true,unexecutedPreserved:true,authoritativeCompletionOnly:true,
  maxRecords:Ledger.MAX_RECORDS,maxLedgerBytes:Ledger.MAX_LEDGER_BYTES,recordCount:finalSnap.recordCount,
  persistenceAuthority:finalSnap.persistenceAuthority,chronologyAuthority:finalSnap.chronologyAuthority,
  indexedById:true,fullWorldScan:false,wholeCampaignScan:false,providerStatePersisted:false,renderStatePersisted:false,cameraStatePersisted:false
},null,2));
