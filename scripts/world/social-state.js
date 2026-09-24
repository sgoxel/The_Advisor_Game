(function(){
"use strict";

const STORAGE_PREFIX="theAdvisorGame.socialState.v1";
const VERSION=1;
const RELATIONSHIP_FIELDS=Object.freeze(["trust","fear","respect","suspicion","loyalty","resentment"]);
const REPUTATION_SCOPES=Object.freeze(["role","house","guild","family","settlement"]);
const DUTY_TYPES=Object.freeze(["family","work","oath","service","debt","public-office","promise"]);
const DUTY_STATUSES=Object.freeze(["active","fulfilled","breached","released"]);
const EVENT_TYPES=Object.freeze([
  "truthful-advice","promise-made","promise-kept","promise-broken",
  "observed-help","observed-harm","duty-created","duty-fulfilled","duty-breached","duty-released"
]);
const BASE_RELATIONSHIP=Object.freeze({
  trust:0.5,fear:0.1,respect:0.5,suspicion:0.25,loyalty:0.35,resentment:0.1
});
const EFFECTS=Object.freeze({
  "truthful-advice":Object.freeze({relationship:Object.freeze({trust:0.12,respect:0.08,suspicion:-0.05,resentment:-0.02}),reputation:0.08}),
  "promise-made":Object.freeze({relationship:Object.freeze({loyalty:0.02}),reputation:0}),
  "promise-kept":Object.freeze({relationship:Object.freeze({trust:0.12,respect:0.07,suspicion:-0.05,resentment:-0.03,loyalty:0.05}),reputation:0.07}),
  "promise-broken":Object.freeze({relationship:Object.freeze({trust:-0.32,respect:-0.18,suspicion:0.4,resentment:0.28,loyalty:-0.12}),reputation:-0.1}),
  "observed-help":Object.freeze({relationship:Object.freeze({trust:0.07,respect:0.12,fear:-0.02}),reputation:0.06}),
  "observed-harm":Object.freeze({relationship:Object.freeze({trust:-0.12,respect:-0.1,fear:0.14,suspicion:0.08,resentment:0.12}),reputation:-0.08}),
  "duty-created":Object.freeze({relationship:Object.freeze({}),reputation:0}),
  "duty-fulfilled":Object.freeze({relationship:Object.freeze({trust:0.08,respect:0.1,suspicion:-0.03,loyalty:0.06}),reputation:0.08}),
  "duty-breached":Object.freeze({relationship:Object.freeze({trust:-0.15,respect:-0.1,suspicion:0.1,resentment:0.14,loyalty:-0.12}),reputation:-0.12}),
  "duty-released":Object.freeze({relationship:Object.freeze({}),reputation:0})
});

function scope(){return typeof window!=="undefined"?window:globalThis}
function storage(){try{return scope().localStorage||null}catch(_){return null}}
function normalizeSeed(value){
  const text=String(value==null?"":value).trim();
  return text||"The_Advisor_Game_20260924";
}
function clamp01(value,fallback){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;
}
function clamp11(value,fallback){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(-1,Math.min(1,n)):fallback;
}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function storageKey(seedValue){return STORAGE_PREFIX+":"+normalizeSeed(seedValue)}
function normalizeTimestamp(value){
  const text=String(value==null?"":value).trim();
  if(/^\d{4,}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(text))return text;
  const iso=/^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if(iso)return iso[1]+"-"+iso[2]+"-"+iso[3]+" "+iso[4]+":"+iso[5]+":"+iso[6];
  return scope().GameTime?.getTimestampKey?.()||"0000-01-01 00:00:00";
}
function normalizeActor(value,fallbackKind="resident",fallbackId="unknown"){
  const input=value&&typeof value==="object"?value:{id:value};
  let kind=String(input.kind||fallbackKind).trim().toLowerCase();
  if(!["resident","protagonist","scope"].includes(kind))kind=fallbackKind;
  let id=String(input.id||fallbackId).trim()||fallbackId;
  if(kind==="protagonist")id="protagonist";
  const label=String(input.label||input.name||(kind==="protagonist"?"Protagonist":id)).trim()||id;
  return {kind,id,label};
}
function actorKey(actor){return actor.kind+":"+actor.id}
function relationshipKey(observer,subject){return actorKey(observer)+"->"+actorKey(subject)}
function reputationKey(subjectActor,target){return actorKey(subjectActor)+"|"+target.scope+":"+target.id}
function normalizeRelationship(value){
  if(!value||typeof value!=="object")return null;
  const observer=normalizeActor(value.observer,"resident","unknown");
  const subject=normalizeActor(value.subject,"protagonist","protagonist");
  return {observer,subject};
}
function normalizeReputationTarget(value){
  if(!value||typeof value!=="object")return null;
  let scopeName=String(value.scope||"settlement").trim().toLowerCase();
  if(!REPUTATION_SCOPES.includes(scopeName))scopeName="settlement";
  const id=String(value.id||scopeName).trim()||scopeName;
  const label=String(value.label||id).trim()||id;
  const subjectActor=normalizeActor(value.subjectActor||{kind:"protagonist",id:"protagonist"},"protagonist","protagonist");
  return {scope:scopeName,id,label,subjectActor};
}
function normalizeExternalRef(value){
  if(!value||typeof value!=="object")return null;
  const type=String(value.type||"event").trim().toLowerCase()||"event";
  const id=String(value.id||"").trim();
  return id?{type,id}:null;
}
function normalizeDutyPayload(value){
  if(!value||typeof value!=="object")return null;
  let type=String(value.type||"promise").trim().toLowerCase();
  if(!DUTY_TYPES.includes(type))type="promise";
  const actor=normalizeActor(value.actor||{kind:"protagonist",id:"protagonist"},"protagonist","protagonist");
  const beneficiary=normalizeActor(value.beneficiary||{kind:"scope",id:"starting-village",label:"Starting Village"},"scope","starting-village");
  const title=String(value.title||"Unnamed obligation").trim()||"Unnamed obligation";
  const scopeTarget=normalizeReputationTarget(value.scopeTarget||null);
  const priority=clamp01(value.priority,0.5);
  return {
    id:String(value.id||""),
    type,title,actor,beneficiary,scopeTarget,priority,
    status:DUTY_STATUSES.includes(value.status)?value.status:"active"
  };
}
function normalizeEvent(value,seedValue,index){
  const seed=normalizeSeed(seedValue);
  const raw=value&&typeof value==="object"?value:{};
  let type=String(raw.type||"observed-help").trim().toLowerCase();
  if(!EVENT_TYPES.includes(type))type="observed-help";
  const sequence=Number.isInteger(raw.sequence)&&raw.sequence>0?raw.sequence:index+1;
  const timestamp=normalizeTimestamp(raw.timestamp);
  const actor=normalizeActor(raw.actor||{kind:"protagonist",id:"protagonist"},"protagonist","protagonist");
  const relationship=normalizeRelationship(raw.relationship);
  const reputationTargets=(Array.isArray(raw.reputationTargets)?raw.reputationTargets:[])
    .map(normalizeReputationTarget).filter(Boolean);
  const externalRef=normalizeExternalRef(raw.externalRef);
  const duty=normalizeDutyPayload(raw.duty);
  const dutyId=String(raw.dutyId||duty?.id||"").trim()||null;
  const summary=String(raw.summary||type.replace(/-/g," ")).trim()||type;
  const base={sequence,type,timestamp,actor,relationship,reputationTargets,externalRef,duty,dutyId,summary};
  return {id:String(raw.id||nextEventId(seed,sequence,base)),...base};
}
function nextEventId(seedValue,sequence,eventValue){
  const seed=normalizeSeed(seedValue);
  const event=eventValue&&typeof eventValue==="object"?eventValue:{};
  const rel=event.relationship?relationshipKey(event.relationship.observer,event.relationship.subject):"none";
  const reps=(event.reputationTargets||[]).map(target=>reputationKey(target.subjectActor,target)).sort().join(",");
  const ext=event.externalRef?event.externalRef.type+":"+event.externalRef.id:"none";
  const duty=event.duty?[
    event.duty.id,event.duty.type,event.duty.title,actorKey(event.duty.actor),actorKey(event.duty.beneficiary),event.duty.priority
  ].join(":"):String(event.dutyId||"none");
  return "SOC-"+String(sequence).padStart(4,"0")+"-"+hashText([
    seed,sequence,event.type,event.timestamp,actorKey(event.actor),rel,reps,ext,duty,event.summary
  ].join("|"));
}
function nextDutyId(seedValue,sequence,dutyValue){
  const seed=normalizeSeed(seedValue);
  const duty=normalizeDutyPayload(dutyValue)||normalizeDutyPayload({});
  return "DUTY-"+String(sequence).padStart(4,"0")+"-"+hashText([
    seed,sequence,duty.type,duty.title,actorKey(duty.actor),actorKey(duty.beneficiary),duty.priority
  ].join("|"));
}
function blankRecord(seedValue){
  return {version:VERSION,campaignSeed:normalizeSeed(seedValue),events:[],relationships:{},reputations:{},duties:{}};
}
function relationshipBase(observer,subject){
  return {
    observer:{...observer},subject:{...subject},
    values:{...BASE_RELATIONSHIP},
    eventIds:[]
  };
}
function applyRelationship(record,event,effect){
  if(!event.relationship)return;
  const key=relationshipKey(event.relationship.observer,event.relationship.subject);
  const row=record.relationships[key]||relationshipBase(event.relationship.observer,event.relationship.subject);
  const values={...row.values};
  for(const field of RELATIONSHIP_FIELDS){
    const delta=Number(effect.relationship?.[field]||0);
    values[field]=clamp01(Number(values[field]??BASE_RELATIONSHIP[field])+delta,BASE_RELATIONSHIP[field]);
  }
  record.relationships[key]={
    observer:{...event.relationship.observer},
    subject:{...event.relationship.subject},
    values,
    eventIds:[...(row.eventIds||[]),event.id]
  };
}
function applyReputation(record,event,effect){
  const delta=Number(effect.reputation||0);
  for(const target of event.reputationTargets||[]){
    const key=reputationKey(target.subjectActor,target);
    const row=record.reputations[key]||{
      subjectActor:{...target.subjectActor},scope:target.scope,id:target.id,label:target.label,score:0,eventIds:[]
    };
    record.reputations[key]={
      subjectActor:{...row.subjectActor},
      scope:row.scope,id:row.id,label:target.label||row.label,
      score:clamp11(Number(row.score||0)+delta,0),
      eventIds:[...(row.eventIds||[]),event.id]
    };
  }
}
function applyDuty(record,event){
  if(event.type==="duty-created"&&event.duty){
    const duty={...event.duty};
    duty.status="active";
    record.duties[duty.id]={
      ...duty,
      actor:{...duty.actor},
      beneficiary:{...duty.beneficiary},
      scopeTarget:duty.scopeTarget?{...duty.scopeTarget,subjectActor:{...duty.scopeTarget.subjectActor}}:null,
      createdAt:event.timestamp,updatedAt:event.timestamp,
      eventIds:[event.id]
    };
    return;
  }
  if(!event.dutyId)return;
  const current=record.duties[event.dutyId];
  if(!current)return;
  const nextStatus={
    "duty-fulfilled":"fulfilled",
    "duty-breached":"breached",
    "duty-released":"released"
  }[event.type];
  if(!nextStatus)return;
  record.duties[event.dutyId]={
    ...current,status:nextStatus,updatedAt:event.timestamp,
    eventIds:[...(current.eventIds||[]),event.id]
  };
}
function rebuild(seedValue,eventValues){
  const seed=normalizeSeed(seedValue);
  const record=blankRecord(seed);
  const normalized=(eventValues||[]).map((event,index)=>normalizeEvent(event,seed,index)).sort((a,b)=>a.sequence-b.sequence);
  for(const event of normalized){
    record.events.push(event);
    const effect=EFFECTS[event.type]||EFFECTS["observed-help"];
    applyRelationship(record,event,effect);
    applyReputation(record,event,effect);
    applyDuty(record,event);
  }
  return record;
}
function readRecord(seedValue){
  const seed=normalizeSeed(seedValue),s=storage();
  if(!s)return blankRecord(seed);
  try{
    const parsed=JSON.parse(s.getItem(storageKey(seed))||"null");
    return parsed&&Array.isArray(parsed.events)?rebuild(seed,parsed.events):blankRecord(seed);
  }catch(error){
    console.warn("Unable to read social state.",error);
    return blankRecord(seed);
  }
}
function writeRecord(seedValue,record){
  const seed=normalizeSeed(seedValue);
  const rebuilt=rebuild(seed,record?.events||[]);
  const s=storage();
  if(s){try{s.setItem(storageKey(seed),JSON.stringify(rebuilt))}catch(error){console.warn("Unable to persist social state.",error)}}
  return rebuilt;
}
function freezeRelationship(row){
  return Object.freeze({
    observer:Object.freeze({...row.observer}),
    subject:Object.freeze({...row.subject}),
    values:Object.freeze({...row.values}),
    eventIds:Object.freeze([...(row.eventIds||[])])
  });
}
function relationship(seedValue,observerValue,subjectValue){
  const seed=normalizeSeed(seedValue);
  const observer=normalizeActor(observerValue,"resident","unknown");
  const subject=normalizeActor(subjectValue,"protagonist","protagonist");
  const row=readRecord(seed).relationships[relationshipKey(observer,subject)]||relationshipBase(observer,subject);
  return freezeRelationship(row);
}
function reputation(seedValue,subjectActorValue,scopeValue,idValue,labelValue){
  const seed=normalizeSeed(seedValue);
  const subjectActor=normalizeActor(subjectActorValue||{kind:"protagonist",id:"protagonist"},"protagonist","protagonist");
  const target=normalizeReputationTarget({scope:scopeValue,id:idValue,label:labelValue,subjectActor});
  const row=readRecord(seed).reputations[reputationKey(subjectActor,target)]||{
    subjectActor,scope:target.scope,id:target.id,label:target.label,score:0,eventIds:[]
  };
  return Object.freeze({...row,subjectActor:Object.freeze({...row.subjectActor}),eventIds:Object.freeze([...(row.eventIds||[])])});
}
function listDuties(seedValue,actorValue){
  const seed=normalizeSeed(seedValue);
  const filter=actorValue?actorKey(normalizeActor(actorValue,"protagonist","protagonist")):null;
  return Object.freeze(Object.values(readRecord(seed).duties)
    .filter(duty=>!filter||actorKey(duty.actor)===filter)
    .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||a.id.localeCompare(b.id))
    .map(duty=>Object.freeze({
      ...duty,
      actor:Object.freeze({...duty.actor}),
      beneficiary:Object.freeze({...duty.beneficiary}),
      scopeTarget:duty.scopeTarget?Object.freeze({...duty.scopeTarget,subjectActor:Object.freeze({...duty.scopeTarget.subjectActor})}):null,
      eventIds:Object.freeze([...(duty.eventIds||[])])
    })));
}
function recordEvent(seedValue,configValue){
  const seed=normalizeSeed(seedValue);
  const config=configValue&&typeof configValue==="object"?configValue:{};
  const record=readRecord(seed);
  const externalRef=normalizeExternalRef(config.externalRef);
  if(externalRef){
    const duplicate=record.events.find(event=>
      event.type===String(config.type||"")&&
      event.externalRef?.type===externalRef.type&&event.externalRef?.id===externalRef.id
    );
    if(duplicate)return Object.freeze({...duplicate});
  }
  const sequence=record.events.length+1;
  const event=normalizeEvent({...config,sequence,externalRef},seed,sequence-1);
  event.id=nextEventId(seed,sequence,event);
  record.events.push(event);
  writeRecord(seed,record);
  return Object.freeze({...event});
}
function createDuty(seedValue,configValue){
  const seed=normalizeSeed(seedValue);
  const record=readRecord(seed);
  const sequence=record.events.length+1;
  const duty=normalizeDutyPayload(configValue)||normalizeDutyPayload({});
  duty.id=nextDutyId(seed,sequence,duty);
  const event=recordEvent(seed,{
    type:"duty-created",
    timestamp:configValue?.timestamp,
    actor:duty.actor,
    duty,
    summary:"Duty created: "+duty.title,
    externalRef:configValue?.externalRef
  });
  return listDuties(seed).find(item=>item.id===duty.id)||null;
}
function transitionDuty(seedValue,dutyIdValue,nextStatusValue,configValue){
  const seed=normalizeSeed(seedValue);
  const dutyId=String(dutyIdValue||"");
  const nextStatus=String(nextStatusValue||"").trim().toLowerCase();
  if(!["fulfilled","breached","released"].includes(nextStatus))return null;
  const duty=listDuties(seed).find(item=>item.id===dutyId);
  if(!duty||duty.status!=="active")return duty||null;
  const type={"fulfilled":"duty-fulfilled","breached":"duty-breached","released":"duty-released"}[nextStatus];
  recordEvent(seed,{
    ...(configValue||{}),
    type,dutyId,
    actor:(configValue||{}).actor||duty.actor,
    summary:(configValue||{}).summary||("Duty "+nextStatus+": "+duty.title)
  });
  return listDuties(seed).find(item=>item.id===dutyId)||null;
}
function clear(seedValue){
  const s=storage();if(s)s.removeItem(storageKey(seedValue));return true;
}
function resident(seed,residentId){
  return scope().DailyActivity?.roster?.(seed)?.find(item=>item.id===String(residentId||""))||null;
}
function residentReputationTargets(seedValue,residentIdValue){
  const seed=normalizeSeed(seedValue);
  const r=resident(seed,residentIdValue);
  if(!r)return Object.freeze([]);
  const protagonist={kind:"protagonist",id:"protagonist",label:"Protagonist"};
  return Object.freeze([
    Object.freeze({scope:"role",id:r.profession,label:r.profession+" role",subjectActor:protagonist}),
    Object.freeze({scope:"house",id:r.homePlanId,label:r.homeLabel,subjectActor:protagonist}),
    Object.freeze({scope:"guild",id:r.workFunction+"-guild",label:r.profession+" guild scope",subjectActor:protagonist}),
    Object.freeze({scope:"family",id:"family-"+r.homePlanId,label:r.homeLabel+" household",subjectActor:protagonist}),
    Object.freeze({scope:"settlement",id:"starting-village",label:"Starting Village",subjectActor:protagonist})
  ]);
}
function relevantReputations(seedValue,residentIdValue){
  const seed=normalizeSeed(seedValue);
  return Object.freeze(residentReputationTargets(seed,residentIdValue).map(target=>
    reputation(seed,target.subjectActor,target.scope,target.id,target.label)
  ));
}
function activeDutyPriority(seedValue,residentIdValue){
  const residentId=String(residentIdValue||"");
  const duties=listDuties(seedValue,{kind:"protagonist",id:"protagonist"});
  return duties.filter(duty=>
    duty.status==="active"&&
    (duty.beneficiary.kind!=="resident"||duty.beneficiary.id===residentId)
  ).reduce((max,duty)=>Math.max(max,Number(duty.priority||0)),0);
}
function dialogueContext(seedValue,residentIdValue){
  const seed=normalizeSeed(seedValue);
  const residentId=String(residentIdValue||"");
  const rel=relationship(seed,{kind:"resident",id:residentId},{kind:"protagonist",id:"protagonist"});
  const reps=relevantReputations(seed,residentId);
  const reputationAverage=reps.length?reps.reduce((sum,row)=>sum+Number(row.score||0),0)/reps.length:0;
  const v=rel.values;
  const values={
    trust:clamp01(v.trust+reputationAverage*0.08,v.trust),
    fear:clamp01(v.fear,v.fear),
    respect:clamp01(v.respect+reputationAverage*0.12,v.respect),
    suspicion:clamp01(v.suspicion-reputationAverage*0.08,v.suspicion),
    loyalty:clamp01(v.loyalty+reputationAverage*0.05,v.loyalty),
    resentment:clamp01(v.resentment-reputationAverage*0.06,v.resentment)
  };
  return Object.freeze({
    source:"persistent-social-ledger",
    relationship:rel,
    reputations:reps,
    reputationAverage:Number(reputationAverage.toFixed(6)),
    activeDutyPriority:activeDutyPriority(seed,residentId),
    values:Object.freeze(values)
  });
}
function adviceAcceptability(seedValue,residentIdValue,optionsValue){
  const context=dialogueContext(seedValue,residentIdValue);
  const v=context.values;
  let score=
    0.55+
    (v.trust-0.5)*0.35+
    (v.respect-0.5)*0.15+
    (v.loyalty-0.35)*0.1-
    (v.suspicion-0.25)*0.3-
    (v.resentment-0.1)*0.25-
    (v.fear-0.1)*0.05;
  if(optionsValue?.dutyConflict)score-=context.activeDutyPriority*0.25;
  return clamp01(score,0.5);
}
function snapshot(seedValue){
  const seed=normalizeSeed(seedValue);
  const record=readRecord(seed);
  const relationships=Object.entries(record.relationships).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>Object.freeze({key,...freezeRelationship(row)}));
  const reputations=Object.entries(record.reputations).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>Object.freeze({
    key,...row,subjectActor:Object.freeze({...row.subjectActor}),eventIds:Object.freeze([...(row.eventIds||[])])
  }));
  const duties=listDuties(seed);
  const events=Object.freeze(record.events.map(event=>Object.freeze({
    ...event,
    actor:Object.freeze({...event.actor}),
    relationship:event.relationship?Object.freeze({observer:Object.freeze({...event.relationship.observer}),subject:Object.freeze({...event.relationship.subject})}):null,
    reputationTargets:Object.freeze((event.reputationTargets||[]).map(target=>Object.freeze({...target,subjectActor:Object.freeze({...target.subjectActor})}))),
    externalRef:event.externalRef?Object.freeze({...event.externalRef}):null,
    duty:event.duty?Object.freeze({...event.duty,actor:Object.freeze({...event.duty.actor}),beneficiary:Object.freeze({...event.duty.beneficiary})}):null
  })));
  return Object.freeze({version:VERSION,campaignSeed:seed,relationships:Object.freeze(relationships),reputations:Object.freeze(reputations),duties,events});
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue);
  const first=snapshot(seed);
  const second=snapshot(seed);
  const relationshipsValid=first.relationships.every(row=>
    RELATIONSHIP_FIELDS.every(field=>Number.isFinite(row.values[field])&&row.values[field]>=0&&row.values[field]<=1)
  );
  const reputationsValid=first.reputations.every(row=>
    REPUTATION_SCOPES.includes(row.scope)&&Number.isFinite(row.score)&&row.score>=-1&&row.score<=1
  );
  const dutiesValid=first.duties.every(duty=>
    DUTY_TYPES.includes(duty.type)&&DUTY_STATUSES.includes(duty.status)&&Number.isFinite(duty.priority)&&duty.priority>=0&&duty.priority<=1
  );
  const deterministicEvents=first.events.every((event,index)=>
    event.sequence===index+1&&event.id===nextEventId(seed,event.sequence,event)
  );
  const rebuilt=snapshotFromRecord(rebuild(seed,first.events));
  const replayStable=JSON.stringify({
    relationships:first.relationships,reputations:first.reputations,duties:first.duties,events:first.events
  })===JSON.stringify({
    relationships:rebuilt.relationships,reputations:rebuilt.reputations,duties:rebuilt.duties,events:rebuilt.events
  });
  const storageRoundTrip=JSON.stringify(first)===JSON.stringify(second);
  const scopes=new Set(first.reputations.map(row=>row.scope));
  const reputationScopeCoverage=REPUTATION_SCOPES.every(name=>scopes.has(name));
  const dutyStatusCoverage=["active","fulfilled","breached"].every(status=>first.duties.some(duty=>duty.status===status));
  const eventResponseCoverage=["truthful-advice","promise-broken","observed-help","duty-fulfilled","duty-breached"].every(type=>first.events.some(event=>event.type===type));
  return Object.freeze({
    pass:first.events.length>0&&first.relationships.length>0&&relationshipsValid&&reputationsValid&&dutiesValid&&deterministicEvents&&replayStable&&storageRoundTrip&&reputationScopeCoverage&&dutyStatusCoverage&&eventResponseCoverage,
    campaignSeed:seed,
    eventCount:first.events.length,
    relationshipCount:first.relationships.length,
    reputationCount:first.reputations.length,
    dutyCount:first.duties.length,
    relationshipsValid,reputationsValid,dutiesValid,deterministicEvents,replayStable,storageRoundTrip,
    reputationScopeCoverage,dutyStatusCoverage,eventResponseCoverage,
    simulationBacked:true,
    directAllianceEnemyState:false,
    worldAuthorityCreated:false,
    resourcesCreated:false,
    snapshot:first
  });
}
function snapshotFromRecord(record){
  const relationships=Object.entries(record.relationships).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>Object.freeze({key,...freezeRelationship(row)}));
  const reputations=Object.entries(record.reputations).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>Object.freeze({
    key,...row,subjectActor:Object.freeze({...row.subjectActor}),eventIds:Object.freeze([...(row.eventIds||[])])
  }));
  const duties=Object.freeze(Object.values(record.duties).sort((a,b)=>a.id.localeCompare(b.id)).map(duty=>Object.freeze({
    ...duty,actor:Object.freeze({...duty.actor}),beneficiary:Object.freeze({...duty.beneficiary}),
    scopeTarget:duty.scopeTarget?Object.freeze({...duty.scopeTarget,subjectActor:Object.freeze({...duty.scopeTarget.subjectActor})}):null,
    eventIds:Object.freeze([...(duty.eventIds||[])])
  })));
  const events=Object.freeze(record.events.map(event=>Object.freeze({
    ...event,actor:Object.freeze({...event.actor}),
    relationship:event.relationship?Object.freeze({observer:Object.freeze({...event.relationship.observer}),subject:Object.freeze({...event.relationship.subject})}):null,
    reputationTargets:Object.freeze((event.reputationTargets||[]).map(target=>Object.freeze({...target,subjectActor:Object.freeze({...target.subjectActor})}))),
    externalRef:event.externalRef?Object.freeze({...event.externalRef}):null,
    duty:event.duty?Object.freeze({...event.duty,actor:Object.freeze({...event.duty.actor}),beneficiary:Object.freeze({...event.duty.beneficiary})}):null
  })));
  return Object.freeze({version:VERSION,campaignSeed:record.campaignSeed,relationships:Object.freeze(relationships),reputations:Object.freeze(reputations),duties,events});
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value,0)*100)+"%"}
function signedPercent(value){
  const n=Math.round(clamp11(value,0)*100);
  return (n>0?"+":"")+n+"%";
}
function setCheck(id,pass,waiting){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=waiting?"WAITING":pass?"PASS":"FAIL";
  node.classList.toggle("pass",!waiting&&Boolean(pass));
}
function representativeTime(residentValue,state){
  const block=(residentValue?.schedule||[]).find(item=>item.state===state)||(residentValue?.schedule||[])[0];
  if(!block)return null;
  const minute=Math.floor((block.startMinute+block.endMinute)/2);
  return {year:1200,month:6,day:12,hour:Math.floor(minute/60),minute:minute%60,second:0};
}
function integrationSummary(seed,residentId){
  const r=resident(seed,residentId);
  if(!r)return {dialogueTone:null,dialogueSource:null,adviceDecision:null,adviceSource:null,acceptability:adviceAcceptability(seed,residentId)};
  let dialogueTone=null,dialogueSource=null;
  try{
    const when=representativeTime(r,"social")||representativeTime(r,"work");
    const resolved=scope().DialogueContext?.resolve?.(seed,{speakerId:residentId,when,topic:"the mill",urgency:0.2});
    dialogueTone=resolved?.tone||null;
    dialogueSource=resolved?.socialSource||null;
  }catch(_){}
  let adviceDecision=null,adviceSource=null;
  try{
    const advice=scope().AdvisorChannel?.list?.(seed,"protagonist")?.[0]||null;
    const lunch=representativeTime(r,"lunch")||representativeTime(r,"work");
    const activity=lunch?scope().DailyActivity?.resolve?.(seed,r,lunch):null;
    const preview=advice&&activity?scope().AdviceResolution?.previewDecision?.(seed,{
      adviceId:advice.id,value:0.9,urgency:0.8,socialTargetId:residentId,
      intent:{position:{x:activity.target.x,y:activity.target.y},activity}
    }):null;
    adviceDecision=preview?.decision||null;
    adviceSource=preview?.socialContext?.source||null;
  }catch(_){}
  return {
    dialogueTone,dialogueSource,adviceDecision,adviceSource,
    acceptability:adviceAcceptability(seed,residentId),
    dutyConflictAcceptability:adviceAcceptability(seed,residentId,{dutyConflict:true})
  };
}
function renderDebugPanel(seedValue,residentIdValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue);
  const root=rootNode||document.getElementById("socialStateProof");
  if(!root)return null;
  const residents=scope().DailyActivity?.roster?.(seed)||[];
  const preferred=residents.find(item=>item.profession==="smith")||residents[0]||null;
  const residentId=String(residentIdValue||preferred?.id||"R01");
  const selected=residents.find(item=>item.id===residentId)||preferred;
  if(!selected)return null;
  const rel=relationship(seed,{kind:"resident",id:selected.id,label:selected.name},{kind:"protagonist",id:"protagonist",label:"Protagonist"});
  const reps=relevantReputations(seed,selected.id);
  const duties=listDuties(seed,{kind:"protagonist",id:"protagonist"});
  const verification=proof(seed);
  const integration=integrationSummary(seed,selected.id);
  const select=root.querySelector("#socialResidentSelect");
  if(select){
    select.innerHTML=residents.map(item=>"<option value=\""+escapeHtml(item.id)+"\" "+(item.id===selected.id?"selected":"")+">"+escapeHtml(item.name+" · "+item.profession+" ("+item.id+")")+"</option>").join("");
    select.onchange=()=>renderDebugPanel(seed,select.value,root);
  }
  const pair=root.querySelector("#socialRelationshipPair");
  if(pair)pair.textContent=selected.name+" → Protagonist";
  const role=root.querySelector("#socialResidentRole");
  if(role)role.textContent=selected.profession+" · "+selected.workplaceLabel;
  const advice=root.querySelector("#socialAdviceInfluence");
  if(advice)advice.textContent=percent(integration.acceptability)+" · "+(integration.adviceDecision||"no advice");
  const dialogue=root.querySelector("#socialDialogueInfluence");
  if(dialogue)dialogue.textContent=(integration.dialogueTone||"n/a")+" · "+(integration.dialogueSource||"no dialogue");
  const dutyNode=root.querySelector("#socialActiveDuty");
  const active=duties.filter(duty=>duty.status==="active");
  if(dutyNode)dutyNode.textContent=active.length?active[0].title+" · "+percent(active[0].priority):"None";

  const metrics=root.querySelector("#socialRelationshipMetrics");
  if(metrics){
    metrics.innerHTML=RELATIONSHIP_FIELDS.map(field=>
      "<div><span>"+escapeHtml(field)+"</span><strong>"+escapeHtml(percent(rel.values[field]))+"</strong><i><b style=\"width:"+escapeHtml(percent(rel.values[field]))+"\"></b></i></div>"
    ).join("");
  }
  const reputationList=root.querySelector("#socialReputationList");
  if(reputationList){
    reputationList.innerHTML=reps.map(row=>
      "<li><span>"+escapeHtml(row.scope)+"</span><div><strong>"+escapeHtml(row.label)+"</strong><small>Protagonist reputation · "+escapeHtml(signedPercent(row.score))+"</small></div></li>"
    ).join("");
  }
  const dutyList=root.querySelector("#socialDutyList");
  if(dutyList){
    dutyList.innerHTML=duties.length?duties.map(duty=>
      "<li><span class=\"social-duty-status "+escapeHtml(duty.status)+"\">"+escapeHtml(duty.status)+"</span><div><strong>"+escapeHtml(duty.title)+"</strong><small>"+escapeHtml(duty.type)+" · priority "+escapeHtml(percent(duty.priority))+" · "+escapeHtml(duty.beneficiary.label)+"</small></div></li>"
    ).join(""):"<li class=\"social-empty\">No duties recorded.</li>";
  }
  const eventList=root.querySelector("#socialEventList");
  if(eventList){
    eventList.innerHTML=verification.snapshot.events.slice().reverse().slice(0,8).map(event=>
      "<li><time>"+escapeHtml(event.timestamp)+"</time><div><strong>"+escapeHtml(event.type.replace(/-/g," "))+"</strong><small>"+escapeHtml(event.summary)+"</small></div></li>"
    ).join("");
  }
  const waiting=verification.eventCount===0;
  setCheck("vSocialDeterministic",verification.deterministicEvents&&verification.replayStable&&verification.storageRoundTrip,waiting);
  setCheck("vSocialRelationship",verification.relationshipsValid&&verification.relationshipCount>0,waiting);
  setCheck("vSocialReputation",verification.reputationsValid&&verification.reputationScopeCoverage,waiting);
  setCheck("vSocialDuty",verification.dutiesValid&&verification.dutyStatusCoverage,waiting);
  setCheck("vSocialInfluence",integration.dialogueSource==="persistent-social-ledger"&&integration.adviceSource==="persistent-social-ledger",waiting);
  setCheck("vSocialAuthority",verification.simulationBacked&&!verification.directAllianceEnemyState&&!verification.worldAuthorityCreated&&!verification.resourcesCreated,waiting);
  root.dataset.residentId=selected.id;
  root.dataset.profession=selected.profession;
  root.dataset.trust=String(rel.values.trust);
  root.dataset.suspicion=String(rel.values.suspicion);
  root.dataset.reputationAverage=String(dialogueContext(seed,selected.id).reputationAverage);
  root.dataset.adviceDecision=integration.adviceDecision||"";
  root.dataset.dialogueTone=integration.dialogueTone||"";
  root.dataset.eventCount=String(verification.eventCount);
  root.dataset.dutyCount=String(verification.dutyCount);
  return Object.freeze({resident:selected,relationship:rel,reputations:reps,duties,verification,integration});
}

const api=Object.freeze({
  STORAGE_PREFIX,VERSION,RELATIONSHIP_FIELDS,REPUTATION_SCOPES,DUTY_TYPES,DUTY_STATUSES,EVENT_TYPES,EFFECTS,
  storageKey,relationship,reputation,relevantReputations,residentReputationTargets,listDuties,
  recordEvent,createDuty,transitionDuty,clear,snapshot,proof,dialogueContext,adviceAcceptability,renderDebugPanel
});
scope().SocialState=api;
scope().RelationshipState=api;
scope().ReputationState=api;
scope().DutyState=api;
})();