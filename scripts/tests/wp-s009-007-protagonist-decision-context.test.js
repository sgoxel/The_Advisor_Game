const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

const modulePath=path.resolve(__dirname,'../world/protagonist-decision-context.js');
delete require.cache[modulePath];
const DecisionContext=require(modulePath);
assert(DecisionContext,'ProtagonistDecisionContext should attach to window');

const seed='WP-S009-007-SEED-A',when='1201-05-01 12:00:00';
const healthy={
  seed,when,
  snapshots:{
    personality:{personality:{traits:{resolve:72,ambition:64,caution:40,empathy:70}}},
    needs:{pressureMilli:{hunger:12000,fatigue:8000,safety:5000,social:10000}},
    goals:{records:[{id:'GOAL-DUTY-1',status:'active',priority:80},{id:'GOAL-LATER',status:'deferred',priority:95}]},
    relationships:{trust:80,dutyConflict:false},
    inventory:{requirementsSatisfied:true},
    health:{conditionMilli:92000,fatigueMilli:9000},
    authority:{rankTier:2,scopes:['self','settlement:administration']}
  },
  requiredAuthorityScope:'settlement:administration'
};
const a=DecisionContext.build(healthy),b=DecisionContext.build(JSON.parse(JSON.stringify(healthy)));
assert.equal(a.ok,true);assert.deepStrictEqual(b,a,'same inputs should produce identical context');
assert(/^DCTX-[0-9A-F]{8}$/.test(a.contextId));
assert.equal(a.decisionContext.dutyConflict,false);
assert(a.reasons.includes('high-priority-commitment'));
assert(a.reasons.includes('high-social-acceptability'));
assert(a.reasons.includes('authority-scope-present'));
assert.equal(a.missingSources.length,0);
assert.equal(a.authority.directActionExecution,false);assert.equal(a.authority.worldMutation,false);assert.equal(a.authority.simulationValidationBypass,false);

const constrained=DecisionContext.build({
  seed,when,
  snapshots:{
    personality:{traits:{resolve:30,ambition:25,caution:90,empathy:25}},
    needs:{pressureMilli:{hunger:90000,fatigue:85000,safety:20000,social:70000}},
    goals:{records:[{id:'GOAL-DUTY-1',status:'active',priority:90}]},
    relationships:{trust:20,dutyConflict:true},
    inventory:{requirementsSatisfied:false},
    health:{conditionMilli:35000,fatigueMilli:80000},
    authority:{rankTier:0,scopes:['self']}
  },
  conflictingGoalIds:['GOAL-DUTY-1'],
  requiredAuthorityScope:'region:adjudication'
});
assert.equal(constrained.ok,true);assert.equal(constrained.decisionContext.dutyConflict,true);
for(const code of ['urgent-need-hunger','goal-conflict','duty-conflict','inventory-requirement-missing','health-constrained','authority-scope-missing','low-social-acceptability'])assert(constrained.reasons.includes(code),'missing reason '+code);
assert(constrained.decisionContext.value<a.decisionContext.value,'constraints should lower value');
assert(constrained.decisionContext.socialAcceptability<a.decisionContext.socialAcceptability,'low trust should lower social acceptability');

const missing=DecisionContext.build({seed,when,snapshots:{personality:{traits:{resolve:50}}},requiredAuthorityScope:'realm:advise'});
assert.equal(missing.ok,true);
for(const key of ['needs','goals','relationships','inventory','health','authority'])assert(missing.missingSources.includes(key),'missing source should be explicit: '+key);
assert(missing.reasons.includes('authority-scope-unavailable'));
assert.equal(typeof missing.decisionContext.value,'number');assert.equal(typeof missing.decisionContext.urgency,'number');
assert.equal(missing.authority.rankAuthority,false);assert.equal(missing.authority.inventoryAuthority,false);

const invalidSeed=DecisionContext.build({when,snapshots:{}});
assert.equal(invalidSeed.ok,false);assert.equal(invalidSeed.reason,'campaign-seed-required');
const invalidTime=DecisionContext.build({seed,when:'not-a-time',snapshots:{}});
assert.equal(invalidTime.ok,false);assert.equal(invalidTime.reason,'fantasy-time-required');

const manyGoals=[];for(let i=0;i<30;i++)manyGoals.push({id:'G'+i,status:'active',priority:100-i});
const bounded=DecisionContext.build({seed,when,snapshots:{goals:{records:manyGoals},relationships:{trust:50},authority:{rankTier:1,scopes:Array.from({length:30},(_,i)=>'scope:'+i)}},conflictingGoalIds:Array.from({length:30},(_,i)=>'G'+i),requiredAuthorityScope:'scope:29'});
assert(bounded.reasons.length<=DecisionContext.MAX_REASONS);assert(bounded.missingSources.length<=DecisionContext.MAX_MISSING_SOURCES);assert.equal(bounded.bounds.maxGoals,DecisionContext.MAX_GOALS);assert.equal(bounded.bounds.maxScopes,DecisionContext.MAX_SCOPES);
assert(bounded.reasons.includes('goal-conflict'));assert(bounded.reasons.includes('authority-scope-missing'),'authority scan must be bounded');

global.ProtagonistProfile={derive(){return healthy.snapshots.personality;}};
global.ProtagonistNeeds={snapshot(){return healthy.snapshots.needs;}};
global.ProtagonistGoals={snapshot(){return healthy.snapshots.goals;}};
global.ProtagonistInventory={snapshot(){return healthy.snapshots.inventory;}};
global.ProtagonistHealth={decisionContext(){return healthy.snapshots.health;}};
global.ProtagonistAuthority={decisionContext(){return healthy.snapshots.authority;}};
const live=DecisionContext.fromLive(seed,when,{relationships:healthy.snapshots.relationships,requiredAuthorityScope:'settlement:administration'});
assert.equal(live.ok,true);assert.deepStrictEqual(live.decisionContext,a.decisionContext,'bounded live adapters should match equivalent direct snapshots');

global.CommandSetInterface={
  validateProposal(snapshot,proposal){
    return Object.freeze({ok:true,status:'accepted',reason:'valid',proposalId:proposal.proposalId||null,commandId:proposal.commandId,validatedParameters:Object.freeze({...proposal.parameters}),source:proposal.source||'direct'});
  }
};
const evaluatorPath=path.resolve(__dirname,'../world/protagonist-command-evaluator.js');
delete require.cache[evaluatorPath];
const Evaluator=require(evaluatorPath);
const evalResult=Evaluator.evaluate({
  seed,when,
  snapshot:{snapshotId:'SNAP-1',context:{seed,when},targets:{}},
  proposal:{proposalId:'CTX-COMPAT-1',commandId:'advisor.query_information',parameters:{}},
  decisionContext:a.decisionContext,
  execute:false
});
assert.equal(evalResult.protagonistEvaluation.checked,true);
assert.deepStrictEqual(evalResult.protagonistEvaluation.factors.value,a.decisionContext.value);
assert.deepStrictEqual(evalResult.protagonistEvaluation.factors.urgency,a.decisionContext.urgency);
assert.equal(evalResult.execution.attempted,false);
assert.equal(evalResult.authority.parallelWorldAuthority,false);
assert.equal(evalResult.authority.simulationValidation,true);

global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;global.navigator={userAgent:'device-a'};
const presentationA=DecisionContext.build(healthy);
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'device-b'};
const presentationB=DecisionContext.build(healthy);
assert.deepStrictEqual(presentationB,presentationA,'presentation/device state influenced decision context');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input reference: '+forbidden);
assert(!source.includes('ActionExecutor'),'adapter must not execute actions');
assert(!source.includes('RoutePlanner'),'adapter must not route or move');
assert(!source.includes('applyDelta'),'adapter must not mutate WorldState');
assert(source.includes('fullWorldScan:false')&&source.includes('perFrameScan:false'),'bounded scan contract missing');

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/protagonist-decision-context.js?v=protagonist-decision-context-v1';
  assert(html.includes(script),'canonical root must load ProtagonistDecisionContext');
  assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-authority.js?v=protagonist-authority-v1'));
  assert(html.indexOf(script)<html.indexOf('scripts/world/protagonist-command-evaluator.js?v=protagonist-command-evaluator-v1'));
}

const telemetry=DecisionContext.telemetry();
assert(telemetry.builds>=8);assert(telemetry.liveBuilds>=1);assert(telemetry.invalid>=2);
assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.perFrameScan,false);assert.equal(telemetry.authority,false);

console.log(JSON.stringify({
  wp:'WP-S009-007',classification:'FUNCTIONAL',visual:'N/A — bounded decision-context adapter adds no rendered surface',pass:true,
  version:DecisionContext.VERSION,deterministicReplay:true,contrastingNeeds:true,healthConstraint:true,goalConflict:true,
  authorityScopeFiltering:true,inventoryConstraint:true,missingStateExplicit:true,evaluatorCompatible:true,executionAttempted:false,
  maxReasons:DecisionContext.MAX_REASONS,maxGoals:DecisionContext.MAX_GOALS,maxScopes:DecisionContext.MAX_SCOPES,
  fullWorldScan:false,perFrameScan:false,worldMutation:false,directActionExecution:false,telemetry
},null,2));
