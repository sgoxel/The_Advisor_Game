(function(){
"use strict";

const VERSION="settlement-activity-rhythm-v1";
const TRANSITION_MINUTES=45;
const MAX_LOCAL_RESIDENTS=32;
const PROFILE_KEYS=Object.freeze([
  "outdoorResidentShare","workSiteOccupancy","marketPublicActivity",
  "tavernSocialActivity","guardPatrolPresence","ambientTrafficLikelihood"
]);
const PROFILES=Object.freeze({
  dawn:Object.freeze({
    outdoorResidentShare:.52,workSiteOccupancy:.48,marketPublicActivity:.38,
    tavernSocialActivity:.24,guardPatrolPresence:.78,ambientTrafficLikelihood:.62
  }),
  daytime:Object.freeze({
    outdoorResidentShare:.92,workSiteOccupancy:.96,marketPublicActivity:.94,
    tavernSocialActivity:.48,guardPatrolPresence:.72,ambientTrafficLikelihood:.88
  }),
  "late-day":Object.freeze({
    outdoorResidentShare:.78,workSiteOccupancy:.58,marketPublicActivity:.68,
    tavernSocialActivity:.68,guardPatrolPresence:.84,ambientTrafficLikelihood:.82
  }),
  evening:Object.freeze({
    outdoorResidentShare:.56,workSiteOccupancy:.16,marketPublicActivity:.34,
    tavernSocialActivity:.96,guardPatrolPresence:.94,ambientTrafficLikelihood:.58
  }),
  night:Object.freeze({
    outdoorResidentShare:.18,workSiteOccupancy:.05,marketPublicActivity:.08,
    tavernSocialActivity:.42,guardPatrolPresence:1.00,ambientTrafficLikelihood:.16
  })
});
const BOUNDARIES=Object.freeze([
  Object.freeze({hour:5,from:"night",to:"dawn"}),
  Object.freeze({hour:8,from:"dawn",to:"daytime"}),
  Object.freeze({hour:17,from:"daytime",to:"late-day"}),
  Object.freeze({hour:19,from:"late-day",to:"evening"}),
  Object.freeze({hour:22,from:"evening",to:"night"})
]);

function clamp01(value){return Math.max(0,Math.min(1,Number(value)||0))}
function smoothstep(value){const t=clamp01(value);return t*t*(3-2*t)}
function normalizeHour(value){const h=Number(value)||0;return ((h%24)+24)%24}
function timeParts(when){
  const t=when&&typeof when==="object"?when:(window.GameTime?.getNow?.()||null);
  return t||{year:0,month:1,day:1,hour:12,minute:0,second:0};
}
function hourOf(when){
  const t=timeParts(when);
  return normalizeHour(Number(t.hour||0)+Number(t.minute||0)/60+Number(t.second||0)/3600);
}
function bandForHour(value){
  const h=normalizeHour(value);
  if(h>=5&&h<8)return "dawn";
  if(h>=8&&h<17)return "daytime";
  if(h>=17&&h<19)return "late-day";
  if(h>=19&&h<22)return "evening";
  return "night";
}
function circularDeltaHours(hour,boundary){
  let d=normalizeHour(hour)-normalizeHour(boundary);
  if(d>12)d-=24;
  if(d<-12)d+=24;
  return d;
}
function blendProfiles(a,b,t){
  const out={};
  const u=smoothstep(t);
  for(const key of PROFILE_KEYS)out[key]=Number((Number(a[key])+(Number(b[key])-Number(a[key]))*u).toFixed(4));
  return Object.freeze(out);
}
function profileAtHour(value){
  const hour=normalizeHour(value),band=bandForHour(hour),base=PROFILES[band];
  const half=TRANSITION_MINUTES/120;
  for(const boundary of BOUNDARIES){
    const delta=circularDeltaHours(hour,boundary.hour);
    if(Math.abs(delta)<=half){
      const t=(delta+half)/(half*2);
      return Object.freeze({
        hour:Number(hour.toFixed(4)),band,
        modifiers:blendProfiles(PROFILES[boundary.from],PROFILES[boundary.to],t),
        transition:Object.freeze({from:boundary.from,to:boundary.to,progress:Number(smoothstep(t).toFixed(4))})
      });
    }
  }
  return Object.freeze({hour:Number(hour.toFixed(4)),band,modifiers:base,transition:null});
}
function residentPhaseMinutes(seed,residentId){
  const raw=Number(window.PRNG?.foundationUint32?.(String(seed),"settlement-rhythm:phase:"+String(residentId))||0);
  return raw%41-20;
}
function categoryFor(resident,activity){
  const profession=String(resident?.profession||"");
  const workFunction=String(resident?.workFunction||resident?.workplaceFunction||"");
  const state=String(activity?.state||activity?.kind||"").toLowerCase();
  const action=String(activity?.intendedAction||activity?.action||"").toLowerCase();
  // Individual DailyActivity remains authoritative. A guard who is scheduled
  // asleep/home is not converted into patrol merely because the night profile
  // has a strong guard modifier.
  if(state==="sleep"||state==="prepare"||state==="breakfast")return "home";
  if(profession==="guard")return "guard";
  const publicContext=String(activity?.location||"").toLowerCase()==="public";
  if(state==="social"||state==="lunch"||action==="social"||(action==="eat"&&publicContext))return "tavern-social";
  if(state==="work"||["work","craft","service"].includes(action)){
    if(workFunction==="market"||profession==="shopkeeper")return "market";
    if(workFunction==="lodging"||profession==="tavern-keeper")return "tavern-social";
    return "work";
  }
  if(["return-home","prepare","breakfast"].includes(state))return "traffic";
  if(state==="sleep")return "home";
  return "traffic";
}
function categoryModifier(profile,category){
  const m=profile.modifiers||profile;
  if(category==="guard")return Number(m.guardPatrolPresence||0);
  if(category==="tavern-social")return Number(m.tavernSocialActivity||0);
  if(category==="market")return Number(m.marketPublicActivity||0);
  if(category==="work")return Number(m.workSiteOccupancy||0);
  if(category==="home")return 1-Number(m.outdoorResidentShare||0);
  return Number(m.ambientTrafficLikelihood||0);
}
function residentPresentation(seed,resident,when,activityValue){
  if(!resident?.id)return null;
  const phaseMinutes=residentPhaseMinutes(seed,resident.id);
  const shiftedHour=normalizeHour(hourOf(when)+phaseMinutes/60);
  const profile=profileAtHour(shiftedHour);
  let activity=activityValue||null;
  if(!activity&&window.DailyActivity?.resolveActionTarget){
    try{activity=window.DailyActivity.resolveActionTarget(seed,resident,when)||null}catch(_){activity=null}
  }
  const category=categoryFor(resident,activity);
  const modifier=clamp01(categoryModifier(profile,category));
  const outdoorTarget=Boolean(activity&&activity.targetSource!=="interior-interaction");
  const priority=clamp01(
    modifier*.72+
    (outdoorTarget?Number(profile.modifiers.outdoorResidentShare||0)*.28:0)
  );
  return Object.freeze({
    residentId:String(resident.id),band:profile.band,category,phaseMinutes,
    shiftedHour:Number(shiftedHour.toFixed(4)),priority:Number(priority.toFixed(4)),
    outdoorTarget,activityState:String(activity?.state||activity?.kind||""),
    modifiers:profile.modifiers,transition:profile.transition,
    scheduleAuthority:"DailyActivity unchanged",presentationOnly:true
  });
}
function snapshot(seedValue,whenValue,residentsValue){
  const seed=String(seedValue==null?"":seedValue),when=timeParts(whenValue),profile=profileAtHour(hourOf(when));
  const roster=(Array.isArray(residentsValue)?residentsValue:(window.DailyActivity?.build?.(seed)||[])).slice(0,MAX_LOCAL_RESIDENTS);
  const counts={outdoorTarget:0,work:0,marketPublic:0,tavernSocial:0,guardPatrol:0,traffic:0,home:0};
  let priorityTotal=0,phaseMin=Infinity,phaseMax=-Infinity;
  const residents=[];
  for(const resident of roster){
    let activity=null;
    try{activity=window.DailyActivity?.resolveActionTarget?.(seed,resident,when)||null}catch(_){activity=null}
    const row=residentPresentation(seed,resident,when,activity);if(!row)continue;
    residents.push(row);priorityTotal+=row.priority;phaseMin=Math.min(phaseMin,row.phaseMinutes);phaseMax=Math.max(phaseMax,row.phaseMinutes);
    if(row.outdoorTarget)counts.outdoorTarget++;
    if(row.category==="work")counts.work++;
    else if(row.category==="market")counts.marketPublic++;
    else if(row.category==="tavern-social")counts.tavernSocial++;
    else if(row.category==="guard")counts.guardPatrol++;
    else if(row.category==="traffic")counts.traffic++;
    else if(row.category==="home")counts.home++;
  }
  return Object.freeze({
    version:VERSION,seed:seed||null,stamp:Object.freeze({...when}),hour:profile.hour,band:profile.band,
    transition:profile.transition,modifiers:profile.modifiers,
    residentCount:residents.length,counts:Object.freeze(counts),
    averagePresentationPriority:residents.length?Number((priorityTotal/residents.length).toFixed(4)):0,
    residentPhaseMinuteRange:Object.freeze({
      min:Number.isFinite(phaseMin)?phaseMin:0,max:Number.isFinite(phaseMax)?phaseMax:0
    }),
    residents:Object.freeze(residents),
    transitionMinutes:TRANSITION_MINUTES,maxLocalResidents:MAX_LOCAL_RESIDENTS,
    fantasyTimeOnly:true,scheduleMutation:false,worldTruthMutation:false,materializationMutation:false,
    fullSettlementPerFrameScan:false,globalScan:false,presentationOnly:true
  });
}
function verify(seedValue){
  const seed=String(seedValue||"WP-S004-009-VERIFY");
  const times=Object.freeze({
    dawn:Object.freeze({year:1201,month:2,day:1,hour:6,minute:30,second:0}),
    daytime:Object.freeze({year:1201,month:2,day:1,hour:12,minute:30,second:0}),
    "late-day":Object.freeze({year:1201,month:2,day:1,hour:18,minute:0,second:0}),
    evening:Object.freeze({year:1201,month:2,day:1,hour:20,minute:30,second:0}),
    night:Object.freeze({year:1201,month:2,day:1,hour:23,minute:30,second:0})
  });
  const first=Object.fromEntries(Object.entries(times).map(([key,when])=>[key,snapshot(seed,when)]));
  const second=Object.fromEntries(Object.entries(times).map(([key,when])=>[key,snapshot(seed,when)]));
  const signature=value=>JSON.stringify(Object.fromEntries(Object.entries(value).map(([key,row])=>[key,{
    band:row.band,modifiers:row.modifiers,counts:row.counts,phases:row.residents.map(r=>[r.residentId,r.phaseMinutes,r.category,r.priority])
  }])));
  const deterministic=signature(first)===signature(second);
  const bandsPass=Object.keys(times).every(key=>first[key].band===key);
  const profileContrastPass=
    first.daytime.modifiers.outdoorResidentShare>first.night.modifiers.outdoorResidentShare&&
    first.daytime.modifiers.workSiteOccupancy>first.evening.modifiers.workSiteOccupancy&&
    first.evening.modifiers.tavernSocialActivity>first.dawn.modifiers.tavernSocialActivity&&
    first.night.modifiers.guardPatrolPresence>=first.daytime.modifiers.guardPatrolPresence;
  const variationPass=first.daytime.residents.length<2||
    new Set(first.daytime.residents.map(r=>r.phaseMinutes)).size>1;
  return Object.freeze({
    pass:Boolean(deterministic&&bandsPass&&profileContrastPass&&variationPass),
    deterministic,bandsPass,profileContrastPass,variationPass,
    samples:Object.freeze(first),fantasyTimeOnly:true,scheduleMutation:false,
    globalScan:false,fullSettlementPerFrameScan:false
  });
}

window.SettlementActivityRhythm=Object.freeze({
  VERSION,TRANSITION_MINUTES,MAX_LOCAL_RESIDENTS,PROFILE_KEYS,PROFILES,
  bandForHour,profileAtHour,residentPhaseMinutes,residentPresentation,snapshot,verify
});
})();