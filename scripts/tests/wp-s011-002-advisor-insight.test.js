const assert=require('assert');
const fs=require('fs');
const path=require('path');
global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{})){out[k]=(v&&typeof v==='object'&&!Array.isArray(v))?merge(out[k]||{},v):clone(v);}return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0).toString(16).toUpperCase().padStart(8,'0');}
const stores=new Map();
function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return{id:'STR|'+String(kind).toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return{current:merge(ref.key.initial,entry?.changes||{}),delta:entry?clone(entry):null};},
  applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return{ok:true,reason:'ok',entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,value){stores.set(String(campaign.seed),clone(value));return{ok:true};}
};
let insightLevel=1;
global.AdvisorProgression={getSkill(seed,skill){assert.equal(skill,'insight');return{level:insightLevel,totalXp:(insightLevel-1)*100};}};

const modulePath=path.resolve(__dirname,'../world/advisor-insight.js');
delete require.cache[modulePath];
const Insight=require(modulePath);
assert(Insight,'AdvisorInsight should attach to window');

const seed='WP-S011-002-SEED-A';
function ev(refId,subjectId,sourceType,reliability,claimKey,stance='support',fantasyTimestamp='1201-05-04 08:00:00'){
  return{refId,subjectId,sourceType,reliability,claimKey,stance,fantasyTimestamp,claimText:'must-not-persist',providerPayload:{secret:'must-not-persist'}};
}

const strongInput={
  subject:{id:'PERSON-ALDA',type:'person'},
  fantasyTimestamp:'1201-05-04 09:00:00',
  evidence:[
    ev('OBS-1','PERSON-ALDA','direct-observation','verified','whereabouts'),
    ev('SIM-1','PERSON-ALDA','simulation','verified','whereabouts'),
    ev('DOC-1','PERSON-ALDA','document','credible','employment')
  ]
};
const strong=Insight.analyze(seed,strongInput);
assert(strong.ok);
assert.equal(strong.result.status,'supported');
assert.equal(strong.result.qualityBand,'strong');
assert.equal(strong.result.conflictCount,0);
assert(strong.result.corroboratedClaims>=1);
assert.equal(strong.result.worldTruth,false);

const weak=Insight.analyze(seed,{
  subject:{id:'PLACE-MILL',type:'place'},
  fantasyTimestamp:'1201-05-04 09:01:00',
  evidence:[ev('RUMOR-1','PLACE-MILL','rumor','uncertain','danger')]
});
assert(weak.ok);
assert(['weak','moderate'].includes(weak.result.qualityBand));
assert(weak.result.unresolvedGaps.includes('hearsay-present'));

const conflict=Insight.analyze(seed,{
  subject:{id:'RUMOR-BRIDGE',type:'rumor'},
  fantasyTimestamp:'1201-05-04 09:02:00',
  evidence:[
    ev('MEM-1','RUMOR-BRIDGE','memory','credible','bridge-open','support'),
    ev('EVT-1','RUMOR-BRIDGE','event','verified','bridge-open','contradict')
  ]
});
assert(conflict.ok);
assert.equal(conflict.result.status,'conflicted');
assert(conflict.result.unresolvedGaps.includes('conflicting-evidence'));

const missing=Insight.analyze(seed,{
  subject:{id:'EVENT-FAIR',type:'event'},
  fantasyTimestamp:'1201-05-04 09:03:00',
  evidence:[]
});
assert(missing.ok);
assert.equal(missing.result.status,'insufficient');
assert.equal(missing.result.evidenceQualityScore,0);
assert(missing.result.unresolvedGaps.includes('no-evidence-supplied'));

assert.equal(Insight.analyze(seed,{subject:{id:'X',type:'unknown'},fantasyTimestamp:'1201-05-04 09:04:00',evidence:[]}).ok,false);
assert.equal(Insight.analyze(seed,{subject:{id:'PERSON-X',type:'person'},fantasyTimestamp:'1201-05-04 09:04:00',evidence:[{...ev('BAD','OTHER','simulation','verified','x')}]}).ok,false);
assert.equal(Insight.analyze(seed,{subject:{id:'PERSON-X',type:'person'},fantasyTimestamp:'1201-05-04 09:04:00',evidence:[{...ev('BAD','PERSON-X','oracle','verified','x')}]}).ok,false);

const dup=Insight.analyze(seed,strongInput);
assert(dup.ok&&dup.duplicate);
assert.equal(Insight.snapshot(seed).resultCount,4);

const saved=global.WorldState.serializeState(seed),before=Insight.snapshot(seed);
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});
assert.equal(Insight.snapshot(seed).resultCount,0);
global.WorldState.restoreSerializedState({seed},saved);
assert.deepStrictEqual(Insight.snapshot(seed),before);
assert(!JSON.stringify(saved).includes('must-not-persist'),'claim/provider payload leaked into compact persistence');

const other='WP-S011-002-SEED-B';
const otherResult=Insight.analyze(other,{
  subject:{id:'PERSON-ALDA',type:'person'},
  fantasyTimestamp:'1201-05-04 09:00:00',
  evidence:[ev('OBS-1','PERSON-ALDA','direct-observation','verified','whereabouts')]
});
assert(otherResult.ok);
assert.notEqual(Insight.snapshot(other).advisorProfileId,before.advisorProfileId);

insightLevel=1;
stores.set('SKILL-A',{schema:'CampaignStateDelta',seed:'SKILL-A',sequence:0,entries:{}});
const low=Insight.analyze('SKILL-A',{...strongInput,evidence:strongInput.evidence.map(clone)});
insightLevel=20;
stores.set('SKILL-B',{schema:'CampaignStateDelta',seed:'SKILL-B',sequence:0,entries:{}});
const high=Insight.analyze('SKILL-B',{...strongInput,evidence:strongInput.evidence.map(clone)});
assert.equal(low.result.evidenceQualityScore,high.result.evidenceQualityScore,'Insight skill must not change evidence quality');
assert(high.result.interpretiveConfidence>low.result.interpretiveConfidence);
assert(high.result.insightModifier<=Insight.MAX_SKILL_MODIFIER);

insightLevel=1;
const replaySeed='WP-S011-002-REPLAY';
stores.set(replaySeed,{schema:'CampaignStateDelta',seed:replaySeed,sequence:0,entries:{}});
const replayA=Insight.analyze(replaySeed,{...strongInput,evidence:strongInput.evidence.map(clone)});
stores.set(replaySeed,{schema:'CampaignStateDelta',seed:replaySeed,sequence:0,entries:{}});
const replayB=Insight.analyze(replaySeed,{...strongInput,evidence:strongInput.evidence.map(clone)});
assert.deepStrictEqual(replayA.result,replayB.result,'same SEED/time/evidence/skill must replay identically');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input: '+forbidden);
for(const forbidden of ['ActionExecutor.','RoutePlanner.','setPosition(','teleport('])assert(!source.includes(forbidden),'Insight must not execute/move: '+forbidden);
for(const required of ['fullWorldScan:false','wholeHistoryScan:false','perFrameScan:false','directWorldMutation:false','worldTruthAuthority:false','simulationValidationBypass:false'])assert(source.includes(required),'missing authority/bounds marker: '+required);

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/advisor-insight.js?v=advisor-insight-v1';
  assert(html.includes(script),'canonical root must load AdvisorInsight');
  assert(html.indexOf(script)>html.indexOf('scripts/world/advisor-progression.js?v=advisor-progression-v1'));
  assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));
}

const snap=Insight.snapshot(seed);
assert(snap.serializedBytes<=Insight.MAX_LEDGER_BYTES);
assert.equal(snap.maxEvidence,12);
assert.equal(snap.maxResults,24);
assert.equal(snap.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(snap.chronologyAuthority,'Fantasy Game Time');
assert.equal(snap.evidenceAuthority,'supplied authoritative/local references only');
assert.equal(snap.fullWorldScan,false);
assert.equal(snap.wholeHistoryScan,false);
assert.equal(snap.directWorldMutation,false);
assert.equal(snap.worldTruthAuthority,false);
assert.equal(snap.protagonistDecisionAuthority,false);

console.log(JSON.stringify({
  wp:'WP-S011-002',
  classification:'FUNCTIONAL',
  visual:'N/A — bounded investigation/evidence analysis adds no rendered surface',
  pass:true,
  strongCorroboration:true,
  weakHearsay:true,
  conflictPreserved:true,
  missingEvidence:true,
  invalidReferenceRejected:true,
  skillModifierBounded:true,
  skillAffectsEvidence:false,
  saveReload:true,
  campaignIsolation:true,
  deterministicReplay:true,
  resultCount:snap.resultCount,
  serializedBytes:snap.serializedBytes,
  maxEvidence:Insight.MAX_EVIDENCE,
  maxResults:Insight.MAX_RESULTS,
  maxSkillModifier:Insight.MAX_SKILL_MODIFIER,
  fullWorldScan:false,
  wholeHistoryScan:false,
  directWorldMutation:false,
  worldTruthAuthority:false
},null,2));