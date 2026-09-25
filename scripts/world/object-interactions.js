(function(){
"use strict";

const VERSION="world-object-interactions-v1";
const DEFAULT_QUERY_RADIUS_TILES=3;
const DEFAULT_PICK_RADIUS_TILES=1.25;
const MAX_RESULTS=12;
const ACTOR_KINDS=Object.freeze(["protagonist","resident"]);
const SAFE_ACTIONS=Object.freeze({
  bed:Object.freeze(["inspect","rest","sleep"]),
  chair:Object.freeze(["inspect","sit"]),
  table:Object.freeze(["inspect","eat","social","work"]),
  counter:Object.freeze(["inspect","service","social"]),
  workbench:Object.freeze(["inspect","work"]),
  hearth:Object.freeze(["inspect","warm"]),
  storage:Object.freeze(["inspect"]),
  door:Object.freeze(["inspect","enter"])
});
const ACTION_LABELS=Object.freeze({
  inspect:"Inspect",
  rest:"Rest",
  sleep:"Sleep",
  sit:"Sit",
  eat:"Eat",
  social:"Socialize",
  work:"Use / Work",
  service:"Use Counter",
  warm:"Warm Up",
  enter:"Enter"
});
const TYPE_LABELS=Object.freeze({
  bed:"Bed",
  chair:"Chair",
  table:"Table",
  counter:"Counter",
  workbench:"Workbench",
  hearth:"Hearth",
  storage:"Storage",
  door:"Door"
});
const cache=new Map();
const proofCache=new Map();
const telemetry={
  queryCalls:0,pickCalls:0,attemptCalls:0,rejectedAttempts:0,
  totalQueryMs:0,lastQueryMs:0,maxQueryMs:0,maxVisitedCells:0,
  lastCandidateCount:0,lastResultCount:0
};

function point(value){
  if(!value)return null;
  const p=WorldCoordinates.position(String(value.x),String(value.y));
  return Object.freeze({x:p.x,y:p.y,level:Number(value.level||0)});
}
function pointKey(value){
  const p=point(value);
  return p?p.x+","+p.y+","+p.level:"";
}
function absBig(v){return v<0n?-v:v}
function manhattan(a,b){
  if(!a||!b)return Infinity;
  const d=absBig(BigInt(a.x)-BigInt(b.x))+absBig(BigInt(a.y)-BigInt(b.y));
  return d>BigInt(Number.MAX_SAFE_INTEGER)?Infinity:Number(d);
}
function actionRange(action){return action==="inspect"?2:action==="enter"?1:0}
function interactionPoints(descriptor){
  const points=(descriptor.interactionPositions||[]).map(point).filter(Boolean);
  if(points.length)return points;
  return descriptor.coordinate?[point(descriptor.coordinate)]:[];
}
function nearestDistance(descriptor,actorPosition){
  const actor=point(actorPosition);
  if(!actor)return Infinity;
  return Math.min(...interactionPoints(descriptor).map(p=>manhattan(actor,p)),Infinity);
}
function nearestInteractionPoint(descriptor,actorPosition){
  const actor=point(actorPosition);
  return interactionPoints(descriptor).slice().sort((a,b)=>{
    const da=actor?manhattan(actor,a):0,db=actor?manhattan(actor,b):0;
    return da-db||BigInt(a.y)<BigInt(b.y)?-1:BigInt(a.y)>BigInt(b.y)?1:BigInt(a.x)<BigInt(b.x)?-1:1;
  })[0]||null;
}
function descriptorActions(type){
  return SAFE_ACTIONS[type]||Object.freeze(["inspect"]);
}
function objectDescriptor(object){
  return Object.freeze({
    id:String(object.id),
    type:String(object.type),
    label:TYPE_LABELS[object.type]||String(object.type),
    buildingId:String(object.buildingId||""),
    buildingLabel:String(object.buildingLabel||""),
    coordinate:point(object.coordinate),
    interactionPositions:Object.freeze((object.interactionPositions||[]).map(point).filter(Boolean)),
    actions:Object.freeze([...descriptorActions(object.type)]),
    source:"interior-object",
    activeLocal:true,
    createsResources:false
  });
}
function doorDescriptor(building){
  const door=point(building?.entrance?.door);
  if(!door)return null;
  const positions=[building.entrance?.immediateOutside,building.entrance?.immediateInside]
    .map(point).filter(Boolean);
  return Object.freeze({
    id:String(building.id)+":door",
    type:"door",
    label:(building.label?String(building.label)+" ":"")+"Door",
    buildingId:String(building.id),
    buildingLabel:String(building.label||""),
    coordinate:door,
    interactionPositions:Object.freeze(positions),
    actions:Object.freeze([...SAFE_ACTIONS.door]),
    source:"building-door",
    activeLocal:true,
    createsResources:false
  });
}
function compile(seed){
  const key=String(seed);
  const descriptors=[
    ...InteriorObjects.build(key).map(objectDescriptor),
    ...BuildingInteriors.build(key).map(doorDescriptor).filter(Boolean)
  ].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const byId=new Map(descriptors.map(item=>[item.id,item]));
  const spatial=new Map();
  const add=(p,item)=>{
    const k=pointKey(p);
    if(!spatial.has(k))spatial.set(k,[]);
    spatial.get(k).push(item);
  };
  for(const item of descriptors){
    add(item.coordinate,item);
    for(const p of item.interactionPositions)add(p,item);
  }
  for(const list of spatial.values())list.sort((a,b)=>a.id.localeCompare(b.id));
  return Object.freeze({
    seed:key,
    descriptors:Object.freeze(descriptors),
    byId,
    spatial,
    descriptorCount:descriptors.length,
    typeCount:new Set(descriptors.map(item=>item.type)).size
  });
}
function model(seed){
  const key=String(seed);
  if(!cache.has(key))cache.set(key,compile(key));
  return cache.get(key);
}
function get(seed,id){return model(seed).byId.get(String(id))||null}

function visitLocal(seed,centerValue,radiusValue){
  const center=point(centerValue);
  if(!center)return Object.freeze({items:Object.freeze([]),visitedCells:0,candidates:0});
  const radius=Math.max(0,Math.min(8,Math.floor(Number(radiusValue)||0)));
  const m=model(seed),seen=new Map();
  let visitedCells=0,candidates=0;
  const cx=BigInt(center.x),cy=BigInt(center.y);
  for(let dy=-radius;dy<=radius;dy++){
    for(let dx=-radius;dx<=radius;dx++){
      visitedCells++;
      const k=(cx+BigInt(dx)).toString()+","+(cy+BigInt(dy)).toString()+",0";
      const list=m.spatial.get(k)||[];
      candidates+=list.length;
      for(const item of list)seen.set(item.id,item);
    }
  }
  telemetry.maxVisitedCells=Math.max(telemetry.maxVisitedCells,visitedCells);
  telemetry.lastCandidateCount=candidates;
  return Object.freeze({items:Object.freeze([...seen.values()]),visitedCells,candidates});
}
function actionContext(descriptor,actorPosition,action){
  const actor=point(actorPosition),target=nearestInteractionPoint(descriptor,actor);
  const distance=target&&actor?manhattan(actor,target):Infinity;
  const range=actionRange(action);
  return Object.freeze({
    id:action,
    label:ACTION_LABELS[action]||action,
    rangeTiles:range,
    distanceTiles:distance,
    enabled:Number.isFinite(distance)&&distance<=range,
    reason:Number.isFinite(distance)&&distance<=range?"ready":"out-of-range",
    target
  });
}
function context(seed,descriptorOrId,actorPosition){
  const descriptor=typeof descriptorOrId==="string"?get(seed,descriptorOrId):descriptorOrId;
  if(!descriptor)return null;
  const actor=point(actorPosition);
  return Object.freeze({
    id:descriptor.id,
    type:descriptor.type,
    label:descriptor.label,
    buildingId:descriptor.buildingId,
    buildingLabel:descriptor.buildingLabel,
    coordinate:descriptor.coordinate,
    source:descriptor.source,
    distanceTiles:nearestDistance(descriptor,actor),
    actions:Object.freeze(descriptor.actions.map(action=>actionContext(descriptor,actor,action))),
    createsResources:false,
    authoritative:true
  });
}
function queryNearby(seed,actorPosition,options={}){
  const started=performance.now();
  telemetry.queryCalls++;
  const radius=Math.max(0,Math.min(8,Math.floor(Number(options.radiusTiles??DEFAULT_QUERY_RADIUS_TILES))));
  const maxResults=Math.max(1,Math.min(MAX_RESULTS,Math.floor(Number(options.maxResults??MAX_RESULTS))));
  const local=visitLocal(seed,actorPosition,radius);
  const rows=local.items
    .map(item=>context(seed,item,actorPosition))
    .filter(Boolean)
    .filter(row=>row.distanceTiles<=radius)
    .sort((a,b)=>a.distanceTiles-b.distanceTiles||a.id.localeCompare(b.id))
    .slice(0,maxResults);
  const elapsed=performance.now()-started;
  telemetry.lastQueryMs=elapsed;
  telemetry.totalQueryMs+=elapsed;
  telemetry.maxQueryMs=Math.max(telemetry.maxQueryMs,elapsed);
  telemetry.lastResultCount=rows.length;
  return Object.freeze(rows);
}
function pick(seed,worldPoint,actorPosition,options={}){
  const started=performance.now();
  telemetry.pickCalls++;
  const click=point(worldPoint);
  if(!click)return null;
  const radius=Math.max(0,Math.min(3,Math.ceil(Number(options.pickRadiusTiles??DEFAULT_PICK_RADIUS_TILES))));
  const local=visitLocal(seed,click,radius);
  const chosen=local.items
    .map(item=>({item,distance:manhattan(click,item.coordinate)}))
    .filter(row=>row.distance<=Number(options.pickRadiusTiles??DEFAULT_PICK_RADIUS_TILES))
    .sort((a,b)=>a.distance-b.distance||a.item.id.localeCompare(b.item.id))[0]?.item||null;
  const elapsed=performance.now()-started;
  telemetry.lastQueryMs=elapsed;
  telemetry.totalQueryMs+=elapsed;
  telemetry.maxQueryMs=Math.max(telemetry.maxQueryMs,elapsed);
  return chosen?context(seed,chosen,actorPosition):null;
}
function inspectMessage(descriptor){
  const place=descriptor.buildingLabel?descriptor.buildingLabel:"this building";
  return {
    bed:"A usable bed inside "+place+".",
    chair:"A chair positioned for sitting.",
    table:"A table with no generic resource interaction.",
    counter:"A service counter inside "+place+".",
    workbench:"A work surface; using it does not create items by itself.",
    hearth:"A hearth that can provide warmth.",
    storage:"Storage furniture; inspection never grants free resources.",
    door:"The entrance to "+place+"."
  }[descriptor.type]||"An interactable world object.";
}
function actionActivity(descriptor,action,target){
  return Object.freeze({
    state:"world-object-"+action,
    action,
    intendedAction:action,
    label:ACTION_LABELS[action]||action,
    target:point(target),
    buildingId:descriptor.buildingId,
    targetSource:"interior-interaction",
    interactionObjectId:descriptor.id,
    interactionObjectType:descriptor.type,
    supportedActions:Object.freeze(descriptor.actions.filter(item=>item!=="inspect"))
  });
}
function attempt(seed,request){
  telemetry.attemptCalls++;
  const descriptor=get(seed,request?.objectId);
  const action=String(request?.action||"");
  const actorKind=String(request?.actorKind||"");
  const actorId=String(request?.actorId||"");
  const actorPosition=point(request?.actorPosition);
  if(!ACTOR_KINDS.includes(actorKind)||!actorId){
    telemetry.rejectedAttempts++;
    return Object.freeze({ok:false,status:"rejected",reason:"unsupported-actor",authoritative:true});
  }
  if(!descriptor){
    telemetry.rejectedAttempts++;
    return Object.freeze({ok:false,status:"rejected",reason:"unknown-object",authoritative:true});
  }
  if(!descriptor.actions.includes(action)){
    telemetry.rejectedAttempts++;
    return Object.freeze({ok:false,status:"rejected",reason:"unsupported-action",objectId:descriptor.id,action,authoritative:true});
  }
  const actionState=actionContext(descriptor,actorPosition,action);
  if(!actionState.enabled){
    telemetry.rejectedAttempts++;
    return Object.freeze({
      ok:false,status:"rejected",reason:"out-of-range",objectId:descriptor.id,action,
      distanceTiles:actionState.distanceTiles,rangeTiles:actionState.rangeTiles,target:actionState.target,authoritative:true
    });
  }
  if(action==="inspect"){
    return Object.freeze({
      ok:true,status:"complete",reason:"inspected",objectId:descriptor.id,objectType:descriptor.type,
      action,message:inspectMessage(descriptor),createsResources:false,authoritative:true
    });
  }
  if(descriptor.type==="door"&&action==="enter"){
    const building=BuildingInteriors.get(seed,descriptor.buildingId);
    const destination=building?.entrance?.immediateInside||building?.interiorTarget||null;
    const route=actorPosition&&destination?RoutePlanner.findRoute(String(seed),actorPosition,destination,{maxDistanceTiles:32,maxNodes:1500}):null;
    const ok=Boolean(route?.found);
    if(!ok)telemetry.rejectedAttempts++;
    return Object.freeze({
      ok,status:ok?"ready":"rejected",reason:ok?"building-entry-ready":"building-entry-unreachable",
      objectId:descriptor.id,objectType:"door",action,buildingId:descriptor.buildingId,
      destination:point(destination),routeSteps:route?.stepCount??0,routeSeconds:route?.totalSeconds??null,
      delegatesTo:"BuildingInteriors/RoutePlanner",createsResources:false,authoritative:true
    });
  }
  if(!window.ActionExecutor?.advanceActor){
    telemetry.rejectedAttempts++;
    return Object.freeze({ok:false,status:"rejected",reason:"action-executor-unavailable",objectId:descriptor.id,action,authoritative:true});
  }
  const activity=actionActivity(descriptor,action,actionState.target);
  const result=ActionExecutor.advanceActor({
    seed:String(seed),actorKind,actorId,position:actorPosition,activity
  },0);
  const ok=result?.status==="active"||result?.status==="complete";
  if(!ok)telemetry.rejectedAttempts++;
  return Object.freeze({
    ok,status:String(result?.status||"rejected"),reason:String(result?.reason||"action-rejected"),
    objectId:descriptor.id,objectType:descriptor.type,action,target:actionState.target,
    actionState:result?.state||null,delegatesTo:"ActionExecutor",createsResources:false,authoritative:true
  });
}
function snapshot(seed=null){
  const m=seed!=null?model(seed):null;
  const total=telemetry.queryCalls+telemetry.pickCalls;
  return Object.freeze({
    version:VERSION,
    descriptorCount:m?.descriptorCount??null,
    typeCount:m?.typeCount??null,
    queryCalls:telemetry.queryCalls,
    pickCalls:telemetry.pickCalls,
    attemptCalls:telemetry.attemptCalls,
    rejectedAttempts:telemetry.rejectedAttempts,
    lastQueryMs:Number(telemetry.lastQueryMs.toFixed(4)),
    maxQueryMs:Number(telemetry.maxQueryMs.toFixed(4)),
    averageQueryMs:Number((total?telemetry.totalQueryMs/total:0).toFixed(4)),
    maxVisitedCells:telemetry.maxVisitedCells,
    lastCandidateCount:telemetry.lastCandidateCount,
    lastResultCount:telemetry.lastResultCount,
    perFrameScan:false,
    boundedLocalQuery:true,
    createsResources:false,
    rendererAuthority:false
  });
}
function proofFresh(seed){
  const first=compile(seed),second=compile(seed);
  const signature=items=>items.descriptors.map(item=>({
    id:item.id,type:item.type,coordinate:item.coordinate,interactionPositions:item.interactionPositions,actions:item.actions
  }));
  const deterministic=JSON.stringify(signature(first))===JSON.stringify(signature(second));
  const representatives=[];
  for(const type of ["bed","chair","table","counter","workbench","hearth","storage"]){
    const item=first.descriptors.find(row=>row.type===type);
    if(item)representatives.push(item);
  }
  const scenarios=representatives.slice(0,7).map((descriptor,index)=>{
    const actorPosition=descriptor.interactionPositions[0]||descriptor.coordinate;
    const inspect=attempt(seed,{actorKind:"protagonist",actorId:"proof-inspect-"+index,actorPosition,objectId:descriptor.id,action:"inspect"});
    const statefulAction=descriptor.actions.find(action=>action!=="inspect")||null;
    const stateful=statefulAction
      ?attempt(seed,{actorKind:"protagonist",actorId:"proof-action-"+index,actorPosition,objectId:descriptor.id,action:statefulAction})
      :null;
    const wrong=attempt(seed,{actorKind:"protagonist",actorId:"proof-wrong-"+index,actorPosition,objectId:descriptor.id,action:"teleport"});
    const far=WorldCoordinates.add(actorPosition,"10","0");
    const outOfRange=attempt(seed,{actorKind:"protagonist",actorId:"proof-range-"+index,actorPosition:far,objectId:descriptor.id,action:"inspect"});
    const picked=pick(seed,descriptor.coordinate,actorPosition,{pickRadiusTiles:0.1});
    return Object.freeze({
      type:descriptor.type,id:descriptor.id,
      inspectPass:inspect.ok===true&&inspect.createsResources===false,
      statefulAction,
      statefulPass:stateful?stateful.ok===true:true,
      invalidRejected:wrong.ok===false&&wrong.reason==="unsupported-action",
      outOfRangeRejected:outOfRange.ok===false&&outOfRange.reason==="out-of-range",
      clickPickPass:picked?.id===descriptor.id,
      inspect,stateful,wrong,outOfRange
    });
  });
  const door=first.descriptors.find(item=>item.type==="door")||null;
  let doorScenario=null;
  if(door){
    const actorPosition=door.interactionPositions[0]||door.coordinate;
    const enter=attempt(seed,{actorKind:"protagonist",actorId:"proof-door",actorPosition,objectId:door.id,action:"enter"});
    doorScenario=Object.freeze({id:door.id,enterPass:enter.ok===true,enter});
  }
  const typeCount=new Set(scenarios.map(item=>item.type)).size;
  const validCount=scenarios.filter(item=>item.inspectPass).length;
  const invalidCount=scenarios.filter(item=>item.invalidRejected&&item.outOfRangeRejected).length;
  const statefulCount=scenarios.filter(item=>item.statefulAction&&item.statefulPass).length;
  const clickPickCount=scenarios.filter(item=>item.clickPickPass).length;
  const nearbyProbe=representatives[0]
    ?queryNearby(seed,representatives[0].interactionPositions[0]||representatives[0].coordinate,{radiusTiles:3,maxResults:12})
    :Object.freeze([]);
  const stats=snapshot(seed);
  const pass=Boolean(
    deterministic&&
    typeCount>=6&&validCount>=6&&invalidCount>=6&&statefulCount>=5&&clickPickCount>=6&&
    doorScenario?.enterPass===true&&
    nearbyProbe.length>0&&
    stats.boundedLocalQuery===true&&stats.perFrameScan===false&&stats.createsResources===false
  );
  return Object.freeze({
    pass,version:VERSION,deterministic,
    descriptorCount:first.descriptorCount,typeCount:first.typeCount,
    representativeTypeCount:typeCount,validCount,invalidCount,statefulCount,clickPickCount,
    scenarios:Object.freeze(scenarios),doorScenario,nearbyProbeCount:nearbyProbe.length,
    stats,
    inventoryCreated:false,economyCreated:false,resourceGeneration:false,
    authoritative:true
  });
}
function proof(seed){
  const key=String(seed);
  if(!proofCache.has(key))proofCache.set(key,proofFresh(key));
  return proofCache.get(key);
}

window.ObjectInteractions=Object.freeze({
  VERSION,DEFAULT_QUERY_RADIUS_TILES,DEFAULT_PICK_RADIUS_TILES,MAX_RESULTS,
  get,context,queryNearby,pick,attempt,snapshot,proof
});
})();
