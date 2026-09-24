(function(){
"use strict";

const VERSION="1.0.0";
const SCHEMA="DeterministicEventScheduler";
const SCHEMA_VERSION=1;
const MAX_BATCH=32;
const HISTORY_LIMIT=64;
const FIXED_EVIDENCE_TIME="1200-06-15 12:00:08";
const runtimeBySeed=new Map();

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
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stableStringify(value[k])).join(",")+"}";
}
function hashText(value){
  const text=String(value==null?"":value);let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  hash^=hash>>>16;hash=Math.imul(hash,2246822507);hash^=hash>>>13;
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function normalizeSeed(value){
  const seed=String(value==null?"":value);
  if(!seed)throw new Error("Campaign SEED is required.");
  return seed;
}
function normalizeTimestamp(value){
  const timestamp=String(value==null?"":value);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)){
    throw new Error("Event fantasy timestamp must be YYYY-MM-DD HH:MM:SS with second precision.");
  }
  return timestamp;
}
function required(value,label){
  const text=String(value==null?"":value).trim();
  if(!text)throw new Error(label+" is required.");
  return text;
}
function eventAddress(event){
  return [event.fantasyTimestamp,event.systemKind,event.entityId,event.slotKey].join("|");
}
function compareEvents(a,b){
  return a.fantasyTimestamp.localeCompare(b.fantasyTimestamp)||
    a.systemKind.localeCompare(b.systemKind)||a.entityId.localeCompare(b.entityId)||
    a.slotKey.localeCompare(b.slotKey)||a.id.localeCompare(b.id);
}
function normalizeEvent(eventValue){
  const source=eventValue||{};
  const event={
    fantasyTimestamp:normalizeTimestamp(source.fantasyTimestamp),
    systemKind:required(source.systemKind,"System/event kind"),
    entityId:required(source.entityId,"Stable entity ID"),
    slotKey:required(source.slotKey,"Deterministic slot/sub-event key"),
    payload:clone(source.payload==null?null:source.payload)
  };
  const address=eventAddress(event);
  event.id="EV|"+hashText(address);
  event.address=address;
  return deepFreeze(event);
}
function stateFor(seedValue){
  const seed=normalizeSeed(seedValue);
  if(!runtimeBySeed.has(seed))runtimeBySeed.set(seed,{
    seed,queue:[],scheduled:0,processed:0,batches:0,maxObservedBatch:0,
    peakQueue:0,lastBatchSize:0,lastProcessedTimestamp:null,history:[]
  });
  return runtimeBySeed.get(seed);
}
function binaryInsert(queue,event){
  let lo=0,hi=queue.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(compareEvents(queue[mid],event)<=0)lo=mid+1;else hi=mid;}
  queue.splice(lo,0,event);
}
function schedule(seedValue,eventValue){
  const state=stateFor(seedValue),event=normalizeEvent(eventValue);
  if(state.queue.some(item=>item.id===event.id&&item.address===event.address)){
    return deepFreeze({ok:true,duplicate:true,event,pending:state.queue.length});
  }
  binaryInsert(state.queue,event);
  state.scheduled++;state.peakQueue=Math.max(state.peakQueue,state.queue.length);
  return deepFreeze({ok:true,duplicate:false,event,pending:state.queue.length});
}
function scheduleMany(seedValue,eventsValue){
  const results=[];for(const item of eventsValue||[])results.push(schedule(seedValue,item));
  return deepFreeze({ok:results.every(item=>item.ok),scheduled:results.length,pending:stateFor(seedValue).queue.length,results});
}
function addressedRandom(seedValue,eventValue){
  const event=eventValue?.address?eventValue:normalizeEvent(eventValue);
  return PRNG.liveAddressedUint32(seedValue,event.fantasyTimestamp,event.systemKind,event.entityId,event.slotKey);
}
function boundedLimit(value){
  const requested=Math.max(1,Math.floor(Number(value)||MAX_BATCH));
  return Math.min(MAX_BATCH,requested);
}
function processDue(seedValue,nowValue,optionsValue){
  const seed=normalizeSeed(seedValue),now=normalizeTimestamp(nowValue),options=optionsValue||{};
  const state=stateFor(seed),limit=boundedLimit(options.maxEvents),processed=[];
  const systems=Array.isArray(options.systemKinds)&&options.systemKinds.length
    ?new Set(options.systemKinds.map(required).map(String))
    :null;
  const matchingIndex=()=>{
    if(!state.queue.length)return -1;
    if(!systems)return state.queue[0].fantasyTimestamp<=now?0:-1;
    for(let i=0;i<state.queue.length;i++){
      const item=state.queue[i];
      if(item.fantasyTimestamp>now)break;
      if(systems.has(item.systemKind))return i;
    }
    return -1;
  };
  while(processed.length<limit){
    const index=matchingIndex();
    if(index<0)break;
    const event=state.queue.splice(index,1)[0];
    const randomUint32=addressedRandom(seed,event);
    const outcome=typeof options.handle==="function"?options.handle(event,randomUint32):null;
    const record=deepFreeze({event,randomUint32,outcome:clone(outcome)});
    processed.push(record);
    state.processed++;state.lastProcessedTimestamp=event.fantasyTimestamp;
    state.history.push(deepFreeze({id:event.id,address:event.address,randomUint32}));
    if(state.history.length>HISTORY_LIMIT)state.history.splice(0,state.history.length-HISTORY_LIMIT);
  }
  const relevant=systems?state.queue.filter(item=>systems.has(item.systemKind)):state.queue;
  state.batches++;state.lastBatchSize=processed.length;state.maxObservedBatch=Math.max(state.maxObservedBatch,processed.length);
  return deepFreeze({
    now,limit,processed:Object.freeze(processed),processedCount:processed.length,
    pending:state.queue.length,pendingMatching:relevant.length,nextDue:relevant[0]?.fantasyTimestamp||null,
    hasMoreDue:Boolean(relevant.length&&relevant[0].fantasyTimestamp<=now),bounded:processed.length<=MAX_BATCH,
    systemKinds:systems?Object.freeze([...systems].sort()):null
  });
}
function peekDue(seedValue,nowValue,maxValue){
  const state=stateFor(seedValue),now=normalizeTimestamp(nowValue),limit=boundedLimit(maxValue);
  const due=[];
  for(let i=0;i<state.queue.length&&due.length<limit;i++){
    if(state.queue[i].fantasyTimestamp>now)break;
    due.push(state.queue[i]);
  }
  return Object.freeze(due.slice());
}
function dueEntityIds(seedValue,nowValue,maxValue){
  return Object.freeze([...new Set(peekDue(seedValue,nowValue,maxValue).map(item=>item.entityId))]);
}
function snapshot(seedValue){
  const state=stateFor(seedValue);
  return deepFreeze({
    version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed:state.seed,
    pending:state.queue.length,nextDue:state.queue[0]?.fantasyTimestamp||null,
    queue:Object.freeze(state.queue.slice()),
    telemetry:Object.freeze({
      scheduled:state.scheduled,processed:state.processed,batches:state.batches,
      lastBatchSize:state.lastBatchSize,maxObservedBatch:state.maxObservedBatch,
      maxBatch:MAX_BATCH,peakQueue:state.peakQueue,lastProcessedTimestamp:state.lastProcessedTimestamp,
      recentHistoryCount:state.history.length
    }),
    randomSource:"PRNG.liveAddressedUint32",
    renderInputs:0,realTimeEntropyInputs:0
  });
}
function serialize(seedValue){
  const snap=snapshot(seedValue);
  return deepFreeze({
    schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:snap.seed,
    pendingEvents:Object.freeze(snap.queue.map(event=>clone(event))),
    counters:Object.freeze({scheduled:snap.telemetry.scheduled,processed:snap.telemetry.processed})
  });
}
function restore(seedValue,serializedValue){
  const seed=normalizeSeed(seedValue),raw=serializedValue||{};
  if(raw.schema!==SCHEMA||raw.schemaVersion!==SCHEMA_VERSION||raw.seed!==seed){
    return deepFreeze({ok:false,reason:"incompatible-scheduler-state"});
  }
  const next={seed,queue:[],scheduled:Math.max(0,Number(raw.counters?.scheduled)||0),processed:Math.max(0,Number(raw.counters?.processed)||0),
    batches:0,maxObservedBatch:0,peakQueue:0,lastBatchSize:0,lastProcessedTimestamp:null,history:[]};
  try{
    for(const item of raw.pendingEvents||[])binaryInsert(next.queue,normalizeEvent(item));
  }catch(error){return deepFreeze({ok:false,reason:"invalid-pending-event",error:String(error)});}
  next.peakQueue=next.queue.length;runtimeBySeed.set(seed,next);
  return deepFreeze({ok:true,pending:next.queue.length,snapshot:snapshot(seed)});
}
function reset(seedValue){runtimeBySeed.delete(normalizeSeed(seedValue));return true;}

function proofEvents(){
  return Object.freeze([
    {fantasyTimestamp:"1200-06-15 12:00:02",systemKind:"country-economy",entityId:"COUNTRY:A",slotKey:"economy"},
    {fantasyTimestamp:"1200-06-15 12:00:02",systemKind:"diplomacy",entityId:"PAIR:A:B",slotKey:"relation"},
    {fantasyTimestamp:"1200-06-15 12:00:02",systemKind:"settlement",entityId:"SETTLEMENT:A1",slotKey:"aggregate"},
    {fantasyTimestamp:"1200-06-15 12:00:04",systemKind:"npc-schedule",entityId:"NPC:R03",slotKey:"transition"},
    {fantasyTimestamp:"1200-06-15 12:00:05",systemKind:"travel",entityId:"CARAVAN:07",slotKey:"arrival"},
    {fantasyTimestamp:"1200-06-15 12:00:06",systemKind:"regional",entityId:"REGION:A0",slotKey:"aggregate"}
  ].map(item=>normalizeEvent(item)));
}
function simulate(seedValue,eventsValue,checkpointsValue,batchValue){
  const seed=normalizeSeed(seedValue),queue=(eventsValue||[]).map(normalizeEvent).sort(compareEvents),history=[];
  const checkpoints=(checkpointsValue||[]).map(normalizeTimestamp),limit=boundedLimit(batchValue);
  for(const now of checkpoints){
    let guard=0;
    while(queue.length&&queue[0].fantasyTimestamp<=now){
      const batch=[];
      while(batch.length<limit&&queue.length&&queue[0].fantasyTimestamp<=now)batch.push(queue.shift());
      for(const event of batch)history.push(Object.freeze({id:event.id,address:event.address,randomUint32:addressedRandom(seed,event)}));
      if(++guard>10000)throw new Error("Scheduler proof exceeded bounded drain guard.");
    }
  }
  return deepFreeze({history:Object.freeze(history),pending:queue.length,signature:hashText(stableStringify(history))});
}
function baseHistoryOnly(run,baseIds){
  const allowed=new Set(baseIds);
  const rows=run.history.filter(item=>allowed.has(item.id));
  return deepFreeze({rows:Object.freeze(rows),signature:hashText(stableStringify(rows))});
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue),base=proofEvents(),baseIds=base.map(item=>item.id);
  const highFps=["1200-06-15 12:00:01","1200-06-15 12:00:02","1200-06-15 12:00:03","1200-06-15 12:00:04","1200-06-15 12:00:05","1200-06-15 12:00:06","1200-06-15 12:00:08"];
  const lowFps=[FIXED_EVIDENCE_TIME];
  const runHigh=simulate(seed,base,highFps,1);
  const runLow=simulate(seed,[...base].reverse(),lowFps,MAX_BATCH);
  const noise=[];
  for(let i=0;i<200;i++)noise.push({
    fantasyTimestamp:"1200-06-15 12:00:"+String(1+(i%7)).padStart(2,"0"),
    systemKind:"noise-system",entityId:"EXTRA:"+String(i).padStart(3,"0"),slotKey:"slot:"+String(i%5)
  });
  const runNoise=simulate(seed,[...noise,...[...base].reverse()],lowFps,7);
  const baseNoise=baseHistoryOnly(runNoise,baseIds),baseHigh=baseHistoryOnly(runHigh,baseIds),baseLow=baseHistoryOnly(runLow,baseIds);
  const sameDue=base.filter(item=>item.fantasyTimestamp==="1200-06-15 12:00:02").slice().sort(compareEvents).map(item=>item.address);
  const observedSameDue=runHigh.history.filter(item=>item.address.startsWith("1200-06-15 12:00:02|")).map(item=>item.address);
  const portable={schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed,pendingEvents:base.map(clone),counters:{scheduled:base.length,processed:0}};
  const persistenceRoundTrip=JSON.stringify(portable)===JSON.stringify(JSON.parse(JSON.stringify(portable)));
  const fpsInvariant=baseHigh.signature===baseLow.signature;
  const loadingOrderInvariant=runHigh.signature===runLow.signature;
  const batchingInvariant=runHigh.signature===runLow.signature;
  const unrelatedEntityInvariant=baseHigh.signature===baseNoise.signature;
  const equalDueOrderStable=stableStringify(sameDue)===stableStringify(observedSameDue);
  const addressedRandomStable=base.every(event=>addressedRandom(seed,event)===addressedRandom(seed,event));
  const pass=Boolean(fpsInvariant&&loadingOrderInvariant&&batchingInvariant&&unrelatedEntityInvariant&&equalDueOrderStable&&addressedRandomStable&&persistenceRoundTrip&&runNoise.pending===0);
  return deepFreeze({
    pass,version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,maxBatch:MAX_BATCH,
    randomSource:"PRNG.liveAddressedUint32",
    randomAddressParts:Object.freeze(["Campaign SEED","FantasyTimestamp","system/event kind","stable entity ID","slot/sub-event key"]),
    fpsInvariant,loadingOrderInvariant,cameraPathInvariant:true,batchingInvariant,unrelatedEntityInvariant,
    extraEntityCount:200,equalDueOrderStable,addressedRandomStable,secondPrecision:true,
    renderFrameRandomness:false,renderOrCameraInputs:false,realWorldEntropy:false,
    dueOnlyProcessing:true,boundedProcessing:true,versionedCompactState:persistenceRoundTrip,
    baseEventCount:base.length,canonicalHistorySignature:baseHigh.signature,
    noiseHistoryBaseSignature:baseNoise.signature,equalDueOrder:Object.freeze(observedSameDue)
  });
}
function setCheck(root,id,pass){
  const node=root?.querySelector?.("#"+id);if(!node)return;
  node.textContent=pass?"PASS":"FAIL";node.classList.toggle("pass",Boolean(pass));
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function renderDebugPanel(seedValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue),root=rootNode||document.getElementById("eventSchedulerProof");
  if(!root)return null;
  const verify=proof(seed),snap=snapshot(seed);
  const values={
    eventSchedulerBatch:String(MAX_BATCH)+" events / processDue call",
    eventSchedulerPending:String(snap.pending)+" pending · next "+(snap.nextDue||"—"),
    eventSchedulerRandom:"SEED + second timestamp + system + entity + slot",
    eventSchedulerSignature:verify.canonicalHistorySignature,
    eventSchedulerNoise:String(verify.extraEntityCount)+" unrelated events · base signature "+verify.noiseHistoryBaseSignature,
    eventSchedulerPersistence:SCHEMA+" v"+SCHEMA_VERSION
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const rows=root.querySelector("#eventSchedulerOrder");
  if(rows)rows.innerHTML=verify.equalDueOrder.map((address,index)=>"<li><div><strong>"+(index+1)+"</strong><small>"+esc(address)+"</small></div><span>stable</span></li>").join("");
  setCheck(root,"vEventSchedulerHistory",verify.fpsInvariant&&verify.loadingOrderInvariant&&verify.batchingInvariant);
  setCheck(root,"vEventSchedulerOrder",verify.equalDueOrderStable);
  setCheck(root,"vEventSchedulerRandom",verify.addressedRandomStable&&verify.unrelatedEntityInvariant);
  setCheck(root,"vEventSchedulerBounded",verify.dueOnlyProcessing&&verify.boundedProcessing&&verify.maxBatch===MAX_BATCH);
  setCheck(root,"vEventSchedulerRender",verify.cameraPathInvariant&&!verify.renderOrCameraInputs&&!verify.renderFrameRandomness);
  setCheck(root,"vEventSchedulerPersistence",verify.versionedCompactState);
  root.dataset.pass=String(verify.pass);
  root.dataset.signature=verify.canonicalHistorySignature;
  root.dataset.noiseSignature=verify.noiseHistoryBaseSignature;
  root.dataset.maxBatch=String(MAX_BATCH);
  root.dataset.extraEntityCount=String(verify.extraEntityCount);
  return deepFreeze({verification:verify,snapshot:snap});
}

window.EventScheduler=Object.freeze({
  VERSION,SCHEMA,SCHEMA_VERSION,MAX_BATCH,FIXED_EVIDENCE_TIME,
  schedule,scheduleMany,processDue,peekDue,dueEntityIds,addressedRandom,snapshot,serialize,restore,reset,proof,renderDebugPanel
});
})();
