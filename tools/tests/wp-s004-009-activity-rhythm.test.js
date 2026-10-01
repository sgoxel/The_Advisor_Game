"use strict";
const assert=require("assert");
global.window=global;
global.performance=global.performance||require("perf_hooks").performance;

function hash(seed,key){
  let h=2166136261>>>0,s=String(seed)+"|"+String(key);
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return h>>>0;
}
function p(x,y){return Object.freeze({x:String(x),y:String(y),level:0})}
global.PRNG={foundationUint32:hash};
global.WorldCoordinates={position:(x,y)=>p(x,y)};
global.GameTime={getNow:()=>({year:1201,month:2,day:1,hour:12,minute:0,second:0})};

const professions=[
  ["farmer","farm"],["smith","craft"],["tavern-keeper","lodging"],
  ["shopkeeper","market"],["woodcutter","outdoor-work"],["guard","civic"]
];
const residents=Array.from({length:12},(_,i)=>{
  const [profession,workFunction]=professions[i%professions.length];
  return Object.freeze({
    id:"R"+String(i+1).padStart(2,"0"),profession,workFunction,
    workplaceFunction:workFunction,workplaceId:"W"+i,homePlanId:"H"+i
  });
});
function activityFor(resident,when){
  const h=Number(when.hour||0)+Number(when.minute||0)/60;
  if(h<5||h>=22)return Object.freeze({
    state:"sleep",kind:"sleep",action:"sleep",intendedAction:"sleep",
    target:p(0,0),targetSource:"interior-interaction",buildingId:resident.homePlanId
  });
  if(h<8)return Object.freeze({
    state:h<6?"prepare":"return-home",kind:"prepare",action:"move",intendedAction:"move",
    target:p(1,0),targetSource:h<6?"interior-interaction":"outdoor-worksite",buildingId:resident.homePlanId
  });
  if(h<17)return Object.freeze({
    state:"work",kind:"work",action:"work",intendedAction:"work",
    target:p(2,0),targetSource:resident.profession==="woodcutter"?"outdoor-worksite":"interior-interaction",
    buildingId:resident.workplaceId
  });
  if(h<19)return Object.freeze({
    state:"return-home",kind:"return-home",action:"move",intendedAction:"move",
    target:p(3,0),targetSource:"outdoor-worksite",buildingId:resident.homePlanId
  });
  return Object.freeze({
    state:"social",kind:"social",action:"social",intendedAction:"social",
    target:p(4,0),targetSource:"interior-interaction",buildingId:"TAVERN"
  });
}
global.DailyActivity={
  build:()=>residents,
  resolveActionTarget:(_seed,resident,when)=>activityFor(resident,when)
};

require("../../scripts/world/settlement-activity-rhythm.js");
assert(global.SettlementActivityRhythm,"SettlementActivityRhythm did not register");

const seed="WP-S004-009-TEST";
const verify=SettlementActivityRhythm.verify(seed);
assert.strictEqual(verify.pass,true,"rhythm verification failed");
assert.strictEqual(verify.deterministic,true);
assert.strictEqual(verify.bandsPass,true);
assert.strictEqual(verify.profileContrastPass,true);
assert.strictEqual(verify.variationPass,true);

const sampleTimes={
  dawn:{year:1201,month:2,day:1,hour:6,minute:30,second:0},
  daytime:{year:1201,month:2,day:1,hour:12,minute:30,second:0},
  "late-day":{year:1201,month:2,day:1,hour:18,minute:0,second:0},
  evening:{year:1201,month:2,day:1,hour:20,minute:30,second:0},
  night:{year:1201,month:2,day:1,hour:23,minute:30,second:0}
};
const snapshots=Object.fromEntries(Object.entries(sampleTimes).map(([name,when])=>[
  name,SettlementActivityRhythm.snapshot(seed,when)
]));
for(const [name,row] of Object.entries(snapshots)){
  assert.strictEqual(row.band,name,name+" did not resolve expected band");
  assert.strictEqual(row.residentCount,12);
  assert.strictEqual(row.fantasyTimeOnly,true);
  assert.strictEqual(row.scheduleMutation,false);
  assert.strictEqual(row.worldTruthMutation,false);
  assert.strictEqual(row.materializationMutation,false);
  assert.strictEqual(row.fullSettlementPerFrameScan,false);
  assert.strictEqual(row.globalScan,false);
}
assert(snapshots.daytime.modifiers.workSiteOccupancy>snapshots.evening.modifiers.workSiteOccupancy);
assert(snapshots.evening.modifiers.tavernSocialActivity>snapshots.dawn.modifiers.tavernSocialActivity);
assert(snapshots.night.modifiers.outdoorResidentShare<snapshots.daytime.modifiers.outdoorResidentShare);
assert(snapshots.night.modifiers.guardPatrolPresence>=snapshots.daytime.modifiers.guardPatrolPresence);
assert(snapshots["late-day"].counts.traffic>0,"late day should expose return travel in fixture");
assert(snapshots.evening.counts.tavernSocial>0,"evening should expose social activity in fixture");
assert(snapshots.night.counts.home===12,"night should resolve residents home in fixture");

const before=JSON.stringify(activityFor(residents[0],sampleTimes.daytime));
SettlementActivityRhythm.snapshot(seed,sampleTimes.daytime);
const after=JSON.stringify(activityFor(residents[0],sampleTimes.daytime));
assert.strictEqual(after,before,"rhythm layer mutated authoritative schedule result");

const nearBoundaryA=SettlementActivityRhythm.profileAtHour(7.4);
const nearBoundaryB=SettlementActivityRhythm.profileAtHour(7.9);
assert(nearBoundaryA.transition||nearBoundaryB.transition,"transition smoothing missing near dawn/daytime boundary");
assert(nearBoundaryB.modifiers.workSiteOccupancy>=nearBoundaryA.modifiers.workSiteOccupancy,
  "work occupancy should transition smoothly toward daytime");

console.log(JSON.stringify({pass:true,verify,snapshots:Object.fromEntries(
  Object.entries(snapshots).map(([k,v])=>[k,{band:v.band,modifiers:v.modifiers,counts:v.counts,averagePresentationPriority:v.averagePresentationPriority,phaseRange:v.residentPhaseMinuteRange}])
)},null,2));