(function(){
"use strict";

const RESIDENT_NAMES=Object.freeze([
  "Alda","Bram","Celia","Dren","Edda","Fenn",
  "Garr","Hira","Ivo","Jessa","Kale","Lysa",
  "Mara","Neri","Oren","Pella","Quin","Rhea",
  "Soren","Tala","Ulric","Vela","Wren","Yara"
]);
const RESIDENT_BIRTH_YEAR_MIN=1056;
const RESIDENT_BIRTH_YEAR_SPAN=52;
const PROFESSIONS=Object.freeze([
  Object.freeze({profession:"farmer",workFunction:"farm",workObjectTypes:Object.freeze(["workbench","storage"]),idealStart:7,afterWork:18}),
  Object.freeze({profession:"smith",workFunction:"craft",workObjectTypes:Object.freeze(["workbench"]),idealStart:8,afterWork:17}),
  Object.freeze({profession:"tavern-keeper",workFunction:"lodging",workObjectTypes:Object.freeze(["counter","table"]),idealStart:9,afterWork:18}),
  Object.freeze({profession:"shopkeeper",workFunction:"market",workObjectTypes:Object.freeze(["counter","storage"]),idealStart:8,afterWork:17}),
  Object.freeze({profession:"woodcutter",workFunction:"outdoor-work",workObjectTypes:Object.freeze([]),idealStart:7,afterWork:18}),
  Object.freeze({profession:"guard",workFunction:"civic",workObjectTypes:Object.freeze(["table","chair"]),idealStart:9,afterWork:18})
]);
const cache=new Map();

function pad2(value){return String(value).padStart(2,"0")}
function identityName(seed,index){
  const offset=Number(PRNG.foundationUint32(seed,"resident-roster:name-offset"))%RESIDENT_NAMES.length;
  return RESIDENT_NAMES[(offset+index)%RESIDENT_NAMES.length];
}
function identityGender(seed,index){
  return Number(PRNG.foundationUint32(seed,"resident-roster:gender:"+index))%2===0?"female":"male";
}
function identityBirthDate(seed,index){
  const year=RESIDENT_BIRTH_YEAR_MIN+
    Number(PRNG.foundationUint32(seed,"resident-roster:birth-year:"+index))%RESIDENT_BIRTH_YEAR_SPAN;
  const month=1+Number(PRNG.foundationUint32(seed,"resident-roster:birth-month:"+index))%12;
  const day=1+Number(PRNG.foundationUint32(seed,"resident-roster:birth-day:"+index))%28;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
function identityBirthplace(seed){
  const plan=StartingVillage.plan(seed);
  return Object.freeze({
    name:String(plan.name||"Starting Village"),
    center:Object.freeze({x:String(plan.center.x),y:String(plan.center.y)})
  });
}
function ageAtBirthDate(birthDate,when){
  const current=normalizeTimestamp(when);
  const match=/^(\d{4,})-(\d{2})-(\d{2})$/.exec(String(birthDate||""));
  if(!current||!match)return null;
  const birthYear=Number(match[1]),birthMonth=Number(match[2]),birthDay=Number(match[3]);
  let age=current.year-birthYear;
  if(current.month<birthMonth||(current.month===birthMonth&&current.day<birthDay))age--;
  return age;
}
function identityForIndex(seed,index){
  const birthplace=identityBirthplace(seed);
  return Object.freeze({
    id:`R${String(index+1).padStart(2,"0")}`,
    name:identityName(seed,index),
    gender:identityGender(seed,index),
    birthDate:identityBirthDate(seed,index),
    birthplace:birthplace.name,
    birthplaceCenter:birthplace.center
  });
}
function normalizeHour(value){
  const n=Number(value);
  if(!Number.isFinite(n))return 0;
  return Math.min(23,Math.max(0,Math.round(n)));
}
function normalizeTimestamp(value){
  if(value==null)return null;
  if(value instanceof Date){
    const d=value;
    return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:d.getUTCSeconds()};
  }
  if(typeof value==="number"){
    const d=new Date(value);
    return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:d.getUTCSeconds()};
  }
  if(typeof value==="string"){
    const text=value.trim();
    const direct=/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if(direct){
      return {year:Number(direct[1]),month:Number(direct[2]),day:Number(direct[3]),hour:Number(direct[4]),minute:Number(direct[5]),second:Number(direct[6])};
    }
    const iso=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
    if(iso){
      return {year:Number(iso[1]),month:Number(iso[2]),day:Number(iso[3]),hour:Number(iso[4]),minute:Number(iso[5]),second:Number(iso[6])};
    }
  }
  if(typeof value==="object" && value.year!=null){
    return {
      year:Number(value.year),
      month:Number(value.month||1),
      day:Number(value.day||1),
      hour:Number(value.hour||0),
      minute:Number(value.minute||0),
      second:Number(value.second||0)
    };
  }
  return null;
}

function timestampKey(value){
  const stamp=normalizeTimestamp(value);
  if(!stamp)return null;
  return `${stamp.year}-${pad2(stamp.month)}-${pad2(stamp.day)} ${pad2(stamp.hour)}:${pad2(stamp.minute)}:${pad2(stamp.second)}`;
}

function accessTargetFromLot(lot){
  if(!lot)return Object.freeze({x:"0",y:"0"});
  if(lot.access?.target){
    return Object.freeze({x:String(lot.access.target.x),y:String(lot.access.target.y)});
  }
  if(lot.access){
    return Object.freeze({x:String(lot.access.x),y:String(lot.access.y)});
  }
  return Object.freeze({x:String(lot.cx??0),y:String(lot.cy??0)});
}

function residentOrdinal(residentId){
  const match=/^R(\d+)$/.exec(String(residentId||""));
  return Math.max(0,(match?Number(match[1]):1)-1);
}
function professionOrder(seed){
  return PROFESSIONS.slice().sort((a,b)=>{
    const av=PRNG.foundationUint32(seed,"resident-assignment:profession-order:"+a.profession);
    const bv=PRNG.foundationUint32(seed,"resident-assignment:profession-order:"+b.profession);
    return av-bv||a.profession.localeCompare(b.profession);
  });
}
function professionForResident(seed,residentId){
  const order=professionOrder(seed);
  return order[residentOrdinal(residentId)%order.length];
}
function homeOrder(seed){
  return HousePlans.build(seed).slice().sort((a,b)=>{
    const av=PRNG.foundationUint32(seed,"resident-assignment:home-order:"+a.id);
    const bv=PRNG.foundationUint32(seed,"resident-assignment:home-order:"+b.id);
    return av-bv||a.id.localeCompare(b.id);
  });
}
function interactionObjectTarget(seed,buildingId,preferredTypes){
  const objects=window.InteriorObjects?.build?.(seed)||[];
  const candidates=objects
    .filter(object=>object.buildingId===buildingId&&object.interactionPositions?.length)
    .sort((a,b)=>a.id.localeCompare(b.id));
  for(const type of preferredTypes||[]){
    const object=candidates.find(item=>item.type===type);
    const target=object?.interactionPositions?.[0];
    if(target)return Object.freeze({
      target:Object.freeze({x:String(target.x),y:String(target.y)}),
      source:"interior-interaction",
      objectId:object.id,
      objectType:object.type
    });
  }
  const fallback=candidates[0];
  const target=fallback?.interactionPositions?.[0];
  return target?Object.freeze({
    target:Object.freeze({x:String(target.x),y:String(target.y)}),
    source:"interior-interaction",
    objectId:fallback.id,
    objectType:fallback.type
  }):null;
}
function homeForResident(seed,residentId){
  const homes=homeOrder(seed);
  if(homes.length!==6)throw new Error("WP-S004-002 requires exactly six generated homes.");
  const ordinal=residentOrdinal(residentId);
  const home=homes[Math.floor(ordinal/2)%homes.length];
  const interior=BuildingInteriors.get(seed,home.id);
  const interaction=interactionObjectTarget(seed,home.id,["bed"]);
  if(!interior||!interaction)throw new Error("Home interaction target unavailable for "+home.id);
  return Object.freeze({
    homePlotId:home.plotId,
    homePlanId:home.id,
    homeLabel:interior.label,
    homeType:home.kind,
    homeTarget:interaction.target,
    homeTargetSource:interaction.source,
    homeObjectId:interaction.objectId,
    homeObjectType:interaction.objectType,
    homeDoor:interior.entrance?.door||null
  });
}
function outdoorWorkTarget(seed,lot,residentId){
  const candidates=[];
  for(let y=lot.bounds.minY;y<=lot.bounds.maxY;y++){
    for(let x=lot.bounds.minX;x<=lot.bounds.maxX;x++){
      const point=Object.freeze({x:String(x),y:String(y)});
      const state=window.InteriorObjects?.classifyNavigation
        ?InteriorObjects.classifyNavigation(seed,point.x,point.y)
        :Walkability.classify(seed,point.x,point.y);
      if(!state?.walkable)continue;
      const score=PRNG.foundationUint32(
        seed,"resident-assignment:outdoor-target:"+residentId+":"+point.x+":"+point.y
      );
      candidates.push({point,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||a.point.y.localeCompare(b.point.y)||a.point.x.localeCompare(b.point.x));
  return candidates[0]?.point||null;
}
function workplaceForResident(seed,residentId,professionConfig){
  const lot=SpecialLots.build(seed).find(item=>item.function===professionConfig.workFunction)||null;
  if(!lot)throw new Error("Compatible workplace unavailable for "+professionConfig.profession);
  if(!lot.enterable){
    const target=outdoorWorkTarget(seed,lot,residentId);
    if(!target)throw new Error("Outdoor work target unavailable for "+lot.id);
    return Object.freeze({
      workplaceId:lot.id,
      workplaceKind:lot.kind,
      workplaceLabel:lot.label,
      workplaceFunction:lot.function,
      workplaceEnterable:false,
      workplaceTarget:target,
      workplaceTargetSource:"outdoor-worksite",
      workplaceObjectId:null,
      workplaceObjectType:null,
      workplaceDoor:null
    });
  }
  const interior=BuildingInteriors.get(seed,lot.id);
  const interaction=interactionObjectTarget(seed,lot.id,professionConfig.workObjectTypes);
  if(!interior||!interaction)throw new Error("Indoor work interaction unavailable for "+lot.id);
  return Object.freeze({
    workplaceId:lot.id,
    workplaceKind:lot.kind,
    workplaceLabel:lot.label,
    workplaceFunction:lot.function,
    workplaceEnterable:true,
    workplaceTarget:interaction.target,
    workplaceTargetSource:interaction.source,
    workplaceObjectId:interaction.objectId,
    workplaceObjectType:interaction.objectType,
    workplaceDoor:interior.entrance?.door||null
  });
}
function assignmentForResident(seed,residentId){
  const professionConfig=professionForResident(seed,residentId);
  return Object.freeze({
    professionConfig,
    home:homeForResident(seed,residentId),
    work:workplaceForResident(seed,residentId,professionConfig)
  });
}

function scheduleInteractionChoice(seed,buildingId,choices){
  const objects=InteriorObjects.build(seed)
    .filter(object=>object.buildingId===buildingId&&object.interactionPositions?.length)
    .sort((a,b)=>a.id.localeCompare(b.id));
  for(const choice of choices){
    const object=objects.find(item=>item.type===choice.type&&item.actions?.includes(choice.action));
    const point=object?.interactionPositions?.[0];
    if(point){
      return Object.freeze({
        target:Object.freeze({x:String(point.x),y:String(point.y)}),
        targetSource:"interior-interaction",
        buildingId,
        interactionObjectId:object.id,
        interactionObjectType:object.type,
        intendedAction:choice.action,
        supportedActions:Object.freeze([...(object.actions||[])])
      });
    }
  }
  return null;
}
function assignedWorkScheduleTarget(seed,resident){
  if(!resident.workplaceEnterable){
    return Object.freeze({
      target:Object.freeze({x:String(resident.workplaceTarget.x),y:String(resident.workplaceTarget.y)}),
      targetSource:"outdoor-worksite",
      buildingId:resident.workplaceId,
      interactionObjectId:null,
      interactionObjectType:"worksite",
      intendedAction:"work",
      supportedActions:Object.freeze(["work"])
    });
  }
  const object=InteriorObjects.build(seed).find(item=>item.id===resident.workplaceObjectId)||null;
  const point=object?.interactionPositions?.find(item=>pointKey2(item)===pointKey2(resident.workplaceTarget))||null;
  if(!object||!point||!object.actions?.includes("work"))return null;
  return Object.freeze({
    target:Object.freeze({x:String(point.x),y:String(point.y)}),
    targetSource:"interior-interaction",
    buildingId:resident.workplaceId,
    interactionObjectId:object.id,
    interactionObjectType:object.type,
    intendedAction:"work",
    supportedActions:Object.freeze([...(object.actions||[])])
  });
}
function publicScheduleTarget(seed,action){
  const tavern=SpecialLots.build(seed).find(lot=>lot.function==="lodging"&&lot.enterable)||null;
  if(!tavern)return null;
  return scheduleInteractionChoice(seed,tavern.id,[
    {type:"table",action},
    {type:"chair",action},
    {type:"counter",action}
  ]);
}
function scheduleBlock(state,label,startHour,endHour,targetInfo,location,buildingId){
  if(!targetInfo)throw new Error("Schedule target unavailable for "+state);
  return Object.freeze({
    state,
    kind:state,
    label,
    startHour,
    endHour,
    startMinute:startHour*60,
    endMinute:endHour*60,
    target:targetInfo.target,
    location,
    buildingId:targetInfo.buildingId||buildingId,
    targetSource:targetInfo.targetSource,
    interactionObjectId:targetInfo.interactionObjectId,
    interactionObjectType:targetInfo.interactionObjectType,
    intendedAction:targetInfo.intendedAction,
    supportedActions:targetInfo.supportedActions
  });
}
function schedulePattern(seed,resident){
  const phase=Number(PRNG.foundationUint32(seed,"daily-activity:phase:"+resident.id));
  const workStart=Math.min(10,resident.professionConfig.idealStart+(phase%2));
  const wakeStart=Math.max(5,workStart-2);
  const breakfastStart=workStart-1;
  const lunchStart=Math.max(workStart+2,12+(Math.floor(phase/2)%2));
  const lunchEnd=lunchStart+1;
  const workEnd=Math.max(lunchEnd+2,resident.professionConfig.afterWork);
  const sleepStart=22+(Math.floor(phase/4)%2);
  const socialStart=workEnd;
  const socialEnd=Math.min(sleepStart-1,socialStart+2);

  const sleepTarget=scheduleInteractionChoice(seed,resident.homePlanId,[{type:"bed",action:"sleep"}]);
  const prepareTarget=scheduleInteractionChoice(seed,resident.homePlanId,[
    {type:"chair",action:"sit"},
    {type:"hearth",action:"warm"},
    {type:"table",action:"social"},
    {type:"bed",action:"rest"}
  ]);
  const breakfastTarget=scheduleInteractionChoice(seed,resident.homePlanId,[
    {type:"table",action:"eat"},
    {type:"hearth",action:"eat"}
  ])||publicScheduleTarget(seed,"eat");
  const workTarget=assignedWorkScheduleTarget(seed,resident);
  const lunchTarget=publicScheduleTarget(seed,"eat");
  const socialTarget=publicScheduleTarget(seed,"social");

  return Object.freeze([
    scheduleBlock("sleep","Sleep",0,wakeStart,sleepTarget,"home",resident.homePlanId),
    scheduleBlock("prepare","Wake & prepare",wakeStart,breakfastStart,prepareTarget,"home",resident.homePlanId),
    scheduleBlock("breakfast","Breakfast",breakfastStart,workStart,breakfastTarget,"home",resident.homePlanId),
    scheduleBlock("work","Morning "+resident.profession+" work",workStart,lunchStart,workTarget,"workplace",resident.workplaceId),
    scheduleBlock("lunch","Lunch",lunchStart,lunchEnd,lunchTarget,"public",lunchTarget?.interactionObjectId?.split(":")[0]||null),
    scheduleBlock("work","Afternoon "+resident.profession+" work",lunchEnd,workEnd,workTarget,"workplace",resident.workplaceId),
    scheduleBlock("social","Village social time",socialStart,socialEnd,socialTarget,"public",socialTarget?.interactionObjectId?.split(":")[0]||null),
    scheduleBlock("return-home","Return home",socialEnd,sleepStart,sleepTarget,"home",resident.homePlanId),
    scheduleBlock("sleep","Sleep",sleepStart,24,sleepTarget,"home",resident.homePlanId)
  ]);
}

function buildResident(seed,index){
  const identity=identityForIndex(seed,index);
  const assignment=assignmentForResident(seed,identity.id);
  const professionConfig=assignment.professionConfig;
  const home=assignment.home;
  const work=assignment.work;
  const resident=Object.freeze({
    id:identity.id,
    name:identity.name,
    gender:identity.gender,
    birthDate:identity.birthDate,
    birthplace:identity.birthplace,
    birthplaceCenter:identity.birthplaceCenter,
    profession:professionConfig.profession,
    professionConfig,
    workFunction:professionConfig.workFunction,
    homePlotId:home.homePlotId,
    homePlanId:home.homePlanId,
    homeLabel:home.homeLabel,
    homeTarget:home.homeTarget,
    homeTargetSource:home.homeTargetSource,
    homeObjectId:home.homeObjectId,
    homeObjectType:home.homeObjectType,
    homeType:home.homeType,
    homeDoor:home.homeDoor,
    workplaceId:work.workplaceId,
    workplaceKind:work.workplaceKind,
    workplaceLabel:work.workplaceLabel,
    workplaceFunction:work.workplaceFunction,
    workplaceEnterable:work.workplaceEnterable,
    workplaceTarget:work.workplaceTarget,
    workplaceTargetSource:work.workplaceTargetSource,
    workplaceObjectId:work.workplaceObjectId,
    workplaceObjectType:work.workplaceObjectType,
    workplaceDoor:work.workplaceDoor,
    schedule:null
  });
  const schedule=schedulePattern(seed,resident);
  return Object.freeze(Object.assign({},resident,{schedule}));
}

function resolveDayActivity(seed,resident,when){
  const targetResident=(resident&&resident.id)?resident:build(seed).find(item=>item.id===resident)||null;
  if(!targetResident)return null;
  const resolved=normalizeTimestamp(when==null?window.GameTime?.getNow?.():when);
  if(!resolved)return null;
  const minute=Math.max(0,Math.min(1439,(Number(resolved.hour)||0)*60+(Number(resolved.minute)||0)));
  const block=(targetResident.schedule||[]).find(item=>item.startMinute<=minute&&minute<item.endMinute)||null;
  if(!block)return null;
  return Object.freeze({
    residentId:targetResident.id,
    residentName:targetResident.name,
    state:block.state,
    action:block.intendedAction,
    intendedAction:block.intendedAction,
    label:block.label,
    timestamp:timestampKey(resolved),
    target:Object.freeze({x:String(block.target.x),y:String(block.target.y)}),
    targetSource:block.targetSource,
    interactionObjectId:block.interactionObjectId,
    interactionObjectType:block.interactionObjectType,
    supportedActions:block.supportedActions,
    location:block.location,
    buildingId:block.buildingId,
    valid:true
  });
}

function build(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(!seed)return [];
  if(cache.has(seed))return cache.get(seed);
  const roster=Array.from({length:12},(_,index)=>buildResident(seed,index));
  const frozen=Object.freeze(roster.map(r=>Object.freeze(r)));
  cache.set(seed,frozen);
  return frozen;
}

function residentIdentityView(seedValue,when){
  const seed=String(seedValue==null?"":seedValue);
  if(!seed)return Object.freeze([]);
  const timestamp=when==null?(window.GameTime?.getTimestampMs?.()??null):when;
  return Object.freeze(build(seed).map(resident=>Object.freeze({
    id:resident.id,
    name:resident.name,
    gender:resident.gender,
    birthDate:resident.birthDate,
    birthplace:resident.birthplace,
    birthplaceCenter:resident.birthplaceCenter,
    age:ageAtBirthDate(resident.birthDate,timestamp)
  })));
}
function identityOnly(resident){
  return Object.freeze({
    id:resident.id,
    name:resident.name,
    gender:resident.gender,
    birthDate:resident.birthDate,
    birthplace:resident.birthplace,
    birthplaceCenter:resident.birthplaceCenter
  });
}
function residentRosterProof(seedValue,when){
  const seed=String(seedValue==null?"":seedValue);
  if(!seed)return Object.freeze({pass:false,residentCount:0,residents:Object.freeze([])});
  const current=normalizeTimestamp(when==null?(window.GameTime?.getTimestampMs?.()??null):when);
  const firstStatic=build(seed).map(identityOnly);
  const freshStatic=Array.from({length:12},(_,index)=>identityForIndex(seed,index));
  const currentViews=residentIdentityView(seed,current);
  const nextYear=current?Object.freeze({
    year:current.year+1,month:current.month,day:current.day,
    hour:current.hour,minute:current.minute,second:current.second
  }):null;
  const nextYearViews=residentIdentityView(seed,nextYear);
  const ids=currentViews.map(item=>item.id);
  const village=StartingVillage.plan(seed);
  const requiredFieldsPass=currentViews.length===12&&currentViews.every(item=>
    /^R\d{2}$/.test(item.id)&&Boolean(item.name)&&
    (item.gender==="female"||item.gender==="male")&&
    /^\d{4,}-\d{2}-\d{2}$/.test(item.birthDate)&&Boolean(item.birthplace)&&
    Number.isInteger(item.age)&&item.age>=0
  );
  const birthplacePass=currentViews.every(item=>
    item.birthplace===village.name&&
    item.birthplaceCenter?.x===String(village.center.x)&&
    item.birthplaceCenter?.y===String(village.center.y)
  );
  const deterministic=JSON.stringify(firstStatic)===JSON.stringify(freshStatic);
  const identityStableAcrossTime=currentViews.every((item,index)=>
    JSON.stringify(identityOnly(item))===JSON.stringify(identityOnly(nextYearViews[index]))
  );
  const ageDerivedPass=currentViews.every(item=>item.age===ageAtBirthDate(item.birthDate,current));
  const agesAdvanceOneYear=currentViews.every((item,index)=>nextYearViews[index]?.age===item.age+1);
  const uniqueIds=new Set(ids).size===12;
  const namesPass=currentViews.every(item=>item.name.trim().length>0);
  const protagonistSeparate=!ids.includes("protagonist")&&!ids.includes("PROTAGONIST");
  const pass=currentViews.length===12&&requiredFieldsPass&&uniqueIds&&namesPass&&
    birthplacePass&&deterministic&&identityStableAcrossTime&&ageDerivedPass&&
    agesAdvanceOneYear&&protagonistSeparate;
  return Object.freeze({
    pass,residentCount:currentViews.length,requiredFieldsPass,uniqueIdsPass:uniqueIds,
    namesPass,birthplacePass,deterministic,identityStableAcrossTime,ageDerivedPass,
    agesAdvanceOneYear,protagonistSeparate,foundationOnly:true,
    randomnessSource:"PRNG.foundationUint32",
    fantasyDate:current?Object.freeze({year:current.year,month:current.month,day:current.day}):null,
    residents:currentViews
  });
}

function assignmentView(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  return Object.freeze(build(seed).map(resident=>Object.freeze({
    residentId:resident.id,
    residentName:resident.name,
    homeId:resident.homePlanId,
    homeLabel:resident.homeLabel,
    homeTarget:resident.homeTarget,
    homeTargetSource:resident.homeTargetSource,
    homeObjectId:resident.homeObjectId,
    profession:resident.profession,
    workFunction:resident.workFunction,
    workplaceId:resident.workplaceId,
    workplaceLabel:resident.workplaceLabel,
    workplaceKind:resident.workplaceKind,
    workplaceFunction:resident.workplaceFunction,
    workplaceEnterable:resident.workplaceEnterable,
    workTarget:resident.workplaceTarget,
    workTargetSource:resident.workplaceTargetSource,
    workObjectId:resident.workplaceObjectId
  })));
}
function pointKey2(point){return point?String(point.x)+","+String(point.y):null}
function routeContainsPoint(route,point){
  const key=pointKey2(point);
  return Boolean(route?.found&&key&&route.path?.some(item=>pointKey2(item)===key));
}
function residentAssignmentProof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(!seed)return Object.freeze({pass:false,residentCount:0,assignments:Object.freeze([])});
  const residents=build(seed);
  const assignments=assignmentView(seed);
  const repeated=Object.freeze(Array.from({length:12},(_,index)=>{
    const residentId=`R${String(index+1).padStart(2,"0")}`;
    const assignment=assignmentForResident(seed,residentId);
    return Object.freeze({
      residentId,
      homeId:assignment.home.homePlanId,
      homeTarget:assignment.home.homeTarget,
      profession:assignment.professionConfig.profession,
      workFunction:assignment.professionConfig.workFunction,
      workplaceId:assignment.work.workplaceId,
      workTarget:assignment.work.workplaceTarget
    });
  }));
  const signature=assignments.map(item=>({
    residentId:item.residentId,homeId:item.homeId,homeTarget:item.homeTarget,
    profession:item.profession,workFunction:item.workFunction,
    workplaceId:item.workplaceId,workTarget:item.workTarget
  }));
  const deterministic=JSON.stringify(signature)===JSON.stringify(repeated);
  const homes=HousePlans.build(seed);
  const homeCounts=new Map(homes.map(home=>[home.id,0]));
  const routeProofs=[];
  let homesValid=true,homeCapacityPass=true,professionsCompatible=true;
  let targetsPass=true,interactionTargetsPass=true,routesPass=true,doorsPass=true;
  for(const resident of residents){
    const home=BuildingInteriors.get(seed,resident.homePlanId);
    const lot=SpecialLots.build(seed).find(item=>item.id===resident.workplaceId)||null;
    const homeCount=(homeCounts.get(resident.homePlanId)||0)+1;
    homeCounts.set(resident.homePlanId,homeCount);
    if(!home||home.source!=="house")homesValid=false;
    if(homeCount>2)homeCapacityPass=false;
    if(!lot||lot.function!==resident.workFunction||resident.workplaceFunction!==resident.workFunction){
      professionsCompatible=false;
    }
    const homeState=InteriorObjects.classifyNavigation(seed,resident.homeTarget.x,resident.homeTarget.y);
    const workState=InteriorObjects.classifyNavigation(seed,resident.workplaceTarget.x,resident.workplaceTarget.y);
    if(!homeState?.walkable||!workState?.walkable)targetsPass=false;
    const homeObject=InteriorObjects.build(seed).find(object=>object.id===resident.homeObjectId);
    const homeInteraction=Boolean(
      resident.homeTargetSource==="interior-interaction"&&homeObject?.type==="bed"&&
      homeObject.interactionPositions?.some(point=>pointKey2(point)===pointKey2(resident.homeTarget))
    );
    let workInteraction=true;
    if(resident.workplaceEnterable){
      const workObject=InteriorObjects.build(seed).find(object=>object.id===resident.workplaceObjectId);
      workInteraction=Boolean(
        resident.workplaceTargetSource==="interior-interaction"&&
        workObject?.buildingId===resident.workplaceId&&
        workObject.interactionPositions?.some(point=>pointKey2(point)===pointKey2(resident.workplaceTarget))
      );
    }else{
      const x=Number(resident.workplaceTarget.x),y=Number(resident.workplaceTarget.y);
      workInteraction=Boolean(
        resident.workplaceTargetSource==="outdoor-worksite"&&lot&&
        x>=lot.bounds.minX&&x<=lot.bounds.maxX&&y>=lot.bounds.minY&&y<=lot.bounds.maxY
      );
    }
    if(!homeInteraction||!workInteraction)interactionTargetsPass=false;
    const route=RoutePlanner.findRoute(seed,resident.homeTarget,resident.workplaceTarget);
    const homeDoorPass=routeContainsPoint(route,home?.entrance?.door);
    const workInterior=resident.workplaceEnterable?BuildingInteriors.get(seed,resident.workplaceId):null;
    const workDoorPass=resident.workplaceEnterable
      ?routeContainsPoint(route,workInterior?.entrance?.door)
      :true;
    const routeWalkable=Boolean(route?.found&&route.path.every(point=>InteriorObjects.classifyNavigation(seed,point.x,point.y)?.walkable));
    const routePass=Boolean(route?.found&&routeWalkable&&homeDoorPass&&workDoorPass);
    if(!routePass)routesPass=false;
    if(!homeDoorPass||!workDoorPass)doorsPass=false;
    routeProofs.push(Object.freeze({
      residentId:resident.id,
      found:Boolean(route?.found),
      stepCount:route?.stepCount??0,
      totalSeconds:route?.totalSeconds??0,
      homeDoorPass,
      workDoorPass,
      routeWalkable,
      pass:routePass
    }));
  }
  const allSixHomesUsed=homeCounts.size===6&&[...homeCounts.values()].every(count=>count===2);
  homeCapacityPass=homeCapacityPass&&allSixHomesUsed;
  const pass=residents.length===12&&homesValid&&homeCapacityPass&&professionsCompatible&&
    targetsPass&&interactionTargetsPass&&routesPass&&doorsPass&&deterministic;
  return Object.freeze({
    pass,residentCount:residents.length,homeCount:homes.length,homesValid,homeCapacityPass,
    homeOccupancy:Object.freeze([...homeCounts.entries()].map(([homeId,count])=>Object.freeze({homeId,count}))),
    professionsCompatible,targetsPass,interactionTargetsPass,routesPass,doorsPass,deterministic,
    assignmentBasis:"Campaign SEED + resident ID",
    movementExecutionIntroduced:false,
    actionExecutionIntroduced:false,
    assignments,
    routes:Object.freeze(routeProofs)
  });
}

function resolveActionTarget(seedValue,residentValue,when){
  const seed=String(seedValue==null?"":seedValue);
  const roster=build(seed);
  const resident=typeof residentValue==="string"?roster.find(item=>item.id===residentValue):residentValue||roster[0];
  if(!resident)return null;
  return resolveDayActivity(seed,resident,when);
}

function identityAssignmentSignature(resident){
  return Object.freeze({
    id:resident.id,name:resident.name,gender:resident.gender,birthDate:resident.birthDate,
    birthplace:resident.birthplace,homePlanId:resident.homePlanId,homeTarget:resident.homeTarget,
    profession:resident.profession,workFunction:resident.workFunction,
    workplaceId:resident.workplaceId,workplaceTarget:resident.workplaceTarget
  });
}
function scheduleTargetSupportsAction(seed,block){
  const state=InteriorObjects.classifyNavigation(seed,block.target.x,block.target.y);
  if(!state?.walkable)return false;
  if(block.targetSource==="outdoor-worksite"){
    const lot=SpecialLots.build(seed).find(item=>item.id===block.buildingId)||null;
    const x=Number(block.target.x),y=Number(block.target.y);
    return Boolean(
      block.intendedAction==="work"&&block.supportedActions?.includes("work")&&lot&&!lot.enterable&&
      x>=lot.bounds.minX&&x<=lot.bounds.maxX&&y>=lot.bounds.minY&&y<=lot.bounds.maxY
    );
  }
  if(block.targetSource!=="interior-interaction")return false;
  const object=InteriorObjects.build(seed).find(item=>item.id===block.interactionObjectId)||null;
  return Boolean(
    object&&object.buildingId===block.buildingId&&
    object.actions?.includes(block.intendedAction)&&
    object.interactionPositions?.some(point=>pointKey2(point)===pointKey2(block.target))
  );
}
function scheduleView(seedValue,when){
  const seed=String(seedValue==null?"":seedValue);
  const current=normalizeTimestamp(when==null?window.GameTime?.getNow?.():when);
  if(!seed||!current)return Object.freeze([]);
  return Object.freeze(build(seed).map(resident=>resolveDayActivity(seed,resident,current)));
}
function residentScheduleProof(seedValue,when){
  const seed=String(seedValue==null?"":seedValue);
  if(!seed)return Object.freeze({pass:false,residentCount:0,currentStates:Object.freeze([])});
  const residents=build(seed);
  const current=normalizeTimestamp(when==null?window.GameTime?.getNow?.():when)||
    Object.freeze({year:1200,month:1,day:1,hour:0,minute:0,second:0});
  const before=residents.map(identityAssignmentSignature);
  let completeSchedules=true,targetsActionsValid=true,homeWorkAssignmentsMatch=true;
  let representativeSelectionPass=true,deterministic=true;
  const scheduleSummaries=[];
  for(const resident of residents){
    const schedule=resident.schedule||[];
    if(schedule.length!==9||schedule[0]?.startMinute!==0||schedule[schedule.length-1]?.endMinute!==1440){
      completeSchedules=false;
    }
    for(let index=0;index<schedule.length;index++){
      const block=schedule[index];
      if(!block||block.startMinute>=block.endMinute)completeSchedules=false;
      if(index>0&&schedule[index-1].endMinute!==block.startMinute)completeSchedules=false;
      if(!scheduleTargetSupportsAction(seed,block))targetsActionsValid=false;
      if((block.state==="sleep"||block.state==="return-home")&&pointKey2(block.target)!==pointKey2(resident.homeTarget)){
        homeWorkAssignmentsMatch=false;
      }
      if(block.state==="work"&&pointKey2(block.target)!==pointKey2(resident.workplaceTarget)){
        homeWorkAssignmentsMatch=false;
      }
      const midpoint=Math.floor((block.startMinute+block.endMinute)/2);
      const sample=Object.freeze({
        year:current.year,month:current.month,day:current.day,
        hour:Math.floor(midpoint/60),minute:midpoint%60,second:0
      });
      const resolved=resolveDayActivity(seed,resident,sample);
      if(!resolved||resolved.state!==block.state||resolved.intendedAction!==block.intendedAction||
         pointKey2(resolved.target)!==pointKey2(block.target)){
        representativeSelectionPass=false;
      }
    }
    const rebuilt=schedulePattern(seed,Object.freeze(Object.assign({},resident,{schedule:null})));
    if(JSON.stringify(schedule)!==JSON.stringify(rebuilt))deterministic=false;
    scheduleSummaries.push(Object.freeze({
      residentId:resident.id,
      blockCount:schedule.length,
      states:Object.freeze(schedule.map(block=>block.state)),
      actions:Object.freeze(schedule.map(block=>block.intendedAction))
    }));
  }
  const after=build(seed).map(identityAssignmentSignature);
  const identityAssignmentsStable=JSON.stringify(before)===JSON.stringify(after);
  const currentStates=scheduleView(seed,current);
  const currentStatesValid=currentStates.length===12&&currentStates.every(state=>
    state?.valid&&state.intendedAction&&state.supportedActions?.includes(state.intendedAction)
  );
  const pass=residents.length===12&&completeSchedules&&targetsActionsValid&&homeWorkAssignmentsMatch&&
    deterministic&&representativeSelectionPass&&identityAssignmentsStable&&currentStatesValid;
  return Object.freeze({
    pass,
    residentCount:residents.length,
    completeSchedules,
    targetsActionsValid,
    homeWorkAssignmentsMatch,
    deterministic,
    representativeSelectionPass,
    identityAssignmentsStable,
    currentStatesValid,
    timeSource:"authoritative fantasy time",
    directRealClockRead:false,
    movementExecutionIntroduced:false,
    actionExecutionIntroduced:false,
    dialogueEconomyCombatIntroduced:false,
    sampleTime:Object.freeze({year:current.year,month:current.month,day:current.day,hour:current.hour,minute:current.minute,second:current.second}),
    scheduleSummaries:Object.freeze(scheduleSummaries),
    currentStates
  });
}
function proof(seedValue,when){return residentScheduleProof(seedValue,when)}

const api=Object.freeze({
  build,
  residents:build,
  resolveActionTarget,
  resolve:resolveActionTarget,
  proof,
  roster:build,
  generate:build,
  schedule:build,
  current:scheduleView,
  scheduleView,
  residentScheduleProof,
  actionTargets:resolveActionTarget
});

window.DailyActivity=api;
window.ResidentSchedules=Object.freeze({
  build,
  schedules:build,
  current:scheduleView,
  resolve:resolveActionTarget,
  proof:residentScheduleProof,
  timeSource:"authoritative fantasy time"
});
window.ActionTargets=Object.freeze({
  resolve:resolveActionTarget,
  resolveActionTarget,
  build,
  proof
});
window.ResidentAssignments=Object.freeze({
  build:assignmentView,
  assignments:assignmentView,
  proof:residentAssignmentProof,
  basis:"Campaign SEED + resident ID"
});
window.ResidentRoster=Object.freeze({
  build:residentIdentityView,
  residents:residentIdentityView,
  identities:residentIdentityView,
  ageAt:ageAtBirthDate,
  proof:residentRosterProof,
  randomnessSource:"PRNG.foundationUint32"
});
window.StartingVillagePopulation=Object.freeze({
  build,
  residents:build,
  resolve:resolveActionTarget,
  proof,
  roster:build,
  identityRoster:residentIdentityView,
  residentRosterProof,
  dailyActivity:api
});
window.VillagePopulation=window.StartingVillagePopulation;
})();
