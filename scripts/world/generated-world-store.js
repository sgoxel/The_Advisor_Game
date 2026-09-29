(function(){
"use strict";

const VERSION=1;
const SCHEMA="GeneratedWorldRecord";
const DB_NAME="theAdvisorGame.generated-world.v1";
const DB_VERSION=1;
const RECORD_STORE="records";
const META_STORE="meta";
const MEMORY_LIMIT=256;
const PRIME_LIMIT=128;
const WRITE_QUEUE_LIMIT=512;
const MAX_WRITE_BATCH=32;
const SOFT_BUDGET_BYTES=8*1024*1024;
const HARD_BUDGET_BYTES=12*1024*1024;

let boundCampaign=null;
let boundCampaignId=null;
let backendPromise=null;
let backendOverride=null;
let flushTimer=null;
const memory=new Map();
const writeQueue=new Map();
const runtime={
  backend:"uninitialized",durable:false,persistedPermission:null,quotaBytes:null,usageBytes:null,
  persistentRecordCount:0,persistentBytes:0,authoritativeSaveBytes:0,
  hitsByFamily:{},missesByFamily:{},loadedByFamily:{},regeneratedByFamily:{},invalidatedByFamily:{},
  loadedRecords:0,regeneratedRecords:0,invalidatedRecords:0,writeBatches:0,writeRecords:0,
  lastWriteBatchMs:0,maxWriteBatchMs:0,lastReadBatchMs:0,maxReadBatchMs:0,
  evictionCount:0,evictionBytes:0,storageErrors:0,lastStorageError:null,lastCommitSequence:0,
  primedRecords:0,primeLimit:PRIME_LIMIT,resumeTimeToFirstPlayableMs:null,backgroundGenerationResumedCount:0,
  frontier:{},boundAtMs:0
};

function now(){return typeof performance!=="undefined"&&performance.now?performance.now():Date.now()}
function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;
}
function deepFreeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))deepFreeze(item);
  return Object.freeze(value);
}
function stableStringify(value){
  if(typeof value==="bigint")return JSON.stringify(value.toString()+"n");
  if(value===undefined)return JSON.stringify("__undefined__");
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stableStringify(value[k])).join(",")+"}";
}
function hashText(value){
  const text=String(value==null?"":value);let h=2166136261>>>0;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0}
  h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function utf8Bytes(value){
  const text=String(value==null?"":value);
  if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;
  let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n;
}
function inc(map,key,amount=1){map[key]=(map[key]||0)+amount}
function campaignKey(campaign){return campaign?[String(campaign.seed||""),Number(campaign.realStartMs||0),Number(campaign.restartCount||0)].join("|"):null}
function campaignIdFor(campaign){
  const key=campaignKey(campaign);return key?"CMP-"+hashText(key):null;
}
function currentGeneratorVersion(){
  return String(window.WorldState?.WORLD_GENERATOR_VERSION||"advisor-world-foundation-v1");
}
function familyKey(family){return String(family||"unknown")}
function ensureCampaign(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(boundCampaign&&String(boundCampaign.seed)===seed)return boundCampaign;
  const current=window.SeedSystem?.getCampaign?.()||null;
  if(current?.seed&&String(current.seed)===seed){
    boundCampaign=current;boundCampaignId=campaignIdFor(current);runtime.boundAtMs=Date.now();
    if(!backendPromise)backendPromise=openBackend();
    return current;
  }
  return null;
}
function descriptor(optionsValue){
  const options=optionsValue||{},seed=String(options.seed==null?"":options.seed),campaign=options.campaign||ensureCampaign(seed);
  if(!seed||!campaign||String(campaign.seed)!==seed)return null;
  const campaignId=campaignIdFor(campaign),family=familyKey(options.family),recordId=String(options.recordId==null?"":options.recordId);
  if(!recordId)return null;
  const generatorVersion=String(options.generatorVersion||currentGeneratorVersion());
  const familyVersion=String(options.familyVersion==null?1:options.familyVersion);
  const dependencySignature=String(options.dependencySignature||"none");
  const seedHash=hashText(seed);
  const key=[campaignId,seedHash,generatorVersion,family,familyVersion,hashText(dependencySignature),recordId].join("|");
  return Object.freeze({key,campaignId,seed,seedHash,generatorVersion,family,familyVersion,dependencySignature,recordId});
}
function checksumBody(record){
  return {
    schema:record.schema,schemaVersion:record.schemaVersion,key:record.key,campaignId:record.campaignId,
    seedHash:record.seedHash,generatorVersion:record.generatorVersion,family:record.family,
    familyVersion:record.familyVersion,dependencySignature:record.dependencySignature,recordId:record.recordId,
    value:record.value
  };
}
function makeRecord(desc,value,optionsValue){
  const options=optionsValue||{},body={
    schema:SCHEMA,schemaVersion:VERSION,key:desc.key,campaignId:desc.campaignId,seedHash:desc.seedHash,
    generatorVersion:desc.generatorVersion,family:desc.family,familyVersion:desc.familyVersion,
    dependencySignature:desc.dependencySignature,recordId:desc.recordId,value:clone(value)
  };
  const checksum=hashText(stableStringify(body)),bytes=utf8Bytes(stableStringify(body));
  return deepFreeze({...body,checksum,bytes,regenCost:Number(options.regenCost||1),importance:Number(options.importance||1),
    createdAtMs:Number(options.createdAtMs||Date.now()),lastAccessMs:Number(options.lastAccessMs||Date.now()),
    commitSequence:Number(options.commitSequence||0),derivedCache:true,authoritative:false});
}
function validRecord(record,descValue){
  const desc=descValue||null;
  if(!record||record.schema!==SCHEMA||Number(record.schemaVersion)!==VERSION)return false;
  if(desc&&record.key!==desc.key)return false;
  if(hashText(stableStringify(checksumBody(record)))!==String(record.checksum||""))return false;
  return true;
}
function remember(record){
  if(!record?.key)return;
  if(memory.has(record.key))memory.delete(record.key);
  memory.set(record.key,record);
  while(memory.size>MEMORY_LIMIT)memory.delete(memory.keys().next().value);
}
function markFamilyFrontier(record){
  const family=record.family,current=runtime.frontier[family]||{resolvedCount:0,lastRecordId:null,lastCommitSequence:0};
  runtime.frontier[family]={resolvedCount:Math.max(current.resolvedCount,Number(current.resolvedCount||0)+1),lastRecordId:record.recordId,lastCommitSequence:Math.max(current.lastCommitSequence,Number(record.commitSequence||0))};
}
function peek(optionsValue){
  const desc=descriptor(optionsValue);if(!desc){return null}
  const record=memory.get(desc.key);
  if(!record||!validRecord(record,desc)){inc(runtime.missesByFamily,desc.family);return null}
  inc(runtime.hitsByFamily,desc.family);
  return deepFreeze(clone(record.value));
}
async function load(optionsValue){
  const desc=descriptor(optionsValue);if(!desc)return Object.freeze({ok:false,hit:false,reason:"campaign-not-bound"});
  const memoryValue=memory.get(desc.key);
  if(memoryValue&&validRecord(memoryValue,desc)){
    inc(runtime.hitsByFamily,desc.family);return Object.freeze({ok:true,hit:true,source:"memory",value:deepFreeze(clone(memoryValue.value))});
  }
  const started=now();
  try{
    const backend=await backendReady(),record=await backend.get(desc.key);
    const elapsed=now()-started;runtime.lastReadBatchMs=Number(elapsed.toFixed(3));runtime.maxReadBatchMs=Math.max(runtime.maxReadBatchMs,runtime.lastReadBatchMs);
    if(!record){inc(runtime.missesByFamily,desc.family);return Object.freeze({ok:true,hit:false,source:"persistent-miss"});}
    if(!validRecord(record,desc)){
      runtime.invalidatedRecords++;inc(runtime.invalidatedByFamily,desc.family);await backend.delete(desc.key);
      inc(runtime.missesByFamily,desc.family);return Object.freeze({ok:true,hit:false,source:"invalidated"});
    }
    const touched={...record,lastAccessMs:Date.now()};remember(deepFreeze(touched));
    runtime.loadedRecords++;inc(runtime.loadedByFamily,desc.family);inc(runtime.hitsByFamily,desc.family);
    return Object.freeze({ok:true,hit:true,source:"persistent",value:deepFreeze(clone(record.value))});
  }catch(error){
    noteStorageError(error);inc(runtime.missesByFamily,desc.family);
    return Object.freeze({ok:false,hit:false,source:"storage-error",reason:String(error?.message||error)});
  }
}
function recordGenerated(optionsValue,value){
  const desc=descriptor(optionsValue);if(!desc)return Object.freeze({ok:false,durable:false,reason:"campaign-not-bound"});
  const record=makeRecord(desc,value,optionsValue);
  if(record.bytes>HARD_BUDGET_BYTES)return Object.freeze({ok:false,durable:false,reason:"record-too-large",bytes:record.bytes});
  remember(record);
  writeQueue.set(record.key,record);
  runtime.regeneratedRecords++;inc(runtime.regeneratedByFamily,desc.family);
  if(writeQueue.size>WRITE_QUEUE_LIMIT){
    const oldest=writeQueue.keys().next().value;if(oldest)writeQueue.delete(oldest);
    runtime.lastStorageError="write-queue-pressure-derived-record-dropped";
  }
  scheduleFlush("generated-record");
  return Object.freeze({ok:true,durable:false,pending:true,key:record.key,bytes:record.bytes});
}
async function resolve(optionsValue,generator){
  const options=optionsValue||{},memoryValue=peek(options);
  if(memoryValue!=null)return Object.freeze({ok:true,source:"memory",value:memoryValue,generated:false});
  const loaded=await load(options);
  if(loaded.hit)return Object.freeze({ok:true,source:loaded.source,value:loaded.value,generated:false});
  if(typeof generator!=="function")return Object.freeze({ok:false,source:"missing",reason:"generator-required"});
  const started=now(),value=await generator(),regenMs=now()-started;
  recordGenerated({...options,regenCost:options.regenCost??Math.max(1,regenMs)},value);
  return Object.freeze({ok:true,source:"seed-regeneration",value:deepFreeze(clone(value)),generated:true,regenMs:Number(regenMs.toFixed(3))});
}
function scheduleFlush(reason){
  if(flushTimer!=null)return;
  const run=()=>{flushTimer=null;flush({reason,maxRecords:MAX_WRITE_BATCH}).catch(()=>{})};
  if(typeof requestIdleCallback==="function")flushTimer=requestIdleCallback(run,{timeout:750});
  else flushTimer=setTimeout(run,120);
}
function flushSoon(reason){scheduleFlush(reason||"requested");return Object.freeze({queued:writeQueue.size,reason:String(reason||"requested")})}
async function flush(optionsValue){
  const options=optionsValue||{},maxRecords=Math.max(1,Math.min(MAX_WRITE_BATCH,Number(options.maxRecords)||MAX_WRITE_BATCH));
  if(!writeQueue.size)return Object.freeze({ok:true,written:0,remaining:0,commitSequence:runtime.lastCommitSequence});
  const batch=[...writeQueue.values()].slice(0,maxRecords),started=now();
  try{
    const backend=await backendReady(),nextSequence=runtime.lastCommitSequence+1;
    const committed=batch.map(record=>deepFreeze({...record,commitSequence:nextSequence,lastAccessMs:Date.now()}));
    const meta={
      key:"campaign:"+String(boundCampaignId||""),
      campaignId:boundCampaignId,seedHash:boundCampaign?hashText(boundCampaign.seed):null,
      lastCommitSequence:nextSequence,lastCommitAtMs:Date.now(),frontier:clone(runtime.frontier)
    };
    await backend.commit(committed,meta);
    for(const record of committed){
      writeQueue.delete(record.key);remember(record);markFamilyFrontier(record);
    }
    runtime.lastCommitSequence=nextSequence;runtime.writeBatches++;runtime.writeRecords+=committed.length;
    const elapsed=now()-started;runtime.lastWriteBatchMs=Number(elapsed.toFixed(3));runtime.maxWriteBatchMs=Math.max(runtime.maxWriteBatchMs,runtime.lastWriteBatchMs);
    await refreshUsage();
    if(writeQueue.size)scheduleFlush("remaining-write-behind");
    if(runtime.persistentBytes>SOFT_BUDGET_BYTES)evictToBudget().catch(()=>{});
    return Object.freeze({ok:true,written:committed.length,remaining:writeQueue.size,commitSequence:nextSequence,durationMs:runtime.lastWriteBatchMs});
  }catch(error){
    noteStorageError(error);
    if(String(error?.name||"").includes("Quota")||String(error).includes("Quota"))runtime.backend=runtime.durable?"indexeddb-quota-error":runtime.backend;
    return Object.freeze({ok:false,written:0,remaining:writeQueue.size,reason:String(error?.message||error)});
  }
}
async function primeRecent(seedValue,optionsValue){
  const options=optionsValue||{},seed=String(seedValue==null?"":seedValue),campaign=options.campaign||ensureCampaign(seed);
  if(!campaign)return Object.freeze({ok:false,loaded:0,reason:"campaign-not-bound"});
  const limit=Math.max(1,Math.min(MEMORY_LIMIT,Number(options.limit)||PRIME_LIMIT)),started=now();
  try{
    const backend=await backendReady(),rows=await backend.listRecent(campaignIdFor(campaign),limit),currentGenerator=currentGeneratorVersion();
    let loaded=0,invalidated=0;
    for(const row of rows){
      if(!validRecord(row)||String(row.generatorVersion)!==currentGenerator){
        invalidated++;runtime.invalidatedRecords++;inc(runtime.invalidatedByFamily,row?.family||"unknown");
        try{await backend.delete(row.key)}catch(_){}
        continue;
      }
      remember(deepFreeze(row));loaded++;runtime.loadedRecords++;inc(runtime.loadedByFamily,row.family);
    }
    const elapsed=now()-started;runtime.lastReadBatchMs=Number(elapsed.toFixed(3));runtime.maxReadBatchMs=Math.max(runtime.maxReadBatchMs,runtime.lastReadBatchMs);
    runtime.primedRecords=loaded;runtime.primeLimit=limit;runtime.backgroundGenerationResumedCount=loaded;
    await refreshUsage();
    return Object.freeze({ok:true,loaded,invalidated,limit,durationMs:runtime.lastReadBatchMs,wholeCacheLoaded:false});
  }catch(error){noteStorageError(error);return Object.freeze({ok:false,loaded:0,reason:String(error?.message||error)});}
}
async function bindCampaign(campaignValue,optionsValue){
  const campaign=campaignValue||null,options=optionsValue||{};
  if(!campaign?.seed){
    boundCampaign=null;boundCampaignId=null;memory.clear();writeQueue.clear();
    return Object.freeze({ok:false,bound:false,reason:"campaign-required"});
  }
  boundCampaign=campaign;boundCampaignId=campaignIdFor(campaign);runtime.boundAtMs=Date.now();
  memory.clear();writeQueue.clear();
  const backend=await backendReady();
  try{
    const meta=await backend.getMeta("campaign:"+boundCampaignId);
    if(meta){runtime.lastCommitSequence=Number(meta.lastCommitSequence||0);runtime.frontier=clone(meta.frontier||{});}
  }catch(error){noteStorageError(error)}
  await updateStorageEstimate();
  const prime=options.prime===false?{ok:true,loaded:0,limit:0,wholeCacheLoaded:false}:await primeRecent(campaign.seed,{campaign,limit:options.primeLimit||PRIME_LIMIT});
  return deepFreeze({ok:true,bound:true,campaignId:boundCampaignId,backend:runtime.backend,durable:runtime.durable,prime});
}
async function invalidateFamily(familyValue,optionsValue){
  const family=familyKey(familyValue),options=optionsValue||{};
  if(!boundCampaignId)return Object.freeze({ok:false,removed:0,reason:"campaign-not-bound"});
  try{
    const backend=await backendReady(),rows=await backend.listFamily(boundCampaignId,family,10000),remove=[];
    for(const row of rows){
      const keepVersion=options.familyVersion==null||String(row.familyVersion)===String(options.familyVersion);
      const keepDependency=options.dependencySignature==null||String(row.dependencySignature)===String(options.dependencySignature);
      const keepGenerator=options.generatorVersion==null||String(row.generatorVersion)===String(options.generatorVersion);
      if(!(keepVersion&&keepDependency&&keepGenerator))remove.push(row);
    }
    for(const row of remove){await backend.delete(row.key);memory.delete(row.key);writeQueue.delete(row.key);}
    runtime.invalidatedRecords+=remove.length;inc(runtime.invalidatedByFamily,family,remove.length);
    await refreshUsage();
    return Object.freeze({ok:true,removed:remove.length,family,targeted:true});
  }catch(error){noteStorageError(error);return Object.freeze({ok:false,removed:0,reason:String(error?.message||error)});}
}
async function clearDerived(){
  if(!boundCampaignId)return Object.freeze({ok:false,removed:0,reason:"campaign-not-bound"});
  try{
    const backend=await backendReady(),rows=await backend.listCampaign(boundCampaignId,100000),bytes=rows.reduce((sum,row)=>sum+Number(row.bytes||0),0);
    await backend.deleteCampaign(boundCampaignId);memory.clear();writeQueue.clear();
    runtime.evictionCount+=rows.length;runtime.evictionBytes+=bytes;runtime.frontier={};runtime.persistentRecordCount=0;runtime.persistentBytes=0;
    return Object.freeze({ok:true,removed:rows.length,bytes,authoritativeCampaignUntouched:true});
  }catch(error){noteStorageError(error);return Object.freeze({ok:false,removed:0,reason:String(error?.message||error)});}
}
async function evictToBudget(targetBytesValue){
  const target=Math.max(0,Math.min(SOFT_BUDGET_BYTES,Number(targetBytesValue)||SOFT_BUDGET_BYTES));
  if(!boundCampaignId)return Object.freeze({ok:false,evicted:0,reason:"campaign-not-bound"});
  const backend=await backendReady(),rows=await backend.listCampaign(boundCampaignId,100000);
  let bytes=rows.reduce((sum,row)=>sum+Number(row.bytes||0),0);if(bytes<=target)return Object.freeze({ok:true,evicted:0,bytes});
  const ordered=rows.slice().sort((a,b)=>Number(a.importance||1)-Number(b.importance||1)||Number(a.regenCost||1)-Number(b.regenCost||1)||Number(a.lastAccessMs||0)-Number(b.lastAccessMs||0)||String(a.key).localeCompare(String(b.key)));
  let evicted=0,evictedBytes=0;
  for(const row of ordered){
    if(bytes<=target)break;
    await backend.delete(row.key);memory.delete(row.key);writeQueue.delete(row.key);
    bytes-=Number(row.bytes||0);evictedBytes+=Number(row.bytes||0);evicted++;
  }
  runtime.evictionCount+=evicted;runtime.evictionBytes+=evictedBytes;runtime.persistentRecordCount=Math.max(0,rows.length-evicted);runtime.persistentBytes=Math.max(0,bytes);
  return Object.freeze({ok:true,evicted,evictedBytes,bytes,target});
}
async function refreshUsage(){
  if(!boundCampaignId)return;
  try{
    const backend=await backendReady(),rows=await backend.listCampaign(boundCampaignId,100000);
    runtime.persistentRecordCount=rows.length;runtime.persistentBytes=rows.reduce((sum,row)=>sum+Number(row.bytes||0),0);
    const frontier={};
    for(const row of rows){
      const f=frontier[row.family]||{resolvedCount:0,lastRecordId:null,lastCommitSequence:0};
      f.resolvedCount++;if(Number(row.commitSequence||0)>=f.lastCommitSequence){f.lastCommitSequence=Number(row.commitSequence||0);f.lastRecordId=row.recordId}
      frontier[row.family]=f;
    }
    runtime.frontier=frontier;
  }catch(error){noteStorageError(error)}
}
function noteStorageError(error){runtime.storageErrors++;runtime.lastStorageError=String(error?.message||error)}
async function updateStorageEstimate(){
  try{
    if(typeof navigator!=="undefined"&&navigator.storage){
      if(typeof navigator.storage.estimate==="function"){
        const estimate=await navigator.storage.estimate();runtime.quotaBytes=Number(estimate?.quota||0)||null;runtime.usageBytes=Number(estimate?.usage||0)||null;
      }
      if(typeof navigator.storage.persisted==="function")runtime.persistedPermission=Boolean(await navigator.storage.persisted());
    }
  }catch(error){noteStorageError(error)}
}
function markFirstPlayable(){
  if(runtime.boundAtMs)runtime.resumeTimeToFirstPlayableMs=Math.max(0,Date.now()-runtime.boundAtMs);
  return telemetry();
}
function telemetry(){
  let authoritativeSaveBytes=0;
  try{authoritativeSaveBytes=Number(window.CampaignPersistence?.stored?.()?.validation?.serializedBytes||0)}catch(_){}
  runtime.authoritativeSaveBytes=authoritativeSaveBytes;
  return deepFreeze({
    version:VERSION,schema:SCHEMA,campaignId:boundCampaignId,backend:runtime.backend,durable:runtime.durable,
    persistedPermission:runtime.persistedPermission,quotaBytes:runtime.quotaBytes,usageBytes:runtime.usageBytes,
    persistentCacheRecords:runtime.persistentRecordCount,persistentCacheBytes:runtime.persistentBytes,
    authoritativeSaveBytes:runtime.authoritativeSaveBytes,memoryRecords:memory.size,dirtyQueueDepth:writeQueue.size,
    hitsByFamily:clone(runtime.hitsByFamily),missesByFamily:clone(runtime.missesByFamily),
    loadedByFamily:clone(runtime.loadedByFamily),regeneratedByFamily:clone(runtime.regeneratedByFamily),
    invalidatedByFamily:clone(runtime.invalidatedByFamily),loadedRecords:runtime.loadedRecords,
    regeneratedRecords:runtime.regeneratedRecords,invalidatedRecords:runtime.invalidatedRecords,
    writeBatches:runtime.writeBatches,writeRecords:runtime.writeRecords,lastWriteBatchMs:runtime.lastWriteBatchMs,
    maxWriteBatchMs:runtime.maxWriteBatchMs,lastReadBatchMs:runtime.lastReadBatchMs,maxReadBatchMs:runtime.maxReadBatchMs,
    lastCommitSequence:runtime.lastCommitSequence,evictionCount:runtime.evictionCount,evictionBytes:runtime.evictionBytes,
    storageErrors:runtime.storageErrors,lastStorageError:runtime.lastStorageError,
    softBudgetBytes:SOFT_BUDGET_BYTES,hardBudgetBytes:HARD_BUDGET_BYTES,writeBatchLimit:MAX_WRITE_BATCH,
    writeQueueLimit:WRITE_QUEUE_LIMIT,memoryLimit:MEMORY_LIMIT,primeLimit:runtime.primeLimit,primedRecords:runtime.primedRecords,
    generationFrontier:clone(runtime.frontier),resumeTimeToFirstPlayableMs:runtime.resumeTimeToFirstPlayableMs,
    backgroundGenerationResumedCount:runtime.backgroundGenerationResumedCount,
    wholeCacheLoadedAtStartup:false,authoritativeRecordsEvictable:false,gpuObjectsDurable:false,
    cameraKeyed:false,loadOrderKeyed:false,seedFallback:true
  });
}

function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("IndexedDB request failed"));})}
function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error("IndexedDB transaction failed"));tx.onabort=()=>reject(tx.error||new Error("IndexedDB transaction aborted"));})}
function openIndexedDb(){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined"){reject(new Error("IndexedDB unavailable"));return}
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      let records;
      if(!db.objectStoreNames.contains(RECORD_STORE)){
        records=db.createObjectStore(RECORD_STORE,{keyPath:"key"});
        records.createIndex("campaignId","campaignId",{unique:false});
        records.createIndex("campaignFamily",["campaignId","family"],{unique:false});
        records.createIndex("campaignAccess",["campaignId","lastAccessMs"],{unique:false});
      }
      if(!db.objectStoreNames.contains(META_STORE))db.createObjectStore(META_STORE,{keyPath:"key"});
    };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("IndexedDB open failed"));
  });
}
function idbBackend(db){
  const rangeForCampaign=campaignId=>IDBKeyRange.only(campaignId);
  const collect=(index,range,limit,direction="next")=>new Promise((resolve,reject)=>{
    const out=[],request=index.openCursor(range,direction);
    request.onerror=()=>reject(request.error||new Error("IndexedDB cursor failed"));
    request.onsuccess=()=>{const cursor=request.result;if(!cursor||out.length>=limit){resolve(out);return}out.push(cursor.value);cursor.continue();};
  });
  return {
    kind:"indexeddb",durable:true,
    async get(key){const tx=db.transaction(RECORD_STORE,"readonly");return requestResult(tx.objectStore(RECORD_STORE).get(key));},
    async getMeta(key){const tx=db.transaction(META_STORE,"readonly");return requestResult(tx.objectStore(META_STORE).get(key));},
    async commit(records,meta){
      const tx=db.transaction([RECORD_STORE,META_STORE],"readwrite"),store=tx.objectStore(RECORD_STORE);
      for(const record of records)store.put(clone(record));
      if(meta)tx.objectStore(META_STORE).put(clone(meta));
      await transactionDone(tx);return true;
    },
    async delete(key){const tx=db.transaction(RECORD_STORE,"readwrite");tx.objectStore(RECORD_STORE).delete(key);await transactionDone(tx);},
    async listRecent(campaignId,limit){
      const tx=db.transaction(RECORD_STORE,"readonly"),index=tx.objectStore(RECORD_STORE).index("campaignAccess");
      const range=IDBKeyRange.bound([campaignId,0],[campaignId,Number.MAX_SAFE_INTEGER]);
      return collect(index,range,limit,"prev");
    },
    async listCampaign(campaignId,limit){const tx=db.transaction(RECORD_STORE,"readonly"),index=tx.objectStore(RECORD_STORE).index("campaignId");return collect(index,rangeForCampaign(campaignId),limit,"next");},
    async listFamily(campaignId,family,limit){const tx=db.transaction(RECORD_STORE,"readonly"),index=tx.objectStore(RECORD_STORE).index("campaignFamily");return collect(index,IDBKeyRange.only([campaignId,family]),limit,"next");},
    async deleteCampaign(campaignId){
      const rows=await this.listCampaign(campaignId,100000),tx=db.transaction(RECORD_STORE,"readwrite"),store=tx.objectStore(RECORD_STORE);for(const row of rows)store.delete(row.key);await transactionDone(tx);
    }
  };
}
function memoryBackend(sharedValue){
  const shared=sharedValue||{records:new Map(),meta:new Map(),failNextCommit:false,failError:null};
  if(!shared.records)shared.records=new Map();if(!shared.meta)shared.meta=new Map();
  return {
    kind:"memory-fallback",durable:false,shared,
    async get(key){return shared.records.has(key)?clone(shared.records.get(key)):undefined},
    async getMeta(key){return shared.meta.has(key)?clone(shared.meta.get(key)):undefined},
    async commit(records,meta){
      if(shared.failNextCommit){shared.failNextCommit=false;const e=shared.failError||new Error("simulated interrupted transaction");shared.failError=null;throw e}
      const staged=new Map(shared.records),stagedMeta=new Map(shared.meta);
      for(const record of records)staged.set(record.key,clone(record));if(meta)stagedMeta.set(meta.key,clone(meta));
      shared.records.clear();for(const [k,v] of staged)shared.records.set(k,v);
      shared.meta.clear();for(const [k,v] of stagedMeta)shared.meta.set(k,v);return true;
    },
    async delete(key){shared.records.delete(key)},
    async listRecent(campaignId,limit){return [...shared.records.values()].filter(x=>x.campaignId===campaignId).sort((a,b)=>Number(b.lastAccessMs||0)-Number(a.lastAccessMs||0)||String(a.key).localeCompare(String(b.key))).slice(0,limit).map(clone)},
    async listCampaign(campaignId,limit){return [...shared.records.values()].filter(x=>x.campaignId===campaignId).slice(0,limit).map(clone)},
    async listFamily(campaignId,family,limit){return [...shared.records.values()].filter(x=>x.campaignId===campaignId&&x.family===family).slice(0,limit).map(clone)},
    async deleteCampaign(campaignId){for(const [k,v] of [...shared.records])if(v.campaignId===campaignId)shared.records.delete(k)}
  };
}
async function openBackend(){
  if(backendOverride){
    runtime.backend=backendOverride.kind||"custom";runtime.durable=Boolean(backendOverride.durable);return backendOverride;
  }
  try{const db=await openIndexedDb(),backend=idbBackend(db);runtime.backend=backend.kind;runtime.durable=true;return backend}
  catch(error){noteStorageError(error);const backend=memoryBackend();runtime.backend=backend.kind;runtime.durable=false;return backend}
}
function backendReady(){if(!backendPromise)backendPromise=openBackend();return backendPromise}
function resetRuntimeForTesting(optionsValue){
  const options=optionsValue||{};memory.clear();writeQueue.clear();if(flushTimer!=null){try{clearTimeout(flushTimer)}catch(_){}flushTimer=null}
  boundCampaign=null;boundCampaignId=null;
  if(!options.keepBackend){backendPromise=null;backendOverride=null}
  for(const key of Object.keys(runtime)){
    if(["hitsByFamily","missesByFamily","loadedByFamily","regeneratedByFamily","invalidatedByFamily","frontier"].includes(key))runtime[key]={};
  }
  Object.assign(runtime,{persistentRecordCount:0,persistentBytes:0,authoritativeSaveBytes:0,loadedRecords:0,regeneratedRecords:0,invalidatedRecords:0,writeBatches:0,writeRecords:0,lastWriteBatchMs:0,maxWriteBatchMs:0,lastReadBatchMs:0,maxReadBatchMs:0,evictionCount:0,evictionBytes:0,storageErrors:0,lastStorageError:null,lastCommitSequence:0,primedRecords:0,resumeTimeToFirstPlayableMs:null,backgroundGenerationResumedCount:0,boundAtMs:0});
}
function useBackendForTesting(backend){backendOverride=backend;backendPromise=Promise.resolve(backend);runtime.backend=backend.kind||"test";runtime.durable=Boolean(backend.durable);}

if(typeof window!=="undefined"&&window.addEventListener){
  window.addEventListener("pagehide",()=>{flush({reason:"pagehide",maxRecords:MAX_WRITE_BATCH}).catch(()=>{})});
  if(typeof document!=="undefined")document.addEventListener?.("visibilitychange",()=>{if(document.visibilityState==="hidden")flush({reason:"hidden",maxRecords:MAX_WRITE_BATCH}).catch(()=>{})});
}

window.GeneratedWorldStore=Object.freeze({
  VERSION,SCHEMA,DB_NAME,DB_VERSION,MEMORY_LIMIT,PRIME_LIMIT,WRITE_QUEUE_LIMIT,MAX_WRITE_BATCH,SOFT_BUDGET_BYTES,HARD_BUDGET_BYTES,
  bindCampaign,primeRecent,peek,load,resolve,recordGenerated,flush,flushSoon,invalidateFamily,clearDerived,evictToBudget,refreshUsage,
  telemetry,markFirstPlayable,campaignIdFor,
  _testing:Object.freeze({memoryBackend,useBackend:useBackendForTesting,resetRuntime:resetRuntimeForTesting,stableStringify,hashText})
});
})();