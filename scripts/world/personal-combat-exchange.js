(function(){
"use strict";

const VERSION="personal-combat-exchange-v1";
const SCHEMA="PersonalCombatExchangeState";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="personal-combat-exchange-state";
const REGISTRY_KEY="authoritative-personal-combat-v1";
const MAX_RESULTS=24;
const MAX_OPERATIONS=64;
const MAX_PARTICIPANTS=4;
const MAX_ACTOR_READS=24;
const MAX_QUERY_RESULTS=8;
const MAX_STATE_BYTES=65536;
const INTENTS=Object.freeze(["attack","defend","disengage"]);
const RESOLUTIONS=Object.freeze(["protagonist-advantage","opponent-advantage","stalemate","protagonist-disengaged","opposition-disengaged"]);
const UNTRUSTED_SOURCE_KINDS=Object.freeze(["ui","advisor","llm","provider","render","camera","viewport","device"]);
const BODY_REGIONS=Object.freeze(["arm","shoulder","torso","leg"]);
const telemetryState={reads:0,writes:0,resolutions:0,duplicates:0,rejections:0,queries:0,actorReads:0,healthDelegations:0};

function root(){return typeof window!=="undefined"?window:globalThis}
function C(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(C);const o={};for(const [k,x] of Object.entries(v))o[k]=C(x);return o}
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))F(x);return Object.freeze(v)}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return "["+v.map(S).join(",")+"]";return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function H(v){let h=2166136261>>>0;for(const ch of String(v==null?"":v)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function B(v){const t=String(v==null?"":v);return typeof TextEncoder!=="undefined"?new TextEncoder().encode(t).length:t.length}
function T(v,n=180){return String(v==null?"":v).trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=180){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function seed(v){const s=T(v,160);if(!s)throw new Error("Campaign SEED is required.");return s}
function bump(k,n=1){telemetryState[k]=Math.min(Number.MAX_SAFE_INTEGER,(telemetryState[k]||0)+n)}
function validTs(v){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v||""))}
function parts(v){const m=String(v||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;return{y:Number(m[1]),m:Number(m[2]),d:Number(m[3]),h:Number(m[4]),i:Number(m[5]),s:Number(m[6])}}
function dayIndex(y,m,d){const yy=y-(m<=2?1:0),era=Math.floor(yy/400),yoe=yy-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe}
function sec(v){const p=parts(v);return p?dayIndex(p.y,p.m,p.d)*86400+p.h*3600+p.i*60+p.s:null}
function clamp(v,min,max,fallback=0){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
function sourceRef(v){if(!v||typeof v!=="object")return null;const kind=I(v.kind||v.type||"",80).toLowerCase(),id=I(v.id||v.entityId||v.refId||"",180);return kind&&id?F({kind,id}):null}
function trusted(ref){return Boolean(ref&&ref.kind&&ref.id&&!UNTRUSTED_SOURCE_KINDS.includes(ref.kind))}
function protagonistId(s,key="protagonist"){try{return I(root().ProtagonistProfile?.derive?.(s,key)?.protagonistId||("PROTAGONIST-"+H(s+"|"+key+"|identity-v1")),180)}catch(_){return"PROTAGONIST-"+H(s+"|"+key+"|identity-v1")}}
function context(seedValue,identityValue){
  const s=seed(seedValue),identity=I(identityValue||"protagonist",96)||"protagonist",pid=protagonistId(s,identity);
  const ref=root().WorldState?.structuralRef?.(s,REGISTRY_KIND,pid,REGISTRY_KEY,{role:"personal-combat-result-history",protagonistId:pid,identityKey:identity,authority:"Simulation-authoritative personal combat results"})||null;
  return F({seed:s,identityKey:identity,protagonistId:pid,ref});
}
function empty(ctx){return{schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,revision:1,lastFantasyTimestamp:null,results:[],operations:[]}}
function resultValid(r){
  if(!r||!/^CBT-[0-9A-F]{8}$/.test(String(r.id||""))||!validTs(r.fantasyTimestamp)||!RESOLUTIONS.includes(r.resolution)||!Array.isArray(r.participants)||r.participants.length<2||r.participants.length>MAX_PARTICIPANTS)return false;
  if(!sourceRef(r.requestSourceRef)||!sourceRef(r.locationRef)||!Array.isArray(r.npcConsequences))return false;
  if(r.protagonistInjuryEvidence&&(!/^COMBATINJ-[0-9A-F]{8}$/.test(String(r.protagonistInjuryEvidence.healthOperationId||""))||!sourceRef(r.protagonistInjuryEvidence.sourceRef)))return false;
  return true;
}
function compatible(raw,ctx){
  if(!raw||typeof raw!=="object"||raw.schema!==SCHEMA||raw.schemaVersion!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!Number.isInteger(raw.revision)||raw.revision<1||!Array.isArray(raw.results)||raw.results.length>MAX_RESULTS||!Array.isArray(raw.operations)||raw.operations.length>MAX_OPERATIONS)return false;
  if(raw.lastFantasyTimestamp!==null&&!validTs(raw.lastFantasyTimestamp))return false;
  const ids=new Set();for(const r of raw.results){if(!resultValid(r)||ids.has(r.id))return false;ids.add(r.id)}
  const keys=new Set();for(const op of raw.operations){if(!op||!I(op.key,260)||!/^COMSIG-[0-9A-F]{8}$/.test(String(op.signature||""))||!/^CBT-[0-9A-F]{8}$/.test(String(op.resultId||""))||keys.has(op.key))return false;keys.add(op.key)}
  return B(S(raw))<=MAX_STATE_BYTES;
}
function read(seedValue,identityValue){
  bump("reads");const ctx=context(seedValue,identityValue);if(!ctx.ref)return{ctx,ok:false,reason:"world-state-unavailable",state:null};
  const resolved=root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.personalCombatExchangeState;
  if(raw==null)return{ctx,ok:true,reason:"empty",state:empty(ctx)};
  return compatible(raw,ctx)?{ctx,ok:true,reason:"ok",state:C(raw)}:{ctx,ok:false,reason:"combat-state-incompatible",state:null};
}
function write(ctx,state,reason){
  if(!ctx?.ref||!root().WorldState?.applyDelta)return F({ok:false,reason:"world-state-unavailable"});
  if(!compatible(state,ctx))return F({ok:false,reason:"combat-state-invalid"});
  const bytes=B(S(state));if(bytes>MAX_STATE_BYTES)return F({ok:false,reason:"combat-state-size-exceeded",serializedBytes:bytes,maxStateBytes:MAX_STATE_BYTES});
  const out=root().WorldState.applyDelta(ctx.seed,ctx.ref,{personalCombatExchangeState:C(state)},String(reason||"personal-combat-exchange"));if(out?.ok)bump("writes");
  return F({ok:Boolean(out?.ok),reason:out?.reason||"ok",serializedBytes:bytes,registryRevision:state.revision,deltaRevision:Number(out?.entry?.revision||0)});
}
function simulationOptions(s,o){
  const x=o&&typeof o==="object"?o:{},system=I(x.sourceSystem||"",80),operationId=I(x.operationId||x.eventId,180),when=String(x.fantasyTimestamp||x.timestamp||"");
  if(x.authority!=="simulation"||system!=="Simulation"||x.authoritative!==true||x.validated!==true||T(x.campaignSeed,160)!==s)return F({ok:false,reason:"validated-simulation-authority-required"});
  if(!operationId)return F({ok:false,reason:"operation-id-required"});
  if(!validTs(when))return F({ok:false,reason:"fantasy-timestamp-required"});
  const src=sourceRef(x.sourceRef||x.source);if(!trusted(src))return F({ok:false,reason:"trusted-simulation-source-required"});
  return F({ok:true,sourceSystem:system,operationId,when,sourceRef:src});
}
function actorRef(seedValue,v,identityValue){
  const s=seed(seedValue),raw=v&&typeof v==="object"?v:{},kind=I(raw.kind,40).toLowerCase(),id=I(raw.id,180),pid=protagonistId(s,identityValue||"protagonist");
  if(kind==="protagonist"){
    if(id!=="protagonist"&&id!==pid)return null;
    return F({kind,id:pid,label:"Protagonist"});
  }
  if(kind==="resident"){
    const roster=(root().DailyActivity?.build?.(s)||[]).slice(0,MAX_ACTOR_READS);bump("actorReads",roster.length);
    const found=roster.find(x=>I(x?.id,180)===id)||null;if(!found)return null;
    return F({kind,id,label:T(found.displayName||found.name||id,120)});
  }
  return null;
}
function capability(v){
  const raw=v&&typeof v==="object"?v:{},src=sourceRef(raw.sourceRef||raw.source),intent=I(raw.intent,40).toLowerCase();
  if(raw.authoritative!==true||raw.validated!==true||!trusted(src))return F({ok:false,reason:"validated-capability-required"});
  if(!INTENTS.includes(intent))return F({ok:false,reason:"unsupported-combat-intent"});
  return F({ok:true,value:F({intent,sourceRef:src,martialSkill:Math.round(clamp(raw.martialSkill??raw.skillLevel,0,10,0)),conditionMilli:Math.round(clamp(raw.conditionMilli,0,100000,100000)),fatigueMilli:Math.round(clamp(raw.fatigueMilli,0,100000,0)),injuryBurdenMilli:Math.round(clamp(raw.injuryBurdenMilli,0,100000,0)),attack:Math.round(clamp(raw.attack,0,100,50)),defense:Math.round(clamp(raw.defense,0,100,50)),mobility:Math.round(clamp(raw.mobility,0,100,50)),reach:Math.round(clamp(raw.reach,0,100,50)),protection:Math.round(clamp(raw.protection,0,100,0))})});
}
function exchangeContext(v){
  const raw=v&&typeof v==="object"?v:{},src=sourceRef(raw.sourceRef||raw.source),loc=sourceRef(raw.locationRef||raw.location);
  if(raw.authoritative!==true||raw.validated!==true||!trusted(src)||!trusted(loc))return F({ok:false,reason:"validated-combat-context-required"});
  return F({ok:true,value:F({sourceRef:src,locationRef:loc,terrainModifier:Math.round(clamp(raw.terrainModifier,-20,20,0)),escapeAvailable:raw.escapeAvailable===true})});
}
function participants(seedValue,values,identityValue){
  const rows=Array.isArray(values)?values:[];if(rows.length<2||rows.length>MAX_PARTICIPANTS)return F({ok:false,reason:"participant-count-invalid"});
  const out=[],ids=new Set();let protagonistCount=0;
  for(const row of rows){
    const actor=actorRef(seedValue,row?.actorRef||row?.actor,identityValue);if(!actor)return F({ok:false,reason:"grounded-actor-reference-required"});
    if(ids.has(actor.id))return F({ok:false,reason:"duplicate-combat-actor"});ids.add(actor.id);if(actor.kind==="protagonist")protagonistCount++;
    const cap=capability(row?.capability||row);if(!cap.ok)return cap;
    out.push(F({actorRef:actor,capability:cap.value}));
  }
  if(protagonistCount!==1)return F({ok:false,reason:"exactly-one-protagonist-required"});
  return F({ok:true,value:F(out)});
}
function variation(s,when,actorId){const base=parseInt(H(s+"|"+actorId+"|personal-combat-v1"),16)>>>0,time=sec(when)||0;return ((base+time)%13)-6}
function scoreParticipant(s,when,row,terrainModifier){
  const c=row.capability,intentBonus=c.intent==="attack"?6:c.intent==="defend"?4:-4;
  const health=Math.round(c.conditionMilli/5000),fatigue=Math.round(c.fatigueMilli/5000),injury=Math.round(c.injuryBurdenMilli/6000),equipment=c.attack*.32+c.defense*.26+c.mobility*.18+c.reach*.12+c.protection*.12,vr=variation(s,when,row.actorRef.id);
  const score=Number((c.martialSkill*8+equipment+health-fatigue-injury+intentBonus+terrainModifier+vr).toFixed(4));
  return F({...C(row),score,variation:vr});
}
function buildInjury(resultId,when,margin){
  const magnitude=Math.abs(margin),severity=Math.round(clamp(12000+magnitude*1050,1000,60000,12000)),idx=(parseInt(H(resultId+"|body-region"),16)>>>0)%BODY_REGIONS.length,bodyRegion=BODY_REGIONS[idx],recoveryDurationSeconds=Math.max(3600,Math.ceil(severity/1000)*1800);
  return F({kind:"combat-trauma",bodyRegion,severityMilli:severity,recoveryDurationSeconds,healthOperationId:"COMBATINJ-"+H(resultId+"|ProtagonistHealth"),fantasyTimestamp:when,sourceRef:F({kind:"combat-result",id:resultId})});
}
function normalize(seedValue,inputValue,optionsValue,identityValue){
  const s=seed(seedValue),input=inputValue&&typeof inputValue==="object"?inputValue:{},auth=simulationOptions(s,optionsValue);if(!auth.ok)return auth;
  const ctx=context(s,identityValue);if(!ctx.ref)return F({ok:false,reason:"world-state-unavailable"});
  const pc=participants(s,input.participants,ctx.identityKey);if(!pc.ok)return pc;
  const cx=exchangeContext(input.context);if(!cx.ok)return cx;
  const protagonist=pc.value.find(x=>x.actorRef.kind==="protagonist"),opponents=pc.value.filter(x=>x.actorRef.kind!=="protagonist");
  if(auth.when&&input.fantasyTimestamp&&String(input.fantasyTimestamp)!==auth.when)return F({ok:false,reason:"fantasy-time-mismatch"});
  const operationKey="Simulation|"+auth.operationId;
  const canonicalInput=F({participants:pc.value,context:cx.value,requestSourceRef:auth.sourceRef,fantasyTimestamp:auth.when});
  const resultId="CBT-"+H(S({seed:s,operationKey,fantasyTimestamp:auth.when,actors:pc.value.map(x=>x.actorRef.id).sort()}));
  const signature="COMSIG-"+H(S({kind:"resolve",operationKey,resultId,canonicalInput}));
  return F({ok:true,ctx,auth,operationKey,signature,resultId,participants:pc.value,protagonist,opponents,combatContext:cx.value});
}
function resolveExchange(seedValue,inputValue,optionsValue,identityValue){
  let n;try{n=normalize(seedValue,inputValue,optionsValue,identityValue)}catch(err){bump("rejections");return F({ok:false,reason:String(err.message||err)})}if(!n.ok){bump("rejections");return n}
  const r=read(n.ctx.seed,n.ctx.identityKey);if(!r.ok){bump("rejections");return F({ok:false,reason:r.reason})}
  const existing=r.state.operations.find(x=>x.key===n.operationKey);if(existing){if(existing.signature!==n.signature){bump("rejections");return F({ok:false,reason:"duplicate-operation-conflict",resultId:existing.resultId})}bump("duplicates");return F({ok:true,reason:"duplicate",duplicate:true,result:C(r.state.results.find(x=>x.id===existing.resultId)),snapshot:snapshot(n.ctx.seed,n.ctx.identityKey)})}
  if(r.state.lastFantasyTimestamp&&sec(n.auth.when)<sec(r.state.lastFantasyTimestamp)){bump("rejections");return F({ok:false,reason:"combat-before-current-history"})}
  const scored=n.participants.map(row=>scoreParticipant(n.ctx.seed,n.auth.when,row,row.actorRef.kind==="protagonist"?n.combatContext.terrainModifier:0));
  const protagonist=scored.find(x=>x.actorRef.kind==="protagonist"),opponents=scored.filter(x=>x.actorRef.kind!=="protagonist"),opponentAverage=opponents.reduce((sum,x)=>sum+x.score,0)/opponents.length,margin=Number((protagonist.score-opponentAverage).toFixed(4));
  let resolution;
  if(protagonist.capability.intent==="disengage"&&n.combatContext.escapeAvailable)resolution="protagonist-disengaged";
  else if(opponents.every(x=>x.capability.intent==="disengage")&&n.combatContext.escapeAvailable)resolution="opposition-disengaged";
  else if(margin>12)resolution="protagonist-advantage";
  else if(margin<-12)resolution="opponent-advantage";
  else resolution="stalemate";
  const injury=resolution==="opponent-advantage"?buildInjury(n.resultId,n.auth.when,margin):null;
  const npcConsequences=resolution==="protagonist-advantage"?opponents.map(x=>F({actorRef:x.actorRef,outcome:"pressured",severityMilli:Math.round(clamp(8000+Math.abs(margin)*700,1000,50000,8000)),persistentNpcHealthMutation:false,sourceRef:F({kind:"combat-result",id:n.resultId})})):resolution==="opposition-disengaged"?opponents.map(x=>F({actorRef:x.actorRef,outcome:"disengaged",severityMilli:0,persistentNpcHealthMutation:false,sourceRef:F({kind:"combat-result",id:n.resultId})})):F([]);
  const result=F({id:n.resultId,fantasyTimestamp:n.auth.when,resolution,margin,requestSourceRef:n.auth.sourceRef,locationRef:n.combatContext.locationRef,context:F({terrainModifier:n.combatContext.terrainModifier,escapeAvailable:n.combatContext.escapeAvailable,sourceRef:n.combatContext.sourceRef}),participants:F(scored),protagonistInjuryEvidence:injury,npcConsequences:F(npcConsequences),terminal:true,combatAuthority:"PersonalCombatExchange Simulation resolver",npcHealthAuthority:false,relationshipAuthority:false,lootAuthority:false,rankAuthority:false,legalGuiltAuthority:false,propertyTransferAuthority:false,armyAuthority:false});
  const next=C(r.state);next.results=[...next.results,C(result)].slice(-MAX_RESULTS);next.operations=[...next.operations,{key:n.operationKey,signature:n.signature,resultId:n.resultId}].slice(-MAX_OPERATIONS);next.revision+=1;next.lastFantasyTimestamp=n.auth.when;
  const out=write(n.ctx,next,"personal-combat-exchange:resolve:"+n.resultId);if(!out.ok){bump("rejections");return out}bump("resolutions");
  return F({...out,duplicate:false,result,snapshot:snapshot(n.ctx.seed,n.ctx.identityKey)});
}
function get(seedValue,resultIdValue,identityValue){const id=I(resultIdValue,180),snap=snapshot(seedValue,identityValue);if(!snap.compatible||!id)return null;const row=snap.results.find(x=>x.id===id);return row?F(C(row)):null}
function applyProtagonistInjury(seedValue,resultIdValue,optionsValue,identityValue){
  let s;try{s=seed(seedValue)}catch(err){bump("rejections");return F({ok:false,reason:String(err.message||err)})}
  const auth=simulationOptions(s,optionsValue);if(!auth.ok){bump("rejections");return auth}
  const row=get(s,resultIdValue,identityValue);if(!row){bump("rejections");return F({ok:false,reason:"combat-result-not-found"})}
  const injury=row.protagonistInjuryEvidence;if(!injury){return F({ok:true,reason:"no-protagonist-injury",applied:false,resultId:row.id})}
  if(sec(auth.when)<sec(row.fantasyTimestamp)){bump("rejections");return F({ok:false,reason:"injury-application-before-combat"})}
  const health=root().ProtagonistHealth;if(!health?.applyInjury){bump("rejections");return F({ok:false,reason:"protagonist-health-unavailable"})}
  bump("healthDelegations");
  const applied=health.applyInjury(s,identityValue||"protagonist",{kind:injury.kind,bodyRegion:injury.bodyRegion,severityMilli:injury.severityMilli,recoveryDurationSeconds:injury.recoveryDurationSeconds,sourceRef:injury.sourceRef},{authority:"simulation",authoritative:true,operationId:injury.healthOperationId,fantasyTimestamp:auth.when,activity:"exertion"});
  return F({ok:Boolean(applied?.ok),reason:applied?.reason||"health-delegation-result",applied:Boolean(applied?.ok),resultId:row.id,healthOperationId:injury.healthOperationId,delegatedTo:"ProtagonistHealth.applyInjury",healthResult:applied||null,directHealthMutation:false});
}
function snapshot(seedValue,identityValue){
  let r;try{r=read(seedValue,identityValue)}catch(err){return F({version:VERSION,compatible:false,reason:String(err.message||err),bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false})}
  if(!r.ok)return F({version:VERSION,compatible:false,reason:r.reason,bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false});
  const st=r.state;return F({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:true,seed:r.ctx.seed,protagonistId:r.ctx.protagonistId,identityKey:r.ctx.identityKey,registryId:r.ctx.ref?.id||null,revision:st.revision,lastFantasyTimestamp:st.lastFantasyTimestamp,results:st.results.map(C),resultCount:st.results.length,operationCount:st.operations.length,serializedBytes:B(S(st)),maxResults:MAX_RESULTS,maxOperations:MAX_OPERATIONS,maxParticipants:MAX_PARTICIPANTS,maxActorReads:MAX_ACTOR_READS,maxQueryResults:MAX_QUERY_RESULTS,maxStateBytes:MAX_STATE_BYTES,persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",resolutionAuthority:"validated Simulation-facing request only",healthMutationAuthority:"ProtagonistHealth.applyInjury only",npcHealthAuthority:false,relationshipAuthority:false,lootAuthority:false,rankAuthority:false,legalGuiltAuthority:false,propertyTransferAuthority:false,armyAuthority:false,directPlayerControl:false,directWorldMutation:false,directPositionMutation:false,presentationAuthority:false,llmAuthority:false,providerAuthority:false,bounded:true,eventDriven:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false})}
function list(seedValue,optionsValue,identityValue){
  bump("queries");const o=optionsValue&&typeof optionsValue==="object"?optionsValue:{},snap=snapshot(seedValue,identityValue);if(!snap.compatible)return F([]);
  const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(o.limit)||MAX_QUERY_RESULTS))),resolution=o.resolution&&RESOLUTIONS.includes(I(o.resolution,40).toLowerCase())?I(o.resolution,40).toLowerCase():null;
  return F(snap.results.filter(x=>!resolution||x.resolution===resolution).sort((a,b)=>b.fantasyTimestamp.localeCompare(a.fantasyTimestamp)||b.id.localeCompare(a.id)).slice(0,limit).map(C));
}
function telemetry(){return F({...C(telemetryState),maxResults:MAX_RESULTS,maxOperations:MAX_OPERATIONS,maxParticipants:MAX_PARTICIPANTS,maxActorReads:MAX_ACTOR_READS,maxQueryResults:MAX_QUERY_RESULTS,maxStateBytes:MAX_STATE_BYTES,eventDriven:true,bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,authority:false})}

const api=F({VERSION,SCHEMA,SCHEMA_VERSION,INTENTS,RESOLUTIONS,MAX_RESULTS,MAX_OPERATIONS,MAX_PARTICIPANTS,MAX_ACTOR_READS,MAX_QUERY_RESULTS,MAX_STATE_BYTES,resolveExchange,applyProtagonistInjury,get,list,snapshot,telemetry});
root().PersonalCombatExchange=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();