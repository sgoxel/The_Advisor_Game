"use strict";
const assert=require("assert");
const Router=require("../world/local-conversation-router.js");

let simulationTouched=false;
Object.defineProperty(globalThis,"Simulation",{
  configurable:true,
  get(){simulationTouched=true;throw new Error("Router touched Simulation");}
});

const memoryRows=Object.freeze(Array.from({length:24},(_,index)=>Object.freeze({
  id:"MEM-"+String(index+1).padStart(2,"0"),
  summary:index===23?"The old mill is beside the east stream.":"Routine bounded memory "+index,
  fact:Object.freeze({subject:index===23?"old mill":"routine",predicate:"location",value:index===23?"east stream":index}),
  source:Object.freeze({type:"simulation"}),
  reliability:"verified",
  authority:"simulation-truth",
  uncertain:false
})));

const sourceCalls={match:0,memory:0,advice:0,social:0};
const sources=Object.freeze({
  matchSentence(){sourceCalls.match++;return null;},
  getMemory(){sourceCalls.memory++;return memoryRows;},
  getAdvice(){sourceCalls.advice++;return Object.freeze([]);},
  getSocialContext(){sourceCalls.social++;return null;}
});

const baseContext=Object.freeze({
  seed:"AGENT6-LOCAL-ROUTER",
  when:"1126-09-30 10:56:00",
  character:Object.freeze({id:"protagonist",name:"Edrin"}),
  externalAiEnabled:true
});

const greeting=Router.route("Hello!",baseContext,sources);
assert.strictEqual(greeting.mode,"local-library");
assert.strictEqual(greeting.selectedIntentId,"advisor.greeting");
assert.strictEqual(greeting.externalLlmEligible,false);
assert.strictEqual(greeting.character.id,"protagonist");
assert.strictEqual(greeting.character.name,"Edrin");
assert.strictEqual(greeting.worldMutation,false);
assert.strictEqual(greeting.actionExecuted,false);
assert.strictEqual(greeting.memoryMutation,false);

const travel=Router.route("Please head to the market.",baseContext,sources);
assert.strictEqual(travel.mode,"local-library");
assert.strictEqual(travel.selectedIntentId,"advisor.travel.suggest");
assert.ok(travel.reply.includes("market"));
assert.ok(travel.reply.includes("not taken that action"));

const interaction=Router.route("Speak with Rowan",baseContext,sources);
assert.strictEqual(interaction.mode,"local-library");
assert.strictEqual(interaction.selectedIntentId,"advisor.interaction.request");
assert.ok(interaction.reply.includes("No interaction has happened yet"));

const warning=Router.route("Be careful near the ford",baseContext,sources);
assert.strictEqual(warning.mode,"local-library");
assert.strictEqual(warning.selectedIntentId,"advisor.warning");
assert.ok(warning.reply.includes("advice"));

const ambiguous=Router.route("find Rowan",baseContext,sources);
assert.strictEqual(ambiguous.mode,"clarification-needed");
assert.strictEqual(ambiguous.selectedIntentId,null);
assert.strictEqual(ambiguous.externalLlmEligible,false);
assert.ok(ambiguous.intentCandidates.some(x=>x.intentId==="advisor.travel.suggest"));
assert.ok(ambiguous.intentCandidates.some(x=>x.intentId==="advisor.interaction.request"));

const grounded=Router.route("Tell me about the old mill",{
  ...baseContext,
  facts:Object.freeze([
    Object.freeze({
      id:"FACT-MILL",
      subject:"old mill",
      summary:"The old mill is beside the east stream and its wheel is intact.",
      sourceType:"simulation",
      reliability:"verified",
      authority:"simulation-truth",
      grounded:true
    })
  ])
},sources);
assert.strictEqual(grounded.mode,"local-context-response");
assert.strictEqual(grounded.selectedIntentId,"advisor.info.request");
assert.ok(grounded.reply.includes("old mill"));
assert.ok(grounded.reply.includes("east stream"));

const memoryGrounded=Router.route("Where is the old mill?",baseContext,sources);
assert.strictEqual(memoryGrounded.mode,"local-context-response");
assert.strictEqual(memoryGrounded.selectedIntentId,"advisor.info.location");
assert.ok(memoryGrounded.reply.includes("east stream"));
assert.ok(memoryGrounded.metrics.memoryRowsRead<=Router.MAX_MEMORY_ROWS);

const status=Router.route("How are you?",{
  ...baseContext,
  statusSummary:Object.freeze({text:"I am rested and uninjured according to the current Simulation status.",source:"simulation-status",grounded:true})
},sources);
assert.strictEqual(status.mode,"local-context-response");
assert.strictEqual(status.selectedIntentId,"advisor.status.question");
assert.ok(status.reply.includes("rested and uninjured"));

const schedule=Router.route("What is your schedule?",{
  ...baseContext,
  scheduleSummary:Object.freeze({text:"I am scheduled to work at the smithy until noon.",source:"daily-activity",grounded:true})
},sources);
assert.strictEqual(schedule.mode,"local-context-response");
assert.strictEqual(schedule.selectedIntentId,"advisor.schedule.question");

const inventoryMissing=Router.route("What are you carrying?",baseContext,sources);
assert.strictEqual(inventoryMissing.mode,"llm-eligible");
assert.strictEqual(inventoryMissing.reason,"inventory-unavailable");
assert.strictEqual(inventoryMissing.externalLlmEligible,true);
assert.ok(inventoryMissing.offlineFallback.includes("reliable inventory record"));
assert.strictEqual(inventoryMissing.reply,inventoryMissing.offlineFallback);

const unknown=Router.route("Describe the omen hidden in the seventh cloud above the eastern moon",baseContext,sources);
assert.strictEqual(unknown.mode,"llm-eligible");
assert.strictEqual(unknown.externalLlmEligible,true);
assert.strictEqual(unknown.selectedIntentId,null);
assert.ok(unknown.offlineFallback.includes("won't invent an answer"));

const unknownOffline=Router.route("Describe the omen hidden in the seventh cloud above the eastern moon",{
  ...baseContext,
  externalAiEnabled:false
},sources);
assert.strictEqual(unknownOffline.mode,"deterministic-offline-fallback");
assert.strictEqual(unknownOffline.externalLlmEligible,false);
assert.strictEqual(unknownOffline.reply,unknown.offlineFallback);

const absentFact=Router.route("Tell me about the secret royal tunnel",baseContext,sources);
assert.strictEqual(absentFact.mode,"llm-eligible");
assert.strictEqual(absentFact.reason,"grounded-fact-unavailable");
assert.ok(absentFact.reply.includes("don't have reliable information"));
assert.ok(!absentFact.reply.toLowerCase().includes("there is a secret royal tunnel"));

const supplied=Router.route("anything",{
  ...baseContext,
  normalizedInput:"anything",
  intentCandidates:Object.freeze([
    Object.freeze({intentId:"advisor.reminder",ruleId:"direct-test",matchType:"supplied",priority:90,confidence:.95,variables:Object.freeze({topic:"the bridge promise"})})
  ]),
  selectedIntentId:"advisor.reminder"
},sources);
assert.strictEqual(supplied.mode,"local-library");
assert.strictEqual(supplied.selectedIntentId,"advisor.reminder");
assert.strictEqual(supplied.sourceMetadata.recognizer,"supplied-candidates");
assert.ok(supplied.reply.includes("bridge promise"));

const replayInput="Please head to the market.";
const baseline=Router.serializeResult(Router.route(replayInput,baseContext,sources));
for(let i=0;i<100;i++){
  assert.strictEqual(Router.serializeResult(Router.route(replayInput,baseContext,sources)),baseline);
}
const deviceVariant=Router.serializeResult(Router.route(replayInput,{
  ...baseContext,
  viewport:{width:390,height:844},
  device:"phone",
  camera:{x:999,y:-999,zoom:12},
  fps:14
},sources));
assert.strictEqual(deviceVariant,baseline);

for(const result of [greeting,travel,interaction,warning,ambiguous,grounded,memoryGrounded,status,schedule,inventoryMissing,unknown,unknownOffline,absentFact,supplied]){
  assert.strictEqual(result.character.id,"protagonist");
  assert.strictEqual(result.character.name,"Edrin");
  assert.strictEqual(result.worldMutation,false);
  assert.strictEqual(result.actionExecuted,false);
  assert.strictEqual(result.memoryMutation,false);
  assert.strictEqual(result.metrics.fullWorldScan,false);
  assert.strictEqual(result.metrics.wholeHistoryScan,false);
  assert.ok(result.metrics.memoryRowsRead<=Router.MAX_MEMORY_ROWS);
  assert.ok(result.metrics.adviceRowsRead<=Router.MAX_ADVICE_ROWS);
}

assert.strictEqual(simulationTouched,false);
delete globalThis.Simulation;

const evidence={
  wp:"WP-S008-003",
  classification:"FUNCTIONAL",
  visual:"N/A — local routing and fallback logic introduces no rendered surface",
  pass:true,
  routerVersion:Router.ROUTER_VERSION,
  modes:Router.getModes(),
  cases:{
    greeting:{mode:greeting.mode,intent:greeting.selectedIntentId},
    travel:{mode:travel.mode,intent:travel.selectedIntentId},
    grounded:{mode:grounded.mode,intent:grounded.selectedIntentId},
    ambiguity:{mode:ambiguous.mode,candidates:ambiguous.intentCandidates.map(x=>x.intentId)},
    unfamiliar:{mode:unknown.mode,externalLlmEligible:unknown.externalLlmEligible,offlineFallback:unknown.offlineFallback},
    offline:{mode:unknownOffline.mode,externalLlmEligible:unknownOffline.externalLlmEligible},
    absentFact:{mode:absentFact.mode,reason:absentFact.reason}
  },
  directCandidatesIndependent:true,
  deterministicReplay:true,
  presentationIndependent:true,
  persistentCharacterIdentity:true,
  worldMutation:false,
  actionExecuted:false,
  memoryMutation:false,
  simulationTouched,
  maxMemoryRows:Router.MAX_MEMORY_ROWS,
  maxAdviceRows:Router.MAX_ADVICE_ROWS,
  sourceCalls
};
console.log(JSON.stringify(evidence,null,2));
