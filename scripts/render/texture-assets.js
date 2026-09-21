(function(){
"use strict";

const textures=new Map();
const sources=new Map();
let ready=false;
let loadingPromise=null;

function catalog(){
  return Object.freeze({
    ...TileTextures.assetCatalog(),
    "character:protagonist-male":"assets/characters/protagonist_male.png"
  });
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

async function preloadKeys(keys){
  if(!window.PIXI)throw new Error("PixiJS is not available");
  const manifest=catalog();
  const unique=[...new Set(keys)];
  const missing=unique.filter(key=>!textures.has(key));
  await Promise.all(missing.map(async key=>{
    const url=manifest[key];
    if(!url)throw new Error("Unknown logical texture key: "+key);
    const texture=await loadSource(url);
    textures.set(key,texture);
  }));
  return unique.map(key=>textures.get(key));
}

async function preloadAll(){
  if(ready)return stats();
  if(loadingPromise)return loadingPromise;
  loadingPromise=(async()=>{
    const manifest=catalog();
    await preloadKeys(Object.keys(manifest));
    ready=true;
    return stats();
  })();
  try{return await loadingPromise}
  finally{loadingPromise=null}
}

function get(key){
  if(!key)return null;
  return textures.get(key)||null;
}

function source(key){
  return catalog()[key]||null;
}

function has(key){
  return textures.has(key);
}

function stats(){
  const manifest=catalog();
  const loadedKeys=[...textures.keys()];
  const loadedSources=[...new Set(loadedKeys.map(key=>manifest[key]).filter(Boolean))];
  return Object.freeze({
    ready,
    logicalKeyCount:Object.keys(manifest).length,
    loadedKeyCount:loadedKeys.length,
    loadedSourceCount:loadedSources.length,
    svgSourceCount:loadedSources.filter(url=>/\.svg(?:$|[?#])/i.test(url)).length,
    pngSourceCount:loadedSources.filter(url=>/\.png(?:$|[?#])/i.test(url)).length,
    standardTerrainTexturePx:100
  });
}

window.TextureAssets=Object.freeze({
  catalog,
  preloadKeys,
  preloadAll,
  get,
  source,
  has,
  stats
});
})();