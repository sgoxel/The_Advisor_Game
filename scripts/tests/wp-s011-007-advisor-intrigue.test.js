"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const vm=require("vm");

global.window=globalThis;

const stores=new Map();
function state(seed){if(!stores.has(seed))stores.set(seed,{entries:{},sequence:0});return stores.get(seed)}
function clone(v){return v==null||typeof v!=="object"?v:JSON.parse(JSON.stringify(v))}
function merge(a,b){const out=(a&&typeof a==="object"&&!Array.isArray(a))?clone(a):{};for(const [k,v] of Object.entries(b||{})){out[k]=(v&&typeof v==="object"&&!Array.isArray(v))?merge(out[k],v):clone(v)}return out}
global.WorldState={
  structuralRef:(seed,kind,parent,key,initial)=>({id:"STR|"+kind+"|"+parent+"|"+key,kind,key:{initial:clone(initial||{})}}),
  resolve:(seed,ref)=>{
    const s=state(seed),entry=s.entries[ref.id]||null;
    const initial=clone(ref.key?.initial||{});
    const current=merge(initial,entry?.changes||{});
    return {current,delta:entry};
  },
  applyDelta:(seed,ref,changes,reason)=>{
    const s=state(seed),prev=s.entries[ref.id]||null;
    s.sequence++;
    s.entries[ref.id]={revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};
    return {ok:true,reason:"ok",entry:clone(s.entries[ref.id])};
  }
};

let intrigueLevel=1;
global.AdvisorProgression={getSkill:(_seed,skill)=>skill==="intrigue"?{level:intrigueLevel,totalXp:(intrigueLevel-1)*100}:null};

const modulePath=path.resolve(__dirname,"../world/advisor-intrigue.js");
delete require.cache[require.resolve(modulePath)];
const Intrigue=require(modulePath);

function lead(sourceSystem,refId,subjectId,claimKey,opts={}){
  const defaults={
    LocalRumors:{epistemicClass:"attributed-claim",sourceType:"rumor",reliability:"uncertain",confidence:.46,relevance:.72},
    CharacterMemory:{epistemicClass:"attributed-claim",sourceType:"memory",reliability:"credible",confidence:.72,relevance:.78},
    AdvisorInsight:{epistemicClass:"inference",sourceType:"analysis",reliability:"credible",confidence:.68,relevance:.74},
    WorldState:{epistemicClass:"observed-fact",sourceType:"simulation",reliability:"verified",confidence:1,relevance:.9},
    EventScheduler:{epistemicClass:"observed-fact",sourceType:"event",reliability:"verified",confidence:.95,relevance:.84}
  }[sourceSystem];
  return {
    sourceSystem,refId,subjectId,claimKey,validated:true,stance:"support",
    fantasyTimestamp:"1201-05-07 08:30:00",
    ...defaults,...opts
  };
}
function input(when,leads,subjectId="PLACE:WATCHTOWER"){
  return {fantasyTimestamp:when,subject:{id:subjectId,type:"place"},leads};
}

const seed="WP-S011-007-BASE";
intrigueLevel=1;
const corroborated=Intrigue.analyze(seed,input("1201-05-07 09:00:00",[
  lead("LocalRumors","RUM:R01","PLACE:WATCHTOWER","road-danger"),
  lead("CharacterMemory","MEM:R02","PLACE:WATCHTOWER","road-danger",{epistemicClass:"observed-fact",sourceType:"direct-observation",reliability:"verified",confidence:.94}),
  lead("WorldState","WORLD:ROAD","PLACE:WATCHTOWER","road-danger",{confidence:1,relevance:.95})
]));
assert(corroborated.ok);
assert.equal(corroborated.result.status,"corroborated");
assert.equal(corroborated.result.conflictCount,0);
assert(corroborated.result.corroboratedClaimCount>=1);
assert.deepStrictEqual(Array.from(corroborated.result.epistemicBuckets.observedFacts).sort(),["MEM:R02","WORLD:ROAD"]);
assert.deepStrictEqual(corroborated.result.epistemicBuckets.attributedClaims,["RUM:R01"]);
assert.equal(corroborated.progressionEvidence.toolId,"advisor.intrigue");
assert(/^INT-[0-9A-F]{8}$/.test(corroborated.result.id));

const replay=Intrigue.analyze(seed,input("1201-05-07 09:00:00",[
  lead("LocalRumors","RUM:R01","PLACE:WATCHTOWER","road-danger"),
  lead("CharacterMemory","MEM:R02","PLACE:WATCHTOWER","road-danger",{epistemicClass:"observed-fact",sourceType:"direct-observation",reliability:"verified",confidence:.94}),
  lead("WorldState","WORLD:ROAD","PLACE:WATCHTOWER","road-danger",{confidence:1,relevance:.95})
]));
assert(replay.ok&&replay.duplicate);
assert.equal(replay.result.id,corroborated.result.id);
assert.deepStrictEqual(replay.result.leadRankings,corroborated.result.leadRankings);

const hearsay=Intrigue.analyze("WP-S011-007-HEARSAY",input("1201-05-07 09:01:00",[
  lead("LocalRumors","RUM:ONLY","PLACE:WATCHTOWER","cellar-open",{confidence:.34,relevance:.5})
]));
assert(hearsay.ok);
assert.equal(hearsay.result.status,"uncertain");
assert(hearsay.result.unresolvedQuestions.includes("hearsay-only"));
assert(hearsay.result.unresolvedQuestions.some(x=>x.includes("single-source")));
assert.equal(hearsay.result.hypotheses[0].status,"single-source");
assert.equal(hearsay.result.confidenceIsTruth,false);

const conflict=Intrigue.analyze("WP-S011-007-CONFLICT",input("1201-05-07 09:02:00",[
  lead("LocalRumors","RUM:SUPPORT","PLACE:WATCHTOWER","cellar-open",{confidence:.62,reliability:"credible"}),
  lead("CharacterMemory","MEM:CONTRADICT","PLACE:WATCHTOWER","cellar-open",{stance:"contradict",confidence:.84,reliability:"verified",epistemicClass:"observed-fact",sourceType:"direct-observation"}),
  lead("AdvisorInsight","INS:CONTEXT","PLACE:WATCHTOWER","cellar-open",{stance:"context",confidence:.7,reliability:"credible"})
]));
assert(conflict.ok);
assert.equal(conflict.result.status,"conflicted");
assert.equal(conflict.result.conflictCount,1);
assert.equal(conflict.result.hypotheses[0].status,"conflicted");
assert(conflict.result.unresolvedQuestions.includes("claim:cellar-open:conflict-unresolved"));
assert.equal(conflict.result.hiddenTruthRevealed,false);

const stale=Intrigue.analyze("WP-S011-007-STALE",input("1201-06-20 09:03:00",[
  lead("CharacterMemory","MEM:OLD","PLACE:WATCHTOWER","old-route",{fantasyTimestamp:"1201-05-01 08:00:00"})
]));
assert(stale.ok);
assert.equal(stale.result.staleCount,1);
assert(stale.result.unresolvedQuestions.includes("stale-source-present"));
assert.equal(stale.result.leadRankings[0].freshness.stale,true);

const mismatch=Intrigue.analyze("WP-S011-007-MISMATCH",input("1201-05-07 09:04:00",[
  lead("LocalRumors","RUM:BAD","OTHER:PLACE","road-danger")
]));
assert.equal(mismatch.ok,false);
assert(/subject mismatch/i.test(mismatch.reason));

const hidden=Intrigue.analyze("WP-S011-007-HIDDEN",input("1201-05-07 09:04:00",[
  {...lead("LocalRumors","RUM:HIDDEN","PLACE:WATCHTOWER","secret-door"),hiddenTruth:true}
]));
assert.equal(hidden.ok,false);
assert(/hidden-authority/i.test(hidden.reason));

const invalidEpistemic=Intrigue.analyze("WP-S011-007-EPISTEMIC",input("1201-05-07 09:04:00",[
  lead("LocalRumors","RUM:FACT","PLACE:WATCHTOWER","secret-door",{epistemicClass:"observed-fact"})
]));
assert.equal(invalidEpistemic.ok,false);
assert(/attributed claims/i.test(invalidEpistemic.reason));

const tooMany=Intrigue.analyze("WP-S011-007-BOUNDS",input("1201-05-07 09:04:00",
  Array.from({length:Intrigue.MAX_LEADS+1},(_,i)=>lead("LocalRumors","RUM:"+i,"PLACE:WATCHTOWER","claim-"+i))
));
assert.equal(tooMany.ok,false);
assert.equal(tooMany.reason,"lead-limit-exceeded");

intrigueLevel=1;
const low=Intrigue.analyze("WP-S011-007-SKILL-LOW",input("1201-05-07 09:05:00",[
  lead("LocalRumors","RUM:L1","PLACE:WATCHTOWER","road-danger",{confidence:.58}),
  lead("CharacterMemory","MEM:L2","PLACE:WATCHTOWER","road-danger",{confidence:.81}),
  lead("AdvisorInsight","INS:L3","PLACE:WATCHTOWER","route-motive",{confidence:.67})
]));
intrigueLevel=20;
const high=Intrigue.analyze("WP-S011-007-SKILL-HIGH",input("1201-05-07 09:05:00",[
  lead("LocalRumors","RUM:L1","PLACE:WATCHTOWER","road-danger",{confidence:.58}),
  lead("CharacterMemory","MEM:L2","PLACE:WATCHTOWER","road-danger",{confidence:.81}),
  lead("AdvisorInsight","INS:L3","PLACE:WATCHTOWER","route-motive",{confidence:.67})
]));
assert(low.ok&&high.ok);
assert(high.result.skill.detailLimit>low.result.skill.detailLimit);
assert(high.result.skill.scoreDecimals>low.result.skill.scoreDecimals);
assert.equal(high.result.sourceConfidenceChangedBySkill,false);
assert.deepStrictEqual(high.result.leadRankings.map(x=>x.refId),low.result.leadRankings.map(x=>x.refId));
assert.deepStrictEqual(high.result.leadRankings.map(x=>x.sourceConfidence),low.result.leadRankings.map(x=>x.sourceConfidence));

const before=Intrigue.snapshot(seed);
const saved=JSON.stringify(clone(stores.get(seed)));
stores.set(seed,{entries:{},sequence:0});
assert.equal(Intrigue.snapshot(seed).analysisCount,0);
stores.set(seed,JSON.parse(saved));
const after=Intrigue.snapshot(seed);
assert.deepStrictEqual(after,before);
assert(after.serializedBytes<=Intrigue.MAX_LEDGER_BYTES);
assert.equal(Intrigue.listAnalyses(seed,{subjectId:"PLACE:WATCHTOWER",limit:99}).length,1);

const src=fs.readFileSync(modulePath,"utf8");
for(const forbidden of ["Math.random","Date.now","new Date(","innerWidth","innerHeight","devicePixelRatio","navigator."])assert(!src.includes(forbidden),"forbidden non-authoritative input: "+forbidden);
for(const forbidden of ["CharacterMemory.record","CharacterMemory.clear","LocalRumors.revealLead","LocalRumors.clear","SocialState.","CountryRelations.","ActionExecutor.","RoutePlanner.","setPosition(","teleport("])assert(!src.includes(forbidden),"Intrigue tool must not mutate/execute: "+forbidden);
for(const required of ["fullWorldScan:false","wholeMemoryScan:false","wholeHistoryScan:false","perFrameScan:false","directWorldMutation:false","knowledgeMutation:false","relationshipMutation:false","investigationMutation:false","hiddenTruthReveal:false","worldTruthAuthority:false","knowledgeAuthority:false","protagonistDecisionAuthority:false","simulationValidationBypass:false"])assert(src.includes(required),"missing authority/bounds marker: "+required);

const repoRoot=path.resolve(__dirname,"../.."),indexPath=path.join(repoRoot,"index.html");
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,"utf8"),script="scripts/world/advisor-intrigue.js?v=advisor-intrigue-v1";
  assert(html.includes(script),"canonical root must load AdvisorIntrigue");
  assert(html.indexOf(script)>html.indexOf("scripts/world/advisor-command.js?v=advisor-command-v1"));
  assert(html.indexOf(script)<html.indexOf("scripts/world/advisor-channel.js?v=advisor-chat-v1"));
}

const final=Intrigue.snapshot(seed);
assert.equal(final.persistenceAuthority,"WorldState CampaignStateDelta");
assert.equal(final.chronologyAuthority,"Fantasy Game Time");
assert.equal(final.maxLeads,12);
assert.equal(final.maxAnalyses,24);
assert.equal(final.maxLedgerBytes,48*1024);
assert.equal(final.fullWorldScan,false);
assert.equal(final.wholeMemoryScan,false);
assert.equal(final.directWorldMutation,false);
assert.equal(final.knowledgeMutation,false);
assert.equal(final.relationshipMutation,false);
assert.equal(final.hiddenTruthReveal,false);

console.log(JSON.stringify({
  wp:"WP-S011-007",classification:"FUNCTIONAL",visual:"N/A — bounded Intrigue lead/source-confidence analysis adds no rendered surface",pass:true,
  corroborated:true,hearsayPreserved:true,conflictPreserved:true,stalePreserved:true,unknownSubjectFailsClosed:true,
  epistemicSeparation:true,hiddenTruthRejected:true,deterministicReplay:true,duplicateIdempotence:true,
  skillDetailBounded:true,skillDoesNotChangeSourceConfidence:true,saveReload:true,
  maxLeads:Intrigue.MAX_LEADS,maxAnalyses:Intrigue.MAX_ANALYSES,maxLedgerBytes:Intrigue.MAX_LEDGER_BYTES,
  fullWorldScan:false,wholeMemoryScan:false,directWorldMutation:false,knowledgeMutation:false,relationshipMutation:false
},null,2));
