(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistGoalProgress=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-goal-progress-v1";
const SCHEMA="ProtagonistGoalProgressLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-goal-progress-ledger";
const REGISTRY_KEY="persistent-goal-progress";
const MAX_OBSERVATIONS=32;
const MAX_QUERY_RESULTS=12;
const MAX_LEDGER_BYTES=48*1024;
const MAX_REPLAN_REASONS=8;
const STATUS_VALUES=Object.freeze(["progress","blocked","deferred","failed","abandoned","replan-needed","completed"]);
const SOURCE_KINDS=Object.freeze(["action","journey","interaction","goal"]);

function freeze(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))freeze(x);return Object.freeze(v);}
function clone(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(clone);const o={};for(const [k,x] of Object.entries(v))o[k]=clone(x);return o;}
function stable(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return "["+v.map(stable).join(",")+"]";return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}";}
function hashText(v){let h=2166136261>>>0;for(const ch of String(v==null?"":v)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function utf8Bytes(v){const t=String(v==null?"":v);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(t).length;return unescape(encodeURIComponent(t)).length;}
function clean(v,max=160){return String(v==null?"":v).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(v,max=160){return clean(v,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-");}
function plain(v){return Boolean(v)&&typeof v==="object"&&!Array.isArray(v);}
function validWhen(v){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v||""));}
function timestamp(v){const x=clean(v,32);if(!validWhen(x))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return x;}
function currentTimestamp(){return root?.GameTime?.getTimestampKey?.()||null;}
function requiredSeed(v){const s=clean(v,160);if(!s)throw new Error("Campaign SEED is required.");return s;}
function identityKey(v){return cleanId(v||"protagonist",96)||"protagonist";}
function protagonistId(seed,key){try{const p=root?.ProtagonistProfile?.derive?.(seed,key);if(p?.protagonistId)return String(p.protagonistId);}catch(_){}return "PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1");}

function registryContext(world,seedValue,identityValue){
  const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key);
  const ref=world?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{role:"persistent-protagonist-goal-progress",protagonistId:actorId,identityKey:key,authority:"goal progress references only"})||null;
  return freeze({seed,identityKey:key,protagonistId:actorId,ref});
}
function emptyLedger(ctx){return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,revision:0,observations:[],bounds:{maxObservations:MAX_OBSERVATIONS,maxQueryResults:MAX_QUERY_RESULTS,maxBytes:MAX_LEDGER_BYTES}};}
function rowValid(r){
  return Boolean(r&&/^GPR-[0-9A-F]{8}$/.test(String(r.observationId||""))&&/^GOAL-[0-9A-F]{8}$/.test(String(r.goalId||""))&&SOURCE_KINDS.includes(r.sourceKind)&&r.sourceId&&STATUS_VALUES.includes(r.status)&&validWhen(r.fantasyTimestamp)&&r.authoritativeReference===true&&r.worldTruthCopied===false);
}
function compatible(raw,ctx){
  if(!plain(raw)||raw.schema!==SCHEMA||raw.schemaVersion!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null)||!Array.isArray(raw.observations)||raw.observations.length>MAX_OBSERVATIONS)return false;
  const ids=new Set();for(const r of raw.observations){if(!rowValid(r)||ids.has(r.observationId))return false;ids.add(r.observationId);}return utf8Bytes(stable(raw))<=MAX_LEDGER_BYTES;
}
function defaultResolve(seed,sourceKind,sourceId,identity){
  if(sourceKind==="action")return root?.ProtagonistActionRuntime?.get?.(sourceId)||null;
  if(sourceKind==="interaction")return root?.ProtagonistInteractionPipeline?.get?.(seed,sourceId,identity)||null;
  if(sourceKind==="journey"){
    const snap=root?.ProtagonistJourney?.snapshot?.(seed,identity)||null;
    if(snap?.active?.journeyId===sourceId)return snap.active;
    return (snap?.history||[]).find(x=>x?.journeyId===sourceId)||null;
  }
  if(sourceKind==="goal")return root?.ProtagonistGoals?.get?.(seed,sourceId,identity)||null;
  return null;
}
function classify(sourceKind,row){
  if(!plain(row))return null;
  if(sourceKind==="action"){
    const state=cleanId(row.state,40).toLowerCase(),exec=row.evaluatorResult?.execution||{},validation=row.evaluatorResult?.finalValidation||{};
    if(state==="succeeded"&&row.terminal===true&&validation.ok!==false&&exec.actionExecuted===true&&["complete","completed","success","succeeded"].includes(cleanId(exec.state,40).toLowerCase())){
      return {status:"completed",sourceStatus:state,terminalSuccess:true,resultId:cleanId(exec.authoritativeResult?.id||row.evaluatorExecutionId||row.attemptId,160)||row.attemptId,reason:"authoritative-action-success"};
    }
    if(state==="blocked")return {status:"blocked",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.attemptId),reason:clean(row.reason||"action-blocked",160)};
    if(state==="invalid"||state==="rejected")return {status:"failed",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.attemptId),reason:clean(row.reason||state,160)};
    if(state==="deferred")return {status:"deferred",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.attemptId),reason:clean(row.reason||"action-deferred",160)};
    if(state==="running"||state==="pending")return {status:"progress",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.attemptId),reason:clean(row.reason||"action-progress",160)};
    return null;
  }
  if(sourceKind==="journey"){
    const state=cleanId(row.status,40).toLowerCase();
    if(state==="arrived")return {status:"completed",sourceStatus:state,terminalSuccess:true,resultId:cleanId(row.journeyId),reason:clean(row.reason||"validated-route-endpoint-reached",160)};
    if(state==="interrupted")return {status:"blocked",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.journeyId),reason:clean(row.reason||"journey-interrupted",160)};
    if(state==="paused")return {status:"deferred",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.journeyId),reason:clean(row.reason||"journey-paused",160)};
    if(state==="cancelled")return {status:"failed",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.journeyId),reason:clean(row.reason||"journey-cancelled",160)};
    if(state==="travelling")return {status:"progress",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.journeyId),reason:clean(row.reason||"travel-progress",160)};
    return null;
  }
  if(sourceKind==="interaction"){
    const state=cleanId(row.status,40).toLowerCase();
    if(state==="terminal-success"&&row.simulation?.authoritativeTerminalSuccess===true)return {status:"completed",sourceStatus:state,terminalSuccess:true,resultId:cleanId(row.resultId||row.attemptId),reason:clean(row.reason||"simulation-terminal-success",160)};
    if(state==="unavailable")return {status:"blocked",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.resultId||row.attemptId),reason:clean(row.reason||"interaction-unavailable",160)};
    if(state==="failed"||state==="rejected")return {status:"failed",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.resultId||row.attemptId),reason:clean(row.reason||state,160)};
    if(state==="pending"||state==="active")return {status:"progress",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.resultId||row.attemptId),reason:clean(row.reason||"interaction-progress",160)};
    return null;
  }
  if(sourceKind==="goal"){
    const state=cleanId(row.status,40).toLowerCase();
    if(state==="abandoned")return {status:"abandoned",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.id),reason:clean(row.reason||"goal-abandoned",160)};
    if(state==="deferred")return {status:"deferred",sourceStatus:state,terminalSuccess:false,resultId:cleanId(row.id),reason:clean(row.reason||"goal-deferred",160)};
    return null;
  }
  return null;
}

function createService(optionsValue){
  const options=plain(optionsValue)?optionsValue:{},world=()=>options.worldState||root?.WorldState,goals=options.goals||root?.ProtagonistGoals,resolveOutcome=options.resolveOutcome||defaultResolve;
  function readLedger(seedValue,identityValue){
    const ws=world(),ctx=registryContext(ws,seedValue,identityValue),resolved=ctx.ref&&ws?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistGoalProgress;
    if(raw==null)return {ctx,resolved,compatible:true,ledger:emptyLedger(ctx),reason:"empty"};
    if(!compatible(raw,ctx))return {ctx,resolved,compatible:false,ledger:null,reason:"ledger-incompatible"};
    return {ctx,resolved,compatible:true,ledger:clone(raw),reason:"ok"};
  }
  function writeLedger(seedValue,identityValue,ledgerValue,reasonValue){
    const ws=world(),read=readLedger(seedValue,identityValue),ctx=read.ctx;if(!read.compatible)return freeze({ok:false,reason:read.reason});
    if(!ctx.ref||!ws?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
    const next=clone(ledgerValue);next.observations=(next.observations||[]).slice(-MAX_OBSERVATIONS);next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;next.protagonistId=ctx.protagonistId;next.identityKey=ctx.identityKey;next.registryId=ctx.ref.id;next.revision=Math.max(0,Number(next.revision)||0)+1;
    while(next.observations.length&&utf8Bytes(stable(next))>MAX_LEDGER_BYTES)next.observations.shift();
    if(!compatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});
    const result=ws.applyDelta(ctx.seed,ctx.ref,{protagonistGoalProgress:next},String(reasonValue||"protagonist-goal-progress"));
    return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,recordCount:next.observations.length,serializedBytes:utf8Bytes(stable(next))});
  }
  function record(seedValue,inputValue,identityValue){
    let seed;try{seed=requiredSeed(seedValue);}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    const input=plain(inputValue)?inputValue:{},goalId=cleanId(input.goalId),sourceKind=cleanId(input.sourceKind,40).toLowerCase(),sourceId=cleanId(input.sourceId,160);
    if(!/^GOAL-[0-9A-F]{8}$/.test(goalId))return freeze({ok:false,reason:"goal-id-required"});
    if(!SOURCE_KINDS.includes(sourceKind)||!sourceId)return freeze({ok:false,reason:"authoritative-source-reference-required"});
    let when;try{when=timestamp(input.fantasyTimestamp||input.when||currentTimestamp());}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    const goal=goals?.get?.(seed,goalId,identityValue)||null;if(!goal)return freeze({ok:false,reason:"goal-not-found"});
    const read=readLedger(seed,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});
    const goalRows=read.ledger.observations.filter(x=>x.goalId===goalId);const latest=goalRows.sort((a,b)=>b.fantasyTimestamp.localeCompare(a.fantasyTimestamp)||b.observationId.localeCompare(a.observationId))[0]||null;
    if(latest&&when<latest.fantasyTimestamp)return freeze({ok:false,reason:"cannot-rewind-progress-chronology",latest:freeze(clone(latest))});
    const raw=resolveOutcome(seed,sourceKind,sourceId,identityValue);if(!raw)return freeze({ok:false,reason:"authoritative-source-not-found"});
    const classified=classify(sourceKind,raw);if(!classified)return freeze({ok:false,reason:"authoritative-source-state-unsupported"});
    let status=classified.status;
    if(input.replanNeeded===true){
      if(!["blocked","failed","deferred"].includes(status))return freeze({ok:false,reason:"replan-requires-blocked-failed-or-deferred-source"});
      status="replan-needed";
    }
    if(status==="completed"&&!classified.terminalSuccess)return freeze({ok:false,reason:"authoritative-terminal-success-required"});
    if(sourceKind==="goal"&&sourceId!==goalId)return freeze({ok:false,reason:"goal-source-mismatch"});
    const observationId="GPR-"+hashText(stable({seed,goalId,sourceKind,sourceId,status,when}));
    const existing=read.ledger.observations.find(x=>x.observationId===observationId);
    if(existing)return freeze({ok:true,reason:"duplicate",duplicate:true,observation:freeze(clone(existing)),goal:freeze(clone(goal))});
    if(status==="completed"){
      if(goal.status==="abandoned")return freeze({ok:false,reason:"abandoned-goal-cannot-complete"});
      const completion=goals?.complete?.(seed,goalId,{fantasyTimestamp:when,reason:classified.reason,historyLinks:[sourceId,classified.resultId].filter(Boolean),evidence:{source:"Simulation",authoritative:true,ok:true,status:"completed",simulationResultId:classified.resultId||sourceId,authoritativeResultId:classified.resultId||null}},identityValue);
      if(!completion?.ok)return freeze({ok:false,reason:"goal-completion-rejected",goalCompletion:completion||null});
    }else if(goal.status==="completed")return freeze({ok:false,reason:"completed-goal-is-terminal"});
    const row=freeze({observationId,goalId,sourceKind,sourceId,sourceStatus:classified.sourceStatus,status,reason:clean(input.reason||classified.reason,160)||status,fantasyTimestamp:when,resultReference:cleanId(classified.resultId||sourceId,160)||sourceId,authoritativeReference:true,terminalSuccess:classified.terminalSuccess===true,worldTruthCopied:false});
    const next=clone(read.ledger);next.observations.push(clone(row));
    const write=writeLedger(seed,identityValue,next,"protagonist-goal-progress:"+observationId);
    return freeze({...write,duplicate:false,observation:write.ok?row:null,goal:goals?.get?.(seed,goalId,identityValue)||goal});
  }
  function list(seedValue,goalIdValue,optionsValue,identityValue){
    const read=readLedger(seedValue,identityValue),goalId=cleanId(goalIdValue),options=plain(optionsValue)?optionsValue:{};if(!read.compatible)return freeze([]);
    const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.limit)||MAX_QUERY_RESULTS))),statuses=Array.isArray(options.statuses)?options.statuses.map(x=>cleanId(x,40).toLowerCase()).filter(x=>STATUS_VALUES.includes(x)):null;
    const rows=read.ledger.observations.filter(x=>(!goalId||x.goalId===goalId)&&(!statuses||statuses.includes(x.status))).sort((a,b)=>b.fantasyTimestamp.localeCompare(a.fantasyTimestamp)||b.observationId.localeCompare(a.observationId)).slice(0,limit);
    return freeze(rows.map(x=>freeze(clone(x))));
  }
  function replanContext(seedValue,goalIdValue,optionsValue,identityValue){
    const goalId=cleanId(goalIdValue),goal=goals?.get?.(seedValue,goalId,identityValue)||null;if(!goal)return freeze({ok:false,reason:"goal-not-found",replanNeeded:false});
    const rows=list(seedValue,goalId,{limit:Math.min(MAX_REPLAN_REASONS,Number(optionsValue?.limit)||MAX_REPLAN_REASONS)},identityValue);
    if(["completed","abandoned"].includes(goal.status))return freeze({ok:true,goalId,replanNeeded:false,goalStatus:goal.status,reasons:freeze([]),advisoryOnly:true,directActionExecution:false});
    const relevant=rows.filter(x=>["blocked","failed","deferred","replan-needed"].includes(x.status));
    const reasons=relevant.slice(0,MAX_REPLAN_REASONS).map(x=>freeze({observationId:x.observationId,status:x.status,reason:x.reason,sourceKind:x.sourceKind,sourceId:x.sourceId,fantasyTimestamp:x.fantasyTimestamp}));
    return freeze({ok:true,goalId,goalStatus:goal.status,replanNeeded:reasons.length>0,status:reasons.length?"replan-needed":"continue",reasons:freeze(reasons),advisoryOnly:true,plannerAuthority:false,directActionExecution:false,directWorldMutation:false});
  }
  function snapshot(seedValue,identityValue){
    const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);if(!read.compatible)return freeze({version:VERSION,seed,compatible:false,reason:read.reason,recordCount:0,records:freeze([]),bounded:true});
    const records=read.ledger.observations.slice().sort((a,b)=>b.fantasyTimestamp.localeCompare(a.fantasyTimestamp)||b.observationId.localeCompare(a.observationId)).map(x=>freeze(clone(x)));
    return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,protagonistId:read.ctx.protagonistId,identityKey:read.ctx.identityKey,compatible:true,reason:read.reason,recordCount:records.length,records:freeze(records),serializedBytes:utf8Bytes(stable(read.ledger)),bounds:freeze({maxObservations:MAX_OBSERVATIONS,maxQueryResults:MAX_QUERY_RESULTS,maxLedgerBytes:MAX_LEDGER_BYTES,maxReplanReasons:MAX_REPLAN_REASONS}),persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",completionAuthority:"ProtagonistGoals with terminal Simulation evidence",eventDriven:true,wholeHistoryScan:false,fullWorldScan:false,perFrameScan:false,directActionExecution:false,directWorldMutation:false,directPositionMutation:false,plannerAuthority:false,worldTruthCopied:false});
  }
  return freeze({record,list,replanContext,snapshot});
}

const service=createService();
return freeze({VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,REGISTRY_KEY,MAX_OBSERVATIONS,MAX_QUERY_RESULTS,MAX_LEDGER_BYTES,MAX_REPLAN_REASONS,STATUS_VALUES,SOURCE_KINDS,createService,record:service.record,list:service.list,replanContext:service.replanContext,snapshot:service.snapshot});
});