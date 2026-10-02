'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const seed='WP-S014-001-A';let persisted=null,deltaRevision=0;
global.GameTime={getTimestampKey(){return '1201-07-03 10:15:00'}};
global.StartingVillage={plan(){return{name:'Oakmere',center:{x:'0',y:'0'}}}};
global.HousePlans={build(){return[{id:'H1',kind:'house'},{id:'H2',kind:'cabin'}]}};
global.SpecialLots={build(){return[{id:'LOT-GUARD',kind:'meeting-hall',label:'Village Meeting Hall'}]}};
global.DailyActivity={build(){return[{id:'R01',name:'Alda',displayName:'Alda Ashford'},{id:'R02',name:'Bram',displayName:'Bram Briar'}]}};
global.ProtagonistProfile={derive(){return{protagonistId:'PROTAGONIST-TEST'}}};
global.WorldState={
 structuralRef(_seed,kind,parentId,key,initial){return{id:'SEC-REGISTRY-REF',kind,parentId,key:{structuralKey:key,initial}}},
 resolve(){return{current:persisted?{localSecurityIncidentState:JSON.parse(JSON.stringify(persisted))}:{},delta:{revision:deltaRevision}}},
 applyDelta(_seed,_ref,changes){persisted=JSON.parse(JSON.stringify(changes.localSecurityIncidentState));deltaRevision++;return{ok:true,reason:'ok',entry:{revision:deltaRevision}}}
};
const modPath=path.resolve(__dirname,'../world/local-security-incidents.js');
delete require.cache[modPath];require(modPath);
const Sec=global.LocalSecurityIncidents;
assert.equal(Sec.VERSION,'local-security-incidents-v1');

const confirmedInput={category:'banditry',severity:'serious',summary:'Bandits attacked the village approach.',locationRef:{kind:'building',id:'H1'},actorRefs:[{kind:'resident',id:'R01',role:'witness'}],sourceRef:{kind:'simulation-event',id:'SIM-BANDIT-01'}};
const confirmedOptions={authority:'simulation',sourceSystem:'Simulation',authoritative:true,validated:true,campaignSeed:seed,operationId:'OP-CREATE-1',fantasyTimestamp:'1201-07-03 10:15:00'};
const created=Sec.record(seed,confirmedInput,confirmedOptions);
assert(created.ok);assert.equal(created.incident.epistemicStatus,'confirmed');assert.equal(created.incident.status,'active');assert.equal(created.incident.legalGuilt,null);assert.equal(created.incident.combatOutcome,null);
assert(/^SEC-[0-9A-F]{8}$/.test(created.incident.id));
const stableId=created.incident.id;

const duplicate=Sec.record(seed,confirmedInput,confirmedOptions);
assert(duplicate.ok&&duplicate.duplicate);assert.equal(duplicate.incident.id,stableId);
const conflict=Sec.record(seed,{...confirmedInput,summary:'Changed content'},confirmedOptions);
assert.equal(conflict.ok,false);assert.equal(conflict.reason,'duplicate-operation-conflict');

const reported=Sec.record(seed,{category:'security',severity:'moderate',summary:'A resident reports suspicious tracks.',locationRef:{kind:'settlement',id:'starting-village'},actorRefs:[{kind:'resident',id:'R02',role:'reporter'}],sourceRef:{kind:'resident-report',id:'REP-01'}},{authority:'bounded-explicit-evidence',sourceSystem:'ResidentReport',authoritative:false,validated:false,campaignSeed:seed,operationId:'OP-REPORT-1',fantasyTimestamp:'1201-07-03 10:16:00'});
assert(reported.ok);assert.equal(reported.incident.epistemicStatus,'reported');assert.equal(reported.incident.status,'active');

const forged=Sec.record(seed,{...confirmedInput,sourceRef:{kind:'ui',id:'FAKE'}},{authority:'ui',sourceSystem:'UI',authoritative:true,validated:true,campaignSeed:seed,operationId:'OP-FAKE',fantasyTimestamp:'1201-07-03 10:17:00'});
assert.equal(forged.ok,false);assert.equal(forged.reason,'validated-authority-or-bounded-report-required');
const badActor=Sec.record(seed,{...confirmedInput,actorRefs:[{kind:'resident',id:'R99',role:'witness'}]},{...confirmedOptions,operationId:'OP-BAD-ACTOR'});
assert.equal(badActor.ok,false);assert.equal(badActor.reason,'grounded-actor-reference-required');
const badLocation=Sec.record(seed,{...confirmedInput,locationRef:{kind:'building',id:'H99'}},{...confirmedOptions,operationId:'OP-BAD-LOCATION'});
assert.equal(badLocation.ok,false);assert.equal(badLocation.reason,'grounded-local-location-required');
const reportNoReporter=Sec.record(seed,{category:'security',severity:'minor',summary:'Unsupported report.',locationRef:{kind:'settlement',id:'starting-village'},actorRefs:[{kind:'resident',id:'R02',role:'subject'}],sourceRef:{kind:'resident-report',id:'REP-02'}},{authority:'bounded-explicit-evidence',sourceSystem:'ResidentReport',authoritative:false,validated:false,campaignSeed:seed,operationId:'OP-REPORT-2',fantasyTimestamp:'1201-07-03 10:17:00'});
assert.equal(reportNoReporter.ok,false);assert.equal(reportNoReporter.reason,'reported-incident-reporter-required');

const resolved=Sec.resolveIncident(seed,stableId,{terminal:true,outcome:'resolved',sourceRef:{kind:'simulation-result',id:'SIM-END-01'}},{authority:'simulation',sourceSystem:'Simulation',authoritative:true,validated:true,campaignSeed:seed,operationId:'OP-RESOLVE-1',fantasyTimestamp:'1201-07-03 10:20:00'});
assert(resolved.ok);assert.equal(resolved.incident.status,'resolved');assert.equal(resolved.incident.resolution.outcome,'resolved');
const duplicateResolution=Sec.resolveIncident(seed,stableId,{terminal:true,outcome:'resolved',sourceRef:{kind:'simulation-result',id:'SIM-END-01'}},{authority:'simulation',sourceSystem:'Simulation',authoritative:true,validated:true,campaignSeed:seed,operationId:'OP-RESOLVE-1',fantasyTimestamp:'1201-07-03 10:20:00'});
assert(duplicateResolution.ok&&duplicateResolution.duplicate);
const rewind=Sec.resolveIncident(seed,reported.incident.id,{terminal:true,outcome:'resolved',sourceRef:{kind:'simulation-result',id:'SIM-END-02'}},{authority:'simulation',sourceSystem:'Simulation',authoritative:true,validated:true,campaignSeed:seed,operationId:'OP-RESOLVE-2',fantasyTimestamp:'1201-07-03 10:00:00'});
assert.equal(rewind.ok,false);assert.equal(rewind.reason,'resolution-before-incident');

let snap=Sec.snapshot(seed);
assert.equal(snap.incidentCount,2);assert.equal(snap.confirmedCount,1);assert.equal(snap.reportedCount,1);assert.equal(snap.resolvedCount,1);assert.equal(snap.activeCount,1);
assert.equal(snap.fullWorldScan,false);assert.equal(snap.wholeSettlementScan,false);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.perFrameScan,false);
assert.equal(snap.legalAuthority,false);assert.equal(snap.legalGuiltAuthority,false);assert.equal(snap.combatResolutionAuthority,false);assert.equal(snap.arrestAuthority,false);assert.equal(snap.relationshipAuthority,false);assert.equal(snap.propertyTransferAuthority,false);assert.equal(snap.hiddenTruthReveal,false);assert.equal(snap.directActionExecution,false);assert.equal(snap.directWorldMutation,false);
assert(snap.serializedBytes<=Sec.MAX_STATE_BYTES);
assert.equal(Sec.list(seed,{epistemicStatus:'reported'}).length,1);
assert.equal(Sec.list(seed,{status:'resolved'}).length,1);

delete global.LocalSecurityIncidents;delete require.cache[modPath];require(modPath);
const restored=global.LocalSecurityIncidents.snapshot(seed);
assert.equal(restored.incidentCount,2);assert.equal(restored.incidents.find(x=>x.id===stableId).status,'resolved');
assert.equal(restored.incidents.find(x=>x.epistemicStatus==='reported').status,'active');

const source=fs.readFileSync(modPath,'utf8');
for(const forbidden of ['ActionExecutor.','ProtagonistHealth.','SocialState.record','ProtagonistAuthority.transition','EconomicTransaction.','setPosition(','teleport('])assert(!source.includes(forbidden),'forbidden authority path: '+forbidden);
for(const required of ['fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','legalGuiltAuthority:false','combatResolutionAuthority:false','arrestAuthority:false','relationshipAuthority:false','propertyTransferAuthority:false','hiddenTruthReveal:false'])assert(source.includes(required),'missing guard: '+required);
console.log(JSON.stringify({pass:true,wp:'WP-S014-001',classification:'FUNCTIONAL',visual:'N/A',incidentCount:restored.incidentCount,confirmed:restored.confirmedCount,reported:restored.reportedCount,resolved:restored.resolvedCount,bytes:restored.serializedBytes,telemetry:global.LocalSecurityIncidents.telemetry()},null,2));