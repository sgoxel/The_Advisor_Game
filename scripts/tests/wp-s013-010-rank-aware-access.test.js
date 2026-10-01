'use strict';
const assert=require('assert');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']}};}};
global.ProtagonistStatusObligations={resolve(){return {ok:true,role:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']},readOnly:true};},decisionContext(){return {ok:true,role:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']},readOnly:true};}};
global.SocialState={dialogueContext(){return {knownResident:true,values:{trust:0.72,respect:0.68,suspicion:0.18,fear:0.06,loyalty:0.55,resentment:0.07}};}};
global.ObjectInteractions={attempt(){return {ok:false,status:'rejected',reason:'status-restricted'};}};

const modulePath=path.resolve(__dirname,'../world/protagonist-rank-access.js');
delete require.cache[require.resolve(modulePath)];
const Access=require(modulePath);
assert.equal(Access.VERSION,'protagonist-rank-access-v1');
const ordinary=Access.localAccessContext('SEED-RANK-ACCESS','protagonist','1201-05-01 09:00:00',{requiredScope:'settlement:administration',label:'Town Hall'});
assert.equal(ordinary.status,'restricted');
assert.equal(ordinary.permitted,false);
assert.equal(ordinary.reason,'missing-authority-scope');

global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']}};}};
global.ProtagonistStatusObligations={resolve(){return {ok:true,role:{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']},readOnly:true};},decisionContext(){return {ok:true,role:{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']},readOnly:true};}};
const steward=Access.localAccessContext('SEED-RANK-ACCESS','protagonist','1201-05-01 10:00:00',{requiredScope:'settlement:administration',label:'Town Hall'});
assert.equal(steward.status,'permitted');
assert.equal(steward.permitted,true);
const reaction=Access.npcReaction('SEED-RANK-ACCESS','R-GUARD','protagonist','1201-05-01 10:00:00',{label:'Town Hall'});
assert.equal(reaction.recognized,true);
assert(reaction.message.includes('Village Steward'));

global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']}};}};
global.ProtagonistStatusObligations={resolve(){return {ok:true,role:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']},readOnly:true};},decisionContext(){return {ok:true,role:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']},readOnly:true};}};
const blocked=Access.attemptAccess('SEED-RANK-ACCESS','protagonist','1201-05-01 09:00:00',{objectId:'town-hall-door',action:'enter',requiredScope:'settlement:administration',actorPosition:{x:1,y:2}});
assert.equal(blocked.ok,false);
assert.equal(blocked.status,'rejected');
assert.equal(blocked.access.status,'restricted');
const proof=Access.proof();
assert.equal(proof.pass,true);
const snap=Access.snapshot('SEED-RANK-ACCESS','protagonist');
assert.equal(snap.bounded,true);
assert.equal(snap.eventDriven,true);
assert.equal(snap.fullWorldScan,false);
assert.equal(snap.wholeHistoryScan,false);
assert.equal(snap.perFrameScan,false);
assert.equal(snap.readOnly,true);
console.log(JSON.stringify({wp:'WP-S013-010',classification:'MIXED',functionalPass:true,ordinaryStatus:ordinary.status,stewardStatus:steward.status,recognized:reaction.recognized,blockedReason:blocked.reason},null,2));
