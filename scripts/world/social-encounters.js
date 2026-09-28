(function(){
"use strict";

const VERSION="local-social-encounters-v1";
const EVALUATION_INTERVAL_SECONDS=1;
const BUCKET_SIZE_TILES=6;
const MAX_NEIGHBOR_DISTANCE_TILES=3;
const MAX_CANDIDATE_CHECKS=32;
const MAX_ACTIVE_ENCOUNTERS=2;
const MAX_GROUP_SIZE=3;
const GREETING_SECONDS=2.4;
const CONVERSATION_SECONDS=5.5;
const GATHERING_SECONDS=7.0;
const COOLDOWN_FANTASY_MINUTES=20;
const BUSY_ACTIONS=Object.freeze(new Set(["sleep","work","craft","service","eat","cook","store","retrieve"]));

let seedKey="";
let accumulator=0;
let active=new Map();
let residentEncounter=new Map();
let cooldownUntilMinute=new Map();
let sequence=0;
let evaluations=0;
let totalCandidateChecks=0;
let totalUpdateMs=0;
let maxUpdateMs=0;
let declinedBusy=0;
let endedCount=0;
let startedCount=0;
let proofState=null;

function point(value){
  if(!value)return null;
  return Object.freeze({x:String(value.x),y:String(value.y)});
}
function number(value){const n=Number(value);return Number.isFinite(n)?n:0}
function distance(a,b){return Math.abs(number(a?.x)-number(b?.x))+Math.abs(number(a?.y)-number(b?.y))}
function timeParts(when){
  const t=when&&typeof when==="object"?when:(window.GameTime?.getNow?.()||null);
  return t||{year:0,month:1,day:1,hour:0,minute:0,second:0};
}
function fantasyMinute(when){
  const t=timeParts(when);
  return Math.floor(Date.UTC(Number(t.year||0),Math.max(0,Number(t.month||1)-1),Number(t.day||1),Number(t.hour||0),Number(t.minute||0),Number(t.second||0))/60000);
}
function slotKey(when){
  const t=timeParts(when),minute=Math.floor(Number(t.minute||0)/5)*5;
  return [t.year,String(t.month).padStart(2,"0"),String(t.day).padStart(2,"0"),String(t.hour).padStart(2,"0"),String(minute).padStart(2,"0")].join("-");
}
function pairKey(a,b){return [String(a),String(b)].sort().join("|")}
function bucketCoordinate(value){return Math.floor(number(value)/BUCKET_SIZE_TILES)}
function bucketKey(p){return bucketCoordinate(p.x)+","+bucketCoordinate(p.y)}
function navigation(seed,p){
  if(!p)return null;
  return window.InteriorObjects?.classifyNavigation?.(seed,p.x,p.y)||window.Walkability?.classify?.(seed,p.x,p.y)||null;
}
function roadReserved(seed,p){
  try{
    const local=window.StartingVillage?.local?.(seed,p.x,p.y);
    return Boolean(local&&window.StartingVillage?.isRoadReserved?.(seed,local));
  }catch(_){return true}
}
function safeStop(seed,p){
  const nav=navigation(seed,p);
  return Boolean(nav?.walkable&&!nav?.buildingId&&nav?.category!=="entrance"&&nav?.category!=="interior"&&!roadReserved(seed,p));
}
function isBusy(record){
  const action=String(record?.activity?.intendedAction||record?.activity?.action||"").toLowerCase();
  const state=String(record?.activity?.state||"").toLowerCase();
  return Boolean(record?.actionExecution?.holdsPosition||BUSY_ACTIONS.has(action)||state==="sleep"||state==="working"||state==="work");
}
function relationScore(seed,a,b){
  try{
    const rel=window.SocialState?.relationship?.(
      seed,{kind:"resident",id:a.id,label:a.name||a.id},{kind:"resident",id:b.id,label:b.name||b.id}
    );
    const v=rel?.values||{};
    return Number((Number(v.trust??.5)+Number(v.respect??.5)+Number(v.loyalty??.35)-Number(v.suspicion??.25)-Number(v.resentment??.1)).toFixed(4));
  }catch(_){return 1}
}
function decision(seed,when,key,modulo){
  const domain="social-encounter:"+slotKey(when)+":"+key;
  return Number(window.PRNG?.foundationUint32?.(seed,domain)||0)%Math.max(1,Number(modulo)||1);
}
function frozenParticipant(record){
  return Object.freeze({
    id:String(record.id),name:String(record.name||record.id),position:point(record.position),
    profession:String(record.profession||""),activityState:String(record.activity?.state||""),
    intendedAction:String(record.activity?.intendedAction||record.activity?.action||"")
  });
}
function encounterSnapshot(encounter){
  if(!encounter)return null;
  return Object.freeze({
    id:encounter.id,type:encounter.type,label:encounter.label,emote:encounter.emote,
    participantIds:Object.freeze(encounter.participants.map(p=>p.id)),
    participantNames:Object.freeze(encounter.participants.map(p=>p.name)),
    participants:Object.freeze(encounter.participants.map(p=>Object.freeze({...p}))),
    holdsPosition:Boolean(encounter.holdsPosition),blockingRoad:false,blocksDoorway:false,
    elapsedSeconds:Number(encounter.elapsed.toFixed(3)),durationSeconds:encounter.duration,
    remainingSeconds:Number(Math.max(0,encounter.duration-encounter.elapsed).toFixed(3)),
    relationshipScore:encounter.relationshipScore,
    source:encounter.source,
    deterministic:true,simulationAuthority:true,presentationAuthority:false
  });
}
function attachEncounter(encounter){
  active.set(encounter.id,encounter);
  for(const p of encounter.participants)residentEncounter.set(p.id,encounter.id);
  startedCount++;
}
function createEncounter(seed,when,type,records,source="local-spatial-bucket"){
  const participants=records.slice(0,MAX_GROUP_SIZE).map(frozenParticipant);
  const ids=participants.map(p=>p.id).sort();
  const base=pairKey(ids[0]||"",ids[1]||"");
  const rel=records.length>=2?relationScore(seed,records[0],records[1]):1;
  const duration=type==="gathering"?GATHERING_SECONDS:type==="conversation"?CONVERSATION_SECONDS:GREETING_SECONDS;
  const labels={greeting:"Passing greeting",conversation:"Stop-and-talk",gathering:"Small public gathering"};
  const emotes={greeting:"Hello!",conversation:"Talking…",gathering:"Chatting together"};
  const holdsPosition=type!=="greeting";
  const encounter={
    id:"SOCIAL-"+String(++sequence).padStart(4,"0")+"-"+String(window.PRNG?.foundationUint32?.(seed,"social-id:"+slotKey(when)+":"+ids.join("|"))||0).toString(16).toUpperCase(),
    type,label:labels[type]||type,emote:emotes[type]||"Talking",participants,
    holdsPosition,duration,elapsed:0,relationshipScore:rel,source,
    createdFantasyMinute:fantasyMinute(when)
  };
  attachEncounter(encounter);
  return encounter;
}
function finishEncounter(encounter,minute){
  active.delete(encounter.id);
  for(const p of encounter.participants){
    if(residentEncounter.get(p.id)===encounter.id)residentEncounter.delete(p.id);
    cooldownUntilMinute.set(p.id,minute+COOLDOWN_FANTASY_MINUTES);
  }
  endedCount++;
}
function advanceActive(seconds,minute){
  for(const encounter of [...active.values()]){
    encounter.elapsed+=Math.max(0,Number(seconds)||0);
    if(encounter.elapsed+1e-9>=encounter.duration)finishEncounter(encounter,minute);
  }
}
function canConsider(record,minute){
  if(!record?.id||!record.position||residentEncounter.has(String(record.id)))return false;
  return Number(cooldownUntilMinute.get(String(record.id))||-Infinity)<=minute;
}
function candidatePairs(records){
  const buckets=new Map();
  for(const record of records){
    const key=bucketKey(record.position);
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(record);
  }
  for(const list of buckets.values())list.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const pairs=[],seen=new Set();
  const ordered=[...records].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  for(const a of ordered){
    const bx=bucketCoordinate(a.position.x),by=bucketCoordinate(a.position.y);
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
      for(const b of buckets.get((bx+ox)+","+(by+oy))||[]){
        if(String(a.id)>=String(b.id))continue;
        const key=pairKey(a.id,b.id);if(seen.has(key))continue;seen.add(key);
        pairs.push([a,b]);
      }
    }
  }
  return pairs;
}
function evaluate(seed,when,records){
  evaluations++;
  const started=performance.now(),minute=fantasyMinute(when);
  const eligible=records.filter(r=>canConsider(r,minute));
  const pairs=candidatePairs(eligible);
  let checks=0;
  const ranked=[];
  for(const [a,b] of pairs){
    if(checks>=MAX_CANDIDATE_CHECKS)break;
    checks++;
    const d=distance(a.position,b.position);
    if(d>MAX_NEIGHBOR_DISTANCE_TILES)continue;
    if(isBusy(a)||isBusy(b)){declinedBusy++;continue}
    const rel=relationScore(seed,a,b);
    const roll=decision(seed,when,pairKey(a.id,b.id),100);
    ranked.push({a,b,d,rel,roll,rank:rel*100-roll});
  }
  totalCandidateChecks+=checks;
  ranked.sort((x,y)=>y.rank-x.rank||x.d-y.d||pairKey(x.a.id,x.b.id).localeCompare(pairKey(y.a.id,y.b.id)));

  for(const row of ranked){
    if(active.size>=MAX_ACTIVE_ENCOUNTERS)break;
    if(residentEncounter.has(row.a.id)||residentEncounter.has(row.b.id))continue;
    const sameBucket=bucketKey(row.a.position)===bucketKey(row.b.position);
    const third=sameBucket?eligible.find(c=>
      c.id!==row.a.id&&c.id!==row.b.id&&!residentEncounter.has(c.id)&&!isBusy(c)&&
      distance(c.position,row.a.position)<=MAX_NEIGHBOR_DISTANCE_TILES&&
      distance(c.position,row.b.position)<=MAX_NEIGHBOR_DISTANCE_TILES&&
      safeStop(seed,c.position)
    ):null;
    if(third&&safeStop(seed,row.a.position)&&safeStop(seed,row.b.position)&&decision(seed,when,pairKey(row.a.id,row.b.id)+":group",4)===0){
      createEncounter(seed,when,"gathering",[row.a,row.b,third]);
      continue;
    }
    const bothSafe=safeStop(seed,row.a.position)&&safeStop(seed,row.b.position);
    const socialContext=[row.a,row.b].some(r=>String(r.activity?.state||"").toLowerCase()==="social"||String(r.activity?.intendedAction||r.activity?.action||"").toLowerCase()==="social");
    if(bothSafe&&(socialContext||row.roll<55))createEncounter(seed,when,"conversation",[row.a,row.b]);
    else if(row.roll<78)createEncounter(seed,when,"greeting",[row.a,row.b]);
  }
  const elapsed=performance.now()-started;totalUpdateMs+=elapsed;maxUpdateMs=Math.max(maxUpdateMs,elapsed);
}
function reset(seedValue){
  seedKey=String(seedValue==null?"":seedValue);accumulator=0;active=new Map();residentEncounter=new Map();cooldownUntilMinute=new Map();
  sequence=0;evaluations=0;totalCandidateChecks=0;totalUpdateMs=0;maxUpdateMs=0;declinedBusy=0;endedCount=0;startedCount=0;proofState=null;
  return snapshot();
}
function ensure(seedValue){const seed=String(seedValue==null?"":seedValue);if(seed!==seedKey)reset(seed);return Boolean(seed)}
function advance(request){
  const started=performance.now(),seed=String(request?.seed||"");
  if(!ensure(seed))return snapshot();
  const when=request?.when||window.GameTime?.getNow?.();
  const seconds=Math.max(0,Number(request?.seconds)||0),minute=fantasyMinute(when);
  if(!proofState)advanceActive(seconds,minute);
  if(!proofState){
    accumulator+=seconds;
    if(accumulator+1e-9>=EVALUATION_INTERVAL_SECONDS){
      accumulator%=EVALUATION_INTERVAL_SECONDS;
      const records=(Array.isArray(request?.residents)?request.residents:[]).filter(r=>r?.id&&r?.position);
      evaluate(seed,when,records);
    }
  }
  const elapsed=performance.now()-started;totalUpdateMs+=elapsed;maxUpdateMs=Math.max(maxUpdateMs,elapsed);
  return snapshot();
}
function stateFor(residentId){
  const id=String(residentId||""),encounter=active.get(residentEncounter.get(id));
  if(!encounter)return null;
  const snap=encounterSnapshot(encounter);
  return Object.freeze({...snap,residentId:id,partnerIds:Object.freeze(snap.participantIds.filter(x=>x!==id))});
}
function snapshot(){
  const encounters=Object.freeze([...active.values()].map(encounterSnapshot));
  return Object.freeze({
    version:VERSION,seed:seedKey||null,evaluationIntervalSeconds:EVALUATION_INTERVAL_SECONDS,bucketSizeTiles:BUCKET_SIZE_TILES,
    maxNeighborDistanceTiles:MAX_NEIGHBOR_DISTANCE_TILES,maxCandidateChecks:MAX_CANDIDATE_CHECKS,maxActiveEncounters:MAX_ACTIVE_ENCOUNTERS,maxGroupSize:MAX_GROUP_SIZE,
    activeEncounterCount:encounters.length,activeResidentCount:residentEncounter.size,encounters,
    evaluations,totalCandidateChecks,averageCandidateChecks:evaluations?Number((totalCandidateChecks/evaluations).toFixed(3)):0,
    averageUpdateMs:evaluations?Number((totalUpdateMs/evaluations).toFixed(3)):0,maxUpdateMs:Number(maxUpdateMs.toFixed(3)),
    declinedBusy,startedCount,endedCount,fullPopulationPairwiseScan:false,spatialBuckets:true,perFrameCandidateSearch:false,
    externalLlm:false,directPlayerControl:false,relationshipAuthority:"SocialState relationship ledger / deterministic baseline",
    decisionAuthority:"SEED + fantasy 5-minute slot + authoritative resident state",scheduleMutation:false,
    proofActive:Boolean(proofState),simulationAuthority:true,presentationAuthority:false
  });
}
function findProofSites(seed){
  const out=[];
  for(let radius=2;radius<=10&&out.length<6;radius++){
    for(let y=-radius;y<=radius&&out.length<6;y++)for(let x=-radius;x<=radius&&out.length<6;x++){
      if(Math.max(Math.abs(x),Math.abs(y))!==radius)continue;
      const p=point({x,y});if(!safeStop(seed,p))continue;
      if(out.every(q=>distance(q,p)>0&&distance(q,p)<=3||out.length===0))out.push(p);
    }
  }
  if(out.length<3){
    for(let y=-12;y<=12&&out.length<3;y++)for(let x=-12;x<=12&&out.length<3;x++){
      const p=point({x,y});if(safeStop(seed,p)&&out.every(q=>distance(q,p)>0))out.push(p);
    }
  }
  return out;
}
function proofRecord(resident,p,activity){
  return {id:resident.id,name:resident.displayName||resident.name,profession:resident.profession,position:p,activity,actionExecution:null,status:"arrived"};
}
function verify(seedValue){
  const seed=String(seedValue||""),roster=window.DailyActivity?.build?.(seed)||[],sites=findProofSites(seed);
  if(roster.length<4||sites.length<3)return Object.freeze({pass:false,reason:"proof-input-unavailable",residentCount:roster.length,siteCount:sites.length});
  const when={year:1201,month:2,day:1,hour:18,minute:0,second:0};
  const social={state:"social",action:"social",intendedAction:"social"};
  const busy={state:"work",action:"work",intendedAction:"work"};
  reset(seed);
  const a=proofRecord(roster[0],sites[0],social),b=proofRecord(roster[1],sites[1],social),c=proofRecord(roster[2],sites[2],social),d=proofRecord(roster[3],sites[0],busy);
  const conversation=createEncounter(seed,when,"conversation",[a,b],"proof-same-production-contract");
  const conversationSnap=encounterSnapshot(conversation);
  const busySkipped=isBusy(d);
  finishEncounter(conversation,fantasyMinute(when));
  const scheduleRecovered=!residentEncounter.has(a.id)&&!residentEncounter.has(b.id);
  const gathering=createEncounter(seed,when,"gathering",[a,b,c],"proof-same-production-contract");
  const gatheringSnap=encounterSnapshot(gathering);
  const firstSignature=[conversationSnap.type,conversationSnap.participantIds.join(","),gatheringSnap.type,gatheringSnap.participantIds.join(","),sites.map(p=>p.x+","+p.y).join("|")].join("#");
  reset(seed);
  const sites2=findProofSites(seed);
  const secondSignature=["conversation",[roster[0].id,roster[1].id].join(","),"gathering",[roster[0].id,roster[1].id,roster[2].id].join(","),sites2.map(p=>p.x+","+p.y).join("|")].join("#");
  const deterministic=firstSignature===secondSignature;
  const pass=Boolean(deterministic&&conversationSnap.holdsPosition&&gatheringSnap.participantIds.length===3&&busySkipped&&scheduleRecovered&&sites.slice(0,3).every(p=>safeStop(seed,p)));
  reset(seed);
  return Object.freeze({pass,deterministic,busySkipped,scheduleRecovered,noRoadBlocking:sites.slice(0,3).every(p=>!roadReserved(seed,p)),safePublicSites:sites.slice(0,3),conversation:conversationSnap,gathering:gatheringSnap,fullPopulationPairwiseScan:false,maxCandidateChecks:MAX_CANDIDATE_CHECKS,externalLlm:false});
}
function beginProof(seedValue,typeValue="gathering"){
  const seed=String(seedValue||"");reset(seed);
  const roster=window.DailyActivity?.build?.(seed)||[],sites=findProofSites(seed);
  const count=String(typeValue)==="gathering"?3:2;
  if(roster.length<count||sites.length<count)return null;
  const when={year:1201,month:2,day:1,hour:18,minute:0,second:0},activity={state:"social",action:"social",intendedAction:"social"};
  const records=roster.slice(0,count).map((resident,index)=>proofRecord(resident,sites[index],activity));
  const encounter=createEncounter(seed,when,String(typeValue)==="greeting"?"greeting":String(typeValue)==="conversation"?"conversation":"gathering",records,"visual-proof-same-contract");
  proofState={type:encounter.type,positions:records.map(r=>({residentId:r.id,position:r.position}))};
  return Object.freeze({encounter:encounterSnapshot(encounter),positions:Object.freeze(proofState.positions.map(x=>Object.freeze({residentId:x.residentId,position:point(x.position)}))),proof:snapshot(),verification:verify(seed)});
}
function endProof(){proofState=null;return reset(seedKey)}

window.SocialEncounters=Object.freeze({
  VERSION,EVALUATION_INTERVAL_SECONDS,BUCKET_SIZE_TILES,MAX_NEIGHBOR_DISTANCE_TILES,MAX_CANDIDATE_CHECKS,MAX_ACTIVE_ENCOUNTERS,MAX_GROUP_SIZE,
  ensure,reset,advance,stateFor,snapshot,verify,beginProof,endProof
});
})();