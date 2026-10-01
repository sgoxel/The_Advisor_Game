(function(){
"use strict";

const VERSION="protagonist-goals-v1";
const SCHEMA="ProtagonistGoalLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-goal-ledger";
const REGISTRY_KEY="persistent-goals";
const MAX_GOALS=32;
const MAX_LEDGER_BYTES=48*1024;
const MAX_QUERY_RESULTS=16;
const MAX_HISTORY_LINKS=8;
const MAX_TOPIC_CHARS=160;
const MAX_REASON_CHARS=240;
const STATUS_VALUES=Object.freeze(["active","deferred","abandoned","completed"]);
const SOURCE_KINDS=Object.freeze(["self","advisor","duty","event","simulation","conversation"]);

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
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function validTimestamp(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestamp(value){const out=cleanText(value,32);if(!validTimestamp(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out}
function currentTimestamp(){return root().GameTime?.getTimestampKey?.()||null}
function identityKey(value){return cleanId(value||"protagonist",96)||"protagonist"}
function protagonistId(seed,key){
  const profile=root().ProtagonistProfile;
  try{const p=profile?.derive?.(seed,key);if(p?.protagonistId)return String(p.protagonistId)}catch(_){}
  return "PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1");
}
function uniqueIds(values){
  const out=[];for(const value of Array.isArray(values)?values:[]){const id=cleanId(value);if(id&&!out.includes(id))out.push(id);if(out.length>=MAX_HISTORY_LINKS)break}return out;
}
function normalizeSource(value){
  const src=value&&typeof value==="object"?value:{kind:value};
  const kind=SOURCE_KINDS.includes(String(src.kind||"").toLowerCase())?String(src.kind).toLowerCase():"self";
  return freeze({kind,id:cleanId(src.id||src.referenceId||"",160)||null});
}
function normalizeTarget(value){
  if(!value||typeof value!=="object")return null;
  const id=cleanId(value.id||value.targetId||"",160),kind=cleanId(value.kind||value.targetKind||"",80);
  return id&&kind?freeze({kind,id}):null;
}
function registryContext(seedValue,identityValue){
  const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key),world=root().WorldState;
  const ref=world?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{
    role:"persistent-protagonist-goals",protagonistId:actorId,identityKey:key,authority:"ProtagonistGoals metadata foundation"
  })||null;
  return freeze({seed,identityKey:key,protagonistId:actorId,ref});
}
function emptyLedger(ctx){
  return {
    schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,
    protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,
    revision:0,records:[],
    bounds:{maxGoals:MAX_GOALS,maxBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS,maxHistoryLinks:MAX_HISTORY_LINKS}
  };
}
function recordShapeValid(record){
  if(!record||typeof record!=="object"||!/^GOAL-[0-9A-F]{8}$/.test(String(record.id||"")))return false;
  if(!validTimestamp(record.createdFantasyTimestamp)||!validTimestamp(record.updatedFantasyTimestamp))return false;
  if(!STATUS_VALUES.includes(record.status)||!Number.isInteger(record.priority)||record.priority<0||record.priority>100)return false;
  if(typeof record.topic!=="string"||!record.topic||typeof record.goalType!=="string"||!record.goalType)return false;
  if(!record.source||!SOURCE_KINDS.includes(record.source.kind)||!Array.isArray(record.historyLinks)||record.historyLinks.length>MAX_HISTORY_LINKS)return false;
  if(record.status==="completed"){
    if(!record.completion||!record.completion.simulationResultId||record.completion.source!=="Simulation"||record.completion.authoritative!==true)return false;
  }else if(record.completion!=null)return false;
  return true;
}
function ledgerCompatible(raw,ctx){
  if(!raw||typeof raw!=="object")return false;
  if(raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION)return false;
  if(raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!Array.isArray(raw.records)||raw.records.length>MAX_GOALS)return false;
  const ids=new Set();
  for(const record of raw.records){if(!recordShapeValid(record)||ids.has(record.id))return false;ids.add(record.id)}
  return utf8Bytes(stableStringify(raw))<=MAX_LEDGER_BYTES;
}
function readLedger(seedValue,identityValue){
  const ctx=registryContext(seedValue,identityValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null;
  const raw=resolved?.current?.protagonistGoals;
  if(raw==null)return {ctx,resolved,compatible:true,exists:false,ledger:emptyLedger(ctx),reason:"empty"};
  if(!ledgerCompatible(raw,ctx))return {ctx,resolved,compatible:false,exists:true,ledger:null,reason:"ledger-incompatible"};
  return {ctx,resolved,compatible:true,exists:true,ledger:clone(raw),reason:"ok"};
}
function ordered(records){
  return (Array.isArray(records)?records:[]).map(clone).sort((a,b)=>
    Number(b.priority||0)-Number(a.priority||0)||
    String(a.createdFantasyTimestamp||"").localeCompare(String(b.createdFantasyTimestamp||""))||
    String(a.id||"").localeCompare(String(b.id||""))
  );
}
function writeLedger(seedValue,identityValue,ledgerValue,reasonValue){
  const read=readLedger(seedValue,identityValue),ctx=read.ctx,world=root().WorldState;
  if(!read.compatible)return freeze({ok:false,reason:read.reason});
  if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
  const next=clone(ledgerValue);
  next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;
  next.protagonistId=ctx.protagonistId;next.identityKey=ctx.identityKey;next.registryId=ctx.ref.id;
  next.revision=Math.max(0,Number(next.revision)||0)+1;
  if(!ledgerCompatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});
  const result=world.applyDelta(ctx.seed,ctx.ref,{protagonistGoals:next},String(reasonValue||"protagonist-goals"));
  return freeze({
    ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,
    deltaRevision:Number(result?.entry?.revision||0),recordCount:next.records.length,
    serializedBytes:utf8Bytes(stableStringify(next))
  });
}
function normalizeCreate(seed,ctx,inputValue){
  const input=inputValue&&typeof inputValue==="object"?inputValue:{};
  const created=timestamp(input.createdFantasyTimestamp||input.fantasyTimestamp||currentTimestamp());
  const goalType=cleanId(input.goalType||input.type||"personal",80)||"personal";
  const topic=cleanText(input.topic||input.title||input.goal,MAX_TOPIC_CHARS);
  if(!topic)throw new Error("Goal topic is required.");
  const source=normalizeSource(input.source),target=normalizeTarget(input.target||input.targetRef);
  const deadline=input.deadlineFantasyTimestamp==null||input.deadlineFantasyTimestamp===""?null:timestamp(input.deadlineFantasyTimestamp);
  const priority=Math.max(0,Math.min(100,Math.round(Number(input.priority)==Number(input.priority)?Number(input.priority):50)));
  const reason=cleanText(input.reason||"",MAX_REASON_CHARS);
  const historyLinks=freeze(uniqueIds(input.historyLinks||input.links||[]));
  const externalKey=cleanId(input.externalKey||input.requestId||"",160)||null;
  const basis={seed,protagonistId:ctx.protagonistId,goalType,topic,source,target,deadline,created,externalKey};
  const id="GOAL-"+hashText(stableStringify(basis));
  return freeze({
    id,goalType,topic,source,targetRef:target,priority,
    createdFantasyTimestamp:created,updatedFantasyTimestamp:created,deadlineFantasyTimestamp:deadline,
    status:"active",reason,historyLinks,externalKey,revision:1,completion:null,
    authority:freeze({chronology:"Fantasy Game Time",completion:"Simulation-backed evidence only",worldTruthCopied:false})
  });
}
function create(seedValue,inputValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);
  if(!read.compatible)return freeze({ok:false,reason:read.reason,record:null});
  let record;try{record=normalizeCreate(seed,read.ctx,inputValue)}catch(error){return freeze({ok:false,reason:String(error.message||error),record:null})}
  const existing=read.ledger.records.find(row=>row.id===record.id);
  if(existing)return freeze({ok:true,reason:"duplicate",duplicate:true,record:freeze(clone(existing)),recordCount:read.ledger.records.length});
  if(read.ledger.records.length>=MAX_GOALS)return freeze({ok:false,reason:"goal-limit-reached",record:null,recordCount:read.ledger.records.length});
  const next=clone(read.ledger);next.records.push(clone(record));
  const write=writeLedger(seed,identityValue,next,"protagonist-goal-create:"+record.id);
  return freeze({...write,duplicate:false,record:write.ok?record:null});
}
function get(seedValue,idValue,identityValue){
  const read=readLedger(seedValue,identityValue),id=cleanId(idValue);
  if(!read.compatible||!id)return null;
  const row=read.ledger.records.find(record=>record.id===id);
  return row?freeze(clone(row)):null;
}
function update(seedValue,idValue,patchValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue),id=cleanId(idValue),patch=patchValue&&typeof patchValue==="object"?patchValue:{};
  if(!read.compatible)return freeze({ok:false,reason:read.reason});
  const index=read.ledger.records.findIndex(row=>row.id===id);if(index<0)return freeze({ok:false,reason:"goal-not-found"});
  const current=read.ledger.records[index];if(["completed","abandoned"].includes(current.status))return freeze({ok:false,reason:"terminal-goal"});
  let when;try{when=timestamp(patch.updatedFantasyTimestamp||patch.fantasyTimestamp||currentTimestamp())}catch(error){return freeze({ok:false,reason:String(error.message||error)})}
  if(when<current.createdFantasyTimestamp)return freeze({ok:false,reason:"timestamp-before-created"});
  const nextRecord=clone(current);
  if(patch.priority!=null)nextRecord.priority=Math.max(0,Math.min(100,Math.round(Number(patch.priority))));
  if(patch.deadlineFantasyTimestamp!==undefined){
    if(patch.deadlineFantasyTimestamp==null||patch.deadlineFantasyTimestamp==="")nextRecord.deadlineFantasyTimestamp=null;
    else{try{nextRecord.deadlineFantasyTimestamp=timestamp(patch.deadlineFantasyTimestamp)}catch(error){return freeze({ok:false,reason:String(error.message||error)})}}
  }
  if(patch.reason!==undefined)nextRecord.reason=cleanText(patch.reason,MAX_REASON_CHARS);
  if(patch.historyLinks!==undefined)nextRecord.historyLinks=uniqueIds([...(nextRecord.historyLinks||[]),...uniqueIds(patch.historyLinks)]);
  nextRecord.updatedFantasyTimestamp=when;nextRecord.revision=Math.max(1,Number(nextRecord.revision)||1)+1;
  const next=clone(read.ledger);next.records[index]=nextRecord;
  const write=writeLedger(seed,identityValue,next,"protagonist-goal-update:"+id);
  return freeze({...write,record:write.ok?freeze(clone(nextRecord)):null});
}
function completionEvidence(value,when){
  const evidence=value&&typeof value==="object"?value:{};
  const simulationResultId=cleanId(evidence.simulationResultId||evidence.resultId||"",160);
  const authoritativeResultId=cleanId(evidence.authoritativeResultId||"",160)||null;
  const status=String(evidence.status||evidence.state||"").toLowerCase();
  const ok=Boolean(
    evidence.source==="Simulation"&&evidence.authoritative===true&&evidence.ok===true&&simulationResultId&&
    ["complete","completed","success","succeeded"].includes(status)
  );
  return ok?freeze({
    source:"Simulation",authoritative:true,simulationResultId,authoritativeResultId,
    status,completedFantasyTimestamp:when
  }):null;
}
function transition(seedValue,idValue,statusValue,optionsValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue),id=cleanId(idValue),status=String(statusValue||"").toLowerCase();
  const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
  if(!read.compatible)return freeze({ok:false,reason:read.reason});
  if(!STATUS_VALUES.includes(status))return freeze({ok:false,reason:"invalid-status"});
  const index=read.ledger.records.findIndex(row=>row.id===id);if(index<0)return freeze({ok:false,reason:"goal-not-found"});
  const current=read.ledger.records[index];
  if(current.status===status)return freeze({ok:true,reason:"no-op",record:freeze(clone(current)),recordCount:read.ledger.records.length});
  const allowed={active:["deferred","abandoned","completed"],deferred:["active","abandoned","completed"],abandoned:[],completed:[]};
  if(!allowed[current.status].includes(status))return freeze({ok:false,reason:"invalid-transition"});
  let when;try{when=timestamp(options.fantasyTimestamp||options.updatedFantasyTimestamp||currentTimestamp())}catch(error){return freeze({ok:false,reason:String(error.message||error)})}
  if(when<current.createdFantasyTimestamp)return freeze({ok:false,reason:"timestamp-before-created"});
  let completion=null;
  if(status==="completed"){
    completion=completionEvidence(options.evidence||options.simulationResult||options,when);
    if(!completion)return freeze({ok:false,reason:"authoritative-simulation-evidence-required",record:freeze(clone(current))});
  }
  const nextRecord=clone(current);
  nextRecord.status=status;nextRecord.updatedFantasyTimestamp=when;nextRecord.revision=Math.max(1,Number(nextRecord.revision)||1)+1;
  nextRecord.reason=cleanText(options.reason!==undefined?options.reason:nextRecord.reason,MAX_REASON_CHARS);
  nextRecord.historyLinks=uniqueIds([...(nextRecord.historyLinks||[]),...uniqueIds(options.historyLinks||[])]);
  nextRecord.completion=completion;
  const next=clone(read.ledger);next.records[index]=nextRecord;
  const write=writeLedger(seed,identityValue,next,"protagonist-goal-"+status+":"+id);
  return freeze({...write,record:write.ok?freeze(clone(nextRecord)):null});
}
function defer(seed,id,options,identity){return transition(seed,id,"deferred",options,identity)}
function activate(seed,id,options,identity){return transition(seed,id,"active",options,identity)}
function abandon(seed,id,options,identity){return transition(seed,id,"abandoned",options,identity)}
function complete(seed,id,options,identity){return transition(seed,id,"completed",options,identity)}
function list(seedValue,optionsValue,identityValue){
  const read=readLedger(seedValue,identityValue),options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
  if(!read.compatible)return freeze([]);
  const statuses=Array.isArray(options.statuses)?options.statuses.filter(x=>STATUS_VALUES.includes(String(x))):
    (STATUS_VALUES.includes(String(options.status||""))?[String(options.status)]:null);
  const minPriority=options.minPriority==null?null:Number(options.minPriority);
  const before=options.beforeTimestamp&&validTimestamp(options.beforeTimestamp)?String(options.beforeTimestamp):null;
  const after=options.afterTimestamp&&validTimestamp(options.afterTimestamp)?String(options.afterTimestamp):null;
  const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.limit)||MAX_QUERY_RESULTS)));
  const rows=ordered(read.ledger.records).filter(row=>
    (!statuses||statuses.includes(row.status))&&
    (minPriority==null||row.priority>=minPriority)&&
    (!before||row.createdFantasyTimestamp<=before)&&(!after||row.createdFantasyTimestamp>=after)
  );
  return freeze(rows.slice(0,limit).map(row=>freeze(clone(row))));
}
function snapshot(seedValue,identityValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);
  if(!read.compatible)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:false,reason:read.reason,recordCount:0,records:freeze([]),bounded:true});
  const records=ordered(read.ledger.records).map(row=>freeze(clone(row)));
  return freeze({
    version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,protagonistId:read.ctx.protagonistId,identityKey:read.ctx.identityKey,
    compatible:true,reason:read.reason,registryId:read.ctx.ref?.id||null,ledgerRevision:Number(read.ledger.revision||0),
    deltaRevision:Number(read.resolved?.delta?.revision||0),recordCount:records.length,
    serializedBytes:utf8Bytes(stableStringify(read.ledger)),maxGoals:MAX_GOALS,maxLedgerBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS,
    records:freeze(records),bounded:true,indexedById:true,boundedGoalScan:true,fullWorldScan:false,wholeHistoryScan:false,
    persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",
    directMovement:false,directActionExecution:false,unrelatedWorldMutation:false,goalMetadataMutationOnly:true,worldTruthCopied:false
  });
}
function clear(seedValue,identityValue){
  const read=readLedger(seedValue,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});
  return writeLedger(seedValue,identityValue,emptyLedger(read.ctx),"protagonist-goals-clear");
}

root().ProtagonistGoals=Object.freeze({
  VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,MAX_GOALS,MAX_LEDGER_BYTES,MAX_QUERY_RESULTS,STATUS_VALUES,
  create,get,update,transition,defer,activate,abandon,complete,list,snapshot,clear
});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistGoals;
})();