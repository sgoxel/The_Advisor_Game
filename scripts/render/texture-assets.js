(function(){
"use strict";

const textures=new Map();
const sources=new Map();
const resolvedSources=new Map();
const lastUsed=new Map();
const pinned=new Set();
let ready=false;
let loadingPromise=null;
const MAX_CACHED_KEYS=160;

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

function touch(key){lastUsed.set(key,Date.now())}

function pinKeys(keys){
  pinned.clear();
  for(const key of keys||[])if(key)pinned.add(key);
}

function evict(maxKeys=MAX_CACHED_KEYS){
  if(textures.size<=maxKeys)return 0;
  const candidates=[...textures.keys()]
    .filter(key=>!pinned.has(key))
    .sort((a,b)=>(lastUsed.get(a)||0)-(lastUsed.get(b)||0));
  let removed=0;
  while(textures.size>maxKeys&&candidates.length){
    const key=candidates.shift();
    textures.delete(key);
    resolvedSources.delete(key);
    lastUsed.delete(key);
    removed++;
  }
  return removed;
}

async function preloadKeys(keys,{pin=false}={}){
  if(!window.PIXI)throw new Error("PixiJS is not available");
  const manifest=catalog();
  const unique=[...new Set((keys||[]).filter(Boolean))];
  if(pin)pinKeys(unique);
  const missing=unique.filter(key=>!textures.has(key));
  await Promise.all(missing.map(async key=>{
    const texture=await resolveKey(key,manifest);
    textures.set(key,texture);
    touch(key);
  }));
  unique.forEach(touch);
  evict();
  return unique.map(key=>textures.get(key));
}

async function preloadAll(){
  if(ready)return stats();
  if(loadingPromise)return loadingPromise;
  loadingPromise=(async()=>{
    const manifest=catalog();
    await preloadKeys(Object.keys(manifest),{pin:true});
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
    cacheLimit:MAX_CACHED_KEYS,
    standardTerrainTexturePx:100
  });
}

window.TextureAssets=Object.freeze({
  catalog,candidates,preloadKeys,preloadAll,pinKeys,evict,get,source,has,stats
});
})();