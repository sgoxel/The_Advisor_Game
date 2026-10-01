'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const modulePath=path.resolve(__dirname,'../world/protagonist-guard-duty-selection.js');
delete require.cache[modulePath];
const Duty=require(modulePath);
assert.equal(Duty.VERSION,'protagonist-guard-duty-selection-v2');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const roster=Object.freeze([
  Object.freeze({id:'R-GUARD',displayName:'Serra',profession:'guard',workplaceId:'GATE-01',schedule:Object.freeze([{state:'work',startMinute:540,endMinute:720}])}),
  Object.freeze({id:'R-ELDER',displayName:'Ivo',profession:'merchant',workplaceId:'MARKET-01',schedule:Object.freeze([{state:'work',startMinute:600,endMinute:900}])})
]);
let employmentState={ok:true,status:'active',contract:{id:'EMP-GUARD',professionId:'guard',employerRef:{kind:'resident',id:'R-GUARD'},workplaceRef:{kind:'workplace',id:'GATE-01'},workBlocks:[{id:'guard-day',startMinute:540,endMinute:1020}]}};
let serviceState={available:false,reason:'no-active-service-contract',duties:[],coveredTargetRefs:[],locationRefs:[]};
let healthState={conditionMilli:82000,fatigueMilli:25000,activeInjuryCount:0,injuryBurdenMilli:15000};
let needsState={urgentNeeds:[],pressureMilli:{hunger:20000,fatigue:20000,safety:10000,social:10000}};
global.DailyActivity={build(){return roster;}};
global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:'local-resident',rankTier:0,scopes:['self']}};}};
global.ProtagonistStatusObligations={decisionContext(){return {ok:true,obligations:[{id:'OBL-EMP',kind:'employment-duty',state:'active',locationRef:{kind:'workplace',id:'GATE-01'},workBlocks:[{startMinute:540,endMinute:1020}]}]};}};
global.ProtagonistServiceContracts={dutyContext(){return serviceState;}};
global.ProtagonistEmployment={current(){return employmentState;}};
global.ProtagonistHealth={snapshot(){return healthState;}};
global.ProtagonistNeeds={snapshot(){return needsState;}};
global.ProtagonistGoals={list(){return [{id:'GOAL-GATE',status:'active',priority:90,targetRef:{kind:'workplace',id:'GATE-01'}}];}};

const route=id=>({available:true,validated:true,sourceRef:{kind:'route',id:'ROUTE-'+id}});
const proposal=(id,targetKey,targetId)=>({proposalId:id,commandId:'travel',parameters:{[targetKey]:targetId},source:'existing-command-proposal'});
const base={seed:'WP-S014-005',when:'1201-07-03 10:15:00',identity:'protagonist'};

const beforeRoster=JSON.parse(JSON.stringify(global.DailyActivity.build(base.seed)));
const patrol=Duty.evaluate({...base,candidates:[{id:'PATROL-GATE',duty:'patrol',targetRef:{kind:'workplace',id:'GATE-01'},routeEvidence:route('GATE'),proposal:proposal('MOVE-GATE','locationId','GATE-01')}]});
assert.equal(patrol.ok,true);
assert.equal(patrol.selectedDuty,'patrol');
assert.equal(patrol.status,'proposal-ready');
assert.equal(patrol.context.authorityRoleId,'local-resident','must not invent a guard authority role');
assert.equal(patrol.context.guardEmployment,true);
assert.equal(patrol.context.employmentDueNow,true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(global.DailyActivity.build(base.seed))),beforeRoster,'NPC DailyActivity must remain unchanged');

const repeated=Duty.evaluate({...base,candidates:[{id:'PATROL-GATE',duty:'patrol',targetRef:{kind:'workplace',id:'GATE-01'},routeEvidence:route('GATE'),proposal:proposal('MOVE-GATE','locationId','GATE-01')}]});
assert.deepStrictEqual(repeated,patrol,'same SEED + Fantasy Game Time + authority context must replay identically');

const scheduledCalls=[];
const scheduled=Duty.schedule(patrol,{snapshotId:'SNAP-1'},{decision:'autonomous'},{runtime:{schedule(config){scheduledCalls.push(config);return {ok:true,reason:'scheduled-through-runtime'};}}});
assert.equal(scheduled.ok,true);
assert.equal(scheduledCalls.length,1);
assert.equal(scheduledCalls[0].proposal.commandId,'travel');
assert.equal(scheduled.boundary,'ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation');

employmentState={ok:true,status:'none',contract:null};
serviceState={available:true,reason:'active-service',contractId:'SVC-HOUSE',roleType:'household-retainer',patronRef:{kind:'resident',id:'R-ELDER'},organizationRef:{kind:'workplace',id:'MARKET-01'},duties:[{dutyId:'escort-support',actionCategory:'service:escort',dueNow:true}],coveredTargetRefs:[{kind:'resident',id:'R-ELDER'}],locationRefs:[{kind:'workplace',id:'MARKET-01'}]};
const escort=Duty.evaluate({...base,candidates:[{id:'ESCORT-ELDER',duty:'escort',targetRef:{kind:'resident',id:'R-ELDER'},routeEvidence:route('ELDER'),proposal:proposal('MOVE-ELDER','personId','R-ELDER')}]});
assert.equal(escort.selectedDuty,'escort');
assert.equal(escort.context.serviceContractId,'SVC-HOUSE');
assert.deepStrictEqual(escort.context.serviceDueDutyIds,['escort-support']);

employmentState={ok:true,status:'active',contract:{id:'EMP-GUARD',professionId:'guard',employerRef:{kind:'resident',id:'R-GUARD'},workplaceRef:{kind:'workplace',id:'GATE-01'},workBlocks:[{id:'guard-day',startMinute:540,endMinute:1020}]}};
serviceState={available:false,reason:'no-active-service-contract',duties:[],coveredTargetRefs:[],locationRefs:[]};
const blockedRoute=Duty.evaluate({...base,candidates:[{id:'PATROL-BLOCKED',duty:'patrol',targetRef:{kind:'workplace',id:'GATE-01'},routeEvidence:{available:false,validated:true,sourceRef:{kind:'route',id:'ROUTE-BLOCKED'}}}]});
assert.equal(blockedRoute.selectedDuty,'defer');
assert.equal(blockedRoute.reason,'route-unavailable');

const fakeTarget=Duty.evaluate({...base,candidates:[{id:'FAKE',duty:'escort',targetRef:{kind:'resident',id:'R-INVENTED'},routeEvidence:route('FAKE')}]});
assert.equal(fakeTarget.selectedDuty,'stand-down');
assert(fakeTarget.reasons.some(x=>x.includes('ungrounded-local-target')));

employmentState={ok:true,status:'active',contract:{id:'EMP-GUARD',professionId:'guard',employerRef:{kind:'resident',id:'R-GUARD'},workplaceRef:{kind:'workplace',id:'GATE-01'},workBlocks:[{id:'early',startMinute:480,endMinute:600}]}};
const offHours=Duty.evaluate({...base,candidates:[{id:'PATROL-OFF',duty:'patrol',targetRef:{kind:'workplace',id:'GATE-01'},routeEvidence:route('OFF')}]});
assert.equal(offHours.selectedDuty,'stand-down');
assert.equal(offHours.reason,'outside-duty-window');

employmentState={ok:true,status:'active',contract:{id:'EMP-GUARD',professionId:'guard',employerRef:{kind:'resident',id:'R-GUARD'},workplaceRef:{kind:'workplace',id:'GATE-01'},workBlocks:[{id:'guard-day',startMinute:540,endMinute:1020}]}};
healthState={conditionMilli:20000,fatigueMilli:90000,activeInjuryCount:2,injuryBurdenMilli:80000};
const injured=Duty.evaluate({...base,candidates:[{id:'PATROL-HURT',duty:'patrol',targetRef:{kind:'workplace',id:'GATE-01'},routeEvidence:route('HURT')}]});
assert.equal(injured.selectedDuty,'defer');
assert.equal(injured.reason,'health-prevents-duty');

healthState={conditionMilli:90000,fatigueMilli:20000,activeInjuryCount:0,injuryBurdenMilli:0};
needsState={urgentNeeds:['hunger'],pressureMilli:{hunger:90000,fatigue:20000,safety:10000,social:10000}};
const hungry=Duty.evaluate({...base,candidates:[{id:'PATROL-HUNGRY',duty:'patrol',targetRef:{kind:'workplace',id:'GATE-01'},routeEvidence:route('HUNGRY')}]});
assert.equal(hungry.selectedDuty,'defer');
assert.equal(hungry.reason,'urgent-self-care-preempts-duty');

needsState={urgentNeeds:[],pressureMilli:{hunger:20000,fatigue:20000,safety:10000,social:10000}};
employmentState={ok:true,status:'none',contract:null};
serviceState={available:false,reason:'no-active-service-contract',duties:[],coveredTargetRefs:[],locationRefs:[]};
const noDuty=Duty.evaluate({...base,candidates:[{id:'FORGED-GUARD',duty:'patrol',targetRef:{kind:'workplace',id:'GATE-01'},routeEvidence:route('FORGED')}],authority:{currentRole:{roleId:'guard',scopes:['local-security']}}});
assert.equal(noDuty.selectedDuty,'stand-down','caller-supplied forged authority must not create duty legitimacy');
assert.equal(noDuty.context.authorityRoleId,'local-resident');

const src=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','setPosition(','teleport(','WorldState.applyDelta','ProtagonistAuthority.transition','ProtagonistServiceContracts.activate','ProtagonistServiceContracts.end','LocalSecurityIncidents','PersonalCombatExchange'])assert(!src.includes(forbidden),'forbidden authority/mutation/dependency: '+forbidden);
for(const required of ['fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','proposalOnly:true','simulationValidationRequired:true','npcPatrolAuthority:false','guardCommandAuthority:false','arrestAuthority:false','searchAuthority:false','seizureAuthority:false','lethalForceAuthority:false'])assert(src.includes(required),'missing guard '+required);

const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
assert(html.includes('scripts/world/protagonist-guard-duty-selection.js?v=protagonist-guard-duty-selection-v2'),'production root must load v2 duty selector');

const tele=Duty.telemetry();
assert.equal(tele.fullWorldScan,false);assert.equal(tele.wholeSettlementScan,false);assert.equal(tele.wholeHistoryScan,false);assert.equal(tele.perFrameScan,false);
assert(tele.rosterReads<=9&&tele.rosterReads>0);
console.log(JSON.stringify({pass:true,wp:'WP-S014-005',classification:'FUNCTIONAL',visual:'N/A',patrol:patrol.selectedDuty,escort:escort.selectedDuty,routeBlocked:blockedRoute.selectedDuty,offHours:offHours.selectedDuty,injured:injured.selectedDuty,urgentNeed:hungry.selectedDuty,forgedAuthority:noDuty.selectedDuty,runtimeBoundary:scheduled.boundary,telemetry:tele},null,2));
