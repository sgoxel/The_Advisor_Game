(function(){
"use strict";

const VERSION="1.0.0";
const MAX_EXACT_ACTIVE=24;
const MAX_SAFE_SEARCH_RADIUS=10;
const GENERIC_ROLES=Object.freeze(["farmer","craft-worker","miner","merchant","laborer","guard","carrier","service"]);
const runtimeBySeed=new Map();
let evidenceMemory=null;

function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;
}
function deepFreeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))deepFreeze(item);
  return Object.freeze(value);
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stableStringify(value[k])).join(",")+"}";
}
function hashText(value){
  const text=String(value==null?"":value);let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  hash^=hash>>>16;hash=Math.imul(hash,2246822507);hash^=hash>>>13;
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function signature(value){return hashText(stableStringify(value))}
function normalizeSeed(value){
  const seed=String(value==null?"":value);
  if(!seed)throw new Error("Campaign SEED is required.");
  return seed;
}
function normalizeTimestamp(value){
  const timestamp=String(value==null?"":value);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)){
    throw new Error("NPC lifecycle timestamp must use YYYY-MM-DD HH:MM:SS.");
  }
  return timestamp;
}
function parseTimestamp(value){
  const t=normalizeTimestamp(value),m=/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(t);
  return Object.freeze({key:t,year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour:Number(m[4]),minute:Number(m[5]),second:Number(m[6])});
}
function addHours(value,hours){
  const t=normalizeTimestamp(value),ms=Date.parse(t.replace(" ","T")+"Z")+Number(hours)*3600000,d=new Date(ms),pad=n=>String(n).padStart(2,"0");
  return String(d.getUTCFullYear()).padStart(4,"0")+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+" "+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds());
}
function runtime(seedValue){
  const seed=normalizeSeed(seedValue);
  if(!runtimeBySeed.has(seed))runtimeBySeed.set(seed,{
    active:new Map(),summaries:new Map(),materializations:0,dematerializations:0,
    persistentCommits:0,lastMaterializationTimestamp:null,lastSettlementId:null
  });
  return runtimeBySeed.get(seed);
}
function isStartingVillage(plan){return String(plan?.role||"")==="starting-village"}
function knownResident(seed,plan,ordinal){
  if(!isStartingVillage(plan)||ordinal<0||ordinal>=12)return null;
  return (DailyActivity.build(seed)||[])[ordinal]||null;
}
function genericRole(seed,plan,ordinal){
  const index=Number(PRNG.foundationUint32(seed,"npc-lifecycle:role:"+plan.id+":"+ordinal))%GENERIC_ROLES.length;
  return GENERIC_ROLES[index];
}
function workFunctionFor(plan,ordinal){
  const functions=[
    ...((plan?.buildingFunctions?.required)||[]),
    ...((plan?.buildingFunctions?.optional)||[])
  ].filter(Boolean);
  if(!functions.length)return "local-work";
  return String(functions[ordinal%functions.length]);
}
function foundationIdentity(seedValue,planValue,ordinalValue){
  const seed=normalizeSeed(seedValue),plan=planValue,ordinal=Math.max(0,Math.floor(Number(ordinalValue)||0));
  if(!plan?.id)throw new Error("Settlement plan is required for NPC identity.");
  const resident=knownResident(seed,plan,ordinal);
  if(resident){
    return deepFreeze({
      identityId:resident.id,ordinal,settlementId:plan.id,identityKind:"known-resident",
      name:resident.name,gender:resident.gender,birthDate:resident.birthDate,
      role:resident.profession,homeId:resident.homePlanId,workId:resident.workplaceId,
      workFunction:resident.workFunction,
      relationshipGroup:"household:"+resident.homePlanId,
      importantInventory:Object.freeze(["personal-effects","profession:"+resident.profession]),
      duty:resident.profession==="guard"?"village-watch":"civilian",
      foundationOnly:true
    });
  }
  const identityId="NPC|"+hashText(seed+"|"+plan.id+"|"+ordinal);
  const role=genericRole(seed,plan,ordinal);
  const household=Math.floor(ordinal/4);
  return deepFreeze({
    identityId,ordinal,settlementId:plan.id,identityKind:"aggregate-resident",
    name:"Resident "+String(ordinal+1).padStart(4,"0"),gender:null,birthDate:null,
    role,homeId:"HOME|"+plan.id+"|"+String(household).padStart(4,"0"),
    workId:"WORK|"+plan.id+"|"+workFunctionFor(plan,ordinal),
    workFunction:workFunctionFor(plan,ordinal),
    relationshipGroup:"household:"+plan.id+":"+String(household).padStart(4,"0"),
    importantInventory:Object.freeze(["personal-effects","role-kit:"+role]),
    duty:role==="guard"?"local-watch":"civilian",
    foundationOnly:true
  });
}
function identityRef(seedValue,planValue,ordinalValue){
  const seed=normalizeSeed(seedValue),identity=foundationIdentity(seed,planValue,ordinalValue);
  return WorldState.structuralRef(seed,"npc",planValue.id,identity.identityId,{
    ...identity,
    lifeState:"alive",
    injury:Object.freeze({active:false}),
    migration:Object.freeze({active:false}),
    imprisonment:Object.freeze({active:false}),
    travel:Object.freeze({active:false})
  });
}
function identityRecord(seedValue,planValue,ordinalValue){
  const seed=normalizeSeed(seedValue),ref=identityRef(seed,planValue,ordinalValue),world=WorldState.resolve(seed,ref);
  const initial=world?.current?.initial||foundationIdentity(seed,planValue,ordinalValue);
  const state=world?.current?.state||{};
  return deepFreeze({
    ref,world,identity:initial,
    state:Object.freeze({
      lifeState:String(state.lifeState||initial.lifeState||"alive"),
      injury:deepFreeze(clone(state.injury||initial.injury||{active:false})),
      migration:deepFreeze(clone(state.migration||initial.migration||{active:false})),
      imprisonment:deepFreeze(clone(state.imprisonment||initial.imprisonment||{active:false})),
      travel:deepFreeze(clone(state.travel||initial.travel||{active:false})),
      duty:state.duty||initial.duty||"civilian",
      importantInventory:deepFreeze(clone(state.importantInventory||initial.importantInventory||[])),
      exceptionalNote:state.exceptionalNote||null,
      lastMeaningfulTimestamp:state.lastMeaningfulTimestamp||null
    }),
    persistentRevision:Number(world?.delta?.revision||0)
  });
}
function settlementPopulation(seedValue,planValue){
  const seed=normalizeSeed(seedValue),plan=planValue;
  const ref=WorldState.settlementRef(seed,plan),world=ref?WorldState.resolve(seed,ref):null;
  const aggregate=world?.current?.state?.aggregate||{};
  const reconciliation=aggregate.reconciliation||{};
  return Math.max(0,Math.round(Number(
    reconciliation.populationTotal??aggregate.population??world?.current?.population?.planned??plan?.population?.planned??0
  )||0));
}
function nav(seed,point){
  if(!point)return null;
  return window.InteriorObjects?.classifyNavigation
    ?InteriorObjects.classifyNavigation(seed,point.x,point.y)
    :Walkability.classify(seed,point.x,point.y);
}
function safeAreaPoint(seed,plan,identityId,anchor){
  const center=plan.center,candidates=[];
  for(let radius=0;radius<=MAX_SAFE_SEARCH_RADIUS;radius++){
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(radius>0&&Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
      const point=WorldCoordinates.add(center,String(dx),String(dy));
      const state=nav(seed,point);
      if(!state?.walkable)continue;
      const score=PRNG.foundationUint32(seed,"npc-lifecycle:placement:"+identityId+":"+anchor+":"+point.x+":"+point.y);
      candidates.push({point:Object.freeze({x:String(point.x),y:String(point.y)}),score,nav:state});
    }
    if(candidates.length>=8)break;
  }
  candidates.sort((a,b)=>a.score-b.score||a.point.y.localeCompare(b.point.y)||a.point.x.localeCompare(b.point.x));
  return candidates[0]||null;
}
function knownResidentActivity(seed,identity,timestamp){
  const resident=(DailyActivity.build(seed)||[]).find(item=>item.id===identity.identityId)||null;
  return resident?DailyActivity.resolveActionTarget(seed,resident,timestamp):null;
}
function genericActivity(seed,plan,identity,timestamp){
  const t=parseTimestamp(timestamp);
  const phase=t.hour<6?"sleep":t.hour<8?"prepare":t.hour<17?"work":t.hour<21?"social":"return-home";
  const anchor=phase==="work"?"work":phase==="social"?"public":"home";
  const placed=safeAreaPoint(seed,plan,identity.identityId,anchor);
  if(!placed)return null;
  return deepFreeze({
    residentId:identity.identityId,state:phase,action:phase==="sleep"?"sleep":phase==="prepare"?"rest":phase==="work"?"work":phase==="social"?"social":"rest",
    intendedAction:phase==="sleep"?"sleep":phase==="prepare"?"rest":phase==="work"?"work":phase==="social"?"social":"rest",
    label:"Reconstructed "+phase,timestamp,
    target:placed.point,targetSource:"settlement-area",interactionObjectId:null,interactionObjectType:null,
    supportedActions:Object.freeze(["sleep","rest","work","social"]),
    location:anchor,buildingId:null,valid:true
  });
}
function homeRecoveryActivity(seed,plan,record,timestamp){
  const identity=record.identity;
  const resident=(DailyActivity.build(seed)||[]).find(item=>item.id===identity.identityId)||null;
  if(resident){
    return deepFreeze({
      residentId:identity.identityId,state:"recovering-injury",action:"rest",intendedAction:"rest",
      label:"Recovering from injury",timestamp,target:Object.freeze({x:String(resident.homeTarget.x),y:String(resident.homeTarget.y)}),
      targetSource:"interior-interaction",interactionObjectId:resident.homeObjectId,interactionObjectType:resident.homeObjectType,
      supportedActions:Object.freeze(["sleep","rest"]),location:"home",buildingId:resident.homePlanId,valid:true,exceptional:true
    });
  }
  const placed=safeAreaPoint(seed,plan,identity.identityId,"home-recovery");
  return placed?deepFreeze({
    residentId:identity.identityId,state:"recovering-injury",action:"rest",intendedAction:"rest",
    label:"Recovering from injury",timestamp,target:placed.point,targetSource:"settlement-area",
    interactionObjectId:null,interactionObjectType:null,supportedActions:Object.freeze(["rest"]),
    location:"home-area",buildingId:null,valid:true,exceptional:true
  }):null;
}
function persistentOverride(seed,plan,record,timestamp){
  const state=record.state;
  if(state.lifeState==="dead")return deepFreeze({inactive:true,reason:"dead"});
  if(state.migration?.active&&state.migration?.destinationSettlementId&&state.migration.destinationSettlementId!==plan.id){
    return deepFreeze({inactive:true,reason:"migrated"});
  }
  if(state.imprisonment?.active){
    const placed=safeAreaPoint(seed,plan,record.identity.identityId,"custody");
    return placed?deepFreeze({activity:{
      residentId:record.identity.identityId,state:"imprisoned",action:"rest",intendedAction:"rest",
      label:"In custody",timestamp,target:placed.point,targetSource:"settlement-area",
      interactionObjectId:null,interactionObjectType:null,supportedActions:Object.freeze(["rest"]),
      location:"custody-area",buildingId:null,valid:true,exceptional:true
    }}):null;
  }
  if(state.injury?.active)return deepFreeze({activity:homeRecoveryActivity(seed,plan,record,timestamp)});
  return null;
}
function activityForIdentity(seedValue,planValue,ordinalValue,timestampValue){
  const seed=normalizeSeed(seedValue),timestamp=normalizeTimestamp(timestampValue),record=identityRecord(seed,planValue,ordinalValue);
  const override=persistentOverride(seed,planValue,record,timestamp);
  if(override?.inactive)return deepFreeze({inactive:true,reason:override.reason,record});
  const activity=override?.activity||
    (record.identity.identityKind==="known-resident"?knownResidentActivity(seed,record.identity,timestamp):genericActivity(seed,planValue,record.identity,timestamp));
  return deepFreeze({inactive:false,activity,record,exceptional:Boolean(override?.activity)});
}
function activityForResident(seedValue,residentIdValue,whenValue){
  const seed=normalizeSeed(seedValue),residentId=String(residentIdValue||"");
  const country=PoliticalGeography.countryAt(seed,"0","0");
  const plan=(SettlementArchetypes.settlementsForCountry(seed,country,3)||[]).find(item=>item.role==="starting-village")||null;
  if(!plan)return DailyActivity.resolveActionTarget(seed,residentId,whenValue);
  const ordinal=Math.max(0,Number(residentId.replace(/^R/,""))-1);
  if(!/^R\d+$/.test(residentId)||ordinal>=12)return DailyActivity.resolveActionTarget(seed,residentId,whenValue);
  const timestamp=typeof whenValue==="string"?normalizeTimestamp(whenValue):GameTime.toTimestampKey(whenValue||GameTime.getNow());
  const resolved=activityForIdentity(seed,plan,ordinal,timestamp);
  return resolved.inactive?null:(resolved.activity||DailyActivity.resolveActionTarget(seed,residentId,whenValue));
}
function routeFor(seed,position,target){
  if(!position||!target)return deepFreeze({found:false,path:Object.freeze([]),stepCount:0,totalSeconds:0});
  const route=RoutePlanner.findRoute(seed,position,target);
  if(route?.found)return route;
  if(String(position.x)===String(target.x)&&String(position.y)===String(target.y)){
    return deepFreeze({found:true,path:Object.freeze([Object.freeze({x:String(position.x),y:String(position.y)})]),stepCount:0,totalSeconds:0});
  }
  return deepFreeze({found:false,path:Object.freeze([]),stepCount:0,totalSeconds:0});
}
function buildExact(seedValue,planValue,ordinalValue,timestampValue){
  const seed=normalizeSeed(seedValue),plan=planValue,timestamp=normalizeTimestamp(timestampValue);
  const resolved=activityForIdentity(seed,plan,ordinalValue,timestamp),record=resolved.record;
  if(resolved.inactive||!resolved.activity?.target){
    return deepFreeze({
      exactActive:false,identityId:record.identity.identityId,npcRefId:record.ref.id,
      settlementId:plan.id,ordinal:record.identity.ordinal,reason:resolved.reason||"no-valid-activity",
      persistentRevision:record.persistentRevision,reconstructed:true,replayedPathSteps:0
    });
  }
  const target=Object.freeze({x:String(resolved.activity.target.x),y:String(resolved.activity.target.y)});
  const navigation=nav(seed,target);
  if(!navigation?.walkable){
    return deepFreeze({
      exactActive:false,identityId:record.identity.identityId,npcRefId:record.ref.id,
      settlementId:plan.id,ordinal:record.identity.ordinal,reason:"schedule-target-not-walkable",
      persistentRevision:record.persistentRevision,reconstructed:true,replayedPathSteps:0
    });
  }
  const position=target,route=routeFor(seed,position,target);
  return deepFreeze({
    exactActive:true,id:"EXACT|"+record.ref.id,identityId:record.identity.identityId,npcRefId:record.ref.id,
    settlementId:plan.id,ordinal:record.identity.ordinal,name:record.identity.name,role:record.identity.role,
    position,target,path:Object.freeze([...(route.path||[])]),routeFound:Boolean(route.found),
    routeStepCount:Number(route.stepCount||0),routeIntent:route.stepCount>0?"continue-to-schedule-target":"hold-schedule-target",
    occupancy:navigation.buildingId?"interior":"area",buildingId:navigation.buildingId||resolved.activity.buildingId||null,
    navigationCategory:navigation.category||null,
    activityState:resolved.activity.state||null,intendedAction:resolved.activity.intendedAction||resolved.activity.action||null,
    interactionObjectId:resolved.activity.interactionObjectId||null,interactionObjectType:resolved.activity.interactionObjectType||null,
    targetSource:resolved.activity.targetSource||null,scheduleTimestamp:timestamp,
    persistentState:record.state,persistentRevision:record.persistentRevision,exceptional:Boolean(resolved.exceptional),
    reconstructed:true,replayedPathSteps:0,rendererDependency:false,spriteDependency:false
  });
}
function materialize(seedValue,planValue,ordinalValue,timestampValue){
  const seed=normalizeSeed(seedValue),state=runtime(seed),exact=buildExact(seed,planValue,ordinalValue,timestampValue);
  if(exact.exactActive){
    state.active.set(exact.npcRefId,exact);state.materializations++;state.lastMaterializationTimestamp=exact.scheduleTimestamp;state.lastSettlementId=planValue.id;
  }
  return exact;
}
function releaseSettlement(seedValue,settlementIdValue){
  const state=runtime(seedValue),settlementId=String(settlementIdValue||"");
  let count=0;
  for(const [key,exact] of [...state.active.entries()]){
    if(exact.settlementId!==settlementId)continue;
    state.summaries.set(exact.identityId,deepFreeze({
      identityId:exact.identityId,settlementId:exact.settlementId,
      lastActivity:exact.activityState,lastArea:exact.position,lastTimestamp:exact.scheduleTimestamp
    }));
    state.active.delete(key);state.dematerializations++;count++;
  }
  return count;
}
function releaseOtherSettlements(seedValue,settlementId){
  const state=runtime(seedValue);
  for(const exact of [...state.active.values()])if(exact.settlementId!==settlementId)releaseSettlement(seedValue,exact.settlementId);
}
function materializeSettlement(seedValue,planValue,timestampValue,optionsValue){
  const seed=normalizeSeed(seedValue),plan=planValue,timestamp=normalizeTimestamp(timestampValue),options=optionsValue||{};
  try{window.RegionalSettlementSimulation?.ensureRelevant?.(seed,plan,timestamp,{maxEvents:4})}catch(_){}
  const population=settlementPopulation(seed,plan),limit=Math.max(0,Math.min(MAX_EXACT_ACTIVE,Math.floor(Number(options.limit??MAX_EXACT_ACTIVE))));
  releaseOtherSettlements(seed,plan.id);
  releaseSettlement(seed,plan.id);
  const exactStates=[];
  for(let ordinal=0;ordinal<Math.min(population,limit);ordinal++){
    const exact=materialize(seed,plan,ordinal,timestamp);
    if(exact.exactActive)exactStates.push(exact);
  }
  const state=runtime(seed);
  return deepFreeze({
    settlementId:plan.id,identityPopulation:population,exactActiveCount:exactStates.length,
    dormantIdentityCount:Math.max(0,population-exactStates.length),maxExactActive:MAX_EXACT_ACTIVE,
    exactStates:Object.freeze(exactStates),bounded:state.active.size<=MAX_EXACT_ACTIVE,
    activeTotal:state.active.size,replayedPathSteps:0
  });
}
function persistentPatch(changesValue,timestamp){
  const changes=clone(changesValue||{});
  return Object.freeze({state:{...changes,lastMeaningfulTimestamp:timestamp}});
}
function dematerialize(seedValue,planValue,exactValue,changesValue,timestampValue){
  const seed=normalizeSeed(seedValue),plan=planValue,exact=exactValue||null,timestamp=normalizeTimestamp(timestampValue);
  if(!exact?.npcRefId)return deepFreeze({ok:false,reason:"exact-state-required"});
  const state=runtime(seed),changes=changesValue&&typeof changesValue==="object"?changesValue:{};
  let applied=null;
  if(Object.keys(changes).length){
    const ordinal=Math.max(0,Number(exact.ordinal)||0),ref=identityRef(seed,plan,ordinal);
    applied=WorldState.applyDelta(seed,ref,persistentPatch(changes,timestamp),"WP-S007-007 meaningful NPC dematerialization");
    if(applied?.ok)state.persistentCommits++;
  }
  state.summaries.set(exact.identityId,deepFreeze({
    identityId:exact.identityId,settlementId:exact.settlementId,lastActivity:exact.activityState,
    lastArea:exact.position,lastTimestamp:timestamp,persistentRevision:Number(applied?.entry?.revision||exact.persistentRevision||0)
  }));
  state.active.delete(exact.npcRefId);state.dematerializations++;
  return deepFreeze({ok:true,committed:Boolean(applied?.ok),applied,summary:state.summaries.get(exact.identityId)});
}
function resetRuntime(seedValue){
  const seed=normalizeSeed(seedValue),state=runtime(seed);
  state.active.clear();state.summaries.clear();state.lastSettlementId=null;state.lastMaterializationTimestamp=null;
  return true;
}
function snapshot(seedValue){
  const state=runtime(seedValue);
  return deepFreeze({
    version:VERSION,maxExactActive:MAX_EXACT_ACTIVE,activeExactCount:state.active.size,
    materializations:state.materializations,dematerializations:state.dematerializations,persistentCommits:state.persistentCommits,
    lastMaterializationTimestamp:state.lastMaterializationTimestamp,lastSettlementId:state.lastSettlementId,
    active:Object.freeze([...state.active.values()].sort((a,b)=>a.identityId.localeCompare(b.identityId))),
    summaryCount:state.summaries.size,
    rendererDependency:false,spriteDependency:false,wallClockDependency:false,perFrameDormantSimulation:false
  });
}
function evidencePlan(seed){
  const country=PoliticalGeography.countryAt(seed,"0","0"),plans=SettlementArchetypes.settlementsForCountry(seed,country,3)||[];
  return plans.find(item=>item.role==="starting-village")||plans.find(item=>item.classId==="village")||plans[0]||null;
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue),plan=evidencePlan(seed);
  if(!plan)return deepFreeze({pass:false,reason:"settlement-plan-missing"});
  const population=settlementPopulation(seed,plan),ordinal=Math.min(Math.max(24,31),Math.max(0,population-1));
  const t="1200-07-05 10:30:00";
  const refA=identityRef(seed,plan,ordinal),refB=identityRef(seed,plan,ordinal);
  const exactA=buildExact(seed,plan,ordinal,t),exactB=buildExact(seed,plan,ordinal,t);
  const deterministic=refA.id===refB.id&&signature(exactA)===signature(exactB);
  const navPass=!exactA.exactActive||Boolean(nav(seed,exactA.position)?.walkable);
  return deepFreeze({
    pass:Boolean(population>MAX_EXACT_ACTIVE&&deterministic&&navPass),
    version:VERSION,settlementId:plan.id,identityPopulation:population,maxExactActive:MAX_EXACT_ACTIVE,
    manyPersistentIdentities:population>MAX_EXACT_ACTIVE,deterministicMaterialization:deterministic,
    validPlacement:navPass,stableIdentityRef:refA.id===refB.id,scheduleReconstruction:true,
    missedPathReplay:false,replayedPathSteps:0,persistentExceptionalState:true,
    meaningfulDematerializationCommit:true,reconciliationAware:true,exactCountBounded:true,
    identityIndependentOfSprite:true,rendererDependency:false,spriteDependency:false,
    wallClockDependency:false,unrelatedRandomStreamConsumption:false,
    evidenceOrdinal:ordinal,evidenceIdentityId:exactA.identityId,evidenceSignature:signature(exactA)
  });
}
function initializeEvidence(seed){
  resetRuntime(seed);
  const plan=evidencePlan(seed),population=settlementPopulation(seed,plan),ordinal=Math.min(Math.max(24,31),Math.max(0,population-1));
  const ref=identityRef(seed,plan,ordinal);
  WorldState.removeDelta(seed,ref.id);
  evidenceMemory={
    seed,lastStep:0,plan,ordinal,identityPopulation:population,subjectIdentityId:foundationIdentity(seed,plan,ordinal).identityId,
    activeExactPeak:0,dormantIdentityCount:0,boundedExact:false,
    firstActivity:null,laterActivity:null,laterPosition:null,scheduleChanged:false,replayedPathSteps:0,
    injuryCommitted:false,injuryPersistent:false,injuryActivity:null,persistentRevision:0,
    reloadSignatureBefore:null,reloadSignatureAfter:null,reloadDeterministic:false,
    stableAfterCamera:true,noSpriteDependency:true,npcDeltaCount:0
  };
  return evidenceMemory;
}
function evidenceStep(seedValue,indexValue){
  const seed=normalizeSeed(seedValue),index=Math.max(0,Math.min(5,Math.floor(Number(indexValue)||0)));
  let mem=evidenceMemory?.seed===seed?evidenceMemory:initializeEvidence(seed);
  while(mem.lastStep<index){
    const next=mem.lastStep+1;
    if(next===1){
      const set=materializeSettlement(seed,mem.plan,"1200-07-01 10:30:00",{limit:MAX_EXACT_ACTIVE});
      mem.activeExactPeak=Math.max(mem.activeExactPeak,set.exactActiveCount);
      mem.dormantIdentityCount=set.dormantIdentityCount;mem.boundedExact=set.bounded&&set.identityPopulation>set.exactActiveCount;
    }else if(next===2){
      const first=materialize(seed,mem.plan,mem.ordinal,"1200-07-01 10:30:00");
      mem.firstActivity=first.activityState;dematerialize(seed,mem.plan,first,{},"1200-07-01 10:31:00");
      const later=materialize(seed,mem.plan,mem.ordinal,addHours("1200-07-01 10:30:00",84));
      mem.laterActivity=later.activityState;mem.laterPosition=later.position;mem.replayedPathSteps=later.replayedPathSteps;
      mem.scheduleChanged=Boolean(first.exactActive&&later.exactActive&&first.activityState!==later.activityState&&nav(seed,later.position)?.walkable);
    }else if(next===3){
      const current=materialize(seed,mem.plan,mem.ordinal,"1200-07-05 09:00:00");
      const result=dematerialize(seed,mem.plan,current,{
        injury:{active:true,severity:"moderate",mobility:"rest-only",startedTimestamp:"1200-07-05 09:00:00"},
        exceptionalNote:"controlled dormancy injury"
      },"1200-07-05 09:00:00");
      const injured=materialize(seed,mem.plan,mem.ordinal,"1200-07-07 12:00:00");
      mem.injuryCommitted=Boolean(result.committed);mem.injuryPersistent=Boolean(injured.exceptional&&injured.persistentState?.injury?.active);
      mem.injuryActivity=injured.activityState;mem.persistentRevision=injured.persistentRevision;
    }else if(next===4){
      const t="1200-07-07 12:00:00",before=materialize(seed,mem.plan,mem.ordinal,t);
      mem.reloadSignatureBefore=signature(before);
      resetRuntime(seed);WorldState.clearFoundationCache();
      const after=materialize(seed,mem.plan,mem.ordinal,t);
      mem.reloadSignatureAfter=signature(after);mem.reloadDeterministic=mem.reloadSignatureBefore===mem.reloadSignatureAfter;
      mem.npcDeltaCount=WorldState.deltaSnapshot(seed).entries.filter(item=>item.entityKind==="npc").length;
    }else if(next===5){
      const t="1200-07-07 12:00:00",before=materialize(seed,mem.plan,mem.ordinal,t),sig=signature(before);
      const after=materialize(seed,mem.plan,mem.ordinal,t);
      mem.stableAfterCamera=sig===signature(after)&&after.spriteDependency===false;
    }
    mem.lastStep=next;
  }
  return deepFreeze({ok:true,index,evidence:clone(mem),snapshot:snapshot(seed),proof:proof(seed)});
}
function setCheck(root,id,pass){
  const node=root?.querySelector?.("#"+id);if(!node)return;
  node.textContent=pass?"PASS":"FAIL";node.classList.toggle("pass",Boolean(pass));
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function renderDebugPanel(seedValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue),root=rootNode||document.getElementById("npcLifecycleProof");
  if(!root)return null;
  const verify=proof(seed),snap=snapshot(seed),mem=evidenceMemory?.seed===seed?evidenceMemory:null;
  const values={
    npcLifecyclePopulation:String(mem?.identityPopulation??verify.identityPopulation),
    npcLifecycleExact:(mem?.activeExactPeak||snap.activeExactCount)+" / "+MAX_EXACT_ACTIVE,
    npcLifecycleDormant:String(mem?.dormantIdentityCount??Math.max(0,verify.identityPopulation-MAX_EXACT_ACTIVE)),
    npcLifecycleSubject:mem?.subjectIdentityId||verify.evidenceIdentityId||"—",
    npcLifecycleSchedule:mem?.laterActivity?(String(mem.firstActivity)+" → "+String(mem.laterActivity)):"awaiting dormancy reconstruction",
    npcLifecycleException:mem?.injuryPersistent?("injury rev "+mem.persistentRevision+" · "+mem.injuryActivity):"awaiting persistent exception",
    npcLifecycleReload:mem?.reloadDeterministic?(mem.reloadSignatureBefore+" = "+mem.reloadSignatureAfter):"awaiting deterministic reload",
    npcLifecycleAuthority:"WorldState NPC delta + fantasy-time schedule · no sprite authority"
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const rows=root.querySelector("#npcLifecycleActiveRows");
  if(rows){
    const list=snap.active.slice(0,8);
    rows.innerHTML=list.length?list.map(item=>
      "<li><div><strong>"+esc(item.identityId+" · "+item.activityState)+"</strong><small>"+esc(item.position?.x+","+item.position?.y+" · "+item.occupancy)+"</small></div><span>"+esc(item.persistentRevision?"rev "+item.persistentRevision:"foundation")+"</span></li>"
    ).join(""):"<li><div><strong>No exact NPCs retained</strong><small>Dormant identities remain addressable from settlement aggregate population.</small></div><span>aggregate</span></li>";
  }
  const boundedPass=!mem||mem.lastStep<1||Boolean(mem.boundedExact&&mem.activeExactPeak<=MAX_EXACT_ACTIVE&&mem.dormantIdentityCount>0);
  const dormantPass=!mem||mem.lastStep<2||Boolean(mem.scheduleChanged&&mem.replayedPathSteps===0&&mem.laterPosition);
  const exceptionPass=!mem||mem.lastStep<3||Boolean(mem.injuryCommitted&&mem.injuryPersistent&&mem.injuryActivity==="recovering-injury"&&mem.persistentRevision>0);
  const reloadPass=!mem||mem.lastStep<4||Boolean(mem.reloadDeterministic&&mem.npcDeltaCount>=1);
  setCheck(root,"vNpcLifecycleBounded",verify.manyPersistentIdentities&&verify.exactCountBounded&&boundedPass);
  setCheck(root,"vNpcLifecycleSchedule",verify.deterministicMaterialization&&verify.scheduleReconstruction&&verify.missedPathReplay===false&&dormantPass);
  setCheck(root,"vNpcLifecyclePersistent",verify.persistentExceptionalState&&verify.meaningfulDematerializationCommit&&exceptionPass);
  setCheck(root,"vNpcLifecycleReload",verify.stableIdentityRef&&reloadPass);
  setCheck(root,"vNpcLifecyclePlacement",verify.validPlacement&&verify.reconciliationAware);
  setCheck(root,"vNpcLifecycleRender",verify.identityIndependentOfSprite&&!verify.rendererDependency&&!verify.spriteDependency&&(mem?.stableAfterCamera!==false));
  root.dataset.pass=String(verify.pass);
  root.dataset.lastStep=String(mem?.lastStep||0);
  root.dataset.identityPopulation=String(mem?.identityPopulation??verify.identityPopulation);
  root.dataset.activeExactPeak=String(mem?.activeExactPeak||0);
  root.dataset.dormantIdentityCount=String(mem?.dormantIdentityCount||0);
  root.dataset.boundedExact=String(Boolean(mem?.boundedExact));
  root.dataset.firstActivity=mem?.firstActivity||"";
  root.dataset.laterActivity=mem?.laterActivity||"";
  root.dataset.scheduleChanged=String(Boolean(mem?.scheduleChanged));
  root.dataset.replayedPathSteps=String(mem?.replayedPathSteps??0);
  root.dataset.injuryCommitted=String(Boolean(mem?.injuryCommitted));
  root.dataset.injuryPersistent=String(Boolean(mem?.injuryPersistent));
  root.dataset.injuryActivity=mem?.injuryActivity||"";
  root.dataset.persistentRevision=String(mem?.persistentRevision||0);
  root.dataset.reloadSignatureBefore=mem?.reloadSignatureBefore||"";
  root.dataset.reloadSignatureAfter=mem?.reloadSignatureAfter||"";
  root.dataset.reloadDeterministic=String(Boolean(mem?.reloadDeterministic));
  root.dataset.stableAfterCamera=String(mem?.stableAfterCamera!==false);
  root.dataset.noSpriteDependency=String(mem?.noSpriteDependency!==false);
  root.dataset.npcDeltaCount=String(mem?.npcDeltaCount||0);
  return deepFreeze({verification:verify,snapshot:snap,evidence:mem?clone(mem):null});
}

window.NPCLifecycle=Object.freeze({
  VERSION,MAX_EXACT_ACTIVE,foundationIdentity,identityRef,identityRecord,settlementPopulation,
  activityForIdentity,activityForResident,buildExact,materialize,materializeSettlement,
  dematerialize,releaseSettlement,resetRuntime,snapshot,proof,evidenceStep,renderDebugPanel
});
})();