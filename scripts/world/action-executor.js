(function(){
"use strict";

const ACTOR_KINDS=Object.freeze(["resident","protagonist"]);
const ACTIONS=Object.freeze({
  sleep:Object.freeze({label:"Sleeping",durationSeconds:6}),
  rest:Object.freeze({label:"Resting",durationSeconds:4}),
  sit:Object.freeze({label:"Sitting",durationSeconds:4}),
  eat:Object.freeze({label:"Eating",durationSeconds:4}),
  work:Object.freeze({label:"Working",durationSeconds:6}),
  service:Object.freeze({label:"Serving",durationSeconds:5}),
  craft:Object.freeze({label:"Crafting",durationSeconds:6}),
  store:Object.freeze({label:"Storing",durationSeconds:3}),
  retrieve:Object.freeze({label:"Retrieving",durationSeconds:3}),
  social:Object.freeze({label:"Socializing",durationSeconds:5}),
  warm:Object.freeze({label:"Warming",durationSeconds:4}),
  cook:Object.freeze({label:"Cooking",durationSeconds:5})
});
const states=new Map();
const verificationCache=new Map();
let sequence=0;
let proofContext=null;

function actorKey(kind,id){return String(kind)+":"+String(id)}
function point(value){
  if(!value)return null;
  const p=WorldCoordinates.position(String(value.x),String(value.y));
  return Object.freeze({x:p.x,y:p.y,level:0});
}
function samePoint(a,b){return !!a&&!!b&&String(a.x)===String(b.x)&&String(a.y)===String(b.y)}
function activityAction(activity){return String(activity?.intendedAction||activity?.action||"")}
function contractKey(activity){
  const target=point(activity?.target);
  return activity&&target
    ?[activityAction(activity),target.x,target.y,String(activity.interactionObjectId||""),String(activity.targetSource||"")].join("|")
    :"";
}
function objectFor(seed,activity){
  const id=String(activity?.interactionObjectId||"");
  return id?(InteriorObjects.build(seed).find(object=>object.id===id)||null):null;
}
function compatible(seed,position,activity){
  const action=activityAction(activity);
  const target=point(activity?.target);
  const actorPosition=point(position);
  if(!ACTIONS[action])return Object.freeze({ok:false,reason:"unsupported-action",action,target});
  if(!target||!actorPosition||!samePoint(actorPosition,target)){
    return Object.freeze({ok:false,reason:"not-arrived",action,target});
  }
  const nav=InteriorObjects.classifyNavigation(seed,target.x,target.y);
  if(!nav?.walkable)return Object.freeze({ok:false,reason:"target-not-walkable",action,target});
  if(activity?.targetSource==="interior-interaction"){
    const object=objectFor(seed,activity);
    const interactionPass=Boolean(
      object&&object.actions?.includes(action)&&
      object.interactionPositions?.some(item=>samePoint(item,target))&&
      (!activity.buildingId||String(activity.buildingId)===String(object.buildingId))
    );
    return Object.freeze({
      ok:interactionPass,
      reason:interactionPass?"compatible":"incompatible-interaction",
      action,target,
      interactionObjectId:object?.id||null,
      interactionObjectType:object?.type||null,
      buildingId:object?.buildingId||null
    });
  }
  if(activity?.targetSource==="outdoor-worksite"){
    const lot=SpecialLots.build(seed).find(item=>item.id===String(activity.buildingId||""))||null;
    const x=Number(target.x),y=Number(target.y);
    const inside=Boolean(lot&&!lot.enterable&&x>=lot.bounds.minX&&x<=lot.bounds.maxX&&y>=lot.bounds.minY&&y<=lot.bounds.maxY);
    const pass=action==="work"&&inside&&(!activity.supportedActions||activity.supportedActions.includes("work"));
    return Object.freeze({
      ok:pass,reason:pass?"compatible":"incompatible-worksite",action,target,
      interactionObjectId:null,interactionObjectType:"worksite",buildingId:lot?.id||null
    });
  }
  return Object.freeze({ok:false,reason:"unsupported-target-source",action,target});
}
function snapshotState(state){
  if(!state)return null;
  return Object.freeze({
    actorKind:state.actorKind,actorId:state.actorId,action:state.action,label:state.label,
    status:state.status,target:state.target,targetSource:state.targetSource,
    interactionObjectId:state.interactionObjectId,interactionObjectType:state.interactionObjectType,
    buildingId:state.buildingId,elapsedSeconds:Number(state.elapsedSeconds.toFixed(3)),
    durationSeconds:state.durationSeconds,progress:Number(Math.min(1,state.elapsedSeconds/state.durationSeconds).toFixed(3)),
    startedSequence:state.startedSequence,completedSequence:state.completedSequence,
    holdsPosition:state.status==="active"||state.status==="complete",
    authoritative:true,presentationAuthority:false
  });
}
function advanceOn(map,request,seconds){
  const kind=String(request?.actorKind||"");
  const id=String(request?.actorId||"");
  const mapKey=actorKey(kind,id);
  const activity=request?.activity||null;
  const nextContract=contractKey(activity);
  let current=map.get(mapKey)||null;
  let changed=false;
  if(!ACTOR_KINDS.includes(kind)||!id){
    return Object.freeze({status:"rejected",reason:"unsupported-actor-kind",holdsPosition:false,changed:false,state:null});
  }
  if(!activity||!nextContract){
    if(current){map.delete(mapKey);changed=true}
    return Object.freeze({status:"idle",reason:"no-action",holdsPosition:false,changed,state:null});
  }
  if(current&&current.contractKey!==nextContract){
    map.delete(mapKey);current=null;changed=true;
  }
  const check=compatible(String(request.seed),request.position,activity);
  if(!check.ok){
    return Object.freeze({status:check.reason==="not-arrived"?"waiting-arrival":"rejected",reason:check.reason,holdsPosition:false,changed,state:null});
  }
  const definition=ACTIONS[check.action];
  if(!current){
    current={
      actorKind:kind,actorId:id,contractKey:nextContract,action:check.action,label:definition.label,
      status:"active",target:check.target,targetSource:String(activity.targetSource||""),
      interactionObjectId:check.interactionObjectId||null,interactionObjectType:check.interactionObjectType||null,
      buildingId:check.buildingId||String(activity.buildingId||"")||null,
      elapsedSeconds:0,durationSeconds:definition.durationSeconds,
      startedSequence:++sequence,completedSequence:null
    };
    map.set(mapKey,current);changed=true;
  }
  if(current.status==="active"){
    const before=current.elapsedSeconds;
    current.elapsedSeconds=Math.min(current.durationSeconds,current.elapsedSeconds+Math.max(0,Number(seconds)||0));
    if(current.elapsedSeconds!==before)changed=true;
    if(current.elapsedSeconds+1e-9>=current.durationSeconds){
      current.status="complete";
      current.completedSequence=++sequence;
      changed=true;
    }
  }
  const state=snapshotState(current);
  return Object.freeze({status:state.status,reason:"compatible",holdsPosition:state.holdsPosition,changed,state});
}
function advanceActor(request,seconds=0){return advanceOn(states,request,seconds)}
function get(kind,id){return snapshotState(states.get(actorKey(kind,id)))}
function clear(kind,id){return states.delete(actorKey(kind,id))}
function clearKind(kind){
  const prefix=String(kind)+":";
  let count=0;
  for(const key of [...states.keys()])if(key.startsWith(prefix)){states.delete(key);count++}
  return count;
}
function snapshot(){
  return Object.freeze({
    stateCount:states.size,
    supportedActorKinds:ACTOR_KINDS,
    supportedActions:Object.freeze(Object.keys(ACTIONS)),
    rendererDependency:false,
    presentationAuthority:false,
    economy:false,combat:false,inventory:false,craftingOutcome:false,externalLlm:false,
    actions:Object.freeze([...states.values()].map(snapshotState))
  });
}
function activityForObject(object,action){
  const target=object?.interactionPositions?.[0];
  if(!object||!target)return null;
  return Object.freeze({
    state:"proof-"+action,action,intendedAction:action,label:"Proof "+action,
    target:point(target),buildingId:object.buildingId,targetSource:"interior-interaction",
    interactionObjectId:object.id,interactionObjectType:object.type,
    supportedActions:Object.freeze([...(object.actions||[])])
  });
}
function targetForAction(seed,action){
  const object=InteriorObjects.build(seed).find(item=>item.actions?.includes(action)&&item.interactionPositions?.length)||null;
  return activityForObject(object,action);
}
function simulateRequired(seed){
  const result={};
  for(const action of ["sleep","rest","sit","eat","work"]){
    const activity=targetForAction(seed,action);
    const map=new Map();
    if(!activity){result[action]=Object.freeze({start:false,complete:false});continue}
    const start=advanceOn(map,{seed,actorKind:"resident",actorId:"proof-"+action,position:activity.target,activity},0);
    const done=advanceOn(map,{seed,actorKind:"resident",actorId:"proof-"+action,position:activity.target,activity},ACTIONS[action].durationSeconds+0.1);
    result[action]=Object.freeze({start:start.status==="active",complete:done.status==="complete",target:activity.target});
  }
  return Object.freeze(result);
}
function verifyFresh(seed){
  const required=simulateRequired(seed);
  const requiredActionPass=Object.values(required).every(item=>item.start&&item.complete);
  const eat=targetForAction(seed,"eat");
  const bed=targetForAction(seed,"sleep");
  const invalidActivity=bed?Object.freeze({...bed,action:"work",intendedAction:"work",supportedActions:Object.freeze(["sleep","rest"])}):null;
  const invalid=invalidActivity
    ?advanceOn(new Map(),{seed,actorKind:"resident",actorId:"invalid",position:invalidActivity.target,activity:invalidActivity},0)
    :null;
  const offTarget=eat?WorldCoordinates.add(eat.target,"1","0"):null;
  const outOfRange=eat
    ?advanceOn(new Map(),{seed,actorKind:"resident",actorId:"range",position:offTarget,activity:eat},0)
    :null;
  const residentContract=eat
    ?advanceOn(new Map(),{seed,actorKind:"resident",actorId:"contract",position:eat.target,activity:eat},0)
    :null;
  const protagonistContract=eat
    ?advanceOn(new Map(),{seed,actorKind:"protagonist",actorId:"protagonist",position:eat.target,activity:eat},0)
    :null;
  const repeat=simulateRequired(seed);
  const deterministic=JSON.stringify(required)===JSON.stringify(repeat);
  const pass=requiredActionPass&&invalid?.status==="rejected"&&invalid?.reason==="incompatible-interaction"&&
    outOfRange?.status==="waiting-arrival"&&residentContract?.status==="active"&&protagonistContract?.status==="active"&&deterministic;
  return Object.freeze({
    pass,requiredActions:required,requiredActionPass,
    incompatibleRejected:invalid?.status==="rejected",
    outOfRangeRejected:outOfRange?.status==="waiting-arrival",
    arrivalRequired:true,genericNpcContract:residentContract?.status==="active",
    genericProtagonistContract:protagonistContract?.status==="active",
    deterministic,rendererDependency:false,presentationAuthority:false,
    economyIntroduced:false,combatIntroduced:false,fullInventoryIntroduced:false,externalLlmIntroduced:false
  });
}
function verify(seed){
  const key=String(seed);
  if(!verificationCache.has(key))verificationCache.set(key,verifyFresh(key));
  return verificationCache.get(key);
}
function beginProof(seed,residentId){
  clear("resident",residentId);
  proofContext={
    active:true,seed:String(seed),residentId:String(residentId),stage:"approach",
    arrivalRejected:false,actionStarted:false,heldAtTarget:false,actionCompleted:false,
    offscreenStatePass:false,rendererCullingPass:false,scheduleReleasePass:false,
    nextGoalRoutingPass:false,workStarted:false,cameraRoundTripPass:false
  };
  return proofSnapshot();
}
function recordProof(values){
  if(!proofContext)return null;
  Object.assign(proofContext,values||{});
  return proofSnapshot();
}
function proofSnapshot(){
  if(!proofContext)return null;
  const current=get("resident",proofContext.residentId);
  const verified=verify(proofContext.seed);
  const pass=Boolean(
    verified.pass&&proofContext.arrivalRejected&&proofContext.actionStarted&&proofContext.heldAtTarget&&
    proofContext.actionCompleted&&proofContext.offscreenStatePass&&proofContext.rendererCullingPass&&
    proofContext.scheduleReleasePass&&proofContext.nextGoalRoutingPass&&proofContext.workStarted&&
    proofContext.cameraRoundTripPass
  );
  return Object.freeze({...proofContext,current,verified,pass});
}
function endProof(){proofContext=null;return snapshot()}

window.ActionExecutor=Object.freeze({
  ACTIONS,advanceActor,get,clear,clearKind,snapshot,compatible,verify,
  beginProof,recordProof,proofSnapshot,endProof
});
})();