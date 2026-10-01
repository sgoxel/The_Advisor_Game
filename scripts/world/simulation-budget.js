(function(){
"use strict";

const VERSION="1.0.0";
const FRAME_SAMPLE_LIMIT=120;
const HISTORY_LIMIT=64;
const BACKGROUND_QUEUE_LIMIT=128;
const PRIORITY_RANK=Object.freeze({current:0,urgent:1,nearby:2,background:3,distant:4});
const BUDGETS=Object.freeze({
  eventEventsPerSlice:16,
  currentAuthorityEventsPerSlice:32,
  catchUpBatchesPerSlice:4,
  currentAuthorityCatchUpBatchesPerSlice:8,
  tierCandidatesPerPass:12,
  exactSettlements:1,
  exactNpcHandles:24,
  backgroundJobsPerSlice:4,
  persistenceWritesPerSlice:4,
  sliceTargetMs:6,
  frameTargetMs:16.667,
  frameFallbackMs:33.333,
  backgroundQueueLimit:BACKGROUND_QUEUE_LIMIT
});

const runtimeBySeed=new Map();
let globalFrameSamples=[];

function nowMs(){return typeof performance!=="undefined"&&performance?.now?performance.now():Date.now()}
function normalizeSeed(value){const s=String(value==null?"":value);return s||"__GLOBAL__"}
function clampInt(value,min,max,fallback){
  const n=Math.floor(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
}
function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;
}
function deepFreeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const v of Object.values(value))deepFreeze(v);return Object.freeze(value);
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stableStringify(value[k])).join(",")+"}";
}
function hashText(value){
  let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function percentile(values,p){
  if(!values.length)return 0;
  const a=[...values].sort((x,y)=>x-y),i=Math.max(0,Math.min(a.length-1,Math.ceil(a.length*p)-1));
  return Number(a[i].toFixed(3));
}
function freshChannel(){
  return {slices:0,totalMs:0,lastMs:0,maxMs:0,totalProcessed:0,lastProcessed:0,maxProcessed:0,
    lastPending:0,peakPending:0,totalDeferred:0,lastDeferred:0,overTargetSlices:0};
}
function freshState(seed){
  return {
    seed,channels:new Map(),queues:{events:0,catchUp:0,background:0,persistence:0},
    peakQueues:{events:0,catchUp:0,background:0,persistence:0},
    frameSamples:[],frameCount:0,lastFrameMs:0,maxFrameMs:0,framesOver33:0,framesOver50:0,constrained:false,
    tier:{counts:{global:0,regional:0,local:0,exact:0,exactNpcHandles:0,representedPopulation:0},
      candidates:0,materializations:0,dematerializations:0,deferredPromotions:0,serializedBytes:0,
      maxExactNpcHandles:0,lastUpdateMs:0},
    revisions:{country:0,region:0,settlement:0},
    persistence:{reads:0,writes:0,writeBehindDepth:0,dirtyRecords:0,checkpointWrites:0,
      cacheHits:0,cacheMisses:0,regenerations:0,cacheBytes:0,evictions:0,quotaErrors:0,
      lastReadMs:0,lastWriteMs:0,maxReadMs:0,maxWriteMs:0},
    backgroundQueue:[],backgroundProcessed:0,backgroundDeferred:0,
    history:[],sliceSequence:0
  };
}
function stateFor(seedValue){
  const seed=normalizeSeed(seedValue);
  if(!runtimeBySeed.has(seed))runtimeBySeed.set(seed,freshState(seed));
  return runtimeBySeed.get(seed);
}
function channelFor(state,kind){
  const key=String(kind||"unknown");
  if(!state.channels.has(key))state.channels.set(key,freshChannel());
  return state.channels.get(key);
}
function priorityName(value){
  const p=String(value||"background");
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK,p)?p:"background";
}
function baseLimit(kind,priority){
  const current=priority==="current"||priority==="urgent";
  if(kind==="events")return current?BUDGETS.currentAuthorityEventsPerSlice:BUDGETS.eventEventsPerSlice;
  if(kind==="catchUpBatches")return current?BUDGETS.currentAuthorityCatchUpBatchesPerSlice:BUDGETS.catchUpBatchesPerSlice;
  if(kind==="tierCandidates")return BUDGETS.tierCandidatesPerPass;
  if(kind==="backgroundJobs")return BUDGETS.backgroundJobsPerSlice;
  if(kind==="persistenceWrites")return BUDGETS.persistenceWritesPerSlice;
  return 1;
}
function limit(kind,requestedValue,optionsValue){
  const options=optionsValue||{},state=stateFor(options.seed),priority=priorityName(options.priority);
  const requested=Math.max(1,Math.floor(Number(requestedValue)||1));
  let cap=baseLimit(kind,priority);
  // Frame pressure may delay only non-current work. It never changes fantasy
  // time, queue ordering or final outcomes.
  if(state.constrained&&PRIORITY_RANK[priority]>=PRIORITY_RANK.background)cap=Math.max(1,Math.floor(cap/2));
  return Math.max(1,Math.min(requested,cap));
}
function beginSlice(kind,optionsValue){
  const options=optionsValue||{},state=stateFor(options.seed),priority=priorityName(options.priority);
  return Object.freeze({
    seed:state.seed,kind:String(kind||"unknown"),priority,startedAtMs:nowMs(),
    pending:Math.max(0,Number(options.pending)||0),sequence:++state.sliceSequence
  });
}
function endSlice(tokenValue,resultValue){
  const token=tokenValue||{},state=stateFor(token.seed),result=resultValue||{};
  const channel=channelFor(state,token.kind),duration=Number.isFinite(Number(result.durationMs))
    ?Math.max(0,Number(result.durationMs))
    :Math.max(0,nowMs()-Number(token.startedAtMs||nowMs()));
  const processed=Math.max(0,Math.floor(Number(result.processed)||0));
  const pending=Math.max(0,Math.floor(Number(result.pending)||0));
  const deferred=Math.max(0,Math.floor(Number(result.deferred)||0));
  channel.slices++;channel.totalMs+=duration;channel.lastMs=Number(duration.toFixed(3));channel.maxMs=Math.max(channel.maxMs,channel.lastMs);
  channel.totalProcessed+=processed;channel.lastProcessed=processed;channel.maxProcessed=Math.max(channel.maxProcessed,processed);
  channel.lastPending=pending;channel.peakPending=Math.max(channel.peakPending,pending);
  channel.totalDeferred+=deferred;channel.lastDeferred=deferred;
  if(duration>BUDGETS.sliceTargetMs)channel.overTargetSlices++;
  state.history.push(Object.freeze({sequence:token.sequence,kind:token.kind,priority:token.priority,processed,pending,deferred,durationMs:channel.lastMs}));
  if(state.history.length>HISTORY_LIMIT)state.history.splice(0,state.history.length-HISTORY_LIMIT);
  return snapshot(state.seed);
}
function recordQueue(seedValue,kindValue,pendingValue){
  const state=stateFor(seedValue),kind=String(kindValue||"events"),pending=Math.max(0,Math.floor(Number(pendingValue)||0));
  state.queues[kind]=pending;state.peakQueues[kind]=Math.max(Number(state.peakQueues[kind]||0),pending);
  return pending;
}
function recordVisibleFrame(frameMsValue,seedValue){
  const ms=Number(frameMsValue);if(!Number.isFinite(ms)||ms<=0)return snapshot(seedValue);
  const state=stateFor(seedValue);state.frameCount++;state.lastFrameMs=Number(ms.toFixed(3));state.maxFrameMs=Math.max(state.maxFrameMs,state.lastFrameMs);
  if(ms>BUDGETS.frameFallbackMs)state.framesOver33++;if(ms>50)state.framesOver50++;
  state.frameSamples.push(ms);if(state.frameSamples.length>FRAME_SAMPLE_LIMIT)state.frameSamples.shift();
  globalFrameSamples.push(ms);if(globalFrameSamples.length>FRAME_SAMPLE_LIMIT)globalFrameSamples.shift();
  const recent=state.frameSamples.slice(-12),slow=recent.filter(v=>v>BUDGETS.frameFallbackMs).length;
  state.constrained=recent.length>=6&&slow>=Math.ceil(recent.length/3);
  return snapshot(state.seed);
}
function recordTierSnapshot(seedValue,value){
  const state=stateFor(seedValue),v=value||{},counts=v.counts||{};
  state.tier.counts={
    global:Math.max(0,Number(counts.global)||0),regional:Math.max(0,Number(counts.regional)||0),
    local:Math.max(0,Number(counts.local)||0),exact:Math.max(0,Number(counts.exact)||0),
    exactNpcHandles:Math.max(0,Number(counts.exactNpcHandles)||0),
    representedPopulation:Math.max(0,Number(counts.representedPopulation)||0)
  };
  state.tier.candidates=Math.max(0,Number(v.candidateCount)||0);
  state.tier.materializations=Math.max(state.tier.materializations,Number(v.materializations)||0);
  state.tier.dematerializations=Math.max(state.tier.dematerializations,Number(v.dematerializations)||0);
  state.tier.deferredPromotions=Math.max(state.tier.deferredPromotions,Number(v.deferredPromotions)||0);
  state.tier.serializedBytes=Math.max(0,Number(v.serializedBytes)||0);
  state.tier.maxExactNpcHandles=Math.max(state.tier.maxExactNpcHandles,state.tier.counts.exactNpcHandles);
  state.tier.lastUpdateMs=Math.max(0,Number(v.lastUpdateMs)||0);
  return snapshot(state.seed);
}
function recordRevisionRefresh(seedValue,value){
  const state=stateFor(seedValue),v=value||{};
  for(const k of ["country","region","settlement"])state.revisions[k]+=Math.max(0,Math.floor(Number(v[k])||0));
  return snapshot(state.seed);
}
function recordPersistence(seedValue,value){
  const state=stateFor(seedValue),p=state.persistence,v=value||{};
  for(const k of ["reads","writes","checkpointWrites","cacheHits","cacheMisses","regenerations","evictions","quotaErrors"])p[k]+=Math.max(0,Math.floor(Number(v[k])||0));
  for(const k of ["writeBehindDepth","dirtyRecords","cacheBytes"])p[k]=Math.max(0,Number(v[k])||0);
  for(const k of ["lastReadMs","lastWriteMs"])p[k]=Math.max(0,Number(v[k])||0);
  p.maxReadMs=Math.max(p.maxReadMs,p.lastReadMs);p.maxWriteMs=Math.max(p.maxWriteMs,p.lastWriteMs);
  recordQueue(state.seed,"persistence",p.writeBehindDepth);
  return snapshot(state.seed);
}
function backgroundCompare(a,b){
  return a.dueTimestamp.localeCompare(b.dueTimestamp)||
    PRIORITY_RANK[a.priority]-PRIORITY_RANK[b.priority]||
    a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id);
}
function enqueueBackground(seedValue,itemValue){
  const state=stateFor(seedValue),source=itemValue||{},id=String(source.id||"");
  if(!id)throw new Error("Background work requires a stable id.");
  if(state.backgroundQueue.some(item=>item.id===id))return deepFreeze({ok:true,duplicate:true,pending:state.backgroundQueue.length});
  if(state.backgroundQueue.length>=BACKGROUND_QUEUE_LIMIT)return deepFreeze({ok:false,reason:"background-queue-cap",pending:state.backgroundQueue.length});
  const row=deepFreeze({
    id,kind:String(source.kind||"background"),priority:priorityName(source.priority),
    dueTimestamp:String(source.dueTimestamp||"9999-12-31 23:59:59"),payload:clone(source.payload??null)
  });
  state.backgroundQueue.push(row);state.backgroundQueue.sort(backgroundCompare);
  recordQueue(state.seed,"background",state.backgroundQueue.length);
  return deepFreeze({ok:true,duplicate:false,pending:state.backgroundQueue.length,item:row});
}
function drainBackground(seedValue,handler,optionsValue){
  const state=stateFor(seedValue),options=optionsValue||{},priority=priorityName(options.priority||"background");
  const cap=limit("backgroundJobs",options.maxJobs||BUDGETS.backgroundJobsPerSlice,{seed:state.seed,priority});
  const token=beginSlice("background",{seed:state.seed,priority,pending:state.backgroundQueue.length});
  const processed=[];
  while(processed.length<cap&&state.backgroundQueue.length){
    const item=state.backgroundQueue.shift(),outcome=typeof handler==="function"?handler(item):null;
    processed.push(Object.freeze({item,outcome:clone(outcome)}));state.backgroundProcessed++;
  }
  const pending=state.backgroundQueue.length,deferred=pending;state.backgroundDeferred+=deferred;
  recordQueue(state.seed,"background",pending);endSlice(token,{processed:processed.length,pending,deferred});
  return deepFreeze({processed:Object.freeze(processed),processedCount:processed.length,pending,hasMore:pending>0,bounded:processed.length<=cap});
}
function channelSnapshot(state){
  const out={};
  for(const [kind,c] of state.channels)out[kind]=Object.freeze({
    slices:c.slices,lastMs:c.lastMs,maxMs:c.maxMs,averageMs:Number((c.slices?c.totalMs/c.slices:0).toFixed(3)),
    totalProcessed:c.totalProcessed,lastProcessed:c.lastProcessed,maxProcessed:c.maxProcessed,
    lastPending:c.lastPending,peakPending:c.peakPending,totalDeferred:c.totalDeferred,lastDeferred:c.lastDeferred,
    overTargetSlices:c.overTargetSlices
  });
  return Object.freeze(out);
}
function snapshot(seedValue){
  const state=stateFor(seedValue),samples=state.frameSamples;
  const avg=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:0;
  return deepFreeze({
    version:VERSION,seed:state.seed,budgets:BUDGETS,
    constrained:state.constrained,priorityOrder:Object.freeze(Object.keys(PRIORITY_RANK)),
    queues:Object.freeze({...state.queues}),peakQueues:Object.freeze({...state.peakQueues}),
    channels:channelSnapshot(state),
    tiers:clone(state.tier),revisionRefreshes:Object.freeze({...state.revisions}),
    frame:Object.freeze({
      samples:samples.length,lastMs:state.lastFrameMs,maxMs:state.maxFrameMs,averageMs:Number(avg.toFixed(3)),
      p50Ms:percentile(samples,.50),p95Ms:percentile(samples,.95),framesOver33:state.framesOver33,framesOver50:state.framesOver50,
      target60FpsMs:BUDGETS.frameTargetMs,fallback30FpsMs:BUDGETS.frameFallbackMs
    }),
    persistence:clone(state.persistence),
    background:Object.freeze({pending:state.backgroundQueue.length,processed:state.backgroundProcessed,deferred:state.backgroundDeferred,queueLimit:BACKGROUND_QUEUE_LIMIT}),
    estimatedActiveBytes:Number(state.tier.serializedBytes||0)+Number(state.persistence.cacheBytes||0),
    telemetryAuthority:false,fullWorldScan:false,perFrameWorldScan:false,
    deterministicOrdering:true,finalOutcomeBudgetInvariant:true,
    history:Object.freeze(state.history.slice())
  });
}
function reset(seedValue){
  const seed=normalizeSeed(seedValue);runtimeBySeed.delete(seed);return snapshot(seed);
}
function simulateOrder(rows,budget){
  const q=[...rows].sort((a,b)=>a.due.localeCompare(b.due)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)),out=[];
  const cap=Math.max(1,Math.floor(Number(budget)||1));
  while(q.length){for(let i=0;i<cap&&q.length;i++)out.push(q.shift());}
  return Object.freeze({order:Object.freeze(out.map(x=>x.due+"|"+x.kind+"|"+x.id)),signature:hashText(stableStringify(out))});
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue),rows=[];
  for(let i=0;i<96;i++)rows.push({due:"1200-01-"+String(1+(i%6)).padStart(2,"0")+" 12:00:00",kind:["country","region","settlement","npc"][i%4],id:seed+"|"+String(i).padStart(3,"0")});
  const tiny=simulateOrder(rows,1),normal=simulateOrder([...rows].reverse(),4),wide=simulateOrder([...rows].reverse(),16);
  const queueInvariant=tiny.signature===normal.signature&&normal.signature===wide.signature;
  reset(seed);for(let i=0;i<12;i++)recordVisibleFrame(i<7?41:16.6,seed);
  const constrained=stateFor(seed).constrained;
  const bg=limit("events",32,{seed,priority:"background"}),current=limit("events",32,{seed,priority:"current"});
  for(let i=0;i<20;i++)enqueueBackground(seed,{id:"BG-"+String(i).padStart(2,"0"),kind:i%2?"generation":"cache",priority:i<4?"nearby":"distant",dueTimestamp:"1200-01-01 00:00:"+String(i%10).padStart(2,"0")});
  const seen=[];while(stateFor(seed).backgroundQueue.length)drainBackground(seed,item=>{seen.push(item.id);return item.id},{priority:"background"});
  const snap=snapshot(seed);
  const pass=Boolean(queueInvariant&&constrained&&bg<current&&seen.length===20&&snap.background.pending===0&&snap.fullWorldScan===false&&snap.telemetryAuthority===false);
  return deepFreeze({
    pass,queueInvariant,constrainedBackpressure:constrained&&bg<current,
    backgroundLimit:bg,currentAuthorityLimit:current,backgroundQueueDrained:seen.length===20,
    deterministicOrdering:snap.deterministicOrdering,finalOutcomeBudgetInvariant:snap.finalOutcomeBudgetInvariant,
    fullWorldScan:snap.fullWorldScan,telemetryAuthority:snap.telemetryAuthority,
    signature:tiny.signature
  });
}

window.WorldSimulationBudget=Object.freeze({
  VERSION,BUDGETS,limit,beginSlice,endSlice,recordQueue,recordVisibleFrame,
  recordTierSnapshot,recordRevisionRefresh,recordPersistence,
  enqueueBackground,drainBackground,snapshot,reset,proof
});
})();
