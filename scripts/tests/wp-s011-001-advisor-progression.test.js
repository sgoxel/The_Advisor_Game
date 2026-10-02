const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{})){out[k]=(v&&typeof v==='object'&&!Array.isArray(v))?merge(out[k]||{},v):clone(v);}return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return (h>>>0).toString(16).toUpperCase().padStart(8,'0');}
const stores=new Map();
function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return {id:'STR|'+String(kind).toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry?clone(entry):null};},
  applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:'ok',entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,value){stores.set(String(campaign.seed),clone(value));return {ok:true};}
};

const modulePath=path.resolve(__dirname,'../world/advisor-progression.js');
delete require.cache[modulePath];
const Progression=require(modulePath);
assert(Progression,'AdvisorProgression should attach to window');

const seed='WP-S011-001-SEED-A';
const initial=Progression.snapshot(seed);
assert.equal(initial.compatible,true);assert.equal(initial.skills.length,6);assert.equal(initial.eventCount,0);
assert.deepStrictEqual(initial.skills.map(x=>x.skill),['insight','rhetoric','diplomacy','stewardship','command','intrigue']);
assert(initial.skills.every(x=>x.level===1&&x.totalXp===0),'all six skills must begin at level 1 / 0 XP');
assert.notEqual(Progression.snapshot('WP-S011-001-SEED-B').advisorProfileId,initial.advisorProfileId,'alternate SEED must isolate Advisor profile identity');

function evidence(skill,i,band='success',time=`1201-05-04 08:${String(i).padStart(2,'0')}:00`){
  return {campaignSeed:seed,kind:'advisor-tool-result',authority:'AdvisorToolResolution',validated:true,rewardBand:band,fantasyTimestamp:time,toolId:'tool.'+skill,outcomeId:'OUT-'+skill+'-'+i,sourceSystem:'WP-S011-001-fixture',uiText:'must-not-persist',providerPayload:{secret:'must-not-persist'}};
}

let minute=1;
for(const skill of Progression.SKILLS){
  const result=Progression.award(seed,skill,evidence(skill,minute++,'practice'));
  assert.equal(result.ok,true);assert.equal(result.track.totalXp,20);assert(/^APX-[0-9A-F]{8}$/.test(result.event.id));
}
assert.equal(Progression.snapshot(seed).eventCount,6,'one validated event should exist per skill');

const strong=Progression.award(seed,'insight',evidence('insight',minute++,'milestone'));
assert.equal(strong.ok,true);assert(strong.track.level>=2,'threshold crossing should raise Insight level');
const duplicate=Progression.award(seed,'insight',evidence('insight',minute-1,'milestone',`1201-05-04 08:${String(minute-1).padStart(2,'0')}:00`));
assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);assert.equal(Progression.getSkill(seed,'insight').totalXp,strong.track.totalXp,'duplicate evidence inflated XP');

const forged=Progression.award(seed,'rhetoric',{...evidence('rhetoric',minute++),'authority':'UI'});
assert.equal(forged.ok,false);assert(/authority/.test(forged.reason));
const unvalidated=Progression.award(seed,'rhetoric',{...evidence('rhetoric',minute++),validated:false});
assert.equal(unvalidated.ok,false);assert(/validated/.test(unvalidated.reason));
const crossCampaign=Progression.award(seed,'diplomacy',{...evidence('diplomacy',minute++),campaignSeed:'OTHER-SEED'});
assert.equal(crossCampaign.ok,false);assert(/campaign mismatch/.test(crossCampaign.reason));
const unsupported=Progression.award(seed,'alchemy',evidence('alchemy',minute++));
assert.equal(unsupported.ok,false);assert(/Unsupported Advisor skill/.test(unsupported.reason));
const rewind=Progression.award(seed,'command',evidence('command',99,'success','1201-05-04 08:00:30'));
assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-progression-chronology');

const beforeSave=Progression.snapshot(seed),serialized=global.WorldState.serializeState(seed);
assert(beforeSave.serializedBytes<=Progression.MAX_LEDGER_BYTES);assert.equal(beforeSave.maxEvents,128);
const serializedText=JSON.stringify(serialized);
assert(!serializedText.includes('must-not-persist'),'UI/provider payload leaked into persistence');
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});
assert.equal(Progression.snapshot(seed).eventCount,0);
global.WorldState.restoreSerializedState({seed},serialized);
const afterReload=Progression.snapshot(seed);
assert.deepStrictEqual(afterReload,beforeSave,'save/reload must preserve progression exactly');

const other='WP-S011-001-SEED-C';
const otherAward=Progression.award(other,'insight',{...evidence('insight',1),campaignSeed:other,fantasyTimestamp:'1201-05-04 09:00:00',outcomeId:'OTHER-1'});
assert.equal(otherAward.ok,true);
assert.notEqual(Progression.snapshot(other).advisorProfileId,beforeSave.advisorProfileId);
assert.equal(Progression.snapshot(seed).eventCount,beforeSave.eventCount,'campaign isolation failed');

const deterministicStore=clone(serialized);
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});
let replayMinute=1;
for(const skill of Progression.SKILLS)assert(Progression.award(seed,skill,evidence(skill,replayMinute++,'practice')).ok);
assert(Progression.award(seed,'insight',evidence('insight',replayMinute++,'milestone')).ok);
const replay=Progression.snapshot(seed);
global.WorldState.restoreSerializedState({seed},deterministicStore);
assert.deepStrictEqual(replay.skills,Progression.snapshot(seed).skills,'same evidence must reproduce identical skill tracks');
assert.deepStrictEqual(replay.events,Progression.snapshot(seed).events,'same evidence must reproduce identical stable progression events');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input reference: '+forbidden);
for(const forbidden of ['ActionExecutor.','ProtagonistCommandEvaluator.','RoutePlanner.','setPosition(','teleport('])assert(!source.includes(forbidden),'progression must not execute/move/decide: '+forbidden);
for(const required of ['fullWorldScan:false','wholeHistoryScan:false','perFrameScan:false','simulationValidationBypass:false','providerPayloadPersisted:false'])assert(source.includes(required),'missing authority/bounds marker: '+required);

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/advisor-progression.js?v=advisor-progression-v1';
  assert(html.includes(script),'canonical root must load AdvisorProgression');
  assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-guidance.js?v=protagonist-guidance-v1'));
  assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));
}

const final=Progression.snapshot(seed);
assert.equal(final.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(final.chronologyAuthority,'Fantasy Game Time');
assert.equal(final.progressionAuthority,'validated Advisor tool/outcome evidence only');
assert.equal(final.gameplayWorldMutation,false);assert.equal(final.inventoryAuthority,false);assert.equal(final.politicalAuthority,false);
assert.equal(final.protagonistDecisionAuthority,false);assert.equal(final.guaranteedPersuasion,false);assert.equal(final.worldTruthAuthority,false);
assert.equal(final.fullWorldScan,false);assert.equal(final.wholeHistoryScan,false);assert.equal(final.perFrameScan,false);

console.log(JSON.stringify({wp:'WP-S011-001',classification:'FUNCTIONAL',visual:'N/A — progression persistence/authority logic adds no rendered surface',pass:true,version:Progression.VERSION,skills:final.skills.map(s=>({skill:s.skill,level:s.level,totalXp:s.totalXp})),stableEventIds:true,thresholdCrossing:true,duplicateIdempotence:true,forgedEvidenceRejected:true,crossCampaignRejected:true,saveReload:true,campaignIsolation:true,deterministicReplay:true,maxEvents:Progression.MAX_EVENTS,maxLedgerBytes:Progression.MAX_LEDGER_BYTES,maxQueryResults:Progression.MAX_QUERY_RESULTS,serializedBytes:final.serializedBytes,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,gameplayWorldMutation:false,protagonistDecisionAuthority:false,worldTruthAuthority:false},null,2));