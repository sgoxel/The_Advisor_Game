'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const modulePath=path.resolve(__dirname,'../world/protagonist-conflict-response.js');
delete require.cache[modulePath];
const Response=require(modulePath);
assert.equal(Response.VERSION,'protagonist-conflict-response-v1');

const seed='WP-S014-003-SEED';
const when='1201-09-02 14:30:00';

const healthyThreat={
  threatId:'THREAT-LANE-01',
  severity:'serious',
  sourceRef:{kind:'bandit',id:'BAND-01'},
  targetId:'ALLEY-01',
  riskScore:66,
  escapeAvailable:true,
  reason:'Bandits force the lane.'
};

const healthy=Response.evaluate({seed,when,threat:healthyThreat,readiness:{readinessScore:75,roleId:'squire'},health:{conditionMilli:86000,fatigueMilli:20000,activeInjuryCount:0},profile:{personality:'courageous'},socialState:{duty:0.4,relationship:0.5,protectionPriority:0.2},guidance:{duty:'guard'} });
assert(healthy.ok);assert(['defend','fight'].includes(healthy.selectedResponse),'healthy capable protagonist should defend or fight');
assert.equal(healthy.status,'proposal-ready');
assert.equal(healthy.selectedProposal.parameters.response,healthy.selectedResponse);
const replay=Response.evaluate({seed,when,threat:healthyThreat,readiness:{readinessScore:75,roleId:'squire'},health:{conditionMilli:86000,fatigueMilli:20000,activeInjuryCount:0},profile:{personality:'courageous'},socialState:{duty:0.4,relationship:0.5,protectionPriority:0.2},guidance:{duty:'guard'} });
assert.deepStrictEqual(replay,healthy,'same inputs must replay identically');

const retreatCtx={seed,when,threat:{...healthyThreat,severity:'critical',riskScore:86,targetId:'FOOTPATH-01',protectedTargetId:'CHILD-02',escapeAvailable:true},readiness:{readinessScore:32},health:{conditionMilli:22000,fatigueMilli:90000,activeInjuryCount:2,injuryBurdenMilli:42000},socialState:{duty:0.2,relationship:0.2,protectionPriority:0.1},guidance:{duty:'self'} };
const retreat=Response.evaluate(retreatCtx);
assert(retreat.ok);assert.equal(retreat.selectedResponse,'retreat','critical injury + overwhelming risk should retreat when escape exists');

const protectCtx={seed,when,threat:{...healthyThreat,severity:'serious',riskScore:62,targetId:'MARKET-01',protectedTargetId:'CHILD-03',escapeAvailable:false},readiness:{readinessScore:67},health:{conditionMilli:68000,fatigueMilli:26000,activeInjuryCount:0},socialState:{duty:0.9,relationship:0.8,protectionPriority:0.9},guidance:{duty:'protect',protectsTargetId:'CHILD-03',guardDuty:true}};
const protect=Response.evaluate(protectCtx);
assert(protect.ok);assert.equal(protect.selectedResponse,'protect','strong duty and valid protected target should protect');

const invalidTarget=Response.evaluate({seed,when,threat:{threatId:'THREAT-XX',severity:'moderate',sourceRef:{kind:'bandit',id:'BAND-99'},targetId:null,riskScore:45,escapeAvailable:false},readiness:{readinessScore:60},health:{conditionMilli:70000,fatigueMilli:15000,activeInjuryCount:0},guidance:{duty:'self'}});
assert.equal(invalidTarget.ok,false);assert.equal(invalidTarget.reason,'factual-target-required');

const failClosed=Response.evaluate({seed,when,threat:{threatId:'THREAT-FAIL',severity:'moderate',sourceRef:{kind:'ui',id:'UI-1'},targetId:'ALLEY-07',riskScore:40,escapeAvailable:false},readiness:{readinessScore:20},health:{conditionMilli:15000,fatigueMilli:85000,activeInjuryCount:2},guidance:{duty:'self'}});
assert(failClosed.ok);assert(['yield','avoid','retreat'].includes(failClosed.selectedResponse));

const handoff=Response.evaluatorInput(healthy, null, {when}, {actorId:'PROTAGONIST-TEST'});
assert(handoff.ok);assert.equal(handoff.boundary,'ProtagonistCommandEvaluator');assert.equal(handoff.config.execute,false);assert.equal(handoff.config.proposal.parameters.response,healthy.selectedResponse);
const runtime=Response.runtimeInput(healthy, null, {when}, {actorId:'PROTAGONIST-TEST'});
assert(runtime.ok);assert.equal(runtime.boundary,'ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Date.now','Math.random','setPosition(','teleport(','ActionExecutor.','ProtagonistHealth.apply','ProtagonistAuthority.transition'])
  assert(!source.includes(forbidden),'forbidden authority input: '+forbidden);
for(const required of ['fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','directCombatResolution:false','directWorldMutation:false','proposalOnly:true'])
  assert(source.includes(required),'missing guard '+required);

console.log(JSON.stringify({pass:true,wp:'WP-S014-003',classification:'FUNCTIONAL',visual:'N/A',healthy:healthy.selectedResponse,retreat:retreat.selectedResponse,protect:protect.selectedResponse,deterministicReplay:true},null,2));
