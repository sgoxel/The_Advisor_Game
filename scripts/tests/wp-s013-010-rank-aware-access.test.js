'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const seed='WP-S013-010-A',when='1201-05-01 10:00:00';
let role={roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']},socialWrites=0,actionCalls=0;
const knownResidents=new Set(['R-KNOWN']);
global.GameTime={getTimestampKey(){return when}};
global.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{...role,scopes:[...role.scopes]}}}};
global.CharacterMemory={recognition(_s,id){return knownResidents.has(id)?{metBefore:true,meaningfulEncounterCount:3,familiarity:'known'}:{metBefore:false,meaningfulEncounterCount:0,familiarity:'stranger'}}};
global.SocialState={
  dialogueContext(_s,id){return{values:{trust:.72,respect:.68,suspicion:.12,fear:.08},reputations:knownResidents.has(id)?[{scope:'settlement',id:'starting-village',score:.6,eventIds:['SOC-E1']}]:[]}},
  recordEvent(){socialWrites++;throw new Error('presentation must not mutate SocialState')}
};
global.WorldCoordinates={
  position(x,y){return Object.freeze({x:String(x),y:String(y),level:0})},
  add(p,dx,dy){return Object.freeze({x:(BigInt(p.x)+BigInt(dx)).toString(),y:(BigInt(p.y)+BigInt(dy)).toString(),level:0})}
};
const hall=Object.freeze({id:'HALL',kind:'meeting-hall',label:'Village Meeting Hall',entrance:{door:{x:'0',y:'0'},immediateOutside:{x:'0',y:'-1'},immediateInside:{x:'0',y:'1'}},interiorTarget:{x:'0',y:'1'}});
global.BuildingInteriors={build(){return[hall]},get(_s,id){return id==='HALL'?hall:null}};
global.InteriorObjects={build(){return[
  {id:'HALL:table:01',type:'table',buildingId:'HALL',buildingLabel:'Village Meeting Hall',coordinate:{x:'1',y:'1'},interactionPositions:[{x:'1',y:'0'}]}
]}};
global.RoutePlanner={findRoute(){return{found:true,stepCount:1,totalSeconds:1}}};
global.ActionExecutor={advanceActor(){actionCalls++;return{status:'active',reason:'action-active',state:{label:'Working'}}}};
require('../world/protagonist-rank-access.js');
require('../world/object-interactions.js');
const Rank=global.ProtagonistRankAccess,Obj=global.ObjectInteractions;
assert.equal(Rank.VERSION,'protagonist-rank-access-v2');
assert.equal(Obj.VERSION,'world-object-interactions-v2');

const actor={x:'1',y:'0'};
let ctx=Obj.context(seed,'HALL:table:01',actor),work=ctx.actions.find(x=>x.id==='work'),inspect=ctx.actions.find(x=>x.id==='inspect');
assert.equal(work.access.requiredScope,'settlement:administration');assert.equal(work.access.status,'restricted');assert.equal(work.enabled,false);assert.equal(work.reason,'status-restricted');
assert.equal(inspect.access.requiredScope,'self');assert.equal(inspect.enabled,true);
let blocked=Obj.attempt(seed,{actorKind:'protagonist',actorId:'protagonist',actorPosition:actor,objectId:'HALL:table:01',action:'work'});
assert.equal(blocked.ok,false);assert.equal(blocked.reason,'status-restricted');assert.equal(actionCalls,0);

const residentWork=Obj.attempt(seed,{actorKind:'resident',actorId:'R-WORKER',actorPosition:actor,objectId:'HALL:table:01',action:'work'});
assert.equal(residentWork.ok,true);assert.equal(actionCalls,1,'protagonist status must not alter autonomous resident routines');

role={roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']};
ctx=Obj.context(seed,'HALL:table:01',actor);work=ctx.actions.find(x=>x.id==='work');
assert.equal(work.access.status,'permitted');assert.equal(work.enabled,true);assert.equal(work.access.roleTitle,'Village Steward');
const permitted=Obj.attempt(seed,{actorKind:'protagonist',actorId:'protagonist',actorPosition:actor,objectId:'HALL:table:01',action:'work'});
assert.equal(permitted.ok,true);assert.equal(actionCalls,2,'permitted status must still delegate to existing ActionExecutor validation');

role={roleId:'guild-member',title:'Guild Member',rankTier:1,rankLabel:'recognized-local-role',scopes:['self','guild:participate']};
const conditional=Rank.localAccessContext(seed,'protagonist',when,{requiredScope:'settlement:administration',requiredRoleId:'village-steward',label:'Administrative hearing'});
assert.equal(conditional.status,'conditional');assert.equal(conditional.permitted,false);
const conditionalAttempt=Rank.attemptAccess(seed,'protagonist',when,{requiredScope:'settlement:administration',requiredRoleId:'village-steward',action:'request-hearing'});
assert.equal(conditionalAttempt.ok,false);assert.equal(conditionalAttempt.status,'conditional');assert.equal(conditionalAttempt.delegatesTo,'Simulation');

// ObjectInteractions must also fail closed if a future local metadata rule resolves to conditional.
const realRankAccess=global.ProtagonistRankAccess;
global.ProtagonistRankAccess={...realRankAccess,localAccessContext(){return{status:'conditional',permitted:false,conditional:true,reason:'status-authority-higher-role-conditional',requiredScope:'settlement:administration',requiredRoleId:'village-steward',role:{title:'Guild Member',rankTier:1},presentation:'Conditional local access.'}}};
const conditionalCtx=Obj.context(seed,'HALL:table:01',actor),conditionalWork=conditionalCtx.actions.find(x=>x.id==='work');
assert.equal(conditionalWork.enabled,false);assert.equal(conditionalWork.reason,'status-conditional');
const conditionalObjectAttempt=Obj.attempt(seed,{actorKind:'protagonist',actorId:'protagonist',actorPosition:actor,objectId:'HALL:table:01',action:'work'});
assert.equal(conditionalObjectAttempt.ok,false);assert.equal(conditionalObjectAttempt.reason,'status-conditional');assert.equal(actionCalls,2);
global.ProtagonistRankAccess=realRankAccess;

role={roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration']};
const known=Rank.npcReaction(seed,'R-KNOWN','protagonist',when,{label:'the meeting hall'}),unknown=Rank.npcReaction(seed,'R-UNKNOWN','protagonist',when,{label:'the meeting hall'});
assert.equal(known.recognized,true);assert.equal(known.knowledge.memoryKnown,true);assert.equal(known.knowledge.statusEvidence,true);assert(known.message.includes('Village Steward'));
assert.equal(unknown.recognized,false);assert.equal(unknown.knowledge.grounded,false);assert(!unknown.message.includes('I recognize your standing'));
assert.equal(socialWrites,0,'rank presentation must not create relationship outcomes');

const proof=Rank.proof();assert.equal(proof.pass,true);
const telemetry=Rank.telemetry();assert.equal(telemetry.eventDriven,true);assert.equal(telemetry.bounded,true);assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.wholeSettlementScan,false);assert.equal(telemetry.wholeHistoryScan,false);assert.equal(telemetry.perFrameScan,false);
const objectTelemetry=Obj.snapshot(seed);assert.equal(objectTelemetry.boundedLocalQuery,true);assert.equal(objectTelemetry.perFrameScan,false);

const rankSource=fs.readFileSync(path.resolve(__dirname,'../world/protagonist-rank-access.js'),'utf8');
for(const forbidden of ['.recordEvent(','.recordMemory(','ProtagonistAuthority.transition','setPosition(','teleport(','requestAnimationFrame','setInterval(','Math.random','Date.now'])assert(!rankSource.includes(forbidden),'forbidden authority/mutation/timing path: '+forbidden);
assert(!rankSource.includes('relationshipDelta'),'presentation must not fabricate social deltas');
const objectSource=fs.readFileSync(path.resolve(__dirname,'../world/object-interactions.js'),'utf8');
assert(objectSource.includes('building?.kind==="meeting-hall"&&descriptor.type==="table"&&action==="work"'));
assert(objectSource.includes('actorKind==="protagonist"?rankStatus'),'resident routines must be isolated from protagonist status');
assert(objectSource.includes('access.status==="conditional"'),'conditional access must have an explicit fail-closed branch');
assert(objectSource.includes('reason:"status-conditional"'),'conditional access must never execute as ready');
const planetSource=fs.readFileSync(path.resolve(__dirname,'../world/planet-stage.js'),'utf8');
assert(planetSource.includes('function inspectionRankAccess(record)'),'PlanetStage must project rank access into live building inspection');
assert(planetSource.includes('selectBuildingForEvidence:'),'bounded live building evidence selector missing');
assert(planetSource.includes('tip.dataset.rankAccess'),'live inspection must expose access state');
const reactionSource=fs.readFileSync(path.resolve(__dirname,'../world/contextual-reactions.js'),'utf8');
assert(reactionSource.includes('card.dataset.rankRecognized'),'NPC reaction card must expose grounded recognition state');
const cssSource=fs.readFileSync(path.resolve(__dirname,'../../styles/main.css'),'utf8');
assert(cssSource.includes('WP-S013-010 — rank-aware local access presentation'),'rank access visual treatment missing');
const uiSource=fs.readFileSync(path.resolve(__dirname,'../ui/app-ui.js'),'utf8');
for(const phrase of ['STATUS "+String(accessStatus).toUpperCase()','status never bypasses Simulation','Simulation still validates the action and outcome','data'])void phrase;
assert(uiSource.includes('STATUS "+String(accessStatus).toUpperCase()'));assert(uiSource.includes('status never bypasses Simulation'));assert(uiSource.includes('Simulation still validates the action and outcome'));
const index=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
assert(index.includes('scripts/world/object-interactions.js?v=world-object-interactions-v2'));assert(index.includes('scripts/world/protagonist-rank-access.js?v=protagonist-rank-access-v2'));
console.log(JSON.stringify({wp:'WP-S013-010',classification:'MIXED',functionalPass:true,ordinaryWork:blocked.reason,stewardWork:permitted.status,conditional:conditional.status,knownNpc:known.recognized,unknownNpc:unknown.recognized,residentRoutinePreserved:true,socialPresentationWrites:socialWrites,rankTelemetry:telemetry,objectTelemetry},null,2));
