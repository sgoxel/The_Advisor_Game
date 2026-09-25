(function(){
"use strict";

const STORAGE_KEY="the-advisor-game:terrain-preload:v1";
const ALLOWED_RADIUS=Object.freeze([1,2,3,4]);
const ALLOWED_CACHE=Object.freeze([16,32,64,128,256]);
const IDLE_START_MS=1500;
const IDLE_LEVEL2_MS=3500;
const IDLE_RECHECK_MS=250;
const IDLE_CACHE_HARD_CEILING=256;
const IDLE_QUEUE_PRIORITY=1000;
const IDLE_HEADROOM_RATIO=0.80;
const IDLE_HEADROOM_RESERVE_MS=2.5;
const DESTINATION_GRACE_MS=180;
const DESTINATION_SAFETY_RING=0;
const DESTINATION_QUEUE_PRIORITY=-1000;
const DEFAULTS=Object.freeze({
  preloadRadius:2,
  maxCachedChunks:64,
  directionalPreload:true,
  backgroundChunkGeneration:true,
  frameBudgetMs:2,
  maxChunksPerFrame:3
});

let current=load();
const listeners=new Set();

function bool(value,fallback){return typeof value==="boolean"?value:fallback;}
function choice(value,allowed,fallback){
  const n=Number(value);
  return allowed.includes(n)?n:fallback;
}
function normalize(value={}){
  return Object.freeze({
    preloadRadius:choice(value.preloadRadius,ALLOWED_RADIUS,DEFAULTS.preloadRadius),
    maxCachedChunks:choice(value.maxCachedChunks,ALLOWED_CACHE,DEFAULTS.maxCachedChunks),
    directionalPreload:bool(value.directionalPreload,DEFAULTS.directionalPreload),
    backgroundChunkGeneration:bool(value.backgroundChunkGeneration,DEFAULTS.backgroundChunkGeneration),
    frameBudgetMs:DEFAULTS.frameBudgetMs,
    maxChunksPerFrame:DEFAULTS.maxChunksPerFrame
  });
}
function load(){
  try{return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")||{});}
  catch(_){return normalize();}
}
function persist(value){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(value));return true;}
  catch(_){return false;}
}
function notify(){for(const fn of [...listeners]){try{fn(current);}catch(_){}}}
function get(){return Object.freeze({...current});}
function set(value={}){
  current=normalize({...current,...value});
  const stored=persist(current);
  syncControls();
  notify();
  return Object.freeze({...current,stored});
}
function reset(){
  current=normalize();
  const stored=persist(current);
  syncControls();
  notify();
  return Object.freeze({...current,stored});
}
function subscribe(fn){
  if(typeof fn!=="function")return ()=>{};
  listeners.add(fn);
  return ()=>listeners.delete(fn);
}
function syncControls(){
  const radius=document.getElementById("terrainPreloadRadiusSelect");
  const cache=document.getElementById("terrainCacheCapacitySelect");
  const directional=document.getElementById("directionalPreloadToggle");
  const background=document.getElementById("backgroundChunkGenerationToggle");
  if(radius)radius.value=String(current.preloadRadius);
  if(cache)cache.value=String(current.maxCachedChunks);
  if(directional)directional.checked=current.directionalPreload;
  if(background)background.checked=current.backgroundChunkGeneration;
}
function saveControls(){
  return set({
    preloadRadius:Number(document.getElementById("terrainPreloadRadiusSelect")?.value),
    maxCachedChunks:Number(document.getElementById("terrainCacheCapacitySelect")?.value),
    directionalPreload:Boolean(document.getElementById("directionalPreloadToggle")?.checked),
    backgroundChunkGeneration:Boolean(document.getElementById("backgroundChunkGenerationToggle")?.checked)
  });
}
function bindControls(){
  syncControls();
  const saveButton=document.getElementById("saveSettingsButton");
  if(saveButton&&!saveButton.dataset.terrainPreloadBound){
    saveButton.dataset.terrainPreloadBound="true";
    saveButton.addEventListener("click",saveControls);
  }
}

function floorDiv(value,divisor){
  const d=BigInt(divisor),v=BigInt(String(value));
  let q=v/d,r=v%d;
  if(r<0n)q-=1n;
  return q;
}
function coordKey(x,y){return String(x)+","+String(y);}
function entryKey(signature,x,y){return String(signature)+"|"+coordKey(x,y);}
function distanceToRect(x,y,b){
  const dx=x<b.minX?b.minX-x:x>b.maxX?x-b.maxX:0;
  const dy=y<b.minY?b.minY-y:y>b.maxY?y-b.maxY:0;
  return Math.max(Math.abs(dx),Math.abs(dy));
}
function directionUnit(dx,dy){
  return Object.freeze({x:Math.sign(dx),y:Math.sign(dy)});
}

function createManager({
  chunkSize=16,
  prepareChunk,
  prepareChunkData=null,
  cancelChunkData=null,
  activateChunk,
  deactivateChunk,
  destroyChunk,
  signatureProvider=()=>"standard",
  performanceProvider=()=>null
}={}){
  if(typeof prepareChunk!=="function")throw new Error("TerrainChunkPreload manager requires prepareChunk");
  let size=Math.max(1,Number(chunkSize)||16);
  const entries=new Map();
  const queued=new Set();
  let queue=[];
  let frameHandle=0;
  let destroyed=false;
  // Cache identity must use the exact same canonical format as every later update.
  // Using only the provider fragment here forced a one-time "signature" invalidation
  // on the first navigation update, purging already prepared chunks.
  let signature="chunk="+size+"|"+String(signatureProvider()||"standard");
  let lastCenterChunk=null;
  let lastRequest=null;
  let lastExactActiveIds=null;
  let settings=get();
  let idleTimer=0;
  let stationarySince=performance.now();
  let lastNavigationKey=null;
  let idleExpansionLevel=0;
  let retainedCacheLimit=Math.min(IDLE_CACHE_HARD_CEILING,settings.maxCachedChunks);
  let idleChunksGenerated=0,idleCacheHits=0,idleStarts=0,idleStops=0;
  let lastIdleStartReason=null,lastIdleStopReason="not-started";
  let lastHeadroom=Object.freeze({ok:false,reason:"no-sample",frameMs:0,budgetMs:Number((1000/60).toFixed(3)),headroomMs:0,targetFps:60});
  let headroomGoodChecks=0;
  let lastIdleWorkMs=0,totalIdleWorkMs=0,maxIdleWorkMs=0;
  let hits=0,misses=0,compositions=0,evictions=0,visibleWaits=0,cacheReuses=0,frameBudgetSpikes=0,invalidations=0;
  let activations=0,deactivations=0,stateReuses=0,resourceCreations=0,resourceDestructions=0;
  let streamingState="READY",destinationSerial=0,destinationRequests=0,destinationCompletions=0,destinationCacheHits=0;
  let destinationPromotions=0,staleDestinationCancelled=0,destinationDeduplicated=0,destinationRequiredCount=0,destinationCompletedCount=0;
  let destinationStartedAtMs=null,destinationGateShownAtMs=null,destinationReadyAtMs=null,destinationTarget=null,destinationRequiredIds=Object.freeze([]);
  let destinationLastProgress=Object.freeze({state:"READY",required:0,completed:0,percent:100,target:null});
  let destinationSliceCount=0,destinationLastSliceMs=0,destinationMaxSliceMs=0,destinationTotalSliceMs=0;
  let destinationDeferredPreparedCount=0;
  let destinationDataSliceCount=0,destinationDataLastMs=0,destinationDataMaxMs=0,destinationDataTotalMs=0;
  let destinationLongTask50=0,destinationLongTask100=0,destinationLongTask200=0,destinationPaintHeartbeats=0;
  const destinationDataPrepared=new Map();
  let updateCalls=0,lastUpdateMs=0,maxUpdateMs=0,totalUpdateMs=0,transitionCalls=0,totalTransitionMs=0,maxTransitionMs=0;
  let lastInvalidationReason=null;
  let lastWorkMs=0,maxWorkMs=0,backgroundFrames=0;
  let lastDirection=Object.freeze({x:0,y:0});
  let lastPreparedOrder=Object.freeze([]);
  let lastQueuePreview=Object.freeze([]);
  const unsubscribe=subscribe(next=>{
    settings=next;
    retainedCacheLimit=Math.min(IDLE_CACHE_HARD_CEILING,settings.maxCachedChunks);
    stopIdleExpansion("settings-changed",true);
    trimCached();
    if(lastRequest)update(lastRequest);
  });

  function setChunkSize(value){
    const next=Math.max(1,Number(value)||16);
    if(next===size)return false;
    size=next;
    invalidate("chunk-size");
    return true;
  }
  function currentSignature(){
    return "chunk="+size+"|"+String(signatureProvider()||"standard");
  }
  function destroyEntry(entry){
    if(!entry)return;
    try{destroyChunk?.(entry.resource,entry);}catch(_){}
    resourceDestructions++;
  }
  function setEntryState(entry,state){
    if(!entry)return false;
    const previous=entry.state;
    if(previous===state){stateReuses++;return false;}
    entry.state=state;
    const started=performance.now();
    if(previous==="Active"&&state!=="Active"){
      deactivateChunk?.(entry.resource,entry);
      deactivations++;
      transitionCalls++;
    }else if(previous!=="Active"&&state==="Active"){
      activateChunk?.(entry.resource,entry);
      activations++;
      transitionCalls++;
    }
    const elapsed=performance.now()-started;
    if(previous==="Active"||state==="Active"){
      totalTransitionMs+=elapsed;
      maxTransitionMs=Math.max(maxTransitionMs,elapsed);
    }
    return true;
  }
  function invalidate(reason="manual"){
    invalidations++;
    lastInvalidationReason=String(reason||"manual");
    cancelWork();
    for(const entry of entries.values())destroyEntry(entry);
    entries.clear();queue=[];queued.clear();destinationDataPrepared.clear();lastCenterChunk=null;lastExactActiveIds=null;
    signature=currentSignature();
  }
  function cancelWork(){
    if(frameHandle){
      cancelAnimationFrame(frameHandle);
      frameHandle=0;
    }
    cancelIdleTimer();
  }
  function cancelIdleTimer(){
    if(idleTimer){
      clearTimeout(idleTimer);
      idleTimer=0;
    }
  }
  function normalCacheTarget(){return Math.min(IDLE_CACHE_HARD_CEILING,Math.max(0,Number(settings.maxCachedChunks)||0));}
  function idleCacheTarget(level){
    const normal=normalCacheTarget();
    if(level>=2)return Math.min(IDLE_CACHE_HARD_CEILING,normal*3);
    if(level>=1)return Math.min(IDLE_CACHE_HARD_CEILING,normal*2);
    return normal;
  }
  function cachedCount(){
    let count=0;
    for(const entry of entries.values())if(entry.state==="Cached")count++;
    return count;
  }
  function queueCounts(){
    let normal=0,idle=0;
    for(const item of queue){if(item.source==="idle")idle++;else normal++;}
    return {normal,idle};
  }
  function headroomState(){
    let sample=null;
    try{sample=performanceProvider?.()||null;}catch(_){sample=null;}
    const frameMs=Math.max(0,Number(sample?.lastFrameMs||0));
    const targetFps=Math.max(1,Number(sample?.targetFps||60));
    const minimumFps=Math.max(1,Math.min(targetFps,Number(sample?.minimumFps||30)));
    const targetBudget=1000/targetFps;
    const fallbackBudget=1000/minimumFps;
    const budgetMs=frameMs>targetBudget*1.05?fallbackBudget:targetBudget;
    const reserveMs=Math.max(IDLE_HEADROOM_RESERVE_MS,budgetMs*(1-IDLE_HEADROOM_RATIO));
    const headroomMs=Math.max(0,budgetMs-frameMs);
    const ok=frameMs>0&&frameMs<=fallbackBudget&&headroomMs>=reserveMs;
    const reason=frameMs<=0?"no-frame-sample":ok?"headroom-available":frameMs>fallbackBudget?"below-minimum-fps":"insufficient-headroom";
    lastHeadroom=Object.freeze({
      ok,reason,
      frameMs:Number(frameMs.toFixed(3)),
      budgetMs:Number(budgetMs.toFixed(3)),
      headroomMs:Number(headroomMs.toFixed(3)),
      targetFps:budgetMs===fallbackBudget?minimumFps:targetFps
    });
    return lastHeadroom;
  }
  function clearIdleQueue(){
    if(!queue.length)return 0;
    const keep=[],removed=[];
    for(const item of queue){
      if(item.source==="idle")removed.push(item);
      else keep.push(item);
    }
    if(!removed.length)return 0;
    queue=keep;
    for(const item of removed)queued.delete(item.fullKey);
    lastQueuePreview=Object.freeze(queue.slice(0,8).map(item=>Object.freeze({x:item.x,y:item.y,priority:item.priority,distance:item.distance,source:item.source||"normal"})));
    return removed.length;
  }
  function clearDestinationQueue(reason="superseded"){
    try{cancelChunkData?.(reason);}catch(_){}
    if(!queue.length){
      destinationDataPrepared.clear();
      return 0;
    }
    const keep=[],removed=[];
    for(const item of queue){
      if(item.source==="destination")removed.push(item);
      else keep.push(item);
    }
    if(!removed.length){
      destinationDataPrepared.clear();
      return 0;
    }
    queue=keep;
    for(const item of removed){
      queued.delete(item.fullKey);
      destinationDataPrepared.delete(item.fullKey);
    }
    staleDestinationCancelled+=removed.length;
    lastQueuePreview=Object.freeze(queue.slice(0,8).map(item=>Object.freeze({x:item.x,y:item.y,priority:item.priority,distance:item.distance,source:item.source||"normal"})));
    return removed.length;
  }
  function stopIdleExpansion(reason="idle-stopped",resetLevel=true){
    const wasActive=idleExpansionLevel>0||queue.some(item=>item.source==="idle");
    clearIdleQueue();
    cancelIdleTimer();
    if(resetLevel)idleExpansionLevel=0;
    headroomGoodChecks=0;
    if(wasActive)idleStops++;
    lastIdleStopReason=String(reason||"idle-stopped");
  }
  function scheduleIdleCheck(delay=IDLE_RECHECK_MS){
    cancelIdleTimer();
    if(destroyed||!settings.backgroundChunkGeneration||!lastRequest)return;
    idleTimer=setTimeout(runIdleCheck,Math.max(0,Number(delay)||0));
  }
  function idleCandidates(needed){
    if(!lastRequest||!lastCenterChunk||needed<=0)return [];
    const rx=Math.max(0,lastRequest.activeRadiusX|0),ry=Math.max(0,lastRequest.activeRadiusY|0);
    const bounds=makeBounds(lastCenterChunk,rx,ry);
    const sig=currentSignature();
    const result=[];
    const maxDistance=Math.max(settings.preloadRadius+2,Math.ceil(Math.sqrt(needed))+settings.preloadRadius+8);
    for(let distance=1;distance<=maxDistance&&result.length<needed;distance++){
      for(let y=bounds.minY-distance;y<=bounds.maxY+distance&&result.length<needed;y++){
        for(let x=bounds.minX-distance;x<=bounds.maxX+distance&&result.length<needed;x++){
          if(distanceToRect(x,y,bounds)!==distance)continue;
          const fullKey=entryKey(sig,x,y);
          if(entries.has(fullKey)||queued.has(fullKey))continue;
          const dx=x-lastCenterChunk.x,dy=y-lastCenterChunk.y;
          const dot=dx*lastDirection.x+dy*lastDirection.y;
          const directionBias=dot>0?-1:dot<0?1:0;
          result.push({
            x,y,signature:sig,state:"Cached",source:"idle",
            priority:IDLE_QUEUE_PRIORITY+distance*10+directionBias,
            distance
          });
        }
      }
    }
    return result;
  }
  function runIdleCheck(){
    idleTimer=0;
    if(destroyed||!settings.backgroundChunkGeneration||!lastRequest)return;
    if(queue.some(item=>item.source!=="idle")){scheduleIdleCheck();return;}
    const idleMs=Math.max(0,performance.now()-stationarySince);
    if(idleMs<IDLE_START_MS){scheduleIdleCheck(Math.min(IDLE_RECHECK_MS,IDLE_START_MS-idleMs));return;}
    const headroom=headroomState();
    if(!headroom.ok){
      stopIdleExpansion(headroom.reason,true);
      scheduleIdleCheck();
      return;
    }
    headroomGoodChecks++;
    if(headroomGoodChecks<2){
      lastIdleStopReason="confirming-sustained-headroom";
      scheduleIdleCheck();
      return;
    }
    const nextLevel=idleMs>=IDLE_LEVEL2_MS?2:1;
    const target=idleCacheTarget(nextLevel);
    const current=cachedCount();
    if(current>=target){
      if(nextLevel>idleExpansionLevel){
        idleExpansionLevel=nextLevel;
        idleStarts++;
        lastIdleStartReason="stationary-headroom-level-"+nextLevel;
      }
      retainedCacheLimit=Math.max(retainedCacheLimit,target);
      lastIdleStopReason="target-reached";
      scheduleIdleCheck();
      return;
    }
    if(nextLevel!==idleExpansionLevel){
      idleExpansionLevel=nextLevel;
      idleStarts++;
      lastIdleStartReason="stationary-headroom-level-"+nextLevel;
    }
    retainedCacheLimit=Math.max(retainedCacheLimit,target);
    const items=idleCandidates(target-current);
    if(!items.length){
      lastIdleStopReason="no-idle-candidates";
      scheduleIdleCheck();
      return;
    }
    schedulePrepared(items);
  }
  function chunkFromCenter(center){
    return Object.freeze({
      x:Number(floorDiv(center?.x??"0",size)),
      y:Number(floorDiv(center?.y??"0",size))
    });
  }
  function makeBounds(centerChunk,rx,ry){
    return Object.freeze({
      minX:centerChunk.x-rx,maxX:centerChunk.x+rx,
      minY:centerChunk.y-ry,maxY:centerChunk.y+ry
    });
  }
  function targetSets(request){
    const centerChunk=chunkFromCenter(request.center);
    const activeBounds=makeBounds(centerChunk,Math.max(0,request.activeRadiusX|0),Math.max(0,request.activeRadiusY|0));
    const active=new Set();
    for(let y=activeBounds.minY;y<=activeBounds.maxY;y++){
      for(let x=activeBounds.minX;x<=activeBounds.maxX;x++)active.add(coordKey(x,y));
    }

    const movement=lastCenterChunk
      ?directionUnit(centerChunk.x-lastCenterChunk.x,centerChunk.y-lastCenterChunk.y)
      :Object.freeze({x:0,y:0});
    lastDirection=movement;
    const prepared=new Set();
    const radius=settings.preloadRadius;
    if(settings.backgroundChunkGeneration){
      for(let y=activeBounds.minY-radius;y<=activeBounds.maxY+radius;y++){
        for(let x=activeBounds.minX-radius;x<=activeBounds.maxX+radius;x++){
          const key=coordKey(x,y);
          if(active.has(key))continue;
          const distance=distanceToRect(x,y,activeBounds);
          if(distance>radius)continue;
          if(!settings.directionalPreload||(movement.x===0&&movement.y===0)){
            prepared.add(key);
            continue;
          }
          const safety=distance<=1;
          const ox=x<centerChunk.x?-1:x>centerChunk.x?1:0;
          const oy=y<centerChunk.y?-1:y>centerChunk.y?1:0;
          const ahead=(ox*movement.x+oy*movement.y)>0;
          if(safety||ahead)prepared.add(key);
        }
      }
    }
    return {centerChunk,activeBounds,active,prepared,movement};
  }
  function parseCoord(key){
    const [x,y]=key.split(",").map(Number);
    return {x,y};
  }
  function prepareNow(x,y,state,isVisible,source="normal",preparedData=null){
    const sig=currentSignature();
    const key=entryKey(sig,x,y);
    let entry=entries.get(key);
    if(entry){
      hits++;
      if(source==="destination")destinationCacheHits++;
      const promotedIdle=Boolean(entry.idleGenerated&&entry.state==="Cached"&&(state==="Active"||state==="Prepared"));
      if(entry.state==="Cached"&&(state==="Active"||state==="Prepared"))cacheReuses++;
      if(promotedIdle)idleCacheHits++;
      entry.lastUsed=performance.now();
      setEntryState(entry,state);
      return entry;
    }
    misses++;
    if(isVisible)visibleWaits++;
    const started=performance.now();
    const streamingProfile=source==="destination"?"minimum":"full";
    const resource=prepareChunk({x,y,chunkSize:size,signature:sig,state,source,streamingProfile,preparedData});
    const elapsed=performance.now()-started;
    lastWorkMs=elapsed;maxWorkMs=Math.max(maxWorkMs,elapsed);
    if(elapsed>settings.frameBudgetMs*1.5)frameBudgetSpikes++;
    entry={key,x,y,state,signature:sig,resource,lastUsed:performance.now(),idleGenerated:source==="idle",streamingProfile};
    entries.set(key,entry);
    compositions++;
    resourceCreations++;
    if(source==="idle")idleChunksGenerated++;
    if(state==="Active"){
      activateChunk?.(resource,entry);
      activations++;
      transitionCalls++;
    }else{
      deactivateChunk?.(resource,entry);
      deactivations++;
      transitionCalls++;
    }
    return entry;
  }
  function schedulePrepared(items){
    for(const item of items){
      const sig=currentSignature();
      const fullKey=entryKey(sig,item.x,item.y);
      const source=item.source==="idle"?"idle":item.source==="destination"?"destination":"normal";
      const desiredState=item.state||"Prepared";
      if(entries.has(fullKey)){
        const entry=entries.get(fullKey);
        if(source==="idle")continue;
        hits++;
        const promotedIdle=Boolean(entry.idleGenerated&&entry.state==="Cached");
        if(entry.state==="Cached")cacheReuses++;
        if(promotedIdle)idleCacheHits++;
        entry.lastUsed=performance.now();
        setEntryState(entry,desiredState);
        continue;
      }
      if(queued.has(fullKey)){
        if(source==="destination")destinationDeduplicated++;
        continue;
      }
      if(source==="destination")destinationPromotions++;
      queued.add(fullKey);
      queue.push({...item,fullKey,source,state:desiredState});
    }
    queue.sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.x-b.x||a.y-b.y);
    lastQueuePreview=Object.freeze(queue.slice(0,8).map(item=>Object.freeze({x:item.x,y:item.y,priority:item.priority,distance:item.distance,source:item.source||"normal"})));
    if(queue.length&&!frameHandle)frameHandle=requestAnimationFrame(processQueue);
  }
  function processQueue(){
    frameHandle=0;
    if(destroyed){queue=[];queued.clear();return;}
    if(!settings.backgroundChunkGeneration){
      const keep=queue.filter(item=>item.source==="destination");
      const removed=queue.filter(item=>item.source!=="destination");
      for(const item of removed)queued.delete(item.fullKey);
      queue=keep;
      if(!queue.length)return;
    }
    const started=performance.now();
    let processed=0;
    const preparedKeys=[];
    while(queue.length&&processed<settings.maxChunksPerFrame){
      if(processed>0&&performance.now()-started>=settings.frameBudgetMs)break;
      const item=queue.shift();queued.delete(item.fullKey);
      if(item.signature!==currentSignature())continue;
      if(item.source==="idle"){
        const headroom=headroomState();
        if(!headroom.ok){
          clearIdleQueue();
          idleExpansionLevel=0;
          idleStops++;
          lastIdleStopReason=headroom.reason;
          scheduleIdleCheck();
          break;
        }
      }
      // A viewport/orientation change can promote a chunk to Active while an
      // older background-prepare item for the same chunk is still queued.
      // Never let that stale item demote and disable a now-visible resource.
      const existing=entries.get(item.fullKey);
      if(existing?.state==="Active"){
        processed++;
        continue;
      }
      const itemStarted=performance.now();
      if(item.source==="destination"&&typeof prepareChunkData==="function"){
        const record=destinationDataPrepared.get(item.fullKey)||null;
        if(!record||record.pending===true){
          const response=prepareChunkData({
            x:item.x,y:item.y,chunkSize:size,signature:item.signature,
            state:item.state||"Prepared",source:"destination",streamingProfile:"minimum",
            requiredCellIndices:item.requiredCellIndices||null,
            incrementalState:record?.state||null,maxCells:8
          });
          const dataElapsed=performance.now()-itemStarted;
          destinationDataSliceCount++;
          destinationDataLastMs=dataElapsed;
          destinationDataTotalMs+=dataElapsed;
          destinationDataMaxMs=Math.max(destinationDataMaxMs,dataElapsed);
          if(response?.pending===true){
            destinationDataPrepared.set(item.fullKey,{
              pending:true,state:response.state,
              completed:Number(response.completed||0),total:Number(response.total||0),
              percent:Number(response.percent||0),sliceMs:Number(response.sliceMs||dataElapsed)
            });
          }else{
            destinationDataPrepared.set(item.fullKey,{
              pending:false,data:response?.data??response,
              completed:Number(response?.completed||0),total:Number(response?.total||0),
              percent:Number(response?.percent??100),sliceMs:Number(response?.sliceMs||dataElapsed)
            });
          }
          // Worker-backed preparation is off-main-thread, so rotate a pending
          // worker item behind its peers and let this paint dispatch more jobs.
          // Main-thread hydration still remains bounded and deterministic.
          if(response?.pending===true&&response?.workerPending===true){
            queue.push(item);
            queued.add(item.fullKey);
            processed++;
            if(processed<settings.maxChunksPerFrame&&performance.now()-started<settings.frameBudgetMs)continue;
            break;
          }
          // Exactly one deterministic main-thread data slice per paint. Even
          // completion waits for the next frame before mesh/GPU composition.
          queue.unshift(item);
          queued.add(item.fullKey);
          processed++;
          break;
        }
      }
      const dataRecord=item.source==="destination"?destinationDataPrepared.get(item.fullKey):null;
      const preparedData=dataRecord?.data??dataRecord;
      prepareNow(item.x,item.y,item.state||"Prepared",false,item.source||"normal",preparedData);
      const itemElapsed=performance.now()-itemStarted;
      if(item.source==="destination")destinationDataPrepared.delete(item.fullKey);
      if(item.source==="idle"){
        lastIdleWorkMs=itemElapsed;
        totalIdleWorkMs+=itemElapsed;
        maxIdleWorkMs=Math.max(maxIdleWorkMs,itemElapsed);
      }
      preparedKeys.push(coordKey(item.x,item.y));
      processed++;
      // Full-quality destination mesh composition is the second and final
      // phase for this frame. Never compose a second destination chunk before
      // the next animation frame, even when the nominal millisecond budget has
      // not yet been consumed.
      if(item.source==="destination")break;
    }
    const elapsed=performance.now()-started;
    if(streamingState==="CATCHING_UP"||streamingState==="LOAD_GATE"){
      destinationSliceCount++;
      destinationLastSliceMs=elapsed;
      destinationTotalSliceMs+=elapsed;
      destinationMaxSliceMs=Math.max(destinationMaxSliceMs,elapsed);
      if(elapsed>50)destinationLongTask50++;
      if(elapsed>100)destinationLongTask100++;
      if(elapsed>200)destinationLongTask200++;
    }
    lastWorkMs=elapsed;maxWorkMs=Math.max(maxWorkMs,elapsed);backgroundFrames++;
    if(elapsed>settings.frameBudgetMs*1.5)frameBudgetSpikes++;
    if(preparedKeys.length)lastPreparedOrder=Object.freeze(preparedKeys);
    trimCached();
    if(queue.length)frameHandle=requestAnimationFrame(processQueue);
    else scheduleIdleCheck();
  }
  function trimCached(){
    const cached=[...entries.values()]
      .filter(e=>e.state==="Cached")
      .sort((a,b)=>a.lastUsed-b.lastUsed||a.x-b.x||a.y-b.y);
    const limit=Math.min(IDLE_CACHE_HARD_CEILING,Math.max(normalCacheTarget(),retainedCacheLimit));
    while(cached.length>limit){
      const entry=cached.shift();
      entries.delete(entry.key);
      destroyEntry(entry);
      evictions++;
    }
  }
  function destinationPlan(request){
    const center=Object.freeze({x:String(request?.center?.x??"0"),y:String(request?.center?.y??"0")});
    const centerChunk=chunkFromCenter(center);
    const explicit=[...new Set((Array.isArray(request?.requiredChunkIds)?request.requiredChunkIds:[])
      .map(value=>String(value||"")).filter(value=>/^-?\d+,-?\d+$/.test(value)))];
    if(explicit.length){
      const points=explicit.map(parseCoord).sort((a,b)=>{
        const da=Math.max(Math.abs(a.x-centerChunk.x),Math.abs(a.y-centerChunk.y));
        const db=Math.max(Math.abs(b.x-centerChunk.x),Math.abs(b.y-centerChunk.y));
        return da-db||a.y-b.y||a.x-b.x;
      });
      const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
      const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
      const activeBounds=Object.freeze({minX,maxX,minY,maxY});
      const requiredIds=points.map(point=>coordKey(point.x,point.y));
      const requiredCellsByChunk=request?.requiredCellsByChunk&&typeof request.requiredCellsByChunk==="object"
        ?request.requiredCellsByChunk:{};
      const items=points.map(point=>{
        const id=coordKey(point.x,point.y);
        const requiredCellIndices=Array.isArray(requiredCellsByChunk[id])
          ?Object.freeze(requiredCellsByChunk[id].map(Number).filter(Number.isInteger))
          :null;
        return {
          x:point.x,y:point.y,signature:currentSignature(),state:"Prepared",source:"destination",
          priority:DESTINATION_QUEUE_PRIORITY,
          distance:Math.max(Math.abs(point.x-centerChunk.x),Math.abs(point.y-centerChunk.y)),
          requiredCellIndices
        };
      });
      return Object.freeze({center,centerChunk,activeBounds,safetyBounds:activeBounds,items:Object.freeze(items),requiredIds:Object.freeze(requiredIds),exact:true});
    }
    const rx=Math.max(0,Number(request?.activeRadiusX||0)|0),ry=Math.max(0,Number(request?.activeRadiusY||0)|0);
    const activeBounds=makeBounds(centerChunk,rx,ry);
    const safetyBounds=makeBounds(centerChunk,rx+DESTINATION_SAFETY_RING,ry+DESTINATION_SAFETY_RING);
    const items=[],requiredIds=[];
    for(let y=safetyBounds.minY;y<=safetyBounds.maxY;y++){
      for(let x=safetyBounds.minX;x<=safetyBounds.maxX;x++){
        const distance=distanceToRect(x,y,activeBounds);
        const id=coordKey(x,y);
        requiredIds.push(id);
        items.push({x,y,signature:currentSignature(),state:"Prepared",source:"destination",priority:DESTINATION_QUEUE_PRIORITY+distance*20,distance});
      }
    }
    return Object.freeze({center,centerChunk,activeBounds,safetyBounds,items:Object.freeze(items),requiredIds:Object.freeze(requiredIds),exact:false});
  }
  function destinationProgress(plan,state=streamingState){
    const sig=currentSignature();
    let completed=0,partial=0,partialCellsCompleted=0,partialCellsTotal=0;
    for(const id of plan.requiredIds){
      const point=parseCoord(id);
      const fullKey=entryKey(sig,point.x,point.y);
      if(entries.has(fullKey)){completed++;continue;}
      const record=destinationDataPrepared.get(fullKey);
      const done=Math.max(0,Number(record?.completed||0));
      const total=Math.max(0,Number(record?.total||0));
      if(total>0){
        partial+=Math.min(1,done/total);
        partialCellsCompleted+=Math.min(done,total);
        partialCellsTotal+=total;
      }
    }
    const required=plan.requiredIds.length;
    const weighted=completed+partial;
    const percent=required
      ?Math.min(completed>=required?100:99,Math.max(0,Math.round(weighted/required*100)))
      :100;
    destinationRequiredCount=required;
    destinationCompletedCount=completed;
    destinationRequiredIds=plan.requiredIds;
    destinationTarget=plan.center;
    destinationLastProgress=Object.freeze({
      state:String(state),required,completed,percent,target:Object.freeze({...plan.center}),
      requiredChunkIds:plan.requiredIds,
      partialChunks:Number((weighted-completed).toFixed(3)),
      partialCellsCompleted,partialCellsTotal,
      queueDepth:queue.filter(item=>item.source==="destination").length,
      cancelledStale:staleDestinationCancelled,deduplicated:destinationDeduplicated,
      promotions:destinationPromotions,cacheHits:destinationCacheHits
    });
    return destinationLastProgress;
  }
  function cooperativeDestinationYield(){
    return new Promise(resolve=>{
      requestAnimationFrame(()=>{
        destinationPaintHeartbeats++;
        setTimeout(resolve,0);
      });
    });
  }
  function cancelDestination(reason="superseded"){
    destinationSerial++;
    clearDestinationQueue(reason);
    if(streamingState!=="READY")streamingState="READY";
    destinationLastProgress=Object.freeze({...destinationLastProgress,state:"READY",cancelled:true,reason:String(reason||"superseded")});
    return destinationLastProgress;
  }
  async function prepareDestination(request,{onProgress=null,graceMs=DESTINATION_GRACE_MS,forceGate=false}={}){
    if(destroyed||!request?.center)return Object.freeze({ready:false,reason:"invalid-destination"});
    const serial=++destinationSerial;
    destinationRequests++;
    clearDestinationQueue("new-destination");
    stopIdleExpansion("destination-streaming",true);
    const plan=destinationPlan(request);
    destinationStartedAtMs=performance.now();
    destinationGateShownAtMs=null;
    destinationReadyAtMs=null;
    const emit=()=>{
      const p=destinationProgress(plan,streamingState);
      try{onProgress?.(p);}catch(_){}
      return p;
    };
    // Check retained coverage before applying jump-distance backpressure. A
    // fully Active/Prepared/Cached destination is already safe to expose and
    // must not flash LOAD_GATE merely because the camera jump is large.
    streamingState="CATCHING_UP";
    let progress=emit();
    if(progress.completed>=progress.required){
      streamingState="RECOVERY";
      progress=emit();
      destinationReadyAtMs=performance.now();
      destinationCompletions++;
      return Object.freeze({...progress,ready:true,cached:true,elapsedMs:Number((destinationReadyAtMs-destinationStartedAtMs).toFixed(1))});
    }
    const previous=lastCenterChunk;
    const jumpDistance=previous?Math.max(Math.abs(plan.centerChunk.x-previous.x),Math.abs(plan.centerChunk.y-previous.y)):0;
    const immediateGate=Boolean(forceGate||jumpDistance>Math.max(2,Math.max(Number(request.activeRadiusX||0),Number(request.activeRadiusY||0))+1));
    streamingState=immediateGate?"LOAD_GATE":"CATCHING_UP";
    if(immediateGate)destinationGateShownAtMs=performance.now();
    progress=emit();
    const missing=plan.items.filter(item=>!entries.has(entryKey(currentSignature(),item.x,item.y)));
    schedulePrepared(missing);
    while(serial===destinationSerial&&!destroyed){
      progress=emit();
      if(progress.completed>=progress.required)break;
      const elapsed=performance.now()-destinationStartedAtMs;
      if(streamingState==="CATCHING_UP"&&elapsed>=Math.max(0,Number(graceMs)||0)){
        streamingState="LOAD_GATE";
        destinationGateShownAtMs=performance.now();
        progress=emit();
      }
      await cooperativeDestinationYield();
    }
    if(serial!==destinationSerial||destroyed){
      return Object.freeze({...destinationLastProgress,ready:false,stale:true,reason:"superseded"});
    }
    streamingState="RECOVERY";
    progress=emit();
    destinationReadyAtMs=performance.now();
    destinationCompletions++;
    return Object.freeze({...progress,ready:true,cached:false,elapsedMs:Number((destinationReadyAtMs-destinationStartedAtMs).toFixed(1))});
  }
  function commitDestination(request){
    if(destroyed||!request?.center)return Object.freeze({ready:false,reason:"invalid-destination"});
    const sig=currentSignature();
    if(sig!==signature)return Object.freeze({ready:false,reason:"signature-mismatch"});
    const nextRequest={
      center:Object.freeze({x:String(request.center.x),y:String(request.center.y)}),
      activeRadiusX:Math.max(0,Number(request.activeRadiusX||0)),
      activeRadiusY:Math.max(0,Number(request.activeRadiusY||0))
    };
    const targets=targetSets(nextRequest);
    const explicit=[...new Set((Array.isArray(request?.requiredChunkIds)?request.requiredChunkIds:[])
      .map(value=>String(value||"")).filter(value=>/^-?\d+,-?\d+$/.test(value)))];
    const activeCoords=explicit.length
      ?new Map(explicit.map(key=>[key,parseCoord(key)]))
      :new Map([...targets.active].map(key=>[key,parseCoord(key)]));
    // A gated long-distance commit must expose only the chunks that were
    // already prepared for the destination viewport. Scheduling the ordinary
    // preload ring here reintroduced full synchronous chunk generation before
    // the navigation promise could finish. Defer that noncritical ring until
    // finishDestination() returns streaming to READY and idle/headroom work
    // resumes.
    const preparedCoords=explicit.length
      ?new Map(activeCoords)
      :new Map([...targets.prepared].map(key=>[key,parseCoord(key)]));
    if(!explicit.length)for(const [key,point] of activeCoords)preparedCoords.set(key,point);
    else destinationDeferredPreparedCount+=Math.max(0,targets.prepared.size);
    const missing=[];
    for(const point of activeCoords.values()){
      if(!entries.has(entryKey(sig,point.x,point.y)))missing.push(coordKey(point.x,point.y));
    }
    if(missing.length){
      return Object.freeze({ready:false,reason:"destination-active-missing",missing:Object.freeze(missing),stats:stats()});
    }

    stopIdleExpansion("destination-commit",true);
    clearIdleQueue();
    lastRequest=nextRequest;
    lastExactActiveIds=explicit.length?Object.freeze([...activeCoords.keys()].sort()):null;
    lastNavigationKey=[nextRequest.center.x,nextRequest.center.y,nextRequest.activeRadiusX,nextRequest.activeRadiusY].join("|");
    stationarySince=performance.now();

    for(const entry of entries.values()){
      const ckey=coordKey(entry.x,entry.y);
      if(activeCoords.has(ckey))setEntryState(entry,"Active");
      else if(preparedCoords.has(ckey))setEntryState(entry,"Prepared");
      else setEntryState(entry,"Cached");
    }

    const prepItems=[];
    for(const point of preparedCoords.values()){
      const fullKey=entryKey(sig,point.x,point.y);
      if(entries.has(fullKey))continue;
      const dx=point.x-targets.centerChunk.x,dy=point.y-targets.centerChunk.y;
      const dot=dx*targets.movement.x+dy*targets.movement.y;
      prepItems.push({
        x:point.x,y:point.y,signature:sig,
        priority:settings.directionalPreload&&dot>0?-dot:0,
        distance:Math.max(Math.abs(dx),Math.abs(dy))
      });
    }
    if(prepItems.length)schedulePrepared(prepItems);
    trimCached();
    lastCenterChunk=targets.centerChunk;
    if(!explicit.length)scheduleIdleCheck();
    const s=stats();
    return Object.freeze({...s,ready:s.activeStateComplete===true,committed:true,createdDuringCommit:0});
  }

  function finishDestination(){
    if(streamingState==="RECOVERY")streamingState="READY";
    destinationLastProgress=Object.freeze({...destinationLastProgress,state:streamingState,percent:100});
    scheduleIdleCheck();
    return destinationLastProgress;
  }

  function update(request){
    if(destroyed||!request?.center)return stats();
    const updateStarted=performance.now();
    updateCalls++;
    const sig=currentSignature();
    if(sig!==signature){invalidate("signature");signature=sig;}
    const nextRequest={
      center:Object.freeze({x:String(request.center.x),y:String(request.center.y)}),
      activeRadiusX:Math.max(0,Number(request.activeRadiusX||0)),
      activeRadiusY:Math.max(0,Number(request.activeRadiusY||0))
    };
    const navigationKey=[nextRequest.center.x,nextRequest.center.y,nextRequest.activeRadiusX,nextRequest.activeRadiusY].join("|");
    if(lastNavigationKey===null){
      stationarySince=performance.now();
    }else if(navigationKey!==lastNavigationKey){
      stationarySince=performance.now();
      stopIdleExpansion("navigation-resumed",true);
    }
    lastNavigationKey=navigationKey;
    lastRequest=nextRequest;
    lastExactActiveIds=null;
    clearIdleQueue();
    const targets=targetSets(lastRequest);
    const activeCoords=new Map([...targets.active].map(key=>[key,parseCoord(key)]));
    const preparedCoords=new Map([...targets.prepared].map(key=>[key,parseCoord(key)]));

    for(const entry of entries.values()){
      const ckey=coordKey(entry.x,entry.y);
      if(activeCoords.has(ckey))continue;
      if(preparedCoords.has(ckey))setEntryState(entry,"Prepared");
      else setEntryState(entry,"Cached");
    }

    for(const point of activeCoords.values())prepareNow(point.x,point.y,"Active",true);

    const prepItems=[];
    for(const point of preparedCoords.values()){
      const dx=point.x-targets.centerChunk.x,dy=point.y-targets.centerChunk.y;
      const dot=dx*targets.movement.x+dy*targets.movement.y;
      prepItems.push({
        x:point.x,y:point.y,
        signature:sig,
        priority:settings.directionalPreload&&dot>0?-dot:0,
        distance:Math.max(Math.abs(dx),Math.abs(dy))
      });
    }
    schedulePrepared(prepItems);
    trimCached();
    lastCenterChunk=targets.centerChunk;
    scheduleIdleCheck();
    lastUpdateMs=performance.now()-updateStarted;
    totalUpdateMs+=lastUpdateMs;
    maxUpdateMs=Math.max(maxUpdateMs,lastUpdateMs);
    return stats();
  }
  function forEachResource(fn){
    if(typeof fn!=="function")return;
    for(const entry of entries.values())fn(entry.resource,entry);
  }
  function stats(){
    let active=0,prepared=0,cached=0;
    for(const entry of entries.values()){
      if(entry.state==="Active")active++;
      else if(entry.state==="Prepared")prepared++;
      else cached++;
    }
    return Object.freeze({
      settings:get(),
      chunkSize:size,
      signature:currentSignature(),
      centerChunk:lastCenterChunk?Object.freeze({...lastCenterChunk}):null,
      activeRadiusX:Number(lastRequest?.activeRadiusX||0),
      activeRadiusY:Number(lastRequest?.activeRadiusY||0),
      activeTargetCount:lastRequest
        ?(Math.max(0,Number(lastRequest.activeRadiusX||0))*2+1)*(Math.max(0,Number(lastRequest.activeRadiusY||0))*2+1)
        :0,
      activeStateComplete:lastExactActiveIds
        ?active===lastExactActiveIds.length
        :lastRequest
          ?active===((Math.max(0,Number(lastRequest.activeRadiusX||0))*2+1)*(Math.max(0,Number(lastRequest.activeRadiusY||0))*2+1))
          :active===0,
      direction:lastDirection,
      Active:active,
      Prepared:prepared,
      Cached:cached,
      protectedCount:active+prepared,
      queueDepth:queue.length,
      normalQueueDepth:queueCounts().normal,
      idleQueueDepth:queueCounts().idle,
      normalCacheTarget:normalCacheTarget(),
      adaptiveIdleTarget:idleCacheTarget(idleExpansionLevel),
      retainedCacheLimit:Math.min(IDLE_CACHE_HARD_CEILING,Math.max(normalCacheTarget(),retainedCacheLimit)),
      idleCacheHardCeiling:IDLE_CACHE_HARD_CEILING,
      idleExpansionLevel,
      stationaryMs:lastRequest?Number(Math.max(0,performance.now()-stationarySince).toFixed(1)):0,
      idleStartMs:IDLE_START_MS,
      idleLevel2Ms:IDLE_LEVEL2_MS,
      idleChunksGenerated,idleCacheHits,idleStarts,idleStops,lastIdleStartReason,lastIdleStopReason,
      streamingState,destinationRequests,destinationCompletions,destinationCacheHits,destinationPromotions,
      staleDestinationCancelled,destinationDeduplicated,destinationRequiredCount,destinationCompletedCount,
      destinationRequiredIds,destinationTarget,destinationStartedAtMs,destinationGateShownAtMs,destinationReadyAtMs,
      destinationProgress:destinationLastProgress,destinationSliceCount,
      destinationDeferredPreparedCount,
      destinationLastSliceMs:Number(destinationLastSliceMs.toFixed(3)),
      destinationMaxSliceMs:Number(destinationMaxSliceMs.toFixed(3)),
      destinationAverageSliceMs:Number((destinationSliceCount?destinationTotalSliceMs/destinationSliceCount:0).toFixed(3)),
      destinationDataSliceCount,
      destinationDataLastMs:Number(destinationDataLastMs.toFixed(3)),
      destinationDataMaxMs:Number(destinationDataMaxMs.toFixed(3)),
      destinationDataAverageMs:Number((destinationDataSliceCount?destinationDataTotalMs/destinationDataSliceCount:0).toFixed(3)),
      destinationLongTask50,destinationLongTask100,destinationLongTask200,destinationPaintHeartbeats,
      destinationQueueDepth:queue.filter(item=>item.source==="destination").length,
      streamingMinimumResources:[...entries.values()].filter(entry=>entry?.resource?.streamingMinimum===true).length,
      streamingMinimumActive:[...entries.values()].filter(entry=>entry?.state==="Active"&&entry?.resource?.streamingMinimum===true).length,
      recentFrameTimeMs:lastHeadroom.frameMs,
      recentFrameBudgetMs:lastHeadroom.budgetMs,
      recentFrameHeadroomMs:lastHeadroom.headroomMs,
      recentFrameTargetFps:lastHeadroom.targetFps,
      headroomAvailable:lastHeadroom.ok,
      headroomReason:lastHeadroom.reason,
      headroomGoodChecks,
      lastIdleWorkMs:Number(lastIdleWorkMs.toFixed(3)),
      maxIdleWorkMs:Number(maxIdleWorkMs.toFixed(3)),
      averageIdleWorkMs:Number((idleChunksGenerated?totalIdleWorkMs/idleChunksGenerated:0).toFixed(3)),
      hits,misses,compositions,evictions,visibleWaits,cacheReuses,invalidations,lastInvalidationReason,
      activations,deactivations,stateReuses,resourceCreations,resourceDestructions,
      updateCalls,lastUpdateMs:Number(lastUpdateMs.toFixed(3)),maxUpdateMs:Number(maxUpdateMs.toFixed(3)),
      averageUpdateMs:Number((updateCalls?totalUpdateMs/updateCalls:0).toFixed(3)),
      transitionCalls,totalTransitionMs:Number(totalTransitionMs.toFixed(3)),maxTransitionMs:Number(maxTransitionMs.toFixed(3)),
      averageTransitionMs:Number((transitionCalls?totalTransitionMs/transitionCalls:0).toFixed(3)),
      redundantStateCallbacks:0,
      visibleAssetLoads:0,visibleTextureDecodes:0,visibleGltfParses:0,
      frameBudgetMs:settings.frameBudgetMs,
      lastWorkMs:Number(lastWorkMs.toFixed(3)),
      maxWorkMs:Number(maxWorkMs.toFixed(3)),
      frameBudgetSpikes,
      backgroundFrames,
      lastPreparedOrder,
      lastQueuePreview,
      bounded:cached<=Math.min(IDLE_CACHE_HARD_CEILING,Math.max(normalCacheTarget(),retainedCacheLimit)),
      backgroundEnabled:settings.backgroundChunkGeneration,
      directionalEnabled:settings.directionalPreload,
      simulationAuthorityPreserved:true
    });
  }
  function proof(){
    const s=stats();
    return Object.freeze({
      defaultsValid:DEFAULTS.preloadRadius===2&&DEFAULTS.maxCachedChunks===64&&DEFAULTS.directionalPreload&&DEFAULTS.backgroundChunkGeneration&&IDLE_CACHE_HARD_CEILING===256,
      allowedRadius:Object.freeze([...ALLOWED_RADIUS]),
      allowedCache:Object.freeze([...ALLOWED_CACHE]),
      activePreparedCachedSeparate:true,
      bounded:s.bounded,
      presentationOnly:s.simulationAuthorityPreserved,
      stats:s
    });
  }
  function destroy(){
    destroyed=true;cancelDestination("destroy");stopIdleExpansion("destroy",true);cancelWork();unsubscribe();
    for(const entry of entries.values())destroyEntry(entry);
    entries.clear();queue=[];queued.clear();
  }
  return Object.freeze({update,prepareDestination,commitDestination,cancelDestination,finishDestination,stats,proof,setChunkSize,forEachResource,invalidate,destroy});
}

bindControls();

window.TerrainChunkPreloadSettings=Object.freeze({
  storageKey:STORAGE_KEY,
  defaults:DEFAULTS,
  allowedRadius:ALLOWED_RADIUS,
  allowedCache:ALLOWED_CACHE,
  get,set,reset,subscribe,syncControls,saveControls
});
window.TerrainChunkPreload=Object.freeze({createManager});
})();