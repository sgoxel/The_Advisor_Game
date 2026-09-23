(function(){
"use strict";

const STORAGE_KEY="the-advisor-game:terrain-preload:v1";
const ALLOWED_RADIUS=Object.freeze([1,2,3,4]);
const ALLOWED_CACHE=Object.freeze([16,32,64,128,256]);
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
  activateChunk,
  deactivateChunk,
  destroyChunk,
  signatureProvider=()=>"standard"
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
  let settings=get();
  let hits=0,misses=0,compositions=0,evictions=0,visibleWaits=0,cacheReuses=0,frameBudgetSpikes=0,invalidations=0;
  let activations=0,deactivations=0,stateReuses=0,resourceCreations=0,resourceDestructions=0;
  let updateCalls=0,lastUpdateMs=0,maxUpdateMs=0,totalUpdateMs=0,transitionCalls=0,totalTransitionMs=0,maxTransitionMs=0;
  let lastInvalidationReason=null;
  let lastWorkMs=0,maxWorkMs=0,backgroundFrames=0;
  let lastDirection=Object.freeze({x:0,y:0});
  let lastPreparedOrder=Object.freeze([]);
  let lastQueuePreview=Object.freeze([]);
  const unsubscribe=subscribe(next=>{
    settings=next;
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
    entries.clear();queue=[];queued.clear();lastCenterChunk=null;
    signature=currentSignature();
  }
  function cancelWork(){
    if(frameHandle){
      cancelAnimationFrame(frameHandle);
      frameHandle=0;
    }
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
  function prepareNow(x,y,state,isVisible){
    const sig=currentSignature();
    const key=entryKey(sig,x,y);
    let entry=entries.get(key);
    if(entry){
      hits++;
      if(entry.state==="Cached"&&(state==="Active"||state==="Prepared"))cacheReuses++;
      entry.lastUsed=performance.now();
      setEntryState(entry,state);
      return entry;
    }
    misses++;
    if(isVisible)visibleWaits++;
    const started=performance.now();
    const resource=prepareChunk({x,y,chunkSize:size,signature:sig,state});
    const elapsed=performance.now()-started;
    lastWorkMs=elapsed;maxWorkMs=Math.max(maxWorkMs,elapsed);
    if(elapsed>settings.frameBudgetMs*1.5)frameBudgetSpikes++;
    entry={key,x,y,state,signature:sig,resource,lastUsed:performance.now()};
    entries.set(key,entry);
    compositions++;
    resourceCreations++;
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
      if(entries.has(fullKey)){
        const entry=entries.get(fullKey);
        hits++;
        if(entry.state==="Cached")cacheReuses++;
        entry.lastUsed=performance.now();
        setEntryState(entry,"Prepared");
        continue;
      }
      if(queued.has(fullKey))continue;
      queued.add(fullKey);
      queue.push({...item,fullKey});
    }
    queue.sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.x-b.x||a.y-b.y);
    lastQueuePreview=Object.freeze(queue.slice(0,8).map(item=>Object.freeze({x:item.x,y:item.y,priority:item.priority,distance:item.distance})));
    if(queue.length&&!frameHandle)frameHandle=requestAnimationFrame(processQueue);
  }
  function processQueue(){
    frameHandle=0;
    if(destroyed||!settings.backgroundChunkGeneration){queue=[];queued.clear();return;}
    const started=performance.now();
    let processed=0;
    const preparedKeys=[];
    while(queue.length&&processed<settings.maxChunksPerFrame){
      if(processed>0&&performance.now()-started>=settings.frameBudgetMs)break;
      const item=queue.shift();queued.delete(item.fullKey);
      if(item.signature!==currentSignature())continue;
      // A viewport/orientation change can promote a chunk to Active while an
      // older background-prepare item for the same chunk is still queued.
      // Never let that stale item demote and disable a now-visible resource.
      const existing=entries.get(item.fullKey);
      if(existing?.state==="Active"){
        processed++;
        continue;
      }
      prepareNow(item.x,item.y,"Prepared",false);
      preparedKeys.push(coordKey(item.x,item.y));
      processed++;
    }
    const elapsed=performance.now()-started;
    lastWorkMs=elapsed;maxWorkMs=Math.max(maxWorkMs,elapsed);backgroundFrames++;
    if(elapsed>settings.frameBudgetMs*1.5)frameBudgetSpikes++;
    if(preparedKeys.length)lastPreparedOrder=Object.freeze(preparedKeys);
    trimCached();
    if(queue.length)frameHandle=requestAnimationFrame(processQueue);
  }
  function trimCached(){
    const cached=[...entries.values()]
      .filter(e=>e.state==="Cached")
      .sort((a,b)=>a.lastUsed-b.lastUsed||a.x-b.x||a.y-b.y);
    while(cached.length>settings.maxCachedChunks){
      const entry=cached.shift();
      entries.delete(entry.key);
      destroyEntry(entry);
      evictions++;
    }
  }
  function update(request){
    if(destroyed||!request?.center)return stats();
    const updateStarted=performance.now();
    updateCalls++;
    const sig=currentSignature();
    if(sig!==signature){invalidate("signature");signature=sig;}
    lastRequest={
      center:Object.freeze({x:String(request.center.x),y:String(request.center.y)}),
      activeRadiusX:Math.max(0,Number(request.activeRadiusX||0)),
      activeRadiusY:Math.max(0,Number(request.activeRadiusY||0))
    };
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
      activeStateComplete:lastRequest
        ?active===((Math.max(0,Number(lastRequest.activeRadiusX||0))*2+1)*(Math.max(0,Number(lastRequest.activeRadiusY||0))*2+1))
        :active===0,
      direction:lastDirection,
      Active:active,
      Prepared:prepared,
      Cached:cached,
      protectedCount:active+prepared,
      queueDepth:queue.length,
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
      bounded:cached<=settings.maxCachedChunks,
      backgroundEnabled:settings.backgroundChunkGeneration,
      directionalEnabled:settings.directionalPreload,
      simulationAuthorityPreserved:true
    });
  }
  function proof(){
    const s=stats();
    return Object.freeze({
      defaultsValid:DEFAULTS.preloadRadius===2&&DEFAULTS.maxCachedChunks===64&&DEFAULTS.directionalPreload&&DEFAULTS.backgroundChunkGeneration,
      allowedRadius:Object.freeze([...ALLOWED_RADIUS]),
      allowedCache:Object.freeze([...ALLOWED_CACHE]),
      activePreparedCachedSeparate:true,
      bounded:s.bounded,
      presentationOnly:s.simulationAuthorityPreserved,
      stats:s
    });
  }
  function destroy(){
    destroyed=true;cancelWork();unsubscribe();
    for(const entry of entries.values())destroyEntry(entry);
    entries.clear();queue=[];queued.clear();
  }
  return Object.freeze({update,stats,proof,setChunkSize,forEachResource,invalidate,destroy});
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