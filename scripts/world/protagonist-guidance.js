(function(){
"use strict";

const VERSION="protagonist-guidance-v1";
const SCHEMA="ProtagonistGuidanceLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-guidance-ledger";
const REGISTRY_KEY="persistent-guidance";
const MAX_RECORDS=24;
const MAX_LEDGER_BYTES=48*1024;
const MAX_QUERY_RESULTS=6;
const MAX_CONDITIONS=6;
const MAX_EXCEPTIONS=4;
const MAX_LIST_VALUES=8;
const MAX_TEXT=240;
const MAX_DECISION_SHIFT=0.08;
const STATUS_VALUES=Object.freeze(["active","retired"]);
const STANCE_VALUES=Object.freeze(["encourage","caution","avoid","neutral"]);
const CONDITION_FIELDS=Object.freeze(["topic","placeKind","activityKind","goalType","needKind","riskBand","authorityScope","socialContext","commandId"]);
const OPERATORS=Object.freeze(["eq","neq","in","contains","gte","lte","present","absent"]);

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n}
function cleanText(value,max=MAX_TEXT){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function validTimestamp(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestamp(value){const out=cleanText(value,32);if(!validTimestamp(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out}
function currentTimestamp(){return root().GameTime?.getTimestampKey?.()||null}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function identityKey(value){return cleanId(value||"protagonist",96)||"protagonist"}
function protagonistId(seed,key){try{const p=root().ProtagonistProfile?.derive?.(seed,key);if(p?.protagonistId)return String(p.protagonistId)}catch(_){}return "PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1")}
function normalizeScalar(value){if(value==null)return null;if(typeof value==="boolean")return value;if(typeof value==="number"&&Number.isFinite(value))return value;return cleanText(value,120)}
function normalizeValue(value){if(Array.isArray(value)){const out=[];for(const item of value.slice(0,MAX_LIST_VALUES)){const v=normalizeScalar(item);if(v!==null&&!out.some(x=>stable(x)===stable(v)))out.push(v)}return freeze(out)}return normalizeScalar(value)}
function normalizeClause(value){
  if(!plain(value))throw new Error("Guidance condition must be an object.");
  const field=cleanId(value.field,80),operator=cleanId(value.operator||"eq",40).toLowerCase();
  if(!CONDITION_FIELDS.includes(field))throw new Error("Unsupported guidance condition field.");
  if(!OPERATORS.includes(operator))throw new Error("Unsupported guidance condition operator.");
  const normalized=normalizeValue(value.value);
  if(!["present","absent"].includes(operator)&&normalized===null)throw new Error("Guidance condition value is required.");
  if(operator==="in"&&!Array.isArray(normalized))throw new Error("The in operator requires an array value.");
  if(["gte","lte"].includes(operator)&&typeof normalized!=="number")throw new Error("Numeric guidance condition value required.");
  return freeze({field,operator,value:["present","absent"].includes(operator)?null:normalized});
}
function normalizeClauses(values,max){
  const list=Array.isArray(values)?values:[];
  if(list.length>max)throw new Error("Guidance condition limit exceeded.");
  return freeze(list.map(normalizeClause));
}
function normalizeLinks(value){
  const links=plain(value)?value:{};
  return freeze({
    advisorRecordId:cleanId(links.advisorRecordId||links.advisorChannelRecordId||"",160)||null,
    conversationTransactionId:cleanId(links.conversationTransactionId||links.transactionId||"",160)||null
  });
}
function normalizeContext(value){
  const input=plain(value)?value:{},out={};
  for(const field of CONDITION_FIELDS){
    if(input[field]===undefined)continue;
    const v=normalizeValue(input[field]);
    if(v!==null)out[field]=v;
  }
  return freeze(out);
}
function valueEq(a,b){return stable(a)===stable(b)}
function clauseMatches(clause,context){
  const exists=Object.prototype.hasOwnProperty.call(context,clause.field),actual=context[clause.field];
  if(clause.operator==="present")return exists;
  if(clause.operator==="absent")return !exists;
  if(!exists)return false;
  if(clause.operator==="eq")return valueEq(actual,clause.value);
  if(clause.operator==="neq")return !valueEq(actual,clause.value);
  if(clause.operator==="in")return Array.isArray(clause.value)&&clause.value.some(v=>valueEq(actual,v));
  if(clause.operator==="contains"){
    if(Array.isArray(actual))return actual.some(v=>valueEq(v,clause.value));
    return typeof actual==="string"&&actual.includes(String(clause.value));
  }
  if(clause.operator==="gte")return Number.isFinite(Number(actual))&&Number(actual)>=Number(clause.value);
  if(clause.operator==="lte")return Number.isFinite(Number(actual))&&Number(actual)<=Number(clause.value);
  return false;
}
function recordRelevant(record,context){
  if(record.status!=="active")return false;
  if(record.conditions.some(clause=>!clauseMatches(clause,context)))return false;
  if(record.exceptions.some(clause=>clauseMatches(clause,context)))return false;
  return true;
}
function registryContext(seedValue,identityValue){
  const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key),world=root().WorldState;
  const ref=world?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{role:"persistent-protagonist-guidance",protagonistId:actorId,identityKey:key,authority:"ProtagonistGuidance advisory metadata"})||null;
  return freeze({seed,identityKey:key,protagonistId:actorId,ref});
}
function emptyLedger(ctx){return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,revision:0,records:[],bounds:{maxRecords:MAX_RECORDS,maxBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS,maxConditions:MAX_CONDITIONS,maxExceptions:MAX_EXCEPTIONS}}}
function recordValid(record){
  if(!plain(record)||!/^GUID-[0-9A-F]{8}$/.test(String(record.id||""))||!STATUS_VALUES.includes(record.status)||!STANCE_VALUES.includes(record.stance))return false;
  if(!validTimestamp(record.createdFantasyTimestamp)||!validTimestamp(record.updatedFantasyTimestamp)||record.updatedFantasyTimestamp<record.createdFantasyTimestamp)return false;
  if(!Number.isInteger(record.priority)||record.priority<0||record.priority>100||!record.topic||!record.principle)return false;
  if(!Array.isArray(record.conditions)||record.conditions.length>MAX_CONDITIONS||!Array.isArray(record.exceptions)||record.exceptions.length>MAX_EXCEPTIONS)return false;
  try{for(const clause of [...record.conditions,...record.exceptions])normalizeClause(clause)}catch(_){return false}
  return true;
}
function compatible(raw,ctx){
  if(!plain(raw)||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null)||!Array.isArray(raw.records)||raw.records.length>MAX_RECORDS)return false;
  const ids=new Set();for(const record of raw.records){if(!recordValid(record)||ids.has(record.id))return false;ids.add(record.id)}
  return utf8Bytes(stable(raw))<=MAX_LEDGER_BYTES;
}
function readLedger(seedValue,identityValue){
  const ctx=registryContext(seedValue,identityValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistGuidance;
  if(raw==null)return {ctx,resolved,compatible:true,exists:false,ledger:emptyLedger(ctx),reason:"empty"};
  if(!compatible(raw,ctx))return {ctx,resolved,compatible:false,exists:true,ledger:null,reason:"ledger-incompatible"};
  return {ctx,resolved,compatible:true,exists:true,ledger:clone(raw),reason:"ok"};
}
function writeLedger(seedValue,identityValue,ledgerValue,reasonValue){
  const read=readLedger(seedValue,identityValue),ctx=read.ctx,world=root().WorldState;if(!read.compatible)return freeze({ok:false,reason:read.reason});
  if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
  const next=clone(ledgerValue);next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;next.protagonistId=ctx.protagonistId;next.identityKey=ctx.identityKey;next.registryId=ctx.ref.id;next.revision=Math.max(0,Number(next.revision)||0)+1;
  if(!compatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});
  const result=world.applyDelta(ctx.seed,ctx.ref,{protagonistGuidance:next},String(reasonValue||"protagonist-guidance"));
  return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),recordCount:next.records.length,serializedBytes:utf8Bytes(stable(next))});
}
function ordered(records){return (Array.isArray(records)?records:[]).map(clone).sort((a,b)=>Number(b.priority)-Number(a.priority)||String(b.updatedFantasyTimestamp).localeCompare(String(a.updatedFantasyTimestamp))||String(a.id).localeCompare(String(b.id)))}
function normalizeCreate(seed,ctx,inputValue){
  const input=plain(inputValue)?inputValue:{},created=timestamp(input.createdFantasyTimestamp||input.fantasyTimestamp||currentTimestamp()),topic=cleanId(input.topic,120),principle=cleanText(input.principle,MAX_TEXT);
  if(!topic)throw new Error("Guidance topic is required.");if(!principle)throw new Error("Guidance principle is required.");
  const priority=Math.max(0,Math.min(100,Math.round(Number.isFinite(Number(input.priority))?Number(input.priority):50))),stance=cleanId(input.stance||"neutral",40).toLowerCase();
  if(!STANCE_VALUES.includes(stance))throw new Error("Unsupported guidance stance.");
  const conditions=normalizeClauses(input.conditions,MAX_CONDITIONS),exceptions=normalizeClauses(input.exceptions,MAX_EXCEPTIONS),links=normalizeLinks(input.links||input.references);
  const externalKey=cleanId(input.externalKey||input.requestId||"",160)||null,basis={seed,protagonistId:ctx.protagonistId,topic,principle,created,externalKey,links};
  return freeze({id:"GUID-"+hashText(stable(basis)),topic,principle,priority,stance,conditions,exceptions,links,externalKey,status:"active",createdFantasyTimestamp:created,updatedFantasyTimestamp:created,revision:1,authority:freeze({advisoryOnly:true,chronology:"Fantasy Game Time",execution:false,worldAuthority:false})});
}
function create(seedValue,inputValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason,record:null});
  let record;try{record=normalizeCreate(seed,read.ctx,inputValue)}catch(error){return freeze({ok:false,reason:String(error.message||error),record:null})}
  const existing=read.ledger.records.find(row=>row.id===record.id);if(existing)return freeze({ok:true,reason:"duplicate",duplicate:true,record:freeze(clone(existing)),recordCount:read.ledger.records.length});
  if(read.ledger.records.length>=MAX_RECORDS)return freeze({ok:false,reason:"guidance-limit-reached",record:null,recordCount:read.ledger.records.length});
  const next=clone(read.ledger);next.records.push(clone(record));const write=writeLedger(seed,identityValue,next,"protagonist-guidance-create:"+record.id);return freeze({...write,duplicate:false,record:write.ok?record:null});
}
function update(seedValue,idValue,patchValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue),id=cleanId(idValue,160),patch=plain(patchValue)?patchValue:{};if(!read.compatible)return freeze({ok:false,reason:read.reason});
  const index=read.ledger.records.findIndex(row=>row.id===id);if(index<0)return freeze({ok:false,reason:"guidance-not-found"});const current=read.ledger.records[index];if(current.status==="retired")return freeze({ok:false,reason:"retired-guidance"});
  let when;try{when=timestamp(patch.updatedFantasyTimestamp||patch.fantasyTimestamp||currentTimestamp())}catch(error){return freeze({ok:false,reason:String(error.message||error)})}
  if(when<current.updatedFantasyTimestamp)return freeze({ok:false,reason:"cannot-rewind-guidance-chronology"});
  const nextRecord=clone(current);
  try{
    if(patch.topic!==undefined){const topic=cleanId(patch.topic,120);if(!topic)throw new Error("Guidance topic is required.");nextRecord.topic=topic}
    if(patch.principle!==undefined){const principle=cleanText(patch.principle,MAX_TEXT);if(!principle)throw new Error("Guidance principle is required.");nextRecord.principle=principle}
    if(patch.priority!==undefined){const p=Number(patch.priority);if(!Number.isFinite(p))throw new Error("Guidance priority must be numeric.");nextRecord.priority=Math.max(0,Math.min(100,Math.round(p)))}
    if(patch.stance!==undefined){const stance=cleanId(patch.stance,40).toLowerCase();if(!STANCE_VALUES.includes(stance))throw new Error("Unsupported guidance stance.");nextRecord.stance=stance}
    if(patch.conditions!==undefined)nextRecord.conditions=normalizeClauses(patch.conditions,MAX_CONDITIONS);
    if(patch.exceptions!==undefined)nextRecord.exceptions=normalizeClauses(patch.exceptions,MAX_EXCEPTIONS);
    if(patch.links!==undefined||patch.references!==undefined)nextRecord.links=normalizeLinks(patch.links||patch.references);
  }catch(error){return freeze({ok:false,reason:String(error.message||error)})}
  nextRecord.updatedFantasyTimestamp=when;nextRecord.revision=Math.max(1,Number(nextRecord.revision)||1)+1;
  const next=clone(read.ledger);next.records[index]=nextRecord;const write=writeLedger(seed,identityValue,next,"protagonist-guidance-update:"+id);return freeze({...write,record:write.ok?freeze(clone(nextRecord)):null});
}
function retire(seedValue,idValue,optionsValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue),id=cleanId(idValue,160),options=plain(optionsValue)?optionsValue:{};if(!read.compatible)return freeze({ok:false,reason:read.reason});
  const index=read.ledger.records.findIndex(row=>row.id===id);if(index<0)return freeze({ok:false,reason:"guidance-not-found"});const current=read.ledger.records[index];if(current.status==="retired")return freeze({ok:true,reason:"no-op",record:freeze(clone(current))});
  let when;try{when=timestamp(options.fantasyTimestamp||options.updatedFantasyTimestamp||currentTimestamp())}catch(error){return freeze({ok:false,reason:String(error.message||error)})}
  if(when<current.updatedFantasyTimestamp)return freeze({ok:false,reason:"cannot-rewind-guidance-chronology"});
  const nextRecord=clone(current);nextRecord.status="retired";nextRecord.updatedFantasyTimestamp=when;nextRecord.revision=Math.max(1,Number(nextRecord.revision)||1)+1;
  const next=clone(read.ledger);next.records[index]=nextRecord;const write=writeLedger(seed,identityValue,next,"protagonist-guidance-retire:"+id);return freeze({...write,record:write.ok?freeze(clone(nextRecord)):null});
}
function relevant(seedValue,contextValue,optionsValue,identityValue){
  const read=readLedger(seedValue,identityValue),context=normalizeContext(contextValue),options=plain(optionsValue)?optionsValue:{};if(!read.compatible)return freeze([]);
  const topic=cleanId(options.topic||"",120)||null,limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.limit)||MAX_QUERY_RESULTS)));
  const rows=ordered(read.ledger.records).filter(row=>(!topic||row.topic===topic)&&recordRelevant(row,context)).slice(0,limit);
  return freeze(rows.map(row=>freeze({...clone(row),match:freeze({matched:true,contextFields:freeze(Object.keys(context).sort()),conditionCount:row.conditions.length,exceptionCount:row.exceptions.length})})));
}
function evaluationContext(seedValue,contextValue,baseDecisionContextValue,optionsValue,identityValue){
  const base=plain(baseDecisionContextValue)?baseDecisionContextValue:{},rows=relevant(seedValue,contextValue,optionsValue,identityValue);
  const value=Number.isFinite(Number(base.value))?Math.max(0,Math.min(1,Number(base.value))):0.5,urgency=Number.isFinite(Number(base.urgency))?Math.max(0,Math.min(1,Number(base.urgency))):0.5,social=Number.isFinite(Number(base.socialAcceptability))?Math.max(0,Math.min(1,Number(base.socialAcceptability))):0.5;
  let weighted=0,total=0;
  for(const row of rows){const weight=Math.max(0,Math.min(1,row.priority/100)),direction=row.stance==="encourage"?1:row.stance==="avoid"?-1:row.stance==="caution"?-0.35:0;weighted+=direction*weight;total+=weight}
  const normalized=total>0?Math.max(-1,Math.min(1,weighted/total)):0,shift=Number((normalized*MAX_DECISION_SHIFT).toFixed(4));
  const adjusted=freeze({value:Number(Math.max(0,Math.min(1,value+shift)).toFixed(4)),urgency:Number(urgency.toFixed(4)),socialAcceptability:Number(social.toFixed(4)),dutyConflict:Boolean(base.dutyConflict)});
  return freeze({version:VERSION,decisionContext:adjusted,guidanceFactor:Number(normalized.toFixed(4)),valueShift:shift,matchedGuidanceIds:freeze(rows.map(row=>row.id)),advisoryOnly:true,forcedDecision:false,requiresEvaluator:true,evaluatorBoundary:"ProtagonistCommandEvaluator",directActionExecution:false,worldMutation:false,simulationValidationBypass:false,bounded:true});
}
function get(seedValue,idValue,identityValue){const read=readLedger(seedValue,identityValue),id=cleanId(idValue,160);if(!read.compatible||!id)return null;const row=read.ledger.records.find(x=>x.id===id);return row?freeze(clone(row)):null}
function snapshot(seedValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);if(!read.compatible)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:false,reason:read.reason,recordCount:0,records:freeze([]),bounded:true});
  const records=ordered(read.ledger.records).map(row=>freeze(clone(row)));
  return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,protagonistId:read.ctx.protagonistId,identityKey:read.ctx.identityKey,compatible:true,reason:read.reason,registryId:read.ctx.ref?.id||null,ledgerRevision:Number(read.ledger.revision||0),deltaRevision:Number(read.resolved?.delta?.revision||0),recordCount:records.length,serializedBytes:utf8Bytes(stable(read.ledger)),maxRecords:MAX_RECORDS,maxLedgerBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS,records:freeze(records),bounded:true,indexedById:true,boundedRecordScan:true,fullWorldScan:false,wholeCampaignScan:false,persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",advisoryOnly:true,directActionExecution:false,unrelatedWorldMutation:false,providerStatePersisted:false,arbitraryPredicates:false});
}
function clear(seedValue,identityValue){const read=readLedger(seedValue,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});return writeLedger(seedValue,identityValue,emptyLedger(read.ctx),"protagonist-guidance-clear")}

root().ProtagonistGuidance=Object.freeze({VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,MAX_RECORDS,MAX_LEDGER_BYTES,MAX_QUERY_RESULTS,MAX_CONDITIONS,MAX_EXCEPTIONS,MAX_DECISION_SHIFT,STATUS_VALUES,STANCE_VALUES,CONDITION_FIELDS,OPERATORS,create,update,retire,get,relevant,evaluationContext,snapshot,clear});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistGuidance;
})();