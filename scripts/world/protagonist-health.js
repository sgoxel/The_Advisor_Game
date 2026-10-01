(function(){
"use strict";

const VERSION="protagonist-health-v1";
const SCHEMA="ProtagonistHealthState";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-health-state";
const REGISTRY_KEY="authoritative-health-v1";
const DEFAULT_IDENTITY_KEY="protagonist";
const MAX_INJURIES=12;
const MAX_QUERY_RESULTS=8;
const MAX_OPERATION_IDS=64;
const MAX_RECOVERED_IDS=16;
const MAX_STATE_BYTES=32768;
const MAX_VALUE=100000;
const MAX_RECOVERY_SECONDS=365*24*60*60;
const ACTIVITY_VALUES=Object.freeze(["normal","exertion","resting"]);
const telemetryState={reads:0,writes:0,initializations:0,advances:0,injuries:0,duplicates:0,rejections:0,recoveries:0};

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function stableStringify(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return (h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function identityKey(value){return cleanId(value||DEFAULT_IDENTITY_KEY,96)||DEFAULT_IDENTITY_KEY}
function bump(key){telemetryState[key]=Math.min(Number.MAX_SAFE_INTEGER,(telemetryState[key]||0)+1)}
function unit(seed,identity,label){return (parseInt(hashText(seed+"|"+identity+"|"+label),16)>>>0)/0xFFFFFFFF}
function rangeInt(seed,identity,label,min,max){return Math.round(min+unit(seed,identity,label)*(max-min))}
function protagonistId(seed,key){try{return root().ProtagonistProfile?.derive?.(seed,key)?.protagonistId||("PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1"))}catch(_){return"PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1")}}
function validTimestamp(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestampParts(value){const text=String(value||""),m=text.match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour:Number(m[4]),minute:Number(m[5]),second:Number(m[6])};if(p.month<1||p.month>12||p.day<1||p.day>31||p.hour>23||p.minute>59||p.second>59)return null;return p}
function daysFromCivil(year,month,day){const y=year-(month<=2?1:0),era=Math.floor(y/400),yoe=y-era*400,mp=month+(month>2?-3:9),doy=Math.floor((153*mp+2)/5)+day-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe}
function secondIndex(value){const p=timestampParts(value);if(!p)return null;return daysFromCivil(p.year,p.month,p.day)*86400+p.hour*3600+p.minute*60+p.second}
function currentTimestamp(){return root().GameTime?.getTimestampKey?.()||null}
function campaignStartTimestamp(){const campaign=root().SeedSystem?.getCampaign?.()||null;return campaign?.fantasyStart&&root().GameTime?.toTimestampKey?.(campaign.fantasyStart)||null}
function fatigueBaseline(seed,key){return rangeInt(seed,key,"health:fatigue-baseline",8000,14000)}
function fatigueRates(seed,key){return freeze({normal:rangeInt(seed,key,"health:fatigue-normal",1,2),exertion:rangeInt(seed,key,"health:fatigue-exertion",4,6),resting:-rangeInt(seed,key,"health:fatigue-resting",4,7)})}
function context(seedValue,identityValue){const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key),world=root().WorldState;const ref=world?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{role:"protagonist-health",protagonistId:actorId,identityKey:key,authority:"ProtagonistHealth"})||null;return freeze({seed,identityKey:key,protagonistId:actorId,ref})}
function sourceRef(value){if(!value||typeof value!=="object")return null;const kind=cleanId(value.kind||value.type||"entity",80)||"entity",id=cleanId(value.id||value.entityId||"",160);return id?freeze({kind,id}):null}
function stateCompatible(raw,ctx){
  if(!raw||typeof raw!=="object"||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION)return false;
  if(raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!validTimestamp(raw.lastFantasyTimestamp)||secondIndex(raw.lastFantasyTimestamp)!==raw.lastSecondIndex)return false;
  if(!Number.isInteger(raw.fatigueMilli)||raw.fatigueMilli<0||raw.fatigueMilli>MAX_VALUE||!Number.isInteger(raw.revision)||raw.revision<1)return false;
  if(!Array.isArray(raw.injuries)||raw.injuries.length>MAX_INJURIES||!Array.isArray(raw.recentOperationIds)||raw.recentOperationIds.length>MAX_OPERATION_IDS||!Array.isArray(raw.recentRecoveredIds)||raw.recentRecoveredIds.length>MAX_RECOVERED_IDS)return false;
  const injuryIds=new Set(),operationIds=new Set(),recoveredIds=new Set();
  for(const injury of raw.injuries){
    if(!injury||!/^INJ-[0-9A-F]{8}$/.test(String(injury.id||""))||injuryIds.has(injury.id))return false;
    injuryIds.add(injury.id);
    if(!injury.kind||!injury.bodyRegion||!Number.isInteger(injury.severityMilli)||injury.severityMilli<1||injury.severityMilli>MAX_VALUE)return false;
    if(!Number.isInteger(injury.recoveryDurationSeconds)||injury.recoveryDurationSeconds<1||injury.recoveryDurationSeconds>MAX_RECOVERY_SECONDS)return false;
    if(!Number.isInteger(injury.recoveryElapsedSeconds)||injury.recoveryElapsedSeconds<0||injury.recoveryElapsedSeconds>=injury.recoveryDurationSeconds)return false;
    if(!validTimestamp(injury.createdFantasyTimestamp)||!validTimestamp(injury.updatedFantasyTimestamp)||secondIndex(injury.updatedFantasyTimestamp)>raw.lastSecondIndex)return false;
    if(secondIndex(injury.updatedFantasyTimestamp)<secondIndex(injury.createdFantasyTimestamp))return false;
  }
  for(const op of raw.recentOperationIds){if(!op||cleanId(op)!==op||operationIds.has(op))return false;operationIds.add(op)}
  for(const injuryId of raw.recentRecoveredIds){if(!/^INJ-[0-9A-F]{8}$/.test(String(injuryId||""))||recoveredIds.has(injuryId)||injuryIds.has(injuryId))return false;recoveredIds.add(injuryId)}
  return utf8Bytes(stableStringify(raw))<=MAX_STATE_BYTES;
}
function readState(seedValue,identityValue){
  bump("reads");
  const ctx=context(seedValue,identityValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistHealthState;
  if(raw==null)return {ctx,resolved,compatible:true,exists:false,state:null,reason:"empty"};
  if(!stateCompatible(raw,ctx))return {ctx,resolved,compatible:false,exists:true,state:null,reason:"health-state-incompatible"};
  return {ctx,resolved,compatible:true,exists:true,state:clone(raw),reason:"ok"};
}
function initialState(ctx,timestampValue){
  if(!validTimestamp(timestampValue))throw new Error("Valid fantasy timestamp is required.");
  return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,lastFantasyTimestamp:String(timestampValue),lastSecondIndex:secondIndex(timestampValue),fatigueMilli:fatigueBaseline(ctx.seed,ctx.identityKey),injuries:[],recentOperationIds:[],recentRecoveredIds:[],revision:1};
}
function writeState(ctx,stateValue,reasonValue){
  const world=root().WorldState;if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
  const next=clone(stateValue);
  if(!stateCompatible(next,ctx))return freeze({ok:false,reason:"health-state-invalid"});
  const serializedBytes=utf8Bytes(stableStringify(next));if(serializedBytes>MAX_STATE_BYTES)return freeze({ok:false,reason:"health-state-size-exceeded",serializedBytes,maxStateBytes:MAX_STATE_BYTES});
  const result=world.applyDelta(ctx.seed,ctx.ref,{protagonistHealthState:next},String(reasonValue||"protagonist-health"));if(result?.ok)bump("writes");
  return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",stateRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),serializedBytes});
}
function initialize(seedValue,identityValue,startTimestampValue){
  const read=readState(seedValue,identityValue);if(!read.compatible){bump("rejections");return freeze({ok:false,reason:read.reason})}
  if(read.exists)return freeze({ok:true,reason:"already-initialized",created:false,snapshot:snapshotFromRead(read)});
  const timestamp=startTimestampValue||campaignStartTimestamp()||currentTimestamp();if(!validTimestamp(timestamp)){bump("rejections");return freeze({ok:false,reason:"fantasy-timestamp-required"})}
  const state=initialState(read.ctx,timestamp),write=writeState(read.ctx,state,"protagonist-health-initialize");if(!write.ok){bump("rejections");return write}bump("initializations");
  return freeze({...write,created:true,snapshot:snapshot(seedValue,identityValue)});
}
function ensure(seedValue,identityValue,targetTimestamp){
  let read=readState(seedValue,identityValue);if(!read.compatible)return {ok:false,reason:read.reason,read};
  if(!read.exists){const init=initialize(seedValue,identityValue,targetTimestamp||campaignStartTimestamp()||currentTimestamp());if(!init.ok)return {ok:false,reason:init.reason,read};read=readState(seedValue,identityValue)}
  return {ok:true,read};
}
function authorize(optionsValue){
  const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
  if(options.authority!=="simulation"||options.authoritative!==true)return {ok:false,reason:"simulation-authority-required"};
  const operationId=cleanId(options.operationId||options.eventId||options.id,160);if(!operationId)return {ok:false,reason:"operation-id-required"};
  return {ok:true,operationId,options};
}
function activity(value){const out=String(value||"normal").toLowerCase();return ACTIVITY_VALUES.includes(out)?out:null}
function remember(state,operationId){state.recentOperationIds=[...state.recentOperationIds.filter(id=>id!==operationId),operationId].slice(-MAX_OPERATION_IDS)}
function recoveredRemember(state,ids){for(const id of ids){state.recentRecoveredIds=[...state.recentRecoveredIds.filter(x=>x!==id),id].slice(-MAX_RECOVERED_IDS)}}
function progressState(stateValue,ctx,targetTimestamp,activityValue){
  const state=clone(stateValue),targetIndex=secondIndex(targetTimestamp),deltaSeconds=targetIndex-state.lastSecondIndex,rates=fatigueRates(ctx.seed,ctx.identityKey),rate=rates[activityValue];
  state.fatigueMilli=Math.max(0,Math.min(MAX_VALUE,state.fatigueMilli+rate*deltaSeconds));
  const active=[],recovered=[];
  for(const injury of state.injuries){
    const next=clone(injury),elapsed=Math.min(next.recoveryDurationSeconds,next.recoveryElapsedSeconds+deltaSeconds);
    if(elapsed>=next.recoveryDurationSeconds){recovered.push(next.id);continue}
    next.recoveryElapsedSeconds=elapsed;next.updatedFantasyTimestamp=targetTimestamp;active.push(next);
  }
  state.injuries=active;recoveredRemember(state,recovered);state.lastFantasyTimestamp=targetTimestamp;state.lastSecondIndex=targetIndex;
  return {state,recovered,deltaSeconds};
}
function duplicateResult(read,operationId){bump("duplicates");return freeze({ok:true,reason:"duplicate",duplicate:true,operationId,snapshot:snapshotFromRead(read)})}
function advance(seedValue,identityValue,targetTimestampValue,optionsValue){
  const auth=authorize(optionsValue);if(!auth.ok){bump("rejections");return freeze(auth)}
  const target=String(targetTimestampValue||auth.options.fantasyTimestamp||currentTimestamp()||"");if(!validTimestamp(target)){bump("rejections");return freeze({ok:false,reason:"fantasy-timestamp-required"})}
  const ensured=ensure(seedValue,identityValue,target);if(!ensured.ok){bump("rejections");return freeze({ok:false,reason:ensured.reason})}
  const read=ensured.read;if(read.state.recentOperationIds.includes(auth.operationId))return duplicateResult(read,auth.operationId);
  const targetIndex=secondIndex(target);if(targetIndex<read.state.lastSecondIndex){bump("rejections");return freeze({ok:false,reason:"cannot-rewind-health-state",operationId:auth.operationId,snapshot:snapshotFromRead(read)})}
  const mode=activity(auth.options.activity);if(!mode){bump("rejections");return freeze({ok:false,reason:"invalid-activity"})}
  const progressed=progressState(read.state,read.ctx,target,mode),next=progressed.state;remember(next,auth.operationId);next.revision+=1;
  const write=writeState(read.ctx,next,"protagonist-health-advance:"+auth.operationId);if(!write.ok){bump("rejections");return write}
  bump("advances");for(let i=0;i<progressed.recovered.length;i++)bump("recoveries");
  return freeze({...write,duplicate:false,operationId:auth.operationId,activity:mode,advancedSeconds:progressed.deltaSeconds,recoveredInjuryIds:freeze(progressed.recovered.slice()),snapshot:snapshot(seedValue,identityValue)});
}
function normalizeInjury(ctx,inputValue,operationId,fantasyTimestamp){
  const input=inputValue&&typeof inputValue==="object"?inputValue:{},kind=cleanId(input.kind||input.injuryKind||"",80),bodyRegion=cleanId(input.bodyRegion||input.region||"",80);
  const severity=Number(input.severityMilli??input.severity),recoverySeconds=Number(input.recoveryDurationSeconds??input.recoverySeconds??Math.max(3600,Math.ceil(Number(severity||0)/1000)*3600));
  if(!kind||!bodyRegion)throw new Error("injury-kind-and-body-region-required");
  if(!Number.isInteger(severity)||severity<1||severity>MAX_VALUE)throw new Error("invalid-injury-severity");
  if(!Number.isInteger(recoverySeconds)||recoverySeconds<1||recoverySeconds>MAX_RECOVERY_SECONDS)throw new Error("invalid-recovery-duration");
  const id="INJ-"+hashText(stableStringify({seed:ctx.seed,protagonistId:ctx.protagonistId,operationId,kind,bodyRegion,fantasyTimestamp}));
  return freeze({id,kind,bodyRegion,severityMilli:severity,recoveryDurationSeconds:recoverySeconds,recoveryElapsedSeconds:0,createdFantasyTimestamp:fantasyTimestamp,updatedFantasyTimestamp:fantasyTimestamp,sourceRef:sourceRef(input.sourceRef||input.source)});
}
function applyInjury(seedValue,identityValue,inputValue,optionsValue){
  const auth=authorize(optionsValue);if(!auth.ok){bump("rejections");return freeze(auth)}
  const when=String(auth.options.fantasyTimestamp||auth.options.timestamp||currentTimestamp()||"");if(!validTimestamp(when)){bump("rejections");return freeze({ok:false,reason:"fantasy-timestamp-required"})}
  const ensured=ensure(seedValue,identityValue,when);if(!ensured.ok){bump("rejections");return freeze({ok:false,reason:ensured.reason})}
  const read=ensured.read;if(read.state.recentOperationIds.includes(auth.operationId))return duplicateResult(read,auth.operationId);
  const whenIndex=secondIndex(when);if(whenIndex<read.state.lastSecondIndex){bump("rejections");return freeze({ok:false,reason:"injury-before-current-state",operationId:auth.operationId,snapshot:snapshotFromRead(read)})}
  const mode=activity(auth.options.activity);if(!mode){bump("rejections");return freeze({ok:false,reason:"invalid-activity"})}
  let injury;try{injury=normalizeInjury(read.ctx,inputValue,auth.operationId,when)}catch(error){bump("rejections");return freeze({ok:false,reason:String(error.message||error)})}
  if(read.state.injuries.length>=MAX_INJURIES){bump("rejections");return freeze({ok:false,reason:"active-injury-limit-reached"})}
  const progressed=progressState(read.state,read.ctx,when,mode),next=progressed.state;
  if(next.injuries.some(row=>row.id===injury.id)||next.recentRecoveredIds.includes(injury.id)){bump("rejections");return freeze({ok:false,reason:"injury-identity-conflict"})}
  next.injuries.push(clone(injury));remember(next,auth.operationId);next.revision+=1;
  const write=writeState(read.ctx,next,"protagonist-health-injury:"+injury.id);if(!write.ok){bump("rejections");return write}
  bump("injuries");for(let i=0;i<progressed.recovered.length;i++)bump("recoveries");
  return freeze({...write,duplicate:false,operationId:auth.operationId,recoveredInjuryIds:freeze(progressed.recovered.slice()),injury:injuryView(injury,when),snapshot:snapshot(seedValue,identityValue)});
}
function remainingSeverity(injury){const remaining=injury.recoveryDurationSeconds-injury.recoveryElapsedSeconds;return remaining<=0?0:Math.ceil(injury.severityMilli*remaining/injury.recoveryDurationSeconds)}
function injuryView(injury,currentTimestampValue){const remainingSeconds=Math.max(0,injury.recoveryDurationSeconds-injury.recoveryElapsedSeconds),progressMilli=Math.floor(injury.recoveryElapsedSeconds*MAX_VALUE/injury.recoveryDurationSeconds);return freeze({...clone(injury),remainingSeverityMilli:remainingSeverity(injury),recoveryProgressMilli:progressMilli,recoveryProgress:Math.round(progressMilli/100)/10,recoveryRemainingSeconds:remainingSeconds,currentFantasyTimestamp:currentTimestampValue})}
function conditionFor(state){
  const injuryBurden=Math.min(MAX_VALUE,state.injuries.reduce((sum,injury)=>sum+remainingSeverity(injury),0)),fatiguePenalty=Math.floor(state.fatigueMilli*35/100),injuryPenalty=Math.floor(injuryBurden*65/100),conditionMilli=Math.max(0,MAX_VALUE-fatiguePenalty-injuryPenalty);
  const condition=conditionMilli>=85000?"healthy":conditionMilli>=65000?"strained":conditionMilli>=40000?"impaired":"critical";
  return freeze({condition,conditionMilli,injuryBurdenMilli:injuryBurden});
}
function snapshotFromRead(read){
  if(!read?.compatible||!read?.exists||!read.state)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:Boolean(read?.compatible),exists:false,reason:read?.reason||"empty",activeInjuryCount:0,injuries:freeze([]),bounded:true,fullWorldScan:false,perFrameScan:false,directActionExecution:false});
  const state=read.state,condition=conditionFor(state),injuries=state.injuries.map(injury=>injuryView(injury,state.lastFantasyTimestamp)).sort((a,b)=>Number(b.remainingSeverityMilli)-Number(a.remainingSeverityMilli)||String(a.id).localeCompare(String(b.id))),serializedBytes=utf8Bytes(stableStringify(state));
  return freeze({
    version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:true,exists:true,seed:read.ctx.seed,protagonistId:read.ctx.protagonistId,identityKey:read.ctx.identityKey,registryId:read.ctx.ref?.id||null,
    revision:state.revision,lastFantasyTimestamp:state.lastFantasyTimestamp,lastSecondIndex:state.lastSecondIndex,
    condition:condition.condition,conditionMilli:condition.conditionMilli,conditionScore:Math.round(condition.conditionMilli/100)/10,injuryBurdenMilli:condition.injuryBurdenMilli,
    fatigueMilli:state.fatigueMilli,fatigue:Math.round(state.fatigueMilli/100)/10,fatigueRatesMilliPerSecond:fatigueRates(read.ctx.seed,read.ctx.identityKey),
    activeInjuryCount:injuries.length,injuries:freeze(injuries),recentRecoveredIds:freeze(state.recentRecoveredIds.slice()),recentOperationIds:freeze(state.recentOperationIds.slice()),
    serializedBytes,maxStateBytes:MAX_STATE_BYTES,maxInjuries:MAX_INJURIES,maxQueryResults:MAX_QUERY_RESULTS,maxOperationIds:MAX_OPERATION_IDS,maxRecoveredIds:MAX_RECOVERED_IDS,maxRecoverySeconds:MAX_RECOVERY_SECONDS,
    persistenceAuthority:"WorldState CampaignStateDelta",mutationAuthority:"explicit Simulation-authorized health operations",chronologyAuthority:"Fantasy Game Time",
    bounded:true,eventDriven:true,fullWorldScan:false,wholeCampaignScan:false,perFrameScan:false,realTimeAuthority:false,presentationAuthority:false,llmAuthority:false,
    directActionExecution:false,combatResolutionAuthority:false,medicineInventoryAuthority:false,diseaseAuthority:false,deathSuccessionAuthority:false,needsAuthority:false
  });
}
function snapshot(seedValue,identityValue){return snapshotFromRead(readState(seedValue,identityValue))}
function listInjuries(seedValue,optionsValue,identityValue){
  const snap=snapshot(seedValue,identityValue),options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};if(!snap.compatible||!snap.exists)return freeze([]);
  const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.limit)||MAX_QUERY_RESULTS))),minSeverity=Math.max(0,Math.min(MAX_VALUE,Math.floor(Number(options.minRemainingSeverityMilli)||0)));
  return freeze(snap.injuries.filter(row=>row.remainingSeverityMilli>=minSeverity&&(!options.bodyRegion||row.bodyRegion===cleanId(options.bodyRegion,80))).slice(0,limit).map(row=>freeze(clone(row))));
}
function decisionContext(seedValue,identityValue){
  const snap=snapshot(seedValue,identityValue);if(!snap.compatible||!snap.exists)return freeze({compatible:Boolean(snap.compatible),available:false,source:"ProtagonistHealth",bounded:true,readOnly:true,directActionExecution:false});
  return freeze({compatible:true,available:true,source:"ProtagonistHealth",protagonistId:snap.protagonistId,condition:snap.condition,conditionMilli:snap.conditionMilli,fatigueMilli:snap.fatigueMilli,activeInjuryCount:snap.activeInjuryCount,injuryIds:freeze(snap.injuries.slice(0,MAX_QUERY_RESULTS).map(x=>x.id)),bounded:true,readOnly:true,fullWorldScan:false,directActionExecution:false});
}
function telemetry(){return freeze({...clone(telemetryState),boundedScalarCounters:true,authority:false,maxInjuries:MAX_INJURIES,maxStateBytes:MAX_STATE_BYTES,fullWorldScan:false,perFrameScan:false})}

root().ProtagonistHealth=Object.freeze({
  VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,REGISTRY_KEY,DEFAULT_IDENTITY_KEY,MAX_INJURIES,MAX_QUERY_RESULTS,MAX_OPERATION_IDS,MAX_RECOVERED_IDS,MAX_STATE_BYTES,MAX_VALUE,MAX_RECOVERY_SECONDS,ACTIVITY_VALUES,
  initialize,advance,applyInjury,snapshot,listInjuries,decisionContext,telemetry,fatigueBaseline,fatigueRates
});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistHealth;
})();
