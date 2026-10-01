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
 Object.freeze({id:'R02',displayName:'Mira Vale',profession:'shopkeeper',workplaceId:'BLD-SHOP',workplaceLabel:'Village Shop'})
]);
global.DailyActivity={build(){return roster}};
const seed='WP-S013-006-SEED',identity='protagonist';
let authorityRole='guild-member',authorityScopes=['self','guild:participate'];
const authorityHistory=[{id:'AUTH-001',transitionId:'APTR-GUILD-001',fromRoleId:'local-resident',toRoleId:'guild-member',fantasyTimestamp:'1126-10-01 08:30:00',sourceRef:{kind:'workplace',id:'BLD-SMITHY'}}];
let authorityReads=0;
global.ProtagonistAuthority={
 snapshot(){authorityReads++;return {exists:true,currentRole:{roleId:authorityRole,scopes:C(authorityScopes)},history:C(authorityHistory)};}
};
global.ProtagonistEmployment={
 current(){return {ok:true,status:'active',contract:{id:'EMP-SMITH',professionId:'smith',employerRef:{kind:'resident',id:'R01'},workplaceRef:{kind:'workplace',id:'BLD-SMITHY'}}};}
};
const interactions=new Map();
function put(id,{targetId='R01',action='swear-oath',status='terminal-success',time='1126-10-01 09:00:00',auth=true}={}){
 const row=Object.freeze({attemptId:id,resultId:'IRX-'+H(id+'|'+status),actorId:'protagonist',targetKind:'person',targetId,action,updatedFantasyTimestamp:time,status,simulation:Object.freeze({delegate:'SimulationTest',authoritativeTerminalSuccess:status==='terminal-success'&&auth})});interactions.set(id,row);return row;
}
global.ProtagonistInteractionPipeline={
 claimCompletion(_seed,input){const row=interactions.get(input.attemptId);return row?.status==='terminal-success'&&row.simulation.authoritativeTerminalSuccess?{ok:true,interaction:row}:{ok:false,reason:'claimed-success-not-authoritative',interaction:row||null};},
 get(_seed,id){return interactions.get(id)||null;}
};
const modulePath=path.resolve(__dirname,'../world/protagonist-oath-allegiance.js');
delete require.cache[require.resolve(modulePath)];
const Oath=require(modulePath);global.ProtagonistOathAllegiance=Oath;
assert.equal(Oath.VERSION,'protagonist-oath-allegiance-v1');
const when='1126-10-01 09:02:00';
put('IAX-OATH-1',{time:'1126-10-01 09:01:00'});
const request={counterpartActorId:'R01',institutionRef:{kind:'workplace',id:'BLD-SMITHY'},authorityScopes:['guild:participate'],obligationRefs:[{kind:'employment-contract',id:'EMP-SMITH'}],interactionAttemptId:'IAX-OATH-1'};
const options={authority:'simulation',authoritative:true,operationId:'OATH-OP-001',fantasyTimestamp:when};
assert.equal(Oath.create(seed,request,{...options,authority:'ui'},identity).reason,'simulation-authority-required');
assert.equal(Oath.create(seed,{...request,counterpartActorId:'R99'},options,identity).reason,'counterpart-not-grounded');
assert.equal(Oath.create(seed,{...request,institutionRef:{kind:'workplace',id:'BLD-SHOP'}},options,identity).reason,'counterpart-institution-mismatch');
assert.equal(Oath.create(seed,{...request,authorityScopes:['realm:advise']},options,identity).reason,'oath-scope-not-currently-authorized');
const oldHistory=C(authorityHistory);authorityHistory.length=0;
assert.equal(Oath.create(seed,request,options,identity).reason,'authority-transition-proof-required');
authorityHistory.push(...oldHistory);
assert.equal(Oath.create(seed,{...request,obligationRefs:[{kind:'invented-duty',id:'DO-WHATEVER'}]},options,identity).reason,'unsupported-obligation-reference');
put('IAX-STALE',{time:'1126-10-01 08:00:00'});
assert.equal(Oath.create(seed,{...request,interactionAttemptId:'IAX-STALE'},{...options,operationId:'OATH-STALE'},identity).reason,'oath-evidence-stale');
const made=Oath.create(seed,request,options,identity);
assert(made.ok,JSON.stringify(made));assert.equal(made.oath.state,'active');assert.deepEqual(made.oath.authorityScopes,['guild:participate']);assert.deepEqual(made.oath.authorityTransitionIds,['APTR-GUILD-001']);assert.deepEqual(made.oath.obligationRefs,[{kind:'employment-contract',id:'EMP-SMITH'}]);assert.equal(made.oath.relationshipMutation,false);assert.equal(made.oath.authorityMutation,false);
const dup=Oath.create(seed,request,options,identity);assert(dup.ok&&dup.duplicate&&dup.reason==='duplicate-oath');
put('IAX-OATH-ALT',{time:'1126-10-01 09:01:00'});
const conflict=Oath.create(seed,{...request,interactionAttemptId:'IAX-OATH-ALT'},options,identity);assert(!conflict.ok&&conflict.reason==='duplicate-oath-conflict');
let context=Oath.currentContext(seed,identity);assert(context.available);assert.deepEqual(context.authorityScopes,['guild:participate']);assert.deepEqual(context.obligationRefs,[{kind:'employment-contract',id:'EMP-SMITH'}]);assert.equal(context.oaths[0].authorityStillBacked,true);assert.equal(context.relationshipSource,'SocialState only');
authorityRole='local-resident';authorityScopes=['self'];context=Oath.currentContext(seed,identity);assert.deepEqual(context.authorityScopes,[]);assert.equal(context.oaths[0].authorityStillBacked,false,'oath must not preserve authority after ProtagonistAuthority no longer backs it');authorityRole='guild-member';authorityScopes=['self','guild:participate'];
const beforeReload=Oath.snapshot(seed,identity);store=C(store);const afterReload=Oath.snapshot(seed,identity);assert.deepEqual(afterReload.oaths,beforeReload.oaths);assert.equal(afterReload.fullWorldScan,false);assert.equal(afterReload.fullSettlementScan,false);assert.equal(afterReload.wholeHistoryScan,false);assert.equal(afterReload.perFrameScan,false);assert.equal(afterReload.directAuthorityMutation,false);assert.equal(afterReload.directRelationshipMutation,false);assert(afterReload.serializedBytes<=afterReload.bounds.maxLedgerBytes);
put('IAX-END-1',{action:'end-oath',time:'1126-10-01 09:20:00'});
const ended=Oath.end(seed,made.oath.id,'released',{authority:'simulation',authoritative:true,operationId:'OATH-END-001',fantasyTimestamp:'1126-10-01 09:21:00',interactionAttemptId:'IAX-END-1'},identity);
assert(ended.ok&&ended.oath.state==='ended'&&ended.historyRetained);
const endDup=Oath.end(seed,made.oath.id,'released',{authority:'simulation',authoritative:true,operationId:'OATH-END-001',fantasyTimestamp:'1126-10-01 09:21:00',interactionAttemptId:'IAX-END-1'},identity);assert(endDup.ok&&endDup.duplicate);
put('IAX-OATH-2',{time:'1126-10-01 09:30:00'});
const made2=Oath.create(seed,{...request,interactionAttemptId:'IAX-OATH-2'},{authority:'simulation',authoritative:true,operationId:'OATH-OP-002',fantasyTimestamp:'1126-10-01 09:31:00'},identity);assert(made2.ok);
put('IAX-BREAK-2',{action:'break-oath',status:'failed',time:'1126-10-01 09:40:00',auth:false});
const breached=Oath.end(seed,made2.oath.id,'breached',{authority:'simulation',authoritative:true,operationId:'OATH-END-002',fantasyTimestamp:'1126-10-01 09:41:00',interactionAttemptId:'IAX-BREAK-2'},identity);
assert(breached.ok&&breached.oath.state==='breached');assert.equal(Oath.snapshot(seed,identity).oathCount,2);assert.equal(Oath.snapshot(seed,identity).activeCount,0);
assert.equal(Oath.snapshot('OTHER-SEED',identity).oathCount,0,'campaigns must remain isolated');assert(authorityReads>0);
const indexPath=path.resolve(__dirname,'../../index.html');
if(fs.existsSync(indexPath)){
 const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/protagonist-oath-allegiance.js?v=protagonist-oath-allegiance-v1';
 assert(html.includes(script),'canonical root must load oath/allegiance ledger');
 assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-authority.js?v=protagonist-authority-v1'),'oath ledger must load after ProtagonistAuthority');
 assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-employment.js?v=protagonist-employment-v1'),'oath ledger must load after Stage-12 employment authority');
 assert(html.indexOf(script)<html.indexOf('scripts/world/protagonist-appointment-resolution.js?v=protagonist-appointment-resolution-v1'),'oath ledger must remain independent of later Stage-13 appointment logic');
}
console.log(JSON.stringify({pass:true,version:Oath.VERSION,oathCount:Oath.snapshot(seed,identity).oathCount,states:Oath.snapshot(seed,identity).oaths.map(x=>x.state),bounds:Oath.snapshot(seed,identity).bounds,guards:{authorityOwnedBy:'ProtagonistAuthority',relationshipOwnedBy:'SocialState',fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directAuthorityMutation:false,directRelationshipMutation:false}},null,2));