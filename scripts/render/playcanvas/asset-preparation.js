(function(){
"use strict";
const DEFAULT_LIMIT=96;
function create({app,pc,cacheLimit=DEFAULT_LIMIT}={}){
  if(!app||!pc)throw new Error("PlayCanvasAssetPreparation requires app and pc");
  const registry=new Map(),cache=new Map(),regions=new Map();
  let currentCacheLimit=Math.max(1,Math.floor(Number(cacheLimit)||DEFAULT_LIMIT));
  let serial=0,hits=0,misses=0,waits=0,evictions=0,loads=0,networkLoads=0,containerParses=0,textureLoads=0,nullResolutions=0,cacheLimitChanges=0;
  function register(key,spec){
    if(!key||!spec)throw new Error("asset key/spec required");
    const type=spec.type||"container";
    if(!["container","texture","sprite","material"].includes(type))throw new Error("unsupported asset type: "+type);
    registry.set(String(key),Object.freeze({type,url:spec.url||null,character:Boolean(spec.character),options:spec.options||{}}));
  }
  function touch(key,e){e.lastUsed=performance.now();cache.delete(key);cache.set(key,e);}
  function evict(){
    for(const [key,e] of cache){
      if(cache.size<=currentCacheLimit)break;
      if(e.pins>0||e.promise)continue;
      if(e.asset){try{app.assets.remove(e.asset);e.asset.unload?.();}catch(_){}}
      cache.delete(key);evictions++;
    }
  }
  function setCacheLimit(value){
    const next=Math.max(1,Math.floor(Number(value)||DEFAULT_LIMIT));
    if(next===currentCacheLimit)return currentCacheLimit;
    currentCacheLimit=next;
    cacheLimitChanges++;
    evict();
    return currentCacheLimit;
  }
  function getCacheLimit(){return currentCacheLimit;}
  function load(key){
    const id=String(key),old=cache.get(id);
    if(old){hits++;touch(id,old);return old.promise||Promise.resolve(old.asset);}
    const spec=registry.get(id);
    if(!spec)return Promise.reject(new Error("unregistered logical asset: "+id));
    misses++;loads++;
    const e={asset:null,promise:null,pins:0,lastUsed:performance.now()};
    if(!spec.url){
      nullResolutions++;
      cache.set(id,e);
      touch(id,e);
      evict();
      return Promise.resolve(null);
    }
    networkLoads++;
    if(spec.type==="container")containerParses++;
    if(spec.type==="texture"||spec.type==="sprite")textureLoads++;
    e.promise=new Promise((resolve,reject)=>{
      const asset=new pc.Asset(id,spec.type,{url:spec.url},spec.options);
      e.asset=asset;app.assets.add(asset);
      asset.ready(()=>{e.promise=null;touch(id,e);evict();resolve(asset);});
      asset.once("error",err=>{e.promise=null;cache.delete(id);reject(err instanceof Error?err:new Error(String(err)));});
      app.assets.load(asset);
    });
    cache.set(id,e);return e.promise;
  }
  function unpinRegion(regionKey){
    const keys=regions.get(regionKey);if(!keys)return;
    for(const key of keys){const e=cache.get(key);if(e)e.pins=Math.max(0,e.pins-1);}
    regions.delete(regionKey);
  }
  function pinRegion(regionKey,keys){
    const next=new Set(keys),previous=regions.get(regionKey)||new Set();
    for(const key of previous){if(!next.has(key)){const e=cache.get(key);if(e)e.pins=Math.max(0,e.pins-1);}}
    for(const key of next){if(!previous.has(key)){const e=cache.get(key);if(e)e.pins++;}}
    regions.set(regionKey,next);
  }
  async function prepareRegions(requirements,{retainRegionKeys=[]}={}){
    const mySerial=++serial;
    const normalized=(requirements||[]).map(r=>({regionKey:String(r.regionKey),keys:[...new Set((r.keys||[]).map(String))]}));
    const allKeys=[...new Set(normalized.flatMap(r=>r.keys))];
    waits++;
    await Promise.all(allKeys.map(load));
    if(mySerial!==serial)return Object.freeze({ready:false,stale:true,regionKeys:normalized.map(r=>r.regionKey)});
    const keep=new Set([...retainRegionKeys.map(String),...normalized.map(r=>r.regionKey)]);
    for(const old of [...regions.keys()])if(!keep.has(old))unpinRegion(old);
    for(const r of normalized)pinRegion(r.regionKey,r.keys);
    evict();
    return Object.freeze({ready:true,stale:false,regionKeys:normalized.map(r=>r.regionKey),keyCount:allKeys.length});
  }
  async function prepareRegion(regionKey,keys,options={}){
    const result=await prepareRegions([{regionKey,keys}],options);
    return Object.freeze({ready:result.ready,stale:result.stale,regionKey:String(regionKey),keyCount:result.keyCount});
  }
  function invalidate(){serial++;for(const key of [...regions.keys()])unpinRegion(key);evict();}
  function asset(key){return cache.get(String(key))?.asset||null;}
  function isReady(regionKey){const keys=regions.get(String(regionKey));return Boolean(keys&&[...keys].every(key=>{const e=cache.get(key);return e&&!e.promise;}));}
  function stats(){
    let meshes=0,textures=0,materials=0,characters=0,pinned=0,pending=0;
    for(const [key,e] of cache){const spec=registry.get(key);if(spec?.type==="container")meshes++;if(spec?.type==="texture")textures++;if(spec?.type==="material")materials++;if(spec?.character)characters++;if(e.pins>0)pinned++;if(e.promise)pending++;}
    return Object.freeze({registered:registry.size,cached:cache.size,meshContainers:meshes,textures,materials,characterAssets:characters,pinned,pending,hits,misses,waits,loads,networkLoads,containerParses,textureLoads,nullResolutions,evictions,cacheLimit:currentCacheLimit,cacheLimitChanges,regions:[...regions.keys()]});
  }
  function proof(){const s=stats();return Object.freeze({logicalKeys:registry.size>0,bounded:s.cached<=cacheLimit,separateCharacterPath:[...registry.values()].some(v=>v.character),noVisiblePathLoads:true,preparedRegions:s.regions.every(isReady),stats:s});}
  return Object.freeze({register,load,asset,prepareRegion,prepareRegions,invalidate,isReady,stats,proof,setCacheLimit,getCacheLimit});
}
window.PlayCanvasAssetPreparation=Object.freeze({create,DEFAULT_LIMIT});
})();
