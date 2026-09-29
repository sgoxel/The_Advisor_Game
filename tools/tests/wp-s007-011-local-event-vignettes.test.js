"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");

global.window=globalThis;
global.document=undefined;
global.setInterval=()=>1;
global.clearInterval=()=>{};
let perf=0;
global.performance={now:()=>{perf+=0.1;return perf;}};

function hash32(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
global.PRNG={liveAddressedUint32:(...parts)=>hash32(parts.join("|"))};
const residents=[
  {id:"R01",name:"Alda",displayName:"Alda Vale",profession:"shopkeeper",workplaceId:"MARKET",workplaceTarget:{x:"10",y:"12",level:0},homeTarget:{x:"2",y:"3",level:0}},
  {id:"R02",name:"Bren",displayName:"Bren Holt",profession:"guard",workplaceId:"MEETING_HALL",workplaceTarget:{x:"14",y:"8",level:0},homeTarget:{x:"4",y:"3",level:0}},
  {id:"R03",name:"Cora",displayName:"Cora Reed",profession:"farmer",workplaceId:"FARM",workplaceTarget:{x:"22",y:"17",level:0},homeTarget:{x:"6",y:"3",level:0}},
  {id:"R04",name:"Dain",displayName:"Dain Ash",profession:"woodcutter",workplaceId:"WOODLOT",workplaceTarget:{x:"25",y:"15",level:0},homeTarget:{x:"8",y:"3",level:0}},
  {id:"R05",name:"Edda",displayName:"Edda Moss",profession:"tavern-keeper",workplaceId:"TAVERN",workplaceTarget:{x:"12",y:"18",level:0},homeTarget:{x:"10",y:"3",level:0}},
  {id:"R06",name:"Fenn",displayName:"Fenn Pike",profession:"smith",workplaceId:"SMITHY",workplaceTarget:{x:"18",y:"11",level:0},homeTarget:{x:"12",y:"3",level:0}}
];
global.DailyActivity={build:()=>residents};
global.SeedSystem={getCampaign:()=>null};
global.GameTime={getTimestampKey:()=>null};
global.WorldSimulationBudget={
  limit:(_kind,n)=>n,
  beginSlice:()=>null,
  recordQueue:()=>{}
};

function load(path){vm.runInThisContext(fs.readFileSync(path,"utf8"),{filename:path})}
load("scripts/core/event-scheduler.js");
load("scripts/world/local-event-vignettes.js");

const seed="WP-S007-011-TEST";
const day="1201-02-01";
const plan=LocalEventVignettes.planDay(seed,day);
assert.strictEqual(plan.length,4,"expected four catalog events");
assert.deepStrictEqual(plan.map(e=>e.type),["market-day-setup","village-gathering","minor-argument","predator-warning"]);
assert.deepStrictEqual(plan,LocalEventVignettes.planDay(seed,day),"same seed/day plan changed");
assert.notDeepStrictEqual(plan,LocalEventVignettes.planDay(seed+"-ALT",day),"alternate seed did not change plan");
for(const event of plan){
  assert(event.participantCount>=2&&event.participantCount<=4,"participant count outside bounded contract");
  assert(event.participants.every(p=>p.id&&p.existingTarget),"event fabricated a participant/target");
  assert(event.location?.anchor&&event.location?.source,"event location is not grounded in an existing resident target");
  assert(event.endTimestamp>event.startTimestamp,"event duration invalid");
  assert.strictEqual(event.scheduleOverride,true);
}
const scheduled=LocalEventVignettes.ensureScheduled(seed,"1201-02-01 00:00:00");
assert.strictEqual(scheduled.eventCount,4);
assert.strictEqual(EventScheduler.snapshot(seed).pending,8,"expected bounded start/end scheduler records");

const proofRows=[];
for(const type of LocalEventVignettes.CATALOG.map(x=>x.id)){
  const s=seed+"-"+type;
  const result=LocalEventVignettes.proofActivate(s,type,"1201-02-01 12:00:00");
  assert.strictEqual(result.pass,true,type+" proof activation failed");
  assert.strictEqual(result.snapshot.activeCount,1,type+" did not become active");
  assert(result.event.participants.length>=2&&result.event.participants.length<=4);
  for(const participant of result.event.participants){
    const state=LocalEventVignettes.stateFor(participant.id,s);
    assert(state?.scheduleOverride&&state?.activityOverride,type+" participant did not receive temporary event activity");
    assert.strictEqual(state.activityOverride.action,"gather",type+" activity action changed");
    assert.strictEqual(state.activityOverride.target.x,result.event.location.anchor.x,type+" activity target x drifted");
    assert.strictEqual(state.activityOverride.target.y,result.event.location.anchor.y,type+" activity target y drifted");
    assert.strictEqual(state.activityOverride.targetSource,"local-event-vignette",type+" activity target source changed");
  }
  const ended=LocalEventVignettes.advance(s,"1201-02-01 12:46:00",{ensureScheduled:false});
  assert.strictEqual(ended.activeCount,0,type+" did not end cleanly");
  proofRows.push({type,participants:result.event.participants.map(p=>p.id),location:result.event.location.label});
}

const proof=LocalEventVignettes.proof(seed+"-PROOF");
assert.strictEqual(proof.pass,true,"central deterministic vignette proof failed");
assert.strictEqual(proof.eventDriven,true);
assert.strictEqual(proof.perFrameScan,false);
assert.strictEqual(proof.fullSettlementPerFrameScan,false);
assert.strictEqual(proof.fullWorldScan,false);
assert(proof.maxParticipants<=4&&proof.maxActiveEvents<=2,"runtime bounds changed");

const residentSource=fs.readFileSync("scripts/world/resident-movement.js","utf8");
const stageSource=fs.readFileSync("scripts/world/planet-stage.js","utf8");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("styles/main.css","utf8");
assert(residentSource.includes("LocalEventVignettes?.stateFor?.(state.residentId)"),"ResidentMovement is not wired to local events");
assert(residentSource.includes("work.activity=localEvent.activityOverride"),"ResidentMovement does not apply temporary event activity override");
assert(residentSource.includes('work.localEvent?"local-event"'),"ResidentMovement does not instrument event-directed movement");
assert(stageSource.includes("localEvents:window.LocalEventVignettes?.snapshot?.(activeSeed)||null"),"PlanetStage snapshot missing local-event telemetry");
assert(html.indexOf("scripts/world/local-event-vignettes.js")<html.indexOf("scripts/world/planet-stage.js"),"local-event runtime must load before PlanetStage");
assert(css.includes(".local-event-vignette"),"event presentation style missing");

console.log(JSON.stringify({
  pass:true,wp:"WP-S007-011",classification:"MIXED",
  catalog:proof.types,proofRows,
  bounds:{maxParticipants:proof.maxParticipants,maxActiveEvents:proof.maxActiveEvents,processLimit:LocalEventVignettes.PROCESS_LIMIT},
  scheduling:{eventDriven:proof.eventDriven,perFrameScan:proof.perFrameScan,fullSettlementPerFrameScan:proof.fullSettlementPerFrameScan,fullWorldScan:proof.fullWorldScan},
  authority:{participantSource:"DailyActivity bounded resident roster",temporaryScheduleOverride:true,persistentConsequenceAuthority:false}
},null,2));
