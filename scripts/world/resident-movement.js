(function(){
"use strict";

const LEVEL=0;
const FIXED_STEP_SECONDS=0.1;
const MAX_ADVANCE_STEPS=240;
const WALL_CLEARANCE_PENALTY_SECONDS=20;
let seedKey="";
let residentById=new Map();
let states=new Map();
let accumulator=0;
let proofContext=null;
let wallClearanceSeed="";
let wallClearancePenaltyCells=new Set();
let wallClearanceExemptCells=new Set();
const proofCache=new Map();

function point(value){
  if(!value)return null;
  const p=WorldCoordinates.position(String(value.x),String(value.y));
  return Object.freeze({x:p.x,y:p.y,level:LEVEL});
}
function samePoint(a,b){return !!a&&!!b&&a.x===b.x&&a.y===b.y}
function key(value){return value?value.x+","+value.y:""}
function ensureWallClearance(seed){
  const requested=String(seed==null?"":seed);
  if(wallClearanceSeed===requested)return;
  wallClearanceSeed=requested;
  wallClearancePenaltyCells=new Set();
  wallClearanceExemptCells=new Set();
  if(!requested||!window.BuildingInteriors?.build)return;
  const directions=[["0","-1"],["1","0"],["0","1"],["-1","0"]];
  for(const interior of BuildingInteriors.build(requested)){
    for(const wall of interior.exteriorWallCells||[]){
      for(const [dx,dy] of directions){
        const neighbor=WorldCoordinates.add(wall,dx,dy);
        wallClearancePenaltyCells.add(key(neighbor));
      }
    }
    const doorwayPoints=[
      interior.entrance?.door,
      interior.entrance?.immediateOutside,
      interior.entrance?.outdoorAccess
    ].filter(Boolean);
    for(const doorway of doorwayPoints){
      wallClearanceExemptCells.add(key(doorway));
      for(const [dx,dy] of directions)wallClearanceExemptCells.add(key(WorldCoordinates.add(doorway,dx,dy)));
    }
  }
}
function wallClearancePenalty(seed,context){
  ensureWallClearance(seed);
  const nav=context?.state;
  const pointValue=context?.point;
  if(!pointValue||!nav?.walkable)return 0;
  if(nav.buildingId||nav.category===Walkability.CATEGORY.ENTRANCE||nav.category===Walkability.CATEGORY.INTERIOR)return 0;
  const pointKey=key(pointValue);
  if(wallClearanceExemptCells.has(pointKey))return 0;
  return wallClearancePenaltyCells.has(pointKey)?WALL_CLEARANCE_PENALTY_SECONDS:0;
}
function manhattan(a,b){
  if(!a||!b)return Infinity;
  const dx=BigInt(a.x)-BigInt(b.x),dy=BigInt(a.y)-BigInt(b.y);
  const d=(dx<0n?-dx:dx)+(dy<0n?-dy:dy);
  return d>BigInt(Number.MAX_SAFE_INTEGER)?Infinity:Number(d);
}
function navigation(seed,value){
  if(!value)return null;
  return window.InteriorObjects?.classifyNavigation
    ?InteriorObjects.classifyNavigation(seed,value.x,value.y)
    :Walkability.classify(seed,value.x,value.y);
}
function cloneActivity(activity){
  if(!activity?.target)return null;
  return Object.freeze({
    state:String(activity.state||activity.kind||"unknown"),
    action:String(activity.intendedAction||activity.action||"move"),
    label:String(activity.label||activity.state||"Movement"),
    target:point(activity.target),
    buildingId:activity.buildingId?String(activity.buildingId):null,
    targetSource:activity.targetSource?String(activity.targetSource):null,
    interactionObjectId:activity.interactionObjectId?String(activity.interactionObjectId):null,
    interactionObjectType:activity.interactionObjectType?String(activity.interactionObjectType):null,
    supportedActions:Object.freeze([...(activity.supportedActions||[])])
  });
}
function residentState(resident,startValue){
  const start=point(startValue||resident.homeTarget);
  return {
    residentId:resident.id,
    position:start,
    level:LEVEL,
    activity:null,
    target:null,
    route:null,
    routeIndex:0,
    segmentElapsed:0,
    status:"idle",
    routeRequests:0,
    targetPlans:0,
    invalidSegmentReplans:0,
    completedSteps:0,
    doorCrossings:0,
    blockedTraversals:0,
    history:[start],
    segmentLog:[],
    presentationOffset:Object.freeze({x:0,y:0}),
    lastReason:"initialized"
  };
}
function ensure(seed){
  const nextSeed=String(seed==null?"":seed);
  if(!nextSeed)return false;
  if(seedKey===nextSeed&&states.size===12)return true;
  seedKey=nextSeed;
  ensureWallClearance(nextSeed);
  residentById=new Map((DailyActivity.build(nextSeed)||[]).map(resident=>[resident.id,resident]));
  states=new Map();
  for(const resident of residentById.values())states.set(resident.id,residentState(resident,resident.homeTarget));
  accumulator=0;
  proofContext=null;
  return states.size===12;
}
function reset(seed){
  seedKey="";
  residentById=new Map();
  states=new Map();
  accumulator=0;
  proofContext=null;
  wallClearanceSeed="";
  wallClearancePenaltyCells=new Set();
  wallClearanceExemptCells=new Set();
  window.ActionExecutor?.clearKind?.("resident");
  return ensure(seed);
}
function routeTargetKey(activity){return activity?key(activity.target)+"|"+activity.state+"|"+activity.action:""}
function plan(seed,state,activity,reason){
  const nextActivity=cloneActivity(activity);
  state.activity=nextActivity;
  state.target=nextActivity?.target||null;
  state.segmentElapsed=0;
  state.presentationOffset=Object.freeze({x:0,y:0});
  if(!state.target){
    state.route=null;
    state.routeIndex=0;
    state.status="idle";
    state.lastReason="missing-target";
    return false;
  }
  if(samePoint(state.position,state.target)){
    state.route=Object.freeze({found:true,path:Object.freeze([state.position]),stepCount:0,totalSeconds:0});
    state.routeIndex=0;
    state.status="arrived";
    state.lastReason=reason||"already-at-target";
    return true;
  }
  const route=RoutePlanner.findRoute(seed,state.position,state.target,{
    stepPenaltySeconds:context=>wallClearancePenalty(seed,context)
  });
  state.routeRequests++;
  if(reason==="target-change"||reason==="initial-target")state.targetPlans++;
  if(reason==="invalid-next-segment")state.invalidSegmentReplans++;
  state.route=route;
  state.routeIndex=0;
  state.status=route?.found?"moving":"stalled";
  state.lastReason=route?.found?(reason||"planned"):(route?.reason||"unreachable");
  return Boolean(route?.found);
}
function activeActivity(seed,state,when){
  if(proofContext?.active&&proofContext.residentId===state.residentId&&proofContext.sampleTime){
    return DailyActivity.resolveActionTarget(seed,residentById.get(state.residentId),proofContext.sampleTime);
  }
  return DailyActivity.resolveActionTarget(seed,residentById.get(state.residentId),when);
}
function ensureTarget(seed,state,activity){
  const next=cloneActivity(activity);
  if(routeTargetKey(state.activity)!==routeTargetKey(next)){
    return plan(seed,state,next,state.activity?"target-change":"initial-target");
  }
  if(!state.route&&next)return plan(seed,state,next,"initial-target");
  return Boolean(state.route?.found);
}
function completeStep(seed,state,next,segmentSeconds){
  if(manhattan(state.position,next)!==1){
    state.blockedTraversals++;
    state.status="stalled";
    state.lastReason="non-adjacent-route-segment";
    return false;
  }
  const nav=navigation(seed,next);
  if(!nav?.walkable||!Number.isFinite(nav.secondsPerTile)){
    state.blockedTraversals++;
    plan(seed,state,state.activity,"invalid-next-segment");
    return false;
  }
  state.position=point(next);
  state.routeIndex++;
  state.completedSteps++;
  state.segmentElapsed=0;
  state.presentationOffset=Object.freeze({x:0,y:0});
  state.history.push(state.position);
  state.segmentLog.push(Object.freeze({
    x:state.position.x,y:state.position.y,
    seconds:Number(segmentSeconds),
    speedKmh:Number(nav.speedKmh||0),
    category:nav.category||null,
    doorwayKind:nav.doorwayKind||null,
    buildingId:nav.buildingId||null
  }));
  if(nav.doorwayKind==="exterior-door")state.doorCrossings++;
  if(samePoint(state.position,state.target)){
    state.status="arrived";
    state.lastReason="target-reached";
  }
  return true;
}
function advanceState(seed,state,activity,seconds){
  ensureTarget(seed,state,activity);
  let remaining=Math.max(0,Number(seconds)||0);
  let changed=false;
  while(remaining>1e-9&&state.status==="moving"){
    let next=state.route?.path?.[state.routeIndex+1]||null;
    if(!next){
      if(samePoint(state.position,state.target)){
        state.status="arrived";
        state.presentationOffset=Object.freeze({x:0,y:0});
        break;
      }
      if(!plan(seed,state,state.activity,"invalid-next-segment"))break;
      next=state.route?.path?.[state.routeIndex+1]||null;
      if(!next)break;
    }
    const nav=navigation(seed,next);
    if(!nav?.walkable||manhattan(state.position,next)!==1||!Number.isFinite(nav.secondsPerTile)){
      state.blockedTraversals++;
      if(!plan(seed,state,state.activity,"invalid-next-segment"))break;
      continue;
    }
    const segmentSeconds=Math.max(FIXED_STEP_SECONDS,Number(nav.secondsPerTile));
    const need=Math.max(0,segmentSeconds-state.segmentElapsed);
    const used=Math.min(need,remaining);
    state.segmentElapsed+=used;
    remaining-=used;
    const fraction=Math.max(0,Math.min(1,state.segmentElapsed/segmentSeconds));
    const dx=Number(BigInt(next.x)-BigInt(state.position.x));
    const dy=Number(BigInt(next.y)-BigInt(state.position.y));
    state.presentationOffset=Object.freeze({x:dx*fraction,y:dy*fraction});
    if(state.segmentElapsed+1e-9>=segmentSeconds)changed=completeStep(seed,state,next,segmentSeconds)||changed;
    else if(used>0)changed=true;
  }
  return changed;
}
function advance(seed,when,realSeconds){
  if(!ensure(seed))return Object.freeze({changed:false,ticks:0});
  if(proofContext?.active)return Object.freeze({changed:false,ticks:0,proofFrozen:true});
  accumulator+=Math.max(0,Math.min(2,Number(realSeconds)||0));
  let ticks=0,changed=false;
  while(accumulator+1e-9>=FIXED_STEP_SECONDS&&ticks<MAX_ADVANCE_STEPS){
    for(const state of states.values()){
      const activity=activeActivity(seedKey,state,when);
      const before=window.ActionExecutor?.advanceActor?.({
        seed:seedKey,actorKind:"resident",actorId:state.residentId,position:state.position,activity
      },FIXED_STEP_SECONDS)||null;
      if(before?.holdsPosition){
        changed=Boolean(before.changed)||changed;
        continue;
      }
      changed=advanceState(seedKey,state,activity,FIXED_STEP_SECONDS)||changed;
      const after=window.ActionExecutor?.advanceActor?.({
        seed:seedKey,actorKind:"resident",actorId:state.residentId,position:state.position,activity
      },0)||null;
      changed=Boolean(after?.changed)||changed;
    }
    accumulator-=FIXED_STEP_SECONDS;
    ticks++;
  }
  return Object.freeze({changed,ticks,snapshot:snapshot()});
}
function stateSnapshot(state){
  if(!state)return null;
  const nav=navigation(seedKey,state.position);
  const next=state.route?.path?.[state.routeIndex+1]||null;
  const navNext=next?navigation(seedKey,next):null;
  return Object.freeze({
    residentId:state.residentId,
    position:point(state.position),
    level:state.level,
    presentationOffset:state.presentationOffset,
    target:point(state.target),
    status:state.status,
    activityState:state.activity?.state||null,
    intendedAction:state.activity?.action||null,
    actionExecution:window.ActionExecutor?.get?.("resident",state.residentId)||null,
    buildingId:nav?.buildingId||null,
    occupiesBuilding:Boolean(nav?.buildingId),
    navigationCategory:nav?.category||null,
    doorwayKind:nav?.doorwayKind||null,
    nextPosition:next?point(next):null,
    nextDoorwayKind:navNext?.doorwayKind||null,
    routeIndex:state.routeIndex,
    routeSteps:state.route?.found?state.route.stepCount:0,
    routeRequests:state.routeRequests,
    targetPlans:state.targetPlans,
    invalidSegmentReplans:state.invalidSegmentReplans,
    completedSteps:state.completedSteps,
    doorCrossings:state.doorCrossings,
    blockedTraversals:state.blockedTraversals,
    segmentElapsed:Number(state.segmentElapsed.toFixed(3)),
    segmentSeconds:Number.isFinite(navNext?.secondsPerTile)?Number(navNext.secondsPerTile.toFixed(3)):0
  });
}
function snapshot(){
  return Object.freeze({
    seed:seedKey||null,
    residentCount:states.size,
    fixedStepSeconds:FIXED_STEP_SECONDS,
    physicalClock:"real elapsed seconds",
    fantasyClockControlsTargetsOnly:true,
    cameraAuthorityRead:false,
    directPlayerControl:false,
    movementOnly:true,
    actionExecution:false,
    routePlanningPerFrame:false,
    wallClearancePolicy:"prefer-one-tile",
    wallClearancePenaltySeconds:WALL_CLEARANCE_PENALTY_SECONDS,
    wallClearancePenaltyCellCount:wallClearancePenaltyCells.size,
    proofActive:Boolean(proofContext?.active),
    residents:Object.freeze([...states.values()].map(stateSnapshot))
  });
}
function get(residentId){return stateSnapshot(states.get(String(residentId)))}
function position(residentId){return get(residentId)?.position||null}
function presentation(residentId){
  const state=states.get(String(residentId));
  return state?Object.freeze({point:point(state.position),offset:state.presentationOffset}):null;
}

function sampleTime(hour,minute=30){
  const now=GameTime.getNow();
  return Object.freeze({year:now.year,month:now.month,day:now.day,hour:Number(hour),minute:Number(minute),second:0});
}
function proofResident(seed){
  return DailyActivity.build(seed).find(resident=>resident.profession==="woodcutter")||DailyActivity.build(seed)[0]||null;
}
function proofSetup(seed,temporary=false){
  ensure(seed);
  const resident=proofResident(seed);
  if(!resident)return null;
  const interior=BuildingInteriors.get(seed,resident.homePlanId);
  const outside=point(interior?.entrance?.outdoorAccess);
  if(!outside)return null;
  const state=residentState(resident,outside);
  if(!temporary)states.set(resident.id,state);
  const ctx={
    active:true,residentId:resident.id,residentName:resident.name,homeId:resident.homePlanId,
    homeDoor:point(interior.entrance.door),outsideStart:outside,insideTarget:point(resident.homeTarget),
    outsideTarget:point(resident.workplaceTarget),sampleTime:sampleTime(2,30),phase:"outside-start",leg:"inbound",
    inboundHistory:[],outboundHistory:[],cameraIndependencePass:false,offscreenSimulationPass:false,rendererCullingPass:false
  };
  return {resident,state,ctx};
}
function proofAdvanceUntil(seed,state,activity,predicate,maxSeconds=240){
  let elapsed=0;
  while(elapsed<maxSeconds&&!predicate(state)){
    advanceState(seed,state,activity,FIXED_STEP_SECONDS);
    elapsed+=FIXED_STEP_SECONDS;
    if(state.status==="stalled")break;
  }
  return elapsed;
}
function historyPass(seed,history){
  if(!history.length)return false;
  for(let index=0;index<history.length;index++){
    const nav=navigation(seed,history[index]);
    if(!nav?.walkable)return false;
    if(index&&manhattan(history[index-1],history[index])!==1)return false;
  }
  return true;
}
function roadSpeedPass(state){
  const expected=WorldStandards.TILE_METERS/(WorldStandards.WALK_SPEED_KMH.road*1000/3600);
  const roadSegments=state.segmentLog.filter(item=>Math.abs(item.speedKmh-WorldStandards.WALK_SPEED_KMH.road)<1e-9);
  return roadSegments.length>0&&Math.abs(expected-2)<1e-9&&roadSegments.every(item=>Math.abs(item.seconds-expected)<1e-6);
}
function proofResult(seed,state,ctx){
  const allHistory=state.history;
  const inbound=ctx.inboundHistory.length?ctx.inboundHistory:allHistory;
  const outbound=ctx.outboundHistory;
  const insideNav=navigation(seed,ctx.insideTarget);
  const finalNav=navigation(seed,state.position);
  const wallClearanceViolationCount=allHistory.reduce((count,item)=>{
    const nav=navigation(seed,item);
    return count+(wallClearancePenalty(seed,{point:item,state:nav})>0?1:0);
  },0);
  return Object.freeze({
    residentId:ctx.residentId,residentName:ctx.residentName,homeId:ctx.homeId,stage:ctx.phase,leg:ctx.leg,
    position:point(state.position),presentationOffset:state.presentationOffset,target:point(state.target),status:state.status,
    routeIndex:state.routeIndex,routeSteps:state.route?.found?state.route.stepCount:0,
    completedSteps:state.completedSteps,doorCrossings:state.doorCrossings,routeRequests:state.routeRequests,
    targetPlans:state.targetPlans,invalidSegmentReplans:state.invalidSegmentReplans,blockedTraversals:state.blockedTraversals,
    insideArrivalPass:Boolean(samePoint(ctx.insideTarget,ctx.insideArrival)),
    outsideArrivalPass:Boolean(samePoint(ctx.outsideTarget,ctx.outsideArrival)),
    inboundDoorPass:inbound.some(item=>samePoint(item,ctx.homeDoor)),
    outboundDoorPass:outbound.some(item=>samePoint(item,ctx.homeDoor)),
    walkabilityPass:historyPass(seed,allHistory),
    adjacencyPass:allHistory.slice(1).every((item,index)=>manhattan(allHistory[index],item)===1),
    interiorTargetPass:Boolean(insideNav?.walkable&&insideNav.category===Walkability.CATEGORY.INTERIOR),
    finalTargetPass:Boolean(ctx.outsideArrival&&samePoint(ctx.outsideArrival,ctx.outsideTarget)&&finalNav?.walkable),
    roadSpeedPass:roadSpeedPass(state),wallClearancePass:wallClearanceViolationCount===0,
    wallClearanceViolationCount,wallClearancePenaltySeconds:WALL_CLEARANCE_PENALTY_SECONDS,
    physicalSpeedIndependent:true,routePlanningPerFrame:false,noTeleport:true,
    noDirectPlayerControl:true,cameraIndependencePass:Boolean(ctx.cameraIndependencePass),
    offscreenSimulationPass:Boolean(ctx.offscreenSimulationPass),rendererCullingPass:Boolean(ctx.rendererCullingPass),
    actionExecutionIntroduced:false,dialogueEconomyCombatIntroduced:false,
    deterministicKey:allHistory.map(key).join("|")
  });
}
function executeProof(seed){
  const setup=proofSetup(seed,true);
  if(!setup)return null;
  const {resident,state,ctx}=setup;
  const inbound=DailyActivity.resolveActionTarget(seed,resident,ctx.sampleTime);
  ensureTarget(seed,state,inbound);
  proofAdvanceUntil(seed,state,inbound,s=>s.status==="arrived");
  ctx.insideArrival=point(state.position);
  ctx.inboundHistory=state.history.slice();
  ctx.sampleTime=sampleTime(10,30);
  ctx.leg="outbound";
  const outbound=DailyActivity.resolveActionTarget(seed,resident,ctx.sampleTime);
  ensureTarget(seed,state,outbound);
  const outboundStart=state.history.length-1;
  proofAdvanceUntil(seed,state,outbound,s=>s.status==="arrived");
  ctx.outsideArrival=point(state.position);
  ctx.outboundHistory=state.history.slice(outboundStart);
  ctx.phase="outside-arrived";
  ctx.cameraIndependencePass=true;ctx.offscreenSimulationPass=true;ctx.rendererCullingPass=true;
  return proofResult(seed,state,ctx);
}
function runProof(seed){
  const first=executeProof(seed),second=executeProof(seed);
  if(!first||!second)return Object.freeze({pass:false,reason:"proof-setup-unavailable"});
  const deterministic=first.deterministicKey===second.deterministicKey;
  const pass=
    first.insideArrivalPass&&first.outsideArrivalPass&&first.inboundDoorPass&&first.outboundDoorPass&&
    first.walkabilityPass&&first.adjacencyPass&&first.interiorTargetPass&&first.finalTargetPass&&first.roadSpeedPass&&
    first.wallClearancePass&&first.blockedTraversals===0&&first.invalidSegmentReplans===0&&first.routeRequests===2&&deterministic;
  return Object.freeze({...first,deterministic,pass});
}
function verify(seed){
  const k=String(seed);
  if(!proofCache.has(k))proofCache.set(k,runProof(k));
  return proofCache.get(k);
}
function beginProof(seed){
  reset(seed);
  const setup=proofSetup(seed,false);
  if(!setup)return null;
  proofContext=setup.ctx;
  const activity=DailyActivity.resolveActionTarget(seed,setup.resident,proofContext.sampleTime);
  ensureTarget(seedKey,setup.state,activity);
  return proofSnapshot();
}
function proofAdvanceToDoor(){
  const state=states.get(proofContext?.residentId),resident=residentById.get(proofContext?.residentId);
  if(!state||!resident)return null;
  const activity=DailyActivity.resolveActionTarget(seedKey,resident,proofContext.sampleTime);
  proofAdvanceUntil(seedKey,state,activity,s=>samePoint(s.position,proofContext.homeDoor));
  proofContext.phase=proofContext.leg==="inbound"?"door-entering":"door-leaving";
  return proofSnapshot();
}
function proofAdvanceToTarget(){
  const state=states.get(proofContext?.residentId),resident=residentById.get(proofContext?.residentId);
  if(!state||!resident)return null;
  const activity=DailyActivity.resolveActionTarget(seedKey,resident,proofContext.sampleTime);
  proofAdvanceUntil(seedKey,state,activity,s=>s.status==="arrived");
  if(proofContext.leg==="inbound"){
    proofContext.insideArrival=point(state.position);
    proofContext.inboundHistory=state.history.slice();
    proofContext.phase="inside-arrived";
  }else{
    proofContext.outsideArrival=point(state.position);
    proofContext.phase="outside-arrived";
  }
  return proofSnapshot();
}
function proofBeginOutbound(){
  const state=states.get(proofContext?.residentId),resident=residentById.get(proofContext?.residentId);
  if(!state||!resident)return null;
  proofContext.sampleTime=sampleTime(10,30);
  proofContext.leg="outbound";
  proofContext.phase="outbound-planned";
  proofContext.outboundStartIndex=state.history.length-1;
  const activity=DailyActivity.resolveActionTarget(seedKey,resident,proofContext.sampleTime);
  ensureTarget(seedKey,state,activity);
  return proofSnapshot();
}
function proofAdvanceSeconds(seconds){
  const state=states.get(proofContext?.residentId),resident=residentById.get(proofContext?.residentId);
  if(!state||!resident)return null;
  const activity=DailyActivity.resolveActionTarget(seedKey,resident,proofContext.sampleTime);
  let remaining=Math.max(0,Number(seconds)||0);
  while(remaining>1e-9&&state.status==="moving"){
    const step=Math.min(FIXED_STEP_SECONDS,remaining);
    advanceState(seedKey,state,activity,step);
    remaining-=step;
  }
  return proofSnapshot();
}
function proofPlaceAt(value,phase="proof-position"){
  const state=states.get(proofContext?.residentId);
  if(!state||!value)return null;
  const candidate=point(value);
  const nav=navigation(seedKey,candidate);
  if(!nav?.walkable||nav.buildingId)return null;
  state.position=candidate;
  state.route=null;
  state.routeIndex=0;
  state.segmentElapsed=0;
  state.presentationOffset=Object.freeze({x:0,y:0});
  state.status="idle";
  state.lastReason="proof-position";
  proofContext.phase=String(phase||"proof-position");
  return proofSnapshot();
}
function recordEvidence(values){
  if(!proofContext)return null;
  if(values&&"cameraIndependencePass" in values)proofContext.cameraIndependencePass=Boolean(values.cameraIndependencePass);
  if(values&&"offscreenSimulationPass" in values)proofContext.offscreenSimulationPass=Boolean(values.offscreenSimulationPass);
  if(values&&"rendererCullingPass" in values)proofContext.rendererCullingPass=Boolean(values.rendererCullingPass);
  return proofSnapshot();
}
function proofSnapshot(){
  if(!proofContext)return null;
  const state=states.get(proofContext.residentId);
  if(!state)return null;
  if(proofContext.leg==="outbound"&&proofContext.outboundStartIndex!=null){
    proofContext.outboundHistory=state.history.slice(proofContext.outboundStartIndex);
  }
  const result=proofResult(seedKey,state,proofContext);
  const verified=verify(seedKey);
  const pass=
    proofContext.phase==="outside-arrived"&&result.insideArrivalPass&&result.outsideArrivalPass&&
    result.inboundDoorPass&&result.outboundDoorPass&&result.walkabilityPass&&result.adjacencyPass&&
    result.interiorTargetPass&&result.finalTargetPass&&result.roadSpeedPass&&result.wallClearancePass&&result.blockedTraversals===0&&
    result.invalidSegmentReplans===0&&result.routeRequests===2&&result.cameraIndependencePass&&
    result.offscreenSimulationPass&&result.rendererCullingPass&&verified?.pass===true;
  return Object.freeze({...result,deterministic:Boolean(verified?.deterministic),verifiedPass:Boolean(verified?.pass),pass});
}
function endProof(){proofContext=null;return snapshot()}

window.ResidentMovement=Object.freeze({
  FIXED_STEP_SECONDS,WALL_CLEARANCE_PENALTY_SECONDS,ensure,reset,advance,snapshot,get,position,presentation,verify,
  beginProof,proofAdvanceToDoor,proofAdvanceToTarget,proofBeginOutbound,proofAdvanceSeconds,proofPlaceAt,
  recordEvidence,proofSnapshot,endProof
});
})();