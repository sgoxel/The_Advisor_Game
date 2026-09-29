(function(){
"use strict";

const VERSION="density-crowd-v1";
const MAX_ACTIVE_CROWD=32;
const MOBILE_ACTIVE_CROWD=20;
const LOCAL_QUERY_RADIUS_TILES=64;
const MAX_CANDIDATE_CHECKS=192;
const CLASS_CAP=Object.freeze({hamlet:4,village:8,town:16,city:26,"national-capital":32});
const CLASS_POPULATION_RANGE=Object.freeze({hamlet:Object.freeze([35,140]),village:Object.freeze([120,620]),town:Object.freeze([550,3200]),city:Object.freeze([2800,18000]),"national-capital":Object.freeze([14000,65000])});
const CLASS_RADIUS=Object.freeze({hamlet:8,village:13,town:20,city:28,"national-capital":34});
const VISUAL_ROLES=Object.freeze(["market","traveler","laborer","guard","farmer","craft"]);
let lastSnapshot=null;
let placementCache=new Map();

function clamp01(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0}
function unit(seed,key){return Number(window.PRNG?.foundationUint32?.(String(seed),String(key))||0)/4294967295}
function timeParts(when){return when&&typeof when==="object"?when:(window.GameTime?.getNow?.()||{year:0,month:1,day:1,hour:12,minute:0,second:0})}
function distanceTiles(a,b){
  try{
    const dx=Number(BigInt(String(a.x))-BigInt(String(b.x))),dy=Number(BigInt(String(a.y))-BigInt(String(b.y)));
    return Math.hypot(dx,dy);
  }catch(_){return Infinity}
}
function planForRecord(seed,record){
  if(!record)return null;
  try{
    return window.SettlementArchetypes?.build?.(seed,record.center,{
      countryId:record.countryId,role:record.role,classHint:record.classId,nameHint:record.name,canonicalRecord:record
    })||null;
  }catch(_){return null}
}
function resolvePlan(seed,focus){
  if(!focus||!window.SettlementArchetypes?.canonicalSettlementsInBounds)return null;
  const x=BigInt(String(focus.x)),y=BigInt(String(focus.y)),r=BigInt(LOCAL_QUERY_RADIUS_TILES);
  let query=null;
  try{
    query=SettlementArchetypes.canonicalSettlementsInBounds(seed,{
      minX:(x-r).toString(),maxX:(x+r).toString(),minY:(y-r).toString(),maxY:(y+r).toString()
    },["national-capital","city","town","village","hamlet"]);
  }catch(_){query=null}
  const records=(query?.settlements||[]).slice().sort((a,b)=>distanceTiles(a.center,focus)-distanceTiles(b.center,focus)||String(a.id).localeCompare(String(b.id)));
  const record=records.find(item=>distanceTiles(item.center,focus)<=LOCAL_QUERY_RADIUS_TILES)||null;
  return planForRecord(seed,record);
}
function currentPopulation(seed,plan){
  let value=Math.max(0,Math.round(Number(plan?.population?.planned||0)));
  let source="SettlementArchetypes.population.planned";
  try{
    const ref=window.WorldState?.settlementRef?.(seed,plan);
    const resolved=ref?window.WorldState?.resolve?.(seed,ref):null;
    const aggregate=resolved?.current?.state?.aggregate;
    const live=Number(aggregate?.population);
    if(Number.isFinite(live)&&live>=0){value=Math.round(live);source="WorldState.current.state.aggregate.population"}
  }catch(_){}
  return Object.freeze({value,source});
}
function crowdActivity(when){
  const hour=Number(timeParts(when).hour||0)+Number(timeParts(when).minute||0)/60;
  const profile=window.SettlementActivityRhythm?.profileAtHour?.(hour)||{band:"daytime",modifiers:{outdoorResidentShare:.9,marketPublicActivity:.9,ambientTrafficLikelihood:.85}};
  const m=profile.modifiers||{};
  const factor=clamp01(.15+Number(m.ambientTrafficLikelihood||0)*.47+Number(m.marketPublicActivity||0)*.23+Number(m.outdoorResidentShare||0)*.15);
  return Object.freeze({band:String(profile.band||"daytime"),factor,modifiers:m});
}
function populationScale(plan,population){
  const range=CLASS_POPULATION_RANGE[plan.classId]||[1,Math.max(2,population)];
  const lo=Math.max(1,Number(range[0]||1)),hi=Math.max(lo+1,Number(range[1]||lo+1));
  return clamp01((Math.log1p(Math.max(lo,population))-Math.log1p(lo))/(Math.log1p(hi)-Math.log1p(lo)));
}
function desiredCount(plan,population,when,mobile){
  const cap=Math.min(CLASS_CAP[plan.classId]||6,mobile?MOBILE_ACTIVE_CROWD:MAX_ACTIVE_CROWD);
  const activity=crowdActivity(when),scale=populationScale(plan,population);
  const density=.56+.44*scale;
  return Object.freeze({
    count:Math.max(0,Math.min(cap,Math.round(cap*density*activity.factor))),
    cap,activity,populationScale:Number(scale.toFixed(4))
  });
}
function baseCandidates(seed,plan){
  const key=[seed,plan.id,plan.classId,plan.center.x,plan.center.y].join("|");
  const cached=placementCache.get(key);if(cached)return cached;
  const radius=CLASS_RADIUS[plan.classId]||14,out=[];let checks=0;
  const centerX=BigInt(String(plan.center.x)),centerY=BigInt(String(plan.center.y));
  for(let i=0;i<MAX_CANDIDATE_CHECKS;i++){
    checks++;
    const lane=i%5,rank=Math.floor(i/5),u=unit(seed,"crowd:place:u:"+plan.id+":"+i),v=unit(seed,"crowd:place:v:"+plan.id+":"+i);
    let ox=0,oy=0;
    if(lane===0){ox=Math.round((u*2-1)*radius);oy=Math.round((v*2-1)*2)}
    else if(lane===1){ox=Math.round((u*2-1)*2);oy=Math.round((v*2-1)*radius)}
    else{
      const a=u*Math.PI*2,r=Math.max(3,Math.sqrt(v)*radius);
      ox=Math.round(Math.cos(a)*r);oy=Math.round(Math.sin(a)*r);
    }
    ox+=((rank%3)-1);oy+=(((rank>>1)%3)-1);
    const point=Object.freeze({x:(centerX+BigInt(ox)).toString(),y:(centerY+BigInt(oy)).toString()});
    let usable=true,roadPreferred=false;
    try{
      const nav=window.Walkability?.classify?.(seed,point.x,point.y);
      if(nav&&nav.walkable===false)usable=false;
    }catch(_){}
    try{
      const terrain=window.GeographyFoundation?.getTerrainType?.(seed,point.x,point.y);
      if(terrain==="water")usable=false;
    }catch(_){}
    if(plan.role==="starting-village"){
      try{
        const local=window.StartingVillage?.local?.(seed,point.x,point.y);
        roadPreferred=Boolean(local&&window.StartingVillage?.isRoadReserved?.(seed,local));
        if(!roadPreferred&&out.length<48)usable=false;
      }catch(_){}
    }
    if(!usable)continue;
    if(out.some(other=>distanceTiles(other.point,point)<1.4))continue;
    out.push(Object.freeze({point,roadPreferred,rank:i}));
    if(out.length>=MAX_ACTIVE_CROWD*2)break;
  }
  const result=Object.freeze({candidates:Object.freeze(out),candidateChecks:checks,bounded:true});
  placementCache.set(key,result);
  if(placementCache.size>8)placementCache.delete(placementCache.keys().next().value);
  return result;
}
function nearAvoid(point,avoid){
  return (avoid||[]).some(other=>other&&distanceTiles(point,other)<1.6);
}
function motionOffset(seed,planId,slot,when){
  const t=timeParts(when),bucket=(Number(t.minute||0)*6+Math.floor(Number(t.second||0)/10));
  const phase=unit(seed,"crowd:motion:"+planId+":"+slot+":"+bucket)*Math.PI*2;
  const axis=unit(seed,"crowd:axis:"+planId+":"+slot)>.5?1:-1;
  const amount=Math.sin(phase)*.18;
  return Object.freeze({x:Number((amount*axis).toFixed(3)),y:Number((amount*-axis).toFixed(3))});
}
function snapshotForPlan(seedValue,planValue,whenValue,optionsValue){
  const started=typeof performance!=="undefined"&&performance.now?performance.now():0;
  const seed=String(seedValue==null?"":seedValue),plan=planValue,when=timeParts(whenValue),options=optionsValue||{};
  if(!seed||!plan?.id||!CLASS_CAP[plan.classId]){
    const empty=Object.freeze({version:VERSION,active:false,activeCount:0,requestedCount:0,specs:Object.freeze([]),presentationOnly:true,simulationAuthority:false,persistentIdentity:false,selectable:false,collision:false,fullSettlementPerFrameScan:false});
    lastSnapshot=empty;return empty;
  }
  const population=currentPopulation(seed,plan),density=desiredCount(plan,population.value,when,Boolean(options.mobile));
  const placement=baseCandidates(seed,plan),avoid=Array.isArray(options.avoidPoints)?options.avoidPoints:[];
  const specs=[];
  for(const candidate of placement.candidates){
    if(specs.length>=density.count)break;
    if(nearAvoid(candidate.point,avoid))continue;
    const slot=specs.length,visualRole=VISUAL_ROLES[Math.floor(unit(seed,"crowd:role:"+plan.id+":"+slot)*VISUAL_ROLES.length)%VISUAL_ROLES.length];
    specs.push(Object.freeze({
      id:"crowd:"+plan.id+":"+slot,role:"crowd",visualRole,
      point:candidate.point,presentationOffset:motionOffset(seed,plan.id,slot,when),
      flipX:unit(seed,"crowd:flip:"+plan.id+":"+slot)>.5,height:1.52,elevation:.02,
      presentationOnly:true,persistentIdentity:false,selectable:false,collision:false,authoritativeNpc:false
    }));
  }
  const elapsed=started&&performance.now?performance.now()-started:0;
  const result=Object.freeze({
    version:VERSION,active:true,seed,settlementId:String(plan.id),settlementName:String(plan.name||plan.id),
    settlementClass:String(plan.classId),population:population.value,populationSource:population.source,
    populationScale:density.populationScale,rhythmBand:density.activity.band,activityFactor:Number(density.activity.factor.toFixed(4)),
    requestedCount:density.count,activeCount:specs.length,cap:density.cap,poolCapacity:density.cap,
    candidateChecks:placement.candidateChecks,maxCandidateChecks:MAX_CANDIDATE_CHECKS,
    updateMs:Number(elapsed.toFixed(3)),specs:Object.freeze(specs),
    pooledStableIds:true,localCulling:true,lowFrequencyMotion:true,
    presentationOnly:true,simulationAuthority:false,persistentIdentity:false,selectable:false,collision:false,
    exactNpcReplacement:false,fullSettlementPerFrameScan:false,globalScan:false
  });
  lastSnapshot=result;return result;
}
function snapshot(seedValue,whenValue,focusValue,optionsValue){
  const seed=String(seedValue==null?"":seedValue),plan=resolvePlan(seed,focusValue);
  return snapshotForPlan(seed,plan,whenValue,optionsValue);
}
function representativePlans(seedValue){
  const seed=String(seedValue==null?"":seedValue),out={};
  try{
    const proof=SettlementArchetypes.proof(seed);
    for(const item of proof?.representatives||[]){
      const p=item?.plan;if(p&&["village","town","city"].includes(p.classId)&&!out[p.classId])out[p.classId]=p;
    }
    if(!out.village||!out.town||!out.city){
      const span=40000n;
      const query=SettlementArchetypes.canonicalSettlementsInBounds(seed,{
        minX:(-span).toString(),maxX:span.toString(),minY:(-span).toString(),maxY:span.toString()
      },["city","town","village"]);
      for(const record of query?.settlements||[]){
        if(!["village","town","city"].includes(record.classId)||out[record.classId])continue;
        const p=planForRecord(seed,record);if(p)out[p.classId]=p;
      }
    }
  }catch(_){}
  return Object.freeze(out);
}
function verify(seedValue){
  const seed=String(seedValue||"WP-S004-010-VERIFY"),plans=representativePlans(seed);
  const midday={year:1201,month:2,day:1,hour:12,minute:0,second:0},night={...midday,hour:23};
  if(!plans.village||!plans.town||!plans.city)return Object.freeze({pass:false,reason:"representative-plans-missing",classes:Object.keys(plans)});
  const day={},nightRows={};
  for(const cls of ["village","town","city"]){
    day[cls]=snapshotForPlan(seed,plans[cls],midday,{mobile:false,avoidPoints:[]});
    nightRows[cls]=snapshotForPlan(seed,plans[cls],night,{mobile:false,avoidPoints:[]});
  }
  const repeat=snapshotForPlan(seed,plans.city,midday,{mobile:false,avoidPoints:[]});
  const deterministic=JSON.stringify(day.city.specs)===JSON.stringify(repeat.specs);
  const densityOrder=day.village.activeCount<day.town.activeCount&&day.town.activeCount<day.city.activeCount;
  const timeOrder=nightRows.city.activeCount<day.city.activeCount;
  const authority=[...Object.values(day),...Object.values(nightRows)].every(row=>row.presentationOnly&&!row.simulationAuthority&&!row.persistentIdentity&&!row.selectable&&!row.collision&&!row.exactNpcReplacement&&row.fullSettlementPerFrameScan===false&&row.activeCount<=row.cap&&row.candidateChecks<=MAX_CANDIDATE_CHECKS);
  return Object.freeze({pass:Boolean(deterministic&&densityOrder&&timeOrder&&authority),deterministic,densityOrder,timeOrder,authority,day:Object.freeze(day),night:Object.freeze(nightRows),maxActiveCrowd:MAX_ACTIVE_CROWD,mobileActiveCrowd:MOBILE_ACTIVE_CROWD});
}
function reset(){placementCache=new Map();lastSnapshot=null}

window.CrowdPresentation=Object.freeze({
  VERSION,MAX_ACTIVE_CROWD,MOBILE_ACTIVE_CROWD,MAX_CANDIDATE_CHECKS,CLASS_CAP,CLASS_POPULATION_RANGE,
  resolvePlan,currentPopulation,snapshot,snapshotForPlan,representativePlans,verify,last:()=>lastSnapshot,reset
});
})();