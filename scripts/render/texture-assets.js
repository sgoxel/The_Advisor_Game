(function(){
"use strict";

const textures=new Map();
const sources=new Map();
const resolvedSources=new Map();
const lastUsed=new Map();
const pinned=new Set();
const preparedRegions=new Map();
let ready=false,loadingPromise=null,preparationSerial=0,preparedRegionKey=null,preparedKeys=[];
let lastActivationWasPrefetched=false,lastPrefetchDirection="0,0";
const MAX_CACHED_KEYS=160,MAX_PREPARED_REGIONS=20;
const prepTotals={regionPrepares:0,blockingLoads:0,activationCacheHits:0,activationPrefetchHits:0,prefetches:0,prefetchReuses:0,regionEvictions:0,resolutionRebuilds:0};
const resolutionTotals={pngAttempts:0,pngSuccesses:0,svgAttempts:0,svgSuccesses:0,terrainPngAttempts:0,terrainPngSuccesses:0,terrainSvgAttempts:0,terrainSvgSuccesses:0,blendMaskPngAttempts:0,blendMaskPngSuccesses:0,blendMaskSvgAttempts:0,blendMaskSvgSuccesses:0,invalidProductionPngs:0};

function runtimeResolution(){return window.RuntimeTextureResolution?.get?.()||32}
function sourceResolution(){return window.RuntimeTextureResolution?.SOURCE_RESOLUTION||128}
function cacheSignature(){return window.RuntimeTextureResolution?.cacheSignature?.()||("tile-texture@"+runtimeResolution()+"px")}
function resolutionClass(key){const v=String(key||"");if(v.startsWith("tile:"))return "terrain";if(v.startsWith("asset:blend_"))return "blendMask";return "other"}
function isResolutionAsset(key){return resolutionClass(key)!=="other"}
function cacheKey(key){return isResolutionAsset(key)?key+"@"+runtimeResolution()+"px":key}
function regionCacheKey(regionKey){return String(regionKey||"")+"|"+cacheSignature()}

function noteResolution(key,url,success){
  const isPng=/\.png(?:$|[?#])/i.test(String(url||"")),isSvg=/\.svg(?:$|[?#])/i.test(String(url||"")),kind=resolutionClass(key);
  if(isPng){resolutionTotals.pngAttempts++;if(success)resolutionTotals.pngSuccesses++;if(kind==="terrain"){resolutionTotals.terrainPngAttempts++;if(success)resolutionTotals.terrainPngSuccesses++}else if(kind==="blendMask"){resolutionTotals.blendMaskPngAttempts++;if(success)resolutionTotals.blendMaskPngSuccesses++}}
  else if(isSvg){resolutionTotals.svgAttempts++;if(success)resolutionTotals.svgSuccesses++;if(kind==="terrain"){resolutionTotals.terrainSvgAttempts++;if(success)resolutionTotals.terrainSvgSuccesses++}else if(kind==="blendMask"){resolutionTotals.blendMaskSvgAttempts++;if(success)resolutionTotals.blendMaskSvgSuccesses++}}
}
function catalog(){return Object.freeze({...TileTextures.assetCatalog(),"character:protagonist-male":"assets/characters/protagonist_male.png"})}
function candidates(url){const v=String(url||"");return /\.svg(?:$|[?#])/i.test(v)?Object.freeze([v.replace(/\.svg(?=$|[?#])/i,".png"),v]):Object.freeze([v])}

async function loadImage(url){
  let objectUrl=null,safeUrl=url;
  if(typeof fetch==="function")try{const response=await fetch(url,{cache:"force-cache"});if(response?.ok){const blob=await response.blob();if(blob?.size>0){objectUrl=URL.createObjectURL(blob);safeUrl=objectUrl}}}catch(_){}
  return new Promise((resolve,reject)=>{const image=new Image();image.decoding="async";image.crossOrigin="anonymous";image.onload=async()=>{try{if(typeof image.decode==="function")await image.decode()}catch(_){}if(objectUrl)URL.revokeObjectURL(objectUrl);resolve(image)};image.onerror=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);reject(new Error("Asset load failed: "+url))};image.src=safeUrl});
}
function rasterize(image,size){const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;const ctx=canvas.getContext("2d",{alpha:true});ctx.clearRect(0,0,size,size);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(image,0,0,size,size);return canvas}
function sourceKey(url,key){return url+"|"+(isResolutionAsset(key)?cacheSignature():"native")}
async function loadSource(url,key){
  const sk=sourceKey(url,key);if(sources.has(sk))return sources.get(sk);
  const pending=(async()=>{const image=await loadImage(url);let source=image;if(isResolutionAsset(key)){
    const isPng=/\.png(?:$|[?#])/i.test(url),size=runtimeResolution();
    if(isPng&&(image.naturalWidth!==sourceResolution()||image.naturalHeight!==sourceResolution())){resolutionTotals.invalidProductionPngs++;throw new Error("Production PNG must be "+sourceResolution()+"x"+sourceResolution()+": "+url+" is "+image.naturalWidth+"x"+image.naturalHeight)}
    source=rasterize(image,size);
  }
  return source})();
  sources.set(sk,pending);try{const texture=await pending;sources.set(sk,texture);return texture}catch(error){sources.delete(sk);throw error}
}
async function resolveKey(key,manifest){const declared=manifest[key];if(!declared)throw new Error("Unknown logical texture key: "+key);let lastError=null;for(const url of candidates(declared))try{noteResolution(key,url,false);const texture=await loadSource(url,key);noteResolution(key,url,true);resolvedSources.set(cacheKey(key),url);return texture}catch(error){lastError=error}throw lastError||new Error("Asset resolution failed: "+key)}
function normalizeKeys(keys){return [...new Set((keys||[]).filter(Boolean))]}
function touch(key){lastUsed.set(cacheKey(key),Date.now())}
function pinKeys(keys){pinned.clear();for(const key of keys||[])if(key)pinned.add(cacheKey(key))}
function releaseUnusedSources(){const inUse=new Set([...textures.keys()].map(key=>resolvedSources.get(key)).filter(Boolean));for(const [key,value] of [...sources.entries()]){const url=key.split("|")[0];if(inUse.has(url))continue;if(value&&typeof value.destroy==="function")try{value.destroy(true)}catch(_){}sources.delete(key)}}
function evict(maxKeys=MAX_CACHED_KEYS){if(textures.size<=maxKeys)return 0;const candidates=[...textures.keys()].filter(key=>!pinned.has(key)).sort((a,b)=>(lastUsed.get(a)||0)-(lastUsed.get(b)||0));let removed=0;while(textures.size>maxKeys&&candidates.length){const key=candidates.shift();textures.delete(key);resolvedSources.delete(key);lastUsed.delete(key);removed++}if(removed)releaseUnusedSources();return removed}
function regionPinnedKeyCount(){const keys=new Set();for(const record of preparedRegions.values())for(const key of record.keys)keys.add(cacheKey(key));return keys.size}
function refreshRegionPins(){const keys=[];for(const record of preparedRegions.values())keys.push(...record.keys);pinKeys(keys)}
function oldestEvictableRegion(){for(const key of preparedRegions.keys())if(key!==preparedRegionKey)return key;return null}
function trimPreparedRegions(){while(preparedRegions.size>MAX_PREPARED_REGIONS||(regionPinnedKeyCount()>MAX_CACHED_KEYS&&preparedRegions.size>1)){const key=oldestEvictableRegion();if(!key)break;preparedRegions.delete(key);prepTotals.regionEvictions++}refreshRegionPins();evict()}
function rememberRegion(regionKey,keys,kind){const key=regionCacheKey(regionKey);if(!key)return null;const record=Object.freeze({regionKey:String(regionKey||""),cacheRegionKey:key,cacheSignature:cacheSignature(),runtimeResolution:runtimeResolution(),keys:Object.freeze(normalizeKeys(keys)),kind:String(kind||"cached"),preparedAt:Date.now()});preparedRegions.delete(key);preparedRegions.set(key,record);trimPreparedRegions();return preparedRegions.get(key)||record}
function markRegionKind(regionKey,kind){const key=regionCacheKey(regionKey),current=preparedRegions.get(key);if(!current)return null;return rememberRegion(regionKey,current.keys,kind)}
function activateRegion(regionKey,keys,{wasPrefetched=false}={}){const key=regionCacheKey(regionKey);if(preparedRegionKey&&preparedRegionKey!==key&&preparedRegions.has(preparedRegionKey)){const previous=preparedRegions.get(preparedRegionKey);if(previous)rememberRegion(previous.regionKey,previous.keys,"cached")}preparedRegionKey=key;preparedKeys=normalizeKeys(keys);rememberRegion(regionKey,preparedKeys,"active");lastActivationWasPrefetched=Boolean(wasPrefetched);ready=true;return preparedRegions.get(key)||null}
async function preloadKeys(keys,{pin=false,deferEvict=false}={}){const manifest=catalog(),unique=normalizeKeys(keys);if(pin)pinKeys(unique);const missing=unique.filter(key=>!textures.has(cacheKey(key)));await Promise.all(missing.map(async key=>{const texture=await resolveKey(key,manifest),ck=cacheKey(key);textures.set(ck,texture);lastUsed.set(ck,Date.now())}));unique.forEach(touch);if(!deferEvict)evict();return unique.map(key=>textures.get(cacheKey(key)))}
function isRegionPrepared(regionKey,keys){const required=normalizeKeys(keys),record=preparedRegions.get(regionCacheKey(regionKey));return Boolean(ready&&record&&record.cacheSignature===cacheSignature()&&required.every(item=>record.keys.includes(item)&&textures.has(cacheKey(item))))}
async function prepareRegion(regionKey,keys){const unique=normalizeKeys(keys),rk=regionCacheKey(regionKey),cached=preparedRegions.get(rk);if(isRegionPrepared(regionKey,unique)){prepTotals.activationCacheHits++;const alreadyActive=rk===preparedRegionKey&&cached?.kind==="active",wasPrefetched=cached?.kind==="prefetch";if(wasPrefetched)prepTotals.activationPrefetchHits++;if(!alreadyActive)activateRegion(regionKey,unique,{wasPrefetched});else{preparedKeys=unique.slice();ready=true}return Object.freeze({ready:true,stale:false,regionKey:String(regionKey),keyCount:unique.length,cached:true,prefetched:wasPrefetched||(alreadyActive&&lastActivationWasPrefetched),runtimeResolution:runtimeResolution(),cacheSignature:cacheSignature()})}
  const serial=++preparationSerial;prepTotals.blockingLoads++;await preloadKeys(unique,{pin:false,deferEvict:true});if(serial!==preparationSerial)return Object.freeze({ready:false,stale:true,regionKey:String(regionKey),keyCount:unique.length});prepTotals.regionPrepares++;activateRegion(regionKey,unique,{wasPrefetched:false});return Object.freeze({ready:true,stale:false,regionKey:String(regionKey),keyCount:unique.length,cached:false,prefetched:false,runtimeResolution:runtimeResolution(),cacheSignature:cacheSignature()})}
async function prefetchRegion(regionKey,keys,{direction="0,0"}={}){const unique=normalizeKeys(keys);lastPrefetchDirection=String(direction||"0,0");if(isRegionPrepared(regionKey,unique)){prepTotals.prefetchReuses++;const current=preparedRegions.get(regionCacheKey(regionKey));if(current?.kind!=="active")rememberRegion(regionKey,unique,"prefetch");return Object.freeze({ready:true,regionKey:String(regionKey),keyCount:unique.length,reused:true,runtimeResolution:runtimeResolution()})}await preloadKeys(unique,{pin:false,deferEvict:true});rememberRegion(regionKey,unique,"prefetch");prepTotals.prefetches++;ready=true;return Object.freeze({ready:true,regionKey:String(regionKey),keyCount:unique.length,reused:false,runtimeResolution:runtimeResolution()})}
function invalidatePreparation(){preparationSerial++;preparedRegionKey=null;preparedKeys=[];preparedRegions.clear();ready=false;lastActivationWasPrefetched=false;lastPrefetchDirection="0,0";refreshRegionPins();evict()}
function invalidateResolution(){prepTotals.resolutionRebuilds++;invalidatePreparation()}
async function preloadAll(){const allRegion="prepared:all";if(ready&&isRegionPrepared(allRegion,Object.keys(catalog())))return stats();if(loadingPromise)return loadingPromise;loadingPromise=(async()=>{const keys=Object.keys(catalog());await preloadKeys(keys,{pin:false,deferEvict:true});preparedRegions.clear();activateRegion(allRegion,keys,{wasPrefetched:false});return stats()})();try{return await loadingPromise}finally{loadingPromise=null}}
function get(key){if(!key)return null;const ck=cacheKey(key),texture=textures.get(ck)||null;if(texture)lastUsed.set(ck,Date.now());return texture}
function source(key){return resolvedSources.get(cacheKey(key))||catalog()[key]||null}
function has(key){return textures.has(cacheKey(key))}
function stats(){const manifest=catalog(),logicalKeys=Object.keys(manifest),loadedLogical=logicalKeys.filter(key=>textures.has(cacheKey(key))),loadedSources=loadedLogical.map(key=>resolvedSources.get(cacheKey(key))||manifest[key]).filter(Boolean),regionEntries=[...preparedRegions.values()],terrainEntries=Object.entries(manifest).filter(([key])=>key.startsWith("tile:")),blendMaskEntries=Object.entries(manifest).filter(([key])=>key.startsWith("asset:blend_"));const pngFirstTerrainPolicyPass=terrainEntries.length>0&&terrainEntries.every(([,url])=>{const list=candidates(url);return list.length>=2&&/\.png(?:$|[?#])/i.test(list[0])&&/\.svg(?:$|[?#])/i.test(list[1])});const pngFirstBlendMaskPolicyPass=blendMaskEntries.length>0&&blendMaskEntries.every(([,url])=>{const list=candidates(url);return list.length>=2&&/\.png(?:$|[?#])/i.test(list[0])&&/\.svg(?:$|[?#])/i.test(list[1])});return Object.freeze({ready,logicalKeyCount:logicalKeys.length,loadedKeyCount:loadedLogical.length,totalResolutionCacheEntryCount:textures.size,loadedSourceCount:new Set(loadedSources).size,svgSourceCount:loadedSources.filter(url=>/\.svg(?:$|[?#])/i.test(url)).length,pngSourceCount:loadedSources.filter(url=>/\.png(?:$|[?#])/i.test(url)).length,pngPreferredCount:loadedLogical.filter(key=>/\.png(?:$|[?#])/i.test(resolvedSources.get(cacheKey(key))||"")).length,fallbackSvgCount:loadedLogical.filter(key=>/\.svg(?:$|[?#])/i.test(resolvedSources.get(cacheKey(key))||"")).length,pinnedKeyCount:pinned.size,preparedRegionKey,preparedKeyCount:preparedKeys.length,preparedRegionCount:preparedRegions.size,prefetchedRegionCount:regionEntries.filter(r=>r.kind==="prefetch").length,cachedPreparedRegionCount:regionEntries.filter(r=>r.kind==="cached").length,preparedRegionKeys:Object.freeze(regionEntries.map(r=>r.regionKey)),lastActivationWasPrefetched,lastPrefetchDirection,preparationSerial,cacheLimit:MAX_CACHED_KEYS,preparedRegionLimit:MAX_PREPARED_REGIONS,standardTerrainTexturePx:runtimeResolution(),sourceTerrainTexturePx:sourceResolution(),runtimeTextureResolution:runtimeResolution(),runtimeTextureCacheSignature:cacheSignature(),regionPrepares:prepTotals.regionPrepares,blockingLoadCount:prepTotals.blockingLoads,activationCacheHitCount:prepTotals.activationCacheHits,activationPrefetchHitCount:prepTotals.activationPrefetchHits,prefetchCount:prepTotals.prefetches,prefetchReuseCount:prepTotals.prefetchReuses,regionEvictionCount:prepTotals.regionEvictions,resolutionRebuildCount:prepTotals.resolutionRebuilds,pngFirstTerrainPolicyPass,pngFirstBlendMaskPolicyPass,pngAttemptCount:resolutionTotals.pngAttempts,pngSuccessCount:resolutionTotals.pngSuccesses,svgAttemptCount:resolutionTotals.svgAttempts,svgSuccessCount:resolutionTotals.svgSuccesses,terrainPngAttemptCount:resolutionTotals.terrainPngAttempts,terrainPngSuccessCount:resolutionTotals.terrainPngSuccesses,terrainSvgAttemptCount:resolutionTotals.terrainSvgAttempts,terrainSvgFallbackCount:resolutionTotals.terrainSvgSuccesses,blendMaskPngAttemptCount:resolutionTotals.blendMaskPngAttempts,blendMaskPngSuccessCount:resolutionTotals.blendMaskPngSuccesses,blendMaskSvgAttemptCount:resolutionTotals.blendMaskSvgAttempts,blendMaskSvgFallbackCount:resolutionTotals.blendMaskSvgSuccesses,invalidProductionPngCount:resolutionTotals.invalidProductionPngs})}

window.addEventListener("advisor:texture-resolution-change",invalidateResolution);
window.TextureAssets=Object.freeze({catalog,candidates,preloadKeys,prepareRegion,prefetchRegion,invalidatePreparation,isRegionPrepared,preloadAll,pinKeys,evict,get,source,has,stats});
})();
