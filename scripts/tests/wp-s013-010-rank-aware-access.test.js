'use strict';
const assert=require('assert');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

let objectAttempts=0;
let socialReads=0;
let memoryReads=0;
let recognitionRefs=0;

function residentRole(){
  global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']}};}};
  global.ProtagonistStatusObligations={decisionContext(){return {ok:true,role:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']},readOnly:true};}};
}
function stewardRole(){
  global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']}};}};
  global.ProtagonistStatusObligations={decisionContext(){return {ok:true,role:{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']},readOnly:true};}};
}
global.SocialState={dialogueContext(){socialReads++;return {knownResident:true,values:{trust:.9,respect:.9,suspicion:.05,fear:.02}};}};
global.CharacterMemory={
  recognition(seed,residentId){memoryReads++;return {metBefore:true,scannedEntryCount:3,residentId};},
  recognitionReference(seed,residentId){recognitionRefs++;return residentId==='R-KNOWS'?{id:'MEM-ROLE-1',topic:'Village Steward office',summary:'Saw the protagonist acting as Village Steward.'}:null;}
};
global.ObjectInteractions={
  attempt(){objectAttempts++;return {ok:false,status:'rejected',reason:'simulation-rejected'};}
};

const modulePath=path.resolve(__dirname,'../world/protagonist-rank-access.js');
delete require.cache[require.resolve(modulePath)];
const Access=require(modulePath);
assert.equal(Access.VERSION,'protagonist-rank-access-v1');
assert.equal(Access.ACCESS_RULES.storehouse.enter.requiredScope,'settlement:administration');

residentRole();
const ordinaryStorehouse=Access.localAccessContext('SEED-RANK-ACCESS','protagonist','1201-05-01 09:00:00',{buildingKind:'storehouse',action:'enter',label:'Storehouse'});
assert.equal(ordinaryStorehouse.status,'restricted');
assert.equal(ordinaryStorehouse.permitted,false);
assert.equal(ordinaryStorehouse.reason,'missing-authority-scope');
assert.equal(ordinaryStorehouse.requiredScope,'settlement:administration');
const ordinaryHouse=Access.localAccessContext('SEED-RANK-ACCESS','protagonist','1201-05-01 09:00:00',{buildingKind:'house',action:'enter',label:'House'});
assert.equal(ordinaryHouse.status,'permitted');
assert.equal(ordinaryHouse.reason,'ordinary-local-access');

const blockedAttempt=Access.attemptAccess('SEED-RANK-ACCESS','protagonist','1201-05-01 09:00:00',{objectId:'S4:door',buildingKind:'storehouse',action:'enter',label:'Storehouse'});
assert.equal(blockedAttempt.ok,false);
assert.equal(blockedAttempt.status,'rejected');
assert.equal(blockedAttempt.reason,'missing-authority-scope');
assert.equal(objectAttempts,0,'restricted access must not call ObjectInteractions');

stewardRole();
const stewardStorehouse=Access.localAccessContext('SEED-RANK-ACCESS','protagonist','1201-05-01 10:00:00',{buildingKind:'storehouse',action:'enter',label:'Storehouse'});
assert.equal(stewardStorehouse.status,'permitted');
assert.equal(stewardStorehouse.permitted,true);
assert.equal(stewardStorehouse.reason,'status-authority-scope-present');
const delegated=Access.attemptAccess('SEED-RANK-ACCESS','protagonist','1201-05-01 10:00:00',{objectId:'S4:door',buildingKind:'storehouse',action:'enter',label:'Storehouse'});
assert.equal(delegated.ok,false);
assert.equal(delegated.reason,'simulation-rejected');
assert.equal(objectAttempts,1,'permitted access delegates once; Simulation/ObjectInteractions still decides');

const known=Access.npcReaction('SEED-RANK-ACCESS','R-KNOWS','protagonist','1201-05-01 10:00:00',{label:'Storehouse'});
assert.equal(known.recognized,true);
assert.equal(known.knowledge.referenceId,'MEM-ROLE-1');
assert(known.message.includes('Village Steward'));
assert.equal(known.relationshipDelta,null);
assert.equal(known.socialConsequence,null);

const highTrustButNoTitleMemory=Access.npcReaction('SEED-RANK-ACCESS','R-STRANGER','protagonist','1201-05-01 10:00:00',{label:'Storehouse'});
assert.equal(highTrustButNoTitleMemory.recognized,false,'high SocialState alone must not reveal a title');
assert(highTrustButNoTitleMemory.message.includes('No grounded knowledge'));
assert.equal(highTrustButNoTitleMemory.relationshipDelta,null);

global.ProtagonistAuthority={snapshot(){return {exists:false,reason:'empty'};}};
global.ProtagonistStatusObligations={decisionContext(){return {ok:false,reason:'authority-unavailable'};}};
const unknownPrivileged=Access.localAccessContext('SEED-RANK-ACCESS','protagonist','1201-05-01 11:00:00',{buildingKind:'storehouse',action:'enter',label:'Storehouse'});
assert.equal(unknownPrivileged.status,'restricted');
assert.equal(unknownPrivileged.unknown,true);
assert.equal(unknownPrivileged.reason,'authority-unavailable');
assert.equal(unknownPrivileged.role.roleId,null);
const unknownOrdinary=Access.localAccessContext('SEED-RANK-ACCESS','protagonist','1201-05-01 11:00:00',{buildingKind:'house',action:'enter',label:'House'});
assert.equal(unknownOrdinary.status,'permitted','ordinary unrestricted local access must not become a rank gate');
assert.equal(unknownOrdinary.role.roleId,null);

const proof=Access.proof();
assert.equal(proof.pass,true);
const snap=Access.snapshot('SEED-RANK-ACCESS','protagonist');
assert.equal(snap.bounded,true);
assert.equal(snap.eventDriven,true);
assert.equal(snap.fullWorldScan,false);
assert.equal(snap.wholeSettlementScan,false);
assert.equal(snap.wholeHistoryScan,false);
assert.equal(snap.perFrameScan,false);
assert.equal(snap.readOnly,true);
assert(snap.performance.maxMemoryReads<=16);
assert(memoryReads<=4);
assert(recognitionRefs<=4);
assert(socialReads<=4);

console.log(JSON.stringify({
  wp:'WP-S013-010',
  classification:'MIXED',
  functionalPass:true,
  ordinaryStorehouse:ordinaryStorehouse.status,
  ordinaryHouse:ordinaryHouse.status,
  stewardStorehouse:stewardStorehouse.status,
  knownNpcRecognized:known.recognized,
  unknownNpcRecognized:highTrustButNoTitleMemory.recognized,
  delegatedObjectAttempts:objectAttempts,
  relationshipMutation:false,
  worldMutation:false,
  bounded:true,
  eventDriven:true
},null,2));
