"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");

class MemoryStorage{
  constructor(){this.map=new Map()}
  getItem(key){return this.map.has(String(key))?this.map.get(String(key)):null}
  setItem(key,value){this.map.set(String(key),String(value))}
  removeItem(key){this.map.delete(String(key))}
}
global.window=globalThis;
global.localStorage=new MemoryStorage();
global.GameTime={
  getTimestampKey:()=>"1200-01-01 08:00:00",
  getNow:()=>({year:1200,month:1,day:1,hour:8,minute:0,second:0})
};
global.SeedSystem={
  getCampaign:()=>({seed:"WP_S005_006_TEST",fantasyStart:{year:1200,month:1,day:1,hour:8,minute:0,second:0}}),
  getSettings:()=>({seed:"WP_S005_006_TEST"})
};
function load(path){vm.runInThisContext(fs.readFileSync(path,"utf8"),{filename:path})}
function resetMemoryGlobals(){delete global.CharacterMemory;delete global.MemoryLedger;delete global.WorldFactMemory}

load("scripts/world/character-memory.js");
const seed="WP_S005_006_TEST";
let cm=global.CharacterMemory;
assert(cm,"CharacterMemory API missing");

const builtIn=cm.recognitionProof(seed);
assert.strictEqual(builtIn.pass,true,"built-in recognition proof failed");
assert.strictEqual(builtIn.restored.meaningfulEncounterCount,83);
assert(builtIn.restored.storedEntryCount<=cm.MAX_ENTRIES_PER_ACTOR);
assert(builtIn.restored.storedInteractionEntryCount<=cm.MAX_INTERACTION_ENTRIES);
assert.strictEqual(builtIn.reference.id,"proof-help");

cm.clear(seed);
cm.recordInteraction(seed,"R03",{
  interactionId:"encounter-1",type:"conversation",topic:"the mill",
  summary:"Mara discussed the mill with the protagonist.",
  timestamp:"1200-03-01 09:00:00",location:"Village square"
});
cm.recordInteraction(seed,"R03",{
  interactionId:"encounter-help",type:"help",topic:"the mill gate",
  summary:"The protagonist helped Mara repair the mill gate.",
  timestamp:"1200-03-02 10:00:00",location:"Mill",relevance:1
});
cm.recordInteraction(seed,"R03",{
  interactionId:"encounter-2",type:"conversation",topic:"the mill",
  summary:"Mara and the protagonist discussed the mill again.",
  timestamp:"1200-03-03 11:00:00",location:"Market"
});
const beforeReload=cm.recognition(seed,"R03");
assert.strictEqual(beforeReload.metBefore,true);
assert.strictEqual(beforeReload.meaningfulEncounterCount,3);
assert.strictEqual(beforeReload.familiarity,"familiar");
assert.strictEqual(cm.recognitionReference(seed,"R03","mill gate").id,"encounter-help");

resetMemoryGlobals();
load("scripts/world/character-memory.js");
cm=global.CharacterMemory;
const afterReload=cm.recognition(seed,"R03");
assert.strictEqual(afterReload.meaningfulEncounterCount,3,"recognition did not persist through module reload");
assert.strictEqual(afterReload.lastTopic,"the mill");
assert.strictEqual(cm.recognitionReference(seed,"R03","mill gate").id,"encounter-help");

for(let i=0;i<100;i++)cm.recordInteraction(seed,"R03",{
  interactionId:"routine-"+i,type:"conversation",topic:"routine greeting "+i,summary:"Routine greeting "+i,
  timestamp:"1201-01-"+String(1+(i%28)).padStart(2,"0")+" "+String(i%24).padStart(2,"0")+":00:00",
  location:"Village path",relevance:.15
});
const compacted=cm.recognition(seed,"R03");
assert.strictEqual(compacted.meaningfulEncounterCount,103,"aggregate encounter count was lost during compaction");
assert(compacted.storedEntryCount<=cm.MAX_ENTRIES_PER_ACTOR,"resident ledger exceeded total cap");
assert(compacted.storedInteractionEntryCount<=cm.MAX_INTERACTION_ENTRIES,"interaction ledger exceeded cap");
assert.strictEqual(cm.recognitionReference(seed,"R03","mill gate").id,"encounter-help","salient help was lost during compaction");

const residents=[
  {id:"R03",name:"Mara",homeLabel:"Mara's home",homePlanId:"H03",workplaceLabel:"Mill",workplaceId:"S03"},
  {id:"R04",name:"Tomas",homeLabel:"Tomas's home",homePlanId:"H04",workplaceLabel:"Smithy",workplaceId:"S04"}
];
global.ResidentRoster={build:()=>residents};
const activity={
  state:"social",location:"public",buildingId:null,label:"Talking in the square",intendedAction:"social",
  timestamp:"1201-02-01 12:00:00",target:{x:"0",y:"0"}
};
global.DailyActivity={roster:()=>residents,build:()=>residents,resolve:()=>activity,resolveActionTarget:()=>activity};
global.SpecialLots={build:()=>[]};
global.SocialState={dialogueContext:()=>({
  values:{trust:.72,fear:.08,respect:.68,suspicion:.2,loyalty:.52,resentment:.08},
  source:"social-state-test",reputationAverage:0,activeDutyPriority:0
})};

cm.recordMemory(seed,{kind:"resident",id:"R03"},{
  kind:"fact",category:"outcomes",summary:"The mill gate is repaired and usable.",
  timestamp:"1201-01-30 10:00:00",source:{type:"direct-observation",id:"mill-gate-check"},
  confidence:.95,relevance:.9,fact:{subject:"mill gate",predicate:"condition",value:"repaired"}
});
load("scripts/world/dialogue-context.js");
assert(global.DialogueContext,"DialogueContext API missing");

const beforeDialogue=JSON.stringify(cm.snapshot(seed));
const repeat=global.DialogueContext.resolve(seed,{speakerId:"R03",topic:"the mill gate",when:{year:1201,month:2,day:1,hour:12,minute:0,second:0}});
const afterDialogue=JSON.stringify(cm.snapshot(seed));
assert.strictEqual(beforeDialogue,afterDialogue,"dialogue resolution mutated memory");
assert.strictEqual(repeat.recognition.metBefore,true);
assert.strictEqual(repeat.recognition.familiarity,"known");
assert.strictEqual(repeat.recognition.referenceId,"encounter-help");
assert.strictEqual(repeat.recognition.bounded,true);
assert.strictEqual(repeat.recognition.globalScan,false);
assert(/again|spoken many times|earlier interaction|discussed before/i.test(repeat.response),"repeat greeting/reference framing missing");
assert(/helped Mara repair the mill gate/i.test(repeat.response),"prior meaningful event was not referenced");

const first=global.DialogueContext.resolve(seed,{speakerId:"R04",topic:"the smithy",when:{year:1201,month:2,day:1,hour:12,minute:0,second:0}});
assert.strictEqual(first.recognition.metBefore,false,"first meeting incorrectly recognized");
assert.strictEqual(first.recognition.familiarity,"stranger");
assert.strictEqual(first.memoryMutation,false);

const verification=cm.verify(seed);
assert.strictEqual(verification.pass,true,"CharacterMemory verification failed");
assert.strictEqual(verification.bounded,true,"CharacterMemory bounded verification missing");

console.log(JSON.stringify({
  pass:true,
  firstMeeting:first.recognition,
  repeatMeeting:repeat.recognition,
  bounded:{
    maxEntriesPerActor:cm.MAX_ENTRIES_PER_ACTOR,
    maxInteractionEntries:cm.MAX_INTERACTION_ENTRIES,
    storedEntries:compacted.storedEntryCount,
    storedInteractions:compacted.storedInteractionEntryCount,
    meaningfulEncounterCount:compacted.meaningfulEncounterCount
  },
  reloadPersistence:true,
  dialogueReadOnly:true,
  salientReference:cm.recognitionReference(seed,"R03","mill gate")
},null,2));
