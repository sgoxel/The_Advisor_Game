"use strict";
const assert=require("assert");
global.window=global;
global.performance=global.performance||require("perf_hooks").performance;

function hash(seed,key){
  let h=2166136261>>>0,s=String(seed)+"|"+String(key);
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return h>>>0;
}
global.PRNG={foundationUint32:hash};
global.WorldCoordinates={position:(x,y)=>Object.freeze({x:String(x),y:String(y),level:0})};
global.Walkability={classify:(_seed,x,y)=>Object.freeze({walkable:true,category:"grass",buildingId:null,x:String(x),y:String(y)})};
global.InteriorObjects={classifyNavigation:global.Walkability.classify};
global.StartingVillage={
  local:(_seed,x,y)=>Object.freeze({x:String(x),y:String(y)}),
  isRoadReserved:()=>false
};
const residents=[
  {id:"R01",name:"Alda",displayName:"Alda Ashford",profession:"farmer"},
  {id:"R02",name:"Bram",displayName:"Bram Briar",profession:"smith"},
  {id:"R03",name:"Celia",displayName:"Celia Cinder",profession:"shopkeeper"},
  {id:"R04",name:"Dren",displayName:"Dren Dale",profession:"guard"},
  {id:"R05",name:"Edda",displayName:"Edda Ember",profession:"woodcutter"},
  {id:"R06",name:"Fenn",displayName:"Fenn Farrow",profession:"tavern-keeper"}
];
global.DailyActivity={build:()=>residents,roster:()=>residents};
global.SocialState={relationship:()=>({values:{trust:.62,respect:.58,loyalty:.4,suspicion:.18,resentment:.06}})};

require("../../scripts/world/social-encounters.js");
const se=global.SocialEncounters;
assert(se,"SocialEncounters did not register");

const seed="WP-S004-006-TEST";
const proof=se.verify(seed);
assert.strictEqual(proof.pass,true,"verification failed");
assert.strictEqual(proof.deterministic,true,"proof is not deterministic");
assert.strictEqual(proof.busySkipped,true,"busy NPC was not skipped");
assert.strictEqual(proof.scheduleRecovered,true,"encounter did not release resident state");
assert.strictEqual(proof.noRoadBlocking,true,"proof sites may block reserved road");
assert.strictEqual(proof.gathering.participantIds.length,3,"gathering is not bounded three-person group");
assert.strictEqual(proof.fullPopulationPairwiseScan,false,"pairwise full-population scan was introduced");

const social={state:"social",action:"social",intendedAction:"social"};
const work={state:"work",action:"work",intendedAction:"work"};
se.reset(seed);
const runtime=se.advance({
  seed,when:{year:1201,month:2,day:1,hour:18,minute:0,second:0},seconds:1,
  residents:[
    {id:"R01",name:"Alda",profession:"farmer",position:{x:"0",y:"0"},activity:social},
    {id:"R02",name:"Bram",profession:"smith",position:{x:"1",y:"0"},activity:social},
    {id:"R03",name:"Celia",profession:"shopkeeper",position:{x:"0",y:"1"},activity:social},
    {id:"R04",name:"Dren",profession:"guard",position:{x:"2",y:"0"},activity:work}
  ]
});
assert(runtime.totalCandidateChecks<=se.MAX_CANDIDATE_CHECKS,"candidate cap exceeded");
assert.strictEqual(runtime.fullPopulationPairwiseScan,false);
assert.strictEqual(runtime.spatialBuckets,true);
assert(runtime.declinedBusy>0,"busy candidate was not observed/declined");
assert(runtime.activeEncounterCount>0,"no contextual encounter started");
assert(runtime.activeEncounterCount<=se.MAX_ACTIVE_ENCOUNTERS,"active encounter cap exceeded");

const activeId=runtime.encounters[0].participantIds[0];
const activeState=se.stateFor(activeId);
assert(activeState&&activeState.simulationAuthority===true,"resident encounter state unavailable");

const visual=se.beginProof(seed,"gathering");
assert(visual&&visual.verification.pass===true,"visual proof failed");
assert.strictEqual(visual.proof.proofActive,true,"visual proof did not remain frozen");
assert.strictEqual(visual.encounter.participantIds.length,3);
assert(se.stateFor(visual.encounter.participantIds[0]),"visual proof encounter was cleared");

console.log(JSON.stringify({
  pass:true,
  version:se.VERSION,
  verification:proof,
  runtime:{
    activeEncounterCount:runtime.activeEncounterCount,
    totalCandidateChecks:runtime.totalCandidateChecks,
    declinedBusy:runtime.declinedBusy,
    maxCandidateChecks:runtime.maxCandidateChecks,
    fullPopulationPairwiseScan:runtime.fullPopulationPairwiseScan
  }
},null,2));