'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
function H(v){let h=2166136261>>>0;for(const ch of String(v??'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
function C(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v))}
function merge(a,b){const o=C(a||{});for(const[k,v]of Object.entries(b||{}))o[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(o[k],v):C(v);return o}
const stores=new Map();const fresh=s=>({seed:s,sequence:0,entries:{}});function ensure(s){if(!stores.has(s))stores.set(s,fresh(s));return stores.get(s)}
global.WorldState={
 structuralRef(s,k,p,key,initial){return{id:'STR|'+String(k).toUpperCase()+'|'+H([s,k,p,key].join('|')),kind:k,key:{initial:C(initial||{})}}},
 resolve(s,r){const st=ensure(s),e=st.entries[r.id];return{current:merge(r.key?.initial||{},e?.changes||{}),delta:e||null}},
 applyDelta(s,r,changes,reason){const st=ensure(s),p=st.entries[r.id];st.sequence++;st.entries[r.id]={revision:(p?.revision||0)+1,reason,changes:merge(p?.changes||{},changes)};return{ok:true,reason:'ok',entry:C(st.entries[r.id])}},
 serializeState(s){return C(ensure(s))},restoreSerializedState(c,x){stores.set(String(c.seed),C(x));return{ok:true}}
};
global.ProtagonistProfile={derive(s,k='protagonist'){return{protagonistId:'PROTAGONIST-'+H(s+'|'+k+'|identity-v1')}}};
const seed='WP-S014-007-SEED',identity='protagonist',t0='1201-10-01 10:00:00';
let now=t0;global.GameTime={getTimestampKey(){return now}};
global.DailyActivity={build(){return C([
 {id:'R-GUARD',displayName:'Serra',profession:'guard',workplaceId:'GUARD-POST',workplaceLabel:'Village Guard Post'},
 {id:'R-SMITH',displayName:'Marek',profession:'smith',workplaceId:'SMITHY',workplaceLabel:'Village Smithy'}
])}};
global.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{roleId:'local-resident',rankTier:0,scopes:['self']}}}};
const skillsPath=path.resolve(__dirname,'../world/protagonist-skills.js');delete require.cache[require.resolve(skillsPath)];const Skills=require(skillsPath);global.ProtagonistSkills=Skills;
assert(Skills.initialize(seed,identity,t0).ok);
const terminal=new Map();
function terminalRow(id,{targetId='GUARD-POST:yard',action='work',proposalId,status='terminal-success',time='1201-10-01 10:30:00',auth=true}={}){
 const row=Object.freeze({attemptId:id,resultId:'IRX-'+H(id+'|'+targetId+'|'+action),targetKind:'object',targetId,action,updatedFantasyTimestamp:time,status,references:Object.freeze({proposalId}),simulation:Object.freeze({delegate:'SimulationTest',authoritativeTerminalSuccess:status==='terminal-success'&&auth})});terminal.set(id,row);return row;
}
global.ProtagonistInteractionPipeline={claimCompletion(_s,input){const row=terminal.get(input.attemptId);return row?.status==='terminal-success'&&row.simulation.authoritativeTerminalSuccess?{ok:true,interaction:row}:{ok:false,reason:'claimed-success-not-authoritative',interaction:row||null}}};
let healthCalls=0,rewardCalls=0;global.ProtagonistHealth={applyInjury(){healthCalls++;throw new Error('unsupported injury must not be auto-applied')}};global.EconomicTransaction={transfer(){rewardCalls++;throw new Error('unsupported reward must not be auto-granted')}};
const modulePath=path.resolve(__dirname,'../world/protagonist-martial-opportunities.js');delete require.cache[require.resolve(modulePath)];const Martial=require(modulePath);global.ProtagonistMartialOpportunities=Martial;
assert.equal(Martial.VERSION,'protagonist-martial-opportunities-v1');
assert.deepStrictEqual(Martial.KINDS,['training','sparring','tournament']);
const training={
 kind:'training',label:'Yard drill with Serra',hostRef:{kind:'resident',id:'R-GUARD'},locationRef:{kind:'workplace',id:'GUARD-POST'},
 interactionTargetRef:{kind:'object',id:'GUARD-POST:yard'},interactionAction:'work',validFrom:'1201-10-01 09:00:00',validUntil:'1201-10-01 12:00:00',
 validation:{authority:'simulation',authoritative:true,validated:true,operationId:'MARTIAL-OPP-1',sourceRef:{kind:'schedule-event',id:'GUARD-TRAINING-AM'}}
};
const first=Martial.list(seed,'1201-10-01 10:15:00',[training],{},identity);assert.equal(first.length,1);assert(first[0].available,JSON.stringify(first[0]));assert.equal(first[0].kind,'training');assert.equal(first[0].hostRef.id,'R-GUARD');assert.equal(first[0].locationRef.id,'GUARD-POST');assert.equal(first[0].practiceBand,'brief');assert.equal(first[0].interactionProposal.commandId,'advisor.propose_interaction');
const repeated=Martial.list(seed,'1201-10-01 10:15:00',[training],{},identity);assert.deepStrictEqual(repeated,first,'same inputs must replay identically');
assert.equal(Martial.inspectInput(seed,'1201-10-01 10:15:00',{...training,hostRef:{kind:'resident',id:'R-MISSING'}},identity).reason,'host-location-not-grounded');
assert.equal(Martial.inspectInput(seed,'1201-10-01 10:15:00',{...training,locationRef:{kind:'workplace',id:'SMITHY'}},identity).reason,'host-location-not-grounded');
const forged=Martial.inspectInput(seed,'1201-10-01 10:15:00',{...training,validation:{...training.validation,authority:'ui'}},identity);assert(!forged.ok&&forged.reason==='validated-simulation-opportunity-required');
const noEvent=Martial.inspectInput(seed,'1201-10-01 10:15:00',{...training,kind:'tournament',validation:{...training.validation,operationId:'TOURNEY-NO-EVENT'}},identity);assert(!noEvent.ok&&noEvent.reason==='tournament-event-required');
const expiredInput={...training,validFrom:'1201-10-01 07:00:00',validUntil:'1201-10-01 08:00:00',validation:{...training.validation,operationId:'EXPIRED'}};
const expired=Martial.inspectInput(seed,'1201-10-01 10:15:00',expiredInput,identity);assert(expired.ok&&!expired.available&&expired.prerequisites.missing.includes('opportunity-expired'));

const opp=first[0],acceptOptions={authority:'protagonist',protagonistOwned:true,decisionId:'MARTIAL-DECIDE-1',fantasyTimestamp:'1201-10-01 10:15:00'};
const accepted=Martial.evaluate(seed,opp.opportunityId,'accepted',[training],acceptOptions,identity);assert(accepted.ok,JSON.stringify(accepted));assert.equal(accepted.participation.status,'accepted-awaiting-simulation');assert(accepted.interactionProposal);const acceptedDup=Martial.evaluate(seed,opp.opportunityId,'accepted',[training],acceptOptions,identity);assert(acceptedDup.ok&&acceptedDup.duplicate);
const expiredOpp=Martial.list(seed,'1201-10-01 10:15:00',[expiredInput],{},identity)[0];assert(expiredOpp&&!expiredOpp.available);assert.equal(Martial.evaluate(seed,expiredOpp.opportunityId,'accepted',[expiredInput],{...acceptOptions,decisionId:'EXPIRED-ACCEPT'},identity).reason,'missing-prerequisites');
const scheduledCalls=[],commandSnapshot={snapshotId:'SNAP-MARTIAL',context:{seed,when:'1201-10-01 10:15:00'},targets:{people:[{id:'R-GUARD'}],interactions:[{id:'GUARD-POST:yard',personIds:['R-GUARD'],action:'work'}]}};
const scheduled=Martial.schedule(accepted,commandSnapshot,{value:.9,urgency:.55,socialAcceptability:.95},{runtime:{schedule(config){scheduledCalls.push(C(config));return{ok:true,reason:'scheduled-through-runtime',attempt:{attemptId:'PAX-MARTIAL-1'}}}},actorPosition:{x:'1',y:'1',level:0}});
assert(scheduled.ok);assert.equal(scheduledCalls.length,1);assert.equal(scheduledCalls[0].proposal.commandId,'advisor.propose_interaction');assert.equal(scheduled.boundary,'ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation');

const before=Skills.getSkill(seed,'martial',identity);terminalRow('IAX-MARTIAL-1',{proposalId:accepted.interactionProposal.proposalId});
now='1201-10-01 10:31:00';
const completed=Martial.complete(seed,accepted.participation.id,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'MARTIAL-COMPLETE-1',interactionAttemptId:'IAX-MARTIAL-1',fantasyTimestamp:now},identity);
assert(completed.ok,JSON.stringify(completed));assert.equal(completed.reason,'martial-practice-completed');assert.equal(completed.skillAuthority,'ProtagonistSkills');assert.equal(completed.rewardGranted,false);assert.equal(completed.injuryApplied,false);assert.equal(completed.victoryGranted,false);assert.equal(completed.rankGranted,false);
const after=Skills.getSkill(seed,'martial',identity);assert.equal(after.points-before.points,Skills.PRACTICE_BANDS.brief,'training must delegate fixed brief practice only');
const duplicate=Martial.complete(seed,accepted.participation.id,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'MARTIAL-COMPLETE-DUP',interactionAttemptId:'IAX-MARTIAL-1',fantasyTimestamp:'1201-10-01 10:32:00'},identity);assert(duplicate.ok&&duplicate.duplicate);assert.equal(Skills.getSkill(seed,'martial',identity).points,after.points,'duplicate evidence must not award practice twice');

const training2={...training,label:'Second yard drill',interactionTargetRef:{kind:'object',id:'GUARD-POST:yard-2'},validation:{...training.validation,operationId:'MARTIAL-OPP-2',sourceRef:{kind:'schedule-event',id:'GUARD-TRAINING-PM'}}};
const opp2=Martial.list(seed,'1201-10-01 10:35:00',[training2],{},identity)[0];const accepted2=Martial.evaluate(seed,opp2.opportunityId,'accepted',[training2],{...acceptOptions,decisionId:'MARTIAL-DECIDE-2',fantasyTimestamp:'1201-10-01 10:35:00'},identity);assert(accepted2.ok);
terminalRow('IAX-MARTIAL-2',{targetId:'GUARD-POST:yard-2',action:'inspect',proposalId:accepted2.interactionProposal.proposalId,time:'1201-10-01 10:36:00'});
assert.equal(Martial.complete(seed,accepted2.participation.id,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'MARTIAL-COMPLETE-2',interactionAttemptId:'IAX-MARTIAL-2',fantasyTimestamp:'1201-10-01 10:37:00'},identity).reason,'martial-practice-evidence-mismatch');
terminalRow('IAX-MARTIAL-2',{targetId:'GUARD-POST:yard-2',action:'work',proposalId:accepted2.interactionProposal.proposalId,time:'1201-10-01 10:36:00'});
assert.equal(Martial.complete(seed,accepted2.participation.id,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'MARTIAL-FORGED-VICTORY',interactionAttemptId:'IAX-MARTIAL-2',fantasyTimestamp:'1201-10-01 10:37:00',victory:true},identity).reason,'unsupported-outcome-claim');
assert.equal(Martial.complete(seed,accepted2.participation.id,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'MARTIAL-FORGED-REWARD',interactionAttemptId:'IAX-MARTIAL-2',fantasyTimestamp:'1201-10-01 10:37:00',reward:{coins:50}},identity).reason,'unsupported-outcome-claim');
assert.equal(Martial.complete(seed,accepted2.participation.id,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'MARTIAL-FORGED-BAND',interactionAttemptId:'IAX-MARTIAL-2',fantasyTimestamp:'1201-10-01 10:37:00',practiceBand:'intensive'},identity).reason,'unsupported-outcome-claim');
assert.equal(healthCalls,0);assert.equal(rewardCalls,0);

const saved=WorldState.serializeState(seed),skillSaved=C(Skills.snapshot(seed,identity)),auditSaved=C(Martial.snapshot(seed,identity));stores.set(seed,fresh(seed));assert.equal(Martial.snapshot(seed,identity).participationCount,0);WorldState.restoreSerializedState({seed},saved);assert.deepStrictEqual(Martial.snapshot(seed,identity).participations,auditSaved.participations);assert.deepStrictEqual(Skills.snapshot(seed,identity).history,skillSaved.history);
const src=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.','setPosition(','teleport(','EconomicTransaction.transfer','ProtagonistInventory.','ProtagonistHealth.applyInjury','ProtagonistAuthority.transition'])assert(!src.includes(forbidden),'forbidden direct authority/non-determinism: '+forbidden);
for(const required of ['fullWorldScan:false','fullSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','directSkillMutation:false','directHealthMutation:false','directRewardMutation:false','autoVictory:false','venueFabrication:false','eventFabrication:false'])assert(src.includes(required),'missing guard '+required);
const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');assert(html.includes('scripts/world/protagonist-martial-opportunities.js?v=protagonist-martial-opportunities-v1'));
const snap=Martial.snapshot(seed,identity),tele=Martial.telemetry();assert(snap.serializedBytes<=snap.bounds.maxLedgerBytes);assert.equal(snap.fullWorldScan,false);assert.equal(snap.fullSettlementScan,false);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.perFrameScan,false);assert(tele.inputReads<=32);assert(tele.residentReads<=32);
console.log(JSON.stringify({pass:true,wp:'WP-S014-007',classification:'FUNCTIONAL',visual:'N/A',availableTraining:opp.opportunityId,expiredRejected:true,missingHostRejected:true,forgedOpportunityRejected:true,tournamentWithoutEventRejected:true,runtimeBoundary:scheduled.boundary,practiceDelegatedTo:'ProtagonistSkills',practicePointsAwarded:after.points-before.points,duplicateIdempotent:true,forgedVictoryRewardPracticeRejected:true,healthCalls,rewardCalls,saveReload:true,replayStable:true,bounds:snap.bounds,guards:{fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directSkillMutation:false,directHealthMutation:false,directRewardMutation:false,autoVictory:false,venueFabrication:false,eventFabrication:false}},null,2));
