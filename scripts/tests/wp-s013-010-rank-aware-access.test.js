'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const seed='WP-S013-010-A',when='1201-05-01 10:00:00';
let role={roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']},socialWrites=0,actionCalls=0,memoryReads=0,referenceReads=0;
global.GameTime={getTimestampKey(){return when}};
global.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{...role,scopes:[...role.scopes]}}}};
global.ProtagonistStatusObligations={decisionContext(){return{ok:true,role:{...role,scopes:[...role.scopes]},readOnly:true}}};
global.CharacterMemory={
  recognition(_s,id){memoryReads++;return{id,metBefore:id==='R-KNOWN',meaningfulEncounterCount:id==='R-KNOWN'?3:0,familiarity:id==='R-KNOWN'?'known':'stranger',scannedEntryCount:id==='R-KNOWN'?3:1}},
  recognitionReference(_s,id){referenceReads++;return id==='R-KNOWN'?{id:'MEM-ROLE-1',topic:'Village Steward office',summary:'Observed the protagonist serving as Village Steward.'}:null}
};
global.SocialState={dialogueContext(){return{values:{trust:.9,respect:.9,suspicion:.05,fear:.02}}},recordEvent(){socialWrites++;throw new Error('presentation must not mutate SocialState')}};
global.WorldCoordinates={position(x,y){return Object.freeze({x:String(x),y:String(y),level:0})},add(p,dx,dy){return Object.freeze({x:(BigInt(p.x)+BigInt(dx)).toString(),y:(BigInt(p.y)+BigInt(dy)).toString(),level:0})}};
const hall=Object.freeze({id:'HALL',kind:'meeting-hall',label:'Village Meeting Hall',entrance:{door:{x:'0',y:'0'},immediateOutside:{x:'0',y:'-1'},immediateInside:{x:'0',y:'1'}},interiorTarget:{x:'0',y:'1'}});
const store=Object.freeze({id:'STORE',kind:'storehouse',label:'Storehouse',entrance:{door:{x:'4',y:'0'},immediateOutside:{x:'4',y:'-1'},immediateInside:{x:'4',y:'1'}},interiorTarget:{x:'4',y:'1'}});
const house=Object.freeze({id:'HOUSE',kind:'house',label:'House',entrance:{door:{x:'8',y:'0'},immediateOutside:{x:'8',y:'-1'},immediateInside:{x:'8',y:'1'}},interiorTarget:{x:'8',y:'1'}});
global.BuildingInteriors={build(){return[hall,store,house]},get(_s,id){return[hall,store,house].find(x=>x.id===id)||null}};
global.InteriorObjects={build(){return[{id:'HALL:table:01',type:'table',buildingId:'HALL',buildingLabel:'Village Meeting Hall',coordinate:{x:'1',y:'1'},interactionPositions:[{x:'1',y:'0'}]}]}};
global.RoutePlanner={findRoute(){return{found:true,stepCount:1,totalSeconds:1}}};
global.ActionExecutor={advanceActor(){actionCalls++;return{status:'active',reason:'action-active',state:{label:'Working'}}}};
require('../world/protagonist-rank-access.js');require('../world/object-interactions.js');
const Rank=global.ProtagonistRankAccess,Obj=global.ObjectInteractions;
assert.equal(Rank.VERSION,'protagonist-rank-access-v2');assert.equal(Obj.VERSION,'world-object-interactions-v2');
assert.equal(Rank.ACCESS_RULES.storehouse.enter.requiredScope,'settlement:administration');

// Ordinary local access remains open while the status-sensitive Storehouse gate is closed.
const ordinaryHouse=Rank.localAccessContext(seed,'protagonist',when,{buildingKind:'house',action:'enter',label:'House'});
const ordinaryStore=Rank.localAccessContext(seed,'protagonist',when,{buildingKind:'storehouse',action:'enter',label:'Storehouse'});
assert.equal(ordinaryHouse.status,'permitted');assert.equal(ordinaryHouse.reason,'ordinary-local-access');
assert.equal(ordinaryStore.status,'restricted');assert.equal(ordinaryStore.requiredScope,'settlement:administration');
let storeCtx=Obj.context(seed,'STORE:door',{x:'4',y:'-1'}),storeEnter=storeCtx.actions.find(x=>x.id==='enter');
assert.equal(storeCtx.buildingKind,'storehouse');assert.equal(storeEnter.enabled,false);assert.equal(storeEnter.reason,'status-restricted');
const storeBlocked=Obj.attempt(seed,{actorKind:'protagonist',actorId:'protagonist',actorPosition:{x:'4',y:'-1'},objectId:'STORE:door',action:'enter'});
assert.equal(storeBlocked.ok,false);assert.equal(storeBlocked.reason,'status-restricted');

// Civic work is also privileged, but ordinary inspection stays available.
const actor={x:'1',y:'0'};let hallCtx=Obj.context(seed,'HALL:table:01',actor),work=hallCtx.actions.find(x=>x.id==='work'),inspect=hallCtx.actions.find(x=>x.id==='inspect');
assert.equal(work.access.requiredScope,'settlement:administration');assert.equal(work.enabled,false);assert.equal(inspect.enabled,true);
const residentWork=Obj.attempt(seed,{actorKind:'resident',actorId:'R-WORKER',actorPosition:actor,objectId:'HALL:table:01',action:'work'});
assert.equal(residentWork.ok,true);assert.equal(actionCalls,1,'protagonist status must not alter resident routines');

// Legitimate steward status opens both categories but never bypasses existing execution validation.
role={roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']};
storeCtx=Obj.context(seed,'STORE:door',{x:'4',y:'-1'});storeEnter=storeCtx.actions.find(x=>x.id==='enter');
assert.equal(storeEnter.access.status,'permitted');assert.equal(storeEnter.enabled,true);assert.equal(storeEnter.access.roleTitle,'Village Steward');
hallCtx=Obj.context(seed,'HALL:table:01',actor);work=hallCtx.actions.find(x=>x.id==='work');
assert.equal(work.access.status,'permitted');assert.equal(work.enabled,true);
const permittedWork=Obj.attempt(seed,{actorKind:'protagonist',actorId:'protagonist',actorPosition:actor,objectId:'HALL:table:01',action:'work'});
assert.equal(permittedWork.ok,true);assert.equal(actionCalls,2,'permitted status must still delegate to ActionExecutor');

// Conditional access is presentation/advisory only and fails closed before execution.
const realRankAccess=global.ProtagonistRankAccess;
global.ProtagonistRankAccess={...realRankAccess,localAccessContext(){return{status:'conditional',permitted:false,conditional:true,reason:'status-authority-context-conditional',requiredScope:'settlement:administration',requiredRoleId:'village-steward',role:{title:'Guild Member',rankTier:1},presentation:'Conditional local access.'}}};
const conditionalCtx=Obj.context(seed,'HALL:table:01',actor),conditionalWork=conditionalCtx.actions.find(x=>x.id==='work');
assert.equal(conditionalWork.enabled,false);assert.equal(conditionalWork.reason,'status-conditional');
const conditionalAttempt=Obj.attempt(seed,{actorKind:'protagonist',actorId:'protagonist',actorPosition:actor,objectId:'HALL:table:01',action:'work'});
assert.equal(conditionalAttempt.ok,false);assert.equal(conditionalAttempt.reason,'status-conditional');assert.equal(actionCalls,2);
global.ProtagonistRankAccess=realRankAccess;

// Recognition requires resident-specific title memory; high social warmth alone is insufficient.
const known=Rank.npcReaction(seed,'R-KNOWN','protagonist',when,{label:'local context'}),unknown=Rank.npcReaction(seed,'R-UNKNOWN','protagonist',when,{label:'local context'});
assert.equal(known.recognized,true);assert.equal(known.knowledge.referenceId,'MEM-ROLE-1');assert(known.message.includes('Village Steward'));
assert.equal(unknown.recognized,false);assert(unknown.message.includes('No grounded knowledge'));assert.equal(known.relationshipDelta,null);assert.equal(known.socialConsequence,null);
assert.equal(socialWrites,0);

// Missing authority fails closed only for privileged access; ordinary local access remains available.
global.ProtagonistAuthority={snapshot(){return{exists:false,reason:'empty'}}};
global.ProtagonistStatusObligations={decisionContext(){return{ok:false,reason:'authority-unavailable'}}};
const unknownPrivileged=Rank.localAccessContext(seed,'protagonist',when,{buildingKind:'storehouse',action:'enter',label:'Storehouse'});
const unknownOrdinary=Rank.localAccessContext(seed,'protagonist',when,{buildingKind:'house',action:'enter',label:'House'});
assert.equal(unknownPrivileged.status,'restricted');assert.equal(unknownPrivileged.unknown,true);assert.equal(unknownPrivileged.role.roleId,null);
assert.equal(unknownOrdinary.status,'permitted');assert.equal(unknownOrdinary.reason,'ordinary-local-access');

const proof=Rank.proof();assert.equal(proof.pass,true);
const telemetry=Rank.telemetry();for(const k of ['fullWorldScan','wholeSettlementScan','wholeHistoryScan','perFrameScan','relationshipMutation','worldMutation'])assert.equal(telemetry[k],false,k);
assert.equal(telemetry.eventDriven,true);assert.equal(telemetry.bounded,true);assert(telemetry.maxMemoryReads<=16);
const objSnap=Obj.snapshot(seed);assert.equal(objSnap.boundedLocalQuery,true);assert.equal(objSnap.perFrameScan,false);
assert(memoryReads<=8&&referenceReads<=8);

const root=path.resolve(__dirname,'../..');
const rankSource=fs.readFileSync(path.join(root,'scripts/world/protagonist-rank-access.js'),'utf8');
for(const forbidden of ['.recordEvent(','.recordMemory(','ProtagonistAuthority.transition','setPosition(','teleport(','requestAnimationFrame','setInterval(','Math.random','Date.now'])assert(!rankSource.includes(forbidden),'forbidden authority/mutation/timing path: '+forbidden);
const objectSource=fs.readFileSync(path.join(root,'scripts/world/object-interactions.js'),'utf8');
assert(objectSource.includes('buildingKind:String(building?.kind||"")'));assert(objectSource.includes('actorKind==="protagonist"?rankStatus'));assert(objectSource.includes('access.status==="conditional"'));assert(objectSource.includes('reason:"status-conditional"'));
const planetSource=fs.readFileSync(path.join(root,'scripts/world/planet-stage.js'),'utf8');
assert(planetSource.includes('function inspectionRankAccess(record)'));assert(planetSource.includes('selectBuildingForEvidence:'));assert(planetSource.includes('tip.dataset.rankAccess'));
const reactionSource=fs.readFileSync(path.join(root,'scripts/world/contextual-reactions.js'),'utf8');assert(reactionSource.includes('card.dataset.rankRecognized'));
const css=fs.readFileSync(path.join(root,'styles/main.css'),'utf8');assert(css.includes('data-rank-access="permitted"')&&css.includes('data-rank-access="restricted"'));
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');assert(index.includes('scripts/world/object-interactions.js?v=world-object-interactions-v2'));assert(index.includes('scripts/world/protagonist-rank-access.js?v=protagonist-rank-access-v2'));
console.log(JSON.stringify({wp:'WP-S013-010',classification:'MIXED',functionalPass:true,ordinaryStorehouse:ordinaryStore.status,ordinaryHouse:ordinaryHouse.status,stewardStorehouse:storeEnter.access.status,civicWork:work.access.status,knownNpc:known.recognized,unknownNpc:unknown.recognized,conditionalFailsClosed:true,residentRoutinePreserved:true,relationshipMutation:false,worldMutation:false,telemetry},null,2));
