const assert=require("assert");
const path=require("path");
const fs=require("fs");

function H(v){let h=2166136261>>>0;for(const ch of String(v??"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function C(v){return v==null||typeof v!=="object"?v:JSON.parse(JSON.stringify(v))}

global.window=global;
global.TextEncoder=global.TextEncoder||require("util").TextEncoder;

let socialReads=0;
global.ProtagonistProfile={summary(seed){return {protagonistId:"PROTAGONIST-"+H(seed+"|protagonist|identity-v1"),traits:{resolve:82,empathy:64,curiosity:74,caution:28,ambition:86,sociability:58},fixedBaseline:true}},derive(seed){return {protagonistId:"PROTAGONIST-"+H(seed+"|protagonist|identity-v1"),personality:{traits:{resolve:82,empathy:64,curiosity:74,caution:28,ambition:86,sociability:58}}}}};
global.ProtagonistNeeds={snapshot(){return {pressureMilli:{hunger:12000,fatigue:14000,safety:8000,social:9000}}}};
global.ProtagonistHealth={snapshot(){return {conditionMilli:88000,fatigueMilli:12000}}};
global.ProtagonistGoals={snapshot(){return {records:[{id:"GOAL-1",priority:90,topic:"seek advancement",status:"active"},{id:"GOAL-2",priority:25,topic:"save money",status:"active"}]}}};
global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:"local-resident",rankTier:0,rankLabel:"ordinary",scopes:["self"]}}}};
global.ProtagonistStanding={snapshot(){return {available:true,rankTier:0,domains:{service:{score:45},professional:{score:50}}}}};
global.ProtagonistEmployment={current(){return {ok:true,status:"active",contract:{id:"EMP-1",professionId:"smith",employerRef:{kind:"resident",id:"r-guard"},workplaceRef:{kind:"workplace",id:"W1"}}}}};
global.ProtagonistWealth={snapshot(){return {available:true,balanceCopper:42,reserveCopper:10}}};
global.ProtagonistStatusObligations={resolve(){return {ok:true,obligations:[{kind:"employment-duty",state:"standing",obligationId:"OB-1"},{kind:"housing-obligation",state:"due",obligationId:"OB-2"}],restrictedActions:[{kind:"settlement-administration"}]}}};
global.SocialState={dialogueContext(_seed,id){socialReads++;return {source:"persistent-social-ledger",values:{trust:id==="r-mentor"?0.86:0.22,respect:id==="r-mentor"?0.84:0.18,suspicion:id==="r-mentor"?0.12:0.76,fear:0.08,loyalty:id==="r-mentor"?0.66:0.2,resentment:0.1}}}};
global.ProtagonistPatronageOpportunities={list(){return[{opportunityId:"PAT-LIVE",kind:"patronage",label:"Mentor-backed advancement",sourceNpcId:"r-mentor",goalLinks:["GOAL-1"],priority:88,grounded:true,available:true,targetRankTier:1,targetRoleId:"guild-member",proposal:null}]}}
global.ProtagonistProfessionOpportunities={list(){return[]}};

const modulePath=path.resolve(__dirname,"../world/protagonist-advancement-goal.js");
delete require.cache[require.resolve(modulePath)];
const Advancement=require(modulePath);
global.ProtagonistAdvancementGoal=Advancement;

const seed="WP-S013-008-SEED";
const when="1202-03-01 09:30:00";

const pursue=Advancement.evaluate({
  seed,when,identityKey:"protagonist",
  opportunities:[
    {opportunityId:"ADV-PURSUE",kind:"patronage",label:"Mentor-backed advancement",sourceNpcId:"r-mentor",goalLinks:["GOAL-1"],priority:92,grounded:true,available:true,targetRankTier:1,targetRoleId:"guild-member"},
    {opportunityId:"ADV-REJECT",kind:"promotion",label:"Unverified office",sourceNpcId:"r-critic",goalLinks:["GOAL-1"],priority:95,grounded:true,available:true,requiredAuthorityScopes:["settlement:administration"],targetRankTier:2,targetRoleId:"village-steward",prerequisites:{satisfied:false,blockers:["unverified-office"]}}
  ],
  profile:ProtagonistProfile.summary(seed),
  needs:ProtagonistNeeds.snapshot(seed),
  health:ProtagonistHealth.snapshot(seed),
  goals:ProtagonistGoals.snapshot(seed),
  authority:ProtagonistAuthority.snapshot(seed),
  standing:ProtagonistStanding.snapshot(seed),
  employment:ProtagonistEmployment.current(seed,when),
  wealth:ProtagonistWealth.snapshot(seed),
  obligations:ProtagonistStatusObligations.resolve(seed,when)
});
assert.equal(pursue.ok,true);
assert.equal(pursue.status,"pursue");
assert.equal(pursue.selectedOpportunityId,"ADV-PURSUE");
assert.equal(pursue.selectedProposal.commandId,"advisor.propose_interaction");
assert.equal(pursue.selectedProposal.parameters.personId,"r-mentor");
assert.equal(Advancement.runtimeInput(pursue,null,null,{actorId:"protagonist"}).ok,true);
assert.equal(Advancement.evaluatorInput(pursue,null,null,{actorId:"protagonist"}).ok,true);
const again=Advancement.evaluate({
  seed,when,identityKey:"protagonist",
  opportunities:[
    {opportunityId:"ADV-PURSUE",kind:"patronage",label:"Mentor-backed advancement",sourceNpcId:"r-mentor",goalLinks:["GOAL-1"],priority:92,grounded:true,available:true,targetRankTier:1,targetRoleId:"guild-member"},
    {opportunityId:"ADV-REJECT",kind:"promotion",label:"Unverified office",sourceNpcId:"r-critic",goalLinks:["GOAL-1"],priority:95,grounded:true,available:true,requiredAuthorityScopes:["settlement:administration"],targetRankTier:2,targetRoleId:"village-steward",prerequisites:{satisfied:false,blockers:["unverified-office"]}}
  ],
  profile:ProtagonistProfile.summary(seed),
  needs:ProtagonistNeeds.snapshot(seed),
  health:ProtagonistHealth.snapshot(seed),
  goals:ProtagonistGoals.snapshot(seed),
  authority:ProtagonistAuthority.snapshot(seed),
  standing:ProtagonistStanding.snapshot(seed),
  employment:ProtagonistEmployment.current(seed,when),
  wealth:ProtagonistWealth.snapshot(seed),
  obligations:ProtagonistStatusObligations.resolve(seed,when)
});
assert.deepEqual(again.status,pursue.status);
assert.deepEqual(again.selectedOpportunityId,pursue.selectedOpportunityId);

const maintain=Advancement.evaluate({
  seed:"WP-S013-008-MAINTAIN",when,
  opportunities:[
    {opportunityId:"ADV-CAREER",kind:"training",label:"Costly distant move",sourceNpcId:"r-mentor",goalLinks:[],priority:8,grounded:true,available:true,costCopper:999,targetRankTier:1,targetRoleId:"guild-member"}
  ],
  profile:{traits:{resolve:12,empathy:58,curiosity:22,caution:84,ambition:18,sociability:32}},
  needs:{hunger:0.93,fatigue:0.88,safety:0.56,social:0.64},
  health:{condition:0.31,fatigue:0.72},
  goals:{records:[{id:"GOAL-1",priority:15,status:"active"}]},
  authority:{currentRole:{roleId:"local-resident",rankTier:0,scopes:["self"]}},
  standing:{rankTier:0,domains:{service:{score:18}}},
  employment:{status:"active",contract:{id:"EMP-1",professionId:"smith"}},
  wealth:{balanceCopper:4,reserveCopper:0},
  obligations:{obligations:[{kind:"employment-duty",state:"due",obligationId:"OB-1"},{kind:"housing-obligation",state:"overdue",obligationId:"OB-2"}]}
});
assert.equal(maintain.status,"maintain-current-role");
assert.equal(maintain.selectedProposal,null);

const reject=Advancement.evaluate({
  seed:"WP-S013-008-REJECT",when,
  opportunities:[
    {opportunityId:"ADV-HARD",kind:"promotion",label:"Court office without access",sourceNpcId:"r-critic",goalLinks:["GOAL-1"],priority:98,grounded:true,available:true,requiredAuthorityScopes:["settlement:administration"],targetRankTier:2,targetRoleId:"village-steward",proposal:null}
  ],
  profile:{traits:{resolve:86,empathy:52,curiosity:76,caution:18,ambition:92,sociability:66}},
  needs:{hunger:0.08,fatigue:0.14,safety:0.09,social:0.10},
  health:{condition:0.91,fatigue:0.08},
  goals:{records:[{id:"GOAL-1",priority:95,status:"active"}]},
  authority:{currentRole:{roleId:"local-resident",rankTier:0,scopes:["self"]}},
  standing:{rankTier:0,domains:{professional:{score:32}}},
  employment:{status:"none",contract:null},
  wealth:{balanceCopper:80,reserveCopper:10},
  obligations:{obligations:[]}
});
assert.equal(reject.status,"reject");
assert.equal(reject.selectedOpportunityId,"ADV-HARD");
assert(reject.evaluated.find(row=>row.opportunityId==="ADV-HARD").hardBlockers.includes("authority-scope-missing"));

const defer=Advancement.evaluate({
  seed:"WP-S013-008-DEFER",when,
  opportunities:[
    {opportunityId:"ADV-FUTURE",kind:"training",label:"Future sponsor session",sourceNpcId:"r-mentor",goalLinks:["GOAL-1"],priority:88,grounded:true,available:true,opensAt:"1202-03-02 09:30:00",targetRankTier:1,targetRoleId:"guild-member",proposal:null}
  ],
  profile:{traits:{resolve:70,empathy:55,curiosity:78,caution:32,ambition:88,sociability:62}},
  needs:{hunger:0.05,fatigue:0.08,safety:0.05,social:0.07},
  health:{condition:0.88,fatigue:0.12},
  goals:{records:[{id:"GOAL-1",priority:88,status:"active"}]},
  authority:{currentRole:{roleId:"local-resident",rankTier:0,scopes:["self"]}},
  standing:{rankTier:0,domains:{professional:{score:68}}},
  employment:{status:"active",contract:{id:"EMP-1",professionId:"smith"}},
  wealth:{balanceCopper:48,reserveCopper:10},
  obligations:{obligations:[{kind:"employment-duty",state:"standing",obligationId:"OB-1"}]}
});
assert.equal(defer.status,"defer");
assert.equal(defer.selectedOpportunityId,"ADV-FUTURE");
assert(defer.evaluated.find(row=>row.opportunityId==="ADV-FUTURE").softBlockers.includes("not-yet-open"));

const live=Advancement.fromLive(seed,when,{identityKey:"protagonist"});
assert.equal(live.status,"pursue");
assert.equal(live.selectedOpportunityId,"PAT-LIVE");
assert.equal(socialReads>0,true);
assert.equal(Advancement.telemetry().liveBuilds>0,true);
assert.equal(Advancement.telemetry().fullWorldScan,false);
assert.equal(Advancement.telemetry().perFrameScan,false);
assert.equal(Advancement.telemetry().authority,false);

const indexPath=path.resolve(__dirname,"../../index.html");
const html=fs.readFileSync(indexPath,"utf8");
const script='scripts/world/protagonist-advancement-goal.js?v=protagonist-advancement-goal-v1';
assert(html.includes(script),'canonical root must load the advancement selector');
assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-economic-priority.js?v=protagonist-economic-priority-v1'));

console.log(JSON.stringify({
  pass:true,
  version:Advancement.VERSION,
  pursue:{status:pursue.status,selectedOpportunityId:pursue.selectedOpportunityId},
  maintain:maintain.status,
  reject:reject.status,
  defer:defer.status,
  telemetry:Advancement.telemetry(),
  liveStatus:live.status,
  guards:{fullWorldScan:false,perFrameScan:false,directActionExecution:false,simulationValidationBypass:false}
},null,2));
