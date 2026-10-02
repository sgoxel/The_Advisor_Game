'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
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

const seed='WP-S014-004-SEED',identity='protagonist';
global.ProtagonistProfile={derive(s,key='protagonist'){return {protagonistId:'PROTAGONIST-'+hash(s+'|'+key+'|identity-v1')}}};
const residents=[
  {id:'RES-BANDIT-01',displayName:'Merek'},
  {id:'RES-BANDIT-02',displayName:'Tovan'},
  {id:'RES-GUARD-01',displayName:'Alis'}
];
global.DailyActivity={build(){return residents.map(clone);}};
let now='1201-09-03 10:00:00';
global.GameTime={getTimestampKey(){return now;}};

const healthPath=path.resolve(__dirname,'../world/protagonist-health.js');
delete require.cache[healthPath];
const Health=require(healthPath);
global.ProtagonistHealth=Health;

const modulePath=path.resolve(__dirname,'../world/personal-combat-exchange.js');
delete require.cache[modulePath];
const Combat=require(modulePath);
assert.equal(Combat.VERSION,'personal-combat-exchange-v1');

const src=(id)=>({kind:'simulation-capability',id});
const cap=(intent,over={})=>({intent,authoritative:true,validated:true,sourceRef:src('CAP-'+intent+'-'+(over.tag||'X')),martialSkill:5,conditionMilli:85000,fatigueMilli:15000,injuryBurdenMilli:0,attack:60,defense:60,mobility:60,reach:60,protection:25,...over});
const context=(over={})=>({authoritative:true,validated:true,sourceRef:{kind:'simulation-context',id:'CTX-01'},locationRef:{kind:'location',id:'STARTING-VILLAGE-LANE'},terrainModifier:0,escapeAvailable:true,...over});
const sim=(operationId,when=now,over={})=>({authority:'simulation',sourceSystem:'Simulation',authoritative:true,validated:true,campaignSeed:seed,operationId,fantasyTimestamp:when,sourceRef:{kind:'simulation-request',id:'SIM-'+operationId},...over});

const strongInput={
  participants:[
    {actorRef:{kind:'protagonist',id:'protagonist'},capability:cap('attack',{tag:'P-STRONG',martialSkill:8,conditionMilli:96000,fatigueMilli:8000,attack:92,defense:78,mobility:78,reach:72,protection:55})},
    {actorRef:{kind:'resident',id:'RES-BANDIT-01'},capability:cap('defend',{tag:'O-WEAK',martialSkill:2,conditionMilli:70000,fatigueMilli:32000,attack:38,defense:42,mobility:40,reach:42,protection:8})}
  ],
  context:context({terrainModifier:3,escapeAvailable:true})
};
const win=Combat.resolveExchange(seed,strongInput,sim('CBT-STRONG'),identity);
assert(win.ok);assert.equal(win.result.resolution,'protagonist-advantage');assert.equal(win.result.terminal,true);assert.equal(win.result.protagonistInjuryEvidence,null);assert.equal(win.result.npcConsequences.length,1);assert.equal(win.result.npcConsequences[0].persistentNpcHealthMutation,false);
const replay=Combat.resolveExchange(seed,strongInput,sim('CBT-STRONG'),identity);
assert(replay.ok);assert.equal(replay.duplicate,true);assert.deepStrictEqual(replay.result,win.result);

const conflict=Combat.resolveExchange(seed,{...strongInput,context:context({terrainModifier:-5,escapeAvailable:true})},sim('CBT-STRONG'),identity);
assert.equal(conflict.ok,false);assert.equal(conflict.reason,'duplicate-operation-conflict');

now='1201-09-03 10:00:01';
const timed=Combat.resolveExchange(seed,strongInput,sim('CBT-TIME',now),identity);
assert(timed.ok);
const p0=win.result.participants.find(x=>x.actorRef.kind==='protagonist'),p1=timed.result.participants.find(x=>x.actorRef.kind==='protagonist');
assert.notEqual(p0.variation,p1.variation,'Fantasy Game Time must deterministically alter permitted exchange variation');

now='1201-09-03 10:01:00';
const disengage=Combat.resolveExchange(seed,{
  participants:[
    {actorRef:{kind:'protagonist',id:'protagonist'},capability:cap('disengage',{tag:'P-DIS',martialSkill:3,mobility:70})},
    {actorRef:{kind:'resident',id:'RES-BANDIT-01'},capability:cap('attack',{tag:'O-ATTACK',martialSkill:5})}
  ],
  context:context({escapeAvailable:true})
},sim('CBT-DISENGAGE',now),identity);
assert(disengage.ok);assert.equal(disengage.result.resolution,'protagonist-disengaged');assert.equal(disengage.result.protagonistInjuryEvidence,null);

now='1201-09-03 10:02:00';
const weak=Combat.resolveExchange(seed,{
  participants:[
    {actorRef:{kind:'protagonist',id:'protagonist'},capability:cap('defend',{tag:'P-WEAK',martialSkill:1,conditionMilli:48000,fatigueMilli:68000,injuryBurdenMilli:25000,attack:25,defense:32,mobility:25,reach:30,protection:5})},
    {actorRef:{kind:'resident',id:'RES-BANDIT-02'},capability:cap('attack',{tag:'O-STRONG',martialSkill:9,conditionMilli:96000,fatigueMilli:6000,attack:95,defense:82,mobility:86,reach:80,protection:50})}
  ],
  context:context({terrainModifier:-4,escapeAvailable:false})
},sim('CBT-INJURY',now),identity);
assert(weak.ok);assert.equal(weak.result.resolution,'opponent-advantage');assert(weak.result.protagonistInjuryEvidence);assert(/^COMBATINJ-[0-9A-F]{8}$/.test(weak.result.protagonistInjuryEvidence.healthOperationId));

const beforeHealth=Health.snapshot(seed,identity);
const injuryApply=Combat.applyProtagonistInjury(seed,weak.result.id,sim('APPLY-COMBAT-INJURY',now),identity);
assert(injuryApply.ok);assert.equal(injuryApply.delegatedTo,'ProtagonistHealth.applyInjury');assert.equal(injuryApply.directHealthMutation,false);
const afterHealth=Health.snapshot(seed,identity);
assert.equal(afterHealth.activeInjuryCount,(beforeHealth.activeInjuryCount||0)+1);
assert(afterHealth.injuries.some(x=>x.sourceRef?.kind==='combat-result'&&x.sourceRef?.id===weak.result.id));
const injuryDuplicate=Combat.applyProtagonistInjury(seed,weak.result.id,sim('APPLY-COMBAT-INJURY-RETRY',now),identity);
assert(injuryDuplicate.ok);assert.equal(injuryDuplicate.healthResult.duplicate,true);assert.equal(Health.snapshot(seed,identity).activeInjuryCount,afterHealth.activeInjuryCount);

now='1201-09-03 10:03:00';
const badActor=Combat.resolveExchange(seed,{participants:[{actorRef:{kind:'protagonist',id:'protagonist'},capability:cap('attack',{tag:'BAD-A'})},{actorRef:{kind:'resident',id:'RES-NOT-REAL'},capability:cap('defend',{tag:'BAD-B'})}],context:context()},sim('BAD-ACTOR',now),identity);
assert.equal(badActor.ok,false);assert.equal(badActor.reason,'grounded-actor-reference-required');
const forged=Combat.resolveExchange(seed,{participants:[{actorRef:{kind:'protagonist',id:'protagonist'},capability:{...cap('attack',{tag:'FORGED'}),sourceRef:{kind:'ui',id:'UI-CAP'}}},{actorRef:{kind:'resident',id:'RES-BANDIT-01'},capability:cap('defend',{tag:'REAL'})}],context:context()},sim('FORGED-CAP',now),identity);
assert.equal(forged.ok,false);assert.equal(forged.reason,'validated-capability-required');
const unsupported=Combat.resolveExchange(seed,{participants:[{actorRef:{kind:'protagonist',id:'protagonist'},capability:cap('cast-spell',{tag:'SPELL'})},{actorRef:{kind:'resident',id:'RES-BANDIT-01'},capability:cap('defend',{tag:'REAL-2'})}],context:context()},sim('BAD-INTENT',now),identity);
assert.equal(unsupported.ok,false);assert.equal(unsupported.reason,'unsupported-combat-intent');
const forgedContext=Combat.resolveExchange(seed,{participants:strongInput.participants,context:{...context(),sourceRef:{kind:'advisor',id:'ADV-CTX'}}},sim('BAD-CONTEXT',now),identity);
assert.equal(forgedContext.ok,false);assert.equal(forgedContext.reason,'validated-combat-context-required');
const forgedAuthority=Combat.resolveExchange(seed,strongInput,{...sim('BAD-AUTH',now),authority:'ui'});
assert.equal(forgedAuthority.ok,false);assert.equal(forgedAuthority.reason,'validated-simulation-authority-required');

const saved=WorldState.serializeState(seed),beforeReload=Combat.snapshot(seed,identity);
stores.set(seed,fresh(seed));assert.equal(Combat.snapshot(seed,identity).resultCount,0);
WorldState.restoreSerializedState({seed},saved);
const restored=Combat.snapshot(seed,identity);
assert.equal(restored.resultCount,beforeReload.resultCount);assert.deepStrictEqual(restored.results,beforeReload.results);assert(restored.serializedBytes<=Combat.MAX_STATE_BYTES);
assert(Combat.list(seed,{limit:999},identity).length<=Combat.MAX_QUERY_RESULTS);
assert.equal(restored.persistenceAuthority,'WorldState CampaignStateDelta');assert.equal(restored.chronologyAuthority,'Fantasy Game Time');assert.equal(restored.healthMutationAuthority,'ProtagonistHealth.applyInjury only');
assert.equal(restored.npcHealthAuthority,false);assert.equal(restored.relationshipAuthority,false);assert.equal(restored.lootAuthority,false);assert.equal(restored.rankAuthority,false);assert.equal(restored.armyAuthority,false);assert.equal(restored.directPlayerControl,false);
assert.equal(restored.fullWorldScan,false);assert.equal(restored.wholeSettlementScan,false);assert.equal(restored.wholeHistoryScan,false);assert.equal(restored.perFrameScan,false);

const telemetry=Combat.telemetry();assert(telemetry.resolutions>=4&&telemetry.duplicates>=1&&telemetry.rejections>=5&&telemetry.healthDelegations>=2);assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.perFrameScan,false);

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.','LocalSecurityIncidents','ProtagonistMartialReadiness','ProtagonistConflictResponse','SocialState.','ProtagonistStanding.','ProtagonistInventory.'])
  assert(!source.includes(forbidden),'forbidden authority/dependency reference: '+forbidden);
for(const required of ['validated-simulation-authority-required','ProtagonistHealth.applyInjury','fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','npcHealthAuthority:false','directPlayerControl:false'])
  assert(source.includes(required),'missing authority/bounds contract: '+required);

const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
const script='scripts/world/personal-combat-exchange.js?v=personal-combat-exchange-v1';
assert(html.includes(script),'canonical production root must load personal combat exchange resolver');
assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-health.js?v=protagonist-health-v1'),'combat resolver must load after ProtagonistHealth');

console.log(JSON.stringify({
  wp:'WP-S014-004',classification:'FUNCTIONAL',visual:'N/A — authoritative combat exchange resolution adds no rendered surface',pass:true,
  version:Combat.VERSION,deterministicReplay:true,timeVariation:true,invalidActorRejected:true,forgedCapabilityRejected:true,unsupportedIntentRejected:true,duplicateIdempotence:true,conflictingReplayRejected:true,
  protagonistAdvantage:win.result.id,disengage:disengage.result.id,opponentAdvantage:weak.result.id,healthOperationId:weak.result.protagonistInjuryEvidence.healthOperationId,
  healthDelegation:true,saveReload:true,resultCount:restored.resultCount,serializedBytes:restored.serializedBytes,maxStateBytes:Combat.MAX_STATE_BYTES,maxParticipants:Combat.MAX_PARTICIPANTS,
  persistenceAuthority:restored.persistenceAuthority,chronologyAuthority:restored.chronologyAuthority,healthMutationAuthority:restored.healthMutationAuthority,
  fullWorldScan:restored.fullWorldScan,wholeSettlementScan:restored.wholeSettlementScan,wholeHistoryScan:restored.wholeHistoryScan,perFrameScan:restored.perFrameScan,telemetry
},null,2));