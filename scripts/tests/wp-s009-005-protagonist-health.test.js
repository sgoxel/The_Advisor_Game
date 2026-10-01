const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{}))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k],v):clone(v);return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,'0');}

const stores=new Map();
function fresh(seed){return {schema:'CampaignStateDelta',seed,sequence:0,entries:{}};}
function ensure(seed){if(!stores.has(seed))stores.set(seed,fresh(seed));return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return {id:'STR|'+String(kind).toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const state=ensure(seed),entry=state.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry};},
  applyDelta(seed,ref,changes,reason){const state=ensure(seed),prev=state.entries[ref.id];state.sequence++;state.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:state.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:'ok',entry:clone(state.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,serialized){stores.set(String(campaign.seed),clone(serialized));return {ok:true};}
};

const seed='WP-S009-005-SEED-A',otherSeed='WP-S009-005-SEED-B',identity='protagonist';
global.ProtagonistProfile={derive(s,key='protagonist'){return {protagonistId:'PROTAGONIST-'+hash(s+'|'+key+'|identity-v1')}}};
let now='1201-03-02 06:00:00';
global.GameTime={getTimestampKey(){return now;}};

const modulePath=path.resolve(__dirname,'../world/protagonist-health.js');
delete require.cache[modulePath];
const Health=require(modulePath);
assert(Health,'ProtagonistHealth should attach to window');
const sim=(operationId,extra={})=>({authority:'simulation',authoritative:true,operationId,fantasyTimestamp:now,...extra});

const init=Health.initialize(seed,identity,now);
assert.equal(init.ok,true);assert.equal(init.created,true);
const base=Health.snapshot(seed,identity);
assert.equal(base.exists,true);assert.equal(base.condition,'healthy');assert(base.fatigueMilli>=8000&&base.fatigueMilli<=14000);
assert.equal(base.activeInjuryCount,0);assert(base.serializedBytes<=Health.MAX_STATE_BYTES);
const initialSerialized=WorldState.serializeState(seed);

now='1201-03-02 07:00:00';
const hour1=Health.advance(seed,identity,now,sim('ADV-1',{activity:'normal'}));
assert.equal(hour1.ok,true);assert(hour1.snapshot.fatigueMilli>base.fatigueMilli,'normal activity should increase physical fatigue');
now='1201-03-02 08:00:00';
const hour2=Health.advance(seed,identity,now,sim('ADV-2',{activity:'normal'}));
assert.equal(hour2.ok,true);const chunkedFatigue=hour2.snapshot.fatigueMilli;

WorldState.restoreSerializedState({seed},initialSerialized);
now='1201-03-02 08:00:00';
const direct=Health.advance(seed,identity,now,sim('ADV-DIRECT',{activity:'normal'}));
assert.equal(direct.ok,true);assert.equal(direct.snapshot.fatigueMilli,chunkedFatigue,'same activity/time must be chunk invariant');

const beforeForged=Health.snapshot(seed,identity);
const forgedAdvance=Health.advance(seed,identity,'1201-03-02 08:30:00',{authority:'ui',authoritative:true,operationId:'UI-ADV',activity:'resting'});
assert.equal(forgedAdvance.ok,false);assert.equal(forgedAdvance.reason,'simulation-authority-required');
assert.deepStrictEqual(Health.snapshot(seed,identity).injuries,beforeForged.injuries);

now='1201-03-02 08:15:00';
const injury=Health.applyInjury(seed,identity,{kind:'sprain',bodyRegion:'left-ankle',severityMilli:40000,recoveryDurationSeconds:7200,sourceRef:{kind:'event',id:'FALL-1'}},sim('INJ-1',{activity:'normal'}));
assert.equal(injury.ok,true);assert(/^INJ-[0-9A-F]{8}$/.test(injury.injury.id));assert.equal(injury.snapshot.activeInjuryCount,1);assert(injury.snapshot.conditionMilli<direct.snapshot.conditionMilli);
const injuryId=injury.injury.id;
const duplicate=Health.applyInjury(seed,identity,{kind:'sprain',bodyRegion:'left-ankle',severityMilli:40000,recoveryDurationSeconds:7200},sim('INJ-1',{activity:'normal'}));
assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.snapshot.activeInjuryCount,1);

const beforeInvalid=Health.snapshot(seed,identity);
const negative=Health.applyInjury(seed,identity,{kind:'bruise',bodyRegion:'arm',severityMilli:-1,recoveryDurationSeconds:3600},sim('INJ-NEG'));
assert.equal(negative.ok,false);assert.equal(negative.reason,'invalid-injury-severity');
assert.deepStrictEqual(Health.snapshot(seed,identity).injuries,beforeInvalid.injuries,'invalid injury partially mutated state');
const forgedInjury=Health.applyInjury(seed,identity,{kind:'bruise',bodyRegion:'arm',severityMilli:10000,recoveryDurationSeconds:3600},{authority:'conversation',authoritative:true,operationId:'FAKE',fantasyTimestamp:now});
assert.equal(forgedInjury.ok,false);assert.equal(forgedInjury.reason,'simulation-authority-required');

const savedBeforeRecovery=WorldState.serializeState(seed);
now='1201-03-02 09:15:00';
const recoveryA=Health.advance(seed,identity,now,sim('REC-1',{activity:'resting'}));
assert.equal(recoveryA.ok,true);assert.equal(recoveryA.snapshot.activeInjuryCount,1);
const halfway=recoveryA.snapshot.injuries.find(x=>x.id===injuryId);
assert(halfway&&halfway.recoveryProgressMilli>=50000&&halfway.remainingSeverityMilli<40000,'injury recovery should progress from fantasy time');
assert(recoveryA.snapshot.fatigueMilli<injury.snapshot.fatigueMilli,'resting should reduce physical fatigue');

WorldState.restoreSerializedState({seed},savedBeforeRecovery);
now='1201-03-02 09:15:00';
const recoveryReplay=Health.advance(seed,identity,now,sim('REC-1',{activity:'resting'}));
assert.deepStrictEqual(recoveryReplay.snapshot.injuries,recoveryA.snapshot.injuries,'same saved state + operation + fantasy time should replay identically');
assert.equal(recoveryReplay.snapshot.fatigueMilli,recoveryA.snapshot.fatigueMilli,'fatigue replay drifted');

now='1201-03-02 10:15:00';
const recovered=Health.advance(seed,identity,now,sim('REC-2',{activity:'resting'}));
assert.equal(recovered.ok,true);assert.equal(recovered.snapshot.activeInjuryCount,0);assert(recovered.recoveredInjuryIds.includes(injuryId));assert(recovered.snapshot.recentRecoveredIds.includes(injuryId));

const beforeRewind=Health.snapshot(seed,identity);
const rewind=Health.advance(seed,identity,'1201-03-02 10:00:00',sim('REWIND',{activity:'normal'}));
assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-health-state');
assert.deepStrictEqual(Health.snapshot(seed,identity).injuries,beforeRewind.injuries);

const saved=WorldState.serializeState(seed),preReload=Health.snapshot(seed,identity);
stores.set(seed,fresh(seed));assert.equal(Health.snapshot(seed,identity).exists,false);
WorldState.restoreSerializedState({seed},saved);const restored=Health.snapshot(seed,identity);
assert.deepStrictEqual(restored.injuries,preReload.injuries);assert.deepStrictEqual(restored.recentRecoveredIds,preReload.recentRecoveredIds);assert.equal(restored.fatigueMilli,preReload.fatigueMilli);assert.equal(restored.lastFantasyTimestamp,preReload.lastFantasyTimestamp);

global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;global.navigator={userAgent:'device-a'};
const presentationA=Health.snapshot(seed,identity);
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'device-b'};
const presentationB=Health.snapshot(seed,identity);
assert.deepStrictEqual(presentationB,presentationA,'presentation/device state influenced health');

now='1201-03-02 06:00:00';
assert(Health.initialize(otherSeed,identity,now).ok);
const other=Health.snapshot(otherSeed,identity);
assert.notEqual(other.protagonistId,base.protagonistId,'campaign isolation should preserve distinct protagonist identity');
assert.equal(other.activeInjuryCount,0);

const capSeed='WP-S009-005-CAP';
now='1201-03-03 06:00:00';
assert(Health.initialize(capSeed,identity,now).ok);
for(let i=0;i<Health.MAX_INJURIES;i++){
  const r=Health.applyInjury(capSeed,identity,{kind:'fixture-'+i,bodyRegion:'region-'+i,severityMilli:1000+i,recoveryDurationSeconds:86400},sim('CAP-'+i,{activity:'normal'}));
  assert.equal(r.ok,true,'injury fixture failed before cap '+i);
}
const overflow=Health.applyInjury(capSeed,identity,{kind:'overflow',bodyRegion:'overflow',severityMilli:1000,recoveryDurationSeconds:86400},sim('CAP-OVER',{activity:'normal'}));
assert.equal(overflow.ok,false);assert.equal(overflow.reason,'active-injury-limit-reached');
const capped=Health.snapshot(capSeed,identity);
assert.equal(capped.activeInjuryCount,Health.MAX_INJURIES);assert(capped.serializedBytes<=Health.MAX_STATE_BYTES);
assert.equal(Health.listInjuries(capSeed,{limit:999}).length,Health.MAX_QUERY_RESULTS);
assert.equal(Health.decisionContext(capSeed).readOnly,true);

const telemetry=Health.telemetry();
assert(telemetry.reads>0&&telemetry.writes>0&&telemetry.advances>0&&telemetry.injuries>0&&telemetry.rejections>0);
assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.perFrameScan,false);assert.equal(telemetry.authority,false);
assert.equal(restored.persistenceAuthority,'WorldState CampaignStateDelta');assert.equal(restored.chronologyAuthority,'Fantasy Game Time');assert.equal(restored.mutationAuthority,'explicit Simulation-authorized health operations');
assert.equal(restored.directActionExecution,false);assert.equal(restored.combatResolutionAuthority,false);assert.equal(restored.medicineInventoryAuthority,false);assert.equal(restored.diseaseAuthority,false);assert.equal(restored.deathSuccessionAuthority,false);assert.equal(restored.needsAuthority,false);

const repoRoot=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const script='scripts/world/protagonist-health.js?v=protagonist-health-v1';
assert(html.includes(script),'canonical root must load ProtagonistHealth');
assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-inventory.js?v=protagonist-inventory-v1'),'health should load after Stage 9 inventory foundation');
assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'),'health should load before Advisor consumers');
const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input reference: '+forbidden);
assert(source.includes('options.authority!=="simulation"'),'Simulation authority gate missing');
assert(source.includes('fullWorldScan:false')&&source.includes('perFrameScan:false'),'bounded scan contract missing');

console.log(JSON.stringify({
  wp:'WP-S009-005',classification:'FUNCTIONAL',visual:'N/A — authoritative health/injury/fatigue state adds no rendered surface',pass:true,
  version:Health.VERSION,stableInjuryIds:true,duplicateIdempotence:true,negativeInjuryRejected:true,forgedMutationRejected:true,
  fatigueProgression:true,recoveryProgression:true,recoveryReplay:true,chunkInvariantFatigue:true,rewindRejected:true,saveReload:true,campaignIsolation:true,presentationInvariant:true,
  activeInjuryCap:capped.activeInjuryCount,maxInjuries:Health.MAX_INJURIES,queryLimit:Health.MAX_QUERY_RESULTS,serializedBytes:capped.serializedBytes,maxStateBytes:Health.MAX_STATE_BYTES,
  persistenceAuthority:restored.persistenceAuthority,chronologyAuthority:restored.chronologyAuthority,mutationAuthority:restored.mutationAuthority,
  fullWorldScan:restored.fullWorldScan,perFrameScan:restored.perFrameScan,directActionExecution:restored.directActionExecution,telemetry
},null,2));
