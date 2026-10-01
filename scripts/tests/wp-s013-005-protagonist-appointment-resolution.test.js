const assert=require('assert');
const path=require('path');
const fs=require('fs');
function H(v){let h=2166136261>>>0;for(const ch of String(v??'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
function C(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v))}
let store={},deltaRevision=0;
global.WorldState={
  structuralRef(seed,kind,actor,key){return Object.freeze({id:'REF-'+H([seed,kind,actor,key].join('|')),kind:'structural'});},
  resolve(seed,ref){return {current:C(store[seed]?.[ref.id]||{}),delta:{revision:deltaRevision}};},
  applyDelta(seed,ref,patch,reason){store[seed]??={};store[seed][ref.id]={...(store[seed][ref.id]||{}),...C(patch)};deltaRevision++;return {ok:true,reason:'ok',entry:{revision:deltaRevision,reason}};}
};
global.ProtagonistProfile={derive(seed,key='protagonist'){return {protagonistId:'PROTAGONIST-'+H(seed+'|'+key+'|identity-v1')}}};
const roster=Object.freeze([
  Object.freeze({id:'R01',displayName:'Master Fenn',profession:'smith',workplaceId:'BLD-SMITHY',workplaceLabel:'Village Smithy'}),
  Object.freeze({id:'R02',displayName:'Mira Vale',profession:'shopkeeper',workplaceId:'BLD-SHOP',workplaceLabel:'Village Shop'}),
  Object.freeze({id:'R03',displayName:'Alda Reed',profession:'guard',workplaceId:'BLD-GUARD',workplaceLabel:'Village Guard Post'})
]);
global.DailyActivity={build(){return roster}};
const seed='WP-S013-005-SEED',identity='protagonist';
let currentRole='local-resident',transitionCalls=0;
const history=[];
global.ProtagonistAuthority={
  snapshot(){return {exists:true,currentRole:{roleId:currentRole,scopes:currentRole==='guild-member'?['self','guild:participate']:['self']},history:C(history)};},
  transition(_seed,_identity,targetRole,options){
    transitionCalls++;
    assert.equal(options.authority,'simulation');assert.equal(options.authoritative,true);
    assert.equal(options.evidence.validated,true);assert.equal(options.evidence.type,'legitimate-role-transition');assert.equal(options.evidence.targetRoleId,targetRole);
    if(history.some(x=>x.transitionId===options.transitionId))return {ok:true,reason:'duplicate',duplicate:true,transitionId:options.transitionId,snapshot:this.snapshot()};
    if(targetRole!=='guild-member')return {ok:false,reason:'unsupported-role'};
    const rec={id:'AUTH-'+H(options.transitionId),transitionId:options.transitionId,fromRoleId:currentRole,toRoleId:targetRole,fantasyTimestamp:options.fantasyTimestamp,sourceRef:C(options.evidence.sourceRef)};
    history.push(rec);currentRole=targetRole;return {ok:true,reason:'ok',duplicate:false,transitionId:options.transitionId,transition:rec,snapshot:this.snapshot()};
  }
};
let paymentRows=[{id:'TXN-WAGE-1',direction:'credit',reasonCode:'employment-wage',sourceRef:{kind:'employment-contract',id:'EMP-SMITH'},fantasyTimestamp:'1126-10-01 08:00:00'}];
let employmentAvailable=true;
global.ProtagonistEmployment={
  current(){return employmentAvailable?{ok:true,status:'active',contract:{id:'EMP-SMITH',professionId:'smith',employerRef:{kind:'resident',id:'R01'},workplaceRef:{kind:'building',id:'BLD-SMITHY'},validFrom:'1126-09-01 00:00:00',validUntil:'1126-12-01 00:00:00'}}:null;},
  recentPayments(){return employmentAvailable?C(paymentRows):null;}
};
const terminal=new Map();
function put(id,{targetId='R01',action='accept-appointment',status='terminal-success',time='1126-10-01 09:00:00',auth=true}={}){
  const row=Object.freeze({attemptId:id,resultId:'IRX-'+H(id+'|'+status),actorId:'protagonist',targetKind:'person',targetId,action,startedFantasyTimestamp:time,updatedFantasyTimestamp:time,status,reason:status,references:Object.freeze({}),simulation:Object.freeze({delegate:'SimulationTest',authoritativeTerminalSuccess:status==='terminal-success'&&auth})});terminal.set(id,row);return row;
}
global.ProtagonistInteractionPipeline={claimCompletion(_seed,input){const row=terminal.get(input.attemptId);return row?.status==='terminal-success'&&row.simulation.authoritativeTerminalSuccess?{ok:true,reason:'already-authoritative-terminal-success',interaction:row}:{ok:false,reason:'claimed-success-not-authoritative',interaction:row||null};}};
const modulePath=path.resolve(__dirname,'../world/protagonist-appointment-resolution.js');
delete require.cache[require.resolve(modulePath)];
const Appointment=require(modulePath);global.ProtagonistAppointmentResolution=Appointment;
const when='1126-10-01 09:02:00';
assert.equal(Appointment.VERSION,'protagonist-appointment-resolution-v1');
assert.equal(Appointment.catalog().length,1);assert.equal(Appointment.catalog()[0].targetRoleId,'guild-member');
const eligible=Appointment.eligibility(seed,'guild-member',when,identity);
assert.equal(eligible.status,'eligible');assert(eligible.eligible);assert.deepEqual(eligible.blockers,[]);assert.equal(eligible.currentRoleId,'local-resident');assert.equal(eligible.employment.contractId,'EMP-SMITH');assert.deepEqual(eligible.employment.paymentIds,['TXN-WAGE-1']);assert.equal(transitionCalls,0,'eligibility must never mutate authority');assert.equal(currentRole,'local-resident');
paymentRows=[];const missingWork=Appointment.eligibility(seed,'guild-member',when,identity);assert.equal(missingWork.status,'ineligible');assert(missingWork.blockers.includes('completed-paid-work-required'));assert.equal(transitionCalls,0);paymentRows=[{id:'TXN-WAGE-1',reasonCode:'employment-wage',sourceRef:{kind:'employment-contract',id:'EMP-SMITH'},fantasyTimestamp:'1126-10-01 08:00:00'}];
employmentAvailable=false;const unknown=Appointment.eligibility(seed,'guild-member',when,identity);assert.equal(unknown.status,'unknown');assert.equal(transitionCalls,0);employmentAvailable=true;
assert.equal(Appointment.eligibility(seed,'realm-councillor',when,identity).reason,'target-role-unsupported');
put('IAX-APPT-1',{time:'1126-10-01 09:01:00'});
const baseReq={appointingActorId:'R01',institutionRef:{kind:'building',id:'BLD-SMITHY'},interactionAttemptId:'IAX-APPT-1'};
const baseOpt={authority:'simulation',authoritative:true,operationId:'APPOINT-001',fantasyTimestamp:when};
assert.equal(Appointment.appointment(seed,'guild-member',baseReq,{...baseOpt,authority:'ui'},identity).reason,'simulation-authority-required');
assert.equal(Appointment.appointment(seed,'guild-member',{...baseReq,appointingActorId:'R02'},baseOpt,identity).reason,'appointing-actor-not-authoritative-employer');
assert.equal(Appointment.appointment(seed,'guild-member',{...baseReq,institutionRef:{kind:'building',id:'BLD-SHOP'}},baseOpt,identity).reason,'appointing-institution-not-authoritative-workplace');
put('IAX-WRONG',{targetId:'R01',action:'talk',time:'1126-10-01 09:01:00'});
assert.equal(Appointment.appointment(seed,'guild-member',{...baseReq,interactionAttemptId:'IAX-WRONG'},{...baseOpt,operationId:'APPOINT-WRONG'},identity).reason,'appointment-evidence-mismatch');
put('IAX-STALE',{time:'1126-10-01 08:00:00'});
assert.equal(Appointment.appointment(seed,'guild-member',{...baseReq,interactionAttemptId:'IAX-STALE'},{...baseOpt,operationId:'APPOINT-STALE'},identity).reason,'appointment-evidence-stale');
const appointed=Appointment.appointment(seed,'guild-member',baseReq,baseOpt,identity);
assert(appointed.ok,JSON.stringify(appointed));assert.equal(appointed.reason,'appointed');assert.equal(transitionCalls,1);assert.equal(currentRole,'guild-member');assert.equal(appointed.rankStateOwnedBy,'ProtagonistAuthority');assert.equal(appointed.resolverRankState,false);assert.equal(appointed.resolution.targetRoleId,'guild-member');assert(/^APTR-[0-9A-F]{8}$/.test(appointed.resolution.authorityTransitionId));assert.equal(history.length,1);
const dup=Appointment.appointment(seed,'guild-member',baseReq,baseOpt,identity);assert(dup.ok&&dup.duplicate&&dup.reason==='duplicate-appointment');assert.equal(transitionCalls,1,'duplicate must not call authority transition again');
const conflict=Appointment.appointment(seed,'guild-member',{...baseReq,interactionAttemptId:'IAX-WRONG'},baseOpt,identity);assert(!conflict.ok&&conflict.reason==='duplicate-appointment-conflict');assert.equal(transitionCalls,1);
const snap1=Appointment.snapshot(seed,identity);assert.equal(snap1.resolutionCount,1);assert.equal(snap1.parallelRankState,false);assert.equal(snap1.rankStateAuthority,'ProtagonistAuthority only');assert.equal(snap1.fullWorldScan,false);assert.equal(snap1.fullSettlementScan,false);assert.equal(snap1.wholeHistoryScan,false);assert.equal(snap1.perFrameScan,false);assert(snap1.serializedBytes<=snap1.bounds.maxLedgerBytes);
store=C(store);const snap2=Appointment.snapshot(seed,identity);assert.deepEqual(snap2.resolutions,snap1.resolutions,'audit must survive save/reload');assert.equal(Appointment.snapshot('OTHER-SEED',identity).resolutionCount,0,'campaigns must remain isolated');
const indexPath=path.resolve(__dirname,'../../index.html');
if(fs.existsSync(indexPath)){
 const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/protagonist-appointment-resolution.js?v=protagonist-appointment-resolution-v1';
 assert(html.includes(script),'canonical root must load appointment resolver');
 assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-authority.js?v=protagonist-authority-v1'));
 assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-employment.js?v=protagonist-employment-v1'));
 assert(html.indexOf(script)<html.indexOf('scripts/world/protagonist-service-contracts.js?v=protagonist-service-contracts-v1'));
}
console.log(JSON.stringify({pass:true,version:Appointment.VERSION,catalog:Appointment.catalog().map(x=>x.targetRoleId),resolutionCount:snap2.resolutionCount,authorityTransitions:transitionCalls,bounds:snap2.bounds,guards:{parallelRankState:false,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directRankMutation:false}},null,2));