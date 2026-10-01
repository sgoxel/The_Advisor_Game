'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const modulePath=path.resolve(__dirname,'../world/protagonist-guard-duty-selection.js');
delete require.cache[modulePath];
const Duty=require(modulePath);
assert.equal(Duty.VERSION,'protagonist-guard-duty-selection-v1');

global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
global.GameTime={getTimestampKey(){return '1201-07-03 10:15:00';}};
global.DailyActivity={build(){return [{id:'R-GUARD',displayName:'Serra',profession:'guard',workplaceId:'GATE-01',role:'guard'},{id:'R-ELDER',displayName:'Ivo',profession:'merchant',workplaceId:'MARKET-01',role:'resident'}];}};
global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:'guard',rankTier:1,scopes:['local-security','self']}};}};
global.ProtagonistStatusObligations={decisionContext(){return {ok:true,obligations:[]};}};
global.ProtagonistServiceContracts={read(){return {ledger:{activeContractId:null}};}};
global.ProtagonistHealth={snapshot(){return {conditionMilli:82000,fatigueMilli:25000,activeInjuryCount:0,injuryBurdenMilli:15000};}};
global.ProtagonistGoals={list(){return [{id:'GOAL-01',priority:90,targetId:'GATE-01'}];}};

const validPatrol=Duty.evaluate({seed:'WP-S014-005',when:'1201-07-03 10:15:00',identity:'protagonist',patrolRoute:{kind:'location',id:'GATE-01',label:'Main Gate',routeAvailable:true}});
assert(validPatrol.ok);assert.equal(validPatrol.selectedDuty,'patrol');
const repeated=Duty.evaluate({seed:'WP-S014-005',when:'1201-07-03 10:15:00',identity:'protagonist',patrolRoute:{kind:'location',id:'GATE-01',label:'Main Gate',routeAvailable:true}});
assert.deepStrictEqual(repeated,validPatrol,'replay must be deterministic');

const escortRoute=Duty.evaluate({seed:'WP-S014-005',when:'1201-07-03 10:15:00',identity:'protagonist',escortTarget:{kind:'person',id:'R-ELDER',label:'Ivo',routeAvailable:true},routeAvailable:true});
assert(escortRoute.ok);assert.equal(escortRoute.selectedDuty,'escort');

const healthBlock=Duty.evaluate({seed:'WP-S014-005',when:'1201-07-03 10:15:00',identity:'protagonist',patrolRoute:{kind:'location',id:'GATE-01',label:'Main Gate',routeAvailable:true},health:{conditionMilli:20000,fatigueMilli:90000,activeInjuryCount:2,injuryBurdenMilli:80000}});
assert(healthBlock.ok);assert.equal(healthBlock.selectedDuty,'defer');

const noAuthority=Duty.evaluate({seed:'WP-S014-005',when:'1201-07-03 10:15:00',identity:'protagonist',patrolRoute:{kind:'location',id:'GATE-01',label:'Main Gate',routeAvailable:true},authority:{currentRole:{roleId:'local-resident',scopes:['self']}}});
assert(noAuthority.ok);assert.equal(noAuthority.selectedDuty,'stand-down');

assert.equal(Duty.telemetry().fullWorldScan,false);assert.equal(Duty.telemetry().wholeSettlementScan,false);assert.equal(Duty.telemetry().wholeHistoryScan,false);assert.equal(Duty.telemetry().perFrameScan,false);
assert.equal(Duty.snapshot('WP-S014-005','protagonist',{when:'1201-07-03 10:15:00'}).guardRole,true);

const src=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','setPosition(','teleport(','ActionExecutor.','WorldState.applyDelta','ProtagonistAuthority.transition','DirectActionExecution','LocalSecurityIncidents'])assert(!src.includes(forbidden),'forbidden authority or runtime mutation: '+forbidden);
for(const required of ['fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','proposalOnly:true','simulationValidationRequired:true','npcPatrolAuthority:false','guardCommandAuthority:false'])assert(src.includes(required),'missing guard '+required);

const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
const script='scripts/world/protagonist-guard-duty-selection.js?v=protagonist-guard-duty-selection-v1';
assert(html.includes(script),'production root must load the duty selector');

console.log(JSON.stringify({pass:true,wp:'WP-S014-005',classification:'FUNCTIONAL',visual:'N/A',patrol:validPatrol.selectedDuty,escort:escortRoute.selectedDuty,healthBlocked:healthBlock.selectedDuty,standDown:noAuthority.selectedDuty,telemetry:Duty.telemetry()},null,2));
