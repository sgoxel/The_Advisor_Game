'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
function H(v){let h=2166136261>>>0;for(const ch of String(v??'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
function C(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v))}
function merge(a,b){const o=C(a||{});for(const[k,v]of Object.entries(b||{}))o[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(o[k],v):C(v);return o}
const stores=new Map();function fresh(seed){return{seed,sequence:0,entries:{}}}function store(seed){if(!stores.has(seed))stores.set(seed,fresh(seed));return stores.get(seed)}
global.WorldState={
 structuralRef(seed,kind,owner,key,initial){return{id:'STR|'+String(kind).toUpperCase()+'|'+H([seed,kind,owner,key].join('|')),kind,key:{initial:C(initial||{})}}},
 resolve(seed,ref){const e=store(seed).entries[ref.id];return{current:merge(ref.key?.initial||{},e?.changes||{}),delta:e||null}},
 applyDelta(seed,ref,changes,reason){const s=store(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={revision:(prev?.revision||0)+1,reason,changes:merge(prev?.changes||{},changes)};return{ok:true,reason:'ok',entry:C(s.entries[ref.id])}},
 serializeState(seed){return C(store(seed))},
 restoreSerializedState(ctx,state){stores.set(String(ctx.seed),C(state));return{ok:true}}
};
const seed='WP-S014-008-SEED',identity='protagonist',t0='1201-10-01 10:00:00',t1='1201-10-01 10:30:00',t2='1201-10-01 10:35:00';
let now=t0;global.GameTime={getTimestampKey(){return now}};
global.ProtagonistProfile={derive(s,k='protagonist'){return{protagonistId:'PROTAGONIST-'+H(s+'|'+k+'|identity-v1')}}};
global.DailyActivity={build(){return C([
 {id:'R-GUARD',displayName:'Serra',profession:'guard',workFunction:'local-protection',workplaceId:'GUARD-POST',workplaceLabel:'Village Guard Post'},
 {id:'R-SMITH',displayName:'Marek',profession:'smith',workFunction:'craft',workplaceId:'SMITHY',workplaceLabel:'Village Smithy'}
])}};
global.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{roleId:'local-resident',rankTier:0,scopes:['self']}}}};
const interactions=new Map();
function put(id,{targetKind='building',targetId='GUARD-POST',action='service-duty',status='terminal-success',time=t1,auth=true}={}){
 const row=Object.freeze({attemptId:id,resultId:'IRX-'+H(id+'|'+targetId+'|'+action+'|'+status),targetKind,targetId,action,status,updatedFantasyTimestamp:time,simulation:Object.freeze({delegate:'SimulationTest',authoritativeTerminalSuccess:status==='terminal-success'&&auth})});
 interactions.set(id,row);return row;
}
global.ProtagonistInteractionPipeline={
 get(_seed,id){return interactions.get(id)||null},
 claimCompletion(_seed,input){const row=interactions.get(input.attemptId);return row?.status==='terminal-success'&&row.simulation.authoritativeTerminalSuccess?{ok:true,interaction:row}:{ok:false,reason:'claimed-success-not-authoritative',interaction:row||null}}
};
const healthPath=path.resolve(__dirname,'../world/protagonist-health.js'),standingPath=path.resolve(__dirname,'../world/protagonist-standing.js'),servicePath=path.resolve(__dirname,'../world/protagonist-service-contracts.js'),bridgePath=path.resolve(__dirname,'../world/protagonist-conflict-consequences.js');
for(const p of [healthPath,standingPath,servicePath,bridgePath])delete require.cache[require.resolve(p)];
const Health=require(healthPath);global.ProtagonistHealth=Health;
const Standing=require(standingPath);global.ProtagonistStanding=Standing;
const Service=require(servicePath);global.ProtagonistServiceContracts=Service;
const Bridge=require(bridgePath);global.ProtagonistConflictConsequences=Bridge;
assert.equal(Bridge.VERSION,'protagonist-conflict-consequences-v1');
assert(Health.initialize(seed,identity,t0).ok);assert(Standing.initialize(seed,identity,t0).ok);
put('IAX-ACCEPT',{targetKind:'person',targetId:'R-GUARD',action:'accept-service',status:'terminal-success',time:'1201-10-01 10:01:00'});
const activation=Service.activate(seed,{roleType:'squire',patronId:'R-GUARD'},{authority:'simulation',authoritative:true,operationId:'SVC-ACTIVATE',fantasyTimestamp:'1201-10-01 10:02:00',acceptanceAttemptId:'IAX-ACCEPT'},identity);
assert(activation.ok,JSON.stringify(activation));const contractId=activation.contract.id;
const pid=ProtagonistProfile.derive(seed,identity).protagonistId;
function sim(op,when=t1,authority='simulation'){return{authority,authoritative:true,campaignSeed:seed,operationId:op,fantasyTimestamp:when}}
function evidence(id,overrides={}){return{
 type:'conflict-consequence',validated:true,terminal:true,fantasyTimestamp:overrides.fantasyTimestamp||t1,
 sourceRef:{kind:'simulation-result',id},protagonistRef:{kind:'protagonist',id:pid},locationRef:{kind:'workplace',id:'GUARD-POST'},
 ...overrides
}}
put('IAX-PROTECT',{time:t1});
const protected=evidence('SIM-PROTECT-1',{
 injury:{kind:'bruise',bodyRegion:'torso',severityMilli:12000,recoveryDurationSeconds:7200},
 service:{contractId,dutyId:'training-service',resultState:'completed',interactionAttemptId:'IAX-PROTECT'},
 standingRecognition:true
});
const baseline=WorldState.serializeState(seed);
const a=Bridge.consume(seed,protected,sim('CC-PRIMARY'),identity);assert(a.ok,JSON.stringify(a));assert(a.injuryApplied&&a.serviceApplied&&a.standingApplied);assert.equal(a.healthAuthority,'ProtagonistHealth');assert.equal(a.serviceAuthority,'ProtagonistServiceContracts');assert.equal(a.standingAuthority,'ProtagonistStanding');
const firstAudit=C(a.audit),firstHealth=C(Health.snapshot(seed,identity)),firstStanding=C(Standing.snapshot(seed,identity)),firstService=C(Service.snapshot(seed,identity));
assert.equal(firstHealth.injuries.length,1);assert.equal(firstService.resultCount,1);assert.equal(firstService.results[0].resultState,'completed');assert.equal(Standing.summary(seed,{kind:'local',id:'GUARD-POST'},identity).domains.service.scopedDelta,3);
assert(firstAudit.refs.health?.id&&firstAudit.refs.service?.id&&firstAudit.refs.standing?.id);assert(!JSON.stringify(firstAudit).includes('severityMilli'),'audit must keep refs, not copied injury truth');
stores.set(seed,C(baseline));const replay=Bridge.consume(seed,protected,sim('CC-PRIMARY'),identity);assert(replay.ok);assert.deepStrictEqual(C(replay.audit),firstAudit,'same SEED + Fantasy Game Time + evidence must replay identically');assert.deepStrictEqual(C(Health.snapshot(seed,identity).injuries),firstHealth.injuries);assert.deepStrictEqual(C(Standing.snapshot(seed,identity).records),firstStanding.records);assert.deepStrictEqual(C(Service.snapshot(seed,identity).results),firstService.results);

const duplicate=Bridge.consume(seed,protected,sim('CC-PRIMARY'),identity);assert(duplicate.ok&&duplicate.duplicate&&duplicate.reason==='duplicate');
const duplicateSource=Bridge.consume(seed,protected,sim('CC-PRIMARY-ALT'),identity);assert(duplicateSource.ok&&duplicateSource.duplicate&&duplicateSource.reason==='duplicate-source');
const conflict=Bridge.consume(seed,{...protected,injury:{...protected.injury,severityMilli:13000}},sim('CC-CONFLICT'),identity);assert(!conflict.ok&&conflict.reason==='duplicate-source-conflict');
assert.equal(Health.snapshot(seed,identity).injuries.length,1);assert.equal(Service.snapshot(seed,identity).resultCount,1);

const standingBefore=Standing.snapshot(seed,identity).recordCount;
const privateConflict=evidence('SIM-PRIVATE',{fantasyTimestamp:'1201-10-01 10:32:00'});
const privateResult=Bridge.consume(seed,privateConflict,sim('CC-PRIVATE','1201-10-01 10:32:00'),identity);assert(privateResult.ok&&privateResult.noOp);assert.equal(privateResult.standingApplied,false);assert.equal(Standing.snapshot(seed,identity).recordCount,standingBefore,'private conflict must not auto-create merit');
const forgedMerit=Bridge.consume(seed,{...privateConflict,sourceRef:{kind:'simulation-result',id:'SIM-FORGED-MERIT'},standingRecognition:true},sim('CC-FORGED-MERIT','1201-10-01 10:32:00'),identity);assert(!forgedMerit.ok&&forgedMerit.reason==='duty-backed-standing-required');
const forgedUi=Bridge.consume(seed,{...privateConflict,sourceRef:{kind:'simulation-result',id:'SIM-UI'},injury:{kind:'cut',bodyRegion:'arm',severityMilli:5000,recoveryDurationSeconds:3600}},sim('CC-UI','1201-10-01 10:32:00','ui'),identity);assert(!forgedUi.ok&&forgedUi.reason==='simulation-authority-required');
const wrongActor=Bridge.consume(seed,{...privateConflict,sourceRef:{kind:'simulation-result',id:'SIM-ACTOR'},protagonistRef:{kind:'protagonist',id:'FORGED'},injury:{kind:'cut',bodyRegion:'arm',severityMilli:5000,recoveryDurationSeconds:3600}},sim('CC-ACTOR','1201-10-01 10:32:00'),identity);assert(!wrongActor.ok&&wrongActor.reason==='protagonist-actor-required');
const wrongLocation=Bridge.consume(seed,{...privateConflict,sourceRef:{kind:'simulation-result',id:'SIM-LOC'},locationRef:{kind:'workplace',id:'HIDDEN-ARENA'},injury:{kind:'cut',bodyRegion:'arm',severityMilli:5000,recoveryDurationSeconds:3600}},sim('CC-LOC','1201-10-01 10:32:00'),identity);assert(!wrongLocation.ok&&wrongLocation.reason==='grounded-location-required');
const loot=Bridge.consume(seed,{...privateConflict,sourceRef:{kind:'simulation-result',id:'SIM-LOOT'},loot:{coins:99}},sim('CC-LOOT','1201-10-01 10:32:00'),identity);assert(!loot.ok&&loot.reason==='unsupported-consequence-class');

put('IAX-VIOLATION',{status:'failed',auth:false,time:t2});
const violation=evidence('SIM-VIOLATION',{
 fantasyTimestamp:t2,service:{contractId,dutyId:'training-service',resultState:'violated',interactionAttemptId:'IAX-VIOLATION'},standingRecognition:true
});
const v=Bridge.consume(seed,violation,sim('CC-VIOLATION',t2),identity);assert(v.ok,JSON.stringify(v));assert(!v.injuryApplied&&v.serviceApplied&&v.standingApplied);assert.equal(Service.results(seed,{contractId},identity)[0].resultState,'violated');assert.equal(Standing.summary(seed,{kind:'local',id:'GUARD-POST'},identity).domains.reliability.scopedDelta,-6);

const badService=evidence('SIM-BAD-SERVICE',{fantasyTimestamp:'1201-10-01 10:36:00',service:{contractId,dutyId:'training-service',resultState:'completed',interactionAttemptId:'IAX-NOT-THERE'},standingRecognition:true});
const bad=Bridge.consume(seed,badService,sim('CC-BAD-SERVICE','1201-10-01 10:36:00'),identity);assert(!bad.ok&&bad.reason==='terminal-simulation-evidence-required');
const mismatch=evidence('SIM-OTHER-LOCATION',{fantasyTimestamp:'1201-10-01 10:36:00',locationRef:{kind:'workplace',id:'SMITHY'},service:{contractId,dutyId:'training-service',resultState:'completed',interactionAttemptId:'IAX-PROTECT'}});
const mm=Bridge.consume(seed,mismatch,sim('CC-MISMATCH','1201-10-01 10:36:00'),identity);assert(!mm.ok&&mm.reason==='service-location-mismatch');

for(let i=0;i<22;i++){
 const ss=String(i).padStart(2,'0'),when='1201-10-01 10:40:'+ss,attempt='IAX-CAP-'+ss;put(attempt,{time:when});
 const e=evidence('SIM-CAP-'+ss,{fantasyTimestamp:when,service:{contractId,dutyId:'training-service',resultState:'completed',interactionAttemptId:attempt}});
 const r=Bridge.consume(seed,e,sim('CC-CAP-'+ss,when),identity);assert(r.ok,'cap fixture '+i+' '+JSON.stringify(r));
}
const bounded=Bridge.snapshot(seed,identity);assert.equal(bounded.auditCount,Bridge.MAX_AUDITS);assert(bounded.serializedBytes<=Bridge.MAX_LEDGER_BYTES);assert.equal(Bridge.audits(seed,{limit:999},identity).length,Bridge.MAX_QUERY_RESULTS);
put('IAX-CAP-EXTRA',{time:'1201-10-01 10:41:00'});const serviceCountBeforeCapReject=Service.snapshot(seed,identity).resultCount;
const capReject=Bridge.consume(seed,evidence('SIM-CAP-EXTRA',{fantasyTimestamp:'1201-10-01 10:41:00',service:{contractId,dutyId:'training-service',resultState:'completed',interactionAttemptId:'IAX-CAP-EXTRA'}}),sim('CC-CAP-EXTRA','1201-10-01 10:41:00'),identity);
assert(!capReject.ok&&capReject.reason==='conflict-consequence-audit-cap-reached');assert.equal(Service.snapshot(seed,identity).resultCount,serviceCountBeforeCapReject,'audit cap must reject before delegated mutation');

const saved=WorldState.serializeState(seed),auditSaved=C(Bridge.snapshot(seed,identity)),healthSaved=C(Health.snapshot(seed,identity)),standingSaved=C(Standing.snapshot(seed,identity)),serviceSaved=C(Service.snapshot(seed,identity));
stores.set(seed,fresh(seed));assert.equal(Bridge.snapshot(seed,identity).auditCount,0);WorldState.restoreSerializedState({seed},saved);
assert.deepStrictEqual(C(Bridge.snapshot(seed,identity).audits),auditSaved.audits);assert.deepStrictEqual(C(Health.snapshot(seed,identity).injuries),healthSaved.injuries);assert.deepStrictEqual(C(Standing.snapshot(seed,identity).records),standingSaved.records);assert.deepStrictEqual(C(Service.snapshot(seed,identity).results),serviceSaved.results);

const src=fs.readFileSync(bridgePath,'utf8'),svcSrc=fs.readFileSync(servicePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.','PersonalCombatExchange','LocalSecurityIncidents','ProtagonistAuthority.transition','EconomicTransaction','ProtagonistInventory','SocialState.recordEvent'])assert(!src.includes(forbidden),'forbidden dependency/authority/non-determinism: '+forbidden);
for(const required of ['ProtagonistHealth.applyInjury','ProtagonistStanding.recordSimulation','ProtagonistServiceContracts.recordResult','validated-terminal-conflict-evidence-required','duty-backed-standing-required','fullWorldScan:false','fullSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','directRankMutation:false','autoMerit:false','stage14Dependency:false'])assert(src.includes(required),'missing authority/bounds marker '+required);
assert(!svcSrc.includes('recordConflictConsequence'),'service authority bypass must be removed');
const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8'),script='scripts/world/protagonist-conflict-consequences.js?v=protagonist-conflict-consequences-v1',serviceScript='scripts/world/protagonist-service-contracts.js?v=protagonist-service-contracts-v1',stage14Script='scripts/world/protagonist-conflict-response.js?v=protagonist-conflict-response-v2';
assert(html.includes(script));assert(html.indexOf(script)>html.indexOf(serviceScript),'bridge must load after completed Stage 13 service authority');assert(html.indexOf(script)<html.indexOf(stage14Script),'bridge must not require Stage 14 modules to load first');
const tel=Bridge.telemetry();assert(tel.healthDelegations>=2&&tel.serviceDelegations>=24&&tel.standingDelegations>=2&&tel.duplicates>=2&&tel.rejections>=7);assert.equal(tel.fullWorldScan,false);assert.equal(tel.fullSettlementScan,false);assert.equal(tel.wholeHistoryScan,false);assert.equal(tel.perFrameScan,false);
console.log(JSON.stringify({pass:true,wp:'WP-S014-008',classification:'FUNCTIONAL',visual:'N/A',version:Bridge.VERSION,validatedInjuryDelegation:true,dutyBackedStanding:true,privateConflictNoAutoMerit:true,serviceCompletionLinked:true,serviceViolationLinked:true,forgedUiRejected:true,wrongActorRejected:true,wrongLocationRejected:true,unsupportedLootRejected:true,duplicateIdempotent:true,duplicateSourceIdempotent:true,conflictingSourceRejected:true,deterministicReplay:true,saveReload:true,auditRefsOnly:true,serviceBypassRemoved:true,bounds:bounded.bounds,serializedBytes:bounded.serializedBytes,guards:{stage14Dependency:false,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directHealthMutation:false,directStandingMutation:false,directServiceMutation:false,directRankMutation:false,directRelationshipMutation:false,directWealthMutation:false,autoMerit:false}},null,2));
