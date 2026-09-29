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
let now="1200-06-12 12:00:00";
global.GameTime={
  getTimestampKey:()=>now,
  getNow:()=>{
    const m=/^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/.exec(now);
    return {year:+m[1],month:+m[2],day:+m[3],hour:+m[4],minute:+m[5],second:+m[6]};
  }
};
const seed="WP_S005_007_TEST";
global.SeedSystem={
  getCampaign:()=>({seed,fantasyStart:{year:1200,month:6,day:1,hour:8,minute:0,second:0}}),
  getSettings:()=>({seed})
};
function load(path){vm.runInThisContext(fs.readFileSync(path,"utf8"),{filename:path})}

load("scripts/world/character-memory.js");
load("scripts/world/local-rumors.js");
const cm=global.CharacterMemory,rumors=global.LocalRumors;
assert(cm&&rumors,"required APIs missing");

const destinations=[
  {
    id:"planet-place-ruin-3",name:"Ashen Watchtower",type:"ruin",category:"historical",
    description:"Old hill ruin / historical site",importance:2,
    latitudeRadians:.12,longitudeRadians:.34,latitudeDegrees:6.875,longitudeDegrees:19.481,elevationMeters:842
  },
  {
    id:"planet-place-fishing-5",name:"Silver Shoals",type:"fishing",category:"fishing",
    description:"Coastal fishing waters",importance:1,
    latitudeRadians:.08,longitudeRadians:.28,latitudeDegrees:4.584,longitudeDegrees:16.043,elevationMeters:0
  }
];
let refreshCount=0;
global.PlanetStage={
  placeDescriptors:()=>destinations,
  refreshPlaces:()=>{refreshCount++;return {ok:true}}
};

cm.clear(seed);
cm.recordFact(seed,{kind:"resident",id:"R01"},{
  category:"places",summary:"The Ashen Watchtower still stands beyond the north ridge.",
  timestamp:"1200-06-12 10:00:00",source:{type:"direct-observation",id:"r01-watchtower"},
  confidence:.96,relevance:.9,reliability:"verified",
  fact:{subject:"Ashen Watchtower",predicate:"condition",value:"standing"},
  scene:{location:"north ridge",subjectId:"planet-place-ruin-3"},
  externalRef:{type:"destination",id:"planet-place-ruin-3"}
});
cm.recordFact(seed,{kind:"resident",id:"R02"},{
  category:"rumors",summary:"Travelers say the Ashen Watchtower road has become dangerous after dusk.",
  timestamp:"1200-06-10 09:00:00",source:{type:"rumor",id:"market-travelers"},
  confidence:.46,relevance:.82,reliability:"uncertain",
  fact:{subject:"Ashen Watchtower",predicate:"road-danger",value:"after dusk"},
  scene:{location:"market",subjectId:"planet-place-ruin-3"},
  externalRef:{type:"destination",id:"planet-place-ruin-3"}
});
cm.recordFact(seed,{kind:"resident",id:"R03"},{
  category:"rumors",summary:"Someone once claimed the Ashen Watchtower cellar was still accessible.",
  timestamp:"1200-05-15 08:00:00",source:{type:"rumor",id:"old-tavern-story"},
  confidence:.34,relevance:.55,reliability:"uncertain",
  fact:{subject:"Ashen Watchtower",predicate:"cellar",value:"accessible"},
  scene:{location:"old tavern",subjectId:"planet-place-ruin-3"},
  externalRef:{type:"destination",id:"planet-place-ruin-3"}
});

const memoryBefore=JSON.stringify(cm.snapshot(seed));
const r1=rumors.bestForTopic(seed,"R01",{topic:"Ashen Watchtower ruin",destinations,now});
const r2=rumors.bestForTopic(seed,"R02",{topic:"Ashen Watchtower danger",destinations,now});
const r3=rumors.bestForTopic(seed,"R03",{topic:"Ashen Watchtower cellar",destinations,now});
const r4=rumors.query(seed,"R04",{topic:"Ashen Watchtower",destinations,now});
assert(r1&&r2&&r3,"expected resident-bounded knowledge missing");
assert.strictEqual(r1.status,"confirmed");
assert.strictEqual(r1.freshness.id,"fresh");
assert.strictEqual(r2.status,"hearsay");
assert.strictEqual(r2.freshness.id,"recent");
assert.strictEqual(r3.status,"hearsay");
assert.strictEqual(r3.freshness.stale,true);
assert(/out of date/i.test(r3.text),"stale knowledge was not contextualized");
assert.strictEqual(r4.length,0,"resident shared knowledge they did not possess");
assert.strictEqual(r1.destinationLead.id,"planet-place-ruin-3");
assert.strictEqual(r2.destinationLead.id,"planet-place-ruin-3");
assert.strictEqual(JSON.stringify(cm.snapshot(seed)),memoryBefore,"rumor query mutated CharacterMemory");

const event={
  id:"event-caravan-1",summary:"A salt caravan is expected at the east gate before sunset.",
  source:{type:"simulation",label:"Local event index"},reliability:"verified",confidence:1,relevance:.9,
  timestamp:"1200-06-12 11:30:00",location:"east gate",subject:"salt caravan",
  knownBy:["R02"],destination:destinations[1]
};
const eventR2=rumors.bestForTopic(seed,"R02",{topic:"salt caravan",destinations,localEvents:[event],now});
const eventR1=rumors.query(seed,"R01",{topic:"salt caravan",destinations,localEvents:[event],now});
assert(eventR2,"known local event was not returned");
assert.strictEqual(eventR2.status,"confirmed");
assert.strictEqual(eventR2.source.kind,"local-event");
assert.strictEqual(eventR2.createsWorldTruth,false);
assert.strictEqual(eventR1.length,0,"knownBy boundary leaked local event to another resident");

const firstDet=rumors.query(seed,"R02",{topic:"Ashen Watchtower danger",destinations,now});
const secondDet=rumors.query(seed,"R02",{topic:"Ashen Watchtower danger",destinations,now});
assert.strictEqual(JSON.stringify(firstDet),JSON.stringify(secondDet),"rumor templates/order are not deterministic");

const lead=rumors.revealLead(seed,"R02",r2);
assert(lead,"discoverable lead was not persisted");
assert.strictEqual(refreshCount,1,"navigator was not refreshed after lead reveal");
let navLeads=rumors.navigatorLeads(seed);
assert.strictEqual(navLeads.length,1);
assert.strictEqual(navLeads[0].id,"planet-place-ruin-3");
assert.strictEqual(navLeads[0].knowledgeStatus,"hearsay");
assert(/Hearsay lead/.test(navLeads[0].description));
const duplicate=rumors.revealLead(seed,"R02",r2);
assert.strictEqual(duplicate.id,lead.id,"duplicate reveal changed stable lead identity");
assert.strictEqual(rumors.navigatorLeads(seed).length,1,"duplicate lead was stored twice");

delete global.LocalRumors;delete global.RumorKnowledge;
load("scripts/world/local-rumors.js");
assert.strictEqual(global.LocalRumors.navigatorLeads(seed).length,1,"revealed lead did not survive module reload");
global.LocalRumors.clear(seed);

const residents=[
  {id:"R01",name:"Ada",homeLabel:"Ada's home",homePlanId:"H01",workplaceLabel:"Mill",workplaceId:"S01"},
  {id:"R02",name:"Bram",homeLabel:"Bram's home",homePlanId:"H02",workplaceLabel:"Smithy",workplaceId:"S02"},
  {id:"R03",name:"Cora",homeLabel:"Cora's home",homePlanId:"H03",workplaceLabel:"Market",workplaceId:"S03"},
  {id:"R04",name:"Daro",homeLabel:"Daro's home",homePlanId:"H04",workplaceLabel:"Farm",workplaceId:"S04"}
];
const activity={
  state:"social",location:"public",buildingId:null,label:"Talking in the square",intendedAction:"social",
  timestamp:now,target:{x:"0",y:"0"}
};
global.DailyActivity={roster:()=>residents,build:()=>residents,resolve:()=>activity,resolveActionTarget:()=>activity};
global.SpecialLots={build:()=>[]};
global.SocialState={dialogueContext:()=>({
  values:{trust:.7,suspicion:.2,respect:.6,fear:.1,loyalty:.4,resentment:.1},
  source:"social-state-test",reputationAverage:0,activeDutyPriority:0
})};
load("scripts/world/dialogue-context.js");
assert(global.DialogueContext,"DialogueContext missing");

const beforeDialogue=JSON.stringify(cm.snapshot(seed));
const dialogue=global.DialogueContext.resolve(seed,{speakerId:"R02",topic:"Ashen Watchtower danger",when:global.GameTime.getNow()});
assert(dialogue.rumor,"dialogue did not surface bounded rumor");
assert.strictEqual(dialogue.rumor.status,"hearsay");
assert.strictEqual(dialogue.rumor.destinationLead.id,"planet-place-ruin-3");
assert(/heard|hearsay|People have been saying/i.test(dialogue.response),"dialogue did not contextualize hearsay");
const dialogueLead=global.DialogueContext.revealLead(seed,dialogue);
assert(dialogueLead,"completed dialogue could not reveal navigator lead");
assert.strictEqual(global.LocalRumors.navigatorLeads(seed).length,1);
assert.strictEqual(JSON.stringify(cm.snapshot(seed)),beforeDialogue,"dialogue/reveal mutated CharacterMemory truth");

for(let i=0;i<72;i++)cm.recordMemory(seed,{kind:"resident",id:"R05"},{
  kind:"fact",category:"rumors",summary:"Local note "+i+" about the old road.",
  timestamp:"1200-06-12 09:00:00",source:{type:"rumor",id:"bounded-"+i},
  confidence:.4,relevance:.2,fact:{subject:"old road",predicate:"note",value:i}
});
const bounded=global.LocalRumors.query(seed,"R05",{topic:"local news",destinations,now});
const telemetry=global.LocalRumors.snapshot(seed);
assert(bounded.length<=global.LocalRumors.MAX_RESULTS,"rumor result cap exceeded");
assert(telemetry.lastCandidateCount<=cm.MAX_ENTRIES_PER_ACTOR,"query exceeded bounded resident memory ledger");
assert.strictEqual(telemetry.localIndexedQueriesOnly,true);
assert.strictEqual(telemetry.globalScan,false);
assert.strictEqual(telemetry.worldMutation,false);
assert.strictEqual(telemetry.simulationAuthority,false);

console.log(JSON.stringify({
  pass:true,
  sameAreaDifferentKnowledge:{
    R01:{status:r1.status,freshness:r1.freshness.id,lead:r1.destinationLead.id},
    R02:{status:r2.status,freshness:r2.freshness.id,lead:r2.destinationLead.id},
    R03:{status:r3.status,freshness:r3.freshness.id,stale:r3.freshness.stale},
    R04:{resultCount:r4.length}
  },
  localEventKnowledgeBoundary:{R02:eventR2.id,R01ResultCount:eventR1.length},
  deterministicTemplates:true,
  characterMemoryReadOnly:true,
  discoverableLead:{id:dialogueLead.id,destinationId:dialogueLead.destination.id,persisted:true},
  bounded:{maxResults:global.LocalRumors.MAX_RESULTS,maxDestinations:global.LocalRumors.MAX_DESTINATIONS,maxLocalRecords:global.LocalRumors.MAX_LOCAL_RECORDS,maxLeads:global.LocalRumors.MAX_LEADS,lastCandidateCount:telemetry.lastCandidateCount},
  telemetry
},null,2));