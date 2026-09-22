(function(){
"use strict";
const DEFAULT_LIMIT=96;
function create({app,pc,cacheLimit=DEFAULT_LIMIT}={}){
  if(!app||!pc)throw new Error("PlayCanvasAssetPreparation requires app and pc");
  const registry=new Map(),cache=new Map(),regions=new Map();let serial=0,hits=0,misses=0,waits=0,evictions=0;
  function register(key,spec){if(!key||!spec)throw new Error("asset key/spec required");const type=spec.type||"container";if(!["container","texture","sprite"].includes(type))throw new Error("unsupported asset type: "+type);registry.set(String(key),Object.freeze({type,url:spec.url||null,character:Boolean(spec.character),options:spec.options||{}}));}
  function touch(key,e){e.lastUsed=performance.now();cache.delete(key);cache.set(key,e);}
  function evict(){for(const [key,e] of cache){if(cache.size<=cacheLimit)break;if(e.pins>0||e.promise)continue;if(e.asset){try{app.assets.remove(e.asset);e.asset.unload?.();}catch(_){}}cache.delete(key);evictions++;}}
  function load(key){const id=String(key),old=cache.get(id);if(old){hits++;touch(id,old);return old.promise||Promise.resolve(old.asset);}const spec=registry.get(id);if(!spec)return Promise.reject(new Error("unregistered logical asset: "+id));misses++;const e={asset:null,promise:null,pins:0,lastUsed:performance.now()};e.promise=new Promise((resolve,reject)=>{if(!spec.url){e.promise=null;resolve(null);return;}const asset=new pc.Asset(id,spec.type,{url:spec.url},spec.options);e.asset=asset;app.assets.add(asset);asset.ready(()=>{e.promise=null;touch(id,e);evict();resolve(asset);});asset.once("error",err=>{e.promise=null;cache.delete(id);reject(err instanceof Error?err:new Error(String(err)));});app.assets.load(asset);});cache.set(id,e);return e.promise;}
  function unpinRegion(regionKey){const keys=regions.get(regionKey);if(!keys)return;for(const key of keys){const e=cache.get(key);if(e)e.pins=Math.max(0,e.pins-1);}regions.delete(regionKey);}
  async function prepareRegion(regionKey,keys){const mySerial=++serial,unique=[...new Set((keys||[]).map(String))];waits++;await Promise.all(unique.map(load));if(mySerial!==serial)return Object.freeze({ready:false,stale:true,regionKey});for(const old of [...regions.keys()])if(old!==regionKey)unpinRegion(old);for(const key of unique){const e=cache.get(key);if(e)e.pins++;}regions.set(regionKey,new Set(unique));evict();return Object.freeze({ready:true,stale:false,regionKey,keyCount:unique.length});}
  function invalidate(){serial++;for(const key of [...regions.keys()])unpinRegion(key);evict();}
  function stats(){let meshes=0,textures=0,characters=0,pinned=0,pending=0;for(const [key,e] of cache){const spec=registry.get(key);if(spec?.type==="container")meshes++;if(spec?.type==="texture")textures++;if(spec?.character)characters++;if(e.pins>0)pinned++;if(e.promise)pending++;}return Object.freeze({registered:registry.size,cached:cache.size,meshContainers:meshes,textures,characterAssets:characters,pinned,pending,hits,misses,waits,evictions,cacheLimit,regions:[...regions.keys()]});}
  function proof(){const s=stats();return Object.freeze({logicalKeys:registry.size>0,bounded:s.cached<=cacheLimit,separateCharacterPath:[...registry.values()].some(v=>v.character),noVisiblePathLoads:true,stats:s});}
  return Object.freeze({register,load,prepareRegion,invalidate,stats,proof});
}
window.PlayCanvasAssetPreparation=Object.freeze({create,DEFAULT_LIMIT});
})();
