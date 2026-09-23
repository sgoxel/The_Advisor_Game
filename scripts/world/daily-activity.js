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
  Object.freeze({profession:"farmer",workFunction:"farm",idealStart:7,afterWork:18,homeKind:"cabin"}),
  Object.freeze({profession:"smith",workFunction:"craft",idealStart:8,afterWork:17,homeKind:"house"}),
  Object.freeze({profession:"tavern-keeper",workFunction:"lodging",idealStart:9,afterWork:18,homeKind:"house"}),
  Object.freeze({profession:"shopkeeper",workFunction:"market",idealStart:8,afterWork:17,homeKind:"house"}),
  Object.freeze({profession:"woodcutter",workFunction:"outdoor-work",idealStart:7,afterWork:18,homeKind:"cabin"}),
  Object.freeze({profession:"guard",workFunction:"civic",idealStart:9,afterWork:18,homeKind:"house"})
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

function accessTargetFromPlan(plan){
  if(!plan)return {x:0,y:0};
  if(plan.entrance && plan.entrance.target){
    return Object.freeze({x:plan.entrance.target.x,y:plan.entrance.target.y});
  }
  if(plan.entrance){
    return Object.freeze({x:plan.entrance.x,y:plan.entrance.y});
  }
  if(plan.bounds){
    return Object.freeze({x:(plan.bounds.minX+plan.bounds.maxX)/2,y:(plan.bounds.minY+plan.bounds.maxY)/2});
  }
  return Object.freeze({x:0,y:0});
}

function accessTargetFromLot(lot){
  if(!lot)return {x:0,y:0};
  if(lot.access && lot.access.target){
    return Object.freeze({x:lot.access.target.x,y:lot.access.target.y});
  }
  if(lot.access){
    return Object.freeze({x:lot.access.x,y:lot.access.y});
  }
  if(lot.bounds){
    return Object.freeze({x:(lot.bounds.minX+lot.bounds.maxX)/2,y:(lot.bounds.minY+lot.bounds.maxY)/2});
  }
  return Object.freeze({x:0,y:0});
}

function homeForIndex(seed,index){
  const homes=HousePlans && HousePlans.build ? HousePlans.build(seed) : [];
  if(!homes.length)return {homePlotId:"H0",homePlanId:null,homeTarget:Object.freeze({x:0,y:0}),homeType:"house"};
  const home=homes[index % homes.length];
  return {
    homePlotId:home?.plotId||`H${index+1}`,
    homePlanId:home?.id||null,
    homeTarget:accessTargetFromPlan(home),
    homeType:home?.kind||"house"
  };
}

function workplaceForIndex(seed,index){
  const lots=SpecialLots && SpecialLots.build ? SpecialLots.build(seed) : [];
  const fallback=(lots[index % Math.max(1,lots.length)]||null);
  if(!fallback){
    return {workplaceId:"S0",workplaceKind:"workshop",workplaceTarget:Object.freeze({x:0,y:0})};
  }
  return {
    workplaceId:fallback.id,
    workplaceKind:fallback.kind,
    workplaceTarget:accessTargetFromLot(fallback)
  };
}

function schedulePattern(seed,resident){
  const phase=Number(PRNG.foundationUint32(seed,"daily-activity:phase:"+resident.id))%240;
  const baseStart=resident.professionConfig.idealStart;
  const breakfastStart=Math.max(5,baseStart-1+Math.floor(phase/60)%2);
  const lunchStart=Math.max(11,Math.min(14,12+Math.floor(phase/80)%2));
  const socialStart=Math.max(17,Math.min(19,18+Math.floor(phase/100)%2));
  const sleepStart=Number.isInteger(phase%2)?22:23;

  const earlySleep=Object.freeze({
    kind:"sleep",
    label:"Sleep",
    startHour:0,
    endHour:Math.max(4,Math.min(6,sleepStart-18)),
    target:resident.homeTarget,
    location:"home",
    buildingId:resident.homePlanId,
    targetKind:"home"
  });

  const wake=Object.freeze({
    kind:"wake",
    label:"Wake & prepare",
    startHour:Math.max(5,Math.min(6,breakfastStart-1)),
    endHour:breakfastStart,
    target:resident.homeTarget,
    location:"home",
    buildingId:resident.homePlanId,
    targetKind:"home"
  });

  const breakfast=Object.freeze({
    kind:"meal",
    label:"Breakfast",
    startHour:breakfastStart,
    endHour:Math.min(8,breakfastStart+1),
    target:resident.homeTarget,
    location:"home",
    buildingId:resident.homePlanId,
    targetKind:"home"
  });

  const work=Object.freeze({
    kind:"work",
    label:resident.profession+" work",
    startHour:baseStart,
    endHour:resident.professionConfig.afterWork,
    target:resident.workplaceTarget,
    location:"workplace",
    buildingId:resident.workplaceId,
    targetKind:"workplace"
  });

  const lunch=Object.freeze({
    kind:"meal",
    label:"Lunch",
    startHour:lunchStart,
    endHour:Math.min(15,lunchStart+1),
    target:resident.workplaceTarget,
    location:"workplace",
    buildingId:resident.workplaceId,
    targetKind:"workplace"
  });

  const social=Object.freeze({
    kind:"social",
    label:"Village social time",
    startHour:socialStart,
    endHour:Math.min(22,socialStart+2),
    target:resident.socialTarget,
    location:"social",
    buildingId:resident.socialBuildingId,
    targetKind:"social"
  });

  const evening=Object.freeze({
    kind:"rest",
    label:"Return home",
    startHour:Math.max(20,socialStart+2),
    endHour:22,
    target:resident.homeTarget,
    location:"home",
    buildingId:resident.homePlanId,
    targetKind:"home"
  });

  const nightSleep=Object.freeze({
    kind:"sleep",
    label:"Sleep",
    startHour:22,
    endHour:24,
    target:resident.homeTarget,
    location:"home",
    buildingId:resident.homePlanId,
    targetKind:"home"
  });

  return Object.freeze([
    earlySleep,
    wake,
    breakfast,
    work,
    lunch,
    social,
    evening,
    nightSleep
  ]);
}

function buildResident(seed,index){
  const identity=identityForIndex(seed,index);
  const professionConfig=PROFESSIONS[index % PROFESSIONS.length];
  const home=homeForIndex(seed,index);
  const work=workplaceForIndex(seed,index);
  const special=SpecialLots && SpecialLots.build ? SpecialLots.build(seed) : [];
  const socialLot=special.find(lot=>lot.function==="lodging")||special[0]||null;
  const socialTarget=socialLot ? accessTargetFromLot(socialLot) : work.workplaceTarget;
  const socialBuildingId=socialLot ? socialLot.id : work.workplaceId;
  const resident=Object.freeze({
    id:identity.id,
    name:identity.name,
    gender:identity.gender,
    birthDate:identity.birthDate,
    birthplace:identity.birthplace,
    birthplaceCenter:identity.birthplaceCenter,
    profession:professionConfig.profession,
    professionConfig,
    homePlotId:home.homePlotId,
    homePlanId:home.homePlanId,
    homeTarget:home.homeTarget,
    homeType:home.homeType,
    workplaceId:work.workplaceId,
    workplaceKind:work.workplaceKind,
    workplaceTarget:work.workplaceTarget,
    socialTarget,
    socialBuildingId,
    schedule:null
  });
  const schedule=schedulePattern(seed,resident);
  return Object.freeze(Object.assign({},resident,{schedule}));
}

function resolveDayActivity(seed,resident,when){
  const resolved=normalizeTimestamp(when);
  const targetResident=(resident&&resident.id)?resident:build(seed).find(item=>item.id===resident)||null;
  if(!targetResident)return null;
  const hour=resolved?normalizeHour(resolved.hour):normalizeHour(new Date().getUTCHours());
  for(const block of targetResident.schedule||[]){
    if(block.startHour<=hour&&hour<block.endHour){
      return Object.freeze({
        residentId:targetResident.id,
        residentName:targetResident.name,
        action:block.kind,
        label:block.label,
        timestamp:resolved?timestampKey(resolved):null,
        target:Object.freeze({x:targetResident[block.targetKind+"Target"].x,y:targetResident[block.targetKind+"Target"].y}),
        location:block.location,
        buildingId:block.buildingId,
        valid:true
      });
    }
  }
  const fallback=targetResident.schedule[0];
  return Object.freeze({
    residentId:targetResident.id,
    residentName:targetResident.name,
    action:fallback.kind,
    label:fallback.label,
    timestamp:resolved?timestampKey(resolved):null,
    target:Object.freeze({x:fallback.target.x,y:fallback.target.y}),
    location:fallback.location,
    buildingId:fallback.buildingId,
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

function resolveActionTarget(seedValue,residentValue,when){
  const seed=String(seedValue==null?"":seedValue);
  const roster=build(seed);
  const resident=typeof residentValue==="string"?roster.find(item=>item.id===residentValue):residentValue||roster[0];
  if(!resident)return null;
  return resolveDayActivity(seed,resident,when);
}

function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const first=build(seed);
  const second=build(seed);
  const deterministic=JSON.stringify(first)===JSON.stringify(second);
  const residentCount=first.length===12;
  const allHaveHome=first.every(r=>r.homeTarget&&Number.isFinite(r.homeTarget.x)&&Number.isFinite(r.homeTarget.y));
  const allHaveWork=first.every(r=>r.workplaceTarget&&Number.isFinite(r.workplaceTarget.x)&&Number.isFinite(r.workplaceTarget.y));
  const allHaveSchedule=first.every(r=>Array.isArray(r.schedule)&&r.schedule.length>=7);
  const allHaveSleep=first.every(r=>r.schedule.some(block=>block.kind==="sleep"));
  const dailyTargets=first.every(r=>r.schedule.some(block=>{
    const target=block.target;
    return target&&Number.isFinite(target.x)&&Number.isFinite(target.y);
  }));
  return Object.freeze({
    pass:deterministic&&residentCount&&allHaveHome&&allHaveWork&&allHaveSchedule&&allHaveSleep&&dailyTargets,
    deterministic,
    residentCount:first.length,
    homeTargetsPass:allHaveHome,
    workTargetsPass:allHaveWork,
    schedulePass:allHaveSchedule,
    sleepPass:allHaveSleep,
    dailyTargetsPass:dailyTargets,
    residents:first
  });
}

const api=Object.freeze({
  build,
  residents:build,
  resolveActionTarget,
  resolve:resolveActionTarget,
  proof,
  roster:build,
  generate:build,
  schedule:build,
  actionTargets:resolveActionTarget
});

window.DailyActivity=api;
window.ResidentSchedules=api;
window.ActionTargets=Object.freeze({
  resolve:resolveActionTarget,
  resolveActionTarget,
  build,
  proof
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
