(function(){
"use strict";

const VERSION="conversation-transactions-v1";
const SCHEMA="ConversationTransactionLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="conversation-transaction-ledger";
const REGISTRY_KEY="protagonist-advisor-conversation";
const MAX_RECORDS=48;
const MAX_LEDGER_BYTES=64*1024;
const MAX_DIALOGUE_CHARS=480;
const MAX_LINKS_PER_KIND=8;
const MAX_QUERY_RESULTS=24;
const OUTCOME_STATES=Object.freeze(["unexecuted","completed"]);

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out;
}
function freeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))freeze(item);return Object.freeze(value);
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}";
}
function hashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function utf8Bytes(value){
  const text=String(value==null?"":value);
  if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;
  let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n;
}
function cleanText(value,max){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function validTimestamp(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestamp(value){const out=cleanText(value,32);if(!validTimestamp(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out}
function uniqueIds(values){
  const out=[];for(const value of Array.isArray(values)?values:[]){const id=cleanId(value);if(id&&!out.includes(id))out.push(id);if(out.length>=MAX_LINKS_PER_KIND)break}return out;
}
function currentTimestamp(){return root().GameTime?.getTimestampKey?.()||null}
function registryContext(seedValue){
  const seed=requiredSeed(seedValue),world=root().WorldState;
  const ref=world?.structuralRef?.(seed,REGISTRY_KIND,"WORLD",REGISTRY_KEY,{
    role:"advisor-conversation-history",authority:"ConversationTransactions registry foundation"
  })||null;
  return freeze({seed,ref});
}
function emptyLedger(seed,ref){
  return {
    schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed,registryId:ref?.id||null,
    revision:0,records:[],retention:{maxRecords:MAX_RECORDS,maxBytes:MAX_LEDGER_BYTES,policy:"newest-fantasy-time-then-id"}
  };
}
function recordShapeValid(record,id){
  if(!record||typeof record!=="object"||record.id!==id||!validTimestamp(record.fantasyTimestamp))return false;
  if(!record.message||typeof record.message!=="object"||!record.routing||typeof record.routing!=="object")return false;
  if(!record.links||typeof record.links!=="object"||!record.outcome||typeof record.outcome!=="object")return false;
  if(!OUTCOME_STATES.includes(record.outcome.state))return false;
  if(record.outcome.state==="completed"&&(!record.outcome.simulationResultId||record.outcome.authoritativeExecution!==true))return false;
  return true;
}
function ledgerCompatible(raw,seed,ref){
  if(!raw||typeof raw!=="object")return false;
  if(raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION)return false;
  if(raw.seed!==seed||raw.registryId!==(ref?.id||null)||!Array.isArray(raw.records))return false;
  if(raw.records.length>MAX_RECORDS)return false;
  const ids=new Set();for(const record of raw.records){if(!recordShapeValid(record,record?.id)||ids.has(record.id))return false;ids.add(record.id)}
  return utf8Bytes(stableStringify(raw))<=MAX_LEDGER_BYTES;
}
function readLedger(seedValue){
  const ctx=registryContext(seedValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null;
  const raw=resolved?.current?.conversationTransactions;
  if(raw==null)return {ctx,resolved,compatible:true,exists:false,ledger:emptyLedger(ctx.seed,ctx.ref),reason:"empty"};
  if(!ledgerCompatible(raw,ctx.seed,ctx.ref))return {ctx,resolved,compatible:false,exists:true,ledger:null,reason:"ledger-incompatible"};
  return {ctx,resolved,compatible:true,exists:true,ledger:clone(raw),reason:"ok"};
}
function normalizeMessage(input){
  const src=input&&typeof input==="object"?input:{};
  return freeze({
    messageId:cleanId(src.messageId||src.id||"message"),
    role:["player","advisor","system"].includes(src.role)?src.role:"player",
    text:cleanText(src.text||src.dialogue||"",MAX_DIALOGUE_CHARS),
    historicalDialogue:true,authoritativeFact:false
  });
}
function normalizeRouting(input){
  const src=input&&typeof input==="object"?input:{};
  return freeze({
    mode:cleanId(src.mode||src.routingMode||"unknown",80)||"unknown",
    recognizedIntentIds:freeze(uniqueIds(src.recognizedIntentIds||src.intentIds||[])),
    localReplyId:cleanId(src.localReplyId||"",160)||null,
    externalProviderUsed:Boolean(src.externalProviderUsed===true)
  });
}
function simulationOutcome(input){
  const src=input&&typeof input==="object"?input:{};
  const execution=src.execution&&typeof src.execution==="object"?src.execution:src;
  const executionId=cleanId(src.executionId||execution.executionId||src.simulationResultId||execution.simulationResultId||"",160)||null;
  const authoritativeResultId=cleanId(src.authoritativeResultId||execution.authoritativeResultId||execution.authoritativeResult?.id||"",160)||null;
  const succeeded=Boolean(executionId&&execution.actionExecuted===true&&(execution.ok===true||execution.authoritativeResult?.ok===true||["completed","accepted","active","success"].includes(String(execution.state||execution.status||"").toLowerCase())));
  return freeze({
    state:succeeded?"completed":"unexecuted",
    simulationResultId:succeeded?executionId:null,
    authoritativeResultId:succeeded?authoritativeResultId:null,
    authoritativeExecution:succeeded,
    claimedCompletionSuppressed:Boolean(src.completed===true&&!succeeded)
  });
}
function normalizeLinks(input){
  const src=input&&typeof input==="object"?input:{};
  return freeze({
    proposalIds:freeze(uniqueIds(src.proposalIds||[src.proposalId].filter(Boolean))),
    decisionIds:freeze(uniqueIds(src.decisionIds||[src.decisionId].filter(Boolean))),
    advisorChannelIds:freeze(uniqueIds(src.advisorChannelIds||src.adviceIds||[])),
    characterMemoryIds:freeze(uniqueIds(src.characterMemoryIds||src.memoryIds||[])),
    simulationResultIds:freeze(uniqueIds(src.simulationResultIds||[]))
  });
}
function canonicalIdBasis(seed,record){
  return {
    seed,fantasyTimestamp:record.fantasyTimestamp,messageId:record.message.messageId,role:record.message.role,
    routingMode:record.routing.mode,intents:record.routing.recognizedIntentIds,
    proposalIds:record.links.proposalIds,decisionIds:record.links.decisionIds,
    advisorChannelIds:record.links.advisorChannelIds,characterMemoryIds:record.links.characterMemoryIds,
    outcomeState:record.outcome.state,simulationResultId:record.outcome.simulationResultId
  };
}
function normalizeRecord(seedValue,inputValue){
  const seed=requiredSeed(seedValue),input=inputValue&&typeof inputValue==="object"?inputValue:{};
  const fantasyTimestamp=timestamp(input.fantasyTimestamp||input.timestamp||currentTimestamp());
  const message=normalizeMessage(input.message||input);
  const routing=normalizeRouting(input.routing||input);
  const links=normalizeLinks(input.links||input);
  const outcome=simulationOutcome(input.simulationResult||input.execution||input.outcome||{});
  const mergedLinks=freeze({...clone(links),simulationResultIds:freeze(uniqueIds([...(links.simulationResultIds||[]),outcome.simulationResultId].filter(Boolean)))});
  const draft={schema:"ConversationTransaction",schemaVersion:SCHEMA_VERSION,fantasyTimestamp,message,routing,links:mergedLinks,outcome,
    authority:freeze({chronology:"Fantasy Game Time",worldTruthCopied:false,dialogueIsProof:false,fullWorldScan:false,wholeCampaignScan:false,providerStatePersisted:false,renderStatePersisted:false,cameraStatePersisted:false})};
  const id="CTX-"+hashText(stableStringify(canonicalIdBasis(seed,draft)));
  return freeze({id,...draft});
}
function orderedRecords(ledger){
  return (Array.isArray(ledger?.records)?ledger.records:[]).map(clone).sort((a,b)=>String(a?.fantasyTimestamp||"").localeCompare(String(b?.fantasyTimestamp||""))||String(a?.id||"").localeCompare(String(b?.id||"")));
}
function recordIndex(ledger){const map=new Map();for(const record of orderedRecords(ledger))map.set(record.id,record);return map}
function fitLedger(ledger){
  let records=orderedRecords(ledger);
  while(records.length>MAX_RECORDS)records.shift();
  ledger.records=records;
  while(records.length&&utf8Bytes(stableStringify(ledger))>MAX_LEDGER_BYTES){records.shift();ledger.records=records}
  return ledger;
}
function writeLedger(seedValue,ledgerValue,reasonValue){
  const seed=requiredSeed(seedValue),ctx=registryContext(seed),world=root().WorldState;
  if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
  const next=fitLedger(clone(ledgerValue));
  next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=seed;next.registryId=ctx.ref.id;
  next.revision=Math.max(0,Number(next.revision)||0)+1;
  if(!ledgerCompatible(next,seed,ctx.ref))return freeze({ok:false,reason:"ledger-invalid-after-retention"});
  const result=world.applyDelta(seed,ctx.ref,{conversationTransactions:next},String(reasonValue||"conversation-transaction"));
  return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),recordCount:next.records.length,serializedBytes:utf8Bytes(stableStringify(next))});
}
function append(seedValue,inputValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed);
  if(!read.compatible)return freeze({ok:false,reason:read.reason,record:null});
  const record=normalizeRecord(seed,inputValue),next=clone(read.ledger);
  const existing=recordIndex(next).get(record.id);
  if(existing)return freeze({ok:true,reason:"duplicate",duplicate:true,record:freeze(clone(existing)),recordCount:next.records.length});
  next.records.push(clone(record));
  const write=writeLedger(seed,next,"conversation-transaction:"+record.id);
  return freeze({...write,duplicate:false,record});
}
function get(seedValue,idValue){
  const read=readLedger(seedValue),id=cleanId(idValue);
  if(!read.compatible||!id)return null;
  const record=recordIndex(read.ledger).get(id);return record?freeze(clone(record)):null;
}
function list(seedValue,optionsValue){
  const read=readLedger(seedValue),options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
  if(!read.compatible)return freeze([]);
  const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Number(options.limit)||MAX_QUERY_RESULTS));
  const before=options.beforeTimestamp&&validTimestamp(options.beforeTimestamp)?String(options.beforeTimestamp):null;
  const records=orderedRecords(read.ledger).filter(record=>!before||record.fantasyTimestamp<=before);
  return freeze(records.slice(Math.max(0,records.length-limit)).map(record=>freeze(clone(record))));
}
function snapshot(seedValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed);
  if(!read.compatible)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:false,reason:read.reason,recordCount:0,records:freeze([]),indexedById:true,bounded:true,fullWorldScan:false,wholeCampaignScan:false});
  const records=orderedRecords(read.ledger).map(record=>freeze(clone(record)));
  return freeze({
    version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:true,reason:read.reason,
    registryId:read.ctx.ref?.id||null,ledgerRevision:Number(read.ledger.revision||0),deltaRevision:Number(read.resolved?.delta?.revision||0),
    recordCount:records.length,serializedBytes:utf8Bytes(stableStringify(read.ledger)),maxRecords:MAX_RECORDS,maxLedgerBytes:MAX_LEDGER_BYTES,
    records:freeze(records),indexedById:true,bounded:true,queryLimit:MAX_QUERY_RESULTS,fullWorldScan:false,wholeCampaignScan:false,
    persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",worldTruthCopied:false,providerStatePersisted:false,renderStatePersisted:false,cameraStatePersisted:false
  });
}
function clear(seedValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed);if(!read.compatible)return freeze({ok:false,reason:read.reason});
  return writeLedger(seed,emptyLedger(seed,read.ctx.ref),"conversation-transactions-clear");
}
function fromEvaluation(seedValue,messageValue,routingValue,evaluationValue,extraValue){
  const evaluation=evaluationValue&&typeof evaluationValue==="object"?evaluationValue:{},extra=extraValue&&typeof extraValue==="object"?extraValue:{};
  return append(seedValue,{
    fantasyTimestamp:evaluation.when||extra.fantasyTimestamp||currentTimestamp(),message:messageValue,routing:routingValue,
    proposalId:evaluation.proposal?.proposalId||evaluation.finalProposal?.proposalId||null,
    decisionId:evaluation.decisionId||null,
    advisorChannelIds:extra.advisorChannelIds||[],characterMemoryIds:extra.characterMemoryIds||[],
    simulationResult:{executionId:evaluation.executionId,...clone(evaluation.execution||{})}
  });
}
function proof(seedValue){
  const seed=requiredSeed(seedValue),before=clear(seed);
  if(!before.ok)return freeze({pass:false,reason:before.reason});
  const local=append(seed,{fantasyTimestamp:"1201-03-02 09:00:00",message:{messageId:"M1",role:"player",text:"Where is the mill?"},routing:{mode:"local",recognizedIntentIds:["intent.location"]},links:{characterMemoryIds:["MEM-1"]}});
  const rejected=append(seed,{fantasyTimestamp:"1201-03-02 09:01:00",message:{messageId:"M2",role:"player",text:"Go somewhere unsafe."},routing:{mode:"local",recognizedIntentIds:["intent.travel"]},proposalId:"P-2",decisionId:"D-2",outcome:{completed:true}});
  const completed=append(seed,{fantasyTimestamp:"1201-03-02 09:02:00",message:{messageId:"M3",role:"player",text:"Use the gate."},routing:{mode:"external-fallback",recognizedIntentIds:["intent.interaction"]},proposalId:"P-3",decisionId:"D-3",simulationResult:{executionId:"EX-3",actionExecuted:true,state:"completed",ok:true,authoritativeResultId:"AR-3"}});
  const snap=snapshot(seed);
  return freeze({pass:Boolean(local.ok&&rejected.ok&&completed.ok&&snap.recordCount===3&&snap.records[1].outcome.state==="unexecuted"&&snap.records[2].outcome.state==="completed"),local,rejected,completed,snapshot:snap});
}

const api=freeze({
  VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,REGISTRY_KEY,MAX_RECORDS,MAX_LEDGER_BYTES,MAX_DIALOGUE_CHARS,MAX_LINKS_PER_KIND,MAX_QUERY_RESULTS,
  normalizeRecord,append,fromEvaluation,get,list,snapshot,clear,proof
});
root().ConversationTransactions=api;
root().ConversationTransactionLedger=api;
})();
