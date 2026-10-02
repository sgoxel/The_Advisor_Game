"use strict";
const assert=require("assert");
global.window=global;
global.performance=global.performance||require("perf_hooks").performance;

function hash(seed,key){
  let h=2166136261>>>0,s=String(seed)+"|"+String(key);
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return h>>>0;
}
function point(x,y){return Object.freeze({x:String(x),y:String(y),level:0})}
global.PRNG={foundationUint32:hash};
global.WorldCoordinates={
  position:(x,y)=>point(x,y),
  add:(p,dx,dy)=>point(BigInt(p.x)+BigInt(dx),BigInt(p.y)+BigInt(dy))
};
global.Walkability={
  CATEGORY:{ENTRANCE:"entrance",INTERIOR:"interior"},
  classify:(_seed,x,y)=>Object.freeze({walkable:true,category:"grass",buildingId:null,x:String(x),y:String(y),secondsPerTile:.1,speedKmh:5})
};
global.StartingVillage={local:(_seed,x,y)=>({x:String(x),y:String(y)}),isRoadReserved:()=>false};

const professions=["farmer","smith","tavern-keeper","shopkeeper","woodcutter","guard"];
const workplaceIds={farmer:"FARM",smith:"SMITH","tavern-keeper":"TAVERN",shopkeeper:"SHOP",woodcutter:"YARD",guard:"HALL"};
const residents=[];
for(let i=0;i<12;i++){
  const profession=professions[i%professions.length],workplaceId=workplaceIds[profession];
  residents.push(Object.freeze({
    id:"R"+String(i+1).padStart(2,"0"),name:"Resident"+(i+1),displayName:"Resident "+(i+1),
    profession,workplaceId,workplaceEnterable:profession!=="woodcutter",
    homeTarget:point(0,0),homePlanId:"HOME"+i,
    schedule:Object.freeze([
      Object.freeze({state:"work",kind:"work",startMinute:8*60,endMinute:12*60}),
      Object.freeze({state:"work",kind:"work",startMinute:13*60,endMinute:18*60})
    ])
  }));
}
global.DailyActivity={
  build:()=>residents,
  resolveActionTarget:(_seed,resident,when)=>{
    const minute=Number(when.hour||0)*60+Number(when.minute||0);
    const work=resident.schedule.find(b=>b.startMinute<=minute&&minute<b.endMinute);
    if(!work)return Object.freeze({state:"sleep",kind:"sleep",label:"Sleep",target:point(0,0),targetSource:"interior-interaction",buildingId:resident.homePlanId,interactionObjectId:"bed",interactionObjectType:"bed",action:"sleep",intendedAction:"sleep",supportedActions:Object.freeze(["sleep","rest"])});
    return Object.freeze({state:"work",kind:"work",label:"Generic work",target:point(6,0),targetSource:resident.workplaceEnterable?"interior-interaction":"outdoor-worksite",buildingId:resident.workplaceId,interactionObjectId:resident.workplaceEnterable?resident.workplaceId+":workbench":null,interactionObjectType:resident.workplaceEnterable?"workbench":"worksite",action:"work",intendedAction:"work",supportedActions:Object.freeze(["work"])});
  }
};
const bases={FARM:10,SMITH:30,TAVERN:50,SHOP:70,YARD:90,HALL:110};
global.BuildingInteriors={
  get:(_seed,id)=>{
    const base=bases[id];
    if(base==null)return {entrance:{door:point(0,0),immediateOutside:point(1,0),outdoorAccess:point(2,0)}};
    return Object.freeze({entrance:Object.freeze({door:point(base,0),immediateOutside:point(base+1,0),outdoorAccess:point(base+2,0)})});
  },
  build:()=>[]
};
function obj(buildingId,type,index,actions,x,y){
  return Object.freeze({id:buildingId+":"+type+":"+index,type,buildingId,actions:Object.freeze(actions),interactionPositions:Object.freeze([point(x,y)])});
}
const objects=[
  obj("FARM","storage",1,["store","retrieve"],11,2),obj("FARM","workbench",1,["work","craft"],12,2),
  obj("SMITH","storage",1,["store","retrieve"],31,2),obj("SMITH","workbench",1,["work","craft"],32,2),
  obj("TAVERN","counter",1,["service","work","social","eat"],51,2),obj("TAVERN","table",1,["eat","social","work"],52,2),obj("TAVERN","chair",1,["sit","social"],53,2),
  obj("SHOP","storage",1,["store","retrieve"],71,2),obj("SHOP","counter",1,["service","work","social","eat"],72,2),
  obj("HALL","table",1,["eat","social","work"],111,2),obj("HALL","chair",1,["sit","social"],112,2)
];
global.InteriorObjects={
  build:()=>objects,
  classifyNavigation:global.Walkability.classify
};
const lots=[
  {id:"FARM",enterable:true,bounds:{minX:8,maxX:14,minY:-2,maxY:4}},
  {id:"SMITH",enterable:true,bounds:{minX:28,maxX:34,minY:-2,maxY:4}},
  {id:"TAVERN",enterable:true,bounds:{minX:48,maxX:54,minY:-2,maxY:4}},
  {id:"SHOP",enterable:true,bounds:{minX:68,maxX:74,minY:-2,maxY:4}},
  {id:"YARD",enterable:false,bounds:{minX:88,maxX:94,minY:-2,maxY:4}},
  {id:"HALL",enterable:true,bounds:{minX:108,maxX:114,minY:-2,maxY:4}}
];
global.SpecialLots={build:()=>lots};
function route(_seed,a,b){
  const path=[point(a.x,a.y)];
  let x=BigInt(a.x),y=BigInt(a.y),tx=BigInt(b.x),ty=BigInt(b.y);
  while(x!==tx){x+=x<tx?1n:-1n;path.push(point(x,y))}
  while(y!==ty){y+=y<ty?1n:-1n;path.push(point(x,y))}
  return Object.freeze({found:true,path:Object.freeze(path),stepCount:path.length-1,totalSeconds:(path.length-1)*.1});
}
global.RoutePlanner={findRoute:route};
global.GameTime={getNow:()=>({year:1100,month:1,day:1,hour:9,minute:0,second:0})};
global.SocialEncounters={reset:()=>null,advance:()=>null,stateFor:()=>null,snapshot:()=>({activeEncounterCount:0})};

require("../../scripts/world/work-cycles.js");
assert(global.WorkCycles,"WorkCycles did not register");
const seed="WP-S004-007-TEST";
const proof=WorkCycles.verify(seed);
assert.strictEqual(proof.pass,true,"work-cycle verification failed");
assert(proof.representativeCount>=4,"insufficient profession coverage");
assert(proof.indoorProfessionCount>0&&proof.outdoorProfessionPass,"indoor/outdoor coverage failed");
assert.strictEqual(proof.genericFallbackPass,true,"generic work fallback failed");
for(const row of proof.representatives){
  assert(row.stepCount>=3,row.profession+" lacks multi-step cycle");
  assert(row.deterministic,row.profession+" cycle is not deterministic");
  assert(row.routesPass,row.profession+" route continuity failed");
  assert(row.realTargets,row.profession+" uses a non-authoritative target");
  assert(row.multiStepSamples>=3,row.profession+" evidence samples did not expose multiple steps");
}
const smithSamples=WorkCycles.evidenceSamples(seed,"smith");
assert(smithSamples.some(x=>x.targetSource==="interior-interaction"),"smith lacks indoor interaction step");
assert(smithSamples.some(x=>x.targetSource==="work-choreography"),"smith lacks visible frontage step");
assert(WorkCycles.evidenceSamples(seed,"woodcutter").every(x=>x.targetSource==="outdoor-worksite"),"woodcutter left outdoor worksite");

require("../../scripts/world/action-executor.js");
const smith=residents.find(r=>r.profession==="smith");
const exteriorSample=smithSamples.find(x=>x.targetSource==="work-choreography");
const base=DailyActivity.resolveActionTarget(seed,smith,exteriorSample.when);
const activity=WorkCycles.resolve(seed,smith,exteriorSample.when,base);
assert.strictEqual(activity.workCycle.stepId,exteriorSample.stepId);
const action=ActionExecutor.advanceActor({seed,actorKind:"resident",actorId:smith.id,position:activity.target,activity},0);
assert.strictEqual(action.status,"active","frontage action did not enter generic action executor");

require("../../scripts/world/resident-movement.js");
ResidentMovement.reset(seed);
for(let i=0;i<30;i++)ResidentMovement.advance(seed,{year:1100,month:1,day:1,hour:9,minute:0,second:0},.1);
const movement=ResidentMovement.snapshot();
assert.strictEqual(movement.residentCount,12);
assert.strictEqual(movement.routePlanningPerFrame,false);
assert(movement.workCycles&&movement.workCycles.routePlanningPerFrame===false);
assert(movement.residents.some(r=>r.workCycle),"resident movement did not consume a work cycle");
assert(movement.residents.every(r=>r.blockedTraversals===0),"work choreography introduced blocked traversal");

const telemetry=WorkCycles.snapshot(seed);
assert(telemetry.routeQueryCount>0,"route telemetry missing");
assert.strictEqual(telemetry.fullSettlementPerFrameScan,false);
assert.strictEqual(telemetry.economyAuthority,false);
assert.strictEqual(telemetry.resourceMutation,false);

console.log(JSON.stringify({pass:true,verification:proof,smithSamples,telemetry,movement:{residentCount:movement.residentCount,routePlanningPerFrame:movement.routePlanningPerFrame,activeWorkCycles:movement.residents.filter(r=>r.workCycle).length,blockedTraversals:movement.residents.reduce((n,r)=>n+r.blockedTraversals,0)}},null,2));
