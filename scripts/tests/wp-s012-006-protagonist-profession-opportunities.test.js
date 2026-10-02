'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const C=v=>v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(C):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]));
function merge(a,b){const out=C(a||{});for(const[k,v]of Object.entries(b||{}))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k],v):C(v);return out}
function H(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
const stores=new Map(),fresh=s=>({schema:'CampaignStateDelta',seed:s,sequence:0,entries:{}}),ensure=s=>(stores.has(s)||stores.set(s,fresh(s)),stores.get(s));
global.WorldState={
  structuralRef(s,k,p,keyName,initial){return{id:'STR|'+String(k).toUpperCase()+'|'+H([s,k,p,keyName].join('|')),kind:k,key:{initial:C(initial||{})}}},
  resolve(s,r){const st=ensure(s),e=st.entries[r.id]||null;return{current:merge(r.key?.initial||{},e?.changes||{}),delta:e}},
  applyDelta(s,r,changes,reason){const st=ensure(s),prev=st.entries[r.id];st.sequence++;st.entries[r.id]={entityId:r.id,entityKind:r.kind,revision:(prev?.revision||0)+1,sequence:st.sequence,reason,changes:merge(prev?.changes||{},changes)};return{ok:true,reason:'ok',entry:C(st.entries[r.id]),resolved:this.resolve(s,r)}},
  serializeState(s){return C(ensure(s))},
  restoreSerializedState(c,x){stores.set(String(c.seed),C(x));return{ok:true}}
};
global.ProtagonistProfile={derive(s,k='protagonist'){return{protagonistId:'PROTAGONIST-'+H(s+'|'+k+'|identity-v1')}}};
function resident(id,name,profession,workplaceId,workplaceLabel,objId){
  return Object.freeze({id,displayName:name,name,profession,workplaceId,workplaceLabel,workplaceObjectId:objId,schedule:Object.freeze([
    Object.freeze({state:'work',startMinute:480,endMinute:720}),
    Object.freeze({state:'work',startMinute:780,endMinute:1020})
  ])});
}
const fullRoster=Object.freeze([
  resident('R01','Alda Ironwood','smith','S3','Craft Workshop','S3:workbench:1'),
  resident('R02','Bren Moss','woodcutter','S7','Outdoor Workyard','S7:work:1'),
  resident('R03','Cera Vale','shopkeeper','S2','Village Shop','S2:counter:1'),
  resident('R04','Dain Reed','farmer','S5','Farm Barn','S5:work:1'),
  resident('R05','Eris Stone','guard','S6','Village Meeting Hall','S6:desk:1'),
  resident('R06','Fenn Hearth','innkeeper','S1','Tavern & Lodging','S1:counter:1')
]);
let currentRoster=fullRoster;
global.DailyActivity={build(){return currentRoster}};
let scopes=['self'];
global.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{roleId:scopes.includes('guild:participate')?'guild-member':'local-resident',scopes:[...scopes]}}}};
const terminal=new Map();
global.ProtagonistInteractionPipeline={claimCompletion(_s,input){const id=input.resultId||input.attemptId,row=terminal.get(id);return row?{ok:true,reason:'ok',interaction:C(row)}:{ok:false,reason:'authoritative-application-completion-required'}}};

const Employment=require(path.resolve(__dirname,'../world/protagonist-employment.js'));global.ProtagonistEmployment=Employment;
const modulePath=path.resolve(__dirname,'../world/protagonist-profession-opportunities.js');
delete require.cache[require.resolve(modulePath)];
let Career=require(modulePath);global.ProtagonistProfessionOpportunities=Career;
const seed='WP-S012-006-A',other='WP-S012-006-B',when='1201-05-01 09:00:00';
const protagonist=(decisionId,t=when)=>({authority:'protagonist',protagonistOwned:true,decisionId,fantasyTimestamp:t});
const sim=(operationId,t)=>({authority:'simulation',authoritative:true,campaignSeed:seed,operationId,fantasyTimestamp:t});

const catalogA=Career.list(seed,when,{limit:12}),catalogB=Career.list(seed,when,{limit:12});
assert.deepStrictEqual(catalogB,catalogA,'same SEED/time/roster must replay identically');
assert(catalogA.length>=8&&catalogA.length<=Career.MAX_OPPORTUNITIES);
assert(catalogA.every(x=>x.employerRef?.kind==='resident'&&x.workplaceRef?.kind==='workplace'&&x.professionId&&x.workBlocks.length&&x.workTargetIds.length));
const apprentice=catalogA.find(x=>x.kind==='apprenticeship'&&x.open);
const job=catalogA.find(x=>x.kind==='job'&&x.open);
assert(apprentice&&job,'bounded catalog must expose open apprenticeship and job paths');

const missing=Career.evaluate(seed,job.opportunityId,'accepted',protagonist('DEC-MISSING'));
assert(!missing.ok&&missing.reason==='missing-prerequisites'&&missing.missing.includes('guild:participate'));
const rejected=Career.evaluate(seed,job.opportunityId,'rejected',protagonist('DEC-REJECT'));
assert(rejected.ok&&rejected.application.decision==='rejected'&&rejected.application.status==='rejected');
const deferred=Career.evaluate(seed,apprentice.opportunityId,'deferred',protagonist('DEC-DEFER'));
assert(deferred.ok&&deferred.application.decision==='deferred'&&deferred.application.status==='deferred');
const accepted=Career.evaluate(seed,apprentice.opportunityId,'accepted',protagonist('DEC-ACCEPT'));
assert(accepted.ok&&!accepted.duplicate&&accepted.application.status==='accepted-awaiting-simulation');
const acceptedDup=Career.evaluate(seed,apprentice.opportunityId,'accepted',protagonist('DEC-ACCEPT'));
assert(acceptedDup.ok&&acceptedDup.duplicate&&acceptedDup.application.id===accepted.application.id);
const conflict=Career.evaluate(seed,apprentice.opportunityId,'rejected',protagonist('DEC-ACCEPT'));
assert(!conflict.ok&&conflict.reason==='duplicate-decision-conflict');

const otherApprentice=catalogA.find(x=>x.kind==='apprenticeship'&&x.open&&x.employerRef.id!==apprentice.employerRef.id);
assert(otherApprentice);
const disappearing=Career.evaluate(seed,otherApprentice.opportunityId,'accepted',protagonist('DEC-DISAPPEAR'));
assert(disappearing.ok);
currentRoster=Object.freeze(fullRoster.filter(x=>x.id!==otherApprentice.employerRef.id));
terminal.set('IRX-DISAPPEAR',{resultId:'IRX-DISAPPEAR',attemptId:'IAX-DISAPPEAR',targetId:otherApprentice.employerRef.id,action:'speak',status:'terminal-success',updatedFantasyTimestamp:'1201-05-01 10:00:00',simulation:{authoritativeTerminalSuccess:true}});
const unavailable=Career.complete(seed,disappearing.application.id,{simulationResultId:'IRX-DISAPPEAR'},sim('SIM-DISAPPEAR','1201-05-01 10:01:00'));
assert(!unavailable.ok&&unavailable.reason==='employer-unavailable');
currentRoster=fullRoster;

const forged=Career.complete(seed,accepted.application.id,{simulationResultId:'IRX-NOT-REAL'},sim('SIM-FORGED','1201-05-01 10:01:00'));
assert(!forged.ok&&forged.reason==='authoritative-application-completion-required');
terminal.set('IRX-CAREER',{resultId:'IRX-CAREER',attemptId:'IAX-CAREER',targetId:apprentice.employerRef.id,action:'speak',status:'terminal-success',updatedFantasyTimestamp:'1201-05-01 10:00:00',simulation:{authoritativeTerminalSuccess:true}});
const beforeAuthority=JSON.stringify(global.ProtagonistAuthority.snapshot());
const completed=Career.complete(seed,accepted.application.id,{simulationResultId:'IRX-CAREER'},sim('SIM-CAREER','1201-05-01 10:01:00'));
assert(completed.ok&&!completed.duplicate&&/^EMP-/.test(completed.employmentContractId));
assert.deepStrictEqual(completed.transitionRef,{kind:'employment-contract',id:completed.employmentContractId});
assert.equal(completed.authorityTransitionPerformed,false);
assert.equal(JSON.stringify(global.ProtagonistAuthority.snapshot()),beforeAuthority,'career transition must not mutate legitimate role authority');
const employment=Employment.current(seed,'1201-05-01 10:02:00');
assert(employment.ok&&employment.status==='active'&&employment.contract.id===completed.employmentContractId&&employment.contract.professionId===apprentice.professionId);
const completionDup=Career.complete(seed,accepted.application.id,{simulationResultId:'IRX-CAREER'},sim('SIM-CAREER-DUP','1201-05-01 10:03:00'));
assert(completionDup.ok&&completionDup.duplicate&&completionDup.employmentContractId===completed.employmentContractId);

scopes=['self','guild:participate'];
const jobNow=Career.get(seed,'1201-06-01 09:00:00',job.opportunityId);
assert(jobNow&&jobNow.prerequisites.requiredAuthorityScopes.includes('guild:participate'));
const jobAccepted=Career.evaluate(seed,job.opportunityId,'accepted',protagonist('DEC-JOB','1201-06-01 09:00:00'));
assert(jobAccepted.ok&&jobAccepted.application.decision==='accepted');

const saved=C(WorldState.serializeState(seed)),preReload=Career.snapshot(seed),preApplications=Career.applications(seed,{limit:12});
stores.set(seed,fresh(seed));delete require.cache[require.resolve(modulePath)];Career=require(modulePath);global.ProtagonistProfessionOpportunities=Career;
assert.equal(Career.snapshot(seed).applicationCount,0);
WorldState.restoreSerializedState({seed},saved);
assert.deepStrictEqual(Career.snapshot(seed),preReload);
assert.deepStrictEqual(Career.applications(seed,{limit:12}),preApplications);
const otherSnap=Career.snapshot(other);assert(otherSnap.compatible&&otherSnap.applicationCount===0);

const finalSnap=Career.snapshot(seed);
assert(finalSnap.applicationCount<=Career.MAX_APPLICATIONS&&finalSnap.serializedBytes<=Career.MAX_LEDGER_BYTES);
for(const key of ['fullWorldScan','fullSettlementScan','wholeRosterScan','wholeHistoryScan','perFrameOpportunityGeneration','directEmploymentMutation','directProfessionGrant','directAuthorityMutation','directWorldMutation','directPositionMutation','uiGrantAuthority','advisorGrantAuthority','llmGrantAuthority'])assert.equal(finalSnap[key],false,key+' must remain false');
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),script='scripts/world/protagonist-profession-opportunities.js?v=protagonist-profession-opportunities-v1';
assert(html.includes(script)&&html.indexOf(script)>html.indexOf('scripts/world/protagonist-employment.js?v=protagonist-employment-v1'));
const source=fs.readFileSync(modulePath,'utf8');
for(const bad of ['Math.random(','Date.now(','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(bad),'forbidden non-authoritative input '+bad);
assert(!source.includes('ProtagonistAuthority.transition'),'pipeline must never grant legitimate authority');
for(const marker of ['fullSettlementScan:false','wholeRosterScan:false','perFrameOpportunityGeneration:false','directProfessionGrant:false','directAuthorityMutation:false'])assert(source.includes(marker),'missing guard '+marker);

console.log(JSON.stringify({
  wp:'WP-S012-006',classification:'FUNCTIONAL',visual:'N/A — profession opportunity/application authority adds no rendered surface',pass:true,
  deterministicReplay:true,groundedOpportunity:apprentice.opportunityId,missingPrerequisiteRejected:true,
  decisions:{accepted:accepted.application.id,deferred:deferred.application.id,rejected:rejected.application.id},
  unavailableEmployerRejected:true,forgedSimulationRejected:true,transitionRef:completed.transitionRef,
  employmentContractId:completed.employmentContractId,authorityTransitionPerformed:false,saveReload:true,campaignIsolation:true,
  bounds:finalSnap.bounds,fullWorldScan:false,fullSettlementScan:false,wholeRosterScan:false,perFrameOpportunityGeneration:false,
  directProfessionGrant:false,directAuthorityMutation:false
},null,2));
