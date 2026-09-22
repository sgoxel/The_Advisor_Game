(function(){
"use strict";

const textures=new Map();
const sources=new Map();
const resolvedSources=new Map();
const lastUsed=new Map();
const pinned=new Set();
const preparedRegions=new Map();
let ready=false;
let loadingPromise=null;
let preparationSerial=0;
let preparedRegionKey=null;
let preparedKeys=[];
let lastActivationWasPrefetched=false;
let lastPrefetchDirection="0,0";
const MAX_CACHED_KEYS=160;
const MAX_PREPARED_REGIONS=20;
const prepTotals={
  regionPrepares:0,
  blockingLoads:0,
  activationCacheHits:0,
  activationPrefetchHits:0,
  prefetches:0,
  prefetchReuses:0,
  regionEvictions:0
};

function catalog(){
  return Object.freeze({
    ...TileTextures.assetCatalog(),
    "character:protagonist-male":"assets/characters/protagonist_male.png"
  });
}

function candidates(url){
  const value=String(url||"");
  if(/\.svg(?:$|[?#])/i.test(value)){
    return Object.freeze([value.replace(/\.svg(?=$|[?#])/i,".png"),value]);
  }
  return Object.freeze([value]);
}

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.decoding="async";
    image.onload=async()=>{
      try{if(typeof image.decode==="function")await image.decode()}catch(_){}
      resolve(image);
    };
    image.onerror=()=>reject(new Error("Asset load failed: "+url));
    image.src=url;
  });
}

function rasterizeSvg(image){
  const canvas=document.createElement("canvas");
  canvas.width=100;
  canvas.height=100;
  const context=canvas.getContext("2d",{alpha:true});
  context.clearRect(0,0,100,100);
  context.drawImage(image,0,0,100,100);
  return canvas;
}

async function loadSource(url){
  if(sources.has(url))return sources.get(url);
  const pending=(async()=>{
    const image=await loadImage(url);
    const source=/\.svg(?:$|[?#])/i.test(url)?rasterizeSvg(image):image;
    return PIXI.Texture.from(source);
  })();
  sources.set(url,pending);
  try{
    const texture=await pending;
    sources.set(url,texture);
    return texture;
  }catch(error){
    sources.delete(url);
    throw error;
  }
}

async function resolveKey(key,manifest){
  const declared=manifest[key];
  if(!declared)throw new Error("Unknown logical texture key: "+key);
  let lastError=null;
  for(const url of candidates(declared)){
    try{
      const texture=await loadSource(url);
      resolvedSources.set(key,url);
      return texture;
    }catch(error){lastError=error;}
  }
  throw lastError||new Error("Asset resolution failed: "+key);
}

function normalizeKeys(keys){
  return [...new Set((keys||[]).filter(Boolean))];
}

function touch(key){lastUsed.set(key,Date.now())}

function pinKeys(keys){
  pinned.clear();
  for(const key of keys||[])if(key)pinned.add(key);
}

function releaseUnusedSources(){
  const inUse=new Set(
    [...textures.keys()]
      .map(key=>resolvedSources.get(key))
      .filter(Boolean)
  );
  for(const [url,value] of [...sources.entries()]){
    if(inUse.has(url))continue;
    if(value&&typeof value.destroy==="function"){
      try{value.destroy(true)}catch(_){}
    }
    sources.delete(url);
  }
}

function evict(maxKeys=MAX_CACHED_KEYS){
  if(textures.size<=maxKeys)return 0;
  const evictionCandidates=[...textures.keys()]
    .filter(key=>!pinned.has(key))
    .sort((a,b)=>(lastUsed.get(a)||0)-(lastUsed.get(b)||0));
  let removed=0;
  while(textures.size>maxKeys&&evictionCandidates.length){
    const key=evictionCandidates.shift();
    textures.delete(key);
    resolvedSources.delete(key);
    lastUsed.delete(key);
    removed++;
  }
  if(removed)releaseUnusedSources();
  return removed;
}

function regionPinnedKeyCount(){
  const keys=new Set();
  for(const record of preparedRegions.values()){
    for(const key of record.keys)keys.add(key);
  }
  return keys.size;
}

function refreshRegionPins(){
  const keys=new Set();
  for(const record of preparedRegions.values()){
    for(const key of record.keys)keys.add(key);
  }
  pinKeys(keys);
}

function oldestEvictableRegion(){
  for(const key of preparedRegions.keys()){
    if(key!==preparedRegionKey)return key;
  }
  return null;
}

function trimPreparedRegions(){
  while(
    preparedRegions.size>MAX_PREPARED_REGIONS ||
    (regionPinnedKeyCount()>MAX_CACHED_KEYS&&preparedRegions.size>1)
  ){
    const key=oldestEvictableRegion();
    if(!key)break;
    preparedRegions.delete(key);
    prepTotals.regionEvictions++;
  }
  refreshRegionPins();
  evict();
}

function rememberRegion(regionKey,keys,kind){
  const key=String(regionKey||"");
  if(!key)return null;
  const record=Object.freeze({
    regionKey:key,
    keys:Object.freeze(normalizeKeys(keys)),
    kind:String(kind||"cached"),
    preparedAt:Date.now()
  });
  preparedRegions.delete(key);
  preparedRegions.set(key,record);
  trimPreparedRegions();
  return preparedRegions.get(key)||record;
}

function markRegionKind(regionKey,kind){
  const key=String(regionKey||"");
  const current=preparedRegions.get(key);
  if(!current)return null;
  return rememberRegion(key,current.keys,kind);
}

function activateRegion(regionKey,keys,{wasPrefetched=false}={}){
  const key=String(regionKey||"");
  if(preparedRegionKey&&preparedRegionKey!==key&&preparedRegions.has(preparedRegionKey)){
    markRegionKind(preparedRegionKey,"cached");
  }
  preparedRegionKey=key;
  preparedKeys=normalizeKeys(keys);
  rememberRegion(key,preparedKeys,"active");
  lastActivationWasPrefetched=Boolean(wasPrefetched);
  ready=true;
  return preparedRegions.get(key)||null;
}

async function preloadKeys(keys,{pin=false,deferEvict=false}={}){
  if(!window.PIXI)throw new Error("PixiJS is not available");
  const manifest=catalog();
  const unique=normalizeKeys(keys);
  if(pin)pinKeys(unique);
  const missing=unique.filter(key=>!textures.has(key));
  await Promise.all(missing.map(async key=>{
    const texture=await resolveKey(key,manifest);
    textures.set(key,texture);
    touch(key);
  }));
  unique.forEach(touch);
  if(!deferEvict)evict();
  return unique.map(key=>textures.get(key));
}

function isRegionPrepared(regionKey,keys){
  const key=String(regionKey||"");
  const required=normalizeKeys(keys);
  const record=preparedRegions.get(key);
  return Boolean(
    ready&&record&&
    required.every(item=>record.keys.includes(item)&&textures.has(item))
  );
}

async function prepareRegion(regionKey,keys){
  const key=String(regionKey||"");
  const unique=normalizeKeys(keys);
  const cached=preparedRegions.get(key);
  if(isRegionPrepared(key,unique)){
    prepTotals.activationCacheHits++;
    const alreadyActive=key===preparedRegionKey&&cached?.kind==="active";
    const wasPrefetched=cached?.kind==="prefetch";
    if(wasPrefetched)prepTotals.activationPrefetchHits++;
    if(!alreadyActive){
      activateRegion(key,unique,{wasPrefetched});
    }else{
      preparedKeys=unique.slice();
      ready=true;
    }
    return Object.freeze({
      ready:true,stale:false,regionKey:key,keyCount:unique.length,
      cached:true,prefetched:wasPrefetched||(alreadyActive&&lastActivationWasPrefetched)
    });
  }

  const serial=++preparationSerial;
  prepTotals.blockingLoads++;
  await preloadKeys(unique,{pin:false,deferEvict:true});
  if(serial!==preparationSerial){
    return Object.freeze({ready:false,stale:true,regionKey:key,keyCount:unique.length});
  }
  prepTotals.regionPrepares++;
  activateRegion(key,unique,{wasPrefetched:false});
  return Object.freeze({
    ready:true,stale:false,regionKey:key,keyCount:unique.length,
    cached:false,prefetched:false
  });
}

async function prefetchRegion(regionKey,keys,{direction="0,0"}={}){
  const key=String(regionKey||"");
  const unique=normalizeKeys(keys);
  lastPrefetchDirection=String(direction||"0,0");

  if(isRegionPrepared(key,unique)){
    prepTotals.prefetchReuses++;
    const current=preparedRegions.get(key);
    if(current?.kind!=="active")rememberRegion(key,unique,"prefetch");
    return Object.freeze({
      ready:true,regionKey:key,keyCount:unique.length,reused:true
    });
  }

  await preloadKeys(unique,{pin:false,deferEvict:true});
  rememberRegion(key,unique,"prefetch");
  prepTotals.prefetches++;
  ready=true;
  return Object.freeze({
    ready:true,regionKey:key,keyCount:unique.length,reused:false
  });
}

function invalidatePreparation(){
  preparationSerial++;
  preparedRegionKey=null;
  preparedKeys=[];
  preparedRegions.clear();
  ready=false;
  lastActivationWasPrefetched=false;
  lastPrefetchDirection="0,0";
  refreshRegionPins();
  evict();
}

async function preloadAll(){
  if(ready&&preparedRegionKey==="legacy:all")return stats();
  if(loadingPromise)return loadingPromise;
  loadingPromise=(async()=>{
    const manifest=catalog();
    const keys=Object.keys(manifest);
    await preloadKeys(keys,{pin:false,deferEvict:true});
    preparedRegions.clear();
    preparedRegionKey="legacy:all";
    preparedKeys=keys.slice();
    rememberRegion(preparedRegionKey,preparedKeys,"active");
    ready=true;
    return stats();
  })();
  try{return await loadingPromise}
  finally{loadingPromise=null}
}

function get(key){
  if(!key)return null;
  const texture=textures.get(key)||null;
  if(texture)touch(key);
  return texture;
}

function source(key){
  return resolvedSources.get(key)||catalog()[key]||null;
}

function has(key){return textures.has(key)}

function stats(){
  const manifest=catalog();
  const loadedKeys=[...textures.keys()];
  const loadedSources=loadedKeys.map(key=>resolvedSources.get(key)||manifest[key]).filter(Boolean);
  const regionEntries=[...preparedRegions.values()];
  return Object.freeze({
    ready,
    logicalKeyCount:Object.keys(manifest).length,
    loadedKeyCount:loadedKeys.length,
    loadedSourceCount:new Set(loadedSources).size,
    svgSourceCount:loadedSources.filter(url=>/\.svg(?:$|[?#])/i.test(url)).length,
    pngSourceCount:loadedSources.filter(url=>/\.png(?:$|[?#])/i.test(url)).length,
    pngPreferredCount:loadedKeys.filter(key=>/\.png(?:$|[?#])/i.test(resolvedSources.get(key)||"")).length,
    fallbackSvgCount:loadedKeys.filter(key=>/\.svg(?:$|[?#])/i.test(resolvedSources.get(key)||"")).length,
    pinnedKeyCount:pinned.size,
    preparedRegionKey,
    preparedKeyCount:preparedKeys.length,
    preparedRegionCount:preparedRegions.size,
    prefetchedRegionCount:regionEntries.filter(record=>record.kind==="prefetch").length,
    cachedPreparedRegionCount:regionEntries.filter(record=>record.kind==="cached").length,
    preparedRegionKeys:Object.freeze([...preparedRegions.keys()]),
    lastActivationWasPrefetched,
    lastPrefetchDirection,
    preparationSerial,
    cacheLimit:MAX_CACHED_KEYS,
    preparedRegionLimit:MAX_PREPARED_REGIONS,
    standardTerrainTexturePx:100,
    regionPrepares:prepTotals.regionPrepares,
    blockingLoadCount:prepTotals.blockingLoads,
    activationCacheHitCount:prepTotals.activationCacheHits,
    activationPrefetchHitCount:prepTotals.activationPrefetchHits,
    prefetchCount:prepTotals.prefetches,
    prefetchReuseCount:prepTotals.prefetchReuses,
    regionEvictionCount:prepTotals.regionEvictions
  });
}

window.TextureAssets=Object.freeze({
  catalog,candidates,preloadKeys,prepareRegion,prefetchRegion,invalidatePreparation,isRegionPrepared,
  preloadAll,pinKeys,evict,get,source,has,stats
});
})();