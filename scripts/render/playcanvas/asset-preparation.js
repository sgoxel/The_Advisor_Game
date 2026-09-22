(function(){
"use strict";

const DEFAULT_CACHE_LIMIT=96;

function create({pc,app,cacheLimit=DEFAULT_CACHE_LIMIT}={}){
  if(!pc||!app)throw new Error("PlayCanvas asset preparation requires pc and app");
  const records=new Map();
  const materialCache=new Map();
  const regionKeys=new Map();
  let serial=0;
  let hits=0,misses=0,loads=0,evictions=0,waits=0;

  function register(key,descriptor){
    const logicalKey=String(key);
    if(!records.has(logicalKey))records.set(logicalKey,{key:logicalKey,descriptor:Object.freeze({...descriptor}),resource:null,promise:null,lastUsed:0,pinned:false});
    return logicalKey;
  }

  function registerMaterial(key,color){
    return register(key,{kind:"material",color:[Number(color[0]),Number(color[1]),Number(color[2])]});
  }

  function registerGlb(key,url){
    return register(key,{kind:"container",url:String(url)});
  }

  function registerTexture(key,url){
    return register(key,{kind:"texture",url:String(url)});
  }

  function materialFromDescriptor(record){
    if(materialCache.has(record.key))return materialCache.get(record.key);
    const d=record.descriptor;
    const m=new pc.StandardMaterial();
    m.name=record.key;
    const c=d.color||[0.5,0.5,0.5];
    m.diffuse.set(c[0],c[1],c[2]);
    m.gloss=0.18;
    m.metalness=0;
    m.update();
    materialCache.set(record.key,m);
    return m;
  }

  function loadAsset(record){
    if(record.resource){hits++;return Promise.resolve(record.resource)}
    if(record.promise){hits++;return record.promise}
    misses++;
    const d=record.descriptor;
    if(d.kind==="material"){
      record.resource=materialFromDescriptor(record);
      return Promise.resolve(record.resource);
    }
    if(!d.url)return Promise.reject(new Error("Asset URL missing for "+record.key));
    loads++;
    record.promise=new Promise((resolve,reject)=>{
      const asset=new pc.Asset(record.key,d.kind==="container"?"container":"texture",{url:d.url});
      const done=()=>{record.resource=asset.resource||asset;record.promise=null;resolve(record.resource)};
      const fail=err=>{record.promise=null;reject(err instanceof Error?err:new Error(String(err)))};
      asset.once("load",done); asset.once("error",fail); app.assets.add(asset); app.assets.load(asset);
    });
    return record.promise;
  }

  function evict(protectedKeys){
    if(records.size<=cacheLimit)return;
    const candidates=[...records.values()].filter(r=>r.resource&&!r.pinned&&!protectedKeys.has(r.key)&&r.descriptor.kind!=="material").sort((a,b)=>a.lastUsed-b.lastUsed);
    while(candidates.length&&[...records.values()].filter(r=>r.resource).length>cacheLimit){
      const r=candidates.shift();
      const asset=app.assets.find(r.key);
      if(asset){app.assets.remove(asset);asset.unload?.()}
      r.resource=null; evictions++;
    }
  }

  async function prepareRegion(regionKey,keys){
    const token=++serial;
    const unique=[...new Set((keys||[]).map(String))].filter(k=>records.has(k));
    waits++;
    const started=performance.now();
    await Promise.all(unique.map(async key=>{const r=records.get(key);r.lastUsed=token;await loadAsset(r)}));
    if(token!==serial)return Object.freeze({ready:false,stale:true,regionKey:String(regionKey),keyCount:unique.length});
    for(const r of records.values())r.pinned=false;
    for(const key of unique)records.get(key).pinned=true;
    regionKeys.clear(); regionKeys.set(String(regionKey),new Set(unique));
    evict(new Set(unique));
    return Object.freeze({ready:true,stale:false,regionKey:String(regionKey),keyCount:unique.length,waitMs:performance.now()-started});
  }

  function get(key){const r=records.get(String(key));if(!r)return null;r.lastUsed=serial;return r.resource}
  function has(key){return records.has(String(key))}
  function stats(){
    const loaded=[...records.values()].filter(r=>r.resource).length;
    return Object.freeze({registered:records.size,loaded,materials:materialCache.size,hits,misses,loads,evictions,waits,cacheLimit,preparedRegionKey:[...regionKeys.keys()][0]||null,preparedKeyCount:[...regionKeys.values()][0]?.size||0});
  }

  return Object.freeze({register,registerMaterial,registerGlb,registerTexture,prepareRegion,get,has,stats});
}

window.PlayCanvasAssetPreparation=Object.freeze({create,defaultCacheLimit:DEFAULT_CACHE_LIMIT});
})();
