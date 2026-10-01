"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");

global.window=globalThis;

const stores=new Map();
function state(seed){if(!stores.has(seed))stores.set(seed,{entries:{},sequence:0});return stores.get(seed)}
function clone(v){return v==null||typeof v!=="object"?v:JSON.parse(JSON.stringify(v))}
function merge(a,b){const out=(a&&typeof a==="object"&&!Array.isArray(a))?clone(a):{};for(const [k,v] of Object.entries(b||{})){out[k]=(v&&typeof v==="object"&&!Array.isArray(v))?merge(out[k],v):clone(v)}return out}
global.WorldState={
  structuralRef:(seed,kind,parent,key,initial)=>({id:"STR|"+kind+"|"+parent+"|"+key,kind,key:{initial:clone(initial||{})}}),
  resolve:(seed,ref)=>{const s=state(seed),entry=s.entries[ref.id]||null;return {current:merge(clone(ref.key?.initial||{}),entry?.changes||{}),delta:entry}},
  applyDelta:(seed,ref,changes,reason)=>{const s=state(seed),prev=s.entries[ref.id]||null;s.sequence++;s.entries[ref.id]={revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:"ok",entry:clone(s.entries[ref.id])}}
};
const levels={insight:8,rhetoric:9,diplomacy:10,stewardship:11,command:12,intrigue:13};
global.AdvisorProgression={getSkill:(_seed,skill)=>({level:levels[skill]||1,totalXp:(levels[skill]||1)*100})};

const modulePath=path.resolve(__dirname,"../world/advisor-tool-resolution.js");
delete require.cache[require.resolve(modulePath)];
const R=require(modulePath);

const tools=[
  ["advisor.insight","AdvisorInsight"],
  ["advisor.rhetoric","AdvisorRhetoric"],
  ["advisor.diplomacy","AdvisorDiplomacy"],
  ["advisor.stewardship","AdvisorStewardship"],
  ["advisor.command","AdvisorCommand"],
  ["advisor.intrigue","AdvisorIntrigue"]
];

function base(toolId,sourceSystem,requestId,when="1201-05-07 09:00:00"){
  return {requestId,toolId,fantasyTimestamp:when,context:{refId:"CTX:"+toolId,sourceSystem,validated:true},accessibility:{inputModality:"keyboard"}};
}

for(const [toolId,sourceSystem] of tools){
  const seed="WP-S011-008-"+toolId;
  const a=R.autoResolve(seed,base(toolId,sourceSystem,"AUTO-1"));
  assert(a.ok,toolId+" auto must resolve");
  assert.equal(a.result.mode,"auto");
  assert(a.result.scoreMilli>=0&&a.result.scoreMilli<=1000);
  assert(a.result.contribution>=0&&a.result.contribution<=R.TOOL_POLICIES[toolId].cap+1e-9);
  assert.equal(a.result.downstream.contract,"AdvisorToolContribution");
  assert.equal(a.result.downstream.toolId,toolId);
  assert.equal(a.result.downstream.requiresToolValidation,true);
  assert.equal(a.result.downstream.protagonistChoiceRequired,true);
  assert.equal(a.result.downstream.simulationValidationRequired,true);
  assert.equal(a.result.authority.advisoryOnly,true);
  assert.equal(a.result.authority.executesAction,false);
  assert.equal(a.result.authority.grantsAuthority,false);

  const replay=R.autoResolve(seed,base(toolId,sourceSystem,"AUTO-1"));
  assert(replay.ok&&replay.duplicate,toolId+" auto duplicate");
  assert.equal(replay.result.id,a.result.id);
  assert.equal(replay.result.contribution,a.result.contribution);

  const equivalent=R.assistedResolve(seed,{
    ...base(toolId,sourceSystem,"ASSIST-EQ","1201-05-07 09:01:00"),
    miniGame:{version:1,validated:true,attemptRef:"MG-EQ",scoreMilli:a.result.scoreMilli,eventCount:12}
  });
  assert(equivalent.ok);
  assert.equal(equivalent.result.contribution,a.result.contribution,"same score must use same contribution envelope");

  const low=R.assistedResolve(seed,{
    ...base(toolId,sourceSystem,"ASSIST-LOW","1201-05-07 09:02:00"),
    miniGame:{version:1,validated:true,attemptRef:"MG-LOW",scoreMilli:100,eventCount:5}
  });
  const high=R.assistedResolve(seed,{
    ...base(toolId,sourceSystem,"ASSIST-HIGH","1201-05-07 09:03:00"),
    miniGame:{version:1,validated:true,attemptRef:"MG-HIGH",scoreMilli:1000,eventCount:20}
  });
  assert(low.ok&&high.ok);
  assert(high.result.contribution>low.result.contribution);
  assert.equal(high.result.contribution,R.TOOL_POLICIES[toolId].cap);
}

const modalitySeed="WP-S011-008-MODALITY";
const key=R.assistedResolve(modalitySeed,{
  ...base("advisor.rhetoric","AdvisorRhetoric","MODALITY-1"),
  accessibility:{inputModality:"keyboard"},
  miniGame:{version:1,validated:true,attemptRef:"MG-MOD",scoreMilli:720,eventCount:10}
});
const touch=R.assistedResolve(modalitySeed,{
  ...base("advisor.rhetoric","AdvisorRhetoric","MODALITY-1"),
  accessibility:{inputModality:"touch"},
  miniGame:{version:1,validated:true,attemptRef:"MG-MOD",scoreMilli:720,eventCount:10}
});
assert(key.ok&&touch.ok&&touch.duplicate);
assert.equal(key.result.id,touch.result.id);
assert.equal(key.result.contribution,touch.result.contribution);
assert.equal(key.result.scoreMilli,touch.result.scoreMilli);

const invalids=[
  R.assistedResolve("BAD-A",{...base("advisor.insight","AdvisorInsight","BAD-1"),miniGame:{version:1,validated:false,attemptRef:"X",scoreMilli:500,eventCount:1}}),
  R.assistedResolve("BAD-B",{...base("advisor.insight","AdvisorInsight","BAD-2"),miniGame:{version:1,validated:true,attemptRef:"X",scoreMilli:1001,eventCount:1}}),
  R.assistedResolve("BAD-C",{...base("advisor.insight","AdvisorInsight","BAD-3"),miniGame:{version:1,validated:true,attemptRef:"X",scoreMilli:500,eventCount:R.MAX_MINIGAME_EVENTS+1}}),
  R.autoResolve("BAD-D",{...base("advisor.insight","AdvisorInsight","BAD-4"),context:{refId:"CTX",sourceSystem:"AdvisorInsight",validated:false}}),
  R.autoResolve("BAD-E",{...base("advisor.insight","AdvisorInsight","BAD-5"),context:{refId:"CTX",sourceSystem:"AdvisorInsight",validated:true,providerPayload:{secret:true}}}),
  R.autoResolve("BAD-F",base("advisor.unknown","AdvisorToolFixture","BAD-6"))
];
for(const row of invalids)assert.equal(row.ok,false);

const conflictSeed="WP-S011-008-CONFLICT";
const first=R.assistedResolve(conflictSeed,{
  ...base("advisor.diplomacy","AdvisorDiplomacy","REQUEST-CONFLICT"),
  miniGame:{version:1,validated:true,attemptRef:"MG-A",scoreMilli:400,eventCount:4}
});
const changed=R.assistedResolve(conflictSeed,{
  ...base("advisor.diplomacy","AdvisorDiplomacy","REQUEST-CONFLICT"),
  miniGame:{version:1,validated:true,attemptRef:"MG-B",scoreMilli:800,eventCount:4}
});
assert(first.ok);
assert.equal(changed.ok,false);
assert.equal(changed.reason,"resolution-request-conflict");

const offlineA=R.autoResolve("WP-S011-008-OFFLINE",base("advisor.command","AdvisorCommand","OFFLINE-1","1201-05-07 10:00:00"));
const offlineB=R.autoResolve("WP-S011-008-OFFLINE",base("advisor.command","AdvisorCommand","OFFLINE-1","1201-05-07 10:00:00"));
assert(offlineA.ok&&offlineB.ok&&offlineB.duplicate);
assert.equal(offlineA.result.id,offlineB.result.id);

const saveSeed="WP-S011-008-SAVE";
const savedResult=R.autoResolve(saveSeed,base("advisor.intrigue","AdvisorIntrigue","SAVE-1"));
assert(savedResult.ok);
const before=R.snapshot(saveSeed),saved=JSON.stringify(clone(stores.get(saveSeed)));
stores.set(saveSeed,{entries:{},sequence:0});
assert.equal(R.snapshot(saveSeed).resolutionCount,0);
stores.set(saveSeed,JSON.parse(saved));
assert.deepStrictEqual(R.snapshot(saveSeed),before);
assert(before.serializedBytes<=R.MAX_LEDGER_BYTES);
assert(R.listResolutions(saveSeed,{limit:99}).length===1);

const src=fs.readFileSync(modulePath,"utf8");
for(const forbidden of ["Math.random","Date.now","new Date(","performance.","navigator.","fetch(","XMLHttpRequest","WebSocket","innerWidth","innerHeight","devicePixelRatio"])assert(!src.includes(forbidden),"forbidden non-authoritative/offline dependency: "+forbidden);
for(const forbidden of ["ActionExecutor.","RoutePlanner.","ProtagonistAuthority.transition","ProtagonistInventory.apply","setPosition(","teleport(","CharacterMemory.record","LocalRumors.revealLead"])assert(!src.includes(forbidden),"resolution boundary must not execute/mutate: "+forbidden);
for(const required of ["inputModalityAuthority:false","providerAuthority:false","deviceAuthority:false","frameRateAuthority:false","miniGameSimulationAuthority:false","directWorldMutation:false","directActionExecution:false","grantsAuthority:false","createsFacts:false","guaranteedOutcome:false","protagonistDecisionAuthority:false","simulationValidationBypass:false","fullWorldScan:false","wholeHistoryScan:false","perFrameScan:false"])assert(src.includes(required),"missing authority marker: "+required);

const repoRoot=path.resolve(__dirname,"../.."),indexPath=path.join(repoRoot,"index.html");
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,"utf8"),script="scripts/world/advisor-tool-resolution.js?v=advisor-tool-resolution-v1";
  assert(html.includes(script),"canonical root must load AdvisorToolResolutionBoundary");
  assert(html.indexOf(script)>html.indexOf("scripts/world/advisor-intrigue.js?v=advisor-intrigue-v1"));
  assert(html.indexOf(script)<html.indexOf("scripts/world/advisor-channel.js?v=advisor-chat-v1"));
}

const final=R.snapshot(saveSeed);
assert.equal(final.persistenceAuthority,"WorldState CampaignStateDelta");
assert.equal(final.chronologyAuthority,"Fantasy Game Time");
assert.equal(final.autoResolutionDeterministic,true);
assert.equal(final.autoResolutionOffline,true);
assert.equal(final.miniGameOptional,true);
assert.equal(final.maxResolutions,32);
assert.equal(final.maxMiniGameEvents,64);
assert.equal(Object.keys(final.toolPolicies).length,6);

console.log(JSON.stringify({
  wp:"WP-S011-008",classification:"FUNCTIONAL",visual:"N/A — shared auto-resolution/mini-game authority boundary adds no interactive rendered surface",pass:true,
  allSixToolsAutoResolve:true,manualLowHighValidated:true,modeIndependentEnvelope:true,
  keyboardTouchEquivalent:true,offline:true,deterministicReplay:true,duplicateIdempotence:true,
  invalidContributionRejected:true,requestConflictRejected:true,saveReload:true,
  miniGameOptional:true,miniGameSimulationAuthority:false,protagonistChoiceRequired:true,simulationValidationRequired:true,
  maxResolutions:R.MAX_RESOLUTIONS,maxLedgerBytes:R.MAX_LEDGER_BYTES,maxMiniGameEvents:R.MAX_MINIGAME_EVENTS
},null,2));
