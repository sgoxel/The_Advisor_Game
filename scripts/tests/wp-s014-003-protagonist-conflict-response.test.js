'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const modulePath=path.resolve(__dirname,'../world/protagonist-conflict-response.js');
delete require.cache[modulePath];
const Response=require(modulePath);
assert.equal(Response.VERSION,'protagonist-conflict-response-v2');

const seed='WP-S014-003-SEED',when='1201-09-02 14:30:00';
const threat={
  threatId:'THREAT-LANE-01',severity:'serious',
  sourceRef:{kind:'simulation-event',id:'SIM-THREAT-01'},
  targetId:'ALLEY-01',riskScore:66,escapeAvailable:true,
  grounded:true,validated:true
};
const base={
  seed,when,threat,
  readiness:{readinessScore:76,skillLevel:6,grounded:true,validated:true},
  health:{conditionMilli:86000,fatigueMilli:20000,activeInjuryCount:0},
  profile:{personality:{traits:{resolve:78,caution:38,empathy:64,ambition:52}}},
  needs:{pressureMilli:{hunger:14000,fatigue:18000,safety:18000,social:12000}},
  goals:{records:[{id:'GOAL-PROTECT-HOME',status:'active',priority:68,kind:'security'}]},
  authority:{currentRole:{roleId:'local-resident',rankTier:0,scopes:['self']}},
  socialState:{targetId:'ALLY-01',values:{trust:.65,respect:.66,loyalty:.6}},
  guidance:[]
};

const healthy=Response.evaluate(base);
assert(healthy.ok);assert(['defend','fight'].includes(healthy.selectedResponse));
assert.equal(healthy.status,'proposal-only');assert.equal(healthy.requiresRuntime,false);
assert.deepStrictEqual(Response.evaluate(JSON.parse(JSON.stringify(base))),healthy,'same inputs replay identically');

const reordered=Response.evaluate({guidance:[],socialState:base.socialState,goals:base.goals,needs:base.needs,profile:base.profile,health:base.health,readiness:base.readiness,threat:{validated:true,grounded:true,escapeAvailable:true,riskScore:66,targetId:'ALLEY-01',sourceRef:{id:'SIM-THREAT-01',kind:'simulation-event'},severity:'serious',threatId:'THREAT-LANE-01'},when,seed,authority:base.authority});
assert.deepStrictEqual(reordered,healthy,'input key order must not change choice');

const retreat=Response.evaluate({...base,threat:{...threat,severity:'critical',riskScore:88,targetId:'FOOTPATH-01'},readiness:{readinessScore:30,validated:true},health:{conditionMilli:22000,fatigueMilli:90000,activeInjuryCount:2,injuryBurdenMilli:42000}});
assert.equal(retreat.selectedResponse,'retreat');
const yieldResult=Response.evaluate({...base,threat:{...threat,severity:'overwhelming',riskScore:94,targetId:'GATE-01',escapeAvailable:false},readiness:{readinessScore:22,validated:true},health:{conditionMilli:18000,fatigueMilli:88000,activeInjuryCount:2}});
assert.equal(yieldResult.selectedResponse,'yield');

const protectedThreat={...threat,targetId:'MARKET-01',protectedTargetId:'CHILD-03',riskScore:60,escapeAvailable:false};
const protect=Response.evaluate({...base,threat:protectedThreat,readiness:{readinessScore:67,validated:true},socialState:{targetId:'CHILD-03',values:{trust:.82,respect:.8,loyalty:.78},duty:.8,protectionPriority:.9},guidance:{protectsTargetId:'CHILD-03',duty:'protect'}});
assert.equal(protect.selectedResponse,'protect');
const noGroundedTarget=Response.evaluate({...base,threat:{...protectedThreat,protectedTargetId:null},socialState:{targetId:'CHILD-03',values:{trust:.95,respect:.95,loyalty:.95},duty:.95,protectionPriority:.95},guidance:{protectsTargetId:'CHILD-03',duty:'protect'}});
assert.notEqual(noGroundedTarget.selectedResponse,'protect','protect must require a real threat-linked protected target');

for(const bad of [
  {...threat,targetId:null},
  {...threat,grounded:false,validated:false},
  {...threat,sourceRef:{kind:'ui',id:'UI-THREAT-1'}},
  {...threat,sourceRef:{kind:'llm',id:'LLM-THREAT-1'}}
]){
  const result=Response.evaluate({...base,threat:bad});
  assert.equal(result.ok,false,'invalid or untrusted threat evidence must fail closed');
}

const executableProposal={proposalId:'PROP-DEFEND-01',commandId:'advisor.propose_interaction',parameters:{personId:'BAND-01',interactionTargetId:'ALLEY-01',topic:'Defend against the grounded threat'},source:'wp-s014-003-test',grounded:true,validated:true};
const withProposal=Response.evaluate({...base,responseProposals:{[healthy.selectedResponse]:executableProposal}});
assert.equal(withProposal.status,'proposal-ready');assert(withProposal.selectedProposal);
const noSnapshot=Response.runtimeInput(withProposal,null,{value:.8,urgency:.8,socialAcceptability:.6},{actorId:'protagonist'});
assert.equal(noSnapshot.ok,false);assert.equal(noSnapshot.reason,'bounded-command-snapshot-required');
let schedules=0,captured=null;
const fakeRuntime={schedule(config){schedules++;captured=config;return {ok:true,reason:'scheduled-through-runtime'};}};
const scheduled=Response.schedule(withProposal,{snapshotId:'SNAP-CONFLICT'}, {value:.8,urgency:.8,socialAcceptability:.6}, {runtime:fakeRuntime,actorPosition:{x:'0',y:'0',level:0}});
assert(scheduled.ok);assert.equal(schedules,1);assert.equal(captured.proposal.commandId,'advisor.propose_interaction');
assert.equal(scheduled.boundary,'ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation');
assert.equal(Response.schedule(healthy,{snapshotId:'SNAP'},null,{runtime:fakeRuntime}).ok,false,'proposal-only choices must not execute');

let reads={profile:0,needs:0,health:0,goals:0,authority:0,social:0,guidance:0};
global.ProtagonistProfile={summary(){reads.profile++;return base.profile;}};
global.ProtagonistNeeds={snapshot(){reads.needs++;return base.needs;}};
global.ProtagonistHealth={decisionContext(){reads.health++;return base.health;}};
global.ProtagonistGoals={list(){reads.goals++;return base.goals.records;}};
global.ProtagonistAuthority={decisionContext(){reads.authority++;return base.authority;}};
global.SocialState={relationship(){reads.social++;return {values:{trust:.82,respect:.8,loyalty:.78}};}};
global.ProtagonistGuidance={relevant(){reads.guidance++;return [{id:'GUID-CONFLICT-1',stance:'neutral',topic:'security'}];}};
const live=Response.fromLive(seed,when,{threat:protectedThreat,readiness:{readinessScore:67,validated:true}});
assert(live.ok);assert.deepStrictEqual(reads,{profile:1,needs:1,health:1,goals:1,authority:1,social:1,guidance:1});
assert.equal(live.selectedResponse,'protect');

const telemetry=Response.telemetry();
assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.wholeSettlementScan,false);assert.equal(telemetry.wholeHistoryScan,false);assert.equal(telemetry.perFrameScan,false);

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Date.now','Math.random','setPosition(','teleport(','ActionExecutor.','ProtagonistHealth.apply','ProtagonistAuthority.transition','ProtagonistMartialReadiness','LocalSecurityIncidents'])
  assert(!source.includes(forbidden),'forbidden dependency/authority input: '+forbidden);
for(const required of ['directCombatResolution:false','directWorldMutation:false','proposalOnly:true','simulationValidationBypass:false','fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false'])
  assert(source.includes(required),'missing guard '+required);

const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
const script='scripts/world/protagonist-conflict-response.js?v=protagonist-conflict-response-v2';
assert(html.includes(script),'canonical production root must load conflict selector');
assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-action-runtime.js?v=protagonist-action-runtime-v1'),'selector should load after runtime boundary exists');

console.log(JSON.stringify({pass:true,wp:'WP-S014-003',classification:'FUNCTIONAL',visual:'N/A',healthy:healthy.selectedResponse,retreat:retreat.selectedResponse,yield:yieldResult.selectedResponse,protect:protect.selectedResponse,liveReads:reads,deterministicReplay:true,proposalOnlyNoExecution:true,runtimeBoundary:true},null,2));
