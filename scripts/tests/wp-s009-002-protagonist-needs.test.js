const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
function clone(v){return v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));}
function merge(a,b){if(b==null||typeof b!=='object'||Array.isArray(b))return clone(b);const out=(a&&typeof a==='object'&&!Array.isArray(a))?clone(a):{};for(const [k,v] of Object.entries(b))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k],v):clone(v);return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return (h>>>0).toString(16).toUpperCase().padStart(8,'0');}

const stores=new Map();
let activeSeed='WP-S009-002-SEED-A';
function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return {id:'STR|'+String(kind).toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{parentId:parent,structuralKey:key,initial:clone(initial||{})}};},
  resolve(seed,ref){const state=ensure(seed),entry=state.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry,currentSignature:hash(JSON.stringify(entry?.changes||{}))};},
  applyDelta(seed,ref,changes,reason){const state=ensure(seed),prev=state.entries[ref.id];state.sequence++;state.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:state.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:'ok',entry:clone(state.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,serialized){stores.set(String(campaign.seed),clone(serialized));return {ok:true};},
  bindCampaign(campaign){activeSeed=String(campaign.seed);ensure(activeSeed);return {ok:true};}
};
const campaign={seed:activeSeed,realStartMs:1234,restartCount:0,fantasyStart:{year:1201,month:3,day:2,hour:6,minute:0,second:0}};
global.SeedSystem={getCampaign(){return campaign;},getSettings(){return {seed:activeSeed};}};
let now='1201-03-02 06:00:00';
global.GameTime={
  getTimestampKey(){return now;},
  toTimestampKey(v){return String(v.year).padStart(4,'0')+'-'+String(v.month).padStart(2,'0')+'-'+String(v.day).padStart(2,'0')+' '+String(v.hour||0).padStart(2,'0')+':'+String(v.minute||0).padStart(2,'0')+':'+String(v.second||0).padStart(2,'0');}
};

require(path.resolve(__dirname,'../world/protagonist-profile.js'));
const Needs=require(path.resolve(__dirname,'../world/protagonist-needs.js'));
assert(Needs,'ProtagonistNeeds should attach to window');

const seed=activeSeed,identity='protagonist',start='1201-03-02 06:00:00';
const init=Needs.initialize(seed,identity,start);
assert.equal(init.ok,true);assert.equal(init.created,true);
const base=Needs.snapshot(seed,identity);
assert.equal(base.exists,true);assert.equal(base.pressures.hunger>=0,true);assert.equal(base.pressures.hunger<=100,true);
assert(base.serializedBytes<=Needs.MAX_STATE_BYTES,'initial state exceeded bound');
const initialSerialized=WorldState.serializeState(seed);

const a09=Needs.advance(seed,identity,'1201-03-02 09:00:00');
const a12=Needs.advance(seed,identity,'1201-03-02 12:00:00');
const a18=Needs.advance(seed,identity,'1201-03-02 18:00:00');
assert(a09.ok&&a12.ok&&a18.ok,'chunked fantasy-time progression failed');
assert(a09.snapshot.pressureMilli.hunger>base.pressureMilli.hunger,'hunger should increase with fantasy time');
assert(a18.snapshot.pressureMilli.fatigue>a09.snapshot.pressureMilli.fatigue,'fatigue should increase over fantasy time');
const chunked=a18.snapshot;

WorldState.restoreSerializedState(campaign,initialSerialized);
const direct=Needs.advance(seed,identity,'1201-03-02 18:00:00');
assert.equal(direct.ok,true);
assert.deepStrictEqual(direct.snapshot.pressureMilli,chunked.pressureMilli,'chunked vs direct progression pressure mismatch');
assert.deepStrictEqual(direct.snapshot.driftRemainder,chunked.driftRemainder,'chunked vs direct progression remainder mismatch');
assert.notDeepStrictEqual(direct.snapshot.pressureMilli,base.pressureMilli,'alternate fantasy time should diverge from start state');
const sameTime=Needs.advance(seed,identity,'1201-03-02 18:00:00');
assert.equal(sameTime.reason,'no-op');
assert.deepStrictEqual(sameTime.snapshot.pressureMilli,direct.snapshot.pressureMilli,'same input replay drifted');

const beforeMeal=Needs.snapshot(seed,identity);
const meal=Needs.applyEvent(seed,identity,{eventId:'SIM-MEAL-1',kind:'meal',authority:'simulation',authoritative:true,fantasyTimestamp:'1201-03-02 18:30:00'});
assert.equal(meal.ok,true);assert(meal.snapshot.pressureMilli.hunger<beforeMeal.pressureMilli.hunger,'meal should reduce hunger pressure after time drift');
const beforeDanger=meal.snapshot;
const danger=Needs.applyEvent(seed,identity,{eventId:'SIM-DANGER-1',kind:'danger',authority:'simulation',authoritative:true,fantasyTimestamp:'1201-03-02 18:30:00'});
assert(danger.snapshot.pressureMilli.safety>beforeDanger.pressureMilli.safety,'danger should increase safety pressure');
const rest=Needs.applyEvent(seed,identity,{eventId:'SIM-REST-1',kind:'rest',authority:'simulation',authoritative:true,fantasyTimestamp:'1201-03-02 19:00:00'});
assert(rest.snapshot.pressureMilli.fatigue<danger.snapshot.pressureMilli.fatigue,'rest should reduce fatigue pressure');
const social=Needs.applyEvent(seed,identity,{eventId:'SIM-SOCIAL-1',kind:'social-contact',authority:'simulation',authoritative:true,fantasyTimestamp:'1201-03-02 19:00:00'});
assert(social.snapshot.pressureMilli.social<rest.snapshot.pressureMilli.social,'social contact should reduce social pressure');
const duplicate=Needs.applyEvent(seed,identity,{eventId:'SIM-SOCIAL-1',kind:'social-contact',authority:'simulation',authoritative:true,fantasyTimestamp:'1201-03-02 19:00:00'});
assert.equal(duplicate.duplicate,true,'duplicate event should be idempotent');
assert.equal(duplicate.snapshot.sourceEventCount,social.snapshot.sourceEventCount,'duplicate event changed source event count');

const beforeForged=Needs.snapshot(seed,identity);
const forged=Needs.applyEvent(seed,identity,{eventId:'UI-FAKE-1',kind:'meal',authority:'ui',authoritative:true,fantasyTimestamp:'1201-03-02 19:30:00'});
assert.equal(forged.ok,false);assert.equal(forged.reason,'simulation-authority-required');
assert.deepStrictEqual(Needs.snapshot(seed,identity).pressureMilli,beforeForged.pressureMilli,'forged UI event mutated needs');
const unsupported=Needs.applyEvent(seed,identity,{eventId:'SIM-X',kind:'invent-gold',authority:'simulation',authoritative:true,fantasyTimestamp:'1201-03-02 19:30:00'});
assert.equal(unsupported.ok,false);assert.equal(unsupported.reason,'unsupported-condition-event');

const saved=WorldState.serializeState(seed);
const savedSnap=Needs.snapshot(seed,identity);
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});
assert.equal(Needs.snapshot(seed,identity).exists,false,'test reset did not clear runtime state');
WorldState.restoreSerializedState(campaign,saved);
const restored=Needs.snapshot(seed,identity);
assert.deepStrictEqual(restored.pressureMilli,savedSnap.pressureMilli,'save/reload pressure continuity failed');
assert.deepStrictEqual(restored.appliedEventIds,savedSnap.appliedEventIds,'save/reload event-id continuity failed');
assert.equal(restored.lastFantasyTimestamp,savedSnap.lastFantasyTimestamp,'save/reload chronology drifted');

global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;global.navigator={userAgent:'device-A'};
const presentationA=Needs.snapshot(seed,identity);
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'device-B'};
const presentationB=Needs.snapshot(seed,identity);
assert.deepStrictEqual(presentationB.pressureMilli,presentationA.pressureMilli,'presentation/device state influenced needs');

const altSeed='WP-S009-002-SEED-B';
WorldState.bindCampaign({seed:altSeed});
const alt=Needs.initialize(altSeed,identity,start);
assert.equal(alt.ok,true);
const altSnap=Needs.snapshot(altSeed,identity);
assert.notDeepStrictEqual(altSnap.ratesMilliPerMinute,base.ratesMilliPerMinute,'alternate SEED should vary drift rates');
assert.notEqual(altSnap.protagonistId,base.protagonistId,'alternate SEED should retain distinct protagonist identity');

const telemetry=Needs.telemetry();
assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.perFrameScan,false);assert.equal(telemetry.authority,false);assert(telemetry.reads>0&&telemetry.writes>0&&telemetry.advances>0&&telemetry.events>0,'bounded telemetry counters missing');
assert.equal(restored.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(restored.chronologyAuthority,'Fantasy Game Time + explicit Simulation events');
assert.equal(restored.actionExecution,false);assert.equal(restored.inventoryAuthority,false);assert.equal(restored.healthTreatmentAuthority,false);assert.equal(restored.goalExecutionAuthority,false);assert.equal(restored.rankAuthority,false);
assert(restored.serializedBytes<=Needs.MAX_STATE_BYTES,'restored state exceeded byte bound');
assert(restored.appliedEventIds.length<=Needs.MAX_EVENT_IDS,'event-id retention exceeded bound');

const repoRoot=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const profileScript='scripts/world/protagonist-profile.js?v=protagonist-profile-v1';
const needsScript='scripts/world/protagonist-needs.js?v=protagonist-needs-v1';
assert(html.includes(needsScript),'canonical root must load ProtagonistNeeds');
assert(html.indexOf('scripts/world/world-state.js')<html.indexOf(needsScript),'WorldState must load before ProtagonistNeeds');
assert(html.indexOf(profileScript)<html.indexOf(needsScript),'ProtagonistProfile must load before ProtagonistNeeds');
assert(html.indexOf(needsScript)<html.indexOf('scripts/world/advisor-channel.js'),'ProtagonistNeeds must load before Advisor consumers');
const source=fs.readFileSync(path.resolve(__dirname,'../world/protagonist-needs.js'),'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input reference: '+forbidden);
assert(source.includes('authority!=="simulation"'),'Simulation authority gate missing');
assert(source.includes('fullWorldScan:false')&&source.includes('perFrameScan:false'),'bounded scan contract missing');

console.log(JSON.stringify({
  wp:'WP-S009-002',classification:'FUNCTIONAL',visual:'N/A — authoritative needs/condition state adds no rendered surface',pass:true,
  version:Needs.VERSION,protagonistId:restored.protagonistId,startPressure:base.pressures,finalPressure:restored.pressures,
  sameInputReplay:true,chunkInvariant:true,alternateTimeDivergence:true,alternateSeedDivergence:true,explicitSimulationEvents:true,
  saveReloadStable:true,presentationInvariant:true,sourceEventCount:restored.sourceEventCount,eventIdCount:restored.appliedEventIds.length,
  serializedBytes:restored.serializedBytes,maxStateBytes:Needs.MAX_STATE_BYTES,maxEventIds:Needs.MAX_EVENT_IDS,
  persistenceAuthority:restored.persistenceAuthority,chronologyAuthority:restored.chronologyAuthority,
  fullWorldScan:restored.fullWorldScan,perFrameScan:restored.perFrameScan,actionExecution:restored.actionExecution,
  telemetry
},null,2));