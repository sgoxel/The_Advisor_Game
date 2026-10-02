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
global.WorldCoordinates={position:(x,y)=>p(x,y),add:(value,dx,dy)=>p(BigInt(value.x)+BigInt(dx),BigInt(value.y)+BigInt(dy))};
global.GameTime={getNow:()=>({year:1201,month:2,day:1,hour:12,minute:0,second:0})};
global.Walkability={CATEGORY:{ENTRANCE:"entrance",INTERIOR:"interior"},classify:(_seed,x,y)=>{
  const key=String(x)+","+String(y),base={walkable:true,secondsPerTile:.1,speedKmh:5};
  if(key==="1,0")return Object.freeze({...base,category:"entrance",buildingId:"HOME1",doorwayKind:"exterior-door"});
  if(key==="10,0")return Object.freeze({...base,category:"interior",buildingId:"W1",doorwayKind:null});
  return Object.freeze({...base,category:"grass",buildingId:null,doorwayKind:null});
}};
global.InteriorObjects={classifyNavigation:global.Walkability.classify};
const residents=[
  Object.freeze({id:"R01",displayName:"Alda Ash",profession:"smith",homePlanId:"HOME1",homeTarget:p(0,0),workplaceId:"W1",workplaceEnterable:true,workplaceTarget:p(10,0)}),
  Object.freeze({id:"R02",displayName:"Bram Briar",profession:"guard",homePlanId:"HOME2",homeTarget:p(20,0),workplaceId:"W2",workplaceEnterable:true,workplaceTarget:p(30,0)}),
  Object.freeze({id:"R03",displayName:"Celia Cinder",profession:"farmer",homePlanId:"HOME3",homeTarget:p(40,0),workplaceId:"W3",workplaceEnterable:true,workplaceTarget:p(50,0)}),
  Object.freeze({id:"R04",displayName:"Dren Dale",profession:"woodcutter",homePlanId:"HOME4",homeTarget:p(60,0),workplaceId:"YARD",workplaceEnterable:false,workplaceTarget:p(70,0)})
];
for(let i=5;i<=12;i++){
  residents.push(Object.freeze({
    id:"R"+String(i).padStart(2,"0"),displayName:"Resident "+i,profession:"farmer",
    homePlanId:"HOME"+i,homeTarget:p(100+i*3,0),workplaceId:"W"+i,workplaceEnterable:true,workplaceTarget:p(110+i*3,0)
  }));
}
global.DailyActivity={
  build:()=>residents,
  resolveActionTarget:(_seed,resident,when)=>Object.freeze({
    state:"work",kind:"work",action:"work",intendedAction:"work",label:"Work",
    buildingId:resident.workplaceId,target:resident.workplaceTarget,targetSource:"interior-interaction"
  })
};
global.BuildingInteriors={get:(_seed,id)=>{
  if(id==="HOME1")return Object.freeze({entrance:Object.freeze({door:p(1,0),immediateOutside:p(2,0),outdoorAccess:p(3,0)})});
  return Object.freeze({entrance:Object.freeze({door:p(21,0),immediateOutside:p(22,0),outdoorAccess:p(23,0)})});
}};
global.SocialState={dialogueContext:()=>({values:{trust:.7,suspicion:.2,respect:.6,loyalty:.4,resentment:.1,fear:.1}})};

require("../../scripts/world/contextual-reactions.js");
assert(global.ContextualReactions,"ContextualReactions did not register");
const seed="WP-S004-008-TEST";

const verification=ContextualReactions.verify(seed);
assert.strictEqual(verification.pass,true,"contextual reaction verification failed");
assert.strictEqual(verification.deterministic,true,"reaction decisions are not deterministic");
assert.strictEqual(verification.cooldownSuppressed,true,"cooldown did not suppress repeated reaction");
assert.strictEqual(verification.caseCount,4,"required proof cases missing");
const cases=Object.fromEntries(verification.cases.map(row=>[row.id,row]));
assert(cases["doorway-block"].reactionCreated,"doorway block did not react");
assert.strictEqual(cases["doorway-block"].reaction.holdsPosition,true,"doorway block should briefly hold position");
assert(cases["close-follow"].reactionCreated,"sustained close following did not react");
assert.strictEqual(cases["close-follow"].reaction.holdsPosition,false,"close following must not force route pause");
assert(cases["workplace-interrupt"].reactionCreated,"workplace interruption did not react");
assert.strictEqual(cases["harmless-pass"].reactionCreated,false,"ordinary harmless passing should remain calm");
assert(cases["harmless-pass"].lowSalienceDelta>0,"harmless pass was not explicitly suppressed");

ContextualReactions.reset(seed);
const resident=Object.freeze({
  id:"R02",position:p(2,0),nextPosition:p(3,0),status:"moving",workplaceId:"W2",
  activity:Object.freeze({state:"return-home",action:"move"})
});
const when={year:1201,month:2,day:1,hour:16,minute:10,second:0};
const queued=ContextualReactions.observeProtagonist({
  kind:"close-follow",residentId:"R02",protagonist:p(2,0),proximitySeconds:5,when,source:"simulation-protagonist"
});
assert.strictEqual(queued.accepted,true);
ContextualReactions.advance({seed,when,seconds:.1,residentLookup:id=>id==="R02"?resident:null});
const active=ContextualReactions.stateFor("R02");
assert(active&&active.kind==="close-follow","addressed event did not activate");
assert.strictEqual(active.routeMutation,false);
assert.strictEqual(active.scheduleMutation,false);
assert.strictEqual(active.forcedProtagonistMovement,false);

const telemetry=ContextualReactions.snapshot();
assert.strictEqual(telemetry.eventDriven,true);
assert.strictEqual(telemetry.globalNpcScan,false);
assert.strictEqual(telemetry.perFrameNpcScan,false);
assert(telemetry.maxCandidateChecksPerAdvance<=ContextualReactions.MAX_EVENTS_PER_ADVANCE);
assert(telemetry.maxUpdateMs<50,"reaction processing exceeded 50 ms in node fixture");

// Integration contract: a short contextual hold pauses movement presentation
// without discarding or replanning the resident's existing authoritative route.
global.RoutePlanner={findRoute:(_seed,a,b)=>{
  const path=[p(a.x,a.y)];let x=BigInt(a.x),y=BigInt(a.y),tx=BigInt(b.x),ty=BigInt(b.y);
  while(x!==tx){x+=x<tx?1n:-1n;path.push(p(x,y))}
  while(y!==ty){y+=y<ty?1n:-1n;path.push(p(x,y))}
  return Object.freeze({found:true,path:Object.freeze(path),stepCount:path.length-1,totalSeconds:(path.length-1)*.1});
}};
global.SocialEncounters={reset:()=>null,advance:()=>null,stateFor:()=>null,snapshot:()=>({activeEncounterCount:0})};
global.ActionExecutor={
  clearKind:()=>null,get:()=>null,
  advanceActor:()=>Object.freeze({changed:false,holdsPosition:false})
};
require("../../scripts/world/resident-movement.js");
ResidentMovement.reset(seed);
const movementWhen={year:1201,month:2,day:1,hour:10,minute:30,second:0};
ResidentMovement.advance(seed,movementWhen,.1);
const beforeHold=ResidentMovement.get("R02");
const holdEvent=ContextualReactions.observeProtagonist({
  kind:"space-collision",residentId:"R02",protagonist:beforeHold.position,when:movementWhen,source:"simulation-protagonist"
});
assert.strictEqual(holdEvent.accepted,true);
ResidentMovement.advance(seed,movementWhen,.1);
const duringHold=ResidentMovement.get("R02");
assert.deepStrictEqual(duringHold.position,beforeHold.position,"contextual hold failed to pause the resident");
assert.strictEqual(duringHold.routeRequests,beforeHold.routeRequests,"contextual hold replanned the route");
assert.strictEqual(duringHold.targetPlans,beforeHold.targetPlans,"contextual hold changed the authoritative target plan");
assert(duringHold.contextualReaction?.holdsPosition,"resident snapshot did not expose the active contextual hold");
for(let i=0;i<12;i++)ResidentMovement.advance(seed,movementWhen,.1);
const afterHold=ResidentMovement.get("R02");
assert.notDeepStrictEqual(afterHold.position,beforeHold.position,"resident did not resume its existing route after reaction expiry");
assert.strictEqual(afterHold.routeRequests,beforeHold.routeRequests,"route was replanned after contextual reaction");
assert.strictEqual(afterHold.targetPlans,beforeHold.targetPlans,"schedule target was replanned after contextual reaction");

console.log(JSON.stringify({
  pass:true,verification,telemetry,
  integration:{
    heldAt:beforeHold.position,resumedAt:afterHold.position,
    routeRequestsBefore:beforeHold.routeRequests,routeRequestsAfter:afterHold.routeRequests,
    targetPlansBefore:beforeHold.targetPlans,targetPlansAfter:afterHold.targetPlans
  }
},null,2));