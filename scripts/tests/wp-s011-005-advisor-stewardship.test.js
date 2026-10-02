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

let stewardshipLevel=1;
global.AdvisorProgression={getSkill(seed,skill){assert.equal(skill,'stewardship');return{level:stewardshipLevel,totalXp:(stewardshipLevel-1)*100};}};

const modulePath=path.resolve(__dirname,'../world/advisor-stewardship.js');
delete require.cache[modulePath];
const S=require(modulePath);
assert(S,'AdvisorStewardship should attach to window');

const seed='WP-S011-005-SEED-A';
const settlement={id:'SETTLEMENT-ALPHA',refId:'SETTLEMENT:ALPHA',sourceSystem:'WorldState',validated:true};
function aggregate(values={},time='1201-05-06 10:00:00',refId='AGG:ALPHA'){
  return{sourceSystem:'RegionalSettlementSimulation',refId,settlementId:settlement.id,fantasyTimestamp:time,validated:true,values:{population:780,capacity:1000,foodSupply:.82,prosperity:.76,tradeActivity:.72,productionOutput:.74,employmentPressure:.28,security:.81,diseaseHazardPressure:.18,migrationPressure:.22,infrastructure:.73,maintenancePressure:.24,fortificationPressure:.16,...values}};
}
function context(values={},time='1201-05-06 10:00:00',refId='CTX:ALPHA'){
  return{sourceSystem:'WorldContext',refId,settlementId:settlement.id,fantasyTimestamp:time,validated:true,values:{waterAvailability:.78,agriculturePotential:.8,mineralPotential:.42,timberPotential:.62,transportAccess:.76,hazardPressure:.2,...values}};
}
function input(time='1201-05-06 10:00:00',sources=[aggregate(),context()]){return{fantasyTimestamp:time,settlement,sources,providerPayload:{secret:'must-not-persist'}};}

stewardshipLevel=1;
const healthy=S.analyze(seed,input());
assert(healthy.ok);assert.equal(healthy.result.currentCondition.band,'healthy');
assert(healthy.result.opportunities.some(x=>x.id==='production-strength'));
assert(healthy.result.opportunities.some(x=>x.id==='trade-strength'));
assert(healthy.result.opportunities.some(x=>x.id==='agriculture-potential'));
assert.equal(healthy.result.unknowns.includes('resource-detail-unavailable'),false);
assert(healthy.result.details.length<=healthy.result.skill.detailLimit);
assert(healthy.result.facts.foodSupply.sourceRefIds.includes('AGG:ALPHA'));
assert(healthy.result.facts.waterAvailability.sourceRefIds.includes('CTX:ALPHA'));
assert.equal(healthy.progressionEvidence.toolId,'advisor.stewardship');
assert(/^STW-[0-9A-F]{8}$/.test(healthy.result.id));
const replay=S.analyze(seed,input());
assert(replay.ok&&replay.duplicate);assert.equal(replay.result.id,healthy.result.id);assert.equal(S.snapshot(seed).reportCount,1);

const pressured=S.analyze(seed,input('1201-05-06 10:01:00',[
  aggregate({population:980,capacity:1000,foodSupply:.22,prosperity:.34,productionOutput:.31,tradeActivity:.38,employmentPressure:.82,security:.3,diseaseHazardPressure:.76,migrationPressure:.72,infrastructure:.33,maintenancePressure:.79},'1201-05-06 10:01:00','AGG:PRESSURE'),
  context({waterAvailability:.2,agriculturePotential:.3,transportAccess:.35,hazardPressure:.74},'1201-05-06 10:01:00','CTX:PRESSURE')
]));
assert(pressured.ok);assert.equal(pressured.result.currentCondition.band,'strained');
for(const id of ['food-supply-constraint','water-availability-constraint','employment-pressure','maintenance-pressure','infrastructure-constraint','capacity-pressure'])assert(pressured.result.constraints.some(x=>x.id===id),id);
for(const id of ['disease-risk','migration-risk','security-risk','local-hazard-risk','acute-food-risk'])assert(pressured.result.risks.some(x=>x.id===id),id);

const stale=S.analyze('WP-S011-005-STALE',input('1201-05-20 10:00:00',[aggregate({},'1201-05-06 10:00:00','AGG:STALE')]));
assert(stale.ok);assert(stale.result.staleSourceRefs.includes('AGG:STALE'));assert(stale.result.unknowns.includes('stale:foodSupply'));assert.equal(stale.result.currentCondition.band,'insufficient');

const missing=S.analyze('WP-S011-005-MISSING',{fantasyTimestamp:'1201-05-06 11:00:00',settlement,sources:[{sourceSystem:'WorldState',refId:'WS:MINIMAL',settlementId:settlement.id,fantasyTimestamp:'1201-05-06 11:00:00',validated:true,values:{prosperity:.6}}]});
assert(missing.ok);
for(const key of ['missing:population','missing:capacity','missing:foodSupply','missing:productionOutput','missing:security'])assert(missing.result.unknowns.includes(key),key);
assert(missing.result.unknowns.includes('resource-detail-unavailable'));

const conflict=S.analyze('WP-S011-005-CONFLICT',{fantasyTimestamp:'1201-05-06 12:00:00',settlement,sources:[
  aggregate({foodSupply:.8},'1201-05-06 12:00:00','AGG:CONFLICT'),
  {sourceSystem:'WorldState',refId:'WS:CONFLICT',settlementId:settlement.id,fantasyTimestamp:'1201-05-06 12:00:00',validated:true,values:{foodSupply:.2}}
]});
assert(conflict.ok);assert.equal(conflict.result.facts.foodSupply.status,'conflicted');assert.equal(conflict.result.facts.foodSupply.value,null);
assert(conflict.result.unknowns.includes('conflicted:foodSupply'));assert(conflict.result.conflicts.some(x=>x.field==='foodSupply'));

stewardshipLevel=1;
const low=S.analyze('WP-S011-005-SKILL',input('1201-05-06 13:00:00'));
stewardshipLevel=20;
const high=S.analyze('WP-S011-005-SKILL-HIGH',input('1201-05-06 13:00:00'));
assert(low.ok&&high.ok);assert(high.result.details.length>low.result.details.length);
assert.equal(high.result.currentCondition.score,low.result.currentCondition.score);
assert.equal(high.result.facts.foodSupply.value,low.result.facts.foodSupply.value);
assert(high.result.skill.detailLimit<=S.MAX_DETAILS);

const invalidField=S.analyze('WP-S011-005-INVALID',{fantasyTimestamp:'1201-05-06 14:00:00',settlement,sources:[{sourceSystem:'WorldContext',refId:'CTX:INVALID',settlementId:settlement.id,fantasyTimestamp:'1201-05-06 14:00:00',validated:true,values:{population:100}}]});
assert.equal(invalidField.ok,false);assert(/Unsupported stewardship field/.test(invalidField.reason));
const unvalidated=S.analyze('WP-S011-005-UNVALIDATED',{fantasyTimestamp:'1201-05-06 14:00:00',settlement,sources:[{...context({},'1201-05-06 14:00:00'),validated:false}]});
assert.equal(unvalidated.ok,false);
const tooMany=S.analyze('WP-S011-005-BOUNDS',{fantasyTimestamp:'1201-05-06 14:00:00',settlement,sources:Array.from({length:9},(_,i)=>context({},'1201-05-06 14:00:00','CTX:'+i))});
assert.equal(tooMany.ok,false);

const before=S.snapshot(seed),saved=global.WorldState.serializeState(seed);
assert(before.serializedBytes<=S.MAX_LEDGER_BYTES);assert.equal(before.reportCount,2);
assert(!JSON.stringify(saved).includes('must-not-persist'));
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});
assert.equal(S.snapshot(seed).reportCount,0);
global.WorldState.restoreSerializedState({seed},saved);
assert.deepStrictEqual(S.snapshot(seed),before);

const src=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!src.includes(forbidden),'forbidden non-authoritative input: '+forbidden);
for(const forbidden of ['ActionExecutor.','RoutePlanner.','setPosition(','teleport(','SettlementArchetypes.build','WorldState.settlementRef','RegionalSettlementSimulation.apply','ProtagonistInventory.'])assert(!src.includes(forbidden),'stewardship must not scan/mutate/execute: '+forbidden);
for(const required of ['fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','directWorldMutation:false','economyMutation:false','resourceMutation:false','buildingMutation:false','ownershipMutation:false','populationMutation:false','workMutation:false','protagonistDecisionAuthority:false','worldTruthAuthority:false','simulationValidationBypass:false'])assert(src.includes(required),'missing authority/bounds marker: '+required);

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/advisor-stewardship.js?v=advisor-stewardship-v1';
  assert(html.includes(script),'canonical root must load AdvisorStewardship');
  assert(html.indexOf(script)>html.indexOf('scripts/world/advisor-diplomacy.js?v=advisor-diplomacy-v1'));
  assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));
}

const final=S.snapshot(seed);
assert.equal(final.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(final.chronologyAuthority,'Fantasy Game Time');
assert.equal(final.sourceAuthority,'validated bounded settlement/local summaries only');
assert.equal(final.maxSources,8);assert.equal(final.maxFacts,48);assert.equal(final.maxReports,24);assert.equal(final.maxDetails,10);
assert.equal(final.fullWorldScan,false);assert.equal(final.wholeSettlementScan,false);assert.equal(final.perFrameScan,false);
assert.equal(final.directWorldMutation,false);assert.equal(final.economyMutation,false);assert.equal(final.resourceMutation,false);
assert.equal(final.ownershipMutation,false);assert.equal(final.populationMutation,false);
assert.equal(final.protagonistDecisionAuthority,false);assert.equal(final.worldTruthAuthority,false);

console.log(JSON.stringify({
  wp:'WP-S011-005',classification:'FUNCTIONAL',visual:'N/A — bounded Stewardship analysis/report logic adds no rendered surface',pass:true,
  healthyBand:healthy.result.currentCondition.band,pressuredBand:pressured.result.currentCondition.band,
  staleExplicit:true,missingExplicit:true,conflictExplicit:true,sourceTraceability:true,deterministicReplay:true,duplicateIdempotence:true,
  lowSkillDetails:low.result.details.length,highSkillDetails:high.result.details.length,skillDoesNotChangeFacts:true,
  maxSources:S.MAX_SOURCES,maxFacts:S.MAX_FACTS,maxReports:S.MAX_REPORTS,maxDetails:S.MAX_DETAILS,saveReload:true,
  directWorldMutation:false,economyMutation:false,resourceMutation:false,ownershipMutation:false
},null,2));