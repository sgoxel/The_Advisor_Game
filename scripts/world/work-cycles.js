(function(){
"use strict";

const VERSION="WP-S004-007-v1";
const PLAN_CACHE=new Map();
const MAX_STEPS=4;
const MAX_OUTDOOR_CANDIDATES=96;
let telemetry={
  resolveCount:0,planBuildCount:0,routeQueryCount:0,routeFailureCount:0,fallbackCount:0,
  transitionSamples:0,totalResolveMs:0,maxResolveMs:0,totalPlanBuildMs:0,maxPlanBuildMs:0
};

const DEFINITIONS=Object.freeze({
  farmer:Object.freeze([
    Object.freeze({id:"tools",label:"Collect farm tools",objectType:"storage",action:"retrieve",durationMinutes:8}),
    Object.freeze({id:"yard",label:"Tend the farm yard",objectType:"exterior",action:"work",durationMinutes:12}),
    Object.freeze({id:"tend",label:"Tend and sort produce",objectType:"workbench",action:"work",durationMinutes:14}),
    Object.freeze({id:"store",label:"Store farm tools",objectType:"storage",action:"store",durationMinutes:8})
  ]),
  smith:Object.freeze([
    Object.freeze({id:"fuel",label:"Fetch fuel and stock",objectType:"storage",action:"retrieve",durationMinutes:8}),
    Object.freeze({id:"forge",label:"Forge at the workbench",objectType:"workbench",action:"craft",durationMinutes:14}),
    Object.freeze({id:"cool",label:"Cool work at the workshop frontage",objectType:"exterior",action:"work",durationMinutes:10}),
    Object.freeze({id:"rack",label:"Rack finished work",objectType:"storage",action:"store",durationMinutes:8})
  ]),
  "tavern-keeper":Object.freeze([
    Object.freeze({id:"counter",label:"Serve at the counter",objectType:"counter",action:"service",durationMinutes:12}),
    Object.freeze({id:"tables",label:"Tend the tables",objectType:"table",action:"work",durationMinutes:10}),
    Object.freeze({id:"pause",label:"Brief service pause",objectType:"chair",action:"sit",durationMinutes:6}),
    Object.freeze({id:"return",label:"Return to the counter",objectType:"counter",action:"service",durationMinutes:12})
  ]),
  shopkeeper:Object.freeze([
    Object.freeze({id:"stock",label:"Retrieve shop stock",objectType:"storage",action:"retrieve",durationMinutes:8}),
    Object.freeze({id:"frontage",label:"Arrange the shop frontage",objectType:"exterior",action:"work",durationMinutes:10}),
    Object.freeze({id:"serve",label:"Serve the counter",objectType:"counter",action:"service",durationMinutes:14}),
    Object.freeze({id:"organize",label:"Organize the counter",objectType:"counter",action:"work",durationMinutes:8})
  ]),
  woodcutter:Object.freeze([
    Object.freeze({id:"select",label:"Select timber",objectType:"worksite",action:"work",durationMinutes:8}),
    Object.freeze({id:"cut",label:"Cut and split timber",objectType:"worksite",action:"work",durationMinutes:14}),
    Object.freeze({id:"stack",label:"Stack timber",objectType:"worksite",action:"work",durationMinutes:8})
  ]),
  guard:Object.freeze([
    Object.freeze({id:"observe",label:"Observe the meeting-hall approach",objectType:"exterior",action:"work",durationMinutes:12}),
    Object.freeze({id:"brief",label:"Review the watch",objectType:"table",action:"work",durationMinutes:10}),
    Object.freeze({id:"pause",label:"Observation pause",objectType:"chair",action:"sit",durationMinutes:7}),
    Object.freeze({id:"report",label:"Record watch notes",objectType:"table",action:"work",durationMinutes:10})
  ])
});

function nowMs(){return typeof performance!=="undefined"&&performance.now?performance.now():Date.now()}
function point(value){
  if(!value)return null;
  if(window.WorldCoordinates?.position){
    const p=WorldCoordinates.position(String(value.x),String(value.y));
    return Object.freeze({x:String(p.x),y:String(p.y),level:0});
  }
  return Object.freeze({x:String(value.x),y:String(value.y),level:0});
}
function pointKey(value){return value?String(value.x)+","+String(value.y):""}
function normalizeWhen(value){
  if(value==null)value=window.GameTime?.getNow?.()||null;
  if(value instanceof Date)return {year:value.getUTCFullYear(),month:value.getUTCMonth()+1,day:value.getUTCDate(),hour:value.getUTCHours(),minute:value.getUTCMinutes(),second:value.getUTCSeconds()};
  if(typeof value==="number")return normalizeWhen(new Date(value));
  if(typeof value==="string"){
    const m=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
    if(m)return {year:+m[1],month:+m[2],day:+m[3],hour:+m[4],minute:+m[5],second:+(m[6]||0)};
  }
  if(typeof value==="object"&&value.year!=null)return {year:Number(value.year),month:Number(value.month||1),day:Number(value.day||1),hour:Number(value.hour||0),minute:Number(value.minute||0),second:Number(value.second||0)};
  return null;
}
function fantasyMinute(value){
  const stamp=normalizeWhen(value);if(!stamp)return 0;
  return Math.max(0,Math.min(1439,stamp.hour*60+stamp.minute));
}
function residentObject(seed,resident,step){
  if(!resident?.workplaceId||!window.InteriorObjects?.build)return null;
  const candidates=(InteriorObjects.build(seed)||[])
    .filter(object=>String(object.buildingId)===String(resident.workplaceId)&&object.type===step.objectType&&object.actions?.includes(step.action)&&object.interactionPositions?.length)
    .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const object=candidates[0],target=object?.interactionPositions?.[0];
  if(!object||!target)return null;
  return Object.freeze({
    target:point(target),targetSource:"interior-interaction",buildingId:String(resident.workplaceId),
    interactionObjectId:String(object.id),interactionObjectType:String(object.type),
    intendedAction:step.action,action:step.action,supportedActions:Object.freeze([...(object.actions||[])])
  });
}
function exteriorTarget(seed,resident,step){
  const interior=window.BuildingInteriors?.get?.(seed,resident?.workplaceId)||null;
  const entrance=interior?.entrance||null;
  const origin=point(entrance?.outdoorAccess||entrance?.immediateOutside);
  if(!origin)return null;
  const protectedKeys=new Set([entrance?.door,entrance?.immediateOutside,entrance?.outdoorAccess].filter(Boolean).map(pointKey));
  const candidates=[];
  for(let radius=1;radius<=3;radius++)for(let oy=-radius;oy<=radius;oy++)for(let ox=-radius;ox<=radius;ox++){
    if(Math.max(Math.abs(ox),Math.abs(oy))!==radius)continue;
    const target=point({x:(BigInt(origin.x)+BigInt(ox)).toString(),y:(BigInt(origin.y)+BigInt(oy)).toString()});
    if(protectedKeys.has(pointKey(target)))continue;
    const nav=window.InteriorObjects?.classifyNavigation?InteriorObjects.classifyNavigation(seed,target.x,target.y):window.Walkability?.classify?.(seed,target.x,target.y);
    if(!nav?.walkable||nav?.buildingId)continue;
    let road=false;
    try{const local=window.StartingVillage?.local?.(seed,target.x,target.y);road=Boolean(local&&window.StartingVillage?.isRoadReserved?.(seed,local));}catch(_){}
    if(road)continue;
    const route=window.RoutePlanner?.findRoute?.(seed,origin,target)||null;
    if(!route?.found)continue;
    const score=Number(window.PRNG?.foundationUint32?.(seed,"work-cycle:frontage:"+resident.id+":"+target.x+":"+target.y)||0);
    candidates.push({target,score,routeSteps:Number(route.stepCount||0)});
  }
  candidates.sort((a,b)=>a.routeSteps-b.routeSteps||b.score-a.score||pointKey(a.target).localeCompare(pointKey(b.target)));
  const target=candidates[0]?.target||null;
  if(!target)return null;
  return Object.freeze({
    target,targetSource:"work-choreography",buildingId:String(resident.workplaceId),
    interactionObjectId:null,interactionObjectType:"workplace-frontage",
    intendedAction:step.action,action:step.action,supportedActions:Object.freeze([step.action]),
    workplaceFrontage:true
  });
}
function outdoorCandidates(seed,resident){
  const lot=(window.SpecialLots?.build?.(seed)||[]).find(item=>String(item.id)===String(resident.workplaceId))||null;
  if(!lot||lot.enterable||!lot.bounds)return [];
  const candidates=[];
  for(let y=Number(lot.bounds.minY);y<=Number(lot.bounds.maxY);y++)for(let x=Number(lot.bounds.minX);x<=Number(lot.bounds.maxX);x++){
    if(candidates.length>=MAX_OUTDOOR_CANDIDATES)break;
    const p=point({x,y});
    const nav=window.InteriorObjects?.classifyNavigation?InteriorObjects.classifyNavigation(seed,p.x,p.y):window.Walkability?.classify?.(seed,p.x,p.y);
    if(!nav?.walkable)continue;
    let road=false;
    try{
      const local=window.StartingVillage?.local?.(seed,p.x,p.y);
      road=Boolean(local&&window.StartingVillage?.isRoadReserved?.(seed,local));
    }catch(_){}
    if(road)continue;
    const score=Number(window.PRNG?.foundationUint32?.(seed,"work-cycle:outdoor:"+resident.id+":"+p.x+":"+p.y)||0);
    candidates.push({point:p,score});
  }
  candidates.sort((a,b)=>b.score-a.score||pointKey(a.point).localeCompare(pointKey(b.point)));
  return candidates.map(x=>x.point);
}
function outdoorTarget(seed,resident,step,index,candidates){
  const target=candidates[index%candidates.length];if(!target)return null;
  return Object.freeze({
    target, targetSource:"outdoor-worksite", buildingId:String(resident.workplaceId),
    interactionObjectId:null,interactionObjectType:"worksite",
    intendedAction:"work",action:"work",supportedActions:Object.freeze(["work"])
  });
}
function routePass(seed,a,b){
  if(!a||!b||!window.RoutePlanner?.findRoute)return false;
  telemetry.routeQueryCount++;
  const route=RoutePlanner.findRoute(seed,a,b);
  const pass=Boolean(route?.found);
  if(!pass)telemetry.routeFailureCount++;
  return pass;
}
function buildPlanFresh(seedValue,resident){
  const started=nowMs(),seed=String(seedValue||""),definition=DEFINITIONS[String(resident?.profession||"")]||null;
  if(!seed||!resident||!definition)return null;
  const outdoor=String(resident.profession)==="woodcutter"?outdoorCandidates(seed,resident):[];
  const steps=[];
  for(let i=0;i<definition.length&&i<MAX_STEPS;i++){
    const descriptor=definition[i];
    const target=descriptor.objectType==="worksite"
      ?outdoorTarget(seed,resident,descriptor,i,outdoor)
      :descriptor.objectType==="exterior"
        ?exteriorTarget(seed,resident,descriptor)
        :residentObject(seed,resident,descriptor);
    if(!target)continue;
    steps.push(Object.freeze({
      id:descriptor.id,label:descriptor.label,durationMinutes:descriptor.durationMinutes,
      objectType:descriptor.objectType,action:descriptor.action,target:target.target,
      targetSource:target.targetSource,buildingId:target.buildingId,
      interactionObjectId:target.interactionObjectId,interactionObjectType:target.interactionObjectType,
      supportedActions:target.supportedActions
    }));
  }
  const checkRoutes=list=>{
    const checks=[];
    for(let i=0;i<list.length;i++){
      const next=list[(i+1)%list.length];
      checks.push(Object.freeze({from:list[i].id,to:next.id,found:routePass(seed,list[i].target,next.target)}));
    }
    return checks;
  };
  let finalSteps=steps.slice(),routeChecks=checkRoutes(finalSteps),frontageFallback=false;
  // Frontage choreography is optional presentation. If a generated lot makes
  // that exterior point unreachable, preserve the authoritative interior
  // interaction cycle rather than invalidating or fabricating a route.
  if(routeChecks.some(x=>!x.found)&&finalSteps.some(step=>step.targetSource==="work-choreography")){
    finalSteps=finalSteps.filter(step=>step.targetSource!=="work-choreography");
    routeChecks=checkRoutes(finalSteps);frontageFallback=true;
  }
  const totalMinutes=finalSteps.reduce((sum,step)=>sum+Math.max(1,Number(step.durationMinutes)||1),0);
  const signature=finalSteps.map(step=>[step.id,step.action,pointKey(step.target),step.interactionObjectId||"-"].join(":")).join("|");
  const elapsed=nowMs()-started;
  telemetry.planBuildCount++;telemetry.totalPlanBuildMs+=elapsed;telemetry.maxPlanBuildMs=Math.max(telemetry.maxPlanBuildMs,elapsed);
  return Object.freeze({
    residentId:String(resident.id),profession:String(resident.profession),workplaceId:String(resident.workplaceId||""),
    steps:Object.freeze(finalSteps),routeChecks:Object.freeze(routeChecks),totalMinutes,
    valid:finalSteps.length>=3&&routeChecks.length===finalSteps.length&&routeChecks.every(x=>x.found),signature,
    visibleFrontageStepCount:finalSteps.filter(step=>step.targetSource==="work-choreography").length,
    frontageFallback,economyAuthority:false,resourceMutation:false,usesRealTargets:true
  });
}
function plan(seedValue,resident){
  const seed=String(seedValue||""),key=seed+"|"+String(resident?.id||"");
  if(!seed||!resident)return null;
  if(!PLAN_CACHE.has(key))PLAN_CACHE.set(key,buildPlanFresh(seed,resident));
  return PLAN_CACHE.get(key);
}
function workBlock(resident,minute){
  return (resident?.schedule||[]).find(block=>String(block.state||block.kind)==="work"&&Number(block.startMinute)<=minute&&minute<Number(block.endMinute))||null;
}
function phaseFor(seed,resident,planValue,minute,block){
  if(!planValue?.steps?.length||!block)return null;
  const total=Math.max(1,planValue.totalMinutes);
  const phase=Number(window.PRNG?.foundationUint32?.(seed,"work-cycle:phase:"+resident.id+":"+block.startMinute)||0)%total;
  let cursor=((minute-Number(block.startMinute)+phase)%total+total)%total;
  for(let i=0;i<planValue.steps.length;i++){
    const duration=Math.max(1,Number(planValue.steps[i].durationMinutes)||1);
    if(cursor<duration)return {index:i,elapsedMinutes:cursor,durationMinutes:duration};
    cursor-=duration;
  }
  return {index:0,elapsedMinutes:0,durationMinutes:Math.max(1,Number(planValue.steps[0].durationMinutes)||1)};
}
function resolve(seedValue,residentValue,when,baseActivity){
  const started=nowMs(),seed=String(seedValue||""),resident=(residentValue&&residentValue.id)?residentValue:(window.DailyActivity?.build?.(seed)||[]).find(item=>item.id===String(residentValue))||null;
  let base=baseActivity||null;
  if(!base&&resident)base=window.DailyActivity?.resolveActionTarget?.(seed,resident,when)||null;
  let result=base;
  if(seed&&resident&&base&&String(base.state||base.kind)==="work"){
    const p=plan(seed,resident),minute=fantasyMinute(when),block=workBlock(resident,minute),phase=phaseFor(seed,resident,p,minute,block);
    if(p?.valid&&phase){
      const step=p.steps[phase.index];
      result=Object.freeze({
        ...base,
        state:"work",kind:"work",label:String(resident.profession)+" · "+step.label,
        action:step.action,intendedAction:step.action,target:step.target,targetSource:step.targetSource,
        buildingId:step.buildingId,interactionObjectId:step.interactionObjectId,
        interactionObjectType:step.interactionObjectType,supportedActions:step.supportedActions,
        workCycle:Object.freeze({
          version:VERSION,profession:String(resident.profession),stepId:step.id,stepIndex:phase.index,
          stepCount:p.steps.length,elapsedMinutes:phase.elapsedMinutes,durationMinutes:phase.durationMinutes,
          planSignature:p.signature,workplaceId:p.workplaceId,usesRealTarget:true
        })
      });
      telemetry.transitionSamples++;
    }else telemetry.fallbackCount++;
  }else if(base&&String(base.state||base.kind)==="work")telemetry.fallbackCount++;
  const elapsed=nowMs()-started;telemetry.resolveCount++;telemetry.totalResolveMs+=elapsed;telemetry.maxResolveMs=Math.max(telemetry.maxResolveMs,elapsed);
  return result;
}
function evidenceSamples(seedValue,profession){
  const seed=String(seedValue||""),resident=(window.DailyActivity?.build?.(seed)||[]).find(item=>String(item.profession)===String(profession))||null;
  const p=resident?plan(seed,resident):null,block=resident?.schedule?.find(item=>String(item.state||item.kind)==="work")||null;
  if(!resident||!p?.valid||!block)return Object.freeze([]);
  const seen=new Set(),samples=[];
  for(let minute=Number(block.startMinute);minute<Number(block.endMinute)&&seen.size<p.steps.length;minute++){
    const phase=phaseFor(seed,resident,p,minute,block);if(!phase)continue;
    const step=p.steps[phase.index];if(seen.has(step.id))continue;seen.add(step.id);
    samples.push(Object.freeze({
      residentId:resident.id,residentName:resident.displayName||resident.name,profession:resident.profession,
      stepId:step.id,stepIndex:phase.index,label:step.label,target:step.target,targetSource:step.targetSource,
      buildingId:step.buildingId,interactionObjectId:step.interactionObjectId,interactionObjectType:step.interactionObjectType,action:step.action,
      when:Object.freeze({year:1100,month:1,day:1,hour:Math.floor(minute/60),minute:minute%60,second:0})
    }));
  }
  return Object.freeze(samples);
}
function verify(seedValue){
  const seed=String(seedValue||""),residents=window.DailyActivity?.build?.(seed)||[];
  const representatives=[];
  for(const profession of Object.keys(DEFINITIONS)){
    const resident=residents.find(item=>String(item.profession)===profession);
    if(!resident)continue;
    const first=buildPlanFresh(seed,resident),second=buildPlanFresh(seed,resident);
    const samples=evidenceSamples(seed,profession);
    representatives.push(Object.freeze({
      residentId:resident.id,profession,stepCount:first?.steps?.length||0,
      deterministic:Boolean(first&&second&&first.signature===second.signature),
      routesPass:Boolean(first?.routeChecks?.length&&first.routeChecks.every(x=>x.found)),
      realTargets:Boolean(first?.steps?.every(step=>["interior-interaction","outdoor-worksite","work-choreography"].includes(step.targetSource))),
      multiStepSamples:samples.length,planSignature:first?.signature||null
    }));
  }
  const indoor=representatives.filter(x=>x.profession!=="woodcutter"),outdoor=representatives.find(x=>x.profession==="woodcutter")||null;
  const fake=Object.freeze({...(residents[0]||{}),id:"fallback-proof",profession:"unsupported-profession"});
  const base=Object.freeze({state:"work",kind:"work",label:"Generic work",target:point({x:0,y:0}),targetSource:"outdoor-worksite",buildingId:"proof",interactionObjectId:null,interactionObjectType:"worksite",action:"work",intendedAction:"work",supportedActions:Object.freeze(["work"])});
  const fallback=resolve(seed,fake,{year:1100,month:1,day:1,hour:9,minute:0,second:0},base);
  const pass=representatives.length>=4&&representatives.every(x=>x.stepCount>=3&&x.deterministic&&x.routesPass&&x.realTargets&&x.multiStepSamples>=3)&&indoor.length>0&&Boolean(outdoor)&&fallback===base;
  return Object.freeze({
    pass,version:VERSION,representativeCount:representatives.length,representatives:Object.freeze(representatives),
    indoorProfessionCount:indoor.length,outdoorProfessionPass:Boolean(outdoor?.routesPass),
    genericFallbackPass:fallback===base,economyAuthority:false,resourceMutation:false,
    routePlanningPerFrame:false,planCacheBounded:true,maxStepsPerProfession:MAX_STEPS,
    decisionAuthority:"SEED + fantasy work-block minute",scheduleAuthority:"DailyActivity work blocks"
  });
}
function snapshot(seedValue){
  const resolves=Math.max(1,telemetry.resolveCount),plans=Math.max(1,telemetry.planBuildCount);
  return Object.freeze({
    version:VERSION,seed:String(seedValue||""),supportedProfessions:Object.freeze(Object.keys(DEFINITIONS)),
    cachedPlanCount:PLAN_CACHE.size,resolveCount:telemetry.resolveCount,planBuildCount:telemetry.planBuildCount,
    routeQueryCount:telemetry.routeQueryCount,routeFailureCount:telemetry.routeFailureCount,fallbackCount:telemetry.fallbackCount,
    transitionSamples:telemetry.transitionSamples,
    averageResolveMs:Number((telemetry.totalResolveMs/resolves).toFixed(4)),maxResolveMs:Number(telemetry.maxResolveMs.toFixed(4)),
    averagePlanBuildMs:Number((telemetry.totalPlanBuildMs/plans).toFixed(4)),maxPlanBuildMs:Number(telemetry.maxPlanBuildMs.toFixed(4)),
    exactWorkerCap:12,fullSettlementPerFrameScan:false,routePlanningPerFrame:false,economyAuthority:false,resourceMutation:false
  });
}
function clear(seedValue=null){
  if(seedValue==null)PLAN_CACHE.clear();
  else{
    const prefix=String(seedValue)+"|";
    for(const key of [...PLAN_CACHE.keys()])if(key.startsWith(prefix))PLAN_CACHE.delete(key);
  }
  telemetry={resolveCount:0,planBuildCount:0,routeQueryCount:0,routeFailureCount:0,fallbackCount:0,transitionSamples:0,totalResolveMs:0,maxResolveMs:0,totalPlanBuildMs:0,maxPlanBuildMs:0};
}
window.WorkCycles=Object.freeze({VERSION,DEFINITIONS,MAX_STEPS,plan,resolve,evidenceSamples,verify,snapshot,clear});
})();
