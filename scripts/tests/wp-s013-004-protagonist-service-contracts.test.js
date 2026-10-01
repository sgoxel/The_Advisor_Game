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
  Object.freeze({id:'R01',displayName:'Aldren Ward',profession:'guard',workFunction:'guard-post',workplaceId:'GUARD_POST',workplaceLabel:'Village Guard Post'}),
  Object.freeze({id:'R02',displayName:'Mira Vale',profession:'shopkeeper',workFunction:'shop',workplaceId:'SHOP',workplaceLabel:'Village Shop'}),
  Object.freeze({id:'R03',displayName:'Edda Moss',profession:'tavern-keeper',workFunction:'tavern',workplaceId:'TAVERN',workplaceLabel:'Village Tavern'})
]);
global.DailyActivity={build(){return roster}};
let authorityReads=0;
global.ProtagonistAuthority={snapshot(){authorityReads++;return Object.freeze({exists:true,currentRole:Object.freeze({roleId:'local-resident',rankTier:0,scopes:Object.freeze(['self'])})})}};
global.ProtagonistEmployment={activate(){throw new Error('service contract must not activate employment')},settle(){throw new Error('service contract must not mint wages')}};
global.ProtagonistWealth={apply(){throw new Error('service contract must not mutate wealth')}};
const terminal=new Map();
function put(id,{targetId,action,status='terminal-success',time='1126-10-01 08:00:00',kind='person',auth=true}){
  const row=Object.freeze({attemptId:id,resultId:'IRX-'+H(id+'|'+status),actorId:'protagonist',targetKind:kind,targetId,action,startedFantasyTimestamp:time,updatedFantasyTimestamp:time,status,reason:status,references:Object.freeze({}),simulation:Object.freeze({delegate:'SimulationTest',authoritativeTerminalSuccess:status==='terminal-success'&&auth})});
  terminal.set(id,row);return row;
}
global.ProtagonistInteractionPipeline={
  claimCompletion(_seed,input){const row=terminal.get(input.attemptId||input.resultId);return row?.status==='terminal-success'&&row.simulation.authoritativeTerminalSuccess?{ok:true,reason:'already-authoritative-terminal-success',interaction:row}:{ok:false,reason:'claimed-success-not-authoritative',interaction:row||null};},
  get(_seed,id){return terminal.get(id)||null;}
};
const modulePath=path.resolve(__dirname,'../world/protagonist-service-contracts.js');
delete require.cache[require.resolve(modulePath)];
const Service=require(modulePath);global.ProtagonistServiceContracts=Service;
const seed='SERVICE-CONTRACT-SEED',idKey='protagonist',t0='1126-10-01 08:00:00';
assert.equal(Service.VERSION,'protagonist-service-contracts-v1');
assert.deepEqual(Object.keys(Service.ROLE_DEFS).sort(),['household-retainer','squire']);
assert.equal(Service.snapshot(seed,idKey).contractCount,0);

put('IAX-ACCEPT1',{targetId:'R01',action:'accept-service',time:t0});
const activated=Service.activate(seed,{patronId:'R01',roleType:'squire'},{authority:'simulation',authoritative:true,operationId:'ACT-001',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-ACCEPT1'},idKey);
assert(activated.ok,JSON.stringify(activated));
assert(/^SVC-[0-9A-F]{8}$/.test(activated.contract.id));
assert.equal(activated.contract.state,'active');
assert.equal(activated.contract.patronRef.id,'R01');
assert.equal(activated.contract.organizationRef.id,'GUARD_POST');
assert.equal(activated.contract.duties.length,3);
assert.equal(activated.contract.authorityGrant,false);
assert.equal(activated.contract.rankGrant,false);
assert.equal(activated.contract.wealthMutation,false);
assert.equal(activated.contract.compensationAuthority,'ProtagonistEmployment/EconomicTransaction only');
const contractId=activated.contract.id;
const dup=Service.activate(seed,{patronId:'R01',roleType:'squire'},{authority:'simulation',authoritative:true,operationId:'ACT-001',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-ACCEPT1'},idKey);
assert(dup.ok&&dup.duplicate&&dup.reason==='duplicate-activation');
const conflict=Service.activate(seed,{patronId:'R01',roleType:'household-retainer'},{authority:'simulation',authoritative:true,operationId:'ACT-001',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-ACCEPT1'},idKey);
assert(!conflict.ok&&conflict.reason==='duplicate-activation-conflict');
assert.equal(Service.activate(seed,{patronId:'R99',roleType:'squire'},{authority:'simulation',authoritative:true,operationId:'ACT-X',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-ACCEPT1'},idKey).reason,'patron-unavailable');
assert.equal(Service.activate(seed,{patronId:'R02',roleType:'squire'},{authority:'simulation',authoritative:true,operationId:'ACT-X2',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-ACCEPT1'},idKey).reason,'patron-role-not-qualified');
assert.equal(Service.activate(seed,{patronId:'R01',roleType:'squire'},{authority:'ui',authoritative:true,operationId:'ACT-X3',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-ACCEPT1'},idKey).reason,'simulation-authority-required');
assert.equal(Service.activate(seed,{patronId:'R01',roleType:'squire'},{authority:'simulation',authoritative:true,operationId:'ACT-X4',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-NOPE'},idKey).reason,'authoritative-service-acceptance-required');
put('IAX-STALE',{targetId:'R01',action:'accept-service',time:'1126-10-01 07:00:00'});
assert.equal(Service.activate(seed,{patronId:'R01',roleType:'squire'},{authority:'simulation',authoritative:true,operationId:'ACT-X5',fantasyTimestamp:t0,acceptanceAttemptId:'IAX-STALE'},idKey).reason,'acceptance-evidence-stale');
put('IAX-ACCEPT2',{targetId:'R01',action:'accept-service',time:'1126-10-01 08:01:00'});
assert.equal(Service.activate(seed,{patronId:'R01',roleType:'household-retainer'},{authority:'simulation',authoritative:true,operationId:'ACT-002',fantasyTimestamp:'1126-10-01 08:01:00',acceptanceAttemptId:'IAX-ACCEPT2'},idKey).reason,'active-service-contract-exists');

const duty=Service.dutyContext(seed,'1126-10-01 08:30:00',idKey);
assert(duty.available&&duty.duties.length===3);
assert(duty.duties.every(x=>x.dueNow===true));
assert.deepEqual(duty.duties.map(x=>x.dutyId),['attend-patron','equipment-care','training-service']);
assert.deepEqual(duty.coveredTargetRefs.map(x=>x.id),['R01','GUARD_POST']);
assert.equal(duty.currentAuthority.source,'ProtagonistAuthority');
assert.deepEqual(duty.currentAuthority.scopes,['self']);
assert.equal(duty.authorityGrantedByContract,false);
const offDuty=Service.dutyContext(seed,'1126-10-01 23:30:00',idKey);
assert(offDuty.duties.every(x=>x.dueNow===false));

put('IAX-DUTY1',{targetId:'R01',action:'service-duty',time:'1126-10-01 08:40:00'});
const completed=Service.recordResult(seed,contractId,'attend-patron','completed',{authority:'simulation',authoritative:true,operationId:'RES-001',fantasyTimestamp:'1126-10-01 08:40:00',interactionAttemptId:'IAX-DUTY1'},idKey);
assert(completed.ok&&completed.result.resultState==='completed');
assert.equal(completed.result.simulationStatus,'terminal-success');
const dupResult=Service.recordResult(seed,contractId,'attend-patron','completed',{authority:'simulation',authoritative:true,operationId:'RES-001',fantasyTimestamp:'1126-10-01 08:40:00',interactionAttemptId:'IAX-DUTY1'},idKey);
assert(dupResult.ok&&dupResult.duplicate);
const resultConflict=Service.recordResult(seed,contractId,'equipment-care','completed',{authority:'simulation',authoritative:true,operationId:'RES-001',fantasyTimestamp:'1126-10-01 08:40:00',interactionAttemptId:'IAX-DUTY1'},idKey);
assert(!resultConflict.ok&&resultConflict.reason==='duplicate-service-result-conflict');
put('IAX-REJECT',{targetId:'GUARD_POST',action:'service-duty',status:'rejected',time:'1126-10-01 09:00:00',kind:'building',auth:false});
const rejected=Service.recordResult(seed,contractId,'equipment-care','rejected',{authority:'simulation',authoritative:true,operationId:'RES-002',fantasyTimestamp:'1126-10-01 09:00:00',interactionAttemptId:'IAX-REJECT'},idKey);
assert(rejected.ok&&rejected.result.resultState==='rejected');
put('IAX-VIOL',{targetId:'GUARD_POST',action:'service-duty',status:'failed',time:'1126-10-01 09:10:00',kind:'building',auth:false});
const violated=Service.recordResult(seed,contractId,'training-service','violated',{authority:'simulation',authoritative:true,operationId:'RES-003',fantasyTimestamp:'1126-10-01 09:10:00',interactionAttemptId:'IAX-VIOL'},idKey);
assert(violated.ok&&violated.result.resultState==='violated');
assert.equal(Service.recordResult(seed,contractId,'not-covered','completed',{authority:'simulation',authoritative:true,operationId:'RES-X',fantasyTimestamp:'1126-10-01 09:10:00',interactionAttemptId:'IAX-DUTY1'},idKey).reason,'duty-not-covered-by-contract');
put('IAX-WRONGTARGET',{targetId:'SHOP',action:'service-duty',time:'1126-10-01 09:20:00',kind:'building'});
assert.equal(Service.recordResult(seed,contractId,'attend-patron','completed',{authority:'simulation',authoritative:true,operationId:'RES-X2',fantasyTimestamp:'1126-10-01 09:20:00',interactionAttemptId:'IAX-WRONGTARGET'},idKey).reason,'service-result-target-not-covered');

const beforeReload=Service.snapshot(seed,idKey);store=C(store);const afterReload=Service.snapshot(seed,idKey);
assert.deepEqual(afterReload.contracts,beforeReload.contracts);assert.deepEqual(afterReload.results,beforeReload.results);
assert.equal(afterReload.resultCount,3);
assert.equal(afterReload.fullWorldScan,false);assert.equal(afterReload.fullSettlementScan,false);assert.equal(afterReload.wholeHistoryScan,false);assert.equal(afterReload.perFrameScan,false);assert.equal(afterReload.directAuthorityMutation,false);assert.equal(afterReload.directRankMutation,false);assert.equal(afterReload.directWealthMutation,false);assert.equal(afterReload.resourceFabrication,false);assert(afterReload.serializedBytes<=afterReload.bounds.maxLedgerBytes);

put('IAX-END',{targetId:'R01',action:'end-service',time:'1126-10-01 10:00:00'});
const ended=Service.end(seed,contractId,'completed',{authority:'simulation',authoritative:true,operationId:'END-001',fantasyTimestamp:'1126-10-01 10:00:00',interactionAttemptId:'IAX-END'},idKey);
assert(ended.ok&&ended.contract.state==='ended');
assert.equal(Service.current(seed,'1126-10-01 10:01:00',idKey),null);
const endDup=Service.end(seed,contractId,'completed',{authority:'simulation',authoritative:true,operationId:'END-001',fantasyTimestamp:'1126-10-01 10:00:00',interactionAttemptId:'IAX-END'},idKey);
assert(endDup.ok&&endDup.duplicate);
put('IAX-ACCEPT3',{targetId:'R01',action:'accept-service',time:'1126-10-01 10:05:00'});
const retainer=Service.activate(seed,{patronId:'R01',roleType:'household-retainer'},{authority:'simulation',authoritative:true,operationId:'ACT-003',fantasyTimestamp:'1126-10-01 10:05:00',acceptanceAttemptId:'IAX-ACCEPT3'},idKey);
assert(retainer.ok&&retainer.contract.roleType==='household-retainer');
assert.equal(Service.snapshot(seed,idKey).contractCount,2);
assert.equal(Service.snapshot('OTHER-SEED',idKey).contractCount,0,'campaigns must remain isolated');
assert(authorityReads>0,'authority is read-only context and should be queried');

const indexPath=path.resolve(__dirname,'../../index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/protagonist-service-contracts.js?v=protagonist-service-contracts-v1';
  assert(html.includes(script),'canonical root must load ProtagonistServiceContracts');
  assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-interaction-pipeline.js?v=protagonist-interaction-pipeline-v1'),'service contracts must load after the Simulation interaction boundary');
  assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-authority.js?v=protagonist-authority-v1'),'service contracts must load after legitimate authority');
  assert(html.indexOf(script)<html.indexOf('scripts/world/protagonist-patronage-opportunities.js?v=protagonist-patronage-opportunities-v1'),'service contracts must remain independent of later Stage 13 patronage work');
}

console.log(JSON.stringify({
  pass:true,
  version:Service.VERSION,
  activeRole:retainer.contract.roleType,
  contracts:Service.snapshot(seed,idKey).contractCount,
  results:Service.snapshot(seed,idKey).resultCount,
  bounds:Service.snapshot(seed,idKey).bounds,
  guards:{fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directAuthorityMutation:false,directRankMutation:false,directWealthMutation:false}
},null,2));
