(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistInteractionPipeline=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-interactions-v1";
const SCHEMA="ProtagonistInteractionLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-interaction-ledger";
const REGISTRY_KEY="persistent-interactions";
const MAX_RECORDS=16;
const MAX_LEDGER_BYTES=48*1024;
const MAX_ADVANCE_SECONDS=3600;
const TARGET_KINDS=Object.freeze(["object","building","person"]);
const RESULT_STATES=Object.freeze(["pending","active","unavailable","rejected","failed","succeeded"]);
const TERMINAL_STATES=Object.freeze(["unavailable","rejected","failed","succeeded"]);
const COMPLETE_STATES=Object.freeze(["complete","completed","success","succeeded"]);

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value);}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;return unescape(encodeURIComponent(text)).length;}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-");}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function point(value){if(!plain(value)||value.x==null||value.y==null)return null;return freeze({x:String(value.x),y:String(value.y),level:Number(value.level||0)});}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""));}
function timestamp(value){const out=clean(value,32);if(!validWhen(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out;}
function timestampParts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]};if(p.mo<1||p.mo>12||p.d<1||p.d>31||p.h>23||p.mi>59||p.s>59)return null;return p;}
function daysFromCivil(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe;}
function secondIndex(value){const p=timestampParts(value);return p?daysFromCivil(p.y,p.mo,p.d)*86400+p.h*3600+p.mi*60+p.s:null;}
function currentTimestamp(){return root?.GameTime?.getTimestampKey?.()||null;}
function requiredSeed(value){const seed=clean(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed;}
function identityKey(value){return cleanId(value||"protagonist",96)||"protagonist";}
function protagonistId(seed,key){try{const p=root?.ProtagonistProfile?.derive?.(seed,key);if(p?.protagonistId)return String(p.protagonistId);}catch(_){}return "PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1");}
function uniqueIds(values,max=8){const out=[];for(const value of Array.isArray(values)?values:[]){const id=cleanId(value);if(id&&!out.includes(id))out.push(id);if(out.length>=max)break;}return freeze(out);}
function terminalState(value){return TERMINAL_STATES.includes(String(value||""));}

function registryContext(worldState,seedValue,identityValue){
  const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key);
  const ref=worldState?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{role:"persistent-protagonist-interactions",protagonistId:actorId,identityKey:key,authority:"ProtagonistInteractionPipeline outcome references"})||null;
  return freeze({seed,identityKey:key,protagonistId:actorId,ref});
}
function emptyLedger(ctx){return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,revision:0,records:[],bounds:{maxRecords:MAX_RECORDS,maxBytes:MAX_LEDGER_BYTES,maxAdvanceSeconds:MAX_ADVANCE_SECONDS}};}
function resultShapeValid(result){return Boolean(result&&/^PIR-[0-9A-F]{8}$/.test(String(result.resultId||""))&&RESULT_STATES.includes(result.state)&&typeof result.terminal==="boolean"&&result.terminal===terminalState(result.state)&&validWhen(result.fantasyTimestamp)&&(!result.authoritativeEvidenceId||/^SIM-[0-9A-F]{8}$/.test(String(result.authoritativeEvidenceId))));}
function recordShapeValid(row){return Boolean(row&&/^PIA-[0-9A-F]{8}$/.test(String(row.attemptId||""))&&row.actorId&&TARGET_KINDS.includes(row.targetKind)&&row.targetId&&row.action&&validWhen(row.startedFantasyTimestamp)&&validWhen(row.updatedFantasyTimestamp)&&resultShapeValid(row.result));}
function ledgerCompatible(raw,ctx){
  if(!plain(raw)||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!Array.isArray(raw.records)||raw.records.length>MAX_RECORDS||!raw.records.every(recordShapeValid))return false;
  const ids=new Set();for(const row of raw.records){if(ids.has(row.attemptId))return false;ids.add(row.attemptId);}
  return utf8Bytes(stable(raw))<=MAX_LEDGER_BYTES;
}
function recordIndex(ledger,id){return (ledger.records||[]).findIndex(row=>row.attemptId===id);}
function fitLedger(ledger){
  const next=clone(ledger);next.records=(next.records||[]).slice().sort((a,b)=>String(a.startedFantasyTimestamp).localeCompare(String(b.startedFantasyTimestamp))||a.attemptId.localeCompare(b.attemptId));
  const dropOldestTerminal=()=>{const i=next.records.findIndex(row=>row.result?.terminal===true);if(i<0)return false;next.records.splice(i,1);return true;};
  while(next.records.length>MAX_RECORDS){if(!dropOldestTerminal())return null;}
  while(utf8Bytes(stable(next))>MAX_LEDGER_BYTES){if(!dropOldestTerminal())return null;}
  return next;
}
function linksFrom(input){return freeze({
  proposalIds:uniqueIds([input?.proposalId,...(input?.proposalIds||[])]),
  decisionIds:uniqueIds([input?.decisionId,...(input?.decisionIds||[])]),
  evaluatorExecutionIds:uniqueIds([input?.evaluatorExecutionId,...(input?.evaluatorExecutionIds||[])]),
  actionRuntimeAttemptIds:uniqueIds([input?.actionRuntimeAttemptId,...(input?.actionRuntimeAttemptIds||[])]),
  conversationTransactionIds:uniqueIds([input?.conversationTransactionId,...(input?.conversationTransactionIds||[])])
});}
function mergeLinks(a,b){return freeze({
  proposalIds:uniqueIds([...(a?.proposalIds||[]),...(b?.proposalIds||[])]),
  decisionIds:uniqueIds([...(a?.decisionIds||[]),...(b?.decisionIds||[])]),
  evaluatorExecutionIds:uniqueIds([...(a?.evaluatorExecutionIds||[]),...(b?.evaluatorExecutionIds||[])]),
  actionRuntimeAttemptIds:uniqueIds([...(a?.actionRuntimeAttemptIds||[]),...(b?.actionRuntimeAttemptIds||[])]),
  conversationTransactionIds:uniqueIds([...(a?.conversationTransactionIds||[]),...(b?.conversationTransactionIds||[])])
});}
function resultRecord(attemptId,state,when,reason,delegate,evidenceId,raw){
  const terminal=terminalState(state),authoritativeEvidenceId=state==="succeeded"?evidenceId:null;
  const summary={status:cleanId(raw?.status||raw?.state||"",40)||null,reason:cleanId(raw?.reason||reason||"",120)||null,objectId:cleanId(raw?.objectId||"",160)||null,personId:cleanId(raw?.personId||"",160)||null,buildingId:cleanId(raw?.buildingId||"",160)||null,action:cleanId(raw?.action||"",80)||null};
  const resultId="PIR-"+hashText(stable({attemptId,state,when,reason,delegate,authoritativeEvidenceId,summary}));
  return freeze({resultId,state,terminal,reason:cleanId(reason||state,120)||state,fantasyTimestamp:when,delegate:clean(delegate,120)||null,authoritativeEvidenceId,simulation:freeze(summary),worldTruthCopied:false});
}
function evidenceId(attemptId,raw){
  const supplied=cleanId(raw?.authoritativeEvidenceId||raw?.evidenceId||"",160);
  if(/^SIM-[0-9A-F]{8}$/.test(supplied))return supplied;
  return "SIM-"+hashText(stable({attemptId,status:raw?.status||raw?.state||null,reason:raw?.reason||null,objectId:raw?.objectId||null,personId:raw?.personId||null,buildingId:raw?.buildingId||null,action:raw?.action||null,completedSequence:raw?.actionState?.completedSequence??raw?.completedSequence??null}));
}
function classifyRaw(attemptId,raw,delegate,when){
  if(!plain(raw))return resultRecord(attemptId,"failed",when,"simulation-result-unavailable",delegate,null,{});
  const status=cleanId(raw.status||raw.state||"",40).toLowerCase(),reason=cleanId(raw.reason||status||"simulation-result",120)||"simulation-result";
  if(raw.authoritative===true&&raw.ok===true&&COMPLETE_STATES.includes(status))return resultRecord(attemptId,"succeeded",when,reason,delegate,evidenceId(attemptId,raw),raw);
  if(raw.ok===true&&status==="active")return resultRecord(attemptId,"active",when,reason,delegate,null,raw);
  if(raw.ok===true&&["ready","pending","waiting","waiting-arrival","proposal-ready"].includes(status))return resultRecord(attemptId,"pending",when,reason,delegate,null,raw);
  if(raw.ok===false&&["unknown-object","unknown-person","target-unavailable","out-of-range","not-arrived","unavailable"].includes(reason))return resultRecord(attemptId,"unavailable",when,reason,delegate,null,raw);
  if(raw.ok===false&&["rejected","unsupported-action","unsupported-actor","incompatible-interaction"].includes(status||reason))return resultRecord(attemptId,"rejected",when,reason,delegate,null,raw);
  if(raw.ok===false&&reason)return resultRecord(attemptId,reason.includes("unavailable")||reason.includes("out-of-range")?"unavailable":"rejected",when,reason,delegate,null,raw);
  if(COMPLETE_STATES.includes(status))return resultRecord(attemptId,"failed",when,"non-authoritative-success-suppressed",delegate,null,raw);
  return resultRecord(attemptId,"failed",when,reason||"simulation-failed",delegate,null,raw);
}

function createService(optionsValue){
  const options=plain(optionsValue)?optionsValue:{};
  const world=()=>options.worldState||root?.WorldState;
  const objectInteractions=()=>options.objectInteractions||root?.ObjectInteractions;
  const personInteractions=()=>options.personInteractions||root?.ProtagonistPersonInteractions||null;
  function readLedger(seedValue,identityValue){
    const ws=world(),ctx=registryContext(ws,seedValue,identityValue),resolved=ctx.ref&&ws?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistInteractions;
    if(raw==null)return {ctx,resolved,compatible:true,exists:false,ledger:emptyLedger(ctx),reason:"empty"};
    if(!ledgerCompatible(raw,ctx))return {ctx,resolved,compatible:false,exists:true,ledger:null,reason:"ledger-incompatible"};
    return {ctx,resolved,compatible:true,exists:true,ledger:clone(raw),reason:"ok"};
  }
  function writeLedger(seedValue,identityValue,ledgerValue,reasonValue){
    const ws=world(),read=readLedger(seedValue,identityValue),ctx=read.ctx;
    if(!read.compatible)return freeze({ok:false,reason:read.reason});
    if(!ctx.ref||!ws?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
    let next=clone(ledgerValue);next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;next.protagonistId=ctx.protagonistId;next.identityKey=ctx.identityKey;next.registryId=ctx.ref.id;next.revision=Math.max(0,Number(next.revision)||0)+1;
    next=fitLedger(next);if(!next||!ledgerCompatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});
    const result=ws.applyDelta(ctx.seed,ctx.ref,{protagonistInteractions:next},String(reasonValue||"protagonist-interaction"));
    return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),recordCount:next.records.length,serializedBytes:utf8Bytes(stable(next))});
  }
  function start(seedValue,inputValue,identityValue){
    let seed;try{seed=requiredSeed(seedValue);}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    const input=plain(inputValue)?inputValue:{},read=readLedger(seed,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});
    let when;try{when=timestamp(input.fantasyTimestamp||input.when||currentTimestamp());}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    const targetKind=cleanId(input.targetKind,40).toLowerCase(),targetId=cleanId(input.targetId,160),action=cleanId(input.action,80).toLowerCase();
    if(!TARGET_KINDS.includes(targetKind))return freeze({ok:false,reason:"unsupported-target-kind"});
    if(!targetId)return freeze({ok:false,reason:"target-id-required"});
    if(!action)return freeze({ok:false,reason:"action-required"});
    const actorId=read.ctx.protagonistId,externalKey=cleanId(input.externalKey||input.actionRuntimeAttemptId||input.evaluatorExecutionId||input.proposalId||"",160)||null;
    const objectId=targetKind==="building"?cleanId(input.objectId||targetId+":door",160):(targetKind==="object"?cleanId(input.objectId||targetId,160):null);
    const attemptId="PIA-"+hashText(stable({seed,actorId,targetKind,targetId,objectId,action,key:externalKey||when}));
    const existingIndex=recordIndex(read.ledger,attemptId);
    if(existingIndex>=0)return freeze({ok:true,reason:"duplicate",duplicate:true,record:freeze(clone(read.ledger.records[existingIndex]))});
    const pending=resultRecord(attemptId,"pending",when,"interaction-created","ProtagonistInteractionPipeline",null,{});
    const row={attemptId,actorId,targetKind,targetId,objectId,action,startedFantasyTimestamp:when,updatedFantasyTimestamp:when,externalKey,references:linksFrom(input),result:pending,authority:freeze({chronology:"Fantasy Game Time",simulationValidation:true,worldTruthCopied:false,dialogueCompletionAuthority:false,uiCompletionAuthority:false,providerCompletionAuthority:false})};
    const next=clone(read.ledger);next.records.push(row);
    const write=writeLedger(seed,identityValue,next,"protagonist-interaction-start:"+attemptId);
    return freeze({...write,duplicate:false,record:write.ok?freeze(clone(row)):null});
  }
  function executeTarget(seed,row,actorPosition,advanceSeconds){
    if(row.targetKind==="person"){
      const adapter=personInteractions();
      if(!adapter?.context||!adapter?.attempt)return {delegate:"ProtagonistPersonInteractions",raw:{ok:false,status:"unavailable",reason:"person-interactions-unavailable",personId:row.targetId,action:row.action,authoritative:true}};
      const context=adapter.context(seed,row.targetId,actorPosition),state=context?.actions?.find?.(item=>String(item.id)===row.action)||null;
      if(!context)return {delegate:"ProtagonistPersonInteractions",raw:{ok:false,status:"unavailable",reason:"unknown-person",personId:row.targetId,action:row.action,authoritative:true}};
      if(!state)return {delegate:"ProtagonistPersonInteractions",raw:{ok:false,status:"rejected",reason:"unsupported-action",personId:row.targetId,action:row.action,authoritative:true}};
      if(state.enabled===false)return {delegate:"ProtagonistPersonInteractions",raw:{ok:false,status:"unavailable",reason:String(state.reason||"target-unavailable"),personId:row.targetId,action:row.action,authoritative:true}};
      try{return {delegate:"ProtagonistPersonInteractions",raw:adapter.attempt(seed,{actorKind:"protagonist",actorId:row.actorId,actorPosition,personId:row.targetId,action:row.action},advanceSeconds)};}catch(_){return {delegate:"ProtagonistPersonInteractions",raw:{ok:false,status:"failed",reason:"person-interaction-exception",personId:row.targetId,action:row.action,authoritative:true}};}
    }
    const interactions=objectInteractions(),delegate="ObjectInteractions -> ActionExecutor";
    if(!interactions?.context||!interactions?.attempt)return {delegate,raw:{ok:false,status:"unavailable",reason:"object-interactions-unavailable",objectId:row.objectId,action:row.action,authoritative:true}};
    const context=interactions.context(seed,row.objectId,actorPosition),state=context?.actions?.find?.(item=>String(item.id)===row.action)||null;
    if(!context)return {delegate,raw:{ok:false,status:"unavailable",reason:"unknown-object",objectId:row.objectId,buildingId:row.targetKind==="building"?row.targetId:null,action:row.action,authoritative:true}};
    if(!state)return {delegate,raw:{ok:false,status:"rejected",reason:"unsupported-action",objectId:row.objectId,buildingId:context.buildingId||null,action:row.action,authoritative:true}};
    if(state.enabled===false)return {delegate,raw:{ok:false,status:"unavailable",reason:String(state.reason||"target-unavailable"),objectId:row.objectId,buildingId:context.buildingId||null,action:row.action,authoritative:true}};
    try{return {delegate,raw:interactions.attempt(seed,{actorKind:"protagonist",actorId:row.actorId,actorPosition,objectId:row.objectId,action:row.action,advanceSeconds})};}catch(_){return {delegate,raw:{ok:false,status:"failed",reason:"object-interaction-exception",objectId:row.objectId,action:row.action,authoritative:true}};}
  }
  function advance(seedValue,inputValue,identityValue){
    const seed=requiredSeed(seedValue),input=plain(inputValue)?inputValue:{},read=readLedger(seed,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});
    const attemptId=cleanId(input.attemptId,160),index=recordIndex(read.ledger,attemptId);if(index<0)return freeze({ok:false,reason:"attempt-unavailable"});
    const current=read.ledger.records[index];if(current.result.terminal)return freeze({ok:true,reason:"terminal-idempotent",duplicate:true,record:freeze(clone(current)),status:current.result.state,terminal:true,terminalSuccess:current.result.state==="succeeded"});
    let when;try{when=timestamp(input.fantasyTimestamp||input.when||currentTimestamp());}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    const now=secondIndex(when),previous=secondIndex(current.updatedFantasyTimestamp);if(now<previous)return freeze({ok:false,reason:"cannot-rewind-interaction-chronology"});
    const elapsed=Math.max(0,Math.min(MAX_ADVANCE_SECONDS,now-previous)),actorPosition=point(input.actorPosition);
    const execution=executeTarget(seed,current,actorPosition,elapsed),nextResult=classifyRaw(current.attemptId,execution.raw,execution.delegate,when);
    const nextRow=clone(current);nextRow.updatedFantasyTimestamp=when;nextRow.references=mergeLinks(current.references,linksFrom(input));nextRow.result=nextResult;
    if(stable(nextRow)===stable(current))return freeze({ok:true,reason:"duplicate-result",duplicate:true,record:freeze(clone(current)),status:current.result.state,terminal:current.result.terminal,terminalSuccess:current.result.state==="succeeded"});
    const next=clone(read.ledger);next.records[index]=nextRow;const write=writeLedger(seed,identityValue,next,"protagonist-interaction-result:"+nextResult.resultId);
    return freeze({...write,duplicate:false,record:write.ok?freeze(clone(nextRow)):null,status:nextResult.state,terminal:nextResult.terminal,terminalSuccess:nextResult.state==="succeeded",authoritativeEvidenceId:nextResult.authoritativeEvidenceId,delegate:nextResult.delegate,resultId:nextResult.resultId});
  }
  function execute(seedValue,inputValue,identityValue){
    const started=start(seedValue,inputValue,identityValue);if(!started.ok)return started;
    const record=started.record;if(!record)return freeze({ok:false,reason:"attempt-record-unavailable"});
    if(record.result.terminal)return freeze({...started,status:record.result.state,terminal:true,terminalSuccess:record.result.state==="succeeded",resultId:record.result.resultId,authoritativeEvidenceId:record.result.authoritativeEvidenceId,delegate:record.result.delegate});
    return advance(seedValue,{...clone(inputValue||{}),attemptId:record.attemptId},identityValue);
  }
  function get(seedValue,attemptIdValue,identityValue){const read=readLedger(seedValue,identityValue),id=cleanId(attemptIdValue);if(!read.compatible||!id)return null;const i=recordIndex(read.ledger,id);return i>=0?freeze(clone(read.ledger.records[i])):null;}
  function snapshot(seedValue,identityValue){
    const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);if(!read.compatible)return freeze({version:VERSION,seed,compatible:false,reason:read.reason,recordCount:0,records:freeze([]),bounded:true,fullWorldScan:false,wholeHistoryScan:false});
    const records=read.ledger.records.map(row=>freeze(clone(row)));
    return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:true,recordCount:records.length,records:freeze(records),serializedBytes:utf8Bytes(stable(read.ledger)),bounds:freeze({maxRecords:MAX_RECORDS,maxLedgerBytes:MAX_LEDGER_BYTES,maxAdvanceSeconds:MAX_ADVANCE_SECONDS}),persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",simulationAuthority:"ObjectInteractions / ActionExecutor or explicit person adapter",bounded:true,indexedByAttemptId:true,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,directWorldMutation:false,dialogueCompletionAuthority:false,uiCompletionAuthority:false,providerCompletionAuthority:false,worldTruthCopied:false});
  }
  function clear(seedValue,identityValue){const read=readLedger(seedValue,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});return writeLedger(seedValue,identityValue,emptyLedger(read.ctx),"protagonist-interactions-clear");}
  return freeze({start,advance,execute,get,snapshot,clear});
}

const defaultService=createService();
function executeFromEvaluator(seedValue,configValue){
  const config=plain(configValue)?configValue:{},proposal=config.proposal||{},validation=config.validation||{},parameters=proposal.validatedParameters||proposal.parameters||{};
  const targetId=cleanId(parameters.interactionTargetId||parameters.personId||"",160),targetKind=parameters.interactionTargetId?"object":"person",action=cleanId(validation.action||config.action||(targetKind==="person"?"social":"inspect"),80).toLowerCase();
  if(!targetId)return freeze({ok:false,status:"unavailable",terminal:true,terminalSuccess:false,reason:"interaction-target-required",delegate:"ProtagonistInteractionPipeline"});
  const outcome=defaultService.execute(seedValue,{when:config.when,actorPosition:config.actorPosition,targetKind,targetId,objectId:parameters.interactionTargetId||null,action,externalKey:config.runtimeAttemptId||config.evaluatorExecutionId||proposal.proposalId||null,proposalId:proposal.proposalId||null,decisionId:config.decisionId||null,evaluatorExecutionId:config.evaluatorExecutionId||null,actionRuntimeAttemptId:config.runtimeAttemptId||null,conversationTransactionId:config.conversationTransactionId||null});
  const record=outcome.record||null,result=record?.result||null;
  return freeze({...outcome,attemptId:record?.attemptId||null,status:outcome.status||result?.state||"failed",terminal:outcome.terminal??result?.terminal??true,terminalSuccess:outcome.terminalSuccess??result?.state==="succeeded",reason:outcome.reason||result?.reason||"interaction-failed",resultId:outcome.resultId||result?.resultId||null,authoritativeEvidenceId:outcome.authoritativeEvidenceId||result?.authoritativeEvidenceId||null,delegate:outcome.delegate||result?.delegate||"ProtagonistInteractionPipeline"});
}

return freeze({VERSION,SCHEMA,SCHEMA_VERSION,MAX_RECORDS,MAX_LEDGER_BYTES,MAX_ADVANCE_SECONDS,TARGET_KINDS,RESULT_STATES,TERMINAL_STATES,createService,executeFromEvaluator,start:defaultService.start,advance:defaultService.advance,execute:defaultService.execute,get:defaultService.get,snapshot:defaultService.snapshot,clear:defaultService.clear});
});