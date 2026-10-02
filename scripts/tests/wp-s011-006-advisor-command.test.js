const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));}
function merge(a,b){const out=clone(a||{});for(const[k,v]of Object.entries(b||{}))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k]||{},v):clone(v);return out;}
function hash(s){let h=2166136261>>>0;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0).toString(16).toUpperCase().padStart(8,'0');}
const stores=new Map();
function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return{id:'STR|'+kind.toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return{current:merge(ref.key.initial,entry?.changes||{}),delta:entry?clone(entry):null};},
  applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return{ok:true,reason:'ok',entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,value){stores.set(String(campaign.seed),clone(value));return{ok:true};}
};

let commandLevel=1;
global.AdvisorProgression={getSkill(seed,skill){assert.equal(skill,'command');return{level:commandLevel,totalXp:(commandLevel-1)*100};}};

const modulePath=path.resolve(__dirname,'../world/advisor-command.js');
delete require.cache[modulePath];
const Command=require(modulePath);
assert(Command,'AdvisorCommand should attach to window');

const seed='WP-S011-006-SEED-A';
const operation={
  id:'OP-GATE-SECURITY',
  refId:'OPREF:GATE-SECURITY',
  objectiveId:'OBJ:SECURE-NORTH-GATE',
  targetRefId:'PLACE:NORTH-GATE',
  requiredAuthorityScope:'settlement:administration',
  validated:true,
  requirements:{routeRequired:true,minCapability:.7,minSupplyCoverage:.65,minEquipmentCoverage:.6,minCondition:.7,minAvailableActors:6}
};
function authority(scopes=['self','settlement:administration'],time='1201-05-07 09:00:00',refId='AUTH:PROTAGONIST'){
  return{sourceSystem:'ProtagonistAuthority',refId,fantasyTimestamp:time,validated:true,values:{scopes,rankTier:2}};
}
function health(values={},time='1201-05-07 09:00:00',refId='HEALTH:PROTAGONIST'){
  return{sourceSystem:'ProtagonistHealth',refId,fantasyTimestamp:time,validated:true,values:{conditionMilli:90000,fatigueMilli:15000,activeInjuryCount:0,...values}};
}
function inventory(values={},time='1201-05-07 09:00:00',refId='INV:PROTAGONIST'){
  return{sourceSystem:'ProtagonistInventory',refId,fantasyTimestamp:time,validated:true,values:{equipmentCoverage:.82,supplyCoverage:.78,missingRequirementCount:0,...values}};
}
function route(values={},time='1201-05-07 09:00:00',refId='ROUTE:NORTH-GATE'){
  return{sourceSystem:'RoutePlanner',refId,fantasyTimestamp:time,validated:true,values:{routeFound:true,routeRisk:.2,routeSeconds:900,stepCount:48,maxSlopeAngleDegrees:12,...values}};
}
function capability(values={},time='1201-05-07 09:00:00',refId='CAP:GATE-TEAM'){
  return{sourceSystem:'WorldState',refId,fantasyTimestamp:time,validated:true,values:{capability:.85,cohesion:.8,availableActors:10,groupSize:12,threat:.25,...values}};
}
function input(time='1201-05-07 09:00:00',sources=[authority(),health(),inventory(),route(),capability()]){
  return{fantasyTimestamp:time,operation,sources,providerPayload:{secret:'must-not-persist'}};
}

commandLevel=1;
const ready=Command.analyze(seed,input());
assert(ready.ok);assert.equal(ready.result.status,'ready');assert.equal(ready.result.assessment.blockers.length,0);
assert(ready.result.assessment.readinessScore>=.72);assert(ready.result.sourceRefIds.includes('AUTH:PROTAGONIST'));assert(ready.result.sourceRefIds.includes('ROUTE:NORTH-GATE'));
assert.equal(ready.progressionEvidence.toolId,'advisor.command');assert(/^CMD-[0-9A-F]{8}$/.test(ready.result.id));
const replay=Command.analyze(seed,input());
assert(replay.ok&&replay.duplicate);assert.equal(replay.result.id,ready.result.id);assert.equal(Command.snapshot(seed).analysisCount,1);

const unauthorized=Command.analyze('WP-S011-006-UNAUTH',input('1201-05-07 09:01:00',[authority(['self'],'1201-05-07 09:01:00'),health({},'1201-05-07 09:01:00'),inventory({},'1201-05-07 09:01:00'),route({},'1201-05-07 09:01:00'),capability({},'1201-05-07 09:01:00')]));
assert(unauthorized.ok);assert.equal(unauthorized.result.status,'blocked');assert(unauthorized.result.assessment.blockers.some(x=>x.id==='authority-scope-missing'));

const weak=Command.analyze('WP-S011-006-WEAK',input('1201-05-07 09:02:00',[
  authority(undefined,'1201-05-07 09:02:00'),health({conditionMilli:62000,fatigueMilli:72000,activeInjuryCount:2},'1201-05-07 09:02:00'),
  inventory({equipmentCoverage:.42,supplyCoverage:.35,missingRequirementCount:2},'1201-05-07 09:02:00'),
  route({routeRisk:.68},'1201-05-07 09:02:00'),capability({capability:.46,cohesion:.44,availableActors:4,threat:.72},'1201-05-07 09:02:00')
]));
assert(weak.ok);assert.equal(weak.result.status,'blocked');
for(const id of ['capability-below-required','supplies-below-required','equipment-below-required','actors-below-required','condition-below-required'])assert(weak.result.assessment.blockers.some(x=>x.id===id),id);
for(const id of ['high-fatigue','active-injuries','route-risk','threat-pressure','low-cohesion','limited-supplies'])assert(weak.result.assessment.risks.some(x=>x.id===id),id);

const routeBlocked=Command.analyze('WP-S011-006-ROUTE',input('1201-05-07 09:03:00',[authority(undefined,'1201-05-07 09:03:00'),health({},'1201-05-07 09:03:00'),inventory({},'1201-05-07 09:03:00'),route({routeFound:false},'1201-05-07 09:03:00'),capability({},'1201-05-07 09:03:00')]));
assert(routeBlocked.ok);assert.equal(routeBlocked.result.status,'blocked');assert(routeBlocked.result.assessment.blockers.some(x=>x.id==='route-unavailable'));

const unknown=Command.analyze('WP-S011-006-UNKNOWN',{fantasyTimestamp:'1201-05-07 09:04:00',operation,sources:[authority(undefined,'1201-05-07 09:04:00')]});
assert(unknown.ok);assert.equal(unknown.result.status,'blocked');
for(const key of ['missing:routeFound','missing:capability','missing:supplyCoverage','missing:equipmentCoverage','missing:availableActors','missing:condition'])assert(unknown.result.assessment.unknowns.includes(key),key);
assert(unknown.result.assessment.blockers.some(x=>x.id==='critical-missing:capability'));

commandLevel=1;
const low=Command.analyze('WP-S011-006-SKILL-LOW',input('1201-05-07 09:05:00'));
commandLevel=20;
const high=Command.analyze('WP-S011-006-SKILL-HIGH',input('1201-05-07 09:05:00'));
assert(low.ok&&high.ok);assert(high.result.details.length>low.result.details.length);
assert.equal(high.result.assessment.readinessScore,low.result.assessment.readinessScore);
assert.deepStrictEqual(high.result.assessment.blockers,low.result.assessment.blockers);
assert(high.result.skill.detailLimit<=Command.MAX_DETAILS);

commandLevel=20;
const highSkillUnauthorized=Command.analyze('WP-S011-006-UNAUTH-HIGH',input('1201-05-07 09:06:00',[authority(['self'],'1201-05-07 09:06:00'),health({},'1201-05-07 09:06:00'),inventory({},'1201-05-07 09:06:00'),route({},'1201-05-07 09:06:00'),capability({},'1201-05-07 09:06:00')]));
assert(highSkillUnauthorized.ok);assert.equal(highSkillUnauthorized.result.status,'blocked');assert(highSkillUnauthorized.result.assessment.blockers.some(x=>x.id==='authority-scope-missing'),'skill must not create authority');

const invalidField=Command.analyze('WP-S011-006-INVALID',{fantasyTimestamp:'1201-05-07 09:07:00',operation,sources:[{sourceSystem:'ProtagonistHealth',refId:'HEALTH:INVALID',fantasyTimestamp:'1201-05-07 09:07:00',validated:true,values:{capability:.9}}]});
assert.equal(invalidField.ok,false);assert(/Unsupported Command field/.test(invalidField.reason));
const unvalidated=Command.analyze('WP-S011-006-UNVALIDATED',{fantasyTimestamp:'1201-05-07 09:07:00',operation,sources:[{...health({},'1201-05-07 09:07:00'),validated:false}]});
assert.equal(unvalidated.ok,false);
const tooMany=Command.analyze('WP-S011-006-BOUNDS',{fantasyTimestamp:'1201-05-07 09:07:00',operation,sources:Array.from({length:11},(_,i)=>capability({},'1201-05-07 09:07:00','CAP:'+i))});
assert.equal(tooMany.ok,false);

const before=Command.snapshot(seed),saved=global.WorldState.serializeState(seed);
assert(before.serializedBytes<=Command.MAX_LEDGER_BYTES);assert.equal(before.analysisCount,1);assert(!JSON.stringify(saved).includes('must-not-persist'));
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});
assert.equal(Command.snapshot(seed).analysisCount,0);
global.WorldState.restoreSerializedState({seed},saved);
assert.deepStrictEqual(Command.snapshot(seed),before);

const src=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!src.includes(forbidden),'forbidden non-authoritative input: '+forbidden);
for(const forbidden of ['ActionExecutor.','RoutePlanner.findRoute','RoutePlanner.beginRouteSearch','setPosition(','teleport(','ProtagonistAuthority.transition','ProtagonistInventory.apply','WorldState.settlementRef'])assert(!src.includes(forbidden),'Command tool must not execute/mutate/route: '+forbidden);
for(const required of ['fullWorldScan:false','wholeArmyScan:false','wholeHistoryScan:false','perFrameScan:false','directWorldMutation:false','directPositionMutation:false','unitMutation:false','combatMutation:false','resourceMutation:false','inventoryMutation:false','routeMutation:false','authorityMutation:false','orderExecution:false','protagonistDecisionAuthority:false','worldTruthAuthority:false','simulationValidationBypass:false'])assert(src.includes(required),'missing authority/bounds marker: '+required);

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/advisor-command.js?v=advisor-command-v1';
  assert(html.includes(script),'canonical root must load AdvisorCommand');
  assert(html.indexOf(script)>html.indexOf('scripts/world/advisor-stewardship.js?v=advisor-stewardship-v1'));
  assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));
}

const final=Command.snapshot(seed);
assert.equal(final.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(final.chronologyAuthority,'Fantasy Game Time');
assert.equal(final.sourceAuthority,'validated bounded authority/health/inventory/route/world summaries only');
assert.equal(final.maxSources,10);assert.equal(final.maxFacts,64);assert.equal(final.maxAnalyses,24);assert.equal(final.maxDetails,12);assert.equal(final.maxAuthorityScopes,16);
assert.equal(final.fullWorldScan,false);assert.equal(final.wholeArmyScan,false);assert.equal(final.perFrameScan,false);
assert.equal(final.directWorldMutation,false);assert.equal(final.unitMutation,false);assert.equal(final.combatMutation,false);
assert.equal(final.resourceMutation,false);assert.equal(final.authorityMutation,false);assert.equal(final.orderExecution,false);
assert.equal(final.protagonistDecisionAuthority,false);assert.equal(final.worldTruthAuthority,false);

console.log(JSON.stringify({
  wp:'WP-S011-006',classification:'FUNCTIONAL',visual:'N/A — bounded Command readiness/risk analysis adds no rendered surface',pass:true,
  readyStatus:ready.result.status,readyScore:ready.result.assessment.readinessScore,
  unauthorizedBlocked:true,inadequateCapabilityBlocked:true,routeBlocked:true,unknownCriticalDataBlocked:true,
  deterministicReplay:true,duplicateIdempotence:true,sourceTraceability:true,
  lowSkillDetails:low.result.details.length,highSkillDetails:high.result.details.length,skillDoesNotChangeReadiness:true,skillCannotGrantAuthority:true,
  maxSources:Command.MAX_SOURCES,maxFacts:Command.MAX_FACTS,maxAnalyses:Command.MAX_ANALYSES,maxDetails:Command.MAX_DETAILS,
  saveReload:true,directWorldMutation:false,unitMutation:false,combatMutation:false,resourceMutation:false,orderExecution:false
},null,2));