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
global.Walkability={classify:(_seed,x,y)=>({walkable:true,buildingId:null,level:0,x:String(x),y:String(y)})};
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
  assert(event.participants.every(p=>p.id&&p.existingTarget&&p.eventTarget),"event fabricated a participant/target");
  assert(event.location?.anchor&&event.location?.source,"event location is not grounded in an existing resident target");
  assert.strictEqual(new Set(event.participants.map(p=>p.eventTarget.x+","+p.eventTarget.y)).size,event.participantCount,"event staging targets are not distinct");
  assert(event.participants.every(p=>p.eventTargetSource==="bounded-walkable-staging"),"event did not use bounded walkable staging");
  assert.strictEqual(event.stagingMode,"compact-walkable-cluster-v2","event did not use compact cluster staging");
  assert(event.stagingCenter&&event.stagingRadiusTiles===1,"event compact staging center missing");
  assert(event.participants.every(p=>{
    const dx=Number(BigInt(p.eventTarget.x)-BigInt(event.location.anchor.x)),dy=Number(BigInt(p.eventTarget.y)-BigInt(event.location.anchor.y));
    return Math.max(Math.abs(dx),Math.abs(dy))>=2&&Math.max(Math.abs(dx),Math.abs(dy))<=6;
  }),"event staging escaped bounded immediate area");
  assert(event.participants.every(p=>{
    const dx=Number(BigInt(p.eventTarget.x)-BigInt(event.stagingCenter.x)),dy=Number(BigInt(p.eventTarget.y)-BigInt(event.stagingCenter.y));
    return Math.max(Math.abs(dx),Math.abs(dy))<=1;
  }),"event participants escaped compact staging cluster");
  const pairwise=[];
  for(let i=0;i<event.participants.length;i++)for(let j=i+1;j<event.participants.length;j++){
    const a=event.participants[i].eventTarget,b=event.participants[j].eventTarget;
    pairwise.push(Math.max(Math.abs(Number(BigInt(a.x)-BigInt(b.x))),Math.abs(Number(BigInt(a.y)-BigInt(b.y)))));
  }
  assert(pairwise.every(d=>d>=1&&d<=2),"event participant spacing is not compact/distinct");
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
    assert.strictEqual(state.activityOverride.target.x,participant.eventTarget.x,type+" staged activity target x drifted");
    assert.strictEqual(state.activityOverride.target.y,participant.eventTarget.y,type+" staged activity target y drifted");
    assert.strictEqual(state.activityOverride.targetSource,"local-event-vignette",type+" activity target source changed");
    assert.strictEqual(state.stagingRevision,"compact-walkable-cluster-v2",type+" staging revision missing");
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
assert(stageSource.includes('localEventPresentationRevision:"compact-event-silhouette-v3"'),"compact local-event presentation revision missing");
assert(stageSource.includes("activeLocalEventCueCount")&&stageSource.includes("activeLocalEventResidentIds"),"local-event cue telemetry missing");
assert(stageSource.includes('eventType==="market-day-setup"')&&stageSource.includes('eventType==="village-gathering"')&&stageSource.includes('eventType==="minor-argument"')&&stageSource.includes('eventType==="predator-warning"'),"compact event-specific presentation catalog missing");
assert(stageSource.includes("eventSilhouetteScreenSizePx")&&stageSource.includes("bodyScreenSizePx"),"event body/silhouette evidence metrics missing");
assert(!stageSource.includes("cueScale=2.15"),"rejected oversized local-event cue scale returned");
assert(html.indexOf("scripts/world/local-event-vignettes.js")<html.indexOf("scripts/world/planet-stage.js"),"local-event runtime must load before PlanetStage");
assert(css.includes(".local-event-vignette"),"event presentation style missing");

console.log(JSON.stringify({
  pass:true,wp:"WP-S007-011",classification:"MIXED",
  catalog:proof.types,proofRows,
  bounds:{maxParticipants:proof.maxParticipants,maxActiveEvents:proof.maxActiveEvents,processLimit:LocalEventVignettes.PROCESS_LIMIT},
  scheduling:{eventDriven:proof.eventDriven,perFrameScan:proof.perFrameScan,fullSettlementPerFrameScan:proof.fullSettlementPerFrameScan,fullWorldScan:proof.fullWorldScan},
  authority:{participantSource:"DailyActivity bounded resident roster",temporaryScheduleOverride:true,persistentConsequenceAuthority:false}
},null,2));
