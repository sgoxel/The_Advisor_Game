"use strict";
const assert=require("assert");
const path=require("path");
const modulePath=path.resolve(__dirname,"../world/sentence-library.js");
const SentenceLibrary=require(modulePath);

function stable(input,options){return SentenceLibrary.serializeMatchResult(SentenceLibrary.match(input,options));}
function selected(input){return SentenceLibrary.match(input).selectedIntentId;}

assert.strictEqual(SentenceLibrary.LIBRARY_VERSION,"advisor-sentence-library-v1");
assert.strictEqual(SentenceLibrary.NORMALIZER_VERSION,"advisor-input-normalizer-v1");
assert.strictEqual(SentenceLibrary.normalizeInput("  HELLO,   THERE!!  "),"hello there");
assert.strictEqual(SentenceLibrary.normalizeInput("Don’t   forget   the map."),"don't forget the map");

const matrix=[
  ["hello","advisor.greeting"],
  ["Greetings!","advisor.greeting"],
  ["How are you?","advisor.status.question"],
  ["how do you feel","advisor.status.question"],
  ["What is your schedule?","advisor.schedule.question"],
  ["when do you work","advisor.schedule.question"],
  ["What are you carrying?","advisor.inventory.question"],
  ["go to the market","advisor.travel.suggest"],
  ["Please head to the market.","advisor.travel.suggest"],
  ["Speak with the innkeeper","advisor.interaction.request"],
  ["Ask the innkeeper about work","advisor.interaction.request"],
  ["Tell me about the old bridge","advisor.info.request"],
  ["Where is the mill?","advisor.info.location"],
  ["Please be careful near the ford","advisor.warning"],
  ["Don't forget the smith's request","advisor.reminder"]
];

for(const [input,intent] of matrix){
  assert.strictEqual(selected(input),intent,`Expected ${intent} for ${input}`);
}

const exactTravel=SentenceLibrary.match("go to the market");
assert.strictEqual(exactTravel.candidates[0].ruleId,"travel-market-exact");
assert.strictEqual(exactTravel.candidates[0].matchType,"exact");
assert.deepStrictEqual(exactTravel.candidates[0].variables,{place:"market"});

const travelPattern=SentenceLibrary.match("head to the north gate");
assert.deepStrictEqual(travelPattern.candidates[0].variables,{place:"the north gate"});
const interactionPattern=SentenceLibrary.match("ask Mira about the harvest");
assert.deepStrictEqual(interactionPattern.candidates[0].variables,{person:"mira",topic:"the harvest"});

for(const input of ["find Rowan","check on the steward"]){
  const result=SentenceLibrary.match(input);
  assert.strictEqual(result.ambiguity.isAmbiguous,true,`Expected ambiguity for ${input}`);
  assert.strictEqual(result.selectedIntentId,null);
  assert.ok(result.ambiguity.candidateIntentIds.length>=2);
}

const replayInput="Please head to the market.";
const baseline=stable(replayInput);
for(let i=0;i<100;i+=1)assert.strictEqual(stable(replayInput),baseline);

const deviceContexts=[
  {device:"phone",viewport:{width:390,height:844},camera:{zoom:10}},
  {device:"tablet",viewport:{width:1024,height:768},camera:{zoom:2}},
  {device:"desktop",viewport:{width:1920,height:1080},camera:{zoom:0.5}}
];
for(const context of deviceContexts){
  assert.strictEqual(SentenceLibrary.serializeMatchResult(SentenceLibrary.match(replayInput,context)),baseline);
}

delete require.cache[require.resolve(modulePath)];
const Reloaded=require(modulePath);
assert.strictEqual(Reloaded.serializeMatchResult(Reloaded.match(replayInput)),baseline);

let simulationTouched=false;
Object.defineProperty(globalThis,"Simulation",{
  configurable:true,
  get(){simulationTouched=true;throw new Error("Sentence library touched Simulation");}
});
assert.strictEqual(SentenceLibrary.match("hello").selectedIntentId,"advisor.greeting");
delete globalThis.Simulation;
assert.strictEqual(simulationTouched,false);

const bounded=SentenceLibrary.match("hello");
assert.strictEqual(bounded.metrics.libraryEntries,SentenceLibrary.getLibrarySnapshot().length);
assert.strictEqual(bounded.metrics.rulesEvaluated,bounded.metrics.libraryEntries);
assert.strictEqual(bounded.metrics.fullWorldScan,false);
assert.strictEqual(bounded.metrics.externalLlmUsed,false);
assert.strictEqual(bounded.metrics.simulationMutation,false);
assert.ok(bounded.metrics.libraryEntries<=32);
assert.ok(bounded.candidates.length<=SentenceLibrary.MAX_CANDIDATES);

const oversized="x".repeat(SentenceLibrary.MAX_INPUT_LENGTH+1);
const rejected=SentenceLibrary.match(oversized);
assert.strictEqual(rejected.rejected,"input-too-long");
assert.strictEqual(rejected.metrics.rulesEvaluated,0);
assert.strictEqual(rejected.candidates.length,0);

const evidence={
  wp:"WP-S008-001",
  classification:"FUNCTIONAL",
  libraryVersion:SentenceLibrary.LIBRARY_VERSION,
  normalizerVersion:SentenceLibrary.NORMALIZER_VERSION,
  representativeCases:matrix.length,
  ambiguousCases:["find Rowan","check on the steward"].map(input=>SentenceLibrary.inspect(input)),
  replaySignature:baseline,
  libraryEntries:bounded.metrics.libraryEntries,
  maxCandidates:SentenceLibrary.MAX_CANDIDATES,
  boundedMetrics:bounded.metrics,
  oversizedRejected:rejected.rejected,
  sameAcrossReload:true,
  sameAcrossPresentationContexts:true,
  simulationTouched:false,
  pass:true
};
console.log(JSON.stringify(evidence,null,2));
